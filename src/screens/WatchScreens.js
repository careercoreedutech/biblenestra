// Watch — YouTube channels curated by the BibleNestra team (added in the admin dashboard at /admin).
// Videos come from each channel's public feed; they play inside the app (WebView / iframe embed).
import React, { useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, Empty, Eyebrow, Badge, alpha, NightGlow } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, Shimmer, LiveRing } from '../components/Motion';
import YouTubePlayer from '../components/YouTubePlayer';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useYouTubeChannels, useChannelVideos, relDate, views } from '../api/youtube';

function Avatar({ ch, size = 40, ring }) {
  const initials = (ch.title || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return ch.avatarUrl ? (
    <Image source={{ uri: ch.avatarUrl }} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.raised }, ring && styles.ring]} />
  ) : (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardIndigo, alignItems: 'center', justifyContent: 'center' }, ring && styles.ring]}>
      <Text style={{ fontFamily: fonts.serifBold, fontSize: size * 0.38, color: colors.primary }}>{initials}</Text>
    </View>
  );
}

function SoonCard() {
  return (
    <ScaleIn from={0.95} style={styles.soon}>
      <NightGlow />
      <View style={styles.soonIcon}><Icon name="video" size={22} color={colors.goldLight} /></View>
      <Text style={styles.soonTitle}>Channels coming soon</Text>
      <Text style={styles.soonBody}>Sermons, worship and live services from trusted ministries will appear here.</Text>
    </ScaleIn>
  );
}

function ChannelCard({ ch, index }) {
  const nav = useNav();
  const { data } = useChannelVideos(ch.id);
  const latest = data && data.videos && (data.videos.find((v) => !v.isShort) || data.videos[0]);
  return (
    <FadeInUp index={index} distance={10}>
      <PressScale scaleTo={0.97} onPress={() => nav.push('YouTubeChannel', { id: ch.id, channel: ch })} style={styles.card} accessibilityRole="button" accessibilityLabel={`Watch ${ch.title}`}>
        <View style={styles.thumbWrap}>
          {latest ? <Image source={{ uri: latest.thumbnail }} style={styles.thumb} /> : <Shimmer style={styles.thumb} />}
          <View style={styles.playBadge}><Icon name="play" size={14} color="#FFFFFF" fill="solid" /></View>
          {ch.featured ? <View style={styles.featured}><Text style={styles.featuredText}>Featured</Text></View> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, padding: 12, alignItems: 'center' }}>
          <Avatar ch={ch} size={34} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{ch.title}</Text>
            <Text style={styles.cardMeta} numberOfLines={1}>{latest ? latest.title : ch.category}</Text>
          </View>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

/** Discover → "Watch" row (online mode). */
export function YouTubeSection() {
  const nav = useNav();
  const { items } = useYouTubeChannels();
  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Watch</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Sermons & Worship</Text>
          {items && items.length ? (
            <Pressable onPress={() => nav.push('Watch')} hitSlop={10} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
              <Text style={styles.actionText}>See all</Text>
              <Icon name="chevron-right" size={12} color={colors.primary} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.sub}>Trusted YouTube channels · live services & recent messages</Text>
      </View>
      {items == null ? (
        <View style={{ flexDirection: 'row', gap: 12 }}><Shimmer style={[styles.card, { height: 190 }]} /><Shimmer style={[styles.card, { height: 190 }]} /></View>
      ) : items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingBottom: 8 }}>
          {items.slice(0, 8).map((ch, i) => <ChannelCard key={ch.id} ch={ch} index={i} />)}
        </ScrollView>
      ) : <SoonCard />}
    </View>
  );
}

