/**
 * ADS-B / OpenSky Network Service
 *
 * Fetches live aircraft state vectors from the OpenSky Network API,
 * stores them in the `flights` SQLite table, and exposes the latest
 * positions for the renderer map layer.
 *
 * Authentication: OAuth2 client_credentials flow (replaces deprecated Basic auth).
 * Token endpoint: https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
 * Tokens are cached and refreshed 30 seconds before expiry (tokens last ~30 min).
 *
 * API docs: https://openskynetwork.github.io/opensky-api/rest.html
 * Rate limits: 4000 req/day (registered), 100/day (anonymous)
 *
 * Flights table schema (from database.ts):
 *   id, icao24, callsign, origin_country, latitude, longitude,
 *   altitude, velocity, heading, is_military, aircraft_type, timestamp
 */

import { getDatabase } from '../storage/database'
import { config } from '../../utils/config'
import { v4 as uuidv4 } from 'uuid'
import type { Flight, FlightMarker } from '../../../shared/types'
import { batchLookup, getCachedAircraftInfo } from '../identification/aircraftLookup'
import { MILITARY_ORIGIN_COUNTRIES } from '../identification/openSkyImporter'
import { runTacticalAnalysis } from '../identification/tacticalEngine'
import { fetchTatAircraft } from './tatPoller'
import { mergeAircraftData, type MergedAircraft } from './adsbMerger'
import { evaluateRules } from '../alerts/ruleEngine'

// ─── Configuration ───────────────────────────────────────────

/** How often we poll OpenSky (ms) - from config */
const POLL_INTERVAL_MS = config.polling.adsbMs

/**
 * Bounding box for flight data query (lamin, lamax, lomin, lomax).
 * Covers most of the Northern Hemisphere visible from the default map center
 * (Eastern Mediterranean / broader MENA view at zoom 2.2).
 * Includes North America, Europe, North Africa, Middle East, and Central Asia.
 */
const DEFAULT_BBOX = { lamin: 0, lamax: 72, lomin: -130, lomax: 100 }

// ─── OAuth2 Token Management ─────────────────────────────────

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

/** Refresh the token this many seconds before it actually expires. */
const TOKEN_REFRESH_MARGIN_S = 30

/**
 * Manages OAuth2 access tokens for the OpenSky Network API.
 * Uses the client_credentials grant type.
 * OPENSKY_USERNAME → client_id, OPENSKY_PASSWORD → client_secret.
 */
class OpenSkyTokenManager {
  private accessToken: string | null = null
  private expiresAt: number = 0 // epoch-ms when token is considered stale

  /**
   * Return a valid access token, fetching a new one if needed.
   */
  async getToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken
    }
    return this.refresh()
  }

  /**
   * Force-fetch a new access token from the OpenSky auth server.
   */
  private async refresh(): Promise<string | null> {
    const clientId = config.openskyUsername
    const clientSecret = config.openskyPassword

    if (!clientId || !clientSecret) {
      console.warn('[ADSB] No OpenSky credentials in settings — falling back to anonymous access')
      return null
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })

      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')

        if (res.status === 403) {
          consecutiveToken403++
          if (consecutiveToken403 >= 3) {
            console.error(
              `[ADSB] OpenSky credentials rejected (403) ${consecutiveToken403} times. ` +
                `Check OPENSKY_USERNAME and OPENSKY_PASSWORD in .env. ` +
                `Falling back to anonymous access (limited to 100 requests/day).`
            )
            // Send notification to renderer
            notifyCredentialsError()
            // Stop trying to refresh - clearly broken
            this.accessToken = null
            this.expiresAt = 0
            return null
          }
        } else {
          consecutiveToken403 = 0 // Reset on non-403 errors
        }

        console.error(
          `[ADSB] Token request failed (${res.status}): ${text || res.statusText}`
        )
        this.accessToken = null
        this.expiresAt = 0
        return null
      }

      const data = (await res.json()) as {
        access_token: string
        expires_in?: number
        token_type?: string
      }

      // On successful token acquisition, reset the 403 counter
      consecutiveToken403 = 0

      this.accessToken = data.access_token
      const expiresIn = data.expires_in ?? 1800 // default 30 min
      this.expiresAt = Date.now() + (expiresIn - TOKEN_REFRESH_MARGIN_S) * 1000

      console.log(
        `[ADSB] OAuth2 token acquired (expires in ${expiresIn}s, refresh in ${Math.round((this.expiresAt - Date.now()) / 1000)}s)`
      )
      return this.accessToken
    } catch (err) {
      console.error(
        '[ADSB] Token refresh error:',
        err instanceof Error ? err.message : String(err)
      )
      this.accessToken = null
      this.expiresAt = 0
      return null
    }
  }

  /**
   * Build Authorization header object. Returns empty object if no token available.
   */
  async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken()
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }

  /**
   * Invalidate the cached token so the next request fetches a fresh one.
   */
  invalidate(): void {
    this.accessToken = null
    this.expiresAt = 0
  }
}

