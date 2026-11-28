import { isDarkScheme } from '../design/palette';
// PRAYER WALL "Light a Candle" (brief 6.6): the candle glyph, the ~1.5 s lighting ceremony that plays over a
// prayer card, the two side-by-side support actions (🙏 I Am Praying · 🕯️ Light a Candle) and the
// "who is praying / lit a candle" sheet. RN Animated only (native driver for opacity / transforms).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { PressScale, Pop, AnimatedNumber, AnimatedModal } from './Motion';
import { haptic } from './Toast';

const ND = Platform.OS !== 'web';
export const CANDLE_MS = 1500;

/** A small candle. `lit` draws the flame; `flame` (Animated.Value 0..1) scales it in and `flicker` sways it. */
export function CandleGlyph({ size = 16, lit = true, color = colors.gold, wax = '#F7EBD2', flame, flicker }) {
  const w = size * 0.75;
  const flameNode = (
    <Svg width={w} height={size * 0.55} viewBox="0 0 12 11">
      <Defs>
        <LinearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE9A8" />
          <Stop offset="0.55" stopColor="#F2B441" />
          <Stop offset="1" stopColor="#D9822B" />
        </LinearGradient>
      </Defs>
      <Path d="M6 0.5 C7.8 3 9.2 4.8 9.2 7 C9.2 9 7.8 10.5 6 10.5 C4.2 10.5 2.8 9 2.8 7 C2.8 4.8 4.2 3 6 0.5 Z" fill="url(#cf)" />
      <Ellipse cx="6" cy="7.6" rx="1.3" ry="2" fill="#FFF6D8" />
    </Svg>
  );
  return (
    <View style={{ width: w, height: size * 1.25, alignItems: 'center', justifyContent: 'flex-end' }}>
      {lit ? (
        flame ? (
          <Animated.View
            style={{
              marginBottom: -1,
              opacity: flame,
              transform: [
                { translateY: flame.interpolate({ inputRange: [0, 1], outputRange: [size * 0.2, 0] }) },
                { scale: flame },
                ...(flicker ? [
                  { rotate: flicker.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] }) },
                  { scaleY: flicker.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.9, 1.06, 0.94] }) },
                ] : []),
              ],
            }}
          >
            {flameNode}
          </Animated.View>
        ) : <View style={{ marginBottom: -1 }}>{flameNode}</View>
      ) : null}
      <Svg width={w} height={size * 0.7} viewBox="0 0 12 14">
        <Path d="M6 0 L6 2.4" stroke={lit ? '#4A3A22' : color} strokeWidth={1} strokeLinecap="round" />
        <Rect x="2.5" y="2.4" width="7" height="11" rx="1.4" fill={lit ? wax : 'none'} stroke={color} strokeWidth={1.2} />
      </Svg>
    </View>
  );
}

