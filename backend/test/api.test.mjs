// End-to-end tests of the Worker against an in-process Postgres (PGlite). Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADS_CLIENT_CLAIM: 'true', };
});

async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array || typeof body === 'string') b = body;
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}

test('health and auth', async () => {
  assert.deepEqual((await call(null, 'GET', '/health')).json, { ok: true, db: true });
  assert.equal((await call(null, 'GET', '/me')).status, 401);
  const me = await call('alice', 'GET', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.displayName, 'Alice');
  assert.equal(me.json.coins, 50);
  const off = await app.fetch(new Request('http://api.test/me', { headers: { 'X-Dev-User': 'alice' } }), { ...env, AUTH_DEV_MODE: 'false' });
  assert.equal(off.status, 401, 'dev header must be rejected when dev mode is off');
});

test('profile update and handle validation', async () => {
  const r = await call('alice', 'PUT', '/me', { displayName: 'Alice A.', handle: '@alice.a', church: 'Grace Chapel' });
  assert.equal(r.json.handle, 'alice.a');
  assert.equal((await call('bob', 'PUT', '/me', { handle: 'alice.a' })).json.code, 'HANDLE_TAKEN');
  assert.equal((await call('bob', 'PUT', '/me', { handle: 'x' })).json.code, 'BAD_HANDLE');
});

test('posts, reactions, comments, save, hide, follow feed', async () => {
  const p = await call('alice', 'POST', '/posts', { kind: 'Reflection', text: 'Be still.', passage: { bookId: 'PSA', chapter: 46, verse: 10 } });
  assert.equal(p.status, 201);
  assert.equal(p.json.passage.bookId, 'PSA');
  const id = p.json.id;
  assert.equal((await call('bob', 'POST', '/posts', { text: '' })).json.code, 'EMPTY_POST');
  const re = await call('bob', 'POST', `/posts/${id}/react`, { reaction: 'amen' });
  assert.deepEqual(re.json, { myReaction: 'amen', likes: 1 });
  assert.equal((await call('bob', 'POST', `/posts/${id}/react`, { reaction: 'love' })).json.likes, 1);
  const cm = await call('bob', 'POST', `/posts/${id}/comments`, { text: 'Amen!' });
  assert.equal(cm.status, 201);
  const reply = await call('alice', 'POST', `/posts/${id}/comments`, { text: 'Thanks Bob', parentId: cm.json.id });
  assert.equal(reply.json.parentId, cm.json.id);
  assert.equal((await call('bob', 'GET', `/posts/${id}/comments`)).json.items.length, 2);
  assert.equal((await call('bob', 'POST', `/posts/${id}/save`)).json.saved, true);
  const feed = await call('bob', 'GET', '/feed');
  const item = feed.json.items.find((x) => x.id === id);
  assert.equal(item.myReaction, 'love');
  assert.equal(item.saved, true);
  assert.equal(item.comments, 2);
  assert.equal(item.mine, false);
  // following filter
  assert.equal((await call('bob', 'GET', '/feed?filter=following')).json.items.length, 0);
  const aliceId = (await call('alice', 'GET', '/me')).json.id;
  assert.equal((await call('bob', 'POST', `/users/${aliceId}/follow`)).json.following, true);
  assert.equal((await call('bob', 'GET', '/feed?filter=following')).json.items.length, 1);
  // hide
  await call('bob', 'POST', `/posts/${id}/hide`);
  assert.equal((await call('bob', 'GET', '/feed')).json.items.find((x) => x.id === id), undefined);
  // delete only by author
  assert.equal((await call('bob', 'DELETE', `/posts/${id}`)).status, 403);
  assert.equal((await call('alice', 'DELETE', `/posts/${id}`)).status, 200);
  assert.equal((await call('alice', 'GET', `/posts/${id}`)).status, 404);
});

test('pagination', async () => {
  for (let i = 0; i < 25; i++) await call('carol', 'POST', '/posts', { text: `post ${i}` });
  const a = await call('carol', 'GET', '/feed?limit=10');
  assert.equal(a.json.items.length, 10);
  const b = await call('carol', 'GET', `/feed?limit=10&cursor=${encodeURIComponent(a.json.nextCursor)}`);
  assert.equal(b.json.items.length, 10);
  assert.ok(!b.json.items.some((x) => a.json.items.find((y) => y.id === x.id)), 'pages must not overlap');
});

