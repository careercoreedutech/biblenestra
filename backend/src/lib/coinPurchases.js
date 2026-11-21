// LEGACY KINGDOM COINS purchase hook. Kingdom Coins (users.coins / coin_ledger) are FREE reward coins — earned from
// games, ads and contests, spent on chat passes and job bids — and are NOT sold today: there is no route that calls
// this. Paid digital currencies live in the wallet core (lib/wallet.js + lib/walletStore.js: Fund Me credits, Dating
// Coins, Gifting Coins), whose packs are bought through POST /wallet/purchase.
//
// If the client ever decides to sell Kingdom Coins, do NOT write a new Play flow: verify with the shared Play module
// (lib/play.js verifyPlayPurchase — the same one the wallet store and Memberships use), then call
// creditPurchasedCoins(env, userId, coins, { purchaseToken, productId }) with the coin amount from a server-side table.
// It is idempotent per purchase token (unique index coin_ledger_purchase_ref), so Play's redelivery never credits twice.
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
