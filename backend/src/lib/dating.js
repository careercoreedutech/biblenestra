// FIND LOVE (Christian dating) — brief §9, client spec §5 (coin uses), §6 (ad unlock), §7 (boosts), §13/§14 (Plus / VIP).
// Notes for the client and the team: scratch/monetisation/dating.md. Wallet contract: scratch/monetisation/wallet-core.md.
//
// * The dating profile is opt-in and separate from the social profile (users.*). First name, age (from a date of birth,
//   18+ checked on every save), city-level location only (no coordinates are ever accepted or stored).
// * Discovery never shows: yourself, paused / banned profiles, anyone you or they blocked (the app-wide `blocks` table),
//   anyone you already swiped, matched, reported or have a request with, or anyone outside BOTH people's basic
//   preferences (gender and age range, in both directions). Boost / Spotlight / VIP / Priority Like only change the ORDER
//   of people who already pass every filter — they never bypass privacy, preferences or blocks.
// * Coins: every use goes through the wallet core spend() (wallet 'dating_coins', or one free 'dating_boosts' boost) with
//   a ref derived from the business object or the app's idempotency key. The business row (dating_spends, the boost, the
//   swipe, the request message) commits in the SAME transaction (alsoRun), keyed so a duplicate ref changes nothing.
// * Free users' dating messages: rewarded ad → 5 free messages, a second ad → 5 more, then 20-coin bundles of 5. Allowance
//   = SUM(units) of claimed ad rewards + bought bundles; usage is one counter row checked in one UPDATE. Gift messages and
//   Dating Plus / VIP members are not counted (normal anti-spam limits in the chat send path still apply).
import { q, one } from './db.js';
import { ApiError, bad, notFound, forbidden, today, isUuid } from './http.js';
import { spend, registerKind, registerConfig, getConfig, getBalance, rateLimit, walletNotify } from './wallet.js';
import { datingEntitlement } from './walletStore.js';
import { mediaUrl } from './shape.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from './push.js';
import { checkPhoto, readObjectBytes, verificationPrecheck, GESTURES } from './datingAi.js'; // CLIENT ANSWERS: AI photo check + verification pre-check
import { dojahConfigured, verifySelfie } from './dojah.js'; // DOJAH: optional BVN / NIN selfie match for the Verified badge

// ─── coin kinds (labels in wallet history / admin) ─────────────────────────────────────────────────────────────────
export const COIN_KINDS = {
  super_like: 'Super Like', priority_like: 'Priority Like', message_request: 'Message request', see_who_liked: 'See who liked you',
  boost_30m: 'Profile boost (30 min)', boost_1h: 'Profile boost (1 hour)', boost_3h: 'Profile boost (3 hours)', spotlight_24h: 'Spotlight (24 hours)',
  extra_swipes: '+20 swipes', message_bundle: '5-message bundle',
};
for (const [k, v] of Object.entries(COIN_KINDS)) registerKind(k, v);

// ─── admin-editable settings (Admin › Wallets & payments › Dating, or Settings) ────────────────────────────────────
export const DEFAULT_PRICES = {
  super_like: 10, priority_like: 15, message_request: 25, see_who_liked: 30,
  boost_30m: 100, boost_1h: 180, boost_3h: 400, spotlight_24h: 250, extra_swipes: 30, message_bundle: 20,
};
export const DEFAULT_RULES = {
  dailySwipes: 50,            // free members: likes + passes per local day
  plusDailySwipes: 200,       // Plus / VIP ("more recommendations")
  extraSwipes: 20,            // swipes added by one "extra_swipes" purchase
  freeMessagesPerAd: 5,       // messages unlocked by one rewarded ad
  maxAdUnlocks: 2,            // ads per dating conversation (5 + 5 free)
  messagesPerBundle: 5,       // messages per coin bundle
  likesUnlockHours: 24,       // "See who liked you" bought with coins unlocks the list for this many hours
  adNonceMinutes: 30,         // an ad nonce must be claimed within this window
  adMinWatchSec: 5,           // a claim earlier than this after the nonce was issued is refused
  adClaimsPerHour: 12,        // rate limit for ad claims per member
  requireSsv: false,          // true → only AdMob server-side verification unlocks (set this for production)
  undoMinutes: 10,            // Plus: undo the last like / pass within this window
  photoReview: 'ai',          // 'ai' = live at once unless the AI check flags it (AI down → waits for a human) · 'pre' = visible only after approval · 'post' = visible at once, reviewed afterwards
  maxPhotos: 6,
  minAge: 18,
  batch: 10,                  // cards per discover page (free)
  plusBatch: 20,
  autoHideReports: 5,         // hide a profile from discovery after reports from this many different members (0 = never)
  showSocialToVerified: true, // dating chat shows the other person's social profile (handle, avatar, Socials link) only if they are verified
  chatRetentionDays: 730,     // messages of closed dating chats are deleted this many days after the chat closed (0 = keep)
  retentionBatch: 200,        // messages deleted per cron run (every 15 minutes)
  verificationMinutes: 60,    // a verification code must be used (selfie + ID submitted) within this window
};
const posInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
registerConfig('dating_prices', DEFAULT_PRICES, (v) => !!v && typeof v === 'object' && Object.keys(DEFAULT_PRICES).every((k) => v[k] === undefined || posInt(v[k], 1, 1e6)));
// Dojah selfie ↔ BVN/NIN photo match threshold (50–100; Dojah's default 90). Used only when DOJAH_* keys are set.
export const DOJAH_THRESHOLD_DEFAULT = 90;
registerConfig('dating_dojah_threshold', DOJAH_THRESHOLD_DEFAULT, (v) => Number.isInteger(v) && v >= 50 && v <= 100);
registerConfig('dating_rules', DEFAULT_RULES, (v) => !!v && typeof v === 'object'
  && ['dailySwipes', 'plusDailySwipes', 'extraSwipes', 'freeMessagesPerAd', 'maxAdUnlocks', 'messagesPerBundle', 'likesUnlockHours', 'adNonceMinutes', 'adMinWatchSec', 'adClaimsPerHour', 'undoMinutes', 'maxPhotos', 'batch', 'plusBatch', 'autoHideReports', 'chatRetentionDays']
    .every((k) => v[k] === undefined || posInt(v[k], 0, 100000))
  && (v.retentionBatch === undefined || posInt(v.retentionBatch, 1, 5000))
  && (v.verificationMinutes === undefined || posInt(v.verificationMinutes, 5, 1440))
  && (v.minAge === undefined || posInt(v.minAge, 18, 99))
  && (v.photoReview === undefined || ['ai', 'pre', 'post'].includes(v.photoReview))
  && (v.requireSsv === undefined || typeof v.requireSsv === 'boolean')
  && (v.showSocialToVerified === undefined || typeof v.showSocialToVerified === 'boolean'));

/** { prices, rules } merged with the defaults. env DATING_ADS_REQUIRE_SSV=true forces SSV-only ad rewards. */
export async function datingConfig(env) {
  const cfg = await getConfig(env);
  const rules = { ...DEFAULT_RULES, ...(cfg.dating_rules || {}) };
  rules.minAge = Math.max(18, Number(rules.minAge) || 18); // never below 18, whatever is stored
  if (String(env.DATING_ADS_REQUIRE_SSV || '').toLowerCase() === 'true') rules.requireSsv = true;
  return { prices: { ...DEFAULT_PRICES, ...(cfg.dating_prices || {}) }, rules };
}

