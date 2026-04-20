/**
 * SQLite Database Initialization & Schema Management
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * Schema follows TDD.md specifications exactly.
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

let db: Database.Database | null = null

// ── Schema DDL (from TDD.md) ──

const SCHEMA_SQL = `
-- Raw data storage: News articles
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT,
    content TEXT,
    url TEXT,
    published_at DATETIME,
    ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sentiment REAL,
    entities TEXT,
    region TEXT,
    topics TEXT
);

-- Raw data storage: Flight tracking (ADS-B)
CREATE TABLE IF NOT EXISTS flights (
    id TEXT PRIMARY KEY,
    icao24 TEXT,
    callsign TEXT,
    origin_country TEXT,
    latitude REAL,
    longitude REAL,
    altitude REAL,
    velocity REAL,
    heading REAL,
    is_military BOOLEAN,
    aircraft_type TEXT,
    timestamp DATETIME
);

-- Raw data storage: Vessel tracking (AIS)
CREATE TABLE IF NOT EXISTS vessels (
    id TEXT PRIMARY KEY,
    mmsi TEXT,
    imo TEXT,
    ship_name TEXT,
    ship_type TEXT,
    latitude REAL,
    longitude REAL,
    speed REAL,
    heading REAL,
    destination TEXT,
    timestamp DATETIME
);

-- AI-generated intelligence items
CREATE TABLE IF NOT EXISTS intel_items (
    id TEXT PRIMARY KEY,
    tier TEXT CHECK(tier IN ('ALERT', 'WATCH', 'CONTEXT')),
    title TEXT NOT NULL,
    summary TEXT,
    analysis TEXT,
    confidence REAL,
    sources TEXT,
    region TEXT,
    categories TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    expires_at DATETIME,
    latitude REAL,
    longitude REAL
);

-- Anomaly records
CREATE TABLE IF NOT EXISTS anomalies (
    id TEXT PRIMARY KEY,
    source_type TEXT,
    metric TEXT,
    region TEXT,
    baseline_value REAL,
    observed_value REAL,
    deviation_sigma REAL,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    status TEXT DEFAULT 'active'
);

-- Predictions and outcomes
CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    prediction_text TEXT,
    confidence REAL,
    model_used TEXT,
    sources TEXT,
    predicted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expected_by DATETIME,
    outcome TEXT,
    resolved_at DATETIME,
    was_accurate BOOLEAN,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','expired'))
);

-- Baseline statistics for anomaly detection (rolling 30-day mean + stddev per metric per region)
CREATE TABLE IF NOT EXISTS baseline_stats (
    id TEXT PRIMARY KEY,
    metric TEXT NOT NULL,
    region TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    mean REAL NOT NULL,
    stddev REAL NOT NULL,
    sample_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(metric, region)
);

-- Metric snapshots for building historical baselines over time
CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    metric TEXT NOT NULL,
    region TEXT NOT NULL,
    value REAL NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aircraft registry: cached ICAO24 hex lookups (Phase 4A)
CREATE TABLE IF NOT EXISTS aircraft_registry (
    icao24 TEXT PRIMARY KEY,
    aircraft_type TEXT,
    icao_type_code TEXT,
    manufacturer TEXT,
    registration TEXT,
    operator TEXT,
    is_military BOOLEAN DEFAULT FALSE,
    category TEXT,
    looked_up_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Vessel registry: cached MMSI lookups (Phase 4B)
CREATE TABLE IF NOT EXISTS vessel_registry (
    mmsi TEXT PRIMARY KEY,
    vessel_name TEXT,
    vessel_class TEXT,
    vessel_type TEXT,
    hull_number TEXT,
    country TEXT,
    displacement_tons INTEGER,
    capabilities TEXT,
    is_hva BOOLEAN DEFAULT FALSE,
    category TEXT,
    looked_up_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Carrier Strike Groups (Phase 4F)
CREATE TABLE IF NOT EXISTS carrier_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT,
  flagship TEXT,
  status TEXT DEFAULT 'deployed',
  operating_area TEXT,
  latitude REAL,
  longitude REAL,
  source TEXT DEFAULT 'usni',
  last_updated TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Individual vessels within carrier groups (Phase 4F)
CREATE TABLE IF NOT EXISTS carrier_group_vessels (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  vessel_name TEXT,
  vessel_type TEXT,
  hull_number TEXT,
  mmsi TEXT,
  imo TEXT,
  latitude REAL,
  longitude REAL,
  heading REAL,
  speed REAL,
  last_seen TEXT,
  FOREIGN KEY (group_id) REFERENCES carrier_groups(id)
);

-- Tactical significance events (Phase 4C)
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
);

-- Prediction reviews (auto-review system)
CREATE TABLE IF NOT EXISTS prediction_reviews (
    id TEXT PRIMARY KEY,
    prediction_id TEXT NOT NULL REFERENCES predictions(id),
    outcome TEXT NOT NULL,
    was_accurate INTEGER,
    evidence TEXT NOT NULL,
    reasoning TEXT,
    key_finding TEXT,
    evidence_score TEXT,
    model_used TEXT,
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_prediction ON prediction_reviews(prediction_id);

-- Prediction calibration (accuracy stats by category/region)
CREATE TABLE IF NOT EXISTS prediction_calibration (
    category TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'global',
    total_predictions INTEGER NOT NULL DEFAULT 0,
    accurate_count INTEGER NOT NULL DEFAULT 0,
    inaccurate_count INTEGER NOT NULL DEFAULT 0,
    partial_count INTEGER NOT NULL DEFAULT 0,
    inconclusive_count INTEGER NOT NULL DEFAULT 0,
    accuracy_rate REAL NOT NULL DEFAULT 0,
    failure_pattern TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (category, region)
);

-- GFW vessel presence data (Phase 4I)
CREATE TABLE IF NOT EXISTS gfw_presence (
    id TEXT PRIMARY KEY,
    chokepoint TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    dataset TEXT NOT NULL,
    hours REAL,
    vessel_count INTEGER,
    flags TEXT,
    vessel_names TEXT,
    gear_types TEXT,
    mmsi_list TEXT,
    polled_at TEXT NOT NULL,
    date_range_start TEXT,
    date_range_end TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Social media posts (Phase 5A — Reddit + BlueSky)
CREATE TABLE IF NOT EXISTS social_posts (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_detail TEXT NOT NULL,
    title TEXT,
    body TEXT NOT NULL,
    author TEXT,
    url TEXT,
    score INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    posted_at DATETIME NOT NULL,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    region TEXT,
    analyzed INTEGER DEFAULT 0,
    UNIQUE(source, url)
);

-- Economic indicators (Phase 5B — anomaly detection for geopolitical commodities/currencies)
CREATE TABLE IF NOT EXISTS economic_indicators (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,        -- 'commodity', 'currency', 'shipping'
    value REAL NOT NULL,
    previous_close REAL,
    change_pct_24h REAL,
    change_pct_7d REAL,
    high_30d REAL,
    low_30d REAL,
    is_anomaly INTEGER DEFAULT 0,
    anomaly_type TEXT,             -- 'daily_spike', 'weekly_extreme', 'threshold_break'
    related_zones TEXT,            -- JSON: ["Persian Gulf", "Black Sea"]
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_economic_anomaly ON economic_indicators(is_anomaly, fetched_at);
CREATE INDEX IF NOT EXISTS idx_economic_symbol ON economic_indicators(symbol);
CREATE INDEX IF NOT EXISTS idx_economic_category ON economic_indicators(category);

-- Custom alert rules (Phase 5A)
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  entity_type TEXT NOT NULL,
  conditions TEXT NOT NULL,
  area TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WATCH',
  label TEXT NOT NULL,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  time_window_minutes INTEGER NOT NULL DEFAULT 0,
  filters TEXT,
  trigger TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_fired_at TEXT
);
`

// ── Indexes for common query patterns ──

const INDEXES_SQL = `
-- Articles: query by region, source, recency
CREATE INDEX IF NOT EXISTS idx_articles_region ON articles(region);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_ingested ON articles(ingested_at DESC);

-- Flights: query by timestamp, military status, position
CREATE INDEX IF NOT EXISTS idx_flights_timestamp ON flights(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_flights_military ON flights(is_military);
CREATE INDEX IF NOT EXISTS idx_flights_position ON flights(latitude, longitude);

-- Vessels: query by timestamp, type, position
CREATE INDEX IF NOT EXISTS idx_vessels_timestamp ON vessels(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_vessels_type ON vessels(ship_type);
CREATE INDEX IF NOT EXISTS idx_vessels_position ON vessels(latitude, longitude);

-- Intel items: query by tier, region, recency
CREATE INDEX IF NOT EXISTS idx_intel_tier ON intel_items(tier);
CREATE INDEX IF NOT EXISTS idx_intel_region ON intel_items(region);
CREATE INDEX IF NOT EXISTS idx_intel_created ON intel_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_expires ON intel_items(expires_at);

-- Anomalies: query by status, source type
CREATE INDEX IF NOT EXISTS idx_anomalies_status ON anomalies(status);
CREATE INDEX IF NOT EXISTS idx_anomalies_source ON anomalies(source_type);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected ON anomalies(detected_at DESC);

-- Predictions: query by resolution status
CREATE INDEX IF NOT EXISTS idx_predictions_resolved ON predictions(resolved_at);
CREATE INDEX IF NOT EXISTS idx_predictions_predicted ON predictions(predicted_at DESC);

-- Baseline stats: query by metric + region
CREATE INDEX IF NOT EXISTS idx_baseline_metric_region ON baseline_stats(metric, region);

-- Metric snapshots: query by metric, region, timestamp
CREATE INDEX IF NOT EXISTS idx_snapshots_metric_region_ts ON metric_snapshots(metric, region, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON metric_snapshots(timestamp DESC);

-- Aircraft registry: query by military status, category
CREATE INDEX IF NOT EXISTS idx_aircraft_registry_military ON aircraft_registry(is_military);
CREATE INDEX IF NOT EXISTS idx_aircraft_registry_category ON aircraft_registry(category);

-- Vessel registry: query by HVA status, category
CREATE INDEX IF NOT EXISTS idx_vessel_registry_hva ON vessel_registry(is_hva);
CREATE INDEX IF NOT EXISTS idx_vessel_registry_category ON vessel_registry(category);

-- Tactical events: query by status, type, detected_at
CREATE INDEX IF NOT EXISTS idx_tactical_events_status ON tactical_events(status);
CREATE INDEX IF NOT EXISTS idx_tactical_events_type ON tactical_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tactical_events_detected ON tactical_events(detected_at DESC);

-- Carrier groups: query by status, designation
CREATE INDEX IF NOT EXISTS idx_carrier_groups_status ON carrier_groups(status);
CREATE INDEX IF NOT EXISTS idx_carrier_groups_designation ON carrier_groups(designation);

-- Carrier group vessels: query by group_id, mmsi
CREATE INDEX IF NOT EXISTS idx_csg_vessels_group ON carrier_group_vessels(group_id);
CREATE INDEX IF NOT EXISTS idx_csg_vessels_mmsi ON carrier_group_vessels(mmsi);

-- GFW presence: query by chokepoint, dataset, flags
CREATE INDEX IF NOT EXISTS idx_gfw_chokepoint ON gfw_presence(chokepoint);
CREATE INDEX IF NOT EXISTS idx_gfw_dataset ON gfw_presence(dataset);
CREATE INDEX IF NOT EXISTS idx_gfw_flags ON gfw_presence(flags);

-- Social posts: query by source, region, recency, analysis status
CREATE INDEX IF NOT EXISTS idx_social_posts_source ON social_posts(source);
CREATE INDEX IF NOT EXISTS idx_social_posts_region ON social_posts(region);
CREATE INDEX IF NOT EXISTS idx_social_posts_posted ON social_posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_analyzed ON social_posts(analyzed);
`

/**
 * Get the database directory path.
 * In production: userData directory (Electron standard).
 * In development: project root / data directory.
 */
