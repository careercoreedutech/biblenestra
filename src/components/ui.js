import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { LinearGradient } from 'expo-linear-gradient';
import { PressScale } from './Motion';

// Adds alpha to a #rgb / #rrggbb colour; falls back to a neutral fill otherwise.
export function alpha(hex, a = 0.12) {
  if (typeof hex !== 'string' || hex[0] !== '#') return colors.raised;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return colors.raised;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function NavButton({ onPress, children, label }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.navIconBox, pressed && { backgroundColor: colors.raised }]}
    >
      {children}
    </Pressable>
  );
}

export function Screen({ title, children, back, right, scroll = true, menu, subtitle, padded = true, style }) {
  const nav = useNav();
  const Body = scroll ? ScrollView : View;

  return (
    <View style={[styles.screen, style]}>
      <View style={styles.topbar}>
        <View style={styles.leftBtn}>
          {back ? (
            <NavButton onPress={() => nav.pop()} label="Back">
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M15 18l-6-6 6-6" stroke={colors.fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </NavButton>
          ) : menu ? (
            <NavButton onPress={menu} label="Menu">
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M4 7h16M4 12h11M4 17h16" stroke={colors.fg} strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </NavButton>
          ) : null}
        </View>

        <View style={styles.centerTitleWrapper}>
          {title ? <Text style={styles.topTitle} numberOfLines={1}>{title}</Text> : null}
          {subtitle ? <Text style={styles.topSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>

        <View style={styles.rightBtn}>{right || null}</View>
      </View>

      <Body
        style={{ flex: 1 }}
        contentContainerStyle={scroll ? [padded && styles.pad, { paddingBottom: 48 }] : undefined}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {scroll ? children : <View style={[{ flex: 1 }, padded && styles.pad]}>{children}</View>}
      </Body>
    </View>
  );
}

export function H1({ children, style }) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}

export function H2({ children, style }) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}

export function Sub({ children, style }) {
  return <Text style={[styles.sub, style]}>{children}</Text>;
}

export function Eyebrow({ children, tint = colors.gold, style }) {
  return <Text style={[styles.eyebrow, { color: tint }, style]}>{children}</Text>;
}

export function Section({ title, action, onAction, children, style }) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {action ? (
            <Pressable onPress={onAction} hitSlop={10} style={({ pressed }) => [styles.sectionActionBtn, pressed && { opacity: 0.6 }]}>
              <Text style={styles.sectionAction}>{action}</Text>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                <Path d="M9 6l6 6-6 6" stroke={colors.primary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ title, subtitle, right, onPress, left, style, tint }) {
  return (
    <PressScale
      onPress={onPress}
      disabled={!onPress}
      scaleTo={0.985}
      style={[styles.row, style]}
    >
      {left ? <View style={styles.rowLeft}>{left}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, tint && { color: tint }]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right === '›' || right === '>' ? (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <Path d="M9 6l6 6-6 6" stroke={colors.faint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : right ? (
        <View style={styles.rowRight}>
          {typeof right === 'string' ? <Text style={styles.rowRightText}>{right}</Text> : right}
        </View>
      ) : onPress ? (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <Path d="M9 6l6 6-6 6" stroke={colors.faint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </PressScale>
  );
}

export function Pill({ label, active, onPress, tint = colors.primary, small, style }) {
  const activeBg = tint === colors.gold || tint === colors.primary ? colors.fg : tint;
  return (
    <PressScale
      onPress={onPress}
      scaleTo={0.93}
      style={[
        styles.pill,
        small && styles.pillSmall,
        active && { backgroundColor: activeBg, borderColor: activeBg },
        style,
      ]}
    >
      <Text style={[styles.pillText, small && { fontSize: 11.5 }, active && styles.pillTextActive]}>{label}</Text>
    </PressScale>
  );
}

export function Pills({ items, value, onChange, tint = colors.primary, small, style }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
    >
      {items.map((it) => (
        <Pill
          key={it}
          label={it}
          small={small}
          active={Array.isArray(value) ? value.includes(it) : value === it}
          onPress={() => onChange(it)}
          tint={tint}
        />
      ))}
    </ScrollView>
  );
}

export function Button({ label, onPress, kind = 'primary', style, small, disabled, icon }) {
  const isPrimary = kind === 'primary';
  const isDanger = kind === 'danger';
  const isGhost = kind === 'ghost';

  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.96}
      style={[
        styles.btn,
        isPrimary && styles.btnPrimary,
        isGhost && styles.btnGhost,
        isDanger && styles.btnDanger,
        small && styles.btnSmall,
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {icon}
        <Text
          style={[
            styles.btnText,
            isPrimary && styles.btnTextPrimary,
            isGhost && styles.btnTextGhost,
            isDanger && styles.btnTextDanger,
            small && { fontSize: 12.5 },
          ]}
        >
          {label}
        </Text>
      </View>
    </PressScale>
  );
}

export function Input({ style, multiline, ...props }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      style={[styles.input, multiline && styles.inputMulti, focused && styles.inputFocused, style]}
      multiline={multiline}
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus && props.onFocus(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur && props.onBlur(e); }}
    />
  );
}

export function Tag({ label, tint = colors.muted, style }) {
  return (
    <View style={[styles.tag, style]}>
      <Text style={[styles.tagText, { color: tint }]}>{label}</Text>
    </View>
  );
}

export function Badge({ label, tint = colors.gold }) {
  return (
    <View style={[styles.badge, { backgroundColor: alpha(tint, 0.12) }]}>
      <Text style={[styles.badgeText, { color: tint }]}>{label}</Text>
    </View>
  );
}

export function Spark({ color = colors.gold }) {
  return <Text style={[styles.spark, { color }]}>✦</Text>;
}

export function Empty({ title, body, action, onAction }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconBox}>
        <Text style={{ fontSize: 18, color: colors.gold }}>✦</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <Button small label={action} onPress={onAction} style={{ marginTop: 16 }} /> : null}
    </View>
  );
}

