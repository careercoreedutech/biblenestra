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

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CLIENT ANSWERS (scratch/monetisation/client-answers.md): AI photo check, auto-hide after reports, verified badge
// (selfie + ID), social profile for verified people in dating chats, retention of closed dating chats, and the
// "already true" checks (18+, man/woman, no refund on a declined request, verification not needed to message).
// env.AI is always a stub here: the "image" bytes are a short tag the stub reads to decide its answer.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const tagOf = (input) => {
  // Llama 4 Scout gets the image as a data: URL inside the message content; the other models get `image` bytes
  const part = (input.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((p) => p.type === 'image_url');
  if (part) return Buffer.from(part.image_url.url.split(',')[1], 'base64').toString();
  return Buffer.from(Uint8Array.from(input.image || [])).toString();
};
function aiEnv(answer, calls = []) {
  return { ...env, AI: { run: async (model, input) => { calls.push(model); const a = await answer(tagOf(input), model, input); if (a instanceof Error) throw a; return a; } } };
}
const PHOTO_OK = { nudity: false, sexual: false, minor: false, violence: false, face_visible: true, reason: 'A smiling woman' };
async function putImg(u, name, tag) { const key = `img/${ids[u]}/${name}.jpg`; await env.MEDIA.put(key, Buffer.from(tag), { httpMetadata: { contentType: 'image/jpeg' } }); return key; }
async function rawPost(u, path, bytes, type, e = env) {
  const res = await app.fetch(new Request(`http://api.test${path}`, { method: 'POST', headers: { 'X-Dev-User': u, 'Content-Type': type }, body: bytes }), e);
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json };
}

