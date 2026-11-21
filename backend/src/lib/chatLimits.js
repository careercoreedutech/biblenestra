// CHAT LIMITS (client #27, brief 7.5) + REFERRALS + PAYWALL FREQUENCY GUARD (brief 10.3).
//
// Rule: a FREE user can START one-to-one chats with at most `chat.free_platform_slots` (default 5) different
// platform users. A slot is used when the free user sends the FIRST message of a new 1:1 conversation with
// someone who is not an "invited contact". Re-messaging the same person never uses another slot.
// Never counted: invited contacts (inviter ⇄ invitee via users.referred_by), replies to someone who messaged
// you first (unless CHAT_REPLIES_USE_SLOT=true), groups, channels, community / paid-channel chats (kind <> 'dm'),
// Care network chats (Talk to a Priest / Talk to an Apostle, labelled in care_conversations).
// Subscribers (users.premium, not expired) and platform admins (users.role = 'admin') are unlimited: no slot is
// ever used and they never see the chat paywall.
//
// CHAT WEEK PASS (coins): a free user who hit the limit can spend coins on a 7-day pass that adds extra NEW chats
// on top of the free slots. Slots started through a pass are tagged chat_slots.via_pass = true, so the free count
// (via_pass = false) never grows past the free limit. A pass "chain" lives on users (chat_pass_started_at /
// chat_pass_until / chat_pass_extra): buying while a pass is active extends the expiry by 7 days from the current
// expiry and adds the extra chats; buying after expiry starts a new chain. When the pass expires only NEW chats are
// limited again: every chat already started (free or via the pass) stays open, because re-messaging a
// counterparty that already has a chat_slots row never needs a slot.
//
// Remote config (Worker vars, no release needed — same pattern as JOBS_BID_REQUIRED_ADS in rules.js):
//   CHAT_FREE_PLATFORM_SLOTS          chat.free_platform_slots          default 5   (0–1000)
//   CHAT_REPLIES_USE_SLOT             replies to a first message count  default false
//   PAYWALL_MAX_IMPRESSIONS_PER_DAY   paywall.max_impressions_per_day   default 2   (0–10)
//   REFERRAL_CLAIM_DAYS               how long after sign-up a code can be entered  default 7 (0–365)
//   CHAT_WEEK_PASS_COINS              price of one 7-day pass in coins               default 100 (1–100000)
//   CHAT_WEEK_PASS_EXTRA_SLOTS        extra new chats per pass, or "unlimited"       default 10  (1–1000)
import { ApiError } from './http.js';
import { one, q } from './db.js';

const intVar = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};
export const chatFreeSlots = (env) => intVar(env && env.CHAT_FREE_PLATFORM_SLOTS, 0, 1000, 5);
export const repliesUseSlot = (env) => String((env && env.CHAT_REPLIES_USE_SLOT) || '').trim().toLowerCase() === 'true';
export const paywallMaxPerDay = (env) => intVar(env && env.PAYWALL_MAX_IMPRESSIONS_PER_DAY, 0, 10, 2);
export const referralClaimDays = (env) => intVar(env && env.REFERRAL_CLAIM_DAYS, 0, 365, 7);
export const PASS_DAYS = 7;
export const weekPassCoins = (env) => intVar(env && env.CHAT_WEEK_PASS_COINS, 1, 100000, 100);
/** Extra new chats per pass; null = unlimited new chats while the pass is active (CHAT_WEEK_PASS_EXTRA_SLOTS=unlimited). */
export const weekPassExtraSlots = (env) => (String((env && env.CHAT_WEEK_PASS_EXTRA_SLOTS) || '').trim().toLowerCase() === 'unlimited'
  ? null : intVar(env && env.CHAT_WEEK_PASS_EXTRA_SLOTS, 1, 1000, 10));
/** What the limit sheet offers: { coins, extraSlots (null = unlimited), unlimited, days }. */
export const weekPassOffer = (env) => {
  const extra = weekPassExtraSlots(env);
  return { coins: weekPassCoins(env), extraSlots: extra, unlimited: extra === null, days: PASS_DAYS };
};
// users.chat_pass_extra / chat_passes.extra_slots store the extra chats; -1 = unlimited
const UNLIMITED_EXTRA = -1;

