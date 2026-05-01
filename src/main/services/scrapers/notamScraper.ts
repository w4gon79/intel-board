/**
 * NOTAM Scraper — Military/Defense NOTAMs as zone engine signals
 *
 * Polls FAA NOTAM Search API (free, no key) for military/defense NOTAMs.
 * Uses local LLM to classify messy NOTAM text into structured data.
 * Only stores military-relevant NOTAMs as signal sources for the zone engine.
 *
 * Polling: every 4 hours (NOTAM data doesn't change faster than that)
 * Scope: Military exercises, restricted airspace, missile firing, GPS outages, TFRs
 */

import { getDatabase } from '../storage/database'
import { chat } from '../rag/llm'

// ── Types ──────────────────────────────────────────────────

interface NotamRecord {
  id: string
  raw_text: string
  summary: string | null
  type: string | null
  lat: number | null
  lon: number | null
  altitude_floor_ft: number | null
  altitude_ceiling_ft: number | null
  effective_start: string | null
  effective_end: string | null
  location_designator: string | null
  icao_code: string | null
}

interface LLMClassifiedNotam {
  relevant: boolean
  type: string | null
  coordinates: [number, number] | null
  summary: string
}

// ── Query Regions ──────────────────────────────────────────
// Centers of the 8 chokepoint regions + active conflict zones

const QUERY_REGIONS: Array<{ name: string; lat: number; lon: number; radiusNm: number }> = [
  { name: 'Eastern Mediterranean', lat: 34.5, lon: 35.0, radiusNm: 200 },
  { name: 'Red Sea', lat: 14.5, lon: 42.0, radiusNm: 250 },
  { name: 'Persian Gulf', lat: 26.0, lon: 56.0, radiusNm: 200 },
  { name: 'Black Sea', lat: 44.0, lon: 34.0, radiusNm: 300 },
  { name: 'South China Sea', lat: 12.0, lon: 114.0, radiusNm: 400 },
  { name: 'Korean Peninsula', lat: 38.0, lon: 127.5, radiusNm: 250 },
  { name: 'Eastern Baltic', lat: 58.0, lon: 26.0, radiusNm: 200 },
  { name: 'CONUS East Coast', lat: 35.0, lon: -75.0, radiusNm: 300 },
  { name: 'CONUS West Coast', lat: 34.0, lon: -120.0, radiusNm: 300 },
  { name: 'Gulf of Mexico', lat: 27.0, lon: -90.0, radiusNm: 250 },
  { name: 'Alaska', lat: 64.0, lon: -153.0, radiusNm: 400 },
  { name: 'Hawaii', lat: 21.0, lon: -157.0, radiusNm: 200 },
]

// Major US military exercise area ICAO codes
const MILITARY_ICAO_CODES = [
  'WAL', // Warning Areas Atlantic
  'WAW', // Warning Areas Pacific
  'EGX', // UK Military
  'ETC', // US East Coast
  'ZLA', // LA Center (MOAs)
  'ZJX', // Jacksonville Center
  'ZNY', // New York Center
  'ZHU', // Houston Center
  'KGVX', // Guantanamo Bay
  'ORAA', // Al Asad Iraq
  'OAIX', // Ali Al Salem Kuwait
  'OTBH', // Al Udeid Qatar
]

// ── Keyword Pre-filter ─────────────────────────────────────

const MILITARY_KEYWORDS = [
  'military', 'missile', 'firing', 'artillery', 'bombing', 'exercise',
  'operations area', 'moa', 'restricted', 'hazard', 'gps outage',
  'navigation warning', 'rocket', 'space launch', 'uav', 'drone',
  'surveillance', 'temporary flight restriction', 'tfr', 'danger area',
  'weapon', 'test', 'range', 'combat', 'air defense', 'no-fly',
  'prohibited', 'national defense', 'security'
]

// ── Scheduler ──────────────────────────────────────────────

let notamTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start the NOTAM polling scheduler.
 */
