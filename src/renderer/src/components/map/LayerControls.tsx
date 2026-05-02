/**
 * LayerControls — toggle visibility of map data layers.
 * Shows live counts for each layer.
 */

import { useState, useEffect } from 'react'
import { isInElectron } from '../../utils/api'

export interface LayerVisibility {
  adsb: boolean
  ais: boolean
  csg: boolean
  intel: boolean
  gfw: boolean
  corridors: boolean
  regions: boolean
  zones: boolean
}

interface LayerCounts {
  adsb: number
  ais: number
  csg: number
  intel: number
  gfw: number
  corridors: number
  regions: number
  zones: number
}

interface LayerControlsProps {
  layers: LayerVisibility
  onToggle: (layer: keyof LayerVisibility) => void
}

const LAYER_CONFIG: Array<{
  key: keyof LayerVisibility
  label: string
  icon: string
  color: string
}> = [
  { key: 'adsb', label: 'ADS-B Flights', icon: '✈', color: 'text-green-400' },
  { key: 'ais', label: 'AIS Vessels', icon: '🚢', color: 'text-cyan-400' },
  { key: 'csg', label: 'CSG / ARG', icon: '⚓', color: 'text-amber-400' },
  { key: 'gfw', label: 'GFW Presence', icon: '🛰', color: 'text-purple-400' },
  { key: 'intel', label: 'Intel Items', icon: '📍', color: 'text-amber-400' },
  { key: 'corridors', label: 'Transit Corridors', icon: '📏', color: 'text-orange-400' },
  { key: 'regions', label: 'Region Areas', icon: '🗺', color: 'text-teal-400' },
  { key: 'zones', label: 'Conflict Zones', icon: '📍', color: 'text-red-400' }
]

export function LayerControls({ layers, onToggle }: LayerControlsProps): React.JSX.Element {
  const [counts, setCounts] = useState<LayerCounts>({ adsb: 0, ais: 0, csg: 0, intel: 0, gfw: 0, corridors: 8, regions: 15, zones: 0 })
  const [aisFeedAlive, setAisFeedAlive] = useState(true)

  // Fetch counts for all layers (Electron IPC or HTTP fallback)
  useEffect(() => {
    async function fetchCounts(): Promise<void> {
      try {
        if (isInElectron()) {
          const [adsbData, aisCount, intelCount, gfwStatus, csgGroups] = await Promise.all([
            window.api.adsb.getCount().catch(() => ({ total: 0, military: 0 })),
            window.api.ais.getCount().catch(() => 0),
            window.api.intel.getCount().catch(() => 0),
            window.api.gfw.getStatus().catch(() => ({ totalRecords: 0 })),
            (window.api as Record<string, Record<string, () => Promise<unknown[]>>>).carrier?.getGroups?.().catch(() => []) ?? []
          ])
          setCounts((prev) => ({
            ...prev,
            adsb: (adsbData as { total: number; military: number }).total,
            ais: aisCount as number,
            csg: (csgGroups as unknown[]).length,
            intel: intelCount as number,
            gfw: (gfwStatus as { totalRecords: number }).totalRecords
          }))
          // Check AIS feed health on each poll
          try {
            const health = await window.api.ais.getStatus()
            setAisFeedAlive(health.feedAlive)
          } catch {
            /* ignore */
          }
        } else {
          // Browser context — use HTTP API
          const base = `${window.location.origin}/api`
          const [adsbData, aisCount, intelCount, gfwStatus, csgGroups] = await Promise.all([
            fetch(`${base}/adsb/count`).then(r => r.json()).catch(() => ({ total: 0, military: 0 })),
            fetch(`${base}/ais/count`).then(r => r.json()).catch(() => 0),
            fetch(`${base}/intel/count`).then(r => r.json()).catch(() => 0),
            fetch(`${base}/gfw/status`).then(r => r.json()).catch(() => ({ totalRecords: 0 })),
            fetch(`${base}/carrier/groups`).then(r => r.json()).catch(() => [])
          ])
          setCounts((prev) => ({
            ...prev,
            adsb: (adsbData as { total: number; military: number }).total,
            ais: aisCount as number,
            csg: (csgGroups as unknown[]).length,
            intel: intelCount as number,
            gfw: (gfwStatus as { totalRecords: number }).totalRecords
          }))
        }
      } catch {
        /* ignore */
      }
    }
    fetchCounts()
    const interval = setInterval(fetchCounts, 10_000)
    return () => clearInterval(interval)
  }, [])

  // Subscribe to real-time count updates (Electron only — browser uses polling above)
  useEffect(() => {
    if (!isInElectron()) return

    const unsubFlights = window.api.adsb.onFlightCountUpdated((c) => {
      setCounts((prev) => ({ ...prev, adsb: c.total }))
    })
    const unsubVessels = window.api.ais.onVesselCountUpdated((c) => {
      setCounts((prev) => ({ ...prev, ais: c.total }))
    })
    // Defensive: onFeedHealthUpdated may not exist in cached preload
    const unsubHealth = window.api.ais.onFeedHealthUpdated
      ? window.api.ais.onFeedHealthUpdated((h: { feedAlive: boolean }) => {
          setAisFeedAlive(h.feedAlive)
        })
      : () => {}
    return () => {
      unsubFlights()
      unsubVessels()
      unsubHealth()
    }
  }, [])

  return (
    <>
      {/* Desktop: vertical sidebar */}
      <div className="hidden lg:flex shrink-0 flex-col gap-2 w-44">
        {LAYER_CONFIG.map(({ key, label, icon, color }) => (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`
              flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all
              ${
                layers[key]
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-500 opacity-50'
              }
            `}
            aria-pressed={layers[key]}
            aria-label={`Toggle ${label} layer`}
          >
            <span className={layers[key] ? color : 'text-zinc-600'}>{icon}</span>
            <span>{label}</span>
            {counts[key] > 0 && key !== 'corridors' && key !== 'regions' && (
              <span className="ml-1 rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-400">
                {counts[key].toLocaleString()}
              </span>
            )}
            {!aisFeedAlive && key === 'ais' && layers.ais && counts.ais === 0 && (
              <span className="ml-1 rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">
                ⚠️ FEED DOWN
              </span>
            )}
            {!aisFeedAlive && key === 'ais' && layers.ais && counts.ais > 0 && (
              <span className="ml-1 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-300">
                ⚠️ STALE
              </span>
            )}
            <span className="ml-auto">
              {layers[key] ? (
                <svg className="h-3.5 w-3.5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5 text-zinc-600" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Mobile: horizontal scroll strip */}
      <div className="flex lg:hidden shrink-0 overflow-x-auto gap-1.5 px-2 py-2 no-scrollbar">
        {LAYER_CONFIG.map(({ key, label, icon, color }) => (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`
              shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all
              ${
                layers[key]
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-500 opacity-50'
              }
            `}
            aria-pressed={layers[key]}
            aria-label={`Toggle ${label} layer`}
          >
            <span className={layers[key] ? color : 'text-zinc-600'}>{icon}</span>
            <span>{label.split(' ')[0]}</span>
            {counts[key] > 0 && key !== 'corridors' && key !== 'regions' && (
              <span className="rounded bg-zinc-700/60 px-1 py-0.5 text-[10px] tabular-nums text-zinc-400">
                {counts[key].toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
