/**
 * Database Service Layer — CRUD operations for all Intel Board tables.
 *
 * All write operations use prepared statements for performance.
 * JSON fields (entities, topics, sources, categories) are auto-serialized/deserialized.
 */

import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from './database'

/** Row type returned by better-sqlite3 queries */
type DbRow = Record<string, unknown>

import type {
  Article,
  InsertArticle,
  Flight,
  InsertFlight,
  Vessel,
  InsertVessel,
  IntelItem,
  InsertIntelItem,
  Anomaly,
  InsertAnomaly,
  Prediction,
  PredictionReviewInfo,
  InsertPrediction,
  IntelTier
} from '../../../shared/types'

// ── Helpers ──

/** Serialize a value to JSON string for SQLite storage */
function toJson(value: unknown[] | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

/** Parse a JSON string from SQLite back to an array */
function fromJson<T>(value: string | null | undefined): T[] {
  if (!value) return []
  try {
    return JSON.parse(value) as T[]
  } catch {
    return []
  }
}

// Type helpers for hydrating rows from SQLite
function hydrateArticle(row: DbRow): Article {
  return {
    id: row.id as string,
    source: row.source as string,
    title: (row.title as string) ?? null,
    content: (row.content as string) ?? null,
    url: (row.url as string) ?? null,
    published_at: (row.published_at as string) ?? null,
    ingested_at: row.ingested_at as string,
    sentiment: (row.sentiment as number) ?? null,
    entities: fromJson<string>(row.entities as string | null),
    region: (row.region as string) ?? null,
    topics: fromJson<string>(row.topics as string | null)
  }
}

function hydrateIntelItem(row: DbRow): IntelItem {
  return {
    id: row.id as string,
    tier: row.tier as IntelTier,
    title: row.title as string,
    summary: (row.summary as string) ?? null,
    analysis: (row.analysis as string) ?? null,
    confidence: (row.confidence as number) ?? null,
    sources: fromJson<string>(row.sources as string | null),
    region: (row.region as string) ?? null,
    categories: fromJson<string>(row.categories as string | null),
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? null,
    expires_at: (row.expires_at as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null
  }
}

function hydratePrediction(row: DbRow): Prediction {
  return {
    id: row.id as string,
    prediction_text: (row.prediction_text as string) ?? null,
    confidence: (row.confidence as number) ?? null,
    model_used: (row.model_used as string) ?? null,
    sources: fromJson<string>(row.sources as string | null),
    predicted_at: row.predicted_at as string,
    expected_by: (row.expected_by as string) ?? null,
    outcome: (row.outcome as string) ?? null,
    resolved_at: (row.resolved_at as string) ?? null,
    was_accurate: (row.was_accurate as boolean) ?? null
  }
}

// ════════════════════════════════════════════
// ARTICLES
// ════════════════════════════════════════════

let stmtArticleInsert: Database.Statement | null = null
let stmtArticleGetById: Database.Statement | null = null
let stmtArticleGetAll: Database.Statement | null = null
let stmtArticleGetByRegion: Database.Statement | null = null
let stmtArticleGetBySource: Database.Statement | null = null
let stmtArticleGetRecent: Database.Statement | null = null
let stmtArticleDeleteById: Database.Statement | null = null
let stmtArticleCount: Database.Statement | null = null

function prepareArticleStatements(db: Database.Database): void {
  if (stmtArticleInsert) return
  stmtArticleInsert = db.prepare(`
    INSERT INTO articles (id, source, title, content, url, published_at, ingested_at, sentiment, entities, region, topics)
    VALUES (@id, @source, @title, @content, @url, @published_at, @ingested_at, @sentiment, @entities, @region, @topics)
  `)
  stmtArticleGetById = db.prepare('SELECT * FROM articles WHERE id = ?')
  stmtArticleGetAll = db.prepare(
    'SELECT * FROM articles ORDER BY ingested_at DESC LIMIT ? OFFSET ?'
  )
  stmtArticleGetByRegion = db.prepare(
    'SELECT * FROM articles WHERE region = ? ORDER BY ingested_at DESC LIMIT ?'
  )
  stmtArticleGetBySource = db.prepare(
    'SELECT * FROM articles WHERE source = ? ORDER BY ingested_at DESC LIMIT ?'
  )
  stmtArticleGetRecent = db.prepare(
    "SELECT * FROM articles WHERE ingested_at >= datetime('now', ?) ORDER BY ingested_at DESC"
  )
  stmtArticleDeleteById = db.prepare('DELETE FROM articles WHERE id = ?')
  stmtArticleCount = db.prepare('SELECT COUNT(*) as count FROM articles')
}

export function insertArticle(data: InsertArticle): Article {
  const db = getDatabase()
  prepareArticleStatements(db)
  const id = uuidv4()
  const ingested_at = new Date().toISOString()

  stmtArticleInsert!.run({
    id,
    source: data.source,
    title: data.title,
    content: data.content,
    url: data.url,
    published_at: data.published_at,
    ingested_at,
    sentiment: data.sentiment,
    entities: toJson(data.entities),
    region: data.region,
    topics: toJson(data.topics)
  })

  return { ...data, id, ingested_at } as Article
}

export function getArticleById(id: string): Article | undefined {
  const db = getDatabase()
  prepareArticleStatements(db)
  const row = stmtArticleGetById!.get(id) as DbRow | undefined
  return row ? hydrateArticle(row) : undefined
}

export function getArticles(limit = 50, offset = 0): Article[] {
  const db = getDatabase()
  prepareArticleStatements(db)
  const rows = stmtArticleGetAll!.all(limit, offset) as DbRow[]
  return rows.map(hydrateArticle)
}

export function getArticlesByRegion(region: string, limit = 50): Article[] {
  const db = getDatabase()
  prepareArticleStatements(db)
  const rows = stmtArticleGetByRegion!.all(region, limit) as DbRow[]
  return rows.map(hydrateArticle)
}

export function getArticlesBySource(source: string, limit = 50): Article[] {
  const db = getDatabase()
  prepareArticleStatements(db)
  const rows = stmtArticleGetBySource!.all(source, limit) as DbRow[]
  return rows.map(hydrateArticle)
}

export function getRecentArticles(hoursBack = 24): Article[] {
  const db = getDatabase()
  prepareArticleStatements(db)
  const rows = stmtArticleGetRecent!.all(`-${hoursBack} hours`) as DbRow[]
  return rows.map(hydrateArticle)
}

export function deleteArticle(id: string): boolean {
  const db = getDatabase()
  prepareArticleStatements(db)
  const result = stmtArticleDeleteById!.run(id)
  return result.changes > 0
}

export function getArticleCount(): number {
  const db = getDatabase()
  prepareArticleStatements(db)
  const result = stmtArticleCount!.get() as DbRow
  return result.count as number
}

// ════════════════════════════════════════════
// FLIGHTS
// ════════════════════════════════════════════

let stmtFlightInsert: Database.Statement | null = null
let stmtFlightGetById: Database.Statement | null = null
let stmtFlightGetRecent: Database.Statement | null = null
let stmtFlightGetMilitary: Database.Statement | null = null
let stmtFlightGetByIcao: Database.Statement | null = null
let stmtFlightDeleteOld: Database.Statement | null = null
let stmtFlightCount: Database.Statement | null = null

function prepareFlightStatements(db: Database.Database): void {
  if (stmtFlightInsert) return
  stmtFlightInsert = db.prepare(`
    INSERT INTO flights (id, icao24, callsign, origin_country, latitude, longitude, altitude, velocity, heading, is_military, aircraft_type, timestamp)
    VALUES (@id, @icao24, @callsign, @origin_country, @latitude, @longitude, @altitude, @velocity, @heading, @is_military, @aircraft_type, @timestamp)
  `)
  stmtFlightGetById = db.prepare('SELECT * FROM flights WHERE id = ?')
  stmtFlightGetRecent = db.prepare(
    "SELECT * FROM flights WHERE timestamp >= datetime('now', ?) ORDER BY timestamp DESC LIMIT ?"
  )
  stmtFlightGetMilitary = db.prepare(
    'SELECT * FROM flights WHERE is_military = 1 ORDER BY timestamp DESC LIMIT ?'
  )
  stmtFlightGetByIcao = db.prepare(
    'SELECT * FROM flights WHERE icao24 = ? ORDER BY timestamp DESC LIMIT ?'
  )
  stmtFlightDeleteOld = db.prepare(
    "DELETE FROM flights WHERE timestamp < datetime('now', ?)"
  )
  stmtFlightCount = db.prepare('SELECT COUNT(*) as count FROM flights')
}

export function insertFlight(data: InsertFlight): Flight {
  const db = getDatabase()
  prepareFlightStatements(db)
  const id = uuidv4()
  stmtFlightInsert!.run({
    id,
    icao24: data.icao24,
    callsign: data.callsign,
    origin_country: data.origin_country,
    latitude: data.latitude,
    longitude: data.longitude,
    altitude: data.altitude,
    velocity: data.velocity,
    heading: data.heading,
    is_military: data.is_military ? 1 : 0,
    aircraft_type: data.aircraft_type,
    timestamp: data.timestamp
  })
  return { ...data, id } as Flight
}

export function insertFlightsBatch(data: InsertFlight[]): number {
  const db = getDatabase()
  prepareFlightStatements(db)
  const stmt = stmtFlightInsert!
  const insertMany = db.transaction((items: InsertFlight[]) => {
    let count = 0
    for (const item of items) {
      stmt.run({
        id: uuidv4(),
        icao24: item.icao24,
        callsign: item.callsign,
        origin_country: item.origin_country,
        latitude: item.latitude,
        longitude: item.longitude,
        altitude: item.altitude,
        velocity: item.velocity,
        heading: item.heading,
        is_military: item.is_military ? 1 : 0,
        aircraft_type: item.aircraft_type,
        timestamp: item.timestamp
      })
      count++
    }
    return count
  })
  return insertMany(data)
}

export function getFlightById(id: string): Flight | undefined {
  const db = getDatabase()
  prepareFlightStatements(db)
  return stmtFlightGetById!.get(id) as Flight | undefined
}

export function getRecentFlights(hoursBack = 1, limit = 1000): Flight[] {
  const db = getDatabase()
  prepareFlightStatements(db)
  return stmtFlightGetRecent!.all(`-${hoursBack} hours`, limit) as Flight[]
}

export function getMilitaryFlights(limit = 500): Flight[] {
  const db = getDatabase()
  prepareFlightStatements(db)
  return stmtFlightGetMilitary!.all(limit) as Flight[]
}

export function getFlightsByIcao(icao24: string, limit = 100): Flight[] {
  const db = getDatabase()
  prepareFlightStatements(db)
  return stmtFlightGetByIcao!.all(icao24, limit) as Flight[]
}

export function deleteOldFlights(olderThanDays = 7): number {
  const db = getDatabase()
  prepareFlightStatements(db)
  const result = stmtFlightDeleteOld!.run(`-${olderThanDays} days`)
  return result.changes
}

export function getFlightCount(): number {
  const db = getDatabase()
  prepareFlightStatements(db)
  const result = stmtFlightCount!.get() as DbRow
  return result.count as number
}

// ════════════════════════════════════════════
// VESSELS
// ════════════════════════════════════════════

let stmtVesselInsert: Database.Statement | null = null
let stmtVesselGetById: Database.Statement | null = null
let stmtVesselGetRecent: Database.Statement | null = null
let stmtVesselGetByMmsi: Database.Statement | null = null
let stmtVesselGetByType: Database.Statement | null = null
let stmtVesselDeleteOld: Database.Statement | null = null
let stmtVesselCount: Database.Statement | null = null

function prepareVesselStatements(db: Database.Database): void {
  if (stmtVesselInsert) return
  stmtVesselInsert = db.prepare(`
    INSERT INTO vessels (id, mmsi, imo, ship_name, ship_type, latitude, longitude, speed, heading, destination, timestamp)
    VALUES (@id, @mmsi, @imo, @ship_name, @ship_type, @latitude, @longitude, @speed, @heading, @destination, @timestamp)
  `)
  stmtVesselGetById = db.prepare('SELECT * FROM vessels WHERE id = ?')
  stmtVesselGetRecent = db.prepare(
    "SELECT * FROM vessels WHERE timestamp >= datetime('now', ?) ORDER BY timestamp DESC LIMIT ?"
  )
  stmtVesselGetByMmsi = db.prepare(
    'SELECT * FROM vessels WHERE mmsi = ? ORDER BY timestamp DESC LIMIT ?'
  )
  stmtVesselGetByType = db.prepare(
    'SELECT * FROM vessels WHERE ship_type = ? ORDER BY timestamp DESC LIMIT ?'
  )
  stmtVesselDeleteOld = db.prepare(
    "DELETE FROM vessels WHERE timestamp < datetime('now', ?)"
  )
  stmtVesselCount = db.prepare('SELECT COUNT(*) as count FROM vessels')
}

export function insertVessel(data: InsertVessel): Vessel {
  const db = getDatabase()
  prepareVesselStatements(db)
  const id = uuidv4()
  stmtVesselInsert!.run({
    id,
    mmsi: data.mmsi,
    imo: data.imo,
    ship_name: data.ship_name,
    ship_type: data.ship_type,
    latitude: data.latitude,
    longitude: data.longitude,
    speed: data.speed,
    heading: data.heading,
    destination: data.destination,
    timestamp: data.timestamp
  })
  return { ...data, id } as Vessel
}

export function insertVesselsBatch(data: InsertVessel[]): number {
  const db = getDatabase()
  prepareVesselStatements(db)
  const stmt = stmtVesselInsert!
  const insertMany = db.transaction((items: InsertVessel[]) => {
    let count = 0
    for (const item of items) {
      stmt.run({
        id: uuidv4(),
        mmsi: item.mmsi,
        imo: item.imo,
        ship_name: item.ship_name,
        ship_type: item.ship_type,
        latitude: item.latitude,
        longitude: item.longitude,
        speed: item.speed,
        heading: item.heading,
        destination: item.destination,
        timestamp: item.timestamp
      })
      count++
    }
    return count
  })
  return insertMany(data)
}

export function getVesselById(id: string): Vessel | undefined {
  const db = getDatabase()
  prepareVesselStatements(db)
  return stmtVesselGetById!.get(id) as Vessel | undefined
}

export function getRecentVessels(hoursBack = 1, limit = 1000): Vessel[] {
  const db = getDatabase()
  prepareVesselStatements(db)
  return stmtVesselGetRecent!.all(`-${hoursBack} hours`, limit) as Vessel[]
}

export function getVesselsByMmsi(mmsi: string, limit = 100): Vessel[] {
  const db = getDatabase()
  prepareVesselStatements(db)
  return stmtVesselGetByMmsi!.all(mmsi, limit) as Vessel[]
}

export function getVesselsByType(shipType: string, limit = 500): Vessel[] {
  const db = getDatabase()
  prepareVesselStatements(db)
  return stmtVesselGetByType!.all(shipType, limit) as Vessel[]
}

export function deleteOldVessels(olderThanDays = 7): number {
  const db = getDatabase()
  prepareVesselStatements(db)
  const result = stmtVesselDeleteOld!.run(`-${olderThanDays} days`)
  return result.changes
}

export function getVesselCount(): number {
  const db = getDatabase()
  prepareVesselStatements(db)
  const result = stmtVesselCount!.get() as DbRow
  return result.count as number
}

// ════════════════════════════════════════════
// INTEL ITEMS
// ════════════════════════════════════════════

let stmtIntelInsert: Database.Statement | null = null
let stmtIntelGetById: Database.Statement | null = null
let stmtIntelGetByTier: Database.Statement | null = null
let stmtIntelGetByRegion: Database.Statement | null = null
let stmtIntelGetRecent: Database.Statement | null = null
let stmtIntelUpdate: Database.Statement | null = null
let stmtIntelDeleteById: Database.Statement | null = null
let stmtIntelDeleteExpired: Database.Statement | null = null
let stmtIntelCount: Database.Statement | null = null
let stmtIntelCountByTier: Database.Statement | null = null

function prepareIntelStatements(db: Database.Database): void {
  if (stmtIntelInsert) return
  stmtIntelInsert = db.prepare(`
    INSERT INTO intel_items (id, tier, title, summary, analysis, confidence, sources, region, categories, created_at, updated_at, expires_at, latitude, longitude)
    VALUES (@id, @tier, @title, @summary, @analysis, @confidence, @sources, @region, @categories, @created_at, @updated_at, @expires_at, @latitude, @longitude)
  `)
  stmtIntelGetById = db.prepare('SELECT * FROM intel_items WHERE id = ?')
  stmtIntelGetByTier = db.prepare(
    'SELECT * FROM intel_items WHERE tier = ? ORDER BY created_at DESC LIMIT ?'
  )
  stmtIntelGetByRegion = db.prepare(
    'SELECT * FROM intel_items WHERE region = ? ORDER BY created_at DESC LIMIT ?'
  )
  stmtIntelGetRecent = db.prepare(
    'SELECT * FROM intel_items ORDER BY created_at DESC LIMIT ? OFFSET ?'
  )
  stmtIntelUpdate = db.prepare(`
    UPDATE intel_items
    SET summary = @summary, analysis = @analysis, confidence = @confidence,
        sources = @sources, categories = @categories, updated_at = @updated_at,
        expires_at = @expires_at
    WHERE id = @id
  `)
  stmtIntelDeleteById = db.prepare('DELETE FROM intel_items WHERE id = ?')
  stmtIntelDeleteExpired = db.prepare(
  "DELETE FROM intel_items WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')"
  )
  stmtIntelCount = db.prepare('SELECT COUNT(*) as count FROM intel_items')
  stmtIntelCountByTier = db.prepare(
    'SELECT tier, COUNT(*) as count FROM intel_items GROUP BY tier'
  )
}

export function insertIntelItem(data: InsertIntelItem): IntelItem {
  const db = getDatabase()
  prepareIntelStatements(db)
  const id = uuidv4()
  const created_at = new Date().toISOString()

  stmtIntelInsert!.run({
    id,
    tier: data.tier,
    title: data.title,
    summary: data.summary,
    analysis: data.analysis,
    confidence: data.confidence,
    sources: toJson(data.sources),
    region: data.region,
    categories: toJson(data.categories),
    created_at,
    updated_at: data.updated_at ?? null,
    expires_at: data.expires_at ?? null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null
  })

  return { ...data, id, created_at } as IntelItem
}

export function getIntelItemById(id: string): IntelItem | undefined {
  const db = getDatabase()
  prepareIntelStatements(db)
  const row = stmtIntelGetById!.get(id) as DbRow | undefined
  return row ? hydrateIntelItem(row) : undefined
}

export function getIntelItemsByTier(tier: IntelTier, limit = 50): IntelItem[] {
  const db = getDatabase()
  prepareIntelStatements(db)
  const rows = stmtIntelGetByTier!.all(tier, limit) as DbRow[]
  return rows.map(hydrateIntelItem)
}

export function getIntelItemsByRegion(region: string, limit = 50): IntelItem[] {
  const db = getDatabase()
  prepareIntelStatements(db)
  const rows = stmtIntelGetByRegion!.all(region, limit) as DbRow[]
  return rows.map(hydrateIntelItem)
}

export function getRecentIntelItems(limit = 50, offset = 0): IntelItem[] {
  const db = getDatabase()
  prepareIntelStatements(db)
  const rows = stmtIntelGetRecent!.all(limit, offset) as DbRow[]
  return rows.map(hydrateIntelItem)
}

export function updateIntelItem(
  id: string,
  data: Partial<
    Pick<IntelItem, 'summary' | 'analysis' | 'confidence' | 'sources' | 'categories' | 'expires_at'>
  >
): boolean {
  const existing = getIntelItemById(id)
  if (!existing) return false

  const db = getDatabase()
  prepareIntelStatements(db)
  stmtIntelUpdate!.run({
    id,
    summary: data.summary ?? existing.summary,
    analysis: data.analysis ?? existing.analysis,
    confidence: data.confidence ?? existing.confidence,
    sources: toJson(data.sources ?? existing.sources),
    categories: toJson(data.categories ?? existing.categories),
    updated_at: new Date().toISOString(),
    expires_at: data.expires_at ?? existing.expires_at
  })
  return true
}

export function deleteIntelItem(id: string): boolean {
  const db = getDatabase()
  prepareIntelStatements(db)
  const result = stmtIntelDeleteById!.run(id)
  return result.changes > 0
}

export function deleteExpiredIntelItems(): number {
  const db = getDatabase()
  prepareIntelStatements(db)
  const result = stmtIntelDeleteExpired!.run()
  return result.changes
}

export function getIntelItemCount(): number {
  const db = getDatabase()
  prepareIntelStatements(db)
  const result = stmtIntelCount!.get() as DbRow
  return result.count as number
}

export function getIntelItemCountByTier(): Record<string, number> {
  const db = getDatabase()
  prepareIntelStatements(db)
  const rows = stmtIntelCountByTier!.all() as DbRow[]
  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.tier as string] = row.count as number
  }
  return result
}

