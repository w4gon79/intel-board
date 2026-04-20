/**
 * StatusBar — live counts for alerts, watches, feed items, and flights.
 */

import { useState, useEffect } from 'react'
import { useIntelFeed } from '../../hooks/useIntelFeed'
import type { LayerVisibility } from '../map/LayerControls'

interface StatusBarProps {
  layers?: LayerVisibility
}

export function StatusBar({ layers }: StatusBarProps): React.JSX.Element {
  const { tierCounts, articleCount } = useIntelFeed()
  const showFlights = layers?.adsb ?? true
  const showVessels = layers?.ais ?? true
  const [flightCount, setFlightCount] = useState<{ total: number; military: number }>({
    total: 0,
    military: 0
  })
  const [vesselCount, setVesselCount] = useState<{ total: number; military: number }>({
    total: 0,
    military: 0
  })

  const alertCount = tierCounts['ALERT'] ?? 0
  const watchCount = tierCounts['WATCH'] ?? 0

  // Subscribe to flight count updates
  useEffect(() => {
    window.api.adsb
      .getCount()
      .then((counts) => setFlightCount(counts))
      .catch(() => {
        /* ignore */
      })

    const unsubscribe = window.api.adsb.onFlightCountUpdated((counts) => {
      setFlightCount(counts)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Subscribe to vessel count updates
  useEffect(() => {
    window.api.ais
      .getCountsByCategory()
      .then((counts) => setVesselCount(counts as { total: number; military: number }))
      .catch(() => {
        /* ignore */
      })

    const unsubscribe = window.api.ais.onVesselCountUpdated((counts) => {
      setVesselCount(counts)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  return (
    <div className="flex shrink-0 items-center gap-6 border-b border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-400">
      <span>
        <span className="font-medium text-red-400/90">ALERTS</span>
        <span className="mx-1.5 text-zinc-600">·</span>
        {alertCount} active
      </span>
      <span>
        <span className="font-medium text-amber-400/90">WATCHES</span>
        <span className="mx-1.5 text-zinc-600">·</span>
        {watchCount}
      </span>
      <span>
        <span className="font-medium text-sky-400/90">FEED</span>
        <span className="mx-1.5 text-zinc-600">·</span>
        {articleCount} articles
      </span>
      {showFlights && flightCount.total > 0 && (
        <span className="flex items-center gap-1">
          <span className="text-green-400">✈</span>
          <span>
            {flightCount.total.toLocaleString()} flights
            {flightCount.military > 0 && (
              <span className="ml-1 text-red-400/80">
                ({flightCount.military} mil)
              </span>
            )}
          </span>
        </span>
      )}
      {showVessels && vesselCount.total > 0 && (
        <span className="flex items-center gap-1">
          <span className="text-cyan-400">🚢</span>
          <span>
            {vesselCount.total.toLocaleString()} vessels
            {vesselCount.military > 0 && (
              <span className="ml-1 text-red-400/80">
                ({vesselCount.military} mil)
              </span>
            )}
          </span>
        </span>
      )}
    </div>
  )
}