// ─── small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
export const INTENTIONS = { marriage: 'Marriage-minded', long_term: 'Long-term relationship', friendship_first: 'Friendship first', not_sure: 'Still praying about it' };
export const INVOLVEMENT = ['Attends sometimes', 'Attends weekly', 'Serves in ministry', 'Church leader', 'Exploring faith'];
export const REPORT_REASONS = ['fake', 'inappropriate_photos', 'harassment', 'scam', 'underage', 'offensive', 'other'];
export const BOOSTS = { boost_30m: 30, boost_1h: 60, boost_3h: 180, spotlight_24h: 1440 };
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,100}$/;
export const pairOf = (a, b) => (String(a) < String(b) ? [String(a), String(b)] : [String(b), String(a)]);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const parse = (v, d = null) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
function needKey(k) {
  const s = String(k || '');
  if (!KEY_RE.test(s)) throw bad('idempotencyKey: 8-100 letters, digits, - _ : .', 'BAD_IDEMPOTENCY_KEY');
  return s;
}
// A Postgres date arrives as a Date at UTC midnight (PGlite, Neon in Workers) or as 'YYYY-MM-DD' text.
export const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));
export function ageOn(birthDate, now = new Date()) {
  const b = new Date(`${ymd(birthDate)}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) a -= 1;
  return a;
}
const AGE_SQL = (a) => `EXTRACT(YEAR FROM age(current_date, ${a}.birth_date))::int`;
const SEEKS = (a) => `(CASE ${a}.interested_in WHEN 'men' THEN 'man' ELSE 'woman' END)`;
// 'post' mode shows pending photos at once, except ones the AI flagged (those always wait for a human).
const photoVisibleSql = (a, modeParam) => `(${a}.status = 'approved' OR (${modeParam} = 'post' AND ${a}.status = 'pending' AND NOT ${a}.ai_flagged))`;
const photoVisible = (p, mode) => p.status === 'approved' || (mode === 'post' && p.status === 'pending' && !p.ai_flagged);
const BLOCKED_SQL = (x, y) => `EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = ${x} AND bl.blocked_id = ${y}) OR (bl.blocker_id = ${y} AND bl.blocked_id = ${x}))`;
const LIVE_SUB = (uid) => `(SELECT wp.benefits FROM dating_subscriptions ds JOIN wallet_products wp ON wp.id = ds.product_id
   WHERE ds.user_id = ${uid} AND ds.status IN ('active','cancelled','past_due') AND ds.current_period_end > now() LIMIT 1)`;
const photoUrl = (ctx, url) => (/^https?:\/\//.test(url) ? url : mediaUrl(ctx.env, ctx.origin || '', url));

async function isBlocked(env, a, b) {
  return !!(await one(env, `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`, [a, b]));
}
/** Plan + its flags (from the wallet core): { plan, tier, flags, badge, subscription }. */
export async function planOf(env, user) {
  return datingEntitlement(env, user.id || user);
}
const unrestricted = (ent) => !!(ent && ent.flags && (ent.flags.unlimitedMatchMessaging || ent.flags.noRewardedAds));

// Realtime + push (best effort, never throws). kind 'dating' can be muted per member like other notification kinds.
async function tell(c, userId, { title, body, data = {} }) {
  try { await notifyUser(c.env, userId, { type: 'dating.update', ...data }); } catch (e) { /* best effort */ }
  try { await sendNotification(c, { userId, kind: 'dating', title, body, data: { ...data, screen: 'FindLove' } }); } catch (e) { /* best effort */ }
}

// ─── profile ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const getProfileRow = (env, userId) => one(env, 'SELECT * FROM dating_profiles WHERE user_id = $1', [userId]);
async function photosOf(env, userId) {
  return q(env, 'SELECT id, url, position, status, reject_reason, ai_flagged FROM dating_photos WHERE user_id = $1 ORDER BY position, created_at', [userId]);
}

/** A card / profile for another member (never the birth date, never anything below city level). */
export function cardShape(r, ctx) {
  const photos = parse(r.photos, []) || [];
  return {
    userId: r.user_id, firstName: r.first_name, age: Number(r.age ?? ageOn(r.birth_date)),
    city: r.city || '', country: r.country || '', denomination: r.denomination || '', churchInvolvement: r.church_involvement || '',
    intention: r.intention, intentionLabel: INTENTIONS[r.intention] || r.intention, bio: r.bio || '', prompts: parse(r.prompts, []) || [], interests: parse(r.interests, []) || [],
    photos: photos.map((p) => ({ id: p.id, url: photoUrl(ctx, p.url) })),
    verified: !!r.verified, vip: !!r.vip_badge, boosted: !!r.boosted || !!r.spotlight, spotlight: !!r.spotlight,
    superLikedYou: r.their_action === 'super_like' || r.their_action === 'priority_like',
  };
}

/** The member's own profile (everything editable, photo review states, preferences). */
export async function myProfile(env, userId, ctx) {
  const r = await getProfileRow(env, userId);
  if (!r) return null;
  const { rules } = await datingConfig(env);
  const photos = await photosOf(env, userId);
  return {
    userId, firstName: r.first_name, birthDate: ymd(r.birth_date), age: ageOn(r.birth_date),
    gender: r.gender, interestedIn: r.interested_in, city: r.city, country: r.country, denomination: r.denomination,
    churchInvolvement: r.church_involvement, intention: r.intention, intentionLabel: INTENTIONS[r.intention], bio: r.bio,
    prompts: parse(r.prompts, []), interests: parse(r.interests, []) || [], prefs: parse(r.prefs, {}), status: r.status, verified: !!r.verified, banReason: r.status === 'banned' ? (r.ban_reason || null) : null,
    photos: photos.map((p) => ({ id: p.id, url: photoUrl(ctx, p.url), status: p.status, rejectReason: p.reject_reason || null, visible: photoVisible(p, rules.photoReview) })),
    underReview: !!r.report_hold_at, // hidden from discovery after reports, until the team reviews it
    visible: r.status === 'active' && !r.report_hold_at && photos.some((p) => photoVisible(p, rules.photoReview)),
    verification: await verificationShape(env, userId),
    createdAt: iso(r.created_at),
  };
}

/** Interests: up to 10 short tags, de-duplicated (the app offers a fixed list; the server only bounds length). */
export function cleanTags(v) {
  return Array.isArray(v) ? [...new Set(v.map((x) => clean(x, 40)).filter(Boolean))].slice(0, 10) : [];
}

function cleanPrefs(b, myAge) {
  const p = b && typeof b === 'object' ? b : {};
  const lo = Math.max(18, Math.min(99, parseInt(p.ageMin, 10) || Math.max(18, (myAge || 25) - 5)));
  const hi = Math.max(lo, Math.min(99, parseInt(p.ageMax, 10) || Math.min(99, (myAge || 25) + 10)));
  const list = (v, allowed) => (Array.isArray(v) ? [...new Set(v.map((x) => clean(x, 60)).filter((x) => x && (!allowed || allowed.includes(x))))].slice(0, 12) : []);
  return {
    ageMin: lo, ageMax: hi,
    country: clean(p.country, 60) || null,
    city: clean(p.city, 60) || null,                     // VIP: advanced location filter
    intentions: list(p.intentions, Object.keys(INTENTIONS)),
    denominations: list(p.denominations),                // Plus: advanced filter
    interests: list(p.interests),                        // free: they share at least one of these
    involvement: list(p.involvement),                    // Plus: advanced filter
    compatibleOnly: !!p.compatibleOnly,                  // VIP: only people whose own preferences include you
  };
}

/** Create / update the dating profile. 403 AGE_RESTRICTED under 18 (nothing is stored). */
export async function saveProfile(env, user, b) {
  const { rules } = await datingConfig(env);
  const existing = await getProfileRow(env, user.id);
  if (existing && existing.status === 'banned') throw forbidden('Your Find Love profile is suspended', 'DATING_BANNED');
  const birth = b.birthDate ? String(b.birthDate).slice(0, 10) : existing ? ymd(existing.birth_date) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) throw bad('Date of birth (YYYY-MM-DD) is required', 'BIRTH_DATE_REQUIRED');
  const age = ageOn(birth);
  if (age == null || age > 100) throw bad('Please enter a valid date of birth', 'BAD_BIRTH_DATE');
  if (age < rules.minAge) throw new ApiError(403, 'AGE_RESTRICTED', `Find Love is only for adults aged ${rules.minAge} and over.`);
  if (!existing && b.confirmAdult !== true) throw bad('Please confirm you are 18 or older', 'ADULT_CONFIRMATION_REQUIRED');
  const pick = (k, d) => (b[k] !== undefined ? b[k] : d);
  const firstName = clean(pick('firstName', existing ? existing.first_name : user.display_name), 40);
  if (!firstName) throw bad('First name is required', 'BAD_PROFILE');
  const gender = pick('gender', existing && existing.gender);
  const interestedIn = pick('interestedIn', existing && existing.interested_in);
  if (!['man', 'woman'].includes(gender)) throw bad('gender must be man or woman', 'BAD_PROFILE');
  if (!['men', 'women'].includes(interestedIn)) throw bad('interestedIn must be men or women', 'BAD_PROFILE');
  const intention = pick('intention', existing ? existing.intention : 'marriage');
  if (!INTENTIONS[intention]) throw bad('Unknown relationship intention', 'BAD_PROFILE');
  const prompts = (Array.isArray(b.prompts) ? b.prompts : parse(existing && existing.prompts, []) || [])
    .map((x) => ({ q: clean(x && x.q, 80), a: clean(x && x.a, 200) })).filter((x) => x.q && x.a).slice(0, 3);
  const prefs = cleanPrefs(b.prefs !== undefined ? b.prefs : parse(existing && existing.prefs, {}), age);
  const interests = cleanTags(pick('interests', existing ? parse(existing.interests, []) : []));
  const vals = [
    user.id, firstName, birth, gender, interestedIn,
    clean(pick('city', existing ? existing.city : ''), 60), clean(pick('country', existing ? existing.country : user.country || ''), 60),
    clean(pick('denomination', existing ? existing.denomination : ''), 60), clean(pick('churchInvolvement', existing ? existing.church_involvement : ''), 60),
    intention, String(pick('bio', existing ? existing.bio : '') || '').trim().slice(0, 500), JSON.stringify(prompts), JSON.stringify(prefs), JSON.stringify(interests),
  ];
  await q(env, `INSERT INTO dating_profiles (user_id, first_name, birth_date, gender, interested_in, city, country, denomination, church_involvement, intention, bio, prompts, prefs, interests)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name, birth_date = EXCLUDED.birth_date, gender = EXCLUDED.gender,
        interested_in = EXCLUDED.interested_in, city = EXCLUDED.city, country = EXCLUDED.country, denomination = EXCLUDED.denomination,
        church_involvement = EXCLUDED.church_involvement, intention = EXCLUDED.intention, bio = EXCLUDED.bio, prompts = EXCLUDED.prompts,
        prefs = EXCLUDED.prefs, interests = EXCLUDED.interests, updated_at = now(), last_active_at = now()`, vals);
  return { created: !existing };
}

async function needProfile(env, user, { active = true } = {}) {
  const p = await getProfileRow(env, user.id);
  if (!p) throw new ApiError(409, 'DATING_PROFILE_REQUIRED', 'Create your Find Love profile first');
  if (p.status === 'banned') throw forbidden('Your Find Love profile is suspended', 'DATING_BANNED');
  if (active && p.status === 'paused') throw new ApiError(409, 'DATING_PAUSED', 'Your profile is hidden. Show it again to continue.');
  if (active && p.report_hold_at) throw new ApiError(409, 'DATING_UNDER_REVIEW', 'Your profile is hidden while our team reviews some reports. You can still chat with your matches.');
  return p;
}

/**
 * Add a photo: an upload key of this member (img/<userId>/…). The row starts 'pending'. Then, by rules.photoReview:
 *   'ai'   → Workers AI check: clean → 'approved' (live at once) · flagged → stays pending + ai_flagged (admin queue with
 *            the AI's reason) · AI missing / error / timeout / unclear reply → stays pending (a human reviews it). Never
 *            approved on an error.
 *   'pre'  → pending until an admin approves it · 'post' → visible at once while pending, reviewed afterwards.
 * → { id, review: 'live' | 'flagged' | 'pending' }
 */
export async function addPhoto(env, user, { key }) {
  await needProfile(env, user, { active: false });
  const { rules } = await datingConfig(env);
  const k = String(key || '');
  if (!k.startsWith(`img/${user.id}/`) || !/^[\w./-]+$/.test(k) || k.includes('..')) throw bad('Upload the photo first (key from /uploads/image)', 'BAD_PHOTO');
  const n = await one(env, `SELECT count(*)::int AS n, COALESCE(max(position), -1)::int AS last FROM dating_photos WHERE user_id = $1 AND status <> 'rejected'`, [user.id]);
  if (n.n >= rules.maxPhotos) throw bad(`Up to ${rules.maxPhotos} photos`, 'TOO_MANY_PHOTOS');
  const row = await one(env, `INSERT INTO dating_photos (user_id, url, position) VALUES ($1, $2, $3) RETURNING id`, [user.id, k, n.last + 1]);
  if (rules.photoReview === 'post') return { id: row.id, review: 'live' };
  if (rules.photoReview !== 'ai') return { id: row.id, review: 'pending' };
  let res;
  try {
    const bytes = await readObjectBytes(env, k);
    res = bytes ? await checkPhoto(env, bytes) : { verdict: 'error', reason: 'Photo file not found for the AI check', labels: null, model: null };
  } catch (e) {
    res = { verdict: 'error', reason: `AI check failed: ${String((e && e.message) || e).slice(0, 160)}`, labels: null, model: null };
  }
  const clean = res.verdict === 'clean';
  await q(env, `UPDATE dating_photos SET status = CASE WHEN $2 THEN 'approved' ELSE status END, ai_verdict = $3, ai_flagged = $4, ai_reason = $5,
      ai_labels = $6::jsonb, ai_model = $7, ai_checked_at = now() WHERE id = $1 AND status = 'pending'`,
  [row.id, clean, res.verdict, res.verdict === 'flagged', res.reason ? String(res.reason).slice(0, 500) : null, res.labels ? JSON.stringify(res.labels) : null, res.model]);
  return { id: row.id, review: clean ? 'live' : res.verdict === 'flagged' ? 'flagged' : 'pending' };
}
export async function removePhoto(env, user, photoId) {
  const r = await q(env, 'DELETE FROM dating_photos WHERE id = $1 AND user_id = $2 RETURNING id', [photoId, user.id]);
  if (!r.length) throw notFound('Photo not found');
}
/** Move a photo to the front (main photo). */
export async function makeMainPhoto(env, user, photoId) {
  const p = await one(env, 'SELECT id FROM dating_photos WHERE id = $1 AND user_id = $2', [photoId, user.id]);
  if (!p) throw notFound('Photo not found');
  await q(env, `UPDATE dating_photos SET position = CASE WHEN id = $2 THEN -1 ELSE position END WHERE user_id = $1`, [user.id, photoId]);
  await q(env, `UPDATE dating_photos d SET position = x.rn FROM (SELECT id, (row_number() OVER (ORDER BY position, created_at) - 1)::int AS rn FROM dating_photos WHERE user_id = $1) x
    WHERE d.id = x.id`, [user.id]);
}

/** Hide / show the profile (the member's own pause). */
export async function setPaused(env, user, paused) {
  const p = await needProfile(env, user, { active: false });
  await q(env, `UPDATE dating_profiles SET status = $2, updated_at = now() WHERE user_id = $1 AND status <> 'banned'`, [user.id, paused ? 'paused' : 'active']);
  return { paused: !!paused, was: p.status };
}

/** Delete the dating profile: profile, photos, swipes and views go; matches end and their chats close. Ledger kept. */
export async function deleteProfile(env, user) {
  await closeAllConversations(env, user.id, 'closed');
  await q(env, `UPDATE dating_matches SET status = 'unmatched', unmatched_by = $1, unmatched_at = now() WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, [user.id]);
  await q(env, 'DELETE FROM dating_swipes WHERE user_id = $1 OR target_id = $1', [user.id]);
  await q(env, 'DELETE FROM dating_views WHERE viewer_id = $1 OR target_id = $1', [user.id]);
  await q(env, 'DELETE FROM dating_photos WHERE user_id = $1', [user.id]);
  await q(env, 'DELETE FROM dating_profiles WHERE user_id = $1', [user.id]);
  // verification: the private selfie / ID images go now; an approved / rejected outcome row stays (no images in it)
  for (const v of await q(env, `SELECT id FROM dating_verifications WHERE user_id = $1 AND files_deleted_at IS NULL`, [user.id])) await dropVerificationFiles(env, v.id);
  await q(env, `UPDATE dating_verifications SET status = 'expired', ai_details = NULL, updated_at = now() WHERE user_id = $1 AND status IN ('draft','pending')`, [user.id]);
  return { deleted: true };
}

