// Private chats: photos, voice notes / audio files, and person-to-person coin gifts.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
});
async function raw(user, method, path, { body, headers = {} } = {}) {
  const h = { 'X-Dev-User': user, ...headers };
  let b = body;
  if (body !== undefined && !(body instanceof Uint8Array)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('json')) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, json: await res.json() };
}
const call = (u, m, p, body) => raw(u, m, p, { body });
const ids = {};
let dm; let group;

test('setup: a DM between ana and bob, a group with cid', async () => {
  for (const u of ['ana', 'bob', 'cid', 'eve']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  dm = (await call('ana', 'POST', '/conversations/dm', { userId: ids.bob })).json.id;
  group = (await call('ana', 'POST', '/conversations/group', { title: 'Choir', memberIds: [ids.bob, ids.cid] })).json.id;
  assert.ok(dm && group);
});

test('photos: upload to the chat, send as an image message, only members can load it', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const up = await raw('ana', 'POST', '/uploads/chat-image', { body: png, headers: { 'Content-Type': 'image/png', 'X-Conversation-Id': dm } });
  assert.equal(up.status, 201);
  assert.ok(up.json.key.startsWith(`chat/${dm}/img_`));
  assert.equal((await raw('eve', 'POST', '/uploads/chat-image', { body: png, headers: { 'Content-Type': 'image/png', 'X-Conversation-Id': dm } })).status, 403);

  const sent = await call('ana', 'POST', `/conversations/${dm}/messages`, { kind: 'image', mediaKey: up.json.key, text: 'Sunday service', meta: { width: 10, height: 20 }, clientId: 'img1' });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.kind, 'image');
  assert.equal(sent.json.mediaKey, up.json.key);
  assert.deepEqual(sent.json.meta, { width: 10, height: 20 });

  const got = await raw('bob', 'GET', `/chat/media/${up.json.key}`);
  assert.equal(got.status, 200);
  assert.deepEqual([...got.bytes], [...png]);
  assert.equal((await raw('eve', 'GET', `/chat/media/${up.json.key}`)).status, 403);

  // the chat list previews a photo
  const list = (await call('bob', 'GET', '/conversations')).json.items;
  assert.equal(list.find((x) => x.id === dm).lastMessage.text, 'Sunday service');
});

test('media messages must carry a file from this chat', async () => {
  assert.equal((await call('ana', 'POST', `/conversations/${dm}/messages`, { kind: 'image', text: 'no file' })).json.code, 'MEDIA_REQUIRED');
  const other = await raw('ana', 'POST', '/uploads/chat-image', { body: new Uint8Array([1, 2]), headers: { 'Content-Type': 'image/jpeg', 'X-Conversation-Id': group } });
  assert.equal((await call('ana', 'POST', `/conversations/${dm}/messages`, { kind: 'image', mediaKey: other.json.key })).json.code, 'BAD_MEDIA');
  assert.equal((await call('ana', 'POST', `/conversations/${dm}/messages`, { kind: 'image', mediaKey: `chat/${dm}/../x` })).json.code, 'BAD_MEDIA');
  // a forged coin gift in meta is refused
  assert.equal((await call('ana', 'POST', `/conversations/${dm}/messages`, { kind: 'text', text: 'x', meta: { gift: { coins: 999 } } })).json.code, 'BAD_META');
});

test('voice notes and audio files: up to 20 MB, audio types only', async () => {
  const voice = await raw('bob', 'POST', '/uploads/voice', { body: new Uint8Array([0, 1, 2, 3]), headers: { 'Content-Type': 'audio/m4a', 'X-Conversation-Id': dm } });
  assert.equal(voice.status, 201);
  assert.ok(voice.json.key.startsWith(`chat/${dm}/voice_`) && voice.json.key.endsWith('.m4a'));
  const flac = await raw('bob', 'POST', '/uploads/voice', { body: new Uint8Array([9, 9]), headers: { 'Content-Type': 'audio/flac', 'X-Conversation-Id': dm } });
  assert.ok(flac.json.key.endsWith('.flac'));
  const webm = await raw('bob', 'POST', '/uploads/voice', { body: new Uint8Array([9, 9]), headers: { 'Content-Type': 'audio/webm;codecs=opus', 'X-Conversation-Id': dm } });
  assert.ok(webm.json.key.endsWith('.webm'));
  assert.equal((await raw('bob', 'POST', '/uploads/voice', { body: new Uint8Array([1]), headers: { 'Content-Type': 'image/png', 'X-Conversation-Id': dm } })).status, 400);
  const big = await raw('bob', 'POST', '/uploads/voice', { body: new Uint8Array(6 * 1024 * 1024), headers: { 'Content-Type': 'audio/mpeg', 'X-Conversation-Id': dm } });
  assert.equal(big.status, 201, '6 MB audio files are fine now');
  assert.equal((await raw('bob', 'POST', '/uploads/voice', { body: new Uint8Array(21 * 1024 * 1024), headers: { 'Content-Type': 'audio/mpeg', 'X-Conversation-Id': dm } })).status, 413);

  const sent = await call('bob', 'POST', `/conversations/${dm}/messages`, { kind: 'voice', mediaKey: voice.json.key, meta: { durationMs: 4200 } });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.kind, 'voice');
  assert.equal(sent.json.meta.durationMs, 4200);
  const audio = await raw('ana', 'GET', `/chat/media/${voice.json.key}`);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('Content-Type'), 'audio/m4a');
  const list = (await call('ana', 'GET', '/conversations')).json.items;
  assert.equal(list.find((x) => x.id === dm).lastMessage.text, '🎤 Voice message');
});

