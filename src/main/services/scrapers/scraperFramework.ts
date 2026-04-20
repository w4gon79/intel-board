/**
 * Scraper Framework (Phase 4G)
 *
 * Unified base class and interfaces for all news/data source scrapers.
 * Every scraper follows the same pattern: define a source, implement fetch(),
 * and the framework handles error logging and article normalization.
 */

// ── Types ──────────────────────────────────────────────────────

export interface ScraperSource {
  id: string // Unique identifier (e.g., 'navy-mil', 'reuters')
  name: string // Display name
  url: string // Feed URL or scrape target
  interval: number // Polling interval in ms
  type: 'rss' | 'api' | 'scrape'
  enabled: boolean // Can be toggled at runtime
}

export interface ScrapedArticle {
  title: string
  description: string
  url: string
  source: string // scraper id
  publishedAt: string // ISO date
  content?: string // Full text if available
  region?: string // Extracted region if possible
  category?: string // military, geopolitical, naval, etc.
}

// ── Base Scraper ───────────────────────────────────────────────

export abstract class BaseScraper {
  abstract source: ScraperSource

  async run(): Promise<ScrapedArticle[]> {
    try {
      const articles = await this.fetch()
      console.log(`[Scraper:${this.source.id}] Fetched ${articles.length} articles`)
      return articles
    } catch (err) {
      console.error(`[Scraper:${this.source.id}] Failed:`, err)
      return []
    }
  }

  abstract fetch(): Promise<ScrapedArticle[]>
}

// ── Shared XML/RSS Parser ──────────────────────────────────────

/**
 * Minimal RSS XML parser — extracts <item> elements from an RSS feed.
 * No external dependencies; uses regex-based parsing suitable for
 * well-structured RSS 2.0 feeds.
 */
export function parseRssXml(xml: string): Array<{
  title: string
  description: string
  link: string
  pubDate: string
}> {
  const items: Array<{ title: string; description: string; link: string; pubDate: string }> = []

  // Extract all <item>...</item> blocks
  const itemRegex = /<item[\s\S]*?<\/item>/gi
  let itemMatch: RegExpExecArray | null

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[0]

    const title = extractTag(block, 'title')
    const description = extractTag(block, 'description')
    const link = extractTag(block, 'link')
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'dc:date') || ''

    if (title || link) {
      items.push({ title, description, link, pubDate })
    }
  }

  return items
}

function extractTag(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = block.match(regex)
  if (!match) return ''
  // Decode common HTML entities
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .trim()
}

/**
 * Fetch a URL with a timeout and return the response text.
 * Uses Node.js built-in https module.
 */
export async function fetchUrl(url: string, timeoutMs: number = 30000): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'IntelBoard/1.0 (Intelligence Dashboard)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Check if any keyword from the list appears in the text (case-insensitive).
 */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((kw) => lower.includes(kw.toLowerCase()))
}