/**
 * IPC Handlers — Map Annotations (Tactical Overlay)
 */

import { ipcMain } from 'electron'
import {
  createAnnotation,
  getAnnotations,
  updateAnnotation,
  deleteAnnotation,
  getAnnotationLayers
} from '../services/storage/dbService'
import type { InsertAnnotation, MapAnnotation } from '../../shared/types'

export function registerAnnotationHandlers(): void {
  ipcMain.handle('annotations:list', async (_event, layer?: string): Promise<MapAnnotation[]> => {
    return getAnnotations(layer)
  })

  ipcMain.handle('annotations:create', async (_event, data: InsertAnnotation): Promise<MapAnnotation> => {
    return createAnnotation(data)
  })

  ipcMain.handle(
    'annotations:update',
    async (
      _event,
      id: string,
      updates: Partial<Pick<MapAnnotation, 'label' | 'description' | 'color' | 'coordinates' | 'visible' | 'layer' | 'icon'>>
    ): Promise<boolean> => {
      return updateAnnotation(id, updates)
    }
  )

  ipcMain.handle('annotations:delete', async (_event, id: string): Promise<boolean> => {
    return deleteAnnotation(id)
  })

  ipcMain.handle('annotations:layers', async (): Promise<string[]> => {
    return getAnnotationLayers()
  })

  console.log('[ipc] Annotation handlers registered')
}