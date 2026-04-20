"""Delete two orphaned task force intel items from the Baltic Sea."""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'intel-board.db')
ORPHAN_IDS = [
    '2adc4133-24d6-4224-80c2-ce29eb3d6d4c',
    '8a99ca3c-3384-4c10-888c-e7a99a1c91a9',
]

db = sqlite3.connect(DB_PATH)
cur = db.cursor()
total = 0
for orph_id in ORPHAN_IDS:
    cur.execute('DELETE FROM intel_items WHERE id = ?', (orph_id,))
    print(f'Deleted {orph_id}: {cur.rowcount} row(s)')
    total += cur.rowcount
db.commit()
print(f'\nTotal deleted: {total}')

# Verify
cur.execute(
    'SELECT id, title FROM intel_items WHERE id IN (?, ?)', ORPHAN_IDS
)
remaining = cur.fetchall()
if remaining:
    print('WARNING: Still present:', remaining)
else:
    print('All orphaned items successfully removed')
db.close()