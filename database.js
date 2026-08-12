const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'study_tracker.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    db.run('PRAGMA foreign_keys = ON;', (err) => {
      if (err) console.error('Failed to enable foreign keys:', err);
    });
  }
});

// Promisify database operations
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

// Create tables
const initDb = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          daily_goal_minutes INTEGER DEFAULT 60,
          timezone TEXT DEFAULT 'UTC',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Topics
      db.run(`
        CREATE TABLE IF NOT EXISTS topics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          date TEXT NOT NULL, -- YYYY-MM-DD
          title TEXT NOT NULL,
          subject TEXT NOT NULL,
          est_minutes INTEGER DEFAULT 0,
          priority TEXT CHECK(priority IN ('low', 'med', 'high')) DEFAULT 'med',
          status TEXT CHECK(status IN ('not started', 'in progress', 'done')) DEFAULT 'not started',
          carried_over_from INTEGER,
          order_index INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (carried_over_from) REFERENCES topics(id) ON DELETE SET NULL
        )
      `);

      // Focus sessions
      db.run(`
        CREATE TABLE IF NOT EXISTS focus_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          topic_id INTEGER,
          subject TEXT NOT NULL,
          start_time TEXT NOT NULL, -- ISO timestamp
          end_time TEXT NOT NULL, -- ISO timestamp
          duration_minutes INTEGER NOT NULL,
          type TEXT CHECK(type IN ('work', 'break')) DEFAULT 'work',
          note TEXT,
          scheduled_duration INTEGER DEFAULT 0,
          actual_duration INTEGER DEFAULT 0,
          saved_time INTEGER DEFAULT 0,
          save_time_used INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
        )
      `);

      ['scheduled_duration INTEGER DEFAULT 0', 'actual_duration INTEGER DEFAULT 0', 'saved_time INTEGER DEFAULT 0', 'save_time_used INTEGER DEFAULT 0', 'task_name TEXT'].forEach(col => {
        db.run(`ALTER TABLE focus_sessions ADD COLUMN ${col}`, () => {});
      });

      // User Stats
      db.run(`
        CREATE TABLE IF NOT EXISTS user_stats (
          user_id INTEGER PRIMARY KEY,
          total_saved_time INTEGER DEFAULT 0,
          available_saved_time INTEGER DEFAULT 0,
          weekly_saved_time INTEGER DEFAULT 0,
          monthly_saved_time INTEGER DEFAULT 0,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // DSA problems
      db.run(`
        CREATE TABLE IF NOT EXISTS dsa_problems (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          platform TEXT NOT NULL,
          url TEXT,
          pattern TEXT NOT NULL,
          difficulty TEXT CHECK(difficulty IN ('easy', 'med', 'hard')) NOT NULL,
          status TEXT CHECK(status IN ('attempted', 'solved', 'revisit')) DEFAULT 'attempted',
          time_spent_minutes INTEGER DEFAULT 0,
          date_solved TEXT, -- YYYY-MM-DD
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Projects
      db.run(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT CHECK(status IN ('planning', 'active', 'paused', 'completed')) DEFAULT 'planning',
          start_date TEXT, -- YYYY-MM-DD
          target_date TEXT, -- YYYY-MM-DD
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Project Tasks
      db.run(`
        CREATE TABLE IF NOT EXISTS project_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          done INTEGER CHECK(done IN (0, 1)) DEFAULT 0,
          due_date TEXT, -- YYYY-MM-DD
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);

      // Timetable Blocks
      db.run(`
        CREATE TABLE IF NOT EXISTS timetable_blocks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          day_of_week INTEGER CHECK(day_of_week BETWEEN 0 AND 6) NOT NULL, -- 0 = Sunday, 6 = Saturday
          start_time TEXT NOT NULL, -- HH:MM
          end_time TEXT NOT NULL, -- HH:MM
          subject TEXT NOT NULL,
          color TEXT DEFAULT '#4f46e5',
          recurring INTEGER CHECK(recurring IN (0, 1)) DEFAULT 1,
          specific_date TEXT, -- YYYY-MM-DD
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Habits
      db.run(`
        CREATE TABLE IF NOT EXISTS habits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          target_days TEXT NOT NULL, -- "0,1,2,3,4,5,6" (0=Sunday) or "daily"
          auto_linked TEXT CHECK(auto_linked IN ('none', 'focus_minutes')) DEFAULT 'none',
          target_value INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Habit Logs
      db.run(`
        CREATE TABLE IF NOT EXISTS habit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          habit_id INTEGER NOT NULL,
          date TEXT NOT NULL, -- YYYY-MM-DD
          completed INTEGER CHECK(completed IN (0, 1)) DEFAULT 0,
          FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
          UNIQUE(habit_id, date)
        )
      `);

      // Notes
      db.run(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          linked_topic_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (linked_topic_id) REFERENCES topics(id) ON DELETE SET NULL
        )
      `);

      // Timer State
      db.run(`
        CREATE TABLE IF NOT EXISTS timer_state (
          user_id INTEGER PRIMARY KEY,
          is_running INTEGER DEFAULT 0,
          mode TEXT DEFAULT 'work',
          duration INTEGER DEFAULT 1500,
          remaining_time INTEGER DEFAULT 1500,
          start_time TEXT,
          end_time TEXT,
          completed_sessions INTEGER DEFAULT 0,
          paused_state INTEGER DEFAULT 0,
          subject_text TEXT DEFAULT 'General Study',
          current_topic_id INTEGER,
          work_minutes INTEGER DEFAULT 25,
          break_minutes INTEGER DEFAULT 5,
          long_break_minutes INTEGER DEFAULT 15,
          cycles_limit INTEGER DEFAULT 4,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Flashcard decks
      db.run(`
        CREATE TABLE IF NOT EXISTS flashcard_decks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          subject TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Flashcards (spaced repetition data)
      db.run(`
        CREATE TABLE IF NOT EXISTS flashcards (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          deck_id INTEGER NOT NULL,
          front TEXT NOT NULL,
          back TEXT NOT NULL,
          ease_factor REAL DEFAULT 2.5,
          interval_days INTEGER DEFAULT 0,
          next_review_date TEXT NOT NULL, -- YYYY-MM-DD
          review_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (deck_id) REFERENCES flashcard_decks(id) ON DELETE CASCADE
        )
      `);

      // Roadmaps
      db.run(`
        CREATE TABLE IF NOT EXISTS roadmaps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          target_role TEXT,
          status TEXT CHECK(status IN ('active', 'paused', 'completed', 'draft')) DEFAULT 'active',
          difficulty TEXT CHECK(difficulty IN ('Beginner', 'Intermediate', 'Advanced', 'Expert')) DEFAULT 'Intermediate',
          duration TEXT,
          is_active INTEGER CHECK(is_active IN (0, 1)) DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Roadmap Sections
      db.run(`
        CREATE TABLE IF NOT EXISTS roadmap_sections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          roadmap_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          order_index INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE
        )
      `);

      // Roadmap Topics
      db.run(`
        CREATE TABLE IF NOT EXISTS roadmap_topics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          section_id INTEGER NOT NULL,
          roadmap_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT CHECK(status IN ('not started', 'in progress', 'completed')) DEFAULT 'not started',
          difficulty TEXT CHECK(difficulty IN ('Beginner', 'Intermediate', 'Advanced')) DEFAULT 'Intermediate',
          priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'med')) DEFAULT 'medium',
          estimated_hours REAL DEFAULT 0,
          completed_hours REAL DEFAULT 0,
          completion_date TEXT,
          notes TEXT,
          linked_project_id INTEGER,
          linked_note_id INTEGER,
          next_revision_date TEXT,
          revision_count INTEGER DEFAULT 0,
          order_index INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (section_id) REFERENCES roadmap_sections(id) ON DELETE CASCADE,
          FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE,
          FOREIGN KEY (linked_project_id) REFERENCES projects(id) ON DELETE SET NULL,
          FOREIGN KEY (linked_note_id) REFERENCES notes(id) ON DELETE SET NULL
        )
      `);

      // Roadmap Resources
      db.run(`
        CREATE TABLE IF NOT EXISTS roadmap_resources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          url TEXT,
          type TEXT CHECK(type IN ('YouTube', 'Course', 'Documentation', 'GitHub', 'Blog', 'PDF', 'Book')) DEFAULT 'Documentation',
          duration TEXT,
          completed INTEGER CHECK(completed IN (0, 1)) DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (topic_id) REFERENCES roadmap_topics(id) ON DELETE CASCADE
        )
      `);

      // Roadmap Checklists
      db.run(`
        CREATE TABLE IF NOT EXISTS roadmap_checklists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          completed INTEGER CHECK(completed IN (0, 1)) DEFAULT 0,
          order_index INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (topic_id) REFERENCES roadmap_topics(id) ON DELETE CASCADE
        )
      `);

      // Password Reset Tokens
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

      // Indexes for performance
      db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
      db.run('CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token)');
      db.run('CREATE INDEX IF NOT EXISTS idx_topics_user_date ON topics(user_id, date)');
      db.run('CREATE INDEX IF NOT EXISTS idx_focus_user_start ON focus_sessions(user_id, start_time)');
      db.run('CREATE INDEX IF NOT EXISTS idx_dsa_user_date ON dsa_problems(user_id, date_solved)');
      db.run('CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_timetable_user ON timetable_blocks(user_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date)');
      db.run('CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_flashcards_deck_review ON flashcards(deck_id, next_review_date)');
      db.run('CREATE INDEX IF NOT EXISTS idx_roadmaps_user ON roadmaps(user_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_roadmap_sections_roadmap ON roadmap_sections(roadmap_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_roadmap_topics_section ON roadmap_topics(section_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_roadmap_topics_roadmap ON roadmap_topics(roadmap_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_roadmap_topics_revision ON roadmap_topics(next_revision_date)');
      db.run('CREATE INDEX IF NOT EXISTS idx_roadmap_resources_topic ON roadmap_resources(topic_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_roadmap_checklists_topic ON roadmap_checklists(topic_id)', (err) => {
        if (err) {
          console.error('Database initialization error:', err);
          reject(err);
        } else {
          console.log('Database schema and indexes initialized.');
          resolve();
        }
      });
    });
  });
};

module.exports = {
  db,
  query,
  get,
  run,
  initDb
};
