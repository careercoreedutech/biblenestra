// Ads layer.
// - In a store/dev build (EAS) it shows real Google AdMob ads via react-native-google-mobile-ads.
// - In Expo Go and on the web (no AdMob native module) it shows a clearly-labelled demo ad, so every
//   ad-gated flow can still be tested end to end.
//
// const ads = useAds();
// const { rewarded } = await ads.showRewarded();   // user watched to the end → grant the reward
// await ads.showInterstitial();                    // between natural breaks (e.g. game questions)
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

import GMA from './gma';

const Ctx = createContext(null);

// Server-side verification user (online mode). null in local mode → no SSV options are sent.
let adUserId = null;
export function setAdUserId(id) {
  adUserId = id || null;
}

function nativeRewarded(opts = {}) {
  return new Promise((resolve) => {
    let earned = false;
    let done = false;
    const finish = (r) => { if (!done) { done = true; subs.forEach((u) => u && u()); resolve(r); } };
    const request = { requestNonPersonalizedAdsOnly: true };
    if (adUserId && opts.purpose) {
      request.serverSideVerificationOptions = { userId: adUserId, customData: String(opts.purpose) };
    }
    const ad = GMA.RewardedAd.createForAdRequest(AD_UNITS.rewarded, request);
    const subs = [
      ad.addAdEventListener(GMA.RewardedAdEventType.LOADED, () => ad.show().catch(() => finish({ rewarded: false, error: 'show' }))),
      ad.addAdEventListener(GMA.RewardedAdEventType.EARNED_REWARD, () => { earned = true; }),
      ad.addAdEventListener(GMA.AdEventType.CLOSED, () => finish({ rewarded: earned })),
      ad.addAdEventListener(GMA.AdEventType.ERROR, () => finish({ rewarded: false, error: 'load' })),
    ];
    ad.load();
    setTimeout(() => finish({ rewarded: false, error: 'timeout' }), 30000);
  });
}

function nativeInterstitial() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; subs.forEach((u) => u && u()); resolve(r); } };
    const ad = GMA.InterstitialAd.createForAdRequest(AD_UNITS.interstitial, { requestNonPersonalizedAdsOnly: true });
    const subs = [
      ad.addAdEventListener(GMA.AdEventType.LOADED, () => ad.show().catch(() => finish({ shown: false }))),
      ad.addAdEventListener(GMA.AdEventType.CLOSED, () => finish({ shown: true })),
      ad.addAdEventListener(GMA.AdEventType.ERROR, () => finish({ shown: false })),
    ];
    ad.load();
    setTimeout(() => finish({ shown: false }), 20000);
  });
}

export function AdsProvider({ children }) {
  // BibleNestra Plus members get no interstitial (video) ads. Rewarded ads stay: the user chooses them for a reward.
  const { state } = useStore();
  const premiumRef = useRef(false);
  premiumRef.current = !!(state && state.premium);
  const [demo, setDemo] = useState(null); // { kind, resolve }
  const [left, setLeft] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (GMA && GMA.default) {
      try { GMA.default().initialize(); } catch (e) { /* ignore */ }
    }
  }, []);

  const runDemo = useCallback((kind) => new Promise((resolve) => {
    const secs = kind === 'rewarded' ? 6 : 4;
    setLeft(secs);
    setDemo({ kind, resolve });
    clearInterval(timer.current);
    timer.current = setInterval(() => setLeft((s) => (s <= 1 ? (clearInterval(timer.current), 0) : s - 1)), 1000);
  }), []);

  const closeDemo = (completed) => {
    clearInterval(timer.current);
    if (demo) demo.resolve(demo.kind === 'rewarded' ? { rewarded: completed, demo: true } : { shown: true, demo: true });
    setDemo(null);
  };

  const showRewarded = useCallback((opts) => (GMA ? nativeRewarded(opts || {}) : runDemo('rewarded')), []);
  const showInterstitial = useCallback(() => {
    if (premiumRef.current) return Promise.resolve({ shown: false, premium: true });
    return GMA ? nativeInterstitial() : runDemo('interstitial');
  }, []);

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
            <View style={styles.track}><View style={[styles.fill, { width: `${((demo && demo.kind === 'rewarded' ? 6 : 4) - left) / (demo && demo.kind === 'rewarded' ? 6 : 4) * 100}%` }]} /></View>
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
