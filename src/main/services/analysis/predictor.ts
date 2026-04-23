/**
 * Predictive Analysis Engine
 *
 * Generates AI-powered predictions when anomalies are detected.
 * Uses the Ollama LLM with RAG context to produce structured predictions
 * about likely future developments.
 *
 * Flow:
 *   Anomaly detected → Gather RAG context → LLM prompt → Parse response → Store prediction
 *
 * Prediction categories:
 *   - Conflict escalation (military movements + news sentiment)
 *   - Supply chain disruption (choke point congestion + political instability)
 *   - Economic instability (commodity, currency, bond yield anomalies)
 *   - Geopolitical shift (diplomatic events + military posture changes)
 */

import { getDatabase } from '../storage/database'
import {
  insertPrediction,
  getUnresolvedPredictions,
  resolvePrediction
} from '../storage/dbService'
import { vectorSearch } from '../storage/vectordb'
import { withWorldContext } from '../../utils/worldContext'
import { getCalibrationContext } from './predictionReviewer'
import { getAllCalibrations } from '../storage/dbService'

// ─── Types ─────────────────────────────────────────────────────────────────

export type PredictionCategory =
  | 'conflict_escalation'
  | 'supply_chain_disruption'
  | 'economic_instability'
  | 'geopolitical_shift'

export interface PredictionInput {
  /** The anomaly or intel item that triggered this prediction */
  triggerId: string
  /** Metric that was anomalous */
  metric: string
  /** Region of the anomaly */
  region: string
  /** Severity of the triggering anomaly */
  severity: string
  /** Human-readable description of the trigger */
  triggerDescription: string
  /** Category hint based on the metric */
  category: PredictionCategory
}

export interface PredictionOutput {
  /** The prediction text (what will happen) */
  predictionText: string
  /** Confidence score 0-100 */
  confidence: number
  /** Timeframe for the prediction */
  expectedBy: string
  /** Which sources/anomalies were used */
  sources: string[]
  /** Which model generated this */
  modelUsed: string
  /** Category */
  category: PredictionCategory
}

// ─── Constants ─────────────────────────────────────────────────────────────

const RAG_TOP_K = 10
const MIN_CONFIDENCE = 10
const MAX_CONFIDENCE = 80
const PREDICTION_COOLDOWN_HOURS = 6

// ─── Category mapping ──────────────────────────────────────────────────────

const METRIC_TO_CATEGORY: Record<string, PredictionCategory> = {
  military_flight_count: 'conflict_escalation',
  ship_traffic_chokepoint: 'supply_chain_disruption',
  gfw_traffic_chokepoint: 'supply_chain_disruption',
  transit_corridor_traffic: 'supply_chain_disruption',
  news_volume: 'geopolitical_shift'
}


// ─── Prompt templates ──────────────────────────────────────────────────────

function getCalibrationNote(): string {
  try {
    const calibrations = getAllCalibrations()
    if (calibrations.length === 0) return '(No historical data yet — be conservative)'

    const totalAccurate = calibrations.reduce((sum, c) => sum + c.accurate_count, 0)
    const totalPredictions = calibrations.reduce((sum, c) => sum + c.total_predictions, 0)
    const overallRate = totalPredictions > 0 ? Math.round((totalAccurate / totalPredictions) * 100) : 0

    const lines: string[] = [`Overall accuracy: ${overallRate}% (${totalAccurate}/${totalPredictions} correct)`]

    for (const cal of calibrations) {
      if (cal.total_predictions >= 2) {
        const pct = Math.round(cal.accuracy_rate * 100)
        lines.push(`${cal.region}: ${pct}% accuracy (${cal.total_predictions} predictions)`)
        if (cal.failure_pattern) {
          lines.push(`  Known failure: ${cal.failure_pattern.substring(0, 150)}`)
        }
      }
    }

    if (overallRate < 30) {
      lines.push('WARNING: Your accuracy is critically low. Default to INSUFFICIENT_DATA for almost everything.')
    } else if (overallRate < 50) {
      lines.push('CAUTION: Your accuracy is below 50%. Only predict when data is overwhelming.')
    }

    return lines.join('\n')
  } catch {
    return '(No historical data yet — be conservative)'
  }
}

