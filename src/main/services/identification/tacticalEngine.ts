/**
 * Tactical Significance Engine (Phase 4C)
 *
 * Runs after each ADS-B/AIS data refresh cycle, detects tactically
 * significant patterns among identified military assets, and
 * auto-generates intel items.
 *
 * Detection algorithms:
 *   A. Airlift Detection – 3+ strategic/tactical airlift aircraft sharing a bearing
 *   B. HVA Proximity – High-Value Aircraft near conflict zones
 *   C. Formation Flight – 3+ military aircraft in close proximity
 *   D. Naval Formation / Task Force – 3+ military vessels grouped
 *   E. Strategic Bomber Projection – bombers outside home territory
 */

import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../storage/database'
import { insertIntelItemIfNotExists } from '../storage/dbService'
import { notifyIntelItem } from '../notifications/notificationService'
import { getActiveConflictZones } from '../analysis/zoneEngine'
import { REGION_AREAS } from '../../../shared/regions'
import type { IntelTier } from '../../../shared/types'

// ─── Types ──────────────────────────────────────────────────

export interface TacticalEvent {
  id: string
  event_type:
    | 'airlift'
    | 'hva_tracking'
    | 'formation_flight'
    | 'task_force'
    | 'csg'
    | 'arg'
    | 'choke_point_transit'
    | 'bomber_projection'
  severity: IntelTier
  description: string
  assets: string[] // flight/vessel IDs involved
  region: string
  detected_at: string
  resolved_at: string | null
  status: 'active' | 'resolved'
  latitude: number | null
  longitude: number | null
}

interface ConflictZone {
  id: string
  name: string
  lat: number
  lon: number
  radiusNm: number
  sensitivity: 'high' | 'medium' | 'low'
}

interface FlightRow {
  id: string
  icao24: string | null
  callsign: string | null
  origin_country: string | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  velocity: number | null
  heading: number | null
  is_military: number
  aircraft_type: string | null
  timestamp: string | null
}

interface VesselRow {
  id: string
  mmsi: string | null
  ship_name: string | null
  ship_type: string | null
  latitude: number | null
  longitude: number | null
  speed: number | null
  heading: number | null
  destination: string | null
  timestamp: string | null
}

// ─── HVA Profiles ───────────────────────────────────────────

const HVA_PROFILES: Record<string, { fullName: string; category: string; baseScore: number }> = {
  // Command & Control (highest priority)
  E4: { fullName: 'E-4 Nightwatch (NAOC)', category: 'command', baseScore: 95 },
  E4B: { fullName: 'E-4B Nightwatch (NAOC)', category: 'command', baseScore: 98 },
  E6: { fullName: 'E-6 Mercury (TACAMO)', category: 'command', baseScore: 90 },
  E6B: { fullName: 'E-6B Mercury (TACAMO)', category: 'command', baseScore: 92 },
  E8: { fullName: 'E-8 JSTARS', category: 'command', baseScore: 85 },
  E8C: { fullName: 'E-8C JSTARS', category: 'command', baseScore: 87 },
  E7: { fullName: 'E-7 Wedgetail', category: 'command', baseScore: 83 },
  // Airborne Early Warning
  E3: { fullName: 'E-3 Sentry (AWACS)', category: 'aew', baseScore: 80 },
  E3A: { fullName: 'E-3A Sentry (AWACS)', category: 'aew', baseScore: 80 },
  E3C: { fullName: 'E-3C Sentry (AWACS)', category: 'aew', baseScore: 82 },
  E2: { fullName: 'E-2 Hawkeye', category: 'aew', baseScore: 70 },
  E2C: { fullName: 'E-2C Hawkeye', category: 'aew', baseScore: 72 },
  E2D: { fullName: 'E-2D Hawkeye', category: 'aew', baseScore: 75 },
  // Intelligence & Recon
  RC1: { fullName: 'RC-135 Rivet Joint', category: 'recon', baseScore: 85 },
  R135: { fullName: 'RC-135V/W Rivet Joint', category: 'recon', baseScore: 87 },
  RC35: { fullName: 'RC-135V/W Rivet Joint', category: 'recon', baseScore: 87 },
  RQ4: { fullName: 'RQ-4 Global Hawk', category: 'isr_uav', baseScore: 75 },
  MQ4: { fullName: 'MQ-4 Triton', category: 'isr_uav', baseScore: 73 },
  U2: { fullName: 'U-2 Dragon Lady', category: 'recon', baseScore: 78 },
  // VIP Transport
  VC2: { fullName: 'VC-25 (Air Force One)', category: 'vip', baseScore: 100 },
  VC25: { fullName: 'VC-25 (Air Force One)', category: 'vip', baseScore: 100 },
  C32: { fullName: 'C-32 (VIP 757)', category: 'vip', baseScore: 65 },
  C32A: { fullName: 'C-32A (VIP 757)', category: 'vip', baseScore: 65 },
  C37: { fullName: 'C-37 (Gulfstream V VIP)', category: 'vip', baseScore: 55 },
  C37A: { fullName: 'C-37A (Gulfstream V VIP)', category: 'vip', baseScore: 55 },
  C40: { fullName: 'C-40 (VIP 737)', category: 'vip', baseScore: 60 },
  // Maritime Patrol
  P8: { fullName: 'P-8 Poseidon', category: 'maritime', baseScore: 70 },
  P8A: { fullName: 'P-8A Poseidon', category: 'maritime', baseScore: 72 },
  P3: { fullName: 'P-3 Orion', category: 'maritime', baseScore: 60 },
  P3C: { fullName: 'P-3C Orion', category: 'maritime', baseScore: 62 },
  // Strategic Bombers
  B52: { fullName: 'B-52 Stratofortress', category: 'bomber', baseScore: 85 },
  B52H: { fullName: 'B-52H Stratofortress', category: 'bomber', baseScore: 87 },
  B1B: { fullName: 'B-1B Lancer', category: 'bomber', baseScore: 82 },
  B2: { fullName: 'B-2 Spirit', category: 'bomber', baseScore: 95 },
  B2A: { fullName: 'B-2A Spirit', category: 'bomber', baseScore: 97 },
  // Air Refueling Tankers (key indicator of sustained air operations)
  K35: { fullName: 'KC-135 Stratotanker', category: 'tanker', baseScore: 65 },
  K35R: { fullName: 'KC-135R Stratotanker', category: 'tanker', baseScore: 65 },
  K35E: { fullName: 'KC-135E Stratotanker', category: 'tanker', baseScore: 65 },
  K35T: { fullName: 'KC-135T Stratotanker', category: 'tanker', baseScore: 65 },
  KC35: { fullName: 'KC-135 Stratotanker', category: 'tanker', baseScore: 65 },
  K46: { fullName: 'KC-46 Pegasus', category: 'tanker', baseScore: 67 },
  K46A: { fullName: 'KC-46A Pegasus', category: 'tanker', baseScore: 67 },
  KC46: { fullName: 'KC-46 Pegasus', category: 'tanker', baseScore: 67 },
  K10: { fullName: 'KC-10 Extender', category: 'tanker', baseScore: 63 },
  K10A: { fullName: 'KC-10A Extender', category: 'tanker', baseScore: 63 },
  K100: { fullName: 'KC-10 Extender', category: 'tanker', baseScore: 63 },
  KC10: { fullName: 'KC-10 Extender', category: 'tanker', baseScore: 63 },
  KC76: { fullName: 'KC-767 (Italian Tanker)', category: 'tanker', baseScore: 66 },
  K767: { fullName: 'KC-767 (Italian Tanker)', category: 'tanker', baseScore: 66 },
  KC30: { fullName: 'KC-30 / A330 MRTT', category: 'tanker', baseScore: 66 },
  A33M: { fullName: 'A330 MRTT (Phenix)', category: 'tanker', baseScore: 66 },
  IL78: { fullName: 'Il-78 Midas', category: 'adversary_tanker', baseScore: 72 },
  I78: { fullName: 'Il-78 Midas', category: 'adversary_tanker', baseScore: 72 },
  YY20: { fullName: 'YY-20 (Chinese Tanker)', category: 'adversary_tanker', baseScore: 68 },
  // Strategic Military Transport
  A400: { fullName: 'A400M Atlas', category: 'transport', baseScore: 60 },
  // Adversary Strategic
  TU95: { fullName: 'Tu-95 Bear', category: 'adversary_bomber', baseScore: 88 },
  T95: { fullName: 'Tu-95 Bear', category: 'adversary_bomber', baseScore: 88 },
  TU160: { fullName: 'Tu-160 Blackjack', category: 'adversary_bomber', baseScore: 90 },
  T160: { fullName: 'Tu-160 Blackjack', category: 'adversary_bomber', baseScore: 90 },
  Y20: { fullName: 'Y-20 Kunpeng', category: 'adversary_transport', baseScore: 72 }
}

