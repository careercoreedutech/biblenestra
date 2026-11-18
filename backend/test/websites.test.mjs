// MEMBER WEBSITES: address checks, preview from the page, review flow, visibility, limits, admin-only routes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { normalizeWebsiteUrl, fetchSiteMeta } from '../src/lib/websites.js';

const PAGE = `<!doctype html><html><head><title>Ignored title</title>
<meta property="og:title" content="Grace &amp; Truth Ministry">
<meta name="description" content="Daily devotionals, sermons and prayer.">
<meta property="og:image" content="/img/cover.jpg">
<link rel="icon" href="https://cdn.gracetruth.org/favicon.png">
</head><body>Hello</body></html>`;

const fetched = [];
async function mockFetch(url) {
  fetched.push(String(url));
  if (String(url).startsWith('https://gracetruth.org')) {
    return new Response(PAGE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return new Response('nope', { status: 404 });
}

let env; const app = createApp();
before(async () => { env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __fetch: mockFetch }; });
async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const ids = {};

test('addresses: https added, http / IP / local / ports refused', () => {
  assert.deepEqual(normalizeWebsiteUrl('gracetruth.org'), { url: 'https://gracetruth.org/', host: 'gracetruth.org' });
  assert.equal(normalizeWebsiteUrl('https://www.GraceTruth.org/about#top').host, 'gracetruth.org');
  assert.equal(normalizeWebsiteUrl('https://www.GraceTruth.org/about#top').url, 'https://www.gracetruth.org/about');
  for (const bad of ['', 'http://gracetruth.org', 'javascript:alert(1)', 'https://127.0.0.1', 'https://localhost', 'https://intranet', 'https://site.local',
    'https://gracetruth.org:8080', 'https://user:pw@gracetruth.org', 'mailto:me@gracetruth.org']) {
    assert.throws(() => normalizeWebsiteUrl(bad), undefined, bad);
  }
});

test('preview: name, description, picture and icon come from the page', async () => {
  const m = await fetchSiteMeta(env, 'https://gracetruth.org/');
  assert.equal(m.title, 'Grace & Truth Ministry');
  assert.equal(m.description, 'Daily devotionals, sermons and prayer.');
  assert.equal(m.image, 'https://gracetruth.org/img/cover.jpg');
  assert.equal(m.icon, 'https://cdn.gracetruth.org/favicon.png');
  const none = await fetchSiteMeta(env, 'https://unknown-site.org/');
  assert.equal(none.title, null);
});

test('add → pending → approved; only approved sites are listed; owner is notified', async () => {
  for (const u of ['boss', 'ann', 'ben']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);

  assert.equal((await call('ann', 'POST', '/websites', { url: 'gracetruth.org' })).json.code, 'NOT_CONFIRMED');
  const add = await call('ann', 'POST', '/websites', { url: 'gracetruth.org', owner: true, category: 'Ministry' });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.status, 'pending');
  assert.equal(add.json.title, 'Grace & Truth Ministry');
  assert.equal(add.json.image, 'https://gracetruth.org/img/cover.jpg');
  assert.equal(add.json.mine, true);
  ids.site = add.json.id;
  assert.equal((await call('ann', 'POST', '/websites', { url: 'https://www.gracetruth.org', owner: true })).status, 409, 'same site twice');
  assert.equal((await call('ann', 'POST', '/websites', { url: 'https://x.org', owner: true, category: 'Nope' })).json.code, 'BAD_CATEGORY');

  assert.equal((await call('ben', 'GET', '/websites')).json.items.length, 0, 'pending sites are not public');
  assert.equal((await call('ann', 'GET', '/websites/mine')).json.items[0].status, 'pending');

  assert.equal((await call('ann', 'GET', '/admin/api/websites')).status, 403);
  assert.equal((await call('ann', 'POST', `/admin/api/websites/${ids.site}/approve`, {})).status, 403);
  const pending = await call('boss', 'GET', '/admin/api/websites?status=pending');
  assert.equal(pending.json.items.length, 1);
  assert.equal(pending.json.items[0].owner.displayName !== undefined, true);
  assert.equal((await call('boss', 'POST', `/admin/api/websites/${ids.site}/approve`, {})).status, 200);

  const list = await call('ben', 'GET', '/websites');
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].url, 'https://gracetruth.org/');
  assert.equal(list.json.items[0].mine, false);
  assert.ok(list.json.categories.includes('Ministry'));
  assert.equal((await call('ben', 'GET', `/users/${ids.ann}/websites`)).json.items.length, 1);
  assert.equal((await call('ben', 'GET', '/websites?category=Church')).json.items.length, 0);

  const note = await one(env, `SELECT * FROM notifications WHERE user_id = $1 AND kind = 'website'`, [ids.ann]);
  assert.equal(note.title, 'Your website is live on Bible Nestra');
  assert.ok(await one(env, `SELECT 1 AS x FROM admin_actions WHERE action = 'website.approve'`));

  await call('ben', 'POST', `/websites/${ids.site}/open`, {});
  assert.equal((await one(env, 'SELECT opens FROM member_websites WHERE id = $1', [ids.site])).opens, 1);
});

test('editing the address sends it back to review; only the owner can edit or remove', async () => {
  assert.equal((await call('ben', 'PATCH', `/websites/${ids.site}`, { title: 'Hacked' })).status, 403);
  const t = await call('ann', 'PATCH', `/websites/${ids.site}`, { title: 'Grace & Truth' });
  assert.equal(t.json.status, 'approved', 'a name change keeps it live');
  const moved = await call('ann', 'PATCH', `/websites/${ids.site}`, { url: 'https://gracetruth.org/new-home' });
  assert.equal(moved.json.status, 'pending', 'a new address needs review again');
  assert.equal((await call('ben', 'GET', '/websites')).json.items.length, 0);
  assert.equal((await call('ben', 'DELETE', `/websites/${ids.site}`)).status, 403);
});

test('reject with a reason, hide, limit of 3, removal', async () => {
  const rej = await call('boss', 'POST', `/admin/api/websites/${ids.site}/reject`, { reason: 'Please add a contact page' });
  assert.equal(rej.json.status, 'rejected');
  assert.equal((await call('ann', 'GET', '/websites/mine')).json.items[0].rejectReason, 'Please add a contact page');

  for (const s of ['one.org', 'two.org', 'three.org']) assert.equal((await call('ben', 'POST', '/websites', { url: s, owner: true })).status, 201, s);
  assert.equal((await call('ben', 'POST', '/websites', { url: 'four.org', owner: true })).json.code, 'TOO_MANY');

  const benSites = (await call('ben', 'GET', '/websites/mine')).json.items;
  await call('boss', 'POST', `/admin/api/websites/${benSites[0].id}/approve`, {});
  assert.equal((await call('ann', 'GET', '/websites')).json.items.length, 1);
  await call('boss', 'POST', `/admin/api/websites/${benSites[0].id}/hide`, {});
  assert.equal((await call('ann', 'GET', '/websites')).json.items.length, 0, 'hidden sites disappear');

  assert.equal((await call('ben', 'DELETE', `/websites/${benSites[1].id}`)).status, 200);
  assert.equal((await call('ben', 'GET', '/websites/mine')).json.items.length, 2);
  const page = await (await app.fetch(new Request('http://api.test/admin'), env)).text();
  assert.ok(page.includes('Member websites'));
});
