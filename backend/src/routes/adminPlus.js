// ROUND 5 — admin dashboard sections: Dashboard stats, Users, Content, Communities & events, Announcements.
// Every /admin/api/* route here requires users.role = 'admin' (requireAdmin) and writes to admin_actions (audit).
// The page's tabs for these live in lib/adminPlusPage.js (registered through registerAdminScript).
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { bad, body, forbidden, int, notFound, str, uuidParam } from '../lib/http.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import { ADMIN_PLUS_SCRIPT } from '../lib/adminPlusPage.js';

registerAdminScript(ADMIN_PLUS_SCRIPT);

export const adminPlus = new Hono();
adminPlus.use('/admin/api/*', requireAdmin);

const iso = (d) => (d ? new Date(d).toISOString() : null);
const like = (s) => `%${String(s).replace(/[\\%_]/g, (ch) => '\\' + ch)}%`;
const limitOf = (c, def = 50) => Math.min(Math.max(Number(c.req.query('limit')) || def, 1), 100);
const beforeOf = (c) => {
  const b = c.req.query('before');
  if (!b) return null;
  const d = new Date(b);
  if (Number.isNaN(d.getTime())) throw bad('Bad “before” cursor');
  return d.toISOString();
};

// =====================================================================
// Dashboard
// =====================================================================
adminPlus.get('/admin/api/stats', async (c) => {
  const t = await one(c.env, `SELECT
      (SELECT COUNT(*) FROM users)::int AS users,
      (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '1 day')::int AS new_users_24h,
      (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '7 days')::int AS new_users_7d,
      (SELECT COUNT(*) FROM users WHERE last_seen_at > now() - interval '1 day')::int AS active_24h,
      (SELECT COUNT(*) FROM users WHERE last_seen_at > now() - interval '7 days')::int AS active_7d,
      (SELECT COUNT(*) FROM users WHERE banned)::int AS banned,
      (SELECT COUNT(*) FROM posts WHERE NOT removed)::int AS posts,
      (SELECT COUNT(*) FROM posts WHERE created_at > now() - interval '1 day')::int AS posts_24h,
      (SELECT COUNT(*) FROM comments)::int AS comments,
      (SELECT COUNT(*) FROM messages WHERE created_at > now() - interval '1 day')::int AS messages_24h,
      (SELECT COUNT(*) FROM prayers WHERE status <> 'archived')::int AS prayers,
      (SELECT COUNT(*) FROM communities)::int AS communities,
      (SELECT COUNT(*) FROM events WHERE starts_at > now())::int AS upcoming_events,
      (SELECT COUNT(*) FROM reports WHERE resolved_at IS NULL)::int AS open_reports,
      (SELECT COUNT(*) FROM fundraisers WHERE status = 'pending_review')::int AS pending_fundraisers,
      (SELECT COALESCE(SUM(coins), 0) FROM users)::bigint AS coins_in_circulation,
      (SELECT COUNT(*) FROM gift_transactions WHERE created_at > now() - interval '7 days')::int AS gifts_7d,
      (SELECT COUNT(*) FROM announcements WHERE active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()))::int AS live_announcements`);
  const series = await q(c.env, `SELECT d::date AS day,
      (SELECT COUNT(*) FROM users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day')::int AS signups,
      (SELECT COUNT(*) FROM posts p WHERE p.created_at >= d AND p.created_at < d + interval '1 day')::int AS posts,
      (SELECT COUNT(*) FROM messages m WHERE m.created_at >= d AND m.created_at < d + interval '1 day')::int AS messages
    FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
    ORDER BY d`);
  const recent = await q(c.env, `SELECT id, display_name, handle, avatar_url, created_at FROM users ORDER BY created_at DESC LIMIT 8`);
  const totals = {};
  for (const [k, v] of Object.entries(t)) totals[k.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase())] = Number(v);
  return c.json({
    totals,
    series: series.map((r) => ({ day: new Date(r.day).toISOString().slice(0, 10), signups: r.signups, posts: r.posts, messages: r.messages })),
    recentSignups: recent.map((u) => ({ id: u.id, displayName: u.display_name, handle: u.handle, avatarUrl: u.avatar_url, createdAt: iso(u.created_at) })),
  });
});