export function startNotamScheduler(intervalMs: number = 4 * 60 * 60 * 1000): void {
  if (notamTimer) return

  console.log(`[NOTAM] Starting scheduler (${intervalMs / 1000 / 60} min interval)`)

  // First poll after 30 seconds (let other services initialize first)
  setTimeout(async () => {
    try {
      await pollNotams()
    } catch (err) {
      console.error('[NOTAM] Startup poll failed:', err instanceof Error ? err.message : String(err))
    }
  }, 30 * 1000)

  notamTimer = setInterval(async () => {
    try {
      await pollNotams()
    } catch (err) {
      console.error('[NOTAM] Scheduled poll failed:', err instanceof Error ? err.message : String(err))
    }
  }, intervalMs)
}

/**
 * Stop the NOTAM polling scheduler.
 */
export function stopNotamScheduler(): void {
  if (notamTimer) {
    clearInterval(notamTimer)
    notamTimer = null
  }
  console.log('[NOTAM] Scheduler stopped')
}

// ── Main Poll ──────────────────────────────────────────────

/**
 * Poll FAA NOTAM Search for military NOTAMs.
 * 1. Query by region + military ICAO codes
 * 2. Pre-filter by keywords
 * 3. Classify with LLM
 * 4. Store relevant NOTAMs
 */
export async function pollNotams(): Promise<{ fetched: number; classified: number; stored: number }> {
  const db = getDatabase()

  // Mark expired NOTAMs
  db.prepare(`
    UPDATE notams SET status = 'expired', updated_at = datetime('now')
    WHERE status = 'active' AND effective_end IS NOT NULL AND datetime(effective_end) < datetime('now')
  `).run()

  // Fetch NOTAMs from FAA for each region
  const allRawNotams: Array<{ id: string; text: string; icao: string }> = []

  for (const region of QUERY_REGIONS) {
    try {
      const notams = await fetchNotamsForRegion(region)
      allRawNotams.push(...notams)
    } catch {
      // Region fetch failed, continue with others
    }
  }

  // Also query by military ICAO codes
  for (const icao of MILITARY_ICAO_CODES) {
    try {
      const notams = await fetchNotamsByICAO(icao)
      allRawNotams.push(...notams)
    } catch {
      // ICAO fetch failed, continue
    }
  }

  // Deduplicate by NOTAM ID
  const seen = new Set<string>()
  const uniqueNotams = allRawNotams.filter(n => {
    if (seen.has(n.id)) return false
    seen.add(n.id)
    return true
  })

  // Pre-filter by military keywords
  const candidateNotams = uniqueNotams.filter(n =>
    MILITARY_KEYWORDS.some(kw => n.text.toLowerCase().includes(kw))
  )

  console.log(`[NOTAM] Fetched ${allRawNotams.length} NOTAMs, ${candidateNotams.length} candidates after keyword filter`)

  // Skip LLM classification if no candidates
  if (candidateNotams.length === 0) {
    return { fetched: allRawNotams.length, classified: 0, stored: 0 }
  }

  // Classify in batches of 5 to reduce LLM overhead
  let stored = 0
  const BATCH_SIZE = 5

  for (let i = 0; i < candidateNotams.length; i += BATCH_SIZE) {
    const batch = candidateNotams.slice(i, i + BATCH_SIZE)

    try {
      const classifications = await classifyNotamBatch(batch)

      for (let j = 0; j < batch.length; j++) {
        const notam = batch[j]
        const classification = classifications[j]

        if (!classification || !classification.relevant) continue

        // Store the classified NOTAM
        const insert = db.prepare(`
          INSERT OR IGNORE INTO notams (id, raw_text, summary, type, status, lat, lon,
            altitude_floor_ft, altitude_ceiling_ft, effective_start, effective_end,
            location_designator, icao_code, source, classified_by_llm, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, 'faa', 1, datetime('now'), datetime('now'))
        `)

        insert.run(
          notam.id,
          notam.text,
          classification.summary || null,
          classification.type || 'other_military',
          classification.coordinates ? classification.coordinates[0] : null,
          classification.coordinates ? classification.coordinates[1] : null,
          null, // altitude_floor_ft — parsed from text by LLM if provided
          null, // altitude_ceiling_ft
          null, // effective_start — would need text parsing
          null, // effective_end
          notam.icao || null,
          notam.icao || null
        )

        stored++
      }
    } catch (err) {
      console.error('[NOTAM] Batch classification failed:', err instanceof Error ? err.message : String(err))
      // Store unclassified military NOTAMs as fallback
      for (const notam of batch) {
        try {
          db.prepare(`
            INSERT OR IGNORE INTO notams (id, raw_text, summary, type, status,
              location_designator, icao_code, source, created_at, updated_at)
            VALUES (?, ?, null, 'other_military', 'active', ?, ?, 'faa', datetime('now'), datetime('now'))
          `).run(notam.id, notam.text.slice(0, 2000), notam.icao, notam.icao)
          stored++
        } catch {
          // Skip this NOTAM
        }
      }
    }
  }

  console.log(`[NOTAM] Stored ${stored} military NOTAMs`)
  return { fetched: allRawNotams.length, classified: candidateNotams.length, stored }
}

