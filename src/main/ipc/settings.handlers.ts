/**
 * IPC handlers for Settings persistence and AI model management.
 * Settings are stored in a JSON file alongside the SQLite database.
 */
import { ipcMain, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { config, reloadConfigFromSettings } from '../utils/config'
import { remoteServer } from '../services/remote/httpServer'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AppSettings {
  // Data Sources
  dataSources: {
    adsb: { enabled: boolean; intervalMs: number }
    ais: { enabled: boolean; intervalMs: number }
    news: { enabled: boolean; intervalMs: number }
  }
  // Alert Preferences
  alerts: {
    militaryFlights: boolean
    chokePoints: boolean
    newsSpikes: boolean
  }
  // Map Preferences
  map: {
    militaryOnly: boolean
    clustering: boolean
  }
  // Notifications
  notifications: {
    alert: boolean
    watch: boolean
    context: boolean
  }
  // Data Retention
  retentionDays: number
  // AI / LLM Configuration (two-slot: Primary + Fallback)
  ai: {
    // Shared Ollama base URL (used by Local and Ollama Cloud providers)
    ollamaBaseUrl: string

    // Primary Model
    primaryProvider: 'local' | 'ollama-cloud' | 'openai-compatible'
    primaryLocalModel: string
    primaryOllamaModel: string
    primaryOpenaiBaseUrl: string
    primaryOpenaiApiKey: string
    primaryOpenaiModel: string

    // Fallback Model
    fallbackEnabled: boolean
    fallbackProvider: 'local' | 'ollama-cloud' | 'openai-compatible'
    fallbackLocalModel: string
    fallbackOllamaModel: string
    fallbackOpenaiBaseUrl: string
    fallbackOpenaiApiKey: string
    fallbackOpenaiModel: string

    // Temperature (shared)
    temperature: number
  }
  // Remote Access (Phase 4I)
  remoteServer: {
    enabled: boolean
    port: number
    requireAuth: boolean
  }
  // Social Media (Phase 5A)
  socialMedia: {
    reddit: { enabled: boolean; intervalMs: number }
    bluesky: { enabled: boolean; intervalMs: number }
  }
  // Economic Monitoring (Phase 5B)
  economic: {
    enabled: boolean
    intervalMs: number
  }
  // API Keys (configured via Settings panel, persisted to settings.json)
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

const DEFAULT_SETTINGS: AppSettings = {
  dataSources: {
    adsb: { enabled: true, intervalMs: 30000 },
    ais: { enabled: true, intervalMs: 60000 },
    news: { enabled: true, intervalMs: 300000 }
  },
  alerts: {
    militaryFlights: true,
    chokePoints: true,
    newsSpikes: true
  },
  map: {
    militaryOnly: false,
    clustering: true
  },
  notifications: {
    alert: true,
    watch: true,
    context: false
  },
  retentionDays: 30,
  ai: {
    ollamaBaseUrl: config.ollamaBaseUrl,
    primaryProvider: 'local',
    primaryLocalModel: 'qwen2.5:3b',
    primaryOllamaModel: '',
    primaryOpenaiBaseUrl: '',
    primaryOpenaiApiKey: '',
    primaryOpenaiModel: '',
    fallbackEnabled: true,
    fallbackProvider: 'local',
    fallbackLocalModel: 'qwen2.5:3b',
    fallbackOllamaModel: '',
    fallbackOpenaiBaseUrl: '',
    fallbackOpenaiApiKey: '',
    fallbackOpenaiModel: '',
    temperature: 0.3
  },
  remoteServer: {
    enabled: false,
    port: 3210,
    requireAuth: false
  },
  socialMedia: {
    reddit: { enabled: true, intervalMs: 1800000 },
    bluesky: { enabled: true, intervalMs: 1800000 }
  },
  economic: {
    enabled: true,
    intervalMs: 1800000 // 30 minutes
  },
  apiKeys: {
    newsApiKey: '',
    openskyUsername: '',
    openskyPassword: '',
    aisstreamApiKey: '',
    gfwApiToken: '',
    fredApiKey: '',
    zaiApiKey: '',
    zaiBaseUrl: 'https://api.z.ai/api/coding/paas/v4'
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

function getSettingsPath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(process.cwd(), 'data')
  return join(dir, 'settings.json')
}

/**
 * Migrate old single-model AI settings to the two-slot architecture.
 * Runs in-place on the parsed JSON before deep-merge.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateAISettings(ai: Record<string, any>): Record<string, any> {
  // If already migrated (has ollamaBaseUrl), nothing to do
  if (ai.ollamaBaseUrl !== undefined) return ai

  const migrated = { ...ai }

  // baseUrl → ollamaBaseUrl
  migrated.ollamaBaseUrl = ai.baseUrl || config.ollamaBaseUrl

  // chatModel → determine primary provider
  const chatModel = ai.chatModel || 'qwen2.5:3b'
  if (chatModel.endsWith('-cloud')) {
    migrated.primaryProvider = 'ollama-cloud'
    migrated.primaryOllamaModel = chatModel
    migrated.primaryLocalModel = 'qwen2.5:3b'
  } else if (ai.cloudProvider === 'openai-compatible') {
    migrated.primaryProvider = 'openai-compatible'
    migrated.primaryLocalModel = 'qwen2.5:3b'
  } else {
    migrated.primaryProvider = 'local'
    migrated.primaryLocalModel = chatModel
  }

  // Cloud OpenAI settings → primary OpenAI settings
  migrated.primaryOpenaiBaseUrl = ai.cloudOpenaiBaseUrl || ''
  migrated.primaryOpenaiApiKey = ai.cloudOpenaiApiKey || ''
  migrated.primaryOpenaiModel = ai.cloudOpenaiModel || ''

  // Fallback
  migrated.fallbackEnabled = ai.fallbackToLocal !== false
  migrated.fallbackProvider = 'local'
  migrated.fallbackLocalModel = 'qwen2.5:3b'
  migrated.fallbackOllamaModel = ''
  migrated.fallbackOpenaiBaseUrl = ''
  migrated.fallbackOpenaiApiKey = ''
  migrated.fallbackOpenaiModel = ''

  // Temperature stays
  migrated.temperature = ai.temperature ?? 0.3

  // Remove old keys
  delete migrated.baseUrl
  delete migrated.chatModel
  delete migrated.cloudProvider
  delete migrated.cloudOpenaiBaseUrl
  delete migrated.cloudOpenaiApiKey
  delete migrated.cloudOpenaiModel
  delete migrated.fallbackToLocal

  return migrated
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    // Migrate old AI settings if needed
    if (parsed.ai) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.ai = migrateAISettings(parsed.ai as Record<string, any>) as AppSettings['ai']
    }
    // Deep-merge with defaults so new keys are always present
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      dataSources: { ...DEFAULT_SETTINGS.dataSources, ...parsed.dataSources },
      alerts: { ...DEFAULT_SETTINGS.alerts, ...parsed.alerts },
      map: { ...DEFAULT_SETTINGS.map, ...parsed.map },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications },
      ai: { ...DEFAULT_SETTINGS.ai, ...parsed.ai },
      remoteServer: { ...DEFAULT_SETTINGS.remoteServer, ...parsed.remoteServer },
      socialMedia: {
        reddit: { ...DEFAULT_SETTINGS.socialMedia.reddit, ...parsed.socialMedia?.reddit },
        bluesky: { ...DEFAULT_SETTINGS.socialMedia.bluesky, ...parsed.socialMedia?.bluesky }
      },
      economic: { ...DEFAULT_SETTINGS.economic, ...parsed.economic },
      apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...parsed.apiKeys }
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Mask string — never expose real API keys to renderer */
const MASK = '••••••••'

/** Check if a value is the mask placeholder */
function isMasked(value: string): boolean {
  return value === MASK
}

/**
 * Return a copy of settings with all API key values masked.
 * The renderer only ever sees `••••••••` for non-empty keys,
 * or `''` for keys that have never been set.
 */
function maskApiKeys(settings: AppSettings): AppSettings {
  return {
    ...settings,
    apiKeys: {
      newsApiKey: settings.apiKeys.newsApiKey ? MASK : '',
      openskyUsername: settings.apiKeys.openskyUsername || '',
      openskyPassword: settings.apiKeys.openskyPassword ? MASK : '',
      aisstreamApiKey: settings.apiKeys.aisstreamApiKey ? MASK : '',
      gfwApiToken: settings.apiKeys.gfwApiToken ? MASK : '',
      fredApiKey: settings.apiKeys.fredApiKey ? MASK : '',
      zaiApiKey: settings.apiKeys.zaiApiKey ? MASK : '',
      // zaiBaseUrl is NOT secret — show it as-is
      zaiBaseUrl: settings.apiKeys.zaiBaseUrl
    }
  }
}

/**
 * Merge incoming API keys with previously saved ones.
 * If the user didn't change a key (sent the mask), preserve the existing value.
 */
export function mergeApiKeys(
  incoming: AppSettings['apiKeys'],
  previous: AppSettings['apiKeys']
): AppSettings['apiKeys'] {
  return {
    newsApiKey: isMasked(incoming.newsApiKey) ? previous.newsApiKey : incoming.newsApiKey,
    openskyUsername: isMasked(incoming.openskyUsername) ? previous.openskyUsername : incoming.openskyUsername,
    openskyPassword: isMasked(incoming.openskyPassword) ? previous.openskyPassword : incoming.openskyPassword,
    aisstreamApiKey: isMasked(incoming.aisstreamApiKey) ? previous.aisstreamApiKey : incoming.aisstreamApiKey,
    gfwApiToken: isMasked(incoming.gfwApiToken) ? previous.gfwApiToken : incoming.gfwApiToken,
    fredApiKey: isMasked(incoming.fredApiKey) ? previous.fredApiKey : incoming.fredApiKey,
    zaiApiKey: isMasked(incoming.zaiApiKey) ? previous.zaiApiKey : incoming.zaiApiKey,
    zaiBaseUrl: incoming.zaiBaseUrl || previous.zaiBaseUrl
  }
}

export function saveSettings(settings: AppSettings): void {
  const path = getSettingsPath()
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
}

// ── Ollama API helpers ─────────────────────────────────────────────────────

interface OllamaModel {
  name: string
  model: string
  modified_at: string
  size: number
}

async function fetchOllamaModels(
  baseUrl: string
): Promise<{ name: string; size: string; modified_at: string }[]> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return []
    const body = (await resp.json()) as { models: OllamaModel[] }
    return (body.models ?? []).map((m) => ({
      name: m.name,
      size: formatBytes(m.size),
      modified_at: m.modified_at
    }))
  } catch {
    return []
  }
}

async function testOllamaConnection(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (resp.ok) return { ok: true }
    return { ok: false, error: `HTTP ${resp.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

export function loadSettingsMasked(): AppSettings {
  return maskApiKeys(loadSettings())
}

// ── IPC Registration ───────────────────────────────────────────────────────

export function registerSettingsHandlers(): void {
  // Load settings (API keys are masked before sending to renderer)
  ipcMain.handle('settings:get', () => {
    const settings = loadSettings()
    return maskApiKeys(settings)
  })

  // Save settings
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    try {
      const previous = loadSettings()
      // Preserve unmasked API keys when the renderer sent the mask placeholder
      const merged: AppSettings = {
        ...settings,
        apiKeys: mergeApiKeys(settings.apiKeys, previous.apiKeys)
      }
      saveSettings(merged)
      // Reload runtime config so services pick up new keys immediately
      reloadConfigFromSettings(merged)

      // Start/stop remote server if setting changed
      try {
        if (settings.remoteServer?.enabled && !previous.remoteServer?.enabled) {
          remoteServer.start(settings.remoteServer.port).catch(console.error)
        } else if (!settings.remoteServer?.enabled && previous.remoteServer?.enabled) {
          remoteServer.stop().catch(console.error)
        } else if (
          settings.remoteServer?.enabled &&
          settings.remoteServer.port !== previous.remoteServer?.port
        ) {
          remoteServer.stop().then(() => remoteServer.start(settings.remoteServer.port)).catch(console.error)
        }
      } catch (remoteErr) {
        console.warn('[SETTINGS] Remote server toggle error:', remoteErr)
      }

      return { success: true }
    } catch (err) {
      console.error('[SETTINGS] Save error:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
    }
  })

  // List available Ollama models
  ipcMain.handle('settings:listModels', async (_event, baseUrl?: string) => {
    const settings = loadSettings()
    const url = baseUrl ?? settings.ai.ollamaBaseUrl
    return await fetchOllamaModels(url)
  })

  // Test Ollama connection
  ipcMain.handle('settings:testConnection', async (_event, baseUrl?: string) => {
    const settings = loadSettings()
    const url = baseUrl ?? settings.ai.ollamaBaseUrl
    return await testOllamaConnection(url)
  })

  // Test OpenAI-compatible connection
  ipcMain.handle(
    'settings:testOpenaiConnection',
    async (_event, baseUrl: string, apiKey: string) => {
      try {
        const url = `${baseUrl.replace(/\/$/, '')}/models`
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000)
        })
        if (resp.ok) return { ok: true }
        return { ok: false, error: `HTTP ${resp.status}` }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Connection failed'
        }
      }
    }
  )

  // Unified AI connection test (primary or fallback)
  ipcMain.handle(
    'settings:testAI',
    async (
      _event,
      testConfig: {
        provider: string
        ollamaBaseUrl?: string
        openaiBaseUrl?: string
        openaiApiKey?: string
      }
    ) => {
      try {
        if (testConfig.provider === 'local' || testConfig.provider === 'ollama-cloud') {
          // Test Ollama connection
          const url = testConfig.ollamaBaseUrl || config.ollamaBaseUrl
          const result = await testOllamaConnection(url)
          if (result.ok) {
            // Also fetch model count
            const models = await fetchOllamaModels(url)
            return { ok: true, models: models.length }
          }
          return result
        } else if (testConfig.provider === 'openai-compatible') {
          // Test OpenAI-compatible connection
          if (!testConfig.openaiBaseUrl || !testConfig.openaiApiKey) {
            return { ok: false, error: 'Base URL and API Key required' }
          }
          const url = `${testConfig.openaiBaseUrl.replace(/\/$/, '')}/models`
          const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${testConfig.openaiApiKey}` },
            signal: AbortSignal.timeout(5000)
          })
          if (resp.ok) {
            try {
              const body = (await resp.json()) as { data?: unknown[] }
              return { ok: true, models: body.data?.length ?? 0 }
            } catch {
              return { ok: true, models: 0 }
            }
          }
          return { ok: false, error: `HTTP ${resp.status}` }
        }
        return { ok: false, error: `Unknown provider: ${testConfig.provider}` }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Connection failed'
        }
      }
    }
  )

  // ── API Key validation ──

  ipcMain.handle('settings:testApiKey', async (_event, service: string) => {
    const settings = loadSettings()
    try {
      switch (service) {
        case 'news': {
          const key = settings.apiKeys.newsApiKey
          if (!key) return { ok: false, error: 'No key configured' }
          const resp = await fetch(`https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${key}`, {
            signal: AbortSignal.timeout(8000)
          })
          const body = (await resp.json()) as { status?: string; code?: string }
          if (body.status === 'ok') return { ok: true }
          return { ok: false, error: body.code ?? `HTTP ${resp.status}` }
        }
        case 'opensky': {
          const user = settings.apiKeys.openskyUsername
          const pass = settings.apiKeys.openskyPassword
          if (!user || !pass) return { ok: false, error: 'Username and password required' }
          const resp = await fetch('https://opensky-network.org/api/states/all?lamin=45&lamax=46&lomin=5&lomax=6&limit=1', {
            headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') },
            signal: AbortSignal.timeout(10000)
          })
          if (resp.ok) return { ok: true }
          if (resp.status === 401) return { ok: false, error: 'Invalid credentials' }
          return { ok: false, error: `HTTP ${resp.status}` }
        }
        case 'aisstream': {
          const key = settings.apiKeys.aisstreamApiKey
          if (!key) return { ok: false, error: 'No key configured' }
          // AISStream uses WebSocket; just verify the key format looks valid
          // A full test requires a WebSocket connection which is too expensive for validation
          if (key.length >= 20) return { ok: true, note: 'Key format valid (WebSocket verified on connect)' }
          return { ok: false, error: 'Key too short' }
        }
        case 'gfw': {
          const token = settings.apiKeys.gfwApiToken
          if (!token) return { ok: false, error: 'No token configured' }
          // GFW v3 API requires POST with body; we do a lightweight GET to check auth.
          // 401/403 = bad token, 404/422 = auth passed (endpoint needs POST body)
          const resp = await fetch('https://gateway.api.globalfishingwatch.org/v3/4wings/report', {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000)
          })
          if (resp.status === 401 || resp.status === 403) return { ok: false, error: 'Invalid or expired token' }
          return { ok: true } // Any other status means auth passed
        }
        case 'fred': {
          const key = settings.apiKeys.fredApiKey
          if (!key) return { ok: false, error: 'No key configured' }
          const resp = await fetch(`https://api.stlouisfed.org/fred/series/updates?api_key=${key}&file_type=json&limit=1`, {
            signal: AbortSignal.timeout(8000)
          })
          if (resp.ok) return { ok: true }
          return { ok: false, error: `HTTP ${resp.status}` }
        }
        default:
          return { ok: false, error: `Unknown service: ${service}` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
    }
  })

  console.log('[IPC] Settings handlers registered')
}