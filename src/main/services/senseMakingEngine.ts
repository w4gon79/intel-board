/**
 * AI Sense-Making Engine (Phase 4E)
 *
 * Runs periodically (every 30 minutes) and generates AI-analyzed intel items
 * from the fusion of tactical events, CSG positions, and recent news.
 */

import { getDatabase } from './storage/database'
import { insertIntelItem } from './storage/dbService'
import { getCSGContextString } from './csg/csgService'
import { withWorldContext } from '../utils/worldContext'
import { CHOKE_POINTS } from './ais/aisService'
import { getEconomicContextString } from './economicService'

// ── Sense-Making Failure Backoff ───────────────────────────

let consecutiveSenseFailures = 0
const MAX_SENSE_FAILURES = 3
let senseBackoffUntil = 0

// ── Expected Transit Traffic Constants ─────────────────────
// Ballpark real-world daily transit counts for major choke points.
// Used for cross-validation when baseline_stats are missing, zero, or unreliable.

const EXPECTED_TRANSIT_TRAFFIC: Record<string, { min: number; max: number; typical: number }> = {
  'Strait of Hormuz': { min: 25, max: 55, typical: 40 },
  'Strait of Malacca': { min: 35, max: 65, typical: 50 },
  'Suez Canal': { min: 15, max: 45, typical: 30 },
  'Bab el-Mandeb': { min: 15, max: 40, typical: 28 },
  'Panama Canal': { min: 8, max: 25, typical: 15 },
  'Gibraltar': { min: 12, max: 35, typical: 22 },
  'Bosphorus': { min: 8, max: 22, typical: 14 },
  'Taiwan Strait': { min: 12, max: 35, typical: 22 },
}

// ── Types ──────────────────────────────────────────────────

interface SenseMakingResult {
  title: string
  summary: string
  analysis: string
  region: string
  severity: 'low' | 'moderate' | 'high' | 'critical'
  relatedEventIds: number[]
  relatedGroupIds: string[]
}

interface SenseMakingResponse {
  analyses: SenseMakingResult[]
}

// ── Public API ─────────────────────────────────────────────

/**
 * Run a sense-making cycle: gather data, call LLM, store results.
 */
export async function runSenseMaking(): Promise<void> {
  // Backoff guard: skip if too many consecutive failures
  if (Date.now() < senseBackoffUntil) {
    console.log('[SenseMaking] Skipping — in failure backoff')
    return
  }

  const db = getDatabase()

  // 1. Gather recent tactical events (last 4 hours)
  const events = db.prepare(`
    SELECT * FROM tactical_events
    WHERE status = 'active'
      AND datetime(detected_at) > datetime('now', '-4 hours')
    ORDER BY detected_at DESC
  `).all() as Array<Record<string, unknown>>

  // 2. Get CSG context
  const csgContext = getCSGContextString()

  // 3. Get recent intel items (last 2 hours)
  const recentIntel = db.prepare(`
    SELECT title, summary, region, categories FROM intel_items
    WHERE datetime(created_at) > datetime('now', '-2 hours')
    ORDER BY created_at DESC
    LIMIT 20
  `).all() as Array<Record<string, unknown>>

  // 4. Get recent articles (last 6 hours) — expanded for Phase 4G multi-source pipeline
  const recentArticles = db.prepare(`
    SELECT title, content, source FROM articles
    WHERE published_at > datetime('now', '-6 hours')
    ORDER BY published_at DESC
    LIMIT 30
  `).all() as Array<Record<string, unknown>>

  // 5. Get choke point traffic status
  const chokePointContext = getChokePointTrafficContext()

  // 6. Get social media activity
  let socialContext = ''
  try {
    const socialRow = db.prepare(
      "SELECT COUNT(*) as count FROM social_posts WHERE posted_at > datetime('now', '-2 hours')"
    ).get() as { count: number } | undefined
    const socialCount = socialRow?.count ?? 0
    if (socialCount > 0) {
      const socialPosts = db.prepare(
        "SELECT source, source_detail, title, body, score FROM social_posts WHERE posted_at > datetime('now', '-2 hours') ORDER BY score DESC LIMIT 10"
      ).all() as Array<{ source: string; source_detail: string; title: string | null; body: string; score: number }>
      const postSummaries = socialPosts.map(p => {
        const label = p.source === 'reddit' ? `r/${p.source_detail}` : p.source
        const text = (p.title || p.body).slice(0, 100)
        return `  [${label}] ${text} (score: ${p.score})`
      }).join('\n')
      socialContext = `${socialCount} relevant posts in the last 2 hours:\n${postSummaries}`
    }
  } catch { /* social_posts table may not exist yet */ }

  // Skip if nothing new
  if (events.length === 0 && recentIntel.length === 0 && recentArticles.length === 0) {
    console.log('[SenseMaking] No new data to analyze')
    return
  }

  // 7. Get economic indicator context
  let economicContext = ''
  try {
    economicContext = getEconomicContextString()
  } catch { /* economic data may not be available yet */ }

  // 8. Build prompt
  const prompt = buildAnalysisPrompt(events, csgContext, recentIntel, recentArticles, chokePointContext, socialContext, economicContext)

  // 8. Call LLM
  try {
    const result = await callLLMForAnalysis(withWorldContext(prompt))

    // 9. Store results
    for (const analysis of result.analyses) {
      storeAnalysisResult(analysis)
    }
    console.log(`[SenseMaking] Generated ${result.analyses.length} analyses`)
    consecutiveSenseFailures = 0
  } catch (err) {
    console.error('[SenseMaking] Analysis failed:', err instanceof Error ? err.message : String(err))
    consecutiveSenseFailures++
    if (consecutiveSenseFailures >= MAX_SENSE_FAILURES) {
      senseBackoffUntil = Date.now() + 30 * 60 * 1000
      console.warn(`[SenseMaking] ${MAX_SENSE_FAILURES} consecutive failures. Backing off for 30 min.`)
    }
  }
}

