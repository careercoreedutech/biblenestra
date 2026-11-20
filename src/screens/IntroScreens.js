// First-run onboarding (brief §4): logo splash → three swipeable value slides → sign-in.
//   Each slide: top ~62% solid saturated colour with a full-bleed photo of a real person and large white ring
//   outlines; bottom ~38% white card with rounded top corners overlapping the photo — pagination dots (active =
//   pill in the slide colour), a short bold title, one grey sentence, "Skip" bottom-left and a round next
//   button bottom-right. Nothing else.
//   Skip (or Next on the last slide) → the sign-in screen (online mode) or straight into the app (local mode).
//   Shown once per install; returning users go straight to Today.
// Copy, colours and photo URLs live in src/data/onboarding.js.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts } from '../theme';
import { Icon } from '../components/Icons';
import { PressScale } from '../components/Motion';
import { SplashView } from '../components/BrandLogo';
import { ONBOARDING_SLIDES } from '../data/onboarding';

export const INTRO_KEY = 'biblenestra:introSeen:v1';
const SLIDES = ONBOARDING_SLIDES;

// Large decorative ring outlines, partly cropped by the edges of the colour area
function Rings({ w, h }) {
  const big = Math.max(w, h) * 0.95;
  const mid = w * 0.78;
  const small = w * 0.34;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.ring, { width: big, height: big, borderRadius: big / 2, left: -big * 0.42, top: -big * 0.18, borderWidth: 2.5 }]} />
      <View style={[styles.ring, { width: mid, height: mid, borderRadius: mid / 2, right: -mid * 0.38, top: h * 0.3, borderWidth: 2 }]} />
      <View style={[styles.ring, { width: small, height: small, borderRadius: small / 2, right: w * 0.08, top: h * 0.06, borderWidth: 1.6, opacity: 0.8 }]} />
    </View>
  );
}

// One ring drawn over the photo so it sits "inside" the decoration
function FrontRing({ w, h }) {
  const d = w * 0.5;
  return <View pointerEvents="none" style={[styles.ring, { width: d, height: d, borderRadius: d / 2, left: -d * 0.3, top: h * 0.52, borderWidth: 2 }]} />;
}

const alphaHex = (hex, a) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

function Dots({ count, active, color }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Screen ${active + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === active && [styles.dotOn, { backgroundColor: color }]]} />
      ))}
    </View>
  );
}

function Slide({ s, index, width, height, insetTop, insetBottom, onSkip, onNext, last }) {
  const topH = Math.round(height * 0.62);
  const archW = Math.min(width * 0.8, (topH - insetTop) * 0.82);
  const [failed, setFailed] = useState(false);
  const photo = typeof s.photo === 'string' ? { uri: s.photo } : s.photo;
  return (
    <View style={{ width, height, backgroundColor: '#FFFFFF', overflow: 'hidden' }} accessibilityLabel={`${index + 1} of ${SLIDES.length}: ${s.title}`}>
      <View style={[styles.top, { height: topH + 34, backgroundColor: s.color }]}>
        <Rings w={width} h={topH} />
        {photo && !failed ? (
          s.cutout ? (
            // a transparent PNG of the person: stands straight on the colour, edge to edge
            <Image source={photo} onError={() => setFailed(true)} resizeMode="contain" style={[styles.cutout, { top: insetTop + 12 }]} accessibilityIgnoresInvertColors />
          ) : (
            // a regular photo: a tall arch on the solid colour, running under the white card
            <View style={[styles.arch, { width: archW, height: topH + 34 - insetTop - 22, borderTopLeftRadius: archW / 2, borderTopRightRadius: archW / 2, left: (width - archW) / 2 }]}>
              <Image source={photo} onError={() => setFailed(true)} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
              <LinearGradient pointerEvents="none" colors={['transparent', alphaHex(s.color, 0.35)]} style={styles.archFade} />
            </View>
          )
        ) : null}
        <FrontRing w={width} h={topH} />
      </View>
      <View style={[styles.card, { top: topH, paddingBottom: Math.max(insetBottom, 14) + 10 }]}>
        <Dots count={SLIDES.length} active={index} color={s.color} />
        <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{s.title}</Text>
        <Text style={styles.body} numberOfLines={3}>{s.body}</Text>
        <View style={{ flex: 1 }} />
        <View style={styles.footer}>
          <PressScale onPress={onSkip} hitSlop={14} accessibilityRole="button" accessibilityLabel="Skip the introduction">
            <Text style={styles.skip}>Skip</Text>
          </PressScale>
          <PressScale onPress={onNext} scaleTo={0.92} style={[styles.next, { backgroundColor: s.color }]} accessibilityRole="button" accessibilityLabel={last ? 'Get started' : 'Next'}>
            <Icon name="arrow-right" size={24} color="#FFFFFF" strokeWidth={2.4} />
          </PressScale>
        </View>
      </View>
    </View>
  );
}

