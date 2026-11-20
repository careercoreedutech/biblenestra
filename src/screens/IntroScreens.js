// First-run onboarding (brief §4): logo splash → four swipeable value slides → sign-in.
//   Each slide follows the client's reference: the top ~60% is a full-bleed photo of a person standing on a
//   solid colour (the photo's own studio background is recoloured to the slide colour), with thick white ring
//   outlines partly off the edges; then a white card with rounded top corners overlapping the photo —
//   pagination dots (active = pill in the slide colour), a short bold title, a two-line body, "Skip"
//   bottom-left and a round arrow button in the slide colour bottom-right. Nothing else.
//   Skip (or the arrow on the last slide) → the sign-in screen (online mode) or straight into the app (local mode).
//   Shown once per install; returning users go straight to Today.
// Copy, colours and photos live in src/data/onboarding.js.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../theme';
import { Icon } from '../components/Icons';
import { PressScale } from '../components/Motion';
import { SplashView } from '../components/BrandLogo';
import { ONBOARDING_SLIDES } from '../data/onboarding';

export const INTRO_KEY = 'biblenestra:introSeen:v1';
const SLIDES = ONBOARDING_SLIDES;
const OVERLAP = 34; // how far the white card runs up over the photo

// Thick white ring outlines, partly cropped by the edges of the colour area (as in the reference).
// Kept to the edges so they frame the person rather than cross the face.
function Rings({ w, h }) {
  const t = Math.max(8, Math.round(w * 0.032)); // ring thickness
  const ring = (key, d, cx, cy, bw = t) => (
    <View key={key} style={[styles.ring, { width: d, height: d, borderRadius: d / 2, left: cx - d / 2, top: cy - d / 2, borderWidth: bw }]} />
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {ring('a', w * 0.7, w * -0.06, h * 0.1)}
      {ring('b', w * 0.46, w * 1.04, h * 0.5)}
      {ring('c', w * 0.13, w * 0.86, h * 0.13, Math.round(t * 0.7))}
      {ring('d', w * 0.3, w * -0.02, h * 0.8, Math.round(t * 0.85))}
    </View>
  );
}

function Dots({ count, active, color }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Screen ${active + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === active && [styles.dotOn, { backgroundColor: color }]]} />
      ))}
    </View>
  );
}

// Card metrics: room for everything the card can hold (2-line title, 3-line body) is reserved up front,
// so on short phones the photo gives way and the text never clips.
function cardMetrics(height, insetBottom) {
  const compact = height < 720;
  const m = compact
    ? { padTop: 20, gapTitle: 14, title: 25, titleLH: 30, gapBody: 8, body: 14.5, bodyLH: 21, btn: 56, gapFoot: 14 }
    : { padTop: 26, gapTitle: 18, title: 28, titleLH: 34, gapBody: 10, body: 15.5, bodyLH: 23, btn: 64, gapFoot: 18 };
  m.padBottom = Math.max(insetBottom, 14) + (compact ? 6 : 10);
  m.need = m.padTop + 8 + m.gapTitle + m.titleLH * 2 + m.gapBody + m.bodyLH * 3 + m.gapFoot + m.btn + m.padBottom;
  return m;
}

function Slide({ s, index, width, height, insetBottom, onSkip, onNext, last }) {
  const m = cardMetrics(height, insetBottom);
  const topH = Math.round(Math.min(height * 0.6, height - m.need)); // where the card starts
  const [failed, setFailed] = useState(false);
  const photo = typeof s.photo === 'string' ? { uri: s.photo } : s.photo;
  return (
    <View style={{ width, height, backgroundColor: '#FFFFFF', overflow: 'hidden' }} accessibilityLabel={`${index + 1} of ${SLIDES.length}: ${s.title}`}>
      <View style={[styles.top, { height: topH + OVERLAP, backgroundColor: s.color }]}>
        {photo && !failed ? (
          <Image source={photo} onError={() => setFailed(true)} resizeMode="cover" style={{ position: 'absolute', left: 0, top: 0, width, height: topH + OVERLAP }} accessibilityIgnoresInvertColors />
        ) : null}
        {s.ringsInPhoto ? null : <Rings w={width} h={topH + OVERLAP} />}
      </View>
      <View style={[styles.card, { top: topH, paddingTop: m.padTop, paddingBottom: m.padBottom }]}>
        <Dots count={SLIDES.length} active={index} color={s.color} />
        <Text style={[styles.title, { marginTop: m.gapTitle, fontSize: m.title, lineHeight: m.titleLH }]} numberOfLines={2} accessibilityRole="header">{s.title}</Text>
        <Text style={[styles.body, { marginTop: m.gapBody, fontSize: m.body, lineHeight: m.bodyLH }]} numberOfLines={3}>{s.body}</Text>
        <View style={{ flex: 1, minHeight: m.gapFoot }} />
        <View style={styles.footer}>
          <PressScale onPress={onSkip} hitSlop={14} accessibilityRole="button" accessibilityLabel="Skip the introduction">
            <Text style={styles.skip}>Skip</Text>
          </PressScale>
          <PressScale onPress={onNext} scaleTo={0.92} style={[styles.next, { width: m.btn, height: m.btn, borderRadius: m.btn / 2, backgroundColor: s.color }]} accessibilityRole="button" accessibilityLabel={last ? 'Get started' : 'Next'}>
            <Icon name="arrow-right" size={m.btn > 60 ? 26 : 23} color="#FFFFFF" strokeWidth={2.6} />
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
  ring: { position: 'absolute', borderColor: '#FFFFFF' },
  card: {
    position: 'absolute', left: 0, right: 0, bottom: 0, // starts OVERLAP dp above the end of the colour area
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 34, borderTopRightRadius: 34,
    paddingHorizontal: 28,
    ...Platform.select({
      web: { boxShadow: '0 -8px 24px rgba(21,23,43,0.08)' },
      default: { shadowColor: '#15172B', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 8 },
    }),
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E4E1DA' },
  dotOn: { width: 26 },
  title: { fontWeight: '800', letterSpacing: -0.5, color: colors.fg },
  body: { color: '#85807A' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { fontSize: 16, fontWeight: '600', color: '#8E887C', paddingVertical: 8, paddingRight: 12 },
  next: {
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 8px 18px rgba(21,23,43,0.18)' },
      default: { shadowColor: '#15172B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 },
    }),
  },
});
