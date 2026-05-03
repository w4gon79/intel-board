/**
 * Article Processor — deduplication, entity extraction, region detection, topic tagging.
 *
 * Takes raw articles from any source and processes them for database insertion.
 * Uses simple keyword/rule-based extraction (no LLM needed for this stage).
 */

import type { InsertArticle, Article, IntelTier } from '../../../shared/types'
import type { RawArticle, IngestionResult } from './news'
import { insertArticle, getArticleCount, getArticles, insertIntelItem, getRecentIntelItems, deleteIntelItem, getIntelItemCount } from '../storage/dbService'
import { embedAndStore } from '../storage/vectordb'
import { withWorldContext } from '../../utils/worldContext'
import { franc } from 'franc'

// ── Region detection ──

interface RegionRule {
  region: string
  keywords: string[]
}

const REGION_RULES: RegionRule[] = [
  { region: 'Middle East', keywords: ['israel', 'iran', 'iraq', 'syria', 'lebanon', 'gaza', 'yemen', 'saudi', 'uae', 'qatar', 'turkey', 'jordan', 'egypt', 'houthi', 'hezbollah', 'hamas'] },
  { region: 'East Asia', keywords: ['china', 'taiwan', 'japan', 'korea', 'north korea', 'south korea', 'xi jinping', 'beijing', 'shanghai', 'south china sea', 'pyongyang'] },
  { region: 'Europe', keywords: ['ukraine', 'russia', 'nato', 'eu ', 'european', 'germany', 'france', 'uk ', 'britain', 'poland', 'belarus', 'kremlin', 'putin', 'zelensky'] },
  { region: 'South Asia', keywords: ['india', 'pakistan', 'afghanistan', 'bangladesh', 'sri lanka', 'kashmir'] },
  { region: 'Africa', keywords: ['africa', 'sudan', 'ethiopia', 'nigeria', 'somalia', 'libya', 'congo', 'sahel', 'mali', 'niger'] },
  { region: 'Southeast Asia', keywords: ['myanmar', 'vietnam', 'thailand', 'philippines', 'indonesia', 'malaysia', 'singapore'] },
  { region: 'Latin America', keywords: ['venezuela', 'colombia', 'mexico', 'brazil', 'argentina', 'cuba', 'haiti', 'cartel'] },
  { region: 'Arctic', keywords: ['arctic', 'greenland', 'iceland', 'svalbard'] }
]

// ── Country-level geocoding ──

interface CountryRule {
  country: string
  keywords: string[]
  lat: number
  lon: number
}

