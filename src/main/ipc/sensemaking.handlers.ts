/**
 * IPC handlers for the AI Sense-Making Engine and Prediction Review system.
 */
import { ipcMain } from 'electron'
import {
  runSenseMaking,
  getSenseMakingStatus
} from '../services/senseMakingEngine'
import {
  getReviewStats,
  getCalibrationContext,
  reviewOverduePredictions
} from '../services/analysis/predictionReviewer'
import { getReviewsByPredictionId } from '../services/storage/dbService'

export function registerSenseMakingHandlers(): void {
  ipcMain.handle('sensemaking:run', async () => {
    await runSenseMaking()
    return { success: true }
  })

  ipcMain.handle('sensemaking:status', async () => {
    return getSenseMakingStatus()
  })

  // ── Prediction Review IPC handlers ──

  // Get review stats for the UI
  ipcMain.handle('prediction:review-stats', () => getReviewStats())

  // Get calibration data
  ipcMain.handle('prediction:calibration', () => getCalibrationContext('all'))

  // Manually trigger a review cycle
  ipcMain.handle('prediction:trigger-review', async () => {
    const count = await reviewOverduePredictions()
    return { reviewed: count }
  })

  // Get reviews for a specific prediction
  ipcMain.handle('prediction:reviews', (_e, predictionId: string) => {
    return getReviewsByPredictionId(predictionId)
  })

  console.log('[IPC] Sense-making + prediction review handlers registered')
}
