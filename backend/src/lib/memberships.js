// MEMBERSHIPS & PAID CHANNELS (brief section 8) — shared model helpers.
//
// One membership system shown in three places (Discover › Memberships, Paid Channels, My Channels). Each membership has
// plans, subscriptions, reviews, promo codes, an ordered content library, and two conversations from the existing chat
// system: a Broadcast Channel (conversations.kind = 'channel', only owner/admins post) and a Community group
// (kind = 'group', every member chats). Both carry conversations.membership_id so the access guard
// (routes/memberships.js → membershipChatGuard) can check the subscription on every chat request.
//
// PAYMENTS (brief 3.4): paid memberships bought inside the app must go through Google Play Billing / Apple IAP.
// Providers here:
//   'play' → verifyPlayPurchase() — NOT configured yet (no Play developer account): answers PAYMENTS_NOT_CONFIGURED.
//            activateVerifiedPlayPurchase() is the ONE place a Play purchase becomes access, once verification exists.
//   'test' → only when MEMBERSHIP_TEST_CHECKOUT=true AND the user is an admin or listed in MEMBERSHIP_TESTERS.
// No card numbers, bank details or crypto are ever collected or wired.
import { q, one } from './db.js';
import { ApiError, bad } from './http.js';
import { formatMoney, CURRENCY_SYMBOL } from './money.js';
import { mediaUrl } from './shape.js';
import { notifyUser } from '../hub.js';
import { systemMessage } from './chatGroups.js';
// Google Play Billing lives in ONE shared module (lib/play.js); these names are re-exported unchanged for the routes.
import { isOn, isPlatformAdmin, playConfigured, PAYMENTS_SOON, paymentsNotConfigured, verifyPlayPurchase, testerAllowed, storeMethod } from './play.js';
export { isOn, isPlatformAdmin, playConfigured, PAYMENTS_SOON, paymentsNotConfigured, verifyPlayPurchase };

export const CATEGORIES = [
  'Bible Study', 'Prayer', 'Worship & Music', 'Ministry & Leadership', 'Discipleship', 'Marriage & Family',
  'Youth', 'Theology', 'Faith & Business',
];
export const INTERVALS = ['one_time', 'month', 'year', 'days'];
export const SUB_STATUSES = ['active', 'trialing', 'expired', 'cancelled', 'refunded'];
const ACCESS_STATUSES = ['active', 'trialing', 'cancelled']; // cancelled = renewal off, access until expires_at

const parse = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Feature flag memberships.public_creation (default off) → env MEMBERSHIPS_PUBLIC_CREATION. */
export const publicCreation = (env) => isOn(env.MEMBERSHIPS_PUBLIC_CREATION);

// ---------- money ----------
/** 2500000, 'NGN' → '₦25,000'; other currencies via Intl when available (falls back to symbol / code). */
export function formatPrice(minor, currency = 'NGN') {
  const cur = String(currency || 'NGN').toUpperCase();
  if (CURRENCY_SYMBOL[cur]) return formatMoney(minor, cur);
  const n = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur, minimumFractionDigits: Number(minor) % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  } catch (e) {
    return `${cur} ${n.toLocaleString('en', { maximumFractionDigits: 2 })}`;
  }
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "/ month", "/ year", "/ 7 days", "" for one-time. */
export function periodLabel(plan) {
  if (plan.interval === 'month') return '/ month';
  if (plan.interval === 'year') return '/ year';
  if (plan.interval === 'days') return `/ ${plural(plan.interval_days || 30, 'day')}`;
  return '';
}
/** Sentence under the big checkout price. */
export function accessText(plan) {
  if (plan.interval === 'one_time') return plan.interval_days ? `One-time payment for ${plural(plan.interval_days, 'day')} of access` : 'One-time payment for lifetime access';
  if (plan.interval === 'month') return 'Renews every month · cancel anytime';
  if (plan.interval === 'year') return 'Renews every year · cancel anytime';
  return `Renews every ${plural(plan.interval_days || 30, 'day')} · cancel anytime`;
}

export function planShape(p) {
  const price = formatPrice(p.price_minor, p.currency);
  const per = periodLabel(p);
  return {
    id: p.id,
    name: p.name,
    priceMinor: Number(p.price_minor),
    currency: p.currency,
    interval: p.interval,
    intervalDays: p.interval_days == null ? null : Number(p.interval_days),
    active: !!p.active,
    storeProductId: p.store_product_id || null,
    priceLabel: price,
    periodLabel: per,
    displayPrice: per ? `${price} ${per}` : price,
    perLabel: p.interval === 'one_time' ? (p.interval_days ? `for ${plural(p.interval_days, 'day')} of access` : 'lifetime access') : `per ${per.replace('/ ', '')}`,
    accessText: accessText(p),
    sortOrder: p.sort_order || 0,
  };
}

