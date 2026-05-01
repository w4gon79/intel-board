/**
 * AIS Service – AISStream.io WebSocket Integration
 *
 * Connects to the AISStream.io real-time WebSocket feed, parses vessel
 * position messages, stores them in the `vessels` SQLite table, and
 * exposes the latest positions for the renderer map layer.
 *
 * Military vessel classification uses a layered live AIS approach:
 *   Layer 1: AIS type code 35 (government/military)
 *   Layer 2: Vessel name prefix (USS, HMS, etc.) — strongest signal
 *   Layer 3: MMSI flag state + type code combination
 *   Layer 4: Cross-validation against civilian name patterns
 *
 * Architecture:
 *   - WebSocket connection via `ws` npm package (Node.js, not browser API)
 *   - Automatic reconnection with exponential backoff
 *   - In-memory vessel cache (upsert pattern — update if exists, insert if new)
 *   - Periodic DB flush from memory → SQLite (every 10 seconds)
 *   - GeoJSON generation for Mapbox GL rendering
 *
 * WebSocket: wss://stream.aisstream.io/v0/stream
 * API docs:  https://docs.aisstream.io
 */

import WebSocket from 'ws'
import { getDatabase } from '../storage/database'
import { v4 as uuidv4 } from 'uuid'
import type { Vessel, VesselMarker } from '../../../shared/types'
import { getCachedVesselInfo } from '../identification/vesselLookup'
import { runTacticalAnalysis } from '../identification/tacticalEngine'
import { loadSettings } from '../../ipc/settings.handlers'
import { evaluateRules } from '../alerts/ruleEngine'

// ─── Configuration ───────────────────────────────────────────

const WS_URL = 'wss://stream.aisstream.io/v0/stream'
const DB_FLUSH_INTERVAL_MS = 10_000
const MAX_RECONNECT_DELAY_MS = 60_000
const BASE_RECONNECT_DELAY_MS = 2_000
const STALE_VESSEL_HOURS = 4  // Remove vessels with no update in 4 hours
const PURGE_BATCH_SIZE = 500
const PURGE_INTERVAL_MS = 30 * 60 * 1000  // 30 minutes

// ─── Choke point regions for congestion monitoring (from PRD) ──

export const CHOKE_POINTS = [
  {
    name: 'Strait of Hormuz',
    lat: 26.56, lon: 56.25, radiusKm: 75,
    transitCorridor: {
      minLat: 26.35, maxLat: 26.80,
      minLon: 56.15, maxLon: 56.60
    }
  },
  {
    name: 'Bab el-Mandeb',
    lat: 12.58, lon: 43.33, radiusKm: 75,
    transitCorridor: {
      minLat: 12.50, maxLat: 12.80,
      minLon: 43.25, maxLon: 43.55
    }
  },
  {
    name: 'Suez Canal',
    lat: 30.46, lon: 32.35, radiusKm: 60,
    transitCorridor: {
      minLat: 29.92, maxLat: 31.27,
      minLon: 32.28, maxLon: 32.70
    }
  },
  {
    name: 'Strait of Malacca',
    lat: 2.5, lon: 101.5, radiusKm: 120,
    transitCorridor: {
      minLat: 1.30, maxLat: 2.50,
      minLon: 101.20, maxLon: 102.60
    }
  },
  {
    name: 'Panama Canal',
    lat: 9.08, lon: -79.68, radiusKm: 45,
    transitCorridor: {
      minLat: 8.90, maxLat: 9.45,
      minLon: -80.00, maxLon: -79.50
    }
  },
  {
    name: 'Taiwan Strait',
    lat: 24.5, lon: 119.0, radiusKm: 90,
    transitCorridor: {
      minLat: 23.5, maxLat: 25.0,
      minLon: 118.8, maxLon: 120.0
    }
  },
  {
    name: 'Bosphorus',
    lat: 41.12, lon: 29.07, radiusKm: 30,
    transitCorridor: {
      minLat: 41.00, maxLat: 41.22,
      minLon: 28.95, maxLon: 29.12
    }
  },
  {
    name: 'Gibraltar',
    lat: 35.95, lon: -5.62, radiusKm: 60,
    transitCorridor: {
      minLat: 35.85, maxLat: 36.15,
      minLon: -5.65, maxLon: -5.30
    }
  }
] as const