// Over the card: a candle rises, the flame ignites and flickers, a warm radial glow spreads, soft lights rise.
export function CandleCeremony({ trigger, borderRadius = radius.lg }) {
  const [on, setOn] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;
  const candle = useRef(new Animated.Value(0)).current;
  const flame = useRef(new Animated.Value(0)).current;
  const flicker = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!trigger) return undefined;
    setOn(true);
    [glow, candle, flame, flicker, rise].forEach((v) => v.setValue(0));
    haptic('light');
    const flick = Animated.loop(Animated.sequence([
      Animated.timing(flicker, { toValue: 1, duration: 120, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(flicker, { toValue: -0.7, duration: 150, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(flicker, { toValue: 0.4, duration: 110, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(flicker, { toValue: 0, duration: 130, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    const show = Animated.parallel([
      // candle appears (0 → 250 ms)
      Animated.timing(candle, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(1.4)), useNativeDriver: ND }),
      // flame ignites (250 → 550 ms)
      Animated.sequence([Animated.delay(240), Animated.spring(flame, { toValue: 1, speed: 14, bounciness: 9, useNativeDriver: ND })]),
      // warm glow swells, holds, settles (200 → 1500 ms)
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(glow, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
        Animated.delay(420),
        Animated.timing(glow, { toValue: 0, duration: 460, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
      ]),
      // soft lights drift up (350 → 1500 ms)
      Animated.sequence([Animated.delay(330), Animated.timing(rise, { toValue: 1, duration: 1170, easing: Easing.out(Easing.quad), useNativeDriver: ND })]),
    ]);
    flick.start();
    show.start(() => {
      Animated.timing(candle, { toValue: 0, duration: 220, useNativeDriver: ND }).start(() => { flick.stop(); setOn(false); });
    });
    return () => { flick.stop(); show.stop(); };
  }, [trigger]);
  if (!on) return null;
  const sparks = [-46, -22, 4, 26, 48, -8];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.1] }) }] }]}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="cg" cx="50%" cy="72%" rx="62%" ry="70%" fx="50%" fy="72%">
              <Stop offset="0" stopColor="#FFD98A" stopOpacity="0.62" />
              <Stop offset="0.45" stopColor="#F2C063" stopOpacity="0.26" />
              <Stop offset="1" stopColor="#F2C063" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#cg)" />
        </Svg>
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 54 }]}>
        {sparks.map((x, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute', bottom: 70, width: i % 2 ? 4 : 5, height: i % 2 ? 4 : 5, borderRadius: 3, backgroundColor: i % 3 ? '#FFE7A6' : '#F6C760',
              opacity: rise.interpolate({ inputRange: [0, 0.15 + i * 0.05, 0.75, 1], outputRange: [0, 0.9, 0.5, 0] }),
              transform: [
                { translateX: rise.interpolate({ inputRange: [0, 1], outputRange: [x * 0.4, x + (i % 2 ? 6 : -6)] }) },
                { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -70 - i * 9] }) },
              ],
            }}
          />
        ))}
        <Animated.View style={{ opacity: candle, transform: [{ translateY: candle.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: candle.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
          <View style={styles.ceremonyHalo}>
            <CandleGlyph size={34} flame={flame} flicker={flicker} color={colors.gold} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * The two support actions on a prayer card, side by side.
 * onPray(p) / onCandle(p) toggle; onShowSupporters(p, 'pray'|'candle') opens the list (optional).
 */
export function SupportActions({ p, onPray, onCandle, onShowSupporters, onPrayBurst, archived }) {
  const pressPray = () => { if (!p.prayed && onPrayBurst) onPrayBurst(); onPray(p); };
  return (
    <View style={styles.row}>
      <View style={styles.half}>
        <PressScale onPress={pressPray} disabled={archived} accessibilityRole="button" accessibilityLabel={p.prayed ? 'Stop praying' : 'I am praying'} hitSlop={4} scaleTo={0.94} style={[styles.btn, p.prayed && styles.prayOn]}>
          <Pop trigger={p.prayed}>
            <Text style={styles.emoji}>🙏</Text>
          </Pop>
          <Text style={[styles.btnText, p.prayed && { color: colors.primaryFg }]} numberOfLines={1}>{p.prayed ? 'Praying' : 'I Am Praying'}</Text>
        </PressScale>
        <Pressable onPress={() => onShowSupporters && onShowSupporters(p, 'pray')} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${p.praying || 0} praying. See who`} style={styles.count}>
          <Pop trigger={p.praying} amount={1.18}><AnimatedNumber value={p.praying || 0} style={styles.countNum} /></Pop>
          <Text style={styles.countLabel}>praying</Text>
        </Pressable>
      </View>
      <View style={styles.half}>
        <PressScale onPress={() => onCandle(p)} disabled={archived} accessibilityRole="button" accessibilityLabel={p.lit ? 'Put out my candle' : 'Light a candle'} hitSlop={4} scaleTo={0.94} style={[styles.btn, styles.candleBtn, p.lit && styles.candleOn]}>
          <Pop trigger={p.lit}>
            {p.lit ? <CandleGlyph size={15} color={colors.gold} /> : <Text style={styles.emoji}>🕯️</Text>}
          </Pop>
          <Text style={[styles.btnText, { color: colors.goldMuted }, p.lit && { color: (isDarkScheme() ? '#E8C27A' : '#6B4E12') }]} numberOfLines={1}>{p.lit ? 'Candle lit' : 'Light a Candle'}</Text>
        </PressScale>
        <Pressable onPress={() => onShowSupporters && onShowSupporters(p, 'candle')} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${p.candles || 0} candles lit. See who`} style={styles.count}>
          <Pop trigger={p.candles} amount={1.18}><AnimatedNumber value={p.candles || 0} style={[styles.countNum, { color: colors.goldMuted }]} /></Pop>
          <Text style={styles.countLabel}>{(p.candles || 0) === 1 ? 'candle' : 'candles'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Small gold "lit" marker for the card corner once you lit a candle. */
export function LitCandleMark() {
  return (
    <View style={styles.litMark} accessibilityLabel="You lit a candle for this prayer">
      <CandleGlyph size={14} color={colors.gold} />
    </View>
  );
}

/** Bottom sheet: who is praying / who lit a candle. load() → [{ user, at }] */
export function SupportersSheet({ visible, action, onClose, load, count, onOpenUser }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!visible) return;
    setItems(null); setError(null);
    let alive = true;
    Promise.resolve(load ? load() : []).then((x) => { if (alive) setItems(x || []); }).catch((e) => { if (alive) { setError(e && e.message ? e.message : 'Couldn’t load the list'); setItems([]); } });
    return () => { alive = false; };
  }, [visible, action]);
  const candle = action === 'candle';
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grab} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {candle ? <CandleGlyph size={22} /> : <Text style={{ fontSize: 20 }}>🙏</Text>}
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>{candle ? 'Candles lit' : 'Praying for this request'}</Text>
            <Text style={styles.sheetSub}>{count || 0} {candle ? (count === 1 ? 'candle is burning' : 'candles are burning') : (count === 1 ? 'person is praying' : 'people are praying')}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Icon name="x" size={18} color={colors.muted} /></Pressable>
        </View>
        <ScrollView style={{ maxHeight: 360, marginTop: 12 }}>
          {items === null ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 24 }} /> : null}
          {error ? <Text style={styles.sheetSub}>{error}</Text> : null}
          {items && !items.length && !error ? <Text style={[styles.sheetSub, { marginVertical: 16 }]}>{candle ? 'Be the first to light a candle.' : 'Be the first to pray.'}</Text> : null}
          {(items || []).map((x, i) => (
            <Pressable key={(x.user && x.user.id) || i} onPress={() => onOpenUser && x.user && onOpenUser(x.user)} style={styles.personRow}>
              <View style={[styles.personDot, candle && { backgroundColor: colors.cardGold }]}>
                <Text style={{ fontWeight: '700', color: candle ? colors.goldMuted : colors.primary }}>{((x.user && x.user.displayName) || '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.personName} numberOfLines={1}>{(x.user && x.user.displayName) || 'A believer'}</Text>
              {candle ? <CandleGlyph size={13} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  // button on top (full width of its half so the whole label fits on narrow phones), count + 'see who' underneath
  half: { flex: 1, minWidth: 0, alignItems: 'stretch', gap: 4 },
  btn: { minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: 8, height: 38, backgroundColor: colors.primarySoft },
  prayOn: { backgroundColor: colors.primary },
  candleBtn: { backgroundColor: colors.cardGold },
  candleOn: { backgroundColor: (isDarkScheme() ? '#241f12' : '#fbf3dc'), borderWidth: 1, borderColor: 'rgba(168,122,39,0.35)' },
  emoji: { fontSize: 14 },
  btnText: { fontSize: 13, fontWeight: '600', color: colors.primary, flexShrink: 1 },
  count: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 20 },
  countLabel: { fontSize: 11.5, color: colors.muted },
  countNum: { fontSize: 13, fontWeight: '700', color: colors.fg },
  ceremonyHalo: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,240,205,0.55)' },
  litMark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardGold, borderWidth: 1, borderColor: 'rgba(168,122,39,0.3)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 30, ...shadow.md },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg },
  sheetSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  personDot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  personName: { flex: 1, fontSize: 14.5, color: colors.fg, fontWeight: '600' },
});
