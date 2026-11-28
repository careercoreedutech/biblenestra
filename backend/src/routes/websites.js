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

// ============================================================================
// WEBSITE INTEGRATION (brief 19 / 19.1 / 20): connect a site, import its articles, publish to WordPress,
// approve, retry, read in the app with labelled ad cards between sections. Logic: ../lib/websiteSync.js
// ============================================================================
//   GET    /website-integrations                 my connections, alerts, settings
//   POST   /website-integrations                 connect {siteUrl, kind:'rss'|'wordpress', feedUrl?, username?, appPassword?, autoImport?, autoPost?, importRequiresApproval?}
//   PATCH  /website-integrations/:id             {autoImport?, autoPost?, importRequiresApproval?, paused?, username?, appPassword?}
//   DELETE /website-integrations/:id
//   POST   /website-integrations/:id/sync        import now
//   GET    /website-integrations/:id/history     imports and publications with their status
//   POST   /website-articles                     new in-app article {connectionId, title, body, excerpt?} (draft)
//   PATCH  /website-articles/:id                 edit a draft or failed article
//   POST   /website-articles/:id/submit          draft/failed → pending approval (or approved)
//   POST   /website-articles/:id/approve         pending → approved (owner if the setting allows, or an administrator)
//   POST   /website-articles/:id/publish         approved/failed → publish to the WordPress site (also the retry)
//   POST   /website-articles/:id/hide            hide from the feed (owner or administrator)
//   GET    /website-articles/:id                one article to read (owner, administrator, or visible in the feed)
//   GET    /website-feed?cursor=                the Website feed: approved imports and published articles
import { connectionShape, syncConnection, recordSyncFailure, detectWordPress, verifyWordPressLogin, publishToWordPress, fetchFeedItems, interleaveAds, bodyParagraphs, ARTICLE_STATUS_LABEL, MAX_CONNECTIONS } from '../lib/websiteSync.js';
import { encryptField } from '../lib/fundmeMoney.js';
import { getConfig, setConfig } from '../lib/wallet.js';

const WEBSITE_BODY_MAX = 30000;

// who may connect sites and write for them: 'admins' (default), 'verified' (verified members) or 'members' (everyone)
async function canIntegrate(env, me) {
  if (me.role === 'admin') return true;
  const cfg = await getConfig(env);
  if (cfg.website_integration_access === 'members') return true;
  return cfg.website_integration_access === 'verified' && !!me.verified;
}
const isAdminUser = (me) => me.role === 'admin';

async function ownConnection(c) {
  const row = await one(c.env, 'SELECT * FROM website_connections WHERE id = $1', [uuidParam(c)]);
  if (!row) throw notFound('Website connection not found');
  if (row.owner_id !== c.get('user').id && !isAdminUser(c.get('user'))) throw forbidden('This connection belongs to someone else');
  return row;
}

const articleShape = (r) => ({
  id: r.id,
  connectionId: r.connection_id,
  direction: r.direction,
  status: r.status,
  statusLabel: ARTICLE_STATUS_LABEL[r.status] || r.status,
  title: r.title,
  excerpt: r.excerpt || '',
  image: r.image_url || null,
  host: r.host || null,
  siteUrl: r.site_url || null,
  sourceUrl: r.source_url || null,
  externalUrl: r.external_url || null,
  error: r.error || null,
  attempts: r.attempts || 0,
  publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  mine: !!(r.me_id && r.owner_id === r.me_id),
});

const ARTICLE_SELECT = 'SELECT a.*, c.host, c.site_url, c.kind, c.wp_password_enc, c.wp_username, c.auto_publish FROM website_articles a JOIN website_connections c ON c.id = a.connection_id';

async function loadArticle(c, id) {
  const row = await one(c.env, `${ARTICLE_SELECT} WHERE a.id = $1`, [id]);
  if (!row) throw notFound('Article not found');
  return row;
}
const articleAccess = (row, me) => row.owner_id === me.id || isAdminUser(me);
const visibleInFeed = (row) => (row.direction === 'import' && row.status === 'approved') || row.status === 'published';