/** Subscriber = premium flag that hasn't expired (a trial is premium with an end date). */
export function isSubscriber(u) {
  if (!u || !u.premium) return false;
  return !u.premium_until || new Date(u.premium_until).getTime() > Date.now();
}
export const isAdmin = (u) => !!u && u.role === 'admin';
/** Unlimited chats: subscribers and platform admins. */
export const isUnlimited = (u) => !!u && (isAdmin(u) || isSubscriber(u));

/** Inviter ⇄ invitee (either direction). */
export async function isInvitedContact(env, aId, bId) {
  const row = await one(env, `SELECT 1 FROM users a JOIN users b ON b.id = $2
    WHERE a.id = $1 AND (a.referred_by = b.id OR b.referred_by = a.id)`, [aId, bId]);
  return !!row;
}

/** Conversations that never use a slot even though they are 1:1 (Care network; Find Love would go here too). */
export async function isExemptConversation(env, convId) {
  if (!convId) return false;
  const row = await one(env, `SELECT 1 FROM care_conversations WHERE conversation_id = $1
    UNION ALL SELECT 1 FROM dating_conversations WHERE conversation_id = $1 LIMIT 1`, [convId]); // FIND LOVE: dating chats have their own allowance (lib/dating.js)
  return !!row;
}

/** Free slots used (chats started through a week pass are not counted here). */
export async function slotsUsed(env, userId) {
  const r = await one(env, 'SELECT count(*)::int AS n FROM chat_slots WHERE user_id = $1 AND NOT via_pass', [userId]);
  return r ? r.n : 0;
}

/** The user's current week pass, or null when none is active: { until, startedAt, extra (null = unlimited), used, remaining }. */
export async function activePass(env, userId) {
  const r = await one(env, `SELECT u.chat_pass_until AS until, u.chat_pass_started_at AS started, u.chat_pass_extra AS extra,
      (SELECT count(*)::int FROM chat_slots s WHERE s.user_id = u.id AND s.via_pass AND s.created_at >= u.chat_pass_started_at) AS used
    FROM users u WHERE u.id = $1 AND u.chat_pass_until > now()`, [userId]);
  if (!r) return null;
  const extra = r.extra === UNLIMITED_EXTRA ? null : r.extra;
  return {
    until: new Date(r.until).toISOString(),
    startedAt: new Date(r.started).toISOString(),
    extra,
    unlimited: extra === null,
    used: r.used,
    remaining: extra === null ? null : Math.max(0, extra - r.used),
  };
}

/**
 * { unlimited, subscriber, admin, used, limit, remaining, repliesUseSlot, pass, passOffer, coins } for the new-chat
 * counter and the limit sheet. used / limit are the FREE slots; remaining includes what an active pass adds
 * (null = unlimited).
 */
export async function chatAllowance(env, user) {
  const limit = chatFreeSlots(env);
  const unlimited = isUnlimited(user);
  const [used, pass, bal] = await Promise.all([
    slotsUsed(env, user.id),
    unlimited ? null : activePass(env, user.id),
    one(env, 'SELECT coins FROM users WHERE id = $1', [user.id]),
  ]);
  const free = Math.max(0, limit - used);
  return {
    unlimited,
    subscriber: isSubscriber(user),
    admin: isAdmin(user),
    used,
    limit,
    remaining: unlimited || (pass && pass.unlimited) ? null : free + (pass ? pass.remaining : 0),
    repliesUseSlot: repliesUseSlot(env),
    pass,
    passOffer: unlimited ? null : weekPassOffer(env),
    coins: bal ? Number(bal.coins) : 0,
  };
}

export function limitError(used, limit, extra = {}) {
  const e = new ApiError(403, 'CHAT_LIMIT_REACHED',
    `You've connected with ${limit} believers. Unlock more chats for a week with coins, upgrade for unlimited conversations — or invite a friend (invited friends are unlimited).`);
  e.details = { used, limit, ...extra };
  return e;
}
async function limitErrorFor(env, user) {
  const [used, pass] = await Promise.all([slotsUsed(env, user.id), activePass(env, user.id)]);
  return limitError(used, chatFreeSlots(env), { pass, passOffer: weekPassOffer(env) });
}

/**
 * Would a first message from `user` to `otherId` (in `convId`, may be null) need a slot?
 * → { needsSlot: boolean, reason } — reason: unlimited | invited | exempt | existing | reply | established | new
 */
