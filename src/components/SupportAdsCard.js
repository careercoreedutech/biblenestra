// Today → "Support us today" (brief 10.1). Two clear options:
//   1. 📺 Watch an ad to support BibleNestra (free) — four 🔥 tasks, each lit by one rewarded ad. The ad is
//      preloaded as soon as the card appears; tapping shows a short skeleton (≤ ~3 s) and, if no ad is ready,
//      "No ad available right now. Try again shortly" — never an endless spinner. Every watched ad gets a
//      thank-you with a blessing; the fourth gets the full celebration
//      "🎉🎉🎉🎉 Your reward shall be great in God's Presence".
//   2. 💛 Give directly — preset amounts (₦1,000 / ₦5,000 / ₦10,000 / custom), one-off or monthly, optional
//      message. No payment gateway is configured yet, so submitting shows "Direct giving opens soon" (no card
//      details are ever collected in the app — brief 3.4).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { colors, fonts, shadow } from '../theme';
import { Icon } from './Icons';
import { NightGlow } from './ui';
import { AnimatedModal, Pop, Pulse, PressScale, ScaleIn, Shimmer } from './Motion';
import { useToast, haptic } from './Toast';
import { useStore } from '../store';
import { useSync } from '../api/sync';
import { useAds } from '../ads/Ads';
import { AD_RULES } from '../ads/config';
import { dayKey } from '../data/rhythm';

const AD_WAIT_MS = 3000; // skeleton at most ~3 s, then "No ad available"
const NO_AD = 'No ad available right now. Try again shortly';

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
  const [noAd, setNoAd] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [thanks, setThanks] = useState(0); // >0 → thank-you sheet after ad #n
  const [give, setGive] = useState(false);

  // Preload the rewarded ad as soon as the card appears, so "Watch" opens it instantly
  useEffect(() => { if (!done) ads.preloadRewarded('support'); }, [done]);

  const watch = async () => {
    if (busy || done) return;
    setBusy(true);
    setNoAd(false);
    try {
      const r = await ads.showRewarded({ purpose: 'support', loadTimeoutMs: AD_WAIT_MS });
      if (!r || !r.rewarded) {
        if (r && r.error) {
          setNoAd(true);
          toast.show(NO_AD, { icon: 'play', tone: 'error' });
          ads.preloadRewarded('support'); // try again in the background for the next tap
        } else {
          toast.show('The ad was closed early — the flame stays unlit', { icon: 'flame', tone: 'error' });
        }
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
      if (n >= total) setTimeout(() => setCelebrate(true), 250);
      else setTimeout(() => setThanks(n), 250);
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
      <Text style={styles.title}>{done ? 'Thank you for standing with us today' : 'Two ways to keep BibleNestra free'}</Text>

      {/* Option 1 — watch an ad */}
      <View style={styles.option}>
        <View style={styles.optionHead}>
          <Text style={styles.optionEmoji}>📺</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.optionTitle}>Watch an ad to support BibleNestra</Text>
            <Text style={styles.optionSub}>{done ? 'All four flames lit — come back tomorrow' : 'Free · each short ad lights one flame'}</Text>
          </View>
        </View>

        <View style={styles.flames}>
          {Array.from({ length: total }, (_, i) => {
            const lit = i < count;
            const next = i === count && !done;
            return (
              <PressScale key={i} onPress={next ? watch : undefined} disabled={!next || busy} scaleTo={0.9} style={[styles.flame, lit && styles.flameLit, next && styles.flameNext]} accessibilityLabel={lit ? `Ad ${i + 1} watched` : `Watch ad ${i + 1}`}>
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
        ) : busy ? (
          // short skeleton while the (preloaded) ad opens — capped at ~3 s by loadTimeoutMs
          <View style={styles.ctaSkeleton} accessibilityLabel="Getting your ad ready">
            <Shimmer style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 0 }]} />
            <Text style={styles.ctaSkeletonText}>Getting your ad ready…</Text>
          </View>
        ) : (
          <PressScale onPress={watch} scaleTo={0.97} style={styles.cta}>
            <Icon name="play" size={15} color={colors.night} />
            <Text style={styles.ctaText}>{noAd ? 'Try again' : `Watch ad ${count + 1} of ${total}`}</Text>
          </PressScale>
        )}
        {noAd && !busy && !done ? <Text style={styles.noAd}>{NO_AD}</Text> : null}
      </View>

      {/* Option 2 — give directly */}
      <PressScale onPress={() => setGive(true)} scaleTo={0.98} style={[styles.option, styles.optionGive]} accessibilityRole="button" accessibilityLabel="Give directly">
        <View style={styles.optionHead}>
          <Text style={styles.optionEmoji}>💛</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.optionTitle}>Give directly</Text>
            <Text style={styles.optionSub}>A one-off or monthly gift, with an optional message</Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.goldLight} />
        </View>
      </PressScale>

      <ThankYou n={thanks} total={total} onClose={() => setThanks(0)} />
      <Celebration visible={celebrate} onClose={() => setCelebrate(false)} />
      <GiveSheet visible={give} onClose={() => setGive(false)} />
    </View>
  );
}

