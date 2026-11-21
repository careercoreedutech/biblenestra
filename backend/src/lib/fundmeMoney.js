// FUND ME MONEY (monetisation stage 2 — client spec §1 credits, §2 gifting credits, §3 donations and payouts, §15E ledger,
// §16 admin, §17 security). Built on the wallet core (lib/wallet.js; contract scratch/monetisation/wallet-core.md).
// Docs: scratch/monetisation/fundme.md
//
// ─── Request credits ───────────────────────────────────────────────────────────────────────────────────────────────
// A request is "successfully published" when an admin approves it and it goes live for the first time. That is the
// moment the credit is spent: spend(fundme_credits, ref fundme_publish:<id>) with the status change in alsoRun, guarded
// so the whole transaction rolls back if the request isn't pending any more. Rejected or failed publishes never cost a
// credit. Submitting needs enough credits (balance minus credits reserved by my other requests waiting for review).
//
// ─── Donations ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Paid to BibleNestra's Paystack account (never to the beneficiary). Status (donations.settlement_status):
//   pending              checkout started, nothing received
//   processing           gateway confirmed (server-side verify) → ledger donation:<id> (held for the beneficiary); being checked
//   under_review         flagged by the anti-fraud checks or an admin (money held, can't be paid out)
//   verified             BibleNestra checked it (admin, or automatically when fundme_auto_verify is on and nothing was flagged)
//   approved_for_payout  admin approved it after the hold period
//   paid                 included in a payout marked paid (ledger payout:<id>: held → paid)
//   failed               the payment never completed
//   refunded             money returned to the donor (ledger donation_refund:<id>)
// Every change writes fundme_donation_events (who / when / why). Admin actions are also in admin_actions.
import { q, one, tx } from './db.js';
import { ApiError, bad } from './http.js';
import {
  spend, transfer, getBalance, getConfig, registerConfig, CONFIG_DEFAULTS, recordDonationReceived, recordPayoutPaid,
  recordDonationRefunded, walletNotify,
} from './wallet.js';
import { paystackConfigured, verifyTransaction, listBanks, resolveAccount, createTransferRecipient, initiateTransfer, refundTransaction } from './paystack.js';
import { formatMoney } from './money.js';
import { isOn } from './play.js';
import { testPurchaseAllowed } from './walletStore.js';
import { TestProvider, PaystackProvider } from './payments.js';

export const MONEY_CURRENCIES = ['NGN', 'GBP', 'USD', 'EUR'];

// ─── admin-editable rules (Admin › Wallets & payments › Donations & payouts › Rules, and Settings) ───────────────
const pint = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const perCur = (max) => (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).every((k) => MONEY_CURRENCIES.includes(k)) && Object.values(v).every((n) => Number.isInteger(n) && n >= 0 && n <= max);
export const FUNDME_RULES = {
  fundme_max_requests_per_day: { dflt: 2, check: pint(0, 100), label: 'Requests a member can submit per day (0 = no limit)' },
  fundme_max_requests_per_month: { dflt: 10, check: pint(0, 1000), label: 'Requests a member can submit per 30 days (0 = no limit)' },
  fundme_max_active_requests: { dflt: 3, check: pint(0, 1000), label: 'Active requests per member: in review, live or paused (0 = no limit)' },
  fundme_new_account_days: { dflt: 7, check: pint(0, 365), label: 'Accounts younger than this are flagged for review' },
  fundme_review_goal_over_minor: { dflt: { NGN: 1000000000, GBP: 2000000, USD: 2000000, EUR: 2000000 }, check: perCur(1e14), label: 'Goals at or above this are flagged (minor units: kobo, pence, cents)' },
  fundme_review_donation_over_minor: { dflt: { NGN: 50000000, GBP: 100000, USD: 100000, EUR: 100000 }, check: perCur(1e14), label: 'Single donations at or above this go under review (minor units)' },
  fundme_auto_verify: { dflt: false, check: (v) => typeof v === 'boolean', label: 'Verify donations automatically when no check flagged them (off = an admin verifies each one)' },
  fundme_payout_hold_days: { dflt: 3, check: pint(0, 365), label: 'Days a received donation is held before it can be approved for payout. PROPOSAL, client to confirm' },
  fundme_min_payout_minor: { dflt: { NGN: 100000, GBP: 1000, USD: 1000, EUR: 1000 }, check: perCur(1e14), label: 'Minimum payout (minor units). PROPOSAL, client to confirm' },
  fundme_fee_bps: { dflt: 0, check: pint(0, 3000), label: 'BibleNestra fee on each donation, in basis points (100 = 1%). Default 0, client to confirm' },
  fundme_fee_fixed_minor: { dflt: { NGN: 0, GBP: 0, USD: 0, EUR: 0 }, check: perCur(1e9), label: 'Fixed BibleNestra fee per donation (minor units). Default 0, client to confirm' },
  fundme_credit_gift_max: { dflt: 100, check: pint(1, 100000), label: 'Most Fund Me credits one gift can send' },
};
for (const [k, r] of Object.entries(FUNDME_RULES)) registerConfig(k, r.dflt, r.check);

/** Per-currency config value (falls back to the default when the stored object lacks that currency). */
export function curVal(cfg, key, currency) {
  const v = cfg[key] && typeof cfg[key] === 'object' ? cfg[key][currency] : undefined;
  if (Number.isInteger(v)) return v;
  const d = CONFIG_DEFAULTS[key] && CONFIG_DEFAULTS[key][currency];
  return Number.isInteger(d) ? d : 0;
}

/** BibleNestra's fee on one donation: floor(amount × bps / 10000) + fixed. */
export function donationFee(cfg, amountMinor, currency) {
  const bps = Number(cfg.fundme_fee_bps) || 0;
  return Math.floor((Number(amountMinor) * bps) / 10000) + curVal(cfg, 'fundme_fee_fixed_minor', currency);
}

