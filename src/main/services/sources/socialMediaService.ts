/**
 * Social Media Signals Service (Phase 5A)
 *
 * Fetches posts from Reddit (public JSON API) and BlueSky (public API).
 * Both are free, no API keys or accounts required.
 * Posts are stored in SQLite `social_posts` table for the intel pipeline.
 */

import { getDatabase } from '../storage/database'
import { loadSettings } from '../../ipc/settings.handlers'
import { insertIntelItem } from '../storage/dbService'
import { embedAndStore } from '../storage/vectordb'

// ── Types ──────────────────────────────────────────────────────────────────

interface RedditPostRaw {
  id: string
  title: string
  selftext: string
  author: string
  permalink: string
  url: string
  score: number
  num_comments: number
  created_utc: number
  stickied: boolean
  over_18: boolean
}

interface BlueSkyPostRaw {
  uri: string
  cid: string
  author: { handle: string; displayName?: string }
  record: { text: string; createdAt: string }
  likeCount: number
  replyCount: number
  repostCount: number
  indexedAt: string
}

export interface SocialPost {
  id: string
  source: 'reddit' | 'bluesky'
  source_detail: string
  title: string | null
  body: string
  author: string
  url: string
  score: number
  comments: number
  posted_at: string
  region: string | null
}

export interface SocialStats {
  reddit: { lastFetch: string | null; postCount: number; enabled: boolean }
  bluesky: { lastFetch: string | null; postCount: number; enabled: boolean }
  totalPosts: number
  analyzedPosts: number
}

// ── Configuration ──────────────────────────────────────────────────────────

const REDDIT_SUBREDDITS = [
  'geopolitics',
  'CredibleDefense',
  'LessCredibleDefence',
  'OSINT',
  'Military',
  'Navy',
  'worldnews',
  'combatfootage'
]

const BLUESKY_QUERIES = [
  'military movement',
  'naval deployment',
  'aircraft carrier',
  'OSINT',
  'conflict escalation',
  'military exercise',
  'strait hormuz OR south china sea OR taiwan strait'
]

/** Military/geopolitical keywords for pre-filtering noise */
const RELEVANCE_KEYWORDS: RegExp = /\b(milita|nav[yi]|army|air ?force|naval|fleet|carrier|destroyer|frigate|submarine|war|conflict|geopoli|defen[cs]e|intel|osint|deploy|exercis|missile|nuclear|nato|strait|choke|escalat|combat|troop|invas|border|incurs|patrol|sortie|bomb|strike|drone|surveillanc|recon|satellite|warship|battlegroup|task ?force|amphib|airlift|tanker|hawk|alert|threat|tension|crisi|sanction|embarg|hormuz|taiwan|south china|crimea|syria|ukrain|russia|china|iran|korea|israel|gaza|suez|malacca|bab|mandeb)\b/i

/** Region keyword detection map */
const REGION_KEYWORDS: Array<{ region: string; pattern: RegExp }> = [
  { region: 'Strait of Hormuz', pattern: /\b(hormuz|persian gulf|gulf of oman|iran|iranian|strait of hormuz)\b/i },
  { region: 'South China Sea', pattern: /\b(south china sea|spratly|paracel|xisha|nansha)\b/i },
  { region: 'Taiwan Strait', pattern: /\b(taiwan|taipei|formosa|taiwan strait)\b/i },
  { region: 'Suez Canal', pattern: /\b(suez|red sea|gulf of aden|bab.al.mandeb|yemen|houthi)\b/i },
  { region: 'Strait of Malacca', pattern: /\b(malacca|singapore strait|lombok|sunda strait)\b/i },
  { region: 'Korean Peninsula', pattern: /\b(korea|pyongyang|seoul|dmz|north korea|south korea)\b/i },
  { region: 'Eastern Mediterranean', pattern: /\b(eastern medit|cyprus|crete|syria|lebanon|israel|gaza|libya)\b/i },
  { region: 'Black Sea', pattern: /\b(black sea|crimea|crimean|sevastopol|bosporus|dardanelles)\b/i },
  { region: 'Baltic Sea', pattern: /\b(baltic|gotland|kaliningrad|gulf of finland)\b/i },
  { region: 'Arctic', pattern: /\b(arctic|north pole|northern sea route|nsr|barents|svalbard)\b/i },
  { region: 'East Africa', pattern: /\b(djibouti|somali|gulf of aden|horn of africa|bab.al.mandeb)\b/i },
  { region: 'Indo-Pacific', pattern: /\b(indo.pacific|philippine sea|east china sea|okinawa|guam)\b/i },
  { region: 'Europe', pattern: /\b(nato|europe|ukraine|russia|belarus|balkan|poland|baltic)\b/i },
  { region: 'Middle East', pattern: /\b(iran|iraq|syria|israel|gaza|jordan|lebanon|saudi)\b/i }
]

