require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbHelpers = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_study_tracker_key_2026_safe';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
dbHelpers.initDb()
  .then(() => console.log('Database initialized successfully.'))
  .catch((err) => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user; // { id, email }
    next();
  });
};

// ----------------------------------------------------
// AUTHENTICATION & PROFILE ENDPOINTS
// ----------------------------------------------------

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields (email, password, name) are required' });
  }
  
  try {
    const existingUser = await dbHelpers.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await dbHelpers.run(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase().trim(), passwordHash]
    );
    
    const token = jwt.sign({ id: result.id, email: email.toLowerCase().trim() }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: result.id, name: name.trim(), email: email.toLowerCase().trim(), isNew: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  try {
    const user = await dbHelpers.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        daily_goal_minutes: user.daily_goal_minutes,
        timezone: user.timezone,
        isNew: user.daily_goal_minutes === 60 && !user.timezone
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get User Profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await dbHelpers.get('SELECT id, name, email, daily_goal_minutes, timezone, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Profile Setup / Update
app.post('/api/auth/profile-setup', authenticateToken, async (req, res) => {
  const { name, daily_goal_minutes, timezone } = req.body;
  if (!name || daily_goal_minutes === undefined || !timezone) {
    return res.status(400).json({ error: 'All profile setup fields (name, daily_goal_minutes, timezone) are required' });
  }
  
  if (parseInt(daily_goal_minutes) <= 0) {
    return res.status(400).json({ error: 'Daily goal must be a positive number of minutes' });
  }
  
  try {
    await dbHelpers.run(
      'UPDATE users SET name = ?, daily_goal_minutes = ?, timezone = ? WHERE id = ?',
      [name.trim(), parseInt(daily_goal_minutes), timezone.trim(), req.user.id]
    );
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});


// ----------------------------------------------------
// TODAY'S TOPICS ENDPOINTS
// ----------------------------------------------------

// Get topics for a specific date
app.get('/api/topics', authenticateToken, async (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  if (!date) return res.status(400).json({ error: 'Date parameter is required' });
  
  try {
    const topics = await dbHelpers.query(
      'SELECT * FROM topics WHERE user_id = ? AND date = ? ORDER BY order_index ASC, id ASC',
      [req.user.id, date]
    );
    res.json(topics);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

// Add a topic
app.post('/api/topics', authenticateToken, async (req, res) => {
  const { date, title, subject, est_minutes, priority, status } = req.body;
  if (!date || !title || !subject) {
    return res.status(400).json({ error: 'Date, title, and subject are required' });
  }
  
  try {
    // Get max order index for this date
    const maxOrder = await dbHelpers.get(
      'SELECT MAX(order_index) as max_val FROM topics WHERE user_id = ? AND date = ?',
      [req.user.id, date]
    );
    const nextOrder = (maxOrder && maxOrder.max_val !== null) ? maxOrder.max_val + 1 : 0;

    const result = await dbHelpers.run(
      `INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, date, title.trim(), subject.trim(), parseInt(est_minutes) || 0, priority || 'med', status || 'not started', nextOrder]
    );
    
    const newTopic = await dbHelpers.get('SELECT * FROM topics WHERE id = ?', [result.id]);
    res.status(201).json(newTopic);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add topic' });
  }
});

// Update a topic
app.put('/api/topics/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, subject, est_minutes, priority, status } = req.body;
  
  try {
    const topic = await dbHelpers.get('SELECT * FROM topics WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    
    await dbHelpers.run(
      `UPDATE topics SET title = ?, subject = ?, est_minutes = ?, priority = ?, status = ? WHERE id = ?`,
      [
        title !== undefined ? title.trim() : topic.title,
        subject !== undefined ? subject.trim() : topic.subject,
        est_minutes !== undefined ? parseInt(est_minutes) : topic.est_minutes,
        priority !== undefined ? priority : topic.priority,
        status !== undefined ? status : topic.status,
        id
      ]
    );
    
    const updatedTopic = await dbHelpers.get('SELECT * FROM topics WHERE id = ?', [id]);
    res.json(updatedTopic);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update topic' });
  }
});

// Delete a topic
app.delete('/api/topics/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const topic = await dbHelpers.get('SELECT * FROM topics WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    
    await dbHelpers.run('DELETE FROM topics WHERE id = ?', [id]);
    res.json({ message: 'Topic deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete topic' });
  }
});

// Carry-over topics from previous date
app.post('/api/topics/carry-over', authenticateToken, async (req, res) => {
  const { fromDate, toDate } = req.body;
  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'fromDate and toDate are required' });
  }
  
  try {
    // Get incomplete topics from fromDate that haven't been carried over yet
    const incompleteTopics = await dbHelpers.query(
      `SELECT * FROM topics 
       WHERE user_id = ? AND date = ? AND status != 'done'
         AND id NOT IN (SELECT carried_over_from FROM topics WHERE user_id = ? AND date = ? AND carried_over_from IS NOT NULL)`,
      [req.user.id, fromDate, req.user.id, toDate]
    );
    
    const carried = [];
    for (const topic of incompleteTopics) {
      // Get max order index for toDate
      const maxOrder = await dbHelpers.get(
        'SELECT MAX(order_index) as max_val FROM topics WHERE user_id = ? AND date = ?',
        [req.user.id, toDate]
      );
      const nextOrder = (maxOrder && maxOrder.max_val !== null) ? maxOrder.max_val + 1 : 0;
      
      const result = await dbHelpers.run(
        `INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status, carried_over_from, order_index)
         VALUES (?, ?, ?, ?, ?, ?, 'not started', ?, ?)`,
        [req.user.id, toDate, topic.title, topic.subject, topic.est_minutes, topic.id, nextOrder]
      );
      carried.push(result.id);
    }
    
    res.json({ message: `Successfully carried over ${carried.length} topics.`, ids: carried });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to carry-over topics' });
  }
});

// Reorder topics
app.post('/api/topics/reorder', authenticateToken, async (req, res) => {
  const { topicIds, date } = req.body; // Array of IDs in the new order
  if (!topicIds || !Array.isArray(topicIds) || !date) {
    return res.status(400).json({ error: 'topicIds array and date are required' });
  }
  
  try {
    for (let index = 0; index < topicIds.length; index++) {
      const id = topicIds[index];
      await dbHelpers.run(
        'UPDATE topics SET order_index = ? WHERE id = ? AND user_id = ? AND date = ?',
        [index, id, req.user.id, date]
      );
    }
    res.json({ message: 'Topics reordered successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder topics' });
  }
});


// ----------------------------------------------------
// FOCUS TIMER ENDPOINTS
// ----------------------------------------------------

// Get focus sessions
app.get('/api/focus', authenticateToken, async (req, res) => {
  try {
    const sessions = await dbHelpers.query(
      'SELECT * FROM focus_sessions WHERE user_id = ? ORDER BY start_time DESC',
      [req.user.id]
    );
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch focus sessions' });
  }
});

// Log focus session and trigger habit updates
app.post('/api/focus', authenticateToken, async (req, res) => {
  const { topic_id, subject, start_time, end_time, duration_minutes, type, note } = req.body;
  if (!subject || !start_time || !end_time || !duration_minutes || !type) {
    return res.status(400).json({ error: 'Required fields missing: subject, start_time, end_time, duration_minutes, type' });
  }
  
  try {
    const result = await dbHelpers.run(
      `INSERT INTO focus_sessions (user_id, topic_id, subject, start_time, end_time, duration_minutes, type, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, topic_id || null, subject.trim(), start_time, end_time, parseInt(duration_minutes), type, note || '']
    );
    
    // Auto-update habit if user completed focused minutes
    if (type === 'work') {
      const sessionDate = start_time.split('T')[0];
      
      // Calculate total work minutes today
      const totalToday = await dbHelpers.get(
        `SELECT SUM(duration_minutes) as mins FROM focus_sessions 
         WHERE user_id = ? AND type = 'work' AND date(start_time) = date(?)`,
        [req.user.id, sessionDate]
      );
      const totalMinutes = (totalToday && totalToday.mins) || 0;
      
      // Get all user habits linked to focus minutes
      const linkedHabits = await dbHelpers.query(
        `SELECT * FROM habits WHERE user_id = ? AND auto_linked = 'focus_minutes'`,
        [req.user.id]
      );
      
      for (const habit of linkedHabits) {
        const completed = totalMinutes >= habit.target_value ? 1 : 0;
        
        // Insert or update habit log
        await dbHelpers.run(
          `INSERT INTO habit_logs (habit_id, date, completed)
           VALUES (?, ?, ?)
           ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed`,
          [habit.id, sessionDate, completed]
        );
      }
    }
    
    const loggedSession = await dbHelpers.get('SELECT * FROM focus_sessions WHERE id = ?', [result.id]);
    res.status(201).json(loggedSession);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log focus session' });
  }
});


// ----------------------------------------------------
// DSA PRACTICE ENDPOINTS
// ----------------------------------------------------

// Get all problems
app.get('/api/dsa', authenticateToken, async (req, res) => {
  try {
    const problems = await dbHelpers.query(
      'SELECT * FROM dsa_problems WHERE user_id = ? ORDER BY date_solved DESC, id DESC',
      [req.user.id]
    );
    res.json(problems);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch DSA problems' });
  }
});

// Log a problem
app.post('/api/dsa', authenticateToken, async (req, res) => {
  const { title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes } = req.body;
  if (!title || !platform || !pattern || !difficulty) {
    return res.status(400).json({ error: 'Title, platform, pattern, and difficulty are required' });
  }
  
  try {
    const result = await dbHelpers.run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        title.trim(),
        platform.trim(),
        url ? url.trim() : null,
        pattern.trim(),
        difficulty,
        status || 'attempted',
        parseInt(time_spent_minutes) || 0,
        date_solved || null,
        notes || ''
      ]
    );
    const newProblem = await dbHelpers.get('SELECT * FROM dsa_problems WHERE id = ?', [result.id]);
    res.status(201).json(newProblem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log problem' });
  }
});

// Update problem
app.put('/api/dsa/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes } = req.body;
  
  try {
    const prob = await dbHelpers.get('SELECT * FROM dsa_problems WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!prob) return res.status(404).json({ error: 'Problem not found' });
    
    await dbHelpers.run(
      `UPDATE dsa_problems SET title = ?, platform = ?, url = ?, pattern = ?, difficulty = ?, status = ?,
                             time_spent_minutes = ?, date_solved = ?, notes = ? WHERE id = ?`,
      [
        title !== undefined ? title.trim() : prob.title,
        platform !== undefined ? platform.trim() : prob.platform,
        url !== undefined ? url.trim() : prob.url,
        pattern !== undefined ? pattern.trim() : prob.pattern,
        difficulty !== undefined ? difficulty : prob.difficulty,
        status !== undefined ? status : prob.status,
        time_spent_minutes !== undefined ? parseInt(time_spent_minutes) : prob.time_spent_minutes,
        date_solved !== undefined ? date_solved : prob.date_solved,
        notes !== undefined ? notes : prob.notes,
        id
      ]
    );
    
    const updated = await dbHelpers.get('SELECT * FROM dsa_problems WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update problem' });
  }
});

// Delete problem
app.delete('/api/dsa/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const prob = await dbHelpers.get('SELECT * FROM dsa_problems WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!prob) return res.status(404).json({ error: 'Problem not found' });
    
    await dbHelpers.run('DELETE FROM dsa_problems WHERE id = ?', [id]);
    res.json({ message: 'Problem deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete problem' });
  }
});

// Spaced revision queue (revisit status)
app.get('/api/dsa/revision', authenticateToken, async (req, res) => {
  try {
    const problems = await dbHelpers.query(
      "SELECT * FROM dsa_problems WHERE user_id = ? AND status = 'revisit' ORDER BY date_solved ASC, id ASC",
      [req.user.id]
    );
    res.json(problems);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch revision queue' });
  }
});


// ----------------------------------------------------
// PROJECTS ENDPOINTS
// ----------------------------------------------------

// Get all projects with subtasks
app.get('/api/projects', authenticateToken, async (req, res) => {
  try {
    const projects = await dbHelpers.query(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY start_date DESC',
      [req.user.id]
    );
    
    for (const project of projects) {
      project.tasks = await dbHelpers.query(
        'SELECT * FROM project_tasks WHERE project_id = ? ORDER BY due_date ASC, id ASC',
        [project.id]
      );
    }
    
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Create project
app.post('/api/projects', authenticateToken, async (req, res) => {
  const { name, description, status, start_date, target_date } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  
  try {
    const result = await dbHelpers.run(
      `INSERT INTO projects (user_id, name, description, status, start_date, target_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, name.trim(), description || '', status || 'planning', start_date || null, target_date || null]
    );
    const newProj = await dbHelpers.get('SELECT * FROM projects WHERE id = ?', [result.id]);
    newProj.tasks = [];
    res.status(201).json(newProj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update project
app.put('/api/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, description, status, start_date, target_date } = req.body;
  
  try {
    const proj = await dbHelpers.get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    
    await dbHelpers.run(
      `UPDATE projects SET name = ?, description = ?, status = ?, start_date = ?, target_date = ? WHERE id = ?`,
      [
        name !== undefined ? name.trim() : proj.name,
        description !== undefined ? description : proj.description,
        status !== undefined ? status : proj.status,
        start_date !== undefined ? start_date : proj.start_date,
        target_date !== undefined ? target_date : proj.target_date,
        id
      ]
    );
    
    const updated = await dbHelpers.get('SELECT * FROM projects WHERE id = ?', [id]);
    updated.tasks = await dbHelpers.query('SELECT * FROM project_tasks WHERE project_id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete project
app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const proj = await dbHelpers.get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    
    await dbHelpers.run('DELETE FROM projects WHERE id = ?', [id]);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Create task inside project
app.post('/api/projects/:id/tasks', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, due_date } = req.body;
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  
  try {
    const proj = await dbHelpers.get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    
    const result = await dbHelpers.run(
      'INSERT INTO project_tasks (project_id, title, done, due_date) VALUES (?, ?, 0, ?)',
      [id, title.trim(), due_date || null]
    );
    const newTask = await dbHelpers.get('SELECT * FROM project_tasks WHERE id = ?', [result.id]);
    res.status(201).json(newTask);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Toggle/Update task inside project
app.put('/api/projects/:id/tasks/:taskId', authenticateToken, async (req, res) => {
  const { id, taskId } = req.params;
  const { title, done, due_date } = req.body;
  
  try {
    const proj = await dbHelpers.get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    
    const task = await dbHelpers.get('SELECT * FROM project_tasks WHERE id = ? AND project_id = ?', [taskId, id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    
    await dbHelpers.run(
      'UPDATE project_tasks SET title = ?, done = ?, due_date = ? WHERE id = ?',
      [
        title !== undefined ? title.trim() : task.title,
        done !== undefined ? (done ? 1 : 0) : task.done,
        due_date !== undefined ? due_date : task.due_date,
        taskId
      ]
    );
    
    const updated = await dbHelpers.get('SELECT * FROM project_tasks WHERE id = ?', [taskId]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete task
app.delete('/api/projects/:id/tasks/:taskId', authenticateToken, async (req, res) => {
  const { id, taskId } = req.params;
  try {
    const proj = await dbHelpers.get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    
    await dbHelpers.run('DELETE FROM project_tasks WHERE id = ? AND project_id = ?', [taskId, id]);
    res.json({ message: 'Task deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});


// ----------------------------------------------------
// LANE TIMETABLE ENDPOINTS
// ----------------------------------------------------

// Timetable Conflict Detection helper
async function checkBlockConflict(userId, dayOfWeek, startTime, endTime, recurring, specificDate, blockId = null) {
  let queryStr = `SELECT * FROM timetable_blocks WHERE user_id = ? AND day_of_week = ?`;
  const params = [userId, dayOfWeek];
  if (blockId) {
    queryStr += ` AND id != ?`;
    params.push(blockId);
  }
  
  const existing = await dbHelpers.query(queryStr, params);
  
  for (const block of existing) {
    // Check date correlation: if both are specific dates and they are different, no conflict.
    // If one or both are recurring, they will overlap on that weekday.
    let dateApplies = false;
    if (recurring || block.recurring) {
      dateApplies = true;
    } else if (specificDate && block.specific_date && specificDate === block.specific_date) {
      dateApplies = true;
    }
    
    if (dateApplies) {
      // Overlap: start1 < end2 AND end1 > start2
      if (startTime < block.end_time && endTime > block.start_time) {
        return block;
      }
    }
  }
  return null;
}

// Get all timetable blocks
app.get('/api/timetable', authenticateToken, async (req, res) => {
  try {
    const blocks = await dbHelpers.query(
      'SELECT * FROM timetable_blocks WHERE user_id = ? ORDER BY day_of_week ASC, start_time ASC',
      [req.user.id]
    );
    res.json(blocks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch timetable blocks' });
  }
});

// Add timetable block
app.post('/api/timetable', authenticateToken, async (req, res) => {
  const { day_of_week, start_time, end_time, subject, color, recurring, specific_date, force, apply_to_all_days } = req.body;
  if (day_of_week === undefined || !start_time || !end_time || !subject) {
    return res.status(400).json({ error: 'Day of week, start time, end time, and subject are required' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'Start time must be before end time' });
  }
  
  try {
    const isRecurring = recurring ? 1 : 0;
    
    // Conflict Detection
    if (!force) {
      if (apply_to_all_days) {
        for (let day = 0; day <= 6; day++) {
          const conflict = await checkBlockConflict(req.user.id, day, start_time, end_time, isRecurring, specific_date);
          if (conflict) {
            const isExactDuplicate = conflict.start_time === start_time && conflict.end_time === end_time;
            if (!isExactDuplicate) {
              return res.status(409).json({
                error: 'TIMETABLE_CONFLICT',
                message: `Overlaps with "${conflict.subject}" on some day(s) (${conflict.start_time} - ${conflict.end_time})`
              });
            }
          }
        }
      } else {
        const conflict = await checkBlockConflict(req.user.id, parseInt(day_of_week), start_time, end_time, isRecurring, specific_date);
        if (conflict) {
          return res.status(409).json({
            error: 'TIMETABLE_CONFLICT',
            message: `Overlaps with "${conflict.subject}" (${conflict.start_time} - ${conflict.end_time})`
          });
        }
      }
    }
    
    if (apply_to_all_days) {
      let appliedCount = 0;
      let skippedCount = 0;
      for (let day = 0; day <= 6; day++) {
        const duplicate = await dbHelpers.get(
          'SELECT id FROM timetable_blocks WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ?',
          [req.user.id, day, start_time, end_time]
        );
        if (duplicate) {
          skippedCount++;
        } else {
          await dbHelpers.run(
            `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, day, start_time, end_time, subject.trim(), color || '#4f46e5', isRecurring, isRecurring ? null : specific_date || null]
          );
          appliedCount++;
        }
      }
      res.status(201).json({ appliedCount, skippedCount });
    } else {
      const result = await dbHelpers.run(
        `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, parseInt(day_of_week), start_time, end_time, subject.trim(), color || '#4f46e5', isRecurring, isRecurring ? null : specific_date || null]
      );
      
      const block = await dbHelpers.get('SELECT * FROM timetable_blocks WHERE id = ?', [result.id]);
      res.status(201).json(block);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add timetable block' });
  }
});

// Update timetable block
app.put('/api/timetable/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { day_of_week, start_time, end_time, subject, color, recurring, specific_date, force, apply_to_all_days } = req.body;
  
  try {
    const block = await dbHelpers.get('SELECT * FROM timetable_blocks WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!block) return res.status(404).json({ error: 'Block not found' });
    
    const uDay = day_of_week !== undefined ? parseInt(day_of_week) : block.day_of_week;
    const uStart = start_time || block.start_time;
    const uEnd = end_time || block.end_time;
    const uRecurring = recurring !== undefined ? (recurring ? 1 : 0) : block.recurring;
    const uSpecific = specific_date !== undefined ? (uRecurring ? null : specific_date) : block.specific_date;
    const uSubject = subject !== undefined ? subject.trim() : block.subject;
    const uColor = color || block.color;
    
    if (uStart >= uEnd) {
      return res.status(400).json({ error: 'Start time must be before end time' });
    }
    
    if (!force) {
      if (apply_to_all_days) {
        for (let day = 0; day <= 6; day++) {
          const conflict = await checkBlockConflict(req.user.id, day, uStart, uEnd, uRecurring, uSpecific, day === uDay ? id : null);
          if (conflict) {
            const isExactDuplicate = conflict.start_time === uStart && conflict.end_time === uEnd;
            if (!isExactDuplicate) {
              return res.status(409).json({
                error: 'TIMETABLE_CONFLICT',
                message: `Overlaps with "${conflict.subject}" on some day(s) (${conflict.start_time} - ${conflict.end_time})`
              });
            }
          }
        }
      } else {
        const conflict = await checkBlockConflict(req.user.id, uDay, uStart, uEnd, uRecurring, uSpecific, id);
        if (conflict) {
          return res.status(409).json({
            error: 'TIMETABLE_CONFLICT',
            message: `Overlaps with "${conflict.subject}" (${conflict.start_time} - ${conflict.end_time})`
          });
        }
      }
    }
    
    if (apply_to_all_days) {
      let appliedCount = 0;
      let skippedCount = 0;
      
      const origDay = block.day_of_week;
      const origStart = block.start_time;
      const origEnd = block.end_time;
      const origSubject = block.subject;

      for (let day = 0; day <= 6; day++) {
        if (day === uDay) {
          await dbHelpers.run(
            `UPDATE timetable_blocks SET day_of_week = ?, start_time = ?, end_time = ?, subject = ?, color = ?,
                                        recurring = ?, specific_date = ? WHERE id = ?`,
            [uDay, uStart, uEnd, uSubject, uColor, uRecurring, uSpecific, id]
          );
          appliedCount++;
        } else {
          // Check for orig_match on day
          const origMatch = await dbHelpers.get(
            'SELECT * FROM timetable_blocks WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ? AND subject = ?',
            [req.user.id, day, origStart, origEnd, origSubject]
          );

          // Check for new_dup on day
          const newDup = await dbHelpers.get(
            'SELECT * FROM timetable_blocks WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ?',
            [req.user.id, day, uStart, uEnd]
          );

          if (origMatch) {
            if (newDup && newDup.id !== origMatch.id) {
              await dbHelpers.run(
                `UPDATE timetable_blocks SET subject = ?, color = ?, recurring = ?, specific_date = ? WHERE id = ?`,
                [uSubject, uColor, uRecurring, uSpecific, newDup.id]
              );
              await dbHelpers.run('DELETE FROM timetable_blocks WHERE id = ?', [origMatch.id]);
              skippedCount++;
            } else {
              await dbHelpers.run(
                `UPDATE timetable_blocks SET start_time = ?, end_time = ?, subject = ?, color = ?,
                                            recurring = ?, specific_date = ? WHERE id = ?`,
                [uStart, uEnd, uSubject, uColor, uRecurring, uSpecific, origMatch.id]
              );
              appliedCount++;
            }
          } else {
            if (newDup) {
              await dbHelpers.run(
                `UPDATE timetable_blocks SET subject = ?, color = ?, recurring = ?, specific_date = ? WHERE id = ?`,
                [uSubject, uColor, uRecurring, uSpecific, newDup.id]
              );
              skippedCount++;
            } else {
              await dbHelpers.run(
                `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, day, uStart, uEnd, uSubject, uColor, uRecurring, uSpecific]
              );
              appliedCount++;
            }
          }
        }
      }
      res.json({ appliedCount, skippedCount });
    } else {
      await dbHelpers.run(
        `UPDATE timetable_blocks SET day_of_week = ?, start_time = ?, end_time = ?, subject = ?, color = ?,
                                    recurring = ?, specific_date = ? WHERE id = ?`,
        [uDay, uStart, uEnd, uSubject, uColor, uRecurring, uSpecific, id]
      );
      const updated = await dbHelpers.get('SELECT * FROM timetable_blocks WHERE id = ?', [id]);
      res.json(updated);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update block' });
  }
});

