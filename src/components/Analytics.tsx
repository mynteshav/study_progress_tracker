import React, { useState, useEffect, useRef } from 'react';
import { db } from '../db';
import { User } from '../App';
import Chart from 'chart.js/auto';
import { TimerService } from '../services/TimerService';

interface AnalyticsProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Analytics({ user, showToast }: AnalyticsProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [favoriteSubject, setFavoriteSubject] = useState<string>('N/A');
  const [favSubMins, setFavSubMins] = useState<number>(0);
  const [thisWeekMins, setThisWeekMins] = useState<number>(0);
  const [weeklyChangePct, setWeeklyChangePct] = useState<number>(0);
  
  // Dynamic study text insights
  const [insights, setInsights] = useState<string[]>([]);

  // Chart refs
  const subjectChartRef = useRef<HTMLCanvasElement | null>(null);
  const subjectChartInst = useRef<Chart | null>(null);

  const trendChartRef = useRef<HTMLCanvasElement | null>(null);
  const trendChartInst = useRef<Chart | null>(null);

  // Saved Time Analytics state
  const [savedStats, setSavedStats] = useState<{
    totalSavedTime: number;
    availableSavedTime: number;
    avgSavedPerSession: number;
    longestSavedSession: number;
    sessionsCountWithSavedTime: number;
    weeklySavedTime: number;
    monthlySavedTime: number;
  }>({
    totalSavedTime: 0,
    availableSavedTime: 0,
    avgSavedPerSession: 0,
    longestSavedSession: 0,
    sessionsCountWithSavedTime: 0,
    weeklySavedTime: 0,
    monthlySavedTime: 0
  });

  const getLocalDateStr = (d: Date = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${r}`;
  };

  const formatTimeDisplay = (totalMins: number) => {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      // 1. Get favorite subject
      const fav = await db.getFavoriteSubject(user.id) as any;
      if (fav && fav.subject) {
        setFavoriteSubject(fav.subject);
        setFavSubMins(fav.mins);
      } else {
        setFavoriteSubject('N/A');
        setFavSubMins(0);
      }

      // 2. Weekly comparison
      const comparisons = await db.getWeeklyComparisonMins(user.id) as any;
      setThisWeekMins(comparisons.thisWeek);
      
      let change = 0;
      if (comparisons.lastWeek > 0) {
        change = Math.round(((comparisons.thisWeek - comparisons.lastWeek) / comparisons.lastWeek) * 100);
      } else if (comparisons.thisWeek > 0) {
        change = 100; // 100% gain if last week was zero
      }
      setWeeklyChangePct(change);

      // 3. Saved Time analytics
      const savedData = await db.getSavedTimeAnalytics(user.id);
      setSavedStats(savedData);

      // 4. Compile natural language study insights
      const compiledInsights = [];
      if (comparisons.thisWeek > comparisons.lastWeek) {
        compiledInsights.push(`📈 Your focus time increased by ${change}% compared to last week. Excellent progress!`);
      } else if (comparisons.thisWeek < comparisons.lastWeek && comparisons.lastWeek > 0) {
        compiledInsights.push(`⚠️ Focus time is down by ${Math.abs(change)}% compared to last week. Try scheduling shorter, more consistent study blocks.`);
      }

      if (fav && fav.mins > 120) {
        compiledInsights.push(`🔥 "${fav.subject}" is your most studied subject this week (${Math.round(fav.mins / 60)} hours). Make sure to balance other subjects!`);
      }

      if (savedData.totalSavedTime > 0) {
        compiledInsights.push(`⏳ Great efficiency! You've saved a total of ${formatTimeDisplay(savedData.totalSavedTime)} by finishing focus tasks early.`);
      }

      if (compiledInsights.length === 0) {
        compiledInsights.push("✨ Log some study sessions, habits, or DSA solutions to generate dynamic insights!");
      }
      
      setInsights(compiledInsights);

      // 5. Render Charts
      setTimeout(async () => {
        await renderSubjectChart();
        await renderTrendChart();
      }, 50);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
    const unsub = TimerService.onSessionLogged(() => {
      loadAnalytics();
    });
    return () => {
      unsub();
      if (subjectChartInst.current) {
        subjectChartInst.current.destroy();
        subjectChartInst.current = null;
      }
      if (trendChartInst.current) {
        trendChartInst.current.destroy();
        trendChartInst.current = null;
      }
    };
  }, [user]);

  const renderSubjectChart = async () => {
    if (!subjectChartRef.current) return;
    if (subjectChartInst.current) {
      subjectChartInst.current.destroy();
    }

    try {
      const data = await db.getFocusSessions(user.id) as any[];
      const workSessions = data.filter(s => s.type === 'work');
      
      const subjectMins: { [key: string]: number } = {};
      workSessions.forEach(s => {
        const sub = s.subject || 'General';
        subjectMins[sub] = (subjectMins[sub] || 0) + s.duration_minutes;
      });

      const labels = Object.keys(subjectMins);
      const values = Object.values(subjectMins);

      if (labels.length === 0) return;

      const ctx = subjectChartRef.current.getContext('2d');
      if (ctx) {
        subjectChartInst.current = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: labels,
            datasets: [{
              data: values,
              backgroundColor: [
                '#6366f1',
                '#06b6d4',
                '#10b981',
                '#f97316',
                '#a855f7',
                '#ef4444'
              ],
              borderWidth: 1.5,
              borderColor: '#0e1227'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'right',
                labels: { color: '#94a3b8', font: { family: 'Outfit' } }
              }
            }
          }
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const renderTrendChart = async () => {
    if (!trendChartRef.current) return;
    if (trendChartInst.current) {
      trendChartInst.current.destroy();
    }

    try {
      const data = await db.getFocusSessions(user.id) as any[];
      
      const labels = [];
      const values = [];

      for (let i = 14; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateStr(d);
        
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        
        const daySessions = data.filter(s => s.type === 'work' && s.start_time.startsWith(dateStr));
        const dayMins = daySessions.reduce((sum, s) => sum + s.duration_minutes, 0);
        values.push(dayMins);
      }

      const ctx = trendChartRef.current.getContext('2d');
      if (ctx) {
        trendChartInst.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Study Time (minutes)',
              data: values,
              borderColor: '#6366f1',
              backgroundColor: 'rgba(99, 102, 241, 0.05)',
              tension: 0.35,
              fill: true,
              borderWidth: 2.5
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: {
                grid: { color: 'rgba(255, 255, 255, 0.03)' },
                ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
              },
              x: {
                grid: { display: false },
                ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
              }
            }
          }
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const badges = [
    { title: 'Saved 1 Hour', target: 60, icon: '⏱️', desc: 'Save 1 cumulative hour of focus time' },
    { title: 'Saved 5 Hours', target: 300, icon: '🚀', desc: 'Save 5 cumulative hours of focus time' },
    { title: 'Saved 10 Hours', target: 600, icon: '💎', desc: 'Save 10 cumulative hours of focus time' },
    { title: 'Saved 25 Hours', target: 1500, icon: '🏆', desc: 'Save 25 cumulative hours of focus time' }
  ];

  return (
    <div>
      {loading ? (
        <div className="loader-container"><div className="spinner"></div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Insights Panel */}
          <div className="insight-panel">
            <h3 className="insight-title">
              <i className="fa-solid fa-wand-magic-sparkles"></i> Personal Study Insights
            </h3>
            <div className="insight-list">
              {insights.map((ins, i) => (
                <div key={i} className="insight-item">
                  <i className="fa-solid fa-circle-dot"></i>
                  <span>{ins}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Core Stat Cards */}
          <div className="grid-3">
            <div className="glass-panel stat-card">
              <div className="stat-icon blue" style={{ backgroundColor: 'var(--color-done)' }}><i className="fa-solid fa-calendar-week"></i></div>
              <div className="stat-info">
                <span className="stat-num">{thisWeekMins} mins</span>
                <span className="stat-label">This Week's Focus</span>
              </div>
            </div>

            <div className="glass-panel stat-card">
              <div className="stat-icon purple"><i className="fa-solid fa-chart-line"></i></div>
              <div className="stat-info">
                <span className="stat-num" style={{ color: weeklyChangePct >= 0 ? '#34d399' : '#f87171' }}>
                  {weeklyChangePct >= 0 ? `+${weeklyChangePct}%` : `${weeklyChangePct}%`}
                </span>
                <span className="stat-label">Weekly Progress change</span>
              </div>
            </div>

            <div className="glass-panel stat-card">
              <div className="stat-icon emerald" style={{ backgroundColor: 'var(--color-med)' }}><i className="fa-solid fa-heart"></i></div>
              <div className="stat-info">
                <span className="stat-num" style={{ fontSize: '1.2rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '160px' }}>
                  {favoriteSubject}
                </span>
                <span className="stat-label">Top Subject ({favSubMins}m)</span>
              </div>
            </div>
          </div>

          {/* Saved Time Analytics Section - Requirement 6 */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 className="dashboard-title" style={{ marginBottom: '16px' }}>
              <i className="fa-solid fa-piggy-bank text-emerald"></i> Saved Time Statistics
            </h3>
            
            <div className="grid-3" style={{ gap: '16px', marginBottom: '12px' }}>
              <div className="mini-stat-card">
                <span className="mini-stat-label">Total Time Saved</span>
                <span className="mini-stat-value text-emerald">{formatTimeDisplay(savedStats.totalSavedTime)}</span>
              </div>
              <div className="mini-stat-card">
                <span className="mini-stat-label">Avg Saved per Session</span>
                <span className="mini-stat-value">{savedStats.avgSavedPerSession} min</span>
              </div>
              <div className="mini-stat-card">
                <span className="mini-stat-label">Longest Saved Session</span>
                <span className="mini-stat-value">{savedStats.longestSavedSession} min</span>
              </div>
              <div className="mini-stat-card">
                <span className="mini-stat-label">Sessions with Saved Time</span>
                <span className="mini-stat-value">{savedStats.sessionsCountWithSavedTime}</span>
              </div>
              <div className="mini-stat-card">
                <span className="mini-stat-label">Time Saved This Week</span>
                <span className="mini-stat-value">{formatTimeDisplay(savedStats.weeklySavedTime)}</span>
              </div>
              <div className="mini-stat-card">
                <span className="mini-stat-label">Time Saved This Month</span>
                <span className="mini-stat-value">{formatTimeDisplay(savedStats.monthlySavedTime)}</span>
              </div>
            </div>
          </div>

          {/* Achievements Section - Requirement 7 */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 className="dashboard-title" style={{ marginBottom: '16px' }}>
              <i className="fa-solid fa-award text-amber"></i> Saved Time Achievements
            </h3>

            <div className="grid-4" style={{ gap: '16px' }}>
              {badges.map((b, i) => {
                const unlocked = savedStats.totalSavedTime >= b.target;
                const progressPct = Math.min(100, Math.round((savedStats.totalSavedTime / b.target) * 100));

                return (
                  <div key={i} className={`achievement-card ${unlocked ? 'unlocked' : 'locked'}`}>
                    <div className="badge-icon">{b.icon}</div>
                    <div className="badge-title">{b.title}</div>
                    <div className="badge-desc">{b.desc}</div>
                    
                    {unlocked ? (
                      <span className="badge-status unlocked-tag">Unlocked!</span>
                    ) : (
                      <div className="badge-progress-wrapper">
                        <div className="badge-progress-bar" style={{ width: `${progressPct}%` }}></div>
                        <span className="badge-progress-text">{savedStats.totalSavedTime} / {b.target} min</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Charts Grid */}
          <div className="analytics-grid">
            <div className="glass-panel">
              <h3 className="dashboard-title">Category Study Time Allocation</h3>
              <div style={{ height: '300px', position: 'relative' }}>
                <canvas ref={subjectChartRef}></canvas>
              </div>
            </div>

            <div className="glass-panel">
              <h3 className="dashboard-title">14-Day Focus Trend (Daily Minutes)</h3>
              <div style={{ height: '300px', position: 'relative' }}>
                <canvas ref={trendChartRef}></canvas>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Analytics;