function getSystemPrompt(): string {
  return `You are a senior intelligence analyst. Your job is to decide whether a detected anomaly warrants a predictive assessment.

## CRITICAL: YOUR TRACK RECORD ${getCalibrationNote()}

You have made predictions before. Many were wrong. You MUST learn from this.

## MANDATORY RULES

1. **DEFAULT TO INSUFFICIENT_DATA.** Most anomalies do NOT warrant predictions. If you are not CERTAIN that a specific, verifiable event will occur, respond with INSUFFICIENT_DATA.

2. **VERIFIABLE ONLY.** A prediction is only valid if it would be reported by Reuters, AP, BBC, or Al Jazeera within the stated timeframe. Ask yourself: "Would a major news outlet publish an article confirming this?" If no, respond INSUFFICIENT_DATA.

3. **GROUND IN THE TRIGGER.** Your prediction must be about the EXACT same region, metric, and actors mentioned in the triggering anomaly. If the trigger is "military flight count increased in Middle East," you predict about Middle East military flights. NOT about Algeria, NOT about the Baltic Sea, NOT about diplomatic negotiations.

4. **NO SPECULATION.** Do not extrapolate beyond the data. "Military flights increased" does not mean "an airstrike is imminent." It means military flights increased. That's it.

5. **SPECIFIC ENTITIES REQUIRED.** Every prediction must name at least one specific entity (country, city, military unit, leader, organization). "Increased tensions in the region" is not a prediction.

6. **BANNED PHRASES.** Never use: "high likelihood", "warrants monitoring", "remains a concern", "likely to continue", "may escalate", "there is a possibility", "growing concern", "heightened risk". These are not predictions.

7. **CALIBRATION AWARENESS.** If your historical accuracy for this type of prediction is below 40%, you should be EXTREMELY reluctant to make any prediction. Return INSUFFICIENT_DATA unless the anomaly data is overwhelming and specific.

8. **TIMEFRAME REALISM.** Predictions must occur within 1-7 days. Do not predict events weeks or months out.

## RESPONSE FORMAT

If the data supports a specific, verifiable prediction:
---PREDICTION---
[A single prediction in 1-2 sentences naming specific entities and outcomes that would appear in news reporting.]
---CONFIDENCE---
[Number between 10 and 80. Never above 80. Calibration data should push this down.]
---TIMEFRAME---
[1-7 days only. Format: "X-Y days"]
---SOURCES_USED---
[List the anomaly IDs and data sources you referenced]
---REASONING---
[2-3 sentences. Quote the specific data points that support this prediction. If you can't quote data, you're hallucinating.]
---ALTERNATIVES---
[1 alternative explanation for the observed anomalies]

If the data does NOT support a specific prediction (this should be the common case):
INSUFFICIENT_DATA`
}

