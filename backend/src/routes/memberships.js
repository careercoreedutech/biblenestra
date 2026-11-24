// MEMBERSHIPS & PAID CHANNELS (brief section 8). Model + helpers: lib/memberships.js. Admin tab: lib/membershipsAdminPage.js.
//
// App (signed in):
//   GET    /memberships                         ?category=&sort=trending|newest|price_low|price_high&q=&offset= → catalogue
//   GET    /memberships/mine                    → my memberships (active first, lapsed ones with "Renew")
//   GET    /memberships/:idOrSlug               → product page (plans, FAQs, creator, reviews, sample lessons, my access)
//   GET    /memberships/:id/reviews             ?offset= → all visible reviews
//   POST   /memberships/:id/reviews             { rating, body } — active or past members only, one per user
//   PATCH  /memberships/:id/reviews/mine        · DELETE /memberships/:id/reviews/mine
//   GET    /memberships/:id/checkout            ?platform=android|ios|web → payment rows (config driven), questions, plans
//   POST   /memberships/:id/promo               { code, planId } → price quote
//   POST   /memberships/:id/checkout            { planId, provider: 'paystack'|'test', answers[], promoCode, contact, email, idempotencyKey }
//                                               paystack → 202 { checkout: { reference, url } } (then poll GET /payments/paystack/:reference)
//   POST   /memberships/:id/cancel              → turn renewal off (access continues to the end date)
//   GET    /memberships/:id/home                → MASTER CLASS + EXECUTIVE CLASS ids, my role, welcome pop-up, library summary
//                                               (403 MEMBERSHIP_REQUIRED otherwise)
//   MEMBERSHIP GROUPS (routes/membershipGroups.js): welcome pop-up, free join, join requests, members, admins &
//   permissions, group settings, invite link, my notification choices — /memberships/welcome, /memberships/:id/join,
//   /memberships/:id/join-request, /memberships/:id/welcome/seen, /memberships/:id/group/*
//   GET    /memberships/:id/library             → ordered lessons + my progress (403 MEMBERSHIP_REQUIRED otherwise)
//   POST   /memberships/:id/lessons/:lessonId/complete · DELETE (undo)
// Manage (admins; also owners when MEMBERSHIPS_PUBLIC_CREATION=true):
//   GET/POST /memberships/manage · GET/PATCH /memberships/manage/:id · POST /memberships/manage/:id/publish|archive|draft
//   POST /memberships/manage/:id/plans · PATCH /memberships/manage/plans/:planId
//   POST /memberships/manage/:id/promos · PATCH /memberships/manage/promos/:promoId
//   POST /memberships/manage/:id/lessons · PATCH|DELETE /memberships/manage/lessons/:lessonId · POST .../move { dir }
//   GET  /memberships/manage/:id/subscribers · GET /memberships/manage/:id/reviews
//   admins only: POST /memberships/manage/:id/grant { userId|handle, until|days, note } · POST /memberships/manage/:id/revoke { userId }
//                POST /memberships/manage/reviews/:reviewId/hide { hidden } · POST /memberships/manage/expire-now
// Chat access guard: membershipChatGuard (index.js registers it before the conversation routes).
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, forbidden, int, isUuid, notFound, str, uuidParam } from '../lib/http.js';
import { imageRef } from '../lib/learn.js';
import {
  CATEGORIES, INTERVALS, accessShape, activateSubscription, activateVerifiedPlayPurchase, addToConversations, applyPromo,
  benefitsOf, cardShape, checkAnswers, checkoutMethods, cleanBenefits, cleanFaqs, cleanQuestions, creatorShape, endSubscription,
  ensureConversations, expireDue, faqsOf, formatPrice, hasAccess, isPlatformAdmin, lessonShape, paymentsNotConfigured,
  planShape, playConfigured, publicCreation, questionsOf, recomputeStats, removeFromConversations, reviewShape, slugify,
  subscriptionOf, testCheckoutAllowed, verifyPlayPurchase, PAYMENTS_SOON,
} from '../lib/memberships.js';
import { MEMBERSHIPS_ADMIN_SCRIPT } from '../lib/membershipsAdminPage.js';
import { startMembershipCheckout, paystackMethod, inAppEnabled } from '../lib/paystackCheckout.js';
import { audit, registerAdminScript } from './admin.js';
import { masterTitle, executiveTitle, groupSettingsOf, actorIn, welcomeText, prefsOf, MASTER, EXECUTIVE } from '../lib/membershipGroups.js'; // MEMBERSHIP GROUPS
import { assertMayJoin, joinRequestOf, freePlanOf } from '../lib/memberships.js';
import { mountGroupRoutes } from './membershipGroups.js'; // MEMBERSHIP GROUPS: /memberships/:id/group/* + welcome + joining

registerAdminScript(MEMBERSHIPS_ADMIN_SCRIPT);

const origin = (c) => new URL(c.req.url).origin;
const RESERVED = ['manage', 'mine', 'welcome'];

async function plansOf(env, ids, { all = false } = {}) {
  if (!ids.length) return [];
  return q(env, `SELECT * FROM membership_plans WHERE membership_id = ANY($1::uuid[]) ${all ? '' : 'AND active'} ORDER BY sort_order, price_minor`, [ids]);
}
async function cards(env, o, rows) {
  const plans = await plansOf(env, rows.map((r) => r.id));
  return rows.map((r) => cardShape(env, o, r, plans.filter((p) => p.membership_id === r.id)));
}
const membershipRequired = (m, sub) => {
  const e = forbidden(sub ? 'Your membership has ended. Renew to get back in.' : `Join this membership to open ${MASTER}, ${EXECUTIVE} and the library.`, 'MEMBERSHIP_REQUIRED');
  e.details = { membershipId: m.id, slug: m.slug, lapsed: !!sub };
  return e;
};

async function findMembership(env, ref) {
  if (isUuid(ref)) return one(env, 'SELECT * FROM memberships WHERE id = $1', [ref]);
  return one(env, 'SELECT * FROM memberships WHERE slug = $1', [String(ref || '').toLowerCase()]);
}
const canManage = (env, me, m) => isPlatformAdmin(me) || (publicCreation(env) && m.owner_id === me.id);

/** A membership the caller may see: published, or archived/draft for its staff, or archived for people who had it. */
async function visibleMembership(c, ref) {
  const me = c.get('user');
  const m = await findMembership(c.env, ref);
  if (!m) throw notFound('Membership not found');
  if (m.status === 'published' || canManage(c.env, me, m)) return m;
  if (m.status === 'archived' && await subscriptionOf(c.env, m.id, me.id)) return m;
  throw notFound('Membership not found');
}

/** Access check for library / home: staff always; members with an active subscription; else 403 MEMBERSHIP_REQUIRED. */
async function requireAccess(c, m, { groupStaff = true } = {}) {
  const me = c.get('user');
  if (canManage(c.env, me, m)) return { staff: true, sub: await subscriptionOf(c.env, m.id, me.id) };
  // MEMBERSHIP GROUPS: the owner and group admins open the group without a subscription of their own
  if (groupStaff && (await actorIn(c.env, m, me)).staff) return { staff: true, sub: await subscriptionOf(c.env, m.id, me.id) };
  await expireDue(c.env, { userId: me.id, membershipId: m.id });
  const sub = await subscriptionOf(c.env, m.id, me.id);
  if (!hasAccess(sub)) throw membershipRequired(m, sub);
  return { staff: false, sub };
}

