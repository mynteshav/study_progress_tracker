import React, { useState, useEffect, useRef } from 'react';
import { db } from '../db';
import { User } from '../App';
import Chart from 'chart.js/auto';

interface RoadmapProps {
  user: User;
  navigate: (sec: string, params?: any) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

export function LucideRoadmapIcon({ className = 'w-5 h-5', style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  );
}

export default function Roadmap({ user, navigate, showToast }: RoadmapProps) {
  const [roadmaps, setRoadmaps] = useState<any[]>([]);
  const [activeRoadmap, setActiveRoadmap] = useState<any | null>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // Tree collapse state
  const [collapsedSections, setCollapsedSections] = useState<Record<number, boolean>>({});

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showSectionModal, setShowSectionModal] = useState<boolean>(false);
  const [showTopicModal, setShowTopicModal] = useState<boolean>(false);
  const [selectedTopic, setSelectedTopic] = useState<any | null>(null);

  // Form states
  const [rTitle, setRTitle] = useState<string>('');
  const [rDesc, setRDesc] = useState<string>('');
  const [rRole, setRRole] = useState<string>('');
  const [rDifficulty, setRDifficulty] = useState<string>('Intermediate');
  const [rDuration, setRDuration] = useState<string>('12 weeks');

  const [secTitle, setSecTitle] = useState<string>('');
  const [targetSectionId, setTargetSectionId] = useState<number | null>(null);

  const [topName, setTopName] = useState<string>('');
  const [topDesc, setTopDesc] = useState<string>('');
  const [topDifficulty, setTopDifficulty] = useState<string>('Intermediate');
  const [topPriority, setTopPriority] = useState<string>('medium');
  const [topEstHours, setTopEstHours] = useState<number>(2);

