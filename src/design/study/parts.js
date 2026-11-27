// Shared pieces for the study, daily and activity screens (Sermon Studio, Transcript, Lesson, Plan,
// Welcome setup, Daily Bread, Activity), in the Figma design's language (src/design/sanctuary.js tokens).
// Each piece keeps the props of the local helper it replaces, so the screen logic is unchanged.
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icons';
import { colors } from '../../theme';
import { alpha } from '../../components/ui';
import { EASE_OUT } from '../../components/Motion';
import { useNav } from '../../navigation';
import { DScreen, DInput, DLabel, DCard } from '../profile/parts';
import { d, df, Grad, Tap, Eyebrow as KitEyebrow, SectionTitle, gradients } from '../sanctuary';

const ND = Platform.OS !== 'web';
const WAVE_MAX = 34;

/** Design page shell: ivory page, .page-header with back or action on the right. */
export function SPage({ title, subtitle, back, right, action, children }) {
  const nav = useNav();
  return (
    <DScreen title={title} subtitle={subtitle} back={back} onBack={() => nav.pop()} action={action !== undefined ? action : right !== undefined ? right : null}>
      {children}
    </DScreen>
  );
}

/** .section-title above a block of content. */
export function SSection({ title, children, style }) {
  return (
    <View style={style}>
      <SectionTitle title={title} />
      {children}
    </View>
  );
}

/** Paper card (.card) with a 16px inner padding. */
export function SCard({ children, style }) {
  return <DCard style={[ss.card, style]}>{children}</DCard>;
}

