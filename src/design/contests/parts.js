import { isDarkScheme } from '../palette';
// Shared pieces for the Contest Centre screens (Contests, Organize/Judge, Battles) in the Figma design's language.
// Built on src/design/sanctuary.js tokens. Keeps the old call shapes (Screen / Section / Button / Pills) so the
// screens' logic reads the same as before.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { d, df, k, Tap, PageHeader, SectionTitle } from '../sanctuary';
import { useNav } from '../../navigation';

/** Design page: ivory page, .page-header, scrolling content (optional pull-to-refresh). */
export function Screen({ title, subtitle, back, right, refreshControl, children }) {
  const nav = useNav();
  return (
    <View style={k.screen}>
      <ScrollView contentContainerStyle={[k.scroll, { paddingTop: 8, paddingBottom: 48 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
        <PageHeader title={title} subtitle={subtitle} back={back} onBack={() => nav.pop()} action={right === undefined ? undefined : right} />
        {children}
      </ScrollView>
    </View>
  );
}

/** .section-title + content. `action` is a link label, `onAction` its handler. */
export function Section({ title, action, onAction, children }) {
  return (
    <View>
      <SectionTitle title={title} link={action} onLink={onAction} />
      {children}
    </View>
  );
}

/** Design buttons: plum pill (primary), outlined (ghost) or red (danger). */
export function Button({ label, onPress, kind = 'primary', disabled, icon, style }) {
  const tone = kind === 'danger' ? cs.btnDanger : kind === 'ghost' ? cs.btnGhost : cs.btnPrimary;
  return (
    <Tap onPress={disabled ? undefined : onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[cs.btn, tone, disabled && { opacity: 0.45 }, style]}>
      {icon}
      <Text style={[cs.btnText, kind === 'ghost' && { color: d.ink }]}>{label}</Text>
    </Tap>
  );
}

/** Horizontal chip row (design filter chips). Items are labels; `value` is the selected label. */
export function Pills({ items, value, onChange, style }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={{ gap: 8, paddingRight: 18 }}>
      {items.map((it) => {
        const on = it === value;
        return (
          <Tap key={it} onPress={() => onChange(it)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[cs.pill, on && cs.pillOn]}>
            <Text style={[cs.pillText, on && cs.pillTextOn]}>{it}</Text>
          </Tap>
        );
      })}
    </ScrollView>
  );
}

const cs = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, paddingHorizontal: 18, borderRadius: 999 },
  btnPrimary: { backgroundColor: d.plum },
  btnGhost: { backgroundColor: (isDarkScheme() ? 'rgba(30,24,19,0.78)' : 'rgba(255,255,255,0.78)'), borderWidth: 1, borderColor: d.line },
  btnDanger: { backgroundColor: '#B33D3D' },
  btnText: { fontFamily: df.sansBold, fontSize: 14, color: '#FFFFFF' },
  pill: { paddingHorizontal: 14, height: 34, borderRadius: 999, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, justifyContent: 'center' },
  pillOn: { backgroundColor: d.plum, borderColor: d.plum },
  pillText: { fontFamily: df.sansBold, fontSize: 12.5, color: d.ink },
  pillTextOn: { color: '#FFFFFF' },
});