// ---------- thank-you after a watched ad (1–3 of 4) ----------
function ThankYou({ n, total, onClose }) {
  const last = useRef(n);
  if (n) last.current = n;
  const shown = n || last.current;
  return (
    <AnimatedModal visible={!!n} onRequestClose={onClose}>
      <View style={styles.centerWrap}>
        <View style={styles.thanksCard}>
          <NightGlow intensity={1.1} />
          <Text style={styles.party}>🔥</Text>
          <Text style={styles.thanksTitle}>Thank you for your support</Text>
          <Text style={styles.thanksSub}>{shown} of {total} flames lit today</Text>
          <Text style={styles.splashBody}>“The Lord bless thee, and keep thee: the Lord make his face shine upon thee, and be gracious unto thee.” — Numbers 6:24–25</Text>
          <ScaleIn delay={250} style={{ alignSelf: 'stretch' }}>
            <PressScale onPress={onClose} scaleTo={0.95} style={[styles.splashBtn, { marginTop: 22 }]}>
              <Text style={styles.splashBtnText}>Amen</Text>
            </PressScale>
          </ScaleIn>
        </View>
      </View>
    </AnimatedModal>
  );
}

// ---------- Give directly (no gateway yet → "opens soon"; never collects card details) ----------
const PRESETS = [1000, 5000, 10000];
const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;

