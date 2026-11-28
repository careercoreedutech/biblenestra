// FEATURE UNLOCKS (dev update v1, package C step 0): timed feature access bought with Kingdom Coins (users.coins) or
// earned with rewarded ads. Covers spend, idempotency, extend-while-active, expiry, ad-earned coins with the per-feature
// cap, insufficient coins, and the admin-editable catalogue (registerConfig 'feature_unlocks').
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { setConfig } from '../src/lib/wallet.js';
import { DEFAULT_FEATURE_UNLOCKS, applyUnlockAd, hasUnlock } from '../src/lib/featureUnlocks.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt', ADS_CLIENT_CLAIM: 'true' };
  await app.fetch(new Request('http://api.test/unlocks', { headers: { 'X-Dev-User': 'unl_admin' } }), env);
  await env.__db.query("UPDATE users SET role = 'admin' WHERE clerk_id = 'dev_unl_admin'");
});

async function call(user, method, p, body, extraHeaders = {}) {
  const h = { ...extraHeaders };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const sql = async (t, p) => { const r = await env.__db.query(t, p); return Array.isArray(r) ? r : r.rows; };
const uid = async (user) => (await sql('SELECT id FROM users WHERE clerk_id = $1', [`dev_${user}`]))[0].id;
const coinsOf = async (user) => (await sql('SELECT coins FROM users WHERE clerk_id = $1', [`dev_${user}`]))[0].coins;
const setCoins = (user, n) => env.__db.query('UPDATE users SET coins = $2 WHERE clerk_id = $1', [`dev_${user}`, n]);
const minutesFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 60000;

test('catalogue: defaults match the brief (scripture_pop 4 coins/24 h, recording 5 coins/1 h)', () => {
  assert.equal(DEFAULT_FEATURE_UNLOCKS.scripture_pop.coins, 4);
  assert.equal(DEFAULT_FEATURE_UNLOCKS.scripture_pop.hours, 24);
  assert.deepEqual(DEFAULT_FEATURE_UNLOCKS.scripture_pop.adRewards, [1, 1, 1, 1]);
  assert.equal(DEFAULT_FEATURE_UNLOCKS.recording.coins, 5);
  assert.equal(DEFAULT_FEATURE_UNLOCKS.recording.hours, 1);
  assert.deepEqual(DEFAULT_FEATURE_UNLOCKS.recording.adRewards, [2, 2, 1]); // 3 ads earn the 5 coins
});

test('GET /unlocks: starts with the welcome coins, nothing active, full catalogue', async () => {
  const r = await call('unl_new', 'GET', '/unlocks');
  assert.equal(r.status, 200);
  assert.equal(r.json.coins, 50);
  assert.deepEqual(r.json.active, []);
  assert.equal(r.json.catalogue.scripture_pop.coins, 4);
  assert.equal(r.json.catalogue.recording.coins, 5);
  assert.equal(r.json.catalogue.scripture_pop.unlocked, false);
  assert.equal(r.json.catalogue.scripture_pop.remainingSec, 0);
  assert.equal(r.json.catalogue.scripture_pop.adsWatched, 0);
  assert.equal(r.json.catalogue.scripture_pop.adsNeeded, 4);
});

test('spend: 4 coins buy scripture_pop for 24 hours and write a ledger row', async () => {
  await call('unl_spend', 'GET', '/unlocks');
  await setCoins('unl_spend', 20);
  const r = await call('unl_spend', 'POST', '/unlocks/scripture_pop', { ref: 'unl-spend-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.coins, 16);
  assert.equal(r.json.unlock.feature, 'scripture_pop');
  assert.ok(Math.abs(minutesFromNow(r.json.unlock.until) - 24 * 60) < 2, 'until ≈ now + 24 h');
  assert.equal(await coinsOf('unl_spend'), 16);
  const led = await sql("SELECT amount, reason FROM coin_ledger WHERE user_id = $1 AND reason = 'unlock'", [await uid('unl_spend')]);
  assert.deepEqual(led.map((x) => x.amount), [-4]);
  assert.equal(await hasUnlock(env, await uid('unl_spend'), 'scripture_pop'), true);
});

test('idempotent: the same Idempotency-Key twice charges and grants once', async () => {
  await call('unl_idem', 'GET', '/unlocks');
  await setCoins('unl_idem', 20);
  const first = await call('unl_idem', 'POST', '/unlocks/scripture_pop', undefined, { 'Idempotency-Key': 'idem-key-1' });
  const again = await call('unl_idem', 'POST', '/unlocks/scripture_pop', undefined, { 'Idempotency-Key': 'idem-key-1' });
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
  assert.equal(again.json.coins, 16);
  assert.equal(await coinsOf('unl_idem'), 16);
  const rows = await sql("SELECT count(*)::int AS n FROM feature_unlock_spends WHERE ref LIKE '%:scripture_pop:idem-key-1'");
  assert.equal(rows[0].n, 1);
  assert.equal((await sql("SELECT count(*)::int AS n FROM coin_ledger WHERE user_id = $1 AND reason = 'unlock'", [await uid('unl_idem')]))[0].n, 1);
});

test('extend: buying again while still active adds 24 h to the current expiry', async () => {
  await call('unl_ext', 'GET', '/unlocks');
  await setCoins('unl_ext', 20);
  const a = await call('unl_ext', 'POST', '/unlocks/scripture_pop', { ref: 'unl-ext-1' });
  const b = await call('unl_ext', 'POST', '/unlocks/scripture_pop', { ref: 'unl-ext-2' });
  const gained = (new Date(b.json.unlock.until) - new Date(a.json.unlock.until)) / 3600000;
  assert.ok(Math.abs(gained - 24) < 0.01, `extension adds 24 h, got ${gained}`);
  assert.equal(b.json.coins, 12);
});

test('expiry: an expired unlock is not active, and buying again starts from now (not from the old expiry)', async () => {
  await call('unl_exp', 'GET', '/unlocks');
  await setCoins('unl_exp', 20);
  await call('unl_exp', 'POST', '/unlocks/scripture_pop', { ref: 'unl-exp-1' });
  await env.__db.query("UPDATE feature_unlocks SET until = now() - interval '5 minutes' WHERE user_id = $1", [await uid('unl_exp')]);
  const g = await call('unl_exp', 'GET', '/unlocks');
  assert.equal(g.json.catalogue.scripture_pop.unlocked, false);
  assert.deepEqual(g.json.active, []);
  assert.equal(await hasUnlock(env, await uid('unl_exp'), 'scripture_pop'), false);
  const r = await call('unl_exp', 'POST', '/unlocks/scripture_pop', { ref: 'unl-exp-2' });
  assert.ok(Math.abs(minutesFromNow(r.json.unlock.until) - 24 * 60) < 2, 'restarts from now');
});

test('insufficient coins: 402, nothing debited, nothing granted, and the claim is released', async () => {
  await call('unl_poor', 'GET', '/unlocks');
  await setCoins('unl_poor', 3);
  const r = await call('unl_poor', 'POST', '/unlocks/scripture_pop', { ref: 'unl-poor-1' });
  assert.equal(r.status, 402);
  assert.equal(r.json.code, 'INSUFFICIENT_COINS');
  assert.equal(await coinsOf('unl_poor'), 3);
  assert.equal(await hasUnlock(env, await uid('unl_poor'), 'scripture_pop'), false);
  assert.equal((await sql('SELECT count(*)::int AS n FROM feature_unlock_spends WHERE ref = $1', ['unl-poor-1']))[0].n, 0);
  // the same ref can be retried once the user has coins
  await setCoins('unl_poor', 10);
  const ok = await call('unl_poor', 'POST', '/unlocks/scripture_pop', { ref: 'unl-poor-1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.coins, 6);
});

test('unknown feature is a 404 and costs nothing', async () => {
  await call('unl_404', 'GET', '/unlocks');
  const r = await call('unl_404', 'POST', '/unlocks/not_a_feature', { ref: 'unl-404-1' });
  assert.equal(r.status, 404);
  assert.equal(await coinsOf('unl_404'), 50);
});

test('ads: each rewarded ad credits its share of the coins, capped at the ads needed; duplicates are ignored', async () => {
  await call('unl_ads', 'GET', '/unlocks');
  await setCoins('unl_ads', 0);
  const id = await uid('unl_ads');
  const r1 = await applyUnlockAd(env, id, 'scripture_pop', { transactionId: 'tx-a1', verified: true });
  assert.equal(r1.credited, true);
  assert.equal(r1.adsWatched, 1);
  assert.equal(await coinsOf('unl_ads'), 1);
  const dup = await applyUnlockAd(env, id, 'scripture_pop', { transactionId: 'tx-a1', verified: true });
  assert.equal(dup.duplicate, true);
  assert.equal(await coinsOf('unl_ads'), 1, 'replayed SSV does not credit twice');
  for (const t of ['tx-a2', 'tx-a3', 'tx-a4']) await applyUnlockAd(env, id, 'scripture_pop', { transactionId: t, verified: true });
  assert.equal(await coinsOf('unl_ads'), 4);
  const capped = await applyUnlockAd(env, id, 'scripture_pop', { transactionId: 'tx-a5', verified: true });
  assert.equal(capped.credited, false, 'no more ad coins until the unlock is bought');
  assert.equal(await coinsOf('unl_ads'), 4);
  const g = await call('unl_ads', 'GET', '/unlocks');
  assert.equal(g.json.catalogue.scripture_pop.adsWatched, 4);
});

test('ads then spend: earned coins buy the unlock and reset the ad progress', async () => {
  await call('unl_earn', 'GET', '/unlocks');
  await setCoins('unl_earn', 0);
  const id = await uid('unl_earn');
  for (const t of ['tx-e1', 'tx-e2', 'tx-e3', 'tx-e4']) await applyUnlockAd(env, id, 'scripture_pop', { transactionId: t, verified: true });
  const r = await call('unl_earn', 'POST', '/unlocks/scripture_pop', { ref: 'unl-earn-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.coins, 0);
  assert.equal(r.json.unlock.feature, 'scripture_pop');
  const g = await call('unl_earn', 'GET', '/unlocks');
  assert.equal(g.json.catalogue.scripture_pop.adsWatched, 0, 'progress resets for the next cycle');
  const again = await applyUnlockAd(env, id, 'scripture_pop', { transactionId: 'tx-e5', verified: true });
  assert.equal(again.credited, true, 'a new cycle can earn coins again');
});

test('recording: 3 ads earn the 5 coins (2 + 2 + 1), then one hour of recording', async () => {
  await call('unl_rec', 'GET', '/unlocks');
  await setCoins('unl_rec', 0);
  const id = await uid('unl_rec');
  const amounts = [];
  for (const t of ['tx-r1', 'tx-r2', 'tx-r3']) amounts.push((await applyUnlockAd(env, id, 'recording', { transactionId: t, verified: true })).coins);
  assert.equal(await coinsOf('unl_rec'), 5);
  assert.deepEqual(amounts, [2, 4, 5]);
  const r = await call('unl_rec', 'POST', '/unlocks/recording', { ref: 'unl-rec-1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.coins, 0);
  assert.ok(Math.abs(minutesFromNow(r.json.unlock.until) - 60) < 2);
});

test('dev ad claim route: purpose unlock:<feature> goes through the same rules', async () => {
  await call('unl_claim', 'GET', '/unlocks');
  await setCoins('unl_claim', 0);
  const r = await call('unl_claim', 'POST', '/ads/claim', { purpose: 'unlock:scripture_pop' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.coins, 1);
  const bad = await call('unl_claim', 'POST', '/ads/claim', { purpose: 'unlock:nope' });
  assert.equal(bad.status, 400);
});

test('config: the catalogue is admin-editable, validated, and used by the spend', async () => {
  await assert.rejects(() => setConfig(env, 'feature_unlocks', { scripture_pop: { coins: 4, hours: 24, adRewards: [1, 1] } }), (e) => e.code === 'BAD_CONFIG');
  await assert.rejects(() => setConfig(env, 'feature_unlocks', { scripture_pop: { coins: 0, hours: 24, adRewards: [] } }), (e) => e.code === 'BAD_CONFIG');
  await assert.rejects(() => setConfig(env, 'feature_unlocks', { 'Bad Key': { coins: 1, hours: 1, adRewards: [] } }), (e) => e.code === 'BAD_CONFIG');
  await setConfig(env, 'feature_unlocks', { ...DEFAULT_FEATURE_UNLOCKS, scripture_pop: { ...DEFAULT_FEATURE_UNLOCKS.scripture_pop, coins: 2, adRewards: [1, 1] } });
  await call('unl_cfg', 'GET', '/unlocks');
  await setCoins('unl_cfg', 10);
  const r = await call('unl_cfg', 'POST', '/unlocks/scripture_pop', { ref: 'unl-cfg-1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.coins, 8, 'the new price is charged');
  const g = await call('unl_cfg', 'GET', '/unlocks');
  assert.equal(g.json.catalogue.scripture_pop.adsNeeded, 2);
  // put the default back for the other tests in this file
  await setConfig(env, 'feature_unlocks', DEFAULT_FEATURE_UNLOCKS);
});

test('auth: signed-out callers are refused', async () => {
  const r = await app.fetch(new Request('http://api.test/unlocks'), env);
  assert.equal(r.status, 401);
});
