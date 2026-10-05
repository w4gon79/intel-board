/**
 * useGeojsonWorker – React hook for GeoJSON viewport filtering.
 *
 * History: this hook previously offloaded filtering to a Web Worker. That
 * worker has been dead weight since the maplibre-gl 6 / packaging changes:
 * it never responds in dev (5s timeout on every cycle) and fails to load
 * outright in the packaged app (module worker from asar), leaving cold
 * starts with empty map sources. The main-thread filter over 15K+ features
 * is a simple array pass (sub-millisecond) and was already running on every
 * cycle via the timeout fallback, so the worker is removed entirely.
 *
 * The public API (filterAIS / filterADSB returning promises) is unchanged
 * so call sites do not need to know.
 */

import { useCallback } from 'react'
import { filterFeaturesWithMilitary } from '../lib/viewportFilter'

// ─── Types ───────────────────────────────────────────────────

/** Minimal map interface to avoid importing mapbox-gl */
interface MapLike {
  getBounds(): {
    getSouthWest(): { lng: number; lat: number }
    getNorthEast(): { lng: number; lat: number }
  } | null
}

interface FilterFeature {
  geometry: { type: string; coordinates: number[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: { is_military: boolean | number; [key: string]: any }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

// ─── Hook ────────────────────────────────────────────────────

export function useGeojsonWorker(): {
  filterAIS: (features: FilterFeature[], map: MapLike) => Promise<unknown[]>
  filterADSB: (features: FilterFeature[], map: MapLike) => Promise<unknown[]>
} {
  const filterAIS = useCallback(
    (features: FilterFeature[], map: MapLike): Promise<unknown[]> =>
      Promise.resolve(filterFeaturesWithMilitary(features, map)),
    []
  )

  const filterADSB = useCallback(
    (features: FilterFeature[], map: MapLike): Promise<unknown[]> =>
      Promise.resolve(filterFeaturesWithMilitary(features, map)),
    []
  )

  return { filterAIS, filterADSB }
}
