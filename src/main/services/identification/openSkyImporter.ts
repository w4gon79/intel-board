/**
 * OpenSky Aircraft Database Importer
 *
 * Pre-seeds the aircraft_registry cache by bulk-importing the OpenSky Aircraft
 * Database CSV. This eliminates the 80+ minute warm-up period where military
 * aircraft are invisible because HexDB lookups are rate-limited to 30/cycle.
 *
 * CSV source: https://opensky-network.org/datasets/metadata/aircraft-database-complete-2024-06.csv
 *
 * Military classification uses the same isMilitaryOperator() logic as
 * aircraftLookup.ts plus categoryDescription checks.
 * All imported entries get is_military_verified = 0 so HexDB can override later.
 */

import { getDatabase } from '../storage/database'
import { isMilitaryOperator } from './aircraftLookup'
import type Database from 'better-sqlite3'

// ─── CSV column indices (OpenSky aircraft-database-complete) ──

const COL = {
  icao24: 0,
  categoryDescription: 5,
  country: 6,
  icaoAircraftClass: 10,
  manufacturerName: 13,
  model: 14,
  operator: 17,
  owner: 21,
  registration: 23,
  typecode: 29
} as const

// ─── Military category keywords in categoryDescription ────────

const MILITARY_CATEGORY_KEYWORDS = [
  'MILITARY', 'ARMY', 'NAVY', 'AIR FORCE', 'AIR FORCE',
  'MARINE CORPS', 'COAST GUARD', 'MILITARY -'
]

// ─── Countries known to operate military flights ──────────────

export const MILITARY_ORIGIN_COUNTRIES = new Set([
  'United States', 'United Kingdom', 'France', 'Germany',
  'Russia', 'China', 'Israel', 'Turkey', 'Saudi Arabia',
  'Japan', 'South Korea', 'India', 'Pakistan', 'Italy',
  'Spain', 'Netherlands', 'Belgium', 'Canada', 'Australia',
  'Sweden', 'Norway', 'Denmark', 'Poland', 'Czech Republic',
  'Greece', 'Portugal', 'Brazil', 'Egypt', 'Iran',
  'United Arab Emirates', 'Qatar', 'Oman', 'Jordan',
  'Singapore', 'Taiwan', 'Thailand', 'Malaysia', 'Indonesia',
  'NATO'
])

// ─── CSV line parser ─────────────────────────────────────────

/**
 * Parse a single CSV line handling quoted fields with embedded commas.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }
  fields.push(current)
  return fields
}

// ─── Military detection ──────────────────────────────────────

/**
 * Determine if an aircraft is military based on OpenSky CSV fields.
 * Uses operator/owner keywords and categoryDescription only.
 *
 * NOTE: We intentionally do NOT check icaoAircraftClass here. Civilian and
 * military aircraft share the same ICAO type code patterns (e.g. C172 Cessna
 * vs C-17 Globemaster both start with "C" + digit), so regex-based type code
 * matching produces massive false positives (~37K civilian aircraft flagged).
 * The operator/owner field is the strongest reliable signal.
 */
function isOpenSkyMilitary(
  operator: string | null,
  owner: string | null,
  categoryDescription: string | null
): boolean {
  // Check operator/owner against known military keywords
  if (isMilitaryOperator(operator) || isMilitaryOperator(owner)) {
    return true
  }

  // Check categoryDescription for military indicators
  if (categoryDescription) {
    const upper = categoryDescription.toUpperCase()
    if (MILITARY_CATEGORY_KEYWORDS.some(kw => {
      // Use word boundary matching to prevent false positives
      // e.g. "ARMY" should NOT match inside "ARMYSTRONG"
      const regex = new RegExp('(?:^|[^A-Z])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[^A-Z]|$)')
      return regex.test(upper)
    })) {
      return true
    }
  }

  return false
}

// ─── Import result ───────────────────────────────────────────

export interface ImportResult {
  totalImported: number
  militaryImported: number
  skipped: number
  errors: number
}

// ─── Core import logic ───────────────────────────────────────

/**
 * Import aircraft data from OpenSky CSV text into the aircraft_registry.
 * Uses INSERT OR IGNORE so existing HexDB-verified entries are preserved.
 *
 * @param csvText - Full CSV content (including header row)
 * @param db - Optional database instance (defaults to getDatabase())
 * @param onProgress - Optional progress callback (imported count, military count)
 */
