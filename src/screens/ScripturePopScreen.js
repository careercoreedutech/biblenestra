// Settings for "Scripture pop-ups" — verses and prayers that pop on the phone at an interval.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { KitScreen } from '../design/bible/parts';
import { d } from '../design/sanctuary';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, shadow } from '../theme';
import { useStore } from '../store';
import { FREQUENCIES, contentFor, ensurePermission, sendTest, supported, upcomingSlots } from '../notifications/scripturePop';

const CONTENT = [
  { id: 'both', label: 'Both' },
  { id: 'verses', label: 'Scriptures' },
  { id: 'prayers', label: 'Prayers' },
];
const QUIET = [
  { from: 22, to: 7, label: '10 pm – 7 am' },
  { from: 21, to: 6, label: '9 pm – 6 am' },
  { from: 23, to: 8, label: '11 pm – 8 am' },
  { from: 0, to: 0, label: 'No quiet hours' },
];

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (t) => {
  const d = new Date(t); const n = new Date();
  const tomorrow = new Date(n); tomorrow.setDate(n.getDate() + 1);
  if (d.toDateString() === n.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short' });
};

export default function ScripturePopScreen() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const s = { enabled: false, every: 180, quietFrom: 22, quietTo: 7, content: 'both', ...(state.scripturePop || {}) };
  const set = (patch) => dispatch({ type: 'scripturePop', patch });
  const slots = useMemo(() => upcomingSlots(s, 4), [s.every, s.quietFrom, s.quietTo]);
  const [preview, setPreview] = useState(null);

  const toggle = async (on) => {
    if (on && supported) {
      const ok = await ensurePermission();
      if (!ok) {
        toast.show('Allow notifications for BibleNestra in your phone settings', { icon: 'bell', tone: 'error' });
        return;
      }
    }
    set({ enabled: on });
    toast.show(on ? 'Scripture pop-ups are on ✦' : 'Scripture pop-ups paused', { icon: 'bell', haptic: on ? 'success' : 'light' });
  };

  const test = async () => {
    const c = contentFor(Date.now(), s.content);
    setPreview({ ...c, key: Date.now() });
    if (supported) {
      const ok = await sendTest(s);
      toast.show(ok ? 'A pop-up will arrive in a few seconds' : 'Notifications are blocked in settings', { icon: 'bell', tone: ok ? undefined : 'error' });
    }
  };

  const perDay = Math.round((24 - (s.quietFrom === s.quietTo ? 0 : ((s.quietTo - s.quietFrom + 24) % 24))) * 60 / s.every);

  return (
    <View style={{ flex: 1 }}>
    <KitScreen title="Scripture pop-ups" subtitle="Verses & prayers through your day">

      <FadeInUp style={styles.hero}>
        <View style={styles.phone}>
          <View style={styles.phoneNotch} />
          <View style={styles.mockPop}>
            <View style={styles.mockIcon}><Text style={{ color: '#fff', fontSize: 12 }}>✦</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.mockApp}>BIBLENESTRA · now</Text>
              <Text style={styles.mockTitle} numberOfLines={1}>{contentFor(slots[0] || Date.now(), s.content).title}</Text>
              <Text style={styles.mockBody} numberOfLines={2}>{contentFor(slots[0] || Date.now(), s.content).body}</Text>
            </View>
          </View>
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Pop a word from God on my screen</Text>
            <Text style={styles.heroSub}>{s.enabled ? `About ${perDay} a day · ${FREQUENCIES.find((f) => f.every === s.every)?.label.toLowerCase() || ''}` : 'Off — turn on to receive verses and prayers'}</Text>
          </View>
          <Switch value={!!s.enabled} onValueChange={toggle} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor="#FFFFFF" />
        </View>
      </FadeInUp>

      <FadeInUp index={1}>
        <Text style={styles.label}>What to show</Text>
        <View style={styles.segment}>
          {CONTENT.map((c) => (
            <PressScale key={c.id} onPress={() => set({ content: c.id })} scaleTo={0.96} style={[styles.segBtn, s.content === c.id && styles.segOn]}>
              <Text style={[styles.segText, s.content === c.id && styles.segTextOn]}>{c.label}</Text>
            </PressScale>
          ))}
        </View>
      </FadeInUp>

      <FadeInUp index={2}>
        <Text style={styles.label}>How often</Text>
        <View style={styles.grid}>
          {FREQUENCIES.map((f) => (
            <PressScale key={f.every} onPress={() => set({ every: f.every })} scaleTo={0.96} style={[styles.chip, s.every === f.every && styles.chipOn]}>
              <Text style={[styles.chipText, s.every === f.every && styles.chipTextOn]}>{f.label}</Text>
            </PressScale>
          ))}
        </View>
      </FadeInUp>

      <FadeInUp index={3}>
        <Text style={styles.label}>Quiet hours</Text>
        <View style={styles.grid}>
          {QUIET.map((q) => {
            const on = s.quietFrom === q.from && s.quietTo === q.to;
            return (
              <PressScale key={q.label} onPress={() => set({ quietFrom: q.from, quietTo: q.to })} scaleTo={0.96} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{q.label}</Text>
              </PressScale>
            );
          })}
        </View>
      </FadeInUp>

      <FadeInUp index={4} style={styles.card}>
        <Text style={styles.cardHead}>Coming up</Text>
        {slots.map((t, i) => {
          const c = contentFor(t, s.content);
          return (
            <View key={t} style={[styles.slot, i === 0 && { borderTopWidth: 0 }]}>
              <View style={styles.slotTime}>
                <Text style={styles.slotDay}>{dayLabel(t)}</Text>
                <Text style={styles.slotClock}>{fmt(t)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.slotTitle} numberOfLines={1}>{c.title}</Text>
                <Text style={styles.slotBody} numberOfLines={2}>{c.body}</Text>
              </View>
            </View>
          );
        })}
      </FadeInUp>

      <PressScale onPress={test} scaleTo={0.97} style={styles.testBtn}>
        <Icon name="bell" size={16} color="#FFFFFF" />
        <Text style={styles.testText}>{supported ? 'Send me one now' : 'Preview a pop-up'}</Text>
      </PressScale>
      <Text style={styles.foot}>
        {supported
          ? 'Pop-ups are scheduled on your phone, so they arrive even offline. Tap one to open the verse. Scripture text is from the King James Version.'
          : 'Pop-ups arrive as phone notifications in the mobile app. This preview shows how they look.'}
      </Text>
    </KitScreen>
    {preview ? <PopPreview key={preview.key} item={preview} onDone={() => setPreview(null)} /> : null}
    </View>
  );
}

