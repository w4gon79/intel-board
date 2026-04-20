/**
 * Economic Anomaly Detector — tracks geopolitically relevant commodities and currencies.
 *
 * Only surfaces significant moves via the intel feed. No charts, no tickers.
 * Anomaly thresholds:
 *   - Commodities: >3% daily move
 *   - Currencies: >2% daily move
 *   - Shipping (BDI): >10% weekly move
 *   - 30-day high/low extremes
 */

import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from './storage/database'
import { insertIntelItem } from './storage/dbService'
import { loadSettings } from '../ipc/settings.handlers'

// ── Types ──

interface EconomicIndicator {
  id: string
  symbol: string
  name: string
  category: 'commodity' | 'currency' | 'shipping'
  value: number
  previous_close: number | null
  change_pct_24h: number | null
  change_pct_7d: number | null
  high_30d: number | null
  low_30d: number | null
  is_anomaly: boolean
  anomaly_type: string | null
  related_zones: string[] | null
  fetched_at: string
}

interface IndicatorConfig {
  symbol: string
  name: string
  category: 'commodity' | 'currency' | 'shipping'
  relatedZones: string[]
  /** Yahoo Finance chart API symbol */
  yahooSymbol: string
  /** FRED series ID (optional fallback) */
  fredSeries?: string
  /** Daily move threshold for anomaly (fraction, e.g. 0.03 = 3%) */
  dailyThreshold: number
  /** Weekly move threshold for anomaly */
  weeklyThreshold: number
}

// ── Indicator Definitions ──

const INDICATORS: IndicatorConfig[] = [
  // Commodities
  {
    symbol: 'WTI',
    name: 'Crude Oil (WTI)',
    category: 'commodity',
    relatedZones: ['Persian Gulf', 'North America'],
    yahooSymbol: 'CL=F',
    dailyThreshold: 0.03,
    weeklyThreshold: 0.07
  },
  {
    symbol: 'BRENT',
    name: 'Crude Oil (Brent)',
    category: 'commodity',
    relatedZones: ['Persian Gulf', 'North Sea', 'Middle East'],
    yahooSymbol: 'BZ=F',
    dailyThreshold: 0.03,
    weeklyThreshold: 0.07
  },
  {
    symbol: 'GOLD',
    name: 'Gold',
    category: 'commodity',
    relatedZones: ['Global'],
    yahooSymbol: 'GC=F',
    dailyThreshold: 0.03,
    weeklyThreshold: 0.07
  },
  {
    symbol: 'WHEAT',
    name: 'Wheat',
    category: 'commodity',
    relatedZones: ['Black Sea', 'Middle East'],
    yahooSymbol: 'ZW=F',
    dailyThreshold: 0.03,
    weeklyThreshold: 0.07
  },
  {
    symbol: 'NATGAS',
    name: 'Natural Gas',
    category: 'commodity',
    relatedZones: ['Europe', 'Russia', 'Ukraine'],
    yahooSymbol: 'NG=F',
    dailyThreshold: 0.03,
    weeklyThreshold: 0.07
  },
  // Currencies
  {
    symbol: 'DXY',
    name: 'US Dollar Index (DXY)',
    category: 'currency',
    relatedZones: ['Global'],
    yahooSymbol: 'DX-Y.NYB',
    dailyThreshold: 0.02,
    weeklyThreshold: 0.04
  },
  {
    symbol: 'USDTRY',
    name: 'USD/TRY (Turkish Lira)',
    category: 'currency',
    relatedZones: ['Turkey', 'Eastern Mediterranean'],
    yahooSymbol: 'TRY=X',
    dailyThreshold: 0.02,
    weeklyThreshold: 0.04
  },
  {
    symbol: 'USDRUB',
    name: 'USD/RUB (Russian Ruble)',
    category: 'currency',
    relatedZones: ['Russia', 'Black Sea'],
    yahooSymbol: 'RUB=X',
    dailyThreshold: 0.02,
    weeklyThreshold: 0.04
  },
  {
    symbol: 'USDCNY',
    name: 'USD/CNY (Chinese Yuan)',
    category: 'currency',
    relatedZones: ['China', 'Pacific'],
    yahooSymbol: 'CNY=X',
    dailyThreshold: 0.02,
    weeklyThreshold: 0.04
  },
  // Shipping
  {
    symbol: 'BDI',
    name: 'Baltic Dry Index',
    category: 'shipping',
    relatedZones: ['Global', 'Strait of Hormuz', 'Strait of Malacca', 'Suez Canal'],
    yahooSymbol: '^BDI',
    dailyThreshold: 0.05,
    weeklyThreshold: 0.10
  }
]