// ════════════════════════════════════════════
// ANOMALIES
// ════════════════════════════════════════════

let stmtAnomalyInsert: Database.Statement | null = null
let stmtAnomalyGetById: Database.Statement | null = null
let stmtAnomalyGetActive: Database.Statement | null = null
let stmtAnomalyGetBySource: Database.Statement | null = null
let stmtAnomalyResolve: Database.Statement | null = null
let stmtAnomalyCount: Database.Statement | null = null

function prepareAnomalyStatements(db: Database.Database): void {
  if (stmtAnomalyInsert) return
  stmtAnomalyInsert = db.prepare(`
    INSERT INTO anomalies (id, source_type, metric, region, baseline_value, observed_value, deviation_sigma, detected_at, resolved_at, status)
    VALUES (@id, @source_type, @metric, @region, @baseline_value, @observed_value, @deviation_sigma, @detected_at, @resolved_at, @status)
  `)
  stmtAnomalyGetById = db.prepare('SELECT * FROM anomalies WHERE id = ?')
  stmtAnomalyGetActive = db.prepare(
    "SELECT * FROM anomalies WHERE status = 'active' ORDER BY detected_at DESC LIMIT ?"
  )
  stmtAnomalyGetBySource = db.prepare(
    'SELECT * FROM anomalies WHERE source_type = ? ORDER BY detected_at DESC LIMIT ?'
  )
  stmtAnomalyResolve = db.prepare(
    "UPDATE anomalies SET status = 'resolved', resolved_at = @resolved_at WHERE id = @id"
  )
  stmtAnomalyCount = db.prepare(
    "SELECT COUNT(*) as count FROM anomalies WHERE status = 'active'"
  )
}

