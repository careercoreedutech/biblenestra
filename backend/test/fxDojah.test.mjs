// LIVE FX + DOJAH IDENTITY: live exchange rates (open.er-api.com: success, the 25% guard, failures keep the old rates,
// the 6-hour throttle, auto off, end-of-life notice, admin Refresh now, manual edits, donor attribution) and Dojah
// identity checks (the adapter's headers / base URL / error mapping, payout KYC match / mismatch / not configured, the
// Find Love Verified badge selfie match → "Dojah matched", never auto-approved). Every network call is stubbed.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import * as W from '../src/lib/wallet.js';
import * as FX from '../src/lib/fxLive.js';
import * as DJ from '../src/lib/dojah.js';
import { FX_SEED } from '../src/lib/fundmeMoney.js';
import { FUNDME_MONEY_ADMIN_SCRIPT } from '../src/lib/fundmeMoneyAdmin.js';
import { DATING_ADMIN_SCRIPT } from '../src/lib/datingAdminPage.js';
import * as D from '../src/lib/dating.js';
import * as KYC from '../src/lib/kyc.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
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
const idOf = async (u) => (ids[u] = ids[u] || (await call(u, 'GET', '/me')).json.id);
async function makeAdmin(u) { await idOf(u); await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids[u]]); }

/** Replace fetch for the duration of fn; handler(url, opts) → Response. Every call is recorded. */
async function withFetch(handler, fn) {
  const real = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return handler(String(url), opts); };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
const jres = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const H = 3600 * 1000;

// ───────────────────────────────────────── live exchange rates ─────────────────────────────────────────
// rates as the API gives them: units of each currency per 1 NGN
const apiReply = (ngnPer, extra = {}) => ({
  result: 'success', time_last_update_unix: 1763683351, time_next_update_unix: 1763769751, time_eol_unix: 0, base_code: 'NGN',
  rates: Object.fromEntries(Object.entries(ngnPer).map(([k, v]) => [k, typeof v === 'number' && v > 0 ? 1 / v : v])), ...extra,
});
const LIVE = { USD: 1450, GBP: 1910, EUR: 1680, CAD: 1030, GHS: 120, KES: 11.2, ZAR: 80 }; // all within 25% of the seed
const fxTable = async () => (await W.getConfig(env)).fundme_fx_ngn_per_unit;
async function resetFx(table = FX_SEED) { await q(env, 'DELETE FROM fx_rate_status'); await W.setConfig(env, 'fundme_fx_ngn_per_unit', table); await W.setConfig(env, 'fundme_fx_auto', true); }

test('FX pure: 1 / rate, 6 significant digits, the 25% guard, missing / zero / NaN never applied', () => {
  const r = FX.applyRates({ USD: 1500, GBP: 1950, EUR: 1700, KES: 11.6, ZAR: 85 }, { USD: 1 / 1515.151515, GBP: 1 / 2600, EUR: 0, KES: 'x', ZAR: Number.NaN });
  assert.equal(r.table.USD, 1515.15);
  assert.deepEqual(r.applied, { USD: 1515.15 });
  assert.equal(r.table.GBP, 1950, 'moved 33% → old rate kept');
  assert.deepEqual(r.flagged.find((f) => f.currency === 'GBP'), { currency: 'GBP', stored: 1950, fetched: 2600, changePct: 33.3, reason: 'moved_over_25pct' });
  for (const c of ['EUR', 'KES', 'ZAR']) { assert.equal(r.table[c], { EUR: 1700, KES: 11.6, ZAR: 85 }[c]); assert.equal(r.flagged.find((f) => f.currency === c).reason, 'missing'); }
  const down = FX.applyRates({ USD: 1500 }, { USD: 1 / 1124 }); // -25.07%
  assert.equal(down.flagged[0].reason, 'moved_over_25pct');
  assert.deepEqual(FX.applyRates({ USD: 1500 }, { USD: 1 / 1125 }).applied, { USD: 1125 }, 'exactly 25% is allowed');
});