/** When access ends for a new purchase of `plan` starting at `from` (Date). null = never. */
export function accessUntil(plan, from = new Date()) {
  const d = new Date(from.getTime());
  if (plan.interval === 'month') { d.setUTCMonth(d.getUTCMonth() + 1); return d; }
  if (plan.interval === 'year') { d.setUTCFullYear(d.getUTCFullYear() + 1); return d; }
  if (plan.interval === 'days') return new Date(d.getTime() + (plan.interval_days || 30) * 86400e3);
  return plan.interval_days ? new Date(d.getTime() + plan.interval_days * 86400e3) : null; // one_time
}

/** Promo code maths → { discountMinor, totalMinor }. percent 1–100, amount in minor units (never below zero). */
export function applyPromo(priceMinor, promo) {
  const price = Math.max(0, Math.round(Number(priceMinor) || 0));
  if (!promo) return { discountMinor: 0, totalMinor: price };
  let discount = promo.kind === 'percent' ? Math.round((price * Math.min(100, Number(promo.value))) / 100) : Math.round(Number(promo.value));
  discount = Math.max(0, Math.min(price, discount));
  return { discountMinor: discount, totalMinor: price - discount };
}

// ---------- access ----------
export function hasAccess(sub, now = Date.now()) {
  if (!sub || !ACCESS_STATUSES.includes(sub.status)) return false;
  return !sub.expires_at || new Date(sub.expires_at).getTime() > now;
}

export function accessShape(sub) {
  if (!sub) return { status: 'none', active: false, lapsed: false, expiresAt: null, startedAt: null, planId: null, source: null, renews: false };
  const active = hasAccess(sub);
  return {
    status: active ? sub.status : (sub.status === 'refunded' ? 'refunded' : 'expired'),
    active,
    lapsed: !active,
    expiresAt: iso(sub.expires_at),
    startedAt: iso(sub.started_at),
    planId: sub.plan_id || null,
    source: sub.source,
    renews: active && ['active', 'trialing'].includes(sub.status) && !!sub.expires_at && sub.source === 'play',
  };
}

export async function subscriptionOf(env, membershipId, userId) {
  return one(env, 'SELECT * FROM membership_subscriptions WHERE membership_id = $1 AND user_id = $2', [membershipId, userId]);
}

// ---------- shapes ----------
const imgUrl = (env, origin, key) => (!key ? null : /^https:\/\//.test(key) ? key : mediaUrl(env, origin, key));

export function cardShape(env, origin, m, plans = []) {
  const active = plans.filter((p) => p.active).sort((a, b) => Number(a.price_minor) - Number(b.price_minor));
  const cheapest = active[0] ? planShape(active[0]) : null;
  return {
    id: m.id,
    slug: m.slug,
    title: m.title,
    category: m.category,
    coverUrl: imgUrl(env, origin, m.cover_key),
    coverKey: m.cover_key || null,
    introVideoUrl: m.intro_video_url || null,
    hasPreview: !!m.intro_video_url,
    headline: m.headline || '',
    memberCount: Number(m.member_count || 0),
    rating: { avg: Number(m.rating_avg || 0), count: Number(m.rating_count || 0) },
    priceLabel: cheapest ? cheapest.displayPrice : null,
    fromPriceMinor: cheapest ? cheapest.priceMinor : null,
    currency: cheapest ? cheapest.currency : 'NGN',
    planCount: active.length,
    status: m.status,
    publishedAt: iso(m.published_at),
  };
}

export function creatorShape(m, u) {
  if (!u) return { id: null, name: m.creator_name || 'BibleNestra', handle: null, avatarUrl: null, bio: m.creator_bio || '', joinedAt: null };
  return {
    id: u.id,
    name: m.creator_name || u.display_name,
    handle: u.handle || null,
    avatarUrl: u.avatar_url || null,
    bio: m.creator_bio || u.bio || '',
    verified: !!u.verified,
    joinedAt: iso(u.created_at),
  };
}

export function reviewShape(r) {
  return {
    id: r.id,
    rating: Number(r.rating),
    body: r.body || '',
    hidden: !!r.hidden,
    createdAt: iso(r.created_at),
    user: { id: r.user_id, name: r.display_name || 'Member', handle: r.handle || null, avatarUrl: r.avatar_url || null },
  };
}

export function lessonShape(l, doneSet) {
  return {
    id: l.id,
    position: l.position,
    title: l.title,
    kind: l.kind,
    body: l.body || '',
    mediaUrl: l.media_url || null,
    minutes: l.minutes || null,
    sample: !!l.is_sample,
    completed: doneSet ? doneSet.has(l.id) : false,
  };
}

export const faqsOf = (m) => parse(m.faqs, []).filter((f) => f && f.q).map((f) => ({ q: String(f.q), a: String(f.a || '') }));
export const questionsOf = (m) => parse(m.questions, []).filter((x) => x && x.label).map((x) => ({ label: String(x.label), required: !!x.required }));
export const benefitsOf = (m) => parse(m.benefits, []).filter(Boolean).map(String);

// ---------- input cleaning ----------
export function cleanList(v, field, max = 20) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw bad(`${field} must be a list`);
  if (v.length > max) throw bad(`${field}: at most ${max}`);
  return v;
}
export function cleanFaqs(v) {
  const l = cleanList(v, 'faqs', 30);
  if (l === undefined) return undefined;
  return l.map((f) => ({ q: String((f && f.q) || '').trim().slice(0, 300), a: String((f && f.a) || '').trim().slice(0, 2000) })).filter((f) => f.q);
}
export function cleanQuestions(v) {
  const l = cleanList(v, 'questions', 10);
  if (l === undefined) return undefined;
  return l.map((x) => ({ label: String((x && x.label) || '').trim().slice(0, 300), required: !!(x && x.required) })).filter((x) => x.label);
}
export function cleanBenefits(v) {
  const l = cleanList(v, 'benefits', 20);
  if (l === undefined) return undefined;
  return l.map((x) => String(x || '').trim().slice(0, 200)).filter(Boolean);
}
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'membership';

