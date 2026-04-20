/**
 * ChromaDB Vector Store — connection management, collections, and CRUD operations.
 *
 * Connects to a local ChromaDB server instance. Stores document chunks as
 * vector embeddings with rich metadata for filtered retrieval.
 *
 * Collections mirror source types: articles, flights, vessels, intel_items.
 */

import { ChromaClient, type Collection, type Where } from 'chromadb'
import { config } from '../../utils/config'
import { embedBatch, embedText } from '../rag/embedder'
import { chunkDocument, type ChunkInput } from '../rag/chunker'
import type {
  DocumentChunk,
  VectorMetadata,
  VectorSearchResult,
  VectorStoreStatus
} from '../../../shared/types'

// ── Constants ──

/** Collection names matching our data source types */
const COLLECTION_NAMES = ['articles', 'flights', 'vessels', 'intel_items'] as const
type CollectionName = (typeof COLLECTION_NAMES)[number]

/** Distance function for similarity search */
const DISTANCE_FUNCTION = 'cosine'

/**
 * Dummy embedding function — suppresses the DefaultEmbeddingFunction warning.
 * We provide our own embeddings via Ollama, so this is never actually called.
 */
const dummyEmbeddingFunction = {
  generate: async (_texts: string[]): Promise<number[][]> => {
    throw new Error('[vectordb] Dummy embedding function called — use embedText/embedBatch instead')
  }
}

// ── State ──

let client: ChromaClient | null = null
let collections: Map<string, Collection> = new Map()
let isConnected = false

// ── Initialization ──

/**
 * Initialize the ChromaDB client and ensure all required collections exist.
 * Safe to call multiple times — returns existing client if already connected.
 */
export async function initVectorStore(): Promise<void> {
  if (isConnected && client) return

  console.log(`[vectordb] Connecting to ChromaDB at ${config.chromaUrl}`)

  try {
    // Parse URL to avoid deprecated 'path' argument
    const url = new URL(config.chromaUrl)
    client = new ChromaClient({
      host: url.hostname,
      port: parseInt(url.port, 10)
    })

    // Use getOrCreate to avoid listCollections() which triggers
    // DefaultEmbeddingFunction warnings for existing collections
    for (const name of COLLECTION_NAMES) {
      console.log(`[vectordb] Ensuring collection: ${name}`)
      const collection = await client.getOrCreateCollection({
        name,
        metadata: {
          'hnsw:space': DISTANCE_FUNCTION,
          description: `Intel Board ${name} embeddings`
        },
        embeddingFunction: dummyEmbeddingFunction
      })
      collections.set(name, collection)
    }

    isConnected = true
    console.log(
      `[vectordb] Connected. Collections: ${COLLECTION_NAMES.join(', ')}`
    )
  } catch (err) {
    isConnected = false
    console.error(
      `[vectordb] Failed to connect to ChromaDB at ${config.chromaUrl}. ` +
      `Make sure ChromaDB is running: chroma run. Error: ${err instanceof Error ? err.message : String(err)}`
    )
    // Don't throw — the app should work without vector store (graceful degradation)
  }
}

/**
 * Close the vector store connection.
 */
export async function closeVectorStore(): Promise<void> {
  if (client) {
    console.log('[vectordb] Closing connection')
    client = null
    collections.clear()
    isConnected = false
  }
}

// ── Collection Access ──

/**
 * Get a collection by name. Throws if not initialized.
 */
function getCollection(name: CollectionName): Collection {
  if (!client || !isConnected) {
    throw new Error('[vectordb] Not connected. Call initVectorStore() first.')
  }
  const collection = collections.get(name)
  if (!collection) {
    throw new Error(`[vectordb] Collection '${name}' not found.`)
  }
  return collection
}

// ── Document Ingestion ──

/**
 * Embed and store a single document (with automatic chunking).
 *
 * @param collectionName - Which collection to store in
 * @param input - Document text and metadata for chunking
 * @returns Number of chunks stored
 */