function GiveSheet({ visible, onClose }) {
  const [preset, setPreset] = useState(5000);
  const [custom, setCustom] = useState('');
  const [monthly, setMonthly] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (visible) { setSent(false); setErr(null); } }, [visible]);
  const amount = preset === 'custom' ? parseInt(String(custom).replace(/[^0-9]/g, ''), 10) || 0 : preset;

  const submit = () => {
    if (amount < 100) { setErr('Enter an amount of at least ₦100'); return; }
    if (amount > 5000000) { setErr('For gifts above ₦5,000,000 please contact our team'); return; }
    setErr(null);
    haptic('success');
    setSent(true);
  };

  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{sent ? 'Thank you for your generous heart' : '💛 Give directly'}</Text>
            <PressScale onPress={onClose} hitSlop={12} scaleTo={0.88} accessibilityLabel="Close" style={styles.closeBtn}>
              <Icon name="x" size={14} color={colors.fg} strokeWidth={2.4} />
            </PressScale>
          </View>
          {sent ? (
            <View style={{ paddingHorizontal: 20, paddingBottom: 28 }}>
              <View style={styles.soonBox}>
                <Icon name="clock" size={16} color={colors.gold} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.soonTitle}>Direct giving opens soon</Text>
                  <Text style={styles.soonBody}>
                    We’re setting up a secure way to give {naira(amount)}{monthly ? ' each month' : ''}. Nothing has been charged and no card details were taken. We’ll let you know as soon as it’s ready.
                  </Text>
                </View>
              </View>
              <Text style={styles.blessing}>“Every man according as he purposeth in his heart, so let him give; not grudgingly, or of necessity: for God loveth a cheerful giver.” — 2 Corinthians 9:7</Text>
              <PressScale onPress={onClose} scaleTo={0.96} style={styles.giveBtn}>
                <Text style={styles.giveBtnText}>Amen</Text>
              </PressScale>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Amount</Text>
              <View style={styles.amounts}>
                {PRESETS.map((a) => (
                  <PressScale key={a} onPress={() => setPreset(a)} scaleTo={0.95} style={[styles.amount, preset === a && styles.amountOn]} accessibilityRole="button" accessibilityState={{ selected: preset === a }}>
                    <Text style={[styles.amountText, preset === a && styles.amountTextOn]}>{naira(a)}</Text>
                  </PressScale>
                ))}
                <PressScale onPress={() => setPreset('custom')} scaleTo={0.95} style={[styles.amount, preset === 'custom' && styles.amountOn]} accessibilityRole="button" accessibilityState={{ selected: preset === 'custom' }}>
                  <Text style={[styles.amountText, preset === 'custom' && styles.amountTextOn]}>Custom</Text>
                </PressScale>
              </View>
              {preset === 'custom' ? (
                <TextInput value={custom} onChangeText={setCustom} placeholder="Amount in ₦" placeholderTextColor={colors.faint} keyboardType="number-pad" maxLength={9} style={styles.input} accessibilityLabel="Custom amount in naira" />
              ) : null}

              <Text style={styles.label}>How often</Text>
              <View style={styles.segment}>
                {[['One-off', false], ['Monthly', true]].map(([label, m]) => (
                  <Pressable key={label} onPress={() => setMonthly(m)} style={[styles.segBtn, monthly === m && styles.segBtnOn]} accessibilityRole="button" accessibilityState={{ selected: monthly === m }}>
                    <Text style={[styles.segText, monthly === m && styles.segTextOn]}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Message (optional)</Text>
              <TextInput value={message} onChangeText={setMessage} placeholder="A word of encouragement for the team" placeholderTextColor={colors.faint} maxLength={200} multiline style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} accessibilityLabel="Message" />

              {err ? <Text style={styles.err}>{err}</Text> : null}
              <PressScale onPress={submit} scaleTo={0.96} style={styles.giveBtn} accessibilityRole="button">
                <Text style={styles.giveBtnText}>{amount ? `Give ${naira(amount)}${monthly ? ' monthly' : ''}` : 'Give'}</Text>
              </PressScale>
              <Text style={styles.fine}>Gifts are voluntary. Payments will be handled by a secure, approved payment provider — BibleNestra never asks for your card details in the app.</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </AnimatedModal>
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
  option: { marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  optionGive: { borderColor: 'rgba(212,168,82,0.35)', backgroundColor: 'rgba(212,168,82,0.08)' },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionEmoji: { fontSize: 26 },
  optionTitle: { fontSize: 15, fontWeight: '800', color: colors.nightFg },
  optionSub: { fontSize: 12.5, lineHeight: 17, color: colors.nightMuted, marginTop: 2 },
  flames: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, gap: 10 },
  flame: { flex: 1, height: 58, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  flameLit: { backgroundColor: 'rgba(232,140,48,0.20)', borderColor: 'rgba(240,160,70,0.55)' },
  flameNext: { borderColor: colors.goldLight, borderStyle: 'dashed' },
  flameEmoji: { fontSize: 28 },
  flameDim: { opacity: 0.28 },
  cta: { marginTop: 14, height: 48, borderRadius: 16, backgroundColor: colors.goldLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { fontSize: 15, fontWeight: '800', color: colors.night },
  ctaSkeleton: { marginTop: 14, height: 48, borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  ctaSkeletonText: { fontSize: 13.5, fontWeight: '700', color: colors.nightMuted },
  noAd: { fontSize: 12.5, color: colors.nightMuted, textAlign: 'center', marginTop: 8 },
  doneRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center' },
  doneText: { fontSize: 13.5, fontWeight: '700', color: colors.goldLight },
  centerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22 },
  thanksCard: { width: '100%', maxWidth: 380, borderRadius: 28, backgroundColor: colors.night, padding: 24, alignItems: 'center', overflow: 'hidden', ...shadow.md },
  thanksTitle: { fontFamily: fonts.serifBold, fontSize: 26, lineHeight: 31, color: colors.nightFg, textAlign: 'center', marginTop: 10 },
  thanksSub: { fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: colors.goldLight, marginTop: 8 },
  splash: { flex: 1, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', padding: 28, overflow: 'hidden' },
  splashInner: { alignItems: 'center', maxWidth: 360, zIndex: 2, position: 'relative', paddingVertical: 24, paddingHorizontal: 12, borderRadius: 28, backgroundColor: 'rgba(21,23,43,0.72)' },
  party: { fontSize: 52, letterSpacing: 4 },
  splashTitle: { fontFamily: fonts.serifBold, fontSize: 32, lineHeight: 38, color: colors.nightFg, textAlign: 'center', marginTop: 18 },
  splashBody: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 24, color: colors.nightMuted, textAlign: 'center', marginTop: 14 },
  splashBtn: { marginTop: 28, paddingHorizontal: 44, height: 52, borderRadius: 26, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  splashBtnText: { fontSize: 16, fontWeight: '800', color: colors.night },
  // give sheet (same bottom-sheet look as the app's other sheets)
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, maxHeight: '88%', ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 6 },
  sheetTitle: { flex: 1, fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 27, color: colors.fg },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: colors.fg, marginTop: 16, marginBottom: 8 },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amount: { flexGrow: 1, minWidth: 72, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  amountOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  amountText: { fontSize: 14.5, fontWeight: '800', color: colors.fg },
  amountTextOn: { color: colors.surface },
  input: { marginTop: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.fg },
  segment: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.surface, ...shadow.sm },
  segText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  segTextOn: { color: colors.fg },
  err: { color: colors.negative, fontSize: 13, marginTop: 10 },
  giveBtn: { marginTop: 18, height: 52, borderRadius: 26, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  giveBtnText: { fontSize: 16, fontWeight: '800', color: colors.night },
  fine: { fontSize: 11.5, lineHeight: 16, color: colors.faint, marginTop: 12, textAlign: 'center' },
  soonBox: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.warningFaint || colors.raised, marginTop: 8 },
  soonTitle: { fontSize: 15, fontWeight: '800', color: colors.fg },
  soonBody: { fontSize: 13.5, lineHeight: 19, color: colors.muted, marginTop: 4 },
  blessing: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 24, color: colors.fg, textAlign: 'center', marginTop: 18 },
});
