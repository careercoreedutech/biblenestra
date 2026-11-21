// Full-screen gift animation: the gift springs in, a ring of sparkles bursts out, light rays turn behind it and
// (premium gifts) confetti falls. Tap anywhere to close; it also closes by itself. No sound. Reduced motion → a calm fade.
//   <GiftPlayer play={{ gift, from?, to?, note?, key }} onDone />   (play = null hides it)
//   <GiftOverlay …/>  same animation drawn inside a parent box (no Modal), for the live stream.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { GiftArt, GIFT_TINT } from './GiftArt';

const ND = Platform.OS !== 'web';
const CONFETTI = ['#FFD166', '#FF7A6B', '#3FAE6A', '#3AA6D9', '#F28CA5', '#B89BF2'];

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    let alive = true;
    try { AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setR(!!v)).catch(() => {}); } catch (e) { /* web */ }
    return () => { alive = false; };
  }, []);
  return r;
}

function Show({ play, onDone, compact = false }) {
  const { width, height } = Dimensions.get('window');
  const reduced = useReducedMotion();
  const g = play.gift || {};
  const premium = g.tier === 'premium';
  const tint = GIFT_TINT[g.art] || '#D4A852';
  const size = compact ? 120 : Math.min(220, width * 0.55);
  const a = useRef(new Animated.Value(0)).current;      // entrance
  const burst = useRef(new Animated.Value(0)).current;  // sparkle ring
  const spin = useRef(new Animated.Value(0)).current;   // rays
  const fall = useRef(new Animated.Value(0)).current;   // confetti
  const out = useRef(new Animated.Value(1)).current;    // exit fade
  const dur = premium ? 3600 : 2500;
  const sparks = useMemo(() => Array.from({ length: premium ? 18 : 12 }, (_, i) => ({ ang: (i / (premium ? 18 : 12)) * Math.PI * 2, d: 0.75 + (i % 3) * 0.18 })), [premium]);
  const pieces = useMemo(() => (premium && !reduced ? Array.from({ length: 26 }, (_, i) => ({ x: (i * 37) % 100, delay: (i % 7) * 0.08, c: CONFETTI[i % CONFETTI.length], r: (i * 53) % 360 })) : []), [premium, reduced]);
  useEffect(() => {
    const anims = [
      Animated.spring(a, { toValue: 1, speed: 9, bounciness: 14, useNativeDriver: ND }),
      Animated.timing(burst, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: ND }),
      Animated.timing(spin, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: ND }),
      Animated.timing(fall, { toValue: 1, duration: dur, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
    ];
    if (reduced) Animated.timing(a, { toValue: 1, duration: 250, useNativeDriver: ND }).start();
    else Animated.parallel(anims).start();
    const t = setTimeout(() => Animated.timing(out, { toValue: 0, duration: 320, useNativeDriver: ND }).start(() => onDone && onDone()), dur);
    return () => clearTimeout(t);
  }, [play.key]);
  const R = size * 0.95;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.center, { opacity: out }]} pointerEvents="box-none">
      {!reduced ? (
        <Animated.View style={{ position: 'absolute', opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] }), transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', premium ? '120deg' : '60deg'] }) }] }}>
          <Svg width={size * 2.2} height={size * 2.2} viewBox="0 0 100 100">
            {Array.from({ length: 12 }, (_, i) => <Path key={i} d="M50 50L47 2h6z" fill={i % 2 ? tint : '#FFE08A'} opacity={0.32} transform={`rotate(${i * 30} 50 50)`} />)}
          </Svg>
        </Animated.View>
      ) : null}
      {!reduced ? sparks.map((s, i) => (
        <Animated.Text key={i} style={{
          position: 'absolute', fontSize: 16 + (i % 3) * 5, color: i % 2 ? '#FFE08A' : tint,
          opacity: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
          transform: [
            { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(s.ang) * R * s.d] }) },
            { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(s.ang) * R * s.d] }) },
          ],
        }}>✦</Animated.Text>
      )) : null}
      {pieces.map((p, i) => (
        <Animated.View key={`c${i}`} style={{
          position: 'absolute', top: -20, left: `${p.x}%`, width: 8, height: 14, borderRadius: 2, backgroundColor: p.c,
          transform: [
            { translateY: fall.interpolate({ inputRange: [0, Math.min(0.9, p.delay + 0.1), 1], outputRange: [-40, 0, (compact ? 320 : height) + 40] }) },
            { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: [`${p.r}deg`, `${p.r + 540}deg`] }) },
          ],
        }} />
      ))}
      <Animated.View style={{ alignItems: 'center', transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }, { rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '0deg'] }) }] }}>
        <GiftArt gift={g} size={size} animate={!reduced} />
      </Animated.View>
      <Animated.View style={{ alignItems: 'center', marginTop: 14, opacity: a, paddingHorizontal: 24 }}>
        <Text style={[styles.title, compact && { fontSize: 18 }]} numberOfLines={1}>{g.name || 'Gift'}</Text>
        {play.from || play.to ? <Text style={styles.sub} numberOfLines={2}>{[play.from ? `from ${play.from}` : null, play.to ? `to ${play.to}` : null].filter(Boolean).join(' · ')}</Text> : null}
        {play.note ? <Text style={styles.note} numberOfLines={3}>“{play.note}”</Text> : null}
      </Animated.View>
    </Animated.View>
  );
}

export function GiftPlayer({ play, onDone }) {
  if (!play) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onDone} accessibilityRole="button" accessibilityLabel={`${(play.gift && play.gift.name) || 'Gift'} animation. Tap to close`}>
        <Show play={play} onDone={onDone} />
      </Pressable>
    </Modal>
  );
}
/** The same show inside a parent (live stream box). pointerEvents none so the stream stays usable. */
export function GiftOverlay({ play, onDone }) {
  if (!play) return null;
  return <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none"><Show play={play} onDone={onDone} compact /></View>;
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(12,13,28,0.78)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  sub: { color: 'rgba(255,255,255,0.82)', fontSize: 14, marginTop: 4, textAlign: 'center' },
  note: { color: '#FFE9B0', fontSize: 14.5, fontStyle: 'italic', marginTop: 8, textAlign: 'center' },
});
