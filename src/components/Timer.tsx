import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../App';
import { TimerService } from '../services/TimerService';
import { useTimerState } from '../hooks/useTimer';

interface TimerProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  playBell?: (type: 'work' | 'break') => void; // Maintained for props-level compatibility
}

function Timer({ user, showToast }: TimerProps) {
  const timerState = useTimerState();

  // Local setting inputs state (synced with global settings)
  const [workInput, setWorkInput] = useState<number>(timerState.workMinutes);
  const [breakInput, setBreakInput] = useState<number>(timerState.breakMinutes);
  const [cyclesInput, setCyclesInput] = useState<number>(timerState.cyclesLimit);

  const [topics, setTopics] = useState<any[]>([]);
  const [currentTopicId, setCurrentTopicId] = useState<string>('');
  const [subjectText, setSubjectText] = useState<string>('General Study');
  const [todayLogs, setTodayLogs] = useState<any[]>([]);
  
  // Saved Time state
  const [userStats, setUserStats] = useState<{ total_saved_time: number; available_saved_time: number }>({ total_saved_time: 0, available_saved_time: 0 });
  const [showUseModal, setShowUseModal] = useState<boolean>(false);
  const [useMinutesInput, setUseMinutesInput] = useState<number>(15);
  const [isCelebrating, setIsCelebrating] = useState<boolean>(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const enterFullscreen = async () => {
    setIsFullscreen(true);
    if (document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.log('Browser Fullscreen API unavailable, using fallback overlay:', err);
      }
    }
  };

  const exitFullscreen = async () => {
    setIsFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (err) {
        console.log('Error exiting browser fullscreen:', err);
      }
    }
  };

  // Keyboard (Escape key) & Fullscreen API change listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        exitFullscreen();
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen]);

  useEffect(() => {
    setWorkInput(timerState.workMinutes);
    setBreakInput(timerState.breakMinutes);
    setCyclesInput(timerState.cyclesLimit);
  }, [timerState.workMinutes, timerState.breakMinutes, timerState.cyclesLimit]);

  useEffect(() => {
    setCurrentTopicId(timerState.currentTopicId ? String(timerState.currentTopicId) : '');
    setSubjectText(timerState.subjectText);
  }, [timerState.currentTopicId, timerState.subjectText]);

  const getLocalDateStr = (d: Date = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${r}`;
  };

  const loadData = async () => {
    const todayStr = getLocalDateStr();
    try {
      const [todayTopics, focusSessions, stats] = await Promise.all([
        db.getTopics(user.id, todayStr),
        db.getFocusSessions(user.id),
        db.getUserStats(user.id)
      ]);
      setTopics(todayTopics);
      setUserStats(stats || { total_saved_time: 0, available_saved_time: 0 });
      setTodayLogs(focusSessions);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
    // Subscribe to session logged events to reload today's log list
    return TimerService.onSessionLogged(() => {
      loadData();
    });
  }, [user]);

  const toggleTimer = () => {
    if (timerState.isRunning) {
      TimerService.pause();
    } else {
      TimerService.start();
    }
  };

  const resetTimer = () => {
    TimerService.reset();
  };

  const skipSession = () => {
    TimerService.skip();
  };

  const handleApplySettings = () => {
    TimerService.applySettings(workInput, breakInput, timerState.longBreakMinutes, cyclesInput);
  };

  const isSessionActiveOrCompleted = timerState.isWorkMode && (timerState.sessionStartTime !== null || timerState.timeLeft === 0);

  const handleSaveTimerClick = async () => {
    if (timerState.sessionSaved) {
      showToast('This timer session has already been saved.', 'warning');
      return;
    }
    if (!isSessionActiveOrCompleted) {
      showToast('Start a timer session first before saving.', 'warning');
      return;
    }

    setIsCelebrating(true);
    setTimeout(() => setIsCelebrating(false), 2500);

    const res = await TimerService.saveTimerSession();
    if (res.success) {
      loadData();
    } else if (res.message) {
      showToast(res.message, 'warning');
    }
  };

  const handleApplySavedTime = async (e: React.FormEvent) => {
    e.preventDefault();
    if (useMinutesInput <= 0) {
      showToast('Please enter a positive number of minutes', 'warning');
      return;
    }
    if (useMinutesInput > userStats.available_saved_time) {
      showToast(`Cannot use more than available balance (${userStats.available_saved_time} mins)`, 'error');
      return;
    }

    try {
      await TimerService.useSavedTime(useMinutesInput);
      setShowUseModal(false);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to use saved time', 'error');
    }
  };

  const handleTopicSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCurrentTopicId(val);
    if (val === '') {
      setSubjectText('General Study');
      TimerService.setSubject('General Study', null);
    } else {
      const topicObj = topics.find(t => t.id == val);
      if (topicObj) {
        setSubjectText(topicObj.subject);
        TimerService.setSubject(topicObj.subject, Number(val));
      }
    }
  };

  const handleSubjectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSubjectText(val);
    TimerService.setSubject(val, timerState.currentTopicId);
  };

  // Ring calculations (circumference = 691.15)
  const currentTotalSecs = timerState.isWorkMode 
    ? timerState.workMinutes * 60 
    : (timerState.completedCycles > 0 && timerState.completedCycles % timerState.cyclesLimit === 0 ? timerState.longBreakMinutes : timerState.breakMinutes) * 60;
  
  const ringOffset = currentTotalSecs > 0 
    ? (691.15 * (currentTotalSecs - timerState.timeLeft)) / currentTotalSecs 
    : 0;

  const formatDigits = () => {
    const mins = Math.floor(timerState.timeLeft / 60);
    const secs = timerState.timeLeft % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const formatTimeDisplay = (totalMins: number) => {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  const todayStr = getLocalDateStr();
  const todayWorkLogs = todayLogs.filter(s => s.type === 'work' && s.start_time.startsWith(todayStr));
  const todayFocusedMinutes = todayWorkLogs.reduce((sum, s) => sum + s.duration_minutes, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Celebration overlay */}
      {isCelebrating && (
        <div className="celebration-overlay">
          <div className="celebration-card animate-pop">
            <div className="celebration-icon">🎉</div>
            <div className="celebration-title">Task Saved!</div>
            <div className="celebration-sub">Added to today's study time!</div>
          </div>
        </div>
      )}

      {/* DEDICATED FULLSCREEN TIMER OVERLAY */}
      {isFullscreen && (
        <div className="timer-fullscreen-overlay">
          <button
            className="fullscreen-exit-top"
            onClick={exitFullscreen}
            aria-label="Exit fullscreen timer"
            title="Exit Fullscreen (Esc)"
          >
            <i className="fa-solid fa-xmark"></i> Exit Fullscreen
          </button>

          <div className="fullscreen-timer-content">
            <div className="fullscreen-subject-badge">
              <i className="fa-solid fa-book-open"></i> {subjectText || 'General Study'}
            </div>

            <div className="fullscreen-timer-circle">
              <svg viewBox="0 0 250 250">
                <circle stroke="rgba(255,255,255,0.03)" strokeWidth="12" fill="transparent" r="110" cx="125" cy="125" />
                <circle
                  className="timer-ring-circle"
                  stroke={timerState.isWorkMode ? '#8b5cf6' : '#10b981'}
                  strokeWidth="12"
                  strokeDasharray="691.15"
                  strokeDashoffset={ringOffset}
                  strokeLinecap="round"
                  fill="transparent"
                  r="110"
                  cx="125"
                  cy="125"
                />
              </svg>
              <div className="timer-display">
                <div className="fullscreen-timer-digits">{formatDigits()}</div>
                <div className="fullscreen-timer-mode">{timerState.isWorkMode ? 'Work Session' : 'Break Time'}</div>
              </div>
            </div>

            <div className="timer-controls" style={{ flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
              <button className="btn btn-secondary btn-circle" onClick={resetTimer} title="Reset Timer" aria-label="Reset timer">
                <i className="fa-solid fa-rotate-right"></i>
              </button>
              <button
                className="btn btn-primary btn-circle"
                onClick={toggleTimer}
                style={{ width: '76px', height: '76px', fontSize: '1.8rem' }}
                title={timerState.isRunning ? 'Pause' : 'Start'}
                aria-label={timerState.isRunning ? 'Pause timer' : 'Start timer'}
              >
                <i className={`fa-solid ${timerState.isRunning ? 'fa-pause' : 'fa-play'}`}></i>
              </button>
              <button className="btn btn-secondary btn-circle" onClick={skipSession} title="Next Session" aria-label="Next session">
                <i className="fa-solid fa-forward"></i>
              </button>
              <button
                className={`btn ${timerState.sessionSaved ? 'btn-secondary' : 'btn-success'}`}
                onClick={handleSaveTimerClick}
                disabled={!isSessionActiveOrCompleted && !timerState.sessionSaved}
                aria-label="Save timer session"
                style={{
                  height: '50px',
                  padding: '0 20px',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  borderRadius: '25px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <i className="fa-solid fa-bookmark"></i>
                <span>{timerState.sessionSaved ? 'Saved' : 'Save Session'}</span>
              </button>
            </div>

            <div className="fullscreen-progress-info">
              <i className="fa-solid fa-chart-pie" style={{ color: '#818cf8' }}></i>
              <span>Today's Progress: <strong>{formatTimeDisplay(todayFocusedMinutes)}</strong></span>
            </div>

            <button
              className="btn btn-secondary"
              onClick={exitFullscreen}
              aria-label="Exit fullscreen timer"
              style={{ marginTop: '12px', minWidth: '160px' }}
            >
              <i className="fa-solid fa-compress"></i> Exit Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* Top row: Timer & Settings */}
      <div className="grid-2">
        {/* Left: Interactive circular countdown */}
        <div className="glass-panel timer-container" style={{ position: 'relative' }}>
          {/* Header row with Fullscreen button */}
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Focus Timer</span>
            <button
              className="btn btn-secondary"
              onClick={enterFullscreen}
              aria-label="Enter fullscreen timer"
              title="Enter Fullscreen"
              style={{ padding: '6px 14px', fontSize: '0.85rem', minHeight: '38px' }}
            >
              <i className="fa-solid fa-expand"></i> Fullscreen
            </button>
          </div>

          <div className="timer-circle-wrapper">
            <svg width="250" height="250">
              <circle stroke="rgba(255,255,255,0.03)" strokeWidth="12" fill="transparent" r="110" cx="125" cy="125" />
              <circle
                className="timer-ring-circle"
                stroke={timerState.isWorkMode ? '#8b5cf6' : '#10b981'}
                strokeWidth="12"
                strokeDasharray="691.15"
                strokeDashoffset={ringOffset}
                strokeLinecap="round"
                fill="transparent"
                r="110"
                cx="125"
                cy="125"
              />
            </svg>
            <div className="timer-display">
              <div className="timer-time">{formatDigits()}</div>
              <div className="timer-mode">{timerState.isWorkMode ? 'Work Session' : 'Break Time'}</div>
            </div>
          </div>

          <div className="timer-controls" style={{ flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-secondary btn-circle" onClick={resetTimer} title="Reset Timer">
              <i className="fa-solid fa-rotate-right"></i>
            </button>
            <button
              className="btn btn-primary btn-circle"
              onClick={toggleTimer}
              style={{ width: '70px', height: '70px', fontSize: '1.6rem' }}
              title={timerState.isRunning ? 'Pause' : 'Start'}
            >
              <i className={`fa-solid ${timerState.isRunning ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <button className="btn btn-secondary btn-circle" onClick={skipSession} title="Next Session">
              <i className="fa-solid fa-forward"></i>
            </button>
            <button
              className={`btn ${timerState.sessionSaved ? 'btn-secondary' : 'btn-success'}`}
              onClick={handleSaveTimerClick}
              disabled={!isSessionActiveOrCompleted && !timerState.sessionSaved}
              style={{
                height: '48px',
                padding: '0 18px',
                fontSize: '0.95rem',
                fontWeight: 600,
                borderRadius: '24px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                opacity: (isSessionActiveOrCompleted || timerState.sessionSaved) ? 1 : 0.5,
                cursor: (isSessionActiveOrCompleted || timerState.sessionSaved) ? 'pointer' : 'not-allowed',
                boxShadow: (!timerState.sessionSaved && isSessionActiveOrCompleted) ? '0 4px 14px rgba(16, 185, 129, 0.4)' : 'none'
              }}
              title={timerState.sessionSaved ? 'Session already saved' : 'Save Timer'}
            >
              <i className={`fa-solid ${timerState.sessionSaved ? 'fa-circle-check' : 'fa-floppy-disk'}`}></i>
              Save Timer
            </button>
          </div>

          <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--text-secondary)', marginTop: '16px' }}>
            Today's Progress: <strong>{todayWorkLogs.length} sessions</strong> completed (<strong>{formatTimeDisplay(todayFocusedMinutes)}</strong>)
          </div>
        </div>

        {/* Right: Saved Time Card & Settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Saved Time Balance Card - Requirement 3 & 5 */}
          <div className="glass-panel saved-time-card">
            <div className="saved-time-header">
              <div className="saved-time-title">
                <i className="fa-solid fa-hourglass-half text-emerald"></i> Saved Time Bank
              </div>
              <button 
                className="btn btn-secondary btn-sm"
                onClick={() => setShowUseModal(true)}
                disabled={userStats.available_saved_time <= 0}
              >
                <i className="fa-solid fa-bolt text-amber"></i> Use Saved Time
              </button>
            </div>
            
            <div className="saved-time-display">
              <div className="saved-time-value">⏳ {formatTimeDisplay(userStats.available_saved_time)}</div>
              <div className="saved-time-sub">
                Total Earned: <strong>{formatTimeDisplay(userStats.total_saved_time)}</strong>
              </div>
            </div>
          </div>

          <div className="glass-panel timer-settings-card">
            <h2 className="dashboard-title">Session Settings</h2>
            
            <div className="form-group">
              <label htmlFor="timerTopicSelect">Associate with Topic</label>
              <select id="timerTopicSelect" value={currentTopicId} onChange={handleTopicSelectChange}>
                <option value="" data-subject="General Study">-- Free Study (No Linked Topic) --</option>
                {topics.map(t => (
                  <option key={t.id} value={t.id} data-subject={t.subject}>
                    [{t.subject}] {t.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="timerSubjectText">Subject Tag</label>
              <input
                type="text"
                id="timerSubjectText"
                value={subjectText}
                onChange={handleSubjectChange}
                placeholder="e.g. Mathematics"
              />
            </div>

            <div className="grid-3" style={{ gap: '12px', marginTop: '10px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>Work (min)</label>
                <input
                  type="number"
                  value={workInput}
                  onChange={(e) => setWorkInput(parseInt(e.target.value) || 25)}
                  min="1"
                  max="180"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>Break (min)</label>
                <input
                  type="number"
                  value={breakInput}
                  onChange={(e) => setBreakInput(parseInt(e.target.value) || 5)}
                  min="1"
                  max="60"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>Cycles</label>
                <input
                  type="number"
                  value={cyclesInput}
                  onChange={(e) => setCyclesInput(parseInt(e.target.value) || 4)}
                  min="1"
                  max="12"
                />
              </div>
            </div>

            <button className="btn btn-secondary" onClick={handleApplySettings} style={{ width: '100%', marginTop: '16px' }}>
              <i className="fa-solid fa-sliders"></i> Apply Durations
            </button>
          </div>
        </div>
      </div>

      {/* Bottom: Extended Focus Session History Table - Requirement 4 */}
      <div className="glass-panel" style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 className="dashboard-title" style={{ marginBottom: 0 }}>Focus Session History</h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Showing last sessions</span>
        </div>

        <div className="table-responsive" style={{ maxHeight: '280px', overflowY: 'auto' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Task / Subject</th>
                <th>Scheduled</th>
                <th>Actual</th>
                <th>Time Saved</th>
              </tr>
            </thead>
            <tbody>
              {todayLogs.length > 0 ? (
                todayLogs.map(s => {
                  const dateStr = new Date(s.start_time).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
                  const scheduledMins = s.scheduled_duration > 0 ? s.scheduled_duration : s.duration_minutes;
                  const actualMins = s.actual_duration > 0 ? s.actual_duration : s.duration_minutes;
                  const savedMins = s.saved_time || 0;

                  return (
                    <tr key={s.id}>
                      <td>{dateStr}</td>
                      <td>
                        <strong>{s.subject}</strong>{' '}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({s.type})</span>
                      </td>
                      <td>{scheduledMins} min</td>
                      <td>{actualMins} min</td>
                      <td>
                        {savedMins > 0 ? (
                          <span className="badge badge-emerald">+{savedMins} min</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No focus sessions logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* "Use Saved Time" Modal - Requirement 5 */}
      {showUseModal && (
        <div className="modal-backdrop">
          <div className="modal-card animate-pop">
            <h3 style={{ marginBottom: '12px' }}>⚡ Use Saved Time</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Add minutes from your <strong>Saved Time Bank</strong> ({formatTimeDisplay(userStats.available_saved_time)} available) directly to your current timer.
            </p>

            <form onSubmit={handleApplySavedTime}>
              <div className="form-group">
                <label>Minutes to Add</label>
                <input
                  type="number"
                  value={useMinutesInput}
                  onChange={(e) => setUseMinutesInput(parseInt(e.target.value) || 0)}
                  min="1"
                  max={userStats.available_saved_time}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {[5, 10, 15, 20, 30].map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`btn btn-sm ${useMinutesInput === m ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setUseMinutesInput(m)}
                    disabled={m > userStats.available_saved_time}
                  >
                    +{m} min
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowUseModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <i className="fa-solid fa-check"></i> Apply to Timer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Timer;
