// FEED VIDEO (client #18 / #19 / #29): a video inside a mixed-feed card (TikTok / Facebook style).
//   • the most-visible card autoplays MUTED with a player lent by useFeedVideoPool (no player of its own);
//   • the poster shows instantly and stays on top until the first frame is actually playing;
//   • tap = pause / resume with a play / pause icon that fades in and out; double-tap = like (heart);
//   • thin progress bar, mute / unmute toggle (the choice is remembered in the store by the screen),
//     "Watch full screen" opens the full-screen vertical viewer (sound on) where this clip continues;
//   • a clip the device can't play shows why (e.g. HEVC on Android) and still offers full screen.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { VideoView } from 'expo-video';
import { Icon } from '../Icons';
import { colors, fonts } from '../../theme';
import VideoPoster from './VideoPoster';
import { SpeakerGlyph, FullscreenGlyph } from './VideoControls';
import { rememberVideoPosition } from './VideoPager';
import { VIDEO_FILL } from './videoUtils';

const ND = Platform.OS !== 'web';
const WHITE = '#FFFFFF';
const DOUBLE_TAP_MS = 260;

// Card height from the clip's real size when the server knows it (landscape 16:9 isn't cropped to a tall
// box any more); unknown size keeps the old portrait-ish box.
export function feedVideoHeight(width, item) {
  if (!width) return 400;
  const vw = Number(item && item.videoWidth) || 0;
  const vh = Number(item && item.videoHeight) || 0;
  if (vw > 0 && vh > 0) return Math.round(Math.min(width * Math.max(0.5625, Math.min(1.25, vh / vw)), 560));
  return Math.round(Math.min(width * 1.12, 520));
}

function Heart({ x, y, onDone }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(2.2)), useNativeDriver: ND }),
      Animated.timing(a, { toValue: 2, duration: 420, delay: 160, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
    ]).start(() => onDone && onDone());
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.heart, { left: x - 46, top: y - 46 }, {
        opacity: a.interpolate({ inputRange: [0, 0.3, 1, 2], outputRange: [0, 1, 1, 0] }),
        transform: [{ scale: a.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.25] }) }, { translateY: a.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, -60] }) }],
      }]}
    >
      <Icon name="heart" size={84} color="#FF3D6E" fill="#FF3D6E" />
    </Animated.View>
  );
}

