// FIND LOVE shared parts: buttons, pills, chips, avatars, tabs, the sub-screen frame, section cards, states, skeletons.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../Icons';
import { PressScale, Shimmer, FadeInUp } from '../Motion';
import { useNav } from '../../navigation';
import { fonts } from '../../theme';
import { love, grad, type, lshadow, ND } from './theme';
import { Crown, Glow, LoveArt, Filigree } from './illustrations';

const GRADS = { primary: grad.heart, gold: grad.gold, dark: grad.vip, wine: grad.wine, rose: grad.rose };

/** Primary call to action. kind: primary (heart gradient) | gold | dark | wine | ghost | soft | danger */
export function LoveButton({ label, onPress, kind = 'primary', icon, small, disabled, style, accessibilityLabel, right }) {
  const g = GRADS[kind];
  const fg = kind === 'glass' ? love.onDark : kind === 'white' ? love.wine : kind === 'ghost' ? love.wine : kind === 'soft' ? love.wine : kind === 'gold' ? '#2A1A05' : kind === 'dark' ? love.goldBright : '#FFFFFF';
  const h = small ? 40 : 52;
  const inner = (
    <View style={[st.btnInner, { minHeight: h, paddingHorizontal: small ? 14 : 18 }]}>
      {icon ? (typeof icon === 'string' ? <View><Icon name={icon} size={small ? 14 : 16} color={fg} fill={kind === 'primary' && icon === 'heart' ? fg : undefined} strokeWidth={2.2} /></View> : icon) : null}
      <Text style={[st.btnText, small && { fontSize: 13.5 }, { color: fg }]} numberOfLines={2}>{label}</Text>
      {right || null}
    </View>
  );
  return (
    <PressScale onPress={onPress} disabled={disabled} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ disabled: !!disabled }}
      style={[st.btn, { borderRadius: h / 2 }, g && kind !== 'dark' && !disabled && (kind === 'gold' ? lshadow.gold : lshadow.glow),
        kind === 'ghost' && st.btnGhost, kind === 'glass' && st.btnGlass, kind === 'white' && st.btnWhite, kind === 'soft' && st.btnSoft, kind === 'danger' && { backgroundColor: love.danger },
        kind === 'dark' && { borderWidth: 1, borderColor: 'rgba(217,176,97,0.55)' }, disabled && { opacity: 0.45 }, style]}>
      {g ? <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: h / 2 }]} /> : null}
      {inner}
    </PressScale>
  );
}

/** Small gold "cost" pill: ◉ 10 */
export function CostPill({ amount, unit, dark, style, free }) {
  return (
    <View style={[st.cost, dark && st.costDark, style]}>
      {free ? null : <View style={st.costCoin}><Text style={st.costCoinText}>✦</Text></View>}
      <Text style={[st.costText, dark && { color: love.goldBright }]} numberOfLines={1}>{free ? 'Free' : `${amount}${unit ? ` ${unit}` : ''}`}</Text>
    </View>
  );
}

/** Faith / meta chip. tone: light (on parchment) | glass (on photos) | gold | rose | wine */
export function LoveChip({ icon, label, tone = 'light', style }) {
  const t = {
    light: [love.card, love.blushLine, love.ink, love.rose],
    glass: ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.28)', '#FFFFFF', '#FFFFFF'],
    gold: [love.goldPale, 'rgba(180,133,47,0.35)', love.goldInk, love.gold],
    rose: [love.blush, love.blushLine, love.wine, love.rose],
    wine: [love.wine, love.wine, '#FFFFFF', love.goldBright],
  }[tone];
  return (
    <View style={[st.chip, { backgroundColor: t[0], borderColor: t[1] }, style]}>
      {icon ? <Icon name={icon} size={12} color={t[3]} strokeWidth={2.2} /> : null}
      <Text style={[st.chipText, { color: t[2] }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Avatar({ uri, size = 44, style }) {
  return uri ? <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: love.blush }, style]} accessibilityIgnoresInvertColors />
    : (
      <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: love.blush, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Icon name="heart" size={size * 0.4} color={love.rose} />
      </View>
    );
}

