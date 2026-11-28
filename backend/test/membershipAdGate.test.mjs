// MEMBERSHIP AD GATE (client request 2026-11-27): period maths, counting and dedupe, pass issuance per frequency,
// the chat guard, exemptions (owner, admin, Plus), the owner / admin settings, the creation fee preview and the
// new-membership default. Pure helpers are tested directly; the rest runs the real app against the local test database.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { setConfig } from '../src/lib/wallet.js';
import {
  periodFor, passUntilFor, gateState, cleanAdGate, checkAdGateSettings, applyMembershipGateAd, DEFAULT_AD_GATE,
} from '../src/lib/membershipAdGate.js';
import { applyAdReward } from '../src/routes/rewards.js';

// ---------- pure helpers ----------
const at = (iso) => new Date(iso);

test('daily period runs midnight to midnight in Africa/Lagos (UTC+1)', () => {
  // 22:30 UTC on 28 Nov is 23:30 in Lagos: still the 28th
  const a = periodFor('daily', at('2026-11-28T22:30:00Z'));
  assert.equal(a.key, 'd:2026-11-28');
  assert.equal(a.end.toISOString(), '2026-11-28T23:00:00.000Z');
  // 23:30 UTC is 00:30 in Lagos on the 29th: a new period
  const b = periodFor('daily', at('2026-11-28T23:30:00Z'));
  assert.equal(b.key, 'd:2026-11-29');
  assert.equal(b.start.toISOString(), '2026-11-28T23:00:00.000Z');
  assert.equal(b.end.toISOString(), '2026-11-29T23:00:00.000Z');
});

test('weekly period runs from Monday 00:00 Lagos to the next Monday (ISO week)', () => {
  // 28 Nov 2026 is a Saturday; its ISO week starts Monday 23 Nov
  const p = periodFor('weekly', at('2026-11-28T10:00:00Z'));
  assert.equal(p.key, 'w:2026-11-23');
  assert.equal(p.start.toISOString(), '2026-11-22T23:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-11-29T23:00:00.000Z');
  // Sunday 29 Nov evening is still the same week; Monday 00:30 Lagos starts the next one
  assert.equal(periodFor('weekly', at('2026-11-29T22:59:00Z')).key, 'w:2026-11-23');
  assert.equal(periodFor('weekly', at('2026-11-29T23:30:00Z')).key, 'w:2026-11-30');
});

test('every_entry pass lasts 15 minutes from now', () => {
  const now = at('2026-11-28T10:00:00Z');
  assert.equal(passUntilFor('every_entry', now).toISOString(), '2026-11-28T10:15:00.000Z');
  assert.equal(periodFor('every_entry', now).key, 'entry');
});

test('settings validation: ads 1 to 10, known frequency, boolean enabled', () => {
  assert.equal(checkAdGateSettings(DEFAULT_AD_GATE), true);
  assert.equal(checkAdGateSettings({ enabled: true, ads: 10, frequency: 'weekly' }), true);
  assert.equal(checkAdGateSettings({ enabled: true, ads: 11, frequency: 'weekly' }), false);
  assert.equal(checkAdGateSettings({ enabled: true, ads: 2, frequency: 'monthly' }), false);
  assert.equal(checkAdGateSettings({ enabled: 'yes', ads: 2, frequency: 'daily' }), false);
  assert.deepEqual(cleanAdGate({ ads: '3' }, DEFAULT_AD_GATE), { enabled: false, ads: 3, frequency: 'daily' });
  assert.deepEqual(cleanAdGate({ enabled: true }, { enabled: false, ads: 2, frequency: 'weekly' }), { enabled: true, ads: 2, frequency: 'weekly' });
  assert.throws(() => cleanAdGate({ ads: 0 }), (e) => e.code === 'BAD_AD_GATE');
  assert.throws(() => cleanAdGate({ ads: 2.5 }), (e) => e.code === 'BAD_AD_GATE');
  assert.throws(() => cleanAdGate({ frequency: 'hourly' }), (e) => e.code === 'BAD_AD_GATE');
  assert.throws(() => cleanAdGate({ enabled: 'true' }), (e) => e.code === 'BAD_AD_GATE');
});