export default function FeedVideo({
  item,
  active, // this card is the one that should play
  player, // pool player while active (null otherwise)
  paused, // the user paused it
  muted,
  onTogglePause,
  onToggleMute,
  onExpand,
  onDoubleTap,
}) {
  const [w, setW] = useState(0);
  const [progress, setProgress] = useState(0);
  const [started, setStarted] = useState(false); // first frame is showing → hide the poster
  const [status, setStatus] = useState('idle');
  const [hearts, setHearts] = useState([]);
  const [flash, setFlash] = useState(null); // 'play' | 'pause'
  const flashA = useRef(new Animated.Value(0)).current;
  const tapTimer = useRef(null);
  const lastTap = useRef(0);
  const live = !!(active && player && item.videoUrl);
  const h = feedVideoHeight(w, item);
  const poster = item.poster || (item.raw && item.raw.poster) || null;
  const hevc = item.codec === 'hevc' || (item.raw && item.raw.codec === 'hevc');

  // player events (only while this card holds the pool player)
  useEffect(() => {
    setStarted(false);
    setStatus(live ? 'loading' : 'idle');
    if (!live) return undefined;
    const subs = [];
    const on = (name, fn) => { try { subs.push(player.addListener(name, fn)); } catch (e) { /* ignore */ } };
    let shown = false;
    on('timeUpdate', (e) => {
      const t = e && Number.isFinite(e.currentTime) ? e.currentTime : 0;
      let d = 0;
      try { d = player.duration; } catch (err) { d = 0; }
      if (d > 0 && Number.isFinite(d)) setProgress(Math.max(0, Math.min(1, t / d)));
      if (t > 0.05 && !shown) { shown = true; setStarted(true); }
      rememberVideoPosition(item.id, t);
    });
    on('statusChange', (e) => {
      const s = e && e.status;
      if (s) setStatus(s);
    });
    on('playingChange', (e) => { if (e && e.isPlaying) setStatus((s) => (s === 'error' ? s : 'readyToPlay')); });
    try {
      if (player.status === 'readyToPlay') setStatus('readyToPlay');
      if (player.currentTime > 0.05) { shown = true; setStarted(true); }
    } catch (e) { /* ignore */ }
    return () => subs.forEach((s) => { try { s.remove(); } catch (e) { /* ignore */ } });
  }, [live, player, item.id]);
  useEffect(() => { if (!active) setProgress(0); }, [active]);
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const showFlash = (kind) => {
    setFlash(kind);
    flashA.stopAnimation();
    flashA.setValue(0);
    Animated.sequence([
      Animated.timing(flashA, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
      Animated.timing(flashA, { toValue: 0, duration: 520, delay: 380, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
    ]).start(({ finished }) => { if (finished) setFlash(null); }); // paused → the steady play icon takes over
  };

  const onPress = (e) => {
    const now = Date.now();
    const x = e && e.nativeEvent ? e.nativeEvent.locationX : w / 2;
    const y = e && e.nativeEvent ? e.nativeEvent.locationY : h / 2;
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      // double-tap → like (never toggles playback)
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      setHearts((l) => [...l, { id: now, x: Number.isFinite(x) ? x : w / 2, y: Number.isFinite(y) ? y : h / 2 }]);
      if (onDoubleTap) onDoubleTap();
      return;
    }
    lastTap.current = now;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      if (!live) { if (onExpand) onExpand(); return; } // not the playing card → open it full screen
      showFlash(paused ? 'play' : 'pause');
      if (onTogglePause) onTogglePause();
    }, DOUBLE_TAP_MS);
  };

  const error = live && status === 'error';
  const loading = live && !paused && !started && status !== 'error';

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} testID={`feed-video-${item.id}`}>
      <Pressable
        onPress={onPress}
        style={[styles.box, { height: h, backgroundColor: item.raw && item.raw.bg ? item.raw.bg : colors.night }]}
        accessibilityRole="button"
        accessibilityLabel={live ? (paused ? `Play video: ${item.text}` : `Pause video: ${item.text}`) : `Watch video: ${item.text}`}
        accessibilityState={{ selected: live && !paused }}
      >
        <View style={styles.backdrop} pointerEvents="none">
          <Icon name="video" size={26} color={colors.goldLight} />
          {item.scripture ? <Text style={styles.backdropRef}>{item.scripture}</Text> : null}
        </View>
        {live ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <VideoView style={VIDEO_FILL} player={player} allowsFullscreen={false} allowsPictureInPicture={false} nativeControls={false} contentFit="cover" />
          </View>
        ) : null}
        {/* poster on top until the first frame really plays — no black flash, instant first paint */}
        {!started ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <VideoPoster videoUrl={item.videoUrl} poster={poster} />
          </View>
        ) : null}
        <View style={styles.scrim} pointerEvents="none">
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={`fvg_${item.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
                <Stop offset="100%" stopColor="#000000" stopOpacity="0.62" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#fvg_${item.id})`} />
          </Svg>
        </View>

        <View style={styles.badge} pointerEvents="none">
          <View style={[styles.badgeDot, live && !paused && styles.badgeDotLive]} />
          <Text style={styles.badgeText}>{`VIDEO${item.duration ? ` · ${item.duration}` : ''}`}</Text>
        </View>

        {!live && !error ? (
          <View style={styles.playCircle} pointerEvents="none">
            <Icon name="play" size={24} color={WHITE} />
          </View>
        ) : null}
        {live && paused && !flash ? (
          <View style={styles.playCircle} pointerEvents="none" testID="feed-video-paused">
            <Icon name="play" size={24} color={WHITE} />
          </View>
        ) : null}
        {flash ? (
          <Animated.View pointerEvents="none" style={[styles.playCircle, { opacity: flashA, transform: [{ scale: flashA.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}>
            <Icon name={flash} size={24} color={WHITE} />
          </Animated.View>
        ) : null}
        {loading ? (
          <View style={styles.spinner} pointerEvents="none">
            <ActivityIndicator size="small" color={WHITE} />
          </View>
        ) : null}
        {error ? (
          <View style={styles.error} pointerEvents="none">
            <Text style={styles.errorTitle}>This video can’t play here</Text>
            <Text style={styles.errorSub}>{hevc && Platform.OS === 'android' ? 'It’s in HEVC (iPhone “High Efficiency”), which this phone can’t decode. Try full screen.' : 'Check your connection, or open it full screen.'}</Text>
          </View>
        ) : null}

        {hearts.map((ht) => (
          <Heart key={ht.id} x={ht.x} y={ht.y} onDone={() => setHearts((l) => l.filter((x) => x.id !== ht.id))} />
        ))}

        <View style={styles.foot} pointerEvents="box-none">
          <Pressable onPress={onExpand} hitSlop={10} style={styles.expand} accessibilityRole="button" accessibilityLabel="Watch full screen with sound" testID="feed-video-expand">
            <FullscreenGlyph size={14} />
            <Text style={styles.expandText}>Watch full screen</Text>
          </Pressable>
          <Pressable onPress={onToggleMute} hitSlop={10} style={styles.mute} accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'} accessibilityState={{ checked: !muted }} testID="feed-video-mute">
            <SpeakerGlyph muted={muted} size={18} />
          </Pressable>
        </View>

        {/* thin progress line */}
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${Math.round(progress * 1000) / 10}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.7 },
  backdropRef: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.goldLight },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  badge: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.6)' },
  badgeDotLive: { backgroundColor: '#FF4D4D' },
  badgeText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8, color: WHITE },
  playCircle: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -30, width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  spinner: { position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  error: { position: 'absolute', left: 24, right: 24, top: '50%', marginTop: -40, alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)' },
  errorTitle: { fontFamily: fonts.serifBold, fontSize: 16, color: WHITE, textAlign: 'center' },
  errorSub: { marginTop: 4, fontSize: 12.5, lineHeight: 17, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  heart: { position: 'absolute', width: 92, height: 92, alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  foot: { position: 'absolute', left: 12, right: 12, bottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' },
  expandText: { fontSize: 12, fontWeight: '700', color: colors.goldLight },
  mute: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  fill: { height: 3, backgroundColor: colors.goldLight },
});
