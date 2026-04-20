import fs from 'fs'
import path from 'path'

const LOG_DIR = 'data'
const LOG_FILE = path.join(LOG_DIR, 'app.log')
const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_LOG_FILES = 3 // app.log, app.log.1, app.log.2

let logStream: fs.WriteStream | null = null

/**
 * Initialize file-based logging. Call once at main process startup.
 * Captures all console.log/warn/error output and writes to data/app.log
 * while preserving original console behavior.
 */
export function initFileLogger(): void {
  // Ensure data directory exists
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }

  // Rotate log if too large
  rotateIfNeeded()

  // Create write stream (append mode)
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })

  // Write a startup separator
  const startupLine = `\n${'='.repeat(60)}\n[${new Date().toISOString()}] Application started\n${'='.repeat(60)}\n`
  logStream.write(startupLine)

  // Intercept console methods
  const origLog = console.log
  const origWarn = console.warn
  const origError = console.error

  console.log = (...args: unknown[]) => {
    origLog(...args)
    writeToFile('INFO', args)
  }

  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    writeToFile('WARN', args)
  }

  console.error = (...args: unknown[]) => {
    origError(...args)
    writeToFile('ERROR', args)
  }

  console.log('[Logger] File logging initialized:', LOG_FILE)
}

function writeToFile(level: string, args: unknown[]): void {
  if (!logStream || logStream.destroyed) return

  try {
    const timestamp = new Date().toISOString()
    const message = args
      .map((a) => {
        if (typeof a === 'string') return a
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')
    logStream.write(`[${timestamp}] [${level}] ${message}\n`)
  } catch {
    // Don't let logging errors crash the app
  }
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return

    const stats = fs.statSync(LOG_FILE)
    if (stats.size < MAX_LOG_SIZE) return

    // Rotate: app.log.2 → delete, app.log.1 → app.log.2, app.log → app.log.1
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldFile = `${LOG_FILE}.${i}`
      const newFile = `${LOG_FILE}.${i + 1}`
      if (fs.existsSync(oldFile)) {
        if (i === MAX_LOG_FILES - 1) {
          fs.unlinkSync(oldFile) // Delete oldest
        } else {
          fs.renameSync(oldFile, newFile)
        }
      }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`)
  } catch {
    // Don't let rotation errors crash the app
  }
}

/**
 * Shut down the logger cleanly.
 */
export function closeFileLogger(): void {
  if (logStream && !logStream.destroyed) {
    logStream.write(`[${new Date().toISOString()}] [INFO] Application shutting down\n`)
    logStream.end()
    logStream = null
  }
}

/**
 * Read the most recent lines from the log file (for IPC / UI use).
 */
export function getRecentLogLines(lines: number = 100): string {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8')
    const allLines = content.split('\n').filter(Boolean)
    return allLines.slice(-lines).join('\n')
  } catch {
    return 'No log file found'
  }
}