// Close every dating chat of a member (unmatch / block / ban / delete): members leave so the chat disappears for both;
// the messages stay in the database for moderation. The send hook refuses messages in a closed dating chat.
export async function closeAllConversations(env, userId, status = 'closed') {
  const convs = await q(env, `UPDATE dating_conversations SET status = $2, closed_at = now(), updated_at = now() WHERE (user_a = $1 OR user_b = $1) AND status IN ('request','match') RETURNING conversation_id`, [userId, status]);
  for (const r of convs) await q(env, 'DELETE FROM conversation_members WHERE conversation_id = $1', [r.conversation_id]);
  return convs.length;
}
async function closePair(env, a, b, { by = null, status = 'closed' } = {}) {
  const [x, y] = pairOf(a, b);
  await q(env, `UPDATE dating_matches SET status = 'unmatched', unmatched_by = $3, unmatched_at = now() WHERE user_a = $1 AND user_b = $2 AND status = 'active'`, [x, y, by]);
  const c = await one(env, `UPDATE dating_conversations SET status = $3, closed_at = now(), updated_at = now() WHERE user_a = $1 AND user_b = $2 AND status IN ('request','match') RETURNING conversation_id`, [x, y, status]);
  if (c) await q(env, 'DELETE FROM conversation_members WHERE conversation_id = $1', [c.conversation_id]);
}

// ─── allowances ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Swipes today: { used, limit, extra, left } (likes + passes; paid likes are not limited). */
export async function swipeAllowance(env, user, ent = null) {
  const { rules } = await datingConfig(env);
  const e = ent || await planOf(env, user);
  const day = today(user.tz_offset);
  const r = await one(env, `SELECT
      (SELECT count(*)::int FROM dating_swipes WHERE user_id = $1 AND day = $2 AND action IN ('like','pass')) AS used,
      (SELECT COALESCE(sum(units), 0)::int FROM dating_spends WHERE user_id = $1 AND day = $2 AND kind = 'extra_swipes') AS extra`, [user.id, day]);
  const base = e.flags && e.flags.moreRecommendations ? rules.plusDailySwipes : rules.dailySwipes;
  const limit = base + r.extra;
  return { day, used: r.used, base, extra: r.extra, limit, left: Math.max(0, limit - r.used) };
}

const ALLOWED_SQL = `(COALESCE((SELECT sum(units) FROM dating_ad_rewards WHERE conversation_id = $1 AND user_id = $2 AND status = 'claimed'), 0)
   + COALESCE((SELECT sum(units) FROM dating_spends WHERE conversation_id = $1 AND user_id = $2 AND kind = 'message_bundle'), 0))::int`;

/** Free-message state of one member in one dating chat. */
export async function messageAllowance(env, user, convId, ent = null) {
  const { prices, rules } = await datingConfig(env);
  const e = ent || await planOf(env, user);
  const r = await one(env, `SELECT ${ALLOWED_SQL} AS allowed,
      COALESCE((SELECT used FROM dating_message_usage WHERE conversation_id = $1 AND user_id = $2), 0)::int AS used,
      (SELECT count(*)::int FROM dating_ad_rewards WHERE conversation_id = $1 AND user_id = $2 AND status = 'claimed') AS ads,
      (SELECT count(*)::int FROM dating_spends WHERE conversation_id = $1 AND user_id = $2 AND kind = 'message_bundle') AS bundles`, [convId, user.id]);
  const free = unrestricted(e) || user.role === 'admin';
  return {
    unrestricted: free, plan: e.plan, allowed: r.allowed, used: r.used, left: free ? null : Math.max(0, r.allowed - r.used),
    adUnlocksUsed: r.ads, adUnlocksLeft: free ? 0 : Math.max(0, rules.maxAdUnlocks - r.ads), messagesPerAd: rules.freeMessagesPerAd,
    bundles: r.bundles, bundleCost: prices.message_bundle, bundleSize: rules.messagesPerBundle,
    needsUnlock: !free && r.allowed - r.used <= 0, requireSsv: !!rules.requireSsv,
  };
}

/**
 * THE SEND HOOK (called once from the chat send path, routes/conversations.js, marked "FIND LOVE HOOK").
 * Not a dating chat → null (nothing happens). Request / closed dating chat → 403. Gift messages and Plus / VIP / admins
 * → not counted. Free members: uses one message of the allowance in ONE statement, or 402 DATING_MESSAGES_LOCKED.
 */
export async function datingSendGuard(env, user, convId, { kind = 'text', meta = null } = {}) {
  const dc = await one(env, 'SELECT status, requester_id FROM dating_conversations WHERE conversation_id = $1', [convId]);
  if (!dc) return null;
  if (dc.status === 'request') throw forbidden('This message request has not been accepted yet', 'DATING_REQUEST_PENDING');
  if (dc.status !== 'match') throw forbidden('This Find Love conversation has ended', 'DATING_CHAT_CLOSED');
  if (kind === 'gift' || (meta && meta.gift)) return { counted: false, reason: 'gift' };
  if (kind === 'system') return { counted: false, reason: 'system' };
  const ent = await planOf(env, user);
  if (unrestricted(ent) || user.role === 'admin') return { counted: false, reason: 'plan' };
  await q(env, 'INSERT INTO dating_message_usage (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [convId, user.id]);
  const row = await one(env, `UPDATE dating_message_usage SET used = used + 1, updated_at = now()
      WHERE conversation_id = $1 AND user_id = $2 AND used < ${ALLOWED_SQL} RETURNING used, ${ALLOWED_SQL} AS allowed`, [convId, user.id]);
  if (!row) {
    const a = await messageAllowance(env, user, convId, ent);
    const err = new ApiError(402, 'DATING_MESSAGES_LOCKED', a.adUnlocksLeft > 0
      ? `Watch a short ad to unlock ${a.messagesPerAd} free messages, or use ${a.bundleCost} Dating Coins for ${a.bundleSize} more.`
      : `Unlock ${a.bundleSize} more messages for ${a.bundleCost} Dating Coins, or upgrade to Dating Plus.`);
    err.details = { allowance: a };
    throw err;
  }
  return { counted: true, left: Math.max(0, row.allowed - row.used) };
}

// ─── paid uses (all through spend(); business rows in the same transaction) ─────────────────────────────────────────
const SPEND_SQL = `INSERT INTO dating_spends (ref, user_id, kind, wallet, amount, units, target_id, conversation_id, day)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (ref) DO NOTHING`;
async function paidUse(c, user, { ref, kind, amount, units = 0, wallet = 'dating_coins', targetId = null, convId = null, alsoRun = [], ledgerKind = null }) {
  await rateLimit(c.env, `dating_spend:${user.id}`, 30, 60);
  const day = today(user.tz_offset);
  const r = await spend(c.env, {
    ref, userId: user.id, wallet, amount, kind: ledgerKind || kind, relatedType: convId ? 'conversation' : targetId ? 'dating_profile' : 'dating', relatedId: convId || targetId || null,
    counterpartyId: targetId || undefined, meta: { feature: kind, units },
    alsoRun: [[SPEND_SQL, [ref, user.id, kind, wallet, amount, units, targetId, convId, day]], ...alsoRun],
  });
  const balance = await getBalance(c.env, user.id, wallet);
  if (r.applied) await walletNotify(c, { userId: user.id, title: COIN_KINDS[kind] || 'Find Love', body: `${amount} ${wallet === 'dating_boosts' ? 'boost' : 'Dating Coins'} used · balance ${balance}`, data: { wallet, screen: 'FindLove' }, kind: 'wallet' });
  return { charged: r.applied, duplicate: !!r.duplicate, ref, amount, wallet, balance };
}

// allowHeld: a profile hidden after reports can still be seen by people who already have a chat with it (header).
async function targetProfile(env, me, targetId, { allowHeld = false } = {}) {
  if (!isUuid(targetId) || targetId === me.id) throw bad('Choose someone else', 'BAD_TARGET');
  const t = await one(env, `SELECT p.*, u.banned FROM dating_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`, [targetId]);
  if (!t || t.status !== 'active' || t.banned) throw notFound('This profile is not available');
  if (t.report_hold_at && !allowHeld) throw notFound('This profile is not available');
  if (await isBlocked(env, me.id, targetId)) throw notFound('This profile is not available');
  return t;
}
function compatible(a, b) {
  const seeks = (p) => (p.interested_in === 'men' ? 'man' : 'woman');
  return seeks(a) === b.gender && seeks(b) === a.gender;
}

// ─── discovery ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The card stack. Filters (always): active + not banned + visible photo, both people's gender and age preferences,
 * no block either way, not swiped / matched / reported / in a request. Filters by plan: country + intentions (all),
 * denomination + involvement (advancedFilters), city + compatibleOnly (advancedLocationFilters). Ranking only:
 * Priority Like on you, Spotlight, Super Like on you, Boost, VIP priority visibility, same city, recently active.
 */
export async function discover(env, user, ctx, { limit = null, record = true } = {}) {
  const me = await needProfile(env, user);
  const { rules } = await datingConfig(env);
  const ent = await planOf(env, user);
  const f = ent.flags || {};
  const prefs = cleanPrefs(parse(me.prefs, {}), ageOn(me.birth_date));
  const n = Math.min(50, Math.max(1, Number(limit) || (f.moreRecommendations ? rules.plusBatch : rules.batch)));
  const arr = (v) => (v && v.length ? v : null);
  const rows = await q(env, `WITH me AS (SELECT * FROM dating_profiles WHERE user_id = $1)
    SELECT p.*, ${AGE_SQL('p')} AS age,
      (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'url', ph.url) ORDER BY ph.position, ph.created_at), '[]'::json)
         FROM dating_photos ph WHERE ph.user_id = p.user_id AND ${photoVisibleSql('ph', '$11')}) AS photos,
      (SELECT s.action FROM dating_swipes s WHERE s.user_id = p.user_id AND s.target_id = $1) AS their_action,
      EXISTS (SELECT 1 FROM dating_boosts b WHERE b.user_id = p.user_id AND b.kind <> 'spotlight_24h' AND now() >= b.starts_at AND now() < b.ends_at) AS boosted,
      EXISTS (SELECT 1 FROM dating_boosts b WHERE b.user_id = p.user_id AND b.kind = 'spotlight_24h' AND now() >= b.starts_at AND now() < b.ends_at) AS spotlight,
      COALESCE((${LIVE_SUB('p.user_id')})->'flags'->>'priorityVisibility', 'false') = 'true' AS priority,
      COALESCE((${LIVE_SUB('p.user_id')})->'flags'->>'vipBadge', 'false') = 'true' AS vip_badge
    FROM dating_profiles p JOIN users u ON u.id = p.user_id, me
    WHERE p.user_id <> me.user_id AND p.status = 'active' AND NOT u.banned AND p.report_hold_at IS NULL
      AND p.gender = ${SEEKS('me')} AND me.gender = ${SEEKS('p')}
      AND ${AGE_SQL('p')} BETWEEN $3 AND $4
      AND ${AGE_SQL('me')} BETWEEN COALESCE((p.prefs->>'ageMin')::int, 18) AND COALESCE((p.prefs->>'ageMax')::int, 99)
      AND ($5::text IS NULL OR lower(p.country) = lower($5))
      AND ($6::text IS NULL OR lower(p.city) = lower($6))
      AND ($7::text[] IS NULL OR p.intention = ANY($7))
      AND ($8::text[] IS NULL OR p.denomination = ANY($8))
      AND ($9::text[] IS NULL OR p.church_involvement = ANY($9))
      AND ($12::text[] IS NULL OR p.interests ?| $12::text[])
      AND (NOT $10 OR (
            (jsonb_array_length(COALESCE(p.prefs->'intentions', '[]'::jsonb)) = 0 OR (p.prefs->'intentions') ? me.intention)
        AND (jsonb_array_length(COALESCE(p.prefs->'denominations', '[]'::jsonb)) = 0 OR (p.prefs->'denominations') ? me.denomination)
        AND (COALESCE(p.prefs->>'country', '') = '' OR lower(p.prefs->>'country') = lower(me.country))))
      AND EXISTS (SELECT 1 FROM dating_photos ph WHERE ph.user_id = p.user_id AND ${photoVisibleSql('ph', '$11')})
      AND NOT ${BLOCKED_SQL('$1::uuid', 'p.user_id')}
      AND NOT EXISTS (SELECT 1 FROM dating_swipes s WHERE s.user_id = $1 AND s.target_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM dating_matches m WHERE m.user_a = LEAST($1::uuid, p.user_id) AND m.user_b = GREATEST($1::uuid, p.user_id))
      AND NOT EXISTS (SELECT 1 FROM dating_conversations dc WHERE dc.user_a = LEAST($1::uuid, p.user_id) AND dc.user_b = GREATEST($1::uuid, p.user_id))
      AND NOT EXISTS (SELECT 1 FROM dating_reports r WHERE r.reporter_id = $1 AND r.target_id = p.user_id)
    ORDER BY COALESCE((SELECT s.action FROM dating_swipes s WHERE s.user_id = p.user_id AND s.target_id = $1) = 'priority_like', false) DESC, -- COALESCE: a plain like must never rank above "no swipe" (it would leak who liked you)
      spotlight DESC, COALESCE((SELECT s.action FROM dating_swipes s WHERE s.user_id = p.user_id AND s.target_id = $1) = 'super_like', false) DESC,
      boosted DESC, priority DESC, (lower(p.city) = lower(me.city) AND p.city <> '') DESC, p.last_active_at DESC, p.user_id
    LIMIT $2`, [
    user.id, n, prefs.ageMin, prefs.ageMax, prefs.country,
    f.advancedLocationFilters ? prefs.city : null, arr(prefs.intentions),
    f.advancedFilters ? arr(prefs.denominations) : null, f.advancedFilters ? arr(prefs.involvement) : null,
    !!(f.advancedLocationFilters && prefs.compatibleOnly), rules.photoReview, arr(prefs.interests),
  ]);
  if (record && rows.length) {
    await q(env, `INSERT INTO dating_views (viewer_id, target_id) SELECT $1, unnest($2::uuid[])
      ON CONFLICT (viewer_id, target_id) DO UPDATE SET last_seen_at = now()`, [user.id, rows.map((r) => r.user_id)]);
  }
  q(env, 'UPDATE dating_profiles SET last_active_at = now() WHERE user_id = $1', [user.id]).catch(() => {});
  return { items: rows.map((r) => cardShape(r, ctx)), filters: prefs, applied: { advanced: !!f.advancedFilters, location: !!f.advancedLocationFilters } };
}

/** One other member's profile, if they could appear for you (or you are matched / they liked you / a request exists). */
export async function viewProfile(env, user, targetId, ctx) {
  await needProfile(env, user, { active: false });
  const [px, py] = isUuid(targetId) ? pairOf(user.id, targetId) : [null, null];
  const chatted = !!(px && await one(env, 'SELECT 1 FROM dating_conversations WHERE user_a = $1 AND user_b = $2', [px, py]));
  const t = await targetProfile(env, user, targetId, { allowHeld: chatted });
  const { rules } = await datingConfig(env);
  const r = await one(env, `SELECT p.*, ${AGE_SQL('p')} AS age,
      (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'url', ph.url) ORDER BY ph.position, ph.created_at), '[]'::json)
         FROM dating_photos ph WHERE ph.user_id = p.user_id AND ${photoVisibleSql('ph', '$3')}) AS photos,
      (SELECT s.action FROM dating_swipes s WHERE s.user_id = p.user_id AND s.target_id = $2) AS their_action,
      EXISTS (SELECT 1 FROM dating_boosts b WHERE b.user_id = p.user_id AND now() >= b.starts_at AND now() < b.ends_at) AS boosted,
      COALESCE((${LIVE_SUB('p.user_id')})->'flags'->>'vipBadge', 'false') = 'true' AS vip_badge
    FROM dating_profiles p WHERE p.user_id = $1`, [t.user_id, user.id, rules.photoReview]);
  const card = cardShape(r, ctx);
  card.superLikedYou = false; // only shown in the stack
  return card;
}

// ─── swipes, matches ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Like / pass (free, daily allowance) or Super Like / Priority Like (coins, confirmed in the app; not limited by the
 * allowance). A like back from someone who liked you → match + dating chat. Idempotent per pair.
 */
