// "Now playing" audio screen for scripture narration
// (pattern from Dwell: narrator choice, speed, sleep timer, background music, Reflect pauses).
import React, { useEffect, useRef } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AnimatedModal } from './Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { NightGlow } from './ui';
import { Pulse, Pop, PressScale, FadeInUp } from './Motion';
import { Animated, Easing } from 'react-native';

import { useNarration, NARRATORS, SPEEDS, SLEEP_OPTIONS } from '../audio/Narration';
import { bookName, CHAPTER_TITLES, getChapter } from '../data/bible';
import LibraryNowPlaying from './media/LibraryNowPlaying';

const MUSIC = ['None', 'Ambient', 'Piano', 'Strings'];

// Global players, mounted once in App.js: the narration sheet and the Audio Library sheet
// (each opens from the shared MiniPlayer; only one source plays at a time).
export default function NowPlayingSheet() {
  return (
    <>
      <NarrationSheet />
      <LibraryNowPlaying />
    </>
  );
}

// Narration — reads everything from the narration engine.
function NarrationSheet() {
  const nar = useNarration();
  const visible = nar.playerOpen;
  const onClose = nar.closePlayer;
  const narrator = nar.narrator; const setNarrator = nar.setNarrator;
  const speed = nar.rate; const setSpeed = nar.setRate;
  const timer = nar.sleep; const setTimer = nar.setSleep;
  const music = nar.music; const setMusic = nar.setMusic;
  const reflect = nar.reflect; const setReflect = nar.setReflect;
  const playing = nar.playing;
  const onTogglePlay = nar.toggle;
  const progress = nar.total ? (nar.verse - 1) / nar.total : 0;
  const title = nar.bookId ? `${bookName(nar.bookId)} ${nar.chapter}` : 'Nothing playing';
  // Short heading only (some chapter entries hold long text); the verse itself is shown below and follows the voice.
  const heading = nar.bookId ? CHAPTER_TITLES[`${nar.bookId}:${nar.chapter}`] : null;
  const subtitle = nar.bookId
    ? `${nar.mode === 'verse' ? `Verse ${nar.verse}` : heading && heading.length <= 60 ? heading : `Verse ${nar.verse} of ${nar.total}`} · ${nar.translation}`
    : 'Start narration from the Bible or Today';
  // The verse being spoken, with the one before and after for context
  const verses = nar.bookId ? getChapter(nar.translation, nar.bookId, nar.chapter) || [] : [];
  const current = verses[nar.verse - 1] || '';
  const prevText = nar.mode === 'verse' ? '' : verses[nar.verse - 2] || '';
  const nextText = nar.mode === 'verse' ? '' : verses[nar.verse] || '';
  const eyebrow = nar.playing ? 'Now playing' : nar.active ? 'Paused' : 'Narration';
  const setProgress = () => {};
  // Slowly turning rings on the artwork while narration plays
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!playing) { spin.stopAnimation(); return undefined; }
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 16000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [playing]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const insets = useSafeAreaInsets();
  const cycle = (arr, v, set) => set(arr[(arr.indexOf(v) + 1) % arr.length]);

  return (
    <AnimatedModal visible={visible} onRequestClose={onClose} full>
      <View style={[styles.wrap, { paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 16 : 24) + 10 }]}>
        <NightGlow intensity={1.3} />
        <View style={styles.topRow}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.roundBtn} accessibilityLabel="Close player">
            <Icon name="chevron-down" size={20} color={colors.nightFg} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.topEyebrow}>{eyebrow}</Text>
          <View style={styles.roundBtn}>
            <Icon name="more" size={18} color={colors.nightFg} />
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 36 }} showsVerticalScrollIndicator={false}>
          {/* Artwork */}
          <View style={styles.art}>
            <LinearGradient colors={['#3A3F86', '#1D1F45', '#2B1E3D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Animated.View style={[styles.artRing, { borderStyle: 'dashed', transform: [{ rotate }] }]} />
            <Pulse active={playing} min={0.96} max={1.06} duration={1600} style={{ position: 'absolute' }}>
              <View style={[styles.artRing, { position: 'relative', width: 170, height: 170, borderRadius: 85, opacity: 0.35 }]} />
            </Pulse>
            <Pop trigger={nar.verse}><Text style={styles.artStar}>✦</Text></Pop>
            <Text style={styles.artTitle} numberOfLines={2}>{title}</Text>
            <Text style={styles.artSub}>{narrator.name}{music !== 'None' ? ` · ${music}` : ''}</Text>
          </View>

          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>

          {current ? (
            <View style={styles.reading} accessibilityLiveRegion="polite" accessibilityLabel={`Verse ${nar.verse}: ${current}`}>
              {prevText ? <Text style={styles.readingDim} numberOfLines={2}><Text style={styles.readingNum}>{nar.verse - 1}  </Text>{prevText}</Text> : null}
              <FadeInUp key={`${nar.bookId}:${nar.chapter}:${nar.verse}`} distance={6} duration={260}>
                <Text style={styles.readingNow}><Text style={styles.readingNumNow}>{nar.verse}  </Text>{current}</Text>
              </FadeInUp>
              {nextText ? <Text style={styles.readingDim} numberOfLines={2}><Text style={styles.readingNum}>{nar.verse + 1}  </Text>{nextText}</Text> : null}
            </View>
          ) : null}

          {/* Scrubber */}
          <Pressable
            onPress={(e) => {
              const w = e.nativeEvent && e.nativeEvent.locationX;
              if (typeof w === 'number' && nar.total) nar.seekVerse(Math.round((w / 330) * nar.total) + 1);
            }}
            style={styles.track}
          >
            <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
            <View style={[styles.knob, { left: `${progress * 100}%` }]} />
          </Pressable>
          <View style={styles.timeRow}>
            <Text style={styles.time}>{nar.total ? `Verse ${nar.verse}` : '—'}</Text>
            <Text style={styles.time}>{nar.total ? `${nar.total - nar.verse} left · ~${fmt(((nar.total - nar.verse + 1) * 9) / speed)}` : ''}</Text>
          </View>

          {/* Transport */}
          <View style={styles.transport}>
            <Pressable onPress={nar.prev} style={styles.skip} accessibilityLabel="Previous verse">
              <SkipGlyph back />
            </Pressable>
            <PressScale onPress={onTogglePlay} scaleTo={0.9} style={styles.play} accessibilityLabel={playing ? 'Pause' : 'Play'}>
              {playing ? (
                <Svg width={28} height={28} viewBox="0 0 24 24"><Rect x="6" y="5" width="4" height="14" rx="1.3" fill={colors.night} /><Rect x="14" y="5" width="4" height="14" rx="1.3" fill={colors.night} /></Svg>
              ) : (
                <Svg width={28} height={28} viewBox="0 0 24 24"><Path d="M8 5.5v13l10.5-6.5L8 5.5z" fill={colors.night} /></Svg>
              )}
            </PressScale>
            <Pressable onPress={nar.next} style={styles.skip} accessibilityLabel="Next verse">
              <SkipGlyph />
            </Pressable>
          </View>

          {/* Quick settings */}
          <View style={styles.pills}>
            <Pressable onPress={() => cycle(SPEEDS, speed, setSpeed)} style={styles.pill}>
              <Text style={styles.pillStrong}>{speed}×</Text>
              <Text style={styles.pillLabel}>Speed</Text>
            </Pressable>
            <Pressable onPress={() => cycle(SLEEP_OPTIONS, timer, setTimer)} style={[styles.pill, timer !== 'Off' && styles.pillOn]}>
              <Icon name="moon" size={16} color={timer !== 'Off' ? colors.night : colors.nightFg} />
              <Text style={[styles.pillLabel, timer !== 'Off' && { color: colors.night }]} numberOfLines={1}>{timer === 'Off' ? 'Sleep' : timer}</Text>
            </Pressable>
            <Pressable onPress={() => cycle(MUSIC, music, setMusic)} style={[styles.pill, music !== 'None' && styles.pillOn]}>
              <Icon name="music" size={16} color={music !== 'None' ? colors.night : colors.nightFg} />
              <Text style={[styles.pillLabel, music !== 'None' && { color: colors.night }]} numberOfLines={1}>{music === 'None' ? 'Music' : music}</Text>
            </Pressable>
            <Pressable onPress={() => setReflect(!reflect)} style={[styles.pill, reflect && styles.pillOn]}>
              <Icon name="clock" size={16} color={reflect ? colors.night : colors.nightFg} />
              <Text style={[styles.pillLabel, reflect && { color: colors.night }]}>Reflect</Text>
            </Pressable>
          </View>
          {reflect ? <Text style={styles.reflectNote}>Pauses for a few seconds after each verse so you can sit with what you heard.</Text> : null}
          {!nar.available ? <Text style={styles.reflectNote}>Speech isn’t available on this device.</Text> : null}
          {nar.active ? (
            <Pressable onPress={() => { nar.stop(); onClose(); }} style={styles.stopBtn}>
              <Text style={styles.stopText}>Stop narration</Text>
            </Pressable>
          ) : null}

          {/* Narrators */}
          <Text style={styles.section}>Voice</Text>
          {['male', 'female'].map((g) => (
            <View key={g}>
              <Text style={styles.voiceGroup}>{g === 'male' ? 'Male voices' : 'Female voices'}</Text>
          {NARRATORS.filter((n) => n.gender === g).map((n) => {
            const on = n.id === narrator.id;
            const info = (nar.voiceInfo || {})[n.id];
            const accent = info && info.accent ? ACCENTS[info.accent.slice(0, 5)] || ACCENTS[info.accent.slice(0, 2)] : null;
            return (
              <Pressable key={n.id} onPress={() => setNarrator(n)} style={[styles.voice, on && styles.voiceOn]}>
                <View style={[styles.voiceAvatar, { backgroundColor: n.tint }]}>
                  <Text style={styles.voiceInitials}>{n.initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.voiceName}>{n.name}</Text>
                  <Text style={styles.voiceStyle}>{n.style}{accent ? ` · ${accent} voice` : ''}</Text>
                  {info && !info.matched && !nar.isWeb ? (
                    <Text style={styles.voiceMissing}>No {g} voice on this phone yet: using the default voice</Text>
                  ) : null}
                </View>
                {on ? (
                  <View style={styles.voiceCheck}><Icon name="check" size={13} color={colors.night} strokeWidth={3} /></View>
                ) : (
                  <Icon name="play" size={15} color={colors.nightMuted} />
                )}
              </Pressable>
            );
          })}
            </View>
          ))}
          {Platform.OS === 'android' ? (
            <Pressable onPress={openVoiceSettings} style={styles.moreVoices} accessibilityRole="button">
              <Icon name="download" size={14} color={colors.goldLight} />
              <Text style={styles.moreVoicesText}>Get more voices for this phone</Text>
            </Pressable>
          ) : null}
          <Text style={styles.voiceNote}>
            Voices come from your phone’s text-to-speech. Phones differ: install more English voices in your phone’s
            Text-to-speech settings (for example Google Speech Services → Install voice data) for more choices.
          </Text>
        </ScrollView>
      </View>
    </AnimatedModal>
  );
}

