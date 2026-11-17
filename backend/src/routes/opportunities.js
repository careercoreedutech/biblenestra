// OPPORTUNITIES: jobs, remote work, internships, scholarships, fellowships, grants, hackathons and
// competitions imported from outside sources (see src/lib/opportunities.js). Read-only for users;
// admins can switch a source off, run an import now, or hide a listing.
//   GET  /opportunities?kind=&q=&remote=1&cursor=&limit=   (signed in)
//   GET  /opportunities/summary                            (signed in)
//   GET  /admin/api/opportunity-sources                    (admin)
//   PATCH /admin/api/opportunity-sources/:key {enabled}    (admin)
//   POST /admin/api/opportunity-sources/:key/run           (admin)
//   POST /admin/api/opportunities/:id/hide {hidden}        (admin)
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { bad, body, notFound, isUuid } from '../lib/http.js';
import { audit, requireAdmin } from './admin.js';
import { KINDS, KIND_LABELS, SOURCES, sourceByKey, importSource } from '../lib/opportunities.js';

export const opportunities = new Hono();
export const adminOpportunities = new Hono();
adminOpportunities.use('/admin/api/opportunity-sources', requireAdmin);
adminOpportunities.use('/admin/api/opportunity-sources/*', requireAdmin);
adminOpportunities.use('/admin/api/opportunities/*', requireAdmin);

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
  };
}

// Only listings that are still open (deadline in the future or none) and from enabled sources
const OPEN = `NOT o.hidden AND (o.deadline IS NULL OR o.deadline > now())
  AND NOT EXISTS (SELECT 1 FROM opportunity_sources s WHERE s.key = o.source AND NOT s.enabled)`;

opportunities.get('/opportunities', async (c) => {
  const kind = String(c.req.query('kind') || 'all').toLowerCase();
  if (kind !== 'all' && !KINDS.includes(kind)) throw bad(`kind must be one of: all, ${KINDS.join(', ')}`, 'BAD_KIND');
  const text = String(c.req.query('q') || '').trim().slice(0, 80);
  const remoteOnly = ['1', 'true', 'yes'].includes(String(c.req.query('remote') || '').toLowerCase());
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
  const cur = readCursor(c.req.query('cursor'));

  const args = [];
  let where = OPEN;
  if (kind !== 'all') { args.push(kind); where += ` AND o.kind = $${args.length}`; }
  if (remoteOnly) where += ' AND o.remote';
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
  const counts = await q(c.env, `SELECT o.kind, count(*)::int AS n FROM opportunities o WHERE ${OPEN} GROUP BY o.kind`);
  const byKind = Object.fromEntries(counts.map((r) => [r.kind, r.n]));
  const state = await q(c.env, `SELECT key, enabled, last_ok_at FROM opportunity_sources`);
  const off = new Set(state.filter((s) => !s.enabled).map((s) => s.key));
  const last = state.map((s) => s.last_ok_at).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  return c.json({
    kinds: KINDS.map((k) => ({ kind: k, label: KIND_LABELS[k], count: byKind[k] || 0 })),
    sources: SOURCES.filter((s) => !off.has(s.key)).map((s) => ({ key: s.key, name: s.name, url: s.site, kinds: s.kinds })),
    updatedAt: iso(last),
  });
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
        enabled: st.enabled !== false, lastRunAt: iso(st.last_run_at), lastOkAt: iso(st.last_ok_at),
        lastError: st.last_error || null, lastCount: st.last_count || 0, live: st.live || 0,
      };
    }),
  });
});

adminOpportunities.patch('/admin/api/opportunity-sources/:key', async (c) => {
  const key = c.req.param('key');
  if (!sourceByKey(key)) throw notFound('Unknown source');
  const b = await body(c);
  if (typeof b.enabled !== 'boolean') throw bad('enabled must be true or false');
  await q(c.env, `INSERT INTO opportunity_sources (key, enabled) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`, [key, b.enabled]);
  await audit(c.env, c.get('user'), b.enabled ? 'opportunity_source_on' : 'opportunity_source_off', 'opportunity_source', key);
  return c.json({ key, enabled: b.enabled });
});

adminOpportunities.post('/admin/api/opportunity-sources/:key/run', async (c) => {
  const key = c.req.param('key');
  if (!sourceByKey(key)) throw notFound('Unknown source');
  const r = await importSource(c.env, key);
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
