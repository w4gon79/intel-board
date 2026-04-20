/**
 * OSINT Twitter/X Feed Monitor (Phase 4G)
 *
 * Monitors key OSINT accounts via Nitter RSS bridges.
 * Often breaks news hours before mainstream media.
 *
 * Primary: Nitter RSS instances with 5s timeout per account
 * Fallback: Google News RSS for OSINT military content
 */

import { BaseScraper, ScrapedArticle, ScraperSource, parseRssXml, fetchUrl } from './scraperFramework'

const ACCOUNTS = [
  'NavalInstitute',
  'OSINTtechnical',
  'sentdefender',
  'IntelCrab',
  'COUPSURE',
  'Flash_news_33'
]

const NITTER_INSTANCES = [
  'nitter.poast.org',
  'nitter.privacydev.net',
  'xcancel.com'
]

/** Google News RSS fallback for OSINT military content */
const GOOGLE_NEWS_OSINT =
  'https://news.google.com/rss/search?q=%22OSINT%22+OR+%22open+source+intelligence%22+military+OR+naval+OR+warship+OR+tracking&hl=en-US&gl=US&ceid=US:en'

export class OsintTwitterScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'osint-twitter',
    name: 'OSINT Social',
    url: '', // Multiple URLs, handled in fetch()
    interval: 15 * 60 * 1000, // 15 min
    type: 'rss',
    enabled: true
  }

  async fetch(): Promise<ScrapedArticle[]> {
    const allArticles: ScrapedArticle[] = []

    // Phase 1: Try Nitter instances for each account
    for (const account of ACCOUNTS) {
      try {
        const articles = await this.fetchAccount(account)
        if (articles) allArticles.push(...articles)
      } catch {
        // Individual account failures shouldn't break the whole scraper
        console.warn(`[Scraper:osint-twitter] Failed to fetch @${account}`)
      }
    }

    // If Nitter yielded results, return them
    if (allArticles.length > 0) return allArticles

    // Phase 2: Fallback to Google News OSINT query
    try {
      const xml = await fetchUrl(GOOGLE_NEWS_OSINT, 10000)
      const items = parseRssXml(xml)

      return items.map((item) => ({
        title: item.title,
        description: item.description,
        url: item.link,
        source: this.source.id,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        category: 'osint' as const
      }))
    } catch {
      return []
    }
  }

  private async fetchAccount(account: string): Promise<ScrapedArticle[] | null> {
    for (const instance of NITTER_INSTANCES) {
      try {
        const resp = await fetchUrl(`https://${instance}/${account}/rss`, 5000)
        const items = parseRssXml(resp)

        if (items.length > 0) {
          return items.map((item) => ({
            title: item.title,
            description: item.description,
            url: item.link,
            source: this.source.id,
            publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            category: 'osint' as const
          }))
        }
      } catch {
        continue // Try next instance
      }
    }

    return null
  }
}