// Ads layer.
// - In a store/dev build (EAS) it shows real Google AdMob ads via react-native-google-mobile-ads.
// - In Expo Go and on the web (no AdMob native module) it shows a clearly-labelled demo ad, so every
//   ad-gated flow can still be tested end to end.
//
// const ads = useAds();
// const { rewarded } = await ads.showRewarded();   // user watched to the end → grant the reward
// await ads.showInterstitial();                    // between natural breaks (e.g. game questions)
// ads.preloadRewarded('support'); ads.preloadInterstitial();  // load ahead so the show is instant
// showRewarded({ purpose, loadTimeoutMs }) gives up after loadTimeoutMs (default 30 s) → { rewarded: false, error: 'timeout' }
//
// showInterstitial(opts?) — opts: { surface, placement, skipAfterSec, loadTimeoutMs, ignoreCaps }. It
// resolves { shown } and never shows an ad when: Plus member, the admin master switch is off, the app is
// not in the foreground, or the frequency caps (admin "Ads" tab) say it's too soon.
// Every ad reports events (requested / impression / completed / failed / clicked / paid) to the Worker
// via ./remote — impressions only from the SDK's OPENED/impression callbacks, revenue from PAID.
//
// Online mode: `showRewarded({ purpose: 'support' | 'job' })` attaches AdMob server-side verification
// options ({ userId: <Me.id>, customData: purpose }) so Google calls the Worker's /ads/ssv to credit the
// reward. The sync layer sets the user id with `setAdUserId()` once /me has loaded.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';
import { NightGlow } from '../components/ui';
import { Icon } from '../components/Icons';
import { Pulse, ScaleIn } from '../components/Motion';
import { AD_UNITS } from './config';
import { useStore } from '../store';
import {
  capReason, getExtras, getRules, isAppActive, isTestUnit, logAdEvent, recordFullScreenImpression, setPremium, startAdsRemote,
} from './remote';
import { useToast } from '../components/Toast';
import { showMaxInterstitial } from './max'; // AD NETWORKS: backup network (AppLovin MAX), interstitials only
import { pickHouseAd, refreshHouseAds } from './house'; // AD NETWORKS: house ads (our own, last fill)
import { HouseCreative } from './HouseAd';

import GMA from './gma';

const Ctx = createContext(null);

// Server-side verification user (online mode). null in local mode → no SSV options are sent.
let adUserId = null;
export function setAdUserId(id) {
  adUserId = id || null;
}

// Wires the SDK's events for one full-screen ad to our event log. Returns the unsubscribe list.
function listenPaid(ad, meta) {
  return ad.addAdEventListener(GMA.AdEventType.PAID, (p) => {
    if (p && Number.isFinite(Number(p.value))) logAdEvent('paid', { ...meta, value: p.value, currency: p.currency, precision: p.precision });
  });
}

// ---------- preloading (brief 3.1 / 10.1 / 12.1 / 12.2) ----------
// One ad of each full-screen kind can be loaded ahead of time so showing it is instant. A preloaded ad is
// "taken" by the next show call with the same key; AdMob ads expire after ~1 h, so older ones are dropped.
const PRELOAD_MAX_AGE_MS = 50 * 60 * 1000;
const preloaded = { rewarded: null, interstitial: null };

function rewardedRequest(purpose) {
  const request = { requestNonPersonalizedAdsOnly: true };
  if (adUserId && purpose) request.serverSideVerificationOptions = { userId: adUserId, customData: String(purpose) };
  return request;
}
const rewardedKey = (purpose) => `${purpose || ''}|${(purpose && adUserId) || ''}`;

function startPreload(kind, key, create) {
  const cur = preloaded[kind];
  if (cur && cur.key === key && !cur.failed && Date.now() - cur.at < PRELOAD_MAX_AGE_MS) return cur;
  if (cur) cur.dispose();
  let ad;
  try { ad = create(); } catch (e) { return null; }
  const e = { kind, key, ad, at: Date.now(), loaded: false, failed: false };
  const loadedEvt = kind === 'rewarded' ? GMA.RewardedAdEventType.LOADED : GMA.AdEventType.LOADED;
  const subs = [
    ad.addAdEventListener(loadedEvt, () => { e.loaded = true; }),
    ad.addAdEventListener(GMA.AdEventType.ERROR, () => { if (!e.loaded) e.failed = true; }),
  ];
  e.dispose = () => subs.forEach((u) => u && u());
  try { ad.load(); } catch (err) { e.failed = true; }
  preloaded[kind] = e;
  return e;
}

