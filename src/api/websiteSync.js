// MEMBER WEBSITE INTEGRATION: API hooks and actions for the integration dashboard, the composer, the Website feed
// and the article reader. Server: backend/src/routes/websites.js (website-integrations, website-articles, website-feed).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';
import { errorMessage } from './client';

/** My website connections, alerts and settings. → { items, alerts, access, max, ... , refresh } */
export function useIntegrations() {
  const api = useApi();
  const [state, setState] = useState({ items: null, alerts: [], access: false, max: 3, publishRequiresApproval: true, ownerCanApprove: true, error: null });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const refresh = useCallback(async () => {
    if (!api.online) { setState((s) => ({ ...s, items: [] })); return; }
    try {
      const r = await api.request('GET', '/website-integrations');
      if (alive.current) setState({ ...r, error: null });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, items: s.items || [], error: errorMessage(e, 'Couldn’t load your websites') }));
    }
  }, [api.online, api.request]);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, online: api.online, refresh };
}

/** Publication and import history of one connection. */
export function useIntegrationHistory(connectionId) {
  const api = useApi();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    if (!api.online || !connectionId) return;
    try {
      const r = await api.request('GET', `/website-integrations/${connectionId}/history`);
      setItems(r.items || []);
      setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load the history')); setItems((x) => x || []); }
  }, [api.online, api.request, connectionId]);
  useEffect(() => { refresh(); }, [refresh]);
  return { items, error, refresh };
}

/** The Website feed: approved imports and published articles, newest first. */
export function useWebsiteFeed() {
  const api = useApi();
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    if (!api.online) { setItems([]); return; }
    try {
      const r = await api.request('GET', '/website-feed');
      setItems(r.items || []);
      setCursor(r.cursor || null);
      setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load the Website feed')); setItems((x) => x || []); }
  }, [api.online, api.request]);
  useEffect(() => { refresh(); }, [refresh]);
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const r = await api.request('GET', `/website-feed?cursor=${encodeURIComponent(cursor)}`);
      setItems((x) => [...(x || []), ...(r.items || [])]);
      setCursor(r.cursor || null);
    } catch (e) { setCursor(null); }
  }, [cursor, api.request]);
  return { items, error, refresh, loadMore, hasMore: !!cursor };
}

/** One article for the reader: { ...article, blocks } where blocks carry the ad slots (server-placed). */
export function useWebsiteArticle(id) {
  const api = useApi();
  const [article, setArticle] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!api.online || !id) { setError('Sign in to read this article.'); return undefined; }
    api.request('GET', `/website-articles/${id}`)
      .then((r) => { if (alive) setArticle(r); })
      .catch((e) => { if (alive) setError(errorMessage(e, 'This article is no longer available')); });
    return () => { alive = false; };
  }, [api.online, api.request, id]);
  return { article, error };
}

export const websiteActions = {
  connect: (request, body) => request('POST', '/website-integrations', body),
  update: (request, id, body) => request('PATCH', `/website-integrations/${id}`, body),
  remove: (request, id) => request('DELETE', `/website-integrations/${id}`),
  sync: (request, id) => request('POST', `/website-integrations/${id}/sync`, {}),
  createArticle: (request, body) => request('POST', '/website-articles', body),
  updateArticle: (request, id, body) => request('PATCH', `/website-articles/${id}`, body),
  submit: (request, id) => request('POST', `/website-articles/${id}/submit`, {}),
  approve: (request, id) => request('POST', `/website-articles/${id}/approve`, {}),
  publish: (request, id) => request('POST', `/website-articles/${id}/publish`, {}),
  hide: (request, id) => request('POST', `/website-articles/${id}/hide`, {}),
};
