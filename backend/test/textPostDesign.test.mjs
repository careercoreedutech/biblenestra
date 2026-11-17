// Image-style text posts: POST /posts accepts an allow-listed design and returns it on every read.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { parseDesign, designFromBody, CARD_MAX_CHARS } from '../src/lib/postDesign.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
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

test('parseDesign / designFromBody', () => {
  assert.deepEqual(parseDesign('dawn.bold.left'), { key: 'dawn', font: 'bold', align: 'left' });
  assert.deepEqual(parseDesign('dawn'), { key: 'dawn', font: 'italic', align: 'center' });
  assert.deepEqual(parseDesign('#15172B'), { color: '#15172B' });
  assert.equal(parseDesign('nope'), null);
  assert.equal(parseDesign(null), null);
  assert.equal(designFromBody({ design: { key: 'sea' } }, 'Hi'), 'sea.italic.center');
  assert.equal(designFromBody({ theme: 'psalm.garamond.left' }, 'Hi'), 'psalm.garamond.left');
  assert.equal(designFromBody({}, 'Hi'), null);
  assert.equal(designFromBody({ design: { key: 'sea' } }, 'x'.repeat(CARD_MAX_CHARS + 1)), null, 'too long for a card → plain post');
  assert.throws(() => designFromBody({ design: { key: 'evil' } }, 'Hi'));
  assert.throws(() => designFromBody({ design: { key: 'sea', font: 'comic' } }, 'Hi'));
  assert.throws(() => designFromBody({ theme: 'url(javascript:alert(1))' }, 'Hi'));
});

test('POST /posts stores the design and every read returns it', async () => {
  const made = await call('td1', 'POST', '/posts', { text: 'Be still, and know that I am God.', design: { key: 'parchment', font: 'garamond', align: 'center' }, passage: { bookId: 'PSA', chapter: 46, verse: 10 } });
  assert.equal(made.status, 201);
  assert.equal(made.json.theme, 'parchment.garamond.center');
  assert.deepEqual(made.json.design, { key: 'parchment', font: 'garamond', align: 'center' });
  const one = await call('td2', 'GET', `/posts/${made.json.id}`);
  assert.deepEqual(one.json.design, { key: 'parchment', font: 'garamond', align: 'center' });
  const feed = await call('td2', 'GET', '/feed');
  const inFeed = feed.json.items.find((x) => x.id === made.json.id);
  assert.ok(inFeed, 'post is in the feed');
  assert.equal(inFeed.theme, 'parchment.garamond.center');

  // the app's sync layer sends the encoded string as `theme`
  const viaTheme = await call('td1', 'POST', '/posts', { text: 'Grace upon grace', theme: 'starlight.bold.left' });
  assert.equal(viaTheme.status, 201);
  assert.deepEqual(viaTheme.json.design, { key: 'starlight', font: 'bold', align: 'left' });
});

test('POST /posts — unknown designs are rejected, legacy colours and plain posts unaffected', async () => {
  const badKey = await call('td1', 'POST', '/posts', { text: 'Hi', design: { key: 'neon-hack' } });
  assert.equal(badKey.status, 400);
  const badTheme = await call('td1', 'POST', '/posts', { text: 'Hi', theme: 'red; background:url(x)' });
  assert.equal(badTheme.status, 400);

  const legacy = await call('td1', 'POST', '/posts', { text: 'Old app build', theme: '#15172B' });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.json.theme, '#15172B');
  assert.deepEqual(legacy.json.design, { color: '#15172B' });

  const plain = await call('td1', 'POST', '/posts', { text: 'Just words' });
  assert.equal(plain.status, 201);
  assert.equal(plain.json.theme, null);
  assert.equal(plain.json.design, null);

  const long = await call('td1', 'POST', '/posts', { text: 'a'.repeat(CARD_MAX_CHARS + 20), design: { key: 'dawn' } });
  assert.equal(long.status, 201);
  assert.equal(long.json.design, null, 'long text falls back to a normal text post');
});
