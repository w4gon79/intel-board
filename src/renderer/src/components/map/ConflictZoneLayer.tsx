import { useEffect, useRef } from 'react'
import type { Map } from 'maplibre-gl'
import conflictZones from '../../../../main/services/identification/data/conflict-zones.json'

interface Props {
  map: Map
  visible: boolean
}

const SOURCE_ID = 'conflict-zones'
const FILL_LAYER_ID = 'conflict-zones-fill'
const BORDER_LAYER_ID = 'conflict-zones-border'
const LABEL_LAYER_ID = 'conflict-zones-labels'

function nmToKm(nm: number): number {
  return nm * 1.852
}

function createCircleGeometry(
  centerLat: number,
  centerLon: number,
  radiusNm: number
): GeoJSON.Position[] {
  const radiusKm = nmToKm(radiusNm)
  const points = 64
  const coordinates: GeoJSON.Position[] = []

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI
    const dx = radiusKm * Math.cos(angle)
    const dy = radiusKm * Math.sin(angle)

    const lat = centerLat + (dy / 6371) * (180 / Math.PI)
    const lon =
      centerLon +
      (dx / 6371) * (180 / Math.PI) / Math.cos((centerLat * Math.PI) / 180)

    coordinates.push([lon, lat])
  }

  return coordinates
}

export default function ConflictZoneLayer({ map, visible }: Props) {
  const addedRef = useRef(false)

  useEffect(() => {
    if (!map || addedRef.current) return

    // Create GeoJSON features for each zone
    const features: GeoJSON.Feature[] = conflictZones.map((zone) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [createCircleGeometry(zone.lat, zone.lon, zone.radiusNm)]
      },
      properties: {
        id: zone.id,
        name: zone.name,
        sensitivity: zone.sensitivity,
        radiusNm: zone.radiusNm
      }
    }))

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features
    }

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: geojson
    })

    // Semi-transparent fill - color by sensitivity
    map.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': [
          'match',
          ['get', 'sensitivity'],
          'high',
          '#ff1744',
          'medium',
          '#ff9100',
          'low',
          '#ffd600',
          '#ff1744'
        ],
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          0.03,
          4,
          0.06,
          8,
          0.1
        ]
      }
    })

    // Dashed border
    map.addLayer({
      id: BORDER_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': [
          'match',
          ['get', 'sensitivity'],
          'high',
          '#ff5252',
          'medium',
          '#ffab40',
          'low',
          '#ffd740',
          '#ff5252'
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          0.5,
          5,
          1,
          10,
          2
        ],
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          0.3,
          4,
          0.5,
          8,
          0.7
        ],
        'line-dasharray': [4, 4]
      }
    })

    // Zone name labels
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          8,
          5,
          11,
          8,
          14
        ],
        'text-allow-overlap': false,
        'text-optional': true
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          0.4,
          4,
          0.7,
          6,
          0.9
        ]
      }
    })

    addedRef.current = true

    return () => {
      if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID)
      if (map.getLayer(BORDER_LAYER_ID)) map.removeLayer(BORDER_LAYER_ID)
      if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      addedRef.current = false
    }
  }, [map])

  // Toggle visibility
  useEffect(() => {
    if (!map || !addedRef.current) return
    const vis = visible ? 'visible' : 'none'
    if (map.getLayer(FILL_LAYER_ID))
      map.setLayoutProperty(FILL_LAYER_ID, 'visibility', vis)
    if (map.getLayer(BORDER_LAYER_ID))
      map.setLayoutProperty(BORDER_LAYER_ID, 'visibility', vis)
    if (map.getLayer(LABEL_LAYER_ID))
      map.setLayoutProperty(LABEL_LAYER_ID, 'visibility', vis)
  }, [map, visible])

  return null
}