function buildUserPrompt(input: PredictionInput, contextText: string, activeAnomalies: string, calibrationNote?: string): string {
  return `## Critical Reminder
Before generating a prediction, verify:
- Would this event be reported by Reuters, AP, or major news outlets if it happened?
- Is this prediction DIRECTLY grounded in the triggering anomaly (${input.metric} in ${input.region})?
- Am I inventing a scenario, or extrapolating from the data?

If you cannot generate a prediction that meets ALL three criteria, respond with INSUFFICIENT_DATA.

## Triggering Event
An anomaly has been detected that warrants predictive analysis:

- **Metric**: ${input.metric}
- **Region**: ${input.region}
- **Severity**: ${input.severity}
- **Details**: ${input.triggerDescription}
- **Trigger ID**: ${input.triggerId}
- **Category**: ${input.category.replace(/_/g, ' ')}

## Active Anomalies (Current Context)
${activeAnomalies || 'No other active anomalies.'}

## Retrieved Intelligence Context (RAG)
${contextText || 'No additional context available from the intelligence database.'}

${calibrationNote ? `## Historical Prediction Performance\n${calibrationNote}` : ''}

---

Based on the above intelligence, generate your prediction. Remember: only predict events that would appear in major news reporting and are directly supported by the anomaly data.`
}

// ─── Ollama LLM call ───────────────────────────────────────────────────────

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}


/**
 * Call Ollama chat API to generate a prediction.
 * Uses streaming=false for a single complete response.
 * Returns the generated text and the actual model that was used.
 */
interface CallOllamaResult {
  text: string
  model: string
  fellBack: boolean
}

async function callOllama(messages: OllamaChatMessage[]): Promise<CallOllamaResult> {
  const { chat } = await import('../rag/llm')

  const result = await chat(
    messages.map(m => ({ role: m.role, content: m.content })),
    { temperature: 0.1 }
  )

  console.log(`[PREDICTOR] Used model: ${result.model}${result.fellBack ? ' (fallback)' : ''}`)
  return { text: result.text ?? '', model: result.model, fellBack: result.fellBack }
}

// ─── Response parsing ──────────────────────────────────────────────────────

interface ParsedPrediction {
  predictionText: string
  confidence: number
  expectedBy: string
  sourcesUsed: string[]
  reasoning: string
  alternatives: string
  insufficientData: boolean
}

function parseLLMResponse(raw: string): ParsedPrediction {
  const result: ParsedPrediction = {
    predictionText: '',
    confidence: 50,
    expectedBy: '7 days',
    sourcesUsed: [],
    reasoning: '',
    alternatives: '',
    insufficientData: false
  }

  // Check for insufficient data flag
  if (raw.includes('INSUFFICIENT_DATA')) {
    result.insufficientData = true
    result.predictionText = raw.trim()
    result.confidence = 0
    return result
  }

  // Extract sections
  const sections = {
    prediction: extractSection(raw, 'PREDICTION'),
    confidence: extractSection(raw, 'CONFIDENCE'),
    timeframe: extractSection(raw, 'TIMEFRAME'),
    sources: extractSection(raw, 'SOURCES_USED'),
    reasoning: extractSection(raw, 'REASONING'),
    alternatives: extractSection(raw, 'ALTERNATIVES')
  }

  result.predictionText = sections.prediction || raw.substring(0, 500)
  result.confidence = clampConfidence(parseInt(sections.confidence, 10) || 50)
  result.expectedBy = sections.timeframe || estimateDefaultTimeframe(sections.prediction)
  result.sourcesUsed = sections.sources
    ? sections.sources.split('\n').map((s) => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
    : []
  result.reasoning = sections.reasoning || ''
  result.alternatives = sections.alternatives || ''

  return result
}

function extractSection(text: string, sectionName: string): string {
  const regex = new RegExp(`---${sectionName}---\\s*([\\s\\S]*?)(?=---[A-Z_]+---|$)`, 'i')
  const match = text.match(regex)
  return match?.[1]?.trim() ?? ''
}

function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value))
}

function estimateDefaultTimeframe(predictionText: string): string {
  const lower = predictionText.toLowerCase()
  if (lower.includes('hour') || lower.includes('imminent') || lower.includes('immediate')) return '24-48 hours'
  if (lower.includes('day') || lower.includes('short')) return '3-7 days'
  if (lower.includes('week')) return '1-2 weeks'
  if (lower.includes('month')) return '30 days'
  return '7-14 days'
}

// ─── RAG context gathering ─────────────────────────────────────────────────

async function gatherRAGContext(metric: string, region: string): Promise<string> {
  try {
    const query = `Recent developments in ${region} related to ${metric.replace(/_/g, ' ')}`
    const results = await vectorSearch(query, {
      topK: RAG_TOP_K,
      region
    })

    if (results.length === 0) return ''

    return results
      .map((r, i) => {
        const timestamp = r.metadata.timestamp ? ` [${r.metadata.timestamp}]` : ''
        const sourceType = r.metadata.source_type ? ` (${r.metadata.source_type})` : ''
        return `[${i + 1}]${sourceType}${timestamp} ${r.text.substring(0, 300)}`
      })
      .join('\n\n')
  } catch (err) {
    console.warn('[PREDICTOR] RAG context gathering failed:', err)
    return ''
  }
}

// ─── Active anomalies context ──────────────────────────────────────────────

function gatherActiveAnomaliesContext(excludeId?: string): string {
  try {
    const db = getDatabase()
    const anomalies = db
      .prepare(
        `SELECT id, metric, region, baseline_value, observed_value, deviation_sigma, detected_at
         FROM anomalies WHERE status = 'active'
         ORDER BY detected_at DESC LIMIT 10`
      )
      .all() as Array<{
      id: string
      metric: string
      region: string
      baseline_value: number
      observed_value: number
      deviation_sigma: number
      detected_at: string
    }>

    return anomalies
      .filter((a) => a.id !== excludeId)
      .map((a) => {
        const direction = a.observed_value > a.baseline_value ? '↑' : '↓'
        return `- [${a.id.substring(0, 8)}] ${a.metric.replace(/_/g, ' ')} in ${a.region}: ${a.observed_value} (${direction}${a.deviation_sigma.toFixed(1)}σ) detected ${a.detected_at}`
      })
      .join('\n')
  } catch (err) {
    console.warn('[PREDICTOR] Failed to gather active anomalies:', err)
    return ''
  }
}

// ─── Deduplication ─────────────────────────────────────────────────────────

function hasRecentPredictionForMetric(metric: string, region: string): boolean {
  try {
    const db = getDatabase()
    const recent = db
      .prepare(
        `SELECT id FROM predictions
         WHERE sources LIKE ?
           AND predicted_at >= datetime('now', '-${PREDICTION_COOLDOWN_HOURS} hours')
         LIMIT 1`
      )
      .get(`%${metric}:${region}%`) as { id: string } | undefined
    return !!recent
  } catch {
    return false
  }
}

// ─── Main prediction generation ────────────────────────────────────────────

/**
 * Generate a prediction based on a detected anomaly.
 * Called by the anomaly engine when an ALERT or WATCH intel item is created.
 */
export async function generatePrediction(input: PredictionInput): Promise<PredictionOutput | null> {
  console.log(`[PREDICTOR] Generating prediction for: ${input.metric}/${input.region} (${input.severity})`)

  // Dedup check
  if (hasRecentPredictionForMetric(input.metric, input.region)) {
    console.log(`[PREDICTOR] Skipping — recent prediction exists for ${input.metric}/${input.region}`)
    return null
  }

  // ── Calibration gate: skip if this category/region has terrible accuracy ──
  const calibrationContext = getCalibrationContext(input.category, input.region)
  if (calibrationContext) {
    const accuracyMatch = calibrationContext.match(/(\d+)% accuracy/)
    if (accuracyMatch) {
      const accuracy = parseInt(accuracyMatch[1], 10)
      if (accuracy < 25 && !calibrationContext.includes('0 total')) {
        // Less than 25% accuracy AND we have review data — stop generating
        console.log(`[PREDICTOR] Skipping ${input.category}/${input.region} — accuracy ${accuracy}% is below 25% threshold. Predictions in this area have been consistently wrong.`)
        return null
      }
      // If accuracy is 25-40%, only allow if confidence will be capped low
      if (accuracy >= 25 && accuracy < 40) {
        // Allow but cap confidence — prediction must be very specific
        console.log(`[PREDICTOR] Warning: ${input.category}/${input.region} accuracy is ${accuracy}%. Requiring high specificity.`)
      }
    }
  }

  // Gather context
  const [ragContext, activeAnomalies] = await Promise.all([
    gatherRAGContext(input.metric, input.region),
    Promise.resolve(gatherActiveAnomaliesContext(input.triggerId))
  ])

  // Get calibration context for user prompt
  const calibrationNote = calibrationContext || undefined

  // Build prompt — use getSystemPrompt() for dynamic calibration data
  const messages: OllamaChatMessage[] = [
    { role: 'system', content: withWorldContext(getSystemPrompt()) },
    { role: 'user', content: buildUserPrompt(input, ragContext, activeAnomalies, calibrationNote) }
  ]

  // Call LLM
  let rawResponse: string
  let actualModel: string
  try {
    const ollamaResult = await callOllama(messages)
    rawResponse = ollamaResult.text
    actualModel = ollamaResult.model
  } catch (err) {
    console.error('[PREDICTOR] LLM call failed:', err)
    return null
  }

  if (!rawResponse.trim()) {
    console.warn('[PREDICTOR] Empty LLM response')
    return null
  }

  // Parse response
  const parsed = parseLLMResponse(rawResponse)

  if (parsed.insufficientData) {
    console.log(`[PREDICTOR] LLM determined data insufficient for prediction: ${input.metric}/${input.region}`)
    return null
  }

  // Calculate expected_by date
  const expectedBy = calculateExpectedBy(parsed.expectedBy)

  // Build sources list
  const sources = [
    `anomaly:${input.triggerId}`,
    `${input.metric}:${input.region}`,
    ...parsed.sourcesUsed.filter((s) => s.length > 0)
  ]

  // Calibration-based confidence cap
  let confidenceNormalized = parsed.confidence / 100 // Normalize to 0-1 for DB
  if (calibrationContext) {
    const accuracyMatch = calibrationContext.match(/(\d+)% accuracy/)
    if (accuracyMatch) {
      const historicalAccuracy = parseInt(accuracyMatch[1], 10)
      // Cap confidence to 2x historical accuracy (if accuracy is 20%, max confidence is 40%)
      const maxAllowed = Math.min(MAX_CONFIDENCE / 100, (historicalAccuracy / 100) * 2 + 0.1)
      confidenceNormalized = Math.min(confidenceNormalized, maxAllowed)
      if (confidenceNormalized < 0.2) {
        console.log(`[PREDICTOR] Confidence capped to ${Math.round(confidenceNormalized * 100)}% due to ${historicalAccuracy}% historical accuracy. Skipping low-confidence prediction.`)
        return null
      }
    }
  }

  const output: PredictionOutput = {
    predictionText: parsed.predictionText,
    confidence: confidenceNormalized,
    expectedBy: expectedBy.toISOString(),
    sources,
    modelUsed: actualModel,
    category: input.category
  }

  // Store prediction
  try {
    const prediction = insertPrediction({
      prediction_text: output.predictionText,
      confidence: output.confidence,
      model_used: output.modelUsed,
      sources: output.sources,
      expected_by: output.expectedBy,
      outcome: null,
      resolved_at: null,
      was_accurate: null
    })
    console.log(`[PREDICTOR] Prediction stored: ${prediction.id}`)
    console.log(`[PREDICTOR]   Text: ${output.predictionText.substring(0, 100)}...`)
    console.log(`[PREDICTOR]   Confidence: ${output.confidence}, Expected by: ${output.expectedBy}`)
  } catch (err) {
    console.error('[PREDICTOR] Failed to store prediction:', err)
  }

  return output
}

// ─── Timeframe calculation ─────────────────────────────────────────────────

function calculateExpectedBy(timeframe: string): Date {
  const now = new Date()
  const lower = timeframe.toLowerCase()

  // Try to parse common patterns
  const hourMatch = lower.match(/(\d+)(?:-(\d+))?\s*hour/)
  if (hourMatch) {
    const hours = parseInt(hourMatch[2] || hourMatch[1], 10)
    now.setHours(now.getHours() + hours)
    return now
  }

  const dayMatch = lower.match(/(\d+)(?:-(\d+))?\s*day/)
  if (dayMatch) {
    const days = parseInt(dayMatch[2] || dayMatch[1], 10)
    now.setDate(now.getDate() + days)
    return now
  }

  const weekMatch = lower.match(/(\d+)(?:-(\d+))?\s*week/)
  if (weekMatch) {
    const weeks = parseInt(weekMatch[2] || weekMatch[1], 10)
    now.setDate(now.getDate() + weeks * 7)
    return now
  }

  const monthMatch = lower.match(/(\d+)(?:-(\d+))?\s*month/)
  if (monthMatch) {
    const months = parseInt(monthMatch[2] || monthMatch[1], 10)
    now.setMonth(now.getMonth() + months)
    return now
  }

  // Default: 7 days
  now.setDate(now.getDate() + 7)
  return now
}

// ─── Batch prediction generation ───────────────────────────────────────────

/**
 * Generate predictions for all current active anomalies.
 * Called periodically by the scheduler.
 */
export async function generatePredictionsForActiveAnomalies(): Promise<number> {
  console.log('[PREDICTOR] Checking active anomalies for prediction opportunities...')
  let count = 0

  try {
    const db = getDatabase()
    const anomalies = db
      .prepare(
        `SELECT id, metric, region, baseline_value, observed_value, deviation_sigma
         FROM anomalies WHERE status = 'active'
         ORDER BY detected_at DESC`
      )
      .all() as Array<{
      id: string
      metric: string
      region: string
      baseline_value: number
      observed_value: number
      deviation_sigma: number
    }>

    for (const anomaly of anomalies) {
      const severity = Math.abs(anomaly.deviation_sigma) >= 3 ? 'CRITICAL' : Math.abs(anomaly.deviation_sigma) >= 2.5 ? 'HIGH' : 'MODERATE'
      const category = METRIC_TO_CATEGORY[anomaly.metric] || 'geopolitical_shift'
      const direction = anomaly.observed_value > anomaly.baseline_value ? '↑' : '↓'

      const input: PredictionInput = {
        triggerId: anomaly.id,
        metric: anomaly.metric,
        region: anomaly.region,
        severity,
        triggerDescription: `${anomaly.metric.replace(/_/g, ' ')} anomaly ${direction} in ${anomaly.region}: observed ${anomaly.observed_value} vs baseline ${anomaly.baseline_value} (${anomaly.deviation_sigma.toFixed(2)}σ deviation)`,
        category
      }

      try {
        const result = await generatePrediction(input)
        if (result) count++
      } catch (err) {
        console.error(`[PREDICTOR] Failed to generate prediction for anomaly ${anomaly.id}:`, err)
      }

      // Small delay between predictions to avoid overwhelming Ollama
      if (count > 0 && count % 3 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
  } catch (err) {
    console.error('[PREDICTOR] Batch prediction generation failed:', err)
  }

  console.log(`[PREDICTOR] Generated ${count} new predictions`)
  return count
}

// ─── Prediction review system ──────────────────────────────────────────────

/**
 * Review all unresolved predictions that have passed their expected_by date.
 * Marks them for human review (does NOT auto-resolve — that's a human decision).
 */
export function flagOverduePredictionsForReview(): number {
  const db = getDatabase()
  const overdue = db
    .prepare(
      `UPDATE predictions SET outcome = 'overdue_awaiting_review'
       WHERE resolved_at IS NULL
         AND expected_by IS NOT NULL
         AND expected_by < datetime('now')
         AND outcome IS NULL
       RETURNING id`
    )
    .all() as Array<{ id: string }>

  if (overdue.length > 0) {
    console.log(`[PREDICTOR] Flagged ${overdue.length} overdue predictions for review`)
  }
  return overdue.length
}

/**
 * Get all predictions awaiting human review (overdue or unresolved).
 */
export function getPredictionsForReview(): Array<{
  id: string
  prediction_text: string | null
  confidence: number | null
  model_used: string | null
  sources: string[]
  predicted_at: string
  expected_by: string | null
  outcome: string | null
}> {
  try {
    const predictions = getUnresolvedPredictions(50)
    return predictions.map((p) => ({
      ...p,
      sources: p.sources ?? []
    }))
  } catch {
    return []
  }
}

/**
 * Manually resolve a prediction with an accuracy assessment.
 */
export function reviewPrediction(id: string, outcome: string, wasAccurate: boolean): boolean {
  console.log(`[PREDICTOR] Reviewing prediction ${id}: outcome="${outcome}", accurate=${wasAccurate}`)
  return resolvePrediction(id, outcome, wasAccurate)
}

/**
 * Get prediction accuracy stats.
 */
export function getPredictionAccuracy(): {
  total: number
  resolved: number
  accurate: number
  inaccurate: number
  accuracyRate: number
} {
  const db = getDatabase()
  const total = (db.prepare('SELECT COUNT(*) as c FROM predictions').get() as { c: number }).c
  const resolved = (db.prepare("SELECT COUNT(*) as c FROM predictions WHERE resolved_at IS NOT NULL").get() as { c: number }).c
  const accurate = (db.prepare("SELECT COUNT(*) as c FROM predictions WHERE was_accurate = 1").get() as { c: number }).c
  const inaccurate = (db.prepare("SELECT COUNT(*) as c FROM predictions WHERE was_accurate = 0").get() as { c: number }).c

  return {
    total,
    resolved,
    accurate,
    inaccurate,
    accuracyRate: resolved > 0 ? accurate / resolved : 0
  }
}