export async function swipe(c, user, { targetId, action, idempotencyKey = null }) {
  const env = c.env;
  if (!['like', 'pass', 'super_like', 'priority_like'].includes(action)) throw bad('action must be like, pass, super_like or priority_like', 'BAD_ACTION');
  const me = await needProfile(env, user);
  const t = await targetProfile(env, user, targetId);
  if (!compatible(me, t)) throw notFound('This profile is not available');
  const prev = await one(env, 'SELECT action FROM dating_swipes WHERE user_id = $1 AND target_id = $2', [user.id, targetId]);
  if (prev) return { action: prev.action, duplicate: true, match: await matchBetween(env, user.id, targetId), swipes: await swipeAllowance(env, user) };
  const day = today(user.tz_offset);
  let charged = null;
  if (action === 'like' || action === 'pass') {
    const ent = await planOf(env, user);
    const a = await swipeAllowance(env, user, ent);
    const ins = await q(env, `INSERT INTO dating_swipes (user_id, target_id, action, day)
        SELECT $1, $2, $3, $4 WHERE (SELECT count(*) FROM dating_swipes WHERE user_id = $1 AND day = $4 AND action IN ('like','pass')) < $5
        ON CONFLICT (user_id, target_id) DO NOTHING RETURNING action`, [user.id, targetId, action, day, a.limit]);
    if (!ins.length) {
      const again = await one(env, 'SELECT action FROM dating_swipes WHERE user_id = $1 AND target_id = $2', [user.id, targetId]);
      if (again) return { action: again.action, duplicate: true, match: await matchBetween(env, user.id, targetId), swipes: await swipeAllowance(env, user) };
      const { prices, rules } = await datingConfig(env);
      const err = new ApiError(429, 'SWIPE_LIMIT_REACHED', `You've used today's ${a.limit} swipes. Get ${rules.extraSwipes} more for ${prices.extra_swipes} Dating Coins, or come back tomorrow.`);
      err.details = { swipes: a, offer: { coins: prices.extra_swipes, swipes: rules.extraSwipes } };
      throw err;
    }
  } else {
    const { prices } = await datingConfig(env);
    charged = await paidUse(c, user, {
      ref: `${action}:${user.id}:${targetId}`, kind: action, amount: prices[action], targetId,
      alsoRun: [[`INSERT INTO dating_swipes (user_id, target_id, action, day) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, target_id) DO NOTHING`, [user.id, targetId, action, day]]],
    });
    if (charged.charged) {
      await tell(c, targetId, { title: action === 'super_like' ? 'Someone sent you a Super Like ⭐' : 'Someone is interested in you 💛', body: 'Open Find Love to see who it might be.', data: { event: action } });
    }
  }
  let match = null;
  if (action !== 'pass') {
    const back = await one(env, `SELECT action FROM dating_swipes WHERE user_id = $1 AND target_id = $2 AND action <> 'pass'`, [targetId, user.id]);
    if (back) match = await createMatch(c, user.id, targetId, 'like');
  }
  return { action, duplicate: false, match, charged, swipes: await swipeAllowance(env, user) };
}

async function matchBetween(env, a, b) {
  const [x, y] = pairOf(a, b);
  const m = await one(env, `SELECT id, conversation_id, status, created_at FROM dating_matches WHERE user_a = $1 AND user_b = $2`, [x, y]);
  return m && m.status === 'active' ? { id: m.id, conversationId: m.conversation_id, createdAt: iso(m.created_at) } : null;
}

