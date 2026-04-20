/**
 * Aircraft Identification via ICAO24 Hex Lookup (Phase 4A)
 *
 * Resolves military aircraft ICAO24 hex codes to actual aircraft types
 * (C-17, F-16, KC-135, etc.) using a cache-then-network strategy.
 *
 * Lookup strategy:
 *   1. Check local aircraft_registry SQLite cache
 *   2. If not cached, query HexDB.io: GET https://hexdb.io/api/v1/aircraft/{hex}
 *   3. Parse response, determine military status from operator data
 *   4. Store in cache
 *   5. Rate limit: max 1 request per second to HexDB
 *
 * HexDB is the sole source of truth for military classification.
 * No static type-code matching. No callsign-based classification.
 */

import { getDatabase } from '../storage/database'

// ─── Types ───────────────────────────────────────────────────

export interface AircraftInfo {
  icao24: string
  aircraft_type: string | null
  icao_type_code: string | null
  manufacturer: string | null
  registration: string | null
  operator: string | null
  is_military: boolean
}

interface HexDbResponse {
  ICAOTypeCode?: string
  Manufacturer?: string
  ModeS?: string
  OperatorFlagCode?: string
  RegisteredOwners?: string
  Registration?: string
  Type?: string
}

// ─── Operator-based military classification ──────────────────

/**
 * Check if an operator string matches known military operators.
 * Used after HexDB lookup to confirm military classification.
 * HexDB is the sole source of truth — no static type-code matching.
 */
export function isMilitaryOperator(operator: string | null): boolean {
  if (!operator) return false
  const op = operator.toUpperCase()
  const militaryKeywords = [
    // Abbreviations
    'AIR FORCE', 'USAF', 'US NAVY', 'USN', 'US ARMY', 'USARMY',
    'US MARINE', 'USMC', 'US COAST GUARD', 'USCG',
    'NATIONAL GUARD', 'AIR NATIONAL GUARD', 'ANG',
    // Full names (HexDB returns these)
    'UNITED STATES ARMY', 'UNITED STATES NAVY',
    'UNITED STATES AIR FORCE', 'UNITED STATES MARINE CORPS',
    'UNITED STATES COAST GUARD',
    // Foreign armies
    'FRENCH ARMY',
    'ROYAL AIR FORCE', 'RAF', 'ROYAL NAVY', 'ROYAL AUSTRALIAN AIR FORCE',
    'ARMEE DE L', 'MARINE NATIONALE', 'LUFTWAFFE',
    'RUSSIAN AIR FORCE', 'RUSSIAN NAVY', 'RUSSIAN FEDERATION',
    'PEOPLE\'S LIBERATION ARMY', 'PLAAF', 'PLAN',
    'NATO', 'ISRAEL AIR FORCE', 'IAF', 'ISRAEL DEFENSE',
    'TURKISH AIR FORCE', 'TURKISH ARMED FORCES', 'TURKISH ARMY',
    'TURKISH NAVY', 'TUAF', 'TURK HAVA KUVVETLERI',
    'REPUBLIC OF KOREA AIR',
    'JAPAN AIR SELF', 'JASDF', 'JAPAN MARITIME',
    'ROYAL CANADIAN AIR', 'RCAF',
    'SPANISH AIR', 'EJERCITO DEL AIRE',
    'ITALIAN AIR FORCE', 'AERONAUTICA MILITARE',
  ]

  return militaryKeywords.some(kw => {
    // Use word boundary matching to prevent false positives
    // "ANG" should match "ANG" or "TEXAS ANG" but NOT "BANGLA"
    // "RAF" should match "RAF" or "RAF CLUB" but NOT "CRAFT"
    const regex = new RegExp('(?:^|[^A-Z])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[^A-Z]|$)')
    return regex.test(op)
  })
}

// ─── Callsign-based fallback ─────────────────────────────────

const CALLSIGN_TYPE_MAP: Record<string, string> = {
  REACH: 'C-17A/C-5M',
  RCH: 'C-17A/C-5M',
  DUKE: 'F-15 Eagle',
  EVAC: 'C-130 Hercules',
  VIPER: 'F-16 Fighting Falcon',
  FORGE: 'KC-135 Stratotanker',
  DRAG: 'KC-135/KC-46',
  GRIM: 'MQ-9 Reaper',
  QID: 'RQ-4 Global Hawk',
  SENTRY: 'E-3 AWACS',
  NEEDED: 'KC-135/KC-46',
  TIGER: 'F-5/F-16',
  TORN: 'Panavia Tornado',
  TYPHN: 'Eurofighter Typhoon'
}

// ─── Rate limiting ───────────────────────────────────────────

let lastRequestTime = 0
const MIN_REQUEST_INTERVAL_MS = 1100 // Slightly over 1s for safety

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now()
  const wait = Math.max(0, lastRequestTime + MIN_REQUEST_INTERVAL_MS - now)
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  lastRequestTime = Date.now()
  return fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'IntelBoard/1.0'
    }
  })
}

// ─── SQLite bind safety ──────────────────────────────────────

/**
 * SQLite can only bind numbers, strings, bigints, buffers, and null.
 * Replace any `undefined` values with `null` before binding.
 */
function nullify(obj: AircraftInfo): AircraftInfo {
  const result: Record<string, unknown> = { ...obj }
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) {
      result[key] = null
    }
    // Convert booleans to 0/1 for SQLite
    if (typeof result[key] === 'boolean') {
      result[key] = result[key] ? 1 : 0
    }
  }
  return result as unknown as AircraftInfo
}