/** Start loading a rewarded ad now so a later showRewarded({ purpose }) opens instantly. Safe to call often. */
export function preloadRewardedAd(purpose) {
  if (!GMA) return;
  startPreload('rewarded', rewardedKey(purpose), () => GMA.RewardedAd.createForAdRequest(AD_UNITS.rewarded, rewardedRequest(purpose)));
}
/** Start loading an interstitial now (e.g. when a detail screen opens) so it's ready when needed. */
export function preloadInterstitialAd() {
  if (!GMA) return;
  startPreload('interstitial', 'i', () => GMA.InterstitialAd.createForAdRequest(AD_UNITS.interstitial, { requestNonPersonalizedAdsOnly: true }));
}
// Takes the preloaded ad (if it matches and is still usable) so nobody else shows it.
function takePreloaded(kind, key) {
  const e = preloaded[kind];
  if (!e || e.key !== key || e.failed || Date.now() - e.at >= PRELOAD_MAX_AGE_MS) return null;
  preloaded[kind] = null;
  return e;
}
// Puts back an ad that was taken but never shown (we gave up waiting) so the next tap can use it.
function putBack(e) {
  if (!e || e.failed) { if (e) e.dispose(); return; }
  if (!preloaded[e.kind]) preloaded[e.kind] = e; else e.dispose();
}

// opts: { purpose, loadTimeoutMs = 30000 } → { rewarded, error? } ; error 'timeout' | 'load' | 'show'
function nativeRewarded(opts = {}) {
  return new Promise((resolve) => {
    let earned = false;
    let opened = false;
    let done = false;
    const meta = { surface: 'rewarded', placement: opts.purpose ? String(opts.purpose) : 'reward', format: 'rewarded', test: isTestUnit(AD_UNITS.rewarded) };
    const pre = takePreloaded('rewarded', rewardedKey(opts.purpose));
    const ad = pre ? pre.ad : GMA.RewardedAd.createForAdRequest(AD_UNITS.rewarded, rewardedRequest(opts.purpose));
    const finish = (r) => {
      if (done) return;
      done = true;
      subs.forEach((u) => u && u());
      if (pre) { if (!opened && r.error === 'timeout') putBack(pre); else pre.dispose(); }
      resolve(r);
    };
    const show = () => { if (!done) ad.show().catch(() => { logAdEvent('failed', meta); finish({ rewarded: false, error: 'show' }); }); };
    const subs = [
      ad.addAdEventListener(GMA.RewardedAdEventType.LOADED, show),
      ad.addAdEventListener(GMA.RewardedAdEventType.EARNED_REWARD, () => { earned = true; logAdEvent('completed', meta); }),
      ad.addAdEventListener(GMA.AdEventType.OPENED, () => {
        opened = true;
        logAdEvent('impression', meta);
        preloadRewardedAd(opts.purpose); // load the next one while this one plays (e.g. "ad 2 of 2")
      }),
      ad.addAdEventListener(GMA.AdEventType.CLICKED, () => logAdEvent('clicked', meta)),
      listenPaid(ad, meta),
      ad.addAdEventListener(GMA.AdEventType.CLOSED, () => finish({ rewarded: earned })),
      ad.addAdEventListener(GMA.AdEventType.ERROR, () => { if (opened || !pre || !pre.loaded) { logAdEvent('failed', meta); finish({ rewarded: false, error: 'load' }); } }),
    ];
    logAdEvent('requested', meta);
    if (pre && pre.loaded) show();
    else if (!pre) ad.load();
    // a preloaded ad that is still loading fires LOADED → show
    setTimeout(() => { if (!opened) { logAdEvent('failed', meta); finish({ rewarded: false, error: 'timeout' }); } }, opts.loadTimeoutMs || 30000);
  });
}

