const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// Paths & States
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'study_tracker.db');
const stateFilePath = path.join(userDataPath, 'window-state.json');
const logFilePath = path.join(userDataPath, 'startup.log');

// Setup persistent logging
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, logLine, 'utf8');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

// Global Exception Handlers
process.on('uncaughtException', (error) => {
  const errMsg = error ? (error.stack || error.message || error) : 'Unknown error';
  logToFile(`CRITICAL: Uncaught Exception: ${errMsg}`);
  try {
    dialog.showErrorBox('Critical Startup Error', `A critical error occurred while starting the application:\n\n${error.message || error}`);
  } catch (e) {}
  app.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logToFile(`CRITICAL: Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

logToFile('---------------------------------------------');
logToFile('Application starting...');

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logToFile('Another instance is already running. Exiting immediately.');
  app.exit(0);
}

// Set AppUserModelId for Windows Taskbar icon grouping
if (process.platform === 'win32') {
  app.setAppUserModelId('com.studytracker.app');
}

let mainWindow = null;
let db = null;

// Initialize database
function initDatabase() {
  logToFile(`Connecting to database at: ${dbPath}`);
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      logToFile(`Database connection failed: ${err.message}`);
      try {
        dialog.showErrorBox('Database Connection Failed', `Could not open database at:\n${dbPath}\n\nError: ${err.message}`);
      } catch (e) {}
      app.exit(1);
    } else {
      logToFile('Database connection successful.');
      db.run('PRAGMA foreign_keys = ON;', (err) => {
        if (err) logToFile(`Failed to enable foreign keys: ${err.message}`);
      });
      createDatabaseSchema();
    }
  });
}

function runSchemaQuery(sql) {
  db.run(sql, (err) => {
    if (err) {
      logToFile(`Schema query failed: ${err.message}\nQuery: ${sql}`);
    }
  });
}

function createDatabaseSchema() {
  logToFile('Initializing database schema and indexes...');
  db.serialize(() => {
    // Users
    runSchemaQuery(`
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
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
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
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        topic_id INTEGER,
        subject TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
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

    // Safe column migrations for focus_sessions
    ['scheduled_duration INTEGER DEFAULT 0', 'actual_duration INTEGER DEFAULT 0', 'saved_time INTEGER DEFAULT 0', 'save_time_used INTEGER DEFAULT 0', 'task_name TEXT'].forEach(col => {
      db.run(`ALTER TABLE focus_sessions ADD COLUMN ${col}`, () => {});
    });

    // User Stats
    runSchemaQuery(`
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
    runSchemaQuery(`
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
        date_solved TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Projects
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT CHECK(status IN ('planning', 'active', 'paused', 'completed')) DEFAULT 'planning',
        start_date TEXT,
        target_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Project Tasks
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS project_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        done INTEGER CHECK(done IN (0, 1)) DEFAULT 0,
        due_date TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Timetable Blocks
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS timetable_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        day_of_week INTEGER CHECK(day_of_week BETWEEN 0 AND 6) NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        subject TEXT NOT NULL,
        color TEXT DEFAULT '#4f46e5',
        recurring INTEGER CHECK(recurring IN (0, 1)) DEFAULT 1,
        specific_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Habits
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        target_days TEXT NOT NULL,
        auto_linked TEXT CHECK(auto_linked IN ('none', 'focus_minutes')) DEFAULT 'none',
        target_value INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Habit Logs
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        completed INTEGER CHECK(completed IN (0, 1)) DEFAULT 0,
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
        UNIQUE(habit_id, date)
      )
    `);

    // Notes
    runSchemaQuery(`
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
    runSchemaQuery(`
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
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS flashcard_decks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Flashcards
    runSchemaQuery(`
      CREATE TABLE IF NOT EXISTS flashcards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id INTEGER NOT NULL,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        ease_factor REAL DEFAULT 2.5,
        interval_days INTEGER DEFAULT 0,
        next_review_date TEXT NOT NULL,
        review_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (deck_id) REFERENCES flashcard_decks(id) ON DELETE CASCADE
      )
    `);

    // Roadmaps
    runSchemaQuery(`
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
    runSchemaQuery(`
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
    runSchemaQuery(`
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
    runSchemaQuery(`
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
    runSchemaQuery(`
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

    // Indexes for speed optimization
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_topics_user_date ON topics(user_id, date)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_focus_user_start ON focus_sessions(user_id, start_time)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_dsa_user_date ON dsa_problems(user_id, date_solved)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_timetable_user ON timetable_blocks(user_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_flashcards_deck_review ON flashcards(deck_id, next_review_date)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_roadmaps_user ON roadmaps(user_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_roadmap_sections_roadmap ON roadmap_sections(roadmap_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_roadmap_topics_section ON roadmap_topics(section_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_roadmap_topics_roadmap ON roadmap_topics(roadmap_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_roadmap_topics_revision ON roadmap_topics(next_revision_date)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_roadmap_resources_topic ON roadmap_resources(topic_id)');
    runSchemaQuery('CREATE INDEX IF NOT EXISTS idx_roadmap_checklists_topic ON roadmap_checklists(topic_id)');
    
    logToFile('SQLite database schema and indexes initialized.');
  });
}

// Window Bounds Memory
function getWindowState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    }
  } catch (err) {
    logToFile(`Failed to load window state file: ${err.message}`);
  }
  return { width: 1400, height: 900, x: undefined, y: undefined };
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(stateFilePath, JSON.stringify({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y
    }), 'utf8');
  } catch (err) {
    logToFile(`Failed to save window state: ${err.message}`);
  }
}

function createWindow() {
  logToFile('Creating BrowserWindow...');
  const state = getWindowState();

  // Validate loaded coordinates are within visible display bounds
  let x = state.x;
  let y = state.y;
  if (x !== undefined && y !== undefined) {
    const displays = screen.getAllDisplays();
    const margin = 100;
    const overlaps = displays.some(display => {
      const bounds = display.bounds;
      return (
        x + (state.width || 1200) - margin > bounds.x &&
        x + margin < bounds.x + bounds.width &&
        y + (state.height || 700) - margin > bounds.y &&
        y + margin < bounds.y + bounds.height
      );
    });

    if (!overlaps) {
      logToFile(`Loaded window position (${x}, ${y}) is completely off-screen. Centering instead.`);
      x = undefined;
      y = undefined;
    }
  }

  const icoIconPath = path.join(__dirname, 'build', 'icon.ico');
  const pngIconPath = path.join(__dirname, 'build', 'icon.png');
  const windowIcon = process.platform === 'win32'
    ? (fs.existsSync(icoIconPath) ? icoIconPath : (fs.existsSync(pngIconPath) ? pngIconPath : undefined))
    : (fs.existsSync(pngIconPath) ? pngIconPath : undefined);

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: x,
    y: y,
    minWidth: 1200,
    minHeight: 700,
    title: 'Study Tracker',
    icon: windowIcon,
    backgroundColor: '#070913',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  if (x === undefined || y === undefined) {
    mainWindow.center();
  }

  // Load appropriate target url
  const isDev = !app.isPackaged;
  if (isDev) {
    logToFile('Loading local Vite dev server URL...');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    logToFile('Loading packaged index.html file...');
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Setup fail load event handler
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logToFile(`CRITICAL: Failed to load URL: ${validatedURL}, Error: ${errorDescription} (${errorCode})`);
    try {
      dialog.showErrorBox('Application Load Error', `Failed to load resource: ${errorDescription} (${errorCode})\nURL: ${validatedURL}`);
    } catch (e) {}
    app.exit(1);
  });

  // Guard against silent hangs: exit if window is not shown within 10 seconds
  const loadTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      logToFile('CRITICAL: Application loading timed out (10s). Exiting.');
      try {
        dialog.showErrorBox('Application Load Timeout', 'The application took too long to load and will now close.');
      } catch (e) {}
      app.exit(1);
    }
  }, 10000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(loadTimeout);
    logToFile('BrowserWindow ready-to-show event fired. Showing window.');
    mainWindow.show();
  });

  mainWindow.on('close', () => {
    logToFile('BrowserWindow close event fired. Saving window state...');
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    logToFile('BrowserWindow closed event fired.');
    mainWindow = null;
  });
}

