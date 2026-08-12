const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'study_tracker.db');
const db = new sqlite3.Database(dbPath);

console.log("==========================================");
console.log("VERIFYING DATABASE & AUTHENTICATION FLOWS");
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
    const users = await query("SELECT id, name, email, created_at FROM users");
    console.log(`[PASS] Users table accessible. Total users: ${users.length}`);

    // 2. Verify Teshav user account
    const teshav = await get("SELECT * FROM users WHERE email = ?", ['teshavsharma948@gmail.com']);
    if (!teshav) {
      throw new Error("Teshav user account missing!");
    }
    console.log(`[PASS] Found account for ${teshav.email} (ID: ${teshav.id}, Name: ${teshav.name})`);

    // 3. Test Password Reset Token creation
    const testToken = 'verify_test_token_' + Date.now();
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    
    await run(
      'INSERT INTO password_reset_tokens (user_id, email, token, expires_at, used) VALUES (?, ?, ?, ?, 0)',
      [teshav.id, teshav.email, testToken, expiresAt]
    );
    console.log(`[PASS] Password reset token inserted successfully: ${testToken}`);

    // 4. Test Token retrieval
    const tokenRecord = await get('SELECT * FROM password_reset_tokens WHERE token = ?', [testToken]);
    if (!tokenRecord || tokenRecord.used !== 0) {
      throw new Error("Failed to retrieve fresh reset token!");
    }
    console.log(`[PASS] Token retrieved and validated (Expires: ${tokenRecord.expires_at})`);

    // 5. Test Password Reset & Verification
    const newPass = 'NewSecurePass2026!';
    const newHash = bcrypt.hashSync(newPass, 10);

    // Update user password and mark token used
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, teshav.id]);
    await run('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', [testToken]);

    const updatedUser = await get('SELECT * FROM users WHERE id = ?', [teshav.id]);
    const passMatches = bcrypt.compareSync(newPass, updatedUser.password_hash);
    if (!passMatches) {
      throw new Error("Password hash verification failed after reset!");
    }
    console.log(`[PASS] Password updated successfully and verified with bcrypt!`);

    // 6. Check main feature tables existence and row counts
    const tables = ['topics', 'focus_sessions', 'dsa_problems', 'projects', 'timetable_blocks', 'habits', 'notes', 'flashcards', 'user_stats'];
    for (const t of tables) {
      const rows = await query(`SELECT COUNT(*) as count FROM ${t}`);
      console.log(`[PASS] Table '${t}' verified (${rows[0].count} items)`);
    }

    console.log("\n==========================================");
    console.log("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!");
    console.log("==========================================");
  } catch (err) {
    console.error("VERIFICATION FAILED:", err);
    process.exit(1);
  } finally {
    db.close();
  }
}

testAll();
