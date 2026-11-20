// BLOG: public /blog pages (published only), admin posts (slugs, statuses), AI schedules (due times in a timezone for
// daily / weekly / monthly, posts per run, topic rotation, drafts vs auto-publish, run log, cron resume), scripture
// markers (exact KJV text from the Bible API, invalid references dropped), safety holds, admin-only routes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import {
  nextRunAt, topicFor, resolveVerseMarkers, renderMarkdown, slugify, parseArticle, safetyFlags, runBlogCron, scheduleInput,
} from '../src/lib/blog.js';

// ---------- mocks ----------
const filler = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
let aiCalls = [];
let aiOverride = null; // (prompt) → reply | throws
const AI = {
  async run(model, input) {
    const p = input.messages[1].content;
    aiCalls.push({ model, prompt: p, system: input.messages[0].content });
    if (aiOverride) return aiOverride(p);
    const topic = (/^Topic: (.+?)\.$/m.exec(p) || [])[1] || 'General';
    return { response: article(`${topic} for everyday life ${aiCalls.length}`, topic) };
  },
};
function article(title, topic = 'Faith', extra = '') {
  return [
    `TITLE: ${title}`,
    `EXCERPT: A short word about ${topic}.`,
    'SEO: Search text',
    `TAGS: ${topic.toLowerCase()}, hope`,
    'BODY:',
    '## Where we start',
    filler(90),
    '',
    '[[JHN 3:16]]',
    '',
    '> For God so loved the world FAKE MODEL TEXT',
    '',
    `Read [[ROM 8:28]] today and not [[JHN 99:1]]. ${extra}`,
    '',
    '[[XYZ 1:1]]',
    '',
    'Lord, help us. Amen.',
  ].join('\n');
}
const fetched = [];
async function mockFetch(url) {
  const m = /helloao\.org\/api\/eng_kjv\/(\w+)\/(\d+)\.json$/.exec(String(url));
  if (!m) return new Response('nope', { status: 404 });
  fetched.push(`${m[1]} ${m[2]}`);
  const content = Array.from({ length: 60 }, (_, i) => ({ type: 'verse', number: i + 1, content: [`KJV ${m[1]} ${m[2]}:${i + 1} text.`] }));
  return new Response(JSON.stringify({ chapter: { content } }), { headers: { 'Content-Type': 'application/json' } });
}

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', AI, __fetch: mockFetch };
});
async function call(user, method, path, body, e = env) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), e);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json, text };
}
const ids = {};

