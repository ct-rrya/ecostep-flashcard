import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const SEED_PATH = path.resolve(__dirname, '..', 'src', 'data', 'seed-content.json');
const TOKEN_SECRET = process.env.SESSION_SECRET || 'ecostep-flashcards-ctu-2026-secret';
const EDITOR_MEMBER_ID = 'merry';

const DEFAULT_MEMBERS = [
  { id: 'merry', name: 'Merry Apple G. Edaño', shortName: 'Merry', initials: 'ME', role: 'Team Lead', avatarColor: '#059669', defaultPin: '1111' },
  { id: 'lord', name: 'Lord Jason G. Riveral', shortName: 'Lord Jason', initials: 'LR', role: 'Member', avatarColor: '#171717', defaultPin: '2222' },
  { id: 'jerome', name: 'Jerome M. Magdadaro', shortName: 'Jerome', initials: 'JM', role: 'Member', avatarColor: '#262626', defaultPin: '3333' },
  { id: 'jhemarsh', name: 'Jhemarsh Lee Conde', shortName: 'Jhemarsh', initials: 'JC', role: 'Member', avatarColor: '#404040', defaultPin: '4444' },
  { id: 'alyza', name: 'Alyza G. Pitogo', shortName: 'Alyza', initials: 'AP', role: 'Member', avatarColor: '#525252', defaultPin: '5555' },
  { id: 'francis', name: 'Francis Keith Banan', shortName: 'Francis', initials: 'FB', role: 'Member', avatarColor: '#27272a', defaultPin: '6666' },
];

function loadSeedContent() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    decks: Array.isArray(parsed.decks) ? parsed.decks : [],
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
  };
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

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

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const members = {};
    for (const m of DEFAULT_MEMBERS) {
      const salt = crypto.randomBytes(12).toString('hex');
      members[m.id] = {
        id: m.id,
        name: m.name,
        shortName: m.shortName,
        initials: m.initials,
        role: m.role,
        avatarColor: m.avatarColor,
        pinSalt: salt,
        pinHash: hashPin(m.defaultPin, salt),
        pinChanged: false,
      };
    }
    const seed = loadSeedContent();
    const initial = {
      version: 2,
      members,
      decks: seed.decks,
      cards: seed.cards,
      progress: {}, // { [memberId]: { [cardId]: CardProgress } }
      logs: [], // ReviewLog[]
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  let migrated = false;
  if (!Array.isArray(store.decks) || !Array.isArray(store.cards)) {
    const seed = loadSeedContent();
    if (!Array.isArray(store.decks)) {
      store.decks = seed.decks;
      migrated = true;
    }
    if (!Array.isArray(store.cards)) {
      store.cards = seed.cards;
      migrated = true;
    }
  }
  if (migrated) {
    store.version = 2;
    writeStore(store);
  }
  return store;
}

function writeStore(store) {
  ensureStore();
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: 'server', lanUrls: getLanAddresses() });
});

app.get('/api/members', (_req, res) => {
  const store = readStore();
  const members = DEFAULT_MEMBERS.map((dm) => {
    const m = store.members[dm.id];
    return {
      id: m.id,
      name: m.name,
      shortName: m.shortName,
      initials: m.initials,
      role: m.role,
      avatarColor: m.avatarColor,
      pinChanged: Boolean(m.pinChanged),
    };
  });
  res.json({ members });
});

app.post('/api/auth/login', (req, res) => {
  const { memberId, pin } = req.body || {};
  if (!memberId || !pin) {
    return res.status(400).json({ error: 'Member and 4-digit PIN are required.' });
  }
  const store = readStore();
  const member = store.members[memberId];
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
});

app.post('/api/auth/change-pin', authMiddleware, (_req, res) => {
  return res.status(403).json({ error: 'Changing PIN is disabled.' });
});

// ==================== CONTENT (DECKS & CARDS) ====================
app.get('/api/content', authMiddleware, (_req, res) => {
  const store = readStore();
  const decks = [...store.decks].sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json({ decks, cards: store.cards });
});