// ─── statuses ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const DONATION_STATUSES = ['pending', 'processing', 'verified', 'approved_for_payout', 'paid', 'failed', 'refunded', 'under_review'];
export const DONATION_LABEL = {
  pending: 'Waiting for payment', processing: 'Received — being checked', verified: 'Verified', approved_for_payout: 'Approved for payout',
  paid: 'Paid out', failed: 'Failed', refunded: 'Refunded', under_review: 'Under review',
};
// Admin actions on one donation. received = the gateway confirmed the money (ledger donation:<id> exists).
export const DONATION_ACTIONS = {
  verify: { from: ['processing', 'under_review'], to: 'verified', received: true, label: 'Verify' },
  approve: { from: ['verified'], to: 'approved_for_payout', received: true, label: 'Approve for payout' },
  unapprove: { from: ['approved_for_payout'], to: 'verified', noPayout: true, label: 'Back to verified' },
  review: { from: ['pending', 'processing', 'verified', 'approved_for_payout'], to: 'under_review', noPayout: true, reason: true, label: 'Put under review' },
  fail: { from: ['pending', 'under_review'], to: 'failed', received: false, reason: true, label: 'Mark failed' },
  refund: { from: ['processing', 'verified', 'under_review', 'approved_for_payout'], to: 'refunded', received: true, noPayout: true, reason: true, label: 'Refund' },
  recheck: { from: ['pending', 'processing', 'under_review'], to: null, label: 'Re-check with Paystack' },
};
/** Can `action` run on a donation in `status`? (pure; used by the routes and the tests) */
export function canDonationAction(action, d) {
  const a = DONATION_ACTIONS[action];
  if (!a) return { ok: false, why: 'Unknown action' };
  if (!a.from.includes(d.settlement_status)) return { ok: false, why: `Can’t ${a.label.toLowerCase()} a donation that is ${DONATION_LABEL[d.settlement_status] || d.settlement_status}` };
  if (a.received === true && !d.received_at) return { ok: false, why: 'The payment hasn’t been received from the gateway yet' };
  if (a.received === false && d.received_at) return { ok: false, why: 'This payment was received — refund it instead' };
  if (a.noPayout && d.payout_id) return { ok: false, why: 'This donation is inside a payout — fail or finish the payout first' };
  return { ok: true };
}
export const PAYOUT_LABEL = { requested: 'Requested', under_review: 'Under review', approved: 'Approved — ready to pay', processing: 'Sending', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled' };

// "Guard" statement for alsoRun: makes the WHOLE transaction (ledger included) roll back with division_by_zero when the
// business row is no longer in the expected state. Callers map that to 409 STATE_CHANGED.
const isGuard = (e) => e && (e.code === '22012' || /division by zero/i.test(String(e.message || '')));
const stateChanged = (msg = 'This was changed by someone else — reload and try again') => new ApiError(409, 'STATE_CHANGED', msg);

const ev = (donationSql) => `INSERT INTO fundme_donation_events (donation_id, from_status, to_status, actor, actor_id, reason, meta) ${donationSql}`;

// ─── credits (spec §1, §2) ────────────────────────────────────────────────────────────────────────────────────────
/** Credits view for the app: balance, publish cost, reserved by requests in review, limits and my usage. */
export async function creditSummary(env, userId) {
  const cfg = await getConfig(env);
  const balance = await getBalance(env, userId, 'fundme_credits');
  const u = await one(env, `SELECT
      COUNT(*) FILTER (WHERE status = 'pending_review')::int AS in_review,
      COUNT(*) FILTER (WHERE status IN ('pending_review','live','paused'))::int AS active,
      COUNT(*) FILTER (WHERE first_submitted_at > now() - interval '1 day')::int AS today,
      COUNT(*) FILTER (WHERE first_submitted_at > now() - interval '30 days')::int AS month
    FROM fundraisers WHERE owner_id = $1`, [userId]);
  const cost = Number(cfg.fundme_publish_credits) || 0;
  const reserved = cost * u.in_review;
  return {
    wallet: 'fundme_credits', balance, cost, reserved, available: Math.max(0, balance - reserved),
    limits: { perDay: cfg.fundme_max_requests_per_day, perMonth: cfg.fundme_max_requests_per_month, maxActive: cfg.fundme_max_active_requests },
    usage: { today: u.today, month: u.month, active: u.active, inReview: u.in_review },
    giftMax: cfg.fundme_credit_gift_max,
    explain: cost
      ? `Publishing a Fund Me request uses ${cost} credit${cost === 1 ? '' : 's'}. It is only used when our team approves your request and it goes live — if it isn’t approved, nothing is used.`
      : 'Publishing a Fund Me request is free right now.',
  };
}

/** Throws when a member may not submit (limits, credits). `excludeId` = the request being submitted. */
export async function assertCanSubmit(env, userId, excludeId) {
  const cfg = await getConfig(env);
  const r = await one(env, `SELECT
      COUNT(*) FILTER (WHERE status IN ('pending_review','live','paused') AND id <> $2)::int AS active,
      COUNT(*) FILTER (WHERE status = 'pending_review' AND id <> $2)::int AS in_review,
      COUNT(*) FILTER (WHERE first_submitted_at > now() - interval '1 day' AND id <> $2)::int AS today,
      COUNT(*) FILTER (WHERE first_submitted_at > now() - interval '30 days' AND id <> $2)::int AS month,
      (SELECT first_submitted_at FROM fundraisers WHERE id = $2) AS mine_first
    FROM fundraisers WHERE owner_id = $1`, [userId, excludeId]);
  const counted = !r.mine_first; // a resubmission after "needs changes" isn't a new request
  if (cfg.fundme_max_active_requests && r.active >= cfg.fundme_max_active_requests) {
    throw new ApiError(409, 'LIMIT_ACTIVE', `You can have up to ${cfg.fundme_max_active_requests} active Fund Me requests. Close one before submitting another.`);
  }
  if (counted && cfg.fundme_max_requests_per_day && r.today >= cfg.fundme_max_requests_per_day) {
    throw new ApiError(429, 'LIMIT_DAY', `You can submit up to ${cfg.fundme_max_requests_per_day} Fund Me request${cfg.fundme_max_requests_per_day === 1 ? '' : 's'} a day. Please try again tomorrow.`);
  }
  if (counted && cfg.fundme_max_requests_per_month && r.month >= cfg.fundme_max_requests_per_month) {
    throw new ApiError(429, 'LIMIT_MONTH', `You can submit up to ${cfg.fundme_max_requests_per_month} Fund Me requests in 30 days.`);
  }
  const cost = Number(cfg.fundme_publish_credits) || 0;
  if (cost > 0) {
    const balance = await getBalance(env, userId, 'fundme_credits');
    const free = balance - cost * r.in_review;
    if (free < cost) {
      const e = new ApiError(402, 'INSUFFICIENT_BALANCE', r.in_review
        ? `You need ${cost} free Fund Me credit${cost === 1 ? '' : 's'} to submit. ${cost * r.in_review} of your ${balance} are set aside for requests already in review.`
        : `You need ${cost} Fund Me credit${cost === 1 ? '' : 's'} to submit this request. Buy credits or ask a friend to send you some.`);
      e.details = { wallet: 'fundme_credits', balance, reserved: cost * r.in_review, needed: cost, shortBy: cost - Math.max(0, free) };
      throw e;
    }
  }
  return { cost };
}

// ─── anti-fraud (requests) ────────────────────────────────────────────────────────────────────────────────────────
async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
const storyText = (f) => {
  const story = typeof f.story === 'string' ? JSON.parse(f.story) : (f.story || []);
  return story.filter((b) => b.type === 'p').map((b) => b.text).join(' ');
};
export const normText = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const flag = (code, label, detail) => ({ code, label, detail: detail || null });

async function imageHashes(env, f) {
  const story = typeof f.story === 'string' ? JSON.parse(f.story) : (f.story || []);
  const media = await q(env, `SELECT r2_key FROM fundraiser_media WHERE fundraiser_id = $1 AND kind = 'image'`, [f.id]);
  const keys = [...new Set([f.main_image_key, ...story.filter((b) => b.type === 'img').map((b) => b.key), ...media.map((m) => m.r2_key)].filter(Boolean))];
  const out = [];
  if (!env.MEDIA || typeof env.MEDIA.head !== 'function') return out;
  for (const k of keys.slice(0, 20)) {
    try {
      const h = await env.MEDIA.head(k);
      const tag = h && (h.etag || h.httpEtag);
      if (tag) out.push(`${String(tag).replace(/"/g, '')}:${h.size || 0}`);
    } catch (e) { /* storage hiccup: skip this image */ }
  }
  return [...new Set(out)];
}

/** Checks run when a request is submitted. They FLAG (shown first in the moderation queue); they never reject. */
export async function requestRiskFlags(env, f) {
  const cfg = await getConfig(env);
  const flags = [];
  const owner = await one(env, `SELECT created_at,
      (SELECT COUNT(*)::int FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id AND r.created_at > now() - interval '180 days') AS reports,
      (SELECT COUNT(*)::int FROM fundraisers x WHERE x.owner_id = u.id AND x.status = 'rejected') AS rejected
    FROM users u WHERE u.id = $1`, [f.owner_id]);
  const ageDays = owner ? (Date.now() - new Date(owner.created_at).getTime()) / 86400000 : 0;
  if (cfg.fundme_new_account_days && ageDays < cfg.fundme_new_account_days) flags.push(flag('new_account', 'New account', `Joined ${Math.max(0, Math.floor(ageDays))} day(s) ago`));
  if (owner && owner.reports > 0) flags.push(flag('reported_user', 'Member has been reported', `${owner.reports} report(s) in 180 days`));
  if (owner && owner.rejected >= 2) flags.push(flag('rejected_before', 'Several rejected requests', `${owner.rejected} rejected`));
  const textHash = await sha256Hex(normText(`${f.title} ${storyText(f)}`));
  const dupText = await one(env, `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE owner_id <> $3)::int AS others FROM fundraisers WHERE text_hash = $1 AND id <> $2`, [textHash, f.id, f.owner_id]);
  if (dupText.n) flags.push(flag('duplicate_text', 'Same text as another request', dupText.others ? `${dupText.others} by other members` : `${dupText.n} of their own`));
  const hashes = await imageHashes(env, f);
  if (hashes.length) {
    const dupImg = await one(env, `SELECT COUNT(*)::int AS n FROM fundraisers WHERE id <> $1 AND owner_id <> $2 AND image_hashes && $3::text[]`, [f.id, f.owner_id, hashes]);
    if (dupImg.n) flags.push(flag('duplicate_image', 'Photo used in another member’s request', `${dupImg.n} request(s)`));
  }
  const recent = await one(env, `SELECT COUNT(*)::int AS n FROM fundraisers WHERE owner_id = $1 AND id <> $2 AND first_submitted_at > now() - interval '30 days'`, [f.owner_id, f.id]);
  if (recent.n >= 3) flags.push(flag('many_requests', 'Many requests recently', `${recent.n + 1} in 30 days`));
  if (Number(f.goal_minor) >= curVal(cfg, 'fundme_review_goal_over_minor', f.currency)) flags.push(flag('large_goal', 'Very large goal', formatMoney(f.goal_minor, f.currency)));
  return { flags, textHash, hashes };
}

// ─── publish (spend one credit, atomically with going live) ──────────────────────────────────────────────────────
/**
 * First approval of a request: pending_review → live AND spend the publish credit, in ONE transaction.
 * Throws 402 INSUFFICIENT_BALANCE (nothing published, nothing spent) or 409 STATE_CHANGED (not pending any more → the
 * credit spend is rolled back too). A second call for the same request can never spend twice (ref fundme_publish:<id>).
 */
export async function publishFundraiser(env, f, adminId) {
  const cfg = await getConfig(env);
  const cost = Number(cfg.fundme_publish_credits) || 0;
  const ref = `fundme_publish:${f.id}`;
  const update = [`WITH u AS (
      UPDATE fundraisers SET status = 'live', approved_at = now(), reviewed_at = now(), reviewed_by = $2, paused_by = NULL,
             reject_reason = NULL, publish_ref = $3, updated_at = now()
       WHERE id = $1 AND status = 'pending_review' AND approved_at IS NULL RETURNING id)
    SELECT 1 / (SELECT COUNT(*)::int FROM u) AS ok`, [f.id, adminId, cost > 0 ? ref : null]];
  try {
    if (cost > 0) {
      await spend(env, {
        ref, userId: f.owner_id, wallet: 'fundme_credits', amount: cost, kind: 'fundme_publish', actorId: adminId,
        relatedType: 'fundraiser', relatedId: f.id, meta: { title: String(f.title).slice(0, 120) }, alsoRun: [update],
      });
    } else {
      await tx(env, [update]);
    }
  } catch (e) {
    if (isGuard(e)) throw stateChanged('This request isn’t waiting for review any more — nothing was published or charged');
    throw e;
  }
  return { cost };
}

/** Gift Fund Me credits to another member (spec §2). Credits only — this is not, and can't become, a cash transfer. */
export async function giftCredits(c, me, { recipientId, amount, idempotencyKey, note }) {
  const env = c.env;
  const cfg = await getConfig(env);
  if (!Number.isInteger(amount) || amount < 1) throw bad('Choose how many credits to send', 'BAD_AMOUNT');
  if (amount > cfg.fundme_credit_gift_max) throw bad(`You can send up to ${cfg.fundme_credit_gift_max} credits at a time`, 'BAD_AMOUNT');
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_.-]{8,80}$/.test(idempotencyKey)) throw bad('idempotencyKey is required', 'BAD_REF');
  if (String(recipientId).toLowerCase() === String(me.id).toLowerCase()) throw bad('You can’t send credits to yourself', 'SELF_TRANSFER');
  const to = await one(env, 'SELECT id, display_name, handle, banned FROM users WHERE id = $1', [recipientId]);
  if (!to || to.banned) throw new ApiError(404, 'UNKNOWN_USER', 'We couldn’t find that member');
  const ref = `fmgift:${me.id}:${idempotencyKey}`;
  const r = await transfer(env, {
    ref, fromId: me.id, toId: to.id, wallet: 'fundme_credits', amount, kindOut: 'fundme_credit_gift_sent', kindIn: 'fundme_credit_gift_received',
    relatedType: 'fundme_credit_gift', relatedId: idempotencyKey, meta: note ? { note: String(note).slice(0, 140) } : {},
  });
  if (r.applied) {
    const n = `${amount} Fund Me credit${amount === 1 ? '' : 's'}`;
    await walletNotify(c, { userId: to.id, title: 'You received Fund Me credits', body: `${me.display_name || 'A friend'} sent you ${n}${note ? `: “${String(note).slice(0, 80)}”` : ''}`, data: { wallet: 'fundme_credits', screen: 'FundMeCredits' }, kind: 'fundme_credits' });
    await walletNotify(c, { userId: me.id, title: 'Credits sent', body: `You sent ${n} to ${to.display_name || 'a member'}`, data: { wallet: 'fundme_credits', screen: 'FundMeCredits' }, kind: 'fundme_credits' });
  }
  const sent = r.entries.find((e) => e.amount < 0);
  return { applied: r.applied, duplicate: !!r.duplicate, ref, amount, recipient: { id: to.id, displayName: to.display_name, handle: to.handle }, balance: await getBalance(env, me.id, 'fundme_credits'), balanceAfter: sent ? sent.balanceAfter : null };
}

