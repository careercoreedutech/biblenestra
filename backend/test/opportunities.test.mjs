// OPPORTUNITIES: source adapters (against saved sample responses), the importer, the list API and admin controls.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import {
  SOURCES, importSource, runOpportunityCron, pruneOpportunities, parseRss, parseHumanDate, periodEnd, findDeadline, plain, kindFromWords, _adapters,
} from '../src/lib/opportunities.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'opps');
const fixtureFor = {
  remotive: 'remotive.json', remoteok: 'remoteok.json', jobicy: 'jobicy.json', arbeitnow: 'arbeitnow.json', grantsgov: 'grantsgov.json',
  devpost: 'devpost.json', codeforces: 'codeforces.json', opportunitydesk: 'oppdesk.xml', opportunitiesforyouth: 'ofy.xml', scholars4dev: 'scholars4dev.xml',
};
const calls = [];
// Fake network: answers each source URL with its saved sample; never touches the internet.
const fakeFetch = async (url, init = {}) => {
  calls.push({ url, method: init.method || 'GET' });
  const src = SOURCES.find((s) => s.url === url);
  if (!src) return new Response('nope', { status: 404 });
  if (src.key === 'remoteok' && globalThis.__failRemoteOk) return new Response('busy', { status: 503 });
  return new Response(fs.readFileSync(path.join(FIX, fixtureFor[src.key]), 'utf8'), { status: 200 });
};

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt' };
});
async function call(user, method, p, body) {
  const h = {};
  if (user && user.startsWith('admin_token_')) h.Authorization = `Bearer ${user}`;
  else if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const sql = async (t, p) => { const r = await env.__db.query(t, p); return { rows: Array.isArray(r) ? r : r.rows }; };

test('text helpers: dates, deadlines, html', () => {
  assert.equal(parseHumanDate('January 15, 2027').slice(0, 10), '2027-01-15');
  assert.equal(parseHumanDate('30 November 2026, 23:59 CET').slice(0, 10), '2026-11-30');
  assert.equal(parseHumanDate('no date here'), null);
  assert.equal(periodEnd('Oct 30 - Dec 04, 2026').slice(0, 10), '2026-12-04');
  assert.equal(periodEnd('Nov 30, 2026 - Jan 05, 2027').slice(0, 10), '2027-01-05');
  assert.equal(findDeadline('<p>Deadline: January 15, 2027 Applications are open</p>').slice(0, 10), '2027-01-15');
  assert.equal(plain('<p>Hello&nbsp;<b>world</b> &amp; friends&#8217;</p>'), 'Hello world & friends’');
  assert.equal(kindFromWords(['Africa', 'Scholarships']), 'scholarship');
  assert.equal(kindFromWords(['Conferences']), 'event');
  assert.equal(kindFromWords(['Something else']), 'other');
});

// JOBS FEEDS: the round-2 sources have their own test (jobsFeeds.test.mjs); this file covers the first ten
const FIRST_TEN = SOURCES.filter((s) => fixtureFor[s.key]);
test('every adapter turns its sample into valid listings', () => {
  for (const s of FIRST_TEN) {
    const raw = s.parse(fs.readFileSync(path.join(FIX, fixtureFor[s.key]), 'utf8'));
    const items = s.adapt(raw);
    assert.ok(items.length > 0, `${s.key} produced items`);
    for (const x of items) {
      assert.ok(x.source_id && x.title, `${s.key} id + title`);
      assert.match(x.url, /^https?:\/\//, `${s.key} url`);
      assert.ok(s.kinds.includes(x.kind) || x.kind === 'other' || x.kind === 'job', `${s.key} kind ${x.kind}`);
      assert.ok(!/<[a-z]/i.test(x.excerpt || ''), `${s.key} excerpt has no html`);
    }
  }
  const cf = _adapters.codeforces(JSON.parse(fs.readFileSync(path.join(FIX, 'codeforces.json'), 'utf8')));
  assert.ok(cf.every((x) => x.deadline), 'contests carry their start time as the deadline');
  const rss = parseRss(fs.readFileSync(path.join(FIX, 'oppdesk.xml'), 'utf8'), {});
  assert.equal(rss[0].kind, 'scholarship');
  assert.equal(rss[0].deadline.slice(0, 10), '2027-01-15');
});

test('import: all ten sources load through the fake network, re-import does not duplicate', async () => {
  for (const s of FIRST_TEN) {
    const r = await importSource(env, s.key, { fetchImpl: fakeFetch }); // eslint-disable-line no-await-in-loop
    assert.ok(r.count > 0, `${s.key}: ${JSON.stringify(r)}`);
  }
  const before1 = (await sql('SELECT count(*)::int AS n FROM opportunities')).rows[0].n;
  await importSource(env, 'remotive', { fetchImpl: fakeFetch });
  const after1 = (await sql('SELECT count(*)::int AS n FROM opportunities')).rows[0].n;
  assert.equal(after1, before1, 'upsert, not insert');
  const undated = (await sql('SELECT count(*)::int AS n FROM opportunities WHERE posted_at IS NULL')).rows[0].n;
  assert.equal(undated, 0, 'undated listings get their first-seen time');
  const grantsCall = calls.find((x) => x.url.includes('grants.gov'));
  assert.equal(grantsCall.method, 'POST');
});

test('a failing source is recorded and does not break the others', async () => {
  globalThis.__failRemoteOk = true;
  const r = await importSource(env, 'remoteok', { fetchImpl: fakeFetch });
  globalThis.__failRemoteOk = false;
  assert.match(r.error, /503/);
  const st = (await sql(`SELECT last_error FROM opportunity_sources WHERE key = 'remoteok'`)).rows[0];
  assert.match(st.last_error, /503/);
});

test('cron runs only due sources, a few at a time', async () => {
  await sql(`UPDATE opportunity_sources SET last_run_at = now() - interval '7 hours'`);
  calls.length = 0;
  const r = await runOpportunityCron(env, { fetchImpl: fakeFetch, limit: 3 });
  assert.equal(r.results.length, 3);
  calls.length = 0;
  // JOBS FEEDS: give every source (incl. the round-2 ones never imported here) a fresh run time
  await sql(`INSERT INTO opportunity_sources (key, last_run_at) SELECT k, now() FROM unnest($1::text[]) AS k ON CONFLICT (key) DO UPDATE SET last_run_at = now()`, [SOURCES.map((s) => s.key)]);
  const r2 = await runOpportunityCron(env, { fetchImpl: fakeFetch });
  assert.equal(r2.results.length, 0, 'nothing due right after a run');
  assert.equal(calls.length, 0);
});

test('list API: filters, search, remote, pagination, closed listings hidden', async () => {
  const all = await call('ann', 'GET', '/opportunities?limit=50');
  assert.equal(all.status, 200);
  assert.ok(all.json.items.length > 10);
  const x = all.json.items[0];
  for (const k of ['id', 'kind', 'title', 'url', 'source']) assert.ok(k in x, k);
  assert.ok(x.source.name && x.source.url, 'credit for the source');

  const grants = await call('ann', 'GET', '/opportunities?kind=grant');
  assert.ok(grants.json.items.length > 0 && grants.json.items.every((i) => i.kind === 'grant'));
  const hack = await call('ann', 'GET', '/opportunities?kind=hackathon');
  assert.ok(hack.json.items.every((i) => i.source.key === 'devpost'));

  const remote = await call('ann', 'GET', '/opportunities?remote=1&limit=50');
  assert.ok(remote.json.items.every((i) => i.remote));

  const first = all.json.items.find((i) => i.org);
  const word = first.org.split(/\s+/)[0];
  const found = await call('ann', 'GET', `/opportunities?q=${encodeURIComponent(word)}`);
  assert.ok(found.json.items.some((i) => i.id === first.id), 'search finds by organisation');
  assert.equal((await call('ann', 'GET', '/opportunities?q=%25%25zzzz-nothing')).json.items.length, 0);

  const p1 = await call('ann', 'GET', '/opportunities?limit=5');
  assert.ok(p1.json.hasMore && p1.json.cursor);
  const p2 = await call('ann', 'GET', `/opportunities?limit=5&cursor=${encodeURIComponent(p1.json.cursor)}`);
  assert.equal(p2.json.items.length, 5);
  assert.ok(!p2.json.items.some((i) => p1.json.items.some((j) => j.id === i.id)), 'pages do not overlap');

  await sql(`UPDATE opportunities SET deadline = now() - interval '1 hour' WHERE id = $1`, [first.id]);
  assert.ok(!(await call('ann', 'GET', '/opportunities?limit=50')).json.items.some((i) => i.id === first.id), 'closed listings are hidden');
  assert.equal((await call('ann', 'GET', '/opportunities?kind=bogus')).status, 400);
  assert.equal((await call(null, 'GET', '/opportunities')).status, 401);
});

test('summary: counts per kind and the source credits', async () => {
  const s = await call('ann', 'GET', '/opportunities/summary');
  assert.equal(s.status, 200);
  assert.ok(s.json.kinds.find((k) => k.kind === 'remote').count > 0);
  assert.ok(s.json.kinds.find((k) => k.kind === 'scholarship').count > 0);
  assert.equal(s.json.sources.length, SOURCES.filter((x) => !x.defaultOff && !x.needsEnv).length, 'active sources only (JOBS FEEDS: permission/key-gated ones are off)');
  assert.ok(s.json.updatedAt);
});

test('admin: list sources, switch one off, hide a listing', async () => {
  const admin = (await call(null, 'POST', '/admin/api/login', { username: 'benjamin', password: 'pw-admin' })).json.token;
  assert.equal((await call('ann', 'GET', '/admin/api/opportunity-sources')).status, 403);
  const list = await call(admin, 'GET', '/admin/api/opportunity-sources');
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, SOURCES.length);

  assert.equal((await call(admin, 'PATCH', '/admin/api/opportunity-sources/devpost', { enabled: false })).status, 200);
  assert.equal((await call('ann', 'GET', '/opportunities?kind=hackathon')).json.items.length, 0, 'switched-off source disappears');
  assert.ok(!(await call('ann', 'GET', '/opportunities/summary')).json.sources.some((s) => s.key === 'devpost'));
  await call(admin, 'PATCH', '/admin/api/opportunity-sources/devpost', { enabled: true });

  const any = (await call('ann', 'GET', '/opportunities?limit=1')).json.items[0];
  assert.equal((await call(admin, 'POST', `/admin/api/opportunities/${any.id}/hide`, { hidden: true })).status, 200);
  assert.ok(!(await call('ann', 'GET', '/opportunities?limit=50')).json.items.some((i) => i.id === any.id));
  assert.equal((await call(admin, 'PATCH', '/admin/api/opportunity-sources/nope', { enabled: false })).status, 404);
});

test('prune removes closed and very old listings', async () => {
  await sql(`UPDATE opportunities SET deadline = now() - interval '3 days' WHERE source = 'codeforces'`);
  await sql(`UPDATE opportunities SET deadline = NULL, posted_at = now() - interval '60 days' WHERE source = 'arbeitnow'`);
  const n = await pruneOpportunities(env);
  assert.ok(n > 0);
  const left = (await sql(`SELECT count(*)::int AS n FROM opportunities WHERE source IN ('codeforces','arbeitnow')`)).rows[0].n;
  assert.equal(left, 0);
});
