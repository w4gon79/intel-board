/**
 * Prediction Review & Self-Calibration System
 *
 * Autonomously reviews past predictions that are overdue, gathers evidence
 * from multiple sources (RAG, NewsAPI, direct DB), uses the LLM to judge
 * accuracy, and feeds calibration data back into future prediction prompts.
 */

import { getDatabase } from '../storage/database'
import {
  insertReview,
  getReviewsByPredictionId,
  getRecentReviews,
  updateCalibration,
  getAllCalibrations,
  getReviewCountsWithOutcome,
  resolvePrediction,
  type ReviewEvidence,
  type PredictionReview
} from '../storage/dbService'
import { vectorSearch } from '../storage/vectordb'
import { fetchNewsApiEverything } from '../ingestion/news'
import { loadSettings } from '../../ipc/settings.handlers'
import { config } from '../../utils/config'
import { withWorldContext } from '../../utils/worldContext'

// ── Types ──

export interface ReviewResult {
  predictionId: string
  outcome: 'accurate' | 'inaccurate' | 'partially_accurate' | 'inconclusive'
  wasAccurate: boolean | null
  evidence: ReviewEvidence[]
  reasoning: string
  modelUsed: string
  reviewedAt: string
}

export interface ReviewStats {
  totalReviewed: number
  accurate: number
  inaccurate: number
  partiallyAccurate: number
  inconclusive: number
  accuracyByCategory: Record<string, { total: number; accurate: number; rate: number }>
  accuracyByRegion: Record<string, { total: number; accurate: number; rate: number }>
  recentReviews: PredictionReview[]
  calibrationNote: string
}

interface OverduePrediction {
  id: string
  prediction_text: string | null
  confidence: number | null
  model_used: string | null
  sources: string | null
  predicted_at: string
  expected_by: string | null
  outcome: string | null
  categories: string | null
  region: string | null
}

// ── Configured Model Helper (avoids circular dep with predictor.ts) ──

function getConfiguredModel(): string {
  try {
    return loadSettings().ai.chatModel || 'qwen2.5:3b'
  } catch {
    return 'qwen2.5:3b'
  }
}

// ── Region Extraction Helper ──

function extractRegionFromSources(sources: string[]): string {
  for (const s of sources) {
    const parts = s.split(':')
    if (parts.length >= 2 && parts[0] !== 'anomaly') {
      return parts.slice(1).join(':').trim()
    }
  }
  return 'global'
}

// ── LLM Call Helper ──