test('FX refresh: success updates only the table currencies (incl. admin-added), records source + times; attribution for donors', async () => {
  await makeAdmin('fxboss');
  await resetFx({ ...FX_SEED, NZD: 900 }); // an admin added NZD
  assert.equal((await call('fxmember', 'GET', '/fundme/rules')).json.fxAttribution, null, 'no attribution before live rates');
  const now = new Date('2026-11-21T10:00:00Z');
  const r = await withFetch(() => jres(apiReply({ ...LIVE, NZD: 870, JPY: 9.5 })), async (calls) => {
    const out = await FX.runFxCron(env, { now });
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://open.er-api.com/v6/latest/NGN');
    return out;
  });
  assert.equal(r.ok, true); assert.deepEqual(r.flagged, []);
  const t = await fxTable();
  assert.deepEqual(t, { ...LIVE, NZD: 870 }, 'JPY is not in the table, so it is not added');
  const st = await FX.fxStatus(env);
  assert.equal(st.source, 'exchangerate-api'); assert.equal(st.ratesUpdatedAt, now.toISOString()); assert.equal(st.lastSuccessAt, now.toISOString());
  assert.equal(st.providerUpdatedAt, new Date(1763683351000).toISOString()); assert.equal(st.eolAt, null); assert.equal(st.lastError, null);
  const pub = (await call('fxmember', 'GET', '/fundme/rules')).json;
  assert.deepEqual([pub.fxAttribution.label, pub.fxAttribution.url], ['Rates by Exchange Rate API', 'https://www.exchangerate-api.com']);
  assert.equal(pub.fxNgnPerUnit.USD, 1450);
});

test('FX 6-hour throttle: cron runs inside the window never call the API; after 6 hours it does; Refresh now bypasses it', async () => {
  await resetFx();
  const t0 = new Date('2026-11-21T00:00:00Z');
  await withFetch(() => jres(apiReply(LIVE)), async (calls) => {
    await FX.runFxCron(env, { now: t0 });
    for (const m of [15, 60, 5 * 60, 5 * 60 + 59]) assert.equal((await FX.runFxCron(env, { now: new Date(t0.getTime() + m * 60000) })).skipped, 'throttled', `${m} min`);
    assert.equal(calls.length, 1, 'one API call in 6 hours of 15-minute cron runs');
    assert.equal((await FX.runFxCron(env, { now: new Date(t0.getTime() + 6 * H) })).ok, true);
    assert.equal(calls.length, 2);
    await FX.refreshFxRates(env, { force: true, now: new Date(t0.getTime() + 6 * H + 60000) });
    assert.equal(calls.length, 3, 'force (Refresh now) skips the throttle');
  });
  // auto off → the cron never calls
  await W.setConfig(env, 'fundme_fx_auto', false);
  await withFetch(() => jres(apiReply(LIVE)), async (calls) => {
    assert.equal((await FX.runFxCron(env, { now: new Date(t0.getTime() + 48 * H) })).skipped, 'auto_off');
    assert.equal(calls.length, 0);
  });
  await W.setConfig(env, 'fundme_fx_auto', true);
});

