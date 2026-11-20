// NOTIFICATIONS — Settings › Notifications › Daily moments ('NotificationSettings' route).
// Users choose which daily notifications they get and at what local time: Today's Scripture (morning →
// Daily Bread), A Moment of Prayer (midday → Prayer Wall), Words of Encouragement (→ Scripture Companion),
// Daily Devotional (evening → Devotionals), Church Community (→ their group) and Broadcasts (server pushes →
// inbox). Each row previews the black-and-gold card and can send a test notification.
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Screen, Section, Button, Eyebrow } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, AnimatedModal, Pop } from '../components/Motion';
import { useToast } from '../components/Toast';
import TimeWheel from '../components/TimeWheel';
import { Toggle } from './PrayerScreen';
import GoldNotificationCard from '../components/GoldNotificationCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { fmtTime } from '../notifications/reminders';
import { MOMENT_TYPES, DEFAULT_MOMENTS, momentSettings, momentContent, sendTestMoment, ensurePermission, openTarget, supported, upcomingMoments } from '../notifications/daily';
import { GOLD } from '../notifications/imagery';

const PRESETS = {
  scripture: [{ hour: 6, minute: 0 }, { hour: 7, minute: 0 }, { hour: 8, minute: 0 }],
  prayer: [{ hour: 12, minute: 0 }, { hour: 12, minute: 30 }, { hour: 13, minute: 0 }],
  encouragement: [{ hour: 10, minute: 0 }, { hour: 15, minute: 30 }, { hour: 17, minute: 0 }],
  devotional: [{ hour: 19, minute: 0 }, { hour: 20, minute: 0 }, { hour: 21, minute: 0 }],
  community: [{ hour: 18, minute: 0 }, { hour: 19, minute: 0 }, { hour: 20, minute: 0 }],
};

