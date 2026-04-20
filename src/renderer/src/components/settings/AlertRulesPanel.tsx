/**
 * AlertRulesPanel — manage custom alert rules for the intelligence board.
 *
 * Supports multi-condition filters + count-based trigger with time window.
 * Rules are evaluated against live data (AIS, ADS-B, CSG) by the rule engine.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { REGIONS } from '../../../../shared/regions'

// ── Types ────────────────────────────────────────────────────

interface FilterCondition {
  field: string
  operator: string
  value: string | number
}

interface TriggerCondition {
  count_threshold: number
  count_operator: string
  time_window_minutes: number
}

interface AlertRule {
  id: string
  name: string
  enabled: boolean
  entity_type: 'ship' | 'aircraft' | 'csg'
  conditions?: string // Legacy JSON string
  filters?: string // JSON array of FilterCondition
  trigger?: string // JSON TriggerCondition
  area: string // JSON string
  severity: 'ALERT' | 'WATCH' | 'CONTEXT'
  label: string
  cooldown_minutes: number
  time_window_minutes?: number
  last_fired_at: string | null
  created_at: string
}

interface Area {
  region?: string
  point?: [number, number]
  radius?: number
  polygon?: [number, number][]
  circle?: { center: [number, number]; radiusKm: number }
}

type AreaMode = 'region' | 'draw'

type EntityType = 'ship' | 'aircraft' | 'csg'

const ENTITY_LABELS: Record<EntityType, string> = {
  ship: '🚢 Ship',
  aircraft: '✈️ Aircraft',
  csg: '⚓ Carrier Strike Group'
}

const ENTITY_SINGULAR: Record<EntityType, string> = {
  ship: 'ship',
  aircraft: 'aircraft',
  csg: 'strike group'
}

const SEVERITY_COLORS: Record<string, string> = {
  ALERT: 'bg-red-600/20 text-red-400 border-red-600/30',
  WATCH: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
  CONTEXT: 'bg-blue-600/20 text-blue-400 border-blue-600/30'
}

// ── Filter field definitions by entity type (no 'count' — count is in trigger) ──

const FILTER_FIELDS: Record<EntityType, { value: string; label: string; type: 'string' | 'number' }[]> = {
  ship: [
    { value: 'type', label: 'Type (military/civilian)', type: 'string' },
    { value: 'name', label: 'Name (contains)', type: 'string' },
    { value: 'destination', label: 'Destination (contains)', type: 'string' },
    { value: 'speed', label: 'Speed (knots)', type: 'number' }
  ],
  aircraft: [
    { value: 'type', label: 'Type (military/civilian)', type: 'string' },
    { value: 'callsign', label: 'Callsign (contains)', type: 'string' },
    { value: 'altitude', label: 'Altitude (ft)', type: 'number' },
    { value: 'speed', label: 'Speed (kts)', type: 'number' }
  ],
  csg: [
    { value: 'name', label: 'Name (contains)', type: 'string' }
  ]
}

const STRING_OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' }
]

const NUMBER_OPERATORS = [
  { value: '>', label: 'greater than' },
  { value: '<', label: 'less than' },
  { value: '=', label: 'equals' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' }
]

const COUNT_OPERATORS = [
  { value: '>', label: 'greater than' },
  { value: '<', label: 'less than' },
  { value: '=', label: 'equals' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' }
]

// ── Helpers ──────────────────────────────────────────────────

/** Parse a rule's filters from either new or legacy format */
function parseRuleFilters(rule: AlertRule): FilterCondition[] {
  if (rule.filters) {
    try {
      return JSON.parse(rule.filters) as FilterCondition[]
    } catch {
      return []
    }
  }
  // Legacy: single condition
  if (rule.conditions) {
    try {
      const c = JSON.parse(rule.conditions) as FilterCondition
      return c.field === 'count' ? [] : [c]
    } catch {
      return []
    }
  }
  return []
}

/** Parse a rule's trigger from either new or legacy format */
function parseRuleTrigger(rule: AlertRule): TriggerCondition {
  if (rule.trigger) {
    try {
      return JSON.parse(rule.trigger) as TriggerCondition
    } catch {
      /* fall through */
    }
  }
  // Legacy: derive from conditions + time_window_minutes
  if (rule.conditions) {
    try {
      const c = JSON.parse(rule.conditions) as FilterCondition
      if (c.field === 'count') {
        return {
          count_threshold: Number(c.value),
          count_operator: c.operator,
          time_window_minutes: rule.time_window_minutes ?? 0
        }
      }
    } catch {
      /* fall through */
    }
  }
  return {
    count_threshold: 1,
    count_operator: '>',
    time_window_minutes: rule.time_window_minutes ?? 0
  }
}

