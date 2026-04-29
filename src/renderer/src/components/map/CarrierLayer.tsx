/**
 * CarrierLayer – Renders Carrier Strike Group markers on the map.
 *
 * Features:
 *   - Amber/gold hexagonal markers for deployed groups
 *   - Gray markers for in-port groups
 *   - Dashed circle showing ~200nm patrol radius
 *   - Carrier name labels at zoom 4+
 *   - Click popup with full group details
 *   - "Stale" indicator when data is old
 *
 * CSG markers render on top of ships but below intel items.
 * Not subject to viewport filtering — always visible.
 */

import { useEffect, useRef, useState } from 'react'
import type { Map as MapboxMap, GeoJSONSource } from 'maplibre-gl'
import type { CarrierGroupWithVessels } from '../../../../shared/types'

// ── Layer / source IDs ──────────────────────────────────────

export const CARRIER_SOURCE_ID = 'carrier-groups'
export const CARRIER_MARKER_LAYER_ID = 'csg-markers'
const LABEL_LAYER_ID = 'csg-labels'
const PATROL_LAYER_ID = 'csg-patrol-radius'
const SOURCE_ID = CARRIER_SOURCE_ID
const MARKER_LAYER_ID = CARRIER_MARKER_LAYER_ID
const ALL_LAYER_IDS = [PATROL_LAYER_ID, MARKER_LAYER_ID, LABEL_LAYER_ID]
const ICON_ID = 'carrier-hex'

// ── Types ────────────────────────────────────────────────────

export interface CsgProperties {
  id: string
  name: string
  designation: string | null
  flagship: string | null
  status: string
  operating_area: string | null
  source: string
  last_updated: string | null
  vessel_count: number
  vessel_types: string[]
}

interface CsgFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: CsgProperties
}

interface CsgFeatureCollection {
  type: 'FeatureCollection'
  features: CsgFeature[]
}

// ── Hexagon icon generator ───────────────────────────────────

/**
 * Create a hexagonal carrier icon (24x24 pixels).
 * Gold/amber for deployed, will be swapped per-feature using data-driven styling.
 */
function createCarrierIcon(color: string, size: number = 24): ImageData {
  const canvas = document.createElement('canvas')
  const w = size + 4 // padding for stroke
  const h = size + 4
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const cx = w / 2
  const cy = h / 2
  const r = size / 2

  // Draw hexagon (flat-top orientation, like a flight deck)
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6 // start at 30° for flat top
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Draw cross (flight deck markings)
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.3, cy)
  ctx.lineTo(cx + r * 0.3, cy)
  ctx.moveTo(cx, cy - r * 0.3)
  ctx.lineTo(cx, cy + r * 0.3)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 2
  ctx.stroke()

  return ctx.getImageData(0, 0, w, h)
}

// ── Generation counter ───────────────────────────────────────

let _generation = 0

// ── Props ────────────────────────────────────────────────────

interface CarrierLayerProps {
  map: MapboxMap | null
  visible?: boolean
}

// ── Component ────────────────────────────────────────────────

