// FEED VIDEO (client #18 / #19 / #29, section 7.1): video posts are part of the general feed, the upload
// probe (codec + faststart), idempotent publish, and the sweep of uploads that never finished. Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q } from '../src/lib/db.js';
import { codecIn, sweepAbandonedUploads } from '../src/lib/videoUploads.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
});

async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array) { b = body; if (!h['Content-Length']) h['Content-Length'] = String(body.byteLength); }
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const pathOf = (u) => new URL(u).pathname;

// Tiny but structurally real MP4s: [size][type][payload] boxes
const enc = (s) => new TextEncoder().encode(s);
function box(type, ...payload) {
  const body = payload.map((p) => (typeof p === 'string' ? enc(p) : p));
  const len = 8 + body.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(enc(type), 4);
  let o = 8;
  body.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out; };
const ftyp = () => box('ftyp', 'isom', new Uint8Array(4), 'isomavc1');
const moov = (sampleEntry) => box('moov', box('mvhd', new Uint8Array(20)), box('trak', box('mdia', box('minf', box('stbl', box('stsd', new Uint8Array(8), box(sampleEntry, new Uint8Array(30)), box('mp4a', new Uint8Array(20))))))));
const mdat = (n = 4000) => box('mdat', new Uint8Array(n).fill(7));

async function uploadMp4(user, bytes, extra = {}) {
  const v = await call(user, 'POST', '/uploads/video', { durationSeconds: 9, width: 720, height: 1280, ...extra });
  assert.equal(v.status, 201);
  const put = await call(user, 'PUT', pathOf(v.json.uploadURL), bytes, { 'Content-Type': 'video/mp4' });
  assert.equal(put.status, 200);
  return { uid: v.json.uid, put: put.json };
}

test('codecIn: picks the video sample entry, ignores audio', () => {
  assert.equal(codecIn(moov('avc1')), 'h264');
  assert.equal(codecIn(moov('hvc1')), 'hevc');
  assert.equal(codecIn(moov('hev1')), 'hevc');
  assert.equal(codecIn(enc('nothing here')), 'other');
  assert.equal(codecIn(null), null);
});

test('probe: faststart H.264 → codec + faststart on the upload and on the post (with its size)', async () => {
  const { uid, put } = await uploadMp4('alice', cat(ftyp(), moov('avc1'), mdat()));
  assert.equal(put.codec, 'h264');
  assert.equal(put.faststart, true);
  assert.deepEqual(put.warnings, []);
  const st = await call('alice', 'GET', `/uploads/video/${uid}`);
  assert.equal(st.json.status, 'ready');
  assert.equal(st.json.codec, 'h264');
  assert.equal((await call('bob', 'GET', `/uploads/video/${uid}`)).status, 403);
  const post = await call('alice', 'POST', '/posts', { kind: 'Video', text: 'Psalm 23 sung', videoUid: uid });
  assert.equal(post.status, 201);
  assert.equal(post.json.video.codec, 'h264');
  assert.equal(post.json.video.faststart, true);
  assert.equal(post.json.video.width, 720);
  assert.equal(post.json.video.height, 1280);
});

test('probe: iPhone-style HEVC with the index at the end is flagged', async () => {
  const { uid, put } = await uploadMp4('alice', cat(ftyp(), mdat(), moov('hvc1')));
  assert.equal(put.codec, 'hevc');
  assert.equal(put.faststart, false);
  assert.ok(put.warnings.includes('HEVC_MAY_NOT_PLAY_ON_ANDROID'));
  assert.ok(put.warnings.includes('NOT_FASTSTART'));
  const post = await call('alice', 'POST', '/posts', { kind: 'Video', text: 'from my iPhone', videoUid: uid });
  assert.equal(post.json.video.codec, 'hevc');
  assert.equal(post.json.video.faststart, false);
});

test('probe: bytes that are not an MP4 still upload, with no codec', async () => {
  const { put } = await uploadMp4('alice', new Uint8Array(3000).fill(1));
  assert.equal(put.status, 'ready');
  assert.equal(put.codec, null);
  assert.equal(put.faststart, null);
});

test('publish is idempotent per video: a retried POST /posts returns the same post', async () => {
  const { uid } = await uploadMp4('alice', cat(ftyp(), moov('avc1'), mdat()));
  const a = await call('alice', 'POST', '/posts', { kind: 'Video', text: 'once', videoUid: uid });
  const b = await call('alice', 'POST', '/posts', { kind: 'Video', text: 'once', videoUid: uid });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(a.json.id, b.json.id);
  const mine = (await call('alice', 'GET', '/feed?limit=50')).json.items.filter((x) => x.video && x.video.uid === uid);
  assert.equal(mine.length, 1, 'no duplicate in the feed');
  await call('alice', 'DELETE', `/posts/${a.json.id}`);
  assert.equal((await call('alice', 'POST', '/posts', { kind: 'Video', text: 'again', videoUid: uid })).json.code, 'VIDEO_USED');
});