// ─── providers ────────────────────────────────────────────────────────────────────────────────────────────────────
export const DONATIONS_OFF = 'Donations aren’t switched on yet';
export const paystackCurrencies = (env) => String(env.PAYSTACK_CURRENCIES || 'NGN').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
export const testDonationsAllowed = (env, user) => testPurchaseAllowed(env, user);

/** Which provider a new donation uses (see lib/payments.js header). null = donations are off. */
export function pickProvider(env, user, requested) {
  if (requested === 'test') {
    if (testDonationsAllowed(env, user) || String(env.PAYMENTS_MODE || '').toLowerCase() === 'test') return TestProvider;
    throw new ApiError(403, 'TEST_DONATIONS_DISABLED', 'Test donations are only for admins and testers');
  }
  if (paystackConfigured(env)) return PaystackProvider;
  if (String(env.PAYMENTS_MODE || '').trim().toLowerCase() === 'test') return TestProvider;
  return null;
}

// ─── donation received (gateway confirmed) ───────────────────────────────────────────────────────────────────────
async function donationRiskFlags(env, cfg, d, beneficiaryId, amount, mismatch) {
  const flags = [];
  if (mismatch) flags.push(flag('amount_mismatch', 'Paid amount differs from the checkout', `${formatMoney(d.amount_minor, d.currency)} expected, ${formatMoney(amount, d.currency)} paid`));
  if (amount >= curVal(cfg, 'fundme_review_donation_over_minor', d.currency)) flags.push(flag('large_amount', 'Large donation', formatMoney(amount, d.currency)));
  if (d.donor_id && beneficiaryId && String(d.donor_id) === String(beneficiaryId)) flags.push(flag('self_donation', 'Donor is the beneficiary'));
  const rapid = await one(env, `SELECT COUNT(*)::int AS n FROM donations WHERE rl_key = $1 AND received_at > now() - interval '1 hour' AND id <> $2`, [d.rl_key || '-', d.id]);
  if (rapid.n >= 5) flags.push(flag('rapid_donor', 'Many donations from the same donor in an hour', `${rapid.n + 1} in 1 hour`));
  const fr = await one(env, `SELECT status, paused_by, risk_flags FROM fundraisers WHERE id = $1`, [d.fundraiser_id]);
  if (fr && fr.paused_by === 'admin') flags.push(flag('request_paused', 'Request was paused by moderators'));
  const rep = beneficiaryId ? await one(env, `SELECT COUNT(*)::int AS n FROM reports WHERE target_type = 'user' AND target_id = $1 AND created_at > now() - interval '90 days'`, [beneficiaryId]) : { n: 0 };
  if (rep.n >= 2) flags.push(flag('reported_beneficiary', 'Beneficiary reported several times', `${rep.n} reports in 90 days`));
  return flags;
}