/** Validates answers to the custom checkout questions → cleaned array (same order as the questions). */
export function checkAnswers(questions, answers) {
  const list = Array.isArray(answers) ? answers : [];
  return questions.map((qq, i) => {
    const a = String(list[i] == null ? '' : list[i]).trim().slice(0, 1000);
    if (qq.required && !a) {
      const e = new ApiError(400, 'ANSWER_REQUIRED', `Please answer: ${qq.label}`);
      e.details = { questionIndex: i };
      throw e;
    }
    return a;
  });
}

// ---------- aggregates ----------
export async function recomputeStats(env, membershipId) {
  await q(env, `UPDATE memberships m SET
      member_count = s.n,
      rating_avg = COALESCE(r.avg, 0), rating_count = COALESCE(r.cnt, 0),
      trending_score = s.n + COALESCE(r.cnt, 0) * 3 + COALESCE(r.avg, 0) * 10 + m.sort_order * 25,
      updated_at = now()
    FROM (SELECT count(*)::int AS n FROM membership_subscriptions
           WHERE membership_id = $1 AND status IN ('active','trialing','cancelled') AND (expires_at IS NULL OR expires_at > now())) s,
         (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS cnt FROM membership_reviews WHERE membership_id = $1 AND NOT hidden) r
    WHERE m.id = $1`, [membershipId]);
}

// ---------- the two conversations (reuse of the chat system) ----------
/**
 * Creates the Broadcast Channel and the Community group the first time a membership is published (idempotent),
 * adds the owner (role owner) and the publishing admin (role admin), then every current subscriber as a member.
 */
export async function ensureConversations(env, m, actor) {
  let channelId = m.channel_id;
  let communityId = m.community_id;
  const ownerId = m.owner_id || actor.id;
  if (!channelId) {
    const ch = await one(env, `INSERT INTO conversations (kind, title, description, created_by, is_public, membership_id, settings)
      VALUES ('channel', $1, $2, $3, false, $4, '{"sendMessages":"admins"}'::jsonb) RETURNING id`,
    [`${m.title} · Channel`, `Announcements, lessons and videos for ${m.title} members`, ownerId, m.id]);
    channelId = ch.id;
  }
  if (!communityId) {
    const cm = await one(env, `INSERT INTO conversations (kind, title, description, created_by, is_public, membership_id, settings)
      VALUES ('group', $1, $2, $3, false, $4, '{"sendMessages":"all","addMembers":"admins","editInfo":"admins"}'::jsonb) RETURNING id`,
    [`${m.title} · Community`, `Ask questions, discuss lessons and share resources with other ${m.title} members`, ownerId, m.id]);
    communityId = cm.id;
  }
  await q(env, 'UPDATE memberships SET channel_id = $2, community_id = $3 WHERE id = $1', [m.id, channelId, communityId]);
  for (const conv of [channelId, communityId]) {
    await q(env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = 'owner'`, [conv, ownerId]);
    if (actor && actor.id !== ownerId) {
      await q(env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'admin')
        ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = CASE WHEN conversation_members.role = 'owner' THEN 'owner' ELSE 'admin' END`, [conv, actor.id]);
    }
  }
  const subs = await q(env, `SELECT user_id FROM membership_subscriptions WHERE membership_id = $1
      AND status IN ('active','trialing','cancelled') AND (expires_at IS NULL OR expires_at > now())`, [m.id]);
  const fresh = { ...m, channel_id: channelId, community_id: communityId };
  for (const s of subs) await addToConversations(env, fresh, s.user_id, { quiet: true });
  return fresh;
}

