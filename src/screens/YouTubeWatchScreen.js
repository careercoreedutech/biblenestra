// YOUTUBE LIVE — route 'YouTubeWatch': a big YouTube player (full width, 16:9) with a Full screen button,
// then Bible Nestra's own comment thread for the video (auto-refreshes every few seconds while it's live).
// params: { videoId } | { channelId, live: true } (channel live page) · optional { title, channelTitle, muted }
// The player is the official YouTube IFrame embed with YouTube's own controls; nothing is drawn over it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Dimensions, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import YouTubePlayer from '../components/YouTubePlayer';
import { Icon } from '../components/Icons';
import { LiveRing } from '../components/Motion';
import { useToast } from '../components/Toast';
import { useNav, useIsFocused } from '../navigation';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { useVideoInfo } from '../api/youtube';
import { colors, fonts, radius, shadow } from '../theme';
import { isDarkScheme } from '../design/palette'; // APPEARANCE (item 14)

const LIVE_POLL_MS = 4000;
// dev-only on web: ?mute=1 keeps embeds silent while testing (same switch as src/audio/Player.js)
const DEV_MUTE = (() => { try { return Platform.OS === 'web' && typeof __DEV__ !== 'undefined' && __DEV__ && new URLSearchParams(window.location.search).get('mute') === '1'; } catch (e) { return false; } })();

export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function confirmAsk(title, message, ok, onYes) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onYes(); return; }
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: ok, style: 'destructive', onPress: onYes }]);
}

function Initials({ name, uri, size = 32 }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.raised }} />;
  const t = String(name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardIndigo, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '700', fontSize: size * 0.38, color: colors.primary }}>{t}</Text></View>;
}

/** Full screen: web uses the browser Fullscreen API (+ landscape lock where allowed); phones expand the player over the
 *  whole screen and turn it sideways when the phone is held upright. The player element is never remounted. */
function useFullscreen(boxRef) {
  const [on, setOn] = useState(false);
  const nativeFs = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const onChange = () => { if (!document.fullscreenElement && nativeFs.current) { nativeFs.current = false; setOn(false); } };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const enter = useCallback(async () => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const el = boxRef.current;
      if (el && el.requestFullscreen) {
        try {
          await el.requestFullscreen();
          nativeFs.current = true; setOn(true);
          try { if (window.screen && window.screen.orientation && window.screen.orientation.lock) await window.screen.orientation.lock('landscape'); } catch (e) { /* desktop browsers refuse — fine */ }
          return;
        } catch (e) { /* fall back to the in-page expansion */ }
      }
    }
    setOn(true);
  }, []);
  const exit = useCallback(async () => {
    if (nativeFs.current && typeof document !== 'undefined' && document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (e) { /* ignore */ }
    }
    nativeFs.current = false; setOn(false);
  }, []);
  return { on, enter, exit, browserFs: () => nativeFs.current };
}

