/**
 * UnifiedMapPopup – Single unified click handler for all map layers.
 *
 * Instead of each layer managing its own click handlers and popups independently,
 * this component intercepts all map clicks, queries ALL layers at the click point,
 * and renders a single unified popup.
 *
 * - Single feature: delegates to that layer's buildPopupHtml
 * - Multiple features: shows a tabbed popup with item list + detail panel
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { CarrierGroupWithVessels } from '../../../../shared/types'
import {
  ALL_CIV_LAYER_IDS,
  SHIP_MILITARY_LAYER_ID,
  buildPopupHtml as buildShipPopup,
  type VesselProperties
} from './ShipLayer'
import {
  CARRIER_MARKER_LAYER_ID,
  buildPopupHtml as buildCarrierPopup,
  type CsgProperties
} from './CarrierLayer'
import {
  INTEL_LAYER_ID,
  buildPopupHtml as buildIntelPopup,
  type IntelProperties
} from './IntelLayer'
import {
  FLIGHT_UNCLUSTERED_LAYER_ID,
  FLIGHT_MILITARY_LAYER_ID,
  buildPopupHtml as buildFlightPopup,
  type FlightProperties
} from './FlightLayer'

// ─── Types ───────────────────────────────────────────────────

type FeatureType = 'ship' | 'csg' | 'intel' | 'flight'

interface TypedFeature {
  type: FeatureType
  layerId: string
  feature: maplibregl.MapGeoJSONFeature
}

// ─── All clickable (non-cluster) layer IDs ───────────────────

const CLICKABLE_LAYER_IDS: string[] = [
  ...ALL_CIV_LAYER_IDS,
  SHIP_MILITARY_LAYER_ID,
  CARRIER_MARKER_LAYER_ID,
  INTEL_LAYER_ID,
  FLIGHT_UNCLUSTERED_LAYER_ID,
  FLIGHT_MILITARY_LAYER_ID
]

// ─── Feature type icons ──────────────────────────────────────

const TYPE_ICONS: Record<FeatureType, string> = {
  ship: '🚢',
  csg: '⚓',
  intel: '📌',
  flight: '✈️'
}


// ─── Helpers ─────────────────────────────────────────────────

function classifyFeature(f: maplibregl.MapGeoJSONFeature): FeatureType {
  const lid = f.layer?.id ?? ''
  if (ALL_CIV_LAYER_IDS.includes(lid as typeof ALL_CIV_LAYER_IDS[number]) || lid === SHIP_MILITARY_LAYER_ID) return 'ship'
  if (lid === CARRIER_MARKER_LAYER_ID) return 'csg'
  if (lid === INTEL_LAYER_ID) return 'intel'
  if (lid === FLIGHT_UNCLUSTERED_LAYER_ID || lid === FLIGHT_MILITARY_LAYER_ID) return 'flight'
  return 'ship' // fallback
}

function getFeatureName(tf: TypedFeature): string {
  const p = tf.feature.properties as Record<string, unknown>
  switch (tf.type) {
    case 'ship':
      return (p.ship_name as string)?.trim() || `MMSI ${p.mmsi ?? '???'}` 
    case 'csg':
      return (p.name as string) || 'Unknown CSG'
    case 'intel':
      return (p.title as string) || 'Intel Item'
    case 'flight':
      return (p.callsign as string)?.trim() || (p.icao24 as string)?.toUpperCase() || 'Unknown'
  }
}

function getFeatureSubLabel(tf: TypedFeature): string {
  const p = tf.feature.properties as Record<string, unknown>
  switch (tf.type) {
    case 'ship':
      return (p.ship_type as string)?.toUpperCase() || 'Vessel'
    case 'csg':
      return `${p.vessel_count ?? '?'} vessels · ${p.status ?? 'unknown'}`
    case 'intel':
      return `${p.region ?? ''} · ${p.tier ?? ''}`
    case 'flight': {
      const mil = p.is_military === 1 || p.is_military === true
      return `${p.aircraft_type ?? 'Aircraft'}${mil ? ' · MILITARY' : ''}`
    }
  }
}

function getCoords(tf: TypedFeature): [number, number] {
  const geom = tf.feature.geometry as { type: string; coordinates: [number, number] }
  return geom.coordinates
}

/** Fetch carrier group details by ID (Electron or HTTP) */
async function fetchCarrierGroupById(id: string): Promise<CarrierGroupWithVessels | undefined> {
  const apiCarrier = (window as any).api?.carrier
  if (apiCarrier) {
    return await apiCarrier.getGroupById(id) as CarrierGroupWithVessels | undefined
  } else {
    const res = await fetch(`${window.location.origin}/api/carrier/groups/${id}`)
    if (!res.ok) return undefined
    return (await res.json()) as CarrierGroupWithVessels | undefined
  }
}

