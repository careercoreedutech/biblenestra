// PORTFOLIO & PARTNER MANAGERS (online mode). Server: backend/src/routes/portfolio.js (logic in lib/portfolio.js).
//   usePortfolioMe()        GET /portfolio/me         my role, status, landing link, pending application
//   usePortfolioDashboard() GET /portfolio/dashboard  Portfolio Manager dashboard
//   usePartnerDashboard()   GET /partner/dashboard    Partner Manager dashboard
//   portfolioInvite(api, code)   GET /portfolio/invites/:code   (public info for the Apply screen)
//   applyToPortfolio(api, body) · createPartnerInvite(api, body) · revokePartnerInvite(api, id)
//   decideApplication(api, id, 'approve'|'reject', reason) · requestPortfolioWithdrawal(api, amountMinor)
//   getPortfolioStatement(api, month) · getPortfolioCommissions(api, before)
// Every write calls portfolioChanged() so the dashboards reload.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';
import { errorMessage } from './client';

const subs = new Set();
let version = 0;
export function portfolioChanged() { version += 1; subs.forEach((f) => { try { f(version); } catch (e) { /* ignore */ } }); }
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
  return { data, error, loaded, reload: load };
}

export const usePortfolioMe = () => useGet('/portfolio/me');
export const usePortfolioDashboard = () => useGet('/portfolio/dashboard');
export const usePartnerDashboard = () => useGet('/partner/dashboard');

async function write(api, method, path, body) {
  const r = await api.request(method, path, body);
  portfolioChanged();
  return r;
}
export const portfolioInvite = (api, code) => api.request('GET', `/portfolio/invites/${encodeURIComponent(String(code || '').trim())}`);
export const applyToPortfolio = (api, body) => write(api, 'POST', '/portfolio/apply', body);
export const createPartnerInvite = (api, body) => write(api, 'POST', '/portfolio/invites', body);
export const revokePartnerInvite = (api, id) => write(api, 'POST', `/portfolio/invites/${id}/revoke`, {});
export const decideApplication = (api, id, action, reason) => write(api, 'POST', `/portfolio/applications/${id}/${action}`, reason ? { reason } : {});
export const requestPortfolioWithdrawal = (api, amountMinor) => write(api, 'POST', '/portfolio/withdrawals', { amountMinor, currency: 'NGN' });
export const getPortfolioStatement = (api, month) => api.request('GET', `/portfolio/statement${month ? `?month=${month}` : ''}`);
export const getPortfolioCommissions = (api, before) => api.request('GET', `/portfolio/commissions${before ? `?before=${before}` : ''}`);
export const portfolioError = (e, fallback) => errorMessage(e, fallback);

/** Naira display of an amount in kobo (minor units). */
export function naira(minor) {
  const n = Number(minor || 0) / 100;
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Sum of a balances row for the currency NGN (the default). */
export function ngnBalance(list, key) {
  const row = (list || []).find((b) => b.currency === 'NGN') || null;
  return row ? Number(row[key] || 0) : 0;
}