test('image upload + photo post + media serving', async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const up = await call('alice', 'POST', '/uploads/image', png, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201);
  assert.match(up.json.key, /^img\/.+\.png$/);
  assert.equal((await call('alice', 'POST', '/uploads/image', 'hello', { 'Content-Type': 'text/plain' })).json.code, 'BAD_IMAGE_TYPE');
  const post = await call('alice', 'POST', '/posts', { kind: 'Photo', text: 'Sunday', images: [{ key: up.json.key, width: 800, height: 600 }] });
  assert.equal(post.json.images.length, 1);
  assert.ok(post.json.images[0].url.endsWith(up.json.key));
  // someone else's image key is rejected
  assert.equal((await call('bob', 'POST', '/posts', { text: 'x', images: [{ key: up.json.key }] })).json.code, 'BAD_IMAGE');
  const img = await app.fetch(new Request(`http://api.test/media/${up.json.key}`), env);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('video: reserve → PUT mp4 + thumbnail to R2 → post → range playback', async () => {
  const v = await call('alice', 'POST', '/uploads/video', { durationSeconds: 42, width: 720, height: 1280, sizeBytes: 5000 });
  assert.equal(v.status, 201);
  assert.equal(v.json.method, 'PUT');
  assert.equal((await call('alice', 'POST', '/uploads/video', { durationSeconds: 7300 })).json.code, 'TOO_LONG');
  const mp4 = new Uint8Array(1000).map((_, i) => i % 256);
  const path = new URL(v.json.uploadURL).pathname;
  // only the owner can upload, and it must be an mp4
  assert.equal((await call('bob', 'PUT', path, mp4, { 'Content-Type': 'video/mp4' })).status, 403);
  assert.equal((await call('alice', 'PUT', path, mp4, { 'Content-Type': 'text/plain' })).json.code, 'BAD_VIDEO_TYPE');
  const put = await call('alice', 'PUT', path, mp4, { 'Content-Type': 'video/mp4', 'Content-Length': '1000' });
  assert.equal(put.status, 200);
  const thumb = await call('alice', 'PUT', new URL(v.json.thumbnailURL).pathname, Uint8Array.from([255, 216, 255, 1]), { 'Content-Type': 'image/jpeg' });
  assert.equal(thumb.status, 200);
  const post = await call('alice', 'POST', '/posts', { kind: 'Video', text: 'Worship', videoUid: v.json.uid, category: 'Worship' });
  assert.equal(post.json.video.status, 'ready');
  assert.equal(post.json.video.duration, 42);
  assert.match(post.json.video.url, /\/media\/vid\/.+\.mp4$/);
  assert.match(post.json.video.thumbnail, /\.jpg$/);
  assert.ok((await call('bob', 'GET', '/videos')).json.items.find((x) => x.id === post.json.id));
  assert.equal((await call('bob', 'POST', '/posts', { text: 'x', videoUid: v.json.uid })).json.code, 'BAD_VIDEO');
  // byte-range requests (video players seek with these)
  const key = new URL(post.json.video.url).pathname;
  const full = await app.fetch(new Request(`http://api.test${key}`), env);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal((await full.arrayBuffer()).byteLength, 1000);
  const part = await app.fetch(new Request(`http://api.test${key}`, { headers: { Range: 'bytes=100-199' } }), env);
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  const bytes = new Uint8Array(await part.arrayBuffer());
  assert.deepEqual([bytes.length, bytes[0]], [100, 100]);
  const tail = await app.fetch(new Request(`http://api.test${key}`, { headers: { Range: 'bytes=-10' } }), env);
  assert.equal(tail.headers.get('content-range'), 'bytes 990-999/1000');
  const bad = await app.fetch(new Request(`http://api.test${key}`, { headers: { Range: 'bytes=5000-' } }), env);
  assert.equal(bad.status, 416);
});

test('prayers: visibility, anonymous, praying, updates', async () => {
  const pub = await call('dave', 'POST', '/prayers', { title: 'Healing for my aunt', body: 'Surgery Tuesday', audience: 'Public', anonymous: true });
  const priv = await call('dave', 'POST', '/prayers', { title: 'Private one', body: '', audience: 'Private' });
  const list = await call('erin', 'GET', '/prayers');
  const seen = list.json.items.find((x) => x.id === pub.json.id);
  assert.equal(seen.author, null, 'anonymous prayers hide the author');
  assert.ok(!list.json.items.find((x) => x.id === priv.json.id), 'private prayers stay private');
  assert.deepEqual((await call('erin', 'POST', `/prayers/${pub.json.id}/pray`)).json, { prayed: true, praying: 1 });
  assert.equal((await call('erin', 'POST', `/prayers/${pub.json.id}/updates`, { text: 'hi' })).status, 403);
  const up = await call('dave', 'POST', `/prayers/${pub.json.id}/updates`, { text: 'Surgery went well!', status: 'answered' });
  assert.equal(up.json.status, 'answered');
  assert.equal(up.json.updates[0].text, 'Surgery went well!');
});

test('jobs: bidding charges 20 coins atomically', async () => {
  const job = await call('frank', 'POST', '/jobs', { kind: 'task', title: 'Edit sermon clips', description: 'Five reels', skills: ['Premiere'] });
  assert.equal(job.status, 201);
  const jid = job.json.id;
  assert.equal((await call('frank', 'POST', `/jobs/${jid}/bids`, { cover: 'me' })).json.code, 'OWN_JOB');
  const bid = await call('gina', 'POST', `/jobs/${jid}/bids`, { cover: 'I can do it', amount: '$100' });
  assert.equal(bid.status, 201);
  assert.equal(bid.json.coins, 30);
  assert.equal((await call('gina', 'POST', `/jobs/${jid}/bids`, { cover: 'again' })).json.code, 'ALREADY_BID');
  assert.equal((await call('gina', 'GET', `/jobs/${jid}`)).json.myBid.feeCoins, 20);
  assert.equal((await call('frank', 'GET', `/jobs/${jid}/bids`)).json.items.length, 1);
  assert.equal((await call('gina', 'GET', `/jobs/${jid}/bids`)).status, 403);
  // second job: gina has 30 → can bid once more, then insufficient
  const j2 = (await call('frank', 'POST', '/jobs', { title: 'Design a flyer', description: '' })).json.id;
  const j3 = (await call('frank', 'POST', '/jobs', { title: 'Build a site', description: '' })).json.id;
  assert.equal((await call('gina', 'POST', `/jobs/${j2}/bids`, { cover: 'yes' })).json.coins, 10);
  const no = await call('gina', 'POST', `/jobs/${j3}/bids`, { cover: 'yes' });
  assert.equal(no.status, 402);
  assert.equal(no.json.code, 'INSUFFICIENT_COINS');
  assert.equal((await call('gina', 'GET', '/me')).json.coins, 10, 'failed bid must not take coins');
  const ledger = (await call('gina', 'GET', '/coins/ledger')).json.items;
  assert.deepEqual(ledger.map((x) => x.amount), [-20, -20, 50]);
});

test('ads: 5 job ads unlock 20 coins; support capped at 4/day; claims can be disabled', async () => {
  for (let i = 1; i <= 4; i++) assert.equal((await call('hana', 'POST', '/ads/claim', { purpose: 'job' })).json.jobAdCredits, i);
  const fifth = await call('hana', 'POST', '/ads/claim', { purpose: 'job' });
  assert.deepEqual([fifth.json.jobAdCredits, fifth.json.coins, fifth.json.unlocked], [0, 70, 20]);
  for (let i = 0; i < 6; i++) await call('hana', 'POST', '/ads/claim', { purpose: 'support' });
  assert.equal((await call('hana', 'GET', '/me')).json.supportAdsToday, 4);
  const off = await app.fetch(new Request('http://api.test/ads/claim', { method: 'POST', headers: { 'X-Dev-User': 'hana', 'Content-Type': 'application/json' }, body: '{"purpose":"job"}' }), { ...env, ADS_CLIENT_CLAIM: 'false' });
  assert.equal(off.status, 403);
});

test('AdMob SSV signature verification + replay protection', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const userId = (await call('ivan', 'GET', '/me')).json.id;
  const sign = async (msg) => {
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(msg)));
    // raw r||s → DER, like Google sends
    const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.from([0, ...b]); return [0x02, b.length, ...b]; };
    const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
    return Buffer.from(Uint8Array.from([0x30, body.length, ...body])).toString('base64url');
  };
  const qs = `ad_network=5450213213286189855&ad_unit=1234&custom_data=job&key_id=1&reward_amount=1&reward_item=coin&timestamp=${Date.now()}&transaction_id=tx-1&user_id=${userId}`;
  const sig = await sign(qs);
  const senv = { ...env, __ssvKey: kp.publicKey };
  const hit = (s) => app.fetch(new Request(`http://api.test/ads/ssv?${qs}&signature=${s}`), senv);
  assert.equal((await hit('AAAA')).status, 400);
  assert.equal((await hit(sig)).status, 200);
  assert.equal((await hit(sig)).status, 200); // replay is accepted but not counted
  assert.equal((await call('ivan', 'GET', '/me')).json.jobAdCredits, 1);
});

