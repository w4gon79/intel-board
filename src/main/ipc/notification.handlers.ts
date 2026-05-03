/**
 * IPC handlers for notification testing and status.
 */
import { ipcMain } from 'electron'
import { sendTestNotification, getNotificationStatus } from '../services/notifications/notificationService'

export function registerNotificationHandlers(): void {
  // Send a test notification to all enabled channels
  ipcMain.handle('notifications:sendTest', async () => {
    try {
      const results = await sendTestNotification()
      return { success: true, results }
    } catch (err) {
      return {
        success: false,
        results: { global: { ok: false, error: err instanceof Error ? err.message : 'Test failed' } }
      }
    }
  })

  // Get notification channel status (which are configured and enabled)
  ipcMain.handle('notifications:status', () => {
    return getNotificationStatus()
  })

  console.log('[IPC] Notification handlers registered')
}