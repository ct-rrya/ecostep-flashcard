import { DECKS, TEAM_MEMBERS } from '../data/team';
import { FLASHCARDS } from '../data/flashcards';
import { CardProgress, CardSourceType, DeckId, DeckInfo, Flashcard, Rating, TeamAnalyticsResponse } from '../types';

export interface AuthUser {
  id: string;
  name: string;
  shortName: string;
  initials: string;
  role: string;
  avatarColor: string;
  pinChanged?: boolean;
}

const TOKEN_KEY = 'ecostep_fc_token';
const USER_KEY = 'ecostep_fc_user';
const LOCAL_STORE_KEY = 'ecostep_fc_offline_store_v1';

export function getSavedSession(): { token: string; user: AuthUser } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    if (!token || !rawUser) return null;
    return { token, user: JSON.parse(rawUser) };
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Offline fallback store (only used if server is unreachable)
interface LocalStore {
  pins: Record<string, string>;
  decks?: DeckInfo[];
  cards?: Flashcard[];
  progress: Record<string, Record<string, CardProgress>>;
  totalLogs: number;
}

function readLocalStore(): LocalStore {
  try {
    const raw = localStorage.getItem(LOCAL_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalStore;
      if (!parsed.decks) parsed.decks = [...DECKS];
      if (!parsed.cards) parsed.cards = [...FLASHCARDS];
      return parsed;
    }
  } catch {
    // ignore
  }
  const pins: Record<string, string> = {};
  for (const m of TEAM_MEMBERS) pins[m.id] = m.defaultPin;
  return { pins, decks: [...DECKS], cards: [...FLASHCARDS], progress: {}, totalLogs: 0 };
}

function writeLocalStore(store: LocalStore) {
  localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(store));
}

function assertOfflineEditor() {
  const session = getSavedSession();
  if (session?.user.id !== 'merry') {
    throw new Error('Only Merry Apple (Team Lead) can edit decks and flashcards.');
  }
}

function isNetworkFailure(err: unknown): boolean {
  return err instanceof Error && (err.message.includes('Failed to fetch') || err.message.includes('Request failed (5'));
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const session = getSavedSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function checkServerHealth(): Promise<{ online: boolean; lanUrls: string[] }> {
  try {
    const data = await apiFetch<{ ok: boolean; lanUrls?: string[] }>('/api/health');
    return { online: Boolean(data.ok), lanUrls: data.lanUrls || [] };
  } catch {
    return { online: false, lanUrls: [] };
  }
}

export async function loginMember(memberId: string, pin: string): Promise<{ token: string; member: AuthUser; offline?: boolean }> {
  try {
    const data = await apiFetch<{ token: string; member: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ memberId, pin }),
    });
    saveSession(data.token, data.member);
    return data;
  } catch (err) {
    if (!isNetworkFailure(err)) {
      throw err;
    }
    const local = readLocalStore();
    const m = TEAM_MEMBERS.find((x) => x.id === memberId);
    if (!m) throw new Error('Account not found.');
    if ((local.pins[memberId] || m.defaultPin) !== pin) {
      throw new Error('Incorrect PIN. Try again.');
    }
    const user: AuthUser = {
      id: m.id,
      name: m.name,
      shortName: m.shortName,
      initials: m.initials,
      role: m.role,
      avatarColor: m.avatarColor,
    };
    const token = `offline-${memberId}`;
    saveSession(token, user);
    return { token, member: user, offline: true };
  }
}

export async function fetchContent(): Promise<{ decks: DeckInfo[]; cards: Flashcard[] }> {
  try {
    return await apiFetch<{ decks: DeckInfo[]; cards: Flashcard[] }>('/api/content');
  } catch {
    const local = readLocalStore();
    return { decks: local.decks || DECKS, cards: local.cards || FLASHCARDS };
  }
}

