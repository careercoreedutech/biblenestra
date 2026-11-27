// FIND LOVE action bar: undo · pass · super like (gold star) · like (heart gradient) · priority like — coin costs as gold pills.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../Icons';
import { PressScale } from '../Motion';
import { love, grad, lshadow } from './theme';
import { HeartShape } from './illustrations';
import { CostPill } from './parts';

const STYLES = {
  pass: { g: null, bg: love.card, icon: 'x', color: love.pass, border: love.blushLine },
  super: { g: grad.gold, icon: 'star', color: '#FFFFFF', fill: true },
  like: { g: grad.heart, icon: 'heart', color: '#FFFFFF', fill: true },
  priority: { g: grad.plum, icon: 'sparkles', color: love.goldBright, border: 'rgba(244,216,140,0.6)' },
  undo: { g: null, bg: love.card, icon: 'repost', color: love.gold, border: love.blushLine },
};

export function ActionBtn({ kind, size, label, onPress, disabled, cost, lock }) {
  const v = STYLES[kind];
  const big = kind === 'like' || kind === 'pass';
  return (
    <View style={{ width: Math.max(size, 44), alignItems: 'center' }}>
      <PressScale onPress={onPress} disabled={disabled} scaleTo={0.86} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} hitSlop={6}
        style={[s.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: v.bg || 'transparent', borderColor: v.border || 'transparent' },
          kind === 'like' ? lshadow.glow : kind === 'super' ? lshadow.gold : lshadow.md, disabled && { opacity: 0.55 }]}>
        {v.g ? <LinearGradient colors={v.g} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} /> : null}
        <View>{kind === 'like' ? <HeartShape size={size * 0.48} color="#FFFFFF" />
          : <Icon name={v.icon} size={size * (big ? 0.42 : 0.44)} color={v.color} fill={v.fill ? v.color : undefined} strokeWidth={kind === 'pass' ? 2.8 : 2.2} />}</View>
        {/* soft inner highlight */}
        {v.g ? <View pointerEvents="none" style={[s.shine, { width: size * 0.6, height: size * 0.28, borderRadius: size, top: size * 0.08 }]} /> : null}
      </PressScale>
      {cost != null ? <CostPill amount={cost} style={s.pill} /> : null}
      {lock ? <View style={s.lock}><Icon name="lock" size={9} color="#FFFFFF" strokeWidth={2.4} /></View> : null}
    </View>
  );
}

export function ActionBar({ children }) {
  return <View style={s.bar}>{children}</View>;
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', marginTop: 16, paddingHorizontal: 4 },
  btn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'visible' },
  shine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.16)' },
  pill: { position: 'absolute', bottom: -10 },
  lock: { position: 'absolute', top: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: love.wine, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: love.paper },
});