  // Topic detail drawer states
  const [topicResources, setTopicResources] = useState<any[]>([]);
  const [topicChecklists, setTopicChecklists] = useState<any[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [notesList, setNotesList] = useState<any[]>([]);

  // Resource form inside topic detail
  const [newResTitle, setNewResTitle] = useState<string>('');
  const [newResUrl, setNewResUrl] = useState<string>('');
  const [newResType, setNewResType] = useState<string>('Documentation');
  const [newResDuration, setNewResDuration] = useState<string>('');

  // Checklist form inside topic detail
  const [newCheckItem, setNewCheckItem] = useState<string>('');

  // Chart ref
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<Chart | null>(null);

  // Load roadmaps and active roadmap details
  const loadData = async () => {
    setLoading(true);
    try {
      let all = await db.getRoadmaps(user.id);
      
      // Auto seed AI Engineer roadmap if user has zero roadmaps
      if (all.length === 0) {
        await db.seedPresetRoadmap(user.id, 'ai');
        all = await db.getRoadmaps(user.id);
      }

      setRoadmaps(all);

      let current = all.find((r: any) => r.is_active === 1) || all[0] || null;
      setActiveRoadmap(current);

      if (current) {
        const [secs, tops, projList, noteList] = await Promise.all([
          db.getRoadmapSections(current.id),
          db.getRoadmapTopics(current.id),
          db.getProjects(user.id),
          db.getNotes(user.id)
        ]);

        setSections(secs);
        setTopics(tops);
        setProjectsList(projList);
        setNotesList(noteList);
      } else {
        setSections([]);
        setTopics([]);
      }
    } catch (err: any) {
      console.error('Failed to load roadmap data:', err);
      showToast('Error loading roadmap data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Handle switching active roadmap
  const handleSelectRoadmap = async (rId: number) => {
    try {
      await db.setActiveRoadmap(user.id, rId);
      await loadData();
      showToast('Switched active roadmap', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to switch roadmap', 'error');
    }
  };

  // Create new Roadmap
  const handleCreateRoadmap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rTitle.trim()) return;

    try {
      const res = await db.createRoadmap(user.id, rTitle, rDesc, rRole, rDifficulty, rDuration);
      await db.setActiveRoadmap(user.id, res.id);
      setShowCreateModal(false);
      setRTitle('');
      setRDesc('');
      setRRole('');
      showToast('Roadmap created successfully!', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to create roadmap', 'error');
    }
  };

  // Create Section
  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoadmap || !secTitle.trim()) return;

    try {
      await db.createRoadmapSection(activeRoadmap.id, secTitle);
      setSecTitle('');
      setShowSectionModal(false);
      showToast('Section added', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add section', 'error');
    }
  };

  // Create Topic
  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoadmap || !targetSectionId || !topName.trim()) return;

    try {
      await db.createRoadmapTopic(
        targetSectionId,
        activeRoadmap.id,
        topName,
        topDesc,
        topDifficulty,
        topPriority,
        topEstHours
      );
      setTopName('');
      setTopDesc('');
      setShowTopicModal(false);
      showToast('Topic added to section', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add topic', 'error');
    }
  };

  // Open Topic Detail Modal / Drawer
  const handleOpenTopicDetail = async (topic: any) => {
    setSelectedTopic(topic);
    try {
      const [resList, checkList] = await Promise.all([
        db.getTopicResources(topic.id),
        db.getTopicChecklists(topic.id)
      ]);
      setTopicResources(resList);
      setTopicChecklists(checkList);
    } catch (err) {
      console.error('Failed to load topic details:', err);
    }
  };

  // Status Change Helpers
  const handleUpdateTopicStatus = async (topicId: number, status: string) => {
    try {
      await db.updateRoadmapTopic(topicId, { status });
      if (selectedTopic && selectedTopic.id === topicId) {
        setSelectedTopic({ ...selectedTopic, status });
      }
      showToast(`Topic marked as ${status}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update topic status', 'error');
    }
  };

  // Resource Management inside Topic Detail
  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTopic || !newResTitle.trim()) return;

    try {
      await db.addTopicResource(selectedTopic.id, newResTitle, newResUrl, newResType, newResDuration);
      setNewResTitle('');
      setNewResUrl('');
      setNewResDuration('');
      const updated = await db.getTopicResources(selectedTopic.id);
      setTopicResources(updated);
      showToast('Resource added', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add resource', 'error');
    }
  };

  const handleToggleResource = async (resId: number, currentCompleted: number) => {
    try {
      await db.updateTopicResource(resId, { completed: currentCompleted === 1 ? 0 : 1 });
      const updated = await db.getTopicResources(selectedTopic.id);
      setTopicResources(updated);
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update resource', 'error');
    }
  };

  const handleDeleteResource = async (resId: number) => {
    try {
      await db.deleteTopicResource(resId);
      const updated = await db.getTopicResources(selectedTopic.id);
      setTopicResources(updated);
      showToast('Resource removed', 'info');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete resource', 'error');
    }
  };

  // Checklist Management inside Topic Detail
  const handleAddChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTopic || !newCheckItem.trim()) return;

    try {
      await db.addTopicChecklist(selectedTopic.id, newCheckItem);
      setNewCheckItem('');
      const updated = await db.getTopicChecklists(selectedTopic.id);
      setTopicChecklists(updated);
      showToast('Checklist item added', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add checklist item', 'error');
    }
  };

  const handleToggleChecklist = async (checkId: number, currentCompleted: number) => {
    try {
      await db.toggleTopicChecklist(checkId, currentCompleted !== 1);
      const updated = await db.getTopicChecklists(selectedTopic.id);
      setTopicChecklists(updated);

      // Auto update topic status if all checklists completed
      const allDone = updated.length > 0 && updated.every((c: any) => c.completed === 1);
      if (allDone && selectedTopic.status !== 'completed') {
        await db.updateRoadmapTopic(selectedTopic.id, { status: 'completed' });
        setSelectedTopic({ ...selectedTopic, status: 'completed' });
        showToast('All checklist items completed! Topic marked as done.', 'success');
      }

      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to toggle checklist', 'error');
    }
  };

  const handleDeleteChecklist = async (checkId: number) => {
    try {
      await db.deleteTopicChecklist(checkId);
      const updated = await db.getTopicChecklists(selectedTopic.id);
      setTopicChecklists(updated);
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete item', 'error');
    }
  };

  // Schedule Revision
  const handleScheduleRevision = async (topicId: number, days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const dateStr = d.toISOString().split('T')[0];

    try {
      await db.scheduleTopicRevision(topicId, dateStr);
      if (selectedTopic && selectedTopic.id === topicId) {
        setSelectedTopic({ ...selectedTopic, next_revision_date: dateStr });
      }
      showToast(`Revision scheduled for ${dateStr}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to schedule revision', 'error');
    }
  };

  // Start Focus Session for topic
  const handleStartStudyTopic = (topic: any) => {
    setSelectedTopic(null);
    navigate('timer', { topicId: topic.id, subject: topic.name });
  };

  // Calculations for Overview Cards & Statistics
  const completedTopicsCount = topics.filter(t => t.status === 'completed').length;
  const inProgressTopicsCount = topics.filter(t => t.status === 'in progress').length;
  const totalTopicsCount = topics.length;
  const remainingTopicsCount = totalTopicsCount - completedTopicsCount;

  const totalEstHours = topics.reduce((sum, t) => sum + (t.estimated_hours || 0), 0);
  const totalCompHours = topics.reduce((sum, t) => sum + (t.completed_hours || 0), 0);
  const remainingHours = Math.max(0, totalEstHours - totalCompHours);

  const overallProgress = totalTopicsCount > 0
    ? Math.round((completedTopicsCount / totalTopicsCount) * 100)
    : 0;

  // Estimated Completion Date calculation based on 2 hrs/day average
  const calcEstCompletionDate = () => {
    if (remainingHours <= 0) return 'Completed!';
    const daysNeeded = Math.ceil(remainingHours / 2);
    const d = new Date();
    d.setDate(d.getDate() + daysNeeded);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Filter topics
  const getFilteredTopicsForSection = (sectionId: number) => {
    return topics.filter(t => {
      if (t.section_id !== sectionId) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = t.name.toLowerCase().includes(q);
        const matchDesc = (t.description || '').toLowerCase().includes(q);
        const matchNotes = (t.notes || '').toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchNotes) return false;
      }

      if (difficultyFilter !== 'all' && t.difficulty.toLowerCase() !== difficultyFilter.toLowerCase()) return false;
      if (statusFilter !== 'all' && t.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (priorityFilter !== 'all' && t.priority.toLowerCase() !== priorityFilter.toLowerCase()) return false;

      return true;
    });
  };

  // Render Section Breakdown Chart
  useEffect(() => {
    if (!chartRef.current || sections.length === 0) return;
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const labels = sections.map(s => s.title);
    const completedData = sections.map(s => {
      const secTops = topics.filter(t => t.section_id === s.id);
      return secTops.filter(t => t.status === 'completed').length;
    });
    const totalData = sections.map(s => {
      return topics.filter(t => t.section_id === s.id).length;
    });

    const ctx = chartRef.current.getContext('2d');
    if (ctx) {
      chartInstance.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Completed Topics',
              data: completedData,
              backgroundColor: 'rgba(16, 185, 129, 0.75)',
              borderColor: 'rgba(16, 185, 129, 1)',
              borderWidth: 1,
              borderRadius: 4
            },
            {
              label: 'Total Topics',
              data: totalData,
              backgroundColor: 'rgba(99, 102, 241, 0.35)',
              borderColor: 'rgba(99, 102, 241, 0.8)',
              borderWidth: 1,
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#94a3b8' } }
          },
          scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
          }
        }
      });
    }
  }, [sections, topics]);

  const toggleSectionCollapse = (secId: number) => {
    setCollapsedSections(prev => ({ ...prev, [secId]: !prev[secId] }));
  };

  const toggleExpandAll = () => {
    const allCollapsed = sections.every(s => collapsedSections[s.id]);
    const newState: Record<number, boolean> = {};
    sections.forEach(s => {
      newState[s.id] = !allCollapsed;
    });
    setCollapsedSections(newState);
  };

  return (
    <div className="roadmap-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Top Header Controls & Preset Selector */}
      <div className="glass-panel" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <LucideRoadmapIcon style={{ color: '#818cf8', width: '28px', height: '28px' }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Learning Roadmaps</h2>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Structured learning paths, collapsible topic trees, resources, checklists, and revision schedules.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Preset Generator Dropdown */}
          <div className="dropdown" style={{ position: 'relative' }}>
            <select
              className="btn btn-secondary"
              onChange={(e) => {
                if (e.target.value) {
                  db.seedPresetRoadmap(user.id, e.target.value as any).then(() => {
                    loadData();
                    showToast('Preset roadmap added!', 'success');
                  });
                  e.target.value = '';
                }
              }}
              style={{ backgroundColor: '#1e293b', color: '#f8fafc', borderColor: '#334155', cursor: 'pointer' }}
            >
              <option value="">+ Add Preset Roadmap...</option>
              <option value="ai">AI Engineer Curriculum</option>
              <option value="ds">Data Scientist Path</option>
              <option value="fs">Full Stack Developer</option>
              <option value="backend">Backend Developer</option>
              <option value="devops">DevOps Engineer</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <i className="fa-solid fa-plus" style={{ marginRight: '0.5rem' }}></i> Create Custom Roadmap
          </button>
        </div>
      </div>

      {/* Overview Metric Cards */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div className="stat-card glass-panel" style={{ borderLeft: '4px solid #6366f1' }}>
          <div className="stat-icon" style={{ color: '#818cf8', fontSize: '1.25rem' }}><i className="fa-solid fa-route"></i></div>
          <div className="stat-value" style={{ fontSize: '1.25rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeRoadmap ? activeRoadmap.title : 'None Selected'}
          </div>
          <div className="stat-label" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Active Roadmap</div>
        </div>

        <div className="stat-card glass-panel" style={{ borderLeft: '4px solid #10b981' }}>
          <div className="stat-icon" style={{ color: '#34d399', fontSize: '1.25rem' }}><i className="fa-solid fa-chart-line"></i></div>
          <div className="stat-value" style={{ fontSize: '1.5rem', fontWeight: 700 }}>{overallProgress}%</div>
          <div className="stat-label" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Overall Progress</div>
        </div>

        <div className="stat-card glass-panel" style={{ borderLeft: '4px solid #3b82f6' }}>
          <div className="stat-icon" style={{ color: '#60a5fa', fontSize: '1.25rem' }}><i className="fa-solid fa-circle-check"></i></div>
          <div className="stat-value" style={{ fontSize: '1.5rem', fontWeight: 700 }}>{completedTopicsCount} / {totalTopicsCount}</div>
          <div className="stat-label" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Completed Topics</div>
        </div>

        <div className="stat-card glass-panel" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="stat-icon" style={{ color: '#fbbf24', fontSize: '1.25rem' }}><i className="fa-solid fa-hourglass-half"></i></div>
          <div className="stat-value" style={{ fontSize: '1.5rem', fontWeight: 700 }}>{remainingTopicsCount}</div>
          <div className="stat-label" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Remaining Topics</div>
        </div>

        <div className="stat-card glass-panel" style={{ borderLeft: '4px solid #ec4899' }}>
          <div className="stat-icon" style={{ color: '#f472b6', fontSize: '1.25rem' }}><i className="fa-solid fa-clock"></i></div>
          <div className="stat-value" style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totalCompHours.toFixed(1)} / {totalEstHours}h</div>
          <div className="stat-label" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Study Hours</div>
        </div>

        <div className="stat-card glass-panel" style={{ borderLeft: '4px solid #a855f7' }}>
          <div className="stat-icon" style={{ color: '#c084fc', fontSize: '1.25rem' }}><i className="fa-solid fa-calendar-check"></i></div>
          <div className="stat-value" style={{ fontSize: '1.1rem', fontWeight: 600 }}>{calcEstCompletionDate()}</div>
          <div className="stat-label" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Est. Completion</div>
        </div>
      </div>

      {/* Roadmaps Switcher Cards */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>My Roadmaps</h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {roadmaps.map((r: any) => {
            const isActive = activeRoadmap && activeRoadmap.id === r.id;
            return (
              <div
                key={r.id}
                onClick={() => handleSelectRoadmap(r.id)}
                className={`card-hover ${isActive ? 'active-roadmap-card' : ''}`}
                style={{
                  padding: '1rem',
                  borderRadius: '12px',
                  background: isActive ? 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(168,85,247,0.15) 100%)' : 'rgba(30,41,59,0.5)',
                  border: isActive ? '1.5px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span className="badge" style={{ backgroundColor: r.difficulty === 'Advanced' ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)', color: r.difficulty === 'Advanced' ? '#f87171' : '#60a5fa', border: 'none', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                    {r.difficulty || 'Intermediate'}
                  </span>
                  {isActive && (
                    <span className="badge" style={{ backgroundColor: 'rgba(16,185,129,0.2)', color: '#34d399', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                      <i className="fa-solid fa-check-circle" style={{ marginRight: '4px' }}></i> Active
                    </span>
                  )}
                </div>

                <h4 style={{ margin: '0.5rem 0 0.25rem 0', fontSize: '1.1rem', fontWeight: 600 }}>{r.title}</h4>
                <p style={{ color: '#94a3b8', fontSize: '0.825rem', margin: 0, height: '2.4em', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {r.description || 'Custom learning roadmap'}
                </p>

                <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#cbd5e1' }}>
                  <span><i className="fa-solid fa-clock" style={{ marginRight: '4px' }}></i> {r.duration || '12 weeks'}</span>
                  <span><i className="fa-solid fa-user-gear" style={{ marginRight: '4px' }}></i> {r.target_role || 'Tech'}</span>
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete roadmap "${r.title}"?`)) {
                      db.deleteRoadmap(r.id).then(() => {
                        showToast('Roadmap deleted', 'info');
                        loadData();
                      });
                    }
                  }}
                  style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
                  title="Delete Roadmap"
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      {activeRoadmap && (
        <div className="glass-panel" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '240px' }}>
            <div className="search-box" style={{ flex: 1, position: 'relative' }}>
              <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}></i>
              <input
                type="text"
                placeholder="Search topics, resources or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', paddingLeft: '36px', height: '38px', borderRadius: '8px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Filters */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ height: '38px', padding: '0 8px', borderRadius: '8px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="all">Status: All</option>
              <option value="not started">Not Started</option>
              <option value="in progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>

            <select
              value={difficultyFilter}
              onChange={(e) => setDifficultyFilter(e.target.value)}
              style={{ height: '38px', padding: '0 8px', borderRadius: '8px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="all">Difficulty: All</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              style={{ height: '38px', padding: '0 8px', borderRadius: '8px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="all">Priority: All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <button className="btn btn-secondary" onClick={toggleExpandAll} title="Expand / Collapse Tree">
              <i className="fa-solid fa-arrows-up-down" style={{ marginRight: '4px' }}></i> Toggle Tree
            </button>

            <button className="btn btn-primary" onClick={() => setShowSectionModal(true)}>
              <i className="fa-solid fa-folder-plus" style={{ marginRight: '4px' }}></i> Add Section
            </button>
          </div>
        </div>
      )}

      {/* Main Roadmap Tree Detail View */}
      {activeRoadmap && (
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
              {activeRoadmap.title} Curriculum Tree
            </h3>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
              {sections.length} Sections • {topics.length} Topics
            </span>
          </div>

          {sections.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              <i className="fa-solid fa-folder-open" style={{ fontSize: '2.5rem', marginBottom: '0.75rem', color: '#475569' }}></i>
              <p>No sections added yet. Click <strong>Add Section</strong> to start building your roadmap.</p>
            </div>
          ) : (
            <div className="tree-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {sections.map((sec: any) => {
                const secTopics = getFilteredTopicsForSection(sec.id);
                const isCollapsed = collapsedSections[sec.id];
                const secCompleted = secTopics.filter(t => t.status === 'completed').length;
                const secProgress = secTopics.length > 0 ? Math.round((secCompleted / secTopics.length) * 100) : 0;

                return (
                  <div
                    key={sec.id}
                    className="section-node"
                    style={{
                      borderRadius: '10px',
                      backgroundColor: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Section Header */}
                    <div
                      onClick={() => toggleSectionCollapse(sec.id)}
                      style={{
                        padding: '0.75rem 1rem',
                        backgroundColor: 'rgba(30, 41, 59, 0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <i className={`fa-solid fa-chevron-${isCollapsed ? 'right' : 'down'}`} style={{ color: '#818cf8', width: '16px' }}></i>
                        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f8fafc' }}>
                          ▼ {sec.title}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px' }}>
                          {secTopics.length} topics
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: '120px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ flex: 1, height: '6px', backgroundColor: '#334155', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${secProgress}%`, height: '100%', backgroundColor: '#10b981' }}></div>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8', minWidth: '28px' }}>{secProgress}%</span>
                        </div>

                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTargetSectionId(sec.id);
                            setShowTopicModal(true);
                          }}
                          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                          title="Add topic to this section"
                        >
                          <i className="fa-solid fa-plus"></i> Topic
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete section "${sec.title}" and all its topics?`)) {
                              db.deleteRoadmapSection(sec.id).then(() => {
                                showToast('Section deleted', 'info');
                                loadData();
                              });
                            }
                          }}
                          style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
                          title="Delete section"
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </div>

                    {/* Section Topics Tree */}
                    {!isCollapsed && (
                      <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {secTopics.length === 0 ? (
                          <div style={{ padding: '0.75rem', color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic' }}>
                            No topics match filters in this section.
                          </div>
                        ) : (
                          secTopics.map((top: any) => {
                            const isDone = top.status === 'completed';
                            const isInProg = top.status === 'in progress';

                            return (
                              <div
                                key={top.id}
                                className="topic-card-row"
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '0.65rem 1rem',
                                  borderRadius: '8px',
                                  backgroundColor: isDone ? 'rgba(16,185,129,0.06)' : isInProg ? 'rgba(99,102,241,0.08)' : 'rgba(30,41,59,0.4)',
                                  borderLeft: isDone ? '3px solid #10b981' : isInProg ? '3px solid #6366f1' : '3px solid #64748b',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {/* Left Side: Checkbox & Name */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '220px' }}>
                                  <button
                                    onClick={() => handleUpdateTopicStatus(top.id, isDone ? 'not started' : 'completed')}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: isDone ? '#10b981' : '#64748b',
                                      fontSize: '1.1rem',
                                      cursor: 'pointer'
                                    }}
                                    title={isDone ? 'Mark Incomplete' : 'Mark Complete'}
                                  >
                                    <i className={`fa-${isDone ? 'solid' : 'regular'} fa-circle-check`}></i>
                                  </button>

                                  <div style={{ cursor: 'pointer' }} onClick={() => handleOpenTopicDetail(top)}>
                                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: isDone ? '#a7f3d0' : '#f8fafc', textDecoration: isDone ? 'line-through' : 'none' }}>
                                      {top.name}
                                    </span>
                                    {top.description && (
                                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>{top.description}</p>
                                    )}
                                  </div>
                                </div>

                                {/* Metadata Pills & Linked items */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                  {top.resource_count > 0 && (
                                    <span style={{ fontSize: '0.75rem', color: '#93c5fd', background: 'rgba(59,130,246,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                                      <i className="fa-solid fa-link" style={{ marginRight: '3px' }}></i>
                                      {top.completed_resource_count}/{top.resource_count}
                                    </span>
                                  )}

                                  {top.checklist_count > 0 && (
                                    <span style={{ fontSize: '0.75rem', color: '#fde047', background: 'rgba(234,179,8,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                                      <i className="fa-solid fa-list-check" style={{ marginRight: '3px' }}></i>
                                      {top.completed_checklist_count}/{top.checklist_count}
                                    </span>
                                  )}

                                  {top.linked_project_name && (
                                    <span
                                      onClick={() => navigate('projects')}
                                      style={{ fontSize: '0.75rem', color: '#c084fc', background: 'rgba(168,85,247,0.15)', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}
                                      title="Open linked project"
                                    >
                                      <i className="fa-solid fa-diagram-project" style={{ marginRight: '3px' }}></i>
                                      {top.linked_project_name}
                                    </span>
                                  )}

                                  {top.linked_note_title && (
                                    <span
                                      onClick={() => navigate('notes')}
                                      style={{ fontSize: '0.75rem', color: '#38bdf8', background: 'rgba(56,189,248,0.15)', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}
                                      title="Open linked note"
                                    >
                                      <i className="fa-solid fa-book-open" style={{ marginRight: '3px' }}></i>
                                      {top.linked_note_title}
                                    </span>
                                  )}

                                  <span style={{ fontSize: '0.75rem', color: '#cbd5e1', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>
                                    {top.completed_hours}/{top.estimated_hours}h
                                  </span>

                                  {/* Quick Action buttons */}
                                  <button
                                    className="btn btn-secondary"
                                    onClick={() => handleStartStudyTopic(top)}
                                    style={{ padding: '3px 8px', fontSize: '0.75rem', backgroundColor: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: 'none' }}
                                    title="Start Focus Session"
                                  >
                                    <i className="fa-solid fa-stopwatch" style={{ marginRight: '3px' }}></i> Focus
                                  </button>

                                  <button
                                    onClick={() => handleOpenTopicDetail(top)}
                                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                                    title="View & Edit Details"
                                  >
                                    <i className="fa-solid fa-pen-to-square"></i>
                                  </button>

                                  <button
                                    onClick={() => {
                                      if (window.confirm(`Delete topic "${top.name}"?`)) {
                                        db.deleteRoadmapTopic(top.id).then(() => {
                                          showToast('Topic deleted', 'info');
                                          loadData();
                                        });
                                      }
                                    }}
                                    style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
                                    title="Delete topic"
                                  >
                                    <i className="fa-solid fa-trash"></i>
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Analytics & Section Statistics Chart */}
      {activeRoadmap && sections.length > 0 && (
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Section Progress Breakdown</h3>
          <div style={{ height: '220px', width: '100%' }}>
            <canvas ref={chartRef}></canvas>
          </div>
        </div>
      )}

      {/* Topic Details Modal / Drawer */}
      {selectedTopic && (
        <div className="modal active" style={{ display: 'flex' }}>
          <div className="modal-content glassmorphism" style={{ maxWidth: '750px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge" style={{ backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>
                  {selectedTopic.difficulty}
                </span>
                <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{selectedTopic.name}</h2>
              </div>
              <button className="modal-close" onClick={() => setSelectedTopic(null)}>&times;</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
              
              {/* Actions Toolbar */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', backgroundColor: 'rgba(15,23,42,0.6)', padding: '0.75rem', borderRadius: '8px' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleStartStudyTopic(selectedTopic)}
                  style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                >
                  <i className="fa-solid fa-stopwatch" style={{ marginRight: '4px' }}></i> Start Focus Session
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => handleUpdateTopicStatus(selectedTopic.id, selectedTopic.status === 'completed' ? 'in progress' : 'completed')}
                  style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                >
                  <i className={`fa-solid ${selectedTopic.status === 'completed' ? 'fa-rotate-left' : 'fa-check'}`} style={{ marginRight: '4px' }}></i>
                  {selectedTopic.status === 'completed' ? 'Mark In Progress' : 'Mark Complete'}
                </button>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Revision:</span>
                  <button className="btn btn-secondary" onClick={() => handleScheduleRevision(selectedTopic.id, 1)} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>+1 Day</button>
                  <button className="btn btn-secondary" onClick={() => handleScheduleRevision(selectedTopic.id, 3)} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>+3 Days</button>
                  <button className="btn btn-secondary" onClick={() => handleScheduleRevision(selectedTopic.id, 7)} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>+1 Week</button>
                </div>
              </div>

              {/* Topic Description & Notes */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Description</label>
                  <textarea
                    value={selectedTopic.description || ''}
                    onChange={(e) => setSelectedTopic({ ...selectedTopic, description: e.target.value })}
                    onBlur={() => db.updateRoadmapTopic(selectedTopic.id, { description: selectedTopic.description })}
                    style={{ width: '100%', height: '70px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #334155', padding: '6px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Topic Notes</label>
                  <textarea
                    placeholder="Add personal notes or quick summary..."
                    value={selectedTopic.notes || ''}
                    onChange={(e) => setSelectedTopic({ ...selectedTopic, notes: e.target.value })}
                    onBlur={() => db.updateRoadmapTopic(selectedTopic.id, { notes: selectedTopic.notes })}
                    style={{ width: '100%', height: '70px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #334155', padding: '6px' }}
                  />
                </div>
              </div>

              {/* Project & Notes Integrations */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', backgroundColor: 'rgba(30,41,59,0.3)', padding: '0.75rem', borderRadius: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                    <i className="fa-solid fa-diagram-project" style={{ marginRight: '4px' }}></i> Linked Project
                  </label>
                  <select
                    value={selectedTopic.linked_project_id || ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      db.updateRoadmapTopic(selectedTopic.id, { linked_project_id: val }).then(() => {
                        setSelectedTopic({ ...selectedTopic, linked_project_id: val });
                        loadData();
                      });
                    }}
                    style={{ width: '100%', height: '34px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #334155' }}
                  >
                    <option value="">None (Select Project)</option>
                    {projectsList.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                    <i className="fa-solid fa-book-open" style={{ marginRight: '4px' }}></i> Linked Note
                  </label>
                  <select
                    value={selectedTopic.linked_note_id || ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      db.updateRoadmapTopic(selectedTopic.id, { linked_note_id: val }).then(() => {
                        setSelectedTopic({ ...selectedTopic, linked_note_id: val });
                        loadData();
                      });
                    }}
                    style={{ width: '100%', height: '34px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #334155' }}
                  >
                    <option value="">None (Select Note)</option>
                    {notesList.map((n: any) => (
                      <option key={n.id} value={n.id}>{n.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Topic Checklist Section */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>Topic Checklist</h4>
                <form onSubmit={handleAddChecklist} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    placeholder="Add subtopic or checklist item (e.g. Attention, BERT, GPT)..."
                    value={newCheckItem}
                    onChange={(e) => setNewCheckItem(e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff' }}
                  />
                  <button type="submit" className="btn btn-secondary" style={{ padding: '6px 12px' }}>Add</button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '160px', overflowY: 'auto' }}>
                  {topicChecklists.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No checklist items yet.</span>
                  ) : (
                    topicChecklists.map((c: any) => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: '6px', backgroundColor: 'rgba(15,23,42,0.5)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: c.completed ? '#94a3b8' : '#f8fafc', textDecoration: c.completed ? 'line-through' : 'none' }}>
                          <input
                            type="checkbox"
                            checked={c.completed === 1}
                            onChange={() => handleToggleChecklist(c.id, c.completed)}
                          />
                          {c.title}
                        </label>
                        <button onClick={() => handleDeleteChecklist(c.id)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Learning Resources Section */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>Learning Resources</h4>
                <form onSubmit={handleAddResource} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    placeholder="Title (e.g. Paper / Tutorial)"
                    value={newResTitle}
                    onChange={(e) => setNewResTitle(e.target.value)}
                    style={{ padding: '6px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: '0.85rem' }}
                    required
                  />
                  <input
                    type="url"
                    placeholder="URL (https://...)"
                    value={newResUrl}
                    onChange={(e) => setNewResUrl(e.target.value)}
                    style={{ padding: '6px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <select
                    value={newResType}
                    onChange={(e) => setNewResType(e.target.value)}
                    style={{ padding: '6px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: '0.85rem' }}
                  >
                    <option value="Documentation">Docs</option>
                    <option value="YouTube">YouTube</option>
                    <option value="Course">Course</option>
                    <option value="GitHub">GitHub</option>
                    <option value="Blog">Blog</option>
                    <option value="PDF">PDF</option>
                    <option value="Book">Book</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Duration"
                    value={newResDuration}
                    onChange={(e) => setNewResDuration(e.target.value)}
                    style={{ padding: '6px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <button type="submit" className="btn btn-secondary" style={{ padding: '6px 12px' }}>Add</button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '160px', overflowY: 'auto' }}>
                  {topicResources.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No resources added yet.</span>
                  ) : (
                    topicResources.map((r: any) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: '6px', backgroundColor: 'rgba(15,23,42,0.5)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={r.completed === 1}
                            onChange={() => handleToggleResource(r.id, r.completed)}
                          />
                          <span className="badge" style={{ backgroundColor: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontSize: '0.7rem' }}>
                            {r.type}
                          </span>
                          <span style={{ fontSize: '0.875rem', textDecoration: r.completed ? 'line-through' : 'none', color: r.completed ? '#94a3b8' : '#fff' }}>
                            {r.title}
                          </span>
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#818cf8', fontSize: '0.8rem', marginLeft: '4px' }}>
                              <i className="fa-solid fa-arrow-up-right-from-square"></i>
                            </a>
                          )}
                        </div>

                        <button onClick={() => handleDeleteResource(r.id)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Custom Roadmap */}
      {showCreateModal && (
        <div className="modal active" style={{ display: 'flex' }}>
          <div className="modal-content glassmorphism">
            <div className="modal-header">
              <h2>Create Custom Roadmap</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateRoadmap} className="modal-form">
              <div className="form-group">
                <label>Roadmap Title</label>
                <input type="text" placeholder="e.g. AI Engineer / System Architect" value={rTitle} onChange={(e) => setRTitle(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea placeholder="Describe the goal of this roadmap..." value={rDesc} onChange={(e) => setRDesc(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Target Role</label>
                <input type="text" placeholder="e.g. LLM Developer / Backend Engineer" value={rRole} onChange={(e) => setRRole(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Difficulty</label>
                <select value={rDifficulty} onChange={(e) => setRDifficulty(e.target.value)}>
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                  <option value="Expert">Expert</option>
                </select>
              </div>
              <div className="form-group">
                <label>Est. Duration</label>
                <input type="text" placeholder="e.g. 12 weeks / 6 months" value={rDuration} onChange={(e) => setRDuration(e.target.value)} />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">Create Roadmap</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Section */}
      {showSectionModal && (
        <div className="modal active" style={{ display: 'flex' }}>
          <div className="modal-content glassmorphism">
            <div className="modal-header">
              <h2>Add Roadmap Section</h2>
              <button className="modal-close" onClick={() => setShowSectionModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateSection} className="modal-form">
              <div className="form-group">
                <label>Section Title</label>
                <input type="text" placeholder="e.g. Machine Learning / Transformers / Docker" value={secTitle} onChange={(e) => setSecTitle(e.target.value)} required />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">Add Section</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Topic */}
      {showTopicModal && (
        <div className="modal active" style={{ display: 'flex' }}>
          <div className="modal-content glassmorphism">
            <div className="modal-header">
              <h2>Add Topic</h2>
              <button className="modal-close" onClick={() => setShowTopicModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateTopic} className="modal-form">
              <div className="form-group">
                <label>Topic Name</label>
                <input type="text" placeholder="e.g. Attention / Neural Networks" value={topName} onChange={(e) => setTopName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea placeholder="Topic summary or objectives..." value={topDesc} onChange={(e) => setTopDesc(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Difficulty</label>
                <select value={topDifficulty} onChange={(e) => setTopDifficulty(e.target.value)}>
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </select>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select value={topPriority} onChange={(e) => setTopPriority(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="form-group">
                <label>Estimated Hours</label>
                <input type="number" min="0.5" step="0.5" value={topEstHours} onChange={(e) => setTopEstHours(parseFloat(e.target.value))} required />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">Add Topic</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
