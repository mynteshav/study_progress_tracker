import { db, toLocalISOString } from '../db';

export interface TimerState {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesLimit: number;
  completedCycles: number;
  isWorkMode: boolean;
  timeLeft: number;
  isRunning: boolean;
  sessionStartTime: string | null;
  endTime: string | null;
  subjectText: string;
  currentTopicId: number | null;
  scheduledDuration: number;
  sessionSaved: boolean;
  appliedSavedTime: number;
}

const DEFAULT_STATE: TimerState = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cyclesLimit: 4,
  completedCycles: 0,
  isWorkMode: true,
  timeLeft: 25 * 60,
  isRunning: false,
  sessionStartTime: null,
  endTime: null,
  subjectText: 'General Study',
  currentTopicId: null,
  scheduledDuration: 25,
  sessionSaved: false,
  appliedSavedTime: 0,
};

type Listener = (state: TimerState) => void;
type SessionLoggedListener = () => void;

// Closure-based private state variables
let state: TimerState = { ...DEFAULT_STATE };
let userId: number | null = null;
const listeners = new Set<Listener>();
const sessionLoggedListeners = new Set<SessionLoggedListener>();
let tickInterval: ReturnType<typeof setInterval> | null = null;
let showToastCb: ((msg: string, type: 'success' | 'error' | 'warning' | 'info') => void) | null = null;

// Audio alerts tone generation
function playBellAlert(type: 'work' | 'break') {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playTone = (freq: number, duration: number, start: number) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.5, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration - 0.05);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    const now = audioCtx.currentTime;
    if (type === 'work') {
      playTone(523.25, 0.4, now); // C5
      playTone(659.25, 0.6, now + 0.25); // E5
    } else {
      playTone(587.33, 0.4, now); // D5
      playTone(440.00, 0.6, now + 0.25); // A4
    }
  } catch (err) {
    console.warn('Audio bell synthesis failed:', err);
  }
}

// System desktop notifications
function showDesktopNotification(title: string, body: string) {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          new Notification(title, { body });
        }
      });
    }
  }
}

function notify() {
  const currentState = state;
  for (const listener of listeners) {
    try {
      listener(currentState);
    } catch (err) {
      console.error('Error in TimerService listener:', err);
    }
  }
}

function triggerSessionLogged() {
  for (const listener of sessionLoggedListeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error in session logged listener:', err);
    }
  }
}

function stopBackgroundLoop() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

async function saveState() {
  if (userId === null) return;
  try {
    localStorage.setItem(`timer_state_${userId}`, JSON.stringify(state));
  } catch (err) {
    console.warn('Failed to save state to localStorage:', err);
  }
  try {
    await db.saveTimerState(userId, state);
  } catch (err) {
    console.warn('Failed to save state to SQLite database:', err);
  }
}