export function IntroView({ onDone }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const [page, setPage] = useState(0);
  const target = useRef(null);
  const targetTimer = useRef(null);
  useEffect(() => () => clearTimeout(targetTimer.current), []);
  const goTo = (i) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, i));
    target.current = next;
    clearTimeout(targetTimer.current);
    targetTimer.current = setTimeout(() => { target.current = null; }, 700);
    if (scrollRef.current) scrollRef.current.scrollTo({ x: next * width, animated: true });
    setPage(next);
  };
  const onScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    if (target.current != null) {
      if (Math.abs(x - target.current * width) < 2) target.current = null;
      return;
    }
    const p = Math.round(x / Math.max(width, 1));
    if (p !== page && p >= 0 && p < SLIDES.length) setPage(p);
  };
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {SLIDES.map((s, i) => (
          <Slide
            key={s.id}
            s={s}
            index={i}
            width={width}
            height={height}
            insetTop={insets.top}
            insetBottom={insets.bottom}
            last={i === SLIDES.length - 1}
            onSkip={() => onDone('skip')}
            onNext={() => (i === SLIDES.length - 1 ? onDone('done') : goTo(i + 1))}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// Dev-only (web): /?preview=signin | welcome | splash shows that onboarding screen without Clerk
function devPreview() {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try { return new URLSearchParams(window.location.search).get('preview'); } catch (e) { return null; }
}

// Wraps the app: logo splash while the flag is read, the slides on first launch, then the children.
export function IntroGate({ children }) {
  const [seen, setSeen] = useState(null); // null while reading storage (the splash shows meanwhile)
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => {
        if (!alive) return;
        if (v !== '1') SLIDES.forEach((s) => { if (typeof s.photo === 'string') Image.prefetch(s.photo).catch(() => {}); });
        setSeen(v === '1');
      })
      .catch(() => { if (alive) setSeen(true); }); // storage unavailable: never block the app
    return () => { alive = false; };
  }, []);
  const finish = useCallback(() => {
    setSeen(true);
    AsyncStorage.setItem(INTRO_KEY, '1').catch(() => {});
  }, []);
  const preview = devPreview();
  if (preview === 'signin') { const { SignInPreviewScreen } = require('./SignInScreen'); return <SignInPreviewScreen />; } // eslint-disable-line global-require
  if (preview === 'welcome') { const { WelcomeSetupView } = require('./WelcomeSetupScreen'); return <WelcomeSetupView onDone={() => {}} />; } // eslint-disable-line global-require
  if (preview === 'splash') return <SplashView />;
  if (seen === null) return <SplashView />;
  if (!seen) return <IntroView onDone={finish} />;
  return children;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  arch: { position: 'absolute', bottom: 0, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.18)' },
  archFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },
  cutout: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  ring: { position: 'absolute', borderColor: 'rgba(255,255,255,0.85)' },
  card: {
    position: 'absolute', left: 0, right: 0, bottom: 0, // starts 34dp above the end of the colour area (overlap)
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 34, borderTopRightRadius: 34,
    paddingHorizontal: 28, paddingTop: 26,
    ...Platform.select({
      web: { boxShadow: '0 -8px 24px rgba(21,23,43,0.08)' },
      default: { shadowColor: '#15172B', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 8 },
    }),
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E2DED6' },
  dotOn: { width: 28 },
  title: { marginTop: 20, fontFamily: fonts.serifBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.fg },
  body: { marginTop: 10, fontSize: 15.5, lineHeight: 23, color: '#7A7468' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { fontSize: 16, fontWeight: '600', color: '#8E887C', paddingVertical: 8, paddingRight: 12 },
  next: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 8px 18px rgba(21,23,43,0.18)' },
      default: { shadowColor: '#15172B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 },
    }),
  },
});
