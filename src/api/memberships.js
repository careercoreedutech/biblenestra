// MEMBERSHIPS & PAID CHANNELS (online mode) — catalogue, product page, checkout, membership home and library.
// Server: backend/src/routes/memberships.js. A tiny shared cache keeps Discover › Memberships, Paid Channels and
// My Channels in step (joining in one place updates the others straight away).
//   useMembershipCatalog({ category, sort })  GET /memberships          → { items, total, categories, loaded, error, reload }
//   useMyMemberships()                        GET /memberships/mine     → { items, loaded, error, reload }
//   membershipsChanged()                      → every hook reloads (after join / renew / review)
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useApi } from './auth';
import { errorMessage } from './client';

const subs = new Set();
let version = 0;
export function membershipsChanged() { version += 1; subs.forEach((f) => { try { f(version); } catch (e) { /* ignore */ } }); }
function useVersion() {
  const [v, set] = useState(version);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return v;
}

// last good responses, so tabs switch instantly
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
  useEffect(() => { setData(path ? memo.get(path) || null : null); load(); }, [load, v]);
  return { data, error, loaded, reload: load, online: api.online };
}

export function useMembershipCatalog({ category = 'All', sort = 'trending' } = {}) {
  const qs = new URLSearchParams({ sort, ...(category && category !== 'All' ? { category } : {}) }).toString();
  const r = useGet(`/memberships?${qs}`);
  return { ...r, items: (r.data && r.data.items) || [], total: r.data ? r.data.total : 0, categories: (r.data && r.data.categories) || [{ name: 'All', count: 0 }] };
}

export function useMyMemberships() {
  const r = useGet('/memberships/mine');
  return { ...r, items: (r.data && r.data.items) || [] };
}

export function useMembership(ref) {
  return useGet(ref ? `/memberships/${encodeURIComponent(ref)}` : null);
}

export const checkoutPlatform = () => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web');

export const getCheckout = (api, id) => api.request('GET', `/memberships/${id}/checkout?platform=${checkoutPlatform()}`);
export const quotePromo = (api, id, planId, code) => api.request('POST', `/memberships/${id}/promo`, { planId, code });
export const submitCheckout = (api, id, body) => api.request('POST', `/memberships/${id}/checkout`, body);
export const getHome = (api, id) => api.request('GET', `/memberships/${id}/home`);
export const getLibrary = (api, id) => api.request('GET', `/memberships/${id}/library`);
export const setLessonDone = (api, id, lessonId, done) => api.request(done ? 'POST' : 'DELETE', `/memberships/${id}/lessons/${lessonId}/complete`);
export const getReviews = (api, id, offset = 0) => api.request('GET', `/memberships/${id}/reviews?offset=${offset}`);
export const postReview = (api, id, rating, body, edit) => api.request(edit ? 'PATCH' : 'POST', edit ? `/memberships/${id}/reviews/mine` : `/memberships/${id}/reviews`, { rating, body });

export const isMembershipRequired = (e) => !!e && e.code === 'MEMBERSHIP_REQUIRED';
export const friendly = (e, fallback) => errorMessage(e, fallback);

// ---------- display helpers ----------
export const ratingLabel = (r) => (r && r.count ? Number(r.avg || 0).toFixed(2).replace(/0$/, '') : '0.0');
export function initialsOf(name = '') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '•';
}
export function joinedLabel(iso) {
  if (!iso) return null;
  try { return `Joined ${new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`; } catch (e) { return null; }
}
export function writtenLabel(iso) {
  try { return `Written ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`; } catch (e) { return ''; }
}
export function untilLabel(iso) {
  if (!iso) return 'No end date';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; }
}
export const newKey = () => `ck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