export async function embedAndStore(
  collectionName: CollectionName,
  input: ChunkInput
): Promise<number> {
  try {
    // Chunk the document
    const chunks = chunkDocument(input)
    if (chunks.length === 0) return 0

    // Store the chunks
    await storeChunks(collectionName, chunks)
    return chunks.length
  } catch (err) {
    console.error(
      `[vectordb] Error embedding document ${input.sourceId}:`,
      err instanceof Error ? err.message : String(err)
    )
    return 0
  }
}

/**
 * Embed and store multiple documents (with automatic chunking).
 * Uses batch embedding for efficiency.
 *
 * @param collectionName - Which collection to store in
 * @param inputs - Array of document texts and metadata
 * @returns Total number of chunks stored
 */
export async function embedAndStoreBatch(
  collectionName: CollectionName,
  inputs: ChunkInput[]
): Promise<number> {
  if (inputs.length === 0) return 0

  try {
    // Chunk all documents
    const allChunks: DocumentChunk[] = []
    for (const input of inputs) {
      allChunks.push(...chunkDocument(input))
    }

    if (allChunks.length === 0) return 0

    // Store all chunks
    await storeChunks(collectionName, allChunks)
    return allChunks.length
  } catch (err) {
    console.error(
      '[vectordb] Error in batch embedding:',
      err instanceof Error ? err.message : String(err)
    )
    return 0
  }
}

/**
 * Store pre-built chunks (already chunked, need embedding).
 * Embeds all chunk texts and upserts into the collection.
 */
async function storeChunks(
  collectionName: CollectionName,
  chunks: DocumentChunk[]
): Promise<void> {
  if (chunks.length === 0) return

  const collection = getCollection(collectionName)

  // Embed all chunk texts in batches
  const texts = chunks.map((c) => c.text)
  const embeddings = await embedBatch(texts)

  // Prepare data for ChromaDB upsert
  const ids = chunks.map((c) => c.id)
  const metadatas = chunks.map((c) => ({
    source_id: c.metadata.source_id,
    source_type: c.metadata.source_type,
    chunk_index: c.metadata.chunk_index,
    timestamp: c.metadata.timestamp,
    region: c.metadata.region ?? '',
    feed: c.metadata.feed ?? '',
    text: c.metadata.text
  }))

  // Upsert (insert or update if ID already exists)
  await collection.upsert({
    ids,
    embeddings,
    metadatas,
    documents: texts
  })

  console.log(
    `[vectordb] Stored ${chunks.length} chunks in '${collectionName}'`
  )
}

// ── Vector Search ──

/**
 * Search options for vector similarity queries.
 */
export interface SearchOptions {
  /** Maximum number of results to return (default: 20) */
  topK?: number
  /** Filter by region */
  region?: string
  /** Filter by source type */
  sourceType?: string
  /** Only return results newer than this ISO timestamp */
  since?: string
  /** Which collections to search (default: all) */
  collections?: CollectionName[]
}

/**
 * Perform a vector similarity search across collections.
 *
 * @param query - Natural language query text
 * @param options - Search parameters and filters
 * @returns Array of search results sorted by relevance
 */
