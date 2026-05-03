/**
 * AnnotationPopup — Edit/delete popup rendered via React portal for
 * map annotations. Mounted by TacticalOverlayLayer into a MapLibre popup DOM node.
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { MapAnnotation } from '../../../../shared/types'

const PRESET_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ffffff'  // white
]

const PRESET_LAYERS = ['default', 'friendly', 'hostile', 'objectives', 'phase-lines']

interface AnnotationPopupProps {
  annotation: MapAnnotation
  onSave: (updates: Partial<MapAnnotation>) => void
  onDelete: () => void
  onClose: () => void
}

export function AnnotationPopup({
  annotation,
  onSave,
  onDelete,
  onClose
}: AnnotationPopupProps): React.JSX.Element {
  const [label, setLabel] = useState(annotation.label ?? '')
  const [description, setDescription] = useState(annotation.description ?? '')
  const [color, setColor] = useState(annotation.color)
  const [layer, setLayer] = useState(annotation.layer)
  const [visible, setVisible] = useState(annotation.visible)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setLabel(annotation.label ?? '')
    setDescription(annotation.description ?? '')
    setColor(annotation.color)
    setLayer(annotation.layer)
    setVisible(annotation.visible)
    setDirty(false)
    setConfirmDelete(false)
  }, [annotation.id])

  const handleSave = useCallback(() => {
    onSave({
      label: label || null,
      description: description || null,
      color,
      layer,
      visible
    })
    setDirty(false)
  }, [label, description, color, layer, visible, onSave])

  // Find the popup container element that TacticalOverlayLayer created
  const popupEl = document.getElementById(`annotation-popup-${annotation.id}`)

  if (!popupEl) return <></>

  return createPortal(
    <div className="p-3 space-y-2.5" onClick={(e) => e.stopPropagation()}>
      {/* Type badge */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          {annotation.type}
        </span>
        <span className="text-[10px] text-zinc-600">•</span>
        <span className="text-[10px] text-zinc-500">
          {new Date(annotation.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Label */}
      <input
        type="text"
        value={label}
        onChange={(e) => { setLabel(e.target.value); setDirty(true) }}
        placeholder="Label..."
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-500"
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
      />

      {/* Description */}
      <textarea
        value={description}
        onChange={(e) => { setDescription(e.target.value); setDirty(true) }}
        placeholder="Description..."
        rows={2}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-500 resize-none"
      />

      {/* Color palette */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-zinc-500 w-10">Color</span>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { setColor(c); setDirty(true) }}
            className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent hover:border-zinc-600'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* Layer selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 w-10">Layer</span>
        <select
          value={layer}
          onChange={(e) => { setLayer(e.target.value); setDirty(true) }}
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-amber-500"
        >
          {PRESET_LAYERS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      {/* Visibility toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 w-10">Visible</span>
        <button
          onClick={() => { setVisible(!visible); setDirty(true) }}
          className={`text-[10px] px-2 py-0.5 rounded ${visible ? 'bg-green-900/50 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}
        >
          {visible ? 'Yes' : 'Hidden'}
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
        {dirty && (
          <button
            onClick={handleSave}
            className="flex-1 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-500 transition-colors"
          >
            💾 Save
          </button>
        )}
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-red-400 hover:bg-red-900/30 transition-colors"
          >
            🗑 Delete
          </button>
        ) : (
          <>
            <button
              onClick={() => { onDelete(); onClose() }}
              className="flex-1 rounded bg-red-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-600 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>,
    popupEl
  )
}