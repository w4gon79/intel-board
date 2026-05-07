/**
 * IntelLayer – Renders intelligence items on the map as tier-colored markers.
 *
 * Color coding:
 *   ALERT (red):    #ef4444 — requires immediate attention
 *   WATCH (amber):  #f59e0b — monitoring, potential escalation
 *   CONTEXT (blue): #3b82f6 — situational awareness, no action needed
 *
 * Intel items don't have explicit lat/lon, so this layer maps their
 * `region` field to approximate geographic coordinates.
 */

import { useEffect, useRef, useState } from 'react'
import type { Map as MapboxMap, GeoJSONSource } from 'maplibre-gl'
import type { IntelItem, IntelTier } from '../../../../shared/types'
import { useIntelHighlight } from '../../contexts/IntelHighlightContext'

// ─── Layer / source IDs ──────────────────────────────────────

export const INTEL_SOURCE_ID = 'intel-items'
export const INTEL_LAYER_ID = 'intel-markers'
const SOURCE_ID = INTEL_SOURCE_ID
const LAYER_ID = INTEL_LAYER_ID

// ─── Square icon generator ───────────────────────────────────

/** Create a filled square icon as ImageData for Mapbox. */
function createSquareIcon(
  color: string,
  size: number,
  strokeColor: string = '#ffffff',
  strokeWidth: number = 1.5
): ImageData {
  const canvas = document.createElement('canvas')
  const w = size + strokeWidth * 2
  const h = size + strokeWidth * 2
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(strokeWidth, strokeWidth, size, size)
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = strokeWidth
  ctx.strokeRect(strokeWidth, strokeWidth, size, size)
  return ctx.getImageData(0, 0, w, h)
}

const ICON_IDS = {
  ALERT: 'square-alert',
  WATCH: 'square-watch',
  CONTEXT: 'square-context'
} as const

// ─── Region → approximate center coordinates ─────────────────

const REGION_COORDS: Record<string, [number, number]> = {
  // Middle East
  'middle east': [44.3, 33.3],
  'gulf': [50.0, 26.0],
  'persian gulf': [50.0, 26.0],
  'red sea': [40.0, 18.0],
  'levant': [36.0, 33.0],
  'syria': [38.0, 35.0],
  'iraq': [44.0, 33.0],
  'iran': [53.0, 32.0],
  'israel': [35.0, 31.5],
  'yemen': [44.0, 15.5],
  'saudi arabia': [45.0, 24.0],
  // Asia-Pacific
  'south china sea': [113.0, 12.0],
  'east china sea': [125.0, 30.0],
  'taiwan strait': [119.5, 24.5],
  'korean peninsula': [127.0, 37.5],
  'north korea': [127.5, 40.0],
  'south korea': [127.5, 36.0],
  'japan': [138.0, 36.0],
  'taiwan': [121.0, 23.5],
  'india': [78.0, 22.0],
  'pakistan': [69.0, 30.0],
  'myanmar': [96.0, 20.0],
  'southeast asia': [110.0, 5.0],
  // Europe
  'europe': [15.0, 50.0],
  'eastern europe': [30.0, 50.0],
  'ukraine': [31.0, 49.0],
  'balkans': [19.0, 44.0],
  'baltic': [22.0, 58.5],
  'baltic sea': [22.0, 58.5],
  'kattegat': [11.0, 57.5],
  'kattegat/skagerrak': [11.0, 57.5],
  'black sea': [34.0, 44.0],
  'mediterranean': [18.0, 36.0],
  'north atlantic': [-30.0, 50.0],
  // Africa
  'africa': [20.0, 5.0],
  'north africa': [10.0, 30.0],
  'sahel': [5.0, 15.0],
  'horn of africa': [45.0, 8.0],
  'somalia': [46.0, 5.0],
  'libya': [17.0, 27.0],
  'egypt': [30.0, 27.0],
  // Americas
  'north america': [-100.0, 45.0],
  'south america': [-60.0, -15.0],
  'caribbean': [-72.0, 18.0],
  'central america': [-85.0, 14.0],
  'venezuela': [-66.0, 8.0],
  // Russia / Central Asia
  'russia': [60.0, 60.0],
  'central asia': [65.0, 42.0],
  'caucasus': [44.0, 42.0],
  'afghanistan': [66.0, 33.0],
  // Oceans / choke points
  'strait of hormuz': [56.35, 26.5],
  'suez canal': [32.3, 30.0],
  'bab el-mandeb': [43.3, 12.6],
  'malacca strait': [101.5, 2.5],
  'gibraltar': [-5.6, 35.9],
  'bosporus': [29.0, 41.0],
  'arctic': [0.0, 80.0],
  'indo-pacific': [140.0, 0.0],
  'pacific': [-160.0, 0.0],
  'atlantic': [-30.0, 20.0],
  'indian ocean': [70.0, -10.0]
}

