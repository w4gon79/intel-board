/**
 * Maritime Executive Scraper (Phase 4G)
 *
 * Commercial and naval maritime incidents, port closures,
 * shipping lane disruptions, piracy reports.
 *
 * Primary: Maritime Executive article RSS feeds
 * Fallback: Google News proxy for maritime content
 */

import { BaseScraper, ScrapedArticle, ScraperSource, parseRssXml, fetchUrl, matchesKeywords } from './scraperFramework'

const RELEVANCE_KEYWORDS = [
  'naval', 'military', 'warship', 'carrier', 'submarine', 'piracy', 'sanctions',
  'port closure', 'seizure', 'incident', 'Houthi', 'tanker', 'cargo', 'missile',
  'attack', 'convoy', 'escort', 'blockade', 'straits', 'canal', 'chokepoint',
  'shipping', 'maritime security', 'boarded', 'detained', 'disruption'
]

/** Ordered list of feed URLs – first to return articles wins */
const FEED_URLS = [
  // Maritime Executive article RSS
  'https://maritime-executive.com/articles.rss',
  // Alternate RSS path
  'https://maritime-executive.com/feed/articles',
  // Google News proxy for maritime military content
  'https://news.google.com/rss/search?q=site%3Amaritime-executive.com+naval+OR+military+OR+warship+OR+piracy+OR+sanctions&hl=en-US&gl=US&ceid=US:en'
]

export class MaritimeExecScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'maritime-exec',
    name: 'Maritime Executive',
    url: FEED_URLS[0],
    interval: 2 * 60 * 60 * 1000, // 2 hours
    type: 'rss',
    enabled: true
  }

  async fetch(): Promise<ScrapedArticle[]> {
    for (const url of FEED_URLS) {
      try {
        const xml = await fetchUrl(url, 10000)
        const items = parseRssXml(xml)

        const articles = items
          .filter((item) => {
            const text = `${item.title} ${item.description}`
            return matchesKeywords(text, RELEVANCE_KEYWORDS)
          })
          .map((item) => ({
            title: item.title,
            description: item.description,
            url: item.link,
            source: this.source.id,
            publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            category: 'naval' as const
          }))

        if (articles.length > 0) return articles
      } catch {
        continue // Try next URL
      }
    }

    return []
  }
}