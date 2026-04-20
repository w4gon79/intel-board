/**
 * GFW (Global Fishing Watch) 4Wings API Service
 *
 * Supplements AISStream.io with satellite AIS data for choke point regions.
 * GFW combines terrestrial AND satellite AIS, filling coverage gaps where
 * land-based receivers are sparse (e.g., Iranian side of Strait of Hormuz).
 *
 * Also polls SAR dataset which detects "dark" vessels with AIS turned off.
 *
 * API docs: https://globalfishingwatch.org/our-apis/documentation
 * Data lag: ~96 hours (not real-time, supplemental only)
 */

import { getDatabase } from '../storage/database'
import { v4 as uuidv4 } from 'uuid'
import { CHOKE_POINTS } from '../ais/aisService'

// ─── Configuration ───────────────────────────────────────────

const GFW_BASE_URL = 'https://gateway.api.globalfishingwatch.org/v3'
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const DATE_RANGE_DAYS = 7 // Poll last 7 days (covers 96h data lag with overlap)
const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 5_000

const DATASETS = {
  presence: 'public-global-presence:latest',
  sar: 'public-global-sar-presence:latest'
} as const

type DatasetKey = keyof typeof DATASETS

// ─── Types ───────────────────────────────────────────────────

/** Actual GFW 4Wings API response entry when grouped by FLAG */
interface GfwGridCell {
  lat: number
  lon: number
  date: string
  flag: string
  hours: number
  vesselIDs: number
}

/** Top-level GFW 4Wings report API response */
interface GfwApiResponse {
  total: number
  entries: Array<Record<string, GfwGridCell[]>>
}

interface GfwPresenceRow {
  id: string
  chokepoint: string
  lat: number
  lon: number
  dataset: string
  hours: number | null
  vessel_count: number | null
  flags: string | null
  vessel_names: string | null
  gear_types: string | null
  mmsi_list: string | null
  polled_at: string
  date_range_start: string | null
  date_range_end: string | null
}

export interface GfwStatus {
  running: boolean
  lastPollTimes: Record<string, string | null>
  errors: Record<string, string | null>
  totalRecords: number
}

// ─── State ───────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null
let isRunning = false
let lastPollTimes: Record<string, string> = {}
let errors: Record<string, string> = {}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Convert a choke point center + radiusKm to a bounding box polygon
 * suitable for the GFW 4Wings API.
 */
function chokepointToPolygon(cp: { lat: number; lon: number; radiusKm: number }): number[][] {
  const latDelta = cp.radiusKm / 111 // ~111km per degree latitude
  const lonDelta = cp.radiusKm / (111 * Math.cos((cp.lat * Math.PI) / 180))
  return [
    [cp.lon - lonDelta, cp.lat - latDelta],
    [cp.lon + lonDelta, cp.lat - latDelta],
    [cp.lon + lonDelta, cp.lat + latDelta],
    [cp.lon - lonDelta, cp.lat + latDelta],
    [cp.lon - lonDelta, cp.lat - latDelta] // close polygon
  ]
}

/**
 * Sleep for retry backoff with exponential delay.
 */
async function retryDelay(attempt: number): Promise<void> {
  const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt), 60_000)
  console.log(`[GFW] Retry attempt ${attempt + 1}, waiting ${Math.round(delay / 1000)}s...`)
  await new Promise((resolve) => setTimeout(resolve, delay))
}

// ─── API Calls ───────────────────────────────────────────────

/**
 * Poll the GFW 4Wings Report API for a single choke point and dataset.
 */