// ======================================================================================================
// Chat access guard — registered in index.js on /conversations/:id(/*) and /messages/:id(/*) BEFORE the chat routes.
// Conversations without membership_id are untouched. For a membership's Channel / Community:
//   owner / admins / moderators of the conversation and platform admins pass;
//   members pass only with an active subscription (lazy expiry here too) — re-added if they had been removed;
//   everyone else gets 403 MEMBERSHIP_REQUIRED { membershipId, slug, lapsed } (and is removed if still listed).
//   Invite links and manual adds are off for these conversations (access comes from the subscription).
//   MEMBERSHIP GROUPS: the chat's generic member / role / ban / settings / invite / join-request routes are off too —
//   the group's own screens (/memberships/:id/group/*) do these, so the owner can't be removed or demoted through them.
// ======================================================================================================
const MANAGED_ROUTES = [
  ['POST', /\/(invite|members)$/],
  ['POST', /\/members\/[^/]+\/role$/],
  ['DELETE', /\/members\/[^/]+$/],
  ['POST', /\/transfer$/],
  ['PATCH', /\/settings$/],
  ['PATCH', /^\/conversations\/[^/]+$/],
  ['POST', /\/requests\/[^/]+$/],
  ['DELETE', /\/bans\/[^/]+$/],
];
export async function membershipChatGuard(c, next) {
  const me = c.get('user');
  const id = c.req.param('id');
  if (!me || !isUuid(id)) return next();
  const isMsg = c.req.path.startsWith('/messages/');
  const conv = isMsg
    ? await one(c.env, 'SELECT cv.id, cv.membership_id FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE m.id = $1', [id])
    : await one(c.env, 'SELECT id, membership_id FROM conversations WHERE id = $1', [id]);
  if (!conv || !conv.membership_id) return next();
  const m = await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [conv.membership_id]);
  if (!m) return next();
  const mem = await one(c.env, 'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [conv.id, me.id]);
  const staff = (mem && mem.role !== 'member') || isPlatformAdmin(me);
  if (!isMsg && MANAGED_ROUTES.some(([method, re]) => c.req.method === method && re.test(c.req.path))) {
    throw forbidden(`People join ${MASTER} and ${EXECUTIVE} through the membership. Manage members, admins and settings from the group’s own Members and Settings screens.`, 'MEMBERSHIP_MANAGED');
  }
  if (staff) return next();
  await expireDue(c.env, { userId: me.id, membershipId: m.id });
  const sub = await subscriptionOf(c.env, m.id, me.id);
  if (hasAccess(sub)) {
    if (!mem) await addToConversations(c.env, m, me.id, { quiet: true });
    return next();
  }
  if (mem) await removeFromConversations(c.env, m, me.id);
  throw membershipRequired(m, sub);
}

/** GET /conversations: run the caller's lazy expiry first so a lapsed membership drops out of the chat list at once. */
export async function membershipLazyExpiry(c, next) {
  const me = c.get('user');
  if (me && c.req.method === 'GET') await expireDue(c.env, { userId: me.id }).catch(() => {});
  return next();
}

export const membershipsApp = new Hono();

// ======================================================================================================
// Manage (registered first so /memberships/manage never matches /memberships/:ref)
// ======================================================================================================
async function managed(c, id) {
  const me = c.get('user');
  const m = await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [id]);
  if (!m) throw notFound('Membership not found');
  if (!canManage(c.env, me, m)) throw forbidden('Only admins can manage memberships', 'ADMIN_ONLY');
  return m;
}
function adminOnly(c) {
  if (!isPlatformAdmin(c.get('user'))) throw forbidden('Only platform admins can do this', 'NOT_ADMIN');
}
function canCreate(c) {
  const me = c.get('user');
  if (isPlatformAdmin(me)) return;
  if (!publicCreation(c.env)) throw forbidden('Only admins can create memberships for now', 'CREATION_DISABLED');
  if (me.banned) throw forbidden('Not allowed');
}

const httpsUrl = (v, field) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (!/^https:\/\/[^\s]{4,600}$/.test(s)) throw bad(`${field} must be an https link`, 'BAD_URL');
  return s;
};

function membershipFields(b, cur = {}) {
  const has = (k) => b[k] !== undefined;
  const category = has('category') ? str(b.category, { min: 1, max: 40, field: 'category' }) : cur.category || CATEGORIES[0];
  return {
    title: has('title') ? str(b.title, { min: 1, max: 120, field: 'title' }) : cur.title,
    category,
    coverKey: imageRef(b.coverKey !== undefined ? b.coverKey : b.coverUrl, cur.cover_key, 'cover'),
    introVideoUrl: has('introVideoUrl') ? httpsUrl(b.introVideoUrl, 'introVideoUrl') : cur.intro_video_url || null,
    headline: has('headline') ? str(b.headline || '', { max: 200, field: 'headline' }) : cur.headline || '',
    description: has('description') ? str(b.description || '', { max: 6000, field: 'description' }) : cur.description || '',
    benefits: has('benefits') ? cleanBenefits(b.benefits) : (cur.benefits ? benefitsOf(cur) : []),
    faqs: has('faqs') ? cleanFaqs(b.faqs) : (cur.faqs ? faqsOf(cur) : []),
    questions: has('questions') ? cleanQuestions(b.questions) : (cur.questions ? questionsOf(cur) : []),
    creatorName: has('creatorName') ? str(b.creatorName || '', { max: 80, field: 'creatorName' }) || null : cur.creator_name || null,
    creatorBio: has('creatorBio') ? str(b.creatorBio || '', { max: 1000, field: 'creatorBio' }) || null : cur.creator_bio || null,
    sortOrder: has('sortOrder') ? int(b.sortOrder, { min: -100, max: 100, field: 'sortOrder' }) : cur.sort_order || 0,
  };
}

