// FUND ME (round 3) — fundraisers, public page, donations through the TEST provider, admin review.
// FUND ME MONEY (monetisation stage 2) — publish credits, limits, moderation flags, gifting credits, Paystack donations
// (signature, verify, idempotency), donation statuses, payouts, fees, refunds, reconciliation, admin-only routes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { hmacSha256Hex } from '../src/lib/payments.js';
import * as W from '../src/lib/wallet.js';
import * as FM from '../src/lib/fundmeMoney.js';
import { FUNDME_MONEY_ADMIN_SCRIPT } from '../src/lib/fundmeMoneyAdmin.js';
import { formatMoney } from '../src/lib/money.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', PAYMENTS_MODE: 'test' };
});

async function call(user, method, path, body, headers = {}, envOverride) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array || typeof body === 'string') b = body;
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b, redirect: 'manual' }), envOverride || env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, text, headers: res.headers };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const STORY = [{ type: 'p', text: 'My mother needs surgery next month and the hospital bill is more than we can pay.' }];

async function upImage(user) {
  const r = await call(user, 'POST', '/uploads/image', PNG, { 'Content-Type': 'image/png' });
  assert.equal(r.status, 201);
  return r.json.key;
}
async function upPdf(user, name = 'report.pdf') {
  const r = await call(user, 'POST', '/uploads/document', PDF, { 'Content-Type': 'application/pdf', 'X-File-Name': name });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.key;
}
const idOf = async (name) => (await call(name, 'GET', '/me')).json.id;
let seedN = 0;
async function giveCredits(name, n = 1) {
  await W.credit(env, { ref: `seed_credit:${name}:${++seedN}`, userId: await idOf(name), wallet: 'fundme_credits', amount: n, kind: 'admin_adjust' });
}
async function makeAdmin(name) {
  await call(name, 'GET', '/me');
  await env.__db.query(`UPDATE users SET role = 'admin' WHERE clerk_id = $1`, [`dev_${name}`]);
}
// draft → submit → approve; returns the owner view
async function liveFundraiser(owner, extra = {}) {
  await giveCredits(owner, 1);
  const main = await upImage(owner);
  const cr = await call(owner, 'POST', '/fundraisers', { title: 'Help Me Pay My Hospital Bill', goalMinor: 500000, currency: 'GBP', story: STORY, mainImageKey: main, ...extra });
  assert.equal(cr.status, 201, JSON.stringify(cr.json));
  assert.equal((await call(owner, 'POST', `/fundraisers/${cr.json.id}/submit`)).status, 200);
  const ap = await call('admin', 'POST', `/admin/api/fundme/${cr.json.id}/approve`);
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  return ap.json;
}
async function donate(user, slug, body, headers) {
  const r = await call(user, 'POST', `/f/${slug}/donations`, body, headers);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { ...r.json, ref: r.json.checkoutUrl.split('/pay/test/')[1] };
}
const webhook = (ref, status) => call(null, 'POST', '/webhooks/fundme/test', { ref, status });

