// ADS: remote ad rules (validation, defaults, admin-only editing, audit), ad events (aggregation,
// test/demo separation, revenue) and the per-user abuse limits.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { DEFAULT_AD_CONFIG, EVENT_LIMITS, normalizeAdConfig, cleanEvent } from '../src/lib/ads.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', ADMIN_PASSWORD: 'pw-admin', REALTIME_SECRET: 'rt' };
  // any signed-in call creates the dev user row; then make ads_boss an admin
  await app.fetch(new Request('http://api.test/ads/events', { method: 'POST', headers: { 'X-Dev-User': 'ads_boss', 'Content-Type': 'application/json' }, body: '{"events":[]}' }), env);
  await env.__db.query("UPDATE users SET role = 'admin' WHERE clerk_id = 'dev_ads_boss'");
});
async function call(user, method, p, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const sql = async (t, p) => { const r = await env.__db.query(t, p); return Array.isArray(r) ? r : r.rows; };
const throwsCode = (fn, re) => assert.throws(fn, (e) => e.code === 'BAD_AD_CONFIG' && (!re || re.test(e.message)));

test('normalizeAdConfig: empty input gives the client defaults', () => {
  const c = normalizeAdConfig({});
  assert.deepEqual(c, JSON.parse(JSON.stringify(DEFAULT_AD_CONFIG)));
  // client spec: ≤4 min 1 ad, 5–8 min 1 ad, >8 min 2 ads, ≥20 min 3 ads (pre-roll + ~5 + ~12 min)
  assert.deepEqual(c.video.bands.map((b) => [b.fromMin, b.ads]), [[0, 1], [4, 1], [8, 2], [20, 3]]);
  assert.deepEqual(c.video.bands[3].positions, [5, 12]);
  assert.equal(c.feed.every, 3);
  assert.equal(c.audio.betweenEvery, 3);
});

test('normalizeAdConfig: validates, sorts and drops unknown keys', () => {
  const c = normalizeAdConfig({
    enabled: false, junk: 1, surfaces: { video: false, nope: true },
    video: { bands: [{ fromMin: 10, ads: 2, unit: 'pct', positions: [60, 30] }, { fromMin: 0, ads: 0 }] },
    disabledCategories: ['Kids', ' kids ', 'Funeral'],
  });
  assert.equal(c.enabled, false);
  assert.equal(c.junk, undefined);
  assert.equal(c.surfaces.video, false);
  assert.equal(c.surfaces.audio, true);
  assert.equal(c.surfaces.nope, undefined);
  assert.deepEqual(c.video.bands, [{ fromMin: 0, ads: 0, unit: 'min', positions: [] }, { fromMin: 10, ads: 2, unit: 'pct', positions: [30, 60] }]);
  assert.deepEqual(c.disabledCategories, ['kids', 'funeral']);

  throwsCode(() => normalizeAdConfig(null));
  throwsCode(() => normalizeAdConfig({ enabled: 'yes' }), /enabled/);
  throwsCode(() => normalizeAdConfig({ video: { bands: [{ fromMin: 2, ads: 1 }] } }), /start at 0/);
  throwsCode(() => normalizeAdConfig({ video: { bands: [{ fromMin: 0, ads: 1 }, { fromMin: 0, ads: 2 }] } }), /Two video bands/);
  throwsCode(() => normalizeAdConfig({ video: { bands: [{ fromMin: 0, ads: 9 }] } }), /ads/);
  throwsCode(() => normalizeAdConfig({ video: { bands: [{ fromMin: 0, ads: 2, unit: 'pct', positions: [120] }] } }), /positions/);
  throwsCode(() => normalizeAdConfig({ video: { bands: [{ fromMin: 0, ads: 2, unit: 'sec' }] } }), /unit/);
  throwsCode(() => normalizeAdConfig({ video: { bands: [] } }), /bands/);
  throwsCode(() => normalizeAdConfig({ feed: { every: 1 } }), /feed.every/);
  throwsCode(() => normalizeAdConfig({ caps: { minSecondsBetween: 5 } }), /minSecondsBetween/);
  throwsCode(() => normalizeAdConfig({ caps: { maxPerHour: 10, maxPerDay: 5 } }), /maxPerDay/);
  throwsCode(() => normalizeAdConfig({ disabledCategories: [42] }), /disabledCategories/);
});

test('GET /ads/config is public, cached, and returns defaults before anything is saved', async () => {
  const r = await call(null, 'GET', '/ads/config');
  assert.equal(r.status, 200);
  assert.equal(r.json.version, 0);
  assert.equal(r.json.config.enabled, true);
  assert.match(r.headers.get('cache-control') || '', /max-age=60/);
});

test('admin config: admin only, validated, versioned, audited, visible to apps', async () => {
  assert.equal((await call(null, 'GET', '/admin/api/ads/config')).status, 401);
  assert.equal((await call('ads_alice', 'GET', '/admin/api/ads/config')).status, 403);
  assert.equal((await call('ads_alice', 'PUT', '/admin/api/ads/config', { config: {} })).status, 403);

  const g = await call('ads_boss', 'GET', '/admin/api/ads/config');
  assert.equal(g.status, 200);
  assert.equal(g.json.version, 0);
  assert.ok(g.json.defaults && g.json.defaults.video);

  const badPut = await call('ads_boss', 'PUT', '/admin/api/ads/config', { config: { video: { bands: [{ fromMin: 3, ads: 1 }] } } });
  assert.equal(badPut.status, 400);
  assert.equal(badPut.json.code, 'BAD_AD_CONFIG');

  const p = await call('ads_boss', 'PUT', '/admin/api/ads/config', { config: { feed: { every: 5 }, surfaces: { pdf: false }, disabledCategories: ['Kids'] }, note: 'feed every 5' });
  assert.equal(p.status, 200);
  assert.equal(p.json.version, 1);
  assert.equal(p.json.config.feed.every, 5);
  assert.equal(p.json.history[0].note, 'feed every 5');

  const pub = await call(null, 'GET', '/ads/config');
  assert.equal(pub.json.version, 1);
  assert.equal(pub.json.config.feed.every, 5);
  assert.equal(pub.json.config.surfaces.pdf, false);
  assert.deepEqual(pub.json.config.disabledCategories, ['kids']);

  const p2 = await call('ads_boss', 'PUT', '/admin/api/ads/config', { config: pub.json.config });
  assert.equal(p2.json.version, 2);
  const auditRows = await sql("SELECT * FROM admin_actions WHERE action = 'ads.config.update' ORDER BY created_at");
  assert.equal(auditRows.length, 2);
  assert.equal(auditRows[0].target_id, '1');
});

test('cleanEvent: only known types/formats; paid needs a sane value + currency', () => {
  assert.equal(cleanEvent({ type: 'bogus', format: 'banner' }), null);
  assert.equal(cleanEvent({ type: 'impression', format: 'popup' }), null);
  assert.equal(cleanEvent({ type: 'impression', format: 'banner', surface: 'mars' }).surface, 'other');
  assert.equal(cleanEvent({ type: 'impression', format: 'banner', placement: 'DROP TABLE' }).placement, 'other');
  assert.equal(cleanEvent({ type: 'paid', format: 'interstitial', value: 0.01, currency: 'usd' }).micros, 10000);
  assert.equal(cleanEvent({ type: 'paid', format: 'interstitial', value: 999, currency: 'USD' }), null);
  assert.equal(cleanEvent({ type: 'paid', format: 'interstitial', value: 0.01, currency: 'dollars' }), null);
});

test('POST /ads/events folds events into daily aggregates; stats separate test ads', async () => {
  assert.equal((await call(null, 'POST', '/ads/events', { events: [] })).status, 401);
  assert.equal((await call('ads_bob', 'POST', '/ads/events', { events: 'nope' })).status, 400);

  const ev = (type, extra = {}) => ({ type, surface: 'video', placement: 'pre', format: 'interstitial', ...extra });
  const r = await call('ads_bob', 'POST', '/ads/events', { events: [
    ev('requested'), ev('requested'), ev('impression'), ev('completed'), ev('failed'), ev('clicked'),
    ev('paid', { value: 0.0125, currency: 'USD', precision: 'estimated' }),
    { type: 'impression', surface: 'feed', placement: 'inline', format: 'native' },
    { type: 'requested', surface: 'feed', placement: 'inline', format: 'native' },
    { type: 'impression', surface: 'reader', placement: 'banner', format: 'banner', test: true },
    { type: 'nonsense', format: 'banner' },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.json.accepted, 10);
  assert.equal(r.json.dropped, 1);

  const rows = await sql("SELECT * FROM ad_daily WHERE surface = 'video'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requested, 2);
  assert.equal(rows[0].impressions, 1);
  assert.equal(rows[0].paid, 1);

  assert.equal((await call('ads_bob', 'GET', '/admin/api/ads/stats')).status, 403);
  const s = await call('ads_boss', 'GET', '/admin/api/ads/stats?days=7');
  assert.equal(s.status, 200);
  assert.equal(s.json.totals.impressions, 2); // the test banner is excluded
  assert.equal(s.json.totals.requested, 3);
  assert.equal(s.json.totals.fillRate, 66.7);
  assert.deepEqual(s.json.totals.revenue, { USD: 0.01 });
  const video = s.json.bySurface.find((x) => x.surface === 'video');
  assert.equal(video.fillRate, 50);
  assert.equal(video.completionRate, 100);
  assert.equal(s.json.byDay.length, 1);
  assert.equal(s.json.bySurface.find((x) => x.surface === 'reader'), undefined);

  const st = await call('ads_boss', 'GET', '/admin/api/ads/stats?days=7&test=1');
  assert.equal(st.json.totals.impressions, 3);
  assert.ok(st.json.bySurface.find((x) => x.surface === 'reader'));
});

test('abuse limits: batch size and per-user daily caps', async () => {
  const one = { type: 'requested', surface: 'audio', placement: 'between', format: 'interstitial' };
  // too big a request is refused outright; a big batch is cut to EVENT_LIMITS.batch
  assert.equal((await call('ads_eve', 'POST', '/ads/events', { events: Array(EVENT_LIMITS.batch * 4 + 1).fill(one) })).status, 400);
  const big = await call('ads_eve', 'POST', '/ads/events', { events: Array(EVENT_LIMITS.batch + 10).fill(one) });
  assert.equal(big.json.accepted, EVENT_LIMITS.batch);
  assert.equal(big.json.dropped, 10);

  // close to the impression cap: only the remaining impressions count, other events still pass
  const [u] = await sql("SELECT id FROM users WHERE clerk_id = 'dev_ads_eve'");
  assert.ok(u, 'dev user row exists');
  await sql('UPDATE ad_user_daily SET impressions = $2 WHERE user_id = $1', [u.id, EVENT_LIMITS.impressionsPerDay - 2]);
  const imp = { ...one, type: 'impression' };
  const r = await call('ads_eve', 'POST', '/ads/events', { events: [imp, imp, imp, imp, one] });
  assert.equal(r.json.accepted, 3);
  assert.equal(r.json.dropped, 2);

  // at the daily event cap nothing more is accepted
  await sql('UPDATE ad_user_daily SET events = $2 WHERE user_id = $1', [u.id, EVENT_LIMITS.eventsPerDay]);
  const r2 = await call('ads_eve', 'POST', '/ads/events', { events: [one, one] });
  assert.equal(r2.json.accepted, 0);
  assert.equal(r2.json.dropped, 2);
  // other users are unaffected
  assert.equal((await call('ads_frank', 'POST', '/ads/events', { events: [one] })).json.accepted, 1);
});