test('FX 25% guard: a big move is not applied and is flagged; zero / negative / NaN never written', async () => {
  await resetFx();
  const r = await withFetch(() => jres(apiReply({ ...LIVE, USD: 2100, GBP: 0, EUR: -5, CAD: 'NaN' })), () => FX.refreshFxRates(env, { force: true }));
  assert.equal(r.ok, true);
  const t = await fxTable();
  assert.deepEqual([t.USD, t.GBP, t.EUR, t.CAD], [FX_SEED.USD, FX_SEED.GBP, FX_SEED.EUR, FX_SEED.CAD], 'old rates kept');
  assert.deepEqual([t.GHS, t.KES, t.ZAR], [LIVE.GHS, LIVE.KES, LIVE.ZAR], 'the others are applied');
  assert.ok(Object.values(t).every((v) => Number.isFinite(v) && v > 0));
  const st = await FX.fxStatus(env);
  assert.deepEqual(st.flagged.map((f) => [f.currency, f.reason]).sort(), [['CAD', 'missing'], ['EUR', 'missing'], ['GBP', 'missing'], ['USD', 'moved_over_25pct']]);
  assert.equal(st.flagged.find((f) => f.currency === 'USD').fetched, 2100);
  // shown in the admin Rules screen
  const adm = (await call('fxboss', 'GET', '/admin/api/fundme/rules')).json;
  assert.equal(adm.fx.auto, true); assert.equal(adm.fx.maxMovePct, 25); assert.equal(adm.fx.flagged.length, 4);
  assert.match(adm.rules.find((x) => x.key === 'fundme_fx_ngn_per_unit').label, /OVERWRITTEN on the next refresh/);
  assert.ok(adm.rules.some((x) => x.key === 'fundme_fx_auto' && x.value === true));
});

test('FX failures keep the old rates: HTTP error, result "error", network error, bad JSON; end-of-life is recorded', async () => {
  await resetFx({ ...FX_SEED, USD: 1490 });
  const before = await fxTable();
  const cases = [() => jres({ result: 'error', 'error-type': 'unsupported-code' }), () => new Response('down', { status: 503 }), () => { throw new TypeError('fetch failed'); }, () => new Response('<html>', { status: 200 }), () => jres({ result: 'success' })];
  for (const h of cases) {
    const r = await withFetch(h, () => FX.refreshFxRates(env, { force: true }));
    assert.equal(r.ok, false); assert.match(r.error, /old rates are kept/);
    assert.deepEqual(await fxTable(), before);
    assert.match((await FX.fxStatus(env)).lastError, /Fetch failed/);
  }
  // end of life: warned and shown in the admin
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try { await withFetch(() => jres(apiReply(LIVE, { time_eol_unix: 1798761600 })), () => FX.refreshFxRates(env, { force: true })); } finally { console.warn = warn; }
  assert.ok(warned.some((w) => /end of life/.test(w)));
  assert.equal((await FX.fxStatus(env)).eolAt, new Date(1798761600000).toISOString());
  assert.equal((await FX.fxStatus(env)).lastError, null);
});

test('FX admin: Refresh now (fundme manage), manual edit → source manual and no attribution; admin script is a plain string', async () => {
  await resetFx();
  assert.ok(!FUNDME_MONEY_ADMIN_SCRIPT.includes('`') && !FUNDME_MONEY_ADMIN_SCRIPT.includes('${'));
  assert.match(FUNDME_MONEY_ADMIN_SCRIPT, /Refresh now/); assert.match(FUNDME_MONEY_ADMIN_SCRIPT, /Rates by Exchange Rate API/);
  assert.equal((await call('fxnobody', 'POST', '/admin/api/fundme/fx/refresh')).status, 403);
  const r = await withFetch(() => jres(apiReply(LIVE)), () => call('fxboss', 'POST', '/admin/api/fundme/fx/refresh'));
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.ok, true); assert.equal(r.json.rates.USD, LIVE.USD); assert.equal(r.json.fx.source, 'exchangerate-api');
  assert.ok(await one(env, `SELECT 1 FROM admin_actions WHERE action = 'fundme.fx.refresh'`));
  const put = await call('fxboss', 'PUT', '/admin/api/fundme/rules', { key: 'fundme_fx_ngn_per_unit', value: { ...LIVE, USD: 1600 } });
  assert.equal(put.status, 200);
  assert.equal((await FX.fxStatus(env)).source, 'manual');
  assert.equal((await call('fxmember', 'GET', '/fundme/rules')).json.fxAttribution, null);
  for (const bad of [{ ...LIVE, USD: 0 }, { ...LIVE, USD: -1 }, { GBP: 1 }]) assert.equal((await call('fxboss', 'PUT', '/admin/api/fundme/rules', { key: 'fundme_fx_ngn_per_unit', value: bad })).status, 400);
});

