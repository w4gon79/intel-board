/**
 * RAG Pipeline Orchestrator — the full retrieve → generate → cite cycle.
 *
 * 1. Takes a user query + conversation history
 * 2. Retrieves relevant context chunks from ChromaDB
 * 3. Builds a grounded prompt with citation instructions
 * 4. Calls the LLM via Ollama
 * 5. Parses source citations from the response
 * 6. Returns a structured RAGResponse with citations
 */

import { retrieve, retrieveContext, type RetrieveOptions } from './retriever'
import { chat, getDefaultModel, listModels } from './llm'
import { withWorldContext } from '../../utils/worldContext'
import { getCSGContextString } from '../csg/csgService'
import { getTacticalEventsContext, getChokePointTrafficContext } from '../senseMakingEngine'
import { getDatabase } from '../storage/database'
import type {
  ChatMessage,
  RAGRequest,
  RAGResponse,
  SourceCitation,
  RankedSearchResult
} from '../../../shared/types'

// ── System Prompt Builder ──

const BASE_SYSTEM_PROMPT = `You are an intelligence analysis assistant with access to multiple real-time and archival data sources. Your job is FUSION ANALYSIS — synthesizing information across all available sources to provide the most complete picture.

## Intelligence Source Hierarchy

When answering questions, weigh ALL available data. Do not privilege one source type over another:

1. **REAL-TIME DATA** (primary intelligence):
   - Choke point traffic status (AIS + GFW satellite, updated continuously)
   - Naval group positions and tracks (CSG/ARG from USNI + AIS matching)
   - Aircraft detections (ADS-B, military classifications)
   - Vessel positions and classifications (AIS)

2. **ARCHIVAL INTELLIGENCE** (contextual depth):
   - News articles, scraped reports, GDELT events
   - Historical analysis and prior AI sense-making reports
   - Social media signals (Reddit, BlueSky) — treat these as unverified but useful for early indicators

## Analysis Rules

- When asked about a specific area or situation, ALWAYS report on ALL available data types for that area, not just the type that seems most relevant.
- If choke point data shows a disruption AND naval assets are positioned nearby, report BOTH and explain the correlation.
- If live data contradicts news reporting, trust the live data but note the discrepancy.
- If no news articles exist for a topic, DO NOT say "insufficient data." Instead, report what the live data shows. Absence of news coverage is not absence of intelligence.
- Cite specific data points: vessel counts, choke point status, carrier group names, aircraft types, confidence levels.
- When the situation is unclear, say so and explain which data sources conflict and why.
- When a brief request includes CONFIRMED tracking data (from map marker clicks), treat that data as verified intelligence. Do NOT say you cannot analyze it. Analyze directly from the provided tracking data, correlate with live tactical alerts and fleet posture, and provide your best intelligence assessment.
- Every factual claim from articles MUST reference its source using [Source N] notation (e.g., [Source 1], [Source 2]).
- Express uncertainty when appropriate. Use "high confidence", "moderate confidence", or "low confidence" to qualify your assessments.

## Response Format

- Start with a direct answer to the question
- Support with specific data points from multiple source types
- Note any conflicting signals between sources
- End with an assessment of confidence and what additional data would help

## When No Relevant Information Exists

If neither live data nor articles cover the topic, say: "I don't have sufficient information in my current intelligence database to answer that question. [Brief explanation of what data might help.]"

Do NOT make up information or use knowledge outside the provided context.`

/**
 * Build the full system prompt with live data positioned as PRIMARY intelligence,
 * followed by world context and the fusion analysis rules.
 */