// ─── Ship Type Codes (AIS standard) ─────────────────────────

function categorizeShipType(typeCode: number): string {
  // Per AIS standard (ITU-R M.1371):
  //   35 = Military operations / law enforcement / government vessels
  //        (covers police, customs, border patrol, harbor patrol, AND military)
  //   36 = Sailing, 37 = Pleasure Craft, 38-39 = Reserved
  if (typeCode === 35) return 'government'
  if (typeCode === 36) return 'sailing'
  if (typeCode === 37) return 'pleasure_craft'
  if (typeCode === 38 || typeCode === 39) return 'other'
  if (typeCode === 30) return 'fishing'
  if (typeCode === 31 || typeCode === 32) return 'towing'
  if (typeCode === 33) return 'dredging'
  if (typeCode === 34) return 'diving'
  const category = Math.floor(typeCode / 10)
  switch (category) {
    case 4: return 'cargo'
    case 5: return 'cargo'
    case 6: return 'passenger'
    case 7: return 'cargo'
    case 8: return 'tanker'
    case 9: return 'other'
    default: return 'unknown'
  }
}

// ─── Layered Military Classification ─────────────────────────
//
// Uses multiple signals from live AIS data to classify military vessels
// instead of relying on a stale bundled registry.
//
// Layer 2 (strongest): Vessel name prefix (USS, HMS, etc.)
// Layer 4 (safeguard):  Reject civilian-named vessels
// Layer 1 (primary):    AIS type code 35 (government/military)
// Layer 3 (confidence): MMSI flag state + type code combination

/** Military vessel name prefixes — set by the navy/government and broadcast via AIS */
const MILITARY_NAME_PREFIXES = [
  'USS ',    // United States Ship (US Navy)
  'USNS ',   // US Naval Ship (Military Sealift Command)
  'USCGC ',  // US Coast Guard Cutter
  'HMS ',    // Her/His Majesty's Ship (UK Royal Navy)
  'HMAS ',   // Royal Australian Navy
  'HMCS ',   // Royal Canadian Navy
  'INS ',    // Indian Navy / Israeli Navy
  'JDS ',    // Japan Maritime Self-Defense Force (older)
  'JS ',     // Japan Maritime Self-Defense Force (current)
  'HNMLS ',  // Royal Netherlands Navy (alternate spelling)
  'HNLMS ',  // Royal Netherlands Navy
  'ITS ',    // Italian Navy
  'SNS ',    // Spanish Navy
  'NRP ',    // Portuguese Navy
  'HDMS ',   // Royal Danish Navy
  'HNoMS ',  // Royal Norwegian Navy
  'ORP ',    // Polish Navy
  'TCG ',    // Turkish Navy
  'ROKS ',   // Republic of Korea Navy
  'BAP ',    // Peruvian Navy
  'ARM ',    // Mexican Navy
  'FS ',     // French Navy (Frégate — typically within name, e.g. "FS Provence")
] as const

/** Civilian vessel name patterns that indicate NOT military */
const CIVILIAN_VESSEL_NAME_PATTERNS = [
  // Cargo/commercial
  /\bOFFSHORE\b.*\bSUPPLY\b/i,
  /\bSUPPLY\s+VESSEL\b/i,
  /\bPLATFORM\s+SUPPLY\b/i,
  /\bCARGO\b/i,
  /\bTANKER\b/i,
  /\bCONTAINER\b/i,
  /\bBULKER\b/i,

  // Tugs and workboats
  /\bTUG\b/i,
  /\bPUSHBOAT\b/i,
  /\bPUSH\s+BOAT\b/i,

  // Dredging/construction
  /\bDREDGER\b/i,
  /\bDREDGING\b/i,
  /\bROCK\s*CUT/i,

  // Passenger/ferry
  /\bPASSENGER\b/i,
  /\bFERRY\b/i,
  /\bCRUISE\b/i,

  // Fishing
  /\bFISHING\b/i,
  /\bFISHER\b/i,
  /\bTRAWLER\b/i,

  // Research (civilian — military research vessels like HMS PROTECTOR are
  // caught by the military prefix check before this runs)
  /\bRESEARCH\b/i,
  /\bSURVEY\b/i,
  /\bOCEANOG/i,

  // Support/utility
  /\bPILOT\s*BOAT/i,
  /\bLIGHT\s*VESSEL/i,
  /\bBUOY\s*TENDER/i,
  /\bBUOY\b/i,
  /\bCABLE\s*SHIP/i,
  /\bCABLE\b/i,
  /\bPIPELAYER\b/i,
  /\bPIPE\s*LAY/i,

  // Pleasure/sailing
  /\bSAILING\b/i,
  /\bPLEASURE\b/i,
  /\bYACHT\b/i,

  // Inland waterway
  /\bINLAND\b/i,

  // Legacy broad patterns (kept for backwards compatibility)
  /barge/i,
]