// ─── Tier colors ─────────────────────────────────────────────

const TIER_COLORS: Record<IntelTier, string> = {
  ALERT: '#ef4444',
  WATCH: '#f59e0b',
  CONTEXT: '#3b82f6'
}

// ─── Types ───────────────────────────────────────────────────

export interface IntelProperties {
  id: string
  title: string
  tier: IntelTier
  summary: string
  confidence: number
  region: string
  created_at: string
}

interface IntelFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: IntelProperties
}

interface IntelFeatureCollection {
  type: 'FeatureCollection'
  features: IntelFeature[]
}

// ─── Props ───────────────────────────────────────────────────

interface IntelLayerProps {
  map: MapboxMap | null
  visible?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────

/** Map a region string to approximate [lon, lat] coordinates */
function regionToCoords(region: string | null): [number, number] | null {
  if (!region) return null
  const lower = region.toLowerCase().trim()
  // Direct lookup
  if (REGION_COORDS[lower]) return REGION_COORDS[lower]
  // Partial match
  for (const [key, coords] of Object.entries(REGION_COORDS)) {
    if (lower.includes(key) || key.includes(lower)) return coords
  }
  return null
}

/** Convert IntelItem[] to GeoJSON — prefers stored lat/lon, falls back to region mapping */
function itemsToGeoJSON(items: IntelItem[]): IntelFeatureCollection {
  const features: IntelFeature[] = []
  for (const item of items) {
    // Prefer stored coordinates (from tactical engine centroid) over region lookup
    let coords: [number, number] | null = null
    if (item.latitude != null && item.longitude != null) {
      coords = [item.longitude, item.latitude]
    } else {
      coords = regionToCoords(item.region)
    }
    if (!coords) continue // skip items without mappable coordinates
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        id: item.id,
        title: item.title,
        tier: item.tier,
        summary: item.summary ?? '',
        confidence: item.confidence ?? 0,
        region: item.region ?? '',
        created_at: item.created_at
      }
    })
  }
  return { type: 'FeatureCollection', features }
}

// ─── Component ───────────────────────────────────────────────