test('coin gifts in a DM: whole amount moves, ledger on both sides, a gift message, a notification', async () => {
  const before = { ana: (await call('ana', 'GET', '/me')).json.coins, bob: (await call('bob', 'GET', '/me')).json.coins };
  const res = await call('ana', 'POST', `/conversations/${dm}/coins`, { coins: 15, note: 'For the youth trip', clientId: 'gift1' });
  assert.equal(res.status, 201);
  assert.equal(res.json.coinsRemaining, before.ana - 15);
  assert.equal(res.json.message.kind, 'text');
  assert.match(res.json.message.text, /Sent 15 coins/);
  assert.equal(res.json.message.meta.gift.coins, 15);
  assert.equal(res.json.message.meta.gift.toUserId, ids.bob);
  assert.equal((await call('ana', 'GET', '/me')).json.coins, before.ana - 15);
  assert.equal((await call('bob', 'GET', '/me')).json.coins, before.bob + 15);

  const aLedger = (await call('ana', 'GET', '/coins/ledger')).json.items;
  const bLedger = (await call('bob', 'GET', '/coins/ledger')).json.items;
  assert.ok(aLedger.some((l) => l.amount === -15 && l.reason === 'chat_gift_sent'));
  assert.ok(bLedger.some((l) => l.amount === 15 && l.reason === 'chat_gift_received'));

  const msgs = (await call('bob', 'GET', `/conversations/${dm}/messages`)).json.items;
  assert.ok(msgs.some((m) => m.meta && m.meta.gift && m.meta.gift.coins === 15 && !m.isMe));

  const notes = (await call('bob', 'GET', '/me/notifications')).json;
  const items = notes.items || notes;
  assert.ok(items.some((n) => /sent you 15 coins/.test(n.body || n.text || '')), 'bob is notified');

  // retry with the same clientId → no double charge
  const again = await call('ana', 'POST', `/conversations/${dm}/coins`, { coins: 15, clientId: 'gift1' });
  assert.equal(again.json.duplicate, true);
  assert.equal((await call('ana', 'GET', '/me')).json.coins, before.ana - 15);
});

test('coin gifts: balance check is atomic and amounts are validated', async () => {
  const bal = (await call('ana', 'GET', '/me')).json.coins;
  const short = await call('ana', 'POST', `/conversations/${dm}/coins`, { coins: bal + 1 });
  assert.equal(short.status, 402);
  assert.equal(short.json.code, 'INSUFFICIENT_COINS');
  assert.equal((await call('ana', 'GET', '/me')).json.coins, bal, 'nothing taken');
  const msgs = (await call('ana', 'GET', `/conversations/${dm}/messages`)).json.items;
  assert.equal(msgs.filter((m) => m.meta && m.meta.gift).length, 1, 'no gift message for a failed gift');
  for (const coins of [0, -5, 1.5, 'ten', 100001]) {
    assert.equal((await call('ana', 'POST', `/conversations/${dm}/coins`, { coins })).json.code, 'BAD_AMOUNT');
  }
  assert.equal((await call('eve', 'POST', `/conversations/${dm}/coins`, { coins: 1 })).status, 403, 'outsiders cannot gift into a chat');

  // two gifts racing for the last coins: only what the balance covers goes through
  const left = (await call('ana', 'GET', '/me')).json.coins;
  const [a, b] = await Promise.all([
    call('ana', 'POST', `/conversations/${dm}/coins`, { coins: left }),
    call('ana', 'POST', `/conversations/${dm}/coins`, { coins: left }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 402]);
  assert.equal((await call('ana', 'GET', '/me')).json.coins, 0);
});

test('coin gifts in a group need a member as recipient', async () => {
  assert.equal((await call('bob', 'POST', `/conversations/${group}/coins`, { coins: 1 })).json.code, 'BAD_RECIPIENT');
  assert.equal((await call('bob', 'POST', `/conversations/${group}/coins`, { coins: 1, toUserId: ids.eve })).json.code, 'BAD_RECIPIENT');
  assert.equal((await call('bob', 'POST', `/conversations/${group}/coins`, { coins: 1, toUserId: ids.bob })).json.code, 'BAD_RECIPIENT');
  const ok = await call('bob', 'POST', `/conversations/${group}/coins`, { coins: 2, toUserId: ids.cid });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.message.meta.gift.toName, (await call('cid', 'GET', '/me')).json.displayName);
});

test('blocked people cannot gift each other', async () => {
  const d = (await call('cid', 'POST', '/conversations/dm', { userId: ids.eve })).json.id;
  await call('eve', 'POST', `/users/${ids.cid}/block`);
  assert.equal((await call('cid', 'POST', `/conversations/${d}/coins`, { coins: 1 })).status, 403);
});
