// Remote ad rules, frequency caps and ad event logging (module state shared by Ads.js, AdBreaks.js, AdSlots.js).
//
// - Rules: GET /ads/config (public). Cached in AsyncStorage (localStorage on web); refreshed every ~10 min
//   while the app is open and when it comes back to the foreground. Falls back to built-in defaults.
// - Caps: impression times of full-screen ads, persisted, checked before every ad break.
// - Events: queued and sent in batches to POST /ads/events (signed in) through the transport that
//   <AdsBridge/> registers. Only SDK callbacks produce 'impression'/'paid' events — never a request.
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_CONFIG } from '../api/config';
import { AD_RULES } from './config';
import { DEFAULT_RULES, capBlock, mergeRules } from './rules';
import { mergeBreakRules } from './breaksPolicy';

const RULES_KEY = 'bn.ads.rules.v1';
const CAPS_KEY = 'bn.ads.caps.v1';
const REFRESH_MS = 8 * 60 * 1000; // + up to ~2 min of server/HTTP caching = changes arrive within ~10 min
const FOREGROUND_REFRESH_MS = 2 * 60 * 1000;
const FLUSH_MS = 30 * 1000;
const MAX_QUEUE = 200;
const GOOGLE_TEST_PUBLISHER = 'ca-app-pub-3940256099942544';

let rules = mergeRules(DEFAULT_RULES);
let breakRules = mergeBreakRules({}); // interstitial breaks (GET /ads/config → breaks)
let rulesVersion = 0;
let fetchedAt = 0;
let fetching = null;
let premium = false;
let transport = null; // (method, path, body) => Promise
let queue = [];
let capHistory = [];
const listeners = new Set();

const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

function applyRules(next, version) {
  rules = mergeRules(next);
  rulesVersion = version || 0;
  // the Socials feed reads AD_RULES.feedAdEvery while rendering — keep it in step with the remote rules
  safe(() => { AD_RULES.feedAdEvery = rules.feed.every; });
  listeners.forEach((l) => safe(() => l(rules)));
}

export const getRules = () => rules;
export const getBreakRules = () => breakRules;
export const getRulesVersion = () => rulesVersion;
export const isPremium = () => premium;
export function setPremium(p) { premium = !!p; }
export function subscribeRules(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const isAppActive = () => {
  const s = safe(() => AppState.currentState);
  return s === undefined || s === null || s === 'active';
};

// ---------- rules ----------
export function refreshRules({ force = false } = {}) {
  if (!API_CONFIG.apiUrl) return Promise.resolve(rules);
  if (!force && Date.now() - fetchedAt < REFRESH_MS) return Promise.resolve(rules);
  if (fetching) return fetching;
  fetching = (async () => {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
      const res = await fetch(`${API_CONFIG.apiUrl}/ads/config`, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
      if (t) clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        if (data && data.config) {
          applyRules(data.config, data.version);
          if (data.breaks) breakRules = mergeBreakRules(data.breaks);
          fetchedAt = Date.now();
          safe(() => AsyncStorage.setItem(RULES_KEY, JSON.stringify({ version: data.version, config: data.config, breaks: data.breaks || null, at: fetchedAt })).catch(() => {}));
        }
      }
    } catch (e) { /* offline: keep cached/default rules */ }
    fetching = null;
    return rules;
  })();
  return fetching;
}

// ---------- caps ----------
export const capReason = () => capBlock(rules, capHistory);
export function recordFullScreenImpression() {
  const now = Date.now();
  capHistory = capHistory.filter((t) => now - t < 86400000).concat(now);
  safe(() => AsyncStorage.setItem(CAPS_KEY, JSON.stringify(capHistory)).catch(() => {}));
}

// ---------- events ----------
export const isTestUnit = (unitId) => !unitId || String(unitId).startsWith(GOOGLE_TEST_PUBLISHER) || String(unitId).startsWith('test-');

/** logAdEvent('impression', { surface, placement, format, test, value?, currency?, precision? }) */
export function logAdEvent(type, meta = {}) {
  safe(() => {
    const e = { type, surface: meta.surface || 'other', placement: meta.placement || 'other', format: meta.format, test: !!meta.test };
    if (type === 'paid') { e.value = Number(meta.value) || 0; e.currency = meta.currency || 'USD'; e.precision = meta.precision; }
    queue.push(e);
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= 20) flushEvents();
  });
}

let flushing = false;
export async function flushEvents() {
  if (flushing || !transport || !queue.length) return;
  flushing = true;
  const batch = queue.slice(0, 50);
  queue = queue.slice(50);
  try {
    await transport('POST', '/ads/events', { events: batch });
  } catch (e) {
    // network trouble: put them back once (bounded); a refusal (4xx) drops them
    if (e && e.code === 'NETWORK') queue = batch.concat(queue).slice(0, MAX_QUEUE);
  }
  flushing = false;
}

export function setAdsTransport(fn) {
  transport = typeof fn === 'function' ? fn : null;
  if (transport) flushEvents();
}

// ---------- start-up ----------
let started = false;
export function startAdsRemote() {
  if (started) return;
  started = true;
  safe(() => AsyncStorage.getItem(RULES_KEY).then((raw) => {
    const c = raw ? JSON.parse(raw) : null;
    if (c && c.config && !fetchedAt) applyRules(c.config, c.version);
    if (c && c.breaks && !fetchedAt) breakRules = mergeBreakRules(c.breaks);
  }).catch(() => {}));
  safe(() => AsyncStorage.getItem(CAPS_KEY).then((raw) => {
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) capHistory = list.filter((t) => typeof t === 'number').concat(capHistory);
  }).catch(() => {}));
  refreshRules({ force: true });
  setInterval(() => { if (isAppActive()) refreshRules(); flushEvents(); }, FLUSH_MS);
  safe(() => AppState.addEventListener('change', (s) => {
    if (s === 'active') { if (Date.now() - fetchedAt > FOREGROUND_REFRESH_MS) refreshRules({ force: true }); }
    else flushEvents();
  }));
}
