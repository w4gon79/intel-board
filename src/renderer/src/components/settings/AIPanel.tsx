/**
 * AI Configuration Panel — slide-out drawer for LLM / Ollama settings.
 * Model selection, temperature, connection status, test connection.
 */

import { useState, useEffect, useCallback } from 'react'

interface AIPanelProps {
  open: boolean
  onClose: () => void
}

interface ModelInfo {
  name: string
  size: string
  modified_at: string
}

export function AIPanel({ open, onClose }: AIPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'ok' | 'error'>('unknown')
  const [connectionError, setConnectionError] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [customModel, setCustomModel] = useState('')

  // Load settings and models on open
  useEffect(() => {
    if (!open) return
    window.api.settings.get().then((s) => {
      setSettings(s)
      // If current model not in the fetched list, show it as custom
      setCustomModel(s.ai.chatModel)
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

  async function handleTestConnection(): Promise<void> {
    if (!settings) return
    setTesting(true)
    setConnectionStatus('unknown')
    try {
      const result = await window.api.settings.testConnection(settings.ai.baseUrl)
      if (result.ok) {
        setConnectionStatus('ok')
        setConnectionError('')
        // Refresh models after successful connection
        await refreshModels(settings.ai.baseUrl)
      } else {
        setConnectionStatus('error')
        setConnectionError(result.error ?? 'Connection failed')
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setTesting(false)
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

  if (!open || !settings) return <></>

  const isCloudModel = settings.ai.chatModel.endsWith('-cloud')

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">AI Configuration</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* ── Connection Status ── */}
          <Section title="Connection">
            <div className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  connectionStatus === 'ok'
                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                    : connectionStatus === 'error'
                      ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
                      : 'bg-zinc-500'
                }`}
              />
              <span className="text-xs text-zinc-400">
                {connectionStatus === 'ok'
                  ? 'Connected'
                  : connectionStatus === 'error'
                    ? `Error: ${connectionError}`
                    : 'Not tested'}
              </span>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="ml-auto rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
          </Section>

          {/* ── LLM Provider ── */}
          <Section title="LLM Provider">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Provider
                </label>
                <input
                  type="text"
                  value="Ollama"
                  disabled
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500 opacity-60"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Base URL
                </label>
                <input
                  type="text"
                  value={settings.ai.baseUrl}
                  onChange={(e) => {
                    updateAI({ baseUrl: e.target.value })
                    setConnectionStatus('unknown')
                  }}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  placeholder="http://localhost:11434"
                />
              </div>
            </div>
          </Section>

          {/* ── Embedding Model (fixed) ── */}
          <Section title="Embedding Model">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-zinc-300">nomic-embed-text</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
                  local
                </span>
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">
                Fixed embedding model — always runs locally via Ollama
              </p>
            </div>
          </Section>

          {/* ── Chat Model ── */}
          <Section title="Chat Model">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Select Model
                </label>
                <select
                  value={settings.ai.chatModel}
                  onChange={(e) => {
                    updateAI({ chatModel: e.target.value })
                    setCustomModel(e.target.value)
                  }}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                >
                  {models.length === 0 && (
                    <option value="">No models found</option>
                  )}
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({m.size})
                    </option>
                  ))}
                </select>
              </div>

              {/* Manual model entry */}
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
                      updateAI({ chatModel: customModel.trim() })
                    }
                  }}
                  placeholder="e.g. gpt-oss:120b-cloud"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-zinc-600">
                  Cloud models use <code className="text-zinc-500">-cloud</code> suffix (e.g.{' '}
                  <code className="text-zinc-500">llama4:120b-cloud</code>)
                </p>
              </div>

              {/* Cloud model privacy warning */}
              {isCloudModel && (
                <div className="rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2">
                  <p className="text-[11px] text-amber-400">
                    ⚠️ <strong>Privacy Notice:</strong> Cloud models send your prompts to Ollama's
                    infrastructure. Data leaves your machine.
                  </p>
                </div>
              )}

              {/* Model info */}
              {settings.ai.chatModel && (
                <div className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2">
                  <p className="text-[10px] text-zinc-500">
                    Active: <span className="text-zinc-300">{settings.ai.chatModel}</span>
                    {isCloudModel && (
                      <span className="ml-2 rounded bg-blue-900/50 px-1.5 py-0.5 text-[9px] text-blue-400">
                        cloud
                      </span>
                    )}
                  </p>
                </div>
              )}
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

          {/* ── API Info ── */}
          <Section title="API Details">
            <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-900/30 p-3 text-[10px] text-zinc-600">
              <p>
                Endpoint:{' '}
                <code className="text-zinc-400">
                  {settings.ai.baseUrl}/api/chat
                </code>
              </p>
              <p>
                Both local and cloud models use the same Ollama unified API endpoint.
              </p>
              <p>
                Embedding:{' '}
                <code className="text-zinc-400">{settings.ai.baseUrl}/api/embeddings</code>
              </p>
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

// ── Sub-component ──

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