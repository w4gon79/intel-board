/**
 * Source Management IPC Handlers (Phase 4G)
 *
 * Allows the renderer to list, toggle, and refresh scraper sources.
 */

import { ipcMain } from 'electron'
import { getScraperStatus, toggleScraper, refreshScraper } from '../services/scrapers/scraperManager'

export function registerSourceHandlers(): void {
  // List all scrapers and their status
  ipcMain.handle('sources:list', async () => {
    return getScraperStatus()
  })

  // Toggle a scraper on/off
  ipcMain.handle('sources:toggle', async (_e, id: string, enabled: boolean) => {
    return toggleScraper(id, enabled)
  })

  // Manually trigger a scraper refresh
  ipcMain.handle('sources:refresh', async (_e, id: string) => {
    const inserted = await refreshScraper(id)
    return { inserted }
  })

  console.log('[IPC] Source management handlers registered')
}