/**
 * Countries with significant naval forces. Type code 35 vessels from
 * these countries' MIDs are more likely to be actual military.
 * MID = first 3 digits of MMSI (Maritime Identification Digits).
 */
const NAVAL_COUNTRY_MID_RANGES: Array<[number, number]> = [
  [303, 369],  // United States
  [232, 236],  // United Kingdom
  [224, 228],  // France
  [273, 273],  // Russia
  [412, 414],  // China
  [419, 419],  // India
  [431, 432],  // Japan
  [441, 441],  // South Korea
  [503, 503],  // Australia
  [211, 218],  // Germany
  [247, 248],  // Italy
  [224, 225],  // Spain
  [244, 246],  // Netherlands
  [271, 271],  // Turkey
  [263, 263],  // Israel
  [403, 403],  // Saudi Arabia
  [422, 422],  // Iran
  [710, 710],  // Brazil
]

/** Check if a vessel name starts with a known military prefix */
function hasMilitaryNamePrefix(name: string): boolean {
  const upper = name.toUpperCase()
  return MILITARY_NAME_PREFIXES.some((prefix) => upper.startsWith(prefix))
}

/** Check if a vessel name matches civilian patterns (guard: never rejects military-prefixed names) */
function hasCivilianVesselName(name: string): boolean {
  // Don't reject if the name has a military prefix (e.g. "HMS PROTECTOR" has RESEARCH but is military)
  if (hasMilitaryNamePrefix(name)) return false
  return CIVILIAN_VESSEL_NAME_PATTERNS.some((pattern) => pattern.test(name))
}

/** Check if an MID (first 3 digits of MMSI) belongs to a naval country */
function isNavalCountry(mid: number): boolean {
  return NAVAL_COUNTRY_MID_RANGES.some(([lo, hi]) => mid >= lo && mid <= hi)
}

/**
 * Classify a vessel as military or not using layered live AIS data.
 *
 * @param typeCode    AIS ship type code from ShipStaticData message
 * @param vesselName  AIS-broadcast vessel name (self-identified, most reliable)
 * @param mmsi        9-digit MMSI number (first 3 digits = flag state)
 * @returns true if vessel is classified as military
 */
function classifyMilitaryVessel(typeCode: number, vesselName: string | null, mmsi: string): boolean {
  // Layer 2 — vessel name prefix is the strongest signal
  // Military vessels broadcast names like "USS Nimitz", "HMS Defender", etc.
  if (vesselName && hasMilitaryNamePrefix(vesselName)) {
    return true
  }

  // Layer 2.5 — vessel name contains "WARSHIP" (covers "DANISH WARSHIP F342", etc.)
  if (vesselName && vesselName.toUpperCase().includes('WARSHIP')) {
    return true
  }

  // Layer 4 — reject civilian-named vessels even with type 35
  // If the vessel says its name is "STELLA MARIS", it's NOT a warship
  if (vesselName && hasCivilianVesselName(vesselName)) {
    return false
  }

  // Layer 1 — type code 35 is the primary military indicator
  // (covers military ops, law enforcement, police, customs, border patrol)
  // Government ship_type is rare and almost always indicates a naval/coast guard vessel.
  if (typeCode === 35) {
    // Layer 3 — combine with flag state for higher confidence
    const mid = parseInt(mmsi.substring(0, 3))
    if (isNavalCountry(mid)) {
      return true
    }
    // Type 35 from non-naval country — could be coast guard/police.
    // Default government vessels to military since the type is rare and
    // almost exclusively used by naval/coast guard vessels.
    return true
  }

  // No military signals detected
  return false
}

// ─── State ───────────────────────────────────────────────────

