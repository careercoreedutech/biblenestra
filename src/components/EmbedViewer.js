// Full-screen viewer for video links shared in posts and messages (item 6).
//   parseVideoLink(url)   → { provider, label, embedUrl, youtubeId?, channelId?, vertical? } | null
//   openLink(url, nav)    → YouTube → the in-app Watch screen (big player + Bible Nestra comments),
//                           Vimeo / Facebook / Dailymotion / TikTok / Instagram / Loom / Streamable → EmbedViewer route,
//                           anything else → the browser
//   <LinkText text style linkStyle />  text with tappable links that use openLink
//   EmbedViewerScreen     route 'EmbedViewer' (params: { url }) — the provider's official embed, full screen
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Icon } from './Icons';
import EmbedFrame from './EmbedFrame';
import { useNav } from '../navigation';
import { colors, fonts } from '../theme';

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const UC_ID = /^UC[A-Za-z0-9_-]{22}$/;

function toUrl(raw) {
  const s = String(raw || '').trim().replace(/[).,!?]+$/, '');
  if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch (e) { return null; }
}

/** YouTube link → { videoId } | { channelId } (channel live page) | null */
export function parseYouTube(raw) {
  const u = toUrl(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m|music)\./i, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return YT_ID.test(parts[0] || '') ? { videoId: parts[0] } : null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const v = u.searchParams.get('v');
  if (parts[0] === 'watch' && YT_ID.test(v || '')) return { videoId: v };
  if (['shorts', 'live', 'embed', 'v'].includes(parts[0]) && YT_ID.test(parts[1] || '')) return { videoId: parts[1], short: parts[0] === 'shorts' };
  if (parts[0] === 'embed' && parts[1] === 'live_stream' && UC_ID.test(u.searchParams.get('channel') || '')) return { channelId: u.searchParams.get('channel') };
  if (parts[0] === 'channel' && UC_ID.test(parts[1] || '') && parts[2] === 'live') return { channelId: parts[1] };
  return null;
}

export function parseVideoLink(raw) {
  const u = toUrl(raw);
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const url = u.toString();
  const yt = parseYouTube(url);
  if (yt) return { provider: 'youtube', label: 'YouTube', url, youtubeId: yt.videoId || null, channelId: yt.channelId || null };
  const host = u.hostname.replace(/^(www|m|web|mobile)\./i, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let m;
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parts.find((p) => /^\d{5,12}$/.test(p));
    if (id) return { provider: 'vimeo', label: 'Vimeo', url, embedUrl: `https://player.vimeo.com/video/${id}?playsinline=1` };
  }
  if (host === 'facebook.com' || host === 'fb.watch') {
    if (host === 'fb.watch' || /\/videos?\//.test(u.pathname) || parts[0] === 'watch' || parts[0] === 'reel' || /\/live/.test(u.pathname)) {
      return { provider: 'facebook', label: 'Facebook', url, embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=false` };
    }
  }
  if ((host === 'dailymotion.com' && parts[0] === 'video' && parts[1]) || host === 'dai.ly') {
    const id = host === 'dai.ly' ? parts[0] : parts[1];
    if (id) return { provider: 'dailymotion', label: 'Dailymotion', url, embedUrl: `https://www.dailymotion.com/embed/video/${encodeURIComponent(id.split('_')[0])}` };
  }
  if (host === 'tiktok.com' && (m = /\/video\/(\d{6,25})/.exec(u.pathname))) {
    return { provider: 'tiktok', label: 'TikTok', url, vertical: true, embedUrl: `https://www.tiktok.com/embed/v2/${m[1]}` };
  }
  if (host === 'instagram.com' && ['p', 'reel', 'reels', 'tv'].includes(parts[0]) && parts[1]) {
    return { provider: 'instagram', label: 'Instagram', url, vertical: true, embedUrl: `https://www.instagram.com/${parts[0] === 'reels' ? 'reel' : parts[0]}/${encodeURIComponent(parts[1])}/embed` };
  }
  if (host === 'loom.com' && parts[0] === 'share' && parts[1]) return { provider: 'loom', label: 'Loom', url, embedUrl: `https://www.loom.com/embed/${encodeURIComponent(parts[1])}` };
  if (host === 'streamable.com' && parts[0]) return { provider: 'streamable', label: 'Streamable', url, embedUrl: `https://streamable.com/e/${encodeURIComponent(parts[parts.length - 1])}` };
  if (host === 'rumble.com' && parts[0] === 'embed' && parts[1]) return { provider: 'rumble', label: 'Rumble', url, embedUrl: url };
  return null;
}

/** Open a link the best way: in-app Watch screen / full-screen embed / browser. */
export function openLink(raw, nav) {
  const info = parseVideoLink(raw);
  if (info && nav) {
    if (info.provider === 'youtube' && (info.youtubeId || info.channelId)) {
      nav.push('YouTubeWatch', info.youtubeId ? { videoId: info.youtubeId } : { channelId: info.channelId, live: true });
      return true;
    }
    if (info.embedUrl) { nav.push('EmbedViewer', { url: info.url }); return true; }
  }
  const u = toUrl(raw);
  if (u) Linking.openURL(u.toString()).catch(() => {});
  return false;
}

const LINK_RE = /(https?:\/\/[^\s]+|\b(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com|fb\.watch)\/[^\s]+)/gi;
/** Text with tappable links (video links open in-app). */
export function LinkText({ text, style, linkStyle, numberOfLines, onLongPress }) {
  const nav = useNav();
  const parts = String(text || '').split(LINK_RE);
  if (parts.length === 1) return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) => (i % 2 === 1 ? (
        <Text key={i} style={[styles.link, linkStyle]} accessibilityRole="link" onLongPress={onLongPress} onPress={() => openLink(p, nav)}>{p}</Text>
      ) : p))}
    </Text>
  );
}

/** Route 'EmbedViewer': params { url } */
export function EmbedViewerScreen({ params = {} }) {
  const nav = useNav();
  const info = parseVideoLink(params.url);
  const openOutside = () => Linking.openURL(info ? info.url : params.url).catch(() => {});
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.bar}>
        <Pressable onPress={() => nav.pop()} hitSlop={10} style={styles.barBtn} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="x" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.barTitle} numberOfLines={1}>{info ? info.label : 'Video'}</Text>
        <Pressable onPress={openOutside} hitSlop={10} style={styles.openBtn} accessibilityRole="link">
          <Text style={styles.openText}>Open in {info ? info.label : 'browser'}</Text>
          <Icon name="arrow-up-right" size={12} color={colors.goldLight} />
        </Pressable>
      </View>
      {info && info.embedUrl ? (
        <EmbedFrame key={info.embedUrl} embedUrl={info.embedUrl} vertical={!!info.vertical} onFail={openOutside} />
      ) : (
        <View style={styles.fallback}>
          <Icon name="video" size={28} color={colors.goldLight} />
          <Text style={styles.fallbackTitle}>This link can’t play inside Bible Nestra</Text>
          <Pressable onPress={openOutside} style={styles.fallbackBtn} accessibilityRole="link"><Text style={styles.fallbackBtnText}>Open in browser</Text></Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, textDecorationLine: 'underline' },
  root: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#000' },
  barBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  barTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  openText: { fontSize: 12.5, fontWeight: '700', color: colors.goldLight },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  fallbackTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: '#FFFFFF', textAlign: 'center' },
  fallbackBtn: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.goldLight },
  fallbackBtnText: { fontSize: 14, fontWeight: '700', color: colors.night },
});