// ─── Cache helpers ───────────────────────────────────────────

function getCached(icao24: string): AircraftInfo | null {
  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT icao24, aircraft_type, icao_type_code, manufacturer,
              registration, operator, is_military
       FROM aircraft_registry WHERE icao24 = ?`
    )
    .get(icao24) as AircraftInfo | undefined

  return row ?? null
}

function upsert(info: AircraftInfo): void {
  const db = getDatabase()
  const safe = nullify(info)
  console.log('[AircraftLookup] upsert:', JSON.stringify(safe))
  db.prepare(`
    INSERT INTO aircraft_registry (icao24, aircraft_type, icao_type_code, manufacturer, registration, operator, is_military, looked_up_at)
    VALUES (@icao24, @aircraft_type, @icao_type_code, @manufacturer, @registration, @operator, @is_military, datetime('now'))
    ON CONFLICT(icao24) DO UPDATE SET
      aircraft_type = @aircraft_type,
      icao_type_code = @icao_type_code,
      manufacturer = @manufacturer,
      registration = @registration,
      operator = @operator,
      is_military = @is_military,
      looked_up_at = datetime('now')
  `).run(safe)
}

// ─── HexDB lookup ────────────────────────────────────────────

async function lookupHexDb(icao24: string): Promise<AircraftInfo | null> {
  try {
    const url = `https://hexdb.io/api/v1/aircraft/${icao24}`
    const res = await rateLimitedFetch(url)

    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[AircraftLookup] HexDB returned ${res.status} for ${icao24}`)
      }
      return null
    }

    const data = (await res.json()) as HexDbResponse

    if (!data.Type && !data.ICAOTypeCode && !data.Registration) {
      return null // Empty response
    }

    const icaoTypeCode = data.ICAOTypeCode?.trim() || null

    // Determine if military from operator data only (HexDB is the sole classifier)
    const operatorStr = (data.RegisteredOwners ?? data.OperatorFlagCode ?? '').trim()
    const isMil = isMilitaryOperator(operatorStr)

    const info: AircraftInfo = {
      icao24,
      aircraft_type: data.Type?.trim() || null,
      icao_type_code: icaoTypeCode,
      manufacturer: data.Manufacturer?.trim() || null,
      registration: data.Registration?.trim() || null,
      operator: operatorStr || null,
      is_military: isMil
    }

    return info
  } catch (err) {
    console.error(
      `[AircraftLookup] HexDB error for ${icao24}:`,
      err instanceof Error ? err.message : String(err)
    )
    return null
  }
}

// ─── Callsign-based fallback ─────────────────────────────────

function lookupByCallsign(icao24: string, callsign: string): AircraftInfo | null {
  const cs = callsign.trim().toUpperCase()

  for (const [prefix, aircraftType] of Object.entries(CALLSIGN_TYPE_MAP)) {
    if (cs.startsWith(prefix)) {
      return {
        icao24,
        aircraft_type: aircraftType,
        icao_type_code: null,
        manufacturer: null,
        registration: null,
        operator: null,
        is_military: true
      }
    }
  }

  return null
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Look up aircraft info by ICAO24 hex code.
 * Strategy: cache → HexDB → callsign fallback.
 *
 * @param icao24   Lowercase hex string (e.g. "ae1463")
 * @param callsign Optional callsign for fallback identification
 */
export async function lookupAircraft(
  icao24: string,
  callsign?: string
): Promise<AircraftInfo | null> {
  const hex = icao24.toLowerCase().trim()

  // 1. Check cache
  const cached = getCached(hex)
  if (cached) return cached

  // 2. Try HexDB
  const hexDbResult = await lookupHexDb(hex)
  if (hexDbResult) {
    upsert(hexDbResult)
    return hexDbResult
  }

  // 3. Fallback: callsign-based guess
  if (callsign) {
    const callsignResult = lookupByCallsign(hex, callsign)
    if (callsignResult) {
      upsert(callsignResult)
      return callsignResult
    }
  }

  // 4. Cache a negative result so we don't keep hitting HexDB
  const negative: AircraftInfo = {
    icao24: hex,
    aircraft_type: null,
    icao_type_code: null,
    manufacturer: null,
    registration: null,
    operator: null,
    is_military: false
  }
  upsert(negative)
  return null
}

/**
 * Get cached aircraft info (no network call).
 * Used by IPC handlers for quick lookups from the renderer.
 */
export function getCachedAircraftInfo(icao24: string): AircraftInfo | null {
  return getCached(icao24.toLowerCase().trim())
}

/**
 * Batch lookup multiple ICAO24 codes that are NOT already cached.
 * Rate-limited to 1 req/s, max `maxLookups` per call.
 * Returns map of icao24 → AircraftInfo for successfully resolved codes.
 */
export async function batchLookup(
  icao24Codes: Array<{ icao24: string; callsign?: string }>,
  maxLookups: number = 10
): Promise<Map<string, AircraftInfo>> {
  const results = new Map<string, AircraftInfo>()

  // Filter to only uncached codes
  const uncached = icao24Codes.filter(({ icao24 }) => !getCached(icao24.toLowerCase().trim()))

  const toLookup = uncached.slice(0, maxLookups)

  for (const { icao24, callsign } of toLookup) {
    const info = await lookupAircraft(icao24, callsign)
    if (info) {
      results.set(icao24.toLowerCase().trim(), info)
    }
  }

  return results
}