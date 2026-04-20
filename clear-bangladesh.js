const { app } = require('electron');
const Database = require('better-sqlite3');
app.whenReady().then(() => {
  const db = new Database('C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db');
  try {
    // Find all Bangladesh hexes (70xxxx) that are flagged military
    const bad = db.prepare("SELECT icao24, operator, is_military, category FROM aircraft_registry WHERE icao24 LIKE '70%' AND is_military = 1").all();
    console.log('Bangladeshi military entries:', JSON.stringify(bad));
    
    // Delete them all so HexDB re-looks them up
    const r = db.prepare("DELETE FROM aircraft_registry WHERE icao24 LIKE '70%' AND is_military = 1").run();
    console.log('Deleted ' + r.changes + ' bad entries');
  } catch(e) {
    console.log('Error: ' + e.message);
  }
  db.close();
  app.quit();
});
