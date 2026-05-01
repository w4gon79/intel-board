/**
 * Transport layer: detects Electron vs Browser environment.
 * In Electron: uses IPC (window.api.*)
 * In Browser: patches window.api with HTTP REST transport
 *
 * When running in a browser (accessed via HTTP server from another device),
 * this shim patches window.api so all existing components work unchanged.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IS_ELECTRON = !!(window as any).electron

// Same-origin — the HTTP server serves both API and renderer on the same port
const API_BASE = '/api'

const jsonFetch = async (url: string, opts?: RequestInit): Promise<unknown> => {
  try {
    const r = await fetch(url, opts)
    if (!r.ok) {
      console.warn(`[apiTransport] ${url} returned ${r.status}`)
      return null
    }
    const text = await r.text()
    if (!text) return null
    return JSON.parse(text)
  } catch (err) {
    console.warn(`[apiTransport] fetch failed for ${url}:`, err)
    return null
  }
}

const post = (url: string, body?: unknown): Promise<unknown> =>
  jsonFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

const put = (url: string, body?: unknown): Promise<unknown> =>
  jsonFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHttpApi(): any {
  return {
    db: {
      getStatus: () => jsonFetch(`${API_BASE}/db/status`)
    },
    vectordb: {
      getStatus: () => jsonFetch(`${API_BASE}/vectordb/status`)
    },
    ingestion: {
      start: () => post(`${API_BASE}/ingestion/start`),
      stop: () => post(`${API_BASE}/ingestion/stop`),
      status: () => jsonFetch(`${API_BASE}/ingestion/status`),
      trigger: (gdeltQuery?: string) => post(`${API_BASE}/ingestion/trigger`, { gdeltQuery }),
      search: (query: string) => jsonFetch(`${API_BASE}/ingestion/search?q=${encodeURIComponent(query)}`)
    },
    articles: {
      getAll: (limit?: number, offset?: number) =>
        jsonFetch(`${API_BASE}/articles?limit=${limit || 100}&offset=${offset || 0}`),
      getById: (id: string) => jsonFetch(`${API_BASE}/articles/${encodeURIComponent(id)}`),
      getByRegion: (region: string, limit?: number) =>
        jsonFetch(`${API_BASE}/articles/byRegion/${encodeURIComponent(region)}?limit=${limit || 50}`),
      getBySource: (source: string, limit?: number) =>
        jsonFetch(`${API_BASE}/articles/bySource/${encodeURIComponent(source)}?limit=${limit || 50}`),
      getRecent: (hoursBack?: number) =>
        jsonFetch(`${API_BASE}/articles/recent${hoursBack ? `?hoursBack=${hoursBack}` : ''}`),
      getCount: () => jsonFetch(`${API_BASE}/articles/count`)
    },
    intel: {
      getRecent: (limit?: number, offset?: number) =>
        jsonFetch(`${API_BASE}/intel/recent?limit=${limit || 50}&offset=${offset || 0}`),
      getCount: () => jsonFetch(`${API_BASE}/intel/count`),
      getCountByTier: () => jsonFetch(`${API_BASE}/intel/countByTier`),
      deleteByTitle: (pattern: string) => post(`${API_BASE}/intel/deleteByTitle`, { pattern }),
      deleteOlderThan: (hours: number) => post(`${API_BASE}/intel/deleteOlderThan`, { hours }),
      deleteByIds: (ids: string[]) => post(`${API_BASE}/intel/deleteByIds`, { ids })
    },
    anomalies: {
      getActive: (limit?: number) =>
        jsonFetch(`${API_BASE}/anomalies/active?limit=${limit || 100}`),
      getCount: () => jsonFetch(`${API_BASE}/anomalies/count`)
    },
    predictions: {
      getUnresolved: (limit?: number) =>
        jsonFetch(`${API_BASE}/predictions/unresolved?limit=${limit || 50}`),
      getWithReviews: (limit?: number) =>
        jsonFetch(`${API_BASE}/predictions/getWithReviews?limit=${limit || 50}`),
      review: (id: string, outcome: string, wasAccurate: boolean) =>
        post(`${API_BASE}/predictions/review`, { id, outcome, wasAccurate }),
      getAccuracy: () => jsonFetch(`${API_BASE}/predictions/accuracy`),
      getReviewStats: () => jsonFetch(`${API_BASE}/predictions/accuracy`)
    },
    ai: {
      chat: (message: string) => post(`${API_BASE}/ai/chat`, { message }),
      getHistory: (limit?: number) =>
        jsonFetch(`${API_BASE}/ai/history?limit=${limit || 50}`),
      brief: (request: { type: string; data: Record<string, unknown> }) =>
        post(`${API_BASE}/ai/brief`, request)
    },
    rag: {
      query: (params: unknown) => post(`${API_BASE}/rag/query`, params),
      quickAnalysis: (topic: string, region?: string) =>
        post(`${API_BASE}/rag/quickAnalysis`, { topic, region }),
      listModels: () => jsonFetch(`${API_BASE}/rag/models`),
      status: () => jsonFetch(`${API_BASE}/rag/status`)
    },
    settings: {
      get: () => jsonFetch(`${API_BASE}/settings`),
      save: (settings: unknown) => post(`${API_BASE}/settings`, settings),
      listModels: (baseUrl?: string) =>
        jsonFetch(`${API_BASE}/settings/models${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''}`),
      testConnection: (baseUrl?: string) =>
        jsonFetch(`${API_BASE}/settings/test-connection${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''}`),
      testOpenaiConnection: (baseUrl: string, apiKey: string) =>
        post(`${API_BASE}/settings/test-openai-connection`, { baseUrl, apiKey }),
      testAI: (config: { provider: string; ollamaBaseUrl?: string; openaiBaseUrl?: string; openaiApiKey?: string }) =>
        post(`${API_BASE}/settings/test-ai`, config),
      testApiKey: (service: string) =>
        post(`${API_BASE}/settings/test-api-key`, { service })
    },
    adsb: {
      getMarkers: () => jsonFetch(`${API_BASE}/adsb/markers`),
      getGeoJSON: () => jsonFetch(`${API_BASE}/adsb/geojson`),
      getDetails: (id: string) => jsonFetch(`${API_BASE}/adsb/details?id=${encodeURIComponent(id)}`),
      getCount: () => jsonFetch(`${API_BASE}/adsb/count`),
      startPolling: (intervalMs?: number) => post(`${API_BASE}/adsb/startPolling`, { intervalMs }),
      stopPolling: () => post(`${API_BASE}/adsb/stopPolling`, {}),
      pollNow: () => post(`${API_BASE}/adsb/pollNow`, {}),
      onMarkersUpdated: (callback: (markers: unknown[]) => void) => {
        const interval = setInterval(async () => {
          try {
            const data = await jsonFetch(`${API_BASE}/adsb/markers`)
            if (data) callback(data as unknown[])
          } catch { /* ignore */ }
        }, 5000)
        return () => clearInterval(interval)
      },
      onGeoJSONUpdated: (callback: (geojson: unknown) => void) => {
        const interval = setInterval(async () => {
          try {
            const data = await jsonFetch(`${API_BASE}/adsb/geojson`)
            if (data) callback(data)
          } catch { /* ignore */ }
        }, 5000)
        return () => clearInterval(interval)
      },
      onFlightCountUpdated: (callback: (counts: { total: number; military: number }) => void) => {
        const interval = setInterval(async () => {
          try {
            const data = await jsonFetch(`${API_BASE}/adsb/count`) as { total: number; military: number } | null
            if (data) callback(data)
          } catch { /* ignore */ }
        }, 5000)
        return () => clearInterval(interval)
      },
      setVisible: (_visible?: boolean) => Promise.resolve(),
      onCredentialsError: (_callback: (info: { message: string }) => void) => () => {}
    },
    aircraft: {
      lookup: (icao24: string, callsign?: string) =>
        jsonFetch(`${API_BASE}/aircraft/lookup?icao24=${encodeURIComponent(icao24)}${callsign ? `&callsign=${encodeURIComponent(callsign)}` : ''}`),
      getInfo: (icao24: string) =>
        jsonFetch(`${API_BASE}/aircraft/info?icao24=${encodeURIComponent(icao24)}`)
    },
    ais: {
      getMarkers: () => jsonFetch(`${API_BASE}/ais/markers`),
      getGeoJSON: () => jsonFetch(`${API_BASE}/ais/geojson`),
      getDetails: (id: string) => jsonFetch(`${API_BASE}/ais/details?id=${encodeURIComponent(id)}`),
      getCount: () => jsonFetch(`${API_BASE}/ais/count`),
      getCountsByCategory: () => jsonFetch(`${API_BASE}/ais/countsByCategory`),
      getChokePoints: () => jsonFetch(`${API_BASE}/ais/chokepoints`),
      startStreaming: () => post(`${API_BASE}/ais/startStreaming`, {}),
      stopStreaming: () => post(`${API_BASE}/ais/stopStreaming`, {}),
      getStatus: () => jsonFetch(`${API_BASE}/ais/status`),
      onGeoJSONUpdated: (callback: (geojson: unknown) => void) => {
        const interval = setInterval(async () => {
          try {
            const data = await jsonFetch(`${API_BASE}/ais/geojson`)
            if (data) callback(data)
          } catch { /* ignore */ }
        }, 5000)
        return () => clearInterval(interval)
      },
      onVesselCountUpdated: (callback: (counts: { total: number; military: number; cargo: number; tanker: number; passenger: number }) => void) => {
        const interval = setInterval(async () => {
          try {
            const data = await jsonFetch(`${API_BASE}/ais/countsByCategory`) as { total: number; military: number; cargo: number; tanker: number; passenger: number } | null
            if (data) callback(data)
          } catch { /* ignore */ }
        }, 5000)
        return () => clearInterval(interval)
      },
      onFeedHealthUpdated: (callback: (health: { connected: boolean; lastMessageAgeMs: number; feedAlive: boolean }) => void) => {
        const interval = setInterval(async () => {
          try {
            const data = await jsonFetch(`${API_BASE}/ais/status`) as { connected: boolean } | null
            if (data) callback({ connected: data.connected, lastMessageAgeMs: 0, feedAlive: data.connected })
          } catch { /* ignore */ }
        }, 5000)
        return () => clearInterval(interval)
      }
    },
    vessel: {
      lookup: (mmsi: string, shipName?: string, shipType?: string) =>
        jsonFetch(`${API_BASE}/vessel/lookup?mmsi=${encodeURIComponent(mmsi)}${shipName ? `&shipName=${encodeURIComponent(shipName)}` : ''}${shipType ? `&shipType=${encodeURIComponent(shipType)}` : ''}`),
      getInfo: (mmsi: string) =>
        jsonFetch(`${API_BASE}/vessel/info?mmsi=${encodeURIComponent(mmsi)}`)
    },
    tactical: {
      getEvents: (status?: string) =>
        jsonFetch(`${API_BASE}/tactical/events${status ? `?status=${encodeURIComponent(status)}` : ''}`),
      getActiveEvents: () => jsonFetch(`${API_BASE}/tactical/activeEvents`),
      deleteEvents: (eventType?: string) =>
        post(`${API_BASE}/tactical/deleteEvents`, { eventType })
    },
    carrier: {
      getGroups: () => jsonFetch(`${API_BASE}/carrier/groups`),
      getGroupById: (id: string) =>
        jsonFetch(`${API_BASE}/carrier/groups/${encodeURIComponent(id)}`),
      refresh: () => post(`${API_BASE}/carrier/refresh`, {})
    },
    sensemaking: {
      run: () => post(`${API_BASE}/sensemaking/run`, {}),
      status: () => jsonFetch(`${API_BASE}/sensemaking/status`)
    },
    sources: {
      list: () => jsonFetch(`${API_BASE}/sources`),
      toggle: (id: string, enabled: boolean) =>
        post(`${API_BASE}/sources/${encodeURIComponent(id)}/toggle`, { enabled }),
      refresh: (id: string) =>
        post(`${API_BASE}/sources/${encodeURIComponent(id)}/refresh`, {})
    },
    gfw: {
      getPresence: () => jsonFetch(`${API_BASE}/gfw/presence`),
      getPresenceByChokepoint: (chokepoint: string) =>
        jsonFetch(`${API_BASE}/gfw/chokepoints/${encodeURIComponent(chokepoint)}`),
      getStatus: () => jsonFetch(`${API_BASE}/gfw/status`),
      triggerPoll: () => post(`${API_BASE}/gfw/trigger`, {})
    },
    social: {
      getPosts: (limit?: number, source?: 'reddit' | 'bluesky', sourceDetail?: string) =>
        jsonFetch(`${API_BASE}/social/posts?limit=${limit || 50}${source ? `&source=${source}` : ''}${sourceDetail ? `&sourceDetail=${encodeURIComponent(sourceDetail)}` : ''}`),
      getStats: () => jsonFetch(`${API_BASE}/social/stats`),
      pollReddit: () => post(`${API_BASE}/social/pollReddit`, {}),
      pollBlueSky: () => post(`${API_BASE}/social/pollBlueSky`, {})
    },
    economic: {
      poll: () => post(`${API_BASE}/economic/poll`, {}),
      getIndicators: () => jsonFetch(`${API_BASE}/economic/indicators`),
      getAnomalies: () => jsonFetch(`${API_BASE}/economic/anomalies`),
      getStatus: () => jsonFetch(`${API_BASE}/economic/status`),
      start: (intervalMs?: number) => post(`${API_BASE}/economic/start`, { intervalMs }),
      stop: () => post(`${API_BASE}/economic/stop`, {})
    },
    alertRules: {
      list: () => jsonFetch(`${API_BASE}/alert-rules`),
      create: (rule: Record<string, unknown>) => post(`${API_BASE}/alert-rules`, rule),
      update: (id: string, updates: Record<string, unknown>) =>
        put(`${API_BASE}/alert-rules/${encodeURIComponent(id)}`, updates),
      delete: (id: string) =>
        jsonFetch(`${API_BASE}/alert-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      toggle: (id: string) => post(`${API_BASE}/alert-rules/${encodeURIComponent(id)}/toggle`, {})
    },
    zone: {
      list: () => jsonFetch(`${API_BASE}/zones`),
      detail: (id: string) => jsonFetch(`${API_BASE}/zones/${encodeURIComponent(id)}`),
      history: () => jsonFetch(`${API_BASE}/zones/history`),
      refresh: () => post(`${API_BASE}/zones/refresh`, {})
    },
    logger: {
      getRecent: (lines?: number) =>
        jsonFetch(`${API_BASE}/logger/recent?lines=${lines || 100}`)
    }
  }
}

if (!IS_ELECTRON) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = buildHttpApi()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electron = { ipcRenderer: null }
  console.log('[apiTransport] Browser mode — using HTTP REST transport')
}

export {}