/** Ensure the dating DM for a pair: reuse the labelled one or create conversation + members + label. */
async function ensureDatingConversation(env, a, b, { status, requesterId = null }) {
  const [x, y] = pairOf(a, b);
  const have = await one(env, 'SELECT conversation_id, status FROM dating_conversations WHERE user_a = $1 AND user_b = $2', [x, y]);
  if (have) return { id: have.conversation_id, status: have.status, isNew: false };
  const conv = await one(env, `INSERT INTO conversations (kind) VALUES ('dm') RETURNING id`);
  const lab = await q(env, `INSERT INTO dating_conversations (conversation_id, user_a, user_b, requester_id, status) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (user_a, user_b) DO NOTHING RETURNING conversation_id`, [conv.id, x, y, requesterId, status]);
  if (!lab.length) { // a concurrent call won: drop ours
    await q(env, 'DELETE FROM conversations WHERE id = $1', [conv.id]);
    const w = await one(env, 'SELECT conversation_id, status FROM dating_conversations WHERE user_a = $1 AND user_b = $2', [x, y]);
    return { id: w.conversation_id, status: w.status, isNew: false };
  }
  await q(env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member') ON CONFLICT DO NOTHING`, [conv.id, a, b]);
  return { id: conv.id, status, isNew: true };
}

/** Mutual interest → one match row + the dating chat (status 'match'). Idempotent. Both people are told. */
export async function createMatch(c, a, b, via = 'like') {
  const env = c.env;
  const [x, y] = pairOf(a, b);
  const ins = await q(env, `INSERT INTO dating_matches (user_a, user_b, via) VALUES ($1, $2, $3) ON CONFLICT (user_a, user_b) DO NOTHING RETURNING id`, [x, y, via]);
  const m = await one(env, 'SELECT * FROM dating_matches WHERE user_a = $1 AND user_b = $2', [x, y]);
  if (m.status !== 'active') return null;
  const conv = await ensureDatingConversation(env, a, b, { status: 'match' });
  await q(env, `UPDATE dating_conversations SET status = 'match', match_id = $2, closed_at = NULL, updated_at = now() WHERE conversation_id = $1 AND status IN ('request','match','declined')`, [conv.id, m.id]);
  await q(env, `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member') ON CONFLICT DO NOTHING`, [conv.id, a, b]);
  if (!m.conversation_id) await q(env, 'UPDATE dating_matches SET conversation_id = $2 WHERE id = $1', [m.id, conv.id]);
  if (ins.length) {
    const names = await q(env, 'SELECT user_id, first_name FROM dating_profiles WHERE user_id = ANY($1::uuid[])', [[a, b]]);
    const nm = (id) => (names.find((r) => r.user_id === id) || {}).first_name || 'Someone';
    await tell(c, a, { title: 'It’s a match 💛', body: `You and ${nm(b)} like each other. Say hello!`, data: { event: 'match', conversationId: conv.id, matchId: m.id } });
    await tell(c, b, { title: 'It’s a match 💛', body: `You and ${nm(a)} like each other. Say hello!`, data: { event: 'match', conversationId: conv.id, matchId: m.id } });
  }
  return { id: m.id, conversationId: conv.id, createdAt: iso(m.created_at), isNew: ins.length > 0 };
}

/** Plus: undo the last like / pass (within rules.undoMinutes, not if it made a match). Paid likes cannot be undone. */
export async function undoLastSwipe(env, user, ctx) {
  const ent = await planOf(env, user);
  if (!(ent.flags && ent.flags.undoSwipes)) throw new ApiError(402, 'PLAN_REQUIRED', 'Undo is part of Dating Plus');
  const { rules } = await datingConfig(env);
  const last = await one(env, `SELECT * FROM dating_swipes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [user.id]);
  if (!last || !['like', 'pass'].includes(last.action) || Date.now() - new Date(last.created_at).getTime() > rules.undoMinutes * 60e3) throw bad('Nothing to undo', 'NOTHING_TO_UNDO');
  if (await matchBetween(env, user.id, last.target_id)) throw bad('You already matched — use Unmatch instead', 'NOTHING_TO_UNDO');
  await q(env, 'DELETE FROM dating_swipes WHERE user_id = $1 AND target_id = $2', [user.id, last.target_id]);
  let card = null;
  try { card = await viewProfile(env, user, last.target_id, ctx); } catch (e) { /* gone meanwhile */ }
  return { undone: last.action, card };
}

/** Likes you received and haven't answered. List visible with Plus/VIP (seeWhoLiked) or a coin unlock; else count only. */
export async function likesReceived(env, user, ctx) {
  await needProfile(env, user, { active: false });
  const ent = await planOf(env, user);
  const { rules, prices } = await datingConfig(env);
  const unlock = await one(env, `SELECT max(created_at + make_interval(hours => units))::timestamptz AS until FROM dating_spends WHERE user_id = $1 AND kind = 'see_who_liked'`, [user.id]);
  const until = unlock && unlock.until && new Date(unlock.until) > new Date() ? iso(unlock.until) : null;
  const open = !!(ent.flags && ent.flags.seeWhoLiked) || !!until;
  const rows = await q(env, `SELECT p.*, ${AGE_SQL('p')} AS age, s.action AS their_action, s.created_at AS liked_at,
      (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'url', ph.url) ORDER BY ph.position, ph.created_at), '[]'::json)
         FROM dating_photos ph WHERE ph.user_id = p.user_id AND ${photoVisibleSql('ph', '$2')}) AS photos
    FROM dating_swipes s JOIN dating_profiles p ON p.user_id = s.user_id JOIN users u ON u.id = p.user_id
    WHERE s.target_id = $1 AND s.action <> 'pass' AND p.status = 'active' AND NOT u.banned AND p.report_hold_at IS NULL
      AND NOT ${BLOCKED_SQL('$1::uuid', 'p.user_id')}
      AND NOT EXISTS (SELECT 1 FROM dating_swipes m WHERE m.user_id = $1 AND m.target_id = s.user_id)
    ORDER BY (s.action = 'priority_like') DESC, (s.action = 'super_like') DESC, s.created_at DESC LIMIT 100`, [user.id, rules.photoReview]);
  return {
    count: rows.length, unlocked: open, unlockedUntil: until, viaPlan: !!(ent.flags && ent.flags.seeWhoLiked),
    offer: { coins: prices.see_who_liked, hours: rules.likesUnlockHours },
    items: open ? rows.map((r) => ({ ...cardShape(r, ctx), likedAt: iso(r.liked_at), kind: r.their_action })) : [],
  };
}

/** Coins: unlock "See who liked you" for rules.likesUnlockHours (per period, not per use). Free with Plus / VIP. */
export async function unlockLikes(c, user, idempotencyKey) {
  const key = needKey(idempotencyKey);
  await needProfile(c.env, user, { active: false });
  const ent = await planOf(c.env, user);
  if (ent.flags && ent.flags.seeWhoLiked) throw new ApiError(409, 'NOT_NEEDED', 'Your plan already shows who liked you');
  const { prices, rules } = await datingConfig(c.env);
  const ref = `see_who_liked:${user.id}:${key}`;
  const dup = await one(c.env, 'SELECT 1 FROM dating_spends WHERE ref = $1', [ref]);
  if (!dup) {
    const live = await one(c.env, `SELECT 1 FROM dating_spends WHERE user_id = $1 AND kind = 'see_who_liked' AND created_at + make_interval(hours => units) > now()`, [user.id]);
    if (live) throw new ApiError(409, 'ALREADY_UNLOCKED', 'Your likes are already unlocked');
  }
  return paidUse(c, user, { ref, kind: 'see_who_liked', amount: prices.see_who_liked, units: rules.likesUnlockHours });
}

/** Coins: +N swipes today. */
export async function buyExtraSwipes(c, user, idempotencyKey) {
  const key = needKey(idempotencyKey);
  await needProfile(c.env, user);
  const { prices, rules } = await datingConfig(c.env);
  const r = await paidUse(c, user, { ref: `extra_swipes:${user.id}:${key}`, kind: 'extra_swipes', amount: prices.extra_swipes, units: rules.extraSwipes });
  return { ...r, swipes: await swipeAllowance(c.env, user) };
}

// ─── matches list, unmatch, block, report ──────────────────────────────────────────────────────────────────────────
export async function listMatches(env, user, ctx) {
  const { rules } = await datingConfig(env);
  const rows = await q(env, `WITH mm AS (
      SELECT m.*, CASE WHEN m.user_a = $1 THEN m.user_b ELSE m.user_a END AS other_id FROM dating_matches m
      WHERE (m.user_a = $1 OR m.user_b = $1) AND m.status = 'active')
    SELECT mm.id AS match_id, mm.conversation_id, mm.created_at AS matched_at, mm.via, p.*, ${AGE_SQL('p')} AS age,
      (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'url', ph.url) ORDER BY ph.position, ph.created_at), '[]'::json)
         FROM dating_photos ph WHERE ph.user_id = p.user_id AND ${photoVisibleSql('ph', '$2')}) AS photos,
      (SELECT json_build_object('text', CASE WHEN msg.deleted THEN 'This message was deleted' ELSE msg.body END, 'kind', msg.kind, 'senderId', msg.sender_id, 'createdAt', msg.created_at)
         FROM messages msg WHERE msg.conversation_id = mm.conversation_id ORDER BY msg.created_at DESC LIMIT 1) AS last_message,
      (SELECT count(*)::int FROM messages um JOIN conversation_members cm ON cm.conversation_id = um.conversation_id AND cm.user_id = $1
         WHERE um.conversation_id = mm.conversation_id AND um.sender_id <> $1 AND um.created_at > cm.last_read_at AND NOT um.deleted) AS unread
    FROM mm JOIN dating_profiles p ON p.user_id = mm.other_id JOIN users u ON u.id = p.user_id
    WHERE NOT u.banned AND p.status <> 'banned' AND NOT ${BLOCKED_SQL('$1::uuid', 'p.user_id')}
    ORDER BY COALESCE((SELECT max(created_at) FROM messages WHERE conversation_id = mm.conversation_id), mm.created_at) DESC LIMIT 200`, [user.id, rules.photoReview]);
  return rows.map((r) => {
    const lm = parse(r.last_message, null);
    return { matchId: r.match_id, conversationId: r.conversation_id, matchedAt: iso(r.matched_at), via: r.via, profile: cardShape(r, ctx),
      lastMessage: lm ? { text: lm.kind === 'text' || !lm.kind ? lm.text : (lm.text || 'Attachment'), kind: lm.kind, mine: lm.senderId === user.id, createdAt: iso(lm.createdAt) } : null,
      unread: r.unread || 0 };
  });
}

export async function unmatch(env, user, matchId) {
  const m = await one(env, 'SELECT * FROM dating_matches WHERE id = $1 AND (user_a = $2 OR user_b = $2)', [matchId, user.id]);
  if (!m) throw notFound('Match not found');
  await closePair(env, m.user_a, m.user_b, { by: user.id });
  return { unmatched: true };
}

/** Block (app-wide `blocks`, so it applies in Socials and chats too) + end any match / request. */
export async function blockMember(env, user, targetId) {
  if (!isUuid(targetId) || targetId === user.id) throw bad('Choose someone else', 'BAD_TARGET');
  if (!(await one(env, 'SELECT 1 FROM users WHERE id = $1', [targetId]))) throw notFound('Member not found');
  await q(env, 'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, targetId]);
  await closePair(env, user.id, targetId, { by: user.id });
  return { blocked: true };
}

/** Report to the moderation queue (optionally block too). "underage" hides the profile at once pending review. */
export async function reportMember(env, user, { userId: targetId, reason, details = '', block = false }) {
  if (!isUuid(targetId) || targetId === user.id) throw bad('Choose someone else', 'BAD_TARGET');
  if (!REPORT_REASONS.includes(reason)) throw bad(`reason must be one of ${REPORT_REASONS.join(', ')}`, 'BAD_REASON');
  await rateLimit(env, `dating_report:${user.id}`, 20, 3600);
  const t = await getProfileRow(env, targetId);
  if (!t) throw notFound('Profile not found');
  const r = await one(env, `INSERT INTO dating_reports (reporter_id, target_id, reason, details) VALUES ($1,$2,$3,$4) RETURNING id`, [user.id, targetId, reason, clean(details, 1000)]);
  if (reason === 'underage') {
    await q(env, `UPDATE dating_profiles SET status = 'banned', ban_reason = 'Under review: reported as under 18', updated_at = now() WHERE user_id = $1 AND status <> 'banned'`, [targetId]);
  }
  const autoHidden = await maybeAutoHide(env, targetId);
  if (block) await blockMember(env, user, targetId);
  return { reported: true, id: r.id, blocked: !!block, autoHidden };
}

/**
 * Auto-hide (client answer Q26b): once reports from rules.autoHideReports DIFFERENT members have arrived since the last
 * admin restore, the profile is hidden from discovery and new contact (report_hold_at) and shows in the admin queue.
 * One statement, so concurrent reports can't race. 0 = off. → true when this call hid it.
 */
export async function maybeAutoHide(env, targetId) {
  const { rules } = await datingConfig(env);
  const n = Number(rules.autoHideReports) || 0;
  if (n <= 0) return false;
  const r = await one(env, `UPDATE dating_profiles p SET report_hold_at = now(), updated_at = now()
      WHERE p.user_id = $1 AND p.report_hold_at IS NULL
        AND (SELECT count(DISTINCT r.reporter_id) FROM dating_reports r WHERE r.target_id = p.user_id
             AND r.created_at > COALESCE(p.reports_cleared_at, '-infinity'::timestamptz)) >= $2
      RETURNING user_id`, [targetId, n]);
  return !!r;
}

/** Admin: show a profile again after an auto-hide (or a suspension). Reports before now stop counting. */
export async function restoreProfile(env, userId, adminId) {
  await q(env, `UPDATE dating_profiles SET report_hold_at = NULL, reports_cleared_at = now(), updated_at = now() WHERE user_id = $1`, [userId]);
  await q(env, `UPDATE dating_reports SET status = 'dismissed', action = 'restore', handled_by = $2, handled_at = now() WHERE target_id = $1 AND status = 'open'`, [userId, adminId]);
}

// ─── message requests (25 coins: message before matching) ─────────────────────────────────────────────────────────
export async function sendMessageRequest(c, user, { targetId, text, idempotencyKey }) {
  const env = c.env;
  needKey(idempotencyKey);
  const body = String(text || '').trim();
  if (body.length < 1 || body.length > 500) throw bad('Write a short message (1-500 characters)', 'BAD_MESSAGE');
  const me = await needProfile(env, user);
  const t = await targetProfile(env, user, targetId);
  if (!compatible(me, t)) throw notFound('This profile is not available');
  if (await matchBetween(env, user.id, targetId)) throw new ApiError(409, 'ALREADY_MATCHED', 'You are already matched — open your chat');
  const [x, y] = pairOf(user.id, targetId);
  const have = await one(env, 'SELECT * FROM dating_conversations WHERE user_a = $1 AND user_b = $2', [x, y]);
  if (have && have.requester_id === user.id && have.status === 'request') return { conversationId: have.conversation_id, status: 'request', charged: false, duplicate: true };
  if (have) throw new ApiError(409, 'ALREADY_CONNECTED', 'You already have a conversation with this person');
  await rateLimit(env, `dating_request:${user.id}`, 20, 86400);
  const { prices } = await datingConfig(env);
  const ref = `message_request:${user.id}:${targetId}`;
  // the conversation shell first (no label yet); the label, message, like and the coin spend commit together
  const conv = await one(env, `INSERT INTO conversations (kind) VALUES ('dm') RETURNING id`);
  let r;
  try {
    r = await paidUse(c, user, {
      ref, kind: 'message_request', amount: prices.message_request, targetId, convId: conv.id,
      alsoRun: [
        [`INSERT INTO dating_conversations (conversation_id, user_a, user_b, requester_id, status) VALUES ($1,$2,$3,$4,'request') ON CONFLICT DO NOTHING`, [conv.id, x, y, user.id]],
        [`INSERT INTO conversation_members (conversation_id, user_id, role)
          SELECT $1, u, 'member' FROM unnest(ARRAY[$2::uuid, $3::uuid]) AS u WHERE EXISTS (SELECT 1 FROM dating_conversations WHERE conversation_id = $1) ON CONFLICT DO NOTHING`, [conv.id, user.id, targetId]],
        [`INSERT INTO messages (conversation_id, sender_id, kind, body, client_id)
          SELECT $1, $2, 'text', $3, $4 WHERE EXISTS (SELECT 1 FROM dating_conversations WHERE conversation_id = $1)
            AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = $1 AND client_id = $4)`, [conv.id, user.id, body, ref]],
        [`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conv.id]],
        [`INSERT INTO dating_swipes (user_id, target_id, action, day) VALUES ($1,$2,'like',$3) ON CONFLICT (user_id, target_id) DO NOTHING`, [user.id, targetId, today(user.tz_offset)]],
      ],
    });
  } finally {
    const labelled = await one(env, 'SELECT 1 FROM dating_conversations WHERE conversation_id = $1', [conv.id]);
    if (!labelled) await q(env, 'DELETE FROM conversations WHERE id = $1', [conv.id]); // spend failed or a duplicate: drop the shell
  }
  const dc = await one(env, 'SELECT conversation_id, status FROM dating_conversations WHERE user_a = $1 AND user_b = $2', [x, y]);
  if (r.charged) await tell(c, targetId, { title: 'New message request 💌', body: `${me.first_name} sent you a message on Find Love`, data: { event: 'request', conversationId: dc.conversation_id } });
  return { conversationId: dc.conversation_id, status: dc.status, charged: r.charged, balance: r.balance, duplicate: !r.charged };
}