async function callOllama(messages: { role: string; content: string }[]): Promise<string> {
  const model = getConfiguredModel()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000) // 2 min timeout for reviews

  try {
    const resp = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature: 0.3 }
      }),
      signal: controller.signal
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Ollama HTTP ${resp.status}: ${text}`)
    }

    const data = (await resp.json()) as { message?: { content?: string } }
    return data.message?.content?.trim() ?? ''
  } finally {
    clearTimeout(timeout)
  }
}

// ── Step A: Extract Search Queries ──

async function extractSearchQueries(predictionText: string): Promise<string[]> {
  const messages = [
    {
      role: 'system',
      content:
        withWorldContext('You are an intelligence research assistant. Given a geopolitical prediction, extract 2-3 targeted news search queries using key entities (countries, leaders, military units, locations, events). Return ONLY a JSON array of query strings, nothing else. Example: ["Iran Hormuz strait naval escalation", "US carrier strike group Arabian Sea deployment"]')
    },
    {
      role: 'user',
      content: `Extract search queries from this prediction:\n\n${predictionText}`
    }
  ]

  const response = await callOllama(messages)

  try {
    // Try to parse JSON array from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const queries = JSON.parse(jsonMatch[0]) as string[]
      if (Array.isArray(queries) && queries.length > 0) {
        return queries.slice(0, 3)
      }
    }
  } catch {
    // Fallback: use the prediction text itself as a query
  }

  // Fallback: use the first 100 chars of the prediction
  return [predictionText.substring(0, 100)]
}

// ── Step B: Gather Evidence ──

async function gatherEvidence(
  prediction: OverduePrediction,
  searchQueries: string[]
): Promise<ReviewEvidence[]> {
  const evidence: ReviewEvidence[] = []
  const seenUrls = new Set<string>()
  const predictedAt = prediction.predicted_at

  // B(a): RAG Vector Search
  try {
    const queryText = prediction.prediction_text ?? ''
    const ragResults = await vectorSearch(queryText, { topK: 15 })

    for (const result of ragResults) {
      const url = result.metadata.source_id
      if (seenUrls.has(url)) continue
      seenUrls.add(url)

      evidence.push({
        source: result.metadata.source_type ?? 'rag',
        title: result.metadata.feed ?? 'RAG Retrieved Document',
        snippet: result.text.substring(0, 300),
        url: `source:${url}`,
        publishedAt: result.metadata.timestamp ?? '',
        supportsPrediction: 'neutral' // will be assessed by LLM
      })
    }

    console.log(`[predictionReviewer] RAG search found ${ragResults.length} results`)
  } catch (err) {
    console.warn('[predictionReviewer] RAG search failed:', err)
  }

  // B(b): NewsAPI Everything Endpoint
  for (const query of searchQueries) {
    try {
      const articles = await fetchNewsApiEverything(query)
      for (const article of articles) {
        const url = article.url ?? ''
        if (!url || seenUrls.has(url)) continue
        seenUrls.add(url)

        evidence.push({
          source: article.source,
          title: article.title ?? 'Untitled',
          snippet: (article.content ?? '').substring(0, 300),
          url,
          publishedAt: article.publishedAt ?? '',
          supportsPrediction: 'neutral'
        })
      }
      console.log(`[predictionReviewer] NewsAPI query "${query}" found ${articles.length} articles`)
    } catch (err) {
      console.warn(`[predictionReviewer] NewsAPI query "${query}" failed:`, err)
    }
  }

  // B(c): Direct SQLite search on intel_items
  try {
    const db = getDatabase()
    const keywords = searchQueries
      .flatMap((q) => q.split(/\s+/))
      .filter((w) => w.length > 3)
      .slice(0, 6) // limit keywords

    for (const keyword of keywords) {
      const rows = db
        .prepare(
          `SELECT title, content, source, url, timestamp
           FROM intel_items
           WHERE (title LIKE ? OR content LIKE ?)
             AND timestamp > ?
           ORDER BY timestamp DESC
           LIMIT 20`
        )
        .all(`%${keyword}%`, `%${keyword}%`, predictedAt) as {
        title: string | null
        content: string | null
        source: string | null
        url: string | null
        timestamp: string
      }[]

      for (const row of rows) {
        const url = row.url ?? row.title ?? ''
        if (seenUrls.has(url)) continue
        seenUrls.add(url)

        evidence.push({
          source: row.source ?? 'intel_db',
          title: row.title ?? 'Intel Item',
          snippet: (row.content ?? '').substring(0, 300),
          url: url,
          publishedAt: row.timestamp,
          supportsPrediction: 'neutral'
        })
      }
    }

    console.log(`[predictionReviewer] Intel DB search using ${keywords.length} keywords`)
  } catch (err) {
    console.warn('[predictionReviewer] Intel DB search failed:', err)
  }

  return evidence
}

// ── Step C: LLM Judges Accuracy ──

async function judgeAccuracy(
  prediction: OverduePrediction,
  evidence: ReviewEvidence[]
): Promise<{
  verdict: 'accurate' | 'inaccurate' | 'partially_accurate' | 'inconclusive'
  reasoning: string
  evidenceScore: string
  keyFinding: string
}> {
  // Format evidence for the prompt
  const evidenceText = evidence
    .slice(0, 25) // cap at 25 evidence items to keep prompt manageable
    .map(
      (e, i) =>
        `[${i + 1}] Source: ${e.source} | Title: ${e.title} | Date: ${e.publishedAt}\n    Snippet: ${e.snippet}`
    )
    .join('\n\n')

  const messages = [
    {
      role: 'system',
      content: `You are a senior intelligence analyst reviewing your own past predictions for accuracy.`
    },
    {
      role: 'user',
      content: `## Original Prediction
