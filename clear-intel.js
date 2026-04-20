const { app } = require('electron');
const Database = require('better-sqlite3');
app.whenReady().then(() => {
  const db = new Database('C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db');
  try {
    const r1 = db.prepare("DELETE FROM intel_items WHERE categories LIKE '%tactical%'").run();
    console.log('Deleted ' + r1.changes + ' tactical intel items');
  } catch(e) {
    console.log('Error: ' + e.message);
  }
  db.close();
  app.quit();
});
