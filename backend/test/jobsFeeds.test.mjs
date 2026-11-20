// JOBS FEEDS (round 2): the new importers (mocked network only), dedupe, expiry, attribution, Africa tagging,
// key-gated and permission-gated sources, the list filters and the Job & Academic Directory.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { SOURCES, sourceByKey, importSource, runOpportunityCron, pruneOpportunities, openToFrom, madgex } from '../src/lib/opportunities.js';
import { DIRECTORY, CATEGORIES } from '../src/lib/jobsDirectory.js';

// Any real network call from this file is a bug
globalThis.fetch = async (u) => { throw new Error(`live network call in a test: ${u}`); };

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'jobs');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// URL prefix → sample file. Anything else answers 404, and nothing here ever reaches the internet.
const ROUTES = [
  ['https://himalayas.app/jobs/api/search?country=Nigeria&page=1', 'himalayas-p1.json'],
  ['https://himalayas.app/jobs/api/search?country=Nigeria&page=2', 'himalayas-p2.json'],
  ['https://himalayas.app/jobs/api/search?country=Nigeria&page=3', 'himalayas-p3.json'],
  ['https://www.workingnomads.com/api/exposed_jobs/', 'workingnomads.json'],
  ['https://weworkremotely.com/remote-jobs.rss', 'wwr.xml'],
  ['https://www.myjobmag.com/jobsxml_by_categories.xml', 'myjobmag.xml'],
  ['https://www.hotnigerianjobs.com/feed/rss.xml', 'hotnigerianjobs.xml'],
  ['https://www.jobzilla.ng/feed', 'jobzilla.xml'],
  ['https://api.ashbyhq.com/posting-api/job-board/andela', 'andela.json'],
  ['https://api.ashbyhq.com/posting-api/job-board/mercor', 'mercor.json'],
  ['https://boards-api.greenhouse.io/v1/boards/turing/', 'turing.json'],
  ['https://boards-api.greenhouse.io/v1/boards/invisibletech/', 'invisible.json'],
  ['https://api.lever.co/v0/postings/weloglobal', 'welodata.json'],
  ['https://academicjobsonline.org/ajo?joblist', 'ajo.xml'],
  ['https://cscuk.fcdo.gov.uk/wp-json/wp/v2/cscukscholarships', 'cscuk.json'],
  ['https://www.timeshighereducation.com/unijobs/jobsrss/', 'madgex.xml'],
  ['https://jobs.chronicle.com/jobsrss/', 'madgex.xml'],
  ['https://www.nature.com/naturecareers/jobsrss/', 'madgex.xml'],
  ['https://jobs.sciencecareers.org/jobsrss/', 'madgex.xml'],
  ['https://academiccareers.com/feeds/rss.xml', 'academiccareers.xml'],
  ['https://ng.jooble.org/api/', 'jooble.json'],
  ['https://www.freelancer.com/api/projects/0.1/projects/active/', 'freelancer.json'],
];
const NEW_KEYS = ['himalayas', 'workingnomads', 'myjobmag', 'hotnigerianjobs', 'jobzilla', 'andela', 'turing', 'welodata', 'mercor', 'invisible', 'academicjobsonline', 'cscuk'];
const GATED = ['weworkremotely', 'timeshighered', 'chronicle', 'academiccareers', 'naturecareers', 'sciencecareers'];
const KEYED = ['jooble', 'freelancer'];
const calls = [];
const fakeFetch = async (url, init = {}) => {
  calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  const hit = ROUTES.find(([p]) => url.startsWith(p));
  if (!hit) return new Response('nope', { status: 404 });
  if (url.includes('jooble') && globalThis.__joobleDown) return new Response('limit', { status: 429 });
  return new Response(read(hit[1]), { status: 200 });
};
const fixtureForKey = (key) => {
  const s = sourceByKey(key);
  const urls = s.request ? [].concat(s.request({ JOOBLE_API_KEY: 'k', FREELANCER_OAUTH_TOKEN: 't' })).map((r) => r.url) : s.urls || [s.url];
  return urls.map((u) => ROUTES.find(([p]) => u.startsWith(p))[1]);
};

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt', __fetch: fakeFetch };
});
async function call(user, method, p, body, e = env) {
  const h = {};
  if (user && user.startsWith('admin_token_')) h.Authorization = `Bearer ${user}`;
  else if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), e);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json };
}
const sql = async (t, p) => { const r = await env.__db.query(t, p); return Array.isArray(r) ? r : r.rows; };
const count = async (where, p) => (await sql(`SELECT count(*)::int AS n FROM opportunities WHERE ${where}`, p))[0].n;
let adminToken;
const admin = async () => adminToken || (adminToken = (await call(null, 'POST', '/admin/api/login', { username: 'benjamin', password: 'pw-admin' })).json.token);