let ws: WebSocket | null = null
let isConnected = false
let isConnecting = false
let lastMessageTime = 0
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let purgeTimer: ReturnType<typeof setInterval> | null = null
const vesselCache = new Map<string, Vessel>()
const vesselTypeCodes = new Map<string, number>()

// ─── GeoJSON generation ─────────────────────────────────────

export interface VesselFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    id: string
    mmsi: string
    imo: string | null
    ship_name: string | null
    ship_type: string | null
    ship_type_code: number
    vessel_class: string | null
    speed: number | null
    heading: number | null
    destination: string | null
    is_military: boolean
    timestamp: string | null
  }
}

export interface VesselFeatureCollection {
  type: 'FeatureCollection'
  features: VesselFeature[]
}

export function getVesselGeoJSON(): VesselFeatureCollection {
  const features: VesselFeature[] = []

  for (const [mmsi, v] of vesselCache) {
    if (v.latitude == null || v.longitude == null) continue
    const typeCode = vesselTypeCodes.get(mmsi) ?? 0

    // Look up vessel class from registry cache
    let vesselClass: string | null = null
    try {
      const vesselInfo = getCachedVesselInfo(mmsi)
      vesselClass = vesselInfo?.vessel_class ?? null
    } catch {
      vesselClass = null
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [v.longitude, v.latitude]
      },
      properties: {
        id: v.id,
        mmsi: v.mmsi ?? mmsi,
        imo: v.imo,
        ship_name: v.ship_name,
        ship_type: v.ship_type,
        ship_type_code: typeCode,
        vessel_class: vesselClass,
        speed: v.speed,
        heading: v.heading,
        destination: v.destination,
        is_military: classifyMilitaryVessel(typeCode, v.ship_name, mmsi),
        timestamp: v.timestamp
      }
    })
  }

  return { type: 'FeatureCollection', features }
}

// ─── AISStream.io message types ─────────────────────────────
// Based on actual raw messages from AISStream.io:
// PositionReport fields: UserID, Longitude, Latitude, Sog, Cog, TrueHeading, ...
// ShipStaticData fields: UserID, Name, Type, Destination, ImoNumber, ...

interface AisMessagePosition {
  UserID: number
  Longitude: number
  Latitude: number
  Sog?: number | null
  Cog?: number | null
  TrueHeading?: number | null
  NavigationalStatus?: number | null
  Timestamp?: number | null
  MessageID?: number
  PositionAccuracy?: boolean
  Raim?: boolean
  RateOfTurn?: number
  RepeatIndicator?: number
  Valid?: boolean
}

interface AisMessageStaticData {
  UserID: number
  Name?: string | null
  Type?: number | null
  Destination?: string | null
  ImoNumber?: number | null
  CallSign?: string | null
  Dimension?: { A: number; B: number; C: number; D: number } | null
  MaximumStaticDraught?: number | null
  Eta?: { Month: number; Day: number; Hour: number; Minute: number } | null
  FixType?: number | null
  AisVersion?: number | null
  Valid?: boolean
}

interface AisStreamMessage {
  MessageType: string
  Message: {
    PositionReport?: AisMessagePosition | null
    ShipStaticData?: AisMessageStaticData | null
  } | null
  MetaData?: {
    MMSI?: number
    MMSI_String?: number
    ShipName?: string | null
    latitude?: number
    longitude?: number
    time_utc?: string | null
  } | null
}

// ─── Message processing ─────────────────────────────────────

function processPositionReport(pos: AisMessagePosition, metaDataMmsi?: number): void {
  const mmsi = String(pos.UserID || metaDataMmsi)
  if (!mmsi || mmsi === '0' || mmsi === 'NaN' || mmsi === 'undefined') return

  // Skip invalid positions
  if (pos.Longitude == null || pos.Latitude == null) return
  if (Math.abs(pos.Longitude) > 180 || Math.abs(pos.Latitude) > 90) return
  if (pos.Longitude === 181 || pos.Latitude === 91) return

  const existing = vesselCache.get(mmsi)

  const speed = pos.Sog != null ? Math.round(pos.Sog * 10) / 10 : null
  const heading = pos.Cog != null && pos.Cog !== 360
    ? Math.round(pos.Cog * 10) / 10
    : (pos.TrueHeading != null && pos.TrueHeading !== 511 ? pos.TrueHeading : null)

  const vessel: Vessel = {
    id: existing?.id ?? uuidv4(),
    mmsi,
    imo: existing?.imo ?? null,
    ship_name: existing?.ship_name ?? null,
    ship_type: existing?.ship_type ?? null,
    latitude: pos.Latitude,
    longitude: pos.Longitude,
    speed,
    heading,
    destination: existing?.destination ?? null,
    timestamp: new Date().toISOString()
  }

  vesselCache.set(mmsi, vessel)
}

