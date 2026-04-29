/**
 * FlightLayer – renders live ADS-B aircraft on the map using GeoJSON + Mapbox GL layers.
 *
 * Architecture:
 *   - Two GeoJSON sources:
 *     1. Main source (non-military, optionally clustered)
 *     2. Military source (never clustered – always individual points)
 *   - Military aircraft are ALWAYS visible at every zoom level
 *   - Clustering toggle controls the main (non-military) source only
 *   - Circle layer with data-driven styling (color by altitude)
 *
 * Layer IDs:
 *   adsb-clusters         – clustered circles at low zoom (non-military)
 *   adsb-cluster-count    – cluster count label
 *   adsb-unclustered      – individual non-military aircraft points
 *   adsb-military-points  – individual military aircraft (always visible)
 */

import { useEffect, useRef, useState } from 'react'
import type { Map as MapboxMap, GeoJSONSource } from 'maplibre-gl'
import type { FlightMarker } from '../../../../shared/types'
import { useGeojsonWorker } from '../../hooks/useGeojsonWorker'

// ─── Layer / source IDs ──────────────────────────────────────

const MAIN_SOURCE_ID = 'adsb-flights'
const MILITARY_SOURCE_ID = 'adsb-military'

const CLUSTER_LAYER_ID = 'adsb-clusters'
const CLUSTER_COUNT_LAYER_ID = 'adsb-cluster-count'
export const FLIGHT_UNCLUSTERED_LAYER_ID = 'adsb-unclustered'
const UNCLUSTERED_LAYER_ID = FLIGHT_UNCLUSTERED_LAYER_ID
export const FLIGHT_MILITARY_LAYER_ID = 'adsb-military-points'
const MILITARY_LAYER_ID = FLIGHT_MILITARY_LAYER_ID
const MILITARY_LABEL_LAYER_ID = 'adsb-military-labels'
const HVA_PULSE_LAYER_ID = 'adsb-hva-pulse'

const MAIN_LAYER_IDS = [CLUSTER_LAYER_ID, CLUSTER_COUNT_LAYER_ID, UNCLUSTERED_LAYER_ID]
const ALL_LAYER_IDS = [...MAIN_LAYER_IDS, HVA_PULSE_LAYER_ID, MILITARY_LAYER_ID, MILITARY_LABEL_LAYER_ID]

// ─── Generation counter (prevents stale cleanup after key-change remount) ──
let _generation = 0

// ─── Types ───────────────────────────────────────────────────

export interface FlightProperties {
  id: string
  icao24: string
  callsign: string | null
  origin_country: string
  altitude: number | null
  velocity: number | null
  heading: number | null
  is_military: number
  aircraft_type: string | null
  aircraft_type_short: string | null
  military_category: string | null
  timestamp: string | null
}

interface FlightFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: FlightProperties
}

interface FlightFeatureCollection {
  type: 'FeatureCollection'
  features: FlightFeature[]
}

const EMPTY_FC: FlightFeatureCollection = { type: 'FeatureCollection', features: [] }

// ─── Props ───────────────────────────────────────────────────

interface FlightLayerProps {
  map: MapboxMap | null
  visible?: boolean
  showAll?: boolean
  clustering?: boolean
  onFlightSelect?: (flight: FlightMarker) => void
}

// ─── Component ───────────────────────────────────────────────