// =====================================================================
// Users
// =====================================================================
const userRow = (u) => ({
  id: u.id,
  displayName: u.display_name,
  handle: u.handle,
  avatarUrl: u.avatar_url,
  headline: u.headline,
  church: u.church,
  country: u.country,
  role: u.role || 'user',
  verified: !!u.verified,
  banned: !!u.banned,
  bannedReason: u.banned_reason || null,
  coins: Number(u.coins || 0),
  posts: u.posts_count != null ? Number(u.posts_count) : undefined,
  followers: u.followers_count != null ? Number(u.followers_count) : undefined,
  openReports: u.open_reports != null ? Number(u.open_reports) : undefined,
  createdAt: iso(u.created_at),
  lastSeenAt: iso(u.last_seen_at),
});

adminPlus.get('/admin/api/users', async (c) => {
  const search = (c.req.query('q') || '').trim();
  const filter = c.req.query('filter') || 'all';
  const limit = limitOf(c);
  const before = beforeOf(c);
  const where = [];
  const args = [];
  if (search) { args.push(like(search)); where.push(`(u.display_name ILIKE $${args.length} OR u.handle ILIKE $${args.length} OR u.church ILIKE $${args.length} OR u.clerk_id = $${args.length + 1})`); args.push(search); }
  if (filter === 'banned') where.push('u.banned');
  else if (filter === 'admins') where.push(`u.role = 'admin'`);
  else if (filter === 'verified') where.push('u.verified');
  else if (filter === 'reported') where.push(`EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id AND r.resolved_at IS NULL)`);
  if (before) { args.push(before); where.push(`u.created_at < $${args.length}`); }
  args.push(limit + 1);
  const rows = await q(c.env, `SELECT u.*,
      (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND NOT p.removed) AS posts_count,
      (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers_count,
      (SELECT COUNT(*) FROM reports r WHERE r.resolved_at IS NULL AND (
         (r.target_type = 'user' AND r.target_id = u.id)
         OR (r.target_type = 'post' AND r.target_id IN (SELECT id FROM posts WHERE author_id = u.id))
         OR (r.target_type = 'comment' AND r.target_id IN (SELECT id FROM comments WHERE author_id = u.id)))) AS open_reports
    FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.created_at DESC LIMIT $${args.length}`, args);
  const more = rows.length > limit;
  const items = (more ? rows.slice(0, limit) : rows).map(userRow);
  return c.json({ items, next: more ? items[items.length - 1].createdAt : null });
});

async function loadUser(c) {
  const u = await one(c.env, 'SELECT * FROM users WHERE id = $1', [uuidParam(c)]);
  if (!u) throw notFound('User not found');
  return u;
}

adminPlus.get('/admin/api/users/:id', async (c) => {
  const u = await loadUser(c);
  const [counts, posts, ledger, communities, reports] = await Promise.all([
    one(c.env, `SELECT
        (SELECT COUNT(*) FROM posts WHERE author_id = $1)::int AS posts,
        (SELECT COUNT(*) FROM comments WHERE author_id = $1)::int AS comments,
        (SELECT COUNT(*) FROM prayers WHERE author_id = $1)::int AS prayers,
        (SELECT COUNT(*) FROM messages WHERE sender_id = $1)::int AS messages,
        (SELECT COUNT(*) FROM follows WHERE followee_id = $1)::int AS followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = $1)::int AS following`, [u.id]),
    q(c.env, `SELECT id, kind, body, removed, likes_count, comments_count, created_at FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT 10`, [u.id]),
    q(c.env, `SELECT amount, reason, created_at FROM coin_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15`, [u.id]),
    q(c.env, `SELECT c.id, c.name, cm.role FROM community_members cm JOIN communities c ON c.id = cm.community_id
              WHERE cm.user_id = $1 AND cm.status = 'member' ORDER BY (cm.role = 'owner') DESC, c.name LIMIT 20`, [u.id]),
    q(c.env, `SELECT r.id, r.target_type, r.reason, r.created_at FROM reports r WHERE r.resolved_at IS NULL AND (
                (r.target_type = 'user' AND r.target_id = $1)
                OR (r.target_type = 'post' AND r.target_id IN (SELECT id FROM posts WHERE author_id = $1))
                OR (r.target_type = 'comment' AND r.target_id IN (SELECT id FROM comments WHERE author_id = $1)))
              ORDER BY r.created_at DESC LIMIT 20`, [u.id]),
  ]);
  return c.json({
    ...userRow(u),
    bio: u.bio,
    counts,
    posts: posts.map((p) => ({ id: p.id, kind: p.kind, text: p.body, removed: p.removed, likes: p.likes_count, comments: p.comments_count, createdAt: iso(p.created_at) })),
    coinLedger: ledger.map((l) => ({ amount: Number(l.amount), reason: l.reason, createdAt: iso(l.created_at) })),
    communities: communities.map((x) => ({ id: x.id, name: x.name, role: x.role })),
    openReports: reports.map((r) => ({ id: r.id, targetType: r.target_type, reason: r.reason, createdAt: iso(r.created_at) })),
  });
});