function processShipStaticData(staticData: AisMessageStaticData, metaDataMmsi?: number): void {
  const mmsi = String(staticData.UserID || metaDataMmsi)
  if (!mmsi || mmsi === '0' || mmsi === 'NaN' || mmsi === 'undefined') return

  const existing = vesselCache.get(mmsi)
  const typeCode = staticData.Type ?? 0

  if (!existing) {
    vesselCache.set(mmsi, {
      id: uuidv4(),
      mmsi,
      imo: staticData.ImoNumber != null && staticData.ImoNumber > 0 ? String(staticData.ImoNumber) : null,
      ship_name: staticData.Name?.trim() || null,
      ship_type: typeCode > 0 ? categorizeShipType(typeCode) : null,
      latitude: null,
      longitude: null,
      speed: null,
      heading: null,
      destination: staticData.Destination?.trim() || null,
      timestamp: new Date().toISOString()
    })
    if (typeCode > 0) {
      vesselTypeCodes.set(mmsi, typeCode)
    }
  } else {
    const effectiveTypeCode = typeCode > 0 ? typeCode : (vesselTypeCodes.get(mmsi) ?? 0)
    if (staticData.ImoNumber != null && staticData.ImoNumber > 0) {
      existing.imo = String(staticData.ImoNumber)
    }
    if (staticData.Name?.trim()) {
      existing.ship_name = staticData.Name.trim()
    }
    if (staticData.Destination?.trim()) {
      existing.destination = staticData.Destination.trim()
    }
    if (effectiveTypeCode > 0) {
      existing.ship_type = categorizeShipType(effectiveTypeCode)
      vesselTypeCodes.set(mmsi, effectiveTypeCode)
    }
  }

  // Log if classified as military (useful for debugging the new classifier)
  const effectiveCode = typeCode > 0 ? typeCode : (vesselTypeCodes.get(mmsi) ?? 0)
  const vesselName = staticData.Name?.trim() || existing?.ship_name || null
  if (classifyMilitaryVessel(effectiveCode, vesselName, mmsi)) {
    console.log(`[AIS] Military vessel detected: MMSI ${mmsi} name="${vesselName}" type=${effectiveCode}`)
  }
}

// ─── Stale vessel purge ──────────────────────────────────────

/**
 * Safely purge stale vessels in small batches.
 * Only purges from the database - the in-memory cache is managed
 * by the live AIS stream and will naturally drop stale entries
 * when they stop receiving updates.
 */