/** Adds a subscriber to both conversations as 'member' (staff roles untouched; community bans respected). */
export async function addToConversations(env, m, userId, { quiet = false } = {}) {
  const added = [];
  for (const conv of [m.channel_id, m.community_id].filter(Boolean)) {
    const r = await one(env, `INSERT INTO conversation_members (conversation_id, user_id, role)
        SELECT $1, $2, 'member' WHERE NOT EXISTS (SELECT 1 FROM conversation_bans b WHERE b.conversation_id = $1 AND b.user_id = $2)
      ON CONFLICT (conversation_id, user_id) DO NOTHING RETURNING conversation_id`, [conv, userId]);
    if (r) added.push(conv);
  }
  for (const conv of added) await notifyUser(env, userId, { type: 'conversation.new', conversationId: conv }).catch(() => {});
  if (!quiet && m.community_id && added.includes(m.community_id)) {
    const u = await one(env, 'SELECT display_name FROM users WHERE id = $1', [userId]);
    await systemMessage(env, m.community_id, userId, `${(u && u.display_name) || 'A new member'} joined the community`, { action: 'joined' }).catch(() => {});
  }
  return added;
}

/** Removes a lapsed member from both conversations (owner / admins / moderators stay — they run the channel). */
export async function removeFromConversations(env, m, userId) {
  const convs = [m.channel_id, m.community_id].filter(Boolean);
  if (!convs.length) return [];
  const rows = await q(env, `DELETE FROM conversation_members WHERE conversation_id = ANY($1::uuid[]) AND user_id = $2 AND role = 'member'
    RETURNING conversation_id`, [convs, userId]);
  for (const r of rows) await notifyUser(env, userId, { type: 'conversation.removed', conversationId: r.conversation_id }).catch(() => {});
  return rows.map((r) => r.conversation_id);
}

/** Makes the user's conversation membership match their subscription. → access (bool). */
export async function syncAccess(env, membershipId, userId) {
  const m = await one(env, 'SELECT * FROM memberships WHERE id = $1', [membershipId]);
  if (!m) return false;
  const sub = await subscriptionOf(env, membershipId, userId);
  const ok = hasAccess(sub);
  if (ok) await addToConversations(env, m, userId);
  else await removeFromConversations(env, m, userId);
  return ok;
}

/**
 * Expiry sweep: marks subscriptions past expires_at as 'expired', removes those users from the channel and community
 * and refreshes member counts. Runs from the 15-minute cron and lazily (per user) on membership / chat requests.
 */
export async function expireDue(env, { userId = null, membershipId = null } = {}) {
  const rows = await q(env, `UPDATE membership_subscriptions SET status = 'expired', updated_at = now()
     WHERE status IN ('active','trialing','cancelled') AND expires_at IS NOT NULL AND expires_at <= now()
       ${userId ? 'AND user_id = $1' : ''} ${membershipId ? `AND membership_id = $${userId ? 2 : 1}` : ''}
     RETURNING membership_id, user_id`, [userId, membershipId].filter(Boolean));
  const touched = new Set();
  for (const r of rows) {
    const m = await one(env, 'SELECT * FROM memberships WHERE id = $1', [r.membership_id]);
    if (m) await removeFromConversations(env, m, r.user_id);
    touched.add(r.membership_id);
  }
  for (const id of touched) await recomputeStats(env, id);
  return rows.length;
}

export async function runMembershipCron(env) {
  return expireDue(env);
}

/**
 * Starts or renews access. Renewing while still active extends from the current end date; after a lapse it starts now.
 * `until` (Date | null) overrides the plan length (admin grants). Returns the subscription row.
 */