export function Notice({ text, tint = colors.gold }) {
  return (
    <View style={[styles.notice, { backgroundColor: alpha(tint, 0.09), borderLeftColor: tint }]}>
      <Text style={[styles.noticeText, { color: colors.fg }]}>
        <Text style={{ color: tint }}>✦  </Text>
        {text}
      </Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.screen,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 58,
    backgroundColor: colors.screen,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  leftBtn: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rightBtn: {
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  navIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  centerTitleWrapper: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 6,
  },
  topTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 19,
    color: colors.fg,
    letterSpacing: -0.3,
  },
  topSub: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 1,
  },
  pad: {
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  h1: {
    fontFamily: fonts.serifBold,
    fontSize: 27,
    color: colors.fg,
    letterSpacing: -0.5,
    textAlign: 'center',
    lineHeight: 33,
  },
  h2: {
    fontFamily: fonts.serifBold,
    fontSize: 19,
    color: colors.fg,
    letterSpacing: -0.3,
    lineHeight: 25,
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.muted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 19,
  },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  section: {
    marginTop: 26,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 19,
    color: colors.fg,
    letterSpacing: -0.3,
  },
  sectionActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sectionAction: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.primary,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    ...shadow.sm,
  },
  rowPressed: {
    backgroundColor: colors.raised,
  },
  rowLeft: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '600',
    color: colors.fg,
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 17,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  rowRightText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  pill: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSmall: {
    paddingHorizontal: 12,
    paddingVertical: 5.5,
  },
  pillActive: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  pillText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.muted,
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  btn: {
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnPrimary: {
    backgroundColor: colors.primaryBg,
    ...shadow.sm,
  },
  btnGhost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  btnDanger: {
    backgroundColor: colors.negativeFaint,
  },
  btnSmall: {
    paddingVertical: 7,
    paddingHorizontal: 15,
    minHeight: 34,
  },
  btnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  btnTextPrimary: {
    color: colors.primaryFg,
  },
  btnTextGhost: {
    color: colors.fg,
  },
  btnTextDanger: {
    color: colors.negative,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 14.5,
    fontFamily: fonts.sans,
    color: colors.fg,
  },
  inputFocused: {
    borderColor: colors.primary,
  },
  inputMulti: {
    minHeight: 96,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  tag: {
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.raised,
  },
  tagText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  badgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  spark: {
    fontSize: 12,
    color: colors.gold,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    gap: 6,
  },
  emptyIconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.cardGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 19,
    color: colors.fg,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
  notice: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: 12,
  },
  noticeText: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginVertical: 16,
  },
});

// Depth for dark "night" hero surfaces: indigo gradient + soft radial gold/indigo glows.
// Drop in as the first child of a container that has overflow: 'hidden' and a borderRadius.
export function NightGlow({ intensity = 1 }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['#252A5E', '#181A3B', '#110F23']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="nbGold" cx="88" cy="4" r="55" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#D4A852" stopOpacity={0.26 * intensity} />
            <Stop offset="1" stopColor="#D4A852" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="nbIndigo" cx="8" cy="100" r="70" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#6E7CE6" stopOpacity={0.30 * intensity} />
            <Stop offset="1" stopColor="#6E7CE6" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#nbIndigo)" />
        <Rect x="0" y="0" width="100" height="100" fill="url(#nbGold)" />
      </Svg>
    </View>
  );
}