adminPlus.post('/admin/api/users/:id/ban', async (c) => {
  const me = c.get('user');
  const u = await loadUser(c);
  const b = await body(c).catch(() => ({}));
  const banned = b.banned !== false;
  if (u.id === me.id) throw bad('You can’t ban yourself');
  if (banned && u.role === 'admin') throw forbidden('Remove admin rights before banning this account');
  const reason = banned ? str(b.reason, { max: 300, optional: true, field: 'reason' }) || null : null;
  await q(c.env, 'UPDATE users SET banned = $2, banned_reason = $3 WHERE id = $1', [u.id, banned, reason]);
  await audit(c.env, me, banned ? 'user.ban' : 'user.unban', 'user', u.id, { displayName: u.display_name, reason });
  return c.json({ ok: true, banned });
});

adminPlus.post('/admin/api/users/:id/role', async (c) => {
  const me = c.get('user');
  const u = await loadUser(c);
  const b = await body(c);
  const role = b.role === 'admin' ? 'admin' : b.role === 'user' ? 'user' : null;
  if (!role) throw bad('role must be “admin” or “user”');
  if (role === 'admin' && u.banned) throw bad('Unban this account before making it an admin');
  if (role === 'user' && u.id === me.id) throw bad('You can’t remove your own admin rights');
  if (role === 'user' && u.role === 'admin') {
    const n = await one(c.env, `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`);
    if (n.n <= 1) throw bad('There must be at least one admin');
  }
  await q(c.env, 'UPDATE users SET role = $2 WHERE id = $1', [u.id, role]);
  await audit(c.env, me, role === 'admin' ? 'user.make_admin' : 'user.remove_admin', 'user', u.id, { displayName: u.display_name });
  return c.json({ ok: true, role });
});

adminPlus.post('/admin/api/users/:id/verify', async (c) => {
  const me = c.get('user');
  const u = await loadUser(c);
  const b = await body(c).catch(() => ({}));
  const verified = b.verified !== false;
  await q(c.env, 'UPDATE users SET verified = $2 WHERE id = $1', [u.id, verified]);
  await audit(c.env, me, verified ? 'user.verify' : 'user.unverify', 'user', u.id, { displayName: u.display_name });
  return c.json({ ok: true, verified });
});

adminPlus.post('/admin/api/users/:id/coins', async (c) => {
  const me = c.get('user');
  const u = await loadUser(c);
  const b = await body(c);
  const amount = int(b.amount, { min: -1000000, max: 1000000, field: 'amount' });
  if (!amount) throw bad('Amount can’t be 0');
  const reason = str(b.reason, { min: 3, max: 120, field: 'reason' });
  const row = await one(c.env, `UPDATE users SET coins = coins + $2 WHERE id = $1 AND coins + $2 >= 0 RETURNING coins`, [u.id, amount]);
  if (!row) throw bad(`That would leave ${u.display_name} below 0 coins (they have ${u.coins})`, 'INSUFFICIENT_COINS');
  await q(c.env, `INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES ($1, $2, 'admin_adjustment', $3)`, [u.id, amount, reason.slice(0, 120)]);
  await audit(c.env, me, 'user.coins', 'user', u.id, { displayName: u.display_name, amount, reason });
  return c.json({ ok: true, coins: Number(row.coins) });
});

