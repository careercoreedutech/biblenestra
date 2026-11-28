// Rewarded ads (support flames, job coins) and game rewards. All coin changes happen here, on the server.
import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, int, isUuid, str, today } from '../lib/http.js';
import { RULES, jobAdsNeeded } from '../lib/rules.js';
import { verifySsv } from '../lib/admob.js';
import { meResponse } from './me.js';
import { recordDatingAdSsv } from '../lib/dating.js'; // FIND LOVE: SSV for dating message unlocks
import { applyUnlockAd, isUnlockFeature } from '../lib/featureUnlocks.js'; // FEATURE UNLOCKS: purpose 'unlock:<feature>' credits the unlock's coins
import { applyMembershipGateAd, AD_GATE_PURPOSE } from '../lib/membershipAdGate.js'; // MEMBERSHIP AD GATE: purpose 'membership_gate:<id>'

// Applies one watched ad. Returns { unlocked } (job purpose), { counted } (support purpose) or the unlock result.
export async function applyAdReward(env, userId, purpose, { transactionId = null, verified = false } = {}) {
  if (typeof purpose === 'string' && purpose.startsWith('unlock:')) {
    return applyUnlockAd(env, userId, purpose.slice('unlock:'.length), { transactionId, verified });
  }
  if (typeof purpose === 'string' && purpose.startsWith(AD_GATE_PURPOSE)) {
    return applyMembershipGateAd(env, userId, purpose.slice(AD_GATE_PURPOSE.length), { transactionId, verified });
  }
  if (purpose === 'support') {
    const u = await one(env, 'SELECT tz_offset FROM users WHERE id = $1', [userId]);
    const row = await one(env, `INSERT INTO ad_rewards (user_id, purpose, day, transaction_id, verified)
        SELECT $1, 'support', $2, $3, $4
        WHERE (SELECT count(*) FROM ad_rewards WHERE user_id = $1 AND purpose = 'support' AND day = $2) < $5
        ON CONFLICT (transaction_id) DO NOTHING RETURNING id`, [userId, today(u ? u.tz_offset : 0), transactionId, verified, RULES.supportAdsDaily]);
    return { counted: !!row };
  }
  if (purpose === 'job') {
    const rec = await one(env, `INSERT INTO ad_rewards (user_id, purpose, transaction_id, verified) VALUES ($1, 'job', $2, $3)
        ON CONFLICT (transaction_id) DO NOTHING RETURNING id`, [userId, transactionId, verified]);
    if (!rec) return { duplicate: true };
    const u = await one(env, `WITH up AS (
        UPDATE users SET
          coins = coins + CASE WHEN job_ad_credits + 1 >= $2 THEN $3 ELSE 0 END,
          job_ad_credits = CASE WHEN job_ad_credits + 1 >= $2 THEN 0 ELSE job_ad_credits + 1 END
        WHERE id = $1 RETURNING coins, job_ad_credits),
      led AS (INSERT INTO coin_ledger (user_id, amount, reason) SELECT $1, $3, 'job_ads' FROM up WHERE up.job_ad_credits = 0)
      SELECT * FROM up`, [userId, jobAdsNeeded(env), RULES.jobAdCoins]);
    return { unlocked: u.job_ad_credits === 0 ? RULES.jobAdCoins : 0 };
  }
  throw bad('purpose must be support or job');
}

// ---------- authenticated ----------
export const rewards = new Hono();

// Unverified claim from the app — only for development / demo ads (ADS_CLIENT_CLAIM=true). Production uses SSV.
rewards.post('/ads/claim', async (c) => {
  if (c.env.ADS_CLIENT_CLAIM !== 'true') throw new ApiError(403, 'SSV_REQUIRED', 'Rewards are verified by the ad network');
  const me = c.get('user');
  const b = await body(c);
  const res = await applyAdReward(c.env, me.id, b.purpose);
  const m = await meResponse(c.env, me.id);
  const unlockAd = res.adsNeeded !== undefined ? res : null; // FEATURE UNLOCKS: progress of an unlock:<feature> ad
  return c.json({ supportAdsToday: m.supportAdsToday, jobAdCredits: m.jobAdCredits, coins: m.coins, unlocked: res.unlocked || 0, counted: res.counted, unlockAd });
});

