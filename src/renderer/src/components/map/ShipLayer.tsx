/**
 * ShipLayer – Renders AIS vessel positions on the map using GeoJSON + Mapbox GL.
 *
 * Architecture (mirrors FlightLayer):
 *   - Two GeoJSON sources:
 *     1. Main source (non-military, optionally clustered)
 *     2. Military source (never clustered – always individual triangles)
 *   - Military vessels are ALWAYS visible at every zoom level
 *   - Clustering toggle controls the main (non-military) source only
 *   - Triangle markers rotate to show vessel heading
 *
 * Vessel categories & colors:
 *   - Military (35-39):  Cyan-Blue (#00B4D8) — slightly larger marker
 *   - Cargo (70-79):     Cyan (#00d4ff)
 *   - Tanker (80-89):    Amber (#ffaa00)
 *   - Passenger (60-69): White (#ffffff)
 *   - Other:             Gray (#888888)
 */

import { useEffect, useRef, useState } from 'react'
import type { Map as MapboxMap, GeoJSONSource } from 'maplibre-gl'
import type { AisShipCategory } from '../../../../shared/types'
import { useGeojsonWorker } from '../../hooks/useGeojsonWorker'

// ─── Layer / source IDs ──────────────────────────────────────

const MAIN_SOURCE_ID = 'vessels-geojson'
const MILITARY_SOURCE_ID = 'vessels-military'

const CLUSTER_LAYER_ID = 'vessels-clusters'
const CLUSTER_COUNT_LAYER_ID = 'vessels-cluster-count'
const CIV_LAYER_IDS = {
  cargo: 'vessels-cargo',
  tanker: 'vessels-tanker',
  passenger: 'vessels-passenger',
  other: 'vessels-other'
} as const
export const SHIP_MILITARY_LAYER_ID = 'vessels-military'
const MILITARY_LAYER_ID = SHIP_MILITARY_LAYER_ID
const MILITARY_LABEL_LAYER_ID = 'vessels-military-labels'

export const ALL_CIV_LAYER_IDS = Object.values(CIV_LAYER_IDS)
const ALL_LAYER_IDS = [...ALL_CIV_LAYER_IDS, CLUSTER_LAYER_ID, CLUSTER_COUNT_LAYER_ID, MILITARY_LAYER_ID, MILITARY_LABEL_LAYER_ID]

const ICON_IDS = {
  military: 'triangle-military',
  cargo: 'triangle-cargo',
  tanker: 'triangle-tanker',
  passenger: 'triangle-passenger',
  other: 'triangle-other'
} as const

// ─── Types ───────────────────────────────────────────────────

export interface VesselProperties {
  id: string
  mmsi: string
  imo: string | null
  ship_name: string | null
  ship_type: string | null
  ship_type_code: number
  vessel_class: string | null
  vessel_category: string | null
  speed: number | null
  heading: number | null
  destination: string | null
  is_military: boolean
  timestamp: string | null
}

interface VesselFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: VesselProperties
}

interface VesselFeatureCollection {
  type: 'FeatureCollection'
  features: VesselFeature[]
}

const EMPTY_FC: VesselFeatureCollection = { type: 'FeatureCollection', features: [] }

// ─── Triangle icon generator ─────────────────────────────────

/** Create a triangle icon as ImageData for use as a Mapbox icon. */
function createTriangleIcon(
  color: string,
  size: number,
  strokeColor: string = '#000000',
  strokeWidth: number = 1
): ImageData {
  const canvas = document.createElement('canvas')
  const w = size + strokeWidth * 2
  const h = size + strokeWidth * 2
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const cx = w / 2
  const cy = h / 2
  const r = size / 2

  // Triangle pointing UP (north = 0°). Mapbox rotates clockwise.
  ctx.beginPath()
  ctx.moveTo(cx, cy - r) // top point (bow)
  ctx.lineTo(cx - r * 0.7, cy + r * 0.6) // bottom-left
  ctx.lineTo(cx + r * 0.7, cy + r * 0.6) // bottom-right
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = strokeWidth
  ctx.stroke()

  return ctx.getImageData(0, 0, w, h)
}

// ─── Vessel category helper ──────────────────────────────────

