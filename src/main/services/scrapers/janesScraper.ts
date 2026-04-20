/**
 * Jane's Defence Headlines Scraper (Phase 4G)
 *
 * Defense procurement, force posture changes, strategic analysis.
 * Jane's is paywalled – use Google News RSS to surface their headlines.
 * Titles carry significant intel even without full article access.
 */

import { BaseScraper, ScrapedArticle, ScraperSource, parseRssXml, fetchUrl } from './scraperFramework'

/** Google News RSS for Jane's defence headlines */
const FEED_URL =
  'https://news.google.com/rss/search?q=site%3Ajanes.com+defense+OR+military+OR+naval+OR+missile&hl=en-US&gl=US&ceid=US:en'

export class JanesScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'janes',
    name: "Jane's Defence",
    url: FEED_URL,
    interval: 4 * 60 * 60 * 1000, // 4 hours
    type: 'rss',
    enabled: true
  }

  async fetch(): Promise<ScrapedArticle[]> {
    try {
      const xml = await fetchUrl(FEED_URL, 10000)
      const items = parseRssXml(xml)

      return items.map((item) => ({
        title: item.title,
        description: item.description,
        url: item.link,
        source: this.source.id,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        category: 'defense' as const
      }))
    } catch {
      return []
    }
  }
}