async function pollGfwReport(
  _chokepointName: string,
  polygon: number[][],
  datasetKey: DatasetKey,
  dateRangeStart: Date,
  dateRangeEnd: Date
): Promise<GfwGridCell[]> {
  const token = process.env.GFW_API_TOKEN
  if (!token) {
    throw new Error('GFW_API_TOKEN not configured')
  }

  const datasetId = DATASETS[datasetKey]

  // GFW v3 4Wings API requires ALL params as URL query params.
  // Only the geojson polygon goes in the POST body.
  const params = new URLSearchParams({
    'datasets[0]': datasetId,
    'date-range': `${dateRangeStart.toISOString()},${dateRangeEnd.toISOString()}`,
    'spatial-resolution': 'HIGH',
    'format': 'JSON',
    'temporal-resolution': 'ENTIRE',
    'group-by': 'FLAG'
  })

  const body = {
    geojson: {
      type: 'Polygon' as const,
      coordinates: [polygon]
    }
  }

  const url = `${GFW_BASE_URL}/4wings/report?${params.toString()}`

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      })

      if (response.status === 429) {
        // Rate limited — back off and retry
        console.warn('[GFW] Rate limited (429), backing off...')
        await retryDelay(attempt)
        continue
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`GFW API error ${response.status}: ${text.slice(0, 200)}`)
      }

      const data = (await response.json()) as GfwApiResponse

      // Response format: { total, entries: [ { "<resolved-dataset-id>": [...] } ] }
      // The response key uses the resolved version (e.g., "public-global-presence:v4.0"),
      // not the "latest" alias we sent. Grab the first key of entries[0].
      if (!data.entries?.length) {
        return []
      }

      const firstEntry = data.entries[0]
      const resolvedKey = Object.keys(firstEntry)[0]
      if (!resolvedKey || !firstEntry[resolvedKey]) {
        return []
      }

      return firstEntry[resolvedKey]
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES - 1) {
        await retryDelay(attempt)
      }
    }
  }

  throw lastError ?? new Error('GFW API request failed after retries')
}

// ─── Storage ─────────────────────────────────────────────────

/**
 * Store GFW grid cell results in the database.
 * Replaces previous data for the same chokepoint + dataset + poll batch.
 */
function storeResults(
  chokepointName: string,
  datasetKey: DatasetKey,
  cells: GfwGridCell[],
  dateRangeStart: Date,
  dateRangeEnd: Date
): number {
  const db = getDatabase()
  const polledAt = new Date().toISOString()

  // Delete previous data for this chokepoint + dataset combination
  db.prepare('DELETE FROM gfw_presence WHERE chokepoint = ? AND dataset = ?')
    .run(chokepointName, datasetKey)

  const insert = db.prepare(`
    INSERT INTO gfw_presence (id, chokepoint, lat, lon, dataset, hours, vessel_count,
      flags, vessel_names, gear_types, mmsi_list, polled_at, date_range_start, date_range_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let inserted = 0
  const transaction = db.transaction(() => {
    for (const cell of cells) {
      // Skip cells with no meaningful data (zero hours and zero vessels)
      if (cell.hours === 0 && cell.vesselIDs === 0) continue

      insert.run(
        uuidv4(),
        chokepointName,
        cell.lat,
        cell.lon,
        datasetKey,
        cell.hours ?? null,
        cell.vesselIDs ?? null,
        cell.flag ? cell.flag : null,                   // single flag string (grouped by FLAG)
        null,                                           // vessel_names — not available in FLAG grouping
        null,                                           // gear_types — not available in FLAG grouping
        null,                                           // mmsi_list — not available in FLAG grouping
        polledAt,
        dateRangeStart.toISOString(),
        dateRangeEnd.toISOString()
      )
      inserted++
    }
  })

  transaction()
  return inserted
}

// ─── Main Poll Logic ─────────────────────────────────────────

/**
 * Poll all choke points for both presence and SAR datasets.
 */
async function pollAllChokepoints(): Promise<void> {
  const now = new Date()
  const dateRangeStart = new Date(now.getTime() - DATE_RANGE_DAYS * 24 * 60 * 60 * 1000)

  console.log(`[GFW] Starting poll for ${CHOKE_POINTS.length} choke points...`)

  for (const cp of CHOKE_POINTS) {
    const polygon = chokepointToPolygon(cp)

    for (const datasetKey of Object.keys(DATASETS) as DatasetKey[]) {
      const key = `${cp.name}:${datasetKey}`
      try {
        console.log(`[GFW] Polling ${key}...`)
        const cells = await pollGfwReport(cp.name, polygon, datasetKey, dateRangeStart, now)

        if (cells.length > 0) {
          const inserted = storeResults(cp.name, datasetKey, cells, dateRangeStart, now)
          console.log(`[GFW] ${key}: ${cells.length} grid cells, ${inserted} stored`)
        } else {
          console.log(`[GFW] ${key}: no data returned`)
        }

        lastPollTimes[key] = new Date().toISOString()
        delete errors[key]
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[GFW] ${key} error: ${msg}`)
        errors[key] = msg
      }
    }
  }

  console.log('[GFW] Poll cycle complete')
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Get all GFW presence data, grouped by chokepoint.
 */
