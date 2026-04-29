// eslint-disable-next-line @typescript-eslint/no-require-imports
type SharedTypes = typeof import('../shared/types')

interface DatabaseStatus {
  connected: boolean
  path?: string
  tables?: string[]
}

interface Window {
  electron: import('@electron-toolkit/preload').ElectronAPI
  api: {
    // ── Database ──
    db: {
      getStatus: () => Promise<DatabaseStatus>
    }

    // ── Vector Store ──
    vectordb: {
      getStatus: () => Promise<{ connected: boolean; collections: string[] }>
    }

    // ── Ingestion ──
    ingestion: {
      start: () => Promise<{ success: boolean }>
      stop: () => Promise<{ success: boolean }>
      status: () => Promise<{ running: boolean; lastFetch?: string }>
      trigger: (gdeltQuery?: string) => Promise<unknown>
      search: (query: string) => Promise<unknown>
    }

    // ── Articles ──
    articles: {
      getAll: (limit?: number, offset?: number) => Promise<unknown[]>
      getById: (id: string) => Promise<unknown>
      getByRegion: (region: string, limit?: number) => Promise<unknown[]>
      getBySource: (source: string, limit?: number) => Promise<unknown[]>
      getRecent: (hoursBack?: number) => Promise<unknown[]>
      getCount: () => Promise<number>
    }

    // ── Intel Items ──
    intel: {
      getRecent: (limit?: number, offset?: number) => Promise<SharedTypes['IntelItem']>
      getCount: () => Promise<number>
      getCountByTier: () => Promise<Record<SharedTypes['IntelTier'], number>>
    }

    // ── Anomalies ──
    anomalies: {
      getActive: (limit?: number) => Promise<SharedTypes['Anomaly'][]>
      getCount: () => Promise<number>
    }

    // ── Predictions ──
    predictions: {
      getUnresolved: (limit?: number) => Promise<SharedTypes['Prediction'][]>
      review: (id: string, outcome: string, wasAccurate: boolean) => Promise<boolean>
      getAccuracy: () => Promise<{
        total: number
        resolved: number
        accurate: number
        inaccurate: number
        accuracyRate: number
      }>
    }

    // ── RAG Pipeline ──
    rag: {
      query: (request: SharedTypes['RAGRequest']) => Promise<SharedTypes['RAGResponse']>
      quickAnalysis: (topic: string, region?: string) => Promise<unknown>
      listModels: () => Promise<string[]>
      status: () => Promise<{ ollamaRunning: boolean; embeddingModel: string }>
    }

    // ── AI Chat ──
    ai: {
      chat: (message: string) => Promise<{
        id: number
        role: 'assistant'
        content: string
        sources: Array<{
          id: string; title: string; snippet: string; timestamp: string
          score: number; sourceType: string; sourceUrl: string | null
        }>
        confidence: number
        createdAt: string
      }>
      getHistory: (limit?: number) => Promise<Array<{
        id: number; role: 'user' | 'assistant' | 'system'
        content: string; sources: string | null
        confidence: number | null; created_at: string
      }>>
    }

    // ── Settings ──
    settings: {
      get: () => Promise<AppSettings>
      save: (settings: AppSettings) => Promise<{ success: boolean; error?: string }>
      listModels: (baseUrl?: string) => Promise<Array<{ name: string; size: string; modified_at: string }>>
      testConnection: (baseUrl?: string) => Promise<{ ok: boolean; error?: string }>
      testOpenaiConnection: (baseUrl: string, apiKey: string) => Promise<{ ok: boolean; error?: string }>
      testAI: (config: { provider: string; ollamaBaseUrl?: string; openaiBaseUrl?: string; openaiApiKey?: string }) => Promise<{ ok: boolean; error?: string; models?: number }>
    }

    // ── ADS-B ──
    adsb: {
      getMarkers: () => Promise<unknown[]>
      getGeoJSON: () => Promise<unknown>
      getDetails: (id: string) => Promise<unknown>
      getCount: () => Promise<{ total: number; military: number }>
      startPolling: (intervalMs?: number) => Promise<void>
      stopPolling: () => Promise<void>
      pollNow: () => Promise<void>
      onMarkersUpdated: (callback: (markers: unknown[]) => void) => () => void
      onGeoJSONUpdated: (callback: (geojson: unknown) => void) => () => void
      onFlightCountUpdated: (callback: (counts: { total: number; military: number }) => void) => () => void
      /** Notify main process about window visibility (skip polls when minimized) */
      setVisible: (visible: boolean) => Promise<void>
      /** Listen for credential error notifications from main process */
      onCredentialsError: (callback: (info: { message: string }) => void) => () => void
    }

    // ── Aircraft Identification (Phase 4A) ──
    aircraft: {
      /** Manually lookup an ICAO24 hex code (may trigger network call) */
      lookup: (icao24: string, callsign?: string) => Promise<{
        icao24: string
        aircraft_type: string | null
        icao_type_code: string | null
        manufacturer: string | null
        registration: string | null
        operator: string | null
        is_military: boolean
        category: string | null
      } | null>
      /** Get cached aircraft info (no network call) */
      getInfo: (icao24: string) => Promise<{
        icao24: string
        aircraft_type: string | null
        icao_type_code: string | null
        manufacturer: string | null
        registration: string | null
        operator: string | null
        is_military: boolean
        category: string | null
      } | null>
    }

    // ── AIS ──
    ais: {
      getMarkers: () => Promise<unknown[]>
      getGeoJSON: () => Promise<unknown>
      getDetails: (id: string) => Promise<unknown>
      getCount: () => Promise<number>
      getCountsByCategory: () => Promise<{ total: number; military: number; cargo: number; tanker: number; passenger: number }>
      getChokePoints: () => Promise<unknown>
      startStreaming: () => Promise<void>
      stopStreaming: () => Promise<void>
      getStatus: () => Promise<{ connected: boolean; lastMessageAgeMs: number; feedAlive: boolean }>
      onGeoJSONUpdated: (callback: (geojson: unknown) => void) => () => void
      onVesselCountUpdated: (callback: (counts: { total: number; military: number; cargo: number; tanker: number; passenger: number }) => void) => () => void
      onFeedHealthUpdated: (callback: (health: { connected: boolean; lastMessageAgeMs: number; feedAlive: boolean }) => void) => () => void
    }

    // ── Global Fishing Watch (Phase 4I) ──
    gfw: {
      /** Get latest GFW presence data for all choke points */
      getPresence: () => Promise<GfwPresenceRow[]>
      /** Get GFW data for a specific choke point */
      getPresenceByChokepoint: (chokepoint: string) => Promise<GfwPresenceRow[]>
      /** Get GFW poll status (last poll times, error states, total records) */
      getStatus: () => Promise<GfwStatus>
      /** Manually trigger a GFW poll */
      triggerPoll: () => Promise<{ success: boolean; error?: string }>
    }

    // ── Vessel Identification (Phase 4B) ──
    vessel: {
      lookup: (mmsi: string, shipName?: string, shipType?: string) => Promise<{
        mmsi: string
        vessel_name: string | null
        vessel_class: string | null
        vessel_type: string | null
        hull_number: string | null
        country: string | null
        displacement_tons: number | null
        capabilities: string | null
        is_hva: boolean
        category: string | null
      } | null>
      getInfo: (mmsi: string) => Promise<{
        mmsi: string
        vessel_name: string | null
        vessel_class: string | null
        vessel_type: string | null
        hull_number: string | null
        country: string | null
        displacement_tons: number | null
        capabilities: string | null
        is_hva: boolean
        category: string | null
      } | null>
    }

    // ── Social Media (Phase 5A) ──
    social: {
      getPosts: (limit?: number, source?: 'reddit' | 'bluesky', sourceDetail?: string) => Promise<unknown[]>
      getStats: () => Promise<{
        reddit: { lastFetch: string | null; postCount: number; enabled: boolean }
        bluesky: { lastFetch: string | null; postCount: number; enabled: boolean }
        totalPosts: number
        analyzedPosts: number
      }>
      pollReddit: () => Promise<{ fetched: number; inserted: number }>
      pollBlueSky: () => Promise<{ fetched: number; inserted: number }>
    }

    // ── Economic Monitoring (Phase 5B) ──
    economic: {
      poll: () => Promise<{ fetched: number; anomalies: number }>
      getIndicators: () => Promise<EconomicIndicator[]>
      getAnomalies: () => Promise<EconomicIndicator[]>
      getStatus: () => Promise<EconomicServiceStatus>
      start: (intervalMs?: number) => Promise<{ success: boolean }>
      stop: () => Promise<{ success: boolean }>
    }

    // ── Alert Rules (Phase 5A) ──
    alertRules: {
      list: () => Promise<unknown[]>
      create: (rule: Record<string, unknown>) => Promise<unknown>
      update: (id: string, updates: Record<string, unknown>) => Promise<unknown>
      delete: (id: string) => Promise<unknown>
      toggle: (id: string) => Promise<unknown>
    }
  }
}

