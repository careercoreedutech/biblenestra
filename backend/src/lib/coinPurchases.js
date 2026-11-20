// PLAY BILLING HOOK (Phase 3). Real-money coin purchases are NOT live: there is no route that calls this yet.
//
// When Google Play Billing is set up, the purchase-verification route must:
//   1. verify the purchase token server-side with the Google Play Developer API (purchases.products.get),
//   2. check the product id → coin amount from its own server-side table (never trust an amount from the app),
//   3. call creditPurchasedCoins(env, userId, coins, { purchaseToken, productId }),
//   4. acknowledge / consume the purchase with Google.
// This is the ONLY place that should credit purchased coins. It is idempotent per purchase token (unique index
// coin_ledger_purchase_ref), so Play's redelivery of the same purchase never credits twice.
import { one } from './db.js';
import { ApiError } from './http.js';

/** Credit coins for a VERIFIED Play purchase. Returns { credited, coins } (credited = false on a repeat token). */
export async function creditPurchasedCoins(env, userId, coins, { purchaseToken, productId = null } = {}) {
  if (!Number.isInteger(coins) || coins <= 0 || coins > 1000000) throw new ApiError(400, 'BAD_AMOUNT', 'coins must be a positive integer');
  if (!purchaseToken || typeof purchaseToken !== 'string') throw new ApiError(400, 'BAD_TOKEN', 'purchaseToken is required');
  // ledger row first (ON CONFLICT on the purchase token), then the balance only when the row was new — one statement
  const row = await one(env, `WITH led AS (
        INSERT INTO coin_ledger (user_id, amount, reason, ref) VALUES ($1, $2, 'purchase', $3)
        ON CONFLICT (ref) WHERE reason = 'purchase' DO NOTHING RETURNING id),
      up AS (UPDATE users SET coins = coins + $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM led) RETURNING coins)
      SELECT (SELECT coins FROM up) AS coins, EXISTS (SELECT 1 FROM led) AS credited`,
  [userId, coins, `play:${purchaseToken}`]); // productId is for the caller's lookup/logging; the token alone is unique
  const bal = row && row.coins != null ? row.coins : (await one(env, 'SELECT coins FROM users WHERE id = $1', [userId]) || {}).coins;
  return { credited: !!(row && row.credited), coins: Number(bal || 0) };
}
