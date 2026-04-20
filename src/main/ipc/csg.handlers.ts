/**
 * CSG IPC Handlers — Carrier Strike Group tracker API.
 */

import { ipcMain } from 'electron'
import {
  getCarrierGroups,
  getCarrierGroupById,
  refreshCarrierData
} from '../services/csg/csgService'

export function registerCsgHandlers(): void {
  ipcMain.handle('tactical:getCarrierGroups', () => {
    return getCarrierGroups()
  })

  ipcMain.handle('tactical:getCarrierGroupById', (_event, id: string) => {
    return getCarrierGroupById(id)
  })

  ipcMain.handle('tactical:refreshCarrierData', async () => {
    return await refreshCarrierData()
  })

  console.log('[ipc] CSG handlers registered')
}