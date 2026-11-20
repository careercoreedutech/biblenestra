// VOICE NOTES + CHAT PUSH: waveform/duration meta is cleaned and stored with voice messages; chat pushes carry the
// "chat" Android channel, the "chat_message" category (Reply / Mark as read), the chat id, thread id and title; the
// notification actions' API calls (send a reply, mark read) work with the ids the push carries.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { cleanVoiceMeta, cleanWaveform, WAVEFORM_MAX, MAX_VOICE_MS } from '../src/lib/voiceMeta.js';

const pushes = [];
async function mockFetch(url, opts) {
  if (String(url).startsWith('https://exp.host/')) {
    const msgs = JSON.parse(opts.body);
    pushes.push(...msgs);
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }), { status: 200 });
  }
  return new Response('nope', { status: 404 });
}

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', __fetch: mockFetch };
});
async function raw(user, method, path, { body, headers = {} } = {}) {
  const h = { 'X-Dev-User': user, ...headers };
  let b = body;
  if (body !== undefined && !(body instanceof Uint8Array)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env, ctx);
  await Promise.all(waits);
  const ct = res.headers.get('Content-Type') || '';
  return { status: res.status, json: ct.includes('json') ? await res.json() : null };
}
const call = (u, m, p, body) => raw(u, m, p, { body });
const ids = {};
let dm; let group; let voiceKey;

test('cleanWaveform / cleanVoiceMeta', () => {
  assert.equal(cleanWaveform(null), null);
  assert.equal(cleanWaveform([0.5]), null, 'one level is not a waveform');
  assert.deepEqual(cleanWaveform([0.123, 2, -1, 'x', '0.5']), [0.12, 1, 0, 0, 0.5]);
  const long = Array.from({ length: 640 }, (_, i) => (i % 10 === 0 ? 0.9 : 0.1));
  const w = cleanWaveform(long);
  assert.equal(w.length, WAVEFORM_MAX);
  assert.ok(w.every((x) => x === 0.9), 'each bucket keeps its loudest level');
  assert.equal(cleanWaveform(Array(100000).fill(0.3)).length, WAVEFORM_MAX);

  assert.deepEqual(cleanVoiceMeta({ durationMs: 4200.6, waveform: [0.1, 0.2] }), { durationMs: 4201, waveform: [0.1, 0.2] });
  assert.equal(cleanVoiceMeta({ durationMs: 99 * 60 * 1000 }).durationMs, MAX_VOICE_MS);
  assert.deepEqual(cleanVoiceMeta({ durationMs: 'abc', waveform: 'loud' }), {});
  assert.deepEqual(cleanVoiceMeta({ file: true, name: 'Hymn.mp3', waveform: [0.1, 0.2] }), { file: true, name: 'Hymn.mp3' });
  assert.equal(cleanVoiceMeta(null), null);
});

test('setup: a DM ana↔bob and a group; bob and cid have phones registered for push', async () => {
  for (const u of ['ana', 'bob', 'cid']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  dm = (await call('ana', 'POST', '/conversations/dm', { userId: ids.bob })).json.id;
  group = (await call('ana', 'POST', '/conversations/group', { title: 'Choir', memberIds: [ids.bob, ids.cid] })).json.id;
  assert.equal((await call('bob', 'POST', '/me/push-token', { token: 'ExponentPushToken[bob-phone]', platform: 'android' })).status, 200);
  assert.equal((await call('cid', 'POST', '/me/push-token', { token: 'ExponentPushToken[cid-phone]', platform: 'android' })).status, 200);
});

test('voice note: waveform and duration are stored and come back on every read', async () => {
  const up = await raw('ana', 'POST', '/uploads/voice', { body: new Uint8Array([0, 1, 2, 3]), headers: { 'Content-Type': 'audio/m4a', 'X-Conversation-Id': dm } });
  assert.equal(up.status, 201);
  voiceKey = up.json.key;
  const levels = Array.from({ length: 80 }, (_, i) => Math.abs(Math.sin(i / 5)));
  const sent = await call('ana', 'POST', `/conversations/${dm}/messages`, { kind: 'voice', mediaKey: voiceKey, meta: { durationMs: 8123, waveform: levels }, clientId: 'v1' });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.meta.durationMs, 8123);
  assert.equal(sent.json.meta.waveform.length, WAVEFORM_MAX);
  assert.ok(sent.json.meta.waveform.every((x) => x >= 0 && x <= 1 && Number(x.toFixed(2)) === x));

  const page = await call('bob', 'GET', `/conversations/${dm}/messages`);
  const got = page.json.items.find((m) => m.id === sent.json.id);
  assert.deepEqual(got.meta.waveform, sent.json.meta.waveform);
  assert.equal((await call('bob', 'GET', `/messages/${sent.json.id}`)).json.meta.durationMs, 8123);

  // a waveform on a text message is left alone (only voice meta is cleaned) — and bad voice meta never fails the send
  const junk = await call('ana', 'POST', `/conversations/${dm}/messages`, { kind: 'voice', mediaKey: voiceKey, meta: { durationMs: -5, waveform: { a: 1 } } });
  assert.equal(junk.status, 201);
  assert.equal(junk.json.meta.durationMs, undefined);
  assert.equal(junk.json.meta.waveform, undefined);
});

