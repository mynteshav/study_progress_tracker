import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../App';

interface ProjectsProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Projects({ user, showToast }: ProjectsProps) {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Project Modal form states
  const [showProjModal, setShowProjModal] = useState<boolean>(false);
  const [projId, setProjId] = useState<number | null>(null);
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [status, setStatus] = useState<string>('planning');
  const [startDate, setStartDate] = useState<string>('');
  const [targetDate, setTargetDate] = useState<string>('');

  // Subtask Modal states
  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  const [activeProjId, setActiveProjId] = useState<number | null>(null);
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [taskDue, setTaskDue] = useState<string>('');

  const loadProjects = async (silent: boolean = false) => {
    if (!silent && projects.length === 0) {
      setLoading(true);
    }
    try {
      const data = await db.getProjects(user.id);
      setProjects(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
    let unsubSync: (() => void) | null = null;
    import('../services/SyncService').then(({ SyncService }) => {
      unsubSync = SyncService.subscribeDataChange((entity) => {
        if (entity === 'all' || entity.startsWith('project')) {
          loadProjects(true);
        }
      });
    }).catch(console.error);

    return () => {
      if (unsubSync) unsubSync();
    };
  }, [user]);

  const handleOpenProjModal = (p: any = null) => {
    if (p) {
      setProjId(p.id);
      setName(p.name);
      setDescription(p.description || '');
      setStatus(p.status);
      setStartDate(p.start_date || '');
      setTargetDate(p.target_date || '');
    } else {
      setProjId(null);
      setName('');
      setDescription('');
      setStatus('planning');
      setStartDate('');
      setTargetDate('');
    }
    setShowProjModal(true);
  };

  const handleCloseProjModal = () => {
    setShowProjModal(false);
  };

  const handleProjSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      showToast('Project name is required', 'error');
      return;
    }

    if (startDate && targetDate && startDate > targetDate) {
      showToast('Start date must be on or before target date', 'error');
      return;
    }

