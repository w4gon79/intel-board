const Database = require('better-sqlite3');
const db = new Database('./data/intel-board.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

// Check CSG tables
const csgTables = tables.filter(t => t.name.toLowerCase().includes('csg') || t.name.toLowerCase().includes('carrier'));
for (const t of csgTables) {
  const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
  const latest = db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid DESC LIMIT 3`).all();
  console.log(`\n=== ${t.name} (${count.cnt} rows) ===`);
  console.log(JSON.stringify(latest, null, 2).substring(0, 3000));
}

// Check for USNI in any source columns
for (const t of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
    const hasSource = cols.some(c => c.name === 'source' || c.name === 'source_type' || c.name === 'sourceName');
    if (hasSource) {
      const srcCol = cols.find(c => c.name === 'source' || c.name === 'source_type' || c.name === 'sourceName').name;
      const usni = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}" WHERE "${srcCol}" LIKE '%usni%' OR "${srcCol}" LIKE '%fleet%'`).get();
      if (usni.cnt > 0) {
        console.log(`\n${t.name}.${srcCol}: ${usni.cnt} USNI rows`);
        const latest = db.prepare(`SELECT * FROM "${t.name}" WHERE "${srcCol}" LIKE '%usni%' OR "${srcCol}" LIKE '%fleet%' ORDER BY rowid DESC LIMIT 2`).all();
        console.log(JSON.stringify(latest, null, 2).substring(0, 2000));
      }
    }
  } catch(e) {}
}

db.close();
