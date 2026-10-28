import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts } from '../theme';
import { useNav } from '../navigation';

export function Screen({ title, children, back, right, scroll = true, menu, subtitle, padded = true, style }) {
  const nav = useNav();
  const Body = scroll ? ScrollView : View;

  return (
    <View style={[styles.screen, style]}>
      <View style={styles.topbar}>
        {back ? (
          <Pressable onPress={() => nav.pop()} hitSlop={14} style={styles.leftBtn}>
            <View style={styles.navIconBox}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M15 18l-6-6 6-6" stroke={colors.fg} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        ) : menu ? (
          <Pressable onPress={menu} hitSlop={14} style={styles.leftBtn}>
            <View style={styles.navIconBox}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M4 6h16M4 12h16M4 18h16" stroke={colors.fg} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </View>
          </Pressable>
        ) : <View style={styles.leftBtn} />}

        <View style={styles.centerTitleWrapper}>
          {title ? <Text style={styles.topTitle} numberOfLines={1}>{title}</Text> : null}
          {subtitle ? <Text style={styles.topSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>

        <View style={styles.rightBtn}>{right || null}</View>
      </View>

      <Body
        style={{ flex: 1 }}
        contentContainerStyle={scroll ? [padded && styles.pad, { paddingBottom: 40 }] : undefined}
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

export function Section({ title, action, onAction, children, style }) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {action ? (
            <Pressable onPress={onAction} hitSlop={10}>
              <Text style={styles.sectionAction}>{action} ›</Text>
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
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        style,
        pressed && onPress && styles.rowPressed,
      ]}
    >
      {left ? <View style={styles.rowLeft}>{left}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, tint && { color: tint }]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ? (
        <View style={styles.rowRight}>
          {typeof right === 'string' ? <Text style={styles.rowRightText}>{right}</Text> : right}
        </View>
      ) : null}
    </Pressable>
  );
}

export function Pill({ label, active, onPress, tint = colors.gold, small, style }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        small && styles.pillSmall,
        active && [styles.pillActive, { borderColor: tint }],
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          small && { fontSize: 11 },
          active && { color: tint, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Pills({ items, value, onChange, tint = colors.gold, small, style }) {
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
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        isPrimary && styles.btnPrimary,
        isGhost && styles.btnGhost,
        isDanger && styles.btnDanger,
        small && styles.btnSmall,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.82 },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        <Text
          style={[
            styles.btnText,
            isPrimary && styles.btnTextPrimary,
            isGhost && styles.btnTextGhost,
            isDanger && styles.btnTextDanger,
            small && { fontSize: 12 },
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function Input({ style, multiline, ...props }) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      style={[styles.input, multiline && styles.inputMulti, style]}
      multiline={multiline}
      {...props}
    />
  );
}

export function Tag({ label, tint = colors.muted, style }) {
  return (
    <View style={[styles.tag, { borderColor: colors.border, backgroundColor: colors.raised }, style]}>
      <Text style={[styles.tagText, { color: tint }]}>{label}</Text>
    </View>
  );
}

export function Badge({ label, tint = colors.gold }) {
  return (
    <View style={[styles.badge, { backgroundColor: colors.raised, borderColor: colors.border }]}>
      <Text style={[styles.badgeText, { color: tint }]}>{label}</Text>
    </View>
  );
}

export function Spark() {
  return <Text style={styles.spark}>✦</Text>;
}

export function Empty({ title, body, action, onAction }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconBox}>
        <Text style={{ fontSize: 16, color: colors.muted }}>—</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <Button small label={action} onPress={onAction} style={{ marginTop: 14 }} /> : null}
    </View>
  );
}

export function Notice({ text, tint = colors.gold }) {
  return (
    <View style={[styles.notice, { borderColor: colors.border }]}>
      <Text style={[styles.noticeText, { color: tint }]}>✦ {text}</Text>
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
    paddingHorizontal: 16,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.screen,
  },
  leftBtn: {
    width: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rightBtn: {
    width: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  navIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTitleWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  topTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14.5,
    fontWeight: '600',
    color: colors.fg,
    letterSpacing: -0.2,
  },
  topSub: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.muted,
    marginTop: 1,
  },
  pad: {
    paddingHorizontal: 18,
  },
  h1: {
    fontFamily: fonts.sansMedium,
    fontSize: 22,
    fontWeight: '600',
    color: colors.fg,
    letterSpacing: -0.3,
    textAlign: 'center',
    lineHeight: 28,
  },
  h2: {
    fontFamily: fonts.sansMedium,
    fontSize: 17,
    fontWeight: '600',
    color: colors.fg,
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    marginTop: 5,
    textAlign: 'center',
    lineHeight: 18,
  },
  section: {
    marginTop: 24,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '600',
    color: colors.fg,
    letterSpacing: -0.1,
  },
  sectionAction: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  rowPressed: {
    opacity: 0.75,
  },
  rowLeft: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13.5,
    fontWeight: '500',
    color: colors.fg,
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 16,
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
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSmall: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pillActive: {
    backgroundColor: colors.raised,
    borderColor: colors.gold,
  },
  pillText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  btnPrimary: {
    backgroundColor: colors.primaryBg,
  },
  btnGhost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDanger: {
    backgroundColor: colors.negativeFaint,
    borderWidth: 1,
    borderColor: colors.negative,
  },
  btnSmall: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 30,
  },
  btnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13.5,
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
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 13.5,
    fontFamily: fonts.sans,
    color: colors.fg,
  },
  inputMulti: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  tag: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  tagText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    fontWeight: '600',
  },
  spark: {
    fontSize: 12,
    color: colors.gold,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 6,
  },
  emptyIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '600',
    color: colors.fg,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 16,
    maxWidth: 260,
  },
  notice: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  noticeText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
  },
  divider: {
    height: 1,
    backgroundColor: colors.rule,
    marginVertical: 14,
  },
});
