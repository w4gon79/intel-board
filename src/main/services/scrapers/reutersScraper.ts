/**
 * Reuters World News Scraper (Phase 4G)
 *
 * Breaking geopolitical events via Google News RSS bridge.
 * Faster than NewsAPI for wire stories.
 */

import { BaseScraper, ScrapedArticle, ScraperSource, parseRssXml, fetchUrl } from './scraperFramework'

export class ReutersScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'reuters',
    name: 'Reuters World',
    url: 'https://news.google.com/rss/search?q=when:1d+allinurl:reuters.com+military+OR+defense+OR+naval+OR+war+OR+sanctions',
    interval: 30 * 60 * 1000, // 30 min
    type: 'rss',
    enabled: true
  }

  async fetch(): Promise<ScrapedArticle[]> {
    const xml = await fetchUrl(this.source.url)
    const items = parseRssXml(xml)

    // Google News RSS articles are already filtered for military/defense relevance
    return items.map((item) => ({
      title: item.title,
      description: item.description,
      url: item.link,
      source: this.source.id,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      category: 'geopolitical'
    }))
  }
}