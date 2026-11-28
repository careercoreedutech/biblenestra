// VIRTUAL GIFTS & STARS (client spec §8–§12, §15 C/D/F). Contract + decisions: scratch/monetisation/gifts.md.
//
// Money only moves through the wallet core (lib/wallet.js):
//   send      postGift()           sender gift_coins −coins · platform commission_gift_coins +commission ·
//                                  recipient gift_earnings (pending) +earnings — ONE atomic, idempotent op 'gift:<sendId>'.
//                                  The gift_sends row (and, in a chat, the 'gift' message) commit in the same transaction.
//   release   releaseMaturedEarnings() (core cron)   pending → available after earnings_hold_days.
//   withdraw  holdForWithdrawal / completeWithdrawal / reverseWithdrawal   available → withdrawing → withdrawn (or back).
// Split: commission = floor(coins × bps / 10000) (core splitGift), earnings = coins − commission, so the legs always sum
// exactly to the gift value and any rounding remainder goes to the recipient. bps is read ONCE per send and stored on
// gift_sends, so a commission change only affects new gifts.
// Purchased Gifting Coins can never be withdrawn: a withdrawal only ever debits gift_earnings_available.
import { q, one } from './db.js';
import { ApiError, bad, forbidden, notFound, isUuid, str } from './http.js';
import { mediaUrl, userJson } from './shape.js';
import { notifyUser } from '../hub.js';
import {
  getConfig, registerConfig, postGift, splitGift, rateLimit, walletNotify, getBalances, getBalance,
  holdForWithdrawal, completeWithdrawal, reverseWithdrawal, withdrawalMinimum,
} from './wallet.js';
import { loadMessage } from './messages.js';
import { groupContext, permissionsFor } from './chatGroups.js';
import { useSlotForFirstMessage } from './chatLimits.js';
import { hasAccess, subscriptionOf } from './memberships.js';
import { OFFICIAL_CLERK_ID, ensureOfficialAccount } from './broadcasts.js';
import { requireApprovedKyc } from './kyc.js'; // PAYOUT KYC guard for withdrawals
import { membershipSendGuard } from './membershipGroups.js'; // MEMBERSHIP GROUPS: gifts follow the same send rules as messages

// ─── admin-editable settings (Admin › Wallets & payments › Settings; commission % is the core gift_commission_bps) ──
registerConfig('gifts_enabled', true, (v) => typeof v === 'boolean');                                  // kill switch
registerConfig('gift_daily_coin_limit', 1000000, (v) => Number.isInteger(v) && v >= 0 && v <= 1e9);  // per sender per 24 h (0 = no limit)
registerConfig('gift_admins_can_receive', true, (v) => typeof v === 'boolean');                       // admin + official accounts can receive gifts (client answer Q20)

export const CONTEXTS = ['chat', 'profile', 'live', 'post', 'fundme'];   // where catalogue items can be allowed (gift_catalogue.contexts)
// FUND ME GIFTS: a gift on a fundraiser request goes to the request's creator (context { type: 'fundme', id: fundraiserId }).
export const FUNDME_CONTEXT = 'fundme';
// public = the same rule as the public Fund Me page (routes/fundme.js PUBLIC_COND): live, or approved and not paused by an admin
const FUNDME_PUBLIC = `(f.status = 'live' OR (f.status IN ('paused','closed') AND f.approved_at IS NOT NULL AND COALESCE(f.paused_by, 'owner') <> 'admin'))`;
// SUPPORT BIBLENESTRA: a gift to the official BibleNestra account (users.clerk_id = OFFICIAL_CLERK_ID, the "BibleNestra"
// verified account that posts Socials broadcasts). It is platform revenue: 100% goes to commission_gift_coins and the
// official account earns nothing. Ledger ref 'support:<sendId>' (not 'gift:'), kinds support_sent / support_received.
// Any active gift can be sent this way. A profile gift sent straight to the official account is treated the same way.
export const SUPPORT_CONTEXT = 'support';
export const SUPPORT_LABEL = 'Support BibleNestra';
export const SEND_CONTEXTS = [...CONTEXTS, SUPPORT_CONTEXT];          // context types accepted by POST /gifts/send
export const SUPPORT_BPS = 10000;
export const ART_KEYS = ['star', 'flowers', 'heart', 'teddy', 'letter', 'diamond', 'crown', 'trophy', 'celebration', 'premium'];
const KEY_RE = /^[A-Za-z0-9:_.\-]{8,120}$/;
export const EXPLAIN = (cfg) => {
  const pct = cfg.gift_commission_bps / 100;
  const min = withdrawalMinimum(cfg);
  return [
    `BibleNestra keeps ${pct}% of every gift; you receive ${100 - pct}% as gift earnings.`,
    `New earnings are on hold for ${cfg.earnings_hold_days} day${cfg.earnings_hold_days === 1 ? '' : 's'}, then become available.`,
    `You can withdraw available earnings from ${min.label} once you’re approved for the BibleNestra creator payout programme.`,
    'Gifting Coins you buy are never cash and can never be withdrawn.',
  ];
};
/** The official BibleNestra account (created on first use, like the Socials broadcasts do). → { id, display_name } */
export async function officialAccount(env) {
  const row = await one(env, 'SELECT id, display_name FROM users WHERE clerk_id = $1', [OFFICIAL_CLERK_ID]);
  return row || ensureOfficialAccount(env);
}

