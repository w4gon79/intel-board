/**
 * News Ingestion Clients — fetch articles from NewsAPI and GDELT.
 *
 * Both clients normalize results to a common `RawArticle` shape that the
 * article processor can further refine before database insertion.
 */

import { config } from '../../utils/config'

// ── Raw article from any source ──

export interface RawArticle {
  source: string
  title: string | null
  content: string | null
  url: string | null
  publishedAt: string | null
  author: string | null
  imageUrl: string | null
  language?: string // ISO 639-1 code, default 'en'
}

// ── Ingestion result ──

export interface IngestionResult {
  source: string
  fetched: number
  inserted: number
  duplicates: number
  errors: number
  elapsedMs: number
}

// ════════════════════════════════════════════
// NewsAPI  (https://newsapi.org)
// ════════════════════════════════════════════

interface NewsApiArticle {
  source: { id: string | null; name: string }
  author: string | null
  title: string | null
  description: string | null
  url: string
  urlToImage: string | null
  publishedAt: string | null
  content: string | null // truncated to ~200 chars + "[+NNN chars]"
}

interface NewsApiResponse {
  status: string
  totalResults: number
  articles: NewsApiArticle[]
  code?: string
  message?: string
}

const NEWS_API_BASE = 'https://newsapi.org/v2'

/** Keywords for intelligence-relevant news queries */
const INTEL_QUERIES = [
  'conflict OR military OR defense',
  'diplomacy OR sanctions OR treaty',
  'crisis OR emergency OR disaster',
  'security OR terrorism OR cyber',
  'trade OR sanctions OR embargo',
  'naval OR maritime OR ship',
  'aerospace OR aviation OR flight'
]

/** Regions to query (English-language focus) */
const NEWS_REGIONS = [
  { country: 'us', label: 'North America' },
  { country: 'gb', label: 'Europe' },
  { country: 'il', label: 'Middle East' },
  { country: 'jp', label: 'East Asia' },
  { country: 'au', label: 'Oceania' }
]

// NewsAPI rate-limit tracking
let newsApi429Until = 0

/**
 * Fetch top headlines from NewsAPI.
 * Rotates through queries and regions to maximise coverage within rate limits.
 */
export async function fetchNewsApiHeadlines(): Promise<RawArticle[]> {
  if (!config.newsApiKey) {
    console.warn('[ingestion:newsapi] No NEWS_API_KEY configured, skipping')
    return []
  }

  // Rate-limit backoff: if we got a 429 recently, skip this cycle
  if (newsApi429Until && Date.now() < newsApi429Until) {
    const remaining = Math.ceil((newsApi429Until - Date.now()) / 60_000)
    console.log(`[ingestion:newsapi] Rate-limited, backing off for ${remaining} more minute(s)`)
    return []
  }

  const allArticles: RawArticle[] = []
  // Pick one query and one region per cycle to stay within rate limits
  const queryIdx = Math.floor(Date.now() / (5 * 60 * 1000)) % INTEL_QUERIES.length
  const regionIdx = Math.floor(Date.now() / (5 * 60 * 1000)) % NEWS_REGIONS.length
  const query = INTEL_QUERIES[queryIdx]
  const region = NEWS_REGIONS[regionIdx]

  const url = new URL(`${NEWS_API_BASE}/top-headlines`)
  url.searchParams.set('apiKey', config.newsApiKey)
  url.searchParams.set('q', query)
  url.searchParams.set('country', region.country)
  url.searchParams.set('pageSize', '50')
  url.searchParams.set('language', 'en')

  console.log(
    `[ingestion:newsapi] Fetching: query="${query.substring(0, 40)}..." country=${region.country}`
  )

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'IntelBoard/1.0' },
      signal: AbortSignal.timeout(15_000)
    })

    if (!resp.ok) {
      const text = await resp.text()
      if (resp.status === 429) {
        // Back off for 2 hours on rate limit
        newsApi429Until = Date.now() + 2 * 60 * 60 * 1000
        console.warn(`[ingestion:newsapi] Rate limited (429). Backing off for 2 hours. Message: ${text}`)
      }
      console.error(`[ingestion:newsapi] HTTP ${resp.status}: ${text}`)
      return []
    }

    const data = (await resp.json()) as NewsApiResponse

    if (data.status !== 'ok') {
      console.error(`[ingestion:newsapi] API error: ${data.code} — ${data.message}`)
      return []
    }

    for (const a of data.articles) {
      // Skip "[Removed]" placeholder articles
      if (a.title === '[Removed]') continue

      allArticles.push({
        source: `newsapi:${a.source.name}`,
        title: a.title,
        content: a.content ?? a.description,
        url: a.url,
        publishedAt: a.publishedAt,
        author: a.author,
        imageUrl: a.urlToImage
      })
    }

    console.log(
      `[ingestion:newsapi] Got ${allArticles.length} articles (totalResults: ${data.totalResults})`
    )
  } catch (err) {
    console.error('[ingestion:newsapi] Fetch failed:', err)
  }

  return allArticles
}

