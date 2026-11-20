// CHAT LIMITS (client #27, brief 7.5) + REFERRALS + PAYWALL FREQUENCY GUARD (brief 10.3).
//
// Rule: a FREE user can START one-to-one chats with at most `chat.free_platform_slots` (default 5) different
// platform users. A slot is used when the free user sends the FIRST message of a new 1:1 conversation with
// someone who is not an "invited contact". Re-messaging the same person never uses another slot.
// Never counted: invited contacts (inviter ⇄ invitee via users.referred_by), replies to someone who messaged
// you first (unless CHAT_REPLIES_USE_SLOT=true), groups, channels, community / paid-channel chats (kind <> 'dm'),
// Care network chats (Talk to a Priest / Talk to an Apostle, labelled in care_conversations).
// Subscribers (users.premium, not expired) and platform admins are unlimited.
//
// Remote config (Worker vars, no release needed — same pattern as JOBS_BID_REQUIRED_ADS in rules.js):
//   CHAT_FREE_PLATFORM_SLOTS          chat.free_platform_slots          default 5   (0–1000)
//   CHAT_REPLIES_USE_SLOT             replies to a first message count  default false
//   PAYWALL_MAX_IMPRESSIONS_PER_DAY   paywall.max_impressions_per_day   default 2   (0–10)
//   REFERRAL_CLAIM_DAYS               how long after sign-up a code can be entered  default 7 (0–365)
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

/** Subscriber = premium flag that hasn't expired (a trial is premium with an end date). */
export function isSubscriber(u) {
  if (!u || !u.premium) return false;
  return !u.premium_until || new Date(u.premium_until).getTime() > Date.now();
}
/** Unlimited chats: subscribers and platform admins. */
export const isUnlimited = (u) => !!u && (u.role === 'admin' || isSubscriber(u));

/** Inviter ⇄ invitee (either direction). */
export async function isInvitedContact(env, aId, bId) {
  const row = await one(env, `SELECT 1 FROM users a JOIN users b ON b.id = $2
    WHERE a.id = $1 AND (a.referred_by = b.id OR b.referred_by = a.id)`, [aId, bId]);
  return !!row;
}

/** Conversations that never use a slot even though they are 1:1 (Care network; Find Love would go here too). */
export async function isExemptConversation(env, convId) {
  if (!convId) return false;
  const row = await one(env, 'SELECT 1 FROM care_conversations WHERE conversation_id = $1 LIMIT 1', [convId]);
  return !!row;
}

export async function slotsUsed(env, userId) {
  const r = await one(env, 'SELECT count(*)::int AS n FROM chat_slots WHERE user_id = $1', [userId]);
  return r ? r.n : 0;
}

/** { unlimited, subscriber, used, limit, remaining, repliesUseSlot } for the new-chat counter. */
export async function chatAllowance(env, user) {
  const limit = chatFreeSlots(env);
  const used = await slotsUsed(env, user.id);
  const unlimited = isUnlimited(user);
  return {
    unlimited,
    subscriber: isSubscriber(user),
    used,
    limit,
    remaining: unlimited ? null : Math.max(0, limit - used),
    repliesUseSlot: repliesUseSlot(env),
  };
}

export function limitError(used, limit) {
  const e = new ApiError(403, 'CHAT_LIMIT_REACHED',
    `You've connected with ${limit} believers. Upgrade for unlimited conversations — or invite a friend (invited friends are unlimited).`);
  e.details = { used, limit };
  return e;
}

/**
 * Would a first message from `user` to `otherId` (in `convId`, may be null) need a slot?
 * → { needsSlot: boolean, reason } — reason: unlimited | invited | exempt | existing | reply | established | new
 */
export async function slotNeed(env, user, otherId, convId) {
  if (isUnlimited(user)) return { needsSlot: false, reason: 'unlimited' };
  if (await isInvitedContact(env, user.id, otherId)) return { needsSlot: false, reason: 'invited' };
  if (convId && await isExemptConversation(env, convId)) return { needsSlot: false, reason: 'exempt' };
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
  if (used >= limit) throw limitError(used, limit);
  return need;
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
      SELECT $1, $2, $3 WHERE (SELECT count(*) FROM chat_slots WHERE user_id = $1) < $4
      ON CONFLICT (user_id, counterparty_id) DO NOTHING RETURNING 1`, [user.id, otherId, convId, limit]);
  if (ins.length) return { used: true, reason: 'new' };
  if (await one(env, 'SELECT 1 FROM chat_slots WHERE user_id = $1 AND counterparty_id = $2', [user.id, otherId])) return { used: false, reason: 'existing' };
  throw limitError(await slotsUsed(env, user.id), limit);
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
