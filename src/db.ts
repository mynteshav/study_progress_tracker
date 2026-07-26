// Client-Side Database IPC Wrapper

const query = window.electronAPI?.dbQuery || (async () => []);
const run = window.electronAPI?.dbRun || (async () => ({ id: 0, changes: 0 }));
const get = window.electronAPI?.dbGet || (async () => null);

export function toLocalISOString(date: Date = new Date()): string {
  const offset = date.getTimezoneOffset();
  const offsetSign = offset > 0 ? '-' : '+';
  const absOffset = Math.abs(offset);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetMinutes = String(absOffset % 60).padStart(2, '0');

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  return `${y}-${m}-${d}T${h}:${min}:${s}.${ms}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

export const db = {
  // Authentication & Users
  async getUserByEmail(email: string) {
    return get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  },
  
  async getUserById(id: number) {
    return get('SELECT id, name, email, daily_goal_minutes, timezone, created_at FROM users WHERE id = ?', [id]);
  },
  
  async createUser(name: string, email: string, passwordHash: string) {
    return run(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase().trim(), passwordHash]
    );
  },
  
  async updateUserProfile(id: number, name: string, dailyGoalMinutes: number, timezone: string) {
    return run(
      'UPDATE users SET name = ?, daily_goal_minutes = ?, timezone = ? WHERE id = ?',
      [name.trim(), dailyGoalMinutes, timezone, id]
    );
  },

  // Today's Topics
  async getTopics(userId: number, date: string) {
    return query(
      'SELECT * FROM topics WHERE user_id = ? AND date = ? ORDER BY order_index ASC, id ASC',
      [userId, date]
    );
  },
  
  async addTopic(userId: number, date: string, title: string, subject: string, estMinutes: number, priority: string, status: string) {
    // Get max order index
    const maxOrder = await get(
      'SELECT MAX(order_index) as max_val FROM topics WHERE user_id = ? AND date = ?',
      [userId, date]
    );
    const nextOrder = (maxOrder && (maxOrder as any).max_val !== null) ? (maxOrder as any).max_val + 1 : 0;

    return run(
      `INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, date, title.trim(), subject.trim(), estMinutes, priority, status, nextOrder]
    );
  },
  
  async updateTopic(id: number, fields: { title?: string; subject?: string; est_minutes?: number; priority?: string; status?: string }) {
    const topic = await get('SELECT * FROM topics WHERE id = ?', [id]) as any;
    if (!topic) throw new Error('Topic not found');
    
    return run(
      `UPDATE topics SET title = ?, subject = ?, est_minutes = ?, priority = ?, status = ? WHERE id = ?`,
      [
        fields.title !== undefined ? fields.title.trim() : topic.title,
        fields.subject !== undefined ? fields.subject.trim() : topic.subject,
        fields.est_minutes !== undefined ? fields.est_minutes : topic.est_minutes,
        fields.priority !== undefined ? fields.priority : topic.priority,
        fields.status !== undefined ? fields.status : topic.status,
        id
      ]
    );
  },
  
  async deleteTopic(id: number) {
    return run('DELETE FROM topics WHERE id = ?', [id]);
  },
  
  async carryOverTopics(userId: number, fromDate: string, toDate: string) {
    const incompleteTopics = await query(
      `SELECT * FROM topics 
       WHERE user_id = ? AND date = ? AND status != 'done'
         AND id NOT IN (SELECT carried_over_from FROM topics WHERE user_id = ? AND date = ? AND carried_over_from IS NOT NULL)`,
      [userId, fromDate, userId, toDate]
    );
    
    const carriedIds = [];
    for (const topic of incompleteTopics as any[]) {
      const maxOrder = await get(
        'SELECT MAX(order_index) as max_val FROM topics WHERE user_id = ? AND date = ?',
        [userId, toDate]
      );
      const nextOrder = (maxOrder && (maxOrder as any).max_val !== null) ? (maxOrder as any).max_val + 1 : 0;
      
      const result = await run(
        `INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status, carried_over_from, order_index)
         VALUES (?, ?, ?, ?, ?, ?, 'not started', ?, ?)`,
        [userId, toDate, topic.title, topic.subject, topic.est_minutes, topic.id, nextOrder]
      );
      carriedIds.push(result.id);
    }
    return carriedIds;
  },
  
  async reorderTopics(userId: number, topicIds: number[], date: string) {
    for (let index = 0; index < topicIds.length; index++) {
      const id = topicIds[index];
      await run(
        'UPDATE topics SET order_index = ? WHERE id = ? AND user_id = ? AND date = ?',
        [index, id, userId, date]
      );
    }
  },

  // Focus Sessions
  async getFocusSessions(userId: number) {
    return query('SELECT * FROM focus_sessions WHERE user_id = ? ORDER BY start_time DESC', [userId]);
  },
  
  async logFocusSession(
    userId: number,
    topicId: number | null,
    subject: string,
    startTime: string,
    endTime: string,
    durationMinutes: number,
    type: string,
    note: string,
    scheduledDuration: number = 0,
    actualDuration: number = 0,
    savedTime: number = 0,
    saveTimeUsed: number = 0,
    taskName: string = ''
  ) {
    const finalScheduled = scheduledDuration || durationMinutes;
    const finalActual = actualDuration || durationMinutes;
    const finalTaskName = taskName ? taskName.trim() : subject.trim();

    const result = await run(
      `INSERT INTO focus_sessions (user_id, topic_id, subject, start_time, end_time, duration_minutes, type, note, scheduled_duration, actual_duration, saved_time, save_time_used, task_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, topicId, subject.trim(), startTime, endTime, durationMinutes, type, note, finalScheduled, finalActual, savedTime, saveTimeUsed, finalTaskName]
    );
    
    if (savedTime > 0) {
      await this.updateSavedTimeStats(userId, savedTime);
    }

    // Auto-update linked habits
    if (type === 'work') {
      const sessionDate = startTime.split('T')[0];
      const totalToday = await get(
        `SELECT SUM(duration_minutes) as mins FROM focus_sessions 
         WHERE user_id = ? AND type = 'work' AND substr(start_time, 1, 10) = ?`,
        [userId, sessionDate]
      ) as any;
      const totalMinutes = (totalToday && totalToday.mins) || 0;
      
      const linkedHabits = await query(
        `SELECT * FROM habits WHERE user_id = ? AND auto_linked = 'focus_minutes'`,
        [userId]
      ) as any[];
      
      for (const habit of linkedHabits) {
        const completed = totalMinutes >= habit.target_value ? 1 : 0;
        await run(
          `INSERT INTO habit_logs (habit_id, date, completed)
           VALUES (?, ?, ?)
           ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed`,
          [habit.id, sessionDate, completed]
        );
      }
    }
    
    return result;
  },

  // User Stats & Saved Time Bank
  async getUserStats(userId: number) {
    let stats = await get('SELECT * FROM user_stats WHERE user_id = ?', [userId]) as any;
    if (!stats) {
      await run(
        `INSERT INTO user_stats (user_id, total_saved_time, available_saved_time, weekly_saved_time, monthly_saved_time)
         VALUES (?, 0, 0, 0, 0)`,
        [userId]
      );
      stats = await get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
    }
    return stats;
  },

  async updateSavedTimeStats(userId: number, additionalSavedMinutes: number) {
    let stats = await get('SELECT * FROM user_stats WHERE user_id = ?', [userId]) as any;
    if (!stats) {
      await run(
        `INSERT INTO user_stats (user_id, total_saved_time, available_saved_time, weekly_saved_time, monthly_saved_time)
         VALUES (?, ?, ?, 0, 0)`,
        [userId, additionalSavedMinutes, additionalSavedMinutes]
      );
    } else {
      await run(
        `UPDATE user_stats SET 
           total_saved_time = total_saved_time + ?,
           available_saved_time = available_saved_time + ?
         WHERE user_id = ?`,
        [additionalSavedMinutes, additionalSavedMinutes, userId]
      );
    }
  },

  async useSavedTime(userId: number, minutesToUse: number) {
    const stats = await this.getUserStats(userId);
    if (!stats || stats.available_saved_time < minutesToUse) {
      throw new Error('Insufficient Saved Time balance');
    }
    await run(
      `UPDATE user_stats SET available_saved_time = available_saved_time - ? WHERE user_id = ?`,
      [minutesToUse, userId]
    );
    return await this.getUserStats(userId);
  },

  async getSavedTimeAnalytics(userId: number) {
    const stats = await this.getUserStats(userId);
    const aggregate = await get(
      `SELECT 
         COUNT(*) as session_count,
         AVG(saved_time) as avg_saved,
         MAX(saved_time) as max_saved
       FROM focus_sessions 
       WHERE user_id = ? AND saved_time > 0`,
      [userId]
    ) as any;

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const weeklyRes = await get(
      `SELECT SUM(saved_time) as sum_saved FROM focus_sessions 
       WHERE user_id = ? AND saved_time > 0 AND substr(start_time, 1, 10) >= ?`,
      [userId, weekStartStr]
    ) as any;

    const monthlyRes = await get(
      `SELECT SUM(saved_time) as sum_saved FROM focus_sessions 
       WHERE user_id = ? AND saved_time > 0 AND substr(start_time, 1, 10) >= ?`,
      [userId, monthStartStr]
    ) as any;

    return {
      totalSavedTime: (stats && stats.total_saved_time) || 0,
      availableSavedTime: (stats && stats.available_saved_time) || 0,
      avgSavedPerSession: Math.round((aggregate && aggregate.avg_saved) || 0),
      longestSavedSession: (aggregate && aggregate.max_saved) || 0,
      sessionsCountWithSavedTime: (aggregate && aggregate.session_count) || 0,
      weeklySavedTime: (weeklyRes && weeklyRes.sum_saved) || 0,
      monthlySavedTime: (monthlyRes && monthlyRes.sum_saved) || 0,
    };
  },

  // DSA Problems
  async getDsaProblems(userId: number) {
    return query('SELECT * FROM dsa_problems WHERE user_id = ? ORDER BY date_solved DESC, id DESC', [userId]);
  },
  
  async addDsaProblem(userId: number, p: { title: string; platform: string; url?: string; pattern: string; difficulty: string; status: string; time_spent_minutes: number; date_solved: string; notes?: string }) {
    return run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, p.title.trim(), p.platform.trim(), p.url || null, p.pattern.trim(), p.difficulty, p.status, p.time_spent_minutes, p.date_solved, p.notes || '']
    );
  },
  
  async updateDsaProblem(id: number, fields: any) {
    const prob = await get('SELECT * FROM dsa_problems WHERE id = ?', [id]) as any;
    if (!prob) throw new Error('Problem not found');
    return run(
      `UPDATE dsa_problems SET title = ?, platform = ?, url = ?, pattern = ?, difficulty = ?, status = ?,
                             time_spent_minutes = ?, date_solved = ?, notes = ? WHERE id = ?`,
      [
        fields.title !== undefined ? fields.title.trim() : prob.title,
        fields.platform !== undefined ? fields.platform.trim() : prob.platform,
        fields.url !== undefined ? fields.url.trim() : prob.url,
        fields.pattern !== undefined ? fields.pattern.trim() : prob.pattern,
        fields.difficulty !== undefined ? fields.difficulty : prob.difficulty,
        fields.status !== undefined ? fields.status : prob.status,
        fields.time_spent_minutes !== undefined ? fields.time_spent_minutes : prob.time_spent_minutes,
        fields.date_solved !== undefined ? fields.date_solved : prob.date_solved,
        fields.notes !== undefined ? fields.notes : prob.notes,
        id
      ]
    );
  },
  
  async deleteDsaProblem(id: number) {
    return run('DELETE FROM dsa_problems WHERE id = ?', [id]);
  },

  // Projects
  async getProjects(userId: number) {
    const projects = await query('SELECT * FROM projects WHERE user_id = ? ORDER BY start_date DESC', [userId]) as any[];
    for (const project of projects) {
      project.tasks = await query(
        'SELECT * FROM project_tasks WHERE project_id = ? ORDER BY due_date ASC, id ASC',
        [project.id]
      );
    }
    return projects;
  },
  
  async addProject(userId: number, p: { name: string; description?: string; status: string; start_date?: string; target_date?: string }) {
    return run(
      `INSERT INTO projects (user_id, name, description, status, start_date, target_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, p.name.trim(), p.description || '', p.status, p.start_date || null, p.target_date || null]
    );
  },
  
  async updateProject(id: number, fields: any) {
    const proj = await get('SELECT * FROM projects WHERE id = ?', [id]) as any;
    if (!proj) throw new Error('Project not found');
    return run(
      `UPDATE projects SET name = ?, description = ?, status = ?, start_date = ?, target_date = ? WHERE id = ?`,
      [
        fields.name !== undefined ? fields.name.trim() : proj.name,
        fields.description !== undefined ? fields.description : proj.description,
        fields.status !== undefined ? fields.status : proj.status,
        fields.start_date !== undefined ? fields.start_date : proj.start_date,
        fields.target_date !== undefined ? fields.target_date : proj.target_date,
        id
      ]
    );
  },
  
  async deleteProject(id: number) {
    return run('DELETE FROM projects WHERE id = ?', [id]);
  },
  
  async addProjectTask(projectId: number, title: string, dueDate: string) {
    return run(
      'INSERT INTO project_tasks (project_id, title, done, due_date) VALUES (?, ?, 0, ?)',
      [projectId, title.trim(), dueDate || null]
    );
  },
  
  async updateProjectTask(taskId: number, fields: { title?: string; done?: boolean; due_date?: string }) {
    const task = await get('SELECT * FROM project_tasks WHERE id = ?', [taskId]) as any;
    if (!task) throw new Error('Task not found');
    return run(
      'UPDATE project_tasks SET title = ?, done = ?, due_date = ? WHERE id = ?',
      [
        fields.title !== undefined ? fields.title.trim() : task.title,
        fields.done !== undefined ? (fields.done ? 1 : 0) : task.done,
        fields.due_date !== undefined ? fields.due_date : task.due_date,
        taskId
      ]
    );
  },
  
  async deleteProjectTask(taskId: number) {
    return run('DELETE FROM project_tasks WHERE id = ?', [taskId]);
  },

  // Timetable Blocks
  async getTimetableBlocks(userId: number) {
    return query(
      'SELECT * FROM timetable_blocks WHERE user_id = ? ORDER BY day_of_week ASC, start_time ASC',
      [userId]
    );
  },
  
  async addTimetableBlock(
    userId: number,
    block: { day_of_week: number; start_time: string; end_time: string; subject: string; color?: string; recurring: boolean; specific_date?: string },
    applyToAllDays?: boolean
  ) {
    if (applyToAllDays) {
      let appliedCount = 0;
      let skippedCount = 0;
      for (let day = 0; day <= 6; day++) {
        const duplicate = await get(
          'SELECT id FROM timetable_blocks WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ?',
          [userId, day, block.start_time, block.end_time]
        );
        if (duplicate) {
          skippedCount++;
        } else {
          await run(
            `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, day, block.start_time, block.end_time, block.subject.trim(), block.color || '#4f46e5', block.recurring ? 1 : 0, block.recurring ? null : block.specific_date || null]
          );
          appliedCount++;
        }
      }
      return { appliedCount, skippedCount };
    } else {
      const result = await run(
        `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, block.day_of_week, block.start_time, block.end_time, block.subject.trim(), block.color || '#4f46e5', block.recurring ? 1 : 0, block.recurring ? null : block.specific_date || null]
      );
      return { id: result.id, appliedCount: 1, skippedCount: 0 };
    }
  },
  
  async updateTimetableBlock(id: number, fields: any, applyToAllDays?: boolean) {
    const block = await get('SELECT * FROM timetable_blocks WHERE id = ?', [id]) as any;
    if (!block) throw new Error('Block not found');

    const uDay = fields.day_of_week !== undefined ? fields.day_of_week : block.day_of_week;
    const uStart = fields.start_time || block.start_time;
    const uEnd = fields.end_time || block.end_time;
    const uSubject = fields.subject !== undefined ? fields.subject.trim() : block.subject;
    const uColor = fields.color || block.color;
    const uRecurring = fields.recurring !== undefined ? (fields.recurring ? 1 : 0) : block.recurring;
    const uSpecific = fields.specific_date !== undefined ? (uRecurring ? null : fields.specific_date) : block.specific_date;

    if (applyToAllDays) {
      let appliedCount = 0;
      let skippedCount = 0;
      
      const origDay = block.day_of_week;
      const origStart = block.start_time;
      const origEnd = block.end_time;
      const origSubject = block.subject;

      for (let day = 0; day <= 6; day++) {
        if (day === uDay) {
          // Update the edited block itself on this target day
          await run(
            `UPDATE timetable_blocks SET day_of_week = ?, start_time = ?, end_time = ?, subject = ?, color = ?,
                                        recurring = ?, specific_date = ? WHERE id = ?`,
            [uDay, uStart, uEnd, uSubject, uColor, uRecurring, uSpecific, id]
          );
          appliedCount++;
        } else {
          // Check for orig_match on day
          const origMatch = await get(
            'SELECT * FROM timetable_blocks WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ? AND subject = ?',
            [block.user_id, day, origStart, origEnd, origSubject]
          ) as any;

          // Check for new_dup on day
          const newDup = await get(
            'SELECT * FROM timetable_blocks WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ?',
            [block.user_id, day, uStart, uEnd]
          ) as any;

          if (origMatch) {
            if (newDup && newDup.id !== origMatch.id) {
              // Delete origMatch and update newDup to keep only one block at the new time slot
              await run(
                `UPDATE timetable_blocks SET subject = ?, color = ?, recurring = ?, specific_date = ? WHERE id = ?`,
                [uSubject, uColor, uRecurring, uSpecific, newDup.id]
              );
              await run('DELETE FROM timetable_blocks WHERE id = ?', [origMatch.id]);
              skippedCount++;
            } else {
              // Update origMatch
              await run(
                `UPDATE timetable_blocks SET start_time = ?, end_time = ?, subject = ?, color = ?,
                                            recurring = ?, specific_date = ? WHERE id = ?`,
                [uStart, uEnd, uSubject, uColor, uRecurring, uSpecific, origMatch.id]
              );
              appliedCount++;
            }
          } else {
            if (newDup) {
              // Update newDup's details
              await run(
                `UPDATE timetable_blocks SET subject = ?, color = ?, recurring = ?, specific_date = ? WHERE id = ?`,
                [uSubject, uColor, uRecurring, uSpecific, newDup.id]
              );
              skippedCount++;
            } else {
              // Insert new block
              await run(
                `INSERT INTO timetable_blocks (user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [block.user_id, day, uStart, uEnd, uSubject, uColor, uRecurring, uSpecific]
              );
              appliedCount++;
            }
          }
        }
      }
      return { appliedCount, skippedCount };
    } else {
      // Normal single-day update
      await run(
        `UPDATE timetable_blocks SET day_of_week = ?, start_time = ?, end_time = ?, subject = ?, color = ?,
                                    recurring = ?, specific_date = ? WHERE id = ?`,
        [uDay, uStart, uEnd, uSubject, uColor, uRecurring, uSpecific, id]
      );
      return { id, appliedCount: 1, skippedCount: 0 };
    }
  },
  
  async deleteTimetableBlock(id: number) {
    return run('DELETE FROM timetable_blocks WHERE id = ?', [id]);
  },

  // Habits
  async getHabits(userId: number) {
    return query('SELECT * FROM habits WHERE user_id = ?', [userId]);
  },
  
  async getHabitLogs(habitId: number) {
    return query('SELECT date, completed FROM habit_logs WHERE habit_id = ?', [habitId]);
  },
  
  async addHabit(userId: number, name: string, targetDays: string, autoLinked: string, targetValue: number) {
    return run(
      `INSERT INTO habits (user_id, name, target_days, auto_linked, target_value)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, name.trim(), targetDays, autoLinked, targetValue]
    );
  },
  
  async deleteHabit(id: number) {
    return run('DELETE FROM habits WHERE id = ?', [id]);
  },
  
  async toggleHabitLog(habitId: number, date: string, completed: boolean) {
    const isCompleted = completed ? 1 : 0;
    return run(
      `INSERT INTO habit_logs (habit_id, date, completed)
       VALUES (?, ?, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed`,
      [habitId, date, isCompleted]
    );
  },

  // Notes
  async getNotes(userId: number, search?: string) {
    let sql = 'SELECT * FROM notes WHERE user_id = ?';
    const params: any[] = [userId];
    
    if (search && search.trim() !== '') {
      sql += ' AND (title LIKE ? OR subject LIKE ? OR body LIKE ?)';
      const keyword = `%${search.trim()}%`;
      params.push(keyword, keyword, keyword);
    }
    
    sql += ' ORDER BY updated_at DESC';
    return query(sql, params);
  },
  
  async addNote(userId: number, title: string, subject: string, body: string, linkedTopicId?: number | null) {
    return run(
      `INSERT INTO notes (user_id, title, subject, body, linked_topic_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, title.trim(), subject.trim(), body, linkedTopicId || null]
    );
  },
  
  async updateNote(id: number, fields: { title?: string; subject?: string; body?: string; linked_topic_id?: number | null }) {
    const note = await get('SELECT * FROM notes WHERE id = ?', [id]) as any;
    if (!note) throw new Error('Note not found');
    return run(
      `UPDATE notes SET title = ?, subject = ?, body = ?, linked_topic_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        fields.title !== undefined ? fields.title.trim() : note.title,
        fields.subject !== undefined ? fields.subject.trim() : note.subject,
        fields.body !== undefined ? fields.body : note.body,
        fields.linked_topic_id !== undefined ? fields.linked_topic_id : note.linked_topic_id,
        id
      ]
    );
  },
  
  async deleteNote(id: number) {
    return run('DELETE FROM notes WHERE id = ?', [id]);
  },

  // Flashcards & Decks
  async getDecks(userId: number) {
    return query('SELECT * FROM flashcard_decks WHERE user_id = ? ORDER BY name ASC', [userId]);
  },
  
  async addDeck(userId: number, name: string, subject: string) {
    return run(
      'INSERT INTO flashcard_decks (user_id, name, subject) VALUES (?, ?, ?)',
      [userId, name.trim(), subject.trim()]
    );
  },
  
  async deleteDeck(id: number) {
    return run('DELETE FROM flashcard_decks WHERE id = ?', [id]);
  },
  
  async getCards(deckId: number) {
    return query('SELECT * FROM flashcards WHERE deck_id = ? ORDER BY next_review_date ASC', [deckId]);
  },
  
  async addCard(deckId: number, front: string, back: string) {
    const todayStr = new Date().toISOString().split('T')[0];
    return run(
      `INSERT INTO flashcards (deck_id, front, back, ease_factor, interval_days, next_review_date, review_count)
       VALUES (?, ?, ?, 2.5, 0, ?, 0)`,
      [deckId, front.trim(), back.trim(), todayStr]
    );
  },
  
  async deleteCard(id: number) {
    return run('DELETE FROM flashcards WHERE id = ?', [id]);
  },
  
  async updateCard(id: number, front: string, back: string) {
    return run(
      'UPDATE flashcards SET front = ?, back = ? WHERE id = ?',
      [front.trim(), back.trim(), id]
    );
  },
  
  async getDueCards(deckId: number) {
    const todayStr = new Date().toISOString().split('T')[0];
    return query(
      'SELECT * FROM flashcards WHERE deck_id = ? AND next_review_date <= ? ORDER BY next_review_date ASC',
      [deckId, todayStr]
    );
  },
  
  async reviewCard(id: number, response: 'again' | 'hard' | 'good' | 'easy') {
    const qualityMap = { again: 1, hard: 3, good: 4, easy: 5 };
    const quality = qualityMap[response];
    
    const card = await get('SELECT * FROM flashcards WHERE id = ?', [id]) as any;
    if (!card) throw new Error('Card not found');
    
    let EF = card.ease_factor;
    let interval = card.interval_days;
    let count = card.review_count;
    
    if (quality < 3) {
      count = 0;
      interval = 1;
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
    
    EF = EF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (EF < 1.3) EF = 1.3;
    
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    const nextReviewStr = nextDate.toISOString().split('T')[0];
    
    return run(
      `UPDATE flashcards SET ease_factor = ?, interval_days = ?, next_review_date = ?, review_count = ?
       WHERE id = ?`,
      [EF, interval, nextReviewStr, count, id]
    );
  },

  // Analytics helper queries
  async getStudyTrends(userId: number) {
    return query(
      `SELECT substr(start_time, 1, 10) as study_date, subject, SUM(duration_minutes) as total_mins
       FROM focus_sessions 
       WHERE user_id = ? AND type = 'work' 
         AND start_time >= date('now', 'localtime', '-7 days')
       GROUP BY study_date, subject
       ORDER BY study_date ASC`,
      [userId]
    );
  },
  
  async getTopicTrends(userId: number) {
    return query(
      `SELECT date, 
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_count,
              COUNT(*) as total_count
       FROM topics 
       WHERE user_id = ? AND date >= date('now', 'localtime', '-7 days')
       GROUP BY date
       ORDER BY date ASC`,
      [userId]
    );
  },
  
  async getDsaDiffStats(userId: number) {
    return query(
      `SELECT difficulty, COUNT(*) as count 
       FROM dsa_problems 
       WHERE user_id = ? AND status = 'solved'
       GROUP BY difficulty`,
      [userId]
    );
  },
  
  async getDsaPatternStats(userId: number) {
    return query(
      `SELECT pattern, 
              SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) as solved_count,
              COUNT(*) as total_count
       FROM dsa_problems 
       WHERE user_id = ?
       GROUP BY pattern`,
      [userId]
    );
  },
  
  async getProjectTimeAllocation(userId: number) {
    return query(
      `SELECT p.id, p.name, SUM(f.duration_minutes) as minutes 
       FROM projects p
       JOIN focus_sessions f ON LOWER(TRIM(f.subject)) = LOWER(TRIM(p.name))
       WHERE p.user_id = ? AND f.user_id = ? AND f.type = 'work'
       GROUP BY p.id`,
      [userId, userId]
    );
  },
  
  async getWeeklyComparisonMins(userId: number) {
    const cur = await get(
      `SELECT SUM(duration_minutes) as mins FROM focus_sessions 
       WHERE user_id = ? AND type = 'work' AND start_time >= date('now', 'localtime', '-7 days')`,
      [userId]
    ) as any;
    
    const prev = await get(
      `SELECT SUM(duration_minutes) as mins FROM focus_sessions 
       WHERE user_id = ? AND type = 'work' AND start_time >= date('now', 'localtime', '-14 days') AND start_time < date('now', 'localtime', '-7 days')`,
      [userId]
    ) as any;
    
    return {
      thisWeek: (cur && cur.mins) || 0,
      lastWeek: (prev && prev.mins) || 0
    };
  },
  
  async getFavoriteSubject(userId: number) {
    return get(
      `SELECT subject, SUM(duration_minutes) as mins 
       FROM focus_sessions 
       WHERE user_id = ? AND type = 'work'
       GROUP BY subject 
       ORDER BY mins DESC LIMIT 1`,
      [userId]
    );
  },

  async getTimerState(userId: number) {
    return get('SELECT * FROM timer_state WHERE user_id = ?', [userId]);
  },

  async saveTimerState(userId: number, state: any) {
    return run(
      `INSERT INTO timer_state (
        user_id, is_running, mode, duration, remaining_time, 
        start_time, end_time, completed_sessions, paused_state,
        subject_text, current_topic_id, work_minutes, break_minutes,
        long_break_minutes, cycles_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        is_running = excluded.is_running,
        mode = excluded.mode,
        duration = excluded.duration,
        remaining_time = excluded.remaining_time,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        completed_sessions = excluded.completed_sessions,
        paused_state = excluded.paused_state,
        subject_text = excluded.subject_text,
        current_topic_id = excluded.current_topic_id,
        work_minutes = excluded.work_minutes,
        break_minutes = excluded.break_minutes,
        long_break_minutes = excluded.long_break_minutes,
        cycles_limit = excluded.cycles_limit`,
      [
        userId,
        state.isRunning ? 1 : 0,
        state.isWorkMode ? 'work' : 'break',
        state.workMinutes * 60,
        state.timeLeft,
        state.sessionStartTime,
        state.endTime,
        state.completedCycles,
        state.isRunning ? 0 : 1,
        state.subjectText,
        state.currentTopicId,
        state.workMinutes,
        state.breakMinutes,
        state.longBreakMinutes,
        state.cyclesLimit
      ]
    );
  }
};
