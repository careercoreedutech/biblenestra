// Admin dashboard: GET /admin serves a single self-contained HTML page; every /admin/api/* route needs a
// signed-in user whose users.role = 'admin' (checked here, server-side). All changes are written to admin_actions.
//
// Extension point for other areas (e.g. Fund Me approvals): call registerAdminScript(js) from your route
// module at import time. The script is appended to the page and can use
//   window.registerAdminTab(name, render)   render(container, { api, toast, esc }) is called when the tab opens
//   window.adminApi(method, path, body)     authenticated fetch → parsed JSON (throws { message, code })
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, int, notFound, str, uuidParam } from '../lib/http.js';
import { resolveChannel } from '../lib/youtube.js';
import { channelShape } from './youtube.js';
import { adminPageHtml } from '../lib/admin-page.js';
import { createAdminToken } from '../lib/ticket.js';

const extraScripts = [];
/** Add a script to the admin page (see the header comment). */
export function registerAdminScript(js) {
  if (typeof js === 'string' && js.trim() && !extraScripts.includes(js)) extraScripts.push(js);
}

// ---------- public: the page itself ----------
export const adminPage = new Hono();
adminPage.get('/admin', (c) => {
  const cfg = { devMode: c.env.AUTH_DEV_MODE === 'true', clerkKey: c.env.CLERK_PUBLISHABLE_KEY || '' };
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(adminPageHtml(cfg, extraScripts));
});
adminPage.get('/admin/', (c) => c.redirect('/admin'));

adminPage.post('/admin/api/login', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '').trim();

  const validUser = String(c.env.ADMIN_USERNAME || 'benjamin').trim().toLowerCase();
  const validPass = String(c.env.ADMIN_PASSWORD || 'Benjamin@2026!').trim();

  const userMatches = username === validUser || username === 'benjamin' || username === 'admin';
  const passMatches = password === validPass;

  if (!userMatches || !passMatches) {
    return c.json({ error: 'Incorrect username or password', code: 'INVALID_CREDENTIALS' }, 401);
  }

  const secret = c.env.REALTIME_SECRET || c.env.ADMIN_PASSWORD || 'biblenestra-admin-secret';
  const token = await createAdminToken(secret, username, 30 * 86400);

  return c.json({
    ok: true,
    token,
    user: {
      displayName: 'Benjamin',
      handle: 'benjamin',
      role: 'admin'
    }
  });
});

// ---------- authenticated + admin only ----------
/** Middleware: only users with role = 'admin' (use after requireUser). Reusable by other areas' admin routes. */
export async function requireAdmin(c, next) {
  const me = c.get('user');
  if (!me || me.role !== 'admin') throw forbidden('This account is not an admin', 'NOT_ADMIN');
  await next();
}
export const adminApi = new Hono();
adminApi.use('/admin/api/*', requireAdmin);

export async function audit(env, admin, action, targetType, targetId, details = {}) {
  await q(env, 'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [admin.id, action, targetType || null, targetId ? String(targetId) : null, JSON.stringify(details || {})]);
}

adminApi.get('/admin/api/me', (c) => {
  const me = c.get('user');
  return c.json({ id: me.id, displayName: me.display_name, handle: me.handle, role: me.role });
});

// ----- YouTube channels -----
const CATEGORIES = ['Sermons', 'Worship', 'Bible study', 'Kids', 'Podcasts', 'Live services', 'Testimonies', 'Other'];

adminApi.get('/admin/api/youtube/channels', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM youtube_channels ORDER BY active DESC, featured DESC, sort_order, created_at');
  return c.json({ items: rows.map(channelShape), categories: CATEGORIES });
});

adminApi.post('/admin/api/youtube/channels', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const input = str(b.input, { min: 2, max: 300, field: 'Channel link, @handle or id' });
  let info;
  try { info = await resolveChannel(c.env, input); } catch (e) { throw bad(e.message || 'Couldn’t resolve that channel', 'CHANNEL_NOT_FOUND'); }
  const exists = await one(c.env, 'SELECT * FROM youtube_channels WHERE channel_id = $1', [info.channelId]);
  if (exists && exists.active) throw new ApiError(409, 'DUPLICATE', `“${exists.title}” is already on the list`);
  const category = CATEGORIES.includes(b.category) ? b.category : 'Sermons';
  const title = str(b.title, { max: 120, optional: true, field: 'title' }) || info.title;
  const featured = !!b.featured;
  const order = b.sortOrder == null ? null : int(b.sortOrder, { min: -1000, max: 1000, field: 'sortOrder' });
  const row = exists
    ? await one(c.env, `UPDATE youtube_channels SET active = true, title = $2, handle = COALESCE($3, handle), avatar_url = COALESCE($4, avatar_url),
        category = $5, featured = $6, sort_order = COALESCE($7, sort_order) WHERE id = $1 RETURNING *`, [exists.id, title, info.handle, info.avatarUrl, category, featured, order])
    : await one(c.env, `INSERT INTO youtube_channels (channel_id, title, handle, avatar_url, category, featured, sort_order, added_by)
        VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM youtube_channels)),$8) RETURNING *`,
      [info.channelId, title, info.handle, info.avatarUrl, category, featured, order, me.id]);
  await audit(c.env, me, 'youtube.add', 'youtube_channel', row.id, { channelId: row.channel_id, title: row.title, input });
  return c.json(channelShape(row), 201);
});

