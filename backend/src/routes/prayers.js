import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, body, decodeCursor, encodeCursor, forbidden, notFound, str, uuidParam } from '../lib/http.js';
import { userJson } from '../lib/shape.js';
import { sendNotification } from '../lib/push.js';
import { notifyUser } from '../hub.js';

const r = new Hono();

const SELECT = `SELECT pr.*, ${userJson('u')} AS author,
    EXISTS (SELECT 1 FROM prayer_intercessions i WHERE i.prayer_id = pr.id AND i.user_id = $1) AS prayed,
    EXISTS (SELECT 1 FROM prayer_candles pc WHERE pc.prayer_id = pr.id AND pc.user_id = $1) AS lit,
    COALESCE((SELECT json_agg(json_build_object('id', x.id, 'text', x.body, 'createdAt', x.created_at) ORDER BY x.created_at DESC)
              FROM prayer_updates x WHERE x.prayer_id = pr.id), '[]'::json) AS updates
  FROM prayers pr JOIN users u ON u.id = pr.author_id`;

// Who may see a prayer: Public → everyone; Church → people in the same church; Private → only the author.
const VISIBLE = `(pr.author_id = $1 OR pr.audience = 'Public'
  OR (pr.audience = 'Church' AND u.church IS NOT NULL AND u.church = (SELECT church FROM users WHERE id = $1)))
  AND pr.status <> 'archived' AND NOT u.banned`;

function shape(x, me) {
  const mine = x.author_id === me.id;
  return {
    id: x.id, author: x.anonymous && !mine ? null : x.author, title: x.title, body: x.body, audience: x.audience,
    anonymous: x.anonymous, verse: x.verse, status: x.status, praying: x.praying_count, prayed: !!x.prayed, mine,
    candles: x.candle_count || 0, lit: !!x.lit, // LIGHT A CANDLE
    createdAt: new Date(x.created_at).toISOString(),
    updates: (typeof x.updates === 'string' ? JSON.parse(x.updates) : x.updates || []).map((u) => ({ ...u, createdAt: new Date(u.createdAt).toISOString() })),
  };
}

async function load(c, id) {
  const me = c.get('user');
  const row = await one(c.env, `${SELECT} WHERE pr.id = $2 AND (${VISIBLE} OR pr.author_id = $1)`, [me.id, id]);
  if (!row) throw notFound('Prayer not found');
  return row;
}

r.get('/prayers', async (c) => {
  const me = c.get('user');
  const cur = decodeCursor(c.req.query('cursor'));
  const args = [me.id];
  let w = VISIBLE;
  if (cur) { args.push(cur.ts, cur.id); w += ` AND (pr.created_at, pr.id) < ($2::timestamptz, $3::uuid)`; }
  const rows = await q(c.env, `${SELECT} WHERE ${w} ORDER BY pr.created_at DESC, pr.id DESC LIMIT 31`, args);
  const items = rows.slice(0, 30);
  return c.json({ items: items.map((x) => shape(x, me)), nextCursor: rows.length > 30 ? encodeCursor(items[items.length - 1]) : null });
});