// Loads and shows one interstitial. Gives up (without ever showing it later) if it hasn't opened within
// loadTimeoutMs, or if the app left the foreground meanwhile.
function nativeInterstitial(meta, loadTimeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let opened = false;
    const pre = takePreloaded('interstitial', 'i');
    const finish = (r) => {
      if (done) return;
      done = true;
      subs.forEach((u) => u && u());
      if (pre) { if (!opened && (r.reason === 'timeout' || r.reason === 'background')) putBack(pre); else pre.dispose(); }
      resolve(r);
    };
    const ad = pre ? pre.ad : GMA.InterstitialAd.createForAdRequest(AD_UNITS.interstitial, { requestNonPersonalizedAdsOnly: true });
    const onLoaded = () => {
      if (done) return;
      if (!isAppActive()) { finish({ shown: false, reason: 'background' }); return; }
      ad.show().catch(() => { logAdEvent('failed', meta); finish({ shown: false }); });
    };
    const subs = [
      ad.addAdEventListener(GMA.AdEventType.LOADED, onLoaded),
      ad.addAdEventListener(GMA.AdEventType.OPENED, () => { opened = true; recordFullScreenImpression(); logAdEvent('impression', meta); }),
      ad.addAdEventListener(GMA.AdEventType.CLICKED, () => logAdEvent('clicked', meta)),
      listenPaid(ad, meta),
      ad.addAdEventListener(GMA.AdEventType.CLOSED, () => { if (opened) logAdEvent('completed', meta); finish({ shown: opened }); }),
      ad.addAdEventListener(GMA.AdEventType.ERROR, () => { logAdEvent('failed', meta); finish({ shown: false }); }),
    ];
    logAdEvent('requested', meta);
    if (pre && pre.loaded) onLoaded();
    else if (!pre) ad.load();
    setTimeout(() => { if (!opened && !done) { logAdEvent('failed', meta); finish({ shown: false, reason: 'timeout' }); } }, loadTimeoutMs);
    // safety net: an ad that never reports CLOSED must not hold the caller forever
    setTimeout(() => finish({ shown: opened }), loadTimeoutMs + 180000);
  });
}