export default function FlightLayer({
  map,
  visible = true,
  showAll = true,
  clustering = true,
  onFlightSelect
}: FlightLayerProps): React.JSX.Element {
  const [geojson, setGeojson] = useState<FlightFeatureCollection>(EMPTY_FC)
  const sourcesAddedRef = useRef(false)
  const mountedRef = useRef(true)
  const latestDataRef = useRef<FlightFeatureCollection>(EMPTY_FC)
  const myGeneration = useRef(++_generation)
  const { filterADSB } = useGeojsonWorker()

  // Viewport filtering: debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Push subscription debounce (avoids re-rendering on every update)
  const pushDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const PUSH_DEBOUNCE_MS = 3000 // 3 seconds for flights (less data, less aggressive)
  const lastPushLogRef = useRef(0)

  // ─── Subscribe to GeoJSON updates from main process (Electron or HTTP) ──────

  useEffect(() => {
    const apiAdsb = (window as any).api?.adsb

    if (apiAdsb) {
      // Electron context — use preload bridge + push subscriptions
      apiAdsb
        .getGeoJSON()
        .then((data) => {
          const fc = (data as FlightFeatureCollection) ?? EMPTY_FC
          console.log(`[FlightLayer] Initial GeoJSON: ${fc.features?.length ?? 0} features`)
          latestDataRef.current = fc
          if (map) {
            filterADSB(fc.features, map).then((filtered) => {
              setGeojson({ type: 'FeatureCollection', features: filtered as FlightFeature[] })
            })
          } else {
            setGeojson(fc)
          }
        })
        .catch((err) => {
          console.error('[FlightLayer] getGeoJSON failed:', err)
        })

      const unsubscribe = apiAdsb.onGeoJSONUpdated((data) => {
        const fc = (data as FlightFeatureCollection) ?? EMPTY_FC
        latestDataRef.current = fc

        if (!pushDebounceRef.current) {
          pushDebounceRef.current = setTimeout(() => {
            pushDebounceRef.current = null
            const latest = latestDataRef.current
            const now = Date.now()
            const total = latest.features?.length ?? 0
            if (now - lastPushLogRef.current > 30000) {
              console.log(`[FlightLayer] Data updated: ${total} features`)
              lastPushLogRef.current = now
            }
            if (map) {
              filterADSB(latest.features, map).then((filtered) => {
                setGeojson({ type: 'FeatureCollection', features: filtered as FlightFeature[] })
              })
            } else {
              setGeojson(latest)
            }
          }, PUSH_DEBOUNCE_MS)
        }
      })

      apiAdsb.startPolling().catch(() => { /* ignore */ })

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
          const res = await fetch(`${window.location.origin}/api/adsb/geojson`)
          if (!res.ok) return
          const data = await res.json()
          const fc = (data as FlightFeatureCollection) ?? EMPTY_FC
          latestDataRef.current = fc
          if (map) {
            filterADSB(fc.features, map).then((filtered) => {
              setGeojson({ type: 'FeatureCollection', features: filtered as FlightFeature[] })
            })
          } else {
            setGeojson(fc)
          }
        } catch (err) {
          console.error('[FlightLayer] HTTP fetch failed:', err)
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

  // ─── Add GeoJSON sources + layers once when map is ready ───

  useEffect(() => {
    if (!map || sourcesAddedRef.current) return

    const addSourcesAndLayers = (): void => {
      if (sourcesAddedRef.current) return
      console.log(`[FlightLayer] Adding sources + layers (clustering=${clustering})`)

      // Defensive cleanup: remove any leftover sources/layers from a previous mount
      // (React may mount the new key before the old unmount cleanup runs)
      try {
        for (const layerId of ALL_LAYER_IDS) {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
        }
        for (const sourceId of [MAIN_SOURCE_ID, MILITARY_SOURCE_ID]) {
          if (map.getSource(sourceId)) map.removeSource(sourceId)
        }
      } catch { /* ignore */ }

      sourcesAddedRef.current = true

      const initialData = latestDataRef.current.features.length > 0
        ? latestDataRef.current
        : EMPTY_FC

      // Split initial data into military / non-military
      const militaryFeatures = enrichMilitaryFeatures(
        initialData.features.filter((f) => f.properties.is_military === 1)
      )
      const nonMilitaryFeatures = initialData.features.filter(
        (f) => f.properties.is_military !== 1
      )

      // ── Main source (non-military, optionally clustered) ──
      map.addSource(MAIN_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: nonMilitaryFeatures },
        cluster: clustering,
        clusterRadius: 50,
        clusterMaxZoom: 7
      })

      // ── Cluster circles (only render when clustering is on) ──
      if (clustering) {
        map.addLayer({
          id: CLUSTER_LAYER_ID,
          type: 'circle',
          source: MAIN_SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#4fc3f7',
              10,
              '#ffa726',
              50,
              '#ef5350'
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              12,
              10,
              18,
              50,
              24
            ],
            'circle-opacity': 0.7,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff'
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
            'text-size': 12
          },
          paint: {
            'text-color': '#ffffff'
          }
        })
      }

      // ── Unclustered non-military aircraft ──
      map.addLayer({
        id: UNCLUSTERED_LAYER_ID,
        type: 'circle',
        source: MAIN_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'case',
            ['>=', ['number', ['get', 'altitude'], -1], 35000],
            '#ab47bc',
            ['>=', ['number', ['get', 'altitude'], -1], 20000],
            '#42a5f5',
            ['>=', ['number', ['get', 'altitude'], -1], 10000],
            '#26c6da',
            ['>=', ['number', ['get', 'altitude'], -1], 0],
            '#ffa726',
            '#4fc3f7'
          ],
          'circle-radius': 4,
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#000000'
        }
      })

      // ── Military source (NEVER clustered – always individual points) ──
      map.addSource(MILITARY_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: militaryFeatures },
        cluster: false
      })

      // ── HVA pulse glow (renders below military circles) ──
      map.addLayer({
        id: HVA_PULSE_LAYER_ID,
        type: 'circle',
        source: MILITARY_SOURCE_ID,
        filter: ['==', ['get', 'military_category'], 'hva'],
        paint: {
          'circle-color': '#ff1744',
          'circle-radius': 14,
          'circle-opacity': 0.25,
          'circle-blur': 0.8
        }
      })

      // ── Military aircraft layer – category-colored circles ──
      map.addLayer({
        id: MILITARY_LAYER_ID,
        type: 'circle',
        source: MILITARY_SOURCE_ID,
        paint: {
          'circle-color': [
            'match',
            ['get', 'military_category'],
            'hva', '#ff1744',
            'bomber', '#ff6d00',
            'fighter', '#ef5350',
            'tanker', '#ffd600',
            'recon', '#e040fb',
            'aew', '#e040fb',
            'uav', '#7c4dff',
            'patrol', '#00bcd4',
            'transport', '#66bb6a',
            'helicopter', '#ef5350',
            'trainer', '#90a4ae',
            'adversary_bomber', '#d50000',
            'adversary_tanker', '#ffab00',
            '#ef5350' // default fallback
          ],
          'circle-radius': [
            'match',
            ['get', 'military_category'],
            'hva', 7,
            'bomber', 6,
            'fighter', 5,
            4 // default
          ],
          'circle-opacity': 0.9,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      })

      // ── Military aircraft type labels (visible at zoom 5+) ──
      map.addLayer({
        id: MILITARY_LABEL_LAYER_ID,
        type: 'symbol',
        source: MILITARY_SOURCE_ID,
        minzoom: 5,
        layout: {
          'text-field': ['get', 'aircraft_type_short'],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5
        }
      })

      // ── Click on cluster → zoom into it ──
      if (clustering) {
        map.on('click', CLUSTER_LAYER_ID, (e) => {
          const features = map.queryRenderedFeatures(e.point, {
            layers: [CLUSTER_LAYER_ID]
          })
          if (features.length === 0) return
          // MapLibre uses 'id' for cluster IDs (not 'cluster_id' like Mapbox)
          const clusterId = features[0].id ?? features[0].properties?.cluster_id ?? features[0].properties?.id
          if (clusterId == null) return
          const source = map.getSource(MAIN_SOURCE_ID) as GeoJSONSource
          source.getClusterExpansionZoom(Number(clusterId)).then((zoom) => {
            const coords = (features[0].geometry as unknown as { coordinates: [number, number] })
              .coordinates
            map.easeTo({ center: coords, zoom })
          }).catch(() => { /* ignore */ })
        })
      }

      // ── Cursor pointers ──
      const interactiveLayers = clustering
        ? [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID, MILITARY_LAYER_ID]
        : [UNCLUSTERED_LAYER_ID, MILITARY_LAYER_ID]

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
      for (const layerId of [HVA_PULSE_LAYER_ID, MILITARY_LAYER_ID, MILITARY_LABEL_LAYER_ID]) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', vis)
        }
      }
      if (showAll) {
        for (const layerId of MAIN_LAYER_IDS) {
          if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
        }
      } else {
        for (const layerId of MAIN_LAYER_IDS) {
          if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none')
        }
      }
      console.log(`[FlightLayer] Initial visibility applied: ${vis}, showAll: ${showAll}`)
    }

    // Use try/catch + style.load fallback instead of isStyleLoaded()/on('load').
    // With MapLibre + CARTO tiles, the 'load' event fires early and isStyleLoaded()
    // returns false while tiles are still loading — causing sources/layers to never be added.
    try {
      addSourcesAndLayers()
    } catch {
      map.once('style.load', addSourcesAndLayers)
      setTimeout(() => {
        if (!sourcesAddedRef.current) {
          try { addSourcesAndLayers() } catch { /* ignore */ }
        }
      }, 100)
    }

    return () => {
      mountedRef.current = false
      // Only clean up if no newer generation has mounted (key-change remount)
      if (myGeneration.current === _generation && map && sourcesAddedRef.current) {
        try {
          for (const layerId of ALL_LAYER_IDS) {
            if (map.getLayer(layerId)) map.removeLayer(layerId)
          }
          for (const sourceId of [MAIN_SOURCE_ID, MILITARY_SOURCE_ID]) {
            if (map.getSource(sourceId)) map.removeSource(sourceId)
          }
        } catch {
          // map may already be destroyed
        }
        sourcesAddedRef.current = false
      }
    }
  }, [map, onFlightSelect, clustering])

  // ─── Re-filter on map pan/zoom (debounced) ────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return

    const onMoveEnd = (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const fullFeatures = latestDataRef.current.features
        if (fullFeatures.length === 0) return
        // Offload viewport filtering to web worker
        filterADSB(fullFeatures, map).then((filtered) => {
          setGeojson({ type: 'FeatureCollection', features: filtered as FlightFeature[] })
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
  }, [map, sourcesAddedRef.current, filterADSB])

  // ─── Update data (split military / non-military to separate sources) ──

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return
    if (geojson.features.length === 0) return

    const militaryFeatures = enrichMilitaryFeatures(
      geojson.features.filter((f) => f.properties.is_military === 1)
    )
    const nonMilitaryFeatures = geojson.features.filter(
      (f) => f.properties.is_military !== 1
    )

    // Update main (non-military) source
    const mainSource = map.getSource(MAIN_SOURCE_ID) as GeoJSONSource | undefined
    if (mainSource) {
      mainSource.setData({ type: 'FeatureCollection', features: nonMilitaryFeatures })
    }

    // Update military source
    const milSource = map.getSource(MILITARY_SOURCE_ID) as GeoJSONSource | undefined
    if (milSource) {
      milSource.setData({ type: 'FeatureCollection', features: militaryFeatures })
    }

    const totalInView = nonMilitaryFeatures.length + militaryFeatures.length
    const totalFull = latestDataRef.current.features.length
    if (totalInView !== totalFull) {
      console.log(
        `[FlightLayer] setData: ${nonMilitaryFeatures.length} non-mil, ${militaryFeatures.length} military (viewport ${totalInView}/${totalFull})`
      )
    }

    // ── Phase 4G: Formation overlay lines ──
    // Draw tactical overlay lines for formation events
    updateFormationOverlays(map, militaryFeatures)
  }, [geojson, map])

  // ─── Toggle visibility ────────────────────────────────────

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return

    const vis = visible ? 'visible' : 'none'

    // Military layers: visible when layer is on (regardless of showAll)
    for (const layerId of [HVA_PULSE_LAYER_ID, MILITARY_LAYER_ID, MILITARY_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', vis)
      }
    }

    // Main layers
    if (showAll) {
      // Show all: main layers visible
      for (const layerId of MAIN_LAYER_IDS) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', vis)
        }
      }
    } else {
      // Military only: hide main layers
      for (const layerId of MAIN_LAYER_IDS) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', 'none')
        }
      }
    }

    console.log(
      `[FlightLayer] Visibility: ${vis}, showAll: ${showAll}`
    )
  }, [map, visible, showAll])

  return <></>
}

