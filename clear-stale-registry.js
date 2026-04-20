const { app } = require('electron');
const Database = require('better-sqlite3');
app.whenReady().then(() => {
  const db = new Database('C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db');
  const hexes = ['ae4ebb', '3aabfd', 'ae8953', 'ae73fe'];
  for (const hex of hexes) {
    const r = db.prepare("DELETE FROM aircraft_registry WHERE icao24 = ?").run(hex);
    console.log(hex + ': deleted ' + r.changes + ' entries');
  }
  db.close();
  app.quit();
});
