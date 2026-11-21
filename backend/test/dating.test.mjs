// FIND LOVE (brief §9, client spec §5 / §6 / §7 / §13 / §14): 18+ only, separate dating profile, blocks respected
// everywhere, mutual like → match + labelled dating chat, swipe allowance + "+20 swipes", every coin use deducts exactly
// once (idempotent) and never without enough coins, the rewarded-ad unlock (server nonce, single use, SSV, 5 + 5 free
// then 20-coin bundles), gift messages not counted, Plus / VIP unrestricted, boosts rank without bypassing preferences or
// blocks and expire, VIP monthly grant once per cycle, admin-only routes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import * as W from '../src/lib/wallet.js';
import * as D from '../src/lib/dating.js';
import { DATING_ADMIN_SCRIPT } from '../src/lib/datingAdminPage.js';
import { renewSubscription, grantCycleBenefits, getProduct } from '../src/lib/walletStore.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', WALLET_TEST_PURCHASES: 'true', WALLET_TESTERS: 'pete,vera' };
});
async function call(user, method, path, body, e = env) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), e);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json };
}
const ids = {};
let n = 0;
const key = () => `dk_${Date.now()}_${++n}`;
const coins = (u) => W.getBalance(env, ids[u], 'dating_coins');
const yearsAgo = (y, d = 0) => { const t = new Date(); t.setUTCFullYear(t.getUTCFullYear() - y); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
async function rules(patch) { await W.setConfig(env, 'dating_rules', { ...D.DEFAULT_RULES, ...patch }); }
async function mkProfile(u, { gender, interestedIn, age = 28, city = 'Lagos', country = 'Nigeria', prefs = { ageMin: 18, ageMax: 60 }, photo = true, ...rest }) {
  if (!ids[u]) ids[u] = (await call(u, 'GET', '/me')).json.id;
  const r = await call(u, 'PUT', '/dating/profile', { firstName: u[0].toUpperCase() + u.slice(1), birthDate: yearsAgo(age), confirmAdult: true, gender, interestedIn, city, country, denomination: 'Pentecostal', churchInvolvement: 'Attends weekly', intention: 'marriage', bio: `Hi, I am ${u}`, prefs, ...rest });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
  if (photo) await q(env, `INSERT INTO dating_photos (user_id, url, status) VALUES ($1, $2, 'approved')`, [ids[u], `https://images.example/${u}.jpg`]);
  return r.json.profile;
}
const stack = async (u, limit = 50) => (await call(u, 'GET', `/dating/discover?limit=${limit}`)).json.items.map((x) => x.userId);
const name = (id) => Object.keys(ids).find((k) => ids[k] === id);

test('setup: admin, members; admin script is a plain string', async () => {
  for (const u of ['boss', 'adam', 'ben', 'carl', 'dan', 'eve', 'fay', 'gia', 'hana', 'ivy', 'pete', 'vera', 'kid']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  assert.ok(!DATING_ADMIN_SCRIPT.includes('`') && !DATING_ADMIN_SCRIPT.includes('${'), 'admin script must be a plain string');
  await rules({ dailySwipes: 50 });
});

test('18+ only: under-18 refused and nothing stored; adult confirmation required', async () => {
  const young = await call('kid', 'PUT', '/dating/profile', { firstName: 'Kid', birthDate: yearsAgo(18, 1), confirmAdult: true, gender: 'man', interestedIn: 'women' });
  assert.equal(young.status, 403); assert.equal(young.json.code, 'AGE_RESTRICTED');
  assert.equal(await one(env, 'SELECT 1 FROM dating_profiles WHERE user_id = $1', [ids.kid]), null);
  const noConfirm = await call('kid', 'PUT', '/dating/profile', { firstName: 'Kid', birthDate: yearsAgo(30), gender: 'man', interestedIn: 'women' });
  assert.equal(noConfirm.json.code, 'ADULT_CONFIRMATION_REQUIRED');
  const exactly18 = await call('kid', 'PUT', '/dating/profile', { firstName: 'Kid', birthDate: yearsAgo(18), confirmAdult: true, gender: 'man', interestedIn: 'women' });
  assert.equal(exactly18.status, 201); assert.equal(exactly18.json.profile.age, 18);
  // an edit can never make the profile younger than 18
  assert.equal((await call('kid', 'PUT', '/dating/profile', { birthDate: yearsAgo(17) })).json.code, 'AGE_RESTRICTED');
  // the API never accepts coordinates: location is city level only
  const p = (await call('kid', 'PUT', '/dating/profile', { city: 'Abuja', lat: 9.07, lng: 7.4 })).json.profile;
  assert.equal(p.city, 'Abuja'); assert.equal(p.lat, undefined);
  await call('kid', 'DELETE', '/dating/profile');
});

test('the dating profile is separate from the social profile', async () => {
  await q(env, `UPDATE users SET display_name = 'Adam Social', bio = 'Worship leader' WHERE id = $1`, [ids.adam]);
  const p = await mkProfile('adam', { gender: 'man', interestedIn: 'women', firstName: 'Ade', bio: 'Looking for a godly wife' });
  assert.equal(p.firstName, 'Ade');
  const u = await one(env, 'SELECT display_name, bio FROM users WHERE id = $1', [ids.adam]);
  assert.deepEqual([u.display_name, u.bio], ['Adam Social', 'Worship leader']);
  const social = await call('eve', 'GET', `/users/${ids.adam}`);
  assert.ok(!JSON.stringify(social.json).includes('Looking for a godly wife'), 'dating bio never appears on the social profile');
  // the dating card shows the dating first name, never the birth date
  await mkProfile('eve', { gender: 'woman', interestedIn: 'men' });
  const card = (await call('eve', 'GET', `/dating/profiles/${ids.adam}`)).json;
  assert.equal(card.firstName, 'Ade'); assert.equal(card.birthDate, undefined); assert.equal(typeof card.age, 'number');
});

test('discovery: both people’s gender + age preferences, and blocks (either way) are never shown', async () => {
  await mkProfile('ben', { gender: 'man', interestedIn: 'women', age: 30 });
  await mkProfile('carl', { gender: 'man', interestedIn: 'women', age: 45 });                         // outside eve's age range below
  await mkProfile('dan', { gender: 'man', interestedIn: 'men', age: 29 });                            // not looking for women
  await mkProfile('fay', { gender: 'woman', interestedIn: 'men', age: 27 });
  await q(env, `UPDATE dating_profiles SET prefs = $2::jsonb WHERE user_id = $1`, [ids.eve, JSON.stringify({ ageMin: 25, ageMax: 40 })]);
  let s = await stack('eve');
  assert.ok(s.includes(ids.adam) && s.includes(ids.ben));
  assert.ok(!s.includes(ids.carl), 'age preference respected');
  assert.ok(!s.includes(ids.dan), 'his preference respected');
  assert.ok(!s.includes(ids.fay) && !s.includes(ids.eve), 'not yourself / not outside your own preference');
  // ben blocks eve in Socials → neither sees the other in Find Love
  await call('ben', 'POST', `/users/${ids.eve}/block`);
  assert.ok(!(await stack('eve')).includes(ids.ben));
  assert.ok(!(await stack('fay')).includes(ids.ben) === false, 'others still see ben');
  assert.equal((await call('eve', 'GET', `/dating/profiles/${ids.ben}`)).status, 404);
  assert.equal((await call('eve', 'POST', '/dating/swipe', { targetId: ids.ben, action: 'like' })).status, 404);
  // blocked via Find Love also blocks app-wide
  await call('fay', 'POST', '/dating/block', { userId: ids.carl });
  assert.ok(await one(env, 'SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [ids.fay, ids.carl]));
  // paused and pending-photo profiles are hidden
  await call('adam', 'POST', '/dating/profile/pause', { paused: true });
  assert.ok(!(await stack('eve')).includes(ids.adam));
  await call('adam', 'POST', '/dating/profile/pause', { paused: false });
  await mkProfile('gia', { gender: 'woman', interestedIn: 'men', photo: false });
  const add = await call('gia', 'POST', '/dating/profile/photos', { key: `img/${ids.gia}/a.jpg` });
  assert.equal(add.status, 201); assert.equal(add.json.profile.photos[0].status, 'pending');
  assert.equal((await call('gia', 'POST', '/dating/profile/photos', { key: `img/${ids.eve}/a.jpg` })).json.code, 'BAD_PHOTO');
  assert.ok(!(await stack('adam')).includes(ids.gia), 'pending photo → not visible (pre-moderation)');
  assert.equal((await call('adam', 'POST', `/admin/api/dating/photos/${add.json.id}`, { status: 'approved' })).status, 403);
  assert.equal((await call('boss', 'POST', `/admin/api/dating/photos/${add.json.id}`, { status: 'approved' })).status, 200);
  assert.ok((await stack('adam')).includes(ids.gia));
});

test('mutual like → match + a dating-labelled chat; passes are never shown again', async () => {
  assert.equal((await call('fay', 'POST', '/dating/swipe', { targetId: ids.adam, action: 'pass' })).json.action, 'pass');
  assert.ok(!(await stack('fay')).includes(ids.adam));
  const a = await call('eve', 'POST', '/dating/swipe', { targetId: ids.adam, action: 'like' });
  assert.equal(a.status, 200); assert.equal(a.json.match, null);
  const again = await call('eve', 'POST', '/dating/swipe', { targetId: ids.adam, action: 'like' });
  assert.equal(again.json.duplicate, true);
  const b = await call('adam', 'POST', '/dating/swipe', { targetId: ids.eve, action: 'like' });
  assert.ok(b.json.match && b.json.match.conversationId);
  const conv = b.json.match.conversationId;
  ids.convAE = conv;
  assert.ok(await one(env, `SELECT 1 FROM dating_conversations WHERE conversation_id = $1 AND status = 'match'`, [conv]));
  assert.equal((await q(env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1', [conv])).length, 2);
  const m = (await call('eve', 'GET', '/dating/matches')).json.items;
  assert.equal(m.length, 1); assert.equal(m[0].profile.firstName, 'Ade'); assert.equal(m[0].conversationId, conv);
  assert.equal((await one(env, `SELECT count(*)::int AS n FROM dating_matches`)).n, 1);
  // dating chats do not use a free platform-chat slot
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM chat_slots WHERE conversation_id = $1', [conv])).n, 0);
});

test('daily swipe allowance and "+20 swipes" for 30 coins (idempotent)', async () => {
  await rules({ dailySwipes: 2 });
  await mkProfile('hana', { gender: 'woman', interestedIn: 'men', age: 33 });
  for (const u of ['ivy']) await mkProfile(u, { gender: 'woman', interestedIn: 'men', age: 31 });
  // ben (blocked by nobody here) has 2 swipes today
  assert.equal((await call('ben', 'POST', '/dating/swipe', { targetId: ids.hana, action: 'pass' })).status, 200);
  assert.equal((await call('ben', 'POST', '/dating/swipe', { targetId: ids.ivy, action: 'pass' })).status, 200);
  const limited = await call('ben', 'POST', '/dating/swipe', { targetId: ids.gia, action: 'like' });
  assert.equal(limited.status, 429); assert.equal(limited.json.code, 'SWIPE_LIMIT_REACHED'); assert.equal(limited.json.offer.coins, 30);
  const poor = await call('ben', 'POST', '/dating/swipes/extra', { idempotencyKey: key() });
  assert.equal(poor.status, 402); assert.equal(poor.json.code, 'INSUFFICIENT_BALANCE');
  await W.credit(env, { ref: 'seed:ben', userId: ids.ben, wallet: 'dating_coins', amount: 100, kind: 'admin_adjust' });
  const k = key();
  const buy = await call('ben', 'POST', '/dating/swipes/extra', { idempotencyKey: k });
  assert.equal(buy.status, 200); assert.equal(buy.json.charged, true); assert.equal(buy.json.swipes.left, 20);
  const dup = await call('ben', 'POST', '/dating/swipes/extra', { idempotencyKey: k });
  assert.equal(dup.json.charged, false); assert.equal(await coins('ben'), 70); assert.equal(dup.json.swipes.limit, 22);
  assert.equal((await call('ben', 'POST', '/dating/swipe', { targetId: ids.gia, action: 'like' })).status, 200);
  await rules({ dailySwipes: 50 });
});

test('each coin use deducts exactly once; insufficient coins change nothing', async () => {
  await W.credit(env, { ref: 'seed:carl', userId: ids.carl, wallet: 'dating_coins', amount: 60, kind: 'admin_adjust' });
  // Super Like (10) — twice = one charge
  const s1 = await call('carl', 'POST', '/dating/swipe', { targetId: ids.hana, action: 'super_like' });
  const s2 = await call('carl', 'POST', '/dating/swipe', { targetId: ids.hana, action: 'super_like' });
  assert.equal(s1.json.charged.charged, true); assert.equal(s2.json.duplicate, true);
  assert.equal(await coins('carl'), 50);
  // the super-liker is ranked first in hana's stack and flagged
  const hs = (await call('hana', 'GET', '/dating/discover?limit=50')).json.items;
  assert.equal(hs[0].userId, ids.carl); assert.equal(hs[0].superLikedYou, true);
  // Priority Like (15)
  assert.equal((await call('carl', 'POST', '/dating/swipe', { targetId: ids.ivy, action: 'priority_like' })).json.charged.amount, 15);
  assert.equal(await coins('carl'), 35);
  // Message request (25) — the same request twice = one charge, one message
  const r1 = await call('carl', 'POST', '/dating/requests', { targetId: ids.gia, text: 'Hello Gia, God bless you', idempotencyKey: key() });
  const r2 = await call('carl', 'POST', '/dating/requests', { targetId: ids.gia, text: 'Hello Gia, God bless you', idempotencyKey: key() });
  assert.equal(r1.status, 201); assert.equal(r1.json.charged, true); assert.equal(r2.json.duplicate, true);
  assert.equal(await coins('carl'), 10);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [r1.json.conversationId])).n, 1);
  // a request chat is closed to messages until accepted
  const early = await call('carl', 'POST', `/conversations/${r1.json.conversationId}/messages`, { text: 'Are you there?' });
  assert.equal(early.status, 403); assert.equal(early.json.code, 'DATING_REQUEST_PENDING');
  const reqs = (await call('gia', 'GET', '/dating/requests')).json.items;
  assert.equal(reqs.length, 1); assert.equal(reqs[0].incoming, true); assert.equal(reqs[0].message, 'Hello Gia, God bless you');
  const acc = await call('gia', 'POST', `/dating/requests/${r1.json.conversationId}/accept`);
  assert.equal(acc.json.status, 'match'); assert.equal(acc.json.match.conversationId, r1.json.conversationId);
  // insufficient: 10 coins left, See who liked you costs 30 → 402 and nothing recorded
  const before = await one(env, 'SELECT count(*)::int AS n FROM dating_spends WHERE user_id = $1', [ids.carl]);
  const poor = await call('carl', 'POST', '/dating/likes/unlock', { idempotencyKey: key() });
  assert.equal(poor.status, 402); assert.equal(poor.json.code, 'INSUFFICIENT_BALANCE'); assert.equal(poor.json.shortBy, 20);
  const poorLike = await call('carl', 'POST', '/dating/swipe', { targetId: ids.eve, action: 'priority_like' });
  assert.equal(poorLike.status, 402);
  assert.equal(await one(env, 'SELECT 1 FROM dating_swipes WHERE user_id = $1 AND target_id = $2', [ids.carl, ids.eve]), null, 'no swipe without payment');
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM dating_spends WHERE user_id = $1', [ids.carl])).n, before.n);
  assert.equal(await coins('carl'), 10);
  // See who liked you (30) — per period: unlocks the list for 24 h; same key twice = one charge
  await W.credit(env, { ref: 'seed:hana', userId: ids.hana, wallet: 'dating_coins', amount: 100, kind: 'admin_adjust' });
  const locked = (await call('hana', 'GET', '/dating/likes')).json;
  assert.equal(locked.unlocked, false); assert.equal(locked.count, 1); assert.deepEqual(locked.items, []);
  const k = key();
  assert.equal((await call('hana', 'POST', '/dating/likes/unlock', { idempotencyKey: k })).json.charged, true);
  assert.equal((await call('hana', 'POST', '/dating/likes/unlock', { idempotencyKey: k })).json.charged, false);
  assert.equal((await call('hana', 'POST', '/dating/likes/unlock', { idempotencyKey: key() })).json.code, 'ALREADY_UNLOCKED');
  const open = (await call('hana', 'GET', '/dating/likes')).json;
  assert.equal(open.unlocked, true); assert.equal(open.items[0].userId, ids.carl);
  assert.equal(await coins('hana'), 70);
  // ledger: every spend has its own ref, labelled kind; balances = sum of entries
  const e = await q(env, `SELECT kind, amount FROM wallet_entries WHERE user_id = $1 AND wallet = 'dating_coins' AND amount < 0 ORDER BY id`, [ids.carl]);
  assert.deepEqual(e.map((x) => [x.kind, Number(x.amount)]), [['super_like', -10], ['priority_like', -15], ['message_request', -25]]);
  assert.equal((await W.ledgerIntegrity(env)).ok, true);
});

test('ad unlock: server nonce, signed + single-use claim, 5 + 5 free messages, then 20 coins per 5', async () => {
  const conv = ids.convAE; // eve ⇄ adam, both free
  const send = (u, t) => call(u, 'POST', `/conversations/${conv}/messages`, { text: t, clientId: key() });
  const locked = await send('eve', 'Hi Ade!');
  assert.equal(locked.status, 402); assert.equal(locked.json.code, 'DATING_MESSAGES_LOCKED'); assert.equal(locked.json.allowance.adUnlocksLeft, 2);
  const st = await call('eve', 'POST', `/dating/conversations/${conv}/ad/start`);
  assert.equal(st.status, 200); assert.match(st.json.nonce, /^[0-9a-f]{32}$/); assert.equal(st.json.purpose, `dating:${st.json.nonce}`);
  // forged token, someone else's nonce, too soon
  assert.equal((await call('eve', 'POST', '/dating/ads/claim', { nonce: st.json.nonce, token: 'forged' })).json.code, 'BAD_AD_TOKEN');
  assert.equal((await call('adam', 'POST', '/dating/ads/claim', { nonce: st.json.nonce, token: st.json.token })).status, 404);
  assert.equal((await call('eve', 'POST', '/dating/ads/claim', { nonce: st.json.nonce, token: st.json.token })).json.code, 'AD_TOO_SOON');
  await rules({ adMinWatchSec: 0 });
  const ok = await call('eve', 'POST', '/dating/ads/claim', { nonce: st.json.nonce, token: st.json.token });
  assert.equal(ok.status, 200); assert.equal(ok.json.applied, true); assert.equal(ok.json.allowance.left, 5);
  const dup = await call('eve', 'POST', '/dating/ads/claim', { nonce: st.json.nonce, token: st.json.token });
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'AD_ALREADY_CLAIMED');
  // concurrent double claims of one nonce → one reward
  const st2 = await call('eve', 'POST', `/dating/conversations/${conv}/ad/start`);
  const both = await Promise.all([1, 2, 3].map(() => call('eve', 'POST', '/dating/ads/claim', { nonce: st2.json.nonce, token: st2.json.token })));
  assert.equal(both.filter((r) => r.status === 200).length, 1);
  let info = (await call('eve', 'GET', `/dating/conversations/${conv}`)).json.allowance;
  assert.deepEqual([info.allowed, info.left, info.adUnlocksLeft], [10, 10, 0]);
  for (let i = 1; i <= 10; i++) assert.equal((await send('eve', `msg ${i}`)).status, 201, `message ${i}`);
  // a retried send (same clientId) never uses another message
  const cid = key();
  info = (await call('eve', 'GET', `/dating/conversations/${conv}`)).json.allowance;
  assert.equal(info.left, 0);
  const third = await call('eve', 'POST', `/dating/conversations/${conv}/ad/start`);
  assert.equal(third.status, 409); assert.equal(third.json.code, 'AD_UNLOCKS_USED');
  assert.equal((await send('eve', 'one more')).json.code, 'DATING_MESSAGES_LOCKED');
  // bundle: 20 coins → 5 messages, confirmed in the app, idempotent per key
  assert.equal((await call('eve', 'POST', `/dating/conversations/${conv}/bundle`, { idempotencyKey: key() })).status, 402);
  await W.credit(env, { ref: 'seed:eve', userId: ids.eve, wallet: 'dating_coins', amount: 50, kind: 'admin_adjust' });
  const bk = key();
  const b1 = await call('eve', 'POST', `/dating/conversations/${conv}/bundle`, { idempotencyKey: bk });
  const b2 = await call('eve', 'POST', `/dating/conversations/${conv}/bundle`, { idempotencyKey: bk });
  assert.equal(b1.json.charged, true); assert.equal(b2.json.charged, false); assert.equal(b2.json.allowance.left, 5);
  assert.equal(await coins('eve'), 30);
  const r1 = await call('eve', 'POST', `/conversations/${conv}/messages`, { text: 'retry me', clientId: cid });
  const r2 = await call('eve', 'POST', `/conversations/${conv}/messages`, { text: 'retry me', clientId: cid });
  assert.equal(r1.json.id, r2.json.id);
  assert.equal((await call('eve', 'GET', `/dating/conversations/${conv}`)).json.allowance.left, 4);
  // adam has his own allowance (free too): locked until he watches an ad
  assert.equal((await send('adam', 'Hello Eve')).json.code, 'DATING_MESSAGES_LOCKED');
  // non-dating DMs are untouched by the hook
  const dm = await call('eve', 'POST', '/conversations/dm', { userId: ids.fay });
  assert.notEqual(dm.json.id, conv);
  assert.equal((await call('eve', 'POST', `/conversations/${dm.json.id}/messages`, { text: 'hi fay' })).status, 201);
});

test('ad unlock via AdMob SSV; replayed transaction and SSV-only mode', async () => {
  const conv = ids.convAE;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const sign = async (msg) => {
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(msg)));
    const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.from([0, ...b]); return [0x02, b.length, ...b]; };
    const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
    return Buffer.from(Uint8Array.from([0x30, body.length, ...body])).toString('base64url');
  };
  const senv = { ...env, __ssvKey: kp.publicKey };
  const ssv = async (custom, tx) => {
    const qs = `ad_network=1&ad_unit=1&custom_data=${encodeURIComponent(custom)}&key_id=1&reward_amount=1&reward_item=msg&timestamp=${Date.now()}&transaction_id=${tx}&user_id=${ids.adam}`;
    return app.fetch(new Request(`http://api.test/ads/ssv?${qs}&signature=${await sign(qs)}`), senv);
  };
  await rules({ adMinWatchSec: 0, requireSsv: true });
  const st = await call('adam', 'POST', `/dating/conversations/${conv}/ad/start`);
  assert.equal(st.json.requireSsv, true);
  // SSV-only: the app's claim alone does not unlock
  const pending = await call('adam', 'POST', '/dating/ads/claim', { nonce: st.json.nonce, token: st.json.token });
  assert.equal(pending.status, 202); assert.equal(pending.json.code, 'AD_PENDING_VERIFICATION');
  assert.equal((await ssv(`dating:${st.json.nonce}`, 'dtx-1')).status, 200);
  const after = await call('adam', 'POST', '/dating/ads/claim', { nonce: st.json.nonce, token: st.json.token });
  assert.equal(after.status, 200); assert.equal(after.json.applied, false); assert.equal(after.json.verifiedBy, 'ssv'); assert.equal(after.json.allowance.left, 5);
  // a replayed callback (same transaction) or one for a used nonce changes nothing
  await ssv(`dating:${st.json.nonce}`, 'dtx-1');
  const st2 = await call('adam', 'POST', `/dating/conversations/${conv}/ad/start`);
  await ssv(`dating:${st2.json.nonce}`, 'dtx-1'); // same AdMob transaction id reused for another nonce → ignored
  assert.equal((await call('adam', 'GET', `/dating/conversations/${conv}`)).json.allowance.allowed, 5);
  assert.equal((await ssv(`dating:${st2.json.nonce}`, 'dtx-2')).status, 200);
  assert.equal((await call('adam', 'GET', `/dating/conversations/${conv}`)).json.allowance.allowed, 10);
  const rec = await q(env, `SELECT status, claimed_via, verified FROM dating_ad_rewards WHERE user_id = $1 ORDER BY issued_at`, [ids.adam]);
  assert.ok(rec.every((r) => r.status === 'claimed' && r.claimed_via === 'ssv' && r.verified));
  await rules({ adMinWatchSec: 0, requireSsv: false });
});

