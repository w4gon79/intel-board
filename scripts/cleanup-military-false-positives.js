/**
 * One-time cleanup script: Reset is_military flag for entries that were
 * incorrectly classified as military by overly broad keyword matching.
 *
 * Fixes:
 *   - Turkish Airlines (THY) matched by 'TURKISH AIR' keyword
 *   - Russian Airlines matched by 'RUSSIAN AIR' keyword
 *   - Generic false positives from old isOpenSkyMilitary() regex
 *
 * Run: node scripts/cleanup-military-false-positives.js
 */

const { join } = require('path')
const { DatabaseSync } = require('node:sqlite')

const DB_PATH = join(__dirname, '..', 'data', 'intel-board.db')

try {
  const db = new DatabaseSync(DB_PATH)

  const before = db.prepare('SELECT COUNT(*) as c FROM aircraft_registry WHERE is_military = 1').get()
  console.log(`Military aircraft before cleanup: ${before.c.toLocaleString()}`)

  // Pass 1: Clear Turkish Airlines false positives
  const thy = db.prepare(`
    UPDATE aircraft_registry
    SET is_military = 0
    WHERE is_military = 1
      AND is_military_verified = 0
      AND UPPER(operator) LIKE '%TURKISH AIRLINES%'
  `).run()
  console.log(`Turkish Airlines false positives cleared: ${thy.changes.toLocaleString()}`)

  // Pass 2: Clear Russian Airlines false positives (if any)
  const rfa = db.prepare(`
    UPDATE aircraft_registry
    SET is_military = 0
    WHERE is_military = 1
      AND is_military_verified = 0
      AND UPPER(operator) LIKE '%RUSSIAN AIRLINES%'
  `).run()
  console.log(`Russian Airlines false positives cleared: ${rfa.changes.toLocaleString()}`)

  // Pass 3: Generic cleanup — clear any remaining unverified military flags
  // that don't match a legitimate military operator keyword
  const generic = db.prepare(`
    UPDATE aircraft_registry
    SET is_military = 0
    WHERE is_military_verified = 0
      AND is_military = 1
      AND operator IS NOT NULL
      AND NOT (
        UPPER(operator) LIKE '%AIR FORCE%' OR
        UPPER(operator) LIKE '%USAF%' OR
        UPPER(operator) LIKE '%US NAVY%' OR
        UPPER(operator) LIKE '%NAVY%' OR
        UPPER(operator) LIKE '%US ARMY%' OR
        UPPER(operator) LIKE '%USMC%' OR
        UPPER(operator) LIKE '%MARINE%' OR
        UPPER(operator) LIKE '%COAST GUARD%' OR
        UPPER(operator) LIKE '%MILITARY%' OR
        UPPER(operator) LIKE '%ARMY%' OR
        UPPER(operator) LIKE '%TURKISH AIR FORCE%' OR
        UPPER(operator) LIKE '%TUAF%' OR
        UPPER(operator) LIKE '%TURK HAVA%' OR
        UPPER(operator) LIKE '%RUSSIAN AIR FORCE%' OR
        UPPER(operator) LIKE '%RUSSIAN NAVY%' OR
        UPPER(category) LIKE '%MILITARY%' OR
        UPPER(category) LIKE '%NAVY%' OR
        UPPER(category) LIKE '%AIR FORCE%'
      )
  `).run()
  console.log(`Generic false positives cleared: ${generic.changes.toLocaleString()}`)

  // Pass 4: Fix flights table too
  const flights = db.prepare(`
    UPDATE flights
    SET is_military = 0
    WHERE is_military = 1
      AND icao24 IN (
        SELECT icao24 FROM aircraft_registry WHERE is_military = 0
      )
  `).run()
  console.log(`Flights table entries corrected: ${flights.changes.toLocaleString()}`)

  const after = db.prepare('SELECT COUNT(*) as c FROM aircraft_registry WHERE is_military = 1').get()
  console.log(`\nMilitary aircraft after cleanup: ${after.c.toLocaleString()}`)

  db.close()
  console.log('Done!')
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
}
