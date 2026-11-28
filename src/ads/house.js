// House ads: BibleNestra's own sponsored ads (admin Ads tab → Worker GET /ads/house). They are the last fill, after AdMob
// and the backup network. Always shown with a "Sponsored" label; a tap opens the admin's link (http/https only).
// They never grant coins or unlocks: rewarded spots that only have a house ad show "No video available right now".
import { Linking } from 'react-native';
import { API_CONFIG } from '../api/config';

const CACHE_MS = 10 * 60 * 1000;
let ads = [];
let fetchedAt = 0;
let inflight = null;

const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

export const isWebLink = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

/** Refreshes the active house ads (cached ~10 min). Never throws; offline keeps the last list. */
export function refreshHouseAds({ force = false } = {}) {
  if (!API_CONFIG.apiUrl) return Promise.resolve(ads);
  if (!force && Date.now() - fetchedAt < CACHE_MS) return Promise.resolve(ads);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
      const res = await fetch(`${API_CONFIG.apiUrl}/ads/house`, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
      if (t) clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.ads)) {
          ads = data.ads.filter((a) => a && a.id && a.linkUrl && isWebLink(a.linkUrl));
          fetchedAt = Date.now();
        }
      }
    } catch (e) { /* offline: keep the last list */ }
    inflight = null;
    return ads;
  })();
  return inflight;
}

/** A random active house ad (image ads preferred when `preferImage`), or null when there are none. */
export async function pickHouseAd({ preferImage = false } = {}) {
  await refreshHouseAds();
  if (!ads.length) return null;
  const pool = preferImage && ads.some((a) => a.imageUrl) ? ads.filter((a) => a.imageUrl) : ads;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Counts one impression or click on the server. Fire and forget. */
export function trackHouse(ad, type) {
  if (!ad || !ad.id || !API_CONFIG.apiUrl) return;
  safe(() => fetch(`${API_CONFIG.apiUrl}/ads/house/${encodeURIComponent(ad.id)}/${type === 'click' ? 'click' : 'impression'}`, { method: 'POST' }).catch(() => {}));
}

/** Opens the admin's link (http/https only) and counts the click. */
export function openHouseAd(ad) {
  if (!ad || !isWebLink(ad.linkUrl)) return;
  trackHouse(ad, 'click');
  safe(() => Linking.openURL(ad.linkUrl.trim()).catch(() => {}));
}
