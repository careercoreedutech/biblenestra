// YouTube "Watch" — curated channels from the API (public routes; admins add them at /admin).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';
import { errorMessage } from './client';

const cache = { channels: null, at: 0, videos: new Map() }; // in-memory, per app session
const FRESH_MS = 5 * 60 * 1000;

export function useYouTubeChannels() {
  const api = useApi();
  const [items, setItems] = useState(api.online ? cache.channels : []);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async (force) => {
    if (!api.online) { setItems([]); return; }
    if (!force && cache.channels && Date.now() - cache.at < FRESH_MS) { setItems(cache.channels); return; }
    try {
      const r = await api.request('GET', '/youtube/channels');
      cache.channels = r.items || []; cache.at = Date.now();
      if (alive.current) { setItems(cache.channels); setError(null); }
    } catch (e) {
      if (alive.current) { setError(errorMessage(e, 'Couldn’t load channels')); setItems((x) => x || []); }
    }
  }, [api.online]);
  useEffect(() => { load(); }, [load]);
  return { items, error, reload: () => load(true), online: api.online };
}

export function useChannelVideos(channelId) {
  const api = useApi();
  const hit = cache.videos.get(channelId);
  const [data, setData] = useState(hit && Date.now() - hit.at < FRESH_MS ? hit.data : null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    if (!api.online || !channelId) return;
    setError(null);
    try {
      const r = await api.request('GET', `/youtube/channels/${channelId}/videos`);
      cache.videos.set(channelId, { at: Date.now(), data: r });
      setData(r);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load videos')); }
  }, [api.online, channelId]);
  useEffect(() => {
    const h = cache.videos.get(channelId);
    if (h && Date.now() - h.at < FRESH_MS) setData(h.data); else load();
  }, [channelId]);
  return { data, error, reload: load };
}

export const relDate = (iso) => {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  if (d < 30) return `${Math.floor(d / 7)} wk${Math.floor(d / 7) > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
};
export const views = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M views` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K views` : `${n} views`);
