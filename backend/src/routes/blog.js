// BLOG — our own blog served by this Worker + the admin "Blog" tab with AI auto-posting.
//   blogPublic (no sign-in):
//     GET /blog                      list page (?topic=…&page=…), published posts only
//     GET /blog/:slug                article page (counts a view)
//     GET /blog/api/posts            → { items, page, hasMore, topics }   (?topic, ?page, ?limit ≤ 30)
//     GET /blog/api/posts/:slug      → post (+ html, related)
//   adminBlog (admins only): /admin/api/blog/*
//     posts:      GET/POST /posts, GET/PATCH/DELETE /posts/:id, POST /preview, POST /generate (AI draft; from a
//                 prompt/topic or from a course lesson / devotional)
//     schedules:  GET/POST /schedules, PATCH/DELETE /schedules/:id, POST /schedules/:id/run ("Run now")
//     runs:       GET /runs
//     settings:   GET/PUT /settings (AI disclaimer line, default author)
//   Admin tab script: lib/blogAdminPage.js; the "pick a blog post" helper for Courses & Devotionals is
//   LEARN_BLOG_LINK_SCRIPT in lib/learnAdminPage.js. Cron: lib/blog.js runBlogCron.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, notFound, uuidParam } from '../lib/http.js';
import { mediaUrl } from '../lib/shape.js';
import { imageRef } from '../lib/learn.js';
import {
  DEFAULT_AUTHOR, DEFAULT_DISCLAIMER, autoExcerpt, FREQUENCIES, LENGTHS, LIVE, PRESET_TOPICS, SLUG_RE, TONES, WEEKDAY_NAMES,
  clip, describeSchedule, getSettings, insertPost, maybeNotify, nextRunAt, postShape, readingMinutes, renderMarkdown,
  resolveVerseMarkers, runShape, safetyFlags, scheduleFromRow, scheduleInput, startRun, workPending, writeArticle,
} from '../lib/blog.js';
import { articlePage, listPage, notFoundPage } from '../lib/blogPages.js';
import { BLOG_ADMIN_SCRIPT } from '../lib/blogAdminPage.js';
import { LEARN_BLOG_LINK_SCRIPT } from '../lib/learnAdminPage.js';
import { audit, registerAdminScript, requireAdmin } from './admin.js';

registerAdminScript(BLOG_ADMIN_SCRIPT);
registerAdminScript(LEARN_BLOG_LINK_SCRIPT);

const PAGE_SIZE = 12;
const base = (c) => String(c.env.BLOG_BASE_URL || new URL(c.req.url).origin).replace(/\/$/, '');
const shapeFor = (c, opts = {}) => (r) => postShape(r, { base: base(c), mediaUrlFor: (k) => mediaUrl(c.env, new URL(c.req.url).origin, k), ...opts });
const inApp = (c) => c.req.query('app') === '1';

async function liveTopics(env) {
  return (await q(env, `SELECT p.topic, count(*)::int AS n FROM blog_posts p WHERE ${LIVE} AND p.topic IS NOT NULL GROUP BY p.topic ORDER BY n DESC, p.topic LIMIT 30`)).map((r) => r.topic);
}
async function livePage(env, topic, page, limit) {
  const rows = await q(env, `SELECT p.* FROM blog_posts p WHERE ${LIVE} AND ($1::text IS NULL OR p.topic = $1::text)
    ORDER BY COALESCE(p.published_at, p.publish_at) DESC, p.id LIMIT $2 OFFSET $3`, [topic, limit + 1, (page - 1) * limit]);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}
async function liveBySlug(env, slug) {
  if (!SLUG_RE.test(slug || '')) return null;
  return one(env, `SELECT p.* FROM blog_posts p WHERE p.slug = $1 AND ${LIVE}`, [slug]);
}
async function relatedTo(env, r) {
  return q(env, `SELECT p.* FROM blog_posts p WHERE ${LIVE} AND p.id <> $1 ORDER BY (p.topic IS NOT DISTINCT FROM $2::text) DESC, COALESCE(p.published_at, p.publish_at) DESC LIMIT 3`, [r.id, r.topic]);
}
const pageNum = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1; };
const topicParam = (v) => { const s = String(v || '').trim(); return s ? s.slice(0, 60) : null; };