test('games: coins only on the first round per game per day', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const a = await call('jo', 'POST', '/games/results', { gameId: 'trivia_master', day, correct: 9, total: 12 });
  assert.deepEqual([a.json.coinsEarned, a.json.coins], [45, 95]);
  const b = await call('jo', 'POST', '/games/results', { gameId: 'trivia_master', day, correct: 12, total: 12 });
  assert.deepEqual([b.json.coinsEarned, b.json.best], [0, 12]);
  assert.equal((await call('jo', 'POST', '/games/results', { gameId: 'trivia_master', day: '2020-01-01', correct: 1, total: 2 })).json.code, 'BAD_DAY');
  assert.equal((await call('jo', 'POST', '/games/results', { gameId: 'x', day, correct: 1, total: 2 })).status, 400);
  assert.equal((await call('jo', 'POST', '/games/results', { gameId: 'who_said_it', day, correct: 30, total: 12 })).status, 400);
});

test('contract fixes: seeded like counts, author isFollowing, following list, game id aliases, tz day, bid withdraw/close', async () => {
  const p = await call('kim', 'POST', '/posts', { text: 'hello' });
  await env.__db.query('UPDATE posts SET likes_count = 48 WHERE id = $1', [p.json.id]);
  assert.equal((await call('lee', 'POST', `/posts/${p.json.id}/react`, { reaction: 'like' })).json.likes, 49);
  assert.equal((await call('lee', 'POST', `/posts/${p.json.id}/react`, { reaction: 'amen' })).json.likes, 49);
  assert.equal((await call('lee', 'POST', `/posts/${p.json.id}/react`, { reaction: null })).json.likes, 48);
  const kimId = (await call('kim', 'GET', '/me')).json.id;
  await call('lee', 'POST', `/users/${kimId}/follow`);
  assert.equal((await call('lee', 'GET', `/posts/${p.json.id}`)).json.author.isFollowing, true);
  assert.equal((await call('lee', 'GET', '/me/following')).json.items[0].id, kimId);
  // app game ids are accepted; the device's time zone decides "today"
  const tz = { 'X-TZ-Offset': '840' };
  const localDay = new Date(Date.now() + 840 * 60000).toISOString().slice(0, 10);
  const g = await call('lee', 'POST', '/games/results', { gameId: 'trivia', day: localDay, correct: 2, total: 4 }, tz);
  assert.equal(g.json.coinsEarned, 10);
  // withdraw + close
  const jid = (await call('kim', 'POST', '/jobs', { title: 'Logo for youth fellowship', description: '' })).json.id;
  const bid = (await call('lee', 'POST', `/jobs/${jid}/bids`, { cover: 'happy to help' })).json.bid;
  assert.equal((await call('lee', 'POST', `/bids/${bid.id}/withdraw`)).json.bid.status, 'withdrawn');
  assert.equal((await call('lee', 'POST', `/jobs/${jid}/bids`, { cover: 'again' })).json.code, 'ALREADY_BID');
  assert.equal((await call('lee', 'POST', `/jobs/${jid}/close`)).status, 403);
  assert.equal((await call('kim', 'POST', `/jobs/${jid}/close`)).json.status, 'closed');
});