test('gift messages never use the free message allowance', async () => {
  const conv = ids.convAE;
  const before = (await call('eve', 'GET', `/dating/conversations/${conv}`)).json.allowance;
  const eve = await one(env, 'SELECT * FROM users WHERE id = $1', [ids.eve]);
  assert.deepEqual(await D.datingSendGuard(env, eve, conv, { kind: 'gift', meta: { gift: { giftId: 'rose' } } }), { counted: false, reason: 'gift' });
  assert.deepEqual(await D.datingSendGuard(env, eve, conv, { kind: 'text', meta: { gift: { coins: 5 } } }), { counted: false, reason: 'gift' });
  const after = (await call('eve', 'GET', `/dating/conversations/${conv}`)).json.allowance;
  assert.equal(after.used, before.used);
  // a text message does count
  assert.equal((await D.datingSendGuard(env, eve, conv, { kind: 'text' })).counted, true);
});

test('Dating Plus / VIP: no ads, unrestricted messaging, see who liked you, undo', async () => {
  await mkProfile('pete', { gender: 'man', interestedIn: 'women', age: 34 });
  await mkProfile('vera', { gender: 'woman', interestedIn: 'men', age: 32 });
  const buy = await call('pete', 'POST', '/wallet/purchase', { productId: 'dating_plus_monthly', provider: 'test', idempotencyKey: key() });
  assert.equal(buy.status, 201, JSON.stringify(buy.json));
  assert.equal((await call('pete', 'GET', '/dating/me')).json.plan.plan, 'plus');
  await call('vera', 'POST', '/dating/swipe', { targetId: ids.pete, action: 'like' });
  const likes = (await call('pete', 'GET', '/dating/likes')).json;
  assert.equal(likes.unlocked, true); assert.equal(likes.viaPlan, true); assert.equal(likes.items[0].userId, ids.vera);
  assert.equal((await call('pete', 'POST', '/dating/likes/unlock', { idempotencyKey: key() })).json.code, 'NOT_NEEDED');
  // undo a pass (Plus) — and free members can't
  await call('pete', 'POST', '/dating/swipe', { targetId: ids.ivy, action: 'pass' });
  const undo = await call('pete', 'POST', '/dating/undo');
  assert.equal(undo.json.undone, 'pass'); assert.equal(undo.json.card.userId, ids.ivy);
  assert.equal((await call('eve', 'POST', '/dating/undo')).json.code, 'PLAN_REQUIRED');
  const m = await call('pete', 'POST', '/dating/swipe', { targetId: ids.vera, action: 'like' });
  const conv = m.json.match.conversationId;
  assert.equal((await call('pete', 'POST', `/dating/conversations/${conv}/ad/start`)).json.code, 'NOT_NEEDED');
  for (let i = 0; i < 12; i++) assert.equal((await call('pete', 'POST', `/conversations/${conv}/messages`, { text: `plus ${i}` })).status, 201);
  // vera is free in the same chat: her own allowance applies
  assert.equal((await call('vera', 'POST', `/conversations/${conv}/messages`, { text: 'hi' })).json.code, 'DATING_MESSAGES_LOCKED');
});