// =====================================================================
// Content: posts (incl. reels/videos), comments, prayer requests
// =====================================================================
const CONTENT = {
  posts: {
    sql: `SELECT p.id, p.kind, p.body AS text, p.removed, p.likes_count, p.comments_count, p.video_url, p.video_thumb, p.created_at,
                 u.id AS author_id, u.display_name AS author_name, u.banned AS author_banned,
                 (SELECT COUNT(*) FROM post_media pm WHERE pm.post_id = p.id)::int AS media_count,
                 (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.resolved_at IS NULL)::int AS open_reports
          FROM posts p JOIN users u ON u.id = p.author_id`,
    alias: 'p',
  },
  comments: {
    sql: `SELECT cm.id, 'comment' AS kind, cm.body AS text, false AS removed, cm.post_id, cm.created_at,
                 u.id AS author_id, u.display_name AS author_name, u.banned AS author_banned,
                 (SELECT LEFT(p.body, 80) FROM posts p WHERE p.id = cm.post_id) AS post_text,
                 (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'comment' AND r.target_id = cm.id AND r.resolved_at IS NULL)::int AS open_reports
          FROM comments cm JOIN users u ON u.id = cm.author_id`,
    alias: 'cm',
  },
  prayers: {
    sql: `SELECT pr.id, 'prayer' AS kind, pr.title || CASE WHEN pr.body <> '' THEN E'\\n' || pr.body ELSE '' END AS text,
                 (pr.status = 'archived') AS removed, pr.status, pr.anonymous, pr.praying_count, pr.created_at,
                 u.id AS author_id, u.display_name AS author_name, u.banned AS author_banned,
                 (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'prayer' AND r.target_id = pr.id AND r.resolved_at IS NULL)::int AS open_reports
          FROM prayers pr JOIN users u ON u.id = pr.author_id`,
    alias: 'pr',
  },
};
const textCol = { posts: 'p.body', comments: 'cm.body', prayers: "(pr.title || ' ' || pr.body)" };

adminPlus.get('/admin/api/content/:type', async (c) => {
  const type = c.req.param('type');
  const def = CONTENT[type];
  if (!def) throw notFound('Unknown content type');
  const search = (c.req.query('q') || '').trim();
  const status = c.req.query('status') || 'all';
  const authorId = c.req.query('authorId');
  const kind = c.req.query('kind');
  const limit = limitOf(c);
  const before = beforeOf(c);
  const where = [];
  const args = [];
  if (search) { args.push(like(search)); where.push(`(${textCol[type]} ILIKE $${args.length} OR u.display_name ILIKE $${args.length})`); }
  if (authorId) { if (!/^[0-9a-f-]{36}$/i.test(authorId)) throw bad('Bad authorId'); args.push(authorId); where.push(`u.id = $${args.length}`); }
  if (type === 'posts' && kind) { args.push(kind); where.push(`p.kind = $${args.length}`); }
  if (status === 'removed') where.push(type === 'posts' ? 'p.removed' : type === 'prayers' ? `pr.status = 'archived'` : 'false');
  else if (status === 'visible') where.push(type === 'posts' ? 'NOT p.removed' : type === 'prayers' ? `pr.status <> 'archived'` : 'true');
  else if (status === 'reported') where.push(`EXISTS (SELECT 1 FROM reports r WHERE r.target_type = '${type === 'posts' ? 'post' : type === 'comments' ? 'comment' : 'prayer'}' AND r.target_id = ${def.alias}.id AND r.resolved_at IS NULL)`);
  if (before) { args.push(before); where.push(`${def.alias}.created_at < $${args.length}`); }
  args.push(limit + 1);
  const rows = await q(c.env, `${def.sql} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.alias}.created_at DESC LIMIT $${args.length}`, args);
  const more = rows.length > limit;
  const items = (more ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id,
    type,
    kind: r.kind,
    text: r.text || '',
    removed: !!r.removed,
    status: r.status,
    anonymous: r.anonymous,
    likes: r.likes_count != null ? Number(r.likes_count) : undefined,
    comments: r.comments_count != null ? Number(r.comments_count) : undefined,
    praying: r.praying_count != null ? Number(r.praying_count) : undefined,
    hasVideo: !!r.video_url,
    thumbUrl: r.video_thumb || null,
    photos: r.media_count != null ? Number(r.media_count) : undefined,
    postId: r.post_id,
    postText: r.post_text,
    openReports: Number(r.open_reports || 0),
    author: { id: r.author_id, displayName: r.author_name, banned: !!r.author_banned },
    createdAt: iso(r.created_at),
  }));
  return c.json({ items, next: more ? items[items.length - 1].createdAt : null });
});

