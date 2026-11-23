import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const SEED_PATH = path.resolve(__dirname, '..', 'src', 'data', 'seed-content.json');

export const DEFAULT_MEMBERS = [
  { id: 'merry', name: 'Merry Apple G. Edaño', shortName: 'Merry', initials: 'ME', role: 'Team Lead', avatarColor: '#059669', defaultPin: '1111' },
  { id: 'lord', name: 'Lord Jason G. Riveral', shortName: 'Lord Jason', initials: 'LR', role: 'Member', avatarColor: '#171717', defaultPin: '2222' },
  { id: 'jerome', name: 'Jerome M. Magdadaro', shortName: 'Jerome', initials: 'JM', role: 'Member', avatarColor: '#262626', defaultPin: '3333' },
  { id: 'jhemarsh', name: 'Jhemarsh Lee Conde', shortName: 'Jhemarsh', initials: 'JC', role: 'Member', avatarColor: '#404040', defaultPin: '4444' },
  { id: 'alyza', name: 'Alyza G. Pitogo', shortName: 'Alyza', initials: 'AP', role: 'Member', avatarColor: '#525252', defaultPin: '5555' },
  { id: 'francis', name: 'Francis Keith Banan', shortName: 'Francis', initials: 'FB', role: 'Member', avatarColor: '#27272a', defaultPin: '6666' },
];

export function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function loadSeedContent() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    decks: Array.isArray(parsed.decks) ? parsed.decks : [],
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
  };
}

function buildSeedMembersMap() {
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
  return members;
}

// ==================== STORAGE STATE ====================
let mode = 'file';
let mongoClient = null;
let db = null;

function stripMongoId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

// ==================== FILE FALLBACK HELPERS ====================
function ensureFileStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const seed = loadSeedContent();
    const initial = {
      version: 2,
      members: buildSeedMembersMap(),
      decks: seed.decks,
      cards: seed.cards,
      progress: {},
      logs: [],
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readFileStore() {
  ensureFileStore();
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
    writeFileStore(store);
  }
  return store;
}

function writeFileStore(store) {
  ensureFileStore();
  const payload = JSON.stringify(store, null, 2);
  const tmpPath = `${STORE_PATH}.tmp`;
  try {
    fs.writeFileSync(tmpPath, payload, 'utf8');
    fs.renameSync(tmpPath, STORE_PATH);
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      fs.writeFileSync(STORE_PATH, payload, 'utf8');
      fs.rmSync(tmpPath, { force: true });
    } else {
      throw err;
    }
  }
}

// ==================== INIT ====================
export async function initStorage() {
  const uri = (process.env.MONGODB_URI || '').trim();
  if (!uri) {
    mode = 'file';
    ensureFileStore();
    return;
  }

  const dbName = (process.env.MONGODB_DB || 'ecostep-flashcards').trim();
  mongoClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  await mongoClient.connect();
  db = mongoClient.db(dbName);
  mode = 'mongodb';

  const membersCol = db.collection('members');
  const decksCol = db.collection('decks');
  const cardsCol = db.collection('cards');
  const progressCol = db.collection('progress');
  const logsCol = db.collection('review_logs');

  await Promise.all([
    membersCol.createIndex({ id: 1 }, { unique: true }),
    decksCol.createIndex({ id: 1 }, { unique: true }),
    cardsCol.createIndex({ id: 1 }, { unique: true }),
    cardsCol.createIndex({ deckId: 1 }),
    progressCol.createIndex({ memberId: 1, cardId: 1 }, { unique: true }),
    logsCol.createIndex({ memberId: 1, timestamp: -1 }),
  ]);

  const [memberCount, deckCount, cardCount] = await Promise.all([
    membersCol.countDocuments(),
    decksCol.countDocuments(),
    cardsCol.countDocuments(),
  ]);

  if (memberCount === 0) {
    const seedMembers = Object.values(buildSeedMembersMap());
    await membersCol.insertMany(seedMembers);
  }
  if (deckCount === 0) {
    const seed = loadSeedContent();
    if (seed.decks.length) {
      await decksCol.insertMany(seed.decks);
    }
  }
  if (cardCount === 0) {
    const seed = loadSeedContent();
    if (seed.cards.length) {
      await cardsCol.insertMany(seed.cards);
    }
  }
}

export function getStorageMode() {
  return mode;
}

