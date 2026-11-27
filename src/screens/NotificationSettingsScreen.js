// NOTIFICATIONS — Settings › Notifications › Daily moments ('NotificationSettings' route).
// Users choose which daily notifications they get and at what local time: Today's Scripture (morning →
// Daily Bread), A Moment of Prayer (midday → Prayer Wall), Words of Encouragement (→ Scripture Companion),
// Daily Devotional (evening → Devotionals), Church Community (→ their group) and Broadcasts (server pushes →
// inbox). Each row previews the black-and-gold card and can send a test notification.
// Presentation: the Figma design's settings rows and toggles (src/design/profile/parts.js).
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Button, Eyebrow } from '../components/ui';
import { Icon } from '../components/Icons';
import { Pop, AnimatedModal } from '../components/Motion';
import { useToast } from '../components/Toast';
import TimeWheel from '../components/TimeWheel';
import GoldNotificationCard from '../components/GoldNotificationCard';
import { colors, fonts, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { fmtTime } from '../notifications/reminders';
import { MOMENT_TYPES, DEFAULT_MOMENTS, momentSettings, momentContent, sendTestMoment, ensurePermission, openTarget, supported, upcomingMoments } from '../notifications/daily';
import { DScreen, DToggle, DList, DRow } from '../design/profile/parts';
import { d as D, df as DF, SectionTitle as DSection } from '../design/sanctuary';

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
      <DScreen title="Notifications" subtitle="Daily moments with God" back onBack={() => nav.pop()}>
        {/* The design's settings header card */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>BIBLENESTRA</Text>
          <Text style={styles.heroTitle}>A moment with God.{'\n'}Every day.</Text>
          <Text style={styles.heroSub}>Choose what you receive and when — in your own time zone.</Text>
        </View>

        {perm === 'ask' || perm === 'blocked' ? (
          <Pressable onPress={async () => { const ok = await ensurePermission(); setPerm(ok ? 'granted' : 'blocked'); }} style={({ pressed }) => [styles.permRow, pressed && { opacity: 0.92 }]} accessibilityRole="button">
            <Icon name="bell" size={16} color={D.plum} />
            <Text style={styles.permText}>{perm === 'blocked' ? 'Notifications are blocked — allow them for BibleNestra in your phone settings.' : 'Allow notifications so your daily moments can arrive.'}</Text>
            {perm === 'ask' ? <Text style={styles.permCta}>Allow →</Text> : null}
          </Pressable>
        ) : null}

        <DSection eyebrow="Preview" title="How it will look" />
        <GoldNotificationCard card={preview} time="1m ago" onPress={() => openTarget(nav, preview.target, preview.params)} />

        <DSection eyebrow="Daily moments" title="What you receive" />
        {MOMENT_TYPES.map((t) => {
          const s = settings[t.key];
          const disabledCommunity = t.key === 'community' && !group;
          const active = previewType === t.key;
          return (
            <Pressable key={t.key} onPress={() => setPreviewType(t.key)} style={[styles.card, active && styles.cardActive]} accessibilityLabel={`${t.title} settings`}>
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
                <DToggle value={!!s.enabled} onChange={(v) => toggle(t, v)} accessibilityLabel={`${t.title} ${s.enabled ? 'on' : 'off'}`} />
              </View>
              {!t.server && s.enabled ? (
                <View style={styles.actions}>
                  <Pressable onPress={() => setEditing({ type: t.key, hour: s.hour, minute: s.minute })} style={({ pressed }) => [styles.timeChip, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Change ${t.title} time`}>
                    <Icon name="clock" size={13} color={D.plum} />
                    <Pop trigger={`${s.hour}:${s.minute}`}><Text style={styles.timeText}>{fmtTime(s.hour, s.minute)}</Text></Pop>
                  </Pressable>
                  <Pressable onPress={() => test(t)} style={({ pressed }) => [styles.testChip, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Send a test ${t.title} notification`}>
                    <Icon name="bell" size={12} color={D.muted} />
                    <Text style={styles.testText}>{supported ? 'Send a test' : 'Preview'}</Text>
                  </Pressable>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        {/* .account-list: reminders and pop-ups live on their own screens */}
        <DSection eyebrow="More" title="Notifications" />
        <DList>
          <DRow icon="clock" title="Reminders" subtitle="Personal reminders to read, pray or call" onPress={() => nav.push('Reminders')} />
          <DRow icon="sparkles" title="Scripture pop-ups" subtitle="Verses and prayers at an interval you choose" onPress={() => nav.push('ScripturePop')} />
        </DList>

        <Text style={styles.foot}>
          {supported
            ? `${scheduled} moment${scheduled === 1 ? '' : 's'} scheduled on this phone for the coming days (topped up each time you open the app), so they arrive even offline. `
            : 'Daily moments arrive as phone notifications in the mobile app. On the web you see the in-app preview. '}
          Your phone draws its own notification frame, so system notifications show the gold accent, app icon, title and verse
          {Platform.OS === 'ios' ? ' with the photo attached' : ''}; the full black-and-gold card with its photo appears in the in-app notification centre.
        </Text>
      </DScreen>

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
  hero: { backgroundColor: D.paper, borderRadius: 24, borderWidth: 1, borderColor: D.line, padding: 20, marginTop: 4 },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.7, fontFamily: DF.sansBold, color: D.plum, textTransform: 'uppercase' },
  heroTitle: { fontFamily: DF.displayBold, fontSize: 24, lineHeight: 29, color: D.ink, marginTop: 8 },
  heroSub: { fontFamily: DF.sans, fontSize: 11, lineHeight: 17, color: D.muted, marginTop: 6 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: D.line, backgroundColor: D.lavender },
  permText: { flex: 1, fontSize: 11, fontFamily: DF.sans, color: D.ink, lineHeight: 16 },
  permCta: { fontSize: 11, fontFamily: DF.sansBold, color: D.plum },
  card: { backgroundColor: D.paper, borderWidth: 1, borderColor: D.line, borderRadius: 20, padding: 14, marginTop: 9 },
  cardActive: { borderColor: D.plum },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji: { width: 40, height: 40, borderRadius: 13, backgroundColor: D.lavender, alignItems: 'center', justifyContent: 'center' },
  typeTitle: { fontFamily: DF.display, fontSize: 14, color: D.ink },
  typeSub: { fontFamily: DF.sans, fontSize: 10, lineHeight: 14, color: D.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, marginLeft: 52 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: D.plum, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  timeText: { fontSize: 12, fontFamily: DF.sansBold, color: D.plum },
  testChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: D.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  testText: { fontSize: 11, fontFamily: DF.sansBold, color: D.muted },
  foot: { fontSize: 11, lineHeight: 17, color: D.muted, fontFamily: DF.sans, textAlign: 'center', marginTop: 20 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.fg, letterSpacing: -0.4, marginTop: 2 },
});
