/**
 * IPC handlers for the Economic Anomaly Detector.
 */
import { ipcMain } from 'electron'
import {
  pollEconomicIndicators,
  getEconomicIndicators,
  getEconomicAnomalies,
  startEconomicPolling,
  stopEconomicPolling,
  getEconomicStatus
} from '../services/economicService'

export function registerEconomicHandlers(): void {
  // Trigger a manual poll
  ipcMain.handle('economic:poll', async () => {
    return await pollEconomicIndicators()
  })

  // Get all current indicators
  ipcMain.handle('economic:getIndicators', () => {
    return getEconomicIndicators()
  })

  // Get only anomaly-flagged indicators
  ipcMain.handle('economic:getAnomalies', () => {
    return getEconomicAnomalies()
  })

  // Get service status
  ipcMain.handle('economic:getStatus', () => {
    return getEconomicStatus()
  })

  // Start polling
  ipcMain.handle('economic:start', (_event, intervalMs?: number) => {
    startEconomicPolling(intervalMs)
    return { success: true }
  })

  // Stop polling
  ipcMain.handle('economic:stop', () => {
    stopEconomicPolling()
    return { success: true }
  })

  console.log('[IPC] Economic handlers registered')
}