// ---------- connections ----------
websites.get('/website-integrations', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, 'SELECT * FROM website_connections WHERE owner_id = $1 ORDER BY created_at DESC', [me.id]);
  const cfg = await getConfig(c.env);
  return c.json({
    items: rows.map(connectionShape),
    max: MAX_CONNECTIONS,
    access: await canIntegrate(c.env, me),
    publishRequiresApproval: !!cfg.website_publish_requires_approval,
    ownerCanApprove: !!cfg.website_owner_can_approve,
    alerts: rows.filter((r) => r.status === 'error').map((r) => ({ connectionId: r.id, host: r.host, message: r.last_error || 'The last sync failed' })),
  });
});

websites.post('/website-integrations', async (c) => {
  const me = c.get('user');
  if (!(await canIntegrate(c.env, me))) throw forbidden('Connecting websites is for administrators for now', 'ADMIN_ONLY');
  const b = await body(c);
  const kind = b.kind === 'wordpress' ? 'wordpress' : b.kind === 'rss' ? 'rss' : null;
  if (!kind) throw bad('Choose RSS / Atom feed or WordPress', 'BAD_KIND');
  const { url: siteUrl, host } = normalizeWebsiteUrl(b.siteUrl);
  const count = await one(c.env, 'SELECT count(*)::int AS n FROM website_connections WHERE owner_id = $1', [me.id]);
  if (count && count.n >= MAX_CONNECTIONS) throw bad(`You can connect up to ${MAX_CONNECTIONS} websites`, 'TOO_MANY');
  const dupe = await one(c.env, 'SELECT id FROM website_connections WHERE owner_id = $1 AND host = $2', [me.id, host]);
  if (dupe) throw new ApiError(409, 'ALREADY_CONNECTED', 'This website is already connected');
  let feedUrl = null;
  let wpUser = null;
  let wpEnc = null;
  if (kind === 'rss') {
    feedUrl = normalizeWebsiteUrl(b.feedUrl || siteUrl).url;
    try { await fetchFeedItems(c.env, feedUrl); } catch (e) { throw bad(e.message, 'BAD_FEED'); }
  } else {
    if (!(await detectWordPress(c.env, siteUrl))) throw bad('This website doesn’t have the WordPress REST API switched on. Use its RSS feed instead.', 'NOT_WORDPRESS');
    wpUser = str(b.username, { max: 120, optional: true, field: 'User name' }) || null;
    const appPassword = str(b.appPassword, { max: 200, optional: true, field: 'Application password' }) || null;
    if (appPassword && !wpUser) throw bad('Enter the WordPress user name the application password belongs to', 'BAD_CREDENTIALS');
    if (wpUser && !appPassword) throw bad('Paste the application password from WordPress (Users, Profile, Application Passwords)', 'BAD_CREDENTIALS');
    if (wpUser && appPassword) {
      await verifyWordPressLogin(c.env, siteUrl, wpUser, appPassword);
      wpEnc = await encryptField(c.env, appPassword);
    }
  }
  const row = await one(c.env, `INSERT INTO website_connections (owner_id, site_url, host, kind, feed_url, wp_username, wp_password_enc, auto_import, auto_publish, import_requires_approval)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [me.id, siteUrl, host, kind, feedUrl, wpUser, wpEnc, b.autoImport !== false, b.autoPost === true, b.importRequiresApproval !== false]);
  let sync = null;
  try { sync = await syncConnection(c.env, row); } catch (e) { sync = { error: await recordSyncFailure(c.env, row, e) }; }
  const fresh = await one(c.env, 'SELECT * FROM website_connections WHERE id = $1', [row.id]);
  return c.json({ connection: connectionShape(fresh), sync }, 201);
});

websites.patch('/website-integrations/:id', async (c) => {
  const row = await ownConnection(c);
  const b = await body(c);
  const autoImport = b.autoImport === undefined ? row.auto_import : !!b.autoImport;
  const autoPost = b.autoPost === undefined ? row.auto_publish : !!b.autoPost;
  const approval = b.importRequiresApproval === undefined ? row.import_requires_approval : !!b.importRequiresApproval;
  let status = row.status === 'paused' ? 'connected' : row.status;
  if (b.paused === true) status = 'paused';
  let wpUser = row.wp_username;
  let wpEnc = row.wp_password_enc;
  if (b.username !== undefined || b.appPassword !== undefined) {
    if (row.kind !== 'wordpress') throw bad('Only WordPress connections use a user name and application password', 'NOT_WORDPRESS');
    wpUser = str(b.username, { max: 120, optional: true, field: 'User name' }) || wpUser;
    const appPassword = str(b.appPassword, { max: 200, optional: true, field: 'Application password' }) || null;
    if (appPassword) {
      if (!wpUser) throw bad('Enter the WordPress user name', 'BAD_CREDENTIALS');
      await verifyWordPressLogin(c.env, row.site_url, wpUser, appPassword);
      wpEnc = await encryptField(c.env, appPassword);
    }
  }
  const next = await one(c.env, `UPDATE website_connections SET auto_import = $2, auto_publish = $3, import_requires_approval = $4, status = $5,
      wp_username = $6, wp_password_enc = $7, updated_at = now() WHERE id = $1 RETURNING *`,
  [row.id, autoImport, autoPost, approval, status, wpUser, wpEnc]);
  return c.json(connectionShape(next));
});

websites.delete('/website-integrations/:id', async (c) => {
  const row = await ownConnection(c);
  await q(c.env, 'DELETE FROM website_connections WHERE id = $1', [row.id]);
  return c.json({ ok: true });
});

websites.post('/website-integrations/:id/sync', async (c) => {
  const row = await ownConnection(c);
  try {
    const result = await syncConnection(c.env, row);
    const fresh = await one(c.env, 'SELECT * FROM website_connections WHERE id = $1', [row.id]);
    return c.json({ ok: true, ...result, connection: connectionShape(fresh) });
  } catch (e) {
    const message = await recordSyncFailure(c.env, row, e);
    throw new ApiError(502, 'SYNC_FAILED', message);
  }
});

websites.get('/website-integrations/:id/history', async (c) => {
  const row = await ownConnection(c);
  const rows = await q(c.env, `${ARTICLE_SELECT} WHERE a.connection_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [row.id]);
  return c.json({ items: rows.map((r) => articleShape({ ...r, me_id: c.get('user').id })) });
});

