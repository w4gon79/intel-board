/**
 * Standalone CLI script: Import OpenSky Aircraft Database into aircraft_registry.
 *
 * Pre-seeds the aircraft cache so military aircraft are immediately visible
 * on the map without waiting for HexDB warm-up (80+ minutes at 30 lookups/cycle).
 *
 * Usage:
 *   npx tsx scripts/import-opensky-aircraft.ts
 *
 * With a local CSV file (skips download):
 *   npx tsx scripts/import-opensky-aircraft.ts --file path/to/aircraft-database.csv
 *
 * Dry run (parse only, no DB writes):
 *   npx tsx scripts/import-opensky-aircraft.ts --dry-run
 *
 * IMPORTANT: This script requires better-sqlite3 compiled for your system Node.js.
 * If you get a NODE_MODULE_VERSION error, the import runs automatically on app
 * startup via seedAircraftRegistryIfNeeded() instead. Just launch the app and
 * check the console logs.
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { readFileSync } from 'fs'
import { importOpenSkyCsv } from '../src/main/services/identification/openSkyImporter'
import type { ImportResult } from '../src/main/services/identification/openSkyImporter'

// ── Config ──

const DB_PATH = join(process.cwd(), 'data', 'intel-board.db')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fileIdx = args.indexOf('--file')
const localFile = fileIdx !== -1 && args[fileIdx + 1] ? args[fileIdx + 1] : null

// ── Main ──

async function main(): Promise<void> {
  console.log('\n✈️  OpenSky Aircraft Database Importer')
  console.log(`   Database: ${DB_PATH}`)
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}\n`)

  // Get CSV content
  let csvText: string

  if (localFile) {
    console.log(`   Reading local file: ${localFile}`)
    csvText = readFileSync(localFile, 'utf-8')
    console.log(`   File size: ${(csvText.length / 1024 / 1024).toFixed(1)} MB`)
  } else {
    console.log('   Downloading OpenSky aircraft database...')
    const urls = [
      'https://opensky-network.org/datasets/metadata/aircraft-database-complete-2024-06.csv',
      'https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-07.csv'
    ]

    let downloaded = false
    for (const url of urls) {
      try {
        console.log(`   Trying: ${url}`)
        const response = await fetch(url, {
          headers: { 'User-Agent': 'IntelBoard/1.0' }
        })
        if (response.ok) {
          csvText = await response.text()
          console.log(`   Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB`)
          downloaded = true
          break
        } else {
          console.warn(`   HTTP ${response.status} from ${url}`)
        }
      } catch (err) {
        console.warn(`   Failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (!downloaded) {
      console.error('\n   ❌ Could not download from any URL. Use --file to specify a local CSV.\n')
      process.exit(1)
      return // for TypeScript
    }
  }

  const approxRows = csvText!.split('\n').length - 1
  console.log(`   Parsing ~${approxRows.toLocaleString()} aircraft records...\n`)

  if (dryRun) {
    // Parse but don't write to DB — just count
    const lines = csvText!.split('\n').slice(1) // skip header
    let military = 0
    let total = 0
    let skipped = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) { skipped++; continue }
      const fields = trimmed.split(',')
      if (fields.length < 30) { skipped++; continue }
      const icao24 = fields[0]?.trim().toLowerCase()
      if (!icao24 || icao24.length < 6) { skipped++; continue }
      total++

      // Quick military check
      const operator = fields[17]?.trim().toUpperCase() || ''
      const owner = fields[21]?.trim().toUpperCase() || ''
      const catDesc = fields[5]?.trim().toUpperCase() || ''
      const milKeywords = [
        'AIR FORCE', 'USAF', 'US NAVY', 'USN', 'US ARMY', 'USARMY',
        'US MARINE', 'USMC', 'MILITARY', 'NAVY', 'ARMY'
      ]
      if (milKeywords.some(kw => operator.includes(kw) || owner.includes(kw) || catDesc.includes(kw))) {
        military++
      }
    }

    console.log(`   📊 Dry Run Results:`)
    console.log(`      Total valid records: ${total.toLocaleString()}`)
    console.log(`      Estimated military:  ${military.toLocaleString()}`)
    console.log(`      Skipped (invalid):   ${skipped.toLocaleString()}`)
    console.log('\n   Run without --dry-run to import into the database.\n')
    return
  }

  // Open database and import
  console.log('   Opening database...')
  const db = new Database(DB_PATH)

  // Ensure schema exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS aircraft_registry (
      icao24 TEXT PRIMARY KEY,
      aircraft_type TEXT,
      icao_type_code TEXT,
      manufacturer TEXT,
      registration TEXT,
      operator TEXT,
      is_military BOOLEAN DEFAULT FALSE,
      is_military_verified BOOLEAN DEFAULT 0,
      category TEXT,
      looked_up_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const existingCount = (db.prepare('SELECT COUNT(*) as count FROM aircraft_registry').get() as { count: number }).count
  console.log(`   Existing aircraft_registry entries: ${existingCount.toLocaleString()}\n`)

  const result: ImportResult = importOpenSkyCsv(csvText!, db, (imported, mil) => {
    if (imported % 25000 === 0) {
      console.log(`   Progress: ${imported.toLocaleString()} imported (${mil.toLocaleString()} military)`)
    }
  })

  // Final stats
  const finalCount = (db.prepare('SELECT COUNT(*) as count FROM aircraft_registry').get() as { count: number }).count
  const milCount = (db.prepare('SELECT COUNT(*) as count FROM aircraft_registry WHERE is_military = 1').get() as { count: number }).count

  console.log('\n   ✅ Import Complete!')
  console.log(`      New entries imported: ${result.totalImported.toLocaleString()}`)
  console.log(`      New military entries: ${result.militaryImported.toLocaleString()}`)
  console.log(`      Skipped (invalid):    ${result.skipped.toLocaleString()}`)
  console.log(`      Errors:               ${result.errors}`)
  console.log(`      ─────────────────────────────────────`)
  console.log(`      Total registry size:  ${finalCount.toLocaleString()}`)
  console.log(`      Total military:       ${milCount.toLocaleString()}\n`)

  db.close()
}

try {
  main().catch((err) => {
    console.error('\n   ❌ Import failed:', err)
    process.exit(1)
  })
} catch (err) {
  console.error('\n   ❌ Fatal error:', err)
  process.exit(1)
}