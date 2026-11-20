// Today's Journey — three equal cards in one row (Daily Bread · Videos · Prayer Wall), all visible on a
// 360 dp screen. Card content comes from GET /daily/today (cached on the device, so the row renders at once)
// with the app's own verse of the day as the fallback. With the 'daily_journey.auto_highlight' flag on, one
// card at a time gets a soft glow every ~3 s (never navigates).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { PressScale } from './Motion';
import { haptic } from './Toast';
import { alpha } from './ui';
import { useDailyToday } from '../api/daily';

const ND = Platform.OS !== 'web';

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

export default function TodaysJourney({ verse, prayersCount = 0, done = {}, onBread, onVideos, onPrayer, style }) {
  const { data } = useDailyToday();
  const bread = data && data.bread;
  const video = data && data.video;
  const autoHighlight = !!(data && data.flags && data.flags.autoHighlight);

  const label = bread ? bread.label : verse && verse.label;
  const reflectionWords = String((bread && bread.reflection) || (verse && verse.reflection) || '').split(/\s+/).filter(Boolean).length;
  const cards = [
    {
      key: 'bread',
      title: 'Daily Bread',
      icon: <Icon name="book" size={17} color={colors.gold} />,
      tint: colors.gold, bg: colors.cardGold,
      desc: label ? `${label} · today’s verse, image & reflection` : 'Today’s verse with reflection and image',
      meta: minutesLabel(40 + reflectionWords, 120, 'READ'),
      done: done.bread,
      onPress: onBread,
    },
    {
      key: 'videos',
      title: 'Videos',
      icon: <Icon name="play" size={16} color={colors.lavender} fill="solid" />,
      tint: colors.lavender, bg: colors.cardLavender,
      desc: video ? video.title : 'Today’s blessing video',
      meta: video && video.durationSec ? `${Math.max(1, Math.round(video.durationSec / 60))} MIN WATCH` : 'NEW EACH DAY',
      onPress: onVideos,
    },
    {
      key: 'prayer',
      title: 'Prayer Wall',
      icon: <PrayingHands size={19} color={colors.rose} />,
      tint: colors.rose, bg: colors.cardRose,
      desc: 'Pray with others today',
      meta: prayersCount ? `${prayersCount} ${prayersCount === 1 ? 'REQUEST' : 'REQUESTS'}` : '3 MIN PRAYER',
      done: done.prayer,
      onPress: onPrayer,
    },
  ];

  const [lit, setLit] = useState(-1);
  useEffect(() => {
    if (!autoHighlight) { setLit(-1); return undefined; }
    let i = 0;
    setLit(0);
    const t = setInterval(() => { i = (i + 1) % 3; setLit(i); }, 3000);
    return () => clearInterval(t);
  }, [autoHighlight]);

  return (
    <View style={[styles.row, style]} accessibilityRole="list">
      {cards.map((c, i) => <JourneyCard key={c.key} card={c} lit={lit === i} />)}
    </View>
  );
}

function JourneyCard({ card, lit }) {
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: lit ? 1 : 0, duration: 450, useNativeDriver: ND }).start();
  }, [lit]);
  return (
    <PressScale
      scaleTo={0.95}
      onPress={() => { haptic('light'); card.onPress && card.onPress(); }}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${card.desc}. Tap to begin`}
      testID={`journey-${card.key}`}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, { borderColor: alpha(card.tint, 0.55), backgroundColor: alpha(card.tint, 0.05), opacity: glow }]} />
      <View style={styles.top}>
        <View style={[styles.iconCircle, { backgroundColor: card.bg }]}>{card.icon}</View>
        {card.done ? <View style={styles.doneDot}><Icon name="check" size={10} color="#FFFFFF" strokeWidth={3} /></View> : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>{card.title}</Text>
      <Text style={styles.desc} numberOfLines={3}>{card.desc}</Text>
      <View style={{ flex: 1 }} />
      <Text style={[styles.meta, { color: card.tint }]} numberOfLines={1}>{card.meta}</Text>
      <View style={styles.ctaRow}>
        <Text style={styles.cta} numberOfLines={1}>Tap to begin</Text>
        <Icon name="chevron-right" size={10} color={colors.primary} strokeWidth={2.6} />
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  card: { flex: 1, minWidth: 0, minHeight: 168, padding: 10, paddingTop: 11, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  glow: { borderRadius: radius.lg, borderWidth: 1.5, margin: -1 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  iconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  doneDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serifBold, fontSize: 15, lineHeight: 19, color: colors.fg, letterSpacing: -0.2, marginTop: 9 },
  desc: { fontSize: 11.5, lineHeight: 15, color: colors.muted, marginTop: 3 },
  meta: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 8 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 3 },
  cta: { flexShrink: 1, fontSize: 10.5, fontWeight: '700', color: colors.primary },
});
