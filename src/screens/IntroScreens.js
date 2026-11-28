// First-run welcome journey, rebuilt in the Figma design (Splash + Welcome in routes.tsx).
//   Splash: full-bleed chapel photo, "Your sacred everyday", "Faith, beautifully woven into life.",
//   and the "Enter your sanctuary" button. Then the four onboarding slides (photo card with the image meta
//   chip, the verse chip, the orange round icon, dots, circle continue button and Skip).
//   Skip → onDone('skip'); the last slide's button → onDone('done'). Shown once per install
//   (INTRO_KEY), and returning users go straight into the app.
// The slide copy and photos live in this file (the design's images, from src/design/sanctuary.js).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../components/Icons';
import { PressScale } from '../components/Motion';
import { SplashView } from '../components/BrandLogo';
import { d, df, images, fillImage, Eyebrow } from '../design/sanctuary';
import { colors } from '../theme'; // APPEARANCE (item 14): palette tokens
import { isDarkScheme } from '../design/palette'; // APPEARANCE (item 14)

export const INTRO_KEY = 'biblenestra:introSeen:v1';

const SLIDES = [
  {
    kicker: 'Study the Word',
    title: 'Read beyond the words on the page.',
    body: 'Compare translations, hear the Word, explore original language, and keep every insight.',
    icon: 'book',
    image: images.scriptureStudy,
    note: '90+ translations · Deep study',
  },
  {
    kicker: 'Your Scripture Companion',
    title: 'Find wisdom for what you are carrying.',
    body: 'Receive real scripture, thoughtful context, encouragement, and a personal prayer.',
    icon: 'sparkles',
    image: images.companion,
    note: 'Scripture-led · Personal · Private',
  },
  {
    kicker: 'Meet fellow believers',
    title: 'Never carry a prayer alone.',
    body: 'Share in fellowship, receive care, and encourage believers around the world.',
    icon: 'prayer',
    image: images.fellowship,
    note: 'Prayer · Fellowship · Care',
  },
  {
    kicker: 'Daily Bread',
    title: 'Begin every day anchored in grace.',
    body: 'A quiet daily space for scripture, guided reflection, gratitude, and prayer.',
    icon: 'sun',
    image: images.chapel,
    note: 'Verse · Reading · Prayer · Reflect',
  },
];

const VERSE = { text: '“Abide in me, and I in you.”', ref: 'John 15:4' };

// .brand-mark: the outlined sparkle symbol with the wordmark (white on the splash)
function BrandMark({ light }) {
  const c = light ? '#FFFFFF' : d.ink;
  return (
    <View style={styles.brandRow} accessibilityLabel="BibleNestra">
      <View style={[styles.brandSymbol, { borderColor: c }]}>
        <Icon name="sparkles" size={17} color={c} strokeWidth={1.9} />
      </View>
      <Text style={[styles.brandText, { color: c }]}>BibleNestra</Text>
    </View>
  );
}

function Splash({ onEnter }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const titleSize = Math.min(66, Math.max(44, Math.round(width * 0.12))); // clamp(44px, 12vw, 66px) of the design
  return (
    <View style={[styles.splash, { width, height }]}>
      <StatusBar style="light" />
      <Image style={fillImage} source={images.chapel} resizeMode="cover" accessibilityLabel="A peaceful chapel at dawn" />
      <LinearGradient
        colors={['rgba(25,20,48,0.18)', 'rgba(15,12,30,0.06)', 'rgba(20,16,41,0.88)']}
        locations={[0, 0.35, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.splashTop, { paddingTop: insets.top + 18 }]}><BrandMark light /></View>
      <View style={[styles.splashCopy, { bottom: insets.bottom + 30 }]}>
        <Eyebrow light>Your sacred everyday</Eyebrow>
        <Text style={[styles.splashTitle, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.08), letterSpacing: -titleSize * 0.03 }]}>Faith, beautifully{'\n'}woven into life.</Text>
        <Text style={styles.splashBody}>Read deeply. Pray freely. Grow together.</Text>
        <PressScale onPress={onEnter} scaleTo={0.97} style={styles.lightButton} accessibilityRole="button" accessibilityLabel="Enter your sanctuary">
          <Text style={styles.lightButtonText}>Enter your sanctuary</Text>
          <Icon name="arrow-right" size={18} color={d.ink} strokeWidth={2} />
        </PressScale>
      </View>
    </View>
  );
}

