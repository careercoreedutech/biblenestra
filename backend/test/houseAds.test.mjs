// AD NETWORKS & HOUSE ADS: house-ad CRUD (admin only), impression/click counting, the public list, and the
// ad_extras / ad_networks config (defaults, validation, and what GET /ads/config returns).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { normalizeHouseAd, recordHouseEvent, isWebUrl } from '../src/lib/houseAds.js';
import {
  DEFAULT_AD_EXTRAS, DEFAULT_AD_NETWORKS, checkAdExtras, normalizeAdExtras, checkAdNetworks, normalizeAdNetworks,
} from '../src/lib/adExtras.js';
import { setConfig } from '../src/lib/wallet.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt' };
  await app.fetch(new Request('http://api.test/ads/events', { method: 'POST', headers: { 'X-Dev-User': 'house_boss', 'Content-Type': 'application/json' }, body: '{"events":[]}' }), env);
  await env.__db.query("UPDATE users SET role = 'admin' WHERE clerk_id = 'dev_house_boss'");
  await app.fetch(new Request('http://api.test/ads/events', { method: 'POST', headers: { 'X-Dev-User': 'house_reader', 'Content-Type': 'application/json' }, body: '{"events":[]}' }), env);
});

async function call(user, method, p, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
const validAd = (over = {}) => ({
  kind: 'text', title: 'Partner Bible study', body: 'Free weekly lessons.', cta: 'Visit', linkUrl: 'https://example.org/study', active: true, sort: 1, ...over,
});

// ---------- validation (pure) ----------
test('house ads: only http(s) links, image ads need an image, text is bounded', () => {
  assert.equal(isWebUrl('https://example.org/x'), true);
  assert.equal(isWebUrl('javascript:alert(1)'), false);
  assert.equal(isWebUrl('data:text/html,hi'), false);
  assert.equal(isWebUrl('intent://x'), false);
  assert.equal(isWebUrl(''), false);
  const ok = normalizeHouseAd(validAd());
  assert.equal(ok.kind, 'text');
  assert.equal(ok.cta, 'Visit');
  assert.equal(normalizeHouseAd({ ...validAd(), cta: '' }).cta, 'Learn more');
  const bad = (over, re) => assert.throws(() => normalizeHouseAd({ ...validAd(), ...over }), (e) => e.code === 'BAD_HOUSE_AD' && (!re || re.test(e.message)));
  bad({ linkUrl: 'javascript:alert(1)' }, /link/);
  bad({ kind: 'video' }, /kind/);
  bad({ title: '   ' }, /title/);
  bad({ title: 'x'.repeat(81) }, /title/);
  bad({ body: 'x'.repeat(241) }, /body/);
  bad({ cta: 'x'.repeat(25) }, /button/);
  bad({ kind: 'image', imageUrl: null }, /image/);
  bad({ imageUrl: 'data:image/png;base64,AAAA' }, /image/);
  bad({ active: 'yes' }, /active/);
  bad({ sort: 1000 }, /sort/);
});

// ---------- config (pure + through GET /ads/config) ----------
test('ad_extras and ad_networks: defaults, validation and fill-in', () => {
  assert.deepEqual(normalizeAdExtras({}), JSON.parse(JSON.stringify(DEFAULT_AD_EXTRAS)));
  assert.equal(DEFAULT_AD_EXTRAS.plansPage.frequency, 'launch');
  assert.equal(DEFAULT_AD_EXTRAS.extraBooks.minGapSeconds, 5);
  assert.equal(checkAdExtras({ plansPage: { frequency: 'hourly' } }), false);
  assert.equal(checkAdExtras({ extraBooks: { minGapSeconds: -1 } }), false);
  assert.equal(checkAdExtras({ plansPage: { enabled: false, frequency: 'daily' }, extraBooks: { minGapSeconds: 8 } }), true);
  assert.equal(normalizeAdExtras({ plansPage: { enabled: false } }).plansPage.frequency, 'launch');
  assert.equal(normalizeAdExtras({ extraBooks: { minGapSeconds: 'bad' } }).extraBooks.minGapSeconds, 5); // invalid → defaults
  assert.deepEqual(normalizeAdNetworks({}), JSON.parse(JSON.stringify(DEFAULT_AD_NETWORKS)));
  assert.equal(checkAdNetworks({ applovin: { sdkKey: 'abc<script>' } }), false);
  assert.equal(checkAdNetworks({ applovin: { interstitialUnitId: 'ABC123_def/1', sdkKey: 'key-1' } }), true);
});

test('GET /ads/config returns extras and networks, reflecting a saved admin value', async () => {
  const r = await call(null, 'GET', '/ads/config');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.extras, JSON.parse(JSON.stringify(DEFAULT_AD_EXTRAS)));
  assert.equal(r.json.networks.applovin.sdkKey, '');
  assert.equal(r.json.networks.applovin.enabled, true);

  await setConfig(env, 'ad_extras', { plansPage: { enabled: true, frequency: 'daily' }, extraBooks: { enabled: true, minGapSeconds: 7, onOpen: true, onChapter: false } }, null);
  await setConfig(env, 'ad_networks', { applovin: { enabled: true, sdkKey: 'sdk-test-1', interstitialUnitId: 'int-1', rewardedUnitId: 'rw-1', bannerUnitId: '' } }, null);
  const again = await call(null, 'GET', '/ads/config');
  assert.equal(again.json.extras.plansPage.frequency, 'daily');
  assert.equal(again.json.extras.extraBooks.minGapSeconds, 7);
  assert.equal(again.json.extras.extraBooks.onChapter, false);
  assert.equal(again.json.networks.applovin.interstitialUnitId, 'int-1');
  assert.equal(again.json.networks.applovin.rewardedUnitId, 'rw-1');
  // a bad value is refused by setConfig (the check runs before saving)
  await assert.rejects(() => setConfig(env, 'ad_extras', { plansPage: { frequency: 'hourly' } }, null));
});