test('setup: boss is an admin, ann is a member', async () => {
  for (const u of ['boss', 'ann']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
});

// ---------- due-time logic ----------
const S = (o) => ({ frequency: 'daily', weekdays: [], monthDay: 1, timeOfDay: '08:00', timezone: 'Africa/Lagos', ...o });
test('daily schedule: next run at local time in the timezone (Lagos = UTC+1)', () => {
  assert.equal(nextRunAt(S({}), new Date('2026-11-20T06:00:00Z')).toISOString(), '2026-11-20T07:00:00.000Z');
  assert.equal(nextRunAt(S({}), new Date('2026-11-20T07:00:00Z')).toISOString(), '2026-11-21T07:00:00.000Z', 'strictly after');
  // local date differs from the UTC date: 23:30 UTC on the 20th is already the 21st in Lagos
  assert.equal(nextRunAt(S({ timeOfDay: '06:00' }), new Date('2026-11-20T23:30:00Z')).toISOString(), '2026-11-21T05:00:00.000Z');
  // DST: New York 09:00 is 14:00Z in winter, 13:00Z after the March switch
  assert.equal(nextRunAt(S({ timeOfDay: '09:00', timezone: 'America/New_York' }), new Date('2027-03-13T15:00:00Z')).toISOString(), '2027-03-14T13:00:00.000Z');
});
test('weekly schedule: only on the chosen weekdays', () => {
  // Fri 20 Nov 2026 → Mon 23 Nov 18:30 New York (EST, UTC-5)
  const s = S({ frequency: 'weekly', weekdays: [1, 4], timeOfDay: '18:30', timezone: 'America/New_York' });
  assert.equal(nextRunAt(s, new Date('2026-11-20T12:00:00Z')).toISOString(), '2026-11-23T23:30:00.000Z');
  assert.equal(nextRunAt(s, new Date('2026-11-23T23:30:00Z')).toISOString(), '2026-11-26T23:30:00.000Z', 'then Thursday');
});
test('monthly schedule: day of month, clamped to the last day of short months', () => {
  assert.equal(nextRunAt(S({ frequency: 'monthly', monthDay: 15 }), new Date('2026-11-20T00:00:00Z')).toISOString(), '2026-12-15T07:00:00.000Z');
  assert.equal(nextRunAt(S({ frequency: 'monthly', monthDay: 31 }), new Date('2026-11-20T00:00:00Z')).toISOString(), '2026-11-30T07:00:00.000Z');
  assert.equal(nextRunAt(S({ frequency: 'monthly', monthDay: 31 }), new Date('2027-02-01T00:00:00Z')).toISOString(), '2027-02-28T07:00:00.000Z');
});
test('schedule input validation', () => {
  assert.throws(() => scheduleInput({ name: 'x' }), /topic/);
  assert.throws(() => scheduleInput({ name: 'x', topics: ['Prayer'], postsPerRun: 6 }), /1 to 5/);
  assert.throws(() => scheduleInput({ name: 'x', topics: ['Prayer'], frequency: 'weekly', weekdays: [] }), /weekday/);
  assert.throws(() => scheduleInput({ name: 'x', topics: ['Prayer'], timezone: 'Mars/Base' }), /timezone/);
  const s = scheduleInput({ name: 'x', topics: ['Prayer', 'prayer', ' Faith '] });
  assert.deepEqual(s.topics, ['Prayer', 'Faith']);
  assert.equal(s.timezone, 'Africa/Lagos'); assert.equal(s.publishMode, 'draft'); assert.equal(s.notify, false);
});
test('topic rotation: consecutive posts differ and wrap around', () => {
  const s = { topics: ['Prayer', 'Faith', 'Grief'] };
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => topicFor(s, n)), ['Prayer', 'Faith', 'Grief', 'Prayer', 'Faith']);
  assert.equal(topicFor({ topics: [] }, 3), null);
});

