// YOUTUBE LIVE: admin-only channels, live detection (mocked RSS + videos.list), one notification per broadcast,
// preferences respected, and Bible Nestra comments per YouTube video.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { runYouTubeLiveCheck, notifyLive, videoIdFromLink } from '../src/lib/youtubeLive.js';

const CH = 'UCabcdefghijklmnopqrstuv'; // 24 chars
const V = { vod: 'vodAAAAAAA1', up: 'upcBBBBBBB2', live: 'livCCCCCCC3' };

// what the mocked YouTube Data API says about each video right now
const state = {
  [V.vod]: { lbc: 'none' },
  [V.up]: { lbc: 'upcoming', d: { scheduledStartTime: new Date(Date.now() + 3600e3).toISOString() } },
  [V.live]: { lbc: 'live', d: { scheduledStartTime: new Date(Date.now() - 600e3).toISOString(), actualStartTime: new Date(Date.now() - 300e3).toISOString() } },
};
const calls = { api: [], push: 0 };

const rss = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Grace Church</title><yt:channelId>${CH}</yt:channelId>
${Object.values(V).map((id) => `<entry><yt:videoId>${id}</yt:videoId><title>Video ${id}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>2026-11-14T10:00:00+00:00</published></entry>`).join('\n')}
</feed>`;

async function mockFetch(url, opts) {
  const u = String(url);
  if (u.includes('/feeds/videos.xml')) return new Response(rss, { status: 200 });
  if (u.includes('youtube.com/channel/')) return new Response(`<html><link rel="canonical" href="https://www.youtube.com/channel/${CH}"><meta property="og:title" content="Grace Church"></html>`, { status: 200 });
  if (u.startsWith('https://www.googleapis.com/youtube/v3/videos')) {
    const ids = new URL(u).searchParams.get('id').split(',');
    calls.api.push(ids);
    const items = ids.filter((id) => state[id]).map((id) => ({
      id,
      snippet: { title: `Service ${id}`, channelId: CH, channelTitle: 'Grace Church (YT)', liveBroadcastContent: state[id].lbc, thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
      ...(state[id].d ? { liveStreamingDetails: state[id].d } : {}),
    }));
    return new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://exp.host/')) {
    const msgs = JSON.parse(opts.body);
    calls.push += msgs.length;
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }), { status: 200 });
  }
  if (u.startsWith('https://www.youtube.com/oembed')) {
    return new Response(JSON.stringify({ title: 'Sunday Service — Grace Church', author_name: 'Grace Church' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('not mocked', { status: 404 });
}

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __fetch: mockFetch };
});
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
const liveNotes = (userId) => q(env, `SELECT * FROM notifications WHERE user_id = $1 AND kind = 'live' ORDER BY created_at`, [userId]);

test('setup: boss is admin; cal turns live alerts off', async () => {
  for (const u of ['boss', 'ann', 'ben', 'cal']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  assert.equal((await call('ann', 'GET', '/me/notify-settings')).json.live, true, 'live alerts default on');
  const off = await call('cal', 'PUT', '/me/notify-settings', { live: false });
  assert.equal(off.json.live, false);
  await q(env, `INSERT INTO push_tokens (user_id, token) VALUES ($1, 'ExponentPushToken[ann]'), ($2, 'ExponentPushToken[cal]')`, [ids.ann, ids.cal]);
});

test('only admins manage channels and live checks', async () => {
  assert.equal((await call('ann', 'POST', '/admin/api/youtube/channels', { input: CH })).status, 403);
  assert.equal((await call('ann', 'PATCH', '/admin/api/youtube/channels/00000000-0000-0000-0000-000000000000', { active: true })).status, 403);
  assert.equal((await call('ann', 'GET', '/admin/api/youtube/live')).status, 403);
  assert.equal((await call('ann', 'POST', '/admin/api/youtube/live/check', {})).status, 403);
  assert.equal((await call(null, 'POST', '/admin/api/youtube/live/check', {})).status, 401);
  assert.equal((await call('ann', 'POST', '/youtube/channels', { input: CH })).status, 404, 'no user-facing add route');
  const add = await call('boss', 'POST', '/admin/api/youtube/channels', { input: CH, category: 'Live services' });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.channelId, CH);
  assert.equal((await call(null, 'GET', '/youtube/channels')).json.items.length, 1);
});

test('without YOUTUBE_API_KEY detection is skipped and the admin tab says so', async () => {
  const r = await call('boss', 'POST', '/admin/api/youtube/live/check', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.skipped, 'NO_API_KEY');
  assert.equal(calls.api.length, 0);
  const s = await call('boss', 'GET', '/admin/api/youtube/live');
  assert.equal(s.json.apiKey, false);
  assert.equal(s.json.channels.length, 1);
  const page = await (await app.fetch(new Request('http://api.test/admin'), env)).text();
  assert.ok(page.includes('YouTube live') && page.includes('Add a YouTube API key to enable live alerts'));
});

test('detects live + upcoming, notifies everyone once (respecting preferences), pushes', async () => {
  env.YOUTUBE_API_KEY = 'test-key';
  const r = await call('boss', 'POST', '/admin/api/youtube/live/check', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.apiCalls, 1);
  assert.equal(r.json.live, 1);
  assert.equal(r.json.notified, 1);
  assert.deepEqual(calls.api[0].sort(), Object.values(V).sort());

  for (const u of ['boss', 'ann', 'ben']) {
    const n = await liveNotes(ids[u]);
    assert.equal(n.length, 1, u);
    assert.equal(n[0].title, '🔴 LIVE NOW!');
    assert.equal(n[0].body, 'Grace Church is live on Bible Nestra. Join the service now and participate in the broadcast.');
    assert.equal(n[0].data.videoId, V.live);
    assert.equal(n[0].data.action, 'Join live service');
  }
  assert.equal((await liveNotes(ids.cal)).length, 0, 'cal turned live alerts off');
  assert.equal(calls.push, 1, 'only ann’s device (cal opted out)');

  const row = await one(env, 'SELECT * FROM youtube_live WHERE video_id = $1', [V.live]);
  assert.equal(row.status, 'live');
  assert.ok(row.notified_at);
  assert.equal(row.recipients, 3);
  assert.equal(row.push_sent, 1);
  assert.equal((await one(env, 'SELECT status FROM youtube_live WHERE video_id = $1', [V.up])).status, 'upcoming');
  assert.ok(await one(env, 'SELECT 1 AS x FROM youtube_seen_videos WHERE video_id = $1', [V.vod]), 'ordinary video remembered');

  const inbox = await call('ann', 'GET', '/me/notifications');
  assert.equal(inbox.json.items[0].kind, 'live');
  assert.equal(inbox.json.items[0].data.route, 'YouTubeWatch');
});

test('never notifies the same broadcast twice; only new/tracked ids cost quota', async () => {
  const r = await runYouTubeLiveCheck(env, { trigger: 'admin', force: true });
  assert.equal(r.notified, 0);
  assert.deepEqual(calls.api[1].sort(), [V.live, V.up].sort(), 'the ordinary video is not re-checked');
  assert.equal(await notifyLive(env, V.live), null);
  for (const u of ['boss', 'ann', 'ben']) assert.equal((await liveNotes(ids[u])).length, 1);

  // cron right after a check is throttled
  const cron = await runYouTubeLiveCheck(env, { trigger: 'cron' });
  assert.equal(cron.skipped, 'TOO_SOON');
});

test('upcoming goes live → one more notification; ended broadcasts are tracked', async () => {
  state[V.up] = { lbc: 'live', d: { scheduledStartTime: new Date().toISOString(), actualStartTime: new Date().toISOString() } };
  state[V.live] = { lbc: 'none', d: { actualStartTime: new Date(Date.now() - 300e3).toISOString(), actualEndTime: new Date().toISOString() } };
  const r = await runYouTubeLiveCheck(env, { trigger: 'admin', force: true });
  assert.equal(r.notified, 1);
  assert.equal((await one(env, 'SELECT status FROM youtube_live WHERE video_id = $1', [V.live])).status, 'ended');
  assert.equal((await liveNotes(ids.ann)).length, 2);
  await runYouTubeLiveCheck(env, { trigger: 'admin', force: true });
  assert.equal((await liveNotes(ids.ann)).length, 2, 'still two');
  assert.ok(!calls.api[calls.api.length - 1].includes(V.live), 'ended broadcast no longer checked');

  const pub = await call(null, 'GET', '/youtube/live');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.json.items.map((x) => x.videoId), [V.up]);
  const info = await call(null, 'GET', `/youtube/videos/${V.up}`);
  assert.equal(info.json.live, true);
  assert.equal(info.json.broadcast.channelTitle, 'Grace Church');
  assert.equal((await call(null, 'GET', '/youtube/videos/bad')).status, 404);

  const s = await call('boss', 'GET', '/admin/api/youtube/live');
  assert.equal(s.json.apiKey, true);
  assert.equal(s.json.channels[0].live.videoId, V.up);
  assert.equal(s.json.detections.length, 2);
  assert.ok(s.json.runs.length >= 3);
});

test('comments: post, reply (one level), list newest/oldest, like, delete, report, rate limit', async () => {
  const vid = V.up;
  assert.equal((await call(null, 'GET', `/youtube/videos/${vid}/comments`)).status, 401, 'sign in to read/post');
  const a = await call('ann', 'POST', `/youtube/videos/${vid}/comments`, { text: 'Amen! Blessed service' });
  assert.equal(a.status, 201);
  assert.equal(a.json.mine, true);
  const r1 = await call('ben', 'POST', `/youtube/videos/${vid}/comments`, { text: 'Amen', parentId: a.json.id });
  assert.equal(r1.json.parentId, a.json.id);
  const r2 = await call('cal', 'POST', `/youtube/videos/${vid}/comments`, { text: 'Reply to reply', parentId: r1.json.id });
  assert.equal(r2.json.parentId, a.json.id, 'replies stay one level deep');
  const b = await call('boss', 'POST', `/youtube/videos/${vid}/comments`, { text: 'Welcome everyone' });
  assert.equal((await call('ben', 'POST', `/youtube/videos/${vid}/comments`, { text: '   ' })).status, 400);
  assert.equal((await call('ben', 'POST', `/youtube/videos/${V.live}/comments`, { text: 'x', parentId: a.json.id })).status, 404, 'parent must be on the same video');

  const fast = await call('ann', 'POST', `/youtube/videos/${vid}/comments`, { text: 'again' });
  assert.equal(fast.status, 429, 'rate limited');

  const newest = await call('ben', 'GET', `/youtube/videos/${vid}/comments`);
  assert.equal(newest.json.total, 4);
  assert.deepEqual(newest.json.items.map((x) => x.id), [b.json.id, a.json.id]);
  assert.equal(newest.json.items[1].replies.length, 2);
  const oldest = await call('ben', 'GET', `/youtube/videos/${vid}/comments?sort=oldest`);
  assert.deepEqual(oldest.json.items.map((x) => x.id), [a.json.id, b.json.id]);

  const like = await call('ben', 'POST', `/youtube/comments/${a.json.id}/like`, {});
  assert.deepEqual([like.json.liked, like.json.likes], [true, 1]);
  assert.equal((await call('cal', 'POST', `/youtube/comments/${a.json.id}/like`, { liked: true })).json.likes, 2);
  assert.equal((await call('ben', 'GET', `/youtube/videos/${vid}/comments`)).json.items[1].likedByMe, true);
  assert.equal((await call('ben', 'POST', `/youtube/comments/${a.json.id}/like`, {})).json.likes, 1, 'toggle off');

  assert.equal((await call('ben', 'DELETE', `/youtube/comments/${a.json.id}`)).status, 403, 'not yours');
  assert.equal((await call('cal', 'DELETE', `/youtube/comments/${r2.json.id}`)).status, 200, 'own comment');

  assert.equal((await call('ann', 'POST', `/youtube/comments/${a.json.id}/report`, {})).status, 400, 'not your own');
  assert.equal((await call('ben', 'POST', `/youtube/comments/${b.json.id}/report`, { reason: 'spam' })).status, 200);
  const reports = await call('boss', 'GET', '/admin/api/reports');
  const rep = reports.json.items.find((x) => x.targetType === 'youtube_comment');
  assert.ok(rep && rep.target && rep.target.text === 'Welcome everyone');
  assert.equal((await call('boss', 'POST', `/admin/api/reports/${rep.id}/remove`, {})).status, 200);

  assert.equal((await call('boss', 'DELETE', `/youtube/comments/${a.json.id}`)).status, 200, 'admin can delete anyone’s');
  const after = await call('ben', 'GET', `/youtube/videos/${vid}/comments`);
  assert.equal(after.json.total, 0, 'thread and replies gone');
});

test('manual LIVE NOW without an API key: link formats, admin only, once per stream, preferences, push, end, auto-end', async () => {
  delete env.YOUTUBE_API_KEY;
  const M = 'manDDDDDDD4';
  const M2 = 'manEEEEEEE5';
  for (const l of [M, `https://www.youtube.com/watch?v=${M}&t=5`, `https://youtu.be/${M}?si=abc`, `https://youtube.com/live/${M}?feature=share`,
    `m.youtube.com/watch?v=${M}`, `https://www.youtube.com/shorts/${M}`, `https://www.youtube.com/embed/${M}`]) {
    assert.equal(videoIdFromLink(l), M, l);
  }
  for (const l of ['', 'hello', 'https://vimeo.com/123', 'https://www.youtube.com/@grace/live', 'https://youtu.be/short']) assert.equal(videoIdFromLink(l), null, l);

  assert.equal((await call('ann', 'POST', '/admin/api/youtube/live/manual', { channelId: CH, link: M })).status, 403);
  assert.equal((await call(null, 'POST', '/admin/api/youtube/live/manual', { channelId: CH, link: M })).status, 401);
  assert.equal((await call('boss', 'POST', '/admin/api/youtube/live/manual', { channelId: 'UCnotachannelnotachannel', link: M })).json.code, 'UNKNOWN_CHANNEL');
  assert.equal((await call('boss', 'POST', '/admin/api/youtube/live/manual', { channelId: CH, link: 'https://vimeo.com/1' })).json.code, 'BAD_LINK');

  const expected = (await one(env, `SELECT count(*)::int AS n FROM users WHERE NOT banned AND COALESCE(notify->>'live', 'true') <> 'false'`)).n;
  const pushBefore = calls.push;
  const annBefore = (await liveNotes(ids.ann)).length;
  const calBefore = (await liveNotes(ids.cal)).length;
  const r = await call('boss', 'POST', '/admin/api/youtube/live/manual', { channelId: CH, link: `https://youtube.com/live/${M}?feature=share` });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.videoId, M);
  assert.equal(r.json.status, 'live');
  assert.equal(r.json.channelTitle, 'Grace Church');
  assert.equal(r.json.title, 'Sunday Service — Grace Church', 'title from YouTube when none is typed');
  assert.equal(r.json.recipients, expected);
  assert.equal(r.json.pushSent, calls.push - pushBefore);
  assert.ok(r.json.pushSent >= 1, 'ann’s phone');

  const notes = await liveNotes(ids.ann);
  assert.equal(notes.length, annBefore + 1);
  const last = notes[notes.length - 1];
  assert.equal(last.title, '🔴 LIVE NOW!');
  assert.equal(last.body, 'Grace Church is live on Bible Nestra. Join the service now and participate in the broadcast.');
  assert.equal(last.data.videoId, M);
  assert.equal(last.data.route, 'YouTubeWatch');
  assert.equal(last.data.action, 'Join live service');
  assert.equal((await liveNotes(ids.cal)).length, calBefore, 'cal turned live alerts off');
  assert.ok((await call(null, 'GET', '/youtube/live')).json.items.some((x) => x.videoId === M), 'shows as Live now in the app');

  const again = await call('boss', 'POST', '/admin/api/youtube/live/manual', { channelId: CH, link: M, title: 'Again' });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ALREADY_SENT');
  assert.equal((await liveNotes(ids.ann)).length, annBefore + 1, 'never twice');

  const typed = await call('boss', 'POST', '/admin/api/youtube/live/manual', { channelId: CH, link: `https://youtu.be/${M2}`, title: 'Night of Worship' });
  assert.equal(typed.status, 201);
  assert.equal(typed.json.title, 'Night of Worship', 'a typed title wins');

  assert.equal((await call('ann', 'POST', `/admin/api/youtube/live/${M}/end`, {})).status, 403);
  const end = await call('boss', 'POST', `/admin/api/youtube/live/${M}/end`, {});
  assert.equal(end.status, 200);
  assert.equal(end.json.status, 'ended');
  assert.ok(!(await call(null, 'GET', '/youtube/live')).json.items.some((x) => x.videoId === M), 'gone from Live now');
  assert.equal((await call('boss', 'POST', `/admin/api/youtube/live/${M}/end`, {})).status, 404);

  await q(env, `UPDATE youtube_live SET actual_start = now() - interval '7 hours' WHERE video_id = $1`, [M2]);
  const cron = await runYouTubeLiveCheck(env, { trigger: 'cron' });
  assert.equal(cron.skipped, 'NO_API_KEY');
  assert.equal((await one(env, 'SELECT status FROM youtube_live WHERE video_id = $1', [M2])).status, 'ended', 'closes itself after 6 hours');

  assert.ok(await one(env, `SELECT 1 AS x FROM admin_actions WHERE action = 'youtube.live_manual' AND target_id = $1`, [M]), 'audited');
  const page = await (await app.fetch(new Request('http://api.test/admin'), env)).text();
  assert.ok(page.includes('Send a LIVE NOW notification'));
});
