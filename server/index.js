import './env.js';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  initStorage,
  getStorageMode,
  hashPin,
  getMembers,
  getMemberById,
  getDecks,
  createDeck,
  updateDeck,
  deleteDeck,
  getCards,
  getCardById,
  createCard,
  updateCard,
  deleteCard,
  getMemberProgress,
  getMemberLogs,
  saveReview,
  getAllAnalyticsData,
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4000);
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const TOKEN_SECRET = process.env.SESSION_SECRET || 'ecostep-flashcards-ctu-2026-secret';
const EDITOR_MEMBER_ID = 'merry';

function createToken(memberId) {
  const payload = Buffer.from(JSON.stringify({ memberId, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
}

function computeNextProgress(existing, cardId, deckId, rating, timeSec) {
  const now = new Date();
  const clampedTime = Math.max(1, Math.min(300, Math.round(Number(timeSec) || 5)));

  const prev = existing || {
    cardId,
    deckId,
    attempts: 0,
    gotItCount: 0,
    unsureCount: 0,
    strugglingCount: 0,
    streak: 0,
    lastRating: rating,
    avgTimeSec: clampedTime,
    masteryScore: 0,
    lastReviewedAt: now.toISOString(),
    nextReviewAt: now.toISOString(),
  };

  const attempts = prev.attempts + 1;
  const gotItCount = prev.gotItCount + (rating === 'got_it' ? 1 : 0);
  const unsureCount = prev.unsureCount + (rating === 'unsure' ? 1 : 0);
  const strugglingCount = prev.strugglingCount + (rating === 'struggling' ? 1 : 0);
  const streak = rating === 'got_it' ? prev.streak + 1 : 0;
  const avgTimeSec = Math.round(((prev.avgTimeSec * prev.attempts) + clampedTime) / attempts);

  const historicalScore = ((gotItCount * 100) + (unsureCount * 50)) / attempts;
  const recentBonus =
    rating === 'got_it'
      ? Math.min(100, historicalScore + 15)
      : rating === 'unsure'
      ? Math.min(65, historicalScore)
      : Math.min(30, historicalScore * 0.5);
  const masteryScore = Math.max(0, Math.min(100, Math.round(recentBonus)));

  let delayMinutes = 10;
  if (rating === 'struggling') {
    delayMinutes = 2;
  } else if (rating === 'unsure') {
    delayMinutes = 30;
  } else {
    delayMinutes = streak === 1 ? 60 * 6 : streak === 2 ? 60 * 24 : 60 * 24 * 3;
  }
  const nextReviewAt = new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString();

  return {
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
    nextReviewAt,
  };
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

const app = express();
app.use(cors());
app.use(express.json());

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const decoded = verifyToken(token);
  if (!decoded || !decoded.memberId) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }
  req.memberId = decoded.memberId;
  next();
}

function requireEditorMiddleware(req, res, next) {
  if (req.memberId !== EDITOR_MEMBER_ID) {
    return res.status(403).json({ error: 'Only Merry Apple (Team Lead) can edit decks and flashcards.' });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: 'server', storage: getStorageMode(), lanUrls: getLanAddresses() });
});

app.get(
  '/api/members',
  asyncHandler(async (_req, res) => {
    const rawMembers = await getMembers();
    const members = rawMembers.map((m) => ({
      id: m.id,
      name: m.name,
      shortName: m.shortName,
      initials: m.initials,
      role: m.role,
      avatarColor: m.avatarColor,
      pinChanged: Boolean(m.pinChanged),
    }));
    res.json({ members });
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { memberId, pin } = req.body || {};
    if (!memberId || !pin) {
      return res.status(400).json({ error: 'Member and 4-digit PIN are required.' });
    }
    const member = await getMemberById(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member account not found.' });
    }
    const attemptHash = hashPin(pin, member.pinSalt);
    if (attemptHash !== member.pinHash) {
      return res.status(401).json({ error: 'Incorrect PIN. Try again.' });
    }
    const token = createToken(member.id);
    res.json({
      token,
      member: {
        id: member.id,
        name: member.name,
        shortName: member.shortName,
        initials: member.initials,
        role: member.role,
        avatarColor: member.avatarColor,
        pinChanged: Boolean(member.pinChanged),
      },
    });
  })
);