/** Context blurbs by HVA category */
const CONTEXT_BLURBS: Record<string, string> = {
  command: 'National Command Authority aircraft presence indicates elevated command posture.',
  recon: 'Signals intelligence collection pattern detected.',
  aew: 'Airborne early warning coverage suggests coordinated operations.',
  vip: 'Senior government official transport detected.',
  maritime: 'Maritime patrol aircraft operating in strategically sensitive area.',
  bomber: 'Strategic bomber presence indicates power projection.',
  isr_uav: 'High-altitude ISR UAV operating in the area.',
  adversary_bomber: 'Adversary strategic bomber detected near allied airspace.',
  tanker: 'NATO/Allied air refueling tanker detected near conflict zone. This is a friendly asset supporting allied air operations, NOT an adversary asset. Do not attribute this to Russian, Chinese, or other adversary forces.',
  adversary_tanker: 'Adversary air refueling tanker detected near conflict zone. Indicates sustained adversary air operations.',
  adversary_transport: 'Adversary strategic transport detected, possible military logistics.',
  transport: 'Strategic military transport aircraft detected near conflict zone.'
}

/** Home territory bounding boxes for friendly nations (NATO + allies) */
const FRIENDLY_HOME_TERRITORY: Array<{ name: string; latMin: number; latMax: number; lonMin: number; lonMax: number }> = [
  { name: 'US', latMin: 24, latMax: 50, lonMin: -125, lonMax: -66 },
  { name: 'Canada', latMin: 42, latMax: 83, lonMin: -141, lonMax: -52 },
  { name: 'UK', latMin: 49, latMax: 61, lonMin: -8, lonMax: 2 },
  { name: 'France', latMin: 42, latMax: 51, lonMin: -5, lonMax: 8 },
  { name: 'Germany', latMin: 47, latMax: 55, lonMin: 5, lonMax: 15 },
  { name: 'Italy', latMin: 36, latMax: 47, lonMin: 6, lonMax: 19 },
  { name: 'Spain', latMin: 36, latMax: 44, lonMin: -10, lonMax: 4 },
  { name: 'Turkey', latMin: 36, latMax: 42, lonMin: 26, lonMax: 45 },
  { name: 'Australia', latMin: -44, latMax: -10, lonMin: 113, lonMax: 155 },
  { name: 'Japan', latMin: 30, latMax: 46, lonMin: 128, lonMax: 146 },
  { name: 'South Korea', latMin: 33, latMax: 39, lonMin: 125, lonMax: 130 },
  { name: 'Norway', latMin: 57, latMax: 72, lonMin: 4, lonMax: 32 },
  { name: 'Poland', latMin: 49, latMax: 55, lonMin: 14, lonMax: 24 },
]

// Keep original for bomber projection (only US/Russia)
const HOME_TERRITORY: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  US: { latMin: 25, latMax: 49, lonMin: -125, lonMax: -67 },
  Russia: { latMin: 41, latMax: 70, lonMin: 27, lonMax: 190 }
}

/** Check if coordinates are over a friendly nation's home territory */
function isFriendlyHomeTerritory(lat: number, lon: number): boolean {
  return FRIENDLY_HOME_TERRITORY.some(box =>
    lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax
  )
}

/** Bomber type prefixes to identify */
const BOMBER_PREFIXES = ['B52', 'B1B', 'B2', 'B2A', 'TU95', 'T95', 'TU160', 'T160']

/** Tanker keywords for fallback text matching */
const TANKER_KEYWORDS = ['KC-135', 'KC-46', 'KC-10', 'KC-767', 'MRTT', 'A330 MRTT', 'K767', 'KC30', 'IL-78']

/** Event types that use geographic proximity dedup (titles change as assets move) */
const SPATIAL_EVENT_TYPES = ['airlift', 'formation_flight', 'task_force', 'hva_tracking', 'bomber_projection']

// ─── Utility ────────────────────────────────────────────────

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Convert nautical miles to kilometers */
function nmToKm(nm: number): number {
  return nm * 1.852
}

/** Round bearing to nearest bucket (e.g. 30°) */
function bearingBucket(bearing: number, bucketSize: number): number {
  return Math.round(bearing / bucketSize) * bucketSize
}

/** Convert bearing to compass direction name */
function bearingToDirection(bearing: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const idx = Math.round(bearing / 22.5) % 16
  return dirs[idx]
}