Predicted on: ${prediction.predicted_at}
Expected by: ${prediction.expected_by ?? 'N/A'}
Prediction: ${prediction.prediction_text ?? 'N/A'}
Confidence at time: ${prediction.confidence ?? 'N/A'}%

## Gathered Evidence (${evidence.length} items)
${evidenceText || 'No evidence found.'}

## Your Task
Based ONLY on the evidence above, determine whether the prediction was accurate.

Rules:
1. Be strict. A prediction is "accurate" only if the core claim came true. Partial fulfillment = partially_accurate.
2. If no relevant evidence was found, mark as "inconclusive" — do not guess.
3. "Accurate" means the specific outcome predicted actually happened, not just that something related happened.
4. Consider the timeframe — evidence outside the predicted timeframe is less relevant.

Respond EXACTLY in this format:
---VERDICT---
[accurate / inaccurate / partially_accurate / inconclusive]
---REASONING---
[2-4 sentences explaining your verdict with specific evidence citations]
---EVIDENCE_SCORE---
[sufficient / insufficient — was there enough evidence to make a confident judgment?]
---KEY_FINDING---
[One sentence: what actually happened, regardless of the prediction]`
    }
  ]

  const response = await callOllama(messages)

  // Parse the structured response
  const verdictMatch = response.match(/---VERDICT---\s*\n?\s*(accurate|inaccurate|partially_accurate|inconclusive)/i)
  const reasoningMatch = response.match(/---REASONING---\s*\n?\s*([\s\S]*?)(?=---EVIDENCE_SCORE---)/i)
  const evidenceScoreMatch = response.match(/---EVIDENCE_SCORE---\s*\n?\s*(sufficient|insufficient)/i)
  const keyFindingMatch = response.match(/---KEY_FINDING---\s*\n?\s*([\s\S]*?)$/i)

  const verdict = (
    verdictMatch?.[1]?.toLowerCase() ?? 'inconclusive'
  ) as 'accurate' | 'inaccurate' | 'partially_accurate' | 'inconclusive'

  return {
    verdict,
    reasoning: reasoningMatch?.[1]?.trim() ?? 'No reasoning provided.',
    evidenceScore: evidenceScoreMatch?.[1]?.toLowerCase() ?? 'insufficient',
    keyFinding: keyFindingMatch?.[1]?.trim() ?? 'No key finding determined.'
  }
}

// ── Step E: Recalculate All Calibration Data ──

function recalculateAllCalibrations(): void {
  const allData = getReviewCountsWithOutcome()

  // Group by region extracted from prediction sources
  const groups = new Map<string, Array<{ outcome: string; was_accurate: number | null }>>()

  for (const row of allData) {
    let sources: string[] = []
    try {
      sources = row.prediction_sources ? JSON.parse(row.prediction_sources) : []
    } catch {
      sources = []
    }
    const region = extractRegionFromSources(sources)
    const categories = ['general'] // predictions don't store category directly; use general

    for (const category of categories) {
      const key = `${category}::${region}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push({ outcome: row.outcome, was_accurate: row.was_accurate })
    }
  }

  for (const [key, reviews] of groups) {
    const [category, region] = key.split('::')
    const total = reviews.length
    if (total === 0) continue

    // Inconclusive predictions are failures — they predicted something unverifiable
    // Count them as inaccurate for calibration purposes
    const accurate = reviews.filter((r) => r.was_accurate === 1).length
    const inaccurate = reviews.filter((r) => r.was_accurate === 0).length
    const partial = reviews.filter((r) => r.outcome === 'partially_accurate').length
    const inconclusive = reviews.filter((r) => r.was_accurate === null).length
    const accuracyRate = total > 0 ? (accurate + partial * 0.5) / total : 0

    updateCalibration(category, region, {
      total_predictions: total,
      accurate_count: accurate,
      inaccurate_count: inaccurate,
      partial_count: partial,
      inconclusive_count: inconclusive,
      accuracy_rate: Math.round(accuracyRate * 100) / 100,
      failure_pattern: null // preserved by updateCalibration if already set
    })
  }
}