export function insertAnomaly(data: InsertAnomaly): Anomaly {
  const db = getDatabase()
  prepareAnomalyStatements(db)
  const id = uuidv4()
  const detected_at = new Date().toISOString()

  stmtAnomalyInsert!.run({
    id,
    source_type: data.source_type,
    metric: data.metric,
    region: data.region,
    baseline_value: data.baseline_value,
    observed_value: data.observed_value,
    deviation_sigma: data.deviation_sigma,
    detected_at,
    resolved_at: data.resolved_at ?? null,
    status: data.status ?? 'active'
  })

  return { ...data, id, detected_at } as Anomaly
}

export function getAnomalyById(id: string): Anomaly | undefined {
  const db = getDatabase()
  prepareAnomalyStatements(db)
  return stmtAnomalyGetById!.get(id) as Anomaly | undefined
}

export function getActiveAnomalies(limit = 100): Anomaly[] {
  const db = getDatabase()
  prepareAnomalyStatements(db)
  return stmtAnomalyGetActive!.all(limit) as Anomaly[]
}

export function getAnomaliesBySourceType(sourceType: string, limit = 100): Anomaly[] {
  const db = getDatabase()
  prepareAnomalyStatements(db)
  return stmtAnomalyGetBySource!.all(sourceType, limit) as Anomaly[]
}

