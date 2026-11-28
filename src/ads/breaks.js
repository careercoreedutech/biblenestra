// Interstitial breaks (the app side). The rules are in breaksPolicy.js (pure), the numbers come from the server
// (GET /ads/config → breaks, registerConfig 'ad_breaks').
//
// 1. Active-use break: foreground time is counted (AppState 'active' only, and not while the device sleeps). When
//    `activeMinutes` have passed, one interstitial plays. It is held back while the top screen is reading, recording,
//    prayer, a call, video or checkout (isBlockedRoute); it plays as soon as the user leaves that screen.
//    The count restarts after a break is shown. If no ad loads, the app retries in a few minutes and never in a loop.
// 2. 66 Books: showBookListAd() before the Bible book list opens. The first time it always plays (it ignores only the
//    minimum gap); later visits follow the same caps. It returns quickly when nothing is ready, so the list still opens.
//
// Both use the ad layer's showInterstitial (src/ads/Ads.js), which already honours the master switch, Plus, and the
// admin caps (remote.js capReason). Breaks are never shown to Plus members.
import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBreakRules, getRules, isAppActive, isPremium } from './remote';
import { breakBlock, isBlockedRoute, nextBreakAt } from './breaksPolicy';

const HIST_KEY = 'bn.ads.breaks.v1';
const BOOK_SEEN_KEY = 'bn.ads.booklist.seen.v1';
const TICK_MS = 5000;
const MAX_TICK_GAP_MS = 30000; // a longer gap means the device slept: that time is not active use
const RETRY_MS = 3 * 60 * 1000; // no ad was shown: try again in a few minutes
const DAY_MS = 24 * 60 * 60 * 1000;

const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

let history = []; // times (ms) of breaks shown, last 24 h (persisted)
let historyLoaded = false;
let activeMs = 0; // foreground time since the last break
let pending = false; // an interstitial is on screen or being loaded
let retryAt = 0;
let show = null; // showInterstitial from <AdsProvider/>

function loadHistory() {
  if (historyLoaded) return;
  historyLoaded = true;
  safe(() => AsyncStorage.getItem(HIST_KEY).then((raw) => {
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) history = list.filter((t) => typeof t === 'number').concat(history);
  }).catch(() => {}));
}

function remember(now) {
  history = history.filter((t) => now - t < DAY_MS).concat(now);
  safe(() => AsyncStorage.setItem(HIST_KEY, JSON.stringify(history)).catch(() => {}));
}

const policyOpts = () => ({ premium: isPremium(), adsEnabled: getRules().enabled });

async function runBreak(now) {
  pending = true;
  try {
    const rules = getBreakRules();
    const why = breakBlock(rules, { history }, now, policyOpts());
    if (why === 'premium' || why === 'off') { activeMs = 0; return; }
    if (why) { retryAt = nextBreakAt(rules, { history }, now); return; }
    const r = await show({ surface: 'other', placement: 'active_break', loadTimeoutMs: 15000 });
    if (r && r.shown) { activeMs = 0; retryAt = 0; remember(Date.now()); }
    else retryAt = Date.now() + RETRY_MS;
  } catch (e) {
    retryAt = Date.now() + RETRY_MS;
  } finally {
    pending = false;
  }
}

/**
 * Mount once at the app root. `routeName` is the top screen's name (or the tab when no screen is pushed).
 * `showInterstitial` comes from useAds().
 */
export function useAdBreaks(routeName, showInterstitial) {
  const routeRef = useRef(routeName);
  routeRef.current = routeName;
  useEffect(() => { show = typeof showInterstitial === 'function' ? showInterstitial : null; }, [showInterstitial]);

  useEffect(() => {
    loadHistory();
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      const gap = now - last;
      last = now;
      const rules = getBreakRules();
      if (!rules.enabled) { activeMs = 0; return; }
      if (!pending && gap > 0 && gap <= MAX_TICK_GAP_MS && isAppActive()) activeMs += gap;
      if (activeMs < rules.activeMinutes * 60 * 1000) return;
      if (pending || now < retryAt || !show || !isAppActive()) return;
      if (isBlockedRoute(routeRef.current)) return; // deferred: plays when the user leaves that screen
      runBreak(now);
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);
}

async function bookListSeen() {
  try { return (await AsyncStorage.getItem(BOOK_SEEN_KEY)) === '1'; } catch (e) { return false; }
}

/**
 * One interstitial before the 66 Books list opens. Resolves { shown, reason? } and never throws.
 * Called by BibleHomeScreen; reading screens never call it.
 */
export async function showBookListAd() {
  if (!show) return { shown: false, reason: 'no_ads' };
  if (pending) return { shown: false, reason: 'busy' };
  const rules = getBreakRules();
  const seen = await bookListSeen();
  const firstTime = !seen && rules.bookListFirstOpen;
  const now = Date.now();
  let why = breakBlock(rules, { history }, now, policyOpts());
  if (firstTime && why === 'too_soon') why = null; // the first time ignores only the minimum gap
  if (why) return { shown: false, reason: why };
  pending = true;
  try {
    const r = await show({ surface: 'other', placement: 'books66', loadTimeoutMs: 8000 });
    if (r && r.shown) {
      remember(Date.now());
      safe(() => AsyncStorage.setItem(BOOK_SEEN_KEY, '1').catch(() => {}));
    }
    return r || { shown: false };
  } catch (e) {
    return { shown: false, reason: 'error' };
  } finally {
    pending = false;
  }
}