const receiptNo = (d) => `BNF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(d.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`;

/**
 * The gateway confirmed a payment (Paystack verify API / test provider). Records the money as held for the beneficiary
 * (ledger donation:<id>) and moves the donation to processing / verified / under_review in ONE transaction.
 * Idempotent: a second confirmation (duplicate webhook, poll + webhook race) changes nothing. Amounts come from the
 * gateway, never from the client.
 */
export async function confirmDonation(c, d, { amountMinor, currency, actor = 'system', gateway = {} }) {
  const env = c.env;
  if (!d || d.status !== 'pending') return { changed: false, status: d ? d.settlement_status : null };
  const f = await one(env, 'SELECT id, owner_id, title, slug, currency FROM fundraisers WHERE id = $1', [d.fundraiser_id]);
  const beneficiaryId = d.beneficiary_id || (f && f.owner_id);
  const cfg = await getConfig(env);
  const amount = Number(amountMinor);
  const evActor = actor === 'paystack' || actor === 'test' ? actor : 'system';
  if (String(currency || '').toUpperCase() !== d.currency || !(amount > 0)) {
    // Money arrived in a currency we didn't ask for: hold it for an admin, don't record anything automatically.
    const flags = [flag('currency_mismatch', 'Paid in an unexpected currency', `${currency} ${amount}`)];
    const r = await q(env, `WITH u AS (UPDATE donations SET settlement_status = 'under_review', risk_flags = $2::jsonb, gateway = $3::jsonb
        WHERE id = $1 AND status = 'pending' AND settlement_status IN ('pending','processing') RETURNING id, $4::text AS frm)
      ${ev(`SELECT id, frm, 'under_review', $5, NULL, 'Paid in an unexpected currency', '{}'::jsonb FROM u`)} RETURNING donation_id`,
    [d.id, JSON.stringify(flags), JSON.stringify(gateway), d.settlement_status, evActor]);
    return { changed: r.length > 0, status: 'under_review' };
  }
  const mismatch = amount !== Number(d.amount_minor);
  let fee = mismatch ? donationFee(cfg, amount, d.currency) : Number(d.fee_minor || 0);
  if (fee >= amount) fee = 0;
  const net = amount - fee;
  const flags = await donationRiskFlags(env, cfg, d, beneficiaryId, amount, mismatch);
  const to = flags.length ? 'under_review' : cfg.fundme_auto_verify ? 'verified' : 'processing';
  const why = flags.length ? `Flagged: ${flags.map((x) => x.label).join(', ')}` : to === 'verified' ? 'Payment confirmed and checks passed (automatic)' : 'Payment confirmed by the gateway';
  const alsoRun = [
    [`WITH u AS (
        UPDATE donations SET status = 'succeeded', settlement_status = $2, amount_minor = $3, fee_minor = $4, net_minor = $5,
               beneficiary_id = $6, received_at = now(), completed_at = now(), verified_at = CASE WHEN $2 = 'verified' THEN now() END,
               risk_flags = $7::jsonb, receipt_no = $8, gateway = $9::jsonb
         WHERE id = $1 AND status = 'pending' RETURNING id),
      e AS (${ev(`SELECT id, $10::text, $2, $11, NULL, $12, $13::jsonb FROM u`)})
      SELECT 1 / (SELECT COUNT(*)::int FROM u) AS ok`,
    [d.id, to, amount, fee, net, beneficiaryId, JSON.stringify(flags), receiptNo(d), JSON.stringify(gateway), d.settlement_status, evActor, why, JSON.stringify({ amountMinor: amount, feeMinor: fee, test: !!d.is_test })]],
    [`UPDATE fundraisers SET raised_minor = raised_minor + $2, donors_count = donors_count + 1, updated_at = now() WHERE id = $1`, [d.fundraiser_id, amount]],
  ];
  try {
    await recordDonationReceived(env, { donationId: d.id, beneficiaryId, fundraiserId: d.fundraiser_id, amountMinor: amount, feeMinor: fee, currency: d.currency, donorId: d.donor_id || null, alsoRun });
  } catch (e) {
    if (isGuard(e)) return { changed: false, status: null };
    throw e;
  }
  // notifications (never block the confirmation)
  const who = d.anonymous ? 'An anonymous supporter' : d.donor_name || 'Someone';
  if (f) {
    try {
      await q(env, 'INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, $2, $3, $4, $5)', [f.owner_id, 'fundme_donation', 'New donation 🎉',
        `${who} gave ${formatMoney(amount, d.currency)} to “${f.title}”${d.message ? `: “${String(d.message).slice(0, 80)}”` : ''}. BibleNestra holds it until it is verified and paid out to you.`,
        JSON.stringify({ fundraiserId: f.id, slug: f.slug, donationId: d.id, screen: 'FundMeMoney' })]);
    } catch (e) { console.warn('[fundme] owner notification failed', e && e.message); }
  }
  if (d.donor_id) {
    await walletNotify(c, { userId: d.donor_id, kind: 'fundme_receipt', title: 'Thank you — donation received', body: `Your ${formatMoney(amount, d.currency)} gift${f ? ` to “${f.title}”` : ''} was received. Tap for your receipt.`, data: { screen: 'FundMeReceipt', donationId: d.id } });
  }
  return { changed: true, status: to, donationId: d.id };
}

/** The payment didn't complete. Only a donation that was never received can fail. */
export async function failDonation(env, d, { actor = 'system', actorId = null, reason = 'Payment did not complete' } = {}) {
  const r = await q(env, `WITH u AS (UPDATE donations SET status = 'failed', settlement_status = 'failed', completed_at = now()
      WHERE id = $1 AND status = 'pending' AND received_at IS NULL RETURNING id, $2::text AS frm)
    ${ev(`SELECT id, frm, 'failed', $3, $4::uuid, $5, '{}'::jsonb FROM u`)} RETURNING donation_id`, [d.id, d.settlement_status, actor, actorId, reason]);
  return { changed: r.length > 0 };
}

/** Refund a received donation that is not inside a payout (ledger donation_refund:<id>, fundraiser total reduced). */
export async function refundDonation(env, d, { actor = 'admin', actorId = null, reason }) {
  const chk = canDonationAction('refund', d);
  if (!chk.ok) throw new ApiError(409, 'BAD_STATUS', chk.why);
  const gross = Number(d.amount_minor); const fee = Number(d.fee_minor || 0);
  try {
    await recordDonationRefunded(env, {
      donationId: d.id, beneficiaryId: d.beneficiary_id, amountMinor: gross, feeMinor: fee, currency: d.currency, actorId,
      alsoRun: [
        [`WITH u AS (UPDATE donations SET status = 'refunded', settlement_status = 'refunded'
              WHERE id = $1 AND settlement_status = $2 AND payout_id IS NULL AND received_at IS NOT NULL RETURNING id),
            e AS (${ev(`SELECT id, $2::text, 'refunded', $3, $4::uuid, $5, '{}'::jsonb FROM u`)})
          SELECT 1 / (SELECT COUNT(*)::int FROM u) AS ok`, [d.id, d.settlement_status, actor, actorId, reason || 'Refunded']],
        [`UPDATE fundraisers SET raised_minor = GREATEST(0, raised_minor - $2), donors_count = GREATEST(0, donors_count - 1), updated_at = now() WHERE id = $1`, [d.fundraiser_id, gross]],
      ],
    });
  } catch (e) {
    if (isGuard(e)) throw stateChanged();
    throw e;
  }
  return { changed: true };
}