test('full flow: create → upload → submit → approve → public page → donate → success', async () => {
  await makeAdmin('admin');
  await giveCredits('alice', 1);
  const main = await upImage('alice');
  const photo = await upImage('alice');
  const inStory = await upImage('alice');
  const doc = await upPdf('alice', 'hospital-report.pdf');
  const cr = await call('alice', 'POST', '/fundraisers', { title: 'Help Me Pay My Hospital Bill', goalMinor: 500000, currency: 'GBP' });
  assert.equal(cr.status, 201);
  assert.equal(cr.json.status, 'draft');
  assert.match(cr.json.slug, /^help-me-pay-my-hospital-bill-[a-z0-9]+$/);
  const id = cr.json.id;
  // not public while a draft
  assert.equal((await call(null, 'GET', `/f/${cr.json.slug}.json`)).status, 404);
  // incomplete submit
  assert.equal((await call('alice', 'POST', `/fundraisers/${id}/submit`)).json.code, 'INCOMPLETE');
  const up = await call('alice', 'PATCH', `/fundraisers/${id}`, {
    mainImageKey: main,
    story: [...STORY, { type: 'img', key: inStory, caption: 'At the clinic' }, { type: 'p', text: 'Thank you for praying with us.' }],
    media: [{ kind: 'image', key: photo, caption: 'Mum' }, { kind: 'pdf', key: doc, name: 'hospital-report.pdf', visibility: 'public' }],
  });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal(up.json.media.length, 2);
  assert.equal(up.json.story.length, 3);
  const sub = await call('alice', 'POST', `/fundraisers/${id}/submit`);
  assert.equal(sub.json.status, 'pending_review');
  // admin queue
  const pend = await call('admin', 'GET', '/admin/api/fundme/pending');
  assert.ok(pend.json.items.some((x) => x.id === id));
  const ap = await call('admin', 'POST', `/admin/api/fundme/${id}/approve`);
  assert.equal(ap.json.status, 'live');
  const slug = ap.json.slug;
  // public JSON (no auth)
  const pub = await call(null, 'GET', `/f/${slug}.json`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.title, 'Help Me Pay My Hospital Bill');
  assert.equal(pub.json.goalMinor, 500000);
  assert.equal(pub.json.raisedMinor, 0);
  assert.equal(pub.json.remainingMinor, 500000);
  assert.equal(pub.json.donationsOpen, true);
  assert.equal(pub.json.testMode, true);
  assert.equal(pub.json.media.find((m) => m.kind === 'pdf').url, `http://api.test/f/${slug}/docs/${pub.json.media.find((m) => m.kind === 'pdf').id}`);
  assert.equal(pub.json.story[1].key, undefined, 'public story hides R2 keys');
  assert.ok(pub.json.mainImageUrl.endsWith(main));
  // in-app list
  assert.ok((await call('bob', 'GET', '/fundraisers')).json.items.some((x) => x.id === id));
  // donate as a signed-in user → pending, checkout URL from the test provider
  const d = await donate('bob', slug, { amount_minor: 200000, message: 'Praying for you!', anonymous: false });
  assert.equal(d.provider, 'test');
  assert.match(d.checkoutUrl, /^http:\/\/api\.test\/pay\/test\/test_[0-9a-f]+$/);
  assert.equal((await call(null, 'GET', `/f/${slug}/donations/${d.donationId}`)).json.status, 'pending');
  // test checkout page
  const page = await call(null, 'GET', `/pay/test/${d.ref}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Simulate successful payment/);
  assert.match(page.text, /£2,000\.00/);
  // pending donation doesn't count yet
  assert.equal((await call(null, 'GET', `/f/${slug}.json`)).json.raisedMinor, 0);
  const ok = await webhook(d.ref, 'succeeded');
  assert.deepEqual([ok.status, ok.json.changed], [200, true]);
  const after = (await call(null, 'GET', `/f/${slug}.json`)).json;
  assert.equal(after.raisedMinor, 200000);
  assert.equal(after.remainingMinor, 300000);
  assert.equal(after.percent, 40);
  assert.equal(after.donorsCount, 1);
  assert.deepEqual(after.donations.map((x) => [x.name, x.amountMinor, x.message]), [['Bob', 200000, 'Praying for you!']]);
  assert.equal(after.donations[0].donorId, undefined);
  assert.equal((await call(null, 'GET', `/f/${slug}/donations/${d.donationId}`)).json.status, 'succeeded');
  // owner notified (approval + donation)
  const n = (await call('alice', 'GET', '/me/notifications')).json.items;
  assert.ok(n.some((x) => x.kind === 'fundme_approved'));
  const dn = n.find((x) => x.kind === 'fundme_donation');
  assert.ok(dn && dn.body.includes('£2,000') && dn.body.includes('Bob'));
  // owner lists
  const mine = await call('alice', 'GET', '/me/fundraisers');
  assert.equal(mine.json.items[0].raisedMinor, 200000);
  const dons = await call('alice', 'GET', `/fundraisers/${id}/donations`);
  assert.equal(dons.json.items.length, 1);
  // public HTML landing page with Open Graph tags
  const html = await call(null, 'GET', `/f/${slug}`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(html.text, /<meta property="og:title" content="Help Me Pay My Hospital Bill">/);
  assert.match(html.text, new RegExp(`<meta property="og:image" content="http://api.test/media/${main}">`));
  assert.match(html.text, /£2,000/);
  assert.match(html.text, /40%/);
  assert.match(html.headers.get('content-security-policy'), /script-src 'nonce-/);
});

test('anonymous donor is hidden publicly but the amount counts', async () => {
  const f = await liveFundraiser('carol');
  const d = await donate('dave', f.slug, { amount_minor: 2500, anonymous: true, message: 'God bless' });
  await webhook(d.ref, 'succeeded');
  const pub = (await call(null, 'GET', `/f/${f.slug}.json`)).json;
  assert.equal(pub.raisedMinor, 2500);
  assert.equal(pub.donations[0].name, 'Anonymous');
  assert.ok(!JSON.stringify(pub.donations).includes('Dave'));
  assert.ok(!(await call(null, 'GET', `/f/${f.slug}`)).text.includes('Dave'));
  // the organiser still sees who gave
  const own = await call('carol', 'GET', `/fundraisers/${f.id}/donations`);
  assert.equal(own.json.items[0].name, 'Dave');
  assert.equal(own.json.items[0].anonymous, true);
  const n = (await call('carol', 'GET', '/me/notifications')).json.items.find((x) => x.kind === 'fundme_donation');
  assert.ok(n.body.startsWith('An anonymous supporter'));
});

test('guest donation, failed payment does not count, duplicate webhook is idempotent', async () => {
  const f = await liveFundraiser('erin');
  const g = await donate(null, f.slug, { amount_minor: 1000, donor_name: 'Grace (guest)', anonymous: false }, { 'X-Forwarded-For': '10.0.0.1' });
  const bad = await donate(null, f.slug, { amount_minor: 5000, anonymous: false }, { 'X-Forwarded-For': '10.0.0.1' });
  assert.equal((await webhook(bad.ref, 'failed')).json.changed, true);
  // a failed donation can't be "succeeded" later
  assert.equal((await webhook(bad.ref, 'succeeded')).json.changed, false);
  assert.equal((await webhook(g.ref, 'succeeded')).json.changed, true);
  assert.equal((await webhook(g.ref, 'succeeded')).json.changed, false);
  assert.equal((await webhook(g.ref, 'succeeded')).json.changed, false);
  const pub = (await call(null, 'GET', `/f/${f.slug}.json`)).json;
  assert.equal(pub.raisedMinor, 1000);
  assert.equal(pub.donorsCount, 1);
  assert.deepEqual(pub.donations.map((x) => x.name), ['Grace (guest)']);
  const notes = (await call('erin', 'GET', '/me/notifications')).json.items.filter((x) => x.kind === 'fundme_donation');
  assert.equal(notes.length, 1, 'one notification per succeeded donation');
  // concurrent duplicate webhooks still count once
  const c = await donate(null, f.slug, { amount_minor: 3000 }, { 'X-Forwarded-For': '10.0.0.2' });
  const rs = await Promise.all([webhook(c.ref, 'succeeded'), webhook(c.ref, 'succeeded'), webhook(c.ref, 'succeeded')]);
  assert.equal(rs.filter((r) => r.json.changed).length, 1);
  assert.equal((await call(null, 'GET', `/f/${f.slug}.json`)).json.raisedMinor, 4000);
  // bad refs / statuses
  assert.equal((await webhook('nope', 'succeeded')).status, 400);
  assert.equal((await call(null, 'POST', '/webhooks/fundme/test', { ref: c.ref, status: 'succeeded' }, {}, { ...env, PAYMENTS_MODE: '' })).status, 404);
  assert.equal((await call(null, 'GET', `/pay/test/${c.ref}`, undefined, {}, { ...env, PAYMENTS_MODE: '' })).status, 404);
});

test('donation validation, limits, rate limiting and HTML form fallback', async () => {
  const f = await liveFundraiser('frank');
  assert.equal((await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 50 })).status, 400, 'below minimum');
  assert.equal((await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 10000001 })).status, 400, 'above maximum');
  assert.equal((await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000, message: 'x'.repeat(501) })).status, 400);
  assert.equal((await call(null, 'POST', '/f/no-such-fundraiser/donations', { amount_minor: 1000 })).status, 404);
  // no provider configured → "Donations open soon"
  const off = { ...env, PAYMENTS_MODE: '' };
  const closed = await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000 }, {}, off);
  assert.deepEqual([closed.status, closed.json.code, closed.json.error], [503, 'DONATIONS_NOT_OPEN', 'Donations aren’t switched on yet']);
  const pj = (await call(null, 'GET', `/f/${f.slug}.json`, undefined, {}, off)).json;
  assert.equal(pj.donationsOpen, false);
  assert.match((await call(null, 'GET', `/f/${f.slug}`, undefined, {}, off)).text, /Donations aren’t switched on yet/);
  // stripe mode without keys is not active either
  assert.equal((await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000 }, {}, { ...env, PAYMENTS_MODE: 'stripe' })).status, 503);
  // no-JS form post → 303 to the checkout
  const form = await call(null, 'POST', `/f/${f.slug}/donations`, 'amount_minor=2500&donor_name=Form+Friend&message=hi', { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '10.9.9.9' });
  assert.equal(form.status, 303);
  assert.match(form.headers.get('location'), /\/pay\/test\/test_/);
  // rate limit per IP
  let last;
  for (let i = 0; i < 11; i++) last = await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000 }, { 'X-Forwarded-For': '10.1.1.1' });
  assert.equal(last.status, 429);
  // paused → not accepting
  assert.equal((await call('frank', 'POST', `/fundraisers/${f.id}/pause`)).json.status, 'paused');
  assert.equal((await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000 }, { 'X-Forwarded-For': '10.3.3.3' })).json.code, 'NOT_ACCEPTING');
  assert.equal((await call(null, 'GET', `/f/${f.slug}.json`)).status, 200, 'owner-paused page stays visible');
  assert.equal((await call('frank', 'POST', `/fundraisers/${f.id}/resume`)).json.status, 'live');
});

test('ownership, locked fields and statuses', async () => {
  const f = await liveFundraiser('gina');
  // non-owner can't edit or manage
  assert.equal((await call('henry', 'PATCH', `/fundraisers/${f.id}`, { title: 'Hacked' })).status, 403);
  assert.equal((await call('henry', 'POST', `/fundraisers/${f.id}/pause`)).status, 403);
  assert.equal((await call('henry', 'POST', `/fundraisers/${f.id}/close`)).status, 403);
  assert.equal((await call('henry', 'GET', `/fundraisers/${f.id}/donations`)).status, 403);
  // non-owner GET sees the public view only
  const pv = await call('henry', 'GET', `/fundraisers/${f.id}`);
  assert.equal(pv.status, 200);
  assert.equal(pv.json.isOwner, undefined);
  assert.equal(pv.json.mainImageKey, undefined);
  // someone else's upload can't be attached
  const hk = await upImage('henry');
  assert.equal((await call('gina', 'PATCH', `/fundraisers/${f.id}`, { mainImageKey: hk })).json.code, 'BAD_MEDIA');
  assert.equal((await call('gina', 'PATCH', `/fundraisers/${f.id}`, { story: [{ type: 'img', key: 'img/../../etc/passwd' }] })).json.code, 'BAD_MEDIA');
  // live: heading and story editable; goal/currency locked
  const ed = await call('gina', 'PATCH', `/fundraisers/${f.id}`, { title: 'Help Me Pay My Hospital Bill (update)' });
  assert.equal(ed.json.title, 'Help Me Pay My Hospital Bill (update)');
  assert.equal(ed.json.status, 'live');
  assert.equal((await call('gina', 'PATCH', `/fundraisers/${f.id}`, { goalMinor: 900000 })).json.code, 'LOCKED_FIELD');
  assert.equal((await call('gina', 'PATCH', `/fundraisers/${f.id}`, { currency: 'USD' })).json.code, 'LOCKED_FIELD');
  // drafts: currency validation
  assert.equal((await call('gina', 'POST', '/fundraisers', { title: 'Support My Education', goalMinor: 1000, currency: 'JPY' })).json.code, 'BAD_CURRENCY');
  assert.equal((await call('gina', 'POST', '/fundraisers', { title: 'Support My Education', goalMinor: 0, currency: 'USD' })).status, 400);
  // admin-only routes
  assert.equal((await call('gina', 'GET', '/admin/api/fundme/pending')).status, 403);
  assert.equal((await call('gina', 'GET', '/admin/api/fundme')).status, 403);
  assert.equal((await call('gina', 'POST', `/admin/api/fundme/${f.id}/approve`)).status, 403);
  // admin pause hides the page; owner can't resume it
  assert.equal((await call('admin', 'POST', `/admin/api/fundme/${f.id}/pause`)).json.status, 'paused');
  assert.equal((await call(null, 'GET', `/f/${f.slug}.json`)).status, 404);
  assert.equal((await call(null, 'GET', `/f/${f.slug}`)).status, 404);
  assert.equal((await call('gina', 'POST', `/fundraisers/${f.id}/resume`)).json.code, 'ADMIN_PAUSED');
  assert.equal((await call('admin', 'POST', `/admin/api/fundme/${f.id}/approve`)).json.status, 'live');
  // close → page stays, donations stop
  assert.equal((await call('gina', 'POST', `/fundraisers/${f.id}/close`)).json.status, 'closed');
  assert.equal((await call(null, 'GET', `/f/${f.slug}.json`)).json.status, 'closed');
  assert.equal((await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000 })).json.code, 'NOT_ACCEPTING');
});

test('admin reject with reason → owner notified → edit → resubmit', async () => {
  await giveCredits('ivy', 1);
  const main = await upImage('ivy');
  const cr = await call('ivy', 'POST', '/fundraisers', { title: 'Support My Ministry', goalMinor: 300000, currency: 'NGN', story: STORY, mainImageKey: main });
  // NGN minimum goal is higher (₦500)
  assert.equal(cr.status, 201);
  await call('ivy', 'POST', `/fundraisers/${cr.json.id}/submit`);
  assert.equal((await call('admin', 'POST', `/admin/api/fundme/${cr.json.id}/reject`, {})).status, 400, 'reason required');
  const rj = await call('admin', 'POST', `/admin/api/fundme/${cr.json.id}/reject`, { reason: 'Please add the church letter' });
  assert.equal(rj.json.status, 'rejected');
  const own = await call('ivy', 'GET', `/fundraisers/${cr.json.id}`);
  assert.equal(own.json.rejectReason, 'Please add the church letter');
  assert.equal(own.json.isOwner, true);
  const n = (await call('ivy', 'GET', '/me/notifications')).json.items.find((x) => x.kind === 'fundme_rejected');
  assert.ok(n.body.includes('Please add the church letter'));
  assert.equal((await call(null, 'GET', `/f/${cr.json.slug}.json`)).status, 404);
  assert.equal((await call('ivy', 'PATCH', `/fundraisers/${cr.json.id}`, { goalMinor: 400000 })).json.goalMinor, 400000);
  assert.equal((await call('ivy', 'POST', `/fundraisers/${cr.json.id}/submit`)).json.status, 'pending_review');
  const view = await call('admin', 'GET', `/admin/api/fundme/${cr.json.id}`);
  assert.equal(view.json.ownerId.length, 36);
  const list = await call('admin', 'GET', '/admin/api/fundme?status=pending_review');
  assert.ok(list.json.counts.pending_review >= 1);
});

test('documents: PDF only, private docs never public, signed links for the owner', async () => {
  assert.equal((await call('jack', 'POST', '/uploads/document', PNG, { 'Content-Type': 'application/pdf' })).json.code, 'BAD_DOCUMENT_TYPE', 'magic bytes');
  assert.equal((await call('jack', 'POST', '/uploads/document', PDF, { 'Content-Type': 'image/png' })).json.code, 'BAD_DOCUMENT_TYPE');
  assert.equal((await call(null, 'POST', '/uploads/document', PDF, { 'Content-Type': 'application/pdf' })).status, 401);
  const big = new Uint8Array(10 * 1024 * 1024 + 10); big.set(PDF);
  assert.equal((await call('jack', 'POST', '/uploads/document', big, { 'Content-Type': 'application/pdf' })).status, 413);
  const q = await call('jack', 'POST', '/uploads/document?name=letter%20from%20school.pdf', PDF, { 'Content-Type': 'application/pdf' });
  assert.equal(q.json.name, 'letter from school.pdf', 'file name via query string');
  const priv = await upPdf('jack', 'medical.pdf');
  const pub = await upPdf('jack', 'invoice.pdf');
  // docs are not reachable through the public /media route
  assert.equal((await call(null, 'GET', `/media/${priv}`)).status, 404);
  const f = await liveFundraiser('jack', { media: [{ kind: 'pdf', key: priv, name: 'medical.pdf' }, { kind: 'pdf', key: pub, name: 'invoice.pdf', visibility: 'public' }] });
  const own = f.media;
  const privItem = own.find((m) => m.name === 'medical.pdf');
  const pubItem = own.find((m) => m.name === 'invoice.pdf');
  assert.equal(privItem.visibility, 'private', 'documents default to private');
  // public JSON / HTML only list the public doc
  const pj = (await call(null, 'GET', `/f/${f.slug}.json`)).json;
  assert.deepEqual(pj.media.filter((m) => m.kind === 'pdf').map((m) => m.name), ['invoice.pdf']);
  assert.ok(!(await call(null, 'GET', `/f/${f.slug}`)).text.includes('medical.pdf'));
  assert.ok(!JSON.stringify((await call('kate', 'GET', `/fundraisers/${f.id}`)).json).includes('medical.pdf'));
  // public doc route
  const okDoc = await call(null, 'GET', `/f/${f.slug}/docs/${pubItem.id}`);
  assert.equal(okDoc.status, 200);
  assert.equal(okDoc.headers.get('content-type'), 'application/pdf');
  assert.ok(okDoc.text.startsWith('%PDF'));
  assert.equal((await call(null, 'GET', `/f/${f.slug}/docs/${privItem.id}`)).status, 404);
  // signed link (owner view) works; tampering / expiry fails
  const signed = new URL(privItem.url);
  assert.equal((await call(null, 'GET', signed.pathname + signed.search)).status, 200);
  assert.equal((await call(null, 'GET', signed.pathname + signed.search.replace(/sig=(.)/, (m, ch) => `sig=${ch === '0' ? '1' : '0'}`))).status, 403);
  assert.equal((await call(null, 'GET', `${signed.pathname}?exp=1&sig=${signed.searchParams.get('sig')}`)).status, 403);
  // admin sees private docs with a signed link too
  const adm = await call('admin', 'GET', `/admin/api/fundme/${f.id}`);
  assert.ok(adm.json.media.some((m) => m.name === 'medical.pdf' && m.url.includes('/fundme/docs/')));
  // flip visibility keeps the media id stable
  const media = own.map((m) => ({ id: m.id, caption: m.caption, visibility: 'public' }));
  const ed = await call('jack', 'PATCH', `/fundraisers/${f.id}`, { media });
  assert.deepEqual(ed.json.media.map((m) => m.id).sort(), own.map((m) => m.id).sort());
  assert.equal((await call(null, 'GET', `/f/${f.slug}/docs/${privItem.id}`)).status, 200);
});

test('public HTML escapes user content (XSS)', async () => {
  await giveCredits('mallory', 1);
  const main = await upImage('mallory');
  const evil = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
  const cr = await call('mallory', 'POST', '/fundraisers', {
    title: `Help ${evil}`.slice(0, 120), goalMinor: 10000, currency: 'USD', mainImageKey: main,
    story: [{ type: 'p', text: `Story ${evil} </textarea><style>body{display:none}</style> long enough to submit.` }],
  });
  await call('mallory', 'POST', `/fundraisers/${cr.json.id}/submit`);
  await call('admin', 'POST', `/admin/api/fundme/${cr.json.id}/approve`);
  const d = await donate('nina', cr.json.slug, { amount_minor: 1000, donor_name: '</script><script>alert(3)</script>', message: '<b onmouseover=alert(4)>hi</b>' });
  await webhook(d.ref, 'succeeded');
  const html = (await call(null, 'GET', `/f/${cr.json.slug}`)).text;
  assert.ok(!html.includes('<script>alert'), 'no injected script tags');
  assert.ok(!html.includes('<img src=x'), 'no injected img');
  assert.ok(!html.includes('<b onmouseover'), 'no injected markup in messages');
  assert.ok(!html.includes('<style>body{display:none}'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b onmouseover=alert(4)&gt;hi&lt;/b&gt;'));
  // the JSON config block can't be closed early
  const cfg = html.match(/<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/)[1];
  assert.ok(!cfg.includes('<'));
  assert.equal(JSON.parse(cfg).title, `Help ${evil}`.slice(0, 120));
  // test checkout page escapes too
  const d2 = await donate('nina', cr.json.slug, { amount_minor: 1000, donor_name: '<img src=x onerror=alert(5)>' });
  assert.ok(!(await call(null, 'GET', `/pay/test/${d2.ref}`)).text.includes('<img src=x'));
});

test('Stripe Connect destination charges are retired (donations never go straight to the beneficiary)', async () => {
  const f = await liveFundraiser('olga');
  const stripeEnv = { ...env, PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' };
  const r = await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000 }, { 'X-Forwarded-For': '10.7.7.7' }, stripeEnv);
  assert.deepEqual([r.status, r.json.code], [503, 'DONATIONS_NOT_OPEN']);
  assert.ok([401, 404].includes((await call(null, 'POST', '/webhooks/fundme/stripe', {}, {}, stripeEnv)).status), 'no Stripe webhook any more');
});

test('money formatting', () => {
  assert.equal(formatMoney(500000, 'GBP'), '£5,000');
  assert.equal(formatMoney(1050, 'USD'), '$10.50');
  assert.equal(formatMoney(2500000, 'NGN'), '₦25,000');
  assert.equal(formatMoney(99, 'EUR'), '€0.99');
});

// =====================================================================================================================
// FUND ME MONEY (monetisation stage 2)
// =====================================================================================================================
import { createHmac } from 'node:crypto';

const bal = async (name, wallet = 'fundme_credits') => W.getBalance(env, name === 'platform' ? 'platform' : await idOf(name), wallet);
let keyN = 0;
const ikey = () => `test_key_${Date.now()}_${++keyN}`;
async function draft(owner, extra = {}) {
  const main = await upImage(owner);
  const r = await call(owner, 'POST', '/fundraisers', { title: `Support for ${owner} ${++keyN}`, goalMinor: 500000, currency: 'GBP', story: [{ type: 'p', text: `Unique story for ${owner} number ${keyN}: school fees for this term, thank you for any help.` }], mainImageKey: main, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}
const setRule = async (key, value) => { const r = await call('admin', 'PUT', '/admin/api/fundme/rules', { key, value }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
const publishOps = async (fid) => (await env.__db.query(`SELECT COUNT(*)::int AS n FROM wallet_ops WHERE ref = $1`, [`fundme_publish:${fid}`]))[0].n;
const donationRow = async (id) => (await env.__db.query('SELECT * FROM donations WHERE id = $1', [id]))[0];
const adm = (method, path, b) => call('admin', method, path, b);
// The money-flow tests below check exact ledger amounts, so they switch every fee off; the fee tests set their own.
const FEE_RULES = { fundme_fee_bps: 0, fundme_paystack_fee_bps: 0, fundme_paystack_fee_flat_minor: 0, fundme_vat_bps: 0 };
const zeroFees = async () => { for (const [k, v] of Object.entries(FEE_RULES)) await setRule(k, v); };
// Payout KYC (lib/kyc.js): submit as the member, approve as staff
async function approvedKyc(name, { bankCode = '058', accountNumber = '0123456789', legalName = 'Nkem Obi', e } = {}) {
  const s = await call(name, 'PUT', '/payout-kyc', { idType: 'nin', idNumber: '12345678901', legalName, bankCode, accountNumber, accountName: legalName }, {}, e);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const a = await adm('POST', `/admin/api/fundme/kyc/${await idOf(name)}/approve`);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  return a.json;
}

test('admin script for "Donations & payouts" is a plain string', () => {
  assert.ok(!FUNDME_MONEY_ADMIN_SCRIPT.includes('`') && !FUNDME_MONEY_ADMIN_SCRIPT.includes('${'));
  assert.match(FUNDME_MONEY_ADMIN_SCRIPT, /title: 'Donations & payouts'/);
});

test('publishing needs a credit; exactly one is spent, atomically, only when the request goes live', async () => {
  const f = await draft('pat');
  const no = await call('pat', 'POST', `/fundraisers/${f.id}/submit`);
  assert.deepEqual([no.status, no.json.code], [402, 'INSUFFICIENT_BALANCE']);
  assert.equal(no.json.wallet, 'fundme_credits');
  assert.equal((await call('pat', 'GET', `/fundraisers/${f.id}`)).json.status, 'draft');
  await giveCredits('pat', 1);
  const cr = await call('pat', 'GET', '/fundme/credits');
  assert.deepEqual([cr.json.balance, cr.json.cost, cr.json.available], [1, 1, 1]);
  assert.equal((await call('pat', 'POST', `/fundraisers/${f.id}/submit`)).json.status, 'pending_review');
  assert.equal(await bal('pat'), 1, 'submitting reserves, it does not spend');
  const cr2 = (await call('pat', 'GET', '/fundme/credits')).json;
  assert.deepEqual([cr2.reserved, cr2.available, cr2.usage.inReview], [1, 0, 1]);
  const f2 = await draft('pat');
  assert.equal((await call('pat', 'POST', `/fundraisers/${f2.id}/submit`)).json.code, 'INSUFFICIENT_BALANCE', 'reserved credit can’t be used twice');
  const ap = await adm('POST', `/admin/api/fundme/${f.id}/approve`);
  assert.equal(ap.json.status, 'live');
  assert.equal(await bal('pat'), 0);
  assert.equal(await publishOps(f.id), 1);
  const h = (await call('pat', 'GET', '/fundme/credits/history')).json.items;
  assert.deepEqual([h[0].kind, h[0].amount, h[0].relatedId], ['fundme_publish', -1, f.id]);
  // pause + make live again: no second charge
  await adm('POST', `/admin/api/fundme/${f.id}/pause`);
  assert.equal((await adm('POST', `/admin/api/fundme/${f.id}/approve`)).json.status, 'live');
  assert.equal(await bal('pat'), 0);
  assert.equal(await publishOps(f.id), 1);
});

test('a failed publish deducts nothing (no credit at approval, request changed meanwhile, rejected)', async () => {
  await giveCredits('quinn', 1);
  const f = await draft('quinn');
  await call('quinn', 'POST', `/fundraisers/${f.id}/submit`);
  const g = await call('quinn', 'POST', '/fundme/credits/gift', { recipientId: await idOf('rory'), amount: 1, idempotencyKey: ikey() });
  assert.equal(g.status, 201, JSON.stringify(g.json));
  const ap = await adm('POST', `/admin/api/fundme/${f.id}/approve`);
  assert.deepEqual([ap.status, ap.json.code], [402, 'INSUFFICIENT_BALANCE']);
  assert.equal((await call('quinn', 'GET', `/fundraisers/${f.id}`)).json.status, 'pending_review');
  assert.equal(await publishOps(f.id), 0);
  assert.ok((await call('quinn', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'fundme_credits_needed'));
  // the request changed between loading and publishing → the whole transaction (credit included) rolls back
  await giveCredits('quinn', 1);
  const row = (await env.__db.query('SELECT * FROM fundraisers WHERE id = $1', [f.id]))[0];
  await env.__db.query(`UPDATE fundraisers SET status = 'closed' WHERE id = $1`, [f.id]);
  await assert.rejects(FM.publishFundraiser(env, row, await idOf('admin')), (e) => e.code === 'STATE_CHANGED');
  assert.equal(await bal('quinn'), 1);
  assert.equal(await publishOps(f.id), 0);
  // rejected requests never cost a credit
  const f2 = await draft('quinn');
  await call('quinn', 'POST', `/fundraisers/${f2.id}/submit`);
  await adm('POST', `/admin/api/fundme/${f2.id}/reject`, { reason: 'Please add a letter' });
  assert.equal(await bal('quinn'), 1);
});

test('publishing limits (per day, per 30 days, active) are admin-configurable', async () => {
  await giveCredits('lena', 10);
  await setRule('fundme_max_active_requests', 1);
  const a = await draft('lena'); const b = await draft('lena');
  assert.equal((await call('lena', 'POST', `/fundraisers/${a.id}/submit`)).status, 200);
  assert.equal((await call('lena', 'POST', `/fundraisers/${b.id}/submit`)).json.code, 'LIMIT_ACTIVE');
  await setRule('fundme_max_active_requests', 10);
  await setRule('fundme_max_requests_per_day', 1);
  assert.equal((await call('lena', 'POST', `/fundraisers/${b.id}/submit`)).json.code, 'LIMIT_DAY');
  await setRule('fundme_max_requests_per_day', 5);
  await setRule('fundme_max_requests_per_month', 1);
  assert.equal((await call('lena', 'POST', `/fundraisers/${b.id}/submit`)).json.code, 'LIMIT_MONTH');
  await setRule('fundme_max_requests_per_month', 10);
  assert.equal((await call('lena', 'POST', `/fundraisers/${b.id}/submit`)).status, 200);
  // a resubmission after "needs changes" is not a new request
  await adm('POST', `/admin/api/fundme/${b.id}/reject`, { reason: 'Fix the photo' });
  await setRule('fundme_max_requests_per_day', 1);
  assert.equal((await call('lena', 'POST', `/fundraisers/${b.id}/submit`)).status, 200);
  await setRule('fundme_max_requests_per_day', 0);
  await setRule('fundme_max_requests_per_month', 0);
  await setRule('fundme_max_active_requests', 0);
  assert.equal((await adm('PUT', '/admin/api/fundme/rules', { key: 'fundme_max_requests_per_day', value: -1 })).json.code, 'BAD_CONFIG');
  assert.equal((await adm('PUT', '/admin/api/fundme/rules', { key: 'gift_commission_bps', value: 1 })).json.code, 'BAD_CONFIG');
  assert.equal((await call('lena', 'PUT', '/admin/api/fundme/rules', { key: 'fundme_fee_bps', value: 0 })).status, 403);
  assert.ok((await env.__db.query(`SELECT 1 FROM admin_actions WHERE action = 'fundme.rules.set'`)).length > 0);
});

test('moderation: anti-fraud checks flag (never silently reject) and flagged requests come first', async () => {
  await giveCredits('sam', 2); await giveCredits('tia', 2);
  const story = [{ type: 'p', text: 'Copied appeal text: please help me pay for my brother’s operation this month.' }];
  const s1 = await draft('sam', { title: 'Brother operation appeal', story });
  const t1 = await draft('tia', { title: 'Brother operation appeal', story, currency: 'NGN', goalMinor: 2000000000 });
  await env.__db.query(`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, 'user', $2, 'scam')`, [await idOf('sam'), await idOf('tia')]);
  assert.equal((await call('sam', 'POST', `/fundraisers/${s1.id}/submit`)).status, 200);
  assert.equal((await call('tia', 'POST', `/fundraisers/${t1.id}/submit`)).status, 200);
  const list = (await adm('GET', '/admin/api/fundme?status=pending_review')).json.items;
  const t = list.find((x) => x.id === t1.id);
  const codes = t.riskFlags.map((f) => f.code);
  for (const c of ['new_account', 'duplicate_text', 'duplicate_image', 'reported_user', 'large_goal']) assert.ok(codes.includes(c), `flag ${c} in ${codes}`);
  assert.equal(t.ownerCredits, 2);
  assert.ok(list[0].riskFlags.length > 0, 'flagged first');
  assert.ok((await adm('GET', '/admin/api/fundme/suspicious')).json.requests.some((r) => r.id === t1.id));
  assert.equal((await adm('POST', `/admin/api/fundme/${t1.id}/approve`)).json.status, 'live', 'a human can still approve');
});

test('gifting Fund Me credits: atomic, both notified, idempotent, no self-gift, no cash transfer', async () => {
  await giveCredits('gary', 5);
  const hana = await idOf('hana');
  const self = await call('gary', 'POST', '/fundme/credits/gift', { recipientId: await idOf('gary'), amount: 1, idempotencyKey: ikey() });
  assert.deepEqual([self.status, self.json.code], [400, 'SELF_TRANSFER']);
  assert.equal((await call('gary', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 6, idempotencyKey: ikey() })).json.code, 'INSUFFICIENT_BALANCE');
  assert.equal((await call('gary', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 0, idempotencyKey: ikey() })).json.code, 'BAD_AMOUNT');
  assert.equal((await call('gary', 'POST', '/fundme/credits/gift', { recipientId: '00000000-0000-4000-8000-000000000000', amount: 1, idempotencyKey: ikey() })).status, 404);
  assert.equal((await call('gary', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 1 })).json.code, 'BAD_REF');
  assert.deepEqual([await bal('gary'), await bal('hana')], [5, 0], 'refused gifts move nothing');
  const k = ikey();
  const ok = await call('gary', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 3, idempotencyKey: k, note: 'For your appeal' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.deepEqual([await bal('gary'), await bal('hana')], [2, 3]);
  const again = await call('gary', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 3, idempotencyKey: k });
  assert.deepEqual([again.status, again.json.applied, again.json.duplicate], [200, false, true]);
  const k2 = ikey();
  const rs = await Promise.all([1, 2, 3].map(() => call('gary', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 1, idempotencyKey: k2 })));
  assert.equal(rs.filter((r) => r.json.applied).length, 1);
  assert.deepEqual([await bal('gary'), await bal('hana')], [1, 4]);
  assert.ok((await call('gary', 'GET', '/fundme/credits/history')).json.items.some((e) => e.kind === 'fundme_credit_gift_sent' && e.amount === -3 && e.counterparty.id === hana));
  assert.ok((await call('hana', 'GET', '/fundme/credits/history')).json.items.some((e) => e.kind === 'fundme_credit_gift_received' && e.amount === 3));
  assert.ok((await call('hana', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'fundme_credits' && /Fund Me credits/.test(n.body)));
  assert.ok((await call('gary', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'fundme_credits' && /You sent/.test(n.body)));
  // credits only: asking for another wallet still moves credits; there is no member-to-member cash / coin transfer
  // (gary has used up his 10 gifts a minute — the rate limit — so ivan tries this one)
  assert.equal((await call('gary', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 1, idempotencyKey: ikey() })).json.code, 'RATE_LIMITED');
  await giveCredits('ivan', 1);
  await W.credit(env, { ref: `seed_dc:${ikey()}`, userId: await idOf('ivan'), wallet: 'dating_coins', amount: 50, kind: 'admin_adjust' });
  assert.equal((await call('ivan', 'POST', '/fundme/credits/gift', { recipientId: hana, amount: 1, idempotencyKey: ikey(), wallet: 'dating_coins' })).status, 201);
  assert.deepEqual([await bal('ivan', 'dating_coins'), await bal('hana', 'dating_coins'), await bal('ivan'), await bal('hana')], [50, 0, 0, 5]);
  for (const path of ['/wallet/transfer', '/wallet/send', '/fundme/transfer', '/fundme/donations/transfer', '/fundme/payouts']) {
    assert.ok([404, 405].includes((await call('gary', 'POST', path, { recipientId: hana, amount: 1, wallet: 'donations_held_ngn' })).status), path);
  }
  for (const w of ['dating_coins', 'gift_coins', 'gift_earnings_available', 'donations_held_ngn']) {
    await assert.rejects(W.transfer(env, { ref: `x:${ikey()}`, fromId: await idOf('gary'), toId: hana, wallet: w, amount: 1, kindOut: 'a_out', kindIn: 'a_in' }), (e) => e.code === 'NOT_GIFTABLE');
  }
  await env.__db.query(`UPDATE users SET handle = 'hana_h' WHERE id = $1`, [hana]);
  assert.ok((await call('gary', 'GET', '/fundme/members?q=hana')).json.items.some((u) => u.id === hana));
  assert.ok(!(await call('hana', 'GET', '/fundme/members?q=hana')).json.items.some((u) => u.id === hana), 'never yourself');
});

