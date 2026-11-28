// MY SCRIPTURE JOURNEY: daily / weekly / monthly verse goals, the reading event log, unique-verse progress, streaks,
// achievements (awarded once) and community goals.
//
// Model
//  - journey_events   one row per reading event (reader, narration or manual entry). Idempotent: (user_id, client_id) is
//                     unique, so re-sending a batch after a network failure stores nothing twice.
//  - journey_verses   one row per verse the user has ever read (the unique-verse ledger). first_day / first_at hold the
//                     EARLIEST read, so an offline backlog that syncs late still lands on the right day.
//  - Totals (every verse read, re-reads included) come from journey_events.verse_count; "unique" progress for a window
//    is the number of verses whose first read fell in that window.
//  - Days are local days in the user's time zone, fixed when the event is stored (IANA zone, else a UTC offset in
//    minutes). Weeks start on Monday. Streaks count local days with at least one verse read.
//  - Achievements are rows in journey_achievements with UNIQUE (user_id, kind, ref): inserting twice awards once.
import { q, one } from './db.js';
import { bad, notFound, forbidden } from './http.js';
import { refExists, verseCount, VERSE_COUNTS } from './verseCounts.js';
import { registerConfig, getConfig } from './wallet.js';

export const SOURCES = ['reader', 'narration', 'manual'];
export const DELIVERY = ['reading', 'notifications', 'both'];
export const GROUP_KINDS = ['family', 'friends', 'study', 'church', 'other'];
export const MAX_BATCH = 500;
const MAX_PAST_MS = 400 * 86400e3;
const MAX_FUTURE_MS = 5 * 60e3;
const TRANSLATION_RE = /^[A-Z0-9_-]{2,16}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isBook = (b) => typeof b === 'string' && Object.prototype.hasOwnProperty.call(VERSE_COUNTS, b);
const TOTAL_VERSES = Object.values(VERSE_COUNTS).reduce((n, chs) => n + chs.reduce((a, b) => a + b, 0), 0);
const TOTAL_CHAPTERS = Object.values(VERSE_COUNTS).reduce((n, chs) => n + chs.length, 0);

// ───────── admin-editable settings (Wallets & payments › Settings) ─────────
export const DEFAULT_JOURNEY_SETTINGS = {
  presets: [50, 100, 200, 500, 1000], // daily verse targets offered in the app
  maxPushPerDay: 6, // hard ceiling on scheduled Scripture notifications per day (never above 6)
  maxDailyVerses: 20000, // anti-inflation: verses beyond this per local day are not counted
  streakMilestones: [3, 7, 30],
  verseMilestones: [1000, 5000],
};
const isIntIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function checkSettings(v) {
  if (!v || typeof v !== 'object') return false;
  const arr = (x, lo, hi, min = 1) => Array.isArray(x) && x.length >= min && x.length <= 20 && x.every((n) => isIntIn(n, lo, hi));
  return arr(v.presets, 1, 100000) && isIntIn(v.maxPushPerDay, 0, 6) && isIntIn(v.maxDailyVerses, 1, 1000000)
    && arr(v.streakMilestones, 1, 3650) && arr(v.verseMilestones, 1, TOTAL_VERSES);
}
registerConfig('journey_settings', DEFAULT_JOURNEY_SETTINGS, checkSettings);
export async function journeySettings(env) {
  const s = await getConfig(env);
  return { ...DEFAULT_JOURNEY_SETTINGS, ...(s.journey_settings || {}) };
}

// ───────── days, zones and calendar maths ─────────
/** A valid IANA zone name, or null. */
export function zoneOf(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return null; }
}