// ─── Helpers ─────────────────────────────────────────────────

/** Extract a short military designation from a full aircraft type string. */
function getShortType(aircraftType: string | null): string {
  if (!aircraftType) return ''
  // Try to extract military designation pattern (e.g., C-17A, KC-135, F-16, E-4B)
  const match = aircraftType.match(/\b([A-Z]{1,3}-\d+[A-Z]?)\b/i)
  if (match) return match[1].toUpperCase()
  // Fallback: first word if short enough
  const parts = aircraftType.trim().split(/\s+/)
  if (parts.length > 0 && parts[0].length <= 10) return parts[0]
  return aircraftType.substring(0, 8)
}

/** Derive a military category from the aircraft type for color-coded styling. */
function getMilitaryCategory(aircraftType: string | null): string | null {
  if (!aircraftType) return null
  const t = aircraftType.toUpperCase()

  // HVA / Command & Control
  if (t.includes('E-4') || t.includes('E-6') || t.includes('VC-25') || t.includes('E-8')) return 'hva'

  // Bombers
  if (t.includes('B-52') || t.includes('B-1') || t.includes('B-2')) return 'bomber'
  if (t.includes('TU-95') || t.includes('TU-160')) return 'adversary_bomber'

  // Tankers
  if (t.includes('KC-135') || t.includes('KC-46') || t.includes('KC-10')) return 'tanker'
  if (t.includes('IL-78') || t.includes('YY-20')) return 'adversary_tanker'

  // Recon / AEW
  if (t.includes('RC-135') || t.includes('U-2') || t.includes('RQ-4')) return 'recon'
  if (t.includes('E-3') || t.includes('E-2') || t.includes('E-7')) return 'aew'

  // UAV
  if (t.includes('MQ-') || t.includes('RQ-')) return 'uav'

  // Patrol
  if (t.includes('P-8') || t.includes('P-3')) return 'patrol'

  // Fighter
  if (t.match(/[F]-\d/) || t.includes('FIGHTER') || t.includes('TYPHOON') || t.includes('TORNADO')) return 'fighter'

  // Transport
  if (t.includes('C-17') || t.includes('C-5') || t.includes('C-130') || t.includes('A400') || t.includes('C-12') || t.includes('C-32') || t.includes('C-40')) return 'transport'

  // Helicopter
  if (t.includes('UH-') || t.includes('MH-') || t.includes('HH-') || t.includes('CH-') || t.includes('AH-')) return 'helicopter'

  // Trainer
  if (t.includes('T-6') || t.includes('T-38') || t.includes('T-45') || t.includes('T-1')) return 'trainer'

  return null
}