export default function IntelLayer({
  map,
  visible = true
}: IntelLayerProps): React.JSX.Element {
  const { registerFlashCallback, unregisterFlashCallback } = useIntelHighlight()
  const [geojson, setGeojson] = useState<IntelFeatureCollection>({
    type: 'FeatureCollection',
    features: []
  })
  const [flashingId, setFlashingId] = useState<string | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sourcesAddedRef = useRef(false)
  const geojsonRef = useRef<IntelFeatureCollection>(geojson)
  const flashCallbackRef = useRef<((id: string) => void) | null>(null)

  // Keep geojson ref current for flash callback
  useEffect(() => {
    geojsonRef.current = geojson
  }, [geojson])

  // ── Fetch intel items on mount and periodically (Electron or HTTP) ──────

  useEffect(() => {
    async function fetchItems(): Promise<void> {
      try {
        let items: IntelItem[]

        if ((window as any).api?.intel) {
          // Electron context — use preload bridge
          const result = await window.api.intel.getRecent(200)
          items = (result ?? []) as IntelItem[]
        } else {
          // Browser context — use HTTP API
          const res = await fetch(`${window.location.origin}/api/intel/recent?limit=200`)
          if (!res.ok) return
          items = (await res.json()) as IntelItem[]
        }

        const fc = itemsToGeoJSON(items)
        console.log(`[IntelLayer] Fetched ${fc.features.length} mappable intel items`)
        setGeojson(fc)
      } catch (err) {
        console.error('[IntelLayer] Fetch failed:', err)
      }
    }
    fetchItems()
    const interval = setInterval(fetchItems, 30_000)
    return () => clearInterval(interval)
  }, [])

  // ── Add GeoJSON source + layer once when map is ready ──

  useEffect(() => {
    if (!map || sourcesAddedRef.current) return

    const addSourcesAndLayers = (): void => {
      if (sourcesAddedRef.current) return
      console.log('[IntelLayer] Adding source + layers to map')
      sourcesAddedRef.current = true

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })

      // ── Add square icons per tier ──
      map.addImage(ICON_IDS.ALERT, createSquareIcon(TIER_COLORS.ALERT, 10))
      map.addImage(ICON_IDS.WATCH, createSquareIcon(TIER_COLORS.WATCH, 8))
      map.addImage(ICON_IDS.CONTEXT, createSquareIcon(TIER_COLORS.CONTEXT, 7))

      // Symbol layer with tier-driven square icons
      map.addLayer({
        id: LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'icon-image': [
            'match',
            ['get', 'tier'],
            'ALERT', ICON_IDS.ALERT,
            'WATCH', ICON_IDS.WATCH,
            'CONTEXT', ICON_IDS.CONTEXT,
            ICON_IDS.CONTEXT
          ],
          'icon-size': 1,
          'icon-allow-overlap': true,
          'icon-anchor': 'center'
        }
      })

      // Cursor
      map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = '' })

      // Register flash callback for feed → map highlighting
      const flashCallback = (id: string) => {
        if (!map || !sourcesAddedRef.current) return

        // Use the ref instead of source.serialize()
        const currentData = geojsonRef.current
        if (!currentData?.features) return

        const feature = currentData.features.find(f => f.properties.id === id)
        if (!feature) return

        const coords = feature.geometry.coordinates

        // Pan to the marker (no zoom change)
        map.easeTo({
          center: coords,
          duration: 800
        })

        // Start flashing
        setFlashingId(id)

        // Clear any existing timeout
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)

        // Stop flashing after 3 seconds
        flashTimeoutRef.current = setTimeout(() => {
          setFlashingId(null)
        }, 3000)
      }
      flashCallbackRef.current = flashCallback
      registerFlashCallback(flashCallback)
    }

    // Use try/catch + style.load fallback instead of isStyleLoaded()/on('load').
    // With MapLibre + CARTO tiles, the 'load' event fires early and isStyleLoaded()
    // returns false while tiles are still loading — causing sources/layers to never be added.
    try {
      addSourcesAndLayers()
    } catch {
      // Style not ready yet — wait for the style.load event
      map.once('style.load', addSourcesAndLayers)
      // Safety net: retry after a short delay in case style loaded between the try and listener
      setTimeout(() => {
        if (!sourcesAddedRef.current) {
          try { addSourcesAndLayers() } catch { /* ignore */ }
        }
      }, 100)
    }

    return () => {
      if (flashCallbackRef.current) unregisterFlashCallback(flashCallbackRef.current)
      map.off('style.load', addSourcesAndLayers)
      if (map && sourcesAddedRef.current) {
        try {
          if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
          for (const iconId of Object.values(ICON_IDS)) {
            if (map.hasImage(iconId)) map.removeImage(iconId)
          }
        } catch { /* ignore */ }
        sourcesAddedRef.current = false
      }
    }
  }, [map])

  // ── Flash highlight effect ────────────────────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return

    const FLASH_LAYER_ID = 'intel-flash'
    const FLASH_SOURCE_ID = 'intel-flash-source'

    // Clean up any existing flash
    try {
      if (map.getLayer(FLASH_LAYER_ID)) map.removeLayer(FLASH_LAYER_ID)
      if (map.getSource(FLASH_SOURCE_ID)) map.removeSource(FLASH_SOURCE_ID)
    } catch { /* ignore */ }

    if (!flashingId || geojson.features.length === 0) return

    const feature = geojson.features.find(f => f.properties.id === flashingId)
    if (!feature) return

    // Add flash source with single feature
    map.addSource(FLASH_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [feature] }
    })

    // Get tier color for flash
    const tier = feature.properties.tier as IntelTier
    const color = TIER_COLORS[tier] ?? '#3b82f6'

    // Add a large glowing circle
    map.addLayer({
      id: FLASH_LAYER_ID,
      type: 'circle',
      source: FLASH_SOURCE_ID,
      paint: {
        'circle-radius': 25,
        'circle-color': color,
        'circle-opacity': 0.4,
        'circle-blur': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': color,
        'circle-stroke-opacity': 0.8
      }
    })

    // Remove after 3 seconds
    const timeout = setTimeout(() => {
      try {
        if (map.getLayer(FLASH_LAYER_ID)) map.removeLayer(FLASH_LAYER_ID)
        if (map.getSource(FLASH_SOURCE_ID)) map.removeSource(FLASH_SOURCE_ID)
      } catch { /* ignore */ }
    }, 3000)

    return () => {
      clearTimeout(timeout)
      try {
        if (map.getLayer(FLASH_LAYER_ID)) map.removeLayer(FLASH_LAYER_ID)
        if (map.getSource(FLASH_SOURCE_ID)) map.removeSource(FLASH_SOURCE_ID)
      } catch { /* ignore */ }
    }
  }, [flashingId, map, geojson])

  // ── Toggle visibility ────────────────────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return
    const vis = visible ? 'visible' : 'none'
    if (map.getLayer(LAYER_ID)) {
      map.setLayoutProperty(LAYER_ID, 'visibility', vis)
    }
    console.log(`[IntelLayer] Visibility: ${vis}`)
  }, [map, visible])

  // ── Update GeoJSON data ──────────────────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return
    if (geojson.features.length === 0) return

    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    if (!source) return

    console.log(`[IntelLayer] setData: ${geojson.features.length} features`)
    source.setData(geojson)
  }, [geojson, map])

  return <></>
}