function buildSystemPrompt(): string {
  let csgContext = 'No carrier group data available.'
  let tacticalContext = 'No recent tactical events.'
  let chokePointContext = 'No choke point traffic data available.'
  let recentAlerts = 'No recent alerts.'
  try {
    csgContext = getCSGContextString()
  } catch { /* DB not ready yet */ }
  try {
    tacticalContext = getTacticalEventsContext()
  } catch { /* DB not ready yet */ }
  try {
    chokePointContext = getChokePointTrafficContext()
  } catch { /* DB not ready yet */ }
  try {
    const db = getDatabase()
    const alerts = db.prepare(`
      SELECT tier, title, summary, categories, created_at
      FROM intel_items
      WHERE tier IN ('ALERT', 'WATCH')
        AND datetime(created_at) > datetime('now', '-24 hours')
      ORDER BY created_at DESC
      LIMIT 20
    `).all() as Array<{ tier: string; title: string; summary: string; categories: string; created_at: string }>

    if (alerts.length > 0) {
      recentAlerts = alerts.map(a =>
        `- [${a.tier}] ${a.title}${a.summary ? '\n  Summary: ' + a.summary.slice(0, 200) : ''}${a.categories ? '\n  Categories: ' + a.categories : ''}`
      ).join('\n')
    } else {
      recentAlerts = 'No active alerts in the last 24 hours.'
    }
  } catch { /* DB not ready yet */ }

  return `${withWorldContext(BASE_SYSTEM_PROMPT)}

## Current Intelligence Picture

The following real-time data is YOUR PRIMARY INTELLIGENCE for answering questions. Use it directly.

### Active Alerts (Last 24 Hours)
${recentAlerts}

### Choke Point Traffic Status
${chokePointContext}

### Fleet Posture (Carrier & Amphibious Groups)
${csgContext}

### Recent Tactical Events
${tacticalContext}`
}

// ── Public API ──

/**
 * Execute the full RAG pipeline: retrieve → generate → cite.
 *
 * @param request - The RAG request with query, history, and filters
 * @returns Structured response with answer and source citations
 */
export async function executeRAG(request: RAGRequest): Promise<RAGResponse> {
  const startTime = Date.now()
  const { query, history = [], collections, region, model } = request

  console.log(`[rag] Processing query: "${query.substring(0, 80)}..."`)

  // Step 1: Retrieve context
  const retrieveOptions: RetrieveOptions = {
    topK: 10,
    boostRecent: true,
    deduplicate: true
  }
  if (collections?.length) {
    retrieveOptions.collections = collections as RetrieveOptions['collections']
  }
  if (region) {
    retrieveOptions.region = region
  }

  // Use retrieveContext for formatted text + get raw results for citations
  const [contextResult, rawResults] = await Promise.all([
    retrieveContext(query, retrieveOptions),
    retrieve(query, { ...retrieveOptions, topK: 10 })
  ])

  const { context, sources: sourceLabels } = contextResult
  const chunksRetrieved = rawResults.length

  console.log(`[rag] Retrieved ${chunksRetrieved} chunks for context`)

  // Step 2: Build messages array
  const messages = buildMessages(query, history, context, sourceLabels)

  // Step 3: Generate response via LLM
  let llmResponse
  try {
    llmResponse = await chat(messages, {
      model: model || getDefaultModel(),
      temperature: 0.3,
      maxTokens: 2048
    })
  } catch (err) {
    console.error('[rag] LLM generation failed:', err instanceof Error ? err.message : String(err))
    return {
      answer:
        'I apologize, but I was unable to generate a response. The AI model may be unavailable. ' +
        'Please ensure Ollama is running with a chat model pulled (e.g., `ollama pull qwen2.5:3b`).',
      sources: [],
      model: model || getDefaultModel(),
      durationMs: Date.now() - startTime,
      chunksRetrieved
    }
  }

  // Step 4: Parse citations from response
  const citations = parseCitations(llmResponse.text, rawResults)

  console.log(
    `[rag] Generated response (${llmResponse.durationMs}ms, ${citations.length} citations, ` +
    `model: ${llmResponse.model}${llmResponse.fellBack ? ' (fallback)' : ''})`
  )

  return {
    answer: llmResponse.text,
    sources: citations,
    model: llmResponse.model,
    durationMs: Date.now() - startTime,
    chunksRetrieved
  }
}