const COUNTRY_COORDS: CountryRule[] = [
  // Middle East
  { country: 'Israel', keywords: ['israel', 'idf', 'tel aviv', 'jerusalem', 'gaza', 'west bank'], lat: 31.5, lon: 35.0 },
  { country: 'Iran', keywords: ['iran', 'tehran', 'irgc', 'persian', 'khamenei'], lat: 32.0, lon: 53.0 },
  { country: 'Iraq', keywords: ['iraq', 'baghdad', 'kurdistan', 'mosul', 'erbil'], lat: 33.0, lon: 44.0 },
  { country: 'Syria', keywords: ['syria', 'damascus', 'assad', 'aleppo'], lat: 35.0, lon: 38.0 },
  { country: 'Yemen', keywords: ['yemen', 'aden', 'sanaa', 'houthi'], lat: 15.5, lon: 44.0 },
  { country: 'Saudi Arabia', keywords: ['saudi', 'riyadh', 'mbs', 'mohammed bin salman'], lat: 24.0, lon: 45.0 },
  { country: 'Turkey', keywords: ['turkey', 'erdogan', 'ankara', 'istanbul'], lat: 39.0, lon: 35.0 },
  { country: 'Lebanon', keywords: ['lebanon', 'beirut', 'hezbollah'], lat: 33.9, lon: 35.5 },
  { country: 'UAE', keywords: ['uae', 'dubai', 'abu dhabi', 'emirati'], lat: 24.0, lon: 54.0 },
  { country: 'Qatar', keywords: ['qatar', 'doha'], lat: 25.3, lon: 51.2 },
  { country: 'Jordan', keywords: ['jordan', 'amman'], lat: 31.0, lon: 36.6 },
  { country: 'Egypt', keywords: ['egypt', 'cairo', 'suez', 'sinai'], lat: 27.0, lon: 30.0 },
  // East Asia
  { country: 'China', keywords: ['china', 'beijing', 'shanghai', 'xi jinping', 'ccp', 'pla', 'chinese', 'shenzhen'], lat: 35.0, lon: 105.0 },
  { country: 'Taiwan', keywords: ['taiwan', 'taipei'], lat: 23.5, lon: 121.0 },
  { country: 'Japan', keywords: ['japan', 'tokyo', 'jsdf', 'abe'], lat: 36.0, lon: 138.0 },
  { country: 'North Korea', keywords: ['north korea', 'pyongyang', 'kim jong', 'dprk'], lat: 40.0, lon: 127.5 },
  { country: 'South Korea', keywords: ['south korea', 'seoul', 'rok'], lat: 36.0, lon: 127.5 },
  // Europe
  { country: 'Ukraine', keywords: ['ukraine', 'kyiv', 'kiev', 'zelensky', 'donbas', 'crimea', 'donetsk'], lat: 49.0, lon: 31.0 },
  { country: 'Russia', keywords: ['russia', 'kremlin', 'putin', 'moscow', 'russian'], lat: 60.0, lon: 60.0 },
  { country: 'Germany', keywords: ['germany', 'berlin', 'scholz', 'bundeswehr'], lat: 51.0, lon: 10.0 },
  { country: 'France', keywords: ['france', 'paris', 'macron'], lat: 47.0, lon: 2.0 },
  { country: 'UK', keywords: ['uk ', 'britain', 'london', 'british'], lat: 52.0, lon: -1.0 },
  { country: 'Poland', keywords: ['poland', 'warsaw'], lat: 52.0, lon: 19.0 },
  { country: 'Belarus', keywords: ['belarus', 'lukashenko', 'minsk'], lat: 53.7, lon: 27.9 },
  // South Asia
  { country: 'India', keywords: ['india', 'modi', 'new delhi', 'mumbai', 'indian'], lat: 22.0, lon: 78.0 },
  { country: 'Pakistan', keywords: ['pakistan', 'islamabad', 'karachi'], lat: 30.0, lon: 69.0 },
  { country: 'Afghanistan', keywords: ['afghanistan', 'kabul', 'taliban'], lat: 33.0, lon: 66.0 },
  // Southeast Asia
  { country: 'Myanmar', keywords: ['myanmar', 'burma', 'yangon'], lat: 20.0, lon: 96.0 },
  { country: 'Philippines', keywords: ['philippines', 'manila'], lat: 13.0, lon: 122.0 },
  { country: 'Indonesia', keywords: ['indonesia', 'jakarta'], lat: -2.0, lon: 118.0 },
  { country: 'Vietnam', keywords: ['vietnam', 'hanoi'], lat: 16.0, lon: 108.0 },
  { country: 'Thailand', keywords: ['thailand', 'bangkok'], lat: 15.0, lon: 101.0 },
  // Africa
  { country: 'Sudan', keywords: ['sudan', 'khartoum'], lat: 15.5, lon: 32.5 },
  { country: 'Ethiopia', keywords: ['ethiopia', 'addis ababa'], lat: 9.0, lon: 38.7 },
  { country: 'Nigeria', keywords: ['nigeria', 'lagos', 'abuja'], lat: 9.0, lon: 8.0 },
  { country: 'Somalia', keywords: ['somalia', 'mogadishu', 'al-shabaab'], lat: 5.0, lon: 46.0 },
  { country: 'Libya', keywords: ['libya', 'tripoli'], lat: 27.0, lon: 17.0 },
  { country: 'DR Congo', keywords: ['congo', 'kinshasa'], lat: -3.0, lon: 23.5 },
  { country: 'Mali', keywords: ['mali', 'bamako'], lat: 17.0, lon: -4.0 },
  { country: 'Niger', keywords: ['niger', 'niamey'], lat: 17.6, lon: 8.0 },
  // Americas
  { country: 'Venezuela', keywords: ['venezuela', 'caracas', 'maduro'], lat: 8.0, lon: -66.0 },
  { country: 'Colombia', keywords: ['colombia', 'bogota'], lat: 4.6, lon: -74.0 },
  { country: 'Mexico', keywords: ['mexico', 'mexican', 'cartel', 'mexico city'], lat: 23.6, lon: -102.5 },
  { country: 'Brazil', keywords: ['brazil', 'brasilia', 'lula'], lat: -14.0, lon: -51.0 },
  { country: 'Argentina', keywords: ['argentina', 'buenos aires'], lat: -34.0, lon: -64.0 },
  { country: 'Cuba', keywords: ['cuba', 'havana'], lat: 22.0, lon: -79.5 },
  { country: 'Haiti', keywords: ['haiti', 'port-au-prince'], lat: 18.9, lon: -72.3 },
  // Central Asia / Caucasus
  { country: 'Georgia', keywords: ['georgia', 'tbilisi'], lat: 42.0, lon: 43.5 },
  { country: 'Armenia', keywords: ['armenia', 'yerevan'], lat: 40.0, lon: 45.0 },
  { country: 'Azerbaijan', keywords: ['azerbaijan', 'baku'], lat: 40.1, lon: 47.5 },
]

