/**
 * One-time cleanup script: deduplicate existing intel items in the database.
 *
 * Groups items by title similarity (>75% word overlap + same region),
 * keeps the oldest item in each group, and deletes the rest.
 *
 * Usage:
 *   npx tsx scripts/dedup-intel-items.ts
 *
 * Or with a dry-run (no deletions, just logs what would be removed):
 *   npx tsx scripts/dedup-intel-items.ts --dry-run
 *
 * IMPORTANT: This script requires better-sqlite3 compiled for your system Node.js,
 * which may differ from the Electron build. If you get a NODE_MODULE_VERSION error,
 * the dedup runs automatically on app startup via `dedupExistingIntelItems()` in
 * processor.ts instead. Just launch the app and check the console logs.
 */

import Database from 'better-sqlite3'
import { join } from 'path'

// ── Config ──
const DB_PATH = join(process.cwd(), 'data', 'intel-board.db')
const WORD_OVERLAP_THRESHOLD = 0.75
const dryRun = process.argv.includes('--dry-run')

// ── Title normalization (same logic as processor.ts) ──

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function wordOverlap(titleA: string, titleB: string): number {
  const wordsA = new Set(titleA.split(' ').filter(Boolean))
  const wordsB = new Set(titleB.split(' ').filter(Boolean))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let overlap = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++
  }

  const denominator = Math.min(wordsA.size, wordsB.size)
  return overlap / denominator
}

// ── Main ──

interface IntelItemRow {
  id: string
  title: string
  region: string | null
  created_at: string
}

function main(): void {
  console.log(`\n🔍 Intel Item Deduplication Cleanup`)
  console.log(`   Database: ${DB_PATH}`)
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no deletions)' : 'LIVE (will delete duplicates)'}\n`)

  const db = new Database(DB_PATH, { readonly: dryRun })

  // Load all intel items, ordered by created_at ASC (oldest first)
  const items = db.prepare(
    'SELECT id, title, region, created_at FROM intel_items ORDER BY created_at ASC'
  ).all() as IntelItemRow[]

  console.log(`   Total intel items: ${items.length}`)

  // Build normalized titles
  const normalized = items.map((item) => ({
    ...item,
    normalizedTitle: normalizeTitle(item.title)
  }))

  // Group duplicates: for each item, find if an older item in the same region has >75% word overlap
  const idsToDelete = new Set<string>()
  let duplicateGroups = 0

  // Track which items are "kept" (first occurrence of each unique story)
  const kept: { normalizedTitle: string; region: string | null }[] = []

  for (const item of normalized) {
    let isDuplicate = false

    for (const existing of kept) {
      // Same region check
      if (item.region !== existing.region) continue

      const overlap = wordOverlap(item.normalizedTitle, existing.normalizedTitle)
      if (overlap > WORD_OVERLAP_THRESHOLD) {
        isDuplicate = true
        idsToDelete.add(item.id)
        break
      }
    }

    if (!isDuplicate) {
      kept.push({ normalizedTitle: item.normalizedTitle, region: item.region })
    } else {
      duplicateGroups++
    }
  }

  console.log(`   Unique items (keeping): ${kept.length}`)
  console.log(`   Duplicate items (removing): ${idsToDelete.size}`)
  console.log(`   Duplicate groups found: ${duplicateGroups}\n`)

  if (idsToDelete.size === 0) {
    console.log('   ✅ No duplicates found. Database is clean!\n')
    db.close()
    return
  }

  // Log some example duplicates
  console.log(`   Example duplicates being removed:`)
  const examples = normalized.filter((item) => idsToDelete.has(item.id)).slice(0, 10)
  for (const ex of examples) {
    console.log(`     - [${ex.region ?? 'no region'}] "${ex.title}"`)
  }
  if (idsToDelete.size > 10) {
    console.log(`     ... and ${idsToDelete.size - 10} more`)
  }
  console.log()

  if (dryRun) {
    console.log('   🏜️  Dry run — no changes made. Run without --dry-run to delete duplicates.\n')
    db.close()
    return
  }

  // Delete duplicates in a transaction
  const deleteStmt = db.prepare('DELETE FROM intel_items WHERE id = ?')
  const deleteMany = db.transaction((ids: Set<string>) => {
    let count = 0
    for (const id of ids) {
      deleteStmt.run(id)
      count++
    }
    return count
  })

  const deleted = deleteMany(idsToDelete)
  console.log(`   ✅ Deleted ${deleted} duplicate intel items.\n`)

  // Verify
  const remaining = db.prepare('SELECT COUNT(*) as count FROM intel_items').get() as { count: number }
  console.log(`   Remaining intel items: ${remaining.count}\n`)

  db.close()
}

try {
  main()
} catch (err) {
  console.error('❌ Error running dedup cleanup:', err)
  process.exit(1)
}