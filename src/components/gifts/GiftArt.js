// Original gift artwork (react-native-svg) with gentle built-in motion (react-native Animated): a float, a soft
// breathing pulse and twinkling sparkles; premium gifts add a slowly turning halo. No third-party assets, no Lottie.
// An admin-uploaded image / animated GIF (gift.imageUrl / gift.animationUrl) replaces the drawing when present.
//   <GiftArt gift={{ art, tier, imageUrl?, animationUrl? }} size={64} animate />
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, Platform, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

const ND = Platform.OS !== 'web';
let uid = 0;

// ---------- drawings (viewBox 0 0 100 100) ----------
function Star({ id }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFE38A" /><Stop offset="1" stopColor="#E4A12B" /></LinearGradient>
      </Defs>
      <Path d="M50 8l11.8 25.6 27.9 3.3-20.6 19 5.6 27.6L50 69.6 25.3 83.5l5.6-27.6-20.6-19 27.9-3.3z" fill={`url(#${id}g)`} stroke="#C7861E" strokeWidth={2.5} strokeLinejoin="round" />
      <Path d="M50 20l7 15.3 14.7 1.8" stroke="#FFF6D6" strokeWidth={3.5} strokeLinecap="round" fill="none" opacity={0.8} />
      <Circle cx={42} cy={52} r={3} fill="#8A5A12" /><Circle cx={58} cy={52} r={3} fill="#8A5A12" />
      <Path d="M44 61q6 5 12 0" stroke="#8A5A12" strokeWidth={2.5} strokeLinecap="round" fill="none" />
    </>
  );
}
function Flowers({ id }) {
  const bloom = (cx, cy, c1, c2) => (
    <G>
      {[0, 72, 144, 216, 288].map((a) => {
        const r = (a * Math.PI) / 180;
        return <Circle key={a} cx={cx + Math.cos(r) * 8} cy={cy + Math.sin(r) * 8} r={7.5} fill={c1} />;
      })}
      <Circle cx={cx} cy={cy} r={5.5} fill={c2} />
    </G>
  );
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}w`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#F7E7C9" /><Stop offset="1" stopColor="#E2C48F" /></LinearGradient>
      </Defs>
      <Path d="M50 88L34 52M50 88l2-38M50 88l16-36" stroke="#3F8A4E" strokeWidth={3} strokeLinecap="round" />
      <Path d="M40 70q-10-4-12-12q9 1 13 9zM60 68q10-3 13-11q-9 0-14 8z" fill="#5BAE62" />
      {bloom(33, 40, '#F28CA5', '#FFD166')}
      {bloom(67, 38, '#B89BF2', '#FFE08A')}
      {bloom(51, 27, '#FF7A6B', '#FFE7A3')}
      <Path d="M30 64h40L58 94H42z" fill={`url(#${id}w)`} stroke="#C9A468" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M45 72q5 6 10 0" stroke="#D9567A" strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  );
}
function Heart({ id }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FF8AA6" /><Stop offset="1" stopColor="#D61F4D" /></LinearGradient>
      </Defs>
      <Path d="M50 86C22 66 10 52 10 35c0-12 9-21 20-21 8 0 15 4 20 12 5-8 12-12 20-12 11 0 20 9 20 21 0 17-12 31-40 51z" fill={`url(#${id}h)`} stroke="#B3173F" strokeWidth={2.5} />
      <Path d="M24 30q3-8 11-8" stroke="#FFFFFF" strokeWidth={4.5} strokeLinecap="round" fill="none" opacity={0.75} />
    </>
  );
}
function Teddy({ id }) {
  return (
    <>
      <Defs>
        <RadialGradient id={`${id}t`} cx="0.45" cy="0.4" r="0.7"><Stop offset="0" stopColor="#C98B52" /><Stop offset="1" stopColor="#8E5A2E" /></RadialGradient>
      </Defs>
      <Circle cx={28} cy={24} r={11} fill={`url(#${id}t)`} /><Circle cx={72} cy={24} r={11} fill={`url(#${id}t)`} />
      <Circle cx={28} cy={24} r={5.5} fill="#E8B98A" /><Circle cx={72} cy={24} r={5.5} fill="#E8B98A" />
      <Ellipse cx={50} cy={74} rx={26} ry={22} fill={`url(#${id}t)`} />
      <Ellipse cx={50} cy={78} rx={14} ry={12} fill="#E8B98A" />
      <Circle cx={50} cy={42} r={25} fill={`url(#${id}t)`} />
      <Ellipse cx={50} cy={50} rx={11} ry={8.5} fill="#F0CDA4" />
      <Ellipse cx={50} cy={46} rx={4.5} ry={3.2} fill="#3B2414" />
      <Path d="M50 49v4M45 54q5 4 10 0" stroke="#3B2414" strokeWidth={2} strokeLinecap="round" fill="none" />
      <Circle cx={40} cy={37} r={3.4} fill="#2A1A0E" /><Circle cx={60} cy={37} r={3.4} fill="#2A1A0E" />
      <Circle cx={41} cy={36} r={1} fill="#FFFFFF" /><Circle cx={61} cy={36} r={1} fill="#FFFFFF" />
      <Path d="M38 64l12 5 12-5-4 9 4 9-12-5-12 5 4-9z" fill="#E2466C" />
      <Circle cx={50} cy={69} r={3.5} fill="#B8264A" />
    </>
  );
}
function Letter({ id }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFF8EA" /><Stop offset="1" stopColor="#F1DFC0" /></LinearGradient>
      </Defs>
      <Rect x={10} y={26} width={80} height={54} rx={6} fill={`url(#${id}l)`} stroke="#C9A468" strokeWidth={2.5} />
      <Path d="M12 30l38 28 38-28" stroke="#C9A468" strokeWidth={2.5} fill="none" strokeLinejoin="round" />
      <Path d="M12 78l28-24M88 78L60 54" stroke="#DCC296" strokeWidth={2} />
      <Path d="M50 70c-9-6-13-10-13-15 0-4 3-6 6-6 3 0 5 2 7 4 2-2 4-4 7-4 3 0 6 2 6 6 0 5-4 9-13 15z" fill="#D9304F" stroke="#A91E3A" strokeWidth={1.5} />
    </>
  );
}
function Diamond({ id }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}d`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#C9F4FF" /><Stop offset="1" stopColor="#3AA6D9" /></LinearGradient>
      </Defs>
      <Polygon points="28,22 72,22 90,42 50,90 10,42" fill={`url(#${id}d)`} stroke="#2582B3" strokeWidth={2.5} strokeLinejoin="round" />
      <Polygon points="28,22 40,42 10,42" fill="#E8FBFF" opacity={0.85} />
      <Polygon points="72,22 60,42 90,42" fill="#7FD1EE" opacity={0.9} />
      <Polygon points="40,42 60,42 50,90" fill="#5BC0E6" opacity={0.9} />
      <Path d="M28 22l12 20h20l12-20M10 42h80M40 42l10 48 10-48M50 22v20" stroke="#2582B3" strokeWidth={1.6} fill="none" strokeLinejoin="round" />
      <Path d="M33 28l5 8" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" />
    </>
  );
}
function Crown({ id }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFE58F" /><Stop offset="1" stopColor="#D49A1E" /></LinearGradient>
      </Defs>
      <Path d="M14 34l18 18 18-30 18 30 18-18-8 44H22z" fill={`url(#${id}c)`} stroke="#A9741A" strokeWidth={2.5} strokeLinejoin="round" />
      <Rect x={20} y={74} width={60} height={11} rx={3} fill="#E2AC32" stroke="#A9741A" strokeWidth={2.5} />
      <Circle cx={14} cy={33} r={5} fill="#FFE58F" stroke="#A9741A" strokeWidth={2} /><Circle cx={86} cy={33} r={5} fill="#FFE58F" stroke="#A9741A" strokeWidth={2} />
      <Circle cx={50} cy={20} r={5.5} fill="#FFE58F" stroke="#A9741A" strokeWidth={2} />
      <Circle cx={50} cy={60} r={6} fill="#D9304F" /><Circle cx={32} cy={64} r={4.5} fill="#3AA6D9" /><Circle cx={68} cy={64} r={4.5} fill="#3FAE6A" />
      <Path d="M28 46q22-10 44 0" stroke="#FFF4C9" strokeWidth={2.5} fill="none" opacity={0.7} strokeLinecap="round" />
    </>
  );
}
function Trophy({ id }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#E9B23A" /><Stop offset="0.45" stopColor="#FFE9A3" /><Stop offset="1" stopColor="#C88C1C" /></LinearGradient>
      </Defs>
      <Path d="M28 20H14v8c0 12 8 20 18 21M72 20h14v8c0 12-8 20-18 21" stroke="#C88C1C" strokeWidth={5} fill="none" strokeLinecap="round" />
      <Path d="M26 14h48v16c0 16-11 28-24 28S26 46 26 30z" fill={`url(#${id}t)`} stroke="#A9741A" strokeWidth={2.5} />
      <Rect x={44} y={56} width={12} height={14} fill="#D9A02E" />
      <Path d="M34 70h32l4 10H30z" fill={`url(#${id}t)`} stroke="#A9741A" strokeWidth={2.5} strokeLinejoin="round" />
      <Rect x={26} y={80} width={48} height={9} rx={2.5} fill="#7A4E1C" />
      <Path d="M50 22l3.2 6.6 7.2.9-5.3 5 1.4 7.1L50 38.1l-6.5 3.5 1.4-7.1-5.3-5 7.2-.9z" fill="#FFF6D6" />
    </>
  );
}
function Celebration({ id }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#8E7BEF" /><Stop offset="1" stopColor="#5A45C9" /></LinearGradient>
      </Defs>
      <Rect x={20} y={46} width={60} height={42} rx={5} fill={`url(#${id}b)`} />
      <Rect x={16} y={36} width={68} height={14} rx={4} fill="#7B67E6" />
      <Rect x={45} y={36} width={10} height={52} fill="#FFD166" />
      <Path d="M50 36c-10-14-24-12-22-3 2 6 14 5 22 3zM50 36c10-14 24-12 22-3-2 6-14 5-22 3z" fill="#FFD166" stroke="#E0A92C" strokeWidth={1.5} />
      {[[18, 18, '#FF7A6B'], [82, 16, '#3FAE6A'], [30, 8, '#3AA6D9'], [70, 6, '#F28CA5'], [90, 34, '#FFD166'], [8, 32, '#B89BF2']].map(([x, y, c], i) => (
        <Rect key={i} x={x} y={y} width={5} height={9} rx={1.5} fill={c} transform={`rotate(${i * 37} ${x} ${y})`} />
      ))}
    </>
  );
}
function Premium({ id }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <>
      <Defs>
        <RadialGradient id={`${id}p`} cx="0.5" cy="0.45" r="0.6"><Stop offset="0" stopColor="#FFF2C2" /><Stop offset="0.55" stopColor="#F2B93B" /><Stop offset="1" stopColor="#9C4FD6" /></RadialGradient>
        <LinearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFFFFF" /><Stop offset="1" stopColor="#FFE08A" /></LinearGradient>
      </Defs>
      {rays.map((a) => <Path key={a} d="M50 50L46 4h8z" fill="#FFD66B" opacity={0.55} transform={`rotate(${a} 50 50)`} />)}
      <Circle cx={50} cy={50} r={30} fill={`url(#${id}p)`} stroke="#FFF2C2" strokeWidth={2.5} />
      <Path d="M50 28l5.6 14.4L70 44l-11 9.6 3.4 14.4L50 60.4 37.6 68l3.4-14.4L30 44l14.4-1.6z" fill={`url(#${id}s)`} stroke="#C7861E" strokeWidth={1.8} strokeLinejoin="round" />
      <Circle cx={50} cy={50} r={38} fill="none" stroke="#FFE08A" strokeWidth={1.5} strokeDasharray="3 5" />
    </>
  );
}
const ART = { star: Star, flowers: Flowers, heart: Heart, teddy: Teddy, letter: Letter, diamond: Diamond, crown: Crown, trophy: Trophy, celebration: Celebration, premium: Premium };
export const GIFT_TINT = { star: '#E4A12B', flowers: '#E5678A', heart: '#D61F4D', teddy: '#8E5A2E', letter: '#D9304F', diamond: '#2582B3', crown: '#D49A1E', trophy: '#C88C1C', celebration: '#6A55D9', premium: '#9C4FD6' };

