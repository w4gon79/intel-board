const { app } = require('electron');
const Database = require('better-sqlite3');
app.whenReady().then(() => {
  const dbPath = 'C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db';
  const db = new Database(dbPath);
  try {
    const r = db.prepare('DELETE FROM tactical_events').run();
    console.log('Deleted ' + r.changes + ' tactical events');
  } catch(e) {
    console.log('Error: ' + e.message);
  }
  db.close();
  app.quit();
});