export default function CarrierLayer({
  map,
  visible = true
}: CarrierLayerProps): React.JSX.Element {
  const [groups, setGroups] = useState<CarrierGroupWithVessels[]>([])
  const sourcesAddedRef = useRef(false)
  const myGeneration = useRef(++_generation)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load carrier group data ──────────────────────────────

  useEffect(() => {
    const loadGroups = (): void => {
      const apiCarrier = (window as any).api?.carrier
      if (apiCarrier) {
        // Electron context — use preload bridge
        apiCarrier
          .getGroups()
          .then((data) => {
            setGroups(data as CarrierGroupWithVessels[])
          })
          .catch((err) => {
            console.error('[CarrierLayer] Failed to load groups:', err)
          })
      } else {
        // Browser context — use HTTP API
        fetch(`${window.location.origin}/api/carrier/groups`)
          .then((res) => res.json())
          .then((data) => {
            setGroups(data as CarrierGroupWithVessels[])
          })
          .catch((err) => {
            console.error('[CarrierLayer] Failed to load groups:', err)
          })
      }
    }

    loadGroups()

    // Refresh every 30 minutes
    if (!refreshTimerRef.current) {
      refreshTimerRef.current = setInterval(loadGroups, 30 * 60 * 1000)
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [])

  // ── Convert groups to GeoJSON ────────────────────────────

  const geojson: CsgFeatureCollection = {
    type: 'FeatureCollection',
    features: (() => {
      const features = groups
        .filter(g => g.latitude != null && g.longitude != null)
        .map(g => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [g.longitude!, g.latitude!] as [number, number]
          },
          properties: {
            id: g.id,
            name: g.name,
            designation: g.designation,
            flagship: g.flagship,
            status: g.status,
            operating_area: g.operating_area,
            source: g.source,
            last_updated: g.last_updated,
            vessel_count: g.vessels.length,
            vessel_types: g.vessels
              .map(v => v.hull_number ?? v.vessel_name)
              .filter(Boolean) as string[]
          }
        }))

      return features
    })()
  }

  // ── Add sources + layers ─────────────────────────────────

  useEffect(() => {
    if (!map) return

    const addSourcesAndLayers = (): void => {
      if (map.getSource(SOURCE_ID)) {
        console.log('[CarrierLayer] Source already exists, skipping')
        return
      }

      console.log('[CarrierLayer] Adding sources + layers')

      sourcesAddedRef.current = true

      // Add icons for each status
      map.addImage(ICON_ID, createCarrierIcon('#FFB800'))

      // Add GeoJSON source
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geojson
      })

      // ── Patrol radius circles (dashed, ~200nm ≈ 370km) ──
      // 370km at equator ≈ ~3.33 degrees latitude
      // Use circle layer with large radius
      map.addLayer({
        id: PATROL_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 8,
            3, 20,
            6, 50,
            10, 150
          ] as unknown as number,
          'circle-color': [
            'match',
            ['get', 'status'],
            'deployed', 'rgba(255, 184, 0, 0.12)',
            'transiting', 'rgba(255, 184, 0, 0.08)',
            'rgba(100, 100, 100, 0.06)'
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'match',
            ['get', 'status'],
            'deployed', 'rgba(255, 184, 0, 0.4)',
            'transiting', 'rgba(255, 184, 0, 0.25)',
            'rgba(100, 100, 100, 0.2)'
          ]
        }
      })

      // ── Carrier markers (hexagons) ──
      map.addLayer({
        id: MARKER_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'icon-image': ICON_ID,
          'icon-size': [
            'match',
            ['get', 'status'],
            'deployed', 1.2,
            'transiting', 1.0,
            0.8
          ],
          'icon-allow-overlap': true,
          'icon-anchor': 'center',
          'icon-ignore-placement': false
        },
        paint: {
          'icon-opacity': [
            'match',
            ['get', 'status'],
            'in-port', 0.5,
            1.0
          ]
        }
      })

      // ── Labels (visible at zoom 4+) ──
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: 3,
        layout: {
          'text-field': [
            'coalesce',
            ['get', 'flagship'],
            ['get', 'name']
          ],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 12,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': [
            'match',
            ['get', 'status'],
            'deployed', '#FFB800',
            'transiting', '#FFB800',
            '#888888'
          ],
          'text-halo-color': '#000000',
          'text-halo-width': 2
        }
      })

      // ── Cursor pointer ──
      map.on('mouseenter', MARKER_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', MARKER_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })

      // ── Initial visibility ──
      const vis = visible ? 'visible' : 'none'
      for (const layerId of ALL_LAYER_IDS) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', vis)
        }
      }
    }

    addSourcesAndLayers()

    return () => {
      if (myGeneration.current !== _generation) return
      if (!map || !sourcesAddedRef.current) return
      try {
        for (const layerId of ALL_LAYER_IDS) {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
        if (map.hasImage(ICON_ID)) map.removeImage(ICON_ID)
      } catch { /* ignore */ }
      sourcesAddedRef.current = false
    }
  }, [map])

  // ── Toggle visibility ──

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return
    const vis = visible ? 'visible' : 'none'
    for (const layerId of ALL_LAYER_IDS) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', vis)
      }
    }
  }, [map, visible])

  // ── Update source data ──

  useEffect(() => {
    if (!map || !sourcesAddedRef.current) return
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    if (source && geojson.features.length > 0) {
      source.setData(geojson)
    }

    // ── Phase 4G: Task force overlay lines ──
    // Draw connecting lines between carrier group vessels with AIS positions
    updateTaskForceOverlays(map, groups)
  }, [geojson, map, groups])

  return <></>
}

