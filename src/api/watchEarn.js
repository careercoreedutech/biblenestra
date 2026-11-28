// WATCH & EARN (dev update v1): watch a rewarded ad, earn Kingdom Coins.
// Server: backend/src/routes/rewards.js (GET /earn/status, purpose 'earn') + backend/src/lib/watchEarn.js.
//   useEarnStatus()        GET /earn/status → { enabled, adsToday, dailyAds, adsLeftToday, canWatch, coinsToday, coins,
//                          nextReward, streak, config, day, resetsAt }. Re-read after every ad.
//   creditEarnAd(api)      one watched ad. Dev builds claim it at once (POST /ads/claim). In production the server
//                          credits it through AdMob SSV, so this polls /earn/status for a short while.
// Only the server decides the coins. The app never adds to the balance itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './auth';

let memo = null; // last good answer, so the screen opens with something on screen

/** The Watch & Earn status, with a reload function. */
export function useEarnStatus() {
  const api = useApi();
  const [data, setData] = useState(memo);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(!!memo);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    if (!api.online) { setLoaded(true); return null; }
    try {
      const d = await api.request('GET', '/earn/status');
      memo = d;
      if (alive.current) { setData(d); setError(null); }
      return d;
    } catch (e) {
      if (alive.current) setError(e);
      return null;
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [api.online]); // same deps as useUnlocks: api is re-created on render, so depending on it would reload forever
  useEffect(() => { load(); }, [load]);
  return { data, error, loaded, reload: load, online: api.online };
}

/**
 * Credits one watched rewarded ad. `before` is the status the screen held when the ad was requested
 * ({ day, adsToday, coinsToday }). Returns { credited, coinsEarned, bonus, capped, duplicate, status }; `status` is the
 * fresh /earn/status from the server, not an estimate.
 */
export async function creditEarnAd(api, before = {}) {
  const was = { day: before.day, adsToday: before.adsToday || 0, coinsToday: before.coinsToday || 0 };
  try {
    const r = await api.request('POST', '/ads/claim', { purpose: 'earn' });
    const e = r.earn || {};
    const status = await api.request('GET', '/earn/status');
    memo = status;
    return { credited: !!e.credited, coinsEarned: e.coinsEarned || 0, bonus: e.bonus || null, capped: !!e.capped, duplicate: !!e.duplicate, status };
  } catch (e) {
    if (!e || e.code !== 'SSV_REQUIRED') throw e;
  }
  // Production: AdMob calls /ads/ssv, usually before the ad closes. Check now, then poll for a short while.
  const moved = (st) => st.day !== was.day || (st.adsToday || 0) !== was.adsToday;
  for (let i = 0; ; i += 1) {
    if (i > 0) await new Promise((res) => setTimeout(res, 1500));
    const now = await api.request('GET', '/earn/status');
    memo = now;
    if (moved(now)) {
      const base = now.day === was.day ? was.coinsToday : 0;
      const gained = Math.max(0, (now.coinsToday || 0) - base);
      const perAd = now.nextReward ? now.nextReward.coins : 0;
      return { credited: true, coinsEarned: perAd, bonus: gained > perAd ? { coins: gained - perAd } : null, capped: false, duplicate: false, status: now };
    }
    if (i >= 8) return { credited: false, coinsEarned: 0, bonus: null, capped: (now.adsLeftToday || 0) <= 0, duplicate: false, status: now };
  }
}
