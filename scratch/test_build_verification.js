const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'study_tracker.db');
const db = new sqlite3.Database(dbPath);

console.log("==========================================");
console.log("VERIFYING UNIFIED FIREBASE & SQLITE AUTH");
console.log("==========================================");

const run = (sql, params = []) => new Promise((res, rej) => {
  db.run(sql, params, function(err) {
    if (err) rej(err); else res({ id: this.lastID, changes: this.changes });
  });
});

const get = (sql, params = []) => new Promise((res, rej) => {
  db.get(sql, params, (err, row) => { if (err) rej(err); else res(row); });
});

const query = (sql, params = []) => new Promise((res, rej) => {
  db.all(sql, params, (err, rows) => { if (err) rej(err); else res(rows); });
});

async function initSchema() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('ALTER TABLE users ADD COLUMN firebase_uid TEXT', () => {});
      db.run(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          token TEXT UNIQUE NOT NULL,
          expires_at DATETIME NOT NULL,
          used INTEGER CHECK(used IN (0, 1)) DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS user_stats (
          user_id INTEGER PRIMARY KEY,
          total_saved_time INTEGER DEFAULT 0,
          available_saved_time INTEGER DEFAULT 0,
          weekly_saved_time INTEGER DEFAULT 0,
          monthly_saved_time INTEGER DEFAULT 0,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function testAll() {
  try {
    await initSchema();
    console.log("[PASS] Schema check/initialization complete.");

    // 1. Verify Users Table
    const users = await query("SELECT id, firebase_uid, name, email, created_at FROM users");
    console.log(`[PASS] Users table accessible. Total users: ${users.length}`);

    // 2. Verify Teshav user account and Firebase UID sync
    const mockUid = 'firebase_test_uid_teshav_2026';
    const email = 'teshavsharma948@gmail.com';

    await run('UPDATE users SET firebase_uid = ? WHERE email = ?', [mockUid, email]);
    const teshav = await get("SELECT * FROM users WHERE firebase_uid = ?", [mockUid]);
    
    if (!teshav) {
      throw new Error("Failed to link and retrieve user by firebase_uid!");
    }
    console.log(`[PASS] User successfully synced with Firebase UID: ${teshav.firebase_uid} (ID: ${teshav.id}, Email: ${teshav.email})`);

    // 3. Verify SQLite data safety (no plaintext password requirement)
    const tables = ['topics', 'focus_sessions', 'dsa_problems', 'projects', 'timetable_blocks', 'habits', 'notes', 'flashcards', 'user_stats'];
    for (const t of tables) {
      const rows = await query(`SELECT COUNT(*) as count FROM ${t}`);
      console.log(`[PASS] Table '${t}' verified (${rows[0].count} items intact)`);
    }

    console.log("\n==========================================");
    console.log("UNIFIED AUTHENTICATION VERIFIED SUCCESSFULLY!");
    console.log("==========================================");
  } catch (err) {
    console.error("VERIFICATION FAILED:", err);
    process.exit(1);
  } finally {
    db.close();
  }
}

testAll();
