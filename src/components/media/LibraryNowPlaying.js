// "Now playing" sheet for the Audio Library player (src/audio/Player.js): cover, seekable progress,
// previous / back 15 s / play / forward 30 s / next, speed, and the Up Next queue.
import React, { useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../../theme';
import { Icon } from '../Icons';
import { NightGlow } from '../ui';
import { AnimatedModal, PressScale, Pulse } from '../Motion';
import { useAudioPlayer } from '../../audio/Player';
import { fmtDuration } from '../../api/library';

export default function LibraryNowPlaying() {
  const p = useAudioPlayer();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(300);
  const t = p.current;
  const visible = p.sheetOpen && !!t;
  const pct = p.durationSec ? Math.min(1, p.positionSec / p.durationSec) : 0;
  const cycleRate = () => p.setRate(p.rates[(p.rates.indexOf(p.rate) + 1) % p.rates.length]);
  const barRef = useRef(null);
  const onSeek = (e) => {
    const x = e.nativeEvent && (e.nativeEvent.locationX != null ? e.nativeEvent.locationX : e.nativeEvent.offsetX);
    if (typeof x === 'number' && p.durationSec) p.seek((x / w) * p.durationSec);
  };
  return (
    <AnimatedModal visible={visible} onRequestClose={p.closeSheet} full>
      <View style={[styles.wrap, { paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 16 : 24) + 10 }]}>
        <NightGlow intensity={1.3} />
        <View style={styles.topRow}>
          <Pressable onPress={p.closeSheet} hitSlop={10} style={styles.roundBtn} accessibilityLabel="Close player">
            <Icon name="chevron-down" size={20} color={colors.nightFg} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.topEyebrow}>{p.playing ? 'Now playing' : 'Paused'}</Text>
          <Pressable onPress={p.toggleMute} hitSlop={10} style={styles.roundBtn} accessibilityLabel={p.muted ? 'Unmute' : 'Mute'}>
            <Icon name="volume" size={17} color={p.muted ? colors.nightMuted : colors.nightFg} />
          </Pressable>
        </View>
        {t ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <Pulse active={p.playing} min={0.985} max={1.015} duration={2400} style={styles.art}>
              {t.cover ? <Image source={{ uri: t.cover }} style={StyleSheet.absoluteFill} /> : (
                <>
                  <LinearGradient colors={['#3A3F86', '#1D1F45', '#2B1E3D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <Icon name="headphones" size={64} color={colors.goldLight} />
                </>
              )}
            </Pulse>
            <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{[t.artist, t.categoryName].filter(Boolean).join(' · ') || 'BibleNestra Audio'}</Text>
            {p.error ? <Text style={styles.err}>{p.error}</Text> : null}

            <Pressable ref={barRef} onLayout={(e) => setW(e.nativeEvent.layout.width || 300)} onPress={onSeek} style={styles.track} accessibilityRole="adjustable" accessibilityLabel="Seek">
              <View style={styles.trackBg} />
              <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
              <View style={[styles.knob, { left: `${pct * 100}%` }]} />
            </Pressable>
            <View style={styles.timeRow}>
              <Text style={styles.time}>{fmtDuration(p.positionSec)}</Text>
              <Text style={styles.time}>{p.durationSec ? `-${fmtDuration(p.durationSec - p.positionSec)}` : p.buffering ? 'Loading…' : ''}</Text>
            </View>

            <View style={styles.transport}>
              <Pressable onPress={p.prev} style={styles.skip} accessibilityLabel="Previous"><SkipGlyph back /></Pressable>
              <Pressable onPress={() => p.skip(-15)} style={styles.skip} accessibilityLabel="Back 15 seconds"><Text style={styles.jump}>-15</Text></Pressable>
              <PressScale onPress={p.toggle} scaleTo={0.9} style={styles.play} accessibilityLabel={p.playing ? 'Pause' : 'Play'}>
                {p.playing ? (
                  <Svg width={28} height={28} viewBox="0 0 24 24"><Rect x="6" y="5" width="4" height="14" rx="1.3" fill={colors.night} /><Rect x="14" y="5" width="4" height="14" rx="1.3" fill={colors.night} /></Svg>
                ) : (
                  <Svg width={28} height={28} viewBox="0 0 24 24"><Path d="M8 5.5v13l10.5-6.5L8 5.5z" fill={colors.night} /></Svg>
                )}
              </PressScale>
              <Pressable onPress={() => p.skip(30)} style={styles.skip} accessibilityLabel="Forward 30 seconds"><Text style={styles.jump}>+30</Text></Pressable>
              <Pressable onPress={p.next} disabled={!p.hasNext} style={[styles.skip, !p.hasNext && { opacity: 0.35 }]} accessibilityLabel="Next"><SkipGlyph /></Pressable>
            </View>

            <View style={styles.pills}>
              <Pressable onPress={cycleRate} style={styles.pill}><Text style={styles.pillStrong}>{p.rate}×</Text><Text style={styles.pillLabel}>Speed</Text></Pressable>
              <Pressable onPress={() => { p.stop(); }} style={styles.pill}><Icon name="x" size={16} color={colors.nightFg} /><Text style={styles.pillLabel}>Stop</Text></Pressable>
            </View>

            {p.queue.length > 1 ? (
              <>
                <Text style={styles.section}>Up next · {p.queue.length} tracks</Text>
                {p.queue.map((q, i) => (
                  <Pressable key={`${q.id}-${i}`} onPress={() => p.playAt(i)} style={[styles.qRow, i === p.index && styles.qOn]}>
                    <Text style={[styles.qNum, i === p.index && { color: colors.goldLight }]}>{i === p.index ? '▶' : i + 1}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.qTitle} numberOfLines={1}>{q.title}</Text>
                      {q.artist ? <Text style={styles.qSub} numberOfLines={1}>{q.artist}</Text> : null}
                    </View>
                    {q.durationSec ? <Text style={styles.qSub}>{fmtDuration(q.durationSec)}</Text> : null}
                  </Pressable>
                ))}
              </>
            ) : null}
            <Text style={styles.note}>Keeps playing while you use the rest of the app{Platform.OS === 'web' ? '' : ' and with the screen off'}. Your place in each recording is saved.</Text>
          </ScrollView>
        ) : null}
      </View>
    </AnimatedModal>
  );
}

