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
  
  async getUserByFirebaseUid(uid: string) {
    return get('SELECT * FROM users WHERE firebase_uid = ?', [uid]);
  },
  
  async getUserById(id: number) {
    return get('SELECT id, firebase_uid, name, email, daily_goal_minutes, timezone, created_at FROM users WHERE id = ?', [id]);
  },
  
  async createUser(name: string, email: string, passwordHash: string = '', firebaseUid: string = '') {
    return run(
      'INSERT INTO users (firebase_uid, name, email, password_hash) VALUES (?, ?, ?, ?)',
      [firebaseUid, name.trim(), email.toLowerCase().trim(), passwordHash]
    );
  },

  async syncFirebaseUser(firebaseUid: string, email: string, displayName?: string) {
    const cleanEmail = email.toLowerCase().trim();
    // 1. Check by firebase_uid
    let user = await get('SELECT * FROM users WHERE firebase_uid = ?', [firebaseUid]);
    if (user) {
      return user;
    }

    // 2. Check by email and update firebase_uid link
    user = await get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (user) {
      await run('UPDATE users SET firebase_uid = ? WHERE id = ?', [firebaseUid, user.id]);
      return await get('SELECT * FROM users WHERE id = ?', [user.id]);
    }

    // 3. Create new user record for this Firebase UID
    const fallbackName = displayName?.trim() || cleanEmail.split('@')[0] || 'User';
    const result = await run(
      'INSERT INTO users (firebase_uid, name, email, daily_goal_minutes, timezone) VALUES (?, ?, ?, 60, "UTC")',
      [firebaseUid, fallbackName, cleanEmail]
    );

    return await get('SELECT * FROM users WHERE id = ?', [result.id]);
  },

  
  async updateUserProfile(id: number, name: string, dailyGoalMinutes: number, timezone: string) {
    return run(
      'UPDATE users SET name = ?, daily_goal_minutes = ?, timezone = ? WHERE id = ?',
      [name.trim(), dailyGoalMinutes, timezone, id]
    );
  },

  // Password Reset Methods
  async createPasswordResetToken(email: string, token: string, expiresAtISO: string) {
    const user = await this.getUserByEmail(email);
    if (!user) {
      return null;
    }
    await run(
      'INSERT INTO password_reset_tokens (user_id, email, token, expires_at, used) VALUES (?, ?, ?, ?, 0)',
      [user.id, user.email, token, expiresAtISO]
    );
    return { token, userId: user.id, email: user.email, expiresAt: expiresAtISO };
  },

  async getPasswordResetToken(token: string) {
    return get('SELECT * FROM password_reset_tokens WHERE token = ?', [token]);
  },

  async resetPasswordWithToken(token: string, newPasswordHash: string) {
    const record = await this.getPasswordResetToken(token);
    if (!record) {
      throw new Error('Invalid or non-existent password reset link.');
    }
    if (record.used === 1) {
      throw new Error('This password reset link has already been used.');
    }
    const now = new Date();
    const expiry = new Date(record.expires_at);
    if (now > expiry) {
      throw new Error('This password reset link has expired. Please request a new one.');
    }

    // Update user password
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, record.user_id]);

    // Mark token as used
    await run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [record.id]);

    return { success: true, userId: record.user_id, email: record.email };
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

    const res = await run(
      `INSERT INTO topics (user_id, date, title, subject, est_minutes, priority, status, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, date, title.trim(), subject.trim(), estMinutes, priority, status, nextOrder]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      const topicPayload = {
        id: res.id,
        user_id: userId,
        date,
        title: title.trim(),
        subject: subject.trim(),
        est_minutes: estMinutes,
        priority,
        status,
        order_index: nextOrder
      };
      await SyncService.queueChange('topics', res.id, 'CREATE', topicPayload);
      await SyncService.queueChange('tasks', res.id, 'CREATE', topicPayload);
    } catch (e: any) {
      console.warn('[db.addTopic] Sync notice:', e.message || e);
    }

    return res;
  },
  
  async updateTopic(id: number, fields: { title?: string; subject?: string; est_minutes?: number; priority?: string; status?: string }) {
    const topic = await get('SELECT * FROM topics WHERE id = ?', [id]) as any;
    if (!topic) throw new Error('Topic not found');
    
    const res = await run(
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

    try {
      const { SyncService } = await import('./services/SyncService');
      const updated = await get('SELECT * FROM topics WHERE id = ?', [id]);
      if (updated) {
        await SyncService.queueChange('topics', id, 'UPDATE', updated);
        await SyncService.queueChange('tasks', id, 'UPDATE', updated);
      }
    } catch (e: any) {
      console.warn('[db.updateTopic] Sync notice:', e.message || e);
    }

    return res;
  },
  
  async deleteTopic(id: number) {
    const res = await run('DELETE FROM topics WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      await SyncService.queueChange('topics', id, 'DELETE', { id });
      await SyncService.queueChange('tasks', id, 'DELETE', { id });
    } catch (e: any) {
      console.warn('[db.deleteTopic] Sync notice:', e.message || e);
    }
    return res;
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
    
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('focus_sessions', result.id, 'CREATE', {
        id: result.id,
        user_id: userId,
        topic_id: topicId,
        subject: subject.trim(),
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMinutes,
        type,
        note,
        scheduled_duration: finalScheduled,
        actual_duration: finalActual,
        saved_time: savedTime,
        save_time_used: saveTimeUsed,
        task_name: finalTaskName
      });
    } catch (e) {}

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
    const res = await run(
      `INSERT INTO dsa_problems (user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, p.title.trim(), p.platform.trim(), p.url || null, p.pattern.trim(), p.difficulty, p.status, p.time_spent_minutes, p.date_solved, p.notes || '']
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('dsa_problems', res.id, 'CREATE', {
        id: res.id,
        user_id: userId,
        title: p.title.trim(),
        platform: p.platform.trim(),
        url: p.url || null,
        pattern: p.pattern.trim(),
        difficulty: p.difficulty,
        status: p.status,
        time_spent_minutes: p.time_spent_minutes,
        date_solved: p.date_solved,
        notes: p.notes || ''
      });
    } catch (e) {}

    return res;
  },
  
  async updateDsaProblem(id: number, fields: any) {
    const prob = await get('SELECT * FROM dsa_problems WHERE id = ?', [id]) as any;
    if (!prob) throw new Error('Problem not found');
    const res = await run(
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

    try {
      const { SyncService } = await import('./services/SyncService');
      const updated = await get('SELECT * FROM dsa_problems WHERE id = ?', [id]);
      if (updated) {
        SyncService.queueChange('dsa_problems', id, 'UPDATE', updated);
      }
    } catch (e) {}

    return res;
  },
  
  async deleteDsaProblem(id: number) {
    const res = await run('DELETE FROM dsa_problems WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('dsa_problems', id, 'DELETE', { id });
    } catch (e) {}
    return res;
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
    const res = await run(
      `INSERT INTO projects (user_id, name, description, status, start_date, target_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, p.name.trim(), p.description || '', p.status, p.start_date || null, p.target_date || null]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('projects', res.id, 'CREATE', {
        id: res.id,
        user_id: userId,
        name: p.name.trim(),
        description: p.description || '',
        status: p.status,
        start_date: p.start_date || null,
        target_date: p.target_date || null
      });
    } catch (e) {}

    return res;
  },
  
  async updateProject(id: number, fields: any) {
    const proj = await get('SELECT * FROM projects WHERE id = ?', [id]) as any;
    if (!proj) throw new Error('Project not found');
    const res = await run(
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

    try {
      const { SyncService } = await import('./services/SyncService');
      const updated = await get('SELECT * FROM projects WHERE id = ?', [id]);
      if (updated) {
        SyncService.queueChange('projects', id, 'UPDATE', updated);
      }
    } catch (e) {}

    return res;
  },
  
  async deleteProject(id: number) {
    const res = await run('DELETE FROM projects WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('projects', id, 'DELETE', { id });
    } catch (e) {}
    return res;
  },
  
  async addProjectTask(projectId: number, title: string, dueDate: string) {
    const res = await run(
      'INSERT INTO project_tasks (project_id, title, done, due_date) VALUES (?, ?, 0, ?)',
      [projectId, title.trim(), dueDate || null]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('project_tasks', res.id, 'CREATE', {
        id: res.id,
        project_id: projectId,
        title: title.trim(),
        done: 0,
        due_date: dueDate || null
      });
    } catch (e) {}

    return res;
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

      try {
        const { SyncService } = await import('./services/SyncService');
        SyncService.queueChange('timetable_blocks', result.id, 'CREATE', {
          id: result.id,
          user_id: userId,
          day_of_week: block.day_of_week,
          start_time: block.start_time,
          end_time: block.end_time,
          subject: block.subject.trim(),
          color: block.color || '#4f46e5',
          recurring: block.recurring ? 1 : 0,
          specific_date: block.recurring ? null : block.specific_date || null
        });
      } catch (e) {}

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
    const res = await run('DELETE FROM timetable_blocks WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('timetable_blocks', id, 'DELETE', { id });
    } catch (e) {}
    return res;
  },

  // Habits
  async getHabits(userId: number) {
    return query('SELECT * FROM habits WHERE user_id = ?', [userId]);
  },
  
  async getHabitLogs(habitId: number) {
    return query('SELECT date, completed FROM habit_logs WHERE habit_id = ?', [habitId]);
  },
  
  async addHabit(userId: number, name: string, targetDays: string, autoLinked: string, targetValue: number) {
    const res = await run(
      `INSERT INTO habits (user_id, name, target_days, auto_linked, target_value)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, name.trim(), targetDays, autoLinked, targetValue]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('habits', res.id, 'CREATE', {
        id: res.id,
        user_id: userId,
        name: name.trim(),
        target_days: targetDays,
        auto_linked: autoLinked,
        target_value: targetValue
      });
    } catch (e) {}

    return res;
  },
  
  async deleteHabit(id: number) {
    const res = await run('DELETE FROM habits WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('habits', id, 'DELETE', { id });
    } catch (e) {}
    return res;
  },
  
  async toggleHabitLog(habitId: number, date: string, completed: boolean) {
    const isCompleted = completed ? 1 : 0;
    const res = await run(
      `INSERT INTO habit_logs (habit_id, date, completed)
       VALUES (?, ?, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed`,
      [habitId, date, isCompleted]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      const docId = `${habitId}_${date}`;
      SyncService.queueChange('habit_logs', docId, 'UPDATE', {
        id: docId,
        habit_id: habitId,
        date,
        completed: isCompleted
      });
    } catch (e) {}

    return res;
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
    const res = await run(
      `INSERT INTO notes (user_id, title, subject, body, linked_topic_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, title.trim(), subject.trim(), body, linkedTopicId || null]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('notes', res.id, 'CREATE', {
        id: res.id,
        user_id: userId,
        title: title.trim(),
        subject: subject.trim(),
        body,
        linked_topic_id: linkedTopicId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (e) {}

    return res;
  },
  
  async updateNote(id: number, fields: { title?: string; subject?: string; body?: string; linked_topic_id?: number | null }) {
    const note = await get('SELECT * FROM notes WHERE id = ?', [id]) as any;
    if (!note) throw new Error('Note not found');
    const res = await run(
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

    try {
      const updated = await get('SELECT * FROM notes WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('notes', id, 'UPDATE', updated);
    } catch (e) {}

    return res;
  },
  
  async deleteNote(id: number) {
    const res = await run('DELETE FROM notes WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('notes', id, 'DELETE', { id });
    } catch (e) {}
    return res;
  },

  // Flashcards & Decks
  async getDecks(userId: number) {
    return query('SELECT * FROM flashcard_decks WHERE user_id = ? ORDER BY name ASC', [userId]);
  },
  
  async addDeck(userId: number, name: string, subject: string) {
    const res = await run(
      'INSERT INTO flashcard_decks (user_id, name, subject) VALUES (?, ?, ?)',
      [userId, name.trim(), subject.trim()]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('flashcard_decks', res.id, 'CREATE', {
        id: res.id,
        user_id: userId,
        name: name.trim(),
        subject: subject.trim(),
        created_at: new Date().toISOString()
      });
    } catch (e) {}

    return res;
  },
  
  async deleteDeck(id: number) {
    const res = await run('DELETE FROM flashcard_decks WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('flashcard_decks', id, 'DELETE', { id });
    } catch (e) {}
    return res;
  },
  
  async getCards(deckId: number) {
    return query('SELECT * FROM flashcards WHERE deck_id = ? ORDER BY next_review_date ASC', [deckId]);
  },
  
  async addCard(deckId: number, front: string, back: string) {
    const todayStr = new Date().toISOString().split('T')[0];
    const res = await run(
      `INSERT INTO flashcards (deck_id, front, back, ease_factor, interval_days, next_review_date, review_count)
       VALUES (?, ?, ?, 2.5, 0, ?, 0)`,
      [deckId, front.trim(), back.trim(), todayStr]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('flashcards', res.id, 'CREATE', {
        id: res.id,
        deck_id: deckId,
        front: front.trim(),
        back: back.trim(),
        ease_factor: 2.5,
        interval_days: 0,
        next_review_date: todayStr,
        review_count: 0
      });
    } catch (e) {}

    return res;
  },
  
  async deleteCard(id: number) {
    const res = await run('DELETE FROM flashcards WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('flashcards', id, 'DELETE', { id });
    } catch (e) {}
    return res;
  },
  
  async updateCard(id: number, front: string, back: string) {
    const res = await run(
      'UPDATE flashcards SET front = ?, back = ? WHERE id = ?',
      [front.trim(), back.trim(), id]
    );

    try {
      const card = await get('SELECT * FROM flashcards WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('flashcards', id, 'UPDATE', card);
    } catch (e) {}

    return res;
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
      'SELECT * FROM roadmaps WHERE user_id = ? AND (is_custom IS NULL OR is_custom = 1) ORDER BY is_active DESC, updated_at DESC',
      [userId]
    );
  },

  async getRoadmapById(id: number) {
    return get('SELECT * FROM roadmaps WHERE id = ?', [id]);
  },

  async getActiveRoadmap(userId: number) {
    const active = await get('SELECT * FROM roadmaps WHERE user_id = ? AND is_active = 1 AND (is_custom IS NULL OR is_custom = 1) LIMIT 1', [userId]);
    if (active) return active;
    return get('SELECT * FROM roadmaps WHERE user_id = ? AND (is_custom IS NULL OR is_custom = 1) ORDER BY updated_at DESC LIMIT 1', [userId]);
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
    const existing = await query('SELECT id FROM roadmaps WHERE user_id = ? AND (is_custom IS NULL OR is_custom = 1)', [userId]);
    const isActive = existing.length === 0 ? 1 : 0;

    const res = await run(
      `INSERT INTO roadmaps (user_id, title, description, target_role, difficulty, duration, is_active, is_custom)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [userId, title.trim(), description.trim(), targetRole.trim(), difficulty, duration, isActive]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmaps', res.id, 'CREATE', {
        id: res.id,
        user_id: userId,
        title: title.trim(),
        description: description.trim(),
        target_role: targetRole.trim(),
        status: 'active',
        difficulty,
        duration,
        is_active: isActive,
        is_custom: 1
      });
    } catch (e) {}

    return res;
  },

  async updateRoadmap(id: number, fields: { title?: string; description?: string; target_role?: string; status?: string; difficulty?: string; duration?: string }) {
    const r = await get('SELECT * FROM roadmaps WHERE id = ?', [id]) as any;
    if (!r) throw new Error('Roadmap not found');

    const res = await run(
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

    try {
      const updated = await get('SELECT * FROM roadmaps WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmaps', id, 'UPDATE', updated);
    } catch (e) {}

    return res;
  },

  async deleteRoadmap(id: number) {
    const res = await run('DELETE FROM roadmaps WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmaps', id, 'DELETE', { id });
    } catch (e) {}
    return res;
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
    const res = await run(
      'INSERT INTO roadmap_sections (roadmap_id, title, order_index) VALUES (?, ?, ?)',
      [roadmapId, title.trim(), order]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_sections', res.id, 'CREATE', {
        id: res.id,
        roadmap_id: roadmapId,
        title: title.trim(),
        order_index: order
      });
    } catch (e) {}

    return res;
  },

  async updateRoadmapSection(id: number, title: string) {
    const res = await run('UPDATE roadmap_sections SET title = ? WHERE id = ?', [title.trim(), id]);
    try {
      const sec = await get('SELECT * FROM roadmap_sections WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_sections', id, 'UPDATE', sec);
    } catch (e) {}
    return res;
  },

  async deleteRoadmapSection(id: number) {
    const res = await run('DELETE FROM roadmap_sections WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_sections', id, 'DELETE', { id });
    } catch (e) {}
    return res;
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

    const res = await run(
      `INSERT INTO roadmap_topics (section_id, roadmap_id, name, description, status, difficulty, priority, estimated_hours, order_index)
       VALUES (?, ?, ?, ?, 'not started', ?, ?, ?, ?)`,
      [sectionId, roadmapId, name.trim(), description.trim(), difficulty, priority, estimatedHours, nextOrder]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_topics', res.id, 'CREATE', {
        id: res.id,
        section_id: sectionId,
        roadmap_id: roadmapId,
        name: name.trim(),
        description: description.trim(),
        status: 'not started',
        difficulty,
        priority,
        estimated_hours: estimatedHours,
        completed_hours: 0,
        order_index: nextOrder
      });
    } catch (e) {}

    return res;
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

    try {
      const updated = await get('SELECT * FROM roadmap_topics WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_topics', id, 'UPDATE', updated);
    } catch (e) {}

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

    try {
      const updated = await get('SELECT * FROM roadmap_topics WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_topics', id, 'UPDATE', updated);
    } catch (e) {}
  },

  async deleteRoadmapTopic(id: number) {
    const res = await run('DELETE FROM roadmap_topics WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_topics', id, 'DELETE', { id });
    } catch (e) {}
    return res;
  },

  // Roadmap Topic Resources
  async getTopicResources(topicId: number) {
    return query(
      'SELECT * FROM roadmap_resources WHERE topic_id = ? ORDER BY id ASC',
      [topicId]
    );
  },

  async addTopicResource(topicId: number, title: string, url: string, type: string, duration: string = '') {
    const res = await run(
      'INSERT INTO roadmap_resources (topic_id, title, url, type, duration) VALUES (?, ?, ?, ?, ?)',
      [topicId, title.trim(), url.trim(), type, duration.trim()]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_resources', res.id, 'CREATE', {
        id: res.id,
        topic_id: topicId,
        title: title.trim(),
        url: url.trim(),
        type,
        duration: duration.trim(),
        completed: 0
      });
    } catch (e) {}

    return res;
  },

  async updateTopicResource(id: number, fields: { title?: string; url?: string; type?: string; duration?: string; completed?: number }) {
    const r = await get('SELECT * FROM roadmap_resources WHERE id = ?', [id]) as any;
    if (!r) throw new Error('Resource not found');

    const res = await run(
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

    try {
      const updated = await get('SELECT * FROM roadmap_resources WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_resources', id, 'UPDATE', updated);
    } catch (e) {}

    return res;
  },

  async deleteTopicResource(id: number) {
    const res = await run('DELETE FROM roadmap_resources WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_resources', id, 'DELETE', { id });
    } catch (e) {}
    return res;
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

    const res = await run(
      'INSERT INTO roadmap_checklists (topic_id, title, order_index) VALUES (?, ?, ?)',
      [topicId, title.trim(), nextOrder]
    );

    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_checklists', res.id, 'CREATE', {
        id: res.id,
        topic_id: topicId,
        title: title.trim(),
        completed: 0,
        order_index: nextOrder
      });
    } catch (e) {}

    return res;
  },

  async toggleTopicChecklist(id: number, completed: boolean) {
    const res = await run('UPDATE roadmap_checklists SET completed = ? WHERE id = ?', [completed ? 1 : 0, id]);
    try {
      const chk = await get('SELECT * FROM roadmap_checklists WHERE id = ?', [id]) as any;
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_checklists', id, 'UPDATE', chk);
    } catch (e) {}
    return res;
  },

  async deleteTopicChecklist(id: number) {
    const res = await run('DELETE FROM roadmap_checklists WHERE id = ?', [id]);
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.queueChange('roadmap_checklists', id, 'DELETE', { id });
    } catch (e) {}
    return res;
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

  // Cleanup default / preset roadmaps migration routine
  async cleanupDefaultRoadmaps(userId: number) {
    try {
      const allRoadmaps = await query('SELECT * FROM roadmaps WHERE user_id = ?', [userId]);
      const defaultTitles = ['AI Engineer', 'Data Scientist', 'Full Stack Developer', 'Backend Developer', 'DevOps Engineer'];
      const defaultDescPrefixes = [
        'Comprehensive curriculum',
        'End-to-end path',
        'Modern full-stack',
        'Deep dive into',
        'Master CI/CD'
      ];

      for (const r of allRoadmaps as any[]) {
        const title = (r.title || '').trim();
        const desc = (r.description || '').trim();
        const isKnownDefaultName = defaultTitles.includes(title);
        const matchesDefaultDesc = defaultDescPrefixes.some(prefix => desc.startsWith(prefix));
        const isExplicitNotCustom = r.is_custom === 0;

        if (isExplicitNotCustom || (isKnownDefaultName && matchesDefaultDesc)) {
          console.log(`[db.cleanupDefaultRoadmaps] Removing unwanted default roadmap: ID ${r.id} ("${title}")`);
          await this.deleteRoadmap(r.id);
        }
      }
    } catch (err) {
      console.warn('[db.cleanupDefaultRoadmaps] Error during cleanup:', err);
    }
  },

  // --- SYNC SERVICE DATABASE HELPERS ---
  async addSyncQueueItem(firebaseUid: string, entityType: string, entityId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: string) {
    return run(
      `INSERT INTO sync_queue (firebase_uid, entity_type, entity_id, operation, payload, sync_status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      [firebaseUid, entityType, entityId, operation, payload]
    );
  },

  async getPendingSyncQueue(firebaseUid: string) {
    return query(
      `SELECT * FROM sync_queue WHERE firebase_uid = ? AND sync_status = 'PENDING' ORDER BY id ASC`,
      [firebaseUid]
    );
  },

  async markSyncQueueItemSynced(id: number) {
    return run(`UPDATE sync_queue SET sync_status = 'SYNCED' WHERE id = ?`, [id]);
  },

  async getAllRecordsForSync(tableName: string, userId: number) {
    try {
      if (tableName === 'roadmaps') {
        return await query(`SELECT * FROM roadmaps WHERE user_id = ?`, [userId]);
      } else if (tableName === 'roadmap_sections') {
        const userRoadmaps = await query(`SELECT id FROM roadmaps WHERE user_id = ?`, [userId]);
        const rIds = userRoadmaps.map((r: any) => r.id);
        if (rIds.length === 0) return [];
        const allSections = await query(`SELECT * FROM roadmap_sections`, []);
        return allSections.filter((s: any) => rIds.includes(s.roadmap_id));
      } else if (tableName === 'roadmap_topics') {
        const userRoadmaps = await query(`SELECT id FROM roadmaps WHERE user_id = ?`, [userId]);
        const rIds = userRoadmaps.map((r: any) => r.id);
        if (rIds.length === 0) return [];
        const allTopics = await query(`SELECT * FROM roadmap_topics`, []);
        return allTopics.filter((t: any) => rIds.includes(t.roadmap_id));
      } else if (tableName === 'roadmap_resources') {
        const userRoadmaps = await query(`SELECT id FROM roadmaps WHERE user_id = ?`, [userId]);
        const rIds = userRoadmaps.map((r: any) => r.id);
        if (rIds.length === 0) return [];
        const allTopics = await query(`SELECT * FROM roadmap_topics`, []);
        const tIds = allTopics.filter((t: any) => rIds.includes(t.roadmap_id)).map((t: any) => t.id);
        if (tIds.length === 0) return [];
        const allRes = await query(`SELECT * FROM roadmap_resources`, []);
        return allRes.filter((res: any) => tIds.includes(res.topic_id));
      } else if (tableName === 'roadmap_checklists') {
        const userRoadmaps = await query(`SELECT id FROM roadmaps WHERE user_id = ?`, [userId]);
        const rIds = userRoadmaps.map((r: any) => r.id);
        if (rIds.length === 0) return [];
        const allTopics = await query(`SELECT * FROM roadmap_topics`, []);
        const tIds = allTopics.filter((t: any) => rIds.includes(t.roadmap_id)).map((t: any) => t.id);
        if (tIds.length === 0) return [];
        const allChk = await query(`SELECT * FROM roadmap_checklists`, []);
        return allChk.filter((c: any) => tIds.includes(c.topic_id));
      } else if (tableName === 'project_tasks') {
        const projects = await query(`SELECT id FROM projects WHERE user_id = ?`, [userId]);
        const pIds = projects.map((p: any) => p.id);
        if (pIds.length === 0) return [];
        const allTasks = await query(`SELECT * FROM project_tasks`, []);
        return allTasks.filter((pt: any) => pIds.includes(pt.project_id));
      } else if (tableName === 'habit_logs') {
        const habits = await query(`SELECT id FROM habits WHERE user_id = ?`, [userId]);
        const hIds = habits.map((h: any) => h.id);
        if (hIds.length === 0) return [];
        const allLogs = await query(`SELECT * FROM habit_logs`, []);
        return allLogs.filter((l: any) => hIds.includes(l.habit_id));
      } else if (tableName === 'flashcards') {
        const decks = await query(`SELECT id FROM flashcard_decks WHERE user_id = ?`, [userId]);
        const dIds = decks.map((d: any) => d.id);
        if (dIds.length === 0) return [];
        const allCards = await query(`SELECT * FROM flashcards`, []);
        return allCards.filter((c: any) => dIds.includes(c.deck_id));
      } else {
        return await query(`SELECT * FROM ${tableName} WHERE user_id = ?`, [userId]);
      }
    } catch (e) {
      console.error(`getAllRecordsForSync error for ${tableName}:`, e);
      return [];
    }
  },

  async genericUpsert(tableName: string, record: any) {
    if (!record || !record.id) return;
    const cols = Object.keys(record);
    const placeholders = cols.map(() => '?').join(', ');
    const updateCols = cols.map(c => `${c} = excluded.${c}`).join(', ');
    const values = cols.map(c => record[c]);

    const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})
                 ON CONFLICT(id) DO UPDATE SET ${updateCols}`;
    return run(sql, values);
  },

  async genericDelete(tableName: string, id: string | number) {
    return run(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
  },

  async saveRemoteTopic(topic: any) {
    if (!topic || !topic.id) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const targetDate = topic.date || todayStr;
    const targetTitle = (topic.title || topic.name || topic.task_name || 'New Task').toString().trim();
    const targetSubject = (topic.subject || 'General').toString().trim();
    const targetEst = topic.est_minutes || topic.estMinutes || 0;
    const targetPriority = topic.priority || 'med';
    const targetStatus = topic.status || (topic.completed ? 'done' : 'not started');

    return run(
      `INSERT INTO topics (id, user_id, date, title, subject, est_minutes, priority, status, carried_over_from, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, date = excluded.date, title = excluded.title, subject = excluded.subject,
         est_minutes = excluded.est_minutes, priority = excluded.priority,
         status = excluded.status, order_index = excluded.order_index`,
      [topic.id, topic.user_id, targetDate, targetTitle, targetSubject, targetEst, targetPriority, targetStatus, topic.carried_over_from || null, topic.order_index || 0]
    );
  },

  async saveRemoteNote(note: any) {
    if (!note || !note.id) return;
    return run(
      `INSERT INTO notes (id, user_id, title, subject, body, linked_topic_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, title = excluded.title, subject = excluded.subject, body = excluded.body,
         linked_topic_id = excluded.linked_topic_id, updated_at = excluded.updated_at`,
      [note.id, note.user_id, note.title, note.subject, note.body, note.linked_topic_id || null, note.created_at, note.updated_at]
    );
  },

  async saveRemoteHabit(habit: any) {
    if (!habit || !habit.id) return;
    return run(
      `INSERT INTO habits (id, user_id, name, target_days, auto_linked, target_value)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, name = excluded.name, target_days = excluded.target_days,
         auto_linked = excluded.auto_linked, target_value = excluded.target_value`,
      [habit.id, habit.user_id, habit.name, habit.target_days, habit.auto_linked || 'none', habit.target_value || 0]
    );
  },

  async saveRemoteHabitLog(log: any) {
    if (!log || !log.habit_id || !log.date) return;
    return run(
      `INSERT INTO habit_logs (habit_id, date, completed)
       VALUES (?, ?, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed`,
      [log.habit_id || log.habitId, log.date, log.completed ? 1 : 0]
    );
  },

  async saveRemoteProject(project: any) {
    if (!project || !project.id) return;
    return run(
      `INSERT INTO projects (id, user_id, name, description, status, start_date, target_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, name = excluded.name, description = excluded.description,
         status = excluded.status, start_date = excluded.start_date, target_date = excluded.target_date`,
      [project.id, project.user_id, project.name, project.description, project.status, project.start_date, project.target_date]
    );
  },

  async saveRemoteProjectTask(task: any) {
    if (!task || !task.id) return;
    return run(
      `INSERT INTO project_tasks (id, project_id, title, done, due_date)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id, title = excluded.title, done = excluded.done, due_date = excluded.due_date`,
      [task.id, task.project_id || task.projectId, (task.title || '').trim(), task.done ? 1 : 0, task.due_date || task.dueDate || null]
    );
  },

  async saveRemoteDsaProblem(prob: any) {
    if (!prob || !prob.id) return;
    return run(
      `INSERT INTO dsa_problems (id, user_id, title, platform, url, pattern, difficulty, status, time_spent_minutes, date_solved, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, title = excluded.title, platform = excluded.platform, url = excluded.url,
         pattern = excluded.pattern, difficulty = excluded.difficulty, status = excluded.status,
         time_spent_minutes = excluded.time_spent_minutes, date_solved = excluded.date_solved, notes = excluded.notes`,
      [prob.id, prob.user_id, prob.title, prob.platform, prob.url, prob.pattern, prob.difficulty, prob.status, prob.time_spent_minutes, prob.date_solved, prob.notes]
    );
  },

  async saveRemoteTimetableBlock(block: any) {
    if (!block || !block.id) return;
    return run(
      `INSERT INTO timetable_blocks (id, user_id, day_of_week, start_time, end_time, subject, color, recurring, specific_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, day_of_week = excluded.day_of_week, start_time = excluded.start_time, end_time = excluded.end_time,
         subject = excluded.subject, color = excluded.color, recurring = excluded.recurring, specific_date = excluded.specific_date`,
      [block.id, block.user_id, block.day_of_week, block.start_time, block.end_time, block.subject, block.color, block.recurring, block.specific_date]
    );
  },

  async saveRemoteFocusSession(session: any) {
    if (!session || !session.id) return;
    return run(
      `INSERT INTO focus_sessions (id, user_id, topic_id, subject, start_time, end_time, duration_minutes, type, note, scheduled_duration, actual_duration, saved_time, save_time_used, task_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, subject = excluded.subject, duration_minutes = excluded.duration_minutes, note = excluded.note`,
      [session.id, session.user_id, session.topic_id || null, session.subject, session.start_time, session.end_time, session.duration_minutes, session.type, session.note, session.scheduled_duration || 0, session.actual_duration || 0, session.saved_time || 0, session.save_time_used || 0, session.task_name || '']
    );
  },

  async saveRemoteFlashcardDeck(deck: any) {
    if (!deck || !deck.id) return;
    return run(
      `INSERT INTO flashcard_decks (id, user_id, name, subject, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, name = excluded.name, subject = excluded.subject`,
      [deck.id, deck.user_id || 1, (deck.name || '').trim(), (deck.subject || '').trim(), deck.created_at || new Date().toISOString()]
    );
  },

  async saveRemoteFlashcard(card: any) {
    if (!card || !card.id) return;
    return run(
      `INSERT INTO flashcards (id, deck_id, front, back, ease_factor, interval_days, next_review_date, review_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         deck_id = excluded.deck_id, front = excluded.front, back = excluded.back, ease_factor = excluded.ease_factor,
         interval_days = excluded.interval_days, next_review_date = excluded.next_review_date, review_count = excluded.review_count`,
      [
        card.id,
        card.deck_id || card.deckId,
        (card.front || '').trim(),
        (card.back || '').trim(),
        card.ease_factor !== undefined ? card.ease_factor : 2.5,
        card.interval_days !== undefined ? card.interval_days : 0,
        card.next_review_date || new Date().toISOString().split('T')[0],
        card.review_count !== undefined ? card.review_count : 0,
        card.created_at || new Date().toISOString()
      ]
    );
  },

  async saveRemoteUserStats(stats: any) {
    if (!stats || (!stats.user_id && !stats.userId)) return;
    const uid = stats.user_id || stats.userId;
    return run(
      `INSERT INTO user_stats (user_id, total_saved_time, available_saved_time, weekly_saved_time, monthly_saved_time)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         total_saved_time = excluded.total_saved_time, available_saved_time = excluded.available_saved_time,
         weekly_saved_time = excluded.weekly_saved_time, monthly_saved_time = excluded.monthly_saved_time`,
      [uid, stats.total_saved_time || 0, stats.available_saved_time || 0, stats.weekly_saved_time || 0, stats.monthly_saved_time || 0]
    );
  },

  async saveRemoteRoadmap(r: any) {
    if (!r || !r.id) return;
    const isCustom = r.is_custom !== undefined ? r.is_custom : (r.isCustom !== undefined ? (r.isCustom ? 1 : 0) : 1);
    return run(
      `INSERT INTO roadmaps (id, user_id, title, description, target_role, status, difficulty, duration, is_active, is_custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id, title = excluded.title, description = excluded.description,
         target_role = excluded.target_role, status = excluded.status, difficulty = excluded.difficulty,
         duration = excluded.duration, is_active = excluded.is_active, is_custom = excluded.is_custom, updated_at = excluded.updated_at`,
      [
        r.id,
        r.user_id || 1,
        (r.title || '').trim(),
        (r.description || '').trim(),
        (r.target_role || r.targetRole || '').trim(),
        r.status || 'active',
        r.difficulty || 'Intermediate',
        r.duration || '12 weeks',
        r.is_active !== undefined ? r.is_active : (r.isActive ? 1 : 0),
        isCustom,
        r.created_at || new Date().toISOString(),
        r.updated_at || new Date().toISOString()
      ]
    );
  },

  async saveRemoteRoadmapSection(sec: any) {
    if (!sec || !sec.id) return;
    return run(
      `INSERT INTO roadmap_sections (id, roadmap_id, title, order_index, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         roadmap_id = excluded.roadmap_id, title = excluded.title, order_index = excluded.order_index`,
      [
        sec.id,
        sec.roadmap_id || sec.roadmapId,
        (sec.title || '').trim(),
        sec.order_index !== undefined ? sec.order_index : (sec.orderIndex || 0),
        sec.created_at || new Date().toISOString()
      ]
    );
  },

  async saveRemoteRoadmapTopic(t: any) {
    if (!t || !t.id) return;
    return run(
      `INSERT INTO roadmap_topics (id, section_id, roadmap_id, name, description, status, difficulty, priority, estimated_hours, completed_hours, completion_date, notes, linked_project_id, linked_note_id, next_revision_date, revision_count, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         section_id = excluded.section_id, roadmap_id = excluded.roadmap_id, name = excluded.name,
         description = excluded.description, status = excluded.status, difficulty = excluded.difficulty,
         priority = excluded.priority, estimated_hours = excluded.estimated_hours, completed_hours = excluded.completed_hours,
         completion_date = excluded.completion_date, notes = excluded.notes, linked_project_id = excluded.linked_project_id,
         linked_note_id = excluded.linked_note_id, next_revision_date = excluded.next_revision_date,
         revision_count = excluded.revision_count, order_index = excluded.order_index`,
      [
        t.id,
        t.section_id || t.sectionId,
        t.roadmap_id || t.roadmapId,
        (t.name || t.title || '').trim(),
        (t.description || '').trim(),
        t.status || 'not started',
        t.difficulty || 'Intermediate',
        t.priority || 'medium',
        t.estimated_hours !== undefined ? t.estimated_hours : (t.estimatedHours || 0),
        t.completed_hours !== undefined ? t.completed_hours : (t.completedHours || 0),
        t.completion_date || t.completionDate || null,
        t.notes || null,
        t.linked_project_id || t.linkedProjectId || null,
        t.linked_note_id || t.linkedNoteId || null,
        t.next_revision_date || t.nextRevisionDate || null,
        t.revision_count !== undefined ? t.revision_count : (t.revisionCount || 0),
        t.order_index !== undefined ? t.order_index : (t.orderIndex || 0),
        t.created_at || new Date().toISOString()
      ]
    );
  },

  async saveRemoteRoadmapResource(res: any) {
    if (!res || !res.id) return;
    return run(
      `INSERT INTO roadmap_resources (id, topic_id, title, url, type, duration, completed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         topic_id = excluded.topic_id, title = excluded.title, url = excluded.url,
         type = excluded.type, duration = excluded.duration, completed = excluded.completed`,
      [
        res.id,
        res.topic_id || res.topicId,
        (res.title || '').trim(),
        (res.url || '').trim(),
        res.type || 'Documentation',
        (res.duration || '').trim(),
        res.completed !== undefined ? (res.completed ? 1 : 0) : 0,
        res.created_at || new Date().toISOString()
      ]
    );
  },

  async saveRemoteRoadmapChecklist(c: any) {
    if (!c || !c.id) return;
    return run(
      `INSERT INTO roadmap_checklists (id, topic_id, title, completed, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         topic_id = excluded.topic_id, title = excluded.title, completed = excluded.completed, order_index = excluded.order_index`,
      [
        c.id,
        c.topic_id || c.topicId,
        (c.title || '').trim(),
        c.completed !== undefined ? (c.completed ? 1 : 0) : 0,
        c.order_index !== undefined ? c.order_index : (c.orderIndex || 0),
        c.created_at || new Date().toISOString()
      ]
    );
  }
};
