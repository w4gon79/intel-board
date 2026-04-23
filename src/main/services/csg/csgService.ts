/**
 * CSG Service — Database CRUD and GeoJSON generation for Carrier Strike Groups.
 *
 * Provides query methods used by IPC handlers and the scheduler.
 */

import { getDatabase } from '../storage/database'
import { scrapeUsniFleetTracker, storeSeedData } from './usniScraper'
import { scrapeTwzCarrierTracker } from './twzScraper'
import { runAisMatcher } from './aisMatcher'
import { evaluateRules } from '../alerts/ruleEngine'
import type {
  CarrierGroup,
  CarrierGroupVessel,
  CarrierGroupWithVessels
} from '../../../shared/types'

// ── Query helpers ────────────────────────────────────────────

type DbRow = Record<string, unknown>

function hydrateGroup(row: DbRow): CarrierGroup {
  return {
    id: row.id as string,
    name: row.name as string,
    designation: (row.designation as string) ?? null,
    flagship: (row.flagship as string) ?? null,
    status: (row.status as CarrierGroup['status']) ?? 'unknown',
    operating_area: (row.operating_area as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    source: (row.source as CarrierGroup['source']) ?? 'usni',
    last_updated: (row.last_updated as string) ?? null,
    created_at: (row.created_at as string) ?? new Date().toISOString()
  }
}

function hydrateVessel(row: DbRow): CarrierGroupVessel {
  return {
    id: row.id as string,
    group_id: row.group_id as string,
    vessel_name: (row.vessel_name as string) ?? null,
    vessel_type: (row.vessel_type as string) ?? null,
    hull_number: (row.hull_number as string) ?? null,
    mmsi: (row.mmsi as string) ?? null,
    imo: (row.imo as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    heading: (row.heading as number) ?? null,
    speed: (row.speed as number) ?? null,
    last_seen: (row.last_seen as string) ?? null
  }
}

// ── Public API ───────────────────────────────────────────────

/** Get all carrier groups with their vessels */
export function getCarrierGroups(): CarrierGroupWithVessels[] {
  const db = getDatabase()

  const groups = db.prepare('SELECT * FROM carrier_groups ORDER BY name').all() as DbRow[]
  const vessels = db.prepare('SELECT * FROM carrier_group_vessels ORDER BY vessel_type, hull_number').all() as DbRow[]

  const vesselMap = new Map<string, CarrierGroupVessel[]>()
  for (const v of vessels) {
    const hydrated = hydrateVessel(v)
    const existing = vesselMap.get(hydrated.group_id) ?? []
    existing.push(hydrated)
    vesselMap.set(hydrated.group_id, existing)
  }

  return groups.map(g => {
    const group = hydrateGroup(g)
    return {
      ...group,
      vessels: vesselMap.get(group.id) ?? []
    }
  })
}

/** Get a single carrier group by ID with vessel details */
export function getCarrierGroupById(id: string): CarrierGroupWithVessels | null {
  const db = getDatabase()

  const groupRow = db.prepare('SELECT * FROM carrier_groups WHERE id = ?').get(id) as DbRow | undefined
  if (!groupRow) return null

  const group = hydrateGroup(groupRow)
  const vesselRows = db.prepare('SELECT * FROM carrier_group_vessels WHERE group_id = ? ORDER BY vessel_type, hull_number').all(id) as DbRow[]

  return {
    ...group,
    vessels: vesselRows.map(hydrateVessel)
  }
}

/** Get carrier groups as GeoJSON for the map */
export function getCarrierGroupGeoJSON(): Record<string, unknown> {
  const groups = getCarrierGroups()

  const features = groups
    .filter(g => g.latitude != null && g.longitude != null)
    .map(g => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [g.longitude, g.latitude] as [number, number]
      },
      properties: {
        id: g.id,
        name: g.name,
        designation: g.designation,
        flagship: g.flagship,
        status: g.status,
        operating_area: g.operating_area,
        source: g.source,
        last_updated: g.last_updated,
        vessel_count: g.vessels.length,
        vessel_types: g.vessels.map(v => v.hull_number ?? v.vessel_name).filter(Boolean)
      }
    }))

  return {
    type: 'FeatureCollection',
    features
  }
}

/** Trigger a full refresh: USNI scrape + AIS match */
export async function refreshCarrierData(): Promise<{
  groupsCount: number
  aisMatches: number
}> {
  const groupsCount = await scrapeUsniFleetTracker()
  const aisMatches = runAisMatcher()

  // Evaluate custom alert rules against CSG groups (Phase 5A)
  try {
    const groups = getCarrierGroups()
    const csgEntities = groups.map((g) => ({
      id: g.id,
      name: g.name,
      lat: g.latitude ?? undefined,
      lon: g.longitude ?? undefined,
      vessel_count: g.vessels?.length ?? 0
    }))
    evaluateRules('csg', csgEntities)
  } catch (err) {
    console.error('[CSG] Rule evaluation error:', err instanceof Error ? err.message : String(err))
  }

  return { groupsCount, aisMatches }
}

/** Initialize CSG data (seed if empty, then run AIS match) */
export async function initCsgData(): Promise<void> {
  const db = getDatabase()
  const count = db.prepare('SELECT COUNT(*) as c FROM carrier_groups').get() as { c: number }

  if (count.c === 0) {
    console.log('[CSG] No carrier groups found, seeding initial data...')
    storeSeedData()
  } else {
    console.log(`[CSG] ${count.c} carrier groups already loaded`)
  }

  // Run initial AIS match
  try {
    const matches = runAisMatcher()
    console.log(`[CSG] Initial AIS match: ${matches} vessels found`)
  } catch (err) {
    console.warn('[CSG] Initial AIS match failed:', err instanceof Error ? err.message : String(err))
  }
}