test('donation statuses: allowed and forbidden transitions', () => {
  const can = (a, s, extra = {}) => FM.canDonationAction(a, { settlement_status: s, received_at: ['pending', 'failed'].includes(s) ? null : new Date(), payout_id: null, ...extra }).ok;
  assert.ok(can('verify', 'processing'));
  assert.ok(can('verify', 'under_review'));
  assert.ok(!can('verify', 'pending'));
  assert.ok(!can('verify', 'paid'));
  assert.ok(!can('verify', 'under_review', { received_at: null }), 'money not received');
  assert.ok(can('approve', 'verified'));
  assert.ok(!can('approve', 'processing'));
  assert.ok(!can('approve', 'under_review'));
  assert.ok(can('review', 'approved_for_payout'));
  assert.ok(!can('review', 'approved_for_payout', { payout_id: 'p' }));
  assert.ok(!can('review', 'paid'));
  assert.ok(can('fail', 'pending'));
  assert.ok(!can('fail', 'processing'));
  assert.ok(!can('fail', 'under_review', { received_at: new Date() }), 'received money is refunded, not failed');
  assert.ok(can('refund', 'verified'));
  assert.ok(!can('refund', 'paid'), 'no refund after payout');
  assert.ok(!can('refund', 'refunded'));
  assert.ok(!can('refund', 'approved_for_payout', { payout_id: 'p' }));
  assert.ok(!can('refund', 'pending'));
  assert.ok(!can('nope', 'pending'));
  assert.deepEqual(FM.DONATION_STATUSES, ['pending', 'processing', 'verified', 'approved_for_payout', 'paid', 'failed', 'refunded', 'under_review']);
});