export async function vectorSearch(
  query: string,
  options: SearchOptions = {}
): Promise<VectorSearchResult[]> {
  const {
    topK = 20,
    region,
    sourceType,
    since,
    collections = COLLECTION_NAMES
  } = options

  if (!isConnected) {
    console.warn('[vectordb] Search attempted but not connected')
    return []
  }

  // Embed the query
  const queryEmbedding = await embedText(query)

  // Build metadata filter (ChromaDB Where type)
  const whereConditions: Where[] = []
  if (region) {
    whereConditions.push({ region })
  }
  if (sourceType) {
    whereConditions.push({ source_type: sourceType })
  }
  if (since) {
    whereConditions.push({ timestamp: { $gte: since } })
  }
  const where: Where | undefined =
    whereConditions.length > 1
      ? { $and: whereConditions }
      : whereConditions.length === 1
        ? whereConditions[0]
        : undefined

  // Search across specified collections
  const allResults: VectorSearchResult[] = []
  const perCollectionLimit = Math.ceil(topK / collections.length) + 5

  for (const collName of collections) {
    try {
      const collection = getCollection(collName)

      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: perCollectionLimit,
        where: where ?? undefined,
        include: ['documents', 'metadatas', 'distances']
      })

      // Parse results
      if (results.ids[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
          const metadata = results.metadatas?.[0]?.[i] as Record<string, unknown> | undefined

          allResults.push({
            id: results.ids[0][i],
            distance: results.distances?.[0]?.[i] ?? 1,
            text: results.documents?.[0]?.[i] ?? '',
            metadata: {
              source_id: (metadata?.source_id as string) ?? '',
              source_type: (metadata?.source_type as VectorMetadata['source_type']) ?? 'news',
              chunk_index: (metadata?.chunk_index as number) ?? 0,
              timestamp: (metadata?.timestamp as string) ?? '',
              region: (metadata?.region as string) || null,
              feed: (metadata?.feed as string) || null,
              text: results.documents?.[0]?.[i] ?? ''
            }
          })
        }
      }
    } catch (err) {
      console.warn(
        `[vectordb] Search error in collection '${collName}':`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // Sort by distance (lower = more similar) and take top K
  allResults.sort((a, b) => a.distance - b.distance)
  return allResults.slice(0, topK)
}

// ── Document Management ──

/**
 * Delete all chunks belonging to a specific source document.
 *
 * @param collectionName - Which collection to delete from
 * @param sourceId - The SQLite ID of the source document
 */
export async function deleteSourceChunks(
  collectionName: CollectionName,
  sourceId: string
): Promise<void> {
  if (!isConnected) return

  try {
    const collection = getCollection(collectionName)
    await collection.delete({
      where: { source_id: sourceId }
    })
    console.log(
      `[vectordb] Deleted chunks for source '${sourceId}' from '${collectionName}'`
    )
  } catch (err) {
    console.error(
      `[vectordb] Error deleting chunks for source '${sourceId}':`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

/**
 * Get the count of documents in each collection.
 */
export async function getDocumentCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}

  if (!isConnected) return counts

  for (const name of COLLECTION_NAMES) {
    try {
      const collection = getCollection(name)
      counts[name] = await collection.count()
    } catch {
      counts[name] = 0
    }
  }

  return counts
}

/**
 * Get the total number of documents across all collections.
 */
export async function getTotalDocumentCount(): Promise<number> {
  const counts = await getDocumentCounts()
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

// ── Status & Health ──

/**
 * Get the current status of the vector store.
 */
export async function getVectorStoreStatus(): Promise<VectorStoreStatus> {
  if (!client || !isConnected) {
    return {
      connected: false,
      chromaUrl: config.chromaUrl,
      collections: [],
      totalDocuments: 0,
      error: 'Not connected'
    }
  }

  try {
    const counts = await getDocumentCounts()
    const totalDocuments = Object.values(counts).reduce((sum, c) => sum + c, 0)

    return {
      connected: true,
      chromaUrl: config.chromaUrl,
      collections: COLLECTION_NAMES.map((name) => `${name} (${counts[name] ?? 0})`),
      totalDocuments
    }
  } catch (err) {
    return {
      connected: false,
      chromaUrl: config.chromaUrl,
      collections: [],
      totalDocuments: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Check if ChromaDB is available without initializing the full store.
 */
export async function isChromaHealthy(): Promise<{
  healthy: boolean
  url: string
  version?: string
  error?: string
}> {
  try {
    const url = new URL(config.chromaUrl)
    const tempClient = new ChromaClient({ host: url.hostname, port: parseInt(url.port, 10) })
    const heartbeat = await tempClient.heartbeat()
    return {
      healthy: true,
      url: config.chromaUrl,
      version: heartbeat ? 'connected' : undefined
    }
  } catch (err) {
    return {
      healthy: false,
      url: config.chromaUrl,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}