/**
 * MapDrawLayer — lightweight custom draw mode for alert zone drawing.
 *
 * Implements circle, rectangle, and polygon drawing using Mapbox GL's
 * built-in event system. No external draw library needed.
 *
 * Communication with AlertRulesPanel happens via window.__alertDrawStart.
 */

import { useEffect, useRef } from 'react'
import type { Map as MapboxMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'

// ── Types ────────────────────────────────────────────────────

type DrawShapeType = 'circle' | 'rectangle' | 'polygon'

interface DrawState {
  active: boolean
  shapeType: DrawShapeType
  points: [number, number][] // [lng, lat] pairs (Mapbox convention)
  previewSource: string
  previewLayerFill: string
  previewLayerLine: string
  vertexSource: string
  vertexLayer: string
}

interface DrawCallbacks {
  onComplete: (result: { coordinates: [number, number][] }) => void
  onCancel: () => void
}

// ── Helpers ──────────────────────────────────────────────────

const SOURCE_ID = 'alert-draw-preview'
const FILL_LAYER_ID = 'alert-draw-preview-fill'
const LINE_LAYER_ID = 'alert-draw-preview-line'
const VERTEX_SOURCE_ID = 'alert-draw-vertices'
const VERTEX_LAYER_ID = 'alert-draw-vertex-circles'

/** Generate a circle polygon approximation (32-sided). */
function circleToPolygon(center: [number, number], edgePoint: [number, number], segments = 32): [number, number][] {
  const R = 6371 // Earth radius in km
  const dLat = ((edgePoint[1] - center[1]) * Math.PI) / 180
  const dLon = ((edgePoint[0] - center[0]) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((center[1] * Math.PI) / 180) *
      Math.cos((edgePoint[1] * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  const radiusKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  const coords: [number, number][] = []
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI
    const dLat2 = (radiusKm / R) * Math.cos(angle)
    const dLon2 = (radiusKm / R) * Math.sin(angle) / Math.cos((center[1] * Math.PI) / 180)
    coords.push([
      center[0] + (dLon2 * 180) / Math.PI,
      center[1] + (dLat2 * 180) / Math.PI
    ])
  }
  // Close the ring
  coords.push(coords[0])
  return coords
}

/** Build a GeoJSON Feature for the current preview shape. */
function buildPreviewGeoJSON(points: [number, number][], shapeType: DrawShapeType): GeoJSON.Feature {
  if (points.length === 0) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: {} }
  }

  if (shapeType === 'circle' && points.length === 2) {
    const polygon = circleToPolygon(points[0], points[1])
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [polygon] },
      properties: {}
    }
  }

  if (shapeType === 'rectangle' && points.length === 2) {
    const [p1, p2] = points
    const rect: [number, number][] = [
      [p1[0], p1[1]],
      [p2[0], p1[1]],
      [p2[0], p2[1]],
      [p1[0], p2[1]],
      [p1[0], p1[1]]
    ]
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [rect] },
      properties: {}
    }
  }

  if (shapeType === 'polygon' && points.length >= 2) {
    const closed = [...points, points[0]]
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closed] },
      properties: {}
    }
  }

  // Not enough points yet — show a line
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points },
    properties: {}
  }
}

function buildVertexGeoJSON(points: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: p },
      properties: {}
    }))
  }
}

/** Get the final polygon coordinates from the drawn shape. */
function getFinalCoordinates(shapeType: DrawShapeType, points: [number, number][]): [number, number][] {
  if (shapeType === 'circle' && points.length === 2) {
    return circleToPolygon(points[0], points[1])
  }
  if (shapeType === 'rectangle' && points.length === 2) {
    const [p1, p2] = points
    return [
      [p1[0], p1[1]],
      [p2[0], p1[1]],
      [p2[0], p2[1]],
      [p1[0], p2[1]]
    ]
  }
  // polygon — remove closing point if present
  if (points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first[0] === last[0] && first[1] === last[1]) {
      return points.slice(0, -1)
    }
  }
  return points
}

function bannerForShape(type: DrawShapeType, pointCount: number): string {
  switch (type) {
    case 'circle':
      return pointCount === 0
        ? '✏️ Click to place the circle center'
        : '✏️ Click to set the circle edge (radius)'
    case 'rectangle':
      return pointCount === 0
        ? '✏️ Click to place the first corner'
        : '✏️ Click to place the opposite corner'
    case 'polygon':
      return pointCount < 3
        ? `✏️ Click to add vertices (${pointCount}/3 min). Double-click to finish.`
        : '✏️ Click to add more vertices. Double-click to finish.'
    default:
      return '✏️ Drawing...'
  }
}

// ── Component ────────────────────────────────────────────────

interface MapDrawLayerProps {
  map: MapboxMap
}