/** Derive a naval category from ship type / type code for styling. */
function getVesselCategory(shipType: string | null, shipTypeCode: number): string | null {
  const t = (shipType ?? '').toUpperCase()
  const code = shipTypeCode ?? 0

  // Military type codes (35-39)
  if (code >= 35 && code <= 39) {
    if (t.includes('CARRIER') || t.includes('CVN') || t.includes('CV')) return 'carrier'
    if (t.includes('DESTROYER') || t.includes('DDG') || t.includes('DD')) return 'destroyer'
    if (t.includes('CRUISER') || t.includes('CG')) return 'cruiser'
    if (t.includes('FRIGATE') || t.includes('FFG') || t.includes('FF')) return 'frigate'
    if (t.includes('SUBMARINE') || t.includes('SSN') || t.includes('SSBN') || t.includes('SSK')) return 'submarine'
    if (t.includes('AMPHIBIOUS') || t.includes('LHD') || t.includes('LHA') || t.includes('LPD') || t.includes('LST')) return 'amphibious'
    if (t.includes('MINE') || t.includes('MCM')) return 'mine warfare'
    if (t.includes('PATROL') || t.includes('PC')) return 'patrol'
    return 'naval'
  }

  // Government vessels
  if (code === 30 || t.includes('GOVERNMENT')) return 'government'

  // Coast guard
  if (t.includes('COAST GUARD') || t.includes('COASTGUARD')) return 'coast_guard'

  return null
}

// ─── Generation counter (prevents stale cleanup after key-change remount) ──
let _generation = 0

// ─── Props ───────────────────────────────────────────────────

interface ShipLayerProps {
  map: MapboxMap | null
  visible?: boolean
  category?: AisShipCategory
  showAll?: boolean
  clustering?: boolean
}

// ─── Component ───────────────────────────────────────────────

