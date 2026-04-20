/**
 * LLM Chat Service — generates responses via Ollama's unified chat API.
 *
 * Supports both local and cloud models through the same endpoint.
 * Cloud models use the `-cloud` suffix (e.g., `gpt-oss:120b-cloud`).
 * Falls back to local model if cloud fails.
 */

import { config } from '../../utils/config'
import { loadSettings } from '../../ipc/settings.handlers'
import type { ChatMessage } from '../../../shared/types'

// ── Types ──

export interface LLMOptions {
  /** Model name (defaults to configured chat model) */
  model?: string
  /** Temperature (0-1, lower = more focused) */
  temperature?: number
  /** Max tokens to generate */
  maxTokens?: number
  /** Whether to stream the response */
  stream?: boolean
}

export interface LLMResponse {
  /** The generated text */
  text: string
  /** Model that was actually used */
  model: string
  /** Whether a fallback model was used */
  fellBack: boolean
  /** Time taken (ms) */
  durationMs: number
}

/** Ollama chat API response */
interface OllamaChatResponse {
  model: string
  message: { role: string; content: string }
  done: boolean
  total_duration?: number
  eval_count?: number
}

// ── Configuration ──

const FALLBACK_MODEL = 'qwen2.5:3b'
const OLLAMA_CHAT_ENDPOINT = `${config.ollamaBaseUrl}/api/chat`
const DEFAULT_TEMPERATURE = 0.3
const DEFAULT_MAX_TOKENS = 2048
const REQUEST_TIMEOUT_MS = 120_000 // 2 min

// ── Model Registry ──

let cachedModels: string[] = []
let modelsCacheTime = 0
const MODELS_CACHE_TTL = 60_000 // 1 min

/**
 * Read the currently configured chat model from settings (live — no restart needed).
 * Falls back to FALLBACK_MODEL if settings can't be loaded.
 */
function getConfiguredModel(): string {
  try {
    return loadSettings().ai.chatModel || FALLBACK_MODEL
  } catch {
    return FALLBACK_MODEL
  }
}

/**
 * Get the default chat model name.
 * Reads from settings at call time so model changes take effect immediately.
 */
export function getDefaultModel(): string {
  return getConfiguredModel()
}

/**
 * List available Ollama models (cached for 1 min).
 */
export async function listModels(): Promise<string[]> {
  const now = Date.now()
  if (cachedModels.length > 0 && now - modelsCacheTime < MODELS_CACHE_TTL) {
    return cachedModels
  }

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) {
      console.warn('[llm] Failed to list models:', response.status)
      return cachedModels.length > 0 ? cachedModels : [FALLBACK_MODEL]
    }

    const data = (await response.json()) as { models: Array<{ name: string }> }
    cachedModels = data.models.map((m) => m.name)
    modelsCacheTime = now
    return cachedModels
  } catch {
    return cachedModels.length > 0 ? cachedModels : [FALLBACK_MODEL]
  }
}

// ── Chat API ──

/**
 * Generate a chat completion via Ollama.
 *
 * Tries the requested model first. If it's a cloud model and fails,
 * falls back to the default local model.
 */
export async function chat(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const configuredModel = getConfiguredModel()
  const {
    model = configuredModel,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS
  } = options

  const startTime = Date.now()

  try {
    const response = await callOllamaChat(messages, {
      model,
      temperature,
      maxTokens
    })

    return {
      text: response.message.content,
      model: response.model,
      fellBack: false,
      durationMs: Date.now() - startTime
    }
  } catch (err) {
    // If cloud model fails, try fallback to local
    if (model !== FALLBACK_MODEL) {
      console.warn(
        `[llm] Model '${model}' failed, falling back to '${FALLBACK_MODEL}':`,
        err instanceof Error ? err.message : String(err)
      )

      try {
        const fallbackResponse = await callOllamaChat(messages, {
          model: FALLBACK_MODEL,
          temperature,
          maxTokens
        })

        return {
          text: fallbackResponse.message.content,
          model: fallbackResponse.model,
          fellBack: true,
          durationMs: Date.now() - startTime
        }
      } catch (fallbackErr) {
        throw new Error(
          `[llm] Both primary (${model}) and fallback (${FALLBACK_MODEL}) models failed. ` +
          `Primary error: ${err instanceof Error ? err.message : String(err)}. ` +
          `Fallback error: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
        )
      }
    }

    throw err
  }
}

/**
 * Low-level Ollama chat API call.
 */
async function callOllamaChat(
  messages: ChatMessage[],
  options: { model: string; temperature: number; maxTokens: number }
): Promise<OllamaChatResponse> {
  const body = JSON.stringify({
    model: options.model,
    messages,
    options: {
      temperature: options.temperature,
      num_predict: options.maxTokens
    },
    stream: false
  })

  let response: Response
  try {
    response = await fetch(OLLAMA_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    throw new Error(
      `[llm] Failed to connect to Ollama at ${config.ollamaBaseUrl}. ` +
      `Is Ollama running? Error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`
    try {
      const errBody = (await response.json()) as { error?: string }
      errorMsg = errBody.error || errorMsg
    } catch {
      // Use default
    }
    throw new Error(`[llm] Chat request failed: ${errorMsg}`)
  }

  const data = (await response.json()) as OllamaChatResponse
  return data
}

/**
 * Check if the LLM service is available.
 */
export async function isLLMHealthy(): Promise<{
  healthy: boolean
  model: string
  error?: string
}> {
  try {
    const response = await fetch(OLLAMA_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getConfiguredModel(),
        messages: [{ role: 'user', content: 'ping' }],
        options: { num_predict: 1 },
        stream: false
      }),
      signal: AbortSignal.timeout(30_000)
    })

    if (!response.ok) {
      return { healthy: false, model: getConfiguredModel(), error: `HTTP ${response.status}` }
    }

    return { healthy: true, model: getConfiguredModel() }
  } catch (err) {
    return {
      healthy: false,
      model: getConfiguredModel(),
      error: err instanceof Error ? err.message : String(err)
    }
  }
}