/** Detect specific country from article text. Returns {country, lat, lon} or null. */
function detectCountry(text: string): { country: string; lat: number; lon: number } | null {
  const lower = text.toLowerCase()
  for (const rule of COUNTRY_COORDS) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return { country: rule.country, lat: rule.lat, lon: rule.lon }
      }
    }
  }
  return null
}

/** Detect region from article title + content text */
function detectRegion(text: string): string | null {
  const lower = text.toLowerCase()
  for (const rule of REGION_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.region
    }
  }
  return null
}

// ── Entity extraction (simple keyword-based) ──

const ENTITY_PATTERNS: Record<string, string[]> = {
  // People
  person: [
    'biden', 'trump', 'putin', 'xi jinping', 'zelensky', 'netanyahu', 'erdogan',
    'macron', 'scholz', 'modi', 'kim jong un', 'khamenei'
  ],
  // Organizations
  organization: [
    'nato', 'un ', 'united nations', 'eu ', 'european union', 'pentagon',
    'cia', 'fbi', 'mi6', ' Mossad', 'isis', 'al-qaeda', 'hezbollah', 'hamas',
    'houthi', 'red cross', 'who'
  ],
  // Military
  military: [
    'military', 'army', 'navy', 'air force', 'missile', 'drone', 'strike',
    'airstrike', 'warship', 'submarine', 'fighter jet', 'troop', 'battalion',
    'aircraft carrier', 'bomber', 'missile defense'
  ],
  // Technology
  technology: [
    'cyber', 'ai ', 'artificial intelligence', 'satellite', '5g', 'quantum',
    'semiconductor', 'chip', 'hack', 'ransomware', 'malware', 'surveillance'
  ],
  // Energy
  energy: [
    'oil', 'gas', 'pipeline', 'nuclear', 'lng', 'opec', 'crude', 'petroleum',
    'refinery', 'uranium', 'energy', 'solar', 'wind farm'
  ]
}

/** Extract named entities (keyword matching) from text */
function extractEntities(text: string): string[] {
  const lower = text.toLowerCase()
  const entities: string[] = []

  for (const [, keywords] of Object.entries(ENTITY_PATTERNS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        // Normalize: trim, title case for display
        entities.push(kw.trim())
      }
    }
  }

  // Deduplicate
  return [...new Set(entities)]
}

// ── Topic extraction ──

