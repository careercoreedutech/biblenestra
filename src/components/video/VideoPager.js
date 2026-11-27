// TikTok-style vertical video pager with ONE shared player.
//
// Why one player: the old reels list mounted a player per item (and the feed one per card / reel tile). On
// Android every prepared player takes a hardware decoder and the pool is small, so the clip the user tapped
// often got no decoder and stayed black / never started. Here only the current page has a VideoView and a
// player; neighbours show a still frame (VideoPoster) until they become current.
//
// Swipe up / down (or mouse wheel, ↑ / ↓ keys on web) for next / previous, tap to pause / resume (controls
// appear), double-tap calls onDoubleTap (like). Ads: a pre-roll before playback and mid-rolls at the
// plan's times, through the shared useAdBreaks() interface (src/ads/AdBreaks.js) — never decided here.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAdBreaks } from '../../ads/AdBreaks';
import { Icon } from '../Icons';
import VideoPoster from './VideoPoster';
import VideoControls from './VideoControls';
import { IS_WEB, LONG_VIDEO_SEC, VIDEO_FILL, posterSize } from './videoUtils';

const ND = Platform.OS !== 'web';
const WHITE = '#FFFFFF';
const AD_TIMEOUT_MS = 90000; // run() never blocks for long, but never trust that blindly
const MID_NOTICE_SEC = 3;

// Per app session: videos that already had their pre-roll (no second ad when the viewer re-opens or the
// user swipes back within PREROLL_TTL_MS) and where each video was left (resume after a sheet / re-open).
const PREROLL_TTL_MS = 10 * 60 * 1000;
const preRolledAt = new Map(); // id → ms
const lastPos = new Map(); // id → { t, at }
// FEED VIDEO: the inline feed player records where it got to, so "expand" continues from there in full screen
export function rememberVideoPosition(id, t) { if (id && t > 1) lastPos.set(id, { t, at: Date.now() }); }
const RESUME_TTL_MS = 5 * 60 * 1000;

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ shown: false, timeout: true }), ms))]);

function HeartPop({ onDone }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(a, { toValue: 1, useNativeDriver: ND, speed: 18, bounciness: 12 }),
      Animated.timing(a, { toValue: 2, duration: 380, delay: 220, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
    ]).start(() => onDone && onDone());
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.heart, {
        opacity: a.interpolate({ inputRange: [0, 0.4, 1, 2], outputRange: [0, 1, 1, 0] }),
        transform: [{ scale: a.interpolate({ inputRange: [0, 1, 2], outputRange: [0.4, 1, 1.35] }) }, { translateY: a.interpolate({ inputRange: [0, 1, 2], outputRange: [10, 0, -40] }) }],
      }]}
    >
      <Icon name="heart" size={96} color="#FF3D6E" fill="#FF3D6E" />
    </Animated.View>
  );
}

