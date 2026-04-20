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

/**
 * Fetch top headlines from NewsAPI.
 * Rotates through queries and regions to maximise coverage within rate limits.
 */
export async function fetchNewsApiHeadlines(): Promise<RawArticle[]> {
  if (!config.hasNewsApiKey) {
    console.warn('[ingestion:newsapi] No NEWS_API_KEY configured, skipping')
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
  if (!config.hasNewsApiKey) return []

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