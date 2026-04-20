/**
 * GFW IPC Handlers
 *
 * Bridges the renderer ↔ main process for GFW vessel presence data.
 * Follows the same pattern as ais.handlers.ts.
 */

import { ipcMain } from 'electron'
import {
  getGfwPresence,
  getGfwPresenceByChokepoint,
  getGfwStatus,
  triggerGfwPoll
} from '../services/remote/gfwService'

// ─── Channel names ───────────────────────────────────────────

const CHANNELS = {
  GET_PRESENCE: 'gfw:get-presence',
  GET_PRESENCE_BY_CHOKEPOINT: 'gfw:get-presence-by-chokepoint',
  GET_STATUS: 'gfw:get-status',
  TRIGGER_POLL: 'gfw:trigger-poll'
} as const

// ─── Handler registration ────────────────────────────────────

export function registerGfwHandlers(): void {
  console.log('[GFW] Registering IPC handlers')

  ipcMain.handle(CHANNELS.GET_PRESENCE, async () => {
    return getGfwPresence()
  })

  ipcMain.handle(CHANNELS.GET_PRESENCE_BY_CHOKEPOINT, async (_event, chokepointName: string) => {
    return getGfwPresenceByChokepoint(chokepointName)
  })

  ipcMain.handle(CHANNELS.GET_STATUS, async () => {
    return getGfwStatus()
  })

  ipcMain.handle(CHANNELS.TRIGGER_POLL, async () => {
    return triggerGfwPoll()
  })
}