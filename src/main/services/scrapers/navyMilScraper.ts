/**
 * Navy.mil News Scraper (Phase 4G)
 *
 * Scrapes official US Navy news releases via RSS.
 * High-value source for deployments, exercises, ship movements.
 *
 * Primary: DVIDS (Defense Visual Information Distribution Service) US Navy unit feed
 * Fallback: Google News RSS proxy for navy.mil content
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
  // DVIDS US Navy unit RSS feed
  'https://www.dvidshub.net/rss/unit/1802',
  // Google News proxy for Navy content
  'https://news.google.com/rss/search?q=site%3Anavy.mil+OR+site%3Adefense.gov+navy+deployment+OR+exercise+OR+carrier+OR+strike+group&hl=en-US&gl=US&ceid=US:en'
]

export class NavyMilScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'navy-mil',
    name: 'Navy News',
    url: FEED_URLS[0],
    interval: 60 * 60 * 1000, // 1 hour
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