import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../App';

interface TimetableProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Timetable({ user, showToast }: TimetableProps) {
  const [blocks, setBlocks] = useState<any[]>([]);
  const [showModal, setShowModal] = useState<boolean>(false);
  
  // Block Form states
  const [blockId, setBlockId] = useState<number | null>(null);
  const [subject, setSubject] = useState<string>('');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [color, setColor] = useState<string>('#6366f1');
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endTime, setEndTime] = useState<string>('10:00');
  const [recurring, setRecurring] = useState<boolean>(true);
  const [specificDate, setSpecificDate] = useState<string>('');
  const [applyToAllDays, setApplyToAllDays] = useState<boolean>(false);

  const daysOfWeek = [
    { label: 'Sun', value: 0 },
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 }
  ];

  const startHour = 8;
  const endHour = 22;
  const hourHeight = 60; // 60px per hour

  const loadData = async () => {
    try {
      const data = await db.getTimetableBlocks(user.id);
      setBlocks(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleOpenModal = (b: any = null) => {
    setApplyToAllDays(false);
    if (b) {
      setBlockId(b.id || null);
      setSubject(b.subject || '');
      setDayOfWeek(b.day_of_week !== undefined ? b.day_of_week : 1);
      setColor(b.color || '#6366f1');
      setStartTime(b.start_time || '09:00');
      setEndTime(b.end_time || '10:00');
      setRecurring(b.recurring === 1);
      setSpecificDate(b.specific_date || '');
    } else {
      setBlockId(null);
      setSubject('');
      setDayOfWeek(1);
      setColor('#6366f1');
      setStartTime('09:00');
      setEndTime('10:00');
      setRecurring(true);
      setSpecificDate('');
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const timeToMinutes = (tStr: string) => {
    const [h, m] = tStr.split(':').map(Number);
    return h * 60 + m;
  };

  // Timetable Conflict Checks in React
  const checkBlockConflict = (day: number, start: string, end: string, isRec: boolean, specDate: string, currentId: number | null) => {
    const conflictList = blocks.filter((b: any) => b.day_of_week === day && b.id !== currentId);
    
    for (const b of conflictList) {
      let dateApplies = false;
      if (isRec || b.recurring === 1) {
        dateApplies = true;
      } else if (specDate && b.specific_date && specDate === b.specific_date) {
        dateApplies = true;
      }
      
      if (dateApplies) {
        // Overlap time checks: start1 < end2 AND end1 > start2
        if (start < b.end_time && end > b.start_time) {
          return b;
        }
      }
    }
    return null;
  };

  const handleFormSubmit = async (e?: React.FormEvent, force: boolean = false) => {
    if (e) e.preventDefault();
    
    if (!subject || dayOfWeek === undefined || !startTime || !endTime) {
      showToast('Subject, day, start and end times are required', 'error');
      return;
    }

    if (startTime >= endTime) {
      showToast('Start time must be before end time', 'error');
      return;
    }

    if (!recurring && !specificDate) {
      showToast('A specific date is required for non-recurring blocks', 'error');
      return;
    }

    // Client Conflict Detection
    if (!force) {
      if (applyToAllDays) {
        let conflictBlock: any = null;
        for (let day = 0; day <= 6; day++) {
          const conflict = checkBlockConflict(day, startTime, endTime, recurring, specificDate, blockId);
          if (conflict) {
            const isExactDuplicate = conflict.start_time === startTime && conflict.end_time === endTime;
            if (!isExactDuplicate) {
              conflictBlock = conflict;
              break;
            }
          }
        }
        if (conflictBlock) {
          if (confirm(`Overlap Warning: This conflicts with "${conflictBlock.subject}" on some day(s) (${conflictBlock.start_time} - ${conflictBlock.end_time})\n\nDo you want to override and schedule this block anyway?`)) {
            handleFormSubmit(undefined, true);
          }
          return;
        }
      } else {
        const conflict = checkBlockConflict(dayOfWeek, startTime, endTime, recurring, specificDate, blockId);
        if (conflict) {
          if (confirm(`Overlap Warning: This conflicts with "${conflict.subject}" (${conflict.start_time} - ${conflict.end_time})\n\nDo you want to override and schedule this block anyway?`)) {
            handleFormSubmit(undefined, true);
          }
          return;
        }
      }
    }

    const payload = {
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      subject,
      color,
      recurring,
      specific_date: recurring ? '' : specificDate
    };

    try {
      if (blockId) {
        const result = await db.updateTimetableBlock(blockId, payload, applyToAllDays);
        if (applyToAllDays) {
          if (result && result.skippedCount > 0) {
            showToast(`⚠️ Applied to ${result.appliedCount} days. ${result.skippedCount} duplicate schedules already existed.`, 'warning');
          } else {
            showToast('✅ Timetable applied to all 7 days.', 'success');
          }
        } else {
          showToast('Timetable block updated', 'success');
        }
      } else {
        const result = await db.addTimetableBlock(user.id, payload, applyToAllDays);
        if (applyToAllDays) {
          if (result && result.skippedCount > 0) {
            showToast(`⚠️ Applied to ${result.appliedCount} days. ${result.skippedCount} duplicate schedules already existed.`, 'warning');
          } else {
            showToast('✅ Timetable applied to all 7 days.', 'success');
          }
        } else {
          showToast('Timetable block scheduled', 'success');
        }
      }
      handleCloseModal();
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save block', 'error');
    }
  };

  const handleDelete = async () => {
    if (!blockId) return;
    if (confirm('Are you sure you want to delete this timetable block?')) {
      try {
        await db.deleteTimetableBlock(blockId);
        showToast('Time block deleted', 'success');
        handleCloseModal();
        loadData();
      } catch (err: any) {
        showToast(err.message || 'Failed to delete block', 'error');
      }
    }
  };

  const renderCells = () => {
    const cells = [];
    // Generate Hour Rows (8 AM to 9 PM)
    for (let hour = startHour; hour < endHour; hour++) {
      const timeStr = `${String(hour).padStart(2, '0')}:00`;
      
      // Hour label
      cells.push(
        <div key={`h-label-${hour}`} className="timetable-time-cell">
          {timeStr}
        </div>
      );

      // 7 day columns
      daysOfWeek.forEach(day => {
        cells.push(
          <div
            key={`cell-${hour}-${day.value}`}
            className="timetable-grid-cell"
            onClick={() => {
              const hStr = `${String(hour).padStart(2, '0')}:00`;
              const endHStr = `${String(hour + 1).padStart(2, '0')}:00`;
              handleOpenModal({ day_of_week: day.value, start_time: hStr, end_time: endHStr });
            }}
          />
        );
      });
    }
    return cells;
  };

  return (
    <div>
      <div className="topics-header">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Lane Timetable Scheduler</h2>
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
          <i className="fa-solid fa-calendar-plus"></i> Add Time Block
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '16px', overflow: 'hidden' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          <i className="fa-solid fa-circle-info"></i> Click any empty cell or the button to schedule study sessions. Conflicts will trigger overlap warnings.
        </p>
        
        <div className="timetable-container">
          <div className="timetable-grid" style={{ position: 'relative' }}>
            
            {/* Headers row */}
            <div className="timetable-header-cell">Hour</div>
            {daysOfWeek.map(d => (
              <div key={d.value} className="timetable-header-cell">{d.label}</div>
            ))}

            {/* Grid rows & columns */}
            {renderCells()}

            {/* Absolute blocks overlays */}
            {blocks.map(block => {
              const startMin = timeToMinutes(block.start_time);
              const endMin = timeToMinutes(block.end_time);
              const calendarStartMin = startHour * 60;
              
              const topOffset = ((startMin - calendarStartMin) / 60) * hourHeight;
              const height = ((endMin - startMin) / 60) * hourHeight;

              if (topOffset < 0 || height <= 0) return null;

              // Find day column index (0 to 6)
              const dayIndex = daysOfWeek.findIndex(d => d.value === block.day_of_week);
              if (dayIndex === -1) return null;

              // Grid structure widths: 80px for hour label, then 7 dynamic columns
              // We map left coordinate as percentage-based or pixel-based.
              // Since timetable-grid is 920px min-width and uses repeat(7, 1fr) after 80px hour cell:
              // Width of each column is approx (totalGridWidth - 80px) / 7
              // In CSS: grid-template-columns: 80px repeat(7, 1fr);
              // For absolute overlays to look perfect on a responsive layout, we can place them absolute relative to a day container,
              // or calculate left offset using percentage!
              // Left offset % = 80px + index * ((100% - 80px) / 7)
              const leftPercent = `calc(80px + ${dayIndex} * ((100% - 80px) / 7) + 4px)`;
              const widthPercent = `calc(((100% - 80px) / 7) - 8px)`;

              return (
                <div
                  key={block.id}
                  className="timetable-block"
                  onClick={() => handleOpenModal(block)}
                  style={{
                    backgroundColor: block.color || '#6366f1',
                    top: `${topOffset + 50}px`, // Shift 50px down for headers row
                    height: `${height}px`,
                    left: leftPercent,
                    width: widthPercent,
                    zIndex: 10
                  }}
                >
                  <div className="timetable-block-title">{block.subject}</div>
                  <div className="timetable-block-time">{block.start_time} - {block.end_time}</div>
                </div>
              );
            })}

          </div>
        </div>
      </div>

      {/* Add/Edit Block Modal */}
      <div className={`modal ${showModal ? 'active' : ''}`}>
        <div className="modal-content glassmorphism">
          <div className="modal-header">
            <h2>{blockId ? 'Edit Scheduled Block' : 'Schedule Time Block'}</h2>
            <button className="modal-close" onClick={handleCloseModal}>&times;</button>
          </div>
          <form className="modal-form" onSubmit={(e) => handleFormSubmit(e)}>
            <div className="form-group">
              <label htmlFor="b-subject">Subject / Activity</label>
              <input
                type="text"
                id="b-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. System Design study"
                required
              />
            </div>
            
            <div className="grid-2" style={{ gap: '12px' }}>
              <div className="form-group">
                <label htmlFor="b-day">Day of the Week</label>
                <select id="b-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(parseInt(e.target.value))} required>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                  <option value="0">Sunday</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="b-color">Color Tag</label>
                <select id="b-color" value={color} onChange={(e) => setColor(e.target.value)} required>
                  <option value="#6366f1">Indigo (Default)</option>
                  <option value="#8b5cf6">Purple</option>
                  <option value="#06b6d4">Cyan</option>
                  <option value="#10b981">Green</option>
                  <option value="#f97316">Orange</option>
                  <option value="#ef4444">Red</option>
                </select>
              </div>
            </div>

            <div className="grid-2" style={{ gap: '12px' }}>
              <div className="form-group">
                <label htmlFor="b-start">Start Time</label>
                <input type="time" id="b-start" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="b-end">End Time</label>
                <input type="time" id="b-end" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span>Recurring Weekly Block</span>
              </label>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={applyToAllDays}
                  onChange={(e) => setApplyToAllDays(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span>Apply to All Days</span>
              </label>
            </div>

            {!recurring && (
              <div className="form-group">
                <label htmlFor="b-date">Specific Date</label>
                <input type="date" id="b-date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} required />
              </div>
            )}

            <div className="form-actions">
              {blockId && (
                <button type="button" className="btn btn-danger" onClick={handleDelete} style={{ marginRight: 'auto' }}>
                  Delete
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Block</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Timetable;
