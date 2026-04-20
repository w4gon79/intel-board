/**
 * Cleanup script: delete the two orphaned task force intel items
 * left behind in the Baltic Sea.
 *
 * Run: node scripts/cleanup-orphaned-intel.js
 */

const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = path.resolve(__dirname, '..', 'data', 'intel-board.db')

const ORPHAN_IDS = [
  '2adc4133-24d6-4224-80c2-ce29eb3d6d4c',
  '8a99ca3c-3384-4c10-888c-e7a99a1c91a9'
]

try {
  const db = Database(DB_PATH)
  const deleteStmt = db.prepare('DELETE FROM intel_items WHERE id = ?')

  const deleteMany = db.transaction((ids) => {
    let total = 0
    for (const id of ids) {
      const result = deleteStmt.run(id)
      console.log(`Deleted ${id}: ${result.changes} row(s)`)
      total += result.changes
    }
    return total
  })

  const deleted = deleteMany(ORPHAN_IDS)
  console.log(`\nTotal orphaned intel items deleted: ${deleted}`)

  // Verify they're gone
  const remaining = db.prepare(
    `SELECT id, title, latitude, longitude FROM intel_items WHERE id IN (${ORPHAN_IDS.map(() => '?').join(',')})`
  ).all(...ORPHAN_IDS)

  if (remaining.length > 0) {
    console.log('\n⚠️  Still present:')
    remaining.forEach(r => console.log(`  ${r.id}: ${r.title} (${r.latitude}, ${r.longitude})`))
  } else {
    console.log('✅ All orphaned items successfully removed')
  }

  db.close()
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
}