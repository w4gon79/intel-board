/**
 * OSINT Twitter/X Feed Monitor (Phase 4G)
 *
 * Monitors key OSINT accounts via Nitter RSS bridges.
 * Often breaks news hours before mainstream media.
 *
 * Primary: Google News RSS for OSINT military content (reliable)
 * Fallback: Nitter RSS instances (unreliable, frequently down)
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

/** Google News RSS primary for OSINT military content */
const GOOGLE_NEWS_OSINT =
  'https://news.google.com/rss/search?q=OSINT+military+OR+naval+OR+warship+OR+satellite+imagery+OR+flight+tracking+OR+%22open+source+intelligence%22&hl=en-US&gl=US&ceid=US:en'

export class OsintTwitterScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'osint-twitter',
    name: 'OSINT Social',
    url: '', // Multiple URLs, handled in fetch()
    interval: 30 * 60 * 1000, // 30 min
    type: 'rss',
    enabled: true
  }

  async fetch(): Promise<ScrapedArticle[]> {
    // Phase 1: Try Google News first (stable, reliable)
    try {
      const xml = await fetchUrl(GOOGLE_NEWS_OSINT, 10000)
      const items = parseRssXml(xml)

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
      // Google News failed, fall through to Nitter
    }

    // Phase 2: Fallback to Nitter instances
    const allArticles: ScrapedArticle[] = []
    for (const account of ACCOUNTS) {
      try {
        const articles = await this.fetchAccount(account)
        if (articles) allArticles.push(...articles)
      } catch {
        // Individual account failures shouldn't break the whole scraper
        console.warn(`[Scraper:osint-twitter] Failed to fetch @${account}`)
      }
    }

    return allArticles
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