test('chat pushes: chat channel + Reply/Mark-as-read category + chat id, thread id and title', async () => {
  pushes.length = 0;
  const m = await call('ana', 'POST', `/conversations/${dm}/messages`, { text: 'Are you coming tonight?', clientId: 'p1' });
  assert.equal(m.status, 201);
  const p = pushes.find((x) => x.to === 'ExponentPushToken[bob-phone]');
  assert.ok(p, 'bob got a push');
  assert.equal(p.channelId, 'chat');
  assert.equal(p.categoryId, 'chat_message');
  assert.equal(p.data.conversationId, dm);
  assert.equal(p.data.messageId, m.json.id);
  assert.equal(p.data.threadId, `chat:${dm}`);
  assert.equal(p.data.kind, 'message');
  assert.equal(p.title, p.data.chatTitle, 'DM: the title is the sender (the chat name on bob’s phone)');
  assert.equal(p.body, 'Are you coming tonight?');

  pushes.length = 0;
  await call('ana', 'POST', `/conversations/${group}/messages`, { kind: 'voice', mediaKey: (await raw('ana', 'POST', '/uploads/voice', { body: new Uint8Array([1, 2]), headers: { 'Content-Type': 'audio/m4a', 'X-Conversation-Id': group } })).json.key, meta: { durationMs: 3000, waveform: [0.2, 0.8, 0.4] } });
  const g = pushes.filter((x) => x.data.conversationId === group);
  assert.equal(g.length, 2, 'bob and cid');
  for (const x of g) {
    assert.equal(x.data.chatTitle, 'Choir');
    assert.equal(x.data.kind, 'group');
    assert.equal(x.categoryId, 'chat_message');
    assert.match(x.body, /: 🎤 Voice note \(0:03\)$/);
  }
});

test('marking a chat read sends no push', async () => {
  pushes.length = 0;
  await call('bob', 'POST', `/conversations/${dm}/read`);
  assert.equal(pushes.length, 0);
});

test('notification actions: "Reply" sends through the normal API, "Mark as read" clears the unread count', async () => {
  await call('ana', 'POST', `/conversations/${dm}/messages`, { text: 'One more thing', clientId: 'p2' });
  const before = (await call('bob', 'GET', '/conversations')).json.items.find((x) => x.id === dm);
  assert.ok(before.unreadCount >= 1);

  // what the app does for Reply: POST the typed text with a clientId derived from the notification (safe to retry)
  const reply = await call('bob', 'POST', `/conversations/${dm}/messages`, { kind: 'text', text: 'Yes, see you there', clientId: 'notif-reply-abc' });
  assert.equal(reply.status, 201);
  const again = await call('bob', 'POST', `/conversations/${dm}/messages`, { kind: 'text', text: 'Yes, see you there', clientId: 'notif-reply-abc' });
  assert.equal(again.json.id, reply.json.id, 'a retried reply is not sent twice');
  // sending marks the chat read for the sender, and so does the explicit Mark as read action
  assert.equal((await call('bob', 'POST', `/conversations/${dm}/read`)).status, 200);
  const after = (await call('bob', 'GET', '/conversations')).json.items.find((x) => x.id === dm);
  assert.equal(after.unreadCount, 0);
});
