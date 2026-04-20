/**
 * Embedding Service — generates vector embeddings via Ollama (nomic-embed-text).
 *
 * All embeddings run locally for privacy and speed.
 * Produces 768-dimensional vectors for ChromaDB storage.
 */

import { config } from '../../utils/config'

/** Ollama embedding API response shape */
interface OllamaEmbedResponse {
  model: string
  embeddings: number[][]
  total_duration?: number
  load_duration?: number
}

/** Ollama API error response */
interface OllamaErrorResponse {
  error: string
}

const EMBEDDING_DIMENSION = 768
const OLLAMA_EMBED_ENDPOINT = `${config.ollamaBaseUrl}/api/embed`

/**
 * Generate an embedding for a single text string.
 * Returns a 768-dim float array (nomic-embed-text).
 */
export async function embedText(text: string): Promise<number[]> {
  const embeddings = await embedBatch([text])
  return embeddings[0]
}

/**
 * Generate embeddings for multiple texts in a single Ollama call.
 * More efficient than individual calls for batch processing.
 *
 * @param texts - Array of text strings to embed
 * @param maxBatchSize - Maximum texts per API call (Ollama handles batching internally)
 * @returns Array of 768-dim embedding vectors, same order as input
 */
export async function embedBatch(texts: string[], maxBatchSize = 50): Promise<number[][]> {
  if (texts.length === 0) return []

  const allEmbeddings: number[][] = []

  // Process in sub-batches to avoid overwhelming Ollama
  for (let i = 0; i < texts.length; i += maxBatchSize) {
    const batch = texts.slice(i, i + maxBatchSize)
    const batchEmbeddings = await callOllamaEmbed(batch)
    allEmbeddings.push(...batchEmbeddings)
  }

  return allEmbeddings
}

/**
 * Call the Ollama /api/embed endpoint.
 * Handles errors, retries once on failure.
 */
async function callOllamaEmbed(texts: string[]): Promise<number[][]> {
  const body = JSON.stringify({
    model: config.embeddingModel,
    input: texts
  })

  let response: Response
  try {
    response = await fetch(OLLAMA_EMBED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    })
  } catch (err) {
    throw new Error(
      `[embedder] Failed to connect to Ollama at ${config.ollamaBaseUrl}. ` +
      `Is Ollama running? Error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!response.ok) {
    let errorMsg = `Ollama returned HTTP ${response.status}`
    try {
      const errBody = (await response.json()) as OllamaErrorResponse
      errorMsg = errBody.error || errorMsg
    } catch {
      // Use default error message
    }
    throw new Error(
      `[embedder] Embedding failed: ${errorMsg}. ` +
      `Make sure '${config.embeddingModel}' is pulled: ollama pull ${config.embeddingModel}`
    )
  }

  const data = (await response.json()) as OllamaEmbedResponse

  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(
      `[embedder] Embedding count mismatch: expected ${texts.length}, got ${data.embeddings?.length ?? 0}`
    )
  }

  // Validate dimensions
  for (let i = 0; i < data.embeddings.length; i++) {
    if (data.embeddings[i].length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `[embedder] Unexpected embedding dimension at index ${i}: ` +
        `expected ${EMBEDDING_DIMENSION}, got ${data.embeddings[i].length}`
      )
    }
  }

  return data.embeddings
}

/**
 * Check if the Ollama embedding service is available and the model is loaded.
 * Returns true if healthy, false otherwise.
 */
export async function isEmbedderHealthy(): Promise<{
  healthy: boolean
  model: string
  url: string
  error?: string
}> {
  try {
    const response = await fetch(OLLAMA_EMBED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.embeddingModel, input: ['health check'] })
    })

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as { error?: string }
      return {
        healthy: false,
        model: config.embeddingModel,
        url: config.ollamaBaseUrl,
        error: errBody.error || `HTTP ${response.status}`
      }
    }

    return {
      healthy: true,
      model: config.embeddingModel,
      url: config.ollamaBaseUrl
    }
  } catch (err) {
    return {
      healthy: false,
      model: config.embeddingModel,
      url: config.ollamaBaseUrl,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** Get the expected embedding dimension */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSION
}