export default function ShipLayer({
  map,
  visible = true,
  category: _category = 'all',
  showAll = true,
  clustering = true
}: ShipLayerProps): React.JSX.Element {
  const [geojson, setGeojson] = useState<VesselFeatureCollection>(EMPTY_FC)
  const sourcesAddedRef = useRef(false)
  const latestDataRef = useRef<VesselFeatureCollection>(EMPTY_FC)
  const myGeneration = useRef(++_generation)
  const { filterAIS } = useGeojsonWorker()

  // Viewport filtering: debounce + log throttle
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Push subscription debounce (avoids re-rendering on every WebSocket message)
  const pushDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const PUSH_DEBOUNCE_MS = 5000 // 5 seconds for vessels
  const lastPushLogRef = useRef(0)

  // ── Subscribe to GeoJSON updates from main process (Electron or HTTP) ──────

  useEffect(() => {
    const apiAis = (window as any).api?.ais

    if (apiAis) {
      // Electron context — use preload bridge + push subscriptions
      apiAis
        .getGeoJSON()
        .then((data) => {
          const fc = (data as VesselFeatureCollection) ?? EMPTY_FC
          console.log(`[ShipLayer] Initial GeoJSON: ${fc.features?.length ?? 0} features`)
          latestDataRef.current = fc
          if (map) {
            filterAIS(fc.features, map).then((filtered) => {
              setGeojson({ type: 'FeatureCollection', features: filtered as VesselFeature[] })
            })
          } else {
            setGeojson(fc)
          }
        })
        .catch((err) => {
          console.error('[ShipLayer] getGeoJSON failed:', err)
        })

      const unsubscribe = apiAis.onGeoJSONUpdated((data) => {
        const fc = (data as VesselFeatureCollection) ?? EMPTY_FC
        latestDataRef.current = fc

        if (!pushDebounceRef.current) {
          pushDebounceRef.current = setTimeout(() => {
            pushDebounceRef.current = null
            const latest = latestDataRef.current
            const now = Date.now()
            const total = latest.features?.length ?? 0
            if (now - lastPushLogRef.current > 30000) {
              console.log(`[ShipLayer] Data updated: ${total} features`)
              lastPushLogRef.current = now
            }
            if (map) {
              filterAIS(latest.features, map).then((filtered) => {
                setGeojson({ type: 'FeatureCollection', features: filtered as VesselFeature[] })
              })
            } else {
              setGeojson(latest)
            }
          }, PUSH_DEBOUNCE_MS)
        }
      })

      apiAis.startStreaming().catch(() => { /* ignore */ })

      return () => {
        unsubscribe()
        if (pushDebounceRef.current) {
          clearTimeout(pushDebounceRef.current)
          pushDebounceRef.current = null
        }
      }
    } else {
      // Browser context — use HTTP polling
      async function fetchGeoJSON(): Promise<void> {
        try {
          const res = await fetch(`${window.location.origin}/api/ais/geojson`)
          if (!res.ok) return
          const data = await res.json()
          const fc = (data as VesselFeatureCollection) ?? EMPTY_FC
          latestDataRef.current = fc
          if (map) {
            filterAIS(fc.features, map).then((filtered) => {
              setGeojson({ type: 'FeatureCollection', features: filtered as VesselFeature[] })
            })
          } else {
            setGeojson(fc)
          }
        } catch (err) {
          console.error('[ShipLayer] HTTP fetch failed:', err)
        }
      }

      fetchGeoJSON()
      const interval = setInterval(fetchGeoJSON, 15_000) // Poll every 15s

      return () => {
        clearInterval(interval)
        if (pushDebounceRef.current) {
          clearTimeout(pushDebounceRef.current)
          pushDebounceRef.current = null
        }
      }
    }
  }, [map])

  // ── Helper: is military vessel? (uses authoritative property from main process) ──
  // Includes government vessels (ship_type === 'government') which are almost always
  // naval/coast guard vessels that may not have been flagged as is_military by the backend.
  const isMilitary = (f: VesselFeature): boolean =>
    f.properties.is_military === true ||
    f.properties.ship_type === 'government'

  // ── Enrich military vessel features with vessel_category ──
  const enrichMilitaryVessels = (features: VesselFeature[]): VesselFeature[] =>
    features.map(f => ({
      ...f,
      properties: {
        ...f.properties,
        vessel_category: getVesselCategory(f.properties.ship_type, f.properties.ship_type_code)
      }
    }))

  // ── Add GeoJSON source + layers once when map is ready ───

  useEffect(() => {
    if (!map) return

    const addSourcesAndLayers = (): void => {
      // Idempotency: if sources already exist, skip entirely.
      // React 19 Strict Mode double-invokes effects — the second invocation
      // must not try to re-add sources/layers/images that already exist.
      if (map.getSource(MAIN_SOURCE_ID)) {
        console.log('[ShipLayer] Sources already exist, skipping (Strict Mode remount)')
        return
      }

      console.log(`[ShipLayer] Adding sources + layers (clustering=${clustering})`)

      sourcesAddedRef.current = true

      const initialData =
        latestDataRef.current.features.length > 0
          ? latestDataRef.current
          : EMPTY_FC

      // Split initial data
      const militaryFeatures = enrichMilitaryVessels(initialData.features.filter((f) => isMilitary(f)))
      const nonMilitaryFeatures = initialData.features.filter((f) => !isMilitary(f))

      // ── Add triangle icons to map style ──
      // Military: slightly larger (14px vs 12px civilian), white stroke
      map.addImage(ICON_IDS.military, createTriangleIcon('#00B4D8', 14, '#ffffff', 1.5))
      map.addImage(ICON_IDS.cargo, createTriangleIcon('#00d4ff', 12, '#000000', 1))
      map.addImage(ICON_IDS.tanker, createTriangleIcon('#ffaa00', 12, '#000000', 1))
      map.addImage(ICON_IDS.passenger, createTriangleIcon('#ffffff', 12, '#000000', 1))
      map.addImage(ICON_IDS.other, createTriangleIcon('#888888', 10, '#000000', 1))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iconRotate: any = [
        'coalesce',
        ['to-number', ['get', 'heading'], 0],
        0
      ]

      // Type code expression that handles null values (defaults to 0)
      const tc = ['to-number', ['get', 'ship_type_code'], 0] as unknown as number

      // ── Main source (non-military, optionally clustered) ──
      map.addSource(MAIN_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: nonMilitaryFeatures },
        cluster: clustering,
        clusterRadius: 50,
        clusterMaxZoom: 7
      })

      // ── Cluster rings — hollow circles distinct from flight (solid) clusters ──
      if (clustering) {
        map.addLayer({
          id: CLUSTER_LAYER_ID,
          type: 'circle',
          source: MAIN_SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            // Near-transparent fill → "ring" appearance
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#00d4ff',
              10,
              '#ffaa00',
              50,
              '#ff3333'
            ],
            'circle-opacity': 0.15,
            // Thick colored border makes the ring
            'circle-stroke-width': 3,
            'circle-stroke-color': [
              'step',
              ['get', 'point_count'],
              '#00d4ff',
              10,
              '#ffaa00',
              50,
              '#ff3333'
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              12,
              10,
              18,
              50,
              24
            ]
          }
        })

        map.addLayer({
          id: CLUSTER_COUNT_LAYER_ID,
          type: 'symbol',
          source: MAIN_SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 11
          },
          paint: {
            'text-color': '#ffffff'
          }
        })
      }

      // ── Cargo vessels (type codes 40-49, 50-59, 70-79) ──
      map.addLayer({
        id: CIV_LAYER_IDS.cargo,
        type: 'symbol',
        source: MAIN_SOURCE_ID,
        filter: [
          'any',
          ['all', ['>=', tc, 70], ['<=', tc, 79]],
          ['all', ['>=', tc, 40], ['<=', tc, 49]],
          ['all', ['>=', tc, 50], ['<=', tc, 59]]
        ],
        layout: {
          'icon-image': ICON_IDS.cargo,
          'icon-size': 1,
          'icon-rotate': iconRotate,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-anchor': 'center'
        }
      })

      // ── Tanker vessels (type codes 80-89) ──
      map.addLayer({
        id: CIV_LAYER_IDS.tanker,
        type: 'symbol',
        source: MAIN_SOURCE_ID,
        filter: [
          'all',
          ['>=', tc, 80],
          ['<=', tc, 89]
        ],
        layout: {
          'icon-image': ICON_IDS.tanker,
          'icon-size': 1,
          'icon-rotate': iconRotate,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-anchor': 'center'
        }
      })

      // ── Passenger vessels (type codes 60-69) ──
      map.addLayer({
        id: CIV_LAYER_IDS.passenger,
        type: 'symbol',
        source: MAIN_SOURCE_ID,
        filter: [
          'all',
          ['>=', tc, 60],
          ['<=', tc, 69]
        ],
        layout: {
          'icon-image': ICON_IDS.passenger,
          'icon-size': 1,
          'icon-rotate': iconRotate,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-anchor': 'center'
        }
      })

      // ── Other / unknown vessels ──
      map.addLayer({
        id: CIV_LAYER_IDS.other,
        type: 'symbol',
        source: MAIN_SOURCE_ID,
        filter: ['any', ['<', tc, 30], ['==', tc, 0]],
        layout: {
          'icon-image': ICON_IDS.other,
          'icon-size': 1,
          'icon-rotate': iconRotate,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-anchor': 'center'
        }
      })

      // ── Military source (NEVER clustered – always individual triangles) ──
      map.addSource(MILITARY_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: militaryFeatures },
        cluster: false
      })

      // Layer order (bottom to top):
      //   1. [Future] Task force convex hull fill (lowest)
      //   2. [Future] Task force connection lines
      //   3. Civilian vessel layers — added above
      //   4. Military vessel triangles
      //   5. Cluster circles + count labels
      //   6. Military vessel name labels (topmost)

      // ── Military vessels layer – always visible cyan-blue triangles ──
      map.addLayer({
        id: MILITARY_LAYER_ID,
        type: 'symbol',
        source: MILITARY_SOURCE_ID,
        layout: {
          'icon-image': ICON_IDS.military,
          'icon-size': 1,
          'icon-rotate': iconRotate,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-anchor': 'center'
        }
      })

      // ── Military vessel name labels (visible at zoom 5+) ──
      map.addLayer({
        id: MILITARY_LABEL_LAYER_ID,
        type: 'symbol',
        source: MILITARY_SOURCE_ID,
        minzoom: 5,
        layout: {
          'text-field': ['get', 'ship_name'],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#ff3333',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5
        }
      })

      // ── Explicitly hide any leftover cluster layers when clustering is off ──
      if (!clustering) {
        if (map.getLayer(CLUSTER_LAYER_ID)) map.setLayoutProperty(CLUSTER_LAYER_ID, 'visibility', 'none')
        if (map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.setLayoutProperty(CLUSTER_COUNT_LAYER_ID, 'visibility', 'none')
      }

      // ── Click on cluster → zoom into it ──
      if (clustering) {
        map.on('click', CLUSTER_LAYER_ID, (e) => {
          const features = map.queryRenderedFeatures(e.point, {
            layers: [CLUSTER_LAYER_ID]
          })
          if (features.length === 0) return
          const clusterId = features[0].properties?.cluster_id
          if (clusterId == null) return
          const source = map.getSource(MAIN_SOURCE_ID) as GeoJSONSource
          source.getClusterExpansionZoom(clusterId).then((zoom) => {
            const coords = (features[0].geometry as unknown as { coordinates: [number, number] }).coordinates
            map.easeTo({ center: coords, zoom })
          }).catch(() => { /* ignore */ })
        })
      }

      // ── Cursor pointers ──
      const interactiveLayers = clustering
        ? [CLUSTER_LAYER_ID, ...ALL_CIV_LAYER_IDS, MILITARY_LAYER_ID]
        : [...ALL_CIV_LAYER_IDS, MILITARY_LAYER_ID]

      for (const layerId of interactiveLayers) {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = ''
        })
      }

      // ── Apply initial visibility immediately (prevents race with visibility useEffect) ──
      const vis = visible ? 'visible' : 'none'
      for (const layerId of [MILITARY_LAYER_ID, MILITARY_LABEL_LAYER_ID]) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', vis)
        }
      }
      if (showAll) {
        for (const layerId of ALL_CIV_LAYER_IDS) {
          if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
        }
        if (map.getLayer(CLUSTER_LAYER_ID)) map.setLayoutProperty(CLUSTER_LAYER_ID, 'visibility', vis)
        if (map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.setLayoutProperty(CLUSTER_COUNT_LAYER_ID, 'visibility', vis)
      } else {
        for (const layerId of ALL_CIV_LAYER_IDS) {
          if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none')
        }
        if (map.getLayer(CLUSTER_LAYER_ID)) map.setLayoutProperty(CLUSTER_LAYER_ID, 'visibility', 'none')
        if (map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.setLayoutProperty(CLUSTER_COUNT_LAYER_ID, 'visibility', 'none')
      }
      console.log(`[ShipLayer] Initial visibility applied: ${vis}, showAll: ${showAll}`)
    }

    addSourcesAndLayers()

    return () => {
      // Only clean up if no newer instance has mounted (key-change remount)
      if (myGeneration.current !== _generation) return
      if (!map || !sourcesAddedRef.current) return
      for (const layerId of ALL_LAYER_IDS) {
        try { if (map.getLayer(layerId)) map.removeLayer(layerId) } catch { /* ignore */ }
      }
      for (const sourceId of [MAIN_SOURCE_ID, MILITARY_SOURCE_ID]) {
        try { if (map.getSource(sourceId)) map.removeSource(sourceId) } catch { /* ignore */ }
      }
      for (const iconId of Object.values(ICON_IDS)) {
        try { if (map.hasImage(iconId)) map.removeImage(iconId) } catch { /* ignore */ }
      }
      sourcesAddedRef.current = false
    }
  }, [map, clustering])

  // ── Toggle layer visibility + military filter ──────────────

  useEffect(() => {
    if (!map) return

    const vis = visible ? 'visible' : 'none'

    // Military layers always follow main visibility
    for (const layerId of [MILITARY_LAYER_ID, MILITARY_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', vis)
      }
    }

    if (showAll) {
      // Show all civilian layers + cluster layers
      for (const layerId of ALL_CIV_LAYER_IDS) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
      }
      if (map.getLayer(CLUSTER_LAYER_ID)) map.setLayoutProperty(CLUSTER_LAYER_ID, 'visibility', vis)
      if (map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.setLayoutProperty(CLUSTER_COUNT_LAYER_ID, 'visibility', vis)
    } else {
      // Military only: hide all civilian + cluster layers
      for (const layerId of ALL_CIV_LAYER_IDS) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none')
      }
      if (map.getLayer(CLUSTER_LAYER_ID)) map.setLayoutProperty(CLUSTER_LAYER_ID, 'visibility', 'none')
      if (map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.setLayoutProperty(CLUSTER_COUNT_LAYER_ID, 'visibility', 'none')
    }

    console.log(`[ShipLayer] Visibility: ${vis}, showAll: ${showAll}`)
  }, [map, visible, showAll, clustering])

  // ── Re-filter on map pan/zoom (debounced) ──────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return

    const onMoveEnd = (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const fullFeatures = latestDataRef.current.features
        if (fullFeatures.length === 0) return
        // Offload viewport filtering to web worker
        filterAIS(fullFeatures, map).then((filtered) => {
          setGeojson({ type: 'FeatureCollection', features: filtered as VesselFeature[] })
        })
      }, 150)
    }

    map.on('moveend', onMoveEnd)
    map.on('zoomend', onMoveEnd)

    return () => {
      map.off('moveend', onMoveEnd)
      map.off('zoomend', onMoveEnd)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [map, sourcesAddedRef.current, filterAIS])

  // ── Update GeoJSON source data ────────────────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return
    if (geojson.features.length === 0) return

    const militaryFeatures = enrichMilitaryVessels(geojson.features.filter((f) => isMilitary(f)))
    const nonMilitaryFeatures = geojson.features.filter((f) => !isMilitary(f))

    const mainSource = map.getSource(MAIN_SOURCE_ID) as GeoJSONSource | undefined
    if (mainSource) {
      mainSource.setData({ type: 'FeatureCollection', features: nonMilitaryFeatures })
    }

    const milSource = map.getSource(MILITARY_SOURCE_ID) as GeoJSONSource | undefined
    if (milSource) {
      milSource.setData({ type: 'FeatureCollection', features: militaryFeatures })
    }

    const totalInView = nonMilitaryFeatures.length + militaryFeatures.length
    const totalFull = latestDataRef.current.features.length
    if (totalInView !== totalFull) {
      console.log(`[ShipLayer] setData: ${nonMilitaryFeatures.length} non-mil, ${militaryFeatures.length} military (viewport ${totalInView}/${totalFull})`)
    }
  }, [geojson, map])

  return <></>
}

