// Make a Wish routes
import { Hono } from 'hono';
import { body, str, uuidParam, bad, notFound, encodeCursor, decodeCursor } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { userJson } from '../lib/shape.js';

const wishes = new Hono();

function wishShape(r, meId) {
  return {
    id: r.id,
    authorId: r.anonymous ? null : r.author_id,
    author: r.anonymous ? { displayName: 'Anonymous Believer', verified: false } : (typeof r.author === 'string' ? JSON.parse(r.author) : r.author),
    title: r.title,
    body: r.body,
    category: r.category,
    visibility: r.visibility,
    anonymous: !!r.anonymous,
    candlesCount: parseInt(r.candles_count || '0', 10),
    amenCount: parseInt(r.amen_count || '0', 10),
    litCandle: !!r.lit_candle,
    amened: !!r.amened,
    isMine: r.author_id === meId,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// GET /wishes — paginated wishes list
wishes.get('/wishes', async (c) => {
  const me = c.get('user');
  const cursor = decodeCursor(c.req.query('cursor'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const category = c.req.query('category');

  let sql = `
    SELECT w.*, ${userJson('u')} AS author,
           EXISTS (SELECT 1 FROM wish_candles wc WHERE wc.wish_id = w.id AND wc.user_id = $1) AS lit_candle,
           EXISTS (SELECT 1 FROM wish_amens wa WHERE wa.wish_id = w.id AND wa.user_id = $1) AS amened
    FROM wishes w
    JOIN users u ON u.id = w.author_id
    WHERE (w.visibility = 'Public' OR w.author_id = $1)
  `;
  const params = [me.id];

  if (category && category !== 'All') {
    params.push(category);
    sql += ` AND w.category = $${params.length}`;
  }

  if (cursor) {
    params.push(cursor.ts, cursor.id);
    sql += ` AND (w.created_at, w.id) < ($${params.length - 1}, $${params.length})`;
  }

  params.push(limit + 1);
  sql += ` ORDER BY w.created_at DESC, w.id DESC LIMIT $${params.length}`;

  const rows = await q(c.env, sql, params);
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => wishShape(r, me.id));
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(rows[limit - 1]) : null;

  return c.json({ items, cursor: nextCursor, hasMore });
});

// POST /wishes — create a wish
wishes.post('/wishes', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, { min: 2, max: 200, field: 'title' });
  const text = str(b.body || b.text || '', { min: 2, max: 2000, field: 'body' });
  const category = str(b.category || 'Personal', { max: 50 });
  const visibility = ['Public', 'Private', 'Community'].includes(b.visibility) ? b.visibility : 'Public';
  const anonymous = !!b.anonymous;

  const row = await one(c.env,
    `INSERT INTO wishes (author_id, title, body, category, visibility, anonymous)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [me.id, title, text, category, visibility, anonymous]
  );

  const authorUser = await one(c.env, `SELECT * FROM users WHERE id = $1`, [me.id]);
  return c.json(wishShape({ ...row, author: authorUser, lit_candle: false, amened: false }, me.id), 201);
});

// POST /wishes/:id/candle — toggle lighting candle
wishes.post('/wishes/:id/candle', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const existing = await one(c.env, `SELECT 1 FROM wish_candles WHERE wish_id = $1 AND user_id = $2`, [id, me.id]);

  let litCandle = false;
  if (existing) {
    await q(c.env, `DELETE FROM wish_candles WHERE wish_id = $1 AND user_id = $2`, [id, me.id]);
    await q(c.env, `UPDATE wishes SET candles_count = GREATEST(0, candles_count - 1) WHERE id = $1`, [id]);
    litCandle = false;
  } else {
    await q(c.env, `INSERT INTO wish_candles (wish_id, user_id) VALUES ($1, $2)`, [id, me.id]);
    await q(c.env, `UPDATE wishes SET candles_count = candles_count + 1 WHERE id = $1`, [id]);
    litCandle = true;
  }

  const w = await one(c.env, `SELECT candles_count FROM wishes WHERE id = $1`, [id]);
  return c.json({ ok: true, litCandle, candlesCount: w?.candles_count || 0 });
});

// POST /wishes/:id/amen — toggle amen
wishes.post('/wishes/:id/amen', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const existing = await one(c.env, `SELECT 1 FROM wish_amens WHERE wish_id = $1 AND user_id = $2`, [id, me.id]);

  let amened = false;
  if (existing) {
    await q(c.env, `DELETE FROM wish_amens WHERE wish_id = $1 AND user_id = $2`, [id, me.id]);
    await q(c.env, `UPDATE wishes SET amen_count = GREATEST(0, amen_count - 1) WHERE id = $1`, [id]);
    amened = false;
  } else {
    await q(c.env, `INSERT INTO wish_amens (wish_id, user_id) VALUES ($1, $2)`, [id, me.id]);
    await q(c.env, `UPDATE wishes SET amen_count = amen_count + 1 WHERE id = $1`, [id]);
    amened = true;
  }

  const w = await one(c.env, `SELECT amen_count FROM wishes WHERE id = $1`, [id]);
  return c.json({ ok: true, amened, amenCount: w?.amen_count || 0 });
});

export default wishes;