// ─── Popup HTML ──────────────────────────────────────────────

const TIER_LABELS: Record<string, string> = {
  ALERT: '<span style="color:#ef4444;font-weight:bold;">⚠ ALERT</span>',
  WATCH: '<span style="color:#f59e0b;font-weight:bold;">◉ WATCH</span>',
  CONTEXT: '<span style="color:#3b82f6;">◆ CONTEXT</span>'
}

export function buildPopupHtml(p: IntelProperties, coords?: { lng: number; lat: number }): string {
  const tierBadge = TIER_LABELS[p.tier] ?? p.tier
  const conf = Math.round(p.confidence * 100)
  const time = new Date(p.created_at).toLocaleString()
  const region = p.region || 'Unknown'

  // Brief button data
  const briefData = encodeURIComponent(JSON.stringify({
    title: p.title,
    tier: p.tier,
    lat: coords?.lat ?? 0,
    lon: coords?.lng ?? 0
  }))

  return `
    <div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;padding:8px;font-size:13px;line-height:1.5;">
      <div style="font-size:14px;font-weight:700;margin-bottom:2px;">📍 ${p.title}</div>
      <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px;">${region} · ${time}</div>
      ${tierBadge}
      ${p.summary ? `<p style="font-size:11px;color:#bbb;margin-top:4px;">${p.summary.slice(0, 200)}${p.summary.length > 200 ? '…' : ''}</p>` : ''}
      <div style="font-size:10px;color:#9e9e9e;margin-top:4px;">Confidence: ${conf}%</div>
      <div style="margin-top:8px;border-top:1px solid #333;padding-top:6px">
        <button class="intel-brief-btn" data-type="intel" data-brief="${briefData}"
                style="background:#2563eb;color:white;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;width:100%">
          🔍 Generate Brief
        </button>
      </div>
    </div>
  `
}
