/**
 * Data IPC Handlers — expose ingestion and article data to the renderer process.
 */

import { ipcMain } from 'electron'
import {
  getArticles,
  getArticleById,
  getArticlesByRegion,
  getArticlesBySource,
  getRecentArticles,
  getArticleCount,
  getIntelItemCount,
  getIntelItemCountByTier,
  getRecentIntelItems,
  getActiveAnomalies,
  getActiveAnomalyCount,
  deleteIntelItemsByTitle,
  deleteIntelItemsOlderThan,
  deleteIntelItemsByIds
} from '../services/storage/dbService'
import {
  startIngestion,
  stopIngestion,
  getIngestionStatus,
  triggerManualIngestion
} from '../services/ingestion/scheduler'
import { fetchNewsApiEverything } from '../services/ingestion/news'
import { processArticles } from '../services/ingestion/processor'

/** Register all data-related IPC handlers */
export function registerDataHandlers(): void {
  // ── Ingestion Control ──

  ipcMain.handle('ingestion:start', () => {
    startIngestion()
    return { success: true }
  })

  ipcMain.handle('ingestion:stop', () => {
    stopIngestion()
    return { success: true }
  })

  ipcMain.handle('ingestion:status', () => {
    return getIngestionStatus()
  })

  ipcMain.handle('ingestion:trigger', async (_event, gdeltQuery?: string) => {
    return triggerManualIngestion(gdeltQuery)
  })

  /** Search NewsAPI for a specific topic and ingest results */
  ipcMain.handle('ingestion:search', async (_event, query: string) => {
    const raw = await fetchNewsApiEverything(query)
    const result = processArticles(raw)
    return result
  })

  // ── Article Queries ──

  ipcMain.handle('articles:getAll', (_event, limit?: number, offset?: number) => {
    return getArticles(limit, offset)
  })

  ipcMain.handle('articles:getById', (_event, id: string) => {
    return getArticleById(id)
  })

  ipcMain.handle('articles:getByRegion', (_event, region: string, limit?: number) => {
    return getArticlesByRegion(region, limit)
  })

  ipcMain.handle('articles:getBySource', (_event, source: string, limit?: number) => {
    return getArticlesBySource(source, limit)
  })

  ipcMain.handle('articles:getRecent', (_event, hoursBack?: number) => {
    return getRecentArticles(hoursBack)
  })

  ipcMain.handle('articles:getCount', () => {
    return getArticleCount()
  })

  // ── Intel Items ──

  ipcMain.handle('intel:getRecent', (_event, limit?: number, offset?: number) => {
    return getRecentIntelItems(limit, offset)
  })

  ipcMain.handle('intel:getCount', () => {
    return getIntelItemCount()
  })

  ipcMain.handle('intel:getCountByTier', () => {
    return getIntelItemCountByTier()
  })

  ipcMain.handle('intel:deleteByTitle', (_event, titlePattern: string) => {
    return deleteIntelItemsByTitle(titlePattern)
  })

  ipcMain.handle('intel:deleteOlderThan', (_event, hours: number) => {
    return deleteIntelItemsOlderThan(hours)
  })

  ipcMain.handle('intel:deleteByIds', (_event, ids: string[]) => {
    return deleteIntelItemsByIds(ids)
  })

  // ── Anomalies ──

  ipcMain.handle('anomalies:getActive', (_event, limit?: number) => {
    return getActiveAnomalies(limit)
  })

  ipcMain.handle('anomalies:getCount', () => {
    return getActiveAnomalyCount()
  })

  console.log('[ipc] Data handlers registered')
}