function describeFilter(f: FilterCondition, entityType: EntityType): string {
  const fieldDef = FILTER_FIELDS[entityType]?.find((fd) => fd.value === f.field)
  const fieldLabel = fieldDef?.label ?? f.field
  return `${fieldLabel} ${f.operator} ${String(f.value)}`
}

function describeTrigger(t: TriggerCondition): string {
  const op = COUNT_OPERATORS.find((o) => o.value === t.count_operator)?.label ?? t.count_operator
  let desc = `count ${op} ${t.count_threshold}`
  if (t.time_window_minutes > 0) {
    desc += ` (${t.time_window_minutes} min window)`
  }
  return desc
}

// ── Component ────────────────────────────────────────────────

export function AlertRulesPanel(): React.JSX.Element {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)

  const loadRules = useCallback(async () => {
    try {
      const result = await window.api.alertRules.list()
      setRules(Array.isArray(result) ? result : [])
    } catch (err) {
      console.error('[AlertRules] Failed to load rules:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete this alert rule?')) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__alertDrawCleanup?.()
      await window.api.alertRules.delete(id)
      setRules((prev) => prev.filter((r) => r.id !== id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__alertHiddenRuleId = null
      window.dispatchEvent(new CustomEvent('alert-rules-changed'))
    } catch (err) {
      console.error('[AlertRules] Delete failed:', err)
    }
  }

  const handleToggle = async (id: string): Promise<void> => {
    try {
      await window.api.alertRules.toggle(id)
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
      )
    } catch (err) {
      console.error('[AlertRules] Toggle failed:', err)
    }
  }

  const handleSave = async (data: {
    name: string
    entity_type: EntityType
    filters: FilterCondition[]
    trigger: TriggerCondition
    area: Area
    severity: 'ALERT' | 'WATCH' | 'CONTEXT'
    label: string
    cooldown_minutes: number
  }): Promise<void> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__alertDrawCleanup?.()
      if (editingRule) {
        await window.api.alertRules.update(editingRule.id, data)
      } else {
        await window.api.alertRules.create(data)
      }
      setShowForm(false)
      setEditingRule(null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__alertHiddenRuleId = null
      window.dispatchEvent(new CustomEvent('alert-rules-changed'))
      await loadRules()
    } catch (err) {
      console.error('[AlertRules] Save failed:', err)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Alert Rules
        </h3>
        <button
          type="button"
          onClick={() => {
            setEditingRule(null)
            setShowForm(true)
          }}
          className="flex items-center gap-1 rounded-md bg-indigo-600/20 px-2 py-1 text-[10px] font-medium text-indigo-400 transition-colors hover:bg-indigo-600/30 border border-indigo-600/30"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Rule
        </button>
      </div>

      {/* Rule list */}
      {loading ? (
        <div className="py-4 text-center text-[10px] text-zinc-600">Loading rules…</div>
      ) : rules.length === 0 && !showForm ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-4 text-center">
          <svg className="mx-auto h-8 w-8 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <p className="mt-2 text-[10px] text-zinc-500">
            No alert rules configured. Add your first rule to start monitoring.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onEdit={() => {
                setEditingRule(rule)
                setShowForm(true)
              }}
            />
          ))}
        </div>
      )}

      {/* Add/Edit form modal */}
      {showForm && (
        <RuleFormModal
          rule={editingRule}
          onSave={handleSave}
          onCancel={() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).__alertDrawCleanup?.()
            setShowForm(false)
            setEditingRule(null)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).__alertHiddenRuleId = null
            window.dispatchEvent(new CustomEvent('alert-rules-changed'))
          }}
        />
      )}
    </div>
  )
}

// ── Rule Card ────────────────────────────────────────────────