export default function VideoPager({
  items = [],
  index = 0,
  onIndexChange,
  width,
  height,
  active = true, // false while the screen / tab is hidden → pause, no ads
  paused = false, // true while a sheet (comments, gifts) is over the player
  renderOverlay, // (item, { current, playing, chrome }) → creator info, side actions…
  onDoubleTap, // (item) → like
  onChromeChange, // (visible) → parent can show / hide its header with the controls
  onClose, // Escape key on web
  topInset = 0,
  bottomInset = 0,
  keyboard = false, // web: arrow keys / space / m / Escape
  testID,
}) {
  const breaks = useAdBreaks();
  const count = items.length;
  const clamp = (i) => Math.max(0, Math.min(count - 1, i || 0));
  const [cur, setCur] = useState(clamp(index));
  const item = items[clamp(cur)] || null;
  const url = item && item.videoUrl ? item.videoUrl : null;

  const [phase, setPhase] = useState('ready'); // 'ad' (pre-roll running) | 'ready'
  const [userPaused, setUserPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [status, setStatus] = useState('loading');
  const [muted, setMuted] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [breakNotice, setBreakNotice] = useState(null); // 3,2,1 | 'ad' | null
  const [hearts, setHearts] = useState([]);
  const [dims, setDims] = useState({}); // id → { width, height }

  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const player = useVideoPlayer(url, (p) => {
    p.loop = false; // short clips loop via playToEnd (long ones stop at the end)
    p.muted = mutedRef.current;
    try { p.timeUpdateEventInterval = 0.25; } catch (e) { /* older native */ }
  });
  const viewRef = useRef(null);
  const wrapRef = useRef(null);
  const [wrapNode, setWrapNode] = useState(null); // web: the DOM node (inside a Modal it mounts late)
  const setWrap = useCallback((n) => { wrapRef.current = n; setWrapNode(n || null); }, []);

  // ---- index sync (parent may jump us, e.g. "open at this video") ----
  const curRef = useRef(cur);
  curRef.current = cur;
  useEffect(() => {
    const next = clamp(index);
    if (next !== curRef.current) setCur(next);
  }, [index, count]);
  const drag = useRef(new Animated.Value(0)).current;
  const resetDrag = useRef(false);
  useLayoutEffect(() => {
    if (resetDrag.current) { resetDrag.current = false; drag.setValue(0); }
  }, [cur]);
  const animating = useRef(false);
  const go = useCallback((dir) => {
    const next = curRef.current + dir;
    if (animating.current || next < 0 || next >= count) {
      Animated.spring(drag, { toValue: 0, useNativeDriver: ND, speed: 20, bounciness: 4 }).start();
      return;
    }
    animating.current = true;
    Animated.timing(drag, { toValue: -dir * height, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start(() => {
      animating.current = false;
      resetDrag.current = true;
      setCur(next);
      if (onIndexChange) onIndexChange(next);
    });
  }, [count, height, onIndexChange]);

  // ---- per-video viewing state + pre-roll ----
  const planRef = useRef({ enabled: false, midRollsAt: [] });
  const planDur = useRef(0);
  const midDone = useRef(new Set());
  const lastT = useRef(0);
  const breakBusy = useRef(false);
  const resumed = useRef(false);
  const runAd = useCallback((placement, it) => withTimeout(
    Promise.resolve(breaks.run({ kind: 'video', placement, contentId: it.id, category: it.category })).catch(() => ({ shown: false })),
    AD_TIMEOUT_MS,
  ), [breaks]);

  useEffect(() => {
    setPos(0); setBuffered(0); setUserPaused(false); setStatus('loading'); setBreakNotice(null); setChrome(true);
    setDur(item && item.durationSec ? item.durationSec : 0);
    midDone.current = new Set();
    lastT.current = 0;
    resumed.current = false;
    breakBusy.current = false;
    if (!item) return;
    planRef.current = breaks.planFor({ kind: 'video', category: item.category, durationSec: item.durationSec || 0 }) || { enabled: false, midRollsAt: [] };
    planDur.current = item.durationSec || 0;
    // orientation from the poster frame (same aspect ratio as the video)
    if (item.poster && !dims[item.id]) posterSize(item.poster).then((s) => { if (s) setDims((d) => ({ ...d, [item.id]: s })); });
  }, [item && item.id]);

  useEffect(() => {
    if (!item || !active) return undefined;
    const plan = planRef.current;
    const last = preRolledAt.get(item.id);
    if (!(plan && plan.enabled && plan.preRoll) || (last && Date.now() - last < PREROLL_TTL_MS)) { setPhase('ready'); return undefined; }
    preRolledAt.set(item.id, Date.now());
    let alive = true;
    setPhase('ad');
    runAd('pre', item).then(() => { if (alive) setPhase('ready'); });
    return () => { alive = false; setPhase('ready'); };
  }, [item && item.id, active]);

  // ---- play / pause ----
  const [breakOn, setBreakOn] = useState(false);
  const shouldPlay = !!url && active && !paused && phase === 'ready' && !userPaused && !breakOn && !scrubbing;
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;
  useEffect(() => {
    if (!player) return undefined;
    if (!shouldPlay) { try { player.pause(); } catch (e) { /* released */ } return undefined; }
    let tries = 0;
    let t = null;
    const attempt = () => {
      if (!shouldPlayRef.current) return;
      try { player.play(); } catch (e) { /* released */ }
      t = setTimeout(() => {
        if (!shouldPlayRef.current) return;
        let isPlaying = false;
        try { isPlaying = player.playing; } catch (e) { return; }
        if (isPlaying) return;
        tries += 1;
        // web: the browser refused autoplay with sound → start muted (the user can unmute)
        if (IS_WEB && tries === 2 && !mutedRef.current) { try { player.muted = true; } catch (e) { /* ignore */ } setMuted(true); }
        if (tries < 6) attempt();
      }, 450);
    };
    attempt();
    return () => clearTimeout(t);
  }, [player, shouldPlay]);

  useEffect(() => { try { if (player) player.muted = muted; } catch (e) { /* ignore */ } }, [player, muted]);

  // ---- mid-roll breaks ----
  const startBreak = useCallback(async (it) => {
    if (breakBusy.current) return;
    breakBusy.current = true;
    setBreakOn(true);
    const notice = Math.max(1, Math.round(Number(planRef.current && planRef.current.noticeSec) || MID_NOTICE_SEC));
    for (let s = notice; s > 0; s -= 1) {
      setBreakNotice(s);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
    }
    setBreakNotice('ad');
    await runAd('mid', it);
    setBreakNotice(null);
    breakBusy.current = false;
    setBreakOn(false);
  }, [runAd]);

  const checkMidRolls = useCallback((t) => {
    const prev = lastT.current;
    lastT.current = t;
    const plan = planRef.current;
    if (!plan || !plan.enabled || breakBusy.current) return;
    const mids = (plan.midRollsAt || []).slice().sort((a, b) => a - b);
    const jumped = t - prev > 2.5 || t < prev - 0.5; // a seek, not playback
    for (let i = 0; i < mids.length; i += 1) {
      const m = mids[i];
      if (!midDone.current.has(m) && t >= m) {
        midDone.current.add(m); // once per viewing; seeking past it skips it
        if (!jumped && prev < m && prev > 0) { startBreak(itemRef.current); return; }
      }
    }
  }, [startBreak]);
  const itemRef = useRef(item);
  itemRef.current = item;

  // ---- player events ----
  useEffect(() => {
    if (!player) return undefined;
    const subs = [];
    const on = (name, fn) => { try { subs.push(player.addListener(name, fn)); } catch (e) { /* ignore */ } };
    const readDur = () => {
      let d = 0;
      try { d = player.duration; } catch (e) { d = 0; }
      if (d > 0 && Number.isFinite(d)) {
        setDur(d);
        // the post didn't know its length → plan mid-rolls with the real one
        if (!planDur.current && itemRef.current) {
          planDur.current = d;
          const p = breaks.planFor({ kind: 'video', category: itemRef.current.category, durationSec: d });
          if (p) planRef.current = { ...planRef.current, midRollsAt: p.midRollsAt || [] };
        }
      }
      if (IS_WEB) readWebDims();
    };
    on('timeUpdate', (e) => {
      const t = e && Number.isFinite(e.currentTime) ? e.currentTime : 0;
      setPos(t);
      if (itemRef.current && t > 1) lastPos.set(itemRef.current.id, { t, at: Date.now() });
      if (e && e.bufferedPosition > 0) setBuffered(e.bufferedPosition);
      if (!dur) readDur();
      checkMidRolls(t);
    });
    on('playingChange', (e) => setPlaying(!!(e && e.isPlaying)));
    on('statusChange', (e) => {
      const s = e && e.status;
      if (s) setStatus(s);
      if (s === 'readyToPlay') {
        readDur();
        // pick up where this video was left a moment ago
        const it = itemRef.current;
        const lp = it && lastPos.get(it.id);
        if (lp && Date.now() - lp.at < RESUME_TTL_MS && !resumed.current) {
          resumed.current = true;
          let d = 0;
          try { d = player.duration; } catch (err) { d = 0; }
          if (!d || lp.t < d - 2) {
            (planRef.current.midRollsAt || []).forEach((m) => { if (m <= lp.t) midDone.current.add(m); });
            lastT.current = lp.t;
            try { player.currentTime = lp.t; } catch (err) { /* ignore */ }
          }
        }
      }
    });
    on('playToEnd', () => {
      let d = 0;
      try { d = player.duration; } catch (e) { d = 0; }
      if ((d || 0) < LONG_VIDEO_SEC) {
        try { player.currentTime = 0; player.play(); } catch (e) { /* ignore */ }
      } else {
        setUserPaused(true);
        setChrome(true);
      }
    });
    return () => subs.forEach((s) => { try { s.remove(); } catch (e) { /* ignore */ } });
  }, [player]);

  // web: read the real size from the <video> element (no poster / landscape detection)
  const readWebDims = () => {
    try {
      const node = wrapRef.current;
      const v = node && node.querySelector ? node.querySelector('video[data-vp-main]') || node.querySelector('video') : null;
      const it = itemRef.current;
      if (v && v.videoWidth && it && !dims[it.id]) setDims((d) => (d[it.id] ? d : { ...d, [it.id]: { width: v.videoWidth, height: v.videoHeight } }));
    } catch (e) { /* ignore */ }
  };

  // ---- controls visibility ----
  const hideTimer = useRef(null);
  useEffect(() => {
    clearTimeout(hideTimer.current);
    if (chrome && playing && !scrubbing) hideTimer.current = setTimeout(() => setChrome(false), 3000);
    return () => clearTimeout(hideTimer.current);
  }, [chrome, playing, scrubbing]);
  useEffect(() => { if (!playing && phase === 'ready' && status !== 'loading') setChrome(true); }, [playing]);
  useEffect(() => { if (onChromeChange) onChromeChange(chrome); }, [chrome]);

  // ---- actions ----
  const togglePlay = useCallback(() => {
    if (phase !== 'ready' || breakBusy.current) return;
    setUserPaused((p) => {
      if (p) {
        // replay from the start when a long video had ended
        try { if (player && player.duration && player.currentTime >= player.duration - 0.3) player.currentTime = 0; } catch (e) { /* ignore */ }
      }
      return !p;
    });
    setChrome(true);
  }, [phase, player]);
  const toggleMute = useCallback(() => { setMuted((m) => !m); setChrome(true); }, []);
  const seek = useCallback((sec) => {
    if (!player) return;
    const d = dur || 0;
    const to = Math.max(0, Math.min(d > 0 ? d - 0.1 : sec, sec));
    // breaks the user jumped over are skipped
    (planRef.current.midRollsAt || []).forEach((m) => { if (m <= to) midDone.current.add(m); });
    lastT.current = to;
    try { player.currentTime = to; } catch (e) { /* ignore */ }
    setPos(to);
    setChrome(true);
  }, [player, dur]);
  const fullscreen = useCallback(() => {
    try { if (viewRef.current && viewRef.current.enterFullscreen) viewRef.current.enterFullscreen(); } catch (e) { /* ignore */ }
  }, []);

  // single tap → play / pause; double tap → like
  const lastTap = useRef(0);
  const tapTimer = useRef(null);
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      setHearts((h) => [...h.slice(-2), now]);
      if (onDoubleTap && item) onDoubleTap(item);
      return;
    }
    lastTap.current = now;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(togglePlay, 260);
  };

  // ---- swipe ----
  const geo = useRef({ height, count });
  geo.current = { height, count };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (e, g) => geo.current.count > 1 && Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
    onPanResponderMove: (e, g) => {
      if (animating.current) return;
      const atEdge = (curRef.current === 0 && g.dy > 0) || (curRef.current === geo.current.count - 1 && g.dy < 0);
      drag.setValue(atEdge ? g.dy * 0.25 : g.dy);
    },
    onPanResponderRelease: (e, g) => {
      const h = geo.current.height || 1;
      if (g.dy < -h * 0.18 || g.vy < -0.6) goRef.current(1);
      else if (g.dy > h * 0.18 || g.vy > 0.6) goRef.current(-1);
      else Animated.spring(drag, { toValue: 0, useNativeDriver: ND, speed: 20, bounciness: 4 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: ND }).start(),
  }), []);
  const goRef = useRef(go);
  goRef.current = go;

  // web: mouse wheel / trackpad and keyboard
  useEffect(() => {
    const node = wrapNode;
    if (!IS_WEB || !node || !node.addEventListener) return undefined;
    let lock = 0;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) < 24 || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const now = Date.now();
      if (now < lock) return;
      lock = now + 650;
      goRef.current(e.deltaY > 0 ? 1 : -1);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [wrapNode]);
  const keyActs = useRef({});
  keyActs.current = { togglePlay, toggleMute, seek, pos, onClose };
  useEffect(() => {
    if (!IS_WEB || !keyboard || !active || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA/.test(tag) || (e.target && e.target.isContentEditable)) return;
      const k = keyActs.current;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goRef.current(1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goRef.current(-1); }
      else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); k.togglePlay(); }
      else if (e.key === 'm') k.toggleMute();
      else if (e.key === 'ArrowRight') k.seek(k.pos + 5);
      else if (e.key === 'ArrowLeft') k.seek(Math.max(0, k.pos - 5));
      else if (e.key === 'Escape' && k.onClose) k.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, active]);

  if (!count || !item) return <View style={{ width, height, backgroundColor: '#000' }} />;

  const isLong = (dur || item.durationSec || 0) >= LONG_VIDEO_SEC;
  const layoutFor = (it) => {
    const d = dims[it.id];
    const portraitScreen = height >= width;
    const landscape = d ? d.width > d.height * 1.05 : false;
    const tall = d ? d.height / d.width >= 1.4 : false;
    // portrait clips fill a phone (cover); landscape / unknown never get cropped (contain, letterbox)
    const fit = tall && portraitScreen ? 'cover' : 'contain';
    // desktop: portrait clips in a centred 9:16 column, landscape ones use the full width
    const colW = landscape ? width : Math.min(width, Math.round(height * 0.5625) + (width > 700 ? 120 : 0));
    return { fit, colW, landscape };
  };
  const controlsH = (chrome ? 64 : 10) + bottomInset; // controls stay hidden until the video is tapped
  const renderPage = (i) => {
    const it = items[i];
    if (!it) return null;
    const current = i === cur;
    const { fit, colW, landscape } = layoutFor(it);
    return (
      <View key={it.id} style={[styles.page, { top: (i - cur) * height, width, height }]} testID={current ? 'video-page-current' : undefined}>
        <View style={[styles.col, { width: colW }]}>
          <VideoPoster videoUrl={it.videoUrl} poster={it.poster} fit={fit} />
          {current && url ? (
            <VideoView
              ref={viewRef}
              key={`v_${it.id}`}
              style={VIDEO_FILL}
              player={player}
              contentFit={fit}
              nativeControls={false}
              allowsFullscreen
              allowsPictureInPicture={false}
            />
          ) : null}
          <Pressable style={StyleSheet.absoluteFill} onPress={current ? onTap : undefined} accessibilityRole="button" accessibilityLabel={current ? (playing ? 'Pause video' : 'Play video') : undefined} testID={current ? 'video-tap' : undefined} />
          {current && (status === 'loading' || (status === 'idle' && !playing)) && phase === 'ready' && !breakOn ? (
            <View style={styles.center} pointerEvents="none"><ActivityIndicator color={WHITE} size="large" /></View>
          ) : null}
          {current && status === 'error' ? (
            <View style={styles.center}>
              <Text style={styles.errText}>This video couldn’t play</Text>
              <Pressable onPress={() => { try { player.replace(url); player.play(); } catch (e) { /* ignore */ } setStatus('loading'); }} style={styles.retry} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {current && userPaused && phase === 'ready' && !breakOn && status !== 'error' ? (
            <View style={styles.center} pointerEvents="none">
              <View style={styles.bigPlay}><Icon name="play" size={34} color={WHITE} fill={WHITE} /></View>
            </View>
          ) : null}
          {current ? hearts.map((h) => <HeartPop key={h} onDone={() => setHearts((list) => list.filter((x) => x !== h))} />) : null}
          {renderOverlay ? (
            <View style={[styles.overlay, { top: topInset, bottom: current ? controlsH : 10 + bottomInset }]} pointerEvents="box-none">
              {renderOverlay(it, { current, playing: current && playing, chrome: current && chrome, landscape })}
            </View>
          ) : null}
          {current && phase === 'ad' ? (
            <View style={styles.adCover} testID="video-ad-loading">
              <View style={styles.adPill}><Text style={styles.adPillText}>Ad</Text></View>
              <ActivityIndicator color={WHITE} style={{ marginTop: 14 }} />
              <Text style={styles.adText}>Your video starts right after this ad</Text>
            </View>
          ) : null}
          {current && breakNotice != null ? (
            <View style={styles.breakWrap} pointerEvents="none" testID="video-ad-break">
              <View style={styles.breakCard}>
                <View style={styles.adPill}><Text style={styles.adPillText}>Ad break</Text></View>
                <Text style={styles.breakText}>{breakNotice === 'ad' ? 'Playing a short ad…' : `Ad in ${breakNotice}…`}</Text>
              </View>
            </View>
          ) : null}
          {current && url ? (
            <View style={[styles.controls, { paddingBottom: bottomInset }]} pointerEvents="box-none">
              <VideoControls
                visible={chrome}
                long={isLong}
                playing={playing}
                muted={muted}
                position={pos}
                duration={dur}
                buffered={buffered}
                onTogglePlay={togglePlay}
                onToggleMute={toggleMute}
                onSeek={seek}
                onScrubStart={() => setScrubbing(true)}
                onScrubEnd={() => setScrubbing(false)}
                onFullscreen={landscape || isLong ? fullscreen : null}
              />
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View ref={setWrap} style={[styles.wrap, { width, height }]} testID={testID} {...pan.panHandlers}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: drag }] }]}>
        {renderPage(cur - 1)}
        {renderPage(cur)}
        {renderPage(cur + 1)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#000', overflow: 'hidden' },
  page: { position: 'absolute', left: 0, backgroundColor: '#000', alignItems: 'center' },
  col: { flex: 1, height: '100%', backgroundColor: '#000', overflow: 'hidden' },
  overlay: { position: 'absolute', left: 0, right: 0 },
  // solid black strip behind the progress line / controls, so the bottom edge is clean on any video
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: '#000' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bigPlay: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  heart: { position: 'absolute', alignSelf: 'center', top: '38%' },
  errText: { color: WHITE, fontSize: 15, fontWeight: '700' },
  retry: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)' },
  retryText: { color: WHITE, fontWeight: '800' },
  adCover: { ...StyleSheet.absoluteFillObject, zIndex: 30, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center' },
  adPill: { backgroundColor: '#F5C451', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  adPillText: { color: '#2A1B12', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  adText: { color: 'rgba(255,255,255,0.8)', marginTop: 10, fontSize: 13 },
  breakWrap: { position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center', zIndex: 25 },
  breakCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22 },
  breakText: { color: WHITE, fontWeight: '700', fontSize: 14 },
});
