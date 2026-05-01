/**
 * Dynamic Conflict Zone Engine
 *
 * Creates, maintains, and removes conflict zones based on real-time
 * intelligence signals. Replaces the static conflict-zones.json system.
 *
 * Signal Sources (weighted by reliability):
 *   - tactical_events (weight: 3.0)
 *   - anomalies (weight: 2.0)
 *   - articles (weight: 1.5)
 *   - flights (weight: 1.0)
 *   - vessels (weight: 1.0)
 *   - intel_items (weight: 2.5)
 *   - notams (weight: 2.5)
 *
 * Uses DBSCAN clustering (epsilon=200nm, min_samples=3) to group signals.
 * Zones decay by 0.85x each cycle, die naturally without fresh intelligence.
 */

import { getDatabase } from '../storage/database'

// ── Types ──────────────────────────────────────────────────

export interface ConflictZoneRow {
  id: string
  name: string
  status: 'active' | 'escalating' | 'monitoring' | 'fading' | 'resolved'
  heat_score: number
  center_lat: number
  center_lon: number
  radius_nm: number
  polygon_json: string | null
  sensitivity: 'high' | 'medium' | 'low'
  signal_count: number
  source_types: string
  evidence_ids: string
  last_signal_at: string | null
  created_at: string
  updated_at: string
  expires_at: string | null
}

interface Signal {
  lat: number
  lon: number
  weight: number
  sourceType: string
  evidenceId: string
  timestamp: string
}

interface Cluster {
  signals: Signal[]
  centerLat: number
  centerLon: number
  radiusNm: number
  heatScore: number
  sourceTypes: Set<string>
  evidenceIds: string[]
}

// ── Constants ──────────────────────────────────────────────

const DECAY_FACTOR = 0.85
const CREATION_THRESHOLD = 5.0
const RESOLVED_THRESHOLD = 2.0
const ESCALATING_THRESHOLD = 25.0
const RAPID_ESCALATION_FACTOR = 1.5
const DBSCAN_EPSILON_NM = 200
const DBSCAN_MIN_SAMPLES = 3
const MERGE_DISTANCE_NM = 300
const BUFFER_NM = 50

const SIGNAL_WEIGHTS: Record<string, number> = {
  tactical_events: 3.0,
  anomalies: 2.0,
  articles: 1.5,
  flights: 1.0,
  vessels: 1.0,
  intel_items: 2.5,
  notams: 2.5
}

// ── Utility ────────────────────────────────────────────────

function haversineDistanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 1.852
}

// ── Home Territory Filtering ───────────────────────────────

const HOME_TERRITORY: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  US: { latMin: 24, latMax: 50, lonMin: -125, lonMax: -66 },
  Canada: { latMin: 42, latMax: 83, lonMin: -141, lonMax: -52 },
  UK: { latMin: 49, latMax: 61, lonMin: -8, lonMax: 2 },
  France: { latMin: 42, latMax: 51, lonMin: -5, lonMax: 8 },
  Germany: { latMin: 47, latMax: 55, lonMin: 5, lonMax: 15 },
  Italy: { latMin: 36, latMax: 47, lonMin: 6, lonMax: 19 },
  Spain: { latMin: 36, latMax: 44, lonMin: -10, lonMax: 4 },
  Turkey: { latMin: 36, latMax: 42, lonMin: 26, lonMax: 45 },
  Australia: { latMin: -44, latMax: -10, lonMin: 113, lonMax: 155 },
  Japan: { latMin: 30, latMax: 46, lonMin: 128, lonMax: 146 },
  // Russia intentionally excluded - military flights over Russia near conflict zones ARE significant
}

const ISO_CODE_MAP: Record<string, string> = {
  'US': 'USA', 'Canada': 'CAN', 'UK': 'GBR', 'France': 'FRA',
  'Germany': 'DEU', 'Italy': 'ITA', 'Spain': 'ESP', 'Turkey': 'TUR',
  'Australia': 'AUS', 'Japan': 'JPN'
}