test('general feed mixes text, photo and ready video posts (one post model)', async () => {
  const t = await call('carol', 'POST', '/posts', { text: 'Morning prayer ' + Date.now() });
  const { uid } = await uploadMp4('carol', cat(ftyp(), moov('avc1'), mdat()));
  const v = await call('carol', 'POST', '/posts', { kind: 'Video', text: 'Worship clip', videoUid: uid });
  const feed = (await call('dave', 'GET', '/feed?limit=50')).json.items;
  const ids = feed.map((x) => x.id);
  assert.ok(ids.includes(t.json.id), 'text post in the feed');
  assert.ok(ids.includes(v.json.id), 'video post in the same feed');
  const vp = feed.find((x) => x.id === v.json.id);
  assert.equal(vp.video.status, 'ready');
  assert.match(vp.video.url, /\/media\/vid\/.+\.mp4$/);
});

test('sweep: a reservation that never finished is marked abandoned; its post shows an error to the author only', async () => {
  // a post made before its upload finished (older app builds did this), then the app was closed
  const r1 = await call('erin', 'POST', '/uploads/video', { durationSeconds: 30 });
  const mp = await call('erin', 'POST', pathOf(r1.json.multipartURL));
  assert.equal(mp.status, 201);
  const post = await call('erin', 'POST', '/posts', { kind: 'Video', text: 'never finished', videoUid: r1.json.uid });
  assert.equal(post.json.video.status, 'uploading');
  // a reservation with no post at all
  const r2 = await call('erin', 'POST', '/uploads/video', { durationSeconds: 30 });
  // a fresh one that must be left alone
  const r3 = await call('erin', 'POST', '/uploads/video', { durationSeconds: 30 });
  await q(env, `UPDATE video_uploads SET created_at = now() - interval '30 hours' WHERE uid = ANY($1)`, [[r1.json.uid, r2.json.uid]]);

  const res = await sweepAbandonedUploads(env, { olderThanHours: 24 });
  assert.ok(res.abandoned >= 2);
  assert.ok(res.posts >= 1);
  const row = (await q(env, 'SELECT status, multipart_id, abandoned_at FROM video_uploads WHERE uid = $1', [r1.json.uid]))[0];
  assert.equal(row.status, 'abandoned');
  assert.ok(row.multipart_id, 'the multipart id was stored so it could be aborted');
  assert.ok(row.abandoned_at);
  assert.equal((await call('erin', 'GET', `/uploads/video/${r3.json.uid}`)).json.status, 'uploading');
  // the multipart upload was aborted → no more parts
  const part = await call('erin', 'PUT', `${pathOf(r1.json.multipartURL)}/${mp.json.uploadId}/parts/1`, new Uint8Array(10));
  assert.equal(part.json.code, 'PART_FAILED');

  const mine = await call('erin', 'GET', `/posts/${post.json.id}`);
  assert.equal(mine.json.video.status, 'error', 'the author sees it failed (app shows retry)');
  const others = (await call('dave', 'GET', '/feed?limit=50')).json.items.map((x) => x.id);
  assert.ok(!others.includes(post.json.id), 'never shown half-uploaded to others');
  assert.equal((await call('erin', 'POST', '/posts', { kind: 'Video', text: 'x', videoUid: r2.json.uid })).json.code, 'UPLOAD_ABANDONED');
  assert.equal((await call('erin', 'GET', `/uploads/video/${r2.json.uid}`)).json.status, 'abandoned');
});

test('an abandoned upload that finishes late still becomes ready', async () => {
  const r = await call('erin', 'POST', '/uploads/video', { durationSeconds: 5 });
  await q(env, `UPDATE video_uploads SET created_at = now() - interval '48 hours' WHERE uid = $1`, [r.json.uid]);
  await sweepAbandonedUploads(env, { olderThanHours: 24 });
  const put = await call('erin', 'PUT', pathOf(r.json.uploadURL), cat(ftyp(), moov('avc1'), mdat()), { 'Content-Type': 'video/mp4' });
  assert.equal(put.json.status, 'ready');
  assert.equal((await call('erin', 'GET', `/uploads/video/${r.json.uid}`)).json.status, 'ready');
  assert.equal((await call('erin', 'POST', '/posts', { kind: 'Video', text: 'late', videoUid: r.json.uid })).status, 201);
});
