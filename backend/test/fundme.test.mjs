// FUND ME (round 3) — fundraisers, public page, donations through the TEST provider, admin review.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { hmacSha256Hex, verifyStripeSignature } from '../src/lib/payments.js';
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
async function makeAdmin(name) {
  await call(name, 'GET', '/me');
  await env.__db.query(`UPDATE users SET role = 'admin' WHERE clerk_id = $1`, [`dev_${name}`]);
}
// draft → submit → approve; returns the owner view
async function liveFundraiser(owner, extra = {}) {
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
  assert.deepEqual([closed.status, closed.json.code, closed.json.error], [503, 'DONATIONS_NOT_OPEN', 'Donations open soon']);
  const pj = (await call(null, 'GET', `/f/${f.slug}.json`, undefined, {}, off)).json;
  assert.equal(pj.donationsOpen, false);
  assert.match((await call(null, 'GET', `/f/${f.slug}`, undefined, {}, off)).text, /Donations open soon/);
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

test('Stripe webhook signature verification (provider not active without keys)', async () => {
  const secret = 'whsec_test_secret';
  const stripeEnv = { ...env, PAYMENTS_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: secret };
  const f = await liveFundraiser('olga');
  // owner hasn't onboarded to Stripe Connect → no checkout
  const no = await call(null, 'POST', `/f/${f.slug}/donations`, { amount_minor: 1000 }, { 'X-Forwarded-For': '10.7.7.7' }, stripeEnv);
  assert.equal(no.json.code, 'OWNER_NOT_ONBOARDED');
  // simulate a stripe donation row and a signed webhook
  await env.__db.query(`INSERT INTO donations (fundraiser_id, donor_name, amount_minor, currency, provider, provider_ref) VALUES ($1, 'Paula', 4200, 'GBP', 'stripe', 'cs_test_123')`, [f.id]);
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', payment_status: 'paid' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacSha256Hex(secret, `${t}.${payload}`);
  const send = (header) => app.fetch(new Request('http://api.test/webhooks/fundme/stripe', { method: 'POST', headers: { 'Stripe-Signature': header, 'Content-Type': 'application/json' }, body: payload }), stripeEnv);
  assert.equal((await send(`t=${t},v1=${'0'.repeat(64)}`)).status, 400);
  assert.equal((await send(`t=${t - 3600},v1=${sig}`)).status, 400, 'too old');
  const ok = await send(`t=${t},v1=${sig}`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).changed, true);
  assert.equal((await (await send(`t=${t},v1=${sig}`)).json()).changed, false, 'replay is idempotent');
  assert.equal((await call(null, 'GET', `/f/${f.slug}.json`)).json.raisedMinor, 4200);
  assert.equal(await verifyStripeSignature('{}', 'garbage', secret), false);
  // unconfigured → 503
  assert.equal((await call(null, 'POST', '/webhooks/fundme/stripe', {})).status, 503);
});

test('money formatting', () => {
  assert.equal(formatMoney(500000, 'GBP'), '£5,000');
  assert.equal(formatMoney(1050, 'USD'), '$10.50');
  assert.equal(formatMoney(2500000, 'NGN'), '₦25,000');
  assert.equal(formatMoney(99, 'EUR'), '€0.99');
});
