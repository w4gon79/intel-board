/**
 * Configuration loader — reads environment variables for API keys and settings.
 * Uses dotenv for .env file support, falls back to system env vars.
 */

import dotenv from 'dotenv'
import { app } from 'electron'
import { join } from 'path'

// Load .env from project root (dev) or app resources (production)
dotenv.config({ path: join(app.getAppPath(), '.env') })

function env(key: string, fallback: string = ''): string {
  return process.env[key] ?? fallback
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key]
  return val ? parseInt(val, 10) : fallback
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AppSettingsLike { ai?: { ollamaBaseUrl?: string }; apiKeys?: Record<string, any> }

export const config = {
  /** Mapbox access token (renderer uses VITE_MAPBOX_TOKEN via Vite) */
  mapboxToken: env('VITE_MAPBOX_TOKEN'),

  /** News API key — https://newsapi.org */
  newsApiKey: env('NEWS_API_KEY'),

  /** Ollama base URL for local LLM */
  ollamaBaseUrl: env('OLLAMA_BASE_URL', 'http://localhost:11434'),

  /** ChromaDB server URL */
  chromaUrl: env('CHROMA_URL', 'http://localhost:8000'),

  /** Embedding model (always local, not user-selectable) */
  embeddingModel: 'nomic-embed-text' as string,

  /** Z.ai cloud API key (optional) */
  zaiApiKey: env('ZAI_API_KEY'),
  zaiBaseUrl: env('ZAI_BASE_URL', 'https://api.z.ai/api/coding/paas/v4'),

  /** ADS-B Exchange API key (Phase 2) */
  adsbApiKey: env('ADSB_API_KEY'),

  /** Marine Traffic API key (Phase 2) */
  marineTrafficApiKey: env('MARINE_TRAFFIC_API_KEY'),

  /** FRED API key (Phase 4) */
  fredApiKey: env('FRED_API_KEY'),

  /** OpenSky Network OAuth2 credentials (ADS-B) */
  openskyUsername: env('OPENSKY_USERNAME', ''),
  openskyPassword: env('OPENSKY_PASSWORD', ''),

  /** AISStream.io WebSocket API key */
  aisstreamApiKey: env('AISSTREAM_API_KEY', ''),

  /** Global Fishing Watch API token */
  gfwApiToken: env('GFW_API_TOKEN', ''),

  /** Ingestion polling intervals in milliseconds */
  polling: {
    newsMs: envInt('NEWS_POLL_MS', 5 * 60 * 1000), // 5 min default
    adsbMs: envInt('ADSB_POLL_MS', 60 * 1000), // 60 sec
    aisMs: envInt('AIS_POLL_MS', 60 * 1000), // 1 min
    weatherMs: envInt('WEATHER_POLL_MS', 15 * 60 * 1000) // 15 min
  },

  /** Whether API keys are configured */
  hasNewsApiKey: env('NEWS_API_KEY') !== '',
  hasOllama: env('OLLAMA_BASE_URL') !== ''
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
  // Update derived flags
  config.hasNewsApiKey = config.newsApiKey !== ''
}

/** Validate that required keys exist for a given service */
export function requireKey(service: 'news' | 'adsb' | 'ais' | 'fred'): boolean {
  switch (service) {
    case 'news':
      return config.hasNewsApiKey
    case 'adsb':
      return config.adsbApiKey !== ''
    case 'ais':
      return config.marineTrafficApiKey !== ''
    case 'fred':
      return config.fredApiKey !== ''
    default:
      return false
  }
}