const reportType = { posts: 'post', comments: 'comment', prayers: 'prayer' };
async function resolveReportsFor(env, me, type, id, resolution) {
  await q(env, `UPDATE reports SET resolved_at = now(), resolution = $3, resolved_by = $4
    WHERE target_type = $1 AND target_id = $2 AND resolved_at IS NULL`, [reportType[type], id, resolution, me.id]);
}

adminPlus.post('/admin/api/content/:type/:id/remove', async (c) => {
  const me = c.get('user');
  const type = c.req.param('type');
  if (!CONTENT[type]) throw notFound('Unknown content type');
  const id = uuidParam(c);
  let snap;
  if (type === 'posts') {
    snap = await one(c.env, 'UPDATE posts SET removed = true WHERE id = $1 RETURNING body', [id]);
  } else if (type === 'prayers') {
    snap = await one(c.env, `UPDATE prayers SET status = 'archived' WHERE id = $1 RETURNING title AS body`, [id]);
  } else {
    // comments have no "removed" flag — they are deleted (and the post's count corrected)
    snap = await one(c.env, `WITH del AS (DELETE FROM comments WHERE id = $1 RETURNING post_id, body)
      UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id IN (SELECT post_id FROM del)
      RETURNING (SELECT body FROM del) AS body`, [id]);
    if (!snap) snap = null;
  }
  if (!snap) throw notFound('Not found (it may already be deleted)');
  await resolveReportsFor(c.env, me, type, id, 'removed');
  await audit(c.env, me, `content.remove`, reportType[type], id, { text: String(snap.body || '').slice(0, 200) });
  return c.json({ ok: true });
});

adminPlus.post('/admin/api/content/:type/:id/restore', async (c) => {
  const me = c.get('user');
  const type = c.req.param('type');
  const id = uuidParam(c);
  let snap;
  if (type === 'posts') snap = await one(c.env, 'UPDATE posts SET removed = false WHERE id = $1 RETURNING body', [id]);
  else if (type === 'prayers') snap = await one(c.env, `UPDATE prayers SET status = 'active' WHERE id = $1 AND status = 'archived' RETURNING title AS body`, [id]);
  else throw bad('Deleted comments can’t be restored');
  if (!snap) throw notFound('Not found');
  await audit(c.env, me, 'content.restore', reportType[type], id, { text: String(snap.body || '').slice(0, 200) });
  return c.json({ ok: true });
});

// =====================================================================
// Communities & events
// =====================================================================
adminPlus.get('/admin/api/communities', async (c) => {
  const search = (c.req.query('q') || '').trim();
  const filter = c.req.query('filter') || 'all';
  const args = [];
  const where = [];
  if (search) { args.push(like(search)); where.push(`(c.name ILIKE $1 OR c.description ILIKE $1 OR u.display_name ILIKE $1)`); }
  if (filter === 'hidden') where.push('c.hidden');
  else if (filter === 'verified') where.push('c.verified');
  else if (filter === 'private') where.push(`c.privacy = 'Private'`);
  const rows = await q(c.env, `SELECT c.*, u.display_name AS owner_name, u.id AS owner_uid,
      (SELECT COUNT(*) FROM events e WHERE e.community_id = c.id AND e.starts_at > now())::int AS upcoming_events,
      (SELECT COUNT(*) FROM messages m JOIN community_channels cc ON cc.conversation_id = m.conversation_id
         WHERE cc.community_id = c.id AND m.created_at > now() - interval '7 days')::int AS messages_7d
    FROM communities c LEFT JOIN users u ON u.id = c.owner_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.created_at DESC LIMIT 200`, args);
  return c.json({ items: rows.map((r) => ({
    id: r.id, name: r.name, description: r.description, privacy: r.privacy, verified: !!r.verified, hidden: !!r.hidden,
    members: Number(r.members_count || 0), upcomingEvents: r.upcoming_events, messages7d: r.messages_7d,
    owner: r.owner_uid ? { id: r.owner_uid, displayName: r.owner_name } : null, createdAt: iso(r.created_at),
  })) });
});

