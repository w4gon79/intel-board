/**
 * SourcePanel – Manages data source scrapers.
 *
 * Shows each scraper with:
 *   - Name, enabled status, interval
 *   - Toggle to enable/disable
 *   - Manual refresh button
 */

import { useState, useEffect } from 'react'

interface SourceInfo {
  id: string
  name: string
  enabled: boolean
  interval: number
}

export default function SourcePanel(): React.JSX.Element {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  useEffect(() => {
    loadSources()
  }, [])

  const loadSources = async (): Promise<void> => {
    try {
      const data = await window.api.sources.list()
      setSources(data as SourceInfo[])
    } catch (err) {
      console.error('[SourcePanel] Failed to load sources:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (id: string, enabled: boolean): Promise<void> => {
    try {
      await window.api.sources.toggle(id, enabled)
      setSources(prev =>
        prev.map(s => (s.id === id ? { ...s, enabled } : s))
      )
    } catch (err) {
      console.error(`[SourcePanel] Failed to toggle ${id}:`, err)
    }
  }

  const handleRefresh = async (id: string): Promise<void> => {
    setRefreshingId(id)
    try {
      await window.api.sources.refresh(id)
    } catch (err) {
      console.error(`[SourcePanel] Failed to refresh ${id}:`, err)
    } finally {
      setRefreshingId(null)
    }
  }

  const formatInterval = (ms: number): string => {
    const minutes = ms / 60000
    if (minutes < 60) return `${minutes}m`
    const hours = minutes / 60
    return `${hours}h`
  }

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-400">Loading sources...</div>
    )
  }

  return (
    <div className="p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Data Sources
      </h3>
      {sources.length === 0 ? (
        <p className="text-xs text-gray-500">No scrapers configured.</p>
      ) : (
        <div className="space-y-2">
          {sources.map(source => (
            <div
              key={source.id}
              className={`
                flex items-center justify-between p-3 rounded-lg border
                ${source.enabled
                  ? 'bg-gray-800/60 border-gray-700'
                  : 'bg-gray-900/40 border-gray-800 opacity-60'
                }
              `}
            >
              <div className="flex items-center gap-3">
                {/* Toggle */}
                <button
                  onClick={() => handleToggle(source.id, !source.enabled)}
                  className={`
                    relative w-9 h-5 rounded-full transition-colors
                    ${source.enabled ? 'bg-blue-600' : 'bg-gray-600'}
                  `}
                  aria-label={`Toggle ${source.name}`}
                >
                  <span
                    className={`
                      absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
                      ${source.enabled ? 'translate-x-4' : 'translate-x-0'}
                    `}
                  />
                </button>

                {/* Name + interval */}
                <div>
                  <div className="text-sm text-gray-200">{source.name}</div>
                  <div className="text-xs text-gray-500">
                    Every {formatInterval(source.interval)}
                  </div>
                </div>
              </div>

              {/* Refresh button */}
              <button
                onClick={() => handleRefresh(source.id)}
                disabled={!source.enabled || refreshingId === source.id}
                className={`
                  px-2 py-1 text-xs rounded transition-colors
                  ${source.enabled
                    ? 'text-blue-400 hover:bg-blue-900/30'
                    : 'text-gray-600 cursor-not-allowed'
                  }
                `}
                title="Refresh now"
              >
                {refreshingId === source.id ? '⏳' : '↻'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}