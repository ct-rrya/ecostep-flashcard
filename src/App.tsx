import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Layers, BarChart3, UserCircle2, Footprints } from 'lucide-react';
import {
  AuthUser,
  checkServerHealth,
  clearSession,
  fetchContent,
  fetchMyProgress,
  fetchTeamAnalytics,
  getSavedSession,
  submitCardReview,
} from './api/client';
import { DECKS as SEED_DECKS } from './data/team';
import { FLASHCARDS as SEED_CARDS } from './data/flashcards';
import { CardProgress, DeckId, DeckInfo, Flashcard, Rating, TeamAnalyticsResponse } from './types';
import { LoginScreen } from './components/LoginScreen';
import { StudyModeFilter, StudyView } from './components/StudyView';
import { DecksView } from './components/DecksView';
import { AnalyticsView } from './components/AnalyticsView';
import { AccountView } from './components/AccountView';

type Tab = 'study' | 'decks' | 'analytics' | 'account';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getSavedSession()?.user || null);
  const [activeTab, setActiveTab] = useState<Tab>('study');
  const [decks, setDecks] = useState<DeckInfo[]>(SEED_DECKS);
  const [cards, setCards] = useState<Flashcard[]>(SEED_CARDS);
  const [progress, setProgress] = useState<Record<string, CardProgress>>({});
  const [teamAnalytics, setTeamAnalytics] = useState<TeamAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [serverOnline, setServerOnline] = useState(true);
  const [lanUrls, setLanUrls] = useState<string[]>([]);

  // Study controls
  const [selectedDeck, setSelectedDeck] = useState<DeckId | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<StudyModeFilter>('all');
  const [customCardIds, setCustomCardIds] = useState<string[] | null>(null);

  const loadUserData = useCallback(async () => {
    const [health, content, prog] = await Promise.all([
      checkServerHealth(),
      fetchContent(),
      fetchMyProgress(),
    ]);
    setServerOnline(health.online);
    setLanUrls(health.lanUrls);
    setDecks(content.decks);
    setCards(content.cards);
    setProgress(prog);
  }, []);

  const loadAnalytics = useCallback(
    async (decksList: DeckInfo[] = decks, cardsList: Flashcard[] = cards) => {
      setAnalyticsLoading(true);
      try {
        const data = await fetchTeamAnalytics(decksList, cardsList);
        setTeamAnalytics(data);
      } finally {
        setAnalyticsLoading(false);
      }
    },
    [decks, cards]
  );

  const refreshContent = useCallback(async () => {
    const [content, prog] = await Promise.all([fetchContent(), fetchMyProgress()]);
    setDecks(content.decks);
    setCards(content.cards);
    setProgress(prog);
    setSelectedDeck((curr) =>
      curr !== 'all' && !content.decks.some((d) => d.id === curr) ? 'all' : curr
    );
    await loadAnalytics(content.decks, content.cards);
  }, [loadAnalytics]);

  useEffect(() => {
    if (user) {
      loadUserData();
      loadAnalytics();
    }
  }, [user, loadUserData, loadAnalytics]);

  useEffect(() => {
    if (user && activeTab === 'analytics') {
      loadAnalytics();
    }
  }, [user, activeTab, loadAnalytics]);

  async function handleRate(card: Flashcard, rating: Rating, timeSec: number) {
    const updated = await submitCardReview(card.id, card.deckId, rating, timeSec);
    setProgress((prev) => ({ ...prev, [card.id]: updated }));
  }

  function handleStudyDeck(deckId: DeckId, weakOnly = false) {
    setSelectedDeck(deckId);
    setCustomCardIds(null);
    setModeFilter(weakOnly ? 'weak' : 'all');
    setActiveTab('study');
  }

  function handleDrillCards(cardIds: string[]) {
    if (!cardIds.length) return;
    setSelectedDeck('all');
    setCustomCardIds(cardIds);
    setModeFilter('custom');
    setActiveTab('study');
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setProgress({});
    setTeamAnalytics(null);
    setActiveTab('study');
  }

  if (!user) {
    return <LoginScreen onSuccess={(u) => setUser(u)} />;
  }

  const studiedCount = Object.keys(progress).length;
  const canEdit = user.id === 'merry';

  return (
    <div className="app-shell">
      {/* Compact Sticky Top Header */}
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="top-logo">
            <Footprints size={18} />
          </div>
          <div>
            <div className="top-title">EcoStep Prep</div>
            <div className="top-sub">
              {activeTab === 'study' && 'Flashcard Review'}
              {activeTab === 'decks' && 'Chapters & Lookup'}
              {activeTab === 'analytics' && 'Team Struggle Analytics'}
              {activeTab === 'account' && 'My Account'}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="top-avatar-btn"
          onClick={() => setActiveTab('account')}
          title={user.name}
        >
          <span className="avatar avatar-xs" style={{ backgroundColor: user.avatarColor }}>
            {user.initials}
          </span>
          <span className="top-user-name">{user.shortName}</span>
        </button>
      </header>

      {/* Main Scrollable Content */}
      <main className="main-content">
        {activeTab === 'study' && (
          <StudyView
            decks={decks}
            cards={cards}
            progress={progress}
            selectedDeck={selectedDeck}
            modeFilter={modeFilter}
            customCardIds={customCardIds}
            onChangeDeck={(d) => {
              setSelectedDeck(d);
              if (modeFilter === 'custom') setModeFilter('all');
            }}
            onChangeMode={(m) => {
              setModeFilter(m);
              if (m !== 'custom') setCustomCardIds(null);
            }}
            onRate={handleRate}
          />
        )}

        {activeTab === 'decks' && (
          <DecksView
            decks={decks}
            cards={cards}
            progress={progress}
            canEdit={canEdit}
            onStudyDeck={handleStudyDeck}
            onContentChange={refreshContent}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView
            decks={decks}
            cards={cards}
            currentUserId={user.id}
            myProgress={progress}
            teamAnalytics={teamAnalytics}
            loading={analyticsLoading}
            onRefresh={() => loadAnalytics()}
            onDrillCards={handleDrillCards}
            onStudyDeck={(deckId) => handleStudyDeck(deckId, false)}
          />
        )}

        {activeTab === 'account' && (
          <AccountView
            user={user}
            serverOnline={serverOnline}
            lanUrls={lanUrls}
            studiedCount={studiedCount}
            totalCards={cards.length}
            onLogout={handleLogout}
          />
        )}
      </main>

      {/* Mobile-First Bottom Tab Bar */}
      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          type="button"
          className={`nav-item ${activeTab === 'study' ? 'active' : ''}`}
          onClick={() => setActiveTab('study')}
        >
          <BookOpen size={20} />
          <span>Study</span>
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'decks' ? 'active' : ''}`}
          onClick={() => setActiveTab('decks')}
        >
          <Layers size={20} />
          <span>Decks</span>
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <BarChart3 size={20} />
          <span>Analytics</span>
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'account' ? 'active' : ''}`}
          onClick={() => setActiveTab('account')}
        >
          <UserCircle2 size={20} />
          <span>Account</span>
        </button>
      </nav>
    </div>
  );
}
