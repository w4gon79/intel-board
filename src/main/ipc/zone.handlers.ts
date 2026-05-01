/**
 * IPC Handlers for Dynamic Conflict Zones
 */

import { ipcMain } from 'electron'
import {
  getActiveConflictZones,
  getZoneDetail,
  getZoneHistory,
  runZoneEngine
} from '../services/analysis/zoneEngine'

export function registerZoneHandlers(): void {
  // Get all non-resolved zones (for map layer)
  ipcMain.handle('zone:list', () => {
    return getActiveConflictZones()
  })

  // Get zone detail + evidence trail
  ipcMain.handle('zone:detail', (_event, id: string) => {
    return getZoneDetail(id)
  })

  // Get resolved zone history (last 30 days)
  ipcMain.handle('zone:history', () => {
    return getZoneHistory()
  })

  // Manually trigger zone engine refresh
  ipcMain.handle('zone:refresh', () => {
    runZoneEngine()
    return { ok: true }
  })

  console.log('[IPC] Zone handlers registered')
}