// "Watch: From Our Channels" (bottom of Today, in place of Sacred Audio Devotionals): the latest videos of the
// YouTube channels the admins connected, in the same horizontal card style. Data: GET /youtube/latest (server
// reads the channels' public feeds, cached ~30 min; cached on the device too). Tapping a card opens the official
// YouTube player full screen (YouTubeWatch); "See all" opens every channel's recent videos (ChannelVideos).
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { alpha } from './ui';
import { FadeInUp, PressScale, Shimmer } from './Motion';
import { useNav } from '../navigation';
import { useLatestVideos } from '../api/daily';
import { relDate } from '../api/youtube';

export function ChannelAvatar({ channel, size = 22 }) {
  const initials = String((channel && channel.title) || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  if (channel && channel.avatarUrl) return <Image source={{ uri: channel.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.raised }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardIndigo || colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: colors.primary }}>{initials}</Text>
    </View>
  );
}

export const playYouTube = (nav, v) => nav.push('YouTubeWatch', { videoId: v.videoId, title: v.title, channelTitle: v.channel && v.channel.title, fullscreen: true, vertical: !!v.isShort });

export default function ChannelVideosRow({ style }) {
  const nav = useNav();
  const { data, loaded, online } = useLatestVideos();
  const items = (data && data.items) || [];
  // nothing connected (or offline / local mode): the section stays out of the way
  if (!online || (loaded && !items.length)) return null;
  return (
    <View style={style}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Watch</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>From Our Channels</Text>
          <Pressable onPress={() => nav.push('ChannelVideos')} hitSlop={10} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="See all channel videos">
            <Text style={styles.actionText}>See all</Text>
            <Icon name="chevron-right" size={12} color={colors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>
        <Text style={styles.sub}>The latest sermons & worship from the channels we follow</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hScroll}>
        {!items.length ? [0, 1].map((k) => <Shimmer key={k} style={[styles.card, { height: 196 }]} />) : items.map((v, i) => (
          <FadeInUp key={v.videoId} index={Math.min(i, 4)} distance={10}>
            <VideoCard v={v} onPress={() => playYouTube(nav, v)} />
          </FadeInUp>
        ))}
      </ScrollView>
    </View>
  );
}

export function VideoCard({ v, onPress, width = 212 }) {
  return (
    <PressScale scaleTo={0.97} style={[styles.card, { width }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Play ${v.title}`}>
      <View>
        <Image source={{ uri: v.thumbnail }} style={[styles.thumb, { height: Math.round(width * 9 / 16) }]} resizeMode="cover" />
        <View style={styles.timeBadge}>
          <Icon name="play" size={9} color={colors.nightFg} fill="solid" />
          <Text style={styles.timeText}>{v.isShort ? 'SHORT' : (relDate(v.published) || 'VIDEO').toUpperCase()}</Text>
        </View>
        <View style={styles.playBubble}><Icon name="play" size={15} color="#FFFFFF" fill="solid" /></View>
      </View>
      <View style={styles.info}>
        <Text style={styles.cardTitle} numberOfLines={2}>{v.title}</Text>
        <View style={styles.chRow}>
          <ChannelAvatar channel={v.channel} size={20} />
          <Text style={styles.chName} numberOfLines={1}>{v.channel ? v.channel.title : ''}</Text>
        </View>
      </View>
    </PressScale>
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
  thumb: { width: '100%', backgroundColor: colors.raised },
  timeBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: alpha(colors.night, 0.72), paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  timeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.nightFg },
  playBubble: { position: 'absolute', right: 12, bottom: -18, width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  info: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 13, paddingRight: 52 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 15, lineHeight: 19, color: colors.fg, letterSpacing: -0.2, minHeight: 38 },
  chRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  chName: { flexShrink: 1, fontSize: 12, color: colors.muted, fontWeight: '600' },
});