// ───────────────────────────────────────── Dojah adapter ─────────────────────────────────────────
const DJ_TEST = { DOJAH_APP_ID: 'app_123', DOJAH_SECRET_KEY: 'test_sk_abc', DOJAH_ENABLED: 'true' };
const DJ_LIVE = { DOJAH_APP_ID: 'app_123', DOJAH_SECRET_KEY: 'prod_sk_xyz', DOJAH_ENABLED: 'true' };

test('Dojah adapter: configured, sandbox vs production URL, headers without Bearer, nothing but names returned', async () => {
  assert.equal(DJ.dojahConfigured({}), false); assert.equal(DJ.dojahConfigured({ DOJAH_APP_ID: 'a' }), false); assert.equal(DJ.dojahConfigured(DJ_TEST), true);
  assert.equal(DJ.dojahConfigured({ ...DJ_TEST, DOJAH_ENABLED: '' }), false, 'upcoming feature: keys alone do not switch it on');
  assert.equal(DJ.dojahBaseUrl(DJ_TEST), 'https://sandbox.dojah.io');
  assert.equal(DJ.dojahBaseUrl(DJ_LIVE), 'https://api.dojah.io');
  assert.equal(DJ.dojahBaseUrl({ ...DJ_LIVE, DOJAH_ENV: 'sandbox' }), 'https://sandbox.dojah.io');
  assert.equal(DJ.dojahBaseUrl({ ...DJ_TEST, DOJAH_BASE_URL: 'https://api.dojah.io/' }), 'https://api.dojah.io', 'an explicit DOJAH_BASE_URL wins');
  await withFetch(() => jres({ entity: { bvn: '222****2222', first_name: 'Ada', middle_name: 'N', last_name: 'Obi', date_of_birth: '1990-01-01', phone_number1: '0800', image: 'BASE64PHOTO' } }), async (calls) => {
    const r = await DJ.lookupId(DJ_LIVE, 'bvn', '22222222222');
    assert.deepEqual(r, { firstName: 'Ada', middleName: 'N', lastName: 'Obi' }, 'only names come back (no photo, phone, date of birth)');
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://api.dojah.io/api/v1/kyc/bvn/full'); assert.equal(u.searchParams.get('bvn'), '22222222222');
    assert.equal(calls[0].opts.headers.Authorization, 'prod_sk_xyz', 'the secret key as-is');
    assert.ok(!/bearer/i.test(calls[0].opts.headers.Authorization));
    assert.equal(calls[0].opts.headers.AppId, 'app_123');
  });
  await withFetch(() => jres({ entity: { nin: '701****6789', firstname: 'Ada', surname: 'Obi', selfie_verification: { confidence_value: 97.5, match: true }, image: 'X' } }), async (calls) => {
    const r = await DJ.verifySelfie(DJ_TEST, { idType: 'nin', idNumber: '70123456789', selfie: new TextEncoder().encode('SELFIE'), threshold: 30 });
    assert.deepEqual(r, { match: true, confidence: 97.5 });
    assert.equal(calls[0].url, 'https://sandbox.dojah.io/api/v1/kyc/nin/verify'); assert.equal(calls[0].opts.method, 'POST');
    const b = JSON.parse(calls[0].opts.body);
    assert.deepEqual(b, { nin: '70123456789', selfie_image: Buffer.from('SELFIE').toString('base64'), threshold: 50 }, 'base64 without data: prefix; threshold clamped to 50–100');
  });
  assert.equal(DJ.toBase64(new Uint8Array([0, 255, 1, 2])), Buffer.from([0, 255, 1, 2]).toString('base64'));
});