r.post('/prayers', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const audience = b.audience || 'Public';
  if (!['Public', 'Church', 'Private'].includes(audience)) throw bad('audience must be Public, Church or Private');
  const row = await one(c.env, `INSERT INTO prayers (author_id, title, body, audience, anonymous, verse) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [me.id, str(b.title, { min: 1, max: 200, field: 'Title' }), str(b.body, { max: 4000, field: 'Prayer' }), audience, !!b.anonymous, str(b.verse, { max: 40, optional: true })]);
  return c.json(shape(await load(c, row.id), me), 201);
});

r.post('/prayers/:id/pray', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  await load(c, id);
  const del = await q(c.env, 'DELETE FROM prayer_intercessions WHERE prayer_id = $1 AND user_id = $2 RETURNING 1', [id, me.id]);
  if (!del.length) await q(c.env, 'INSERT INTO prayer_intercessions (prayer_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, me.id]);
  const row = await one(c.env, `UPDATE prayers SET praying_count = (SELECT count(*) FROM prayer_intercessions WHERE prayer_id = $1),
      status = CASE WHEN status = 'active' THEN 'receiving' ELSE status END WHERE id = $1 RETURNING praying_count`, [id]);
  await supportChanged(c, id, 'pray', !del.length); // LIGHT A CANDLE: grouped notice to the poster + live counts
  return c.json({ prayed: !del.length, praying: row.praying_count });
});

r.post('/prayers/:id/updates', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c);
  const own = await one(c.env, 'SELECT id FROM prayers WHERE id = $1 AND author_id = $2', [id, me.id]);
  if (!own) throw forbidden('Only the person who asked for prayer can post updates');
  if (b.status !== undefined) {
    if (!['active', 'receiving', 'answered', 'archived'].includes(b.status)) throw bad('Unknown status');
    await q(c.env, 'UPDATE prayers SET status = $2 WHERE id = $1', [id, b.status]);
  }
  const text = str(b.text, { max: 2000, optional: true });
  if (text) await q(c.env, 'INSERT INTO prayer_updates (prayer_id, body) VALUES ($1,$2)', [id, text]);
  return c.json(shape(await load(c, id), me));
});

// ---------- LIGHT A CANDLE (brief 6.6): candles, live counts, who prayed / lit, grouped notices ----------
// Uniqueness per user + prayer + action is the primary key of prayer_intercessions / prayer_candles.
export const SUPPORT_QUIET_MS = 3 * 3600 * 1000; // at most one new push per prayer + action in this window

export function supportText(action, n) {
  if (action === 'candle') return n === 1 ? '1 person lit a candle for your prayer 🕯️' : `${n} people lit a candle for your prayer 🕯️`;
  return n === 1 ? '1 person is praying for your prayer 🙏' : `${n} people are praying for your prayer 🙏`;
}

// Tell the poster gently: while a notice for this prayer + action is recent, update it in place (new count,
// back to unread, no push). After the quiet window a new notice (with push) goes out — only if the count grew.
async function supportChanged(c, prayerId, action, added) {
  const env = c.env;
  const me = c.get('user');
  try {
    const pr = await one(env, 'SELECT id, author_id, title, praying_count, candle_count FROM prayers WHERE id = $1', [prayerId]);
    if (!pr) return;
    await notifyUser(env, pr.author_id, { type: 'prayer.support', prayerId, praying: pr.praying_count, candles: pr.candle_count });
    if (!added || pr.author_id === me.id) return;
    const count = action === 'candle' ? pr.candle_count : pr.praying_count;
    if (count < 1) return;
    const title = supportText(action, count);
    const text = `“${pr.title}”`;
    const group = `prayer-support:${prayerId}:${action}`;
    const data = { prayerId, action, count, group, route: 'Prayer' };
    const notice = await one(env, 'SELECT * FROM prayer_support_notices WHERE prayer_id = $1 AND action = $2', [prayerId, action]);
    if (notice && count <= notice.last_count) return; // an undo + redo never notifies again
    if (notice && notice.notification_id && Date.now() - new Date(notice.last_push_at).getTime() < SUPPORT_QUIET_MS) {
      const upd = await one(env, `UPDATE notifications SET title = $2, body = $3, data = $4::jsonb, read_at = NULL, created_at = now()
        WHERE id = $1 RETURNING id`, [notice.notification_id, title, text, JSON.stringify(data)]);
      if (upd) {
        await q(env, 'UPDATE prayer_support_notices SET last_count = $3 WHERE prayer_id = $1 AND action = $2', [prayerId, action, count]);
        return;
      }
    }
    await sendNotification(c, { userId: pr.author_id, kind: 'prayer', title, body: text, data });
    const n = await one(env, `SELECT id FROM notifications WHERE user_id = $1 AND data->>'group' = $2 ORDER BY created_at DESC LIMIT 1`, [pr.author_id, group]);
    await q(env, `INSERT INTO prayer_support_notices (prayer_id, action, notification_id, last_count, last_push_at) VALUES ($1,$2,$3,$4, now())
      ON CONFLICT (prayer_id, action) DO UPDATE SET notification_id = EXCLUDED.notification_id, last_count = EXCLUDED.last_count, last_push_at = now()`,
    [prayerId, action, n ? n.id : null, count]);
  } catch (e) { console.warn('[prayers] support notice failed:', e.message); }
}

// POST /prayers/:id/candle {lit?: boolean} — toggle my candle (or set it explicitly). → { lit, candles }
r.post('/prayers/:id/candle', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const p = await load(c, id);
  if (p.status === 'archived') throw bad('This prayer was archived', 'ARCHIVED');
  const b = await c.req.json().catch(() => ({}));
  const want = b && typeof b.lit === 'boolean' ? b.lit : !p.lit;
  let changed = false;
  if (want) changed = (await q(c.env, 'INSERT INTO prayer_candles (prayer_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1', [id, me.id])).length > 0;
  else changed = (await q(c.env, 'DELETE FROM prayer_candles WHERE prayer_id = $1 AND user_id = $2 RETURNING 1', [id, me.id])).length > 0;
  const row = await one(c.env, `UPDATE prayers SET candle_count = (SELECT count(*) FROM prayer_candles WHERE prayer_id = $1)
    WHERE id = $1 RETURNING candle_count`, [id]);
  if (changed) await supportChanged(c, id, 'candle', want);
  return c.json({ lit: want, candles: row.candle_count });
});

// GET /prayers/support?ids=a,b,… — live counts for the cards on screen (polled while the wall is open)
r.get('/prayers/support', async (c) => {
  const me = c.get('user');
  const ids = String(c.req.query('ids') || '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 60);
  if (!ids.length) return c.json({ items: [] });
  const rows = await q(c.env, `SELECT pr.id, pr.praying_count, pr.candle_count,
      EXISTS (SELECT 1 FROM prayer_intercessions i WHERE i.prayer_id = pr.id AND i.user_id = $1) AS prayed,
      EXISTS (SELECT 1 FROM prayer_candles pc WHERE pc.prayer_id = pr.id AND pc.user_id = $1) AS lit
    FROM prayers pr JOIN users u ON u.id = pr.author_id WHERE pr.id = ANY($2::uuid[]) AND ${VISIBLE}`, [me.id, ids]);
  return c.json({ items: rows.map((x) => ({ id: x.id, praying: x.praying_count, candles: x.candle_count, prayed: !!x.prayed, lit: !!x.lit })) });
});

// GET /prayers/:id/supporters?action=pray|candle — who is praying / lit a candle (only for people who can see the
// prayer; a Private prayer is only visible to its author). The poster of an anonymous prayer is never revealed here.
r.get('/prayers/:id/supporters', async (c) => {
  const id = uuidParam(c);
  await load(c, id);
  const action = c.req.query('action') === 'candle' ? 'candle' : 'pray';
  const table = action === 'candle' ? 'prayer_candles' : 'prayer_intercessions';
  const rows = await q(c.env, `SELECT ${userJson('u')} AS user, s.created_at FROM ${table} s JOIN users u ON u.id = s.user_id
    WHERE s.prayer_id = $1 AND NOT u.banned ORDER BY s.created_at DESC LIMIT 200`, [id]);
  return c.json({ action, items: rows.map((x) => ({ user: typeof x.user === 'string' ? JSON.parse(x.user) : x.user, at: new Date(x.created_at).toISOString() })) });
});

export default r;
