// "Sacred Audio Devotionals": a row of short narrated chapters (bottom of Today).
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { alpha } from './ui';
import { FadeInUp, PressScale } from './Motion';
import { useNarration } from '../audio/Narration';
import { useToast } from './Toast';
import { useNav } from '../navigation';
import { refLabel } from '../data/bible';

export const DEVOTIONALS_AUDIO = [
  { id: 'dev1', title: 'Walking in Grace', sub: 'Psalm 23 · Ambient reading', time: '12 MIN', passage: { bookId: 'PSA', chapter: 23 }, img: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=600&q=80' },
  { id: 'dev2', title: 'The Armor of Light', sub: 'Ephesians 6 · Morning strength', time: '8 MIN', passage: { bookId: 'EPH', chapter: 6 }, img: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?auto=format&fit=crop&w=600&q=80' },
  { id: 'dev3', title: 'Midnight Peace & Vigil', sub: 'Proverbs 3 · Night liturgy', time: '15 MIN', passage: { bookId: 'PRO', chapter: 3 }, img: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80' },
];

export default function AudioDevotionals({ style }) {
  const nar = useNarration();
  const toast = useToast();
  const nav = useNav();
  const play = (dev) => {
    const { bookId, chapter } = dev.passage;
    nar.playChapter(bookId, chapter, { translation: 'KJV' });
    toast.show(`Playing ${dev.title} · ${refLabel(bookId, chapter)}`, { icon: 'audio', action: { label: 'Read', onPress: () => nav.push('Bible', { bookId, chapter }) } });
  };
  return (
    <View style={style}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Listen</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Sacred Audio Devotionals</Text>
          <Pressable onPress={() => nav.push('Learn', { tab: 'Devotionals' })} hitSlop={10} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
            <Text style={styles.actionText}>Explore</Text>
            <Icon name="chevron-right" size={12} color={colors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>
        <Text style={styles.sub}>Immersive scripture listening & guided silence</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hScroll}>
        {DEVOTIONALS_AUDIO.map((dev, i) => (
          <FadeInUp key={dev.id} index={i} distance={10}>
            <PressScale scaleTo={0.97} style={styles.card} onPress={() => play(dev)} accessibilityLabel={`Play ${dev.title}`}>
              <View>
                <Image source={{ uri: dev.img }} style={styles.thumb} />
                <View style={styles.timeBadge}>
                  <Icon name="audio" size={10} color={colors.nightFg} />
                  <Text style={styles.timeText}>{dev.time}</Text>
                </View>
                <View style={styles.playBubble}><Icon name="play" size={15} color="#FFFFFF" /></View>
              </View>
              <View style={styles.info}>
                <Text style={styles.cardTitle} numberOfLines={1}>{dev.title}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>{dev.sub}</Text>
              </View>
            </PressScale>
          </FadeInUp>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { marginBottom: 12 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.gold, marginBottom: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flexShrink: 1, fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 27, color: colors.fg, letterSpacing: -0.3 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  actionText: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
  sub: { marginTop: 3, fontSize: 13, color: colors.muted },
  bleed: { marginHorizontal: -18 },
  hScroll: { gap: 12, paddingHorizontal: 18, paddingTop: 2, paddingBottom: 8 },
  card: { width: 212, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.sm },
  thumb: { width: '100%', height: 124, backgroundColor: colors.raised },
  timeBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: alpha(colors.night, 0.72), paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  timeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.nightFg },
  playBubble: { position: 'absolute', right: 12, bottom: -18, width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  info: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, paddingRight: 56 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg, letterSpacing: -0.2 },
  cardSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