/** Avatar inside a gradient ring (gold → rose → wine). */
export function RingAvatar({ uri, size = 64, ring = 3, colors: c = grad.ring, gap = 2, style }) {
  const outer = size + (ring + gap) * 2;
  return (
    <View style={[{ width: outer, height: outer }, style]}>
      <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: outer, height: outer, borderRadius: outer / 2, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size + gap * 2, height: size + gap * 2, borderRadius: (size + gap * 2) / 2, backgroundColor: love.paper, alignItems: 'center', justifyContent: 'center' }}>
          <Avatar uri={uri} size={size} />
        </View>
      </LinearGradient>
    </View>
  );
}

export function PlanBadge({ plan, onPress }) {
  const label = plan === 'vip' ? 'VIP' : plan === 'plus' ? 'Plus' : 'Free';
  const body = plan === 'vip' ? (
    <LinearGradient colors={grad.vip} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.plan, { borderColor: 'rgba(217,176,97,0.6)' }]}>
      <Crown size={14} /><Text style={[st.planText, { color: love.goldBright }]}>VIP</Text>
    </LinearGradient>
  ) : plan === 'plus' ? (
    <LinearGradient colors={grad.rose} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.plan, { borderColor: 'transparent' }]}>
      <Icon name="star" size={12} color="#FFFFFF" fill="#FFFFFF" /><Text style={[st.planText, { color: '#FFFFFF' }]}>Plus</Text>
    </LinearGradient>
  ) : (
    <View style={[st.plan, { backgroundColor: love.card, borderColor: love.blushLine }]}>
      <Icon name="sparkles" size={13} color={love.gold} /><Text style={[st.planText, { color: love.wine }]}>Free</Text>
    </View>
  );
  return (
    <PressScale onPress={onPress} scaleTo={0.94} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Plan: ${label}. See Dating Plus and VIP`}>{body}</PressScale>
  );
}

/** Round icon button (44 pt). */
export function RoundBtn({ icon, onPress, label, active, children, dark, size = 44, style }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.9} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={[st.round, { width: size, height: size, borderRadius: size / 2 }, dark && st.roundDark, active && { borderColor: 'transparent' }, style]}>
      {active ? <LinearGradient colors={grad.heart} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} /> : null}
      {children || <View><Icon name={icon} size={18} color={active ? '#FFFFFF' : dark ? '#FFFFFF' : love.wine} /></View>}
    </PressScale>
  );
}

/** Discover | Likes | Matches — serif labels, a wine pill that glides under the active tab, count badges. */
export function LoveTabs({ value, onChange, options }) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const tabW = w ? (w - 8) / options.length : 0;
  const placed = useRef(false);
  useEffect(() => {
    if (!tabW) return;
    if (!placed.current) { x.setValue(idx * tabW); placed.current = true; return; }
    Animated.spring(x, { toValue: idx * tabW, useNativeDriver: ND, speed: 18, bounciness: 6 }).start();
  }, [idx, tabW]);
  return (
    <View style={st.tabs} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {tabW ? (
        <Animated.View style={[st.tabPill, { width: tabW, transform: [{ translateX: x }] }]}>
          <LinearGradient colors={grad.wine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 999 }]} />
        </Animated.View>
      ) : null}
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.count ? `${o.label}, ${o.count}` : o.label}>
            <Text style={[st.tabText, on && st.tabTextOn]} numberOfLines={1}>{o.label}</Text>
            {o.count ? <View style={[st.tabCount, on && { backgroundColor: love.goldBright }]}><Text style={[st.tabCountText, on && { color: love.plum }]}>{o.count > 99 ? '99+' : o.count}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Sub-screen frame: parchment with a blush glow, serif title + "Find Love" eyebrow, round back button. */
export function LoveScreen({ title, eyebrow = 'Find Love', right, children, scroll = true, footer, onBack, contentStyle }) {
  const nav = useNav();
  const Body = scroll ? ScrollView : View;
  return (
    <View style={st.screen}>
      <Glow size={420} color={love.roseSoft} opacity={0.35} style={{ top: -230, right: -140 }} />
      <Glow size={300} color={love.goldPale} opacity={0.6} style={{ top: -170, left: -120 }} />
      <View style={st.top}>
        <RoundBtn icon="chevron-left" label="Back" onPress={onBack || (() => nav.pop())} size={44} />
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 6 }}>
          {eyebrow ? <Text style={[type.eyebrow, { fontSize: 10 }]} numberOfLines={1}>{eyebrow}</Text> : null}
          {title ? <Text style={st.topTitle} numberOfLines={1}>{title}</Text> : null}
        </View>
        <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right || null}</View>
      </View>
      <Body style={{ flex: 1 }} {...(scroll ? { contentContainerStyle: [st.pad, contentStyle], keyboardShouldPersistTaps: 'handled', showsVerticalScrollIndicator: false } : {})}>
        {scroll ? children : <View style={[{ flex: 1 }, contentStyle]}>{children}</View>}
      </Body>
      {footer || null}
    </View>
  );
}

/** A calm card with an optional eyebrow / serif title. */
export function SectionCard({ eyebrow, title, hint, right, children, style, tone }) {
  return (
    <View style={[st.section, tone === 'blush' && { backgroundColor: love.blush, borderColor: love.blushLine }, style]}>
      {eyebrow || title || right ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flex: 1 }}>
            {eyebrow ? <Text style={type.eyebrow}>{eyebrow}</Text> : null}
            {title ? <Text style={st.sectionTitle}>{title}</Text> : null}
          </View>
          {right || null}
        </View>
      ) : null}
      {hint ? <Text style={st.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

/** Notice strip for profile states (hidden / in review / photo needed). */
export function LoveBanner({ icon = 'shield', text, tone = 'gold', onPress }) {
  const t = tone === 'danger' ? ['#F8E1DF', love.danger, love.danger] : tone === 'rose' ? [love.blush, love.rose, love.wine] : [love.goldPale, love.gold, love.goldInk];
  const body = (
    <View style={[st.banner, { backgroundColor: t[0] }]}>
      <View style={[st.bannerIcon, { borderColor: t[1] }]}><Icon name={icon} size={13} color={t[1]} /></View>
      <Text style={[st.bannerText, { color: t[2] }]}>{text}</Text>
      {onPress ? <Icon name="chevron-right" size={14} color={t[1]} /> : null}
    </View>
  );
  return onPress ? <PressScale onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={text}>{body}</PressScale> : body;
}

/** Empty / error state with an SVG illustration and kind copy. */
export function LoveState({ art = 'stack', title, body, children, style }) {
  return (
    <FadeInUp style={[{ alignItems: 'center', paddingVertical: 18, paddingHorizontal: 8 }, style]}>
      <LoveArt kind={art} size={140} />
      <Text style={st.stateTitle}>{title}</Text>
      <Filigree width={120} style={{ marginTop: 8 }} />
      {body ? <Text style={st.stateBody}>{body}</Text> : null}
      {children ? <View style={{ alignSelf: 'stretch', marginTop: 14, gap: 8 }}>{children}</View> : null}
    </FadeInUp>
  );
}

export const Skeleton = {
  Card: ({ height }) => (
    <View style={[st.skelCard, { height }]}>
      <Shimmer style={[StyleSheet.absoluteFill, { borderRadius: 28, backgroundColor: love.blush }]} />
      <View style={{ position: 'absolute', left: 20, bottom: 24, right: 20, gap: 10 }}>
        <Shimmer style={{ width: '55%', height: 26, borderRadius: 8, backgroundColor: love.blushDeep }} />
        <Shimmer style={{ width: '35%', height: 14, borderRadius: 7, backgroundColor: love.blushDeep }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[80, 100, 70].map((w) => <Shimmer key={w} style={{ width: w, height: 24, borderRadius: 12, backgroundColor: love.blushDeep }} />)}
        </View>
      </View>
    </View>
  ),
  Grid: () => (
    <View style={st.skelGrid}>{[0, 1, 2, 3].map((k) => <Shimmer key={k} style={{ width: '48%', height: 220, borderRadius: 20, backgroundColor: love.blush }} />)}</View>
  ),
  List: ({ rows = 4 }) => (
    <View style={{ gap: 14, marginTop: 6 }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>{[0, 1, 2, 3].map((k) => <Shimmer key={k} style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: love.blush }} />)}</View>
      {Array.from({ length: rows }, (_, k) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Shimmer style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: love.blush }} />
          <View style={{ flex: 1, gap: 8 }}>
            <Shimmer style={{ width: '45%', height: 14, borderRadius: 7, backgroundColor: love.blush }} />
            <Shimmer style={{ width: '75%', height: 12, borderRadius: 6, backgroundColor: love.blush }} />
          </View>
        </View>
      ))}
    </View>
  ),
  Block: ({ height = 120 }) => <Shimmer style={{ height, borderRadius: 22, backgroundColor: love.blush, marginTop: 12 }} />,
};

/** Selectable pills (single or multi). */
export function Choice({ items, value, onChange, multi, labels }) {
  const on = (k) => (multi ? (value || []).includes(k) : value === k);
  return (
    <View style={st.choiceWrap}>
      {items.map((k) => (
        <PressScale key={k} onPress={() => onChange(multi ? (on(k) ? value.filter((x) => x !== k) : [...(value || []), k]) : k)} scaleTo={0.94}
          style={[st.choice, on(k) && st.choiceOn]} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on(k) }} accessibilityLabel={labels ? labels[k] : k}>
          {on(k) ? <LinearGradient colors={grad.wine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 999 }]} /> : null}
          {on(k) ? <View><Icon name="check" size={12} color={love.goldBright} strokeWidth={2.8} /></View> : null}
          <Text style={[st.choiceText, on(k) && st.choiceTextOn]}>{labels ? labels[k] : k}</Text>
        </PressScale>
      ))}
    </View>
  );
}

export const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: love.paper, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 64, paddingVertical: 8 },
  topTitle: { fontFamily: fonts.serifBold, fontSize: 21, color: love.ink, letterSpacing: -0.3, marginTop: 1 },
  pad: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 56 },
  btn: { overflow: 'hidden', justifyContent: 'center', alignSelf: 'stretch' },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  btnText: { fontSize: 15.5, fontWeight: '800', letterSpacing: 0.2, textAlign: 'center', flexShrink: 1 },
  btnGhost: { borderWidth: 1.5, borderColor: 'rgba(107,31,55,0.28)', backgroundColor: 'rgba(255,255,255,0.7)' },
  btnSoft: { backgroundColor: love.blush },
  btnWhite: { backgroundColor: '#FFFFFF' },
  btnGlass: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.32)', backgroundColor: 'rgba(255,255,255,0.07)' },
  cost: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 3, paddingRight: 7, height: 20, borderRadius: 10, backgroundColor: love.goldPale, borderWidth: 1, borderColor: 'rgba(180,133,47,0.45)' },
  costDark: { backgroundColor: 'rgba(30,10,21,0.85)', borderColor: 'rgba(217,176,97,0.6)' },
  costCoin: { width: 14, height: 14, borderRadius: 7, backgroundColor: love.gold, alignItems: 'center', justifyContent: 'center' },
  costCoinText: { color: '#FFF6E0', fontSize: 8, fontWeight: '900', marginTop: -1 },
  costText: { fontSize: 11, fontWeight: '900', color: love.goldInk },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, maxWidth: '100%' },
  chipText: { fontSize: 12, fontWeight: '700' },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: 1, overflow: 'hidden' },
  planText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  round: { backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...lshadow.sm },
  roundDark: { backgroundColor: 'rgba(30,10,21,0.45)', borderColor: 'rgba(255,255,255,0.25)' },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine, ...lshadow.sm },
  tabPill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999, overflow: 'hidden' },
  tab: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabText: { fontFamily: fonts.serifBold, fontSize: 16, color: love.wine },
  tabTextOn: { color: '#FFFFFF' },
  tabCount: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: love.blush, alignItems: 'center', justifyContent: 'center' },
  tabCountText: { fontSize: 11, fontWeight: '900', color: love.wine },
  section: { backgroundColor: love.card, borderRadius: 24, borderWidth: 1, borderColor: love.blushLine, padding: 18, marginTop: 14, ...lshadow.sm },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 21, color: love.ink, marginTop: 2, letterSpacing: -0.2 },
  hint: { fontSize: 12.5, color: love.muted, marginTop: 4, lineHeight: 18 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16 },
  bannerIcon: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  stateTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: love.ink, textAlign: 'center', marginTop: 10, letterSpacing: -0.3 },
  stateBody: { fontSize: 14, lineHeight: 21, color: love.muted, textAlign: 'center', marginTop: 8, maxWidth: 320 },
  skelCard: { borderRadius: 28, overflow: 'hidden' },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: love.blushLine, backgroundColor: love.card, overflow: 'hidden' },
  choiceOn: { borderColor: 'transparent' },
  choiceText: { fontSize: 13.5, color: love.ink, fontWeight: '600' },
  choiceTextOn: { color: '#FFFFFF', fontWeight: '700' },
});
