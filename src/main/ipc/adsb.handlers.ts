/**
 * ADS-B IPC Handlers
 *
 * Bridges the renderer ↔ main process for live flight data.
 */

import { ipcMain, BrowserWindow } from 'electron'
import {
  getLiveFlightMarkers,
  getFlightGeoJSON,
  getFlightDetails,
  getFlightCount,
  getMilitaryFlightCount,
  startAdsbPolling,
  stopAdsbPolling,
  pollAdsb,
  setAdsWindowVisible
} from '../services/adsb/adsbService'
import { lookupAircraft, getCachedAircraftInfo } from '../services/identification/aircraftLookup'

// ─── Channel names ───────────────────────────────────────────

const CHANNELS = {
  GET_MARKERS: 'adsb:getMarkers',
  GET_GEOJSON: 'adsb:getGeoJSON',
  GET_DETAILS: 'adsb:getDetails',
  GET_COUNT: 'adsb:getCount',
  GET_MILITARY_COUNT: 'adsb:getMilitaryCount',
  START_POLLING: 'adsb:startPolling',
  STOP_POLLING: 'adsb:stopPolling',
  POLL_NOW: 'adsb:pollNow',
  // Aircraft identification
  AIRCRAFT_LOOKUP: 'aircraft:lookup',
  AIRCRAFT_GET_INFO: 'aircraft:getInfo',
  // Main → renderer push
  MARKERS_UPDATED: 'adsb:markersUpdated',
  GEOJSON_UPDATED: 'adsb:geojsonUpdated',
  FLIGHT_COUNT_UPDATED: 'adsb:flightCountUpdated'
} as const

// ─── State ───────────────────────────────────────────────────

let pushTimer: ReturnType<typeof setInterval> | null = null
let isPushing = false

/**
 * Push latest GeoJSON, markers & count to all renderer windows.
 */
function pushToRenderers(): void {
  try {
    const geojson = getFlightGeoJSON()
    const markers = getLiveFlightMarkers()
    const count = getFlightCount()
    const milCount = getMilitaryFlightCount()

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(CHANNELS.GEOJSON_UPDATED, geojson)
          win.webContents.send(CHANNELS.MARKERS_UPDATED, markers)
          win.webContents.send(CHANNELS.FLIGHT_COUNT_UPDATED, { total: count, military: milCount })
        } catch {
          // Renderer frame disposed (e.g., HMR refresh) — skip silently
        }
      }
    }
  } catch (err) {
    console.error('[ADSB] Push to renderers failed:', err)
  }
}

// ─── Handler registration ────────────────────────────────────

export function registerAdsbHandlers(): void {
  console.log('[ADSB] Registering IPC handlers')

  ipcMain.handle(CHANNELS.GET_MARKERS, async () => {
    return getLiveFlightMarkers()
  })

  ipcMain.handle(CHANNELS.GET_GEOJSON, async () => {
    return getFlightGeoJSON()
  })

  ipcMain.handle(CHANNELS.GET_DETAILS, async (_event, id: string) => {
    return getFlightDetails(id)
  })

  ipcMain.handle(CHANNELS.GET_COUNT, async () => {
    return { total: getFlightCount(), military: getMilitaryFlightCount() }
  })

  ipcMain.handle(CHANNELS.GET_MILITARY_COUNT, async () => {
    return getMilitaryFlightCount()
  })

  ipcMain.handle(CHANNELS.START_POLLING, async (_event, intervalMs?: number) => {
    startAdsbPolling(intervalMs)
    // Also start pushing to renderers on a cadence
    if (!isPushing) {
      isPushing = true
      pushTimer = setInterval(pushToRenderers, 5_000)
    }
    return true
  })

  ipcMain.handle(CHANNELS.STOP_POLLING, async () => {
    stopAdsbPolling()
    if (pushTimer !== null) {
      clearInterval(pushTimer)
      pushTimer = null
    }
    isPushing = false
    return true
  })

  ipcMain.handle('adsb:set-visible', (_event, visible: boolean) => {
    setAdsWindowVisible(visible)
  })

  ipcMain.handle(CHANNELS.POLL_NOW, async () => {
    const count = await pollAdsb()
    // Push immediately after manual poll
    pushToRenderers()
    return count
  })

  // ── Aircraft Identification (Phase 4A) ──

  ipcMain.handle(CHANNELS.AIRCRAFT_LOOKUP, async (_event, icao24: string, callsign?: string) => {
    return lookupAircraft(icao24, callsign)
  })

  ipcMain.handle(CHANNELS.AIRCRAFT_GET_INFO, async (_event, icao24: string) => {
    return getCachedAircraftInfo(icao24)
  })
}

/**
 * Stop ADS-B polling and push timers (for app shutdown).
 */
export function stopAdsbHandlers(): void {
  stopAdsbPolling()
  if (pushTimer !== null) {
    clearInterval(pushTimer)
    pushTimer = null
  }
  isPushing = false
}