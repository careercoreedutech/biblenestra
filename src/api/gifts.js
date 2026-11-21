// VIRTUAL GIFTS & STARS (online mode). Server: backend/src/routes/virtualGifts.js · contract: scratch/monetisation/gifts.md.
//   useGiftCatalogue(context?)  GET /gifts/catalogue → { items, balance, rules, rate }
//   sendGift(api, { giftId, context: { type, id }, recipientId?, note?, idempotencyKey })
//   getGiftHistory(api, dir, cursor) · getGiftWall(api, userId) · useGiftEarnings()
//   applyCreatorProgramme(api, body) · requestWithdrawal(api, { coins, idempotencyKey })
//   live sessions: listLive(api), startLive(api, title), endLive(api, id), liveGifts(api, id, after)
// Every successful send/withdraw calls walletChanged() so balance pills, the Wallet screen and these hooks reload.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';
import { walletChanged, useWalletVersion } from './wallet';

const cache = new Map();
function useGet(path) {
  const api = useApi();
  const v = useWalletVersion();
  const [data, setData] = useState(() => (path ? cache.get(path) || null : null));
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(!!(path && cache.get(path)));
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    if (!path) return;
    if (!api.online) { setLoaded(true); return; }
    try {
      const d = await api.request('GET', path);
      cache.set(path, d);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) { if (alive.current) setError(e); } finally { if (alive.current) setLoaded(true); }
  }, [api.online, path]);
  useEffect(() => { load(); }, [load, v]);
  return { data, error, loaded, reload: load, online: api.online };
}

export function useGiftCatalogue(context = null) {
  const r = useGet(`/gifts/catalogue${context ? `?context=${encodeURIComponent(context)}` : ''}`);
  const d = r.data || {};
  return { ...r, items: d.items || [], balance: Number(d.balance || 0), rules: d.rules || { commissionPct: 20, holdDays: 7, explain: [] } };
}
export function useGiftEarnings() { return useGet('/gifts/earnings'); }
export function useGiftWall(userId) { return useGet(userId ? `/gifts/wall/${userId}` : null); }

export async function sendGift(api, body) {
  const r = await api.request('POST', '/gifts/send', body);
  walletChanged();
  return r;
}
export const getGiftHistory = (api, dir = 'all', cursor = null) =>
  api.request('GET', `/gifts/history?dir=${dir}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
export const applyCreatorProgramme = async (api, body) => { const r = await api.request('POST', '/gifts/programme', body); walletChanged(); return r; };
export const requestWithdrawal = async (api, body) => { const r = await api.request('POST', '/gifts/withdrawals', body); walletChanged(); return r; };

export const listLive = (api) => api.request('GET', '/live-sessions');
export const startLive = (api, title) => api.request('POST', '/live-sessions', { title });
export const endLive = (api, id) => api.request('POST', `/live-sessions/${id}/end`);
export const liveGifts = (api, id, after) => api.request('GET', `/live-sessions/${id}${after ? `?after=${encodeURIComponent(after)}` : ''}`);

export const CONTEXT_LABEL = { chat: 'in a chat', profile: 'on a profile', live: 'in a live session', post: 'on a post' };
export const fmt = (n) => Number(n || 0).toLocaleString('en-US');
export const naira = (minor) => `₦${(Number(minor || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
