// PACKAGE E (Development Update v1): Fund Me gifts on a request (crediting, summary on the payload, guards) and the
// Opportunities full-detail mapping (descriptions to readable text, sections, hidden rows, the detail route).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import * as W from '../src/lib/wallet.js';
import { q, one } from '../src/lib/db.js';
import { richText, sectionsFrom, detailFields, httpUrl, parseRss } from '../src/lib/opportunities.js';
import { CONTEXTS, FUNDME_CONTEXT } from '../src/lib/virtualGifts.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', PAYMENTS_MODE: 'test' };
});
async function call(user, method, path, body, headers = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body instanceof Uint8Array || typeof body === 'string') b = body;
  else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b, redirect: 'manual' }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, text };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const STORY = [{ type: 'p', text: 'My mother needs surgery next month and the hospital bill is more than we can pay.' }];
const idOf = async (name) => (await call(name, 'GET', '/me')).json.id;
let n = 0;
const ikey = () => `pe_key_${Date.now()}_${++n}_${Math.random().toString(36).slice(2, 7)}`;
const bal = (u, w = 'gift_coins') => W.getBalance(env, ids[u], w);
const ids = {};
const seed = (u, wallet, amount) => W.credit(env, { ref: `pe_seed:${u}:${ikey()}`, userId: ids[u], wallet, amount, kind: 'admin_adjust' });

async function liveFundraiser(owner) {
  await call(owner, 'GET', '/me');
  ids[owner] = await idOf(owner);
  await seed(owner, 'fundme_credits', 1);
  const up = await call(owner, 'POST', '/uploads/image', PNG, { 'Content-Type': 'image/png' });
  const cr = await call(owner, 'POST', '/fundraisers', { title: 'Help Me Pay My Hospital Bill', goalMinor: 500000, currency: 'GBP', story: STORY, mainImageKey: up.json.key });
  assert.equal(cr.status, 201, JSON.stringify(cr.json));
  const sub = await call(owner, 'POST', `/fundraisers/${cr.json.id}/submit`);
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  return cr.json;
}
async function approve(id) {
  const ap = await call('boss', 'POST', `/admin/api/fundme/${id}/approve`);
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  return ap.json;
}
const sendFund = (u, fid, giftId = 'star', extra = {}) => call(u, 'POST', '/gifts/send', {
  giftId, context: { type: FUNDME_CONTEXT, id: fid }, idempotencyKey: extra.idempotencyKey || ikey(), ...extra,
});

let frA; // a live fundraiser owned by 'fia'
test('setup: admin, members and a live Fund Me request', async () => {
  await call('boss', 'GET', '/me');
  await env.__db.query(`UPDATE users SET role = 'admin' WHERE clerk_id = 'dev_boss'`);
  ids.boss = await idOf('boss');
  for (const u of ['gina', 'hal', 'ivy', 'jo']) { await call(u, 'GET', '/me'); ids[u] = await idOf(u); await seed(u, 'gift_coins', 5000); }
  frA = await liveFundraiser('fia');
  await approve(frA.id);
  assert.ok(CONTEXTS.includes('fundme'));
});

test('gift catalogue: every gift can be sent on a Fund Me request (context fundme)', async () => {
  const r = await call('gina', 'GET', '/gifts/catalogue?context=fundme');
  assert.equal(r.status, 200);
  assert.ok(r.json.items.some((g) => g.id === 'star'));
  assert.ok(r.json.items.every((g) => g.contexts.includes('fundme')));
});