/**
 * Fetch "everything" from NewsAPI for a specific keyword query.
 * Useful for targeted searches on breaking topics.
 */
export async function fetchNewsApiEverything(query: string): Promise<RawArticle[]> {
  if (!config.newsApiKey) return []

  const url = new URL(`${NEWS_API_BASE}/everything`)
  url.searchParams.set('apiKey', config.newsApiKey)
  url.searchParams.set('q', query)
  url.searchParams.set('pageSize', '50')
  url.searchParams.set('language', 'en')
  url.searchParams.set('sortBy', 'publishedAt')

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'IntelBoard/1.0' },
      signal: AbortSignal.timeout(15_000)
    })

    if (!resp.ok) return []

    const data = (await resp.json()) as NewsApiResponse
    if (data.status !== 'ok') return []

    return data.articles
      .filter((a) => a.title !== '[Removed]')
      .map((a) => ({
        source: `newsapi:${a.source.name}`,
        title: a.title,
        content: a.content ?? a.description,
        url: a.url,
        publishedAt: a.publishedAt,
        author: a.author,
        imageUrl: a.urlToImage
      }))
  } catch (err) {
    console.error('[ingestion:newsapi:everything] Fetch failed:', err)
    return []
  }
}

// ════════════════════════════════════════════
// GDELT Doc API  (https://blog.gdeltproject.org/gdelt-doc-api/)
// ════════════════════════════════════════════
// Free, unlimited, no key required.

interface GdeltArticle {
  url: string
  title: string
  seendate: string // "20240101T120000Z"
  socialscore: number
  domain: string
  language: string
  sourcecountry: string
  imageurl: string
}

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc'

/**
 * Fetch articles from GDELT for a given query.
 * GDELT is free and unlimited — great for volume.
 *
 * Note: GDELT v2 doc API requires specific query syntax.
 * See: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */
export async function fetchGdeltArticles(query: string = 'conflict crisis'): Promise<RawArticle[]> {
  // GDELT requires at least 3 characters per term and doesn't like complex
  // boolean in some modes. Use space-separated terms (implicit OR).
  const url = new URL(GDELT_BASE)
  url.searchParams.set('query', query)
  url.searchParams.set('mode', 'artlist')
  url.searchParams.set('maxrecords', '75')
  url.searchParams.set('format', 'json')
  url.searchParams.set('sourcelang', 'english')
  url.searchParams.set('sort', 'DateDesc')

  console.log(`[ingestion:gdelt] Fetching: query="${query.substring(0, 50)}..."`)

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'IntelBoard/1.0' },
      signal: AbortSignal.timeout(20_000)
    })

    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[ingestion:gdelt] HTTP ${resp.status}: ${text.substring(0, 200)}`)
      return []
    }

    const text = await resp.text()

    // GDELT sometimes returns HTML errors or plain text instead of JSON
    let data: { articles: GdeltArticle[] }
    try {
      data = JSON.parse(text) as { articles: GdeltArticle[] }
    } catch {
      console.error(`[ingestion:gdelt] Non-JSON response: ${text.substring(0, 200)}`)
      return []
    }

    if (!data.articles || !Array.isArray(data.articles)) return []

    return data.articles.map((a) => ({
      source: `gdelt:${a.domain}`,
      title: a.title,
      content: null, // GDELT list mode doesn't include full content
      url: a.url,
      publishedAt: parseGdeltDate(a.seendate),
      author: null,
      imageUrl: a.imageurl || null
    }))
  } catch (err) {
    // Log concisely — GDELT is often unreachable; no need for a full stack trace
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[ingestion:gdelt] Skipped (unreachable): ${msg}`)
    return []
  }
}