export function AdsProvider({ children }) {
  // BibleNestra Plus members get no interstitial (video) ads. Rewarded ads stay: the user chooses them for a reward.
  const { state } = useStore();
  const premiumRef = useRef(false);
  premiumRef.current = !!(state && state.premium);
  setPremium(premiumRef.current);
  const [demo, setDemo] = useState(null); // { kind, total, meta, resolve }
  const [left, setLeft] = useState(0);
  const timer = useRef(null);
  // AD NETWORKS: house ad on screen ({ ad, mode, resolve }) and its countdown
  const [house, setHouse] = useState(null);
  const [houseLeft, setHouseLeft] = useState(0);
  const houseTimer = useRef(null);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    startAdsRemote();
    refreshHouseAds();
    if (GMA && GMA.default) {
      try { GMA.default().initialize(); } catch (e) { /* ignore */ }
    }
  }, []);

  const runDemo = useCallback((kind, secs, meta) => new Promise((resolve) => {
    const total = Math.max(1, Math.round(secs));
    logAdEvent('requested', meta);
    logAdEvent('impression', meta);
    if (kind === 'interstitial') recordFullScreenImpression();
    setLeft(total);
    setDemo({ kind, total, meta, resolve });
    clearInterval(timer.current);
    timer.current = setInterval(() => setLeft((s) => (s <= 1 ? (clearInterval(timer.current), 0) : s - 1)), 1000);
  }), []);

  const closeDemo = (completed) => {
    clearInterval(timer.current);
    if (demo) {
      if (completed) logAdEvent('completed', demo.meta);
      demo.resolve(demo.kind === 'rewarded' ? { rewarded: completed, demo: true } : { shown: true, demo: true });
    }
    setDemo(null);
  };

  // House ad on screen. Interstitial: counts as a shown break. Rewarded: a countdown and "no reward" (house ads never grant).
  const showHouse = useCallback((mode, placement) => new Promise((resolve) => {
    // resolves at once with null when there is no house ad to show (the caller then reports no fill)
    pickHouseAd({ preferImage: mode === 'interstitial' }).then((ad) => {
      if (!ad) { resolve(null); return; }
      const secs = mode === 'rewarded' ? 5 : Math.max(0, Number(getExtras().houseSkipAfterSec) || 0);
      setHouseLeft(secs);
      setHouse({ ad, mode, resolve });
      clearInterval(houseTimer.current);
      if (secs > 0) houseTimer.current = setInterval(() => setHouseLeft((s) => (s <= 1 ? (clearInterval(houseTimer.current), 0) : s - 1)), 1000);
      if (mode !== 'rewarded') recordFullScreenImpression(); // a house interstitial counts toward the frequency caps
      logAdEvent('impression', { surface: 'other', placement: `house_${placement || mode}`, format: mode === 'rewarded' ? 'rewarded' : 'interstitial', test: false });
    });
  }), []);

  const closeHouse = () => {
    clearInterval(houseTimer.current);
    if (house) house.resolve(house.mode === 'rewarded' ? { rewarded: false, house: true, error: 'no_fill' } : { shown: true, house: true });
    setHouse(null);
  };

  // One full-screen ad at a time: a call that arrives while another chain is running gets { busy: true } at once.
  const exclusive = useRef(false);
  const runExclusive = async (fn) => {
    if (exclusive.current) return { busy: true, shown: false, rewarded: false, reason: 'busy', error: 'busy' };
    exclusive.current = true;
    try { return await fn(); } finally { exclusive.current = false; }
  };

  // Rewarded chain: AdMob → house ad (a countdown, never a reward). Rewards come only from AdMob's server verification.
  const showRewarded = useCallback((opts) => runExclusive(async () => {
    if (!GMA) return runDemo('rewarded', 6, { surface: 'rewarded', placement: (opts && opts.purpose) || 'reward', format: 'rewarded', test: true });
    const r = await nativeRewarded(opts || {});
    if (r.rewarded || (r.error !== 'load' && r.error !== 'timeout')) return r; // watched, or the user stopped: no fallback
    const h = await showHouse('rewarded', (opts && opts.purpose) || 'reward');
    if (h) return h;
    if (toastRef.current) toastRef.current.show('No video available right now — try again later', { tone: 'error' });
    return { rewarded: false, error: 'no_fill' };
  }), [showHouse, runDemo]);

  // Interstitial chain: AdMob → backup network → house ad. Each step runs only when the one before had no fill.
  const showInterstitial = useCallback((opts = {}) => runExclusive(async () => {
    try {
      if (premiumRef.current) return { shown: false, premium: true };
      if (!getRules().enabled) return { shown: false, reason: 'off' };
      if (!isAppActive()) return { shown: false, reason: 'background' };
      if (!opts.ignoreCaps) { const why = capReason(); if (why) return { shown: false, reason: why }; }
      const meta = { surface: opts.surface || 'other', placement: opts.placement || 'break', format: 'interstitial', test: !GMA || isTestUnit(AD_UNITS.interstitial) };
      if (!GMA) return await runDemo('interstitial', opts.skipAfterSec != null ? opts.skipAfterSec : 4, meta);
      const r = await nativeInterstitial(meta, opts.loadTimeoutMs || 20000);
      if (r.shown || (r.reason && r.reason !== 'timeout')) return r; // shown, or background: no fallback
      const m = await showMaxInterstitial(8000);
      if (m.shown) return { shown: true, network: 'applovin' };
      const h = await showHouse('interstitial', opts.placement);
      return h || { shown: false, reason: 'no_fill' };
    } catch (e) {
      return { shown: false, error: 'internal' };
    }
  }), [showHouse, runDemo]);

  const total = demo ? demo.total : 1;
  const houseTotal = house ? (house.mode === 'rewarded' ? 5 : Math.max(1, Number(getExtras().houseSkipAfterSec) || 1)) : 1;
  return (
    <Ctx.Provider value={{ showRewarded, showInterstitial, preloadRewarded: preloadRewardedAd, preloadInterstitial: preloadInterstitialAd, isDemo: !GMA }}>
      {children}
      <Modal visible={!!house} animationType="fade" transparent={false} onRequestClose={() => houseLeft === 0 && closeHouse()} statusBarTranslucent>
        <View style={styles.wrap}>
          <NightGlow intensity={1.2} />
          <View style={styles.top}>
            <View style={styles.sponsored}><Text style={styles.sponsoredText}>Sponsored</Text></View>
            {houseLeft > 0 ? (
              <View style={styles.countdown}><Text style={styles.countdownText}>{house && house.mode === 'rewarded' ? `Closes in ${houseLeft}s` : `Skip in ${houseLeft}s`}</Text></View>
            ) : (
              <Pressable onPress={closeHouse} style={styles.closeBtn} accessibilityLabel="Close ad">
                <Icon name="x" size={18} color={colors.nightFg} strokeWidth={2.4} />
              </Pressable>
            )}
          </View>
          <View style={styles.houseBody}>
            {house && house.mode === 'rewarded' ? (
              <Text style={styles.noFill}>No video available right now — try again later</Text>
            ) : null}
            <HouseCreative ad={house ? house.ad : null} large />
            {house && house.mode === 'rewarded' ? (
              <Text style={styles.noRewardNote}>This is a BibleNestra offer, so it does not earn a reward.</Text>
            ) : null}
          </View>
          {houseLeft === 0 ? (
            <ScaleIn style={{ paddingHorizontal: 24, paddingBottom: 40 }}>
              <Pressable onPress={closeHouse} style={styles.cta}>
                <Text style={styles.ctaText}>Continue</Text>
              </Pressable>
            </ScaleIn>
          ) : (
            <View style={styles.track}><View style={[styles.fill, { width: `${((houseTotal - houseLeft) / houseTotal) * 100}%` }]} /></View>
          )}
        </View>
      </Modal>
      <Modal visible={!!demo} animationType="fade" transparent={false} onRequestClose={() => left === 0 && closeDemo(true)} statusBarTranslucent>
        <View style={styles.wrap}>
          <NightGlow intensity={1.2} />
          <View style={styles.top}>
            <View style={styles.sponsored}><Text style={styles.sponsoredText}>Sponsored · demo ad</Text></View>
            {left > 0 ? (
              <View style={styles.countdown}><Text style={styles.countdownText}>{demo && demo.kind === 'rewarded' ? `Reward in ${left}s` : `Skip in ${left}s`}</Text></View>
            ) : (
              <Pressable onPress={() => closeDemo(true)} style={styles.closeBtn} accessibilityLabel="Close ad">
                <Icon name="x" size={18} color={colors.nightFg} strokeWidth={2.4} />
              </Pressable>
            )}
          </View>
          <View style={styles.body}>
            <Pulse min={0.95} max={1.05}><View style={styles.adMark}><Icon name="play" size={34} color={colors.night} fill="solid" /></View></Pulse>
            <Text style={styles.title}>Your ad plays here</Text>
            <Text style={styles.sub}>Real video ads from Google AdMob appear in the published app. This placeholder lets you test the flow in Expo Go.</Text>
          </View>
          {left === 0 ? (
            <ScaleIn style={{ paddingHorizontal: 24, paddingBottom: 40 }}>
              <Pressable onPress={() => closeDemo(true)} style={styles.cta}>
                <Text style={styles.ctaText}>{demo && demo.kind === 'rewarded' ? 'Claim & continue' : 'Continue'}</Text>
              </Pressable>
            </ScaleIn>
          ) : (
            <View style={styles.track}><View style={[styles.fill, { width: `${((total - left) / total) * 100}%` }]} /></View>
          )}
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

export function useAds() {
  return useContext(Ctx) || {
    showRewarded: async () => ({ rewarded: true, demo: true }),
    showInterstitial: async () => ({ shown: false }),
    preloadRewarded: () => {},
    preloadInterstitial: () => {},
    isDemo: true,
  };
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.night, paddingTop: 54 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  sponsored: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)' },
  sponsoredText: { fontSize: 11, fontWeight: '700', color: colors.nightMuted, letterSpacing: 0.6 },
  countdown: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)' },
  countdownText: { fontSize: 12, fontWeight: '700', color: colors.nightFg },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  adMark: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.nightFg, marginTop: 24, textAlign: 'center' },
  sub: { fontSize: 14, lineHeight: 20, color: colors.nightMuted, marginTop: 10, textAlign: 'center' },
  track: { height: 4, marginHorizontal: 24, marginBottom: 48, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.goldLight },
  cta: { height: 54, borderRadius: 27, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: colors.night, fontSize: 16, fontWeight: '800' },
  houseBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  noFill: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.nightFg, textAlign: 'center', marginBottom: 16 },
  noRewardNote: { fontSize: 12, color: colors.nightMuted, textAlign: 'center', marginTop: 14 },
});