const TOPIC_KEYWORDS: Record<string, string[]> = {
  'conflict': ['war', 'conflict', 'attack', 'strike', 'bomb', 'invasion', 'offensive', 'ceasefire'],
  'diplomacy': ['diplomacy', 'summit', 'treaty', 'negotiation', 'peace talks', 'sanctions', 'embargo'],
  'military': ['military', 'troop', 'navy', 'army', 'air force', 'exercise', 'deployment', 'bases'],
  'cyber': ['cyber', 'hack', 'ransomware', 'data breach', 'espionage', 'malware'],
  'economy': ['sanctions', 'trade', 'tariff', 'inflation', 'recession', 'gdp', 'currency'],
  'energy': ['oil', 'gas', 'pipeline', 'nuclear', 'energy', 'opec', 'lng'],
  'maritime': ['ship', 'vessel', 'port', 'canal', 'naval', 'maritime', 'chokepoint', 'strait'],
  'aviation': ['flight', 'aviation', 'aircraft', 'airline', 'airspace', 'airport'],
  'humanitarian': ['refugee', 'humanitarian', 'aid', 'displaced', 'famine', 'crisis'],
  'nuclear': ['nuclear', 'uranium', 'enrichment', 'reactor', 'radiation', 'iaea'],
  'intelligence': ['intelligence', 'spy', 'espionage', 'surveillance', 'classified', 'leak']
}

/** Detect topics from text */
function extractTopics(text: string): string[] {
  const lower = text.toLowerCase()
  const topics: string[] = []

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        topics.push(topic)
        break // one match per topic is enough
      }
    }
  }

  return topics
}

// ── Sentiment (basic heuristic) ──

const NEGATIVE_WORDS = [
  'attack', 'war', 'crisis', 'threat', 'danger', 'dead', 'killed', 'destroyed',
  'conflict', 'explosion', 'collapse', 'crash', 'emergency', 'catastrophe',
  'terror', 'invasion', 'sanctions', 'fail', 'loss'
]

const POSITIVE_WORDS = [
  'peace', 'agreement', 'deal', 'progress', 'growth', 'success', 'win',
  'recovery', 'aid', 'rescue', 'cooperation', 'advance', 'breakthrough',
  'stability', 'improve', 'hope'
]

/** Very simple sentiment score: -1.0 to +1.0 */
function estimateSentiment(text: string): number | null {
  if (!text) return null
  const lower = text.toLowerCase()
  let score = 0
  for (const w of NEGATIVE_WORDS) {
    if (lower.includes(w)) score -= 1
  }
  for (const w of POSITIVE_WORDS) {
    if (lower.includes(w)) score += 1
  }
  // Normalize to -1..1 range
  if (score === 0) return 0
  return Math.max(-1, Math.min(1, score / 3))
}

// ── Translation ──

/**
 * Detect if text is non-English and translate to English using the configured LLM.
 * Returns the original text if it appears to be English or if translation fails.
 * Uses a fast, cheap call with minimal tokens.
 */
async function translateIfNeeded(text: string): Promise<string> {
  if (!text || text.length < 10) return text

  // Detect language using franc (ISO 639-3 codes: 'eng' = English, 'und' = undetermined)
  const detectedLang = franc(text, { minLength: 10 })

  // If English detected, skip translation
  if (detectedLang === 'eng') return text

  // If language is undetermined, skip (be safe)
  if (detectedLang === 'und') return text

  // Non-English detected, translate via LLM
  try {
    const { chat } = await import('../rag/llm')

    const result = await chat(
      [
        {
          role: 'system',
          content: withWorldContext('You are a translator. Translate the following text to English. If it is already in English, return it unchanged. Output ONLY the translated text, nothing else. No explanations, no quotes.')
        },
        {
          role: 'user',
          content: text
        }
      ],
        { temperature: 0.1 }
    )

    const translated = result.text?.trim()

    // Sanity check: translation shouldn't be empty or wildly different in length
    if (translated && translated.length > text.length * 0.3) {
      console.log(`[Processor] Translated (${detectedLang}): "${text.substring(0, 50)}..." → "${translated.substring(0, 50)}..."`)
      return translated
    }

    return text  // Fallback to original
  } catch (err) {
    // Translation failure is non-critical; just use original
    console.log('[Processor] Translation failed, using original:', err instanceof Error ? err.message : String(err))
    return text
  }
}