// ---------- public ----------
export const blogPublic = new Hono();

blogPublic.get('/blog/api/posts', async (c) => {
  const topic = topicParam(c.req.query('topic'));
  const page = pageNum(c.req.query('page'));
  const limit = Math.min(30, Math.max(1, Number(c.req.query('limit')) || PAGE_SIZE));
  const { rows, hasMore } = await livePage(c.env, topic, page, limit);
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({ items: rows.map(shapeFor(c, { full: false })), page, hasMore, topics: await liveTopics(c.env) });
});

blogPublic.get('/blog/api/posts/:slug', async (c) => {
  const r = await liveBySlug(c.env, c.req.param('slug'));
  if (!r) throw notFound('Article not found');
  const s = await getSettings(c.env);
  const post = shapeFor(c)(r);
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({ ...post, html: renderMarkdown(post.body), disclaimer: r.source === 'ai' && s.disclaimer ? s.disclaimerText : null, related: (await relatedTo(c.env, r)).map(shapeFor(c, { full: false })) });
});

blogPublic.get('/blog', async (c) => {
  const topic = topicParam(c.req.query('topic'));
  const page = pageNum(c.req.query('page'));
  const { rows, hasMore } = await livePage(c.env, topic, page, PAGE_SIZE);
  c.header('Cache-Control', 'public, max-age=120');
  return c.html(listPage({ env: c.env, base: base(c), posts: rows.map(shapeFor(c, { full: false })), topics: await liveTopics(c.env), topic, page, hasMore, inApp: inApp(c) }));
});
blogPublic.get('/blog/', (c) => c.redirect('/blog'));

blogPublic.get('/blog/:slug', async (c) => {
  const r = await liveBySlug(c.env, c.req.param('slug'));
  if (!r) return c.html(notFoundPage({ env: c.env, base: base(c) }), 404);
  await q(c.env, 'UPDATE blog_posts SET views = views + 1 WHERE id = $1', [r.id]).catch(() => {});
  const s = await getSettings(c.env);
  c.header('Cache-Control', 'public, max-age=120');
  return c.html(articlePage({
    env: c.env, base: base(c), post: shapeFor(c)(r), related: (await relatedTo(c.env, r)).map(shapeFor(c, { full: false })),
    disclaimer: r.source === 'ai' && s.disclaimer ? s.disclaimerText : null, inApp: inApp(c),
  }));
});

// ---------- admin ----------
export const adminBlog = new Hono();
adminBlog.use('/admin/api/blog', requireAdmin);
adminBlog.use('/admin/api/blog/*', requireAdmin);

const STATUSES = ['draft', 'scheduled', 'published'];