export default function YouTubeWatchScreen({ params = {} }) {
  const nav = useNav();
  const focused = useIsFocused();
  const videoId = /^[A-Za-z0-9_-]{11}$/.test(params.videoId || '') ? params.videoId : null;
  const channelId = !videoId && /^UC[A-Za-z0-9_-]{22}$/.test(params.channelId || '') ? params.channelId : null;
  const info = useVideoInfo(videoId);
  const b = info && info.broadcast;
  const live = info ? !!info.live : !!params.live;
  const title = (b && b.title) || params.title || (channelId ? 'Live service' : 'YouTube video');
  const channelTitle = (b && b.channelTitle) || params.channelTitle || null;
  const embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : channelId ? `https://www.youtube.com/embed/live_stream?channel=${channelId}` : null;
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : channelId ? `https://www.youtube.com/channel/${channelId}/live` : 'https://www.youtube.com';

  const box = useRef(null);
  const [size, setSize] = useState(() => { const d = Dimensions.get('window'); return { w: d.width, h: d.height }; }); // window size until the first real layout (so full screen can open right away)
  const fs = useFullscreen(box);
  const expanded = fs.on && !fs.browserFs();
  const sideways = expanded && size.h > size.w && !params.vertical; // phone held upright → turn the video sideways (not Shorts: { vertical: true })
  // leaving the screen while expanded: drop out of full screen
  useEffect(() => { if (!focused && fs.on) fs.exit(); }, [focused]);
  // WATCH ON TODAY: { fullscreen: true } opens straight into the expanded player; closing it goes back
  const autoFs = !!params.fullscreen;
  useEffect(() => { if (autoFs && embedUrl) fs.enter(); }, []);
  const closeFs = () => { fs.exit(); if (autoFs) nav.pop(); };

  const playerBox = expanded
    ? (sideways
      ? { position: 'absolute', zIndex: 50, width: size.h, height: size.w, left: (size.w - size.h) / 2, top: (size.h - size.w) / 2, transform: [{ rotate: '90deg' }], backgroundColor: '#000' }
      : { position: 'absolute', zIndex: 50, left: 0, top: 0, width: size.w, height: size.h, backgroundColor: '#000' })
    : fs.on ? styles.playerFill
      // full width 16:9; on wide screens (desktop) capped at ~60% of the height so the comments stay visible
      : size.w && size.w * 9 / 16 > size.h * 0.6 ? [styles.player, { aspectRatio: undefined, height: Math.round(size.h * 0.6) }] : styles.player;

  return (
    <View style={styles.root} onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (w > 0 && h > 0) setSize({ w, h }); }}>
      <StatusBar style={expanded || isDarkScheme() ? 'light' : 'dark'} hidden={expanded} />
      <View style={styles.bar}>
        <Pressable onPress={() => nav.pop()} hitSlop={10} style={styles.barBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron-left" size={20} color={colors.fg} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.barTitle} numberOfLines={1}>{channelTitle || 'Watch'}</Text>
          {live ? <View style={styles.liveRow}><LiveRing color={colors.rose} size={5} /><Text style={styles.liveText}>Live now</Text></View> : null}
        </View>
      </View>

      {/* the player stays in the same place in the tree (never remounted) — only its box changes for full screen */}
      <View ref={box} style={playerBox}>
        {embedUrl && focused ? (
          <YouTubePlayer embedUrl={embedUrl} watchUrl={watchUrl} live={live || !!channelId} autoplay={Platform.OS !== 'web'} muted={!!params.muted || DEV_MUTE}
            style={styles.fill} />
        ) : <View style={[styles.fill, { backgroundColor: '#000' }]} />}
      </View>
      {expanded ? (
        <Pressable onPress={closeFs} style={[styles.exitFs, sideways && styles.exitFsSideways]} hitSlop={12} accessibilityRole="button" accessibilityLabel="Exit full screen">
          <Icon name="x" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <View style={styles.controls}>
        <Pressable onPress={fs.enter} style={styles.ctrlBtn} accessibilityRole="button" accessibilityLabel="Full screen">
          <Icon name="arrow-up-right" size={14} color={colors.primary} />
          <Text style={styles.ctrlText}>Full screen</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => Linking.openURL(watchUrl).catch(() => {})} style={styles.ctrlBtn} accessibilityRole="link">
          <Text style={styles.ctrlText}>Watch on YouTube</Text>
          <Icon name="arrow-up-right" size={12} color={colors.primary} />
        </Pressable>
      </View>

      <VideoComments videoId={videoId} live={live} focused={focused} header={(
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={3}>{title}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[channelTitle, live ? 'Streaming now on YouTube' : b && b.status === 'upcoming' && b.scheduledStart ? `Starts ${new Date(b.scheduledStart).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )} />
    </View>
  );
}

// ---------- Bible Nestra comments for a YouTube video ----------
function VideoComments({ videoId, live, focused, header }) {
  const api = useApi();
  const toast = useToast();
  const [sort, setSort] = useState('newest');
  const [data, setData] = useState(null); // { items, total, cursor, hasMore }
  const [extra, setExtra] = useState([]); // older pages loaded with "Show more"
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null); // comment
  const [sending, setSending] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!api.online || !videoId) return;
    try {
      const r = await api.request('GET', `/youtube/videos/${videoId}/comments?sort=${sort}`);
      if (alive.current) { setData(r); setError(null); }
    } catch (e) { if (alive.current) setError(errorMessage(e, 'Couldn’t load comments')); }
  }, [api.online, videoId, sort]);

  useEffect(() => { setData(null); setExtra([]); load(); }, [load]);
  // live chat feel: refresh every few seconds while the stream is live and this screen is in front
  useEffect(() => {
    if (!live || !focused || !api.online || !videoId) return undefined;
    let appActive = AppState.currentState !== 'background';
    const sub = AppState.addEventListener('change', (s) => { appActive = s === 'active'; });
    const t = setInterval(() => { if (appActive) load(); }, LIVE_POLL_MS);
    return () => { clearInterval(t); sub.remove(); };
  }, [live, focused, load]);

  const showMore = async () => {
    const cursor = extra.length ? extra[extra.length - 1].cursor : data && data.cursor;
    if (!cursor) return;
    setMoreBusy(true);
    try {
      const r = await api.request('GET', `/youtube/videos/${videoId}/comments?sort=${sort}&cursor=${encodeURIComponent(cursor)}`);
      setExtra((x) => [...x, { items: r.items, cursor: r.cursor, hasMore: r.hasMore }]);
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t load more'), { tone: 'error' }); }
    setMoreBusy(false);
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await api.request('POST', `/youtube/videos/${videoId}/comments`, { text: t, parentId: replyTo ? replyTo.id : undefined });
      setText(''); setReplyTo(null);
      if (sort !== 'newest' && !replyTo) setSort('newest'); else await load();
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t post your comment'), { tone: 'error' }); }
    setSending(false);
  };

  const patchAll = (fn) => {
    const apply = (list) => list.map((c) => fn({ ...c, replies: (c.replies || []).map(fn).filter(Boolean) })).filter(Boolean);
    setData((d) => (d ? { ...d, items: apply(d.items) } : d));
    setExtra((pages) => pages.map((p) => ({ ...p, items: apply(p.items) })));
  };
  const like = async (c) => {
    const liked = !c.likedByMe;
    patchAll((x) => (x.id === c.id ? { ...x, likedByMe: liked, likes: Math.max(0, x.likes + (liked ? 1 : -1)) } : x));
    try { await api.request('POST', `/youtube/comments/${c.id}/like`, { liked }); } catch (e) { load(); }
  };
  const remove = (c) => confirmAsk('Delete comment?', 'This removes your comment and its replies.', 'Delete', async () => {
    try { await api.request('DELETE', `/youtube/comments/${c.id}`); patchAll((x) => (x.id === c.id ? null : x)); toast.show('Comment deleted', { icon: 'trash' }); } catch (e) { toast.show(errorMessage(e, 'Couldn’t delete'), { tone: 'error' }); }
  });
  const report = (c) => confirmAsk('Report comment?', 'The Bible Nestra team will review it.', 'Report', async () => {
    try { await api.request('POST', `/youtube/comments/${c.id}/report`, { reason: 'Reported from the Watch screen' }); toast.show('Thanks — we’ll take a look', { icon: 'shield' }); } catch (e) { toast.show(errorMessage(e, 'Couldn’t report'), { tone: 'error' }); }
  });

  const seen = new Set();
  const all = [...((data && data.items) || []), ...extra.flatMap((p) => p.items)].filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
  const hasMore = extra.length ? extra[extra.length - 1].hasMore : !!(data && data.hasMore);

  const renderRow = (c, reply) => (
    <View style={[styles.comment, reply && styles.reply]}>
      <Initials name={c.author.displayName} uri={c.author.avatarUrl} size={reply ? 26 : 32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.cName} numberOfLines={1}>{c.author.displayName}{c.author.verified ? ' ✓' : ''} <Text style={styles.cTime}>· {ago(c.createdAt)}</Text></Text>
        <Text style={styles.cText}>{c.text}</Text>
        <View style={styles.cActions}>
          <Pressable onPress={() => like(c)} hitSlop={8} style={styles.cAct} accessibilityRole="button" accessibilityLabel={c.likedByMe ? 'Unlike' : 'Like'}>
            <Icon name="heart" size={13} color={c.likedByMe ? colors.rose : colors.faint} fill={c.likedByMe ? 'solid' : 'none'} />
            {c.likes ? <Text style={[styles.cActText, c.likedByMe && { color: colors.rose }]}>{c.likes}</Text> : null}
          </Pressable>
          <Pressable onPress={() => setReplyTo(reply ? { id: c.parentId, author: c.author } : c)} hitSlop={8} style={styles.cAct}><Text style={styles.cActText}>Reply</Text></Pressable>
          {c.mine ? <Pressable onPress={() => remove(c)} hitSlop={8} style={styles.cAct}><Text style={styles.cActText}>Delete</Text></Pressable>
            : <Pressable onPress={() => report(c)} hitSlop={8} style={styles.cAct}><Text style={styles.cActText}>Report</Text></Pressable>}
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {header}
        <View style={styles.cHead}>
          <Text style={styles.cHeadTitle}>{live ? 'Live chat' : 'Comments'}{data && data.total ? ` · ${data.total}` : ''}</Text>
          <View style={styles.sortRow}>
            {['newest', 'oldest'].map((s) => (
              <Pressable key={s} onPress={() => setSort(s)} style={[styles.sortBtn, sort === s && styles.sortOn]}><Text style={[styles.sortText, sort === s && styles.sortTextOn]}>{s === 'newest' ? 'Newest' : 'Oldest'}</Text></Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.cNote}>Bible Nestra comments — separate from YouTube’s comments{live ? ' · updates every few seconds' : ''}</Text>
        {!api.online ? (
          <Text style={styles.empty}>Sign in to read and join the conversation.</Text>
        ) : !videoId ? (
          <Text style={styles.empty}>Comments appear here once the service is matched to a video.</Text>
        ) : data == null && !error ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : error && !data ? (
          <Text style={styles.empty} onPress={load}>{error} · tap to retry</Text>
        ) : !all.length ? (
          <Text style={styles.empty}>{live ? 'Say hello and share what’s blessing you in this service.' : 'No comments yet — be the first.'}</Text>
        ) : all.map((c) => (
          <View key={c.id}>
            {renderRow(c, false)}
            {(c.replies || []).map((r) => <React.Fragment key={r.id}>{renderRow(r, true)}</React.Fragment>)}
          </View>
        ))}
        {hasMore ? (
          <Pressable onPress={showMore} style={styles.more} disabled={moreBusy}><Text style={styles.moreText}>{moreBusy ? 'Loading…' : 'Show more comments'}</Text></Pressable>
        ) : null}
      </ScrollView>
      {api.online && videoId ? (
        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replyBar}>
              <Text style={styles.replyText} numberOfLines={1}>Replying to {replyTo.author.displayName}</Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityLabel="Cancel reply"><Icon name="x" size={14} color={colors.muted} /></Pressable>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={live ? 'Chat with everyone watching…' : 'Add a comment…'}
              placeholderTextColor={colors.faint}
              style={styles.input}
              maxLength={1000}
              multiline
              onSubmitEditing={send}
              blurOnSubmit={Platform.OS === 'web'}
            />
            <Pressable onPress={send} disabled={!text.trim() || sending} style={[styles.send, (!text.trim() || sending) && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel="Send comment">
              {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Icon name="arrow-right" size={16} color="#FFFFFF" />}
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screen },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  barBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  barTitle: { fontSize: 15, fontWeight: '700', color: colors.fg },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  liveText: { fontSize: 11.5, fontWeight: '800', color: colors.rose, letterSpacing: 0.4, textTransform: 'uppercase' },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  playerFill: { position: 'absolute', zIndex: 50, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#000' },
  fill: { width: '100%', height: '100%', aspectRatio: undefined, flex: 1 },
  exitFs: { position: 'absolute', zIndex: 60, top: 14, right: 14, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  exitFsSideways: { top: undefined, bottom: 14 },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.rule },
  ctrlBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.primarySoft },
  ctrlText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  info: { paddingHorizontal: 16, paddingTop: 14 },
  title: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: colors.fg, letterSpacing: -0.3 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  cHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 20 },
  cHeadTitle: { fontSize: 15, fontWeight: '800', color: colors.fg },
  cNote: { fontSize: 11.5, color: colors.faint, paddingHorizontal: 16, marginTop: 3, marginBottom: 6 },
  sortRow: { flexDirection: 'row', gap: 6 },
  sortBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  sortOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  sortText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  sortTextOn: { color: colors.screen },
  empty: { fontSize: 13.5, color: colors.muted, textAlign: 'center', paddingHorizontal: 24, paddingVertical: 22 },
  comment: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 9 },
  reply: { paddingLeft: 58, paddingVertical: 6 },
  cName: { fontSize: 13, fontWeight: '700', color: colors.fg },
  cTime: { fontWeight: '500', color: colors.faint },
  cText: { fontSize: 14, lineHeight: 19.5, color: colors.fg, marginTop: 1 },
  cActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 5 },
  cAct: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cActText: { fontSize: 12, fontWeight: '700', color: colors.faint },
  more: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  moreText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  composer: { borderTopWidth: 1, borderTopColor: colors.rule, backgroundColor: colors.surface, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, ...shadow.sm },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, paddingHorizontal: 4 },
  replyText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.muted },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 110, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 14, color: colors.fg },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});

