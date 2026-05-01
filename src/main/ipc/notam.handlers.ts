/**
 * IPC handlers for NOTAM (Notice to Air Missions) data.
 *
 * Provides:
 * - notam:list — active NOTAMs (not expired)
 * - notam:by-zone — NOTAMs within a conflict zone's radius
 * - notam:refresh — manual trigger
 * - notam:status — diagnostic info
 */

import { ipcMain } from 'electron'
import {
  getActiveNotams,
  getNotamsByZone,
  pollNotams,
  getNotamStatus,
  startNotamScheduler,
  stopNotamScheduler
} from '../services/scrapers/notamScraper'
import { loadSettings } from './settings.handlers'

export function registerNotamHandlers(): void {
  // List active NOTAMs
  ipcMain.handle('notam:list', async (_event, limit?: number) => {
    return getActiveNotams(limit ?? 100)
  })

  // Get NOTAMs within a conflict zone's radius
  ipcMain.handle('notam:by-zone', async (_event, zoneId?: string) => {
    if (!zoneId) return []

    // Look up zone from DB to get its center and radius
    const { getDatabase } = await import('../services/storage/database')
    const db = getDatabase()
    const zone = db.prepare(
      'SELECT center_lat, center_lon, radius_nm FROM conflict_zones WHERE id = ?'
    ).get(zoneId) as { center_lat: number; center_lon: number; radius_nm: number } | undefined

    if (!zone) return []
    return getNotamsByZone(zone.center_lat, zone.center_lon, zone.radius_nm)
  })

  // Manual refresh trigger
  ipcMain.handle('notam:refresh', async () => {
    try {
      const result = await pollNotams()
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get NOTAM status
  ipcMain.handle('notam:status', async () => {
    return getNotamStatus()
  })

  console.log('[IPC] NOTAM handlers registered')
}

/**
 * Start the NOTAM scheduler if enabled in settings.
 */
export function initNotamScheduler(): void {
  try {
    const settings = loadSettings()
    if (settings.notam?.enabled !== false) {
      const intervalMs = settings.notam?.intervalMs ?? 4 * 60 * 60 * 1000
      startNotamScheduler(intervalMs)
    } else {
      console.log('[NOTAM] Disabled in settings')
    }
  } catch {
    // Settings not available, start with defaults
    startNotamScheduler()
  }
}

/**
 * Stop the NOTAM scheduler.
 */
export function stopNotamSchedulerHandlers(): void {
  stopNotamScheduler()
}