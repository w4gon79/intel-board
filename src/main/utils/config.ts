/**
 * Configuration loader — runtime config updated from persisted settings.
 * API keys are configured through the Settings panel and stored in data/settings.json.
 */

function env(key: string, fallback: string = ''): string {
  return process.env[key] ?? fallback
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AppSettingsLike { ai?: { ollamaBaseUrl?: string }; apiKeys?: Record<string, any> }

export const config = {
  /** News API key — https://newsapi.org */
  newsApiKey: '',

  /** Ollama base URL for local LLM */
  ollamaBaseUrl: 'http://localhost:11434',

  /** ChromaDB server URL */
  chromaUrl: env('CHROMA_URL', 'http://localhost:8000'),

  /** Embedding model (always local, not user-selectable) */
  embeddingModel: 'nomic-embed-text' as string,

  /** Z.ai cloud API key (optional) */
  zaiApiKey: '',
  zaiBaseUrl: 'https://api.z.ai/api/coding/paas/v4',

  /** FRED API key (Phase 4) */
  fredApiKey: '',

  /** OpenSky Network OAuth2 credentials (ADS-B) */
  openskyUsername: '',
  openskyPassword: '',

  /** AISStream.io WebSocket API key */
  aisstreamApiKey: '',

  /** Global Fishing Watch API token */
  gfwApiToken: '',

  /** Ingestion polling intervals in milliseconds */
  polling: {
    newsMs: 5 * 60 * 1000, // 5 min default
    adsbMs: 60 * 1000, // 60 sec
    aisMs: 60 * 1000, // 1 min
    weatherMs: 15 * 60 * 1000 // 15 min
  }
}

/**
 * Override config values from persisted settings.
 * Called on startup and whenever the user saves settings.
 */
export function reloadConfigFromSettings(settings: AppSettingsLike): void {
  if (settings.apiKeys) {
    if (settings.apiKeys.newsApiKey) config.newsApiKey = settings.apiKeys.newsApiKey as string
    if (settings.apiKeys.openskyUsername) config.openskyUsername = settings.apiKeys.openskyUsername as string
    if (settings.apiKeys.openskyPassword) config.openskyPassword = settings.apiKeys.openskyPassword as string
    if (settings.apiKeys.aisstreamApiKey) config.aisstreamApiKey = settings.apiKeys.aisstreamApiKey as string
    if (settings.apiKeys.gfwApiToken) config.gfwApiToken = settings.apiKeys.gfwApiToken as string
    if (settings.apiKeys.fredApiKey) config.fredApiKey = settings.apiKeys.fredApiKey as string
    if (settings.apiKeys.zaiApiKey) config.zaiApiKey = settings.apiKeys.zaiApiKey as string
    if (settings.apiKeys.zaiBaseUrl) config.zaiBaseUrl = settings.apiKeys.zaiBaseUrl as string
  }
  if (settings.ai?.ollamaBaseUrl) {
    config.ollamaBaseUrl = settings.ai.ollamaBaseUrl
  }
}