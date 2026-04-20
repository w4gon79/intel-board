/**
 * IPC handlers for Predictions
 */
import { ipcMain } from 'electron'
import { getDatabase } from '../services/storage/database'
import { getPredictionsWithReviews } from '../services/storage/dbService'

/** Parse a JSON string from SQLite back to an array (defensive) */
function parseJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function registerPredictionHandlers(): void {
  const db = getDatabase()

  // Ensure predictions table exists (matches database.ts canonical schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      prediction_text TEXT,
      confidence REAL,
      model_used TEXT,
      sources TEXT,
      predicted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expected_by DATETIME,
      outcome TEXT,
      resolved_at DATETIME,
      was_accurate BOOLEAN,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','expired'))
    )
  `)

  // Get unresolved (active) predictions
  ipcMain.handle('predictions:getUnresolved', async (_event, limit: number = 20) => {
    try {
      const rows = db
        .prepare(
          `SELECT * FROM predictions WHERE status = 'active' ORDER BY predicted_at DESC LIMIT ?`
        )
        .all(limit) as Record<string, unknown>[]
      // Hydrate JSON fields (sources stored as JSON string in SQLite)
      return rows.map((row) => ({
        ...row,
        sources: parseJsonArray(row.sources as string | null)
      }))
    } catch (error) {
      console.error('[PREDICTIONS] getUnresolved error:', error)
      return []
    }
  })

  // Review a prediction
  ipcMain.handle(
    'predictions:review',
    async (_event, id: string, outcome: string, wasAccurate: boolean) => {
      try {
        db.prepare(
          `UPDATE predictions
           SET status = 'resolved', outcome = ?, was_accurate = ?, resolved_at = datetime('now')
           WHERE id = ?`
        ).run(outcome, wasAccurate ? 1 : 0, id)
        return true
      } catch (error) {
        console.error('[PREDICTIONS] review error:', error)
        return false
      }
    }
  )

  // Get prediction accuracy stats
  ipcMain.handle('predictions:getAccuracy', async () => {
    try {
      const total = (
        db.prepare('SELECT COUNT(*) as count FROM predictions').get() as {
          count: number
        }
      ).count
      const resolved = (
        db.prepare("SELECT COUNT(*) as count FROM predictions WHERE status = 'resolved'").get() as {
          count: number
        }
      ).count
      const accurate = (
        db.prepare('SELECT COUNT(*) as count FROM predictions WHERE was_accurate = 1').get() as {
          count: number
        }
      ).count
      const inaccurate = (
        db.prepare('SELECT COUNT(*) as count FROM predictions WHERE was_accurate = 0').get() as {
          count: number
        }
      ).count

      return {
        total,
        resolved,
        accurate,
        inaccurate,
        accuracyRate: (accurate + inaccurate) > 0 ? accurate / (accurate + inaccurate) : 0
      }
    } catch (error) {
      console.error('[PREDICTIONS] getAccuracy error:', error)
      return { total: 0, resolved: 0, accurate: 0, inaccurate: 0, accuracyRate: 0 }
    }
  })

  // Get all predictions with review data (tiered: active → overdue → analyzed)
  ipcMain.handle('predictions:getWithReviews', () => {
    return getPredictionsWithReviews()
  })

  console.log('[IPC] Prediction handlers registered')
}