async function loadState() {
  if (userId === null) return;

  try {
    let stateData: Partial<TimerState> | null = null;

    try {
      const row = await db.getTimerState(userId);
      if (row) {
        stateData = {
          workMinutes: row.work_minutes !== null ? row.work_minutes : DEFAULT_STATE.workMinutes,
          breakMinutes: row.break_minutes !== null ? row.break_minutes : DEFAULT_STATE.breakMinutes,
          longBreakMinutes: row.long_break_minutes !== null ? row.long_break_minutes : DEFAULT_STATE.longBreakMinutes,
          cyclesLimit: row.cycles_limit !== null ? row.cycles_limit : DEFAULT_STATE.cyclesLimit,
          completedCycles: row.completed_sessions !== null ? row.completed_sessions : DEFAULT_STATE.completedCycles,
          isWorkMode: row.mode === 'work',
          timeLeft: row.remaining_time !== null ? row.remaining_time : DEFAULT_STATE.timeLeft,
          isRunning: row.is_running === 1,
          sessionStartTime: row.start_time,
          endTime: row.end_time,
          subjectText: row.subject_text || 'General Study',
          currentTopicId: row.current_topic_id,
        };
      }
    } catch (err) {
      console.warn('Could not read timer state from SQLite database:', err);
    }

    if (!stateData) {
      const local = localStorage.getItem(`timer_state_${userId}`);
      if (local) {
        stateData = JSON.parse(local);
      }
    }

    if (stateData) {
      let loadedState = {
        ...DEFAULT_STATE,
        ...stateData,
      };

      if (loadedState.isRunning && loadedState.endTime) {
        const now = Date.now();
        const expectedEnd = new Date(loadedState.endTime).getTime();

        if (now >= expectedEnd) {
          const workMins = loadedState.workMinutes;
          const startT = loadedState.sessionStartTime || toLocalISOString(new Date(expectedEnd - workMins * 60 * 1000));
          const endT = toLocalISOString(new Date(expectedEnd));

          if (loadedState.isWorkMode) {
            try {
              await db.logFocusSession(
                userId,
                loadedState.currentTopicId ? Number(loadedState.currentTopicId) : null,
                loadedState.subjectText,
                startT,
                endT,
                workMins,
                'work',
                'Completed focus session (auto-logged offline)'
              );
              triggerSessionLogged();
            } catch (err) {
              console.error('Failed to auto-log offline focus session:', err);
            }
            loadedState.completedCycles += 1;
          }

          const nextWorkMode = !loadedState.isWorkMode;
          const isLongBreak = loadedState.completedCycles % loadedState.cyclesLimit === 0;
          const nextTimeLeft = (nextWorkMode ? loadedState.workMinutes : (isLongBreak ? loadedState.longBreakMinutes : loadedState.breakMinutes)) * 60;
          
          loadedState = {
            ...loadedState,
            isWorkMode: nextWorkMode,
            timeLeft: nextTimeLeft,
            isRunning: false,
            endTime: null,
            sessionStartTime: null
          };
          
          state = loadedState;
          await saveState();
        } else {
          loadedState = {
            ...loadedState,
            timeLeft: Math.max(0, Math.ceil((expectedEnd - now) / 1000))
          };
          state = loadedState;
        }
      } else {
        state = loadedState;
      }
    }
  } catch (err) {
    console.error('Failed to load timer state:', err);
  }
}

async function handleTimerEnd() {
  if (userId === null) return;

  const completedMode = state.isWorkMode;
  let completedCycles = state.completedCycles;
  let isWorkMode = state.isWorkMode;
  let timeLeft = state.timeLeft;

  if (completedMode) {
    playBellAlert('work');
    showDesktopNotification(
      'Focus Session Complete!',
      'Great job staying focused! Time to take a break.'
    );

    const schedDuration = state.scheduledDuration || state.workMinutes;
    const startT = state.sessionStartTime || toLocalISOString(new Date(Date.now() - schedDuration * 60 * 1000));
    const endT = toLocalISOString();

    try {
      await db.logFocusSession(
        userId,
        state.currentTopicId ? Number(state.currentTopicId) : null,
        state.subjectText,
        startT,
        endT,
        schedDuration,
        'work',
        'Completed focus session (auto-logged)',
        schedDuration,
        schedDuration,
        0,
        state.appliedSavedTime > 0 ? 1 : 0,
        state.subjectText
      );

      if (state.currentTopicId) {
        db.incrementTopicCompletedHours(Number(state.currentTopicId), schedDuration / 60).catch(console.error);
      }

      triggerSessionLogged();
      if (showToastCb) {
        showToastCb(`${schedDuration} minutes added to today's study time.`, 'success');
      }
    } catch (err) {
      console.error('Failed to log focus session automatically:', err);
    }

    completedCycles += 1;
    isWorkMode = false;
    const isLongBreak = completedCycles % state.cyclesLimit === 0;
    timeLeft = (isLongBreak ? state.longBreakMinutes : state.breakMinutes) * 60;
  } else {
    playBellAlert('break');
    showDesktopNotification(
      'Break Ended',
      'Break is over. Let\'s start the next focus cycle!'
    );
    if (showToastCb) {
      showToastCb('Break completed! Let\'s focus again.', 'success');
    }

    isWorkMode = true;
    timeLeft = state.workMinutes * 60;
  }

  state = {
    ...state,
    completedCycles,
    isWorkMode,
    timeLeft,
    isRunning: false,
    endTime: null,
    sessionStartTime: null,
    scheduledDuration: isWorkMode ? state.workMinutes : (state.completedCycles % state.cyclesLimit === 0 ? state.longBreakMinutes : state.breakMinutes),
    sessionSaved: true,
    appliedSavedTime: 0
  };

  saveState();
  notify();
  startBackgroundLoop();
}

