// MY SCRIPTURE JOURNEY: the celebration pop-up. Balloons rise, golden confetti falls and a trophy pops, all with RN Animated.
// Shows the server's unseen achievements one at a time (on open, or right after a sync awards one). Closing marks it seen,
// so each award is shown once. Share: WhatsApp (text + link) and BibleNestra Socials (a post through POST /posts).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icons';
import { d, df, Tap, Grad, gradients } from '../../design/sanctuary';
import { useApi } from '../../api/auth';
import { fetchAchievements, markAchievementsSeen } from '../../api/journey';
import { subscribeAwarded } from '../../journey/tracker';
import { useToast } from '../Toast';

const NATIVE = Platform.OS !== 'web';
const SHARE_LINK = 'https://biblenestra.com';
const BALLOONS = [
  { x: -96, c: d.plum, d: 0 }, { x: -48, c: d.gold, d: 180 }, { x: 0, c: d.sage, d: 80 },
  { x: 48, c: d.rose, d: 260 }, { x: 96, c: d.lavender, d: 120 },
];
const CONFETTI = Array.from({ length: 22 }, (_, i) => ({ x: ((i * 37) % 300) - 150, c: [d.gold, '#E8C873', d.plum, '#FFD98A'][i % 4], d: (i * 73) % 900 }));

function Balloon({ x, color, delay, run }) {
  const rise = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!run) return undefined;
    const up = Animated.timing(rise, { toValue: 1, duration: 1400, delay, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    const swaying = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(sway, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
    ]));
    up.start(); swaying.start();
    return () => { up.stop(); swaying.stop(); };
  }, [run]);
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [260, -120] });
  const translateX = sway.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] });
  return (
    <Animated.View style={[st.balloonWrap, { left: '50%', marginLeft: x, transform: [{ translateY }, { translateX }] }]}>
      <View style={[st.balloon, { backgroundColor: color }]} />
      <View style={st.knot} />
      <View style={st.string} />
    </Animated.View>
  );
}

function Piece({ x, color, delay, run }) {
  const fall = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!run) return undefined;
    const a = Animated.timing(fall, { toValue: 1, duration: 1800, delay, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE });
    const b = Animated.timing(spin, { toValue: 1, duration: 1800, delay, easing: Easing.linear, useNativeDriver: NATIVE });
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [run]);
  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-220, 420] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '540deg'] });
  return (
    <Animated.View style={[st.confetti, { backgroundColor: color, left: '50%', marginLeft: x, transform: [{ translateY }, { rotate }] }]} />
  );
}

