import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { useNav } from '../navigation';

export function Screen({ title, children, back, right, scroll = true, menu, subtitle, padded = true, style }) {
  const nav = useNav();
  const Body = scroll ? ScrollView : View;
  return (
    <View style={[styles.screen, style]}>
      <View style={styles.topbar}>
        {back ? (
          <Pressable onPress={() => nav.pop()} hitSlop={12} style={styles.leftBtn}><Text style={styles.back}>‹</Text></Pressable>
        ) : menu ? (
          <Pressable onPress={menu} hitSlop={12} style={styles.leftBtn}><Text style={styles.menu}>☰</Text></Pressable>
        ) : <View style={styles.leftBtn} />}
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.topSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={styles.rightBtn}>{right || null}</View>
      </View>
      <Body style={{ flex: 1 }} contentContainerStyle={scroll ? [padded && styles.pad, { paddingBottom: 24 }] : undefined} keyboardShouldPersistTaps="handled">
        {scroll ? children : <View style={[{ flex: 1 }, padded && styles.pad]}>{children}</View>}
      </Body>
    </View>
  );
}

export function H1({ children, style }) { return <Text style={[styles.h1, style]}>{children}</Text>; }
export function Sub({ children, style }) { return <Text style={[styles.sub, style]}>{children}</Text>; }
export function Section({ title, action, onAction, children, style }) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {action ? <Pressable onPress={onAction} hitSlop={8}><Text style={styles.sectionAction}>{action}</Text></Pressable> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ title, subtitle, right, onPress, left, style, tint }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, style, pressed && onPress && { opacity: 0.75 }]}>
      {left ? <View style={styles.rowLeft}>{left}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, tint && { color: tint }]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.rowRight}>{typeof right === 'string' ? <Text style={styles.rowRightText}>{right}</Text> : right}</View> : null}
    </Pressable>
  );
}

export function Pill({ label, active, onPress, tint, small }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, small && styles.pillSmall, active && { backgroundColor: tint || colors.accent, borderColor: tint || colors.accent }]}>
      <Text style={[styles.pillText, small && { fontSize: 10 }, active && { color: tint ? '#1b1715' : '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Pills({ items, value, onChange, tint, small, style }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {items.map((it) => (
        <Pill key={it} label={it} small={small} active={Array.isArray(value) ? value.includes(it) : value === it} onPress={() => onChange(it)} tint={tint} />
      ))}
    </ScrollView>
  );
}

export function Button({ label, onPress, kind = 'primary', style, small, disabled }) {
  const k = kind;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.btn, small && styles.btnSmall, k === 'ghost' && styles.btnGhost, k === 'danger' && styles.btnDanger, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }, style]}>
      <Text style={[styles.btnText, small && { fontSize: 12 }, k === 'ghost' && { color: colors.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Input({ style, multiline, ...props }) {
  return <TextInput placeholderTextColor={colors.muted} style={[styles.input, multiline && styles.inputMulti, style]} multiline={multiline} {...props} />;
}

export function Tag({ label, tint, style }) {
  return (
    <View style={[styles.tag, tint && { borderColor: tint }, style]}>
      <Text style={[styles.tagText, tint && { color: tint }]}>{label}</Text>
    </View>
  );
}

export function Badge({ label, tint = colors.teal }) {
  return <View style={[styles.badge, { backgroundColor: tint + '22', borderColor: tint + '66' }]}><Text style={[styles.badgeText, { color: tint }]}>{label}</Text></View>;
}

export function Spark() { return <Text style={styles.spark}>✦·</Text>; }

export function Empty({ title, body, action, onAction }) {
  return (
    <View style={styles.empty}>
      <Spark />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <Button small label={action} onPress={onAction} style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

export function Notice({ text, tint = colors.amber }) {
  return <View style={[styles.notice, { borderColor: tint + '66' }]}><Text style={[styles.noticeText, { color: tint }]}>{text}</Text></View>;
}

export function Divider() { return <View style={styles.divider} />; }

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screen },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, minHeight: 44 },
  leftBtn: { width: 36, alignItems: 'flex-start' },
  rightBtn: { width: 36, alignItems: 'flex-end' },
  back: { fontSize: 26, color: colors.muted, lineHeight: 28, marginTop: -4 },
  menu: { fontSize: 18, color: colors.muted },
  topTitle: { fontSize: 13, fontWeight: '500', color: colors.fg },
  topSub: { fontSize: 10, color: colors.muted, marginTop: 2 },
  pad: { paddingHorizontal: 18 },
  h1: { fontSize: 22, fontWeight: '600', color: colors.fg, letterSpacing: -0.2, textAlign: 'center' },
  sub: { fontSize: 11.5, color: colors.muted, marginTop: 6, textAlign: 'center' },
  section: { marginTop: 22 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: colors.fg, letterSpacing: 0.3 },
  sectionAction: { fontSize: 11, color: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.tabLine },
  rowLeft: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.cardTop, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  rowTitle: { fontSize: 13.5, color: colors.fg, fontWeight: '500' },
  rowSub: { fontSize: 11, color: colors.muted, marginTop: 3, lineHeight: 15 },
  rowRight: { alignItems: 'flex-end' },
  rowRightText: { fontSize: 11, color: colors.muted },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cardBottom },
  pillSmall: { paddingHorizontal: 9, paddingVertical: 5 },
  pillText: { fontSize: 11.5, color: colors.fg },
  btn: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center' },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  btnGhost: { backgroundColor: colors.cardBottom, borderWidth: 1, borderColor: colors.line },
  btnDanger: { backgroundColor: '#8a2f2f' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13.5 },
  input: { backgroundColor: colors.input, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 12.5, color: colors.fg },
  inputMulti: { minHeight: 90, textAlignVertical: 'top' },
  tag: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { fontSize: 9.5, color: colors.muted },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 9.5, fontWeight: '600' },
  spark: { fontSize: 11, color: colors.muted, letterSpacing: 1 },
  empty: { alignItems: 'center', paddingVertical: 36, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: colors.fg, marginTop: 6 },
  emptyBody: { fontSize: 11.5, color: colors.muted, textAlign: 'center', lineHeight: 16, maxWidth: 260 },
  notice: { borderWidth: 1, borderRadius: 10, padding: 10, backgroundColor: colors.cardBottom, marginTop: 10 },
  noticeText: { fontSize: 11, lineHeight: 15 },
  divider: { height: 1, backgroundColor: colors.tabLine, marginVertical: 12 },
});