/** Plain status change (no money moves): verify, approve, unapprove, review, fail (never-received). */
export async function setDonationStatus(env, d, action, { actor = 'admin', actorId = null, reason = null } = {}) {
  const a = DONATION_ACTIONS[action];
  const chk = canDonationAction(action, d);
  if (!chk.ok) throw new ApiError(409, 'BAD_STATUS', chk.why);
  if (a.reason && (!reason || String(reason).trim().length < 3)) throw bad('Add a short reason', 'REASON_REQUIRED');
  if (action === 'approve') {
    const cfg = await getConfig(env);
    const days = Number(cfg.fundme_payout_hold_days) || 0;
    const ready = new Date(new Date(d.received_at).getTime() + days * 86400000);
    if (ready > new Date()) throw new ApiError(409, 'ON_HOLD', `This donation is in the ${days}-day hold until ${ready.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  }
  if (action === 'fail') return failDonation(env, d, { actor, actorId, reason });
  const r = await q(env, `WITH u AS (UPDATE donations SET settlement_status = $2, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE verified_at END
        WHERE id = $1 AND settlement_status = $3 AND ($4::boolean IS NOT TRUE OR payout_id IS NULL) RETURNING id)
      ${ev(`SELECT id, $3::text, $2, $5, $6::uuid, $7, '{}'::jsonb FROM u`)} RETURNING donation_id`,
  [d.id, a.to, d.settlement_status, !!a.noPayout, actor, actorId, reason || a.label]);
  if (!r.length) throw stateChanged();
  return { changed: true };
}

/** Ask Paystack about a pending/processing donation and apply the answer. Returns the fresh row's status. */
export async function recheckDonation(c, d) {
  if (d.provider !== 'paystack' || d.status !== 'pending') return { changed: false };
  if (!paystackConfigured(c.env)) return { changed: false };
  const v = await verifyTransaction(c.env, d.provider_ref || d.id);
  if (v.status === 'success') {
    return confirmDonation(c, d, { amountMinor: v.amountMinor, currency: v.currency, actor: 'paystack', gateway: gatewayInfo(v.raw) });
  }
  if (v.status === 'failed' || v.status === 'reversed') return failDonation(c.env, d, { actor: 'paystack', reason: `Paystack: ${v.status}` });
  return { changed: false, gatewayStatus: v.status };
}
/** What we keep from a Paystack transaction (never card numbers). */
export function gatewayInfo(raw = {}) {
  return { channel: raw.channel || null, paidAt: raw.paid_at || raw.paidAt || null, gatewayFeesMinor: raw.fees != null ? Number(raw.fees) : null, gatewayId: raw.id != null ? String(raw.id) : null };
}

// ─── payouts ──────────────────────────────────────────────────────────────────────────────────────────────────────
const pev = (sql) => `INSERT INTO fundme_payout_events (payout_id, from_status, to_status, actor, actor_id, reason, meta) ${sql}`;

/** Money in this currency that is held for a beneficiary and not already promised to an unpaid payout. */
export async function payableHeld(env, beneficiaryId, currency) {
  const held = await getBalance(env, beneficiaryId, `donations_held_${currency.toLowerCase()}`);
  const open = await one(env, `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS n FROM fundme_payouts WHERE beneficiary_id = $1 AND currency = $2 AND status IN ('approved','processing','under_review','requested')`, [beneficiaryId, currency]);
  return { held, open: Number(open.n), free: held - Number(open.n) };
}

/**
 * Create a payout for one request from its donations that are approved for payout (and not in a payout yet).
 * Checks: verified bank account, minimum payout, and the payout can't exceed the verified money held for the beneficiary.
 * Real and test donations are never mixed in one payout.
 */
export async function createPayout(env, admin, fundraiserId, { test = false } = {}) {
  const f = await one(env, 'SELECT id, owner_id, title, currency FROM fundraisers WHERE id = $1', [fundraiserId]);
  if (!f) throw new ApiError(404, 'NOT_FOUND', 'Request not found');
  const acct = await one(env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [f.owner_id]);
  if (!acct || acct.status !== 'verified') throw new ApiError(409, 'NO_PAYOUT_ACCOUNT', 'The beneficiary has no verified bank account yet');
  const rows = await q(env, `SELECT id, net_minor, currency FROM donations WHERE fundraiser_id = $1 AND settlement_status = 'approved_for_payout'
      AND payout_id IS NULL AND is_test = $2 AND beneficiary_id = $3 ORDER BY received_at`, [f.id, !!test, f.owner_id]);
  if (!rows.length) throw new ApiError(409, 'NOTHING_TO_PAY', 'No donations of this request are approved for payout');
  const currency = rows[0].currency;
  if (rows.some((r) => r.currency !== currency)) throw new ApiError(409, 'MIXED_CURRENCY', 'Donations are in more than one currency');
  const amount = rows.reduce((s, r) => s + Number(r.net_minor || 0), 0);
  const cfg = await getConfig(env);
  const min = curVal(cfg, 'fundme_min_payout_minor', currency);
  if (amount < min) throw new ApiError(409, 'BELOW_MINIMUM', `The minimum payout is ${formatMoney(min, currency)} — this would be ${formatMoney(amount, currency)}`);
  const room = await payableHeld(env, f.owner_id, currency);
  if (amount > room.free) throw new ApiError(409, 'EXCEEDS_HELD', `A payout can’t be more than the verified money held: ${formatMoney(Math.max(0, room.free), currency)} is available`);
  const id = crypto.randomUUID();
  const ids = rows.map((r) => r.id);
  const meta = { donationIds: ids, test: !!test, bank: { bankName: acct.bank_name, last4: acct.account_last4, accountName: acct.account_name } };
  try {
    await tx(env, [
      [`INSERT INTO fundme_payouts (id, beneficiary_id, fundraiser_id, amount_minor, fee_minor, currency, status, provider, approved_by, approved_at, meta)
        VALUES ($1, $2, $3, $4, 0, $5, 'approved', 'manual', $6, now(), $7::jsonb)`, [id, f.owner_id, f.id, amount, currency, admin.id, JSON.stringify(meta)]],
      [`WITH u AS (UPDATE donations SET payout_id = $1 WHERE id = ANY($2::uuid[]) AND settlement_status = 'approved_for_payout' AND payout_id IS NULL RETURNING id)
        SELECT 1 / ((SELECT COUNT(*) FROM u) = $3::bigint)::int AS ok`, [id, ids, ids.length]],
      [pev(`VALUES ($1, NULL, 'approved', 'admin', $2, 'Payout approved', $3::jsonb)`), [id, admin.id, JSON.stringify({ amountMinor: amount, donations: ids.length })]],
    ]);
  } catch (e) {
    if (isGuard(e)) throw stateChanged('Some donations changed while creating the payout — reload and try again');
    throw e;
  }
  return one(env, 'SELECT * FROM fundme_payouts WHERE id = $1', [id]);
}

/** Mark a payout paid with the bank / Paystack reference: ledger held → paid, donations → paid, beneficiary notified. */
export async function markPayoutPaid(c, p, { reference, actor = 'admin', actorId = null, note = null }) {
  const env = c.env;
  if (!['approved', 'processing'].includes(p.status)) throw new ApiError(409, 'BAD_STATUS', `This payout is ${PAYOUT_LABEL[p.status] || p.status}`);
  const refText = String(reference || '').trim();
  if (refText.length < 4 || refText.length > 120) throw bad('Enter the payment reference from the bank or Paystack (4–120 characters)', 'REFERENCE_REQUIRED');
  try {
    await recordPayoutPaid(env, {
      payoutId: p.id, beneficiaryId: p.beneficiary_id, amountMinor: Number(p.amount_minor), currency: p.currency, actorId,
      alsoRun: [
        [`WITH u AS (UPDATE fundme_payouts SET status = 'paid', provider_ref = $2, paid_at = now(), updated_at = now(),
              meta = meta || jsonb_build_object('paidNote', $3::text) WHERE id = $1 AND status IN ('approved','processing') RETURNING id, $4::text AS frm),
            e AS (${pev(`SELECT id, frm, 'paid', $5, $6::uuid, $3, jsonb_build_object('reference', $2::text) FROM u`)})
          SELECT 1 / (SELECT COUNT(*)::int FROM u) AS ok`, [p.id, refText, note || 'Marked paid', p.status, actor === 'paystack' ? 'paystack' : 'admin', actorId]],
        [`WITH d AS (UPDATE donations SET settlement_status = 'paid' WHERE payout_id = $1 AND settlement_status = 'approved_for_payout' RETURNING id)
          ${ev(`SELECT id, 'approved_for_payout', 'paid', $2, $3::uuid, 'Included in a paid payout', jsonb_build_object('payoutId', $1::text) FROM d`)}`, [p.id, actor === 'paystack' ? 'paystack' : 'admin', actorId]],
      ],
    });
  } catch (e) {
    if (isGuard(e)) throw stateChanged();
    if (e && (e.code === '23505' || /duplicate key/i.test(String(e.message || '')))) throw new ApiError(409, 'DUPLICATE_REFERENCE', 'That payment reference is already used by another payout');
    throw e;
  }
  const f = p.fundraiser_id ? await one(env, 'SELECT title FROM fundraisers WHERE id = $1', [p.fundraiser_id]) : null;
  await walletNotify(c, {
    userId: p.beneficiary_id, kind: 'fundme_payout', title: 'Payout sent 🎉',
    body: `${formatMoney(p.amount_minor, p.currency)}${f ? ` from “${f.title}”` : ''} was paid to your bank account. Reference ${refText}.`,
    data: { screen: 'FundMeMoney', fundraiserId: p.fundraiser_id, payoutId: p.id },
  });
  return { changed: true };
}

/** A payout failed (bank rejected it, Paystack transfer failed…): donations go back to "approved for payout", money stays held. */
export async function failPayout(c, p, { reason, actor = 'admin', actorId = null }) {
  if (!['approved', 'processing', 'under_review'].includes(p.status)) throw new ApiError(409, 'BAD_STATUS', `This payout is ${PAYOUT_LABEL[p.status] || p.status}`);
  if (!reason || String(reason).trim().length < 3) throw bad('Add a short reason', 'REASON_REQUIRED');
  try {
    await tx(c.env, [
      [`WITH u AS (UPDATE fundme_payouts SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1 AND status = $3 RETURNING id),
          e AS (${pev(`SELECT id, $3::text, 'failed', $4, $5::uuid, $2, '{}'::jsonb FROM u`)})
        SELECT 1 / (SELECT COUNT(*)::int FROM u) AS ok`, [p.id, String(reason).slice(0, 500), p.status, actor === 'paystack' ? 'paystack' : 'admin', actorId]],
      [`WITH d AS (UPDATE donations SET payout_id = NULL WHERE payout_id = $1 AND settlement_status = 'approved_for_payout' RETURNING id)
        ${ev(`SELECT id, 'approved_for_payout', 'approved_for_payout', $2, $3::uuid, $4, jsonb_build_object('payoutId', $1::text, 'payoutFailed', true) FROM d`)}`, [p.id, actor === 'paystack' ? 'paystack' : 'admin', actorId, `Payout failed: ${String(reason).slice(0, 200)}`]],
    ]);
  } catch (e) {
    if (isGuard(e)) throw stateChanged();
    throw e;
  }
  await walletNotify(c, { userId: p.beneficiary_id, kind: 'fundme_payout', title: 'Payout didn’t go through', body: `We couldn’t pay ${formatMoney(p.amount_minor, p.currency)} to your bank account. Your money is still held safely — check your bank details in Fund Me.`, data: { screen: 'FundMeMoney', fundraiserId: p.fundraiser_id, payoutId: p.id } });
  return { changed: true };
}

/** Payout approved → under review (bank details changed) or back. */
export async function setPayoutReview(env, p, { to, reason, actorId = null, actor = 'admin' }) {
  const from = to === 'under_review' ? ['approved'] : ['under_review'];
  if (!from.includes(p.status)) throw new ApiError(409, 'BAD_STATUS', `This payout is ${PAYOUT_LABEL[p.status] || p.status}`);
  if (to === 'approved') {
    const acct = await one(env, 'SELECT status FROM fundme_bank_accounts WHERE user_id = $1', [p.beneficiary_id]);
    if (!acct || acct.status !== 'verified') throw new ApiError(409, 'NO_PAYOUT_ACCOUNT', 'Verify the beneficiary’s bank account first');
  }
  const r = await q(env, `WITH u AS (UPDATE fundme_payouts SET status = $2, updated_at = now() WHERE id = $1 AND status = $3 RETURNING id)
      ${pev(`SELECT id, $3::text, $2, $4, $5::uuid, $6, '{}'::jsonb FROM u`)} RETURNING payout_id`, [p.id, to, p.status, actor, actorId, reason || (to === 'approved' ? 'Review cleared' : 'Under review')]);
  if (!r.length) throw stateChanged();
  return { changed: true };
}

/** Optional automatic payout through a Paystack Transfer (env FUNDME_AUTO_PAYOUTS=true and keys). Default: manual. */
export async function sendPayoutTransfer(c, p, admin) {
  const env = c.env;
  if (!isOn(env.FUNDME_AUTO_PAYOUTS)) throw new ApiError(403, 'AUTO_PAYOUTS_OFF', 'Automatic payouts are switched off (FUNDME_AUTO_PAYOUTS). Pay by bank transfer and enter the reference.');
  if (!paystackConfigured(env)) throw new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', 'Paystack is not set up yet.');
  if (p.status !== 'approved') throw new ApiError(409, 'BAD_STATUS', 'Only an approved payout can be sent');
  const meta = typeof p.meta === 'string' ? JSON.parse(p.meta) : (p.meta || {});
  if (meta.test) throw new ApiError(409, 'TEST_PAYOUT', 'Test payouts can’t be sent through Paystack');
  if (p.currency !== 'NGN') throw new ApiError(409, 'BAD_CURRENCY', 'Paystack transfers are set up for NGN only');
  const acct = await one(env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [p.beneficiary_id]);
  if (!acct || acct.status !== 'verified') throw new ApiError(409, 'NO_PAYOUT_ACCOUNT', 'The beneficiary has no verified bank account');
  let recipient = acct.recipient_code;
  if (!recipient) {
    recipient = await createTransferRecipient(env, { name: acct.account_name, accountNumber: await decryptField(env, acct.account_number_enc), bankCode: acct.bank_code });
    await q(env, 'UPDATE fundme_bank_accounts SET recipient_code = $2 WHERE user_id = $1', [acct.user_id, recipient]);
  }
  const t = await initiateTransfer(env, { amountMinor: Number(p.amount_minor), recipientCode: recipient, reference: p.id, reason: 'BibleNestra Fund Me payout' });
  await q(env, `WITH u AS (UPDATE fundme_payouts SET status = 'processing', provider = 'paystack', meta = meta || jsonb_build_object('transferCode', $2::text), updated_at = now()
      WHERE id = $1 AND status = 'approved' RETURNING id)
    ${pev(`SELECT id, 'approved', 'processing', 'admin', $3::uuid, 'Sent through Paystack Transfer', jsonb_build_object('transferCode', $2::text, 'status', $4::text) FROM u`)}`, [p.id, t.transferCode, admin.id, t.status || '']);
  return { transferCode: t.transferCode, status: t.status };
}

// ─── bank accounts (beneficiary payout details) ─────────────────────────────────────────────────────────────────
const B64 = { enc: (u8) => btoa(String.fromCharCode(...u8)), dec: (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0)) };
async function dataKey(env) {
  const secret = env.FUNDME_DATA_KEY || env.FUNDME_SIGNING_SECRET || env.REALTIME_SECRET || 'biblenestra-fundme-fallback-secret';
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fundme-bank:${secret}`));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function encryptField(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(env), new TextEncoder().encode(String(text)));
  return `v1:${B64.enc(iv)}:${B64.enc(new Uint8Array(ct))}`;
}
export async function decryptField(env, stored) {
  const [v, iv, ct] = String(stored || '').split(':');
  if (v !== 'v1') throw new Error('bad ciphertext');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B64.dec(iv) }, await dataKey(env), B64.dec(ct));
  return new TextDecoder().decode(pt);
}

