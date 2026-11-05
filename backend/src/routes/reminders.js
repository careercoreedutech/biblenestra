// Reminders + daily-verse settings. The phone schedules the notifications itself (works offline);
// the server only keeps a copy so they come back after reinstalling or on a new phone.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, body, isUuid, notFound, str } from '../lib/http.js';

const r = new Hono();
const MAX_REMINDERS = 50;
const KINDS = ['bible', 'pray', 'call', 'study', 'other'];
const REPEATS = ['once', 'daily', 'weekdays', 'days'];
const TARGETS = ['Bible', 'PrayerWall', 'Today'];
const DEFAULT_VERSE = { enabled: false, hour: 6, minute: 0 };

const shape = (x) => ({
  id: x.id,
  purpose: x.purpose,
  kind: x.kind,
  hour: x.hour,
  minute: x.minute,
  repeat: x.repeat,
  days: (x.days || []).map(Number),
  date: x.date ? (x.date instanceof Date ? x.date.toISOString().slice(0, 10) : String(x.date).slice(0, 10)) : null,
  target: x.target,
  passage: x.passage || null,
  enabled: x.enabled,
  createdAt: new Date(x.created_at).toISOString(),
  updatedAt: new Date(x.updated_at).toISOString(),
});

const intIn = (v, lo, hi, field) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${field} must be between ${lo} and ${hi}`);
  return n;
};

function validReminder(b) {
  if (!b || typeof b !== 'object') throw bad('Reminder must be an object');
  if (!isUuid(b.id)) throw bad('Reminder id must be a UUID');
  const repeat = REPEATS.includes(b.repeat) ? b.repeat : 'daily';
  const days = repeat === 'days' ? Array.from(new Set((Array.isArray(b.days) ? b.days : []).map((d) => intIn(d, 0, 6, 'days')))).sort() : [];
  if (repeat === 'days' && !days.length) throw bad('Pick at least one day');
  let date = null;
  if (repeat === 'once') {
    if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || Number.isNaN(Date.parse(b.date))) throw bad('A one-time reminder needs a date (YYYY-MM-DD)');
    date = b.date;
  }
  let passage = null;
  if (b.passage && typeof b.passage === 'object') {
    if (!/^[1-3A-Z]{3}$/.test(String(b.passage.bookId || ''))) throw bad('Bad passage book');
    passage = { bookId: b.passage.bookId, chapter: intIn(b.passage.chapter, 1, 150, 'passage chapter') };
  }
  return {
    id: b.id,
    purpose: str(b.purpose, { min: 1, max: 120, field: 'purpose' }),
    kind: KINDS.includes(b.kind) ? b.kind : 'other',
    hour: intIn(b.hour, 0, 23, 'hour'),
    minute: intIn(b.minute, 0, 59, 'minute'),
    repeat, days, date,
    target: TARGETS.includes(b.target) ? b.target : 'Today',
    passage,
    enabled: b.enabled !== false,
  };
}

function validVerse(v) {
  if (!v || typeof v !== 'object') throw bad('dailyVerse must be an object');
  const out = { enabled: !!v.enabled, hour: intIn(v.hour ?? 6, 0, 23, 'hour'), minute: intIn(v.minute ?? 0, 0, 59, 'minute') };
  if (v.translation != null) out.translation = str(v.translation, { max: 12, field: 'translation' }) || 'KJV';
  return out;
}

async function upsert(env, userId, x) {
  // ON CONFLICT … WHERE user_id = $2 → another user's id can never be overwritten
  return one(env, `INSERT INTO reminders (id, user_id, purpose, kind, hour, minute, repeat, days, date, target, passage, enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::smallint[],$9::date,$10,$11::jsonb,$12)
      ON CONFLICT (id) DO UPDATE SET purpose = EXCLUDED.purpose, kind = EXCLUDED.kind, hour = EXCLUDED.hour, minute = EXCLUDED.minute,
        repeat = EXCLUDED.repeat, days = EXCLUDED.days, date = EXCLUDED.date, target = EXCLUDED.target, passage = EXCLUDED.passage,
        enabled = EXCLUDED.enabled, updated_at = now()
      WHERE reminders.user_id = $2
      RETURNING *`, [x.id, userId, x.purpose, x.kind, x.hour, x.minute, x.repeat, x.days, x.date, x.target, x.passage ? JSON.stringify(x.passage) : null, x.enabled]);
}

async function verseOf(env, userId) {
  const row = await one(env, 'SELECT daily_verse FROM reminder_settings WHERE user_id = $1', [userId]);
  return { ...DEFAULT_VERSE, ...((row && row.daily_verse) || {}) };
}

r.get('/me/reminders', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, 'SELECT * FROM reminders WHERE user_id = $1 ORDER BY hour, minute, created_at', [me.id]);
  return c.json({ items: rows.map(shape), dailyVerse: await verseOf(c.env, me.id) });
});

// Bulk save: { items?: Reminder[], dailyVerse?: {enabled, hour, minute} } (upserts; never deletes)
r.put('/me/reminders', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const items = Array.isArray(b.items) ? b.items.map(validReminder) : [];
  if (items.length > MAX_REMINDERS) throw bad(`You can keep up to ${MAX_REMINDERS} reminders`, 'LIMIT');
  const existing = await one(c.env, 'SELECT COUNT(*)::int AS n FROM reminders WHERE user_id = $1 AND NOT (id = ANY($2::uuid[]))', [me.id, items.map((x) => x.id)]);
  if (existing.n + items.length > MAX_REMINDERS) throw bad(`You can keep up to ${MAX_REMINDERS} reminders`, 'LIMIT');
  const saved = [];
  for (const x of items) {
    // eslint-disable-next-line no-await-in-loop
    const row = await upsert(c.env, me.id, x);
    if (!row) throw notFound('Reminder not found');
    saved.push(shape(row));
  }
  let dailyVerse;
  if (b.dailyVerse !== undefined) {
    const v = validVerse(b.dailyVerse);
    const row = await one(c.env, `INSERT INTO reminder_settings (user_id, daily_verse) VALUES ($1, $2::jsonb)
        ON CONFLICT (user_id) DO UPDATE SET daily_verse = EXCLUDED.daily_verse, updated_at = now() RETURNING daily_verse`, [me.id, JSON.stringify(v)]);
    dailyVerse = { ...DEFAULT_VERSE, ...row.daily_verse };
  } else dailyVerse = await verseOf(c.env, me.id);
  return c.json({ items: saved, dailyVerse });
});

// Save one reminder (id in the path)
r.put('/me/reminders/:id', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const x = validReminder({ ...b, id: c.req.param('id') });
  const exists = await one(c.env, 'SELECT user_id FROM reminders WHERE id = $1', [x.id]);
  if (exists && exists.user_id !== me.id) throw notFound('Reminder not found');
  if (!exists) {
    const n = await one(c.env, 'SELECT COUNT(*)::int AS n FROM reminders WHERE user_id = $1', [me.id]);
    if (n.n >= MAX_REMINDERS) throw bad(`You can keep up to ${MAX_REMINDERS} reminders`, 'LIMIT');
  }
  const row = await upsert(c.env, me.id, x);
  if (!row) throw notFound('Reminder not found');
  return c.json(shape(row));
});

r.delete('/me/reminders/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) throw notFound('Reminder not found');
  const row = await one(c.env, 'DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id', [id, c.get('user').id]);
  if (!row) throw notFound('Reminder not found');
  return c.json({ ok: true });
});

export default r;