test('phase 2: realtime ticket auth', async () => {
  const t = await call('alice', 'POST', '/realtime/ticket');
  assert.equal(t.status, 200);
  assert.ok(t.json.ticket);
  assert.equal(t.json.expiresIn, 60);

  // Without ticket -> 401
  const noTicket = await app.fetch(new Request('http://api.test/realtime'), env);
  assert.equal(noTicket.status, 401);

  // Invalid ticket -> 401
  const badTicket = await app.fetch(new Request('http://api.test/realtime?ticket=invalid-ticket'), env);
  assert.equal(badTicket.status, 401);
});

test('phase 2: direct messages, idempotency, read receipts, and soft deletion', async () => {
  const aliceId = (await call('alice', 'GET', '/me')).json.id;
  const bobId = (await call('bob', 'GET', '/me')).json.id;

  // Mutual follow so it's a direct conversation, not a request
  await call('alice', 'POST', `/users/${bobId}/follow`);
  await call('bob', 'POST', `/users/${aliceId}/follow`);

  const conv = await call('alice', 'POST', '/conversations/dm', { userId: bobId });
  assert.equal(conv.status, 201);
  const convId = conv.json.id;

  // Send message
  const m1 = await call('alice', 'POST', `/conversations/${convId}/messages`, {
    kind: 'text',
    text: 'Hello Bob! Praise God.',
    clientId: 'c_1',
  });
  assert.equal(m1.status, 201);
  assert.equal(m1.json.text, 'Hello Bob! Praise God.');
  assert.equal(m1.json.isMe, true);

  // Idempotency: same clientId returns the existing message
  const m1Dup = await call('alice', 'POST', `/conversations/${convId}/messages`, {
    kind: 'text',
    text: 'Hello Bob! Praise God.',
    clientId: 'c_1',
  });
  assert.equal(m1Dup.json.id, m1.json.id);

  // Bob reads conversation list
  const bobConvs = await call('bob', 'GET', '/conversations');
  assert.equal(bobConvs.status, 200);
  const foundConv = bobConvs.json.items.find((c) => c.id === convId);
  assert.ok(foundConv);
  assert.equal(foundConv.unreadCount, 1);
  assert.equal(foundConv.lastMessage.text, 'Hello Bob! Praise God.');

  // Bob marks conversation read
  await call('bob', 'POST', `/conversations/${convId}/read`);
  const bobConvsAfterRead = await call('bob', 'GET', '/conversations');
  const readConv = bobConvsAfterRead.json.items.find((c) => c.id === convId);
  assert.equal(readConv.unreadCount, 0);

  // Bob replies
  const m2 = await call('bob', 'POST', `/conversations/${convId}/messages`, {
    kind: 'text',
    text: 'Amen Alice!',
    replyTo: m1.json.id,
  });
  assert.equal(m2.status, 201);

  // Polling with ?after=
  const polled = await call('alice', 'GET', `/conversations/${convId}/messages?after=${m1.json.createdAt}`);
  assert.equal(polled.json.items.length, 1);
  assert.equal(polled.json.items[0].text, 'Amen Alice!');

  // Alice soft deletes her message
  await call('alice', 'POST', `/messages/${m1.json.id}/delete`);
  const messagesAfterDel = await call('bob', 'GET', `/conversations/${convId}/messages`);
  const deletedMsg = messagesAfterDel.json.items.find((m) => m.id === m1.json.id);
  assert.equal(deletedMsg.deleted, true);
  assert.equal(deletedMsg.text, 'This message was deleted');

  // Mute conversation
  const muteRes = await call('bob', 'POST', `/conversations/${convId}/mute`);
  assert.equal(muteRes.json.muted, true);
});

