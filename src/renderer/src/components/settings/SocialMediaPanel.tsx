/**
 * Social Media Panel — settings toggles and stats for Reddit + BlueSky sources.
 * Embedded within the SettingsPanel drawer.
 */

import { useState, useEffect, useCallback } from 'react'

interface SocialStats {
  reddit: { lastFetch: string | null; postCount: number; enabled: boolean }
  bluesky: { lastFetch: string | null; postCount: number; enabled: boolean }
  totalPosts: number
  analyzedPosts: number
}

interface SocialMediaSettings {
  reddit: { enabled: boolean; intervalMs: number }
  bluesky: { enabled: boolean; intervalMs: number }
}

interface SocialMediaPanelProps {
  settings: SocialMediaSettings
  onUpdate: (patch: Partial<SocialMediaSettings>) => void
}

export function SocialMediaPanel({ settings, onUpdate }: SocialMediaPanelProps): React.JSX.Element {
  const [stats, setStats] = useState<SocialStats | null>(null)
  const [polling, setPolling] = useState<'reddit' | 'bluesky' | null>(null)

  // Refresh stats periodically
  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30_000)
    return () => clearInterval(interval)
  }, [])

  async function loadStats(): Promise<void> {
    try {
      const s = (await window.api.social.getStats()) as SocialStats
      setStats(s)
    } catch {
      // ignore
    }
  }

  const poll = useCallback(async (source: 'reddit' | 'bluesky'): Promise<void> => {
    setPolling(source)
    try {
      if (source === 'reddit') {
        await window.api.social.pollReddit()
      } else {
        await window.api.social.pollBlueSky()
      }
      await loadStats()
    } catch (err) {
      console.error(`[SocialMedia] ${source} poll failed:`, err)
    } finally {
      setPolling(null)
    }
  }, [])

  return (
    <div>
      {/* Reddit */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">💬</span>
            <div>
              <span className="text-xs font-medium text-zinc-300">Reddit</span>
              <p className="text-[10px] text-zinc-500">
                r/geopolitics, r/CredibleDefense, r/OSINT + 5 more
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.reddit.enabled}
            onClick={() =>
              onUpdate({
                reddit: { ...settings.reddit, enabled: !settings.reddit.enabled }
              })
            }
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.reddit.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                settings.reddit.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {settings.reddit.enabled && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-[10px] text-zinc-500">Poll every</label>
            <select
              value={settings.reddit.intervalMs}
              onChange={(e) =>
                onUpdate({
                  reddit: { ...settings.reddit, intervalMs: Number(e.target.value) }
                })
              }
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
            >
              <option value={900000}>15 min</option>
              <option value={1800000}>30 min</option>
              <option value={3600000}>1 hour</option>
              <option value={7200000}>2 hours</option>
            </select>
            <button
              type="button"
              onClick={() => poll('reddit')}
              disabled={polling === 'reddit'}
              className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              {polling === 'reddit' ? 'Polling…' : 'Poll Now'}
            </button>
          </div>
        )}
        {stats?.reddit && (
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-600">
            <span>{stats.reddit.postCount} posts</span>
            {stats.reddit.lastFetch && (
              <span>Last: {new Date(stats.reddit.lastFetch).toLocaleTimeString()}</span>
            )}
          </div>
        )}
      </div>

      {/* BlueSky */}
      <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🦋</span>
            <div>
              <span className="text-xs font-medium text-zinc-300">BlueSky</span>
              <p className="text-[10px] text-zinc-500">
                OSINT, military movement, naval deployment + 4 more
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.bluesky.enabled}
            onClick={() =>
              onUpdate({
                bluesky: { ...settings.bluesky, enabled: !settings.bluesky.enabled }
              })
            }
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.bluesky.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                settings.bluesky.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {settings.bluesky.enabled && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-[10px] text-zinc-500">Poll every</label>
            <select
              value={settings.bluesky.intervalMs}
              onChange={(e) =>
                onUpdate({
                  bluesky: { ...settings.bluesky, intervalMs: Number(e.target.value) }
                })
              }
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 focus:outline-none"
            >
              <option value={900000}>15 min</option>
              <option value={1800000}>30 min</option>
              <option value={3600000}>1 hour</option>
              <option value={7200000}>2 hours</option>
            </select>
            <button
              type="button"
              onClick={() => poll('bluesky')}
              disabled={polling === 'bluesky'}
              className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              {polling === 'bluesky' ? 'Polling…' : 'Poll Now'}
            </button>
          </div>
        )}
        {stats?.bluesky && (
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-600">
            <span>{stats.bluesky.postCount} posts</span>
            {stats.bluesky.lastFetch && (
              <span>Last: {new Date(stats.bluesky.lastFetch).toLocaleTimeString()}</span>
            )}
          </div>
        )}
      </div>

      {/* Summary */}
      {stats && (
        <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-[10px] text-zinc-600">
          Total: {stats.totalPosts} posts · {stats.analyzedPosts} analyzed
        </div>
      )}
    </div>
  )
}