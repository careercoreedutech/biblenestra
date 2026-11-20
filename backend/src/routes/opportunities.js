// OPPORTUNITIES: jobs, remote work, internships, scholarships, fellowships, grants, hackathons and
// competitions imported from outside sources (see src/lib/opportunities.js). Read-only for users;
// admins can switch a source off, run an import now, or hide a listing.
//   GET  /opportunities?kind=&q=&remote=1&cursor=&limit=   (signed in)
//   GET  /opportunities/summary                            (signed in)
//   GET  /opportunities/directory                          (signed in) JOBS FEEDS: the 63-platform Job & Academic Directory
//        list filters (JOBS FEEDS): &category=intl|africa|freelance|ai|academic|research|funding &open=africa|nigeria &source=<key>
//   GET  /admin/api/opportunity-sources                    (admin)
//   PATCH /admin/api/opportunity-sources/:key {enabled}    (admin)
//   POST /admin/api/opportunity-sources/:key/run           (admin)
//   POST /admin/api/opportunities/:id/hide {hidden}        (admin)
//   GET/POST /admin/api/opportunity-directory, PUT/DELETE /admin/api/opportunity-directory/:slug  (admin) JOBS FEEDS
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { bad, body, notFound, isUuid } from '../lib/http.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import { KINDS, KIND_LABELS, SOURCES, sourceByKey, importSource, activeSourceKeys, sourcesInCategory, sourceActive } from '../lib/opportunities.js';
import { CATEGORIES, CATEGORY_IDS, DIRECTORY, ACCESS } from '../lib/jobsDirectory.js'; // JOBS FEEDS
import { OPPS_ADMIN_SCRIPT } from '../lib/opportunitiesAdminPage.js';

registerAdminScript(OPPS_ADMIN_SCRIPT); // JOBS FEEDS: "Opportunities" dashboard tab (sources + directory editor)

export const opportunities = new Hono();
export const adminOpportunities = new Hono();
adminOpportunities.use('/admin/api/opportunity-sources', requireAdmin);
adminOpportunities.use('/admin/api/opportunity-sources/*', requireAdmin);
adminOpportunities.use('/admin/api/opportunities/*', requireAdmin);
adminOpportunities.use('/admin/api/opportunity-directory', requireAdmin);
adminOpportunities.use('/admin/api/opportunity-directory/*', requireAdmin);

const SORT = 'COALESCE(o.posted_at, o.created_at)';
const cursorOf = (row) => btoa(`${new Date(row.sort_at).toISOString()}|${row.id}`);
function readCursor(s) {
  if (!s) return null;
  try {
    const [ts, id] = atob(String(s)).split('|');
    return isUuid(id) && !Number.isNaN(Date.parse(ts)) ? { ts, id } : null;
  } catch (e) { return null; }
}
const iso = (d) => (d ? new Date(d).toISOString() : null);

function shape(o) {
  const src = sourceByKey(o.source);
  return {
    id: o.id,
    kind: o.kind,
    title: o.title,
    org: o.org || null,
    location: o.location || null,
    remote: !!o.remote,
    url: o.url,
    excerpt: o.excerpt || '',
    tags: o.tags || [],
    deadline: iso(o.deadline),
    postedAt: iso(o.posted_at),
    salary: o.salary || null,
    source: src ? { key: src.key, name: src.name, url: src.site } : { key: o.source, name: o.source, url: o.url },
    category: (src && src.category) || null, // JOBS FEEDS
    openTo: o.open_to || null, // JOBS FEEDS: 'nigeria' | 'africa' | 'worldwide' | null
  };
}

// Only listings that are still open (deadline in the future or none) and from active sources. $1 = active keys:
// enabled, permission granted where the terms need it, key present for key-gated sources.
const OPEN = `NOT o.hidden AND (o.deadline IS NULL OR o.deadline > now()) AND o.source = ANY($1::text[])`;
const OPEN_TO_FILTER = { africa: ['nigeria', 'africa', 'worldwide'], nigeria: ['nigeria', 'worldwide'] };

