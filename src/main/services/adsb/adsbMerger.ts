/**
 * ADS-B Data Merger
 *
 * Merges aircraft data from OpenSky (primary) and TheAirTraffic.com (secondary).
 * Deduplicates by ICAO24 hex code. OpenSky wins conflicts.
 */

import type { NormalizedAircraft } from './tatPoller'

// ─── OpenSky state vector type (mirrors adsbService) ────────

/**
 * OpenSky REST API state vector array.
 * [0]  icao24          string
 * [1]  callsign        string | null
 * [2]  origin_country  string
 * [3]  time_position   int | null
 * [4]  last_contact    int
 * [5]  longitude       float | null
 * [6]  latitude        float | null
 * [7]  baro_altitude   float | null  (metres)
 * [8]  on_ground       boolean
 * [9]  velocity        float | null  (m/s)
 * [10] true_track      float | null  (degrees)
 * [11] vertical_rate   float | null  (m/s)
 * [12] sensors         int[] | null
 * [13] geo_altitude    float | null  (metres)
 * [14] squawk          string | null
 * [15] spi             boolean
 * [16] position_source int
 */
type OpenSkyStateVector = [
  string, string | null, string, number | null, number,
  number | null, number | null, number | null, boolean,
  number | null, number | null, number | null, number[] | null,
  number | null, string | null, boolean, number
]

// ─── Merged output ───────────────────────────────────────────

export interface MergedAircraft {
  icao24: string
  callsign: string | null
  origin_country: string
  latitude: number | null
  longitude: number | null
  altitude_ft: number | null
  velocity_kts: number | null
  heading: number | null
  type_code: string | null       // from TheAirTraffic "t" field or null
  registration: string | null    // from TheAirTraffic "r" field or null
  source: 'opensky' | 'tat' | 'both'
}

// ─── Merger ──────────────────────────────────────────────────

/**
 * Merge aircraft data from OpenSky (primary) and TheAirTraffic.com (secondary).
 *
 * Strategy:
 *   1. Insert all OpenSky aircraft (convert units: metres→feet, m/s→knots)
 *   2. Insert TheAirTraffic aircraft only if hex NOT already in map
 *   3. If hex already exists from OpenSky, mark as 'both' but keep OpenSky position
 *   4. Return array of merged values
 *
 * OpenSky wins all conflicts — it is the authoritative source for position data.
 * TheAirTraffic.com enriches with type_code and registration fields.
 */
export function mergeAircraftData(
  openSkyStates: OpenSkyStateVector[],
  tatAircraft: NormalizedAircraft[]
): MergedAircraft[] {
  const map = new Map<string, MergedAircraft>()

  // Pass 1: Insert all OpenSky aircraft (primary source)
  for (const sv of openSkyStates) {
    const icao24 = sv[0].toLowerCase().trim()
    const lat = sv[6] // latitude (index 6)
    const lon = sv[5] // longitude (index 5)

    // Convert altitude from metres to feet
    const baroAltM = sv[7] // baro_altitude in metres
    const altFt = baroAltM !== null ? Math.round(baroAltM * 3.28084) : null

    // Convert velocity from m/s to knots
    const velocityMs = sv[9] // velocity in m/s
    const velKts = velocityMs !== null ? Math.round(velocityMs * 1.94384) : null

    map.set(icao24, {
      icao24,
      callsign: sv[1]?.trim() || null,
      origin_country: sv[2],
      latitude: lat,
      longitude: lon,
      altitude_ft: altFt,
      velocity_kts: velKts,
      heading: sv[10], // true_track in degrees
      type_code: null, // OpenSky doesn't provide ICAO type code
      registration: null, // OpenSky doesn't provide registration
      source: 'opensky'
    })
  }

  // Pass 2: Insert TheAirTraffic aircraft (secondary, fills gaps)
  for (const ac of tatAircraft) {
    const hex = ac.icao24.toLowerCase().trim()
    const existing = map.get(hex)

    if (existing) {
      // Aircraft already seen by OpenSky — enrich with TAT metadata but don't overwrite position
      existing.source = 'both'
      // Enrich with type_code and registration from TAT if not already present
      if (!existing.type_code && ac.type_code) {
        existing.type_code = ac.type_code
      }
      if (!existing.registration && ac.registration) {
        existing.registration = ac.registration
      }
    } else {
      // New aircraft only seen by TheAirTraffic.com
      map.set(hex, {
        icao24: hex,
        callsign: ac.callsign,
        origin_country: ac.origin_country,
        latitude: ac.latitude,
        longitude: ac.longitude,
        altitude_ft: ac.altitude_ft,
        velocity_kts: ac.velocity_kts,
        heading: ac.heading,
        type_code: ac.type_code,
        registration: ac.registration,
        source: 'tat'
      })
    }
  }

  return Array.from(map.values())
}