/** Enrich military features with short type label and category for styling. */
function enrichMilitaryFeatures(features: FlightFeature[]): FlightFeature[] {
  return features.map(f => ({
    ...f,
    properties: {
      ...f.properties,
      aircraft_type_short: getShortType(f.properties.aircraft_type),
      military_category: getMilitaryCategory(f.properties.aircraft_type)
    }
  }))
}

function formatAlt(alt: number | null): string {
  if (alt == null) return 'N/A'
  return `${Math.round(alt).toLocaleString()} ft`
}

function formatSpeed(gs: number | null): string {
  if (gs == null) return 'N/A'
  return `${Math.round(gs)} kts`
}

// ─── Phase 4G: Formation overlay lines ──────────────────────

const FORMATION_PREFIX = 'formation-line-'

/**
 * Draw dashed orange connecting lines between nearby military aircraft
 * that share the same type and are within a tactical formation distance.
 * Groups military aircraft by type, then draws lines between those within
 * ~50nm of each other.
 */
function updateFormationOverlays(
  map: MapboxMap,
  militaryFeatures: FlightFeature[]
): void {
  // Remove old formation lines
  const existingLayers = map.getStyle()?.layers ?? []
  for (const layer of existingLayers) {
    if (layer.id.startsWith(FORMATION_PREFIX)) {
      try {
        map.removeLayer(layer.id)
        map.removeSource(layer.id)
      } catch { /* ignore */ }
    }
  }

  if (militaryFeatures.length < 2) return

  // Group by aircraft type category (only for types that fly in formations)
  const formationTypes = new Set(['fighter', 'bomber', 'tanker', 'patrol', 'transport'])
  const groups = new Map<string, FlightFeature[]>()

  for (const f of militaryFeatures) {
    const cat = f.properties.military_category
    if (!cat || !formationTypes.has(cat)) continue
    const key = cat
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  // For each group, cluster by proximity (~50nm ≈ ~0.83 degrees) and draw lines
  for (const [category, features] of groups) {
    if (features.length < 2) continue

    // Simple proximity clustering: for each pair within range, draw a line
    const drawn = new Set<string>()
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const a = features[i]
        const b = features[j]
        const dist = haversineDistance(
          a.geometry.coordinates[1], a.geometry.coordinates[0],
          b.geometry.coordinates[1], b.geometry.coordinates[0]
        )
        if (dist < 50) { // Within 50 nautical miles
          const lineId = `${FORMATION_PREFIX}${category}-${i}-${j}`
          if (drawn.has(lineId)) continue
          drawn.add(lineId)

          try {
            if (map.getSource(lineId)) {
              map.removeLayer(lineId)
              map.removeSource(lineId)
            }
            map.addSource(lineId, {
              type: 'geojson',
              data: {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [a.geometry.coordinates, b.geometry.coordinates]
                },
                properties: {}
              }
            })
            map.addLayer({
              id: lineId,
              type: 'line',
              source: lineId,
              paint: {
                'line-color': '#ff6600',
                'line-width': 1.5,
                'line-dasharray': [2, 2],
                'line-opacity': 0.6
              }
            })
          } catch { /* ignore */ }
        }
      }
    }
  }
}