// ── State ──

let pollTimer: ReturnType<typeof setTimeout> | null = null
let isPolling = false

// ── Yahoo Finance Fetcher ──

/**
 * Fetch price data from Yahoo Finance chart API.
 * Returns current price, previous close, and historical closes for 7d/30d calculations.
 */
async function fetchYahooData(
  yahooSymbol: string
): Promise<{ current: number; previousClose: number; closes7d: number[]; closes30d: number[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=30d&interval=1d`

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(15000)
    })

    if (!resp.ok) {
      console.warn(`[economic] Yahoo Finance returned ${resp.status} for ${yahooSymbol}`)
      return null
    }

    const body = await resp.json() as {
      chart?: {
        result?: Array<{
          meta: {
            regularMarketPrice: number
            previousClose?: number
            chartPreviousClose?: number
          }
          timestamp?: number[]
          indicators?: {
            quote?: Array<{
              close?: number[]
            }>
          }
        }>
      }
    }

    const result = body.chart?.result?.[0]
    if (!result) return null

    const current = result.meta.regularMarketPrice
    const previousClose = result.meta.previousClose ?? result.meta.chartPreviousClose ?? current
    const closes = result.indicators?.quote?.[0]?.close ?? []

    // Filter out nulls
    const validCloses = closes.filter((c): c is number => c !== null && c !== undefined)

    // Last 7 trading days and 30 trading days
    const closes7d = validCloses.slice(-7)
    const closes30d = validCloses

    return { current, previousClose, closes7d, closes30d }
  } catch (err) {
    console.warn(`[economic] Failed to fetch ${yahooSymbol}:`, err instanceof Error ? err.message : String(err))
    return null
  }
}

// ── Anomaly Detection ──

interface AnomalyResult {
  isAnomaly: boolean
  anomalyType: string | null
  change24h: number | null
  change7d: number | null
  high30d: number | null
  low30d: number | null
}

function detectAnomaly(
  config: IndicatorConfig,
  current: number,
  previousClose: number,
  closes7d: number[],
  closes30d: number[]
): AnomalyResult {
  const change24h = previousClose > 0 ? (current - previousClose) / previousClose : null
  const first7d = closes7d[0]
  const change7d = first7d && first7d > 0 ? (current - first7d) / first7d : null
  const high30d = closes30d.length > 0 ? Math.max(...closes30d) : null
  const low30d = closes30d.length > 0 ? Math.min(...closes30d) : null

  let isAnomaly = false
  let anomalyType: string | null = null

  // Check daily move threshold
  if (change24h !== null && Math.abs(change24h) >= config.dailyThreshold) {
    isAnomaly = true
    anomalyType = 'daily_spike'
  }

  // Check weekly move threshold
  if (change7d !== null && Math.abs(change7d) >= config.weeklyThreshold) {
    isAnomaly = true
    anomalyType = anomalyType ?? 'weekly_extreme'
  }

  // Check 30-day high/low extreme
  if (high30d !== null && low30d !== null && closes30d.length >= 10) {
    if (current >= high30d) {
      isAnomaly = true
      anomalyType = 'weekly_extreme' // 30-day high
    } else if (current <= low30d) {
      isAnomaly = true
      anomalyType = 'weekly_extreme' // 30-day low
    }
  }

  return { isAnomaly, anomalyType, change24h, change7d, high30d, low30d }
}

// ── Data Persistence ──

function upsertIndicator(indicator: EconomicIndicator): void {
  const db = getDatabase()

  // Check if a recent record exists for this symbol (within last hour)
  const existing = db.prepare(
    "SELECT id FROM economic_indicators WHERE symbol = ? AND fetched_at > datetime('now', '-1 hour') ORDER BY fetched_at DESC LIMIT 1"
  ).get(indicator.symbol) as { id: string } | undefined

  if (existing) {
    // Update existing record
    db.prepare(`
      UPDATE economic_indicators
      SET value = @value, previous_close = @previous_close,
          change_pct_24h = @change_pct_24h, change_pct_7d = @change_pct_7d,
          high_30d = @high_30d, low_30d = @low_30d,
          is_anomaly = @is_anomaly, anomaly_type = @anomaly_type,
          related_zones = @related_zones, fetched_at = @fetched_at
      WHERE id = @id
    `).run({
      id: existing.id,
      value: indicator.value,
      previous_close: indicator.previous_close,
      change_pct_24h: indicator.change_pct_24h,
      change_pct_7d: indicator.change_pct_7d,
      high_30d: indicator.high_30d,
      low_30d: indicator.low_30d,
      is_anomaly: indicator.is_anomaly ? 1 : 0,
      anomaly_type: indicator.anomaly_type,
      related_zones: indicator.related_zones ? JSON.stringify(indicator.related_zones) : null,
      fetched_at: indicator.fetched_at
    })
  } else {
    // Insert new record
    db.prepare(`
      INSERT INTO economic_indicators (id, symbol, name, category, value, previous_close,
        change_pct_24h, change_pct_7d, high_30d, low_30d, is_anomaly, anomaly_type,
        related_zones, fetched_at)
      VALUES (@id, @symbol, @name, @category, @value, @previous_close,
        @change_pct_24h, @change_pct_7d, @high_30d, @low_30d, @is_anomaly, @anomaly_type,
        @related_zones, @fetched_at)
    `).run({
      id: indicator.id,
      symbol: indicator.symbol,
      name: indicator.name,
      category: indicator.category,
      value: indicator.value,
      previous_close: indicator.previous_close,
      change_pct_24h: indicator.change_pct_24h,
      change_pct_7d: indicator.change_pct_7d,
      high_30d: indicator.high_30d,
      low_30d: indicator.low_30d,
      is_anomaly: indicator.is_anomaly ? 1 : 0,
      anomaly_type: indicator.anomaly_type,
      related_zones: indicator.related_zones ? JSON.stringify(indicator.related_zones) : null,
      fetched_at: indicator.fetched_at
    })
  }
}

// ── Intel Item Generation ──

function createIntelItemForAnomaly(
  config: IndicatorConfig,
  indicator: EconomicIndicator,
  anomaly: AnomalyResult
): void {
  const direction = (anomaly.change24h ?? 0) >= 0 ? '↑' : '↓'
  const absChange24h = Math.abs((anomaly.change24h ?? 0) * 100).toFixed(1)
  const absChange7d = anomaly.change7d !== null ? Math.abs(anomaly.change7d * 100).toFixed(1) : null

  // Determine tier based on severity
  const isSevere = anomaly.change24h !== null && Math.abs(anomaly.change24h) >= config.dailyThreshold * 2
  const tier = isSevere ? 'ALERT' : 'WATCH'

  const title = `${config.name}: ${direction}${absChange24h}% to ${formatValue(indicator.value, config.category)}`

  let summary = `${config.name} moved ${direction}${absChange24h}% in 24h to ${formatValue(indicator.value, config.category)}.`
  if (absChange7d) {
    summary += ` Weekly change: ${direction}${absChange7d}%.`
  }
  if (anomaly.high30d !== null && indicator.value >= anomaly.high30d) {
    summary += ` Currently at 30-day HIGH.`
  } else if (anomaly.low30d !== null && indicator.value <= anomaly.low30d) {
    summary += ` Currently at 30-day LOW.`
  }

  // Check for duplicate intel items (same title pattern in last 4 hours)
  const db = getDatabase()
  const recent = db.prepare(
    "SELECT id FROM intel_items WHERE title LIKE ? AND datetime(created_at) > datetime('now', '-4 hours') LIMIT 1"
  ).get(`${config.name}:%`) as { id: string } | undefined

  if (recent) {
    console.log(`[economic] Skipping duplicate intel item for ${config.symbol} (already posted in last 4h)`)
    return
  }

  insertIntelItem({
    tier,
    title,
    summary,
    analysis: null,
    confidence: 0.9,
    sources: [`Yahoo Finance: ${config.yahooSymbol}`],
    region: config.relatedZones[0] ?? 'Global',
    categories: ['economic', config.category, ...(config.relatedZones.map(z => `zone:${z}`))],
    updated_at: null,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // expires in 24h
  })

  console.log(`[economic] Created ${tier} intel item: ${title}`)
}

// ── Value Formatting ──

function formatValue(value: number, category: string): string {
  if (category === 'currency') {
    return value.toFixed(2)
  }
  if (category === 'shipping') {
    return Math.round(value).toLocaleString()
  }
  // Commodities
  return `$${value.toFixed(2)}`
}

// ── Public API ──

/**
 * Poll all economic indicators and detect anomalies.
 */
export async function pollEconomicIndicators(): Promise<{ polled: number; anomalies: number }> {
  const settings = loadSettings()
  if (!settings.economic?.enabled) {
    return { polled: 0, anomalies: 0 }
  }

  console.log('[economic] Starting poll cycle...')
  let polled = 0
  let anomalies = 0

  for (const config of INDICATORS) {
    try {
      const data = await fetchYahooData(config.yahooSymbol)
      if (!data) {
        console.warn(`[economic] No data returned for ${config.symbol}`)
        continue
      }

      const anomalyResult = detectAnomaly(config, data.current, data.previousClose, data.closes7d, data.closes30d)

      const indicator: EconomicIndicator = {
        id: uuidv4(),
        symbol: config.symbol,
        name: config.name,
        category: config.category,
        value: data.current,
        previous_close: data.previousClose,
        change_pct_24h: anomalyResult.change24h,
        change_pct_7d: anomalyResult.change7d,
        high_30d: anomalyResult.high30d,
        low_30d: anomalyResult.low30d,
        is_anomaly: anomalyResult.isAnomaly,
        anomaly_type: anomalyResult.anomalyType,
        related_zones: anomalyResult.isAnomaly ? config.relatedZones : null,
        fetched_at: new Date().toISOString()
      }

      upsertIndicator(indicator)
      polled++

      if (anomalyResult.isAnomaly) {
        anomalies++
        createIntelItemForAnomaly(config, indicator, anomalyResult)
      }

      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (err) {
      console.error(`[economic] Error polling ${config.symbol}:`, err instanceof Error ? err.message : String(err))
    }
  }

  // Clean up old indicators (older than 7 days)
  try {
    const db = getDatabase()
    db.prepare("DELETE FROM economic_indicators WHERE fetched_at < datetime('now', '-7 days')").run()
  } catch { /* ignore */ }

  console.log(`[economic] Poll complete: ${polled} indicators, ${anomalies} anomalies detected`)
  return { polled, anomalies }
}

/**
 * Get current economic indicator data (latest fetch for each symbol).
 */
export function getEconomicIndicators(): EconomicIndicator[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT * FROM economic_indicators
    WHERE id IN (
      SELECT id FROM economic_indicators ei2
      WHERE ei2.symbol = economic_indicators.symbol
      ORDER BY fetched_at DESC LIMIT 1
    )
    ORDER BY category, symbol
  `).all() as EconomicIndicator[]
}