// ─── catalogue ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Gifting Coin cost: the admin-set per-item cost, or derived from the admin conversion rate (rounded up). */
export function coinsOf(row, rate) {
  if (row.coins) return Number(row.coins);
  const r = rate || { coins: 1, perMinor: 100 };
  return Math.max(1, Math.ceil((Number(row.price_minor) * Number(r.coins)) / Number(r.perMinor)));
}
const origin = (c) => new URL(c.req.url).origin;
export function giftShape(c, row, rate, { admin = false } = {}) {
  const url = (k) => (k ? mediaUrl(c.env, origin(c), k) : null);
  const out = {
    id: row.id, name: row.name, description: row.description || null, coins: coinsOf(row, rate),
    priceMinor: Number(row.price_minor), currency: row.currency, tier: row.tier, art: row.art,
    imageUrl: url(row.image_key), animationUrl: url(row.animation_key), contexts: row.contexts || CONTEXTS, active: !!row.active, sort: row.sort,
  };
  if (admin) Object.assign(out, { coinsOverride: row.coins == null ? null : Number(row.coins), imageKey: row.image_key, animationKey: row.animation_key, updatedAt: row.updated_at });
  return out;
}
export async function listCatalogue(c, { all = false, context = null } = {}) {
  const cfg = await getConfig(c.env);
  const rows = await q(c.env, `SELECT * FROM gift_catalogue WHERE ($1::boolean OR active) AND ($2::text IS NULL OR $2 = ANY(contexts)) ORDER BY sort, price_minor, id`,
    [!!all, context && CONTEXTS.includes(context) ? context : null]);
  return { cfg, items: rows.map((r) => giftShape(c, r, cfg.gift_coin_rate, { admin: all })) };
}

/** Clean admin input for a catalogue row. partial = PATCH. */
export function cleanGiftInput(b, { partial = false } = {}) {
  const o = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has('name')) o.name = str(b.name, { min: 1, max: 60, field: 'name' });
  if (has('description')) o.description = str(b.description || '', { max: 200, field: 'description' }) || null;
  if (!partial || has('priceMinor')) {
    const p = Number(b.priceMinor);
    if (!Number.isSafeInteger(p) || p < 0 || p > 1e12) throw bad('priceMinor must be a whole number of kobo', 'BAD_PRICE');
    o.price_minor = p;
  }
  if (has('currency')) { if (!/^[A-Z]{3}$/.test(String(b.currency))) throw bad('currency must be like NGN', 'BAD_PRICE'); o.currency = b.currency; }
  if (has('coins')) {
    if (b.coins === null || b.coins === '') o.coins = null;
    else { const n = Number(b.coins); if (!Number.isInteger(n) || n < 1 || n > 1e8) throw bad('coins must be a whole number ≥ 1 (or empty to follow the conversion rate)', 'BAD_PRICE'); o.coins = n; }
  }
  if (has('tier')) { if (!['standard', 'premium'].includes(b.tier)) throw bad('tier must be standard or premium'); o.tier = b.tier; }
  if (has('art')) { if (!ART_KEYS.includes(b.art)) throw bad(`art must be one of ${ART_KEYS.join(', ')}`); o.art = b.art; }
  if (has('contexts')) {
    if (!Array.isArray(b.contexts) || !b.contexts.length || b.contexts.some((x) => !CONTEXTS.includes(x))) throw bad(`contexts must be some of ${CONTEXTS.join(', ')}`);
    o.contexts = [...new Set(b.contexts)];
  }
  if (has('active')) o.active = !!b.active;
  if (has('sort')) { const s = Number(b.sort); if (!Number.isInteger(s) || Math.abs(s) > 1e6) throw bad('sort must be a whole number'); o.sort = s; }
  return o;
}

