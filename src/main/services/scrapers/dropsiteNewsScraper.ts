/**
 * Drop Site News Scraper
 *
 * Independent news on politics and war.
 * RSS feed: https://www.dropsitenews.com/feed (standard RSS 2.0)
 * Substack publication ~800K subscribers.
 * Focus: politics, war, military affairs, foreign policy, intelligence.
 */

import { BaseScraper, ScrapedArticle, ScraperSource, fetchUrl, parseRssXml } from './scraperFramework'

export class DropsiteNewsScraper extends BaseScraper {
  source: ScraperSource = {
    id: 'dropsitenews',
    name: 'Drop Site News',
    url: 'https://www.dropsitenews.com/feed',
    interval: 30 * 60 * 1000, // 30 min
    type: 'rss',
    enabled: true
  }

  async fetch(): Promise<ScrapedArticle[]> {
    const xml = await fetchUrl(this.source.url)
    const items = parseRssXml(xml)

    // Also extract <content:encoded> for full article text
    const contentBlocks = extractContentEncoded(xml)

    return items.map((item, i) => ({
      title: item.title,
      description: item.description,
      url: item.link,
      source: this.source.id,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      content: contentBlocks[i] || undefined,
      category: 'news'
    }))
  }
}

/**
 * Extract <content:encoded> blocks from RSS XML items.
 * Returns an array aligned with the item order from parseRssXml.
 */
function extractContentEncoded(xml: string): string[] {
  const results: string[] = []
  const itemRegex = /<item[\s\S]*?<\/item>/gi
  let itemMatch: RegExpExecArray | null

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[0]
    const contentMatch = block.match(
      /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i
    )
    if (contentMatch) {
      results.push(
        contentMatch[1]
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/&/g, '&')
          .replace(/</g, '<')
          .replace(/>/g, '>')
          .replace(/"/g, '"')
          .replace(/'/g, "'")
          .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
          .trim()
      )
    } else {
      results.push('')
    }
  }

  return results
}