/** Singleton token manager for the ADS-B service. */
const tokenManager = new OpenSkyTokenManager()

// ─── State ───────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setTimeout> | null = null
let isPolling = false
let consecutive429 = 0
let backoffUntil = 0

// Rate limit tracking
let creditsRemaining: number | null = null
let consecutiveToken403 = 0

// Window visibility - skip polls when minimized
let windowVisible = true

/**
 * Set whether the app window is visible.
 * When hidden (minimized), polls are skipped to conserve API credits.
 */
export function setAdsWindowVisible(visible: boolean): void {
  windowVisible = visible
  if (visible) {
    console.log('[ADSB] Window visible - resuming polling')
  } else {
    console.log('[ADSB] Window minimized - will skip polls')
  }
}

/**
 * Calculate the optimal polling interval based on remaining credits.
 * Returns the interval in milliseconds.
 */
function getAdjustedPollInterval(baseMs: number): number {
  if (creditsRemaining === null) return baseMs

  if (creditsRemaining < 100) {
    // Critical: poll every 5 minutes
    console.warn(`[ADSB] Credits critical (${creditsRemaining} remaining). Slowing to 5min intervals.`)
    return 5 * 60 * 1000
  }

  if (creditsRemaining < 500) {
    // Low: poll every 2 minutes
    console.warn(`[ADSB] Credits low (${creditsRemaining} remaining). Slowing to 2min intervals.`)
    return 2 * 60 * 1000
  }

  if (creditsRemaining < 1000) {
    // Moderate: poll every 90 seconds
    return 90 * 1000
  }

  return baseMs
}

/**
 * Notify the renderer that OpenSky credentials are invalid.
 * Sends via the main window's webContents.
 */
function notifyCredentialsError(): void {
  try {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('adsb:credentials-error', {
        message:
          'OpenSky API credentials are invalid. ADS-B data may be limited. Check .env file.'
      })
    }
  } catch {
    // Window not available
  }
}

// ─── Types for the raw OpenSky response ──────────────────────

/**
 * OpenSky REST API response for /states/all
 * Reference: https://openskynetwork.github.io/opensky-api/rest.html#response
 *
 * Each state vector is an array:
 * [0]  icao24           string
 * [1]  callsign         string | null
 * [2]  origin_country   string
 * [3]  time_position    int | null
 * [4]  last_contact     int
 * [5]  longitude        float | null
 * [6]  latitude         float | null
 * [7]  baro_altitude    float | null  (metres)
 * [8]  on_ground        boolean
 * [9]  velocity         float | null  (m/s)
 * [10] true_track       float | null  (degrees)
 * [11] vertical_rate    float | null  (m/s)
 * [12] sensors          int[] | null
 * [13] geo_altitude     float | null  (metres)
 * [14] squawk           string | null
 * [15] spi              boolean
 * [16] position_source  int
 */
type OpenSkyStateVector = [
  string, string | null, string, number | null, number,
  number | null, number | null, number | null, boolean,
  number | null, number | null, number | null, number[] | null,
  number | null, string | null, boolean, number
]

interface OpenSkyResponse {
  time: number
  states: OpenSkyStateVector[]
}


// ─── API fetch ───────────────────────────────────────────────

/**
 * Fetch aircraft state vectors from OpenSky Network.
 * Uses OAuth2 Bearer token authentication (client_credentials flow).
 * Falls back to anonymous access if no credentials are configured.
 * Implements exponential backoff on 429 responses.
 * On 401, refreshes the token and retries once.
 */