// ── Deduplication ──

/** URL-based deduplication cache (in-memory, recent URLs only) */
const recentUrls = new Set<string>()
const MAX_URL_CACHE = 5000

/** Check if we've already seen this URL in this session */
function isDuplicate(url: string | null): boolean {
  if (!url) return false
  return recentUrls.has(url)
}

/** Mark a URL as seen */
function markSeen(url: string | null): void {
  if (!url) return
  if (recentUrls.size >= MAX_URL_CACHE) {
    // Evict oldest entries (simple approach: clear half)
    const entries = [...recentUrls]
    recentUrls.clear()
    for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
      recentUrls.add(entries[i])
    }
  }
  recentUrls.add(url)
}

// ── Title-based intel item deduplication ──

/** In-memory cache of recent intel item titles for fast dedup */
const recentIntelTitles: { normalized: string; region: string | null }[] = []
const MAX_INTEL_TITLE_CACHE = 200

/**
 * Normalize a title for comparison: lowercase, strip punctuation, collapse whitespace.
 * Handles variations like "Trump widens threat..." vs "LIVE: Trump Expands Iran Threat..."
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')   // collapse whitespace
    .trim()
}

/**
 * Calculate word overlap ratio between two normalized titles.
 * Returns a value between 0 and 1 (1 = 100% overlap).
 */
function wordOverlap(titleA: string, titleB: string): number {
  const wordsA = new Set(titleA.split(' ').filter(Boolean))
  const wordsB = new Set(titleB.split(' ').filter(Boolean))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let overlap = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++
  }

  // Use the smaller set as denominator for more forgiving matching
  const denominator = Math.min(wordsA.size, wordsB.size)
  return overlap / denominator
}

/**
 * Check if an intel item with a similar title already exists.
 * Compares against recent intel items using word overlap + region match.
 *
 * Returns true if a duplicate is found (>75% word overlap AND same region).
 */
function isDuplicateIntelItem(title: string, region: string | null): boolean {
  if (!title) return false

  const normalized = normalizeTitle(title)

  // Check in-memory cache first (fast path)
  for (const cached of recentIntelTitles) {
    // Same region check (both null counts as match too — no region detected)
    const sameRegion = region === cached.region
    if (!sameRegion) continue

    const overlap = wordOverlap(normalized, cached.normalized)
    if (overlap > 0.75) return true
  }

  // On first calls, cache may be empty — load from DB
  if (recentIntelTitles.length === 0) {
    try {
      const recentItems = getRecentIntelItems(200, 0)
      for (const item of recentItems) {
        recentIntelTitles.push({
          normalized: normalizeTitle(item.title),
          region: item.region
        })
      }
      // Re-check against freshly loaded cache
      for (const cached of recentIntelTitles) {
        const sameRegion = region === cached.region
        if (!sameRegion) continue
        const overlap = wordOverlap(normalized, cached.normalized)
        if (overlap > 0.75) return true
      }
    } catch (err) {
      console.warn('[processor] Could not load recent intel items for dedup:', err)
    }
  }

  return false
}

/** Add a title to the intel dedup cache */
function markIntelTitleSeen(title: string, region: string | null): void {
  if (recentIntelTitles.length >= MAX_INTEL_TITLE_CACHE) {
    // Evict oldest half
    recentIntelTitles.splice(0, Math.floor(recentIntelTitles.length / 2))
  }
  recentIntelTitles.push({
    normalized: normalizeTitle(title),
    region
  })
}