// ---------- in-app articles (publish direction) ----------
websites.post('/website-articles', async (c) => {
  const me = c.get('user');
  if (!(await canIntegrate(c.env, me))) throw forbidden('Writing for websites is for administrators for now', 'ADMIN_ONLY');
  const b = await body(c);
  const conn = await one(c.env, 'SELECT * FROM website_connections WHERE id = $1', [str(b.connectionId, { max: 40, field: 'connectionId' })]);
  if (!conn || (conn.owner_id !== me.id && !isAdminUser(me))) throw notFound('Website connection not found');
  const title = str(b.title, { min: 1, max: 200, field: 'Title' });
  const text = str(b.body, { min: 1, max: WEBSITE_BODY_MAX, field: 'Article' });
  const excerpt = str(b.excerpt, { max: 300, optional: true, field: 'Summary' }) || null;
  const row = await one(c.env, `INSERT INTO website_articles (connection_id, owner_id, direction, status, title, excerpt, body)
    VALUES ($1,$2,'publish','draft',$3,$4,$5) RETURNING id`, [conn.id, me.id, title, excerpt, text]);
  const full = await loadArticle(c, row.id);
  return c.json(articleShape({ ...full, me_id: me.id }), 201);
});

websites.patch('/website-articles/:id', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  if (!articleAccess(row, me)) throw forbidden('This article belongs to someone else');
  if (row.direction !== 'publish' || !['draft', 'failed'].includes(row.status)) throw bad('Only drafts and failed articles can be edited', 'NOT_EDITABLE');
  const b = await body(c);
  const title = b.title === undefined ? row.title : str(b.title, { min: 1, max: 200, field: 'Title' });
  const text = b.body === undefined ? row.body : str(b.body, { min: 1, max: WEBSITE_BODY_MAX, field: 'Article' });
  const excerpt = b.excerpt === undefined ? row.excerpt : (str(b.excerpt, { max: 300, optional: true, field: 'Summary' }) || null);
  await q(c.env, 'UPDATE website_articles SET title = $2, body = $3, excerpt = $4, updated_at = now() WHERE id = $1', [row.id, title, text, excerpt]);
  return c.json(articleShape({ ...(await loadArticle(c, row.id)), me_id: me.id }));
});

