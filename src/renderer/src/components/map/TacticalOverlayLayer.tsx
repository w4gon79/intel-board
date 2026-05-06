/**
 * TacticalOverlayLayer — Renders saved map annotations on the map.
 * Supports marker, line, polygon, circle, and text annotation types.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import type { MapAnnotation, AnnotationType } from '../../../../shared/types'
import { circleToPolygon } from '../../utils/geometry'
import { AnnotationPopup } from './AnnotationPopup'

const SOURCE_ID = 'tactical-overlay-src'
const LAYER_PREFIX = 'tactical-'

interface TacticalOverlayLayerProps {
  map: maplibregl.Map
  visible: boolean
  activeTool: AnnotationType | 'eraser' | null
  selectedColor: string
  activeLayer: string
  onAnnotationCreated?: (annotation: MapAnnotation) => void
}

export function TacticalOverlayLayer({
  map,
  visible,
  activeTool,
  selectedColor,
  activeLayer,
  onAnnotationCreated
}: TacticalOverlayLayerProps): React.JSX.Element | null {
  const [annotations, setAnnotations] = useState<MapAnnotation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const drawStateRef = useRef<{
    type: AnnotationType
    points: [number, number][]
  } | null>(null)
  const previewLayerIds = useRef<string[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)

  // ── Load annotations from DB ──
  const loadAnnotations = useCallback(async () => {
    try {
      if (window.api?.annotations?.list) {
        const items = await window.api.annotations.list()
        setAnnotations(items)
      }
    } catch (err) {
      console.error('[TacticalOverlay] Failed to load annotations:', err)
    }
  }, [])

  useEffect(() => {
    loadAnnotations()
  }, [loadAnnotations])

  // ── Render annotations as map sources/layers ──
  useEffect(() => {
    if (!visible) {
      // Remove all tactical layers and source
      removeLayers()
      return
    }

    renderAnnotations()

    return () => {
      removeLayers()
    }
  }, [annotations, visible, map])

  function removeLayers(): void {
    const style = map.getStyle()
    if (!style?.layers) return
    for (const layer of style.layers) {
      if (layer.id.startsWith(LAYER_PREFIX)) {
        try { map.removeLayer(layer.id) } catch { /* ignore */ }
      }
    }
    if (map.getSource(SOURCE_ID)) {
      try { map.removeSource(SOURCE_ID) } catch { /* ignore */ }
    }
  }

  function renderAnnotations(): void {
    removeLayers()

    const visibleAnnotations = annotations.filter((a) => a.visible)
    if (visibleAnnotations.length === 0) return

    // Build GeoJSON features grouped by type
    const featuresByType: Record<string, GeoJSON.Feature[]> = {}

    for (const ann of visibleAnnotations) {
      let coords: unknown
      try {
        coords = JSON.parse(ann.coordinates)
      } catch {
        continue
      }

      let feature: GeoJSON.Feature | null = null

      switch (ann.type) {
        case 'marker': {
          const c = coords as [number, number]
          feature = {
            type: 'Feature',
            properties: { id: ann.id, color: ann.color, label: ann.label ?? '', icon: ann.icon ?? '', layer: ann.layer, annotationType: 'marker' },
            geometry: { type: 'Point', coordinates: c }
          }
          break
        }
        case 'text': {
          const c = coords as [number, number]
          feature = {
            type: 'Feature',
            properties: { id: ann.id, color: ann.color, label: ann.label ?? '', layer: ann.layer, annotationType: 'text' },
            geometry: { type: 'Point', coordinates: c }
          }
          break
        }
        case 'line': {
          const c = coords as [number, number][]
          if (c.length < 2) continue
          feature = {
            type: 'Feature',
            properties: { id: ann.id, color: ann.color, label: ann.label ?? '', layer: ann.layer, annotationType: 'line' },
            geometry: { type: 'LineString', coordinates: c }
          }
          break
        }
        case 'polygon': {
          const c = coords as [number, number][]
          if (c.length < 3) continue
          feature = {
            type: 'Feature',
            properties: { id: ann.id, color: ann.color, label: ann.label ?? '', layer: ann.layer, annotationType: 'polygon' },
            geometry: { type: 'Polygon', coordinates: [c.concat([c[0]])] }
          }
          break
        }
        case 'circle': {
          const c = coords as { center: [number, number]; radius: number }
          const ring = circleToPolygon(c.center, c.radius)
          feature = {
            type: 'Feature',
            properties: { id: ann.id, color: ann.color, label: ann.label ?? '', layer: ann.layer, annotationType: 'circle' },
            geometry: { type: 'Polygon', coordinates: [ring] }
          }
          break
        }
      }

      if (feature) {
        const t = ann.type === 'circle' ? 'polygon' : ann.type === 'marker' ? 'point' : ann.type === 'text' ? 'point' : ann.type
        if (!featuresByType[t]) featuresByType[t] = []
        featuresByType[t].push(feature)
      }
    }

    // Add a combined source for all types
    // We need separate sources for different geometry types
    const pointFeatures = [...(featuresByType['point'] ?? [])]
    const lineFeatures = [...(featuresByType['line'] ?? [])]
    const polygonFeatures = [...(featuresByType['polygon'] ?? [])]

    // Point source (markers + text)
    if (pointFeatures.length > 0) {
      const srcId = `${SOURCE_ID}-points`
      const existingPtSrc = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined
      if (existingPtSrc) {
        existingPtSrc.setData({ type: 'FeatureCollection', features: pointFeatures })
      } else {
        map.addSource(srcId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: pointFeatures }
        })
      }

      // Circle layer for markers
      if (!map.getLayer(`${LAYER_PREFIX}markers`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}markers`,
          type: 'circle',
          source: srcId,
          filter: ['==', ['get', 'annotationType'], 'marker'],
          paint: {
            'circle-radius': 7,
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        })
      }

      // Symbol layer for marker labels
      if (!map.getLayer(`${LAYER_PREFIX}marker-labels`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}marker-labels`,
          type: 'symbol',
          source: srcId,
          filter: ['==', ['get', 'annotationType'], 'marker'],
          layout: {
            'text-field': ['get', 'label'],
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-size': 11,
            'text-allow-overlap': true
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#000000',
            'text-halo-width': 1
          }
        })
      }

      // Symbol layer for text annotations
      if (!map.getLayer(`${LAYER_PREFIX}text`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}text`,
          type: 'symbol',
          source: srcId,
          filter: ['==', ['get', 'annotationType'], 'text'],
          layout: {
            'text-field': ['get', 'label'],
            'text-anchor': 'center',
            'text-size': 14,
            'text-allow-overlap': true
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#000000',
            'text-halo-width': 1.5
          }
        })
      }
    }

    // Line source
    if (lineFeatures.length > 0) {
      const srcId = `${SOURCE_ID}-lines`
      const existingLineSrc = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined
      if (existingLineSrc) {
        existingLineSrc.setData({ type: 'FeatureCollection', features: lineFeatures })
      } else {
        map.addSource(srcId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: lineFeatures }
        })
      }

      if (!map.getLayer(`${LAYER_PREFIX}lines`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}lines`,
          type: 'line',
          source: srcId,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 0.9
          }
        })
      }

      // Line labels
      if (!map.getLayer(`${LAYER_PREFIX}line-labels`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}line-labels`,
          type: 'symbol',
          source: srcId,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 11,
            'symbol-placement': 'line' as const,
            'text-allow-overlap': true
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#000000',
            'text-halo-width': 1
          }
        })
      }
    }

    // Polygon source
    if (polygonFeatures.length > 0) {
      const srcId = `${SOURCE_ID}-polygons`
      const existingPolySrc = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined
      if (existingPolySrc) {
        existingPolySrc.setData({ type: 'FeatureCollection', features: polygonFeatures })
      } else {
        map.addSource(srcId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: polygonFeatures }
        })
      }

      if (!map.getLayer(`${LAYER_PREFIX}polygon-fill`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}polygon-fill`,
          type: 'fill',
          source: srcId,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.15
          }
        })
      }

      if (!map.getLayer(`${LAYER_PREFIX}polygon-border`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}polygon-border`,
          type: 'line',
          source: srcId,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': 0.8
          }
        })
      }

      // Polygon labels at centroid
      if (!map.getLayer(`${LAYER_PREFIX}polygon-labels`)) {
        map.addLayer({
          id: `${LAYER_PREFIX}polygon-labels`,
          type: 'symbol',
          source: srcId,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-allow-overlap': true
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#000000',
            'text-halo-width': 1
          }
        })
      }
    }
  }

  // ── Handle click for selection ──
  useEffect(() => {
    if (!visible) return

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // Check if we clicked on an annotation
      const features = map.queryRenderedFeatures(e.point, {
        layers: [
          `${LAYER_PREFIX}markers`,
          `${LAYER_PREFIX}text`,
          `${LAYER_PREFIX}lines`,
          `${LAYER_PREFIX}polygon-fill`,
          `${LAYER_PREFIX}polygon-border`
        ].filter((id) => map.getLayer(id))
      })

      if (features.length > 0) {
        const feature = features[0]
        const annId = feature.properties?.id as string
        if (annId) {
          if (activeTool === 'eraser') {
            // Delete annotation
            handleDelete(annId)
            return
          }
          setSelectedId(annId)
          showPopup(annId, e.lngLat)
        }
      } else {
        setSelectedId(null)
        if (popupRef.current) {
          popupRef.current.remove()
          popupRef.current = null
        }
      }
    }

    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [visible, annotations, activeTool])

  // ── Show popup for selected annotation ──
  function showPopup(annId: string, lngLat: maplibregl.LngLat): void {
    if (popupRef.current) {
      popupRef.current.remove()
    }

    const ann = annotations.find((a) => a.id === annId)
    if (!ann) return

    const popupNode = document.createElement('div')
    popupNode.id = `annotation-popup-${annId}`

    popupRef.current = new maplibregl.Popup({
      offset: 15,
      closeButton: true,
      maxWidth: '280px',
      className: 'annotation-popup'
    })
      .setLngLat(lngLat)
      .setDOMContent(popupNode)
      .addTo(map)
  }

  // ── Handle delete ──
  async function handleDelete(id: string): Promise<void> {
    try {
      if (window.api?.annotations?.delete) await window.api.annotations.delete(id)
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
      setSelectedId(null)
      await loadAnnotations()
    } catch (err) {
      console.error('[TacticalOverlay] Delete failed:', err)
    }
  }

  // ── Handle save (from popup) ──
  async function handleSave(id: string, updates: Partial<MapAnnotation>): Promise<void> {
    try {
      if (window.api?.annotations?.update) await window.api.annotations.update(id, updates)
      await loadAnnotations()
    } catch (err) {
      console.error('[TacticalOverlay] Update failed:', err)
    }
  }

  // ── Drawing interaction ──
  useEffect(() => {
    if (!activeTool || activeTool === 'eraser' || !visible) {
      map.getCanvas().style.cursor = ''
      drawStateRef.current = null
      clearPreview()
      return
    }

    map.getCanvas().style.cursor = 'crosshair'

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const point: [number, number] = [e.lngLat.lng, e.lngLat.lat]

      if (activeTool === 'marker' || activeTool === 'text') {
        // Single click places marker/text
        createAnnotation(activeTool, [point])
        return
      }

      if (!drawStateRef.current) {
        drawStateRef.current = { type: activeTool, points: [point] }
        if (activeTool !== 'circle') {
          showPreview([point])
        }
      } else {
        const state = drawStateRef.current
        if (state.type === 'circle') {
          // Second click = edge point → create circle
          const center = state.points[0]
          const radius = Math.sqrt(
            Math.pow(point[0] - center[0], 2) + Math.pow(point[1] - center[1], 2)
          ) * 111.32 * Math.cos((center[1] * Math.PI) / 180) // approx km
          createAnnotation('circle', [{ center, radius } as unknown as [number, number]])
          drawStateRef.current = null
          clearPreview()
        } else {
          // Add point to line/polygon
          state.points.push(point)
          showPreview(state.points)
        }
      }
    }

    const handleDblClick = (e: maplibregl.MapMouseEvent & maplibregl.MapMouseEvent): void => {
      if (!drawStateRef.current) return
      const state = drawStateRef.current
      if (state.type === 'line' && state.points.length >= 2) {
        createAnnotation('line', state.points)
      } else if (state.type === 'polygon' && state.points.length >= 3) {
        createAnnotation('polygon', state.points)
      }
      drawStateRef.current = null
      clearPreview()
      e.preventDefault()
    }

    const handleMouseMove = (e: maplibregl.MapMouseEvent): void => {
      if (!drawStateRef.current) return
      const state = drawStateRef.current
      if (state.type === 'circle') {
        const center = state.points[0]
        const edge: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        showCirclePreview(center, edge)
      } else {
        const pts = [...state.points, [e.lngLat.lng, e.lngLat.lat] as [number, number]]
        showPreview(pts)
      }
    }

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)
    map.on('mousemove', handleMouseMove)

    return () => {
      map.off('click', handleClick)
      map.off('dblclick', handleDblClick)
      map.off('mousemove', handleMouseMove)
      map.getCanvas().style.cursor = ''
      drawStateRef.current = null
      clearPreview()
    }
  }, [activeTool, visible, selectedColor, activeLayer])

  // ── Preview drawing ──
  function showPreview(points: [number, number][]): void {
    clearPreview()
    if (points.length < 1) return

    const srcId = `${SOURCE_ID}-preview`
    let geojson: GeoJSON.GeoJSON

    if (points.length === 1) {
      geojson = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: points[0] }
        }]
      }
    } else if (drawStateRef.current?.type === 'polygon') {
      geojson = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [points.concat([points[0]])] }
        }]
      }
    } else {
      geojson = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: points }
        }]
      }
    }

    if (map.getSource(srcId)) {
      ;(map.getSource(srcId) as maplibregl.GeoJSONSource).setData(geojson)
    } else {
      map.addSource(srcId, { type: 'geojson', data: geojson })
    }

    const lineId = `${LAYER_PREFIX}preview-line`
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': selectedColor,
          'line-width': 2,
          'line-dasharray': [3, 3]
        }
      })
      previewLayerIds.current.push(lineId)
    }

    const fillId = `${LAYER_PREFIX}preview-fill`
    if (drawStateRef.current?.type === 'polygon' && points.length >= 3 && !map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        paint: {
          'fill-color': selectedColor,
          'fill-opacity': 0.1
        }
      })
      previewLayerIds.current.push(fillId)
    }

    // Vertex markers
    for (let i = 0; i < points.length; i++) {
      const vertexId = `${LAYER_PREFIX}preview-vertex-${i}`
      if (map.getSource(`${srcId}-v${i}`)) continue
      map.addSource(`${srcId}-v${i}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: points[i] }
        }
      })
      map.addLayer({
        id: vertexId,
        type: 'circle',
        source: `${srcId}-v${i}`,
        paint: {
          'circle-radius': 4,
          'circle-color': selectedColor,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff'
        }
      })
      previewLayerIds.current.push(vertexId)
    }
  }

  function showCirclePreview(center: [number, number], edge: [number, number]): void {
    clearPreview()
    const radiusKm = Math.sqrt(
      Math.pow(edge[0] - center[0], 2) + Math.pow(edge[1] - center[1], 2)
    ) * 111.32 * Math.cos((center[1] * Math.PI) / 180)
    const ring = circleToPolygon(center, radiusKm)
    const srcId = `${SOURCE_ID}-preview`
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] }
      }]
    }

    if (map.getSource(srcId)) {
      ;(map.getSource(srcId) as maplibregl.GeoJSONSource).setData(geojson)
    } else {
      map.addSource(srcId, { type: 'geojson', data: geojson })
    }

    const lineId = `${LAYER_PREFIX}preview-line`
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': selectedColor,
          'line-width': 2,
          'line-dasharray': [3, 3]
        }
      })
      previewLayerIds.current.push(lineId)
    }

    const fillId = `${LAYER_PREFIX}preview-fill`
    if (!map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        paint: {
          'fill-color': selectedColor,
          'fill-opacity': 0.1
        }
      })
      previewLayerIds.current.push(fillId)
    }

    // Center marker
    const cSrcId = `${srcId}-center`
    if (!map.getSource(cSrcId)) {
      map.addSource(cSrcId, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: center } }
      })
      map.addLayer({
        id: `${LAYER_PREFIX}preview-center`,
        type: 'circle',
        source: cSrcId,
        paint: { 'circle-radius': 4, 'circle-color': selectedColor, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' }
      })
      previewLayerIds.current.push(`${LAYER_PREFIX}preview-center`)
    }
  }

  function clearPreview(): void {
    for (const layerId of previewLayerIds.current) {
      try { map.removeLayer(layerId) } catch { /* ignore */ }
    }
    previewLayerIds.current = []

    // Remove preview sources
    const srcId = `${SOURCE_ID}-preview`
    try { map.removeSource(srcId) } catch { /* ignore */ }
    try { map.removeSource(`${srcId}-center`) } catch { /* ignore */ }
    for (let i = 0; i < 50; i++) {
      try { map.removeSource(`${srcId}-v${i}`) } catch { break }
    }
  }

  // ── Create annotation via IPC ──
  async function createAnnotation(type: AnnotationType, points: [number, number][]): Promise<void> {
    let coordinates: string
    switch (type) {
      case 'marker':
      case 'text':
        coordinates = JSON.stringify(points[0])
        break
      case 'line':
        coordinates = JSON.stringify(points)
        break
      case 'polygon':
        coordinates = JSON.stringify(points)
        break
      case 'circle': {
        const data = points[0] as unknown as { center: [number, number]; radius: number }
        coordinates = JSON.stringify(data)
        break
      }
      default:
        return
    }

    try {
      if (window.api?.annotations?.create) {
        const ann = await window.api.annotations.create({
          type,
          coordinates,
          color: selectedColor,
          label: null,
          description: null,
          icon: type === 'marker' ? '📍' : null,
          layer: activeLayer || 'default',
          visible: true
        })
        onAnnotationCreated?.(ann)
        await loadAnnotations()
      }
    } catch (err) {
      console.error('[TacticalOverlay] Create failed:', err)
    }
  }

  // ── Render popup for selected annotation ──
  const selectedAnnotation = annotations.find((a) => a.id === selectedId)

  return (
    <>
      <style>{`
        .annotation-popup .maplibregl-popup-content {
          background: #18181b;
          border: 1px solid #f59e0b;
          border-radius: 8px;
          padding: 0;
          min-width: 240px;
        }
        .annotation-popup button.maplibregl-popup-close-button {
          color: #a1a1aa;
          font-size: 18px;
          right: 6px;
          top: 4px;
        }
      `}</style>
      {selectedAnnotation && popupRef.current && (
        <AnnotationPopup
          key={selectedAnnotation.id}
          annotation={selectedAnnotation}
          onSave={(updates) => handleSave(selectedAnnotation.id, updates)}
          onDelete={() => handleDelete(selectedAnnotation.id)}
          onClose={() => {
            setSelectedId(null)
            if (popupRef.current) {
              popupRef.current.remove()
              popupRef.current = null
            }
          }}
        />
      )}
    </>
  )
}