test('VIP: 300 coins + 2 boosts once per billing cycle; a free boost is used before coins', async () => {
  const c0 = await coins('vera');
  const buy = await call('vera', 'POST', '/wallet/purchase', { productId: 'dating_vip_monthly', provider: 'test', idempotencyKey: key() });
  assert.equal(buy.status, 201);
  assert.equal(await coins('vera'), c0 + 300);
  assert.equal(await W.getBalance(env, ids.vera, 'dating_boosts'), 2);
  const sub = await one(env, `SELECT * FROM dating_subscriptions WHERE user_id = $1 AND status = 'active'`, [ids.vera]);
  const product = await getProduct(env, sub.product_id);
  const again = await grantCycleBenefits(env, { sub, product, periodStart: sub.current_period_start, periodEnd: sub.current_period_end });
  assert.equal(again.granted, false);
  assert.equal(await coins('vera'), c0 + 300);
  const r = await renewSubscription(env, sub.id);
  assert.equal(r.renewed, true); assert.equal(r.granted, true);
  const r2 = await renewSubscription(env, sub.id, { expectStart: sub.current_period_start });
  assert.equal(r2.renewed, false);
  assert.equal(await coins('vera'), c0 + 600);
  assert.equal(await W.getBalance(env, ids.vera, 'dating_boosts'), 4);
  // VIP: unrestricted + the VIP badge on her card
  assert.equal((await call('vera', 'GET', '/dating/me')).json.plan.plan, 'vip');
  const card = (await call('carl', 'GET', `/dating/profiles/${ids.vera}`)).json;
  assert.equal(card.vip, true);
  const k = key();
  const b = await call('vera', 'POST', '/dating/boost', { kind: 'boost_30m', idempotencyKey: k });
  assert.equal(b.json.usedFreeBoost, true); assert.equal(b.json.charged, true);
  assert.equal((await call('vera', 'POST', '/dating/boost', { kind: 'boost_30m', idempotencyKey: k })).json.charged, false);
  assert.equal(await W.getBalance(env, ids.vera, 'dating_boosts'), 3);
  assert.equal(await coins('vera'), c0 + 600);
});

