// MEMBER WEBSITES: API helpers + hooks for the Websites directory, my websites and the add form.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';
import { errorMessage } from './client';

const okUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
export const cleanSite = (w) => (w ? { ...w, url: okUrl(w.url), image: okUrl(w.image), icon: okUrl(w.icon) } : w);

/** Approved websites (newest first). → { items, loading, error, refresh, loadMore, hasMore, online } */
export function useWebsites({ category } = {}) {
  const api = useApi();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const qs = category ? `&category=${encodeURIComponent(category)}` : '';
  const refresh = useCallback(async () => {
    if (!api.online) { setItems([]); return; }
    try {
      const r = await api.request('GET', `/websites?${qs.slice(1)}`);
      if (!alive.current) return;
      setItems((r.items || []).map(cleanSite).filter((w) => w.url));
      setCursor(r.cursor || null);
      setError(null);
    } catch (e) { if (alive.current) { setError(errorMessage(e, 'Couldn’t load websites')); setItems((x) => x || []); } }
  }, [api.online, api.request, qs]);
  useEffect(() => { refresh(); }, [refresh]);
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.request('GET', `/websites?cursor=${encodeURIComponent(cursor)}${qs}`);
      if (alive.current) { setItems((x) => [...(x || []), ...(r.items || []).map(cleanSite).filter((w) => w.url)]); setCursor(r.cursor || null); }
    } catch (e) { /* keep what we have */ }
    if (alive.current) setLoadingMore(false);
  }, [cursor, loadingMore, api.request, qs]);
  return { items, error, refresh, loadMore, hasMore: !!cursor, online: api.online };
}

/** My websites with their review status. */
export function useMyWebsites() {
  const api = useApi();
  const [state, setState] = useState({ items: null, max: 3, categories: [] });
  const refresh = useCallback(async () => {
    if (!api.online) { setState((s) => ({ ...s, items: [] })); return; }
    try {
      const r = await api.request('GET', '/websites/mine');
      setState({ items: (r.items || []).map(cleanSite), max: r.max || 3, categories: r.categories || [] });
    } catch (e) { setState((s) => ({ ...s, items: s.items || [] })); }
  }, [api.online, api.request]);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, refresh, online: api.online };
}

export const addWebsite = (request, body) => request('POST', '/websites', body);
export const removeWebsite = (request, id) => request('DELETE', `/websites/${id}`);
export const countOpen = (request, id) => request('POST', `/websites/${id}/open`, {}).catch(() => {});
