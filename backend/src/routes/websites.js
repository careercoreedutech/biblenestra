// MEMBER WEBSITES: admins publish websites; approved ones open inside the app.
// Website Feed is ADMIN-ONLY for now (brief 11.2): non-admin POST / PATCH → 403 ADMIN_ONLY unless the flag
// website_feed.public_submission (Worker var WEBSITE_FEED_PUBLIC_SUBMISSION=true) is on; then members can
// submit again and their sites wait for admin approval.
//   POST   /websites                 admin: publish now; member (flag on): add, pending review {url, title?, description?, category?, owner: true}
//   POST   /admin/api/websites       admin dashboard: publish now  {url, title?, description?, category?}
//   GET    /websites                 approved websites (newest first, ?cursor=)
//   GET    /websites/mine            my websites with their review status
//   GET    /users/:id/websites       a member's approved websites (profile)
//   PATCH  /websites/:id             edit my website (a new address goes back to review)
//   DELETE /websites/:id             remove my website
//   POST   /websites/:id/open        count an open (for the owner and admins)
//   GET    /admin/api/websites?status=pending|approved|rejected|hidden
//   POST   /admin/api/websites/:id/approve | reject {reason?} | hide
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, notFound, str, uuidParam } from '../lib/http.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';
import { fetchSiteMeta, MAX_SITES_PER_USER, normalizeWebsiteUrl, WEBSITE_CATEGORIES, WEBSITES_ADMIN_SCRIPT, websitePublicSubmission } from '../lib/websites.js';

registerAdminScript(WEBSITES_ADMIN_SCRIPT);

const iso = (d) => (d ? new Date(d).toISOString() : null);
export const websiteShape = (r, me) => ({
  id: r.id,
  url: r.url,
  host: r.host,
  title: r.title,
  description: r.description || '',
  image: r.image_url || null,
  icon: r.icon_url || null,
  category: r.category || null,
  status: r.status,
  rejectReason: r.reject_reason || null,
  opens: r.opens || 0,
  mine: !!(me && r.owner_id === me.id),
  ownerType: r.owner_role === undefined ? undefined : r.owner_role === 'admin' ? 'admin' : 'user', // who published it
  owner: r.display_name !== undefined ? { id: r.owner_id, displayName: r.display_name, handle: r.handle || null, avatarUrl: r.avatar_url || null } : { id: r.owner_id },
  createdAt: iso(r.created_at),
  reviewedAt: iso(r.reviewed_at),
});

const SELECT = `SELECT w.*, u.display_name, u.handle, u.avatar_url, u.role AS owner_role FROM member_websites w JOIN users u ON u.id = w.owner_id`;
const category = (v) => {
  if (v == null || v === '') return null;
  const c = WEBSITE_CATEGORIES.find((x) => x.toLowerCase() === String(v).toLowerCase());
  if (!c) throw bad(`Category must be one of: ${WEBSITE_CATEGORIES.join(', ')}`, 'BAD_CATEGORY');
  return c;
};

async function notifyOwner(env, row, title, text) {
  try {
    await q(env, `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'website', $2, $3, $4::jsonb)`,
      [row.owner_id, title, text, JSON.stringify({ websiteId: row.id, url: row.url, route: 'Websites' })]);
  } catch (e) { /* best effort */ }
}

// ---------- members (signed in) ----------
export const websites = new Hono();

// Admins publish straight away (status 'approved', no per-account limit); members only while the
// website_feed.public_submission flag is on, and their sites wait for review.
async function adminAddWebsite(c, me, b) {
  const { url, host } = normalizeWebsiteUrl(b.url);
  const dupe = await one(c.env, `SELECT id FROM member_websites WHERE host = $1 AND status = 'approved'`, [host]);
  if (dupe) throw new ApiError(409, 'ALREADY_ADDED', 'This website is already published');
  const mineDupe = await one(c.env, 'SELECT id FROM member_websites WHERE owner_id = $1 AND host = $2', [me.id, host]);
  if (mineDupe) throw new ApiError(409, 'ALREADY_ADDED', 'You already added this website');
  const meta = await fetchSiteMeta(c.env, url);
  const title = str(b.title, { max: 120, optional: true, field: 'Name' }) || meta.title || host;
  const description = str(b.description, { max: 500, optional: true, field: 'Description' }) || meta.description || '';
  const row = await one(c.env, `INSERT INTO member_websites (owner_id, url, host, title, description, image_url, icon_url, category, status, reviewed_by, reviewed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved',$1,now()) RETURNING *`,
  [me.id, url, host, title.slice(0, 120), description.slice(0, 500), meta.image, meta.icon, category(b.category)]);
  await audit(c.env, me, 'website.add', 'member_website', row.id, { host });
  return c.json(websiteShape({ ...row, display_name: me.display_name, handle: me.handle, avatar_url: me.avatar_url, owner_role: me.role }, me), 201);
}