/** The local calendar day (YYYY-MM-DD) of an instant, in an IANA zone, else in a fixed offset (minutes east of UTC). */
export function localDay(at, tz, tzOffset) {
  const d = at instanceof Date ? at : new Date(at);
  const zone = zoneOf(tz);
  if (zone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  const off = Number.isInteger(tzOffset) && Math.abs(tzOffset) <= 840 ? tzOffset : 0;
  return new Date(d.getTime() + off * 60000).toISOString().slice(0, 10);
}

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
export const weekStart = (day) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
export const weekEnd = (day) => addDays(weekStart(day), 6);
export const monthStart = (day) => `${day.slice(0, 7)}-01`;
export const monthEnd = (day) => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * Streaks from the set of local days with reading. current: the run that ends today, or yesterday (today is not over).
 * longest: the longest run ever.
 */
export function streaksFrom(days, today) {
  const set = new Set(days.filter((d) => DAY_RE.test(d)));
  let current = 0;
  let d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { current += 1; d = addDays(d, -1); }
  let longest = 0; let run = 0; let prev = null;
  for (const day of [...set].sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  return { current, longest };
}

// ───────── goals ─────────
const dayStr = (v) => (typeof v === 'string' && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const toInt = (v, lo, hi, field) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${field} must be a whole number from ${lo} to ${hi}`, 'BAD_GOAL');
  return n;
};

export async function getGoal(env, userId) {
  return one(env, `SELECT daily_target, weekly_target, monthly_target, books, translation, timezone, delivery,
      notify_times, notify_per_day FROM journey_goals WHERE user_id = $1`, [userId]);
}

export function goalView(g) {
  if (!g) {
    return { dailyTarget: 0, weeklyTarget: 0, monthlyTarget: 0, books: [], translation: 'KJV', timezone: null, delivery: 'both', notifyTimes: [], notifyPerDay: 0, set: false };
  }
  return {
    dailyTarget: g.daily_target, weeklyTarget: g.weekly_target, monthlyTarget: g.monthly_target, books: g.books || [],
    translation: g.translation, timezone: g.timezone, delivery: g.delivery, notifyTimes: g.notify_times || [], notifyPerDay: g.notify_per_day, set: true,
  };
}

/** Validates and saves the goal (upsert). Body keys are camelCase; every field is optional and keeps its old value. */
export async function saveGoal(env, userId, body) {
  const settings = await journeySettings(env);
  const cur = goalView(await getGoal(env, userId));
  const has = (k) => body[k] !== undefined;
  const dailyTarget = has('dailyTarget') ? toInt(body.dailyTarget, 0, 100000, 'dailyTarget') : cur.dailyTarget;
  const weeklyTarget = has('weeklyTarget') ? toInt(body.weeklyTarget, 0, 700000, 'weeklyTarget') : cur.weeklyTarget;
  const monthlyTarget = has('monthlyTarget') ? toInt(body.monthlyTarget, 0, 3000000, 'monthlyTarget') : cur.monthlyTarget;
  let books = cur.books;
  if (has('books')) {
    if (!Array.isArray(body.books) || body.books.length > 66) throw bad('books must be a list of book ids (empty = the whole Bible)', 'BAD_GOAL');
    books = [...new Set(body.books)];
    if (!books.every(isBook)) throw bad('Unknown book id in books', 'BAD_GOAL');
  }
  let translation = cur.translation;
  if (has('translation')) {
    const t = String(body.translation || '').toUpperCase();
    if (!TRANSLATION_RE.test(t)) throw bad('translation is not valid', 'BAD_GOAL');
    translation = t;
  }
  let timezone = cur.timezone || 'UTC';
  if (has('timezone')) {
    const z = zoneOf(body.timezone);
    if (!z) throw bad('timezone must be an IANA zone such as Africa/Lagos', 'BAD_GOAL');
    timezone = z;
  }
  let delivery = cur.delivery;
  if (has('delivery')) {
    if (!DELIVERY.includes(body.delivery)) throw bad('delivery must be reading, notifications or both', 'BAD_GOAL');
    delivery = body.delivery;
  }
  let notifyTimes = cur.notifyTimes;
  if (has('notifyTimes')) {
    if (!Array.isArray(body.notifyTimes) || body.notifyTimes.length > 6
      || !body.notifyTimes.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
      throw bad('notifyTimes must be up to 6 times as HH:MM', 'BAD_GOAL');
    }
    notifyTimes = [...new Set(body.notifyTimes)].sort();
  }
  let notifyPerDay = cur.notifyPerDay;
  if (has('notifyPerDay')) notifyPerDay = toInt(body.notifyPerDay, 0, settings.maxPushPerDay, 'notifyPerDay');
  await q(env, `INSERT INTO journey_goals (user_id, daily_target, weekly_target, monthly_target, books, translation, timezone,
      delivery, notify_times, notify_per_day, updated_at)
    VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9::text[], $10, now())
    ON CONFLICT (user_id) DO UPDATE SET daily_target = EXCLUDED.daily_target, weekly_target = EXCLUDED.weekly_target,
      monthly_target = EXCLUDED.monthly_target, books = EXCLUDED.books, translation = EXCLUDED.translation,
      timezone = EXCLUDED.timezone, delivery = EXCLUDED.delivery, notify_times = EXCLUDED.notify_times,
      notify_per_day = EXCLUDED.notify_per_day, updated_at = now()`,
  [userId, dailyTarget, weeklyTarget, monthlyTarget, books, translation, timezone, delivery, notifyTimes, notifyPerDay]);
  return goalView(await getGoal(env, userId));
}

// ───────── events ─────────
const ID_RE = /^[A-Za-z0-9_:.-]{4,80}$/;

/** One raw event → { ev } or { reason, clientId }. Verses are checked against the KJV versification. */
export function parseEvent(raw, now) {
  const clientId = raw && typeof raw.clientId === 'string' ? raw.clientId : null;
  const fail = (reason) => ({ reason, clientId });
  if (!raw || typeof raw !== 'object') return fail('BAD_EVENT');
  if (!clientId || !ID_RE.test(clientId)) return fail('BAD_CLIENT_ID');
  const source = raw.source || 'reader';
  if (!SOURCES.includes(source)) return fail('BAD_SOURCE');
  const translation = String(raw.translation || 'KJV').toUpperCase();
  if (!TRANSLATION_RE.test(translation)) return fail('BAD_TRANSLATION');
  const book = raw.bookId || raw.book;
  const chapter = Number(raw.chapter);
  const verseStart = raw.verseStart === undefined ? Number(raw.verse) : Number(raw.verseStart);
  const verseEnd = raw.verseEnd === undefined ? verseStart : Number(raw.verseEnd);
  if (!isBook(book)) return fail('BAD_REFERENCE');
  if (!refExists(book, chapter, verseStart, verseEnd)) return fail('BAD_REFERENCE');
  const at = typeof raw.readAt === 'number' ? raw.readAt : Date.parse(raw.readAt);
  if (!Number.isFinite(at)) return fail('BAD_TIME');
  if (at > now + MAX_FUTURE_MS) return fail('FUTURE');
  if (at < now - MAX_PAST_MS) return fail('TOO_OLD');
  return {
    ev: { clientId, source, translation, book, chapter, verseStart, verseEnd, verseCount: verseEnd - verseStart + 1, readAt: new Date(at).toISOString() },
  };
}

/** Sum of verse_count for one user between two local days (inclusive). */
export async function sumBetween(env, userId, from, to) {
  const r = await one(env, `SELECT coalesce(sum(verse_count), 0)::int AS n FROM journey_events
    WHERE user_id = $1 AND local_day BETWEEN $2::date AND $3::date`, [userId, from, to]);
  return r ? r.n : 0;
}

/**
 * Stores a batch of reading events and the unique verses they cover, in ONE statement (data-modifying CTEs), so an
 * event and its verses are stored together or not at all. Returns the client ids that were new.
 */
async function storeEvents(env, userId, evs) {
  if (!evs.length) return new Set();
  const cols = { ids: [], src: [], tr: [], bk: [], ch: [], vs: [], ve: [], vc: [], at: [], day: [], tz: [] };
  for (const e of evs) {
    cols.ids.push(e.clientId); cols.src.push(e.source); cols.tr.push(e.translation); cols.bk.push(e.book);
    cols.ch.push(e.chapter); cols.vs.push(e.verseStart); cols.ve.push(e.verseEnd); cols.vc.push(e.verseCount);
    cols.at.push(e.readAt); cols.day.push(e.localDay); cols.tz.push(e.tz);
  }
  const rows = await q(env, `
    WITH ins AS (
      INSERT INTO journey_events (user_id, client_id, source, translation, book, chapter, verse_start, verse_end, verse_count, read_at, local_day, tz)
      SELECT $1::uuid, t.client_id, t.source, t.translation, t.book, t.chapter, t.vs, t.ve, t.vc, t.read_at::timestamptz, t.local_day::date, t.tz
      FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[], $9::int[], $10::text[], $11::text[], $12::text[])
        AS t(client_id, source, translation, book, chapter, vs, ve, vc, read_at, local_day, tz)
      ON CONFLICT (user_id, client_id) DO NOTHING
      RETURNING client_id, book, chapter, verse_start, verse_end, read_at, local_day
    ),
    exp AS (
      SELECT DISTINCT ON (i.book, i.chapter, gs.v) i.book, i.chapter, gs.v AS verse, i.read_at, i.local_day
      FROM ins i CROSS JOIN LATERAL generate_series(i.verse_start, i.verse_end) AS gs(v)
      ORDER BY i.book, i.chapter, gs.v, i.read_at
    ),
    v AS (
      INSERT INTO journey_verses (user_id, book, chapter, verse, first_day, first_at)
      SELECT $1::uuid, e.book, e.chapter, e.verse, e.local_day, e.read_at FROM exp e
      ON CONFLICT (user_id, book, chapter, verse) DO UPDATE SET first_day = EXCLUDED.first_day, first_at = EXCLUDED.first_at
        WHERE EXCLUDED.first_at < journey_verses.first_at
      RETURNING 1
    )
    SELECT client_id FROM ins`,
  [userId, cols.ids, cols.src, cols.tr, cols.bk, cols.ch, cols.vs, cols.ve, cols.vc, cols.at, cols.day, cols.tz]);
  return new Set(rows.map((r) => r.client_id));
}

/**
 * POST /journey/events/sync. events: [{ clientId, source, bookId, chapter, verseStart, verseEnd, translation, readAt }].
 * tz is an IANA zone, tzOffset (minutes east of UTC) is the fallback. Idempotent by clientId; anti-inflation cap per day.
 * Returns { accepted, duplicates, rejected: [{ clientId, reason }], awarded: [achievement] }.
 */
export async function syncEvents(env, userId, { tz, tzOffset, events }, now = Date.now()) {
  if (!Array.isArray(events)) throw bad('events must be a list', 'BAD_EVENTS');
  if (events.length > MAX_BATCH) throw bad(`At most ${MAX_BATCH} events per sync`, 'BATCH_TOO_LARGE');
  const settings = await journeySettings(env);
  const zone = zoneOf(tz) ? tz : null;
  const offset = Number.isInteger(tzOffset) ? tzOffset : undefined;
  const rejected = [];
  const seen = new Set();
  let duplicates = 0;
  const parsed = [];
  for (const raw of events) {
    const p = parseEvent(raw, now);
    if (p.reason) { rejected.push({ clientId: p.clientId, reason: p.reason }); continue; }
    if (seen.has(p.ev.clientId)) { duplicates += 1; continue; }
    seen.add(p.ev.clientId);
    p.ev.localDay = localDay(p.ev.readAt, zone, offset);
    p.ev.tz = zone || (offset !== undefined ? `UTC${offset >= 0 ? '+' : '-'}${Math.abs(offset)}` : 'UTC');
    parsed.push(p.ev);
  }
  // ids already stored are duplicates, not new reads: they must not use up the daily cap
  const known = parsed.length ? new Set((await q(env, 'SELECT client_id FROM journey_events WHERE user_id = $1 AND client_id = ANY($2::text[])', [userId, parsed.map((e) => e.clientId)])).map((r) => r.client_id)) : new Set();
  duplicates += known.size;
  const news = parsed.filter((e) => !known.has(e.clientId));
  // anti-inflation: verses beyond the daily cap are not counted (the client drops them)
  const days = [...new Set(news.map((e) => e.localDay))];
  const existing = new Map();
  for (const day of days) existing.set(day, await sumBetween(env, userId, day, day));
  news.sort((a, b) => Date.parse(a.readAt) - Date.parse(b.readAt));
  const fresh = [];
  for (const e of news) {
    const used = existing.get(e.localDay) || 0;
    if (used + e.verseCount > settings.maxDailyVerses) { rejected.push({ clientId: e.clientId, reason: 'DAILY_CAP' }); continue; }
    existing.set(e.localDay, used + e.verseCount);
    fresh.push(e);
  }
  const stored = await storeEvents(env, userId, fresh);
  duplicates += fresh.length - stored.size;
  const awarded = await evaluateAchievements(env, userId, { today: localDay(now, zone, offset), days: [...new Set(fresh.filter((e) => stored.has(e.clientId)).map((e) => e.localDay))] }, now);
  return { accepted: stored.size, duplicates, rejected, awarded };
}

// ───────── achievements ─────────
const fmt = (n) => Number(n).toLocaleString('en-US');
export function achievementText(kind, ref) {
  switch (kind) {
    case 'daily_goal': return { title: 'CONGRATULATIONS!', message: `You achieved your Scripture-reading goal on ${ref}.` };
    case 'weekly_goal': return { title: 'CONGRATULATIONS!', message: `You reached your weekly Scripture-reading goal (week of ${ref}).` };
    case 'monthly_goal': return { title: 'CONGRATULATIONS!', message: `You completed your monthly Scripture-reading goal for ${ref}.` };
    case 'streak': return { title: 'Streak unlocked!', message: `${ref} days in a row reading Scripture.` };
    case 'verses': return { title: 'Milestone reached!', message: `You have read ${fmt(ref)} verses.` };
    case 'community_goal': return { title: 'CONGRATULATIONS!', message: 'Your community reached its shared Scripture-reading goal.' };
    default: return { title: 'Well done!', message: 'Keep reading.' };
  }
}

/** Awards one achievement; returns the new row, or null when it was already awarded. */
async function award(env, userId, kind, ref) {
  const row = await one(env, `INSERT INTO journey_achievements (user_id, kind, ref) VALUES ($1, $2, $3)
    ON CONFLICT (user_id, kind, ref) DO NOTHING RETURNING id, kind, ref, awarded_at`, [userId, kind, String(ref)]);
  return row ? { id: row.id, kind, ref: String(ref), awardedAt: row.awarded_at, ...achievementText(kind, String(ref)) } : null;
}

/**
 * Checks daily / weekly / monthly targets for the given local days (and the current week and month), plus the streak
 * and verse milestones, and awards anything newly reached. Each award is stored once.
 */
export async function evaluateAchievements(env, userId, { today, days = [] }, now = Date.now()) {
  const settings = await journeySettings(env);
  const goal = goalView(await getGoal(env, userId));
  const out = [];
  const push = (a) => { if (a) out.push(a); };
  const candidates = [...new Set([...days, today])];

  if (goal.dailyTarget > 0) {
    for (const day of candidates) {
      if ((await sumBetween(env, userId, day, day)) >= goal.dailyTarget) push(await award(env, userId, 'daily_goal', day));
    }
  }
  const weeks = [...new Set(candidates.map(weekStart))];
  if (goal.weeklyTarget > 0) {
    for (const ws of weeks) {
      if ((await sumBetween(env, userId, ws, addDays(ws, 6))) >= goal.weeklyTarget) push(await award(env, userId, 'weekly_goal', ws));
    }
  }
  const months = [...new Set(candidates.map(monthStart))];
  if (goal.monthlyTarget > 0) {
    for (const ms of months) {
      if ((await sumBetween(env, userId, ms, monthEnd(ms))) >= goal.monthlyTarget) push(await award(env, userId, 'monthly_goal', ms.slice(0, 7)));
    }
  }
  const dayRows = await q(env, 'SELECT DISTINCT local_day::text AS d FROM journey_events WHERE user_id = $1', [userId]);
  const { longest } = streaksFrom(dayRows.map((r) => r.d), today);
  for (const m of settings.streakMilestones) if (longest >= m) push(await award(env, userId, 'streak', m));
  const total = await one(env, 'SELECT coalesce(sum(verse_count), 0)::int AS n FROM journey_events WHERE user_id = $1', [userId]);
  for (const m of settings.verseMilestones) if (total && total.n >= m) push(await award(env, userId, 'verses', m));
  return out;
}

/** Achievements for the screen, newest first, with the unseen ones flagged for the celebration. */
export async function listAchievements(env, userId) {
  const rows = await q(env, `SELECT id, kind, ref, awarded_at, seen_at FROM journey_achievements
    WHERE user_id = $1 ORDER BY awarded_at DESC LIMIT 300`, [userId]);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, ref: r.ref, awardedAt: r.awarded_at, seen: !!r.seen_at, ...achievementText(r.kind, r.ref),
  }));
}

export async function markSeen(env, userId, ids) {
  if (!Array.isArray(ids) || ids.length > 300 || !ids.every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))) {
    throw bad('ids must be a list of achievement ids', 'BAD_IDS');
  }
  if (!ids.length) return 0;
  const rows = await q(env, 'UPDATE journey_achievements SET seen_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND seen_at IS NULL RETURNING id', [userId, ids]);
  return rows.length;
}

// ───────── stats ─────────
/**
 * Dashboard numbers for one user on one local day (tz / tzOffset / the goal's zone).
 * Totals include re-reads; unique = verses first read in the window; books = unique verses per book and chapter.
 */
export async function statsFor(env, userId, { tz, tzOffset } = {}, now = Date.now()) {
  const goalRow = await getGoal(env, userId);
  const goal = goalView(goalRow);
  const zone = zoneOf(tz) ? tz : (zoneOf(goal.timezone) ? goal.timezone : null);
  const offset = Number.isInteger(tzOffset) ? tzOffset : undefined;
  const today = localDay(now, zone, offset);
  const ws = weekStart(today);
  const ms = monthStart(today);
  const me = monthEnd(today);
  const pct = (n, t) => (t > 0 ? Math.min(100, Math.round((n * 100) / t)) : 0);

  const [day, week, month] = await Promise.all([sumBetween(env, userId, today, today), sumBetween(env, userId, ws, addDays(ws, 6)), sumBetween(env, userId, ms, me)]);
  const uniq = async (from, to) => (await one(env, `SELECT count(*)::int AS n FROM journey_verses WHERE user_id = $1 AND first_day BETWEEN $2::date AND $3::date`, [userId, from, to])).n;
  const [uDay, uWeek, uMonth] = await Promise.all([uniq(today, today), uniq(ws, addDays(ws, 6)), uniq(ms, me)]);

  const calendar = await q(env, `SELECT local_day::text AS day, sum(verse_count)::int AS verses FROM journey_events
    WHERE user_id = $1 AND local_day >= $2::date AND local_day <= $3::date GROUP BY local_day ORDER BY local_day`,
  [userId, addDays(today, -364), today]);
  const dayRows = await q(env, 'SELECT DISTINCT local_day::text AS d FROM journey_events WHERE user_id = $1 ORDER BY 1 DESC LIMIT 4000', [userId]);
  const streak = streaksFrom(dayRows.map((r) => r.d), today);

  const totals = await one(env, `SELECT coalesce(sum(verse_count), 0)::int AS verses, count(*)::int AS events FROM journey_events WHERE user_id = $1`, [userId]);
  const uniqueAll = await one(env, 'SELECT count(*)::int AS n FROM journey_verses WHERE user_id = $1', [userId]);
  const last = await one(env, `SELECT book, chapter, verse_start, verse_end, translation, read_at FROM journey_events
    WHERE user_id = $1 ORDER BY read_at DESC LIMIT 1`, [userId]);

  // books: unique verses per chapter → chapters and books completed
  const per = await q(env, 'SELECT book, chapter, count(*)::int AS n FROM journey_verses WHERE user_id = $1 GROUP BY book, chapter', [userId]);
  const byBook = new Map();
  let chaptersCompleted = 0;
  for (const r of per) {
    const b = byBook.get(r.book) || { bookId: r.book, chaptersCompleted: 0, chaptersTouched: 0, versesUnique: 0, versesTotal: 0, completed: false };
    b.chaptersTouched += 1;
    b.versesUnique += r.n;
    if (r.n >= verseCount(r.book, r.chapter)) { b.chaptersCompleted += 1; chaptersCompleted += 1; }
    byBook.set(r.book, b);
  }
  const books = [...byBook.values()].map((b) => {
    b.versesTotal = VERSE_COUNTS[b.bookId].reduce((a, c) => a + c, 0);
    b.completed = b.chaptersCompleted === VERSE_COUNTS[b.bookId].length;
    return b;
  }).sort((a, b) => a.bookId.localeCompare(b.bookId));

  // scope: the books the user chose (empty = the whole Bible)
  const scopeBooks = goal.books.length ? goal.books : Object.keys(VERSE_COUNTS);
  const scopeTotal = scopeBooks.reduce((n, b) => n + VERSE_COUNTS[b].reduce((a, c) => a + c, 0), 0);
  const scopeUnique = books.filter((b) => scopeBooks.includes(b.bookId)).reduce((n, b) => n + b.versesUnique, 0);

  return {
    today,
    goal,
    day: { verses: day, unique: uDay, target: goal.dailyTarget, pct: pct(day, goal.dailyTarget), met: goal.dailyTarget > 0 && day >= goal.dailyTarget },
    week: { start: ws, end: addDays(ws, 6), verses: week, unique: uWeek, target: goal.weeklyTarget, pct: pct(week, goal.weeklyTarget), met: goal.weeklyTarget > 0 && week >= goal.weeklyTarget },
    month: { start: ms, end: me, verses: month, unique: uMonth, target: goal.monthlyTarget, pct: pct(month, goal.monthlyTarget), met: goal.monthlyTarget > 0 && month >= goal.monthlyTarget },
    streak,
    totals: { verses: totals.verses, events: totals.events, uniqueVerses: uniqueAll.n },
    scope: { books: scopeBooks.length, versesTotal: scopeTotal, versesUnique: scopeUnique, pct: pct(scopeUnique, scopeTotal) },
    coverage: { booksCompleted: books.filter((b) => b.completed).length, chaptersCompleted, chaptersTotal: TOTAL_CHAPTERS, versesTotal: TOTAL_VERSES },
    books,
    calendar: calendar.map((r) => ({ day: r.day, verses: r.verses })),
    continueFrom: last ? { bookId: last.book, chapter: last.chapter, verseStart: last.verse_start, verseEnd: last.verse_end, translation: last.translation, readAt: last.read_at } : null,
  };
}

// ───────── community goals ─────────
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
function inviteCode() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export async function createGroup(env, userId, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 60) throw bad('Name must be 2 to 60 characters', 'BAD_GROUP');
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
  const kind = body.kind || 'other';
  if (!GROUP_KINDS.includes(kind)) throw bad('kind must be family, friends, study, church or other', 'BAD_GROUP');
  const target = Number(body.target);
  if (!Number.isInteger(target) || target < 1 || target > 10000000) throw bad('target must be a whole number from 1 to 10,000,000', 'BAD_GROUP');
  const startsOn = dayStr(body.startsOn);
  const endsOn = dayStr(body.endsOn);
  if (!startsOn || !endsOn) throw bad('startsOn and endsOn must be dates (YYYY-MM-DD)', 'BAD_GROUP');
  const span = (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86400e3;
  if (span < 0 || span > 366) throw bad('The goal must end on or after its start and last at most a year', 'BAD_GROUP');
  let code = inviteCode();
  let row = null;
  for (let i = 0; i < 4 && !row; i += 1) {
    row = await one(env, `INSERT INTO journey_groups (owner_id, name, description, kind, target, starts_on, ends_on, invite_code)
      VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8) ON CONFLICT (invite_code) DO NOTHING RETURNING id`,
    [userId, name, description, kind, target, startsOn, endsOn, code]);
    if (!row) code = inviteCode();
  }
  if (!row) throw bad('Could not create the group, try again', 'BUSY');
  await q(env, `INSERT INTO journey_group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [row.id, userId]);
  return { id: row.id, inviteCode: code };
}

