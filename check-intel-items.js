const Database = require('better-sqlite3');
const db = new Database('C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db');

const stats = db.prepare(`
  SELECT COUNT(*) as total,
    SUM(CASE WHEN expires_at IS NOT NULL AND expires_at < datetime('now') THEN 1 ELSE 0 END) as expired,
    SUM(CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END) as no_expiry
  FROM intel_items
`).get();
console.log('Stats:', JSON.stringify(stats));

const recent = db.prepare(`
  SELECT tier, title, datetime(created_at, 'localtime') as created, datetime(expires_at, 'localtime') as expires
  FROM intel_items ORDER BY created_at DESC LIMIT 20
`).all();
console.log('\nRecent items:');
recent.forEach(r => console.log(`  [${r.tier}] ${r.title} | created: ${r.created} | expires: ${r.expires}`));