const HOME_PORT_REGIONS = [
  { name: 'Norfolk', lat: 36.9, lon: -76.3, radiusNm: 100 },
  { name: 'San Diego', lat: 32.7, lon: -117.2, radiusNm: 100 },
  { name: 'Portsmouth', lat: 50.8, lon: -1.1, radiusNm: 50 },
  { name: 'Toulon', lat: 43.1, lon: 5.9, radiusNm: 50 },
  { name: 'Yokosuka', lat: 35.3, lon: 139.7, radiusNm: 50 },
]

function isOverHomeTerritory(lat: number, lon: number, originCountry: string | null): boolean {
  if (!originCountry) return false
  const countryKey = originCountry.toUpperCase()
  for (const [name, box] of Object.entries(HOME_TERRITORY)) {
    if (countryKey === name.toUpperCase() || countryKey === (ISO_CODE_MAP[name] || name)) {
      return lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax
    }
  }
  return false
}

function isNearHomePort(lat: number, lon: number): boolean {
  return HOME_PORT_REGIONS.some(port =>
    haversineDistanceNm(lat, lon, port.lat, port.lon) <= port.radiusNm
  )
}

function recencyFactor(timestamp: string): number {
  const ageMs = Date.now() - new Date(timestamp).getTime()
  const ageHours = ageMs / (1000 * 60 * 60)
  if (ageHours < 6) return 1.0
  if (ageHours < 12) return 0.7
  if (ageHours < 24) return 0.4
  return 0.2
}

function deriveZoneId(lat: number, lon: number): string {
  return `zone-${Math.round(lat)}-${Math.round(lon)}`
}

function deriveZoneName(lat: number, lon: number): string {
  return `Dynamic Zone ${Math.round(lat)}\u00B0N ${Math.round(lon)}\u00B0E`
}

// ── Signal Gathering ───────────────────────────────────────

function gatherSignals(): Signal[] {
  const db = getDatabase()
  const signals: Signal[] = []

  // Tactical events (last 24h, with lat/lon)
  try {
    const rows = db.prepare(`
      SELECT id, latitude, longitude, detected_at FROM tactical_events
      WHERE status = 'active'
        AND datetime(detected_at) > datetime('now', '-24 hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
    `).all() as Array<{ id: string; latitude: number; longitude: number; detected_at: string }>
    for (const r of rows) {
      signals.push({ lat: r.latitude, lon: r.longitude, weight: SIGNAL_WEIGHTS.tactical_events, sourceType: 'tactical', evidenceId: r.id, timestamp: r.detected_at })
    }
  } catch { /* table may not exist yet */ }

  // Flights - military aircraft density (last 6h, sampled)
  try {
    const rows = db.prepare(`
      SELECT icao24, latitude, longitude, timestamp, origin_country FROM flights
      WHERE is_military = 1
        AND datetime(timestamp) > datetime('now', '-6 hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY icao24
    `).all() as Array<{ icao24: string; latitude: number; longitude: number; timestamp: string; origin_country: string | null }>
    for (const r of rows) {
      // Skip military aircraft over their own country - these are routine training/transit
      if (isOverHomeTerritory(r.latitude, r.longitude, r.origin_country)) continue
      signals.push({ lat: r.latitude, lon: r.longitude, weight: SIGNAL_WEIGHTS.flights, sourceType: 'adsb', evidenceId: r.icao24, timestamp: r.timestamp })
    }
  } catch { /* ignore */ }

  // Vessels - military vessel density (last 6h)
  try {
    const rows = db.prepare(`
      SELECT mmsi, latitude, longitude, timestamp FROM vessels
      WHERE (ship_type = 'government'
         OR ship_name LIKE 'USS %' OR ship_name LIKE 'USNS %'
         OR ship_name LIKE 'HMS %' OR ship_name LIKE 'JS %')
        AND datetime(timestamp) > datetime('now', '-6 hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY mmsi
    `).all() as Array<{ mmsi: string; latitude: number; longitude: number; timestamp: string }>
    for (const r of rows) {
      // Skip military vessels near known home ports - routine port operations
      if (isNearHomePort(r.latitude, r.longitude)) continue
      signals.push({ lat: r.latitude, lon: r.longitude, weight: SIGNAL_WEIGHTS.vessels, sourceType: 'ais', evidenceId: r.mmsi, timestamp: r.timestamp })
    }
  } catch { /* ignore */ }

  // Intel items (last 24h, with lat/lon)
  try {
    const rows = db.prepare(`
      SELECT id, latitude, longitude, created_at FROM intel_items
      WHERE datetime(created_at) > datetime('now', '-24 hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
    `).all() as Array<{ id: string; latitude: number; longitude: number; created_at: string }>
    for (const r of rows) {
      signals.push({ lat: r.latitude, lon: r.longitude, weight: SIGNAL_WEIGHTS.intel_items, sourceType: 'intel', evidenceId: r.id, timestamp: r.created_at })
    }
  } catch { /* ignore */ }

  // NOTAMs — active military/defense NOTAMs (weight: 2.5, official government data)
  try {
    const notamRows = db.prepare(`
      SELECT id, lat, lon, type, effective_start FROM notams
      WHERE status = 'active'
        AND lat IS NOT NULL
        AND (effective_end IS NULL OR effective_end > datetime('now'))
    `).all() as Array<{ id: string; lat: number; lon: number; type: string; effective_start: string | null }>
    for (const n of notamRows) {
      signals.push({
        lat: n.lat,
        lon: n.lon,
        weight: SIGNAL_WEIGHTS.notams,
        sourceType: 'notam',
        evidenceId: n.id,
        timestamp: n.effective_start || new Date().toISOString()
      })
    }
  } catch { /* table may not exist yet */ }

  return signals
}