test('phase 2: direct messages need no request, and blocking still works', async () => {
  const carolId = (await call('carol', 'GET', '/me')).json.id;
  const daveId = (await call('dave', 'GET', '/me')).json.id;

  // WhatsApp-style: Carol can message Dave without following or a request to accept
  const dm = await call('carol', 'POST', '/conversations/dm', { userId: daveId });
  assert.equal(dm.json.isRequest, false);
  assert.equal(dm.json.canMessage, true);
  const reqs = await call('dave', 'GET', '/me/requests');
  assert.equal(reqs.status, 200);
  assert.ok(!reqs.json.items.some((r) => r.fromId === carolId));

  // Block Carol
  await call('dave', 'POST', `/users/${carolId}/block`);
  const blockedTry = await call('carol', 'POST', `/conversations/${dm.json.id}/messages`, { text: 'Are you there?' });
  assert.equal(blockedTry.status, 403);
  assert.equal(blockedTry.json.code, 'BLOCKED');

  // Unblock Carol
  await call('dave', 'DELETE', `/users/${carolId}/block`);
  const unblockedTry = await call('carol', 'POST', `/conversations/${dm.json.id}/messages`, { text: 'Back now!' });
  assert.equal(unblockedTry.status, 201);
});

test('phase 2: voice notes and authenticated chat media access', async () => {
  const e1Id = (await call('eva', 'GET', '/me')).json.id;
  const f1Id = (await call('frank', 'GET', '/me')).json.id;
  await call('eva', 'POST', `/users/${f1Id}/follow`);
  await call('frank', 'POST', `/users/${e1Id}/follow`);
  const conv = await call('eva', 'POST', '/conversations/dm', { userId: f1Id });
  const convId = conv.json.id;

  // Eva uploads a voice note for this conversation
  const voiceBuf = Buffer.from('mock audio voice bytes 12345');
  const upRes = await call('eva', 'POST', '/uploads/voice', voiceBuf, {
    'Content-Type': 'audio/m4a',
    'X-Conversation-Id': convId,
  });
  assert.equal(upRes.status, 201);
  assert.ok(upRes.json.key.startsWith(`chat/${convId}/`));

  // Eva and Frank can read it through /chat/media
  const frankGet = await call('frank', 'GET', `/chat/media/${upRes.json.key}`);
  assert.equal(frankGet.status, 200);

  // Non-member stranger cannot access chat media
  const strangerGet = await call('stranger', 'GET', `/chat/media/${upRes.json.key}`);
  assert.equal(strangerGet.status, 403);
});

