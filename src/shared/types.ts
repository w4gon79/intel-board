/**
 * Shared TypeScript types for Intel Board
 * Used across main process, preload, and renderer
 */

// ── Tier levels for intelligence items ──
export type IntelTier = 'ALERT' | 'WATCH' | 'CONTEXT'

// ── Severity levels for anomalies ──
export type AnomalySeverity = 'CRITICAL' | 'HIGH' | 'MODERATE'

// ── Data source types ──
export type SourceType = 'adsb' | 'ais' | 'news' | 'economic' | 'weather' | 'social'

// ── Article (news ingestion) ──
export interface Article {
  id: string
  source: string
  title: string | null
  content: string | null
  url: string | null
  published_at: string | null
  ingested_at: string
  sentiment: number | null
  entities: string[] // JSON array of extracted entities
  region: string | null
  topics: string[] // JSON array of topics
}

// ── Flight (ADS-B tracking) ──
export interface Flight {
  id: string
  icao24: string | null
  callsign: string | null
  origin_country: string | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  velocity: number | null
  heading: number | null
  is_military: boolean
  aircraft_type: string | null
  timestamp: string | null
}

// ── Vessel (AIS tracking) ──
export interface Vessel {
  id: string
  mmsi: string | null
  imo: string | null
  ship_name: string | null
  ship_type: string | null
  latitude: number | null
  longitude: number | null
  speed: number | null
  heading: number | null
  destination: string | null
  timestamp: string | null
}

// ── Vessel Marker (lightweight, for renderer map display) ──
export interface VesselMarker {
  id: string
  mmsi: string | null
  imo: string | null
  ship_name: string | null
  ship_type: string | null
  latitude: number | null
  longitude: number | null
  speed: number | null
  heading: number | null
  destination: string | null
  timestamp: string | null
}

// ── AIS Ship Category (for filtering in UI) ──
export type AisShipCategory = 'all' | 'military' | 'cargo' | 'tanker' | 'passenger'

// ── Intel Item (AI-generated intelligence) ──
export interface IntelItem {
  id: string
  tier: IntelTier
  title: string
  summary: string | null
  analysis: string | null
  confidence: number | null
  sources: string[] // JSON array of source references
  region: string | null
  categories: string[] // JSON array
  created_at: string
  updated_at: string | null
  expires_at: string | null
  latitude: number | null
  longitude: number | null
}

// ── Anomaly ──
export interface Anomaly {
  id: string
  source_type: SourceType | string
  metric: string | null
  region: string | null
  baseline_value: number | null
  observed_value: number | null
  deviation_sigma: number | null
  detected_at: string
  resolved_at: string | null
  status: string
}

// ── Prediction Review Info (joined from prediction_reviews) ──
export interface PredictionReviewInfo {
  review_outcome: string | null
  review_reasoning: string | null
  review_key_finding: string | null
  review_evidence_count: number
  review_reviewed_at: string | null
  review_model: string | null
}

// ── Prediction ──
export interface Prediction {
  id: string
  prediction_text: string | null
  confidence: number | null
  model_used: string | null
  sources: string[] | null // JSON array
  predicted_at: string
  expected_by: string | null
  outcome: string | null
  resolved_at: string | null
  was_accurate: boolean | null
  review?: PredictionReviewInfo // optional — populated by getPredictionsWithReviews()
}

// ── Flight Marker (lightweight, for renderer map display) ──
export interface FlightMarker {
  id: string
  icao24: string | null
  callsign: string | null
  origin_country: string | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  velocity: number | null
  heading: number | null
  is_military: boolean
  aircraft_type: string | null
  timestamp: string | null
}

// ── Create/insert parameter types (omit auto-generated fields) ──
export type InsertArticle = Omit<Article, 'id' | 'ingested_at'>
export type InsertFlight = Omit<Flight, 'id'>
export type InsertVessel = Omit<Vessel, 'id'>
export type InsertIntelItem = Omit<IntelItem, 'id' | 'created_at' | 'latitude' | 'longitude'> & {
  latitude?: number | null
  longitude?: number | null
}
export type InsertAnomaly = Omit<Anomaly, 'id' | 'detected_at'>
export type InsertPrediction = Omit<Prediction, 'id' | 'predicted_at'>