test('gateState: required only when enabled, not exempt and without a valid pass', () => {
  const now = at('2026-11-28T10:00:00Z');
  const on = { enabled: true, ads: 2, frequency: 'daily' };
  assert.equal(gateState({ settings: on, adsWatched: 1, now }).required, true);
  assert.equal(gateState({ settings: on, adsWatched: 1, now }).adsWatched, 1);
  assert.equal(gateState({ settings: { ...on, enabled: false }, now }).required, false);
  assert.equal(gateState({ settings: on, exemptReason: 'owner', now }).required, false);
  assert.equal(gateState({ settings: on, exemptReason: 'owner', now }).exemptReason, 'owner');
  const pass = { valid_until: '2026-11-28T23:00:00.000Z' };
  const passed = gateState({ settings: on, pass, adsWatched: 0, now });
  assert.equal(passed.required, false);
  assert.equal(passed.passUntil, '2026-11-28T23:00:00.000Z');
  assert.equal(passed.adsWatched, 2);
  const expired = gateState({ settings: on, pass: { valid_until: '2026-11-28T09:00:00.000Z' }, adsWatched: 0, now });
  assert.equal(expired.required, true);
  assert.equal(expired.passUntil, null);
});

// ---------- the app, against the local test database ----------
let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', MEMBERSHIP_TEST_CHECKOUT: 'true' };
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
const ids = {};
let mem; let master; let exec;