export function importOpenSkyCsv(
  csvText: string,
  db?: Database.Database,
  onProgress?: (imported: number, military: number) => void
): ImportResult {
  const database = db ?? getDatabase()
  const lines = csvText.split('\n')

  if (lines.length < 2) {
    console.warn('[OpenSkyImporter] CSV is empty or has no data rows')
    return { totalImported: 0, militaryImported: 0, skipped: 0, errors: 0 }
  }

  // Skip header row
  const dataLines = lines.slice(1)

  const insert = database.prepare(`
    INSERT OR IGNORE INTO aircraft_registry
      (icao24, aircraft_type, icao_type_code, manufacturer, registration,
       operator, is_military, is_military_verified, category, looked_up_at)
    VALUES
      (@icao24, @aircraft_type, @icao_type_code, @manufacturer, @registration,
       @operator, @is_military, 0, @category, datetime('now'))
  `)

  let totalImported = 0
  let militaryImported = 0
  let skipped = 0
  let errors = 0

  // Process in transactional batches of 5000 for performance + memory efficiency
  const BATCH_SIZE = 5000
  let batchCount = 0

  const batchInsert = database.transaction((rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      try {
        insert.run(row)
      } catch {
        errors++
      }
    }
  })

  let batch: Array<Record<string, unknown>> = []

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim()
    if (!line) {
      skipped++
      continue
    }

    const fields = parseCsvLine(line)

    // Validate minimum columns
    if (fields.length < 30) {
      skipped++
      continue
    }

    const icao24 = fields[COL.icao24]?.trim().toLowerCase()
    if (!icao24 || icao24.length < 6) {
      skipped++
      continue
    }

    const operator = fields[COL.operator]?.trim() || null
    const owner = fields[COL.owner]?.trim() || null
    const categoryDescription = fields[COL.categoryDescription]?.trim() || null
    const icaoAircraftClass = fields[COL.icaoAircraftClass]?.trim() || null
    const model = fields[COL.model]?.trim() || null
    const manufacturerName = fields[COL.manufacturerName]?.trim() || null
    const registration = fields[COL.registration]?.trim() || null
    const typecode = fields[COL.typecode]?.trim() || null

    const isMilitary = isOpenSkyMilitary(operator, owner, categoryDescription)

    batch.push({
      icao24,
      aircraft_type: model,
      icao_type_code: typecode || icaoAircraftClass,
      manufacturer: manufacturerName,
      registration,
      operator: operator || owner,
      is_military: isMilitary ? 1 : 0,
      category: categoryDescription
    })

    if (isMilitary) militaryImported++

    batchCount++

    // Flush batch
    if (batch.length >= BATCH_SIZE) {
      batchInsert(batch)
      totalImported += batch.length
      batch = []

      if (onProgress) {
        onProgress(totalImported, militaryImported)
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    batchInsert(batch)
    totalImported += batch.length
  }

  return { totalImported, militaryImported, skipped, errors }
}

// ─── Download + Import ───────────────────────────────────────

const OPENSKY_CSV_URLS = [
  'https://opensky-network.org/datasets/metadata/aircraft-database-complete-2024-06.csv',
  'https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-07.csv'
]

/**
 * Download the OpenSky aircraft database CSV and import it.
 * Tries multiple URLs as fallbacks.
 */
export async function downloadAndImportOpenSkyDatabase(): Promise<ImportResult> {
  console.log('[OpenSkyImporter] Starting OpenSky aircraft database download...')

  let csvText: string | null = null

  for (const url of OPENSKY_CSV_URLS) {
    try {
      console.log(`[OpenSkyImporter] Trying: ${url}`)
      const response = await fetch(url, {
        headers: { 'User-Agent': 'IntelBoard/1.0' }
      })

      if (response.ok) {
        csvText = await response.text()
        console.log(
          `[OpenSkyImporter] Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB from ${url}`
        )
        break
      } else {
        console.warn(`[OpenSkyImporter] HTTP ${response.status} from ${url}`)
      }
    } catch (err) {
      console.warn(
        `[OpenSkyImporter] Download failed for ${url}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  if (!csvText) {
    console.error('[OpenSkyImporter] Failed to download from all URLs')
    return { totalImported: 0, militaryImported: 0, skipped: 0, errors: 1 }
  }

  // Count approximate rows for progress logging
  const approxRows = csvText.split('\n').length - 1
  console.log(`[OpenSkyImporter] Parsing ~${approxRows.toLocaleString()} aircraft records...`)

  const result = importOpenSkyCsv(csvText, undefined, (imported, military) => {
    if (imported % 25000 === 0) {
      console.log(`[OpenSkyImporter] Progress: ${imported.toLocaleString()} imported (${military.toLocaleString()} military)`)
    }
  })

  console.log(
    `[OpenSkyImporter] Import complete: ${result.totalImported.toLocaleString()} aircraft ` +
    `(${result.militaryImported.toLocaleString()} military), ` +
    `${result.skipped.toLocaleString()} skipped, ${result.errors} errors`
  )

  return result
}

// ─── Startup check ───────────────────────────────────────────

const SEED_THRESHOLD = 10000

/**
 * Check if the aircraft_registry needs pre-seeding and import if needed.
 * Safe to call on every app startup — only runs the import once.
 */
export async function seedAircraftRegistryIfNeeded(): Promise<void> {
  const db = getDatabase()

  const row = db
    .prepare('SELECT COUNT(*) as count FROM aircraft_registry')
    .get() as { count: number }

  if (row.count >= SEED_THRESHOLD) {
    console.log(
      `[AircraftRegistry] Cache already populated (${row.count.toLocaleString()} entries) — skipping pre-seed`
    )
    return
  }

  console.log(
    `[AircraftRegistry] Cache has only ${row.count.toLocaleString()} entries (threshold: ${SEED_THRESHOLD.toLocaleString()}) — starting pre-seed`
  )

  try {
    await downloadAndImportOpenSkyDatabase()

    // Log final counts
    const finalCount = db
      .prepare('SELECT COUNT(*) as count FROM aircraft_registry')
      .get() as { count: number }
    const milCount = db
      .prepare('SELECT COUNT(*) as count FROM aircraft_registry WHERE is_military = 1')
      .get() as { count: number }

    console.log(
      `[AircraftRegistry] Pre-seeded ${finalCount.count.toLocaleString()} aircraft ` +
      `(${milCount.count.toLocaleString()} military) from OpenSky database`
    )
  } catch (err) {
    console.error(
      '[AircraftRegistry] Pre-seed failed (app will continue with HexDB warm-up):',
      err instanceof Error ? err.message : String(err)
    )
  }
}