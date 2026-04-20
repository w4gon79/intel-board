const Database = require('better-sqlite3');
const db = new Database('./data/intel-board.db', { readonly: true });
try {
  const info = db.pragma('table_info(aircraft_registry)');
  console.log(JSON.stringify(info, null, 2));
} catch(e) {
  console.log('Error:', e.message);
}
db.close();
