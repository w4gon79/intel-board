/**
 * GfwLayer – Renders GFW (Global Fishing Watch) vessel presence data on the map.
 *
 * Shows two types of data:
 *   1. Presence data (public-global-presence) – colored circles sized by vessel count
 *   2. SAR dark vessel data (public-global-sar-presence) – red diamond markers
 *
 * Data is supplemental (~96h lag), not real-time. Labels clearly indicate this.
 */

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'

// ─── Layer / source IDs ──────────────────────────────────────

const PRESENCE_SOURCE_ID = 'gfw-presence-geojson'
const SAR_SOURCE_ID = 'gfw-sar-geojson'
const PRESENCE_LAYER_ID = 'gfw-presence-circles'
const PRESENCE_LABEL_LAYER_ID = 'gfw-presence-labels'
const SAR_LAYER_ID = 'gfw-sar-diamonds'
const SAR_LABEL_LAYER_ID = 'gfw-sar-labels'

const ALL_LAYER_IDS = [PRESENCE_LAYER_ID, PRESENCE_LABEL_LAYER_ID, SAR_LAYER_ID, SAR_LABEL_LAYER_ID]
const ALL_SOURCE_IDS = [PRESENCE_SOURCE_ID, SAR_SOURCE_ID]

// ─── Types ───────────────────────────────────────────────────

interface GfwProperties {
  id: string
  chokepoint: string
  dataset: string
  hours: number | null
  vessel_count: number | null
  flags: string | null
  vessel_names: string | null
  gear_types: string | null
}

interface GfwFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: GfwProperties
}

interface GfwFeatureCollection {
  type: 'FeatureCollection'
  features: GfwFeature[]
}

const EMPTY_FC: GfwFeatureCollection = { type: 'FeatureCollection', features: [] }

// ─── Props ───────────────────────────────────────────────────

interface GfwLayerProps {
  map: mapboxgl.Map | null
  visible?: boolean
  showSar?: boolean
}

// ─── Component ───────────────────────────────────────────────