// Used when Paystack isn't connected yet (codes are Paystack / CBN bank codes). With keys the list comes from Paystack.
export const FALLBACK_BANKS = [
  ['044', 'Access Bank'], ['023', 'Citibank Nigeria'], ['050', 'Ecobank Nigeria'], ['070', 'Fidelity Bank'], ['011', 'First Bank of Nigeria'],
  ['214', 'First City Monument Bank'], ['058', 'Guaranty Trust Bank'], ['030', 'Heritage Bank'], ['082', 'Keystone Bank'], ['50211', 'Kuda Bank'],
  ['50515', 'Moniepoint MFB'], ['999992', 'OPay'], ['999991', 'PalmPay'], ['076', 'Polaris Bank'], ['221', 'Stanbic IBTC Bank'],
  ['232', 'Sterling Bank'], ['032', 'Union Bank of Nigeria'], ['033', 'United Bank For Africa'], ['215', 'Unity Bank'], ['035', 'Wema Bank'],
  ['057', 'Zenith Bank'],
].map(([code, name]) => ({ code, name }));

export async function bankList(env) {
  if (paystackConfigured(env)) {
    try { const l = await listBanks(env); if (l.length) return { banks: l, source: 'paystack' }; } catch (e) { /* fall back */ }
  }
  return { banks: FALLBACK_BANKS, source: 'builtin' };
}