opportunities.get('/opportunities', async (c) => {
  const kind = String(c.req.query('kind') || 'all').toLowerCase();
  if (kind !== 'all' && !KINDS.includes(kind)) throw bad(`kind must be one of: all, ${KINDS.join(', ')}`, 'BAD_KIND');
  const text = String(c.req.query('q') || '').trim().slice(0, 80);
  const remoteOnly = ['1', 'true', 'yes'].includes(String(c.req.query('remote') || '').toLowerCase());
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
  const cur = readCursor(c.req.query('cursor'));
  const category = String(c.req.query('category') || '').toLowerCase();
  if (category && category !== 'all' && !CATEGORY_IDS.includes(category)) throw bad(`category must be one of: all, ${CATEGORY_IDS.join(', ')}`, 'BAD_CATEGORY');
  const open = String(c.req.query('open') || '').toLowerCase();
  if (open && !OPEN_TO_FILTER[open]) throw bad('open must be africa or nigeria', 'BAD_OPEN');
  const source = String(c.req.query('source') || '').toLowerCase().slice(0, 40);

  const args = [await activeSourceKeys(c.env)];
  let where = OPEN;
  if (kind !== 'all') { args.push(kind); where += ` AND o.kind = $${args.length}`; }
  if (remoteOnly) where += ' AND o.remote';
  if (category && category !== 'all') { args.push(sourcesInCategory(category)); where += ` AND o.source = ANY($${args.length}::text[])`; }
  if (open) { args.push(OPEN_TO_FILTER[open]); where += ` AND o.open_to = ANY($${args.length}::text[])`; }
  if (source) { args.push(source); where += ` AND o.source = $${args.length}`; }
  if (text) {
    args.push(`%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const p = `$${args.length}`;
    where += ` AND (o.title ILIKE ${p} OR o.org ILIKE ${p} OR o.location ILIKE ${p} OR o.excerpt ILIKE ${p} OR array_to_string(o.tags, ' ') ILIKE ${p})`;
  }
  if (cur) {
    args.push(cur.ts, cur.id);
    where += ` AND (${SORT}, o.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`;
  }
  args.push(limit + 1);
  const rows = await q(c.env, `SELECT o.*, ${SORT} AS sort_at FROM opportunities o WHERE ${where}
    ORDER BY ${SORT} DESC, o.id DESC LIMIT $${args.length}`, args);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return c.json({ items: page.map(shape), cursor: more ? cursorOf(page[page.length - 1]) : null, hasMore: more });
});

opportunities.get('/opportunities/summary', async (c) => {
  const active = await activeSourceKeys(c.env);
  const counts = await q(c.env, `SELECT o.kind, o.source, count(*)::int AS n, count(*) FILTER (WHERE o.open_to IS NOT NULL)::int AS africa
    FROM opportunities o WHERE ${OPEN} GROUP BY o.kind, o.source`, [active]);
  const byKind = {}; const bySource = {}; let openToAfrica = 0;
  counts.forEach((r) => { byKind[r.kind] = (byKind[r.kind] || 0) + r.n; bySource[r.source] = (bySource[r.source] || 0) + r.n; openToAfrica += r.africa; });
  const state = await q(c.env, `SELECT key, last_ok_at FROM opportunity_sources WHERE key = ANY($1::text[])`, [active]);
  const last = state.map((s) => s.last_ok_at).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  const activeSet = new Set(active);
  return c.json({
    kinds: KINDS.map((k) => ({ kind: k, label: KIND_LABELS[k], count: byKind[k] || 0 })),
    // JOBS FEEDS: the 7 directory categories with live counts, and how many listings say they're open to Africans
    categories: CATEGORIES.map((g) => ({ id: g.id, label: g.label, short: g.short, count: sourcesInCategory(g.id).reduce((n, k) => n + (bySource[k] || 0), 0) })),
    openToAfrica,
    sources: SOURCES.filter((s) => activeSet.has(s.key)).map((s) => ({ key: s.key, name: s.name, url: s.site, kinds: s.kinds, category: s.category, count: bySource[s.key] || 0 })),
    updatedAt: iso(last),
  });
});

// ---------- JOBS FEEDS: the Job & Academic Directory (defaults in lib/jobsDirectory.js + admin edits) ----------
const DIR_DEFAULT_ORDER = Object.fromEntries(DIRECTORY.map((d, i) => [d.slug, (i + 1) * 10]));
/** Defaults merged with opportunity_directory rows (a row overrides the default with the same slug). */
export async function loadDirectory(env, { includeHidden = false } = {}) {
  const rows = await q(env, `SELECT * FROM opportunity_directory`);
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
  const list = DIRECTORY.map((d) => {
    const r = bySlug[d.slug];
    return r ? { ...d, category: r.category, name: r.name, url: r.url, description: r.description, hidden: r.hidden, sort: r.sort ?? DIR_DEFAULT_ORDER[d.slug], edited: true, custom: false }
      : { ...d, hidden: false, sort: DIR_DEFAULT_ORDER[d.slug], edited: false, custom: false };
  });
  rows.filter((r) => !DIR_DEFAULT_ORDER[r.slug]).forEach((r) => list.push({
    slug: r.slug, category: r.category, name: r.name, url: r.url, description: r.description, access: 'link', sources: [],
    hidden: r.hidden, sort: r.sort ?? 10000, edited: true, custom: true,
  }));
  return list.filter((d) => includeHidden || !d.hidden).sort((a, b) => a.sort - b.sort);
}

opportunities.get('/opportunities/directory', async (c) => {
  const [list, active] = await Promise.all([loadDirectory(c.env), activeSourceKeys(c.env)]);
  const activeSet = new Set(active);
  const counts = await q(c.env, `SELECT o.source, count(*)::int AS n FROM opportunities o WHERE ${OPEN} GROUP BY o.source`, [active]);
  const bySource = Object.fromEntries(counts.map((r) => [r.source, r.n]));
  const shapeEntry = (d) => {
    const live = (d.sources || []).filter((k) => activeSet.has(k));
    return {
      slug: d.slug, name: d.name, url: d.url, description: d.description,
      live: live.length > 0, // listings from this platform are in the app right now
      sourceKey: live[0] || null,
      listings: live.reduce((n, k) => n + (bySource[k] || 0), 0),
    };
  };
  c.header('Cache-Control', 'private, max-age=300');
  return c.json({
    categories: CATEGORIES.map((g) => ({ id: g.id, label: g.label, short: g.short, blurb: g.blurb, items: list.filter((d) => d.category === g.id).map(shapeEntry) })),
    total: list.length,
  });
});

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
function dirInput(b, prev = {}) {
  const pick = (k, max) => (b[k] === undefined ? prev[k] : String(b[k] || '').trim().slice(0, max));
  const out = {
    category: pick('category', 20), name: pick('name', 80), url: pick('url', 300), description: pick('description', 300),
    hidden: b.hidden === undefined ? !!prev.hidden : !!b.hidden,
    sort: b.sort === undefined ? (prev.sort ?? null) : (b.sort === null || b.sort === '' ? null : parseInt(b.sort, 10)),
  };
  if (!CATEGORY_IDS.includes(out.category)) throw bad(`category must be one of: ${CATEGORY_IDS.join(', ')}`, 'BAD_CATEGORY');
  if (!out.name) throw bad('name is required');
  if (!/^https:\/\/[^\s]+$/i.test(out.url || '')) throw bad('url must start with https://', 'BAD_URL');
  if (out.sort !== null && !Number.isFinite(out.sort)) throw bad('sort must be a number');
  return out;
}
async function saveDir(env, slug, d) {
  await q(env, `INSERT INTO opportunity_directory (slug, category, name, url, description, hidden, sort, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    ON CONFLICT (slug) DO UPDATE SET category = EXCLUDED.category, name = EXCLUDED.name, url = EXCLUDED.url,
      description = EXCLUDED.description, hidden = EXCLUDED.hidden, sort = EXCLUDED.sort, updated_at = now()`,
  [slug, d.category, d.name, d.url, d.description || '', d.hidden, d.sort]);
}

adminOpportunities.get('/admin/api/opportunity-directory', async (c) => {
  const list = await loadDirectory(c.env, { includeHidden: true });
  return c.json({ categories: CATEGORIES, access: ACCESS, items: list });
});

adminOpportunities.post('/admin/api/opportunity-directory', async (c) => {
  const b = await body(c);
  const slug = String(b.slug || b.name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!SLUG_RE.test(slug)) throw bad('Give the entry a name (letters or numbers)', 'BAD_SLUG');
  const exists = (await loadDirectory(c.env, { includeHidden: true })).some((d) => d.slug === slug);
  if (exists) throw bad('An entry with that name already exists', 'DUPLICATE');
  const d = dirInput(b);
  await saveDir(c.env, slug, d);
  await audit(c.env, c.get('user'), 'directory_add', 'opportunity_directory', slug, { name: d.name, url: d.url });
  return c.json({ slug, ...d }, 201);
});

adminOpportunities.put('/admin/api/opportunity-directory/:slug', async (c) => {
  const slug = c.req.param('slug');
  const prev = (await loadDirectory(c.env, { includeHidden: true })).find((d) => d.slug === slug);
  if (!prev) throw notFound('Unknown directory entry');
  const d = dirInput(await body(c), prev);
  await saveDir(c.env, slug, d);
  await audit(c.env, c.get('user'), 'directory_edit', 'opportunity_directory', slug, { name: d.name, url: d.url, hidden: d.hidden });
  return c.json({ slug, ...d });
});

// Built-in entry → back to its default; added entry → removed
adminOpportunities.delete('/admin/api/opportunity-directory/:slug', async (c) => {
  const slug = c.req.param('slug');
  const r = await q(c.env, `DELETE FROM opportunity_directory WHERE slug = $1 RETURNING slug`, [slug]);
  if (!r.length) throw notFound('Nothing to reset');
  await audit(c.env, c.get('user'), DIR_DEFAULT_ORDER[slug] ? 'directory_reset' : 'directory_delete', 'opportunity_directory', slug);
  return c.json({ slug, reset: !!DIR_DEFAULT_ORDER[slug], deleted: !DIR_DEFAULT_ORDER[slug] });
});

// ---------- admin ----------
adminOpportunities.get('/admin/api/opportunity-sources', async (c) => {
  const state = await q(c.env, `SELECT s.*, (SELECT count(*)::int FROM opportunities o WHERE o.source = s.key AND NOT o.hidden) AS live
    FROM opportunity_sources s`);
  const byKey = Object.fromEntries(state.map((s) => [s.key, s]));
  return c.json({
    items: SOURCES.map((s) => {
      const st = byKey[s.key] || {};
      return {
        key: s.key, name: s.name, url: s.site, kinds: s.kinds, everyHours: s.everyH,
        enabled: s.defaultOff ? !!st.admin_on && st.enabled !== false : st.enabled !== false, lastRunAt: iso(st.last_run_at), lastOkAt: iso(st.last_ok_at),
        lastError: st.last_error || null, lastCount: st.last_count || 0, live: st.live || 0,
        // JOBS FEEDS
        category: s.category || null,
        needsPermission: !!s.defaultOff, // terms need written permission: switch on only once you have it
        needsEnv: s.needsEnv || null, hasKey: s.needsEnv ? !!c.env[s.needsEnv] : null, // the key's value is never returned
        active: sourceActive(c.env, s, byKey[s.key]),
      };
    }),
  });
});

adminOpportunities.patch('/admin/api/opportunity-sources/:key', async (c) => {
  const key = c.req.param('key');
  if (!sourceByKey(key)) throw notFound('Unknown source');
  const b = await body(c);
  if (typeof b.enabled !== 'boolean') throw bad('enabled must be true or false');
  // admin_on records an explicit admin switch-on (needed for permission-gated sources)
  await q(c.env, `INSERT INTO opportunity_sources (key, enabled, admin_on) VALUES ($1, $2, $2)
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, admin_on = EXCLUDED.admin_on`, [key, b.enabled]);
  await audit(c.env, c.get('user'), b.enabled ? 'opportunity_source_on' : 'opportunity_source_off', 'opportunity_source', key);
  return c.json({ key, enabled: b.enabled });
});

adminOpportunities.post('/admin/api/opportunity-sources/:key/run', async (c) => {
  const key = c.req.param('key');
  const src = sourceByKey(key);
  if (!src) throw notFound('Unknown source');
  if (src.needsEnv && !c.env[src.needsEnv]) throw bad(`Add the ${src.needsEnv} secret to the Worker first`, 'KEY_MISSING');
  if (src.defaultOff) {
    const st = await one(c.env, `SELECT admin_on, enabled FROM opportunity_sources WHERE key = $1`, [key]);
    if (!st || !st.admin_on || st.enabled === false) throw bad('Switch this source on first (only once the site has given permission)', 'NEEDS_PERMISSION');
  }
  const r = await importSource(c.env, key, c.env.__fetch ? { fetchImpl: c.env.__fetch } : {}); // __fetch: tests' fake network
  await audit(c.env, c.get('user'), 'opportunity_source_run', 'opportunity_source', key, r);
  return c.json(r);
});

adminOpportunities.post('/admin/api/opportunities/:id/hide', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) throw notFound();
  const b = await body(c).catch(() => ({}));
  const hidden = b.hidden !== false;
  const row = await one(c.env, `UPDATE opportunities SET hidden = $2 WHERE id = $1 RETURNING id`, [id, hidden]);
  if (!row) throw notFound('Listing not found');
  await audit(c.env, c.get('user'), hidden ? 'opportunity_hide' : 'opportunity_unhide', 'opportunity', id);
  return c.json({ id, hidden });
});
