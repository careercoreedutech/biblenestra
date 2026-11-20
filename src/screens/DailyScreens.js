// TODAY'S JOURNEY screens
//   'DailyVerse'     Daily Bread: the verse of the day (scheduled by admins at /admin, with their image and
//                    reflection; otherwise the app's own verse of the day + the verse image maker), Listen,
//                    Share as image, Save, Read chapter. The verse text always comes from the Bible data.
//   'BlessingVideos' admin-uploaded blessing videos in the full-screen vertical player (swipe for the next one).
//   'ChannelVideos'  "See all" of Watch: From Our Channels — recent videos grouped by channel.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Screen, Empty, NightGlow, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, Pop, ScaleIn, Shimmer } from '../components/Motion';
import { useToast } from '../components/Toast';
import VerseImageSheet from '../components/VerseImageSheet';
import VideoViewer from '../components/video/VideoViewer';
import { ChannelAvatar, VideoCard, playYouTube } from '../components/ChannelVideosRow';
import { useNarration } from '../audio/Narration';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { verseOfDay, refLabel } from '../data/bible';
import { useChapter } from '../bible/loader';
import { useBlessingVideos, useDailyToday, useLatestVideos } from '../api/daily';
import { colors, fonts, radius, shadow } from '../theme';

let FileSystem = null;
let Sharing = null;
try { FileSystem = require('expo-file-system'); } catch (e) { FileSystem = null; }
try { Sharing = require('expo-sharing'); } catch (e) { Sharing = null; }

/** Today's verse: the admin's Daily Bread when scheduled, else the built-in verse of the day */
export function useTodayVerse() {
  const { data, loaded } = useDailyToday();
  const bread = data && data.bread;
  const fallback = verseOfDay(new Date());
  const v = bread
    ? { bookId: bread.bookId, chapter: bread.chapter, verse: bread.verse, verseEnd: bread.verseEnd, label: bread.label, imageUrl: bread.imageUrl, reflection: bread.reflection, theme: null, scheduled: true }
    : { ...fallback, verseEnd: null, label: refLabel(fallback.bookId, fallback.chapter, fallback.verse), imageUrl: null, scheduled: false };
  return { v, loaded };
}