/**
 * Get only indicators flagged as anomalies.
 */
export function getEconomicAnomalies(): EconomicIndicator[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT * FROM economic_indicators
    WHERE is_anomaly = 1
    ORDER BY fetched_at DESC
  `).all() as EconomicIndicator[]
}

/**
 * Build economic context string for AI sense-making prompt.
 * Only includes indicators with recent anomalies highlighted.
 */
export function getEconomicContextString(): string {
  try {
    const indicators = getEconomicIndicators()
    if (indicators.length === 0) return 'No economic indicator data available.'

    const lines: string[] = []
    for (const ind of indicators) {
      const change24h = ind.change_pct_24h !== null
        ? `${ind.change_pct_24h >= 0 ? '+' : ''}${(ind.change_pct_24h * 100).toFixed(1)}%`
        : 'N/A'
      const anomalyTag = ind.is_anomaly ? ' ← ANOMALY' : ''
      const valueStr = formatValue(ind.value, ind.category)
      lines.push(`${ind.name}: ${valueStr} (${change24h} 24h)${anomalyTag}`)
    }

    return lines.join('\n')
  } catch {
    return 'Economic data unavailable (database not ready).'
  }
}

/**
 * Start periodic polling for economic indicators.
 * Polls every 30 minutes during market hours, every 2 hours outside.
 */
export function startEconomicPolling(intervalMs?: number): void {
  if (isPolling) {
    console.log('[economic] Already polling, skipping start')
    return
  }

  isPolling = true
  const interval = intervalMs ?? 30 * 60 * 1000 // default 30 min

  console.log(`[economic] Starting polling with interval ${interval / 1000}s`)

  // Initial poll
  pollEconomicIndicators().catch(err => {
    console.error('[economic] Initial poll failed:', err)
  })

  // Schedule recurring polls
  const scheduleNext = (): void => {
    if (!isPolling) return

    // Adjust interval based on market hours
    const now = new Date()
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const hour = etNow.getHours()
    const day = etNow.getDay()

    // Market hours: M-F 8am-5pm ET → poll every 30 min
    // Outside market hours → poll every 2 hours
    const isMarketHours = day >= 1 && day <= 5 && hour >= 8 && hour < 17
    const adjustedInterval = intervalMs ? interval : (isMarketHours ? 30 * 60 * 1000 : 2 * 60 * 60 * 1000)

    pollTimer = setTimeout(async () => {
      if (!isPolling) return
      try {
        await pollEconomicIndicators()
      } catch (err) {
        console.error('[economic] Poll failed:', err)
      }
      scheduleNext()
    }, adjustedInterval)
  }

  scheduleNext()
}

/**
 * Stop economic indicator polling.
 */
export function stopEconomicPolling(): void {
  isPolling = false
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  console.log('[economic] Polling stopped')
}

/**
 * Get current polling status.
 */
export function getEconomicStatus(): {
  running: boolean
  indicatorCount: number
  anomalyCount: number
  lastPoll: string | null
} {
  let indicatorCount = 0
  let anomalyCount = 0
  let lastPoll: string | null = null

  try {
    const db = getDatabase()
    indicatorCount = (db.prepare('SELECT COUNT(DISTINCT symbol) as cnt FROM economic_indicators').get() as { cnt: number }).cnt
    anomalyCount = (db.prepare("SELECT COUNT(*) as cnt FROM economic_indicators WHERE is_anomaly = 1 AND fetched_at > datetime('now', '-24 hours')").get() as { cnt: number }).cnt
    const last = db.prepare("SELECT MAX(fetched_at) as last_poll FROM economic_indicators").get() as { last_poll: string | null }
    lastPoll = last.last_poll
  } catch { /* DB not ready */ }

  return {
    running: isPolling,
    indicatorCount,
    anomalyCount,
    lastPoll
  }
}