// ── Phase 4G: Task force overlay lines ──────────────────────

const TASKFORCE_PREFIX = 'taskforce-line-'

/**
 * Draw connecting lines between vessels in a carrier strike group
 * that have AIS-reported positions. Creates a star topology:
 * carrier → each escort vessel, showing the task force formation.
 */
function updateTaskForceOverlays(
  map: MapboxMap,
  groups: CarrierGroupWithVessels[]
): void {
  // Remove old task force lines
  const existingLayers = map.getStyle()?.layers ?? []
  for (const layer of existingLayers) {
    if (layer.id.startsWith(TASKFORCE_PREFIX)) {
      try {
        map.removeLayer(layer.id)
        map.removeSource(layer.id)
      } catch { /* ignore */ }
    }
  }

  // Draw lines for each group that has positioned vessels
  for (const group of groups) {
    // Only for deployed/transiting groups with a known position
    if (group.latitude == null || group.longitude == null) continue
    if (group.status === 'in-port') continue

    // Find vessels with AIS positions
    const positionedVessels = group.vessels.filter(
      v => v.latitude != null && v.longitude != null
    )
    if (positionedVessels.length < 1) continue

    const carrierCoord: [number, number] = [group.longitude, group.latitude]

    // Draw lines from carrier to each escort with AIS position
    for (let i = 0; i < positionedVessels.length; i++) {
      const vessel = positionedVessels[i]
      const vesselCoord: [number, number] = [vessel.longitude!, vessel.latitude!]
      const lineId = `${TASKFORCE_PREFIX}${group.id}-${i}`

      try {
        map.addSource(lineId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [carrierCoord, vesselCoord]
            },
            properties: {}
          }
        })
        map.addLayer({
          id: lineId,
          type: 'line',
          source: lineId,
          paint: {
            'line-color': '#FFB800',
            'line-width': 1.5,
            'line-dasharray': [3, 3],
            'line-opacity': 0.5
          }
        })
      } catch { /* ignore */ }
    }
  }
}

// ── Popup HTML builder ───────────────────────────────────────

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'Unknown'
  try {
    const date = new Date(ts)
    const now = new Date()
    const ageHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (ageHours < 1) return `${Math.round(ageHours * 60)}m ago`
    if (ageHours < 24) return `${Math.round(ageHours)}h ago`
    return `${Math.round(ageHours / 24)}d ago`
  } catch {
    return ts
  }
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'deployed':
      return '<span style="background:#2e7d32;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:bold;">DEPLOYED</span>'
    case 'transiting':
      return '<span style="background:#e65100;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:bold;">TRANSITING</span>'
    case 'in-port':
      return '<span style="background:#616161;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:bold;">IN-PORT</span>'
    default:
      return '<span style="background:#424242;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:bold;">UNKNOWN</span>'
  }
}

function getSourceBadge(source: string): string {
  switch (source) {
    case 'ais':
      return '<span style="background:#0277bd;color:#fff;padding:1px 4px;border-radius:2px;font-size:9px;">AIS</span>'
    case 'both':
      return '<span style="background:#00695c;color:#fff;padding:1px 4px;border-radius:2px;font-size:9px;">USNI+AIS</span>'
    default:
      return '<span style="background:#4e342e;color:#fff;padding:1px 4px;border-radius:2px;font-size:9px;">USNI</span>'
  }
}

function isStale(lastUpdated: string | null): boolean {
  if (!lastUpdated) return true
  const ageHours = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60)
  return ageHours > 48 // Stale after 48 hours
}

export function buildMultiGroupPopupHtml(
  groups: Array<{ props: CsgProperties; group?: CarrierGroupWithVessels }>
): string {
  const sections = groups
    .map(({ props, group }, i) => {
      const bgColor = i % 2 === 0 ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.05)'
      return `
      <div style="background:${bgColor}; padding:8px; border-radius:6px; margin-bottom:4px; border-left:3px solid #f59e0b">
        <div style="font-weight:bold; color:#fbbf24; font-size:13px">${props.name}</div>
        ${props.designation ? `<div style="font-size:11px; color:#a1a1aa">${props.designation}</div>` : ''}
        <div style="font-size:11px; color:#a1a1aa">${props.status} · ${props.vessel_count} vessels</div>
        ${props.operating_area ? `<div style="font-size:11px; color:#71717a">📍 ${props.operating_area}</div>` : ''}
        ${group?.vessels?.length ? `
          <div style="font-size:10px; color:#71717a; margin-top:4px">
            ${group.vessels.slice(0, 5).map(v => v.vessel_name || v.hull_number).filter(Boolean).join(', ')}${group.vessels.length > 5 ? ` +${group.vessels.length - 5} more` : ''}
          </div>
        ` : ''}
      </div>
    `
    })
    .join('')

  return `
    <div style="font-family:system-ui; color:#e4e4e7; min-width:250px">
      <div style="font-size:10px; color:#71717a; margin-bottom:6px">${groups.length} GROUPS AT THIS LOCATION</div>
      ${sections}
    </div>
  `
}

