import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initFileLogger, closeFileLogger, getRecentLogLines } from './utils/logger'
import { initDatabase, closeDatabase, getDatabaseStatus, getDatabase } from './services/storage/database'
import {
  initVectorStore,
  closeVectorStore,
  getVectorStoreStatus
} from './services/storage/vectordb'
import { ensureChromaRunning, stopChromaProcess } from './services/storage/chromaProcess'
import { ensureOllamaRunning, stopOllamaProcess } from './services/storage/ollamaProcess'
import { registerDataHandlers } from './ipc/data.handlers'
import { registerRAGHandlers } from './ipc/rag.handlers'
import { registerAdsbHandlers, stopAdsbHandlers } from './ipc/adsb.handlers'
import { registerAisHandlers, stopAisHandlers } from './ipc/ais.handlers'
import { registerPredictionHandlers } from './ipc/prediction.handlers'
import { registerAiHandlers } from './ipc/ai.handlers'
import { registerSettingsHandlers } from './ipc/settings.handlers'
import { registerTacticalHandlers } from './ipc/tactical.handlers'
import { registerCsgHandlers } from './ipc/csg.handlers'
import { registerSenseMakingHandlers } from './ipc/sensemaking.handlers'
import { registerSourceHandlers } from './ipc/source.handlers'
import { registerGfwHandlers } from './ipc/gfw.handlers'
import { registerAlertRuleHandlers } from './ipc/alertRule.handlers'
import { registerSocialMediaHandlers } from './ipc/socialMedia.handlers'
import { registerEconomicHandlers } from './ipc/economic.handlers'
import { registerZoneHandlers } from './ipc/zone.handlers'
import { registerNotamHandlers, initNotamScheduler, stopNotamSchedulerHandlers } from './ipc/notam.handlers'
import { registerNotificationHandlers } from './ipc/notification.handlers'
import { registerExportHandlers } from './ipc/export.handlers'
import { registerChatExportHandlers } from './ipc/chatExport.handlers'
import { registerAnnotationHandlers } from './ipc/annotation.handlers'
import { startSenseMakingScheduler, stopSenseMakingScheduler } from './services/senseMakingEngine'
import { setupContextMenu } from './contextMenu'
import { startScrapers, stopScrapers } from './services/scrapers/scraperManager'
import { startIngestion, stopIngestion } from './services/ingestion/scheduler'
import { dedupExistingIntelItems } from './services/ingestion/processor'
import { deleteExpiredIntelItems } from './services/storage/dbService'
import { cleanupStaleTacticalData } from './services/identification/tacticalEngine'
import { startAnomalyEngine, stopAnomalyEngine } from './services/anomaly/anomalyEngine'
import { seedAircraftRegistryIfNeeded } from './services/identification/openSkyImporter'
import { initCsgData, startCsgScheduler, stopCsgScheduler } from './services/csg/csgService'
import { startGfwScheduler, stopGfwScheduler } from './services/remote/gfwService'
import { startReviewScheduler, stopReviewScheduler } from './services/analysis/predictionReviewer'
import { startSocialMediaScheduler, stopSocialMediaScheduler } from './services/sources/socialMediaService'
import { startEconomicPolling, stopEconomicPolling } from './services/economicService'
import { remoteServer } from './services/remote/httpServer'
import { loadSettings } from './ipc/settings.handlers'
import { reloadConfigFromSettings } from './utils/config'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      spellcheck: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Right-click context menu (spell-check, copy/paste, links, images)
  setupContextMenu(mainWindow)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Initialize file-based logging FIRST (captures all subsequent console output)
  initFileLogger()

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.intelboard.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Load persisted settings and apply them to runtime config
  try {
    const startupSettings = loadSettings()
    reloadConfigFromSettings(startupSettings)
    console.log('[main] Settings loaded and config updated')
  } catch (err) {
    console.warn('[main] Could not load settings on startup:', err)
  }

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // IPC: Logger – read recent log lines (for future UI / dev tools)
  ipcMain.handle('logger:getRecent', async (_event, lines: number = 100) => {
    return getRecentLogLines(lines)
  })

  // Initialize SQLite database
  try {
    initDatabase()
    dedupExistingIntelItems() // Remove duplicate intel items from DB
    deleteExpiredIntelItems() // Purge expired intel items immediately on startup

    // One-time backfill: set expiry on existing intel items with null expires_at
    try {
      const db = getDatabase()
      if (db) {
        // News articles: set 24h expiry
        db.prepare(`UPDATE intel_items SET expires_at = datetime('now', '+24 hours') WHERE expires_at IS NULL AND categories LIKE '%news%'`).run()
        // Anomaly alerts: set 12h expiry
        db.prepare(`UPDATE intel_items SET expires_at = datetime('now', '+12 hours') WHERE expires_at IS NULL AND (title LIKE '%anomaly%' OR categories LIKE '%anomaly%' OR categories LIKE '%volume%')`).run()
        // Everything else without expiry: set 24h
        db.prepare(`UPDATE intel_items SET expires_at = datetime('now', '+24 hours') WHERE expires_at IS NULL`).run()
        // Immediately delete anything already past a reasonable age (7+ days with no expiry)
        db.prepare(`DELETE FROM intel_items WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now', '-7 days')`).run()
        console.log('[main] Backfill: set expiry on existing intel items with null expires_at')
      }
    } catch (err) {
      console.warn('[main] Backfill failed:', err)
    }

    cleanupStaleTacticalData() // Resolve stale tactical_events so they don't re-create intel items
    const status = getDatabaseStatus()
    console.log('[main] Database ready:', status)

    // Periodic cleanup: delete expired intel items every 5 minutes
    setInterval(() => {
      deleteExpiredIntelItems()
    }, 5 * 60 * 1000)
  } catch (err) {
    console.error('[main] Database initialization failed:', err)
  }

  // Auto-start Ollama, then ChromaDB, then initialize vector store
  ensureOllamaRunning()
    .then(() => ensureChromaRunning())
    .then(() => initVectorStore())
    .then(async () => {
      const vectorStatus = await getVectorStoreStatus()
      console.log('[main] Vector store ready:', vectorStatus)
    })
    .catch((err) => {
      console.warn('[main] Vector store initialization failed (app will continue without RAG):', err)
    })

  // IPC: Get database status
  ipcMain.handle('db:getStatus', () => {
    return getDatabaseStatus()
  })

  // IPC: Get vector store status
  ipcMain.handle('vectordb:getStatus', async () => {
    return await getVectorStoreStatus()
  })

  // Register data & ingestion IPC handlers
  registerDataHandlers()
  registerRAGHandlers()
  registerAdsbHandlers()
  registerAisHandlers()
  registerPredictionHandlers()
  registerAiHandlers()
  registerSettingsHandlers()
  registerTacticalHandlers()
  registerCsgHandlers()
  registerSenseMakingHandlers()
  registerSourceHandlers()
  registerGfwHandlers()
  registerAlertRuleHandlers()
  registerSocialMediaHandlers()
  registerEconomicHandlers()
  registerZoneHandlers()
  registerNotamHandlers()
  registerNotificationHandlers()
  registerExportHandlers()
  registerChatExportHandlers()
  registerAnnotationHandlers()

  // Pre-seed aircraft registry from OpenSky database (runs once if cache is empty)
  seedAircraftRegistryIfNeeded().catch((err) => {
    console.warn('[main] Aircraft registry pre-seed failed (app will continue with HexDB warm-up):', err)
  })

  // Start news ingestion scheduler
  startIngestion()

  // Start anomaly detection engine (standalone scheduler)
  startAnomalyEngine()

  // Initialize and start Carrier Strike Group tracker
  initCsgData().catch((err) => {
    console.warn('[main] CSG initialization failed:', err)
  })
  startCsgScheduler()

  // Start expanded source scrapers (Phase 4G)
  startScrapers()

  // Start AI sense-making engine (30-min cycle, first run after 2 min delay)
  startSenseMakingScheduler()

  // Start GFW vessel presence scheduler (6-hour cycle, supplements AIS for choke points)
  startGfwScheduler()

  // Start prediction review & self-calibration scheduler (2-hour cycle)
  startReviewScheduler(2 * 60 * 60 * 1000)

  // Start social media polling (Phase 5A — Reddit + BlueSky)
  startSocialMediaScheduler()

  // Start economic monitoring scheduler (Phase 5B — commodity/currency/shipping anomalies)
  try {
    const econSettings = loadSettings()
    if (econSettings.economic?.enabled) {
      startEconomicPolling(econSettings.economic.intervalMs ?? 1800000)
    }
  } catch (err) {
    console.warn('[main] Could not auto-start economic monitoring:', err)
  }

  // Start NOTAM scraper (4-hour polling cycle for military/defense NOTAMs)
  initNotamScheduler()

  createWindow()

  // Auto-start remote HTTP server if enabled in settings
  try {
    const settings = loadSettings()
    if (settings.remoteServer?.enabled) {
      remoteServer.start(settings.remoteServer.port).then((url) => {
        console.log(`[main] Remote server: ${url}`)
      }).catch((err) => {
        console.error('[main] Remote server failed to start:', err)
      })
    }
  } catch (err) {
    console.warn('[main] Could not check remote server settings:', err)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})

// Stop ingestion & close stores before app quits
app.on('before-quit', async () => {
  await remoteServer.stop()
  stopIngestion()
  stopAnomalyEngine()
  stopCsgScheduler()
  stopScrapers()
  stopSenseMakingScheduler()
  stopGfwScheduler()
  stopReviewScheduler()
  stopAdsbHandlers()
  stopAisHandlers()
  stopSocialMediaScheduler()
  stopNotamSchedulerHandlers()
  // Stop economic monitoring scheduler
  try {
    stopEconomicPolling()
  } catch { /* ignore */ }
  await closeVectorStore()
  stopChromaProcess()
  stopOllamaProcess()
  closeDatabase()
  closeFileLogger()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
