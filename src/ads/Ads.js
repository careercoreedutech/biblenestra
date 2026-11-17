// Ads layer.
// - In a store/dev build (EAS) it shows real Google AdMob ads via react-native-google-mobile-ads.
// - In Expo Go and on the web (no AdMob native module) it shows a clearly-labelled demo ad, so every
//   ad-gated flow can still be tested end to end.
//
// const ads = useAds();
// const { rewarded } = await ads.showRewarded();   // user watched to the end → grant the reward
// await ads.showInterstitial();                    // between natural breaks (e.g. game questions)
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
  capReason, getRules, isAppActive, isTestUnit, logAdEvent, recordFullScreenImpression, setPremium, startAdsRemote,
} from './remote';

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

function nativeRewarded(opts = {}) {
  return new Promise((resolve) => {
    let earned = false;
    let opened = false;
    let done = false;
    const meta = { surface: 'rewarded', placement: opts.purpose ? String(opts.purpose) : 'reward', format: 'rewarded', test: isTestUnit(AD_UNITS.rewarded) };
    const finish = (r) => { if (!done) { done = true; subs.forEach((u) => u && u()); resolve(r); } };
    const request = { requestNonPersonalizedAdsOnly: true };
    if (adUserId && opts.purpose) {
      request.serverSideVerificationOptions = { userId: adUserId, customData: String(opts.purpose) };
    }
    const ad = GMA.RewardedAd.createForAdRequest(AD_UNITS.rewarded, request);
    const subs = [
      ad.addAdEventListener(GMA.RewardedAdEventType.LOADED, () => ad.show().catch(() => { logAdEvent('failed', meta); finish({ rewarded: false, error: 'show' }); })),
      ad.addAdEventListener(GMA.RewardedAdEventType.EARNED_REWARD, () => { earned = true; logAdEvent('completed', meta); }),
      ad.addAdEventListener(GMA.AdEventType.OPENED, () => { opened = true; logAdEvent('impression', meta); }),
      ad.addAdEventListener(GMA.AdEventType.CLICKED, () => logAdEvent('clicked', meta)),
      listenPaid(ad, meta),
      ad.addAdEventListener(GMA.AdEventType.CLOSED, () => finish({ rewarded: earned })),
      ad.addAdEventListener(GMA.AdEventType.ERROR, () => { logAdEvent('failed', meta); finish({ rewarded: false, error: 'load' }); }),
    ];
    logAdEvent('requested', meta);
    ad.load();
    setTimeout(() => { if (!opened) { logAdEvent('failed', meta); finish({ rewarded: false, error: 'timeout' }); } }, 30000);
  });
}

// Loads and shows one interstitial. Gives up (without ever showing it later) if it hasn't opened within
// loadTimeoutMs, or if the app left the foreground meanwhile.
function nativeInterstitial(meta, loadTimeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let opened = false;
    const finish = (r) => { if (!done) { done = true; subs.forEach((u) => u && u()); resolve(r); } };
    const ad = GMA.InterstitialAd.createForAdRequest(AD_UNITS.interstitial, { requestNonPersonalizedAdsOnly: true });
    const subs = [
      ad.addAdEventListener(GMA.AdEventType.LOADED, () => {
        if (done) return;
        if (!isAppActive()) { finish({ shown: false, reason: 'background' }); return; }
        ad.show().catch(() => { logAdEvent('failed', meta); finish({ shown: false }); });
      }),
      ad.addAdEventListener(GMA.AdEventType.OPENED, () => { opened = true; recordFullScreenImpression(); logAdEvent('impression', meta); }),
      ad.addAdEventListener(GMA.AdEventType.CLICKED, () => logAdEvent('clicked', meta)),
      listenPaid(ad, meta),
      ad.addAdEventListener(GMA.AdEventType.CLOSED, () => { if (opened) logAdEvent('completed', meta); finish({ shown: opened }); }),
      ad.addAdEventListener(GMA.AdEventType.ERROR, () => { logAdEvent('failed', meta); finish({ shown: false }); }),
    ];
    logAdEvent('requested', meta);
    ad.load();
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

  useEffect(() => {
    startAdsRemote();
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

  const showRewarded = useCallback((opts) => (GMA
    ? nativeRewarded(opts || {})
    : runDemo('rewarded', 6, { surface: 'rewarded', placement: (opts && opts.purpose) || 'reward', format: 'rewarded', test: true })), []);

  const showInterstitial = useCallback(async (opts = {}) => {
    try {
      if (premiumRef.current) return { shown: false, premium: true };
      if (!getRules().enabled) return { shown: false, reason: 'off' };
      if (!isAppActive()) return { shown: false, reason: 'background' };
      if (!opts.ignoreCaps) { const why = capReason(); if (why) return { shown: false, reason: why }; }
      const meta = { surface: opts.surface || 'other', placement: opts.placement || 'break', format: 'interstitial', test: !GMA || isTestUnit(AD_UNITS.interstitial) };
      if (!GMA) return await runDemo('interstitial', opts.skipAfterSec != null ? opts.skipAfterSec : 4, meta);
      return await nativeInterstitial(meta, opts.loadTimeoutMs || 20000);
    } catch (e) {
      return { shown: false, error: 'internal' };
    }
  }, []);

  const total = demo ? demo.total : 1;
  return (
    <Ctx.Provider value={{ showRewarded, showInterstitial, isDemo: !GMA }}>
      {children}
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
});
