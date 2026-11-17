// Long videos: R2 multipart upload through the Worker (parts, retry, complete, abort), the new
// 2 h / 2 GB limits, and HTTP Range playback of a multi-part file. Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { VIDEO_RULES } from '../src/routes/media.js';

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
const MB = 1024 * 1024;
// deterministic bytes so ranges can be checked anywhere in the file
const bytes = (start, len) => { const a = new Uint8Array(len); for (let i = 0; i < len; i++) a[i] = (start + i) % 251; return a; };

test('limits: 2 hours / 2 GB, and the reservation advertises multipart', async () => {
  assert.equal(VIDEO_RULES.maxSeconds, 7200);
  assert.equal(VIDEO_RULES.maxBytes, 2 * 1024 * MB);
  const ok = await call('alice', 'POST', '/uploads/video', { durationSeconds: 3600, sizeBytes: 900 * MB });
  assert.equal(ok.status, 201, 'a one-hour, 900 MB video is accepted');
  assert.equal(ok.json.maxSeconds, 7200);
  assert.equal(ok.json.partSize, VIDEO_RULES.partBytes);
  assert.match(ok.json.multipartURL, /\/uploads\/video\/[a-f0-9]+\/multipart$/);
  assert.equal((await call('alice', 'POST', '/uploads/video', { durationSeconds: 7300 })).json.code, 'TOO_LONG');
  assert.equal((await call('alice', 'POST', '/uploads/video', { sizeBytes: 3 * 1024 * MB })).status, 413);
});

test('multipart: parts (with a retried part) → complete → post plays with Range', async () => {
  const v = await call('alice', 'POST', '/uploads/video', { durationSeconds: 1800, width: 1280, height: 720 });
  const mpPath = pathOf(v.json.multipartURL);
  assert.equal((await call('bob', 'POST', mpPath)).status, 403, 'only the owner can start it');
  const mp = await call('alice', 'POST', mpPath);
  assert.equal(mp.status, 201);
  const { uploadId } = mp.json;
  assert.ok(uploadId);
  const partSize = 5 * MB; // the minimum R2 allows (the app uses partSize from the server)
  const total = 2 * partSize + 1234;
  const sizes = [partSize, partSize, 1234];
  const parts = [];
  let off = 0;
  for (let n = 1; n <= sizes.length; n++) {
    const chunk = bytes(off, sizes[n - 1]);
    const url = `${mpPath}/${uploadId}/parts/${n}`;
    if (n === 1) assert.equal((await call('bob', 'PUT', url, chunk)).status, 403);
    if (n === 2) {
      // a "failed" first attempt with the wrong bytes is simply re-sent: the last copy wins
      await call('alice', 'PUT', url, bytes(999, sizes[1]));
    }
    const r = await call('alice', 'PUT', url, chunk);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.partNumber, n);
    parts.push({ partNumber: n, etag: r.json.etag });
    off += sizes[n - 1];
  }
  assert.equal((await call('alice', 'PUT', `${mpPath}/${uploadId}/parts/0`, bytes(0, 10))).json.code, 'BAD_PART');
  // gaps / missing etags are refused before R2 sees them
  assert.equal((await call('alice', 'POST', `${mpPath}/${uploadId}/complete`, { parts: [parts[0], parts[2]] })).json.code, 'BAD_PARTS');
  const done = await call('alice', 'POST', `${mpPath}/${uploadId}/complete`, { parts: [...parts].reverse() });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.status, 'ready');
  assert.equal(done.json.sizeBytes, total);

  const post = await call('alice', 'POST', '/posts', { kind: 'Video', text: 'Full sermon', videoUid: v.json.uid, category: 'Sermon' });
  assert.equal(post.json.video.status, 'ready');
  assert.equal(post.json.video.duration, 1800, 'the full length is kept');
  const key = pathOf(post.json.video.url);

  const full = await app.fetch(new Request(`http://api.test${key}`), env);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-length'), String(total));
  assert.equal((await full.arrayBuffer()).byteLength, total, 'nothing is cut off');
  // seek across the part boundary and to the very end
  const mid = await app.fetch(new Request(`http://api.test${key}`, { headers: { Range: `bytes=${partSize - 5}-${partSize + 4}` } }), env);
  assert.equal(mid.status, 206);
  assert.equal(mid.headers.get('content-range'), `bytes ${partSize - 5}-${partSize + 4}/${total}`);
  assert.deepEqual([...new Uint8Array(await mid.arrayBuffer())], [...bytes(partSize - 5, 10)]);
  const open = await app.fetch(new Request(`http://api.test${key}`, { headers: { Range: `bytes=${total - 100}-` } }), env);
  assert.equal(open.status, 206);
  assert.equal(open.headers.get('content-length'), '100');
  assert.deepEqual([...new Uint8Array(await open.arrayBuffer())], [...bytes(total - 100, 100)]);
  const head = await app.fetch(new Request(`http://api.test${key}`, { method: 'HEAD' }), env);
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal((await app.fetch(new Request(`http://api.test${key}`, { headers: { Range: `bytes=${total}-` } }), env)).status, 416);
});

test('multipart: small middle parts are refused at complete, abort frees the upload', async () => {
  const v = await call('alice', 'POST', '/uploads/video', { durationSeconds: 60 });
  const mpPath = pathOf(v.json.multipartURL);
  const { uploadId } = (await call('alice', 'POST', mpPath)).json;
  const a = await call('alice', 'PUT', `${mpPath}/${uploadId}/parts/1`, bytes(0, 1000));
  const b = await call('alice', 'PUT', `${mpPath}/${uploadId}/parts/2`, bytes(0, 1000));
  const r = await call('alice', 'POST', `${mpPath}/${uploadId}/complete`, { parts: [a.json, b.json].map((x) => ({ partNumber: x.partNumber, etag: x.etag })) });
  assert.equal(r.json.code, 'COMPLETE_FAILED');
  assert.equal((await call('alice', 'DELETE', `${mpPath}/${uploadId}`)).status, 200);
  assert.equal((await call('alice', 'PUT', `${mpPath}/${uploadId}/parts/1`, bytes(0, 10))).json.code, 'PART_FAILED', 'aborted uploads take no more parts');
});

test('single PUT still works for small files and points big ones at multipart', async () => {
  const v = await call('alice', 'POST', '/uploads/video', { durationSeconds: 12 });
  const put = await call('alice', 'PUT', pathOf(v.json.uploadURL), bytes(0, 2000), { 'Content-Type': 'video/mp4' });
  assert.equal(put.status, 200);
  assert.equal(put.json.status, 'ready');
  const big = await call('alice', 'PUT', pathOf(v.json.uploadURL), bytes(0, 10), { 'Content-Type': 'video/mp4', 'Content-Length': String(200 * MB) });
  assert.equal(big.json.code, 'USE_MULTIPART');
});