test('phase 2: communities, channels, join approval and message pinning', async () => {
  // Grace creates a public community
  const comm = await call('grace', 'POST', '/communities', {
    name: 'Worship Leaders Fellowship',
    description: 'A global network of worship teams and leaders.',
    privacy: 'Public',
  });
  assert.equal(comm.status, 201);
  assert.equal(comm.json.channels.length, 5); // General, Prayer, Bible Study, Announcements, Events
  const commId = comm.json.id;
  const generalChannel = comm.json.channels.find((ch) => ch.name === 'General');
  assert.ok(generalChannel);

  // Henry joins the public community
  const joinRes = await call('henry', 'POST', `/communities/${commId}/join`);
  assert.equal(joinRes.json.status, 'member');

  // Henry sends a message in General channel
  const postMsg = await call('henry', 'POST', `/conversations/${generalChannel.conversationId}/messages`, {
    text: 'Grace and peace to everyone here!',
  });
  assert.equal(postMsg.status, 201);

  // Grace pins the message
  const pinRes = await call('grace', 'POST', `/communities/${commId}/pin`, {
    conversationId: generalChannel.conversationId,
    messageId: postMsg.json.id,
  });
  assert.equal(pinRes.json.pinnedMessageId, postMsg.json.id);

  // Private community with approval flow
  const privateComm = await call('grace', 'POST', '/communities', {
    name: 'Secret Prayer Circle',
    privacy: 'Private',
  });
  const privId = privateComm.json.id;

  // Henry requests to join
  const reqJoin = await call('henry', 'POST', `/communities/${privId}/join`);
  assert.equal(reqJoin.json.status, 'requested');

  // Grace approves Henry
  const henryId = (await call('henry', 'GET', '/me')).json.id;
  const approveRes = await call('grace', 'POST', `/communities/${privId}/members/${henryId}`, { action: 'approve' });
  assert.equal(approveRes.json.status, 'member');
});

test('phase 2: calendar events and RSVPs', async () => {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const endsAt = new Date(Date.now() + 90000000).toISOString();

  const ev = await call('ian', 'POST', '/events', {
    title: 'Night of Worship & Prayer',
    description: 'Join us for acoustic worship and intercession.',
    startsAt,
    endsAt,
    location: 'Grace Chapel Main Hall',
  });
  assert.equal(ev.status, 201);
  assert.equal(ev.json.myRsvp, 'going');
  const evId = ev.json.id;

  // Jack RSVPs 'interested'
  const rsvpRes = await call('jack', 'POST', `/events/${evId}/rsvp`, { status: 'interested' });
  assert.equal(rsvpRes.json.myRsvp, 'interested');
  assert.equal(rsvpRes.json.goingCount, 1);
  assert.equal(rsvpRes.json.interestedCount, 1);

  // Attendees list
  const att = await call('jack', 'GET', `/events/${evId}/attendees`);
  assert.equal(att.json.items.length, 2);
});

test('phase 2: make a wish, candle lighting, and amens', async () => {
  const wish = await call('kate', 'POST', '/wishes', {
    title: 'Healing for my grandmother',
    body: 'Please stand with our family in faith for complete healing and peace.',
    category: 'Healing',
    anonymous: false,
  });
  assert.equal(wish.status, 201);
  assert.equal(wish.json.candlesCount, 0);
  assert.equal(wish.json.amenCount, 0);
  const wishId = wish.json.id;

  // Luke lights a candle
  const c1 = await call('luke', 'POST', `/wishes/${wishId}/candle`);
  assert.equal(c1.json.litCandle, true);
  assert.equal(c1.json.candlesCount, 1);

  // Luke toggles candle off
  const c2 = await call('luke', 'POST', `/wishes/${wishId}/candle`);
  assert.equal(c2.json.litCandle, false);
  assert.equal(c2.json.candlesCount, 0);

  // Luke amens wish
  const a1 = await call('luke', 'POST', `/wishes/${wishId}/amen`);
  assert.equal(a1.json.amened, true);
  assert.equal(a1.json.amenCount, 1);
});