test('AI photo check: clean → live at once; flagged → hidden + admin queue with the reason; errors never go live', async () => {
  await rules({});
  assert.equal((await D.datingConfig(env)).rules.photoReview, 'ai', 'the AI check is the default');
  await mkProfile('ruth', { gender: 'woman', interestedIn: 'men', age: 27, photo: false });
  await mkProfile('sam', { gender: 'man', interestedIn: 'women', age: 29 });
  const calls = [];
  const e = aiEnv((tag) => {
    if (tag === 'BOOM') return new Error('3040: capacity');
    if (tag === 'JUNK') return { response: 'Looks fine to me!' };
    if (tag === 'NUDE') return { response: JSON.stringify({ ...PHOTO_OK, nudity: true, reason: 'Exposed body' }) };
    if (tag === 'LANDSCAPE') return { response: JSON.stringify({ ...PHOTO_OK, face_visible: false, reason: 'A beach' }) };
    if (tag === 'HALF') return { response: JSON.stringify({ nudity: false, sexual: false, face_visible: true }) }; // minor / violence missing
    return { response: '```json\n' + JSON.stringify(PHOTO_OK) + '\n```' };
  }, calls);
  const add = async (tag, ee = e) => call('ruth', 'POST', '/dating/profile/photos', { key: await putImg('ruth', tag.toLowerCase(), tag) }, ee);
  const photo = (id) => one(env, 'SELECT * FROM dating_photos WHERE id = $1', [id]);
  // clean → approved at once, visible in discovery, no human involved
  const ok = await add('CLEAN');
  assert.equal(ok.status, 201); assert.equal(ok.json.review, 'live');
  assert.deepEqual([(await photo(ok.json.id)).status, (await photo(ok.json.id)).ai_verdict, (await photo(ok.json.id)).reviewed_by], ['approved', 'clean', null]);
  assert.ok((await stack('sam')).includes(ids.ruth), 'live at once');
  assert.equal(calls[0], '@cf/meta/llama-4-scout-17b-16e-instruct');
  // flagged → pending + ai_flagged + reason, hidden, listed first in the admin queue
  const nude = await add('NUDE');
  assert.equal(nude.json.review, 'flagged');
  const np = await photo(nude.json.id);
  assert.deepEqual([np.status, np.ai_flagged, np.ai_verdict], ['pending', true, 'flagged']);
  assert.match(np.ai_reason, /nudity/); assert.match(np.ai_reason, /Exposed body/);
  const card = (await call('sam', 'GET', `/dating/profiles/${ids.ruth}`)).json;
  assert.deepEqual(card.photos.map((x) => x.id), [ok.json.id], 'the flagged photo is never shown');
  const q1 = (await call('boss', 'GET', '/admin/api/dating/photos?status=pending&ai=flagged')).json.items;
  assert.equal(q1.length, 1); assert.equal(q1[0].id, nude.json.id); assert.equal(q1[0].ai.flagged, true); assert.match(q1[0].ai.reason, /nudity/);
  assert.equal((await call('boss', 'GET', '/admin/api/dating/overview')).json.photosFlagged, 1);
  // no visible face → flagged too
  const land = await add('LANDSCAPE');
  assert.equal(land.json.review, 'flagged'); assert.match((await photo(land.json.id)).ai_reason, /no visible person or face/);
  await call('ruth', 'DELETE', `/dating/profile/photos/${land.json.id}`);
  // AI error (every model fails) → pending for a human, never live; both models were tried
  calls.length = 0;
  const boom = await add('BOOM');
  assert.equal(boom.json.review, 'pending');
  const bp = await photo(boom.json.id);
  assert.deepEqual([bp.status, bp.ai_verdict, bp.ai_flagged], ['pending', 'error', false]);
  assert.deepEqual(calls, ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.2-11b-vision-instruct', '@cf/llava-hf/llava-1.5-7b-hf']);
  await call('ruth', 'DELETE', `/dating/profile/photos/${boom.json.id}`);
  // a reply that is not the strict JSON, or JSON with a missing flag → pending (fail closed)
  const junk = await add('JUNK');
  assert.equal(junk.json.review, 'pending'); assert.equal((await photo(junk.json.id)).ai_verdict, 'error');
  await call('ruth', 'DELETE', `/dating/profile/photos/${junk.json.id}`);
  const half = await add('HALF');
  assert.equal(half.json.review, 'pending'); assert.match((await photo(half.json.id)).ai_reason, /incomplete/);
  await call('ruth', 'DELETE', `/dating/profile/photos/${half.json.id}`);
  // no Workers AI binding at all → pending (the old pre-moderation behaviour)
  const noAi = await add('CLEAN2', env);
  assert.equal(noAi.json.review, 'pending'); assert.equal((await photo(noAi.json.id)).status, 'pending');
  await call('ruth', 'DELETE', `/dating/profile/photos/${noAi.json.id}`);
  // 'pre' → every photo waits for a human and the AI is not asked · 'post' → live at once, but an AI-flagged photo stays hidden
  await rules({ photoReview: 'pre' });
  calls.length = 0;
  const pre = await add('CLEAN3');
  assert.equal(pre.json.review, 'pending'); assert.equal(calls.length, 0);
  await call('ruth', 'DELETE', `/dating/profile/photos/${pre.json.id}`);
  await rules({ photoReview: 'post' });
  const post = await add('CLEAN4');
  assert.equal(post.json.review, 'live'); assert.equal(calls.length, 0);
  const seen = (await call('sam', 'GET', `/dating/profiles/${ids.ruth}`)).json.photos.map((x) => x.id);
  assert.ok(seen.includes(post.json.id) && !seen.includes(nude.json.id), 'post mode never shows an AI-flagged photo');
  await call('ruth', 'DELETE', `/dating/profile/photos/${post.json.id}`);
  // admins approve / reject from the queue as before
  assert.equal((await call('boss', 'POST', `/admin/api/dating/photos/${nude.json.id}`, { status: 'rejected', reason: 'Not modest' })).status, 200);
  // the mode is an admin setting: ai | pre | post
  assert.equal((await call('boss', 'PUT', '/admin/api/dating/config', { key: 'dating_rules', value: { ...D.DEFAULT_RULES, photoReview: 'bogus' } })).json.code, 'BAD_CONFIG');
  assert.equal((await call('boss', 'PUT', '/admin/api/dating/config', { key: 'dating_rules', value: { ...D.DEFAULT_RULES, photoReview: 'ai' } })).json.rules.photoReview, 'ai');
});

test('auto-hide: reports from 5 different members hide a profile from discovery until an admin restores it', async () => {
  await rules({});
  await mkProfile('tom', { gender: 'man', interestedIn: 'women', age: 31 });
  await mkProfile('una', { gender: 'woman', interestedIn: 'men', age: 30 });
  for (const u of ['rep1', 'rep2', 'rep3', 'rep4', 'rep5', 'rep6', 'rep7']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  assert.ok((await stack('una')).includes(ids.tom));
  const report = (u, reason = 'harassment') => call(u, 'POST', '/dating/report', { userId: ids.tom, reason, details: 'test' });
  // the same member reporting twice counts once
  assert.equal((await report('rep1')).json.autoHidden, false);
  assert.equal((await report('rep1', 'fake')).json.autoHidden, false);
  for (const u of ['rep2', 'rep3', 'rep4']) assert.equal((await report(u)).json.autoHidden, false);
  assert.ok((await stack('una')).includes(ids.tom), '4 different reporters: still visible');
  const fifth = await report('rep5');
  assert.equal(fifth.status, 201); assert.equal(fifth.json.autoHidden, true);
  // hidden from discovery, likes and new contact; not banned (his chats and account are untouched)
  const row = await one(env, 'SELECT status, report_hold_at FROM dating_profiles WHERE user_id = $1', [ids.tom]);
  assert.equal(row.status, 'active'); assert.ok(row.report_hold_at);
  assert.ok(!(await stack('una')).includes(ids.tom));
  assert.equal((await call('una', 'POST', '/dating/swipe', { targetId: ids.tom, action: 'like' })).status, 404);
  const mine = (await call('tom', 'GET', '/dating/me')).json.profile;
  assert.equal(mine.underReview, true); assert.equal(mine.visible, false);
  assert.equal((await call('tom', 'GET', '/dating/discover')).json.code, 'DATING_UNDER_REVIEW');
  // the admin queue
  const held = (await call('boss', 'GET', '/admin/api/dating/profiles?status=held')).json.items;
  assert.deepEqual(held.map((p) => p.userId), [ids.tom]); assert.equal(held[0].reporters, 5); assert.ok(held[0].heldAt);
  assert.equal((await call('boss', 'GET', '/admin/api/dating/overview')).json.heldAfterReports, 1);
  assert.equal((await call('una', 'POST', `/admin/api/dating/profiles/${ids.tom}/restore`)).status, 403);
  assert.equal((await call('boss', 'POST', `/admin/api/dating/profiles/${ids.tom}/restore`)).status, 200);
  assert.ok(await one(env, `SELECT 1 FROM admin_actions WHERE action = 'dating.profile.restore' AND target_id = $1`, [ids.tom]));
  assert.ok((await stack('una')).includes(ids.tom), 'restored');
  assert.equal((await one(env, `SELECT count(*)::int AS n FROM dating_reports WHERE target_id = $1 AND status = 'open'`, [ids.tom])).n, 0);
  assert.equal((await one(env, `SELECT count(*)::int AS n FROM dating_reports WHERE target_id = $1`, [ids.tom])).n, 6, 'reports are kept');
  // after a restore the count starts again; the threshold is an admin setting (0 = off)
  assert.equal((await report('rep6')).json.autoHidden, false);
  await rules({ autoHideReports: 2 });
  assert.equal((await report('rep7')).json.autoHidden, true);
  await call('boss', 'POST', `/admin/api/dating/profiles/${ids.tom}/restore`);
  await rules({ autoHideReports: 0 });
  for (const u of ['rep1', 'rep2', 'rep3', 'rep4', 'rep5']) assert.equal((await report(u)).json.autoHidden, false);
  assert.equal((await one(env, 'SELECT report_hold_at FROM dating_profiles WHERE user_id = $1', [ids.tom])).report_hold_at, null);
  // "may be under 18" still suspends at once, with a single report
  await rules({});
  assert.equal((await report('rep6', 'underage')).status, 201);
  assert.equal((await one(env, 'SELECT status FROM dating_profiles WHERE user_id = $1', [ids.tom])).status, 'banned');
  await call('boss', 'POST', `/admin/api/dating/profiles/${ids.tom}/unban`);
});

test('verified badge: code + gesture selfie and ID stay private, advisory AI note, admin decides, images deleted', async () => {
  await rules({});
  await mkProfile('vic', { gender: 'woman', interestedIn: 'men', age: 28, photo: false });
  const mainKey = await putImg('vic', 'main', 'PROFILE');
  await q(env, `INSERT INTO dating_photos (user_id, url, status) VALUES ($1, $2, 'approved')`, [ids.vic, mainKey]);
  for (const u of ['olga']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  assert.equal((await call('vic', 'GET', '/dating/verification')).json.verification, null);
  // nothing to upload before a code exists
  assert.equal((await rawPost('vic', '/dating/verification/upload?kind=selfie', Buffer.from('SELFIE'), 'image/jpeg')).json.code, 'VERIFICATION_EXPIRED');
  const st = (await call('vic', 'POST', '/dating/verification/start')).json.verification;
  assert.match(st.code, /^\d{4}$/); assert.ok(st.gesture && st.gestureLabel); assert.equal(st.status, 'draft');
  assert.equal((await call('vic', 'POST', '/dating/verification/start')).json.verification.code, st.code, 'start again → same code');
  assert.equal((await rawPost('vic', '/dating/verification/upload?kind=selfie', Buffer.from('x'), 'application/pdf')).json.code, 'BAD_IMAGE_TYPE');
  assert.equal((await call('vic', 'POST', '/dating/verification/submit', { idType: 'nin' })).json.code, 'VERIFICATION_INCOMPLETE');
  assert.equal((await rawPost('vic', '/dating/verification/upload?kind=selfie', Buffer.from('OLDSELFIE'), 'image/jpeg')).status, 201);
  const firstSelfie = (await one(env, `SELECT selfie_key FROM dating_verifications WHERE user_id = $1`, [ids.vic])).selfie_key;
  assert.equal((await rawPost('vic', '/dating/verification/upload?kind=selfie', Buffer.from('SELFIE'), 'image/jpeg')).status, 201);
  assert.equal(await env.MEDIA.head(firstSelfie), null, 'a replaced selfie is deleted');
  const up = await rawPost('vic', '/dating/verification/upload?kind=id', Buffer.from('IDCARD'), 'image/jpeg');
  assert.equal(up.json.verification.hasSelfie, true); assert.equal(up.json.verification.hasId, true);
  const v0 = await one(env, `SELECT * FROM dating_verifications WHERE user_id = $1`, [ids.vic]);
  assert.match(v0.selfie_key, new RegExp(`^kyc/${ids.vic}/${v0.id}/selfie_`));
  // private: never served from /media; only the member (and admins) can read them
  assert.equal((await app.fetch(new Request(`http://api.test/media/${v0.selfie_key}`), env)).status, 404);
  const own = await app.fetch(new Request('http://api.test/dating/verification/file/selfie', { headers: { 'X-Dev-User': 'vic' } }), env);
  assert.equal(own.status, 200); assert.equal(Buffer.from(await own.arrayBuffer()).toString(), 'SELFIE'); assert.match(own.headers.get('cache-control'), /no-store/);
  assert.equal((await call('olga', 'GET', '/dating/verification/file/selfie')).status, 404, 'another member gets nothing');
  assert.equal((await call('olga', 'GET', `/admin/api/dating/verifications/${v0.id}/file/id`)).status, 403);
  const adm = await app.fetch(new Request(`http://api.test/admin/api/dating/verifications/${v0.id}/file/id`, { headers: { 'X-Dev-User': 'boss' } }), env);
  assert.equal(adm.status, 200); assert.equal(Buffer.from(await adm.arrayBuffer()).toString(), 'IDCARD');
  // submit → advisory AI pre-check (three single-image calls, compared)
  const birthYear = yearsAgo(28).slice(0, 4);
  const words = { thumbs_up: 'thumbs up', peace_sign: 'peace sign', open_palm: 'open palm', point_up: 'pointing up', hand_on_chin: 'hand on chin' };
  const e = aiEnv((tag) => {
    if (tag === 'SELFIE') return { response: JSON.stringify({ face_visible: true, people: 1, gender: 'woman', age_range: '26-35', hair: 'long braids', glasses: false, gesture: `making a ${words[st.gesture]}`, text_seen: `paper with ${st.code}` }) };
    if (tag === 'IDCARD') return { description: JSON.stringify({ is_id_document: true, document_type: 'NIN slip', has_face_photo: true, gender: 'woman', age_range: '26-35', name: 'VIC OKAFOR EXAMPLE', date_of_birth: `14 MAR ${birthYear}` }) };
    if (tag === 'PROFILE') return { response: JSON.stringify({ face_visible: true, people: 1, gender: 'woman', age_range: '26-35', hair: 'braids', glasses: false, gesture: 'none', text_seen: '' }) };
    return new Error('unexpected image');
  });
  assert.equal((await call('vic', 'POST', '/dating/verification/submit', { idType: 'bvn' }, e)).json.code, 'BAD_ID_TYPE');
  const sub = await call('vic', 'POST', '/dating/verification/submit', { idType: 'nin' }, e);
  assert.equal(sub.status, 200); assert.equal(sub.json.verification.status, 'pending'); assert.equal(sub.json.verification.code, null);
  const v1 = await one(env, `SELECT * FROM dating_verifications WHERE id = $1`, [v0.id]);
  assert.deepEqual([v1.ai_status, v1.ai_confidence], ['done', 'high']);
  assert.match(v1.ai_note, new RegExp(`code ${st.code} readable`)); assert.match(v1.ai_note, /birth year on the ID matches/); assert.match(v1.ai_note, /Advisory only/);
  assert.ok(!/OKAFOR|EXAMPLE/i.test(v1.ai_note) && !v1.ai_note.includes(`MAR ${birthYear}`), 'the note never repeats what is printed on the ID');
  assert.equal((await call('vic', 'POST', '/dating/verification/start')).json.code, 'VERIFICATION_PENDING');
  // admin queue: everything side by side
  const list = (await call('boss', 'GET', '/admin/api/dating/verifications')).json.items;
  const item = list.find((x) => x.id === v0.id);
  assert.equal(item.ai.confidence, 'high'); assert.equal(item.hasSelfie && item.hasId, true); assert.equal(item.profile.photos.length, 1); assert.equal(item.code, st.code);
  assert.equal((await call('boss', 'GET', '/admin/api/dating/overview')).json.verificationsPending, 1);
  assert.equal((await call('olga', 'GET', '/admin/api/dating/verifications')).status, 403);
  // reject needs a reason; approve → Verified badge, both images deleted, only the outcome kept
  assert.equal((await call('boss', 'POST', `/admin/api/dating/verifications/${v0.id}`, { decision: 'reject' })).json.code, 'REASON_REQUIRED');
  const ok = await call('boss', 'POST', `/admin/api/dating/verifications/${v0.id}`, { decision: 'approve' });
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'approved');
  assert.equal((await one(env, 'SELECT verified FROM dating_profiles WHERE user_id = $1', [ids.vic])).verified, true);
  const v2 = await one(env, `SELECT * FROM dating_verifications WHERE id = $1`, [v0.id]);
  assert.deepEqual([v2.selfie_key, v2.id_key, v2.ai_details, v2.status], [null, null, null, 'approved']); assert.ok(v2.files_deleted_at && v2.ai_confidence === 'high');
  assert.equal(await env.MEDIA.head(v1.selfie_key), null); assert.equal(await env.MEDIA.head(v1.id_key), null);
  assert.equal((await call('vic', 'GET', '/dating/verification/file/selfie')).status, 404);
  assert.equal((await call('boss', 'POST', `/admin/api/dating/verifications/${v0.id}`, { decision: 'reject', reason: 'again' })).json.code, 'ALREADY_DECIDED');
  assert.ok(await one(env, `SELECT 1 FROM admin_actions WHERE action = 'dating.verification.approve' AND target_id = $1`, [v0.id]));
  assert.equal((await call('vic', 'POST', '/dating/verification/start')).json.code, 'ALREADY_VERIFIED');
  assert.equal((await call('sam', 'GET', `/dating/profiles/${ids.vic}`)).json.verified, true);
  // AI unavailable → submitted anyway with an "unknown" note; a rejection tells the member why and deletes the images
  await mkProfile('wes', { gender: 'man', interestedIn: 'women', age: 35 });
  await call('wes', 'POST', '/dating/verification/start');
  await rawPost('wes', '/dating/verification/upload?kind=selfie', Buffer.from('S2'), 'image/png');
  await rawPost('wes', '/dating/verification/upload?kind=id', Buffer.from('I2'), 'image/webp');
  const ws2 = await call('wes', 'POST', '/dating/verification/submit', { idType: 'passport' });
  assert.equal(ws2.json.verification.status, 'pending');
  const w = await one(env, `SELECT * FROM dating_verifications WHERE user_id = $1`, [ids.wes]);
  assert.deepEqual([w.ai_status, w.ai_confidence], ['unavailable', 'unknown']);
  await call('boss', 'POST', `/admin/api/dating/verifications/${w.id}`, { decision: 'reject', reason: 'The code is not visible' });
  const mine = (await call('wes', 'GET', '/dating/verification')).json.verification;
  assert.deepEqual([mine.status, mine.rejectReason], ['rejected', 'The code is not visible']);
  assert.equal((await one(env, 'SELECT verified FROM dating_profiles WHERE user_id = $1', [ids.wes])).verified, false);
  assert.equal(await env.MEDIA.head(w.selfie_key), null);
  // an unfinished draft past its expiry loses its image in the cron
  const again = (await call('wes', 'POST', '/dating/verification/start')).json.verification;
  assert.equal(again.status, 'draft');
  await rawPost('wes', '/dating/verification/upload?kind=selfie', Buffer.from('S3'), 'image/jpeg');
  const d = await one(env, `SELECT * FROM dating_verifications WHERE id = $1`, [again.id]);
  await q(env, `UPDATE dating_verifications SET expires_at = now() - interval '1 minute' WHERE id = $1`, [d.id]);
  assert.ok((await D.runDatingCron(env)).draftsExpired >= 1);
  const d2 = await one(env, `SELECT * FROM dating_verifications WHERE id = $1`, [d.id]);
  assert.deepEqual([d2.status, d2.selfie_key], ['expired', null]); assert.equal(await env.MEDIA.head(d.selfie_key), null);
});

test('dating chat shows the social profile only when the other person is verified (admin setting, default on)', async () => {
  await rules({});
  await q(env, `UPDATE users SET handle = 'vic_social', display_name = 'Victoria Social', avatar_url = 'https://images.example/vic-avatar.jpg' WHERE id = $1`, [ids.vic]);
  await call('sam', 'POST', '/dating/swipe', { targetId: ids.vic, action: 'like' });
  const m = await call('vic', 'POST', '/dating/swipe', { targetId: ids.sam, action: 'like' });
  const conv = m.json.match.conversationId;
  const forSam = (await call('sam', 'GET', `/dating/conversations/${conv}`)).json;
  assert.equal(forSam.profile.verified, true);
  assert.deepEqual(forSam.social, { userId: ids.vic, displayName: 'Victoria Social', handle: 'vic_social', avatarUrl: 'https://images.example/vic-avatar.jpg' });
  const forVic = (await call('vic', 'GET', `/dating/conversations/${conv}`)).json;
  assert.equal(forVic.profile.verified, false); assert.equal(forVic.social, null, 'sam is not verified: dating name and photo only');
  await rules({ showSocialToVerified: false });
  assert.equal((await call('sam', 'GET', `/dating/conversations/${conv}`)).json.social, null);
  await rules({});
  ids.convSV = conv;
});

test('retention: closed dating chats lose their messages after chatRetentionDays, in small batches; reports stay', async () => {
  await rules({ retentionBatch: 2 });
  await mkProfile('nate', { gender: 'man', interestedIn: 'women', age: 33 });
  await mkProfile('zoe', { gender: 'woman', interestedIn: 'men', age: 31 });
  await call('nate', 'POST', '/dating/swipe', { targetId: ids.zoe, action: 'like' });
  const conv = (await call('zoe', 'POST', '/dating/swipe', { targetId: ids.nate, action: 'like' })).json.match.conversationId;
  const mediaKey = `chat/${conv}/img_test.jpg`;
  await env.MEDIA.put(mediaKey, Buffer.from('PIC'), { httpMetadata: { contentType: 'image/jpeg' } });
  for (const [i, k] of [[1, null], [2, mediaKey], [3, null]]) {
    await q(env, `INSERT INTO messages (conversation_id, sender_id, kind, body, media_key) VALUES ($1, $2, $3, $4, $5)`, [conv, ids.nate, k ? 'image' : 'text', `m${i}`, k]);
  }
  await call('zoe', 'POST', '/dating/report', { userId: ids.nate, reason: 'harassment', details: 'kept forever' });
  const m = (await call('zoe', 'GET', '/dating/matches')).json.items.find((x) => x.conversationId === conv);
  await call('zoe', 'POST', `/dating/matches/${m.matchId}/unmatch`);
  const dc = await one(env, 'SELECT status, closed_at FROM dating_conversations WHERE conversation_id = $1', [conv]);
  assert.equal(dc.status, 'closed'); assert.ok(dc.closed_at, 'closing a chat stamps closed_at');
  // not old enough yet → nothing deleted (and open chats are never touched)
  const open = ids.convSV;
  const openBefore = (await one(env, 'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [open])).n;
  assert.equal((await D.runDatingCron(env)).messagesDeleted, 0);
  await q(env, `UPDATE dating_conversations SET closed_at = now() - interval '731 days' WHERE conversation_id = $1`, [conv]);
  // retention off (0) → kept
  await rules({ retentionBatch: 2, chatRetentionDays: 0 });
  assert.equal((await D.runDatingCron(env)).messagesDeleted, 0);
  await rules({ retentionBatch: 2 });
  const r1 = await D.runDatingCron(env);
  assert.deepEqual([r1.messagesDeleted, r1.chatsPurged], [2, 0], 'small batches');
  const r2 = await D.runDatingCron(env);
  assert.deepEqual([r2.messagesDeleted, r2.chatsPurged], [1, 1]);
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [conv])).n, 0);
  assert.equal(await env.MEDIA.head(mediaKey), null, 'chat attachments go too');
  assert.ok((await one(env, 'SELECT messages_purged_at FROM dating_conversations WHERE conversation_id = $1', [conv])).messages_purged_at);
  assert.equal((await D.runDatingCron(env)).messagesDeleted, 0, 'done: nothing more to delete');
  assert.ok(await one(env, `SELECT 1 FROM dating_reports WHERE target_id = $1 AND details = 'kept forever'`, [ids.nate]), 'reports are kept');
  assert.ok(await one(env, 'SELECT 1 FROM dating_conversations WHERE conversation_id = $1', [conv]), 'the chat record is kept');
  assert.equal((await one(env, 'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [open])).n, openBefore);
  // the setting is an admin rule in days (validated)
  assert.equal((await call('boss', 'PUT', '/admin/api/dating/config', { key: 'dating_rules', value: { ...D.DEFAULT_RULES, chatRetentionDays: -1 } })).json.code, 'BAD_CONFIG');
  assert.equal(D.DEFAULT_RULES.chatRetentionDays, 730);
  await rules({});
});

test('already true: 18+, man/woman matching, no refund on a declined request, verification not needed to message', async () => {
  // 18+: an under-18 date of birth is refused and minAge can never go below 18
  const young = await call('quin', 'PUT', '/dating/profile', { firstName: 'Quin', birthDate: yearsAgo(17), confirmAdult: true, gender: 'man', interestedIn: 'women' });
  assert.equal(young.json.code, 'AGE_RESTRICTED');
  await q(env, `UPDATE wallet_config SET value = $1::jsonb WHERE key = 'dating_rules'`, [JSON.stringify({ ...D.DEFAULT_RULES, minAge: 12 })]); // even a bad stored value
  assert.equal((await D.datingConfig(env)).rules.minAge, 18);
  await rules({});
  // man / woman only, matching both ways
  assert.equal((await call('quin', 'PUT', '/dating/profile', { firstName: 'Quin', birthDate: yearsAgo(30), confirmAdult: true, gender: 'other', interestedIn: 'women' })).json.code, 'BAD_PROFILE');
  assert.equal((await call('quin', 'PUT', '/dating/profile', { firstName: 'Quin', birthDate: yearsAgo(30), confirmAdult: true, gender: 'man', interestedIn: 'both' })).json.code, 'BAD_PROFILE');
  await mkProfile('quin', { gender: 'man', interestedIn: 'women', age: 30 });
  const s = await stack('quin');
  const genders = await q(env, 'SELECT gender, interested_in FROM dating_profiles WHERE user_id = ANY($1::uuid[])', [s]);
  assert.ok(genders.length && genders.every((g) => g.gender === 'woman' && g.interested_in === 'men'), 'a man seeking women only sees women seeking men');
  // a declined message request is not refunded
  await mkProfile('olive', { gender: 'woman', interestedIn: 'men', age: 29 });
  await W.credit(env, { ref: 'seed:quin', userId: ids.quin, wallet: 'dating_coins', amount: 25, kind: 'admin_adjust' });
  const req = await call('quin', 'POST', '/dating/requests', { targetId: ids.olive, text: 'Hello Olive', idempotencyKey: key() });
  assert.equal(req.json.charged, true); assert.equal(await coins('quin'), 0);
  assert.equal((await call('olive', 'POST', `/dating/requests/${req.json.conversationId}/decline`)).json.status, 'declined');
  assert.equal(await coins('quin'), 0, 'no refund');
  assert.equal((await one(env, `SELECT count(*)::int AS n FROM wallet_entries WHERE user_id = $1 AND amount > 0 AND kind <> 'admin_adjust'`, [ids.quin])).n, 0);
  assert.ok((await one(env, 'SELECT closed_at FROM dating_conversations WHERE conversation_id = $1', [req.json.conversationId])).closed_at, 'a declined request is closed (retention applies)');
  // verification is not needed to message: two unverified members chat (sam ⇄ vic chat above; sam is not verified)
  assert.equal((await one(env, 'SELECT verified FROM dating_profiles WHERE user_id = $1', [ids.sam])).verified, false);
  await rules({ adMinWatchSec: 0 });
  const stt = await call('sam', 'POST', `/dating/conversations/${ids.convSV}/ad/start`);
  await call('sam', 'POST', '/dating/ads/claim', { nonce: stt.json.nonce, token: stt.json.token });
  assert.equal((await call('sam', 'POST', `/conversations/${ids.convSV}/messages`, { text: 'Hello Vic' })).status, 201);
  await rules({});
});
