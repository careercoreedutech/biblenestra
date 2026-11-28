import { colors } from '../theme';
// Watch — YouTube channels curated by the BibleNestra team (added in the admin dashboard at /admin).
// Videos come from each channel's public feed; they play inside the app (WebView / iframe embed).
// Look: the design's LiveStudy page (dark live stage, paper cards, plum accents) on the design kit.
import React from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Empty } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, Shimmer, LiveRing } from '../components/Motion';
import { useNav } from '../navigation';
import { useYouTubeChannels, useChannelVideos, relDate, views, useLiveNow } from '../api/youtube';
import { d, df, Grad, SectionTitle, Eyebrow } from '../design/sanctuary';
import { DScreen, DCard } from '../design/profile/parts';

const STAGE_GRAD = ['#422819', '#8A451F', '#E36A1F'];
const NIGHT_GRAD = ['#3C2518', '#8A4B25'];

function Avatar({ ch, size = 40, ring }) {
  const initials = (ch.title || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return ch.avatarUrl ? (
    <Image source={{ uri: ch.avatarUrl }} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: d.lavender }, ring && styles.ring]} />
  ) : (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' }, ring && styles.ring]}>
      <Text style={{ fontFamily: df.displayBold, fontSize: size * 0.38, color: d.plum }}>{initials}</Text>
    </View>
  );
}

function SoonCard() {
  return (
    <ScaleIn from={0.95} style={styles.soon}>
      <Grad colors={NIGHT_GRAD} style={styles.soonInner}>
        <View style={styles.soonIcon}><Icon name="video" size={22} color={d.gold} /></View>
        <Text style={styles.soonTitle}>Channels coming soon</Text>
        <Text style={styles.soonBody}>Sermons, worship and live services from trusted ministries will appear here.</Text>
      </Grad>
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

/** YOUTUBE LIVE: services streaming now / starting soon (detected by the server) → big Watch screen */
function LiveNowRow({ items }) {
  const nav = useNav();
  if (!items || !items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 12 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18 }}>
      {items.slice(0, 6).map((x, i) => (
        <FadeInUp key={x.videoId} index={i} distance={8}>
          <PressScale scaleTo={0.97} onPress={() => nav.push('YouTubeWatch', { videoId: x.videoId, title: x.title, channelTitle: x.channelTitle, live: x.status === 'live' })} style={styles.liveStrip} accessibilityRole="button" accessibilityLabel={(x.status === 'live' ? 'Live now: ' : 'Upcoming: ') + x.title}>
            <View style={styles.thumbWrap}>
              <Image source={{ uri: x.thumbnail }} style={styles.thumb} />
              <View style={[styles.liveTag, x.status !== 'live' && { backgroundColor: 'rgba(40,26,17,0.8)' }]}><Text style={styles.liveTagText}>{x.status === 'live' ? '● LIVE' : 'UPCOMING'}</Text></View>
            </View>
            <View style={{ padding: 12 }}>
              <Text style={[styles.cardTitle, { color: '#FFF2E5' }]} numberOfLines={1}>{x.channelTitle || 'Live service'}</Text>
              <Text style={[styles.cardMeta, { color: '#E9CFBA' }]} numberOfLines={1}>{x.status === 'live' ? x.title : x.scheduledStart ? new Date(x.scheduledStart).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' · ' + x.title : x.title}</Text>
            </View>
          </PressScale>
        </FadeInUp>
      ))}
    </ScrollView>
  );
}

