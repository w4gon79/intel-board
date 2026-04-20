/**
 * Alert Rule Engine (Phase 5A)
 *
 * Evaluates user-defined alert rules against live entity data.
 * When a rule matches, it inserts an intel_item and updates last_fired_at.
 */

import { randomUUID } from 'crypto'
import { getDatabase } from '../storage/database'
import { REGIONS } from '../../../shared/regions'

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
  filters: FilterCondition[]
  trigger: TriggerCondition
  area: AreaDefinition
  severity: 'ALERT' | 'WATCH' | 'CONTEXT'
  label: string
  cooldown_minutes: number
  last_fired_at: string | null
  // Legacy fields kept for backward-compat parsing
  conditions?: ConditionField
  time_window_minutes?: number
}

interface ConditionField {
  field: string
  operator: string
  value: string | number
}

type AreaDefinition =
  | { region: string }                                              // Named region (existing)
  | { point: [number, number]; radius: number }                     // Circle by center+radius (existing)
  | { polygon: [number, number][] }                                 // Polygon (rectangle or freeform)
  | { circle: { center: [number, number]; radiusKm: number } }      // Circle drawn on map

interface EntityLike {
  lat?: number
  latitude?: number
  lon?: number
  longitude?: number
  speed?: number
  heading?: number
  name?: string
  ship_name?: string
  callsign?: string
  type?: string
  ship_type?: string
  destination?: string
  altitude?: number
  velocity?: number
  is_military?: boolean | number
  mmsi?: string
  icao24?: string
  id?: string
  origin_country?: string
}

// ── Sighting Tracker (time-windowed counts) ──────────────────

interface SightingEntry {
  entityId: string
  ruleId: string
  seenAt: number
}

const sightingLog: Map<string, SightingEntry[]> = new Map()

function getUniqueSightings(
  ruleId: string,
  entities: EntityLike[],
  windowMinutes: number
): number {
  const now = Date.now()
  const windowMs = windowMinutes * 60 * 1000

  if (!sightingLog.has(ruleId)) sightingLog.set(ruleId, [])

  const log = sightingLog.get(ruleId)!

  // Add current sightings
  for (const e of entities) {
    const eid = e.id ?? e.icao24 ?? e.mmsi ?? `${e.lat ?? e.latitude},${e.lon ?? e.longitude}`
    if (!log.some((s) => s.entityId === eid && s.ruleId === ruleId && now - s.seenAt < windowMs)) {
      log.push({ entityId: eid, ruleId, seenAt: now })
    }
  }

  // Prune old entries
  const pruned = log.filter((s) => now - s.seenAt < windowMs)
  sightingLog.set(ruleId, pruned)

  // Count unique entities in window
  const uniqueIds = new Set(pruned.map((s) => s.entityId))
  return uniqueIds.size
}

// ── Helpers ──────────────────────────────────────────────────

function getEntityLat(e: EntityLike): number | undefined {
  return e.lat ?? e.latitude
}

function getEntityLon(e: EntityLike): number | undefined {
  return e.lon ?? e.longitude
}

function isPointInRegion(lat: number, lon: number, regionName: string): boolean {
  const region = REGIONS.find((r) => r.name === regionName)
  if (!region) return false
  return (
    lat >= region.minLat &&
    lat <= region.maxLat &&
    lon >= region.minLon &&
    lon <= region.maxLon
  )
}