const GROUP_SELECT = `SELECT g.id, g.name, g.description, g.kind, g.target, g.starts_on::text AS starts_on, g.ends_on::text AS ends_on,
  g.invite_code, g.owner_id, g.completed_at, m.role, m.hide_numbers,
  (SELECT count(*)::int FROM journey_group_members x WHERE x.group_id = g.id) AS members
  FROM journey_groups g JOIN journey_group_members m ON m.group_id = g.id AND m.user_id = $1`;

export async function listGroups(env, userId, today = new Date().toISOString().slice(0, 10)) {
  const rows = await q(env, `${GROUP_SELECT} ORDER BY g.ends_on DESC, g.created_at DESC LIMIT 100`, [userId]);
  return rows.map((g) => ({ ...groupMeta(g, today), role: g.role, hideNumbers: g.hide_numbers }));
}

function groupMeta(g, today) {
  const status = today < g.starts_on ? 'upcoming' : today > g.ends_on ? 'ended' : 'active';
  return {
    id: g.id, name: g.name, description: g.description, kind: g.kind, target: g.target, startsOn: g.starts_on, endsOn: g.ends_on,
    status, members: g.members, completed: !!g.completed_at, inviteCode: g.role === 'owner' ? g.invite_code : undefined,
  };
}

export async function joinGroup(env, userId, code) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6,12}$/.test(c)) throw bad('Enter a valid invite code', 'BAD_CODE');
  const g = await one(env, 'SELECT id FROM journey_groups WHERE invite_code = $1', [c]);
  if (!g) throw notFound('No community goal has that code');
  await q(env, `INSERT INTO journey_group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT (group_id, user_id) DO NOTHING`, [g.id, userId]);
  return { id: g.id };
}