websites.post('/websites', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (me.role === 'admin') return adminAddWebsite(c, me, b);
  if (!websitePublicSubmission(c.env)) throw forbidden('Only administrators can add websites for now', 'ADMIN_ONLY');
  if (b.owner !== true) throw bad('Please confirm this is your own website', 'NOT_CONFIRMED');
  const { url, host } = normalizeWebsiteUrl(b.url);
  const count = await one(c.env, `SELECT count(*)::int AS n FROM member_websites WHERE owner_id = $1 AND status <> 'rejected'`, [me.id]);
  if (count && count.n >= MAX_SITES_PER_USER) throw bad(`You can add up to ${MAX_SITES_PER_USER} websites`, 'TOO_MANY');
  const dupe = await one(c.env, 'SELECT id FROM member_websites WHERE owner_id = $1 AND host = $2', [me.id, host]);
  if (dupe) throw new ApiError(409, 'ALREADY_ADDED', 'You already added this website');
  const meta = await fetchSiteMeta(c.env, url);
  const title = str(b.title, { max: 120, optional: true, field: 'Name' }) || meta.title || host;
  const description = str(b.description, { max: 500, optional: true, field: 'Description' }) || meta.description || '';
  const row = await one(c.env, `INSERT INTO member_websites (owner_id, url, host, title, description, image_url, icon_url, category)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [me.id, url, host, title.slice(0, 120), description.slice(0, 500), meta.image, meta.icon, category(b.category)]);
  return c.json(websiteShape({ ...row, display_name: me.display_name, handle: me.handle, avatar_url: me.avatar_url }, me), 201);
});

websites.get('/websites', async (c) => {
  const me = c.get('user');
  const params = [];
  let where = `w.status = 'approved' AND NOT u.banned`;
  const cur = c.req.query('cursor');
  if (cur) {
    let ts; let id;
    try { [ts, id] = atob(cur).split('|'); } catch (e) { /* ignore */ }
    if (ts && !Number.isNaN(Date.parse(ts)) && /^[0-9a-f-]{36}$/i.test(id || '')) {
      params.push(ts, id);
      where += ' AND (w.created_at, w.id) < ($1::timestamptz, $2::uuid)';
    }
  }
  const cat = c.req.query('category');
  if (cat) { params.push(category(cat)); where += ` AND w.category = $${params.length}`; }
  const rows = await q(c.env, `${SELECT} WHERE ${where} ORDER BY w.created_at DESC, w.id DESC LIMIT 31`, params);
  const page = rows.slice(0, 30);
  const last = page[page.length - 1];
  return c.json({
    items: page.map((r) => websiteShape(r, me)),
    categories: WEBSITE_CATEGORIES,
    cursor: rows.length > 30 && last ? btoa(`${new Date(last.created_at).toISOString()}|${last.id}`) : null,
  });
});

websites.get('/websites/mine', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `${SELECT} WHERE w.owner_id = $1 ORDER BY w.created_at DESC`, [me.id]);
  return c.json({ items: rows.map((r) => websiteShape(r, me)), max: MAX_SITES_PER_USER, categories: WEBSITE_CATEGORIES });
});

websites.get('/users/:id/websites', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const rows = await q(c.env, `${SELECT} WHERE w.owner_id = $1 AND w.status = 'approved' AND NOT u.banned ORDER BY w.created_at DESC`, [id]);
  return c.json({ items: rows.map((r) => websiteShape(r, me)) });
});

websites.patch('/websites/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'SELECT * FROM member_websites WHERE id = $1', [id]);
  if (!row) throw notFound('Website not found');
  const isAdmin = me.role === 'admin';
  if (!isAdmin && !websitePublicSubmission(c.env)) throw forbidden('Only administrators can edit websites for now', 'ADMIN_ONLY');
  if (!isAdmin && row.owner_id !== me.id) throw forbidden('You can only change your own website');
  const b = await body(c);
  let { url, host } = row;
  let reReview = false;
  let moved = false;
  if (b.url !== undefined && b.url !== row.url) {
    ({ url, host } = normalizeWebsiteUrl(b.url));
    moved = host !== row.host || url !== row.url;
    if (moved && !isAdmin) reReview = true; // an admin's edit stays live
    if (host !== row.host && await one(c.env, 'SELECT id FROM member_websites WHERE owner_id = $1 AND host = $2 AND id <> $3', [row.owner_id, host, id])) {
      throw new ApiError(409, 'ALREADY_ADDED', 'You already added this website');
    }
  }
  const title = b.title !== undefined ? str(b.title, { min: 1, max: 120, field: 'Name' }) : row.title;
  const description = b.description !== undefined ? str(b.description, { max: 500, field: 'Description' }) : row.description;
  const cat = b.category !== undefined ? category(b.category) : row.category;
  let image = row.image_url; let icon = row.icon_url;
  if (moved) { const meta = await fetchSiteMeta(c.env, url); image = meta.image; icon = meta.icon; }
  const next = await one(c.env, `UPDATE member_websites SET url = $2, host = $3, title = $4, description = $5, category = $6, image_url = $7, icon_url = $8,
      status = CASE WHEN $9 THEN 'pending' ELSE status END, reject_reason = CASE WHEN $9 THEN NULL ELSE reject_reason END, updated_at = now()
    WHERE id = $1 RETURNING *`, [id, url, host, title, description, cat, image, icon, reReview]);
  if (isAdmin && row.owner_id !== me.id) await audit(c.env, me, 'website.edit', 'member_website', id, { host });
  const full = await one(c.env, `${SELECT} WHERE w.id = $1`, [next.id]);
  return c.json(websiteShape(full || next, me));
});

websites.delete('/websites/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, 'SELECT owner_id FROM member_websites WHERE id = $1', [id]);
  if (!row) throw notFound('Website not found');
  if (row.owner_id !== me.id && me.role !== 'admin') throw forbidden('You can only remove your own website');
  await q(c.env, 'DELETE FROM member_websites WHERE id = $1', [id]);
  return c.json({ ok: true });
});

websites.post('/websites/:id/open', async (c) => {
  const id = uuidParam(c);
  await q(c.env, `UPDATE member_websites SET opens = opens + 1 WHERE id = $1 AND status = 'approved'`, [id]);
  return c.json({ ok: true });
});

// ---------- admin ----------
export const adminWebsites = new Hono();
adminWebsites.use('/admin/api/websites', requireAdmin); // GET list + POST add
adminWebsites.use('/admin/api/websites/*', requireAdmin);

adminWebsites.get('/admin/api/websites', async (c) => {
  const me = c.get('user');
  const status = String(c.req.query('status') || 'pending');
  if (!['pending', 'approved', 'rejected', 'hidden'].includes(status)) throw bad('Unknown status');
  const rows = await q(c.env, `${SELECT} WHERE w.status = $1 ORDER BY ${status === 'pending' ? 'w.created_at ASC' : 'w.updated_at DESC'} LIMIT 200`, [status]);
  const counts = await q(c.env, 'SELECT status, count(*)::int AS n FROM member_websites GROUP BY status');
  return c.json({ items: rows.map((r) => websiteShape(r, me)), counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
});

// Admin dashboard "Add website": publishes immediately.
adminWebsites.post('/admin/api/websites', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  return adminAddWebsite(c, c.get('user'), b || {});
});

async function review(c, status, reason) {
  const me = c.get('user');
  const id = uuidParam(c);
  const row = await one(c.env, `UPDATE member_websites SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
    WHERE id = $1 RETURNING *`, [id, status, reason || null, me.id]);
  if (!row) throw notFound('Website not found');
  await audit(c.env, me, `website.${status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'hide'}`, 'member_website', id, { host: row.host, reason: reason || null });
  return row;
}

adminWebsites.post('/admin/api/websites/:id/approve', async (c) => {
  const row = await review(c, 'approved');
  await notifyOwner(c.env, row, 'Your website is live on Bible Nestra', `${row.title} was approved. Members can now open it inside the app.`);
  return c.json({ ok: true, status: row.status });
});

adminWebsites.post('/admin/api/websites/:id/reject', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const reason = str(b && b.reason, { max: 300, optional: true, field: 'Reason' });
  const row = await review(c, 'rejected', reason);
  await notifyOwner(c.env, row, 'Your website wasn’t approved', reason ? `${row.title}: ${reason}` : `${row.title} wasn’t approved for Bible Nestra.`);
  return c.json({ ok: true, status: row.status });
});

adminWebsites.post('/admin/api/websites/:id/hide', async (c) => {
  const row = await review(c, 'hidden');
  return c.json({ ok: true, status: row.status });
});