function getDbDir(): string {
  if (app.isPackaged) {
    return app.getPath('userData')
  }
  // Dev mode: store in project root / data
  const devPath = join(process.cwd(), 'data')
  if (!existsSync(devPath)) {
    mkdirSync(devPath, { recursive: true })
  }
  return devPath
}

/**
 * Get the full path to the SQLite database file.
 */
export function getDbPath(): string {
  return join(getDbDir(), 'intel-board.db')
}

/**
 * Migrate aircraft_registry and vessel_registry to add is_military_verified column.
 * is_military_verified = true means classification was confirmed by operator data
 * (aircraft) or registry/MID check (vessel). False = from type code/callsign only.
 */
function migrateMilitaryVerified(database: Database.Database): void {
  const migrations = [
    { table: 'aircraft_registry', column: 'is_military_verified' },
    { table: 'vessel_registry', column: 'is_military_verified' },
  ]
  for (const { table, column } of migrations) {
    try {
      const cols = database.pragma(`table_info(${table})`) as { name: string }[]
      const colNames = cols.map(c => c.name)
      if (!colNames.includes(column)) {
        console.log(`[database] Adding ${column} column to ${table}...`)
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} BOOLEAN DEFAULT 0`)
        console.log(`[database] ${table}.${column} added successfully`)
      }
    } catch (err) {
      console.warn(`[database] ${table} migration skipped:`, err)
    }
  }
}

/**
 * Migrate the predictions table from old schema to new schema.
 * The old table used (id TEXT, prediction_text, model_used, …) without a status column.
 * This function detects the old schema and recreates the table cleanly.
 */
function migratePredictionsTable(database: Database.Database): void {
  try {
    // Check current columns
    const cols = database
      .pragma('table_info(predictions)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    if (!colNames.includes('status')) {
      console.log('[database] Migrating predictions table — adding status column...')
      // Add the missing status column to the existing table
      database.exec(`
        ALTER TABLE predictions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active','resolved','expired'));
      `)
      console.log('[database] Predictions table migrated successfully')
    }
  } catch (err) {
    console.warn('[database] Predictions migration skipped:', err)
  }
}

/**
 * Migrate tactical_events and intel_items to add latitude/longitude columns.
 * These store the centroid of detected assets so map markers appear at
 * actual positions instead of zone centers.
 */
function migrateAlertRulesTimeWindow(database: Database.Database): void {
  try {
    const cols = database.pragma('table_info(alert_rules)') as { name: string }[]
    const colNames = cols.map(c => c.name)
    if (!colNames.includes('time_window_minutes')) {
      console.log('[database] Adding time_window_minutes column to alert_rules...')
      database.exec(`ALTER TABLE alert_rules ADD COLUMN time_window_minutes INTEGER NOT NULL DEFAULT 0`)
      console.log('[database] alert_rules.time_window_minutes added successfully')
    }
  } catch (err) {
    console.warn('[database] alert_rules time_window migration skipped:', err)
  }
}

/**
 * Migrate alert_rules to add filters and trigger columns for multi-condition rules.
 * Old rules use single conditions + time_window_minutes; new rules use filters[] + trigger{}.
 */
function migrateAlertRulesFiltersTrigger(database: Database.Database): void {
  try {
    const cols = database.pragma('table_info(alert_rules)') as { name: string }[]
    const colNames = cols.map(c => c.name)

    if (!colNames.includes('filters')) {
      console.log('[database] Adding filters column to alert_rules...')
      database.exec(`ALTER TABLE alert_rules ADD COLUMN filters TEXT`)
      console.log('[database] alert_rules.filters added successfully')
    }

    if (!colNames.includes('trigger')) {
      console.log('[database] Adding trigger column to alert_rules...')
      database.exec(`ALTER TABLE alert_rules ADD COLUMN trigger TEXT`)
      console.log('[database] alert_rules.trigger added successfully')
    }

    // Backfill existing rules that don't have filters/trigger populated yet
    const rows = database
      .prepare('SELECT id, conditions, time_window_minutes, filters FROM alert_rules')
      .all() as Array<{ id: string; conditions: string; time_window_minutes: number; filters: string | null }>

    for (const row of rows) {
      if (row.filters) continue // already migrated

      const oldCondition = JSON.parse(row.conditions) as { field: string; operator: string; value: string | number }
      const oldTimeWindow = row.time_window_minutes ?? 0

      let filters: Array<{ field: string; operator: string; value: string | number }>
      let trigger: { count_threshold: number; count_operator: string; time_window_minutes: number }

      if (oldCondition.field === 'count') {
        filters = []
        trigger = {
          count_threshold: Number(oldCondition.value),
          count_operator: oldCondition.operator,
          time_window_minutes: oldTimeWindow
        }
      } else {
        filters = [oldCondition]
        trigger = {
          count_threshold: 1,
          count_operator: '>',
          time_window_minutes: oldTimeWindow
        }
      }

      database
        .prepare('UPDATE alert_rules SET filters = ?, trigger = ? WHERE id = ?')
        .run(JSON.stringify(filters), JSON.stringify(trigger), row.id)
    }

    console.log('[database] alert_rules filters/trigger migration complete')
  } catch (err) {
    console.warn('[database] alert_rules filters/trigger migration skipped:', err)
  }
}

function migrateLatLonColumns(database: Database.Database): void {
  const migrations = [
    { table: 'tactical_events', columns: ['latitude', 'longitude'] },
    { table: 'intel_items', columns: ['latitude', 'longitude'] },
  ]
  for (const { table, columns } of migrations) {
    try {
      const cols = database.pragma(`table_info(${table})`) as { name: string }[]
      const colNames = cols.map(c => c.name)
      for (const column of columns) {
        if (!colNames.includes(column)) {
          console.log(`[database] Adding ${column} column to ${table}...`)
          database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} REAL`)
          console.log(`[database] ${table}.${column} added successfully`)
        }
      }
    } catch (err) {
      console.warn(`[database] ${table} lat/lon migration skipped:`, err)
    }
  }
}

