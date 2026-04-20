/// <reference lib="webworker" />

/**
 * Web Worker for offloading GeoJSON viewport filtering from the main thread.
 *
 * When 33K+ vessel features arrive via IPC, filtering them on the main thread
 * causes jank. This worker handles the filtering off-thread so the UI stays
 * responsive during panning, zooming, and data updates.
 *
 * Supports both AIS (vessels) and ADS-B (flights) data types.
 * Military features are always included regardless of viewport bounds.
 */

// ─── Types ───────────────────────────────────────────────────

interface Bounds {
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
}

interface WorkerMessage {
  type: 'filter-ais' | 'filter-adsb'
  features: WorkerFeature[]
  bounds: Bounds
}

interface WorkerFeature {
  geometry: { type: string; coordinates: number[] }
  properties: { is_military: boolean | number; [key: string]: unknown }
  [key: string]: unknown
}

interface WorkerResponse {
  type: 'ais-filtered' | 'adsb-filtered'
  features: WorkerFeature[]
}

// ─── Filtering logic (mirrors viewportFilter.ts but runs in worker) ──

function filterByViewport(features: WorkerFeature[], bounds: Bounds): WorkerFeature[] {
  const { minLon, maxLon, minLat, maxLat } = bounds
  return features.filter((f) => {
    if (f.geometry.type !== 'Point') return false
    const coords = f.geometry.coordinates
    if (!coords || coords.length < 2) return false
    const [lon, lat] = coords
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
  })
}

/**
 * Split features into military and non-military, apply viewport filtering
 * only to non-military, then recombine. Military features are ALWAYS included.
 */
function filterWithMilitary(features: WorkerFeature[], bounds: Bounds): WorkerFeature[] {
  const military: WorkerFeature[] = []
  const nonMilitary: WorkerFeature[] = []

  for (const f of features) {
    const mil = f.properties?.is_military
    if (mil === true || mil === 1) {
      military.push(f)
    } else {
      nonMilitary.push(f)
    }
  }

  const filteredNonMilitary = filterByViewport(nonMilitary, bounds)
  return [...military, ...filteredNonMilitary]
}

// ─── Message handler ─────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, features, bounds } = e.data

  const inputFeatures = features || []
  const filtered = filterWithMilitary(inputFeatures, bounds)

  const responseType = type === 'filter-ais' ? 'ais-filtered' : 'adsb-filtered'
  const response: WorkerResponse = { type: responseType, features: filtered }
  self.postMessage(response)
}