// ─── Popup HTML builder ──────────────────────────────────────

function formatSpeed(speed: number | null): string {
  if (speed == null) return 'N/A'
  return `${speed} kn`
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return 'N/A'
  try {
    return new Date(timestamp).toLocaleTimeString()
  } catch {
    return timestamp
  }
}

export function buildPopupHtml(v: VesselProperties, coords?: { lng: number; lat: number }): string {
  const name = v.ship_name?.trim() || `MMSI ${v.mmsi}`
  const imo = v.imo ? ` · IMO: ${v.imo}` : ''
  const speed = formatSpeed(v.speed)
  const hdg = v.heading != null ? `${v.heading}°` : 'N/A'
  const dest = v.destination || 'Unknown'
  const time = formatTime(v.timestamp)
  const isMil = v.is_military === true
  const milBadge = isMil
    ? '<span style="color:#ff3333;font-weight:bold;font-size:11px;">⚠ NAVAL</span>'
    : ''

  // Vessel identification details (Phase 4B)
  const vesselClass = v.vessel_class?.trim()
  const classLine = vesselClass
    ? `<div style="font-size:12px;color:#00d4ff;margin-top:2px;">⬥ ${vesselClass}</div>`
    : ''

  // Brief button data
  const briefData = encodeURIComponent(JSON.stringify({
    name: v.ship_name,
    mmsi: v.mmsi,
    type: v.vessel_class || v.ship_type,
    lat: coords?.lat ?? 0,
    lon: coords?.lng ?? 0,
    destination: v.destination,
    military: v.is_military
  }))

  return `
    <div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;padding:8px;font-size:13px;line-height:1.5;">
      <div style="font-size:15px;font-weight:700;margin-bottom:2px;">🚢 ${name}</div>
      <div style="font-size:11px;color:#9e9e9e;margin-bottom:2px;">MMSI: ${v.mmsi}${imo} · ${(v.ship_type ?? 'Unknown').toUpperCase()}</div>
      ${classLine}
      ${milBadge}
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">
        <tr><td style="color:#9e9e9e;">Speed</td><td style="text-align:right;">${speed}</td></tr>
        <tr><td style="color:#9e9e9e;">Heading</td><td style="text-align:right;">${hdg}</td></tr>
        <tr><td style="color:#9e9e9e;">Destination</td><td style="text-align:right;">${dest}</td></tr>
        <tr><td style="color:#9e9e9e;">Updated</td><td style="text-align:right;">${time}</td></tr>
      </table>
      <div style="margin-top:8px;border-top:1px solid #333;padding-top:6px">
        <button class="brief-btn" data-type="ship" data-brief="${briefData}"
                style="background:#2563eb;color:white;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;width:100%">
          🔍 Generate Brief
        </button>
      </div>
    </div>
  `
}
