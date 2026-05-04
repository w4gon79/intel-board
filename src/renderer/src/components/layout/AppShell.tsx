import { useState, useCallback, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { AiAssistantStrip } from './AiAssistantStrip'
import { HeaderBar } from './HeaderBar'
import { IntelFeedPanel } from './IntelFeedPanel'
import { StatusBar } from './StatusBar'
import { LayerControls, type LayerVisibility } from '../map/LayerControls'
import { SituationMap } from '../map/SituationMap'
import { SettingsPanel } from '../settings/SettingsPanel'
import { AIPanel } from '../settings/AIPanel'
import { IntelHighlightProvider } from '../../contexts/IntelHighlightContext'

const DEFAULT_LAYERS: LayerVisibility = {
  adsb: true,
  gfw: true,
  ais: true,
  csg: true,
  intel: true,
  corridors: false,
  regions: false,
  zones: true,
  annotations: true
}

export function AppShell(): React.JSX.Element {
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<'map' | 'intel' | 'ai'>('map')

  const handleToggleLayer = (layer: keyof LayerVisibility): void => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))
  }

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const openAI = useCallback(() => setAiPanelOpen(true), [])
  const closeAI = useCallback(() => setAiPanelOpen(false), [])

  /** Capture the map canvas and send to main process for file save */
  const handleExportMap = useCallback(async () => {
    const map = (window as unknown as Record<string, unknown>).__map as maplibregl.Map | undefined
    if (!map) {
      console.warn('[AppShell] No map instance found for export')
      return
    }

    // Wait for the map to be fully idle before capturing
    await new Promise<void>((resolve) => {
      map.once('idle', () => resolve())
      // Safety timeout in case idle never fires
      setTimeout(resolve, 3000)
    })

    const canvas = map.getCanvas()
    const dataUrl = canvas.toDataURL('image/png')
    const center = map.getCenter()
    const zoom = map.getZoom()

    // Get visible layers list
    const visibleLayers = Object.entries(layers)
      .filter(([, v]) => v)
      .map(([k]) => k)

    try {
      const result = await window.api.export.mapImage({
        imageDataUrl: dataUrl,
        metadata: {
          center: [center.lng, center.lat],
          zoom,
          annotationCount: 0,
          visibleLayers
        }
      })
      if (result.success) {
        console.log('[AppShell] Map exported to:', result.path)
      } else if (!result.canceled) {
        console.warn('[AppShell] Map export failed:', result.error)
      }
    } catch (err) {
      console.error('[AppShell] Map export error:', err)
    }
  }, [layers])

  // Notify main process about window visibility (skip ADS-B polls when minimized)
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      window.api.adsb.setVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Listen for ADS-B credential errors from main process
  useEffect(() => {
    const unsubscribe = window.api.adsb.onCredentialsError((info) => {
      console.warn('[ADSB]', info.message)
    })
    return unsubscribe
  }, [])

  return (
    <IntelHighlightProvider>
    <div className="flex min-h-0 flex-col bg-zinc-950 text-zinc-100 min-h-screen h-[100dvh]">
      <HeaderBar onOpenSettings={openSettings} onOpenAI={openAI} />
      <StatusBar layers={layers} />

      {/* Mobile Tab Bar */}
      <div className="flex shrink-0 border-b border-zinc-800 bg-zinc-900 lg:hidden">
        {(['map', 'intel', 'ai'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              mobileTab === tab
                ? 'border-b-2 border-emerald-500 text-emerald-400'
                : 'text-zinc-500'
            }`}
          >
            {tab === 'map' ? '🗺 Map' : tab === 'intel' ? '📋 Intel' : '💬 AI'}
          </button>
        ))}
      </div>

      {/* Desktop layout — hidden on mobile */}
      <div className="hidden lg:flex flex-col gap-2 p-2 xl:flex-row xl:flex-1 xl:min-h-0 xl:overflow-y-hidden">
        <section
          className="flex min-h-0 min-w-0 flex-col gap-2 lg:flex-row h-[50vh] xl:flex-1 xl:h-auto"
          aria-label="Situation map and layers"
        >
          <LayerControls layers={layers} onToggle={handleToggleLayer} onExportMap={handleExportMap} />
          <div className="min-h-0 min-w-0 flex-1">
            <SituationMap layers={layers} />
          </div>
        </section>
        <IntelFeedPanel />
      </div>

      {/* Mobile layout — visible only on mobile */}
      <div className="relative flex-1 min-h-0 lg:hidden">
        <div className={`absolute inset-0 flex flex-col min-h-0 ${mobileTab === 'map' ? '' : 'hidden'}`}>
          <LayerControls layers={layers} onToggle={handleToggleLayer} />
          <div className="flex-1 min-h-0">
            <SituationMap layers={layers} />
          </div>
        </div>
        <div className={`absolute inset-0 overflow-y-auto ${mobileTab === 'intel' ? '' : 'hidden'}`}>
          <IntelFeedPanel />
        </div>
        <div className={`absolute inset-0 flex flex-col ${mobileTab === 'ai' ? '' : 'hidden'}`}>
          <AiAssistantStrip expanded />
        </div>
      </div>

      {/* Desktop AiAssistantStrip — hidden on mobile */}
      <div className="hidden lg:block">
        <AiAssistantStrip />
      </div>

      <SettingsPanel open={settingsOpen} onClose={closeSettings} />
      <AIPanel open={aiPanelOpen} onClose={closeAI} />
    </div>
    </IntelHighlightProvider>
  )
}