async function shareImageUrl(url, message) {
  if (Platform.OS !== 'web' && FileSystem && Sharing && (await Sharing.isAvailableAsync())) {
    const ext = (/\.(png|webp|jpe?g)(\?|$)/i.exec(url) || [])[1] || 'jpg';
    const dest = `${FileSystem.cacheDirectory}daily-bread-${Date.now()}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(url, dest);
    await Sharing.shareAsync(uri, { mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', dialogTitle: 'Daily Bread' });
    return;
  }
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], 'daily-bread.jpg', { type: blob.type || 'image/jpeg' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: message }); return; }
    } catch (e) { /* fall through to a text share */ }
  }
  await Share.share({ message: `${message}\n${url}` });
}

export function DailyVerseScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const { v } = useTodayVerse();
  const tr = state.translation || 'KJV';
  const { verses, loading } = useChapter(tr, v.bookId, v.chapter);
  const text = useMemo(() => {
    if (!verses) return '';
    const end = v.verseEnd && v.verseEnd > v.verse ? v.verseEnd : v.verse;
    return verses.slice(v.verse - 1, end).filter(Boolean).join(' ');
  }, [verses, v.bookId, v.chapter, v.verse, v.verseEnd]);
  const [imageOpen, setImageOpen] = useState(false);
  const [imgRatio, setImgRatio] = useState(1);
  const saved = (state.bookmarks || []).some((b) => b.bookId === v.bookId && b.chapter === v.chapter && (b.verse || null) === v.verse);
  const reflection = v.reflection || (v.scheduled ? '' : verseOfDay(new Date()).reflection);
  const playing = nar.active && nar.mode === 'verse' && nar.playing;

  const share = async () => {
    if (!v.imageUrl) { setImageOpen(true); return; }
    try { await shareImageUrl(v.imageUrl, `“${text}” — ${v.label} (${tr})`); } catch (e) { setImageOpen(true); }
  };
  const save = () => {
    dispatch({ type: 'bookmark', b: { bookId: v.bookId, chapter: v.chapter, verse: v.verse, folder: 'Daily Bread' } });
    toast.show(saved ? 'Removed from saved' : `Saved ${v.label}`, { icon: 'bookmark' });
  };

  return (
    <Screen back title="Daily Bread" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
      {v.imageUrl ? (
        <ScaleIn from={0.96} style={styles.imageCard}>
          <Image
            source={{ uri: v.imageUrl }}
            onLoad={(e) => { const s = e.nativeEvent && e.nativeEvent.source; if (s && s.width && s.height) setImgRatio(Math.max(0.6, Math.min(1.8, s.width / s.height))); }}
            style={[styles.image, { aspectRatio: imgRatio }]}
            resizeMode="cover"
            accessibilityLabel={`Image for ${v.label}`}
          />
        </ScaleIn>
      ) : null}

      <FadeInUp index={1} style={styles.verseCard}>
        <NightGlow />
        <View style={styles.pill}>
          <Icon name="book" size={12} color={colors.goldLight} />
          <Text style={styles.pillText}>Verse of the day</Text>
        </View>
        {loading && !text ? <Shimmer style={{ height: 70, borderRadius: 12, marginTop: 16, opacity: 0.3 }} /> : <Text style={styles.verseText}>“{text}”</Text>}
        <Text style={styles.verseRef}>{v.label} · {tr}</Text>
      </FadeInUp>

      <FadeInUp index={2} style={styles.actions}>
        <Action icon="headphones" label={playing ? 'Playing' : 'Listen'} onPress={() => nar.playVerse(v.bookId, v.chapter, v.verse, { translation: tr })} />
        <Action icon="share" label="Share" onPress={share} />
        <Pop trigger={saved}><Action icon="bookmark" label={saved ? 'Saved' : 'Save'} active={saved} onPress={save} /></Pop>
        <Action icon="book" label="Chapter" onPress={() => nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verse })} />
      </FadeInUp>

      {reflection ? (
        <FadeInUp index={3} style={styles.reflectCard}>
          <Text style={styles.eyebrow}>Reflection{v.theme ? ` · ${v.theme}` : ''}</Text>
          <Text style={styles.reflectText}>{reflection}</Text>
        </FadeInUp>
      ) : null}

      <FadeInUp index={4}>
        <Pressable onPress={() => setImageOpen(true)} style={({ pressed }) => [styles.makeImage, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Icon name="image" size={17} color={colors.primary} />
          <Text style={styles.makeImageText}>Make your own verse image</Text>
          <Icon name="chevron-right" size={14} color={colors.faint} />
        </Pressable>
      </FadeInUp>

      <VerseImageSheet visible={imageOpen} onClose={() => setImageOpen(false)} text={text} reference={v.label} translation={tr} />
    </Screen>
  );
}

function Action({ icon, label, onPress, active }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, active && styles.actionOn, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={18} color={active ? colors.gold : colors.primary} fill={active ? 'solid' : 'none'} />
      <Text style={[styles.actionText, active && { color: colors.gold }]}>{label}</Text>
    </Pressable>
  );
}

// ---------- blessing videos ----------
export function BlessingVideosScreen({ params = {} }) {
  const nav = useNav();
  const { data, loaded, error, reload, online } = useBlessingVideos();
  const items = useMemo(() => ((data && data.items) || []).map((x) => ({
    id: x.id, videoUrl: x.videoUrl, poster: x.poster, category: 'Blessing', durationSec: x.durationSec || 0, raw: x,
  })), [data]);
  const start = Math.max(0, items.findIndex((x) => x.id === params.id));
  const [index, setIndex] = useState(start);
  if (items.length) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <VideoViewer
          visible
          items={items}
          index={index}
          onIndexChange={setIndex}
          onClose={() => nav.pop()}
          testID="blessing-viewer"
          renderOverlay={(it, { chrome }) => (
            <View style={styles.vOverlay} pointerEvents="none">
              <View style={[styles.vInfo, { opacity: chrome === false ? 0.85 : 1 }]}>
                <Text style={styles.vEyebrow}>Blessing · {new Date(`${it.raw.publishOn}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
                <Text style={styles.vTitle} numberOfLines={2}>{it.raw.title}</Text>
                {it.raw.description ? <Text style={styles.vDesc} numberOfLines={3}>{it.raw.description}</Text> : null}
              </View>
            </View>
          )}
        />
      </View>
    );
  }
  return (
    <Screen back title="Videos" subtitle="Blessing videos">
      {!loaded ? (
        <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <View style={{ marginTop: 12 }}>
          <Empty
            title={online ? 'No blessing videos yet' : 'Sign in to watch'}
            body={online ? (error || 'A new blessing video will appear here soon.') : 'Blessing videos from the BibleNestra team appear here when you’re signed in.'}
            action={online && error ? 'Try again' : undefined}
            onAction={reload}
          />
        </View>
      )}
    </Screen>
  );
}