export function bankShape(a, { admin = false } = {}) {
  if (!a) return null;
  return {
    bankCode: a.bank_code, bankName: a.bank_name, accountNumberMasked: `•••• ${a.account_last4}`, last4: a.account_last4,
    accountName: a.account_name, nameResolved: !!a.name_resolved, status: a.status, reviewNote: a.review_note || null,
    updatedAt: a.updated_at, ...(admin ? { userId: a.user_id, reviewedAt: a.reviewed_at, hasRecipient: !!a.recipient_code } : {}),
  };
}

/** Save / change payout details → pending_review; unpaid approved payouts of this member go under review. */
export async function saveBankAccount(c, me, { bankCode, accountNumber, accountName }) {
  const env = c.env;
  const code = String(bankCode || '').trim();
  const num = String(accountNumber || '').replace(/\s+/g, '');
  if (!/^[0-9]{2,20}$/.test(code)) throw bad('Choose your bank', 'BAD_BANK');
  if (!/^[0-9]{10}$/.test(num)) throw bad('Enter your 10-digit account number (NUBAN)', 'BAD_ACCOUNT_NUMBER');
  const { banks } = await bankList(env);
  const bank = banks.find((b) => b.code === code);
  if (!bank) throw bad('Choose your bank from the list', 'BAD_BANK');
  let name = String(accountName || '').trim().slice(0, 120);
  let resolved = false;
  if (paystackConfigured(env)) {
    try { const r = await resolveAccount(env, { accountNumber: num, bankCode: code }); if (r.accountName) { name = r.accountName; resolved = true; } } catch (e) {
      throw new ApiError(400, 'ACCOUNT_NOT_FOUND', 'The bank couldn’t find that account number — check it and the bank');
    }
  }
  if (name.length < 2) throw bad('Enter the account name exactly as your bank shows it', 'BAD_ACCOUNT_NAME');
  const enc = await encryptField(env, num);
  await tx(env, [
    [`INSERT INTO fundme_bank_accounts (user_id, bank_code, bank_name, account_number_enc, account_last4, account_name, name_resolved, status, recipient_code, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review', NULL, now())
      ON CONFLICT (user_id) DO UPDATE SET bank_code = EXCLUDED.bank_code, bank_name = EXCLUDED.bank_name, account_number_enc = EXCLUDED.account_number_enc,
        account_last4 = EXCLUDED.account_last4, account_name = EXCLUDED.account_name, name_resolved = EXCLUDED.name_resolved, status = 'pending_review',
        review_note = NULL, reviewed_by = NULL, reviewed_at = NULL, recipient_code = NULL, updated_at = now()`, [me.id, code, bank.name, enc, num.slice(-4), name, resolved]],
    [`WITH u AS (UPDATE fundme_payouts SET status = 'under_review', updated_at = now() WHERE beneficiary_id = $1 AND status = 'approved' RETURNING id)
      ${pev(`SELECT id, 'approved', 'under_review', 'system', NULL, 'Beneficiary changed bank details', '{}'::jsonb FROM u`)}`, [me.id]],
  ]);
  return bankShape(await one(env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [me.id]));
}

// ─── shapes ───────────────────────────────────────────────────────────────────────────────────────────────────────
const iso = (d) => (d ? new Date(d).toISOString() : null);
const jv = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
/** For the donor / beneficiary / admin. `who`: 'donor' | 'owner' | 'admin'. */
export function donationShape(d, who = 'owner') {
  const out = {
    id: d.id, fundraiserId: d.fundraiser_id, fundraiserTitle: d.fundraiser_title || undefined, slug: d.slug || undefined,
    amountMinor: Number(d.amount_minor), feeMinor: Number(d.fee_minor || 0), netMinor: d.net_minor != null ? Number(d.net_minor) : Number(d.amount_minor) - Number(d.fee_minor || 0),
    currency: d.currency, status: d.settlement_status, statusLabel: DONATION_LABEL[d.settlement_status] || d.settlement_status, paymentStatus: d.status,
    message: d.message || null, anonymous: !!d.anonymous, receiptNo: d.receipt_no || null, provider: d.provider, test: !!d.is_test,
    createdAt: iso(d.created_at), receivedAt: iso(d.received_at), verifiedAt: iso(d.verified_at), payoutId: d.payout_id || null,
  };
  if (who === 'owner' || who === 'admin') out.name = d.donor_name || (d.anonymous ? 'Anonymous' : 'A friend');
  if (who === 'admin') {
    Object.assign(out, {
      donorId: d.donor_id || null, donorEmail: d.donor_email || null, beneficiaryId: d.beneficiary_id || null, beneficiaryName: d.beneficiary_name || null,
      reference: d.provider_ref || null, riskFlags: jv(d.risk_flags, []), gateway: jv(d.gateway, {}),
    });
  }
  return out;
}
export function payoutShape(p) {
  const meta = jv(p.meta, {});
  return {
    id: p.id, fundraiserId: p.fundraiser_id, fundraiserTitle: p.fundraiser_title || undefined, beneficiaryId: p.beneficiary_id, beneficiaryName: p.beneficiary_name || undefined,
    amountMinor: Number(p.amount_minor), currency: p.currency, status: p.status, statusLabel: PAYOUT_LABEL[p.status] || p.status,
    provider: p.provider, reference: p.provider_ref || null, failureReason: p.failure_reason || null, test: !!meta.test,
    donations: (meta.donationIds || []).length, bank: meta.bank || null, approvedAt: iso(p.approved_at), paidAt: iso(p.paid_at), createdAt: iso(p.created_at),
  };
}
export const eventShape = (e) => ({ from: e.from_status, to: e.to_status, label: DONATION_LABEL[e.to_status] || PAYOUT_LABEL[e.to_status] || e.to_status, actor: e.actor, actorName: e.actor_name || null, reason: e.reason || null, meta: jv(e.meta, {}), at: iso(e.created_at) });

