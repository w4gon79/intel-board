/**
 * AI Configuration Panel — slide-out drawer with two-slot model architecture.
 * Primary Model + Fallback Model, each with provider dropdown.
 */

import { useState, useEffect, useCallback } from 'react'

type ProviderType = 'local' | 'ollama-cloud' | 'openai-compatible'

interface AIPanelProps {
  open: boolean
  onClose: () => void
}

interface ModelInfo {
  name: string
  size: string
  modified_at: string
}

type TestStatus = 'unknown' | 'ok' | 'error' | 'testing'

interface TestResult {
  status: TestStatus
  error: string
  modelCount: number
}

export function AIPanel({ open, onClose }: AIPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [primaryTest, setPrimaryTest] = useState<TestResult>({ status: 'unknown', error: '', modelCount: 0 })
  const [fallbackTest, setFallbackTest] = useState<TestResult>({ status: 'unknown', error: '', modelCount: 0 })
  const [ollamaTest, setOllamaTest] = useState<TestResult>({ status: 'unknown', error: '', modelCount: 0 })

  // Load settings and models on open
  useEffect(() => {
    if (!open) return
    window.api.settings.get().then((s) => {
      setSettings(s)
    })
    refreshModels()
  }, [open])

  const refreshModels = useCallback(async (baseUrl?: string): Promise<void> => {
    try {
      const list = await window.api.settings.listModels(baseUrl)
      setModels(list)
    } catch (err) {
      console.error('[AIPanel] Failed to fetch models:', err)
      setModels([])
    }
  }, [])

  async function handleTestOllama(): Promise<void> {
    if (!settings) return
    setOllamaTest({ status: 'testing', error: '', modelCount: 0 })
    try {
      const result = await window.api.settings.testConnection(settings.ai.ollamaBaseUrl)
      if (result.ok) {
        await refreshModels(settings.ai.ollamaBaseUrl)
        const count = models.length
        setOllamaTest({ status: 'ok', error: '', modelCount: count })
      } else {
        setOllamaTest({ status: 'error', error: result.error ?? 'Connection failed', modelCount: 0 })
      }
    } catch (err) {
      setOllamaTest({ status: 'error', error: err instanceof Error ? err.message : 'Connection failed', modelCount: 0 })
    }
  }

  async function handleTestSlot(slot: 'primary' | 'fallback'): Promise<void> {
    if (!settings) return
    const setter = slot === 'primary' ? setPrimaryTest : setFallbackTest
    const provider = slot === 'primary' ? settings.ai.primaryProvider : settings.ai.fallbackProvider

    setter({ status: 'testing', error: '', modelCount: 0 })

    try {
      const testConfig: Record<string, string> = {
        provider,
        ollamaBaseUrl: settings.ai.ollamaBaseUrl
      }

      if (provider === 'openai-compatible') {
        testConfig.openaiBaseUrl = slot === 'primary' ? settings.ai.primaryOpenaiBaseUrl : settings.ai.fallbackOpenaiBaseUrl
        testConfig.openaiApiKey = slot === 'primary' ? settings.ai.primaryOpenaiApiKey : settings.ai.fallbackOpenaiApiKey
      }

      const result = await window.api.settings.testAI(testConfig)
      if (result.ok) {
        setter({ status: 'ok', error: '', modelCount: result.models ?? 0 })
      } else {
        setter({ status: 'error', error: result.error ?? 'Connection failed', modelCount: 0 })
      }
    } catch (err) {
      setter({ status: 'error', error: err instanceof Error ? err.message : 'Connection failed', modelCount: 0 })
    }
  }

  async function handleSave(): Promise<void> {
    if (!settings) return
    setSaving(true)
    try {
      await window.api.settings.save(settings)
    } catch (err) {
      console.error('[AIPanel] Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  function updateAI(patch: Partial<AppSettings['ai']>): void {
    if (!settings) return
    setSettings({ ...settings, ai: { ...settings.ai, ...patch } })
  }

  // Filter models for local (exclude -cloud suffix and nomic-embed-text)
  const localModels = models.filter(
    (m) => !m.name.endsWith('-cloud') && !m.name.startsWith('nomic-embed-text')
  )

  if (!open || !settings) return <></>

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col border-l border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">AI Configuration</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* ── Ollama Instance ── */}
          <Section title="Ollama Instance">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Base URL
                </label>
                <input
                  type="text"
                  value={settings.ai.ollamaBaseUrl}
                  onChange={(e) => {
                    updateAI({ ollamaBaseUrl: e.target.value })
                    setOllamaTest({ status: 'unknown', error: '', modelCount: 0 })
                  }}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  placeholder="http://localhost:11434"
                />
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status={ollamaTest.status} error={ollamaTest.error} />
                <button
                  type="button"
                  onClick={handleTestOllama}
                  disabled={ollamaTest.status === 'testing'}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                >
                  {ollamaTest.status === 'testing' ? 'Testing…' : 'Test Connection'}
                </button>
                {ollamaTest.status === 'ok' && ollamaTest.modelCount > 0 && (
                  <span className="text-[10px] text-emerald-400">
                    ✓ Connected ({ollamaTest.modelCount} models)
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-600">
                Shared by Local and Ollama Cloud providers
              </p>
            </div>
          </Section>

          {/* ── Primary Model ── */}
          <Section title="⭐ Primary Model">
            <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Provider
                </label>
                <select
                  value={settings.ai.primaryProvider}
                  onChange={(e) => {
                    updateAI({ primaryProvider: e.target.value as ProviderType })
                    setPrimaryTest({ status: 'unknown', error: '', modelCount: 0 })
                  }}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="local">Local (Ollama)</option>
                  <option value="ollama-cloud">Ollama Cloud</option>
                  <option value="openai-compatible">OpenAI Compatible</option>
                </select>
              </div>

              {/* Local model selector */}
              {settings.ai.primaryProvider === 'local' && (
                <ModelSelector
                  label="Model"
                  models={localModels}
                  value={settings.ai.primaryLocalModel}
                  onChange={(val) => updateAI({ primaryLocalModel: val })}
                />
              )}

              {/* Ollama Cloud model entry */}
              {settings.ai.primaryProvider === 'ollama-cloud' && (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                      Cloud Model Name
                    </label>
                    <input
                      type="text"
                      value={settings.ai.primaryOllamaModel}
                      onChange={(e) => updateAI({ primaryOllamaModel: e.target.value })}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                      placeholder="e.g. deepseek-v3.1:671b-cloud"
                    />
                    <p className="mt-1 text-[10px] text-zinc-600">
                      Must end with <code className="text-zinc-500">-cloud</code> suffix
                    </p>
                  </div>
                  <PrivacyNotice provider="ollama-cloud" />
                </>
              )}

              {/* OpenAI Compatible fields */}
              {settings.ai.primaryProvider === 'openai-compatible' && (
                <>
                  <OpenAIFields
                    baseUrl={settings.ai.primaryOpenaiBaseUrl}
                    apiKey={settings.ai.primaryOpenaiApiKey}
                    model={settings.ai.primaryOpenaiModel}
                    onBaseUrlChange={(val) => updateAI({ primaryOpenaiBaseUrl: val })}
                    onApiKeyChange={(val) => updateAI({ primaryOpenaiApiKey: val })}
                    onModelChange={(val) => updateAI({ primaryOpenaiModel: val })}
                  />
                  <PrivacyNotice provider="openai-compatible" />
                </>
              )}

              {/* Test primary */}
              <div className="flex items-center gap-3 border-t border-zinc-800 pt-3">
                <button
                  type="button"
                  onClick={() => handleTestSlot('primary')}
                  disabled={primaryTest.status === 'testing'}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                >
                  {primaryTest.status === 'testing' ? 'Testing…' : '🧪 Test Primary'}
                </button>
                <TestStatusIndicator result={primaryTest} />
              </div>
            </div>
          </Section>

          {/* ── Fallback Model ── */}
          <Section title="🔄 Fallback Model">
            <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.ai.fallbackEnabled}
                  onChange={(e) => updateAI({ fallbackEnabled: e.target.checked })}
                  className="accent-indigo-500"
                />
                <label className="text-xs text-zinc-300">Enable Fallback</label>
              </div>
              <p className="text-[10px] text-zinc-600">
                Used automatically when Primary fails
              </p>

              {settings.ai.fallbackEnabled && (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                      Provider
                    </label>
                    <select
                      value={settings.ai.fallbackProvider}
                      onChange={(e) => {
                        updateAI({ fallbackProvider: e.target.value as ProviderType })
                        setFallbackTest({ status: 'unknown', error: '', modelCount: 0 })
                      }}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="local">Local (Ollama)</option>
                      <option value="ollama-cloud">Ollama Cloud</option>
                      <option value="openai-compatible">OpenAI Compatible</option>
                    </select>
                  </div>

                  {settings.ai.fallbackProvider === 'local' && (
                    <ModelSelector
                      label="Model"
                      models={localModels}
                      value={settings.ai.fallbackLocalModel}
                      onChange={(val) => updateAI({ fallbackLocalModel: val })}
                    />
                  )}

                  {settings.ai.fallbackProvider === 'ollama-cloud' && (
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                        Cloud Model Name
                      </label>
                      <input
                        type="text"
                        value={settings.ai.fallbackOllamaModel}
                        onChange={(e) => updateAI({ fallbackOllamaModel: e.target.value })}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                        placeholder="e.g. deepseek-v3.1:671b-cloud"
                      />
                    </div>
                  )}

                  {settings.ai.fallbackProvider === 'openai-compatible' && (
                    <OpenAIFields
                      baseUrl={settings.ai.fallbackOpenaiBaseUrl}
                      apiKey={settings.ai.fallbackOpenaiApiKey}
                      model={settings.ai.fallbackOpenaiModel}
                      onBaseUrlChange={(val) => updateAI({ fallbackOpenaiBaseUrl: val })}
                      onApiKeyChange={(val) => updateAI({ fallbackOpenaiApiKey: val })}
                      onModelChange={(val) => updateAI({ fallbackOpenaiModel: val })}
                    />
                  )}

                  <div className="flex items-center gap-3 border-t border-zinc-800 pt-3">
                    <button
                      type="button"
                      onClick={() => handleTestSlot('fallback')}
                      disabled={fallbackTest.status === 'testing'}
                      className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {fallbackTest.status === 'testing' ? 'Testing…' : '🧪 Test Fallback'}
                    </button>
                    <TestStatusIndicator result={fallbackTest} />
                  </div>
                </>
              )}
            </div>
          </Section>

          {/* ── Embedding Model (fixed) ── */}
          <Section title="🧬 Embedding Model">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-zinc-300">nomic-embed-text</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">local</span>
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">
                Fixed embedding model — always runs locally via Ollama
              </p>
            </div>
          </Section>

          {/* ── Temperature ── */}
          <Section title="Temperature">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Creativity vs Determinism
                </label>
                <span className="font-mono text-xs text-zinc-300">{settings.ai.temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.ai.temperature}
                onChange={(e) => updateAI({ temperature: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-[9px] text-zinc-600">
                <span>Precise (0.0)</span>
                <span>Creative (1.0)</span>
              </div>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save AI Settings'}
          </button>
        </div>
      </aside>
    </>
  )
}

// ── Sub-components ──

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function StatusDot({ status, error }: { status: TestStatus; error: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`h-2.5 w-2.5 rounded-full ${
          status === 'ok'
            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
            : status === 'error'
              ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
              : status === 'testing'
                ? 'bg-amber-400 animate-pulse'
                : 'bg-zinc-500'
        }`}
      />
      {status === 'error' && error && (
        <span className="text-[10px] text-red-400">{error}</span>
      )}
    </div>
  )
}

function TestStatusIndicator({ result }: { result: TestResult }): React.JSX.Element {
  if (result.status === 'ok') {
    return (
      <span className="text-[10px] text-emerald-400">
        ✓ Connected{result.modelCount > 0 ? ` (${result.modelCount} models)` : ''}
      </span>
    )
  }
  if (result.status === 'error') {
    return <span className="text-[10px] text-red-400">✗ {result.error}</span>
  }
  return <span className="text-[10px] text-zinc-600">Not tested</span>
}

function ModelSelector({
  label,
  models,
  value,
  onChange
}: {
  label: string
  models: ModelInfo[]
  value: string
  onChange: (val: string) => void
}): React.JSX.Element {
  const [customModel, setCustomModel] = useState(value)
  const isInList = models.some((m) => m.name === value)

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
          {label}
        </label>
        <select
          value={isInList ? value : ''}
          onChange={(e) => {
            if (e.target.value) {
              onChange(e.target.value)
              setCustomModel(e.target.value)
            }
          }}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
        >
          {models.length === 0 && <option value="">No models found</option>}
          {!isInList && value && <option value="">Using: {value}</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.size})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
          Or enter manually
        </label>
        <input
          type="text"
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          onBlur={() => {
            if (customModel.trim()) {
              onChange(customModel.trim())
            }
          }}
          placeholder="e.g. qwen2.5:3b"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
        />
      </div>
    </div>
  )
}

function OpenAIFields({
  baseUrl,
  apiKey,
  model,
  onBaseUrlChange,
  onApiKeyChange,
  onModelChange
}: {
  baseUrl: string
  apiKey: string
  model: string
  onBaseUrlChange: (val: string) => void
  onApiKeyChange: (val: string) => void
  onModelChange: (val: string) => void
}): React.JSX.Element {
  return (
    <>
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Base URL</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
          placeholder="https://api.z.ai/v1"
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
          placeholder="sk-..."
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Model</label>
        <input
          type="text"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
          placeholder="e.g. glm-5"
        />
      </div>
    </>
  )
}

function PrivacyNotice({ provider }: { provider: 'ollama-cloud' | 'openai-compatible' }): React.JSX.Element {
  const msg =
    provider === 'ollama-cloud'
      ? '⚠️ Cloud models send your prompts to Ollama\'s infrastructure. Data leaves your machine.'
      : '⚠️ OpenAI-compatible providers send your prompts to a third-party API. Data leaves your machine.'

  return (
    <div className="rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2">
      <p className="text-[11px] text-amber-400">{msg}</p>
    </div>
  )
}