test('Dojah adapter: errors map to friendly ApiErrors and the logs never carry the ID number', async () => {
  const warn = console.warn; const logs = [];
  console.warn = (...a) => logs.push(a.map(String).join(' '));
  try {
    for (const [status, code, http] of [[400, 'ID_CHECK_BAD_INPUT', 400], [401, 'ID_CHECK_UNAVAILABLE', 503], [402, 'ID_CHECK_UNAVAILABLE', 503], [404, 'ID_NOT_FOUND', 404], [429, 'ID_CHECK_BUSY', 503], [500, 'ID_CHECK_UNAVAILABLE', 503]]) {
      await withFetch(() => jres({ error: 'raw provider message 22222222222' }, status), () => assert.rejects(DJ.lookupId(DJ_TEST, 'bvn', '22222222222'), (e) => e.code === code && e.status === http && !/raw provider/.test(e.message)));
    }
    await withFetch(() => { throw new TypeError('network'); }, () => assert.rejects(DJ.lookupId(DJ_TEST, 'nin', '70123456789'), (e) => e.code === 'ID_CHECK_UNAVAILABLE'));
    await withFetch(() => jres({ nothing: true }), () => assert.rejects(DJ.verifySelfie(DJ_TEST, { idType: 'bvn', idNumber: '22222222222', selfie: new Uint8Array([1]) }), (e) => e.code === 'ID_CHECK_UNAVAILABLE'));
    await assert.rejects(DJ.lookupId({}, 'bvn', '22222222222'), (e) => e.code === 'ID_CHECK_NOT_CONFIGURED');
  } finally { console.warn = warn; }
  assert.ok(logs.length >= 6);
  assert.ok(logs.every((l) => !l.includes('22222222222') && !l.includes('70123456789') && !l.includes('test_sk_abc')), 'no ID number or key in the logs');
});

// ───────────────────────────────────────── payout KYC with Dojah ─────────────────────────────────────────
const kycBody = (b = {}) => ({ idType: 'bvn', idNumber: '22222222222', legalName: 'Quinn Baker', bankCode: '058', accountNumber: '0099887766', accountName: 'BAKER QUINN', ...b });
const record = (first, middle, last) => () => jres({ entity: { bvn: '222****2222', first_name: first, middle_name: middle, last_name: last, image: 'PHOTO_BASE64', phone_number1: '08000000000' } });

test('KYC + Dojah: not configured → not checked (manual review, no call)', async () => {
  await withFetch(() => { throw new Error('no network expected'); }, async (calls) => {
    const r = await call('kyc_nc', 'PUT', '/payout-kyc', kycBody());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(calls.length, 0);
  });
  const k = await one(env, 'SELECT * FROM payout_kyc WHERE user_id = $1', [await idOf('kyc_nc')]);
  assert.deepEqual([k.id_verified, k.id_check_status, k.id_check_provider, k.status], [false, 'not_checked', null, 'pending_review']);
  assert.match(k.id_check_note, /upcoming feature/);
  // national_id is never sent to Dojah, even when configured
  const e = { ...env, ...DJ_TEST };
  await withFetch(() => { throw new Error('no network expected'); }, async (calls) => {
    const r = await call('kyc_nid', 'PUT', '/payout-kyc', kycBody({ idType: 'national_id', idNumber: 'A1234567' }), e);
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(calls.length, 0);
  });
  assert.equal((await one(env, 'SELECT id_check_status FROM payout_kyc WHERE user_id = $1', [await idOf('kyc_nid')])).id_check_status, 'not_checked');
});

