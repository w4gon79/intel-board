const Database = require('better-sqlite3');
const db = new Database('C:/Users/w4gon/Cursor Projects/intel-board/data/intel-board.db');
db.exec("DELETE FROM tactical_events WHERE event_type='task_force'");
console.log('Cleared task_force events');
db.exec("DELETE FROM intel_items WHERE title LIKE 'Task Force detected%'");
console.log('Cleared task force intel items');
db.close();
