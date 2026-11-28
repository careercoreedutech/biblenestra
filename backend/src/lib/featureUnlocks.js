// FEATURE UNLOCKS (dev update v1, package C step 0): timed access to a feature, bought with Kingdom Coins or earned by
// watching rewarded ads.
//
// * Kingdom Coins = users.coins (+ coin_ledger). These are the free reward coins; they are NOT the paid wallets in
//   lib/wallet.js, so this module debits users.coins directly, in the same way as job bids and the chat week pass.
// * Catalogue: registerConfig 'feature_unlocks' (admin-editable, Admin › Wallets & payments › Settings as JSON).
//     { <feature>: { title, coins, hours, adRewards: [coins credited by ad 1, ad 2, …] } }
//   adRewards is the ad route: each rewarded ad credits the next amount, and the ads stop once the list is used up.
//   Example: scripture_pop 4 coins / 24 h, adRewards [1,1,1,1] (4 ads → 4 coins). recording 5 coins / 1 h, adRewards
//   [2,2,1] (3 ads → 5 coins). The sum of adRewards must equal coins, or the list is empty (buy only).
// * Spend: POST /unlocks/:feature with an Idempotency-Key (header, or body.ref). The key is claimed first, so a retry
//   with the same key returns the first result and charges nothing. Until = max(now, current until) + hours, so buying
//   while active adds time and buying after expiry starts from now.
// * Ads: the SSV callback (routes/rewards.js) and the dev claim route pass purpose 'unlock:<feature>' to applyUnlockAd.
//   Each ad transaction id counts once. Progress per feature is capped at the number of ads in adRewards and resets
//   when the user buys the unlock.
import { q, one, tx } from './db.js';
import { ApiError, bad, notFound } from './http.js';
import { getConfig, registerConfig } from './wallet.js';

export const DEFAULT_FEATURE_UNLOCKS = {
  scripture_pop: { title: 'Scripture Pop-up', coins: 4, hours: 24, adRewards: [1, 1, 1, 1] },
  recording: { title: 'Recording', coins: 5, hours: 1, adRewards: [2, 2, 1] },
};

const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;
const REF_RE = /^[A-Za-z0-9:_.\-]{3,120}$/;

function validEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (e.title !== undefined && (typeof e.title !== 'string' || e.title.length > 60)) return false;
  if (!Number.isInteger(e.coins) || e.coins < 1 || e.coins > 10000) return false;
  if (typeof e.hours !== 'number' || !Number.isFinite(e.hours) || e.hours <= 0 || e.hours > 8760) return false;
  if (e.adRewards === undefined || e.adRewards === null) return true;
  if (!Array.isArray(e.adRewards) || e.adRewards.length > 20) return false;
  if (!e.adRewards.every((n) => Number.isInteger(n) && n >= 1 && n <= 10000)) return false;
  return e.adRewards.length === 0 || e.adRewards.reduce((a, b) => a + b, 0) === e.coins;
}

/** Validates the admin catalogue. Used by registerConfig, so setConfig refuses a bad catalogue. */
export function checkFeatureUnlocks(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length >= 1 && keys.length <= 20 && keys.every((k) => KEY_RE.test(k) && validEntry(v[k]));
}
registerConfig('feature_unlocks', DEFAULT_FEATURE_UNLOCKS, checkFeatureUnlocks);

/** The catalogue as the server uses it: { feature: { title, coins, hours, adRewards } }. A stored value that no longer
 *  validates falls back to the defaults, so a bad row never breaks the app. */
export async function catalogue(env) {
  const cfg = await getConfig(env);
  const raw = checkFeatureUnlocks(cfg.feature_unlocks) ? cfg.feature_unlocks : DEFAULT_FEATURE_UNLOCKS;
  const out = {};
  for (const [k, e] of Object.entries(raw)) {
    out[k] = { title: e.title || k, coins: e.coins, hours: e.hours, adRewards: Array.isArray(e.adRewards) ? [...e.adRewards] : [] };
  }
  return out;
}

async function balanceOf(env, userId) {
  const r = await one(env, 'SELECT coins FROM users WHERE id = $1', [userId]);
  return r ? r.coins : 0;
}