export async function listRequests(env, user, ctx) {
  const { rules } = await datingConfig(env);
  const rows = await q(env, `SELECT dc.conversation_id, dc.created_at AS requested_at, dc.requester_id, p.*, ${AGE_SQL('p')} AS age,
      (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'url', ph.url) ORDER BY ph.position, ph.created_at), '[]'::json)
         FROM dating_photos ph WHERE ph.user_id = p.user_id AND ${photoVisibleSql('ph', '$2')}) AS photos,
      (SELECT body FROM messages WHERE conversation_id = dc.conversation_id ORDER BY created_at LIMIT 1) AS first_message
    FROM dating_conversations dc JOIN dating_profiles p ON p.user_id = CASE WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END
    WHERE (dc.user_a = $1 OR dc.user_b = $1) AND dc.status = 'request' AND p.status = 'active'
      AND NOT ${BLOCKED_SQL('$1::uuid', 'p.user_id')}
    ORDER BY dc.created_at DESC LIMIT 100`, [user.id, rules.photoReview]);
  return rows.map((r) => ({ conversationId: r.conversation_id, incoming: r.requester_id !== user.id, requestedAt: iso(r.requested_at), message: r.first_message || '', profile: cardShape(r, ctx) }));
}

export async function answerRequest(c, user, convId, accept) {
  const dc = await one(c.env, 'SELECT * FROM dating_conversations WHERE conversation_id = $1', [convId]);
  if (!dc || (dc.user_a !== user.id && dc.user_b !== user.id) || dc.requester_id === user.id) throw notFound('Request not found');
  if (dc.status !== 'request') return { status: dc.status };
  if (accept) {
    await needProfile(c.env, user);
    const m = await createMatch(c, dc.requester_id, user.id, 'message_request');
    return { status: 'match', match: m };
  }
  // No coin refund for a declined request (client answer Q30): the sender's 25 coins stay spent. Tested.
  await q(c.env, `UPDATE dating_conversations SET status = 'declined', closed_at = now(), updated_at = now() WHERE conversation_id = $1 AND status = 'request'`, [convId]);
  await q(c.env, 'DELETE FROM conversation_members WHERE conversation_id = $1', [convId]);
  return { status: 'declined' };
}

/** The dating chat header: status, the other profile, my allowance. */
export async function conversationInfo(env, user, convId, ctx) {
  const dc = await one(env, 'SELECT * FROM dating_conversations WHERE conversation_id = $1', [convId]);
  if (!dc || (dc.user_a !== user.id && dc.user_b !== user.id)) throw notFound('Conversation not found');
  const otherId = dc.user_a === user.id ? dc.user_b : dc.user_a;
  let profile = null;
  try { profile = await viewProfile(env, user, otherId, ctx); } catch (e) { profile = null; }
  const ent = await planOf(env, user);
  const { rules } = await datingConfig(env);
  // "Show the profile for trusted" (client D10, our reading — to be confirmed): the other person's social profile
  // (handle, avatar, Socials link) only when they are verified and the setting is on. Otherwise: dating name + photo only.
  let social = null;
  if (rules.showSocialToVerified && profile && profile.verified) {
    const u = await one(env, 'SELECT id, display_name, handle, avatar_url FROM users WHERE id = $1 AND NOT banned', [otherId]);
    if (u) social = { userId: u.id, displayName: u.display_name, handle: u.handle, avatarUrl: u.avatar_url || null };
  }
  return {
    conversationId: convId, status: dc.status, incomingRequest: dc.status === 'request' && dc.requester_id !== user.id, matchId: dc.match_id,
    otherUserId: otherId, profile, social, plan: ent.plan, allowance: dc.status === 'match' ? await messageAllowance(env, user, convId, ent) : null,
  };
}