test('KYC + Dojah: the ID name matches the legal name AND the bank name → id_verified (masked note, no record kept), staff still approve', async () => {
  const e = { ...env, ...DJ_TEST };
  await makeAdmin('kycboss');
  const r = await withFetch(record('QUINN', 'ADA', 'BAKER'), async (calls) => {
    const out = await call('kyc_ok', 'PUT', '/payout-kyc', kycBody(), e);
    assert.equal(calls.length, 1); assert.ok(calls[0].url.startsWith('https://sandbox.dojah.io/api/v1/kyc/bvn/full?'));
    return out;
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.kyc.status, r.json.kyc.idVerified], ['pending_review', true]);
  const k = await one(env, 'SELECT * FROM payout_kyc WHERE user_id = $1', [await idOf('kyc_ok')]);
  assert.deepEqual([k.id_verified, k.id_check_status, k.id_check_provider], [true, 'matched', 'dojah']);
  assert.equal(k.id_check_note, 'BVN record (Q. A. B.) matches the legal name and the bank account name.');
  assert.ok(!JSON.stringify(k).includes('PHOTO_BASE64') && !JSON.stringify(k).includes('08000000000') && !JSON.stringify(k).includes('22222222222'));
  const list = (await call('kycboss', 'GET', '/admin/api/fundme/kyc')).json.items.find((x) => x.userId === ids.kyc_ok);
  assert.deepEqual([list.idCheck.status, list.idCheck.verified, list.idCheck.provider], ['matched', true, 'dojah']);
  assert.equal((await call('kycboss', 'POST', `/admin/api/fundme/kyc/${ids.kyc_ok}/approve`)).json.kyc.status, 'approved');
});

test('KYC + Dojah: name mismatch is refused (nothing stored); unknown ID refused; a Dojah outage falls back to manual review', async () => {
  const e = { ...env, ...DJ_TEST };
  // the ID record is someone else
  const mm = await withFetch(record('JOHN', '', 'DOE'), () => call('kyc_mm', 'PUT', '/payout-kyc', kycBody(), e));
  assert.deepEqual([mm.status, mm.json.code], [400, 'ID_NAME_MISMATCH']);
  assert.ok(!/JOHN|DOE/.test(mm.json.error), 'the record name is never shown');
  assert.equal(await one(env, 'SELECT 1 FROM payout_kyc WHERE user_id = $1', [await idOf('kyc_mm')]), null);
  // the record matches the legal name but not the bank account name (legal ~ bank still holds) → still refused
  assert.ok(KYC.namesMatch('Quinn Ada Baker', 'QUINN CHI BAKER') && KYC.namesMatch('QUINN ADA BAKER EZE', 'Quinn Ada Baker') && !KYC.namesMatch('QUINN ADA BAKER EZE', 'QUINN CHI BAKER'));
  const half = await withFetch(record('QUINN', 'ADA', 'BAKER EZE'), () => call('kyc_mm', 'PUT', '/payout-kyc', kycBody({ legalName: 'Quinn Ada Baker', accountName: 'QUINN CHI BAKER' }), e));
  assert.deepEqual([half.status, half.json.code], [400, 'ID_NAME_MISMATCH']);
  // unknown number
  const nf = await withFetch(() => jres({ error: 'not found' }, 404), () => call('kyc_mm', 'PUT', '/payout-kyc', kycBody(), e));
  assert.deepEqual([nf.status, nf.json.code], [400, 'ID_NOT_FOUND']);
  // Dojah out of funds → not checked, staff review by hand
  const fb = await withFetch(() => jres({ error: 'insufficient balance' }, 402), () => call('kyc_mm', 'PUT', '/payout-kyc', kycBody({ idType: 'nin', idNumber: '70123456789' }), e));
  assert.equal(fb.status, 200, JSON.stringify(fb.json));
  const k = await one(env, 'SELECT * FROM payout_kyc WHERE user_id = $1', [ids.kyc_mm]);
  assert.deepEqual([k.id_verified, k.id_check_status, k.id_check_provider, k.status], [false, 'not_checked', 'dojah', 'pending_review']);
  assert.match(k.id_check_note, /failed \(ID_CHECK_UNAVAILABLE\)/);
});

