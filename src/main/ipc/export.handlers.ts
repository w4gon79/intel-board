/**
 * IPC handlers for exporting intel reports as Markdown or PDF.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { getIntelItemsForExport } from '../services/storage/dbService'
import { generateMarkdownReport } from '../services/export/markdownExporter'
import { generatePdfReport } from '../services/export/pdfExporter'
import { saveMapImage, type MapExportMetadata } from '../services/export/mapExporter'
import type { IntelTier } from '../../shared/types'

function getDefaultFilename(tier: IntelTier | null | undefined, ext: string): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  if (tier) {
    return `intel-report-${tier}-${dateStr}.${ext}`
  }
  return `intel-report-${dateStr}.${ext}`
}

export function registerExportHandlers(): void {
  // Export as Markdown
  ipcMain.handle(
    'export:markdown',
    async (_event, options: { tier?: IntelTier | null; hoursBack?: number | null }) => {
      try {
        const items = getIntelItemsForExport({
          tier: options.tier ?? null,
          hoursBack: options.hoursBack ?? null
        })

        if (items.length === 0) {
          return { success: false, error: 'No intel items found for the selected filters.' }
        }

        const markdown = generateMarkdownReport(items, {
          tier: options.tier,
          hoursBack: options.hoursBack
        })

        const win = BrowserWindow.getFocusedWindow()
        const { filePath, canceled } = await dialog.showSaveDialog(win!, {
          title: 'Export Intel Report as Markdown',
          defaultPath: getDefaultFilename(options.tier, 'md'),
          filters: [{ name: 'Markdown', extensions: ['md'] }]
        })

        if (canceled || !filePath) {
          return { success: false, canceled: true }
        }

        await writeFile(filePath, markdown, 'utf-8')
        return { success: true, path: filePath, itemCount: items.length }
      } catch (err) {
        console.error('[export:markdown] Error:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error during Markdown export'
        }
      }
    }
  )

  // Export as PDF
  ipcMain.handle(
    'export:pdf',
    async (_event, options: { tier?: IntelTier | null; hoursBack?: number | null }) => {
      try {
        const items = getIntelItemsForExport({
          tier: options.tier ?? null,
          hoursBack: options.hoursBack ?? null
        })

        if (items.length === 0) {
          return { success: false, error: 'No intel items found for the selected filters.' }
        }

        const win = BrowserWindow.getFocusedWindow()
        const { filePath, canceled } = await dialog.showSaveDialog(win!, {
          title: 'Export Intel Report as PDF',
          defaultPath: getDefaultFilename(options.tier, 'pdf'),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })

        if (canceled || !filePath) {
          return { success: false, canceled: true }
        }

        await generatePdfReport(items, { tier: options.tier, hoursBack: options.hoursBack }, filePath)
        return { success: true, path: filePath, itemCount: items.length }
      } catch (err) {
        console.error('[export:pdf] Error:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error during PDF export'
        }
      }
    }
  )

  // Export map as PNG image
  ipcMain.handle(
    'export:mapImage',
    async (
      _event,
      options: {
        imageDataUrl: string
        metadata: MapExportMetadata
        includeMetadataBar?: boolean
      }
    ) => {
      try {
        const now = new Date()
        const dateStr = now.toISOString().slice(0, 10)
        const defaultFilename = `intel-map-${dateStr}.png`

        const win = BrowserWindow.getFocusedWindow()
        const { filePath, canceled } = await dialog.showSaveDialog(win!, {
          title: 'Export Map as Image',
          defaultPath: defaultFilename,
          filters: [{ name: 'PNG Image', extensions: ['png'] }]
        })

        if (canceled || !filePath) {
          return { success: false, canceled: true }
        }

        await saveMapImage(
          filePath,
          options.imageDataUrl,
          options.metadata,
          options.includeMetadataBar ?? true
        )

        return { success: true, path: filePath }
      } catch (err) {
        console.error('[export:mapImage] Error:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error during map export'
        }
      }
    }
  )

  console.log('[IPC] Export handlers registered')
}
