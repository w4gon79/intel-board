/**
 * IPC handlers for exporting AI chat messages as Markdown or PDF.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import {
  exportMessageMarkdown,
  exportMessagePdf,
  exportConversationMarkdown,
  exportConversationPdf,
  messageFilename,
  conversationFilename
} from '../services/export/chatExporter'
import type { ChatExportSource, ChatExportMessage } from '../services/export/chatExporter'
import { getChatConversation } from '../services/storage/dbService'

/** Map DB rows (snake_case) to ChatExportMessage (camelCase) */
function mapConversation(rows: ReturnType<typeof getChatConversation>): ChatExportMessage[] {
  return rows.map((r) => ({
    id: r.id,
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content,
    sources: r.sources ? (JSON.parse(r.sources) as ChatExportSource[]) : undefined,
    confidence: r.confidence ?? undefined,
    createdAt: r.created_at
  }))
}

export function registerChatExportHandlers(): void {
  // ── Single Message Export as Markdown ────────────────────────────────────
  ipcMain.handle(
    'chatExport:messageMarkdown',
    async (
      _event,
      params: {
        content: string
        sources: ChatExportSource[]
        confidence?: number
        query?: string
        createdAt?: string
      }
    ) => {
      try {
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return { success: false, error: 'No active window' }

        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          defaultPath: messageFilename('md'),
          filters: [{ name: 'Markdown', extensions: ['md'] }]
        })

        if (canceled || !filePath) return { success: false, error: 'Cancelled' }

        const md = exportMessageMarkdown(
          params.content,
          params.sources,
          params.confidence,
          params.query,
          params.createdAt
        )

        await writeFile(filePath, md, 'utf-8')
        return { success: true, filePath }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    }
  )

  // ── Single Message Export as PDF ─────────────────────────────────────────
  ipcMain.handle(
    'chatExport:messagePdf',
    async (
      _event,
      params: {
        content: string
        sources: ChatExportSource[]
        confidence?: number
        query?: string
        createdAt?: string
      }
    ) => {
      try {
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return { success: false, error: 'No active window' }

        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          defaultPath: messageFilename('pdf'),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })

        if (canceled || !filePath) return { success: false, error: 'Cancelled' }

        await exportMessagePdf(
          params.content,
          params.sources,
          params.confidence,
          filePath,
          params.query,
          params.createdAt
        )

        return { success: true, filePath }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    }
  )

  // ── Full Conversation Export as Markdown ─────────────────────────────────
  ipcMain.handle('chatExport:conversationMarkdown', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: 'No active window' }

      const rows = getChatConversation()
      if (rows.length === 0) {
        return { success: false, error: 'No messages to export' }
      }
      const messages = mapConversation(rows)

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: conversationFilename('md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })

      if (canceled || !filePath) return { success: false, error: 'Cancelled' }

      const md = exportConversationMarkdown(messages)
      await writeFile(filePath, md, 'utf-8')
      return { success: true, filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── Full Conversation Export as PDF ──────────────────────────────────────
  ipcMain.handle('chatExport:conversationPdf', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: 'No active window' }

      const rows = getChatConversation()
      if (rows.length === 0) {
        return { success: false, error: 'No messages to export' }
      }
      const messages = mapConversation(rows)

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: conversationFilename('pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })

      if (canceled || !filePath) return { success: false, error: 'Cancelled' }

      await exportConversationPdf(messages, filePath)
      return { success: true, filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })
}