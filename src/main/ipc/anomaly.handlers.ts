/**
 * IPC handlers for Anomalies
 */
import { ipcMain } from 'electron'
import { getDatabase } from '../services/storage/database'

export function registerAnomalyHandlers(): void {
  // Get active anomalies
  ipcMain.handle('anomalies:getActive', async (_event, limit: number = 50) => {
    try {
      const db = getDatabase()
      return db
        .prepare(
          `SELECT a.*, i.title, i.content, i.tier, i.category
           FROM anomalies a
           LEFT JOIN intel_items i ON a.intel_item_id = i.id
           WHERE a.detected_at >= datetime('now', '-7 days')
           ORDER BY a.detected_at DESC
           LIMIT ?`
        )
        .all(limit)
    } catch (error) {
      console.error('[ANOMALIES] getActive error:', error)
      return []
    }
  })

  // Get anomaly count
  ipcMain.handle('anomalies:getCount', async () => {
    try {
      const db = getDatabase()
      const result = db
        .prepare(
          `SELECT COUNT(*) as count FROM anomalies WHERE detected_at >= datetime('now', '-24 hours')`
        )
        .get() as { count: number }
      return result?.count ?? 0
    } catch (error) {
      console.error('[ANOMALIES] getCount error:', error)
      return 0
    }
  })

  console.log('[IPC] Anomaly handlers registered')
}