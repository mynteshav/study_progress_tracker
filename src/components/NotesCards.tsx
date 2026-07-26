import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../App';

interface NotesCardsProps {
  user: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function NotesCards({ user, showToast }: NotesCardsProps) {
  const [activeTab, setActiveTab] = useState<'notes' | 'flashcards'>('notes');

  // Notes States
  const [notes, setNotes] = useState<any[]>([]);
  const [search, setSearch] = useState<string>('');
  const [selectedNote, setSelectedNote] = useState<any | null>(null);
  
  // Note Form
  const [noteId, setNoteId] = useState<number | null>(null);
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteSubject, setNoteSubject] = useState<string>('');
  const [noteBody, setNoteBody] = useState<string>('');

  // Flashcards States
  const [decks, setDecks] = useState<any[]>([]);
  const [showDeckModal, setShowDeckModal] = useState<boolean>(false);
  const [deckName, setDeckName] = useState<string>('');
  const [deckSubject, setDeckSubject] = useState<string>('');

  // Add Card States
  const [showCardModal, setShowCardModal] = useState<boolean>(false);
  const [targetDeckId, setTargetDeckId] = useState<number | null>(null);
  const [cardFront, setCardFront] = useState<string>('');
  const [cardBack, setCardBack] = useState<string>('');

  // Review Study Session States
  const [studyDeck, setStudyDeck] = useState<any | null>(null);
  const [dueCards, setDueCards] = useState<any[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  // ----------------------------------------------------
  // NOTES LOGIC
  // ----------------------------------------------------
  const loadNotes = async (selectId?: number | null) => {
    try {
      const data = await db.getNotes(user.id, search);
      setNotes(data);
      if (data.length > 0) {
        if (selectId) {
          const found = data.find(n => n.id === selectId);
          if (found) handleSelectNote(found);
          else handleSelectNote(data[0]);
        } else {
          // If no specific selectId is provided, check if the current selection is still in the loaded array.
          // This avoids React state batching delays by checking the database result array.
          const currentId = selectedNote?.id;
          const found = data.find(n => n.id === currentId);
          if (found) {
            handleSelectNote(found);
          } else {
            handleSelectNote(data[0]);
          }
        }
      } else {
        handleSelectNote(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'notes') {
      loadNotes();
    } else {
      loadDecks();
    }
  }, [activeTab, search, user]);

  const handleSelectNote = (note: any | null) => {
    setSelectedNote(note);
    if (note) {
      setNoteId(note.id);
      setNoteTitle(note.title);
      setNoteSubject(note.subject);
      setNoteBody(note.body);
    } else {
      setNoteId(null);
      setNoteTitle('');
      setNoteSubject('');
      setNoteBody('');
    }
  };

  const handleNoteSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle || !noteSubject || !noteBody) {
      showToast('All note fields are required', 'error');
      return;
    }

    try {
      if (noteId) {
        await db.updateNote(noteId, { title: noteTitle, subject: noteSubject, body: noteBody });
        showToast('Note updated successfully', 'success');
        loadNotes(noteId);
      } else {
        const result = await db.addNote(user.id, noteTitle, noteSubject, noteBody);
        const createdNote = {
          id: result.id,
          user_id: user.id,
          title: noteTitle,
          subject: noteSubject,
          body: noteBody,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        setSelectedNote(createdNote);
        setNoteId(result.id);
        showToast('Note created successfully', 'success');
        loadNotes(result.id);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to save note', 'error');
    }
  };

  const handleNoteDelete = async () => {
    if (noteId && confirm(`Are you sure you want to delete this note?`)) {
      try {
        await db.deleteNote(noteId);
        showToast('Note deleted successfully', 'success');
        handleSelectNote(null); // Clear form input fields immediately
        loadNotes();
      } catch (err: any) {
        showToast(err.message || 'Failed to delete note', 'error');
      }
    }
  };

  // ----------------------------------------------------
  // FLASHCARDS DECK LOGIC
  // ----------------------------------------------------
  const loadDecks = async () => {
    try {
      const data = await db.getDecks(user.id);
      
      const decksWithStats = [];
      const todayStr = new Date().toISOString().split('T')[0];
      
      for (const d of data) {
        const total = await db.getCards(d.id);
        const due = total.filter((c: any) => c.next_review_date <= todayStr);
        const mastered = total.filter((c: any) => c.ease_factor >= 2.8);
        
        d.dueCount = due.length;
        d.totalCount = total.length;
        d.masteredCount = mastered.length;
        decksWithStats.push(d);
      }
      setDecks(decksWithStats);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deckName || !deckSubject) return;

    try {
      await db.addDeck(user.id, deckName, deckSubject);
      showToast('Deck created successfully', 'success');
      setDeckName('');
      setDeckSubject('');
      setShowDeckModal(false);
      loadDecks();
    } catch (err: any) {
      showToast(err.message || 'Failed to create deck', 'error');
    }
  };

  const handleDeleteDeck = async (id: number) => {
    if (confirm('Delete this deck and all its flashcards?')) {
      try {
        await db.deleteDeck(id);
        showToast('Deck deleted', 'success');
        loadDecks();
      } catch (err: any) {
        showToast(err.message || 'Failed to delete deck', 'error');
      }
    }
  };

  const handleOpenCardModal = (deckId: number) => {
    setTargetDeckId(deckId);
    setCardFront('');
    setCardBack('');
    setShowCardModal(true);
  };

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDeckId || !cardFront || !cardBack) return;

    try {
      await db.addCard(targetDeckId, cardFront, cardBack);
      showToast('Flashcard added!', 'success');
      setShowCardModal(false);
      loadDecks();
    } catch (err: any) {
      showToast(err.message || 'Failed to add card', 'error');
    }
  };

