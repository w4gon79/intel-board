/**
 * Remote HTTP Server (Phase 4I)
 *
 * Express server that serves the renderer UI over the local network
 * and provides REST endpoints mirroring all IPC handlers.
 * Accessible from any device (iPhone, iPad, laptop) on the same WiFi.
 */

import { createServer, type Server } from 'http'
import express, { type Request, type Response } from 'express'
import { join } from 'path'
import { readFileSync, readdirSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { loadSettings, loadSettingsMasked, saveSettings as persistSettings, mergeApiKeys, type AppSettings } from '../../ipc/settings.handlers'
import { config, reloadConfigFromSettings } from '../../utils/config'
import { getDatabase } from '../storage/database'
import { getDatabaseStatus } from '../storage/database'
import { getVectorStoreStatus } from '../storage/vectordb'

// ADS-B service functions
import {
  getLiveFlightMarkers,
  getFlightGeoJSON,
  getFlightDetails,
  getFlightCount,
  getMilitaryFlightCount,
  startAdsbPolling,
  stopAdsbPolling,
  pollAdsb
} from '../adsb/adsbService'

// AIS service functions
import {
  getLiveVesselMarkers,
  getVesselGeoJSON,
  getVesselDetails,
  getVesselCount,
  getVesselCountsByCategory,
  getChokePointCounts,
  startAisStreaming,
  stopAisStreaming,
  isAisConnected
} from '../ais/aisService'

// Data service functions
import {
  getArticles,
  getArticleById,
  getArticlesByRegion,
  getArticlesBySource,
  getRecentArticles,
  getArticleCount,
  getRecentIntelItems,
  getIntelItemCount,
  getIntelItemCountByTier,
  getActiveAnomalies,
  getActiveAnomalyCount,
  getPredictionsWithReviews
} from '../storage/dbService'

// Tactical / CSG
import { getTacticalEvents, getActiveTacticalEvents } from '../identification/tacticalEngine'
import { getCarrierGroups, getCarrierGroupById, refreshCarrierData } from '../csg/csgService'
import { listRules, createRule, updateRule, deleteRule } from '../alerts/ruleEngine'

// AI / RAG
import { executeRAG } from '../rag/pipeline'
import { runSenseMaking, getSenseMakingStatus } from '../senseMakingEngine'
import { getScraperStatus, toggleScraper, refreshScraper } from '../scrapers/scraperManager'

// GFW Vessel Presence
import { getGfwPresence, getGfwPresenceByChokepoint, getGfwStatus, triggerGfwPoll } from './gfwService'

// Social Media (Phase 5A)
import { getSocialPosts, getSocialStats, pollReddit, pollBlueSky } from '../sources/socialMediaService'

// Prediction
import { getRecentLogLines } from '../../utils/logger'

export class RemoteServer {
  private server: Server | null = null
  private app: express.Application
  private port: number = 3210

  constructor() {
    this.app = express()
    this.app.use(express.json())
    this.setupRoutes()
  }

  private setupRoutes(): void {
    const app = this.app

    // ── CORS (allow all origins on local network) ──
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      if (_req.method === 'OPTIONS') {
        res.sendStatus(204)
        return
      }
      next()
    })

    // ── Health check ──
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', version: '0.1.0' })
    })

    // ── Settings ──
    app.get('/api/settings', (_req, res) => {
      res.json(loadSettingsMasked())
    })

    app.post('/api/settings', (req: Request, res: Response) => {
      try {
        const incoming = req.body as AppSettings
        const previous = loadSettings()
        const merged: AppSettings = {
          ...incoming,
          apiKeys: mergeApiKeys(incoming.apiKeys, previous.apiKeys)
        }
        persistSettings(merged)
        reloadConfigFromSettings(merged)

        // Start/stop remote server if setting changed
        try {
          if (merged.remoteServer?.enabled && !previous.remoteServer?.enabled) {
            remoteServer.start(merged.remoteServer.port).catch(console.error)
          } else if (!merged.remoteServer?.enabled && previous.remoteServer?.enabled) {
            remoteServer.stop().catch(console.error)
          } else if (
            merged.remoteServer?.enabled &&
            merged.remoteServer.port !== previous.remoteServer?.port
          ) {
            remoteServer.stop().then(() => remoteServer.start(merged.remoteServer.port)).catch(console.error)
          }
        } catch (remoteErr) {
          console.warn('[HTTP] Remote server toggle error:', remoteErr)
        }

        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Save failed' })
      }
    })

    app.post('/api/settings/test-ai', async (req: Request, res: Response) => {
      try {
        const testConfig = req.body as { provider: string; ollamaBaseUrl?: string; openaiBaseUrl?: string; openaiApiKey?: string }
        if (testConfig.provider === 'local' || testConfig.provider === 'ollama-cloud') {
          const url = testConfig.ollamaBaseUrl || config.ollamaBaseUrl
          const tagUrl = `${url.replace(/\/$/, '')}/api/tags`
          const resp = await fetch(tagUrl, { signal: AbortSignal.timeout(5000) })
          if (resp.ok) {
            const body = (await resp.json()) as { models?: unknown[] }
            res.json({ ok: true, models: body.models?.length ?? 0 })
          } else {
            res.json({ ok: false, error: `HTTP ${resp.status}` })
          }
        } else if (testConfig.provider === 'openai-compatible') {
          if (!testConfig.openaiBaseUrl || !testConfig.openaiApiKey) {
            res.json({ ok: false, error: 'Base URL and API Key required' })
            return
          }
          const url = `${testConfig.openaiBaseUrl.replace(/\/$/, '')}/models`
          const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${testConfig.openaiApiKey}` },
            signal: AbortSignal.timeout(5000)
          })
          if (resp.ok) {
            try {
              const body = (await resp.json()) as { data?: unknown[] }
              res.json({ ok: true, models: body.data?.length ?? 0 })
            } catch {
              res.json({ ok: true, models: 0 })
            }
          } else {
            res.json({ ok: false, error: `HTTP ${resp.status}` })
          }
        } else {
          res.json({ ok: false, error: `Unknown provider: ${testConfig.provider}` })
        }
      } catch (err) {
        res.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' })
      }
    })

    app.post('/api/settings/test-openai-connection', async (req: Request, res: Response) => {
      try {
        const { baseUrl, apiKey } = req.body as { baseUrl: string; apiKey: string }
        if (!baseUrl || !apiKey) { res.json({ ok: false, error: 'Base URL and API Key required' }); return }
        const url = `${baseUrl.replace(/\/$/, '')}/models`
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000)
        })
        if (resp.ok) { res.json({ ok: true }) } else { res.json({ ok: false, error: `HTTP ${resp.status}` }) }
      } catch (err) {
        res.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' })
      }
    })

    app.post('/api/settings/test-api-key', async (req: Request, res: Response) => {
      try {
        const { service } = req.body as { service: string }
        const settings = loadSettings()
        switch (service) {
          case 'news': {
            const key = settings.apiKeys.newsApiKey
            if (!key) { res.json({ ok: false, error: 'No key configured' }); return }
            const resp = await fetch(`https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${key}`, { signal: AbortSignal.timeout(8000) })
            const body = (await resp.json()) as { status?: string; code?: string }
            if (body.status === 'ok') { res.json({ ok: true }) } else { res.json({ ok: false, error: body.code ?? `HTTP ${resp.status}` }) }
            break
          }
          case 'opensky': {
            const user = settings.apiKeys.openskyUsername
            const pass = settings.apiKeys.openskyPassword
            if (!user || !pass) { res.json({ ok: false, error: 'Username and password required' }); return }
            const resp = await fetch('https://opensky-network.org/api/states/all?lamin=45&lamax=46&lomin=5&lomax=6&limit=1', {
              headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') },
              signal: AbortSignal.timeout(10000)
            })
            if (resp.ok) { res.json({ ok: true }) } else if (resp.status === 401) { res.json({ ok: false, error: 'Invalid credentials' }) } else { res.json({ ok: false, error: `HTTP ${resp.status}` }) }
            break
          }
          case 'aisstream': {
            const key = settings.apiKeys.aisstreamApiKey
            if (!key) { res.json({ ok: false, error: 'No key configured' }); return }
            if (key.length >= 20) { res.json({ ok: true }) } else { res.json({ ok: false, error: 'Key too short' }) }
            break
          }
          case 'gfw': {
            const token = settings.apiKeys.gfwApiToken
            if (!token) { res.json({ ok: false, error: 'No token configured' }); return }
            const resp = await fetch('https://gateway.api.globalfishingwatch.org/v3/4wings/report', {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10000)
            })
            if (resp.status === 401 || resp.status === 403) { res.json({ ok: false, error: 'Invalid or expired token' }) } else { res.json({ ok: true }) }
            break
          }
          case 'fred': {
            const key = settings.apiKeys.fredApiKey
            if (!key) { res.json({ ok: false, error: 'No key configured' }); return }
            const resp = await fetch(`https://api.stlouisfed.org/fred/series/updates?api_key=${key}&file_type=json&limit=1`, { signal: AbortSignal.timeout(8000) })
            if (resp.ok) { res.json({ ok: true }) } else { res.json({ ok: false, error: `HTTP ${resp.status}` }) }
            break
          }
          default:
            res.json({ ok: false, error: `Unknown service: ${service}` })
        }
      } catch (err) {
        res.json({ ok: false, error: err instanceof Error ? err.message : 'Test failed' })
      }
    })

    app.get('/api/settings/models', async (req: Request, res: Response) => {
      try {
        const settings = loadSettings()
        const baseUrl = (req.query.baseUrl as string) || settings.ai.ollamaBaseUrl
        const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!resp.ok) { res.json([]); return }
        const body = (await resp.json()) as { models: Array<{ name: string; size: number; modified_at: string }> }
        res.json((body.models ?? []).map((m) => ({ name: m.name, size: formatBytes(m.size), modified_at: m.modified_at })))
      } catch {
        res.json([])
      }
    })

    app.get('/api/settings/test-connection', async (req: Request, res: Response) => {
      try {
        const settings = loadSettings()
        const baseUrl = (req.query.baseUrl as string) || settings.ai.ollamaBaseUrl
        const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (resp.ok) { res.json({ ok: true }) } else { res.json({ ok: false, error: `HTTP ${resp.status}` }) }
      } catch (err) {
        res.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' })
      }
    })

    // ── Database Status ──
    app.get('/api/db/status', (_req, res) => {
      res.json(getDatabaseStatus())
    })

    // ── Vector Store Status ──
    app.get('/api/vectordb/status', async (_req, res) => {
      res.json(await getVectorStoreStatus())
    })

    // ── ADS-B Lite (for remote browsers) ──
    app.get('/api/adsb/geojson/lite', (_req, res) => {
      const geojson = getFlightGeoJSON()
      if (!geojson?.features) { res.json({ type: 'FeatureCollection', features: [] }); return }
      let features = geojson.features
      if (features.length > 5000) {
        const military = features.filter((f: any) => f.properties?.is_military === 1)
        const civ = features.filter((f: any) => f.properties?.is_military !== 1)
        features = [...military, ...civ.slice(0, 5000 - military.length)]
      }
      const lite = {
        type: geojson.type,
        features: features.map((f: any) => ({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: f.properties.id,
            icao24: f.properties.icao24,
            is_military: f.properties.is_military,
            altitude: f.properties.altitude,
            velocity: f.properties.velocity,
            heading: f.properties.heading,
            aircraft_type: f.properties.aircraft_type,
            callsign: f.properties.callsign,
            origin_country: f.properties.origin_country
          }
        }))
      }
      res.json(lite)
    })

    app.get('/api/adsb/markers/lite', (_req, res) => {
      const markers = getLiveFlightMarkers()
      if (!Array.isArray(markers)) { res.json([]); return }
      const lite = markers.map((m: any) => ({
        id: m.id,
        icao24: m.icao24,
        lat: m.latitude,
        lng: m.longitude,
        is_mil: m.is_military,
        alt: m.altitude,
        type: m.aircraft_type
      }))
      res.json(lite)
    })

    // ── AIS Lite (for remote browsers) ──
    app.get('/api/ais/geojson/lite', (_req, res) => {
      const geojson = getVesselGeoJSON()
      if (!geojson?.features) { res.json({ type: 'FeatureCollection', features: [] }); return }
      // Cap at 5000 vessels for remote browsers, prioritize military vessels
      let features = geojson.features
      if (features.length > 5000) {
        const military = features.filter((f: any) => f.properties?.is_military === 1 || f.properties?.ship_type === 'military')
        const civilian = features.filter((f: any) => f.properties?.is_military !== 1 && f.properties?.ship_type !== 'military')
        features = [...military, ...civilian.slice(0, 5000 - military.length)]
      }
      const lite = {
        type: geojson.type,
        features: features.map((f: any) => ({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: f.properties.id,
            mmsi: f.properties.mmsi,
            ship_name: f.properties.ship_name,
            ship_type: f.properties.ship_type,
            speed: f.properties.speed,
            heading: f.properties.heading,
            is_military: f.properties.is_military
          }
        }))
      }
      res.json(lite)
    })

    app.get('/api/ais/markers/lite', (_req, res) => {
      const markers = getLiveVesselMarkers()
      if (!Array.isArray(markers)) { res.json([]); return }
      const lite = markers.map((m: any) => ({
        id: m.id,
        mmsi: m.mmsi,
        lat: m.latitude,
        lng: m.longitude,
        type: m.ship_type,
        name: m.ship_name,
        spd: m.speed,
        hdg: m.heading
      }))
      res.json(lite)
    })

    // ── ADS-B ──
    app.get('/api/adsb/markers', (_req, res) => {
      res.json(getLiveFlightMarkers())
    })

    app.get('/api/adsb/geojson', (_req, res) => {
      res.json(getFlightGeoJSON())
    })

    app.get('/api/adsb/details', (req, res) => {
      const id = req.query.id as string
      if (!id) { res.status(400).json({ error: 'id query param required' }); return }
      res.json(getFlightDetails(id))
    })

    app.get('/api/adsb/count', (_req, res) => {
      res.json({ total: getFlightCount(), military: getMilitaryFlightCount() })
    })

    app.post('/api/adsb/startPolling', (req, res) => {
      startAdsbPolling(req.body?.intervalMs)
      res.json({ success: true })
    })

    app.post('/api/adsb/stopPolling', (_req, res) => {
      stopAdsbPolling()
      res.json({ success: true })
    })

    app.post('/api/adsb/pollNow', async (_req, res) => {
      const count = await pollAdsb()
      res.json(count)
    })

    // ── AIS ──
    app.get('/api/ais/markers', (_req, res) => {
      res.json(getLiveVesselMarkers())
    })

    app.get('/api/ais/geojson', (_req, res) => {
      res.json(getVesselGeoJSON())
    })

    app.get('/api/ais/details', (req, res) => {
      const id = req.query.id as string
      if (!id) { res.status(400).json({ error: 'id query param required' }); return }
      res.json(getVesselDetails(id))
    })

    app.get('/api/ais/count', (_req, res) => {
      res.json(getVesselCount())
    })

    app.get('/api/ais/countsByCategory', (_req, res) => {
      res.json(getVesselCountsByCategory())
    })

    app.get('/api/ais/chokepoints', (_req, res) => {
      res.json(getChokePointCounts())
    })

    app.get('/api/ais/status', (_req, res) => {
      res.json({ connected: isAisConnected() })
    })

    app.post('/api/ais/startStreaming', (_req, res) => {
      startAisStreaming()
      res.json({ success: true })
    })

    app.post('/api/ais/stopStreaming', (_req, res) => {
      stopAisStreaming()
      res.json({ success: true })
    })

    // ── Articles ──
    app.get('/api/articles', (req, res) => {
      const limit = Number(req.query.limit) || 100
      const offset = Number(req.query.offset) || 0
      res.json(getArticles(limit, offset))
    })

    app.get('/api/articles/:id', (req, res) => {
      res.json(getArticleById(req.params.id))
    })

    app.get('/api/articles/byRegion/:region', (req, res) => {
      const limit = Number(req.query.limit) || 50
      res.json(getArticlesByRegion(req.params.region, limit))
    })

    app.get('/api/articles/bySource/:source', (req, res) => {
      const limit = Number(req.query.limit) || 50
      res.json(getArticlesBySource(req.params.source, limit))
    })

    app.get('/api/articles/recent', (req, res) => {
      const hoursBack = req.query.hoursBack ? Number(req.query.hoursBack) : undefined
      res.json(getRecentArticles(hoursBack))
    })

    app.get('/api/articles/count', (_req, res) => {
      res.json(getArticleCount())
    })

    // ── Intel Items ──
    app.get('/api/intel/recent', (req, res) => {
      const limit = Number(req.query.limit) || 50
      const offset = Number(req.query.offset) || 0
      res.json(getRecentIntelItems(limit, offset))
    })

    app.get('/api/intel/count', (_req, res) => {
      res.json(getIntelItemCount())
    })

    app.get('/api/intel/countByTier', (_req, res) => {
      res.json(getIntelItemCountByTier())
    })

    // ── Anomalies ──
    app.get('/api/anomalies/active', (req, res) => {
      const limit = Number(req.query.limit) || 100
      res.json(getActiveAnomalies(limit))
    })

    app.get('/api/anomalies/count', (_req, res) => {
      res.json(getActiveAnomalyCount())
    })

    // ── Tactical Events ──
    app.get('/api/tactical/events', (req, res) => {
      const status = req.query.status as string | undefined
      getTacticalEvents(status)
        .then((r) => res.json(r))
        .catch(() => res.json([]))
    })

    app.get('/api/tactical/activeEvents', (_req, res) => {
      getActiveTacticalEvents()
        .then((r) => res.json(r))
        .catch(() => res.json([]))
    })

    // ── Carrier Strike Groups ──
    app.get('/api/carrier/groups', (_req, res) => {
      res.json(getCarrierGroups())
    })

    app.get('/api/carrier/groups/:id', (req, res) => {
      res.json(getCarrierGroupById(req.params.id))
    })

    app.post('/api/carrier/refresh', async (_req, res) => {
      res.json(await refreshCarrierData())
    })

    // ── AI Chat ──
    app.post('/api/ai/chat', async (req, res) => {
      const { message } = req.body as { message: string }
      if (!message) { res.status(400).json({ error: 'message required' }); return }
      try {
        const db = getDatabase()
        db.prepare(`INSERT INTO chat_messages (role, content) VALUES ('user', ?)`).run(message)

        let responseContent: string
        let sources: Array<{
          id: string; title: string; snippet: string; timestamp: string
          score: number; sourceType: string; sourceUrl: string | null
        }> = []
        let confidence = 0.7

        try {
          const result = await executeRAG({ query: message, history: [] })
          if (result?.answer) {
            sources = (result.sources ?? []).map((s) => ({
              id: String(s.sourceId),
              title: `${s.sourceType} — ${s.region ?? 'unknown'}`,
              snippet: '',
              timestamp: s.timestamp ?? new Date().toISOString(),
              score: s.confidence,
              sourceType: s.sourceType,
              sourceUrl: null
            }))
            if (sources.length > 0) {
              const avgScore = sources.reduce((sum, s) => sum + s.score, 0) / sources.length
              confidence = avgScore
              responseContent = avgScore < 0.4
                ? '⚠ **Insufficient data** — the retrieved sources had low relevance scores ' +
                  `(avg ${Math.round(avgScore * 100)}%). Try refining your query.\n\n${result.answer}`
                : result.answer
            } else {
              confidence = 0.2
              responseContent = '⚠ **Insufficient data** — no relevant sources were found for your query.'
            }
          } else {
            responseContent = 'I was unable to find relevant intelligence data for your query.'
            confidence = 0.3
          }
        } catch {
          responseContent = 'The AI analysis pipeline is currently unavailable. Please ensure Ollama is running.'
          confidence = 0.1
        }

        const insertResult = db
          .prepare(`INSERT INTO chat_messages (role, content, sources, confidence) VALUES ('assistant', ?, ?, ?)`)
          .run(responseContent, sources.length > 0 ? JSON.stringify(sources) : null, confidence)

        res.json({
          id: insertResult.lastInsertRowid as number,
          role: 'assistant' as const,
          content: responseContent,
          sources,
          confidence,
          createdAt: new Date().toISOString()
        })
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Chat failed' })
      }
    })

    // ── AI Brief (Click-for-Brief from map markers) ──
    app.post('/api/ai/brief', async (req, res) => {
      const { type, data } = req.body as { type: string; data: Record<string, unknown> }
      if (!type || !data) { res.status(400).json({ error: 'type and data required' }); return }

      // Build query from marker data (same logic as ai.handlers.ts)
      let query: string
      switch (type) {
        case 'ship':
          query = `A vessel has been detected and confirmed by AIS tracking with the following details:
- Name: ${data.name || 'MMSI ' + data.mmsi}
- Type: ${data.type || 'unknown'}
- MMSI: ${data.mmsi || 'unknown'}
- Destination: ${data.destination || 'unknown'}
- Position: ${data.lat}°N, ${data.lon}°E
- Military: ${data.military ? 'Yes, classified as military vessel' : 'No'}

This is CONFIRMED tracking data from a live AIS feed. Do NOT say you cannot provide an analysis — the vessel exists and the data above is confirmed.

Provide a concise intelligence brief including:
1. Vessel identification and operator assessment
2. Strategic significance of this vessel's current position
3. Nearby naval assets or related activity
4. Any related tactical events in the region`
          break
        case 'aircraft':
          query = `An aircraft has been detected and confirmed by ADS-B tracking with the following details:
- Callsign: ${data.callsign || 'unknown'}
- Type: ${data.type || 'unknown'}
- Altitude: ${data.alt ? data.alt + ' ft' : 'unknown'}
- Heading: ${data.heading ? data.heading + '°' : 'unknown'}
- Speed: ${data.speed ? data.speed + ' kts' : 'unknown'}
- Position: ${data.lat}°N, ${data.lon}°E
- Hex code: ${data.hex || 'unknown'}

This is CONFIRMED tracking data from a live ADS-B feed. Do NOT say you cannot provide an analysis — the aircraft exists and the data above is confirmed.

Provide a concise intelligence brief including:
1. Mission inference based on aircraft type, altitude, heading, and location
2. What military or government operator likely operates this aircraft type
3. Strategic significance of this aircraft's current position and heading
4. Any related tactical activity in the region from your live data
5. Likely origin and destination based on heading and regional context`
          break
        case 'csg':
          query = `A carrier strike group has been confirmed by USNI fleet tracking with the following details:
- Group: ${data.name || 'Carrier Strike Group'}
- Position: ${data.lat}°N, ${data.lon}°E
- Escorts: ${data.escortCount || 'unknown'} escort vessels
- Status: ${data.status || 'active'}

This is CONFIRMED fleet tracking data. Do NOT say you cannot provide an analysis.

Provide a concise intelligence brief including:
1. Current operational posture and strategic deployment
2. Escort composition and defensive capabilities
3. Nearby threats or adversarial forces
4. Strategic significance of this group's current position
5. Any related tactical events or alerts in the region`
          break
        case 'chokepoint':
          query = `Provide a concise intelligence brief on the ${data.name} choke point. Current status: ${data.status || 'unknown'}. Include traffic analysis, nearby naval presence, and strategic significance.`
          break
        case 'intel':
          query = `Provide a concise intelligence brief on the ${data.tier || ''} event: "${data.title}" at ${data.lat}°N, ${data.lon}°E. Include all related alerts, tactical context, and significance assessment.`
          break
        default:
          query = `Provide an intelligence brief on the contact at ${data.lat}°N, ${data.lon}°E.`
      }

      try {
        const result = await executeRAG({ query, history: [] })
        res.json({ success: true, answer: result.answer, sources: result.sources })
      } catch (error) {
        console.error('[HTTP] Brief generation error:', error)
        res.status(500).json({ success: false, answer: 'Brief generation failed. Try again.' })
      }
    })

    app.get('/api/ai/history', (req, res) => {
      try {
        const limit = Number(req.query.limit) || 50
        const db = getDatabase()
        const messages = db
          .prepare(`SELECT id, role, content, sources, confidence, created_at FROM chat_messages ORDER BY created_at DESC LIMIT ?`)
          .all(limit)
        res.json(messages.reverse())
      } catch {
        res.json([])
      }
    })

    // ── RAG Pipeline ──
    app.post('/api/rag/query', async (req, res) => {
      try {
        const result = await executeRAG(req.body)
        res.json(result)
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'RAG query failed' })
      }
    })

    // ── Sense-making ──
    app.post('/api/sensemaking/run', async (_req, res) => {
      await runSenseMaking()
      res.json({ success: true })
    })

    app.get('/api/sensemaking/status', async (_req, res) => {
      res.json(await getSenseMakingStatus())
    })

    // ── Sources ──
    app.get('/api/sources', async (_req, res) => {
      res.json(await getScraperStatus())
    })

    app.post('/api/sources/:id/toggle', async (req, res) => {
      const { enabled } = req.body as { enabled: boolean }
      res.json(await toggleScraper(req.params.id, enabled))
    })

    app.post('/api/sources/:id/refresh', async (req, res) => {
      const inserted = await refreshScraper(req.params.id)
      res.json({ inserted })
    })

    // ── Logger ──
    app.get('/api/logger/recent', (req, res) => {
      const lines = Number(req.query.lines) || 100
      res.json(getRecentLogLines(lines))
    })

    // ── SSE: Real-time push ──
    app.get('/api/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders()
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000)
      req.on('close', () => clearInterval(keepAlive))
    })

    // ── Predictions ──
    app.get('/api/predictions/unresolved', (req, res) => {
      const limit = Number(req.query.limit) || 20
      try {
        const db = getDatabase()
        const rows = db
          .prepare('SELECT * FROM predictions WHERE status = \'active\' ORDER BY predicted_at DESC LIMIT ?')
          .all(limit)
        res.json(rows)
      } catch {
        res.json([])
      }
    })

    app.get('/api/predictions/accuracy', (_req, res) => {
      try {
        const db = getDatabase()
        const total = (db.prepare('SELECT COUNT(*) as count FROM predictions').get() as { count: number }).count
        const resolved = (db.prepare("SELECT COUNT(*) as count FROM predictions WHERE status = 'resolved'").get() as { count: number }).count
        const accurate = (db.prepare('SELECT COUNT(*) as count FROM predictions WHERE was_accurate = 1').get() as { count: number }).count
        const inaccurate = (db.prepare('SELECT COUNT(*) as count FROM predictions WHERE was_accurate = 0').get() as { count: number }).count

        // Verdict breakdown from prediction_reviews
        const verdictRows = db.prepare(
          `SELECT outcome, COUNT(*) as count FROM prediction_reviews GROUP BY outcome`
        ).all() as { outcome: string; count: number }[]
        let partial = 0
        let inconclusive = 0
        for (const row of verdictRows) {
          if (row.outcome === 'partially_accurate') partial = row.count
          if (row.outcome === 'inconclusive') inconclusive = row.count
        }

        res.json({
          total,
          resolved,
          accurate,
          inaccurate,
          partial,
          inconclusive,
          accuracyRate: (accurate + inaccurate) > 0 ? accurate / (accurate + inaccurate) : 0
        })
      } catch {
        res.json({ total: 0, resolved: 0, accurate: 0, inaccurate: 0, partial: 0, inconclusive: 0, accuracyRate: 0 })
      }
    })

    app.get('/api/predictions/getWithReviews', (_req, res) => {
      try {
        res.json(getPredictionsWithReviews())
      } catch {
        res.json([])
      }
    })

    app.post('/api/predictions/review', (req, res) => {
      try {
        const { id, outcome, wasAccurate } = req.body as { id: string; outcome: string; wasAccurate: boolean }
        const db = getDatabase()
        db.prepare(
          `UPDATE predictions SET outcome = ?, was_accurate = ?, resolved_at = datetime('now'), status = 'resolved' WHERE id = ?`
        ).run(outcome, wasAccurate ? 1 : 0, id)
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Review failed' })
      }
    })

    // ── Ingestion ──
    app.get('/api/ingestion/status', (_req, res) => {
      res.json({ running: true })
    })

    app.post('/api/ingestion/start', (_req, res) => {
      res.json({ success: true, message: 'Use Electron app for ingestion control' })
    })

    app.post('/api/ingestion/stop', (_req, res) => {
      res.json({ success: true, message: 'Use Electron app for ingestion control' })
    })

    app.post('/api/ingestion/trigger', (_req, res) => {
      res.json({ success: true, message: 'Use Electron app for ingestion control' })
    })

    app.get('/api/ingestion/search', (req, res) => {
      const query = req.query.q as string
      if (!query) {
        res.json([])
        return
      }
      try {
        const db = getDatabase()
        const rows = db
          .prepare(
            `SELECT * FROM intel_items WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 50`
          )
          .all(`%${query}%`, `%${query}%`)
        res.json(rows)
      } catch {
        res.json([])
      }
    })

    // ── Intel deletion ──
    app.post('/api/intel/deleteByTitle', (req, res) => {
      try {
        const { pattern } = req.body as { pattern: string }
        const db = getDatabase()
        const result = db.prepare('DELETE FROM intel_items WHERE title LIKE ?').run(`%${pattern}%`)
        res.json({ success: true, deleted: result.changes })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' })
      }
    })

    app.post('/api/intel/deleteOlderThan', (req, res) => {
      try {
        const { hours } = req.body as { hours: number }
        const db = getDatabase()
        const result = db
          .prepare("DELETE FROM intel_items WHERE datetime(created_at) < datetime('now', ? || ' hours')")
          .run(`-${hours}`)
        res.json({ success: true, deleted: result.changes })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' })
      }
    })

    app.post('/api/intel/deleteByIds', (req, res) => {
      try {
        const { ids } = req.body as { ids: string[] }
        if (!Array.isArray(ids) || ids.length === 0) {
          res.json({ success: true, deleted: 0 })
          return
        }
        const db = getDatabase()
        const placeholders = ids.map(() => '?').join(',')
        const result = db.prepare(`DELETE FROM intel_items WHERE id IN (${placeholders})`).run(...ids)
        res.json({ success: true, deleted: result.changes })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' })
      }
    })

    // ── Aircraft Identification ──
    app.get('/api/aircraft/lookup', (req, res) => {
      const icao24 = req.query.icao24 as string
      try {
        const db = getDatabase()
        const row = db
          .prepare('SELECT * FROM aircraft_registry WHERE icao24 = ?')
          .get(icao24)
        if (row) {
          res.json(row)
        } else {
          res.json({ type: 'unknown', operator: 'Unknown', source: 'remote' })
        }
      } catch {
        res.json({ type: 'unknown', operator: 'Unknown', source: 'remote' })
      }
    })

    app.get('/api/aircraft/info', (req, res) => {
      const icao24 = req.query.icao24 as string
      try {
        const db = getDatabase()
        const row = db
          .prepare('SELECT * FROM aircraft_registry WHERE icao24 = ?')
          .get(icao24)
        res.json(row || null)
      } catch {
        res.json(null)
      }
    })

    // ── Vessel Identification ──
    app.get('/api/vessel/lookup', (req, res) => {
      const mmsi = req.query.mmsi as string
      try {
        const db = getDatabase()
        const row = db
          .prepare('SELECT * FROM vessel_registry WHERE mmsi = ?')
          .get(mmsi)
        if (row) {
          res.json(row)
        } else {
          res.json({ classification: 'unknown', source: 'remote' })
        }
      } catch {
        res.json({ classification: 'unknown', source: 'remote' })
      }
    })

    app.get('/api/vessel/info', (req, res) => {
      const mmsi = req.query.mmsi as string
      try {
        const db = getDatabase()
        const row = db
          .prepare('SELECT * FROM vessel_registry WHERE mmsi = ?')
          .get(mmsi)
        res.json(row || null)
      } catch {
        res.json(null)
      }
    })

    // ── RAG extras ──
    app.get('/api/rag/models', async (_req, res) => {
      try {
        const settings = loadSettings()
        const url = `${settings.ai.ollamaBaseUrl.replace(/\/$/, '')}/api/tags`
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!resp.ok) {
          res.json([])
          return
        }
        const body = (await resp.json()) as { models: Array<{ name: string }> }
        res.json((body.models ?? []).map((m) => m.name))
      } catch {
        res.json([])
      }
    })

    app.get('/api/rag/status', (_req, res) => {
      res.json({ available: true })
    })

    app.post('/api/rag/quickAnalysis', async (req, res) => {
      try {
        const { topic, region } = req.body as { topic: string; region?: string }
        const result = await executeRAG({
          query: `${topic}${region ? ` in ${region}` : ''}`,
          history: []
        })
        res.json(result)
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' })
      }
    })

    // ── GFW Vessel Presence (Phase 4I) ──
    app.get('/api/gfw/presence', (_req, res) => {
      try {
        res.json(getGfwPresence())
      } catch {
        res.json([])
      }
    })

    app.get('/api/gfw/chokepoints', (_req, res) => {
      try {
        res.json(getGfwPresence())
      } catch {
        res.json([])
      }
    })

    app.get('/api/gfw/chokepoints/:name', (req, res) => {
      try {
        res.json(getGfwPresenceByChokepoint(req.params.name))
      } catch {
        res.json([])
      }
    })

    app.get('/api/gfw/status', (_req, res) => {
      res.json(getGfwStatus())
    })

    app.post('/api/gfw/trigger', async (_req, res) => {
      try {
        await triggerGfwPoll()
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'GFW poll failed' })
      }
    })

    // ── Tactical extras ──
    app.post('/api/tactical/deleteEvents', (req, res) => {
      try {
        const { eventType } = req.body as { eventType?: string }
        const db = getDatabase()
        if (eventType) {
          db.prepare('DELETE FROM tactical_events WHERE event_type = ?').run(eventType)
        } else {
          db.prepare('DELETE FROM tactical_events').run()
        }
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' })
      }
    })

    // ── Alert Rules (Phase 5A) ──
    app.get('/api/alert-rules', (_req, res) => {
      try {
        res.json(listRules())
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'List failed' })
      }
    })

    app.post('/api/alert-rules', (req, res) => {
      try {
        const rule = req.body as Record<string, unknown>
        const id = createRule({
          name: rule.name as string,
          enabled: rule.enabled !== false,
          entity_type: rule.entity_type as 'ship' | 'aircraft' | 'csg',
          filters: (rule.filters as Array<{ field: string; operator: string; value: string | number }>) ?? [],
          trigger: (rule.trigger as { count_threshold: number; count_operator: string; time_window_minutes: number })
            ?? { count_threshold: 1, count_operator: '>', time_window_minutes: 0 },
          area: rule.area as { region: string } | { point: [number, number]; radius: number },
          severity: (rule.severity as 'ALERT' | 'WATCH' | 'CONTEXT') ?? 'WATCH',
          label: rule.label as string,
          cooldown_minutes: (rule.cooldown_minutes as number) ?? 30
        })
        res.json({ success: true, id })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Create failed' })
      }
    })

    app.put('/api/alert-rules/:id', (req, res) => {
      try {
        updateRule(req.params.id, req.body as Record<string, unknown>)
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' })
      }
    })

    app.delete('/api/alert-rules/:id', (req, res) => {
      try {
        deleteRule(req.params.id)
        res.json({ success: true })
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' })
      }
    })

    // ── Social Media (Phase 5A) ──
    app.get('/api/social/posts', (req, res) => {
      try {
        const limit = Number(req.query.limit) || 50
        const source = req.query.source as 'reddit' | 'bluesky' | undefined
        const sourceDetail = req.query.sourceDetail as string | undefined
        res.json(getSocialPosts(limit, source, sourceDetail))
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Fetch failed' })
      }
    })

    app.get('/api/social/stats', (_req, res) => {
      try {
        res.json(getSocialStats())
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Stats failed' })
      }
    })

    app.post('/api/social/pollReddit', async (_req, res) => {
      try {
        const result = await pollReddit()
        res.json(result)
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Reddit poll failed' })
      }
    })

    app.post('/api/social/pollBlueSky', async (_req, res) => {
      try {
        const result = await pollBlueSky()
        res.json(result)
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'BlueSky poll failed' })
      }
    })

    // ── Static files (renderer) ──
    const rendererPath = join(__dirname, '../renderer')

    // ── Favicon ──
    app.get('/favicon.ico', (_req, res) => {
      const faviconPath = join(rendererPath, 'assets', 'favicon.ico')
      // In production build Vite may hash the filename — fall back to glob-like search
      try {
        const assetsDir = join(rendererPath, 'assets')
        const files = readdirSync(assetsDir)
        const hashed = files.find((f) => f.startsWith('favicon') && f.endsWith('.ico'))
        if (hashed) {
          res.setHeader('Content-Type', 'image/x-icon')
          res.sendFile(join(assetsDir, hashed))
          return
        }
      } catch { /* fall through */ }
      res.setHeader('Content-Type', 'image/x-icon')
      res.sendFile(faviconPath)
    })

    if (is.dev) {
      // In dev: proxy to Vite dev server for HMR
      const rendererUrl = process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173'
      // Simple redirect in dev mode — clients should access Vite dev server directly for HMR
      app.get('/dev-info', (_req, res) => {
        res.json({
          mode: 'development',
          rendererUrl,
          message: 'For HMR, access the Vite dev server directly. For production build testing, run npm run build first.'
        })
      })
    }

    // Serve built renderer files (production)
    app.use(express.static(rendererPath, { index: false }))
    // SPA fallback — use middleware (not app.get('*')) for Express 5 compatibility
    // Replace restrictive CSP meta tag with a permissive one for remote browser access
    app.use((_req: express.Request, res: express.Response) => {
      const indexPath = join(rendererPath, 'index.html')
      let html = readFileSync(indexPath, 'utf-8')
      // Remove restrictive CSP for remote access — Electron loads via mainWindow.loadFile() so it's unaffected
      html = html.replace(
        /<meta[^>]*Content-Security-Policy[^>]*>/i,
        '<meta http-equiv="Content-Security-Policy" content="default-src * data: blob: \'unsafe-inline\' \'unsafe-eval\'; worker-src blob: \'self\';">'
      )
      res.setHeader('Content-Type', 'text/html')
      res.send(html)
    })
  }

  async start(port?: number): Promise<string> {
    if (this.server) return `Already running on port ${this.port}`
    this.port = port ?? this.port
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app)
      this.server.listen(this.port, '0.0.0.0', () => {
        const msg = `[RemoteServer] Listening on http://0.0.0.0:${this.port}`
        console.log(msg)
        resolve(`http://0.0.0.0:${this.port}`)
      })
      this.server.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null
        console.log('[RemoteServer] Stopped')
        resolve()
      })
    })
  }

  get isRunning(): boolean {
    return this.server !== null
  }
}

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

// Singleton
export const remoteServer = new RemoteServer()