/** Build detail HTML for a single feature */
function buildDetailHtml(tf: TypedFeature): string {
  const props = tf.feature.properties as Record<string, unknown>
  const coords = getCoords(tf)
  const coordsObj = { lng: coords[0], lat: coords[1] }

  switch (tf.type) {
    case 'ship':
      return buildShipPopup(props as unknown as VesselProperties, coordsObj)
    case 'csg':
      // For CSG, we can't await here, so we use a simplified version
      // The full data will be loaded asynchronously if needed
      return buildCarrierPopup(props as unknown as CsgProperties, undefined, coordsObj)
    case 'intel':
      return buildIntelPopup(props as unknown as IntelProperties, coordsObj)
    case 'flight':
      return buildFlightPopup(props as unknown as FlightProperties, coordsObj)
  }
}

// ─── Multi-feature popup HTML builder ────────────────────────

function buildMultiPopupHtml(
  features: TypedFeature[],
  selectedIndex: number
): string {
  const count = features.length
  const header = `<div style="font-size:10px;color:#71717a;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">${count} items at this location</div>`

  const items = features.map((tf, i) => {
    const icon = TYPE_ICONS[tf.type]
    const name = getFeatureName(tf)
    const sub = getFeatureSubLabel(tf)
    const selected = i === selectedIndex
    const bg = selected ? 'rgba(59,130,246,0.15)' : 'transparent'
    const borderLeft = selected ? '3px solid #3b82f6' : '3px solid transparent'
    return `
      <div class="unified-popup-item" data-index="${i}"
           style="padding:5px 8px;cursor:pointer;border-left:${borderLeft};background:${bg};transition:background 0.15s,border-color 0.15s;"
           onmouseenter="this.style.background='rgba(255,255,255,0.05)'"
           onmouseleave="this.style.background='${bg}'">
        <div style="font-size:13px;font-weight:600;color:#e0e0e0;">
          ${icon} ${name}
        </div>
        <div style="font-size:10px;color:#9e9e9e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${sub}
        </div>
      </div>`
  }).join('')

  const selectedFeature = features[selectedIndex]
  const detailHtml = buildDetailHtml(selectedFeature)

  return `
    <div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;font-size:13px;max-width:320px;">
      ${header}
      <div style="border-bottom:1px solid #333;margin-bottom:4px;"></div>
      <div id="unified-popup-items" style="max-height:120px;overflow-y:auto;">
        ${items}
      </div>
      <div style="border-bottom:1px solid #333;margin:4px 0;"></div>
      <div id="unified-popup-detail" style="max-height:250px;overflow-y:auto;">
        ${detailHtml}
      </div>
    </div>
  `
}

// ─── Props ───────────────────────────────────────────────────

interface UnifiedMapPopupProps {
  map: maplibregl.Map | null
}

// ─── Component ───────────────────────────────────────────────