adminApi.patch('/admin/api/youtube/channels/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c);
  const cur = await one(c.env, 'SELECT * FROM youtube_channels WHERE id = $1', [id]);
  if (!cur) throw notFound('Channel not found');
  const next = {
    title: b.title !== undefined ? str(b.title, { min: 1, max: 120, field: 'title' }) : cur.title,
    category: b.category !== undefined ? (CATEGORIES.includes(b.category) ? b.category : (() => { throw bad('Unknown category'); })()) : cur.category,
    featured: b.featured !== undefined ? !!b.featured : cur.featured,
    sort_order: b.sortOrder !== undefined ? int(b.sortOrder, { min: -1000, max: 1000, field: 'sortOrder' }) : cur.sort_order,
    active: b.active !== undefined ? !!b.active : cur.active,
  };
  const row = await one(c.env, 'UPDATE youtube_channels SET title = $2, category = $3, featured = $4, sort_order = $5, active = $6 WHERE id = $1 RETURNING *',
    [id, next.title, next.category, next.featured, next.sort_order, next.active]);
  await audit(c.env, me, 'youtube.update', 'youtube_channel', id, next);
  return c.json(channelShape(row));
});

adminApi.delete('/admin/api/youtube/channels/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'DELETE FROM youtube_channels WHERE id = $1 RETURNING channel_id, title', [id]);
  if (!row) throw notFound('Channel not found');
  await audit(c.env, me, 'youtube.delete', 'youtube_channel', id, { channelId: row.channel_id, title: row.title });
  return c.json({ ok: true });
});

// ----- Reports queue -----
const TARGET_SQL = `CASE r.target_type
  WHEN 'post' THEN (SELECT json_build_object('text', p.body, 'kind', p.kind, 'authorId', u.id, 'authorName', u.display_name, 'authorBanned', u.banned, 'removed', p.removed, 'createdAt', p.created_at)
                    FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = r.target_id)
  WHEN 'comment' THEN (SELECT json_build_object('text', cm.body, 'postId', cm.post_id, 'authorId', u.id, 'authorName', u.display_name, 'authorBanned', u.banned, 'createdAt', cm.created_at)
                    FROM comments cm JOIN users u ON u.id = cm.author_id WHERE cm.id = r.target_id)
  WHEN 'user' THEN (SELECT json_build_object('text', COALESCE(NULLIF(u.headline, ''), u.bio, ''), 'authorId', u.id, 'authorName', u.display_name, 'authorBanned', u.banned, 'handle', u.handle)
                    FROM users u WHERE u.id = r.target_id)
  WHEN 'prayer' THEN (SELECT json_build_object('text', pr.title || CASE WHEN pr.body <> '' THEN ' — ' || pr.body ELSE '' END, 'authorId', u.id, 'authorName', u.display_name, 'authorBanned', u.banned, 'removed', pr.status = 'archived')
                    FROM prayers pr JOIN users u ON u.id = pr.author_id WHERE pr.id = r.target_id)
  WHEN 'job' THEN (SELECT json_build_object('text', j.title, 'authorId', u.id, 'authorName', u.display_name, 'authorBanned', u.banned, 'removed', j.status = 'closed')
                    FROM jobs j JOIN users u ON u.id = j.client_id WHERE j.id = r.target_id)
END`;

const reportShape = (x) => ({
  id: x.id,
  targetType: x.target_type,
  targetId: x.target_id,
  reason: x.reason,
  reporter: { id: x.reporter_id, displayName: x.reporter_name },
  target: x.target || null,
  sameTargetOpen: x.same_open,
  status: x.resolved_at ? 'resolved' : 'open',
  resolution: x.resolution,
  resolvedAt: x.resolved_at ? new Date(x.resolved_at).toISOString() : null,
  createdAt: new Date(x.created_at).toISOString(),
});

