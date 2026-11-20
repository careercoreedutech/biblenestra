// BROADCASTS (brief 11.1 + 7.6): one record → every user's inbox once (+ push, preferences respected, banned skipped),
// idempotency (same key / identical content), batched fan-out that never duplicates, scheduling + daily repeats by the
// cron, read stats (opened, link clicks), Socials posts from the official verified account with pinning.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { readFileSync } from 'node:fs';
import { processBroadcast, runBroadcastCron, zonedToUtc, nextDaily, OFFICIAL_CLERK_ID } from '../src/lib/broadcasts.js';

const pushes = []; // every Expo message the server tried to send
const pages = {
  'https://example.org/study': '<html><head><title>Fallback</title><meta property="og:title" content="Today&#39;s Bible Study"><meta property="og:description" content="Watch now"><meta property="og:image" content="/cover.jpg"></head></html>',
};
async function mockFetch(url, opts) {
  const u = String(url);
  if (u.startsWith('https://exp.host/')) {
    const msgs = JSON.parse(opts.body);
    pushes.push(...msgs);
    return new Response(JSON.stringify({ data: msgs.map((m) => (m.to.includes('dead') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }), { status: 200 });
  }
  if (pages[u]) return new Response(pages[u], { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return new Response('nope', { status: 404 });
}

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __fetch: mockFetch };
});
async function call(user, method, path, body, extraEnv) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) {
    if (body instanceof Uint8Array) { b = body; h['Content-Type'] = 'image/png'; } else { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), extraEnv ? { ...env, ...extraEnv } : env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const ids = {};
const inbox = (u) => q(env, `SELECT * FROM notifications WHERE user_id = $1 AND kind = 'broadcast' ORDER BY created_at`, [ids[u]]);
let k = 0;
const key = () => `test-key-${++k}-${Date.now()}`;

test('setup: boss is admin, dan is banned, cal turned official pushes off', async () => {
  for (const u of ['boss', 'ann', 'ben', 'cal', 'dan']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  await q(env, `UPDATE users SET banned = true WHERE id = $1`, [ids.dan]);
  assert.equal((await call('cal', 'GET', '/me/notify-settings')).json.broadcasts, true, 'on by default');
  assert.equal((await call('cal', 'PUT', '/me/notify-settings', { broadcasts: false })).json.broadcasts, false);
  await q(env, `INSERT INTO push_tokens (user_id, token) VALUES ($1,'ExponentPushToken[ann]'), ($2,'ExponentPushToken[ben]'), ($2,'ExponentPushToken[ben-dead]'),
    ($3,'ExponentPushToken[cal]'), ($4,'ExponentPushToken[dan]')`, [ids.ann, ids.ben, ids.cal, ids.dan]);
});

test('only admins can use the broadcast endpoints', async () => {
  assert.equal((await call('ann', 'GET', '/admin/api/broadcasts')).status, 403);
  assert.equal((await call('ann', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', text: 'hi' })).status, 403);
  assert.equal((await call(null, 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', text: 'hi' })).status, 401);
  const g = await call('boss', 'GET', '/admin/api/broadcasts');
  assert.equal(g.status, 200);
  assert.equal(g.json.sender.name, 'BibleNestra', 'default sender name');
  assert.equal(g.json.audience.users, 4, 'banned dan is not in the audience');
  const named = await call('boss', 'GET', '/admin/api/broadcasts', undefined, { BROADCAST_SENDER_NAME: 'Bible Extra' });
  assert.equal(named.json.sender.name, 'Bible Extra', 'sender name is config');
});

let first;
test('Send now: one record, one inbox entry per user, pushes respect preferences, banned skipped', async () => {
  const k1 = key();
  const r = await call('boss', 'POST', '/admin/api/broadcasts', {
    idempotencyKey: k1, target: 'inbox', title: 'Good morning!', text: 'May God’s grace and favour accompany you today. https://example.org/study',
    links: [{ url: 'https://example.org/study', label: 'Watch now' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  first = { ...r.json, key: k1 };
  assert.equal(r.json.status, 'sent');
  assert.equal(r.json.stats.recipients, 4);
  assert.equal(r.json.links[0].title, 'Today\'s Bible Study', 'link preview from og tags');
  assert.equal(r.json.links[0].image, 'https://example.org/cover.jpg');
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM broadcasts')).n, 1);
  for (const u of ['boss', 'ann', 'ben', 'cal']) assert.equal((await inbox(u)).length, 1, `${u} has it once`);
  assert.equal((await inbox('dan')).length, 0, 'banned user skipped');
  const official = await one(env, 'SELECT id FROM users WHERE clerk_id = $1', [OFFICIAL_CLERK_ID]);
  if (official) assert.equal((await q(env, `SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'broadcast'`, [official.id])).length, 0);
  const n = (await inbox('ann'))[0];
  assert.equal(n.title, 'Good morning!');
  assert.equal(n.data.broadcastId, r.json.id);
  assert.equal(n.data.sender.name, 'BibleNestra');
  assert.equal(n.data.sender.verified, true);
  // pushes: ann + ben (2 tokens, one dead); cal opted out; dan banned
  const to = pushes.map((p) => p.to).sort();
  assert.deepEqual(to, ['ExponentPushToken[ann]', 'ExponentPushToken[ben-dead]', 'ExponentPushToken[ben]']);
  assert.equal(pushes[0].data.kind, 'broadcast');
  assert.equal(pushes[0].title, 'BibleNestra: Good morning!');
  assert.equal(r.json.stats.pushSent, 2);
  assert.equal(r.json.stats.pushFailed, 1);
  assert.equal((await q(env, `SELECT 1 FROM push_tokens WHERE token = 'ExponentPushToken[ben-dead]'`)).length, 0, 'dead token removed');
  // the inbox lists it
  const list = await call('ann', 'GET', '/me/notifications');
  assert.equal(list.json.items.filter((x) => x.kind === 'broadcast').length, 1);
});

test('retry / double click with the same key never sends twice', async () => {
  const body = { idempotencyKey: first.key, target: 'inbox', title: 'Good morning!', text: 'May God’s grace and favour accompany you today. https://example.org/study', links: [{ url: 'https://example.org/study', label: 'Watch now' }] };
  const before = pushes.length;
  const [a, b] = await Promise.all([call('boss', 'POST', '/admin/api/broadcasts', body), call('boss', 'POST', '/admin/api/broadcasts', body)]);
  for (const r of [a, b]) { assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.duplicate, true); assert.equal(r.json.id, first.id); }
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM broadcasts')).n, 1);
  assert.equal((await inbox('ann')).length, 1);
  assert.equal(pushes.length, before, 'no new pushes');
  // same key, different content → refused
  const other = await call('boss', 'POST', '/admin/api/broadcasts', { ...body, text: 'Something else' });
  assert.equal(other.status, 409);
  assert.equal(other.json.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('identical content under a new key within the window is refused', async () => {
  const r = await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', title: 'Good morning!', text: 'May God’s grace and favour accompany you today. https://example.org/study', links: [{ url: 'https://example.org/study', label: 'Watch now' }] });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'DUPLICATE_CONTENT');
  assert.equal((await inbox('ann')).length, 1);
  // …but after the window it can be sent again
  await q(env, `UPDATE broadcasts SET created_at = now() - interval '11 minutes'`);
  const again = await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', title: 'Good morning!', text: 'May God’s grace and favour accompany you today. https://example.org/study', links: [{ url: 'https://example.org/study', label: 'Watch now' }] });
  assert.equal(again.status, 201);
  assert.equal((await inbox('ann')).length, 2);
});

test('validation: empty, bad link, bad media, past schedule', async () => {
  const bad = async (b, code) => { const r = await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), ...b }); assert.equal(r.status, 400, JSON.stringify(r.json)); if (code) assert.equal(r.json.code, code); };
  await bad({ target: 'inbox', text: '' }, 'EMPTY');
  await bad({ target: 'nowhere', text: 'x' }, 'BAD_TARGET');
  await bad({ target: 'inbox', text: 'x', links: [{ url: 'javascript:alert(1)' }] }, 'BAD_LINK');
  await bad({ target: 'inbox', text: 'x', media: [{ type: 'image', key: `img/${ids.ann}/x.png` }] }, 'BAD_IMAGE');
  await bad({ target: 'inbox', text: 'x', media: [{ type: 'video', uid: 'nope' }] }, 'BAD_VIDEO');
  await bad({ target: 'inbox', text: 'x', schedule: { date: '2020-01-01', time: '09:00', timezone: 'UTC' } }, 'IN_THE_PAST');
  await bad({ target: 'inbox', text: 'x', schedule: { date: '2030-01-01', time: '09:00', timezone: 'Mars/Olympus' } }, 'BAD_TIMEZONE');
  const short = await call('boss', 'POST', '/admin/api/broadcasts', { target: 'inbox', text: 'x' });
  assert.equal(short.status, 400, 'idempotency key required');
});

let opened;
test('read stats: opening and link clicks (once per person for opens), only for recipients', async () => {
  opened = first.id;
  const o1 = await call('ann', 'POST', `/broadcasts/${opened}/open`, {});
  assert.equal(o1.status, 200, JSON.stringify(o1.json));
  assert.equal(o1.json.title, 'Good morning!');
  assert.equal(o1.json.sender.verified, true);
  await call('ann', 'POST', `/broadcasts/${opened}/open`, {});
  await call('ben', 'POST', `/broadcasts/${opened}/click`, { url: 'https://example.org/study' }); // click without opening counts as opened
  await call('ben', 'POST', `/broadcasts/${opened}/click`, { url: 'https://example.org/study' });
  assert.equal((await call('dan', 'POST', `/broadcasts/${opened}/open`, {})).status, 403, 'banned');
  const late = (await call('eve', 'GET', '/me')).json.id; // signed up after the broadcast
  assert.ok(late);
  assert.equal((await call('eve', 'POST', `/broadcasts/${opened}/open`, {})).status, 404);
  const g = await call('boss', 'GET', `/admin/api/broadcasts/${opened}`);
  assert.equal(g.json.stats.opened, 2);
  assert.equal(g.json.stats.linkClicks, 2);
  assert.equal(g.json.stats.clickers, 1);
  const n = (await inbox('ann'))[0];
  assert.ok(n.read_at, 'opening marks the inbox entry read');
});

test('batched fan-out: the rest continues in the cron, overlapping workers never duplicate', async () => {
  for (let i = 0; i < 7; i++) await call(`extra${i}`, 'GET', '/me');
  const total = (await one(env, `SELECT count(*)::int AS n FROM users WHERE NOT banned AND clerk_id <> $1`, [OFFICIAL_CLERK_ID])).n;
  const small = { BROADCAST_BATCH: '2', BROADCAST_INLINE_USERS: '2' };
  const r = await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', text: 'Here are two inspiring videos we have uploaded for you today.' }, small);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, 'sending', 'not finished inside the request');
  assert.equal(r.json.stats.recipients, 2);
  // two workers at once (e.g. cron + background) — the lease lets one through, the join table guards the rest
  const e2 = { ...env, ...small };
  const [a, b] = await Promise.all([processBroadcast(e2, r.json.id), processBroadcast(e2, r.json.id)]);
  assert.ok(a.busy || b.busy, 'one worker is refused by the lease');
  await q(env, 'UPDATE broadcasts SET lease_until = NULL WHERE id = $1', [r.json.id]);
  await runBroadcastCron(e2);
  const row = await one(env, 'SELECT * FROM broadcasts WHERE id = $1', [r.json.id]);
  assert.equal(row.status, 'sent');
  assert.equal(row.recipients, total);
  const per = await q(env, `SELECT user_id, count(*)::int AS n FROM notifications WHERE kind = 'broadcast' AND data->>'broadcastId' = $1 GROUP BY user_id`, [r.json.id]);
  assert.equal(per.length, total);
  assert.ok(per.every((x) => x.n === 1), 'nobody got two copies');
  // processing a finished broadcast again does nothing
  const again = await processBroadcast(e2, r.json.id);
  assert.equal(again.busy, true);
});

test('scheduled: converted from the chosen time zone, not sent early, sent by the cron when due', async () => {
  const day = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  const r = await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', text: 'Today’s Bible study is now available. Click here to watch.', schedule: { date: day, time: '07:30', timezone: 'Africa/Lagos' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, 'scheduled');
  assert.equal(r.json.scheduledAt, `${day}T06:30:00.000Z`, 'Lagos is UTC+1');
  const before = (await inbox('ann')).length;
  const cronSrc = readFileSync(new URL('../src/lib/contestCron.js', import.meta.url), 'utf8');
  assert.match(cronSrc, /await runBroadcastCron\(env\)/, 'the 15-minute cron runs the broadcast scheduler');
  await runBroadcastCron(env);
  assert.equal((await inbox('ann')).length, before, 'not sent before it is due');
  await q(env, `UPDATE broadcasts SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [r.json.id]);
  await runBroadcastCron(env);
  assert.equal((await inbox('ann')).length, before + 1);
  const row = await one(env, 'SELECT * FROM broadcasts WHERE id = $1', [r.json.id]);
  assert.equal(row.status, 'sent');
  await runBroadcastCron(env);
  assert.equal((await inbox('ann')).length, before + 1, 'sent once');
});

test('cancel a scheduled broadcast', async () => {
  const day = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  const r = await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', text: 'We have new Christian career opportunities available.', schedule: { date: day, time: '10:00', timezone: 'UTC' } });
  const c1 = await call('boss', 'POST', `/admin/api/broadcasts/${r.json.id}/cancel`, {});
  assert.equal(c1.json.status, 'cancelled');
  await q(env, `UPDATE broadcasts SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [r.json.id]);
  const before = (await inbox('ann')).length;
  await runBroadcastCron(env);
  assert.equal((await inbox('ann')).length, before);
  assert.equal((await call('boss', 'POST', `/admin/api/broadcasts/${r.json.id}/cancel`, {})).status, 400);
});

test('repeat daily: one copy per day, the template moves to the next day', async () => {
  const day = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const r = await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'inbox', text: 'Daily blessing', schedule: { date: day, time: '06:00', timezone: 'UTC', repeatDaily: true } });
  assert.equal(r.json.repeatDaily, true);
  const before = (await inbox('ann')).length;
  await q(env, `UPDATE broadcasts SET scheduled_at = date_trunc('day', now()) + interval '6 hours' - interval '1 day' WHERE id = $1`, [r.json.id]);
  await Promise.all([runBroadcastCron(env), runBroadcastCron(env)]); // overlapping cron runs
  await runBroadcastCron(env);
  assert.equal((await inbox('ann')).length, before + 1, 'one copy');
  const t = await one(env, 'SELECT * FROM broadcasts WHERE id = $1', [r.json.id]);
  assert.equal(t.status, 'scheduled');
  assert.equal(t.occurrences, 1);
  assert.ok(new Date(t.scheduled_at) > new Date(), 'next run is in the future');
  assert.equal(new Date(t.scheduled_at).toISOString().slice(11, 16), '06:00');
  const copies = await q(env, 'SELECT * FROM broadcasts WHERE parent_id = $1', [r.json.id]);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].status, 'sent');
});

test('Socials: post from the official verified account, pinned on top of the feed, unpin', async () => {
  // a normal post first, then the broadcast, then a newer normal post
  await call('ann', 'POST', '/posts', { text: 'Older post' });
  const img = await call('boss', 'POST', '/uploads/image', new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
  assert.equal(img.status, 201);
  const r = await call('boss', 'POST', '/admin/api/broadcasts', {
    idempotencyKey: key(), target: 'socials', title: 'Revival weekend', text: 'Join us this weekend.', pin: true,
    media: [{ type: 'image', key: img.json.key, width: 800, height: 600 }], links: [{ url: 'https://example.org/study' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, 'sent');
  assert.ok(r.json.postId);
  assert.equal(r.json.pinned, true);
  await call('ben', 'POST', '/posts', { text: 'Newer post' });
  const feed = await call('ann', 'GET', '/feed');
  const top = feed.json.items[0];
  assert.equal(top.id, r.json.postId, 'pinned post first');
  assert.equal(top.pinned, true);
  assert.equal(top.author.verified, true);
  assert.equal(top.author.displayName, 'BibleNestra');
  assert.equal(top.images.length, 1);
  assert.ok(top.text.startsWith('Revival weekend'));
  assert.ok(top.text.includes('https://example.org/study'));
  assert.equal(feed.json.items.filter((p) => p.id === r.json.postId).length, 1, 'not repeated in the timeline');
  // a second socials broadcast reuses the same official account
  await call('boss', 'POST', '/admin/api/broadcasts', { idempotencyKey: key(), target: 'socials', text: 'Second announcement' });
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM users WHERE clerk_id = $1', [OFFICIAL_CLERK_ID])).n, 1);
  assert.equal((await inbox('ann')).filter((n) => n.data.broadcastId === r.json.id).length, 0, 'socials broadcasts do not go to inboxes');
  // unpin → back to its place in time
  const un = await call('boss', 'PATCH', `/admin/api/broadcasts/${r.json.id}`, { pinned: false });
  assert.equal(un.json.pinned, false);
  const feed2 = await call('ann', 'GET', '/feed');
  assert.notEqual(feed2.json.items[0].id, r.json.postId);
  assert.ok(feed2.json.items.some((p) => p.id === r.json.postId));
});

test('history lists broadcasts with status and stats', async () => {
  const g = await call('boss', 'GET', '/admin/api/broadcasts');
  assert.ok(g.json.items.length >= 6);
  const s = g.json.items.find((b) => b.id === first.id);
  assert.equal(s.status, 'sent');
  assert.equal(s.stats.recipients, 4);
  assert.equal(s.stats.opened, 2);
  assert.equal((await call('boss', 'GET', '/admin/api/broadcasts?target=socials')).json.items.every((b) => b.target === 'socials'), true);
  assert.equal((await call('boss', 'GET', '/admin/api/broadcasts?target=scheduled')).json.items.every((b) => b.status === 'scheduled'), true);
  const page = await app.fetch(new Request('http://api.test/admin'), env);
  assert.ok((await page.text()).includes("registerAdminTab('Broadcasts'"), 'admin tab registered');
});

test('time zones: DST-safe conversion and next daily run', () => {
  assert.equal(zonedToUtc('2026-07-01', '09:00', 'Europe/London').toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01', '09:00', 'Europe/London').toISOString(), '2026-12-01T09:00:00.000Z');
  assert.equal(zonedToUtc('2026-03-08', '02:30', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z', 'spring-forward gap → 03:30 EDT');
  assert.equal(nextDaily(new Date('2026-03-07T11:00:00Z'), '06:00', 'America/New_York', new Date('2026-03-07T12:00:00Z')).toISOString(), '2026-03-08T10:00:00.000Z', 'keeps 06:00 local across DST');
});
