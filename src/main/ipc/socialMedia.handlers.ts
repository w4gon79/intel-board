/**
 * IPC handlers for Social Media (Phase 5A — Reddit + BlueSky)
 */

import { ipcMain } from 'electron'
import {
  getSocialPosts,
  getSocialStats,
  pollReddit,
  pollBlueSky,
  getUnanalyzedPosts,
  markPostsAnalyzed
} from '../services/sources/socialMediaService'

export function registerSocialMediaHandlers(): void {
  // Get social media posts with optional filters
  ipcMain.handle(
    'social:posts',
    (_event, limit?: number, source?: 'reddit' | 'bluesky', sourceDetail?: string) => {
      return getSocialPosts(limit ?? 50, source, sourceDetail)
    }
  )

  // Get stats (last fetch times, post counts)
  ipcMain.handle('social:stats', () => {
    return getSocialStats()
  })

  // Manual poll triggers
  ipcMain.handle('social:pollReddit', async () => {
    return await pollReddit()
  })

  ipcMain.handle('social:pollBlueSky', async () => {
    return await pollBlueSky()
  })

  // Get un-analyzed posts for AI processing
  ipcMain.handle('social:unanalyzed', (_event, limit?: number) => {
    return getUnanalyzedPosts(limit ?? 25)
  })

  // Mark posts as analyzed
  ipcMain.handle('social:markAnalyzed', (_event, ids: string[]) => {
    markPostsAnalyzed(ids)
    return { success: true }
  })

  console.log('[IPC] Social media handlers registered')
}