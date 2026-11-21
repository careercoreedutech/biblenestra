// MEMBERSHIPS & PAID CHANNELS (brief section 8): admin-only creation (flag opens it to creators), publish → catalogue,
// plan pricing / display, gated test checkout, Play not configured, admin grant / revoke, API access control on the
// Channel / Community / Library, auto add / remove from both conversations, cron + lazy expiry, renew, reviews and
// rating aggregates, promo maths, required checkout questions.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { q, one } from '../src/lib/db.js';
import { applyPromo, formatPrice, planShape, accessUntil, runMembershipCron } from '../src/lib/memberships.js';
import { MEMBERSHIPS_ADMIN_SCRIPT } from '../src/lib/membershipsAdminPage.js';

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
let mem; let monthly; let week;
const checkout = (user, extra = {}) => call(user, 'POST', `/memberships/${mem.id}/checkout`, {
  planId: monthly.id, provider: 'test', agree: true, answers: ['Grace Chapel'], contact: { email: 'x@example.com' }, ...extra,
});

test('setup: boss is an admin; ann, ben, cara, dan are members', async () => {
  for (const u of ['boss', 'ann', 'ben', 'cara', 'dan', 'eve']) ids[u] = (await call(u, 'GET', '/me')).json.id;
  await q(env, `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.boss]);
  await q(env, `UPDATE users SET handle = 'cara' WHERE id = $1`, [ids.cara]);
});

test('helpers: price display, promo maths, access length', () => {
  assert.equal(formatPrice(2500000, 'NGN'), '₦25,000');
  assert.equal(formatPrice(1050, 'USD'), '$10.50');
  assert.match(formatPrice(99900, 'KES'), /999/);
  const p = planShape({ id: 'p', name: 'Monthly', price_minor: 2500000, currency: 'NGN', interval: 'month', active: true });
  assert.equal(p.displayPrice, '₦25,000 / month');
  assert.equal(planShape({ price_minor: 500000, currency: 'NGN', interval: 'days', interval_days: 7 }).displayPrice, '₦5,000 / 7 days');
  const once = planShape({ price_minor: 1000000, currency: 'NGN', interval: 'one_time', interval_days: 30 });
  assert.equal(once.displayPrice, '₦10,000');
  assert.equal(once.accessText, 'One-time payment for 30 days of access');
  assert.deepEqual(applyPromo(2500000, { kind: 'percent', value: 20 }), { discountMinor: 500000, totalMinor: 2000000 });
  assert.deepEqual(applyPromo(2500000, { kind: 'amount', value: 3000000 }), { discountMinor: 2500000, totalMinor: 0 });
  assert.deepEqual(applyPromo(999, { kind: 'percent', value: 33 }), { discountMinor: 330, totalMinor: 669 });
  const d = accessUntil({ interval: 'days', interval_days: 7 }, new Date('2026-01-01T00:00:00Z'));
  assert.equal(d.toISOString(), '2026-01-08T00:00:00.000Z');
  assert.equal(accessUntil({ interval: 'one_time', interval_days: null }), null);
  assert.ok(!MEMBERSHIPS_ADMIN_SCRIPT.includes('`') && !MEMBERSHIPS_ADMIN_SCRIPT.includes('${'), 'admin script must be a plain string');
});

test('creation is admin-only; MEMBERSHIPS_PUBLIC_CREATION opens it to creators (their own only)', async () => {
  const r = await call('ann', 'POST', '/memberships/manage', { title: 'Ann’s Prayer School' });
  assert.equal(r.status, 403); assert.equal(r.json.code, 'CREATION_DISABLED');
  assert.equal((await call('ann', 'GET', '/memberships/manage')).status, 403);
  env.MEMBERSHIPS_PUBLIC_CREATION = 'true';
  const ok = await call('ann', 'POST', '/memberships/manage', { title: 'Ann’s Prayer School', headline: 'Pray daily' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.status, 'draft');
  assert.equal(ok.json.owner.id, ids.ann);
  const mine = await call('ann', 'GET', '/memberships/manage');
  assert.equal(mine.json.items.length, 1);
  delete env.MEMBERSHIPS_PUBLIC_CREATION;
  // flag off again: Ann can no longer manage it
  assert.equal((await call('ann', 'PATCH', `/memberships/manage/${ok.json.id}`, { title: 'X' })).status, 403);
});

test('admin creates a draft with plans, FAQs and checkout questions; drafts stay out of the catalogue', async () => {
  const r = await call('boss', 'POST', '/memberships/manage', {
    title: 'School of Prayer', category: 'Prayer', headline: 'Learn to pray with power', description: 'Twelve weeks of guided prayer.',
    coverKey: 'https://images.example.com/prayer.jpg', introVideoUrl: 'https://www.youtube.com/watch?v=abc',
    benefits: ['Weekly live class', 'Prayer partners'], faqs: [{ q: 'Is it for beginners?', a: 'Yes.' }],
    questions: [{ label: 'Which church do you attend?', required: true }, { label: 'Anything we should pray about?', required: false }],
    ownerHandle: 'cara',
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  mem = r.json;
  assert.equal(mem.slug, 'school-of-prayer');
  assert.equal(mem.owner.id, ids.cara);
  assert.equal(mem.hasPreview, true);
  assert.equal((await call('boss', 'POST', `/memberships/manage/${mem.id}/publish`)).json.code, 'NEEDS_PLAN');
  const p1 = await call('boss', 'POST', `/memberships/manage/${mem.id}/plans`, { name: 'Monthly', priceMinor: 2500000, interval: 'month', storeProductId: 'school_of_prayer_monthly' });
  assert.equal(p1.status, 201); monthly = p1.json;
  assert.equal(monthly.displayPrice, '₦25,000 / month');
  const p2 = await call('boss', 'POST', `/memberships/manage/${mem.id}/plans`, { name: '7-day pass', priceMinor: 500000, interval: 'one_time', intervalDays: 7 });
  week = p2.json;
  assert.equal(week.accessText, 'One-time payment for 7 days of access');
  assert.equal((await call('boss', 'POST', `/memberships/manage/${mem.id}/plans`, { name: 'Bad', priceMinor: 100, interval: 'days' })).json.code, 'BAD_INTERVAL');
  assert.equal((await call('ann', 'GET', '/memberships')).json.items.length, 0, 'draft not listed');
  assert.equal((await call('ann', 'GET', `/memberships/${mem.id}`)).status, 404, 'draft hidden from members');
});

test('publish → catalogue (category tabs, total, price pill) and the two conversations exist', async () => {
  const r = await call('boss', 'POST', `/memberships/manage/${mem.id}/publish`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.channelId && r.json.communityId);
  const ch = await one(env, 'SELECT kind, membership_id FROM conversations WHERE id = $1', [r.json.channelId]);
  assert.equal(ch.kind, 'channel'); assert.equal(ch.membership_id, mem.id);
  const roles = await q(env, 'SELECT user_id, role FROM conversation_members WHERE conversation_id = $1', [r.json.communityId]);
  assert.equal(roles.find((x) => x.user_id === ids.cara).role, 'owner');
  assert.equal(roles.find((x) => x.user_id === ids.boss).role, 'admin');
  mem = r.json;
  const cat = await call('ann', 'GET', '/memberships');
  assert.equal(cat.json.total, 1);
  assert.equal(cat.json.items[0].priceLabel, '₦5,000', 'cheapest active plan on the pill');
  assert.deepEqual(cat.json.categories.map((c) => c.name), ['All', 'Prayer']);
  assert.equal((await call('ann', 'GET', '/memberships?category=Worship%20%26%20Music')).json.total, 0);
  const page = await call('ann', 'GET', `/memberships/${mem.slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.json.plans.length, 2);
  assert.equal(page.json.faqs[0].q, 'Is it for beginners?');
  assert.equal(page.json.creator.id, ids.cara);
  assert.equal(page.json.access.status, 'none');
  assert.equal(page.json.channelId, null, 'conversation ids are not revealed to non-members');
});

test('non-members get 403 MEMBERSHIP_REQUIRED on the channel, community and library', async () => {
  for (const path of [`/conversations/${mem.channelId}/messages`, `/conversations/${mem.communityId}/messages`, `/conversations/${mem.communityId}/info`, `/memberships/${mem.id}/library`, `/memberships/${mem.id}/home`]) {
    const r = await call('ann', 'GET', path);
    assert.equal(r.status, 403, path); assert.equal(r.json.code, 'MEMBERSHIP_REQUIRED', path); assert.equal(r.json.lapsed, false);
  }
  const send = await call('ann', 'POST', `/conversations/${mem.communityId}/messages`, { text: 'hi' });
  assert.equal(send.json.code, 'MEMBERSHIP_REQUIRED');
});

test('checkout: test provider gated, Play not configured, required questions enforced', async () => {
  // Play path: not configured → friendly message
  const play = await call('ann', 'POST', `/memberships/${mem.id}/checkout`, { planId: monthly.id, provider: 'play', agree: true, answers: ['x'], purchaseToken: 't' });
  assert.equal(play.status, 503); assert.equal(play.json.code, 'PAYMENTS_NOT_CONFIGURED'); assert.match(play.json.error, /coming soon/i);
  // test provider: ordinary member without tester list → not configured
  const nope = await checkout('ann');
  assert.equal(nope.json.code, 'PAYMENTS_NOT_CONFIGURED');
  const cfg = await call('ann', 'GET', `/memberships/${mem.id}/checkout?platform=android`);
  assert.deepEqual(cfg.json.methods.map((m) => m.id), ['google_play']);
  assert.equal(cfg.json.methods[0].available, false); assert.equal(cfg.json.canPay, false);
  // external methods only on web, only when listed, always disabled
  env.MEMBERSHIP_EXTERNAL_METHODS = 'card,opay';
  assert.deepEqual((await call('ann', 'GET', `/memberships/${mem.id}/checkout?platform=android`)).json.methods.map((m) => m.id), ['google_play']);
  const web = await call('ann', 'GET', `/memberships/${mem.id}/checkout?platform=web`);
  assert.deepEqual(web.json.methods.map((m) => [m.id, m.available]), [['google_play', false], ['card', false], ['opay', false]]);
  delete env.MEMBERSHIP_EXTERNAL_METHODS;
  // admin: test checkout offered; required question enforced; terms required
  const adminCfg = await call('boss', 'GET', `/memberships/${mem.id}/checkout`);
  assert.equal(adminCfg.json.methods[0].id, 'test');
  const noAnswer = await checkout('boss', { answers: [''] });
  assert.equal(noAnswer.status, 400); assert.equal(noAnswer.json.code, 'ANSWER_REQUIRED'); assert.equal(noAnswer.json.questionIndex, 0);
  assert.equal((await checkout('boss', { agree: false })).json.code, 'TERMS_REQUIRED');
  // flag off → even admins get not-configured
  env.MEMBERSHIP_TEST_CHECKOUT = '';
  assert.equal((await checkout('boss')).json.code, 'PAYMENTS_NOT_CONFIGURED');
  env.MEMBERSHIP_TEST_CHECKOUT = 'true';
});

test('tester checkout activates; member joins both conversations; channel is read-only, community is chat', async () => {
  env.MEMBERSHIP_TESTERS = 'dan, someone-else';
  const r = await checkout('dan', { idempotencyKey: 'k1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.access.active, true);
  assert.equal(r.json.access.source, 'test');
  assert.equal(r.json.charged.totalLabel, '₦25,000');
  const again = await checkout('dan', { idempotencyKey: 'k1' });
  assert.equal(again.json.access.expiresAt, r.json.access.expiresAt, 'same idempotency key → no second extension');
  const m = await q(env, 'SELECT conversation_id, role FROM conversation_members WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])', [ids.dan, [mem.channelId, mem.communityId]]);
  assert.equal(m.length, 2); assert.ok(m.every((x) => x.role === 'member'));
  assert.equal((await call('dan', 'GET', `/conversations/${mem.channelId}/messages`)).status, 200);
  const post = await call('dan', 'POST', `/conversations/${mem.channelId}/messages`, { text: 'Can I post?' });
  assert.equal(post.status, 403, 'members cannot post in the broadcast channel');
  const ownerPost = await call('cara', 'POST', `/conversations/${mem.channelId}/messages`, { text: 'Welcome to week 1!' });
  assert.equal(ownerPost.status, 201, JSON.stringify(ownerPost.json));
  const react = await call('dan', 'POST', `/messages/${ownerPost.json.id}/react`, { emoji: '🙏' });
  assert.equal(react.status, 200, JSON.stringify(react.json));
  const chat = await call('dan', 'POST', `/conversations/${mem.communityId}/messages`, { text: 'Hello everyone' });
  assert.equal(chat.status, 201, JSON.stringify(chat.json));
  assert.equal((await call('dan', 'GET', '/memberships/mine')).json.items[0].access.active, true);
  // invite links / manual adds are off for membership conversations
  assert.equal((await call('cara', 'POST', `/conversations/${mem.communityId}/invite`, {})).json.code, 'MEMBERSHIP_MANAGED');
  // count
  assert.equal((await call('ann', 'GET', `/memberships/${mem.id}`)).json.memberCount, 1);
  delete env.MEMBERSHIP_TESTERS;
});

test('promo codes: percent off applied at checkout, usage limits', async () => {
  const p = await call('boss', 'POST', `/memberships/manage/${mem.id}/promos`, { code: 'grace20', kind: 'percent', value: 20, maxUses: 1 });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  const qte = await call('ann', 'POST', `/memberships/${mem.id}/promo`, { code: 'GRACE20', planId: monthly.id });
  assert.equal(qte.json.totalLabel, '₦20,000'); assert.equal(qte.json.discountLabel, '₦5,000');
  assert.equal((await call('ann', 'POST', `/memberships/${mem.id}/promo`, { code: 'NOPE', planId: monthly.id })).json.code, 'BAD_PROMO');
  const r = await checkout('boss', { promoCode: 'GRACE20' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.charged.totalMinor, 2000000);
  assert.equal((await call('ann', 'POST', `/memberships/${mem.id}/promo`, { code: 'GRACE20', planId: monthly.id })).json.code, 'BAD_PROMO', 'max uses reached');
});

test('admin grant / revoke: access, conversations and a 403 again after revoke', async () => {
  assert.equal((await call('ann', 'POST', `/memberships/manage/${mem.id}/grant`, { userId: ids.ben })).status, 403);
  const until = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
  const g = await call('boss', 'POST', `/memberships/manage/${mem.id}/grant`, { userId: ids.ben, until, note: 'Scholarship' });
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(g.json.source, 'admin_grant'); assert.equal(g.json.active, true);
  assert.equal((await call('ben', 'GET', `/memberships/${mem.id}/library`)).status, 200);
  assert.equal((await call('ben', 'GET', `/conversations/${mem.communityId}/messages`)).status, 200);
  const subs = await call('boss', 'GET', `/memberships/manage/${mem.id}/subscribers`);
  assert.ok(subs.json.items.find((s) => s.user.id === ids.ben && s.note === 'Scholarship'));
  const rv = await call('boss', 'POST', `/memberships/manage/${mem.id}/revoke`, { userId: ids.ben });
  assert.equal(rv.json.active, false);
  const gone = await one(env, 'SELECT 1 AS x FROM conversation_members WHERE user_id = $1 AND conversation_id = $2', [ids.ben, mem.communityId]);
  assert.equal(gone, null);
  const blocked = await call('ben', 'GET', `/conversations/${mem.communityId}/messages`);
  assert.equal(blocked.json.code, 'MEMBERSHIP_REQUIRED'); assert.equal(blocked.json.lapsed, true);
});

test('library: ordered lessons and progress for members only', async () => {
  for (const [t, kind, url] of [['Why we pray', 'text', null], ['The Lord’s Prayer', 'video', 'https://www.youtube.com/watch?v=x'], ['Prayer journal', 'file', 'https://example.com/j.pdf']]) {
    const r = await call('boss', 'POST', `/memberships/manage/${mem.id}/lessons`, { title: t, kind, mediaUrl: url, body: 'Notes', minutes: 10 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  assert.equal((await call('boss', 'POST', `/memberships/manage/${mem.id}/lessons`, { title: 'Bad', kind: 'video' })).json.code, 'BAD_URL');
  const lib = await call('dan', 'GET', `/memberships/${mem.id}/library`);
  assert.deepEqual(lib.json.items.map((l) => l.position), [1, 2, 3]);
  const done = await call('dan', 'POST', `/memberships/${mem.id}/lessons/${lib.json.items[0].id}/complete`);
  assert.equal(done.json.done, 1); assert.equal(done.json.nextLessonId, lib.json.items[1].id);
  assert.equal((await call('ann', 'POST', `/memberships/${mem.id}/lessons/${lib.json.items[0].id}/complete`)).json.code, 'MEMBERSHIP_REQUIRED');
});

test('cron expiry removes lapsed members; renew restores access', async () => {
  await q(env, `UPDATE membership_subscriptions SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND membership_id = $2`, [ids.dan, mem.id]);
  const n = await runMembershipCron(env);
  assert.ok(n >= 1);
  const row = await one(env, 'SELECT status FROM membership_subscriptions WHERE user_id = $1 AND membership_id = $2', [ids.dan, mem.id]);
  assert.equal(row.status, 'expired');
  const inConv = await q(env, 'SELECT 1 FROM conversation_members WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])', [ids.dan, [mem.channelId, mem.communityId]]);
  assert.equal(inConv.length, 0);
  const locked = await call('dan', 'GET', `/memberships/${mem.id}/home`);
  assert.equal(locked.json.code, 'MEMBERSHIP_REQUIRED'); assert.equal(locked.json.lapsed, true);
  const mine = await call('dan', 'GET', '/memberships/mine');
  assert.equal(mine.json.items[0].access.lapsed, true, 'lapsed membership listed with Renew');
  // renew (tester again) → back in both conversations
  env.MEMBERSHIP_TESTERS = 'dan';
  const renew = await checkout('dan', { planId: week.id, idempotencyKey: 'k2' });
  assert.equal(renew.json.access.active, true);
  const ms = Date.parse(renew.json.access.expiresAt) - Date.now();
  assert.ok(ms > 6.9 * 86400e3 && ms <= 7 * 86400e3 + 5000, 'renewal after a lapse starts now');
  assert.equal((await call('dan', 'GET', `/conversations/${mem.communityId}/messages`)).status, 200);
  delete env.MEMBERSHIP_TESTERS;
});

test('lazy expiry on a chat request (no cron needed)', async () => {
  await q(env, `UPDATE membership_subscriptions SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND membership_id = $2`, [ids.dan, mem.id]);
  const r = await call('dan', 'GET', `/conversations/${mem.communityId}/messages`);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'MEMBERSHIP_REQUIRED');
  const list = await call('dan', 'GET', '/conversations');
  assert.ok(!(list.json.items || list.json).some((cv) => cv.id === mem.communityId), 'dropped from the chat list');
});

test('reviews: members (current or past) only, one each, rating aggregates; admins can hide', async () => {
  const none = await call('ann', 'POST', `/memberships/${mem.id}/reviews`, { rating: 5, body: 'Great' });
  assert.equal(none.status, 403); assert.equal(none.json.code, 'MEMBERS_ONLY');
  assert.equal((await call('dan', 'POST', `/memberships/${mem.id}/reviews`, { rating: 5, body: 'Changed my prayer life' })).status, 201, 'past member may review');
  assert.equal((await call('dan', 'POST', `/memberships/${mem.id}/reviews`, { rating: 4 })).json.code, 'ALREADY_REVIEWED');
  assert.equal((await call('boss', 'POST', `/memberships/${mem.id}/reviews`, { rating: 3, body: 'Good' })).status, 201);
  assert.equal((await call('ben', 'POST', `/memberships/${mem.id}/reviews`, { rating: 0 })).status, 400);
  let page = await call('ann', 'GET', `/memberships/${mem.id}`);
  assert.deepEqual(page.json.rating, { avg: 4, count: 2 });
  const all = await call('ann', 'GET', `/memberships/${mem.id}/reviews`);
  assert.equal(all.json.items.length, 2); assert.equal(all.json.breakdown[0].count, 1);
  const hide = await call('boss', 'POST', `/memberships/manage/reviews/${all.json.items.find((r) => r.rating === 3).id}/hide`, { hidden: true });
  assert.equal(hide.status, 200);
  page = await call('ann', 'GET', `/memberships/${mem.id}`);
  assert.deepEqual(page.json.rating, { avg: 5, count: 1 });
  const edit = await call('dan', 'PATCH', `/memberships/${mem.id}/reviews/mine`, { rating: 4, body: 'Still great' });
  assert.equal(edit.json.rating, 4);
});

test('archive hides from the catalogue', async () => {
  await call('boss', 'POST', `/memberships/manage/${mem.id}/archive`);
  assert.equal((await call('ann', 'GET', '/memberships')).json.total, 0);
  assert.equal((await call('ann', 'GET', `/memberships/${mem.id}`)).status, 404);
  assert.equal((await call('dan', 'GET', `/memberships/${mem.id}`)).status, 200, 'past members still see it (Renew / locked state)');
});
