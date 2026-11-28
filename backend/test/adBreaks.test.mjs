// AD BREAKS (dev update v1, items 4 and 5): the interstitial rules are admin-editable through registerConfig 'ad_breaks',
// returned by the public GET /ads/config, validated, and the client's frequency policy (src/ads/breaksPolicy.js, pure)
// keeps breaks apart and within the caps.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { setConfig } from '../src/lib/wallet.js';
import { DEFAULT_BREAK_RULES, normalizeBreakRules, checkBreakRules } from '../src/lib/ads.js';
import {
  breakBlock, isBlockedRoute, nextBreakAt, DEFAULT_CLIENT_BREAK_RULES, mergeBreakRules,
} from '../../src/ads/breaksPolicy.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt' };
});

async function get(p) {
  const res = await app.fetch(new Request(`http://api.test${p}`), env);
  return { status: res.status, json: await res.json() };
}

test('defaults: 5 active minutes, 15 minute gap, 2 an hour, 6 a day, 66 Books first-open on', () => {
  assert.deepEqual({ ...DEFAULT_BREAK_RULES }, {
    enabled: true, activeMinutes: 5, minGapMinutes: 15, maxPerHour: 2, maxPerDay: 6, bookListFirstOpen: true,
  });
});

test('GET /ads/config (public) returns the break rules next to the ad rules', async () => {
  const r = await get('/ads/config');
  assert.equal(r.status, 200);
  assert.equal(r.json.breaks.activeMinutes, 5);
  assert.equal(r.json.breaks.minGapMinutes, 15);
  assert.ok(r.json.config, 'the existing ad rules document is still there');
});

test('config validation: bad values are refused with BAD_CONFIG', async () => {
  for (const bad of [{ activeMinutes: 0 }, { activeMinutes: 2.5 }, { activeMinutes: 500 }, { maxPerHour: -1 }, { enabled: 'yes' }, { minGapMinutes: 99999 }]) {
    await assert.rejects(() => setConfig(env, 'ad_breaks', bad), (e) => e.code === 'BAD_CONFIG', JSON.stringify(bad));
  }
  assert.equal(checkBreakRules({ activeMinutes: 5 }), true);
});

test('admin change: a new interval is served by GET /ads/config, unspecified fields keep their defaults', async () => {
  await setConfig(env, 'ad_breaks', { activeMinutes: 3, maxPerHour: 4 });
  const r = await get('/ads/config');
  assert.equal(r.json.breaks.activeMinutes, 3);
  assert.equal(r.json.breaks.maxPerHour, 4);
  assert.equal(r.json.breaks.minGapMinutes, 15);
  await setConfig(env, 'ad_breaks', DEFAULT_BREAK_RULES);
  assert.equal((await get('/ads/config')).json.breaks.activeMinutes, 5);
});

test('normalizeBreakRules: an invalid stored value falls back to the defaults entirely', () => {
  assert.deepEqual(normalizeBreakRules({ activeMinutes: 'nope' }), { ...DEFAULT_BREAK_RULES });
  assert.equal(normalizeBreakRules({ enabled: false }).enabled, false);
});

// ---------- client policy (pure) ----------
const MIN = 60000;
const rules = mergeBreakRules({});

test('policy: nothing is due before the active minutes are reached', () => {
  const now = Date.now();
  assert.equal(breakBlock(rules, { history: [] }, now), null);
  assert.equal(DEFAULT_CLIENT_BREAK_RULES.activeMinutes, 5);
});

test('policy: minimum gap is enforced between breaks', () => {
  const now = Date.now();
  assert.equal(breakBlock(rules, { history: [now - 5 * MIN] }, now), 'too_soon');
  assert.equal(breakBlock(rules, { history: [now - 16 * MIN] }, now), null);
});

test('policy: hourly and daily caps', () => {
  const now = Date.now();
  // two in the last hour (gap satisfied by spacing them out) → hour cap
  const twoInHour = [now - 40 * MIN, now - 20 * MIN];
  assert.equal(breakBlock(rules, { history: twoInHour }, now), 'hour_cap');
  // six across the day, none in the last hour → day cap
  const six = [5, 6, 7, 8, 9, 10].map((h) => now - h * 60 * MIN);
  assert.equal(breakBlock(rules, { history: six }, now), 'day_cap');
  // entries older than 24 h do not count
  assert.equal(breakBlock(rules, { history: [now - 25 * 60 * MIN] }, now), null);
});

test('policy: disabled rules and the master switch block everything', () => {
  const now = Date.now();
  assert.equal(breakBlock(mergeBreakRules({ enabled: false }), { history: [] }, now), 'off');
  assert.equal(breakBlock(rules, { history: [] }, now, { premium: true }), 'premium');
  assert.equal(breakBlock(rules, { history: [] }, now, { adsEnabled: false }), 'off');
});

test('policy: the next possible break respects the gap and the caps', () => {
  const now = Date.now();
  assert.equal(nextBreakAt(rules, { history: [now - 5 * MIN] }, now), now - 5 * MIN + 15 * MIN);
  assert.equal(nextBreakAt(rules, { history: [] }, now), now);
});

test('policy: reading, recording, prayer and checkout screens are never interrupted', () => {
  for (const name of ['Bible', 'BookReader', 'ExtraBook', 'SermonStudio', 'RecordingDetail', 'PrayerWall', 'PrayerDetail', 'NewPrayer', 'DatingPlans', 'GiftStore', 'FundMeCredits']) {
    assert.equal(isBlockedRoute(name), true, name);
  }
  assert.equal(isBlockedRoute('Today'), false);
  assert.equal(isBlockedRoute('Jobs'), false);
});
