// TODAY'S JOURNEY: Daily Bread scheduling (verse from the reference, image, reflection, future dates), blessing
// videos (admin upload → publish date → hidden), the auto-highlight flag, and WATCH ON TODAY
// (GET /youtube/latest: mocked RSS feeds, 30-minute DB cache, per-channel options, hidden videos, stale fallback).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q } from '../src/lib/db.js';
import { parseVerseRef, videoIdFrom } from '../src/lib/dailyBread.js';

const CH1 = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const CH2 = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const PL = 'PLxxxxxxxxxxxxxxxxxxxxxx';
const feeds = {
  [CH1]: [['aaaaaaaaaa1', 'Grace for today', '2026-11-18T10:00:00+00:00'], ['aaaaaaaaaa2', 'Quick word', '2026-11-17T10:00:00+00:00', true], ['aaaaaaaaaa3', 'Sunday service', '2026-11-10T10:00:00+00:00']],
  [CH2]: [['bbbbbbbbbb1', 'Worship night', '2026-11-19T08:00:00+00:00']],
  [PL]: [['pppppppppp1', 'Playlist sermon 1', '2026-11-01T08:00:00+00:00']],
};
let feedCalls = 0;
let failFeeds = false;
const rss = (id, list) => `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Feed ${id}</title><yt:channelId>${id}</yt:channelId>
${list.map(([v, t, p, short]) => `<entry><yt:videoId>${v}</yt:videoId><title>${t}</title><link rel="alternate" href="https://www.youtube.com/${short ? `shorts/${v}` : `watch?v=${v}`}"/><published>${p}</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/${v}/hqdefault.jpg" width="480" height="360"/></media:group></entry>`).join('\n')}</feed>`;

async function mockFetch(url) {
  const u = new URL(String(url));
  if (u.pathname === '/feeds/videos.xml') {
    feedCalls += 1;
    if (failFeeds) return new Response('nope', { status: 500 });
    const id = u.searchParams.get('channel_id') || u.searchParams.get('playlist_id');
    return feeds[id] ? new Response(rss(id, feeds[id]), { status: 200 }) : new Response('not found', { status: 404 });
  }
  if (u.pathname.startsWith('/channel/')) {
    const id = u.pathname.split('/')[2];
    return new Response(`<html><link rel="canonical" href="https://www.youtube.com/channel/${id}"><meta property="og:title" content="Channel ${id.slice(2, 4)}"><meta property="og:image" content="https://yt3.example/${id}.jpg"></html>`, { status: 200 });
  }
  return new Response('not mocked', { status: 404 });
}

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __fetch: mockFetch };
});
async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array) { b = body; h['Content-Length'] = String(body.byteLength); }
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ids = {};