test('setup: a published membership with a paid plan and one subscriber', async () => {
  for (const u of ['boss', 'cara', 'ann', 'ben']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  const r = await call('boss', 'POST', '/memberships/manage', { title: 'Gate Test', category: 'Prayer', ownerUserId: ids.cara });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  mem = r.json;
  assert.equal(mem.adGate.enabled, false, 'new memberships start with the default (off)');
  const plan = await call('boss', 'POST', `/memberships/manage/${mem.id}/plans`, { name: 'Monthly', priceMinor: 500000, interval: 'month' });
  assert.equal(plan.status, 201, JSON.stringify(plan.json));
  const pub = await call('boss', 'POST', `/memberships/manage/${mem.id}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  master = pub.json.channelId; exec = pub.json.communityId;
  for (const u of ['ann', 'ben']) {
    const g = await call('boss', 'POST', `/memberships/manage/${mem.id}/grant`, { userId: ids[u] });
    assert.equal(g.status, 200, JSON.stringify(g.json));
  }
});

test('gate off: members read the sections as before', async () => {
  const r = await call('ann', 'GET', `/conversations/${exec}/messages?limit=5`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const home = await call('ann', 'GET', `/memberships/${mem.id}/home`);
  assert.equal(home.json.adGate.enabled, false);
  assert.equal(home.json.adGate.required, false);
});

test('owner and admin settings: only the owner or a platform admin may change the gate', async () => {
  const denied = await call('ann', 'PUT', `/memberships/${mem.id}/ad-gate`, { enabled: true, ads: 2, frequency: 'daily' });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  const bad = await call('boss', 'PUT', `/memberships/${mem.id}/ad-gate`, { enabled: true, ads: 11, frequency: 'daily' });
  assert.equal(bad.status, 400, JSON.stringify(bad.json));
  const ok = await call('boss', 'PUT', `/memberships/${mem.id}/ad-gate`, { enabled: true, ads: 2, frequency: 'daily' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.enabled, true);
  assert.equal(ok.json.adsNeeded, 2);
  assert.equal(ok.json.exemptReason, 'admin', 'platform admins are exempt, so the response says so');
  const ownerSet = await call('cara', 'PUT', `/memberships/${mem.id}/ad-gate`, { enabled: true, ads: 2, frequency: 'daily' });
  assert.equal(ownerSet.status, 200, JSON.stringify(ownerSet.json));
  assert.equal(ownerSet.json.exempt, true);
  assert.equal(ownerSet.json.exemptReason, 'owner');
  assert.equal(ownerSet.json.required, false);
});

test('the gate blocks a paying member until enough ads are verified', async () => {
  const blocked = await call('ann', 'GET', `/conversations/${exec}/messages?limit=5`);
  assert.equal(blocked.status, 403, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, 'AD_GATE_REQUIRED');
  assert.equal(blocked.json.adsNeeded, 2);
  assert.equal(blocked.json.adsWatched, 0);
  const home = await call('ann', 'GET', `/memberships/${mem.id}/home`);
  assert.equal(home.json.adGate.required, true);
  assert.equal(home.json.adGate.adsNeeded, 2);
  assert.equal(home.json.adGate.frequency, 'daily');
  const master1 = await call('ann', 'GET', `/conversations/${master}/messages?limit=5`);
  assert.equal(master1.status, 403, 'MASTER CLASS is gated too');
});

test('ads count once per transaction id and a pass opens the sections', async () => {
  const first = await applyMembershipGateAd(env, ids.ann, mem.id, { transactionId: 'tx-ann-1', verified: true });
  assert.equal(first.credited, true);
  assert.equal(first.adsWatched, 1);
  assert.equal(first.passIssued, false);
  const again = await applyMembershipGateAd(env, ids.ann, mem.id, { transactionId: 'tx-ann-1', verified: true });
  assert.equal(again.duplicate, true, 'the same ad is not counted twice');
  const still = await call('ann', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(still.json.adsWatched, 1);
  // a second ad, through the SSV path used in production (routes/rewards.js applyAdReward)
  const second = await applyAdReward(env, ids.ann, `membership_gate:${mem.id}`, { transactionId: 'tx-ann-2', verified: true });
  assert.equal(second.passIssued, true);
  const open = await call('ann', 'GET', `/conversations/${exec}/messages?limit=5`);
  assert.equal(open.status, 200, JSON.stringify(open.json));
  const home = await call('ann', 'GET', `/memberships/${mem.id}/home`);
  assert.equal(home.json.adGate.required, false);
  assert.ok(home.json.adGate.passUntil, 'the pass has an end time');
  assert.equal(home.json.adGate.passUntil, periodFor('daily', new Date()).end.toISOString());
});

test('every_entry: a 15 minute pass that ends, then the next entry needs the ads again', async () => {
  await call('boss', 'PUT', `/memberships/${mem.id}/ad-gate`, { enabled: true, ads: 1, frequency: 'every_entry' });
  const blocked = await call('ben', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(blocked.json.required, true);
  assert.equal(blocked.json.frequency, 'every_entry');
  const r = await applyMembershipGateAd(env, ids.ben, mem.id, { transactionId: 'tx-ben-entry-1', verified: true });
  assert.equal(r.passIssued, true);
  const pass = await call('ben', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(pass.json.required, false);
  const minutes = (new Date(pass.json.passUntil) - Date.now()) / 60000;
  assert.ok(minutes > 13 && minutes <= 15.1, `about 15 minutes, got ${minutes}`);
  await q(env, `UPDATE membership_ad_gate_passes SET valid_until = now() - interval '1 minute' WHERE user_id = $1 AND membership_id = $2`, [ids.ben, mem.id]);
  const next = await call('ben', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(next.json.required, true, 'the next entry starts again');
  assert.equal(next.json.adsWatched, 0, 'the count restarted at the pass');
});

test('weekly passes and the Plus exemption', async () => {
  await call('boss', 'PUT', `/memberships/${mem.id}/ad-gate`, { enabled: true, ads: 3, frequency: 'weekly' });
  const plus = await call('ben', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(plus.json.required, true);
  await q(env, `UPDATE users SET premium = true, premium_until = now() + interval '30 days' WHERE id = $1`, [ids.ben]);
  const exempt = await call('ben', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(exempt.json.required, false, 'Plus subscribers never see the gate');
  assert.equal(exempt.json.exemptReason, 'plus');
  const ok = await call('ben', 'GET', `/conversations/${exec}/messages?limit=5`);
  assert.equal(ok.status, 200);
  await q(env, `UPDATE users SET premium = true, premium_until = now() - interval '1 day' WHERE id = $1`, [ids.ben]);
  const lapsed = await call('ben', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(lapsed.json.required, true, 'an expired Plus is not an exemption');
  await q(env, `UPDATE users SET premium = false, premium_until = NULL WHERE id = $1`, [ids.ben]);
  const wk = await applyMembershipGateAd(env, ids.ben, mem.id, { transactionId: 'tx-ben-week-1', verified: true });
  assert.equal(wk.adsWatched, 1);
  const wkPass = await applyMembershipGateAd(env, ids.ben, mem.id, { transactionId: 'tx-ben-week-2', verified: true });
  assert.equal(wkPass.adsWatched, 2);
  const wkDone = await applyMembershipGateAd(env, ids.ben, mem.id, { transactionId: 'tx-ben-week-3', verified: true });
  assert.equal(wkDone.passIssued, true);
  const passed = await call('ben', 'GET', `/memberships/${mem.id}/ad-gate`);
  assert.equal(passed.json.passUntil, periodFor('weekly', new Date()).end.toISOString());
});

test('the ad gate is off for a membership whose settings were never changed; disabled gate ignores ads', async () => {
  const off = await call('boss', 'PUT', `/memberships/${mem.id}/ad-gate`, { enabled: false });
  assert.equal(off.json.required, false);
  const ignored = await applyMembershipGateAd(env, ids.ann, mem.id, { transactionId: 'tx-off-1', verified: true });
  assert.equal(ignored.ignored, true);
});

test('dev claim route needs ADS_CLIENT_CLAIM and an enabled gate', async () => {
  const denied = await call('ann', 'POST', `/memberships/${mem.id}/ad-gate/claim`, {});
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'SSV_REQUIRED');
});

test('creation fee preview: free or paid, and the amount comes from admin settings', async () => {
  const free = await call('ann', 'GET', '/memberships/creation-fee?category=Prayer&type=free');
  assert.equal(free.status, 200, JSON.stringify(free.json));
  assert.equal(free.json.free, true);
  await setConfig(env, 'membership_creation_fee', { cycle: 'week', currency: 'NGN', free: 0, paid: 500000, categories: {} }, ids.boss);
  const paid = await call('ann', 'GET', '/memberships/creation-fee?category=Prayer&type=paid');
  assert.equal(paid.json.amountMinor, 500000);
  assert.equal(paid.json.cycle, 'week');
  assert.equal(paid.json.free, false);
  const cat = await setConfig(env, 'membership_creation_fee', { cycle: 'month', currency: 'NGN', free: 0, paid: 500000, categories: { Prayer: 100000 } }, ids.boss);
  assert.ok(cat);
  const override = await call('ann', 'GET', '/memberships/creation-fee?category=Prayer&type=paid');
  assert.equal(override.json.amountMinor, 100000, 'a category override wins');
  assert.equal(override.json.cycle, 'month');
  await setConfig(env, 'membership_creation_fee', { cycle: 'one_time', currency: 'NGN', free: 0, paid: 0, categories: {} }, ids.boss);
});

test('new memberships start from the configured default (registerConfig membership_ad_gate_default)', async () => {
  await setConfig(env, 'membership_ad_gate_default', { enabled: true, ads: 3, frequency: 'weekly' }, ids.boss);
  const r = await call('boss', 'POST', '/memberships/manage', { title: 'Default Gate', category: 'Bible Study' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.adGate, { enabled: true, ads: 3, frequency: 'weekly' });
  const row = await one(env, 'SELECT ad_gate_enabled, ad_gate_ads, ad_gate_frequency FROM memberships WHERE id = $1', [r.json.id]);
  assert.equal(row.ad_gate_ads, 3);
  const admin = await call('boss', 'GET', '/memberships/manage');
  assert.equal(admin.json.adGateDefault.frequency, 'weekly');
  await setConfig(env, 'membership_ad_gate_default', DEFAULT_AD_GATE, ids.boss);
});