async function loadCommunity(c) {
  const row = await one(c.env, 'SELECT * FROM communities WHERE id = $1', [uuidParam(c)]);
  if (!row) throw notFound('Community not found');
  return row;
}

adminPlus.patch('/admin/api/communities/:id', async (c) => {
  const me = c.get('user');
  const cm = await loadCommunity(c);
  const b = await body(c);
  const verified = b.verified !== undefined ? !!b.verified : cm.verified;
  const hidden = b.hidden !== undefined ? !!b.hidden : cm.hidden;
  await q(c.env, 'UPDATE communities SET verified = $2, hidden = $3 WHERE id = $1', [cm.id, verified, hidden]);
  const changes = {};
  if (verified !== cm.verified) changes.verified = verified;
  if (hidden !== cm.hidden) changes.hidden = hidden;
  await audit(c.env, me, 'community.update', 'community', cm.id, { title: cm.name, ...changes });
  return c.json({ ok: true, verified, hidden });
});

adminPlus.post('/admin/api/communities/:id/owner', async (c) => {
  const me = c.get('user');
  const cm = await loadCommunity(c);
  const b = await body(c);
  const userId = String(b.userId || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw bad('Pick a member to make owner');
  const mem = await one(c.env, `SELECT cm.status, u.display_name, u.banned FROM community_members cm JOIN users u ON u.id = cm.user_id
                                WHERE cm.community_id = $1 AND cm.user_id = $2`, [cm.id, userId]);
  if (!mem || mem.status !== 'member') throw bad('The new owner must already be a member of this community');
  if (mem.banned) throw bad('That account is banned');
  await q(c.env, `UPDATE community_members SET role = 'admin' WHERE community_id = $1 AND user_id = $2 AND role = 'owner'`, [cm.id, cm.owner_id]);
  await q(c.env, `UPDATE community_members SET role = 'owner' WHERE community_id = $1 AND user_id = $2`, [cm.id, userId]);
  await q(c.env, 'UPDATE communities SET owner_id = $2 WHERE id = $1', [cm.id, userId]);
  // channel conversations: new owner becomes owner, old owner admin
  await q(c.env, `UPDATE conversation_members SET role = 'admin' WHERE user_id = $2 AND role = 'owner'
                  AND conversation_id IN (SELECT conversation_id FROM community_channels WHERE community_id = $1)`, [cm.id, cm.owner_id]);
  await q(c.env, `INSERT INTO conversation_members (conversation_id, user_id, role)
                  SELECT conversation_id, $2, 'owner' FROM community_channels WHERE community_id = $1
                  ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = 'owner'`, [cm.id, userId]);
  await audit(c.env, me, 'community.transfer', 'community', cm.id, { title: cm.name, newOwner: mem.display_name });
  return c.json({ ok: true });
});

adminPlus.get('/admin/api/communities/:id/members', async (c) => {
  const cm = await loadCommunity(c);
  const rows = await q(c.env, `SELECT u.id, u.display_name, u.handle, cm.role, cm.status FROM community_members cm JOIN users u ON u.id = cm.user_id
                               WHERE cm.community_id = $1 AND cm.status = 'member' ORDER BY (cm.role = 'owner') DESC, (cm.role = 'admin') DESC, u.display_name LIMIT 300`, [cm.id]);
  return c.json({ items: rows.map((r) => ({ id: r.id, displayName: r.display_name, handle: r.handle, role: r.role })) });
});

adminPlus.delete('/admin/api/communities/:id', async (c) => {
  const me = c.get('user');
  const cm = await loadCommunity(c);
  const b = await body(c).catch(() => ({}));
  if (String(b.confirmName || '').trim() !== cm.name) throw bad('Type the community’s exact name to delete it', 'CONFIRM_NAME');
  // channel conversations go with it (messages, pins, reactions cascade)
  await q(c.env, `DELETE FROM conversations WHERE id IN (SELECT conversation_id FROM community_channels WHERE community_id = $1)`, [cm.id]);
  await q(c.env, 'DELETE FROM communities WHERE id = $1', [cm.id]);
  await audit(c.env, me, 'community.delete', 'community', cm.id, { title: cm.name, members: cm.members_count });
  return c.json({ ok: true });
});

adminPlus.get('/admin/api/events', async (c) => {
  const when = c.req.query('when') === 'past' ? 'past' : 'upcoming';
  const rows = await q(c.env, `SELECT e.*, u.display_name AS host_name, co.name AS community_name,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')::int AS going
    FROM events e LEFT JOIN users u ON u.id = e.host_id LEFT JOIN communities co ON co.id = e.community_id
    WHERE ${when === 'past' ? 'e.starts_at <= now()' : 'e.starts_at > now()'}
    ORDER BY e.starts_at ${when === 'past' ? 'DESC' : 'ASC'} LIMIT 200`);
  return c.json({ items: rows.map((e) => ({
    id: e.id, title: e.title, description: e.description, startsAt: iso(e.starts_at), endsAt: iso(e.ends_at),
    location: e.location, onlineUrl: e.online_url, going: e.going,
    host: e.host_id ? { id: e.host_id, displayName: e.host_name } : null,
    community: e.community_id ? { id: e.community_id, name: e.community_name } : null,
  })) });
});

adminPlus.delete('/admin/api/events/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const ev = await one(c.env, 'SELECT id, title, host_id FROM events WHERE id = $1', [id]);
  if (!ev) throw notFound('Event not found');
  const b = await body(c).catch(() => ({}));
  const reason = str(b.reason, { max: 200, optional: true, field: 'reason' }) || null;
  const going = await q(c.env, `SELECT user_id FROM event_rsvps WHERE event_id = $1`, [id]);
  await q(c.env, 'DELETE FROM events WHERE id = $1', [id]);
  // let the host and the people who RSVP'd know (in-app notification)
  const notify = [...new Set([ev.host_id, ...going.map((g) => g.user_id)].filter(Boolean))];
  for (const uid of notify) {
    await q(c.env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'event', $2, $3, $4::jsonb)`,
      [uid, `“${ev.title}” was cancelled`, reason || 'This event was removed by the BibleNestra team.', JSON.stringify({ eventId: id })]);
  }
  await audit(c.env, me, 'event.delete', 'event', id, { title: ev.title, reason, notified: notify.length });
  return c.json({ ok: true, notified: notify.length });
});

// =====================================================================
// Announcements (admin side)
// =====================================================================
const KINDS = ['info', 'verse', 'event', 'update', 'urgent'];
export const announcementShape = (a) => ({
  id: a.id, title: a.title, body: a.body, kind: a.kind, verseRef: a.verse_ref || null, linkUrl: a.link_url || null,
  startsAt: iso(a.starts_at), endsAt: iso(a.ends_at), active: !!a.active, createdAt: iso(a.created_at),
});
const CUR_KEY = { verseRef: 'verse_ref', linkUrl: 'link_url', startsAt: 'starts_at', endsAt: 'ends_at' };
function announcementInput(b, cur = {}) {
  // b uses API names (verseRef…); cur is a database row (verse_ref…) when editing
  const pick = (k, fn) => {
    if (b[k] !== undefined) return fn(b[k]);
    const v = cur[CUR_KEY[k] || k];
    return v instanceof Date ? v.toISOString() : v;
  };
  const out = {
    title: pick('title', (v) => str(v, { min: 1, max: 120, field: 'title' }).trim()),
    body: pick('body', (v) => str(v || '', { max: 1000, field: 'text' })),
    kind: pick('kind', (v) => { if (!KINDS.includes(v)) throw bad('Unknown type'); return v; }),
    verse_ref: pick('verseRef', (v) => (v ? str(v, { max: 60, field: 'verse' }).trim() : null)),
    link_url: pick('linkUrl', (v) => {
      if (!v) return null;
      const s = str(v, { max: 500, field: 'link' }).trim();
      if (!/^https:\/\/[^\s]+$/i.test(s)) throw bad('Links must start with https://');
      return s;
    }),
    starts_at: pick('startsAt', (v) => { const d = v ? new Date(v) : new Date(); if (Number.isNaN(d.getTime())) throw bad('Bad start time'); return d.toISOString(); }),
    ends_at: pick('endsAt', (v) => { if (!v) return null; const d = new Date(v); if (Number.isNaN(d.getTime())) throw bad('Bad end time'); return d.toISOString(); }),
    active: pick('active', (v) => !!v),
  };
  if (!out.title) throw bad('A title is required');
  if (out.ends_at && out.starts_at && new Date(out.ends_at) <= new Date(out.starts_at)) throw bad('The end must be after the start');
  return out;
}

adminPlus.get('/admin/api/announcements', async (c) => {
  const rows = await q(c.env, `SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100`);
  return c.json({ items: rows.map((a) => ({ ...announcementShape(a), live: a.active && new Date(a.starts_at) <= new Date() && (!a.ends_at || new Date(a.ends_at) > new Date()) })) });
});

adminPlus.post('/admin/api/announcements', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const a = announcementInput({ kind: 'info', active: true, startsAt: null, ...b }); // no start = now
  const row = await one(c.env, `INSERT INTO announcements (title, body, kind, verse_ref, link_url, starts_at, ends_at, active, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [a.title, a.body || '', a.kind, a.verse_ref, a.link_url, a.starts_at, a.ends_at, a.active, me.id]);
  let notified = 0;
  if (b.notifyAll && row.active && new Date(row.starts_at) <= new Date()) {
    // also put it in everyone's bell (in-app notifications; there are no push notifications yet)
    const r = await q(c.env, `INSERT INTO notifications (user_id, kind, title, body, data)
      SELECT id, 'announcement', $1, $2, $3::jsonb FROM users WHERE NOT banned RETURNING id`,
      [row.title, (row.body || '').slice(0, 300), JSON.stringify({ announcementId: row.id })]);
    notified = r.length;
  }
  await audit(c.env, me, 'announcement.create', 'announcement', row.id, { title: row.title, notified });
  return c.json({ ...announcementShape(row), notified }, 201);
});

adminPlus.patch('/admin/api/announcements/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const cur = await one(c.env, 'SELECT * FROM announcements WHERE id = $1', [id]);
  if (!cur) throw notFound('Announcement not found');
  const a = announcementInput(await body(c), cur);
  const row = await one(c.env, `UPDATE announcements SET title=$2, body=$3, kind=$4, verse_ref=$5, link_url=$6, starts_at=$7, ends_at=$8, active=$9, updated_at=now()
    WHERE id = $1 RETURNING *`, [id, a.title, a.body || '', a.kind, a.verse_ref, a.link_url, a.starts_at, a.ends_at, a.active]);
  await audit(c.env, me, 'announcement.update', 'announcement', id, { title: row.title, active: row.active });
  return c.json(announcementShape(row));
});

adminPlus.delete('/admin/api/announcements/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'DELETE FROM announcements WHERE id = $1 RETURNING title', [id]);
  if (!row) throw notFound('Announcement not found');
  await audit(c.env, me, 'announcement.delete', 'announcement', id, { title: row.title });
  return c.json({ ok: true });
});

// =====================================================================
// Announcements (app side) — any signed-in user
// =====================================================================
export const announcementsPublic = new Hono();
announcementsPublic.get('/announcements', async (c) => {
  const rows = await q(c.env, `SELECT * FROM announcements WHERE active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
    ORDER BY (kind = 'urgent') DESC, starts_at DESC LIMIT 3`);
  return c.json({ items: rows.map(announcementShape) });
});