app.post('/api/decks', authMiddleware, requireEditorMiddleware, (req, res) => {
  const { title, shortTitle, subtitle = '' } = req.body || {};
  if (!String(title || '').trim() || !String(shortTitle || '').trim()) {
    return res.status(400).json({ error: 'Deck title and short title are required.' });
  }
  const store = readStore();
  const baseSlug = slugify(shortTitle || title) || 'deck';
  let id = baseSlug;
  let suffix = 2;
  while (store.decks.some((d) => d.id === id)) {
    id = `${baseSlug}-${suffix++}`;
  }
  const maxOrder = store.decks.reduce((m, d) => Math.max(m, Number(d.order) || 0), 0);
  const deck = {
    id,
    order: maxOrder + 1,
    title: String(title).trim(),
    shortTitle: String(shortTitle).trim(),
    subtitle: String(subtitle || '').trim(),
    color: '#059669',
  };
  store.decks.push(deck);
  writeStore(store);
  res.status(201).json({ deck });
});

app.put('/api/decks/:id', authMiddleware, requireEditorMiddleware, (req, res) => {
  const { id } = req.params;
  const { title, shortTitle, subtitle } = req.body || {};
  const store = readStore();
  const idx = store.decks.findIndex((d) => d.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Deck not found.' });
  }
  if (!String(title || '').trim() || !String(shortTitle || '').trim()) {
    return res.status(400).json({ error: 'Deck title and short title are required.' });
  }
  store.decks[idx] = {
    ...store.decks[idx],
    title: String(title).trim(),
    shortTitle: String(shortTitle).trim(),
    subtitle: subtitle !== undefined ? String(subtitle).trim() : store.decks[idx].subtitle,
  };
  writeStore(store);
  res.json({ deck: store.decks[idx] });
});

app.delete('/api/decks/:id', authMiddleware, requireEditorMiddleware, (req, res) => {
  const { id } = req.params;
  const store = readStore();
  const exists = store.decks.some((d) => d.id === id);
  if (!exists) {
    return res.status(404).json({ error: 'Deck not found.' });
  }
  const deletedCardIds = new Set(store.cards.filter((c) => c.deckId === id).map((c) => c.id));
  store.decks = store.decks.filter((d) => d.id !== id);
  store.cards = store.cards.filter((c) => c.deckId !== id);

  for (const memberId of Object.keys(store.progress || {})) {
    for (const cId of deletedCardIds) {
      delete store.progress[memberId][cId];
    }
  }
  store.logs = (store.logs || []).filter((l) => l.deckId !== id && !deletedCardIds.has(l.cardId));

  writeStore(store);
  res.json({ ok: true });
});