function planFields(b, cur = {}) {
  const has = (k) => b[k] !== undefined;
  const interval = has('interval') ? String(b.interval) : cur.interval || 'month';
  if (!INTERVALS.includes(interval)) throw bad(`interval must be one of ${INTERVALS.join(', ')}`, 'BAD_INTERVAL');
  let intervalDays = has('intervalDays') ? (b.intervalDays === null || b.intervalDays === '' ? null : int(b.intervalDays, { min: 1, max: 3650, field: 'intervalDays' })) : cur.interval_days ?? null;
  if (interval === 'days' && !intervalDays) throw bad('Custom plans need the number of days', 'BAD_INTERVAL');
  if (interval === 'month' || interval === 'year') intervalDays = null;
  const currency = has('currency') ? String(b.currency || 'NGN').trim().toUpperCase() : cur.currency || 'NGN';
  if (!/^[A-Z]{3}$/.test(currency)) throw bad('currency must be a 3-letter code like NGN', 'BAD_CURRENCY');
  return {
    name: has('name') ? str(b.name || 'Membership', { min: 1, max: 60, field: 'name' }) : cur.name || 'Membership',
    priceMinor: has('priceMinor') ? int(b.priceMinor, { min: 0, max: 1e12, field: 'priceMinor' }) : Number(cur.price_minor ?? NaN),
    currency,
    interval,
    intervalDays,
    active: has('active') ? !!b.active : cur.active !== false,
    storeProductId: has('storeProductId') ? (str(b.storeProductId || '', { max: 100, field: 'storeProductId' }) || null) : cur.store_product_id || null,
    sortOrder: has('sortOrder') ? int(b.sortOrder, { min: -1000, max: 1000, field: 'sortOrder' }) : cur.sort_order || 0,
  };
}

function promoFields(b, cur = {}) {
  const has = (k) => b[k] !== undefined;
  const kind = has('kind') ? String(b.kind) : cur.kind || 'percent';
  if (!['percent', 'amount'].includes(kind)) throw bad('kind must be percent or amount', 'BAD_PROMO');
  const value = has('value') ? int(b.value, { min: 1, max: kind === 'percent' ? 100 : 1e12, field: 'value' }) : Number(cur.value);
  const code = has('code') ? String(b.code || '').trim().toUpperCase() : cur.code;
  if (!/^[A-Z0-9_-]{3,30}$/.test(code || '')) throw bad('Code: 3–30 letters, numbers, - or _', 'BAD_PROMO');
  let expiresAt = cur.expires_at || null;
  if (has('expiresAt')) {
    expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw bad('expiresAt must be a date', 'BAD_DATE');
  }
  return {
    code, kind, value,
    maxUses: has('maxUses') ? (b.maxUses ? int(b.maxUses, { min: 1, max: 1e7, field: 'maxUses' }) : null) : cur.max_uses ?? null,
    expiresAt,
    active: has('active') ? !!b.active : cur.active !== false,
  };
}

function lessonFields(b, cur = {}) {
  const has = (k) => b[k] !== undefined;
  const kind = has('kind') ? String(b.kind) : cur.kind || 'text';
  if (!['video', 'file', 'text'].includes(kind)) throw bad('kind must be video, file or text', 'BAD_KIND');
  const mediaUrl = has('mediaUrl') ? httpsUrl(b.mediaUrl, 'mediaUrl') : cur.media_url || null;
  if (kind !== 'text' && !mediaUrl) throw bad('Video and file lessons need an https link', 'BAD_URL');
  return {
    title: has('title') ? str(b.title, { min: 1, max: 160, field: 'title' }) : cur.title,
    kind,
    body: has('body') ? str(b.body || '', { max: 20000, field: 'body' }) : cur.body || '',
    mediaUrl,
    minutes: has('minutes') ? (b.minutes ? int(b.minutes, { min: 1, max: 1000, field: 'minutes' }) : null) : cur.minutes || null,
    sample: has('sample') ? !!b.sample : !!cur.is_sample,
  };
}