const ACCENTS = {
  'en-us': 'American', 'en-gb': 'British', 'en-au': 'Australian', 'en-in': 'Indian', 'en-ng': 'Nigerian', 'en-gh': 'Ghanaian',
  'en-ke': 'Kenyan', 'en-za': 'South African', 'en-ie': 'Irish', 'en-ca': 'Canadian', en: 'English',
};

// Android: open the phone's text-to-speech settings so the user can install more voices.
async function openVoiceSettings() {
  try { await Linking.sendIntent('com.android.settings.TTS_SETTINGS'); return; } catch (e) { /* not on every phone */ }
  try { await Linking.openSettings(); } catch (e) { /* ignore */ }
}

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function SkipGlyph({ back }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" style={back ? { transform: [{ scaleX: -1 }] } : null}>
        <Path d="M5 5.5v13l9.5-6.5L5 5.5z" fill={colors.nightFg} />
        <Path d="M18 5.5v13" stroke={colors.nightFg} strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.night },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 18 },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  topEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.goldLight },
  art: { alignSelf: 'center', width: 280, height: 280, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, ...shadow.lg },
  artRing: { position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 1, borderColor: 'rgba(212,168,82,0.35)' },
  artStar: { fontSize: 18, color: colors.goldLight, marginBottom: 10 },
  artTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 35, color: colors.nightFg, textAlign: 'center' },
  artSub: { fontSize: 12, color: colors.nightMuted, marginTop: 8, fontWeight: '600' },
  title: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.nightFg, marginTop: 28 },
  subtitle: { fontSize: 13.5, color: colors.nightMuted, marginTop: 3 },
  reading: { marginTop: 16, padding: 16, gap: 10, minHeight: 190, justifyContent: 'center', borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: colors.nightBorder },
  readingDim: { fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 21, color: 'rgba(244,239,230,0.38)' },
  readingNow: { fontFamily: fonts.serif, fontSize: 19, lineHeight: 28, color: colors.nightFg },
  readingNum: { fontFamily: fonts.serifBold, fontSize: 12, color: 'rgba(212,168,82,0.55)' },
  readingNumNow: { fontFamily: fonts.serifBold, fontSize: 13, color: colors.goldLight },
  track: { height: 22, justifyContent: 'center', marginTop: 20 },
  trackFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: colors.goldLight },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: '#FFFFFF' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 11.5, color: colors.nightMuted, fontWeight: '600' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 38, marginTop: 14 },
  skip: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center', ...shadow.lg },
  pills: { flexDirection: 'row', gap: 8, marginTop: 26 },
  pill: { flex: 1, height: 62, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  pillOn: { backgroundColor: colors.goldLight, borderColor: colors.goldLight },
  pillStrong: { fontSize: 15, fontWeight: '800', color: colors.nightFg },
  pillLabel: { fontSize: 11, fontWeight: '600', color: colors.nightMuted },
  stopBtn: { alignSelf: 'center', marginTop: 16, paddingHorizontal: 18, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  stopText: { color: colors.nightFg, fontSize: 13, fontWeight: '700' },
  reflectNote: { fontSize: 12, color: colors.nightMuted, marginTop: 10, lineHeight: 17 },
  section: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight, marginTop: 28, marginBottom: 10 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'transparent' },
  voiceOn: { borderColor: 'rgba(212,168,82,0.6)', backgroundColor: 'rgba(212,168,82,0.10)' },
  voiceAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  voiceInitials: { fontSize: 13, fontWeight: '800', color: colors.night },
  voiceName: { fontSize: 14.5, fontWeight: '700', color: colors.nightFg },
  voiceStyle: { fontSize: 12, color: colors.nightMuted, marginTop: 1 },
  voiceGroup: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: colors.nightMuted, textTransform: 'uppercase', marginTop: 6, marginBottom: 8 },
  voiceMissing: { fontSize: 11, color: colors.goldLight, marginTop: 3 },
  moreVoices: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', marginTop: 6 },
  moreVoicesText: { fontSize: 13, fontWeight: '600', color: colors.nightFg },
  voiceNote: { fontSize: 11.5, lineHeight: 16, color: colors.nightMuted, marginTop: 10, marginBottom: 6 },
  voiceCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
});
