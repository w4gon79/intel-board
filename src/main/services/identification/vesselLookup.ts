/**
 * Vessel Identification via MMSI/IMO Lookup
 *
 * Resolves vessel MMSI codes to cached vessel information.
 * Military classification is now handled in aisService.ts using
 * layered live AIS data analysis (name prefix, type code, flag state).
 *
 * Lookup strategy:
 *   1. Check local vessel_registry SQLite cache
 *   2. If not cached, return null (no network lookups)
 */

import { getDatabase } from '../storage/database'

// ─── Types ───────────────────────────────────────────────────

export interface VesselInfo {
  mmsi: string
  vessel_name: string | null
  vessel_class: string | null // e.g. 'Arleigh Burke-class'
  vessel_type: string | null // e.g. 'destroyer'
  hull_number: string | null // e.g. 'DDG-51'
  country: string | null
  displacement_tons: number | null
  capabilities: string | null // JSON array
  is_hva: boolean
  category: string | null // 'carrier', 'surface_warfare', 'submarine', 'amphibious', 'auxiliary', 'patrol'
}

// ─── SQLite bind safety ──────────────────────────────────────

/**
 * SQLite can only bind numbers, strings, bigints, buffers, and null.
 * Replace any `undefined` values with `null`.
 * Convert booleans to 0/1 for SQLite.
 */
function nullify(obj: VesselInfo): VesselInfo {
  const result: Record<string, unknown> = { ...obj }
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) {
      result[key] = null
    }
    if (typeof result[key] === 'boolean') {
      result[key] = result[key] ? 1 : 0
    }
  }
  return result as unknown as VesselInfo
}

// ─── Cache helpers ───────────────────────────────────────────

function getCached(mmsi: string): VesselInfo | null {
  try {
    const db = getDatabase()
    const row = db
      .prepare(
        `SELECT mmsi, vessel_name, vessel_class, vessel_type,
                hull_number, country, displacement_tons, capabilities,
                is_hva, category
         FROM vessel_registry WHERE mmsi = ?`
      )
      .get(mmsi) as VesselInfo | undefined

    return row ?? null
  } catch {
    // Table may not exist yet (e.g., during schema migration)
    return null
  }
}

export function upsert(info: VesselInfo): void {
  const db = getDatabase()
  const safe = nullify(info)
  db.prepare(`
    INSERT INTO vessel_registry (mmsi, vessel_name, vessel_class, vessel_type, hull_number, country, displacement_tons, capabilities, is_hva, category, looked_up_at)
    VALUES (@mmsi, @vessel_name, @vessel_class, @vessel_type, @hull_number, @country, @displacement_tons, @capabilities, @is_hva, @category, datetime('now'))
    ON CONFLICT(mmsi) DO UPDATE SET
      vessel_name = @vessel_name,
      vessel_class = @vessel_class,
      vessel_type = @vessel_type,
      hull_number = @hull_number,
      country = @country,
      displacement_tons = @displacement_tons,
      capabilities = @capabilities,
      is_hva = @is_hva,
      category = @category,
      looked_up_at = datetime('now')
  `).run(safe)
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Look up vessel info by MMSI code (cache only).
 *
 * @param mmsi MMSI number (9-digit string)
 */
export async function lookupVessel(mmsi: string): Promise<VesselInfo | null> {
  const mmsiClean = mmsi.trim()
  return getCached(mmsiClean)
}

/**
 * Get cached vessel info (no network call).
 * Used by IPC handlers and AIS service for quick lookups.
 */
export function getCachedVesselInfo(mmsi: string): VesselInfo | null {
  return getCached(mmsi.trim())
}