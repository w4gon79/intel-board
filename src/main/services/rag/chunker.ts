/**
 * Text Chunker — splits documents into ~500-token chunks with 50-token overlap.
 *
 * Uses a simple whitespace/word-based approach for token estimation.
 * Each chunk is annotated with metadata from the source document.
 */

import type { DocumentChunk, VectorMetadata, SourceType } from '../../../shared/types'

// ── Configuration ──

/** Target tokens per chunk (TDD.md: 500 tokens) */
const CHUNK_SIZE_TOKENS = 500

/** Overlap tokens between consecutive chunks (TDD.md: 50 tokens) */
const CHUNK_OVERLAP_TOKENS = 50

/** Rough token-to-word ratio for English text */
const TOKEN_WORD_RATIO = 1.3 // ~1.3 tokens per word on average

/** Maximum characters per chunk (safety limit) */
const MAX_CHUNK_CHARS = CHUNK_SIZE_TOKENS * TOKEN_WORD_RATIO * 1.5

// ── Types ──

export interface ChunkInput {
  /** Unique ID of the source document in SQLite */
  sourceId: string
  /** The type of source (articles, flights, etc.) */
  sourceType: SourceType | 'intel_item'
  /** The full text content to chunk */
  text: string
  /** ISO timestamp of the source data */
  timestamp: string
  /** Geographic region (if known) */
  region: string | null
  /** Original feed/source name */
  feed: string | null
}

// ── Public API ──

/**
 * Split a document into overlapping chunks with metadata.
 *
 * @param input - Document text and metadata
 * @returns Array of DocumentChunks ready for embedding
 */
export function chunkDocument(input: ChunkInput): DocumentChunk[] {
  const { text, sourceId, sourceType, timestamp, region, feed } = input

  if (!text || text.trim().length === 0) {
    return []
  }

  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim()

  // Split into sentences for better chunk boundaries
  const sentences = splitSentences(normalized)

  // Group sentences into chunks of ~CHUNK_SIZE_TOKENS
  const rawChunks = groupSentencesIntoChunks(sentences)

  if (rawChunks.length === 0) return []

  // Build DocumentChunk objects with metadata
  const chunks: DocumentChunk[] = rawChunks.map((chunkText, index) => {
    const chunkId = `${sourceId}_chunk_${index}`

    const metadata: VectorMetadata = {
      source_id: sourceId,
      source_type: sourceType,
      chunk_index: index,
      timestamp,
      region,
      feed,
      text: chunkText
    }

    return {
      id: chunkId,
      text: chunkText,
      metadata
    }
  })

  return chunks
}

/**
 * Chunk multiple documents at once.
 * Returns a flat array of all chunks from all documents.
 */
export function chunkDocuments(inputs: ChunkInput[]): DocumentChunk[] {
  const allChunks: DocumentChunk[] = []
  for (const input of inputs) {
    allChunks.push(...chunkDocument(input))
  }
  return allChunks
}

/**
 * Estimate the number of tokens in a text string.
 * Uses a simple word-count * ratio heuristic.
 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.ceil(words * TOKEN_WORD_RATIO)
}

// ── Internal Helpers ──

/**
 * Split text into sentences.
 * Handles common sentence boundaries: period, exclamation, question mark.
 * Keeps the delimiter attached to the preceding sentence.
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const raw = text.split(/(?<=[.!?])\s+/)

  // Filter out empty strings and trim
  return raw.map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * Group sentences into chunks of approximately CHUNK_SIZE_TOKENS tokens,
 * with CHUNK_OVERLAP_TOKENS token overlap between consecutive chunks.
 */
function groupSentencesIntoChunks(sentences: string[]): string[] {
  if (sentences.length === 0) return []

  const chunks: string[] = []
  let currentSentences: string[] = []
  let currentTokens = 0

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    const sentenceTokens = estimateTokens(sentence)

    // If adding this sentence would exceed the chunk size AND we already have content,
    // finalize the current chunk
    if (currentTokens + sentenceTokens > CHUNK_SIZE_TOKENS && currentSentences.length > 0) {
      // Save the chunk
      chunks.push(currentSentences.join(' '))

      // Calculate overlap: keep sentences from the end of the current chunk
      // that total approximately CHUNK_OVERLAP_TOKENS tokens
      const overlap: string[] = []
      let overlapTokens = 0
      for (let j = currentSentences.length - 1; j >= 0; j--) {
        const t = estimateTokens(currentSentences[j])
        if (overlapTokens + t > CHUNK_OVERLAP_TOKENS && overlap.length > 0) break
        overlap.unshift(currentSentences[j])
        overlapTokens += t
      }

      // Start new chunk with overlap + current sentence
      currentSentences = [...overlap]
      currentTokens = overlap.reduce((sum, s) => sum + estimateTokens(s), 0)
    }

    currentSentences.push(sentence)
    currentTokens += sentenceTokens

    // Safety: if a single sentence exceeds max chunk size, split it by words
    if (currentTokens > MAX_CHUNK_CHARS / TOKEN_WORD_RATIO && currentSentences.length === 1) {
      const subChunks = splitLongSentence(sentence)
      chunks.push(...subChunks.slice(0, -1))
      currentSentences = subChunks.length > 1 ? [subChunks[subChunks.length - 1]] : []
      currentTokens = currentSentences.reduce((sum, s) => sum + estimateTokens(s), 0)
    }
  }

  // Don't forget the last chunk
  if (currentSentences.length > 0) {
    chunks.push(currentSentences.join(' '))
  }

  return chunks
}

/**
 * Split a single very long sentence by word boundaries.
 */
function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/)
  const wordsPerChunk = Math.floor(CHUNK_SIZE_TOKENS / TOKEN_WORD_RATIO)
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '))
  }

  return chunks.length > 0 ? chunks : [sentence]
}