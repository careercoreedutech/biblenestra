// PACKAGE F — video plays vs unique viewers, post views, anti-inflation rules, and the compact count formatter.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { compactCount } from '../../src/utils/compactCount.js';

let env; const app = createApp();

async function call(user, method, path, body, headers = {}) {
  const h = { 'X-Dev-User': user, ...headers };
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  return { status: res.status, json: await res.json() };
}
const sql = async (t, p = []) => env.__db.query(t, p);
const ids = {};
let video;
let other;

before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
  for (const u of ['vera', 'vic', 'vito']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  video = (await call('vera', 'POST', '/posts', { text: 'Psalm 23' })).json.id;
  other = (await call('vera', 'POST', '/posts', { text: 'A plain thought' })).json.id;
  // a real upload is not needed to count plays: the post only has to be a video (video_url set)
  await sql(`UPDATE posts SET video_url = 'vid/test.mp4' WHERE id = $1`, [video]);
});

test('a play counts only after the minimum watch time', async () => {
  const short = await call('vic', 'POST', `/posts/${video}/video-view`, { watchedMs: 900 });
  assert.equal(short.status, 200);
  assert.equal(short.json.counted, false);
  assert.equal(short.json.reason, 'too_short');
  const ok = await call('vic', 'POST', `/posts/${video}/video-view`, { watchedMs: 4200 });
  assert.equal(ok.json.counted, true);
  assert.equal(ok.json.plays, 1);
  assert.equal(ok.json.viewers, 1);
});

test('the same viewer inside the cooldown adds nothing', async () => {
  const again = await call('vic', 'POST', `/posts/${video}/video-view`, { watchedMs: 5000 });
  assert.equal(again.json.counted, false);
  assert.equal(again.json.reason, 'cooldown');
  assert.equal(again.json.plays, 1);
});

test('after the cooldown the same user adds a play but not a unique viewer', async () => {
  await sql(`UPDATE video_views SET last_counted_at = now() - interval '2 hours' WHERE post_id = $1`, [video]);
  const r = await call('vic', 'POST', `/posts/${video}/video-view`, { watchedMs: 3000 });
  assert.equal(r.json.counted, true);
  assert.equal(r.json.plays, 2);
  assert.equal(r.json.viewers, 1);
});

test('a second viewer raises unique viewers', async () => {
  const r = await call('vito', 'POST', `/posts/${video}/video-view`, { watchedMs: 3000 });
  assert.equal(r.json.counted, true);
  assert.equal(r.json.plays, 3);
  assert.equal(r.json.viewers, 2);
});

test('the author never inflates their own video', async () => {
  const r = await call('vera', 'POST', `/posts/${video}/video-view`, { watchedMs: 9000 });
  assert.equal(r.json.counted, false);
  assert.equal(r.json.reason, 'own_video');
});

test('a plain text post does not count as a video play', async () => {
  const r = await call('vic', 'POST', `/posts/${other}/video-view`, { watchedMs: 9000 });
  assert.equal(r.json.reason, 'not_video');
});

test('a removed or unknown post is not found; a bad watchedMs is refused', async () => {
  assert.equal((await call('vic', 'POST', '/posts/00000000-0000-4000-8000-000000000000/video-view', { watchedMs: 9000 })).status, 404);
  assert.equal((await call('vic', 'POST', `/posts/${video}/video-view`, { watchedMs: -5 })).status, 400);
  assert.equal((await call('vic', 'POST', `/posts/${video}/video-view`, { watchedMs: 'lots' })).status, 400);
});

test('the counts endpoint returns plays, unique viewers and post views separately', async () => {
  const c = await call('vic', 'GET', `/posts/${video}/counts`);
  assert.equal(c.json.videoPlays, 3);
  assert.equal(c.json.videoViewers, 2);
  assert.equal(typeof c.json.postViews, 'number');
});

test('post impressions: a batch counts each card once per cooldown and skips my own posts', async () => {
  const first = await call('vic', 'POST', '/posts/views', { ids: [other, video] });
  assert.equal(first.json.counted, 2, 'both posts are by vera, so vic counts as a viewer of each');
  const repeat = await call('vic', 'POST', '/posts/views', { ids: [other, video] });
  assert.equal(repeat.json.counted, 0, 'inside the cooldown nothing more is counted');
  const mine = await call('vera', 'POST', '/posts/views', { ids: [other] });
  assert.equal(mine.json.counted, 0, 'the author does not add to their own post views');
});

test('the old /posts/:id/view route dedupes instead of adding 1 per call', async () => {
  const a = await call('vito', 'POST', `/posts/${other}/view`, {});
  const b = await call('vito', 'POST', `/posts/${other}/view`, {});
  assert.equal(a.json.views, b.json.views, 'second call from the same viewer does not raise the count');
});

test('post impressions ignore junk ids', async () => {
  const r = await call('vito', 'POST', '/posts/views', { ids: ['nope', null, 7] });
  assert.equal(r.json.counted, 0);
});

test('compactCount: X-style numbers, truncated not rounded, no trailing .0', () => {
  const cases = [
    [0, '0'], [1, '1'], [999, '999'], [1000, '1K'], [1200, '1.2K'], [1999, '1.9K'], [10000, '10K'],
    [12345, '12.3K'], [99999, '99.9K'], [100000, '100K'], [999999, '999K'], [1000000, '1M'], [1234567, '1.2M'],
    [null, '0'], [-4, '0'], ['24.8K', '24.8K'],
  ];
  for (const [n, out] of cases) assert.equal(compactCount(n), out, `compactCount(${n})`);
});