test('boost / spotlight: ranks higher without bypassing preferences or blocks, shows stats, auto-stops', async () => {
  // dan (men→women now) looks at women 25-40; ivy is boosted with coins, hana is not
  await call('dan', 'PUT', '/dating/profile', { interestedIn: 'women', prefs: { ageMin: 25, ageMax: 40 } });
  await W.credit(env, { ref: 'seed:ivy', userId: ids.ivy, wallet: 'dating_coins', amount: 1000, kind: 'admin_adjust' });
  const k = key();
  const b1 = await call('ivy', 'POST', '/dating/boost', { kind: 'boost_1h', idempotencyKey: k });
  assert.equal(b1.status, 200); assert.equal(b1.json.amount, 180); assert.equal(b1.json.boost.active.kind, 'boost_1h');
  assert.ok(b1.json.boost.active.secondsLeft > 3500);
  assert.equal((await call('ivy', 'POST', '/dating/boost', { kind: 'boost_1h', idempotencyKey: k })).json.charged, false);
  assert.equal(await coins('ivy'), 820);
  let s = (await call('dan', 'GET', '/dating/discover?limit=50')).json.items;
  const ivyCard = s.find((x) => x.userId === ids.ivy);
  assert.ok(ivyCard && ivyCard.boosted, 'boosted label');
  const firstPlain = s.findIndex((x) => !x.boosted && !x.superLikedYou);
  assert.ok(s.findIndex((x) => x.userId === ids.ivy) < firstPlain || firstPlain === -1, 'boosted ranks above plain profiles');
  // stats: dan's view counted during the boost; a like too
  await call('dan', 'POST', '/dating/swipe', { targetId: ids.ivy, action: 'like' });
  const stat = (await call('ivy', 'GET', '/dating/boost')).json.active.stats;
  assert.ok(stat.views >= 1); assert.equal(stat.likes, 1);
  // preferences: a boosted profile outside your age range never appears
  await mkProfile('boostedold', { gender: 'woman', interestedIn: 'men', age: 55 });
  await W.credit(env, { ref: 'seed:bo', userId: ids.boostedold, wallet: 'dating_coins', amount: 500, kind: 'admin_adjust' });
  assert.equal((await call('boostedold', 'POST', '/dating/boost', { kind: 'spotlight_24h', idempotencyKey: key() })).json.amount, 250);
  assert.ok(!(await stack('dan')).includes(ids.boostedold), 'spotlight does not override age preference');
  // blocks: a boosted member who blocked you never appears
  await mkProfile('blocker', { gender: 'woman', interestedIn: 'men', age: 30 });
  await W.credit(env, { ref: 'seed:bl', userId: ids.blocker, wallet: 'dating_coins', amount: 500, kind: 'admin_adjust' });
  await call('blocker', 'POST', '/dating/boost', { kind: 'boost_3h', idempotencyKey: key() });
  assert.ok((await stack('adam')).includes(ids.blocker));
  await call('blocker', 'POST', '/dating/block', { userId: ids.dan });
  assert.ok(!(await stack('dan')).includes(ids.blocker), 'boost does not override a block');
  // a second boost queues after the first; expiry → no longer boosted (auto-stop)
  await call('ivy', 'POST', '/dating/boost', { kind: 'boost_30m', idempotencyKey: key() });
  const st = (await call('ivy', 'GET', '/dating/boost')).json;
  assert.ok(st.recent.some((x) => x.state === 'queued'));
  await q(env, `UPDATE dating_boosts SET starts_at = now() - interval '5 hours', ends_at = now() - interval '1 minute' WHERE user_id = $1`, [ids.ivy]);
  assert.equal((await call('ivy', 'GET', '/dating/boost')).json.active, null);
  await mkProfile('lena', { gender: 'woman', interestedIn: 'men', age: 29 });
  s = (await call('adam', 'GET', '/dating/discover?limit=50')).json.items;
  assert.equal(s.find((x) => x.userId === ids.ivy).boosted, false);
});

