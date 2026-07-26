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
import { TimerService } from './services/TimerService';

export interface User {
  id: number;
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
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  
  // Profile edit form state
  const [pName, setPName] = useState<string>('');
  const [pGoal, setPGoal] = useState<number>(1);
  const [pTimezone, setPTimezone] = useState<string>('Asia/Calcutta');
  const [forceSetup, setForceSetup] = useState<boolean>(false);

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

  // Synchronize TimerService lifecycle with user session
  useEffect(() => {
    if (user) {
      TimerService.init(user.id, (msg, type) => {
        showToast(msg, type);
      });
    } else {
      TimerService.cleanup();
    }
  }, [user]);

  const showToast = (message: string, type: ToastMessage['type'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    
    // Auto-remove after 4.5 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const handleLogout = () => {
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
      setForceSetup(false);
      showToast('Profile updated successfully!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save profile', 'error');
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
      case 'analytics':
        return <Analytics user={user} showToast={showToast} />;
      default:
        return <div className="glass-panel"><h3>View not found</h3></div>;
    }
  };

  const getLocalDateHeaderStr = () => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
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
      
      {/* Sidebar Nav */}
      <aside className={`sidebar ${sidebarOpen ? '' : 'hidden'}`}>
        <div className="sidebar-brand">
          <div className="brand-logo"><i className="fa-solid fa-graduation-cap"></i></div>
          <span className="brand-name">Study Tracker</span>
        </div>
        
        <nav className="sidebar-menu">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
            { id: 'topics', label: "Today's Topics", icon: 'fa-list-check' },
            { id: 'timer', label: 'Focus Timer', icon: 'fa-stopwatch' },
            { id: 'dsa', label: 'DSA Practice', icon: 'fa-code' },
            { id: 'projects', label: 'Projects', icon: 'fa-diagram-project' },
            { id: 'timetable', label: 'Lane Timetable', icon: 'fa-calendar-days' },
            { id: 'habits', label: 'Habits & Streaks', icon: 'fa-repeat' },
            { id: 'notes', label: 'Notes & Cards', icon: 'fa-book-open' },
            { id: 'analytics', label: 'Analytics', icon: 'fa-chart-line' }
          ].map(item => (
            <div
              key={item.id}
              className={`menu-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <i className={`fa-solid ${item.icon}`}></i>
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
            <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <i className="fa-solid fa-bars"></i>
            </button>
            <h1 className="page-title">{formatTitle(activeSection)}</h1>
          </div>
          <div className="top-bar-right">
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