async function grantOf(env, userId, feature) {
  const r = await one(env, `SELECT until, GREATEST(0, EXTRACT(EPOCH FROM (until - now())))::int AS remaining_sec
    FROM feature_unlocks WHERE user_id = $1 AND feature = $2`, [userId, feature]);
  if (!r) return null;
  return { feature, until: new Date(r.until).toISOString(), remainingSec: r.remaining_sec, active: r.remaining_sec > 0 };
}

/** True while the user's unlock of this feature has not expired. */
export async function hasUnlock(env, userId, feature) {
  const r = await one(env, 'SELECT 1 AS ok FROM feature_unlocks WHERE user_id = $1 AND feature = $2 AND until > now()', [userId, feature]);
  return !!r;
}

/** GET /unlocks: coin balance, the catalogue with each feature's status and ad progress, and the active unlocks. */
export async function unlockStatus(env, userId) {
  const cat = await catalogue(env);
  const coins = await balanceOf(env, userId);
  const grants = await q(env, `SELECT feature, until, GREATEST(0, EXTRACT(EPOCH FROM (until - now())))::int AS remaining_sec
    FROM feature_unlocks WHERE user_id = $1 AND until > now() ORDER BY until DESC`, [userId]);
  const progress = await q(env, 'SELECT feature, ads FROM feature_unlock_progress WHERE user_id = $1', [userId]);
  const grantByFeature = new Map(grants.map((g) => [g.feature, g]));
  const adsByFeature = new Map(progress.map((p) => [p.feature, p.ads]));
  const catalogueOut = {};
  for (const [key, f] of Object.entries(cat)) {
    const g = grantByFeature.get(key);
    const adsWatched = Math.min(adsByFeature.get(key) || 0, f.adRewards.length);
    catalogueOut[key] = {
      title: f.title,
      coins: f.coins,
      hours: f.hours,
      adsNeeded: f.adRewards.length,
      adsWatched,
      adCoinsEarned: f.adRewards.slice(0, adsWatched).reduce((a, b) => a + b, 0),
      adCoinsTotal: f.adRewards.reduce((a, b) => a + b, 0),
      canBuy: coins >= f.coins,
      unlocked: !!g,
      until: g ? new Date(g.until).toISOString() : null,
      remainingSec: g ? g.remaining_sec : 0,
    };
  }
  return {
    coins,
    catalogue: catalogueOut,
    active: grants.map((g) => ({ feature: g.feature, title: cat[g.feature] ? cat[g.feature].title : g.feature, until: new Date(g.until).toISOString(), remainingSec: g.remaining_sec })),
  };
}

/**
 * Spends coins on a feature. `ref` is the caller's idempotency key (scoped to user and feature).
 * → { duplicate, coins, unlock: { feature, title, until, remainingSec, coinsSpent } }
 */
export async function spendUnlock(env, userId, feature, ref) {
  const f = (await catalogue(env))[feature];
  if (!f) throw notFound('Unknown feature');
  const key = `${userId}:${feature}:${ref}`;
  const secs = Math.round(f.hours * 3600);

  // 1. claim the key. A second request with the same key stops here and returns the first result.
  const claim = await one(env, `INSERT INTO feature_unlock_spends (ref, user_id, feature, coins) VALUES ($1, $2, $3, $4)
    ON CONFLICT (ref) DO NOTHING RETURNING ref`, [key, userId, feature, f.coins]);
  if (!claim) {
    return { duplicate: true, coins: await balanceOf(env, userId), unlock: await grantOf(env, userId, feature) };
  }

  // 2. debit. The WHERE clause is the guard against two spends racing on the same balance.
  const debit = await one(env, 'UPDATE users SET coins = coins - $2 WHERE id = $1 AND coins >= $2 RETURNING coins', [userId, f.coins]);
  if (!debit) {
    await q(env, 'DELETE FROM feature_unlock_spends WHERE ref = $1', [key]);
    const balance = await balanceOf(env, userId);
    const err = new ApiError(402, 'INSUFFICIENT_COINS', `${f.title} needs ${f.coins} coins. You have ${balance}. Watch ads to earn the rest.`);
    err.details = { need: f.coins, balance, shortBy: f.coins - balance, adsNeeded: f.adRewards.length };
    throw err;
  }

  // 3. ledger + grant + reset the ad progress, in one transaction. If that fails, give the coins back and release the key.
  try {
    const [, grantRows] = await tx(env, [
      ['INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES ($1, $2, $3, $4)', [userId, -f.coins, 'unlock', feature]],
      [`INSERT INTO feature_unlocks (user_id, feature, until) VALUES ($1, $2, now() + make_interval(secs => $3::double precision))
          ON CONFLICT (user_id, feature) DO UPDATE SET until = GREATEST(now(), feature_unlocks.until) + make_interval(secs => $3::double precision),
            updated_at = now()
         RETURNING until`, [userId, feature, secs]],
      ['UPDATE feature_unlock_progress SET ads = 0, updated_at = now() WHERE user_id = $1 AND feature = $2', [userId, feature]],
    ]);
    const until = new Date(grantRows[0].until).toISOString();
    return {
      duplicate: false,
      coins: debit.coins,
      unlock: { feature, title: f.title, until, remainingSec: Math.max(0, Math.round((new Date(until) - Date.now()) / 1000)), coinsSpent: f.coins },
    };
  } catch (e) {
    await q(env, 'UPDATE users SET coins = coins + $2 WHERE id = $1', [userId, f.coins]);
    await q(env, 'DELETE FROM feature_unlock_spends WHERE ref = $1', [key]);
    throw e;
  }
}

