const Database = require('better-sqlite3');
const db = new Database('C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db', { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(x => x.name).join(', '));

const ar = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='aircraft_registry'").all();
if (ar.length > 0) {
  const c = db.prepare('SELECT COUNT(*) as cnt FROM aircraft_registry').get();
  console.log('Cached aircraft:', c.cnt);
  db.prepare('SELECT * FROM aircraft_registry LIMIT 10').all().forEach(r => console.log(JSON.stringify(r)));
} else {
  console.log('aircraft_registry table NOT FOUND');
}

// Military flights with aircraft_type
const typed = db.prepare("SELECT icao24, callsign, aircraft_type, is_military FROM flights WHERE is_military = 1 AND aircraft_type IS NOT NULL LIMIT 10").all();
console.log('\nMilitary flights with type resolved:', typed.length);
typed.forEach(r => console.log(JSON.stringify(r)));

// Military flights without type (pending lookup)
const untyped = db.prepare("SELECT DISTINCT icao24, callsign FROM flights WHERE is_military = 1 AND aircraft_type IS NULL LIMIT 10").all();
console.log('\nMilitary flights WITHOUT type (pending):', untyped.length);
untyped.forEach(r => console.log(JSON.stringify(r)));

db.close();
