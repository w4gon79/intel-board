import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// mapBrief global is removed – handlers are stored per-map instance
import ConflictZoneLayer from './ConflictZoneLayer'
import FlightLayer from './FlightLayer'
import ShipLayer from './ShipLayer'
import CarrierLayer from './CarrierLayer'
import IntelLayer from './IntelLayer'
import UnifiedMapPopup from './UnifiedMapPopup'
import GfwLayer from './GfwLayer'
import { TransitCorridorLayer } from './TransitCorridorLayer'
import { RegionLayer } from './RegionLayer'
import { MapDrawLayer } from './MapDrawLayer'
import { AlertZoneLayer } from './AlertZoneLayer'
import type { LayerVisibility } from './LayerControls'
import { TacticalOverlayLayer } from './TacticalOverlayLayer'
import { AnnotationToolbar } from './AnnotationToolbar'
import type { AnnotationType } from '../../../../shared/types'


/** CARTO dark basemap tiles – free, no API key, dark theme. */
const MAP_STYLE = {
  version: 8 as const,
  sources: {
    'osm-tiles': {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster' as const,
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19
    }
  ]
}

/** Center: Eastern Mediterranean / broader MENA (PRD-style "situation" view). */
const DEFAULT_CENTER: [number, number] = [28, 22]
const DEFAULT_ZOOM = 1.5

const REGIONS: Record<string, { label: string; center: [number, number]; zoom: number }> = {
  global:   { label: 'Global',         center: [10, 20],    zoom: 1.5 },
  americas: { label: 'Americas',       center: [-90, 25],   zoom: 3 },
  mena:     { label: 'MENA',           center: [45, 28],    zoom: 3.5 },
  europe:   { label: 'Europe',         center: [15, 50],    zoom: 3.5 },
  asia:     { label: 'Asia',           center: [100, 35],   zoom: 3 },
  latam:    { label: 'Latin America',  center: [-60, -15],  zoom: 3 },
  africa:   { label: 'Africa',         center: [20, 5],     zoom: 3 },
  oceania:  { label: 'Oceania',        center: [135, -25],  zoom: 3.5 }
}

interface SituationMapProps {
  layers?: LayerVisibility
}

