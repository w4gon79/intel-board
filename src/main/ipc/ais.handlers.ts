/**
 * AIS IPC Handlers
 *
 * Bridges the renderer ↔ main process for live vessel tracking data.
 * Follows the same pattern as adsb.handlers.ts.
 */

import { ipcMain, BrowserWindow } from 'electron'
import {
  getLiveVesselMarkers,
  getVesselGeoJSON,
  getVesselDetails,
  getVesselCount,
  getVesselCountsByCategory,
  getChokePointCounts,
  startAisStreaming,
  stopAisStreaming,
  getAisFeedHealth
} from '../services/ais/aisService'
import { lookupVessel, getCachedVesselInfo } from '../services/identification/vesselLookup'

// ─── Channel names ───────────────────────────────────────────

const CHANNELS = {
  GET_MARKERS: 'ais:getMarkers',
  GET_GEOJSON: 'ais:getGeoJSON',
  GET_DETAILS: 'ais:getDetails',
  GET_COUNT: 'ais:getCount',
  GET_COUNTS_BY_CATEGORY: 'ais:getCountsByCategory',
  GET_CHOKE_POINTS: 'ais:getChokePoints',
  START_STREAMING: 'ais:startStreaming',
  STOP_STREAMING: 'ais:stopStreaming',
  GET_STATUS: 'ais:getStatus',
  // Vessel identification (Phase 4B)
  VESSEL_LOOKUP: 'vessel:lookup',
  VESSEL_GET_INFO: 'vessel:getInfo',
  // Main → renderer push
  GEOJSON_UPDATED: 'ais:geojsonUpdated',
  VESSEL_COUNT_UPDATED: 'ais:vesselCountUpdated',
  FEED_HEALTH_UPDATED: 'ais:feedHealthUpdated'
} as const

// ─── State ───────────────────────────────────────────────────

let pushTimer: ReturnType<typeof setInterval> | null = null
let isPushing = false

/**
 * Push latest GeoJSON and counts to all renderer windows.
 */
function pushToRenderers(): void {
  try {
    const geojson = getVesselGeoJSON()
    const counts = getVesselCountsByCategory()

    const health = getAisFeedHealth()

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(CHANNELS.GEOJSON_UPDATED, geojson)
          win.webContents.send(CHANNELS.VESSEL_COUNT_UPDATED, counts)
          win.webContents.send(CHANNELS.FEED_HEALTH_UPDATED, health)
        } catch {
          // Renderer frame disposed (e.g., HMR refresh) — skip silently
        }
      }
    }
  } catch (err) {
    console.error('[AIS] Push to renderers failed:', err)
  }
}

// ─── Handler registration ────────────────────────────────────

export function registerAisHandlers(): void {
  console.log('[AIS] Registering IPC handlers')

  ipcMain.handle(CHANNELS.GET_MARKERS, async () => {
    return getLiveVesselMarkers()
  })

  ipcMain.handle(CHANNELS.GET_GEOJSON, async () => {
    return getVesselGeoJSON()
  })

  ipcMain.handle(CHANNELS.GET_DETAILS, async (_event, id: string) => {
    return getVesselDetails(id)
  })

  ipcMain.handle(CHANNELS.GET_COUNT, async () => {
    return getVesselCount()
  })

  ipcMain.handle(CHANNELS.GET_COUNTS_BY_CATEGORY, async () => {
    return getVesselCountsByCategory()
  })

  ipcMain.handle(CHANNELS.GET_CHOKE_POINTS, async () => {
    return getChokePointCounts()
  })

  ipcMain.handle(CHANNELS.START_STREAMING, async () => {
    startAisStreaming()
    // Start pushing to renderers on a cadence
    if (!isPushing) {
      isPushing = true
      pushTimer = setInterval(pushToRenderers, 5_000)
    }
    return true
  })

  ipcMain.handle(CHANNELS.STOP_STREAMING, async () => {
    stopAisStreaming()
    if (pushTimer !== null) {
      clearInterval(pushTimer)
      pushTimer = null
    }
    isPushing = false
    return true
  })

  ipcMain.handle(CHANNELS.GET_STATUS, async () => {
    return getAisFeedHealth()
  })

  // ── Vessel Identification (Phase 4B) ──

  ipcMain.handle(CHANNELS.VESSEL_LOOKUP, async (_event, mmsi: string) => {
    return lookupVessel(mmsi)
  })

  ipcMain.handle(CHANNELS.VESSEL_GET_INFO, async (_event, mmsi: string) => {
    return getCachedVesselInfo(mmsi)
  })
}

/**
 * Stop AIS streaming and push timers (for app shutdown).
 */
export function stopAisHandlers(): void {
  stopAisStreaming()
  if (pushTimer !== null) {
    clearInterval(pushTimer)
    pushTimer = null
  }
  isPushing = false
}