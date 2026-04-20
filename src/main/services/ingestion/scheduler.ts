/**
 * Ingestion Scheduler — orchestrates periodic fetching from all news sources.
 *
 * Uses setInterval for polling. Each tick fetches from NewsAPI and GDELT,
 * processes articles, and logs results.
 */

import { config } from '../../utils/config'
import { fetchNewsApiHeadlines, fetchGdeltArticles, type IngestionResult } from './news'
import { processArticles, bootstrapDedupCache, getProcessorStats } from './processor'

// ── Scheduler state ──

let newsTimer: ReturnType<typeof setInterval> | null = null
let isRunning = false
let lastIngestion: IngestionResult | null = null
let totalIngested = 0
let totalRuns = 0

/** GDELT query rotation for variety (space-separated = implicit OR for GDELT v2) */
const GDELT_QUERIES = [
  'conflict crisis war',
  'military defense naval',
  'diplomacy sanctions treaty',
  'cyber security terrorism',
  'trade energy sanctions',
  'missile strike attack',
  'nuclear weapons proliferation'
]

let gdeltQueryIdx = 0

// ── Public API ──

/**
 * Start the ingestion scheduler.
 * Bootstraps the dedup cache and begins polling.
 */
export function startIngestion(): void {
  if (isRunning) {
    console.warn('[scheduler] Already running')
    return
  }

  console.log(`[scheduler] Starting news ingestion (interval: ${config.polling.newsMs}ms)`)
  isRunning = true

  // Bootstrap dedup cache from existing DB entries
  bootstrapDedupCache()

  // Run first fetch immediately
  runIngestionCycle()

  // Schedule subsequent fetches
  newsTimer = setInterval(() => {
    runIngestionCycle()
  }, config.polling.newsMs)
}

/** Stop the ingestion scheduler */
export function stopIngestion(): void {
  if (newsTimer) {
    clearInterval(newsTimer)
    newsTimer = null
  }
  isRunning = false
  console.log('[scheduler] Stopped')
}

/** Get current scheduler status */
export function getIngestionStatus(): {
  isRunning: boolean
  totalRuns: number
  totalIngested: number
  lastResult: IngestionResult | null
  processorStats: ReturnType<typeof getProcessorStats>
} {
  return {
    isRunning,
    totalRuns,
    totalIngested,
    lastResult: lastIngestion,
    processorStats: getProcessorStats()
  }
}

/**
 * Manually trigger an ingestion cycle (e.g., from IPC).
 * Optionally specify a custom query for GDELT.
 */
export async function triggerManualIngestion(gdeltQuery?: string): Promise<IngestionResult> {
  return runIngestionCycle(gdeltQuery)
}

// ── Internal ──

async function runIngestionCycle(customQuery?: string): Promise<IngestionResult> {
  const cycleStart = Date.now()
  console.log('[scheduler] Starting ingestion cycle...')

  const allRawArticles: Awaited<ReturnType<typeof fetchNewsApiHeadlines>> = []

  // Fetch from NewsAPI
  try {
    const newsApiArticles = await fetchNewsApiHeadlines()
    allRawArticles.push(...newsApiArticles)
  } catch (err) {
    console.error('[scheduler] NewsAPI fetch error:', err)
  }

  // Fetch from GDELT (free, unlimited)
  try {
    const query = customQuery || GDELT_QUERIES[gdeltQueryIdx % GDELT_QUERIES.length]
    gdeltQueryIdx++
    const gdeltArticles = await fetchGdeltArticles(query)
    allRawArticles.push(...gdeltArticles)
  } catch (err) {
    console.error('[scheduler] GDELT fetch error:', err)
  }

  // Process all articles (async: includes ChromaDB embedding)
  const result = await processArticles(allRawArticles)
  result.elapsedMs = Date.now() - cycleStart

  // Update stats
  totalRuns++
  totalIngested += result.inserted
  lastIngestion = result

  console.log(
    `[scheduler] Cycle complete: ${result.inserted} new, ${result.duplicates} dupes, ` +
    `${result.errors} errors (${result.elapsedMs}ms)`
  )

  return result
}