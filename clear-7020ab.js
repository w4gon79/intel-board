const { app } = require('electron');
const Database = require('better-sqlite3');
app.whenReady().then(() => {
  const db = new Database('C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db');
  try {
    const r = db.prepare("DELETE FROM aircraft_registry WHERE icao24 = '7020ab'").run();
    console.log('Deleted ' + r.changes + ' registry entries for 7020ab');
  } catch(e) {
    console.log('Error: ' + e.message);
  }
  db.close();
  app.quit();
});