// ─── ids ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Deterministic uuid from a string (so a retried request with the same key maps to the same rows). */
export async function hashUuid(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
  d[6] = (d[6] & 0x0f) | 0x50; d[8] = (d[8] & 0x3f) | 0x80;
  const h = [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const idemKey = (v) => {
  const k = String(v || '');
  if (!KEY_RE.test(k)) throw bad('idempotencyKey is required (8-120 chars of A-Z a-z 0-9 : _ . -)', 'BAD_IDEMPOTENCY_KEY');
  return k;
};

// ─── context checks (spec §8) ───────────────────────────────────────────────────────────────────────────────────────
/** → { recipientId, contextType, contextId, conv? } or throws. */
export async function resolveContext(env, me, context, recipientIn) {
  const type = context && String(context.type || '');
  const id = context && context.id != null ? String(context.id) : '';
  const rid = recipientIn ? String(recipientIn) : null;
  if (rid && !isUuid(rid)) throw bad('Choose who receives the gift', 'BAD_RECIPIENT');
  if (!SEND_CONTEXTS.includes(type)) throw bad(`context.type must be one of ${SEND_CONTEXTS.join(', ')}`, 'BAD_CONTEXT');
  if (type === SUPPORT_CONTEXT) {
    const off = await officialAccount(env);
    if (rid && rid !== off.id) throw bad('A Support BibleNestra gift goes to BibleNestra', 'BAD_RECIPIENT');
    return { recipientId: off.id, contextType: type, contextId: off.id };
  }
  if (type === FUNDME_CONTEXT) {
    if (!isUuid(id)) throw bad('context.id is required', 'BAD_CONTEXT');
    const f = await one(env, `SELECT f.id, f.owner_id FROM fundraisers f WHERE f.id = $1 AND ${FUNDME_PUBLIC}`, [id]);
    if (!f) throw notFound('That fundraiser is no longer available');
    if (rid && rid !== f.owner_id) throw bad('A fundraiser gift goes to the person who created the request', 'BAD_RECIPIENT');
    return { recipientId: f.owner_id, contextType: type, contextId: id };
  }
  if (type === 'profile') {
    const pid = id || rid;
    if (!isUuid(pid) || (rid && rid !== pid)) throw bad('A profile gift goes to that profile’s owner', 'BAD_CONTEXT');
    return { recipientId: pid, contextType: type, contextId: pid };
  }
  if (!isUuid(id)) throw bad('context.id is required', 'BAD_CONTEXT');
  if (type === 'post') {
    const p = await one(env, 'SELECT id, author_id FROM posts WHERE id = $1 AND NOT removed', [id]);
    if (!p) throw notFound('That post is no longer available');
    if (rid && rid !== p.author_id) throw bad('A post gift goes to the post’s author', 'BAD_RECIPIENT');
    return { recipientId: p.author_id, contextType: type, contextId: id };
  }
  if (type === 'live') {
    const s = await one(env, 'SELECT id, host_id, status FROM live_sessions WHERE id = $1', [id]);
    if (!s) throw notFound('Live session not found');
    if (s.status !== 'live') throw bad('This live session has ended', 'LIVE_ENDED');
    if (rid && rid !== s.host_id) throw bad('A live gift goes to the host', 'BAD_RECIPIENT');
    return { recipientId: s.host_id, contextType: type, contextId: id };
  }
  // chat: private chats and community/group chats (dating chats are chats too). Not broadcast channels.
  const gctx = await groupContext(env, id, me.id, { allowNonMember: true });
  if (!gctx.role) throw forbidden('You can only send gifts in chats you’re a member of', 'NOT_A_MEMBER');
  const conv = gctx.conv;
  if (conv.kind === 'channel') throw bad('Gifts can be sent in private chats and groups, not channels', 'GIFT_NOT_ALLOWED_HERE');
  if (!permissionsFor(gctx).canSend) throw forbidden('Only admins can send messages in this group', 'ADMINS_ONLY_SEND');
  // MEMBERSHIP GROUPS: the same send guard as chat messages (muted / suspended members, who-can-send rules)
  await membershipSendGuard(env, id, me, { kind: 'gift' });
  if (conv.membership_id && gctx.role === 'member' && me.role !== 'admin') {
    const sub = await subscriptionOf(env, conv.membership_id, me.id);
    if (!hasAccess(sub)) throw forbidden('Your membership has ended', 'MEMBERSHIP_REQUIRED');
  }
  let to = rid;
  if (conv.kind === 'dm') {
    const other = await one(env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 LIMIT 1', [id, me.id]);
    if (!other || (rid && rid !== other.user_id)) throw bad('Choose someone in this chat', 'BAD_RECIPIENT');
    to = other.user_id;
  } else {
    if (!to) throw bad('Choose who in the group receives the gift', 'BAD_RECIPIENT');
    const m = await one(env, 'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [id, to]);
    if (!m) throw bad('That person isn’t in this group', 'BAD_RECIPIENT');
  }
  return { recipientId: to, contextType: type, contextId: id, conv };
}

// ─── shapes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
export function sendShape(c, r, rate, viewerId = null) {
  const gift = r.g_id ? giftShape(c, { id: r.g_id, name: r.g_name, description: null, price_minor: r.g_price, currency: r.g_currency, coins: r.g_coins, tier: r.g_tier, art: r.g_art, image_key: r.g_image, animation_key: r.g_anim, contexts: r.g_contexts, active: r.g_active, sort: 0 }, rate) : null;
  const mine = viewerId && r.sender_id === viewerId;
  const support = String(r.ref || '').startsWith('support:');
  const out = {
    id: r.id, ref: r.ref, giftId: r.gift_id, giftName: r.gift_name, support, label: support ? SUPPORT_LABEL : null,
    gift: gift ? { id: gift.id, name: r.gift_name, art: gift.art, tier: gift.tier, imageUrl: gift.imageUrl, animationUrl: gift.animationUrl } : { id: r.gift_id, name: r.gift_name },
    coins: Number(r.coins), commission: Number(r.commission), earnings: Number(r.earnings), commissionPct: Number(r.commission_bps) / 100,
    sender: parse(r.sender) || null, recipient: parse(r.recipient) || null,
    context: { type: r.context_type, id: r.context_id }, messageId: r.message_id || null, note: r.note || null,
    createdAt: new Date(r.created_at).toISOString(),
  };
  if (viewerId) out.direction = mine ? 'sent' : 'received';
  return out;
}
export const SEND_SELECT = `SELECT s.*, g.id AS g_id, g.price_minor AS g_price, g.currency AS g_currency, g.coins AS g_coins, g.tier AS g_tier, g.art AS g_art,
    g.image_key AS g_image, g.animation_key AS g_anim, g.contexts AS g_contexts, g.active AS g_active, g.name AS g_name,
    CASE WHEN su.id IS NULL THEN NULL ELSE ${userJson('su')} END AS sender,
    CASE WHEN ru.id IS NULL THEN NULL ELSE ${userJson('ru')} END AS recipient
  FROM gift_sends s
  LEFT JOIN gift_catalogue g ON g.id = s.gift_id
  LEFT JOIN users su ON su.id = s.sender_id
  LEFT JOIN users ru ON ru.id = s.recipient_id`;

// ─── send (spec §12) ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * sendGift(c, me, { giftId, recipientId?, context: { type, id }, note?, idempotencyKey })
 * → { ok, duplicate, send, split, balance, message? }
 */
export async function sendGift(c, me, b) {
  const env = c.env;
  const key = idemKey(b.idempotencyKey);
  const giftId = str(b.giftId, { min: 1, max: 41, field: 'giftId' });
  const note = str(b.note || '', { max: 140, field: 'note' }) || null;
  const sendId = await hashUuid(`gift:${me.id}:${key}`);

  // a retry (same key) returns the first result and never charges twice
  const prev = await one(env, `${SEND_SELECT} WHERE s.id = $1`, [sendId]);
  if (prev) return replay(c, me, prev, giftId);

  const cfg = await getConfig(env);
  if (!cfg.gifts_enabled) throw new ApiError(503, 'GIFTS_PAUSED', 'Gifts are paused for a moment. Nothing was charged.');
  await rateLimit(env, `gift_send:${me.id}`, 30, 60);
  const gift = await one(env, 'SELECT * FROM gift_catalogue WHERE id = $1', [giftId]);
  if (!gift) throw notFound('Gift not found');
  if (!gift.active) throw bad('This gift isn’t available any more', 'GIFT_INACTIVE');
  const target = await resolveContext(env, me, b.context, b.recipientId);
  // Support BibleNestra accepts any active gift; other contexts follow the gift's allowed contexts
  if (target.contextType !== SUPPORT_CONTEXT && !(gift.contexts || CONTEXTS).includes(target.contextType)) throw bad('This gift can’t be sent here', 'GIFT_NOT_ALLOWED_HERE');

  // eligibility
  const to = target.recipientId;
  if (to === me.id) throw bad('You cannot send a gift to yourself', 'SELF_GIFT');
  const recipient = await one(env, 'SELECT id, display_name, role, banned, clerk_id FROM users WHERE id = $1', [to]);
  if (!recipient || recipient.banned) throw notFound('Recipient not found');
  // every gift to the official account is platform revenue (Support BibleNestra), whatever the context
  const support = recipient.clerk_id === OFFICIAL_CLERK_ID;
  if (!support && recipient.role === 'admin' && !cfg.gift_admins_can_receive) throw bad('This account can’t receive gifts', 'RECIPIENT_NOT_ELIGIBLE');
  const blocked = await one(env, 'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [me.id, to]);
  if (blocked) throw forbidden('You cannot send gifts to this person', 'BLOCKED');

  const coins = coinsOf(gift, cfg.gift_coin_rate);
  if (cfg.gift_daily_coin_limit > 0) {
    const day = await one(env, `SELECT COALESCE(sum(coins), 0)::bigint AS n FROM gift_sends WHERE sender_id = $1 AND created_at > now() - interval '1 day'`, [me.id]);
    if (Number(day.n) + coins > cfg.gift_daily_coin_limit) throw new ApiError(429, 'GIFT_DAILY_LIMIT', 'You’ve reached today’s gifting limit. Please try again tomorrow.');
  }
  // cheap pre-check (the ledger re-checks atomically) so a short balance never uses up a chat slot
  const have = await getBalance(env, me.id, 'gift_coins');
  if (have < coins) {
    const err = new ApiError(402, 'INSUFFICIENT_BALANCE', `Not enough Gifting Coins: you have ${have}, this gift needs ${coins}.`);
    err.details = { wallet: 'gift_coins', balance: have, needed: coins, shortBy: coins - have };
    throw err;
  }
  // CHAT LIMITS: a gift as the first message of a new 1:1 chat uses a chat slot, like any first message
  if (target.conv && target.conv.kind === 'dm') await useSlotForFirstMessage(env, me, target.contextId, to);

  // read once: the row and the ledger use the same rate. Support BibleNestra: 100% to the platform, no earnings.
  const bps = support ? SUPPORT_BPS : cfg.gift_commission_bps;
  const split = splitGift(coins, bps);
  const ref = support ? `support:${sendId}` : `gift:${sendId}`;
  const msgId = target.conv ? await hashUuid(`giftmsg:${sendId}`) : null;
  const alsoRun = [[
    `INSERT INTO gift_sends (id, ref, sender_id, recipient_id, gift_id, gift_name, coins, commission, earnings, commission_bps, context_type, context_id, message_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
    [sendId, ref, me.id, to, gift.id, gift.name, split.coins, split.commission, split.earnings, bps, target.contextType, target.contextId, msgId, note],
  ]];
  if (msgId) {
    const meta = { vgift: { sendId, giftId: gift.id, name: gift.name, art: gift.art, tier: gift.tier, coins, toUserId: to, toName: recipient.display_name, note } };
    const text = `🎁 ${gift.name}${note ? ` — ${note}` : ''}`;
    alsoRun.push(
      [`INSERT INTO messages (id, conversation_id, sender_id, kind, body, meta, client_id) VALUES ($1,$2,$3,'gift',$4,$5::jsonb,$6) ON CONFLICT (id) DO NOTHING`,
        [msgId, target.contextId, me.id, text, JSON.stringify(meta), key]],
      ['UPDATE conversations SET last_message_at = now() WHERE id = $1', [target.contextId]],
      ['UPDATE conversation_members SET last_read_at = now(), last_sent_at = now(), typing_at = NULL WHERE conversation_id = $1 AND user_id = $2', [target.contextId, me.id]],
    );
  }
  const r = await postGift(env, {
    ref, senderId: me.id, recipientId: to, coins, giftId: gift.id, relatedType: 'gift_send', relatedId: sendId,
    meta: { context: target.contextType, contextId: target.contextId, giftName: gift.name, ...(support ? { support: true } : {}) }, bps, alsoRun,
    kinds: support ? { sent: 'support_sent', commission: 'support_received' } : null,
  });
  const row = await one(env, `${SEND_SELECT} WHERE s.id = $1`, [sendId]);
  if (!r.applied) return replay(c, me, row, giftId);

  const send = sendShape(c, row, cfg.gift_coin_rate, me.id);
  const senderLeg = r.entries.find((e) => e.wallet === 'gift_coins');
  let message = null;
  if (msgId) {
    message = await loadMessage(env, msgId, me.id);
    const others = await q(env, 'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [target.contextId, me.id]);
    await Promise.all(others.map(async (m) => {
      const forThem = await loadMessage(env, msgId, m.user_id);
      if (forThem) await notifyUser(env, m.user_id, { type: 'message.new', conversationId: target.contextId, message: forThem }).catch(() => {});
    }));
  }
  if (target.contextType === 'live') await notifyUser(env, to, { type: 'gift.live', sessionId: target.contextId, send }).catch(() => {});
  if (support) {
    // platform revenue: nobody to notify on the receiving side; thank the sender
    await walletNotify(c, {
      userId: me.id, kind: 'gift', title: `🙏 Thank you for supporting BibleNestra`,
      body: `${SUPPORT_LABEL}: you sent ${gift.name} (${coins.toLocaleString('en-US')} Gifting Coins). It all goes to keeping BibleNestra running.`,
      data: { wallet: 'gift_coins', screen: 'GiftHistory', sendId },
    });
    return { ok: true, duplicate: false, send, split: { ...split, bps }, balance: senderLeg ? senderLeg.balanceAfter : null, message };
  }
  const where = { chat: 'in your chat', profile: 'on your profile', live: 'during your live session', post: 'on your post', fundme: 'on your Fund Me request' }[target.contextType];
  await walletNotify(c, {
    userId: to, kind: 'gift', title: `🎁 You received ${gift.name}`,
    body: `${me.display_name || 'Someone'} sent you ${gift.name} ${where}. +${split.earnings.toLocaleString('en-US')} coins gift earnings (${100 - bps / 100}% of the gift), available after ${cfg.earnings_hold_days} days.`,
    data: { wallet: 'gift_earnings', screen: 'GiftEarnings', sendId, giftId: gift.id, ...(msgId ? { conversationId: target.contextId } : {}) },
  });
  await walletNotify(c, {
    userId: me.id, kind: 'gift', title: `Gift sent: ${gift.name}`,
    body: `You sent ${gift.name} to ${recipient.display_name} (${coins.toLocaleString('en-US')} Gifting Coins).`,
    data: { wallet: 'gift_coins', screen: 'GiftHistory', sendId },
  });
  return { ok: true, duplicate: false, send, split: { ...split, bps }, balance: senderLeg ? senderLeg.balanceAfter : null, message };
}
async function replay(c, me, row, giftId) {
  if (!row) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'That request was already used');
  if (row.sender_id !== me.id || row.gift_id !== giftId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'That request key was already used for a different gift');
  const cfg = await getConfig(c.env);
  const message = row.message_id ? await loadMessage(c.env, row.message_id, me.id) : null;
  return {
    ok: true, duplicate: true, send: sendShape(c, row, cfg.gift_coin_rate, me.id),
    split: { coins: Number(row.coins), commission: Number(row.commission), earnings: Number(row.earnings), bps: Number(row.commission_bps) },
    balance: (await getBalances(c.env, me.id)).gift_coins, message,
  };
}

// ─── histories, wall ────────────────────────────────────────────────────────────────────────────────────────────────
const decodeCur = (s) => {
  if (!s) return null;
  const [t, id] = String(s).split('|');
  return t && isUuid(id) && !Number.isNaN(Date.parse(t)) ? { t, id } : null;
};
const encodeCur = (r) => `${new Date(r.created_at).toISOString()}|${r.id}`;
export async function giftHistory(c, userId, { dir = 'all', cursor = null, limit = 30 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const cur = decodeCur(cursor);
  const where = dir === 'sent' ? 's.sender_id = $1' : dir === 'received' ? 's.recipient_id = $1' : '(s.sender_id = $1 OR s.recipient_id = $1)';
  const rows = await q(c.env, `${SEND_SELECT} WHERE ${where} AND ($2::timestamptz IS NULL OR (s.created_at, s.id) < ($2::timestamptz, $3::uuid))
    ORDER BY s.created_at DESC, s.id DESC LIMIT $4`, [userId, cur ? cur.t : null, cur ? cur.id : null, lim]);
  const cfg = await getConfig(c.env);
  const totals = await one(c.env, `SELECT
      COUNT(*) FILTER (WHERE sender_id = $1)::int AS sent_count, COALESCE(SUM(coins) FILTER (WHERE sender_id = $1), 0)::bigint AS sent_coins,
      COUNT(*) FILTER (WHERE recipient_id = $1)::int AS received_count, COALESCE(SUM(earnings) FILTER (WHERE recipient_id = $1), 0)::bigint AS received_earnings
    FROM gift_sends WHERE sender_id = $1 OR recipient_id = $1`, [userId]);
  return {
    items: rows.map((r) => sendShape(c, r, cfg.gift_coin_rate, userId)),
    nextCursor: rows.length === lim ? encodeCur(rows[rows.length - 1]) : null,
    totals: { sentCount: totals.sent_count, sentCoins: Number(totals.sent_coins), receivedCount: totals.received_count, receivedEarnings: Number(totals.received_earnings) },
  };
}
/** Gifts wall on a profile: counts per gift (all contexts) + recent gifts from PUBLIC contexts (profile, live, post). */
export async function giftWall(c, userId) {
  const cfg = await getConfig(c.env);
  const counts = await q(c.env, `SELECT s.gift_id, COUNT(*)::int AS n, g.* FROM gift_sends s JOIN gift_catalogue g ON g.id = s.gift_id
    WHERE s.recipient_id = $1 GROUP BY s.gift_id, g.id ORDER BY g.sort, g.price_minor`, [userId]);
  const recent = await q(c.env, `${SEND_SELECT} WHERE s.recipient_id = $1 AND s.context_type IN ('profile','live','post') ORDER BY s.created_at DESC LIMIT 12`, [userId]);
  const total = counts.reduce((a, r) => a + r.n, 0);
  return {
    total,
    gifts: counts.map((r) => ({ ...giftShape(c, r, cfg.gift_coin_rate), count: r.n })),
    recent: recent.map((r) => { const s = sendShape(c, r, cfg.gift_coin_rate); return { id: s.id, gift: s.gift, sender: s.sender, context: s.context, createdAt: s.createdAt }; }),
  };
}

// ─── earnings, creator programme, withdrawals (spec §11, §15 D) ─────────────────────────────────────────────────────
const mask = (n) => (n ? `•••• ${String(n).slice(-4)}` : null);
export function programmeShape(p, { admin = false } = {}) {
  if (!p) return { status: 'none' };
  const o = {
    status: p.status, legalName: p.legal_name, country: p.country, bankName: p.bank_name, accountName: p.account_name,
    accountNumber: admin ? p.account_number : mask(p.account_number), about: p.about || null, adminNote: p.admin_note || null,
    appliedAt: p.applied_at ? new Date(p.applied_at).toISOString() : null, decidedAt: p.decided_at ? new Date(p.decided_at).toISOString() : null,
  };
  if (admin) o.userId = p.user_id;
  return o;
}
export function withdrawalShape(w, { admin = false } = {}) {
  const d = parse(w.payout_details) || {};
  const o = {
    id: w.id, coins: Number(w.coins), payoutMinor: Number(w.payout_minor), currency: w.currency, status: w.status,
    reference: w.reference || null, adminNote: w.admin_note || null, createdAt: new Date(w.created_at).toISOString(),
    decidedAt: w.decided_at ? new Date(w.decided_at).toISOString() : null, paidAt: w.paid_at ? new Date(w.paid_at).toISOString() : null,
    payoutTo: admin ? d : { bankName: d.bankName || null, accountName: d.accountName || null, accountNumber: mask(d.accountNumber) },
  };
  if (admin) { o.userId = w.user_id; o.user = parse(w.user) || null; }
  return o;
}
/** Why this member can't request a withdrawal right now (null = they can). */
function withdrawBlock(cfg, programme, available, open) {
  if (!cfg.earnings_withdrawals_enabled) return { code: 'WITHDRAWALS_CLOSED', text: 'Withdrawals aren’t open yet. Your earnings stay safe in your account.' };
  if (!programme || programme.status !== 'approved') return { code: 'NOT_APPROVED', text: 'Only members approved for the creator payout programme can withdraw.' };
  if (open) return { code: 'WITHDRAWAL_OPEN', text: 'You already have a withdrawal in progress.' };
  const min = withdrawalMinimum(cfg);
  if (available < Math.max(1, min.coins)) return { code: 'BELOW_MINIMUM', text: `The minimum withdrawal is ${min.label}. You can withdraw once you have ${min.coins.toLocaleString('en-US')} available coins.` };
  return null;
}
export async function earningsSummary(c, userId) {
  const cfg = await getConfig(c.env);
  const [bal, programme, wds, tot] = await Promise.all([
    getBalances(c.env, userId),
    one(c.env, 'SELECT * FROM gift_creator_programme WHERE user_id = $1', [userId]),
    q(c.env, 'SELECT * FROM gift_withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [userId]),
    one(c.env, 'SELECT COUNT(*)::int AS n, COALESCE(SUM(earnings), 0)::bigint AS e, COALESCE(SUM(coins), 0)::bigint AS v FROM gift_sends WHERE recipient_id = $1', [userId]),
  ]);
  const open = wds.some((w) => w.status === 'requested' || w.status === 'approved');
  const block = withdrawBlock(cfg, programme, bal.gift_earnings_available, open);
  const rate = cfg.earnings_payout_rate;
  const min = withdrawalMinimum(cfg);
  return {
    balances: { pending: bal.gift_earnings, available: bal.gift_earnings_available, withdrawing: bal.gift_earnings_withdrawing, withdrawn: bal.gift_earnings_withdrawn },
    giftCoins: bal.gift_coins,
    totals: { gifts: tot.n, earnings: Number(tot.e), giftValue: Number(tot.v) },
    rules: {
      commissionPct: cfg.gift_commission_bps / 100, holdDays: cfg.earnings_hold_days, withdrawalsEnabled: !!cfg.earnings_withdrawals_enabled,
      minWithdrawal: min.coins, minWithdrawalUsd: min.usd, minWithdrawalLabel: min.label, usdNgnRate: min.usdNgnRate, payoutRate: rate, explain: EXPLAIN(cfg),
    },
    programme: programmeShape(programme),
    withdrawals: wds.map((w) => withdrawalShape(w)),
    canWithdraw: !block, withdrawBlocked: block,
  };
}
export async function applyProgramme(env, userId, b) {
  const cur = await one(env, 'SELECT status FROM gift_creator_programme WHERE user_id = $1', [userId]);
  if (cur && cur.status === 'approved') throw new ApiError(409, 'ALREADY_APPROVED', 'You’re already approved');
  if (cur && cur.status === 'suspended') throw forbidden('Your payout programme membership is suspended. Please contact support.', 'SUSPENDED');
  const legal = str(b.legalName, { min: 2, max: 120, field: 'Legal name' });
  const bank = str(b.bankName, { min: 2, max: 80, field: 'Bank' });
  const accName = str(b.accountName, { min: 2, max: 120, field: 'Account name' });
  const accNo = String(b.accountNumber || '').replace(/\s+/g, '');
  if (!/^[0-9]{6,20}$/.test(accNo)) throw bad('Account number must be 6-20 digits', 'BAD_ACCOUNT');
  const country = /^[A-Z]{2}$/.test(String(b.country || 'NG')) ? String(b.country || 'NG') : 'NG';
  const about = str(b.about || '', { max: 600, field: 'About' }) || null;
  await q(env, `INSERT INTO gift_creator_programme (user_id, status, legal_name, country, bank_name, account_name, account_number, about, applied_at)
      VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, now())
    ON CONFLICT (user_id) DO UPDATE SET status = 'pending', legal_name = $2, country = $3, bank_name = $4, account_name = $5, account_number = $6,
      about = $7, applied_at = now(), decided_at = NULL, decided_by = NULL, admin_note = NULL
    WHERE gift_creator_programme.status IN ('pending','rejected')`, [userId, legal, country, bank, accName, accNo, about]);
  return programmeShape(await one(env, 'SELECT * FROM gift_creator_programme WHERE user_id = $1', [userId]));
}
/** Request a withdrawal of available gift earnings (purchased Gifting Coins can never be withdrawn). */
export async function requestWithdrawal(c, me, b) {
  const env = c.env;
  const key = idemKey(b.idempotencyKey);
  const id = await hashUuid(`wd:${me.id}:${key}`);
  const prev = await one(env, 'SELECT * FROM gift_withdrawals WHERE id = $1', [id]);
  if (prev) return { duplicate: true, withdrawal: withdrawalShape(prev) };
  await rateLimit(env, `gift_withdraw:${me.id}`, 10, 3600);
  const cfg = await getConfig(env);
  const coins = Number(b.coins);
  if (!Number.isSafeInteger(coins) || coins <= 0) throw bad('Enter a whole number of coins', 'BAD_AMOUNT');
  const programme = await one(env, 'SELECT * FROM gift_creator_programme WHERE user_id = $1', [me.id]);
  const open = await one(env, `SELECT 1 FROM gift_withdrawals WHERE user_id = $1 AND status IN ('requested','approved')`, [me.id]);
  const bal = await getBalances(env, me.id);
  const block = withdrawBlock(cfg, programme, Math.max(bal.gift_earnings_available, coins), !!open);
  if (block) throw new ApiError(block.code === 'BELOW_MINIMUM' ? 400 : block.code === 'WITHDRAWAL_OPEN' ? 409 : 403, block.code, block.text);
  const min = withdrawalMinimum(cfg);
  if (coins < min.coins) throw bad(`The minimum withdrawal is ${min.label}: ${min.coins.toLocaleString('en-US')} coins`, 'BELOW_MINIMUM');
  const rate = cfg.earnings_payout_rate;
  const details = { legalName: programme.legal_name, bankName: programme.bank_name, accountName: programme.account_name, accountNumber: programme.account_number, country: programme.country };
  await holdForWithdrawal(env, {
    ref: `withdraw:${id}`, userId: me.id, amount: coins, requestId: id,
    alsoRun: [[`INSERT INTO gift_withdrawals (id, user_id, coins, payout_minor, currency, payout_details) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO NOTHING`,
      [id, me.id, coins, coins * rate.minorPerCoin, rate.currency, JSON.stringify(details)]]],
  });
  await walletNotify(c, { userId: me.id, kind: 'gift', title: 'Withdrawal requested', body: `We received your request to withdraw ${coins.toLocaleString('en-US')} coins of gift earnings. Our team will review it.`, data: { wallet: 'gift_earnings', screen: 'GiftEarnings' } });
  return { duplicate: false, withdrawal: withdrawalShape(await one(env, 'SELECT * FROM gift_withdrawals WHERE id = $1', [id])) };
}
// guard inside the ledger transaction: errors (division by zero → rollback) unless the request is in one of `states`
const stateGuard = (id, states) => [`SELECT 1 / (SELECT count(*)::int FROM gift_withdrawals WHERE id = $1 AND status = ANY($2::text[])) AS ok`, [id, states]];
const isGuardError = (e) => e && (e.code === '22012' || /division by zero/i.test(String(e.message || '')));
/** Admin: approve / reject / paid. */
export async function decideWithdrawal(c, admin, id, action, b = {}) {
  const env = c.env;
  const w = await one(env, 'SELECT * FROM gift_withdrawals WHERE id = $1', [id]);
  if (!w) throw notFound('Withdrawal not found');
  const note = str(b.note || '', { max: 500, field: 'note' }) || null;
  try {
    if (action === 'approve') {
      if (w.status !== 'requested') throw new ApiError(409, 'WITHDRAWAL_STATE', `This request is ${w.status}`);
      await requireApprovedKyc(env, w.user_id); // PAYOUT KYC (lib/kyc.js): approved only for a member whose KYC is approved
      await q(env, `UPDATE gift_withdrawals SET status = 'approved', admin_note = COALESCE($2, admin_note), decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'requested'`, [id, note, admin.id]);
    } else if (action === 'reject') {
      if (!['requested', 'approved'].includes(w.status)) throw new ApiError(409, 'WITHDRAWAL_STATE', `This request is ${w.status}`);
      if (!note || note.length < 5) throw bad('Give a reason (at least 5 characters) — the member sees it', 'REASON_REQUIRED');
      await reverseWithdrawal(env, { ref: `withdraw_reversed:${id}`, userId: w.user_id, amount: Number(w.coins), requestId: id, actorId: admin.id, alsoRun: [
        stateGuard(id, ['requested', 'approved', 'rejected']),
        [`UPDATE gift_withdrawals SET status = 'rejected', admin_note = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status IN ('requested','approved')`, [id, note, admin.id]],
      ] });
      await walletNotify(c, { userId: w.user_id, kind: 'gift', title: 'Withdrawal not approved', body: `Your withdrawal of ${Number(w.coins).toLocaleString('en-US')} coins was returned to your available earnings. ${note}`, data: { wallet: 'gift_earnings', screen: 'GiftEarnings' } });
    } else if (action === 'paid') {
      if (w.status !== 'approved') throw new ApiError(409, 'WITHDRAWAL_STATE', w.status === 'paid' ? 'Already marked paid' : 'Approve the request first');
      const reference = str(b.reference, { min: 3, max: 120, field: 'Payment reference' });
      await completeWithdrawal(env, { ref: `withdraw_paid:${id}`, userId: w.user_id, amount: Number(w.coins), requestId: id, actorId: admin.id, alsoRun: [
        stateGuard(id, ['approved', 'paid']),
        [`UPDATE gift_withdrawals SET status = 'paid', reference = $2, admin_note = COALESCE($3, admin_note), paid_at = now(), decided_by = $4, decided_at = COALESCE(decided_at, now()) WHERE id = $1 AND status = 'approved'`, [id, reference, note, admin.id]],
      ] });
      await walletNotify(c, { userId: w.user_id, kind: 'gift', title: 'Withdrawal paid', body: `Your withdrawal of ${Number(w.coins).toLocaleString('en-US')} coins has been paid. Reference: ${reference}`, data: { wallet: 'gift_earnings', screen: 'GiftEarnings' } });
    } else throw bad('action must be approve, reject or paid');
  } catch (e) {
    if (isGuardError(e)) throw new ApiError(409, 'WITHDRAWAL_STATE', 'This request changed meanwhile — reload and try again');
    throw e;
  }
  return withdrawalShape(await one(env, 'SELECT * FROM gift_withdrawals WHERE id = $1', [id]), { admin: true });
}

// ─── live sessions ──────────────────────────────────────────────────────────────────────────────────────────────────
export const liveShape = (r) => ({
  id: r.id, title: r.title, status: r.status, host: parse(r.host) || null, hostId: r.host_id,
  startedAt: new Date(r.started_at).toISOString(), endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
});
export const LIVE_SELECT = `SELECT l.*, ${userJson('u')} AS host FROM live_sessions l JOIN users u ON u.id = l.host_id`;

/**
 * Fund Me: the gifts received on one fundraiser request, for the page (public and owner views).
 * → { total, topGifts: [{ id, name, art, imageUrl, count }] (most sent first, max 5), recentGivers: [{ displayName, avatarUrl, gift, createdAt }] (max 10) }
 * Givers are shown by name and picture only (never ids). Gifts are never anonymous.
 */
export async function fundraiserGiftSummary(c, fundraiserId) {
  const cfg = await getConfig(c.env);
  const [total, top, recent] = await Promise.all([
    one(c.env, `SELECT COUNT(*)::int AS n FROM gift_sends WHERE context_type = 'fundme' AND context_id = $1`, [fundraiserId]),
    q(c.env, `SELECT s.gift_id, MAX(s.gift_name) AS name, COUNT(*)::int AS n, COALESCE(SUM(s.coins), 0)::bigint AS coins,
        g.art, g.image_key, g.animation_key
      FROM gift_sends s LEFT JOIN gift_catalogue g ON g.id = s.gift_id
      WHERE s.context_type = 'fundme' AND s.context_id = $1
      GROUP BY s.gift_id, g.art, g.image_key, g.animation_key ORDER BY COUNT(*) DESC, COALESCE(SUM(s.coins), 0) DESC, s.gift_id LIMIT 5`, [fundraiserId]),
    q(c.env, `${SEND_SELECT} WHERE s.context_type = 'fundme' AND s.context_id = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT 10`, [fundraiserId]),
  ]);
  return {
    total: total ? total.n : 0,
    topGifts: top.map((r) => ({
      id: r.gift_id, name: r.name, art: r.art || 'star', count: r.n,
      imageUrl: r.image_key ? mediaUrl(c.env, origin(c), r.image_key) : null,
    })),
    recentGivers: recent.map((r) => sendShape(c, r, cfg.gift_coin_rate)).filter((s) => s.sender).map((s) => ({
      displayName: s.sender.displayName || 'A friend', avatarUrl: s.sender.avatarUrl || null,
      gift: { id: s.gift.id, name: s.gift.name, art: s.gift.art || 'star', imageUrl: s.gift.imageUrl || null },
      createdAt: s.createdAt,
    })),
  };
}
