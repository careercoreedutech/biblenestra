// WATCH & EARN (dev update v1): watch a rewarded ad, earn Kingdom Coins (users.coins + coin_ledger).
//
// * Purpose 'earn' (routes/rewards.js): the SSV callback (custom_data 'earn') and the dev claim route (/ads/claim with
//   ADS_CLIENT_CLAIM=true) both call applyWatchEarnAd. Production never trusts the app: only a verified SSV credits.
// * Config: registerConfig 'watch_earn' (Admin > Wallets & payments > Settings, JSON):
//     { enabled, coinsPerAd, dailyAds, streakBonus: { days, coins } }
//   coinsPerAd = Kingdom Coins per verified ad. dailyAds = cap per user per Africa/Lagos day. streakBonus = coins paid
//   once for every `days` consecutive days with at least one ad (the bonus is paid on the ad that completes the run).
// * Day: the Africa/Lagos calendar day (UTC+1, no daylight saving), the same as membershipAdGate and the daily caps.
// * Dedupe: watch_earn_ads.transaction_id is the primary key, so a replayed SSV never credits twice. The bonus has one
//   row per user and day (watch_earn_bonuses), so it is paid once even when several ads land the same day.
// * Tables: watch_earn_ads, watch_earn_bonuses (schema.sql, WATCH & EARN block). Kept apart from ad_rewards, whose
//   purpose column only allows support and job.
import { one, q, tx } from './db.js';
import { getConfig, registerConfig } from './wallet.js';

export const EARN_PURPOSE = 'earn';
export const DEFAULT_WATCH_EARN = { enabled: true, coinsPerAd: 2, dailyAds: 10, streakBonus: { days: 7, coins: 20 } };

const LAGOS_OFFSET_MS = 3600e3; // Africa/Lagos is UTC+1 all year
const DAY_MS = 86400e3;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Validates the admin setting. Used by registerConfig, so setConfig refuses a bad value. */
export function checkWatchEarn(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.enabled !== 'boolean') return false;
  if (!isInt(v.coinsPerAd, 1, 100)) return false;
  if (!isInt(v.dailyAds, 1, 100)) return false;
  if (!v.streakBonus || typeof v.streakBonus !== 'object' || Array.isArray(v.streakBonus)) return false;
  return isInt(v.streakBonus.days, 2, 60) && isInt(v.streakBonus.coins, 0, 10000);
}
registerConfig('watch_earn', DEFAULT_WATCH_EARN, checkWatchEarn);

/** The setting as the server uses it. A stored value that no longer validates falls back to the defaults. */
export async function watchEarnConfig(env) {
  const cfg = await getConfig(env);
  const v = checkWatchEarn(cfg.watch_earn) ? cfg.watch_earn : DEFAULT_WATCH_EARN;
  return {
    enabled: v.enabled,
    coinsPerAd: v.coinsPerAd,
    dailyAds: v.dailyAds,
    streakBonus: { days: v.streakBonus.days, coins: v.streakBonus.coins },
  };
}