// ─── rewarded-ad unlock (spec §6) ──────────────────────────────────────────────────────────────────────────────────
// Flow: POST start → { nonce, token, purpose: 'dating:<nonce>' } → the app shows a rewarded ad with that purpose as the
// AdMob SSV custom data → (a) AdMob calls /ads/ssv (routes/rewards.js dispatches 'dating:' to recordDatingAdSsv) and/or
// (b) the app posts the signed claim. One reward per nonce (single UPDATE issued → claimed), one per AdMob transaction id,
// at most rules.maxAdUnlocks per chat, nonce expiry, minimum watch time, per-member rate limits. With requireSsv (or
// env DATING_ADS_REQUIRE_SSV=true) a client claim alone never unlocks: only AdMob's signed callback does. PRODUCTION:
// enable SSV on the AdMob rewarded unit (callback https://<api>/ads/ssv) and set requireSsv.
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function adSecret(env) {
  return String(env.DATING_AD_SECRET || env.REALTIME_SECRET || env.ADMIN_PASSWORD || 'biblenestra-dating-ad-dev-secret');
}
export async function signAdNonce(env, nonce, userId, convId) {
  const key = await crypto.subtle.importKey('raw', enc.encode(adSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`dating-ad|${nonce}|${userId}|${convId}`)));
}
function sameString(a, b) {
  const x = String(a || ''); const y = String(b || '');
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
async function datingMatchConv(env, user, convId) {
  const dc = await one(env, 'SELECT * FROM dating_conversations WHERE conversation_id = $1', [convId]);
  if (!dc || (dc.user_a !== user.id && dc.user_b !== user.id)) throw notFound('Conversation not found');
  if (dc.status !== 'match') throw forbidden('This Find Love conversation is not open', 'DATING_CHAT_CLOSED');
  return dc;
}

export async function startAdUnlock(env, user, convId) {
  await datingMatchConv(env, user, convId);
  const ent = await planOf(env, user);
  if (unrestricted(ent)) throw new ApiError(409, 'NOT_NEEDED', 'Your plan has unlimited messaging — no ads needed');
  const { rules, prices } = await datingConfig(env);
  const a = await messageAllowance(env, user, convId, ent);
  if (a.adUnlocksLeft <= 0) {
    const err = new ApiError(409, 'AD_UNLOCKS_USED', `You've used the free unlocks for this chat. Unlock ${rules.messagesPerBundle} more messages for ${prices.message_bundle} Dating Coins.`);
    err.details = { allowance: a };
    throw err;
  }
  await rateLimit(env, `dating_ad_start:${user.id}`, 30, 3600);
  let row = await one(env, `SELECT nonce, expires_at FROM dating_ad_rewards WHERE user_id = $1 AND conversation_id = $2 AND status = 'issued' AND expires_at > now() + interval '2 minutes' ORDER BY issued_at DESC LIMIT 1`, [user.id, convId]);
  if (!row) {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    row = await one(env, `INSERT INTO dating_ad_rewards (nonce, user_id, conversation_id, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4::int)) RETURNING nonce, expires_at`, [nonce, user.id, convId, rules.adNonceMinutes]);
  }
  return { nonce: row.nonce, token: await signAdNonce(env, row.nonce, user.id, convId), purpose: `dating:${row.nonce}`, expiresAt: iso(row.expires_at), minWatchSec: rules.adMinWatchSec, requireSsv: !!rules.requireSsv, messagesPerAd: rules.freeMessagesPerAd };
}

// One UPDATE: issued → claimed, only while this chat still has a free unlock left. → units granted or null.
async function applyAdReward(env, nonce, userId, convId, via, maxAds, units) {
  const r = await one(env, `UPDATE dating_ad_rewards SET status = 'claimed', claimed_at = now(), claimed_via = $3, units = $5
      WHERE nonce = $1 AND user_id = $2 AND status = 'issued' AND expires_at > now()
        AND (SELECT count(*) FROM dating_ad_rewards x WHERE x.conversation_id = $6 AND x.user_id = $2 AND x.status = 'claimed') < $4
      RETURNING units`, [nonce, userId, via, maxAds, units, convId]);
  return r ? Number(r.units) : null;
}

export async function claimAdUnlock(env, user, { nonce, token }) {
  const n = String(nonce || '');
  if (!/^[0-9a-f]{32}$/.test(n)) throw bad('Bad nonce', 'BAD_NONCE');
  const { rules } = await datingConfig(env);
  await rateLimit(env, `dating_ad_claim:${user.id}`, rules.adClaimsPerHour, 3600);
  const row = await one(env, 'SELECT * FROM dating_ad_rewards WHERE nonce = $1', [n]);
  if (!row || row.user_id !== user.id) throw notFound('Ad reward not found');
  if (!sameString(token, await signAdNonce(env, n, user.id, row.conversation_id))) throw forbidden('This ad reward could not be verified', 'BAD_AD_TOKEN');
  if (row.status === 'claimed') {
    if (row.claimed_via === 'ssv') return { applied: false, verifiedBy: 'ssv', allowance: await messageAllowance(env, user, row.conversation_id) };
    throw new ApiError(409, 'AD_ALREADY_CLAIMED', 'This ad reward was already used');
  }
  if (row.status !== 'issued') throw new ApiError(409, 'AD_ALREADY_CLAIMED', 'This ad reward is no longer valid');
  if (new Date(row.expires_at) <= new Date()) {
    await q(env, `UPDATE dating_ad_rewards SET status = 'expired' WHERE nonce = $1 AND status = 'issued'`, [n]);
    throw new ApiError(410, 'AD_EXPIRED', 'This ad expired — please watch another one');
  }
  if (Date.now() - new Date(row.issued_at).getTime() < rules.adMinWatchSec * 1000) throw bad('Please watch the whole ad', 'AD_TOO_SOON');
  if (rules.requireSsv && !row.verified) {
    const err = new ApiError(202, 'AD_PENDING_VERIFICATION', 'Waiting for the ad network to confirm the reward…');
    err.details = { pending: true };
    throw err;
  }
  await datingMatchConv(env, user, row.conversation_id);
  const units = await applyAdReward(env, n, user.id, row.conversation_id, 'client', rules.maxAdUnlocks, rules.freeMessagesPerAd);
  if (units == null) {
    const now = await one(env, 'SELECT status FROM dating_ad_rewards WHERE nonce = $1', [n]);
    if (now && now.status === 'claimed') throw new ApiError(409, 'AD_ALREADY_CLAIMED', 'This ad reward was already used');
    throw new ApiError(409, 'AD_UNLOCKS_USED', 'The free unlocks for this chat are used up');
  }
  return { applied: true, units, allowance: await messageAllowance(env, user, row.conversation_id) };
}

/** AdMob SSV callback for custom_data 'dating:<nonce>' (called from routes/rewards.js). Never throws on bad input. */
export async function recordDatingAdSsv(env, { userId, customData, transactionId }) {
  const nonce = String(customData || '').slice('dating:'.length);
  if (!/^[0-9a-f]{32}$/.test(nonce) || !transactionId) return { ignored: true };
  const { rules } = await datingConfig(env);
  try {
    const upd = await one(env, `UPDATE dating_ad_rewards SET verified = true, transaction_id = $3 WHERE nonce = $1 AND user_id = $2 AND transaction_id IS NULL RETURNING conversation_id, status`, [nonce, userId, String(transactionId).slice(0, 200)]);
    if (!upd) return { ignored: true };
    if (upd.status !== 'issued') return { verified: true, applied: false };
    const dc = await one(env, `SELECT status FROM dating_conversations WHERE conversation_id = $1`, [upd.conversation_id]);
    if (!dc || dc.status !== 'match') return { verified: true, applied: false };
    const units = await applyAdReward(env, nonce, userId, upd.conversation_id, 'ssv', rules.maxAdUnlocks, rules.freeMessagesPerAd);
    return { verified: true, applied: units != null };
  } catch (e) {
    if (/unique|duplicate/i.test(String(e.message))) return { ignored: true, duplicateTransaction: true }; // replayed transaction id
    throw e;
  }
}

/** Coins: 5 more messages in one dating chat (20 coins). Allowed any time (e.g. when no ad is available). */
export async function buyMessageBundle(c, user, convId, idempotencyKey) {
  const key = needKey(idempotencyKey);
  await datingMatchConv(c.env, user, convId);
  const ent = await planOf(c.env, user);
  if (unrestricted(ent)) throw new ApiError(409, 'NOT_NEEDED', 'Your plan has unlimited messaging');
  const { prices, rules } = await datingConfig(c.env);
  const r = await paidUse(c, user, { ref: `message_bundle:${convId}:${user.id}:${key}`, kind: 'message_bundle', amount: prices.message_bundle, units: rules.messagesPerBundle, convId });
  return { ...r, allowance: await messageAllowance(c.env, user, convId, ent) };
}

// ─── boosts & spotlight (spec §7) ──────────────────────────────────────────────────────────────────────────────────
/** Active / queued boosts + live stats (views, likes, matches during the boost window). */
export async function boostStatus(env, user) {
  const rows = await q(env, `SELECT b.*,
      (SELECT count(*)::int FROM dating_views v WHERE v.target_id = b.user_id AND v.last_seen_at >= b.starts_at AND v.last_seen_at < LEAST(b.ends_at, now())) AS views,
      (SELECT count(*)::int FROM dating_swipes s WHERE s.target_id = b.user_id AND s.action <> 'pass' AND s.created_at >= b.starts_at AND s.created_at < LEAST(b.ends_at, now())) AS likes,
      (SELECT count(*)::int FROM dating_matches m WHERE (m.user_a = b.user_id OR m.user_b = b.user_id) AND m.created_at >= b.starts_at AND m.created_at < LEAST(b.ends_at, now())) AS matches
    FROM dating_boosts b WHERE b.user_id = $1 AND b.ends_at > now() - interval '1 day' ORDER BY b.starts_at DESC LIMIT 10`, [user.id]);
  const now = Date.now();
  const shape = (b) => ({
    id: b.id, kind: b.kind, label: COIN_KINDS[b.kind], paidWith: b.paid_with, startsAt: iso(b.starts_at), endsAt: iso(b.ends_at),
    state: new Date(b.starts_at).getTime() > now ? 'queued' : new Date(b.ends_at).getTime() > now ? 'active' : 'ended',
    secondsLeft: Math.max(0, Math.round((new Date(b.ends_at).getTime() - now) / 1000)), stats: { views: b.views, likes: b.likes, matches: b.matches },
  });
  const all = rows.map(shape);
  return { active: all.find((b) => b.state === 'active' && b.kind !== 'spotlight_24h') || null, spotlight: all.find((b) => b.state === 'active' && b.kind === 'spotlight_24h') || null, recent: all };
}

/** Start a boost / Spotlight. boost_30m uses a free VIP boost first (wallet dating_boosts) unless useFreeBoost === false. */
export async function startBoost(c, user, { kind, idempotencyKey, useFreeBoost = true }) {
  const env = c.env;
  const key = needKey(idempotencyKey);
  if (!BOOSTS[kind]) throw bad(`kind must be one of ${Object.keys(BOOSTS).join(', ')}`, 'BAD_BOOST');
  await needProfile(env, user);
  const mine = await myProfile(env, user.id, { env, origin: '' });
  if (!mine.visible) throw new ApiError(409, 'PROFILE_NOT_VISIBLE', 'Add an approved photo before boosting — boosts only help visible profiles');
  const { prices } = await datingConfig(env);
  const free = kind === 'boost_30m' && useFreeBoost !== false && (await getBalance(env, user.id, 'dating_boosts')) > 0;
  const ref = free ? `boost_free:${user.id}:${key}` : `${kind}:${user.id}:${key}`;
  const mins = BOOSTS[kind];
  const spot = kind === 'spotlight_24h';
  const boostSql = `INSERT INTO dating_boosts (ref, user_id, kind, paid_with, amount, starts_at, ends_at)
      SELECT $1, $2, $3, $4, $5, s.st, s.st + make_interval(mins => $6::int) FROM (
        SELECT GREATEST(now(), COALESCE((SELECT max(ends_at) FROM dating_boosts WHERE user_id = $2 AND (kind = 'spotlight_24h') = $7), now())) AS st) s
      ON CONFLICT (ref) DO NOTHING`;
  const r = await paidUse(c, user, {
    ref, kind, wallet: free ? 'dating_boosts' : 'dating_coins', amount: free ? 1 : prices[kind], units: mins, ledgerKind: free ? 'boost_used' : kind,
    alsoRun: [[boostSql, [ref, user.id, kind, free ? 'dating_boosts' : 'dating_coins', free ? 1 : prices[kind], mins, spot]]],
  });
  return { ...r, usedFreeBoost: free, boost: await boostStatus(env, user) };
}

// ─── the Find Love home payload ────────────────────────────────────────────────────────────────────────────────────
export async function datingHome(env, user, ctx) {
  const profile = await myProfile(env, user.id, ctx);
  const ent = await planOf(env, user);
  const { prices, rules } = await datingConfig(env);
  const [coins, boosts] = await Promise.all([getBalance(env, user.id, 'dating_coins'), getBalance(env, user.id, 'dating_boosts')]);
  const out = {
    profile, plan: { plan: ent.plan, tier: ent.tier, flags: ent.flags || {}, badge: ent.badge, subscription: ent.subscription },
    balances: { dating_coins: coins, dating_boosts: boosts }, prices, rules: { dailySwipes: rules.dailySwipes, plusDailySwipes: rules.plusDailySwipes, extraSwipes: rules.extraSwipes, freeMessagesPerAd: rules.freeMessagesPerAd, maxAdUnlocks: rules.maxAdUnlocks, messagesPerBundle: rules.messagesPerBundle, likesUnlockHours: rules.likesUnlockHours, minAge: rules.minAge, maxPhotos: rules.maxPhotos, photoReview: rules.photoReview },
    options: { intentions: INTENTIONS, involvement: INVOLVEMENT, reportReasons: REPORT_REASONS, boosts: BOOSTS, idTypes: ID_TYPES },
  };
  if (profile) {
    const [sw, likes, bs, matches, requests] = await Promise.all([
      swipeAllowance(env, user, ent), likesReceived(env, user, ctx), boostStatus(env, user),
      one(env, `SELECT count(*)::int AS n FROM dating_matches WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, [user.id]),
      one(env, `SELECT count(*)::int AS n FROM dating_conversations WHERE (user_a = $1 OR user_b = $1) AND requester_id <> $1 AND status = 'request'`, [user.id]),
    ]);
    Object.assign(out, { swipes: sw, likes: { count: likes.count, unlocked: likes.unlocked, unlockedUntil: likes.unlockedUntil }, boost: bs, counts: { matches: matches.n, requests: requests.n } });
  }
  return out;
}

// ─── verified badge = live selfie + government ID (client answer Q25) ──────────────────────────────────────────────
// 1. start → a code (4 digits) and a hand gesture are shown on screen. 2. The member takes a live selfie holding the code
// written on paper while making the gesture, and photographs their ID. Both go to PRIVATE R2 keys kyc/<user>/<id>/…
// (never under img/, so /media never serves them; only GET /dating/verification/file/:kind for the member and the
// admin route can read them). 3. submit → an advisory Workers AI pre-check (datingAi.js) stores a confidence note.
// 4. An admin approves (→ dating_profiles.verified) or rejects; both images are deleted at once and the AI details are
// cleared, so only the outcome stays. Verification is NOT required to message (client answer Q25b).
export const ID_TYPES = { nin: 'National ID (NIN)', passport: 'International passport', drivers_licence: 'Driver’s licence', voters_card: 'Voter’s card', other: 'Other government ID' };
const KYC_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_KYC_BYTES = 10 * 1024 * 1024;
const randomDigits = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
const randomGesture = () => { const k = Object.keys(GESTURES); return k[crypto.getRandomValues(new Uint32Array(1))[0] % k.length]; };

/** The member's latest verification (no images, no AI note — those are for admins). */
export async function verificationShape(env, userId) {
  const v = await one(env, `SELECT * FROM dating_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
  if (!v) return null;
  const expired = v.status === 'draft' && new Date(v.expires_at) <= new Date();
  return {
    id: v.id, status: expired ? 'expired' : v.status, code: v.status === 'draft' ? v.code : null, gesture: v.gesture, gestureLabel: (GESTURES[v.gesture] || {}).label || v.gesture,
    expiresAt: iso(v.expires_at), hasSelfie: !!v.selfie_key, hasId: !!v.id_key, idType: v.id_type, submittedAt: iso(v.submitted_at), decidedAt: iso(v.decided_at),
    rejectReason: v.status === 'rejected' ? (v.reject_reason || null) : null,
    idCheckAvailable: dojahConfigured(env), // the app then offers the optional BVN / NIN field
    idCheck: v.dojah_id_type ? { idType: v.dojah_id_type, last4: v.dojah_id_last4 || null } : null, // never the result (that is for admins)
  };
}

/** Delete both private images of one verification (best effort on storage, always clears the keys). */
export async function dropVerificationFiles(env, id) {
  const v = await one(env, 'SELECT selfie_key, id_key FROM dating_verifications WHERE id = $1', [id]);
  if (!v) return;
  for (const k of [v.selfie_key, v.id_key]) {
    if (k && env.MEDIA) { try { await env.MEDIA.delete(k); } catch (e) { console.warn('kyc delete failed', k, e && e.message); } }
  }
  await q(env, `UPDATE dating_verifications SET selfie_key = NULL, id_key = NULL, files_deleted_at = COALESCE(files_deleted_at, now()), updated_at = now() WHERE id = $1`, [id]);
}

async function openDraft(env, userId) {
  const v = await one(env, `SELECT * FROM dating_verifications WHERE user_id = $1 AND status = 'draft'`, [userId]);
  if (v && new Date(v.expires_at) <= new Date()) {
    await q(env, `UPDATE dating_verifications SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'draft'`, [v.id]);
    await dropVerificationFiles(env, v.id);
    return null;
  }
  return v;
}

/** Start (or continue) a verification: → the code + gesture to show. */
export async function startVerification(env, user) {
  const p = await needProfile(env, user, { active: false });
  if (p.verified) throw new ApiError(409, 'ALREADY_VERIFIED', 'Your profile is already verified');
  if (await one(env, `SELECT 1 FROM dating_verifications WHERE user_id = $1 AND status = 'pending'`, [user.id])) throw new ApiError(409, 'VERIFICATION_PENDING', 'Your verification is with our team');
  if (!(await openDraft(env, user.id))) {
    await rateLimit(env, `dating_verify_start:${user.id}`, 6, 86400);
    const { rules } = await datingConfig(env);
    await q(env, `INSERT INTO dating_verifications (user_id, code, gesture, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4::int))
        ON CONFLICT DO NOTHING`, [user.id, randomDigits(), randomGesture(), rules.verificationMinutes]);
  }
  return verificationShape(env, user.id);
}

/** Store the selfie or the ID image of the open draft (raw image body). Replacing one deletes the old file. */
export async function uploadVerificationImage(env, user, { kind, contentType, bytes }) {
  if (!['selfie', 'id'].includes(kind)) throw bad('kind must be selfie or id', 'BAD_KIND');
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const ext = KYC_TYPES[type];
  if (!ext) throw bad('Upload a JPEG, PNG or WebP photo', 'BAD_IMAGE_TYPE');
  if (!bytes || !bytes.byteLength) throw bad('Empty upload');
  if (bytes.byteLength > MAX_KYC_BYTES) throw new ApiError(413, 'TOO_LARGE', 'Images must be under 10 MB');
  if (!env.MEDIA) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED', 'Media storage is not configured');
  await rateLimit(env, `dating_verify_upload:${user.id}`, 30, 3600);
  const v = await openDraft(env, user.id);
  if (!v) throw new ApiError(409, 'VERIFICATION_EXPIRED', 'Your code expired. Start again to get a new one.');
  const key = `kyc/${user.id}/${v.id}/${kind}_${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: 'private, no-store' } });
  const col = kind === 'selfie' ? 'selfie_key' : 'id_key';
  const old = v[col];
  const upd = await one(env, `UPDATE dating_verifications SET ${col} = $2, updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING id`, [v.id, key]);
  if (!upd) { try { await env.MEDIA.delete(key); } catch (e) { /* ignore */ } throw new ApiError(409, 'VERIFICATION_EXPIRED', 'Start again to get a new code.'); }
  if (old) { try { await env.MEDIA.delete(old); } catch (e) { /* best effort */ } }
  return verificationShape(env, user.id);
}

/**
 * Submit for review: needs both images and the ID type; runs the advisory AI pre-check. Optionally (when Dojah is
 * configured) the member adds a BVN or NIN: Dojah compares the live selfie with that ID's photo. Only the ID type, the
 * last 4 digits, the confidence and the match are stored. A Dojah match with an AI check that isn't negative is marked
 * "Dojah matched" (dojah_quick) for a quick admin decision — it is NEVER approved automatically.
 */
export async function submitVerification(env, user, { idType, dojahIdType = null, dojahIdNumber = null }) {
  const p = await needProfile(env, user, { active: false });
  if (!ID_TYPES[idType]) throw bad(`idType must be one of ${Object.keys(ID_TYPES).join(', ')}`, 'BAD_ID_TYPE');
  let dojahReq = null;
  const rawNum = String(dojahIdNumber || '').replace(/[\s-]+/g, '');
  if (rawNum && dojahConfigured(env)) {
    const t = String(dojahIdType || '').toLowerCase();
    if (!['bvn', 'nin'].includes(t)) throw bad('Choose BVN or NIN for the automatic ID check', 'BAD_ID_CHECK_TYPE');
    if (!/^[0-9]{11}$/.test(rawNum)) throw bad(`A ${t.toUpperCase()} is 11 digits`, 'BAD_ID_NUMBER');
    dojahReq = { idType: t, idNumber: rawNum };
  }
  const v = await openDraft(env, user.id);
  if (!v) throw new ApiError(409, 'VERIFICATION_EXPIRED', 'Your code expired. Start again to get a new one.');
  if (!v.selfie_key || !v.id_key) throw bad('Add your selfie and a photo of your ID first', 'VERIFICATION_INCOMPLETE');
  const sub = await one(env, `UPDATE dating_verifications SET status = 'pending', id_type = $2, submitted_at = now(), updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING id`, [v.id, idType]);
  if (!sub) return verificationShape(env, user.id);
  let pre;
  try {
    const main = await one(env, `SELECT url FROM dating_photos WHERE user_id = $1 AND status = 'approved' AND url LIKE 'img/%' ORDER BY position, created_at LIMIT 1`, [user.id]);
    const [selfie, idImg, profilePhoto] = await Promise.all([readObjectBytes(env, v.selfie_key), readObjectBytes(env, v.id_key), main ? readObjectBytes(env, main.url) : null]);
    pre = await verificationPrecheck(env, { selfie, id: idImg, profilePhoto, code: v.code, gesture: v.gesture,
      profile: { firstName: p.first_name, gender: p.gender, age: ageOn(p.birth_date), birthYear: ymd(p.birth_date).slice(0, 4) } });
  } catch (e) {
    pre = { status: 'unavailable', confidence: 'unknown', note: `AI pre-check failed (${String((e && e.message) || e).slice(0, 120)}). Review the images yourself.`, details: null };
  }
  await q(env, `UPDATE dating_verifications SET ai_status = $2, ai_confidence = $3, ai_note = $4, ai_details = $5::jsonb, updated_at = now() WHERE id = $1`,
    [v.id, pre.status, pre.confidence, String(pre.note || '').slice(0, 2000), pre.details ? JSON.stringify(pre.details) : null]);
  if (dojahReq) {
    const dj = await dojahSelfieCheck(env, v, dojahReq, pre);
    await q(env, `UPDATE dating_verifications SET dojah_id_type = $2, dojah_id_last4 = $3, dojah_status = $4, dojah_confidence = $5, dojah_match = $6,
        dojah_note = $7, dojah_quick = $8, updated_at = now() WHERE id = $1`,
      [v.id, dojahReq.idType, dojahReq.idNumber.slice(-4), dj.status, dj.confidence, dj.match, dj.note.slice(0, 300), dj.quick]);
  }
  return verificationShape(env, user.id);
}

/** The Dojah selfie match for one submitted verification → { status, match, confidence, note, quick }. Never throws. */
async function dojahSelfieCheck(env, v, { idType, idNumber }, pre) {
  const T = idType.toUpperCase();
  const th = Number((await getConfig(env)).dating_dojah_threshold) || DOJAH_THRESHOLD_DEFAULT;
  let r;
  try {
    const selfie = await readObjectBytes(env, v.selfie_key);
    if (!selfie) throw Object.assign(new Error('selfie not readable'), { code: 'SELFIE_MISSING' });
    r = await verifySelfie(env, { idType, idNumber, selfie, threshold: th });
  } catch (e) {
    return { status: 'error', match: null, confidence: null, quick: false, note: `Dojah ${T} check failed (${String((e && e.code) || 'error').slice(0, 40)}). Review the images yourself.` };
  }
  const conf = r.confidence == null ? 'n/a' : String(r.confidence);
  const aiNegative = pre && pre.status === 'done' && pre.confidence === 'low';
  const quick = r.match === true && !aiNegative;
  const note = r.match
    ? `Dojah: the selfie matches the ${T} photo (confidence ${conf}, threshold ${th}).${aiNegative ? ' The AI pre-check was negative, so it is not marked for quick approval.' : ''}`
    : `Dojah: the selfie does NOT match the ${T} photo (confidence ${conf}, threshold ${th}).`;
  return { status: r.match ? 'matched' : 'no_match', match: r.match, confidence: r.confidence, note, quick };
}

/** A private verification image (R2 object) — the caller has already checked who may see it. */
export async function verificationObject(env, v, kind) {
  const key = kind === 'selfie' ? v.selfie_key : kind === 'id' ? v.id_key : null;
  if (!key || !env.MEDIA) return null;
  return env.MEDIA.get(key);
}

/** Admin decision: approve → Verified badge; reject → reason shown to the member. Both images are deleted now. */
export async function decideVerification(c, admin, id, { decision, reason }) {
  const env = c.env;
  if (!['approve', 'reject'].includes(decision)) throw bad('decision must be approve or reject', 'BAD_DECISION');
  const why = clean(reason, 300);
  if (decision === 'reject' && why.length < 3) throw bad('Give the member a short reason', 'REASON_REQUIRED');
  const v = await one(env, `UPDATE dating_verifications SET status = $2, decided_at = now(), decided_by = $3, reject_reason = $4, ai_details = NULL, updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`, [id, decision === 'approve' ? 'approved' : 'rejected', admin.id, decision === 'reject' ? why : null]);
  if (!v) {
    const cur = await one(env, 'SELECT status FROM dating_verifications WHERE id = $1', [id]);
    if (!cur) throw notFound('Verification not found');
    throw new ApiError(409, 'ALREADY_DECIDED', `This verification is already ${cur.status}`);
  }
  if (decision === 'approve') await q(env, `UPDATE dating_profiles SET verified = true, updated_at = now() WHERE user_id = $1`, [v.user_id]);
  await dropVerificationFiles(env, v.id);
  await tell(c, v.user_id, decision === 'approve'
    ? { title: 'You’re verified ✔', body: 'Your Find Love profile now shows the Verified badge.', data: { event: 'verified' } }
    : { title: 'Verification not approved', body: why || 'Please try again with clear photos.', data: { event: 'verification_rejected' } });
  return { id: v.id, status: v.status, userId: v.user_id };
}

// ─── retention cron (client answer Q32) — called from the 15-minute cron in src/index.js ─────────────────────────
// * Messages of closed / declined dating chats are deleted rules.chatRetentionDays (default 730) after closed_at, at most
//   rules.retentionBatch messages per run (with their chat attachments in R2). The dating_conversations row stays, and
//   dating_reports + admin_actions (the safety log) are never touched: they are kept forever.
// * Unfinished verification drafts past their expiry lose their images.
export async function runDatingCron(env) {
  const { rules } = await datingConfig(env);
  const out = { messagesDeleted: 0, chatsPurged: 0, draftsExpired: 0 };
  const days = Number(rules.chatRetentionDays) || 0;
  if (days > 0) {
    const convs = (await q(env, `SELECT conversation_id FROM dating_conversations
        WHERE status IN ('closed','declined') AND messages_purged_at IS NULL AND closed_at IS NOT NULL AND closed_at < now() - make_interval(days => $1::int)
        ORDER BY closed_at LIMIT 20`, [days])).map((r) => r.conversation_id);
    if (convs.length) {
      const gone = await q(env, `DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE conversation_id = ANY($1::uuid[]) ORDER BY created_at LIMIT $2)
          RETURNING conversation_id, media_key`, [convs, Math.max(1, Number(rules.retentionBatch) || 200)]);
      out.messagesDeleted = gone.length;
      for (const m of gone) {
        if (m.media_key && env.MEDIA && String(m.media_key).startsWith(`chat/${m.conversation_id}/`)) {
          try { await env.MEDIA.delete(m.media_key); } catch (e) { /* best effort */ }
        }
      }
      const done = await q(env, `UPDATE dating_conversations dc SET messages_purged_at = now() WHERE dc.conversation_id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = dc.conversation_id) RETURNING conversation_id`, [convs]);
      out.chatsPurged = done.length;
    }
  }
  const drafts = await q(env, `UPDATE dating_verifications SET status = 'expired', updated_at = now() WHERE id IN (
      SELECT id FROM dating_verifications WHERE status = 'draft' AND expires_at < now() ORDER BY expires_at LIMIT 50) RETURNING id`);
  for (const d of drafts) await dropVerificationFiles(env, d.id);
  out.draftsExpired = drafts.length;
  return out;
}