test('fees math', () => {
  const cfg = { fundme_fee_bps: 250, fundme_fee_fixed_minor: { NGN: 10000 } };
  assert.equal(FM.donationFee(cfg, 1000000, 'NGN'), 25000 + 10000);
  assert.equal(FM.donationFee(cfg, 1000, 'GBP'), 25, 'missing currency → default fixed fee (0)');
  assert.equal(FM.donationFee({ fundme_fee_bps: 0, fundme_fee_fixed_minor: {} }, 123456, 'NGN'), 0);
  assert.equal(FM.donationFee({ fundme_fee_bps: 333, fundme_fee_fixed_minor: { NGN: 0 } }, 1001, 'NGN'), 33, 'rounds down');
});

// ---- Paystack (fetch mocked) ----
const PSK = 'sk_live_fundme_secret';
const PSK_TEST = 'sk_test_fundme_secret'; // Paystack test keys: donations are marked is_test (never real money)
const penv = (extra = {}) => ({ ...env, PAYMENTS_MODE: '', PAYSTACK_SECRET_KEY: PSK, ...extra });
const sign = (raw, key = PSK) => createHmac('sha512', key).update(raw).digest('hex');
const paystack = { verify: {}, transfers: [], initialized: {} };
function mockPaystack() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.paystack.co')) return real(url, opts);
    assert.ok([`Bearer ${PSK}`, `Bearer ${PSK_TEST}`].includes(opts.headers.Authorization));
    const json = (data) => new Response(JSON.stringify({ status: true, message: 'ok', data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/transaction/initialize')) {
      const b = JSON.parse(opts.body);
      assert.ok(b.email && b.amount > 0 && b.reference && ['NGN', 'USD'].includes(b.currency));
      paystack.initialized[b.reference] = b;
      return json({ authorization_url: `https://checkout.paystack.com/${b.reference}`, access_code: 'ac_1', reference: b.reference });
    }
    const m = u.match(/\/transaction\/verify\/(.+)$/);
    if (m) { const ref = decodeURIComponent(m[1]); const v = paystack.verify[ref] || { status: 'abandoned' }; return json({ id: 77, reference: ref, channel: 'card', paid_at: new Date().toISOString(), fees: 150, currency: 'NGN', amount: 0, ...v }); }
    if (u.includes('/bank/resolve')) return json({ account_name: 'NKEM OBI', account_number: '0123456789' });
    if (u.includes('/bank?')) return json([{ code: '058', name: 'Guaranty Trust Bank', active: true }, { code: '044', name: 'Access Bank', active: true }]);
    if (u.endsWith('/transferrecipient')) return json({ recipient_code: 'RCP_test1' });
    if (u.endsWith('/transfer')) { const b = JSON.parse(opts.body); paystack.transfers.push(b); return json({ transfer_code: 'TRF_test1', status: 'pending', reference: b.reference }); }
    if (u.endsWith('/refund')) return json({ status: 'pending' });
    return new Response(JSON.stringify({ status: false, message: 'not mocked' }), { status: 404 });
  };
  return () => { globalThis.fetch = real; };
}
async function hook(payload, sig, e = penv()) {
  const raw = JSON.stringify(payload);
  const r = await app.fetch(new Request('http://api.test/webhooks/fundme/paystack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Paystack-Signature': sig === undefined ? sign(raw) : sig }, body: raw }), e);
  return { status: r.status, json: await r.json() };
}
async function paystackDonation(user, fr, amount, extra = {}) {
  const r = await call(user, 'POST', `/f/${fr.slug}/donations`, { amount_minor: amount, email: `${user || 'guest'}@example.com`, ...extra }, user ? {} : { 'X-Forwarded-For': `10.50.0.${++keyN % 250}` }, penv());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.donationId;
}
const charge = (ref) => ({ event: 'charge.success', data: { reference: ref, amount: 999999999, currency: 'NGN' } });