export function resolveAnomaly(id: string): boolean {
  const db = getDatabase()
  prepareAnomalyStatements(db)
  const result = stmtAnomalyResolve!.run({
    id,
    resolved_at: new Date().toISOString()
  })
  return result.changes > 0
}

export function getActiveAnomalyCount(): number {
  const db = getDatabase()
  prepareAnomalyStatements(db)
  const result = stmtAnomalyCount!.get() as DbRow
  return result.count as number
}

// ════════════════════════════════════════════
// PREDICTIONS
// ════════════════════════════════════════════

let stmtPredictionInsert: Database.Statement | null = null
let stmtPredictionGetById: Database.Statement | null = null
let stmtPredictionGetUnresolved: Database.Statement | null = null
let stmtPredictionResolve: Database.Statement | null = null
let stmtPredictionCount: Database.Statement | null = null

function preparePredictionStatements(db: Database.Database): void {
  if (stmtPredictionInsert) return
  stmtPredictionInsert = db.prepare(`
    INSERT INTO predictions (id, prediction_text, confidence, model_used, sources, predicted_at, expected_by, outcome, resolved_at, was_accurate)
    VALUES (@id, @prediction_text, @confidence, @model_used, @sources, @predicted_at, @expected_by, @outcome, @resolved_at, @was_accurate)
  `)
  stmtPredictionGetById = db.prepare('SELECT * FROM predictions WHERE id = ?')
  stmtPredictionGetUnresolved = db.prepare(
    'SELECT * FROM predictions WHERE resolved_at IS NULL ORDER BY predicted_at DESC LIMIT ?'
  )
  stmtPredictionResolve = db.prepare(`
    UPDATE predictions
    SET outcome = @outcome, resolved_at = @resolved_at, was_accurate = @was_accurate
    WHERE id = @id
  `)
  stmtPredictionCount = db.prepare('SELECT COUNT(*) as count FROM predictions')
}