websites.post('/website-articles/:id/submit', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  if (!articleAccess(row, me)) throw forbidden('This article belongs to someone else');
  if (row.direction !== 'publish' || !['draft', 'failed'].includes(row.status)) throw bad('Only drafts can be submitted', 'NOT_SUBMITTABLE');
  const cfg = await getConfig(c.env);
  const next = cfg.website_publish_requires_approval ? 'pending' : 'approved';
  await q(c.env, 'UPDATE website_articles SET status = $2, error = NULL, updated_at = now() WHERE id = $1', [row.id, next]);
  if (next === 'approved' && row.auto_publish) return publishNow(c, row.id, me);
  return c.json(articleShape({ ...(await loadArticle(c, row.id)), me_id: me.id }));
});

websites.post('/website-articles/:id/approve', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  const cfg = await getConfig(c.env);
  const allowed = isAdminUser(me) || (row.owner_id === me.id && !!cfg.website_owner_can_approve);
  if (!allowed) throw forbidden('Only an administrator can approve this article');
  if (row.status !== 'pending') throw bad('Only articles waiting for approval can be approved', 'NOT_PENDING');
  await q(c.env, `UPDATE website_articles SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`, [row.id, me.id]);
  if (row.direction === 'publish' && row.auto_publish) return publishNow(c, row.id, me);
  return c.json(articleShape({ ...(await loadArticle(c, row.id)), me_id: me.id }));
});

