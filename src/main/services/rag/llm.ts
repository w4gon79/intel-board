/**
 * LLM Chat Service — generates responses via Ollama or OpenAI-compatible APIs.
 *
 * Two-slot architecture:
 * - Primary Model: local, ollama-cloud, or openai-compatible
 * - Fallback Model: used automatically when primary fails
 * Emergency fallback: qwen2.5:3b via local Ollama
 */

import { loadSettings } from '../../ipc/settings.handlers'
import type { ChatMessage } from '../../../shared/types'

/** Strip reasoning/thinking tags from model output (glm-5, DeepSeek, etc.) */
function stripThinking(text: string): string {
  return text.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim()
}

// ── Types ──

export interface LLMOptions {
  /** Model name override (bypasses settings-based model selection) */
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

/** Provider call configuration */
interface ProviderCallConfig {
  provider: 'local' | 'ollama-cloud' | 'openai-compatible'
  ollamaBaseUrl: string
  localModel: string
  ollamaCloudModel: string
  openaiBaseUrl: string
  openaiApiKey: string
  openaiModel: string
  temperature: number
  maxTokens?: number
  timeoutMs: number
}

// ── Configuration ──

const FALLBACK_MODEL = 'qwen2.5:3b'
const DEFAULT_TEMPERATURE = 0.3
const REQUEST_TIMEOUT_MS = 180_000 // 3 min

// ── Model Registry ──

let cachedModels: string[] = []
let modelsCacheTime = 0
const MODELS_CACHE_TTL = 60_000 // 1 min

/**
 * Get the effective model name for the primary slot.
 */
function getConfiguredModel(): string {
  try {
    const settings = loadSettings()
    const ai = settings.ai
    switch (ai.primaryProvider) {
      case 'local':
        return ai.primaryLocalModel || FALLBACK_MODEL
      case 'ollama-cloud':
        return ai.primaryOllamaModel || FALLBACK_MODEL
      case 'openai-compatible':
        return ai.primaryOpenaiModel || FALLBACK_MODEL
      default:
        return FALLBACK_MODEL
    }
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
    const settings = loadSettings()
    const baseUrl = settings.ai.ollamaBaseUrl
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
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
 * Generate a chat completion using the two-slot architecture.
 *
 * 1. Try primary model
 * 2. If primary fails and fallback is enabled, try fallback model
 * 3. If both fail, throw
 */
export async function chat(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const settings = loadSettings()
  const temperature = options.temperature ?? settings.ai.temperature ?? DEFAULT_TEMPERATURE
  const maxTokens = options.maxTokens
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const startTime = Date.now()

  // If caller provides an explicit model override, use it directly via Ollama
  if (options.model) {
    try {
      const response = await callOllamaChat(messages, {
        baseUrl: settings.ai.ollamaBaseUrl,
        model: options.model,
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
      // If fallback is enabled, try the configured fallback
      if (settings.ai.fallbackEnabled) {
        console.warn(`[llm] Explicit model '${options.model}' failed, trying fallback:`, err instanceof Error ? err.message : String(err))
        try {
          const fallbackConfig = buildProviderConfig(settings, 'fallback', temperature, maxTokens, timeoutMs)
          const response = await callProvider(messages, fallbackConfig)
          return { ...response, fellBack: true, durationMs: Date.now() - startTime }
        } catch (fallbackErr) {
          throw new Error(
            `Both explicit model (${options.model}) and fallback failed. ` +
            `Primary: ${err instanceof Error ? err.message : String(err)}. ` +
            `Fallback: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
          )
        }
      }
      throw err
    }
  }

  // Normal two-slot routing: try primary, then fallback
  const primaryConfig = buildProviderConfig(settings, 'primary', temperature, maxTokens, timeoutMs)

  try {
    const response = await callProvider(messages, primaryConfig)
    return { ...response, fellBack: false, durationMs: Date.now() - startTime }
  } catch (primaryErr) {
    // Try fallback if enabled
    if (settings.ai.fallbackEnabled && settings.ai.fallbackProvider) {
      console.warn('[llm] Primary failed, trying fallback:', primaryErr instanceof Error ? primaryErr.message : String(primaryErr))
      try {
        const fallbackConfig = buildProviderConfig(settings, 'fallback', temperature, maxTokens, timeoutMs)
        const response = await callProvider(messages, fallbackConfig)
        return { ...response, fellBack: true, durationMs: Date.now() - startTime }
      } catch (fallbackErr) {
        throw new Error(
          `Both primary and fallback failed. Primary: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}. ` +
          `Fallback: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
        )
      }
    }
    throw primaryErr
  }
}

/**
 * Build a ProviderCallConfig from settings for a given slot (primary or fallback).
 */
function buildProviderConfig(
  settings: ReturnType<typeof loadSettings>,
  slot: 'primary' | 'fallback',
  temperature: number,
  maxTokens: number | undefined,
  timeoutMs: number
): ProviderCallConfig {
  const ai = settings.ai
  if (slot === 'primary') {
    return {
      provider: ai.primaryProvider || 'local',
      ollamaBaseUrl: ai.ollamaBaseUrl,
      localModel: ai.primaryLocalModel || FALLBACK_MODEL,
      ollamaCloudModel: ai.primaryOllamaModel || FALLBACK_MODEL,
      openaiBaseUrl: ai.primaryOpenaiBaseUrl,
      openaiApiKey: ai.primaryOpenaiApiKey,
      openaiModel: ai.primaryOpenaiModel,
      temperature,
      maxTokens,
      timeoutMs
    }
  }
  return {
    provider: ai.fallbackProvider || 'local',
    ollamaBaseUrl: ai.ollamaBaseUrl,
    localModel: ai.fallbackLocalModel || FALLBACK_MODEL,
    ollamaCloudModel: ai.fallbackOllamaModel || FALLBACK_MODEL,
    openaiBaseUrl: ai.fallbackOpenaiBaseUrl,
    openaiApiKey: ai.fallbackOpenaiApiKey,
    openaiModel: ai.fallbackOpenaiModel,
    temperature,
    maxTokens,
    timeoutMs
  }
}

/**
 * Route a chat request to the correct provider based on config.
 */
async function callProvider(
  messages: ChatMessage[],
  config: ProviderCallConfig
): Promise<{ text: string; model: string }> {
  switch (config.provider) {
    case 'local':
      return callLocalOllama(messages, config)
    case 'ollama-cloud':
      return callOllamaCloud(messages, config)
    case 'openai-compatible':
      return callOpenaiCompatible(messages, config)
    default:
      throw new Error(`[llm] Unknown provider: ${config.provider}`)
  }
}

/**
 * Call a local Ollama model.
 */
async function callLocalOllama(
  messages: ChatMessage[],
  config: ProviderCallConfig
): Promise<{ text: string; model: string }> {
  const response = await callOllamaChat(messages, {
    baseUrl: config.ollamaBaseUrl,
    model: config.localModel || FALLBACK_MODEL,
    temperature: config.temperature,
    maxTokens: config.maxTokens
  })
  return { text: response.message.content, model: response.model }
}

/**
 * Call an Ollama cloud model (uses the same API, model name routes to cloud).
 */
async function callOllamaCloud(
  messages: ChatMessage[],
  config: ProviderCallConfig
): Promise<{ text: string; model: string }> {
  const response = await callOllamaChat(messages, {
    baseUrl: config.ollamaBaseUrl,
    model: config.ollamaCloudModel,
    temperature: config.temperature,
    maxTokens: config.maxTokens
  })
  return { text: response.message.content, model: response.model }
}

/**
 * Call an OpenAI-compatible provider.
 */
async function callOpenaiCompatible(
  messages: ChatMessage[],
  config: ProviderCallConfig
): Promise<{ text: string; model: string }> {
  const response = await callOpenaiChat(messages, {
    baseUrl: config.openaiBaseUrl,
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeout: config.timeoutMs
  })
  return { text: response.message.content, model: response.model }
}

// ── Low-level API calls ──

/**
 * Low-level Ollama chat API call.
 */
async function callOllamaChat(
  messages: ChatMessage[],
  options: { baseUrl: string; model: string; temperature: number; maxTokens?: number }
): Promise<OllamaChatResponse> {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
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
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    throw new Error(
      `[llm] Failed to connect to Ollama at ${baseUrl}. ` +
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
  const settings = loadSettings()
  const ai = settings.ai
  const model = getConfiguredModel()

  try {
    if (ai.primaryProvider === 'openai-compatible') {
      // Test OpenAI-compatible endpoint
      if (!ai.primaryOpenaiBaseUrl || !ai.primaryOpenaiApiKey) {
        return { healthy: false, model, error: 'OpenAI-compatible provider not configured' }
      }
      const url = `${ai.primaryOpenaiBaseUrl.replace(/\/$/, '')}/models`
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${ai.primaryOpenaiApiKey}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (!resp.ok) {
        return { healthy: false, model, error: `HTTP ${resp.status}` }
      }
      return { healthy: true, model }
    }

    // Test Ollama (local or cloud)
    const baseUrl = ai.ollamaBaseUrl.replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        options: { num_predict: 1 },
        stream: false
      }),
      signal: AbortSignal.timeout(30_000)
    })

    if (!response.ok) {
      return { healthy: false, model, error: `HTTP ${response.status}` }
    }

    return { healthy: true, model }
  } catch (err) {
    return {
      healthy: false,
      model,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}