// Delete block
app.delete('/api/timetable/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const block = await dbHelpers.get('SELECT * FROM timetable_blocks WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!block) return res.status(404).json({ error: 'Block not found' });
    
    await dbHelpers.run('DELETE FROM timetable_blocks WHERE id = ?', [id]);
    res.json({ message: 'Block deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete block' });
  }
});


// ----------------------------------------------------
// HABITS & STREAKS ENDPOINTS
// ----------------------------------------------------

// Calculate streaks engine helper
function calculateStreaks(logs, userTimezone = 'UTC') {
  if (!logs || logs.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }
  
  // Remove duplicates and sort ascending
  const completedDates = Array.from(new Set(logs.map(l => l.date))).sort();
  
  let longestStreak = 0;
  let currentStreak = 0;
  let tempStreak = 0;
  
  const parseDate = (dStr) => new Date(dStr + 'T00:00:00');
  
  // Longest streak
  for (let i = 0; i < completedDates.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const prev = parseDate(completedDates[i - 1]);
      const curr = parseDate(completedDates[i]);
      const diffDays = Math.ceil(Math.abs(curr - prev) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        tempStreak++;
      } else if (diffDays > 1) {
        if (tempStreak > longestStreak) longestStreak = tempStreak;
        tempStreak = 1;
      }
    }
  }
  if (tempStreak > longestStreak) longestStreak = tempStreak;
  
  // Current streak (consecutive days back from today or yesterday)
  const now = new Date();
  const getLocalDateStr = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const todayStr = getLocalDateStr(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateStr(yesterday);
  
  const completedToday = completedDates.includes(todayStr);
  const completedYesterday = completedDates.includes(yesterdayStr);
  
  if (!completedToday && !completedYesterday) {
    currentStreak = 0;
  } else {
    let checkDate = completedToday ? now : yesterday;
    currentStreak = 0;
    while (true) {
      const checkStr = getLocalDateStr(checkDate);
      if (completedDates.includes(checkStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }
  
  return { currentStreak, longestStreak };
}

// Get all habits and streaks stats
app.get('/api/habits', authenticateToken, async (req, res) => {
  try {
    const habits = await dbHelpers.query('SELECT * FROM habits WHERE user_id = ?', [req.user.id]);
    
    for (const habit of habits) {
      // Get all logs
      const logs = await dbHelpers.query(
        'SELECT date, completed FROM habit_logs WHERE habit_id = ? AND completed = 1 ORDER BY date ASC',
        [habit.id]
      );
      
      const { currentStreak, longestStreak } = calculateStreaks(logs);
      habit.currentStreak = currentStreak;
      habit.longestStreak = longestStreak;
      
      // Get this week's logs (last 7 days completed status)
      habit.logs = await dbHelpers.query(
        'SELECT date, completed FROM habit_logs WHERE habit_id = ?',
        [habit.id]
      );
    }
    
    res.json(habits);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch habits' });
  }
});

// Create habit
app.post('/api/habits', authenticateToken, async (req, res) => {
  const { name, target_days, auto_linked, target_value } = req.body;
  if (!name || !target_days) {
    return res.status(400).json({ error: 'Habit name and target_days (e.g. "daily" or "1,2,3") are required' });
  }
  
  try {
    const result = await dbHelpers.run(
      `INSERT INTO habits (user_id, name, target_days, auto_linked, target_value)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, name.trim(), target_days, auto_linked || 'none', parseInt(target_value) || 0]
    );
    
    const newHabit = await dbHelpers.get('SELECT * FROM habits WHERE id = ?', [result.id]);
    newHabit.currentStreak = 0;
    newHabit.longestStreak = 0;
    newHabit.logs = [];
    res.status(201).json(newHabit);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create habit' });
  }
});

// Delete habit
app.delete('/api/habits/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const habit = await dbHelpers.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });
    
    await dbHelpers.run('DELETE FROM habits WHERE id = ?', [id]);
    res.json({ message: 'Habit deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete habit' });
  }
});

// Toggle habit status manually
app.post('/api/habits/:id/toggle', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { date, completed } = req.body; // date = YYYY-MM-DD, completed = true/false
  
  if (!date || completed === undefined) {
    return res.status(400).json({ error: 'Date and completed flag are required' });
  }
  
  try {
    const habit = await dbHelpers.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });
    
    const isCompleted = completed ? 1 : 0;
    
    await dbHelpers.run(
      `INSERT INTO habit_logs (habit_id, date, completed)
       VALUES (?, ?, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed`,
      [id, date, isCompleted]
    );
    
    res.json({ message: 'Habit toggled successfully', date, completed: isCompleted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle habit' });
  }
});


// ----------------------------------------------------
// NOTES & FLASHCARDS ENDPOINTS
// ----------------------------------------------------

// Get all notes (supports search)
app.get('/api/notes', authenticateToken, async (req, res) => {
  const { q } = req.query; // Search query
  
  try {
    let sql = 'SELECT * FROM notes WHERE user_id = ?';
    const params = [req.user.id];
    
    if (q) {
      sql += ' AND (title LIKE ? OR subject LIKE ? OR body LIKE ?)';
      const keyword = `%${q.trim()}%`;
      params.push(keyword, keyword, keyword);
    }
    
    sql += ' ORDER BY updated_at DESC';
    const notes = await dbHelpers.query(sql, params);
    res.json(notes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Create note
app.post('/api/notes', authenticateToken, async (req, res) => {
  const { title, subject, body, linked_topic_id } = req.body;
  if (!title || !subject || !body) {
    return res.status(400).json({ error: 'Title, subject, and body are required' });
  }
  
  try {
    const result = await dbHelpers.run(
      `INSERT INTO notes (user_id, title, subject, body, linked_topic_id)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, title.trim(), subject.trim(), body, linked_topic_id || null]
    );
    const newNote = await dbHelpers.get('SELECT * FROM notes WHERE id = ?', [result.id]);
    res.status(201).json(newNote);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update note
app.put('/api/notes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, subject, body, linked_topic_id } = req.body;
  
  try {
    const note = await dbHelpers.get('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    
    await dbHelpers.run(
      `UPDATE notes SET title = ?, subject = ?, body = ?, linked_topic_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        title !== undefined ? title.trim() : note.title,
        subject !== undefined ? subject.trim() : note.subject,
        body !== undefined ? body : note.body,
        linked_topic_id !== undefined ? linked_topic_id : note.linked_topic_id,
        id
      ]
    );
    
    const updated = await dbHelpers.get('SELECT * FROM notes WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete note
app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const note = await dbHelpers.get('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    
    await dbHelpers.run('DELETE FROM notes WHERE id = ?', [id]);
    res.json({ message: 'Note deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Get flashcard decks & stats
app.get('/api/flashcards/decks', authenticateToken, async (req, res) => {
  try {
    const decks = await dbHelpers.query(
      'SELECT * FROM flashcard_decks WHERE user_id = ? ORDER BY name ASC',
      [req.user.id]
    );
    
    const todayStr = new Date().toISOString().split('T')[0];
    
    for (const deck of decks) {
      // due today
      const dueCount = await dbHelpers.get(
        'SELECT COUNT(*) as cnt FROM flashcards WHERE deck_id = ? AND next_review_date <= ?',
        [deck.id, todayStr]
      );
      // total
      const totalCount = await dbHelpers.get(
        'SELECT COUNT(*) as cnt FROM flashcards WHERE deck_id = ?',
        [deck.id]
      );
      // mastered (ease_factor >= 2.8 or intervals > 14 days)
      const masteredCount = await dbHelpers.get(
        'SELECT COUNT(*) as cnt FROM flashcards WHERE deck_id = ? AND ease_factor >= 2.8',
        [deck.id]
      );
      
      deck.dueCount = dueCount.cnt;
      deck.totalCount = totalCount.cnt;
      deck.masteredCount = masteredCount.cnt;
    }
    
    res.json(decks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch decks' });
  }
});

// Create Deck
app.post('/api/flashcards/decks', authenticateToken, async (req, res) => {
  const { name, subject } = req.body;
  if (!name || !subject) return res.status(400).json({ error: 'Deck name and subject are required' });
  
  try {
    const result = await dbHelpers.run(
      'INSERT INTO flashcard_decks (user_id, name, subject) VALUES (?, ?, ?)',
      [req.user.id, name.trim(), subject.trim()]
    );
    const deck = await dbHelpers.get('SELECT * FROM flashcard_decks WHERE id = ?', [result.id]);
    deck.dueCount = 0;
    deck.totalCount = 0;
    deck.masteredCount = 0;
    res.status(201).json(deck);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create deck' });
  }
});

// Delete Deck
app.delete('/api/flashcards/decks/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const deck = await dbHelpers.get('SELECT * FROM flashcard_decks WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    
    await dbHelpers.run('DELETE FROM flashcard_decks WHERE id = ?', [id]);
    res.json({ message: 'Deck deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete deck' });
  }
});

// Get cards in deck
app.get('/api/flashcards/decks/:id/cards', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const deck = await dbHelpers.get('SELECT * FROM flashcard_decks WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    
    const cards = await dbHelpers.query(
      'SELECT * FROM flashcards WHERE deck_id = ? ORDER BY next_review_date ASC',
      [id]
    );
    res.json(cards);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

// Add card to deck
app.post('/api/flashcards/decks/:id/cards', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { front, back } = req.body;
  if (!front || !back) return res.status(400).json({ error: 'Front and back card content are required' });
  
  try {
    const deck = await dbHelpers.get('SELECT * FROM flashcard_decks WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    
    const todayStr = new Date().toISOString().split('T')[0];
    const result = await dbHelpers.run(
      `INSERT INTO flashcards (deck_id, front, back, ease_factor, interval_days, next_review_date, review_count)
       VALUES (?, ?, ?, 2.5, 0, ?, 0)`,
      [id, front.trim(), back.trim(), todayStr]
    );
    
    const card = await dbHelpers.get('SELECT * FROM flashcards WHERE id = ?', [result.id]);
    res.status(201).json(card);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add card' });
  }
});

// Delete card
app.delete('/api/flashcards/cards/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const card = await dbHelpers.get(
      `SELECT c.* FROM flashcards c 
       JOIN flashcard_decks d ON c.deck_id = d.id 
       WHERE c.id = ? AND d.user_id = ?`,
      [id, req.user.id]
    );
    if (!card) return res.status(404).json({ error: 'Card not found' });
    
    await dbHelpers.run('DELETE FROM flashcards WHERE id = ?', [id]);
    res.json({ message: 'Card deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// Update card
app.put('/api/flashcards/cards/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { front, back } = req.body;
  try {
    const card = await dbHelpers.get(
      `SELECT c.* FROM flashcards c 
       JOIN flashcard_decks d ON c.deck_id = d.id 
       WHERE c.id = ? AND d.user_id = ?`,
      [id, req.user.id]
    );
    if (!card) return res.status(404).json({ error: 'Card not found' });
    
    await dbHelpers.run(
      'UPDATE flashcards SET front = ?, back = ? WHERE id = ?',
      [front !== undefined ? front.trim() : card.front, back !== undefined ? back.trim() : card.back, id]
    );
    
    const updated = await dbHelpers.get('SELECT * FROM flashcards WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

// Get due cards in a deck
app.get('/api/flashcards/decks/:id/due', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const deck = await dbHelpers.get('SELECT * FROM flashcard_decks WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    
    const todayStr = new Date().toISOString().split('T')[0];
    const dueCards = await dbHelpers.query(
      'SELECT * FROM flashcards WHERE deck_id = ? AND next_review_date <= ? ORDER BY next_review_date ASC',
      [id, todayStr]
    );
    res.json(dueCards);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch due cards' });
  }
});

// Review Spaced Repetition card using SM-2
app.post('/api/flashcards/cards/:id/review', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { response } = req.body; // 'again', 'hard', 'good', 'easy'
  
  if (!response) return res.status(400).json({ error: 'Response label is required' });
  
  // Map responses to SM-2 qualities (0-5)
  // again = 1, hard = 3, good = 4, easy = 5
  const qualityMap = { again: 1, hard: 3, good: 4, easy: 5 };
  const quality = qualityMap[response];
  
  if (quality === undefined) {
    return res.status(400).json({ error: 'Invalid response label. Must be: again, hard, good, or easy' });
  }
  
  try {
    const card = await dbHelpers.get(
      `SELECT c.* FROM flashcards c 
       JOIN flashcard_decks d ON c.deck_id = d.id 
       WHERE c.id = ? AND d.user_id = ?`,
      [id, req.user.id]
    );
    if (!card) return res.status(404).json({ error: 'Card not found' });
    
    let EF = card.ease_factor;
    let interval = card.interval_days;
    let count = card.review_count;
    
    if (quality < 3) {
      count = 0;
      interval = 1; // repeat tomorrow
    } else {
      if (count === 0) {
        interval = 1;
      } else if (count === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * EF);
      }
      count++;
    }
    
    // Adjust ease factor
    EF = EF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (EF < 1.3) EF = 1.3;
    
    // Calculate next review date
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    const nextReviewStr = nextDate.toISOString().split('T')[0];
    
    await dbHelpers.run(
      `UPDATE flashcards SET ease_factor = ?, interval_days = ?, next_review_date = ?, review_count = ?
       WHERE id = ?`,
      [EF, interval, nextReviewStr, count, id]
    );
    
    const updated = await dbHelpers.get('SELECT * FROM flashcards WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record card review' });
  }
});


// ----------------------------------------------------
// ANALYTICS & INSIGHTS ENDPOINT
// ----------------------------------------------------

app.get('/api/analytics', authenticateToken, async (req, res) => {
  try {
    // 1. Time-studied trends: studied minutes per day for the last 7 days
    const studyTrend = await dbHelpers.query(
      `SELECT date(start_time) as study_date, subject, SUM(duration_minutes) as total_mins
       FROM focus_sessions 
       WHERE user_id = ? AND type = 'work' 
         AND start_time >= date('now', '-7 days')
       GROUP BY study_date, subject
       ORDER BY study_date ASC`,
      [req.user.id]
    );
    
    // 2. Topic completion rate over time (last 7 days)
    const topicTrend = await dbHelpers.query(
      `SELECT date, 
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_count,
              COUNT(*) as total_count
       FROM topics 
       WHERE user_id = ? AND date >= date('now', '-7 days')
       GROUP BY date
       ORDER BY date ASC`,
      [req.user.id]
    );
    
    // 3. DSA problems solved by difficulty
    const dsaDiffStats = await dbHelpers.query(
      `SELECT difficulty, COUNT(*) as count 
       FROM dsa_problems 
       WHERE user_id = ? AND status = 'solved'
       GROUP BY difficulty`,
      [req.user.id]
    );
    
    // 4. DSA problems solved by pattern
    const dsaPatternStats = await dbHelpers.query(
      `SELECT pattern, 
              SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) as solved_count,
              COUNT(*) as total_count
       FROM dsa_problems 
       WHERE user_id = ?
       GROUP BY pattern`,
      [req.user.id]
    );
    
    // 5. Habit consistency trends (% completion per habit for current week)
    // Find habits first
    const habits = await dbHelpers.query(
      'SELECT id, name FROM habits WHERE user_id = ?',
      [req.user.id]
    );
    
    const habitConsistency = [];
    for (const habit of habits) {
      const logs = await dbHelpers.query(
        `SELECT SUM(completed) as completed_count, COUNT(*) as logged_days
         FROM habit_logs 
         WHERE habit_id = ? AND date >= date('now', '-7 days')`,
        [habit.id]
      );
      const completed = (logs[0] && logs[0].completed_count) || 0;
      const total = (logs[0] && logs[0].logged_days) || 0;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
      habitConsistency.push({ id: habit.id, name: habit.name, completionRate: rate });
    }
    
    // 6. Flashcard retention (review accuracy over time per deck)
    const flashcardDecks = await dbHelpers.query(
      'SELECT id, name FROM flashcard_decks WHERE user_id = ?',
      [req.user.id]
    );
    const flashcardRetention = [];
    for (const deck of flashcardDecks) {
      // Mastered cards: reviewed more than once with ease factor >= 2.5
      const cardStats = await dbHelpers.query(
        `SELECT COUNT(*) as total_cards,
                SUM(CASE WHEN review_count > 0 AND ease_factor >= 2.5 THEN 1 ELSE 0 END) as mastered_cards
         FROM flashcards WHERE deck_id = ?`,
        [deck.id]
      );
      const total = (cardStats[0] && cardStats[0].total_cards) || 0;
      const mastered = (cardStats[0] && cardStats[0].mastered_cards) || 0;
      const rate = total > 0 ? Math.round((mastered / total) * 100) : 0;
      flashcardRetention.push({ id: deck.id, name: deck.name, total, mastered, retentionRate: rate });
    }
    
    // 7. Project time allocation: minutes spent per project
    // Focus sessions can be linked to projects by joining focus_sessions and topics.
    // Or focus_sessions.topic_id linked to topic, topic can have project association, or note association.
    // Wait! Let's examine: "Link focus sessions to a project (optional) so time spent per project can be reported in Analytics."
    // How is focus session linked to projects?
    // Let's check projects. They have project_tasks. Wait, if topic_id is linked, we can check if topic title or subject matches.
    // Or focus_sessions can have a project_id or note.
    // Let's check projects schema. projects doesn't have a direct link in focus_sessions table, but wait:
    // focus_sessions has topic_id. If a topic has a subject or title that matches a project, we can link them, OR we can link by having a project subject matching project name.
    // Let's write a query that matches focus_sessions subject with project name, or we can check if focus_sessions.subject matches projects.name case insensitively.
    // Let's do this: we look at focus_sessions.subject and see if they match projects.name. This is a very neat, clean match that doesn't complicate schemas!
    const projectMinutes = await dbHelpers.query(
      `SELECT p.id, p.name, SUM(f.duration_minutes) as minutes 
       FROM projects p
       JOIN focus_sessions f ON LOWER(TRIM(f.subject)) = LOWER(TRIM(p.name))
       WHERE p.user_id = ? AND f.user_id = ? AND f.type = 'work'
       GROUP BY p.id`,
      [req.user.id, req.user.id]
    );
    
    // 8. Natural language insights generator
    // Week comparison
    const thisWeekMins = await dbHelpers.get(
      `SELECT SUM(duration_minutes) as mins FROM focus_sessions 
       WHERE user_id = ? AND type = 'work' AND start_time >= date('now', '-7 days')`,
      [req.user.id]
    );
    const lastWeekMins = await dbHelpers.get(
      `SELECT SUM(duration_minutes) as mins FROM focus_sessions 
       WHERE user_id = ? AND type = 'work' AND start_time >= date('now', '-14 days') AND start_time < date('now', '-7 days')`,
      [req.user.id]
    );
    const curMins = (thisWeekMins && thisWeekMins.mins) || 0;
    const prevMins = (lastWeekMins && lastWeekMins.mins) || 0;
    
    let studyCompInsight = '';
    if (prevMins > 0) {
      const pct = Math.round((Math.abs(curMins - prevMins) / prevMins) * 100);
      studyCompInsight = curMins >= prevMins 
        ? `You studied ${pct}% more this week than last week.` 
        : `You studied ${pct}% less this week than last week. Try to schedule a block tomorrow.`;
    } else if (curMins > 0) {
      studyCompInsight = `Great job starting! You studied ${curMins} minutes this week. Keep it up!`;
    } else {
      studyCompInsight = 'No study time logged this week yet. Start the focus timer to begin tracker activity!';
    }
    
    // Most focused subject
    const favoriteSubject = await dbHelpers.get(
      `SELECT subject, SUM(duration_minutes) as mins 
       FROM focus_sessions 
       WHERE user_id = ? AND type = 'work'
       GROUP BY subject 
       ORDER BY mins DESC LIMIT 1`,
      [req.user.id]
    );
    const favSubInsight = favoriteSubject 
      ? `Your most focused subject is "${favoriteSubject.subject}" with ${favoriteSubject.mins} minutes logged.`
      : `Complete a focus timer session to find your most studied subject.`;
      
    // Weak topic (DSA pattern with low solve rate)
    let weakPatternInsight = 'No DSA problems logged yet.';
    if (dsaPatternStats.length > 0) {
      const sortedPatterns = [...dsaPatternStats].sort((a, b) => {
        const rateA = a.total_count > 0 ? (a.solved_count / a.total_count) : 0;
        const rateB = b.total_count > 0 ? (b.solved_count / b.total_count) : 0;
        return rateA - rateB; // lowest solve rate first
      });
      const weak = sortedPatterns[0];
      const rate = weak.total_count > 0 ? Math.round((weak.solved_count / weak.total_count) * 100) : 0;
      weakPatternInsight = `Your weakest topic pattern is "${weak.pattern}" with a ${rate}% solve rate. We suggest reviewing it.`;
    }
    
    res.json({
      studyTrend,
      topicTrend,
      dsaDiffStats,
      dsaPatternStats,
      habitConsistency,
      flashcardRetention,
      projectMinutes,
      insights: [
        studyCompInsight,
        favSubInsight,
        weakPatternInsight
      ]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});


// ----------------------------------------------------
// SERVER START
// ----------------------------------------------------
app.listen(PORT, () => {
  console.log(`Study Tracker server running at http://localhost:${PORT}`);
});