/** Map score to severity tier */
function scoreToTier(score: number): IntelTier | null {
  if (score >= 90) return 'ALERT'
  if (score >= 70) return 'WATCH'
  if (score >= 50) return 'CONTEXT'
  return null // below threshold, don't generate event
}

/** Zone sensitivity multiplier */
function zoneMultiplier(sensitivity: string): number {
  switch (sensitivity) {
    case 'high': return 1.0
    case 'medium': return 0.8
    case 'low': return 0.5
    default: return 0.5
  }
}

/** Calculate centroid of a set of positions */
function calculateCentroid(positions: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  if (positions.length === 0) return { lat: 0, lon: 0 }
  const sumLat = positions.reduce((sum, p) => sum + p.lat, 0)
  const sumLon = positions.reduce((sum, p) => sum + p.lon, 0)
  return { lat: sumLat / positions.length, lon: sumLon / positions.length }
}

/** Check if a point is inside a bounding box */
function isInBoundingBox(
  lat: number,
  lon: number,
  box: { latMin: number; latMax: number; lonMin: number; lonMax: number }
): boolean {
  return lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax
}

// ─── Debounce guard ─────────────────────────────────────────

let lastRunTimestamp = 0
const DEBOUNCE_MS = 60_000 // 60 seconds

// ─── Dynamic conflict zones (loaded from DB) ────────────────

function loadZones(): ConflictZone[] {
  try {
    const dbZones = getActiveConflictZones()
    return dbZones.map(z => ({
      id: z.id,
      name: z.name,
      lat: z.center_lat,
      lon: z.center_lon,
      radiusNm: z.radius_nm,
      sensitivity: z.sensitivity
    }))
  } catch {
    return []
  }
}

// ─── DB helpers ─────────────────────────────────────────────

function ensureTacticalEventsTable(): void {
  const db = getDatabase()
  if (!db) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS tactical_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      severity TEXT CHECK(severity IN ('ALERT', 'WATCH', 'CONTEXT')),
      description TEXT,
      assets TEXT,
      region TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      status TEXT DEFAULT 'active',
      latitude REAL,
      longitude REAL
    )
  `)
}

function insertTacticalEvent(event: TacticalEvent): void {
  const db = getDatabase()
  if (!db) return
  db.prepare(
    `INSERT INTO tactical_events (id, event_type, severity, description, assets, region, detected_at, resolved_at, status, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.event_type,
    event.severity,
    event.description,
    JSON.stringify(event.assets),
    event.region,
    event.detected_at,
    event.resolved_at,
    event.status,
    event.latitude,
    event.longitude
  )
}

function updateTacticalEvent(id: string, updates: Partial<Pick<TacticalEvent, 'description' | 'assets' | 'resolved_at' | 'status'>>): void {
  const db = getDatabase()
  if (!db) return
  const setClauses: string[] = []
  const values: unknown[] = []
  if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description) }
  if (updates.assets !== undefined) { setClauses.push('assets = ?'); values.push(JSON.stringify(updates.assets)) }
  if (updates.resolved_at !== undefined) { setClauses.push('resolved_at = ?'); values.push(updates.resolved_at) }
  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status) }
  if (setClauses.length === 0) return
  values.push(id)
  db.prepare(`UPDATE tactical_events SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

function findActiveHvaEvent(icao24: string, zoneName: string): TacticalEvent | null {
  const db = getDatabase()
  if (!db) return null
  const row = db
    .prepare(
      `SELECT * FROM tactical_events
       WHERE event_type = 'hva_tracking'
         AND status = 'active'
         AND region = ?
         AND datetime(detected_at) >= datetime('now', '-2 hours')
       ORDER BY detected_at DESC
       LIMIT 1`
    )
    .get(zoneName) as Record<string, unknown> | undefined

  if (!row) return null

  // Verify this event is actually for the same aircraft
  const assets = JSON.parse((row.assets as string) || '[]') as string[]
  if (!assets.some((a) => a === icao24 || a.includes(icao24))) return null

  return hydrateTacticalEvent(row)
}

function isRecentEvent(eventType: string, region: string, withinHours: number): boolean {
  const db = getDatabase()
  if (!db) return false
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM tactical_events
       WHERE event_type = ? AND region = ? AND status = 'active'
         AND datetime(detected_at) >= datetime('now', ?)`
    )
    .get(eventType, region, `-${withinHours} hours`) as { cnt: number } | undefined
  return (row?.cnt ?? 0) > 0
}

/**
 * Check if an active tactical event of the given type exists within
 * `radiusDeg` degrees of (lat, lon) AND with matching direction in the region string.
 * This is more robust than exact region matching for moving aircraft clusters.
 */
function isNearbyActiveEvent(
  eventType: string,
  lat: number,
  lon: number,
  radiusDeg: number,
  withinHours: number,
  directionMatch?: string
): boolean {
  const db = getDatabase()
  if (!db) return false

  let query = `SELECT COUNT(*) as cnt FROM tactical_events
     WHERE event_type = ? AND status = 'active'
       AND datetime(detected_at) >= datetime('now', ?)
       AND latitude BETWEEN ? AND ?
       AND longitude BETWEEN ? AND ?`
  const params: unknown[] = [
    eventType,
    `-${withinHours} hours`,
    lat - radiusDeg,
    lat + radiusDeg,
    lon - radiusDeg,
    lon + radiusDeg
  ]

  if (directionMatch) {
    query += ` AND region LIKE ?`
    params.push(`%-${directionMatch}-%`)
  }

  const row = db.prepare(query).get(...params) as { cnt: number } | undefined
  return (row?.cnt ?? 0) > 0
}

/** Find an active airlift event that shares any aircraft with the given ICAO24 list. */
function findAirliftByAssets(assetIds: string[]): { id: string } | null {
  const db = getDatabase()
  if (!db || assetIds.length === 0) return null

  // Check active airlift events for overlapping assets
  const rows = db.prepare(
    `SELECT id, assets FROM tactical_events
     WHERE event_type = 'airlift' AND status = 'active'
       AND datetime(detected_at) >= datetime('now', '-4 hours')`
  ).all() as Array<{ id: string; assets: string }>

  for (const row of rows) {
    try {
      const existingAssets = JSON.parse(row.assets || '[]') as string[]
      // If any aircraft overlaps, this is the same formation
      const overlap = existingAssets.some(a => assetIds.includes(a))
      if (overlap) return { id: row.id }
    } catch { /* ignore parse errors */ }
  }
  return null
}