// ── FAA API Fetch ──────────────────────────────────────────

interface FaaNotamResponse {
  notamList?: Array<{
    icaoMessage: string
    notamId: string
    latlon?: string
    featureName?: string
  }>
}

/**
 * Fetch NOTAMs for a geographic region from FAA.
 */
async function fetchNotamsForRegion(
  region: { name: string; lat: number; lon: number; radiusNm: number }
): Promise<Array<{ id: string; text: string; icao: string }>> {
  // Convert radius from nautical miles to KM for the API
  const radiusKm = region.radiusNm * 1.852

  const body = new URLSearchParams({
    searchType: '2', // Search by radius
    lat: region.lat.toString(),
    lng: region.lon.toString(),
    radius: radiusKm.toString(),
    notamType: 'N',
    formatType: 'DOMESTIC',
  })

  try {
    const response = await fetch('https://notams.aim.faa.gov/notamSearch/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) return []

    const data = await response.json() as FaaNotamResponse
    const notams = data.notamList || []

    return notams.map(n => ({
      id: n.notamId || `notam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: n.icaoMessage || '',
      icao: n.featureName || '',
    })).filter(n => n.text.length > 0)
  } catch {
    return []
  }
}

/**
 * Fetch NOTAMs for a specific ICAO code from FAA.
 */
async function fetchNotamsByICAO(icao: string): Promise<Array<{ id: string; text: string; icao: string }>> {
  const body = new URLSearchParams({
    searchType: '0', // Search by location
    designatorsForLocationIdentifier: icao,
    notamType: 'N',
    formatType: 'DOMESTIC',
  })

  try {
    const response = await fetch('https://notams.aim.faa.gov/notamSearch/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) return []

    const data = await response.json() as FaaNotamResponse
    const notams = data.notamList || []

    return notams.map(n => ({
      id: n.notamId || `notam-${icao}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: n.icaoMessage || '',
      icao: n.featureName || icao,
    })).filter(n => n.text.length > 0)
  } catch {
    return []
  }
}

// ── LLM Classification ─────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are classifying FAA NOTAMs for military intelligence relevance.

Given these NOTAMs, classify each one. Respond with a JSON array.

For each NOTAM:
- "relevant": true if it relates to military operations, defense activity, security restrictions, missile/rocket activity, GPS denial, or restricted airspace for military purposes
- "relevant": false if it's about runway closures, construction, lighting, birds, standard airport ops, or crane operations
- "type": one of: "restricted", "military_exercise", "missile_fire", "tfr_security", "gps_outage", "space_launch", "other_military", or null if not relevant
- "coordinates": [lat, lon] if extractable from text, null otherwise
- "summary": one-sentence plain English summary

NOTAMs:
{{notams_json}}

Respond with ONLY the JSON array, no other text.`

/**
 * Classify a batch of NOTAMs using the local LLM.
 */
async function classifyNotamBatch(
  notams: Array<{ id: string; text: string; icao: string }>
): Promise<(LLMClassifiedNotam | null)[]> {
  const notamsForPrompt = notams.map(n => ({
    id: n.id,
    text: n.text.slice(0, 500), // Truncate long NOTAM text
    icao: n.icao
  }))

  const prompt = CLASSIFICATION_PROMPT.replace('{{notams_json}}', JSON.stringify(notamsForPrompt, null, 2))

  const result = await chat(
    [{ role: 'user', content: prompt }],
    { temperature: 0.1 }
  )

  if (!result.text || result.text.trim().length === 0) {
    return notams.map(() => null)
  }

  // Strip markdown code fences
  let raw = result.text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  try {
    const parsed = JSON.parse(raw) as LLMClassifiedNotam[]
    return parsed
  } catch {
    console.warn('[NOTAM] LLM classification parse failed, raw output:', raw.slice(0, 200))
    return notams.map(() => null)
  }
}

// ── Query Helpers ──────────────────────────────────────────

/**
 * Get active NOTAMs (not expired).
 */
export function getActiveNotams(limit: number = 100): NotamRecord[] {
  const db = getDatabase()
  try {
    return db.prepare(`
      SELECT id, raw_text, summary, type, lat, lon,
             altitude_floor_ft, altitude_ceiling_ft,
             effective_start, effective_end, location_designator, icao_code
      FROM notams
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as NotamRecord[]
  } catch {
    return []
  }
}

