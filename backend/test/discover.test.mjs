// DISCOVER TOOLS (round 3): Record (sermon recordings + AI), Reminders, YouTube channels, Admin dashboard.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { pump, NOT_CONFIGURED, BUSY_MESSAGE, adtsSpan } from '../src/lib/sermon-ai.js';
import { detectScriptures } from '../src/lib/scripture.js';
import { parseFeed, parseChannelInput, parseChannelPage } from '../src/lib/youtube.js';

let env; const app = createApp();
const CH_ID = 'UCabcdefghijklmnopqrstuv';
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Grace &amp; Truth Church</title><yt:channelId>${CH_ID}</yt:channelId>
 <entry><id>yt:video:vid00000001</id><yt:videoId>vid00000001</yt:videoId><title>Sunday Service &#8211; Psalm 23</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=vid00000001"/><published>2026-11-01T10:00:00+00:00</published>
  <media:group><media:title>Sunday Service</media:title><media:thumbnail url="https://i1.ytimg.com/vi/vid00000001/hqdefault.jpg" width="480" height="360"/>
  <media:description>Join us &lt;live&gt;</media:description><media:community><media:statistics views="1234"/></media:community></media:group></entry>
 <entry><id>yt:video:short000002</id><yt:videoId>short000002</yt:videoId><title><![CDATA[A 60s devotion]]></title>
  <link rel="alternate" href="https://www.youtube.com/shorts/short000002"/><published>2026-10-30T10:00:00+00:00</published></entry>
</feed>`;
const PAGE = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${CH_ID}"><meta property="og:title" content="Grace &amp; Truth Church"><meta property="og:image" content="https://yt3.ggpht.com/avatar.jpg"></head><body>"canonicalBaseUrl":"/@gracetruth"</body></html>`;
const fetches = [];
async function fakeFetch(url) {
  fetches.push(String(url));
  const u = String(url);
  if (u.includes('/feeds/videos.xml')) return u.includes(CH_ID) ? new Response(RSS, { status: 200 }) : new Response('nope', { status: 404 });
  if (u.includes('@gracetruth') || u.includes(`/channel/${CH_ID}`)) return new Response(PAGE, { status: 200 });
  return new Response('not found', { status: 404 });
}

before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADS_CLIENT_CLAIM: 'true', __fetch: fakeFetch };
});

async function call(user, method, path, body, headers = {}, e = env) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array || typeof body === 'string') b = body;
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  if (b instanceof Uint8Array && !h['Content-Length']) h['Content-Length'] = String(b.length);
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), e);
  const ct = res.headers.get('Content-Type') || '';
  if (ct.startsWith('audio/')) return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(user, id, pred, e = env, tries = 60) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await call(user, 'GET', `/recordings/${id}`, undefined, {}, e);
    if (pred(r.json)) return r.json;
    await sleep(50);
  }
  return r.json;
}

// Synthetic ADTS stream: `frames` frames of `len` bytes at 16 kHz (1024 samples each = 64 ms)
function adts(frames, len = 100) {
  const out = new Uint8Array(frames * len);
  for (let f = 0; f < frames; f++) {
    const p = f * len;
    out[p] = 0xff; out[p + 1] = 0xf1; out[p + 2] = (1 << 6) | (8 << 2); // AAC LC, 16 kHz (index 8)
    out[p + 3] = (len >> 11) & 0x03; out[p + 4] = (len >> 3) & 0xff; out[p + 5] = ((len & 0x07) << 5) | 0x1f; out[p + 6] = 0xfc;
  }
  return out;
}

test('scripture detection + RSS/channel parsing helpers', () => {
  const refs = detectScriptures('Turn to John 3:16, then Romans chapter eight verse twenty-eight and Psalm 23. I had a job once.');
  assert.deepEqual(refs.map((r) => r.ref), ['JHN 3:16', 'ROM 8:28', 'PSA 23']);
  const feed = parseFeed(RSS);
  assert.equal(feed.title, 'Grace & Truth Church');
  assert.equal(feed.videos.length, 2);
  assert.equal(feed.videos[0].title, 'Sunday Service – Psalm 23');
  assert.equal(feed.videos[0].views, 1234);
  assert.equal(feed.videos[1].isShort, true);
  assert.equal(feed.videos[1].title, 'A 60s devotion');
  assert.deepEqual(parseChannelInput(CH_ID), { channelId: CH_ID });
  assert.equal(parseChannelInput('https://www.youtube.com/@gracetruth/videos').handle, 'gracetruth');
  assert.equal(parseChannelInput(`youtube.com/channel/${CH_ID}`).channelId, CH_ID);
  assert.equal(parseChannelInput('https://evil.example/@x'), null);
  assert.equal(parseChannelPage(PAGE).channelId, CH_ID);
  const span = adtsSpan(adts(10), 0, 450);
  assert.equal(span.bytes, 400);
  assert.ok(Math.abs(span.seconds - 0.256) < 1e-9);
});