async function publishNow(c, id, me) {
  const row = await loadArticle(c, id);
  if (row.direction !== 'publish' || !['approved', 'failed'].includes(row.status)) throw bad('Only approved articles can be published', 'NOT_PUBLISHABLE');
  if (row.kind !== 'wordpress') throw bad('Publishing works with WordPress websites. RSS sites are import-only.', 'NOT_SUPPORTED');
  await q(c.env, `UPDATE website_articles SET status = 'publishing', attempts = attempts + 1, error = NULL, updated_at = now() WHERE id = $1`, [id]);
  try {
    const out = await publishToWordPress(c.env, row, row);
    await q(c.env, `UPDATE website_articles SET status = 'published', external_id = $2, external_url = $3, published_at = now(), error = NULL, updated_at = now() WHERE id = $1`,
      [id, out.externalId, out.externalUrl]);
  } catch (e) {
    await q(c.env, `UPDATE website_articles SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [id, String((e && e.message) || 'Publishing failed').slice(0, 300)]);
  }
  return c.json(articleShape({ ...(await loadArticle(c, id)), me_id: me.id }));
}

websites.post('/website-articles/:id/publish', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  if (!articleAccess(row, me)) throw forbidden('This article belongs to someone else');
  return publishNow(c, row.id, me);
});

websites.post('/website-articles/:id/hide', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  if (!articleAccess(row, me)) throw forbidden('This article belongs to someone else');
  await q(c.env, `UPDATE website_articles SET status = 'hidden', updated_at = now() WHERE id = $1`, [row.id]);
  return c.json({ ok: true });
});

// ---------- reading and the Website feed ----------
websites.get('/website-articles/:id', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  if (!articleAccess(row, me) && !visibleInFeed(row)) throw notFound('Article not found');
  const cfg = await getConfig(c.env);
  const ads = { every: Number(cfg.website_ad_every_paragraphs) || 3, max: Number(cfg.website_ad_max_per_article) || 0 };
  return c.json({ ...articleShape({ ...row, me_id: me.id }), body: row.body, blocks: interleaveAds(bodyParagraphs(row.body), ads), ads });
});

websites.get('/website-feed', async (c) => {
  const params = [];
  let where = "((a.direction = 'import' AND a.status = 'approved') OR a.status = 'published') AND NOT u.banned AND c.status <> 'paused'";
  const cur = c.req.query('cursor');
  if (cur) {
    let ts; let id;
    try { [ts, id] = atob(cur).split('|'); } catch (e) { /* ignore */ }
    if (ts && !Number.isNaN(Date.parse(ts)) && /^[0-9a-f-]{36}$/i.test(id || '')) {
      params.push(ts, id);
      where += ' AND (a.created_at, a.id) < ($1::timestamptz, $2::uuid)';
    }
  }
  const rows = await q(c.env, `${ARTICLE_SELECT} JOIN users u ON u.id = c.owner_id WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT 31`, params);
  const page = rows.slice(0, 30);
  const last = page[page.length - 1];
  return c.json({
    items: page.map((r) => articleShape({ ...r, me_id: c.get('user').id })),
    cursor: rows.length > 30 && last ? btoa(`${new Date(last.created_at).toISOString()}|${last.id}`) : null,
  });
});

// ============================================================================
// ADMIN: WEBSITE INTEGRATION DASHBOARD (brief 19.1 / 20). Shown in the Member websites tab of /admin.
// Mapped to the Moderation staff area (lib/staff.js). Every write is audited.
//   GET    /admin/api/website-integrations                 all connections, status, last sync, alerts, settings
//   POST   /admin/api/website-integrations/:id/sync        sync a connection now
//   PUT    /admin/api/website-integrations/settings        {integrationAccess?, publishRequiresApproval?, ownerCanApprove?, syncMinutes?}
//   GET    /admin/api/website-articles?direction=import|publish&status=a,b   the approval and publish queues
//   POST   /admin/api/website-articles/:id/approve         pending → approved (publishes at once when auto-post is on)
//   POST   /admin/api/website-articles/:id/hide            hide an article from the feed
//   POST   /admin/api/website-articles/:id/publish         publish now, or retry a failed publication
// ============================================================================
adminWebsites.use('/admin/api/website-integrations', requireAdmin);
adminWebsites.use('/admin/api/website-integrations/*', requireAdmin);
adminWebsites.use('/admin/api/website-articles', requireAdmin);
adminWebsites.use('/admin/api/website-articles/*', requireAdmin);

const WEBSITE_SETTING_FIELDS = {
  integrationAccess: 'website_integration_access',
  publishRequiresApproval: 'website_publish_requires_approval',
  ownerCanApprove: 'website_owner_can_approve',
  syncMinutes: 'website_sync_minutes',
};
const ARTICLE_QUEUE_STATUSES = ['draft', 'pending', 'approved', 'publishing', 'published', 'failed', 'hidden'];

const websiteSettings = (cfg) => ({
  integrationAccess: cfg.website_integration_access || 'admins',
  publishRequiresApproval: !!cfg.website_publish_requires_approval,
  ownerCanApprove: !!cfg.website_owner_can_approve,
  syncMinutes: Number(cfg.website_sync_minutes) || 30,
  maxConnections: MAX_CONNECTIONS,
});

adminWebsites.get('/admin/api/website-integrations', async (c) => {
  const rows = await q(c.env, `SELECT c.*, u.display_name AS owner_name, u.handle AS owner_handle,
      (SELECT count(*)::int FROM website_articles a WHERE a.connection_id = c.id AND a.direction = 'import' AND a.status = 'pending') AS pending_imports,
      (SELECT count(*)::int FROM website_articles a WHERE a.connection_id = c.id AND a.direction = 'publish' AND a.status IN ('pending','approved','failed','publishing')) AS open_publishes
    FROM website_connections c JOIN users u ON u.id = c.owner_id
    ORDER BY (c.status = 'error') DESC, c.last_synced_at NULLS FIRST, c.created_at DESC LIMIT 300`);
  const cfg = await getConfig(c.env);
  return c.json({
    items: rows.map((r) => ({
      ...connectionShape(r),
      owner: { id: r.owner_id, displayName: r.owner_name, handle: r.owner_handle || null },
      pendingImports: r.pending_imports,
      openPublishes: r.open_publishes,
    })),
    alerts: rows.filter((r) => r.status === 'error').map((r) => ({
      connectionId: r.id, host: r.host, owner: r.owner_name, message: r.last_error || 'The last sync failed',
      at: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
    })),
    settings: websiteSettings(cfg),
  });
});

adminWebsites.post('/admin/api/website-integrations/:id/sync', async (c) => {
  const me = c.get('user');
  const row = await one(c.env, 'SELECT * FROM website_connections WHERE id = $1', [uuidParam(c)]);
  if (!row) throw notFound('Website connection not found');
  await audit(c.env, me, 'website.sync', 'website_connection', row.id, { host: row.host });
  try {
    const result = await syncConnection(c.env, row);
    return c.json({ ok: true, ...result });
  } catch (e) {
    const message = await recordSyncFailure(c.env, row, e);
    throw new ApiError(502, 'SYNC_FAILED', message);
  }
});

adminWebsites.put('/admin/api/website-integrations/settings', async (c) => {
  const me = c.get('user');
  const b = (await c.req.json().catch(() => ({}))) || {};
  const changed = {};
  for (const [field, key] of Object.entries(WEBSITE_SETTING_FIELDS)) {
    if (b[field] === undefined) continue;
    const value = field === 'syncMinutes' ? Number(b[field]) : b[field];
    await setConfig(c.env, key, value, me.id); // validated by registerConfig (lib/websiteSync.js)
    changed[key] = value;
  }
  if (Object.keys(changed).length) await audit(c.env, me, 'website.settings', 'website_settings', null, changed);
  return c.json({ ok: true, settings: websiteSettings(await getConfig(c.env)) });
});

adminWebsites.get('/admin/api/website-articles', async (c) => {
  const me = c.get('user');
  const direction = c.req.query('direction') === 'publish' ? 'publish' : 'import';
  const statuses = String(c.req.query('status') || 'pending').split(',').map((s) => s.trim()).filter(Boolean);
  if (!statuses.length || statuses.some((s) => !ARTICLE_QUEUE_STATUSES.includes(s))) throw bad('Unknown status');
  const rows = await q(c.env, `SELECT a.*, c.host, c.site_url, c.kind, c.wp_password_enc, c.wp_username, c.auto_publish, u.display_name AS owner_name
    FROM website_articles a JOIN website_connections c ON c.id = a.connection_id JOIN users u ON u.id = a.owner_id
    WHERE a.direction = $1 AND a.status = ANY($2::text[]) ORDER BY a.updated_at DESC LIMIT 200`, [direction, statuses]);
  return c.json({ items: rows.map((r) => ({ ...articleShape({ ...r, me_id: me.id }), owner: r.owner_name })) });
});

adminWebsites.post('/admin/api/website-articles/:id/approve', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  if (row.status !== 'pending') throw bad('Only articles waiting for approval can be approved', 'NOT_PENDING');
  await q(c.env, `UPDATE website_articles SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`, [row.id, me.id]);
  await audit(c.env, me, 'website.article.approve', 'website_article', row.id, { direction: row.direction, host: row.host });
  if (row.direction === 'publish' && row.auto_publish) return publishNow(c, row.id, me);
  return c.json(articleShape({ ...(await loadArticle(c, row.id)), me_id: me.id }));
});

adminWebsites.post('/admin/api/website-articles/:id/hide', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  await q(c.env, `UPDATE website_articles SET status = 'hidden', updated_at = now() WHERE id = $1`, [row.id]);
  await audit(c.env, me, 'website.article.hide', 'website_article', row.id, { direction: row.direction, host: row.host });
  return c.json({ ok: true, status: 'hidden' });
});

adminWebsites.post('/admin/api/website-articles/:id/publish', async (c) => {
  const me = c.get('user');
  const row = await loadArticle(c, uuidParam(c));
  await audit(c.env, me, 'website.article.publish', 'website_article', row.id, { host: row.host, retry: row.status === 'failed' });
  return publishNow(c, row.id, me);
});