export async function activateSubscription(env, { membership, plan = null, userId, source, until, answers = [], contact = {}, promoCode = null, amountMinor = null, currency = null, purchaseToken = null, grantedBy = null, note = null, checkoutKey = null }) {
  const cur = await subscriptionOf(env, membership.id, userId);
  const base = cur && hasAccess(cur) && cur.expires_at ? new Date(cur.expires_at) : new Date();
  const expires = until !== undefined ? until : (plan ? accessUntil(plan, base) : null);
  const startedAt = cur && hasAccess(cur) ? cur.started_at : new Date();
  const row = await one(env, `INSERT INTO membership_subscriptions
      (membership_id, user_id, plan_id, status, source, started_at, expires_at, answers, contact, promo_code, amount_minor, currency, purchase_token, granted_by, note, checkout_key)
      VALUES ($1,$2,$3,'active',$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (membership_id, user_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active', source = EXCLUDED.source,
      started_at = EXCLUDED.started_at, expires_at = EXCLUDED.expires_at, answers = EXCLUDED.answers, contact = EXCLUDED.contact,
      promo_code = EXCLUDED.promo_code, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
      purchase_token = COALESCE(EXCLUDED.purchase_token, membership_subscriptions.purchase_token),
      granted_by = EXCLUDED.granted_by, note = EXCLUDED.note, checkout_key = EXCLUDED.checkout_key, updated_at = now()
    RETURNING *`,
  [membership.id, userId, plan ? plan.id : null, source, startedAt, expires, JSON.stringify(answers || []), JSON.stringify(contact || {}),
    promoCode, amountMinor, currency, purchaseToken, grantedBy, note, checkoutKey]);
  await addToConversations(env, membership, userId);
  await recomputeStats(env, membership.id);
  return row;
}

/** Admin revoke / refund: access ends now and the user leaves both conversations. */
export async function endSubscription(env, membership, userId, status = 'expired') {
  const row = await one(env, `UPDATE membership_subscriptions SET status = $3, expires_at = LEAST(COALESCE(expires_at, now()), now()), updated_at = now()
    WHERE membership_id = $1 AND user_id = $2 RETURNING *`, [membership.id, userId, status]);
  await removeFromConversations(env, membership, userId);
  await recomputeStats(env, membership.id);
  return row;
}

// ---------- payment providers ----------
const listEnv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
export const EXTERNAL_METHODS = {
  card: 'Card',
  opay: 'OPay',
  bank_transfer: 'Bank Transfer',
  crypto: 'Pay with Crypto',
};

/** Test checkout: MEMBERSHIP_TEST_CHECKOUT=true AND (platform admin OR listed in MEMBERSHIP_TESTERS by id / handle / dev name). */
export function testCheckoutAllowed(env, user) {
  return testerAllowed(env, user, { flag: 'MEMBERSHIP_TEST_CHECKOUT', list: 'MEMBERSHIP_TESTERS' });
}

/**
 * Payment rows for the checkout sheet, driven by config.
 *   android / web (in-app) → Google Play only · ios → Apple In-App Purchase only.
 *   External methods (Card / OPay / Bank transfer / Crypto) appear ONLY when MEMBERSHIP_EXTERNAL_METHODS lists them,
 *   never on Android or iOS in-app, and always disabled ("Coming soon") — none of them is wired.
 *   'test' appears for admins / testers when MEMBERSHIP_TEST_CHECKOUT=true.
 */
export function checkoutMethods(env, user, platform = 'android') {
  const methods = [storeMethod(env, platform, 'google_play')];
  if (platform === 'web') {
    for (const k of listEnv(env.MEMBERSHIP_EXTERNAL_METHODS)) {
      if (EXTERNAL_METHODS[k]) methods.push({ id: k, label: EXTERNAL_METHODS[k], provider: 'external', available: false, note: 'Coming soon' });
    }
  }
  if (testCheckoutAllowed(env, user)) methods.unshift({ id: 'test', label: 'Test checkout', provider: 'test', available: true, note: 'Admins & testers only · no money moves' });
  return methods;
}

// verifyPlayPurchase(env, { productId, purchaseToken }) — see lib/play.js (fails closed with PAYMENTS_NOT_CONFIGURED).

/** The ONE place a verified Play purchase becomes access (idempotent per purchase token via a unique index). */
export async function activateVerifiedPlayPurchase(env, { membership, plan, userId, verified, answers, contact, promoCode }) {
  return activateSubscription(env, {
    membership, plan, userId, source: 'play', answers, contact, promoCode,
    until: verified.expiresAt ? new Date(verified.expiresAt) : undefined,
    amountMinor: verified.priceMinor ?? Number(plan.price_minor), currency: verified.currency || plan.currency,
    purchaseToken: verified.purchaseToken,
  });
}