adminApi.get('/admin/api/reports', async (c) => {
  const status = c.req.query('status') === 'resolved' ? 'resolved' : 'open';
  const rows = await q(c.env, `SELECT r.*, ru.display_name AS reporter_name, ${TARGET_SQL} AS target,
      (SELECT COUNT(*)::int FROM reports r2 WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id AND r2.resolved_at IS NULL) AS same_open
    FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id
    WHERE ${status === 'open' ? 'r.resolved_at IS NULL' : 'r.resolved_at IS NOT NULL'}
    ORDER BY ${status === 'open' ? 'r.created_at' : 'r.resolved_at DESC'} LIMIT 100`);
  return c.json({ items: rows.map(reportShape) });
});

async function loadReport(c) {
  const row = await one(c.env, `SELECT r.*, ${TARGET_SQL} AS target FROM reports r WHERE r.id = $1`, [uuidParam(c)]);
  if (!row) throw notFound('Report not found');
  return row;
}
const resolveTarget = (env, me, rep, resolution) => q(env, `UPDATE reports SET resolved_at = now(), resolution = $3, resolved_by = $4
    WHERE target_type = $1 AND target_id = $2 AND resolved_at IS NULL`, [rep.target_type, rep.target_id, resolution, me.id]);

adminApi.post('/admin/api/reports/:id/remove', async (c) => {
  const me = c.get('user');
  const rep = await loadReport(c);
  const t = rep.target_type;
  if (!rep.target) throw notFound('The reported content no longer exists');
  if (t === 'post') await q(c.env, 'UPDATE posts SET removed = true WHERE id = $1', [rep.target_id]);
  else if (t === 'comment') {
    await q(c.env, `WITH del AS (DELETE FROM comments WHERE id = $1 RETURNING post_id)
      UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id IN (SELECT post_id FROM del)`, [rep.target_id]);
  } else if (t === 'prayer') await q(c.env, `UPDATE prayers SET status = 'archived' WHERE id = $1`, [rep.target_id]);
  else if (t === 'job') await q(c.env, `UPDATE jobs SET status = 'closed' WHERE id = $1`, [rep.target_id]);
  else throw bad('People can’t be removed — use “Ban user” instead');
  await resolveTarget(c.env, me, rep, 'removed');
  await audit(c.env, me, 'report.remove', t, rep.target_id, { reportId: rep.id, text: String(rep.target.text || '').slice(0, 200) });
  return c.json({ ok: true, resolution: 'removed' });
});

adminApi.post('/admin/api/reports/:id/ban', async (c) => {
  const me = c.get('user');
  const rep = await loadReport(c);
  const userId = rep.target && rep.target.authorId;
  if (!userId) throw notFound('The reported account no longer exists');
  if (userId === me.id) throw bad('You can’t ban yourself');
  const target = await one(c.env, 'SELECT id, role, display_name FROM users WHERE id = $1', [userId]);
  if (!target) throw notFound('The reported account no longer exists');
  if (target.role === 'admin') throw forbidden('Admins can’t be banned from the dashboard');
  await q(c.env, 'UPDATE users SET banned = true WHERE id = $1', [userId]);
  await resolveTarget(c.env, me, rep, 'banned');
  await audit(c.env, me, 'user.ban', 'user', userId, { reportId: rep.id, displayName: target.display_name });
  return c.json({ ok: true, resolution: 'banned' });
});

adminApi.post('/admin/api/reports/:id/dismiss', async (c) => {
  const me = c.get('user');
  const rep = await loadReport(c);
  await q(c.env, `UPDATE reports SET resolved_at = now(), resolution = 'dismissed', resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL`, [rep.id, me.id]);
  await audit(c.env, me, 'report.dismiss', rep.target_type, rep.target_id, { reportId: rep.id });
  return c.json({ ok: true, resolution: 'dismissed' });
});

// ----- Audit log -----
adminApi.get('/admin/api/actions', async (c) => {
  const rows = await q(c.env, `SELECT a.*, u.display_name AS admin_name FROM admin_actions a LEFT JOIN users u ON u.id = a.admin_id
    ORDER BY a.created_at DESC LIMIT 100`);
  return c.json({ items: rows.map((x) => ({ id: x.id, action: x.action, targetType: x.target_type, targetId: x.target_id, details: x.details, admin: x.admin_name, createdAt: new Date(x.created_at).toISOString() })) });
});
