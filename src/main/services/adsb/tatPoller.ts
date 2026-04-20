/**
 * TheAirTraffic.com ADS-B Poller
 *
 * Free, unauthenticated ADS-B data from globe.theairtraffic.com.
 * Returns tar1090-format JSON with 7,000+ aircraft globally.
 * Must be filtered to our bounding box client-side.
 */

const TAT_URL = 'https://globe.theairtraffic.com/data/aircraft.json'
const TAT_TIMEOUT_MS = 10000
const MAX_SEEN_POS_S = 120 // discard stale positions > 2 min

// Bounding box (same as OpenSky)
const BBOX = { lamin: 0, lamax: 72, lomin: -130, lomax: 100 }

// ─── Raw tar1090 response types ──────────────────────────────

interface TatAircraft {
  hex: string
  type: string | null // "adsb_icao", "mlat", etc.
  flight: string | null // callsign (padded with spaces)
  r: string | null // registration
  t: string | null // ICAO type code (e.g. "C17", "K35R", "C5M")
  alt_baro: number | string | null // altitude in feet OR "ground"
  gs: number | null // ground speed in knots
  track: number | null // heading in degrees
  baro_rate: number | null // vertical rate ft/min
  squawk: string | null
  lat: number | null
  lon: number | null
  seen_pos: number | null // seconds since last position
  category: string | null // ADS-B emitter category
}

// ─── Normalized output ───────────────────────────────────────

/**
 * Normalized aircraft data from TheAirTraffic.com.
 * Can be merged with OpenSky data via adsbMerger.
 */
export interface NormalizedAircraft {
  icao24: string
  callsign: string | null
  origin_country: string // derived from hex prefix or "Unknown"
  latitude: number
  longitude: number
  altitude_ft: number | null // already in feet
  velocity_kts: number | null // already in knots
  heading: number | null
  type_code: string | null // ICAO type code from "t" field
  registration: string | null // from "r" field
  source: 'tat' // source identifier
}

// ─── Hex prefix → country mapping ────────────────────────────

/**
 * ICAO24 hex prefix to country mapping for common ranges.
 * Only includes major military-relevant prefixes.
 */
const HEX_PREFIX_COUNTRY: Array<{ prefix: string; country: string }> = [
  // US military ranges
  { prefix: 'ae', country: 'United States' }, // USAF
  { prefix: 'af', country: 'United States' }, // US Army
  { prefix: 'a0', country: 'United States' }, // Various US
  { prefix: 'a1', country: 'United States' },
  { prefix: 'a2', country: 'United States' },
  { prefix: 'a3', country: 'United States' },
  { prefix: 'a4', country: 'United States' },
  { prefix: 'a5', country: 'United States' },
  { prefix: 'a6', country: 'United States' },
  { prefix: 'a7', country: 'United States' },
  { prefix: 'a8', country: 'United States' },
  { prefix: 'a9', country: 'United States' },
  { prefix: 'aa', country: 'United States' },
  { prefix: 'ab', country: 'United States' },
  { prefix: 'ac', country: 'United States' },
  { prefix: 'ad', country: 'United States' },
  // UK
  { prefix: '40', country: 'United Kingdom' },
  { prefix: '41', country: 'United Kingdom' },
  { prefix: '42', country: 'United Kingdom' },
  { prefix: '43', country: 'United Kingdom' },
  // France
  { prefix: '38', country: 'France' },
  { prefix: '39', country: 'France' },
  { prefix: '3c', country: 'France' },
  { prefix: '3d', country: 'France' },
  { prefix: '3e', country: 'France' },
  { prefix: '3f', country: 'France' },
  // Germany
  { prefix: '3c', country: 'Germany' },
  { prefix: '44', country: 'Germany' },
  { prefix: '45', country: 'Germany' },
  { prefix: '46', country: 'Germany' },
  { prefix: '47', country: 'Germany' },
  // Italy
  { prefix: '32', country: 'Italy' },
  { prefix: '33', country: 'Italy' },
  { prefix: '34', country: 'Italy' },
  { prefix: '35', country: 'Italy' },
  // Spain
  { prefix: '30', country: 'Spain' },
  { prefix: '31', country: 'Spain' },
  // NATO
  { prefix: '50', country: 'NATO' },
  // Russia
  { prefix: '14', country: 'Russia' },
  { prefix: '15', country: 'Russia' },
  { prefix: '15', country: 'Russia' },
  { prefix: 'fe', country: 'Russia' },
  { prefix: 'ff', country: 'Russia' },
  // Turkey
  { prefix: '4b', country: 'Turkey' },
  { prefix: '4c', country: 'Turkey' },
  // Israel
  { prefix: '73', country: 'Israel' },
  { prefix: '74', country: 'Israel' },
  // Japan
  { prefix: '80', country: 'Japan' },
  { prefix: '81', country: 'Japan' },
  { prefix: '84', country: 'Japan' },
  { prefix: '85', country: 'Japan' },
  // China
  { prefix: '70', country: 'China' },
  { prefix: '71', country: 'China' },
  { prefix: '72', country: 'China' },
  { prefix: '75', country: 'China' },
  { prefix: '76', country: 'China' },
  { prefix: '77', country: 'China' },
  { prefix: '78', country: 'China' },
  { prefix: '79', country: 'China' },
  // Canada
  { prefix: 'c0', country: 'Canada' },
  { prefix: 'c1', country: 'Canada' },
  { prefix: 'c2', country: 'Canada' },
  { prefix: 'c3', country: 'Canada' },
  { prefix: 'c4', country: 'Canada' },
  { prefix: 'c5', country: 'Canada' },
  { prefix: 'c6', country: 'Canada' },
  { prefix: 'c7', country: 'Canada' },
  { prefix: 'c8', country: 'Canada' },
  { prefix: 'c9', country: 'Canada' },
  { prefix: 'ca', country: 'Canada' },
  { prefix: 'cb', country: 'Canada' },
  { prefix: 'cc', country: 'Canada' },
  { prefix: 'cd', country: 'Canada' },
  { prefix: 'ce', country: 'Canada' },
  { prefix: 'cf', country: 'Canada' },
  // Australia
  { prefix: '7c', country: 'Australia' },
  { prefix: '7f', country: 'Australia' },
  // Saudi Arabia
  { prefix: '5a', country: 'Saudi Arabia' },
  { prefix: '5b', country: 'Saudi Arabia' },
  // India
  { prefix: '80', country: 'India' },
]