// ── DBSCAN Clustering ──────────────────────────────────────

function dbscanCluster(signals: Signal[]): Cluster[] {
  const n = signals.length
  const visited: boolean[] = Array(n).fill(false)
  const assigned: boolean[] = Array(n).fill(false)
  const clusters: Cluster[] = []

  const findNeighbors = (idx: number): number[] => {
    const neighbors: number[] = []
    for (let j = 0; j < n; j++) {
      if (j === idx) continue
      const dist = haversineDistanceNm(signals[idx].lat, signals[idx].lon, signals[j].lat, signals[j].lon)
      if (dist <= DBSCAN_EPSILON_NM) {
        neighbors.push(j)
      }
    }
    return neighbors
  }

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue
    visited[i] = true

    const neighbors = findNeighbors(i)
    if (neighbors.length < DBSCAN_MIN_SAMPLES - 1) continue

    const clusterSignals: Signal[] = [signals[i]]
    assigned[i] = true

    const queue = [...neighbors]
    while (queue.length > 0) {
      const j = queue.shift()!
      if (assigned[j]) continue

      assigned[j] = true
      clusterSignals.push(signals[j])

      if (!visited[j]) {
        visited[j] = true
        const jNeighbors = findNeighbors(j)
        if (jNeighbors.length >= DBSCAN_MIN_SAMPLES - 1) {
          for (const k of jNeighbors) {
            if (!assigned[k]) queue.push(k)
          }
        }
      }
    }

    const heatScore = clusterSignals.reduce((sum, s) => sum + s.weight * recencyFactor(s.timestamp), 0)
    const sourceTypes = new Set(clusterSignals.map(s => s.sourceType))

    // Store only meaningful evidence IDs - prefer quality sources over raw flight/vessel IDs
    const qualityEvidenceIds = clusterSignals
      .filter(s => ['tactical', 'intel', 'article', 'notam', 'anomaly'].includes(s.sourceType))
      .map(s => s.evidenceId)
    const evidenceIds = qualityEvidenceIds.length >= 5
      ? qualityEvidenceIds
      : [...qualityEvidenceIds, ...clusterSignals
          .filter(s => ['adsb', 'ais'].includes(s.sourceType))
          .map(s => s.evidenceId)
        ].slice(0, 50)

    let totalWeight = 0
    let wLat = 0
    let wLon = 0
    for (const s of clusterSignals) {
      const w = s.weight * recencyFactor(s.timestamp)
      wLat += s.lat * w
      wLon += s.lon * w
      totalWeight += w
    }
    const centerLat = totalWeight > 0 ? wLat / totalWeight : clusterSignals[0].lat
    const centerLon = totalWeight > 0 ? wLon / totalWeight : clusterSignals[0].lon

    let maxDist = 0
    for (const s of clusterSignals) {
      const d = haversineDistanceNm(centerLat, centerLon, s.lat, s.lon)
      if (d > maxDist) maxDist = d
    }
    const radiusNm = Math.max(maxDist + BUFFER_NM, 100)

    clusters.push({ signals: clusterSignals, centerLat, centerLon, radiusNm, heatScore, sourceTypes, evidenceIds })
  }

  return clusters
}