export function getGfwPresence(): GfwPresenceRow[] {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM gfw_presence ORDER BY chokepoint, dataset, vessel_count DESC'
  ).all() as GfwPresenceRow[]
}

/**
 * Get GFW presence data for a specific choke point.
 */
export function getGfwPresenceByChokepoint(chokepointName: string): GfwPresenceRow[] {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM gfw_presence WHERE chokepoint = ? ORDER BY dataset, vessel_count DESC'
  ).all(chokepointName) as GfwPresenceRow[]
}

/**
 * Get GFW data as GeoJSON for map rendering.
 */
export function getGfwGeoJSON(): {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: {
      id: string
      chokepoint: string
      dataset: string
      hours: number | null
      vessel_count: number | null
      flags: string | null
      vessel_names: string | null
      gear_types: string | null
    }
  }>
} {
  const db = getDatabase()
  const rows = db.prepare(
    'SELECT * FROM gfw_presence ORDER BY vessel_count DESC'
  ).all() as GfwPresenceRow[]

  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [row.lon, row.lat] as [number, number]
      },
      properties: {
        id: row.id,
        chokepoint: row.chokepoint,
        dataset: row.dataset,
        hours: row.hours,
        vessel_count: row.vessel_count,
        flags: row.flags,
        vessel_names: row.vessel_names,
        gear_types: row.gear_types
      }
    }))
  }
}

/**
 * Get GFW poll status.
 */
export function getGfwStatus(): GfwStatus {
  const db = getDatabase()
  let totalRecords = 0
  try {
    const result = db.prepare('SELECT COUNT(*) as c FROM gfw_presence').get() as { c: number }
    totalRecords = result.c
  } catch {
    totalRecords = 0
  }

  return {
    running: isRunning,
    lastPollTimes,
    errors,
    totalRecords
  }
}

/**
 * Manually trigger a poll (for testing / UI button).
 */
export async function triggerGfwPoll(): Promise<{ success: boolean; message: string }> {
  try {
    await pollAllChokepoints()
    return { success: true, message: 'GFW poll completed successfully' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: `GFW poll failed: ${msg}` }
  }
}

/**
 * Start the GFW polling scheduler.
 * Polls all choke points every 6 hours.
 */
export function startGfwScheduler(): void {
  if (isRunning) {
    console.warn('[GFW] Scheduler already running')
    return
  }

  const token = process.env.GFW_API_TOKEN
  if (!token) {
    console.warn('[GFW] No GFW_API_TOKEN configured — GFW service disabled')
    return
  }

  console.log('[GFW] Starting scheduler (6-hour interval)')
  isRunning = true

  // Initial poll
  pollAllChokepoints().catch((err) =>
    console.error('[GFW] Initial poll error:', err instanceof Error ? err.message : String(err))
  )

  // Schedule recurring polls
  pollTimer = setInterval(() => {
    pollAllChokepoints().catch((err) =>
      console.error('[GFW] Scheduled poll error:', err instanceof Error ? err.message : String(err))
    )
  }, POLL_INTERVAL_MS)
}

/**
 * Stop the GFW polling scheduler.
 */
export function stopGfwScheduler(): void {
  console.log('[GFW] Stopping scheduler')
  isRunning = false

  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}