// TODAY'S JOURNEY + WATCH ON TODAY — public endpoints, cached in memory and on the device (AsyncStorage /
// localStorage on web) so the Today cards render instantly with the last known content, then refresh quietly.
//   useDailyToday()      GET /daily/today   → { date, bread|null, video|null, videoCount, flags: { autoHighlight } }
//   useBlessingVideos()  GET /daily/videos  → { items }
//   useLatestVideos()    GET /youtube/latest → { items, groups, fetchedAt }
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApi } from './auth';
import { errorMessage } from './client';

const PREFIX = 'bn.today.';
const mem = new Map(); // key → { at, data }
const safe = (fn) => { try { return fn(); } catch (e) { return null; } };

export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function readStored(key) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function store(key, entry) {
  mem.set(key, entry);
  safe(() => AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry)).catch(() => {}));
}

/** Cached GET: memory → device → network (only when older than freshMs). Keeps showing stale data on errors. */
function useCachedGet(key, path, freshMs, valid = () => true) {
  const api = useApi();
  const memHit = mem.get(key);
  const hit = memHit && valid(memHit.data) ? memHit : null;
  const [data, setData] = useState(hit ? hit.data : null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(!!hit);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async (force) => {
    if (!api.online) { if (alive.current) setLoaded(true); return; }
    let cur = mem.get(key);
    if (!cur) {
      cur = await readStored(key);
      if (cur) mem.set(key, cur);
    }
    if (cur && !valid(cur.data)) cur = null;
    if (cur && alive.current) { setData(cur.data); setLoaded(true); }
    if (!force && cur && Date.now() - cur.at < freshMs) { if (alive.current) setLoaded(true); return; }
    try {
      const r = await api.request('GET', path);
      store(key, { at: Date.now(), data: r });
      if (alive.current) { setData(r); setError(null); }
    } catch (e) {
      if (alive.current) setError(errorMessage(e, 'Couldn’t load'));
    }
    if (alive.current) setLoaded(true);
  }, [api.online, key, path]);
  useEffect(() => { load(false); }, [load]);
  return { data, error, loaded, online: api.online, reload: () => load(true) };
}

export function useDailyToday() {
  const date = localDate();
  return useCachedGet('daily', `/daily/today?date=${date}`, 5 * 60 * 1000, (d) => !!d && d.date === date);
}

export function useBlessingVideos() {
  const date = localDate();
  return useCachedGet('videos', `/daily/videos?date=${date}`, 5 * 60 * 1000, (d) => !!d && d.date === date);
}

export function useLatestVideos() {
  return useCachedGet('ytlatest', '/youtube/latest?limit=20', 10 * 60 * 1000);
}