function purgeStaleVessels(): void {
  const db = getDatabase()
  if (!db) return

  try {
    const cutoff = new Date(Date.now() - STALE_VESSEL_HOURS * 60 * 60 * 1000).toISOString()

    // Step 1: Count how many stale vessels exist
    const count = db.prepare(
      `SELECT COUNT(*) as c FROM vessels WHERE timestamp < ?`
    ).get(cutoff) as { c: number }

    if (count.c === 0) {
      console.log('[AIS] Stale vessel purge: nothing to clean')
      return
    }

    console.log(`[AIS] Stale vessel purge: ${count.c} vessels older than ${STALE_VESSEL_HOURS}h, purging in batches of ${PURGE_BATCH_SIZE}`)

    // Step 2: Purge in batches to avoid locking the DB
    let totalPurged = 0
    const batchPurge = () => {
      try {
        const result = db.prepare(
          `DELETE FROM vessels WHERE rowid IN (
            SELECT rowid FROM vessels WHERE timestamp < ? LIMIT ?
          )`
        ).run(cutoff, PURGE_BATCH_SIZE)

        totalPurged += result.changes

        if (result.changes === PURGE_BATCH_SIZE) {
          // More to purge - schedule next batch after a short delay
          // to yield to the event loop and keep the app responsive
          setTimeout(batchPurge, 500)
        } else {
          console.log(`[AIS] Stale vessel purge complete: ${totalPurged} removed from DB`)
        }
      } catch (err) {
        console.error('[AIS] Stale vessel purge batch error:', err instanceof Error ? err.message : String(err))
      }
    }

    // Start the first batch
    batchPurge()

    // Step 3: Clean up in-memory cache separately and gently
    // Only remove entries that are very stale (2x the threshold)
    // This is a soft cleanup - live data naturally overwrites stale entries
    const cacheCutoff = new Date(Date.now() - STALE_VESSEL_HOURS * 2 * 60 * 60 * 1000).toISOString()
    let cachePurged = 0
    for (const [mmsi, vessel] of vesselCache) {
      if (vessel.timestamp && vessel.timestamp < cacheCutoff) {
        vesselCache.delete(mmsi)
        cachePurged++
      }
    }
    if (cachePurged > 0) {
      console.log(`[AIS] Stale vessel cache cleanup: ${cachePurged} entries removed (>${STALE_VESSEL_HOURS * 2}h old)`)
    }

  } catch (err) {
    console.error('[AIS] Stale vessel purge error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Stale data cleanup ──────────────────────────────────────
//
// The old bundled naval registry classified 128k+ vessels as "military"
// incorrectly. The new live AIS classifier is accurate. This cleanup
// resets stale classifications so only live-classified vessels show as
// military. Also clears bundled vessel_registry entries (identified by
// having vessel_class set, which only the old JSON file populated).

function cleanupStaleMilitaryData(): void {
  const db = getDatabase()
  if (!db) return

  try {
    // Step 1: Reset all military ship_type classifications in vessels table.
    // Live AIS data will re-populate correctly as new messages arrive.
    const vesselResult = db.prepare(
      "UPDATE vessels SET ship_type = 'unknown' WHERE ship_type = 'military'"
    ).run()
    console.log(`[AIS] Cleanup: reset ${vesselResult.changes} stale military classifications in vessels table`)

    // Step 2: Clear vessel_registry entries from the bundled naval registry.
    // These have vessel_class set (e.g. "Arleigh Burke-class") which was only
    // ever populated from the stale JSON file, not from live AIS data.
    const registryResult = db.prepare(
      'DELETE FROM vessel_registry WHERE vessel_class IS NOT NULL'
    ).run()
    console.log(`[AIS] Cleanup: removed ${registryResult.changes} bundled registry entries from vessel_registry`)
  } catch (err) {
    console.error('[AIS] Stale data cleanup error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Restore vessel cache from database on startup ──────────

function restoreVesselsFromDatabase(): number {
  const db = getDatabase()
  if (!db) return 0

  try {
    // Load vessels with valid positions from the last 2 hours
    const rows = db.prepare(`
      SELECT id, mmsi, imo, ship_name, ship_type, latitude, longitude, speed, heading, destination, timestamp
      FROM vessels
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      AND timestamp > datetime('now', '-4 hours')
      ORDER BY timestamp DESC
    `).all() as Array<{
      id: string; mmsi: string; imo: string | null; ship_name: string | null
      ship_type: string | null; latitude: number; longitude: number
      speed: number | null; heading: number | null; destination: string | null
      timestamp: string | null
    }>

    // Deduplicate by MMSI (keep most recent since ORDER BY timestamp DESC)
    for (const row of rows) {
      if (!vesselCache.has(row.mmsi)) {
        vesselCache.set(row.mmsi, {
          id: row.id,
          mmsi: row.mmsi,
          imo: row.imo,
          ship_name: row.ship_name,
          ship_type: row.ship_type,
          latitude: row.latitude,
          longitude: row.longitude,
          speed: row.speed,
          heading: row.heading,
          destination: row.destination,
          timestamp: row.timestamp
        })
      }
    }

    console.log(`[AIS] Restored ${rows.length} vessels from database (${vesselCache.size} unique in cache)`)
    return rows.length
  } catch (err) {
    console.error('[AIS] Failed to restore vessels from database:', err instanceof Error ? err.message : String(err))
    return 0
  }
}

// ─── SQLite persistence ──────────────────────────────────────

function flushToDatabase(): void {
  const db = getDatabase()
  if (!db || vesselCache.size === 0) return

  const insert = db.prepare(`
    INSERT OR REPLACE INTO vessels (id, mmsi, imo, ship_name, ship_type, latitude, longitude, speed, heading, destination, timestamp)
    VALUES (@id, @mmsi, @imo, @ship_name, @ship_type, @latitude, @longitude, @speed, @heading, @destination, @timestamp)
  `)

  const transaction = db.transaction(() => {
    for (const v of vesselCache.values()) {
      insert.run({
        id: v.id,
        mmsi: v.mmsi,
        imo: v.imo,
        ship_name: v.ship_name,
        ship_type: v.ship_type,
        latitude: v.latitude,
        longitude: v.longitude,
        speed: v.speed,
        heading: v.heading,
        destination: v.destination,
        timestamp: v.timestamp
      })
    }
  })

  try {
    transaction()
    console.log(`[AIS] Flushed ${vesselCache.size} vessels to database`)

    // Run tactical analysis after flush (debounced internally)
    runTacticalAnalysis().catch((err) =>
      console.error('[AIS] Tactical analysis error:', err instanceof Error ? err.message : String(err))
    )

    // Evaluate custom alert rules against current vessel cache (Phase 5A)
    try {
      const vessels = Array.from(vesselCache.values()).map((v) => ({
        id: v.id,
        name: v.ship_name ?? undefined,
        type: v.ship_type ?? undefined,
        lat: v.latitude ?? undefined,
        lon: v.longitude ?? undefined,
        speed: v.speed ?? undefined,
        heading: v.heading ?? undefined,
        destination: v.destination ?? undefined,
        mmsi: v.mmsi ?? undefined
      }))
      evaluateRules('ship', vessels)
    } catch (err) {
      console.error('[AIS] Rule evaluation error:', err instanceof Error ? err.message : String(err))
    }
  } catch (err) {
    console.error('[AIS] Database flush error:', err instanceof Error ? err.message : String(err))
  }
}

// ─── API Key ────────────────────────────────────────────

/** Read AISStream API key from app settings */
function getApiKey(): string {
  try {
    const settings = loadSettings()
    return settings.apiKeys?.aisstreamApiKey || ''
  } catch {
    return ''
  }
}

// ─── WebSocket connection ────────────────────────────────────

function connectWebSocket(): void {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[AIS] No AISStream API key configured in settings — AIS service disabled')
    return
  }

  if (isConnecting || isConnected) return

  isConnecting = true
  console.log('[AIS] Connecting to AISStream.io WebSocket...')

  try {
    ws = new WebSocket(WS_URL)

    ws.on('open', () => {
      console.log('[AIS] WebSocket connected')
      isConnected = true
      isConnecting = false
      reconnectAttempts = 0

      const subscribeMessage = {
        Apikey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: [],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData']
      }

      ws?.send(JSON.stringify(subscribeMessage))
      console.log('[AIS] Sent subscription message (global coverage)')
    })

    let messageCount = 0

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(String(raw)) as AisStreamMessage
        messageCount++

        if (messageCount <= 3) {
          console.log(`[AIS] Raw message #${messageCount}:`, JSON.stringify(parsed).slice(0, 600))
        }

        const msgData = parsed.Message
        const metaMmsi = parsed.MetaData?.MMSI

        switch (parsed.MessageType) {
          case 'PositionReport':
            if (msgData?.PositionReport) {
              lastMessageTime = Date.now()
              processPositionReport(msgData.PositionReport, metaMmsi)
            }
            break
          case 'ShipStaticData':
            if (msgData?.ShipStaticData) {
              processShipStaticData(msgData.ShipStaticData, metaMmsi)
            }
            break
        }

        if (messageCount % 1000 === 0) {
          console.log(`[AIS] Processed ${messageCount} messages, ${vesselCache.size} vessels tracked`)
        }
      } catch {
        // Skip non-JSON messages
      }
    })

    ws.on('error', (err: Error) => {
      console.error('[AIS] WebSocket error:', err.message)
      isConnecting = false
    })

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[AIS] WebSocket closed (code: ${code}, reason: ${reason.toString() || 'none'})`)
      isConnected = false
      isConnecting = false
      ws = null

      if (reconnectAttempts < 100) {
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts),
          MAX_RECONNECT_DELAY_MS
        )
        reconnectAttempts++
        console.log(`[AIS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})`)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connectWebSocket()
        }, delay)
      }
    })
  } catch (err) {
    console.error('[AIS] WebSocket connection error:', err instanceof Error ? err.message : String(err))
    isConnecting = false
  }
}

// ─── Public API ──────────────────────────────────────────────

export function getLiveVesselMarkers(): VesselMarker[] {
  const markers: VesselMarker[] = []
  for (const v of vesselCache.values()) {
    if (v.latitude == null || v.longitude == null) continue
    markers.push({
      id: v.id,
      mmsi: v.mmsi,
      imo: v.imo,
      ship_name: v.ship_name,
      ship_type: v.ship_type,
      latitude: v.latitude,
      longitude: v.longitude,
      speed: v.speed,
      heading: v.heading,
      destination: v.destination,
      timestamp: v.timestamp
    })
  }
  return markers
}

export function getVesselDetails(id: string): Vessel | null {
  for (const v of vesselCache.values()) {
    if (v.id === id) return v
  }
  const db = getDatabase()
  if (!db) return null
  return db.prepare('SELECT * FROM vessels WHERE id = ?').get(id) as Vessel | null
}

export function getVesselCount(): number {
  let count = 0
  for (const v of vesselCache.values()) {
    if (v.latitude != null && v.longitude != null) count++
  }
  return count
}

export function getVesselCountsByCategory(): {
  total: number
  military: number
  cargo: number
  tanker: number
  passenger: number
} {
  let military = 0, cargo = 0, tanker = 0, passenger = 0, total = 0

  for (const [mmsi, v] of vesselCache) {
    if (v.latitude == null || v.longitude == null) continue
    total++

    const typeCode = vesselTypeCodes.get(mmsi) ?? 0
    if (classifyMilitaryVessel(typeCode, v.ship_name, mmsi)) {
      military++
    } else {
      switch (v.ship_type) {
        case 'cargo': cargo++; break
        case 'tanker': tanker++; break
        case 'passenger': passenger++; break
      }
    }
  }

  return { total, military, cargo, tanker, passenger }
}

export function getChokePointCounts(): Array<{
  name: string
  vesselCount: number
  lat: number
  lon: number
}> {
  return CHOKE_POINTS.map((cp) => {
    let count = 0
    for (const v of vesselCache.values()) {
      if (v.latitude == null || v.longitude == null) continue
      const distKm = haversineDistance(cp.lat, cp.lon, v.latitude, v.longitude)
      if (distKm <= cp.radiusKm) count++
    }
    return { name: cp.name, vesselCount: count, lat: cp.lat, lon: cp.lon }
  })
}

export function startAisStreaming(): void {
  if (isConnected || isConnecting) {
    console.warn('[AIS] Already connected or connecting')
    return
  }

  console.log('[AIS] Starting AIS service')

  // Clean up stale military classifications from the old bundled registry
  cleanupStaleMilitaryData()

  // Restore recent vessels from database so the map shows data immediately
  restoreVesselsFromDatabase()

  connectWebSocket()

  if (!flushTimer) {
    flushTimer = setInterval(flushToDatabase, DB_FLUSH_INTERVAL_MS)
  }

  // Purge stale vessels every 30 minutes (batched to avoid DB locking)
  if (!purgeTimer) {
    purgeTimer = setInterval(purgeStaleVessels, PURGE_INTERVAL_MS)
  }
}

export function stopAisStreaming(): void {
  console.log('[AIS] Stopping AIS service')

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (ws) {
    ws.removeAllListeners()
    ws.close()
    ws = null
  }

  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }

  if (purgeTimer) {
    clearInterval(purgeTimer)
    purgeTimer = null
  }

  try {
    flushToDatabase()
  } catch {
    // DB may already be closed during shutdown
  }

  isConnected = false
  isConnecting = false
  reconnectAttempts = 0
}

export function isAisConnected(): boolean {
  return isConnected
}

export function getAisFeedHealth(): { connected: boolean; lastMessageAgeMs: number; feedAlive: boolean } {
  return {
    connected: isAisConnected(),
    lastMessageAgeMs: lastMessageTime ? Date.now() - lastMessageTime : -1,
    feedAlive: lastMessageTime > 0 && (Date.now() - lastMessageTime) < 60_000
  }
}

// ─── Utility ─────────────────────────────────────────────────

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}