/** Update position and description of an existing tactical event (for tracking movement). */
function updateEventPosition(eventId: string, lat: number, lon: number, description: string, region: string): void {
  const db = getDatabase()
  if (!db) return

  db.prepare(
    `UPDATE tactical_events SET latitude = ?, longitude = ?, description = ?, region = ?, detected_at = datetime('now') WHERE id = ?`
  ).run(lat, lon, description, region, eventId)
}

function hydrateTacticalEvent(row: Record<string, unknown>): TacticalEvent {
  return {
    id: row.id as string,
    event_type: row.event_type as TacticalEvent['event_type'],
    severity: row.severity as IntelTier,
    description: row.description as string,
    assets: JSON.parse((row.assets as string) || '[]'),
    region: row.region as string,
    detected_at: row.detected_at as string,
    resolved_at: (row.resolved_at as string) ?? null,
    status: row.status as 'active' | 'resolved',
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null
  }
}

// ─── Auto-resolve old events ────────────────────────────────

function resolveOldEvents(): void {
  const db = getDatabase()
  if (!db) return
  const result = db
    .prepare(
      `UPDATE tactical_events SET status = 'resolved', resolved_at = datetime('now')
       WHERE status = 'active' AND (
         (event_type IN ('airlift', 'hva_tracking', 'formation_flight', 'bomber_projection') AND datetime(detected_at) < datetime('now', '-4 hours'))
         OR (event_type NOT IN ('airlift', 'hva_tracking', 'formation_flight', 'bomber_projection') AND datetime(detected_at) < datetime('now', '-24 hours'))
       )`
    )
    .run()
  if (result.changes > 0) {
    console.log(`[TacticalEngine] Resolved ${result.changes} events (4h/24h TTL)`)
  }
}

// ─── Dynamic Confidence Scoring ─────────────────────────────

/**
 * Calculate confidence score (0-1) for a tactical event based on
 * event type and detection quality. Higher = more certain.
 *
 * Scale: 0-1 (renderer multiplies by 100 for display, so 0.80 → 80%).
 */
function calculateConfidence(event: TacticalEvent): number {
  switch (event.event_type) {
    case 'hva_tracking': {
      // Derive from severity tier — matches HVA baseScore ranges
      if (event.severity === 'ALERT') return 0.92
      if (event.severity === 'WATCH') return 0.78
      return 0.60 // CONTEXT
    }

    case 'airlift': {
      // More aircraft = higher confidence in the detection
      // 3 aircraft (threshold) = 0.75, each additional +0.05, cap 0.95
      const assetCount = event.assets.length
      return Math.min(0.95, 0.75 + (assetCount - 3) * 0.05)
    }

    case 'formation_flight': {
      // 3 aircraft (threshold) = 0.65, each additional +0.05, cap 0.90
      const assetCount = event.assets.length
      return Math.min(0.90, 0.65 + (assetCount - 3) * 0.05)
    }

    case 'csg':
    case 'arg': {
      // Carrier/amphibious groups are high-confidence detections
      // 3 vessels = 0.80, more = higher, cap 0.95
      const assetCount = event.assets.length
      return Math.min(0.95, 0.80 + (assetCount - 3) * 0.03)
    }

    case 'task_force': {
      // Generic task forces are less certain (could be coincidence)
      // 3 vessels = 0.65, more = higher, cap 0.85
      const assetCount = event.assets.length
      return Math.min(0.85, 0.65 + (assetCount - 3) * 0.04)
    }

    case 'choke_point_transit': {
      return 0.70
    }

    case 'bomber_projection': {
      // Bomber outside home territory is significant but uncertain about intent
      if (event.severity === 'ALERT') return 0.85
      return 0.75
    }

    default:
      return 0.70
  }
}

// ─── Sync tactical events → intel_items ─────────────────────

function syncTacticalEventsToIntelFeed(): void {
  const db = getDatabase()
  if (!db) return

  const events = db
    .prepare(
      `SELECT * FROM tactical_events WHERE status = 'active' ORDER BY detected_at DESC`
    )
    .all() as Array<Record<string, unknown>>

  for (const row of events) {
    const event = hydrateTacticalEvent(row)

    const title = event.description.split('.')[0] + '.'
    const confidence = calculateConfidence(event)

    // Use insertIntelItemIfNotExists for DB-level dedup
    // This checks against ALL recent intel items (not just tactical)
    const result = insertIntelItemIfNotExists({
      tier: event.severity,
      title,
      summary: event.description,
      analysis: null,
      confidence,
      sources: event.assets,
      region: event.region,
      categories: [event.event_type, 'tactical'],
      updated_at: null,
      expires_at: new Date(Date.now() + (SPATIAL_EVENT_TYPES.includes(event.event_type) ? 4 : 24) * 60 * 60 * 1000).toISOString(),
      latitude: event.latitude,
      longitude: event.longitude
    })

    if (!result) {
      console.log(`[TacticalEngine] Dedup: skipping "${title}"`)
      continue
    }

    console.log(`[TacticalEngine] Intel item created: ${title}`)

    // Send notification for new tactical detection
    notifyIntelItem({
      tier: event.severity,
      title,
      summary: event.description,
      region: event.region,
      categories: [event.event_type, 'tactical'],
      latitude: event.latitude,
      longitude: event.longitude,
      sources: event.assets
    }).catch(err => console.error('[TacticalEngine] Notification failed:', err))
  }
}

// ─── Detection Algorithm A: Airlift Detection ───────────────

