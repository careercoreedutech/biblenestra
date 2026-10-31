// BibleNestra motion toolkit — small, dependency-free animation primitives built on RN Animated.
// Durations: quick 160ms, standard 260ms, entrance 420ms. Prefer springs for touch feedback.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

const ND = Platform.OS !== 'web'; // native driver where supported
export const EASE_OUT = Easing.out(Easing.cubic);
export const EASE_IN = Easing.in(Easing.cubic);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ---------- Press feedback: springs down on touch, back up on release ----------
export function PressScale({ children, style, scaleTo = 0.965, disabled, onPressIn, onPressOut, ...rest }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(s, { toValue: v, useNativeDriver: ND, speed: 40, bounciness: v === 1 ? 6 : 0 }).start();
  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={(e) => { to(scaleTo); onPressIn && onPressIn(e); }}
      onPressOut={(e) => { to(1); onPressOut && onPressOut(e); }}
      style={[style, { transform: [{ scale: s }] }]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}

// ---------- Entrance: fade + rise, staggered by index ----------
export function FadeInUp({ children, index = 0, delay = 0, distance = 14, duration = 420, style, stagger = 55 }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration, delay: delay + Math.min(index, 10) * stagger, easing: EASE_OUT, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// ---------- Scale-in (for badges, completion cards, check marks) ----------
export function ScaleIn({ children, delay = 0, style, from = 0.85 }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: 1, delay, useNativeDriver: ND, speed: 14, bounciness: 10 }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: a.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// ---------- Pop: bounces whenever `trigger` changes (likes, toggles, counters) ----------
export function Pop({ trigger, children, style, amount = 1.28 }) {
  const s = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    s.setValue(1);
    Animated.sequence([
      Animated.timing(s, { toValue: amount, duration: 110, easing: EASE_OUT, useNativeDriver: ND }),
      Animated.spring(s, { toValue: 1, useNativeDriver: ND, speed: 18, bounciness: 14 }),
    ]).start();
  }, [trigger]);
  return <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>;
}

// ---------- Pulse: gentle breathing loop (live dots, recording, streak flame) ----------
export function Pulse({ children, style, min = 0.85, max = 1.08, duration = 900, active = true }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { a.stopAnimation(); a.setValue(0); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(a, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active]);
  return (
    <Animated.View style={[style, { transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [min, max] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Expanding ring behind a live dot
export function LiveRing({ color = colors.negative, size = 8 }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1400, easing: EASE_OUT, useNativeDriver: ND }));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color,
          opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

// ---------- Numbers that count up/down ----------
export function AnimatedNumber({ value, style, format = (n) => String(Math.round(n)), duration = 650 }) {
  const a = useRef(new Animated.Value(value || 0)).current;
  const [shown, setShown] = useState(value || 0);
  useEffect(() => {
    const id = a.addListener(({ value: v }) => setShown(v));
    Animated.timing(a, { toValue: value || 0, duration, easing: EASE_OUT, useNativeDriver: false }).start();
    return () => a.removeListener(id);
  }, [value]);
  return <Text style={style}>{format(shown)}</Text>;
}

// ---------- Progress bar that grows to its value ----------
export function AnimatedBar({ progress = 0, style, fillStyle, delay = 120 }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: Math.max(0, Math.min(1, progress)), duration: 700, delay, easing: EASE_OUT, useNativeDriver: false }).start();
  }, [progress]);
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <Animated.View style={[{ height: '100%' }, fillStyle, { width: a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
    </View>
  );
}

// ---------- Sparkle burst (completion, likes, candles) ----------
export function Burst({ trigger, color = colors.goldLight, count = 10, radius = 46, glyph = '✦', size = 12 }) {
  const a = useRef(new Animated.Value(0)).current;
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setOn(true);
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: 750, easing: EASE_OUT, useNativeDriver: ND }).start(() => setOn(false));
  }, [trigger]);
  if (!on) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      {Array.from({ length: count }, (_, i) => {
        const ang = (i / count) * Math.PI * 2;
        return (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute', color, fontSize: size * (i % 2 ? 0.8 : 1.1),
              opacity: a.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(ang) * radius] }) },
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(ang) * radius] }) },
                { scale: a.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1.1, 0.6] }) },
              ],
            }}
          >
            {glyph}
          </Animated.Text>
        );
      })}
    </View>
  );
}

// ---------- Shimmer skeleton block ----------
export function Shimmer({ style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: ND }));
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[{ backgroundColor: colors.raised, borderRadius: 8 }, style, { opacity: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] }) }]} />;
}

// ---------- Bottom sheet modal: backdrop fades, sheet springs up, both animate out ----------
// Drop-in for <Modal transparent animationType="slide">. The child's own backdrop colour should be
// transparent — this component draws the dim layer so it doesn't slide with the sheet.
export function AnimatedModal({ visible, onRequestClose, children, dim = 'rgba(21,23,43,0.48)', full = false }) {
  const [mounted, setMounted] = useState(visible);
  const a = useRef(new Animated.Value(0)).current;
  const H = Dimensions.get('window').height;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      a.setValue(0);
      Animated.spring(a, { toValue: 1, useNativeDriver: ND, speed: 16, bounciness: 3 }).start();
    } else if (mounted) {
      Animated.timing(a, { toValue: 0, duration: 220, easing: EASE_IN, useNativeDriver: ND }).start(() => setMounted(false));
    }
  }, [visible]);
  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onRequestClose} statusBarTranslucent>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dim, opacity: a }]} />
      <Animated.View
        style={{
          flex: 1,
          opacity: full ? a : 1,
          transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [full ? H * 0.25 : H * 0.6, 0] }) }],
        }}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}