export function insertPrediction(data: InsertPrediction): Prediction {
  const db = getDatabase()
  preparePredictionStatements(db)
  const id = uuidv4()
  const predicted_at = new Date().toISOString()

  stmtPredictionInsert!.run({
    id,
    prediction_text: data.prediction_text,
    confidence: data.confidence,
    model_used: data.model_used,
    sources: toJson(data.sources),
    predicted_at,
    expected_by: data.expected_by,
    outcome: data.outcome ?? null,
    resolved_at: data.resolved_at ?? null,
    was_accurate: data.was_accurate ?? null
  })

  return { ...data, id, predicted_at } as Prediction
}

export function getPredictionById(id: string): Prediction | undefined {
  const db = getDatabase()
  preparePredictionStatements(db)
  const row = stmtPredictionGetById!.get(id) as DbRow | undefined
  return row ? hydratePrediction(row) : undefined
}

export function getUnresolvedPredictions(limit = 50): Prediction[] {
  const db = getDatabase()
  preparePredictionStatements(db)
  const rows = stmtPredictionGetUnresolved!.all(limit) as DbRow[]
  return rows.map(hydratePrediction)
}

export function resolvePrediction(
  id: string,
  outcome: string,
  wasAccurate: boolean | null
): boolean {
  const db = getDatabase()
  preparePredictionStatements(db)
  const result = stmtPredictionResolve!.run({
    id,
    outcome,
    resolved_at: new Date().toISOString(),
    was_accurate: wasAccurate === null ? null : wasAccurate ? 1 : 0
  })
  return result.changes > 0
}