test('a gift on a request is credited to its creator with the normal 20% commission and earnings hold', async () => {
  const star = (await call('gina', 'GET', '/gifts/catalogue')).json.items.find((g) => g.id === 'star');
  const before = { gina: await bal('gina'), fia: await bal('fia', 'gift_earnings') };
  const r = await sendFund('gina', frA.id, 'star', { idempotencyKey: 'pe_gift_one_0001' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const coins = star.coins;
  assert.equal(r.json.send.coins, coins);
  assert.equal(r.json.send.commission, Math.floor(coins * 20 / 100));
  assert.equal(r.json.send.earnings, coins - r.json.send.commission);
  assert.equal(r.json.send.context.type, 'fundme');
  assert.equal(r.json.send.recipient.id, ids.fia, 'the creator receives it');
  assert.equal(await bal('gina'), before.gina - coins, 'sender pays the gifting coins');
  assert.equal(await bal('fia', 'gift_earnings'), before.fia + r.json.send.earnings, 'creator earnings go to pending (on hold)');
  const rows = await q(env, `SELECT recipient_id, context_type, context_id, commission_bps FROM gift_sends WHERE context_type = 'fundme' AND context_id = $1`, [frA.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient_id, ids.fia);
  assert.equal(rows[0].commission_bps, 2000);
  const hold = await call('fia', 'GET', '/gifts/earnings');
  assert.equal(hold.json.balances.pending, r.json.send.earnings);
  assert.equal(hold.json.balances.available, 0);
});

test('a retried gift with the same key is charged once', async () => {
  const before = await bal('gina');
  const again = await sendFund('gina', frA.id, 'star', { idempotencyKey: 'pe_gift_one_0001' });
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
  assert.equal(await bal('gina'), before);
});

test('the request payload carries the gift summary: total, top gifts, recent givers', async () => {
  await sendFund('hal', frA.id, 'star', { idempotencyKey: 'pe_gift_hal_0001' });
  await sendFund('ivy', frA.id, 'heart', { idempotencyKey: 'pe_gift_ivy_0001' });
  const owner = await call('fia', 'GET', `/fundraisers/${frA.id}`);
  assert.equal(owner.status, 200);
  assert.equal(owner.json.gifts.total, 3);
  assert.equal(owner.json.gifts.topGifts[0].id, 'star');
  assert.equal(owner.json.gifts.topGifts[0].count, 2);
  assert.equal(owner.json.gifts.topGifts[1].id, 'heart');
  assert.equal(owner.json.gifts.recentGivers.length, 3);
  const giver = owner.json.gifts.recentGivers[0];
  assert.deepEqual(Object.keys(giver).sort(), ['avatarUrl', 'createdAt', 'displayName', 'gift']);
  assert.equal(typeof giver.displayName, 'string');
  assert.ok(!('id' in giver), 'givers are shown by name and picture only');
  // public page JSON carries the same summary
  const pub = await call(null, 'GET', `/f/${frA.slug}.json`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.gifts.total, 3);
});

test('guards: no self-gift, no gift to a draft or unknown request, recipient must be the creator', async () => {
  assert.equal((await sendFund('fia', frA.id)).json.code, 'SELF_GIFT');
  const draft = await liveFundraiser('kai');
  const r1 = await sendFund('gina', draft.id);
  assert.equal(r1.status, 404, 'drafts are not giftable');
  assert.equal((await sendFund('gina', '00000000-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await sendFund('gina', 'not-a-uuid')).status, 400);
  const wrong = await call('gina', 'POST', '/gifts/send', { giftId: 'star', context: { type: 'fundme', id: frA.id }, recipientId: ids.hal, idempotencyKey: ikey() });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.code, 'BAD_RECIPIENT');
});

test('summary and gifting are available only for public requests; the summary is empty without gifts', async () => {
  const fresh = await liveFundraiser('lee');
  await approve(fresh.id);
  const ok = await call('gina', 'GET', `/fundraisers/${fresh.id}`);
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.gifts.total, ok.json.gifts.topGifts, ok.json.gifts.recentGivers], [0, [], []]);
});

test('the catalogue rows allow fundme (the schema block backfilled the existing gifts)', async () => {
  const star = await one(env, 'SELECT contexts FROM gift_catalogue WHERE id = $1', ['star']);
  assert.ok(star.contexts.includes('fundme'));
});

// ---------------------------------------------------------------------------------------------------------------------
// Opportunities: field mapping (pure) and the detail route
// ---------------------------------------------------------------------------------------------------------------------
test('richText: HTML becomes readable text with paragraphs and bullet lists, entities decoded, no markup', () => {
  const html = '<h2>About the role</h2><p>We are hiring a <strong>Data</strong> analyst &amp; more.</p><p>Second&nbsp;paragraph.</p>' +
    '<ul><li>Build dashboards</li><li>Write SQL</li></ul><p>Apply by Friday.</p>';
  const t = richText(html);
  assert.ok(t.includes('About the role'));
  assert.ok(t.includes('We are hiring a Data analyst & more.'));
  assert.ok(t.includes('Second paragraph.'));
  assert.match(t, /• Build dashboards\n• Write SQL/);
  assert.ok(!/[<>]/.test(t), 'no tags left');
  assert.ok(t.split('\n\n').length >= 3, 'paragraphs are kept apart');
});

test('richText: entity-encoded markup is still markup; long text is cut at a paragraph and marked', () => {
  assert.equal(richText('&lt;p&gt;Hello &amp; welcome&lt;/p&gt;'), 'Hello & welcome');
  assert.equal(richText(null), null);
  const long = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} ${'word '.repeat(30)}</p>`).join('');
  const t = richText(long, 2000);
  assert.ok(t.length <= 2001 && t.endsWith('…'));
  assert.ok(!t.includes('Paragraph 39'), 'cut before the end');
});

test('sectionsFrom: responsibilities, qualifications and how-to-apply are pulled from headed sections', () => {
  const text = [
    'Intro line about us.',
    'Responsibilities',
    'Lead the data team',
    'Own reporting',
    'Qualifications:',
    '3 years of SQL',
    'How to apply',
    'Send your CV through the form.',
  ].join('\n');
  const s = sectionsFrom(text);
  assert.equal(s.responsibilities, 'Lead the data team\nOwn reporting');
  assert.equal(s.qualifications, '3 years of SQL');
  assert.equal(s.instructions, 'Send your CV through the form.');
  assert.deepEqual(sectionsFrom('Nothing headed here'), { responsibilities: null, qualifications: null, instructions: null });
});

test('detailFields: missing source data is null (rows hidden in the app), http links only', () => {
  const d = detailFields({ description: '', excerpt: 'Short', employment_type: null, logo_url: 'javascript:alert(1)', apply_url: null, url: 'https://jobs.example.com/1' });
  assert.equal(d.description, 'Short', 'falls back to the excerpt when there is no full text');
  assert.equal(d.employmentType, null);
  assert.equal(d.logoUrl, null, 'only http(s) logos');
  assert.equal(d.applyUrl, 'https://jobs.example.com/1', 'apply goes to the original listing when the source has no apply link');
  assert.equal(d.skills, null);
  assert.equal(httpUrl('ftp://x'), null);
  const full = detailFields({ description: '<p>Full text</p>', employment_type: 'Full-time', logo_url: 'https://cdn.example.com/l.png', apply_url: 'https://apply.example.com/x', url: 'https://u' });
  assert.equal(full.description, '<p>Full text</p>', 'detailFields keeps the stored text; richText runs at import');
  assert.equal(full.employmentType, 'Full-time');
  assert.equal(full.logoUrl, 'https://cdn.example.com/l.png');
  assert.equal(full.applyUrl, 'https://apply.example.com/x');
});

test('RSS adapter keeps the full description, not just the excerpt', () => {
  const xml = `<rss><channel><item><title>Analyst</title><link>https://org.example/job/1</link><guid>g1</guid>
    <description><![CDATA[<p>Full role text.</p><ul><li>Point one</li></ul>]]></description></item></channel></rss>`;
  const [item] = parseRss(xml, { org: 'Org' });
  assert.match(item.description, /Full role text\./);
  assert.match(item.description, /• Point one/);
  assert.ok(item.excerpt.includes('Full role text.'));
});

test('GET /opportunities/:id returns the full detail; hidden or unknown listings are not found', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  await env.__db.query(`INSERT INTO opportunities (id, source, source_id, kind, title, org, location, remote, url, excerpt, tags, description, employment_type, logo_url, apply_url, posted_at)
    VALUES ($1, 'remotive', 'pe-1', 'remote', 'Data Analyst', 'Acme', 'Lagos', true, 'https://acme.example/job/1', 'Short', '{}',
      $2, 'Full-time', 'https://cdn.example.com/acme.png', 'https://acme.example/apply/1', now())`, [id, richText('<p>Full description.</p><ul><li>SQL</li></ul>')]);
  const r = await call('gina', 'GET', `/opportunities/${id}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.title, 'Data Analyst');
  assert.match(r.json.description, /^Full description\.\n+• SQL$/);
  assert.equal(r.json.employmentType, 'Full-time');
  assert.equal(r.json.applyUrl, 'https://acme.example/apply/1');
  assert.equal(r.json.logoUrl, 'https://cdn.example.com/acme.png');
  assert.equal(r.json.url, 'https://acme.example/job/1', 'the original site stays on the record');
  assert.equal(r.json.skills, null);
  await env.__db.query(`UPDATE opportunities SET hidden = true WHERE id = $1`, [id]);
  assert.equal((await call('gina', 'GET', `/opportunities/${id}`)).status, 404);
  assert.equal((await call('gina', 'GET', '/opportunities/not-a-uuid')).status, 404);
  // the list still answers and keeps its own shape
  assert.equal((await call('gina', 'GET', '/opportunities/summary')).status, 200);
});