// ── Scheduler ────────────────────────────────────────────────

let weeklyScrapeTimer: ReturnType<typeof setInterval> | null = null
let aisMatchTimer: ReturnType<typeof setInterval> | null = null

/** Start the CSG scheduler */
export function startCsgScheduler(): void {
  console.log('[CSG] Starting scheduler')

  // AIS match: every 5 minutes
  if (!aisMatchTimer) {
    aisMatchTimer = setInterval(() => {
      try {
        runAisMatcher()
      } catch (err) {
        console.error('[CSG] AIS match error:', err instanceof Error ? err.message : String(err))
      }
    }, 5 * 60 * 1000)
  }

  // USNI scrape: once per week (7 days)
  if (!weeklyScrapeTimer) {
    weeklyScrapeTimer = setInterval(() => {
      scrapeUsniFleetTracker().catch((err) => {
        console.error('[CSG] Weekly scrape error:', err instanceof Error ? err.message : String(err))
      })
    }, 7 * 24 * 60 * 60 * 1000)

    // Run initial scrape on startup (don't wait 7 days for first data)
    scrapeUsniFleetTracker().catch((err) => {
      console.error('[CSG] Initial scrape error:', err instanceof Error ? err.message : String(err))
    })

    // TWZ scrape: same schedule, dedup guard inside handles weekly logic
    scrapeTwzCarrierTracker().catch((err) => {
      console.error('[CSG] TWZ scrape error:', err instanceof Error ? err.message : String(err))
    })
  }

  // Also run TWZ on the weekly interval
  setInterval(() => {
    scrapeTwzCarrierTracker().catch((err) => {
      console.error('[CSG] TWZ scrape error:', err instanceof Error ? err.message : String(err))
    })
  }, 7 * 24 * 60 * 60 * 1000)
}

/** Stop the CSG scheduler */
export function stopCsgScheduler(): void {
  if (aisMatchTimer) {
    clearInterval(aisMatchTimer)
    aisMatchTimer = null
  }
  if (weeklyScrapeTimer) {
    clearInterval(weeklyScrapeTimer)
    weeklyScrapeTimer = null
  }
  console.log('[CSG] Scheduler stopped')
}

// ── Context for AI Chat / Sense-Making ──────────────────────

function extractRelevantSnippet(rawText: string, groupName: string, groupDesignation: string): string {
  // Search for the group name or hull number in the text
  const searchTerms = [groupName, groupDesignation].filter(Boolean)
  
  for (const term of searchTerms) {
    const idx = rawText.toLowerCase().indexOf(term.toLowerCase())
    if (idx >= 0) {
      // Start a bit before the match for context, take 400 chars
      const start = Math.max(0, idx - 50)
      const snippet = rawText.substring(start, start + 400).trim()
      if (start > 0) return '...' + snippet
      return snippet
    }
  }
  
  // Fallback: return last 300 chars (more likely to have actual content than nav)
  return rawText.slice(-300).trim()
}

/**
 * Build a human-readable context string describing current fleet posture.
 * Used by the AI chat system prompt and the sense-making engine.
 */
export function getCSGContextString(): string {
  const db = getDatabase()
  const groups = db.prepare(`
    SELECT cg.*,
           GROUP_CONCAT(cgv.vessel_name || COALESCE(' (' || cgv.hull_number || ')', '')) as vessel_list
    FROM carrier_groups cg
    LEFT JOIN carrier_group_vessels cgv ON cg.id = cgv.group_id
    GROUP BY cg.id
    ORDER BY cg.designation
  `).all() as Array<Record<string, unknown>>

  if (!groups || groups.length === 0) return 'No carrier group data available.'

  const lines = groups.map(g => {
    const status = (g.status as string) || 'unknown'
    const area = (g.operating_area as string) || 'unknown area'
    const vessels = (g.vessel_list as string) || 'no vessels listed'
    const lat = g.latitude as number | null
    const lon = g.longitude as number | null
    const pos = lat != null && lon != null
      ? ` (${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'})`
      : ''
    return `- ${g.name || g.designation || 'Unknown Group'} [${status}] in ${area}${pos}: ${vessels}`
  })

  let result = `Current Fleet Posture (${groups.length} groups):\n${lines.join('\n')}`

  // Add latest CSG intel context
  try {
    const intelRows = db.prepare(`
      SELECT ci.group_id, ci.group_name, ci.source, ci.week_of, ci.raw_text,
             cg.designation
      FROM csg_intel ci
      LEFT JOIN carrier_groups cg ON ci.group_id = cg.id
      WHERE ci.week_of = (SELECT MAX(week_of) FROM csg_intel)
      ORDER BY ci.group_name, ci.source
    `).all() as Array<{ group_id: string; group_name: string; source: string; week_of: string; raw_text: string; designation: string | null }>

    if (intelRows.length > 0) {
      result += `\n\nLatest Fleet Intel (week ${intelRows[0].week_of}):`
      for (const row of intelRows) {
        const snippet = extractRelevantSnippet(row.raw_text, row.group_name, row.designation || '')
        result += `\n- ${row.group_name} (${row.source}): ${snippet}`
      }
    }
  } catch { /* Table might not exist yet */ }

  return result
}