/** Haversine distance between two lat/lon points in nautical miles. */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065 // Earth radius in nautical miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function buildPopupHtml(f: FlightProperties, coords?: { lng: number; lat: number }): string {
  const callsign = f.callsign?.trim() || f.icao24?.toUpperCase() || 'Unknown'
  const typeLabel = f.aircraft_type || 'Unknown'
  const country = f.origin_country || 'N/A'
  const alt = formatAlt(f.altitude)
  const speed = formatSpeed(f.velocity)
  const hdg = f.heading != null ? `${Math.round(f.heading)}°` : 'N/A'
  const milBadge = f.is_military
    ? '<span style="color:#ef5350;font-weight:bold;font-size:11px;">⚠ MILITARY</span>'
    : ''

  // Brief button data
  const briefData = encodeURIComponent(JSON.stringify({
    callsign: f.callsign,
    type: f.aircraft_type,
    alt: f.altitude,
    heading: f.heading,
    lat: coords?.lat ?? 0,
    lon: coords?.lng ?? 0
  }))

  return `
    <div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;padding:8px;font-size:13px;line-height:1.5;">
      <div style="font-size:15px;font-weight:700;margin-bottom:2px;">${callsign}</div>
      <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px;">ICAO: ${(f.icao24 ?? '').toUpperCase()} · ${typeLabel} · ${country}</div>
      ${milBadge}
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">
        <tr><td style="color:#9e9e9e;">Alt</td><td style="text-align:right;">${alt}</td></tr>
        <tr><td style="color:#9e9e9e;">Speed</td><td style="text-align:right;">${speed}</td></tr>
        <tr><td style="color:#9e9e9e;">Heading</td><td style="text-align:right;">${hdg}</td></tr>
      </table>
      <div style="margin-top:8px;border-top:1px solid #333;padding-top:6px">
        <button class="brief-btn" data-type="aircraft" data-brief="${briefData}"
                style="background:#2563eb;color:white;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;width:100%">
          🔍 Generate Brief
        </button>
      </div>
    </div>
  `
}