function Slide({ s, index, width, height, insets, onSkip, onNext }) {
  const last = index === SLIDES.length - 1;
  const compact = height < 720;
  // The copy block (eyebrow, title, body, dots and button) and the header are fixed-size, so the photo takes what is left.
  const fixedH = insets.top + 14 + insets.bottom + 18 + 44 + 8 + (compact ? 238 : 268);
  const visualH = Math.round(Math.min(430, Math.max(230, height - fixedH)));
  const imgW = Math.min(width * 0.82, 350);
  const imgH = Math.min(visualH - 24, 430);
  return (
    <View style={[styles.slide, { width, height, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 18 }]} accessibilityLabel={`${index + 1} of ${SLIDES.length}: ${s.title}`}>
      <View style={styles.head}>
        <BrandMark />
        <TouchableOpacity onPress={onSkip} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip the introduction">
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.visual, { height: visualH }]}>
        <View style={[styles.photoWrap, { width: imgW, height: imgH }]}>
          <Image style={fillImage} source={s.image} resizeMode="cover" accessibilityIgnoresInvertColors />
          <LinearGradient
            colors={['rgba(35,20,11,0.05)', 'rgba(35,20,11,0)', 'rgba(35,20,11,0.82)']}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.photoMeta}>
            <View style={styles.photoKicker}>
              <Icon name={s.icon} size={15} color="#FFFFFF" strokeWidth={1.9} />
              <Text style={styles.photoKickerText}>{s.kicker}</Text>
            </View>
            <Text style={styles.photoNote}>{s.note}</Text>
          </View>
        </View>

        <View style={styles.verseChip}>
          <Icon name="sparkles" size={14} color={d.plum} strokeWidth={1.9} />
          <Text style={styles.verseText}>{VERSE.text}</Text>
          <Text style={styles.verseRef}>{VERSE.ref}</Text>
        </View>

        <View style={styles.roundIcon}>
          <Icon name={s.icon} size={30} color="#FFFFFF" strokeWidth={1.7} />
        </View>
      </View>

      <View style={styles.copy}>
        <Eyebrow>{s.kicker}</Eyebrow>
        <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={2}>{s.title}</Text>
        <Text style={styles.body} numberOfLines={3}>{s.body}</Text>
        <View style={styles.stepRow}>
          <View style={styles.dots} accessibilityLabel={`Screen ${index + 1} of ${SLIDES.length}`}>
            {SLIDES.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotOn]} />)}
          </View>
          <PressScale onPress={onNext} scaleTo={0.92} style={styles.circleButton} accessibilityRole="button" accessibilityLabel={last ? 'Get started' : 'Continue'}>
            <Icon name="arrow-right" size={24} color="#FFFFFF" strokeWidth={2.2} />
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
  const [stage, setStage] = useState('splash'); // splash | slides
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

  if (stage === 'splash') return <Splash onEnter={() => setStage('slides')} />;

  return (
    <View style={styles.root}>
      <StatusBar style={isDarkScheme() ? "light" : "dark"} />
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
            key={s.kicker}
            s={s}
            index={i}
            width={width}
            height={height}
            insets={insets}
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

// Wraps the app: logo splash while the flag is read, the welcome journey on first launch, then the children.
export function IntroGate({ children }) {
  const [seen, setSeen] = useState(null); // null while reading storage (the splash shows meanwhile)
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => {
        if (!alive) return;
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
  if (preview === 'splash') return <Splash onEnter={() => {}} />;
  if (seen === null) return <SplashView />;
  if (!seen) return <IntroView onDone={finish} />;
  return children;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: d.ivory },

  // Splash
  splash: { backgroundColor: '#1C1430', overflow: 'hidden' },
  splashTop: { paddingHorizontal: 24, paddingTop: 30 },
  splashCopy: { position: 'absolute', left: 24, right: 24, bottom: 42 },
  splashTitle: { color: '#FFFFFF', fontFamily: df.display, fontSize: 52, lineHeight: 58, letterSpacing: -1.6, marginTop: 16, marginBottom: 16 },
  splashBody: { color: 'rgba(255,255,255,0.76)', fontFamily: df.sans, fontSize: 16, lineHeight: 22, marginBottom: 28 },
  lightButton: { height: 56, borderRadius: 18, backgroundColor: colors.surfaceWhite, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  lightButtonText: { color: d.ink, fontFamily: df.sansBold, fontSize: 15 },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandSymbol: { width: 34, height: 34, borderWidth: 1, borderTopLeftRadius: 17, borderTopRightRadius: 17, borderBottomRightRadius: 17, borderBottomLeftRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: df.sansBold, fontSize: 17, letterSpacing: -0.4 },

  // Slides
  slide: { backgroundColor: d.ivory, paddingHorizontal: 24 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { color: d.plum, fontFamily: df.sansBold, fontSize: 13, paddingVertical: 6 },
  visual: { position: 'relative', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  photoWrap: {
    overflow: 'hidden', borderTopLeftRadius: 38, borderTopRightRadius: 38, borderBottomRightRadius: 38, borderBottomLeftRadius: 12,
    borderWidth: 7, borderColor: 'rgba(255,255,255,0.72)', backgroundColor: (isDarkScheme() ? '#32271E' : '#E8DCCB'), transform: [{ rotate: '-2deg' }],
    ...Platform.select({
      web: { boxShadow: '0 28px 60px rgba(57,32,18,0.22)' },
      default: { shadowColor: '#392012', shadowOffset: { width: 0, height: 28 }, shadowOpacity: 0.22, shadowRadius: 30, elevation: 12 },
    }),
  },
  photoMeta: { position: 'absolute', left: 18, right: 18, bottom: 17 },
  photoKicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  photoKickerText: { color: '#FFFFFF', fontFamily: df.display, fontSize: 18, lineHeight: 23 },
  photoNote: { color: '#EAD9CC', fontFamily: df.sansBold, fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 5 },
  verseChip: {
    position: 'absolute', zIndex: 3, left: 0, bottom: '3%', width: 165, padding: 13, borderRadius: 16,
    backgroundColor: 'rgba(255,250,242,0.92)', borderWidth: 1, borderColor: colors.surfaceWhite, transform: [{ rotate: '3deg' }],
    ...Platform.select({
      web: { boxShadow: '0 13px 28px rgba(55,31,17,0.15)' },
      default: { shadowColor: '#371F11', shadowOffset: { width: 0, height: 13 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 6 },
    }),
  },
  verseText: { color: d.ink, fontFamily: df.displayItalic, fontSize: 12, lineHeight: 16, marginTop: 5 },
  verseRef: { color: d.muted, fontFamily: df.sansBold, fontSize: 10, marginTop: 4 },
  roundIcon: {
    position: 'absolute', zIndex: 4, right: '1%', bottom: '4%', width: 64, height: 64,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomRightRadius: 20, borderBottomLeftRadius: 6,
    backgroundColor: d.plum, borderWidth: 3, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '6deg' }],
  },
  copy: { marginTop: 'auto' },
  title: { color: d.ink, fontFamily: df.display, fontSize: 30, lineHeight: 36, letterSpacing: -1, marginTop: 12, marginBottom: 2 },
  titleCompact: { fontSize: 26, lineHeight: 32 },
  body: { color: d.muted, fontFamily: df.sans, fontSize: 14, lineHeight: 22 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: (isDarkScheme() ? '#4D3D30' : '#D6D1C7') },
  dotOn: { width: 30, backgroundColor: d.plum },
  circleButton: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 12px 24px rgba(255,107,26,0.22)' },
      default: { shadowColor: d.plum, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.22, shadowRadius: 20, elevation: 8 },
    }),
  },
});