app.post('/api/cards', authMiddleware, requireEditorMiddleware, (req, res) => {
  const { deckId, sourceType = 'paper', tag = '', question, answer, keyFacts = [] } = req.body || {};
  if (!deckId || !String(question || '').trim() || !String(answer || '').trim()) {
    return res.status(400).json({ error: 'Deck, question, and answer are required.' });
  }
  const store = readStore();
  if (!store.decks.some((d) => d.id === deckId)) {
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
  store.cards.push(card);
  writeStore(store);
  res.status(201).json({ card });
});

app.put('/api/cards/:id', authMiddleware, requireEditorMiddleware, (req, res) => {
  const { id } = req.params;
  const { deckId, sourceType, tag, question, answer, keyFacts } = req.body || {};
  const store = readStore();
  const idx = store.cards.findIndex((c) => c.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Card not found.' });
  }
  const nextDeckId = deckId || store.cards[idx].deckId;
  if (!store.decks.some((d) => d.id === nextDeckId)) {
    return res.status(404).json({ error: 'Selected deck does not exist.' });
  }
  if (!String(question || '').trim() || !String(answer || '').trim()) {
    return res.status(400).json({ error: 'Question and answer are required.' });
  }

  const cleanType = sourceType === 'defense' ? 'defense' : sourceType === 'paper' ? 'paper' : store.cards[idx].sourceType;
  const cleanFacts = Array.isArray(keyFacts)
    ? keyFacts.map((f) => String(f).trim()).filter(Boolean)
    : store.cards[idx].keyFacts || [];

  const updated = {
    ...store.cards[idx],
    deckId: nextDeckId,
    sourceType: cleanType,
    tag: tag !== undefined ? String(tag).trim() || (cleanType === 'defense' ? 'Defense Q&A' : 'Paper Fact') : store.cards[idx].tag,
    question: String(question).trim(),
    answer: String(answer).trim(),
    keyFacts: cleanFacts,
  };
  store.cards[idx] = updated;

  // Keep progress/logs in sync if card moved between decks
  for (const memberId of Object.keys(store.progress || {})) {
    if (store.progress[memberId][id]) {
      store.progress[memberId][id].deckId = nextDeckId;
    }
  }
  for (const l of store.logs || []) {
    if (l.cardId === id) {
      l.deckId = nextDeckId;
    }
  }

  writeStore(store);
  res.json({ card: updated });
});

app.delete('/api/cards/:id', authMiddleware, requireEditorMiddleware, (req, res) => {
  const { id } = req.params;
  const store = readStore();
  if (!store.cards.some((c) => c.id === id)) {
    return res.status(404).json({ error: 'Card not found.' });
  }
  store.cards = store.cards.filter((c) => c.id !== id);
  for (const memberId of Object.keys(store.progress || {})) {
    delete store.progress[memberId][id];
  }
  store.logs = (store.logs || []).filter((l) => l.cardId !== id);

  writeStore(store);
  res.json({ ok: true });
});

// ==================== REVIEWS & ANALYTICS ====================
app.get('/api/reviews/me', authMiddleware, (req, res) => {
  const store = readStore();
  const progressMap = store.progress[req.memberId] || {};
  const myLogs = store.logs.filter((l) => l.memberId === req.memberId).slice(-200);
  res.json({ progress: progressMap, recentLogs: myLogs });
});

app.post('/api/reviews', authMiddleware, (req, res) => {
  const { cardId, deckId, rating, timeSec } = req.body || {};
  if (!cardId || !deckId || !['struggling', 'unsure', 'got_it'].includes(rating)) {
    return res.status(400).json({ error: 'Invalid review payload.' });
  }
  const store = readStore();
  if (!store.progress[req.memberId]) {
    store.progress[req.memberId] = {};
  }
  const existing = store.progress[req.memberId][cardId];
  const updated = computeNextProgress(existing, cardId, deckId, rating, timeSec);
  store.progress[req.memberId][cardId] = updated;

  const log = {
    id: crypto.randomUUID(),
    memberId: req.memberId,
    cardId,
    deckId,
    rating,
    timeSec: Math.max(1, Math.min(300, Math.round(Number(timeSec) || 5))),
    timestamp: new Date().toISOString(),
  };
  store.logs.push(log);
  if (store.logs.length > 10000) {
    store.logs = store.logs.slice(-10000);
  }
  writeStore(store);
  res.status(201).json({ progress: updated, log });
});

app.delete('/api/reviews/me', authMiddleware, (_req, res) => {
  return res.status(403).json({ error: 'Resetting study progress is disabled.' });
});

app.post('/api/analytics/team', authMiddleware, (_req, res) => {
  const store = readStore();
  const decks = [...store.decks].sort((a, b) => (a.order || 0) - (b.order || 0));
  const deckIds = decks.map((d) => d.id);
  const deckCardCounts = {};
  for (const d of decks) {
    deckCardCounts[d.id] = store.cards.filter((c) => c.deckId === d.id).length;
  }
  const totalCards = store.cards.length;

  const membersSummary = [];
  const cardAgg = {};
  const deckAgg = {};
  for (const d of deckIds) {
    deckAgg[d] = { deckId: d, masterySum: 0, masteryCount: 0, struggleAttempts: 0, totalAttempts: 0, membersTested: new Set() };
  }

  for (const dm of DEFAULT_MEMBERS) {
    const m = store.members[dm.id];
    const pMap = store.progress[dm.id] || {};
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
        deckAgg[p.deckId].membersTested.add(dm.id);
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
    totalTeamReviews: store.logs.length,
    teamReadiness,
    members: membersSummary,
    deckOverview,
    hardestCards,
  });
});

// Serve built React app in production
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

ensureStore();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nEcoStep Flashcards Server running on http://localhost:${PORT}`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log('Share with your team on the same Wi-Fi:');
    lan.forEach((u) => console.log(`  -> ${u}`));
  }
});
