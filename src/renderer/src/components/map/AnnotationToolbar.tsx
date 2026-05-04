/**
 * AnnotationToolbar — Drawing toolbar for tactical overlay annotations.
 * Provides tool selection (marker, line, polygon, circle, text, eraser),
 * color picker, and layer selector.
 */

import { useState } from 'react'
import type { AnnotationType } from '../../../../shared/types'

const PRESET_COLORS = [
  { hex: '#ef4444', label: 'Red' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#22c55e', label: 'Green' },
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#a855f7', label: 'Purple' },
  { hex: '#ffffff', label: 'White' }
]

const PRESET_LAYERS = [
  { name: 'default', color: '#f59e0b' },
  { name: 'friendly', color: '#22c55e' },
  { name: 'hostile', color: '#ef4444' },
  { name: 'objectives', color: '#3b82f6' },
  { name: 'phase-lines', color: '#ffffff' }
]

const TOOLS: { key: AnnotationType | 'eraser'; icon: string; label: string }[] = [
  { key: 'marker', icon: '📍', label: 'Marker' },
  { key: 'line', icon: '📏', label: 'Line' },
  { key: 'polygon', icon: '⬡', label: 'Polygon' },
  { key: 'circle', icon: '⭕', label: 'Circle' },
  { key: 'text', icon: '📝', label: 'Text' },
  { key: 'eraser', icon: '🗑️', label: 'Eraser' }
]

interface AnnotationToolbarProps {
  activeTool: AnnotationType | 'eraser' | null
  onToolChange: (tool: AnnotationType | 'eraser' | null) => void
  selectedColor: string
  onColorChange: (color: string) => void
  activeLayer: string
  onLayerChange: (layer: string) => void
  visible: boolean
}

export function AnnotationToolbar({
  activeTool,
  onToolChange,
  selectedColor,
  onColorChange,
  activeLayer,
  onLayerChange,
  visible
}: AnnotationToolbarProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)

  if (!visible) return null

  return (
    <div className="absolute left-2.5 top-12 z-10 flex flex-col gap-1.5 export-exclude">
      {/* Tool buttons */}
      <div className="flex items-center gap-0.5 rounded-lg border border-zinc-700/60 bg-zinc-900/90 p-1 backdrop-blur-sm">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            onClick={() => onToolChange(activeTool === tool.key ? null : tool.key)}
            title={tool.label}
            className={`flex h-7 w-7 items-center justify-center rounded text-sm transition-colors ${
              activeTool === tool.key
                ? tool.key === 'eraser'
                  ? 'bg-red-900/80 text-red-300'
                  : 'bg-amber-900/80 text-amber-300'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {tool.icon}
          </button>
        ))}

        {/* Expand/collapse for color & layer */}
        <button
          onClick={() => setExpanded(!expanded)}
          title="Color & Layer"
          className="ml-1 flex h-7 w-7 items-center justify-center rounded text-sm transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <span
            className="block h-4 w-4 rounded-full border-2 border-zinc-500"
            style={{ backgroundColor: selectedColor }}
          />
        </button>
      </div>

      {/* Expanded: Color palette + Layer selector */}
      {expanded && (
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/90 p-2 backdrop-blur-sm space-y-2">
          {/* Colors */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 w-8">Color</span>
            {PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => onColorChange(c.hex)}
                title={c.label}
                className={`h-5 w-5 rounded-full border-2 transition-transform ${
                  selectedColor === c.hex ? 'border-white scale-110' : 'border-transparent hover:border-zinc-600'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>

          {/* Layer */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 w-8">Layer</span>
            <select
              value={activeLayer}
              onChange={(e) => onLayerChange(e.target.value)}
              className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
            >
              {PRESET_LAYERS.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Active tool indicator */}
      {activeTool && (
        <div className="rounded border border-zinc-700/40 bg-zinc-900/80 px-2 py-1 text-[10px] text-zinc-400 backdrop-blur-sm pointer-events-none">
          {activeTool === 'marker' && 'Click to place marker'}
          {activeTool === 'text' && 'Click to place text label'}
          {activeTool === 'line' && 'Click to add points, double-click to finish'}
          {activeTool === 'polygon' && 'Click to add points, double-click to finish'}
          {activeTool === 'circle' && 'Click center, then click edge'}
          {activeTool === 'eraser' && 'Click annotation to delete'}
        </div>
      )}
    </div>
  )
}