/**
 * Derive origin country from ICAO24 hex prefix.
 * Returns "Unknown" if no match found.
 */
function deriveCountry(hex: string): string {
  const prefix2 = hex.substring(0, 2).toLowerCase()
  for (const entry of HEX_PREFIX_COUNTRY) {
    if (prefix2 === entry.prefix.toLowerCase()) {
      return entry.country
    }
  }
  return 'Unknown'
}

// ─── Main fetch function ─────────────────────────────────────

/**
 * Fetch and normalize aircraft data from TheAirTraffic.com.
 *
 * Filters to bounding box, discards stale positions (>2 min),
 * and normalizes to a format compatible with the ADS-B merger.
 *
 * On error (network, timeout, parse), returns empty array and logs warning.
 */
export async function fetchTatAircraft(): Promise<NormalizedAircraft[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TAT_TIMEOUT_MS)

  try {
    const res = await fetch(TAT_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'IntelBoard/1.0'
      }
    })

    if (!res.ok) {
      console.warn(`[TAT] HTTP ${res.status} from TheAirTraffic.com`)
      return []
    }

    const data = (await res.json()) as { aircraft: TatAircraft[] }

    if (!data.aircraft || !Array.isArray(data.aircraft)) {
      console.warn('[TAT] Unexpected response format – no "aircraft" array')
      return []
    }

    const result: NormalizedAircraft[] = []

    for (const ac of data.aircraft) {
      // Skip if no position
      if (ac.lat === null || ac.lon === null) continue

      // Skip stale positions
      if (ac.seen_pos !== null && ac.seen_pos > MAX_SEEN_POS_S) continue

      // Filter to bounding box
      if (
        ac.lat < BBOX.lamin ||
        ac.lat > BBOX.lamax ||
        ac.lon < BBOX.lomin ||
        ac.lon > BBOX.lomax
      ) {
        continue
      }

      // Skip invalid hex codes
      if (!ac.hex || ac.hex.length < 2) continue

      // Handle alt_baro: can be a number or the string "ground"
      let altFt: number | null = null
      if (typeof ac.alt_baro === 'number') {
        altFt = ac.alt_baro
      } else if (ac.alt_baro !== 'ground' && ac.alt_baro !== null) {
        // Try parsing as number if it's a string representation
        const parsed = Number(ac.alt_baro)
        altFt = isNaN(parsed) ? null : parsed
      }

      result.push({
        icao24: ac.hex.toLowerCase().trim(),
        callsign: ac.flight?.trim() || null,
        origin_country: deriveCountry(ac.hex),
        latitude: ac.lat,
        longitude: ac.lon,
        altitude_ft: altFt,
        velocity_kts: ac.gs ?? null,
        heading: ac.track ?? null,
        type_code: ac.t?.trim() || null,
        registration: ac.r?.trim() || null,
        source: 'tat'
      })
    }

    console.log(`[TAT] Fetched ${result.length} aircraft (from ${data.aircraft.length} total)`)
    return result
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[TAT] Request timed out after 10s')
    } else {
      console.warn(
        '[TAT] Fetch error:',
        err instanceof Error ? err.message : String(err)
      )
    }
    return []
  } finally {
    clearTimeout(timeout)
  }
}