export function getPredictionCount(): number {
  const db = getDatabase()
  preparePredictionStatements(db)
  const result = stmtPredictionCount!.get() as DbRow
  return result.count as number
}

/**
 * Get all predictions with their most recent review data joined in.
 * Sorted in tiers: Active (unresolved, not overdue) → Overdue (unresolved, past expected_by) → Analyzed (resolved).
 * Analyzed predictions older than 48 hours from review/resolved date are excluded.
 * Uses tiered subqueries so each tier gets its own slot allocation.
 */
export function getPredictionsWithReviews(): Array<Prediction & { review?: PredictionReviewInfo }> {
  const db = getDatabase()
  const rows = db.prepare(
    `SELECT * FROM (
      SELECT *,
        CASE WHEN resolved_at IS NULL AND (expected_by IS NULL OR datetime(expected_by) >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) THEN 0
             WHEN resolved_at IS NULL AND expected_by IS NOT NULL AND datetime(expected_by) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 1
             ELSE 2
        END as sort_tier
      FROM (
        -- Tier 1: Active (unresolved, not overdue)
        SELECT * FROM (
          SELECT p.*, pr.outcome as review_outcome, pr.reasoning as review_reasoning,
            pr.key_finding as review_key_finding, pr.evidence as review_evidence,
            pr.reviewed_at as review_reviewed_at, pr.model_used as review_model
          FROM predictions p
          LEFT JOIN prediction_reviews pr ON pr.prediction_id = p.id AND pr.id = (
            SELECT pr2.id FROM prediction_reviews pr2 WHERE pr2.prediction_id = p.id ORDER BY pr2.reviewed_at DESC LIMIT 1
          )
          WHERE p.resolved_at IS NULL AND (p.expected_by IS NULL OR datetime(p.expected_by) >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ORDER BY p.predicted_at DESC
          LIMIT 20
        )

        UNION ALL

        -- Tier 2: Overdue (unresolved, past expected_by)
        SELECT * FROM (
          SELECT p.*, pr.outcome as review_outcome, pr.reasoning as review_reasoning,
            pr.key_finding as review_key_finding, pr.evidence as review_evidence,
            pr.reviewed_at as review_reviewed_at, pr.model_used as review_model
          FROM predictions p
          LEFT JOIN prediction_reviews pr ON pr.prediction_id = p.id AND pr.id = (
            SELECT pr2.id FROM prediction_reviews pr2 WHERE pr2.prediction_id = p.id ORDER BY pr2.reviewed_at DESC LIMIT 1
          )
          WHERE p.resolved_at IS NULL AND p.expected_by IS NOT NULL AND datetime(p.expected_by) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ORDER BY p.expected_by DESC
          LIMIT 15
        )

        UNION ALL

        -- Tier 3: Analyzed (resolved, within 48h)
        SELECT * FROM (
          SELECT p.*, pr.outcome as review_outcome, pr.reasoning as review_reasoning,
            pr.key_finding as review_key_finding, pr.evidence as review_evidence,
            pr.reviewed_at as review_reviewed_at, pr.model_used as review_model
          FROM predictions p
          INNER JOIN prediction_reviews pr ON pr.prediction_id = p.id AND pr.id = (
            SELECT pr2.id FROM prediction_reviews pr2 WHERE pr2.prediction_id = p.id ORDER BY pr2.reviewed_at DESC LIMIT 1
          )
          WHERE p.resolved_at IS NOT NULL
            AND pr.reviewed_at IS NOT NULL
            AND pr.reviewed_at > datetime('now', '-48 hours')
          ORDER BY pr.reviewed_at DESC
          LIMIT 15
        )
      )
    )
    ORDER BY sort_tier ASC,
      CASE WHEN sort_tier = 0 THEN predicted_at
           WHEN sort_tier = 1 THEN expected_by
           ELSE COALESCE(review_reviewed_at, resolved_at)
      END DESC`
  ).all() as DbRow[]

  return rows.map((row) => {
    const evidence =
      typeof row.review_evidence === 'string'
        ? (() => { try { return JSON.parse(row.review_evidence || '[]') } catch { return [] } })()
        : []
    return {
      ...hydratePrediction(row),
      review: row.review_outcome
        ? {
            review_outcome: (row.review_outcome as string) ?? null,
            review_reasoning: (row.review_reasoning as string) ?? null,
            review_key_finding: (row.review_key_finding as string) ?? null,
            review_evidence_count: Array.isArray(evidence) ? evidence.length : 0,
            review_reviewed_at: (row.review_reviewed_at as string) ?? null,
            review_model: (row.review_model as string) ?? null
          }
        : undefined
    }
  })
}

