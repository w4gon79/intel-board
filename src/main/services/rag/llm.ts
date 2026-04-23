/**
 * LLM Chat Service — generates responses via Ollama or OpenAI-compatible APIs.
 *
 * Supports:
 * - Local Ollama models (default)
 * - Ollama cloud models (`-cloud` suffix)
 * - OpenAI-compatible providers (ZAI, OpenAI, Groq, etc.)
 * Falls back to local Ollama model if cloud fails.
 */

import { config } from '../../utils/config'
import { loadSettings } from '../../ipc/settings.handlers'
import type { ChatMessage } from '../../../shared/types'

/** Strip reasoning/thinking tags from model output (glm-5, DeepSeek, etc.) */
function stripThinking(text: string): string {
  return text.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim()
}

// ── Types ──

export interface LLMOptions {
  /** Model name (defaults to configured chat model) */
  model?: string
  /** Temperature (0-1, lower = more focused) */
  temperature?: number
  /** Max tokens to generate (undefined = no limit, let the model decide) */
  maxTokens?: number
  /** Request timeout in milliseconds (default: 180000) */
  timeoutMs?: number
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
const REQUEST_TIMEOUT_MS = 180_000 // 3 min

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
 * Generate a chat completion.
 *
 * Routing logic:
 * 1. If the model name ends with `-cloud`, always use Ollama (cloud routing).
 * 2. If the cloud provider is `openai-compatible` and fully configured, try it first.
 *    If it fails and fallbackToLocal is true, fall through to Ollama.
 * 3. Default: Ollama (local model with fallback to FALLBACK_MODEL).
 */
export async function chat(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const settings = loadSettings()
  const configuredModel = options.model || getConfiguredModel()
  const temperature = options.temperature ?? settings.ai.temperature ?? DEFAULT_TEMPERATURE
  const maxTokens = options.maxTokens
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const startTime = Date.now()

  // If user selected a cloud model with -cloud suffix, always use Ollama
  if (configuredModel.endsWith('-cloud')) {
    return chatViaOllama(messages, configuredModel, temperature, maxTokens, startTime)
  }

  // If cloud provider is OpenAI-compatible and configured, try it first
  if (
    settings.ai.cloudProvider === 'openai-compatible' &&
    settings.ai.cloudOpenaiBaseUrl &&
    settings.ai.cloudOpenaiApiKey &&
    settings.ai.cloudOpenaiModel
  ) {
    try {
      const response = await callOpenaiChat(messages, {
        baseUrl: settings.ai.cloudOpenaiBaseUrl,
        apiKey: settings.ai.cloudOpenaiApiKey,
        model: settings.ai.cloudOpenaiModel,
        temperature,
        maxTokens,
        timeout: timeoutMs
      })
      return {
        text: response.message.content,
        model: response.model,
        fellBack: false,
        durationMs: Date.now() - startTime
      }
    } catch (cloudErr) {
      console.warn(
        `[llm] OpenAI-compatible provider failed:`,
        cloudErr instanceof Error ? cloudErr.message : String(cloudErr)
      )
      // Fall through to Ollama if fallbackToLocal is true
      if (!settings.ai.fallbackToLocal) {
        throw cloudErr
      }
    }
  }

  // Default: Ollama
  return chatViaOllama(messages, configuredModel, temperature, maxTokens, startTime)
}

/**
 * Ollama chat with automatic fallback to FALLBACK_MODEL.
 */
async function chatViaOllama(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number | undefined,
  startTime: number
): Promise<LLMResponse> {
  try {
    const response = await callOllamaChat(messages, { model, temperature, maxTokens })
    return {
      text: response.message.content,
      model: response.model,
      fellBack: false,
      durationMs: Date.now() - startTime
    }
  } catch (err) {
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
          `[llm] Both primary (${model}) and fallback (${FALLBACK_MODEL}) failed. ` +
          `Primary: ${err instanceof Error ? err.message : String(err)}. ` +
          `Fallback: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
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
  options: { model: string; temperature: number; maxTokens?: number }
): Promise<OllamaChatResponse> {
  const body = JSON.stringify({
    model: options.model,
    messages,
    options: {
      temperature: options.temperature,
      ...(options.maxTokens ? { num_predict: options.maxTokens } : {})
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
  const rawMsg = data.message || { role: 'assistant', content: '' }
  return {
    ...data,
    message: { role: rawMsg.role, content: stripThinking(rawMsg.content || '') }
  }
}

/**
 * Call OpenAI-compatible chat API (ZAI, OpenAI, Groq, etc.).
 */
async function callOpenaiChat(
  messages: ChatMessage[],
  options: { baseUrl: string; apiKey: string; model: string; temperature: number; maxTokens?: number; timeout: number }
): Promise<OllamaChatResponse> {
  const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        stream: false
      }),
      signal: AbortSignal.timeout(options.timeout)
    })
  } catch (err) {
    throw new Error(
      `[llm] Failed to connect to ${options.baseUrl}. Error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`
    try {
      const errBody = (await response.json()) as { error?: { message?: string } }
      errorMsg = errBody.error?.message || errorMsg
    } catch {
      // Use default
    }
    throw new Error(`[llm] OpenAI-compatible request failed: ${errorMsg}`)
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { role: string; content: string } }>
    model: string
    usage?: { prompt_tokens: number; completion_tokens: number }
  }

  const rawMsg = data.choices?.[0]?.message || { role: 'assistant', content: '' }
  return {
    model: data.model || options.model,
    message: { role: rawMsg.role, content: stripThinking(rawMsg.content || '') },
    done: true
  }
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