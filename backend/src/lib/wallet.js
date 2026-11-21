// WALLET CORE (monetisation stage 1 — client spec §15, brief 3.4 / 3.5 / 10.4).
// Contract for later stages (Fund Me, Virtual Gifts, Find Love): scratch/monetisation/wallet-core.md.
//
// ─── WALLETS ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Every balance is an integer number of UNITS of one wallet. Wallets never mix: a Dating Coin is not a Gifting Coin.
//   User wallets (shown in GET /wallet):
//   A fundme_credits             Fund Me request credits. Bought, gifted to another user, 1 spent per published request.
//   B dating_coins               Dating Coins. Bought, VIP monthly bonus, spent on Find Love features.
//     dating_boosts              Free profile boosts (VIP gets 2 per billing cycle). Spent by the Find Love stage.
//   C gift_coins                 Platform Gifting Coins. Bought, spent on virtual gifts only.
//   D gift_earnings              Gift earnings, PENDING (80% of each gift lands here, held for earnings_hold_days).
//     gift_earnings_available    Gift earnings released after the hold — the approved-withdrawal balance.
//     gift_earnings_withdrawing  Earnings inside a withdrawal request that is not paid yet.
//     gift_earnings_withdrawn    Running total paid out (never decreases except by a reversal).
//   Platform / held ledgers (never shown as spendable; admin + reconciliation):
//   E donations_held_<cur>       Donation money BibleNestra holds for a beneficiary (account = beneficiary user), minor units.
//     donations_paid_<cur>       Paid out to that beneficiary (account = beneficiary), minor units.
//   F commission_gift_coins      BibleNestra's 20% of gifts (account = 'platform'), gifting-coin units.
//     commission_<cur>           Money fees/commissions, e.g. Fund Me platform fee (account = 'platform'), minor units.
//   <cur> = ngn | gbp | usd | eur.
//
// ─── RULES ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// * post() is the ONLY writer. One call = one operation (wallet_ops row) with 1..20 legs (wallet_entries rows),
//   applied in ONE SQL statement → all legs or nothing. Production talks to Neon over HTTPS (lib/db.js, serverless
//   driver): every query is its own implicit transaction, so a single statement with data-modifying CTEs is the
//   atomic unit — no interactive BEGIN/COMMIT is needed (or possible) over HTTP. When business rows must commit with
//   the ledger, pass post({ …, alsoRun: [[sql, params]] }): db.js tx() sends them as ONE non-interactive Neon
//   transaction (sql.transaction) together with the ledger statement.
// * Idempotent: ref is the primary key of wallet_ops. The same ref twice = one effect, also when both requests arrive
//   at the same moment (the second waits on the key, then does nothing). The second call returns
//   { applied:false, duplicate:true } plus the original entries. Use refs derived from the business object
//   ('purchase:<id>', 'gift:<giftId>', 'fundme_publish:<fundraiserId>') or a client idempotency key.
// * Never negative: wallet_balances has CHECK (balance >= 0) (and entries CHECK balance_after >= 0). A leg that would
//   go below zero aborts the whole statement and post() throws ApiError 402 INSUFFICIENT_BALANCE
//   { wallet, balance, needed, shortBy }. Concurrent spends serialise on the balance row lock (rows are locked in a
//   fixed order, so two operations never deadlock each other), so a double spend can never both succeed.
// * Append-only: a trigger blocks UPDATE/DELETE of wallet_entries. Corrections are new reversing operations.
// * Every balance is the sum of its entries — ledgerIntegrity() checks it (Admin › Wallets & payments › Overview).
// * Legs do not have to sum to zero: money entering from outside (a verified store purchase, an admin adjustment,
//   a subscription bonus) is a single credit leg whose source is recorded by kind + related ids.
// * Admins: adjust() always needs a reason; the admin route writes admin_actions.
import { q, one, tx } from './db.js';
import { ApiError, bad } from './http.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from './push.js';

export const PLATFORM = 'platform';
export const CURRENCIES = ['ngn', 'gbp', 'usd', 'eur'];

