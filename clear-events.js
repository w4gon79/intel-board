const Database = require('better-sqlite3');
const db = new Database(process.argv[1]);
try {
  const r = db.prepare('DELETE FROM tactical_events').run();
  console.log('Deleted ' + r.changes + ' tactical events');
} catch(e) {
  console.log('Error: ' + e.message);
}
db.close();
process.exit(0);