/** The Africa/Lagos calendar day as YYYY-MM-DD for an instant (ms since epoch). */
export const lagosDay = (now = Date.now()) => new Date(now + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

/** The day n days after (negative: before) a YYYY-MM-DD day. */
export const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The first instant of the next Lagos day (when today's cap resets). */
export const nextLagosMidnight = (now = Date.now()) => new Date(Date.parse(`${shiftDay(lagosDay(now), 1)}T00:00:00Z`) - LAGOS_OFFSET_MS).toISOString();

/**
 * Consecutive days with at least one ad, ending today. If today has no ad yet the run is counted up to yesterday (it is
 * still alive until the day ends). `days` is a Set of YYYY-MM-DD strings.
 */
export function streakLength(days, today) {
  let cur = days.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (days.has(cur)) { n += 1; cur = shiftDay(cur, -1); }
  return n;
}

/** Ad days for a user in the window that matters for the streak (last ~400 days). */
async function adDays(env, userId, today) {
  const rows = await q(env, `SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day FROM watch_earn_ads
    WHERE user_id = $1 AND credited AND day >= $2::date AND day <= $3::date`, [userId, shiftDay(today, -400), today]);
  return new Set(rows.map((r) => r.day));
}

async function adsOn(env, userId, day) {
  const r = await one(env, 'SELECT count(*)::int AS n FROM watch_earn_ads WHERE user_id = $1 AND day = $2::date AND credited', [userId, day]);
  return r ? r.n : 0;
}

/**
 * One verified rewarded ad for 'earn'. Returns one of:
 *   { credited: true, coinsEarned, bonus: { coins, days } | null, adsToday, dailyAds, coins }
 *   { credited: false, duplicate: true }   same transaction id seen before (nothing changes)
 *   { credited: false, capped: true, adsToday, dailyAds }   the daily cap is used up
 *   { credited: false, disabled: true }   the admin switched Watch & Earn off
 */
export async function applyWatchEarnAd(env, userId, { transactionId = null, verified = false, now = Date.now() } = {}) {
  const cfg = await watchEarnConfig(env);
  if (!cfg.enabled) return { credited: false, disabled: true };
  const day = lagosDay(now);
  const txId = transactionId || `dev-${crypto.randomUUID()}`;

  // 1. claim the transaction id and the daily slot in one statement. The WHERE clause enforces the cap.
  const claim = await one(env, `INSERT INTO watch_earn_ads (transaction_id, user_id, day, verified, coins)
      SELECT $1, $2, $3::date, $4, $5
      WHERE (SELECT count(*) FROM watch_earn_ads WHERE user_id = $2 AND day = $3::date) < $6
      ON CONFLICT (transaction_id) DO NOTHING RETURNING transaction_id`,
  [txId, userId, day, !!verified, cfg.coinsPerAd, cfg.dailyAds]);
  if (!claim) {
    const seen = await one(env, 'SELECT 1 AS ok FROM watch_earn_ads WHERE transaction_id = $1', [txId]);
    if (seen) return { credited: false, duplicate: true };
    return { credited: false, capped: true, adsToday: await adsOn(env, userId, day), dailyAds: cfg.dailyAds };
  }

  // 2. credit the ad: coins, ledger row and the credited flag, in one transaction. On failure release the claim.
  let coins;
  try {
    const [bal] = await tx(env, [
      ['UPDATE users SET coins = coins + $2 WHERE id = $1 RETURNING coins', [userId, cfg.coinsPerAd]],
      ["INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES ($1, $2, 'watch_earn', $3)", [userId, cfg.coinsPerAd, txId]],
      ['UPDATE watch_earn_ads SET credited = true WHERE transaction_id = $1', [txId]],
    ]);
    coins = bal[0].coins;
  } catch (e) {
    await q(env, 'DELETE FROM watch_earn_ads WHERE transaction_id = $1', [txId]);
    throw e;
  }

  // 3. streak bonus: due when the run of ad days, counting today, is a multiple of streakBonus.days. Paid once per day.
  let bonus = null;
  const { days, coins: bonusCoins } = cfg.streakBonus;
  const run = streakLength(await adDays(env, userId, day), day);
  if (bonusCoins > 0 && run > 0 && run % days === 0) {
    const claimed = await one(env, `INSERT INTO watch_earn_bonuses (user_id, day, coins) VALUES ($1, $2::date, $3)
      ON CONFLICT (user_id, day) DO NOTHING RETURNING coins`, [userId, day, bonusCoins]);
    if (claimed) {
      const [bal] = await tx(env, [
        ['UPDATE users SET coins = coins + $2 WHERE id = $1 RETURNING coins', [userId, bonusCoins]],
        ["INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES ($1, $2, 'watch_earn_streak', $3)", [userId, bonusCoins, day]],
      ]);
      coins = bal[0].coins;
      bonus = { coins: bonusCoins, days };
    }
  }

  return { credited: true, coinsEarned: cfg.coinsPerAd, bonus, adsToday: await adsOn(env, userId, day), dailyAds: cfg.dailyAds, coins };
}

/**
 * GET /earn/status: today's ads and cap, coins earned today, total coins, the next reward, the streak and the config.
 * The streak counts ad days in a row. `watchedToday` says whether today's ad is already in it; otherwise the run is
 * still alive up to yesterday, and today's ad would extend it.
 */
export async function earnStatus(env, userId, now = Date.now()) {
  const cfg = await watchEarnConfig(env);
  const day = lagosDay(now);
  const u = await one(env, 'SELECT coins FROM users WHERE id = $1', [userId]);
  const today = await one(env, `SELECT count(*)::int AS ads, COALESCE(sum(coins), 0)::int AS coins
    FROM watch_earn_ads WHERE user_id = $1 AND day = $2::date AND credited`, [userId, day]);
  const bonusToday = await one(env, 'SELECT COALESCE(sum(coins), 0)::int AS coins FROM watch_earn_bonuses WHERE user_id = $1 AND day = $2::date', [userId, day]);
  const runDays = await adDays(env, userId, day);
  const length = streakLength(runDays, day);
  const watchedToday = runDays.has(day);
  const every = cfg.streakBonus.days;
  // the streak length at which the next bonus lands: the next multiple of `every` above the run (today's ad included)
  const target = watchedToday ? (Math.floor(length / every) + 1) * every : Math.ceil((length + 1) / every) * every;
  const adsLeft = Math.max(0, cfg.dailyAds - today.ads);
  return {
    enabled: cfg.enabled,
    day,
    resetsAt: nextLagosMidnight(now),
    adsToday: today.ads,
    dailyAds: cfg.dailyAds,
    adsLeftToday: adsLeft,
    canWatch: cfg.enabled && adsLeft > 0,
    coinsToday: today.coins + bonusToday.coins,
    coins: u ? u.coins : 0,
    nextReward: { coins: cfg.coinsPerAd, perAd: true },
    streak: {
      length,
      watchedToday,
      days: every,
      bonusCoins: cfg.streakBonus.coins,
      nextBonusAt: target,
      daysToBonus: target - length,
    },
    config: cfg,
  };
}
