/**
 * TransitCorridorLayer — renders semi-transparent bounding boxes
 * over major maritime choke points / transit corridors.
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { TRANSIT_CORRIDORS } from '../../../../shared/regions'

const SOURCE_ID = 'transit-corridors'
const FILL_LAYER_ID = 'transit-corridors-fill'
const OUTLINE_LAYER_ID = 'transit-corridors-outline'
const LABEL_LAYER_ID = 'transit-corridors-labels'

interface TransitCorridorLayerProps {
  map: maplibregl.Map
  visible: boolean
}

// Only transit corridors (choke point shipping lanes) — not broad region areas
const CORRIDORS = TRANSIT_CORRIDORS

function buildCorridorGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: CORRIDORS.map((c) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [c.minLon, c.minLat],
            [c.maxLon, c.minLat],
            [c.maxLon, c.maxLat],
            [c.minLon, c.maxLat],
            [c.minLon, c.minLat]
          ]
        ]
      },
      properties: {
        name: c.name
      }
    }))
  }
}

export function TransitCorridorLayer({ map, visible }: TransitCorridorLayerProps): React.JSX.Element {
  const addedRef = useRef(false)
  const popupRef = useRef<maplibregl.Popup | null>(null)

  useEffect(() => {
    if (!map || map.getStyle() === undefined) return

    if (!addedRef.current) {
      const geojson = buildCorridorGeoJSON()

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geojson
      })

      // Semi-transparent orange fill
      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': '#f97316',
          'fill-opacity': 0.15
        }
      })

      // Dashed orange outline
      map.addLayer({
        id: OUTLINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#f97316',
          'line-width': 2,
          'line-opacity': 0.7,
          'line-dasharray': [4, 2]
        }
      })

      // Name labels
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.5],
          'text-allow-overlap': false,
          visibility: visible ? 'visible' : 'none'
        },
        paint: {
          'text-color': '#f97316',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5
        }
      })

      // Click popup with Generate Brief button
      map.on('click', FILL_LAYER_ID, (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0]
          const name = (feature.properties as { name: string }).name

          // Calculate center coords from corridor bounding box
          const corridor = CORRIDORS.find((c) => c.name === name)
          const lat = corridor ? (corridor.minLat + corridor.maxLat) / 2 : e.lngLat.lat
          const lon = corridor ? (corridor.minLon + corridor.maxLon) / 2 : e.lngLat.lng

          const briefData = encodeURIComponent(JSON.stringify({ name, lat, lon, status: 'active' }))

          if (popupRef.current) popupRef.current.remove()
          const popup = new maplibregl.Popup({
            closeButton: true,
            offset: 8,
            maxWidth: '260px',
            className: 'transit-corridor-popup'
          })
            .setLngLat({ lng: lon, lat })
            .setHTML(
              `<div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;padding:8px;font-size:13px;line-height:1.5;">` +
                `<div style="font-size:14px;font-weight:700;color:#f97316;">${name}</div>` +
                `<div style="font-size:11px;color:#a1a1aa;margin-top:2px;">Transit Corridor — SHIPPING LANE</div>` +
                `<div style="margin-top:8px;border-top:1px solid #333;padding-top:6px">` +
                `<button class="chokepoint-brief-btn" data-type="chokepoint" data-brief="${briefData}" ` +
                `style="background:#2563eb;color:white;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;width:100%">` +
                `🔍 Generate Brief</button></div></div>`
            )
            .addTo(map)

          popupRef.current = popup

          // Attach click listener after popup is in DOM
          setTimeout(() => {
            const popupEl = popup.getElement()
            const btn = popupEl?.querySelector('.chokepoint-brief-btn') as HTMLElement | null
            if (btn) {
              btn.addEventListener('click', () => {
                const type = btn.dataset.type || 'chokepoint'
                const data = JSON.parse(decodeURIComponent(btn.dataset.brief || '{}'))
                // Use per-map handler instead of global singleton
                const handler = (map as any)?.__briefHandler
                if (handler) {
                  handler(type, data)
                }
              })
            }
          }, 0)
        }
      })

      // Cursor change only on hover
      map.on('mouseenter', FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mouseleave', FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })

      addedRef.current = true
    }

    // Toggle visibility
    const vis = visible ? 'visible' : 'none'
    for (const layerId of [FILL_LAYER_ID, OUTLINE_LAYER_ID, LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', vis)
      }
    }
  }, [map, visible])

  return <></>
}