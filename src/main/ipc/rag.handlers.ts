/**
 * RAG IPC Handlers — expose the RAG pipeline to the renderer process.
 */

import { ipcMain } from 'electron'
import { executeRAG, quickAnalysis, getAvailableModels } from '../services/rag/pipeline'
import { isEmbedderHealthy } from '../services/rag/embedder'
import { isLLMHealthy } from '../services/rag/llm'
import { getVectorStoreStatus } from '../services/storage/vectordb'
import type { RAGRequest } from '../../shared/types'

/** Register all RAG-related IPC handlers */
export function registerRAGHandlers(): void {
  // ── RAG Query ──

  ipcMain.handle('rag:query', async (_event, request: RAGRequest) => {
    return executeRAG(request)
  })

  ipcMain.handle('rag:quickAnalysis', async (_event, topic: string, region?: string) => {
    return quickAnalysis(topic, region)
  })

  // ── Model Management ──

  ipcMain.handle('rag:listModels', async () => {
    return getAvailableModels()
  })

  // ── Health Checks ──

  ipcMain.handle('rag:status', async () => {
    const [vectorStatus, embedderStatus, llmStatus] = await Promise.all([
      getVectorStoreStatus(),
      isEmbedderHealthy(),
      isLLMHealthy()
    ])

    return {
      vectorStore: vectorStatus,
      embedder: embedderStatus,
      llm: llmStatus,
      ready: vectorStatus.connected && embedderStatus.healthy && llmStatus.healthy
    }
  })

  console.log('[ipc] RAG handlers registered')
}