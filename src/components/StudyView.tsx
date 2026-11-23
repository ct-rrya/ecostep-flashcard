import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCcw,
  Sparkles,
  Clock,
  Lightbulb,
  Shuffle,
} from 'lucide-react';
import { CardProgress, DeckId, DeckInfo, Flashcard, Rating } from '../types';

export type StudyModeFilter = 'all' | 'weak' | 'paper' | 'defense' | 'custom';

interface StudyViewProps {
  decks: DeckInfo[];
  cards: Flashcard[];
  progress: Record<string, CardProgress>;
  selectedDeck: DeckId | 'all';
  modeFilter: StudyModeFilter;
  customCardIds: string[] | null;
  onChangeDeck: (deck: DeckId | 'all') => void;
  onChangeMode: (mode: StudyModeFilter) => void;
  onRate: (card: Flashcard, rating: Rating, timeSec: number) => Promise<void>;
}

const SWIPE_THRESHOLD = 85;
const FLY_OUT_MS = 180;

export const StudyView: React.FC<StudyViewProps> = ({
  decks,
  cards: allCards,
  progress,
  selectedDeck,
  modeFilter,
  customCardIds,
  onChangeDeck,
  onChangeMode,
  onRate,
}) => {
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [shuffledSeed, setShuffledSeed] = useState(0);
  const [sessionDoneCount, setSessionDoneCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [flyDirection, setFlyDirection] = useState<'left' | 'right' | null>(null);

  const cardStartRef = useRef<number>(Date.now());
  const flyTimerRef = useRef<number | null>(null);
  const pointerStateRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    maxMove: number;
    lockedHorizontal: boolean;
    lockedVertical: boolean;
    startedOnButton: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    maxMove: 0,
    lockedHorizontal: false,
    lockedVertical: false,
    startedOnButton: false,
  });

  const deckLookup = useMemo(() => {
    const map: Record<string, string> = {};
    decks.forEach((d) => {
      map[d.id] = d.shortTitle;
    });
    return map;
  }, [decks]);

  const queue = useMemo(() => {
    let cards = allCards.filter((c) => (selectedDeck === 'all' ? true : c.deckId === selectedDeck));

    if (modeFilter === 'custom' && customCardIds && customCardIds.length > 0) {
      const set = new Set(customCardIds);
      cards = allCards.filter((c) => set.has(c.id));
    } else if (modeFilter === 'paper') {
      cards = cards.filter((c) => c.sourceType === 'paper');
    } else if (modeFilter === 'defense') {
      cards = cards.filter((c) => c.sourceType === 'defense');
    } else if (modeFilter === 'weak') {
      cards = cards.filter((c) => {
        const p = progress[c.id];
        return p && (p.lastRating === 'struggling' || p.lastRating === 'unsure' || p.masteryScore < 65);
      });
    }

    if (shuffledSeed > 0) {
      const arr = [...cards];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = (i * 7 + shuffledSeed * 13) % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // Smart priority: struggling first -> unsure -> unstudied -> mastered
    return [...cards].sort((a, b) => {
      const pa = progress[a.id];
      const pb = progress[b.id];
      const score = (p?: CardProgress) => {
        if (!p) return 2; // unstudied
        if (p.lastRating === 'struggling') return 0;
        if (p.lastRating === 'unsure' || p.masteryScore < 65) return 1;
        return 3; // mastered
      };
      const diff = score(pa) - score(pb);
      if (diff !== 0) return diff;
      return (pa?.masteryScore ?? 50) - (pb?.masteryScore ?? 50);
    });
  }, [allCards, selectedDeck, modeFilter, customCardIds, progress, shuffledSeed]);

  const safeIndex = queue.length > 0 ? currentIndex % queue.length : 0;
  const activeCard = queue[safeIndex];

  useEffect(() => {
    setFlipped(false);
    setShowHint(false);
    setDragX(0);
    setIsDragging(false);
    setFlyDirection(null);
    cardStartRef.current = Date.now();
    setElapsedSec(0);
  }, [activeCard?.id, selectedDeck, modeFilter]);

  useEffect(() => {
    return () => {
      if (flyTimerRef.current !== null) {
        window.clearTimeout(flyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeCard || flipped) return;
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - cardStartRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeCard?.id, flipped]);

  const handleRate = useCallback(
    async (rating: Rating) => {
      if (!activeCard || saving) return;
      setSaving(true);
      const timeSec = Math.max(1, Math.round((Date.now() - cardStartRef.current) / 1000));
      try {
        await onRate(activeCard, rating, timeSec);
        setSessionDoneCount((n) => n + 1);
        setFlipped(false);
        setShowHint(false);
        setDragX(0);
        setIsDragging(false);
        setFlyDirection(null);
        setCurrentIndex((idx) => (queue.length > 1 ? (idx + 1) % queue.length : 0));
      } finally {
        setSaving(false);
      }
    },
    [activeCard, saving, onRate, queue.length]
  );

  const triggerSwipeRate = useCallback(
    (rating: Rating) => {
      if (!activeCard || saving || flyDirection) return;
      if (rating === 'unsure') {
        void handleRate('unsure');
        return;
      }
      const dir = rating === 'got_it' ? 'right' : 'left';
      setIsDragging(false);
      setFlyDirection(dir);
      if (flyTimerRef.current !== null) {
        window.clearTimeout(flyTimerRef.current);
      }
      flyTimerRef.current = window.setTimeout(() => {
        void handleRate(rating);
      }, FLY_OUT_MS);
    },
    [activeCard, saving, flyDirection, handleRate]
  );

  useEffect(() => {
    if (!activeCard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        triggerSwipeRate('got_it');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        triggerSwipeRate('struggling');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        triggerSwipeRate('unsure');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCard, triggerSwipeRate]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!activeCard || saving || flyDirection) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    const startedOnButton = Boolean(target?.closest('button'));
    pointerStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      maxMove: 0,
      lockedHorizontal: false,
      lockedVertical: false,
      startedOnButton,
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const st = pointerStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId || st.lockedVertical) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    st.maxMove = Math.max(st.maxMove, Math.hypot(dx, dy));

    if (!st.lockedHorizontal) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        st.lockedHorizontal = true;
        setIsDragging(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore if capture is unsupported
        }
      } else if (Math.abs(dy) > 12) {
        st.lockedVertical = true;
        return;
      } else {
        return;
      }
    }

    setDragX(dx);
  }

  function resetPointer() {
    pointerStateRef.current.active = false;
    pointerStateRef.current.pointerId = null;
    pointerStateRef.current.lockedHorizontal = false;
    pointerStateRef.current.lockedVertical = false;
    setIsDragging(false);
    setDragX(0);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const st = pointerStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.startX;
    const wasHorizontal = st.lockedHorizontal;
    const maxMove = st.maxMove;
    const startedOnButton = st.startedOnButton;

    if (wasHorizontal) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      if (dx >= SWIPE_THRESHOLD) {
        pointerStateRef.current.active = false;
        triggerSwipeRate('got_it');
        return;
      }
      if (dx <= -SWIPE_THRESHOLD) {
        pointerStateRef.current.active = false;
        triggerSwipeRate('struggling');
        return;
      }
      resetPointer();
      return;
    }

    resetPointer();
    if (maxMove < 8 && !startedOnButton) {
      setFlipped((f) => !f);
    }
  }

  function handlePointerCancel() {
    if (!pointerStateRef.current.active) return;
    resetPointer();
  }

  const weakCount = useMemo(
    () =>
      allCards.filter((c) => {
        const p = progress[c.id];
        return p && (p.lastRating === 'struggling' || p.lastRating === 'unsure' || p.masteryScore < 65);
      }).length,
    [allCards, progress]
  );

  const cardStat = activeCard ? progress[activeCard.id] : undefined;
  const dragProgress = Math.min(1, Math.abs(dragX) / SWIPE_THRESHOLD);
  const liveSwipeIntent: 'got_it' | 'struggling' | null =
    flyDirection === 'right' || dragX >= 24
      ? 'got_it'
      : flyDirection === 'left' || dragX <= -24
      ? 'struggling'
      : null;

  const cardStyle: React.CSSProperties | undefined = flyDirection
    ? undefined
    : isDragging || dragX !== 0
    ? {
        transform: `translate3d(${dragX}px, ${Math.abs(dragX) * 0.04}px, 0) rotate(${(dragX * 0.045).toFixed(2)}deg)`,
        transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
      }
    : {
        transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
      };

  return (
    <div className="study-view">
      {/* Compact filter bar */}
      <div className="filter-bar">
        <select
          className="deck-select"
          value={selectedDeck}
          onChange={(e) => {
            onChangeDeck(e.target.value as DeckId | 'all');
            setCurrentIndex(0);
          }}
          aria-label="Filter by topic"
        >
          <option value="all">All Topics ({allCards.length} cards)</option>
          {decks.map((d) => {
            const count = allCards.filter((c) => c.deckId === d.id).length;
            return (
              <option key={d.id} value={d.id}>
                {d.title} ({count})
              </option>
            );
          })}
        </select>

        <button
          type="button"
          className="icon-btn"
          title="Shuffle cards"
          onClick={() => {
            setShuffledSeed((s) => s + 1);
            setCurrentIndex(0);
          }}
        >
          <Shuffle size={18} />
        </button>
      </div>

      {/* Mode pills */}
      <div className="pill-row">
        <button
          type="button"
          className={`pill ${modeFilter === 'all' ? 'active' : ''}`}
          onClick={() => {
            onChangeMode('all');
            setCurrentIndex(0);
          }}
        >
          All
        </button>
        <button
          type="button"
          className={`pill pill-warn ${modeFilter === 'weak' ? 'active' : ''}`}
          onClick={() => {
            onChangeMode('weak');
            setCurrentIndex(0);
          }}
        >
          Weak Spots ({weakCount})
        </button>
        <button
          type="button"
          className={`pill ${modeFilter === 'paper' ? 'active' : ''}`}
          onClick={() => {
            onChangeMode('paper');
            setCurrentIndex(0);
          }}
        >
          Paper Facts
        </button>
        <button
          type="button"
          className={`pill ${modeFilter === 'defense' ? 'active' : ''}`}
          onClick={() => {
            onChangeMode('defense');
            setCurrentIndex(0);
          }}
        >
          Defense Q&amp;A
        </button>
        {modeFilter === 'custom' && (
          <button type="button" className="pill pill-danger active" onClick={() => onChangeMode('all')}>
            Team Drill ×
          </button>
        )}
      </div>

      {/* Card or Empty state */}
      {!activeCard ? (
        <div className="empty-card">
          <Sparkles size={32} className="empty-icon" />
          <h3>No cards in this filter!</h3>
          <p>
            {modeFilter === 'weak'
              ? 'Great job — you have no flagged weak cards right now. Study more cards or switch to All.'
              : 'Try switching back to All Topics.'}
          </p>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              onChangeDeck('all');
              onChangeMode('all');
            }}
          >
            Show All Cards
          </button>
        </div>
      ) : (
        <>
          {/* Progress indicator */}
          <div className="study-meta-row">
            <span>
              Card {safeIndex + 1} of {queue.length}
            </span>
            <span className="meta-right">
              <Clock size={13} /> {elapsedSec}s &bull; Done: {sessionDoneCount}
            </span>
          </div>

          {/* Quizlet-style Stacked Card Stage */}
          <div className="card-stage">
            {queue.length > 1 && <div className="card-stack-under" aria-hidden="true" />}

            <div
              className={`flashcard ${flipped ? 'is-flipped' : ''} ${
                flyDirection === 'right' ? 'fly-right' : flyDirection === 'left' ? 'fly-left' : ''
              } ${liveSwipeIntent === 'got_it' ? 'swiping-right' : ''} ${
                liveSwipeIntent === 'struggling' ? 'swiping-left' : ''
              }`}
              style={cardStyle}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              role="button"
              tabIndex={0}
              aria-label={flipped ? 'Flashcard answer shown, tap to flip back' : 'Flashcard question, tap to show answer'}
            >
              {/* Live Swipe Stamps */}
              {liveSwipeIntent === 'got_it' && (
                <div
                  className="swipe-stamp stamp-gotit"
                  style={{ opacity: flyDirection ? 1 : Math.max(0.25, dragProgress) }}
                >
                  GOT IT
                </div>
              )}
              {liveSwipeIntent === 'struggling' && (
                <div
                  className="swipe-stamp stamp-struggling"
                  style={{ opacity: flyDirection ? 1 : Math.max(0.25, dragProgress) }}
                >
                  STILL LEARNING
                </div>
              )}

              <div className="card-top-badges">
                <span className={`badge ${activeCard.sourceType === 'defense' ? 'badge-defense' : 'badge-paper'}`}>
                  {activeCard.tag}
                </span>
                <span className="badge badge-topic">{deckLookup[activeCard.deckId]}</span>
                {cardStat && (
                  <span
                    className={`badge ${
                      cardStat.masteryScore >= 75
                        ? 'badge-good'
                        : cardStat.masteryScore >= 45
                        ? 'badge-mid'
                        : 'badge-bad'
                    }`}
                  >
                    {cardStat.masteryScore}% mastery
                  </span>
                )}
              </div>

              <div className="card-question">{activeCard.question}</div>

              {!flipped ? (
                <div className="card-front-footer">
                  {activeCard.keyFacts && activeCard.keyFacts.length > 0 && (
                    <div>
                      {!showHint ? (
                        <button type="button" className="hint-btn" onClick={() => setShowHint(true)}>
                          <Lightbulb size={15} />
                          <span>Peek key anchors</span>
                        </button>
                      ) : (
                        <div className="hint-box">
                          <div className="hint-title">Key anchors:</div>
                          <div className="chip-list">
                            {activeCard.keyFacts.map((fact, idx) => (
                              <span key={idx} className="fact-chip">
                                {fact}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="tap-cue">Tap card to reveal answer</div>
                </div>
              ) : (
                <div className="card-answer-block">
                  <div className="answer-divider">
                    <span>Answer</span>
                    <button type="button" className="flip-back-btn" onClick={() => setFlipped(false)}>
                      <RotateCcw size={13} /> Tap to hide
                    </button>
                  </div>
                  <div className="card-answer-text">{activeCard.answer}</div>
                  {activeCard.keyFacts && activeCard.keyFacts.length > 0 && (
                    <div className="answer-chips">
                      {activeCard.keyFacts.map((fact, idx) => (
                        <span key={idx} className="fact-chip fact-chip-solid">
                          {fact}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="swipe-cue-bar">
            <span className="cue-left">&larr; Swipe left: Still learning</span>
            <span className="cue-mid">Tap: Flip</span>
            <span className="cue-right">Swipe right: Got it &rarr;</span>
          </div>
        </>
      )}
    </div>
  );
};