// In-app banner that slides down like a notification (used for previews and on web)
function PopPreview({ item, onDone }) {
  const y = useRef(new Animated.Value(-140)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(y, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
      Animated.delay(3600),
      Animated.timing(y, { toValue: -160, duration: 320, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(onDone);
  }, []);
  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: y }] }]}>
      <View style={styles.mockIcon}><Text style={{ color: '#fff', fontSize: 12 }}>✦</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.mockApp}>BIBLENESTRA · now</Text>
        <Text style={styles.mockTitle}>{item.title}</Text>
        <Text style={styles.mockBody} numberOfLines={3}>{item.body}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 24, backgroundColor: '#3C2518', padding: 16, overflow: 'hidden', ...shadow.md },
  phone: { borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', padding: 12, paddingTop: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  phoneNotch: { position: 'absolute', top: 8, alignSelf: 'center', width: 70, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  mockPop: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 18, backgroundColor: 'rgba(250,247,240,0.96)' },
  mockIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  mockApp: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.faint },
  mockTitle: { fontSize: 14, fontWeight: '700', color: colors.fg, marginTop: 1 },
  mockBody: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 19, color: colors.passage, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.nightFg },
  heroSub: { fontSize: 12.5, color: colors.nightMuted, marginTop: 3 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gold, marginTop: 24, marginBottom: 10 },
  segment: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface, ...shadow.sm },
  segText: { fontSize: 13.5, fontWeight: '600', color: colors.muted },
  segTextOn: { color: colors.fg, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.fg },
  chipTextOn: { color: '#FFFFFF' },
  card: { marginTop: 24, padding: 16, borderRadius: 20, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  cardHead: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, marginBottom: 6 },
  slot: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  slotTime: { width: 64 },
  slotDay: { fontSize: 10.5, fontWeight: '700', color: colors.faint, textTransform: 'uppercase', letterSpacing: 0.6 },
  slotClock: { fontSize: 14, fontWeight: '700', color: colors.primary, marginTop: 2 },
  slotTitle: { fontSize: 13, fontWeight: '700', color: colors.fg },
  slotBody: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 19, color: colors.muted, marginTop: 2 },
  testBtn: { marginTop: 22, height: 50, borderRadius: 25, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  testText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  foot: { fontSize: 12, lineHeight: 18, color: colors.faint, textAlign: 'center', marginTop: 12 },
  banner: { position: 'absolute', top: 8, left: 12, right: 12, zIndex: 50, flexDirection: 'row', gap: 10, padding: 12, borderRadius: 20, backgroundColor: 'rgba(250,247,240,0.98)', borderWidth: 1, borderColor: colors.border, ...shadow.md },
});
