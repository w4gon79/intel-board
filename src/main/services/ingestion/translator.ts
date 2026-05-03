/**
 * Translation Queue Worker — translates non-English articles to English.
 *
 * Processes pending articles (language !== 'en') in batches using the
 * configured model endpoint (Ollama or cloud API). Articles remain
 * searchable in their original language until translation completes.
 */

import { config } from '../../utils/config'
import { getAllPendingTranslations, updateArticleTranslation } from '../storage/dbService'

// ── Types ──

/** Resolve the primary AI provider settings for translation fallback */
function loadAISettings(): { baseUrl: string; apiKey: string; model: string; useOllamaApi: boolean } {
  try {
    const settingsPath = require('path').join(
      require('electron').app.getPath('userData'), 'settings.json'
    )
    const fs = require('fs')
    if (!fs.existsSync(settingsPath)) return { baseUrl: '', apiKey: '', model: '', useOllamaApi: false }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const ai = settings.ai || {}

    switch (ai.primaryProvider) {
      case 'local':
        return {
          baseUrl: ai.ollamaBaseUrl || 'http://localhost:11434',
          apiKey: '',
          model: ai.primaryLocalModel || 'llama3.1:8b',
          useOllamaApi: true
        }
      case 'ollama-cloud':
        return {
          baseUrl: ai.ollamaBaseUrl || 'http://localhost:11434',
          apiKey: '',
          model: ai.primaryOllamaModel || 'deepseek-v4-pro:cloud',
          useOllamaApi: true
        }
      case 'openai-compatible':
      default:
        return {
          baseUrl: ai.primaryOpenaiBaseUrl || '',
          apiKey: ai.primaryOpenaiApiKey || '',
          model: ai.primaryOpenaiModel || 'glm-5.1',
          useOllamaApi: false
        }
    }
  } catch {
    return { baseUrl: '', apiKey: '', model: '', useOllamaApi: false }
  }
}

export interface TranslationConfig {
  enabled: boolean
  batchSize: number       // default: 5
  batchDelayMs: number    // default: 30000
  modelEndpoint: string   // empty = use existing cloud API config
  model: string           // e.g., 'gemma3:4b' or 'qwen3:4b/no_think' (append /no_think to suppress reasoning)
  sourceLanguages: string[] // e.g., ['ar', 'ru', 'zh', 'fa', 'ko', 'es']
}

/** ISO 639-1 to language name mapping for prompt construction */
const LANGUAGE_LABELS: Record<string, string> = {
  ar: 'Arabic',
  ru: 'Russian',
  zh: 'Chinese',
  fa: 'Farsi (Persian)',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ja: 'Japanese',
  hi: 'Hindi',
  tr: 'Turkish',
  ur: 'Urdu',
  it: 'Italian'
}

// Rate-limit backoff
let translator429Until = 0

/**
 * Translate a single text string from the given language to English.
 * Uses the OpenAI chat completions format (compatible with Ollama and cloud APIs).
 * When modelEndpoint is empty, falls back to the main AI provider settings.
 */