/** Route 'Watch': every channel. */
export function WatchScreen() {
  const nav = useNav();
  const { items, error, reload, online } = useYouTubeChannels();
  const groups = (items || []).reduce((acc, ch) => {
    const k = ch.featured ? 'Featured' : ch.category || 'Channels';
    (acc[k] = acc[k] || []).push(ch);
    return acc;
  }, {});
  return (
    <Screen back title="Watch" subtitle="Sermons · worship · live services">
      {!online ? (
        <View style={[styles.emptyCard, { marginTop: 12 }]}><Empty title="Sign in to watch" body="YouTube channels picked by the BibleNestra team appear here when you’re signed in." /></View>
      ) : items == null ? (
        <View style={{ marginTop: 12 }}><Shimmer style={{ height: 64, borderRadius: 16 }} /><Shimmer style={{ height: 64, borderRadius: 16, marginTop: 10 }} /></View>
      ) : !items.length ? (
        <View style={{ marginTop: 12 }}><SoonCard />{error ? <Text style={[styles.cardMeta, { marginTop: 10, textAlign: 'center' }]} onPress={reload}>{error} · tap to retry</Text> : null}</View>
      ) : Object.entries(groups).map(([g, list], gi) => (
        <View key={g} style={{ marginTop: gi ? 22 : 10 }}>
          <Eyebrow>{g}</Eyebrow>
          <View style={styles.group}>
            {list.map((ch, i) => (
              <FadeInUp key={ch.id} index={i + gi}>
                <Pressable onPress={() => nav.push('YouTubeChannel', { id: ch.id, channel: ch })} style={({ pressed }) => [styles.rowItem, i > 0 && styles.sep, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button">
                  <Avatar ch={ch} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{ch.title}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>{[ch.handle ? `@${ch.handle}` : null, ch.category].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Icon name="chevron-right" size={15} color={colors.faint} />
                </Pressable>
              </FadeInUp>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

/** Route 'YouTubeChannel': live player + recent videos. params: { id, channel? } */
export function YouTubeChannelScreen({ params = {} }) {
  const { items } = useYouTubeChannels();
  const ch = params.channel || (items || []).find((x) => x.id === params.id) || null;
  const { data, error, reload } = useChannelVideos(params.id);
  const channel = (data && data.channel) || ch;
  const videos = (data && data.videos) || [];
  const [playing, setPlaying] = useState(null); // { embedUrl, url, title, live }
  const scroller = useRef(null);
  if (!channel) {
    return <Screen back title="Watch">{error ? <View style={[styles.emptyCard, { marginTop: 12 }]}><Empty title="Channel unavailable" body={error} action="Try again" onAction={reload} /></View> : <Shimmer style={{ height: 200, borderRadius: 18, marginTop: 12 }} />}</Screen>;
  }
  const latest = videos.find((v) => !v.isShort) || videos[0];
  const liveUrl = (data && data.liveEmbedUrl) || channel.liveEmbedUrl;
  const play = (v) => setPlaying(v);
  return (
    <Screen back title={channel.title} subtitle={[channel.handle ? `@${channel.handle}` : null, channel.category].filter(Boolean).join(' · ')}>
      <ScaleIn from={0.96} style={styles.playerCard}>
        {playing ? (
          <YouTubePlayer key={playing.embedUrl} embedUrl={playing.embedUrl} watchUrl={playing.url} live={playing.live} />
        ) : (
          <Pressable onPress={() => (latest ? play({ embedUrl: latest.embedUrl, url: latest.url, title: latest.title }) : play({ embedUrl: liveUrl, url: channel.url, title: 'Live', live: true }))} style={styles.poster} accessibilityRole="button" accessibilityLabel="Play">
            {latest ? <Image source={{ uri: latest.thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <NightGlow />}
            <View style={styles.posterShade} />
            <View style={styles.bigPlay}><Icon name="play" size={26} color={colors.night} fill="solid" /></View>
            <Text style={styles.posterTitle} numberOfLines={2}>{latest ? latest.title : 'Watch live'}</Text>
          </Pressable>
        )}
        <View style={styles.playerBar}>
          <Text style={styles.nowTitle} numberOfLines={1}>{playing ? (playing.live ? `Live · ${channel.title}` : playing.title) : 'Latest message'}</Text>
          <Pressable onPress={() => Linking.openURL(playing ? playing.url : latest ? latest.url : channel.url).catch(() => {})} hitSlop={8} style={styles.ytLink} accessibilityRole="link">
            <Text style={styles.ytLinkText}>Watch on YouTube</Text>
            <Icon name="arrow-up-right" size={12} color={colors.goldLight} />
          </Pressable>
        </View>
      </ScaleIn>

      <FadeInUp index={1}>
        <PressScale scaleTo={0.98} onPress={() => play({ embedUrl: liveUrl, url: `${channel.url}/live`, title: 'Live', live: true })} style={styles.liveCard} accessibilityRole="button" accessibilityLabel="Watch live now">
          <View style={styles.liveDot}><LiveRing color={colors.rose} size={7} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.rowTitle}>Live now</Text>
            <Text style={styles.cardMeta}>Plays the channel’s live service when they’re streaming</Text>
          </View>
          <Badge label="Live" tint={colors.rose} />
        </PressScale>
      </FadeInUp>

      <Text style={[styles.eyebrow, { marginTop: 24, marginBottom: 4 }]}>Recent videos</Text>
      {data == null && !error ? (
        <View><Shimmer style={{ height: 76, borderRadius: 14, marginTop: 10 }} /><Shimmer style={{ height: 76, borderRadius: 14, marginTop: 10 }} /></View>
      ) : error && !videos.length ? (
        <View style={[styles.emptyCard, { marginTop: 10 }]}><Empty title="Couldn’t load videos" body={error} action="Try again" onAction={reload} /></View>
      ) : videos.length ? videos.map((v, i) => {
        const on = playing && playing.embedUrl === v.embedUrl;
        return (
          <FadeInUp key={v.videoId} index={i + 2}>
            <PressScale scaleTo={0.98} onPress={() => play({ embedUrl: v.embedUrl, url: v.url, title: v.title })} style={[styles.videoRow, on && styles.videoOn]} accessibilityRole="button" accessibilityLabel={`Play ${v.title}`}>
              <View>
                <Image source={{ uri: v.thumbnail }} style={styles.videoThumb} />
                {v.isShort ? <View style={styles.shortTag}><Text style={styles.shortText}>Short</Text></View> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.videoTitle} numberOfLines={2}>{v.title}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{[relDate(v.published), views(v.views)].filter(Boolean).join(' · ')}</Text>
              </View>
              {on ? <Icon name="volume" size={16} color={colors.primary} /> : null}
            </PressScale>
          </FadeInUp>
        );
      }) : <View style={[styles.emptyCard, { marginTop: 10 }]}><Empty title="No videos yet" body="This channel hasn’t published any public videos." /></View>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 30, marginBottom: 14 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginBottom: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 27, color: colors.fg, letterSpacing: -0.4 },
  sub: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 3 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  actionText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  card: { width: 236, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.sm },
  thumbWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.night },
  thumb: { width: '100%', height: '100%' },
  playBadge: { position: 'absolute', right: 10, bottom: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  featured: { position: 'absolute', left: 10, top: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: alpha(colors.night, 0.75) },
  featuredText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.goldLight },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.fg },
  cardMeta: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },
  ring: { borderWidth: 2, borderColor: colors.surface },
  soon: { backgroundColor: colors.night, borderRadius: radius.lg, padding: 20, alignItems: 'center', overflow: 'hidden', ...shadow.md },
  soonIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: alpha(colors.goldLight, 0.4), alignItems: 'center', justifyContent: 'center' },
  soonTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.nightFg, marginTop: 12 },
  soonBody: { fontSize: 13, lineHeight: 19, color: colors.nightMuted, textAlign: 'center', marginTop: 6, maxWidth: 280 },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, ...shadow.sm },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginTop: 8, ...shadow.sm },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  sep: { borderTopWidth: 1, borderTopColor: colors.rule },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.fg },
  playerCard: { backgroundColor: colors.night, borderRadius: radius.lg, overflow: 'hidden', marginTop: 8, ...shadow.md },
  poster: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.night },
  posterShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  bigPlay: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  posterTitle: { position: 'absolute', left: 14, right: 14, bottom: 12, fontFamily: fonts.serifBold, fontSize: 17, lineHeight: 22, color: '#FFFFFF' },
  playerBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  nowTitle: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.nightFg },
  ytLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ytLinkText: { fontSize: 12.5, fontWeight: '700', color: colors.goldLight },
  liveCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  liveDot: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginTop: 10, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  videoOn: { borderColor: alpha(colors.primary, 0.4), backgroundColor: colors.primarySoft },
  videoThumb: { width: 128, aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: colors.raised },
  videoTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19, color: colors.fg },
  shortTag: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.65)' },
  shortText: { fontSize: 9.5, fontWeight: '800', color: '#FFFFFF', textTransform: 'uppercase' },
});