function tagsInput(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  return [...new Set(list.map((t) => String(t || '').trim().replace(/^#/, '').slice(0, 30)).filter(Boolean))].slice(0, 8);
}
function whenInput(v) {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw bad('Choose when to publish', 'BAD_DATE');
  return d;
}

/** Validate a post body (create, or patch over `cur`). Returns column values; status handling done by caller. */
async function postFields(env, b, cur = null) {
  const has = (k) => b[k] !== undefined;
  const title = has('title') ? String(b.title || '').trim() : cur && cur.title;
  if (!title || title.length > 160) throw bad('Give the post a title (up to 160 characters)', 'BAD_TITLE');
  let text = has('body') ? String(b.body || '') : cur ? cur.body : '';
  if (text.length > 60000) throw bad('The article is too long (max 60,000 characters)', 'TOO_LONG');
  let dropped = [];
  if (has('body') && /\[\[/.test(text)) { const v = await resolveVerseMarkers(env, text); text = v.body; dropped = v.dropped; }
  let slug = cur ? cur.slug : null;
  if (has('slug') && String(b.slug || '').trim()) {
    slug = String(b.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug) || slug.length > 90) throw bad('The link may only use lowercase letters, numbers and dashes', 'BAD_SLUG');
    const clash = await one(env, 'SELECT id FROM blog_posts WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)', [slug, cur ? cur.id : null]);
    if (clash) throw new ApiError(409, 'SLUG_TAKEN', `Another post already uses /blog/${slug}`);
  }
  const excerpt = has('excerpt') ? clip(String(b.excerpt || ''), 300) : cur ? cur.excerpt : '';
  return {
    title,
    slug,
    body: text,
    excerpt: excerpt || autoExcerpt(text),
    coverKey: imageRef(b.coverKey !== undefined ? b.coverKey : b.coverUrl, cur ? cur.cover_key : null, 'cover'),
    topic: has('topic') ? (String(b.topic || '').trim().slice(0, 60) || null) : cur ? cur.topic : null,
    tags: has('tags') ? tagsInput(b.tags) : cur ? cur.tags || [] : [],
    author: has('author') ? (String(b.author || '').trim().slice(0, 80) || DEFAULT_AUTHOR) : cur ? cur.author : null,
    seoDescription: has('seoDescription') ? clip(String(b.seoDescription || ''), 160) : cur ? cur.seo_description : '',
    dropped,
  };
}
function statusFields(b, cur = null) {
  const status = b.status !== undefined ? String(b.status) : cur ? cur.status : 'draft';
  if (!STATUSES.includes(status)) throw bad('status must be draft, scheduled or published', 'BAD_STATUS');
  if (status === 'scheduled') {
    const at = b.publishAt !== undefined ? whenInput(b.publishAt) : cur && cur.publish_at ? new Date(cur.publish_at) : whenInput(null);
    return { status, publishAt: at.toISOString(), publishedAt: null };
  }
  if (status === 'published') return { status, publishAt: null, publishedAt: cur && cur.status === 'published' && cur.published_at ? new Date(cur.published_at).toISOString() : new Date().toISOString() };
  return { status: 'draft', publishAt: null, publishedAt: null };
}

adminBlog.get('/admin/api/blog/posts', async (c) => {
  const status = c.req.query('status');
  const search = String(c.req.query('q') || '').trim().slice(0, 80);
  const limit = Math.min(300, Math.max(1, Number(c.req.query('limit')) || 100));
  const rows = await q(c.env, `SELECT p.*, s.name AS schedule_name FROM blog_posts p LEFT JOIN blog_schedules s ON s.id = p.schedule_id
    WHERE ($1::text IS NULL OR p.status = $1::text) AND ($2::text = '' OR p.title ILIKE '%' || $2::text || '%' OR p.topic ILIKE '%' || $2::text || '%')
    ORDER BY COALESCE(p.publish_at, p.published_at, p.created_at) DESC LIMIT $3`, [STATUSES.includes(status) ? status : null, search, limit]);
  const counts = Object.fromEntries((await q(c.env, 'SELECT status, count(*)::int AS n FROM blog_posts GROUP BY status')).map((r) => [r.status, r.n]));
  return c.json({
    items: rows.map((r) => ({ ...shapeFor(c, { full: false })(r), scheduleName: r.schedule_name || null })),
    counts: { draft: counts.draft || 0, scheduled: counts.scheduled || 0, published: counts.published || 0 },
    base: base(c),
    presets: { topics: PRESET_TOPICS, tones: TONES, lengths: LENGTHS, frequencies: FREQUENCIES, weekdays: WEEKDAY_NAMES },
  });
});

adminBlog.get('/admin/api/blog/posts/:id', async (c) => {
  const r = await one(c.env, 'SELECT * FROM blog_posts WHERE id = $1', [uuidParam(c)]);
  if (!r) throw notFound('Post not found');
  return c.json(shapeFor(c)(r));
});

adminBlog.post('/admin/api/blog/posts', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const f = await postFields(c.env, b);
  const st = statusFields(b);
  const settings = await getSettings(c.env);
  const row = await insertPost(c.env, { ...f, ...st, author: f.author || settings.authorName, source: 'manual', createdBy: me.id });
  await audit(c.env, me, 'blog.create', 'blog_post', row.id, { title: row.title, status: row.status });
  return c.json({ ...shapeFor(c)(row), droppedRefs: f.dropped }, 201);
});

adminBlog.patch('/admin/api/blog/posts/:id', async (c) => {
  const me = c.get('user');
  const cur = await one(c.env, 'SELECT * FROM blog_posts WHERE id = $1', [uuidParam(c)]);
  if (!cur) throw notFound('Post not found');
  const b = await body(c);
  const f = await postFields(c.env, b, cur);
  const st = statusFields(b, cur);
  const row = await one(c.env, `UPDATE blog_posts SET title = $2, slug = $3, body = $4, excerpt = $5, cover_key = $6, topic = $7, tags = $8::jsonb, author = $9,
      seo_description = $10, reading_minutes = $11, status = $12, publish_at = $13, published_at = $14,
      review_note = CASE WHEN $12 = 'published' THEN NULL ELSE review_note END, updated_at = now()
    WHERE id = $1 RETURNING *`, [cur.id, f.title, f.slug, f.body, f.excerpt, f.coverKey, f.topic, JSON.stringify(f.tags), f.author || DEFAULT_AUTHOR,
    f.seoDescription || '', readingMinutes(f.body), st.status, st.publishAt, st.publishedAt]);
  if (row.status === 'published' && cur.status !== 'published') {
    await maybeNotify(c.env, row).catch(() => {});
  }
  await audit(c.env, me, 'blog.update', 'blog_post', row.id, { title: row.title, status: row.status });
  return c.json({ ...shapeFor(c)(row), droppedRefs: f.dropped });
});

adminBlog.delete('/admin/api/blog/posts/:id', async (c) => {
  const me = c.get('user');
  const r = await one(c.env, 'DELETE FROM blog_posts WHERE id = $1 RETURNING id, title', [uuidParam(c)]);
  if (!r) throw notFound('Post not found');
  await audit(c.env, me, 'blog.delete', 'blog_post', r.id, { title: r.title });
  return c.json({ ok: true });
});

adminBlog.post('/admin/api/blog/preview', async (c) => {
  const b = await body(c);
  const v = await resolveVerseMarkers(c.env, String(b.body || '').slice(0, 60000));
  return c.json({ html: renderMarkdown(v.body), droppedRefs: v.dropped, readingMinutes: readingMinutes(v.body), flags: safetyFlags(v.body) });
});

/** AI draft from a prompt/topic, or from a course lesson / devotional ({ lessonId } / { devotionalId }). Saved as a draft. */
adminBlog.post('/admin/api/blog/generate', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  let topic = String(b.topic || '').trim().slice(0, 60) || null;
  const prompt = String(b.prompt || '').trim().slice(0, 1500);
  const tone = TONES[b.tone] ? b.tone : 'warm';
  const length = LENGTHS[b.length] ? b.length : 'medium';
  let source = null;
  if (b.lessonId) {
    const l = await one(c.env, `SELECT l.title, l.excerpt, co.title AS course FROM learn_lessons l JOIN learn_courses co ON co.id = l.course_id WHERE l.id = $1`, [String(b.lessonId)]).catch(() => null);
    if (!l) throw notFound('Lesson not found');
    source = `Write the full article for lesson "${l.title}" of the course "${l.course}". The short in-app excerpt readers saw is:\n"""${clip(l.excerpt || '', 1500)}"""\nExpand it into the complete lesson.`;
    topic = topic || 'Courses';
  } else if (b.devotionalId) {
    const d = await one(c.env, 'SELECT title, excerpt FROM learn_devotionals WHERE id = $1', [String(b.devotionalId)]).catch(() => null);
    if (!d) throw notFound('Devotional not found');
    source = `Write the full devotional "${d.title}". The short in-app excerpt readers saw is:\n"""${clip(d.excerpt || '', 1500)}"""\nExpand it into the complete devotional.`;
    topic = topic || 'Devotional';
  } else if (b.title || b.excerpt) {
    source = `Write the full article titled "${clip(String(b.title || ''), 140)}". The short summary readers saw is:\n"""${clip(String(b.excerpt || ''), 1500)}"""\nExpand it into the complete article, keeping that title if it is not already used.`;
  }
  if (!topic && !prompt && !source) throw bad('Pick a topic or describe what to write', 'NO_TOPIC');
  const art = await writeArticle(c.env, { topic, prompt, tone, length, source });
  const settings = await getSettings(c.env);
  const row = await insertPost(c.env, {
    title: art.title, excerpt: art.excerpt, body: art.body, topic: topic || 'Devotional', tags: art.tags, status: 'draft', author: settings.authorName,
    source: 'ai', seoDescription: art.seoDescription, createdBy: me.id,
    reviewNote: art.flags.length ? `Held for review: ${art.flags.join(', ')}` : 'AI draft — review and publish',
  });
  await audit(c.env, me, 'blog.generate', 'blog_post', row.id, { title: row.title, model: art.model });
  return c.json({ ...shapeFor(c)(row), model: art.model, droppedRefs: art.dropped, flags: art.flags }, 201);
});

// ----- schedules -----
async function scheduleOut(env, r) {
  const s = scheduleFromRow(r);
  const runs = await q(env, 'SELECT * FROM blog_runs WHERE schedule_id = $1 ORDER BY started_at DESC LIMIT 5', [r.id]);
  return { ...s, summary: describeSchedule(s), runs: runs.map(runShape) };
}

adminBlog.get('/admin/api/blog/schedules', async (c) => {
  const rows = await q(c.env, 'SELECT * FROM blog_schedules ORDER BY active DESC, created_at DESC');
  return c.json({ items: await Promise.all(rows.map((r) => scheduleOut(c.env, r))), presets: { topics: PRESET_TOPICS, tones: TONES, lengths: LENGTHS, weekdays: WEEKDAY_NAMES } });
});

adminBlog.post('/admin/api/blog/schedules', async (c) => {
  const me = c.get('user');
  const s = scheduleInput(await body(c));
  const next = s.active ? nextRunAt(s, new Date()) : null;
  const r = await one(c.env, `INSERT INTO blog_schedules (name, topics, prompt, tone, length, posts_per_run, frequency, weekdays, month_day, time_of_day, timezone,
      publish_mode, notify, active, base_url, next_run_at, created_by)
    VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [
    s.name, JSON.stringify(s.topics), s.prompt, s.tone, s.length, s.postsPerRun, s.frequency, JSON.stringify(s.weekdays), s.monthDay, s.timeOfDay, s.timezone,
    s.publishMode, s.notify, s.active, base(c), next ? next.toISOString() : null, me.id]);
  await audit(c.env, me, 'blog.schedule.create', 'blog_schedule', r.id, { name: s.name });
  return c.json(await scheduleOut(c.env, r), 201);
});

adminBlog.patch('/admin/api/blog/schedules/:id', async (c) => {
  const me = c.get('user');
  const cur = await one(c.env, 'SELECT * FROM blog_schedules WHERE id = $1', [uuidParam(c)]);
  if (!cur) throw notFound('Schedule not found');
  const s = scheduleInput(await body(c), scheduleFromRow(cur));
  const next = s.active ? nextRunAt(s, new Date()) : null;
  const r = await one(c.env, `UPDATE blog_schedules SET name = $2, topics = $3::jsonb, prompt = $4, tone = $5, length = $6, posts_per_run = $7, frequency = $8,
      weekdays = $9::jsonb, month_day = $10, time_of_day = $11, timezone = $12, publish_mode = $13, notify = $14, active = $15, base_url = $16,
      next_run_at = $17, updated_at = now() WHERE id = $1 RETURNING *`, [
    cur.id, s.name, JSON.stringify(s.topics), s.prompt, s.tone, s.length, s.postsPerRun, s.frequency, JSON.stringify(s.weekdays), s.monthDay, s.timeOfDay,
    s.timezone, s.publishMode, s.notify, s.active, base(c), next ? next.toISOString() : null]);
  await audit(c.env, me, 'blog.schedule.update', 'blog_schedule', r.id, { name: s.name, active: s.active });
  return c.json(await scheduleOut(c.env, r));
});

adminBlog.delete('/admin/api/blog/schedules/:id', async (c) => {
  const me = c.get('user');
  const r = await one(c.env, 'DELETE FROM blog_schedules WHERE id = $1 RETURNING id, name', [uuidParam(c)]);
  if (!r) throw notFound('Schedule not found');
  await audit(c.env, me, 'blog.schedule.delete', 'blog_schedule', r.id, { name: r.name });
  return c.json({ ok: true });
});

/** "Run now": start a run (if none in progress) and write up to BLOG_INLINE_POSTS (default 2) posts right away; the cron finishes the rest. */
adminBlog.post('/admin/api/blog/schedules/:id/run', async (c) => {
  const me = c.get('user');
  const s = await one(c.env, 'SELECT * FROM blog_schedules WHERE id = $1', [uuidParam(c)]);
  if (!s) throw notFound('Schedule not found');
  if (!c.env.AI) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI writing isn’t set up on this server (Workers AI binding "AI" is missing).');
  let run = await startRun(c.env, s, 'manual');
  if (!run && s.pending > 0) run = await one(c.env, 'SELECT * FROM blog_runs WHERE id = $1', [s.pending_run_id]); // continue the run in progress
  if (!run) throw new ApiError(409, 'RUN_IN_PROGRESS', 'This schedule is already running');
  const inline = Math.max(1, Math.min(5, Number(c.env.BLOG_INLINE_POSTS) || 2));
  const w = await workPending(c.env, { budget: inline, scheduleId: s.id });
  await audit(c.env, me, 'blog.schedule.run', 'blog_schedule', s.id, { made: w.made, failed: w.failed });
  const fresh = await one(c.env, 'SELECT * FROM blog_schedules WHERE id = $1', [s.id]);
  const r = await one(c.env, 'SELECT * FROM blog_runs WHERE id = $1', [run.id]);
  return c.json({ run: runShape(r), made: w.made, failed: w.failed, quota: w.quota, remaining: fresh.pending, posts: w.posts.map(shapeFor(c, { full: false })) });
});

adminBlog.get('/admin/api/blog/runs', async (c) => {
  const rows = await q(c.env, `SELECT r.*, s.name AS schedule_name FROM blog_runs r LEFT JOIN blog_schedules s ON s.id = r.schedule_id
    ORDER BY r.started_at DESC LIMIT 40`);
  return c.json({ items: rows.map(runShape) });
});

// ----- settings -----
adminBlog.get('/admin/api/blog/settings', async (c) => c.json({ ...(await getSettings(c.env)), defaultDisclaimer: DEFAULT_DISCLAIMER }));
adminBlog.put('/admin/api/blog/settings', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const cur = await getSettings(c.env);
  const disclaimer = b.disclaimer !== undefined ? !!b.disclaimer : cur.disclaimer;
  const text = b.disclaimerText !== undefined ? clip(String(b.disclaimerText || ''), 400) || null : cur.disclaimerText;
  const author = b.authorName !== undefined ? String(b.authorName || '').trim().slice(0, 80) || null : cur.authorName;
  await q(c.env, `INSERT INTO blog_settings (id, disclaimer, disclaimer_text, author_name, updated_at) VALUES (1,$1,$2,$3,now())
    ON CONFLICT (id) DO UPDATE SET disclaimer = $1, disclaimer_text = $2, author_name = $3, updated_at = now()`, [disclaimer, text, author]);
  await audit(c.env, me, 'blog.settings', 'blog_settings', '1', { disclaimer });
  return c.json({ ...(await getSettings(c.env)), defaultDisclaimer: DEFAULT_DISCLAIMER });
});

