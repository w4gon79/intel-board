/**
 * IPC handlers for Tactical Events
 */
import { ipcMain } from 'electron'
import { getTacticalEvents, getActiveTacticalEvents } from '../services/identification/tacticalEngine'
import { deleteTacticalEvents } from '../services/storage/dbService'

export function registerTacticalHandlers(): void {
  // Get tactical events (optionally filtered by status)
  ipcMain.handle('tactical:getEvents', async (_event, status?: string) => {
    try {
      return await getTacticalEvents(status)
    } catch (error) {
      console.error('[TACTICAL] getEvents error:', error)
      return []
    }
  })

  // Get active tactical events only
  ipcMain.handle('tactical:getActiveEvents', async () => {
    try {
      return await getActiveTacticalEvents()
    } catch (error) {
      console.error('[TACTICAL] getActiveEvents error:', error)
      return []
    }
  })

  // Delete tactical events, optionally filtered by event type
  ipcMain.handle('tactical:deleteEvents', async (_event, eventType?: string) => {
    try {
      return deleteTacticalEvents(eventType)
    } catch (error) {
      console.error('[TACTICAL] deleteEvents error:', error)
      return 0
    }
  })

  console.log('[IPC] Tactical handlers registered')
}