test('unmatch / report / delete close the chat; underage report hides the profile', async () => {
  const conv = ids.convAE;
  const m = (await call('adam', 'GET', '/dating/matches')).json.items.find((x) => x.conversationId === conv);
  assert.equal((await call('adam', 'POST', `/dating/matches/${m.matchId}/unmatch`)).json.unmatched, true);
  assert.equal((await call('eve', 'GET', '/dating/matches')).json.items.length, 0);
  assert.equal((await call('eve', 'POST', `/conversations/${conv}/messages`, { text: 'still there?' })).status, 403);
  assert.equal((await call('eve', 'POST', `/dating/conversations/${conv}/bundle`, { idempotencyKey: key() })).json.code, 'DATING_CHAT_CLOSED');
  const rep = await call('fay', 'POST', '/dating/report', { userId: ids.lena, reason: 'underage', details: 'Looks 16' });
  assert.equal(rep.status, 201);
  assert.equal((await one(env, 'SELECT status FROM dating_profiles WHERE user_id = $1', [ids.lena])).status, 'banned');
  assert.ok(!(await stack('adam')).includes(ids.lena));
  assert.equal((await call('fay', 'POST', '/dating/report', { userId: ids.lena, reason: 'nope' })).json.code, 'BAD_REASON');
  // delete: profile and swipes go, the ledger stays
  const spendsBefore = (await one(env, 'SELECT count(*)::int AS n FROM wallet_entries WHERE user_id = $1', [ids.hana])).n;
  assert.equal((await call('hana', 'DELETE', '/dating/profile')).json.deleted, true);
  assert.equal(await one(env, 'SELECT 1 FROM dating_profiles WHERE user_id = $1', [ids.hana]), null);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM wallet_entries WHERE user_id = $1', [ids.hana])).n, spendsBefore);
  assert.equal((await call('hana', 'GET', '/dating/discover')).json.code, 'DATING_PROFILE_REQUIRED');
});