/** Check if an article is relevant to intelligence topics. */
const INTEL_RELEVANCE_WORDS = [
  // Conflict & military
  'military', 'army', 'navy', 'air force', 'missile', 'drone', 'strike', 'airstrike',
  'war', 'warfare', 'combat', 'troop', 'soldier', 'battalion', 'regiment', 'division',
  'warship', 'submarine', 'carrier', 'fleet', 'vessel', 'naval', 'fleet',
  'invasion', 'occupation', 'offensive', 'defensive', 'ceasefire', 'truce',
  'attack', 'bomb', 'bombing', 'explosion', 'shelling', 'artillery',
  'weapon', 'weapons', 'arms', 'arsenal', 'nuclear', 'radiological',
  'exercise', 'maneuver', 'manoeuvre', 'drill', 'deployment', 'base',
  // Security & intelligence
  'security', 'intelligence', 'spy', 'espionage', 'surveillance', 'classified',
  'cia', 'fsb', 'mi6', 'mossad', 'intelligence agency', 'operative',
  'terror', 'terrorist', 'terrorism', 'insurgent', 'militant', 'extremist',
  'cyber', 'hack', 'ransomware', 'data breach',
  // Diplomacy & sanctions
  'diplomacy', 'summit', 'treaty', 'sanctions', 'embargo', 'negotiation',
  'peace talks', 'peace deal', 'foreign minister', 'ambassador',
  // Geopolitical
  'nato', 'alliance', 'pivot', 'sovereignty', 'territorial', 'border',
  'annexation', 'separatist', 'rebellion', 'coup', 'regime',
  // Crisis
  'crisis', 'emergency', 'disaster', 'humanitarian', 'refugee',
  'evacuation', 'conflict zone', 'war zone', 'frontline',
  // Energy & strategic
  'oil', 'gas', 'pipeline', 'nuclear energy', 'uranium', 'strait',
  'chokepoint', 'energy', 'opec', 'lng',
  // Aviation & maritime
  'aviation', 'flight', 'aircraft', 'airspace', 'intercept',
  'port', 'harbor', 'shipping', 'maritime', 'corridor'
]

/** Check if article text contains intel-relevant keywords */
function isIntelRelevantArticle(text: string): boolean {
  const lower = text.toLowerCase()
  for (const word of INTEL_RELEVANCE_WORDS) {
    if (lower.includes(word)) return true
  }
  return false
}

// ── Main processor ──

/**
 * Process a batch of raw articles: dedup, extract entities/topics/region,
 * estimate sentiment, insert into SQLite, and embed into ChromaDB vector store.
 */
export async function processArticles(raw: RawArticle[]): Promise<IngestionResult> {
  const startTime = Date.now()
  let inserted = 0
  let duplicates = 0
  let errors = 0
  const insertedArticles: Article[] = []

  for (const article of raw) {
    try {
      // Dedup by URL
      if (isDuplicate(article.url)) {
        duplicates++
        continue
      }

      // Combine title + content for analysis
      const text = [article.title, article.content].filter(Boolean).join(' ')

      // Intel relevance filter: skip articles that aren't relevant
      // Non-English sources may include general news; only keep intel-related content
      if (article.language && article.language !== 'en') {
        const isIntelRelevant = isIntelRelevantArticle(text)
        if (!isIntelRelevant) {
          console.log(`[processor] Skipping non-intel ${article.language} article: "${(article.title || '').substring(0, 60)}"`)
          duplicates++
          continue
        }
      }

      // Extract metadata
      const region = detectRegion(text)
      const entities = extractEntities(text)
      const topics = extractTopics(text)
      const sentiment = estimateSentiment(text)

      // Determine language — use source tag if provided, else default 'en'
      const language = article.language || 'en'
      const isNonEnglish = language !== 'en'

      // Build insert payload
      const insertData: InsertArticle = {
        source: article.source,
        title: article.title,
        content: article.content,
        url: article.url,
        published_at: article.publishedAt,
        sentiment,
        entities,
        region,
        topics,
        language,
        // For non-English articles, store original text; translation fills in later
        title_original: isNonEnglish ? article.title : null,
        content_original: isNonEnglish ? article.content : null
      }

      const saved = insertArticle(insertData)
      markSeen(article.url)
      insertedArticles.push(saved)
      inserted++

      // Promote significant articles to intel items
      await promoteToIntelItem(saved)
    } catch (err) {
      console.error('[processor] Error processing article:', err)
      errors++
    }
  }

  // Embed newly inserted articles into ChromaDB (non-blocking)
  if (insertedArticles.length > 0) {
    embedInsertedArticles(insertedArticles).catch((err) => {
      console.warn('[processor] Vector embedding failed (non-critical):', err)
    })
  }

  return {
    source: 'multi',
    fetched: raw.length,
    inserted,
    duplicates,
    errors,
    elapsedMs: Date.now() - startTime
  }
}