function tick() {
  if (!state.isRunning || !state.endTime || userId === null) return;

  const now = Date.now();
  const expectedEnd = new Date(state.endTime).getTime();

  if (now >= expectedEnd) {
    state = {
      ...state,
      timeLeft: 0
    };
    stopBackgroundLoop();
    handleTimerEnd();
  } else {
    const calculatedTimeLeft = Math.max(0, Math.ceil((expectedEnd - now) / 1000));
    if (calculatedTimeLeft !== state.timeLeft) {
      state = {
        ...state,
        timeLeft: calculatedTimeLeft
      };
      notify();
      saveState();
    }
  }
}

function startBackgroundLoop() {
  stopBackgroundLoop();
  tickInterval = setInterval(() => {
    tick();
  }, 100);
}

// Exported singleton service object (closure methods)
export const TimerService = {
  async init(
    uId: number,
    showToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info') => void
  ) {
    stopBackgroundLoop();
    state = { ...DEFAULT_STATE };
    userId = uId;
    showToastCb = showToast;

    await loadState();
    startBackgroundLoop();
    notify();
  },

  cleanup() {
    stopBackgroundLoop();
    state = { ...DEFAULT_STATE };
    userId = null;
    showToastCb = null;
    notify();
  },

  getState(): TimerState {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  onSessionLogged(listener: SessionLoggedListener): () => void {
    sessionLoggedListeners.add(listener);
    return () => {
      sessionLoggedListeners.delete(listener);
    };
  },

  start() {
    if (userId === null) return;
    if (state.isRunning) return;

    const sessionStartTime = (!state.sessionStartTime && state.isWorkMode)
      ? toLocalISOString()
      : state.sessionStartTime;

    state = {
      ...state,
      isRunning: true,
      sessionStartTime,
      sessionSaved: false,
      scheduledDuration: state.scheduledDuration || (state.isWorkMode ? state.workMinutes : state.breakMinutes),
      endTime: toLocalISOString(new Date(Date.now() + state.timeLeft * 1000))
    };
    
    saveState();
    notify();
    if (showToastCb) {
      showToastCb('Timer started', 'success');
    }
  },

  pause() {
    if (userId === null) return;
    if (!state.isRunning) return;

    state = {
      ...state,
      isRunning: false,
      endTime: null
    };

    saveState();
    notify();
    if (showToastCb) {
      showToastCb('Timer paused', 'warning');
    }
  },

  resume() {
    this.start();
  },

  stop() {
    this.reset();
  },

  reset() {
    if (userId === null) return;

    state = {
      ...state,
      isRunning: false,
      isWorkMode: true,
      timeLeft: state.workMinutes * 60,
      endTime: null,
      sessionStartTime: null,
      scheduledDuration: state.workMinutes,
      sessionSaved: false,
      appliedSavedTime: 0
    };

    saveState();
    notify();
    if (showToastCb) {
      showToastCb('Timer reset', 'info');
    }
  },

  skip() {
    if (userId === null) return;

    let isWorkMode = state.isWorkMode;
    let timeLeft = state.timeLeft;

    if (isWorkMode) {
      isWorkMode = false;
      const isLongBreak = state.completedCycles > 0 && state.completedCycles % state.cyclesLimit === 0;
      timeLeft = (isLongBreak ? state.longBreakMinutes : state.breakMinutes) * 60;
    } else {
      isWorkMode = true;
      timeLeft = state.workMinutes * 60;
    }

    state = {
      ...state,
      isRunning: false,
      endTime: null,
      sessionStartTime: null,
      isWorkMode,
      timeLeft,
      scheduledDuration: isWorkMode ? state.workMinutes : (state.completedCycles % state.cyclesLimit === 0 ? state.longBreakMinutes : state.breakMinutes),
      sessionSaved: false,
      appliedSavedTime: 0
    };

    saveState();
    notify();
    if (showToastCb) {
      showToastCb('Session skipped', 'info');
    }
  },

  applySettings(
    workMins: number,
    breakMins: number,
    longBreakMins: number,
    cyclesLim: number
  ) {
    if (userId === null) return;

    state = {
      ...state,
      workMinutes: workMins,
      breakMinutes: breakMins,
      longBreakMinutes: longBreakMins,
      cyclesLimit: cyclesLim,
      timeLeft: (state.isWorkMode ? workMins : breakMins) * 60,
      isRunning: false,
      endTime: null,
      sessionStartTime: null,
      scheduledDuration: workMins,
      sessionSaved: false,
      appliedSavedTime: 0
    };

    saveState();
    notify();
    if (showToastCb) {
      showToastCb('Timer settings applied', 'success');
    }
  },

  setSubject(subjectText: string, currentTopicId: number | null) {
    if (userId === null) return;

    state = {
      ...state,
      subjectText,
      currentTopicId
    };

    saveState();
    notify();
  },

  getRemainingTime(): number {
    return state.timeLeft;
  },

  async saveTimerSession() {
    if (userId === null) return { success: false, message: 'User not logged in' };
    if (state.sessionSaved) {
      if (showToastCb) {
        showToastCb('This timer session has already been saved.', 'warning');
      }
      return { success: false, message: 'This timer session has already been saved.' };
    }

    const isActiveOrCompleted = state.isWorkMode && (state.sessionStartTime !== null || state.timeLeft === 0);
    if (!isActiveOrCompleted) {
      return { success: false, message: 'No active or completed timer session to save.' };
    }

    const scheduledMinutes = state.scheduledDuration || state.workMinutes;
    const remainingMinutes = Math.floor(state.timeLeft / 60);
    const actualMinutes = Math.max(0, scheduledMinutes - remainingMinutes);
    const startT = state.sessionStartTime || toLocalISOString(new Date(Date.now() - scheduledMinutes * 60 * 1000));
    const endT = toLocalISOString();

    stopBackgroundLoop();

    try {
      await db.logFocusSession(
        userId,
        state.currentTopicId ? Number(state.currentTopicId) : null,
        state.subjectText,
        startT,
        endT,
        actualMinutes,
        'work',
        `Saved session (planned ${scheduledMinutes}m, actual ${actualMinutes}m, remaining ${remainingMinutes}m)`,
        scheduledMinutes,
        actualMinutes,
        remainingMinutes,
        state.appliedSavedTime > 0 ? 1 : 0,
        state.subjectText
      );

      triggerSessionLogged();

      if (showToastCb) {
        showToastCb(`${actualMinutes} minutes added to today's study time.`, 'success');
      }

      let completedCycles = state.completedCycles + 1;
      const isLongBreak = completedCycles % state.cyclesLimit === 0;
      const nextTimeLeft = (isLongBreak ? state.longBreakMinutes : state.breakMinutes) * 60;

      state = {
        ...state,
        sessionSaved: true,
        completedCycles,
        isWorkMode: false,
        timeLeft: nextTimeLeft,
        isRunning: false,
        endTime: null,
        sessionStartTime: null,
        scheduledDuration: isLongBreak ? state.longBreakMinutes : state.breakMinutes,
        appliedSavedTime: 0
      };

      saveState();
      notify();

      return {
        success: true,
        actualMinutes,
        remainingMinutes,
        scheduledMinutes
      };
    } catch (err: any) {
      console.error('Failed to save timer session:', err);
      return { success: false, message: err.message || 'Failed to save session' };
    }
  },

  async saveEarlyTime() {
    return this.saveTimerSession();
  },

  async useSavedTime(minutes: number) {
    if (userId === null) throw new Error('User not logged in');
    if (minutes <= 0) throw new Error('Minutes must be greater than 0');

    const updatedStats = await db.useSavedTime(userId, minutes);

    const additionalSecs = minutes * 60;
    const newTimeLeft = state.timeLeft + additionalSecs;
    const newScheduled = (state.scheduledDuration || state.workMinutes) + minutes;
    const newEndTime = state.isRunning ? toLocalISOString(new Date(Date.now() + newTimeLeft * 1000)) : state.endTime;

    state = {
      ...state,
      timeLeft: newTimeLeft,
      scheduledDuration: newScheduled,
      appliedSavedTime: state.appliedSavedTime + minutes,
      endTime: newEndTime
    };

    saveState();
    notify();

    if (showToastCb) {
      showToastCb(`Added ${minutes} minutes from Saved Time!`, 'success');
    }

    return updatedStats;
  }
};
