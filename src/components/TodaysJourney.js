// Today's Journey, "Your Time With God": three cards that float and roll on their own.
//   Daily Bread        → 'DailyVerse'      (verse of the day, image, reflection)
//   Blessing for the Day → 'BlessingVideos' (admin blessing video, full-screen player)
//   Prayer for the Day → 'PrayerWall'      (pray with others today)
// Card content comes from GET /daily/today (cached on the device, so the row renders at once).
// Motion (RN Animated, native driver throughout):
//   - each card gently floats up and down (staggered),
//   - the carousel slides to the next card every few seconds and pauses while the user touches it,
//   - the card under the centre rotates a little and its icon drifts (parallax) as the carousel moves.
// Reduce motion (system setting): nothing moves on its own; the cards can still be swiped and tapped.
// Props: verse, done, onBread / onVideos / onPrayer (override the default routes), style.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { PressScale } from './Motion';
import { haptic } from './Toast';
import { alpha } from './ui';
import { useDailyToday } from '../api/daily';
import { useNav } from '../navigation';

const ND = Platform.OS !== 'web';
const AUTO_MS = 4800; // time on each card before the carousel moves on
const PAUSE_MS = 7000; // after the user touches the carousel, auto-slide waits this long
const FLOAT_MS = 2600; // one half of a float cycle

/** Praying hands (two palms meeting) — the app's icon set only has a candle for "prayer" */
export function PrayingHands({ size = 18, color = colors.rose, strokeWidth = 1.8 }) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M11.3 3.6c-.7 0-1.2.6-1.2 1.3v5.4l-2.9 3.6c-.4.5-.6 1.1-.6 1.7v2.6L4 20.6" {...p} />
      <Path d="M12.7 3.6c.7 0 1.2.6 1.2 1.3v5.4l2.9 3.6c.4.5.6 1.1.6 1.7v2.6l2.6 2.4" {...p} />
      <Path d="M11.3 3.6c.4.1.7.4.7.9V17l-2.6 2.6M12.7 3.6c-.4.1-.7.4-.7.9M12 17l2.6 2.6" {...p} />
    </Svg>
  );
}

const minutesLabel = (words, wpm, unit) => `${Math.max(1, Math.round(words / wpm))} MIN ${unit}`;

/** Reads the system reduce-motion setting and keeps it up to date. */
function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    const A = AccessibilityInfo;
    if (A && A.isReduceMotionEnabled) A.isReduceMotionEnabled().then((v) => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = A && A.addEventListener ? A.addEventListener('reduceMotionChanged', (v) => setReduce(!!v)) : null;
    return () => { alive = false; if (sub && sub.remove) sub.remove(); };
  }, []);
  return reduce;
}