/**
 * Build a human-readable string of recent tactical events for AI context.
 */
export function getTacticalEventsContext(): string {
  const db = getDatabase()
  const events = db.prepare(`
    SELECT event_type, description, region, severity FROM tactical_events
    WHERE status = 'active'
      AND datetime(detected_at) > datetime('now', '-4 hours')
    ORDER BY detected_at DESC
    LIMIT 10
  `).all() as Array<Record<string, unknown>>

  if (events.length === 0) return 'No recent tactical events.'
  return events
    .map(e => `- [${e.event_type}] ${e.description} (${e.region}, severity: ${e.severity})`)
    .join('\n')
}

/**
 * Get status of the sense-making engine (count of recent analyses).
 */
export function getSenseMakingStatus(): { analysesLast24h: number } {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM intel_items
    WHERE categories LIKE '%ai-sensemaking%'
    AND datetime(created_at) > datetime('now', '-24 hours')
  `).get() as { count: number } | undefined
  return { analysesLast24h: row?.count ?? 0 }
}

// ── Internal Helpers ───────────────────────────────────────

export function getChokePointTrafficContext(): string {
  const db = getDatabase()
  const lines: string[] = []

  for (const cp of CHOKE_POINTS) {
    // AIS live count (full choke point area)
    const aisRow = db.prepare(
      `SELECT value FROM metric_snapshots WHERE metric='ship_traffic_chokepoint' AND region=? ORDER BY timestamp DESC LIMIT 1`
    ).get(cp.name) as { value: number } | undefined

    // Transit corridor count
    const corridorRow = db.prepare(
      `SELECT value FROM metric_snapshots WHERE metric='transit_corridor_traffic' AND region=? ORDER BY timestamp DESC LIMIT 1`
    ).get(cp.name) as { value: number } | undefined

    // GFW presence count (filtered to transit corridor for accurate shipping lane count)
    const corridor = cp.transitCorridor
    let gfwRow: { total: number | null } | undefined
    if (corridor) {
      gfwRow = db.prepare(
        `SELECT SUM(vessel_count) as total FROM gfw_presence WHERE chokepoint=? AND dataset='presence' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
      ).get(cp.name, corridor.minLat, corridor.maxLat, corridor.minLon, corridor.maxLon) as { total: number | null } | undefined
    } else {
      gfwRow = db.prepare(
        `SELECT SUM(vessel_count) as total FROM gfw_presence WHERE chokepoint=? AND dataset='presence'`
      ).get(cp.name) as { total: number | null } | undefined
    }

    // Baselines
    const corridorBaseline = db.prepare(
      `SELECT mean, stddev FROM baseline_stats WHERE metric='transit_corridor_traffic' AND region=?`
    ).get(cp.name) as { mean: number; stddev: number } | undefined

    const aisBaseline = db.prepare(
      `SELECT mean, stddev FROM baseline_stats WHERE metric='ship_traffic_chokepoint' AND region=?`
    ).get(cp.name) as { mean: number; stddev: number } | undefined

    const aisCount = aisRow?.value ?? 0
    const corridorCount = corridorRow?.value ?? 0
    const gfwCount = gfwRow?.total ?? 0
    const corridorMean = corridorBaseline?.mean ?? 0
    const aisMean = aisBaseline?.mean ?? 0

    // ── Cross-chokepoint fleet health validation ──────────────
    // Compute "fleet average" excluding the current choke point.
    // If all other choke points are healthy but this one is near-zero, the anomaly is real.
    let fleetTotalExpected = 0
    let fleetTotalActual = 0

    for (const other of CHOKE_POINTS) {
      if (other.name === cp.name) continue
      const otherExpected = EXPECTED_TRANSIT_TRAFFIC[other.name]?.typical ?? 0
      if (otherExpected === 0) continue

      const otherCorridorRow = db.prepare(
        `SELECT value FROM metric_snapshots WHERE metric='transit_corridor_traffic' AND region=? ORDER BY timestamp DESC LIMIT 1`
      ).get(other.name) as { value: number } | undefined
      const otherCount = otherCorridorRow?.value ?? 0

      fleetTotalExpected += otherExpected
      fleetTotalActual += Math.min(otherCount, otherExpected * 1.5) // cap outliers
    }

    const fleetHealthRatio = fleetTotalExpected > 0 ? fleetTotalActual / fleetTotalExpected : 0.5

    // ── Determine transit status with expected-traffic + fleet cross-validation ──
    let transitStatus = 'OPEN'
    let statusConfidence = 'HIGH'

    const expected = EXPECTED_TRANSIT_TRAFFIC[cp.name]

    // Check if AIS and GFW disagree significantly (used for secondary validation below)
    const aisGfwDiscrepancy = corridorCount === 0 && gfwCount > 5
    const aisLowButGfwPresent = corridorCount > 0 && corridorCount < corridorMean * 0.3 && gfwCount > corridorMean * 0.5

    if (expected && expected.typical > 10) {
      // Major choke point with known traffic patterns — use expected traffic band
      const actualToExpected = (corridorCount + gfwCount) > 0
        ? Math.max(corridorCount, gfwCount) / expected.typical
        : 0

      if (actualToExpected < 0.05 && fleetHealthRatio > 0.4) {
        // Near-zero traffic at a major choke point while rest of fleet is healthy = BLOCKED
        transitStatus = 'BLOCKED'
        statusConfidence = `HIGH (expected ~${expected.typical} vessels, seeing ${Math.max(corridorCount, gfwCount)}; fleet health ${(fleetHealthRatio * 100).toFixed(0)}%)`
      } else if (actualToExpected < 0.15 && fleetHealthRatio > 0.4) {
        transitStatus = 'SEVERELY DISRUPTED'
        statusConfidence = `HIGH (expected ~${expected.typical}, seeing ${Math.max(corridorCount, gfwCount)}; fleet healthy elsewhere)`
      } else if (actualToExpected < 0.7) {
        transitStatus = 'REDUCED TRANSIT'
        statusConfidence = `MEDIUM (at ${(actualToExpected * 100).toFixed(0)}% of expected ~${expected.typical}/day)`
      } else if (actualToExpected < 0.05 && fleetHealthRatio <= 0.4) {
        // Near-zero here but fleet is also disrupted — probably a system/data issue
        transitStatus = 'NO TRAFFIC DETECTED'
        statusConfidence = `LOW (multiple choke points show low traffic — possible data gap; fleet health ${(fleetHealthRatio * 100).toFixed(0)}%)`
      }
      // If actualToExpected >= 0.7, status stays OPEN with HIGH confidence
    } else {
      // No expected traffic data — fall back to baseline-only logic
      if (corridorMean > 2 && corridorCount === 0 && gfwCount === 0) {
        transitStatus = 'BLOCKED'
        statusConfidence = 'HIGH (confirmed by both AIS and GFW)'
      } else if (corridorMean > 2 && corridorCount < corridorMean * 0.3 && gfwCount < corridorMean * 0.3) {
        transitStatus = 'SEVERELY DISRUPTED'
        statusConfidence = 'HIGH (confirmed by both AIS and GFW)'
      } else if (corridorMean > 2 && corridorCount < corridorMean * 0.6 && gfwCount < corridorMean * 0.6) {
        transitStatus = 'REDUCED TRANSIT'
        statusConfidence = 'MEDIUM'
      } else if (corridorCount === 0 && gfwCount === 0) {
        transitStatus = 'NO TRAFFIC DETECTED'
        statusConfidence = 'LOW (may be data gap)'
      }
    }

    // AIS/GFW cross-validation overrides (secondary signal when status is still OPEN)
    if (transitStatus === 'OPEN' && aisLowButGfwPresent) {
      transitStatus = 'OPEN'
      statusConfidence = 'MEDIUM (AIS/GFW discrepancy — AIS shows low transit but GFW confirms vessel presence)'
    } else if (transitStatus === 'OPEN' && aisGfwDiscrepancy) {
      transitStatus = `OPEN (GFW: ${gfwCount} vessels in corridor)`
      statusConfidence = 'MEDIUM (AIS gap — relying on GFW satellite data)'
    }

    // ── Detect "ships waiting but not transiting" pattern ────
    // Enhanced: uses expected traffic when baseline is missing/low
    const hasSignificantBaseline = corridorMean > 2 || (expected != null && expected.typical > 10)
    let patternNote = ''
    if (aisCount > 10 && corridorCount === 0 && hasSignificantBaseline && gfwCount < 3) {
      patternNote = ' ⚠️ VESSELS PRESENT IN APPROACHES BUT ZERO TRANSITING - INDICATES BLOCKADE'
    } else if (aisCount > 5 && corridorCount < 3 && hasSignificantBaseline && gfwCount < Math.max(corridorMean * 0.3, 3)) {
      patternNote = ' ⚠️ VESSELS ACCUMULATING BUT TRANSIT CORRIDOR NEAR EMPTY'
    } else if (corridorMean > 0 && corridorCount < corridorMean * 0.3 && gfwCount > corridorMean * 0.5) {
      patternNote = ' ℹ️ AIS shows reduced transit but GFW confirms normal vessel presence — likely AIS coverage gap, not actual disruption'
    }

    // ── GFW override: if satellite data confirms vessel presence, override BLOCKED/SEVERELY DISRUPTED ──
    if ((transitStatus === 'BLOCKED' || transitStatus === 'SEVERELY DISRUPTED') && gfwCount >= (expected?.typical ?? corridorMean) * 0.3) {
      // GFW satellite confirms vessels are actually transiting
      transitStatus = 'OPEN (GFW confirmed)'
      statusConfidence = `HIGH (GFW satellite confirms ${gfwCount} vessels in transit corridor despite low AIS coverage)`
      patternNote = ' ℹ️ AIS shows near-zero but GFW satellite data confirms active vessel transit — AIS coverage gap, NOT a disruption'
    }

    const expectedNote = expected
      ? ` [expected ~${expected.typical}/day, fleet health ${(fleetHealthRatio * 100).toFixed(0)}%]`
      : ''
    const dataSource = gfwCount > 0
      ? `GFW=${gfwCount} vessels (PRIMARY), AIS transit=${corridorCount}`
      : `AIS transit=${corridorCount} (no GFW data)`
    lines.push(
      `  ${cp.name}: ${dataSource}, Area=${aisCount} AIS (baseline: ${aisMean.toFixed(0)}, transit baseline: ${corridorMean.toFixed(0)}), Status: ${transitStatus}, Confidence: ${statusConfidence}${expectedNote}${patternNote}`
    )
  }

  return lines.join('\n')
}

