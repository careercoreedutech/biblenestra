// WATCH & EARN (dev update v1): rewarded ads (purpose 'earn') credit Kingdom Coins. Covers crediting with a ledger row, the
// daily cap, dedupe by transaction id, the Africa/Lagos day reset, the streak bonus, the admin config (registerConfig
// 'watch_earn'), the disabled switch, GET /earn/status and the dev claim route.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { setConfig } from '../src/lib/wallet.js';
import { applyWatchEarnAd, checkWatchEarn, lagosDay, shiftDay, streakLength, earnStatus, DEFAULT_WATCH_EARN } from '../src/lib/watchEarn.js';
import { applyAdReward } from '../src/routes/rewards.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt', ADS_CLIENT_CLAIM: 'true' };
  await app.fetch(new Request('http://api.test/earn/status', { headers: { 'X-Dev-User': 'earn_admin' } }), env);
  await env.__db.query("UPDATE users SET role = 'admin' WHERE clerk_id = 'dev_earn_admin'");
});

async function call(user, method, p, body, extraHeaders = {}, e = env) {
  const h = { ...extraHeaders };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), e);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (err) { json = text; }
  return { status: res.status, json };
}
const sql = async (t, p) => { const r = await env.__db.query(t, p); return Array.isArray(r) ? r : r.rows; };
const uid = async (user) => (await sql('SELECT id FROM users WHERE clerk_id = $1', [`dev_${user}`]))[0].id;
const coinsOf = async (user) => (await sql('SELECT coins FROM users WHERE clerk_id = $1', [`dev_${user}`]))[0].coins;
const setCoins = (user, n) => env.__db.query('UPDATE users SET coins = $2 WHERE clerk_id = $1', [`dev_${user}`, n]);
const ensure = async (user) => { await call(user, 'GET', '/earn/status'); return uid(user); };
// Lagos is UTC+1: 10:00 UTC on these dates is 11:00 Lagos on the same day.
const at = (day, hhmmUtc = '10:00') => Date.parse(`${day}T${hhmmUtc}:00Z`);
const setCfg = (v) => setConfig(env, 'watch_earn', v);
const DAY1 = '2026-11-10';
const DAY2 = '2026-11-11';
const DAY3 = '2026-11-12';

test('config: defaults are enabled, 2 coins per ad, 10 ads a day, 20 coins every 7 days', () => {
  assert.deepEqual(DEFAULT_WATCH_EARN, { enabled: true, coinsPerAd: 2, dailyAds: 10, streakBonus: { days: 7, coins: 20 } });
  assert.equal(checkWatchEarn(DEFAULT_WATCH_EARN), true);
});

test('config: the validator refuses bad values, so setConfig refuses them too', async () => {
  assert.equal(checkWatchEarn({ ...DEFAULT_WATCH_EARN, coinsPerAd: 0 }), false);
  assert.equal(checkWatchEarn({ ...DEFAULT_WATCH_EARN, dailyAds: 1.5 }), false);
  assert.equal(checkWatchEarn({ ...DEFAULT_WATCH_EARN, enabled: 'yes' }), false);
  assert.equal(checkWatchEarn({ ...DEFAULT_WATCH_EARN, streakBonus: { days: 1, coins: 5 } }), false);
  assert.equal(checkWatchEarn({ ...DEFAULT_WATCH_EARN, streakBonus: null }), false);
  await assert.rejects(() => setCfg({ enabled: true, coinsPerAd: -1, dailyAds: 10, streakBonus: { days: 7, coins: 20 } }), /Invalid value/);
});

