import { useEffect, useRef, useState, useCallback } from 'react'
import { Popup } from 'maplibre-gl'
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

    let lastZoneClickTime = 0

    // Click handler for zone details — only fires when clicking the zone fill itself,
    // not when clicking markers (intel items, flights, vessels, etc.) on top of the zone.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleZoneClick = async (e: any) => {
      // Debounce: ignore rapid re-clicks within 500ms
      const now = Date.now()
      if (now - lastZoneClickTime < 500) return
      lastZoneClickTime = now

      if (!e.features || e.features.length === 0) return

      // Check if any point features from other layers exist at the click point
      // Only query layers that actually exist on the map to avoid errors
      const allPointLayers = [
        'intel-markers', 'adsb-unclustered', 'adsb-military-points',
        'vessels-cargo', 'vessels-tanker', 'vessels-passenger', 'vessels-other',
        'vessels-military', 'vessels-clusters', 'vessels-cluster-count',
        'adsb-clusters', 'adsb-cluster-count',
        'carrier-markers', 'carrier-patrol-range', 'carrier-label',
        'gfw-presence', 'gfw-presence-label', 'gfw-sar', 'gfw-sar-label'
      ]
      const existingLayers = new Set(map.getStyle()?.layers?.map(l => l.id) ?? [])
      const availableLayers = allPointLayers.filter(id => existingLayers.has(id))
      if (availableLayers.length > 0) {
        const pointFeatures = map.queryRenderedFeatures(e.point, { layers: availableLayers })
        if (pointFeatures.length > 0) return // Let the point layer handle the click
      }

      const feature = e.features[0]
      const zoneId = feature.properties?.id
      if (!zoneId) return

      try {
        const detail = await window.api.zone.detail(zoneId)
        if (detail) {
          const zone = detail.zone as ConflictZone
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const evidence = detail.evidence as Array<Record<string, any>>
          const evidenceItems = evidence && evidence.length > 0
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? evidence.map((ev: any, i: number) => {
                const sourceLabel = ev.source_table === 'tactical_events' ? 'TAC'
                  : ev.source_table === 'intel_items' ? 'INTEL'
                  : ev.source_table === 'articles' ? 'NEWS'
                  : ev.source_table === 'notams' ? 'NOTAM'
                  : ev.source_table === 'flights' ? 'ADSB'
                  : 'OTHER'
                const title = ev.display_title || ev.title || ev.description || 'Unknown evidence item'
                return `<div class="zone-evidence-item">${i + 1}. <span class="zone-evidence-tag">[${sourceLabel}]</span> ${String(title).substring(0, 120)}</div>`
              }).join('')
            : '<div class="zone-evidence-item">No linked evidence</div>'

          const popupHtml = `
            <div class="zone-popup">
              <div class="zone-popup-title">📍 ${zone.name}</div>
              <div class="zone-popup-row"><span class="zone-popup-label">Status:</span> <span class="zone-status-${zone.status}">${zone.status.toUpperCase()}</span></div>
              <div class="zone-popup-row"><span class="zone-popup-label">Heat Score:</span> ${zone.heat_score.toFixed(1)}</div>
              <div class="zone-popup-row"><span class="zone-popup-label">Signals:</span> ${zone.signal_count}</div>
              <div class="zone-popup-row"><span class="zone-popup-label">Sensitivity:</span> ${zone.sensitivity}</div>
              <div class="zone-popup-row"><span class="zone-popup-label">Radius:</span> ${zone.radius_nm.toFixed(0)} nm</div>
              <div class="zone-popup-section">
                <div class="zone-popup-section-title">Evidence (${evidence ? evidence.length : 0})</div>
                <div class="zone-evidence-list">${evidenceItems}</div>
              </div>
            </div>`

          new Popup({
            offset: 12,
            closeButton: true,
            maxWidth: '360px'
          })
            .setLngLat(e.lngLat)
            .setHTML(popupHtml)
            .addTo(map)
        }
      } catch {
        // Detail fetch failed
      }
    }
    map.on('click', FILL_LAYER_ID, handleZoneClick)

    // Change cursor on hover
    const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleMouseLeave = () => { map.getCanvas().style.cursor = '' }
    map.on('mouseenter', FILL_LAYER_ID, handleMouseEnter)
    map.on('mouseleave', FILL_LAYER_ID, handleMouseLeave)

    addedRef.current = true

    return () => {
      map.off('click', FILL_LAYER_ID, handleZoneClick)
      map.off('mouseenter', FILL_LAYER_ID, handleMouseEnter)
      map.off('mouseleave', FILL_LAYER_ID, handleMouseLeave)
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