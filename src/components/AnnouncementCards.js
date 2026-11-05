// ROUND 5 — app-wide announcements from the admin dashboard, shown at the top of Today.
// Online mode only (loaded by the sync layer into state.announcements). Dismissed ids are remembered on the device.
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { FadeInUp, PressScale } from './Motion';
import { alpha } from './ui';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { BOOKS } from '../data/bible';

const LABEL = { info: 'Announcement', verse: 'Verse of the day', event: 'Event', update: 'App update', urgent: 'Important' };

// "Isaiah 9:6", "1 John 4:8", "Ps 23" → { bookId, chapter }
function findPassage(ref) {
  const m = String(ref || '').trim().match(/^(.+?)\s+(\d+)(?::\d+(?:-\d+)?)?$/);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  const book = BOOKS.find((b) => b.name.toLowerCase() === name || b.id.toLowerCase() === name.replace(/\s/g, ''))
    || BOOKS.find((b) => b.name.toLowerCase().startsWith(name));
  if (!book) return null;
  const chapter = Math.min(Number(m[2]) || 1, book.chapters);
  return { bookId: book.id, chapter };
}

export default function AnnouncementCards({ style }) {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const dismissed = state.dismissedAnnouncements || [];
  const items = (state.announcements || []).filter((a) => !dismissed.includes(a.id));
  if (!items.length) return null;
  const dismiss = (id) => dispatch({ type: 'set', patch: { dismissedAnnouncements: [...dismissed, id].slice(-50) } });
  return (
    <View style={[{ gap: 10 }, style]}>
      {items.map((a, i) => {
        const urgent = a.kind === 'urgent';
        const tint = urgent ? colors.negative : colors.gold;
        const passage = a.verseRef ? findPassage(a.verseRef) : null;
        return (
          <FadeInUp key={a.id} index={i} style={[styles.card, urgent && styles.cardUrgent]}>
            <View style={styles.head}>
              <View style={[styles.icon, { backgroundColor: alpha(tint, 0.13) }]}>
                <Icon name={urgent ? 'bell' : a.kind === 'verse' ? 'book' : a.kind === 'event' ? 'calendar' : 'sparkles'} size={14} color={tint} />
              </View>
              <Text style={[styles.eyebrow, { color: tint }]}>{LABEL[a.kind] || LABEL.info}</Text>
              <View style={{ flex: 1 }} />
              <PressScale onPress={() => dismiss(a.id)} hitSlop={10} scaleTo={0.88} style={styles.close} accessibilityLabel="Dismiss announcement">
                <Icon name="x" size={12} color={colors.muted} />
              </PressScale>
            </View>
            <Text style={styles.title}>{a.title}</Text>
            {a.body ? <Text style={styles.body}>{a.body}</Text> : null}
            {a.verseRef || a.linkUrl ? (
              <View style={styles.actions}>
                {a.verseRef ? (
                  <Pressable disabled={!passage} onPress={() => passage && nav.push('Bible', passage)} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]} accessibilityLabel={`Open ${a.verseRef}`}>
                    <Icon name="book" size={12} color={colors.gold} />
                    <Text style={styles.chipText}>{a.verseRef}</Text>
                  </Pressable>
                ) : null}
                {a.linkUrl ? (
                  <Pressable onPress={() => Linking.openURL(a.linkUrl).catch(() => {})} style={({ pressed }) => [styles.link, pressed && { opacity: 0.75 }]} accessibilityRole="link">
                    <Text style={styles.linkText}>Learn more</Text>
                    <Icon name="chevron-right" size={13} color={colors.primary} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </FadeInUp>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.cardGold, borderRadius: radius.lg, borderWidth: 1, borderColor: alpha(colors.gold, 0.28), padding: 16, ...shadow.sm },
  cardUrgent: { backgroundColor: '#FBF1F0', borderColor: alpha(colors.negative, 0.3) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  close: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serifBold, fontSize: 19, lineHeight: 24, color: colors.fg, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: alpha(colors.gold, 0.12), borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.gold },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
});
