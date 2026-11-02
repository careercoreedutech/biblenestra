import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, body, decodeCursor, encodeCursor, forbidden, notFound, str, uuidParam } from '../lib/http.js';
import { userJson } from '../lib/shape.js';

const r = new Hono();

const SELECT = `SELECT pr.*, ${userJson('u')} AS author,
    EXISTS (SELECT 1 FROM prayer_intercessions i WHERE i.prayer_id = pr.id AND i.user_id = $1) AS prayed,
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

export default r;
