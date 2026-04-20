/**
 * Anomaly Detection Engine
 *
 * Detects statistical anomalies across military flights, ship traffic,
 * and news volume using z-score analysis against rolling 30-day baselines.
 *
 * Z-score thresholds:
 *   |z| >= 3.0 → CRITICAL
 *   |z| >= 2.5 → HIGH
 *   |z| >= 2.0 → MODERATE
 *
 * Architecture:
 *   metric_snapshots → baseline_stats (hourly recalc) → z-score detection → anomalies + intel_items
 */

import { getDatabase } from '../storage/database'
import { insertIntelItem } from '../storage/dbService'
import { v4 as uuidv4 } from 'uuid'
import type { IntelTier } from '../../../shared/types'
import { generatePrediction, generatePredictionsForActiveAnomalies, flagOverduePredictionsForReview, type PredictionCategory } from '../analysis/predictor'
import { CHOKE_POINTS as AIS_CHOKE_POINTS } from '../ais/aisService'

// ─── Geographic Regions ────────────────────────────────────────────────────

export interface GeoRegion {
  name: string
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export const GEO_REGIONS: GeoRegion[] = [
  { name: 'Middle East', minLat: 12, maxLat: 42, minLon: 25, maxLon: 63 },
  { name: 'Eastern Europe', minLat: 44, maxLat: 60, minLon: 20, maxLon: 45 },
  { name: 'South China Sea', minLat: 0, maxLat: 25, minLon: 105, maxLon: 125 },
  { name: 'Korean Peninsula', minLat: 33, maxLat: 43, minLon: 124, maxLon: 131 },
  { name: 'Persian Gulf', minLat: 23, maxLat: 31, minLon: 47, maxLon: 57 },
  { name: 'North Africa', minLat: 15, maxLat: 37, minLon: -17, maxLon: 35 },
  { name: 'Western Europe', minLat: 36, maxLat: 60, minLon: -10, maxLon: 20 },
  { name: 'South Asia', minLat: 5, maxLat: 37, minLon: 60, maxLon: 98 },
  { name: 'East Africa', minLat: -12, maxLat: 15, minLon: 28, maxLon: 52 },
  { name: 'Arctic', minLat: 70, maxLat: 90, minLon: -180, maxLon: 180 }
]

// ─── Choke Points ──────────────────────────────────────────────────────────

export interface ChokePoint {
  name: string
  centerLat: number
  centerLon: number
  radiusKm: number
}

export const CHOKE_POINTS: ChokePoint[] = [
  { name: 'Strait of Hormuz', centerLat: 26.56, centerLon: 56.25, radiusKm: 50 },
  { name: 'Suez Canal', centerLat: 30.46, centerLon: 32.35, radiusKm: 30 },
  { name: 'Panama Canal', centerLat: 9.08, centerLon: -79.68, radiusKm: 30 },
  { name: 'Taiwan Strait', centerLat: 24.5, centerLon: 119.0, radiusKm: 60 },
  { name: 'Strait of Malacca', centerLat: 2.5, centerLon: 101.5, radiusKm: 60 },
  { name: 'Bab el-Mandeb', centerLat: 12.58, centerLon: 43.33, radiusKm: 30 },
  { name: 'Bosporus', centerLat: 41.12, centerLon: 29.07, radiusKm: 15 },
  { name: 'Gibraltar', centerLat: 35.95, centerLon: -5.62, radiusKm: 25 }
]

// ─── Constants ─────────────────────────────────────────────────────────────

const Z_CRITICAL = 3.0
const Z_HIGH = 2.5
const Z_MODERATE = 2.0
const BASELINE_DAYS = 30
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000
const BASELINE_RECALC_MS = 60 * 60 * 1000
const DETECTION_INTERVAL_MS = 5 * 60 * 1000
const DEDUP_WINDOW_HOURS = 2

// ─── Types ─────────────────────────────────────────────────────────────────

export type AnomalySeverity = 'CRITICAL' | 'HIGH' | 'MODERATE'

export interface AnomalyResult {
  metric: string
  region: string
  severity: AnomalySeverity
  zScore: number
  baselineMean: number
  baselineStddev: number
  observedValue: number
  details: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function classifySeverity(zScore: number): AnomalySeverity | null {
  const absZ = Math.abs(zScore)
  if (absZ >= Z_CRITICAL) return 'CRITICAL'
  if (absZ >= Z_HIGH) return 'HIGH'
  if (absZ >= Z_MODERATE) return 'MODERATE'
  return null
}

function severityToTier(severity: AnomalySeverity): IntelTier {
  switch (severity) {
    case 'CRITICAL':
      return 'ALERT'
    case 'HIGH':
      return 'ALERT'
    case 'MODERATE':
      return 'WATCH'
  }
}

const METRIC_LABELS: Record<string, string> = {
  military_flight_count: 'Military flight count',
  ship_traffic_chokepoint: 'Ship traffic',
  news_volume: 'News volume'
}

const METRIC_SOURCE_TYPE: Record<string, string> = {
  military_flight_count: 'adsb',
  ship_traffic_chokepoint: 'ais',
  news_volume: 'news'
}

const METRIC_TO_PREDICTION_CATEGORY: Record<string, PredictionCategory> = {
  military_flight_count: 'conflict_escalation',
  ship_traffic_chokepoint: 'supply_chain_disruption',
  news_volume: 'geopolitical_shift'
}

const NEWS_REGION_NAMES = [
  'Middle East', 'East Asia', 'Europe', 'South Asia',
  'Africa', 'Southeast Asia', 'Latin America', 'Arctic'
]

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

// ─── Snapshot collection ───────────────────────────────────────────────────

function snapshotMilitaryFlightCounts(): void {
  const db = getDatabase()
  for (const region of GEO_REGIONS) {
    const result = db
      .prepare(
        `SELECT COUNT(DISTINCT icao24) AS count
         FROM flights
         WHERE is_military = 1
           AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND latitude BETWEEN ? AND ?
           AND longitude BETWEEN ? AND ?`
      )
      .get(region.minLat, region.maxLat, region.minLon, region.maxLon) as { count: number }

    db.prepare(
      `INSERT INTO metric_snapshots (id, metric, region, value, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(uuidv4(), 'military_flight_count', region.name, result.count)
  }
  console.log('[ANOMALY] Military flight snapshots recorded')
}

function snapshotShipTrafficCounts(): void {
  const db = getDatabase()
  for (const cp of CHOKE_POINTS) {
    const latDelta = cp.radiusKm / 111.32
    const lonDelta = cp.radiusKm / (111.32 * Math.cos(toRad(cp.centerLat)))
    const result = db
      .prepare(
        `SELECT COUNT(DISTINCT mmsi) AS count
         FROM vessels
         WHERE latitude IS NOT NULL AND longitude IS NOT NULL
           AND latitude BETWEEN ? AND ?
           AND longitude BETWEEN ? AND ?`
      )
      .get(
        cp.centerLat - latDelta, cp.centerLat + latDelta,
        cp.centerLon - lonDelta, cp.centerLon + lonDelta
      ) as { count: number }

    db.prepare(
      `INSERT INTO metric_snapshots (id, metric, region, value, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(uuidv4(), 'ship_traffic_chokepoint', cp.name, result.count)

    // GFW presence count (supplemental - historical vessel data)
    const gfwResult = db
      .prepare(
        `SELECT SUM(vessel_count) as total_vessels
         FROM gfw_presence
         WHERE chokepoint = ? AND dataset = 'presence'`
      )
      .get(cp.name) as { total_vessels: number | null }

    const gfwVessels = gfwResult.total_vessels ?? 0

    // Store GFW supplemental count
    db.prepare(
      `INSERT INTO metric_snapshots (id, metric, region, value, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(uuidv4(), 'gfw_traffic_chokepoint', cp.name, gfwVessels)
  }
  console.log('[ANOMALY] Ship traffic snapshots recorded')
}

function snapshotTransitCorridorCounts(): void {
  const db = getDatabase()
  for (const cp of AIS_CHOKE_POINTS) {
    if (!cp.transitCorridor) continue

    const { minLat, maxLat, minLon, maxLon } = cp.transitCorridor

    const aisResult = db.prepare(
      `SELECT COUNT(DISTINCT mmsi) AS count
       FROM vessels
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND latitude BETWEEN ? AND ?
         AND longitude BETWEEN ? AND ?`
    ).get(minLat, maxLat, minLon, maxLon) as { count: number }

    db.prepare(
      `INSERT INTO metric_snapshots (id, metric, region, value, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(uuidv4(), 'transit_corridor_traffic', cp.name, aisResult.count)
  }
  console.log('[ANOMALY] Transit corridor snapshots recorded')
}

function snapshotNewsVolumeCounts(): void {
  const db = getDatabase()
  const totalResult = db
    .prepare(`SELECT COUNT(*) AS count FROM articles WHERE ingested_at >= datetime('now', '-1 hour')`)
    .get() as { count: number }

  db.prepare(
    `INSERT INTO metric_snapshots (id, metric, region, value, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(uuidv4(), 'news_volume', 'global', totalResult.count)

  for (const regionName of NEWS_REGION_NAMES) {
    const result = db
      .prepare(
        `SELECT COUNT(*) AS count FROM articles WHERE ingested_at >= datetime('now', '-1 hour') AND region = ?`
      )
      .get(regionName) as { count: number }
    if (result.count > 0) {
      db.prepare(
        `INSERT INTO metric_snapshots (id, metric, region, value, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`
      ).run(uuidv4(), 'news_volume', regionName, result.count)
    }
  }
  console.log('[ANOMALY] News volume snapshots recorded')
}

function snapshotAllMetrics(): void {
  try { snapshotMilitaryFlightCounts() } catch (err) { console.error('[ANOMALY] Flight snapshot failed:', err) }
  try { snapshotShipTrafficCounts() } catch (err) { console.error('[ANOMALY] Ship snapshot failed:', err) }
  try { snapshotTransitCorridorCounts() } catch (err) { console.error('[ANOMALY] Transit corridor snapshot failed:', err) }
  try { snapshotNewsVolumeCounts() } catch (err) { console.error('[ANOMALY] News snapshot failed:', err) }
}

// ─── Baseline calculation ──────────────────────────────────────────────────

function recalculateBaseline(metric: string, region: string): void {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT value FROM metric_snapshots
       WHERE metric = ? AND region = ? AND timestamp >= datetime('now', '-${BASELINE_DAYS} days')
       ORDER BY timestamp`
    )
    .all(metric, region) as { value: number }[]

  if (rows.length < 5) return

  const values = rows.map((r) => r.value)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  const stddev = Math.sqrt(variance)

  const now = new Date().toISOString()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - BASELINE_DAYS)

  const existing = db
    .prepare('SELECT id FROM baseline_stats WHERE metric = ? AND region = ?')
    .get(metric, region) as { id: string } | undefined

  if (existing) {
    db.prepare(
      `UPDATE baseline_stats SET period_start = ?, period_end = ?, mean = ?, stddev = ?, sample_count = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(cutoffDate.toISOString(), now, mean, stddev, values.length, existing.id)
  } else {
    db.prepare(
      `INSERT INTO baseline_stats (id, metric, region, period_start, period_end, mean, stddev, sample_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), metric, region, cutoffDate.toISOString(), now, mean, stddev, values.length)
  }
}

export function recalculateAllBaselines(): void {
  const db = getDatabase()
  console.log('[ANOMALY] Recalculating all baselines...')

  for (const region of GEO_REGIONS) recalculateBaseline('military_flight_count', region.name)
  for (const cp of CHOKE_POINTS) {
    recalculateBaseline('ship_traffic_chokepoint', cp.name)
    recalculateBaseline('gfw_traffic_chokepoint', cp.name)
    recalculateBaseline('transit_corridor_traffic', cp.name)
  }
  recalculateBaseline('news_volume', 'global')
  for (const region of NEWS_REGION_NAMES) recalculateBaseline('news_volume', region)

  const baselines = db
    .prepare('SELECT metric, region, mean, stddev, sample_count FROM baseline_stats')
    .all() as { metric: string; region: string; mean: number; stddev: number; sample_count: number }[]

  for (const b of baselines) {
    console.log(`[ANOMALY] Baseline: ${b.metric}/${b.region} mean=${b.mean.toFixed(2)} stddev=${b.stddev.toFixed(2)} n=${b.sample_count}`)
  }
  console.log(`[ANOMALY] Baseline recalculation complete: ${baselines.length} baselines active`)
}

// ─── Anomaly detection ─────────────────────────────────────────────────────

function getLatestSnapshotValue(metric: string, region: string): number {
  const db = getDatabase()
  const result = db
    .prepare(`SELECT value FROM metric_snapshots WHERE metric = ? AND region = ? ORDER BY timestamp DESC LIMIT 1`)
    .get(metric, region) as { value: number } | undefined
  return result?.value ?? 0
}

function detectAnomaly(metric: string, region: string): AnomalyResult | null {
  const db = getDatabase()
  const baseline = db
    .prepare('SELECT mean, stddev, sample_count FROM baseline_stats WHERE metric = ? AND region = ?')
    .get(metric, region) as { mean: number; stddev: number; sample_count: number } | undefined

  if (!baseline || baseline.sample_count < 5) return null

  const currentValue = getLatestSnapshotValue(metric, region)

  if (baseline.stddev === 0) {
    if (currentValue === baseline.mean) return null
    return {
      metric, region, severity: 'CRITICAL',
      zScore: currentValue > baseline.mean ? Infinity : -Infinity,
      baselineMean: baseline.mean, baselineStddev: 0, observedValue: currentValue,
      details: `Zero-variance baseline: expected ${baseline.mean}, observed ${currentValue}`
    }
  }

  const zScore = (currentValue - baseline.mean) / baseline.stddev
  const severity = classifySeverity(zScore)
  if (!severity) return null

  const direction = currentValue > baseline.mean ? 'above' : 'below'
  const metricLabel = METRIC_LABELS[metric] ?? metric

  return {
    metric, region, severity,
    zScore: Math.round(zScore * 100) / 100,
    baselineMean: Math.round(baseline.mean * 100) / 100,
    baselineStddev: Math.round(baseline.stddev * 100) / 100,
    observedValue: currentValue,
    details: `[${severity}] ${metricLabel} anomaly in ${region}: observed ${currentValue} (${zScore.toFixed(2)}σ ${direction} mean), baseline mean=${baseline.mean.toFixed(2)}, stddev=${baseline.stddev.toFixed(2)}, n=${baseline.sample_count} samples over ${BASELINE_DAYS} days`
  }
}

// ─── Anomaly storage ───────────────────────────────────────────────────────

function storeAnomaly(anomaly: AnomalyResult): void {
  const db = getDatabase()

  // Dedup: skip if same metric/region logged recently
  const recentDupe = db
    .prepare(
      `SELECT id FROM anomalies WHERE metric = ? AND region = ? AND detected_at >= datetime('now', '-${DEDUP_WINDOW_HOURS} hours') LIMIT 1`
    )
    .get(anomaly.metric, anomaly.region) as { id: string } | undefined

  if (recentDupe) {
    console.log(`[ANOMALY] Skipping duplicate: ${anomaly.metric}/${anomaly.region} — already logged in last ${DEDUP_WINDOW_HOURS}h`)
    return
  }

  const tier = severityToTier(anomaly.severity)
  const metricLabel = METRIC_LABELS[anomaly.metric] ?? anomaly.metric
  const direction = anomaly.observedValue > anomaly.baselineMean ? '↑' : '↓'
  const title = `${anomaly.severity} | ${metricLabel} anomaly ${direction} ${anomaly.region}`

  // Build enriched summary with triggering headlines for news volume anomalies
  let enrichedSummary = anomaly.details.substring(0, 300)
  let enrichedAnalysis = anomaly.details
  if (anomaly.metric === 'news_volume') {
    try {
      const triggeringArticles = db.prepare(`
        SELECT title, source
        FROM articles
        WHERE region = ? AND ingested_at >= datetime('now', '-2 hours')
        ORDER BY ingested_at DESC
        LIMIT 10
      `).all(anomaly.region) as Array<{ title: string; source: string }>

      if (triggeringArticles.length > 0) {
        const headlineList = triggeringArticles.map(a => `- [${a.source}] ${a.title}`).join('\n')
        const sigma = anomaly.zScore.toFixed(2)
        const headlineBlock = `\n\nTriggering headlines:\n${headlineList}`
        enrichedSummary = `News volume anomaly: observed ${anomaly.observedValue} (${sigma}σ above mean).${headlineBlock}`.substring(0, 500)
        enrichedAnalysis = anomaly.details + headlineBlock
      }
    } catch (err) {
      console.warn('[ANOMALY] Failed to fetch triggering headlines:', err)
    }
  }

  // Create intel item
  try {
    insertIntelItem({
      tier, title,
      summary: enrichedSummary,
      analysis: enrichedAnalysis,
      confidence: Math.min(0.95, 0.6 + Math.abs(anomaly.zScore) * 0.1),
      sources: [METRIC_SOURCE_TYPE[anomaly.metric] ?? 'anomaly_detection'],
      region: anomaly.region,
      categories: [anomaly.metric],
      updated_at: null, expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() // anomaly: 12h TTL
    })
  } catch (err) {
    console.warn('[ANOMALY] Failed to create intel item:', err)
  }

  // Store anomaly record
  try {
    db.prepare(
      `INSERT INTO anomalies (id, source_type, metric, region, baseline_value, observed_value, deviation_sigma, detected_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 'active')`
    ).run(uuidv4(), METRIC_SOURCE_TYPE[anomaly.metric] ?? 'unknown', anomaly.metric, anomaly.region, anomaly.baselineMean, anomaly.observedValue, anomaly.zScore)
  } catch (err) {
    console.warn('[ANOMALY] Failed to store anomaly record:', err)
  }

  console.log(`[ANOMALY] ${anomaly.severity} detected: ${anomaly.details}`)

  // Trigger prediction generation for significant anomalies
  if (anomaly.severity === 'CRITICAL' || anomaly.severity === 'HIGH') {
    const category = METRIC_TO_PREDICTION_CATEGORY[anomaly.metric] || 'geopolitical_shift'
    generatePrediction({
      triggerId: `anomaly:${anomaly.metric}:${anomaly.region}`,
      metric: anomaly.metric,
      region: anomaly.region,
      severity: anomaly.severity,
      triggerDescription: anomaly.details,
      category
    }).catch((err) => {
      console.warn(`[ANOMALY] Prediction generation failed for ${anomaly.metric}/${anomaly.region}:`, err)
    })
  }
}

// ─── Full detection runs ──────────────────────────────────────────────────

export function runAllDetections(): number {
  let anomalyCount = 0
  console.log('[ANOMALY] Running anomaly detection across all metrics...')

  for (const region of GEO_REGIONS) {
    const result = detectAnomaly('military_flight_count', region.name)
    if (result) { storeAnomaly(result); anomalyCount++ }
  }
  for (const cp of CHOKE_POINTS) {
    const result = detectAnomaly('ship_traffic_chokepoint', cp.name)
    if (result) { storeAnomaly(result); anomalyCount++ }
  }
  const globalNews = detectAnomaly('news_volume', 'global')
  if (globalNews) { storeAnomaly(globalNews); anomalyCount++ }
  for (const region of NEWS_REGION_NAMES) {
    const result = detectAnomaly('news_volume', region)
    if (result) { storeAnomaly(result); anomalyCount++ }
  }

  console.log(`[ANOMALY] Detection run complete: ${anomalyCount} new anomalies`)
  return anomalyCount
}

// ─── Scheduler lifecycle ───────────────────────────────────────────────────

let snapshotTimer: ReturnType<typeof setInterval> | null = null
let baselineTimer: ReturnType<typeof setInterval> | null = null
let detectionTimer: ReturnType<typeof setInterval> | null = null
let isEngineRunning = false
let predictionTimer: ReturnType<typeof setInterval> | null = null
let reviewTimer: ReturnType<typeof setInterval> | null = null

export function startAnomalyEngine(): void {
  if (isEngineRunning) {
    console.warn('[ANOMALY] Engine already running')
    return
  }
  isEngineRunning = true
  console.log('[ANOMALY] Starting anomaly detection engine')
  console.log(`[ANOMALY] Schedule: snapshots=${SNAPSHOT_INTERVAL_MS / 1000}s, baselines=${BASELINE_RECALC_MS / 60000}m, detection=${DETECTION_INTERVAL_MS / 60000}m`)

  // Initial run
  try { snapshotAllMetrics(); recalculateAllBaselines(); runAllDetections() }
  catch (err) { console.error('[ANOMALY] Initial run failed:', err) }

  // Periodic tasks
  snapshotTimer = setInterval(() => { try { snapshotAllMetrics() } catch (err) { console.error('[ANOMALY] Snapshot failed:', err) } }, SNAPSHOT_INTERVAL_MS)
  baselineTimer = setInterval(() => { try { recalculateAllBaselines() } catch (err) { console.error('[ANOMALY] Baseline recalc failed:', err) } }, BASELINE_RECALC_MS)

  // Detection offset by 30s from snapshots
  setTimeout(() => {
    detectionTimer = setInterval(() => { try { runAllDetections() } catch (err) { console.error('[ANOMALY] Detection run failed:', err) } }, DETECTION_INTERVAL_MS)
  }, 30_000)

  // Batch prediction generation: every 30 minutes (offset 60s)
  setTimeout(() => {
    predictionTimer = setInterval(() => {
      try { generatePredictionsForActiveAnomalies() } catch (err) { console.error('[PREDICTOR] Scheduled prediction run failed:', err) }
    }, 30 * 60 * 1000)
  }, 60_000)

  // Overdue prediction review flagging: every 6 hours
  reviewTimer = setInterval(() => {
    try { flagOverduePredictionsForReview() } catch (err) { console.error('[PREDICTOR] Review flagging failed:', err) }
  }, 6 * 60 * 60 * 1000)
}

export function stopAnomalyEngine(): void {
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null }
  if (baselineTimer) { clearInterval(baselineTimer); baselineTimer = null }
  if (detectionTimer) { clearInterval(detectionTimer); detectionTimer = null }
  if (predictionTimer) { clearInterval(predictionTimer); predictionTimer = null }
  if (reviewTimer) { clearInterval(reviewTimer); reviewTimer = null }
  isEngineRunning = false
  console.log('[ANOMALY] Engine stopped')
}

export function getAnomalyEngineStatus(): { running: boolean; snapshotIntervalMs: number; baselineRecalcMs: number; detectionIntervalMs: number } {
  return { running: isEngineRunning, snapshotIntervalMs: SNAPSHOT_INTERVAL_MS, baselineRecalcMs: BASELINE_RECALC_MS, detectionIntervalMs: DETECTION_INTERVAL_MS }
}

export function triggerManualDetection(): { anomalies: number } {
  snapshotAllMetrics()
  return { anomalies: runAllDetections() }
}

export function cleanupOldSnapshots(): void {
  const db = getDatabase()
  const result = db.prepare(`DELETE FROM metric_snapshots WHERE timestamp < datetime('now', '-35 days')`).run()
  if (result.changes > 0) console.log(`[ANOMALY] Cleaned up ${result.changes} old snapshots`)
}