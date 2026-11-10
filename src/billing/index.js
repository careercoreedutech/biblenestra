// BibleNestra Plus — $4 a week or $35 a year, sold through Google Play Billing.
//
// Store billing is NOT connected yet, so nobody can be charged:
//   1. Create two auto-renewing subscriptions in Play Console with the product ids below.
//   2. Add a billing library to the app (e.g. react-native-iap or expo-iap) and fill in
//      `billingReady()`, `buy()` and `restore()` — the Plans screen needs no other change.
//   3. Verify each purchase token on the server (Google Play Developer API) and return
//      `premium: true` from GET /me; the sync layer then sets `state.premium`.
// Until then `billingReady()` is false and the Plans screen says "Subscriptions open soon".

export const PLANS = [
  {
    id: 'yearly',
    productId: 'bn_plus_yearly',
    label: 'Yearly',
    priceText: '$35',
    perText: 'a year',
    note: 'Just $0.67 a week',
    badge: 'Save 83%', // $35 vs 52 × $4 = $208
  },
  {
    id: 'weekly',
    productId: 'bn_plus_weekly',
    label: 'Weekly',
    priceText: '$4',
    perText: 'a week',
    note: 'Billed every week',
  },
];

export function billingReady() {
  return false;
}

export class BillingNotReady extends Error {
  constructor() {
    super('Subscriptions open soon');
    this.code = 'BILLING_NOT_READY';
  }
}

// Starts the Play purchase flow for a plan. Resolves { premium: true } once the purchase is confirmed.
export async function buy(/* plan */) {
  throw new BillingNotReady();
}

// Re-checks Play for an active subscription (new phone, reinstall).
export async function restore() {
  throw new BillingNotReady();
}