/** Is this a feature in the catalogue? (SSV callbacks for unknown features are acknowledged and ignored.) */
export async function isUnlockFeature(env, feature) {
  const f = (await catalogue(env))[feature];
  return !!f && f.adRewards.length > 0;
}

/**
 * One rewarded ad for a feature. Each transactionId counts once (AdMob SSV transaction id; the dev claim route gets a
 * generated id). Returns { credited, coinsEarned, adsWatched, adsNeeded, coins } or { duplicate } or { credited:false, capped }.
 */
export async function applyUnlockAd(env, userId, feature, { transactionId = null, verified = false } = {}) {
  const f = (await catalogue(env))[feature];
  if (!f) throw bad('Unknown feature', 'BAD_FEATURE');
  const max = f.adRewards.length;
  if (!max) throw bad(`${f.title} cannot be earned with ads`, 'NO_AD_ROUTE');
  const txId = transactionId || `dev-${crypto.randomUUID()}`;

  const ins = await one(env, `INSERT INTO feature_unlock_ads (transaction_id, user_id, feature, verified) VALUES ($1, $2, $3, $4)
    ON CONFLICT (transaction_id) DO NOTHING RETURNING transaction_id`, [txId, userId, feature, !!verified]);
  if (!ins) return { duplicate: true, credited: false, coins: await balanceOf(env, userId) };

  await q(env, `INSERT INTO feature_unlock_progress (user_id, feature, ads) VALUES ($1, $2, 0) ON CONFLICT (user_id, feature) DO NOTHING`, [userId, feature]);
  const prog = await one(env, `UPDATE feature_unlock_progress SET ads = ads + 1, updated_at = now()
    WHERE user_id = $1 AND feature = $2 AND ads < $3 RETURNING ads`, [userId, feature, max]);
  if (!prog) return { credited: false, capped: true, adsWatched: max, adsNeeded: max, coins: await balanceOf(env, userId) };

  const amount = f.adRewards[prog.ads - 1];
  try {
    const [bal] = await tx(env, [
      ['UPDATE users SET coins = coins + $2 WHERE id = $1 RETURNING coins', [userId, amount]],
      ["INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES ($1, $2, 'unlock_ad', $3)", [userId, amount, feature]],
      ['UPDATE feature_unlock_ads SET credited = true, amount = $2 WHERE transaction_id = $1', [txId, amount]],
    ]);
    return { credited: true, coinsEarned: amount, adsWatched: prog.ads, adsNeeded: max, coins: bal[0].coins };
  } catch (e) {
    await q(env, 'UPDATE feature_unlock_progress SET ads = ads - 1, updated_at = now() WHERE user_id = $1 AND feature = $2', [userId, feature]);
    throw e;
  }
}

/** Ref for a request that did not send an Idempotency-Key: each such request is its own operation. */
export const newRef = () => `auto-${crypto.randomUUID()}`;
export const validRef = (r) => REF_RE.test(String(r || ''));
