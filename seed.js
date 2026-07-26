const bcrypt = require('bcryptjs');
const dbHelpers = require('./database');

async function seed() {
  try {
    console.log('Starting database seeding...');
    await dbHelpers.initDb();
    
    // 1. Create or Reset Demo User
    const email = 'demo@example.com';
    const password = 'password123';
    const name = 'Alex Explorer';
    const dailyGoalMinutes = 120; // 2 hours
    const timezone = 'America/New_York';
    
    const hash = await bcrypt.hash(password, 10);
    
    // Check if user exists
    let user = await dbHelpers.get('SELECT * FROM users WHERE email = ?', [email]);
    let userId;
    
    if (user) {
      console.log('User demo@example.com exists. Resetting their data...');
      userId = user.id;
      // Delete old user data to prevent duplicates
      await dbHelpers.run('DELETE FROM topics WHERE user_id = ?', [userId]);
      await dbHelpers.run('DELETE FROM focus_sessions WHERE user_id = ?', [userId]);
      await dbHelpers.run('DELETE FROM dsa_problems WHERE user_id = ?', [userId]);
      await dbHelpers.run('DELETE FROM projects WHERE user_id = ?', [userId]);
      await dbHelpers.run('DELETE FROM timetable_blocks WHERE user_id = ?', [userId]);
      await dbHelpers.run('DELETE FROM habits WHERE user_id = ?', [userId]);
      await dbHelpers.run('DELETE FROM notes WHERE user_id = ?', [userId]);
      await dbHelpers.run('DELETE FROM flashcard_decks WHERE user_id = ?', [userId]);
      
      // Update profile
      await dbHelpers.run(
        'UPDATE users SET name = ?, password_hash = ?, daily_goal_minutes = ?, timezone = ? WHERE id = ?',
        [name, hash, dailyGoalMinutes, timezone, userId]
      );
    } else {
      console.log('Creating demo user...');
      const result = await dbHelpers.run(
        'INSERT INTO users (name, email, password_hash, daily_goal_minutes, timezone) VALUES (?, ?, ?, ?, ?)',
        [name, email, hash, dailyGoalMinutes, timezone]
      );
      userId = result.id;
    }
    
    console.log(`Demo User ID: ${userId}`);
    
    // Helper to get relative dates (YYYY-MM-DD)
    const getDateOffset = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${r}`;
    };
    
    // 2. Seed Topics
    console.log('Seeding topics...');
    const subjects = ['Algorithms', 'Web Development', 'System Design', 'Database Systems', 'Technical Writing'];
    
    // 5 days ago topics
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-5), 'Implement Merge Sort', 'Algorithms', 60, 'high', 'done']
    );
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-5), 'Read Express CORS docs', 'Web Development', 30, 'low', 'done']
    );
    
    // 4 days ago topics
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-4), 'Practice Hash Maps', 'Algorithms', 45, 'high', 'done']
    );
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-4), 'Design Timetable API', 'Web Development', 90, 'med', 'not started']
    );
    
    // 3 days ago topics (with carry over)
    const t1 = await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-3), 'Design Timetable API', 'Web Development', 90, 'med', 'done']
    );
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-3), 'Review Spaced Repetition logic', 'Algorithms', 60, 'high', 'in progress']
    );
    
    // 2 days ago topics (with carried_over badge)
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status, carried_over_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-2), 'Review Spaced Repetition logic', 'Algorithms', 60, 'high', 'done', t1.id]
    );
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-2), 'Write SQL Indexes migration', 'Database Systems', 45, 'med', 'done']
    );
    
    // Yesterday topics
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(-1), 'Setup JWT tokens auth', 'Web Development', 60, 'high', 'done']
    );
    
    // Today topics
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(0), 'Build frontend UI Shell', 'Web Development', 120, 'high', 'in progress']
    );
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(0), 'Solve DP Knapsack Problem', 'Algorithms', 60, 'med', 'not started']
    );
    await dbHelpers.run(
      'INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, getDateOffset(0), 'Write documentation', 'Technical Writing', 30, 'low', 'not started']
    );
    
    // 3. Seed Focus Sessions
    console.log('Seeding focus sessions...');
    const logFocusSession = async (offsetDay, topicName, subject, minutes, type = 'work') => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDay);
      
      const start = new Date(d);
      start.setHours(10, 0, 0);
      const end = new Date(start);
      end.setMinutes(start.getMinutes() + minutes);
      
      await dbHelpers.run(
        `INSERT INTO focus_sessions (user_id, subject, start_time, end_time, duration_minutes, type, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, subject, start.toISOString(), end.toISOString(), minutes, type, `Focused on ${topicName}`]
      );
    };
    
    await logFocusSession(-5, 'Merge Sort', 'Algorithms', 60);
    await logFocusSession(-5, 'CORS Docs', 'Web Development', 30);
    await logFocusSession(-4, 'Hash Maps', 'Algorithms', 45);
    await logFocusSession(-4, 'Short break', 'Algorithms', 10, 'break');
    await logFocusSession(-4, 'API layout', 'Web Development', 50);
    await logFocusSession(-3, 'Timetable API', 'Web Development', 90);
    await logFocusSession(-3, 'Spaced Repetition math', 'Algorithms', 40);
    await logFocusSession(-2, 'Spaced Repetition UI', 'Algorithms', 60);
    await logFocusSession(-2, 'SQL query optimization', 'Database Systems', 45);
    await logFocusSession(-1, 'JWT configuration', 'Web Development', 120);
    await logFocusSession(0, 'Dashboard glassmorphism layout', 'Web Development', 50);
    
    // 4. Seed DSA Problems
    console.log('Seeding DSA problems...');
    await dbHelpers.run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'Two Sum', 'LeetCode', 'https://leetcode.com/problems/two-sum/', 'Arrays', 'easy', 'solved', 15, getDateOffset(-5), 'Used Hash Map for O(N) lookup.']
    );
    await dbHelpers.run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'Merge Sorted Array', 'LeetCode', 'https://leetcode.com/problems/merge-sorted-array/', 'Arrays', 'easy', 'solved', 20, getDateOffset(-4), 'Three-pointer approach from end to start.']
    );
    await dbHelpers.run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'Longest Substring Without Repeating Characters', 'LeetCode', 'https://leetcode.com/problems/longest-substring-without-repeating-characters/', 'Sliding Window', 'med', 'solved', 35, getDateOffset(-3), 'Sliding window with map tracking indices.']
    );
    await dbHelpers.run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'Container With Most Water', 'LeetCode', 'https://leetcode.com/problems/container-with-most-water/', 'Two Pointers', 'med', 'revisit', 40, getDateOffset(-2), 'Got close but logic was buggy. Must try again.']
    );
    await dbHelpers.run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'Climbing Stairs', 'LeetCode', 'https://leetcode.com/problems/climbing-stairs/', 'Dynamic Programming', 'easy', 'solved', 10, getDateOffset(-1), 'Standard Fibonacci sequence relation.']
    );
    await dbHelpers.run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, '0-1 Knapsack Problem', 'CodeForces', '', 'Dynamic Programming', 'hard', 'attempted', 60, null, 'Struggled with the 2D DP matrix optimization. Revisit soon.']
    );
    
    // 5. Seed Projects and Project Tasks
    console.log('Seeding projects...');
    const proj = await dbHelpers.run(
      `INSERT INTO projects (user_id, name, description, status, start_date, target_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, 'Web Development', 'Design a fully reactive SPA study application with dark modes.', 'active', getDateOffset(-10), getDateOffset(5)]
    );
    
    const projectId = proj.id;
    await dbHelpers.run(
      'INSERT INTO project_tasks (project_id, title, done, due_date) VALUES (?, ?, 1, ?)',
      [projectId, 'Build relational SQLite database schema', getDateOffset(-6)]
    );
    await dbHelpers.run(
      'INSERT INTO project_tasks (project_id, title, done, due_date) VALUES (?, ?, 1, ?)',
      [projectId, 'Develop Express REST backend controllers', getDateOffset(-2)]
    );
    await dbHelpers.run(
      'INSERT INTO project_tasks (project_id, title, done, due_date) VALUES (?, ?, 0, ?)',
      [projectId, 'Write clean Glassmorphism visual CSS layout', getDateOffset(1)]
    );
    await dbHelpers.run(
      'INSERT INTO project_tasks (project_id, title, done, due_date) VALUES (?, ?, 0, ?)',
      [projectId, 'Integrate spaced flashcards study reviews', getDateOffset(4)]
    );
    
    // 6. Seed Timetable Blocks
    console.log('Seeding timetable blocks...');
    // Mon-Fri morning routine
    for (let day = 1; day <= 5; day++) {
      await dbHelpers.run(
        `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [userId, day, '09:00', '11:00', 'Algorithms', '#8b5cf6']
      );
      await dbHelpers.run(
        `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [userId, day, '14:00', '16:30', 'Web Development', '#06b6d4']
      );
    }
    
    // One-off block on Saturday
    await dbHelpers.run(
      `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
       VALUES (?, 6, ?, ?, ?, ?, 0, ?)`,
      [userId, '10:00', '12:00', 'Database Systems', '#10b981', getDateOffset(4)] // upcoming saturday
    );
    
    // 7. Seed Habits and Logs
    console.log('Seeding habits and logs...');
    // Habit 1: Focus Study (linked)
    const h1 = await dbHelpers.run(
      `INSERT INTO habits (user_id, name, target_days, auto_linked, target_value)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, 'Study 60+ Mins', '1,2,3,4,5', 'focus_minutes', 60]
    );
    // Log h1 manually for historical days (consecutive streak of 4 days)
    for (let offset = -4; offset <= -1; offset++) {
      await dbHelpers.run(
        'INSERT INTO habit_logs (habit_id, date, completed) VALUES (?, ?, 1)',
        [h1.id, getDateOffset(offset)]
      );
    }
    
    // Habit 2: Review Flashcards (not linked)
    const h2 = await dbHelpers.run(
      `INSERT INTO habits (user_id, name, target_days, auto_linked, target_value)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, 'Review Flashcards', '1,3,5', 'none', 0]
    );
    // Log h2 with some missed days
    await dbHelpers.run('INSERT INTO habit_logs (habit_id, date, completed) VALUES (?, ?, 1)', [h2.id, getDateOffset(-5)]);
    await dbHelpers.run('INSERT INTO habit_logs (habit_id, date, completed) VALUES (?, ?, 0)', [h2.id, getDateOffset(-3)]);
    await dbHelpers.run('INSERT INTO habit_logs (habit_id, date, completed) VALUES (?, ?, 1)', [h2.id, getDateOffset(-1)]);
    
    // Habit 3: No phone before study
    const h3 = await dbHelpers.run(
      `INSERT INTO habits (user_id, name, target_days, auto_linked, target_value)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, 'No phone before study', 'daily', 'none', 0]
    );
    for (let offset = -5; offset <= 0; offset++) {
      // Completed every day except -2
      const completed = offset === -2 ? 0 : 1;
      await dbHelpers.run(
        'INSERT INTO habit_logs (habit_id, date, completed) VALUES (?, ?, ?)',
        [h3.id, getDateOffset(offset), completed]
      );
    }
    
    // 8. Seed Notes & Decks & Flashcards
    console.log('Seeding notes and flashcards...');
    await dbHelpers.run(
      `INSERT INTO notes (user_id, title, subject, body)
       VALUES (?, ?, ?, ?)`,
      [
        userId,
        'Binary Search Template',
        'Algorithms',
        `# Binary Search Template\n\n\`\`\`javascript\nfunction binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  return -1;\n}\n\`\`\`\n\nKeep boundaries closed: \`[left, right]\`.`
      ]
    );
    
    const deck = await dbHelpers.run(
      'INSERT INTO flashcard_decks (user_id, name, subject) VALUES (?, ?, ?)',
      [userId, 'Core Data Structures', 'Algorithms']
    );
    const deckId = deck.id;
    
    // Seed flashcards with different review stages
    await dbHelpers.run(
      `INSERT INTO flashcards (deck_id, front, back, ease_factor, interval_days, next_review_date, review_count)
       VALUES (?, ?, ?, 2.5, 4, ?, 2)`,
      [deckId, 'What is the time complexity of lookup in a HashMap?', 'O(1) average case, O(N) worst case (hash collisions).', getDateOffset(2)]
    );
    
    await dbHelpers.run(
      `INSERT INTO flashcards (deck_id, front, back, ease_factor, interval_days, next_review_date, review_count)
       VALUES (?, ?, ?, 2.3, 0, ?, 1)`,
      [deckId, 'Explain space complexity of recursion stack in DFS.', 'O(H) where H is the height of the recursive tree.', getDateOffset(0)] // due today
    );
    
    await dbHelpers.run(
      `INSERT INTO flashcards (deck_id, front, back, ease_factor, interval_days, next_review_date, review_count)
       VALUES (?, ?, ?, 2.6, 12, ?, 4)`,
      [deckId, 'What is the difference between a tree and a graph?', 'A tree is a connected acyclic graph. Graphs can contain cycles and don\'t need a root.', getDateOffset(8)]
    );
    
    console.log('Seeding completed successfully!');
    console.log('Demo Login Details:');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    
    process.exit(0);
  } catch (err) {
    console.error('Seeding encountered an error:', err);
    process.exit(1);
  }
}

seed();
