import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { installMapboxEventsFetchSilencer } from '../../lib/mapboxEventsSilencer'
import { setBriefHandler } from '../../lib/mapBrief'
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

const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'
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

type ProjectionName = 'globe' | 'mercator'

interface SituationMapProps {
  layers?: LayerVisibility
}

export function SituationMap({ layers }: SituationMapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const briefPopupRef = useRef<mapboxgl.Popup | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [drawBanner, setDrawBanner] = useState<string | null>(null)

  const token = import.meta.env.VITE_MAPBOX_TOKEN?.trim() ?? ''

  useEffect(() => {
    if (!token || !containerRef.current) return

    const restoreFetch = installMapboxEventsFetchSilencer()

    mapboxgl.accessToken = token

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: true
    })

    mapRef.current = map
    ;(window as any).__map = map
    // Register draw banner callback for MapDrawLayer
    ;(window as any).__alertDrawBanner = (msg: string | null) => setDrawBanner(msg)

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')

    let globeApplied = false
    const applyGlobeAndView = (): void => {
      if (globeApplied) return
      globeApplied = true
      map.setProjection({ name: 'mercator' })
      // Fog only applied when user switches to globe via handleProjectionChange
      setMapReady(true)
    }

    map.on('style.load', applyGlobeAndView)

    map.on('mousemove', (e: mapboxgl.MapMouseEvent) => {
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
      map.off('style.load', applyGlobeAndView)
      map.remove()
      mapRef.current = null
      ;(window as any).__map = null
      ;(window as any).__alertDrawBanner = null
      ;(window as any).__alertDrawStart = null
      setDrawBanner(null)
      setMapReady(false)
      restoreFetch()
    }
  }, [token])

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

  // ── Register the brief handler so popup buttons can trigger AI briefs ──
  useEffect(() => {
    setBriefHandler(async (type, data) => {
      const map = mapRef.current
      if (!map) return

      const coords: [number, number] = [
        (data.lon as number) ?? 0,
        (data.lat as number) ?? 0
      ]

      // Show loading popup immediately
      if (briefPopupRef.current) briefPopupRef.current.remove()
      briefPopupRef.current = new mapboxgl.Popup({
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
    })
  }, [mapReady])

  if (!token) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 p-6 text-center">
        <p className="text-sm font-medium text-zinc-300">Mapbox token missing</p>
        <p className="max-w-sm text-xs text-zinc-500">
          Add{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">VITE_MAPBOX_TOKEN</code>{' '}
          to <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">.env</code> at the
          project root, then restart{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">npm run dev</code>.
        </p>
      </div>
    )
  }

  const showAdsb = layers?.adsb ?? true
  const showAis = layers?.ais ?? true
  const showCsg = layers?.csg ?? true
  const showIntel = layers?.intel ?? true
  const showGfw = layers?.gfw ?? true
  const showCorridors = layers?.corridors ?? false
  const showRegions = layers?.regions ?? false

  // Read settings for military-only filter, clustering, etc.
  const [showAllFlights, setShowAllFlights] = useState(true)
  const [showAllVessels, setShowAllVessels] = useState(true)
  const [clustering, setClustering] = useState(true)
  const [projection, setProjection] = useState<ProjectionName>('mercator')
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

  const handleProjectionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const p = e.target.value as ProjectionName
      setProjection(p)
      const map = mapRef.current
      if (!map) return
      if (p === 'globe') {
        map.setProjection({ name: 'globe' })
        map.setFog({
          color: 'rgb(12, 12, 20)',
          'high-color': 'rgb(36, 92, 223)',
          'horizon-blend': 0.08,
          'space-color': 'rgb(10, 10, 18)',
          'star-intensity': 0.12
        })
      } else {
        map.setProjection({ name: 'mercator' })
        map.setFog(undefined)
      }
    },
    []
  )

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
        .brief-popup .mapboxgl-popup-content {
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
        <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
          <select
            value={projection}
            onChange={handleProjectionChange}
            className="h-7 rounded border border-zinc-700/60 bg-zinc-900/80 px-2 text-[11px] text-zinc-300 backdrop-blur-sm outline-none transition-colors hover:border-zinc-600 focus:border-zinc-500"
          >
            <option value="globe">🌐 Globe</option>
            <option value="mercator">🗺 Mercator</option>
          </select>
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
          <div className="absolute bottom-2 left-2 z-10 rounded bg-zinc-900/80 px-2 py-1 text-[10px] text-zinc-400 backdrop-blur-sm font-mono pointer-events-none">
            {Math.abs(cursorCoords.lat).toFixed(2)}°{cursorCoords.lat >= 0 ? 'N' : 'S'}, {Math.abs(cursorCoords.lng).toFixed(2)}°{cursorCoords.lng >= 0 ? 'E' : 'W'}
          </div>
        )}
      </div>
      {mapReady && mapRef.current && (
        <ConflictZoneLayer map={mapRef.current} visible={true} />
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

      {/* Draw mode banner */}
      {drawBanner && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 rounded-lg border border-indigo-500/50 bg-indigo-950/90 px-4 py-2 text-xs text-indigo-300 backdrop-blur-sm shadow-lg pointer-events-none">
          {drawBanner}
        </div>
      )}
    </div>
  )
}