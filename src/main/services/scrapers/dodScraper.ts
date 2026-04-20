/**
 * DOD Press Releases Scraper (Phase 4G)
 *
 * Contract awards, exercise announcements, policy statements.
 *
 * Primary: Defense.gov press releases RSS
 * Fallback: DVIDS press releases, then Google News proxy
 */

import { BaseScraper, ScrapedArticle, ScraperSource, parseRssXml, fetchUrl, matchesKeywords } from './scraperFramework'

const RELEVANCE_KEYWORDS = [
  'contract', 'defense', 'missile', 'naval', 'exercise', 'deployment', 'sanctions',
  'navy', 'carrier', 'submarine', 'destroyer', 'amphibious', 'coast guard',
  'INDOPACOM', 'CENTCOM', 'EUCOM', 'AFRICOM', 'SOUTHCOM', 'NORTHCOM',
  'ballistic', 'hypersonic', 'shipbuilding', 'procurement', 'weapons'
]

/** Ordered list of feed URLs – first to return articles wins */
const FEED_URLS = [
  // Defense.gov press releases RSS
  'https://www.defense.gov/rss/feeds/defense.gov-press-releases.xml',
  // DVIDS press releases (type 1 = news articles)
  'https://www.dvidshub.net/rss/type/1',
  // Google News proxy for defense.gov content
  'https://news.google.com/rss/search?q=site%3Adefense.gov+OR+site%3Anavy.mil+press+release+OR+deployment+OR+exercise&hl=en-US&gl=US&ceid=US:en'
]

export class DodScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'dod',
    name: 'DOD News',
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
            category: 'defense' as const
          }))

        if (articles.length > 0) return articles
      } catch {
        continue // Try next URL
      }
    }

    return []
  }
}