// Persistent mini player shown above the tab bar (Spotify / Dwell pattern). ONE mini player for both sources:
// scripture narration (src/audio/Narration.js) and the Audio Library player (src/audio/Player.js).
// Only one of them plays at a time (src/audio/focus.js); the bar shows whichever was used last.
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { NightGlow } from './ui';
import { FadeInUp, Pulse } from './Motion';
import { useNarration } from '../audio/Narration';
import { useAudioPlayer } from '../audio/Player';
import { currentOwner } from '../audio/focus';
import { bookName } from '../data/bible';

function PlayGlyph({ playing, size = 16 }) {
  return playing ? (
    <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x="6" y="5" width="4" height="14" rx="1.2" fill={colors.night} /><Rect x="14" y="5" width="4" height="14" rx="1.2" fill={colors.night} /></Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M8 5.5v13l10.5-6.5L8 5.5z" fill={colors.night} /></Svg>
  );
}

export default function MiniPlayer({ bg }) {
  const nar = useNarration();
  const player = useAudioPlayer();
  const showLibrary = player.active && (!nar.active || currentOwner() === 'library');
  if (showLibrary) return <LibraryMini player={player} bg={bg} />;
  if (!nar.active) return null;
  const pct = nar.total ? (nar.verse / nar.total) * 100 : 0;
  return (
    <FadeInUp distance={24} duration={360} style={[styles.wrap, bg && { backgroundColor: bg }]}>
      <Pressable onPress={nar.openPlayer} accessibilityLabel="Open player" style={({ pressed }) => [styles.bar, pressed && { opacity: 0.92 }]}>
        <NightGlow intensity={0.8} />
        <Pulse active={nar.playing} min={0.94} max={1.04} duration={1000} style={styles.art}>
          <Text style={styles.artText}>{bookName(nar.bookId).slice(0, 3).toUpperCase()}</Text>
        </Pulse>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{bookName(nar.bookId)} {nar.chapter}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {nar.playing ? 'Playing' : 'Paused'} · Verse {nar.verse} of {nar.total} · {nar.narrator.name}
          </Text>
        </View>
        <Pressable onPress={nar.toggle} hitSlop={8} style={styles.play} accessibilityLabel={nar.playing ? 'Pause narration' : 'Play narration'}>
          <PlayGlyph playing={nar.playing} />
        </Pressable>
        <Pressable onPress={nar.stop} hitSlop={8} style={styles.close} accessibilityLabel="Stop narration">
          <Icon name="x" size={15} color={colors.nightMuted} strokeWidth={2.4} />
        </Pressable>
        <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
      </Pressable>
    </FadeInUp>
  );
}

function LibraryMini({ player, bg }) {
  const t = player.current;
  const pct = player.durationSec ? Math.min(100, (player.positionSec / player.durationSec) * 100) : 0;
  const status = player.adBreak && player.loading ? 'Starting…' : player.error ? player.error : player.buffering ? 'Loading…' : player.playing ? 'Playing' : 'Paused';
  return (
    <FadeInUp distance={24} duration={360} style={[styles.wrap, bg && { backgroundColor: bg }]}>
      <Pressable onPress={player.openSheet} accessibilityLabel="Open player" style={({ pressed }) => [styles.bar, pressed && { opacity: 0.92 }]}>
        <NightGlow intensity={0.8} />
        <Pulse active={player.playing} min={0.96} max={1.03} duration={1100} style={styles.art}>
          {t.cover ? <Image source={{ uri: t.cover }} style={styles.cover} /> : <Icon name="headphones" size={18} color={colors.goldLight} />}
        </Pulse>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {status}{t.artist ? ` · ${t.artist}` : ''}{player.queue.length > 1 ? ` · ${player.index + 1}/${player.queue.length}` : ''}
          </Text>
        </View>
        <Pressable onPress={player.toggle} hitSlop={8} style={styles.play} accessibilityLabel={player.playing ? 'Pause' : 'Play'}>
          <PlayGlyph playing={player.playing} />
        </Pressable>
        {player.hasNext ? (
          <Pressable onPress={player.next} hitSlop={8} style={styles.close} accessibilityLabel="Next track">
            <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M5 5.5v13l9.5-6.5L5 5.5z" fill={colors.nightFg} /><Path d="M18 5.5v13" stroke={colors.nightFg} strokeWidth={2.2} strokeLinecap="round" /></Svg>
          </Pressable>
        ) : null}
        <Pressable onPress={player.stop} hitSlop={8} style={styles.close} accessibilityLabel="Stop and close player">
          <Icon name="x" size={15} color={colors.nightMuted} strokeWidth={2.4} />
        </Pressable>
        <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
      </Pressable>
    </FadeInUp>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 6, backgroundColor: 'transparent' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: 10, paddingRight: 8, overflow: 'hidden', ...shadow.md },
  art: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(212,168,82,0.18)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cover: { width: 40, height: 40, borderRadius: 10 },
  artText: { fontFamily: fonts.serifBold, fontSize: 12, color: colors.goldLight, letterSpacing: 0.8 },
  title: { fontSize: 13.5, fontWeight: '700', color: colors.nightFg },
  sub: { fontSize: 11.5, color: colors.nightMuted, marginTop: 1 },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  close: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, backgroundColor: 'rgba(255,255,255,0.08)' },
  fill: { height: 2.5, backgroundColor: colors.goldLight },
});

// Library-only bar for screens where the narration bar is hidden (the Bible reader has its own narration
// controls), so library audio keeps its controls everywhere.
export function LibraryMiniBar({ bg }) {
  const nar = useNarration();
  const player = useAudioPlayer();
  if (!player.active || (nar.active && currentOwner() !== 'library')) return null;
  return <LibraryMini player={player} bg={bg} />;
}