/** Receipt for a donor (spec §3 "users receive payment confirmations and receipts"). */
export function receiptShape(d) {
  return {
    receiptNo: d.receipt_no, donationId: d.id, date: iso(d.received_at || d.created_at), status: d.settlement_status, statusLabel: DONATION_LABEL[d.settlement_status],
    amountMinor: Number(d.amount_minor), feeMinor: Number(d.fee_minor || 0), netMinor: Number(d.net_minor != null ? d.net_minor : Number(d.amount_minor) - Number(d.fee_minor || 0)), currency: d.currency,
    request: { id: d.fundraiser_id, title: d.fundraiser_title, slug: d.slug }, beneficiary: d.beneficiary_name || null,
    donorName: d.anonymous ? 'Anonymous (name hidden publicly)' : d.donor_name || null, reference: d.provider_ref || d.id, method: d.provider === 'paystack' ? 'Paystack' : d.provider === 'test' ? 'Test payment (no money moved)' : d.provider,
    paidTo: 'BibleNestra (collecting on behalf of the beneficiary)',
    note: 'Your donation was paid to BibleNestra, which holds it for the beneficiary and pays it out after verification. This is a receipt for a gift, not a purchase.',
    test: !!d.is_test,
  };
}

// ─── reconciliation (spec §3 "reconcile money received vs paid out", §15E) ──────────────────────────────────────
/**
 * For each currency: from the donations table (received, fees, refunded, paid out, still held) and from the ledger
 * (donations_held_* / donations_paid_* / commission_* entries tied to donations). They must match:
 *   received gross = held + paid + fees + refunded gross     (table)   and   table held/paid/fees = ledger held/paid/fees.
 */
export async function reconciliation(env, { fundraiserId = null } = {}) {
  const params = []; let where = 'received_at IS NOT NULL';
  if (fundraiserId) { params.push(fundraiserId); where += ` AND fundraiser_id = $${params.length}`; }
  const tbl = await q(env, `SELECT currency, is_test,
      COUNT(*)::int AS n,
      COALESCE(SUM(amount_minor), 0)::bigint AS received,
      COALESCE(SUM(fee_minor) FILTER (WHERE settlement_status <> 'refunded'), 0)::bigint AS fees,
      COALESCE(SUM(amount_minor) FILTER (WHERE settlement_status = 'refunded'), 0)::bigint AS refunded,
      COALESCE(SUM(net_minor) FILTER (WHERE settlement_status = 'paid'), 0)::bigint AS paid,
      COALESCE(SUM(net_minor) FILTER (WHERE settlement_status IN ('processing','verified','approved_for_payout','under_review')), 0)::bigint AS held,
      COALESCE(SUM(net_minor) FILTER (WHERE settlement_status = 'under_review'), 0)::bigint AS under_review,
      COALESCE(SUM(net_minor) FILTER (WHERE settlement_status = 'approved_for_payout'), 0)::bigint AS approved
    FROM donations WHERE ${where} GROUP BY currency, is_test ORDER BY currency, is_test`, params);
  const byCur = {};
  for (const r of tbl) {
    const k = r.currency;
    const x = byCur[k] || (byCur[k] = { currency: k, donations: 0, receivedMinor: 0, feesMinor: 0, refundedMinor: 0, paidMinor: 0, heldMinor: 0, underReviewMinor: 0, approvedMinor: 0, testReceivedMinor: 0 });
    x.donations += r.n; x.receivedMinor += Number(r.received); x.feesMinor += Number(r.fees); x.refundedMinor += Number(r.refunded);
    x.paidMinor += Number(r.paid); x.heldMinor += Number(r.held); x.underReviewMinor += Number(r.under_review); x.approvedMinor += Number(r.approved);
    if (r.is_test) x.testReceivedMinor += Number(r.received);
  }
  // ledger side (entries tied to donations / payouts; for one request: only its donations and payouts)
  const lp = []; let lw = '';
  if (fundraiserId) {
    lp.push(fundraiserId);
    lw = ` AND ((e.related_type = 'donation' AND e.related_id IN (SELECT id::text FROM donations WHERE fundraiser_id = $1))
             OR (e.related_type = 'payout' AND e.related_id IN (SELECT id::text FROM fundme_payouts WHERE fundraiser_id = $1)))`;
  }
  const led = await q(env, `SELECT e.wallet, COALESCE(SUM(e.amount), 0)::bigint AS total FROM wallet_entries e
      WHERE (e.wallet LIKE 'donations_held_%' OR e.wallet LIKE 'donations_paid_%' OR (e.wallet LIKE 'commission_%' AND e.wallet <> 'commission_gift_coins' AND e.related_type = 'donation'))${lw}
      GROUP BY e.wallet`, lp);
  const lg = Object.fromEntries(led.map((r) => [r.wallet, Number(r.total)]));
  const out = Object.values(byCur).map((x) => {
    const c = x.currency.toLowerCase();
    const ledger = { heldMinor: lg[`donations_held_${c}`] || 0, paidMinor: lg[`donations_paid_${c}`] || 0, feesMinor: lg[`commission_${c}`] || 0 };
    const balanced = x.receivedMinor === x.heldMinor + x.paidMinor + x.feesMinor + x.refundedMinor;
    const matchesLedger = ledger.heldMinor === x.heldMinor && ledger.paidMinor === x.paidMinor && ledger.feesMinor === x.feesMinor;
    return { ...x, ledger, balanced, matchesLedger, ok: balanced && matchesLedger };
  });
  return { currencies: out, ok: out.every((x) => x.ok) };
}

/** Per-request rows for the reconciliation table. */
export async function reconciliationByRequest(env, { limit = 200 } = {}) {
  const rows = await q(env, `SELECT f.id, f.title, f.currency, f.owner_id, u.display_name AS owner_name,
      COUNT(d.id)::int AS donations,
      COALESCE(SUM(d.amount_minor), 0)::bigint AS received,
      COALESCE(SUM(d.fee_minor) FILTER (WHERE d.settlement_status <> 'refunded'), 0)::bigint AS fees,
      COALESCE(SUM(d.amount_minor) FILTER (WHERE d.settlement_status = 'refunded'), 0)::bigint AS refunded,
      COALESCE(SUM(d.net_minor) FILTER (WHERE d.settlement_status = 'paid'), 0)::bigint AS paid,
      COALESCE(SUM(d.net_minor) FILTER (WHERE d.settlement_status IN ('processing','verified','approved_for_payout','under_review')), 0)::bigint AS held,
      bool_or(d.is_test) AS has_test
    FROM fundraisers f JOIN users u ON u.id = f.owner_id JOIN donations d ON d.fundraiser_id = f.id AND d.received_at IS NOT NULL
    GROUP BY f.id, u.display_name ORDER BY MAX(d.received_at) DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    fundraiserId: r.id, title: r.title, currency: r.currency, beneficiaryId: r.owner_id, beneficiaryName: r.owner_name, donations: r.donations,
    receivedMinor: Number(r.received), feesMinor: Number(r.fees), refundedMinor: Number(r.refunded), paidMinor: Number(r.paid), heldMinor: Number(r.held), hasTest: !!r.has_test,
    balanced: Number(r.received) === Number(r.held) + Number(r.paid) + Number(r.fees) + Number(r.refunded),
  }));
}

/** Refund through Paystack before recording it (optional; otherwise the admin refunds in the Paystack dashboard). */
export async function paystackRefund(env, d) {
  if (d.provider !== 'paystack' || !paystackConfigured(env)) return null;
  return refundTransaction(env, { reference: d.provider_ref || d.id });
}