export function MapDrawLayer({ map }: MapDrawLayerProps): null {
  const drawRef = useRef<DrawState | null>(null)
  const callbacksRef = useRef<DrawCallbacks | null>(null)
  const prevCursorRef = useRef<string>('')

  const showBanner = (msg: string | null): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (window as any).__alertDrawBanner
    if (fn) fn(msg)
  }

  /** Clean up all draw sources and layers from the map. */
  const cleanupDraw = (): void => {
    try {
      if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID)
      if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID)
      if (map.getLayer(VERTEX_LAYER_ID)) map.removeLayer(VERTEX_LAYER_ID)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      if (map.getSource(VERTEX_SOURCE_ID)) map.removeSource(VERTEX_SOURCE_ID)
    } catch {
      /* ignore */
    }
  }

  /** Add or update the preview layers on the map. */
  const updatePreview = (): void => {
    const draw = drawRef.current
    if (!draw) return

    const geojson = buildPreviewGeoJSON(draw.points, draw.shapeType)
    const vertexGeojson = buildVertexGeoJSON(draw.points)

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson })
    } else {
      ;(map.getSource(SOURCE_ID) as GeoJSONSource).setData(geojson)
    }

    if (!map.getSource(VERTEX_SOURCE_ID)) {
      map.addSource(VERTEX_SOURCE_ID, { type: 'geojson', data: vertexGeojson })
    } else {
      ;(map.getSource(VERTEX_SOURCE_ID) as GeoJSONSource).setData(vertexGeojson)
    }

    if (!map.getLayer(LINE_LAYER_ID)) {
      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2,
          'line-dasharray': [3, 2]
        }
      })
    }

    if (!map.getLayer(FILL_LAYER_ID)) {
      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': '#f59e0b',
          'fill-opacity': 0.08
        }
      })
    }

    if (!map.getLayer(VERTEX_LAYER_ID)) {
      map.addLayer({
        id: VERTEX_LAYER_ID,
        type: 'circle',
        source: VERTEX_SOURCE_ID,
        paint: {
          'circle-radius': 4,
          'circle-color': '#f59e0b',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff'
        }
      })
    }
  }

  /** Re-enable map interactions after drawing. */
  const enableMapInteractions = (): void => {
    map.dragPan.enable()
    map.dragRotate.enable()
    map.touchZoomRotate.enable()
    map.doubleClickZoom.enable()
  }

  /** Cancel the current draw operation. */
  const cancelDraw = (): void => {
    drawRef.current = null
    callbacksRef.current = null
    cleanupDraw()
    map.getCanvas().style.cursor = prevCursorRef.current
    showBanner(null)
    map.off('mousedown', handleClick)
    map.off('dblclick', handleDblClick)
    enableMapInteractions()
  }

  /** Finish the draw operation and send results. */
  const finishDraw = (): void => {
    const draw = drawRef.current
    const callbacks = callbacksRef.current
    if (!draw || !callbacks) {
      cancelDraw()
      return
    }

    // Validate minimum points
    let minPoints = 0
    if (draw.shapeType === 'circle' || draw.shapeType === 'rectangle') {
      minPoints = 2
    } else {
      minPoints = 3
    }

    if (draw.points.length < minPoints) {
      cancelDraw()
      return
    }

    const coordinates = getFinalCoordinates(draw.shapeType, draw.points)

    // Don't cleanup the preview — keep it visible so user sees their drawn zone
    // Only restore cursor and remove banner
    map.getCanvas().style.cursor = prevCursorRef.current
    showBanner(null)
    map.off('mousedown', handleClick)
    map.off('dblclick', handleDblClick)

    // Re-enable map interactions
    enableMapInteractions()

    callbacks.onComplete({ coordinates })
    callbacksRef.current = null
    // Don't null out drawRef — keep it for cleanup later
  }

  const handleClick = (e: MapMouseEvent): void => {
    e.preventDefault()
    const draw = drawRef.current
    if (!draw) return

    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    draw.points.push(lngLat)
    updatePreview()

    // Auto-finish for circle and rectangle after 2 clicks
    if ((draw.shapeType === 'circle' || draw.shapeType === 'rectangle') && draw.points.length === 2) {
      finishDraw()
      return
    }

    showBanner(bannerForShape(draw.shapeType, draw.points.length))
  }

  const handleDblClick = (e: MapMouseEvent): void => {
    e.preventDefault()
    const draw = drawRef.current
    if (!draw || draw.shapeType !== 'polygon') return

    // Remove the extra point added by the second click of dblclick
    if (draw.points.length > 0) {
      draw.points.pop()
    }

    if (draw.points.length >= 3) {
      finishDraw()
    }
  }

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      const callbacks = callbacksRef.current
      cancelDraw()
      if (callbacks) callbacks.onCancel()
    }
  }

  /** Start a draw operation. Called from window.__alertDrawStart. */
  const startDraw = (
    type: DrawShapeType,
    onComplete: (result: { coordinates: [number, number][] }) => void,
    onCancel: () => void
  ): void => {
    // Cancel any existing draw AND clean up any leftover preview
    cleanupDraw()
    cancelDraw()

    // Disable map interactions so clicks always register
    map.dragPan.disable()
    map.dragRotate.disable()
    map.touchZoomRotate.disable()
    map.doubleClickZoom.disable()

    prevCursorRef.current = map.getCanvas().style.cursor
    map.getCanvas().style.cursor = 'crosshair'

    drawRef.current = {
      active: true,
      shapeType: type,
      points: [],
      previewSource: SOURCE_ID,
      previewLayerFill: FILL_LAYER_ID,
      previewLayerLine: LINE_LAYER_ID,
      vertexSource: VERTEX_SOURCE_ID,
      vertexLayer: VERTEX_LAYER_ID
    }

    callbacksRef.current = { onComplete, onCancel }

    map.on('mousedown', handleClick)
    map.on('dblclick', handleDblClick)

    showBanner(bannerForShape(type, 0))
  }

  useEffect(() => {
    // Register the global draw start API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__alertDrawStart = startDraw

    // Register global cleanup API for AlertRulesPanel to call
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__alertDrawCleanup = () => {
      cleanupDraw()
      cancelDraw()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      cancelDraw()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__alertDrawStart = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__alertDrawCleanup = null
      window.removeEventListener('keydown', handleKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}