/** Discover → "Watch" row (online mode). */
export function YouTubeSection() {
  const nav = useNav();
  const { items } = useYouTubeChannels();
  const liveNow = useLiveNow(); // YOUTUBE LIVE
  return (
    <View>
      <SectionTitle
        eyebrow="Watch"
        title="Sermons & Worship"
        link={items && items.length ? 'See all' : undefined}
        onLink={() => nav.push('Watch')}
      />
      <Text style={styles.sub}>Trusted YouTube channels · live services & recent messages</Text>
      <View style={{ height: 12 }} />
      <LiveNowRow items={liveNow} />
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
    <DScreen title="Watch" subtitle="Sermons · worship · live services" back onBack={() => nav.pop()}>
      {!online ? (
        <DCard style={{ marginTop: 12 }}><Empty title="Sign in to watch" body="YouTube channels picked by the BibleNestra team appear here when you’re signed in." /></DCard>
      ) : items == null ? (
        <View style={{ marginTop: 12 }}><Shimmer style={{ height: 64, borderRadius: 16 }} /><Shimmer style={{ height: 64, borderRadius: 16, marginTop: 10 }} /></View>
      ) : !items.length ? (
        <View style={{ marginTop: 12 }}><SoonCard />{error ? <Text style={[styles.cardMeta, { marginTop: 10, textAlign: 'center' }]} onPress={reload}>{error} · tap to retry</Text> : null}</View>
      ) : Object.entries(groups).map(([g, list], gi) => (
        <View key={g} style={{ marginTop: gi ? 22 : 10 }}>
          <Eyebrow style={{ marginBottom: 4 }}>{g}</Eyebrow>
          <DCard style={styles.group}>
            {list.map((ch, i) => (
              <FadeInUp key={ch.id} index={i + gi}>
                <Pressable onPress={() => nav.push('YouTubeChannel', { id: ch.id, channel: ch })} style={({ pressed }) => [styles.rowItem, i > 0 && styles.sep, pressed && { backgroundColor: d.lavender }]} accessibilityRole="button">
                  <Avatar ch={ch} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{ch.title}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>{[ch.handle ? `@${ch.handle}` : null, ch.category].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Icon name="chevron-right" size={15} color="#AAA6AD" />
                </Pressable>
              </FadeInUp>
            ))}
          </DCard>
        </View>
      ))}
    </DScreen>
  );
}

/** Route 'YouTubeChannel': live player + recent videos. params: { id, channel? } */
export function YouTubeChannelScreen({ params = {} }) {
  const { items } = useYouTubeChannels();
  const ch = params.channel || (items || []).find((x) => x.id === params.id) || null;
  const { data, error, reload } = useChannelVideos(params.id);
  const channel = (data && data.channel) || ch;
  const videos = (data && data.videos) || [];
  const nav = useNav();
  const liveNow = useLiveNow();
  const shell = (title, subtitle, children) => <DScreen title={title} subtitle={subtitle} back onBack={() => nav.pop()}>{children}</DScreen>;
  if (!channel) {
    return shell('Watch', undefined, error ? <DCard style={{ marginTop: 12 }}><Empty title="Channel unavailable" body={error} action="Try again" onAction={reload} /></DCard> : <Shimmer style={{ height: 200, borderRadius: 18, marginTop: 12 }} />);
  }
  const latest = videos.find((v) => !v.isShort) || videos[0];
  // YOUTUBE LIVE: videos open on the big Watch screen (player + Bible Nestra comments)
  const onAir = liveNow.find((x) => x.channelId === channel.channelId && x.status === 'live');
  const soon = liveNow.find((x) => x.channelId === channel.channelId && x.status === 'upcoming');
  const play = (v) => nav.push('YouTubeWatch', { videoId: v.videoId, title: v.title, channelTitle: channel.title });
  const playLive = () => (onAir
    ? nav.push('YouTubeWatch', { videoId: onAir.videoId, title: onAir.title, channelTitle: channel.title, live: true })
    : nav.push('YouTubeWatch', { channelId: channel.channelId, title: `Live · ${channel.title}`, channelTitle: channel.title, live: true }));
  const subtitle = [channel.handle ? `@${channel.handle}` : null, channel.category].filter(Boolean).join(' · ');
  return shell(channel.title, subtitle, (
    <>
      {/* live stage (LiveStudy look): dark gradient card with the poster, LIVE tag and watch-on-YouTube link */}
      <ScaleIn from={0.96} style={styles.playerCard}>
        <Grad colors={STAGE_GRAD} style={styles.stage}>
          <Pressable onPress={() => (onAir || !latest ? playLive() : play(latest))} style={styles.poster} accessibilityRole="button" accessibilityLabel="Play">
            {onAir || latest ? <Image source={{ uri: (onAir || latest).thumbnail }} style={styles.posterImg} resizeMode="cover" /> : null}
            <View style={styles.posterShade} />
            <View style={styles.bigPlay}><Icon name="play" size={26} color={d.plumDark} fill="solid" /></View>
            <Text style={styles.posterTitle} numberOfLines={2}>{onAir ? onAir.title : latest ? latest.title : 'Watch live'}</Text>
            {onAir ? <View style={styles.liveTag}><Text style={styles.liveTagText}>● LIVE</Text></View> : null}
          </Pressable>
          <View style={styles.playerBar}>
            <Text style={styles.nowTitle} numberOfLines={1}>{onAir ? `Live now · ${channel.title}` : 'Latest message'}</Text>
            <Pressable onPress={() => Linking.openURL(onAir ? onAir.watchUrl : latest ? latest.url : channel.url).catch(() => {})} hitSlop={8} style={styles.ytLink} accessibilityRole="link">
              <Text style={styles.ytLinkText}>Watch on YouTube</Text>
              <Icon name="arrow-up-right" size={12} color={d.gold} />
            </Pressable>
          </View>
        </Grad>
      </ScaleIn>

      <FadeInUp index={1}>
        <PressScale scaleTo={0.98} onPress={playLive} style={styles.liveCard} accessibilityRole="button" accessibilityLabel="Watch live now">
          <View style={styles.liveDot}><LiveRing color={d.roseDark} size={7} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.rowTitle}>{onAir ? 'Live now — join the service' : 'Live services'}</Text>
            <Text style={styles.cardMeta} numberOfLines={2}>{onAir ? onAir.title : soon && soon.scheduledStart ? `Next: ${soon.title} · ${new Date(soon.scheduledStart).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Plays the channel’s live service when they’re streaming'}</Text>
          </View>
          <View style={styles.badge}><Text style={styles.badgeText}>{onAir ? 'Live' : soon ? 'Soon' : 'Live'}</Text></View>
        </PressScale>
      </FadeInUp>

      <SectionTitle eyebrow="Replays" title="Recent videos" />
      {data == null && !error ? (
        <View><Shimmer style={{ height: 76, borderRadius: 14, marginTop: 10 }} /><Shimmer style={{ height: 76, borderRadius: 14, marginTop: 10 }} /></View>
      ) : error && !videos.length ? (
        <DCard style={{ marginTop: 10 }}><Empty title="Couldn’t load videos" body={error} action="Try again" onAction={reload} /></DCard>
      ) : videos.length ? videos.map((v, i) => {
        return (
          <FadeInUp key={v.videoId} index={i + 2}>
            <PressScale scaleTo={0.98} onPress={() => play(v)} style={styles.videoRow} accessibilityRole="button" accessibilityLabel={`Play ${v.title}`}>
              <View>
                <Image source={{ uri: v.thumbnail }} style={styles.videoThumb} />
                {v.isShort ? <View style={styles.shortTag}><Text style={styles.shortText}>Short</Text></View> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.videoTitle} numberOfLines={2}>{v.title}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{[relDate(v.published), views(v.views)].filter(Boolean).join(' · ')}</Text>
              </View>
              <Icon name="play" size={14} color={d.plum} fill="solid" />
            </PressScale>
          </FadeInUp>
        );
      }) : <DCard style={{ marginTop: 10 }}><Empty title="No videos yet" body="This channel hasn’t published any public videos." /></DCard>}
    </>
  ));
}

const styles = StyleSheet.create({
  sub: { fontFamily: df.sans, fontSize: 13, lineHeight: 18, color: d.muted, marginTop: -6 },
  card: { width: 236, backgroundColor: d.paper, borderRadius: 18, borderWidth: 1, borderColor: d.line, overflow: 'hidden', shadowColor: colors.fg, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  thumbWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: d.plumDark },
  thumb: { width: '100%', height: '100%' },
  playBadge: { position: 'absolute', right: 10, bottom: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(40,26,17,0.6)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  featured: { position: 'absolute', left: 10, top: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(40,26,17,0.75)' },
  featuredText: { fontFamily: df.sansHeavy, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: d.gold },
  cardTitle: { fontFamily: df.sansBold, fontSize: 14, color: d.ink },
  cardMeta: { fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 2, lineHeight: 16 },
  ring: { borderWidth: 2, borderColor: d.paper },
  soon: { borderRadius: 22, overflow: 'hidden' },
  soonInner: { borderRadius: 22, padding: 22, alignItems: 'center' },
  soonIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: 'rgba(244,216,140,0.45)', alignItems: 'center', justifyContent: 'center' },
  soonTitle: { fontFamily: df.displayBold, fontSize: 20, color: '#FFF2E5', marginTop: 12 },
  soonBody: { fontFamily: df.sans, fontSize: 13, lineHeight: 19, color: '#E9CFBA', textAlign: 'center', marginTop: 6, maxWidth: 280 },
  group: { marginTop: 8, overflow: 'hidden', padding: 0 },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  sep: { borderTopWidth: 1, borderTopColor: d.line },
  rowTitle: { fontFamily: df.sansBold, fontSize: 15, color: d.ink },
  playerCard: { borderRadius: 22, overflow: 'hidden', marginTop: 4, shadowColor: colors.fg, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  stage: { borderRadius: 22 },
  poster: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: d.plumDark },
  posterImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  posterShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(40,26,17,0.35)' },
  bigPlay: { width: 62, height: 62, borderRadius: 31, backgroundColor: d.gold, alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  posterTitle: { position: 'absolute', left: 14, right: 14, bottom: 12, fontFamily: df.displayBold, fontSize: 17, lineHeight: 22, color: '#FFFFFF' },
  playerBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  nowTitle: { flex: 1, fontFamily: df.sansSemi, fontSize: 13.5, color: '#FFF2E5' },
  ytLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ytLinkText: { fontFamily: df.sansBold, fontSize: 12.5, color: d.gold },
  liveCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 12, borderRadius: 18, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  liveDot: { width: 40, height: 40, borderRadius: 13, backgroundColor: d.rose, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: d.rose },
  badgeText: { fontFamily: df.sansHeavy, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: d.roseDark },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginTop: 10, borderRadius: 18, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  videoThumb: { width: 128, aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: d.lavender },
  videoTitle: { fontFamily: df.sansSemi, fontSize: 14, lineHeight: 19, color: d.ink },
  liveTag: { position: 'absolute', left: 12, top: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#CC0000' },
  liveTagText: { fontFamily: df.sansHeavy, fontSize: 11, color: '#FFFFFF', letterSpacing: 0.6 },
  liveStrip: { width: 236, borderRadius: 18, overflow: 'hidden', backgroundColor: d.plumDark },
  shortTag: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.65)' },
  shortText: { fontFamily: df.sansHeavy, fontSize: 9.5, color: '#FFFFFF', textTransform: 'uppercase' },
});