async function analyzeFailurePatterns(
  reviews: PredictionReview[]
): Promise<string> {
  if (reviews.length < 2) return ''

  const reviewSummary = reviews
    .slice(0, 20)
    .map((r) => {
      const verdict = r.outcome === 'inconclusive' ? 'INCONCLUSIVE (unverifiable)' : r.outcome
      return `- [${verdict}] ${(r.key_finding ?? 'N/A').substring(0, 100)}`
    })
    .join('\n')

  const accurate = reviews.filter(r => r.was_accurate === true).length
  const inaccurate = reviews.filter(r => r.was_accurate === false).length
  const inconclusive = reviews.filter(r => r.was_accurate === null).length

  const messages = [
    {
      role: 'system',
      content: 'You are analyzing prediction accuracy patterns. Output structured, actionable advice.'
    },
    {
      role: 'user',
      content: `Analyze ${reviews.length} prediction reviews (${accurate} accurate, ${inaccurate} inaccurate, ${inconclusive} inconclusive):

${reviewSummary}

Respond in EXACTLY this format:
---FAILURE_MODE---
[One sentence: the #1 reason predictions fail, e.g. "Predicting military movements that are classified and never reported publicly"]
---AVOID_REGIONS---
[Comma-separated list of regions/areas where predictions have been consistently wrong, e.g. "Baltic Sea, Gibraltar, North Sea, Algeria"]
---AVOID_TYPES---
[Comma-separated list of prediction types that fail, e.g. "submarine deployments, NATO exercises, routine patrols"]
---ADVICE---
[One sentence of specific advice, e.g. "Only predict about major conflict escalations that Reuters would cover"]`
    }
  ]

  try {
    return await callOllama(messages)
  } catch {
    return ''
  }
}

// ── Main Function: reviewOverduePredictions ──

