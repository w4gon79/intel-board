/**
 * Settings Panel — slide-out drawer for app configuration.
 * Data sources, alert preferences, map, notifications, retention.
 */

import { useState, useEffect, useCallback } from 'react'
import { AlertRulesPanel } from './AlertRulesPanel'
import { SocialMediaPanel } from './SocialMediaPanel'
import { ApiKeysPanel } from './ApiKeysPanel'
import { TranslationPanel } from './TranslationPanel'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)

  // Load settings on open
  useEffect(() => {
    if (open) {
      window.api.settings.get().then((s) => setSettings(s))
    }
  }, [open])

  const update = useCallback(
    (section: 'alerts' | 'map' | 'notifications', patch: Record<string, boolean>): void => {
      if (!settings) return
      setSettings({
        ...settings,
        [section]: { ...(settings[section] as Record<string, boolean>), ...patch }
      })
    },
    [settings]
  )

  const updateSource = useCallback(
    (src: 'adsb' | 'ais' | 'news', patch: { enabled?: boolean; intervalMs?: number }): void => {
      if (!settings) return
      setSettings({
        ...settings,
        dataSources: {
          ...settings.dataSources,
          [src]: { ...settings.dataSources[src], ...patch }
        }
      })
    },
    [settings]
  )

  async function handleSave(): Promise<void> {
    if (!settings) return
    setSaving(true)
    try {
      await window.api.settings.save(settings)
      // Dispatch event so SituationMap and other components refresh immediately
      window.dispatchEvent(new CustomEvent('settings-changed'))
    } catch (err) {
      console.error('[Settings] Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!open || !settings) return <></>

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-zinc-800 bg-zinc-950/95 backdrop-blur-sm sm:w-96">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
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

        {/* Scrollable body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* ── Data Sources ── */}
          <Section title="Data Sources">
            <SourceToggle
              label="ADS-B (Flights)"
              enabled={settings.dataSources.adsb.enabled}
              intervalMs={settings.dataSources.adsb.intervalMs}
              onToggle={(e) => updateSource('adsb', { enabled: e })}
              onInterval={(ms) => updateSource('adsb', { intervalMs: ms })}
            />
            <SourceToggle
              label="AIS (Ships)"
              enabled={settings.dataSources.ais.enabled}
              intervalMs={settings.dataSources.ais.intervalMs}
              onToggle={(e) => updateSource('ais', { enabled: e })}
              onInterval={(ms) => updateSource('ais', { intervalMs: ms })}
            />
            <SourceToggle
              label="News Feed"
              enabled={settings.dataSources.news.enabled}
              intervalMs={settings.dataSources.news.intervalMs}
              onToggle={(e) => updateSource('news', { enabled: e })}
              onInterval={(ms) => updateSource('news', { intervalMs: ms })}
            />
          </Section>

          {/* ── Alert Preferences ── */}
          <Section title="Alert Preferences">
            <ToggleRow
              label="Military Flights"
              checked={settings.alerts.militaryFlights}
              onChange={(v) => update('alerts', { militaryFlights: v })}
            />
            <ToggleRow
              label="Choke Point Alerts"
              checked={settings.alerts.chokePoints}
              onChange={(v) => update('alerts', { chokePoints: v })}
            />
            <ToggleRow
              label="News Sentiment Spikes"
              checked={settings.alerts.newsSpikes}
              onChange={(v) => update('alerts', { newsSpikes: v })}
            />
          </Section>

          {/* ── Custom Alert Rules ── */}
          <AlertRulesPanel />

          {/* ── Map Preferences ── */}
          <Section title="Map Preferences">
            <ToggleRow
              label="Show Military Only"
              checked={settings.map.militaryOnly}
              onChange={(v) => update('map', { militaryOnly: v })}
            />
            <ToggleRow
              label="Clustering"
              checked={settings.map.clustering}
              onChange={(v) => update('map', { clustering: v })}
            />
          </Section>

          {/* ── Notifications ── */}
          <Section title="Notifications">
            <ToggleRow
              label="ALERT (Red)"
              checked={settings.notifications.alert}
              onChange={(v) => update('notifications', { alert: v })}
            />
            <ToggleRow
              label="WATCH (Yellow)"
              checked={settings.notifications.watch}
              onChange={(v) => update('notifications', { watch: v })}
            />
            <ToggleRow
              label="CONTEXT (Blue)"
              checked={settings.notifications.context}
              onChange={(v) => update('notifications', { context: v })}
            />
          </Section>

          {/* ── Notification Channels ── */}
          <NotificationChannelsSection
            channels={settings.notificationChannels}
            onUpdate={(patch) =>
              setSettings({
                ...settings,
                notificationChannels: { ...settings.notificationChannels, ...patch }
              })
            }
          />

          {/* ── Data Retention ── */}
          <Section title="Data Retention">
            <label className="block text-xs text-zinc-500 mb-1.5">Keep data for</label>
            <select
              value={settings.retentionDays}
              onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </Section>

          {/* ── Social Media ── */}
          <Section title="Social Media">
            <SocialMediaPanel
              settings={settings.socialMedia}
              onUpdate={(patch) =>
                setSettings({
                  ...settings,
                  socialMedia: { ...settings.socialMedia, ...patch }
                })
              }
            />
          </Section>

          {/* ── Economic Monitoring ── */}
          <Section title="Economic Monitoring">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-zinc-300">Market Anomaly Detection</span>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Track commodities, currencies, shipping, interest rates. Surface only anomalies.
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-1">
                    💡 Add a FRED API key below to enable bond yields & interest rate tracking.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.economic.enabled}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      economic: { ...settings.economic, enabled: !settings.economic.enabled }
                    })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.economic.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      settings.economic.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {settings.economic.enabled && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[10px] text-zinc-500">Poll interval</label>
                  <select
                    value={settings.economic.intervalMs}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        economic: { ...settings.economic, intervalMs: Number(e.target.value) }
                      })
                    }
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
                  >
                    <option value={900000}>15 min</option>
                    <option value={1800000}>30 min</option>
                    <option value={3600000}>1 hour</option>
                    <option value={7200000}>2 hours</option>
                  </select>
                </div>
              )}
            </div>
          </Section>

          {/* ── NOTAM (Military Airspace) ── */}
          <Section title="NOTAM (Military Airspace)">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-zinc-300">Military NOTAM Scanner</span>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Ingest military/defense airspace restrictions from FAA. Free, no API key needed.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.notam.enabled}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      notam: { ...settings.notam, enabled: !settings.notam.enabled }
                    })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.notam.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      settings.notam.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {settings.notam.enabled && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[10px] text-zinc-500">Poll interval</label>
                  <select
                    value={settings.notam.intervalMs}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notam: { ...settings.notam, intervalMs: Number(e.target.value) }
                      })
                    }
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
                  >
                    <option value={2 * 60 * 60 * 1000}>2 hours</option>
                    <option value={4 * 60 * 60 * 1000}>4 hours</option>
                    <option value={6 * 60 * 60 * 1000}>6 hours</option>
                    <option value={12 * 60 * 60 * 1000}>12 hours</option>
                  </select>
                </div>
              )}
            </div>
          </Section>

          {/* ── AI Sense-Making ── */}
          <Section title="AI Sense-Making">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-zinc-300">Intelligence Analysis</span>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Periodic AI analysis of tactical events, fleet posture, and choke point traffic.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.senseMaking.enabled}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      senseMaking: { ...settings.senseMaking, enabled: !settings.senseMaking.enabled }
                    })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.senseMaking.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      settings.senseMaking.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {settings.senseMaking.enabled && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[10px] text-zinc-500">Interval</label>
                  <select
                    value={settings.senseMaking.intervalMinutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        senseMaking: { ...settings.senseMaking, intervalMinutes: Number(e.target.value) }
                      })
                    }
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
                  >
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                    <option value={240}>4 hours</option>
                    <option value={360}>6 hours</option>
                    <option value={720}>12 hours</option>
                    <option value={1440}>24 hours</option>
                  </select>
                </div>
              )}
            </div>
          </Section>

          {/* ── Translation Pipeline ── */}
          <Section title="Translation Pipeline">
            <TranslationPanel
              settings={settings.translation}
              onUpdate={(patch) =>
                setSettings({
                  ...settings,
                  translation: { ...settings.translation, ...patch }
                })
              }
            />
          </Section>

          {/* ── API Keys ── */}
          <Section title="API Keys">
            <ApiKeysPanel
              apiKeys={settings.apiKeys}
              onUpdate={(patch) =>
                setSettings({
                  ...settings,
                  apiKeys: { ...settings.apiKeys, ...patch }
                })
              }
            />
          </Section>

          {/* ── Remote Access ── */}
          <Section title="Remote Access">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-zinc-300">HTTP Server</span>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Access Intel Board from other devices on your network
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.remoteServer.enabled}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      remoteServer: { ...settings.remoteServer, enabled: !settings.remoteServer.enabled }
                    })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.remoteServer.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      settings.remoteServer.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {settings.remoteServer.enabled && (
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[10px] text-zinc-500">Port</label>
                  <input
                    type="number"
                    value={settings.remoteServer.port}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        remoteServer: { ...settings.remoteServer, port: Number(e.target.value) }
                      })
                    }
                    className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
                    min={1024}
                    max={65535}
                  />
                  <span className="text-[10px] text-zinc-600">
                    http://{typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:{settings.remoteServer.port}
                  </span>
                </div>
              )}
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
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </aside>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div
      className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-zinc-900"
      onClick={() => onChange(!checked)}
    >
      <span className="text-xs text-zinc-300">{label}</span>
      <div
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
    </div>
  )
}