async function translateText(text: string, language: string): Promise<string | null> {
  if (!text || text.trim().length === 0) return text

  const langLabel = LANGUAGE_LABELS[language] || language

  // Determine endpoint: use configured translator endpoint, cloud API, or fall back to Ollama
  let endpoint: string
  let headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let useOllamaApi = false
  let modelName: string

  if (config.translation.modelEndpoint) {
    // Explicit local/custom endpoint (e.g., Ollama)
    endpoint = config.translation.modelEndpoint
    modelName = config.translation.model || 'glm-5.1'
  } else {
    // Use the main AI provider settings (same as brief generation)
    const aiSettings = loadAISettings()
    if (aiSettings.baseUrl) {
      if (aiSettings.useOllamaApi) {
        // Local Ollama or ollama-cloud proxy
        endpoint = `${aiSettings.baseUrl.replace(/\/$/, '')}/api/chat`
        useOllamaApi = true
      } else if (aiSettings.apiKey) {
        // Cloud API (OpenAI-compatible, ZAI, etc.)
        endpoint = `${aiSettings.baseUrl.replace(/\/$/, '')}/chat/completions`
        headers['Authorization'] = `Bearer ${aiSettings.apiKey}`
      } else {
        // Local without auth
        endpoint = `${aiSettings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`
      }
      // If no translation model specified, use the main AI model
      modelName = config.translation.model || aiSettings.model
    } else {
      // Last resort: local Ollama default
      endpoint = 'http://localhost:11434/api/chat'
      useOllamaApi = true
      modelName = config.translation.model || 'llama3.1:8b'
    }
  }

  // Strip /no_think suffix for API call
  const suppressThinking = modelName.endsWith('/no_think') || modelName.startsWith('qwen3')
  modelName = modelName.replace('/no_think', '')

  const systemPrompt =
    `Translate the following news article from ${langLabel} to English. ` +
    `Preserve the factual content, tone, and key entities (names, places, organizations). ` +
    `Output only the translation, no explanations or quotes.` +
    (suppressThinking ? ' /no_think' : '')

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: text }
  ]

  console.log(`[translator] Using ${useOllamaApi ? 'Ollama' : 'OpenAI'} API, model: ${modelName}, endpoint: ${endpoint}`)

  try {
    let body: string
    if (useOllamaApi) {
      // Ollama native API format
      body = JSON.stringify({
        model: modelName,
        messages,
        options: { temperature: 0.1 },
        stream: false
      })
    } else {
      // OpenAI-compatible API format
      body = JSON.stringify({
        model: modelName,
        messages,
        temperature: 0.1,
        stream: false
      })
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(120_000) // 2 min timeout for model loading + reasoning
    })

    if (!resp.ok) {
      if (resp.status === 429) {
        // Back off for 2 hours on rate limit
        translator429Until = Date.now() + 2 * 60 * 60 * 1000
        console.warn('[translator] Rate limited (429). Backing off for 2 hours.')
      }
      const errText = await resp.text()
      console.error(`[translator] HTTP ${resp.status}: ${errText.substring(0, 200)}`)
      return null
    }

    const data = await resp.json() as Record<string, unknown>

    // Handle both OpenAI and Ollama response formats
    let translated: string | undefined
    if (useOllamaApi && typeof data.message === 'object' && data.message !== null) {
      // Ollama /api/chat format: { message: { content: "..." } }
      translated = ((data.message as Record<string, unknown>)?.content as string)?.trim()
    } else if (Array.isArray(data.choices)) {
      // OpenAI format: { choices: [{ message: { content: "..." } }] }
      translated = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content?.trim()
    }

    if (!translated) {
      console.warn('[translator] Empty translation response. useOllamaApi:', useOllamaApi, 'data:', JSON.stringify(data).substring(0, 500))
      return null
    }

    return translated
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[translator] Translation failed (${language}):`, msg)
    return null
  }
}

/**
 * Process a batch of pending translations.
 * Called by the scheduler after each ingestion cycle when translation is enabled.
 */
export async function translatePendingArticles(): Promise<{
  translated: number
  failed: number
  skipped: number
}> {
  if (!config.translation.enabled) {
    return { translated: 0, failed: 0, skipped: 0 }
  }

  // Check rate-limit backoff
  if (translator429Until && Date.now() < translator429Until) {
    const remaining = Math.ceil((translator429Until - Date.now()) / 60_000)
    console.log(`[translator] Rate-limited, backing off for ${remaining} more minute(s)`)
    return { translated: 0, failed: 0, skipped: 0 }
  }

  const batchSize = config.translation.batchSize || 5
  const pending = getAllPendingTranslations(batchSize)

  if (pending.length === 0) {
    return { translated: 0, failed: 0, skipped: 0 }
  }

  console.log(`[translator] Processing ${pending.length} pending translations...`)

  let translated = 0
  let failed = 0

  for (const article of pending) {
    try {
      const lang = article.language || 'und'
      const langLabel = LANGUAGE_LABELS[lang] || lang

      // Translate title
      const translatedTitle = article.title
        ? await translateText(article.title, lang)
        : null

      // Translate content
      const translatedContent = article.content
        ? await translateText(article.content, lang)
        : null

      if (translatedTitle || translatedContent) {
        updateArticleTranslation(article.id, {
          title: translatedTitle || article.title,
          content: translatedContent || article.content,
          title_original: article.title_original || article.title,
          content_original: article.content_original || article.content
        })
        translated++
        console.log(
          `[translator] Translated (${langLabel}): ` +
          `"${(article.title || '').substring(0, 40)}..." → "${(translatedTitle || '').substring(0, 40)}..."`
        )
      } else {
        failed++
        console.warn(`[translator] Failed to translate article ${article.id}`)
      }
    } catch (err) {
      failed++
      console.error(`[translator] Error translating article ${article.id}:`, err)
    }
  }

  return { translated, failed, skipped: 0 }
}

/**
 * Test translation with a sample phrase.
 * Used by the Settings UI to verify the translation pipeline works.
 */
export async function testTranslation(
  text: string,
  language: string
): Promise<{ success: boolean; translation: string | null; error?: string }> {
  try {
    const result = await translateText(text, language)
    if (result) {
      return { success: true, translation: result }
    }
    return { success: false, translation: null, error: 'Translation returned empty result' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, translation: null, error: msg }
  }
}