let NG; let D1; let D2;
test('Paystack donations: hosted checkout, signature check, server-side verify before recording, idempotent', async () => {
  const restore = mockPaystack();
  try {
    await zeroFees();
    NG = await liveFundraiser('nkem', { currency: 'NGN', goalMinor: 50000000 });
    const E = penv();
    const info = (await call('uche', 'GET', `/fundraisers/${NG.id}`, undefined, {}, E)).json;
    assert.deepEqual([info.provider, info.needsEmail, info.donationsOpen], ['paystack', true, true]);
    assert.match(info.heldByBibleNestra, /BibleNestra/);
    assert.equal((await call('uche', 'POST', `/f/${NG.slug}/donations`, { amount_minor: 500000 }, {}, E)).json.code, 'EMAIL_REQUIRED');
    const d = await call('uche', 'POST', `/f/${NG.slug}/donations`, { amount_minor: 500000, email: 'uche@example.com', message: 'Be strong' }, {}, E);
    assert.equal(d.status, 201, JSON.stringify(d.json));
    D1 = d.json.donationId;
    assert.deepEqual([d.json.provider, d.json.checkoutUrl], ['paystack', `https://checkout.paystack.com/${D1}`]);
    let row = await donationRow(D1);
    assert.deepEqual([row.provider_ref, row.settlement_status, row.beneficiary_id, row.is_test], [D1, 'pending', await idOf('nkem'), false]);
    // bad / missing / wrong-key signature → rejected; Paystack not set up → 503; nothing recorded
    const p = charge(D1);
    assert.equal((await hook(p, 'deadbeef')).status, 400);
    assert.equal((await hook(p, '')).status, 400);
    assert.equal((await hook(p, sign(JSON.stringify(p), 'sk_wrong'))).status, 400);
    assert.equal((await hook(p, undefined, { ...env, PAYSTACK_SECRET_KEY: '' })).status, 503);
    // signed, but Paystack's verify says it isn't paid → nothing recorded
    assert.deepEqual([(await hook(p)).json.ignored, (await donationRow(D1)).status], [true, 'pending']);
    // paid: the amount comes from VERIFY, not from the webhook body; duplicate webhooks credit once
    paystack.verify[D1] = { status: 'success', amount: 500000 };
    const held0 = await bal('nkem', 'donations_held_ngn');
    const rs = await Promise.all([hook(p), hook(p), hook(p)]);
    assert.equal(rs.filter((r) => r.json.changed).length, 1);
    assert.equal((await hook(p)).json.changed, false);
    row = await donationRow(D1);
    assert.deepEqual([row.status, row.settlement_status, Number(row.amount_minor), Number(row.net_minor), row.gateway.channel], ['succeeded', 'processing', 500000, 500000, 'card']);
    assert.ok(row.receipt_no && row.received_at);
    assert.equal(await bal('nkem', 'donations_held_ngn'), held0 + 500000);
    assert.equal((await call(null, 'GET', `/f/${NG.slug}.json`)).json.raisedMinor, 500000);
    assert.ok((await call('nkem', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'fundme_donation' && /holds it/.test(n.body)));
    assert.ok((await call('uche', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'fundme_receipt'));
    // receipts: donor and organiser yes, strangers no
    const rc = await call('uche', 'GET', `/fundme/donations/${D1}/receipt`);
    assert.equal(rc.status, 200);
    assert.deepEqual([rc.json.receiptNo, rc.json.amountMinor, rc.json.method], [row.receipt_no, 500000, 'Paystack']);
    assert.match(rc.json.paidTo, /BibleNestra/);
    assert.equal((await call('nkem', 'GET', `/fundme/donations/${D1}/receipt`)).status, 200);
    assert.equal((await call('zed', 'GET', `/fundme/donations/${D1}/receipt`)).status, 403);
    assert.ok((await call('uche', 'GET', '/fundme/donations/mine')).json.items.some((x) => x.id === D1 && x.status === 'processing'));
    // amount differs from the checkout → recorded at the PAID amount and put under review
    D2 = await paystackDonation('uche', NG, 600000);
    paystack.verify[D2] = { status: 'success', amount: 400000 };
    await hook(charge(D2));
    row = await donationRow(D2);
    assert.deepEqual([row.settlement_status, Number(row.amount_minor)], ['under_review', 400000]);
    assert.ok(row.risk_flags.some((f) => f.code === 'amount_mismatch'));
    // the app's poll asks Paystack itself while pending
    const D3 = await paystackDonation(null, NG, 250000);
    paystack.verify[D3] = { status: 'success', amount: 250000 };
    await env.__db.query(`UPDATE donations SET created_at = now() - interval '1 minute' WHERE id = $1`, [D3]);
    assert.equal((await call(null, 'GET', `/f/${NG.slug}/donations/${D3}`, undefined, {}, E)).json.settlementStatus, 'processing');
    // Paystack's return redirect verifies too
    const D4 = await paystackDonation('vera', NG, 100000);
    paystack.verify[D4] = { status: 'success', amount: 100000 };
    const ret = await call(null, 'GET', `/fundme/paystack/return?trxref=${D4}&reference=${D4}`, undefined, {}, E);
    assert.equal(ret.status, 302);
    assert.match(ret.headers.get('location'), /\?donation=succeeded$/);
    const D5 = await paystackDonation('vera', NG, 100000);
    paystack.verify[D5] = { status: 'failed' };
    await env.__db.query(`UPDATE donations SET created_at = now() - interval '1 minute' WHERE id = $1`, [D5]);
    assert.equal((await call(null, 'GET', `/f/${NG.slug}/donations/${D5}`, undefined, {}, E)).json.settlementStatus, 'failed');
    // Paystack is NGN-only here: a GBP request still takes donations — converted to NGN at the admin rate and charged in NGN
    const gbp = await liveFundraiser('walt');
    const gd = await call('uche', 'POST', `/f/${gbp.slug}/donations`, { amount_minor: 1000, email: 'u@example.com' }, {}, E);
    assert.equal(gd.status, 201, JSON.stringify(gd.json));
    const gr = await donationRow(gd.json.donationId);
    assert.deepEqual([gr.original_currency, Number(gr.original_amount_minor), gr.charge_currency, Number(gr.charge_amount_minor), gr.currency], ['GBP', 1000, 'NGN', 1000 * FM.FX_SEED.GBP, 'NGN']);
    assert.equal((await call('uche', 'POST', `/f/${gbp.slug}/donations`, { amount_minor: 1000, currency: 'JPY', email: 'u@example.com' }, {}, E)).json.code, 'CURRENCY_NOT_SUPPORTED');
    // testers can make test donations even when Paystack is on; others can't
    const TE = penv({ WALLET_TEST_PURCHASES: 'true', WALLET_TESTERS: 'tessa' });
    const td = await call('tessa', 'POST', `/f/${NG.slug}/donations`, { amount_minor: 100000, provider: 'test' }, {}, TE);
    assert.deepEqual([td.status, td.json.provider, td.json.test], [201, 'test', true]);
    assert.equal((await call('uche', 'POST', `/f/${NG.slug}/donations`, { amount_minor: 100000, provider: 'test' }, {}, TE)).json.code, 'TEST_DONATIONS_DISABLED');
  } finally { restore(); }
});

test('verify → hold → approve → payout needs a verified bank account → paid with reference; never more than held', async () => {
  // admin-only
  for (const path of ['/admin/api/fundme/donations', '/admin/api/fundme/payouts', '/admin/api/fundme/payout-queue', '/admin/api/fundme/reconciliation', '/admin/api/fundme/suspicious', '/admin/api/fundme/bank-accounts', '/admin/api/fundme/rules', `/admin/api/fundme/donations/${D1}`]) {
    assert.equal((await call('uche', 'GET', path)).status, 403, path);
  }
  assert.equal((await call('uche', 'POST', `/admin/api/fundme/donations/${D1}/verify`)).status, 403);
  assert.equal((await call('uche', 'POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).status, 403);
  assert.equal((await call('zed', 'GET', `/fundme/fundraisers/${NG.id}/money`)).status, 403);
  // forbidden transition over HTTP
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D1}/approve`)).json.code, 'BAD_STATUS');
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D1}/verify`)).json.donation.status, 'verified');
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D1}/approve`)).json.code, 'ON_HOLD', 'default 7-day hold');
  await setRule('fundme_payout_hold_days', 0);
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D1}/approve`)).json.donation.status, 'approved_for_payout');
  const det = (await adm('GET', `/admin/api/fundme/donations/${D1}`)).json;
  assert.deepEqual(det.history.map((e) => e.to), ['pending', 'processing', 'verified', 'approved_for_payout']);
  assert.equal(det.history[2].actor, 'admin');
  assert.ok(det.ledger.some((e) => e.ref === `donation:${D1}` && e.wallet === 'donations_held_ngn' && e.amount === 500000));
  assert.ok((await env.__db.query(`SELECT 1 FROM admin_actions WHERE action = 'fundme.donation.verify' AND target_id = $1`, [D1])).length === 1);
  // donations list filters
  assert.ok((await adm('GET', `/admin/api/fundme/donations?q=${D1}`)).json.items.length === 1);
  assert.ok((await adm('GET', `/admin/api/fundme/donations?beneficiary=${await idOf('nkem')}&status=approved_for_payout`)).json.items.every((x) => x.status === 'approved_for_payout'));
  assert.match((await adm('GET', '/admin/api/fundme/donations?format=csv')).text, /^created_at,donation_id,reference/);
  // payouts need a verified bank account
  assert.equal((await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.code, 'NO_PAYOUT_ACCOUNT');
  assert.equal((await call('nkem', 'PUT', '/fundme/payout-account', { bankCode: '058', accountNumber: '12345', accountName: 'Nkem Obi' })).json.code, 'BAD_ACCOUNT_NUMBER');
  const acct = await call('nkem', 'PUT', '/fundme/payout-account', { bankCode: '058', accountNumber: '0123456789', accountName: 'Nkem Obi' });
  assert.equal(acct.status, 200, JSON.stringify(acct.json));
  assert.deepEqual([acct.json.account.status, acct.json.account.accountNumberMasked, acct.json.account.bankName], ['pending_review', '•••• 6789', 'Guaranty Trust Bank']);
  assert.ok(!JSON.stringify(acct.json).includes('0123456789'), 'full number never returned to the app');
  const stored = (await env.__db.query('SELECT account_number_enc FROM fundme_bank_accounts WHERE user_id = $1', [await idOf('nkem')]))[0].account_number_enc;
  assert.ok(stored.startsWith('v1:') && !stored.includes('0123456789'), 'encrypted at rest');
  assert.equal((await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.code, 'NO_PAYOUT_ACCOUNT', 'pending review');
  const nkemId = await idOf('nkem');
  assert.equal((await adm('POST', `/admin/api/fundme/bank-accounts/${nkemId}/verify`)).json.account.status, 'verified');
  assert.equal((await adm('POST', `/admin/api/fundme/bank-accounts/${nkemId}/reveal`)).json.accountNumber, '0123456789');
  assert.ok((await env.__db.query(`SELECT 1 FROM admin_actions WHERE action = 'fundme.bank.reveal'`)).length === 1, 'reveals are logged');
  // payout KYC: no payout until the beneficiary's identity check is approved
  assert.equal((await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.code, 'KYC_REQUIRED');
  await approvedKyc('nkem');
  // minimum payout
  await setRule('fundme_min_payout_minor', { NGN: 100000000, GBP: 1000, USD: 1000, EUR: 1000 });
  assert.equal((await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.code, 'BELOW_MINIMUM');
  await setRule('fundme_min_payout_minor', { NGN: 100000, GBP: 1000, USD: 1000, EUR: 1000 });
  // can't promise more than is held: a payout already promising the held money blocks a new one
  const held = await bal('nkem', 'donations_held_ngn');
  await env.__db.query(`INSERT INTO fundme_payouts (id, beneficiary_id, fundraiser_id, amount_minor, currency, status) VALUES ('11111111-1111-4111-8111-111111111111', $1, $2, $3, 'NGN', 'approved')`, [nkemId, NG.id, held]);
  assert.equal((await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.code, 'EXCEEDS_HELD');
  // and the ledger itself refuses to pay out more than is held
  await env.__db.query(`UPDATE fundme_payouts SET amount_minor = $2 WHERE id = $1`, ['11111111-1111-4111-8111-111111111111', held + 1]);
  const over = await adm('POST', '/admin/api/fundme/payouts/11111111-1111-4111-8111-111111111111/paid', { reference: 'BANK-OVER-1' });
  assert.deepEqual([over.status, over.json.code], [402, 'INSUFFICIENT_BALANCE']);
  assert.equal(await bal('nkem', 'donations_held_ngn'), held, 'nothing moved');
  assert.equal((await adm('POST', '/admin/api/fundme/payouts/11111111-1111-4111-8111-111111111111/fail', { reason: 'Test row' })).json.payout.status, 'failed');
  // queue → create payout
  const queue = (await adm('GET', '/admin/api/fundme/payout-queue')).json.items.find((x) => x.fundraiserId === NG.id && !x.test);
  assert.deepEqual([queue.readyMinor, queue.bank.status], [500000, 'verified']);
  const cp = await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id });
  assert.equal(cp.status, 201, JSON.stringify(cp.json));
  const P = cp.json.payout;
  assert.deepEqual([P.amountMinor, P.status, P.donations, P.bank.last4], [500000, 'approved', 1, '6789']);
  assert.equal((await donationRow(D1)).payout_id, P.id);
  assert.equal((await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.code, 'NOTHING_TO_PAY');
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D1}/refund`, { reason: 'Donor asked' })).json.code, 'BAD_STATUS', 'in a payout');
  // bank details change → unpaid payout goes under review
  await call('nkem', 'PUT', '/fundme/payout-account', { bankCode: '044', accountNumber: '9876543210', accountName: 'Nkem Obi' });
  assert.equal((await adm('GET', `/admin/api/fundme/payouts/${P.id}`)).json.payout.status, 'under_review');
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${P.id}/paid`, { reference: 'GTB-1' })).json.code, 'BAD_STATUS');
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${P.id}/clear`)).json.code, 'NO_PAYOUT_ACCOUNT');
  await adm('POST', `/admin/api/fundme/bank-accounts/${nkemId}/verify`);
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${P.id}/clear`)).json.code, 'KYC_BANK_MISMATCH', 'the new account wasn’t checked in KYC');
  await approvedKyc('nkem', { bankCode: '044', accountNumber: '9876543210' });
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${P.id}/clear`)).json.payout.status, 'approved');
  // mark paid with the bank reference
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${P.id}/paid`, {})).json.code, 'REFERENCE_REQUIRED');
  const heldBefore = await bal('nkem', 'donations_held_ngn');
  const paidBefore = await bal('nkem', 'donations_paid_ngn');
  const paid = await adm('POST', `/admin/api/fundme/payouts/${P.id}/paid`, { reference: 'ACCESS-TRX-0001' });
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  assert.deepEqual([paid.json.payout.status, paid.json.payout.reference], ['paid', 'ACCESS-TRX-0001']);
  assert.deepEqual([await bal('nkem', 'donations_held_ngn'), await bal('nkem', 'donations_paid_ngn')], [heldBefore - 500000, paidBefore + 500000]);
  assert.equal((await donationRow(D1)).settlement_status, 'paid');
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${P.id}/paid`, { reference: 'ACCESS-TRX-0002' })).json.code, 'BAD_STATUS', 'paid once');
  assert.ok((await call('nkem', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'fundme_payout' && /ACCESS-TRX-0001/.test(n.body)));
  assert.ok((await call('uche', 'GET', `/fundme/donations/${D1}/receipt`)).json.timeline.some((e) => e.to === 'paid'));
  // organiser money view
  const mv = (await call('nkem', 'GET', `/fundme/fundraisers/${NG.id}/money`)).json;
  assert.equal(mv.totals.paidMinor, 500000);
  assert.deepEqual(mv.payouts.find((p) => p.id === P.id).timeline.map((e) => e.to), ['approved', 'under_review', 'approved', 'paid']);
  assert.equal(mv.bankAccount.accountNumberMasked, '•••• 3210');
});

test('refunds, fees on donations, failed payouts, test payouts and reconciliation totals', async () => {
  // refund of a received (under review) donation: held and the request total go down
  const d2 = await donationRow(D2);
  const held = await bal('nkem', 'donations_held_ngn');
  const raised = (await call(null, 'GET', `/f/${NG.slug}.json`)).json.raisedMinor;
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D2}/refund`, {})).json.code, 'REASON_REQUIRED');
  const rf = await adm('POST', `/admin/api/fundme/donations/${D2}/refund`, { reason: 'Amount mismatch — returned to donor' });
  assert.equal(rf.json.donation.status, 'refunded');
  assert.equal(await bal('nkem', 'donations_held_ngn'), held - Number(d2.net_minor));
  assert.equal((await call(null, 'GET', `/f/${NG.slug}.json`)).json.raisedMinor, raised - 400000);
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D2}/refund`, { reason: 'again' })).json.code, 'BAD_STATUS');
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${D1}/refund`, { reason: 'after payout' })).json.code, 'BAD_STATUS', 'no refund after payout');
  // fees: 2.5% + ₦100 per donation → BibleNestra commission ledger, net held for the beneficiary; refunded with the donation
  await setRule('fundme_fee_bps', 250);
  await setRule('fundme_fee_fixed_minor', { NGN: 10000, GBP: 0, USD: 0, EUR: 0 });
  const com0 = await bal('platform', 'commission_ngn');
  const fd = await call('yemi', 'POST', `/f/${NG.slug}/donations`, { amount_minor: 1000000 });
  assert.deepEqual([fd.json.feeMinor, fd.json.netMinor], [35000, 965000]);
  await webhook(fd.json.checkoutUrl.split('/pay/test/')[1], 'succeeded');
  assert.equal(await bal('platform', 'commission_ngn'), com0 + 35000);
  const fr = await donationRow(fd.json.donationId);
  assert.deepEqual([Number(fr.fee_minor), Number(fr.net_minor), fr.is_test], [35000, 965000, true]);
  await adm('POST', `/admin/api/fundme/donations/${fd.json.donationId}/refund`, { reason: 'Fee test refund' });
  assert.equal(await bal('platform', 'commission_ngn'), com0);
  await setRule('fundme_fee_bps', 0);
  await setRule('fundme_fee_fixed_minor', { NGN: 0, GBP: 0, USD: 0, EUR: 0 });
  // a never-paid donation is failed, not refunded
  const pend = await call('yemi', 'POST', `/f/${NG.slug}/donations`, { amount_minor: 100000 });
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${pend.json.donationId}/refund`, { reason: 'x y z' })).json.code, 'BAD_STATUS');
  assert.equal((await adm('POST', `/admin/api/fundme/donations/${pend.json.donationId}/fail`, { reason: 'Abandoned checkout' })).json.donation.status, 'failed');
  // test donations only go into test payouts; a failed payout puts its donations back in the queue
  const td = await call('yemi', 'POST', `/f/${NG.slug}/donations`, { amount_minor: 200000 });
  await webhook(td.json.checkoutUrl.split('/pay/test/')[1], 'succeeded');
  await adm('POST', `/admin/api/fundme/donations/${td.json.donationId}/verify`);
  await adm('POST', `/admin/api/fundme/donations/${td.json.donationId}/approve`);
  assert.equal((await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.code, 'NOTHING_TO_PAY', 'real payout ignores test money');
  const tp = (await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id, test: true })).json.payout;
  assert.deepEqual([tp.test, tp.amountMinor], [true, 200000]);
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${tp.id}/transfer`)).json.code, 'AUTO_PAYOUTS_OFF');
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${tp.id}/fail`, {})).json.code, 'REASON_REQUIRED');
  assert.equal((await adm('POST', `/admin/api/fundme/payouts/${tp.id}/fail`, { reason: 'Bank rejected the account' })).json.payout.status, 'failed');
  const back = await donationRow(td.json.donationId);
  assert.deepEqual([back.settlement_status, back.payout_id], ['approved_for_payout', null]);
  assert.ok((await call('nkem', 'GET', '/me/notifications')).json.items.some((n) => n.kind === 'fundme_payout' && /didn’t go through/.test(n.title) && /still held/.test(n.body)));
  // reconciliation: received = held + paid + fees + refunded, matching the ledger
  const rec = (await adm('GET', '/admin/api/fundme/reconciliation')).json;
  assert.equal(rec.ok, true, JSON.stringify(rec.currencies));
  assert.equal(rec.integrity.ok, true);
  const ngn = rec.currencies.find((x) => x.currency === 'NGN');
  assert.equal(ngn.receivedMinor, ngn.heldMinor + ngn.paidMinor + ngn.feesMinor + ngn.refundedMinor);
  assert.deepEqual([ngn.ledger.heldMinor, ngn.ledger.paidMinor, ngn.ledger.feesMinor], [ngn.heldMinor, ngn.paidMinor, ngn.feesMinor]);
  assert.ok(ngn.paidMinor >= 500000 && ngn.refundedMinor >= 400000 + 1000000);
  const one = rec.perRequest.find((x) => x.fundraiserId === NG.id);
  assert.ok(one.balanced);
  assert.equal(one.paidMinor, 500000);
  const only = (await adm('GET', `/admin/api/fundme/reconciliation?fundraiserId=${NG.id}`)).json;
  assert.equal(only.ok, true, JSON.stringify(only.currencies));
  assert.match((await adm('GET', '/admin/api/fundme/reconciliation?format=csv')).text, /^request_id,title/);
});

test('automatic payouts via Paystack Transfer (FUNDME_AUTO_PAYOUTS) settle on the signed transfer webhook', async () => {
  const restore = mockPaystack();
  try {
    const E = penv({ FUNDME_AUTO_PAYOUTS: 'true' });
    const id = await paystackDonation('zara', NG, 300000);
    paystack.verify[id] = { status: 'success', amount: 300000 };
    await hook(charge(id));
    await adm('POST', `/admin/api/fundme/donations/${id}/verify`);
    await adm('POST', `/admin/api/fundme/donations/${id}/approve`);
    const p = (await adm('POST', '/admin/api/fundme/payouts', { fundraiserId: NG.id })).json.payout;
    assert.equal((await adm('POST', `/admin/api/fundme/payouts/${p.id}/transfer`)).json.code, 'AUTO_PAYOUTS_OFF', 'off by default');
    const t = await call('admin', 'POST', `/admin/api/fundme/payouts/${p.id}/transfer`, undefined, {}, E);
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.equal(t.json.payout.status, 'processing');
    assert.deepEqual([paystack.transfers[0].reference, paystack.transfers[0].amount, paystack.transfers[0].recipient], [p.id, 300000, 'RCP_test1']);
    const ev = { event: 'transfer.success', data: { reference: p.id, transfer_code: 'TRF_test1', amount: 300000 } };
    assert.equal((await hook(ev, 'bad', E)).status, 400);
    assert.equal((await hook(ev, undefined, E)).status, 200);
    assert.equal((await hook(ev, undefined, E)).json.ignored, true, 'replay ignored');
    const done = (await adm('GET', `/admin/api/fundme/payouts/${p.id}`)).json.payout;
    assert.deepEqual([done.status, done.reference], ['paid', 'TRF_test1']);
    assert.equal((await donationRow(id)).settlement_status, 'paid');
    // bank list + name resolve come from Paystack when keys exist
    assert.equal((await call('zara', 'GET', '/fundme/banks', undefined, {}, E)).json.source, 'paystack');
    assert.equal((await call('zara', 'POST', '/fundme/payout-account/resolve', { bankCode: '058', accountNumber: '0123456789' }, {}, E)).json.accountName, 'NKEM OBI');
    assert.equal((await call('zara', 'POST', '/fundme/payout-account/resolve', { bankCode: '058', accountNumber: '0123456789' })).json.resolved, false, 'without keys: typed name, checked by staff');
    assert.equal((await adm('GET', '/admin/api/fundme/reconciliation')).json.ok, true);
  } finally { restore(); }
});

test('Paystack test keys (sk_test_…) mark donations as test money, never real', async () => {
  const restore = mockPaystack();
  try {
    const fr = await liveFundraiser('nkem', { currency: 'NGN', goalMinor: 20000000 });
    const E = penv({ PAYSTACK_SECRET_KEY: PSK_TEST });
    const d = await call('uche', 'POST', `/f/${fr.slug}/donations`, { amount_minor: 300000, email: 'uche@example.com' }, {}, E);
    assert.equal(d.status, 201, JSON.stringify(d.json));
    assert.equal(d.json.test, true);
    assert.equal((await donationRow(d.json.donationId)).is_test, true);
    const live = await call('uche', 'POST', `/f/${fr.slug}/donations`, { amount_minor: 300000, email: 'uche@example.com' }, {}, penv());
    assert.equal((await donationRow(live.json.donationId)).is_test, false, 'live keys stay real');
  } finally { restore(); }
});

// =====================================================================================================================
// CLIENT ANSWERS (2026-11-21): defaults, fees + VAT, any currency, payout KYC, monthly payouts, no refunds to donors
// =====================================================================================================================
import * as KYC from '../src/lib/kyc.js';
const DEF = Object.fromEntries(Object.entries(FM.FUNDME_RULES).map(([k, r]) => [k, r.dflt]));

test('client-answer defaults: hold 7 days, no publishing limits, gift cap 500, 2% fee, monthly payouts on day 1', () => {
  assert.deepEqual([DEF.fundme_payout_hold_days, DEF.fundme_max_requests_per_day, DEF.fundme_max_requests_per_month, DEF.fundme_max_active_requests], [7, 0, 0, 0]);
  assert.deepEqual([DEF.fundme_credit_gift_max, DEF.fundme_fee_bps], [500, 200]);
  assert.match(FM.FUNDME_RULES.fundme_fee_bps.label, /200 = 2%/);
  assert.deepEqual([DEF.fundme_paystack_fee_bps, DEF.fundme_paystack_fee_flat_minor, DEF.fundme_paystack_fee_flat_from_minor, DEF.fundme_paystack_fee_cap_minor, DEF.fundme_vat_bps], [150, 10000, 250000, 200000, 750]);
  assert.deepEqual(DEF.fundme_payout_schedule, { mode: 'monthly', day: 1 });
  for (const c of ['USD', 'GBP', 'EUR', 'CAD', 'GHS', 'KES', 'ZAR']) assert.ok(DEF.fundme_fx_ngn_per_unit[c] > 0, c);
  assert.match(FM.FUNDME_RULES.fundme_fx_ngn_per_unit.label, /OVERWRITTEN on the next refresh/); assert.equal(DEF.fundme_fx_auto, true);
});

test('fee maths: fees taken from the gift, or covered by the donor (beneficiary gets the full gift)', () => {
  const D20 = { ...DEF, fundme_fee_bps: 20 }; // the maths below was worked out at 0.2%; the live default is now 2%
  // ₦10,000, not covered: 0.2% = ₦20 · Paystack 1.5% + ₦100 = ₦250 · VAT 7.5% of ₦270 = ₦20.25
  const out = FM.feeBreakdown(D20, 1000000, { coverFees: false });
  assert.deepEqual([out.platformFeeMinor, out.processingFeeMinor, out.vatMinor, out.totalMinor, out.netMinor], [2000, 25000, 2025, 1000000, 970975]);
  // ₦10,000, covered: the donor pays ₦10,295.01 and the beneficiary gets exactly ₦10,000
  const cov = FM.feeBreakdown(D20, 1000000, { coverFees: true });
  assert.deepEqual([cov.totalMinor, cov.netMinor, cov.platformFeeMinor, cov.processingFeeMinor, cov.vatMinor], [1029501, 1000000, 2000, 25443, 2058]);
  assert.equal(cov.processingFeeMinor, FM.processingFeeEstimate(D20, cov.totalMinor), 'the Paystack fee is on what is actually charged');
  assert.equal(cov.vatMinor, FM.vatOn(D20, cov.platformFeeMinor + cov.processingFeeMinor));
  // no ₦100 flat fee under ₦2,500; the ₦2,000 cap on big gifts
  assert.equal(FM.processingFeeEstimate(D20, 249999), 3750);
  assert.equal(FM.processingFeeEstimate(D20, 250000), 3750 + 10000);
  assert.equal(FM.processingFeeEstimate(D20, 50000000), 200000);
  const big = FM.feeBreakdown(D20, 50000000, { coverFees: true });
  assert.deepEqual([big.processingFeeMinor, big.netMinor], [200000, 50000000]);
  assert.equal(big.totalMinor, 50000000 + 100000 + 200000 + FM.vatOn(D20, 300000));
  // covering crosses the ₦2,500 threshold: the flat fee is included, the beneficiary still gets the gift
  const edge = FM.feeBreakdown(D20, 247000, { coverFees: true });
  assert.ok(edge.totalMinor >= 250000 && edge.netMinor === 247000 && edge.processingFeeMinor === FM.processingFeeEstimate(D20, edge.totalMinor));
  // every covered gift from ₦5 to ₦100,000: net === gift and total = gift + fees
  for (let g = 500; g <= 10000000; g = Math.ceil(g * 1.37) + 7) {
    const b = FM.feeBreakdown(D20, g, { coverFees: true });
    assert.equal(b.netMinor, g, `gift ${g}`);
    assert.equal(b.totalMinor, g + b.feesMinor, `gift ${g}`);
  }
  // fees switched off → nothing changes
  const zero = FM.feeBreakdown({ ...D20, fundme_fee_bps: 0, fundme_paystack_fee_bps: 0, fundme_paystack_fee_flat_minor: 0, fundme_vat_bps: 0 }, 123456, { coverFees: true });
  assert.deepEqual([zero.totalMinor, zero.netMinor, zero.feesMinor], [123456, 123456, 0]);
});

test('currency conversion: charge in the donor’s currency when Paystack lists it, else NGN at the admin rate', () => {
  // $20 to an NGN request, Paystack NGN-only → converted at ₦1,500 and charged in NGN; both amounts kept
  const a = FM.donationQuote(DEF, { amountMinor: 2000, currency: 'USD', coverFees: false, chargeCurrencies: ['NGN'], fundraiserCurrency: 'NGN' });
  assert.deepEqual([a.giftNgnMinor, a.chargeCurrency, a.chargeAmountMinor, a.converted, a.fxRate, a.chargeFxRate], [3000000, 'NGN', 3000000, true, 1500, 1]);
  assert.equal(a.netMinor, 3000000 - a.feesMinor);
  assert.equal(a.raisedMinor, 3000000, 'NGN request counts the gift in NGN');
  // a GBP request counts the gift in GBP (3,000,000 kobo / 1950)
  assert.equal(FM.donationQuote(DEF, { amountMinor: 2000, currency: 'USD', coverFees: false, fundraiserCurrency: 'GBP' }).raisedMinor, Math.round(3000000 / 1950));
  // same currency as the request → the gift itself
  assert.equal(FM.donationQuote(DEF, { amountMinor: 2000, currency: 'GBP', coverFees: true, fundraiserCurrency: 'GBP' }).raisedMinor, 2000);
  // USD listed in PAYSTACK_CURRENCIES → charged in USD (rounded UP when covering), settled ≥ the NGN total
  const u = FM.donationQuote(DEF, { amountMinor: 2000, currency: 'USD', coverFees: true, chargeCurrencies: ['NGN', 'USD'], fundraiserCurrency: 'NGN' });
  assert.equal(u.chargeCurrency, 'USD');
  assert.equal(u.chargeAmountMinor, Math.ceil(FM.feeBreakdown(DEF, 3000000, { coverFees: true }).totalMinor / 1500));
  assert.ok(u.totalNgnMinor === u.chargeAmountMinor * 1500 && u.netMinor >= 3000000);
  assert.equal(FM.donationQuote(DEF, { amountMinor: 2000, currency: 'USD', coverFees: false, chargeCurrencies: ['NGN', 'USD'] }).chargeAmountMinor, 2000, 'not covering: charged exactly the gift');
  // KES (not in Paystack's list here) → NGN; JPY (no rate) → refused
  const k = FM.donationQuote(DEF, { amountMinor: 100000, currency: 'KES', coverFees: true });
  assert.deepEqual([k.chargeCurrency, k.giftNgnMinor, k.netMinor], ['NGN', Math.round(100000 * 11.6), Math.round(100000 * 11.6)]);
  assert.throws(() => FM.donationQuote(DEF, { amountMinor: 1000, currency: 'JPY', coverFees: false }), (e) => e.code === 'CURRENCY_NOT_SUPPORTED');
  assert.equal(FM.toNgnMinor(DEF, 1000, 'GBP'), 1950000);
  assert.equal(FM.fromNgnMinor(DEF, 1950001, 'GBP', { up: true }), 1001);
  // limits / presets for a currency without its own rules come from NGN's
  const r = FM.donorCurrencyRules(DEF, 'ZAR', { NGN: { min: 50000, max: 500000000, presets: [200000, 500000] } });
  assert.ok(r.min > 0 && r.max > r.min && r.presets.every((p) => p >= 100));
});

test('donating in USD with cover-the-fees: breakdown stored, Paystack charged in USD, verified amount checked, NGN ledger', async () => {
  const restore = mockPaystack();
  try {
    await setRule('fundme_fee_bps', 20); await setRule('fundme_paystack_fee_bps', 150); await setRule('fundme_paystack_fee_flat_minor', 10000); await setRule('fundme_vat_bps', 750);
    const fr = await liveFundraiser('osas', { currency: 'NGN', goalMinor: 90000000 });
    const E = penv({ PAYSTACK_CURRENCIES: 'NGN,USD' });
    const info = (await call('pia', 'GET', `/f/${fr.slug}.json`, undefined, {}, E)).json;
    assert.equal(info.donationsOpen, true);
    assert.equal(info.coverFeesDefault, true);
    assert.match(info.refundPolicy, /non-refundable/);
    assert.equal(info.donorCurrencies.find((x) => x.code === 'USD').chargedIn, 'USD');
    assert.equal(info.donorCurrencies.find((x) => x.code === 'GBP').chargedIn, 'NGN');
    const qt = (await call(null, 'GET', `/f/${fr.slug}/donation-quote?amountMinor=2000&currency=USD&coverFees=true`, undefined, {}, E)).json;
    assert.deepEqual([qt.chargeCurrency, qt.netMinor, qt.ok], ['USD', qt.totalNgnMinor - qt.feesMinor, true]);
    assert.ok(qt.netMinor >= 3000000);
    const r = await call('pia', 'POST', `/f/${fr.slug}/donations`, { amount_minor: 2000, currency: 'USD', coverFees: true, email: 'pia@example.com' }, {}, E);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const id = r.json.donationId;
    assert.deepEqual([paystack.initialized[id].currency, paystack.initialized[id].amount], ['USD', qt.chargeAmountMinor]);
    let row = await donationRow(id);
    assert.deepEqual([row.original_currency, Number(row.original_amount_minor), Number(row.fx_rate), row.charge_currency, Number(row.charge_amount_minor), row.cover_fees, row.currency],
      ['USD', 2000, 1500, 'USD', qt.chargeAmountMinor, true, 'NGN']);
    assert.deepEqual([Number(row.fee_minor), Number(row.processing_fee_minor), Number(row.vat_minor), Number(row.net_minor)], [qt.platformFeeMinor, qt.processingFeeMinor, qt.vatMinor, qt.netMinor]);
    // verification checks the amount actually charged, in the charged currency
    paystack.verify[id] = { status: 'success', amount: qt.chargeAmountMinor, currency: 'USD' };
    const held0 = await bal('osas', 'donations_held_ngn');
    const com0 = await bal('platform', 'commission_ngn');
    await hook(charge(id), undefined, E);
    row = await donationRow(id);
    assert.deepEqual([row.settlement_status, Number(row.charge_amount_minor)], ['processing', qt.chargeAmountMinor]);
    assert.equal(await bal('osas', 'donations_held_ngn'), held0 + qt.netMinor, 'the beneficiary is held the full gift (NGN)');
    assert.equal(await bal('platform', 'commission_ngn'), com0 + qt.platformFeeMinor, 'only the BibleNestra fee is commission');
    assert.equal((await call(null, 'GET', `/f/${fr.slug}.json`, undefined, {}, E)).json.raisedMinor, 3000000);
    // receipt + admin show the breakdown and both currencies
    const rc = (await call('pia', 'GET', `/fundme/donations/${id}/receipt`)).json;
    assert.deepEqual([rc.original.currency, rc.charged.currency, rc.fees.vatMinor, rc.coverFees], ['USD', 'USD', qt.vatMinor, true]);
    assert.ok(rc.breakdown.some((l) => /VAT/.test(l.label)) && /non-refundable/.test(rc.refundPolicy) && /non-refundable/.test(rc.note));
    const ad = (await adm('GET', `/admin/api/fundme/donations/${id}`)).json.donation;
    assert.deepEqual([ad.fees.processingMinor, ad.original.amountMinor, ad.charged.amountMinor], [qt.processingFeeMinor, 2000, qt.chargeAmountMinor]);
    // charged in the wrong currency → under review, nothing recorded
    const id2 = (await call('pia', 'POST', `/f/${fr.slug}/donations`, { amount_minor: 2000, currency: 'USD', email: 'pia@example.com' }, {}, E)).json.donationId;
    paystack.verify[id2] = { status: 'success', amount: 2000, currency: 'NGN' };
    await hook(charge(id2), undefined, E);
    assert.deepEqual([(await donationRow(id2)).settlement_status, (await donationRow(id2)).received_at], ['under_review', null]);
    // not covered, GBP converted to NGN: the fees come out of the gift
    const id3 = (await call('pia', 'POST', `/f/${fr.slug}/donations`, { amount_minor: 1000, currency: 'GBP', email: 'pia@example.com' }, {}, E)).json.donationId;
    const r3 = await donationRow(id3);
    const b3 = FM.feeBreakdown(await W.getConfig(env), 1950000, { coverFees: false });
    assert.deepEqual([r3.charge_currency, Number(r3.charge_amount_minor), Number(r3.net_minor), r3.cover_fees], ['NGN', 1950000, b3.netMinor, false]);
    // refunds stay admin-only: the donor has no refund route
    assert.ok([403, 404, 405].includes((await call('pia', 'POST', `/fundme/donations/${id}/refund`, {})).status));
    assert.equal((await call('pia', 'POST', `/admin/api/fundme/donations/${id}/refund`, { reason: 'please' })).status, 403);
  } finally { await zeroFees(); restore(); }
});

test('payout KYC: fuzzy name match, encrypted ID, staff approval, and the payout guard', async () => {
  const m = KYC.namesMatch;
  assert.ok(m('Nkem Obi', 'OBI NKEM'), 'any order, any case');
  assert.ok(m('Nkem Adaeze Obi', 'OBI, NKEM'), 'middle name ignored');
  assert.ok(m('Nkem Obi', 'OBI NKEM ADAEZE'));
  assert.ok(m('Nkem Adaeze Obi', 'Nkem Chioma Obi'), 'different middle names');
  assert.ok(m('Mrs. Ngozi Okonjo-Iweala', 'OKONJO IWEALA NGOZI'), 'titles and punctuation ignored');
  assert.ok(m('Chloé Dúbois', 'chloe dubois'), 'accents ignored');
  assert.ok(!m('Nkem Obi', 'Nkem Okafor'), 'different surname');
  assert.ok(!m('Nkem Obi', 'Obi'), 'one word is not enough');
  assert.ok(!m('John Smith', 'Jane Smith'));
  assert.ok(!m('John Paul Smith', 'John Peter Mark Smith Jones'));
  // guard
  const quin = await idOf('quincy');
  await assert.rejects(KYC.requireApprovedKyc(env, quin), (e) => e.code === 'KYC_REQUIRED' && e.details.kycStatus === 'none');
  assert.equal((await call('quincy', 'GET', '/payout-kyc')).json.kyc.status, 'none');
  // validation
  const put = (b, e) => call('quincy', 'PUT', '/payout-kyc', { idType: 'bvn', idNumber: '22233344455', legalName: 'Quincy Adams', bankCode: '058', accountNumber: '0011223344', accountName: 'Quincy Adams', ...b }, {}, e);
  assert.equal((await put({ idType: 'passport' })).json.code, 'BAD_ID_TYPE');
  assert.equal((await put({ idNumber: '123' })).json.code, 'BAD_ID_NUMBER');
  assert.equal((await put({ legalName: 'Quincy' })).json.code, 'BAD_LEGAL_NAME');
  assert.equal((await put({ accountName: 'Somebody Else' })).json.code, 'NAME_MISMATCH');
  // with Paystack keys the bank's own name is used: resolve-account says NKEM OBI → refused
  const restore = mockPaystack();
  try {
    const mm = await put({}, penv());
    assert.deepEqual([mm.status, mm.json.code, mm.json.accountName], [400, 'NAME_MISMATCH', 'NKEM OBI']);
  } finally { restore(); }
  const ok = await put({ accountName: 'ADAMS QUINCY' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.kyc.status, ok.json.kyc.idNumberMasked, ok.json.kyc.nameMatch], ['pending_review', '•••• 4455', true]);
  assert.ok(!JSON.stringify(ok.json).includes('22233344455') && !JSON.stringify(ok.json).includes('0011223344'));
  const stored = (await env.__db.query('SELECT id_number_enc FROM payout_kyc WHERE user_id = $1', [quin]))[0];
  assert.ok(stored.id_number_enc.startsWith('v1:') && !stored.id_number_enc.includes('22233344455'), 'ID number encrypted at rest');
  assert.equal(await FM.decryptField(env, stored.id_number_enc), '22233344455');
  assert.equal((await call('quincy', 'GET', '/fundme/payout-account')).json.account.last4, '3344', 'KYC keeps the Fund Me payout account in step');
  await assert.rejects(KYC.requireApprovedKyc(env, quin), (e) => e.code === 'KYC_REQUIRED' && e.details.kycStatus === 'pending_review');
  // staff only; reject needs a reason; approve verifies the same Fund Me account; reveals are logged
  assert.equal((await call('quincy', 'POST', `/admin/api/fundme/kyc/${quin}/approve`)).status, 403);
  assert.ok((await adm('GET', '/admin/api/fundme/kyc')).json.items.some((k) => k.userId === quin));
  assert.equal((await adm('POST', `/admin/api/fundme/kyc/${quin}/reject`, {})).json.code, 'REASON_REQUIRED');
  assert.equal((await adm('POST', `/admin/api/fundme/kyc/${quin}/reject`, { reason: 'Photo of ID unreadable' })).json.kyc.status, 'rejected');
  await assert.rejects(KYC.requireApprovedKyc(env, quin), (e) => e.details.kycStatus === 'rejected');
  await put({ accountName: 'ADAMS QUINCY' });
  const ap = (await adm('POST', `/admin/api/fundme/kyc/${quin}/approve`)).json;
  assert.deepEqual([ap.kyc.status, ap.bankVerified], ['approved', true]);
  assert.equal((await KYC.requireApprovedKyc(env, quin)).status, 'approved');
  assert.equal((await adm('POST', `/admin/api/fundme/kyc/${quin}/reveal`)).json.idNumber, '22233344455');
  assert.ok((await env.__db.query(`SELECT 1 FROM admin_actions WHERE action = 'kyc.reveal'`)).length === 1);
  assert.ok((await call('quincy', 'GET', '/me/notifications')).json.items.some((n) => /Identity check approved/.test(n.title)));
  // the payout guard: approved KYC AND the payout account is the KYC-checked one
  await FM.assertPayoutKyc(env, quin);
  await call('quincy', 'PUT', '/fundme/payout-account', { bankCode: '044', accountNumber: '5566778899', accountName: 'Quincy Adams' });
  await assert.rejects(FM.assertPayoutKyc(env, quin), (e) => e.code === 'KYC_BANK_MISMATCH');
});

test('monthly payouts: run dates, what is due, the cron approves once, staff mark paid by hand', async () => {
  // pure date logic (UTC): run on day 1; a donation is due in the first run on/after the end of its 7-day hold
  const cfg = { ...DEF };
  assert.equal(FM.nextRunDate(cfg, new Date('2026-11-21T10:00:00Z')).toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(FM.nextRunDate(cfg, new Date('2026-12-01T18:00:00Z')).toISOString(), '2026-12-01T00:00:00.000Z', 'the run day itself');
  assert.equal(FM.nextRunDate({ ...cfg, fundme_payout_schedule: { mode: 'monthly', day: 15 } }, new Date('2026-12-20T00:00:00Z')).toISOString(), '2027-01-15T00:00:00.000Z', 'over the year end');
  assert.ok(FM.dueInRun(cfg, new Date('2026-11-21T00:00:00Z'), new Date('2026-12-01T00:00:00Z')), 'hold ends Nov 28 → due Dec 1');
  assert.ok(!FM.dueInRun(cfg, new Date('2026-11-25T12:00:00Z'), new Date('2026-12-01T00:00:00Z')), 'hold ends Dec 2 → next run');
  assert.equal(FM.runForDonation(cfg, new Date('2026-11-25T12:00:00Z')).toISOString().slice(0, 10), '2027-01-01');
  assert.equal(FM.runForDonation(cfg, new Date('2026-11-24T00:00:00Z')).toISOString().slice(0, 10), '2026-12-01');
  assert.ok(!FM.dueInRun(cfg, null, new Date()));
  // HTTP: real (Paystack) donations for a new beneficiary
  const restore = mockPaystack();
  try {
    await setRule('fundme_payout_hold_days', 7);
    const fr = await liveFundraiser('rita', { currency: 'NGN', goalMinor: 90000000 });
    const ids = [];
    for (const amt of [400000, 250000, 300000]) {
      const id = await paystackDonation('sola', fr, amt);
      paystack.verify[id] = { status: 'success', amount: amt };
      await hook(charge(id));
      ids.push(id);
    }
    await adm('POST', `/admin/api/fundme/donations/${ids[0]}/verify`);
    await adm('POST', `/admin/api/fundme/donations/${ids[1]}/verify`);
    // ids[0] (verified) and ids[2] (still being checked) are past the hold; ids[1]'s hold ends long after the next run
    await env.__db.query(`UPDATE donations SET received_at = now() - interval '40 days' WHERE id = ANY($1::uuid[])`, [[ids[0], ids[2]]]);
    await env.__db.query(`UPDATE donations SET received_at = now() + interval '60 days' WHERE id = $1`, [ids[1]]);
    const due = (await adm('GET', '/admin/api/fundme/due')).json;
    assert.deepEqual([due.schedule, due.monthly, due.runDate], ['monthly', true, FM.nextRunDate(DEF).toISOString().slice(0, 10)]);
    let row = due.items.find((x) => x.fundraiserId === fr.id);
    assert.deepEqual([row.readyMinor, row.readyCount, row.checkingMinor, row.payable], [400000, 1, 300000, false]);
    assert.ok(row.blockers.includes('No KYC'));
    const tot = due.totals.find((t) => t.currency === 'NGN');
    assert.ok(tot.readyMinor >= 400000 && tot.checkingMinor >= 300000);
    assert.equal((await call('rita', 'GET', '/admin/api/fundme/due')).status, 403);
    // KYC + the same bank account → payable
    await approvedKyc('rita', { legalName: 'Rita Eze', accountNumber: '1029384756' });
    row = (await adm('GET', '/admin/api/fundme/due')).json.items.find((x) => x.fundraiserId === fr.id);
    assert.deepEqual([row.kycStatus, row.bank.status, row.payable], ['approved', 'verified', true]);
    // the cron claims the month's run once and approves what is verified and past its hold
    const run = await FM.runFundmePayoutCron(env);
    assert.ok(run.approved >= 1, JSON.stringify(run));
    assert.equal((await donationRow(ids[0])).settlement_status, 'approved_for_payout');
    assert.equal((await donationRow(ids[1])).settlement_status, 'verified', 'not past its hold');
    assert.deepEqual(await FM.runFundmePayoutCron(env), { skipped: 'done' });
    const ev = (await adm('GET', `/admin/api/fundme/donations/${ids[0]}`)).json.history.at(-1);
    assert.deepEqual([ev.actor, /monthly payout run/.test(ev.reason)], ['system', true]);
    // on-demand schedule: the cron does nothing
    await setRule('fundme_payout_schedule', { mode: 'on_demand', day: 1 });
    assert.deepEqual(await FM.runFundmePayoutCron(env), { skipped: 'on_demand' });
    await setRule('fundme_payout_schedule', { mode: 'monthly', day: 1 });
    assert.equal((await adm('PUT', '/admin/api/fundme/rules', { key: 'fundme_payout_schedule', value: { mode: 'weekly', day: 1 } })).json.code, 'BAD_CONFIG');
    assert.equal((await adm('PUT', '/admin/api/fundme/rules', { key: 'fundme_payout_schedule', value: { mode: 'monthly', day: 31 } })).json.code, 'BAD_CONFIG');
    // staff paid by hand → payout paid with the reference, donation paid, ledger moved
    assert.equal((await adm('POST', `/admin/api/fundme/due/${fr.id}/paid`, {})).json.code, 'REFERENCE_REQUIRED');
    const held = await bal('rita', 'donations_held_ngn');
    const pd = await adm('POST', `/admin/api/fundme/due/${fr.id}/paid`, { reference: 'GTB-RUN-0001' });
    assert.equal(pd.status, 200, JSON.stringify(pd.json));
    assert.deepEqual([pd.json.payout.status, pd.json.payout.reference, pd.json.payout.amountMinor], ['paid', 'GTB-RUN-0001', 400000]);
    assert.equal((await donationRow(ids[0])).settlement_status, 'paid');
    assert.equal(await bal('rita', 'donations_held_ngn'), held - 400000);
    assert.ok(!(await adm('GET', '/admin/api/fundme/due')).json.items.some((x) => x.fundraiserId === fr.id && x.readyMinor > 0));
    // the organiser sees the schedule and which run each held donation is in
    const mv = (await call('rita', 'GET', `/fundme/fundraisers/${fr.id}/money`)).json;
    assert.deepEqual([mv.rules.payoutSchedule, mv.kyc.status, mv.currency], ['monthly', 'approved', 'NGN']);
    assert.ok(mv.donations.find((x) => x.id === ids[1]).payoutRun);
    assert.match((await call('rita', 'GET', '/fundme/rules')).json.explain.join(' '), /once a month/);
    assert.equal((await adm('GET', '/admin/api/fundme/reconciliation')).json.ok, true);
  } finally { await setRule('fundme_payout_hold_days', 0); restore(); }
});

test('admin script stays a plain string with the new views', () => {
  assert.ok(!FUNDME_MONEY_ADMIN_SCRIPT.includes('`') && !FUNDME_MONEY_ADMIN_SCRIPT.includes('${'));
  for (const v of ['Due this run', 'KYC']) assert.ok(FUNDME_MONEY_ADMIN_SCRIPT.includes("'" + v + "'"), v);
});
