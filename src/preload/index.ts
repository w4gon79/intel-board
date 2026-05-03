import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { RAGRequest } from '../shared/types'

/**
 * API bridge between renderer and main process.
 * All IPC calls are explicitly listed here for type safety.
 */
const api = {
  // ── Database ──
  db: {
    getStatus: () => ipcRenderer.invoke('db:getStatus')
  },

  // ── Vector Store ──
  vectordb: {
    getStatus: () => ipcRenderer.invoke('vectordb:getStatus')
  },

  // ── Ingestion ──
  ingestion: {
    start: () => ipcRenderer.invoke('ingestion:start'),
    stop: () => ipcRenderer.invoke('ingestion:stop'),
    status: () => ipcRenderer.invoke('ingestion:status'),
    trigger: (gdeltQuery?: string) => ipcRenderer.invoke('ingestion:trigger', gdeltQuery),
    search: (query: string) => ipcRenderer.invoke('ingestion:search', query)
  },

  // ── Articles ──
  articles: {
    getAll: (limit?: number, offset?: number) =>
      ipcRenderer.invoke('articles:getAll', limit, offset),
    getById: (id: string) => ipcRenderer.invoke('articles:getById', id),
    getByRegion: (region: string, limit?: number) =>
      ipcRenderer.invoke('articles:getByRegion', region, limit),
    getBySource: (source: string, limit?: number) =>
      ipcRenderer.invoke('articles:getBySource', source, limit),
    getRecent: (hoursBack?: number) => ipcRenderer.invoke('articles:getRecent', hoursBack),
    getCount: () => ipcRenderer.invoke('articles:getCount')
  },

  // ── Intel Items ──
  intel: {
    getRecent: (limit?: number, offset?: number) =>
      ipcRenderer.invoke('intel:getRecent', limit, offset),
    getCount: () => ipcRenderer.invoke('intel:getCount'),
    getCountByTier: () => ipcRenderer.invoke('intel:getCountByTier'),
    deleteByTitle: (pattern: string) => ipcRenderer.invoke('intel:deleteByTitle', pattern),
    deleteOlderThan: (hours: number) => ipcRenderer.invoke('intel:deleteOlderThan', hours),
    deleteByIds: (ids: string[]) => ipcRenderer.invoke('intel:deleteByIds', ids)
  },

  // ── Anomalies ──
  anomalies: {
    getActive: (limit?: number) => ipcRenderer.invoke('anomalies:getActive', limit),
    getCount: () => ipcRenderer.invoke('anomalies:getCount')
  },

  // ── Predictions ──
  predictions: {
    /** Get unresolved (active) predictions */
    getUnresolved: (limit?: number) => ipcRenderer.invoke('predictions:getUnresolved', limit),
    /** Get all predictions with review data (unresolved first) */
    getWithReviews: (limit?: number) => ipcRenderer.invoke('predictions:getWithReviews', limit),
    /** Review a prediction (mark resolved with outcome) */
    review: (id: string, outcome: string, wasAccurate: boolean) =>
      ipcRenderer.invoke('predictions:review', id, outcome, wasAccurate),
    /** Get prediction accuracy stats */
    getAccuracy: () => ipcRenderer.invoke('predictions:getAccuracy'),
    /** Get AI review stats */
    getReviewStats: () => ipcRenderer.invoke('prediction:review-stats')
  },

  // ── AI Chat ──
  ai: {
    /** Send a chat message and get AI response via RAG pipeline */
    chat: (message: string) => ipcRenderer.invoke('ai:chat', message),
    /** Get chat history */
    getHistory: (limit?: number) => ipcRenderer.invoke('ai:getHistory', limit),
    /** Generate contextual intelligence brief for a map marker */
    brief: (request: { type: string; data: Record<string, unknown> }) =>
      ipcRenderer.invoke('ai:brief', request)
  },

  // ── RAG Pipeline ──
  rag: {
    /** Send a query through the full RAG pipeline (retrieve → generate → cite) */
    query: (request: RAGRequest) => ipcRenderer.invoke('rag:query', request),
    /** Quick analysis on a topic */
    quickAnalysis: (topic: string, region?: string) =>
      ipcRenderer.invoke('rag:quickAnalysis', topic, region),
    /** List available Ollama models */
    listModels: () => ipcRenderer.invoke('rag:listModels'),
    /** Get RAG pipeline health status */
    status: () => ipcRenderer.invoke('rag:status')
  },

  // ── Settings ──
  settings: {
    /** Load settings from settings.json */
    get: () => ipcRenderer.invoke('settings:get'),
    /** Save settings to settings.json */
    save: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:save', settings),
    /** List available Ollama models */
    listModels: (baseUrl?: string) => ipcRenderer.invoke('settings:listModels', baseUrl),
    /** Test Ollama connection */
    testConnection: (baseUrl?: string) => ipcRenderer.invoke('settings:testConnection', baseUrl),
    /** Test OpenAI-compatible connection */
    testOpenaiConnection: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('settings:testOpenaiConnection', baseUrl, apiKey),
    /** Unified AI connection test (primary or fallback) */
    testAI: (config: { provider: string; ollamaBaseUrl?: string; openaiBaseUrl?: string; openaiApiKey?: string }) =>
      ipcRenderer.invoke('settings:testAI', config),
    /** Test an API key by making a real API call */
    testApiKey: (service: string) => ipcRenderer.invoke('settings:testApiKey', service),
    /** Test the translation pipeline with a sample phrase */
    testTranslation: (text: string, language: string) =>
      ipcRenderer.invoke('settings:testTranslation', text, language)
  },

  // ── ADS-B / Flight Tracking ──
  adsb: {
    /** Get all live flight markers for the map */
    getMarkers: () => ipcRenderer.invoke('adsb:getMarkers'),
    /** Get flights as GeoJSON FeatureCollection (performant for large datasets) */
    getGeoJSON: () => ipcRenderer.invoke('adsb:getGeoJSON'),
    /** Get detailed info for a single flight */
    getDetails: (id: string) => ipcRenderer.invoke('adsb:getDetails', id),
    /** Get flight counts (total + military) */
    getCount: () => ipcRenderer.invoke('adsb:getCount'),
    /** Start ADS-B polling */
    startPolling: (intervalMs?: number) => ipcRenderer.invoke('adsb:startPolling', intervalMs),
    /** Stop ADS-B polling */
    stopPolling: () => ipcRenderer.invoke('adsb:stopPolling'),
    /** Trigger an immediate poll */
    pollNow: () => ipcRenderer.invoke('adsb:pollNow'),
    /** Subscribe to marker updates pushed from main process */
    onMarkersUpdated: (callback: (markers: unknown[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, markers: unknown[]) => callback(markers)
      ipcRenderer.on('adsb:markersUpdated', handler)
      return () => { ipcRenderer.removeListener('adsb:markersUpdated', handler) }
    },
    /** Subscribe to GeoJSON updates pushed from main process */
    onGeoJSONUpdated: (callback: (geojson: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, geojson: unknown) => callback(geojson)
      ipcRenderer.on('adsb:geojsonUpdated', handler)
      return () => { ipcRenderer.removeListener('adsb:geojsonUpdated', handler) }
    },
    /** Subscribe to flight count updates pushed from main process */
    onFlightCountUpdated: (callback: (counts: { total: number; military: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, counts: { total: number; military: number }) => callback(counts)
      ipcRenderer.on('adsb:flightCountUpdated', handler)
      return () => { ipcRenderer.removeListener('adsb:flightCountUpdated', handler) }
    },
    /** Notify main process about window visibility (skip polls when minimized) */
    setVisible: (visible: boolean) => ipcRenderer.invoke('adsb:set-visible', visible),
    /** Listen for credential error notifications from main process */
    onCredentialsError: (callback: (info: { message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: { message: string }) => callback(info)
      ipcRenderer.on('adsb:credentials-error', handler)
      return () => { ipcRenderer.removeListener('adsb:credentials-error', handler) }
    }
  },

  // ── Aircraft Identification (Phase 4A) ──
  aircraft: {
    /** Manually lookup an ICAO24 hex code (cache → HexDB → callsign fallback) */
    lookup: (icao24: string, callsign?: string) => ipcRenderer.invoke('aircraft:lookup', icao24, callsign),
    /** Get cached aircraft info (no network call) */
    getInfo: (icao24: string) => ipcRenderer.invoke('aircraft:getInfo', icao24)
  },

  // ── AIS / Vessel Tracking ──
  ais: {
    /** Get all live vessel markers for the map */
    getMarkers: () => ipcRenderer.invoke('ais:getMarkers'),
    /** Get vessels as GeoJSON FeatureCollection */
    getGeoJSON: () => ipcRenderer.invoke('ais:getGeoJSON'),
    /** Get detailed info for a single vessel */
    getDetails: (id: string) => ipcRenderer.invoke('ais:getDetails', id),
    /** Get vessel count */
    getCount: () => ipcRenderer.invoke('ais:getCount'),
    /** Get vessel counts by category (total, military, cargo, tanker, passenger) */
    getCountsByCategory: () => ipcRenderer.invoke('ais:getCountsByCategory'),
    /** Get choke point congestion data */
    getChokePoints: () => ipcRenderer.invoke('ais:getChokePoints'),
    /** Start AIS WebSocket streaming */
    startStreaming: () => ipcRenderer.invoke('ais:startStreaming'),
    /** Stop AIS WebSocket streaming */
    stopStreaming: () => ipcRenderer.invoke('ais:stopStreaming'),
    /** Get connection status */
    getStatus: () => ipcRenderer.invoke('ais:getStatus'),
    /** Subscribe to GeoJSON updates pushed from main process */
    onGeoJSONUpdated: (callback: (geojson: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, geojson: unknown) => callback(geojson)
      ipcRenderer.on('ais:geojsonUpdated', handler)
      return () => { ipcRenderer.removeListener('ais:geojsonUpdated', handler) }
    },
    /** Subscribe to vessel count updates pushed from main process */
    onVesselCountUpdated: (callback: (counts: { total: number; military: number; cargo: number; tanker: number; passenger: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, counts: { total: number; military: number; cargo: number; tanker: number; passenger: number }) => callback(counts)
      ipcRenderer.on('ais:vesselCountUpdated', handler)
      return () => { ipcRenderer.removeListener('ais:vesselCountUpdated', handler) }
    },
    /** Subscribe to feed health updates pushed from main process */
    onFeedHealthUpdated: (callback: (health: { connected: boolean; lastMessageAgeMs: number; feedAlive: boolean }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, health: { connected: boolean; lastMessageAgeMs: number; feedAlive: boolean }) => callback(health)
      ipcRenderer.on('ais:feedHealthUpdated', handler)
      return () => { ipcRenderer.removeListener('ais:feedHealthUpdated', handler) }
    }
  },

  // ── Vessel Identification (Phase 4B) ──
  vessel: {
    lookup: (mmsi: string, shipName?: string, shipType?: string) => ipcRenderer.invoke('vessel:lookup', mmsi, shipName, shipType),
    getInfo: (mmsi: string) => ipcRenderer.invoke('vessel:getInfo', mmsi)
  },

  // ── Tactical Events (Phase 4C) ──
  tactical: {
    /** Get tactical events, optionally filtered by status */
    getEvents: (status?: string) => ipcRenderer.invoke('tactical:getEvents', status),
    /** Get active tactical events only */
    getActiveEvents: () => ipcRenderer.invoke('tactical:getActiveEvents'),
    /** Delete tactical events, optionally filtered by event type. Returns deleted count. */
    deleteEvents: (eventType?: string) => ipcRenderer.invoke('tactical:deleteEvents', eventType)
  },

  // ── Carrier Strike Groups (Phase 4F) ──
  carrier: {
    /** Get all carrier groups with vessels */
    getGroups: () => ipcRenderer.invoke('tactical:getCarrierGroups'),
    /** Get a single carrier group by ID with vessel details */
    getGroupById: (id: string) => ipcRenderer.invoke('tactical:getCarrierGroupById', id),
    /** Trigger USNI scrape + AIS match refresh */
    refresh: () => ipcRenderer.invoke('tactical:refreshCarrierData')
  },

  // ── AI Sense-Making (Phase 4E) ──
  sensemaking: {
    /** Trigger a sense-making analysis run */
    run: () => ipcRenderer.invoke('sensemaking:run'),
    /** Get sense-making status (analyses count in last 24h) */
    status: () => ipcRenderer.invoke('sensemaking:status')
  },

  // ── Source Management (Phase 4G) ──
  sources: {
    /** List all scraper sources with status */
    list: () => ipcRenderer.invoke('sources:list'),
    /** Toggle a scraper on/off */
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke('sources:toggle', id, enabled),
    /** Manually trigger a scraper refresh */
    refresh: (id: string) => ipcRenderer.invoke('sources:refresh', id)
  },

  // ── Global Fishing Watch (Phase 4I) ──
  gfw: {
    /** Get latest GFW presence data for all choke points */
    getPresence: () => ipcRenderer.invoke('gfw:get-presence'),
    /** Get GFW data for a specific choke point */
    getPresenceByChokepoint: (chokepoint: string) =>
      ipcRenderer.invoke('gfw:get-presence-by-chokepoint', chokepoint),
    /** Get GFW poll status (last poll times, error states, total records) */
    getStatus: () => ipcRenderer.invoke('gfw:get-status'),
    /** Manually trigger a GFW poll */
    triggerPoll: () => ipcRenderer.invoke('gfw:trigger-poll')
  },

  // ── Social Media (Phase 5A) ──
  social: {
    /** Get social media posts (optionally filtered by source/sourceDetail) */
    getPosts: (limit?: number, source?: 'reddit' | 'bluesky', sourceDetail?: string) =>
      ipcRenderer.invoke('social:posts', limit, source, sourceDetail),
    /** Get social media stats (last fetch times, post counts) */
    getStats: () => ipcRenderer.invoke('social:stats'),
    /** Manually trigger Reddit poll */
    pollReddit: () => ipcRenderer.invoke('social:pollReddit'),
    /** Manually trigger BlueSky poll */
    pollBlueSky: () => ipcRenderer.invoke('social:pollBlueSky')
  },

  // ── Economic Monitoring (Phase 5B) ──
  economic: {
    /** Manually trigger an economic indicator poll */
    poll: () => ipcRenderer.invoke('economic:poll'),
    /** Get all current economic indicators */
    getIndicators: () => ipcRenderer.invoke('economic:getIndicators'),
    /** Get only anomaly-flagged indicators */
    getAnomalies: () => ipcRenderer.invoke('economic:getAnomalies'),
    /** Get economic service status */
    getStatus: () => ipcRenderer.invoke('economic:getStatus'),
    /** Start economic polling */
    start: (intervalMs?: number) => ipcRenderer.invoke('economic:start', intervalMs),
    /** Stop economic polling */
    stop: () => ipcRenderer.invoke('economic:stop')
  },
  // ── Dynamic Conflict Zones ──
  zone: {
    /** List all non-resolved conflict zones */
    list: () => ipcRenderer.invoke('zone:list'),
    /** Get zone detail + evidence items */
    detail: (id: string) => ipcRenderer.invoke('zone:detail', id),
    /** Get resolved zones from last 30 days */
    history: () => ipcRenderer.invoke('zone:history'),
    /** Manually trigger zone engine refresh */
    refresh: () => ipcRenderer.invoke('zone:refresh')
  },

  // ── NOTAM (Military/Defense Airspace Restrictions) ──
  notam: {
    /** List active NOTAMs */
    list: (limit?: number) => ipcRenderer.invoke('notam:list', limit),
    /** Get NOTAMs within a conflict zone's radius */
    byZone: (zoneId: string) => ipcRenderer.invoke('notam:by-zone', zoneId),
    /** Manually trigger NOTAM poll */
    refresh: () => ipcRenderer.invoke('notam:refresh'),
    /** Get NOTAM status */
    status: () => ipcRenderer.invoke('notam:status')
  },

  // ── Alert Rules (Phase 5A) ──
  alertRules: {
    list: () => ipcRenderer.invoke('alert-rules:list'),
    create: (rule: Record<string, unknown>) => ipcRenderer.invoke('alert-rules:create', rule),
    update: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('alert-rules:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('alert-rules:delete', id),
    toggle: (id: string) => ipcRenderer.invoke('alert-rules:toggle', id)
  },

  // ── Notifications ──
  notifications: {
    /** Send a test notification to all enabled channels */
    sendTest: () => ipcRenderer.invoke('notifications:sendTest'),
    /** Get which notification channels are configured and enabled */
    status: () => ipcRenderer.invoke('notifications:status')
  },

  // ── Logger ──
  logger: {
    /** Read the most recent lines from the main-process log file */
    getRecent: (lines?: number) => ipcRenderer.invoke('logger:getRecent', lines)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}