test('phase 2: bible study sync (notes, highlights, bookmarks, plans)', async () => {
  // Mark adds a highlight
  const hl = await call('mark', 'PUT', '/me/study/highlights', {
    bookId: 'JHN',
    chapter: 3,
    verse: 16,
    color: 'yellow',
  });
  assert.equal(hl.status, 200);
  assert.equal(hl.json.color, 'yellow');

  // Mark creates a study note
  const nt = await call('mark', 'PUT', '/me/study/notes', {
    bookId: 'JHN',
    chapter: 3,
    verse: 16,
    text: 'The heart of the Gospel.',
  });
  assert.equal(nt.status, 200);

  // Mark adds bookmark
  const bm = await call('mark', 'PUT', '/me/study/bookmarks', {
    bookId: 'PSA',
    chapter: 23,
    label: 'The Lord is my Shepherd',
  });
  assert.equal(bm.status, 200);

  // Mark marks a reading plan day completed
  const pl = await call('mark', 'PUT', '/me/study/plans', {
    planId: 'plan_21_days',
    day: 7,
    done: true,
  });
  assert.equal(pl.json.done, true);

  // Sync endpoint returns all items
  const syncRes = await call('mark', 'GET', '/me/study');
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.json.highlights.length, 1);
  assert.equal(syncRes.json.notes.length, 1);
  assert.equal(syncRes.json.bookmarks.length, 1);
  assert.equal(syncRes.json.plans.length, 1);
});

test('phase 2: gifts atomic transfer, creator share, and balance validation', async () => {
  const nathanId = (await call('nathan', 'GET', '/me')).json.id;
  const oliviaId = (await call('olivia', 'GET', '/me')).json.id;

  // Nathan has 50 welcome coins. Sends Rose (5 coins) to Olivia
  const giftRes = await call('nathan', 'POST', '/gifts', {
    toUserId: oliviaId,
    giftId: 'g_rose',
  });
  assert.equal(giftRes.status, 201);
  assert.equal(giftRes.json.coinsRemaining, 45); // 50 - 5 = 45
  assert.equal(giftRes.json.coinsGiven, 4); // 70% of 5 rounded = 4 coins

  const oliviaMe = await call('olivia', 'GET', '/me');
  assert.equal(oliviaMe.json.coins, 54); // 50 welcome + 4 = 54

  // Self gift forbidden
  const selfGift = await call('nathan', 'POST', '/gifts', { toUserId: nathanId, giftId: 'g_rose' });
  assert.equal(selfGift.status, 400);

  // Insufficient coins: Nathan tries to send Royal Crown (500 coins)
  const tooExpensive = await call('nathan', 'POST', '/gifts', { toUserId: oliviaId, giftId: 'g_crown' });
  assert.equal(tooExpensive.status, 402);
  assert.equal(tooExpensive.json.code, 'INSUFFICIENT_COINS');
});

test('phase 2: notifications inbox and preferences', async () => {
  // Update notification settings
  const putRes = await call('paul', 'PUT', '/me/notify-settings', {
    messages: true,
    gifts: false,
  });
  assert.equal(putRes.json.gifts, false);
  assert.equal(putRes.json.messages, true);

  // Read notifications
  const notifs = await call('paul', 'GET', '/me/notifications');
  assert.equal(notifs.status, 200);
  assert.ok(Array.isArray(notifs.json.items));
});

test('phase 2: brand-new user ignores client bestStreak', async () => {
  // Brand-new user tries to send bestStreak 21 to PUT /me
  const putRes = await call('newbie', 'PUT', '/me', { displayName: 'Newbie', bestStreak: 21 });
  assert.equal(putRes.status, 200);
  assert.equal(putRes.json.bestStreak, 0);
  assert.equal(putRes.json.streak, 0);

  // GET /me returns streak 0, bestStreak 0
  const newbieMe = await call('newbie', 'GET', '/me');
  assert.equal(newbieMe.status, 200);
  assert.equal(newbieMe.json.streak, 0);
  assert.equal(newbieMe.json.bestStreak, 0);
  assert.equal(newbieMe.json.graceUsedThisWeek, false);
});