export default function TodaysJourney({ verse, prayersCount = 0, done = {}, onBread, onVideos, onPrayer, style }) {
  const nav = useNav();
  const { data } = useDailyToday();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const bread = data && data.bread;
  const video = data && data.video;

  const label = bread ? bread.label : verse && verse.label;
  const reflectionWords = String((bread && bread.reflection) || (verse && verse.reflection) || '').split(/\s+/).filter(Boolean).length;
  const cards = useMemo(() => [
    {
      key: 'bread',
      title: 'Daily Bread',
      icon: <Icon name="book" size={17} color={colors.gold} />,
      tint: colors.gold, bg: colors.cardGold,
      desc: label ? `${label} · today’s verse, image & reflection` : 'Today’s verse with reflection and image',
      meta: minutesLabel(40 + reflectionWords, 120, 'READ'),
      done: done.bread,
      onPress: onBread || (() => nav.push('DailyVerse')),
    },
    {
      key: 'blessing',
      title: 'Blessing for the Day',
      icon: <Icon name="play" size={16} color={colors.lavender} fill="solid" />,
      tint: colors.lavender, bg: colors.cardLavender,
      desc: video && video.title ? video.title : 'Today’s blessing video',
      meta: video && video.durationSec ? `${Math.max(1, Math.round(video.durationSec / 60))} MIN WATCH` : 'NEW EACH DAY',
      onPress: onVideos || (() => nav.push('BlessingVideos')),
    },
    {
      key: 'prayer',
      title: 'Prayer for the Day',
      icon: <PrayingHands size={19} color={colors.rose} />,
      tint: colors.rose, bg: colors.cardRose,
      desc: 'Pray with others today',
      meta: prayersCount ? `${prayersCount} ${prayersCount === 1 ? 'REQUEST' : 'REQUESTS'}` : '3 MIN PRAYER',
      done: done.prayer,
      onPress: onPrayer || (() => nav.push('PrayerWall')),
    },
  ], [label, reflectionWords, video, done.bread, done.prayer, prayersCount, onBread, onVideos, onPrayer, nav]);

  const cardW = Math.round(Math.min(width * 0.7, 290));
  const gap = 12;
  const snap = cardW + gap;
  const sidePad = Math.round((width - cardW) / 2);

  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);
  const index = useRef(0);
  const pausedUntil = useRef(0);
  const [active, setActive] = useState(0);

  const goTo = (i, animated = true) => {
    const next = ((i % cards.length) + cards.length) % cards.length;
    index.current = next;
    setActive(next);
    if (scrollRef.current) scrollRef.current.scrollTo({ x: next * snap, animated });
  };

  // auto-slide: only when motion is allowed, and not while the user is holding the carousel
  useEffect(() => {
    if (reduce || cards.length < 2) return undefined;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      goTo(index.current + 1);
    }, AUTO_MS);
    return () => clearInterval(t);
    // goTo reads refs only; snap is the only input that changes the geometry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, cards.length, snap]);

  const onTouch = () => { pausedUntil.current = Date.now() + PAUSE_MS; };
  const onSettled = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / snap);
    const next = Math.min(cards.length - 1, Math.max(0, i));
    index.current = next;
    setActive(next);
  };

  return (
    <View style={style}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: sidePad, paddingVertical: 14 }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: ND })}
        onScrollBeginDrag={onTouch}
        onTouchStart={onTouch}
        onMomentumScrollEnd={onSettled}
        onScrollEndDrag={onSettled}
        accessibilityRole="list"
      >
        {cards.map((c, i) => (
          <JourneyCard
            key={c.key}
            card={c}
            index={i}
            width={cardW}
            gap={gap}
            scrollX={scrollX}
            snap={snap}
            floating={!reduce}
            onPress={() => { onTouch(); c.onPress && c.onPress(); }}
          />
        ))}
      </Animated.ScrollView>
      <View style={styles.dots} accessibilityRole="tablist">
        {cards.map((c, i) => (
          <View key={c.key} style={[styles.dot, i === active && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

function JourneyCard({ card, index, width, gap, scrollX, snap, floating, onPress }) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!floating) { float.setValue(0); return undefined; }
    // each card starts at its own point in the cycle, so the three never move in step
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: FLOAT_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(float, { toValue: 0, duration: FLOAT_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    const delay = setTimeout(() => loop.start(), index * 380);
    return () => { clearTimeout(delay); loop.stop(); };
  }, [floating, index, float]);

  const range = [(index - 1) * snap, index * snap, (index + 1) * snap];
  // rolling: the card turns a little as it passes the centre
  const rotate = scrollX.interpolate({ inputRange: range, outputRange: ['-5deg', '0deg', '5deg'], extrapolate: 'clamp' });
  const scale = scrollX.interpolate({ inputRange: range, outputRange: [0.94, 1, 0.94], extrapolate: 'clamp' });
  // parallax: the icon drifts against the card
  const drift = scrollX.interpolate({ inputRange: range, outputRange: [-12, 0, 12], extrapolate: 'clamp' });
  const lift = float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  const tilt = float.interpolate({ inputRange: [0, 1], outputRange: ['-0.6deg', '0.6deg'] });

  return (
    <Animated.View style={{ width, marginRight: gap, transform: [{ translateY: lift }, { rotate: tilt }, { rotate }, { scale }] }}>
      <PressScale
        scaleTo={0.96}
        onPress={() => { haptic('light'); onPress(); }}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${card.title}. ${card.desc}. Tap to begin`}
        testID={`journey-${card.key}`}
      >
        <Animated.View style={[styles.iconCircle, { backgroundColor: card.bg, transform: [{ translateX: drift }] }]}>{card.icon}</Animated.View>
        {card.done ? <View style={styles.doneDot}><Icon name="check" size={10} color="#FFFFFF" strokeWidth={3} /></View> : null}
        <Text style={styles.title} numberOfLines={2}>{card.title}</Text>
        <Text style={styles.desc} numberOfLines={3}>{card.desc}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.meta, { color: card.tint }]} numberOfLines={1}>{card.meta}</Text>
        <View style={styles.ctaRow}>
          <Text style={styles.cta} numberOfLines={1}>Tap to begin</Text>
          <Icon name="chevron-right" size={10} color={colors.primary} strokeWidth={2.6} />
        </View>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 176, padding: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  doneDot: { position: 'absolute', right: 12, top: 12, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serifBold, fontSize: 17, lineHeight: 21, color: colors.fg, letterSpacing: -0.2, marginTop: 12 },
  desc: { fontSize: 12, lineHeight: 16, color: colors.muted, marginTop: 4 },
  meta: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 8 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  cta: { flexShrink: 1, fontSize: 11, fontWeight: '700', color: colors.primary },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: alpha(colors.muted, 0.35) },
  dotOn: { width: 18, backgroundColor: colors.primary },
});
