import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  Users,
  User,
  Flame,
  TrendingUp,
  Target,
  Play,
} from 'lucide-react';
import { CardProgress, DeckId, DeckInfo, Flashcard, TeamAnalyticsResponse } from '../types';

interface AnalyticsViewProps {
  decks: DeckInfo[];
  cards: Flashcard[];
  currentUserId: string;
  myProgress: Record<string, CardProgress>;
  teamAnalytics: TeamAnalyticsResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onDrillCards: (cardIds: string[]) => void;
  onStudyDeck: (deckId: DeckId) => void;
}

function scoreColorClass(score: number): string {
  if (score < 0) return 'cell-empty';
  if (score >= 75) return 'cell-good';
  if (score >= 50) return 'cell-mid';
  return 'cell-bad';
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  decks,
  cards,
  currentUserId,
  myProgress,
  teamAnalytics,
  loading,
  onRefresh,
  onDrillCards,
  onStudyDeck,
}) => {
  const [scope, setScope] = useState<'team' | 'me'>('team');

  const cardLookup = useMemo(() => {
    const map: Record<string, Flashcard> = {};
    cards.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [cards]);

  const deckLookup = useMemo(() => {
    const map: Record<string, DeckInfo> = {};
    decks.forEach((d) => {
      map[d.id] = d;
    });
    return map;
  }, [decks]);

  // Personal stats
  const myStats = useMemo(() => {
    const entries = Object.values(myProgress);
    const mastered = entries.filter((e) => e.masteryScore >= 75).length;
    const struggling = entries.filter((e) => e.lastRating === 'struggling' || e.masteryScore < 50);
    const avgMastery = entries.length
      ? Math.round(entries.reduce((s, x) => s + x.masteryScore, 0) / entries.length)
      : 0;
    const totalReviews = entries.reduce((s, x) => s + x.attempts, 0);

    const perDeck = decks.map((d) => {
      const deckCards = cards.filter((c) => c.deckId === d.id);
      const de = entries.filter((e) => e.deckId === d.id);
      const avg = de.length ? Math.round(de.reduce((s, x) => s + x.masteryScore, 0) / de.length) : -1;
      const weak = de.filter((e) => e.lastRating === 'struggling' || e.masteryScore < 50).length;
      return {
        deck: d,
        studied: de.length,
        total: deckCards.length,
        avgMastery: avg,
        weakCount: weak,
      };
    });

    return {
      studied: entries.length,
      mastered,
      strugglingCount: struggling.length,
      strugglingIds: struggling.map((s) => s.cardId),
      avgMastery,
      totalReviews,
      perDeck,
    };
  }, [myProgress, decks, cards]);

  // Weakest team topic
  const weakestTeamDeck = useMemo(() => {
    if (!teamAnalytics) return null;
    const tested = teamAnalytics.deckOverview.filter((d) => d.totalAttempts > 0);
    if (!tested.length) return null;
    return [...tested].sort((a, b) => a.avgMastery - b.avgMastery || b.struggleRate - a.struggleRate)[0];
  }, [teamAnalytics]);

  return (
    <div className="analytics-view">
      {/* Scope Switcher + Refresh */}
      <div className="analytics-top">
        <div className="segmented">
          <button
            type="button"
            className={scope === 'team' ? 'active' : ''}
            onClick={() => setScope('team')}
          >
            <Users size={15} /> Team (6)
          </button>
          <button
            type="button"
            className={scope === 'me' ? 'active' : ''}
            onClick={() => setScope('me')}
          >
            <User size={15} /> My Stats
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onRefresh} disabled={loading} title="Refresh analytics">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {scope === 'team' ? (
        !teamAnalytics ? (
          <div className="empty-inline">Loading team analytics...</div>
        ) : (
          <>
            {/* KPI Summary Row */}
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-label">
                  <TrendingUp size={14} /> Team Readiness
                </div>
                <div className="kpi-value">{teamAnalytics.teamReadiness}%</div>
                <div className="kpi-sub">avg mastery</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">
                  <Target size={14} /> Team Reviews
                </div>
                <div className="kpi-value">{teamAnalytics.totalTeamReviews}</div>
                <div className="kpi-sub">total ratings</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">
                  <Flame size={14} /> Weak Cards
                </div>
                <div className="kpi-value text-danger">{teamAnalytics.hardestCards.length}</div>
                <div className="kpi-sub">flagged across team</div>
              </div>
            </div>

            {/* #1 Struggle Callout */}
            {weakestTeamDeck ? (
              <div className="alert-callout">
                <div className="alert-callout-icon">
                  <AlertTriangle size={20} />
                </div>
                <div className="alert-callout-body">
                  <div className="alert-callout-title">Biggest Team Struggle Area</div>
                  <div className="alert-callout-topic">
                    {deckLookup[weakestTeamDeck.deckId]?.title}
                  </div>
                  <div className="alert-callout-meta">
                    Avg Mastery: <strong>{weakestTeamDeck.avgMastery}%</strong> &bull; Struggle Rate:{' '}
                    <strong>{weakestTeamDeck.struggleRate}%</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="callout-btn"
                  onClick={() => onStudyDeck(weakestTeamDeck.deckId)}
                >
                  Review
                </button>
              </div>
            ) : (
              <div className="info-callout">
                Start reviewing flashcards so team struggle analytics populate automatically for all 6 members!
              </div>
            )}

            {/* Topic Struggle Bars */}
            <div className="panel">
              <div className="panel-title">Where We Are Struggling (By Topic)</div>
              <div className="topic-bars">
                {teamAnalytics.deckOverview.map((d) => {
                  const info = deckLookup[d.deckId];
                  const hasData = d.totalAttempts > 0;
                  const barColor = !hasData
                    ? '#e5e5e5'
                    : d.avgMastery >= 75
                    ? '#059669'
                    : d.avgMastery >= 50
                    ? '#737373'
                    : '#171717';
                  return (
                    <div key={d.deckId} className="topic-bar-item" onClick={() => onStudyDeck(d.deckId)}>
                      <div className="topic-bar-header">
                        <span className="topic-bar-name">{info?.shortTitle}</span>
                        <span className="topic-bar-nums">
                          {hasData ? `${d.avgMastery}% mastery · ${d.struggleRate}% struggle` : 'Not tested yet'}
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${hasData ? Math.max(6, d.avgMastery) : 0}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 6 x 6 Member × Topic Heatmap */}
            <div className="panel">
              <div className="panel-title">Team × Topic Heatmap (Mastery %)</div>
              <p className="panel-sub">Spot which member needs help on which chapter.</p>
              <div className="heatmap-scroll">
                <table className="heatmap-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      {decks.map((d) => (
                        <th key={d.id} title={d.title}>
                          {d.order}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {teamAnalytics.members.map((m) => (
                      <tr key={m.memberId} className={m.memberId === currentUserId ? 'row-me' : ''}>
                        <td className="hm-member">
                          <span className="mini-dot" style={{ backgroundColor: m.avatarColor }} />
                          <span>{m.shortName}</span>
                        </td>
                        {decks.map((d) => {
                          const stat = m.deckStats[d.id];
                          const val = stat ? stat.avgMastery : -1;
                          return (
                            <td key={d.id}>
                              <span className={`hm-cell ${scoreColorClass(val)}`}>
                                {val < 0 ? '—' : `${val}`}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="heatmap-legend">
                {decks.map((d) => (
                  <span key={d.id}>
                    {d.order}: {d.shortTitle}
                  </span>
                ))}
              </div>
            </div>

            {/* Hardest Cards Across Team */}
            <div className="panel">
              <div className="panel-header-row">
                <div>
                  <div className="panel-title">Hardest Cards Across the Team</div>
                  <p className="panel-sub">Most frequently rated Struggling or Unsure</p>
                </div>
                {teamAnalytics.hardestCards.length > 0 && (
                  <button
                    type="button"
                    className="danger-btn btn-xs"
                    onClick={() => onDrillCards(teamAnalytics.hardestCards.map((c) => c.cardId))}
                  >
                    <Play size={12} /> Drill All
                  </button>
                )}
              </div>

              {teamAnalytics.hardestCards.length === 0 ? (
                <div className="empty-inline">No struggling cards recorded yet.</div>
              ) : (
                <div className="hard-list">
                  {teamAnalytics.hardestCards.slice(0, 8).map((hc) => {
                    const card = cardLookup[hc.cardId];
                    if (!card) return null;
                    return (
                      <div key={hc.cardId} className="hard-item">
                        <div className="hard-item-top">
                          <span className="badge badge-bad">{hc.struggleRate}% miss rate</span>
                          <span className="badge badge-topic">{card.tag}</span>
                        </div>
                        <div className="hard-q">{card.question}</div>
                        <div className="hard-meta">
                          {hc.membersStruggling.length > 0
                            ? `Struggling: ${hc.membersStruggling.join(', ')}`
                            : `${hc.totalAttempts} team attempt(s)`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Member Leaderboard / Activity */}
            <div className="panel">
              <div className="panel-title">All 6 Team Members</div>
              <div className="member-stat-list">
                {teamAnalytics.members.map((m) => (
                  <div key={m.memberId} className="member-stat-row">
                    <div className="avatar avatar-sm" style={{ backgroundColor: m.avatarColor }}>
                      {m.initials}
                    </div>
                    <div className="member-stat-body">
                      <div className="member-stat-name">
                        {m.name} {m.memberId === currentUserId && <span className="you-tag">You</span>}
                      </div>
                      <div className="member-stat-meta">
                        {m.uniqueCardsStudied}/{teamAnalytics.totalCards} cards &bull; {m.totalReviews} reviews
                        {m.weakestDeckId && (
                          <>
                            {' '}
                            &bull; Weakest: <strong>{deckLookup[m.weakestDeckId]?.shortTitle}</strong>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={`score-pill ${scoreColorClass(m.uniqueCardsStudied ? m.overallMastery : -1)}`}>
                      {m.uniqueCardsStudied ? `${m.overallMastery}%` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      ) : (
        /* MY STATS VIEW */
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">My Mastery</div>
              <div className="kpi-value">{myStats.avgMastery}%</div>
              <div className="kpi-sub">{myStats.mastered} mastered</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Cards Studied</div>
              <div className="kpi-value">
                {myStats.studied}/{cards.length}
              </div>
              <div className="kpi-sub">{myStats.totalReviews} reviews</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">My Weak Spots</div>
              <div className="kpi-value text-danger">{myStats.strugglingCount}</div>
              <div className="kpi-sub">need review</div>
            </div>
          </div>

          {myStats.strugglingIds.length > 0 && (
            <button
              type="button"
              className="primary-btn full-width"
              onClick={() => onDrillCards(myStats.strugglingIds)}
            >
              <Play size={16} /> Drill My {myStats.strugglingIds.length} Weak Cards Now
            </button>
          )}

          <div className="panel">
            <div className="panel-title">My Mastery by Chapter / Topic</div>
            <div className="topic-bars">
              {myStats.perDeck.map(({ deck, studied, total, avgMastery, weakCount }) => {
                const hasData = studied > 0;
                const barColor = !hasData
                  ? '#e5e5e5'
                  : avgMastery >= 75
                  ? '#059669'
                  : avgMastery >= 50
                  ? '#737373'
                  : '#171717';
                return (
                  <div key={deck.id} className="topic-bar-item" onClick={() => onStudyDeck(deck.id)}>
                    <div className="topic-bar-header">
                      <span className="topic-bar-name">{deck.shortTitle}</span>
                      <span className="topic-bar-nums">
                        {studied}/{total} studied
                        {hasData ? ` · ${avgMastery}%` : ''}
                        {weakCount > 0 ? ` · ${weakCount} weak` : ''}
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${hasData ? Math.max(6, avgMastery) : 0}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
