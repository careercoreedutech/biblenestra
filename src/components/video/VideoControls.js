// Playback controls for the full-screen video player: a seek / progress bar (tap or drag anywhere on it),
// elapsed / total time, play-pause, mute and full screen. Short clips show only a thin progress line until
// the controls are revealed (tap or pause); long videos always show the scrubber with times.
import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../Icons';
import { fmtTime } from './videoUtils';

const WHITE = '#FFFFFF';

function SpeakerGlyph({ muted, size = 20 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" stroke={WHITE} strokeWidth={1.9} strokeLinejoin="round" fill={WHITE} fillOpacity={0.15} />
      {muted ? (
        <Path d="M16 9.5l5 5M21 9.5l-5 5" stroke={WHITE} strokeWidth={2} strokeLinecap="round" />
      ) : (
        <Path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" stroke={WHITE} strokeWidth={1.9} strokeLinecap="round" />
      )}
    </Svg>
  );
}

export function FullscreenGlyph({ size = 19 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" stroke={WHITE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Draggable seek bar. Calls onScrub(sec) while dragging (preview) and onSeek(sec) on release. */
export function SeekBar({ position, duration, buffered, onSeek, onScrubStart, onScrubEnd, thick, testID }) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState(null); // seconds while dragging
  const widthRef = useRef(0);
  const durRef = useRef(0);
  widthRef.current = width;
  durRef.current = duration;
  const cb = useRef({});
  cb.current = { onSeek, onScrubStart, onScrubEnd };
  const at = (x) => {
    let w = widthRef.current;
    if (!w) {
      // onLayout hasn't reported yet (web: hidden / just mounted) → read the box directly
      try {
        const n = barRef.current;
        if (n && n.getBoundingClientRect) w = n.getBoundingClientRect().width;
      } catch (e) { /* ignore */ }
    }
    if (!w) return 0;
    return Math.max(0, Math.min(1, x / w)) * (durRef.current || 0);
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => durRef.current > 0,
    onMoveShouldSetPanResponder: () => durRef.current > 0,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => {
      const ne = e.nativeEvent;
      if (Number.isFinite(ne.pageX) && Number.isFinite(ne.locationX)) pan.barX = ne.pageX - ne.locationX;
      if (cb.current.onScrubStart) cb.current.onScrubStart();
      setDrag(at(e.nativeEvent.locationX));
    },
    onPanResponderMove: (e, g) => {
      // locationX jumps around when the finger leaves the bar; use the gesture's x relative to the bar start
      const x = (g.x0 - (pan.barX || 0)) + g.dx;
      setDrag(at(Number.isFinite(x) && pan.barX != null ? x : e.nativeEvent.locationX));
    },
    onPanResponderRelease: (e, g) => {
      const x = (g.x0 - (pan.barX || 0)) + g.dx;
      const sec = at(Number.isFinite(x) && pan.barX != null ? x : e.nativeEvent.locationX);
      setDrag(null);
      if (cb.current.onSeek) cb.current.onSeek(sec);
      if (cb.current.onScrubEnd) cb.current.onScrubEnd();
    },
    onPanResponderTerminate: () => { setDrag(null); if (cb.current.onScrubEnd) cb.current.onScrubEnd(); },
  }), []);
  const barRef = useRef(null);
  const measure = () => {
    try {
      if (barRef.current && barRef.current.measureInWindow) barRef.current.measureInWindow((x) => { pan.barX = x; });
    } catch (e) { /* ignore */ }
  };
  const pos = drag != null ? drag : position;
  const pct = duration > 0 ? Math.max(0, Math.min(1, pos / duration)) : 0;
  const buf = duration > 0 && buffered > 0 ? Math.max(0, Math.min(1, buffered / duration)) : 0;
  const active = drag != null;
  return (
    <View
      ref={barRef}
      testID={testID}
      onLayout={(e) => { setWidth(e.nativeEvent.layout.width); measure(); }}
      style={styles.seekHit}
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      accessibilityValue={{ min: 0, max: Math.round(duration || 0), now: Math.round(pos || 0), text: `${fmtTime(pos)} of ${fmtTime(duration)}` }}
      {...pan.panHandlers}
    >
      <View style={[styles.track, (thick || active) && styles.trackThick]} pointerEvents="none">
        <View style={[styles.buffered, { width: `${buf * 100}%` }]} />
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      {thick || active ? <View pointerEvents="none" style={[styles.knob, active && styles.knobActive, { left: `${pct * 100}%` }]} /> : null}
      {active ? (
        <View pointerEvents="none" style={[styles.dragTip, { left: `${pct * 100}%` }]}>
          <Text style={styles.dragTipText}>{fmtTime(pos)}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function VideoControls({
  visible, long, playing, muted, position, duration, buffered,
  onTogglePlay, onToggleMute, onSeek, onScrubStart, onScrubEnd, onFullscreen,
}) {
  // Nothing is drawn until the viewer taps the video (or pauses): the bottom stays clear while watching.
  // Tapping shows the seek bar, time and buttons for a few seconds, for short and long videos alike.
  if (!visible) return null;
  const full = true;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {full ? (
        <View style={styles.row} pointerEvents="box-none">
          {visible ? (
            <Pressable onPress={onTogglePlay} hitSlop={10} style={styles.btn} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} testID="video-playpause">
              <Icon name={playing ? 'pause' : 'play'} size={18} color={WHITE} fill={playing ? 'none' : WHITE} />
            </Pressable>
          ) : null}
          <Text style={styles.time} testID="video-time">{`${fmtTime(position)} / ${fmtTime(duration)}`}</Text>
          <View style={{ flex: 1 }} />
          {visible ? (
            <Pressable onPress={onToggleMute} hitSlop={10} style={styles.btn} accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'} testID="video-mute">
              <SpeakerGlyph muted={muted} />
            </Pressable>
          ) : null}
          {visible && onFullscreen ? (
            <Pressable onPress={onFullscreen} hitSlop={10} style={styles.btn} accessibilityRole="button" accessibilityLabel="Full screen" testID="video-fullscreen">
              <FullscreenGlyph />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <SeekBar
        testID="video-seek"
        position={position}
        duration={duration}
        buffered={buffered}
        thick={full}
        onSeek={onSeek}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
    </View>
  );
}

export { SpeakerGlyph };

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  btn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.32)' },
  time: { color: WHITE, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], marginLeft: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  seekHit: { height: 26, justifyContent: 'center' },
  track: { height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  trackThick: { height: 4 },
  buffered: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.35)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: WHITE },
  knob: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, backgroundColor: WHITE, top: 7 },
  knobActive: { width: 18, height: 18, borderRadius: 9, marginLeft: -9, top: 4 },
  dragTip: { position: 'absolute', bottom: 26, marginLeft: -32, width: 64, alignItems: 'center' },
  dragTipText: { color: WHITE, fontSize: 13, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
});
