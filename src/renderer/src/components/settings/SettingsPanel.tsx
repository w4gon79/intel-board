/**
 * Settings Panel — slide-out drawer for app configuration.
 * Data sources, alert preferences, map, notifications, retention.
 */

import { useState, useEffect, useCallback } from 'react'
import { AlertRulesPanel } from './AlertRulesPanel'
import { SocialMediaPanel } from './SocialMediaPanel'

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
      <aside className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
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
                    Track commodities, currencies, shipping. Surface only anomalies.
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