// ════════════════════════════════════════════
// PREDICTION REVIEWS
// ════════════════════════════════════════════

export interface ReviewEvidence {
  source: string
  title: string
  snippet: string
  url: string
  publishedAt: string
  supportsPrediction: 'supports' | 'contradicts' | 'neutral'
}

export interface PredictionReview {
  id: string
  prediction_id: string
  outcome: string
  was_accurate: boolean | null
  evidence: ReviewEvidence[]
  reasoning: string | null
  key_finding: string | null
  evidence_score: string | null
  model_used: string | null
  reviewed_at: string
}

export interface CalibrationStats {
  category: string
  region: string
  total_predictions: number
  accurate_count: number
  inaccurate_count: number
  partial_count: number
  inconclusive_count: number
  accuracy_rate: number
  failure_pattern: string | null
}

let stmtReviewInsert: Database.Statement | null = null
let stmtReviewGetByPredictionId: Database.Statement | null = null
let stmtReviewGetRecent: Database.Statement | null = null

function prepareReviewStatements(db: Database.Database): void {
  if (stmtReviewInsert) return
  stmtReviewInsert = db.prepare(`
    INSERT INTO prediction_reviews (id, prediction_id, outcome, was_accurate, evidence, reasoning, key_finding, evidence_score, model_used, reviewed_at)
    VALUES (@id, @prediction_id, @outcome, @was_accurate, @evidence, @reasoning, @key_finding, @evidence_score, @model_used, @reviewed_at)
  `)
  stmtReviewGetByPredictionId = db.prepare(
    'SELECT * FROM prediction_reviews WHERE prediction_id = ? ORDER BY reviewed_at DESC'
  )
  stmtReviewGetRecent = db.prepare(
    'SELECT * FROM prediction_reviews ORDER BY reviewed_at DESC LIMIT ?'
  )
}

export function insertReview(data: {
  predictionId: string
  outcome: string
  wasAccurate: boolean | null
  evidence: ReviewEvidence[]
  reasoning: string
  keyFinding: string
  evidenceScore: string
  modelUsed: string
}): string {
  const db = getDatabase()
  prepareReviewStatements(db)
  const id = uuidv4()

  stmtReviewInsert!.run({
    id,
    prediction_id: data.predictionId,
    outcome: data.outcome,
    was_accurate: data.wasAccurate === null ? null : data.wasAccurate ? 1 : 0,
    evidence: JSON.stringify(data.evidence),
    reasoning: data.reasoning,
    key_finding: data.keyFinding,
    evidence_score: data.evidenceScore,
    model_used: data.modelUsed,
    reviewed_at: new Date().toISOString()
  })

  return id
}

function hydrateReview(row: DbRow): PredictionReview {
  return {
    id: row.id as string,
    prediction_id: row.prediction_id as string,
    outcome: row.outcome as string,
    was_accurate: row.was_accurate === 1 ? true : row.was_accurate === 0 ? false : null,
    evidence: fromJson<ReviewEvidence>(row.evidence as string | null),
    reasoning: (row.reasoning as string) ?? null,
    key_finding: (row.key_finding as string) ?? null,
    evidence_score: (row.evidence_score as string) ?? null,
    model_used: (row.model_used as string) ?? null,
    reviewed_at: row.reviewed_at as string
  }
}

export function getReviewsByPredictionId(predictionId: string): PredictionReview[] {
  const db = getDatabase()
  prepareReviewStatements(db)
  const rows = stmtReviewGetByPredictionId!.all(predictionId) as DbRow[]
  return rows.map(hydrateReview)
}

export function getRecentReviews(limit = 10): PredictionReview[] {
  const db = getDatabase()
  prepareReviewStatements(db)
  const rows = stmtReviewGetRecent!.all(limit) as DbRow[]
  return rows.map(hydrateReview)
}

// ════════════════════════════════════════════
// PREDICTION CALIBRATION
// ════════════════════════════════════════════

export function updateCalibration(category: string, region: string, stats: Omit<CalibrationStats, 'category' | 'region'>): void {
  const db = getDatabase()

  // If failure_pattern is null in stats, preserve the existing one
  const existing = db
    .prepare('SELECT failure_pattern FROM prediction_calibration WHERE category = ? AND region = ?')
    .get(category, region) as { failure_pattern: string | null } | undefined

  const failurePattern = stats.failure_pattern ?? existing?.failure_pattern ?? null

  db.prepare(`
    INSERT INTO prediction_calibration (category, region, total_predictions, accurate_count, inaccurate_count, partial_count, inconclusive_count, accuracy_rate, failure_pattern, updated_at)
    VALUES (@category, @region, @total_predictions, @accurate_count, @inaccurate_count, @partial_count, @inconclusive_count, @accuracy_rate, @failure_pattern, @updated_at)
    ON CONFLICT(category, region) DO UPDATE SET
      total_predictions = @total_predictions,
      accurate_count = @accurate_count,
      inaccurate_count = @inaccurate_count,
      partial_count = @partial_count,
      inconclusive_count = @inconclusive_count,
      accuracy_rate = @accuracy_rate,
      failure_pattern = CASE WHEN @failure_pattern IS NOT NULL THEN @failure_pattern ELSE prediction_calibration.failure_pattern END,
      updated_at = @updated_at
  `).run({
    category,
    region,
    total_predictions: stats.total_predictions,
    accurate_count: stats.accurate_count,
    inaccurate_count: stats.inaccurate_count,
    partial_count: stats.partial_count,
    inconclusive_count: stats.inconclusive_count,
    accuracy_rate: stats.accuracy_rate,
    failure_pattern: failurePattern,
    updated_at: new Date().toISOString()
  })
}

