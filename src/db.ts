// Client-Side Database Abstraction Entry Point
import { getDbAdapter } from './db/index';

const query = async (sql: string, params: any[] = []) => getDbAdapter().query(sql, params);
const run = async (sql: string, params: any[] = []) => getDbAdapter().run(sql, params);
const get = async (sql: string, params: any[] = []) => getDbAdapter().get(sql, params);


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
  },

  // Roadmap Module API Methods
  async getRoadmaps(userId: number) {
    return query(
      'SELECT * FROM roadmaps WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC',
      [userId]
    );
  },

  async getRoadmapById(id: number) {
    return get('SELECT * FROM roadmaps WHERE id = ?', [id]);
  },

  async getActiveRoadmap(userId: number) {
    const active = await get('SELECT * FROM roadmaps WHERE user_id = ? AND is_active = 1 LIMIT 1', [userId]);
    if (active) return active;
    return get('SELECT * FROM roadmaps WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [userId]);
  },

  async setActiveRoadmap(userId: number, roadmapId: number) {
    await run('UPDATE roadmaps SET is_active = 0 WHERE user_id = ?', [userId]);
    return run('UPDATE roadmaps SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [roadmapId, userId]);
  },

  async createRoadmap(
    userId: number,
    title: string,
    description: string = '',
    targetRole: string = '',
    difficulty: string = 'Intermediate',
    duration: string = '12 weeks'
  ) {
    const existing = await query('SELECT id FROM roadmaps WHERE user_id = ?', [userId]);
    const isActive = existing.length === 0 ? 1 : 0;

    return run(
      `INSERT INTO roadmaps (user_id, title, description, target_role, difficulty, duration, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, title.trim(), description.trim(), targetRole.trim(), difficulty, duration, isActive]
    );
  },

  async updateRoadmap(id: number, fields: { title?: string; description?: string; target_role?: string; status?: string; difficulty?: string; duration?: string }) {
    const r = await get('SELECT * FROM roadmaps WHERE id = ?', [id]) as any;
    if (!r) throw new Error('Roadmap not found');

    return run(
      `UPDATE roadmaps SET title = ?, description = ?, target_role = ?, status = ?, difficulty = ?, duration = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [
        fields.title !== undefined ? fields.title.trim() : r.title,
        fields.description !== undefined ? fields.description.trim() : r.description,
        fields.target_role !== undefined ? fields.target_role.trim() : r.target_role,
        fields.status !== undefined ? fields.status : r.status,
        fields.difficulty !== undefined ? fields.difficulty : r.difficulty,
        fields.duration !== undefined ? fields.duration : r.duration,
        id
      ]
    );
  },

  async deleteRoadmap(id: number) {
    return run('DELETE FROM roadmaps WHERE id = ?', [id]);
  },

  // Roadmap Sections
  async getRoadmapSections(roadmapId: number) {
    return query(
      'SELECT * FROM roadmap_sections WHERE roadmap_id = ? ORDER BY order_index ASC, id ASC',
      [roadmapId]
    );
  },

  async createRoadmapSection(roadmapId: number, title: string, orderIndex?: number) {
    let order = orderIndex;
    if (order === undefined) {
      const maxObj = await get('SELECT MAX(order_index) as max_val FROM roadmap_sections WHERE roadmap_id = ?', [roadmapId]) as any;
      order = (maxObj && maxObj.max_val !== null) ? maxObj.max_val + 1 : 0;
    }
    return run(
      'INSERT INTO roadmap_sections (roadmap_id, title, order_index) VALUES (?, ?, ?)',
      [roadmapId, title.trim(), order]
    );
  },

  async updateRoadmapSection(id: number, title: string) {
    return run('UPDATE roadmap_sections SET title = ? WHERE id = ?', [title.trim(), id]);
  },

  async deleteRoadmapSection(id: number) {
    return run('DELETE FROM roadmap_sections WHERE id = ?', [id]);
  },

  // Roadmap Topics
  async getRoadmapTopics(roadmapId: number) {
    return query(
      `SELECT t.*, 
        (SELECT COUNT(*) FROM roadmap_resources r WHERE r.topic_id = t.id) as resource_count,
        (SELECT COUNT(*) FROM roadmap_resources r WHERE r.topic_id = t.id AND r.completed = 1) as completed_resource_count,
        (SELECT COUNT(*) FROM roadmap_checklists c WHERE c.topic_id = t.id) as checklist_count,
        (SELECT COUNT(*) FROM roadmap_checklists c WHERE c.topic_id = t.id AND c.completed = 1) as completed_checklist_count,
        p.name as linked_project_name,
        n.title as linked_note_title
       FROM roadmap_topics t
       LEFT JOIN projects p ON t.linked_project_id = p.id
       LEFT JOIN notes n ON t.linked_note_id = n.id
       WHERE t.roadmap_id = ?
       ORDER BY t.order_index ASC, t.id ASC`,
      [roadmapId]
    );
  },

  async createRoadmapTopic(
    sectionId: number,
    roadmapId: number,
    name: string,
    description: string = '',
    difficulty: string = 'Intermediate',
    priority: string = 'medium',
    estimatedHours: number = 2
  ) {
    const maxObj = await get('SELECT MAX(order_index) as max_val FROM roadmap_topics WHERE section_id = ?', [sectionId]) as any;
    const nextOrder = (maxObj && maxObj.max_val !== null) ? maxObj.max_val + 1 : 0;

    return run(
      `INSERT INTO roadmap_topics (section_id, roadmap_id, name, description, status, difficulty, priority, estimated_hours, order_index)
       VALUES (?, ?, ?, ?, 'not started', ?, ?, ?, ?)`,
      [sectionId, roadmapId, name.trim(), description.trim(), difficulty, priority, estimatedHours, nextOrder]
    );
  },

  async updateRoadmapTopic(
    id: number,
    fields: {
      name?: string;
      description?: string;
      status?: string;
      difficulty?: string;
      priority?: string;
      estimated_hours?: number;
      completed_hours?: number;
      completion_date?: string | null;
      notes?: string;
      linked_project_id?: number | null;
      linked_note_id?: number | null;
      next_revision_date?: string | null;
      revision_count?: number;
    }
  ) {
    const topic = await get('SELECT * FROM roadmap_topics WHERE id = ?', [id]) as any;
    if (!topic) throw new Error('Roadmap topic not found');

    let compDate = topic.completion_date;
    if (fields.status !== undefined) {
      if (fields.status === 'completed' && topic.status !== 'completed') {
        compDate = new Date().toISOString().split('T')[0];
      } else if (fields.status !== 'completed') {
        compDate = null;
      }
    }
    if (fields.completion_date !== undefined) {
      compDate = fields.completion_date;
    }

    const res = await run(
      `UPDATE roadmap_topics SET 
        name = ?, description = ?, status = ?, difficulty = ?, priority = ?,
        estimated_hours = ?, completed_hours = ?, completion_date = ?, notes = ?,
        linked_project_id = ?, linked_note_id = ?, next_revision_date = ?, revision_count = ?
       WHERE id = ?`,
      [
        fields.name !== undefined ? fields.name.trim() : topic.name,
        fields.description !== undefined ? fields.description.trim() : topic.description,
        fields.status !== undefined ? fields.status : topic.status,
        fields.difficulty !== undefined ? fields.difficulty : topic.difficulty,
        fields.priority !== undefined ? fields.priority : topic.priority,
        fields.estimated_hours !== undefined ? fields.estimated_hours : topic.estimated_hours,
        fields.completed_hours !== undefined ? fields.completed_hours : topic.completed_hours,
        compDate,
        fields.notes !== undefined ? fields.notes : topic.notes,
        fields.linked_project_id !== undefined ? fields.linked_project_id : topic.linked_project_id,
        fields.linked_note_id !== undefined ? fields.linked_note_id : topic.linked_note_id,
        fields.next_revision_date !== undefined ? fields.next_revision_date : topic.next_revision_date,
        fields.revision_count !== undefined ? fields.revision_count : topic.revision_count,
        id
      ]
    );

    await run('UPDATE roadmaps SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [topic.roadmap_id]);
    return res;
  },

  async incrementTopicCompletedHours(id: number, hoursToAdd: number) {
    const topic = await get('SELECT * FROM roadmap_topics WHERE id = ?', [id]) as any;
    if (!topic) return;

    const newCompletedHours = Number((topic.completed_hours + hoursToAdd).toFixed(2));
    let newStatus = topic.status;
    if (newCompletedHours > 0 && topic.status === 'not started') {
      newStatus = 'in progress';
    }
    await run(
      'UPDATE roadmap_topics SET completed_hours = ?, status = ? WHERE id = ?',
      [newCompletedHours, newStatus, id]
    );
    await run('UPDATE roadmaps SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [topic.roadmap_id]);
  },

  async deleteRoadmapTopic(id: number) {
    return run('DELETE FROM roadmap_topics WHERE id = ?', [id]);
  },

  // Roadmap Topic Resources
  async getTopicResources(topicId: number) {
    return query(
      'SELECT * FROM roadmap_resources WHERE topic_id = ? ORDER BY id ASC',
      [topicId]
    );
  },

  async addTopicResource(topicId: number, title: string, url: string, type: string, duration: string = '') {
    return run(
      'INSERT INTO roadmap_resources (topic_id, title, url, type, duration) VALUES (?, ?, ?, ?, ?)',
      [topicId, title.trim(), url.trim(), type, duration.trim()]
    );
  },

  async updateTopicResource(id: number, fields: { title?: string; url?: string; type?: string; duration?: string; completed?: number }) {
    const r = await get('SELECT * FROM roadmap_resources WHERE id = ?', [id]) as any;
    if (!r) throw new Error('Resource not found');

    return run(
      'UPDATE roadmap_resources SET title = ?, url = ?, type = ?, duration = ?, completed = ? WHERE id = ?',
      [
        fields.title !== undefined ? fields.title.trim() : r.title,
        fields.url !== undefined ? fields.url.trim() : r.url,
        fields.type !== undefined ? fields.type : r.type,
        fields.duration !== undefined ? fields.duration.trim() : r.duration,
        fields.completed !== undefined ? fields.completed : r.completed,
        id
      ]
    );
  },

  async deleteTopicResource(id: number) {
    return run('DELETE FROM roadmap_resources WHERE id = ?', [id]);
  },

  // Roadmap Topic Checklists
  async getTopicChecklists(topicId: number) {
    return query(
      'SELECT * FROM roadmap_checklists WHERE topic_id = ? ORDER BY order_index ASC, id ASC',
      [topicId]
    );
  },

  async addTopicChecklist(topicId: number, title: string) {
    const maxObj = await get('SELECT MAX(order_index) as max_val FROM roadmap_checklists WHERE topic_id = ?', [topicId]) as any;
    const nextOrder = (maxObj && maxObj.max_val !== null) ? maxObj.max_val + 1 : 0;

    return run(
      'INSERT INTO roadmap_checklists (topic_id, title, order_index) VALUES (?, ?, ?)',
      [topicId, title.trim(), nextOrder]
    );
  },

  async toggleTopicChecklist(id: number, completed: boolean) {
    return run('UPDATE roadmap_checklists SET completed = ? WHERE id = ?', [completed ? 1 : 0, id]);
  },

  async deleteTopicChecklist(id: number) {
    return run('DELETE FROM roadmap_checklists WHERE id = ?', [id]);
  },

  // Revisions
  async getDueRevisions(userId: number) {
    const todayStr = new Date().toISOString().split('T')[0];
    return query(
      `SELECT t.*, r.title as roadmap_title, s.title as section_title
       FROM roadmap_topics t
       JOIN roadmaps r ON t.roadmap_id = r.id
       JOIN roadmap_sections s ON t.section_id = s.id
       WHERE r.user_id = ? AND t.next_revision_date IS NOT NULL AND t.next_revision_date <= ?
       ORDER BY t.next_revision_date ASC`,
      [userId, todayStr]
    );
  },

  async scheduleTopicRevision(topicId: number, nextDate: string) {
    const topic = await get('SELECT revision_count FROM roadmap_topics WHERE id = ?', [topicId]) as any;
    const count = (topic?.revision_count || 0) + 1;
    return run(
      'UPDATE roadmap_topics SET next_revision_date = ?, revision_count = ? WHERE id = ?',
      [nextDate, count, topicId]
    );
  },

  // Preset Template Auto-Seeding
  async seedPresetRoadmap(userId: number, templateKey: 'ai' | 'ds' | 'fs' | 'backend' | 'devops') {
    const presets: Record<string, { title: string; description: string; role: string; difficulty: string; duration: string; sections: { name: string; topics: { name: string; desc?: string; difficulty?: string; hours?: number; resources?: { title: string; url: string; type: string }[]; checklists?: string[] }[] }[] }> = {
      ai: {
        title: 'AI Engineer',
        description: 'Comprehensive curriculum from foundations to advanced LLMs, RAG, AI Agents, and MLOps.',
        role: 'AI Engineer / LLM Developer',
        difficulty: 'Advanced',
        duration: '16 weeks',
        sections: [
          { name: 'Programming', topics: [{ name: 'Python', desc: 'Core syntax, data types, control flow, functions', hours: 10, checklists: ['Variables & Data Types', 'Control Flow', 'Functions & Modules'] }, { name: 'OOP', desc: 'Classes, inheritance, polymorphism, encapsulation', hours: 8, checklists: ['Classes & Objects', 'Inheritance', 'Dunder Methods'] }, { name: 'Advanced Python', desc: 'Decorators, generators, context managers, async', hours: 12, checklists: ['Decorators', 'Generators & Iterators', 'Asyncio & Concurrency'] }] },
          { name: 'Mathematics', topics: [{ name: 'Linear Algebra', desc: 'Vectors, matrices, eigenvalues, SVD', hours: 15, checklists: ['Vectors & Matrices', 'Matrix Multiplication', 'Eigenvalues & Eigenvectors', 'SVD'] }, { name: 'Probability', desc: 'Probability distributions, Bayes theorem', hours: 10, checklists: ['Random Variables', 'Probability Distributions', 'Bayes Theorem'] }, { name: 'Statistics', desc: 'Hypothesis testing, variance, regression metrics', hours: 12, checklists: ['Descriptive Stats', 'Hypothesis Testing', 'Confidence Intervals'] }, { name: 'Calculus', desc: 'Derivatives, partial derivatives, gradients', hours: 10, checklists: ['Derivatives', 'Partial Derivatives', 'Gradient Descent'] }] },
          { name: 'Machine Learning', topics: [{ name: 'Supervised Learning', desc: 'Linear regression, logistic regression, trees', hours: 20, checklists: ['Linear Regression', 'Logistic Regression', 'Decision Trees', 'Random Forests'] }, { name: 'Regression', desc: 'Ridge, Lasso, Polynomial Regression', hours: 10, checklists: ['L1/L2 Regularization', 'Evaluation Metrics (MSE/RMSE/MAE)'] }, { name: 'Classification', desc: 'SVM, KNN, Naive Bayes, Confusion Matrix', hours: 15, checklists: ['SVM & Kernels', 'Precision/Recall/F1', 'ROC-AUC Curve'] }] },
          { name: 'Deep Learning', topics: [{ name: 'Neural Networks', desc: 'Perceptrons, backpropagation, activation functions', hours: 25, checklists: ['Perceptrons', 'Forward/Backward Pass', 'Activations (ReLU, Sigmoid, Softmax)', 'Optimizers (Adam, SGD)'] }, { name: 'CNN', desc: 'Convolutional layers, pooling, ResNet', hours: 15, checklists: ['Convolution Operation', 'Pooling Layers', 'ResNet Architecture'] }, { name: 'RNN', desc: 'Sequential models, vanishing gradients', hours: 12, checklists: ['Sequence Modeling', 'Hidden States', 'Vanishing Gradients'] }, { name: 'LSTM', desc: 'Gated architectures, cell state, GRU', hours: 12, checklists: ['Forget/Input/Output Gates', 'Cell State', 'GRU vs LSTM'] }] },
          { name: 'NLP', topics: [{ name: 'NLP Foundations', desc: 'Tokenization, Embeddings, Word2Vec, TF-IDF', hours: 15, checklists: ['Tokenization', 'Stemming & Lemmatization', 'TF-IDF', 'Word2Vec'] }] },
          { name: 'Transformers', topics: [{ name: 'Transformers', desc: 'Attention mechanisms, Encoder-Decoder, BERT, GPT', hours: 30, checklists: ['Attention', 'Self Attention', 'Multi Head Attention', 'Positional Encoding', 'Encoder', 'Decoder', 'BERT', 'GPT'], resources: [{ title: 'Attention Is All You Need (Paper)', url: 'https://arxiv.org/abs/1706.03762', type: 'Documentation' }, { title: 'The Illustrated Transformer', url: 'https://jalammar.github.io/illustrated-transformer/', type: 'Blog' }] }] },
          { name: 'LLMs', topics: [{ name: 'LLM Architectures', desc: 'Fine-tuning, LoRA, QLoRA, Quantization, Prompt Engineering', hours: 25, checklists: ['Prompt Engineering', 'Instruction Tuning', 'LoRA & PEFT', 'Quantization (GGUF/BitsAndBytes)'] }] },
          { name: 'LangChain', topics: [{ name: 'LangChain', desc: 'Chains, Memory, Agents, Tools, LCEL', hours: 20, checklists: ['LCEL Syntax', 'Prompt Templates', 'Output Parsers', 'VectorStore Integrations'] }] },
          { name: 'RAG', topics: [{ name: 'RAG', desc: 'Retrieval Augmented Generation, Vector Databases, Chunking, Hybrid Search', hours: 25, checklists: ['Document Loaders', 'Text Chunking Strategies', 'Vector Databases (Chroma/Pinecone/PGVector)', 'Hybrid & Re-ranking Search'] }] },
          { name: 'MCP', topics: [{ name: 'MCP', desc: 'Model Context Protocol, client-server integrations', hours: 15, checklists: ['MCP Protocol Specs', 'Building Custom MCP Servers', 'Connecting MCP to LLM Clients'] }] },
          { name: 'AI Agents', topics: [{ name: 'AI Agents', desc: 'Autonomous agents, ReAct pattern, LangGraph, AutoGen', hours: 30, checklists: ['ReAct Prompting Pattern', 'Tool Calling', 'LangGraph State Graphs', 'Multi-Agent Collaboration'] }] },
          { name: 'FastAPI', topics: [{ name: 'FastAPI', desc: 'Building high-performance async APIs for AI models', hours: 12, checklists: ['Async Endpoints', 'Pydantic Schemas', 'Streaming Responses (SSE)'] }] },
          { name: 'Docker', topics: [{ name: 'Docker', desc: 'Containerizing AI applications & models', hours: 10, checklists: ['Dockerfiles', 'Container Networking', 'Docker Compose'] }] },
          { name: 'Kubernetes', topics: [{ name: 'Kubernetes', desc: 'Deploying and scaling model services', hours: 15, checklists: ['Deployments & Pods', 'Services & Ingress', 'Scaling & Resource Limits'] }] },
          { name: 'AWS', topics: [{ name: 'AWS Cloud', desc: 'S3, EC2, SageMaker, Lambda for AI', hours: 15, checklists: ['S3 Storage', 'EC2 GPU Instances', 'Bedrock & SageMaker'] }] },
          { name: 'MLOps', topics: [{ name: 'MLOps', desc: 'Model monitoring, tracking with MLflow, CI/CD for AI', hours: 20, checklists: ['Experiment Tracking (MLflow/W&B)', 'Model Registry', 'Data & Model Drift Detection'] }] },
          { name: 'Projects', topics: [{ name: 'Full-Stack RAG Chatbot', desc: 'Build an end-to-end RAG system with VectorDB & React', hours: 35, checklists: ['Ingestion Pipeline', 'Vector Indexing', 'FastAPI Backend', 'React UI'] }] },
          { name: 'Interview Preparation', topics: [{ name: 'AI Systems & Coding Interviews', desc: 'ML system design, algorithm challenges, mock interviews', hours: 30, checklists: ['ML System Design', 'Python & PyTorch Coding', 'Transformer Architecture Q&A'] }] }
        ]
      },
      ds: { title: 'Data Scientist', description: 'End-to-end path from exploratory data analysis to machine learning, SQL, statistics, and business visualization.', role: 'Data Scientist', difficulty: 'Intermediate', duration: '14 weeks', sections: [{ name: 'Fundamentals', topics: [{ name: 'Python & Data Wrangling', hours: 12, checklists: ['NumPy Arrays', 'Pandas DataFrames', 'Data Cleaning'] }, { name: 'SQL for Data Science', hours: 15, checklists: ['Joins & Subqueries', 'Window Functions', 'Aggregation'] }] }, { name: 'Visualization & Analysis', topics: [{ name: 'Data Visualization', hours: 10, checklists: ['Seaborn Plots', 'Plotly Interactive Charts', 'Storytelling'] }, { name: 'Exploratory Data Analysis', hours: 15, checklists: ['Missing Value Treatment', 'Outlier Detection', 'Correlation Analysis'] }] }, { name: 'Machine Learning', topics: [{ name: 'Predictive Modeling', hours: 25, checklists: ['Feature Engineering', 'Cross-Validation', 'Scikit-Learn Pipelines'] }, { name: 'Advanced ML & Ensembles', hours: 20, checklists: ['XGBoost', 'LightGBM', 'Hyperparameter Tuning'] }] }] },
      fs: { title: 'Full Stack Developer', description: 'Modern full-stack web development with React, TypeScript, Node.js, Next.js, and Cloud deployment.', role: 'Full Stack Engineer', difficulty: 'Intermediate', duration: '14 weeks', sections: [{ name: 'Frontend', topics: [{ name: 'HTML5 & CSS3', hours: 10, checklists: ['Flexbox & Grid', 'Responsive Design', 'CSS Variables'] }, { name: 'JavaScript & TypeScript', hours: 20, checklists: ['ES6+ Features', 'Async/Await', 'TypeScript Interfaces & Generics'] }, { name: 'React & Ecosystem', hours: 25, checklists: ['Hooks & Context', 'State Management', 'Tailwind CSS'] }] }, { name: 'Backend', topics: [{ name: 'Node.js & Express', hours: 20, checklists: ['REST API Routing', 'Middleware', 'JWT Authentication'] }, { name: 'Databases', hours: 18, checklists: ['PostgreSQL Schema Design', 'Prisma ORM', 'Indexing & Queries'] }] }] },
      backend: { title: 'Backend Developer', description: 'Deep dive into microservices, distributed databases, high performance APIs, and system design.', role: 'Backend Engineer', difficulty: 'Advanced', duration: '12 weeks', sections: [{ name: 'Core System Concepts', topics: [{ name: 'API Design & Protocols', hours: 15, checklists: ['RESTful Standards', 'gRPC & Protocol Buffers', 'WebSockets'] }, { name: 'Database Architecture', hours: 20, checklists: ['ACID Transactions', 'Sharding & Replication', 'Redis Caching'] }] }, { name: 'System Design', topics: [{ name: 'Scalable Systems', hours: 30, checklists: ['Load Balancing', 'Message Queues (Kafka)', 'Microservices Patterns'] }] }] },
      devops: { title: 'DevOps Engineer', description: 'Master CI/CD pipelines, container orchestration with Kubernetes, Cloud, and Infrastructure as Code.', role: 'DevOps / SRE', difficulty: 'Advanced', duration: '12 weeks', sections: [{ name: 'Infrastructure & Automation', topics: [{ name: 'Linux & Bash Scripting', hours: 12, checklists: ['File Permissions & Users', 'Cron Jobs', 'Shell Automation'] }, { name: 'Docker & Kubernetes', hours: 25, checklists: ['Dockerfile Best Practices', 'K8s Pods & Services', 'Helm Charts'] }, { name: 'CI/CD & Terraform', hours: 20, checklists: ['GitHub Actions', 'Terraform Modules', 'Prometheus & Grafana'] }] }] }
    };

    const preset = presets[templateKey] || presets['ai'];
    const rRes = await this.createRoadmap(userId, preset.title, preset.description, preset.role, preset.difficulty, preset.duration);
    const roadmapId = rRes.id;

    for (let sIdx = 0; sIdx < preset.sections.length; sIdx++) {
      const sec = preset.sections[sIdx];
      const secRes = await this.createRoadmapSection(roadmapId, sec.name, sIdx);
      const sectionId = secRes.id;

      for (let tIdx = 0; tIdx < sec.topics.length; tIdx++) {
        const top = sec.topics[tIdx];
        const topRes = await this.createRoadmapTopic(
          sectionId,
          roadmapId,
          top.name,
          top.desc || '',
          top.difficulty || 'Intermediate',
          'medium',
          top.hours || 10
        );
        const topicId = topRes.id;

        if (top.checklists && top.checklists.length > 0) {
          for (let cIdx = 0; cIdx < top.checklists.length; cIdx++) {
            await this.addTopicChecklist(topicId, top.checklists[cIdx]);
          }
        }

        if (top.resources && top.resources.length > 0) {
          for (const res of top.resources) {
            await this.addTopicResource(topicId, res.title, res.url, res.type, '');
          }
        }
      }
    }

    await this.setActiveRoadmap(userId, roadmapId);
    return roadmapId;
  }
};