export function SituationMap({ layers }: SituationMapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const briefPopupRef = useRef<maplibregl.Popup | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [drawBanner, setDrawBanner] = useState<string | null>(null)
  const [annotationTool, setAnnotationTool] = useState<AnnotationType | 'eraser' | null>(null)
  const [annotationColor, setAnnotationColor] = useState('#f59e0b')
  const [annotationLayer, setAnnotationLayer] = useState('default')


  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: undefined,
      preserveDrawingBuffer: true
    } as maplibregl.MapOptions)

    mapRef.current = map
    // Store map in per-instance array so the export handler can find the
    // VISIBLE (desktop) map even when two SituationMaps are mounted.
    if (!(window as any).__maps) (window as any).__maps = []
    ;(window as any).__maps.push({ map, container: containerRef.current })
    // Register draw banner callback for MapDrawLayer
    ;(window as any).__alertDrawBanner = (msg: string | null) => setDrawBanner(msg)

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      setMapReady(true)
    })

    map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
      setCursorCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    map.on('mouseout', () => {
      setCursorCoords(null)
    })

    const resize = (): void => {
      map.resize()
    }
    window.addEventListener('resize', resize)
    const ro = new ResizeObserver(resize)
    ro.observe(containerRef.current)
    requestAnimationFrame(resize)

    return () => {
      window.removeEventListener('resize', resize)
      ro.disconnect()
      map.remove()
      mapRef.current = null
      // Remove this instance from the maps array
      ;(window as any).__maps = ((window as any).__maps || []).filter(
        (m: any) => m.map !== map
      )
      ;(window as any).__alertDrawBanner = null
      ;(window as any).__alertDrawStart = null
      setDrawBanner(null)
      setMapReady(false)
    }
  }, [])

  // ── Inject spinner animation CSS once ──
  useEffect(() => {
    if (!document.getElementById('brief-spinner-style')) {
      const style = document.createElement('style')
      style.id = 'brief-spinner-style'
      style.textContent = `
        @keyframes brief-spin {
          to { transform: rotate(360deg); }
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  // ── Register the brief handler PER MAP INSTANCE (not global singleton) ──
  // Two SituationMaps render (desktop + mobile). A singleton handler would
  // be overwritten by whichever mounts last, pointing at the wrong map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(map as any).__briefHandler = async (type: string, data: Record<string, unknown>) => {

      const coords: [number, number] = [
        (data.lon as number) ?? 0,
        (data.lat as number) ?? 0
      ]

      // Show loading popup immediately
      if (briefPopupRef.current) briefPopupRef.current.remove()
      briefPopupRef.current = new maplibregl.Popup({
        offset: 25,
        closeButton: true,
        maxWidth: '350px',
        className: 'brief-popup'
      })
        .setLngLat(coords)
        .setHTML(`
          <div style="display:flex;align-items:center;gap:8px;color:#60a5fa;font-size:12px;padding:4px 0">
            <div class="brief-spinner" style="
              width:16px;height:16px;border:2px solid #333;border-top-color:#60a5fa;
              border-radius:50%;animation:brief-spin 0.8s linear infinite;
            "></div>
            <span>Generating intelligence brief...</span>
          </div>
        `)
        .addTo(map)

      try {
        // Try Electron IPC first, fall back to HTTP API for browser access
        let result: { success: boolean; answer: string }
        if (window.api?.ai?.brief) {
          result = await window.api.ai.brief({ type, data })
        } else {
          const response = await fetch('/api/ai/brief', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, data })
          })
          result = await response.json()
        }

        if (result.success) {
          // Replace loading with actual brief
          briefPopupRef.current.setHTML(`
            <div style="font-size:12px;max-height:300px;overflow-y:auto;line-height:1.5;color:#e4e4e7">
              <div style="font-weight:bold;margin-bottom:6px;color:#60a5fa">🔍 Intelligence Brief</div>
              ${result.answer.replace(/\n/g, '<br/>')}
            </div>
          `)
        } else {
          briefPopupRef.current.setHTML(`
            <div style="font-size:12px;color:#f87171;padding:4px 0">❌ ${result.answer}</div>
          `)
        }
      } catch (err) {
        console.error('[SituationMap] Brief failed:', err)
        briefPopupRef.current.setHTML(`
          <div style="font-size:12px;color:#f87171;padding:4px 0">❌ Brief generation failed. Try again.</div>
        `)
      }
    }
    return () => { (map as any).__briefHandler = null }
  }, [mapReady])

  const showAdsb = layers?.adsb ?? true
  const showAis = layers?.ais ?? true
  const showCsg = layers?.csg ?? true
  const showIntel = layers?.intel ?? true
  const showGfw = layers?.gfw ?? true
  const showCorridors = layers?.corridors ?? false
  const showRegions = layers?.regions ?? false
  const showZones = layers?.zones ?? true
  const showAnnotations = layers?.annotations ?? true

  // Read settings for military-only filter, clustering, etc.
  const [showAllFlights, setShowAllFlights] = useState(true)
  const [showAllVessels, setShowAllVessels] = useState(true)
  const [clustering, setClustering] = useState(true)
  const [region, setRegion] = useState('global')

  const refreshSettings = useCallback(() => {
    window.api.settings
      .get()
      .then((s) => {
        const newClustering = s.map?.clustering !== false
        console.log(`[SituationMap] refreshSettings: clustering=${newClustering}, militaryOnly=${s.map?.militaryOnly}`)
        setShowAllFlights(!s.map?.militaryOnly)
        setShowAllVessels(!s.map?.militaryOnly)
        setClustering(newClustering)
      })
      .catch(() => {
        /* ignore */
      })
  }, [])

  const handleRegionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const key = e.target.value
      setRegion(key)
      const r = REGIONS[key]
      if (!r) return
      mapRef.current?.flyTo({ center: r.center, zoom: r.zoom, duration: 1500 })
    },
    []
  )

  // Poll settings + listen for immediate refresh on save
  useEffect(() => {
    refreshSettings()
    const interval = setInterval(refreshSettings, 10_000)

    const handleSettingsChanged = (): void => {
      console.log('[SituationMap] Settings changed event — refreshing')
      refreshSettings()
    }
    window.addEventListener('settings-changed', handleSettingsChanged)

    return () => {
      clearInterval(interval)
      window.removeEventListener('settings-changed', handleSettingsChanged)
    }
  }, [refreshSettings])

  return (
    <div className="relative z-50 h-full min-h-[240px] w-full min-w-0">
      {/* ── Brief popup styling ── */}
      <style>{`
        .brief-popup .maplibregl-popup-content {
          background: #18181b;
          border: 1px solid #2563eb;
          border-radius: 8px;
          padding: 12px;
        }
        .brief-popup button:hover {
          opacity: 0.8;
        }
      `}</style>
      {/* ── Map overlay controls (top-left) ── */}
      {mapReady && (
        <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5 export-exclude">
          <select
            value={region}
            onChange={handleRegionChange}
            className="h-7 rounded border border-zinc-700/60 bg-zinc-900/80 px-2 text-[11px] text-zinc-300 backdrop-blur-sm outline-none transition-colors hover:border-zinc-600 focus:border-zinc-500"
          >
            {Object.entries(REGIONS).map(([key, r]) => (
              <option key={key} value={key}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
        role="application"
        aria-label="Situation map"
      >
        {cursorCoords && (
          <div className="absolute bottom-2 left-2 z-10 rounded bg-zinc-900/80 px-2 py-1 text-[10px] text-zinc-400 backdrop-blur-sm font-mono pointer-events-none export-exclude">
            {Math.abs(cursorCoords.lat).toFixed(2)}°{cursorCoords.lat >= 0 ? 'N' : 'S'}, {Math.abs(cursorCoords.lng).toFixed(2)}°{cursorCoords.lng >= 0 ? 'E' : 'W'}
          </div>
        )}
      </div>
      {mapReady && mapRef.current && (
        <ConflictZoneLayer map={mapRef.current} visible={showZones} />
      )}
      {mapReady && mapRef.current && (
        // Unique key per layer forces remount when clustering changes
        // so the source is re-created with correct cluster:true/false
        <FlightLayer
          key={`flights-${clustering}`}
          map={mapRef.current}
          visible={showAdsb}
          showAll={showAllFlights}
          clustering={clustering}
        />
      )}
      {mapReady && mapRef.current && (
        <ShipLayer
          key={`ships-${clustering}`}
          map={mapRef.current}
          visible={showAis}
          showAll={showAllVessels}
          clustering={clustering}
        />
      )}
      {mapReady && mapRef.current && <CarrierLayer map={mapRef.current} visible={showCsg} />}
      {mapReady && mapRef.current && <GfwLayer map={mapRef.current} visible={showGfw} />}
      {/* RegionLayer renders BEFORE TransitCorridorLayer so corridors are on top (z-order) */}
      {mapReady && mapRef.current && <RegionLayer map={mapRef.current} visible={showRegions} />}
      {mapReady && mapRef.current && <TransitCorridorLayer map={mapRef.current} visible={showCorridors} />}
      {mapReady && mapRef.current && <IntelLayer map={mapRef.current} visible={showIntel} />}
      {mapReady && mapRef.current && <UnifiedMapPopup map={mapRef.current} />}
      {mapReady && mapRef.current && (
        <MapDrawLayer map={mapRef.current} />
      )}
      {mapReady && mapRef.current && (
        <AlertZoneLayer map={mapRef.current} />
      )}

      {/* Tactical Overlay — Annotations */}
      {mapReady && mapRef.current && (
        <TacticalOverlayLayer
          map={mapRef.current}
          visible={showAnnotations}
          activeTool={annotationTool}
          selectedColor={annotationColor}
          activeLayer={annotationLayer}
        />
      )}

      {/* Annotation Toolbar */}
      <AnnotationToolbar
        activeTool={annotationTool}
        onToolChange={setAnnotationTool}
        selectedColor={annotationColor}
        onColorChange={setAnnotationColor}
        activeLayer={annotationLayer}
        onLayerChange={setAnnotationLayer}
        visible={showAnnotations}
      />

      {/* Draw mode banner */}
      {drawBanner && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 rounded-lg border border-indigo-500/50 bg-indigo-950/90 px-4 py-2 text-xs text-indigo-300 backdrop-blur-sm shadow-lg pointer-events-none export-exclude">
          {drawBanner}
        </div>
      )}
    </div>
  )
}