declare global {
  // App settings — globally available type
  interface AppSettings {
    dataSources: {
      adsb: { enabled: boolean; intervalMs: number }
      ais: { enabled: boolean; intervalMs: number }
      news: { enabled: boolean; intervalMs: number }
    }
    alerts: {
      militaryFlights: boolean
      chokePoints: boolean
      newsSpikes: boolean
    }
    map: {
      militaryOnly: boolean
      clustering: boolean
    }
    notifications: {
      alert: boolean
      watch: boolean
      context: boolean
    }
    retentionDays: number
    ai: {
      ollamaBaseUrl: string
      primaryProvider: 'local' | 'ollama-cloud' | 'openai-compatible'
      primaryLocalModel: string
      primaryOllamaModel: string
      primaryOpenaiBaseUrl: string
      primaryOpenaiApiKey: string
      primaryOpenaiModel: string
      fallbackEnabled: boolean
      fallbackProvider: 'local' | 'ollama-cloud' | 'openai-compatible'
      fallbackLocalModel: string
      fallbackOllamaModel: string
      fallbackOpenaiBaseUrl: string
      fallbackOpenaiApiKey: string
      fallbackOpenaiModel: string
      temperature: number
    }
    remoteServer: {
      enabled: boolean
      port: number
      requireAuth: boolean
    }
    socialMedia: {
      reddit: { enabled: boolean; intervalMs: number }
      bluesky: { enabled: boolean; intervalMs: number }
    }
    economic: {
      enabled: boolean
      intervalMs: number
    }
    apiKeys: {
      newsApiKey: string
      openskyUsername: string
      openskyPassword: string
      aisstreamApiKey: string
      gfwApiToken: string
      fredApiKey: string
      zaiApiKey: string
      zaiBaseUrl: string
    }
  }

  // Economic types
  interface EconomicIndicator {
    id: string
    symbol: string
    name: string
    category: 'commodity' | 'currency' | 'shipping'
    value: number
    previous_close: number | null
    change_pct_24h: number | null
    change_pct_7d: number | null
    high_30d: number | null
    low_30d: number | null
    is_anomaly: boolean
    anomaly_type: string | null
    related_zones: string | null
    fetched_at: string
  }

  interface EconomicServiceStatus {
    running: boolean
    lastPoll: string | null
    indicatorCount: number
    anomalyCount: number
    error: string | null
  }

  // GFW types
  interface GfwPresenceRow {
    id: string
    chokepoint: string
    lat: number
    lon: number
    dataset: 'presence' | 'sar'
    hours: number
    vessel_count: number
    flags: string | null
    vessel_names: string | null
    gear_types: string | null
    mmsi_list: string | null
    polled_at: string
    date_range_start: string | null
    date_range_end: string | null
  }

  interface GfwStatus {
    running: boolean
    lastPollTimes: Record<string, string | null>
    totalRecords: number
    errors: string[]
  }

  // Vite environment variables
  interface ImportMetaEnv {
    readonly VITE_MAPBOX_TOKEN?: string
    readonly VITE_MAPBOX_SILENCE_EVENTS?: string
    readonly DEV: boolean
    readonly PROD: boolean
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  interface Window {
    electron: import('@electron-toolkit/preload').ElectronAPI
    api: Window['api']
  }
}

export {}
