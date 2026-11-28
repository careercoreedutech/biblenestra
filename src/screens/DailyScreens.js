import { isDarkScheme } from '../design/palette';
// TODAY'S JOURNEY screens
//   'DailyVerse'     Daily Bread: the verse of the day (scheduled by admins at /admin, with their image and
//                    reflection; otherwise the app's own verse of the day + the verse image maker), Listen,
//                    Share as image, Save, Read chapter. The verse text always comes from the Bible data.
//   'BlessingVideos' admin-uploaded blessing videos in the full-screen vertical player (swipe for the next one).
//   'ChannelVideos'  "See all" of Watch: From Our Channels — recent videos grouped by channel.
// Restyled in the Figma design: the verse-hero card (as in TodayScreen), kit cards and rows (src/design/study/parts.js).
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
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
import { colors, fonts } from '../theme';
import { d, df, Grad, Tap, gradients } from '../design/sanctuary';
import { SPage, SEmpty } from '../design/study/parts';

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
    <SPage back title="Daily Bread" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
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

      {/* .verse-hero */}
      <FadeInUp index={1}>
        <Grad colors={gradients.hero} locations={[0, 0.72, 1]} style={styles.hero}>
          <View style={styles.heroRing} />
          <View style={styles.heroTop}>
            <View style={styles.heroLabel}>
              <Icon name="sun" size={14} color="#FFD8BD" />
              <Text style={styles.heroLabelText}>Verse of the day</Text>
            </View>
            <Pop trigger={saved}>
              <Tap style={styles.heroSave} onPress={save} accessibilityLabel={saved ? 'Remove from saved' : 'Save verse'}>
                <Icon name={saved ? 'check' : 'bookmark'} size={18} color="#fff" />
              </Tap>
            </Pop>
          </View>
          <View style={styles.verseCopy}>
            {loading && !text ? <Shimmer style={{ height: 90, borderRadius: 12, opacity: 0.3 }} /> : <Text style={styles.verseText}>“{text}”</Text>}
            <Text style={styles.verseRef}>{v.label} · {tr}</Text>
          </View>
          <View style={styles.heroActions}>
            <Tap style={styles.heroBtn} onPress={() => nar.playVerse(v.bookId, v.chapter, v.verse, { translation: tr })} accessibilityLabel="Listen">
              <Icon name="headphones" size={16} color="#fff" />
              <Text style={styles.heroBtnText}>{playing ? 'Playing' : 'Listen'}</Text>
            </Tap>
            <Tap style={styles.heroBtn} onPress={() => nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verse })} accessibilityLabel="Read chapter">
              <Icon name="book" size={16} color="#fff" />
              <Text style={styles.heroBtnText}>Chapter</Text>
            </Tap>
            <Tap style={[styles.heroBtn, styles.heroShare]} onPress={share} accessibilityLabel="Share verse">
              <Icon name="share" size={16} color="#fff" />
            </Tap>
          </View>
        </Grad>
      </FadeInUp>

      {reflection ? (
        <FadeInUp index={3} style={styles.reflectCard}>
          <Text style={styles.eyebrow}>Reflection{v.theme ? ` · ${v.theme}` : ''}</Text>
          <Text style={styles.reflectText}>{reflection}</Text>
        </FadeInUp>
      ) : null}

      <FadeInUp index={4}>
        <Tap onPress={() => setImageOpen(true)} style={styles.makeImage} accessibilityLabel="Make your own verse image">
          <View style={styles.makeIcon}><Icon name="image" size={17} color={d.plum} /></View>
          <Text style={styles.makeImageText}>Make your own verse image</Text>
          <Icon name="chevron-right" size={15} color={isDarkScheme() ? '#8A7A6C' : '#AAA6AD'} />
        </Tap>
      </FadeInUp>

      <VerseImageSheet visible={imageOpen} onClose={() => setImageOpen(false)} text={text} reference={v.label} translation={tr} />
    </SPage>
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
    <SPage back title="Videos" subtitle="Blessing videos">
      {!loaded ? (
        <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={d.plum} /></View>
      ) : (
        <SEmpty
          title={online ? 'No blessing videos yet' : 'Sign in to watch'}
          body={online ? (error || 'A new blessing video will appear here soon.') : 'Blessing videos from the BibleNestra team appear here when you’re signed in.'}
          action={online && error ? 'Try again' : undefined}
          onAction={reload}
        />
      )}
    </SPage>
  );
}