export default function NotificationSettingsScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const toast = useToast();
  const settings = momentSettings(state);
  const [editing, setEditing] = useState(null); // { type, hour, minute }
  const [previewType, setPreviewType] = useState('scripture');
  const [perm, setPerm] = useState(supported ? null : 'web');
  const group = (state.communities || []).find((g) => g.joined === true) || null;

  useEffect(() => {
    if (!supported) return;
    Notifications.getPermissionsAsync().then((p) => setPerm(p.granted ? 'granted' : p.canAskAgain === false ? 'blocked' : 'ask')).catch(() => setPerm('ask'));
  }, []);

  const setType = (type, patch) => {
    if (type === 'broadcast') { // server-side mute (synced as notify settings)
      dispatch({ type: 'set', patch: { notifications: { ...state.notifications, broadcasts: !!patch.enabled } } });
      return;
    }
    const cur = { ...DEFAULT_MOMENTS[type], ...((state.dailyMoments || {})[type] || {}) };
    dispatch({ type: 'set', patch: { dailyMoments: { ...(state.dailyMoments || {}), [type]: { ...cur, ...patch } } } });
  };

  const toggle = async (t, v) => {
    if (v && supported && perm !== 'granted') {
      const ok = await ensurePermission();
      setPerm(ok ? 'granted' : 'blocked');
      if (!ok) toast.show('Allow notifications for BibleNestra in your phone settings', { tone: 'error' });
    }
    setType(t.key, { enabled: v });
    setPreviewType(t.key);
    toast.show(`${t.title} ${v ? 'on' : 'off'}`, { icon: 'bell', haptic: 'select' });
  };

  const test = async (t) => {
    setPreviewType(t.key);
    if (!supported) { toast.show('Preview shown above — notifications arrive on your phone', { icon: 'bell' }); return; }
    const ok = await sendTestMoment(t.key, state);
    if (ok) toast.show('Sending a test notification in 3 seconds…', { icon: 'bell', haptic: 'success' });
    else { setPerm('blocked'); toast.show('Allow notifications for BibleNestra in your phone settings', { tone: 'error' }); }
  };

  const preview = momentContent(previewType === 'broadcast' ? 'scripture' : previewType, new Date(), { group });
  const scheduled = upcomingMoments(settings).length;

  return (
    <View style={{ flex: 1 }}>
      <Screen back title="Notifications" subtitle="Daily moments with God">
        <FadeInUp index={0}>
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>BIBLENESTRA</Text>
            <Text style={styles.heroTitle}>A moment with God.{'\n'}Every day.</Text>
            <Text style={styles.heroSub}>Choose what you receive and when — in your own time zone.</Text>
          </View>
        </FadeInUp>

        {perm === 'ask' || perm === 'blocked' ? (
          <FadeInUp index={1}>
            <PressScale onPress={async () => { const ok = await ensurePermission(); setPerm(ok ? 'granted' : 'blocked'); }} scaleTo={0.98} style={styles.permRow} accessibilityRole="button">
              <Icon name="bell" size={16} color={GOLD.gold} />
              <Text style={styles.permText}>{perm === 'blocked' ? 'Notifications are blocked — allow them for BibleNestra in your phone settings.' : 'Allow notifications so your daily moments can arrive.'}</Text>
              {perm === 'ask' ? <Text style={styles.permCta}>Allow →</Text> : null}
            </PressScale>
          </FadeInUp>
        ) : null}

        <FadeInUp index={2}>
          <Eyebrow style={{ marginTop: 16, marginBottom: 8 }}>Preview</Eyebrow>
          <GoldNotificationCard card={preview} time="1m ago" onPress={() => openTarget(nav, preview.target, preview.params)} />
        </FadeInUp>

        <Section title="Daily moments">
          {MOMENT_TYPES.map((t, i) => {
            const s = settings[t.key];
            const disabledCommunity = t.key === 'community' && !group;
            return (
              <FadeInUp key={t.key} index={3 + i}>
                <Pressable onPress={() => setPreviewType(t.key)} style={[styles.card, previewType === t.key && styles.cardActive]} accessibilityLabel={`${t.title} settings`}>
                  <View style={styles.row}>
                    <View style={styles.emoji}><Text style={{ fontSize: 18 }}>{t.emoji}</Text></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.typeTitle}>{t.title}</Text>
                      <Text style={styles.typeSub} numberOfLines={2}>
                        {t.server ? 'Official messages from BibleNestra · arrive when sent'
                          : disabledCommunity ? 'Join a church community to get its updates'
                            : `${t.short} · opens ${t.opens}`}
                      </Text>
                    </View>
                    <Toggle value={!!s.enabled} onChange={(v) => toggle(t, v)} />
                  </View>
                  {!t.server && s.enabled ? (
                    <View style={styles.actions}>
                      <PressScale scaleTo={0.96} onPress={() => setEditing({ type: t.key, hour: s.hour, minute: s.minute })} style={styles.timeChip} accessibilityRole="button" accessibilityLabel={`Change ${t.title} time`}>
                        <Icon name="clock" size={13} color={colors.gold} />
                        <Pop trigger={`${s.hour}:${s.minute}`}><Text style={styles.timeText}>{fmtTime(s.hour, s.minute)}</Text></Pop>
                      </PressScale>
                      <PressScale scaleTo={0.96} onPress={() => test(t)} style={styles.testChip} accessibilityRole="button" accessibilityLabel={`Send a test ${t.title} notification`}>
                        <Icon name="bell" size={12} color={colors.muted} />
                        <Text style={styles.testText}>{supported ? 'Send a test' : 'Preview'}</Text>
                      </PressScale>
                    </View>
                  ) : null}
                </Pressable>
              </FadeInUp>
            );
          })}
        </Section>

        <Section title="More notifications">
          <PressScale scaleTo={0.985} onPress={() => nav.push('Reminders')} style={[styles.card, styles.row]} accessibilityRole="button">
            <View style={styles.emoji}><Icon name="clock" size={16} color={colors.gold} /></View>
            <View style={{ flex: 1 }}><Text style={styles.typeTitle}>Reminders</Text><Text style={styles.typeSub}>Personal reminders to read, pray or call</Text></View>
            <Icon name="chevron-right" size={15} color={colors.faint} />
          </PressScale>
          <PressScale scaleTo={0.985} onPress={() => nav.push('ScripturePop')} style={[styles.card, styles.row]} accessibilityRole="button">
            <View style={styles.emoji}><Icon name="sparkles" size={16} color={colors.gold} /></View>
            <View style={{ flex: 1 }}><Text style={styles.typeTitle}>Scripture pop-ups</Text><Text style={styles.typeSub}>Verses and prayers at an interval you choose</Text></View>
            <Icon name="chevron-right" size={15} color={colors.faint} />
          </PressScale>
        </Section>

        <Text style={styles.foot}>
          {supported
            ? `${scheduled} moment${scheduled === 1 ? '' : 's'} scheduled on this phone for the coming days (topped up each time you open the app), so they arrive even offline. `
            : 'Daily moments arrive as phone notifications in the mobile app. On the web you see the in-app preview. '}
          Your phone draws its own notification frame, so system notifications show the gold accent, app icon, title and verse
          {Platform.OS === 'ios' ? ' with the photo attached' : ''}; the full black-and-gold card with its photo appears in the in-app notification centre.
        </Text>
      </Screen>

      <AnimatedModal visible={!!editing} onRequestClose={() => setEditing(null)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setEditing(null)} accessibilityLabel="Dismiss" />
          {editing ? (
            <View style={styles.sheet}>
              <View style={styles.grabber} />
              <Eyebrow>{MOMENT_TYPES.find((x) => x.key === editing.type).title}</Eyebrow>
              <Text style={styles.sheetTitle}>When should it arrive?</Text>
              <View style={{ marginTop: 16 }}>
                <TimeWheel value={{ hour: editing.hour, minute: editing.minute }} onChange={(v) => setEditing({ ...editing, ...v })} presets={PRESETS[editing.type]} />
              </View>
              <Button
                label={`Save · ${fmtTime(editing.hour, editing.minute)}`}
                onPress={() => { const e = editing; setEditing(null); setType(e.type, { hour: e.hour, minute: e.minute }); toast.show(`Arrives at ${fmtTime(e.hour, e.minute)} your time`, { icon: 'clock', haptic: 'success' }); }}
                style={{ marginTop: 18 }}
              />
            </View>
          ) : null}
        </View>
      </AnimatedModal>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: GOLD.cardSolid, borderRadius: 18, borderWidth: 1, borderColor: GOLD.goldLine, padding: 18, marginTop: 4 },
  heroEyebrow: { fontSize: 11, letterSpacing: 2, fontWeight: '800', color: GOLD.gold },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 24, lineHeight: 30, color: GOLD.white, marginTop: 6 },
  heroSub: { fontSize: 13, color: GOLD.grey, marginTop: 6, lineHeight: 18 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: GOLD.goldLine, backgroundColor: colors.surface },
  permText: { flex: 1, fontSize: 13, color: colors.fg, lineHeight: 18 },
  permCta: { fontSize: 13, fontWeight: '800', color: colors.gold },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, marginTop: 10, ...shadow.sm },
  cardActive: { borderColor: GOLD.goldLine },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji: { width: 38, height: 38, borderRadius: 12, backgroundColor: GOLD.cardSolid, borderWidth: 1, borderColor: GOLD.goldLine, alignItems: 'center', justifyContent: 'center' },
  typeTitle: { fontSize: 15, fontWeight: '700', color: colors.fg },
  typeSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, marginLeft: 50 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: GOLD.goldLine, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  timeText: { fontSize: 13, fontWeight: '800', color: colors.gold },
  testChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  testText: { fontSize: 12.5, fontWeight: '700', color: colors.muted },
  foot: { fontSize: 12, lineHeight: 18, color: colors.faint, textAlign: 'center', marginTop: 20 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.fg, letterSpacing: -0.4, marginTop: 2 },
});