async function uniqueSlug(env, wanted, selfId = null) {
  const base = slugify(wanted);
  let s = RESERVED.includes(base) ? `${base}-1` : base;
  for (let i = 2; i < 200; i += 1) {
    const hit = await one(env, 'SELECT id FROM memberships WHERE slug = $1', [s]);
    if (!hit || hit.id === selfId) return s;
    s = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function resolveUser(env, b) {
  if (b.userId && isUuid(b.userId)) return one(env, 'SELECT * FROM users WHERE id = $1', [b.userId]);
  const h = String(b.handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!h) return null;
  return one(env, `SELECT * FROM users WHERE lower(handle) = $1 OR lower(display_name) = $1 OR clerk_id = $2 ORDER BY created_at LIMIT 1`, [h, `dev_${h}`]);
}

async function sectionStats(env, m) {
  const count = async (id, extra = '') => (id ? (await one(env, `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND NOT deleted AND kind <> 'system' ${extra}`, [id])).n : 0);
  return {
    master: { id: m.channel_id || null, name: MASTER, posts: await count(m.channel_id) },
    executive: { id: m.community_id || null, name: EXECUTIVE, messages: await count(m.community_id, "AND kind <> 'shared_post'") },
  };
}

async function manageShape(c, m) {
  const env = c.env;
  const plans = await plansOf(env, [m.id], { all: true });
  const promos = await q(env, 'SELECT * FROM membership_promos WHERE membership_id = $1 ORDER BY created_at DESC', [m.id]);
  const lessons = await q(env, 'SELECT * FROM membership_lessons WHERE membership_id = $1 ORDER BY position, created_at', [m.id]);
  const owner = m.owner_id ? await one(env, 'SELECT * FROM users WHERE id = $1', [m.owner_id]) : null;
  const subs = await one(env, `SELECT count(*) FILTER (WHERE status IN ('active','trialing','cancelled') AND (expires_at IS NULL OR expires_at > now()))::int AS active,
      count(*)::int AS total FROM membership_subscriptions WHERE membership_id = $1`, [m.id]);
  return {
    ...cardShape(env, origin(c), m, plans),
    description: m.description || '',
    benefits: benefitsOf(m),
    faqs: faqsOf(m),
    questions: questionsOf(m),
    creatorName: m.creator_name || '',
    creatorBio: m.creator_bio || '',
    sortOrder: m.sort_order || 0,
    owner: owner ? { id: owner.id, name: owner.display_name, handle: owner.handle } : null,
    creator: creatorShape(m, owner),
    plans: plans.map(planShape),
    promos: promos.map((p) => ({ id: p.id, code: p.code, kind: p.kind, value: Number(p.value), maxUses: p.max_uses, uses: p.uses, expiresAt: p.expires_at ? new Date(p.expires_at).toISOString() : null, active: !!p.active })),
    lessons: lessons.map((l) => lessonShape(l)),
    channelId: m.channel_id || null,
    communityId: m.community_id || null,
    // MEMBERSHIP GROUPS: the two sections by name (+ post / message counts for the admin tab)
    sections: await sectionStats(env, m),
    groupSettings: groupSettingsOf(m),
    adminsCount: (await one(env, 'SELECT count(*)::int AS n FROM membership_admins WHERE membership_id = $1', [m.id])).n,
    subscribers: subs,
  };
}

membershipsApp.get('/memberships/manage', async (c) => {
  const me = c.get('user');
  const admin = isPlatformAdmin(me);
  if (!admin && !publicCreation(c.env)) throw forbidden('Only admins can manage memberships', 'ADMIN_ONLY');
  const rows = await q(c.env, `SELECT * FROM memberships ${admin ? '' : 'WHERE owner_id = $1'} ORDER BY created_at DESC LIMIT 300`, admin ? [] : [me.id]);
  const items = [];
  for (const r of rows) items.push(await manageShape(c, r));
  return c.json({
    items, categories: CATEGORIES, intervals: INTERVALS,
    flags: { publicCreation: publicCreation(c.env), testCheckout: testCheckoutAllowed(c.env, me), playConfigured: playConfigured(c.env) },
  });
});

membershipsApp.post('/memberships/manage', async (c) => {
  const me = c.get('user');
  canCreate(c);
  const b = await body(c);
  const f = membershipFields(b);
  if (!f.title) throw bad('title is required');
  let ownerId = me.id;
  if (isPlatformAdmin(me) && (b.ownerUserId || b.ownerHandle)) {
    const u = await resolveUser(c.env, { userId: b.ownerUserId, handle: b.ownerHandle });
    if (!u) throw bad('Owner not found', 'USER_NOT_FOUND');
    ownerId = u.id;
  }
  const slug = await uniqueSlug(c.env, b.slug || f.title);
  const row = await one(c.env, `INSERT INTO memberships (slug, title, category, cover_key, intro_video_url, headline, description, benefits, faqs, questions,
      creator_name, creator_bio, sort_order, owner_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14) RETURNING *`,
  [slug, f.title, f.category, f.coverKey, f.introVideoUrl, f.headline, f.description, JSON.stringify(f.benefits), JSON.stringify(f.faqs),
    JSON.stringify(f.questions), f.creatorName, f.creatorBio, f.sortOrder, ownerId]);
  if (isPlatformAdmin(me)) await audit(c.env, me, 'membership.create', 'membership', row.id, { title: f.title });
  return c.json(await manageShape(c, row), 201);
});

membershipsApp.get('/memberships/manage/:id', async (c) => c.json(await manageShape(c, await managed(c, uuidParam(c)))));

membershipsApp.patch('/memberships/manage/:id', async (c) => {
  const me = c.get('user');
  const cur = await managed(c, uuidParam(c));
  const b = await body(c);
  const f = membershipFields(b, cur);
  const slug = b.slug !== undefined ? await uniqueSlug(c.env, b.slug || f.title, cur.id) : cur.slug;
  let ownerId = cur.owner_id;
  if (isPlatformAdmin(me) && (b.ownerUserId || b.ownerHandle)) {
    const u = await resolveUser(c.env, { userId: b.ownerUserId, handle: b.ownerHandle });
    if (!u) throw bad('Owner not found', 'USER_NOT_FOUND');
    ownerId = u.id;
  }
  const row = await one(c.env, `UPDATE memberships SET slug=$2, title=$3, category=$4, cover_key=$5, intro_video_url=$6, headline=$7, description=$8,
      benefits=$9::jsonb, faqs=$10::jsonb, questions=$11::jsonb, creator_name=$12, creator_bio=$13, sort_order=$14, owner_id=$15, updated_at=now()
    WHERE id = $1 RETURNING *`,
  [cur.id, slug, f.title, f.category, f.coverKey, f.introVideoUrl, f.headline, f.description, JSON.stringify(f.benefits), JSON.stringify(f.faqs),
    JSON.stringify(f.questions), f.creatorName, f.creatorBio, f.sortOrder, ownerId]);
  // keep the two conversations' names in step with the membership title
  if (row.channel_id && row.title !== cur.title) {
    await q(c.env, 'UPDATE conversations SET title = $2 WHERE id = $1', [row.channel_id, masterTitle(row.title)]);
    await q(c.env, 'UPDATE conversations SET title = $2 WHERE id = $1', [row.community_id, executiveTitle(row.title)]);
  }
  await recomputeStats(c.env, row.id);
  if (isPlatformAdmin(me)) await audit(c.env, me, 'membership.update', 'membership', row.id, { title: row.title });
  return c.json(await manageShape(c, await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [row.id])));
});

membershipsApp.post('/memberships/manage/:id/:action{publish|archive|draft}', async (c) => {
  const me = c.get('user');
  const m = await managed(c, uuidParam(c));
  const action = c.req.param('action');
  if (action === 'publish') {
    const plans = await plansOf(c.env, [m.id]);
    if (!plans.length) throw bad('Add at least one active plan before publishing', 'NEEDS_PLAN');
    const fresh = await ensureConversations(c.env, m, me);
    await q(c.env, `UPDATE memberships SET status = 'published', published_at = COALESCE(published_at, now()), updated_at = now() WHERE id = $1`, [fresh.id]);
  } else {
    await q(c.env, `UPDATE memberships SET status = $2, updated_at = now() WHERE id = $1`, [m.id, action === 'archive' ? 'archived' : 'draft']);
  }
  await recomputeStats(c.env, m.id);
  if (isPlatformAdmin(me)) await audit(c.env, me, `membership.${action}`, 'membership', m.id, { title: m.title });
  return c.json(await manageShape(c, await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [m.id])));
});

