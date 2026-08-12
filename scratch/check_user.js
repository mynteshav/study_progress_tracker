const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'study_tracker.db');
const db = new sqlite3.Database(dbPath);

console.log("Checking database:", dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
  if (err) {
    console.error("Error listing tables:", err);
    return;
  }
  console.log("Tables found:", tables.map(t => t.name));

  let pending = tables.length;
  if (pending === 0) {
    console.log("No tables found.");
    db.close();
    return;
  }

  tables.forEach(t => {
    db.all(`SELECT * FROM ${t.name}`, [], (err, rows) => {
      if (err) {
        console.error(`Error querying ${t.name}:`, err.message);
      } else {
        const matches = rows.filter(r => JSON.stringify(r).toLowerCase().includes('teshav'));
        if (matches.length > 0) {
          console.log(`\n=== MATCH FOUND IN TABLE: ${t.name} ===`);
          console.log(JSON.stringify(matches, null, 2));
        } else {
          console.log(`Table '${t.name}': ${rows.length} rows (No match for 'teshav')`);
          if (t.name === 'users' || t.name === 'user' || t.name === 'accounts') {
            console.log(`All rows in '${t.name}':`, JSON.stringify(rows, null, 2));
          }
        }
      }
      pending--;
      if (pending === 0) {
        db.close();
      }
    });
  });
});
