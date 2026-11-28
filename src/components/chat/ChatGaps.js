// CHAT GAPS — small pieces shared by the chat screen, Group Info and the chat list:
//   <LinkPreviewCard>   compact title / description / image card for a link (server: lib/linkPreviews.js);
//                       tap opens the page in the in-app browser (expo-web-browser)
//   <MuteSheet>         "Mute notifications for… 8 hours / 1 week / Always" (PUT /conversations/:id/mute)
//   isMutedNow(chat)    honours the expiry of a timed mute on the device too
//   muteLabel(chat)     "Muted until 9:40 PM" / "Muted until Fri 27 Nov" / "Muted"
import React, { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Icon } from '../Icons';
import { AnimatedModal } from '../Motion';
import { colors, fonts, radius, shadow } from '../../theme';

export function openInAppBrowser(url) {
  if (!url) return;
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {}));
}

// ---------- link preview card ----------
export function LinkPreviewCard({ preview, mine, onLongPress, style }) {
  const [imgOk, setImgOk] = useState(true);
  if (!preview || !preview.url || !(preview.title || preview.description)) return null;
  const site = preview.siteName || (() => { try { return new URL(preview.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
  return (
    <Pressable
      onPress={() => openInAppBrowser(preview.url)}
      onLongPress={onLongPress}
      delayLongPress={280}
      style={({ pressed }) => [styles.card, mine && styles.cardMine, pressed && { opacity: 0.85 }, style]}
      accessibilityRole="link"
      accessibilityLabel={`Open ${preview.title || site}`}
    >
      {preview.image && imgOk ? (
        <Image source={{ uri: preview.image }} style={styles.thumb} resizeMode="cover" onError={() => setImgOk(false)} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.thumbIcon, mine && { backgroundColor: 'rgba(255,255,255,0.14)' }]}><Icon name="link" size={18} color={mine ? '#FFFAF2' : colors.primary} /></View>
      )}
      <View style={styles.body}>
        {site ? <Text style={[styles.site, mine && { color: 'rgba(255,255,255,0.72)' }]} numberOfLines={1}>{site}</Text> : null}
        {preview.title ? <Text style={[styles.title, mine && { color: '#FFFFFF' }]} numberOfLines={2}>{preview.title}</Text> : null}
        {preview.description ? <Text style={[styles.desc, mine && { color: 'rgba(255,255,255,0.82)' }]} numberOfLines={2}>{preview.description}</Text> : null}
      </View>
    </Pressable>
  );
}

// ---------- timed mute ----------
export const MUTE_OPTIONS = [
  { key: '8h', label: '8 hours' },
  { key: '1w', label: '1 week' },
  { key: 'always', label: 'Always' },
];

export const isMutedNow = (c) => !!(c && c.muted && (!c.mutedUntil || Date.parse(c.mutedUntil) > Date.now()));

export function muteLabel(c) {
  if (!isMutedNow(c)) return '';
  if (!c.mutedUntil) return 'Muted';
  const d = new Date(c.mutedUntil);
  const sameDay = d.toDateString() === new Date().toDateString();
  const when = sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `Muted until ${when}`;
}

export function MuteSheet({ visible, title, onClose, onPick }) {
  return (
    <AnimatedModal visible={!!visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Mute notifications</Text>
          <Text style={styles.sheetSub}>{title ? `${title} stays in your chats. ` : ''}You’ll still be notified when someone @mentions you.</Text>
          {MUTE_OPTIONS.map((o) => (
            <Pressable key={o.key} onPress={() => { onClose(); onPick(o.key); }} style={({ pressed }) => [styles.opt, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button" accessibilityLabel={`Mute for ${o.label}`}>
              <View style={styles.optIcon}><Icon name={o.key === 'always' ? 'volume' : 'clock'} size={16} color={colors.primary} /></View>
              <Text style={styles.optText}>{o.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={({ pressed }) => [styles.opt, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button" accessibilityLabel="Cancel">
            <View style={styles.optIcon}><Icon name="x" size={16} color={colors.muted} /></View>
            <Text style={[styles.optText, { color: colors.muted }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 10, marginTop: 6, padding: 8, borderRadius: radius.md, backgroundColor: colors.raised, borderLeftWidth: 3, borderLeftColor: colors.primary, maxWidth: 320 },
  cardMine: { backgroundColor: 'rgba(255,255,255,0.12)', borderLeftColor: colors.goldLight || '#E2BC6A' },
  thumb: { width: 54, height: 54, borderRadius: 8, backgroundColor: colors.surface },
  thumbIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  body: { flex: 1, minWidth: 0, justifyContent: 'center' },
  site: { fontSize: 11, fontFamily: 'DMSans-SemiBold', letterSpacing: 0.3, color: colors.muted, textTransform: 'lowercase' },
  title: { fontSize: 13.5, fontFamily: 'DMSans-Bold', lineHeight: 18, color: colors.fg },
  desc: { fontSize: 12.5, lineHeight: 16.5, color: colors.muted, marginTop: 1 },
  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 26, gap: 4, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 8 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg },
  sheetSub: { fontSize: 12.5, lineHeight: 17, color: colors.muted, marginBottom: 6 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 4, borderRadius: radius.md },
  optIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  optText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: colors.fg },
});
