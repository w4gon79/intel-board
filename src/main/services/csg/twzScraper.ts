/**
 * TWZ Carrier Tracker Scraper
 *
 * Scrapes The War Zone carrier tracker for CSG context intel.
 * Reuses fetch helpers from usniScraper.
 */

import { fetchUrl, fetchUrlWithBrowser, stripHtml } from './usniScraper'
import { getDatabase } from '../storage/database'

function getIsoWeek(): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const days = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  const weekNum = Math.ceil((days + start.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export async function scrapeTwzCarrierTracker(): Promise<number> {
  console.log('[TWZ-Scraper] Starting TWZ Carrier Tracker scrape...')

  const db = getDatabase()
  const weekOf = getIsoWeek()

  // Check if we already have TWZ intel for this week
  const existing = db.prepare(
    "SELECT COUNT(*) as count FROM csg_intel WHERE source = 'twz' AND week_of = ?"
  ).get(weekOf) as { count: number }

  if (existing.count > 0) {
    console.log(`[TWZ-Scraper] Already have TWZ intel for week ${weekOf}, skipping`)
    return 0
  }

  try {
    // Step 1: Fetch the TWZ carrier tracker category page
    const categoryHtml = await fetchUrl('https://www.twz.com/sea')

    // Step 2: Find the latest carrier tracker article
    const linkMatch = categoryHtml.match(/href="(https:\/\/www\.twz\.com\/sea\/carrier-tracker[^"]*)"/i)
    if (!linkMatch) {
      throw new Error('No TWZ carrier tracker link found')
    }
    const articleUrl = linkMatch[1]
    console.log(`[TWZ-Scraper] Found article: ${articleUrl}`)

    // Step 3: Fetch article content (TWZ likely needs browser)
    let articleHtml: string
    try {
      articleHtml = await fetchUrl(articleUrl)
    } catch {
      console.log('[TWZ-Scraper] Direct fetch failed, trying browser...')
      articleHtml = await fetchUrlWithBrowser(articleUrl)
    }

    const articleText = stripHtml(articleHtml).slice(0, 8000)

    // Step 4: Store as intel for all known CSG groups
    // TWZ covers all groups in one article, so store once per known group
    const knownGroups = db.prepare(
      'SELECT DISTINCT id, name FROM carrier_groups'
    ).all() as Array<{ id: string; name: string }>

    if (knownGroups.length === 0) {
      console.log('[TWZ-Scraper] No carrier groups in DB yet, skipping intel storage')
      return 0
    }

    const insertIntel = db.prepare(`
      INSERT OR REPLACE INTO csg_intel (group_id, group_name, week_of, raw_text, source, source_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const group of knownGroups) {
      insertIntel.run(group.id, group.name, weekOf, articleText, 'twz', articleUrl)
    }

    console.log(`[TWZ-Scraper] Stored TWZ intel for ${knownGroups.length} groups (week ${weekOf})`)
    return knownGroups.length
  } catch (err) {
    console.error('[TWZ-Scraper] Failed:', err instanceof Error ? err.message : String(err))
    return 0
  }
}