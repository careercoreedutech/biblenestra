// Notifications inbox & settings routes
import { Hono } from 'hono';
import { body, uuidParam, encodeCursor, decodeCursor } from '../lib/http.js';
import { q, one } from '../lib/db.js';

const notifications = new Hono();

// GET /me/notifications — paginated notifications
notifications.get('/me/notifications', async (c) => {
  const me = c.get('user');
  const cursor = decodeCursor(c.req.query('cursor'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '30', 10)));

  let sql = `SELECT * FROM notifications WHERE user_id = $1`;
  const params = [me.id];

  if (cursor) {
    params.push(cursor.ts, cursor.id);
    sql += ` AND (created_at, id) < ($2, $3)`;
  }

  params.push(limit + 1);
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

  const rows = await q(c.env, sql, params);
  const unreadRow = await one(c.env,
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [me.id]
  );

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    read: !!r.read_at,
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  const nextCursor = hasMore && items.length > 0 ? encodeCursor(rows[limit - 1]) : null;

  return c.json({
    items,
    unreadCount: unreadRow?.count || 0,
    cursor: nextCursor,
    hasMore,
  });
});

// POST /me/notifications/read — mark one or all notifications read
notifications.post('/me/notifications/read', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const id = b.id;

  if (id) {
    await q(c.env, `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2`, [id, me.id]);
  } else {
    await q(c.env, `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [me.id]);
  }

  return c.json({ ok: true });
});

// GET /me/notify-settings
notifications.get('/me/notify-settings', async (c) => {
  const me = c.get('user');
  const row = await one(c.env, `SELECT notify FROM users WHERE id = $1`, [me.id]);
  return c.json({ live: true, broadcasts: true, ...(row?.notify || { messages: true, groups: true, prayer: true, events: true, gifts: true, jobs: true }) });
});

// PUT /me/notify-settings
notifications.put('/me/notify-settings', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const current = (await one(c.env, `SELECT notify FROM users WHERE id = $1`, [me.id]))?.notify || {};
  const updated = {
    ...current,
    ...(b.messages !== undefined && { messages: !!b.messages }),
    ...(b.groups !== undefined && { groups: !!b.groups }),
    ...(b.prayer !== undefined && { prayer: !!b.prayer }),
    ...(b.events !== undefined && { events: !!b.events }),
    ...(b.gifts !== undefined && { gifts: !!b.gifts }),
    ...(b.jobs !== undefined && { jobs: !!b.jobs }),
    ...(b.live !== undefined && { live: !!b.live }), // YOUTUBE LIVE alerts (missing = on)
    ...(b.broadcasts !== undefined && { broadcasts: !!b.broadcasts }), // BROADCASTS: push for official messages (missing = on; the inbox copy always arrives)
  };

  await q(c.env, `UPDATE users SET notify = $1 WHERE id = $2`, [JSON.stringify(updated), me.id]);
  return c.json(updated);
});

export default notifications;
