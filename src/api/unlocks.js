// FEATURE UNLOCKS (online mode): timed access bought with Kingdom Coins or earned by rewarded ads.
// Server: backend/src/routes/featureUnlocks.js + lib/featureUnlocks.js.
//   useUnlocks()                         GET /unlocks → { coins, catalogue, active, loaded, error, reload }
//   unlockFeature(api, feature)          POST /unlocks/:feature (Idempotency-Key sent) → { coins, unlock, catalogue, active }
//   creditUnlockAd(api, feature)         one rewarded ad for a feature. Dev builds claim it at once; in production the
//                                        server credits it through AdMob SSV, so this waits and re-reads /unlocks.
//   unlocksChanged()                     every useUnlocks() reloads (after a purchase or an ad)
// Only the server decides whether a feature is unlocked: the app never stores or extends an unlock itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';
import { errorMessage } from './client';

const subs = new Set();
let version = 0;
export function unlocksChanged() { version += 1; subs.forEach((f) => { try { f(version); } catch (e) { /* ignore */ } }); }
function useVersion() {
  const [v, set] = useState(version);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return v;
}

let memo = null; // last good answer, so the sheet opens with something on screen

/** Coins, the catalogue (cost, duration, ad progress, status) and the active unlocks. */
export function useUnlocks() {
  const api = useApi();
  const v = useVersion();
  const [data, setData] = useState(memo);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(!!memo);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    if (!api.online) { setLoaded(true); return null; }
    try {
      const d = await api.request('GET', '/unlocks');
      memo = d;
      if (alive.current) { setData(d); setError(null); }
      return d;
    } catch (e) {
      if (alive.current) setError(e);
      return null;
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [api.online]);
  useEffect(() => { load(); }, [load, v]);
  return { data, error, loaded, reload: load, online: api.online, coins: data ? data.coins : 0 };
}

export const newUnlockKey = () => `uk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

/** Spend coins on a feature. Pass the same key again after a network failure: the server charges once. */
export async function unlockFeature(api, feature, key = newUnlockKey()) {
  const out = await api.request('POST', `/unlocks/${encodeURIComponent(feature)}`, undefined, { headers: { 'Idempotency-Key': key } });
  unlocksChanged();
  memo = { ...(memo || {}), coins: out.coins, catalogue: out.catalogue, active: out.active };
  return out;
}

/**
 * Credits one watched rewarded ad for a feature. Returns { adsWatched, adsNeeded, credited }.
 * A dev server accepts /ads/claim straight away. In production /ads/claim is refused (SSV_REQUIRED): AdMob calls the
 * server, so we re-read /unlocks for a short while until the ad count moves.
 */
export async function creditUnlockAd(api, feature) {
  const purpose = `unlock:${feature}`;
  const before = await api.request('GET', '/unlocks');
  const was = (before.catalogue[feature] || {}).adsWatched || 0;
  try {
    const r = await api.request('POST', '/ads/claim', { purpose });
    unlocksChanged();
    const ad = r.unlockAd || {};
    return { adsWatched: ad.adsWatched ?? was, adsNeeded: ad.adsNeeded ?? (before.catalogue[feature] || {}).adsNeeded, credited: !!ad.credited };
  } catch (e) {
    if (!e || e.code !== 'SSV_REQUIRED') throw e;
  }
  for (let i = 0; i < 8; i += 1) {
    await new Promise((res) => setTimeout(res, 1500));
    const now = await api.request('GET', '/unlocks');
    const cur = now.catalogue[feature] || {};
    if ((cur.adsWatched || 0) !== was) { unlocksChanged(); memo = now; return { adsWatched: cur.adsWatched, adsNeeded: cur.adsNeeded, credited: true }; }
  }
  return { adsWatched: was, adsNeeded: (before.catalogue[feature] || {}).adsNeeded, credited: false };
}

export const unlockError = (e, fallback) => {
  if (e && e.code === 'INSUFFICIENT_COINS') return e.message || 'Not enough coins yet';
  return errorMessage(e, fallback);
};