// ───────────────────────────────────────── Find Love Verified badge with Dojah ─────────────────────────────────────────
const yearsAgo = (y) => { const t = new Date(); t.setUTCFullYear(t.getUTCFullYear() - y); return t.toISOString().slice(0, 10); };
async function mkProfile(u) {
  await idOf(u);
  const r = await call(u, 'PUT', '/dating/profile', { firstName: u, birthDate: yearsAgo(30), confirmAdult: true, gender: 'woman', interestedIn: 'men', city: 'Lagos', country: 'Nigeria', denomination: 'Pentecostal', churchInvolvement: 'Attends weekly', intention: 'marriage', bio: 'Hello there', prefs: { ageMin: 18, ageMax: 60 } });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
}
async function rawPost(u, path, bytes, type, e = env) {
  const res = await app.fetch(new Request(`http://api.test${path}`, { method: 'POST', headers: { 'X-Dev-User': u, 'Content-Type': type }, body: bytes }), e);
  return { status: res.status, json: JSON.parse(await res.text()) };
}
async function draft(u, e) {
  await mkProfile(u);
  const st = await call(u, 'POST', '/dating/verification/start', undefined, e);
  assert.equal(st.status, 200, JSON.stringify(st.json));
  assert.equal((await rawPost(u, '/dating/verification/upload?kind=selfie', Buffer.from('SELFIE'), 'image/jpeg', e)).status, 201);
  assert.equal((await rawPost(u, '/dating/verification/upload?kind=id', Buffer.from('IDCARD'), 'image/jpeg', e)).status, 201);
  return st.json.verification;
}
const selfieReply = (match, conf) => () => jres({ entity: { nin: '701****6789', firstname: 'X', surname: 'Y', image: 'PHOTO_B64', selfie_verification: { confidence_value: conf, match } } });

test('Dating + Dojah: a selfie match is flagged "Dojah matched" for the admin, never auto-approved; only last 4 kept', async () => {
  await makeAdmin('dboss');
  assert.ok(!DATING_ADMIN_SCRIPT.includes('`') && !DATING_ADMIN_SCRIPT.includes('${'));
  const e = { ...env, ...DJ_TEST };
  const v = await draft('dana', e);
  assert.equal(v.idCheckAvailable, true);
  assert.equal((await call('dana', 'GET', '/dating/verification')).json.verification.idCheckAvailable, false, 'hidden without Dojah keys');
  assert.equal((await call('dana', 'POST', '/dating/verification/submit', { idType: 'nin', dojahIdType: 'nin', dojahIdNumber: '123' }, e)).json.code, 'BAD_ID_NUMBER');
  assert.equal((await call('dana', 'POST', '/dating/verification/submit', { idType: 'nin', dojahIdType: 'passport', dojahIdNumber: '70123456789' }, e)).json.code, 'BAD_ID_CHECK_TYPE');
  await W.setConfig(env, 'dating_dojah_threshold', 85);
  const sub = await withFetch(selfieReply(true, 96.4), async (calls) => {
    const r = await call('dana', 'POST', '/dating/verification/submit', { idType: 'nin', dojahIdType: 'nin', dojahIdNumber: '7012 3456 789' }, e);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://sandbox.dojah.io/api/v1/kyc/nin/verify');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { nin: '70123456789', selfie_image: Buffer.from('SELFIE').toString('base64'), threshold: 85 });
    return r;
  });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.equal(sub.json.verification.status, 'pending', 'still waits for an admin');
  assert.deepEqual(sub.json.verification.idCheck, { idType: 'nin', last4: '6789' });
  const row = await one(env, 'SELECT * FROM dating_verifications WHERE user_id = $1', [ids.dana]);
  assert.deepEqual([row.dojah_status, row.dojah_match, Number(row.dojah_confidence), row.dojah_quick, row.dojah_id_last4], ['matched', true, 96.4, true, '6789']);
  assert.ok(!JSON.stringify(row).includes('70123456789') && !JSON.stringify(row).includes('PHOTO_B64'), 'no ID number or returned photo stored');
  assert.equal((await one(env, 'SELECT verified FROM dating_profiles WHERE user_id = $1', [ids.dana])).verified, false, 'never auto-approved');
  const item = (await call('dboss', 'GET', '/admin/api/dating/verifications')).json.items.find((x) => x.id === row.id);
  assert.deepEqual([item.dojah.quick, item.dojah.match, item.dojah.confidence, item.dojah.last4], [true, true, 96.4, '6789']);
  assert.match(item.dojah.note, /matches the NIN photo \(confidence 96.4, threshold 85\)/);
  assert.ok(item.ai, 'shown next to the advisory AI note');
  // an admin decides
  assert.equal((await call('dboss', 'POST', `/admin/api/dating/verifications/${row.id}`, { decision: 'approve' })).json.status, 'approved');
  assert.equal((await one(env, 'SELECT verified FROM dating_profiles WHERE user_id = $1', [ids.dana])).verified, true);
  // settings: threshold shown and editable (50–100)
  const cfg = (await call('dboss', 'GET', '/admin/api/dating/config')).json;
  assert.deepEqual(cfg.dojah, { configured: false, threshold: 85 });
  assert.equal((await call('dboss', 'PUT', '/admin/api/dating/config', { key: 'dating_dojah_threshold', value: 40 })).status, 400);
  assert.equal((await call('dboss', 'PUT', '/admin/api/dating/config', { key: 'dating_dojah_threshold', value: 90 })).json.dojah.threshold, 90);
  assert.equal(W.CONFIG_DEFAULTS.dating_dojah_threshold, 90);
});