test('setup: boss is an admin', async () => {
  for (const u of ['boss', 'ann']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
});

test('verse references are parsed from the Bible book table (text is never typed)', () => {
  assert.deepEqual(parseVerseRef('John 3:16-18'), { bookId: 'JHN', chapter: 3, verse: 16, verseEnd: 18, label: 'John 3:16-18' });
  assert.equal(parseVerseRef('Psalm 23:1').bookId, 'PSA');
  assert.equal(parseVerseRef('Romans 8'), null, 'a verse is required');
  assert.equal(parseVerseRef('Hezekiah 4:2'), null);
  assert.equal(videoIdFrom('https://youtu.be/aaaaaaaaaa1?t=3'), 'aaaaaaaaaa1');
  assert.equal(videoIdFrom('https://www.youtube.com/shorts/aaaaaaaaaa2'), 'aaaaaaaaaa2');
});

test('no Daily Bread scheduled → bread is null (the app falls back to its own verse of the day)', async () => {
  const r = await call(null, 'GET', '/daily/today');
  assert.equal(r.status, 200);
  assert.equal(r.json.bread, null);
  assert.equal(r.json.video, null);
  assert.equal(r.json.flags.autoHighlight, false, 'flag defaults off');
});

test('only admins schedule Daily Bread', async () => {
  assert.equal((await call('ann', 'PUT', `/admin/api/daily/bread/${day(0)}`, { ref: 'Psalm 23:1' })).status, 403);
  assert.equal((await call(null, 'GET', '/admin/api/daily')).status, 401);
});

test('admin schedules today and a future day with an uploaded image; future stays private', async () => {
  const img = await call('boss', 'POST', '/uploads/image', new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { 'Content-Type': 'image/jpeg' });
  assert.equal(img.status, 201);
  const bad = await call('boss', 'PUT', `/admin/api/daily/bread/${day(0)}`, { ref: 'Bread 1:1' });
  assert.equal(bad.json.code, 'BAD_REF');
  assert.equal((await call('boss', 'PUT', `/admin/api/daily/bread/${day(0)}`, { ref: 'Psalm 23:1', imageKey: 'img/../x.jpg' })).json.code, 'BAD_IMAGE');
  const t = await call('boss', 'PUT', `/admin/api/daily/bread/${day(0)}`, { ref: 'psalm 23:1-3', imageKey: img.json.key, reflection: 'The Lord leads.' });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.label, 'Psalm 23:1-3');
  assert.equal(t.json.verseEnd, 3);
  const f = await call('boss', 'PUT', `/admin/api/daily/bread/${day(5)}`, { ref: 'John 3:16' });
  assert.equal(f.json.date, day(5));

  const pub = await call(null, 'GET', `/daily/today?date=${day(0)}`);
  assert.equal(pub.json.bread.ref, 'PSA 23:1-3');
  assert.equal(pub.json.bread.reflection, 'The Lord leads.');
  assert.match(pub.json.bread.imageUrl, /\/media\/img\//);
  assert.equal(pub.json.bread.text, undefined, 'no verse text stored or sent');
  // asking for a date far in the future falls back to the server's date (no peeking ahead)
  assert.equal((await call(null, 'GET', `/daily/today?date=${day(5)}`)).json.bread.ref, 'PSA 23:1-3');

  // editing keeps the image unless it is cleared
  const e = await call('boss', 'PUT', `/admin/api/daily/bread/${day(0)}`, { ref: 'Psalm 23:1' });
  assert.ok(e.json.imageUrl);
  const cleared = await call('boss', 'PUT', `/admin/api/daily/bread/${day(0)}`, { ref: 'Psalm 23:1', imageKey: null });
  assert.equal(cleared.json.imageUrl, null);
  const list = await call('boss', 'GET', '/admin/api/daily');
  assert.deepEqual(list.json.bread.map((b) => b.date), [day(0), day(5)]);
  assert.equal((await call('boss', 'DELETE', `/admin/api/daily/bread/${day(5)}`)).status, 200);
});

test('blessing videos: upload as admin → publish now / later → hide', async () => {
  const up = await call('boss', 'POST', '/uploads/video', { durationSeconds: 42, width: 720, height: 1280 });
  const put = await call('boss', 'PUT', new URL(up.json.uploadURL).pathname, new Uint8Array(2048), { 'Content-Type': 'video/mp4' });
  assert.equal(put.status, 200);
  // ann's upload can't be published by the admin endpoint (and ann isn't an admin anyway)
  assert.equal((await call('ann', 'POST', '/admin/api/daily/videos', { videoUid: up.json.uid, title: 'x' })).status, 403);
  const notReady = await call('boss', 'POST', '/uploads/video', {});
  assert.equal((await call('boss', 'POST', '/admin/api/daily/videos', { videoUid: notReady.json.uid, title: 'x' })).json.code, 'VIDEO_NOT_READY');

  const v1 = await call('boss', 'POST', '/admin/api/daily/videos', { videoUid: up.json.uid, title: 'Morning blessing', description: 'Numbers 6:24' });
  assert.equal(v1.status, 201, JSON.stringify(v1.json));
  assert.equal(v1.json.durationSec, 42);
  assert.equal(v1.json.height, 1280);
  assert.match(v1.json.videoUrl, /\/media\/vid\//);

  const up2 = await call('boss', 'POST', '/uploads/video', { durationSeconds: 30 });
  await call('boss', 'PUT', new URL(up2.json.uploadURL).pathname, new Uint8Array(1024), { 'Content-Type': 'video/mp4' });
  const later = await call('boss', 'POST', '/admin/api/daily/videos', { videoUid: up2.json.uid, title: 'Advent blessing', publishOn: day(10) });
  assert.equal(later.json.publishOn, day(10));

  let pub = await call(null, 'GET', '/daily/videos');
  assert.deepEqual(pub.json.items.map((x) => x.title), ['Morning blessing'], 'scheduled video not shown yet');
  const t = await call(null, 'GET', '/daily/today');
  assert.equal(t.json.video.title, 'Morning blessing');
  assert.equal(t.json.videoCount, 1);

  await call('boss', 'PATCH', `/admin/api/daily/videos/${later.json.id}`, { publishOn: day(0) });
  pub = await call(null, 'GET', '/daily/videos');
  assert.equal(pub.json.items.length, 2);
  await call('boss', 'PATCH', `/admin/api/daily/videos/${v1.json.id}`, { hidden: true });
  pub = await call(null, 'GET', '/daily/videos');
  assert.deepEqual(pub.json.items.map((x) => x.title), ['Advent blessing']);
  assert.equal((await call('boss', 'DELETE', `/admin/api/daily/videos/${later.json.id}`)).status, 200);
  assert.equal((await call(null, 'GET', '/daily/videos')).json.items.length, 0);
});

test('auto-highlight flag is admin-controlled', async () => {
  assert.equal((await call('ann', 'PUT', '/admin/api/daily/settings', { autoHighlight: true })).status, 403);
  assert.equal((await call('boss', 'PUT', '/admin/api/daily/settings', { autoHighlight: true })).json.autoHighlight, true);
  assert.equal((await call(null, 'GET', '/daily/today')).json.flags.autoHighlight, true);
  await call('boss', 'PUT', '/admin/api/daily/settings', { autoHighlight: false });
});

test('Watch on Today: latest videos across channels, cached, new channels show up at once', async () => {
  assert.deepEqual((await call(null, 'GET', '/youtube/latest')).json.items, [], 'no channels yet');
  assert.equal((await call('boss', 'POST', '/admin/api/youtube/channels', { input: CH1 })).status, 201);
  const a = await call(null, 'GET', '/youtube/latest');
  assert.equal(a.status, 200);
  assert.deepEqual(a.json.items.map((v) => v.videoId), ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3']);
  assert.equal(a.json.items[0].channel.channelId, CH1);
  assert.equal(a.json.items[0].channel.avatarUrl, `https://yt3.example/${CH1}.jpg`);
  assert.equal(a.json.items[1].isShort, true);
  const calls = feedCalls;
  await call(null, 'GET', '/youtube/latest');
  assert.equal(feedCalls, calls, 'served from the cache');

  assert.equal((await call('boss', 'POST', '/admin/api/youtube/channels', { input: CH2 })).status, 201);
  const b = await call(null, 'GET', '/youtube/latest?limit=3');
  assert.deepEqual(b.json.items.map((v) => v.videoId), ['bbbbbbbbbb1', 'aaaaaaaaaa1', 'aaaaaaaaaa2'], 'newest first across channels');
  assert.equal(b.json.groups.length, 2);
});

test('Watch on Today: admin options — no Shorts, a playlist, hidden videos, channel off', async () => {
  const chans = (await call('boss', 'GET', '/admin/api/youtube/today')).json.channels;
  const c1 = chans.find((c) => c.channelId === CH1);
  const c2 = chans.find((c) => c.channelId === CH2);
  assert.equal((await call('ann', 'PATCH', `/admin/api/youtube/today/channels/${c1.id}`, { shorts: false })).status, 403);
  await call('boss', 'PATCH', `/admin/api/youtube/today/channels/${c1.id}`, { shorts: false });
  let r = await call(null, 'GET', '/youtube/latest');
  assert.ok(!r.json.items.some((v) => v.videoId === 'aaaaaaaaaa2'), 'shorts left out');

  assert.equal((await call('boss', 'PATCH', `/admin/api/youtube/today/channels/${c2.id}`, { source: 'playlist', playlistId: 'nope' })).json.code, 'BAD_PLAYLIST');
  const pl = await call('boss', 'PATCH', `/admin/api/youtube/today/channels/${c2.id}`, { source: 'playlist', playlistId: `https://www.youtube.com/playlist?list=${PL}` });
  assert.equal(pl.json.playlistId, PL);
  r = await call(null, 'GET', '/youtube/latest');
  assert.ok(r.json.items.some((v) => v.videoId === 'pppppppppp1'));
  assert.ok(!r.json.items.some((v) => v.videoId === 'bbbbbbbbbb1'));

  await call('boss', 'POST', '/admin/api/youtube/today/hidden', { video: 'https://www.youtube.com/watch?v=aaaaaaaaaa1', title: 'Grace for today' });
  r = await call(null, 'GET', '/youtube/latest');
  assert.ok(!r.json.items.some((v) => v.videoId === 'aaaaaaaaaa1'), 'hidden at once (no refresh needed)');
  await call('boss', 'DELETE', '/admin/api/youtube/today/hidden/aaaaaaaaaa1');
  r = await call(null, 'GET', '/youtube/latest');
  assert.ok(r.json.items.some((v) => v.videoId === 'aaaaaaaaaa1'));

  await call('boss', 'PATCH', `/admin/api/youtube/today/channels/${c2.id}`, { showOnToday: false });
  r = await call(null, 'GET', '/youtube/latest');
  assert.ok(r.json.items.every((v) => v.channel.channelId === CH1));
});

test('Watch on Today: a failing YouTube keeps the last good list', async () => {
  failFeeds = true;
  const r = await call('boss', 'POST', '/admin/api/youtube/today/refresh', {});
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 2, 'stale videos kept');
  await q(env, `UPDATE youtube_latest_cache SET fetched_at = now() - interval '31 minutes'`);
  const p = await call(null, 'GET', '/youtube/latest');
  assert.equal(p.status, 200);
  assert.ok(p.json.items.length >= 2);
  failFeeds = false;
});
