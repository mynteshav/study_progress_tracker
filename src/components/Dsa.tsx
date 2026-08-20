import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../App';

interface DsaProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Dsa({ user, showToast }: DsaProps) {
  const [problems, setProblems] = useState<any[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  
  // Filter & Sort state
  const [patternFilter, setPatternFilter] = useState<string>('');
  const [diffFilter, setDiffFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('date-desc');

  // Modal form states
  const [showModal, setShowModal] = useState<boolean>(false);
  const [probId, setProbId] = useState<number | null>(null);
  const [title, setTitle] = useState<string>('');
  const [platform, setPlatform] = useState<string>('LeetCode');
  const [url, setUrl] = useState<string>('');
  const [pattern, setPattern] = useState<string>('');
  const [difficulty, setDifficulty] = useState<string>('med');
  const [status, setStatus] = useState<string>('solved');
  const [timeSpent, setTimeSpent] = useState<number>(20);
  const [dateSolved, setDateSolved] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');

  const loadData = async () => {
    try {
      const data = await db.getDsaProblems(user.id);
      setProblems(data);
      
      const uniquePatterns = Array.from(new Set(data.map((p: any) => p.pattern))).sort() as string[];
      setPatterns(uniquePatterns);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
    let unsubSync: (() => void) | null = null;
    import('../services/SyncService').then(({ SyncService }) => {
      unsubSync = SyncService.subscribeDataChange((entity) => {
        if (entity === 'all' || entity === 'dsa_problems') {
          loadData();
        }
      });
    }).catch(console.error);

    return () => {
      if (unsubSync) unsubSync();
    };
  }, [user]);

  const handleOpenModal = (prob: any = null) => {
    if (prob) {
      setProbId(prob.id);
      setTitle(prob.title);
      setPlatform(prob.platform);
      setUrl(prob.url || '');
      setPattern(prob.pattern);
      setDifficulty(prob.difficulty);
      setStatus(prob.status);
      setTimeSpent(prob.time_spent_minutes);
      setDateSolved(prob.date_solved || new Date().toISOString().split('T')[0]);
      setNotes(prob.notes || '');
    } else {
      setProbId(null);
      setTitle('');
      setPlatform('LeetCode');
      setUrl('');
      setPattern('');
      setDifficulty('med');
      setStatus('solved');
      setTimeSpent(20);
      setDateSolved(new Date().toISOString().split('T')[0]);
      setNotes('');
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !platform || !pattern || !difficulty) {
      showToast('Title, platform, pattern, and difficulty are required', 'error');
      return;
    }

    const payload = {
      title,
      platform,
      url,
      pattern,
      difficulty,
      status,
      time_spent_minutes: timeSpent,
      date_solved: dateSolved,
      notes
    };

    try {
      if (probId) {
        await db.updateDsaProblem(probId, payload);
        showToast('Problem log updated', 'success');
      } else {
        await db.addDsaProblem(user.id, payload);
        showToast('Problem logged successfully', 'success');
      }
      handleCloseModal();
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save problem', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this problem log?')) {
      try {
        await db.deleteDsaProblem(id);
        showToast('Problem log deleted', 'success');
        loadData();
      } catch (err: any) {
        showToast(err.message || 'Failed to delete problem', 'error');
      }
    }
  };

  const handleQuickSolve = async (id: number) => {
    try {
      await db.updateDsaProblem(id, { status: 'solved' });
      showToast('Problem marked as solved and cleared from review queue!', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update problem status', 'error');
    }
  };

  // Filter & Sort Logic
  const filteredProblems = problems.filter((p: any) => {
    const matchPat = !patternFilter || p.pattern === patternFilter;
    const matchDiff = !diffFilter || p.difficulty === diffFilter;
    const matchStat = !statusFilter || p.status === statusFilter;
    return matchPat && matchDiff && matchStat;
  }).sort((a: any, b: any) => {
    if (sortOrder === 'date-desc') {
      const da = a.date_solved || '';
      const dbStr = b.date_solved || '';
      return dbStr.localeCompare(da) || b.id - a.id;
    } else if (sortOrder === 'date-asc') {
      const da = a.date_solved || '';
      const dbStr = b.date_solved || '';
      return da.localeCompare(dbStr) || a.id - b.id;
    } else if (sortOrder === 'time-desc') {
      return (b.time_spent_minutes || 0) - (a.time_spent_minutes || 0);
    }
    return 0;
  });

  // Streaks statistics Calculations
  const solved = problems.filter(p => p.status === 'solved');
  const easyCount = solved.filter(p => p.difficulty === 'easy').length;
  const medCount = solved.filter(p => p.difficulty === 'med').length;
  const hardCount = solved.filter(p => p.difficulty === 'hard').length;
  
  const totalSolved = solved.length;

  const renderProgressBar = (label: string, count: number, color: string) => {
    const pct = totalSolved > 0 ? Math.round((count / totalSolved) * 100) : 0;
    return (
      <div key={label}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
          <span>{label} ({count})</span>
          <span>{pct}%</span>
        </div>
        <div className="prog-bar-track">
          <div className="prog-bar-fill" style={{ width: `${pct}%`, backgroundColor: color }}></div>
        </div>
      </div>
    );
  };

  const revisionQueue = problems.filter(p => p.status === 'revisit');

  return (
    <div>
      <div className="dsa-header-bar">
        <div className="filters-wrapper">
          <select value={patternFilter} onChange={(e) => setPatternFilter(e.target.value)} className="filter-select">
            <option value="">-- All Patterns --</option>
            {patterns.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          
          <select value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)} className="filter-select">
            <option value="">-- All Difficulties --</option>
            <option value="easy">Easy</option>
            <option value="med">Medium</option>
            <option value="hard">Hard</option>
          </select>
          
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
            <option value="">-- All Statuses --</option>
            <option value="attempted">Attempted</option>
            <option value="solved">Solved</option>
            <option value="revisit">Revisit</option>
          </select>
          
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="filter-select">
            <option value="date-desc">Newest Solved</option>
            <option value="date-asc">Oldest Solved</option>
            <option value="time-desc">Time Spent (High)</option>
          </select>
        </div>
        
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
          <i className="fa-solid fa-plus"></i> Log Problem
        </button>
      </div>

      <div className="dsa-layout">
        {/* Left: Problems Grid */}
        <div className="glass-panel" style={{ minHeight: '400px' }}>
          <h2 className="dashboard-title">Problems Log</h2>
          <div className="problems-list-container">
            {filteredProblems.length === 0 ? (
              <div className="upcoming-empty">No matching DSA problems logged.</div>
            ) : (
              filteredProblems.map((p) => (
                <div key={p.id} className="problem-card">
                  <div className="problem-main">
                    <div className="problem-title-row">
                      {p.url ? (
                        <a href="#" onClick={(e) => { e.preventDefault(); if (p.url) window.open(p.url); }} className="problem-title">
                          {p.title} <i className="fa-solid fa-up-right-from-square" style={{ fontSize: '0.8rem', marginLeft: '2px' }}></i>
                        </a>
                      ) : (
                        <span className="problem-title" style={{ cursor: 'default' }}>{p.title}</span>
                      )}
                      <span className={`badge ${p.difficulty === 'hard' ? 'badge-high' : p.difficulty === 'easy' ? 'badge-low' : 'badge-med'}`}>
                        {p.difficulty}
                      </span>
                      <span className="badge badge-subject">{p.platform} • {p.pattern}</span>
                    </div>
                    <div className="problem-info">
                      <span><i className="fa-regular fa-clock"></i> {p.time_spent_minutes} mins</span>
                      <span><i className="fa-regular fa-calendar"></i> Solved: {p.date_solved || 'N/A'}</span>
                      {p.notes && <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Notes: {p.notes}</span>}
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`problem-status-tag ${p.status === 'solved' ? 'status-solved' : p.status === 'attempted' ? 'status-attempted' : 'status-revisit'}`}>
                      {p.status}
                    </span>
                    <div className="topic-actions">
                      <button className="topic-action-btn" onClick={() => handleOpenModal(p)}><i className="fa-solid fa-pen-to-square"></i></button>
                      <button className="topic-action-btn delete" onClick={() => handleDelete(p.id)}><i className="fa-solid fa-trash"></i></button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: solved stats and Spaced Revision queue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="glass-panel">
            <h2 className="dashboard-title">Solve Progress</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, textAlign: 'center', marginBottom: '8px' }}>
                {totalSolved} Solved Total
              </div>
              {renderProgressBar('Easy', easyCount, 'var(--color-low)')}
              {renderProgressBar('Medium', medCount, 'var(--color-med)')}
              {renderProgressBar('Hard', hardCount, 'var(--color-high)')}
            </div>
          </div>

          <div className="glass-panel">
            <h2 className="dashboard-title" style={{ color: '#f87171' }}>
              <i className="fa-solid fa-clock-rotate-left"></i> Revision Queue
            </h2>
            <div className="upcoming-list">
              {revisionQueue.length > 0 ? (
                revisionQueue.map(p => (
                  <div key={p.id} className="upcoming-item" style={{ borderLeftColor: '#f87171' }}>
                    <div style={{ flex: 1 }}>
                      <div className="upcoming-subject">{p.title}</div>
                      <div className="upcoming-time">{p.platform} • {p.pattern}</div>
                    </div>
                    <button
                      className="btn btn-secondary btn-circle"
                      onClick={() => handleQuickSolve(p.id)}
                      style={{ width: '32px', height: '32px', fontSize: '0.8rem' }}
                      title="Solve / Close revision"
                    >
                      <i className="fa-solid fa-check"></i>
                    </button>
                  </div>
                ))
              ) : (
                <div className="upcoming-empty">Queue clear! No items marked as "revisit".</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <div className={`modal ${showModal ? 'active' : ''}`}>
        <div className="modal-content glassmorphism">
          <div className="modal-header">
            <h2>{probId ? 'Edit DSA Problem Log' : 'Log DSA Problem'}</h2>
            <button className="modal-close" onClick={handleCloseModal}>&times;</button>
          </div>
          <form className="modal-form" onSubmit={handleFormSubmit}>
            <div className="form-group">
              <label htmlFor="dsa-title">Problem Title</label>
              <input
                type="text"
                id="dsa-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Reverse Linked List"
                required
              />
            </div>
            
            <div className="grid-2" style={{ gap: '12px' }}>
              <div className="form-group">
                <label htmlFor="dsa-platform">Platform</label>
                <select id="dsa-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} required>
                  <option value="LeetCode">LeetCode</option>
                  <option value="Codeforces">Codeforces</option>
                  <option value="HackerRank">HackerRank</option>
                  <option value="GeeksforGeeks">GeeksforGeeks</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="dsa-pattern">Pattern/Topic</label>
                <input
                  type="text"
                  id="dsa-pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="e.g. Two Pointers"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="dsa-url">Problem URL (optional)</label>
              <input
                type="url"
                id="dsa-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://leetcode.com/problems/..."
              />
            </div>

            <div className="grid-3" style={{ gap: '12px' }}>
              <div className="form-group">
                <label htmlFor="dsa-difficulty">Difficulty</label>
                <select id="dsa-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} required>
                  <option value="easy">Easy</option>
                  <option value="med">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="dsa-status">Status</label>
                <select id="dsa-status" value={status} onChange={(e) => setStatus(e.target.value)} required>
                  <option value="solved">Solved</option>
                  <option value="attempted">Attempted</option>
                  <option value="revisit">Revisit</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="dsa-time">Time (minutes)</label>
                <input
                  type="number"
                  id="dsa-time"
                  value={timeSpent}
                  onChange={(e) => setTimeSpent(parseInt(e.target.value) || 0)}
                  min="0"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="dsa-date">Date Solved</label>
              <input
                type="date"
                id="dsa-date"
                value={dateSolved}
                onChange={(e) => setDateSolved(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="dsa-notes">Notes / Optimization</label>
              <textarea
                id="dsa-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="O(N) time optimization, auxiliary space, key checkpoints..."
              />
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Log</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Dsa;
