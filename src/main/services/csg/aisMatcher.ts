/**
 * AIS Cross-Reference Matcher (Phase 4F)
 *
 * DISABLED: AIS matching is no longer used for CSG/ARG vessels.
 * USNI/TWZ intel data is authoritative for military vessel positions.
 * AIS data is unreliable for military vessels (transponders often off or spoofed).
 *
 * This file is kept for potential future use with commercial vessel tracking.
 * The validateExistingPositions() function is still used at startup to clean
 * up any stale AIS-sourced positions that may remain in the database.
 */

import { getDatabase } from '../storage/database'
import { AREA_COORDS } from './usniScraper'

// ── Guard helpers (still used by validateExistingPositions) ───

function getDistanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 1.852
}

const TROPICAL_SUBTROPICAL_AREAS = new Set([
  'arabian sea', 'persian gulf', 'red sea', 'gulf of oman', 'centcom', 'centcom aor',
  'strait of hormuz', 'gulf of aden', 'south china sea', 'east china sea',
  'philippine sea', 'indian ocean', 'north arabian sea', 'arabian gulf',
  'bab el-mandeb', 'gulf', 'djibouti', 'bahrain', 'bahrein', 'diego garcia',
  'sulu sea', 'celebes sea', 'mindanao sea', 'gulf of guinea', 'caribbean sea',
  'andaman sea', 'mozambique channel', 'off the coast of africa', 'west africa',
  'horn of africa', 'somali basin', 'eastern pacific', 'western pacific'
])

function isPlausibleLatitudeForArea(lat: number, operatingArea: string | null): boolean {
  if (!operatingArea) return true
  const area = operatingArea.toLowerCase().trim()

  const isTropical = Array.from(TROPICAL_SUBTROPICAL_AREAS).some(zone =>
    area === zone || area.startsWith(zone) || zone.startsWith(area)
  )

  if (!isTropical) return true

  if (lat > 40 || lat < -10) {
    return false
  }
  return true
}

// ── Public API ───────────────────────────────────────────────

/**
 * Run the AIS cross-reference match cycle.
 * DISABLED for CSG/ARG vessels — USNI/TWZ data is authoritative.
 * Returns 0 immediately.
 */
export function runAisMatcher(): number {
  console.log('[CSG-Tracker] AIS matching disabled for CSG/ARG vessels (using USNI/TWZ positions only)')
  return 0
}

// ── Startup cleanup: validate existing positions against guards ──────

/**
 * On AIS matcher startup, validate existing AIS positions against the
 * current guard logic. Clears any positions that would be rejected
 * by the proximity check (e.g., USS Tripoli at 51.3°N when operating
 * area is CENTCOM).
 */
export function validateExistingPositions(): void {
  const db = getDatabase()

  const groups = db.prepare(
    "SELECT id, name, latitude, longitude, source, operating_area FROM carrier_groups WHERE latitude IS NOT NULL"
  ).all() as Array<{
    id: string
    name: string
    latitude: number | null
    longitude: number | null
    source: string
    operating_area: string | null
  }>

  for (const group of groups) {
    if (group.latitude == null || group.longitude == null) continue

    const area = group.operating_area?.toLowerCase()?.trim()
    if (!area) continue

    // Check latitude sanity
    if (!isPlausibleLatitudeForArea(group.latitude, group.operating_area)) {
      console.log(
        `[CSG-Tracker] Startup cleanup: clearing impossible position for ${group.name} ` +
        `(${group.latitude.toFixed(1)}°N is outside tropical/subtropical operating area "${area}")`
      )
      const areaCoords = AREA_COORDS[area]
      db.prepare('UPDATE carrier_groups SET latitude = @lat, longitude = @lon, source = \'usni\' WHERE id = @id')
        .run({ lat: areaCoords?.lat ?? null, lon: areaCoords?.lon ?? null, id: group.id })
      continue
    }

    // Check operating area proximity (use HIGH confidence radius as max tolerance)
    const areaCoords = AREA_COORDS[area]
    if (areaCoords) {
      const distanceNm = getDistanceNm(group.latitude, group.longitude, areaCoords.lat, areaCoords.lon)
      if (distanceNm > 2000) {
        console.log(
          `[CSG-Tracker] Startup cleanup: clearing stale position for ${group.name} ` +
          `(${distanceNm.toFixed(0)}nm from "${area}", resetting to USNI coordinates)`
        )
        db.prepare('UPDATE carrier_groups SET latitude = @lat, longitude = @lon, source = \'usni\' WHERE id = @id')
          .run({ lat: areaCoords.lat, lon: areaCoords.lon, id: group.id })
      }
    }
  }

  // ── One-time fix for Tripoli (csg-lha7): clear impossible positions ──────
  const tripoli = db.prepare("SELECT * FROM carrier_groups WHERE id = 'csg-lha7'").get() as {
    latitude: number | null
    operating_area: string | null
  } | undefined
  if (tripoli && tripoli.latitude != null && tripoli.operating_area?.toLowerCase().includes('centcom')) {
    if (tripoli.latitude > 40 || tripoli.latitude < -10) {
      const areaCoords = AREA_COORDS[tripoli.operating_area.toLowerCase().trim()]
      db.prepare("UPDATE carrier_groups SET latitude = ?, longitude = ?, source = 'usni' WHERE id = 'csg-lha7'")
        .run(areaCoords?.lat ?? null, areaCoords?.lon ?? null)
      console.log(`[CSG-Tracker] Fixed Tripoli position: was ${tripoli.latitude}°N, now at USNI area coordinates`)
    }
  }
}