app.post('/api/auth/change-pin', authMiddleware, (_req, res) => {
  return res.status(403).json({ error: 'Changing PIN is disabled.' });
});

// ==================== CONTENT (DECKS & CARDS) ====================
app.get(
  '/api/content',
  authMiddleware,
  asyncHandler(async (_req, res) => {
    const [decks, cards] = await Promise.all([getDecks(), getCards()]);
    res.json({ decks, cards });
  })
);

app.post(
  '/api/decks',
  authMiddleware,
  requireEditorMiddleware,
  asyncHandler(async (req, res) => {
    const { title, shortTitle, subtitle = '' } = req.body || {};
    if (!String(title || '').trim() || !String(shortTitle || '').trim()) {
      return res.status(400).json({ error: 'Deck title and short title are required.' });
    }
    const existingDecks = await getDecks();
    const baseSlug = slugify(shortTitle || title) || 'deck';
    let id = baseSlug;
    let suffix = 2;
    while (existingDecks.some((d) => d.id === id)) {
      id = `${baseSlug}-${suffix++}`;
    }
    const maxOrder = existingDecks.reduce((m, d) => Math.max(m, Number(d.order) || 0), 0);
    const deck = {
      id,
      order: maxOrder + 1,
      title: String(title).trim(),
      shortTitle: String(shortTitle).trim(),
      subtitle: String(subtitle || '').trim(),
      color: '#059669',
    };
    await createDeck(deck);
    res.status(201).json({ deck });
  })
);

app.put(
  '/api/decks/:id',
  authMiddleware,
  requireEditorMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, shortTitle, subtitle } = req.body || {};
    if (!String(title || '').trim() || !String(shortTitle || '').trim()) {
      return res.status(400).json({ error: 'Deck title and short title are required.' });
    }
    const patch = {
      title: String(title).trim(),
      shortTitle: String(shortTitle).trim(),
    };
    if (subtitle !== undefined) {
      patch.subtitle = String(subtitle).trim();
    }
    const updated = await updateDeck(id, patch);
    if (!updated) {
      return res.status(404).json({ error: 'Deck not found.' });
    }
    res.json({ deck: updated });
  })
);

app.delete(
  '/api/decks/:id',
  authMiddleware,
  requireEditorMiddleware,
  asyncHandler(async (req, res) => {
    const deleted = await deleteDeck(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Deck not found.' });
    }
    res.json({ ok: true });
  })
);

app.post(
  '/api/cards',
  authMiddleware,
  requireEditorMiddleware,
  asyncHandler(async (req, res) => {
    const { deckId, sourceType = 'paper', tag = '', question, answer, keyFacts = [] } = req.body || {};
    if (!deckId || !String(question || '').trim() || !String(answer || '').trim()) {
      return res.status(400).json({ error: 'Deck, question, and answer are required.' });
    }
    const decks = await getDecks();
    if (!decks.some((d) => d.id === deckId)) {
      return res.status(404).json({ error: 'Selected deck does not exist.' });
    }
    const cleanType = sourceType === 'defense' ? 'defense' : 'paper';
    const cleanFacts = Array.isArray(keyFacts)
      ? keyFacts.map((f) => String(f).trim()).filter(Boolean)
      : [];

    const card = {
      id: `card-${crypto.randomBytes(4).toString('hex')}`,
      deckId,
      sourceType: cleanType,
      tag: String(tag || '').trim() || (cleanType === 'defense' ? 'Defense Q&A' : 'Paper Fact'),
      question: String(question).trim(),
      answer: String(answer).trim(),
      keyFacts: cleanFacts,
    };
    await createCard(card);
    res.status(201).json({ card });
  })
);

