// Calendar & Events routes
import { Hono } from 'hono';
import { body, str, uuidParam, bad, notFound, forbidden } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { userJson } from '../lib/shape.js';

const events = new Hono();

function eventShape(r, meId) {
  return {
    id: r.id,
    communityId: r.community_id,
    communityName: r.community_name || null,
    hostId: r.host_id,
    host: typeof r.host === 'string' ? JSON.parse(r.host) : r.host,
    isHost: r.host_id === meId,
    title: r.title,
    description: r.description,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    location: r.location,
    onlineUrl: r.online_url,
    coverKey: r.cover_key,
    createdAt: new Date(r.created_at).toISOString(),
    myRsvp: r.my_rsvp || null,
    goingCount: parseInt(r.going_count || '0', 10),
    interestedCount: parseInt(r.interested_count || '0', 10),
  };
}

// GET /events — list upcoming events
events.get('/events', async (c) => {
  const me = c.get('user');
  const communityId = c.req.query('communityId');
  const filter = c.req.query('filter'); // 'mine' | 'community'

  let sql = `
    SELECT e.*, c.name AS community_name, ${userJson('u')} AS host,
           (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $1) AS my_rsvp,
           (SELECT COUNT(*)::int FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
           (SELECT COUNT(*)::int FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') AS interested_count
    FROM events e
    JOIN users u ON u.id = e.host_id
    LEFT JOIN communities c ON c.id = e.community_id
    WHERE e.ends_at >= now() - INTERVAL '1 day'
  `;
  const params = [me.id];

  if (communityId) {
    params.push(communityId);
    sql += ` AND e.community_id = $${params.length}`;
  }
  if (filter === 'mine') {
    params.push(me.id);
    sql += ` AND (e.host_id = $${params.length} OR EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $${params.length} AND r.status = 'going'))`;
  }

  sql += ` ORDER BY e.starts_at ASC LIMIT 50`;
  const rows = await q(c.env, sql, params);
  return c.json({ items: rows.map((r) => eventShape(r, me.id)) });
});

// POST /events — create new event
events.post('/events', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, { min: 2, max: 200, field: 'title' });
  const description = str(b.description || '', { max: 4000, optional: true }) || '';
  const startsAt = new Date(b.startsAt || b.starts_at);
  const endsAt = new Date(b.endsAt || b.ends_at || startsAt.getTime() + 3600000);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw bad('Invalid event dates');
  if (endsAt < startsAt) throw bad('End date must be after start date');

  const location = b.location ? str(b.location, { max: 500 }) : null;
  const onlineUrl = b.onlineUrl ? str(b.onlineUrl, { max: 1000 }) : null;
  const coverKey = b.coverKey ? str(b.coverKey, { max: 500 }) : null;
  const communityId = b.communityId || null;

  if (communityId) {
    const mem = await one(c.env, `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 AND status = 'member'`, [communityId, me.id]);
    if (!mem || !['owner', 'admin'].includes(mem.role)) throw forbidden('Only community admins can host community events');
  }

  const row = await one(c.env,
    `INSERT INTO events (community_id, host_id, title, description, starts_at, ends_at, location, online_url, cover_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [communityId, me.id, title, description, startsAt.toISOString(), endsAt.toISOString(), location, onlineUrl, coverKey]
  );

  // Auto RSVP host as 'going'
  await q(c.env, `INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`, [row.id, me.id]);

  const hostUser = await one(c.env, `SELECT * FROM users WHERE id = $1`, [me.id]);
  return c.json(eventShape({ ...row, host: hostUser, my_rsvp: 'going', going_count: 1, interested_count: 0 }, me.id), 201);
});

// POST /events/:id/rsvp — RSVP to event
events.post('/events/:id/rsvp', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const b = await body(c);
  const status = b.status; // 'going' | 'interested' | 'no'
  if (!['going', 'interested', 'no'].includes(status)) throw bad('Invalid RSVP status');

  const ev = await one(c.env, `SELECT id FROM events WHERE id = $1`, [id]);
  if (!ev) throw notFound('Event not found');

  if (status === 'no') {
    await q(c.env, `DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2`, [id, me.id]);
  } else {
    await q(c.env,
      `INSERT INTO event_rsvps (event_id, user_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3`,
      [id, me.id, status]
    );
  }

  const counts = await one(c.env,
    `SELECT (SELECT COUNT(*)::int FROM event_rsvps WHERE event_id = $1 AND status = 'going') AS going_count,
            (SELECT COUNT(*)::int FROM event_rsvps WHERE event_id = $1 AND status = 'interested') AS interested_count`,
    [id]
  );

  return c.json({
    ok: true,
    myRsvp: status === 'no' ? null : status,
    goingCount: counts?.going_count || 0,
    interestedCount: counts?.interested_count || 0,
  });
});

// GET /events/:id/attendees — list attendees
events.get('/events/:id/attendees', async (c) => {
  const id = uuidParam(c, 'id');
  const rows = await q(c.env,
    `SELECT r.status, r.created_at, ${userJson('u')} AS user
     FROM event_rsvps r
     JOIN users u ON u.id = r.user_id
     WHERE r.event_id = $1
     ORDER BY r.created_at ASC`,
    [id]
  );
  return c.json({
    items: rows.map((r) => ({
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      user: typeof r.user === 'string' ? JSON.parse(r.user) : r.user,
    })),
  });
});

// DELETE /events/:id — cancel event
events.delete('/events/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const ev = await one(c.env, `SELECT * FROM events WHERE id = $1`, [id]);
  if (!ev) throw notFound('Event not found');
  if (ev.host_id !== me.id) throw forbidden('Only host can cancel event');

  await q(c.env, `DELETE FROM events WHERE id = $1`, [id]);
  return c.json({ ok: true });
});

export default events;