// ==================== MEMBERS ====================
export async function getMembers() {
  if (mode === 'mongodb') {
    const docs = await db.collection('members').find({}).toArray();
    const byId = {};
    for (const d of docs) byId[d.id] = stripMongoId(d);
    return DEFAULT_MEMBERS.map((dm) => byId[dm.id]).filter(Boolean);
  }
  const store = readFileStore();
  return DEFAULT_MEMBERS.map((dm) => store.members[dm.id]).filter(Boolean);
}

export async function getMemberById(id) {
  if (mode === 'mongodb') {
    const doc = await db.collection('members').findOne({ id });
    return stripMongoId(doc);
  }
  const store = readFileStore();
  return store.members[id] || null;
}

// ==================== DECKS ====================
export async function getDecks() {
  if (mode === 'mongodb') {
    const docs = await db.collection('decks').find({}).sort({ order: 1 }).toArray();
    return docs.map(stripMongoId);
  }
  const store = readFileStore();
  return [...store.decks].sort((a, b) => (a.order || 0) - (b.order || 0));
}

export async function createDeck(deck) {
  if (mode === 'mongodb') {
    await db.collection('decks').insertOne({ ...deck });
    return deck;
  }
  const store = readFileStore();
  store.decks.push(deck);
  writeFileStore(store);
  return deck;
}

export async function updateDeck(id, patch) {
  if (mode === 'mongodb') {
    const res = await db.collection('decks').findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after' }
    );
    return stripMongoId(res);
  }
  const store = readFileStore();
  const idx = store.decks.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  store.decks[idx] = { ...store.decks[idx], ...patch };
  writeFileStore(store);
  return store.decks[idx];
}

export async function deleteDeck(id) {
  if (mode === 'mongodb') {
    const deck = await db.collection('decks').findOne({ id });
    if (!deck) return false;
    const deckCards = await db.collection('cards').find({ deckId: id }, { projection: { id: 1 } }).toArray();
    const cardIds = deckCards.map((c) => c.id);
    await Promise.all([
      db.collection('decks').deleteOne({ id }),
      db.collection('cards').deleteMany({ deckId: id }),
      db.collection('progress').deleteMany({ $or: [{ deckId: id }, { cardId: { $in: cardIds } }] }),
      db.collection('review_logs').deleteMany({ $or: [{ deckId: id }, { cardId: { $in: cardIds } }] }),
    ]);
    return true;
  }
  const store = readFileStore();
  if (!store.decks.some((d) => d.id === id)) return false;
  const deletedCardIds = new Set(store.cards.filter((c) => c.deckId === id).map((c) => c.id));
  store.decks = store.decks.filter((d) => d.id !== id);
  store.cards = store.cards.filter((c) => c.deckId !== id);
  for (const memberId of Object.keys(store.progress || {})) {
    for (const cId of deletedCardIds) {
      delete store.progress[memberId][cId];
    }
  }
  store.logs = (store.logs || []).filter((l) => l.deckId !== id && !deletedCardIds.has(l.cardId));
  writeFileStore(store);
  return true;
}

// ==================== CARDS ====================
export async function getCards() {
  if (mode === 'mongodb') {
    const docs = await db.collection('cards').find({}).toArray();
    return docs.map(stripMongoId);
  }
  const store = readFileStore();
  return store.cards;
}

export async function getCardById(id) {
  if (mode === 'mongodb') {
    const doc = await db.collection('cards').findOne({ id });
    return stripMongoId(doc);
  }
  const store = readFileStore();
  return store.cards.find((c) => c.id === id) || null;
}

export async function createCard(card) {
  if (mode === 'mongodb') {
    await db.collection('cards').insertOne({ ...card });
    return card;
  }
  const store = readFileStore();
  store.cards.push(card);
  writeFileStore(store);
  return card;
}

export async function updateCard(id, patch) {
  if (mode === 'mongodb') {
    const res = await db.collection('cards').findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after' }
    );
    if (!res) return null;
    if (patch.deckId) {
      await Promise.all([
        db.collection('progress').updateMany({ cardId: id }, { $set: { deckId: patch.deckId } }),
        db.collection('review_logs').updateMany({ cardId: id }, { $set: { deckId: patch.deckId } }),
      ]);
    }
    return stripMongoId(res);
  }
  const store = readFileStore();
  const idx = store.cards.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  store.cards[idx] = { ...store.cards[idx], ...patch };
  if (patch.deckId) {
    for (const memberId of Object.keys(store.progress || {})) {
      if (store.progress[memberId][id]) {
        store.progress[memberId][id].deckId = patch.deckId;
      }
    }
    for (const l of store.logs || []) {
      if (l.cardId === id) {
        l.deckId = patch.deckId;
      }
    }
  }
  writeFileStore(store);
  return store.cards[idx];
}

