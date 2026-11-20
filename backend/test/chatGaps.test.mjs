// CHAT GAPS — link preview cards, timed mute, group bans, /g/<code> invite landing page.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { firstLinkUrl } from '../src/lib/linkPreviews.js';

const PAGE = `<!doctype html><html><head><title>Ignored title</title>
<meta property="og:title" content="Sunday Sermon &amp; Notes">
<meta property="og:description" content="Notes from the sermon on Psalm 23.">
<meta property="og:image" content="/img/cover.jpg">
</head><body>hi</body></html>`;
const fetched = [];
async function mockFetch(url) {
  fetched.push(String(url));
  const u = new URL(url);
  if (u.hostname === 'ministry.org') return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (u.hostname === 'short.link' && u.pathname === '/good') return new Response('', { status: 302, headers: { location: 'https://ministry.org/post' } });
  if (u.hostname === 'short.link' && u.pathname === '/evil') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  if (u.hostname === 'slow.org') { await new Promise((r) => { setTimeout(r, 1200); }); return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } }); }
  return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
}

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __fetch: mockFetch };
});
async function raw(user, method, path, { body } = {}) {
  const h = user ? { 'X-Dev-User': user } : {};
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('json')) return { status: res.status, text: await res.text() };
  return { status: res.status, json: await res.json() };
}
const call = (u, m, p, body) => raw(u, m, p, { body });
const send = (u, conv, text, extra = {}) => call(u, 'POST', `/conversations/${conv}/messages`, { kind: 'text', text, clientId: `c_${Math.random()}`, ...extra });
const sql = (text, params) => env.__db.query(text, params);
const ids = {};
let g;

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => { setTimeout(r, 40); });
  }
}

test('setup: grace creates a group with daniel and paul', async () => {
  for (const [u, n] of [['grace', 'Grace'], ['daniel', 'Daniel'], ['paul', 'Paul'], ['ruth', 'Ruth']]) {
    ids[u] = (await call(u, 'GET', '/me')).json.id;
    await call(u, 'PUT', '/me', { displayName: n });
  }
  g = (await call('grace', 'POST', '/conversations/group', { title: 'Choir <Team>', memberIds: [ids.daniel, ids.paul] })).json.id;
  assert.ok(g);
});

// ---------- link previews ----------
test('firstLinkUrl: https only, public hosts, trailing punctuation dropped', () => {
  assert.equal(firstLinkUrl('see https://ministry.org/post, ok'), 'https://ministry.org/post');
  assert.equal(firstLinkUrl('see (https://ministry.org/a?b=1).'), 'https://ministry.org/a?b=1');
  assert.equal(firstLinkUrl('http://ministry.org/post'), null);
  assert.equal(firstLinkUrl('https://127.0.0.1/x'), null);
  assert.equal(firstLinkUrl('https://localhost/x'), null);
  assert.equal(firstLinkUrl('https://ministry.org:8443/x'), null);
  assert.equal(firstLinkUrl('no links here'), null);
});

test('link preview: fetched after sending, attached to the message, cached for the next sender', async () => {
  const t0 = Date.now();
  const r = await send('daniel', g, 'Sermon notes: https://ministry.org/post');
  assert.equal(r.status, 201);
  assert.equal(r.json.linkPreview, null, 'the first send does not wait for the website');
  const card = await waitFor(async () => (await call('paul', 'GET', `/messages/${r.json.id}`)).json.linkPreview);
  assert.ok(card, 'card arrives in the background');
  assert.deepEqual(card, {
    url: 'https://ministry.org/post', title: 'Sunday Sermon & Notes', description: 'Notes from the sermon on Psalm 23.',
    image: 'https://ministry.org/img/cover.jpg', siteName: 'ministry.org',
  });
  assert.ok(Date.now() - t0 < 3000);
  // the thread page carries it too
  const page = (await call('paul', 'GET', `/conversations/${g}/messages?limit=10`)).json.items;
  assert.equal(page.find((m) => m.id === r.json.id).linkPreview.title, 'Sunday Sermon & Notes');
  // a second share of the same link gets the card straight away, without fetching again
  const before = fetched.length;
  const again = await send('paul', g, 'https://ministry.org/post');
  assert.equal(again.json.linkPreview.title, 'Sunday Sermon & Notes');
  assert.equal(fetched.length, before);
});

test('link preview: sending never waits for a slow website', async () => {
  const t0 = Date.now();
  const r = await send('daniel', g, 'https://slow.org/page');
  assert.equal(r.status, 201);
  assert.ok(Date.now() - t0 < 1000, `send took ${Date.now() - t0} ms`);
  assert.equal(r.json.linkPreview, null);
  assert.ok(await waitFor(async () => (await call('daniel', 'GET', `/messages/${r.json.id}`)).json.linkPreview, 4000));
});