export default function GfwLayer({
  map,
  visible = true,
  showSar = true
}: GfwLayerProps): React.JSX.Element {
  const [data, setData] = useState<GfwFeatureCollection>(EMPTY_FC)
  const popupRef = useRef<mapboxgl.Popup | null>(null)
  const sourcesAddedRef = useRef(false)

  // ── Fetch GFW data via IPC (Electron) or HTTP (browser) ──────

  useEffect(() => {
    async function fetchData(): Promise<void> {
      try {
        let result: any[]

        if ((window as any).api?.gfw) {
          // Electron context — use preload bridge
          result = await (window as any).api.gfw.getPresence()
        } else {
          // Browser context — use HTTP API
          const response = await fetch(`${window.location.origin}/api/gfw/presence`)
          if (!response.ok) return
          const data = await response.json()
          // API returns flat array of presence rows
          result = Array.isArray(data) ? data : []
        }

        if (result && Array.isArray(result)) {
          const fc: GfwFeatureCollection = {
            type: 'FeatureCollection',
            features: result.map((row: Record<string, unknown>) => ({
              type: 'Feature' as const,
              geometry: {
                type: 'Point' as const,
                coordinates: [row.lon as number, row.lat as number] as [number, number]
              },
              properties: {
                id: row.id as string,
                chokepoint: row.chokepoint as string,
                dataset: row.dataset as string,
                hours: row.hours as number | null,
                vessel_count: row.vessel_count as number | null,
                flags: row.flags as string | null,
                vessel_names: row.vessel_names as string | null,
                gear_types: row.gear_types as string | null
              }
            }))
          }
          console.log(`[GfwLayer] Loaded ${fc.features.length} GFW data points`)
          setData(fc)
        }
      } catch (err) {
        console.error('[GfwLayer] Failed to fetch GFW data:', err)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60_000) // Refresh every 60s
    return () => clearInterval(interval)
  }, [])

  // ── Add GeoJSON source + layers ──────────────────────────

  useEffect(() => {
    if (!map) return

    if (map.getSource(PRESENCE_SOURCE_ID)) {
      console.log('[GfwLayer] Sources already exist, skipping')
      return
    }

    console.log('[GfwLayer] Adding sources + layers')
    sourcesAddedRef.current = true

    const presenceFeatures = data.features.filter((f) => f.properties.dataset === 'presence')
    const sarFeatures = data.features.filter((f) => f.properties.dataset === 'sar')

    // ── Presence source (regular AIS + satellite AIS) ──
    map.addSource(PRESENCE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: presenceFeatures },
      cluster: false
    })

    // Presence circles: size by vessel count, opacity by hours
    map.addLayer({
      id: PRESENCE_LAYER_ID,
      type: 'circle',
      source: PRESENCE_SOURCE_ID,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['coalesce', ['to-number', ['get', 'vessel_count']], 1],
          0, 4,
          5, 8,
          10, 12,
          20, 16,
          50, 22
        ],
        'circle-color': [
          'coalesce',
          ['get', 'dominant_flag_color'],
          '#4a9eff' // Default blue
        ],
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['coalesce', ['to-number', ['get', 'hours']], 0],
          0, 0.3,
          24, 0.5,
          100, 0.7,
          500, 0.85
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.4
      }
    })

    // Presence labels (zoom 4+)
    map.addLayer({
      id: PRESENCE_LABEL_LAYER_ID,
      type: 'symbol',
      source: PRESENCE_SOURCE_ID,
      minzoom: 4,
      layout: {
        'text-field': [
          'coalesce',
          ['concat', ['to-string', ['get', 'vessel_count']], ' vessels'],
          ''
        ],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 10,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-optional': true,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#a0c4ff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5
      }
    })

    // ── SAR source (dark vessel detections) ──
    map.addSource(SAR_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: sarFeatures },
      cluster: false
    })

    // SAR diamonds: red, distinct from presence circles
    map.addLayer({
      id: SAR_LAYER_ID,
      type: 'symbol',
      source: SAR_SOURCE_ID,
      layout: {
        'icon-image': 'dark-vessel-diamond',
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-anchor': 'center',
        'icon-rotation-alignment': 'map'
      }
    })

    // SAR labels
    map.addLayer({
      id: SAR_LABEL_LAYER_ID,
      type: 'symbol',
      source: SAR_SOURCE_ID,
      minzoom: 3,
      layout: {
        'text-field': '⚠ SAR Detection',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 10,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-optional': true,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#ff4444',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5
      }
    })

    // ── Add custom SAR diamond icon ──
    try {
      const diamondSize = 16
      const canvas = document.createElement('canvas')
      canvas.width = diamondSize + 4
      canvas.height = diamondSize + 4
      const ctx = canvas.getContext('2d')!
      const cx = (diamondSize + 4) / 2
      const cy = (diamondSize + 4) / 2
      const r = diamondSize / 2

      // Diamond shape
      ctx.beginPath()
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy)
      ctx.lineTo(cx, cy + r)
      ctx.lineTo(cx - r, cy)
      ctx.closePath()

      ctx.fillStyle = '#ff2222'
      ctx.fill()
      ctx.strokeStyle = '#ffaa00'
      ctx.lineWidth = 2
      ctx.stroke()

      // Inner dot
      ctx.beginPath()
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      if (!map.hasImage('dark-vessel-diamond')) {
        map.addImage('dark-vessel-diamond', imgData)
      }
    } catch (err) {
      console.warn('[GfwLayer] Failed to create diamond icon:', err)
    }

    // ── Click handlers for popups ──
    for (const layerId of [PRESENCE_LAYER_ID, SAR_LAYER_ID]) {
      map.on('click', layerId, (e) => {
        const features = e.features
        if (!features || features.length === 0) return
        const props = features[0].properties as unknown as GfwProperties
        if (!props) return
        const coords = (features[0].geometry as unknown as { coordinates: [number, number] }).coordinates

        if (popupRef.current) popupRef.current.remove()
        popupRef.current = new mapboxgl.Popup({
          offset: 10,
          closeButton: true,
          maxWidth: '300px'
        })
          .setLngLat(coords)
          .setHTML(buildPopupHtml(props))
          .addTo(map)
      })

      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    // ── Apply initial visibility ──
    const vis = visible ? 'visible' : 'none'
    for (const layerId of [PRESENCE_LAYER_ID, PRESENCE_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
    }
    const sarVis = visible && showSar ? 'visible' : 'none'
    for (const layerId of [SAR_LAYER_ID, SAR_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', sarVis)
    }

    return () => {
      if (!map || !sourcesAddedRef.current) return
      for (const layerId of ALL_LAYER_IDS) {
        try { if (map.getLayer(layerId)) map.removeLayer(layerId) } catch { /* ignore */ }
      }
      for (const sourceId of ALL_SOURCE_IDS) {
        try { if (map.getSource(sourceId)) map.removeSource(sourceId) } catch { /* ignore */ }
      }
      try { if (map.hasImage('dark-vessel-diamond')) map.removeImage('dark-vessel-diamond') } catch { /* ignore */ }
      sourcesAddedRef.current = false
    }
  }, [map])

  // ── Update source data when data changes ─────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return

    const presenceFeatures = data.features.filter((f) => f.properties.dataset === 'presence')
    const sarFeatures = data.features.filter((f) => f.properties.dataset === 'sar')

    const presenceSource = map.getSource(PRESENCE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
    if (presenceSource) {
      presenceSource.setData({ type: 'FeatureCollection', features: presenceFeatures })
    }

    const sarSource = map.getSource(SAR_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
    if (sarSource) {
      sarSource.setData({ type: 'FeatureCollection', features: sarFeatures })
    }
  }, [data, map])

  // ── Toggle visibility ────────────────────────────────────

  useEffect(() => {
    if (!map) return

    const vis = visible ? 'visible' : 'none'
    for (const layerId of [PRESENCE_LAYER_ID, PRESENCE_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
    }

    const sarVis = visible && showSar ? 'visible' : 'none'
    for (const layerId of [SAR_LAYER_ID, SAR_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', sarVis)
    }
  }, [map, visible, showSar])

  return <></>
}

// ─── Popup HTML builder ──────────────────────────────────────

function buildPopupHtml(p: GfwProperties): string {
  const isSar = p.dataset === 'sar'
  const badge = isSar
    ? '<span style="color:#ff2222;font-weight:bold;font-size:11px;">⚠ DARK VESSEL (SAR)</span>'
    : '<span style="color:#4a9eff;font-size:11px;">📡 GFW Presence</span>'

  // flags may be a plain string (new FLAG-grouped format) or a JSON array (legacy)
  let flags = 'Unknown'
  if (p.flags) {
    try {
      const parsed = JSON.parse(p.flags)
      flags = Array.isArray(parsed) ? parsed.join(', ') : String(parsed)
    } catch {
      flags = p.flags
    }
  }
  const vesselCount = p.vessel_count ?? 0
  const hours = p.hours ?? 0
  const vesselNames = p.vessel_names
    ? (JSON.parse(p.vessel_names) as string[]).slice(0, 5).join(', ')
    : 'N/A'
  const gearTypes = p.gear_types
    ? (JSON.parse(p.gear_types) as string[]).join(', ')
    : 'N/A'

  return `
    <div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;padding:8px;font-size:13px;line-height:1.5;">
      <div style="font-size:14px;font-weight:700;margin-bottom:2px;">${p.chokepoint}</div>
      ${badge}
      <div style="font-size:10px;color:#888;margin-top:2px;">⚠ Supplemental data (~96h lag)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">
        <tr><td style="color:#9e9e9e;">Vessels</td><td style="text-align:right;">${vesselCount}</td></tr>
        <tr><td style="color:#9e9e9e;">Total Hours</td><td style="text-align:right;">${hours.toFixed(1)}</td></tr>
        <tr><td style="color:#9e9e9e;">Flag States</td><td style="text-align:right;">${flags}</td></tr>
        <tr><td style="color:#9e9e9e;">Gear Types</td><td style="text-align:right;">${gearTypes}</td></tr>
        <tr><td style="color:#9e9e9e;">Vessels</td><td style="text-align:right;font-size:11px;">${vesselNames}</td></tr>
      </table>
    </div>
  `
}