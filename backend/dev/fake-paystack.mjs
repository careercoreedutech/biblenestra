// LOCAL DEV / TESTS ONLY: a pretend Paystack, so the whole purchase flow runs without keys or money.
// The dev server turns it on with PAYSTACK_FAKE=1 (and no PAYSTACK_SECRET_KEY). Never used by the deployed Worker:
// env.__paystackFetch / env.__paystackFake only exist when this file sets them.
//   initialize   → authorization_url = <origin>/pay/paystack/fake/<reference> (routes/paystack.js renders it)
//   verify       → 'abandoned' until the fake page is completed, then 'success' / 'failed'
//   charge_authorization (renewals) → success, unless fake.declineRenewals = true
export function makeFakePaystack() {
  const txns = new Map();
  const fake = {
    declineRenewals: false,
    txns,
    get: (ref) => txns.get(ref) || null,
    complete(ref, status, channel = 'card') {
      const t = txns.get(ref);
      if (!t) return null;
      t.status = status; t.channel = channel; t.paid_at = new Date().toISOString();
      return t;
    },
  };
  const auth = (email, channel) => ({
    authorization_code: `AUTH_fake_${email.replace(/\W/g, '')}`, signature: `SIG_fake_${email.replace(/\W/g, '')}`, reusable: channel === 'card', channel,
    card_type: channel === 'card' ? 'visa' : null, last4: channel === 'card' ? '4081' : null, bank: 'TEST BANK', exp_month: '12', exp_year: '2030',
  });
  const shape = (t) => ({ id: t.id, status: t.status, amount: t.amount, currency: t.currency, reference: t.reference, channel: t.channel, paid_at: t.paid_at, fees: Math.round(t.amount * 0.015),
    customer: { email: t.email }, authorization: auth(t.email, t.channel || 'card'), metadata: t.metadata });
  const fetchFn = async (method, path, payload) => {
    if (method === 'POST' && path === '/transaction/initialize') {
      const origin = new URL(payload.callback_url).origin;
      const t = { id: txns.size + 1, reference: payload.reference, amount: payload.amount, currency: payload.currency, email: payload.email, metadata: payload.metadata, callback_url: payload.callback_url, status: 'abandoned' };
      txns.set(t.reference, t);
      return { authorization_url: `${origin}/pay/paystack/fake/${encodeURIComponent(t.reference)}`, access_code: `ac_${t.id}`, reference: t.reference };
    }
    if (method === 'GET' && path.startsWith('/transaction/verify/')) {
      const t = txns.get(decodeURIComponent(path.split('/').pop()));
      if (!t) { const e = new Error('Transaction reference not found'); e.code = 'PROVIDER_ERROR'; e.status = 502; throw e; }
      return shape(t);
    }
    if (method === 'POST' && path === '/transaction/charge_authorization') {
      const t = { id: txns.size + 1, reference: payload.reference, amount: payload.amount, currency: payload.currency, email: payload.email, metadata: payload.metadata, channel: 'card',
        status: fake.declineRenewals ? 'failed' : 'success', paid_at: new Date().toISOString() };
      txns.set(t.reference, t);
      return { ...shape(t), gateway_response: fake.declineRenewals ? 'Declined' : 'Approved' };
    }
    const e = new Error(`fake paystack: ${method} ${path} not supported`); e.code = 'PROVIDER_ERROR'; e.status = 502; throw e;
  };
  return { fake, fetchFn };
}
