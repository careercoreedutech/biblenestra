// GOOGLE PLAY BILLING — the ONE shared Play module (brief 3.4). Used by the wallet store (coin / credit packs, Dating
// Plus / VIP: lib/walletStore.js) and by Memberships (lib/memberships.js re-exports these names unchanged).
//
//   playConfigured(env)            true once GOOGLE_PLAY_PACKAGE_NAME + GOOGLE_PLAY_SERVICE_ACCOUNT_JSON exist
//   verifyPlayPurchase(env, { productId, purchaseToken, type })
//                                  server-side verification → { productId, purchaseToken, orderId, expiresAt, priceMinor,
//                                  currency, raw }. Fails CLOSED: PAYMENTS_NOT_CONFIGURED until the real Google API call
//                                  below is written. Never grant anything without it.
//   testerAllowed(env, user, { flag, list })   test checkout / test purchase gate (flag env = true AND admin or listed)
//   storeMethod(env, platform)     the store row for a checkout sheet (Google Play / Apple IAP, "Coming soon" when off)
//
// Tests (and only tests) may inject env.__playVerifier(env, { productId, purchaseToken, type }) to simulate Google's
// answer. The returned productId / purchaseToken are still checked against what was asked for.
//
// Each feature keeps its own ONE activation function, called only after verifyPlayPurchase() succeeded:
//   wallet packs / Dating subscriptions → walletStore.activatePurchase()   (idempotent: ledger ref purchase:<id>)
//   memberships                          → memberships.activateVerifiedPlayPurchase()
// A purchase token may only ever be used once (unique indexes: wallet_purchases (provider, provider_ref),
// membership_subscriptions purchase_token, coin_ledger_purchase_ref for legacy Kingdom Coins).
import { ApiError, bad } from './http.js';

export const isOn = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
export const isPlatformAdmin = (u) => !!u && u.role === 'admin';
const listEnv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const playConfigured = (env) => !!(env && env.GOOGLE_PLAY_PACKAGE_NAME && env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);

export const PAYMENTS_SOON = 'Payments are coming soon — ask an admin for access.';
export function paymentsNotConfigured() {
  return new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', PAYMENTS_SOON);
}

/** flag env is on AND (platform admin OR user listed in the list env by id / handle / dev name). */
export function testerAllowed(env, user, { flag, list }) {
  if (!user || !isOn(env[flag])) return false;
  if (isPlatformAdmin(user)) return true;
  const allowed = listEnv(env[list]).map((s) => s.toLowerCase());
  const keys = [user.id, user.handle, user.clerk_id, String(user.clerk_id || '').replace(/^dev_/, '')].filter(Boolean).map((s) => String(s).toLowerCase());
  return keys.some((k) => allowed.includes(k));
}

/** Store payment row for a checkout sheet. android / web → Google Play, ios → Apple IAP (slot only). */
export function storeMethod(env, platform = 'android', id = 'play') {
  if (platform === 'ios') return { id: 'apple', label: 'Apple In-App Purchase', provider: 'apple', available: false, note: 'Coming soon' };
  const on = playConfigured(env);
  return { id, label: 'Google Play', provider: 'play', available: on, note: on ? 'Billed by Google Play' : 'Coming soon' };
}

/**
 * PLAY BILLING HOOK (Phase 3). Verifies a purchase token server-side.
 * To switch on: set GOOGLE_PLAY_PACKAGE_NAME and GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (wrangler secret), then implement
 * the call below with a service-account OAuth token (scope androidpublisher):
 *   type 'subscription': GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package}/purchases/subscriptionsv2/tokens/{token}
 *   type 'pack' (one-time, consumable): GET .../applications/{package}/purchases/products/{productId}/tokens/{token}
 * Check productId, purchaseState = PURCHASED / subscriptionState = ACTIVE, read orderId / expiryTime / price, then
 * acknowledge (subscriptions, memberships) or consume (coin packs) the purchase. Until then: PAYMENTS_NOT_CONFIGURED.
 */
export async function verifyPlayPurchase(env, { productId, purchaseToken, type = 'pack' } = {}) {
  const injected = typeof env.__playVerifier === 'function';
  if (!injected && !playConfigured(env)) throw paymentsNotConfigured();
  if (!productId || !purchaseToken) throw bad('productId and purchaseToken are required', 'BAD_PURCHASE');
  let v;
  if (injected) v = await env.__playVerifier(env, { productId, purchaseToken, type });
  else throw paymentsNotConfigured(); // Not implemented until the Play developer account exists — fail closed.
  if (!v || v.productId !== productId || v.purchaseToken !== purchaseToken) throw new ApiError(402, 'PURCHASE_NOT_VERIFIED', 'The store could not confirm this purchase');
  return { orderId: null, expiresAt: null, priceMinor: null, currency: null, raw: {}, ...v };
}
