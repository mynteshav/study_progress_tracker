import React, { useState, useEffect } from 'react';
import { db } from './db';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import Topics from './components/Topics';
import Timer from './components/Timer';
import Dsa from './components/Dsa';
import Projects from './components/Projects';
import Timetable from './components/Timetable';
import Habits from './components/Habits';
import NotesCards from './components/NotesCards';
import Analytics from './components/Analytics';
import Roadmap from './components/Roadmap';
import { Map } from 'lucide-react';
import { TimerService } from './services/TimerService';
import InstallPWAButton from './components/InstallPWAButton';

export interface User {
  id: number;
  firebase_uid?: string;
  name: string;
  email: string;
  daily_goal_minutes: number;
  timezone: string;
  isNew?: boolean;
}

export interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeSection, setActiveSection] = useState<string>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);

  // Profile edit form state
  const [pName, setPName] = useState<string>('');
  const [pGoal, setPGoal] = useState<number>(1);
  const [pTimezone, setPTimezone] = useState<string>('Asia/Calcutta');
  const [forceSetup, setForceSetup] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 992);

  const [syncState, setSyncState] = useState<{ status: string; pendingCount: number; lastSyncedAt?: string; errorMessage?: string }>({
    status: 'synced',
    pendingCount: 0,
    lastSyncedAt: typeof localStorage !== 'undefined' ? localStorage.getItem('last_synced_timestamp') || undefined : undefined
  });
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  // Handle window resize and initial desktop vs mobile state
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 992;
      setIsMobile(mobile);
      if (!mobile) {
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check saved session
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setUser(u);
        setPName(u.name || '');
        setPGoal((u.daily_goal_minutes / 60) || 1);
        setPTimezone(u.timezone || 'Asia/Calcutta');

        if (u.isNew || !u.timezone) {
          setForceSetup(true);
          setShowProfileModal(true);
        }
      } catch (err) {
        console.error(err);
      }
    }
  }, []);

  const [syncRefreshKey, setSyncRefreshKey] = useState<number>(0);

  // Synchronize TimerService & SyncService lifecycle with user session
  useEffect(() => {
    if (user) {
      TimerService.init(user.id, (msg, type) => {
        showToast(msg, type);
      });

      // Initialize SyncService
      import('./services/SyncService').then(({ SyncService }) => {
        const targetUid = user.firebase_uid || user.id.toString();
        SyncService.init(targetUid);

        const unsubStatus = SyncService.subscribeStatus((st) => {
          setSyncState({
            status: st.status,
            pendingCount: st.pendingCount,
            lastSyncedAt: st.lastSyncedAt,
            errorMessage: st.errorMessage
          });
        });

        const unsubData = SyncService.subscribeDataChange((entity) => {
          console.log(`[App] Data change notification received (${entity}). Incrementing syncRefreshKey.`);
          setSyncRefreshKey((k) => k + 1);
        });

        return () => {
          unsubStatus();
          unsubData();
        };
      }).catch(console.error);

      // Check due roadmap revisions
      db.getDueRevisions(user.id).then((due: any[]) => {
        if (due && due.length > 0) {
          showToast(`You have ${due.length} roadmap topic revision(s) due!`, 'warning');
        }
      }).catch(console.error);
    } else {
      TimerService.cleanup();
      import('./services/SyncService').then(({ SyncService }) => {
        SyncService.cleanup();
      }).catch(() => {});
    }
  }, [user]);

  const formatLastSynced = (isoString?: string): string => {
    if (!isoString) return 'Never';
    try {
      const past = new Date(isoString).getTime();
      const now = Date.now();
      const diffSec = Math.floor((now - past) / 1000);

      if (diffSec < 15) return 'Just now';
      if (diffSec < 60) return `${diffSec}s ago`;

      const diffMin = Math.floor(diffSec / 60);
      if (diffMin === 1) return '1 minute ago';
      if (diffMin < 60) return `${diffMin} minutes ago`;

      const diffHours = Math.floor(diffMin / 60);
      if (diffHours === 1) return '1 hour ago';
      if (diffHours < 24) return `${diffHours} hours ago`;

      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return '1 day ago';
      return `${diffDays} days ago`;
    } catch (e) {
      return 'Never';
    }
  };

  const handleManualSync = async () => {
    try {
      const { SyncService } = await import('./services/SyncService');
      await SyncService.triggerManualSync();
      showToast('Synchronization completed successfully!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Sync failed. Your changes are safely stored locally.', 'error');
    }
  };

  const showToast = (message: string, type: ToastMessage['type'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);

    // Auto-remove after 4.5 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const handleLogout = async () => {
    try {
      const { SyncService } = await import('./services/SyncService');
      SyncService.cleanup();

      const { logoutFirebase } = await import('./utils/firebase');
      await logoutFirebase();
    } catch (err) {
      console.warn('[Firebase Auth] Signout notice:', err);
    }
    localStorage.removeItem('user');
    setUser(null);
    showToast('Logged out successfully', 'success');
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const minutes = Math.round(pGoal * 60);

    try {
      await db.updateUserProfile(user.id, pName, minutes, pTimezone);

      const updatedUser: User = {
        ...user,
        name: pName,
        daily_goal_minutes: minutes,
        timezone: pTimezone,
        isNew: false
      };

      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setShowProfileModal(false);
      showToast('Profile updated successfully!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to update profile', 'error');
    }
  };

  // Play Audio Synthesis bells
  const playBellAlert = (type: 'work' | 'break' = 'work') => {
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
  };

  // Render Viewport Section Selection
  const renderSection = () => {
    if (!user) return null;

    switch (activeSection) {
      case 'dashboard':
        return <Dashboard user={user} navigate={setActiveSection} showToast={showToast} />;
      case 'topics':
        return <Topics user={user} showToast={showToast} />;
      case 'timer':
        return <Timer user={user} showToast={showToast} playBell={playBellAlert} />;
      case 'dsa':
        return <Dsa user={user} showToast={showToast} />;
      case 'projects':
        return <Projects user={user} showToast={showToast} />;
      case 'timetable':
        return <Timetable user={user} showToast={showToast} />;
      case 'habits':
        return <Habits user={user} showToast={showToast} />;
      case 'notes':
        return <NotesCards user={user} showToast={showToast} />;
      case 'roadmap':
        return <Roadmap user={user} navigate={setActiveSection} showToast={showToast} />;
      case 'analytics':
        return <Analytics user={user} showToast={showToast} />;
      default:
        return <div className="glass-panel"><h3>View not found</h3></div>;
    }
  };

  const getLocalDateHeaderStr = () => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    return new Date().toLocaleDateString('en-US', options);
  };

  // Auth screen display
  if (!user) {
    return (
      <div className="app-container">
        <Auth setUser={(u) => {
          setUser(u);
          setPName(u.name || '');
          setPGoal((u.daily_goal_minutes / 60) || 1);
          setPTimezone(u.timezone || 'Asia/Calcutta');
          if (u.isNew || !u.timezone) {
            setForceSetup(true);
            setShowProfileModal(true);
          }
        }} showToast={showToast} />

        {/* Render Toast notifications */}
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <i className={`fa-solid ${t.type === 'error' ? 'fa-circle-exclamation' : t.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const formatTitle = (s: string) => {
    return s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ');
  };

  return (
    <div className="app-container">
      {/* Mobile Drawer Backdrop */}
      <div
        className={`sidebar-backdrop ${isMobile && sidebarOpen ? 'active' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar Nav */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-logo"><i className="fa-solid fa-graduation-cap"></i></div>
          <span className="brand-name">Study Tracker</span>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <nav className="sidebar-menu">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
            { id: 'topics', label: "Today's Topics", icon: 'fa-list-check' },
            { id: 'timer', label: 'Focus Timer', icon: 'fa-stopwatch' },
            { id: 'dsa', label: 'Coding Problems', icon: 'fa-code' },
            { id: 'projects', label: 'Projects', icon: 'fa-diagram-project' },
            { id: 'timetable', label: 'Timetable', icon: 'fa-calendar-days' },
            { id: 'habits', label: 'Habits', icon: 'fa-repeat' },
            { id: 'notes', label: 'Notes', icon: 'fa-book-open' },
            { id: 'roadmap', label: 'Roadmap', isLucide: true },
            { id: 'analytics', label: 'Statistics', icon: 'fa-chart-line' }
          ].map(item => (
            <div
              key={item.id}
              className={`menu-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => {
                setActiveSection(item.id);
                if (window.innerWidth < 992) {
                  setSidebarOpen(false);
                }
              }}
            >
              {item.isLucide ? (
                <Map size={18} style={{ marginRight: '8px' }} />
              ) : (
                <i className={`fa-solid ${item.icon}`}></i>
              )}
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="user-avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div className="user-details">
            <div className="user-name">{user.name}</div>
            <div className="user-goal">Goal: {user.daily_goal_minutes}m/day</div>
          </div>
          <button
            className="profile-edit-btn"
            title="Edit Profile"
            onClick={() => {
              setForceSetup(false);
              setShowProfileModal(true);
              if (window.innerWidth < 992) setSidebarOpen(false);
            }}
          >
            <i className="fa-solid fa-gear"></i>
          </button>
        </div>
      </aside>

      {/* Main viewport area */}
      <main className="main-layout">

        {/* Header */}
        <header className="top-bar">
          <div className="top-bar-left">
            <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle menu">
              <i className="fa-solid fa-bars"></i>
            </button>
            <h1 className="page-title">{formatTitle(activeSection)}</h1>
          </div>
          <div className="top-bar-right">
            {/* Install PWA Button */}
            <InstallPWAButton showToast={showToast} />

            {/* Manual Sync Button & Status */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
              <button
                className="btn"
                disabled={syncState.status === 'syncing'}
                onClick={handleManualSync}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: syncState.status === 'syncing' ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor:
                    syncState.status === 'syncing'
                      ? '#334155'
                      : syncState.status === 'error'
                      ? '#ef4444'
                      : syncState.status === 'pending'
                      ? '#f59e0b'
                      : syncState.status === 'synced'
                      ? '#10b981'
                      : '#6366f1',
                  color: '#ffffff',
                  border: 'none'
                }}
                title={
                  syncState.status === 'error'
                    ? syncState.errorMessage || 'Sync failed. Click to retry.'
                    : 'Click to synchronize all changes'
                }
              >
                <i
                  className={`fa-solid ${
                    syncState.status === 'syncing'
                      ? 'fa-rotate fa-spin'
                      : syncState.status === 'error'
                      ? 'fa-circle-xmark'
                      : syncState.status === 'synced'
                      ? 'fa-check'
                      : syncState.status === 'pending'
                      ? 'fa-cloud-arrow-up'
                      : 'fa-rotate'
                  }`}
                ></i>
                <span>
                  {syncState.status === 'syncing'
                    ? 'Syncing...'
                    : syncState.status === 'error'
                    ? 'Sync failed'
                    : syncState.status === 'synced'
                    ? 'Synced'
                    : syncState.status === 'pending'
                    ? `Sync (${syncState.pendingCount} pending)`
                    : 'Sync'}
                </span>
              </button>

              <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 500 }}>
                Last synced: {formatLastSynced(syncState.lastSyncedAt)}
              </span>
            </div>
            <div className="current-date">
              <i className="fa-regular fa-calendar"></i>
              <span>{getLocalDateHeaderStr()}</span>
            </div>
            <button className="logout-btn" onClick={handleLogout} title="Logout">
              <i className="fa-solid fa-right-from-bracket"></i>
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Viewport content */}
        <div className="viewport">
          {renderSection()}
        </div>
      </main>

      {/* Profile setup modal */}
      <div className={`modal ${showProfileModal ? 'active' : ''}`}>
        <div className="modal-content glassmorphism">
          <div className="modal-header">
            <h2>{forceSetup ? 'Setup Study Profile' : 'Edit Study Profile'}</h2>
            {!forceSetup && (
              <button className="modal-close" onClick={() => setShowProfileModal(false)}>&times;</button>
            )}
          </div>
          <form className="modal-form" onSubmit={handleProfileSave}>
            <div className="form-group">
              <label htmlFor="p-name">Display Name</label>
              <input
                type="text"
                id="p-name"
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="Enter your name"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="p-goal">Daily Study Goal (in hours)</label>
              <input
                type="number"
                id="p-goal"
                value={pGoal}
                onChange={(e) => setPGoal(parseFloat(e.target.value))}
                min="0.1"
                max="24"
                step="0.1"
                placeholder="e.g. 2"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="p-timezone">Timezone</label>
              <select
                id="p-timezone"
                value={pTimezone}
                onChange={(e) => setPTimezone(e.target.value)}
                required
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="America/New_York">EST (Eastern Standard Time / New York)</option>
                <option value="Europe/London">GMT/BST (London)</option>
                <option value="Asia/Calcutta">IST (Indian Standard Time / Kolkata)</option>
                <option value="Asia/Tokyo">JST (Japan Standard Time / Tokyo)</option>
                <option value="Australia/Sydney">AEST (Sydney)</option>
              </select>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Save Profile</button>
            </div>
          </form>
        </div>
      </div>

      {/* Toasts overlay */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <i className={`fa-solid ${t.type === 'error' ? 'fa-circle-exclamation' : t.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

export default App;
