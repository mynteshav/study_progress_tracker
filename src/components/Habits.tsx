import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../App';
import { TimerService } from '../services/TimerService';

interface HabitsProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Habits({ user, showToast }: HabitsProps) {
  const [habits, setHabits] = useState<any[]>([]);
  const [name, setName] = useState<string>('');
  const [autoLinked, setAutoLinked] = useState<string>('none');
  const [targetValue, setTargetValue] = useState<number>(60);
  const [targetDaysList, setTargetDaysList] = useState<number[]>([1, 2, 3, 4, 5]);

  // Generate current week dates Mon -> Sun
  const getWeekDates = () => {
    const dates = [];
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(diff + i);
      
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      
      dates.push({
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dateStr: `${y}-${m}-${r}`,
        dayVal: d.getDay()
      });
    }
    return dates;
  };

  const weekDates = getWeekDates();

  // Streaks Engine in React
  const calculateStreaks = (logs: any[]) => {
    if (!logs || logs.length === 0) {
      return { current: 0, longest: 0 };
    }
    
    const completedDates = Array.from(new Set(logs.map(l => l.date))).sort() as string[];
    
    let longest = 0;
    let current = 0;
    let temp = 0;
    
    const parseDate = (dStr: string) => new Date(dStr + 'T00:00:00');
    
    // Longest streak
    for (let i = 0; i < completedDates.length; i++) {
      if (i === 0) {
        temp = 1;
      } else {
        const prev = parseDate(completedDates[i - 1]);
        const curr = parseDate(completedDates[i]);
        const diffDays = Math.ceil(Math.abs(curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          temp++;
        } else if (diffDays > 1) {
          if (temp > longest) longest = temp;
          temp = 1;
        }
      }
    }
    if (temp > longest) longest = temp;
    
    // Current streak (consecutive days back from today or yesterday)
    const now = new Date();
    const getLocalDateStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${r}`;
    };
    
    const todayStr = getLocalDateStr(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateStr(yesterday);
    
    const completedToday = completedDates.includes(todayStr);
    const completedYesterday = completedDates.includes(yesterdayStr);
    
    if (!completedToday && !completedYesterday) {
      current = 0;
    } else {
      let check = completedToday ? now : yesterday;
      current = 0;
      while (true) {
        const checkStr = getLocalDateStr(check);
        if (completedDates.includes(checkStr)) {
          current++;
          check.setDate(check.getDate() - 1);
        } else {
          break;
        }
      }
    }
    
    return { current, longest };
  };

  const loadData = async () => {
    try {
      const data = await db.getHabits(user.id);
      
      const habitsWithStats = [];
      for (const h of data) {
        const logs = await db.getHabitLogs(h.id);
        const activeLogs = logs.filter((l: any) => l.completed === 1);
        const { current, longest } = calculateStreaks(activeLogs);
        
        h.currentStreak = current;
        h.longestStreak = longest;
        h.logs = logs;
        habitsWithStats.push(h);
      }
      
      setHabits(habitsWithStats);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
    return TimerService.onSessionLogged(() => {
      loadData();
    });
  }, [user]);

  const handleCellToggle = async (habitId: number, date: string, isCompleted: boolean) => {
    try {
      await db.toggleHabitLog(habitId, date, !isCompleted);
      showToast('Habit progress saved!', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to toggle log', 'error');
    }
  };

  const handleDeleteHabit = async (id: number) => {
    if (confirm('Delete this habit and all completed history logs?')) {
      try {
        await db.deleteHabit(id);
        showToast('Habit deleted successfully', 'success');
        loadData();
      } catch (err: any) {
        showToast(err.message || 'Failed to delete habit', 'error');
      }
    }
  };

  const handleDayCheckboxChange = (dayVal: number) => {
    setTargetDaysList(prev => {
      if (prev.includes(dayVal)) {
        return prev.filter(d => d !== dayVal);
      }
      return [...prev, dayVal].sort();
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      showToast('Habit name is required', 'error');
      return;
    }

    if (targetDaysList.length === 0) {
      showToast('Select at least one target day!', 'error');
      return;
    }

    const targetDays = targetDaysList.length === 7 ? 'daily' : targetDaysList.join(',');

    try {
      await db.addHabit(user.id, name, targetDays, autoLinked, autoLinked === 'focus_minutes' ? targetValue : 0);
      showToast('Habit successfully defined!', 'success');
      setName('');
      setAutoLinked('none');
      setTargetValue(60);
      setTargetDaysList([1, 2, 3, 4, 5]);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to create habit', 'error');
    }
  };

  return (
    <div className="dsa-layout">
      {/* Left: Table Grid */}
      <div className="glass-panel" style={{ minHeight: '400px' }}>
        <h2 className="dashboard-title">Weekly Habits Tracker</h2>
        
        <div className="habits-grid-container">
          <table className="habits-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Habit</th>
                <th>Streak (Cur / Max)</th>
                {weekDates.map(d => (
                  <th key={d.dateStr}>
                    {d.label}
                    <br />
                    <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                      {d.dateStr.slice(5)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {habits.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--text-muted)', padding: '48px 0' }}>
                    <i className="fa-solid fa-repeat" style={{ fontSize: '2.5rem', marginBottom: '12px', display: 'block' }}></i>
                    No habits configured. Define a habit on the right to start measuring consistency!
                  </td>
                </tr>
              ) : (
                habits.map(habit => {
                  const targetDays = habit.target_days.split(',');
                  return (
                    <tr key={habit.id}>
                      <td className="habit-name-cell">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>{habit.name}</span>
                          <button className="topic-action-btn delete-habit" onClick={() => handleDeleteHabit(habit.id)}>
                            <i className="fa-solid fa-trash" style={{ fontSize: '0.75rem' }}></i>
                          </button>
                        </div>
                        {habit.auto_linked === 'focus_minutes' && (
                          <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 'normal' }}>
                            <i className="fa-solid fa-link"></i> Auto: {habit.target_value}m study
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="habit-streak-badge">
                          <i className="fa-solid fa-fire"></i> {habit.currentStreak} / {habit.longestStreak}
                        </span>
                      </td>
                      {weekDates.map(day => {
                        const log = habit.logs.find((l: any) => l.date === day.dateStr);
                        const isCompleted = log && log.completed === 1;
                        const isTarget = targetDays.includes(String(day.dayVal)) || habit.target_days === 'daily';
                        const isAuto = habit.auto_linked === 'focus_minutes';

                        return (
                          <td key={day.dateStr}>
                            <button
                              className={`habit-cell-btn ${isCompleted ? 'completed' : ''} ${!isTarget ? 'disabled' : ''}`}
                              onClick={() => handleCellToggle(habit.id, day.dateStr, isCompleted)}
                              title={isAuto ? 'Auto completed by Focus Timer. Manual overrides allowed.' : 'Toggle completion'}
                            >
                              {isCompleted && <i className="fa-solid fa-check"></i>}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: Creator Form */}
      <div className="glass-panel" style={{ maxHeight: '500px' }}>
        <h2 className="dashboard-title">Create Habit</h2>
        <form onSubmit={handleFormSubmit} className="modal-form" style={{ padding: 0 }}>
          <div className="form-group">
            <label htmlFor="h-name">Habit Name</label>
            <input
              type="text"
              id="h-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Study algorithms 30m"
              required
            />
          </div>

          <div className="form-group">
            <label>Target Days</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
              {[
                { val: 1, lbl: 'Mon' },
                { val: 2, lbl: 'Tue' },
                { val: 3, lbl: 'Wed' },
                { val: 4, lbl: 'Thu' },
                { val: 5, lbl: 'Fri' },
                { val: 6, lbl: 'Sat' },
                { val: 0, lbl: 'Sun' }
              ].map(day => (
                <label key={day.val} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={targetDaysList.includes(day.val)}
                    onChange={() => handleDayCheckboxChange(day.val)}
                    style={{ width: 'auto' }}
                  />
                  <span>{day.lbl}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="h-link">Auto-link Integration</label>
            <select id="h-link" value={autoLinked} onChange={(e) => setAutoLinked(e.target.value)}>
              <option value="none">None (Manual Check)</option>
              <option value="focus_minutes">Link to Focus Duration</option>
            </select>
          </div>

          {autoLinked === 'focus_minutes' && (
            <div className="form-group">
              <label htmlFor="h-target-val">Target Study Time (minutes)</label>
              <input
                type="number"
                id="h-target-val"
                value={targetValue}
                onChange={(e) => setTargetValue(parseInt(e.target.value) || 60)}
                min="5"
                step="5"
                required
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}>
            <i className="fa-solid fa-plus"></i> Define Habit
          </button>
        </form>
      </div>
    </div>
  );
}

export default Habits;
