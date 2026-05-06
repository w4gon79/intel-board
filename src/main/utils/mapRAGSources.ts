/**
 * Shared utility for mapping RAG source citations to chat source format.
 * Used by both the IPC handler (Electron desktop) and HTTP handler (web/remote).
 */

import type { SourceCitation } from '../../shared/types'
import type { Database } from 'better-sqlite3'

/** Chat-formatted source returned to the UI */
export interface ChatSource {
  id: string
  title: string
  snippet: string
  timestamp: string
  score: number
  sourceType: string
  sourceUrl: string | null
}

/** Title overrides for live source types */
const LIVE_SOURCE_TITLES: Record<string, string> = {
  'live-fleet': 'Fleet Posture (CSG/ARG tracking)',
  'live-tactical': 'Tactical Events (ADS-B/AIS)',
  'live-chokepoint': 'Choke Point Traffic (AIS/GFW)',
  'live-alerts': 'Active Intel Alerts',
  'live-sensemaking': 'AI Sense-Making Analysis',
  'live-predictions': 'Active Predictions',
  'live-zones': 'Dynamic Conflict Zones',
  'live-gfw': 'Global Fishing Watch',
  'live-social': 'Social Media Intelligence',
  'live-economic': 'Economic Indicators',
  'live-notams': 'Military NOTAMs'
}

/**
 * Map RAG SourceCitation[] to ChatSource[] with:
 *  - Title overrides for live source types
 *  - DB lookup for article/news titles, URLs, and content snippets
 */
export function mapRAGSourcesToChatSources(
  ragSources: SourceCitation[],
  db: Database
): ChatSource[] {
  // 1. Map with title overrides
  const sources: ChatSource[] = ragSources.map((s) => {
    const title =
      LIVE_SOURCE_TITLES[s.sourceType] ??
      `${s.sourceType} — ${s.region ?? 'unknown'}`

    return {
      id: String(s.sourceId),
      title,
      snippet: '',
      timestamp: s.timestamp ?? new Date().toISOString(),
      score: s.confidence,
      sourceType: s.sourceType,
      sourceUrl: null as string | null
    }
  })

  // 2. Batch lookup article URLs, titles, and content snippets from DB
  if (sources.length > 0) {
    const articleIds = sources
      .filter((s) => s.sourceType === 'article' || s.sourceType === 'news')
      .map((s) => s.id)

    if (articleIds.length > 0) {
      const placeholders = articleIds.map(() => '?').join(',')
      const urlRows = db
        .prepare(
          `SELECT id, url, title, content FROM articles WHERE id IN (${placeholders})`
        )
        .all(...articleIds) as Array<{
        id: string
        url: string | null
        title: string | null
        content: string | null
      }>

      const urlMap = new Map(
        urlRows.map((r) => [r.id, { url: r.url, title: r.title, content: r.content }])
      )

      for (const source of sources) {
        const lookup = urlMap.get(source.id)
        if (lookup) {
          if (lookup.url) source.sourceUrl = lookup.url
          if (lookup.title) source.title = lookup.title
          if (lookup.content) source.snippet = lookup.content.slice(0, 200)
        }
      }
    }
  }

  return sources
}