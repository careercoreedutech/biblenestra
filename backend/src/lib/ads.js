// ADS: the remote ad-rules document (validated, versioned) and the event aggregator.
//
// Rules are one JSON document stored as a new row in ad_config on every save (the newest row wins), so
// admins can change ad behaviour from the dashboard without an app release. The app fetches
// GET /ads/config (HTTP-cached ~1 min, in-isolate cache 1 min; the app refreshes every ~8 min and on foreground → changes arrive within ~10 min).
//
// Events (POST /ads/events) are never stored one by one: they are folded into daily aggregates
// (ad_daily per surface/placement/format, ad_revenue_daily per surface/currency) and a small per-user
// daily counter (ad_user_daily) that enforces abuse limits.
import { q, one } from './db.js';
import { bad } from './http.js';

export const SURFACES = ['video', 'audio', 'pdf', 'feed', 'reader'];
// Event surfaces also include ads outside the configurable surfaces (games, rewarded "support" ads)
export const EVENT_SURFACES = [...SURFACES, 'game', 'rewarded', 'other'];
export const EVENT_TYPES = ['requested', 'impression', 'completed', 'failed', 'clicked', 'paid'];
export const FORMATS = ['interstitial', 'rewarded', 'banner', 'native'];

export const DEFAULT_AD_CONFIG = Object.freeze({
  enabled: true,
  surfaces: { video: true, audio: true, pdf: true, feed: true, reader: true },
  video: {
    preRoll: true,
    midRolls: true,
    skipAfterSec: 5, // our own countdown/"ad break" UI; AdMob decides skippability of its own ads
    noticeSec: 3, // "Ad break in 3…" notice the player shows before a mid-roll
    minTailSec: 60, // never start a mid-roll in the last minute of a video
    // A video uses the band with the largest fromMin it reaches (fromMin is inclusive).
    // ads = total ads for that video INCLUDING the pre-roll; the rest are mid-rolls at `positions`
    // (minutes, or % of the duration when unit = 'pct'). Missing positions are spread evenly.
    bands: [
      { fromMin: 0, ads: 1, unit: 'min', positions: [] }, // up to 4 min: 1 ad (pre-roll)
      { fromMin: 4, ads: 1, unit: 'min', positions: [] }, // 5–8 min: 1 ad (pre-roll)
      { fromMin: 8, ads: 2, unit: 'pct', positions: [50] }, // over 8 min: pre-roll + 1 mid-roll halfway
      { fromMin: 20, ads: 3, unit: 'min', positions: [5, 12] }, // 20 min+: pre-roll + ~5 min + ~12 min
    ],
  },
  audio: { preRoll: true, betweenEvery: 3, skipAfterSec: 5 },
  pdf: { preRoll: true, skipAfterSec: 5 },
  feed: { every: 3 },
  disabledCategories: [],
  caps: { minSecondsBetween: 120, maxPerHour: 6, maxPerDay: 30 },
});

const clone = (x) => JSON.parse(JSON.stringify(x));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function boolAt(v, def, field) {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'boolean') throw bad(`${field} must be true or false`, 'BAD_AD_CONFIG');
  return v;
}
function numAt(v, def, field, { min, max, integer = true }) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
    throw bad(`${field} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}`, 'BAD_AD_CONFIG');
  }
  return n;
}
function objAt(v, field) {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) throw bad(`${field} must be an object`, 'BAD_AD_CONFIG');
  return v;
}

/**
 * Validates an ad-rules document and fills anything missing from the defaults. Unknown keys are dropped.
 * Throws ApiError(400, BAD_AD_CONFIG) with a readable message naming the field.
 */