// ── Region Detection ──────────────────────────────────────────────────────

function detectRegion(text: string): string | null {
  for (const { region, pattern } of REGION_KEYWORDS) {
    if (pattern.test(text)) return region
  }
  return null
}

// ── Reddit Fetcher ─────────────────────────────────────────────────────────

async function fetchReddit(subreddit: string): Promise<SocialPost[]> {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'IntelBoard/1.0' },
      signal: AbortSignal.timeout(15000)
    })

    if (!resp.ok) {
      console.warn(`[socialMedia] Reddit r/${subreddit} returned HTTP ${resp.status}`)
      return []
    }

    const body = (await resp.json()) as {
      data: { children: Array<{ kind: string; data: RedditPostRaw }> }
    }

    const now = Date.now()
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000

    const posts: SocialPost[] = []
    for (const child of body.data.children) {
      const d = child.data

      // Skip stickied/mod posts
      if (d.stickied) continue
      // Skip NSFW
      if (d.over_18) continue
      // Skip low-score noise (Reddit)
      if (d.score < 10) continue
      // Skip posts older than 24 hours
      const postedMs = d.created_utc * 1000
      if (postedMs < twentyFourHoursAgo) continue

      const fullText = `${d.title} ${d.selftext || ''}`
      // Relevance pre-filter
      if (!RELEVANCE_KEYWORDS.test(fullText)) continue

      posts.push({
        id: `reddit_${d.id}`,
        source: 'reddit',
        source_detail: subreddit,
        title: d.title,
        body: d.selftext || '',
        author: d.author,
        url: `https://reddit.com${d.permalink}`,
        score: d.score,
        comments: d.num_comments,
        posted_at: new Date(postedMs).toISOString(),
        region: detectRegion(fullText)
      })
    }

    return posts
  } catch (err) {
    console.warn(`[socialMedia] Reddit r/${subreddit} fetch failed:`, err)
    return []
  }
}

// ── BlueSky Fetcher ────────────────────────────────────────────────────────

async function fetchBlueSky(query: string): Promise<SocialPost[]> {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=25`
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000)
    })

    if (!resp.ok) {
      console.warn(`[socialMedia] BlueSky "${query}" returned HTTP ${resp.status}`)
      return []
    }

    const body = (await resp.json()) as { posts: BlueSkyPostRaw[] }

    const now = Date.now()
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000

    const posts: SocialPost[] = []
    for (const post of body.posts) {
      const text = post.record?.text || ''
      // Skip low engagement noise (BlueSky)
      if ((post.likeCount || 0) < 5) continue
      // Skip posts older than 24 hours
      const postedMs = new Date(post.indexedAt || post.record?.createdAt).getTime()
      if (postedMs < twentyFourHoursAgo) continue

      // Relevance pre-filter
      if (!RELEVANCE_KEYWORDS.test(text)) continue

      const uriTail = post.uri.split('/').pop() || ''
      posts.push({
        id: `bsky_${post.uri.replace(/[^a-zA-Z0-9]/g, '_')}`,
        source: 'bluesky',
        source_detail: query,
        title: null,
        body: text,
        author: post.author?.handle || '',
        url: `https://bsky.app/profile/${post.author?.handle}/post/${uriTail}`,
        score: post.likeCount || 0,
        comments: post.replyCount || 0,
        posted_at: new Date(postedMs).toISOString(),
        region: detectRegion(text)
      })
    }

    return posts
  } catch (err) {
    console.warn(`[socialMedia] BlueSky "${query}" fetch failed:`, err)
    return []
  }
}

// ── Database Operations ────────────────────────────────────────────────────