function SourceToggle({
  label,
  enabled,
  intervalMs,
  onToggle,
  onInterval
}: {
  label: string
  enabled: boolean
  intervalMs: number
  onToggle: (v: boolean) => void
  onInterval: (ms: number) => void
}): React.JSX.Element {
  const seconds = Math.round(intervalMs / 1000)
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            enabled ? 'bg-emerald-600' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {enabled && (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-[10px] text-zinc-500">Refresh</label>
          <select
            value={intervalMs}
            onChange={(e) => onInterval(Number(e.target.value))}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
          >
            <option value={10000}>10s</option>
            <option value={30000}>30s</option>
            <option value={60000}>1 min</option>
            <option value={120000}>2 min</option>
            <option value={300000}>5 min</option>
            <option value={600000}>10 min</option>
          </select>
          <span className="text-[10px] text-zinc-600">({seconds}s)</span>
        </div>
      )}
    </div>
  )
}

// ── Notification Channels Section ────────────────────────────────────────

type NotificationChannels = AppSettings['notificationChannels']

function NotificationChannelsSection({
  channels,
  onUpdate
}: {
  channels: NotificationChannels
  onUpdate: (patch: Partial<NotificationChannels>) => void
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'telegram' | 'webhook' | 'email'>('telegram')
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; error?: string }> | null>(null)
  const [testing, setTesting] = useState(false)

  async function handleTest(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.notifications.sendTest()
      setTestResult(result.results)
    } catch (err) {
      setTestResult({ global: { ok: false, error: err instanceof Error ? err.message : 'Test failed' } })
    } finally {
      setTesting(false)
    }
  }

  const tabs: { key: 'telegram' | 'webhook' | 'email'; label: string; icon: string }[] = [
    { key: 'telegram', label: 'Telegram', icon: '📨' },
    { key: 'webhook', label: 'Webhook', icon: '🔗' },
    { key: 'email', label: 'Email', icon: '📧' }
  ]

  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Notification Channels
      </h3>
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50">
        {/* Tab bar */}
        <div className="flex border-b border-zinc-800">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-2 py-2 text-[10px] font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-indigo-400 border-b-2 border-indigo-400 bg-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-3 space-y-2">
          {activeTab === 'telegram' && (
            <TelegramTab
              config={channels.telegram}
              onUpdate={(patch) => onUpdate({ telegram: { ...channels.telegram, ...patch } })}
            />
          )}
          {activeTab === 'webhook' && (
            <WebhookTab
              config={channels.webhook}
              onUpdate={(patch) => onUpdate({ webhook: { ...channels.webhook, ...patch } })}
            />
          )}
          {activeTab === 'email' && (
            <EmailTab
              config={channels.email}
              onUpdate={(patch) => onUpdate({ email: { ...channels.email, ...patch } })}
            />
          )}

          {/* Test button */}
          <div className="pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="w-full rounded-md bg-zinc-800 px-3 py-1.5 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              {testing ? 'Testing…' : '▶ Test All Enabled Channels'}
            </button>
            {testResult && (
              <div className="mt-2 space-y-1">
                {Object.entries(testResult).map(([channel, result]) => (
                  <div
                    key={channel}
                    className={`text-[10px] px-2 py-1 rounded ${
                      result.ok ? 'text-emerald-400 bg-emerald-950/30' : 'text-red-400 bg-red-950/30'
                    }`}
                  >
                    {result.ok ? '✓' : '✗'} {channel}: {result.ok ? 'OK' : result.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TelegramTab({
  config,
  onUpdate
}: {
  config: NotificationChannels['telegram']
  onUpdate: (patch: Partial<NotificationChannels['telegram']>) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-300">Enable Telegram</span>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => onUpdate({ enabled: !config.enabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            config.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <InputField
        label="Bot Token"
        value={config.botToken}
        onChange={(v) => onUpdate({ botToken: v })}
        placeholder="123456:ABC-DEF..."
        masked
      />
      <InputField
        label="Chat ID"
        value={config.chatId}
        onChange={(v) => onUpdate({ chatId: v })}
        placeholder="-1001234567890"
      />
    </div>
  )
}

function WebhookTab({
  config,
  onUpdate
}: {
  config: NotificationChannels['webhook']
  onUpdate: (patch: Partial<NotificationChannels['webhook']>) => void
}): React.JSX.Element {
  const [headerKey, setHeaderKey] = useState('')
  const [headerVal, setHeaderVal] = useState('')

  function addHeader(): void {
    if (!headerKey.trim()) return
    onUpdate({ headers: { ...config.headers, [headerKey.trim()]: headerVal.trim() } })
    setHeaderKey('')
    setHeaderVal('')
  }

  function removeHeader(key: string): void {
    const next = { ...config.headers }
    delete next[key]
    onUpdate({ headers: next })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-300">Enable Webhook</span>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => onUpdate({ enabled: !config.enabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            config.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <InputField
        label="URL"
        value={config.url}
        onChange={(v) => onUpdate({ url: v })}
        placeholder="https://hooks.example.com/alert"
      />
      {/* Custom headers */}
      <div>
        <label className="block text-[10px] text-zinc-500 mb-1">Custom Headers</label>
        {Object.entries(config.headers).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1 mb-1">
            <span className="text-[10px] text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5 truncate max-w-[80px]">{key}</span>
            <span className="text-[10px] text-zinc-500 truncate">= {val || '""'}</span>
            <button
              type="button"
              onClick={() => removeHeader(key)}
              className="text-[10px] text-red-400 hover:text-red-300 ml-auto shrink-0"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1 mt-1">
          <input
            type="text"
            value={headerKey}
            onChange={(e) => setHeaderKey(e.target.value)}
            placeholder="Key"
            className="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-300 focus:outline-none"
          />
          <input
            type="text"
            value={headerVal}
            onChange={(e) => setHeaderVal(e.target.value)}
            placeholder="Value"
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-300 focus:outline-none"
          />
          <button
            type="button"
            onClick={addHeader}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 shrink-0"
          >
            + Add
          </button>
        </div>
      </div>
    </div>
  )
}

function EmailTab({
  config,
  onUpdate
}: {
  config: NotificationChannels['email']
  onUpdate: (patch: Partial<NotificationChannels['email']>) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-300">Enable Email</span>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => onUpdate({ enabled: !config.enabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            config.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <InputField label="SMTP Host" value={config.host} onChange={(v) => onUpdate({ host: v })} placeholder="smtp.gmail.com" />
      <div className="flex gap-2">
        <div className="w-20">
          <InputField label="Port" value={String(config.port)} onChange={(v) => onUpdate({ port: Number(v) || 587 })} placeholder="587" />
        </div>
        <div className="flex-1">
          <InputField label="Username" value={config.user} onChange={(v) => onUpdate({ user: v })} placeholder="user@example.com" />
        </div>
      </div>
      <InputField label="Password" value={config.password} onChange={(v) => onUpdate({ password: v })} placeholder="••••••••" masked />
      <InputField label="From" value={config.from} onChange={(v) => onUpdate({ from: v })} placeholder="alerts@intelboard.local" />
      <InputField label="To" value={config.to} onChange={(v) => onUpdate({ to: v })} placeholder="you@example.com" />
    </div>
  )
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  masked
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  masked?: boolean
}): React.JSX.Element {
  return (
    <div>
      <label className="block text-[10px] text-zinc-500 mb-0.5">{label}</label>
      <input
        type={masked ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-300 focus:outline-none focus:border-indigo-500"
      />
    </div>
  )
}