test('admin-only routes: search coin usage, unlocks, ad rewards, boosts, reports; config edits audited', async () => {
  for (const path of ['/admin/api/dating/overview', '/admin/api/dating/profiles', '/admin/api/dating/spends', '/admin/api/dating/ad-rewards', '/admin/api/dating/message-unlocks', '/admin/api/dating/boosts', '/admin/api/dating/reports', '/admin/api/dating/subscriptions', '/admin/api/dating/config']) {
    assert.equal((await call('eve', 'GET', path)).status, 403, path);
    assert.equal((await call('boss', 'GET', path)).status, 200, path);
  }
  const ov = (await call('boss', 'GET', '/admin/api/dating/overview')).json;
  assert.ok(ov.spends.some((s) => s.kind === 'super_like'));
  const byRef = (await call('boss', 'GET', `/admin/api/dating/spends?ref=super_like:${ids.carl}`)).json.items;
  assert.equal(byRef.length, 1); assert.equal(byRef[0].amount, 10);
  assert.equal((await call('boss', 'GET', '/admin/api/dating/spends?q=@nobody')).json.items.length, 0);
  assert.ok((await call('boss', 'GET', `/admin/api/dating/spends?q=${ids.carl}&kind=priority_like`)).json.items.length === 1);
  const csv = await app.fetch(new Request(`http://api.test/admin/api/dating/spends?format=csv&q=${ids.carl}`, { headers: { 'X-Dev-User': 'boss' } }), env);
  assert.match(await csv.text(), /^created_at,user_id/);
  const un = (await call('boss', 'GET', `/admin/api/dating/message-unlocks?q=${ids.eve}`)).json.items;
  assert.deepEqual(un.map((x) => x.type).sort(), ['ad', 'ad', 'bundle']);
  assert.ok((await call('boss', 'GET', '/admin/api/dating/ad-rewards?status=claimed')).json.items.length >= 4);
  assert.ok((await call('boss', 'GET', '/admin/api/dating/boosts?kind=spotlight_24h')).json.items.length === 1);
  const reps = (await call('boss', 'GET', '/admin/api/dating/reports')).json.items;
  assert.equal(reps[0].reason, 'underage');
  assert.equal((await call('boss', 'POST', `/admin/api/dating/reports/${reps[0].id}`, { action: 'dismiss' })).status, 200);
  assert.equal((await call('eve', 'PUT', '/admin/api/dating/config', { key: 'dating_prices', value: { super_like: 1 } })).status, 403);
  const cfg = await call('boss', 'PUT', '/admin/api/dating/config', { key: 'dating_prices', value: { ...D.DEFAULT_PRICES, super_like: 12 } });
  assert.equal(cfg.json.prices.super_like, 12);
  assert.equal((await call('boss', 'PUT', '/admin/api/dating/config', { key: 'dating_prices', value: { super_like: -4 } })).json.code, 'BAD_CONFIG');
  assert.equal((await call('boss', 'PUT', '/admin/api/dating/config', { key: 'dating_rules', value: { minAge: 16 } })).json.code, 'BAD_CONFIG');
  assert.ok(await one(env, `SELECT 1 FROM admin_actions WHERE action = 'dating.config'`));
  const ban = await call('boss', 'POST', `/admin/api/dating/profiles/${ids.fay}/ban`, { reason: 'Fake profile' });
  assert.equal(ban.status, 200);
  assert.equal((await call('fay', 'GET', '/dating/discover')).json.code, 'DATING_BANNED');
  assert.equal((await W.ledgerIntegrity(env)).ok, true);
});