/**
 * Initialize the database connection and create schema if needed.
 * Safe to call multiple times — returns existing connection if already open.
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const dbPath = getDbPath()
  console.log(`[database] Opening SQLite database at: ${dbPath}`)

  db = new Database(dbPath)

  // Performance tuning
  db.pragma('journal_mode = WAL') // Write-Ahead Logging for better concurrent reads
  db.pragma('synchronous = NORMAL') // Good balance of safety vs speed
  db.pragma('foreign_keys = ON') // Enforce referential integrity
  db.pragma('busy_timeout = 5000') // Wait up to 5s for locks
  db.pragma('cache_size = -64000') // 64MB cache

  // Create tables and indexes
  db.exec(SCHEMA_SQL)
  db.exec(INDEXES_SQL)

  // ── Migrations: alter existing tables if schema changed ──
  migratePredictionsTable(db)
  migrateMilitaryVerified(db)
  migrateLatLonColumns(db)
  migrateAlertRulesTimeWindow(db)
  migrateAlertRulesFiltersTrigger(db)

  console.log('[database] Schema initialized successfully')

  return db
}

/**
 * Get the current database connection.
 * Throws if database has not been initialized.
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('[database] Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase(): void {
  if (db) {
    console.log('[database] Closing database connection')
    db.close()
    db = null
  }
}

/**
 * Get database status info for diagnostics.
 */
export function getDatabaseStatus(): {
  connected: boolean
  dbPath: string
  tables: string[]
  error?: string
} {
  try {
    const database = getDatabase()
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]

    return {
      connected: true,
      dbPath: getDbPath(),
      tables: tables.map((t) => t.name)
    }
  } catch (err) {
    return {
      connected: false,
      dbPath: getDbPath(),
      tables: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}