test('recordings: create, upload, fake transcript + notes, owner-only audio, rename, delete', async () => {
  assert.equal((await call('alice', 'POST', '/recordings', { title: 'Too long', durationSeconds: 3700 })).json.code, 'TOO_LONG');
  assert.equal((await call('alice', 'POST', '/recordings', { title: 'Big', sizeBytes: 60 * 1024 * 1024 })).status, 413);
  const c = await call('alice', 'POST', '/recordings', { title: 'Sunday sermon', speaker: 'Pastor Ade', durationSeconds: 1800 });
  assert.equal(c.status, 201);
  assert.equal(c.json.status, 'uploading');
  assert.ok(c.json.uploadURL.endsWith(`/recordings/${c.json.id}/upload`));
  const id = c.json.id;
  assert.equal((await call('alice', 'PUT', `/recordings/${id}/upload`, new Uint8Array([1, 2, 3]), { 'Content-Type': 'image/png' })).json.code, 'BAD_AUDIO_TYPE');
  assert.equal((await call('bob', 'PUT', `/recordings/${id}/upload`, new Uint8Array([1, 2, 3]), { 'Content-Type': 'audio/m4a' })).status, 404, 'not your recording');
  const audio = new Uint8Array(2000).map((_, i) => i % 251);
  const up = await call('alice', 'PUT', `/recordings/${id}/upload`, audio, { 'Content-Type': 'audio/m4a' });
  assert.equal(up.status, 200);
  assert.equal(up.json.status, 'transcribing');
  const done = await waitFor('alice', id, (r) => r.status === 'ready');
  assert.equal(done.status, 'ready');
  assert.ok(done.segments.length > 5);
  assert.ok(done.segments[1].start > 0 && done.segments[1].end > done.segments[1].start);
  assert.match(done.transcript, /John 3:16/);
  assert.equal(done.notes.label, 'AI-generated — check against the recording');
  assert.ok(done.notes.mainPoints.length >= 2);
  assert.ok(done.notes.prayer.length > 20);
  const refs = done.notes.scriptures.map((s) => s.ref);
  for (const r of ['JHN 3:16', 'ROM 8:28', 'PSA 23', 'PHP 4:6']) assert.ok(refs.includes(r), `${r} detected`);
  // privacy
  assert.equal((await call('bob', 'GET', `/recordings/${id}`)).status, 404);
  assert.equal((await call('bob', 'GET', `/recordings/${id}/audio`)).status, 404);
  assert.equal((await call(null, 'GET', `/recordings/${id}/audio`)).status, 401);
  assert.equal((await call(null, 'GET', `/media/rec/x/${id}.m4a`)).status, 404, 'rec/ keys are never public');
  const full = await call('alice', 'GET', `/recordings/${id}/audio`);
  assert.equal(full.status, 200);
  assert.equal(full.bytes.length, 2000);
  const part = await call('alice', 'GET', `/recordings/${id}/audio`, undefined, { Range: 'bytes=100-199' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Range'), 'bytes 100-199/2000');
  assert.equal(part.bytes[0], 100 % 251);
  // list + rename + retry on ready is a no-op
  const list = await call('alice', 'GET', '/recordings');
  assert.equal(list.json.items[0].id, id);
  assert.equal(list.json.items[0].transcript, undefined, 'list is light');
  assert.equal((await call('alice', 'PATCH', `/recordings/${id}`, { title: '' })).status, 400);
  assert.equal((await call('alice', 'PATCH', `/recordings/${id}`, { title: 'Renamed' })).json.title, 'Renamed');
  assert.equal((await call('bob', 'PATCH', `/recordings/${id}`, { title: 'Mine now' })).status, 404);
  assert.equal((await call('alice', 'POST', `/recordings/${id}/retry`)).json.status, 'ready');
  assert.equal((await call('bob', 'DELETE', `/recordings/${id}`)).status, 404);
  const aliceId = (await call('alice', 'GET', '/me')).json.id;
  assert.ok(await env.MEDIA.head(`rec/${aliceId}/${id}.m4a`), 'stored under rec/<userId>/');
  assert.equal((await call('alice', 'DELETE', `/recordings/${id}`)).status, 200);
  assert.equal((await call('alice', 'GET', `/recordings/${id}`)).status, 404);
  assert.equal(await env.MEDIA.head(`rec/${aliceId}/${id}.m4a`), null, 'audio deleted from R2');
});

test('recordings: production without an AI binding reports a clear error', async () => {
  const c = await call('dora', 'POST', '/recordings', { title: 'No AI' });
  await call('dora', 'PUT', `/recordings/${c.json.id}/upload`, new Uint8Array(500), { 'Content-Type': 'audio/aac' });
  await waitFor('dora', c.json.id, (r) => r.status === 'ready');
  // simulate production: no AI, dev mode off → the background step marks the row with a clear error
  await env.__db.query(`UPDATE recordings SET status = 'transcribing', notes = NULL WHERE id = $1`, [c.json.id]);
  const row = await pump({ ...env, AUTH_DEV_MODE: 'false' }, c.json.id);
  assert.equal(row.status, 'error');
  assert.equal(row.error, NOT_CONFIGURED);
});

test('recordings: real AI path — ADTS chunking with time offsets, notes JSON, quota back-off + retry', async () => {
  const calls = [];
  let failNext = false;
  const AI = {
    async run(model, input) {
      calls.push(model);
      if (model.includes('whisper')) {
        if (failNext) { failNext = false; throw new Error('AiError: 3036: You have used up your daily free allocation of 10,000 neurons'); }
        const n = calls.filter((m) => m.includes('whisper')).length;
        assert.ok(typeof input.audio === 'string' && input.audio.length > 0, 'base64 audio');
        return { text: `part ${n}`, segments: [{ start: 0, end: 1.5, text: n === 1 ? 'Open to John 3:16 with me.' : `Part ${n} of the message.` }] };
      }
      return { response: 'Here you go: {"title":"Love that gives","summary":"God gives.","mainPoints":["Love is personal","Love is costly"],"scriptures":["John 3:16","Hezekiah 9:9"],"quotes":["Grace is free"],"application":["Pray daily"],"prayer":"Lord, thank you."}' };
    },
  };
  const aiEnv = { ...env, AI, TRANSCRIBE_CHUNK_BYTES: '4000' };
  const c = await call('erin', 'POST', '/recordings', { title: 'Chunked', durationSeconds: 12 }, {}, aiEnv);
  failNext = true;
  const audio = adts(100, 100); // 10 kB → 3 chunks of ≤ 4 kB (40 frames = 2.56 s each)
  await call('erin', 'PUT', `/recordings/${c.json.id}/upload`, audio, { 'Content-Type': 'audio/aac' }, aiEnv);
  let r = await waitFor('erin', c.json.id, (x) => x.error, aiEnv, 40);
  assert.equal(r.status, 'transcribing', 'quota keeps the status');
  assert.equal(r.error, BUSY_MESSAGE);
  assert.equal(r.busy, true);
  // the back-off means a GET does not hammer the AI again
  const before = calls.length;
  await call('erin', 'GET', `/recordings/${c.json.id}`, undefined, {}, aiEnv);
  await sleep(100);
  assert.equal(calls.length, before);
  assert.equal((await call('frank', 'POST', `/recordings/${c.json.id}/retry`, undefined, {}, aiEnv)).status, 404);
  const re = await call('erin', 'POST', `/recordings/${c.json.id}/retry`, undefined, {}, aiEnv);
  assert.equal(re.json.error, null);
  r = await waitFor('erin', c.json.id, (x) => x.status === 'ready' || x.status === 'error', aiEnv);
  assert.equal(r.status, 'ready');
  assert.equal(calls.filter((m) => m.includes('whisper')).length, 4, '1 failed + 3 chunks');
  assert.deepEqual(r.segments.map((s) => s.start), [0, 2.6, 5.1]);
  assert.equal(r.notes.title, 'Love that gives');
  assert.deepEqual(r.notes.scriptures.map((s) => s.ref), ['JHN 3:16'], 'invented references are dropped');
  assert.ok(calls.includes('@cf/meta/llama-3.1-8b-instruct-fp8'));
});

test('reminders: bulk + single upsert, validation, ownership, daily verse settings', async () => {
  const id1 = '11111111-1111-4111-8111-111111111111';
  const id2 = '22222222-2222-4222-8222-222222222222';
  const empty = await call('alice', 'GET', '/me/reminders');
  assert.deepEqual(empty.json, { items: [], dailyVerse: { enabled: false, hour: 6, minute: 0 } });
  const put = await call('alice', 'PUT', '/me/reminders', {
    items: [
      { id: id1, purpose: 'Read the Bible', kind: 'bible', hour: 6, minute: 30, repeat: 'daily', target: 'Bible' },
      { id: id2, purpose: 'Study Romans 8', kind: 'study', hour: 20, minute: 0, repeat: 'days', days: [1, 3, 5, 3], target: 'Bible', passage: { bookId: 'ROM', chapter: 8 } },
    ],
    dailyVerse: { enabled: true, hour: 20, minute: 15 },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.items[1].days, [1, 3, 5]);
  assert.deepEqual(put.json.dailyVerse, { enabled: true, hour: 20, minute: 15 });
  assert.equal((await call('alice', 'PUT', `/me/reminders/${id1}`, { purpose: 'Pray', hour: 24, minute: 0 })).status, 400);
  assert.equal((await call('alice', 'PUT', `/me/reminders/${id1}`, { purpose: '', hour: 7, minute: 0 })).status, 400);
  assert.equal((await call('alice', 'PUT', '/me/reminders/not-a-uuid', { purpose: 'x', hour: 7, minute: 0 })).status, 400);
  assert.equal((await call('alice', 'PUT', `/me/reminders/${id1}`, { purpose: 'Once', hour: 7, minute: 0, repeat: 'once' })).status, 400, 'once needs a date');
  const one = await call('alice', 'PUT', `/me/reminders/${id1}`, { purpose: 'Call Mum', kind: 'call', hour: 18, minute: 5, repeat: 'once', date: '2026-12-24', enabled: false });
  assert.equal(one.json.date, '2026-12-24');
  assert.equal(one.json.enabled, false);
  // bob can neither overwrite nor delete alice's reminder
  assert.equal((await call('bob', 'PUT', `/me/reminders/${id1}`, { purpose: 'Hijack', hour: 1, minute: 1 })).status, 404);
  assert.equal((await call('bob', 'PUT', '/me/reminders', { items: [{ id: id1, purpose: 'Hijack', hour: 1, minute: 1 }] })).status, 404);
  assert.equal((await call('bob', 'DELETE', `/me/reminders/${id1}`)).status, 404);
  assert.equal((await call('bob', 'GET', '/me/reminders')).json.items.length, 0);
  const got = await call('alice', 'GET', '/me/reminders');
  assert.deepEqual(got.json.items.map((x) => x.purpose).sort(), ['Call Mum', 'Study Romans 8']);
  assert.equal(got.json.items.find((x) => x.id === id2).passage.bookId, 'ROM');
  assert.equal((await call('alice', 'DELETE', `/me/reminders/${id2}`)).status, 200);
  assert.equal((await call('alice', 'GET', '/me/reminders')).json.items.length, 1);
  assert.equal((await call(null, 'GET', '/me/reminders')).status, 401);
});

test('youtube + admin: role check, add by @handle, public list, RSS videos, edit, hide, delete, audit', async () => {
  const page = await call(null, 'GET', '/admin');
  assert.equal(page.status, 200);
  assert.match(page.json, /Admin dashboard/);
  assert.match(page.json, /registerAdminTab/);
  assert.equal((await call(null, 'GET', '/youtube/channels')).json.items.length, 0);
  assert.equal((await call('alice', 'GET', '/admin/api/me')).json.code, 'NOT_ADMIN');
  assert.equal((await call('alice', 'POST', '/admin/api/youtube/channels', { input: '@gracetruth' })).status, 403);
  assert.equal((await call(null, 'GET', '/admin/api/me')).status, 401);
  await call('root', 'GET', '/me');
  await env.__db.query(`UPDATE users SET role = 'admin' WHERE clerk_id = 'dev_root'`);
  assert.equal((await call('root', 'GET', '/admin/api/me')).json.role, 'admin');
  assert.equal((await call('root', 'POST', '/admin/api/youtube/channels', { input: 'https://example.com/x' })).json.code, 'CHANNEL_NOT_FOUND');
  const add = await call('root', 'POST', '/admin/api/youtube/channels', { input: 'https://www.youtube.com/@gracetruth', category: 'Sermons', featured: true });
  assert.equal(add.status, 201);
  assert.equal(add.json.channelId, CH_ID);
  assert.equal(add.json.title, 'Grace & Truth Church');
  assert.equal(add.json.handle, 'gracetruth');
  assert.equal(add.json.avatarUrl, 'https://yt3.ggpht.com/avatar.jpg');
  assert.equal((await call('root', 'POST', '/admin/api/youtube/channels', { input: CH_ID })).status, 409);
  const pub = await call(null, 'GET', '/youtube/channels');
  assert.equal(pub.json.items.length, 1);
  assert.equal(pub.json.items[0].liveEmbedUrl, `https://www.youtube.com/embed/live_stream?channel=${CH_ID}`);
  const vids = await call(null, 'GET', `/youtube/channels/${add.json.id}/videos`);
  assert.equal(vids.status, 200);
  assert.equal(vids.json.videos[0].videoId, 'vid00000001');
  assert.match(vids.json.videos[0].embedUrl, /^https:\/\/www\.youtube\.com\/embed\/vid00000001/);
  const n = fetches.length;
  await call(null, 'GET', `/youtube/channels/${CH_ID}/videos`);
  assert.equal(fetches.length, n, 'feed is cached');
  assert.equal((await call(null, 'GET', '/youtube/channels/UCzzzzzzzzzzzzzzzzzzzzzz/videos')).status, 404, 'only curated channels');
  const patched = await call('root', 'PATCH', `/admin/api/youtube/channels/${add.json.id}`, { title: 'Grace & Truth', featured: false, sortOrder: 3 });
  assert.equal(patched.json.title, 'Grace & Truth');
  assert.equal((await call('alice', 'PATCH', `/admin/api/youtube/channels/${add.json.id}`, { title: 'x' })).status, 403);
  await call('root', 'PATCH', `/admin/api/youtube/channels/${add.json.id}`, { active: false });
  assert.equal((await call(null, 'GET', '/youtube/channels')).json.items.length, 0, 'hidden channels are not public');
  assert.equal((await call(null, 'GET', `/youtube/channels/${add.json.id}/videos`)).status, 404);
  assert.equal((await call('root', 'GET', '/admin/api/youtube/channels')).json.items.length, 1);
  assert.equal((await call('root', 'DELETE', `/admin/api/youtube/channels/${add.json.id}`)).status, 200);
  const log = await call('root', 'GET', '/admin/api/actions');
  assert.deepEqual(log.json.items.map((a) => a.action).slice(0, 4), ['youtube.delete', 'youtube.update', 'youtube.update', 'youtube.add']);
});

test('admin reports queue: remove post, ban user, dismiss', async () => {
  const post = await call('mallory', 'POST', '/posts', { text: 'Spam spam spam' });
  const post2 = await call('mallory', 'POST', '/posts', { text: 'More spam' });
  await call('carol', 'POST', '/reports', { targetType: 'post', targetId: post.json.id, reason: 'spam' });
  await call('dave', 'POST', '/reports', { targetType: 'post', targetId: post.json.id, reason: 'spam again' });
  await call('carol', 'POST', '/reports', { targetType: 'post', targetId: post2.json.id, reason: 'meh' });
  assert.equal((await call('carol', 'GET', '/admin/api/reports')).status, 403);
  const open = await call('root', 'GET', '/admin/api/reports');
  const rep = open.json.items.find((x) => x.targetId === post.json.id);
  assert.equal(rep.target.text, 'Spam spam spam');
  assert.equal(rep.sameTargetOpen, 2);
  assert.equal((await call('root', 'POST', `/admin/api/reports/${rep.id}/remove`)).status, 200);
  assert.equal((await call('carol', 'GET', `/posts/${post.json.id}`)).status, 404, 'removed post is gone');
  const after = await call('root', 'GET', '/admin/api/reports');
  assert.equal(after.json.items.filter((x) => x.targetId === post.json.id).length, 0, 'all reports on the post resolved');
  const rep2 = after.json.items.find((x) => x.targetId === post2.json.id);
  assert.equal((await call('root', 'POST', `/admin/api/reports/${rep2.id}/ban`)).status, 200);
  assert.equal((await call('mallory', 'GET', '/me')).status, 403, 'banned user is locked out');
  await call('carol', 'POST', '/reports', { targetType: 'post', targetId: post2.json.id, reason: 'again' });
  const rep3 = (await call('root', 'GET', '/admin/api/reports')).json.items.find((x) => x.targetId === post2.json.id);
  assert.equal((await call('root', 'POST', `/admin/api/reports/${rep3.id}/dismiss`)).json.resolution, 'dismissed');
  const resolved = await call('root', 'GET', '/admin/api/reports?status=resolved');
  assert.deepEqual(resolved.json.items.map((x) => x.resolution).sort(), ['banned', 'dismissed', 'removed', 'removed']);
});