test('link preview: redirects are checked hop by hop (no redirect to private addresses)', async () => {
  const good = await send('daniel', g, 'https://short.link/good');
  assert.ok(await waitFor(async () => (await call('daniel', 'GET', `/messages/${good.json.id}`)).json.linkPreview));
  const evil = await send('daniel', g, 'https://short.link/evil');
  await waitFor(async () => (await sql('SELECT status FROM link_previews WHERE url = $1', ['https://short.link/evil']))[0]);
  assert.equal((await sql('SELECT status FROM link_previews WHERE url = $1', ['https://short.link/evil']))[0].status, 'failed');
  assert.ok(!fetched.some((u) => u.includes('127.0.0.1')), 'never fetched the private address');
  assert.equal((await call('daniel', 'GET', `/messages/${evil.json.id}`)).json.linkPreview, null);
  // http links and IPs are never fetched
  const n = fetched.length;
  await send('daniel', g, 'http://ministry.org/insecure and https://10.0.0.1/x');
  await new Promise((r) => { setTimeout(r, 100); });
  assert.equal(fetched.length, n);
});

test('link preview: editing the text moves the card to the new link; Links tab shows the cards', async () => {
  const m = await send('paul', g, 'old https://nowhere.org/x');
  await call('paul', 'PATCH', `/messages/${m.json.id}`, { text: 'fixed https://ministry.org/post' });
  assert.equal((await call('paul', 'GET', `/messages/${m.json.id}`)).json.linkPreview.title, 'Sunday Sermon & Notes');
  const links = (await call('grace', 'GET', `/conversations/${g}/media?type=links`)).json.items;
  const withCard = links.find((x) => x.url === 'https://ministry.org/post');
  assert.equal(withCard.preview.title, 'Sunday Sermon & Notes');
  assert.equal(links.find((x) => x.url === 'https://nowhere.org/x'), undefined, 'edited-away link is gone');
});

test('link preview: a card missing on read is fetched in the background', async () => {
  const m = await send('daniel', g, 'https://ministry.org/later');
  await waitFor(async () => (await sql('SELECT 1 FROM link_previews WHERE url = $1', ['https://ministry.org/later']))[0]);
  await sql('DELETE FROM link_previews WHERE url = $1', ['https://ministry.org/later']);
  assert.equal((await call('daniel', 'GET', `/messages/${m.json.id}`)).json.linkPreview, null);
  await call('daniel', 'GET', `/conversations/${g}/messages?limit=10`);
  assert.ok(await waitFor(async () => (await call('daniel', 'GET', `/messages/${m.json.id}`)).json.linkPreview));
});