export function getCalibration(category: string, region?: string): CalibrationStats | null {
  const db = getDatabase()
  const row = db
    .prepare(
      'SELECT * FROM prediction_calibration WHERE category = ? AND region = ?'
    )
    .get(category, region ?? 'global') as DbRow | undefined
  if (!row) return null
  return {
    category: row.category as string,
    region: row.region as string,
    total_predictions: row.total_predictions as number,
    accurate_count: row.accurate_count as number,
    inaccurate_count: row.inaccurate_count as number,
    partial_count: row.partial_count as number,
    inconclusive_count: row.inconclusive_count as number,
    accuracy_rate: row.accuracy_rate as number,
    failure_pattern: (row.failure_pattern as string) ?? null
  }
}

export function getReviewCountsWithOutcome(): Array<{
  prediction_sources: string | null
  outcome: string
  was_accurate: number | null
}> {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT pr.outcome, pr.was_accurate, p.sources as prediction_sources
       FROM prediction_reviews pr
       JOIN predictions p ON pr.prediction_id = p.id`
    )
    .all() as Array<{ prediction_sources: string | null; outcome: string; was_accurate: number | null }>
}

export function getAllCalibrations(): CalibrationStats[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM prediction_calibration').all() as DbRow[]
  return rows.map((row) => ({
    category: row.category as string,
    region: row.region as string,
    total_predictions: row.total_predictions as number,
    accurate_count: row.accurate_count as number,
    inaccurate_count: row.inaccurate_count as number,
    partial_count: row.partial_count as number,
    inconclusive_count: row.inconclusive_count as number,
    accuracy_rate: row.accuracy_rate as number,
    failure_pattern: (row.failure_pattern as string) ?? null
  }))
}

// ════════════════════════════════════════════
// TACTICAL EVENTS
// ════════════════════════════════════════════

/**
 * Delete tactical events, optionally filtered by event type.
 * Cascades to intel_items that were auto-generated from those events.
 * Returns the number of deleted tactical event rows.
 */
export function deleteTacticalEvents(eventType?: string): number {
  const db = getDatabase()

  // Use a transaction so cascade + delete are atomic
  const cascadeDelete = db.transaction((evType?: string): number => {
    // 1) Cascade: delete intel items spawned by these tactical events.
    //    Tactical engine stores event_type in the intel item's categories JSON
    //    as ["<event_type>", "tactical"], so we match on that pattern.
    if (evType) {
      // Delete intel items whose categories contain both the event_type and "tactical"
      db.prepare(
        "DELETE FROM intel_items WHERE categories LIKE ? AND categories LIKE '%tactical%'"
      ).run(`%"${evType}"%`)
    } else {
      // No filter → delete ALL intel items tagged "tactical"
      db.prepare("DELETE FROM intel_items WHERE categories LIKE '%tactical%'").run()
    }

    // 2) Delete the tactical events themselves
    let result: Database.RunResult
    if (evType) {
      result = db.prepare('DELETE FROM tactical_events WHERE event_type = ?').run(evType)
    } else {
      result = db.prepare('DELETE FROM tactical_events').run()
    }
    return result.changes
  })

  return cascadeDelete(eventType)
}

// ════════════════════════════════════════════
// INTEL DELETE HELPERS
// ════════════════════════════════════════════

let stmtIntelDeleteByTitle: Database.Statement | null = null
let stmtIntelDeleteOlderThan: Database.Statement | null = null
let stmtIntelDeleteByIds: Database.Statement | null = null

function prepareIntelDeleteStatements(db: Database.Database): void {
  if (stmtIntelDeleteByTitle) return
  stmtIntelDeleteByTitle = db.prepare('DELETE FROM intel_items WHERE title LIKE ?')
  stmtIntelDeleteOlderThan = db.prepare(
    "DELETE FROM intel_items WHERE datetime(created_at) < datetime('now', ?)"
  )
  stmtIntelDeleteByIds = db.prepare('DELETE FROM intel_items WHERE id = ?')
}

/**
 * Delete intel items whose title matches a SQL LIKE pattern.
 * Returns the number of deleted rows.
 */
export function deleteIntelItemsByTitle(titlePattern: string): number {
  const db = getDatabase()
  prepareIntelDeleteStatements(db)
  const result = stmtIntelDeleteByTitle!.run(titlePattern)
  return result.changes
}

/**
 * Delete intel items older than N hours.
 * Returns the number of deleted rows.
 */
export function deleteIntelItemsOlderThan(hours: number): number {
  const db = getDatabase()
  prepareIntelDeleteStatements(db)
  const result = stmtIntelDeleteOlderThan!.run(`-${hours} hours`)
  return result.changes
}

/**
 * Delete intel items by their exact IDs.
 * Returns the number of deleted rows.
 */
export function deleteIntelItemsByIds(ids: string[]): number {
  if (ids.length === 0) return 0
  const db = getDatabase()
  prepareIntelDeleteStatements(db)
  let totalDeleted = 0
  const stmt = stmtIntelDeleteByIds!
  const deleteMany = db.transaction((itemIds: string[]): number => {
    for (const id of itemIds) {
      const result = stmt.run(id)
      totalDeleted += result.changes
    }
    return totalDeleted
  })
  return deleteMany(ids)
}
