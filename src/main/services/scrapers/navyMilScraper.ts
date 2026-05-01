/**
 * Navy.mil News Scraper (Phase 4G)
 *
 * Scrapes official US Navy news releases via RSS.
 * High-value source for deployments, exercises, ship movements.
 *
 * Primary: Google News RSS for navy.mil content and Navy deployment news
 * Fallback: DVIDS US Navy unit feed (may be stale)
 */

import { BaseScraper, ScrapedArticle, ScraperSource, parseRssXml, fetchUrl, matchesKeywords } from './scraperFramework'

const RELEVANCE_KEYWORDS = [
  'carrier', 'strike group', 'deployment', 'amphibious', 'destroyer', 'submarine',
  'exercise', 'patrol', 'freedom of navigation', 'ballistic missile', 'SOUTHCOM',
  'CENTCOM', 'INDOPACOM', 'EUCOM', 'AFRICOM', 'cruiser', 'frigate', 'littoral',
  'sealift', 'carrier strike', 'amphibious ready', 'expeditionary', 'naval forces',
  'fleet', 'warship', 'destroyer squadron', 'surface force'
]

/** Ordered list of feed URLs – first to return articles wins */
const FEED_URLS = [
  // Navy.mil news via Google News (tested: returns 100 items)
  'https://news.google.com/rss/search?q=site%3Anavy.mil&hl=en-US&gl=US&ceid=US:en',
  // Navy deployment/carrier news via Google News (tested: returns 100 items)
  'https://news.google.com/rss/search?q=navy+deployment+OR+carrier+strike+group+OR+amphibious+ready+group&hl=en-US&gl=US&ceid=US:en',
  // DVIDS Navy news feed (may be stale, kept as last resort)
  'https://www.dvidshub.net/rss/unit/1802'
]

export class NavyMilScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'navy-mil',
    name: 'Navy News',
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
            category: 'military' as const
          }))

        if (articles.length > 0) return articles
      } catch {
        continue // Try next URL
      }
    }

    return []
  }
}