function SkipGlyph({ back }) {
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" style={back ? { transform: [{ scaleX: -1 }] } : null}>
      <Path d="M5 5.5v13l9.5-6.5L5 5.5z" fill={colors.nightFg} />
      <Path d="M18 5.5v13" stroke={colors.nightFg} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.night },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 18 },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  topEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.goldLight },
  art: { alignSelf: 'center', width: 280, height: 280, maxWidth: '100%', borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.nightRaised, ...shadow.lg },
  title: { fontFamily: fonts.serifBold, fontSize: 23, color: colors.nightFg, marginTop: 26 },
  subtitle: { fontSize: 13.5, color: colors.nightMuted, marginTop: 3 },
  err: { color: '#F2A7A7', fontSize: 12.5, marginTop: 8 },
  track: { height: 26, justifyContent: 'center', marginTop: 20 },
  trackBg: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)' },
  trackFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: colors.goldLight },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: '#FFFFFF' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 11.5, color: colors.nightMuted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  skip: { width: 48, height: 52, alignItems: 'center', justifyContent: 'center' },
  jump: { color: colors.nightFg, fontWeight: '800', fontSize: 14 },
  play: { width: 74, height: 74, borderRadius: 37, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center', ...shadow.lg },
  pills: { flexDirection: 'row', gap: 8, marginTop: 24 },
  pill: { flex: 1, height: 58, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pillStrong: { fontSize: 15, fontWeight: '800', color: colors.nightFg },
  pillLabel: { fontSize: 11, fontWeight: '600', color: colors.nightMuted },
  section: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight, marginTop: 28, marginBottom: 10 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, marginBottom: 4 },
  qOn: { backgroundColor: 'rgba(212,168,82,0.12)' },
  qNum: { width: 20, textAlign: 'center', color: colors.nightMuted, fontWeight: '700', fontSize: 12.5 },
  qTitle: { color: colors.nightFg, fontSize: 14, fontWeight: '700' },
  qSub: { color: colors.nightMuted, fontSize: 12 },
  note: { color: colors.nightMuted, fontSize: 12, marginTop: 22, lineHeight: 17, textAlign: 'center' },
});