test('dev seed: 20 adult demo profiles + a demo user (dev only, never imported by src/)', async () => {
  const { seedDating } = await import('../dev/seed-dating.mjs');
  const e2 = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
  assert.equal(await seedDating(e2, { demoUser: 'demo' }), 20);
  const n = (await e2.__db.query(`SELECT count(*)::int AS n, min(EXTRACT(YEAR FROM age(current_date, birth_date)))::int AS youngest FROM dating_profiles`))[0];
  assert.equal(n.n, 21); assert.ok(n.youngest >= 18);
  const r = await app.fetch(new Request('http://api.test/dating/me', { headers: { 'X-Dev-User': 'demo' } }), e2);
  const me = await r.json();
  assert.equal(me.balances.dating_coins, 300); assert.equal(me.likes.count, 3); assert.equal(me.counts.matches, 1);
  const d = await (await app.fetch(new Request('http://api.test/dating/discover?limit=50', { headers: { 'X-Dev-User': 'demo' } }), e2)).json();
  assert.ok(d.items.length >= 5 && d.items.every((c) => c.photos.length));
  assert.equal((await W.ledgerIntegrity(e2)).ok, true);
});

test('a plain like never changes your position in someone’s stack (no leak of who liked you)', async () => {
  await mkProfile('liam', { gender: 'man', interestedIn: 'women', age: 30 });
  await mkProfile('xena', { gender: 'woman', interestedIn: 'men', age: 30 });
  await mkProfile('yara', { gender: 'woman', interestedIn: 'men', age: 30 });
  await q(env, `UPDATE dating_profiles SET last_active_at = now() - interval '2 days' WHERE user_id = $1`, [ids.xena]);
  await q(env, `UPDATE dating_profiles SET last_active_at = now() - interval '1 day' WHERE user_id = $1`, [ids.yara]);
  await q(env, `DELETE FROM dating_boosts WHERE user_id = ANY($1::uuid[])`, [[ids.xena, ids.yara]]);
  await call('xena', 'POST', '/dating/swipe', { targetId: ids.liam, action: 'like' });
  const s = await stack('liam');
  assert.ok(s.indexOf(ids.yara) < s.indexOf(ids.xena), 'the more recently active profile stays first');
  const card = (await call('liam', 'GET', '/dating/discover?limit=50')).json.items.find((c) => c.userId === ids.xena);
  assert.equal(card.superLikedYou, false);
});