export async function reviewOverduePredictions(): Promise<number> {
  console.log('[predictionReviewer] Starting review cycle...')

  const db = getDatabase()

  // Find overdue predictions that haven't been reviewed yet
  const predictions = db
    .prepare(
      `SELECT p.id, p.prediction_text, p.confidence, p.model_used, p.sources,
              p.predicted_at, p.expected_by, p.outcome,
              COALESCE(i.categories, '["general"]') as categories,
              COALESCE(i.region, 'global') as region
       FROM predictions p
       LEFT JOIN intel_items i ON p.prediction_text = i.title
       WHERE p.resolved_at IS NULL
         AND p.expected_by IS NOT NULL
         AND p.expected_by < datetime('now')
         AND (p.outcome IS NULL OR p.outcome = 'overdue_awaiting_review')
         AND p.id NOT IN (SELECT prediction_id FROM prediction_reviews WHERE outcome != 'inconclusive')
       ORDER BY p.expected_by ASC
       LIMIT 25`
    )
    .all() as OverduePrediction[]

  if (predictions.length === 0) {
    console.log('[predictionReviewer] No overdue predictions to review')
    return 0
  }

  console.log(`[predictionReviewer] Found ${predictions.length} overdue predictions to review`)

  let reviewed = 0
  const batchReviews: PredictionReview[] = []

  for (const prediction of predictions) {
    try {
      console.log(
        `[predictionReviewer] Reviewing prediction ${prediction.id}: "${(prediction.prediction_text ?? '').substring(0, 80)}..."`
      )

      // Step A: Extract search queries
      const searchQueries = await extractSearchQueries(prediction.prediction_text ?? '')
      console.log(`[predictionReviewer] Generated search queries:`, searchQueries)

      // Step B: Gather evidence
      const evidence = await gatherEvidence(prediction, searchQueries)
      console.log(`[predictionReviewer] Gathered ${evidence.length} evidence items`)

      // Step C: LLM judges accuracy
      const judgment = await judgeAccuracy(prediction, evidence)

      // Step D: Map verdict and store results
      const wasAccurate: boolean | null =
        judgment.verdict === 'accurate'
          ? true
          : judgment.verdict === 'inaccurate'
            ? false
            : judgment.verdict === 'partially_accurate'
              ? true
              : null // inconclusive

      const modelUsed = getConfiguredModel()

      // Store the review
      const reviewId = insertReview({
        predictionId: prediction.id,
        outcome: judgment.verdict,
        wasAccurate,
        evidence,
        reasoning: judgment.reasoning,
        keyFinding: judgment.keyFinding,
        evidenceScore: judgment.evidenceScore,
        modelUsed
      })

      console.log(
        `[predictionReviewer] Review ${reviewId}: verdict=${judgment.verdict}, evidence=${judgment.evidenceScore}`
      )

      // Resolve the prediction regardless of outcome (including inconclusive)
      resolvePrediction(prediction.id, judgment.verdict, wasAccurate)

      // Calibration is recalculated after the entire batch (below)

      // Collect for batch failure analysis
      const review = getReviewsByPredictionId(prediction.id)[0]
      if (review) batchReviews.push(review)

      reviewed++
    } catch (err) {
      console.error(
        `[predictionReviewer] Error reviewing prediction ${prediction.id}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // Recalculate all calibration data based on all reviews
  recalculateAllCalibrations()

  // Batch: Analyze failure patterns and update calibration
  if (batchReviews.length >= 2) {
    try {
      const failurePattern = await analyzeFailurePatterns(batchReviews)
      if (failurePattern) {
        // Update all calibration rows with the failure pattern
        const calibrations = getAllCalibrations()
        for (const cal of calibrations) {
          updateCalibration(cal.category, cal.region, {
            ...cal,
            failure_pattern: failurePattern
          })
        }
        console.log(`[predictionReviewer] Updated failure patterns: "${failurePattern.substring(0, 100)}..."`)
      }
    } catch (err) {
      console.warn('[predictionReviewer] Failure pattern analysis failed:', err)
    }
  }

  console.log(`[predictionReviewer] Review cycle complete: ${reviewed}/${predictions.length} reviewed`)
  return reviewed
}

// ── Calibration Context for Predictor ──

export function getCalibrationContext(category?: string, region?: string): string {
  const calibrations = getAllCalibrations()

  if (calibrations.length === 0) return ''

  const parts: string[] = []

  // Filter to relevant calibrations
  const relevant = calibrations.filter((c) => {
    if (category && c.category !== category && c.category !== 'general') return false
    if (region && c.region !== region && c.region !== 'global') return false
    return true
  })

  for (const cal of relevant) {
    const pct = Math.round(cal.accuracy_rate * 100)
    const line = `Historical performance for ${cal.category} predictions${cal.region !== 'global' ? ` in ${cal.region}` : ' (global)'}: ${pct}% accuracy (${cal.accurate_count} accurate, ${cal.inaccurate_count} inaccurate, ${cal.partial_count} partial out of ${cal.total_predictions} reviewed).`
    parts.push(line)

    if (cal.failure_pattern) {
      parts.push(`Common failure pattern: ${cal.failure_pattern}`)
    }
  }

  if (parts.length === 0) return ''

  return `## Historical Prediction Performance\n${parts.join('\n')}\n\nAdjust confidence accordingly — if past predictions in this category/region have been inaccurate, be more conservative.`
}

// ── Review Scheduler ──

let reviewInterval: ReturnType<typeof setInterval> | null = null

export function seedCalibrationFromExistingReviews(): void {
  console.log('[predictionReviewer] Seeding calibration from existing reviews...')
  recalculateAllCalibrations()
}

/**
 * One-time migration: resolve any predictions that have reviews
 * but are still missing resolved_at (e.g. previously inconclusive predictions).
 */
export function resolveOrphanedReviewedPredictions(): void {
  const db = getDatabase()

  const unresolved = db.prepare(`
    SELECT p.id FROM predictions p
    INNER JOIN prediction_reviews pr ON pr.prediction_id = p.id
    WHERE p.resolved_at IS NULL
  `).all() as { id: string }[]

  if (unresolved.length === 0) {
    console.log('[predictionReviewer] No orphaned reviewed predictions to resolve')
    return
  }

  console.log(`[predictionReviewer] Resolving ${unresolved.length} orphaned reviewed predictions...`)

  for (const row of unresolved) {
    const review = db.prepare(
      'SELECT outcome, was_accurate FROM prediction_reviews WHERE prediction_id = ? ORDER BY reviewed_at DESC LIMIT 1'
    ).get(row.id) as { outcome: string; was_accurate: number | null } | undefined

    if (review) {
      const wasAccurate = review.was_accurate === 1 ? true : review.was_accurate === 0 ? false : null
      resolvePrediction(row.id, review.outcome, wasAccurate)
      console.log(`[predictionReviewer] Resolved orphaned prediction ${row.id} -> ${review.outcome}`)
    }
  }

  console.log('[predictionReviewer] Orphaned prediction resolution complete')
}

export function startReviewScheduler(intervalMs: number = 2 * 60 * 60 * 1000): void {
  if (reviewInterval) {
    console.warn('[predictionReviewer] Scheduler already running')
    return
  }

  // Seed calibration from any existing review data
  seedCalibrationFromExistingReviews()

  // One-time migration: resolve predictions that have reviews but no resolved_at
  resolveOrphanedReviewedPredictions()

  console.log(`[predictionReviewer] Starting scheduler (interval: ${intervalMs / 1000}s)`)

  // Run first review after a short delay (1 minute) to let other services initialize
  setTimeout(() => {
    reviewOverduePredictions().catch((err) => {
      console.error('[predictionReviewer] Initial review failed:', err)
    })
  }, 60_000)

  reviewInterval = setInterval(() => {
    reviewOverduePredictions().catch((err) => {
      console.error('[predictionReviewer] Scheduled review failed:', err)
    })
  }, intervalMs)
}

export function stopReviewScheduler(): void {
  if (reviewInterval) {
    clearInterval(reviewInterval)
    reviewInterval = null
    console.log('[predictionReviewer] Scheduler stopped')
  }
}

// ── Review Stats for UI ──

export function getReviewStats(): ReviewStats {
  const db = getDatabase()

  // Total counts
  const totalRow = db
    .prepare('SELECT COUNT(*) as count FROM prediction_reviews')
    .get() as { count: number }
  const totalReviewed = totalRow.count

  const outcomeRows = db
    .prepare(
      `SELECT outcome, COUNT(*) as count FROM prediction_reviews GROUP BY outcome`
    )
    .all() as { outcome: string; count: number }[]

  let accurate = 0
  let inaccurate = 0
  let partiallyAccurate = 0
  let inconclusive = 0

  for (const row of outcomeRows) {
    switch (row.outcome) {
      case 'accurate':
        accurate = row.count
        break
      case 'inaccurate':
        inaccurate = row.count
        break
      case 'partially_accurate':
        partiallyAccurate = row.count
        break
      case 'inconclusive':
        inconclusive = row.count
        break
    }
  }

  // Accuracy by category (from calibration table)
  const calibrations = getAllCalibrations()
  const accuracyByCategory: Record<string, { total: number; accurate: number; rate: number }> = {}
  const accuracyByRegion: Record<string, { total: number; accurate: number; rate: number }> = {}

  for (const cal of calibrations) {
    accuracyByCategory[cal.category] = {
      total: cal.total_predictions,
      accurate: cal.accurate_count,
      rate: cal.accuracy_rate
    }
    accuracyByRegion[cal.region] = accuracyByRegion[cal.region] ?? {
      total: 0,
      accurate: 0,
      rate: 0
    }
    accuracyByRegion[cal.region].total += cal.total_predictions
    accuracyByRegion[cal.region].accurate += cal.accurate_count
  }

  // Recalculate region rates
  for (const region of Object.keys(accuracyByRegion)) {
    const r = accuracyByRegion[region]
    r.rate = r.total > 0 ? Math.round((r.accurate / r.total) * 100) / 100 : 0
  }

  const recentReviewsList = getRecentReviews(10)
  const calibrationNote = getCalibrationContext()

  return {
    totalReviewed,
    accurate,
    inaccurate,
    partiallyAccurate,
    inconclusive,
    accuracyByCategory,
    accuracyByRegion,
    recentReviews: recentReviewsList,
    calibrationNote
  }
}