// ── Zone Lifecycle ─────────────────────────────────────────

function computeStatus(heatScore: number, prevScore: number, prevStatus: string): ConflictZoneRow['status'] {
  if (heatScore > ESCALATING_THRESHOLD || (prevScore > 0 && heatScore > prevScore * RAPID_ESCALATION_FACTOR)) {
    return 'escalating'
  }
  if (heatScore >= 10) return 'active'
  if (heatScore >= 5) return 'monitoring'
  if (heatScore < RESOLVED_THRESHOLD) return 'resolved'
  if (['active', 'escalating'].includes(prevStatus) && heatScore < 10) return 'fading'
  return 'monitoring'
}

function computeSensitivity(heatScore: number): 'high' | 'medium' | 'low' {
  if (heatScore >= 15) return 'high'
  if (heatScore >= 8) return 'medium'
  return 'low'
}

// ── Main Engine ────────────────────────────────────────────

/**
 * Run one cycle of the zone engine. Should be called every ~30 min.
 * Idempotent: running twice without new data should not create duplicates.
 */
export function runZoneEngine(): void {
  const db = getDatabase()

  try {
    // 1. Decay existing zones
    db.prepare(`UPDATE conflict_zones SET heat_score = heat_score * ? WHERE status != 'resolved'`).run(DECAY_FACTOR)

    // 2. Mark zones as fading if no recent signals
    db.prepare(`
      UPDATE conflict_zones SET status = 'fading'
      WHERE status IN ('active', 'escalating', 'monitoring')
        AND (last_signal_at IS NULL OR datetime(last_signal_at) < datetime('now', '-12 hours'))
        AND heat_score < 10
    `).run()

    // 3. Gather signals and cluster
    const signals = gatherSignals()
    const clusters = dbscanCluster(signals)

    // 4. Create or update zones from clusters
    for (const cluster of clusters) {
      if (cluster.heatScore < CREATION_THRESHOLD) continue

      const zoneId = deriveZoneId(cluster.centerLat, cluster.centerLon)

      // Check for existing zone by ID first, then by proximity
      let existingZone: ConflictZoneRow | undefined
      try {
        existingZone = db.prepare(`SELECT * FROM conflict_zones WHERE id = ? AND status != 'resolved'`).get(zoneId) as ConflictZoneRow | undefined
      } catch { /* ignore */ }

      if (!existingZone) {
        // Check for nearby zones within merge distance
        const candidates = db.prepare(
          `SELECT * FROM conflict_zones WHERE status != 'resolved'`
        ).all() as ConflictZoneRow[]
        for (const c of candidates) {
          if (haversineDistanceNm(c.center_lat, c.center_lon, cluster.centerLat, cluster.centerLon) <= MERGE_DISTANCE_NM) {
            existingZone = c
            break
          }
        }
      }

      const now = new Date().toISOString()

      // Require multi-source corroboration for NEW zone creation
      const hasQualitySource = cluster.sourceTypes.has('article')
        || cluster.sourceTypes.has('notam')
        || (cluster.sourceTypes.has('intel') && cluster.signals.some(s => s.sourceType === 'intel'))
        || (cluster.sourceTypes.has('tactical') && cluster.signals.some(s => s.sourceType === 'tactical'))

      if (existingZone) {
        const prevScore = existingZone.heat_score
        const newScore = prevScore + cluster.heatScore
        const newStatus = computeStatus(newScore, prevScore, existingZone.status)
        const newSensitivity = computeSensitivity(newScore)

        const prevEvidence = JSON.parse(existingZone.evidence_ids || '[]') as string[]
        const mergedEvidence = [...new Set([...prevEvidence, ...cluster.evidenceIds])].slice(0, 50)
        const prevSourceTypes = JSON.parse(existingZone.source_types || '[]') as string[]
        const mergedSourceTypes = [...new Set([...prevSourceTypes, ...cluster.sourceTypes])]

        db.prepare(`
          UPDATE conflict_zones SET
            heat_score = ?,
            status = ?,
            sensitivity = ?,
            signal_count = ?,
            source_types = ?,
            evidence_ids = ?,
            last_signal_at = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          newScore,
          newStatus,
          newSensitivity,
          mergedEvidence.length,
          JSON.stringify(mergedSourceTypes),
          JSON.stringify(mergedEvidence),
          now,
          existingZone.id
        )
      } else {
        // Don't create NEW zones from only raw flight/vessel data
        if (!hasQualitySource) {
          console.log(`[ZoneEngine] Skipping zone creation at ${cluster.centerLat.toFixed(1)},${cluster.centerLon.toFixed(1)} - no corroborating evidence (sources: ${[...cluster.sourceTypes].join(',')})`)
          continue
        }

        const newSensitivity = computeSensitivity(cluster.heatScore)
        db.prepare(`
          INSERT INTO conflict_zones (id, name, status, heat_score, center_lat, center_lon, radius_nm, sensitivity, signal_count, source_types, evidence_ids, last_signal_at)
          VALUES (?, ?, 'monitoring', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          zoneId,
          deriveZoneName(cluster.centerLat, cluster.centerLon),
          cluster.heatScore,
          cluster.centerLat,
          cluster.centerLon,
          cluster.radiusNm,
          newSensitivity,
          cluster.evidenceIds.length,
          JSON.stringify([...cluster.sourceTypes]),
          JSON.stringify(cluster.evidenceIds.slice(0, 50)),
          now
        )
        console.log(`[ZoneEngine] Created zone: ${zoneId} (heat: ${cluster.heatScore.toFixed(1)})`)
      }
    }

    // 5. Resolve zones below threshold
    db.prepare(`
      UPDATE conflict_zones SET status = 'resolved', updated_at = datetime('now')
      WHERE status != 'resolved' AND heat_score < ?
    `).run(RESOLVED_THRESHOLD)

    // 6. Auto-delete resolved zones older than 24h
    db.prepare(`
      DELETE FROM conflict_zones
      WHERE status = 'resolved'
        AND datetime(updated_at) < datetime('now', '-24 hours')
    `).run()

    console.log(`[ZoneEngine] Cycle complete. ${clusters.length} clusters processed, ${signals.length} signals analyzed.`)
  } catch (err) {
    console.error('[ZoneEngine] Error:', err instanceof Error ? err.message : String(err))
  }
}

// ── Query Helpers ──────────────────────────────────────────

/**
 * Get all non-resolved conflict zones (for map layer and tactical engine).
 */
export function getActiveConflictZones(): ConflictZoneRow[] {
  const db = getDatabase()
  try {
    return db.prepare(
      `SELECT * FROM conflict_zones WHERE status != 'resolved' ORDER BY heat_score DESC`
    ).all() as ConflictZoneRow[]
  } catch {
    return []
  }
}

/**
 * Get a single zone by ID with its evidence trail.
 */
export function getZoneDetail(zoneId: string): { zone: ConflictZoneRow; evidence: Array<Record<string, unknown>> } | null {
  const db = getDatabase()
  try {
    const zone = db.prepare(`SELECT * FROM conflict_zones WHERE id = ?`).get(zoneId) as ConflictZoneRow | undefined
    if (!zone) return null

    const evidenceIds = JSON.parse(zone.evidence_ids || '[]') as string[]
    const evidence: Array<Record<string, unknown>> = []

    if (evidenceIds.length > 0) {
      const placeholders = evidenceIds.map(() => '?').join(',')

      // Tactical events
      try {
        const events = db.prepare(`SELECT id, event_type, severity, description, detected_at FROM tactical_events WHERE id IN (${placeholders})`).all(...evidenceIds)
        evidence.push(...(events as Array<Record<string, unknown>>).map(e => ({ ...e, source_table: 'tactical_events', display_title: (e as { description?: string }).description })))
      } catch { /* ignore */ }

      // Intel items
      try {
        const items = db.prepare(`SELECT id, title, summary, tier, confidence, created_at FROM intel_items WHERE id IN (${placeholders})`).all(...evidenceIds)
        evidence.push(...(items as Array<Record<string, unknown>>).map(e => ({ ...e, source_table: 'intel_items', display_title: (e as { title?: string }).title })))
      } catch { /* ignore */ }

      // News articles
      try {
        const articles = db.prepare(`SELECT id, title, summary, source_name, published_at FROM articles WHERE id IN (${placeholders})`).all(...evidenceIds)
        evidence.push(...(articles as Array<Record<string, unknown>>).map(e => ({ ...e, source_table: 'articles', display_title: (e as { title?: string }).title })))
      } catch { /* ignore */ }

      // NOTAMs
      try {
        const notams = db.prepare(`SELECT id, type, description, effective_start FROM notams WHERE id IN (${placeholders})`).all(...evidenceIds)
        evidence.push(...(notams as Array<Record<string, unknown>>).map(e => ({ ...e, source_table: 'notams', display_title: (e as { description?: string }).description })))
      } catch { /* ignore */ }

      // Flights (only included as evidence when no other sources)
      try {
        const flights = db.prepare(`SELECT icao24, callsign, aircraft_type, timestamp FROM flights WHERE id IN (${placeholders})`).all(...evidenceIds)
        evidence.push(...(flights as Array<Record<string, unknown>>).map(e => ({ ...e, source_table: 'flights', display_title: `${(e as { aircraft_type?: string; icao24?: string }).aircraft_type || (e as { icao24?: string }).icao24}` })))
      } catch { /* ignore */ }
    }

    return { zone, evidence }
  } catch {
    return null
  }
}

/**
 * Get resolved zones from the last 30 days.
 */
export function getZoneHistory(): ConflictZoneRow[] {
  const db = getDatabase()
  try {
    return db.prepare(
      `SELECT * FROM conflict_zones WHERE status = 'resolved' AND datetime(updated_at) > datetime('now', '-30 days') ORDER BY updated_at DESC LIMIT 50`
    ).all() as ConflictZoneRow[]
  } catch {
    return []
  }
}

/**
 * Get a summary of active/escalating zones for LLM context in sensemaking.
 */
export function getZoneContextString(): string {
  const zones = getActiveConflictZones()
  if (zones.length === 0) return 'No active conflict zones.'

  return zones
    .filter(z => z.status !== 'resolved')
    .map(z => {
      const sourceTypes = JSON.parse(z.source_types || '[]') as string[]
      return `- [${z.status.toUpperCase()}] ${z.name} (${z.center_lat.toFixed(1)}\u00B0N, ${z.center_lon.toFixed(1)}\u00B0E) heat: ${z.heat_score.toFixed(1)}, radius: ${z.radius_nm.toFixed(0)}nm, sensitivity: ${z.sensitivity}, sources: ${sourceTypes.join('/')}${z.signal_count > 0 ? `, ${z.signal_count} signals` : ''}`
    })
    .join('\n')
}