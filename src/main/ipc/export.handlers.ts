/**
 * IPC handlers for exporting intel reports as Markdown or PDF.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { getIntelItemsForExport } from '../services/storage/dbService'
import { generateMarkdownReport } from '../services/export/markdownExporter'
import { generatePdfReport } from '../services/export/pdfExporter'
import { compositeMetadataBar, type MapExportMetadata } from '../services/export/mapExporter'
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

  // Export map as PNG image — uses Electron's native capturePage() for reliable
  // WebGL capture instead of canvas.toDataURL() which is unreliable for MapLibre.
  ipcMain.handle(
    'export:mapImage',
    async (
      _event,
      options: {
        metadata: MapExportMetadata
        mapRect?: { x: number; y: number; width: number; height: number }
        includeMetadataBar?: boolean
      }
    ) => {
      try {
        const win = BrowserWindow.getFocusedWindow()
        if (!win) {
          return { success: false, error: 'No focused window' }
        }

        // Brief wait for any pending GPU renders to land in the compositor
        await new Promise(resolve => setTimeout(resolve, 500))

        // Capture the map area (or full window if mapRect not provided)
        const image = options.mapRect
          ? await win.webContents.capturePage(options.mapRect)
          : await win.webContents.capturePage()

        const now = new Date()
        const dateStr = now.toISOString().slice(0, 10)
        const defaultFilename = `intel-map-${dateStr}.png`

        const { filePath, canceled } = await dialog.showSaveDialog(win, {
          title: 'Export Map as Image',
          defaultPath: defaultFilename,
          filters: [{ name: 'PNG Image', extensions: ['png'] }]
        })

        if (canceled || !filePath) {
          return { success: false, canceled: true }
        }

        // Write the native image to file
        let buffer = image.toPNG()

        // Optionally composite metadata bar at the bottom
        if (options.includeMetadataBar !== false) {
          try {
            const composited = await compositeMetadataBar(buffer, options.metadata)
            buffer = composited
          } catch {
            // If metadata bar fails, we still have the raw screenshot
          }
        }

        await writeFile(filePath, buffer)
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