export function buildPopupHtml(
  props: CsgProperties,
  group?: CarrierGroupWithVessels,
  coords?: { lng: number; lat: number }
): string {
  const name = props.name || 'Unknown Group'
  const designation = props.designation || ''
  const flagship = props.flagship || 'Unknown'
  const area = props.operating_area || 'Unknown'
  const stale = isStale(props.last_updated)
  const staleWarning = stale
    ? '<div style="color:#ff9800;font-size:10px;margin-top:4px;">⚠ Position may be stale (no recent update)</div>'
    : ''

  // Vessel list
  let vesselRows = ''
  if (group && group.vessels.length > 0) {
    const rows = group.vessels.map(v => {
      const type = v.vessel_type || '??'
      const hull = v.hull_number || ''
      const vName = v.vessel_name || hull || 'Unknown'
      const hasAis = v.latitude != null
      const aisBadge = hasAis
        ? '<span style="color:#4caf50;font-size:9px;">●</span>'
        : '<span style="color:#666;font-size:9px;">○</span>'
      return `<tr>
        <td style="color:#bbb;font-size:11px;">${aisBadge} ${vName}</td>
        <td style="text-align:right;color:#888;font-size:11px;">${type} ${hull}</td>
      </tr>`
    }).join('')
    vesselRows = `
      <table style="width:100%;border-collapse:collapse;margin-top:6px;">
        <thead><tr>
          <td style="color:#666;font-size:10px;border-bottom:1px solid #333;">Vessel</td>
          <td style="text-align:right;color:#666;font-size:10px;border-bottom:1px solid #333;">Type</td>
        </tr></thead>
        ${rows}
      </table>
    `
  } else if (props.vessel_types) {
    const types = Array.isArray(props.vessel_types) ? props.vessel_types : JSON.parse(props.vessel_types as unknown as string)
    const typeList = types.join(', ')
    vesselRows = `<div style="font-size:10px;color:#888;margin-top:4px;">${typeList}</div>`
  }

  // Brief button data
  const briefData = encodeURIComponent(JSON.stringify({
    name: props.name,
    flagship: props.flagship,
    lat: coords?.lat ?? 0,
    lon: coords?.lng ?? 0,
    escortCount: props.vessel_count,
    status: props.status
  }))

  return `
    <div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;padding:10px;font-size:13px;line-height:1.5;min-width:220px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:15px;font-weight:700;color:#FFB800;">⚓ ${name}</div>
        ${getStatusBadge(props.status)}
      </div>
      ${designation ? `<div style="font-size:11px;color:#9e9e9e;">${designation}</div>` : ''}
      <div style="margin-top:6px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tr><td style="color:#9e9e9e;">Flagship</td><td style="text-align:right;">${flagship}</td></tr>
          <tr><td style="color:#9e9e9e;">Operating Area</td><td style="text-align:right;">${area}</td></tr>
          <tr>
            <td style="color:#9e9e9e;">Updated</td>
            <td style="text-align:right;">${formatTimestamp(props.last_updated)} ${getSourceBadge(props.source)}</td>
          </tr>
          <tr><td style="color:#9e9e9e;">Vessels</td><td style="text-align:right;">${props.vessel_count}</td></tr>
        </table>
      </div>
      ${staleWarning}
      ${vesselRows}
      <div style="margin-top:8px;border-top:1px solid #333;padding-top:6px">
        <button class="brief-btn" data-type="csg" data-brief="${briefData}"
                style="background:#2563eb;color:white;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;width:100%">
          🔍 Generate Brief
        </button>
      </div>
    </div>
  `
}