// ----- plans -----
membershipsApp.post('/memberships/manage/:id/plans', async (c) => {
  const m = await managed(c, uuidParam(c));
  const f = planFields(await body(c));
  if (!Number.isFinite(f.priceMinor)) throw bad('priceMinor is required');
  const row = await one(c.env, `INSERT INTO membership_plans (membership_id, name, price_minor, currency, interval, interval_days, active, store_product_id, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [m.id, f.name, f.priceMinor, f.currency, f.interval, f.intervalDays, f.active, f.storeProductId, f.sortOrder]);
  return c.json(planShape(row), 201);
});
membershipsApp.patch('/memberships/manage/plans/:planId', async (c) => {
  const cur = await one(c.env, 'SELECT * FROM membership_plans WHERE id = $1', [uuidParam(c, 'planId')]);
  if (!cur) throw notFound('Plan not found');
  await managed(c, cur.membership_id);
  const f = planFields(await body(c), cur);
  const row = await one(c.env, `UPDATE membership_plans SET name=$2, price_minor=$3, currency=$4, interval=$5, interval_days=$6, active=$7, store_product_id=$8, sort_order=$9
    WHERE id = $1 RETURNING *`, [cur.id, f.name, f.priceMinor, f.currency, f.interval, f.intervalDays, f.active, f.storeProductId, f.sortOrder]);
  return c.json(planShape(row));
});

// ----- promo codes -----
membershipsApp.post('/memberships/manage/:id/promos', async (c) => {
  const m = await managed(c, uuidParam(c));
  const f = promoFields(await body(c));
  const dup = await one(c.env, 'SELECT id FROM membership_promos WHERE membership_id = $1 AND code = $2', [m.id, f.code]);
  if (dup) throw new ApiError(409, 'PROMO_EXISTS', 'That code already exists');
  const row = await one(c.env, `INSERT INTO membership_promos (membership_id, code, kind, value, max_uses, expires_at, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [m.id, f.code, f.kind, f.value, f.maxUses, f.expiresAt, f.active]);
  return c.json({ id: row.id, ...f }, 201);
});
membershipsApp.patch('/memberships/manage/promos/:promoId', async (c) => {
  const cur = await one(c.env, 'SELECT * FROM membership_promos WHERE id = $1', [uuidParam(c, 'promoId')]);
  if (!cur) throw notFound('Promo code not found');
  await managed(c, cur.membership_id);
  const f = promoFields(await body(c), cur);
  await q(c.env, 'UPDATE membership_promos SET code=$2, kind=$3, value=$4, max_uses=$5, expires_at=$6, active=$7 WHERE id = $1',
    [cur.id, f.code, f.kind, f.value, f.maxUses, f.expiresAt, f.active]);
  return c.json({ id: cur.id, ...f });
});

// ----- library lessons -----
async function renumberLessons(env, membershipId) {
  await q(env, `UPDATE membership_lessons l SET position = r.n FROM (
      SELECT id, row_number() OVER (ORDER BY position, created_at) AS n FROM membership_lessons WHERE membership_id = $1
    ) r WHERE l.id = r.id AND l.position <> r.n`, [membershipId]);
}
membershipsApp.post('/memberships/manage/:id/lessons', async (c) => {
  const m = await managed(c, uuidParam(c));
  const f = lessonFields(await body(c));
  if (!f.title) throw bad('title is required');
  const pos = await one(c.env, 'SELECT COALESCE(max(position), 0) + 1 AS p FROM membership_lessons WHERE membership_id = $1', [m.id]);
  const row = await one(c.env, `INSERT INTO membership_lessons (membership_id, position, title, kind, body, media_url, minutes, is_sample)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [m.id, pos.p, f.title, f.kind, f.body, f.mediaUrl, f.minutes, f.sample]);
  return c.json(lessonShape(row), 201);
});
async function managedLesson(c) {
  const l = await one(c.env, 'SELECT * FROM membership_lessons WHERE id = $1', [uuidParam(c, 'lessonId')]);
  if (!l) throw notFound('Lesson not found');
  await managed(c, l.membership_id);
  return l;
}
membershipsApp.patch('/memberships/manage/lessons/:lessonId', async (c) => {
  const cur = await managedLesson(c);
  const f = lessonFields(await body(c), cur);
  const row = await one(c.env, `UPDATE membership_lessons SET title=$2, kind=$3, body=$4, media_url=$5, minutes=$6, is_sample=$7, updated_at=now()
    WHERE id = $1 RETURNING *`, [cur.id, f.title, f.kind, f.body, f.mediaUrl, f.minutes, f.sample]);
  return c.json(lessonShape(row));
});
membershipsApp.delete('/memberships/manage/lessons/:lessonId', async (c) => {
  const cur = await managedLesson(c);
  await q(c.env, 'DELETE FROM membership_lessons WHERE id = $1', [cur.id]);
  await renumberLessons(c.env, cur.membership_id);
  return c.json({ ok: true });
});
membershipsApp.post('/memberships/manage/lessons/:lessonId/move', async (c) => {
  const cur = await managedLesson(c);
  const b = await body(c);
  const dir = b.dir === 'up' ? -1 : 1;
  const other = await one(c.env, `SELECT * FROM membership_lessons WHERE membership_id = $1 AND position ${dir < 0 ? '<' : '>'} $2
    ORDER BY position ${dir < 0 ? 'DESC' : 'ASC'} LIMIT 1`, [cur.membership_id, cur.position]);
  if (other) {
    await q(c.env, 'UPDATE membership_lessons SET position = $2 WHERE id = $1', [cur.id, other.position]);
    await q(c.env, 'UPDATE membership_lessons SET position = $2 WHERE id = $1', [other.id, cur.position]);
  }
  await renumberLessons(c.env, cur.membership_id);
  return c.json({ ok: true });
});

// ----- members & subscriptions -----
membershipsApp.get('/memberships/manage/:id/subscribers', async (c) => {
  const m = await managed(c, uuidParam(c));
  const rows = await q(c.env, `SELECT s.*, u.display_name, u.handle, p.name AS plan_name, p.price_minor AS plan_price, p.currency AS plan_currency, p.interval AS plan_interval, p.interval_days AS plan_days
      FROM membership_subscriptions s JOIN users u ON u.id = s.user_id LEFT JOIN membership_plans p ON p.id = s.plan_id
     WHERE s.membership_id = $1 ORDER BY s.updated_at DESC LIMIT 500`, [m.id]);
  return c.json({
    items: rows.map((s) => ({
      user: { id: s.user_id, name: s.display_name, handle: s.handle },
      plan: s.plan_id ? { id: s.plan_id, name: s.plan_name, displayPrice: planShape({ price_minor: s.plan_price, currency: s.plan_currency, interval: s.plan_interval, interval_days: s.plan_days }).displayPrice } : null,
      ...accessShape(s),
      rawStatus: s.status,
      amount: s.amount_minor != null ? formatPrice(s.amount_minor, s.currency || 'NGN') : null,
      promoCode: s.promo_code || null,
      answers: Array.isArray(s.answers) ? s.answers : JSON.parse(s.answers || '[]'),
      note: s.note || null,
      updatedAt: new Date(s.updated_at).toISOString(),
    })),
  });
});

membershipsApp.post('/memberships/manage/:id/grant', async (c) => {
  adminOnly(c);
  const me = c.get('user');
  const m = await managed(c, uuidParam(c));
  const b = await body(c);
  const u = await resolveUser(c.env, b);
  if (!u) throw bad('User not found — use their @handle or name', 'USER_NOT_FOUND');
  let until = null;
  if (b.until) {
    until = new Date(`${String(b.until).slice(0, 10)}T23:59:59Z`);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) throw bad('The end date must be in the future', 'BAD_DATE');
  } else if (b.days) {
    until = new Date(Date.now() + int(b.days, { min: 1, max: 3650, field: 'days' }) * 86400e3);
  }
  // a grant before publishing has no conversations yet — ensureConversations() adds every subscriber on publish
  const sub = await activateSubscription(c.env, {
    membership: m, userId: u.id, source: 'admin_grant', until, grantedBy: me.id,
    note: b.note ? str(b.note, { max: 300, field: 'note' }) : null,
  });
  await audit(c.env, me, 'membership.grant', 'membership', m.id, { userId: u.id, until: until ? until.toISOString() : null });
  return c.json({ user: { id: u.id, name: u.display_name }, ...accessShape(sub) });
});

membershipsApp.post('/memberships/manage/:id/revoke', async (c) => {
  adminOnly(c);
  const me = c.get('user');
  const m = await managed(c, uuidParam(c));
  const b = await body(c);
  const u = await resolveUser(c.env, b);
  if (!u) throw bad('User not found', 'USER_NOT_FOUND');
  const row = await endSubscription(c.env, m, u.id, b.refund ? 'refunded' : 'expired');
  if (!row) throw notFound('That person has no subscription to this membership');
  await audit(c.env, me, 'membership.revoke', 'membership', m.id, { userId: u.id, refund: !!b.refund });
  return c.json({ user: { id: u.id, name: u.display_name }, ...accessShape(row) });
});

membershipsApp.get('/memberships/manage/:id/reviews', async (c) => {
  const m = await managed(c, uuidParam(c));
  const rows = await q(c.env, `SELECT r.*, u.display_name, u.handle, u.avatar_url FROM membership_reviews r JOIN users u ON u.id = r.user_id
    WHERE r.membership_id = $1 ORDER BY r.created_at DESC LIMIT 500`, [m.id]);
  return c.json({ items: rows.map(reviewShape) });
});

membershipsApp.post('/memberships/manage/reviews/:reviewId/hide', async (c) => {
  adminOnly(c);
  const me = c.get('user');
  const b = await body(c);
  const row = await one(c.env, 'UPDATE membership_reviews SET hidden = $2, updated_at = now() WHERE id = $1 RETURNING membership_id',
    [uuidParam(c, 'reviewId'), b.hidden !== false]);
  if (!row) throw notFound('Review not found');
  await recomputeStats(c.env, row.membership_id);
  await audit(c.env, me, b.hidden !== false ? 'membership.review.hide' : 'membership.review.show', 'membership_review', c.req.param('reviewId'));
  return c.json({ ok: true, hidden: b.hidden !== false });
});

membershipsApp.post('/memberships/manage/expire-now', async (c) => {
  adminOnly(c);
  return c.json({ expired: await expireDue(c.env) });
});

// MEMBERSHIP GROUPS: registered before /memberships/:ref so /memberships/welcome isn't read as a slug
mountGroupRoutes(membershipsApp, { visibleMembership, requireAccess, canManage, origin });

// ======================================================================================================
// App
// ======================================================================================================
membershipsApp.get('/memberships', async (c) => {
  const category = String(c.req.query('category') || '').trim();
  const term = String(c.req.query('q') || '').trim().slice(0, 80);
  const sort = String(c.req.query('sort') || 'trending');
  const offset = Math.max(0, Math.min(5000, Number(c.req.query('offset')) || 0));
  const order = {
    newest: 'm.published_at DESC NULLS LAST, m.created_at DESC',
    price_low: 'min_price ASC NULLS LAST, m.trending_score DESC',
    price_high: 'min_price DESC NULLS LAST, m.trending_score DESC',
  }[sort] || 'm.trending_score DESC, m.published_at DESC';
  // MEMBERSHIP GROUPS: private groups are reachable by link only
  const where = `m.status = 'published' AND COALESCE(m.group_settings->>'visibility', 'public') <> 'private' AND ($1 = '' OR m.category = $1) AND ($2 = '' OR m.title ILIKE $3 OR m.headline ILIKE $3 OR m.category ILIKE $3)`;
  const params = [category, term, `%${term.replace(/[%_]/g, '')}%`];
  const rows = await q(c.env, `SELECT m.*, (SELECT min(p.price_minor) FROM membership_plans p WHERE p.membership_id = m.id AND p.active) AS min_price
    FROM memberships m WHERE ${where} ORDER BY ${order} LIMIT 30 OFFSET ${offset}`, params);
  const total = await one(c.env, `SELECT count(*)::int AS n FROM memberships m WHERE ${where}`, params);
  const cats = await q(c.env, `SELECT category, count(*)::int AS n FROM memberships WHERE status = 'published' AND COALESCE(group_settings->>'visibility', 'public') <> 'private' GROUP BY category ORDER BY n DESC, category`);
  const all = await one(c.env, `SELECT count(*)::int AS n FROM memberships WHERE status = 'published' AND COALESCE(group_settings->>'visibility', 'public') <> 'private'`);
  return c.json({
    items: await cards(c.env, origin(c), rows),
    total: total.n,
    nextOffset: offset + rows.length < total.n ? offset + rows.length : null,
    categories: [{ name: 'All', count: all.n }, ...cats.map((r) => ({ name: r.category, count: r.n }))],
  });
});

membershipsApp.get('/memberships/mine', async (c) => {
  const me = c.get('user');
  await expireDue(c.env, { userId: me.id });
  const rows = await q(c.env, `SELECT m.*, row_to_json(s.*) AS sub,
      (p.user_id IS NOT NULL AND p.welcome_seen_at IS NULL) AS welcome_pending
    FROM membership_subscriptions s JOIN memberships m ON m.id = s.membership_id
    LEFT JOIN membership_member_prefs p ON p.membership_id = m.id AND p.user_id = s.user_id
    WHERE s.user_id = $1 AND s.status <> 'refunded' AND m.status <> 'draft' ORDER BY s.updated_at DESC LIMIT 100`, [me.id]);
  const list = await cards(c.env, origin(c), rows);
  const items = rows.map((r, i) => {
    const sub = typeof r.sub === 'string' ? JSON.parse(r.sub) : r.sub;
    const access = accessShape(sub);
    return { ...list[i], access, channelId: access.active ? r.channel_id : null, communityId: access.active ? r.community_id : null, welcomePending: access.active && !!r.welcome_pending };
  }).sort((a, b) => Number(b.access.active) - Number(a.access.active));
  return c.json({ items });
});

membershipsApp.get('/memberships/:ref', async (c) => {
  const me = c.get('user');
  const m = await visibleMembership(c, c.req.param('ref'));
  await expireDue(c.env, { userId: me.id, membershipId: m.id });
  const plans = await plansOf(c.env, [m.id]);
  const owner = m.owner_id ? await one(c.env, 'SELECT * FROM users WHERE id = $1', [m.owner_id]) : null;
  const sub = await subscriptionOf(c.env, m.id, me.id);
  const access = accessShape(sub);
  // MEMBERSHIP GROUPS: the group owner and its admins open the group from here too
  const staff = canManage(c.env, me, m) || (await actorIn(c.env, m, me)).staff;
  const reviews = await q(c.env, `SELECT r.*, u.display_name, u.handle, u.avatar_url FROM membership_reviews r JOIN users u ON u.id = r.user_id
    WHERE r.membership_id = $1 AND NOT r.hidden ORDER BY r.created_at DESC LIMIT 5`, [m.id]);
  const mine = await one(c.env, `SELECT r.*, u.display_name, u.handle, u.avatar_url FROM membership_reviews r JOIN users u ON u.id = r.user_id
    WHERE r.membership_id = $1 AND r.user_id = $2`, [m.id, me.id]);
  const samples = await q(c.env, `SELECT * FROM membership_lessons WHERE membership_id = $1 ORDER BY is_sample DESC, position LIMIT 3`, [m.id]);
  const lessonCount = await one(c.env, 'SELECT count(*)::int AS n FROM membership_lessons WHERE membership_id = $1', [m.id]);
  const open = staff || access.active;
  return c.json({
    ...cardShape(c.env, origin(c), m, plans),
    description: m.description || '',
    benefits: benefitsOf(m),
    faqs: faqsOf(m),
    questions: questionsOf(m),
    plans: plans.map(planShape),
    creator: creatorShape(m, owner),
    reviews: reviews.map(reviewShape),
    myReview: mine ? reviewShape(mine) : null,
    canReview: !!sub && sub.status !== 'refunded' && !mine,
    sampleLessons: samples.map((l) => ({ id: l.id, title: l.title, kind: l.kind, minutes: l.minutes || null })),
    lessonCount: lessonCount.n,
    access,
    isStaff: staff,
    purchasable: m.status === 'published' && plans.length > 0,
    channelId: open ? m.channel_id : null,
    communityId: open ? m.community_id : null,
    // MEMBERSHIP GROUPS: joining rules for the Join button
    free: !!(await freePlanOf(c.env, m)),
    joinMode: groupSettingsOf(m).joinMode,
    visibility: groupSettingsOf(m).visibility,
    joinRequest: await joinRequestOf(c.env, m, me.id),
  });
});

membershipsApp.get('/memberships/:id/reviews', async (c) => {
  const m = await visibleMembership(c, uuidParam(c));
  const offset = Math.max(0, Math.min(10000, Number(c.req.query('offset')) || 0));
  const rows = await q(c.env, `SELECT r.*, u.display_name, u.handle, u.avatar_url FROM membership_reviews r JOIN users u ON u.id = r.user_id
    WHERE r.membership_id = $1 AND NOT r.hidden ORDER BY r.created_at DESC LIMIT 30 OFFSET ${offset}`, [m.id]);
  const breakdown = await q(c.env, `SELECT rating, count(*)::int AS n FROM membership_reviews WHERE membership_id = $1 AND NOT hidden GROUP BY rating`, [m.id]);
  return c.json({
    items: rows.map(reviewShape),
    rating: { avg: Number(m.rating_avg || 0), count: Number(m.rating_count || 0) },
    breakdown: [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: (breakdown.find((x) => Number(x.rating) === s) || { n: 0 }).n })),
    nextOffset: rows.length === 30 ? offset + 30 : null,
  });
});

function reviewInput(b) {
  const rating = int(b.rating, { min: 1, max: 5, field: 'rating' });
  return { rating, text: str(b.body || '', { max: 2000, field: 'body' }) };
}
membershipsApp.post('/memberships/:id/reviews', async (c) => {
  const me = c.get('user');
  const m = await visibleMembership(c, uuidParam(c));
  const f = reviewInput(await body(c));
  const sub = await subscriptionOf(c.env, m.id, me.id);
  if (!sub || sub.status === 'refunded') throw forbidden('Only members (current or past) can review this membership', 'MEMBERS_ONLY');
  const row = await one(c.env, `INSERT INTO membership_reviews (membership_id, user_id, rating, body) VALUES ($1,$2,$3,$4)
    ON CONFLICT (membership_id, user_id) DO NOTHING RETURNING id`, [m.id, me.id, f.rating, f.text]);
  if (!row) throw new ApiError(409, 'ALREADY_REVIEWED', 'You’ve already reviewed this membership — edit your review instead');
  await recomputeStats(c.env, m.id);
  const full = await one(c.env, `SELECT r.*, u.display_name, u.handle, u.avatar_url FROM membership_reviews r JOIN users u ON u.id = r.user_id WHERE r.id = $1`, [row.id]);
  return c.json(reviewShape(full), 201);
});
membershipsApp.patch('/memberships/:id/reviews/mine', async (c) => {
  const me = c.get('user');
  const m = await visibleMembership(c, uuidParam(c));
  const f = reviewInput(await body(c));
  const row = await one(c.env, `UPDATE membership_reviews SET rating = $3, body = $4, updated_at = now() WHERE membership_id = $1 AND user_id = $2 RETURNING id`,
    [m.id, me.id, f.rating, f.text]);
  if (!row) throw notFound('You haven’t reviewed this membership yet');
  await recomputeStats(c.env, m.id);
  const full = await one(c.env, `SELECT r.*, u.display_name, u.handle, u.avatar_url FROM membership_reviews r JOIN users u ON u.id = r.user_id WHERE r.id = $1`, [row.id]);
  return c.json(reviewShape(full));
});
membershipsApp.delete('/memberships/:id/reviews/mine', async (c) => {
  const me = c.get('user');
  const m = await visibleMembership(c, uuidParam(c));
  await q(c.env, 'DELETE FROM membership_reviews WHERE membership_id = $1 AND user_id = $2', [m.id, me.id]);
  await recomputeStats(c.env, m.id);
  return c.json({ ok: true });
});

// ----- checkout -----
async function purchasable(c) {
  const m = await visibleMembership(c, uuidParam(c));
  if (m.status !== 'published') throw bad('This membership isn’t open to new members', 'NOT_AVAILABLE');
  return m;
}
async function planFor(env, m, planId) {
  if (!isUuid(planId)) throw bad('Choose a plan', 'BAD_PLAN');
  const p = await one(env, 'SELECT * FROM membership_plans WHERE id = $1 AND membership_id = $2 AND active', [planId, m.id]);
  if (!p) throw bad('That plan isn’t available', 'BAD_PLAN');
  return p;
}
async function promoFor(env, m, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const p = await one(env, `SELECT * FROM membership_promos WHERE membership_id = $1 AND code = $2 AND active
    AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR uses < max_uses)`, [m.id, c]);
  if (!p) throw bad('That promo code isn’t valid', 'BAD_PROMO');
  return p;
}
const quote = (plan, promo) => {
  const { discountMinor, totalMinor } = applyPromo(plan.price_minor, promo);
  return {
    planId: plan.id,
    priceMinor: Number(plan.price_minor),
    discountMinor,
    totalMinor,
    currency: plan.currency,
    totalLabel: formatPrice(totalMinor, plan.currency),
    discountLabel: discountMinor ? formatPrice(discountMinor, plan.currency) : null,
    promoCode: promo ? promo.code : null,
  };
};

membershipsApp.get('/memberships/:id/checkout', async (c) => {
  const me = c.get('user');
  const m = await purchasable(c);
  const platform = ['android', 'ios', 'web'].includes(c.req.query('platform')) ? c.req.query('platform') : 'android';
  const owner = m.owner_id ? await one(c.env, 'SELECT * FROM users WHERE id = $1', [m.owner_id]) : null;
  const plansNow = await plansOf(c.env, [m.id]);
  const methods = checkoutMethods(c.env, me, platform, { paystack: paystackMethod(c.env, { inApp: await inAppEnabled(c.env), currency: (plansNow[0] && plansNow[0].currency) || 'NGN' }) });
  return c.json({
    seller: creatorShape(m, owner).name,
    plans: (await plansOf(c.env, [m.id])).map(planShape),
    questions: questionsOf(m),
    methods,
    canPay: methods.some((x) => x.available),
    message: methods.some((x) => x.available) ? null : PAYMENTS_SOON,
    testCheckout: testCheckoutAllowed(c.env, me),
  });
});

membershipsApp.post('/memberships/:id/promo', async (c) => {
  const m = await purchasable(c);
  const b = await body(c);
  const plan = await planFor(c.env, m, b.planId);
  return c.json(quote(plan, await promoFor(c.env, m, b.code)));
});

function contactOf(b) {
  const x = b && typeof b === 'object' ? b : {};
  const s = (v, max) => String(v || '').trim().slice(0, max);
  return { email: s(x.email, 200), phone: s(x.phone, 40), name: s(x.name, 120), country: s(x.country, 60), company: !!x.company };
}

membershipsApp.post('/memberships/:id/checkout', async (c) => {
  const me = c.get('user');
  const m = await purchasable(c);
  const b = await body(c);
  const plan = await planFor(c.env, m, b.planId);
  // MEMBERSHIP GROUPS: banned people can't buy their way back in; approval-based groups approve someone new first
  await assertMayJoin(c.env, m, me, { staff: canManage(c.env, me, m) });
  const answers = checkAnswers(questionsOf(m), b.answers);
  if (!b.agree) throw bad('Please agree to the terms to continue', 'TERMS_REQUIRED');
  const promo = await promoFor(c.env, m, b.promoCode);
  const price = quote(plan, promo);
  const contact = contactOf(b.contact);
  const provider = String(b.provider || 'paystack');
  const key = b.idempotencyKey ? String(b.idempotencyKey).slice(0, 80) : null;

  let sub;
  if (provider === 'test') {
    if (!testCheckoutAllowed(c.env, me)) throw paymentsNotConfigured();
    const cur = await subscriptionOf(c.env, m.id, me.id);
    if (key && cur && cur.checkout_key === key && hasAccess(cur)) sub = cur; // double tap / retry → same result
    else {
      if (promo) {
        const used = await one(c.env, `UPDATE membership_promos SET uses = uses + 1 WHERE id = $1 AND (max_uses IS NULL OR uses < max_uses) RETURNING id`, [promo.id]);
        if (!used) throw bad('That promo code has been used up', 'BAD_PROMO');
      }
      sub = await activateSubscription(c.env, {
        membership: m, plan, userId: me.id, source: 'test', answers, contact, promoCode: price.promoCode,
        amountMinor: price.totalMinor, currency: plan.currency, checkoutKey: key,
      });
    }
  } else if (provider === 'paystack') {
    const r = await startMembershipCheckout(c.env, me, { membership: m, plan, price, promo, answers, contact, email: b.email, origin: origin(c) });
    if (!r.free) return c.json({ ok: true, pending: true, checkout: r.checkout, charged: price }, 202);
    sub = r.subscription;
  } else if (provider === 'play') {
    const verified = await verifyPlayPurchase(c.env, { productId: plan.store_product_id, purchaseToken: b.purchaseToken }); // throws PAYMENTS_NOT_CONFIGURED today
    sub = await activateVerifiedPlayPurchase(c.env, { membership: m, plan, userId: me.id, verified, answers, contact, promoCode: price.promoCode });
  } else {
    throw bad('That payment method is coming soon', 'METHOD_UNAVAILABLE');
  }
  const fresh = await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [m.id]);
  return c.json({
    ok: true,
    access: accessShape(sub),
    charged: price,
    membership: cardShape(c.env, origin(c), fresh, await plansOf(c.env, [m.id])),
    channelId: fresh.channel_id,
    communityId: fresh.community_id,
  });
});

membershipsApp.post('/memberships/:id/cancel', async (c) => {
  const me = c.get('user');
  const m = await visibleMembership(c, uuidParam(c));
  const sub = await subscriptionOf(c.env, m.id, me.id);
  if (!hasAccess(sub)) throw bad('You don’t have an active membership here', 'NOT_ACTIVE');
  if (sub.source === 'play') throw bad('Cancel this membership in Google Play › Subscriptions', 'MANAGE_IN_STORE');
  const row = await one(c.env, `UPDATE membership_subscriptions SET status = 'cancelled', auto_renew = false, updated_at = now() WHERE id = $1 RETURNING *`, [sub.id]);
  return c.json({ access: accessShape(row) });
});

// ----- membership home + library (access enforced) -----
async function libraryOf(env, m, userId) {
  const lessons = await q(env, 'SELECT * FROM membership_lessons WHERE membership_id = $1 ORDER BY position, created_at', [m.id]);
  const done = await q(env, 'SELECT lesson_id FROM membership_lesson_progress WHERE user_id = $1 AND membership_id = $2', [userId, m.id]);
  const set = new Set(done.map((d) => d.lesson_id));
  const items = lessons.map((l) => lessonShape(l, set));
  const next = items.find((l) => !l.completed);
  return { items, progress: { done: items.filter((l) => l.completed).length, total: items.length, nextLessonId: next ? next.id : null } };
}

membershipsApp.get('/memberships/:id/home', async (c) => {
  const me = c.get('user');
  const m = await visibleMembership(c, uuidParam(c));
  const { sub, staff } = await requireAccess(c, m);
  if (!staff) await addToConversations(c.env, m, me.id, { quiet: true }); // self-heal if they were removed while active
  const lib = await libraryOf(c.env, m, me.id);
  // MEMBERSHIP GROUPS: my place in the group, the two sections and the once-only welcome pop-up
  const actor = await actorIn(c.env, m, me);
  const prefs = await prefsOf(c.env, m.id, me.id);
  const welcome = !staff && !actor.staff && prefs && !prefs.welcome_seen_at ? { title: m.title, text: welcomeText(m) } : null;
  const groupStaff = staff || actor.staff;
  return c.json({
    membership: cardShape(c.env, origin(c), m, await plansOf(c.env, [m.id])),
    access: groupStaff && !hasAccess(sub) ? { ...accessShape(sub), status: 'staff', active: true, lapsed: false } : accessShape(sub),
    isStaff: groupStaff,
    role: actor.role === 'none' && staff ? 'admin' : actor.role,
    permissions: actor.perms,
    channelId: m.channel_id,
    communityId: m.community_id,
    sections: {
      master: { id: m.channel_id, name: MASTER, title: masterTitle(m.title) },
      executive: { id: m.community_id, name: EXECUTIVE, title: executiveTitle(m.title) },
    },
    welcome,
    library: lib.progress,
  });
});

membershipsApp.get('/memberships/:id/library', async (c) => {
  const me = c.get('user');
  const m = await visibleMembership(c, uuidParam(c));
  await requireAccess(c, m);
  return c.json(await libraryOf(c.env, m, me.id));
});

async function lessonInMembership(c) {
  const m = await visibleMembership(c, uuidParam(c));
  await requireAccess(c, m);
  const l = await one(c.env, 'SELECT * FROM membership_lessons WHERE id = $1 AND membership_id = $2', [uuidParam(c, 'lessonId'), m.id]);
  if (!l) throw notFound('Lesson not found');
  return { m, l };
}
membershipsApp.post('/memberships/:id/lessons/:lessonId/complete', async (c) => {
  const me = c.get('user');
  const { m, l } = await lessonInMembership(c);
  await q(c.env, `INSERT INTO membership_lesson_progress (user_id, lesson_id, membership_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [me.id, l.id, m.id]);
  return c.json((await libraryOf(c.env, m, me.id)).progress);
});
membershipsApp.delete('/memberships/:id/lessons/:lessonId/complete', async (c) => {
  const me = c.get('user');
  const { m, l } = await lessonInMembership(c);
  await q(c.env, 'DELETE FROM membership_lesson_progress WHERE user_id = $1 AND lesson_id = $2', [me.id, l.id]);
  return c.json((await libraryOf(c.env, m, me.id)).progress);
});