// IPC Handlers mapping React -> SQLite
ipcMain.handle('db-query', async (event, sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (!db) {
      return reject(new Error('Database not initialized'));
    }
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('db-run', async (event, sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (!db) {
      return reject(new Error('Database not initialized'));
    }
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
});

ipcMain.handle('db-get', async (event, sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (!db) {
      return reject(new Error('Database not initialized'));
    }
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
});

ipcMain.handle('bcrypt-hash', async (event, password) => {
  return bcrypt.hash(password, 10);
});

ipcMain.handle('bcrypt-compare', async (event, password, hash) => {
  return bcrypt.compare(password, hash);
});

// App events
app.on('second-instance', () => {
  logToFile('Second instance launch detected. Activating primary window.');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  logToFile('Electron app is ready. Initializing database and window...');
  initDatabase();
  createWindow();
});

app.on('window-all-closed', () => {
  logToFile('All windows closed. Cleaning up database and quitting...');
  if (db) {
    try {
      db.close((err) => {
        if (err) logToFile(`Error closing database: ${err.message}`);
        else logToFile('Database closed successfully.');
        if (process.platform !== 'darwin') {
          app.quit();
        }
      });
    } catch (err) {
      logToFile(`Exception thrown while closing database: ${err.message}`);
      if (process.platform !== 'darwin') {
        app.quit();
      }
    }
  } else {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});

app.on('activate', () => {
  logToFile('App activate event fired.');
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