export async function leaveGroup(env, userId, groupId) {
  const m = await one(env, 'SELECT role FROM journey_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  if (!m) throw notFound('You are not in this group');
  if (m.role === 'owner') throw forbidden('The creator cannot leave their own goal. Close it or pass it on first.', 'OWNER_CANNOT_LEAVE');
  await q(env, 'DELETE FROM journey_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return true;
}

export async function setGroupPrivacy(env, userId, groupId, hideNumbers) {
  if (typeof hideNumbers !== 'boolean') throw bad('hideNumbers must be true or false', 'BAD_PRIVACY');
  const rows = await q(env, 'UPDATE journey_group_members SET hide_numbers = $3 WHERE group_id = $1 AND user_id = $2 RETURNING user_id', [groupId, userId, hideNumbers]);
  if (!rows.length) throw notFound('You are not in this group');
  return hideNumbers;
}

/**
 * Combined progress and leaderboard. Totals include every member, hidden or not. A member who hides their numbers
 * appears by name with no count and no rank to the others; they always see their own number. Reaching the target
 * stores completed_at once and awards 'community_goal' to every member once.
 */
export async function groupProgress(env, userId, groupId, now = Date.now()) {
  const me = await one(env, 'SELECT role, hide_numbers FROM journey_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  if (!me) throw notFound('Community goal not found');
  const g = await one(env, `SELECT id, name, description, kind, target, starts_on::text AS starts_on, ends_on::text AS ends_on,
    invite_code, owner_id, completed_at FROM journey_groups WHERE id = $1`, [groupId]);
  const rows = await q(env, `SELECT m.user_id, m.role, m.hide_numbers, u.display_name,
      coalesce((SELECT sum(e.verse_count) FROM journey_events e WHERE e.user_id = m.user_id
        AND e.local_day BETWEEN $2::date AND $3::date), 0)::int AS verses
    FROM journey_group_members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = $1 ORDER BY verses DESC, u.display_name`, [groupId, g.starts_on, g.ends_on]);
  const total = rows.reduce((n, r) => n + r.verses, 0);
  const reached = total >= g.target;
  let awarded = [];
  if (reached && !g.completed_at) {
    const first = await one(env, 'UPDATE journey_groups SET completed_at = now() WHERE id = $1 AND completed_at IS NULL RETURNING id', [groupId]);
    if (first) {
      for (const r of rows) {
        const a = await award(env, r.user_id, 'community_goal', groupId);
        if (a && r.user_id === userId) awarded.push(a);
      }
    }
  }
  const leaderboard = rows.map((r, i) => {
    const self = r.user_id === userId;
    const hidden = r.hide_numbers && !self;
    return {
      name: r.display_name || 'Friend',
      isYou: self,
      rank: hidden ? null : i + 1,
      verses: hidden ? null : r.verses,
      hidden,
      role: r.role,
    };
  });
  const today = localDay(now, null, 0);
  const meta = groupMeta({ ...g, members: rows.length, role: me.role }, today);
  return {
    ...meta,
    role: me.role,
    yourHideNumbers: !!me.hide_numbers,
    total,
    pct: g.target > 0 ? Math.min(100, Math.round((total * 100) / g.target)) : 0,
    reached,
    leaderboard,
    yourVerses: rows.find((r) => r.user_id === userId)?.verses ?? 0,
    awarded,
  };
}