/** The still drawing (no motion). */
export function GiftDrawing({ art = 'star', size = 64 }) {
  const id = useMemo(() => `ga${++uid}`, []);
  const A = ART[art] || Star;
  return <Svg width={size} height={size} viewBox="0 0 100 100"><A id={id} /></Svg>;
}

function useLoop(active, duration, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { v.setValue(0); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active]);
  return v;
}
function useSpin(active, duration) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return undefined;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: ND }));
    loop.start();
    return () => loop.stop();
  }, [active]);
  return v;
}
function Twinkle({ x, y, s, delay, color }) {
  const v = useLoop(true, 700, delay);
  return (
    <Animated.Text style={{ position: 'absolute', left: x, top: y, fontSize: s, color, opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.1] }) }] }}>✦</Animated.Text>
  );
}

/**
 * <GiftArt gift={{ art, tier, imageUrl?, animationUrl? }} size animate />
 * animate=false draws it still (lists with many items, reduced motion).
 */
export function GiftArt({ gift, art: artIn, size = 64, animate = true, style }) {
  const g = gift || {};
  const art = artIn || g.art || 'star';
  const premium = g.tier === 'premium';
  const float = useLoop(animate, 1300);
  const halo = useSpin(animate && premium, 9000);
  const uri = (animate && g.animationUrl) || g.imageUrl || g.animationUrl || null;
  const tint = GIFT_TINT[art] || '#D4A852';
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]} accessibilityLabel={g.name ? `${g.name} gift` : 'Gift'}>
      {premium && animate ? (
        <Animated.View style={{ position: 'absolute', width: s, height: s, borderRadius: s / 2, borderWidth: Math.max(1.5, s / 40), borderColor: tint, borderStyle: 'dashed', opacity: 0.55, transform: [{ rotate: halo.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />
      ) : null}
      <Animated.View style={{ transform: [
        { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -s * 0.05] }) },
        { scale: float.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] }) },
      ] }}>
        {uri ? <Image source={{ uri }} style={{ width: s * 0.86, height: s * 0.86 }} resizeMode="contain" /> : <GiftDrawing art={art} size={s * 0.86} />}
      </Animated.View>
      {animate && s >= 44 ? (
        <>
          <Twinkle x={s * 0.02} y={s * 0.06} s={Math.max(8, s * 0.16)} delay={0} color={tint} />
          <Twinkle x={s * 0.8} y={s * 0.16} s={Math.max(7, s * 0.13)} delay={350} color="#FFD66B" />
          {premium ? <Twinkle x={s * 0.72} y={s * 0.74} s={Math.max(7, s * 0.14)} delay={600} color={tint} /> : null}
        </>
      ) : null}
    </View>
  );
}