// ---------- admin CRUD and access ----------
let adId;
test('house ads: admin creates, lists with counts, edits and deletes; non-admins are refused', async () => {
  const denied = await call('house_reader', 'POST', '/admin/api/ads/house', validAd());
  assert.ok(denied.status === 401 || denied.status === 403, `expected refusal, got ${denied.status}`);
  const anon = await call(null, 'GET', '/admin/api/ads/house');
  assert.ok(anon.status >= 400);

  const created = await call('house_boss', 'POST', '/admin/api/ads/house', validAd());
  assert.equal(created.status, 201);
  adId = created.json.id;
  assert.equal(created.json.impressions, 0);
  assert.equal(created.json.clicks, 0);

  const list = await call('house_boss', 'GET', '/admin/api/ads/house');
  assert.ok(list.json.ads.some((a) => a.id === adId));

  const edited = await call('house_boss', 'PUT', `/admin/api/ads/house/${adId}`, { title: 'Study partner', sort: 2 });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.title, 'Study partner');
  assert.equal(edited.json.linkUrl, 'https://example.org/study'); // merged from the stored row

  const badEdit = await call('house_boss', 'PUT', `/admin/api/ads/house/${adId}`, { linkUrl: 'javascript:1' });
  assert.equal(badEdit.status, 400);
  assert.equal(badEdit.json.code || badEdit.json.error?.code, 'BAD_HOUSE_AD');

  const missing = await call('house_boss', 'PUT', '/admin/api/ads/house/00000000-0000-4000-8000-000000000000', { title: 'x' });
  assert.equal(missing.status, 404);
});

test('public list shows only active house ads, without counts', async () => {
  const inactive = await call('house_boss', 'POST', '/admin/api/ads/house', validAd({ title: 'Paused one', active: false }));
  const pub = await call(null, 'GET', '/ads/house');
  assert.equal(pub.status, 200);
  assert.ok(pub.json.ads.some((a) => a.id === adId));
  assert.ok(!pub.json.ads.some((a) => a.id === inactive.json.id));
  assert.equal(pub.json.ads[0].impressions, undefined);
  assert.equal(pub.json.ads[0].clicks, undefined);
  assert.ok(pub.json.ads.every((a) => a.linkUrl.startsWith('https://')));
});

// ---------- counting ----------
test('impressions and clicks are counted on active house ads only', async () => {
  const ok1 = await call(null, 'POST', `/ads/house/${adId}/impression`);
  assert.deepEqual(ok1.json, { ok: true });
  await call(null, 'POST', `/ads/house/${adId}/impression`);
  await call(null, 'POST', `/ads/house/${adId}/click`);
  const counted = await call('house_boss', 'GET', '/admin/api/ads/house');
  const row = counted.json.ads.find((a) => a.id === adId);
  assert.equal(row.impressions, 2);
  assert.equal(row.clicks, 1);
  assert.equal(row.ctr, 50);

  // inactive ad: nothing counted
  const inactive = await call('house_boss', 'POST', '/admin/api/ads/house', validAd({ title: 'Off', active: false }));
  const r = await call(null, 'POST', `/ads/house/${inactive.json.id}/click`);
  assert.deepEqual(r.json, { ok: false });
  // unknown or malformed id: counts nothing and does not fail
  assert.deepEqual((await call(null, 'POST', '/ads/house/not-a-uuid/impression')).json, { ok: false });
  assert.deepEqual(await recordHouseEvent(env, '00000000-0000-4000-8000-000000000000', 'click'), { ok: false });
  await assert.rejects(() => recordHouseEvent(env, adId, 'purchase'), (e) => e.code === 'BAD_HOUSE_EVENT');
});

test('house ads: delete removes the ad from the public list', async () => {
  const del = await call('house_boss', 'DELETE', `/admin/api/ads/house/${adId}`);
  assert.equal(del.status, 200);
  const pub = await call(null, 'GET', '/ads/house');
  assert.ok(!pub.json.ads.some((a) => a.id === adId));
  const again = await call('house_boss', 'DELETE', `/admin/api/ads/house/${adId}`);
  assert.equal(again.status, 404);
});