function buildAnalysisPrompt(
  events: Array<Record<string, unknown>>,
  csgContext: string,
  intel: Array<Record<string, unknown>>,
  articles: Array<Record<string, unknown>>,
  chokePointContext: string,
  socialContext: string,
  economicContext: string
): string {
  const eventStr = events.length > 0
    ? events.map(e => `  [${e.event_type}] ${e.description} (${e.region}, severity: ${e.severity})`).join('\n')
    : '  No recent tactical events'

  const intelStr = intel.length > 0
    ? intel.map(i => `  [${i.categories ?? 'intel'}] ${i.title}`).join('\n')
    : '  No recent intel items'

  const articleStr = articles.length > 0
    ? articles.map(a => `  [${a.source}] ${a.title}${a.content ? ': ' + String(a.content).slice(0, 200) : ''}`).join('\n')
    : '  No recent articles'

  const socialStr = socialContext || '  No recent social media activity'

  return `You are a geopolitical intelligence analyst. Analyze the following data and identify significant patterns, escalations, or developments that warrant attention.

CURRENT FLEET POSTURE:
${csgContext}

CHOKE POINT TRAFFIC STATUS:
${chokePointContext}

RECENT TACTICAL EVENTS (LAST 4 HOURS):
${eventStr}

RECENT INTEL ITEMS (LAST 2 HOURS):
${intelStr}

RECENT NEWS (LAST 6 HOURS):
${articleStr}

SOCIAL MEDIA SIGNALS (LAST 2 HOURS — UNVERIFIED, USE AS EARLY INDICATORS ONLY):
${socialStr}

ECONOMIC INDICATORS (ANOMALY-HIGHLIGHTED):
${economicContext || 'No economic data available.'}

TASK:
Identify 0-3 significant geopolitical developments based on the data above. For each:
1. Synthesize information across sources (events + fleet posture + choke point traffic + news + social media signals)
2. Assess severity: low (routine), moderate (notable), high (escalation), critical (imminent)
3. Identify which events and carrier groups are relevant
4. Provide a 2-3 sentence analytical assessment

Pay special attention to:
TRANSIT CORRIDOR STATUS: If a choke point shows "BLOCKED" or "SEVERELY DISRUPTED" status, this is a CRITICAL finding indicating potential blockade, mine-laying, or geopolitical closure.
VESSELS WAITING PATTERN: If many vessels are in the choke point approach area but the transit corridor is empty, ships are waiting/anchored, NOT transiting. Strong signal of a blockade.
A strait is NOT "open" just because vessels are nearby. It is open ONLY when vessels are actively moving through the shipping lane (transit corridor traffic > 0).
AIRCRAFT NATIONALITY: KC-135, KC-46, KC-10, KC-767, A330 MRTT (Phenix), and similar tanker aircraft are NATO/Western allied assets. Only Il-78 Midas, YY-20, and similar adversary_type aircraft represent adversary operations. Do NOT conflate allied tanker operations with Russian or Chinese military activity.
AIRCRAFT EVENTS specify whether detected aircraft are allied or adversary in their descriptions. Read the event descriptions carefully before attributing aircraft to any nation.
Sudden changes in traffic patterns at strategic choke points (Hormuz, Malacca, Suez, Bab el-Mandeb).
Correlation between reduced choke point transit and nearby military activity or CSG movements.
TRAFFIC ANOMALY DETECTION: Choke point status now uses cross-validation against expected traffic levels AND the health of other choke points. If Hormuz shows BLOCKED while Malacca and Suez are normal, this is a confirmed disruption, NOT a data gap.
EXPECTED vs ACTUAL: Each choke point has known typical traffic levels. A value of 0-2 at Hormuz (expected ~40) is treated the same as BLOCKED, regardless of baseline stats.
FLEET HEALTH: If 7 of 8 monitored choke points show normal traffic but one shows near-zero, the anomaly is real. Do not dismiss it as a data gap.
GFW SATELLITE DATA TAKES PRIORITY OVER AIS: GFW combines terrestrial AND satellite AIS, making it far more accurate than live AIS alone. If GFW shows vessels in the transit corridor, the choke point is OPEN regardless of what live AIS reports. AIS coverage gaps at choke points (Hormuz, Malacca, Panama) routinely show zero vessels when GFW confirms active transit. NEVER declare a blockade or disruption when GFW satellite data confirms vessel presence.
AIS vs GFW: Live AIS = terrestrial receivers only (frequent gaps at choke points). GFW = satellite + terrestrial combined (much more accurate). When they conflict, trust GFW.
STATUS OVERRIDES: If a choke point status says "OPEN (GFW confirmed)", this is definitive. Do not second-guess it based on low AIS counts.
STATUS CONFIDENCE: Each choke point status includes a confidence level. HIGH confidence disruptions should be treated as confirmed. MEDIUM confidence may indicate data gaps. LOW confidence suggests system-wide data issues and should not be treated as disruptions.
NORTH ATLANTIC AIRLIFT: Transport aircraft (C-17, C-130, C-5) transiting the North Atlantic are logistics flights to Europe, NOT Arctic operations. Only classify operations as "Arctic" if aircraft are confirmed above 70 degrees North latitude. Large-scale transatlantic airlift is significant as it indicates major deployment to Europe or onward to the Middle East.

Only report genuinely significant developments. Skip routine activity (normal patrols, training flights, standard port calls).

Respond in JSON format:
{
  "analyses": [
    {
      "title": "Brief title",
      "summary": "1-2 sentence factual summary",
      "analysis": "2-3 sentence analytical assessment explaining significance",
      "region": "affected region",
      "severity": "low|moderate|high|critical",
      "relatedEventIds": [],
      "relatedGroupIds": []
    }
  ]
}

If nothing significant is happening, return: {"analyses": []}`
}