export async function deleteCard(id) {
  if (mode === 'mongodb') {
    const res = await db.collection('cards').deleteOne({ id });
    if (res.deletedCount === 0) return false;
    await Promise.all([
      db.collection('progress').deleteMany({ cardId: id }),
      db.collection('review_logs').deleteMany({ cardId: id }),
    ]);
    return true;
  }
  const store = readFileStore();
  if (!store.cards.some((c) => c.id === id)) return false;
  store.cards = store.cards.filter((c) => c.id !== id);
  for (const memberId of Object.keys(store.progress || {})) {
    delete store.progress[memberId][id];
  }
  store.logs = (store.logs || []).filter((l) => l.cardId !== id);
  writeFileStore(store);
  return true;
}

// ==================== REVIEWS & ANALYTICS ====================
export async function getMemberProgress(memberId) {
  if (mode === 'mongodb') {
    const docs = await db.collection('progress').find({ memberId }).toArray();
    const map = {};
    for (const d of docs) {
      const clean = stripMongoId(d);
      map[clean.cardId] = clean;
    }
    return map;
  }
  const store = readFileStore();
  return store.progress[memberId] || {};
}

export async function getMemberLogs(memberId, limit = 200) {
  if (mode === 'mongodb') {
    const docs = await db
      .collection('review_logs')
      .find({ memberId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    return docs.reverse().map(stripMongoId);
  }
  const store = readFileStore();
  return store.logs.filter((l) => l.memberId === memberId).slice(-limit);
}

export async function saveReview(memberId, cardId, deckId, rating, timeSec, computeNextProgress) {
  const clampedTime = Math.max(1, Math.min(300, Math.round(Number(timeSec) || 5)));
  const log = {
    id: crypto.randomUUID(),
    memberId,
    cardId,
    deckId,
    rating,
    timeSec: clampedTime,
    timestamp: new Date().toISOString(),
  };

  if (mode === 'mongodb') {
    const progressCol = db.collection('progress');
    const existingDoc = await progressCol.findOne({ memberId, cardId });
    const existing = stripMongoId(existingDoc);
    const updated = computeNextProgress(existing, cardId, deckId, rating, clampedTime);
    const toSave = { memberId, ...updated };
    await Promise.all([
      progressCol.updateOne({ memberId, cardId }, { $set: toSave }, { upsert: true }),
      db.collection('review_logs').insertOne({ ...log }),
    ]);
    return { progress: updated, log };
  }

  const store = readFileStore();
  if (!store.progress[memberId]) {
    store.progress[memberId] = {};
  }
  const existing = store.progress[memberId][cardId];
  const updated = computeNextProgress(existing, cardId, deckId, rating, clampedTime);
  store.progress[memberId][cardId] = updated;
  store.logs.push(log);
  if (store.logs.length > 10000) {
    store.logs = store.logs.slice(-10000);
  }
  writeFileStore(store);
  return { progress: updated, log };
}

export async function getAllAnalyticsData() {
  if (mode === 'mongodb') {
    const [members, decks, cards, progressDocs, totalLogsCount] = await Promise.all([
      getMembers(),
      getDecks(),
      getCards(),
      db.collection('progress').find({}).toArray(),
      db.collection('review_logs').countDocuments(),
    ]);
    const progressByMember = {};
    for (const d of progressDocs) {
      const clean = stripMongoId(d);
      if (!progressByMember[clean.memberId]) progressByMember[clean.memberId] = {};
      progressByMember[clean.memberId][clean.cardId] = clean;
    }
    return { members, decks, cards, progressByMember, totalLogsCount };
  }

  const store = readFileStore();
  const members = DEFAULT_MEMBERS.map((dm) => store.members[dm.id]).filter(Boolean);
  const decks = [...store.decks].sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    members,
    decks,
    cards: store.cards,
    progressByMember: store.progress || {},
    totalLogsCount: (store.logs || []).length,
  };
}