// ── Carrier Strike Group (Phase 4F) ──

export type CarrierGroupStatus = 'deployed' | 'in-port' | 'transiting' | 'unknown'
export type CarrierGroupSource = 'usni' | 'ais' | 'both'

export interface CarrierGroup {
  id: string
  name: string
  designation: string | null
  flagship: string | null
  status: CarrierGroupStatus
  operating_area: string | null
  latitude: number | null
  longitude: number | null
  source: CarrierGroupSource
  last_updated: string | null
  created_at: string
}

export interface CarrierGroupVessel {
  id: string
  group_id: string
  vessel_name: string | null
  vessel_type: string | null
  hull_number: string | null
  mmsi: string | null
  imo: string | null
  latitude: number | null
  longitude: number | null
  heading: number | null
  speed: number | null
  last_seen: string | null
}

/** Full group with nested vessels */
export interface CarrierGroupWithVessels extends CarrierGroup {
  vessels: CarrierGroupVessel[]
}

// ── Database status for IPC communication ──
export interface DatabaseStatus {
  connected: boolean
  dbPath: string
  tables: string[]
  error?: string
}

// ── Vector Store (ChromaDB) ──

/** Metadata stored alongside each vector embedding in ChromaDB */
export interface VectorMetadata {
  /** ID of the source record in SQLite (article, flight, vessel, intel_item) */
  source_id: string
  /** Which table/entity type this chunk came from */
  source_type: SourceType | 'intel_item'
  /** Chunk index within the original document (0-based) */
  chunk_index: number
  /** ISO timestamp of the original data */
  timestamp: string
  /** Geographic region (if detected) */
  region: string | null
  /** Original source feed (e.g., 'newsapi', 'gdelt') */
  feed: string | null
  /** Chunk text for reference */
  text: string
}

/** A single document chunk ready for embedding and storage */
export interface DocumentChunk {
  /** Unique ID for this chunk (derived from source_id + chunk_index) */
  id: string
  /** The text content of this chunk */
  text: string
  /** Metadata to store alongside the embedding */
  metadata: VectorMetadata
}

/** Result from a vector similarity search */
export interface VectorSearchResult {
  /** ChromaDB document/chunk ID */
  id: string
  /** Cosine distance (0 = identical, 2 = opposite) */
  distance: number
  /** The chunk text */
  text: string
  /** Associated metadata */
  metadata: VectorMetadata
}

/** Re-ranked search result with relevance scoring */
export interface RankedSearchResult extends VectorSearchResult {
  /** Combined relevance score (0-1, higher is better) */
  relevanceScore: number
  /** Recency boost factor */
  recencyBoost: number
}

/** Status of the ChromaDB vector store */
export interface VectorStoreStatus {
  connected: boolean
  chromaUrl: string
  collections: string[]
  totalDocuments: number
  error?: string
}

// ── RAG Pipeline ──

/** A single message in a RAG conversation */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Source citation in a RAG response */
export interface SourceCitation {
  /** Index in the response (1-based) */
  index: number
  /** Source type (news, adsb, ais, etc.) */
  sourceType: string
  /** Source ID from SQLite */
  sourceId: string
  /** Original source/feed name */
  feed: string | null
  /** Region */
  region: string | null
  /** Timestamp of the source data */
  timestamp: string | null
  /** Confidence score (0-1) */
  confidence: number
}

/** Response from the RAG pipeline */
export interface RAGResponse {
  /** The generated answer text */
  answer: string
  /** Sources cited in the answer */
  sources: SourceCitation[]
  /** Model used for generation */
  model: string
  /** Time taken to generate (ms) */
  durationMs: number
  /** Number of context chunks retrieved */
  chunksRetrieved: number
}

/** Request to the RAG pipeline */
export interface RAGRequest {
  /** The user's question */
  query: string
  /** Conversation history (previous messages) */
  history: ChatMessage[]
  /** Optional: filter to specific collections */
  collections?: string[]
  /** Optional: filter by region */
  region?: string
  /** Optional: model override (uses default if not specified) */
  model?: string
}