async function callLLMForAnalysis(prompt: string): Promise<SenseMakingResponse> {
  // Route through the LLM chat service to use cloud when configured
  const { chat } = await import('./rag/llm')

  const result = await chat(
    [{ role: 'user', content: prompt }],
    { temperature: 0.2 }
  )

  if (!result.text || result.text.trim().length === 0) {
    throw new Error('[SenseMaking] LLM returned empty response')
  }

  // Strip markdown code fences that some LLMs wrap around JSON
  let raw = result.text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  const parsed = JSON.parse(raw) as SenseMakingResponse
  return parsed
}

function storeAnalysisResult(analysis: SenseMakingResult): void {
  const db = getDatabase()

  // Check for similar existing analyses (title word overlap > 60%)
  const existingTitles = db.prepare(`
    SELECT title FROM intel_items
    WHERE categories LIKE '%ai-sensemaking%'
    AND datetime(created_at) > datetime('now', '-4 hours')
  `).all() as Array<{ title: string }>

  const newWords = new Set(
    analysis.title
      .toLowerCase()
      .replace(/\[ai analysis\]\s*/i, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
  )

  for (const { title } of existingTitles) {
    const existingWords = new Set(
      title
        .toLowerCase()
        .replace(/\[ai analysis\]\s*/i, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
    )

    // Calculate Jaccard similarity
    const intersection = [...newWords].filter(w => existingWords.has(w)).length
    const union = new Set([...newWords, ...existingWords]).size
    const similarity = union > 0 ? intersection / union : 0

    if (similarity > 0.6) {
      console.log(`[SenseMaking] Skipping duplicate: "${analysis.title}" is similar to "${title}" (${(similarity * 100).toFixed(0)}%)`)
      return
    }
  }

  // No similar existing analysis, insert
  const tier = severityToTier(analysis.severity)

  insertIntelItem({
    tier,
    title: `[AI Analysis] ${analysis.title}`,
    summary: `${analysis.summary}\n\nAssessment: ${analysis.analysis}\nSeverity: ${analysis.severity}`,
    analysis: analysis.analysis,
    confidence: severityToConfidence(analysis.severity),
    sources: ['ai-sensemaking'],
    region: analysis.region,
    categories: ['ai-sensemaking', 'analysis', analysis.severity],
    updated_at: null,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    latitude: null,
    longitude: null
  })

  console.log(`[SenseMaking] Stored: ${analysis.title} (${analysis.severity})`)
}

function severityToTier(severity: string): 'ALERT' | 'WATCH' | 'CONTEXT' {
  switch (severity) {
    case 'critical':
    case 'high':
      return severity === 'critical' ? 'ALERT' : 'WATCH'
    case 'moderate':
      return 'WATCH'
    default:
      return 'CONTEXT'
  }
}

function severityToConfidence(severity: string): number {
  switch (severity) {
    case 'critical': return 0.9
    case 'high': return 0.8
    case 'moderate': return 0.65
    default: return 0.5
  }
}

// ── Scheduler ──────────────────────────────────────────────

let senseMakingTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start the sense-making scheduler (every 30 minutes, first run after 2 min delay).
 */
export function startSenseMakingScheduler(): void {
  if (senseMakingTimer) return

  console.log('[SenseMaking] Starting scheduler (30 min interval)')

  // First run after 2-minute delay (let data populate first)
  setTimeout(async () => {
    try {
      await runSenseMaking()
    } catch (err) {
      console.error('[SenseMaking] Startup run failed:', err instanceof Error ? err.message : String(err))
    }
  }, 2 * 60 * 1000)

  // Subsequent runs every 30 minutes
  senseMakingTimer = setInterval(async () => {
    try {
      await runSenseMaking()
    } catch (err) {
      console.error('[SenseMaking] Scheduled run failed:', err instanceof Error ? err.message : String(err))
    }
  }, 30 * 60 * 1000)
}

/**
 * Stop the sense-making scheduler.
 */
export function stopSenseMakingScheduler(): void {
  if (senseMakingTimer) {
    clearInterval(senseMakingTimer)
    senseMakingTimer = null
  }
  console.log('[SenseMaking] Scheduler stopped')
}