export async function slotNeed(env, user, otherId, convId) {
  if (isUnlimited(user)) return { needsSlot: false, reason: 'unlimited' };
  if (await isInvitedContact(env, user.id, otherId)) return { needsSlot: false, reason: 'invited' };
  if (convId && await isExemptConversation(env, convId)) return { needsSlot: false, reason: 'exempt' };
  // a chat already started (with a free slot OR through a week pass, even an expired one) stays open
  if (await one(env, 'SELECT 1 FROM chat_slots WHERE user_id = $1 AND counterparty_id = $2', [user.id, otherId])) return { needsSlot: false, reason: 'existing' };
  if (convId) {
    const s = await one(env, `SELECT
        EXISTS (SELECT 1 FROM messages WHERE conversation_id = $1 AND sender_id = $2) AS mine,
        EXISTS (SELECT 1 FROM messages WHERE conversation_id = $1 AND sender_id = $3) AS theirs`, [convId, user.id, otherId]);
    // I already wrote here (before this feature, or while subscribed / invited): an established chat
    if (s && s.mine) return { needsSlot: false, reason: 'established' };
    if (s && s.theirs && !repliesUseSlot(env)) return { needsSlot: false, reason: 'reply' };
  }
  return { needsSlot: true, reason: 'new' };
}

/** POST /conversations/dm: refuse to open a NEW chat when it would need a slot and none is left (nothing is used yet). */
export async function assertCanStartDm(env, user, otherId, convId) {
  const need = await slotNeed(env, user, otherId, convId);
  if (!need.needsSlot) return need;
  const limit = chatFreeSlots(env);
  const used = await slotsUsed(env, user.id);
  if (used < limit) return need;
  const pass = await activePass(env, user.id);
  if (pass && (pass.unlimited || pass.remaining > 0)) return { ...need, viaPass: true };
  throw limitError(used, limit, { pass, passOffer: weekPassOffer(env) });
}

/**
 * Before inserting a message into a DM: use a slot when this is the free user's first message of a new chat.
 * Idempotent per counterparty (primary key); the count check and the insert are one statement.
 */
export async function useSlotForFirstMessage(env, user, convId, otherId) {
  const need = await slotNeed(env, user, otherId, convId);
  if (!need.needsSlot) return { used: false, reason: need.reason };
  const limit = chatFreeSlots(env);
  const ins = await q(env, `INSERT INTO chat_slots (user_id, counterparty_id, conversation_id)
      SELECT $1, $2, $3 WHERE (SELECT count(*) FROM chat_slots WHERE user_id = $1 AND NOT via_pass) < $4
      ON CONFLICT (user_id, counterparty_id) DO NOTHING RETURNING 1`, [user.id, otherId, convId, limit]);
  if (ins.length) return { used: true, reason: 'new' };
  // free slots are gone → use the active week pass (its count check and the insert are one statement too)
  const viaPass = await q(env, `INSERT INTO chat_slots (user_id, counterparty_id, conversation_id, via_pass)
      SELECT $1, $2, $3, true FROM users u WHERE u.id = $1 AND u.chat_pass_until > now()
        AND (u.chat_pass_extra = ${UNLIMITED_EXTRA} OR (SELECT count(*) FROM chat_slots s
             WHERE s.user_id = $1 AND s.via_pass AND s.created_at >= u.chat_pass_started_at) < u.chat_pass_extra)
      ON CONFLICT (user_id, counterparty_id) DO NOTHING RETURNING 1`, [user.id, otherId, convId]);
  if (viaPass.length) return { used: true, reason: 'pass' };
  if (await one(env, 'SELECT 1 FROM chat_slots WHERE user_id = $1 AND counterparty_id = $2', [user.id, otherId])) return { used: false, reason: 'existing' };
  throw await limitErrorFor(env, user);
}

// ---------- week pass purchase (coins) ----------
export const PASS_LEDGER_REASON = 'chat_week_pass';

/**
 * Spend coins on a 7-day chat pass in ONE SQL statement, so coins are never taken without a pass (or the other way
 * round): lock the user row, record the purchase (UNIQUE (user_id, idempotency_key): a retry with the same key
 * inserts nothing and so charges nothing), deduct coins + extend the pass chain, write the coin_ledger row.
 * Returns { pass, coins, purchase, replay }. Throws INSUFFICIENT_COINS (402) with { balance, price }.
 */