// purchasable: can be bought with real money · spendable: can be used on features · giftable: can be sent to another
// user as-is · withdrawable: can become a cash payout (only after approval, see compliance notes).
export const WALLETS = {
  fundme_credits: { area: 'fundme', label: 'Fund Me request credits', unit: 'credit', units: 'credits', purchasable: true, spendable: true, giftable: true, withdrawable: false,
    about: 'One credit publishes one Fund Me request. You can buy credits or send some to another member. Credits are not cash and cannot be withdrawn or resold.' },
  dating_coins: { area: 'dating', label: 'Dating Coins', unit: 'coin', units: 'coins', purchasable: true, spendable: true, giftable: false, withdrawable: false,
    about: 'Used in Find Love for Super Likes, boosts, message bundles and more. You always confirm before coins are used. Not cash, not transferable.' },
  dating_boosts: { area: 'dating', label: 'Free profile boosts', unit: 'boost', units: 'boosts', purchasable: false, spendable: true, giftable: false, withdrawable: false, hideWhenZero: true,
    about: 'Boosts included with Dating VIP each month.' },
  gift_coins: { area: 'gifts', label: 'Gifting Coins', unit: 'coin', units: 'coins', purchasable: true, spendable: true, giftable: false, withdrawable: false,
    about: 'Buy Gifting Coins to send virtual gifts. Coins you buy are never cash and cannot be withdrawn.' },
  gift_earnings: { area: 'gifts', label: 'Gift earnings (pending)', unit: 'coin', units: 'coins', purchasable: false, spendable: false, giftable: false, withdrawable: false, state: 'pending',
    about: 'You receive 80% of every gift sent to you (BibleNestra keeps 20%). New earnings are held for a short period before they become available.' },
  gift_earnings_available: { area: 'gifts', label: 'Gift earnings (available)', unit: 'coin', units: 'coins', purchasable: false, spendable: false, giftable: false, withdrawable: true, state: 'available',
    about: 'Earnings past the hold period. Withdrawal is only for members approved in the BibleNestra creator payout programme.' },
  gift_earnings_withdrawing: { area: 'gifts', label: 'Gift earnings (withdrawal in progress)', unit: 'coin', units: 'coins', purchasable: false, spendable: false, giftable: false, withdrawable: false, state: 'withdrawing', hideWhenZero: true,
    about: 'Earnings in a withdrawal request that has not been paid yet.' },
  gift_earnings_withdrawn: { area: 'gifts', label: 'Gift earnings (withdrawn)', unit: 'coin', units: 'coins', purchasable: false, spendable: false, giftable: false, withdrawable: false, state: 'withdrawn', hideWhenZero: true,
    about: 'Total earnings paid out to you so far.' },
};
export const USER_WALLETS = Object.keys(WALLETS);
export const PURCHASABLE_WALLETS = USER_WALLETS.filter((w) => WALLETS[w].purchasable);
const PATTERN_WALLETS = [
  { re: /^donations_held_(ngn|gbp|usd|eur)$/, ledger: 'E', label: 'Donations held for beneficiary', minor: true },
  { re: /^donations_paid_(ngn|gbp|usd|eur)$/, ledger: 'E', label: 'Donations paid out', minor: true },
  { re: /^commission_gift_coins$/, ledger: 'F', label: 'Gift commission', minor: false, platformOnly: true },
  { re: /^commission_(ngn|gbp|usd|eur)$/, ledger: 'F', label: 'Fees and commission', minor: true, platformOnly: true },
];
export function walletInfo(wallet) {
  if (WALLETS[wallet]) return { wallet, user: true, ...WALLETS[wallet] };
  const p = PATTERN_WALLETS.find((x) => x.re.test(String(wallet)));
  return p ? { wallet, user: false, ...p, re: undefined } : null;
}
export const isWallet = (w) => !!walletInfo(w);