test('crediting: a verified ad adds coinsPerAd to users.coins and writes one watch_earn ledger row', async () => {
  await setCfg(DEFAULT_WATCH_EARN);
  const id = await ensure('earn_credit');
  await setCoins('earn_credit', 0);
  const r = await applyWatchEarnAd(env, id, { transactionId: 'earn-credit-1', verified: true, now: at(DAY1) });
  assert.equal(r.credited, true);
  assert.equal(r.coinsEarned, 2);
  assert.equal(r.adsToday, 1);
  assert.equal(r.bonus, null);
  assert.equal(await coinsOf('earn_credit'), 2);
  const led = await sql("SELECT amount, ref FROM coin_ledger WHERE user_id = $1 AND reason = 'watch_earn'", [id]);
  assert.deepEqual(led.map((x) => [x.amount, x.ref]), [[2, 'earn-credit-1']]);
});

test('dedupe: the same transaction id counts once, however many times it arrives', async () => {
  await setCfg(DEFAULT_WATCH_EARN);
  const id = await ensure('earn_dedupe');
  await setCoins('earn_dedupe', 0);
  const first = await applyWatchEarnAd(env, id, { transactionId: 'earn-dedupe-1', verified: true, now: at(DAY1) });
  const again = await applyWatchEarnAd(env, id, { transactionId: 'earn-dedupe-1', verified: true, now: at(DAY1) });
  assert.equal(first.credited, true);
  assert.equal(again.credited, false);
  assert.equal(again.duplicate, true);
  assert.equal(await coinsOf('earn_dedupe'), 2, 'replayed SSV does not credit twice');
  assert.equal((await sql("SELECT count(*)::int AS n FROM coin_ledger WHERE user_id = $1 AND reason = 'watch_earn'", [id]))[0].n, 1);
});

test('daily cap: dailyAds ads a day are credited, then the next is capped and nothing is credited', async () => {
  await setCfg({ ...DEFAULT_WATCH_EARN, dailyAds: 3 });
  const id = await ensure('earn_cap');
  await setCoins('earn_cap', 0);
  for (const t of ['cap-a', 'cap-b', 'cap-c']) {
    const r = await applyWatchEarnAd(env, id, { transactionId: `earn-${t}`, verified: true, now: at(DAY1) });
    assert.equal(r.credited, true, t);
  }
  assert.equal(await coinsOf('earn_cap'), 6);
  const capped = await applyWatchEarnAd(env, id, { transactionId: 'earn-cap-d', verified: true, now: at(DAY1) });
  assert.equal(capped.credited, false);
  assert.equal(capped.capped, true);
  assert.equal(capped.adsToday, 3);
  assert.equal(await coinsOf('earn_cap'), 6, 'no coins past the cap');
  assert.equal((await sql('SELECT count(*)::int AS n FROM watch_earn_ads WHERE transaction_id = $1', ['earn-cap-d']))[0].n, 0, 'capped ad leaves no row');
  await setCfg(DEFAULT_WATCH_EARN);
});

test('Lagos day reset: the cap resets at Africa/Lagos midnight, not UTC midnight', async () => {
  await setCfg({ ...DEFAULT_WATCH_EARN, dailyAds: 1 });
  const id = await ensure('earn_lagos');
  await setCoins('earn_lagos', 0);
  // 22:30 UTC on day 1 is 23:30 in Lagos: still day 1
  const late = await applyWatchEarnAd(env, id, { transactionId: 'earn-lagos-late', verified: true, now: at(DAY1, '22:30') });
  assert.equal(late.credited, true);
  // 23:30 UTC on day 1 is 00:30 Lagos on day 2 (a new day), so the cap has reset although it is still day 1 in UTC
  const next = await applyWatchEarnAd(env, id, { transactionId: 'earn-lagos-next', verified: true, now: at(DAY1, '23:30') });
  assert.equal(next.credited, true, 'new Lagos day, so a new ad is allowed');
  assert.equal(next.adsToday, 1);
  // and one more in the same Lagos day is capped
  const capped = await applyWatchEarnAd(env, id, { transactionId: 'earn-lagos-capped', verified: true, now: at(DAY1, '23:50') });
  assert.equal(capped.capped, true);
  assert.equal(await coinsOf('earn_lagos'), 4);
  await setCfg(DEFAULT_WATCH_EARN);
});