function Trophy({ run }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!run) return undefined;
    const a = Animated.spring(pop, { toValue: 1, friction: 4, tension: 80, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [run]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  return (
    <Animated.View style={[st.trophy, { transform: [{ scale }] }]}>
      <Grad colors={gradients.gold} style={st.trophyBadge}>
        <Icon name="star" size={40} color="#fff" />
      </Grad>
    </Animated.View>
  );
}

/** One celebration card. Exported for tests and previews. */
export function CelebrationCard({ item, onClose, onShareSocial, busy, run = true }) {
  return (
    <View style={st.overlay} accessibilityViewIsModal>
      <View style={st.field} pointerEvents="none">
        {BALLOONS.map((b, i) => <Balloon key={`b${i}`} x={b.x} color={b.c} delay={b.d} run={run} />)}
        {CONFETTI.map((c, i) => <Piece key={`c${i}`} x={c.x} color={c.c} delay={c.d} run={run} />)}
      </View>
      <View style={st.card}>
        <Trophy run={run} />
        <Text style={st.title}>{item.title || 'CONGRATULATIONS!'}</Text>
        <Text style={st.message}>{item.message}</Text>
        <Tap style={st.primary} onPress={() => onShareSocial && onShareSocial(item)} accessibilityLabel="Share to BibleNestra Socials" disabled={busy}>
          <Icon name="share" size={16} color="#fff" />
          <Text style={st.primaryText}>{busy ? 'Posting…' : 'Share to Socials'}</Text>
        </Tap>
        <Tap style={st.secondary} onPress={() => Linking.openURL(whatsappUrl(item)).catch(() => {})} accessibilityLabel="Share on WhatsApp">
          <Text style={st.secondaryText}>Share on WhatsApp</Text>
        </Tap>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={st.close} hitSlop={8}>
          <Text style={st.closeText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function whatsappUrl(item) {
  const text = `${item.title ? `${item.title} ` : ''}${item.message || ''} ${SHARE_LINK}`.trim();
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Mounted once at the app root. Shows unseen achievements, one at a time, and reacts to awards from syncs. */
export default function JourneyCelebrationHost() {
  const api = useApi();
  const toast = useToast();
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const seenIds = useRef(new Set());

  useEffect(() => {
    if (!api.online) return undefined;
    let alive = true;
    fetchAchievements(api).then((r) => {
      if (!alive || !r) return;
      const unseen = (r.items || []).filter((a) => !a.seen && !seenIds.current.has(a.id));
      if (unseen.length) setQueue((q) => [...q, ...unseen.filter((a) => !q.some((x) => x.id === a.id))]);
    }).catch(() => {});
    return () => { alive = false; };
  }, [api.online]);

  useEffect(() => subscribeAwarded((list) => {
    setQueue((q) => [...q, ...list.filter((a) => !q.some((x) => x.id === a.id) && !seenIds.current.has(a.id))]);
  }), []);

  const current = queue[0] || null;
  const close = async () => {
    if (!current) return;
    seenIds.current.add(current.id);
    setQueue((q) => q.slice(1));
    try { if (api.online && current.id) await markAchievementsSeen(api, [current.id]); } catch (e) { /* shown again next open */ }
  };
  const shareSocial = async (item) => {
    if (busy) return;
    if (!api.online) { toast.show('Connect to share to Socials', { icon: 'share' }); return; }
    setBusy(true);
    try {
      await api.request('POST', '/posts', { kind: 'Reflection', text: `${item.title ? `${item.title} ` : ''}${item.message} #ScriptureJourney`, category: 'Scripture journey' });
      toast.show('Shared to Socials', { icon: 'check', haptic: 'success' });
    } catch (e) {
      toast.show('Could not share right now', { icon: 'share' });
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={close} statusBarTranslucent>
      <CelebrationCard item={current} onClose={close} onShareSocial={shareSocial} busy={busy} />
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(40,26,17,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  field: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  balloonWrap: { position: 'absolute', top: 0, alignItems: 'center' },
  balloon: { width: 34, height: 42, borderRadius: 19, opacity: 0.95 },
  knot: { width: 6, height: 6, borderRadius: 3, backgroundColor: d.plumDark, marginTop: -2 },
  string: { width: 1, height: 40, backgroundColor: d.line },
  confetti: { position: 'absolute', top: 0, width: 9, height: 14, borderRadius: 2 },
  card: { width: '100%', maxWidth: 360, backgroundColor: d.paper, borderRadius: 26, padding: 26, alignItems: 'center', borderWidth: 1, borderColor: d.line },
  trophy: { marginBottom: 14 },
  trophyBadge: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: df.displayBold, fontSize: 24, color: d.ink, textAlign: 'center', letterSpacing: 0.5 },
  message: { fontFamily: df.sans, fontSize: 15, color: d.muted, textAlign: 'center', lineHeight: 22, marginTop: 8, marginBottom: 18 },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: d.plum, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 22, alignSelf: 'stretch', justifyContent: 'center' },
  primaryText: { fontFamily: df.sansSemi, color: '#fff', fontSize: 15 },
  secondary: { marginTop: 10, borderRadius: 999, paddingVertical: 12, alignSelf: 'stretch', alignItems: 'center', borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  secondaryText: { fontFamily: df.sansSemi, color: d.ink, fontSize: 14 },
  close: { marginTop: 14, paddingVertical: 6 },
  closeText: { fontFamily: df.sansMedium, color: d.muted, fontSize: 14 },
});