function insertPosts(posts: SocialPost[]): number {
  if (posts.length === 0) return 0

  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO social_posts
      (id, source, source_detail, title, body, author, url, score, comments, posted_at, region, analyzed)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `)

  let inserted = 0
  const insertMany = db.transaction(() => {
    for (const post of posts) {
      const result = stmt.run(
        post.id,
        post.source,
        post.source_detail,
        post.title,
        post.body,
        post.author,
        post.url,
        post.score,
        post.comments,
        post.posted_at,
        post.region
      )
      if (result.changes > 0) inserted++
    }
  })

  insertMany()
  return inserted
}

// ── Scheduling ─────────────────────────────────────────────────────────────

let redditTimer: ReturnType<typeof setTimeout> | null = null
let blueskyTimer: ReturnType<typeof setTimeout> | null = null

const DEFAULT_INTERVAL = 30 * 60 * 1000 // 30 min

export function startSocialMediaScheduler(): void {
  const settings = loadSettings()
  const redditEnabled = settings.socialMedia?.reddit?.enabled ?? true
  const blueskyEnabled = settings.socialMedia?.bluesky?.enabled ?? true

  if (redditEnabled) {
    const interval = settings.socialMedia?.reddit?.intervalMs || DEFAULT_INTERVAL
    // Initial fetch after 1 minute, then on schedule
    redditTimer = setTimeout(function redditTick(): void {
      pollReddit().catch(console.error)
      redditTimer = setTimeout(redditTick, interval)
    }, 60_000)
    console.log(`[socialMedia] Reddit scheduler started (${interval / 60000}min interval)`)
  }

  if (blueskyEnabled) {
    const interval = settings.socialMedia?.bluesky?.intervalMs || DEFAULT_INTERVAL
    // Stagger: initial fetch after 5 minutes, then on schedule
    blueskyTimer = setTimeout(function blueskyTick(): void {
      pollBlueSky().catch(console.error)
      blueskyTimer = setTimeout(blueskyTick, interval)
    }, 5 * 60_000)
    console.log(`[socialMedia] BlueSky scheduler started (${interval / 60000}min interval)`)
  }
}

export function stopSocialMediaScheduler(): void {
  if (redditTimer) {
    clearTimeout(redditTimer)
    redditTimer = null
  }
  if (blueskyTimer) {
    clearTimeout(blueskyTimer)
    blueskyTimer = null
  }
  console.log('[socialMedia] Scheduler stopped')
}

// ── Poll Cycle ─────────────────────────────────────────────────────────────

export async function pollReddit(): Promise<{ fetched: number; inserted: number }> {
  console.log('[socialMedia] Polling Reddit...')
  let totalFetched = 0
  let totalInserted = 0
  const allNewPosts: SocialPost[] = []

  for (const sub of REDDIT_SUBREDDITS) {
    const posts = await fetchReddit(sub)
    totalFetched += posts.length
    const inserted = insertPosts(posts)
    totalInserted += inserted
    // Collect posts that were actually new (not duplicates)
    if (inserted > 0) {
      allNewPosts.push(...posts.slice(0, inserted))
    }
    // Small delay between subreddits to be a good citizen
    await new Promise((r) => setTimeout(r, 500))
  }

  // Promote high-engagement posts to intel_items + embed for RAG
  if (allNewPosts.length > 0) {
    await promoteToIntelItems(allNewPosts).catch((err) =>
      console.warn('[socialMedia] Reddit promotion failed:', err)
    )
  }

  console.log(`[socialMedia] Reddit: fetched ${totalFetched}, new ${totalInserted}`)
  return { fetched: totalFetched, inserted: totalInserted }
}

export async function pollBlueSky(): Promise<{ fetched: number; inserted: number }> {
  console.log('[socialMedia] Polling BlueSky...')
  let totalFetched = 0
  let totalInserted = 0
  const allNewPosts: SocialPost[] = []

  for (const query of BLUESKY_QUERIES) {
    const posts = await fetchBlueSky(query)
    totalFetched += posts.length
    const inserted = insertPosts(posts)
    totalInserted += inserted
    if (inserted > 0) {
      allNewPosts.push(...posts.slice(0, inserted))
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  // Promote high-engagement posts to intel_items + embed for RAG
  if (allNewPosts.length > 0) {
    await promoteToIntelItems(allNewPosts).catch((err) =>
      console.warn('[socialMedia] BlueSky promotion failed:', err)
    )
  }

  console.log(`[socialMedia] BlueSky: fetched ${totalFetched}, new ${totalInserted}`)
  return { fetched: totalFetched, inserted: totalInserted }
}

// ── Query Helpers ──────────────────────────────────────────────────────────

export function getSocialPosts(
  limit: number = 50,
  source?: 'reddit' | 'bluesky',
  sourceDetail?: string
): SocialPost[] {
  const db = getDatabase()
  let sql = 'SELECT * FROM social_posts'
  const conditions: string[] = []
  const params: unknown[] = []

  if (source) {
    conditions.push('source = ?')
    params.push(source)
  }
  if (sourceDetail) {
    conditions.push('source_detail = ?')
    params.push(sourceDetail)
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }
  sql += ' ORDER BY posted_at DESC LIMIT ?'
  params.push(limit)

  return db.prepare(sql).all(...params) as SocialPost[]
}

export function getSocialStats(): SocialStats {
  const db = getDatabase()

  const redditCount = (
    db.prepare('SELECT COUNT(*) as c FROM social_posts WHERE source = ?').get('reddit') as { c: number }
  ).c
  const blueskyCount = (
    db.prepare('SELECT COUNT(*) as c FROM social_posts WHERE source = ?').get('bluesky') as { c: number }
  ).c
  const totalCount = (
    db.prepare('SELECT COUNT(*) as c FROM social_posts').get() as { c: number }
  ).c
  const analyzedCount = (
    db.prepare('SELECT COUNT(*) as c FROM social_posts WHERE analyzed = 1').get() as { c: number }
  ).c

  const redditLastFetch = (
    db
      .prepare('SELECT MAX(fetched_at) as d FROM social_posts WHERE source = ?')
      .get('reddit') as { d: string | null }
  ).d
  const blueskyLastFetch = (
    db
      .prepare('SELECT MAX(fetched_at) as d FROM social_posts WHERE source = ?')
      .get('bluesky') as { d: string | null }
  ).d

  const settings = loadSettings()

  return {
    reddit: {
      lastFetch: redditLastFetch,
      postCount: redditCount,
      enabled: settings.socialMedia?.reddit?.enabled ?? true
    },
    bluesky: {
      lastFetch: blueskyLastFetch,
      postCount: blueskyCount,
      enabled: settings.socialMedia?.bluesky?.enabled ?? true
    },
    totalPosts: totalCount,
    analyzedPosts: analyzedCount
  }
}

/** Mark posts as analyzed after AI processing */
export function markPostsAnalyzed(ids: string[]): void {
  if (ids.length === 0) return
  const db = getDatabase()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE social_posts SET analyzed = 1 WHERE id IN (${placeholders})`).run(...ids)
}