test('config: every new source has a category, a site to credit, and a sample', () => {
  for (const key of [...NEW_KEYS, ...GATED, ...KEYED]) {
    const s = sourceByKey(key);
    assert.ok(s, key);
    assert.ok(CATEGORIES.some((c) => c.id === s.category), `${key} category`);
    assert.match(s.site, /^https:\/\//, `${key} site`);
    assert.ok(fixtureForKey(key).length, `${key} sample`);
  }
  for (const k of GATED) assert.ok(sourceByKey(k).defaultOff, `${k} is off until permission`);
  assert.equal(sourceByKey('jooble').needsEnv, 'JOOBLE_API_KEY');
  assert.equal(sourceByKey('freelancer').needsEnv, 'FREELANCER_OAUTH_TOKEN');
  for (const s of SOURCES) assert.ok(s.category, `${s.key} has a category`);
});

test('parsing: each adapter turns its sample into clean, credited listings', () => {
  for (const key of [...NEW_KEYS, ...GATED, ...KEYED]) {
    const s = sourceByKey(key);
    const items = fixtureForKey(key).flatMap((f) => s.adapt(s.parse(read(f))));
    assert.ok(items.length > 0, `${key} produced items`);
    for (const x of items) {
      assert.ok(x.source_id && x.title, `${key} id + title`);
      assert.match(x.url, /^https:\/\//, `${key} links to the original posting`);
      assert.ok(s.kinds.includes(x.kind), `${key} kind ${x.kind}`);
      assert.ok(!/<[a-z]/i.test(x.excerpt || ''), `${key} excerpt has no html`);
      assert.ok([null, 'nigeria', 'africa', 'worldwide'].includes(x.open_to ?? null), `${key} open_to ${x.open_to}`);
    }
  }
  const pick = (key, i = 0, f) => { const s = sourceByKey(key); return s.adapt(s.parse(read(f || fixtureForKey(key)[0])))[i]; };
  // Himalayas: empty restrictions = worldwide; Nigeria listed = nigeria; apply link is applicationLink; expiry kept
  const h0 = pick('himalayas', 0); const h1 = pick('himalayas', 1);
  assert.equal(h0.open_to, 'worldwide'); assert.equal(h0.location, 'Worldwide');
  assert.equal(h1.open_to, 'nigeria');
  assert.match(h0.url, /utm_source=api/);
  assert.equal(h0.salary, 'USD 40,000 – 60,000 / year');
  assert.ok(h0.deadline.startsWith('2099'));
  assert.equal(pick('himalayas', 1, 'himalayas-p2.json').kind, 'internship');
  assert.equal(pick('himalayas', 1, 'himalayas-p2.json').open_to, 'africa');
  // Working Nomads: id from the URL, Global → worldwide, "USA only" → unknown
  assert.equal(pick('workingnomads', 0).source_id, '2033949');
  assert.equal(pick('workingnomads', 0).open_to, 'worldwide');
  assert.equal(pick('workingnomads', 1).open_to, null);
  // Nigerian feeds
  const mj = pick('myjobmag', 0);
  assert.equal(mj.source_id, '1393645'); assert.equal(mj.org, 'Dangote Group'); assert.equal(mj.location, 'Lagos, Nigeria');
  assert.equal(mj.open_to, 'nigeria'); assert.ok(mj.deadline.startsWith('2099')); assert.match(mj.excerpt, /Café/);
  assert.equal(pick('myjobmag', 1).kind, 'internship'); assert.equal(pick('myjobmag', 1).location, 'Nigeria');
  const hn = pick('hotnigerianjobs', 0);
  assert.equal(hn.source_id, '994236'); assert.equal(hn.location, 'Ibadan, Oyo State, Nigeria'); assert.match(hn.org, /AALI/);
  assert.equal(pick('hotnigerianjobs', 1).title, 'Remote Customer Service Rep at Kuda & Co');
  assert.equal(pick('hotnigerianjobs', 1).kind, 'remote');
  const jz = pick('jobzilla', 0);
  assert.equal(jz.source_id, '353558'); assert.equal(jz.org, 'Royal Resource Management Company');
  assert.match(jz.posted_at, /^2026-11-18T12:/, 'Lagos time (UTC+1) → UTC');
  assert.equal(pick('jobzilla', 1).kind, 'internship');
  // ATS boards
  assert.equal(pick('turing', 1).open_to, 'africa'); assert.equal(pick('turing', 1).kind, 'remote');
  assert.equal(pick('invisible', 0).open_to, 'worldwide');
  assert.equal(pick('andela', 0).open_to, 'nigeria'); assert.equal(pick('andela', 0).salary, '$80K - $100K');
  const mercor = sourceByKey('mercor').adapt(JSON.parse(read('mercor.json')));
  assert.deepEqual(mercor.map((x) => x.source_id), ['m-1'], 'Mercor: listed remote roles only');
  assert.equal(pick('welodata', 0).open_to, 'nigeria');
  // academic
  const aj = pick('academicjobsonline', 0);
  assert.equal(aj.source_id, '33495'); assert.equal(aj.org, 'VinUniversity · CECS'); assert.equal(aj.location, 'Hanoi, VN');
  assert.deepEqual(aj.tags, ['Data Science', 'Environmental']); assert.ok(aj.deadline.startsWith('2099'));
  assert.equal(pick('academicjobsonline', 1).open_to, 'nigeria'); assert.equal(pick('academicjobsonline', 1).kind, 'fellowship');
  const mg = madgex(read('madgex.xml'));
  assert.equal(mg[0].org, 'University of Cape Town'); assert.equal(mg[0].title, 'PhD Studentship in Climate Science');
  assert.equal(mg[0].location, 'Cape Town, South Africa'); assert.equal(mg[0].open_to, 'africa'); assert.equal(mg[0].kind, 'scholarship');
  assert.equal(mg[0].source_id, '12866991'); assert.equal(mg[0].salary, 'Funded');
  assert.equal(mg[1].salary, null, '"Competitive salary" is dropped'); assert.equal(mg[1].location, 'Oxford, Oxfordshire');
  assert.equal(pick('academiccareers', 0).location, 'Columbus, Ohio, USA');
  assert.equal(pick('cscuk', 1).kind, 'fellowship'); assert.equal(pick('cscuk', 1).title, 'Commonwealth Startup Fellowships – information for candidates');
  // keyed
  assert.equal(pick('jooble', 0).open_to, 'nigeria'); assert.equal(pick('jooble', 1).kind, 'remote');
  const fl = pick('freelancer', 0);
  assert.equal(fl.url, 'https://www.freelancer.com/projects/web-development/Travel-Agency-Website-Build');
  assert.equal(fl.salary, 'USD 250 – 750 / project');
  assert.equal(new Date(fl.deadline) - new Date(fl.posted_at), 7 * 86400e3, 'bid period → deadline');
});

test('openToFrom: Nigeria / Africa / worldwide / unknown', () => {
  assert.equal(openToFrom('Lagos, Nigeria'), 'nigeria');
  assert.equal(openToFrom('EMEA'), 'africa');
  assert.equal(openToFrom('Anywhere in the World'), 'worldwide');
  assert.equal(openToFrom('Anywhere in the US'), null);
  assert.equal(openToFrom('USA, Canada'), null);
});

test('import: new sources load through the fake network; re-import and repeated pages do not duplicate', async () => {
  for (const key of NEW_KEYS) {
    const r = await importSource(env, key, { fetchImpl: fakeFetch }); // eslint-disable-line no-await-in-loop
    assert.ok(r.count > 0, `${key}: ${JSON.stringify(r)}`);
  }
  assert.equal(calls.filter((c) => c.url.includes('himalayas.app')).length, 3, 'Himalayas: 3 pages');
  assert.equal(await count(`source = 'himalayas'`), 3, 'job repeated on page 2 is stored once');
  const before1 = await count('true');
  await importSource(env, 'myjobmag', { fetchImpl: fakeFetch });
  await importSource(env, 'himalayas', { fetchImpl: fakeFetch });
  assert.equal(await count('true'), before1, 'upsert by source + external id');
  const row = (await sql(`SELECT * FROM opportunities WHERE source = 'myjobmag' AND source_id = '1393645'`))[0];
  assert.equal(row.url, 'https://www.myjobmag.com/a_fields.php?id=1393645', 'original URL kept');
  assert.equal(row.open_to, 'nigeria');
});

test('key-gated sources stay off without keys and never touch the network', async () => {
  calls.length = 0;
  for (const key of KEYED) {
    const r = await importSource(env, key, { fetchImpl: fakeFetch }); // eslint-disable-line no-await-in-loop
    assert.ok(r.skipped && /not set/.test(r.error), key);
  }
  await sql(`UPDATE opportunity_sources SET last_run_at = now() - interval '30 days'`);
  const cron = await runOpportunityCron(env, { fetchImpl: fakeFetch, limit: 100 });
  assert.ok(!cron.results.some((r) => KEYED.includes(r.key)), 'cron skips key-less sources');
  assert.ok(!calls.some((c) => /jooble|freelancer\.com/.test(c.url)), 'no request without a key');
  const s = await call('ann', 'GET', '/opportunities/summary');
  assert.ok(!s.json.sources.some((x) => KEYED.includes(x.key)));
  const adm = await admin();
  const run = await call(adm, 'POST', '/admin/api/opportunity-sources/jooble/run');
  assert.equal(run.status, 400); assert.equal(run.json.code, 'KEY_MISSING');
  const list = (await call(adm, 'GET', '/admin/api/opportunity-sources')).json.items;
  const jo = list.find((x) => x.key === 'jooble');
  assert.equal(jo.hasKey, false); assert.equal(jo.active, false); assert.equal(jo.needsEnv, 'JOOBLE_API_KEY');
});

test('key-gated sources turn on with a key (and the key never leaks into errors)', async () => {
  const keyed = { ...env, JOOBLE_API_KEY: 'secret-key-123', FREELANCER_OAUTH_TOKEN: 'tok-456' };
  calls.length = 0;
  const r = await importSource(keyed, 'jooble', { fetchImpl: fakeFetch });
  assert.equal(r.count, 2);
  const c = calls.find((x) => x.url.includes('jooble'));
  assert.equal(c.method, 'POST');
  assert.equal(c.url, 'https://ng.jooble.org/api/secret-key-123');
  assert.equal(JSON.parse(c.body).location, 'Nigeria');
  const f = await importSource(keyed, 'freelancer', { fetchImpl: fakeFetch });
  assert.equal(f.count, 1);
  assert.equal(calls.find((x) => x.url.includes('freelancer.com')).headers['freelancer-oauth-v1'], 'tok-456');
  const failing = async (url) => { throw new Error(`connect failed for ${url}`); };
  const bad = await importSource(keyed, 'jooble', { fetchImpl: failing });
  assert.ok(bad.error && !bad.error.includes('secret-key-123'), bad.error);
  const st = (await sql(`SELECT last_error FROM opportunity_sources WHERE key = 'jooble'`))[0];
  assert.ok(!st.last_error.includes('secret-key-123'));
  // with the key the listings show; without it they're hidden again
  const withKey = await call('ann', 'GET', '/opportunities?source=jooble', undefined, keyed);
  assert.equal(withKey.json.items.length, 2);
  assert.equal(withKey.json.items[0].source.name, 'Jooble');
  assert.equal((await call('ann', 'GET', '/opportunities?source=jooble')).json.items.length, 0);
});

test('permission-gated sources: never fetched until an admin switches them on', async () => {
  assert.ok(!calls.some((c) => /weworkremotely|nature\.com|sciencecareers|chronicle|timeshighereducation|academiccareers/.test(c.url)));
  const adm = await admin();
  const run = await call(adm, 'POST', '/admin/api/opportunity-sources/naturecareers/run');
  assert.equal(run.status, 400); assert.equal(run.json.code, 'NEEDS_PERMISSION');
  // a cron run (which creates rows for sources it touches) still doesn't switch it on
  await sql(`INSERT INTO opportunity_sources (key) VALUES ('naturecareers') ON CONFLICT DO NOTHING`);
  calls.length = 0;
  await sql(`UPDATE opportunity_sources SET last_run_at = now() - interval '30 days'`);
  await runOpportunityCron(env, { fetchImpl: fakeFetch, limit: 100 });
  assert.ok(!calls.some((c) => c.url.includes('nature.com')));
  // admin switches it on → it runs and shows
  assert.equal((await call(adm, 'PATCH', '/admin/api/opportunity-sources/naturecareers', { enabled: true })).status, 200);
  const r = await call(adm, 'POST', '/admin/api/opportunity-sources/naturecareers/run');
  assert.equal(r.status, 200); assert.equal(r.json.count, 2);
  const items = (await call('ann', 'GET', '/opportunities?source=naturecareers')).json.items;
  assert.equal(items.length, 2);
  assert.equal(items[0].category, 'research');
  await call(adm, 'PATCH', '/admin/api/opportunity-sources/naturecareers', { enabled: false });
  assert.equal((await call('ann', 'GET', '/opportunities?source=naturecareers')).json.items.length, 0);
});

test('list API: category, open-to-Africa and source filters; attribution on every item', async () => {
  const all = await call('ann', 'GET', '/opportunities?limit=50');
  assert.equal(all.status, 200);
  for (const it of all.json.items) {
    assert.ok(it.source.name && it.source.url, 'credit');
    assert.match(it.url, /^https?:\/\//);
    assert.ok('openTo' in it && 'category' in it);
  }
  const af = await call('ann', 'GET', '/opportunities?category=africa&limit=50');
  assert.ok(af.json.items.length >= 6);
  assert.ok(af.json.items.every((i) => ['myjobmag', 'hotnigerianjobs', 'jobzilla'].includes(i.source.key)));
  const ai = await call('ann', 'GET', '/opportunities?category=ai&limit=50');
  assert.ok(ai.json.items.some((i) => i.source.key === 'welodata') && ai.json.items.every((i) => i.category === 'ai'));
  const academic = await call('ann', 'GET', '/opportunities?category=academic&limit=50');
  assert.equal(academic.json.items.length, 1, 'AJO: the listing past its deadline is hidden');
  const open = await call('ann', 'GET', '/opportunities?open=africa&limit=50');
  assert.ok(open.json.items.length > 0 && open.json.items.every((i) => ['nigeria', 'africa', 'worldwide'].includes(i.openTo)));
  const ng = await call('ann', 'GET', '/opportunities?open=nigeria&category=intl&limit=50');
  assert.ok(ng.json.items.every((i) => ['nigeria', 'worldwide'].includes(i.openTo)));
  const remote = await call('ann', 'GET', '/opportunities?open=africa&remote=1&q=engineer');
  assert.ok(remote.json.items.every((i) => i.remote));
  assert.equal((await call('ann', 'GET', '/opportunities?category=nope')).status, 400);
  assert.equal((await call('ann', 'GET', '/opportunities?open=mars')).status, 400);

  const s = await call('ann', 'GET', '/opportunities/summary');
  assert.equal(s.json.categories.length, 8);
  assert.ok(s.json.categories.find((c) => c.id === 'africa').count >= 6);
  assert.ok(s.json.openToAfrica > 0);
  assert.ok(s.json.sources.some((x) => x.key === 'himalayas' && x.category === 'intl'));
  assert.ok(!s.json.sources.some((x) => GATED.includes(x.key)), 'permission-gated sources are not credited while off');
});

test('expiry: per-source age limits, stale listings and passed deadlines are removed', async () => {
  await sql(`UPDATE opportunities SET deadline = NULL, posted_at = now() - interval '35 days' WHERE source = 'jobzilla'`); // max 30 days
  await sql(`UPDATE opportunities SET posted_at = now() - interval '35 days' WHERE source = 'cscuk'`); // evergreen: kept
  await sql(`UPDATE opportunities SET updated_at = now() - interval '25 days' WHERE source = 'turing'`); // dropped from the feed
  const n = await pruneOpportunities(env);
  assert.ok(n > 0);
  assert.equal(await count(`source = 'jobzilla'`), 0);
  assert.equal(await count(`source = 'turing'`), 0);
  assert.equal(await count(`source = 'cscuk'`), 2);
  assert.equal(await count(`source = 'academicjobsonline' AND source_id = '33496'`), 0, 'deadline passed');
  assert.equal(await count(`source = 'academicjobsonline' AND source_id = '33495'`), 1);
});

test('directory: 63 platforms in 8 categories with live flags', async () => {
  assert.equal(DIRECTORY.length, 63);
  assert.equal(new Set(DIRECTORY.map((d) => d.slug)).size, 63, 'unique slugs');
  for (const d of DIRECTORY) {
    assert.match(d.url, /^https:\/\//, d.slug);
    assert.ok(d.description.length > 10 && d.description.length <= 160, `${d.slug} one-line description`);
    for (const k of d.sources) assert.ok(sourceByKey(k), `${d.slug} → ${k}`);
  }
  assert.equal((await call(null, 'GET', '/opportunities/directory')).status, 401);
  const r = await call('ann', 'GET', '/opportunities/directory');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.categories.map((c) => c.id), ['intl', 'africa', 'freelance', 'ai', 'academic', 'research', 'funding', 'earn']);
  assert.deepEqual(r.json.categories.map((c) => c.items.length), [9, 8, 6, 7, 10, 6, 5, 12]);
  assert.equal(r.json.total, 63);
  const find = (slug) => r.json.categories.flatMap((c) => c.items).find((x) => x.slug === slug);
  assert.equal(find('himalayas').live, true); assert.equal(find('himalayas').sourceKey, 'himalayas'); assert.ok(find('himalayas').listings > 0);
  assert.equal(find('jooble').live, false, 'no key → not live');
  assert.equal(find('naturecareers').live, false, 'permission pending → not live');
  assert.equal(find('linkedin').live, false); assert.equal(find('linkedin').url, 'https://www.linkedin.com/jobs/');
  const keyed = await call('ann', 'GET', '/opportunities/directory', undefined, { ...env, JOOBLE_API_KEY: 'k' });
  assert.equal(keyed.json.categories[0].items.find((x) => x.slug === 'jooble').live, true);
});

test('directory admin: edit, hide, add, reset', async () => {
  const adm = await admin();
  assert.equal((await call('ann', 'GET', '/admin/api/opportunity-directory')).status, 403);
  const list = await call(adm, 'GET', '/admin/api/opportunity-directory');
  assert.equal(list.status, 200); assert.equal(list.json.items.length, 63);
  const ed = await call(adm, 'PUT', '/admin/api/opportunity-directory/linkedin', { description: 'Edited line', hidden: false });
  assert.equal(ed.status, 200);
  assert.equal((await call(adm, 'PUT', '/admin/api/opportunity-directory/linkedin', { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call(adm, 'PUT', '/admin/api/opportunity-directory/nope', { name: 'x' })).status, 404);
  await call(adm, 'PUT', '/admin/api/opportunity-directory/newscientist', { hidden: true });
  const add = await call(adm, 'POST', '/admin/api/opportunity-directory', { name: 'Opportunity Desk', url: 'https://opportunitydesk.org', description: 'Scholarships and fellowships for young Africans.', category: 'funding' });
  assert.equal(add.status, 201); assert.equal(add.json.slug, 'opportunity-desk');
  assert.equal((await call(adm, 'POST', '/admin/api/opportunity-directory', { name: 'Opportunity Desk', url: 'https://x.org', category: 'funding' })).status, 400, 'duplicate');
  const app1 = (await call('ann', 'GET', '/opportunities/directory')).json;
  const items = app1.categories.flatMap((c) => c.items);
  assert.equal(items.find((x) => x.slug === 'linkedin').description, 'Edited line');
  assert.ok(!items.some((x) => x.slug === 'newscientist'), 'hidden entry not shown');
  assert.ok(app1.categories.find((c) => c.id === 'funding').items.some((x) => x.slug === 'opportunity-desk'));
  assert.equal((await call(adm, 'DELETE', '/admin/api/opportunity-directory/linkedin')).json.reset, true);
  assert.equal((await call(adm, 'DELETE', '/admin/api/opportunity-directory/opportunity-desk')).json.deleted, true);
  const app2 = (await call('ann', 'GET', '/opportunities/directory')).json.categories.flatMap((c) => c.items);
  assert.equal(app2.find((x) => x.slug === 'linkedin').description, DIRECTORY.find((d) => d.slug === 'linkedin').description);
  const audits = await sql(`SELECT count(*)::int AS n FROM admin_actions WHERE action LIKE 'directory_%'`);
  assert.ok(audits[0].n >= 4);
});
