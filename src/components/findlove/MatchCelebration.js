// FIND LOVE match moment: full-screen plum celebration — both photos in gold-ringed circles, a glowing heart between
// them, hearts and sparkles drifting up (plain Animated, native driver), a serif "It's a match" and a scripture line.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts } from '../../theme';
import { love, grad, ND, haptic } from './theme';
import { Glow, HeartShape, Sparkle, Filigree, Grain } from './illustrations';
import { Avatar, LoveButton } from './parts';

function Particles({ w, h, run }) {
  const items = useMemo(() => Array.from({ length: 18 }, (_, k) => ({
    x: ((k * 37) % 100) / 100 * w, size: 10 + ((k * 13) % 14), delay: (k % 9) * 260, dur: 3400 + ((k * 53) % 1800),
    drift: ((k % 2 ? 1 : -1) * (16 + ((k * 7) % 26))), heart: k % 3 !== 0, color: k % 4 === 0 ? love.goldBright : k % 4 === 1 ? love.roseSoft : k % 4 === 2 ? '#FFFFFF' : love.roseBright,
  })), [w]);
  const vals = useRef(items.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!run) return undefined;
    const loops = vals.map((v, k) => Animated.loop(Animated.sequence([
      Animated.delay(items[k].delay),
      Animated.timing(v, { toValue: 1, duration: items[k].dur, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: ND }),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [run]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {items.map((p, k) => (
        <Animated.View key={k} style={{
          position: 'absolute', left: p.x, top: h * 0.92,
          opacity: vals[k].interpolate({ inputRange: [0, 0.12, 0.7, 1], outputRange: [0, 0.95, 0.7, 0] }),
          transform: [
            { translateY: vals[k].interpolate({ inputRange: [0, 1], outputRange: [0, -h * 0.85] }) },
            { translateX: vals[k].interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.drift, p.drift * 0.3] }) },
            { rotate: vals[k].interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.drift}deg`] }) },
          ],
        }}>
          {p.heart ? <HeartShape size={p.size} color={p.color} /> : <Sparkle size={p.size * 0.9} color={p.color} />}
        </Animated.View>
      ))}
    </View>
  );
}

/** match: { card, conversationId } | null */
export function MatchCelebration({ match, me, onChat, onClose }) {
  const { width: w, height: h } = useWindowDimensions();
  const [shown, setShown] = useState(null);
  const a = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (match) {
      setShown(match);
      a.setValue(0); pop.setValue(0);
      haptic('success');
      Animated.timing(a, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
      Animated.spring(pop, { toValue: 1, delay: 140, useNativeDriver: ND, speed: 7, bounciness: 12 }).start();
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
        Animated.timing(beat, { toValue: 0, duration: 680, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      ]));
      loop.start();
      return () => loop.stop();
    }
    if (shown) Animated.timing(a, { toValue: 0, duration: 200, useNativeDriver: ND }).start(() => setShown(null));
    return undefined;
  }, [match]);
  if (!shown) return null;
  const m = shown;
  const P = Math.min(132, w * 0.32);
  const slideL = pop.interpolate({ inputRange: [0, 1], outputRange: [-w * 0.5, 0] });
  const slideR = pop.interpolate({ inputRange: [0, 1], outputRange: [w * 0.5, 0] });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: a }]} accessibilityViewIsModal>
        <LinearGradient colors={['#4A1326', '#2A0E1C', '#160710']} style={StyleSheet.absoluteFill} />
        <Grain width={w} height={h} opacity={0.07} count={120} />
        <Glow size={w * 1.3} color={love.roseBright} opacity={0.4} style={{ top: h * 0.12, left: -w * 0.15 }} />
        <Glow size={w * 0.9} color={love.goldBright} opacity={0.18} style={{ top: -w * 0.3, right: -w * 0.3 }} />
        <Particles w={w} h={h} run={!!match} />
        <ScrollView contentContainerStyle={s.wrap} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ alignItems: 'center', opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
            <Text style={s.eyebrow}>Find Love</Text>
            <Text style={s.title} accessibilityRole="header">It’s a match</Text>
            <Text style={s.sub}>You and {m.card.firstName} like each other</Text>
          </Animated.View>

          <View style={[s.photos, { height: P + 30 }]}>
            <Animated.View style={{ transform: [{ translateX: slideL }, { rotate: '-7deg' }] }}>
              <GoldFrame uri={me && me.photos && me.photos[0] ? me.photos[0].url : null} size={P} />
            </Animated.View>
            <Animated.View style={{ marginLeft: -P * 0.2, transform: [{ translateX: slideR }, { rotate: '7deg' }] }}>
              <GoldFrame uri={m.card.photos && m.card.photos[0] ? m.card.photos[0].url : null} size={P} />
            </Animated.View>
            <Animated.View style={[s.heart, { transform: [{ scale: Animated.multiply(pop, beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] })) }] }]}>
              <Glow size={120} color={love.roseBright} opacity={0.75} style={{ left: -32, top: -32 }} />
              <LinearGradient colors={grad.heart} style={s.heartDisc}>
                <HeartShape size={28} color="#FFFFFF" />
              </LinearGradient>
            </Animated.View>
          </View>

          <Filigree width={200} color={love.goldBright} style={{ marginTop: 22 }} />
          <Text style={s.verse}>“Two are better than one… if either of them falls down, one can help the other up.”</Text>
          <Text style={s.ref}>Ecclesiastes 4:9–10</Text>
          <Text style={s.body}>Take it slow, pray, and keep your first conversations on BibleNestra. Never send money to someone you haven’t met.</Text>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 22 }}>
            <LoveButton label={`Send ${m.card.firstName} a message`} icon="chat" onPress={onChat} kind="gold" />
            <LoveButton label="Keep discovering" onPress={onClose} kind="glass" />
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function GoldFrame({ uri, size }) {
  return (
    <LinearGradient colors={grad.gold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size + 10, height: size + 10, borderRadius: (size + 10) / 2, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size + 4, height: size + 4, borderRadius: (size + 4) / 2, backgroundColor: love.plum, alignItems: 'center', justifyContent: 'center' }}>
        <Avatar uri={uri} size={size} />
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 48 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 2.4, color: love.goldBright, textTransform: 'uppercase' },
  title: { fontFamily: fonts.serifBoldItalic, fontSize: 52, color: love.onDark, textAlign: 'center', marginTop: 6, letterSpacing: -1 },
  sub: { fontFamily: fonts.serif, fontSize: 18, color: love.onDarkMuted, textAlign: 'center', marginTop: 4 },
  photos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 26 },
  heart: { position: 'absolute', bottom: -6, alignSelf: 'center', width: 56, height: 56 },
  heartDisc: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: love.goldBright },
  verse: { fontFamily: fonts.serifItalic, fontSize: 19, lineHeight: 27, color: love.onDark, textAlign: 'center', marginTop: 14 },
  ref: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.6, color: love.goldBright, textTransform: 'uppercase', marginTop: 6 },
  body: { fontSize: 13.5, lineHeight: 20, color: love.onDarkMuted, textAlign: 'center', marginTop: 16 },
  ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.3)' },
});
