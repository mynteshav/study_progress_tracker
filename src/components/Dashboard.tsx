import React, { useState, useEffect, useRef } from 'react';
import { db } from '../db';
import { User } from '../App';
import Chart from 'chart.js/auto';
import { TimerService } from '../services/TimerService';

interface DashboardProps {
  user: User;
  navigate: (sec: string) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Dashboard({ user, navigate, showToast }: DashboardProps) {
  const [streak, setStreak] = useState<number>(0);
  const [totalTodayMins, setTotalTodayMins] = useState<number>(0);
  const [topics, setTopics] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<Chart | null>(null);

  const getLocalDateStr = (d: Date = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${r}`;
  };

  const loadDashboardData = async () => {
    const todayStr = getLocalDateStr();
    
    try {
      const [allTopics, allSessions, allTimetable] = await Promise.all([
        db.getTopics(user.id, todayStr),
        db.getFocusSessions(user.id),
        db.getTimetableBlocks(user.id)
      ]);

      setTopics(allTopics);
      setSessions(allSessions);

      // 1. Calculate focused minutes today
      const todaySessions = allSessions.filter(s => {
        return s.type === 'work' && s.start_time.startsWith(todayStr);
      });
      const minsToday = todaySessions.reduce((sum, s) => sum + s.duration_minutes, 0);
      setTotalTodayMins(minsToday);

      // 2. Calculate Streaks
      const workSessionDates = Array.from(new Set(allSessions
        .filter(s => s.type === 'work')
        .map(s => s.start_time.split('T')[0])
      )).sort();

      let currentStreak = 0;
      if (workSessionDates.length > 0) {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const hasToday = workSessionDates.includes(getLocalDateStr(now));
        const hasYesterday = workSessionDates.includes(getLocalDateStr(yesterday));
        
        if (hasToday || hasYesterday) {
          let check = hasToday ? now : yesterday;
          while (true) {
            const checkStr = getLocalDateStr(check);
            if (workSessionDates.includes(checkStr)) {
              currentStreak++;
              check.setDate(check.getDate() - 1);
            } else {
              break;
            }
          }
        }
      }
      setStreak(currentStreak);

      // 3. Upcoming schedule (next 4 hours)
      const currentDay = new Date().getDay();
      const nowTimeStr = new Date().toTimeString().slice(0, 5);
      const limitDate = new Date();
      limitDate.setHours(limitDate.getHours() + 4);
      const limitTimeStr = limitDate.toTimeString().slice(0, 5);

      const upcomingBlocks = allTimetable.filter((block: any) => {
        const matchesDay = block.day_of_week === currentDay;
        const matchesDate = !block.recurring && block.specific_date === todayStr;
        const isToday = matchesDay || matchesDate;
        
        return isToday && block.start_time >= nowTimeStr && block.start_time <= limitTimeStr;
      }).sort((a: any, b: any) => a.start_time.localeCompare(b.start_time));
      
      setUpcoming(upcomingBlocks);

    } catch (err) {
      console.error('Failed to load dashboard statistics:', err);
    }
  };

  useEffect(() => {
    loadDashboardData();
    return TimerService.onSessionLogged(() => {
      loadDashboardData();
    });
  }, [user]);

  // Render Mini Chart
  useEffect(() => {
    if (!chartRef.current || sessions.length === 0) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const labels: string[] = [];
    const data: number[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getLocalDateStr(d);
      
      labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
      
      const daySessions = sessions.filter(s => s.type === 'work' && s.start_time.startsWith(dateStr));
      const dayMins = daySessions.reduce((sum, s) => sum + s.duration_minutes, 0);
      data.push(dayMins);
    }

    const ctx = chartRef.current.getContext('2d');
    if (ctx) {
      chartInstance.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Minutes Focused',
            data: data,
            backgroundColor: 'rgba(99, 102, 241, 0.45)',
            borderColor: 'rgba(168, 85, 247, 0.95)',
            borderWidth: 1.5,
            borderRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.03)' },
              ticks: { color: '#94a3b8', font: { family: 'Outfit' } },
              beginAtZero: true
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
            }
          }
        }
      });
    }

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [sessions]);

  const handleTopicToggle = async (topicId: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'done' ? 'not started' : 'done';
    try {
      await db.updateTopic(topicId, { status: nextStatus });
      showToast(`Topic marked as ${nextStatus}`, 'success');
      loadDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update topic status', 'error');
    }
  };

  const dailyGoal = user.daily_goal_minutes || 60;
  const progressPct = Math.min(Math.round((totalTodayMins / dailyGoal) * 100), 100);
  const completedTopics = topics.filter(t => t.status === 'done').length;

  const formatTimeDisplay = (totalMins: number) => {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="dashboard-grid">
      {/* Left Column: Stats & Progress */}
      <div className="dashboard-left">
        <div className="stat-row">
          <div className="glass-panel stat-card">
            <div className="stat-icon blue"><i className="fa-solid fa-fire"></i></div>
            <div className="stat-info">
              <span className="stat-num">{streak} Days</span>
              <span className="stat-label">Current Streak</span>
            </div>
          </div>

          <div className="glass-panel stat-card">
            <div className="stat-icon purple"><i className="fa-solid fa-clock"></i></div>
            <div className="stat-info">
              <span className="stat-num">{formatTimeDisplay(totalTodayMins)}</span>
              <span className="stat-label">Studied Today</span>
            </div>
          </div>

          <div className="glass-panel stat-card">
            <div className="stat-icon emerald"><i className="fa-solid fa-circle-check"></i></div>
            <div className="stat-info">
              <span className="stat-num">{completedTopics}/{topics.length}</span>
              <span className="stat-label">Topics Complete</span>
            </div>
          </div>
        </div>

        {/* Progress Circular Panel */}
        <div className="glass-panel progress-container">
          <div style={{ flex: 1 }}>
            <h2 className="dashboard-title" style={{ marginBottom: '8px' }}>Focus Target</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '20px' }}>
              You completed <strong>{totalTodayMins} minutes</strong> out of your daily goal of <strong>{dailyGoal} minutes</strong>. Keep pushing!
            </p>
            <div className="quick-actions">
              <button className="btn btn-primary quick-btn" onClick={() => navigate('timer')}>
                <i className="fa-solid fa-play"></i> Start Timer
              </button>
              <button className="btn btn-secondary quick-btn" onClick={() => navigate('topics')}>
                <i className="fa-solid fa-plus"></i> Add Topic
              </button>
              <button className="btn btn-secondary quick-btn" onClick={() => navigate('notes')}>
                <i className="fa-solid fa-book-open"></i> Flashcards
              </button>
            </div>
          </div>

          <div className="progress-ring-wrapper">
            <svg width="120" height="120">
              <circle stroke="rgba(255,255,255,0.03)" strokeWidth="10" fill="transparent" r="50" cx="60" cy="60" />
              <circle
                className="progress-ring-circle"
                stroke="url(#indigo-grad)"
                strokeWidth="10"
                strokeDasharray="314.16"
                strokeDashoffset={314.16 - (314.16 * progressPct) / 100}
                strokeLinecap="round"
                fill="transparent"
                r="50"
                cx="60"
                cy="60"
              />
              <defs>
                <linearGradient id="indigo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
            <div className="progress-ring-text">
              {progressPct}%
              <span className="progress-ring-label">done</span>
            </div>
          </div>
        </div>

        {/* Mini activity Chart */}
        <div className="glass-panel">
          <h2 className="dashboard-title">Activity Trend (Last 7 Days)</h2>
          <div className="chart-container">
            <canvas ref={chartRef}></canvas>
          </div>
        </div>
      </div>

      {/* Right Column: Schedule & Checklist */}
      <div className="dashboard-right">
        {/* Timetable Blocks */}
        <div className="glass-panel" style={{ marginBottom: '24px', minHeight: '220px' }}>
          <h2 className="dashboard-title">Upcoming Schedule</h2>
          <div className="upcoming-list">
            {upcoming.length > 0 ? (
              upcoming.map((item) => (
                <div key={item.id} className="upcoming-item" style={{ borderLeftColor: item.color || '#6366f1' }}>
                  <div>
                    <div className="upcoming-subject">{item.subject}</div>
                    <div className="upcoming-time">{item.start_time} - {item.end_time}</div>
                  </div>
                  <span className="badge badge-subject" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}>
                    {item.recurring ? 'Weekly' : 'One-off'}
                  </span>
                </div>
              ))
            ) : (
              <div className="upcoming-empty">No blocks scheduled for the next 4 hours.</div>
            )}
          </div>
        </div>

        {/* Topics Checklist */}
        <div className="glass-panel" style={{ minHeight: '250px' }}>
          <h2 className="dashboard-title">
            <span>Today's Topics</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)' }}>Check to toggle</span>
          </h2>
          <div className="upcoming-list">
            {topics.length > 0 ? (
              topics.map((topic) => (
                <div
                  key={topic.id}
                  className={`upcoming-item ${topic.status === 'done' ? 'completed' : ''}`}
                  onClick={() => handleTopicToggle(topic.id, topic.status)}
                  style={{ cursor: 'pointer', padding: '10px 14px', background: 'rgba(255,255,255,0.01)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className={`topic-checkbox ${topic.status === 'done' ? 'checked' : ''}`}>
                      <i className="fa-solid fa-check"></i>
                    </div>
                    <span
                      className="upcoming-subject"
                      style={{
                        textDecoration: topic.status === 'done' ? 'line-through' : 'none',
                        color: topic.status === 'done' ? 'var(--text-muted)' : 'var(--text-primary)'
                      }}
                    >
                      {topic.title}
                    </span>
                  </div>
                  <span className={`badge ${topic.priority === 'high' ? 'badge-high' : topic.priority === 'low' ? 'badge-low' : 'badge-med'}`}>
                    {topic.priority}
                  </span>
                </div>
              ))
            ) : (
              <div className="upcoming-empty">No topics planned for today.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
