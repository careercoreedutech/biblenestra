// Today → "Support us for the day": four 🔥 tasks, each lit by watching one rewarded ad.
// When the fourth is done a full-screen celebration appears:
// "🎉🎉🎉🎉 Your reward shall be great in God's Presence".
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts, shadow } from '../theme';
import { Icon } from './Icons';
import { NightGlow } from './ui';
import { Pop, Pulse, PressScale, ScaleIn } from './Motion';
import { useToast, haptic } from './Toast';
import { useStore } from '../store';
import { useSync } from '../api/sync';
import { useAds } from '../ads/Ads';
import { AD_RULES } from '../ads/config';
import { dayKey } from '../data/rhythm';

export default function SupportAdsCard() {
  const { state, dispatch } = useStore();
  const sync = useSync(); // online: flames are counted by the server (AdMob SSV / demo claim)
  const ads = useAds();
  const toast = useToast();
  const today = dayKey(new Date());
  const total = AD_RULES.dailySupportAds;
  const count = state.supportAds && state.supportAds.date === today ? state.supportAds.count : 0;
  const done = count >= total;
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const watch = async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      const r = await ads.showRewarded({ purpose: 'support' });
      if (!r.rewarded) {
        toast.show('The ad was closed early — the flame stays unlit', { icon: 'flame', tone: 'error' });
        return;
      }
      let n = count + 1;
      if (sync.online) {
        try {
          const out = await sync.creditAd('support');
          n = out.supportAdsToday || 0;
        } catch (e) {
          toast.show((e && e.message) || 'Couldn’t record that ad — please try again', { icon: 'flame', tone: 'error' });
          return;
        }
        if (n <= count) {
          toast.show('That ad didn’t count — today’s flames may already be lit', { icon: 'flame', tone: 'error' });
          return;
        }
      } else {
        dispatch({ type: 'supportAd', date: today });
      }
      if (n >= total) {
        setTimeout(() => setCelebrate(true), 250);
      } else {
        toast.show(`🔥 ${n} of ${total} — thank you for supporting BibleNestra`, { haptic: 'success' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <NightGlow intensity={0.8} />
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Support us today</Text>
        <Text style={styles.count}>{count}/{total}</Text>
      </View>
      <Text style={styles.title}>{done ? 'Thank you for standing with us today' : 'Support us for the day by watching these four ads'}</Text>
      <Text style={styles.body}>
        {done ? 'Your support keeps the Word free for everyone. Come back tomorrow to light the flames again.' : 'Each short ad keeps BibleNestra free for believers everywhere. Light all four flames.'}
      </Text>

      <View style={styles.flames}>
        {Array.from({ length: total }, (_, i) => {
          const lit = i < count;
          const next = i === count && !done;
          return (
            <PressScale key={i} onPress={next ? watch : undefined} disabled={!next} scaleTo={0.9} style={[styles.flame, lit && styles.flameLit, next && styles.flameNext]} accessibilityLabel={lit ? `Ad ${i + 1} watched` : `Watch ad ${i + 1}`}>
              {lit ? (
                <Pop trigger={lit} amount={1.4}><Text style={styles.flameEmoji}>🔥</Text></Pop>
              ) : next ? (
                <Pulse min={0.9} max={1.08}><Text style={[styles.flameEmoji, styles.flameDim]}>🔥</Text></Pulse>
              ) : (
                <Text style={[styles.flameEmoji, styles.flameDim]}>🔥</Text>
              )}
            </PressScale>
          );
        })}
      </View>

      {done ? (
        <Pressable onPress={() => setCelebrate(true)} style={styles.doneRow}>
          <Icon name="check-circle" size={16} color={colors.goldLight} />
          <Text style={styles.doneText}>All four flames lit today</Text>
        </Pressable>
      ) : (
        <PressScale onPress={watch} disabled={busy} scaleTo={0.97} style={[styles.cta, busy && { opacity: 0.6 }]}>
          <Icon name="play" size={15} color={colors.night} />
          <Text style={styles.ctaText}>{busy ? 'Loading ad…' : `Watch ad ${count + 1} of ${total}`}</Text>
        </PressScale>
      )}

      <Celebration visible={celebrate} onClose={() => setCelebrate(false)} />
    </View>
  );
}

// Full-screen splash with falling confetti
function Celebration({ visible, onClose }) {
  const { width, height } = useWindowDimensions();
  const scale = useRef(new Animated.Value(0.6)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const pieces = useRef(Array.from({ length: 26 }, (_, i) => ({
    x: Math.random(),
    delay: Math.random() * 900,
    dur: 2200 + Math.random() * 1800,
    rot: Math.random() * 360,
    glyph: ['🎉', '✦', '🔥', '✨', '🎊'][i % 5],
    size: 14 + Math.random() * 14,
    v: new Animated.Value(0),
  }))).current;

  useEffect(() => {
    if (!visible) return;
    haptic('success');
    scale.setValue(0.6); fade.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
    pieces.forEach((p) => {
      p.v.setValue(0);
      Animated.loop(Animated.timing(p.v, { toValue: 1, duration: p.dur, delay: p.delay, easing: Easing.linear, useNativeDriver: true })).start();
    });
    return () => pieces.forEach((p) => p.v.stopAnimation());
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.splash, { opacity: fade }]}>
        <NightGlow intensity={1.4} />
        {pieces.map((p, i) => (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute', left: p.x * width, top: -30, fontSize: p.size, opacity: 0.85, zIndex: 1, color: colors.goldLight,
              transform: [
                { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, height + 60] }) },
                { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: [`${p.rot}deg`, `${p.rot + 300}deg`] }) },
              ],
            }}
          >
            {p.glyph}
          </Animated.Text>
        ))}
        <Animated.View style={[styles.splashInner, { transform: [{ scale }] }]}>
          <Text style={styles.party}>🎉🎉🎉🎉</Text>
          <Text style={styles.splashTitle}>Your reward shall be great in God’s Presence</Text>
          <Text style={styles.splashBody}>Thank you for supporting BibleNestra today. “Whatsoever ye do, do it heartily, as to the Lord.” — Colossians 3:23</Text>
          <ScaleIn delay={500}>
            <PressScale onPress={onClose} scaleTo={0.95} style={styles.splashBtn}>
              <Text style={styles.splashBtnText}>Amen</Text>
            </PressScale>
          </ScaleIn>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 18, marginTop: 22, padding: 18, borderRadius: 24, backgroundColor: colors.night, overflow: 'hidden', ...shadow.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight },
  count: { fontSize: 12, fontWeight: '800', color: colors.nightMuted },
  title: { fontFamily: fonts.serifBold, fontSize: 21, lineHeight: 26, color: colors.nightFg, marginTop: 8 },
  body: { fontSize: 13.5, lineHeight: 19, color: colors.nightMuted, marginTop: 6 },
  flames: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 10 },
  flame: { flex: 1, height: 64, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  flameLit: { backgroundColor: 'rgba(232,140,48,0.20)', borderColor: 'rgba(240,160,70,0.55)' },
  flameNext: { borderColor: colors.goldLight, borderStyle: 'dashed' },
  flameEmoji: { fontSize: 30 },
  flameDim: { opacity: 0.28 },
  cta: { marginTop: 16, height: 48, borderRadius: 16, backgroundColor: colors.goldLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { fontSize: 15, fontWeight: '800', color: colors.night },
  doneRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center' },
  doneText: { fontSize: 13.5, fontWeight: '700', color: colors.goldLight },
  splash: { flex: 1, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', padding: 28, overflow: 'hidden' },
  splashInner: { alignItems: 'center', maxWidth: 360, zIndex: 2, position: 'relative', paddingVertical: 24, paddingHorizontal: 12, borderRadius: 28, backgroundColor: 'rgba(21,23,43,0.72)' },
  party: { fontSize: 52, letterSpacing: 4 },
  splashTitle: { fontFamily: fonts.serifBold, fontSize: 32, lineHeight: 38, color: colors.nightFg, textAlign: 'center', marginTop: 18 },
  splashBody: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 24, color: colors.nightMuted, textAlign: 'center', marginTop: 14 },
  splashBtn: { marginTop: 28, paddingHorizontal: 44, height: 52, borderRadius: 26, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  splashBtnText: { fontSize: 16, fontWeight: '800', color: colors.night },
});