// ---------- text ----------
test('markdown is escaped; slugs are clean', () => {
  const html = renderMarkdown('## Hi <b>\n\nText with <script>alert(1)</script> and [x](javascript:alert(1)) and [ok](https://e.com) **bold**\n\n- a\n- b\n\n> “v”\n> — **John 3:16** (KJV)');
  assert.ok(!/<script>|<b>/.test(html), html);
  assert.ok(html.includes('<h2>Hi &lt;b&gt;</h2>'));
  assert.ok(html.includes('<a href="https://e.com"'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<strong>bold</strong>') && html.includes('<ul><li>a</li><li>b</li></ul>') && html.includes('<cite>'));
  assert.equal(slugify('  Faith & Hope: Walking Daily! '), 'faith-and-hope-walking-daily');
  assert.equal(slugify('API'), 'api-post');
  assert.equal(slugify('!!!'), 'post');
});
test('article parser reads the labelled format', () => {
  const a = parseArticle(article('Peace in the storm'));
  assert.equal(a.title, 'Peace in the storm');
  assert.deepEqual(a.tags, ['faith', 'hope']);
  assert.ok(a.body.startsWith('## Where we start'));
  assert.equal(parseArticle('nothing useful'), null);
});
test('verse markers: exact KJV text inserted, invalid references dropped, model quotes removed', async () => {
  const v = await resolveVerseMarkers(env, parseArticle(article('X')).body, { stripModelQuotes: true });
  assert.ok(v.body.includes('> “KJV JHN 3:16 text.”'), v.body);
  assert.ok(v.body.includes('> — **John 3:16** (KJV)'));
  assert.ok(v.body.includes('Read Romans 8:28 today and not.'), 'inline marker → label, invalid inline dropped');
  assert.ok(!v.body.includes('FAKE MODEL TEXT'), 'model-written quote removed');
  assert.ok(!/\[\[/.test(v.body));
  assert.deepEqual(v.used.sort(), ['JHN 3:16', 'ROM 8:28']);
  assert.deepEqual(v.dropped.sort(), ['JHN 99:1', 'XYZ 1:1']);
  assert.ok(fetched.includes('JHN 3'));
});
test('safety flags', () => {
  assert.deepEqual(safetyFlags('Pray and keep seeing your doctor.'), []);
  assert.ok(safetyFlags('Stop taking your medication and trust God').includes('medical advice'));
  assert.ok(safetyFlags('Vote for the candidate who prays').includes('politics'));
  assert.ok(safetyFlags('Catholics are deceived').includes('denominational attack'));
  assert.ok(safetyFlags('God guarantees wealth to all who give').includes('financial promise'));
});

// ---------- admin-only ----------
test('members get 403 on every admin blog route', async () => {
  for (const [m, p] of [['GET', '/admin/api/blog/posts'], ['POST', '/admin/api/blog/posts'], ['GET', '/admin/api/blog/schedules'], ['POST', '/admin/api/blog/generate'],
    ['GET', '/admin/api/blog/runs'], ['PUT', '/admin/api/blog/settings'], ['POST', '/admin/api/blog/preview']]) {
    assert.equal((await call('ann', m, p, m === 'GET' ? undefined : {})).status, 403, `${m} ${p}`);
  }
  assert.equal((await call(null, 'GET', '/admin/api/blog/posts')).status, 401);
});

// ---------- posts + public pages ----------
let draft; let pub;
test('admin creates posts; slugs are unique; markers in manual posts are resolved', async () => {
  const a = await call('boss', 'POST', '/admin/api/blog/posts', { title: 'Walking by Faith', body: '## One\n\nHello <b>world</b>\n\n[[PSA 23:1]]', topic: 'Faith', status: 'published' });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  pub = a.json;
  assert.equal(pub.slug, 'walking-by-faith');
  assert.equal(pub.status, 'published');
  assert.ok(pub.body.includes('KJV PSA 23:1 text.'));
  const b = await call('boss', 'POST', '/admin/api/blog/posts', { title: 'Walking by Faith', body: 'Second' });
  assert.equal(b.json.slug, 'walking-by-faith-2');
  draft = b.json;
  assert.equal(draft.status, 'draft');
  const clash = await call('boss', 'PATCH', `/admin/api/blog/posts/${draft.id}`, { slug: 'walking-by-faith' });
  assert.equal(clash.status, 409);
  assert.equal((await call('boss', 'PATCH', `/admin/api/blog/posts/${draft.id}`, { slug: 'Bad Slug!' })).json.code, 'BAD_SLUG');
  assert.equal((await call('boss', 'POST', '/admin/api/blog/posts', { title: '' })).status, 400);
  assert.equal((await call('boss', 'POST', '/admin/api/blog/posts', { title: 'S', status: 'scheduled' })).json.code, 'BAD_DATE');
});

test('public pages show published posts only (drafts and future scheduled posts are hidden)', async () => {
  const future = await call('boss', 'POST', '/admin/api/blog/posts', { title: 'Coming soon', body: 'Later', status: 'scheduled', publishAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(future.json.status, 'scheduled'); assert.equal(future.json.live, false);
  const list = await call(null, 'GET', '/blog');
  assert.equal(list.status, 200);
  assert.ok(list.text.includes('Walking by Faith'));
  assert.ok(!list.text.includes('Coming soon'));
  assert.ok(list.text.includes('Open in BibleNestra'));
  assert.ok(!/<script/i.test(list.text), 'no JavaScript on public pages');
  const art = await call(null, 'GET', '/blog/walking-by-faith');
  assert.equal(art.status, 200);
  assert.ok(art.text.includes('<title>Walking by Faith · BibleNestra</title>'));
  assert.ok(art.text.includes('property="og:title"') && art.text.includes('rel="canonical" href="http://api.test/blog/walking-by-faith"'));
  assert.ok(art.text.includes('Hello &lt;b&gt;world&lt;/b&gt;'), 'body escaped');
  assert.ok(art.text.includes('KJV PSA 23:1 text.'));
  assert.ok(art.text.includes('biblenestra://blog/walking-by-faith'));
  assert.equal((await call(null, 'GET', '/blog/walking-by-faith-2')).status, 404, 'draft hidden');
  assert.equal((await call(null, 'GET', `/blog/${future.json.slug}`)).status, 404, 'future scheduled hidden');
  const api = await call(null, 'GET', '/blog/api/posts');
  assert.deepEqual(api.json.items.map((p) => p.slug), ['walking-by-faith']);
  assert.equal(api.json.items[0].body, undefined, 'list has no bodies');
  assert.deepEqual(api.json.topics, ['Faith']);
  const one1 = await call(null, 'GET', '/blog/api/posts/walking-by-faith');
  assert.ok(one1.json.html.includes('<h2>One</h2>'));
  assert.equal((await call(null, 'GET', '/blog/api/posts/walking-by-faith-2')).status, 404);
  assert.equal((await call(null, 'GET', '/blog?topic=Grief')).text.includes('No articles on this topic yet'), true);
  const views = await one(env, 'SELECT views FROM blog_posts WHERE id = $1', [pub.id]);
  assert.equal(views.views, 1);

  // a scheduled post goes live once its time passes (cron flips it to published)
  await q(env, `UPDATE blog_posts SET publish_at = now() - interval '1 minute' WHERE id = $1`, [future.json.id]);
  const r = await runBlogCron(env);
  assert.equal(r.published, 1);
  assert.equal((await one(env, 'SELECT status FROM blog_posts WHERE id = $1', [future.json.id])).status, 'published');
  assert.equal((await call(null, 'GET', `/blog/${future.json.slug}`)).status, 200);
  // unpublish hides it again
  await call('boss', 'PATCH', `/admin/api/blog/posts/${future.json.id}`, { status: 'draft' });
  assert.equal((await call(null, 'GET', `/blog/${future.json.slug}`)).status, 404);
});

test('single AI post from a prompt is saved as a draft with real verse text', async () => {
  aiCalls = [];
  const r = await call('boss', 'POST', '/admin/api/blog/generate', { topic: 'Forgiveness', prompt: 'for families', tone: 'pastoral', length: 'short' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, 'draft'); assert.equal(r.json.source, 'ai'); assert.equal(r.json.topic, 'Forgiveness');
  assert.ok(r.json.body.includes('KJV JHN 3:16 text.'));
  assert.deepEqual(r.json.droppedRefs.sort(), ['JHN 99:1', 'XYZ 1:1']);
  assert.ok(aiCalls[0].prompt.includes('Extra guidance from the editor: for families'));
  assert.ok(aiCalls[0].system.includes('Never write out the words of a Bible verse'));
  assert.ok(aiCalls[0].prompt.includes('Walking by Faith'), 'recent titles are passed to avoid repeats');
  assert.equal(aiCalls[0].model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  // BLOG_MODEL overrides the model
  aiCalls = [];
  await call('boss', 'POST', '/admin/api/blog/generate', { topic: 'Hope' }, { ...env, BLOG_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8' });
  assert.equal(aiCalls[0].model, '@cf/meta/llama-3.1-8b-instruct-fp8');
  // without the AI binding → 503
  assert.equal((await call('boss', 'POST', '/admin/api/blog/generate', { topic: 'Hope' }, { ...env, AI: undefined })).json.code, 'AI_NOT_CONFIGURED');
});

test('duplicate title: the writer is asked again for a different title', async () => {
  aiCalls = [];
  aiOverride = (p) => ({ response: article(p.includes('was already used') ? 'A brand new angle' : 'Walking by Faith') });
  const r = await call('boss', 'POST', '/admin/api/blog/generate', { topic: 'Faith' });
  aiOverride = null;
  assert.equal(r.json.title, 'A brand new angle');
  assert.equal(aiCalls.length, 2);
});

// ---------- schedules ----------
let sched;
test('schedule: create (drafts by default), Run now writes up to 2 inline, cron resumes; topics rotate; run logged', async () => {
  const c = await call('boss', 'POST', '/admin/api/blog/schedules', { name: 'Morning', topics: ['Prayer', 'Faith', 'Grief'], postsPerRun: 3, frequency: 'daily', timeOfDay: '07:00' });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  sched = c.json;
  assert.equal(sched.publishMode, 'draft'); assert.equal(sched.timezone, 'Africa/Lagos'); assert.equal(sched.notify, false);
  assert.ok(new Date(sched.nextRunAt) > new Date());
  assert.match(sched.summary, /Daily at 07:00 \(Africa\/Lagos\) · 3 posts per run · drafts for review/);

  const run = await call('boss', 'POST', `/admin/api/blog/schedules/${sched.id}/run`);
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(run.json.made, 2); assert.equal(run.json.remaining, 1);
  assert.equal(run.json.run.status, 'running');
  const rows = await q(env, 'SELECT topic, status, source FROM blog_posts WHERE schedule_id = $1 ORDER BY created_at', [sched.id]);
  assert.deepEqual(rows.map((r) => r.topic), ['Prayer', 'Faith']);
  assert.ok(rows.every((r) => r.status === 'draft' && r.source === 'ai'));
  assert.equal((await call('boss', 'GET', '/blog')).text.includes('Prayer for everyday'), false, 'drafts are not public');

  const cron = await runBlogCron(env);
  assert.equal(cron.made, 1);
  const all = await q(env, 'SELECT topic FROM blog_posts WHERE schedule_id = $1 ORDER BY created_at', [sched.id]);
  assert.deepEqual(all.map((r) => r.topic), ['Prayer', 'Faith', 'Grief']);
  const runs = (await call('boss', 'GET', '/admin/api/blog/runs')).json.items;
  assert.equal(runs[0].status, 'success'); assert.equal(runs[0].made, 3); assert.equal(runs[0].trigger, 'manual'); assert.equal(runs[0].postIds.length, 3);
  // the next run continues the rotation
  await call('boss', 'POST', `/admin/api/blog/schedules/${sched.id}/run`);
  const next = await q(env, 'SELECT topic FROM blog_posts WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 2', [sched.id]);
  assert.deepEqual(next.map((r) => r.topic).reverse(), ['Prayer', 'Faith']);
  await runBlogCron(env); // finish it
});

test('cron starts a due schedule exactly once and moves next_run_at forward', async () => {
  const c = await call('boss', 'POST', '/admin/api/blog/schedules', { name: 'Weekly', topics: ['Youth'], postsPerRun: 1, frequency: 'weekly', weekdays: [0, 3], timeOfDay: '09:00' });
  const id = c.json.id;
  await q(env, `UPDATE blog_schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
  const before1 = await one(env, 'SELECT count(*)::int AS n FROM blog_posts WHERE schedule_id = $1', [id]);
  const r1 = await runBlogCron(env);
  assert.equal(r1.started, 1);
  const s = await one(env, 'SELECT * FROM blog_schedules WHERE id = $1', [id]);
  assert.ok(new Date(s.next_run_at) > new Date());
  assert.ok([0, 3].includes(new Date(new Date(s.next_run_at).getTime() + 3600000).getUTCDay()), 'next run on a chosen weekday (Lagos time)');
  assert.equal(s.pending, 0);
  const r2 = await runBlogCron(env);
  assert.equal(r2.started, 0, 'not started twice');
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM blog_posts WHERE schedule_id = $1', [id])).n, before1.n + 1);
  // paused schedules never run
  await call('boss', 'PATCH', `/admin/api/blog/schedules/${id}`, { active: false });
  assert.equal((await one(env, 'SELECT next_run_at FROM blog_schedules WHERE id = $1', [id])).next_run_at, null);
});

test('auto-publish schedule publishes, and queues one notification when the toggle is on', async () => {
  const c = await call('boss', 'POST', '/admin/api/blog/schedules', { name: 'Live', topics: ['Marriage', 'Purpose'], postsPerRun: 2, publishMode: 'publish', notify: true });
  const r = await call('boss', 'POST', `/admin/api/blog/schedules/${c.json.id}/run`);
  assert.equal(r.json.made, 2);
  assert.ok(r.json.posts.every((p) => p.status === 'published'));
  const page = await call(null, 'GET', `/blog/${r.json.posts[0].slug}`);
  assert.equal(page.status, 200);
  const b = await q(env, `SELECT * FROM broadcasts WHERE title LIKE 'New on the blog:%'`);
  assert.equal(b.length, 2);
  assert.equal(b[0].target, 'inbox'); assert.equal(b[0].status, 'scheduled');
  assert.match(b[0].links[0].url, /^http:\/\/api\.test\/blog\//);
  // default schedules (notify off) queue nothing
  const n = await one(env, `SELECT count(*)::int AS n FROM broadcasts`);
  assert.equal(n.n, 2);
});

test('safety: a flagged AI post stays a draft with a review note, even on auto-publish', async () => {
  aiOverride = () => ({ response: article('Faith and the ballot', 'Faith', 'Vote for the party that prays.') });
  const c = await call('boss', 'POST', '/admin/api/blog/schedules', { name: 'Risky', topics: ['Faith'], publishMode: 'publish' });
  const r = await call('boss', 'POST', `/admin/api/blog/schedules/${c.json.id}/run`);
  aiOverride = null;
  assert.equal(r.json.made, 1);
  const p = await one(env, 'SELECT * FROM blog_posts WHERE schedule_id = $1', [c.json.id]);
  assert.equal(p.status, 'draft');
  assert.match(p.review_note, /Held for review: politics/);
  const run = (await call('boss', 'GET', '/admin/api/blog/runs')).json.items[0];
  assert.ok(run.notes.some((x) => /held for review/.test(x)));
});

test('quota error: the slot is kept for the next tick and the run shows the error', async () => {
  aiOverride = () => { throw new Error('3036: You have used up your daily free allocation of 10,000 neurons'); };
  const c = await call('boss', 'POST', '/admin/api/blog/schedules', { name: 'Quota', topics: ['Grief', 'Hope'], postsPerRun: 2 });
  const r = await call('boss', 'POST', `/admin/api/blog/schedules/${c.json.id}/run`);
  assert.equal(r.json.made, 0); assert.equal(r.json.quota, true); assert.equal(r.json.remaining, 2);
  assert.match(r.json.run.error, /daily limit/);
  aiOverride = null;
  await runBlogCron(env);
  const rows = await q(env, 'SELECT topic FROM blog_posts WHERE schedule_id = $1 ORDER BY created_at', [c.json.id]);
  assert.deepEqual(rows.map((x) => x.topic), ['Grief', 'Hope'], 'rotation resumes where it stopped');
  const run = await one(env, 'SELECT status, made FROM blog_runs WHERE schedule_id = $1', [c.json.id]);
  assert.equal(run.status, 'success'); assert.equal(run.made, 2);
});

test('AI disclaimer is a setting (off by default) and only shows on AI posts', async () => {
  const ai = await one(env, `SELECT slug FROM blog_posts WHERE source = 'ai' AND status = 'published' LIMIT 1`);
  assert.equal((await call(null, 'GET', `/blog/${ai.slug}`)).text.includes('prepared with the help of AI'), false);
  const s = await call('boss', 'PUT', '/admin/api/blog/settings', { disclaimer: true });
  assert.equal(s.json.disclaimer, true);
  assert.ok((await call(null, 'GET', `/blog/${ai.slug}`)).text.includes('prepared with the help of AI'));
  assert.equal((await call(null, 'GET', '/blog/walking-by-faith')).text.includes('prepared with the help of AI'), false, 'not on manual posts');
});

test('admin list + preview + delete; courses helper script is on the admin page', async () => {
  const l = await call('boss', 'GET', '/admin/api/blog/posts?status=draft');
  assert.ok(l.json.items.length > 0 && l.json.items.every((p) => p.status === 'draft'));
  assert.ok(l.json.presets.topics.includes('Prayer'));
  const pv = await call('boss', 'POST', '/admin/api/blog/preview', { body: '[[GEN 1:1]]\n\n[[GEN 99:1]]' });
  assert.ok(pv.json.html.includes('KJV GEN 1:1 text.'));
  assert.deepEqual(pv.json.droppedRefs, ['GEN 99:1']);
  assert.equal((await call('boss', 'DELETE', `/admin/api/blog/posts/${draft.id}`)).status, 200);
  assert.equal((await call('boss', 'GET', `/admin/api/blog/posts/${draft.id}`)).status, 404);
  const page = await call(null, 'GET', '/admin');
  assert.ok(page.text.includes("registerAdminTab('Blog'"));
  assert.ok(page.text.includes('data-blog-pick'));
});
