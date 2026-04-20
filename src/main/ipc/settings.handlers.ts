/**
 * IPC handlers for Settings persistence and AI model management.
 * Settings are stored in a JSON file alongside the SQLite database.
 */
import { ipcMain, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { config } from '../utils/config'
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
  // AI / LLM Configuration
  ai: {
    baseUrl: string
    chatModel: string
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
    baseUrl: config.ollamaBaseUrl,
    chatModel: 'qwen2.5:3b',
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
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

function getSettingsPath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(process.cwd(), 'data')
  return join(dir, 'settings.json')
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
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
      economic: { ...DEFAULT_SETTINGS.economic, ...parsed.economic }
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(settings: AppSettings): void {
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

// ── IPC Registration ───────────────────────────────────────────────────────

export function registerSettingsHandlers(): void {
  // Load settings
  ipcMain.handle('settings:get', () => {
    return loadSettings()
  })

  // Save settings
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    try {
      const previous = loadSettings()
      saveSettings(settings)

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
    const url = baseUrl ?? settings.ai.baseUrl
    return await fetchOllamaModels(url)
  })

  // Test Ollama connection
  ipcMain.handle('settings:testConnection', async (_event, baseUrl?: string) => {
    const settings = loadSettings()
    const url = baseUrl ?? settings.ai.baseUrl
    return await testOllamaConnection(url)
  })

  console.log('[IPC] Settings handlers registered')
}