/**
 * Get NOTAMs within a conflict zone's radius.
 */
export function getNotamsByZone(zoneLat: number, zoneLon: number, radiusNm: number): NotamRecord[] {
  const db = getDatabase()
  try {
    // Simple bounding box approximation: 1 degree ≈ 60nm
    const latDeg = radiusNm / 60
    const lonDeg = radiusNm / (60 * Math.cos(zoneLat * Math.PI / 180))

    return db.prepare(`
      SELECT id, raw_text, summary, type, lat, lon,
             altitude_floor_ft, altitude_ceiling_ft,
             effective_start, effective_end, location_designator, icao_code
      FROM notams
      WHERE status = 'active'
        AND lat IS NOT NULL AND lon IS NOT NULL
        AND lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
      ORDER BY created_at DESC
    `).all(
      zoneLat - latDeg, zoneLat + latDeg,
      zoneLon - lonDeg, zoneLon + lonDeg
    ) as NotamRecord[]
  } catch {
    return []
  }
}

/**
 * Get NOTAM status for diagnostics.
 */
export function getNotamStatus(): {
  active: number
  expired: number
  lastPoll: string | null
} {
  const db = getDatabase()
  try {
    const active = db.prepare("SELECT COUNT(*) as cnt FROM notams WHERE status = 'active'").get() as { cnt: number }
    const expired = db.prepare("SELECT COUNT(*) as cnt FROM notams WHERE status = 'expired'").get() as { cnt: number }
    const latest = db.prepare("SELECT MAX(created_at) as ts FROM notams").get() as { ts: string | null }

    return { active: active.cnt, expired: expired.cnt, lastPoll: latest.ts }
  } catch {
    return { active: 0, expired: 0, lastPoll: null }
  }
}

/**
 * Get active NOTAM count for sensemaking context.
 */
export function getNotamContextString(): string {
  const db = getDatabase()
  try {
    const active = db.prepare(`
      SELECT type, COUNT(*) as cnt FROM notams
      WHERE status = 'active'
      GROUP BY type
      ORDER BY cnt DESC
    `).all() as Array<{ type: string; cnt: number }>

    if (active.length === 0) return 'No active military NOTAMs.'

    const total = active.reduce((sum, a) => sum + a.cnt, 0)
    const breakdown = active.map(a => `${a.type}: ${a.cnt}`).join(', ')
    return `${total} active military NOTAMs (${breakdown})`
  } catch {
    return 'NOTAM data unavailable.'
  }
}