/** Parse GDELT date format "20240101T120000Z" → ISO string */
function parseGdeltDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  // Format: YYYYMMDDTHHMMSSz
  const year = raw.substring(0, 4)
  const month = raw.substring(4, 6)
  const day = raw.substring(6, 8)
  const hour = raw.substring(9, 11)
  const min = raw.substring(11, 13)
  const sec = raw.substring(13, 15)
  const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}Z`
  const parsed = new Date(iso)
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

// ════════════════════════════════════════════
// Non-English Sources (Multi-Language Translation Pipeline)
// ════════════════════════════════════════════

interface NonEnglishSource {
  id: string
  name: string
  url: string
  language: string
  type: 'rss'
}

const NON_ENGLISH_SOURCES: NonEnglishSource[] = [
  { id: 'rt-ru', name: 'RT Russian', url: 'https://russian.rt.com/rss/', language: 'ru', type: 'rss' },
  { id: 'aljaz-ar', name: 'Al Jazeera Arabic', url: 'https://www.aljazeera.net/xml/rss/all.xml', language: 'ar', type: 'rss' },
  { id: 'xinhua-zh', name: 'Xinhua Chinese', url: 'http://www.xinhuanet.com/politics/news_politics.xml', language: 'zh', type: 'rss' },
  { id: 'irna-fa', name: 'IRNA Farsi', url: 'https://www.irna.ir/rss', language: 'fa', type: 'rss' },
  { id: 'yonhap-ko', name: 'Yonhap Korean', url: 'https://www.yna.co.kr/RSS/news.xml', language: 'ko', type: 'rss' },
  { id: 'telesur-es', name: 'TeleSUR Spanish', url: 'https://www.telesurtv.net/rss/', language: 'es', type: 'rss' },
]

/** Language name mapping for display */
export const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic',
  ru: 'Russian',
  zh: 'Chinese',
  fa: 'Farsi',
  ko: 'Korean',
  es: 'Spanish',
  en: 'English',
}

/**
 * Fetch articles from non-English RSS sources.
 * Only fetches from sources matching the enabled language codes.
 * Returns RawArticle[] with language field set (not 'en').
 */
export async function fetchNonEnglishSources(
  enabledLanguages: string[] = ['ar', 'ru', 'zh', 'fa', 'ko', 'es']
): Promise<RawArticle[]> {
  const sources = NON_ENGLISH_SOURCES.filter(s => enabledLanguages.includes(s.language))
  if (sources.length === 0) return []

  const allArticles: RawArticle[] = []

  for (const source of sources) {
    try {
      console.log(`[ingestion:i18n] Fetching ${source.name} (${source.language})...`)
      const articles = await fetchRssFeed(source)
      console.log(`[ingestion:i18n] ${source.name}: ${articles.length} articles`)
      allArticles.push(...articles)
    } catch (err) {
      console.warn(`[ingestion:i18n] ${source.name} fetch failed:`, err instanceof Error ? err.message : err)
    }
  }

  return allArticles
}

/**
 * Fetch and parse an RSS feed, returning normalized RawArticle[].
 * Handles XML parsing for RSS 2.0 feeds. Non-English articles are tagged with their language.
 */
async function fetchRssFeed(source: NonEnglishSource): Promise<RawArticle[]> {
  const resp = await fetch(source.url, {
    headers: { 'User-Agent': 'IntelBoard/1.0' },
    signal: AbortSignal.timeout(15_000)
  })

  if (!resp.ok) {
    console.warn(`[ingestion:i18n] ${source.name} returned HTTP ${resp.status}`)
    return []
  }

  const text = await resp.text()

  // Basic RSS 2.0 parsing — extract <item> elements
  const items: RawArticle[] = []
  const itemRegex = /<item[\s\S]*?<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(text)) !== null) {
    const itemXml = match[0]

    const title = extractXmlTag(itemXml, 'title')
    const link = extractXmlTag(itemXml, 'link')
    const description = extractXmlTag(itemXml, 'description')
    const pubDate = extractXmlTag(itemXml, 'pubDate')

    if (!title && !description) continue

    // Strip HTML from description for clean text
    const cleanContent = description ? stripHtml(description) : null

    items.push({
      source: `${source.id}:${source.name}`,
      title: title || null,
      content: cleanContent,
      url: link || null,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      author: null,
      imageUrl: null,
      language: source.language
    })
  }

  return items
}

/** Extract text content of an XML tag, handling CDATA sections */
function extractXmlTag(xml: string, tag: string): string | null {
  // Try CDATA first
  const cdataRegex = new RegExp(`<${tag}[\\s\\S]*?>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i')
  const cdataMatch = cdataRegex.exec(xml)
  if (cdataMatch) return decodeXmlEntities(cdataMatch[1].trim())

  // Plain text
  const plainRegex = new RegExp(`<${tag}[\\s\\S]*?>([\\s\\S]*?)</${tag}>`, 'i')
  const plainMatch = plainRegex.exec(xml)
  if (plainMatch) return decodeXmlEntities(plainMatch[1].trim())

  return null
}

/** Decode common XML entities */
function decodeXmlEntities(text: string): string {
  const map: Record<string, string> = {}
  map['a' + 'mp'] = String.fromCharCode(38) // &
  map['l' + 't'] = String.fromCharCode(60)   // <
  map['g' + 't'] = String.fromCharCode(62)   // >
  map['q' + 'uot'] = String.fromCharCode(34) // "
  map['a' + 'pos'] = String.fromCharCode(39) // '
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_m, name: string) => map[name] || _m)
}

/** Strip HTML tags from text, preserving content */
function stripHtml(html: string): string {
  // Remove img tags entirely (they're decorative, not content)
  let text = html.replace(/<img[^>]*>/gi, '')
  // Replace <br/> and <br> with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n')
  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '')
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return text
}