app.put(
  '/api/cards/:id',
  authMiddleware,
  requireEditorMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { deckId, sourceType, tag, question, answer, keyFacts } = req.body || {};
    const existing = await getCardById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Card not found.' });
    }
    const nextDeckId = deckId || existing.deckId;
    const decks = await getDecks();
    if (!decks.some((d) => d.id === nextDeckId)) {
      return res.status(404).json({ error: 'Selected deck does not exist.' });
    }
    if (!String(question || '').trim() || !String(answer || '').trim()) {
      return res.status(400).json({ error: 'Question and answer are required.' });
    }

    const cleanType = sourceType === 'defense' ? 'defense' : sourceType === 'paper' ? 'paper' : existing.sourceType;
    const cleanFacts = Array.isArray(keyFacts)
      ? keyFacts.map((f) => String(f).trim()).filter(Boolean)
      : existing.keyFacts || [];

    const patch = {
      deckId: nextDeckId,
      sourceType: cleanType,
      tag: tag !== undefined ? String(tag).trim() || (cleanType === 'defense' ? 'Defense Q&A' : 'Paper Fact') : existing.tag,
      question: String(question).trim(),
      answer: String(answer).trim(),
      keyFacts: cleanFacts,
    };

    const updated = await updateCard(id, patch);
    res.json({ card: updated });
  })
);

app.delete(
  '/api/cards/:id',
  authMiddleware,
  requireEditorMiddleware,
  asyncHandler(async (req, res) => {
    const deleted = await deleteCard(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Card not found.' });
    }
    res.json({ ok: true });
  })
);

// ==================== REVIEWS & ANALYTICS ====================
app.get(
  '/api/reviews/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const [progress, recentLogs] = await Promise.all([
      getMemberProgress(req.memberId),
      getMemberLogs(req.memberId, 200),
    ]);
    res.json({ progress, recentLogs });
  })
);

app.post(
  '/api/reviews',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { cardId, deckId, rating, timeSec } = req.body || {};
    if (!cardId || !deckId || !['struggling', 'unsure', 'got_it'].includes(rating)) {
      return res.status(400).json({ error: 'Invalid review payload.' });
    }
    const result = await saveReview(req.memberId, cardId, deckId, rating, timeSec, computeNextProgress);
    res.status(201).json(result);
  })
);

app.delete('/api/reviews/me', authMiddleware, (_req, res) => {
  return res.status(403).json({ error: 'Resetting study progress is disabled.' });
});

