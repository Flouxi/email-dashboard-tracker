// lib/store.js
// Storage abstraction. Uses Vercel KV (Upstash Redis) when configured
// (KV_REST_API_URL / KV_REST_API_TOKEN env vars, auto-set by Vercel when
// you attach a KV store to your project). Falls back to a local JSON file
// for local development only — the file store does NOT persist on Vercel's
// serverless functions, since disk is ephemeral there.

const path = require('path');
const fs = require('fs');

const USE_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

let kv;
if (USE_KV) {
  kv = require('@vercel/kv').kv;
}

const LOCAL_DB_PATH = path.join(__dirname, '..', '.local-data.json');

function readLocalDb() {
  if (!fs.existsSync(LOCAL_DB_PATH)) return { emails: {}, index: [] };
  return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
}

function writeLocalDb(db) {
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2));
}

/**
 * Record an event (open/click) for a given token.
 * Creates the record on first event if it doesn't exist yet.
 */
async function logEvent(token, decoded, type, extra = {}) {
  const now = new Date().toISOString();

  if (USE_KV) {
    const key = `email:${token}`;
    const existing = (await kv.get(key)) || {
      token,
      email: decoded.e,
      campaign: decoded.c,
      sentAt: new Date(decoded.s).toISOString(),
      opens: [],
      clicks: [],
    };
    if (type === 'open') existing.opens.push(now);
    if (type === 'click') existing.clicks.push({ url: extra.url || '', at: now });
    await kv.set(key, existing);
    await kv.zadd('email:index', { score: decoded.s, member: token });
    return existing;
  }

  const db = readLocalDb();
  if (!db.emails[token]) {
    db.emails[token] = {
      token,
      email: decoded.e,
      campaign: decoded.c,
      sentAt: new Date(decoded.s).toISOString(),
      opens: [],
      clicks: [],
    };
    db.index.push(token);
  }
  if (type === 'open') db.emails[token].opens.push(now);
  if (type === 'click') db.emails[token].clicks.push({ url: extra.url || '', at: now });
  writeLocalDb(db);
  return db.emails[token];
}

/**
 * Get all tracked emails, most recent first.
 */
async function getAll() {
  if (USE_KV) {
    const tokens = await kv.zrange('email:index', 0, -1, { rev: true });
    if (!tokens.length) return [];
    const records = await Promise.all(tokens.map((t) => kv.get(`email:${t}`)));
    return records.filter(Boolean);
  }

  const db = readLocalDb();
  return db.index
    .slice()
    .reverse()
    .map((t) => db.emails[t])
    .filter(Boolean);
}

/**
 * Get a single tracked email by token.
 */
async function getOne(token) {
  if (USE_KV) {
    return (await kv.get(`email:${token}`)) || null;
  }
  const db = readLocalDb();
  return db.emails[token] || null;
}

module.exports = { logEvent, getAll, getOne, USE_KV };