// ---------- timed mute ----------
const pushes = async (user) => (await sql(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND data->>'conversationId' = $2`, [ids[user], g]))[0].n;

test('timed mute: 8 hours / 1 week / always; expiry is honoured by pushes and the app', async () => {
  const r = await call('paul', 'PUT', `/conversations/${g}/mute`, { muted: true, duration: '8h' });
  assert.equal(r.status, 200);
  assert.equal(r.json.muted, true);
  const hrs = (Date.parse(r.json.mutedUntil) - Date.now()) / 3600e3;
  assert.ok(hrs > 7.9 && hrs <= 8, `~8h (${hrs})`);
  assert.equal((await call('paul', 'GET', `/conversations/${g}/info`)).json.mutedUntil, r.json.mutedUntil);
  const listed = (await call('paul', 'GET', '/conversations')).json.items.find((c) => c.id === g);
  assert.equal(listed.muted, true);
  assert.equal(listed.mutedUntil, r.json.mutedUntil);

  let n = await pushes('paul');
  await send('daniel', g, 'while muted');
  assert.equal(await pushes('paul'), n, 'muted → no push');
  await send('daniel', g, '@Paul look', { meta: { mentions: [ids.paul] } });
  assert.equal(await pushes('paul'), n + 1, '@mentions still reach a muted member');

  // the mute runs out → pushes come back, the app sees it unmuted, without any cron
  await sql(`UPDATE conversation_members SET muted_until = now() - interval '1 minute' WHERE conversation_id = $1 AND user_id = $2`, [g, ids.paul]);
  n = await pushes('paul');
  await send('daniel', g, 'after expiry');
  assert.equal(await pushes('paul'), n + 1);
  assert.equal((await call('paul', 'GET', `/conversations/${g}/info`)).json.muted, false);
  assert.equal((await call('paul', 'GET', '/conversations')).json.items.find((c) => c.id === g).muted, false);
  // the old toggle treats an expired mute as unmuted → muting again (always)
  assert.equal((await call('paul', 'POST', `/conversations/${g}/mute`)).json.muted, true);
  assert.equal((await call('paul', 'GET', `/conversations/${g}/info`)).json.mutedUntil, null);

  const week = (await call('paul', 'PUT', `/conversations/${g}/mute`, { muted: true, duration: '1w' })).json;
  assert.ok(Math.abs(Date.parse(week.mutedUntil) - Date.now() - 7 * 864e5) < 60e3);
  const always = (await call('paul', 'PUT', `/conversations/${g}/mute`, { muted: true, duration: 'always' })).json;
  assert.deepEqual([always.muted, always.mutedUntil], [true, null]);
  assert.equal((await call('paul', 'PUT', `/conversations/${g}/mute`, { muted: true, duration: '3d' })).json.code, 'BAD_DURATION');
  const off = (await call('paul', 'PUT', `/conversations/${g}/mute`, { muted: false })).json;
  assert.deepEqual([off.muted, off.mutedUntil], [false, null]);
  n = await pushes('paul');
  await send('daniel', g, 'unmuted');
  assert.equal(await pushes('paul'), n + 1);
});

// ---------- bans ----------
let code;
test('bans: "Remove and ban" stops re-joining by link or join request; admins list and unban', async () => {
  code = (await call('grace', 'POST', `/conversations/${g}/invite`)).json.code;
  // members can't ban; admins remove + ban
  assert.equal((await call('paul', 'DELETE', `/conversations/${g}/members/${ids.daniel}?ban=1`)).status, 403);
  const r = await call('grace', 'DELETE', `/conversations/${g}/members/${ids.daniel}?ban=1`);
  assert.deepEqual(r.json, { ok: true, banned: true });
  const preview = (await call('daniel', 'GET', `/invites/${code}`)).json;
  assert.equal(preview.banned, true);
  const join = await call('daniel', 'POST', `/invites/${code}/join`);
  assert.equal(join.status, 403);
  assert.equal(join.json.code, 'BANNED');
  // with admin approval on, a banned person can't even ask
  await call('grace', 'PATCH', `/conversations/${g}/settings`, { approveJoins: true });
  assert.equal((await call('daniel', 'POST', `/invites/${code}/join`)).json.code, 'BANNED');
  assert.equal((await call('grace', 'GET', `/conversations/${g}/requests`)).json.items.length, 0);
  // members (even when all may add) can't bring a banned person back
  await call('grace', 'PATCH', `/conversations/${g}/settings`, { addMembers: 'all', approveJoins: false });
  assert.equal((await call('paul', 'POST', `/conversations/${g}/members`, { userIds: [ids.daniel] })).json.added, 0);
  // Group Info: admins see the count and the list; members don't
  assert.equal((await call('grace', 'GET', `/conversations/${g}/info`)).json.bannedCount, 1);
  assert.equal((await call('paul', 'GET', `/conversations/${g}/info`)).json.bannedCount, 0);
  const bans = (await call('grace', 'GET', `/conversations/${g}/bans`)).json.items;
  assert.deepEqual(bans.map((b) => [b.displayName, b.bannedBy.displayName]), [['Daniel', 'Grace']]);
  assert.equal((await call('paul', 'GET', `/conversations/${g}/bans`)).status, 403);
  assert.equal((await call('paul', 'DELETE', `/conversations/${g}/bans/${ids.daniel}`)).status, 403);
  // unban → the link works again
  assert.equal((await call('grace', 'DELETE', `/conversations/${g}/bans/${ids.daniel}`)).status, 200);
  assert.equal((await call('grace', 'DELETE', `/conversations/${g}/bans/${ids.daniel}`)).status, 404);
  assert.equal((await call('daniel', 'POST', `/invites/${code}/join`)).json.status, 'member');
});

test('bans: plain remove does not ban; an admin adding a banned person lifts the ban', async () => {
  await call('grace', 'DELETE', `/conversations/${g}/members/${ids.daniel}`);
  assert.equal((await call('daniel', 'GET', `/invites/${code}`)).json.banned, false);
  await call('grace', 'POST', `/conversations/${g}/members`, { userIds: [ids.daniel] });
  await call('grace', 'DELETE', `/conversations/${g}/members/${ids.daniel}?ban=1`);
  assert.equal((await call('grace', 'POST', `/conversations/${g}/members`, { userIds: [ids.daniel] })).json.added, 1);
  assert.equal((await call('grace', 'GET', `/conversations/${g}/bans`)).json.items.length, 0);
});

// ---------- invite landing page ----------
test('invite links: /g/<code> landing page opens the app (scheme + Play fallback); /join/<code> too', async () => {
  const inv = (await call('grace', 'POST', `/conversations/${g}/invite`)).json;
  assert.equal(inv.url, `http://api.test/g/${inv.code}`);
  const page = await raw(null, 'GET', `/g/${inv.code}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`biblenestra://join/${inv.code}`));
  assert.ok(page.text.includes('play.google.com/store/apps/details?id=com.biblenestra.app'));
  assert.ok(page.text.includes('intent://join/'), 'Android intent link with store fallback');
  assert.ok(page.text.includes('Choir &lt;Team&gt;'), 'group name is escaped');
  assert.ok(!page.text.includes('Choir <Team>'));
  assert.equal((await raw(null, 'GET', `/join/${inv.code}`)).status, 200);
  assert.equal((await raw(null, 'GET', '/g/doesNotExist1')).status, 404);
  assert.equal((await raw(null, 'GET', '/g/bad<code>')).status, 404);
  // a reset link stops working
  const fresh = (await call('grace', 'POST', `/conversations/${g}/invite`, { reset: true })).json;
  assert.equal((await raw(null, 'GET', `/g/${inv.code}`)).status, 404);
  assert.equal((await raw(null, 'GET', `/g/${fresh.code}`)).status, 200);
});