export async function buyWeekPass(env, user, idempotencyKey) {
  if (isUnlimited(user)) {
    throw new ApiError(409, 'PASS_NOT_NEEDED', isAdmin(user) ? 'Admins have unlimited chats' : 'Your subscription already includes unlimited chats');
  }
  const offer = weekPassOffer(env);
  const extraStore = offer.unlimited ? UNLIMITED_EXTRA : offer.extraSlots;
  const row = await one(env, `WITH lock AS (
        SELECT id, coins,
          (chat_pass_until IS NOT NULL AND chat_pass_until > now()) AS active,
          GREATEST(COALESCE(chat_pass_until, now()), now()) + make_interval(days => $5::int) AS new_until
        FROM users WHERE id = $1 FOR UPDATE),
      ins AS (INSERT INTO chat_passes (user_id, idempotency_key, coins, extra_slots, expires_at, extended)
        SELECT $1, $2, $3, $4, lock.new_until, lock.active FROM lock WHERE lock.coins >= $3
        ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING *),
      pay AS (UPDATE users u SET coins = u.coins - $3,
          chat_pass_started_at = CASE WHEN lock.active THEN u.chat_pass_started_at ELSE now() END,
          chat_pass_extra = CASE WHEN NOT lock.active THEN $4
                                 WHEN u.chat_pass_extra = ${UNLIMITED_EXTRA} OR $4 = ${UNLIMITED_EXTRA} THEN ${UNLIMITED_EXTRA}
                                 ELSE u.chat_pass_extra + $4 END,
          chat_pass_until = ins.expires_at
        FROM ins, lock WHERE u.id = $1 RETURNING u.coins),
      led AS (INSERT INTO coin_ledger (user_id, amount, reason, ref) SELECT $1, -$3, '${PASS_LEDGER_REASON}', ins.id::text FROM ins)
      SELECT ins.id, ins.expires_at, (SELECT coins FROM pay) AS coins_left FROM ins`,
  [user.id, idempotencyKey, offer.coins, extraStore, PASS_DAYS]);
  if (row) {
    return { replay: false, coins: Number(row.coins_left), pass: await activePass(env, user.id), purchase: { id: String(row.id), coins: offer.coins, expiresAt: new Date(row.expires_at).toISOString() } };
  }
  const prev = await one(env, 'SELECT id, coins, expires_at FROM chat_passes WHERE user_id = $1 AND idempotency_key = $2', [user.id, idempotencyKey]);
  const bal = await one(env, 'SELECT coins FROM users WHERE id = $1', [user.id]);
  if (prev) {
    return { replay: true, coins: Number(bal.coins), pass: await activePass(env, user.id), purchase: { id: String(prev.id), coins: prev.coins, expiresAt: new Date(prev.expires_at).toISOString() } };
  }
  const balance = bal ? Number(bal.coins) : 0;
  const e = new ApiError(402, 'INSUFFICIENT_COINS', `A chat week pass costs ${offer.coins} coins. You have ${balance}.`);
  e.details = { balance, price: offer.coins };
  throw e;
}

// ---------- referrals ----------
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
function newCode() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
export const normalizeCode = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

export async function ensureInviteCode(env, userId) {
  const cur = await one(env, 'SELECT invite_code FROM users WHERE id = $1', [userId]);
  if (cur && cur.invite_code) return cur.invite_code;
  for (let i = 0; i < 5; i++) {
    try {
      const row = await one(env, `UPDATE users SET invite_code = COALESCE(invite_code, $2) WHERE id = $1 RETURNING invite_code`, [userId, newCode()]);
      if (row && row.invite_code) return row.invite_code;
    } catch (e) {
      if (!/unique|duplicate/i.test(e.message)) throw e; // code collision → try another
    }
  }
  throw new ApiError(500, 'INVITE_CODE', 'Could not create an invite code — please try again');
}

// ---------- paywall frequency guard ----------
// Placements the user asked for (they hit a wall or opened Plans) are always shown but still counted, so the
// day's interruptive prompts (app_open, after_task …) back off. Subscribers never see any.
export const REQUESTED_PLACEMENTS = new Set(['chat_limit', 'plans_screen']);