/**
 * Embed a batch of newly inserted articles into ChromaDB.
 * Runs asynchronously — failures are logged but don't block ingestion.
 */
async function embedInsertedArticles(articles: Article[]): Promise<void> {
  for (const article of articles) {
    try {
      const text = [article.title, article.content].filter(Boolean).join(' ')
      if (!text.trim()) continue

      await embedAndStore('articles', {
        sourceId: String(article.id),
        sourceType: 'news',
        text,
        timestamp: article.published_at ?? new Date().toISOString(),
        region: article.region,
        feed: article.source
      })
    } catch (err) {
      console.warn(
        `[processor] Failed to embed article ${article.id}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}

/**
 * Bootstrap the dedup cache by loading recent URLs from DB.
 * Call once at startup.
 */
export function bootstrapDedupCache(): void {
  try {
    const recent = getArticles(500, 0)
    for (const a of recent) {
      if (a.url) recentUrls.add(a.url)
    }
    console.log(`[processor] Dedup cache bootstrapped with ${recentUrls.size} URLs`)
  } catch (err) {
    console.warn('[processor] Could not bootstrap dedup cache:', err)
  }
}

// ── Article → Intel Item promotion ──

/** Keywords that indicate high-severity content */
const ALERT_KEYWORDS = [
  'war', 'invasion', 'attack', 'strike', 'bomb', 'explosion', 'missile',
  'nuclear', 'terror', 'coup', 'assassination', 'massacre', 'offensive',
  'airstrike', 'cyberattack', 'ceasefire violation', 'escalation'
]

const WATCH_KEYWORDS = [
  'military', 'troop', 'deployment', 'sanctions', 'embargo', 'naval',
  'drill', 'exercise', 'tension', 'warning', 'threat', 'border',
  'dispute', 'escalat', 'crackdown', 'crisis', 'conflict', 'emergency'
]

/**
 * Promote a significant article to an intel item with appropriate tier.
 *
 * Tier logic:
 *   ALERT  — negative sentiment ≤ -0.5 AND alert keywords present
 *   WATCH  — negative sentiment OR watch keywords present
 *   CONTEXT — everything else (region or topic detected)
 *
 * Only promotes articles with detected region or topics (skip noise).
 */
async function promoteToIntelItem(article: Article): Promise<void> {
  const text = [article.title, article.content].filter(Boolean).join(' ').toLowerCase()

  // Skip articles without region or topics — likely noise
  if (!article.region && (!article.topics || article.topics.length === 0)) return

  // Translate title and summary if they appear to be non-English
  const articleTitle = await translateIfNeeded(article.title ?? 'Untitled Article')

  // Title-based dedup: skip if a similar intel item already exists
  if (isDuplicateIntelItem(articleTitle, article.region)) {
    console.log(`[processor] Skipping duplicate intel item: "${articleTitle}"`)
    return
  }

  const hasAlert = ALERT_KEYWORDS.some((kw) => text.includes(kw))
  const hasWatch = WATCH_KEYWORDS.some((kw) => text.includes(kw))
  const sentiment = article.sentiment ?? 0
  const isNegative = sentiment <= -0.3

  let tier: IntelTier
  let confidence: number

  if (hasAlert && isNegative) {
    tier = 'ALERT'
    confidence = Math.min(0.95, 0.7 + Math.abs(sentiment) * 0.2)
  } else if (hasWatch || (isNegative && hasAlert)) {
    tier = 'WATCH'
    confidence = Math.min(0.85, 0.5 + Math.abs(sentiment) * 0.2)
  } else {
    tier = 'CONTEXT'
    confidence = 0.4 + (article.region ? 0.1 : 0) + (article.topics?.length ?? 0) * 0.05
  }

  // Build a short summary (first 300 chars of content), translate if needed
  const rawSummary = article.content
    ? article.content.length > 300
      ? article.content.slice(0, 300) + '…'
      : article.content
    : null
  const summary = rawSummary ? await translateIfNeeded(rawSummary) : null

  // Detect country for more precise marker placement
  const countryInfo = detectCountry(text)

  try {
    insertIntelItem({
      tier,
      title: articleTitle,
      summary,
      analysis: null, // LLM-generated analysis comes later via RAG pipeline
      confidence: Math.round(confidence * 100) / 100,
      sources: article.source ? [article.source] : [],
      region: article.region,
      categories: article.topics ?? [],
      updated_at: null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // news: 24h TTL
      latitude: countryInfo?.lat ?? null,
      longitude: countryInfo?.lon ?? null
    })
    // Mark this title as seen so future duplicates are caught
    markIntelTitleSeen(articleTitle, article.region)
  } catch (err) {
    // Non-critical: don't fail the whole batch if one intel item fails
    console.warn('[processor] Failed to promote article to intel item:', err)
  }
}

/**
 * One-time cleanup: remove duplicate intel items already in the database.
 *
 * Loads all intel items, groups by title similarity (>75% word overlap + same region),
 * keeps the oldest in each group, deletes the rest.
 *
 * Call once at startup (after DB init) to clean existing duplicates.
 */
export function dedupExistingIntelItems(): { total: number; removed: number; kept: number } {
  const totalCount = getIntelItemCount()
  console.log(`[processor] Dedup cleanup: scanning ${totalCount} intel items...`)

  // Load all items ordered by created_at ASC (oldest first — these are kept)
  const allItems = getRecentIntelItems(totalCount, 0)

  // Build normalized titles
  const normalized = allItems.map((item) => ({
    id: item.id,
    title: item.title,
    normalizedTitle: normalizeTitle(item.title),
    region: item.region
  }))

  const idsToDelete: string[] = []
  const kept: { normalizedTitle: string; region: string | null }[] = []

  for (const item of normalized) {
    let isDuplicate = false

    for (const existing of kept) {
      if (item.region !== existing.region) continue

      const overlap = wordOverlap(item.normalizedTitle, existing.normalizedTitle)
      if (overlap > 0.75) {
        isDuplicate = true
        idsToDelete.push(item.id)
        break
      }
    }

    if (!isDuplicate) {
      kept.push({ normalizedTitle: item.normalizedTitle, region: item.region })
    }
  }

  if (idsToDelete.length === 0) {
    console.log('[processor] Dedup cleanup: no duplicates found.')
    return { total: totalCount, removed: 0, kept: totalCount }
  }

  // Delete duplicates
  let deleted = 0
  for (const id of idsToDelete) {
    if (deleteIntelItem(id)) deleted++
  }

  console.log(
    `[processor] Dedup cleanup: removed ${deleted} duplicates, ${kept.length} unique items remaining.`
  )

  // Also populate the in-memory cache with the surviving items
  recentIntelTitles.length = 0
  // Re-load recent items after cleanup to refresh cache
  const survivors = getRecentIntelItems(MAX_INTEL_TITLE_CACHE, 0)
  for (const item of survivors) {
    recentIntelTitles.push({
      normalized: normalizeTitle(item.title),
      region: item.region
    })
  }

  return { total: totalCount, removed: deleted, kept: kept.length }
}

/** Get stats about the processor state */
export function getProcessorStats(): { dedupCacheSize: number; dbArticleCount: number } {
  return {
    dedupCacheSize: recentUrls.size,
    dbArticleCount: getArticleCount()
  }
}
