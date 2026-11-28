import { isDarkScheme } from '../palette';
// Fund Me pieces in the Figma design's language, shared by FundMeScreens.js and FundMeMoneyScreens.js.
// Built on the sanctuary tokens (src/design/sanctuary.js) and the profile parts (src/design/profile/parts.js).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icons';
import { alpha } from '../../components/ui';
import { d, df, Tap } from '../sanctuary';

/** Design button: plum pill (primary), paper with a hairline border (ghost) or rose (danger). */
export function FBtn({ label, onPress, kind = 'primary', icon, disabled, small, style, accessibilityLabel }) {
  const box = kind === 'ghost' ? st.ghost : kind === 'danger' ? st.danger : st.primary;
  const text = kind === 'ghost' ? st.ghostText : kind === 'danger' ? st.dangerText : st.primaryText;
  return (
    <Tap
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={[st.btn, small && st.btnSmall, box, disabled && { opacity: 0.45 }, style]}
    >
      {icon}
      <Text style={[st.btnText, small && st.btnTextSmall, text]}>{label}</Text>
    </Tap>
  );
}

const TONES = {
  sage: { bg: d.sage, fg: d.sageDark },
  plum: { bg: d.lavender, fg: d.plumDark },
  danger: { bg: (isDarkScheme() ? '#24171a' : '#fbedea'), fg: d.roseDark },
};

/** Design note box (.review-note): sage by default, with a shield for trust messages. */
export function FNotice({ text, tone = 'sage', icon, style }) {
  const t = TONES[tone] || TONES.sage;
  return (
    <View style={[st.notice, { backgroundColor: t.bg }, style]}>
      {icon ? <Icon name={icon} size={16} color={t.fg} /> : null}
      <Text style={[st.noticeText, { color: t.fg, flex: icon ? 1 : undefined }]}>{text}</Text>
    </View>
  );
}

/** Dashed empty state. */
export function FEmpty({ title, body, action, onAction }) {
  return (
    <View style={st.empty}>
      <Text style={st.emptyTitle}>{title}</Text>
      {body ? <Text style={st.emptyBody}>{body}</Text> : null}
      {action ? <FBtn kind="ghost" small label={action} onPress={onAction} style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

/** Status pill (.badge): tinted background, coloured text. */
export function FBadge({ label, tint = d.muted }) {
  return (
    <View style={[st.badge, { backgroundColor: alpha(tint, 0.14) }]}>
      <Text style={[st.badgeText, { color: tint }]}>{label}</Text>
    </View>
  );
}

/** Small stat tile used in donation and credit summaries. */
export function FKpi({ label, value, tint }) {
  return (
    <View style={st.kpi}>
      <Text style={[st.kpiValue, tint && { color: tint }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={st.kpiLabel}>{label}</Text>
    </View>
  );
}

/** Document tile (PDF) used in story and document lists. */
export function FPdfTile() {
  return (
    <View style={st.pdf}>
      <Text style={st.pdfText}>PDF</Text>
    </View>
  );
}

export const st = StyleSheet.create({
  btn: { height: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  btnSmall: { height: 38, borderRadius: 12, paddingHorizontal: 14 },
  primary: { backgroundColor: d.plum },
  primaryText: { color: '#FFFFFF', fontFamily: df.sansBold },
  ghost: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  ghostText: { color: d.ink, fontFamily: df.sansBold },
  danger: { backgroundColor: (isDarkScheme() ? '#24171a' : '#fbedea'), borderWidth: 1, borderColor: (isDarkScheme() ? '#333333' : '#E9C2BA') },
  dangerText: { color: d.roseDark, fontFamily: df.sansBold },
  btnText: { fontSize: 12, fontFamily: df.sansBold },
  btnTextSmall: { fontSize: 10.5 },

  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 14 },
  noticeText: { fontFamily: df.sans, fontSize: 11, lineHeight: 16 },

  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), borderRadius: 20, padding: 20, alignItems: 'center', backgroundColor: d.paper },
  emptyTitle: { fontFamily: df.display, fontSize: 15, color: d.ink, textAlign: 'center' },
  emptyBody: { fontFamily: df.sans, fontSize: 11.5, lineHeight: 17, color: d.muted, textAlign: 'center', marginTop: 4 },

  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontFamily: df.sansBold, fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase' },

  kpi: { flex: 1, backgroundColor: d.paper, borderRadius: 16, borderWidth: 1, borderColor: d.line, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  kpiValue: { fontFamily: df.display, fontSize: 16, color: d.ink },
  kpiLabel: { fontFamily: df.sans, fontSize: 9.5, color: d.muted, marginTop: 3, textAlign: 'center' },

  pdf: { width: 40, height: 40, borderRadius: 12, backgroundColor: (isDarkScheme() ? '#24171a' : '#fbedea'), alignItems: 'center', justifyContent: 'center' },
  pdfText: { color: d.roseDark, fontFamily: df.sansHeavy, fontSize: 9.5 },
});