/** Get un-analyzed posts for AI processing */
export function getUnanalyzedPosts(limit: number = 25): SocialPost[] {
  const db = getDatabase()
  return db
    .prepare(
      'SELECT * FROM social_posts WHERE analyzed = 0 ORDER BY score DESC, posted_at DESC LIMIT ?'
    )
    .all(limit) as SocialPost[]
}

/** Delete posts older than N days */
export function deleteOldSocialPosts(daysOld: number): number {
  const db = getDatabase()
  const result = db.prepare(
    `DELETE FROM social_posts WHERE posted_at < datetime('now', '-${daysOld} days')`
  ).run()
  return result.changes
}

// ── Intel Feed Promotion ───────────────────────────────────────────────────

/**
 * Convert high-relevance social posts into intel_items.
 * Called after each poll cycle with the newly fetched posts.
 */
async function promoteToIntelItems(posts: SocialPost[]): Promise<void> {
  const promotedIds: string[] = []
  for (const post of posts) {
    // Only promote posts with decent engagement
    const minScore = post.source === 'reddit' ? 50 : 20
    if ((post.score ?? 0) < minScore) continue

    const sourceLabel =
      post.source === 'reddit' ? `Reddit r/${post.source_detail}` : `BlueSky`
    const sourceEntry = `${sourceLabel}: ${post.url}`

    // Skip if already promoted (sources is stored as JSON array, use LIKE)
    const db = getDatabase()
    const existing = db
      .prepare("SELECT id FROM intel_items WHERE sources LIKE ?")
      .get(`%${post.url}%`) as { id: string } | undefined
    if (existing) continue

    const tier =
      post.score >= (post.source === 'reddit' ? 200 : 100) ? 'WATCH' : 'CONTEXT'

    await insertIntelItem({
      tier,
      title: post.title || post.body.slice(0, 120),
      summary: post.body.slice(0, 500),
      analysis: null,
      confidence: 0.5, // Social media is lower confidence than news
      sources: [sourceEntry],
      region: post.region || null,
      categories: ['social', post.source],
      updated_at: null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // social: 24h TTL
      latitude: null,
      longitude: null
    })

    // Also embed into ChromaDB for RAG
    try {
      await embedAndStore('intel_items', {
        sourceId: post.id,
        sourceType: 'intel_item',
        text: `${post.title || ''} ${post.body}`.slice(0, 2000),
        timestamp: post.posted_at,
        region: post.region || null,
        feed: sourceLabel
      })
    } catch (err) {
      console.warn('[socialMedia] ChromaDB embedding failed:', err)
    }
    promotedIds.push(post.id)
  }
  // Mark all promoted posts as analyzed
  if (promotedIds.length > 0) {
    markPostsAnalyzed(promotedIds)
  }
}