app.post(
  '/api/analytics/team',
  authMiddleware,
  asyncHandler(async (_req, res) => {
    const { members, decks, cards, progressByMember, totalLogsCount } = await getAllAnalyticsData();
    const deckIds = decks.map((d) => d.id);
    const deckCardCounts = {};
    for (const d of decks) {
      deckCardCounts[d.id] = cards.filter((c) => c.deckId === d.id).length;
    }
    const totalCards = cards.length;

    const membersSummary = [];
    const cardAgg = {};
    const deckAgg = {};
    for (const d of deckIds) {
      deckAgg[d] = { deckId: d, masterySum: 0, masteryCount: 0, struggleAttempts: 0, totalAttempts: 0, membersTested: new Set() };
    }

    for (const m of members) {
      const pMap = progressByMember[m.id] || {};
      const entries = Object.values(pMap);

      let totalReviews = 0;
      let masteredCards = 0;
      let strugglingCards = 0;
      let masterySum = 0;
      let lastActiveAt = null;

      const deckStats = {};
      for (const d of deckIds) {
        deckStats[d] = {
          deckId: d,
          reviewedCount: 0,
          totalCards: Number(deckCardCounts[d] || 0),
          masteredCount: 0,
          strugglingCount: 0,
          avgMastery: -1,
          _sum: 0,
        };
      }

      for (const p of entries) {
        totalReviews += p.attempts;
        masterySum += p.masteryScore;
        if (p.masteryScore >= 75) masteredCards += 1;
        if (p.lastRating === 'struggling' || p.masteryScore < 50) strugglingCards += 1;
        if (!lastActiveAt || p.lastReviewedAt > lastActiveAt) {
          lastActiveAt = p.lastReviewedAt;
        }

        if (deckStats[p.deckId]) {
          const ds = deckStats[p.deckId];
          ds.reviewedCount += 1;
          ds._sum += p.masteryScore;
          if (p.masteryScore >= 75) ds.masteredCount += 1;
          if (p.lastRating === 'struggling' || p.masteryScore < 50) ds.strugglingCount += 1;
        }

        if (deckAgg[p.deckId]) {
          deckAgg[p.deckId].masterySum += p.masteryScore;
          deckAgg[p.deckId].masteryCount += 1;
          deckAgg[p.deckId].struggleAttempts += p.strugglingCount + (p.unsureCount * 0.5);
          deckAgg[p.deckId].totalAttempts += p.attempts;
          deckAgg[p.deckId].membersTested.add(m.id);
        }

        if (!cardAgg[p.cardId]) {
          cardAgg[p.cardId] = {
            cardId: p.cardId,
            deckId: p.deckId,
            struggleVotes: 0,
            unsureVotes: 0,
            totalAttempts: 0,
            membersStruggling: new Set(),
          };
        }
        cardAgg[p.cardId].struggleVotes += p.strugglingCount;
        cardAgg[p.cardId].unsureVotes += p.unsureCount;
        cardAgg[p.cardId].totalAttempts += p.attempts;
        if (p.lastRating === 'struggling' || p.masteryScore < 50) {
          cardAgg[p.cardId].membersStruggling.add(m.shortName);
        }
      }

      let weakestDeckId = null;
      let lowestDeckMastery = 101;
      for (const d of deckIds) {
        const ds = deckStats[d];
        if (ds.reviewedCount > 0) {
          ds.avgMastery = Math.round(ds._sum / ds.reviewedCount);
          if (ds.avgMastery < lowestDeckMastery) {
            lowestDeckMastery = ds.avgMastery;
            weakestDeckId = d;
          }
        }
        delete ds._sum;
      }

      const overallMastery = entries.length > 0 ? Math.round(masterySum / entries.length) : 0;

      membersSummary.push({
        memberId: m.id,
        name: m.name,
        shortName: m.shortName,
        initials: m.initials,
        avatarColor: m.avatarColor,
        role: m.role,
        totalReviews,
        uniqueCardsStudied: entries.length,
        masteredCards,
        strugglingCards,
        overallMastery,
        lastActiveAt,
        weakestDeckId,
        deckStats,
      });
    }

    const deckOverview = deckIds.map((d) => {
      const a = deckAgg[d];
      return {
        deckId: d,
        avgMastery: a.masteryCount > 0 ? Math.round(a.masterySum / a.masteryCount) : -1,
        struggleRate: a.totalAttempts > 0 ? Math.round((a.struggleAttempts / a.totalAttempts) * 100) : 0,
        totalAttempts: a.totalAttempts,
        membersTested: a.membersTested.size,
      };
    });

    const hardestCards = Object.values(cardAgg)
      .map((c) => {
        const weightedMiss = c.struggleVotes + c.unsureVotes * 0.5;
        const struggleRate = c.totalAttempts > 0 ? Math.round((weightedMiss / c.totalAttempts) * 100) : 0;
        return {
          cardId: c.cardId,
          deckId: c.deckId,
          struggleVotes: c.struggleVotes,
          unsureVotes: c.unsureVotes,
          totalAttempts: c.totalAttempts,
          struggleRate,
          membersStruggling: Array.from(c.membersStruggling),
        };
      })
      .filter((c) => c.struggleVotes > 0 || c.unsureVotes > 0)
      .sort((a, b) => b.struggleRate - a.struggleRate || b.struggleVotes - a.struggleVotes)
      .slice(0, 12);

    const activeMembers = membersSummary.filter((m) => m.uniqueCardsStudied > 0);
    const teamReadiness =
      activeMembers.length > 0
        ? Math.round(activeMembers.reduce((sum, m) => sum + m.overallMastery, 0) / activeMembers.length)
        : 0;

    res.json({
      generatedAt: new Date().toISOString(),
      totalCards,
      totalTeamReviews: totalLogsCount,
      teamReadiness,
      members: membersSummary,
      deckOverview,
      hardestCards,
    });
  })
);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// Serve built React app in production
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

initStorage()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\nEcoStep Flashcards Server running on http://localhost:${PORT} (storage: ${getStorageMode()})`);
      const lan = getLanAddresses();
      if (lan.length) {
        console.log('Share with your team on the same Wi-Fi:');
        lan.forEach((u) => console.log(`  -> ${u}`));
      }
    });
  })
  .catch((err) => {
    console.error('Failed to initialize storage:', err);
    process.exit(1);
  });
