import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
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
            <View style={styles.iconCircle}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M15 18l-6-6 6-6" stroke={colors.fg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        ) : menu ? (
          <Pressable onPress={menu} hitSlop={14} style={styles.leftBtn}>
            <View style={styles.iconCircle}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M4 6h16M4 12h16M4 18h16" stroke={colors.fg} strokeWidth={2} strokeLinecap="round" />
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
        contentContainerStyle={scroll ? [padded && styles.pad, { paddingBottom: 36 }] : undefined}
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
      {active ? (
        <View style={[styles.pillActiveGlow, { backgroundColor: tint + '22' }]} />
      ) : null}
      <Text
        style={[
          styles.pillText,
          small && { fontSize: 11 },
          active && { color: tint, fontWeight: '700' },
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
        small && styles.btnSmall,
        isGhost && styles.btnGhost,
        isDanger && styles.btnDanger,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={['#eb833c', '#cb5c18']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}

      {/* Top subtle highlight */}
      <View style={styles.btnHighlight} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        <Text
          style={[
            styles.btnText,
            small && { fontSize: 12 },
            isGhost && { color: colors.fg },
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
      placeholderTextColor={colors.muted}
      style={[styles.input, multiline && styles.inputMulti, style]}
      multiline={multiline}
      {...props}
    />
  );
}

export function Tag({ label, tint = colors.muted, style }) {
  return (
    <View style={[styles.tag, { borderColor: tint + '44', backgroundColor: tint + '12' }, style]}>
      <Text style={[styles.tagText, { color: tint }]}>{label}</Text>
    </View>
  );
}

export function Badge({ label, tint = colors.teal }) {
  return (
    <View style={[styles.badge, { backgroundColor: tint + '18', borderColor: tint + '55' }]}>
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
      <View style={styles.emptySparkBadge}>
        <Text style={{ fontSize: 18, color: colors.gold }}>✦</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <Button small label={action} onPress={onAction} style={{ marginTop: 14 }} /> : null}
    </View>
  );
}

export function Notice({ text, tint = colors.gold }) {
  return (
    <View style={[styles.notice, { borderColor: tint + '44' }]}>
      <LinearGradient
        colors={['rgba(35, 29, 25, 0.7)', 'rgba(23, 19, 17, 0.7)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
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
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 50,
    borderBottomWidth: 1,
    borderBottomColor: colors.tabLine,
  },
  leftBtn: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rightBtn: {
    width: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTitleWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  topTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 15,
    color: colors.fg,
    letterSpacing: -0.2,
  },
  topSub: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  pad: {
    paddingHorizontal: 20,
  },
  h1: {
    fontFamily: fonts.serifBold,
    fontSize: 24,
    color: colors.fg,
    letterSpacing: -0.4,
    textAlign: 'center',
    lineHeight: 30,
  },
  h2: {
    fontFamily: fonts.serifBold,
    fontSize: 18,
    color: colors.fg,
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 17,
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
    fontSize: 14.5,
    color: colors.fg,
    letterSpacing: -0.1,
  },
  sectionAction: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.gold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowPressed: {
    opacity: 0.75,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  rowLeft: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.cardTop,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lineLight,
  },
  rowTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.fg,
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 3,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineLight,
    backgroundColor: 'rgba(34, 28, 25, 0.7)',
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSmall: {
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  pillActive: {
    backgroundColor: 'rgba(229, 184, 105, 0.1)',
  },
  pillActiveGlow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  pillText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.fg,
    letterSpacing: 0.1,
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  btnSmall: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 11,
  },
  btnGhost: {
    backgroundColor: 'rgba(34, 28, 25, 0.8)',
    borderColor: colors.lineLight,
    shadowOpacity: 0,
  },
  btnDanger: {
    backgroundColor: '#8a2f2f',
    borderColor: '#b44a4a',
  },
  btnHighlight: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  btnText: {
    fontFamily: fonts.sansMedium,
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.2,
  },
  input: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13.5,
    fontFamily: fonts.sans,
    color: colors.fg,
  },
  inputMulti: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  tag: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  spark: {
    fontSize: 13,
    color: colors.gold,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptySparkBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(229, 184, 105, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 16,
    color: colors.fg,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },
  notice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginTop: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  noticeText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 16,
  },
});