test('Lagos day helpers: the boundary is at 23:00 UTC, and days shift by whole days', () => {
  assert.equal(lagosDay(Date.parse('2026-11-10T22:59:00Z')), '2026-11-10');
  assert.equal(lagosDay(Date.parse('2026-11-10T23:00:00Z')), '2026-11-11');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('streak: counts runs ending today, or ending yesterday while today has no ad yet', () => {
  const days = new Set(['2026-11-08', '2026-11-09', '2026-11-10']);
  assert.equal(streakLength(days, '2026-11-10'), 3);
  assert.equal(streakLength(days, '2026-11-11'), 3, 'still alive until today ends');
  assert.equal(streakLength(days, '2026-11-12'), 0, 'broken after a missed day');
});

test('streak bonus: paid once when the run reaches streakBonus.days, even with several ads that day', async () => {
  await setCfg({ ...DEFAULT_WATCH_EARN, dailyAds: 5, streakBonus: { days: 2, coins: 5 } });
  const id = await ensure('earn_streak');
  await setCoins('earn_streak', 0);
  const d1 = await applyWatchEarnAd(env, id, { transactionId: 'streak-d1', verified: true, now: at(DAY1) });
  assert.equal(d1.bonus, null, 'day 1 is not a multiple of 2');
  const d2a = await applyWatchEarnAd(env, id, { transactionId: 'streak-d2a', verified: true, now: at(DAY2) });
  assert.deepEqual(d2a.bonus, { coins: 5, days: 2 }, 'run of 2 days pays the bonus');
  const d2b = await applyWatchEarnAd(env, id, { transactionId: 'streak-d2b', verified: true, now: at(DAY2, '14:00') });
  assert.equal(d2b.bonus, null, 'paid once per day');
  assert.equal(await coinsOf('earn_streak'), 2 + 2 + 5 + 2);
  const bonusRows = await sql('SELECT count(*)::int AS n FROM watch_earn_bonuses WHERE user_id = $1', [id]);
  assert.equal(bonusRows[0].n, 1);
  await setCfg(DEFAULT_WATCH_EARN);
});

test('streak bonus: a missed day restarts the run, so no bonus on the next single day', async () => {
  await setCfg({ ...DEFAULT_WATCH_EARN, dailyAds: 5, streakBonus: { days: 2, coins: 5 } });
  const id = await ensure('earn_gap');
  await applyWatchEarnAd(env, id, { transactionId: 'gap-d1', verified: true, now: at(DAY1) });
  const d3 = await applyWatchEarnAd(env, id, { transactionId: 'gap-d3', verified: true, now: at(DAY3) });
  assert.equal(d3.bonus, null);
  await setCfg(DEFAULT_WATCH_EARN);
});

test('disabled: no coins, no rows, and the status says so', async () => {
  await setCfg({ ...DEFAULT_WATCH_EARN, enabled: false });
  const id = await ensure('earn_off');
  await setCoins('earn_off', 7);
  const r = await applyWatchEarnAd(env, id, { transactionId: 'earn-off-1', verified: true, now: at(DAY1) });
  assert.equal(r.credited, false);
  assert.equal(r.disabled, true);
  assert.equal(await coinsOf('earn_off'), 7);
  assert.equal((await sql('SELECT count(*)::int AS n FROM watch_earn_ads WHERE transaction_id = $1', ['earn-off-1']))[0].n, 0);
  const s = await call('earn_off', 'GET', '/earn/status');
  assert.equal(s.json.enabled, false);
  assert.equal(s.json.canWatch, false);
  await setCfg(DEFAULT_WATCH_EARN);
});

test('applyAdReward: purpose earn is routed to Watch & Earn; unknown purposes still fail', async () => {
  await setCfg(DEFAULT_WATCH_EARN);
  const id = await ensure('earn_route');
  await setCoins('earn_route', 0);
  const r = await applyAdReward(env, id, 'earn', { transactionId: 'earn-route-1', verified: true });
  assert.equal(r.credited, true);
  assert.equal(await coinsOf('earn_route'), 2);
  await assert.rejects(() => applyAdReward(env, id, 'nope', {}), /purpose must be/);
});

test('GET /earn/status: today, cap, coins, next reward, streak and config', async () => {
  await setCfg(DEFAULT_WATCH_EARN);
  const id = await ensure('earn_status');
  await setCoins('earn_status', 0);
  const fresh = await call('earn_status', 'GET', '/earn/status');
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.adsToday, 0);
  assert.equal(fresh.json.dailyAds, 10);
  assert.equal(fresh.json.adsLeftToday, 10);
  assert.equal(fresh.json.canWatch, true);
  assert.equal(fresh.json.coins, 0);
  assert.equal(fresh.json.nextReward.coins, 2);
  assert.equal(fresh.json.streak.length, 0);
  assert.equal(fresh.json.streak.watchedToday, false);
  assert.equal(fresh.json.streak.daysToBonus, 7);
  assert.deepEqual(fresh.json.config, DEFAULT_WATCH_EARN);
  assert.match(fresh.json.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(new Date(fresh.json.resetsAt).getTime() > Date.now());

  // one ad today through the same server path the SSV route uses
  const today = lagosDay();
  await applyWatchEarnAd(env, id, { transactionId: 'earn-status-today', verified: true, now: Date.now() });
  const s = await call('earn_status', 'GET', '/earn/status');
  assert.equal(s.json.adsToday, 1);
  assert.equal(s.json.adsLeftToday, 9);
  assert.equal(s.json.coins, 2);
  assert.equal(s.json.coinsToday, 2);
  assert.equal(s.json.day, today);
  assert.equal(s.json.streak.length, 1);
  assert.equal(s.json.streak.watchedToday, true);
  assert.equal(s.json.streak.daysToBonus, 6);
});

test('earnStatus: next streak bonus lands at the next multiple of days', async () => {
  await setCfg({ ...DEFAULT_WATCH_EARN, streakBonus: { days: 3, coins: 9 } });
  const id = await ensure('earn_next');
  const base = Date.now();
  for (let i = 2; i >= 0; i -= 1) {
    const day = shiftDay(lagosDay(base), -i);
    await applyWatchEarnAd(env, id, { transactionId: `earn-next-${i}`, verified: true, now: Date.parse(`${day}T10:00:00Z`) });
  }
  const s = await earnStatus(env, id, base);
  assert.equal(s.streak.length, 3);
  assert.equal(s.streak.watchedToday, true);
  assert.equal(s.streak.nextBonusAt, 6);
  assert.equal(s.streak.daysToBonus, 3);
  await setCfg(DEFAULT_WATCH_EARN);
});

test('POST /ads/claim with purpose earn (dev, ADS_CLIENT_CLAIM=true) credits and returns the earn result', async () => {
  await setCfg(DEFAULT_WATCH_EARN);
  await ensure('earn_claim');
  await setCoins('earn_claim', 0);
  const r = await call('earn_claim', 'POST', '/ads/claim', { purpose: 'earn' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.earn.credited, true);
  assert.equal(r.json.coins, 2);
});

test('POST /ads/claim with purpose earn is refused in production (ADS_CLIENT_CLAIM not true), like the other purposes', async () => {
  const prod = { ...env, ADS_CLIENT_CLAIM: 'false' };
  await ensure('earn_prod');
  const r = await call('earn_prod', 'POST', '/ads/claim', { purpose: 'earn' }, {}, prod);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'SSV_REQUIRED');
});

test('GET /earn/status needs a signed-in user', async () => {
  const r = await call(null, 'GET', '/earn/status');
  assert.equal(r.status, 401);
});