/** Paper card holding a list: rows are separated by hairlines. */
export function SGroup({ children, style }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[ss.group, style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={ss.groupSep} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** Dark-brown to orange hero panel (.verse-hero / .membership-feature). */
export function SHero({ children, style }) {
  return <Grad colors={gradients.hero} locations={[0, 0.72, 1]} style={[ss.hero, style]}>{children}</Grad>;
}

/** A row in an SGroup: tinted icon tile (or a custom left node), serif title, muted subtitle, right side or chevron. */
export function SRow({ icon, tint = colors.primary, title, subtitle, right, onPress, chevron, left, titleStyle, serif }) {
  const showChevron = chevron || (onPress && right == null);
  const body = (
    <>
      {left || (icon ? (
        <View style={[ss.rowIcon, { backgroundColor: alpha(tint, 0.14) }]}>
          <Icon name={icon} size={17} color={tint} />
        </View>
      ) : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[serif ? ss.serifLine : ss.rowTitle, titleStyle]} numberOfLines={serif ? undefined : 2}>{title}</Text>
        {subtitle ? <Text style={ss.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right != null ? (
        <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
          {typeof right === 'string' ? <Text style={ss.rowRight} numberOfLines={1}>{right}</Text> : right}
        </View>
      ) : null}
      {showChevron ? <Icon name="chevron-right" size={15} color="#AAA6AD" /> : null}
    </>
  );
  if (!onPress) return <View style={ss.row}>{body}</View>;
  return <Tap onPress={onPress} accessibilityLabel={typeof title === 'string' ? title : undefined} style={ss.row}>{body}</Tap>;
}

/** Plum primary action (.button--primary) or paper outline action (ghost). */
export function SButton({ label, onPress, kind = 'primary', style, small, disabled, icon }) {
  const ghost = kind === 'ghost';
  return (
    <Tap
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      style={[ss.btn, small && ss.btnSmall, ghost && ss.btnGhost, disabled && { opacity: 0.45 }, style]}
    >
      {icon}
      <Text style={[ss.btnText, small && { fontSize: 11 }, ghost && ss.btnTextGhost]}>{label}</Text>
    </Tap>
  );
}

/** Design input: 52px paper field with a hairline border. */
export function SInput({ style, multiline, ...rest }) {
  return <DInput multiline={multiline} {...rest} style={[ss.input, multiline && ss.inputMulti, style]} />;
}

/** .field-label caption. */
export function SLabel({ children, style }) {
  return <DLabel style={[ss.label, style]}>{children}</DLabel>;
}

/** Kicker (.eyebrow): small uppercase plum; `tint` overrides the colour. */
export function SEyebrow({ children, tint, style }) {
  return <KitEyebrow style={[tint ? { color: tint } : null, style]}>{children}</KitEyebrow>;
}

/** Pill-shaped option chips (single or multi select; `value` may be an array). */
export function SChips({ items, value, onChange, style, small }) {
  const multi = Array.isArray(value);
  return (
    <View style={[ss.chips, style]}>
      {items.map((it) => {
        const on = multi ? value.includes(it) : value === it;
        return (
          <Tap key={it} onPress={() => onChange && onChange(it)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={it} style={[ss.chip, small && ss.chipSmall, on && ss.chipOn]}>
            <Text style={[ss.chipText, small && { fontSize: 11 }, on && ss.chipTextOn]}>{it}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** Empty state card. */
export function SEmpty({ title, body, action, onAction }) {
  return (
    <SCard style={ss.empty}>
      <Text style={ss.emptyTitle}>{title}</Text>
      {body ? <Text style={ss.emptyBody}>{body}</Text> : null}
      {action ? <SButton small kind="ghost" label={action} onPress={onAction} style={{ alignSelf: 'center', marginTop: 14 }} /> : null}
    </SCard>
  );
}

/** Soft note (.welcome-note). */
export function SNotice({ text, tint }) {
  return (
    <View style={[ss.notice, tint && { backgroundColor: alpha(tint, 0.12) }]}>
      <Icon name="shield" size={15} color={tint || d.plum} />
      <Text style={ss.noticeText}>{text}</Text>
    </View>
  );
}

/** Small status pill. */
export function SBadge({ label, tint = colors.primary }) {
  return (
    <View style={[ss.badge, { backgroundColor: alpha(tint, 0.14) }]}>
      <Text style={[ss.badgeText, { color: tint }]}>{label}</Text>
    </View>
  );
}

/** Timestamp chip for transcript lines. */
export function STimestamp({ t }) {
  return (
    <View style={ss.timeChip}>
      <Text style={ss.timeChipText}>{t}</Text>
    </View>
  );
}

/** AI-written draft panel: sparkles, a review badge and the text. */
export function SAIDraft({ children }) {
  return (
    <SCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="sparkles" size={14} color={d.plum} />
        <SBadge label="AI draft · needs your review" tint={colors.amber} />
      </View>
      <Text style={ss.draftText}>{children}</Text>
    </SCard>
  );
}

/** One bar of the recorder waveform: tweens its height to the latest input level. */
export function SWaveBar({ level, live }) {
  const a = useRef(new Animated.Value(4 / WAVE_MAX)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: (4 + Math.round((level || 0) * 30)) / WAVE_MAX, duration: 180, easing: EASE_OUT, useNativeDriver: ND }).start();
  }, [level]);
  return <Animated.View style={[ss.waveBar, { height: WAVE_MAX, opacity: live ? 0.9 : 0.4, transform: [{ scaleY: a }] }]} />;
}

/** Round control for the recorder (.record-button). */
export function SRecordButton({ onPress, disabled, active, label, children }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      style={({ pressed }) => [ss.recordBtn, active && ss.recordBtnActive, disabled && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.96 }] }]}
    >
      {children}
    </Pressable>
  );
}

export const ss = StyleSheet.create({
  card: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20, padding: 16, marginTop: 12 },
  cardTitle: { fontFamily: df.display, fontSize: 15, lineHeight: 20, color: d.ink },
  cardTitleLg: { fontFamily: df.displayBold, fontSize: 19, lineHeight: 24, color: d.ink },
  cardBody: { fontFamily: df.sans, fontSize: 13, lineHeight: 20, color: d.muted, marginTop: 8 },
  cardMeta: { fontFamily: df.sans, fontSize: 11, lineHeight: 16, color: d.muted, marginTop: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardActive: { borderColor: alpha(d.plum, 0.4) },
  itemTitle: { fontFamily: df.display, fontSize: 14, color: d.ink },
  itemSub: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 2 },
  h1: { fontFamily: df.displayBold, fontSize: 28, lineHeight: 33, letterSpacing: -0.6, color: d.ink, marginTop: 8 },
  sub: { fontFamily: df.sans, fontSize: 14, lineHeight: 21, color: d.muted, marginTop: 6 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  confirmBox: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 18, padding: 16, marginTop: 12 },
  timeChipText: { fontFamily: df.sansHeavy, fontSize: 10, color: d.plum, letterSpacing: 0.3 },
  timeChip: { minWidth: 50, alignItems: 'center', paddingHorizontal: 7, paddingVertical: 5, borderRadius: 9, backgroundColor: alpha(d.plum, 0.12) },

  group: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20, overflow: 'hidden', marginTop: 12 },
  groupSep: { height: 1, backgroundColor: d.line, marginLeft: 14 },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 14 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: df.display, fontSize: 14, lineHeight: 18, color: d.ink },
  rowSub: { fontFamily: df.sans, fontSize: 11, lineHeight: 15, color: d.muted, marginTop: 2 },
  rowRight: { fontFamily: df.sansBold, fontSize: 12, color: d.plumDark },
  serifLine: { fontFamily: df.display, fontSize: 14, lineHeight: 21, color: d.ink },

  hero: { borderRadius: 26, padding: 22, overflow: 'hidden', marginTop: 12, shadowColor: '#372B7D', shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 18 }, elevation: 7 },

  btn: { height: 52, borderRadius: 16, backgroundColor: d.plum, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16,
    ...Platform.select({ web: { boxShadow: '0 12px 24px rgba(255,107,26,0.22)' }, default: { shadowColor: d.plum, shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 12 }, elevation: 4 } }) },
  btnSmall: { height: 38, borderRadius: 12, paddingHorizontal: 14, shadowOpacity: 0, elevation: 0 },
  btnGhost: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, shadowOpacity: 0, elevation: 0 },
  btnText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 13 },
  btnTextGhost: { color: d.ink },

  input: { height: 52, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, color: d.ink, fontSize: 13, fontFamily: df.sans },
  inputMulti: { height: undefined, minHeight: 120, paddingTop: 13, paddingBottom: 13 },
  label: { marginTop: 18, marginBottom: 8, color: '#4C3D32', fontSize: 11, fontFamily: df.sansBold },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, alignItems: 'center', justifyContent: 'center' },
  chipSmall: { minHeight: 32, paddingHorizontal: 11, borderRadius: 16 },
  chipOn: { borderColor: d.plum, backgroundColor: '#FFF1E5' },
  chipText: { fontSize: 13, fontFamily: df.sansBold, color: d.muted },
  chipTextOn: { color: d.plum },

  empty: { alignItems: 'center', paddingVertical: 26 },
  emptyTitle: { fontFamily: df.displayBold, fontSize: 18, color: d.ink, textAlign: 'center' },
  emptyBody: { fontFamily: df.sans, fontSize: 13, lineHeight: 19, color: d.muted, textAlign: 'center', marginTop: 6, maxWidth: 300 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 14, padding: 13, borderRadius: 15, backgroundColor: '#F6E4D2' },
  noticeText: { flex: 1, fontFamily: df.sans, fontSize: 12, lineHeight: 17, color: d.plumDark },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontFamily: df.sansBold, fontSize: 10, letterSpacing: 0.2 },
  draftText: { fontFamily: df.display, fontSize: 15, lineHeight: 23, color: d.ink, marginTop: 12 },

  waveBar: { width: 3, borderRadius: 2, backgroundColor: d.plum },
  recordBtn: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: d.plum,
    ...Platform.select({ web: { boxShadow: '0 12px 25px rgba(255,107,26,0.26)' }, default: { shadowColor: d.plum, shadowOpacity: 0.26, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 6 } }) },
  recordBtnActive: { backgroundColor: '#C9435A' },

  // Dark hero panels (Plan progress, Lesson player)
  heroKicker: { fontFamily: df.sansHeavy, fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: '#FFD8BD' },
  heroBig: { fontFamily: df.displayBold, fontSize: 44, lineHeight: 48, color: '#FFFFFF' },
  heroMeta: { fontFamily: df.sans, fontSize: 12, color: '#F7C9A8', marginTop: 4 },
  heroTitle: { fontFamily: df.displayBold, fontSize: 22, lineHeight: 27, color: '#FFFFFF', marginTop: 4 },
  heroPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  heroPillText: { fontFamily: df.sansBold, fontSize: 11, color: '#FFFFFF' },

  // Plan progress hero
  nightBig: { fontFamily: df.displayBold, fontSize: 44, lineHeight: 48, color: '#FFFFFF' },
  nightMeta: { fontFamily: df.sans, fontSize: 12, color: '#F7C9A8', marginTop: 4 },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  streakText: { fontFamily: df.sansBold, fontSize: 11, color: '#FFFFFF' },
  // Plan "today" card and round arrow
  todayCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, marginTop: 12, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20 },
  todayRef: { fontFamily: df.displayBold, fontSize: 18, lineHeight: 23, color: d.ink, marginTop: 3 },
  roundArrow: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(d.plum, 0.12) },
  miniAvatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: d.plum },
  miniAvatarText: { color: '#FFFFFF', fontFamily: df.sansHeavy },
  emptyCard: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20, padding: 16 },

  // Lesson player (dark hero with a white play button)
  player: { borderRadius: 26, overflow: 'hidden', padding: 22, marginTop: 12 },
  playBtnWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  playHalo: { position: 'absolute', width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  playHaloRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  playerTitle: { fontFamily: df.displayBold, fontSize: 21, lineHeight: 26, color: '#FFFFFF', marginTop: 16 },
  playerMeta: { fontFamily: df.sans, fontSize: 12, lineHeight: 17, color: '#F7C9A8', marginTop: 4 },
  playerTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 16, overflow: 'hidden' },
  playerTrackFill: { height: 5, borderRadius: 3, backgroundColor: '#FFB27A' },

  // Recording list rows
  recPlay: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(d.plum, 0.12) },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: d.plum },

  // Sermon Studio recorder (.recorder, .record-orb, .record-time, .waveform, .record-button)
  recorder: { alignItems: 'center', paddingTop: 16, paddingBottom: 6 },
  orb: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: d.line,
    ...Platform.select({ web: { boxShadow: '0 0 0 18px rgba(255,107,26,0.08), 0 0 0 38px rgba(255,107,26,0.04)' }, default: { shadowColor: d.plum, shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 3 } }) },
  orbRec: { borderColor: alpha('#C9435A', 0.35), backgroundColor: '#FFF6F7' },
  recTime: { fontFamily: df.displayBold, fontSize: 42, lineHeight: 48, color: d.ink, marginTop: 18 },
  recStatus: { fontFamily: df.sansBold, fontSize: 12, color: d.muted, marginTop: 6 },
  wave: { height: 48, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', marginTop: 22, marginBottom: 22 },
  recHint: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 10 },
  recMeta: { fontFamily: df.sans, fontSize: 11, lineHeight: 16, color: d.muted, marginTop: 8, textAlign: 'center', maxWidth: 300 },
  recBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 18 },
  introCard: { flexDirection: 'row', alignItems: 'center', gap: 15, padding: 20, borderRadius: 22 },

  // Welcome setup (first run)
  skipBtn: { paddingVertical: 6 },
  skipText: { fontFamily: df.sansBold, fontSize: 13, color: d.plum },
  stepper5: { flexDirection: 'row', gap: 6, marginTop: 6 },
  stepSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: d.line, overflow: 'hidden' },
  stepSegOn: { backgroundColor: d.plum },
  introMark: { width: 62, height: 62, borderRadius: 20, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  introMarkText: { color: '#FFFFFF', fontFamily: df.displayBold, fontSize: 18 },
  introKicker: { color: '#F5C19F', fontFamily: df.sansHeavy, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  introTitle: { color: '#FFFFFF', fontFamily: df.display, fontSize: 19, lineHeight: 24, marginTop: 5 },
  searchWrap: { position: 'relative', marginTop: 8 },
  searchIcon: { position: 'absolute', left: 14, top: 17, zIndex: 1 },
  churchRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  churchRowOn: { borderColor: d.plum, backgroundColor: '#FFF1E5' },
  checkCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  hintCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 14, borderRadius: 17, backgroundColor: d.lavender },
  hintText: { flex: 1, fontFamily: df.sans, fontSize: 12, lineHeight: 17, color: d.plumDark },
  doneOrb: { width: 84, height: 84, borderRadius: 42, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ web: { boxShadow: '0 16px 34px rgba(255,107,26,0.3)' }, default: { shadowColor: d.plum, shadowOpacity: 0.3, shadowRadius: 22, shadowOffset: { width: 0, height: 14 }, elevation: 8 } }) },
});

/** Confirm box (inline, under the item it asks about). */
export function SConfirm({ title, body, confirmLabel = 'Confirm', onConfirm, onCancel, danger = true }) {
  return (
    <View style={ss.confirmBox}>
      <Text style={[ss.itemTitle, danger && { color: '#B33D3D' }]}>{title}</Text>
      {body ? <Text style={[ss.cardMeta, { marginTop: 4 }]}>{body}</Text> : null}
      <View style={ss.btnRow}>
        <SButton small label={confirmLabel} onPress={onConfirm} style={danger ? { backgroundColor: '#B33D3D' } : null} />
        <SButton small kind="ghost" label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

/** Round initials avatar used in shared-plan lists. */
export function SAvatar({ name, size = 34 }) {
  const initials = String(name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[ss.miniAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[ss.miniAvatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}
