/**
 * RegionLayer — renders broad geographic region boxes.
 * Separated from TransitCorridorLayer to prevent click overlap.
 * Toggle: Layer controls → "Region Areas" or Settings → "Show Region Areas"
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { REGION_AREAS } from '../../../../shared/regions'

const SOURCE_ID = 'regions'
const FILL_LAYER_ID = 'regions-fill'
const OUTLINE_LAYER_ID = 'regions-outline'
const LABEL_LAYER_ID = 'regions-labels'

interface RegionLayerProps {
  map: maplibregl.Map
  visible: boolean
}

function buildRegionGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: REGION_AREAS.map((r) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [r.minLon, r.minLat],
            [r.maxLon, r.minLat],
            [r.maxLon, r.maxLat],
            [r.minLon, r.maxLat],
            [r.minLon, r.minLat]
          ]
        ]
      },
      properties: {
        name: r.name
      }
    }))
  }
}

export function RegionLayer({ map, visible }: RegionLayerProps): React.JSX.Element {
  const addedRef = useRef(false)

  useEffect(() => {
    if (!map || map.getStyle() === undefined) return

    if (!addedRef.current) {
      const geojson = buildRegionGeoJSON()

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geojson
      })

      // Very light teal fill
      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': '#14b8a6',
          'fill-opacity': 0.06
        }
      })

      // Thin teal outline
      map.addLayer({
        id: OUTLINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#14b8a6',
          'line-width': 1,
          'line-opacity': 0.4,
          'line-dasharray': [2, 4]
        }
      })

      // Name labels
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-anchor': 'top',
          'text-offset': [0, 0.5],
          'text-allow-overlap': false,
          visibility: visible ? 'visible' : 'none'
        },
        paint: {
          'text-color': '#14b8a6',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5
        }
      })

      // Click handler — simple popup, no "Generate Brief"
      map.on('click', FILL_LAYER_ID, (e) => {
        if (e.features && e.features.length > 0) {
          const name = (e.features[0].properties as { name: string }).name
          const region = REGION_AREAS.find((r) => r.name === name)
          if (!region) return

          const lat = (region.minLat + region.maxLat) / 2
          const lon = (region.minLon + region.maxLon) / 2

          new maplibregl.Popup({
            closeButton: true,
            offset: 8,
            maxWidth: '200px',
            className: 'region-popup'
          })
            .setLngLat({ lng: lon, lat })
            .setHTML(
              `<div style="font-family:system-ui;color:#e0e0e0;background:#1e1e1e;padding:8px;font-size:13px;">` +
                `<div style="font-size:14px;font-weight:700;color:#14b8a6;">${name}</div>` +
                `<div style="font-size:11px;color:#a1a1aa;margin-top:2px;">Region Area</div>` +
                `<div style="font-size:10px;color:#71717a;margin-top:4px;">${region.minLat.toFixed(1)}°-${region.maxLat.toFixed(1)}°N, ${region.minLon.toFixed(1)}°-${region.maxLon.toFixed(1)}°E</div>` +
                `</div>`
            )
            .addTo(map)
        }
      })

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