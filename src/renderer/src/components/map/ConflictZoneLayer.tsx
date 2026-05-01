import { useEffect, useRef, useState, useCallback } from 'react'
import type { Map } from 'maplibre-gl'

interface Props {
  map: Map
  visible: boolean
}

interface ConflictZone {
  id: string
  name: string
  status: string
  heat_score: number
  center_lat: number
  center_lon: number
  radius_nm: number
  sensitivity: string
  signal_count: number
}

const SOURCE_ID = 'conflict-zones'
const FILL_LAYER_ID = 'conflict-zones-fill'
const BORDER_LAYER_ID = 'conflict-zones-border'
const LABEL_LAYER_ID = 'conflict-zones-labels'
const POLL_INTERVAL = 60_000 // 60 seconds

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

function getStatusColor(status: string): string {
  switch (status) {
    case 'escalating': return '#ff1744'
    case 'active': return '#ff6d00'
    case 'monitoring': return '#ffd600'
    case 'fading': return '#78909c'
    default: return '#ffd600'
  }
}

function getStatusBorderColor(status: string): string {
  switch (status) {
    case 'escalating': return '#ff5252'
    case 'active': return '#ff9e40'
    case 'monitoring': return '#ffd740'
    case 'fading': return '#90a4ae'
    default: return '#ffd740'
  }
}

function getStatusOpacity(status: string): number {
  switch (status) {
    case 'escalating': return 0.25
    case 'active': return 0.20
    case 'monitoring': return 0.15
    case 'fading': return 0.10
    default: return 0.15
  }
}

export default function ConflictZoneLayer({ map, visible }: Props) {
  const addedRef = useRef(false)
  const [zones, setZones] = useState<ConflictZone[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchZones = useCallback(async () => {
    try {
      const result = await window.api.zone.list() as ConflictZone[]
      if (result && Array.isArray(result)) {
        setZones(result)
      }
    } catch {
      // Zone API may not be available yet
    }
  }, [])

  // Fetch zones on mount and poll for updates
  useEffect(() => {
    fetchZones()
    pollRef.current = setInterval(fetchZones, POLL_INTERVAL)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchZones])

  // Add source and layers on first render
  useEffect(() => {
    if (!map || addedRef.current) return

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    })

    // Semi-transparent fill - color by status
    map.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': ['get', 'fillOpacity']
      }
    })

    // Dashed border
    map.addLayer({
      id: BORDER_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': ['get', 'borderColor'],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1, 0.5,
          5, 1,
          10, 2
        ],
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1, 0.3,
          4, 0.5,
          8, 0.7
        ],
        'line-dasharray': [4, 4]
      }
    })

    // Zone name labels with heat score
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'labelText'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2, 8,
          5, 11,
          8, 14
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
          2, 0.4,
          4, 0.7,
          6, 0.9
        ]
      }
    })

    // Click handler for zone details
    map.on('click', FILL_LAYER_ID, async (e) => {
      if (!e.features || e.features.length === 0) return
      const feature = e.features[0]
      const zoneId = feature.properties?.id
      if (!zoneId) return

      try {
        const detail = await window.api.zone.detail(zoneId)
        if (detail) {
          const zone = detail.zone as ConflictZone
          const evidence = detail.evidence as Array<{ title: string; summary: string }>
          const evidenceText = evidence && evidence.length > 0
            ? evidence.map((e, i) => `  ${i + 1}. ${e.title}`).join('\n')
            : '  No linked evidence'
          alert(
            `📍 ${zone.name}\n` +
            `Status: ${zone.status.toUpperCase()}\n` +
            `Heat Score: ${zone.heat_score.toFixed(1)}\n` +
            `Signals: ${zone.signal_count}\n` +
            `Sensitivity: ${zone.sensitivity}\n` +
            `Radius: ${zone.radius_nm.toFixed(0)} nm\n\n` +
            `Evidence:\n${evidenceText}`
          )
        }
      } catch {
        // Detail fetch failed
      }
    })

    // Change cursor on hover
    map.on('mouseenter', FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
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

  // Update GeoJSON data when zones change
  useEffect(() => {
    if (!map || !addedRef.current) return

    const features: GeoJSON.Feature[] = zones.map((zone) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [createCircleGeometry(zone.center_lat, zone.center_lon, zone.radius_nm)]
      },
      properties: {
        id: zone.id,
        name: zone.name,
        status: zone.status,
        heat_score: zone.heat_score,
        sensitivity: zone.sensitivity,
        signal_count: zone.signal_count,
        fillColor: getStatusColor(zone.status),
        fillOpacity: getStatusOpacity(zone.status),
        borderColor: getStatusBorderColor(zone.status),
        labelText: `${zone.name} (${zone.heat_score.toFixed(1)})`
      }
    }))

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features
    }

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(geojson)
    }
  }, [map, zones])

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