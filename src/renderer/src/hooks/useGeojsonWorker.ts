/**
 * useGeojsonWorker – React hook that manages a Web Worker for GeoJSON viewport filtering.
 *
 * Offloads the filtering of 33K+ features from the main thread to a Web Worker,
 * keeping the UI responsive during panning, zooming, and data updates.
 *
 * Falls back to main-thread filtering if the worker fails to load.
 */

import { useRef, useEffect, useCallback } from 'react'
import { filterFeaturesWithMilitary } from '../lib/viewportFilter'

// ─── Types ───────────────────────────────────────────────────

/** Minimal map interface to avoid importing mapbox-gl */
interface MapLike {
  getBounds(): {
    getSouthWest(): { lng: number; lat: number }
    getNorthEast(): { lng: number; lat: number }
  } | null
}

interface FilterBounds {
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
}

interface WorkerResponse {
  type: 'ais-filtered' | 'adsb-filtered'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[]
}

type PendingResolve = {
  resolve: (features: unknown[]) => void
  timer: ReturnType<typeof setTimeout>
}

// ─── Hook ────────────────────────────────────────────────────

export function useGeojsonWorker(): {
  filterAIS: (
    features: Array<{
      geometry: { type: string; coordinates: number[] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: { is_military: boolean | number; [key: string]: any }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any
    }>,
    map: MapLike
  ) => Promise<unknown[]>
  filterADSB: (
    features: Array<{
      geometry: { type: string; coordinates: number[] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: { is_military: boolean | number; [key: string]: any }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any
    }>,
    map: MapLike
  ) => Promise<unknown[]>
} {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<Map<string, PendingResolve>>(new Map())

  // ── Create / terminate worker ──

  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL('../workers/geojsonWorker.ts', import.meta.url),
        { type: 'module' }
      )

      workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const { type, features } = e.data
        const pending = pendingRef.current.get(type)
        if (pending) {
          clearTimeout(pending.timer)
          pending.resolve(features)
          pendingRef.current.delete(type)
        }
      }

      // Handle worker errors gracefully
      workerRef.current.onerror = (err) => {
        console.warn('[useGeojsonWorker] Worker error, falling back to main thread:', err)
        // Resolve all pending promises with empty arrays so callers don't hang
        for (const [key, pending] of pendingRef.current) {
          clearTimeout(pending.timer)
          pending.resolve([])
          pendingRef.current.delete(key)
        }
      }
    } catch (err) {
      console.warn('[useGeojsonWorker] Worker creation failed, will use main-thread fallback:', err)
    }

    return () => {
      // Clean up pending resolves before terminating
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timer)
        pending.resolve([])
      }
      pendingRef.current.clear()
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  // ── Helper: extract bounds from map ──

  const getBounds = useCallback((map: MapLike, padding: number = 2): FilterBounds => {
    const bounds = map.getBounds()
    if (!bounds) {
      // Fallback: return global bounds if getBounds() is null
      return { minLon: -180, maxLon: 180, minLat: -90, maxLat: 90 }
    }
    const sw = bounds.getSouthWest()
    const ne = bounds.getNorthEast()
    return {
      minLon: sw.lng - padding,
      maxLon: ne.lng + padding,
      minLat: sw.lat - padding,
      maxLat: ne.lat + padding
    }
  }, [])

  // ── Helper: send to worker with fallback ──

  const sendToWorker = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends { geometry: { type: string; coordinates: number[] }; properties: { is_military: boolean | number } }>(
      type: 'filter-ais' | 'filter-adsb',
      responseType: 'ais-filtered' | 'adsb-filtered',
      features: T[],
      map: MapLike
    ): Promise<unknown[]> => {
      return new Promise((resolve) => {
        if (!workerRef.current) {
          // Fallback: filter on main thread if worker not available
          const filtered = filterFeaturesWithMilitary(features, map)
          resolve(filtered)
          return
        }

        const bounds = getBounds(map)

        // Timeout fallback: if worker doesn't respond in 5s, resolve with main-thread result
        const timer = setTimeout(() => {
          console.warn(`[useGeojsonWorker] Worker timeout for ${type}, falling back to main thread`)
          pendingRef.current.delete(responseType)
          const filtered = filterFeaturesWithMilitary(features, map)
          resolve(filtered)
        }, 5000)

        pendingRef.current.set(responseType, { resolve, timer })

        workerRef.current.postMessage({
          type,
          features,
          bounds
        })
      })
    },
    [getBounds]
  )

  // ── Public API ──

  const filterAIS = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends { geometry: { type: string; coordinates: number[] }; properties: { is_military: boolean | number } }>(
      features: T[],
      map: MapLike
    ): Promise<unknown[]> => {
      return sendToWorker('filter-ais', 'ais-filtered', features, map)
    },
    [sendToWorker]
  )

  const filterADSB = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends { geometry: { type: string; coordinates: number[] }; properties: { is_military: boolean | number } }>(
      features: T[],
      map: MapLike
    ): Promise<unknown[]> => {
      return sendToWorker('filter-adsb', 'adsb-filtered', features, map)
    },
    [sendToWorker]
  )

  return { filterAIS, filterADSB }
}