    const payload = { name, description, status, start_date: startDate, target_date: targetDate };
    try {
      if (projId) {
        await db.updateProject(projId, payload);
        showToast('Project updated successfully', 'success');
      } else {
        await db.addProject(user.id, payload);
        showToast('Project created successfully', 'success');
      }
      handleCloseProjModal();
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Failed to save project', 'error');
    }
  };

  const handleDeleteProj = async (id: number) => {
    if (confirm('Are you sure you want to delete this project and all its subtasks?')) {
      try {
        await db.deleteProject(id);
        showToast('Project deleted successfully', 'success');
        loadProjects();
      } catch (err: any) {
        showToast(err.message || 'Failed to delete project', 'error');
      }
    }
  };

  const handleOpenTaskModal = (pId: number) => {
    setActiveProjId(pId);
    setTaskTitle('');
    setTaskDue('');
    setShowTaskModal(true);
  };

  const handleCloseTaskModal = () => {
    setShowTaskModal(false);
  };

  const handleTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjId || !taskTitle) {
      showToast('Task title is required', 'error');
      return;
    }

    try {
      await db.addProjectTask(activeProjId, taskTitle, taskDue);
      showToast('Task added successfully', 'success');
      handleCloseTaskModal();
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Failed to add task', 'error');
    }
  };

  const handleToggleTask = async (taskId: number, currentDone: number) => {
    try {
      await db.updateProjectTask(taskId, { done: currentDone === 0 });
      showToast(currentDone === 0 ? 'Task completed!' : 'Task active', 'success');
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Failed to update task status', 'error');
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await db.deleteProjectTask(taskId);
      showToast('Task removed', 'success');
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete task', 'error');
    }
  };

  return (
    <div>
      <div className="topics-header">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Long-term Projects</h2>
        <button className="btn btn-primary" onClick={() => handleOpenProjModal()}>
          <i className="fa-solid fa-plus"></i> New Project
        </button>
      </div>

      <div className="projects-grid">
        {loading ? (
          <div className="loader-container" style={{ gridColumn: '1 / -1' }}><div className="spinner"></div></div>
        ) : projects.length === 0 ? (
          <div className="glass-panel" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: '48px' }}>
            <i className="fa-solid fa-diagram-project" style={{ fontSize: '3rem', marginBottom: '12px', display: 'block' }}></i>
            No projects tracked yet. Click "New Project" to define long-term goals!
          </div>
        ) : (
          projects.map((proj) => {
            const totalTasks = proj.tasks.length;
            const completedTasks = proj.tasks.filter((t: any) => t.done === 1).length;
            const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            
            let statusIcon = 'fa-clock';
            let statusClass = 'badge-low';
            if (proj.status === 'active') { statusIcon = 'fa-bolt'; statusClass = 'status-solved'; }
            else if (proj.status === 'completed') { statusIcon = 'fa-check'; statusClass = 'status-solved'; }
            else if (proj.status === 'paused') { statusIcon = 'fa-pause'; statusClass = 'badge-med'; }

            return (
              <div key={proj.id} className="project-card-full glass-panel">
                <div className="project-header">
                  <div>
                    <span className={`badge ${statusClass}`} style={{ textTransform: 'capitalize', marginBottom: '6px' }}>
                      <i className={`fa-solid ${statusIcon}`}></i> {proj.status}
                    </span>
                    <h3 className="project-name">{proj.name}</h3>
                  </div>
                  
                  <div className="topic-actions">
                    <button className="topic-action-btn" onClick={() => handleOpenProjModal(proj)} title="Edit Project">
                      <i className="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button className="topic-action-btn delete" onClick={() => handleDeleteProj(proj.id)} title="Delete Project">
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </div>

                <p className="project-desc">{proj.description || 'No description provided.'}</p>
                
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '16px' }}>
                  <span><i className="fa-regular fa-calendar-check"></i> Starts: {proj.start_date || 'N/A'}</span>
                  <span><i className="fa-regular fa-calendar-xmark"></i> Target: {proj.target_date || 'N/A'}</span>
                </div>

                {/* Progress bar */}
                <div className="project-prog-bar-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    <span>Subtasks: {completedTasks}/{totalTasks} done</span>
                    <span>{progress}% Complete</span>
                  </div>
                  <div className="prog-bar-track">
                    <div className="prog-bar-fill" style={{ width: `${progress}%` }}></div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-glow)', paddingTop: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Milestone Checklist</span>
                    <button className="btn btn-secondary" onClick={() => handleOpenTaskModal(proj.id)} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>
                      <i className="fa-solid fa-plus"></i> Task
                    </button>
                  </div>

                  <div className="project-tasks-list">
                    {totalTasks > 0 ? (
                      proj.tasks.map((task: any) => (
                        <div key={task.id} className={`project-task-item ${task.done === 1 ? 'done' : ''}`}>
                          <div className="project-task-left" onClick={() => handleToggleTask(task.id, task.done)} style={{ cursor: 'pointer' }}>
                            <i className={`fa-regular ${task.done === 1 ? 'fa-square-check' : 'fa-square'} project-task-check ${task.done === 1 ? 'checked' : ''}`}></i>
                            <span className="project-task-title">{task.title}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {task.due_date && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}><i className="fa-regular fa-calendar"></i> {task.due_date}</span>}
                            <button className="topic-action-btn" onClick={() => handleDeleteTask(task.id)} style={{ padding: '2px 4px', fontSize: '0.75rem' }}>
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="upcoming-empty" style={{ padding: '10px 0' }}>No tasks defined.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Project Modal */}
      <div className={`modal ${showProjModal ? 'active' : ''}`}>
        <div className="modal-content glassmorphism">
          <div className="modal-header">
            <h2>{projId ? 'Edit Project details' : 'Create Project'}</h2>
            <button className="modal-close" onClick={handleCloseProjModal}>&times;</button>
          </div>
          <form className="modal-form" onSubmit={handleProjSubmit}>
            <div className="form-group">
              <label htmlFor="p-name-input">Project Name</label>
              <input
                type="text"
                id="p-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Compiler Design"
                required
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Tip: Track study allocation by using this exact name in Focus Timer subjects!
              </p>
            </div>
            <div className="form-group">
              <label htmlFor="p-desc">Description</label>
              <textarea
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Brief summary of project goals..."
              />
            </div>
            <div className="form-group">
              <label htmlFor="p-status">Status</label>
              <select id="p-status" value={status} onChange={(e) => setStatus(e.target.value)} required>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div className="grid-2" style={{ gap: '12px' }}>
              <div className="form-group">
                <label htmlFor="p-start">Start Date</label>
                <input type="date" id="p-start" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="p-target">Target End Date</label>
                <input type="date" id="p-target" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCloseProjModal}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Project</button>
            </div>
          </form>
        </div>
      </div>

      {/* Add Subtask Modal */}
      <div className={`modal ${showTaskModal ? 'active' : ''}`}>
        <div className="modal-content glassmorphism">
          <div className="modal-header">
            <h2>Add Project Task</h2>
            <button className="modal-close" onClick={handleCloseTaskModal}>&times;</button>
          </div>
          <form className="modal-form" onSubmit={handleTaskSubmit}>
            <div className="form-group">
              <label htmlFor="task-title">Task Title</label>
              <input
                type="text"
                id="task-title"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g. Implement syntax parser"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="task-due">Due Date</label>
              <input type="date" id="task-due" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCloseTaskModal}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Task</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Projects;