test('phase 2: daily rhythm offline catch-up, step union, streak computation, grace days, and privacy', async () => {
  const ruthMe = await call('ruth', 'GET', '/me');
  assert.equal(ruthMe.status, 200);
  assert.equal(ruthMe.json.streak, 0);

  const todayStr = new Date().toISOString().slice(0, 10);
  const twoDaysAgoStr = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const fiveDaysAgoStr = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const eightDaysAgoStr = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const futureStr = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  // 1. Offline catch-up range: 5 days back accepted, 8 days back rejected, future +2 rejected
  const accept5Days = await call('ruth', 'PUT', `/me/rhythm/${fiveDaysAgoStr}`, { steps: ['verse'] });
  assert.equal(accept5Days.status, 200);
  assert.deepEqual(accept5Days.json.steps, ['verse']);

  const reject8Days = await call('ruth', 'PUT', `/me/rhythm/${eightDaysAgoStr}`, { steps: ['verse'] });
  assert.equal(reject8Days.status, 400);
  assert.equal(reject8Days.json.code, 'DATE_OUT_OF_RANGE');

  const rejectFuture = await call('ruth', 'PUT', `/me/rhythm/${futureStr}`, { steps: ['verse'] });
  assert.equal(rejectFuture.status, 400);
  assert.equal(rejectFuture.json.code, 'DATE_OUT_OF_RANGE');

  // 2. Two devices (two sessions) marking different steps on the same day -> union
  // Session 1 marks 'verse'
  const session1 = await call('ruth', 'PUT', `/me/rhythm/${todayStr}`, { steps: ['verse'] });
  assert.equal(session1.status, 200);
  assert.deepEqual(session1.json.steps.sort(), ['verse']);
  assert.equal(session1.json.streak, 1);

  // Session 2 marks 'reading' and 'prayer' on the same day
  const session2 = await call('ruth', 'PUT', `/me/rhythm/${todayStr}`, { steps: ['reading', 'prayer'] });
  assert.equal(session2.status, 200);
  assert.deepEqual(session2.json.steps.sort(), ['prayer', 'reading', 'verse']);

  // GET /me/rhythm confirms merged steps
  const rhythmGet = await call('ruth', 'GET', '/me/rhythm');
  assert.equal(rhythmGet.status, 200);
  const todayEntry = rhythmGet.json.days.find((d) => d.day === todayStr);
  assert.ok(todayEntry);
  assert.deepEqual(todayEntry.steps.sort(), ['prayer', 'reading', 'verse']);

  // 3. Streak with a grace day
  // Two days ago: completed (via allowed PUT catch-up). Yesterday: missed. Today: completed.
  const acceptTwoDays = await call('ruth', 'PUT', `/me/rhythm/${twoDaysAgoStr}`, { steps: ['verse'] });
  assert.equal(acceptTwoDays.status, 200);

  const ruthWithGrace = await call('ruth', 'GET', '/me');
  assert.equal(ruthWithGrace.status, 200);
  assert.equal(ruthWithGrace.json.streak, 2);
  assert.equal(ruthWithGrace.json.graceUsedThisWeek, true);
  assert.ok(ruthWithGrace.json.bestStreak >= 2);

  // 4. Reflection never returned to other users
  const secretReflection = 'Deep private prayer for healing and guidance';
  const saveReflection = await call('ruth', 'PUT', `/me/rhythm/${todayStr}`, {
    steps: ['reflect'],
    reflection: secretReflection,
  });
  assert.equal(saveReflection.status, 200);
  assert.equal(saveReflection.json.reflection, secretReflection);

  // User 'bob' inspects ruth's public profile
  const bobViewsRuth = await call('bob', 'GET', `/users/${ruthMe.json.id}`);
  assert.equal(bobViewsRuth.status, 200);
  assert.equal(bobViewsRuth.json.reflection, undefined);
  assert.equal(bobViewsRuth.json.steps, undefined);
  assert.equal(bobViewsRuth.json.rhythm, undefined);

  // User 'bob' queries public feed - ruth's reflection is not there
  const feed = await call('bob', 'GET', '/feed');
  assert.equal(feed.status, 200);
  for (const item of feed.json.items) {
    assert.notEqual(item.text, secretReflection);
  }

  // Ruth can retrieve her own reflection via /me/rhythm
  const ruthOwnRhythm = await call('ruth', 'GET', '/me/rhythm');
  const ruthToday = ruthOwnRhythm.json.days.find((d) => d.day === todayStr);
  assert.equal(ruthToday.reflection, secretReflection);
});


