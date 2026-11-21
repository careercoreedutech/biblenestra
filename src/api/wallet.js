// WALLET CORE (online mode) — separate wallets (Fund Me credits, Dating Coins, Gifting Coins, gift earnings), packages,
// purchases and Dating Plus / VIP. Server: backend/src/routes/wallet.js · contract: scratch/monetisation/wallet-core.md.
//   useWallet()                       GET /wallet → { data: { wallets, balances, kingdomCoins, subscription, dating, rules, payments }, … }
//   useWalletProducts({ wallet } | { plans: true })  GET /wallet/products → { products, methods, canPay, message }
//   getHistory(api, wallet, cursor)   GET /wallet/:wallet/history
//   buyProduct(api, { productId, provider, idempotencyKey, purchaseToken? })
//   cancelSubscription(api, id)
//   walletChanged()                   → every hook reloads (call after any spend / purchase in later features)
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useApi } from './auth';
import { errorMessage } from './client';

const subs = new Set();
let version = 0;
export function walletChanged() { version += 1; subs.forEach((f) => { try { f(version); } catch (e) { /* ignore */ } }); }
function useVersion() {
  const [v, set] = useState(version);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return v;
}
const memo = new Map();

function useGet(path) {
  const api = useApi();
  const v = useVersion();
  const [data, setData] = useState(() => (path ? memo.get(path) || null : null));
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(!!(path && memo.get(path)));
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    if (!path) return;
    if (!api.online) { setLoaded(true); return; }
    try {
      const d = await api.request('GET', path);
      memo.set(path, d);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [api.online, path]);
  useEffect(() => { load(); }, [load, v]);
  return { data, error, loaded, reload: load, online: api.online };
}

export const walletPlatform = () => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web');

export function useWallet() {
  return useGet('/wallet');
}
/** Balance of one wallet (0 while loading / offline). */
export function useWalletBalance(wallet) {
  const r = useWallet();
  const b = r.data && r.data.balances ? r.data.balances[wallet] : undefined;
  return { ...r, balance: Number(b || 0), known: b !== undefined };
}
export function useWalletProducts({ wallet = null, plans = false } = {}) {
  const qs = new URLSearchParams({ platform: walletPlatform(), ...(plans ? { area: 'dating', type: 'subscription' } : wallet ? { wallet } : {}) }).toString();
  const r = useGet(`/wallet/products?${qs}`);
  const d = r.data || {};
  return { ...r, products: d.products || [], methods: d.methods || [], canPay: !!d.canPay, message: d.message || null };
}

export const getHistory = (api, wallet, cursor) => api.request('GET', `/wallet/${encodeURIComponent(wallet)}/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
export const buyProduct = (api, body) => api.request('POST', '/wallet/purchase', body);
export const cancelSubscription = (api, id) => api.request('POST', `/wallet/subscriptions/${id}/cancel`);
export const getSubscriptions = (api) => api.request('GET', '/wallet/subscriptions');
export const newIdempotencyKey = () => `wk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

export const walletError = (e, fallback) => {
  if (e && e.code === 'PAYMENTS_NOT_CONFIGURED') return 'Google Play billing is coming soon — nothing was charged.';
  if (e && e.code === 'INSUFFICIENT_BALANCE') return e.message || 'Not enough balance';
  if (e && e.code === 'RATE_LIMITED') return 'Please wait a moment and try again.';
  return errorMessage(e, fallback);
};

// ---------- display ----------
/** Short names for buttons and pills. */
export const WALLET_META = {
  fundme_credits: { short: 'Fund Me credits', unit: 'credits', icon: 'heart', tint: '#B5523B' },
  dating_coins: { short: 'Dating Coins', unit: 'coins', icon: 'heart', tint: '#C2417A' },
  dating_boosts: { short: 'Boosts', unit: 'boosts', icon: 'flame', tint: '#C2417A' },
  gift_coins: { short: 'Gifting Coins', unit: 'coins', icon: 'gift', tint: '#A87A27' },
  gift_earnings: { short: 'Pending earnings', unit: 'coins', icon: 'sparkles', tint: '#2E7D5B' },
  gift_earnings_available: { short: 'Available earnings', unit: 'coins', icon: 'sparkles', tint: '#2E7D5B' },
  gift_earnings_withdrawing: { short: 'Withdrawing', unit: 'coins', icon: 'clock', tint: '#2E7D5B' },
  gift_earnings_withdrawn: { short: 'Withdrawn', unit: 'coins', icon: 'check', tint: '#2E7D5B' },
};
export const fmtUnits = (n) => Number(n || 0).toLocaleString('en-US');
export function dateLabel(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; }
}
export function timeLabel(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; }
}
/** VIRTUAL GIFTS (append): a counter that changes on every walletChanged(), for other features' own hooks. */
export function useWalletVersion() { return useVersion(); }