test('Dating + Dojah: no match, a negative AI check, an outage or no keys → never "Dojah matched"', async () => {
  const e = { ...env, ...DJ_TEST };
  // no match
  await draft('nora', e);
  await withFetch(selfieReply(false, 41), () => call('nora', 'POST', '/dating/verification/submit', { idType: 'nin', dojahIdType: 'bvn', dojahIdNumber: '22222222222' }, e));
  let r = await one(env, 'SELECT * FROM dating_verifications WHERE user_id = $1', [await idOf('nora')]);
  assert.deepEqual([r.status, r.dojah_status, r.dojah_match, r.dojah_quick, r.dojah_id_type], ['pending', 'no_match', false, false, 'bvn']);
  // match, but the AI check is negative (no single face, not an ID) → not marked for quick approval
  const aiLow = { ...e, AI: { run: async () => ({ response: JSON.stringify({ face_visible: false, people: 0, gender: 'unknown', age_range: 'unknown', is_id_document: false, has_face_photo: false, text_seen: '' }) }) } };
  await draft('ola', aiLow);
  await withFetch(selfieReply(true, 99), () => call('ola', 'POST', '/dating/verification/submit', { idType: 'passport', dojahIdType: 'nin', dojahIdNumber: '70123456789' }, aiLow));
  r = await one(env, 'SELECT * FROM dating_verifications WHERE user_id = $1', [await idOf('ola')]);
  assert.deepEqual([r.ai_confidence, r.dojah_status, r.dojah_match, r.dojah_quick], ['low', 'matched', true, false]);
  assert.match(r.dojah_note, /AI pre-check was negative/);
  // Dojah down → submitted anyway, error recorded
  await draft('pia', e);
  const s = await withFetch(() => jres({}, 429), () => call('pia', 'POST', '/dating/verification/submit', { idType: 'nin', dojahIdType: 'nin', dojahIdNumber: '70123456789' }, e));
  assert.equal(s.json.verification.status, 'pending');
  r = await one(env, 'SELECT * FROM dating_verifications WHERE user_id = $1', [await idOf('pia')]);
  assert.deepEqual([r.dojah_status, r.dojah_quick, r.dojah_match], ['error', false, null]);
  // no keys → the number is ignored, no call
  await draft('quin', env);
  await withFetch(() => { throw new Error('no network expected'); }, async (calls) => {
    const x = await call('quin', 'POST', '/dating/verification/submit', { idType: 'nin', dojahIdType: 'nin', dojahIdNumber: '70123456789' });
    assert.equal(x.status, 200); assert.equal(calls.length, 0);
  });
  r = await one(env, 'SELECT * FROM dating_verifications WHERE user_id = $1', [await idOf('quin')]);
  assert.deepEqual([r.dojah_status, r.dojah_id_last4, r.dojah_quick], [null, null, false]);
  assert.ok(D.DOJAH_THRESHOLD_DEFAULT === 90);
});
