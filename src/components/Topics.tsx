import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../App';

interface TopicsProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Topics({ user, showToast }: TopicsProps) {
  const getLocalDateStr = (d: Date = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${r}`;
  };

  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr());
  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [showModal, setShowModal] = useState<boolean>(false);

  // Form states
  const [topicId, setTopicId] = useState<number | null>(null);
  const [title, setTitle] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [estMinutes, setEstMinutes] = useState<number>(45);
  const [priority, setPriority] = useState<string>('med');
  const [status, setStatus] = useState<string>('not started');

  // Drag-and-drop state tracker
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const loadTopics = async (silent: boolean = false) => {
    if (!silent && topics.length === 0) {
      setLoading(true);
    }
    try {
      const data = await db.getTopics(user.id, selectedDate);
      setTopics(data);
    } catch (err: any) {
      showToast(err.message || 'Failed to load topics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopics();
    let unsubSync: (() => void) | null = null;
    import('../services/SyncService').then(({ SyncService }) => {
      unsubSync = SyncService.subscribeDataChange((entity) => {
        if (entity === 'all' || entity === 'topics' || entity === 'tasks') {
          loadTopics(true);
        }
      });
    }).catch(console.error);

    return () => {
      if (unsubSync) unsubSync();
    };
  }, [selectedDate, user]);

  const handleOpenModal = (topic: any = null) => {
    if (topic) {
      setTopicId(topic.id);
      setTitle(topic.title);
      setSubject(topic.subject);
      setEstMinutes(topic.est_minutes);
      setPriority(topic.priority);
      setStatus(topic.status);
    } else {
      setTopicId(null);
      setTitle('');
      setSubject('');
      setEstMinutes(45);
      setPriority('med');
      setStatus('not started');
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !subject) {
      showToast('Title and subject are required', 'error');
      return;
    }

    try {
      if (topicId) {
        await db.updateTopic(topicId, { title, subject, est_minutes: estMinutes, priority, status });
        showToast('Topic updated successfully', 'success');
      } else {
        await db.addTopic(user.id, selectedDate, title, subject, estMinutes, priority, status);
        showToast('Topic added successfully', 'success');
      }
      handleCloseModal();
      loadTopics();
    } catch (err: any) {
      showToast(err.message || 'Failed to save topic', 'error');
    }
  };

  const handleToggleStatus = async (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'done' ? 'not started' : 'done';
    try {
      await db.updateTopic(id, { status: nextStatus });
      showToast(`Topic marked as ${nextStatus}`, 'success');
      loadTopics();
    } catch (err: any) {
      showToast(err.message || 'Failed to update topic status', 'error');
    }
  };

  const handleDeleteTopic = async (id: number) => {
    if (confirm('Are you sure you want to delete this topic?')) {
      try {
        await db.deleteTopic(id);
        showToast('Topic deleted successfully', 'success');
        loadTopics();
      } catch (err: any) {
        showToast(err.message || 'Failed to delete topic', 'error');
      }
    }
  };

  const handleCarryOver = async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateStr(yesterday);
    
    try {
      const ids = await db.carryOverTopics(user.id, yesterdayStr, selectedDate);
      showToast(`Successfully carried over ${ids.length} topics.`, 'success');
      loadTopics();
    } catch (err: any) {
      showToast(err.message || 'Failed to carry-over topics', 'error');
    }
  };

  // HTML5 Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    // Swap indexes locally
    const reordered = [...topics];
    const item = reordered[draggedIndex];
    reordered.splice(draggedIndex, 1);
    reordered.splice(index, 0, item);
    
    setDraggedIndex(index);
    setTopics(reordered);
  };

  const handleDragEnd = async () => {
    setDraggedIndex(null);
    const reorderedIds = topics.map(t => t.id);
    try {
      await db.reorderTopics(user.id, reorderedIds, selectedDate);
      showToast('Topics order saved', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save reordered topics', 'error');
    }
  };

  const completedCount = topics.filter(t => t.status === 'done').length;

  return (
    <div>
      <div className="topics-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <label htmlFor="topics-date-picker" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Date:</label>
          <input
            type="date"
            id="topics-date-picker"
            className="filter-select"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={handleCarryOver}>
            <i className="fa-solid fa-person-walking-arrow-right"></i> Carry Over Incomplete
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
          <i className="fa-solid fa-plus"></i> Add Topic
        </button>
      </div>

      <div className="glass-panel">
        <div className="dashboard-title">
          <span>Topic Checklist</span>
          <span style={{ fontWeight: 'normal', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {completedCount}/{topics.length} Completed
          </span>
        </div>
        
        <div className="topics-list">
          {loading ? (
            <div className="loader-container"><div className="spinner"></div></div>
          ) : topics.length === 0 ? (
            <div className="empty-topics">
              <i className="fa-regular fa-clipboard" style={{ fontSize: '2.5rem', marginBottom: '12px', display: 'block' }}></i>
              No topics scheduled for this date. Create one to begin tracking!
            </div>
          ) : (
            topics.map((topic, index) => (
              <div
                key={topic.id}
                className={`topic-item ${topic.status === 'done' ? 'completed' : ''} ${draggedIndex === index ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                data-id={topic.id}
              >
                <div
                  className={`topic-checkbox ${topic.status === 'done' ? 'checked' : ''}`}
                  onClick={() => handleToggleStatus(topic.id, topic.status)}
                >
                  <i className="fa-solid fa-check"></i>
                </div>

                <div className="topic-body">
                  <div className="topic-title-row">
                    <span className="topic-title">{topic.title}</span>
                    <span className="badge badge-subject">{topic.subject}</span>
                    {topic.carried_over_from && <span className="badge badge-carried">Carried Over</span>}
                  </div>
                  <div className="topic-meta">
                    <span><i className="fa-regular fa-clock"></i> {topic.est_minutes} min</span>
                    <span className={`badge ${topic.priority === 'high' ? 'badge-high' : topic.priority === 'low' ? 'badge-low' : 'badge-med'}`}>
                      {topic.priority}
                    </span>
                    <span style={{ textTransform: 'capitalize' }}><i className="fa-solid fa-spinner"></i> {topic.status}</span>
                  </div>
                </div>

                <div className="topic-actions">
                  <button className="topic-action-btn" onClick={() => handleOpenModal(topic)} title="Edit Topic">
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button className="topic-action-btn delete" onClick={() => handleDeleteTopic(topic.id)} title="Delete Topic">
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add/Edit Topic Modal */}
      <div className={`modal ${showModal ? 'active' : ''}`}>
        <div className="modal-content glassmorphism">
          <div className="modal-header">
            <h2>{topicId ? 'Edit Study Topic' : 'Add Study Topic'}</h2>
            <button className="modal-close" onClick={handleCloseModal}>&times;</button>
          </div>
          <form className="modal-form" onSubmit={handleFormSubmit}>
            <div className="form-group">
              <label htmlFor="t-title">Topic Title</label>
              <input
                type="text"
                id="t-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Implement Dijkstra's Algorithm"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="t-subject">Subject/Tag</label>
              <input
                type="text"
                id="t-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Algorithms"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="t-est">Estimated Duration (minutes)</label>
              <input
                type="number"
                id="t-est"
                value={estMinutes}
                onChange={(e) => setEstMinutes(parseInt(e.target.value))}
                min="5"
                step="5"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="t-priority">Priority</label>
              <select id="t-priority" value={priority} onChange={(e) => setPriority(e.target.value)} required>
                <option value="low">Low</option>
                <option value="med">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="t-status">Status</label>
              <select id="t-status" value={status} onChange={(e) => setStatus(e.target.value)} required>
                <option value="not started">Not Started</option>
                <option value="in progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Topic</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Topics;
