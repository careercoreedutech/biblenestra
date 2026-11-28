import { isDarkScheme } from '../palette';
// Shared pieces for the Profile, Create, Learn, Wallet and settings screens, in the Figma design's language
// (src/design/sanctuary.js tokens). DScreen is the design page shell (ivory page, PageHeader, scroll).
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../../components/Icons';
import { d, df, k, Tap, PageHeader } from '../sanctuary';
import { colors } from '../../theme'; // APPEARANCE (item 14): palette tokens

/** Design page: ivory background, .page-header, scrolling content. */
export function DScreen({ title, subtitle, back, onBack, action, children, style }) {
  return (
    <View style={[k.screen, style]}>
      <ScrollView contentContainerStyle={[k.scroll, { paddingTop: 8, paddingBottom: 48 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <PageHeader title={title} subtitle={subtitle} back={back} onBack={onBack} action={action} />
        {children}
      </ScrollView>
    </View>
  );
}

/** Underlined tab row (.activity-tabs): active tab in plum with a 2px rule. */
export function DTabs({ items, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs}>
      {items.map((it) => {
        const on = it === value;
        return (
          <Pressable key={it} onPress={() => onChange(it)} accessibilityRole="tab" accessibilityState={{ selected: on }} hitSlop={4} style={[st.tab, on && st.tabOn]}>
            <Text style={[st.tabText, on && st.tabTextOn]}>{it}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Design toggle: 42x24 track, plum when on, white knob. */
export function DToggle({ value, onChange, disabled, accessibilityLabel }) {
  return (
    <Pressable
      onPress={() => { if (!disabled && onChange) onChange(!value); }}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={[st.toggle, value && st.toggleOn, disabled && { opacity: 0.5 }]}
    >
      <View style={[st.knob, value && st.knobOn]} />
    </Pressable>
  );
}

/** Design input (.field-label input): 52px paper field, 14px radius, hairline border. */
export function DInput({ multiline, style, ...rest }) {
  return (
    <TextInput
      placeholderTextColor={d.muted}
      selectionColor={d.plum}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      {...rest}
      style={[st.input, multiline && st.inputMulti, style]}
    />
  );
}

/** .field-label caption above an input. */
export function DLabel({ children, style }) {
  return <Text style={[st.label, style]}>{children}</Text>;
}

/** Card surface (paper, hairline border, rounded). */
export function DCard({ children, style }) {
  return <View style={[st.card, style]}>{children}</View>;
}

/** .settings-list / .account-list container: hairline top rule; rows draw their own bottom rule. */
export function DList({ children, style }) {
  return <View style={[st.list, style]}>{children}</View>;
}

/** One row of a DList: tinted icon tile, serif title, muted subtitle and a disclosure chevron. */
export function DRow({ icon, title, subtitle, right, onPress, danger, style, accessibilityLabel }) {
  const body = (
    <>
      {icon ? (
        <View style={st.rowIcon}>
          <Icon name={icon} size={18} color={danger ? '#B33D3D' : d.plum} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.rowTitle, danger && { color: '#B33D3D' }]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={st.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right != null ? right : null}
      {onPress && right == null ? <Icon name="chevron-right" size={15} color={isDarkScheme() ? '#8A7A6C' : '#AAA6AD'} /> : null}
    </>
  );
  if (!onPress) return <View style={[st.row, style]}>{body}</View>;
  return <Tap onPress={onPress} accessibilityLabel={accessibilityLabel || title} style={[st.row, style]}>{body}</Tap>;
}

/** Plum pill / full-width primary button in the design's style. */
export function DButton({ label, onPress, disabled, icon, style, small }) {
  return (
    <Tap
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      style={[st.button, small && st.buttonSmall, disabled && { opacity: 0.45 }, style]}
    >
      {icon}
      <Text style={[st.buttonText, small && { fontSize: 10 }]}>{label}</Text>
    </Tap>
  );
}

export const st = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 3, paddingVertical: 13, paddingRight: 18 },
  tab: { paddingHorizontal: 9, paddingVertical: 9, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: d.plum },
  tabText: { color: d.muted, fontSize: 11, fontFamily: df.sansBold },
  tabTextOn: { color: d.plum },

  toggle: { width: 42, height: 24, borderRadius: 12, padding: 3, backgroundColor: (isDarkScheme() ? '#4D3D30' : '#D8CFC5'), justifyContent: 'center', alignItems: 'flex-start' },
  toggleOn: { backgroundColor: d.plum, alignItems: 'flex-end' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surfaceWhite },
  knobOn: {},

  input: { height: 52, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, color: d.ink, fontSize: 12, fontFamily: df.sans },
  inputMulti: { height: undefined, minHeight: 120, paddingTop: 13, paddingBottom: 13 },
  label: { marginTop: 18, marginBottom: 8, color: (isDarkScheme() ? '#F3E9DC' : '#4C3D32'), fontSize: 10, fontFamily: df.sansBold },

  card: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20, padding: 16 },

  list: { borderTopWidth: 1, borderTopColor: d.line },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: d.line },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  rowTitle: { fontFamily: df.display, fontSize: 13, lineHeight: 17, color: d.ink },
  rowSub: { fontFamily: df.sans, fontSize: 10, lineHeight: 14, color: d.muted, marginTop: 2 },

  button: { height: 52, borderRadius: 14, backgroundColor: d.plum, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  buttonSmall: { height: 36, borderRadius: 12, paddingHorizontal: 14 },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontFamily: df.sansBold },
});
