import React, { useMemo, useState } from 'react';
import {
  Search,
  Play,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  ListChecks,
  X,
} from 'lucide-react';
import { createCard, createDeck, deleteCard, deleteDeck, updateCard, updateDeck } from '../api/client';
import { CardProgress, CardSourceType, DeckId, DeckInfo, Flashcard } from '../types';

interface DecksViewProps {
  decks: DeckInfo[];
  cards: Flashcard[];
  progress: Record<string, CardProgress>;
  canEdit: boolean;
  onStudyDeck: (deckId: DeckId, weakOnly?: boolean) => void;
  onContentChange: () => Promise<void>;
}

interface DeckModalState {
  mode: 'create' | 'edit';
  deckId?: string;
  title: string;
  shortTitle: string;
  subtitle: string;
}

interface CardModalState {
  mode: 'create' | 'edit';
  cardId?: string;
  deckId: string;
  sourceType: CardSourceType;
  tag: string;
  question: string;
  answer: string;
  keyFactsText: string;
}

interface ConfirmDeleteState {
  kind: 'deck' | 'card';
  id: string;
  label: string;
  cardCount?: number;
}

export const DecksView: React.FC<DecksViewProps> = ({
  decks,
  cards,
  progress,
  canEdit,
  onStudyDeck,
  onContentChange,
}) => {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [managingDeckId, setManagingDeckId] = useState<string | null>(null);

  const [deckModal, setDeckModal] = useState<DeckModalState | null>(null);
  const [cardModal, setCardModal] = useState<CardModalState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const managingDeck = useMemo(
    () => decks.find((d) => d.id === managingDeckId) || null,
    [decks, managingDeckId]
  );

  const managingCards = useMemo(
    () => (managingDeck ? cards.filter((c) => c.deckId === managingDeck.id) : []),
    [cards, managingDeck]
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return cards.filter(
      (c) =>
        c.question.toLowerCase().includes(q) ||
        c.answer.toLowerCase().includes(q) ||
        c.tag.toLowerCase().includes(q) ||
        (c.keyFacts || []).some((k) => k.toLowerCase().includes(q))
    );
  }, [query, cards]);

  function openNewDeckModal() {
    setModalError('');
    setDeckModal({ mode: 'create', title: '', shortTitle: '', subtitle: '' });
  }

  function openEditDeckModal(deck: DeckInfo) {
    setModalError('');
    setDeckModal({
      mode: 'edit',
      deckId: deck.id,
      title: deck.title,
      shortTitle: deck.shortTitle,
      subtitle: deck.subtitle,
    });
  }

  function openNewCardModal(defaultDeckId?: string) {
    const fallbackDeckId = defaultDeckId || decks[0]?.id || '';
    setModalError('');
    setCardModal({
      mode: 'create',
      deckId: fallbackDeckId,
      sourceType: 'paper',
      tag: '',
      question: '',
      answer: '',
      keyFactsText: '',
    });
  }

  function openEditCardModal(card: Flashcard) {
    setModalError('');
    setCardModal({
      mode: 'edit',
      cardId: card.id,
      deckId: card.deckId,
      sourceType: card.sourceType,
      tag: card.tag,
      question: card.question,
      answer: card.answer,
      keyFactsText: (card.keyFacts || []).join(', '),
    });
  }

  async function handleSaveDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!deckModal || saving) return;
    if (!deckModal.title.trim() || !deckModal.shortTitle.trim()) {
      setModalError('Deck title and short title are required.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const payload = {
        title: deckModal.title.trim(),
        shortTitle: deckModal.shortTitle.trim(),
        subtitle: deckModal.subtitle.trim(),
      };
      if (deckModal.mode === 'create') {
        await createDeck(payload);
      } else if (deckModal.deckId) {
        await updateDeck(deckModal.deckId, payload);
      }
      await onContentChange();
      setDeckModal(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to save deck.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCard(e: React.FormEvent) {
    e.preventDefault();
    if (!cardModal || saving) return;
    if (!cardModal.deckId || !cardModal.question.trim() || !cardModal.answer.trim()) {
      setModalError('Deck, question, and answer are required.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const keyFacts = cardModal.keyFactsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        deckId: cardModal.deckId,
        sourceType: cardModal.sourceType,
        tag: cardModal.tag.trim(),
        question: cardModal.question.trim(),
        answer: cardModal.answer.trim(),
        keyFacts,
      };
      if (cardModal.mode === 'create') {
        await createCard(payload);
      } else if (cardModal.cardId) {
        await updateCard(cardModal.cardId, payload);
      }
      await onContentChange();
      setCardModal(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to save card.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete || saving) return;
    setSaving(true);
    setModalError('');
    try {
      if (confirmDelete.kind === 'deck') {
        await deleteDeck(confirmDelete.id);
        if (managingDeckId === confirmDelete.id) {
          setManagingDeckId(null);
        }
      } else {
        await deleteCard(confirmDelete.id);
      }
      await onContentChange();
      setConfirmDelete(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="decks-view">
      {/* Merry-only Manager View for a Single Deck */}
      {canEdit && managingDeck && !query.trim() ? (
        <div className="manage-deck-view">
          <div className="manage-header-row">
            <button
              type="button"
              className="back-btn"
              onClick={() => setManagingDeckId(null)}
            >
              <ArrowLeft size={17} />
              <span>All Decks</span>
            </button>
            <button
              type="button"
              className="primary-btn btn-sm"
              onClick={() => openNewCardModal(managingDeck.id)}
            >
              <Plus size={15} /> Add Card
            </button>
          </div>

          <div className="panel manage-deck-banner">
            <div className="manage-deck-title">{managingDeck.title}</div>
            <div className="manage-deck-sub">
              {managingCards.length} flashcard{managingCards.length === 1 ? '' : 's'} &bull;{' '}
              {managingDeck.subtitle || 'No subtitle'}
            </div>
          </div>

          {managingCards.length === 0 ? (
            <div className="empty-card">
              <p>This deck has no cards yet.</p>
              <button
                type="button"
                className="primary-btn btn-sm"
                onClick={() => openNewCardModal(managingDeck.id)}
              >
                <Plus size={15} /> Add First Card
              </button>
            </div>
          ) : (
            <div className="manage-card-list">
              {managingCards.map((card, idx) => (
                <div key={card.id} className="manage-card-item">
                  <div className="manage-card-top">
                    <span className={`badge ${card.sourceType === 'defense' ? 'badge-defense' : 'badge-paper'}`}>
                      #{idx + 1} &bull; {card.tag}
                    </span>
                    <div className="item-icon-actions">
                      <button
                        type="button"
                        className="mini-icon-btn"
                        title="Edit card"
                        onClick={() => openEditCardModal(card)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="mini-icon-btn mini-icon-danger"
                        title="Delete card"
                        onClick={() =>
                          setConfirmDelete({
                            kind: 'card',
                            id: card.id,
                            label: card.question,
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="manage-card-q">{card.question}</div>
                  <div className="manage-card-a">{card.answer}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Instant Quick-Lookup Search */}
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="search"
              placeholder="Search paper facts, numbers, or Q1–Q46..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Merry-only Editor Toolbar */}
          {canEdit && !query.trim() && (
            <div className="editor-toolbar">
              <button
                type="button"
                className="primary-btn btn-sm flex-1"
                onClick={() => openNewCardModal()}
                disabled={decks.length === 0}
              >
                <Plus size={15} /> Add Card
              </button>
              <button
                type="button"
                className="secondary-btn btn-sm flex-1"
                onClick={openNewDeckModal}
              >
                <Plus size={15} /> New Deck
              </button>
            </div>
          )}

          {query.trim() ? (
            <div className="search-results">
              <div className="section-label">
                {searchResults.length} matching card{searchResults.length === 1 ? '' : 's'}
              </div>
              {searchResults.length === 0 ? (
                <div className="empty-inline">
                  No matches for &ldquo;{query}&rdquo;. Try &ldquo;MAPE&rdquo;, &ldquo;114.17&rdquo;, &ldquo;Zener&rdquo;, or &ldquo;EcoGuide&rdquo;.
                </div>
              ) : (
                searchResults.map((card) => {
                  const isOpen = expandedId === card.id;
                  return (
                    <div key={card.id} className="lookup-card">
                      <button
                        type="button"
                        className="lookup-header"
                        onClick={() => setExpandedId(isOpen ? null : card.id)}
                      >
                        <div>
                          <span className={`badge ${card.sourceType === 'defense' ? 'badge-defense' : 'badge-paper'}`}>
                            {card.tag}
                          </span>
                          <div className="lookup-q">{card.question}</div>
                        </div>
                        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                      {isOpen && (
                        <div className="lookup-a">
                          <p>{card.answer}</p>
                          {canEdit && (
                            <div className="lookup-edit-row">
                              <button
                                type="button"
                                className="secondary-btn btn-xs"
                                onClick={() => openEditCardModal(card)}
                              >
                                <Pencil size={12} /> Edit Card
                              </button>
                              <button
                                type="button"
                                className="danger-outline-btn btn-xs"
                                onClick={() =>
                                  setConfirmDelete({
                                    kind: 'card',
                                    id: card.id,
                                    label: card.question,
                                  })
                                }
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <>
              <div className="section-label">Study Path — Gaps to Major Findings</div>
              <div className="deck-list">
                {decks.map((deck) => {
                  const deckCards = cards.filter((c) => c.deckId === deck.id);
                  const studied = deckCards.filter((c) => Boolean(progress[c.id]));
                  const mastered = deckCards.filter((c) => (progress[c.id]?.masteryScore ?? 0) >= 75);
                  const weak = deckCards.filter((c) => {
                    const p = progress[c.id];
                    return p && (p.lastRating === 'struggling' || p.lastRating === 'unsure' || p.masteryScore < 65);
                  });
                  const pct = deckCards.length > 0 ? Math.round((mastered.length / deckCards.length) * 100) : 0;

                  return (
                    <div key={deck.id} className="deck-card">
                      <div className="deck-card-top">
                        <div className="deck-accent" style={{ backgroundColor: deck.color }} />
                        <div className="deck-text flex-1">
                          <h3>{deck.title}</h3>
                          <p>{deck.subtitle}</p>
                        </div>
                        {canEdit && (
                          <div className="item-icon-actions">
                            <button
                              type="button"
                              className="mini-icon-btn"
                              title="Edit deck"
                              onClick={() => openEditDeckModal(deck)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="mini-icon-btn mini-icon-danger"
                              title="Delete deck"
                              onClick={() =>
                                setConfirmDelete({
                                  kind: 'deck',
                                  id: deck.id,
                                  label: deck.title,
                                  cardCount: deckCards.length,
                                })
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="deck-progress-row">
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${pct}%`, backgroundColor: deck.color }}
                          />
                        </div>
                        <span className="progress-label">
                          {mastered.length}/{deckCards.length} mastered
                        </span>
                      </div>

                      <div className="deck-stats-mini">
                        <span>{studied.length} studied</span>
                        <span>&bull;</span>
                        <span>{deckCards.filter((c) => c.sourceType === 'defense').length} Defense Qs</span>
                        {weak.length > 0 && (
                          <>
                            <span>&bull;</span>
                            <span className="text-danger">{weak.length} struggling</span>
                          </>
                        )}
                      </div>

                      <div className="deck-actions">
                        <button
                          type="button"
                          className="primary-btn btn-sm flex-1"
                          onClick={() => onStudyDeck(deck.id, false)}
                        >
                          <Play size={14} /> Study Deck
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            className="secondary-btn btn-sm"
                            onClick={() => setManagingDeckId(deck.id)}
                          >
                            <ListChecks size={14} /> Manage Cards
                          </button>
                        )}
                        {weak.length > 0 && (
                          <button
                            type="button"
                            className="danger-outline-btn btn-sm"
                            onClick={() => onStudyDeck(deck.id, true)}
                          >
                            <AlertTriangle size={14} /> Drill ({weak.length})
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ==================== DECK CREATE / EDIT MODAL ==================== */}
      {deckModal && (
        <div className="modal-backdrop" onClick={() => !saving && setDeckModal(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{deckModal.mode === 'create' ? 'New Deck' : 'Edit Deck'}</h3>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => !saving && setDeckModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="modal-form" onSubmit={handleSaveDeck}>
              <label>
                <span>Full Title</span>
                <input
                  type="text"
                  placeholder="e.g., 7. Extra Defense Questions"
                  value={deckModal.title}
                  onChange={(e) => setDeckModal({ ...deckModal, title: e.target.value })}
                  required
                />
              </label>
              <label>
                <span>Short Label (for charts &amp; tags)</span>
                <input
                  type="text"
                  placeholder="e.g., Extra Q&A"
                  value={deckModal.shortTitle}
                  onChange={(e) => setDeckModal({ ...deckModal, shortTitle: e.target.value })}
                  required
                />
              </label>
              <label>
                <span>Subtitle / Description</span>
                <input
                  type="text"
                  placeholder="Short description of topics covered"
                  value={deckModal.subtitle}
                  onChange={(e) => setDeckModal({ ...deckModal, subtitle: e.target.value })}
                />
              </label>
              {modalError && <div className="error-banner">{modalError}</div>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn btn-sm flex-1"
                  onClick={() => setDeckModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn btn-sm flex-1" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Deck'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== CARD CREATE / EDIT MODAL ==================== */}
      {cardModal && (
        <div className="modal-backdrop" onClick={() => !saving && setCardModal(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{cardModal.mode === 'create' ? 'Add Flashcard' : 'Edit Flashcard'}</h3>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => !saving && setCardModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="modal-form" onSubmit={handleSaveCard}>
              <label>
                <span>Deck</span>
                <select
                  value={cardModal.deckId}
                  onChange={(e) => setCardModal({ ...cardModal, deckId: e.target.value })}
                  required
                >
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>

              <div className="modal-row-2">
                <label>
                  <span>Card Type</span>
                  <select
                    value={cardModal.sourceType}
                    onChange={(e) =>
                      setCardModal({ ...cardModal, sourceType: e.target.value as CardSourceType })
                    }
                  >
                    <option value="paper">Paper Fact</option>
                    <option value="defense">Defense Q&amp;A</option>
                  </select>
                </label>
                <label>
                  <span>Tag</span>
                  <input
                    type="text"
                    placeholder="e.g., SOP 2.1 or Defense Q5"
                    value={cardModal.tag}
                    onChange={(e) => setCardModal({ ...cardModal, tag: e.target.value })}
                  />
                </label>
              </div>

              <label>
                <span>Question</span>
                <textarea
                  rows={2}
                  placeholder="Enter the question or prompt..."
                  value={cardModal.question}
                  onChange={(e) => setCardModal({ ...cardModal, question: e.target.value })}
                  required
                />
              </label>

              <label>
                <span>Answer</span>
                <textarea
                  rows={5}
                  placeholder="Enter the full answer..."
                  value={cardModal.answer}
                  onChange={(e) => setCardModal({ ...cardModal, answer: e.target.value })}
                  required
                />
              </label>

              <label>
                <span>Key Anchors (comma-separated, optional)</span>
                <input
                  type="text"
                  placeholder="e.g., MAPE 8.05%, 384 respondents, < 10%"
                  value={cardModal.keyFactsText}
                  onChange={(e) => setCardModal({ ...cardModal, keyFactsText: e.target.value })}
                />
              </label>

              {modalError && <div className="error-banner">{modalError}</div>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn btn-sm flex-1"
                  onClick={() => setCardModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn btn-sm flex-1" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== CONFIRM DELETE MODAL ==================== */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => !saving && setConfirmDelete(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete {confirmDelete.kind === 'deck' ? 'Deck' : 'Flashcard'}?</h3>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => !saving && setConfirmDelete(null)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="confirm-text">
              {confirmDelete.kind === 'deck'
                ? `This will permanently delete "${confirmDelete.label}" and all ${confirmDelete.cardCount || 0} card(s) inside it.`
                : `Are you sure you want to delete "${confirmDelete.label}"?`}
            </p>
            {modalError && <div className="error-banner">{modalError}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn btn-sm flex-1"
                onClick={() => setConfirmDelete(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-btn btn-sm flex-1"
                onClick={handleConfirmDelete}
                disabled={saving}
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