export async function createDeck(payload: { title: string; shortTitle: string; subtitle: string }): Promise<DeckInfo> {
  try {
    const data = await apiFetch<{ deck: DeckInfo }>('/api/decks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.deck;
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    assertOfflineEditor();
    const local = readLocalStore();
    const decks = local.decks || [...DECKS];
    const slug = payload.shortTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'deck';
    let id = slug;
    let i = 2;
    while (decks.some((d) => d.id === id)) id = `${slug}-${i++}`;
    const deck: DeckInfo = {
      id,
      order: decks.reduce((m, d) => Math.max(m, d.order), 0) + 1,
      title: payload.title.trim(),
      shortTitle: payload.shortTitle.trim(),
      subtitle: payload.subtitle.trim(),
      color: '#059669',
    };
    local.decks = [...decks, deck];
    writeLocalStore(local);
    return deck;
  }
}

export async function updateDeck(id: string, payload: { title: string; shortTitle: string; subtitle: string }): Promise<DeckInfo> {
  try {
    const data = await apiFetch<{ deck: DeckInfo }>(`/api/decks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return data.deck;
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    assertOfflineEditor();
    const local = readLocalStore();
    const decks = local.decks || [...DECKS];
    const idx = decks.findIndex((d) => d.id === id);
    if (idx === -1) throw new Error('Deck not found.');
    decks[idx] = { ...decks[idx], ...payload };
    local.decks = decks;
    writeLocalStore(local);
    return decks[idx];
  }
}

export async function deleteDeck(id: string): Promise<void> {
  try {
    await apiFetch(`/api/decks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    assertOfflineEditor();
    const local = readLocalStore();
    local.decks = (local.decks || [...DECKS]).filter((d) => d.id !== id);
    local.cards = (local.cards || [...FLASHCARDS]).filter((c) => c.deckId !== id);
    writeLocalStore(local);
  }
}

export async function createCard(payload: {
  deckId: DeckId;
  sourceType: CardSourceType;
  tag: string;
  question: string;
  answer: string;
  keyFacts: string[];
}): Promise<Flashcard> {
  try {
    const data = await apiFetch<{ card: Flashcard }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.card;
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    assertOfflineEditor();
    const local = readLocalStore();
    const card: Flashcard = {
      id: `card-${Date.now().toString(36)}`,
      deckId: payload.deckId,
      sourceType: payload.sourceType,
      tag: payload.tag.trim() || (payload.sourceType === 'defense' ? 'Defense Q&A' : 'Paper Fact'),
      question: payload.question.trim(),
      answer: payload.answer.trim(),
      keyFacts: payload.keyFacts,
    };
    local.cards = [...(local.cards || [...FLASHCARDS]), card];
    writeLocalStore(local);
    return card;
  }
}

export async function updateCard(
  id: string,
  payload: {
    deckId: DeckId;
    sourceType: CardSourceType;
    tag: string;
    question: string;
    answer: string;
    keyFacts: string[];
  }
): Promise<Flashcard> {
  try {
    const data = await apiFetch<{ card: Flashcard }>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return data.card;
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    assertOfflineEditor();
    const local = readLocalStore();
    const cards = local.cards || [...FLASHCARDS];
    const idx = cards.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Card not found.');
    cards[idx] = { ...cards[idx], ...payload };
    local.cards = cards;
    writeLocalStore(local);
    return cards[idx];
  }
}

export async function deleteCard(id: string): Promise<void> {
  try {
    await apiFetch(`/api/cards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    assertOfflineEditor();
    const local = readLocalStore();
    local.cards = (local.cards || [...FLASHCARDS]).filter((c) => c.id !== id);
    writeLocalStore(local);
  }
}

export async function fetchMyProgress(): Promise<Record<string, CardProgress>> {
  try {
    const data = await apiFetch<{ progress: Record<string, CardProgress> }>('/api/reviews/me');
    return data.progress || {};
  } catch {
    const session = getSavedSession();
    if (!session) return {};
    const local = readLocalStore();
    return local.progress[session.user.id] || {};
  }
}

export async function submitCardReview(
  cardId: string,
  deckId: DeckId,
  rating: Rating,
  timeSec: number
): Promise<CardProgress> {
  try {
    const data = await apiFetch<{ progress: CardProgress }>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ cardId, deckId, rating, timeSec }),
    });
    return data.progress;
  } catch {
    const session = getSavedSession();
    const memberId = session?.user.id || 'merry';
    const local = readLocalStore();
    if (!local.progress[memberId]) local.progress[memberId] = {};
    const prev = local.progress[memberId][cardId];
    const now = new Date();
    const attempts = (prev?.attempts || 0) + 1;
    const gotItCount = (prev?.gotItCount || 0) + (rating === 'got_it' ? 1 : 0);
    const unsureCount = (prev?.unsureCount || 0) + (rating === 'unsure' ? 1 : 0);
    const strugglingCount = (prev?.strugglingCount || 0) + (rating === 'struggling' ? 1 : 0);
    const streak = rating === 'got_it' ? (prev?.streak || 0) + 1 : 0;
    const clamped = Math.max(1, Math.min(300, Math.round(timeSec || 5)));
    const avgTimeSec = Math.round((((prev?.avgTimeSec || clamped) * (attempts - 1)) + clamped) / attempts);
    const hist = ((gotItCount * 100) + (unsureCount * 50)) / attempts;
    const masteryScore = Math.max(
      0,
      Math.min(100, Math.round(rating === 'got_it' ? Math.min(100, hist + 15) : rating === 'unsure' ? Math.min(65, hist) : Math.min(30, hist * 0.5)))
    );
    const delayMin = rating === 'struggling' ? 2 : rating === 'unsure' ? 30 : streak === 1 ? 360 : 1440;
    const updated: CardProgress = {
      cardId,
      deckId,
      attempts,
      gotItCount,
      unsureCount,
      strugglingCount,
      streak,
      lastRating: rating,
      avgTimeSec,
      masteryScore,
      lastReviewedAt: now.toISOString(),
      nextReviewAt: new Date(now.getTime() + delayMin * 60000).toISOString(),
    };
    local.progress[memberId][cardId] = updated;
    local.totalLogs += 1;
    writeLocalStore(local);
    return updated;
  }
}

export async function fetchTeamAnalytics(
  decksList: DeckInfo[] = DECKS,
  cardsList: Flashcard[] = FLASHCARDS
): Promise<TeamAnalyticsResponse> {
  try {
    return await apiFetch<TeamAnalyticsResponse>('/api/analytics/team', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch {
    const local = readLocalStore();
    const activeDecks = local.decks || decksList;
    const activeCards = local.cards || cardsList;
    const deckCardCounts: Record<string, number> = {};
    for (const d of activeDecks) {
      deckCardCounts[d.id] = activeCards.filter((c) => c.deckId === d.id).length;
    }

    const members = TEAM_MEMBERS.map((m) => {
      const entries = Object.values(local.progress[m.id] || {});
      const deckStats = {} as TeamAnalyticsResponse['members'][number]['deckStats'];
      let weakestDeckId: DeckId | null = null;
      let lowest = 101;
      for (const d of activeDecks) {
        const de = entries.filter((e) => e.deckId === d.id);
        const avg = de.length ? Math.round(de.reduce((s, x) => s + x.masteryScore, 0) / de.length) : -1;
        deckStats[d.id] = {
          deckId: d.id,
          reviewedCount: de.length,
          totalCards: deckCardCounts[d.id] || 0,
          masteredCount: de.filter((x) => x.masteryScore >= 75).length,
          strugglingCount: de.filter((x) => x.lastRating === 'struggling' || x.masteryScore < 50).length,
          avgMastery: avg,
        };
        if (avg >= 0 && avg < lowest) {
          lowest = avg;
          weakestDeckId = d.id;
        }
      }
      return {
        memberId: m.id,
        name: m.name,
        shortName: m.shortName,
        initials: m.initials,
        avatarColor: m.avatarColor,
        role: m.role,
        totalReviews: entries.reduce((s, x) => s + x.attempts, 0),
        uniqueCardsStudied: entries.length,
        masteredCards: entries.filter((x) => x.masteryScore >= 75).length,
        strugglingCards: entries.filter((x) => x.lastRating === 'struggling' || x.masteryScore < 50).length,
        overallMastery: entries.length ? Math.round(entries.reduce((s, x) => s + x.masteryScore, 0) / entries.length) : 0,
        lastActiveAt: entries.length ? entries.map((e) => e.lastReviewedAt).sort().reverse()[0] : null,
        weakestDeckId,
        deckStats,
      };
    });

    const deckOverview = activeDecks.map((d) => {
      const all = members.flatMap((m) => Object.values(local.progress[m.memberId] || {}).filter((e) => e.deckId === d.id));
      const attempts = all.reduce((s, x) => s + x.attempts, 0);
      const misses = all.reduce((s, x) => s + x.strugglingCount + x.unsureCount * 0.5, 0);
      return {
        deckId: d.id,
        avgMastery: all.length ? Math.round(all.reduce((s, x) => s + x.masteryScore, 0) / all.length) : -1,
        struggleRate: attempts ? Math.round((misses / attempts) * 100) : 0,
        totalAttempts: attempts,
        membersTested: members.filter((m) => m.deckStats[d.id]?.reviewedCount > 0).length,
      };
    });

    const active = members.filter((m) => m.uniqueCardsStudied > 0);
    return {
      generatedAt: new Date().toISOString(),
      totalCards: activeCards.length,
      totalTeamReviews: local.totalLogs,
      teamReadiness: active.length ? Math.round(active.reduce((s, m) => s + m.overallMastery, 0) / active.length) : 0,
      members,
      deckOverview,
      hardestCards: [],
    };
  }
}