// ---------- See all: channel videos grouped by channel ----------
export function ChannelVideosScreen() {
  const nav = useNav();
  const { data, loaded, error, reload } = useLatestVideos();
  const groups = (data && data.groups) || [];
  return (
    <SPage back title="Watch" subtitle="From our channels">
      {!loaded && !groups.length ? (
        <View style={{ marginTop: 12 }}><Shimmer style={{ height: 160, borderRadius: 16 }} /><Shimmer style={{ height: 160, borderRadius: 16, marginTop: 12 }} /></View>
      ) : !groups.length ? (
        <SEmpty title="Channels coming soon" body={error || 'Sermons and worship from trusted ministries will appear here.'} action={error ? 'Try again' : undefined} onAction={reload} />
      ) : groups.map((g, gi) => (
        <FadeInUp key={g.channel.id} index={Math.min(gi, 5)} style={{ marginTop: gi ? 22 : 12 }}>
          <Tap onPress={() => nav.push('YouTubeChannel', { id: g.channel.id })} style={styles.chHead} accessibilityLabel={`Open ${g.channel.title}`}>
            <ChannelAvatar channel={g.channel} size={36} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.chTitle} numberOfLines={1}>{g.channel.title}</Text>
              <Text style={styles.chMeta} numberOfLines={1}>{g.videos.length} recent video{g.videos.length === 1 ? '' : 's'}{g.channel.handle ? ` · @${g.channel.handle}` : ''}</Text>
            </View>
            <Icon name="chevron-right" size={15} color={d.muted} />
          </Tap>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 }}>
            {g.videos.map((v) => <VideoCard key={v.videoId} v={{ ...v, channel: g.channel }} width={196} onPress={() => playYouTube(nav, { ...v, channel: g.channel })} />)}
          </ScrollView>
        </FadeInUp>
      ))}
    </SPage>
  );
}

const styles = StyleSheet.create({
  imageCard: { marginTop: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  image: { width: '100%', backgroundColor: d.paper },

  // .verse-hero (as in TodayScreen)
  hero: { marginTop: 12, borderRadius: 28, padding: 20, overflow: 'hidden', shadowColor: '#372B7D', shadowOpacity: 0.25, shadowRadius: 22, shadowOffset: { width: 0, height: 22 }, elevation: 8 },
  heroRing: { position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 30, borderColor: 'rgba(255,255,255,0.06)', right: -70, top: -75 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroLabelText: { fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', fontFamily: df.sansBold, color: '#FFD8BD' },
  heroSave: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  verseCopy: { paddingTop: 30, paddingBottom: 26 },
  verseText: { fontFamily: df.display, fontSize: 26, lineHeight: 34, color: '#fff' },
  verseRef: { color: '#F7C9A8', fontSize: 11, marginTop: 14, fontFamily: df.sans },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroBtn: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 13, borderRadius: 12 },
  heroBtnText: { color: '#fff', fontSize: 11, fontFamily: df.sansBold },
  heroShare: { marginLeft: 'auto', paddingHorizontal: 0, width: 38, justifyContent: 'center' },

  reflectCard: { marginTop: 12, padding: 16, borderRadius: 20, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  eyebrow: { fontSize: 9, fontFamily: df.sansHeavy, letterSpacing: 1.3, textTransform: 'uppercase', color: d.plum },
  reflectText: { fontFamily: df.display, fontSize: 15, lineHeight: 23, color: d.ink, marginTop: 8 },
  makeImage: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  makeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: d.lavender },
  makeImageText: { flex: 1, fontSize: 13, fontFamily: df.sansBold, color: d.ink },

  vOverlay: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 12 },
  vInfo: { maxWidth: 520 },
  vEyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.goldLight, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  vTitle: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: '#FFFFFF', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  vDesc: { fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.88)', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },

  chHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  chTitle: { fontFamily: df.displayBold, fontSize: 17, color: d.ink },
  chMeta: { fontSize: 12, fontFamily: df.sans, color: d.muted, marginTop: 1 },
});