rewards.post('/games/results', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const rawId = str(b.gameId, { min: 1, max: 40, field: 'gameId' });
  const gameId = RULES.gameAliases[rawId] || rawId;
  if (!RULES.gameIds.includes(gameId)) throw bad('Unknown game');
  const day = str(b.day, { min: 10, max: 10, field: 'day' });
  const serverDay = Date.parse(today(me.tz_offset));
  const d = Date.parse(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(d) || Math.abs(d - serverDay) > 36 * 3600 * 1000) throw bad('day must be today (YYYY-MM-DD)', 'BAD_DAY');
  const total = int(b.total, { min: 1, max: RULES.gameMaxQuestions, field: 'total' });
  const correct = int(b.correct, { min: 0, max: total, field: 'correct' });
  const row = await one(c.env, `INSERT INTO game_results (user_id, game_id, day, correct, total, best) VALUES ($1,$2,$3,$4,$5,$4)
      ON CONFLICT (user_id, game_id, day) DO UPDATE SET rounds = game_results.rounds + 1, best = GREATEST(game_results.best, EXCLUDED.best)
      RETURNING rounds, best`, [me.id, gameId, day, correct, total]);
  let coinsEarned = 0;
  if (row.rounds === 1 && correct > 0) {
    coinsEarned = correct * RULES.gameCoinsPerCorrect;
    await one(c.env, `WITH up AS (UPDATE users SET coins = coins + $2 WHERE id = $1 RETURNING coins)
        INSERT INTO coin_ledger (user_id, amount, reason, ref) SELECT $1, $2, 'game', $3 FROM up RETURNING id`, [me.id, coinsEarned, gameId]);
  }
  const u = await one(c.env, 'SELECT coins FROM users WHERE id = $1', [me.id]);
  return c.json({ coinsEarned, coins: u.coins, best: row.best, firstRoundToday: row.rounds === 1 });
});

// ---------- public: AdMob SSV callback ----------
export const ssv = new Hono();
ssv.get('/ads/ssv', async (c) => {
  const p = await verifySsv(c.req.url, { keyOverride: c.env.__ssvKey });
  if (!p) throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid signature');
  const userId = p.user_id;
  const purpose = p.custom_data;
  // FIND LOVE: rewarded ads that unlock dating messages carry custom_data 'dating:<nonce>' (lib/dating.js)
  if (isUuid(userId) && typeof purpose === 'string' && purpose.startsWith('dating:') && p.transaction_id) {
    return c.json({ ok: true, ...(await recordDatingAdSsv(c.env, { userId, customData: purpose, transactionId: p.transaction_id })) });
  }
  // MEMBERSHIP AD GATE: custom_data 'membership_gate:<membershipId>' (same SSV signature checks); unknown ids are ignored
  if (isUuid(userId) && typeof purpose === 'string' && purpose.startsWith(AD_GATE_PURPOSE) && p.transaction_id) {
    const membershipId = purpose.slice(AD_GATE_PURPOSE.length);
    if (!isUuid(membershipId) || !(await one(c.env, 'SELECT id FROM users WHERE id = $1', [userId]))) return c.json({ ok: true, ignored: true });
    await applyMembershipGateAd(c.env, userId, membershipId, { transactionId: p.transaction_id, verified: true });
    return c.json({ ok: true });
  }
  // FEATURE UNLOCKS: custom_data 'unlock:<feature>' (same SSV signature checks as above); unknown features are acknowledged and ignored
  if (isUuid(userId) && typeof purpose === 'string' && purpose.startsWith('unlock:') && p.transaction_id) {
    const feature = purpose.slice('unlock:'.length);
    if (!(await isUnlockFeature(c.env, feature))) return c.json({ ok: true, ignored: true });
    const exists = await one(c.env, 'SELECT id FROM users WHERE id = $1', [userId]);
    if (!exists) return c.json({ ok: true, ignored: true });
    await applyUnlockAd(c.env, userId, feature, { transactionId: p.transaction_id, verified: true });
    return c.json({ ok: true });
  }
  if (!isUuid(userId) || !['support', 'job'].includes(purpose) || !p.transaction_id) return c.json({ ok: true, ignored: true }); // still 200 so AdMob stops retrying
  const exists = await one(c.env, 'SELECT id FROM users WHERE id = $1', [userId]);
  if (!exists) return c.json({ ok: true, ignored: true });
  await applyAdReward(c.env, userId, purpose, { transactionId: p.transaction_id, verified: true });
  return c.json({ ok: true });
});
