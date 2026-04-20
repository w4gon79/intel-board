/**
 * AIS Cross-Reference Matcher (Phase 4F)
 *
 * Compares live AIS vessel data against known carrier group vessels.
 * When a match is found by vessel name or MMSI, updates the vessel's
 * lat/lon in the carrier_group_vessels table and the group's aggregate
 * position in carrier_groups.
 *
 * Guards prevent wildly wrong positions from overriding USNI data:
 *   Guard 1: Basic position sanity (null island, extreme coords)
 *   Guard 2: Navy MMSI lookup table (prefer known MMSI over name match)
 *   Guard 3: Operating area proximity check (2000nm from USNI area)
 *   Guard 4: Confidence levels (HIGH/MEDIUM/LOW) control position updates
 *
 * Runs on each AIS update cycle (every 5 minutes).
 */

import { getDatabase } from '../storage/database'
import { getVesselGeoJSON } from '../ais/aisService'
import type { VesselFeature } from '../ais/aisService'
import { AREA_COORDS } from './usniScraper'

// ── Name normalization for matching ──────────────────────────

/**
 * Normalize a vessel name for fuzzy matching.
 * Strips prefixes, suffixes, spaces, and converts to uppercase.
 */
function normalizeVesselName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bUSS\b/g, '')
    .replace(/\bUSNS\b/g, '')
    .replace(/\bHMS\b/g, '')
    .replace(/\bJS\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

// ── Guard 1: Position sanity ─────────────────────────────────

function isPlausibleShipPosition(lat: number, lon: number): boolean {
  // Reject null island
  if (lat === 0 && lon === 0) return false
  // Reject positions with extreme coordinates
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false
  return true
}

// ── Guard 2: Navy MMSI lookup table ──────────────────────────

const NAVY_MMSI_LOOKUP: Record<string, string> = {
  // Carriers
  '303862000': 'USS Nimitz CVN-68',
  '303852000': 'USS Eisenhower CVN-69',
  '303842000': 'USS Carl Vinson CVN-70',
  '303832000': 'USS Theodore Roosevelt CVN-71',
  '303822000': 'USS Abraham Lincoln CVN-72',
  '303812000': 'USS George Washington CVN-73',
  '303792000': 'USS John C. Stennis CVN-74',
  '303782000': 'USS Harry S. Truman CVN-75',
  '303772000': 'USS Ronald Reagan CVN-76',
  '303762000': 'USS George H.W. Bush CVN-77',
  '369906000': 'USS Gerald R. Ford CVN-78'
  // Add more as discovered
}

// Reverse lookup: normalized vessel name → MMSI
const NAME_TO_MMSI: Record<string, string> = {}
for (const [mmsi, name] of Object.entries(NAVY_MMSI_LOOKUP)) {
  const normalized = normalizeVesselName(name)
  NAME_TO_MMSI[normalized] = mmsi
}

// ── Guard 3: Operating area proximity check ──────────────────

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

/**
 * Check if an AIS position is within reasonable distance of the vessel's
 * reported operating area. Radius varies by confidence level:
 *   HIGH:   2000nm (MMSI confirmed, ship may have transited)
 *   MEDIUM: 1000nm (less certain, tighter geographic constraint)
 *   LOW:     500nm (name-only match, very tight constraint)
 */
function isWithinOperatingArea(lat: number, lon: number, operatingArea: string | null, confidence: MatchConfidence): boolean {
  if (!operatingArea) return true // No area info, allow the match

  const areaCoords = AREA_COORDS[operatingArea.toLowerCase()]
  if (!areaCoords) return true // Unknown area, allow

  const maxDistanceNm = confidence === 'HIGH' ? 2000 : confidence === 'MEDIUM' ? 1000 : 500
  const distance = getDistanceNm(lat, lon, areaCoords.lat, areaCoords.lon)
  return distance <= maxDistanceNm
}

// ── Guard 3b: Latitude sanity for tropical/subtropical operating areas ──

const TROPICAL_SUBTROPICAL_AREAS = new Set([
  'arabian sea', 'persian gulf', 'red sea', 'gulf of oman', 'centcom', 'centcom aor',
  'strait of hormuz', 'gulf of aden', 'south china sea', 'east china sea',
  'philippine sea', 'indian ocean', 'north arabian sea', 'arabian gulf',
  'bab el-mandeb', 'gulf', 'djibouti', 'bahrain', 'bahrein', 'diego garcia'
])

/**
 * Reject AIS positions that are clearly outside tropical/subtropical operating areas.
 * Catches common false positives like European civilian vessels with same name as US Navy ships.
 */
function isPlausibleLatitudeForArea(lat: number, operatingArea: string | null): boolean {
  if (!operatingArea) return true
  const area = operatingArea.toLowerCase().trim()

  // Check if area matches any tropical/subtropical zone (including partial matches)
  const isTropical = Array.from(TROPICAL_SUBTROPICAL_AREAS).some(zone =>
    area === zone || area.startsWith(zone) || zone.startsWith(area)
  )

  if (!isTropical) return true

  // Operating area is in tropics/subtropics — reject positions clearly outside
  if (lat > 40 || lat < -10) {
    return false
  }
  return true
}

// ── Guard 3c: Known Navy vessel AIS false positive denylist ──────────────

/**
 * Known false positive patterns: vessel name matches civilian ship in European/other waters.
 * For these names, require HIGH confidence (confirmed Navy MMSI) when operating in listed areas.
 */
const KNOWN_FALSE_POSITIVES: Record<string, string[]> = {
  'TRIPOLI': ['arabian sea', 'centcom', 'centcom aor', 'persian gulf', 'red sea', 'gulf of oman', 'north arabian sea'],
  'BOXER': ['pearl harbor', 'hawaii', 'eastern pacific', 'western pacific'],
  'PORTLAND': ['arabian sea', 'centcom', 'centcom aor', 'persian gulf', 'red sea'],
  'BAINBRIDGE': ['red sea', 'arabian sea'],
  'IKE': ['arabian sea', 'red sea'],
  'BUNKER HILL': ['arabian sea', 'red sea', 'persian gulf'],
}

// ── Guard 4: Confidence levels ───────────────────────────────

type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

// ── Match result ─────────────────────────────────────────────

interface MatchResult {
  groupId: string
  groupName: string
  vesselId: string
  vesselName: string
  hullNumber: string | null
  lat: number
  lon: number
  heading: number | null
  speed: number | null
  mmsi: string | null
  confidence: MatchConfidence
}

// ── Public API ───────────────────────────────────────────────

/**
 * Run the AIS cross-reference match cycle.
 * Compares all live AIS vessels against known carrier group vessels.
 * Updates positions for matched vessels.
 *
 * Returns the number of matches found.
 */
export function runAisMatcher(): number {
  const db = getDatabase()

  // Get all carrier group vessels that need position updates
  const groupVessels = db.prepare(`
    SELECT v.id, v.group_id, v.vessel_name, v.hull_number, v.mmsi,
           g.name as group_name, g.designation, g.operating_area
    FROM carrier_group_vessels v
    JOIN carrier_groups g ON v.group_id = g.id
  `).all() as Array<{
    id: string
    group_id: string
    vessel_name: string | null
    hull_number: string | null
    mmsi: string | null
    group_name: string
    designation: string | null
    operating_area: string | null
  }>

  if (groupVessels.length === 0) return 0

  // Get current AIS data
  let aisFeatures: VesselFeature[]
  try {
    const geojson = getVesselGeoJSON()
    aisFeatures = geojson.features
  } catch {
    // AIS service may not be running
    return 0
  }

  if (aisFeatures.length === 0) return 0

  // Build lookup maps for efficient matching
  const matches: MatchResult[] = []

  // Map: normalized AIS name → feature
  const aisByName = new Map<string, VesselFeature>()
  // Map: MMSI → feature
  const aisByMmsi = new Map<string, VesselFeature>()

  for (const feature of aisFeatures) {
    const name = feature.properties.ship_name
    const mmsi = feature.properties.mmsi

    if (name) {
      aisByName.set(normalizeVesselName(name), feature)
    }
    if (mmsi) {
      aisByMmsi.set(mmsi, feature)
    }
  }

  // Match each known carrier group vessel against AIS data
  for (const gv of groupVessels) {
    let matched: VesselFeature | null = null
    let matchedByMmsi = false

    // Strategy 1: Match by known Navy MMSI from lookup table (highest confidence)
    if (!matched && gv.vessel_name) {
      const normalizedName = normalizeVesselName(gv.vessel_name)
      const knownMmsi = NAME_TO_MMSI[normalizedName]
      if (knownMmsi) {
        matched = aisByMmsi.get(knownMmsi) ?? null
        if (matched) matchedByMmsi = true
      }
    }

    // Strategy 2: Match by stored MMSI (exact)
    if (!matched && gv.mmsi) {
      matched = aisByMmsi.get(gv.mmsi) ?? null
      if (matched) matchedByMmsi = true
    }

    // Strategy 3: Match by vessel name (normalized) — lowest confidence
    if (!matched && gv.vessel_name) {
      const normalizedName = normalizeVesselName(gv.vessel_name)
      matched = aisByName.get(normalizedName) ?? null

      // Also try matching hull number (e.g. "EISENHOWER" → "USS EISENHOWER")
      if (!matched && gv.hull_number) {
        // Try just the name part (before hull number)
        const namePart = gv.vessel_name.replace(/USS\s*/i, '').trim().toUpperCase()
        for (const [key, feature] of aisByName) {
          if (key.includes(namePart.replace(/[^A-Z0-9]/g, ''))) {
            matched = feature
            break
          }
        }
      }
    }

    if (!matched) continue

    const matchLat = matched.geometry.coordinates[1]
    const matchLon = matched.geometry.coordinates[0]

    // Guard 1: Basic position sanity
    if (!isPlausibleShipPosition(matchLat, matchLon)) continue

    // Determine confidence BEFORE proximity check (radius depends on confidence)
    let confidence: MatchConfidence = 'LOW'
    if (matchedByMmsi && matched.properties.mmsi && NAVY_MMSI_LOOKUP[matched.properties.mmsi]) {
      confidence = 'HIGH'
    } else if (matchedByMmsi) {
      confidence = 'MEDIUM'
    } else {
      confidence = 'LOW'
    }

    // Guard 3b: Latitude sanity for tropical/subtropical operating areas
    if (!isPlausibleLatitudeForArea(matchLat, gv.operating_area)) {
      console.log(
        `[CSG-Tracker] Rejected AIS match for ${gv.vessel_name}: ` +
        `${matchLat.toFixed(1)}°N is outside tropical/subtropical operating area "${gv.operating_area}"`
      )
      continue
    }

    // Guard 3c: Known false positive denylist (require HIGH confidence for problematic names)
    const vesselNameUpper = gv.vessel_name?.toUpperCase()?.replace(/^USS\s+/, '') ?? ''
    const falsePositiveAreas = KNOWN_FALSE_POSITIVES[vesselNameUpper]
    const areaLower = gv.operating_area?.toLowerCase()?.trim() ?? ''
    if (falsePositiveAreas && confidence !== 'HIGH' && falsePositiveAreas.some(a =>
      areaLower === a || areaLower.startsWith(a) || a.startsWith(areaLower)
    )) {
      console.log(
        `[CSG-Tracker] Rejected AIS match for ${gv.vessel_name}: ` +
        `name matches known civilian vessel, requires HIGH confidence (got ${confidence})`
      )
      continue
    }

    // Guard 3: Proximity to operating area (radius varies by confidence)
    if (!isWithinOperatingArea(matchLat, matchLon, gv.operating_area, confidence)) {
      console.log(
        `[CSG-Tracker] Rejected AIS match for ${gv.vessel_name}: ` +
        `${matchLat.toFixed(1)}°N, ${matchLon.toFixed(1)}°E is outside operating area "${gv.operating_area}" (${confidence} confidence)`
      )
      continue
    }

    matches.push({
      groupId: gv.group_id,
      groupName: gv.group_name,
      vesselId: gv.id,
      vesselName: gv.vessel_name ?? 'Unknown',
      hullNumber: gv.hull_number,
      lat: matchLat,
      lon: matchLon,
      heading: matched.properties.heading,
      speed: matched.properties.speed,
      mmsi: matched.properties.mmsi,
      confidence
    })
  }

  // Update matched vessels in database
  const updateVessel = db.prepare(`
    UPDATE carrier_group_vessels
    SET latitude = @lat,
        longitude = @lon,
        heading = @heading,
        speed = @speed,
        mmsi = COALESCE(@mmsi, carrier_group_vessels.mmsi),
        last_seen = @lastSeen
    WHERE id = @id
  `)

  const now = new Date().toISOString()

  const transaction = db.transaction(() => {
    for (const match of matches) {
      updateVessel.run({
        id: match.vesselId,
        lat: match.lat,
        lon: match.lon,
        heading: match.heading,
        speed: match.speed,
        mmsi: match.mmsi,
        lastSeen: now
      })

      // Update the group's position if this vessel is the flagship (CVN/LHD/LHA)
      const isFlagship = match.hullNumber &&
        (/CVN|CV|LHD|LHA/i.test(match.hullNumber))

      if (isFlagship && match.confidence !== 'LOW') {
        // Determine source based on confidence
        const source = match.confidence === 'HIGH' ? 'ais-confirmed' : 'ais-confirmed'

        db.prepare(`
          UPDATE carrier_groups
          SET latitude = @lat,
              longitude = @lon,
              source = @source,
              last_updated = @now
          WHERE id = @groupId
        `).run({ lat: match.lat, lon: match.lon, source, now, groupId: match.groupId })

        console.log(
          `[CSG-Tracker] ${match.vesselName} ${match.hullNumber ?? ''} AIS position updated (${match.confidence}): ` +
          `${match.lat.toFixed(1)}°N, ${match.lon.toFixed(1)}°E`
        )
      } else if (isFlagship && match.confidence === 'LOW') {
        console.log(
          `[CSG-Tracker] ${match.vesselName} ${match.hullNumber ?? ''} AIS position LOW confidence, ` +
          `not updating group position (${match.lat.toFixed(1)}°N, ${match.lon.toFixed(1)}°E)`
        )
      }
    }

    // For groups without a flagship position, compute centroid from confirmed matches
    const groupIds = [...new Set(matches.map(m => m.groupId))]
    for (const groupId of groupIds) {
      const groupMatches = matches.filter(m => m.groupId === groupId)

      // Only use MEDIUM/HIGH confidence matches for centroid
      const confirmedMatches = groupMatches.filter(m => m.confidence !== 'LOW')

      // Check if group already has an AIS position (from flagship)
      const group = db.prepare('SELECT source FROM carrier_groups WHERE id = ?').get(groupId) as { source: string } | undefined
      if (group?.source === 'ais-confirmed') continue // Flagship already updated it

      // Compute centroid from confirmed escort vessels
      if (confirmedMatches.length > 0) {
        const avgLat = confirmedMatches.reduce((sum, m) => sum + m.lat, 0) / confirmedMatches.length
        const avgLon = confirmedMatches.reduce((sum, m) => sum + m.lon, 0) / confirmedMatches.length

        db.prepare(`
          UPDATE carrier_groups
          SET latitude = @lat,
              longitude = @lon,
              source = 'ais-confirmed',
              last_updated = @now
          WHERE id = @groupId
        `).run({ lat: avgLat, lon: avgLon, now, groupId })

        console.log(
          `[CSG-Tracker] Group ${groupId} position inferred from ${confirmedMatches.length} confirmed AIS positions: ` +
          `${avgLat.toFixed(1)}°N, ${avgLon.toFixed(1)}°E`
        )
      } else if (groupMatches.length > 0) {
        // Only LOW confidence matches — log but don't update group position
        console.log(
          `[CSG-Tracker] Group ${groupId} has ${groupMatches.length} LOW confidence AIS matches, ` +
          `not updating group position`
        )
      }
    }

    // ── Clear stale AIS positions for unmatched vessels ──────────
    const matchedVesselIds = new Set(matches.filter(m => m.confidence !== 'LOW').map(m => m.vesselId))

    for (const gv of groupVessels) {
      if (!matchedVesselIds.has(gv.id)) {
        // Check if this vessel has an AIS position that's now stale
        const vessel = db.prepare('SELECT latitude, longitude FROM carrier_group_vessels WHERE id = ?').get(gv.id) as { latitude: number | null; longitude: number | null } | undefined
        if (vessel && vessel.latitude != null) {
          // Clear the vessel's AIS position (next USNI scrape will reset from operating area)
          db.prepare('UPDATE carrier_group_vessels SET latitude = NULL, longitude = NULL WHERE id = ?').run(gv.id)
          console.log(`[CSG-Tracker] Cleared stale AIS position for ${gv.vessel_name}`)

          // Also check if the group position matches this bad vessel position and reset it
          const group = db.prepare('SELECT latitude, longitude, operating_area FROM carrier_groups WHERE id = ?').get(gv.group_id) as { latitude: number | null; longitude: number | null; operating_area: string | null } | undefined
          if (group && group.latitude != null && group.longitude != null && vessel.longitude != null &&
              Math.abs(group.latitude - vessel.latitude) < 0.1 &&
              Math.abs(group.longitude - vessel.longitude) < 0.1) {
            // Group position came from this bad vessel, reset to operating area
            const areaCoords = group.operating_area ? AREA_COORDS[group.operating_area.toLowerCase().trim()] : null
            if (areaCoords) {
              db.prepare("UPDATE carrier_groups SET latitude = ?, longitude = ?, source = 'usni' WHERE id = ?")
                .run(areaCoords.lat, areaCoords.lon, gv.group_id)
              console.log(`[CSG-Tracker] Reset group ${gv.group_id} to USNI position (matched stale vessel)`)
            }
          }
        }
      }
    }

    // ── Reset groups that lost AIS confirmation ─────────────────
    const allGroupIds = [...new Set(groupVessels.map(gv => gv.group_id))]
    for (const groupId of allGroupIds) {
      const confirmedMatches = matches.filter(m => m.groupId === groupId && m.confidence !== 'LOW')
      if (confirmedMatches.length === 0) {
        const group = db.prepare('SELECT source, operating_area FROM carrier_groups WHERE id = ?').get(groupId) as { source: string; operating_area: string | null } | undefined
        if (group && (group.source === 'ais' || group.source === 'ais-confirmed')) {
          // Reset to USNI operating area
          const areaCoords = group.operating_area ? AREA_COORDS[group.operating_area.toLowerCase()] : null
          if (areaCoords) {
            db.prepare("UPDATE carrier_groups SET latitude = ?, longitude = ?, source = 'usni' WHERE id = ?")
              .run(areaCoords.lat, areaCoords.lon, groupId)
            console.log(`[CSG-Tracker] Reset ${groupId} to USNI position (AIS no longer confirmed)`)
          }
        }
      }
    }
  })

  transaction()

  const highCount = matches.filter(m => m.confidence === 'HIGH').length
  const medCount = matches.filter(m => m.confidence === 'MEDIUM').length
  const lowCount = matches.filter(m => m.confidence === 'LOW').length
  console.log(
    `[CSG-Tracker] AIS match cycle: ${matches.length}/${groupVessels.length} vessels matched ` +
    `(HIGH: ${highCount}, MEDIUM: ${medCount}, LOW: ${lowCount})`
  )
  return matches.length
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