async function fetchStates(): Promise<OpenSkyStateVector[]> {
  // Skip poll if window is not visible
  if (!windowVisible) {
    return [] // Silent skip, no log spam
  }

  // Backoff check - if we've been rate-limited, wait
  const now = Date.now()
  if (backoffUntil > now) {
    return [] // silently skip during backoff
  }

  const { lamin, lamax, lomin, lomax } = DEFAULT_BBOX

  const url = new URL('https://opensky-network.org/api/states/all')
  url.searchParams.set('lamin', String(lamin))
  url.searchParams.set('lamax', String(lamax))
  url.searchParams.set('lomin', String(lomin))
  url.searchParams.set('lomax', String(lomax))

  try {
    const result = await fetchWithAuth(url.toString())

    if (result === null) return [] // error already logged

    // Reset backoff on success
    consecutive429 = 0
    backoffUntil = 0

    return result
  } catch (err) {
    console.error('[ADSB] Fetch error:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * Core fetch logic with OAuth2 Bearer auth, 401 retry, and 429 backoff.
 */
async function fetchWithAuth(
  url: string,
  isRetry: boolean = false
): Promise<OpenSkyStateVector[] | null> {
  // Get OAuth2 Bearer headers (empty object if no credentials → anonymous)
  const headers = await tokenManager.authHeaders()

  const response = await fetch(url, { headers })

  // ── 401 Unauthorized: refresh token and retry once ──
  if (response.status === 401 && !isRetry) {
    console.warn('[ADSB] Got 401 - refreshing OAuth2 token and retrying')
    tokenManager.invalidate()
    return fetchWithAuth(url, true)
  }

  if (response.status === 401 && isRetry) {
    console.error('[ADSB] Still 401 after token refresh - check OPENSKY_USERNAME / OPENSKY_PASSWORD')
    return null
  }

  // ── 429 Rate limited: exponential backoff ──
  if (response.status === 429) {
    consecutive429++
    const backoffSeconds = Math.min(30 * Math.pow(2, consecutive429 - 1), 600)
    backoffUntil = Date.now() + backoffSeconds * 1000
    console.warn(
      `[ADSB] Rate limited (429). Backing off for ${backoffSeconds}s (attempt ${consecutive429})`
    )
    return null
  }

  if (!response.ok) {
    console.error(`[ADSB] OpenSky API returned ${response.status}: ${response.statusText}`)
    return null
  }

  // Track rate limit credits from response headers
  const remaining = response.headers.get('X-Rate-Limit-Remaining')
  if (remaining) {
    creditsRemaining = parseInt(remaining, 10)
  }
  // X-Rate-Limit-Reset header available for future credit reset tracking

  // Log credit status periodically (every 10th poll)
  if (creditsRemaining !== null && creditsRemaining % 10 === 0) {
    console.log(`[ADSB] Credits remaining: ${creditsRemaining}`)
  }

  const data = (await response.json()) as OpenSkyResponse

  if (!data.states || !Array.isArray(data.states)) {
    console.warn('[ADSB] Unexpected response format - no "states" array')
    return null
  }

  return data.states
}

// ─── Parse & store ───────────────────────────────────────────

/** Max HexDB lookups per poll cycle - persistent queue drains across cycles */
const MAX_LOOKUPS_PER_CYCLE = 200

// Module-level queue that persists across poll cycles for uncached hex lookups
let uncachedQueue: Array<{ icao24: string; callsign?: string; originCountry?: string }> = []

/**
 * Clear existing flights and insert fresh batch (two-phase store).
 *
 * Phase 1 (immediate, sync): Store all contacts using cached aircraft_registry
 *   data for military classification and aircraft type. Unknown aircraft get
 *   is_military = 0 until HexDB confirms them.
 *
 * Phase 2 (async, fire-and-forget): Look up uncached aircraft via HexDB,
 *   then UPDATE the flights table for any newly confirmed military contacts.
 *
 * HexDB is the sole source of truth for military classification.
 * No callsign-based classification is used.
 */
function storeMergedStates(merged: MergedAircraft[]): number {
  const db = getDatabase()
  if (!db) return 0

  const nowISO = new Date().toISOString()
  let count = 0

  // Collect uncached hex codes for async HexDB lookup
  const uncachedHexes = new Set<string>()
  const callsignMap = new Map<string, string>()
  const originCountryMap = new Map<string, string>()

  const clearOld = db.prepare(`DELETE FROM flights`)
  const insert = db.prepare(`
    INSERT INTO flights (id, icao24, callsign, origin_country, latitude, longitude, altitude, velocity, heading, is_military, aircraft_type, timestamp)
    VALUES (@id, @icao24, @callsign, @origin_country, @latitude, @longitude, @altitude, @velocity, @heading, @is_military, @aircraft_type, @timestamp)
  `)

  const transaction = db.transaction(() => {
    clearOld.run()

    for (const ac of merged) {
      // Skip if no position data
      if (ac.latitude === null || ac.longitude === null) continue

      const icao24 = ac.icao24
      const callsign = ac.callsign
      const originCountry = ac.origin_country
      const latitude = ac.latitude
      const longitude = ac.longitude
      const altFt = ac.altitude_ft
      const velKts = ac.velocity_kts
      const heading = ac.heading
      const timestamp = nowISO

      // Cache-first: check aircraft_registry for this ICAO24 hex
      const cached = getCachedAircraftInfo(icao24)
      let military: boolean
      let aircraftType: string | null

      if (cached) {
        // Use cached result from aircraft_registry
        military = cached.is_military
        aircraftType = cached.aircraft_type
      } else {
        // No cache - default to non-military, queue for HexDB lookup
        military = false
        aircraftType = null
        uncachedHexes.add(icao24)
        if (callsign) callsignMap.set(icao24, callsign)
        originCountryMap.set(icao24, originCountry)
      }

      insert.run({
        id: uuidv4(),
        icao24,
        callsign,
        origin_country: originCountry,
        latitude,
        longitude,
        altitude: altFt,
        velocity: velKts,
        heading,
        is_military: military ? 1 : 0,
        aircraft_type: aircraftType,
        timestamp
      })
      count++
    }
  })

  transaction()

  // Phase 2: Merge new uncached entries into the persistent queue (dedup by icao24)
  if (uncachedHexes.size > 0) {
    const newEntries = Array.from(uncachedHexes).map((hex) => ({
      icao24: hex,
      callsign: callsignMap.get(hex),
      originCountry: originCountryMap.get(hex)
    }))
    const existingHexes = new Set(uncachedQueue.map((e) => e.icao24))
    for (const entry of newEntries) {
      if (!existingHexes.has(entry.icao24)) {
        uncachedQueue.push(entry)
      }
    }
  }

  // Process from the persistent queue
  if (uncachedQueue.length > 0) {
    processUncachedQueue(db)
  }

  return count
}

/**
 * Score an uncached aircraft by how likely it is to be military.
 * Higher score = higher priority for HexDB lookup.
 *
 * Priority:
 *   4 = Military hex prefix + no callsign       (very high confidence military)
 *   3 = Military hex prefix                      (high confidence military)
 *       No callsign + military-origin country    (very likely military)
 *   2 = No callsign                              (often military)
 *   1 = Military-origin country                  (possible military)
 *   0 = Everything else                          (likely commercial)
 */
function getMilitaryPriorityScore(
  callsign: string | undefined,
  originCountry: string | undefined,
  icao24?: string
): number {
  const noCallsign = !callsign || callsign.trim() === ''
  const isMilCountry = originCountry ? MILITARY_ORIGIN_COUNTRIES.has(originCountry) : false

  // Known military hex prefixes (USAE/USAF ranges)
  const hex = (icao24 || '').toLowerCase().trim()
  const isMilHex = hex.length >= 2 && /^(ae|af)/.test(hex)

  if (isMilHex && noCallsign) return 4  // Highest: mil hex, no callsign
  if (isMilHex) return 3                 // High: mil hex with callsign
  if (noCallsign && isMilCountry) return 3
  if (noCallsign) return 2
  if (isMilCountry) return 1
  return 0
}

/**
 * Process the persistent uncached queue by looking up aircraft via HexDB.
 *
 * The queue carries over between poll cycles so that after a DB wipe,
 * all uncached aircraft eventually get looked up (~15 cycles for 3000 aircraft).
 *
 * Prioritizes likely military candidates (hex prefix, no callsign) so they
 * get looked up first. Respects rate limits (1 req/sec).
 * Updates the flights table and aircraft_registry as results come in.
 */
function processUncachedQueue(
  db: ReturnType<typeof getDatabase>
): void {
  if (!db || uncachedQueue.length === 0) return

  const totalQueued = uncachedQueue.length

  // Sort by military priority (highest first) so likely military get looked up first
  uncachedQueue.sort((a, b) => {
    const scoreA = getMilitaryPriorityScore(a.callsign, a.originCountry, a.icao24)
    const scoreB = getMilitaryPriorityScore(b.callsign, b.originCountry, b.icao24)
    return scoreB - scoreA
  })

  // Take up to MAX_LOOKUPS_PER_CYCLE from the front of the queue
  const toLookup = uncachedQueue.slice(0, MAX_LOOKUPS_PER_CYCLE)

  console.log(
    `[ADSB] Looking up ${toLookup.length}/${totalQueued} queued aircraft via HexDB ` +
    `(queue depth: ${totalQueued})`
  )

  batchLookup(toLookup, MAX_LOOKUPS_PER_CYCLE)
    .then((results) => {
      // Remove processed entries from the persistent queue
      uncachedQueue = uncachedQueue.slice(toLookup.length)

      if (results.size === 0) return

      let newMilitaryCount = 0
      const update = db.prepare(
        `UPDATE flights SET aircraft_type = ?, is_military = ? WHERE icao24 = ?`
      )

      for (const [hex, info] of results) {
        if (info.is_military) {
          newMilitaryCount++
        }
        update.run(info.aircraft_type, info.is_military ? 1 : 0, hex)
      }

      console.log(
        `[ADSB] Looked up ${results.size} aircraft, ` +
        `found ${newMilitaryCount} military contact${newMilitaryCount !== 1 ? 's' : ''}, ` +
        `queue remaining: ${uncachedQueue.length}`
      )
    })
    .catch((err) => {
      console.error(
        '[ADSB] HexDB batch lookup error:',
        err instanceof Error ? err.message : String(err)
      )
    })
}

// ─── GeoJSON generation (main-process side) ─────────────────

/**
 * Lightweight GeoJSON types for flight data transfer to renderer.
 * Using `is_military: number` (0|1) for Mapbox filter compatibility.
 */
export interface FlightFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    id: string
    icao24: string
    callsign: string | null
    origin_country: string
    altitude: number | null
    velocity: number | null
    heading: number | null
    is_military: number // 0 or 1 for Mapbox filter compatibility
    aircraft_type: string | null
    timestamp: string | null
  }
}

export interface FlightFeatureCollection {
  type: 'FeatureCollection'
  features: FlightFeature[]
}

/**
 * Build a GeoJSON FeatureCollection from current flights table.
 * Filtering (military-only etc.) is done on the renderer side via Mapbox layer filters.
 */
export function getFlightGeoJSON(): FlightFeatureCollection {
  const db = getDatabase()
  if (!db) return { type: 'FeatureCollection', features: [] }

  const rows = db
    .prepare(
      `SELECT id, icao24, callsign, origin_country,
              latitude, longitude, altitude, velocity,
              heading, is_military, aircraft_type, timestamp
       FROM flights
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
    )
    .all() as FlightMarker[]

  const features: FlightFeature[] = rows.map((r) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [r.longitude as number, r.latitude as number]
    },
    properties: {
      id: r.id,
      icao24: r.icao24 ?? '',
      callsign: r.callsign,
      origin_country: r.origin_country ?? '',
      altitude: r.altitude,
      velocity: r.velocity,
      heading: r.heading,
      is_military: r.is_military ? 1 : 0,
      aircraft_type: r.aircraft_type,
      timestamp: r.timestamp
    }
  }))

  return { type: 'FeatureCollection', features }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Perform one poll cycle: fetch both sources → merge → store.
 * Returns the number of aircraft stored.
 *
 * Dual-source pipeline:
 *   - OpenSky Network (primary, authenticated)
 *   - TheAirTraffic.com (secondary, free, fills coverage gaps)
 *   Both polls run in parallel; OpenSky wins dedup conflicts.
 */
export async function pollAdsb(): Promise<number> {
  // Run both polls in parallel
  const [openSkyStates, tatAircraft] = await Promise.allSettled([
    fetchStates(),
    fetchTatAircraft()
  ])

  const osStates = openSkyStates.status === 'fulfilled' ? openSkyStates.value : []
  const tatData = tatAircraft.status === 'fulfilled' ? tatAircraft.value : []

  // Merge: OpenSky primary, TAT fills gaps
  const merged = mergeAircraftData(osStates, tatData)

  if (merged.length === 0) return 0

  const stored = storeMergedStates(merged)

  const tatOnly = merged.filter(m => m.source === 'tat').length
  const bothSources = merged.filter(m => m.source === 'both').length
  console.log(
    `[ADSB] OpenSky: ${osStates.length} | TAT: ${tatData.length} | ` +
    `Merged: ${merged.length} (${tatOnly} TAT-only gaps filled, ${bothSources} seen by both)`
  )

  // Run tactical analysis after each poll cycle (debounced internally)
  runTacticalAnalysis().catch((err) =>
    console.error('[ADSB] Tactical analysis error:', err instanceof Error ? err.message : String(err))
  )

  // Evaluate custom alert rules against current aircraft (Phase 5A)
  // Query the flights table to get is_military classification (set by storeMergedStates)
  try {
    const db = getDatabase()
    const aircraft = db.prepare(
      `SELECT icao24 as id, callsign, aircraft_type as type,
              latitude as lat, longitude as lon,
              altitude, velocity as speed, heading,
              is_military, origin_country
       FROM flights`
    ).all() as Record<string, unknown>[]
    evaluateRules('aircraft', aircraft)
  } catch (err) {
    console.error('[ADSB] Rule evaluation error:', err instanceof Error ? err.message : String(err))
  }

  return stored
}

/**
 * Get all "live" flights as minimal markers for the renderer map.
 */
export function getLiveFlightMarkers(): FlightMarker[] {
  const db = getDatabase()
  if (!db) return []

  const rows = db
    .prepare(
      `SELECT id, icao24, callsign, origin_country,
              latitude, longitude, altitude, velocity,
              heading, is_military, aircraft_type, timestamp
       FROM flights
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY timestamp DESC`
    )
    .all() as FlightMarker[]

  return rows
}

/**
 * Get detailed flight info by id.
 */
export function getFlightDetails(id: string): Flight | null {
  const db = getDatabase()
  if (!db) return null

  return db
    .prepare(`SELECT * FROM flights WHERE id = ?`)
    .get(id) as Flight | null
}

/**
 * Get total count of currently tracked flights.
 */
export function getFlightCount(): number {
  const db = getDatabase()
  if (!db) return 0

  const row = db.prepare(`SELECT COUNT(*) as count FROM flights`).get() as { count: number }
  return row.count
}

/**
 * Get count of military flights.
 */
export function getMilitaryFlightCount(): number {
  const db = getDatabase()
  if (!db) return 0

  const row = db
    .prepare(`SELECT COUNT(*) as count FROM flights WHERE is_military = 1`)
    .get() as { count: number }
  return row.count
}

// ─── Polling lifecycle ───────────────────────────────────────

/**
 * Start periodic ADS-B polling.
 * Uses self-rescheduling setTimeout instead of setInterval to allow
 * dynamic interval adjustment based on credit usage.
 */
export function startAdsbPolling(intervalMs: number = POLL_INTERVAL_MS): void {
  if (isPolling) {
    console.warn('[ADSB] Polling already active')
    return
  }

  isPolling = true
  console.log(`[ADSB] Starting polling (base interval: ${intervalMs / 1000}s)`)

  // Fire once immediately
  pollAdsb().catch((err) =>
    console.error('[ADSB] Initial poll error:', err instanceof Error ? err.message : String(err))
  )

  // Use self-rescheduling timeout instead of fixed setInterval
  // This allows dynamic interval adjustment based on credit usage
  const scheduleNext = (): void => {
    const adjustedMs = getAdjustedPollInterval(intervalMs)
    pollTimer = setTimeout(async () => {
      await pollAdsb().catch((err) =>
        console.error('[ADSB] Poll error:', err instanceof Error ? err.message : String(err))
      )
      if (isPolling) scheduleNext()
    }, adjustedMs)
  }
  scheduleNext()
}

/**
 * Stop periodic ADS-B polling.
 */
export function stopAdsbPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  isPolling = false
  console.log('[ADSB] Polling stopped')
}