export function normalizeAdConfig(input) {
  if (!isObj(input)) throw bad('config must be an object', 'BAD_AD_CONFIG');
  const d = DEFAULT_AD_CONFIG;
  const out = {};
  out.enabled = boolAt(input.enabled, d.enabled, 'enabled');

  const s = objAt(input.surfaces, 'surfaces');
  out.surfaces = {};
  for (const k of SURFACES) out.surfaces[k] = boolAt(s[k], d.surfaces[k], `surfaces.${k}`);

  const v = objAt(input.video, 'video');
  out.video = {
    preRoll: boolAt(v.preRoll, d.video.preRoll, 'video.preRoll'),
    midRolls: boolAt(v.midRolls, d.video.midRolls, 'video.midRolls'),
    skipAfterSec: numAt(v.skipAfterSec, d.video.skipAfterSec, 'video.skipAfterSec', { min: 0, max: 60 }),
    noticeSec: numAt(v.noticeSec, d.video.noticeSec, 'video.noticeSec', { min: 0, max: 10 }),
    minTailSec: numAt(v.minTailSec, d.video.minTailSec, 'video.minTailSec', { min: 0, max: 600 }),
  };
  const rawBands = v.bands === undefined || v.bands === null ? clone(d.video.bands) : v.bands;
  if (!Array.isArray(rawBands) || rawBands.length < 1 || rawBands.length > 8) {
    throw bad('video.bands must be a list of 1 to 8 duration bands', 'BAD_AD_CONFIG');
  }
  const bands = rawBands.map((b, i) => {
    const f = `video.bands[${i}]`;
    if (!isObj(b)) throw bad(`${f} must be an object`, 'BAD_AD_CONFIG');
    const unit = b.unit === undefined || b.unit === null ? 'min' : b.unit;
    if (unit !== 'min' && unit !== 'pct') throw bad(`${f}.unit must be "min" or "pct"`, 'BAD_AD_CONFIG');
    const fromMin = numAt(b.fromMin, undefined, `${f}.fromMin`, { min: 0, max: 600, integer: false });
    if (fromMin === undefined) throw bad(`${f}.fromMin is required`, 'BAD_AD_CONFIG');
    const ads = numAt(b.ads, undefined, `${f}.ads`, { min: 0, max: 6 });
    if (ads === undefined) throw bad(`${f}.ads is required`, 'BAD_AD_CONFIG');
    const pos = b.positions === undefined || b.positions === null ? [] : b.positions;
    if (!Array.isArray(pos) || pos.length > 6) throw bad(`${f}.positions must be a list of up to 6 numbers`, 'BAD_AD_CONFIG');
    const positions = pos.map((p, j) => numAt(p, undefined, `${f}.positions[${j}]`, unit === 'pct'
      ? { min: 1, max: 95, integer: false } : { min: 0.5, max: 600, integer: false }))
      .filter((p) => p !== undefined)
      .sort((a, b2) => a - b2);
    return { fromMin, ads, unit, positions };
  }).sort((a, b) => a.fromMin - b.fromMin);
  if (bands[0].fromMin !== 0) throw bad('The first video band must start at 0 minutes', 'BAD_AD_CONFIG');
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i].fromMin === bands[i - 1].fromMin) throw bad(`Two video bands start at ${bands[i].fromMin} minutes`, 'BAD_AD_CONFIG');
  }
  out.video.bands = bands;

  const a = objAt(input.audio, 'audio');
  out.audio = {
    preRoll: boolAt(a.preRoll, d.audio.preRoll, 'audio.preRoll'),
    betweenEvery: numAt(a.betweenEvery, d.audio.betweenEvery, 'audio.betweenEvery', { min: 0, max: 50 }),
    skipAfterSec: numAt(a.skipAfterSec, d.audio.skipAfterSec, 'audio.skipAfterSec', { min: 0, max: 60 }),
  };
  const p = objAt(input.pdf, 'pdf');
  out.pdf = {
    preRoll: boolAt(p.preRoll, d.pdf.preRoll, 'pdf.preRoll'),
    skipAfterSec: numAt(p.skipAfterSec, d.pdf.skipAfterSec, 'pdf.skipAfterSec', { min: 0, max: 60 }),
  };
  const fd = objAt(input.feed, 'feed');
  out.feed = { every: numAt(fd.every, d.feed.every, 'feed.every', { min: 2, max: 50 }) };

  const cats = input.disabledCategories === undefined || input.disabledCategories === null ? [] : input.disabledCategories;
  if (!Array.isArray(cats) || cats.length > 50) throw bad('disabledCategories must be a list of up to 50 names', 'BAD_AD_CONFIG');
  out.disabledCategories = [...new Set(cats.map((c, i) => {
    if (typeof c !== 'string' || !c.trim() || c.trim().length > 40) throw bad(`disabledCategories[${i}] must be a short name`, 'BAD_AD_CONFIG');
    return c.trim().toLowerCase();
  }))];

  const cp = objAt(input.caps, 'caps');
  out.caps = {
    minSecondsBetween: numAt(cp.minSecondsBetween, d.caps.minSecondsBetween, 'caps.minSecondsBetween', { min: 30, max: 3600 }),
    maxPerHour: numAt(cp.maxPerHour, d.caps.maxPerHour, 'caps.maxPerHour', { min: 0, max: 20 }),
    maxPerDay: numAt(cp.maxPerDay, d.caps.maxPerDay, 'caps.maxPerDay', { min: 0, max: 100 }),
  };
  if (out.caps.maxPerDay < out.caps.maxPerHour) throw bad('caps.maxPerDay can’t be lower than caps.maxPerHour', 'BAD_AD_CONFIG');
  return out;
}

