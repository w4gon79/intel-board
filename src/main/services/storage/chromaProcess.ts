/**
 * ChromaDB Process Manager — auto-starts `chroma run` as a child process.
 *
 * Spawns the ChromaDB server on app startup, waits for it to be healthy,
 * and kills it on app quit. Eliminates the need to manually run `chroma run`.
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import http from 'http'
import path from 'path'

// ── Configuration ──

const CHROMA_HOST = 'localhost'
const CHROMA_PORT = 8000
const CHROMA_URL = `http://${CHROMA_HOST}:${CHROMA_PORT}`
const HEALTH_ENDPOINT = `/api/v2/heartbeat`
const STARTUP_TIMEOUT_MS = 30_000 // 30s max wait for ChromaDB to start
const HEALTH_POLL_INTERVAL_MS = 500 // Check every 500ms

// ── State ──

let chromaProcess: ChildProcess | null = null
let isRunning = false

// ── Public API ──

/**
 * Start the ChromaDB server process.
 * If it's already running externally, this is a no-op.
 *
 * @returns The URL of the ChromaDB server
 */
export async function ensureChromaRunning(): Promise<string> {
  // First check if ChromaDB is already running
  const healthy = await checkHealth()
  if (healthy) {
    console.log('[chroma-process] ChromaDB already running externally')
    return CHROMA_URL
  }

  // Try to start it
  console.log('[chroma-process] Starting ChromaDB server...')
  await startChromaProcess()

  // Wait for it to become healthy
  await waitForHealthy()

  return CHROMA_URL
}

/**
 * Stop the ChromaDB server process (if we started it).
 */
export function stopChromaProcess(): void {
  if (chromaProcess && isRunning) {
    console.log('[chroma-process] Stopping ChromaDB server...')
    chromaProcess.kill('SIGTERM')
    chromaProcess = null
    isRunning = false
  }
}

/**
 * Check if the ChromaDB server is healthy.
 */
export function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `${CHROMA_URL}${HEALTH_ENDPOINT}`,
      { timeout: 3000 },
      (res) => {
        res.resume() // Drain the response
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500)
      }
    )

    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

// ── Internal ──

/**
 * Resolve the Python chroma executable path.
 *
 * The npm `chromadb` CLI doesn't support Windows x64 (only ARM64),
 * so we find the pip-installed `chroma` from Python's Scripts directory.
 */
function resolveChromaExe(): string {
  try {
    // Ask Python where its Scripts directory is, then find chroma there
    const scriptsDir = execSync(
      'python -c "import sysconfig; print(sysconfig.get_path(\'scripts\'))"',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()

    const isWin = process.platform === 'win32'
    const exeName = isWin ? 'chroma.exe' : 'chroma'
    const exePath = path.join(scriptsDir, exeName)

    console.log(`[chroma-process] Using Python chroma at: ${exePath}`)
    return exePath
  } catch (err) {
    // Fallback: try the npm chroma (may fail on Windows x64)
    console.warn('[chroma-process] Could not resolve Python chroma path, falling back to "chroma"')
    return 'chroma'
  }
}

/**
 * Spawn the `chroma run` process.
 *
 * Uses the pip-installed chroma executable (not the npm one) to avoid
 * the "Unsupported Windows architecture: x64" error from the npm CLI.
 */
function startChromaProcess(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const chromaExe = resolveChromaExe()

      const args = [
        'run',
        '--host', CHROMA_HOST,
        '--port', String(CHROMA_PORT),
        '--path', './data/chroma'
      ]

      console.log(`[chroma-process] Spawning: ${chromaExe} ${args.join(' ')}`)

      chromaProcess = spawn(chromaExe, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true // Needed on Windows to find python in PATH
      })

      chromaProcess.on('error', (err) => {
        console.error('[chroma-process] Failed to start:', err.message)
        isRunning = false
        reject(new Error(`Failed to start ChromaDB: ${err.message}`))
      })

      chromaProcess.on('exit', (code) => {
        if (isRunning) {
          console.warn(`[chroma-process] ChromaDB exited with code ${code}`)
        }
        isRunning = false
        chromaProcess = null
      })

      // Log stdout
      chromaProcess.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) {
          console.log(`[chroma-process] ${msg}`)
        }
      })

      // Log stderr
      chromaProcess.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) {
          console.log(`[chroma-process] ${msg}`)
        }
      })

      isRunning = true
      resolve()
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Wait for the ChromaDB server to become healthy.
 * Polls the health endpoint until it responds or times out.
 */
function waitForHealthy(): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    const interval = setInterval(async () => {
      const healthy = await checkHealth()

      if (healthy) {
        clearInterval(interval)
        console.log(
          `[chroma-process] ChromaDB ready (took ${Date.now() - startTime}ms)`
        )
        resolve()
        return
      }

      if (Date.now() - startTime > STARTUP_TIMEOUT_MS) {
        clearInterval(interval)
        stopChromaProcess()
        reject(
          new Error(
            `ChromaDB did not become healthy within ${STARTUP_TIMEOUT_MS / 1000}s. ` +
            `Make sure Python chromadb is installed: pip install chromadb`
          )
        )
      }
    }, HEALTH_POLL_INTERVAL_MS)
  })
}