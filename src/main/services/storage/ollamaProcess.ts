/**
 * Ollama Process Manager — auto-starts Ollama and ensures required models are pulled.
 *
 * On app startup:
 * 1. Checks if Ollama is already running (health check on localhost:11434)
 * 2. If not, spawns `ollama serve` as a background process
 * 3. Waits for Ollama to be healthy
 * 4. Ensures `nomic-embed-text` embedding model is pulled
 *
 * On app quit:
 * - Kills the Ollama process (if we started it)
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import http from 'http'

// ── Configuration ──

const OLLAMA_HOST = 'localhost'
const OLLAMA_PORT = 11434
const OLLAMA_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`
const REQUIRED_MODELS = ['nomic-embed-text']
const STARTUP_TIMEOUT_MS = 60_000 // 60s (model pull can take time)
const HEALTH_POLL_INTERVAL_MS = 1000

// ── State ──

let ollamaProcess: ChildProcess | null = null
let startedByUs = false

// ── Public API ──

/**
 * Ensure Ollama is running and required models are available.
 * Starts `ollama serve` if needed, then pulls missing models.
 */
export async function ensureOllamaRunning(): Promise<void> {
  // Check if already running
  const healthy = await checkOllamaHealth()
  if (healthy) {
    console.log('[ollama] Ollama already running')
  } else {
    // Try to start it
    console.log('[ollama] Starting Ollama server...')
    startOllamaProcess()
    await waitForOllamaHealthy()
    console.log('[ollama] Ollama server ready')
  }

  // Ensure required models are pulled
  await ensureModelsPulled()
}

/**
 * Stop the Ollama server process (only if we started it).
 */
export function stopOllamaProcess(): void {
  if (ollamaProcess && startedByUs) {
    console.log('[ollama] Stopping Ollama server...')
    ollamaProcess.kill('SIGTERM')
    ollamaProcess = null
    startedByUs = false
  }
}

// ── Health Check ──

/**
 * Check if Ollama is healthy by hitting its API.
 */
export function checkOllamaHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 }, (res) => {
      res.resume()
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

// ── Internal ──

/**
 * Spawn `ollama serve` as a background process.
 */
function startOllamaProcess(): void {
  ollamaProcess = spawn('ollama', ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: true,
    detached: false
  })

  startedByUs = true

  ollamaProcess.on('error', (err) => {
    console.error('[ollama] Failed to start:', err.message)
    startedByUs = false
  })

  ollamaProcess.on('exit', (code) => {
    if (startedByUs) {
      console.warn(`[ollama] Ollama exited with code ${code}`)
    }
    ollamaProcess = null
    startedByUs = false
  })

  // Log output
  ollamaProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[ollama] ${msg}`)
  })
  ollamaProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[ollama] ${msg}`)
  })
}

/**
 * Wait for Ollama to become healthy.
 */
function waitForOllamaHealthy(): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    const interval = setInterval(async () => {
      const healthy = await checkOllamaHealth()

      if (healthy) {
        clearInterval(interval)
        resolve()
        return
      }

      if (Date.now() - startTime > STARTUP_TIMEOUT_MS) {
        clearInterval(interval)
        reject(new Error(`Ollama did not become healthy within ${STARTUP_TIMEOUT_MS / 1000}s`))
      }
    }, HEALTH_POLL_INTERVAL_MS)
  })
}

/**
 * Get list of locally available Ollama models.
 */
function getLocalModels(): string[] {
  try {
    const output = execSync('ollama list', { encoding: 'utf-8', timeout: 10_000 })
    // Parse plain text output:
    // NAME                    ID              SIZE    MODIFIED
    // nomic-embed-text:latest abc123          274 MB  2 hours ago
    return output
      .split('\n')
      .slice(1) // Skip header line
      .map((line) => line.split(/\s+/)[0]?.toLowerCase())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Pull a model if it's not already available locally.
 */
async function pullModelIfNeeded(modelName: string): Promise<void> {
  const localModels = getLocalModels()

  // Check if model already exists (handle tags like :latest)
  const modelExists = localModels.some(
    (m) => m === modelName || m === `${modelName}:latest` || m.startsWith(`${modelName}:`)
  )

  if (modelExists) {
    console.log(`[ollama] Model '${modelName}' already available`)
    return
  }

  console.log(`[ollama] Pulling model '${modelName}' (this may take a few minutes on first run)...`)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Pull of '${modelName}' timed out`))
    }, 300_000) // 5 min timeout for model pull

    try {
      // Use execSync for simplicity — pull is a one-shot operation
      execSync(`ollama pull ${modelName}`, {
        encoding: 'utf-8',
        timeout: 300_000,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      clearTimeout(timeout)
      console.log(`[ollama] Model '${modelName}' pulled successfully`)
      resolve()
    } catch (err) {
      clearTimeout(timeout)
      reject(new Error(`Failed to pull model '${modelName}': ${err instanceof Error ? err.message : String(err)}`))
    }
  })
}

/**
 * Ensure all required models are pulled.
 */
async function ensureModelsPulled(): Promise<void> {
  for (const model of REQUIRED_MODELS) {
    try {
      await pullModelIfNeeded(model)
    } catch (err) {
      console.warn(
        `[ollama] Could not pull model '${model}':`,
        err instanceof Error ? err.message : String(err)
      )
      // Non-fatal — embedding will fail later with a clear error
    }
  }
}