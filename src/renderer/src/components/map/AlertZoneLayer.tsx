/**
 * AlertZoneLayer — renders saved alert rule zones on the map.
 *
 * Fetches all alert rules with drawn areas (polygon) and displays them
 * as semi-transparent overlays color-coded by severity.
 */

import { useEffect, useRef } from 'react'
import type { Map as MapboxMap, GeoJSONSource } from 'mapbox-gl'

// ── Constants ────────────────────────────────────────────────

const SOURCE_ID = 'alert-zones'
const FILL_LAYER_ID = 'alert-zones-fill'
const LINE_LAYER_ID = 'alert-zones-line'

const SEVERITY_COLORS: Record<string, { fill: string; line: string }> = {
  ALERT:  { fill: 'rgba(239, 68, 68, 0.12)',  line: 'rgba(239, 68, 68, 0.6)'  },  // red
  WATCH:  { fill: 'rgba(245, 158, 11, 0.12)', line: 'rgba(245, 158, 11, 0.6)' },  // amber
  CONTEXT: { fill: 'rgba(59, 130, 246, 0.10)', line: 'rgba(59, 130, 246, 0.5)' }  // blue
}

const DEFAULT_COLOR = { fill: 'rgba(99, 102, 241, 0.10)', line: 'rgba(99, 102, 241, 0.5)' }

interface AlertZone {
  id: string
  name: string
  enabled: boolean
  area: string
  severity: 'ALERT' | 'WATCH' | 'CONTEXT'
}

interface ZoneFeature extends GeoJSON.Feature {
  properties: {
    ruleId: string
    ruleName: string
    severity: string
    enabled: boolean
    fillColor: string
    lineColor: string
  }
}

function buildZoneFeatures(rules: AlertZone[]): ZoneFeature[] {
  const features: ZoneFeature[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__alertHiddenRuleId === rule.id) continue

    let area: { polygon?: [number, number][]; circle?: { center: [number, number]; radiusKm: number } }
    try {
      area = JSON.parse(rule.area)
    } catch {
      continue
    }

    if (!area.polygon || area.polygon.length < 3) continue

    // Close the ring for GeoJSON
    const ring = [...area.polygon]
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push(first)
    }

    const colors = SEVERITY_COLORS[rule.severity] ?? DEFAULT_COLOR

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [ring]
      },
      properties: {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        enabled: rule.enabled,
        fillColor: colors.fill,
        lineColor: colors.line
      }
    })
  }

  return features
}

// ── Component ────────────────────────────────────────────────

interface AlertZoneLayerProps {
  map: MapboxMap
}

export function AlertZoneLayer({ map }: AlertZoneLayerProps): null {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadZones = async (): Promise<void> => {
    try {
      const rules = (await window.api.alertRules.list()) as AlertZone[]
      const features = buildZoneFeatures(Array.isArray(rules) ? rules : [])

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features
      }

      // Add or update source
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geojson })
      } else {
        ;(map.getSource(SOURCE_ID) as GeoJSONSource).setData(geojson)
      }

      // Add fill layer (use expression for per-feature color)
      if (!map.getLayer(FILL_LAYER_ID)) {
        map.addLayer({
          id: FILL_LAYER_ID,
          type: 'fill',
          source: SOURCE_ID,
          paint: {
            'fill-color': ['get', 'fillColor'] as unknown as string,
            'fill-opacity': 1
          }
        })
      }

      // Add line layer
      if (!map.getLayer(LINE_LAYER_ID)) {
        map.addLayer({
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': ['get', 'lineColor'] as unknown as string,
            'line-width': 1.5,
            'line-dasharray': [3, 2]
          }
        })
      }
    } catch (err) {
      console.error('[AlertZoneLayer] Failed to load zones:', err)
    }
  }

  useEffect(() => {
    // Initial load
    loadZones()

    // Poll every 30 seconds for updates
    intervalRef.current = setInterval(loadZones, 30_000)

    // Listen for rule changes
    const handleRulesChanged = (): void => {
      loadZones()
    }
    window.addEventListener('alert-rules-changed', handleRulesChanged)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('alert-rules-changed', handleRulesChanged)
      try {
        if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID)
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  return null
}