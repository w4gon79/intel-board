/**
 * RAG Retriever — high-level retrieval functions for the RAG pipeline.
 *
 * Combines vector similarity search with recency boosting and deduplication
 * to produce ranked context for LLM generation.
 */

import { vectorSearch, type SearchOptions } from '../storage/vectordb'
import type { RankedSearchResult, VectorSearchResult } from '../../../shared/types'

// ── Configuration ──

/** Half-life in hours for recency decay (newer = higher boost) */
const RECENCY_HALF_LIFE_HOURS = 24

/** Maximum boost factor for recency (1.0 = no boost, higher = more boost) */
const MAX_RECENCY_BOOST = 0.3

/** Minimum distance to consider a result relevant (cosine) */
const RELEVANCE_THRESHOLD = 1.0

// ── Types ──

export interface RetrieveOptions extends SearchOptions {
  /** Whether to apply recency boosting (default: true) */
  boostRecent?: boolean
  /** Deduplicate results from the same source document (default: true) */
  deduplicate?: boolean
}

// ── Public API ──

/**
 * Retrieve relevant document chunks for a given query.
 *
 * Performs vector similarity search, then applies:
 * 1. Relevance filtering (discard distant results)
 * 2. Recency boosting (prefer newer information)
 * 3. Source deduplication (keep best chunk per source)
 * 4. Relevance scoring (combined similarity + recency)
 *
 * @param query - Natural language query
 * @param options - Retrieval parameters
 * @returns Ranked search results with relevance scores
 */
export async function retrieve(
  query: string,
  options: RetrieveOptions = {}
): Promise<RankedSearchResult[]> {
  const {
    boostRecent = true,
    deduplicate = true,
    topK = 20,
    ...searchOptions
  } = options

  // Step 1: Vector similarity search
  const rawResults = await vectorSearch(query, { ...searchOptions, topK: topK * 2 })

  if (rawResults.length === 0) return []

  // Step 2: Filter by relevance threshold
  const relevant = rawResults.filter((r) => r.distance <= RELEVANCE_THRESHOLD)

  // Step 3: Apply recency boosting
  const boosted = boostRecent
    ? relevant.map((r) => applyRecencyBoost(r))
    : relevant.map((r) => ({ ...r, relevanceScore: 1 - r.distance, recencyBoost: 0 }))

  // Step 4: Deduplicate by source document (keep best chunk per source)
  const deduped = deduplicate ? deduplicateBySource(boosted) : boosted

  // Step 5: Sort by combined relevance score
  deduped.sort((a, b) => b.relevanceScore - a.relevanceScore)

  return deduped.slice(0, topK)
}

/**
 * Retrieve context formatted as a single text block for LLM injection.
 *
 * Returns a formatted string with numbered source references,
 * suitable for pasting into a prompt as RAG context.
 *
 * @param query - Natural language query
 * @param options - Retrieval parameters
 * @returns Formatted context string with source citations
 */
export async function retrieveContext(
  query: string,
  options: RetrieveOptions = {}
): Promise<{ context: string; sources: string[] }> {
  const results = await retrieve(query, { ...options, topK: options.topK ?? 10 })

  if (results.length === 0) {
    return { context: 'No relevant information found.', sources: [] }
  }

  const sources: string[] = []
  const contextParts: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const sourceRef = `[Source ${i + 1}]`

    // Build source citation
    const citation = buildCitation(result)
    sources.push(citation)

    // Add to context with source reference
    contextParts.push(
      `${sourceRef} ${result.text}\n` +
      `  — ${citation}`
    )
  }

  const context = contextParts.join('\n\n')
  return { context, sources }
}

// ── Internal Helpers ──

/**
 * Apply a recency boost to a search result.
 * Newer results get a small score bonus based on their age.
 */
function applyRecencyBoost(result: VectorSearchResult): RankedSearchResult {
  const now = Date.now()
  let timestamp: number

  try {
    timestamp = new Date(result.metadata.timestamp).getTime()
  } catch {
    timestamp = now
  }

  const ageHours = (now - timestamp) / (1000 * 60 * 60)
  const decay = Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS)
  const recencyBoost = decay * MAX_RECENCY_BOOST

  // Base relevance from cosine distance (invert: 0 distance = 1.0 relevance)
  const baseRelevance = Math.max(0, 1 - result.distance)

  return {
    ...result,
    relevanceScore: Math.min(1, baseRelevance + recencyBoost),
    recencyBoost
  }
}

/**
 * Deduplicate results from the same source document.
 * Keeps the highest-scoring chunk for each source_id.
 */
function deduplicateBySource(results: RankedSearchResult[]): RankedSearchResult[] {
  const bestBySource = new Map<string, RankedSearchResult>()

  for (const result of results) {
    const key = result.metadata.source_id
    const existing = bestBySource.get(key)
    if (!existing || result.relevanceScore > existing.relevanceScore) {
      bestBySource.set(key, result)
    }
  }

  return [...bestBySource.values()]
}

/**
 * Build a human-readable citation string from a search result.
 */
function buildCitation(result: RankedSearchResult): string {
  const parts: string[] = []
  const meta = result.metadata

  if (meta.source_type) {
    parts.push(meta.source_type)
  }
  if (meta.region) {
    parts.push(meta.region)
  }
  if (meta.feed) {
    parts.push(`via ${meta.feed}`)
  }
  if (meta.timestamp) {
    try {
      const date = new Date(meta.timestamp)
      parts.push(date.toISOString().split('T')[0])
    } catch {
      // Skip invalid date
    }
  }

  parts.push(`confidence: ${(1 - result.distance).toFixed(2)}`)

  return parts.join(' | ')
}