function isPointNearCenter(
  lat: number,
  lon: number,
  center: [number, number],
  radiusKm: number
): boolean {
  const R = 6371 // Earth radius in km
  const dLat = ((lat - center[1]) * Math.PI) / 180
  const dLon = ((lon - center[0]) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((center[1] * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const dist = R * c
  return dist <= radiusKm
}

/**
 * Ray-casting algorithm for point-in-polygon test.
 * Polygon coordinates are [longitude, latitude] pairs (Mapbox convention).
 */
function isPointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0] // [lon, lat] pairs
    const xj = polygon[j][1], yj = polygon[j][0]
    if (((yi > lon) !== (yj > lon)) && (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

function isInArea(entity: EntityLike, area: AreaDefinition): boolean {
  const lat = getEntityLat(entity)
  const lon = getEntityLon(entity)
  if (lat == null || lon == null) return false

  if ('region' in area) {
    return isPointInRegion(lat, lon, area.region)
  }
  if ('polygon' in area) {
    return isPointInPolygon(lat, lon, area.polygon)
  }
  if ('circle' in area) {
    return isPointNearCenter(lat, lon, area.circle.center, area.circle.radiusKm)
  }
  if ('point' in area && area.point) {
    return isPointNearCenter(lat, lon, area.point, area.radius ?? 100)
  }
  return false
}

function getEntityField(entity: EntityLike, field: string): string | number | boolean | undefined {
  switch (field) {
    case 'type':
      // For aircraft/ships: if is_military is defined, use that for civilian/military classification
      // Fall back to type / ship_type
      if (entity.is_military != null) {
        return Boolean(entity.is_military) ? 'military' : 'civilian'
      }
      return entity.type ?? entity.ship_type
    case 'name':
      return entity.name ?? entity.ship_name
    case 'callsign':
      return entity.callsign
    case 'destination':
      return entity.destination
    case 'speed':
      return entity.speed ?? entity.velocity
    case 'altitude':
      return entity.altitude
    case 'count':
      return undefined // handled separately
    default:
      return (entity as Record<string, unknown>)[field] as string | number | boolean | undefined
  }
}

function evaluateCondition(
  entity: EntityLike,
  condition: ConditionField
): boolean {
  const { field, operator, value } = condition

  // 'count' is a special aggregate operator — skip per-entity
  if (field === 'count') return true

  const entityValue = getEntityField(entity, field)
  if (entityValue == null) return false

  switch (operator) {
    case 'contains':
      return String(entityValue).toLowerCase().includes(String(value).toLowerCase())
    case 'equals':
      return String(entityValue).toLowerCase() === String(value).toLowerCase()
    case 'not_equals':
      return String(entityValue).toLowerCase() !== String(value).toLowerCase()
    case 'greater_than':
      return Number(entityValue) > Number(value)
    case 'less_than':
      return Number(entityValue) < Number(value)
    case 'gte':
      return Number(entityValue) >= Number(value)
    case 'lte':
      return Number(entityValue) <= Number(value)
    // Short-form operators (sent by UI)
    case '>':
      return Number(entityValue) > Number(value)
    case '<':
      return Number(entityValue) < Number(value)
    case '=':
      return String(entityValue).toLowerCase() === String(value).toLowerCase()
    default:
      return false
  }
}

function isOnCooldown(rule: AlertRule): boolean {
  if (!rule.last_fired_at) return false
  const lastFired = new Date(rule.last_fired_at).getTime()
  const cooldownMs = rule.cooldown_minutes * 60 * 1000
  return Date.now() - lastFired < cooldownMs
}

function loadRules(): AlertRule[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM alert_rules').all() as Record<string, unknown>[]
  return rows.map((row) => {
    // Parse new columns (filters + trigger) if present
    const filtersRaw = row.filters as string | null
    const triggerRaw = row.trigger as string | null

    let filters: FilterCondition[]
    let trigger: TriggerCondition

    if (filtersRaw) {
      // New format: parse filters and trigger from JSON columns
      filters = JSON.parse(filtersRaw) as FilterCondition[]
      trigger = triggerRaw
        ? JSON.parse(triggerRaw) as TriggerCondition
        : { count_threshold: 1, count_operator: '>', time_window_minutes: 0 }
    } else {
      // Legacy format: convert old conditions + time_window_minutes to new model
      const oldCondition = JSON.parse(row.conditions as string) as ConditionField
      const oldTimeWindow = (row.time_window_minutes as number) ?? 0

      // If the old condition was a 'count' aggregate, migrate it into the trigger
      if (oldCondition.field === 'count') {
        filters = []
        trigger = {
          count_threshold: Number(oldCondition.value),
          count_operator: oldCondition.operator,
          time_window_minutes: oldTimeWindow
        }
      } else {
        filters = [oldCondition]
        trigger = {
          count_threshold: 1,
          count_operator: '>',
          time_window_minutes: oldTimeWindow
        }
      }
    }

    return {
      id: row.id as string,
      name: row.name as string,
      enabled: Boolean(row.enabled),
      entity_type: row.entity_type as 'ship' | 'aircraft' | 'csg',
      filters,
      trigger,
      area: JSON.parse(row.area as string) as AreaDefinition,
      severity: row.severity as 'ALERT' | 'WATCH' | 'CONTEXT',
      label: row.label as string,
      cooldown_minutes: row.cooldown_minutes as number,
      last_fired_at: row.last_fired_at as string | null
    }
  })
}

function fireRule(
  rule: AlertRule,
  matchedEntity?: EntityLike,
  matchCount?: number
): void {
  const db = getDatabase()

  const now = new Date().toISOString()
  const id = randomUUID()

  const lat = matchedEntity ? (getEntityLat(matchedEntity) ?? null) : null
  const lon = matchedEntity ? (getEntityLon(matchedEntity) ?? null) : null

  const regionName = 'region' in rule.area ? rule.area.region : 'Custom Area'
  const countSuffix = matchCount != null ? ` (${matchCount} matched)` : ''

  const title = `${rule.label}${countSuffix}`
  const summary = `Custom alert "${rule.name}" triggered in ${regionName}.`

  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()

  db.prepare(
    `INSERT INTO intel_items (id, tier, title, summary, analysis, confidence, sources, region, categories, created_at, updated_at, expires_at, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    rule.severity,
    title,
    summary,
    null,
    0.9,
    `Custom Rule: ${rule.name}`,
    regionName,
    JSON.stringify(['custom_rule', rule.entity_type]),
    now,
    now,
    expiresAt,
    lat,
    lon
  )

  // Update last_fired_at
  db.prepare('UPDATE alert_rules SET last_fired_at = ? WHERE id = ?').run(now, rule.id)

  console.log(
    `[RuleEngine] Fired rule "${rule.name}" → intel item "${title}" in ${regionName}`
  )
}

// ── Main Evaluation Function ─────────────────────────────────

/**
 * Evaluate all active alert rules against a batch of entities.
 *
 * Called from each data poll cycle:
 * - AIS handler → evaluateRules('ship', vessels)
 * - ADS-B handler → evaluateRules('aircraft', aircraft)
 * - CSG handler → evaluateRules('csg', groups)
 */
export function evaluateRules(entityType: string, entities: EntityLike[]): void {
  if (!entities.length) return

  try {
    const rules = loadRules()
    console.log(`[RuleEngine] Evaluating ${entityType}: ${entities.length} entities, ${rules.length} rules`)

    for (const rule of rules) {
      // 1. Skip disabled
      if (!rule.enabled) continue

      // 2. Skip mismatched entity type
      if (rule.entity_type !== entityType) continue

      // 3. Cooldown check
      if (isOnCooldown(rule)) continue

      const filterDesc = rule.filters.map((f) => `${f.field} ${f.operator} ${f.value}`).join(', ')
      console.log(`[RuleEngine] Checking rule "${rule.name}": filters=[${filterDesc}] trigger=${JSON.stringify(rule.trigger)} area=${JSON.stringify(rule.area)}`)

      // 4. Filter entities in area
      const inArea = entities.filter((e) => isInArea(e, rule.area))

      console.log(`[RuleEngine] Rule "${rule.name}": ${inArea.length} entities in area`)

      if (inArea.length === 0) continue

      // 5. Apply filter conditions (AND logic)
      const filters = rule.filters ?? []
      const matched = filters.length > 0
        ? inArea.filter((e) => filters.every((f) => evaluateCondition(e, f)))
        : inArea

      if (matched.length === 0) continue

      // 6. Apply trigger
      const trigger = rule.trigger
      let triggerCount: number
      if (trigger.time_window_minutes > 0) {
        triggerCount = getUniqueSightings(rule.id, matched, trigger.time_window_minutes)
      } else {
        triggerCount = matched.length
      }

      let shouldFire = false
      switch (trigger.count_operator) {
        case '>': case 'greater_than': shouldFire = triggerCount > trigger.count_threshold; break
        case '<': case 'less_than':    shouldFire = triggerCount < trigger.count_threshold; break
        case '=': case 'equals':       shouldFire = triggerCount === trigger.count_threshold; break
        case '>=': case 'gte':         shouldFire = triggerCount >= trigger.count_threshold; break
        case '<=': case 'lte':         shouldFire = triggerCount <= trigger.count_threshold; break
      }

      if (shouldFire) {
        fireRule(rule, matched[0], triggerCount)
      }
    }
  } catch (err) {
    console.error('[RuleEngine] Error evaluating rules:', err)
  }
}

// ── CRUD Operations ──────────────────────────────────────────

export function listRules(): Record<string, unknown>[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as Record<string, unknown>[]
}

export function createRule(rule: Omit<AlertRule, 'id' | 'last_fired_at'>): string {
  const db = getDatabase()
  const id = randomUUID()
  const filters = rule.filters ?? []
  const trigger = rule.trigger ?? { count_threshold: 1, count_operator: '>', time_window_minutes: 0 }

  // Store legacy condition column for backward compat (first filter or empty)
  const legacyCondition = filters.length > 0 ? filters[0] : { field: 'type', operator: 'equals', value: 'any' }

  db.prepare(
    `INSERT INTO alert_rules (id, name, enabled, entity_type, conditions, area, severity, label, cooldown_minutes, time_window_minutes, filters, trigger)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    rule.name,
    rule.enabled ? 1 : 0,
    rule.entity_type,
    JSON.stringify(legacyCondition),
    JSON.stringify(rule.area),
    rule.severity,
    rule.label,
    rule.cooldown_minutes,
    trigger.time_window_minutes,
    JSON.stringify(filters),
    JSON.stringify(trigger)
  )
  console.log(`[RuleEngine] Created rule "${rule.name}" (${id}) with ${filters.length} filters`)
  return id
}

export function updateRule(
  id: string,
  updates: Partial<Omit<AlertRule, 'id' | 'created_at'>>
): boolean {
  const db = getDatabase()
  const sets: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    sets.push('name = ?')
    values.push(updates.name)
  }
  if (updates.enabled !== undefined) {
    sets.push('enabled = ?')
    values.push(updates.enabled ? 1 : 0)
  }
  if (updates.entity_type !== undefined) {
    sets.push('entity_type = ?')
    values.push(updates.entity_type)
  }
  if (updates.conditions !== undefined) {
    sets.push('conditions = ?')
    values.push(JSON.stringify(updates.conditions))
  }
  if (updates.filters !== undefined) {
    sets.push('filters = ?')
    values.push(JSON.stringify(updates.filters))
  }
  if (updates.trigger !== undefined) {
    sets.push('trigger = ?')
    values.push(JSON.stringify(updates.trigger))
    // Also update legacy time_window_minutes column
    sets.push('time_window_minutes = ?')
    values.push(updates.trigger.time_window_minutes)
  }
  if (updates.area !== undefined) {
    sets.push('area = ?')
    values.push(JSON.stringify(updates.area))
  }
  if (updates.severity !== undefined) {
    sets.push('severity = ?')
    values.push(updates.severity)
  }
  if (updates.label !== undefined) {
    sets.push('label = ?')
    values.push(updates.label)
  }
  if (updates.cooldown_minutes !== undefined) {
    sets.push('cooldown_minutes = ?')
    values.push(updates.cooldown_minutes)
  }
  if (updates.time_window_minutes !== undefined) {
    sets.push('time_window_minutes = ?')
    values.push(updates.time_window_minutes)
  }

  if (sets.length === 0) return false

  values.push(id)
  const result = db.prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return result.changes > 0
}

export function deleteRule(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
  return result.changes > 0
}

export function toggleRule(id: string): boolean {
  const db = getDatabase()
  const result = db
    .prepare('UPDATE alert_rules SET enabled = 1 - enabled WHERE id = ?')
    .run(id)
  return result.changes > 0
}