function detectAirlifts(): void {
  try {
    const db = getDatabase()
    if (!db) return

    // Query military transport flights from the last 4 hours
    const flights = db
      .prepare(
        `SELECT f.*, ar.icao_type_code
         FROM flights f
         LEFT JOIN aircraft_registry ar ON f.icao24 = ar.icao24
         WHERE f.is_military = 1
           AND f.timestamp >= datetime('now', '-4 hours')
           AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
         ORDER BY f.timestamp DESC`
      )
      .all() as Array<FlightRow & { icao_type_code?: string | null }>

    // Filter to strategic/tactical airlift aircraft ONLY (large transport)
    // Use icao_type_code exclusively — aircraft_type is free-text and inconsistent,
    // and callsign-based matching (REACH/RCH) catches small aircraft on transport missions.
    const AIRLIFT_ICAO_TYPES = new Set([
      'C130',  // C-130 Hercules (all variants: C-130H, C-130J, CC-130J, KC-130, LC-130, WC-130)
      'C17',   // C-17 Globemaster III
      'C5',    // C-5 Galaxy / C-5M Super Galaxy
      'A400',  // Airbus A400M Atlas
      'AN124', // Antonov An-124 Ruslan
      'AN22',  // Antonov An-22 Antei
      'IL76',  // Ilyushin Il-76 (all variants)
      'C160',  // Transall C-160
      'KC130', // KC-130 Hercules (tanker variant)
      'KC10',  // KC-10 Extender (tanker/transport)
      'KC135', // KC-135 Stratotanker (tanker/transport)
    ])

    const transportFlights = flights.filter((f) => {
      const typeCode = (f.icao_type_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      return AIRLIFT_ICAO_TYPES.has(typeCode)
    })

    if (transportFlights.length < 3) return

    // Group by bearing bucket (30°)
    // Use heading if available, otherwise skip
    const bearingGroups = new Map<number, Array<(typeof transportFlights)[0]>>()
    for (const f of transportFlights) {
      if (f.heading == null) continue
      const bucket = bearingBucket(f.heading, 30)
      if (!bearingGroups.has(bucket)) bearingGroups.set(bucket, [])
      bearingGroups.get(bucket)!.push(f)
    }

    for (const [bucket, group] of bearingGroups) {
      if (group.length < 3) continue

      const direction = bearingToDirection(bucket)

      // Build unique asset list
      const assetIds = [...new Set(group.map((f) => f.icao24 || f.id))]
      const typeSummary = [...new Set(group.map((f) => f.aircraft_type || 'military transport'))]

      // Calculate centroid from RECENT positions only (last 60 minutes).
      // Use 4h window for grouping (need enough aircraft), but only recent positions for the marker.
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const recentPositions = group
        .filter(f => f.timestamp && f.timestamp >= oneHourAgo)
        .map(f => ({ lat: f.latitude!, lon: f.longitude! }))

      // Fallback: if no recent positions, use all positions (edge case)
      const positions = recentPositions.length > 0 ? recentPositions : group.map(f => ({ lat: f.latitude!, lon: f.longitude! }))
      const centroid = calculateCentroid(positions)

      // Use centroid for region lookup (not group[0]) so region matches marker position
      const region = findNearestZone(centroid.lat, centroid.lon)
      const regionName = region?.name || 'unknown region'
      const eventRegion = `airlift-${direction}-${regionName}`
      const description =
        `Airlift operation detected: ${group.length} ${typeSummary.join('/')} aircraft ` +
        `transiting ${direction} in the past 4h. Likely major logistical deployment. ` +
        `Region: ${regionName}.`

      // Asset-based dedup: if an active airlift event already tracks any of these aircraft,
      // update its position instead of creating a new event. This prevents the same
      // formation from spawning dozens of markers as it crosses the Atlantic.
      const existingAirlift = findAirliftByAssets(assetIds)
      if (existingAirlift) {
        updateEventPosition(existingAirlift.id, centroid.lat, centroid.lon, description, eventRegion)
        console.log(`[TacticalEngine] Updated airlift ${existingAirlift.id.substring(0,8)} at ${centroid.lat.toFixed(1)},${centroid.lon.toFixed(1)} (${group.length} aircraft heading ${direction})`)
        continue
      }

      // Also skip if there's a nearby event with same direction (secondary dedup)
      if (isNearbyActiveEvent('airlift', centroid.lat, centroid.lon, 2, 2, direction)) continue

      // Skip airlift detections over friendly home territory.
      // Routine C-130/C-17 flights over the US are training/logistics, not tactical.
      if (isFriendlyHomeTerritory(centroid.lat, centroid.lon)) {
        console.log(`[TacticalEngine] Skipping airlift at ${centroid.lat.toFixed(1)},${centroid.lon.toFixed(1)} over friendly home territory`)
        continue
      }

      const event: TacticalEvent = {
        id: uuidv4(),
        event_type: 'airlift',
        severity: 'ALERT',
        description,
        assets: assetIds,
        region: eventRegion,
        detected_at: new Date().toISOString(),
        resolved_at: null,
        status: 'active',
        latitude: centroid.lat,
        longitude: centroid.lon
      }

      insertTacticalEvent(event)
      console.log(`[TacticalEngine] airlift ALERT: ${group.length} transport aircraft heading ${direction}`)
    }
  } catch (err) {
    console.error('[TacticalEngine] Airlift detection error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Detection Algorithm B: HVA Proximity Detection ─────────

function detectHvaProximity(): void {
  try {
    const db = getDatabase()
    if (!db) return
    const zones = loadZones()

    // Get active military flights with registry data
    const flights = db
      .prepare(
        `SELECT f.*, ar.icao_type_code, ar.aircraft_type as reg_aircraft_type
         FROM flights f
         LEFT JOIN aircraft_registry ar ON f.icao24 = ar.icao24
         WHERE f.is_military = 1
           AND f.timestamp >= datetime('now', '-2 hours')
           AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL`
      )
      .all() as Array<FlightRow & { icao_type_code?: string | null; reg_aircraft_type?: string | null }>

    for (const flight of flights) {
      const typeCode = (flight.icao_type_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const regType = (flight.reg_aircraft_type || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

      // Match against HVA profiles
      let matchedProfile: { fullName: string; category: string; baseScore: number } | null = null
      for (const [key, profile] of Object.entries(HVA_PROFILES)) {
        const cleanKey = key.replace(/[^A-Z0-9]/g, '')
        if (typeCode === cleanKey || regType === cleanKey || typeCode.startsWith(cleanKey)) {
          matchedProfile = profile
          break
        }
      }

      // Fallback: match by aircraft_type text if no icao_type_code match
      if (!matchedProfile) {
        const typeText = ((flight.aircraft_type || '') + ' ' + (flight.reg_aircraft_type || '')).toUpperCase()
        for (const kw of TANKER_KEYWORDS) {
          if (typeText.includes(kw.toUpperCase())) {
            matchedProfile = { fullName: flight.aircraft_type || 'Tanker Aircraft', category: 'tanker', baseScore: 65 }
            break
          }
        }
      }

      if (!matchedProfile) continue

      // Tankers and transports are logistics, not combat posture.
      // Don't generate tactical events for them - they create feedback loops
      // in the conflict zone engine.
      if (matchedProfile.category === 'tanker' || matchedProfile.category === 'transport') continue

      // Check proximity to each conflict zone
      for (const zone of zones) {
        const distKm = haversineDistanceKm(flight.latitude!, flight.longitude!, zone.lat, zone.lon)
        const radiusKm = nmToKm(zone.radiusNm)

        if (distKm > radiusKm) continue

        // Calculate final score
        const multiplier = zoneMultiplier(zone.sensitivity)
        const finalScore = matchedProfile.baseScore * multiplier
        const tier = scoreToTier(finalScore)
        if (!tier) continue // below threshold

        // Dedup: check if active HVA event for this aircraft in this zone within 2h
        const existing = findActiveHvaEvent(flight.icao24 || '', zone.name)
        if (existing) {
          // Update existing event's description
          updateTacticalEvent(existing.id, {
            description: `${matchedProfile.fullName} detected over ${zone.name}. ${CONTEXT_BLURBS[matchedProfile.category] || ''}`
          })
          continue
        }

        const contextBlurb = CONTEXT_BLURBS[matchedProfile.category] || ''
        const description = `${matchedProfile.fullName} detected over ${zone.name}. ${contextBlurb}`

        const event: TacticalEvent = {
          id: uuidv4(),
          event_type: 'hva_tracking',
          severity: tier,
          description,
          assets: [flight.icao24 || flight.id],
          region: zone.name,
          detected_at: new Date().toISOString(),
          resolved_at: null,
          status: 'active',
          latitude: flight.latitude!,
          longitude: flight.longitude!
        }

        insertTacticalEvent(event)
        console.log(`[TacticalEngine] hva_tracking ${tier}: ${matchedProfile.fullName} over ${zone.name}`)
      }
    }
  } catch (err) {
    console.error('[TacticalEngine] HVA proximity detection error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Detection Algorithm C: Formation Flight Detection ──────

function detectFormationFlights(): void {
  try {
    const db = getDatabase()
    if (!db) return

    // Active military flights from last 30 minutes
    const flights = db
      .prepare(
        `SELECT * FROM flights
         WHERE is_military = 1
           AND timestamp >= datetime('now', '-30 minutes')
           AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND heading IS NOT NULL`
      )
      .all() as FlightRow[]

    if (flights.length < 3) return

    // Filter out training aircraft (not tactically significant for formation detection)
    const TRAINING_TYPES = ['T-6', 'T-6A', 'T-6B', 'T-38', 'T-38C', 'T-45', 'T-45C', 'T-1', 'T-1A']
    const significantFlights = flights.filter(f => {
      const type = (f.aircraft_type || '').toUpperCase()
      return !TRAINING_TYPES.some(t => type.includes(t.toUpperCase()))
    })

    if (significantFlights.length < 3) return

    // Cluster flights by proximity and heading
    const visited = new Set<number>()
    const clusters: FlightRow[][] = []

    for (let i = 0; i < significantFlights.length; i++) {
      if (visited.has(i)) continue
      const cluster: FlightRow[] = [significantFlights[i]]
      visited.add(i)

      for (let j = i + 1; j < significantFlights.length; j++) {
        if (visited.has(j)) continue
        const distKm = haversineDistanceKm(
          significantFlights[i].latitude!,
          significantFlights[i].longitude!,
          significantFlights[j].latitude!,
          significantFlights[j].longitude!
        )
        const distNm = distKm / 1.852

        if (distNm <= 10) {
          // Check heading alignment (within 30°)
          const h1 = significantFlights[i].heading ?? 0
          const h2 = significantFlights[j].heading ?? 0
          const headingDiff = Math.abs(h1 - h2)
          if (headingDiff <= 30 || headingDiff >= 330) {
            cluster.push(significantFlights[j])
            visited.add(j)
          }
        }
      }

      if (cluster.length >= 3) {
        clusters.push(cluster)
      }
    }

    for (const cluster of clusters) {
      // Only generate formation flight events when aircraft are within a conflict zone.
      // Formations outside all zones (e.g. training at home base) are not tactically relevant.
      const containingZone = findZoneContainingPoint(cluster[0].latitude!, cluster[0].longitude!)
      if (!containingZone) continue

      const avgHeading = cluster.reduce((sum, f) => sum + (f.heading ?? 0), 0) / cluster.length
      const direction = bearingToDirection(avgHeading)
      const regionName = containingZone.name
      const eventRegion = `formation-${regionName}`

      // Dedup: same zone within 1 hour
      if (isRecentEvent('formation_flight', eventRegion, 1)) continue

      const typeList = [...new Set(cluster.map((f) => f.aircraft_type || 'military aircraft'))]
      const assetIds = [...new Set(cluster.map((f) => f.icao24 || f.id))]

      const description =
        `Formation detected: ${cluster.length} military aircraft (${typeList.join(', ')}) ` +
        `flying in close proximity heading ${direction} near ${regionName}.`

      // Calculate centroid of formation aircraft positions
      const positions = cluster.map(f => ({ lat: f.latitude!, lon: f.longitude! }))
      const centroid = calculateCentroid(positions)

      const event: TacticalEvent = {
        id: uuidv4(),
        event_type: 'formation_flight',
        severity: 'WATCH',
        description,
        assets: assetIds,
        region: eventRegion,
        detected_at: new Date().toISOString(),
        resolved_at: null,
        status: 'active',
        latitude: centroid.lat,
        longitude: centroid.lon
      }

      insertTacticalEvent(event)
      console.log(`[TacticalEngine] formation_flight WATCH: ${cluster.length} aircraft near ${regionName}`)
    }
  } catch (err) {
    console.error('[TacticalEngine] Formation flight detection error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Detection Algorithm D: Naval Formation / Task Force ────

function detectNavalFormations(): void {
  try {
    const db = getDatabase()
    if (!db) return

    // Get active military vessels (dedup by MMSI, keeping latest position per vessel)
    const vessels = db
      .prepare(
        `SELECT v.*, vr.vessel_class
         FROM vessels v
         INNER JOIN (
           SELECT mmsi, MAX(timestamp) as max_ts
           FROM vessels
           WHERE mmsi IS NOT NULL
           GROUP BY mmsi
         ) latest ON v.mmsi = latest.mmsi AND v.timestamp = latest.max_ts
         LEFT JOIN vessel_registry vr ON v.mmsi = vr.mmsi
         WHERE (v.ship_type = 'government'
            OR v.ship_name LIKE 'USS %' OR v.ship_name LIKE 'USNS %'
            OR v.ship_name LIKE 'HMS %' OR v.ship_name LIKE 'JS %'
            OR v.ship_name LIKE 'ROKS %')
         AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL`
      )
      .all() as Array<VesselRow & { vessel_class?: string | null }>

    if (vessels.length < 3) return

    // DBSCAN-inspired clustering: all members must be within threshold of each other
    const PROXIMITY_NM = 50
    const PROXIMITY_KM = PROXIMITY_NM * 1.852
    const HEADING_THRESHOLD = 30

    const visited = new Set<number>()
    const clusters: Array<typeof vessels> = []

    for (let i = 0; i < vessels.length; i++) {
      if (visited.has(i)) continue

      // Start a candidate cluster with vessel i
      const candidate: typeof vessels = [vessels[i]]
      const candidateIndices: number[] = [i]

      // Grow the cluster: add vessels that are within PROXIMITY_KM of ALL existing members
      let changed = true
      while (changed) {
        changed = false
        for (let j = 0; j < vessels.length; j++) {
          if (visited.has(j) || candidateIndices.includes(j)) continue

          // Check if vessel j is within proximity of EVERY vessel already in the candidate
          const closeToAll = candidate.every((member) => {
            const distKm = haversineDistanceKm(
              member.latitude!,
              member.longitude!,
              vessels[j].latitude!,
              vessels[j].longitude!
            )
            return distKm <= PROXIMITY_KM
          })

          if (closeToAll) {
            // Also check heading similarity (skip heading check if heading is null/0)
            const jHeading = vessels[j].heading
            if (jHeading !== null && jHeading !== undefined && jHeading !== 0) {
              const headingMatch = candidate.some((member) => {
                const mHeading = member.heading ?? 0
                if (mHeading === 0) return true // Skip if member has no heading
                const diff = Math.abs(mHeading - jHeading)
                return diff <= HEADING_THRESHOLD || diff >= (360 - HEADING_THRESHOLD)
              })
              if (!headingMatch) continue
            }

            candidate.push(vessels[j])
            candidateIndices.push(j)
            changed = true
          }
        }
      }

      // Mark all cluster members as visited
      for (const idx of candidateIndices) {
        visited.add(idx)
      }

      if (candidate.length >= 3) {
        clusters.push(candidate)
      }
    }

    for (const cluster of clusters) {
      // Only generate task force events when vessels are within a conflict zone.
      // Vessels at home port (e.g. Norfolk, VA) are not tactically significant.
      const containingZone = findZoneContainingPoint(cluster[0].latitude!, cluster[0].longitude!)
      if (!containingZone) continue

      const regionName = containingZone.name
      const isHighSensitivity = containingZone.sensitivity === 'high'

      // Classify formation
      let eventType: TacticalEvent['event_type'] = 'task_force'
      const vesselClasses = cluster.map((v) => (v.vessel_class || '').toLowerCase())
      const shipNames = cluster.map((v) => (v.ship_name || '').toLowerCase())

      const hasCarrier =
        vesselClasses.some((c) => c.includes('carrier') || c.includes('cvn')) ||
        shipNames.some((n) => n.includes('carrier'))
      const hasAmphibious =
        vesselClasses.some((c) => c.includes('amphibious') || c.includes('lhd') || c.includes('lha')) ||
        shipNames.some((n) => n.includes('amphibious') || n.includes('lhd') || n.includes('lha'))

      if (hasCarrier) eventType = 'csg'
      else if (hasAmphibious) eventType = 'arg'

      const formationType =
        eventType === 'csg' ? 'Carrier Strike Group' : eventType === 'arg' ? 'Amphibious Ready Group' : 'Task Force'

      const eventRegion = `${eventType}-${regionName}`

      // Dedup: same formation within 2 hours
      if (isRecentEvent(eventType, eventRegion, 2)) continue

      const severity: IntelTier = isHighSensitivity && (eventType === 'csg' || eventType === 'arg') ? 'ALERT' : 'WATCH'
      const assetIds = [...new Set(cluster.map((v) => v.mmsi || v.id))]

      // Dedup vessel names by MMSI to avoid counting duplicate rows
      const uniqueVessels = new Map<string, { name: string; mmsi: string }>()
      for (const v of cluster) {
        const key = v.mmsi || v.id
        if (!uniqueVessels.has(key)) {
          uniqueVessels.set(key, { name: v.ship_name || 'unknown', mmsi: v.mmsi || v.id })
        }
      }
      const nameList = [...uniqueVessels.values()].map(v => v.name).join(', ')
      const actualCount = uniqueVessels.size

      const description =
        `${formationType} detected: ${actualCount} vessels (${nameList}) ` +
        `operating near ${regionName}.`

      // Calculate centroid of vessel positions
      const positions = cluster.map(v => ({ lat: v.latitude!, lon: v.longitude! }))
      const centroid = calculateCentroid(positions)

      const event: TacticalEvent = {
        id: uuidv4(),
        event_type: eventType,
        severity,
        description,
        assets: assetIds,
        region: eventRegion,
        detected_at: new Date().toISOString(),
        resolved_at: null,
        status: 'active',
        latitude: centroid.lat,
        longitude: centroid.lon
      }

      insertTacticalEvent(event)
      console.log(`[TacticalEngine] ${eventType} ${severity}: ${actualCount} vessels near ${regionName}`)
    }
  } catch (err) {
    console.error('[TacticalEngine] Naval formation detection error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Detection Algorithm E: Strategic Bomber Projection ─────

function detectBomberProjection(): void {
  try {
    const db = getDatabase()
    if (!db) return
    const zones = loadZones()

    const flights = db
      .prepare(
        `SELECT f.*, ar.icao_type_code
         FROM flights f
         LEFT JOIN aircraft_registry ar ON f.icao24 = ar.icao24
         WHERE f.is_military = 1
           AND f.timestamp >= datetime('now', '-4 hours')
           AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL`
      )
      .all() as Array<FlightRow & { icao_type_code?: string | null }>

    for (const flight of flights) {
      const typeCode = (flight.icao_type_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const aircraftType = (flight.aircraft_type || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

      // Check if it's a bomber
      const isBomber = BOMBER_PREFIXES.some(
        (prefix) => typeCode.startsWith(prefix) || aircraftType.startsWith(prefix)
      )
      if (!isBomber) continue

      const lat = flight.latitude!
      const lon = flight.longitude!

      // Check if over home territory
      const isAdversary = typeCode.startsWith('TU') || typeCode.startsWith('T9') || typeCode.startsWith('T1') || typeCode.startsWith('Y2')
      const overUS = isInBoundingBox(lat, lon, HOME_TERRITORY.US)
      const overRussia = isInBoundingBox(lat, lon, HOME_TERRITORY.Russia)

      if (!isAdversary && overUS) continue // US bomber over US — normal
      if (isAdversary && overRussia) continue // Russian bomber over Russia — normal

      // Bomber is outside home territory — check proximity to conflict zones
      for (const zone of zones) {
        const distKm = haversineDistanceKm(lat, lon, zone.lat, zone.lon)
        const radiusKm = nmToKm(zone.radiusNm)

        if (distKm > radiusKm) continue
        if (zone.sensitivity === 'low') continue

        const eventRegion = `bomber-${zone.id}`

        // Dedup: same aircraft in same zone within 2 hours
        if (isRecentEvent('bomber_projection', eventRegion, 2)) continue

        const typeDesc = isAdversary ? 'Adversary strategic bomber' : 'Strategic bomber'
        const severity: IntelTier = isAdversary && zone.sensitivity === 'high' ? 'ALERT' : 'WATCH'

        const description =
          `${typeDesc} detected near ${zone.name}. Power projection mission indicated. ` +
          `Aircraft type: ${flight.aircraft_type || typeCode || 'unknown'}.`

        const event: TacticalEvent = {
          id: uuidv4(),
          event_type: 'bomber_projection',
          severity,
          description,
          assets: [flight.icao24 || flight.id],
          region: eventRegion,
          detected_at: new Date().toISOString(),
          resolved_at: null,
          status: 'active',
          latitude: lat,
          longitude: lon
        }

        insertTacticalEvent(event)
        console.log(`[TacticalEngine] bomber_projection ${severity}: ${typeDesc} near ${zone.name}`)
      }
    }
  } catch (err) {
    console.error('[TacticalEngine] Bomber projection detection error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Helpers ────────────────────────────────────────────────

function findNearestZone(lat: number, lon: number): ConflictZone | null {
  const zones = loadZones()
  let closest: ConflictZone | null = null
  let closestDist = Infinity

  for (const zone of zones) {
    // Arctic zone: only match if aircraft is actually above 70°N
    if (zone.id === 'arctic' && lat < 70) continue

    const dist = haversineDistanceKm(lat, lon, zone.lat, zone.lon)
    if (dist < closestDist) {
      closestDist = dist
      closest = zone
    }
  }

  // Don't assign a conflict zone if nothing is within 2000km
  if (closestDist > 2000) {
    // Fall back to REGION_AREAS (rectangular bounding boxes)
    for (const region of REGION_AREAS) {
      if (lat >= region.minLat && lat <= region.maxLat && lon >= region.minLon && lon <= region.maxLon) {
        // Return a synthetic ConflictZone from the region's center
        return {
          id: region.name.toLowerCase().replace(/\s+/g, '-'),
          name: region.name,
          lat: (region.minLat + region.maxLat) / 2,
          lon: (region.minLon + region.maxLon) / 2,
          radiusNm: 9999, // effectively infinite - already confirmed point is inside
          sensitivity: 'medium'
        }
      }
    }
    return null
  }

  return closest
}

/**
 * Returns the zone that actually contains the given point (within its radius).
 * Returns null if the point is outside all conflict zones.
 */
function findZoneContainingPoint(lat: number, lon: number): ConflictZone | null {
  const zones = loadZones()
  for (const zone of zones) {
    const distKm = haversineDistanceKm(lat, lon, zone.lat, zone.lon)
    const radiusKm = nmToKm(zone.radiusNm)
    if (distKm <= radiusKm) return zone
  }
  return null
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Main entry point — called after each ADS-B/AIS refresh cycle.
 * Runs all detection algorithms with debounce guard.
 */
export async function runTacticalAnalysis(): Promise<void> {
  const now = Date.now()
  if (now - lastRunTimestamp < DEBOUNCE_MS) {
    return // Debounced — skip if ran < 60s ago
  }
  lastRunTimestamp = now

  try {
    ensureTacticalEventsTable()
  } catch {
    // Table may already exist
  }

  // Step 1: Auto-resolve events older than 24 hours
  resolveOldEvents()

  // Step 2: Run each detection algorithm (defensive: each wrapped in try/catch)
  detectAirlifts()
  detectHvaProximity()
  detectFormationFlights()
  detectNavalFormations()
  detectBomberProjection()

  // Step 3: Sync tactical events into intel_items for the feed
  try {
    syncTacticalEventsToIntelFeed()
  } catch (err) {
    console.error('[TacticalEngine] Intel feed sync error:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Query tactical events from DB, optionally filtered by status.
 */
export async function getTacticalEvents(status?: string): Promise<TacticalEvent[]> {
  const db = getDatabase()
  if (!db) return []

  try {
    let rows: Array<Record<string, unknown>>
    if (status) {
      rows = db
        .prepare('SELECT * FROM tactical_events WHERE status = ? ORDER BY detected_at DESC')
        .all(status) as Array<Record<string, unknown>>
    } else {
      rows = db
        .prepare('SELECT * FROM tactical_events ORDER BY detected_at DESC')
        .all() as Array<Record<string, unknown>>
    }
    return rows.map(hydrateTacticalEvent)
  } catch (err) {
    console.error('[TacticalEngine] getTacticalEvents error:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * Get active tactical events only.
 */
export async function getActiveTacticalEvents(): Promise<TacticalEvent[]> {
  return getTacticalEvents('active')
}

/**
 * Startup cleanup: resolve stale tactical_events and delete expired intel items.
 * Should be called once on app startup, before any tactical analysis runs.
 */
export function cleanupStaleTacticalData(): void {
  try {
    ensureTacticalEventsTable()
  } catch {
    // Table may already exist
  }
  resolveOldEvents()

  // One-time cleanup: resolve active airlift events older than 1 hour
  // (aggressive dedup cleanup for the airlift duplication problem)
  try {
    const db = getDatabase()
    if (db) {
      const result = db
        .prepare(
          `UPDATE tactical_events
           SET status = 'resolved', resolved_at = datetime('now')
           WHERE event_type = 'airlift'
             AND status = 'active'
             AND datetime(detected_at) < datetime('now', '-1 hour')`
        )
        .run()
      if (result.changes > 0) {
        console.log(`[TacticalEngine] Cleanup: resolved ${result.changes} stale airlift events (>1h old)`)
      }
    }
  } catch (err) {
    console.error('[TacticalEngine] Airlift cleanup error:', err instanceof Error ? err.message : String(err))
  }

  // Clean up stale airlift intel items (pre-dedup-fix backlog)
  try {
    const db = getDatabase()
    if (db) {
      const staleResult = db.prepare(
        `DELETE FROM intel_items 
         WHERE categories LIKE '%airlift%' 
           AND datetime(expires_at) <= datetime('now')`
      ).run()
      if (staleResult.changes > 0) {
        console.log(`[TacticalEngine] Cleaned up ${staleResult.changes} expired airlift intel items`)
      }
    }
  } catch (err) {
    console.error('[TacticalEngine] Stale airlift intel cleanup error:', err instanceof Error ? err.message : String(err))
  }
}