/**
 * Quick analysis — generates a short summary for a specific topic.
 * Uses fewer chunks and lower token limit for speed.
 */
export async function quickAnalysis(
  topic: string,
  region?: string
): Promise<RAGResponse> {
  return executeRAG({
    query: `Provide a brief intelligence summary on: ${topic}`,
    history: [],
    region,
    model: getDefaultModel()
  })
}

/**
 * Get available chat models from Ollama.
 */
export async function getAvailableModels(): Promise<string[]> {
  return listModels()
}

// ── Internal Helpers ──

/**
 * Build the messages array for the LLM.
 */
function buildMessages(
  query: string,
  history: ChatMessage[],
  context: string,
  sourceLabels: string[]
): ChatMessage[] {
  const messages: ChatMessage[] = []

  // System prompt (with live CSG + tactical context injected)
  messages.push({
    role: 'system',
    content: buildSystemPrompt()
  })

  // Add context as a system-level user message
  const contextBlock = buildContextBlock(context, sourceLabels)
  messages.push({
    role: 'user',
    content: contextBlock
  })
  messages.push({
    role: 'assistant',
    content:
      'Understood. I have reviewed the Current Intelligence Picture (live choke point traffic, fleet posture, tactical events) and the Retrieved Intelligence (archival articles). ' +
      'I will perform fusion analysis across ALL data types — live data is primary, articles provide contextual depth. ' +
      'I will cite articles with [Source N] notation and reference specific live data points directly. I will not hallucinate information beyond what is provided.'
  })

  // Add conversation history
  for (const msg of history) {
    messages.push(msg)
  }

  // Add the current query
  messages.push({
    role: 'user',
    content: query
  })

  return messages
}

/**
 * Build the context block with source labels for injection into the prompt.
 */
function buildContextBlock(context: string, sourceLabels: string[]): string {
  const labelList = sourceLabels.length > 0
    ? sourceLabels.map((label, i) => `  [Source ${i + 1}] ${label}`).join('\n')
    : '  No sources available.'

  return `## Retrieved Intelligence (Archival Context)

The following articles and reports have been retrieved from the intelligence database. These provide contextual depth and historical background to supplement the real-time data in your Current Intelligence Picture above. Cite article sources using [Source N] notation. For live fleet/tactical data, reference specific assets and choke point statuses directly (e.g., "CSG-3 (Lincoln) currently in Arabian Sea", "Strait of Hormuz: OPEN, 12 vessels transiting").

### Source Reference Key
${labelList}

### Context
${context}

---
End of retrieved intelligence. Synthesize this archival context with the real-time data from your Current Intelligence Picture to provide a complete fusion analysis.`
}

/**
 * Parse [Source N] citations from the LLM response and match to results.
 */
function parseCitations(
  responseText: string,
  results: RankedSearchResult[]
): SourceCitation[] {
  const citations: SourceCitation[] = []
  const seen = new Set<number>()

  // Find all [Source N] references in the response
  const regex = /\[Source (\d+)\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(responseText)) !== null) {
    const index = parseInt(match[1], 10)

    if (seen.has(index)) continue
    seen.add(index)

    // Match to retrieved results (1-based index)
    const resultIndex = index - 1
    if (resultIndex >= 0 && resultIndex < results.length) {
      const result = results[resultIndex]
      citations.push({
        index,
        sourceType: result.metadata.source_type,
        sourceId: result.metadata.source_id,
        feed: result.metadata.feed,
        region: result.metadata.region,
        timestamp: result.metadata.timestamp || null,
        confidence: Math.round((1 - result.distance) * 100) / 100
      })
    } else {
      // Source reference exists but no matching result — add partial citation
      citations.push({
        index,
        sourceType: 'unknown',
        sourceId: '',
        feed: null,
        region: null,
        timestamp: null,
        confidence: 0
      })
    }
  }

  return citations.sort((a, b) => a.index - b.index)
}