/**
 * Scraper Manager (Phase 4G)
 *
 * Orchestrates all scrapers: starts them on boot, schedules periodic runs,
 * and inserts fetched articles into the SQLite database.
 */

import { createHash } from 'crypto'
import { BaseScraper } from './scraperFramework'
import { NavyMilScraper } from './navyMilScraper'
import { DodScraper } from './dodScraper'
import { MaritimeExecScraper } from './maritimeExecScraper'
import { ReutersScraper } from './reutersScraper'
import { OsintTwitterScraper } from './osntTwitterScraper'
import { JanesScraper } from './janesScraper'
import { DropsiteNewsScraper } from './dropsiteNewsScraper'
import { getDatabase } from '../storage/database'

// ── Scraper registry ───────────────────────────────────────────

const scrapers: BaseScraper[] = [
  new NavyMilScraper(),
  new DodScraper(),
  new MaritimeExecScraper(),
  new ReutersScraper(),
  new OsintTwitterScraper(),
  new JanesScraper(),
  new DropsiteNewsScraper()
]

const scraperTimers: ReturnType<typeof setInterval>[] = []

// ── Public API ─────────────────────────────────────────────────

/**
 * Start all enabled scrapers. Each runs immediately on startup,
 * then on its configured interval.
 */
export function startScrapers(): void {
  for (const scraper of scrapers) {
    if (!scraper.source.enabled) continue

    // Run immediately on startup (non-blocking)
    runScraper(scraper).catch((err) => {
      console.warn(`[ScraperManager] Startup run failed for ${scraper.source.id}:`, err)
    })

    // Schedule periodic runs
    const timer = setInterval(() => {
      runScraper(scraper).catch((err) => {
        console.warn(`[ScraperManager] Scheduled run failed for ${scraper.source.id}:`, err)
      })
    }, scraper.source.interval)

    scraperTimers.push(timer)
    console.log(
      `[ScraperManager] Started ${scraper.source.id} (${scraper.source.interval / 60000}min interval)`
    )
  }
}

/**
 * Stop all scraper timers.
 */
export function stopScrapers(): void {
  for (const timer of scraperTimers) {
    clearInterval(timer)
  }
  scraperTimers.length = 0
  console.log('[ScraperManager] All scrapers stopped')
}

/**
 * Get list of all scrapers and their current status.
 */
export function getScraperStatus(): Array<{
  id: string
  name: string
  enabled: boolean
  interval: number
  type: string
}> {
  return scrapers.map((s) => ({
    id: s.source.id,
    name: s.source.name,
    enabled: s.source.enabled,
    interval: s.source.interval,
    type: s.source.type
  }))
}

/**
 * Toggle a scraper on/off by ID.
 */
export function toggleScraper(id: string, enabled: boolean): boolean {
  const scraper = scrapers.find((s) => s.source.id === id)
  if (scraper) {
    scraper.source.enabled = enabled
    console.log(`[ScraperManager] ${id}: ${enabled ? 'enabled' : 'disabled'}`)
    return true
  }
  return false
}

/**
 * Manually trigger a scraper run by ID.
 */
export async function refreshScraper(id: string): Promise<number> {
  const scraper = scrapers.find((s) => s.source.id === id)
  if (!scraper) throw new Error(`Scraper not found: ${id}`)
  const articles = await scraper.run()
  return insertArticles(articles)
}

// ── Internal ───────────────────────────────────────────────────

/**
 * Run a single scraper and insert results into the database.
 */
async function runScraper(scraper: BaseScraper): Promise<void> {
  const articles = await scraper.run()

  if (articles.length === 0) return

  const inserted = insertArticles(articles)

  if (inserted > 0) {
    console.log(
      `[ScraperManager] ${scraper.source.id}: inserted ${inserted}/${articles.length} new articles`
    )
  }
}

/**
 * Insert scraped articles into the articles table.
 * Uses URL-based hash as primary key for dedup (INSERT OR IGNORE).
 * Returns the number of actually inserted rows.
 */
function insertArticles(
  articles: Array<{
    title: string
    description: string
    url: string
    source: string
    publishedAt: string
    content?: string
    category?: string
  }>
): number {
  const db = getDatabase()
  let inserted = 0

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO articles (id, title, content, url, source, published_at, region, topics)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const article of articles) {
    try {
      // Generate deterministic ID from URL for dedup
      const id = createHash('sha256').update(article.url).digest('hex').substring(0, 16)

      // Combine description + content into the content column
      const fullContent = [article.description, article.content].filter(Boolean).join('\n\n')

      const result = stmt.run(
        id,
        article.title,
        fullContent || null,
        article.url,
        article.source,
        article.publishedAt,
        article.category ?? null,
        article.category ?? null
      )

      if (result.changes > 0) inserted++
    } catch {
      // Skip duplicates and bad data
    }
  }

  return inserted
}