// ---------- See all: channel videos grouped by channel ----------
export function ChannelVideosScreen() {
  const nav = useNav();
  const { data, loaded, error, reload } = useLatestVideos();
  const groups = (data && data.groups) || [];
  return (
    <Screen back title="Watch" subtitle="From our channels">
      {!loaded && !groups.length ? (
        <View style={{ marginTop: 12 }}><Shimmer style={{ height: 160, borderRadius: 16 }} /><Shimmer style={{ height: 160, borderRadius: 16, marginTop: 12 }} /></View>
      ) : !groups.length ? (
        <View style={{ marginTop: 12 }}><Empty title="Channels coming soon" body={error || 'Sermons and worship from trusted ministries will appear here.'} action={error ? 'Try again' : undefined} onAction={reload} /></View>
      ) : groups.map((g, gi) => (
        <FadeInUp key={g.channel.id} index={Math.min(gi, 5)} style={{ marginTop: gi ? 24 : 10 }}>
          <Pressable onPress={() => nav.push('YouTubeChannel', { id: g.channel.id })} style={({ pressed }) => [styles.chHead, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Open ${g.channel.title}`}>
            <ChannelAvatar channel={g.channel} size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.chTitle} numberOfLines={1}>{g.channel.title}</Text>
              <Text style={styles.chMeta} numberOfLines={1}>{g.videos.length} recent video{g.videos.length === 1 ? '' : 's'}{g.channel.handle ? ` · @${g.channel.handle}` : ''}</Text>
            </View>
            <Icon name="chevron-right" size={15} color={colors.faint} />
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 }}>
            {g.videos.map((v) => <VideoCard key={v.videoId} v={{ ...v, channel: g.channel }} width={196} onPress={() => playYouTube(nav, { ...v, channel: g.channel })} />)}
          </ScrollView>
        </FadeInUp>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  imageCard: { marginTop: 10, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.raised, ...shadow.md },
  image: { width: '100%', backgroundColor: colors.raised },
  verseCard: { marginTop: 14, borderRadius: radius.xl, padding: 20, overflow: 'hidden', ...shadow.lg },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(212,168,82,0.16)' },
  pillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', color: colors.goldLight },
  verseText: { fontFamily: fonts.serifItalic, fontSize: 21, lineHeight: 30, color: colors.nightFg, marginTop: 16 },
  verseRef: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.goldLight, marginTop: 14 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  action: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  actionOn: { backgroundColor: colors.cardGold, borderColor: alpha(colors.gold, 0.3) },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.fg },
  reflectCard: { marginTop: 16, padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.gold },
  reflectText: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 23, color: colors.passage, marginTop: 8 },
  makeImage: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 14, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  makeImageText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.primary },

  vOverlay: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 12 },
  vInfo: { maxWidth: 520 },
  vEyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.goldLight, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  vTitle: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: '#FFFFFF', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  vDesc: { fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.88)', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },

  chHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg },
  chMeta: { fontSize: 12, color: colors.muted, marginTop: 1 },
});