// ---------- reading / saving ----------
let cache = null; // { key, at, value } — per isolate; saves are visible here at once, elsewhere within CACHE_MS
const CACHE_MS = 60 * 1000;
const envKey = (env) => env.__db || env.DATABASE_URL || 'default';

const rowShape = (r) => (r
  ? { version: r.version, updatedAt: new Date(r.created_at).toISOString(), config: normalizeAdConfig(r.config) }
  : { version: 0, updatedAt: null, config: normalizeAdConfig({}) });

/** The current rules: { version, updatedAt, config } (version 0 = built-in defaults, nothing saved yet). */
export async function getAdConfig(env, { fresh = false } = {}) {
  const key = envKey(env);
  if (!fresh && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await one(env, 'SELECT version, config, created_at FROM ad_config ORDER BY version DESC LIMIT 1');
  let value;
  try { value = rowShape(row); } catch (e) { value = rowShape(null); } // a bad stored row never breaks the app
  cache = { key, at: Date.now(), value };
  return value;
}

export async function saveAdConfig(env, admin, input, note) {
  const config = normalizeAdConfig(input);
  const row = await one(env, 'INSERT INTO ad_config (config, note, created_by) VALUES ($1::jsonb, $2, $3) RETURNING version, config, created_at',
    [JSON.stringify(config), note || null, admin ? admin.id : null]);
  cache = null;
  return rowShape(row);
}

export async function adConfigHistory(env, limit = 10) {
  const rows = await q(env, `SELECT a.version, a.note, a.created_at, u.display_name AS admin_name FROM ad_config a
    LEFT JOIN users u ON u.id = a.created_by ORDER BY a.version DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({ version: r.version, note: r.note || '', admin: r.admin_name || null, createdAt: new Date(r.created_at).toISOString() }));
}

// ---------- events ----------
export const EVENT_LIMITS = Object.freeze({
  batch: 50, // events per request
  eventsPerDay: 600, // per user, all types
  impressionsPerDay: 150, // per user — far above what the caps allow, so only abuse hits it
  paidPerDay: 150,
  maxPaidValue: 5, // one impression worth more than 5 units of currency is not believable → dropped
});

const token = (v, fallback) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,23}$/.test(s) ? s : fallback;
};

/** Cleans one raw event; returns null when it must be dropped. */
export function cleanEvent(e) {
  if (!isObj(e)) return null;
  const type = String(e.type || '').toLowerCase();
  if (!EVENT_TYPES.includes(type)) return null;
  const surface = EVENT_SURFACES.includes(e.surface) ? e.surface : 'other';
  const format = FORMATS.includes(e.format) ? e.format : null;
  if (!format) return null;
  const out = { type, surface, placement: token(e.placement, 'other'), format, test: !!e.test };
  if (type === 'paid') {
    const value = Number(e.value);
    const currency = String(e.currency || '').toUpperCase();
    if (!Number.isFinite(value) || value < 0 || value > EVENT_LIMITS.maxPaidValue) return null;
    if (!/^[A-Z]{3}$/.test(currency)) return null;
    out.micros = Math.round(value * 1e6);
    out.currency = currency;
  }
  return out;
}

const COL = { requested: 'requested', impression: 'impressions', completed: 'completed', failed: 'failed', clicked: 'clicks', paid: 'paid' };

/**
 * Applies the per-user daily limits and folds the accepted events into the daily aggregates.
 * Returns { accepted, dropped }.
 */
export async function recordAdEvents(env, userId, rawEvents) {
  const list = Array.isArray(rawEvents) ? rawEvents.slice(0, EVENT_LIMITS.batch) : [];
  let dropped = (Array.isArray(rawEvents) ? rawEvents.length : 0) - list.length;
  const cleaned = [];
  for (const e of list) { const c = cleanEvent(e); if (c) cleaned.push(c); else dropped += 1; }
  if (!cleaned.length) return { accepted: 0, dropped };

  const day = new Date().toISOString().slice(0, 10); // server's UTC day — client timestamps are ignored
  const used = (await one(env, 'SELECT events, impressions, paid FROM ad_user_daily WHERE user_id = $1 AND day = $2', [userId, day]))
    || { events: 0, impressions: 0, paid: 0 };
  let events = used.events; let imps = used.impressions; let paid = used.paid;
  const accepted = [];
  for (const e of cleaned) {
    if (events >= EVENT_LIMITS.eventsPerDay) { dropped += 1; continue; }
    if (e.type === 'impression' && imps >= EVENT_LIMITS.impressionsPerDay) { dropped += 1; continue; }
    if (e.type === 'paid' && paid >= EVENT_LIMITS.paidPerDay) { dropped += 1; continue; }
    events += 1;
    if (e.type === 'impression') imps += 1;
    if (e.type === 'paid') paid += 1;
    accepted.push(e);
  }
  if (!accepted.length) return { accepted: 0, dropped };

  await q(env, `INSERT INTO ad_user_daily (user_id, day, events, impressions, paid) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, day) DO UPDATE SET events = ad_user_daily.events + EXCLUDED.events,
      impressions = ad_user_daily.impressions + EXCLUDED.impressions, paid = ad_user_daily.paid + EXCLUDED.paid`,
  [userId, day, events - used.events, imps - used.impressions, paid - used.paid]);

  const groups = new Map();
  const revenue = new Map();
  for (const e of accepted) {
    const k = [e.surface, e.placement, e.format, e.test].join('|');
    const g = groups.get(k) || { surface: e.surface, placement: e.placement, format: e.format, test: e.test, requested: 0, impressions: 0, completed: 0, failed: 0, clicks: 0, paid: 0 };
    g[COL[e.type]] += 1;
    groups.set(k, g);
    if (e.type === 'paid') {
      const rk = [e.surface, e.currency, e.test].join('|');
      const r = revenue.get(rk) || { surface: e.surface, currency: e.currency, test: e.test, micros: 0, events: 0 };
      r.micros += e.micros; r.events += 1;
      revenue.set(rk, r);
    }
  }
  for (const g of groups.values()) {
    await q(env, `INSERT INTO ad_daily (day, surface, placement, format, test, requested, impressions, completed, failed, clicks, paid)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (day, surface, placement, format, test) DO UPDATE SET
        requested = ad_daily.requested + EXCLUDED.requested, impressions = ad_daily.impressions + EXCLUDED.impressions,
        completed = ad_daily.completed + EXCLUDED.completed, failed = ad_daily.failed + EXCLUDED.failed,
        clicks = ad_daily.clicks + EXCLUDED.clicks, paid = ad_daily.paid + EXCLUDED.paid`,
    [day, g.surface, g.placement, g.format, g.test, g.requested, g.impressions, g.completed, g.failed, g.clicks, g.paid]);
  }
  for (const r of revenue.values()) {
    await q(env, `INSERT INTO ad_revenue_daily (day, surface, currency, test, micros, events) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (day, surface, currency, test) DO UPDATE SET micros = ad_revenue_daily.micros + EXCLUDED.micros,
        events = ad_revenue_daily.events + EXCLUDED.events`, [day, r.surface, r.currency, r.test, r.micros, r.events]);
  }
  // keep the abuse counters small (cheap, occasional)
  if (Math.random() < 0.02) await q(env, "DELETE FROM ad_user_daily WHERE day < CURRENT_DATE - 14");
  return { accepted: accepted.length, dropped };
}

// ---------- stats ----------
const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null); // percent, 1 decimal

export async function adStats(env, { days = 30, includeTest = false } = {}) {
  const testCond = includeTest ? '' : 'AND NOT test';
  const daily = await q(env, `SELECT day::text AS day, SUM(requested)::int AS requested, SUM(impressions)::int AS impressions,
      SUM(completed)::int AS completed, SUM(failed)::int AS failed, SUM(clicks)::int AS clicks, SUM(paid)::int AS paid
    FROM ad_daily WHERE day > CURRENT_DATE - $1::int ${testCond} GROUP BY day ORDER BY day DESC`, [days]);
  const bySurface = await q(env, `SELECT surface, format, SUM(requested)::int AS requested, SUM(impressions)::int AS impressions,
      SUM(completed)::int AS completed, SUM(failed)::int AS failed, SUM(clicks)::int AS clicks
    FROM ad_daily WHERE day > CURRENT_DATE - $1::int ${testCond} GROUP BY surface, format ORDER BY SUM(impressions) DESC, surface`, [days]);
  const rev = await q(env, `SELECT day::text AS day, surface, currency, SUM(micros)::bigint AS micros, SUM(events)::int AS events
    FROM ad_revenue_daily WHERE day > CURRENT_DATE - $1::int ${testCond} GROUP BY day, surface, currency`, [days]);

  const money = (m) => Math.round(Number(m) / 1e4) / 100; // micros → currency units, 2 decimals
  const revByDay = {}; const revBySurface = {}; const totalRev = {};
  const add = (o, cur, v) => { o[cur] = (o[cur] || 0) + v; };
  for (const r of rev) {
    const v = Number(r.micros);
    add(revByDay[r.day] || (revByDay[r.day] = {}), r.currency, v);
    add(revBySurface[r.surface] || (revBySurface[r.surface] = {}), r.currency, v);
    add(totalRev, r.currency, v);
  }
  const fmtRev = (o) => Object.fromEntries(Object.entries(o || {}).map(([c, m]) => [c, money(m)]));
  const withRates = (x) => ({ ...x, fillRate: rate(x.impressions, x.requested), completionRate: rate(x.completed, x.impressions) });

  const totals = daily.reduce((t, d) => {
    for (const k of ['requested', 'impressions', 'completed', 'failed', 'clicks']) t[k] += d[k];
    return t;
  }, { requested: 0, impressions: 0, completed: 0, failed: 0, clicks: 0 });

  const surfaces = {};
  for (const r of bySurface) {
    const s = surfaces[r.surface] || (surfaces[r.surface] = { surface: r.surface, requested: 0, impressions: 0, completed: 0, failed: 0, clicks: 0, formats: [] });
    for (const k of ['requested', 'impressions', 'completed', 'failed', 'clicks']) s[k] += r[k];
    s.formats.push(r.format);
  }
  return {
    days,
    includeTest,
    totals: { ...withRates(totals), revenue: fmtRev(totalRev) },
    byDay: daily.map((d) => ({ ...withRates(d), revenue: fmtRev(revByDay[d.day]) })),
    bySurface: Object.values(surfaces).map((s) => ({ ...withRates(s), revenue: fmtRev(revBySurface[s.surface]) }))
      .sort((a, b) => b.impressions - a.impressions),
  };
}