function RuleCard({
  rule,
  onToggle,
  onDelete,
  onEdit
}: {
  rule: AlertRule
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onEdit: () => void
}): React.JSX.Element {
  const filters = parseRuleFilters(rule)
  const trigger = parseRuleTrigger(rule)

  let area: Area
  try {
    area = JSON.parse(rule.area)
  } catch {
    area = {}
  }

  // Build description
  const filterDesc = filters.length > 0
    ? filters.map((f) => describeFilter(f, rule.entity_type)).join(' AND ')
    : `any ${ENTITY_SINGULAR[rule.entity_type]}`
  const triggerDesc = describeTrigger(trigger)

  return (
    <div className={`rounded-md border p-3 transition-colors ${rule.enabled ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-800/50 bg-zinc-900/20 opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px]">{ENTITY_LABELS[rule.entity_type]}</span>
            <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold ${SEVERITY_COLORS[rule.severity]}`}>
              {rule.severity}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-zinc-200 truncate">{rule.name}</p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            When {filterDesc} → {triggerDesc} in {
              area.region ?? (area.polygon ? `Custom Zone (${area.polygon.length} pts)` : area.circle ? 'Custom Circle' : 'Custom Area')
            }
          </p>
          {rule.last_fired_at && (
            <p className="mt-0.5 text-[9px] text-zinc-600">
              Last fired: {new Date(rule.last_fired_at).toLocaleString()}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onToggle(rule.id)}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              rule.enabled ? 'bg-emerald-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                rule.enabled ? 'translate-x-3' : 'translate-x-0'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            title="Edit rule"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onDelete(rule.id)}
            className="rounded p-1 text-zinc-500 hover:bg-red-900/30 hover:text-red-400 transition-colors"
            title="Delete rule"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rule Form Modal ──────────────────────────────────────────

function RuleFormModal({
  rule,
  onSave,
  onCancel
}: {
  rule: AlertRule | null
  onSave: (data: {
    name: string
    entity_type: EntityType
    filters: FilterCondition[]
    trigger: TriggerCondition
    area: Area
    severity: 'ALERT' | 'WATCH' | 'CONTEXT'
    label: string
    cooldown_minutes: number
  }) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(rule?.name ?? '')
  const [entityType, setEntityType] = useState<EntityType>(rule?.entity_type ?? 'ship')
  const [filters, setFilters] = useState<FilterCondition[]>([])
  const [countOperator, setCountOperator] = useState('>')
  const [countThreshold, setCountThreshold] = useState(1)
  const [timeWindow, setTimeWindow] = useState(0)
  const [areaRegion, setAreaRegion] = useState('Persian Gulf')
  const [severity, setSeverity] = useState<'ALERT' | 'WATCH' | 'CONTEXT'>(rule?.severity ?? 'WATCH')
  const [label, setLabel] = useState(rule?.label ?? '')
  const [cooldown, setCooldown] = useState(rule?.cooldown_minutes ?? 30)
  const [areaMode, setAreaMode] = useState<AreaMode>('region')
  const [drawnShape, setDrawnShape] = useState<{ type: string; coordinates: [number, number][] } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const drawCompletedRef = useRef(false)

  const startDrawing = (type: 'circle' | 'rectangle' | 'polygon'): void => {
    drawCompletedRef.current = false
    // Hide the saved zone from AlertZoneLayer while drawing to prevent double brightness
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__alertHiddenRuleId = rule?.id ?? null
    window.dispatchEvent(new CustomEvent('alert-rules-changed'))
    setIsDrawing(true)
    const onComplete = (result: { coordinates: [number, number][] }): void => {
      drawCompletedRef.current = true
      setDrawnShape({ type, coordinates: result.coordinates })
      setIsDrawing(false)
    }
    const onCancelDraw = (): void => {
      setIsDrawing(false)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__alertDrawStart) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__alertDrawStart(type, onComplete, onCancelDraw)
    } else {
      console.warn('[AlertRules] Draw mode not available — map not ready')
      setIsDrawing(false)
    }
  }

  const clearDrawing = (): void => {
    // Remove the preview layers from the map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__alertDrawCleanup?.()
    setDrawnShape(null)
    // Hide the saved zone from AlertZoneLayer while redrawing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__alertHiddenRuleId = rule?.id ?? null
    window.dispatchEvent(new CustomEvent('alert-rules-changed'))
  }

  // Parse existing rule data for editing
  useEffect(() => {
    if (!rule) return
    const parsedFilters = parseRuleFilters(rule)
    const parsedTrigger = parseRuleTrigger(rule)

    setFilters(parsedFilters)
    setCountOperator(parsedTrigger.count_operator)
    setCountThreshold(parsedTrigger.count_threshold)
    setTimeWindow(parsedTrigger.time_window_minutes)

    try {
      const a = JSON.parse(rule.area) as Area
      if (a.region) {
        setAreaMode('region')
        setAreaRegion(a.region)
      } else if (a.polygon) {
        setAreaMode('draw')
        setDrawnShape({ type: 'polygon', coordinates: a.polygon })
      } else if (a.circle) {
        setAreaMode('draw')
        setDrawnShape({ type: 'circle', coordinates: [] })
      } else if (a.point) {
        setAreaMode('region')
      }
    } catch {
      /* use defaults */
    }
  }, [rule])

  // Reset filters when entity type changes (fields may not apply)
  useEffect(() => {
    const validFields = FILTER_FIELDS[entityType].map((f) => f.value)
    setFilters((prev) => prev.filter((f) => validFields.includes(f.field)))
  }, [entityType])

  const addFilter = (): void => {
    const fields = FILTER_FIELDS[entityType]
    if (fields.length === 0) return
    const firstField = fields[0]
    setFilters((prev) => [
      ...prev,
      {
        field: firstField.value,
        operator: firstField.type === 'number' ? '>' : 'contains',
        value: firstField.type === 'number' ? 0 : ''
      }
    ])
  }

  const removeFilter = (index: number): void => {
    setFilters((prev) => prev.filter((_, i) => i !== index))
  }

  const updateFilter = (index: number, partial: Partial<FilterCondition>): void => {
    setFilters((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f
        const updated = { ...f, ...partial }
        // When field changes, reset operator/value based on field type
        if (partial.field !== undefined) {
          const fieldDef = FILTER_FIELDS[entityType].find((fd) => fd.value === partial.field)
          if (fieldDef) {
            if (fieldDef.type === 'number') {
              updated.operator = '>'
              updated.value = 0
            } else {
              updated.operator = 'contains'
              updated.value = ''
            }
          }
        }
        return updated
      })
    )
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!name.trim() || !label.trim()) return

    let area: Area
    if (areaMode === 'region') {
      area = { region: areaRegion }
    } else if (drawnShape) {
      area = { polygon: drawnShape.coordinates }
    } else {
      area = { region: areaRegion }
    }

    onSave({
      name: name.trim(),
      entity_type: entityType,
      filters,
      trigger: {
        count_threshold: countThreshold,
        count_operator: countOperator,
        time_window_minutes: timeWindow
      },
      area,
      severity,
      label: label.trim(),
      cooldown_minutes: cooldown
    })
  }

  return (
    <>
      {!isDrawing && !drawCompletedRef.current && (
        <div
          className="fixed inset-0 z-[60] bg-black/50"
          onClick={() => {
            if (!drawCompletedRef.current) onCancel()
          }}
        />
      )}
      <div
        className={`fixed inset-0 z-[61] flex items-center justify-center p-4 transition-opacity duration-200 ${isDrawing ? 'opacity-0 pointer-events-none' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-100">
              {rule ? 'Edit Alert Rule' : 'New Alert Rule'}
            </h3>
            <button
              type="button"
              onClick={onCancel}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4 px-4 py-4 max-h-[60vh] overflow-y-auto">
            {/* Name */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">Rule Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Russian naval activity in Hormuz"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
                required
              />
            </div>

            {/* Entity type */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">Monitor Entity</label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as EntityType)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="ship">🚢 Ships</option>
                <option value="aircraft">✈️ Aircraft</option>
                <option value="csg">⚓ Carrier Strike Groups</option>
              </select>
            </div>

            {/* ── Filters Section ── */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                Filters <span className="text-zinc-600">(match all)</span>
              </label>
              <div className="space-y-2">
                {filters.map((filter, idx) => {
                  const fieldDef = FILTER_FIELDS[entityType]?.find((f) => f.value === filter.field)
                  const isNumeric = fieldDef?.type === 'number'
                  return (
                    <div key={idx} className="flex gap-1.5 items-center">
                      {/* Field selector */}
                      <select
                        value={filter.field}
                        onChange={(e) => updateFilter(idx, { field: e.target.value })}
                        className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                      >
                        {FILTER_FIELDS[entityType]?.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      {/* Operator selector */}
                      <select
                        value={filter.operator}
                        onChange={(e) => updateFilter(idx, { operator: e.target.value })}
                        className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1.5 text-[10px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                      >
                        {(isNumeric ? NUMBER_OPERATORS : STRING_OPERATORS).map((op) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                      {/* Value input */}
                      {filter.field === 'type' ? (
                        <select
                          value={String(filter.value)}
                          onChange={(e) => updateFilter(idx, { value: e.target.value })}
                          className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1.5 text-[10px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Select…</option>
                          <option value="military">Military</option>
                          <option value="civilian">Civilian</option>
                        </select>
                      ) : (
                        <input
                          type={isNumeric ? 'number' : 'text'}
                          value={filter.value}
                          onChange={(e) =>
                            updateFilter(idx, {
                              value: isNumeric ? Number(e.target.value) : e.target.value
                            })
                          }
                          placeholder="value"
                          className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                        />
                      )}
                      {/* Remove button */}
                      <button
                        type="button"
                        onClick={() => removeFilter(idx)}
                        className="rounded p-1 text-zinc-600 hover:bg-red-900/30 hover:text-red-400 transition-colors shrink-0"
                        title="Remove filter"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={addFilter}
                  className="flex items-center gap-1 rounded-md border border-dashed border-zinc-700 px-2 py-1.5 text-[10px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-400 transition-colors w-full justify-center"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Filter
                </button>
              </div>
              {filters.length === 0 && (
                <p className="mt-1 text-[9px] text-zinc-600">
                  No filters = match any {ENTITY_SINGULAR[entityType]} in the area
                </p>
              )}
            </div>

            {/* ── Trigger Section ── */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">Trigger</label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 shrink-0">Alert when</span>
                  <select
                    value={countOperator}
                    onChange={(e) => setCountOperator(e.target.value)}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {COUNT_OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={countThreshold}
                    onChange={(e) => setCountThreshold(Number(e.target.value))}
                    min={1}
                    max={9999}
                    className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-zinc-500 shrink-0">matching</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 shrink-0">Over a</span>
                  <input
                    type="number"
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(Number(e.target.value))}
                    min={0}
                    max={1440}
                    className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-zinc-500">minute window (0 = instant)</span>
                </div>
              </div>
              <p className="mt-1 text-[9px] text-zinc-600">
                How many matching entities are needed to fire the alert.
              </p>
            </div>

            {/* Area */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">Area</label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setAreaMode('region')}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[10px] font-medium ${
                    areaMode === 'region' ? 'border-indigo-500 bg-indigo-600/20 text-indigo-400' : 'border-zinc-800 bg-zinc-900/30 text-zinc-500'
                  }`}
                >
                  📍 Region
                </button>
                <button
                  type="button"
                  onClick={() => setAreaMode('draw')}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[10px] font-medium ${
                    areaMode === 'draw' ? 'border-indigo-500 bg-indigo-600/20 text-indigo-400' : 'border-zinc-800 bg-zinc-900/30 text-zinc-500'
                  }`}
                >
                  ✏️ Draw on Map
                </button>
              </div>

              {areaMode === 'region' && (
                <select
                  value={areaRegion}
                  onChange={(e) => setAreaRegion(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                >
                  {REGIONS.map((r) => (
                    <option key={r.name} value={r.name}>{r.name}</option>
                  ))}
                </select>
              )}

              {areaMode === 'draw' && !drawnShape && (
                <div className="space-y-2">
                  <p className="text-[10px] text-zinc-500">Select a shape, then click "Start Drawing" to draw on the map.</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startDrawing('circle')}
                      className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] font-medium text-zinc-300 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
                    >
                      ⭕ Circle
                    </button>
                    <button
                      type="button"
                      onClick={() => startDrawing('rectangle')}
                      className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] font-medium text-zinc-300 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
                    >
                      ▭ Rectangle
                    </button>
                    <button
                      type="button"
                      onClick={() => startDrawing('polygon')}
                      className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] font-medium text-zinc-300 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
                    >
                      🔲 Polygon
                    </button>
                  </div>
                </div>
              )}

              {areaMode === 'draw' && drawnShape && (
                <div className="rounded border border-zinc-700 bg-zinc-900 p-2">
                  <p className="text-[10px] text-zinc-400">
                    {drawnShape.type === 'circle' ? '⭕ Circle' : drawnShape.type === 'rectangle' ? '▭ Rectangle' : '🔲 Polygon'} zone drawn ({drawnShape.coordinates.length} points)
                  </p>
                  <button type="button" onClick={clearDrawing} className="mt-1 text-[10px] text-red-400 hover:text-red-300">
                    ✕ Clear & Redraw
                  </button>
                </div>
              )}
            </div>

            {/* Severity */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">Severity</label>
              <div className="flex gap-2">
                {(['ALERT', 'WATCH', 'CONTEXT'] as const).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverity(sev)}
                    className={`flex-1 rounded-md border px-3 py-2 text-[10px] font-semibold transition-colors ${
                      severity === sev
                        ? SEVERITY_COLORS[sev]
                        : 'border-zinc-800 bg-zinc-900/30 text-zinc-500'
                    }`}
                  >
                    {sev === 'ALERT' ? '🔴' : sev === 'WATCH' ? '🟡' : '🔵'} {sev}
                  </button>
                ))}
              </div>
            </div>

            {/* Alert Label */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">Alert Title</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., MILITARY ACTIVITY DETECTED"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
                required
              />
            </div>

            {/* Cooldown */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1">Cooldown (minutes)</label>
              <input
                type="number"
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
                min={1}
                max={1440}
                className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-[9px] text-zinc-600">Don't re-fire for the same entity within this window</p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              {rule ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}