export default function UnifiedMapPopup({ map }: UnifiedMapPopupProps): React.JSX.Element {
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const featuresRef = useRef<TypedFeature[]>([])
  const selectedRef = useRef<number>(0)

  useEffect(() => {
    if (!map) return

    const handleClick = async (e: maplibregl.MapMouseEvent): Promise<void> => {
      // Query all clickable layers at the click point
      const allFeatures = map.queryRenderedFeatures(e.point, {
        layers: CLICKABLE_LAYER_IDS
      })

      // Debug: log what layers exist and what was found at click point
      if (allFeatures.length === 0) {
        // Only log when debug mode is enabled (avoids console spam on empty clicks)
        const debugAll = map.queryRenderedFeatures(e.point)
        if (debugAll.length > 0) {
          console.log(
            '[UnifiedMapPopup] Click at',
            e.point,
            'found features on non-clickable layers:',
            debugAll.map(f => f.layer?.id).filter(Boolean)
          )
        }
      }

      // Remove existing popup
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }

      // No features → remove popup and return
      if (!allFeatures || allFeatures.length === 0) return

      // Classify features by type
      const typedFeatures: TypedFeature[] = allFeatures.map(f => ({
        type: classifyFeature(f),
        layerId: f.layer?.id ?? '',
        feature: f
      }))

      // ── CSG proximity expansion ──
      // Since CSG markers can overlap at low zoom, when clicking near ANY CSG
      // marker, find ALL CSG groups in the source within a radius and add them.
      // This ensures the tabbed popup shows all nearby groups.
      const clickedCsg = typedFeatures.some(tf => tf.type === 'csg')
      if (clickedCsg) {
        const clickLng = e.lngLat.lng
        const clickLat = e.lngLat.lat

          // Query the CSG source directly for all features
        const csgSource = map.getSource('carrier-groups')
        if (csgSource) {
          const allCsgFeatures = map.querySourceFeatures('carrier-groups')

          // Add any CSG features not already in our list
          const existingCsgIds = new Set(
            typedFeatures
              .filter(tf => tf.type === 'csg')
              .map(tf => (tf.feature.properties as Record<string, unknown>).id as string)
          )

          for (const f of allCsgFeatures) {
            const coords = (f.geometry as { type: string; coordinates: [number, number] }).coordinates
            const dist = Math.sqrt(
              Math.pow(coords[0] - clickLng, 2) + Math.pow(coords[1] - clickLat, 2)
            )

            // Rough distance check: within 3 degrees (~300nm) of click
            if (dist < 3 && !existingCsgIds.has((f.properties as Record<string, unknown>).id as string)) {
              typedFeatures.push({
                type: 'csg',
                layerId: CARRIER_MARKER_LAYER_ID,
                feature: f as maplibregl.MapGeoJSONFeature
              })
              existingCsgIds.add((f.properties as Record<string, unknown>).id as string)
            }
          }
        }
      }

      // Use click coordinates for popup anchor
      const lngLat = e.lngLat.toArray() as [number, number]

      if (typedFeatures.length === 1) {
        // ── Single feature: show normal popup ──
        const tf = typedFeatures[0]
        const coords = getCoords(tf)
        const coordsObj = { lng: coords[0], lat: coords[1] }

        let html: string

        if (tf.type === 'csg') {
          // CSG needs async data fetch
          const csgProps = tf.feature.properties as unknown as CsgProperties
          const group = await fetchCarrierGroupById(csgProps.id).catch(() => undefined)
          html = buildCarrierPopup(csgProps, group, coordsObj)
        } else {
          html = buildDetailHtml(tf)
        }

        popupRef.current = new maplibregl.Popup({
          offset: 12,
          closeButton: true,
          maxWidth: '320px'
        })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map)

        attachBriefListeners(popupRef.current)
      } else {
        // ── Multiple features: show unified popup ──
        featuresRef.current = typedFeatures
        selectedRef.current = 0

        const html = buildMultiPopupHtml(typedFeatures, 0)

        popupRef.current = new maplibregl.Popup({
          offset: 12,
          closeButton: true,
          maxWidth: '340px'
        })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map)

        attachBriefListeners(popupRef.current)

        // For CSG features, try to load full group data asynchronously
        const csgFeatures = typedFeatures.filter(tf => tf.type === 'csg')
        if (csgFeatures.length > 0) {
          for (const csgTf of csgFeatures) {
            const csgProps = csgTf.feature.properties as unknown as CsgProperties
            const group = await fetchCarrierGroupById(csgProps.id).catch(() => undefined)
            if (group) {
              // Re-render detail if this CSG is currently selected
              const idx = typedFeatures.indexOf(csgTf)
              if (idx === selectedRef.current) {
                const detailEl = popupRef.current?.getElement()?.querySelector('#unified-popup-detail')
                if (detailEl) {
                  const coords = getCoords(csgTf)
                  detailEl.innerHTML = buildCarrierPopup(csgProps, group, { lng: coords[0], lat: coords[1] })
                  attachBriefListeners(popupRef.current!)
                }
              }
            }
          }
        }

        // Attach item click listeners for switching the detail view
        attachItemSwitchListeners()
      }
    }

    const attachBriefListeners = (popup: maplibregl.Popup): void => {
      setTimeout(() => {
        const popupEl = popup?.getElement()
        if (!popupEl) return
        const btns = popupEl.querySelectorAll('.brief-btn, .intel-brief-btn')
        btns.forEach(btn => {
          btn.addEventListener('click', () => {
            const type = (btn as HTMLElement).dataset.type || 'ship'
            const data = JSON.parse(decodeURIComponent((btn as HTMLElement).dataset.brief || '{}'))
            // Use per-map handler instead of global singleton
            const handler = (map as any)?.__briefHandler
            if (handler) {
              handler(type, data)
            }
          })
        })
      }, 0)
    }

    const attachItemSwitchListeners = (): void => {
      setTimeout(() => {
        const popupEl = popupRef.current?.getElement()
        if (!popupEl) return

        const items = popupEl.querySelectorAll('.unified-popup-item')
        items.forEach(item => {
          item.addEventListener('click', () => {
            const idx = parseInt((item as HTMLElement).dataset.index ?? '0', 10)
            if (idx === selectedRef.current) return
            selectedRef.current = idx

            const features = featuresRef.current
            if (!features[idx]) return

            // Update item selection styles
            const allItems = popupEl.querySelectorAll('.unified-popup-item')
            allItems.forEach((el, i) => {
              const htmlEl = el as HTMLElement
              if (i === idx) {
                htmlEl.style.borderLeft = '3px solid #3b82f6'
                htmlEl.style.background = 'rgba(59,130,246,0.15)'
              } else {
                htmlEl.style.borderLeft = '3px solid transparent'
                htmlEl.style.background = 'transparent'
              }
            })

            // Update detail panel
            const detailEl = popupEl.querySelector('#unified-popup-detail')
            if (detailEl) {
              const tf = features[idx]
              detailEl.innerHTML = buildDetailHtml(tf)
              attachBriefListeners(popupRef.current!)

              // If CSG, try to load full data
              if (tf.type === 'csg') {
                const csgProps = tf.feature.properties as unknown as CsgProperties
                fetchCarrierGroupById(csgProps.id).then(group => {
                  if (group && idx === selectedRef.current) {
                    const coords = getCoords(tf)
                    detailEl.innerHTML = buildCarrierPopup(csgProps, group, { lng: coords[0], lat: coords[1] })
                    attachBriefListeners(popupRef.current!)
                  }
                }).catch(() => { /* ignore */ })
              }
            }
          })
        })
      }, 0)
    }

    map.on('click', handleClick)

    return () => {
      map.off('click', handleClick)
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
    }
  }, [map])

  return <></>
}