// Known kinds (labels shown in history). Any kind matching /^[a-z][a-z0-9_]{1,40}$/ is accepted by post(); later stages
// give theirs a label with registerKind('super_like', 'Super Like') at import time (no need to edit this file).
export const KINDS = {
  purchase: 'Bought', test_purchase: 'Test purchase', subscription_bonus: 'Subscription bonus', admin_adjust: 'Adjusted by BibleNestra',
  fundme_publish: 'Published a Fund Me request', fundme_credit_gift_sent: 'Sent credits', fundme_credit_gift_received: 'Received credits',
  dating_spend: 'Used in Find Love', dating_refund: 'Refunded', boost_used: 'Used a boost',
  gift_sent: 'Sent a gift', gift_commission: 'Gift commission', gift_received: 'Gift received',
  earnings_release: 'Earnings released', withdrawal_request: 'Withdrawal requested', withdrawal_paid: 'Withdrawal paid', withdrawal_reversed: 'Withdrawal returned',
  purchase_reversal: 'Purchase refunded',
  donation_received: 'Donation received', donation_fee: 'Platform fee', payout_paid: 'Payout paid', donation_refunded: 'Donation refunded',
};
const KIND_RE = /^[a-z][a-z0-9_]{1,40}$/;
/** Label a kind for history / admin. registerKind('super_like', 'Super Like'). */
export function registerKind(kind, label) {
  if (!KIND_RE.test(String(kind))) throw new Error(`bad kind ${kind}`);
  KINDS[kind] = String(label || kind).slice(0, 60);
}
const REF_RE = /^[A-Za-z0-9:_.\-]{3,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UNITS = 1e12;

// ─── config (admin-editable; stored in wallet_config) ─────────────────────────────────────────────────────────────
export const CONFIG_DEFAULTS = {
  gift_commission_bps: 2000,                                     // 20% (spec §11)
  gift_coin_rate: { coins: 1, perMinor: 100, currency: 'NGN' },  // conversion: `coins` Gifting Coins = `perMinor` kobo. PROPOSAL (1 coin = ₦1), client to confirm (spec §9). Admin-set; read it, never hard-code it.
  earnings_payout_rate: { minorPerCoin: 100, currency: 'NGN' },  // what 1 earned coin is worth on an approved creator payout. PROPOSAL, client to confirm.
  earnings_hold_days: 7,                                         // pending → available after this many days. PROPOSAL, client to confirm.
  earnings_withdrawals_enabled: false,                           // stays off until the payout programme is approved (legal review)
  earnings_min_withdrawal: 5000,                                 // coins
  fundme_publish_credits: 1,                                     // credits per published Fund Me request (spec §1)
};
const posInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const CONFIG_CHECK = {
  gift_commission_bps: (v) => posInt(v, 0, 9000),
  gift_coin_rate: (v) => !!v && posInt(v.coins, 1, 1e6) && posInt(v.perMinor, 1, 1e9) && /^[A-Z]{3}$/.test(String(v.currency || '')),
  earnings_payout_rate: (v) => !!v && posInt(v.minorPerCoin, 0, 1e7) && /^[A-Z]{3}$/.test(String(v.currency || '')),
  earnings_hold_days: (v) => posInt(v, 0, 365),
  earnings_withdrawals_enabled: (v) => typeof v === 'boolean',
  earnings_min_withdrawal: (v) => posInt(v, 0, 1e9),
  fundme_publish_credits: (v) => posInt(v, 0, 100),
};
/** Later stages can add their own settings (shown in Admin › Wallets & payments › Settings as JSON). */
export function registerConfig(key, dflt, check) {
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(key)) throw new Error('bad config key');
  CONFIG_DEFAULTS[key] = dflt;
  CONFIG_CHECK[key] = check;
}
export async function getConfig(env) {
  const rows = await q(env, 'SELECT key, value FROM wallet_config');
  const out = { ...CONFIG_DEFAULTS };
  for (const r of rows) if (r.key in CONFIG_DEFAULTS) out[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  return out;
}
/** Admin: set one config key (validated). Later stages may register keys by adding to CONFIG_DEFAULTS/CONFIG_CHECK. */
export async function setConfig(env, key, value, adminId = null) {
  if (!(key in CONFIG_CHECK)) throw bad(`Unknown setting ${key}`, 'BAD_CONFIG');
  if (!CONFIG_CHECK[key](value)) throw bad(`Invalid value for ${key}`, 'BAD_CONFIG');
  await q(env, `INSERT INTO wallet_config (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, JSON.stringify(value), adminId]);
  return getConfig(env);
}

/// ─── post: the one writer ─────────────────────────────────────────────────────────────────────────────────────────
function normLeg(l, i, opKind) {
  if (!l || typeof l !== 'object') throw bad('Bad leg', 'BAD_LEG');
  const info = walletInfo(l.wallet);
  if (!info) throw bad(`Unknown wallet ${l.wallet}`, 'BAD_WALLET');
  let account; let userId = null;
  if (l.userId) {
    if (!UUID_RE.test(String(l.userId))) throw bad('Bad userId', 'BAD_LEG');
    if (info.platformOnly) throw bad(`${l.wallet} belongs to the platform account`, 'BAD_LEG');
    account = String(l.userId).toLowerCase(); userId = account;
  } else if (l.account === PLATFORM) {
    if (info.user) throw bad(`${l.wallet} is a user wallet`, 'BAD_LEG');
    account = PLATFORM;
  } else throw bad('Each leg needs userId or account: "platform"', 'BAD_LEG');
  const amount = Number(l.amount);
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > MAX_UNITS) throw bad('Leg amount must be a non-zero integer', 'BAD_AMOUNT');
  const kind = l.kind || opKind;
  if (!KIND_RE.test(String(kind))) throw bad('Bad kind', 'BAD_KIND');
  if (l.counterpartyId && !UUID_RE.test(String(l.counterpartyId))) throw bad('Bad counterpartyId', 'BAD_LEG');
  return {
    leg: i + 1, account, user_id: userId, wallet: l.wallet, amount, kind,
    counterparty_id: l.counterpartyId || null, related_type: l.relatedType ? String(l.relatedType).slice(0, 40) : null,
    related_id: l.relatedId != null ? String(l.relatedId).slice(0, 200) : null, meta: l.meta && typeof l.meta === 'object' ? l.meta : {},
  };
}

// ONE statement = one Postgres transaction (also on Neon's HTTP driver, which runs every query in its own implicit
// transaction). (Before it, ensureRows() creates missing zero balance rows — harmless on its own.) Inside the statement:
//   op    claims the ref (PRIMARY KEY). A concurrent request with the same ref blocks on the index entry until the
//         first commits, then inserts nothing → no balance change, no entries (idempotency under concurrency).
//   lck   locks every touched balance row in a FIXED ORDER (account, wallet) → two operations never deadlock.
//   bal   adds the deltas. A concurrent spend of the same row waits for the lock and then re-reads the committed
//         balance (READ COMMITTED re-check), so CHECK (balance >= 0) sees the real total: of two double-spends one
//         fails → that whole statement (op row, every leg) rolls back.
//   ent   writes the append-only ledger rows with the balance after each leg.
const ENSURE_SQL = `INSERT INTO wallet_balances (account, wallet, user_id, balance)
    SELECT account, wallet, user_id, 0 FROM jsonb_to_recordset($1::jsonb) AS x(account text, wallet text, user_id uuid)
    ON CONFLICT (account, wallet) DO NOTHING`;
const POST_SQL = `WITH op AS (
    INSERT INTO wallet_ops (ref, kind, created_by, meta) VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (ref) DO NOTHING RETURNING ref),
  legs AS (
    SELECT * FROM jsonb_to_recordset($5::jsonb) AS l(leg int, account text, user_id uuid, wallet text, amount bigint, kind text,
      counterparty_id uuid, related_type text, related_id text, meta jsonb)),
  delta AS (SELECT account, wallet, sum(amount)::bigint AS d FROM legs GROUP BY account, wallet),
  lck AS (
    SELECT b.account FROM wallet_balances b JOIN delta ON b.account = delta.account AND b.wallet = delta.wallet
    WHERE EXISTS (SELECT 1 FROM op) ORDER BY b.account, b.wallet FOR UPDATE OF b),
  bal AS (
    UPDATE wallet_balances b SET balance = b.balance + delta.d, updated_at = now()
    FROM delta WHERE b.account = delta.account AND b.wallet = delta.wallet AND (SELECT count(*) FROM lck) > 0
    RETURNING b.account, b.wallet, b.balance),
  ent AS (
    INSERT INTO wallet_entries (ref, leg, account, user_id, wallet, amount, balance_after, kind, counterparty_id, related_type, related_id, meta)
    SELECT $1, l.leg, l.account, l.user_id, l.wallet, l.amount,
      bal.balance - COALESCE(sum(l.amount) OVER (PARTITION BY l.account, l.wallet ORDER BY l.leg ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING), 0),
      l.kind, l.counterparty_id, l.related_type, l.related_id, COALESCE(l.meta, '{}'::jsonb)
    FROM legs l JOIN bal ON bal.account = l.account AND bal.wallet = l.wallet
    RETURNING id, leg, account, wallet, amount, balance_after, kind, created_at)
  SELECT (SELECT count(*) FROM op)::int AS applied, (SELECT count(*) FROM bal)::int AS groups,
    COALESCE((SELECT json_agg(row_to_json(e) ORDER BY e.leg) FROM ent e), '[]'::json) AS entries`;

const isNegViolation = (e) => e && (e.code === '23514' || /wallet_balances_nonneg|balance_after_check|check constraint/i.test(String(e.message || '')));
// deadlock / serialization failure: the statement rolled back completely, and the ref makes a retry safe
const isRetryable = (e) => e && (e.code === '40P01' || e.code === '40001');
const isFkViolation = (e) => e && (e.code === '23503' || /foreign key constraint/i.test(String(e.message || '')));

async function insufficient(env, legs) {
  const groups = new Map();
  for (const l of legs) {
    const k = `${l.account}|${l.wallet}`;
    groups.set(k, { account: l.account, wallet: l.wallet, d: (groups.get(k)?.d || 0) + l.amount });
  }
  for (const g of groups.values()) {
    if (g.d >= 0) continue;
    const r = await one(env, 'SELECT balance FROM wallet_balances WHERE account = $1 AND wallet = $2', [g.account, g.wallet]);
    const balance = Number(r ? r.balance : 0);
    if (balance + g.d < 0) {
      const info = walletInfo(g.wallet);
      const err = new ApiError(402, 'INSUFFICIENT_BALANCE', `Not enough ${info.label || g.wallet}: you have ${balance}, this needs ${-g.d}.`);
      err.details = { wallet: g.wallet, account: g.account === PLATFORM ? PLATFORM : undefined, balance, needed: -g.d, shortBy: -g.d - balance };
      return err;
    }
  }
  const err = new ApiError(402, 'INSUFFICIENT_BALANCE', 'Not enough balance');
  err.details = {};
  return err;
}

/**
 * Apply one atomic, idempotent operation.
 * post(env, { ref, kind, actorId?, meta?, legs: [{ userId | account:'platform', wallet, amount, kind?, counterpartyId?, relatedType?, relatedId?, meta? }], alsoRun? })
 *   alsoRun: [[sql, params], …] — business writes that must commit TOGETHER with the ledger (mark a Fund Me request
 *            published, insert the gift row …). They run in the same Postgres transaction right AFTER the ledger
 *            statement; if a leg would go negative (or any statement fails) nothing at all is written. They also run
 *            when the ref is a duplicate, so make them idempotent (INSERT … ON CONFLICT DO NOTHING, UPDATE … WHERE
 *            status = 'draft').
 * → { applied: true, ref, entries: [{ id, leg, account, wallet, amount, balanceAfter, kind, createdAt }] }
 * → { applied: false, duplicate: true, ref, entries } when ref was already used (nothing changes)
 * throws 402 INSUFFICIENT_BALANCE { wallet, balance, needed, shortBy } · 400 BAD_REF / BAD_KIND / BAD_LEG / BAD_WALLET /
 *        BAD_AMOUNT / BAD_ALSO_RUN / UNKNOWN_USER · 409 REF_CONFLICT (ref used before by a different kind)
 */
export async function post(env, { ref, kind, actorId = null, meta = {}, legs, alsoRun = null } = {}) {
  if (!REF_RE.test(String(ref || ''))) throw bad('ref must be 3-200 chars of A-Z a-z 0-9 : _ . -', 'BAD_REF');
  if (!KIND_RE.test(String(kind || ''))) throw bad('Bad kind', 'BAD_KIND');
  if (!Array.isArray(legs) || !legs.length || legs.length > 20) throw bad('An operation needs 1-20 legs', 'BAD_LEG');
  if (alsoRun != null && (!Array.isArray(alsoRun) || alsoRun.some((s) => !Array.isArray(s) || typeof s[0] !== 'string'))) throw bad('alsoRun must be [[sql, params], …]', 'BAD_ALSO_RUN');
  const norm = legs.map((l, i) => normLeg(l, i, kind));
  const params = [ref, kind, actorId, JSON.stringify(meta || {}), JSON.stringify(norm)];
  const keys = [...new Map(norm.map((l) => [`${l.account}|${l.wallet}`, { account: l.account, wallet: l.wallet, user_id: l.user_id }])).values()];
  let row;
  for (let attempt = 1; ; attempt++) {
    try {
      await q(env, ENSURE_SQL, [JSON.stringify(keys)]);
      row = alsoRun && alsoRun.length
        ? (await tx(env, [[POST_SQL, params], ...alsoRun]))[0][0]
        : await one(env, POST_SQL, params);
      break;
    } catch (e) {
      if (isNegViolation(e)) throw await insufficient(env, norm);
      if (isRetryable(e) && attempt < 4) continue;
      if (isFkViolation(e)) throw bad('Unknown member in this operation', 'UNKNOWN_USER');
      throw e;
    }
  }
  if (!row.applied) {
    const prev = await one(env, 'SELECT kind FROM wallet_ops WHERE ref = $1', [ref]);
    if (prev && prev.kind !== kind) throw new ApiError(409, 'REF_CONFLICT', 'This reference was already used for a different operation');
    return { applied: false, duplicate: true, ref, entries: await entriesOf(env, ref) };
  }
  const entries = (typeof row.entries === 'string' ? JSON.parse(row.entries) : row.entries).map(entryLite);
  return { applied: true, ref, entries };
}
const entryLite = (e) => ({ id: Number(e.id), leg: e.leg, account: e.account, wallet: e.wallet, amount: Number(e.amount), balanceAfter: Number(e.balance_after), kind: e.kind, createdAt: new Date(e.created_at).toISOString() });
export async function entriesOf(env, ref) {
  const rows = await q(env, 'SELECT id, leg, account, wallet, amount, balance_after, kind, created_at FROM wallet_entries WHERE ref = $1 ORDER BY leg', [ref]);
  return rows.map(entryLite);
}

// ─── convenience helpers (all go through post(); all accept alsoRun) ──────────────────────────────────────────────
/** A positive whole number of units, or 400 BAD_AMOUNT. */
export function units(n, field = 'amount') {
  const v = Number(n);
  if (!Number.isSafeInteger(v) || v <= 0 || v > MAX_UNITS) throw bad(`${field} must be a positive whole number`, 'BAD_AMOUNT');
  return v;
}
/** Credit one user wallet (purchases, bonuses, refunds). amount > 0. */
export const credit = (env, { ref, userId, wallet, amount, kind, actorId, meta, relatedType, relatedId, counterpartyId, alsoRun }) =>
  post(env, { ref, kind, actorId, meta, alsoRun, legs: [{ userId, wallet, amount: units(amount), relatedType, relatedId, counterpartyId, meta }] });
/** Spend from one SPENDABLE user wallet (always confirm with the user in the app first — <ConfirmSpend/>). amount > 0. */
export const spend = async (env, { ref, userId, wallet, amount, kind, actorId, meta, relatedType, relatedId, counterpartyId, alsoRun }) => {
  if (!WALLETS[wallet] || !WALLETS[wallet].spendable) throw bad(`${wallet} cannot be spent`, 'NOT_SPENDABLE');
  return post(env, { ref, kind, actorId: actorId || userId, meta, alsoRun, legs: [{ userId, wallet, amount: -units(amount), relatedType, relatedId, counterpartyId, meta }] });
};
/** Move units of a GIFTABLE wallet from one member to another (Fund Me credits only). Not a general cash transfer. */
export async function transfer(env, { ref, fromId, toId, wallet, amount, kindOut, kindIn, meta, relatedType, relatedId, alsoRun }) {
  if (!WALLETS[wallet] || !WALLETS[wallet].giftable) throw bad(`${wallet} cannot be sent to other members`, 'NOT_GIFTABLE');
  if (!fromId || !toId || String(fromId).toLowerCase() === String(toId).toLowerCase()) throw bad('You cannot send to yourself', 'SELF_TRANSFER');
  const n = units(amount);
  return post(env, { ref, kind: kindOut, actorId: fromId, meta, alsoRun, legs: [
    { userId: fromId, wallet, amount: -n, kind: kindOut, counterpartyId: toId, relatedType, relatedId, meta },
    { userId: toId, wallet, amount: n, kind: kindIn, counterpartyId: fromId, relatedType, relatedId, meta },
  ] });
}
/** Gift split: commission = floor(coins × bps / 10000), recipient gets the rest. splitGift(2000, 2000) → { coins: 2000, commission: 400, earnings: 1600 }. */
export function splitGift(coins, bps = CONFIG_DEFAULTS.gift_commission_bps) {
  const c = Math.floor((Number(coins) * Number(bps)) / 10000);
  return { coins: Number(coins), commission: c, earnings: Number(coins) - c };
}
/**
 * The gift posting, ONE atomic + idempotent operation (ref e.g. 'gift:<giftSendId>'):
 *   sender gift_coins −coins · platform commission_gift_coins +commission · recipient gift_earnings (pending) +rest.
 * bps: commission in basis points (default: admin setting gift_commission_bps, 2000 = 20%; pass 0 for a gift that is not
 * eligible for commission). Returns post()'s result plus split: { coins, commission, earnings, bps }.
 */
export async function postGift(env, { ref, senderId, recipientId, coins, giftId = null, relatedType = 'gift', relatedId = null, meta = {}, bps = null, alsoRun = null }) {
  if (!senderId || !recipientId || String(senderId).toLowerCase() === String(recipientId).toLowerCase()) throw bad('You cannot send a gift to yourself', 'SELF_TRANSFER');
  const n = units(coins, 'coins');
  const rate = bps == null ? (await getConfig(env)).gift_commission_bps : Number(bps);
  if (!posInt(rate, 0, 10000)) throw bad('bps must be 0-10000', 'BAD_AMOUNT');
  const s = splitGift(n, rate);
  const m = { ...meta, giftId, commissionBps: rate };
  const legs = [
    { userId: senderId, wallet: 'gift_coins', amount: -s.coins, kind: 'gift_sent', counterpartyId: recipientId, relatedType, relatedId, meta: m },
    { userId: recipientId, wallet: 'gift_earnings', amount: s.earnings, kind: 'gift_received', counterpartyId: senderId, relatedType, relatedId, meta: m },
    { account: PLATFORM, wallet: 'commission_gift_coins', amount: s.commission, kind: 'gift_commission', counterpartyId: senderId, relatedType, relatedId, meta: m },
  ].filter((l) => l.amount !== 0);
  const r = await post(env, { ref, kind: 'gift_sent', actorId: senderId, meta: m, legs, alsoRun });
  return { ...r, split: { ...s, bps: rate } };
}

/** Admin manual adjustment of a member wallet (+/-). Reason required; the admin route logs it in admin_actions. */
export async function adjust(env, { adminId, userId, wallet, amount, reason, ref }) {
  if (!WALLETS[wallet]) throw bad('Unknown wallet', 'BAD_WALLET');
  const why = String(reason || '').trim();
  if (why.length < 5) throw bad('A reason is required (at least 5 characters)', 'REASON_REQUIRED');
  return post(env, { ref, kind: 'admin_adjust', actorId: adminId, meta: { reason: why.slice(0, 500), adminId },
    legs: [{ userId, wallet, amount: Number(amount), meta: { reason: why.slice(0, 500) } }] });
}

// ─── gift earnings lifecycle: gift_earnings (pending) → _available → _withdrawing → _withdrawn ──────────────────────
/** Move each gift_received entry older than the hold period from pending to available (ref release:<entryId>). Cron. */
export async function releaseMaturedEarnings(env, { limit = 200, now = new Date() } = {}) {
  const cfg = await getConfig(env);
  const rows = await q(env, `SELECT e.id, e.user_id, e.amount FROM wallet_entries e
    WHERE e.kind = 'gift_received' AND e.wallet = 'gift_earnings' AND e.amount > 0 AND e.user_id IS NOT NULL
      AND e.created_at <= $1::timestamptz - make_interval(days => $2::int)
      AND NOT EXISTS (SELECT 1 FROM wallet_ops o WHERE o.ref = 'release:' || e.id)
    ORDER BY e.id LIMIT $3`, [now.toISOString(), cfg.earnings_hold_days, limit]);
  let released = 0;
  for (const r of rows) {
    try {
      const res = await post(env, { ref: `release:${r.id}`, kind: 'earnings_release', legs: [
        { userId: r.user_id, wallet: 'gift_earnings', amount: -Number(r.amount), relatedType: 'entry', relatedId: r.id },
        { userId: r.user_id, wallet: 'gift_earnings_available', amount: Number(r.amount), relatedType: 'entry', relatedId: r.id },
      ] });
      if (res.applied) released++;
    } catch (e) { if (e.code !== 'INSUFFICIENT_BALANCE') throw e; } // reversed gift: nothing left to release
  }
  return { released };
}
/** Withdrawal ledger moves (the Gifts stage builds requests, KYC, approval). refs e.g. 'withdraw:<id>', 'withdraw_paid:<id>'. */
export const holdForWithdrawal = (env, { ref, userId, amount, requestId, alsoRun }) => post(env, { ref, kind: 'withdrawal_request', actorId: userId, alsoRun, legs: [
  { userId, wallet: 'gift_earnings_available', amount: -units(amount), relatedType: 'withdrawal', relatedId: requestId },
  { userId, wallet: 'gift_earnings_withdrawing', amount: units(amount), relatedType: 'withdrawal', relatedId: requestId }] });
export const completeWithdrawal = (env, { ref, userId, amount, requestId, actorId, alsoRun }) => post(env, { ref, kind: 'withdrawal_paid', actorId, alsoRun, legs: [
  { userId, wallet: 'gift_earnings_withdrawing', amount: -units(amount), relatedType: 'withdrawal', relatedId: requestId },
  { userId, wallet: 'gift_earnings_withdrawn', amount: units(amount), relatedType: 'withdrawal', relatedId: requestId }] });
export const reverseWithdrawal = (env, { ref, userId, amount, requestId, actorId, alsoRun }) => post(env, { ref, kind: 'withdrawal_reversed', actorId, alsoRun, legs: [
  { userId, wallet: 'gift_earnings_withdrawing', amount: -units(amount), relatedType: 'withdrawal', relatedId: requestId },
  { userId, wallet: 'gift_earnings_available', amount: units(amount), relatedType: 'withdrawal', relatedId: requestId }] });

// ─── Fund Me ledger E (the Fund Me stage builds the flows) ──────────────────────────────────────────────────────────
const cur = (c) => { const x = String(c || '').toLowerCase(); if (!CURRENCIES.includes(x)) throw bad('Unsupported currency', 'BAD_CURRENCY'); return x; };
/** A VERIFIED donation (after Paystack verify/webhook): beneficiary's held balance +(amount − fee), fee → platform commission_<cur>. ref donation:<id>. */
export async function recordDonationReceived(env, { donationId, beneficiaryId, fundraiserId = null, amountMinor, feeMinor = 0, currency, donorId = null, alsoRun = null }) {
  const c = cur(currency); const gross = units(amountMinor, 'amountMinor'); const fee = feeMinor ? units(feeMinor, 'feeMinor') : 0; const net = gross - fee;
  if (!(net > 0)) throw bad('Donation must be larger than the fee', 'BAD_AMOUNT');
  const legs = [{ userId: beneficiaryId, wallet: `donations_held_${c}`, amount: net, kind: 'donation_received', counterpartyId: donorId, relatedType: 'donation', relatedId: donationId, meta: { fundraiserId, grossMinor: gross, feeMinor: fee } }];
  if (fee > 0) legs.push({ account: PLATFORM, wallet: `commission_${c}`, amount: fee, kind: 'donation_fee', relatedType: 'donation', relatedId: donationId, meta: { fundraiserId } });
  return post(env, { ref: `donation:${donationId}`, kind: 'donation_received', actorId: donorId, meta: { fundraiserId }, legs, alsoRun });
}
/** Payout marked PAID: held → paid for the beneficiary. ref payout:<id>. INSUFFICIENT_BALANCE if more than is held. */
export async function recordPayoutPaid(env, { payoutId, beneficiaryId, amountMinor, currency, actorId = null, alsoRun = null }) {
  const c = cur(currency); const n = units(amountMinor, 'amountMinor');
  return post(env, { ref: `payout:${payoutId}`, kind: 'payout_paid', actorId, alsoRun, legs: [
    { userId: beneficiaryId, wallet: `donations_held_${c}`, amount: -n, relatedType: 'payout', relatedId: payoutId },
    { userId: beneficiaryId, wallet: `donations_paid_${c}`, amount: n, relatedType: 'payout', relatedId: payoutId }] });
}
/** Refund of a donation not yet paid out: held −net and the platform fee returned. ref donation_refund:<id>. */
export async function recordDonationRefunded(env, { donationId, beneficiaryId, amountMinor, feeMinor = 0, currency, actorId = null, alsoRun = null }) {
  const c = cur(currency); const gross = units(amountMinor, 'amountMinor'); const fee = feeMinor ? units(feeMinor, 'feeMinor') : 0; const net = gross - fee;
  if (!(net > 0)) throw bad('Donation must be larger than the fee', 'BAD_AMOUNT');
  const legs = [{ userId: beneficiaryId, wallet: `donations_held_${c}`, amount: -net, kind: 'donation_refunded', relatedType: 'donation', relatedId: donationId }];
  if (fee > 0) legs.push({ account: PLATFORM, wallet: `commission_${c}`, amount: -fee, kind: 'donation_refunded', relatedType: 'donation', relatedId: donationId });
  return post(env, { ref: `donation_refund:${donationId}`, kind: 'donation_refunded', actorId, alsoRun, legs });
}

// ─── integrity + notifications ────────────────────────────────────────────────────────────────────────────────────
/** Every balance must equal the sum of its ledger entries. → { ok, checked, mismatches: [{ account, wallet, balance, ledger }] } */
export async function ledgerIntegrity(env, { limit = 50 } = {}) {
  const rows = await q(env, `SELECT b.account, b.wallet, b.balance::text AS balance, COALESCE(e.total, 0)::text AS ledger, (SELECT count(*) FROM wallet_balances)::int AS n
      FROM wallet_balances b LEFT JOIN (SELECT account, wallet, sum(amount) AS total FROM wallet_entries GROUP BY account, wallet) e
        ON e.account = b.account AND e.wallet = b.wallet
      WHERE b.balance <> COALESCE(e.total, 0) LIMIT $1`, [limit]);
  const n = rows.length ? rows[0].n : Number((await one(env, 'SELECT count(*)::int AS n FROM wallet_balances')).n);
  return { ok: rows.length === 0, checked: n, mismatches: rows.map((r) => ({ account: r.account, wallet: r.wallet, balance: Number(r.balance), ledger: Number(r.ledger) })) };
}

/**
 * Tell a member about a wallet movement: notification inbox row + push (lib/push.js sendNotification, respects the
 * member's mute settings) + a realtime 'wallet.changed' event so open apps refresh balances. Never throws.
 * c = the Hono context. walletNotify(c, { userId, title: 'Gift received', body: 'Amy sent you a Crown 👑', data: { wallet: 'gift_earnings' }, kind: 'gift' })
 */
export async function walletNotify(c, { userId, title, body, data = {}, kind = 'wallet' }) {
  if (!userId) return;
  try { await notifyUser(c.env, userId, { type: 'wallet.changed', wallet: data.wallet || null }); } catch (e) { /* realtime is best effort */ }
  try { await sendNotification(c, { userId, kind, title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 300), data: { ...data, screen: data.screen || 'Wallet' } }); } catch (e) { console.warn('[wallet] notify failed', e.message); }
}
// ─── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** { fundme_credits: 0, dating_coins: 0, … } for every user wallet (zeros included). */
export async function getBalances(env, userId) {
  const rows = await q(env, 'SELECT wallet, balance FROM wallet_balances WHERE account = $1', [String(userId).toLowerCase()]);
  const out = Object.fromEntries(USER_WALLETS.map((w) => [w, 0]));
  for (const r of rows) if (r.wallet in out) out[r.wallet] = Number(r.balance);
  return out;
}
export async function getBalance(env, userId, wallet) {
  const r = await one(env, 'SELECT balance FROM wallet_balances WHERE account = $1 AND wallet = $2', [String(userId).toLowerCase(), wallet]);
  return Number(r ? r.balance : 0);
}
export function entryShape(e) {
  return {
    id: Number(e.id), ref: e.ref, wallet: e.wallet, amount: Number(e.amount), balanceAfter: Number(e.balance_after), kind: e.kind,
    label: KINDS[e.kind] || e.kind.replace(/_/g, ' '),
    counterparty: e.counterparty_id ? { id: e.counterparty_id, name: e.cp_name || null, handle: e.cp_handle || null } : null,
    relatedType: e.related_type || null, relatedId: e.related_id || null,
    meta: typeof e.meta === 'string' ? JSON.parse(e.meta) : (e.meta || {}), createdAt: e.created_at,
  };
}
/** history(env, userId, { wallet?, cursor?, limit? }) → { items, nextCursor } (newest first; cursor = last entry id). */
export async function history(env, userId, { wallet = null, cursor = null, limit = 30 } = {}) {
  if (wallet && !WALLETS[wallet]) throw bad('Unknown wallet', 'BAD_WALLET');
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const before = cursor != null && /^\d{1,18}$/.test(String(cursor)) ? String(cursor) : null;
  // gift_earnings = the whole earnings story (pending, available, withdrawing, withdrawn) in one list
  const wallets = !wallet ? USER_WALLETS : wallet === 'gift_earnings' ? USER_WALLETS.filter((w) => w.startsWith('gift_earnings')) : [wallet];
  const rows = await q(env, `SELECT e.*, u.display_name AS cp_name, u.handle AS cp_handle FROM wallet_entries e
      LEFT JOIN users u ON u.id = e.counterparty_id
      WHERE e.account = $1 AND e.wallet = ANY($2::text[]) AND ($3::bigint IS NULL OR e.id < $3::bigint)
      ORDER BY e.id DESC LIMIT $4`, [String(userId).toLowerCase(), wallets, before, lim]);
  const items = rows.map(entryShape);
  return { items, nextCursor: items.length === lim ? String(items[items.length - 1].id) : null };
}

// ─── rate limiting (fixed window, shared by wallet write endpoints and later stages) ───────────────────────────────
/** Throws 429 RATE_LIMITED when `key` was hit more than `max` times in the current `windowSec` window. */
export async function rateLimit(env, key, max, windowSec = 60) {
  const w = Math.floor(Date.now() / 1000 / windowSec);
  const r = await one(env, `INSERT INTO rate_limit_hits (key, window_start, n) VALUES ($1, $2, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET n = rate_limit_hits.n + 1 RETURNING n`, [String(key).slice(0, 200), w]);
  if (r.n > max) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests — please wait a moment and try again.');
  if (Math.random() < 0.02) q(env, 'DELETE FROM rate_limit_hits WHERE window_start < $1', [w - 2]).catch(() => {});
}

/** Cards for the app from a balances object: [{ wallet, balance, label, about, purchasable, spendable, giftable, withdrawable, flagsText, … }]. */
export function walletCards(balances) {
  return USER_WALLETS.filter((w) => !WALLETS[w].hideWhenZero || Number(balances[w] || 0) > 0).map((w) => {
    const x = WALLETS[w];
    const flags = [x.purchasable && 'Buy', x.spendable && 'Spend', x.giftable && 'Send to others', x.withdrawable && 'Withdraw (approved creators)'].filter(Boolean);
    return { wallet: w, balance: Number(balances[w] || 0), ...x, flagsText: flags.length ? flags.join(' · ') : 'Balance only' };
  });
}
