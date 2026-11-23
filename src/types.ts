export type DeckId = string;

export type CardSourceType = 'paper' | 'defense';

export type Rating = 'struggling' | 'unsure' | 'got_it';

export interface DeckInfo {
  id: DeckId;
  order: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  color: string;
}

export interface Flashcard {
  id: string;
  deckId: DeckId;
  sourceType: CardSourceType;
  tag: string; // e.g., "SOP 2.1", "Defense Q17", "Chapter 1"
  question: string;
  answer: string;
  keyFacts?: string[]; // quick bullet anchors for fast recall
}

export interface TeamMember {
  id: string;
  name: string;
  shortName: string;
  initials: string;
  role: string;
  avatarColor: string;
  defaultPin: string;
}

export interface CardProgress {
  cardId: string;
  deckId: DeckId;
  attempts: number;
  gotItCount: number;
  unsureCount: number;
  strugglingCount: number;
  streak: number;
  lastRating: Rating;
  avgTimeSec: number;
  masteryScore: number; // 0 to 100
  lastReviewedAt: string;
  nextReviewAt: string;
}

export interface ReviewLog {
  id: string;
  memberId: string;
  cardId: string;
  deckId: DeckId;
  rating: Rating;
  timeSec: number;
  timestamp: string;
}

export interface MemberDeckStat {
  deckId: DeckId;
  reviewedCount: number;
  totalCards: number;
  masteredCount: number;
  strugglingCount: number;
  avgMastery: number; // 0..100 or -1 if unstudied
}

export interface MemberSummary {
  memberId: string;
  name: string;
  shortName: string;
  initials: string;
  avatarColor: string;
  role: string;
  totalReviews: number;
  uniqueCardsStudied: number;
  masteredCards: number;
  strugglingCards: number;
  overallMastery: number;
  lastActiveAt: string | null;
  weakestDeckId: DeckId | null;
  deckStats: Record<DeckId, MemberDeckStat>;
}

export interface HardCardStat {
  cardId: string;
  deckId: DeckId;
  struggleVotes: number;
  unsureVotes: number;
  totalAttempts: number;
  struggleRate: number; // 0..100
  membersStruggling: string[]; // shortNames
}

export interface TeamAnalyticsResponse {
  generatedAt: string;
  totalCards: number;
  totalTeamReviews: number;
  teamReadiness: number; // 0..100
  members: MemberSummary[];
  deckOverview: {
    deckId: DeckId;
    avgMastery: number;
    struggleRate: number;
    totalAttempts: number;
    membersTested: number;
  }[];
  hardestCards: HardCardStat[];
}