  // ----------------------------------------------------
  // STUDY SESSION INTERACTION
  // ----------------------------------------------------
  const handleStartStudy = async (deck: any) => {
    try {
      const cards = await db.getDueCards(deck.id);
      setStudyDeck(deck);
      setDueCards(cards);
      setCurrentCardIndex(0);
      setIsFlipped(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCardReview = async (response: 'again' | 'hard' | 'good' | 'easy') => {
    const card = dueCards[currentCardIndex];
    try {
      await db.reviewCard(card.id, response);
      showToast(`Card rated: ${response}`, 'success');
      setIsFlipped(false);
      
      setCurrentCardIndex(prev => prev + 1);
    } catch (err: any) {
      showToast(err.message || 'Failed to submit card review', 'error');
    }
  };

  const renderActiveSection = () => {
    if (activeTab === 'notes') {
      return (
        <div className="notes-layout">
          {/* Notes Sidebar list */}
          <div className="notes-sidebar">
            <input
              type="text"
              className="form-group"
              placeholder="Search notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 0 }}
            />
            <button className="btn btn-primary" onClick={() => handleSelectNote(null)} style={{ width: '100%' }}>
              <i className="fa-solid fa-plus"></i> New Note
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
              {notes.map(n => (
                <div
                  key={n.id}
                  className={`note-list-item ${selectedNote && selectedNote.id === n.id ? 'active' : ''}`}
                  onClick={() => handleSelectNote(n)}
                >
                  <div className="note-list-title">{n.title}</div>
                  <div className="note-list-subject">{n.subject}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Note Editor Area */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <form onSubmit={handleNoteSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
              <div className="grid-2" style={{ gap: '12px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="n-title">Note Title</label>
                  <input
                    type="text"
                    id="n-title"
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Enter note title..."
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="n-subject">Subject Tag</label>
                  <input
                    type="text"
                    id="n-subject"
                    value={noteSubject}
                    onChange={(e) => setNoteSubject(e.target.value)}
                    placeholder="e.g. Algorithms"
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
                <label htmlFor="n-body">Body Content</label>
                <textarea
                  id="n-body"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  style={{ flex: 1, resize: 'none', fontFamily: 'monospace' }}
                  placeholder="Type note details here..."
                  required
                />
              </div>

              <div className="form-actions" style={{ marginTop: 0 }}>
                {noteId && (
                  <button type="button" className="btn btn-danger" onClick={handleNoteDelete} style={{ marginRight: 'auto' }}>
                    <i className="fa-solid fa-trash"></i> Delete
                  </button>
                )}
                <button type="submit" className="btn btn-primary">
                  <i className="fa-solid fa-floppy-disk"></i> Save Note
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    // FLASHCARD REVIEW SESSION RENDERING
    if (studyDeck) {
      const isSessionDone = dueCards.length === 0 || currentCardIndex >= dueCards.length;
      
      if (isSessionDone) {
        return (
          <div className="glass-panel" style={{ maxWidth: '480px', margin: '40px auto', textAlign: 'center', padding: '40px' }}>
            <i className="fa-solid fa-circle-check" style={{ fontSize: '3.5rem', color: 'var(--color-done)', marginBottom: '20px' }}></i>
            <h2>Deck Review Complete!</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '8px', marginBottom: '24px' }}>
              Awesome job! You have cleared all due reviews in the "{studyDeck.name}" deck.
            </p>
            <button className="btn btn-primary" onClick={() => { setStudyDeck(null); loadDecks(); }}>
              Return to Decks
            </button>
          </div>
        );
      }

      const activeCard = dueCards[currentCardIndex];

      return (
        <div className="study-session-view">
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            <span>Deck: <strong>{studyDeck.name}</strong></span>
            <span>Card {currentCardIndex + 1} of {dueCards.length}</span>
          </div>

          <div className={`flashcard ${isFlipped ? 'flipped' : ''}`} onClick={() => setIsFlipped(!isFlipped)}>
            <div className="flashcard-inner">
              <div className="flashcard-front">
                <div className="flashcard-text">{activeCard.front}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', position: 'absolute', bottom: '20px' }}>
                  Tap Card to Reveal Answer
                </div>
              </div>
              <div className="flashcard-back">
                <div className="flashcard-text">{activeCard.back}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', position: 'absolute', bottom: '20px' }}>
                  Rate your recall quality below
                </div>
              </div>
            </div>
          </div>

          {/* SM-2 Buttons */}
          <div className="study-feedback-buttons" style={{ visibility: isFlipped ? 'visible' : 'hidden' }}>
            <button className="btn btn-danger" onClick={() => handleCardReview('again')}>Again</button>
            <button className="btn btn-secondary" onClick={() => handleCardReview('hard')} style={{ borderColor: '#f97316', color: '#fdba74' }}>Hard</button>
            <button className="btn btn-primary" onClick={() => handleCardReview('good')}>Good</button>
            <button className="btn btn-primary" onClick={() => handleCardReview('easy')} style={{ backgroundColor: 'var(--grad-emerald)' }}>Easy</button>
          </div>
        </div>
      );
    }

    // FLASHCARD DECKS LIST VIEW
    return (
      <div>
        <div className="topics-header">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Flashcard Decks</h2>
          <button className="btn btn-primary" onClick={() => setShowDeckModal(true)}><i className="fa-solid fa-folder-plus"></i> New Deck</button>
        </div>

        <div className="decks-grid">
          {decks.map(deck => (
            <div key={deck.id} className="deck-card glass-panel">
              <div className="deck-name">{deck.name}</div>
              <span className="badge badge-subject" style={{ alignSelf: 'flex-start' }}>{deck.subject}</span>
              
              <div className="deck-stats-list">
                <div className="deck-stat-item">Due Today <span>{deck.dueCount}</span></div>
                <div className="deck-stat-item">Total <span>{deck.totalCount}</span></div>
                <div className="deck-stat-item">Mastered <span>{deck.masteredCount}</span></div>
              </div>

              <div className="form-actions" style={{ marginTop: '10px', justifyContent: 'space-between' }}>
                <button className="topic-action-btn delete-deck" onClick={() => handleDeleteDeck(deck.id)} title="Delete Deck">
                  <i className="fa-solid fa-trash"></i>
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-secondary" onClick={() => handleOpenCardModal(deck.id)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                    <i className="fa-solid fa-plus"></i> Card
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleStartStudy(deck)}
                    style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                    disabled={deck.dueCount === 0}
                  >
                    <i className="fa-solid fa-play"></i> Study
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Create Deck Modal */}
        <div className={`modal ${showDeckModal ? 'active' : ''}`}>
          <div className="modal-content glassmorphism">
            <div className="modal-header">
              <h2>Create Study Deck</h2>
              <button className="modal-close" onClick={() => setShowDeckModal(false)}>&times;</button>
            </div>
            <form className="modal-form" onSubmit={handleCreateDeck}>
              <div className="form-group">
                <label htmlFor="d-name">Deck Name</label>
                <input
                  type="text"
                  id="d-name"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  placeholder="e.g. Core Data Structures"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="d-subject">Subject Tag</label>
                <input
                  type="text"
                  id="d-subject"
                  value={deckSubject}
                  onChange={(e) => setDeckSubject(e.target.value)}
                  placeholder="e.g. Computer Science"
                  required
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowDeckModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Deck</button>
              </div>
            </form>
          </div>
        </div>

        {/* Add Card Modal */}
        <div className={`modal ${showCardModal ? 'active' : ''}`}>
          <div className="modal-content glassmorphism" style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h2>Add Card to Deck</h2>
              <button className="modal-close" onClick={() => setShowCardModal(false)}>&times;</button>
            </div>
            <form className="modal-form" onSubmit={handleCreateCard}>
              <div className="form-group">
                <label htmlFor="card-front">Front Text (Question / Concept)</label>
                <textarea
                  id="card-front"
                  value={cardFront}
                  onChange={(e) => setCardFront(e.target.value)}
                  rows={3}
                  placeholder="e.g. Time complexity of lookup in HashMap?"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="card-back">Back Text (Answer / Explanation)</label>
                <textarea
                  id="card-back"
                  value={cardBack}
                  onChange={(e) => setCardBack(e.target.value)}
                  rows={3}
                  placeholder="e.g. O(1) average case, O(N) worst case (hash collisions)"
                  required
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCardModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Card</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="notes-tabs">
        <button className={`notes-tab-btn ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
          Notes Repository
        </button>
        <button className={`notes-tab-btn ${activeTab === 'flashcards' ? 'active' : ''}`} onClick={() => { setActiveTab('flashcards'); setStudyDeck(null); }}>
          Flashcards Decks
        </button>
      </div>

      <div id="notesSectionContent">
        {renderActiveSection()}
      </div>
    </div>
  );
}

export default NotesCards;
