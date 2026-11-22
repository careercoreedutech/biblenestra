// FIND LOVE illustrations — drawn with react-native-svg (no image assets): soft glows, a gold filigree divider,
// the verified seal, a crown, and the empty / error / locked art used across the Find Love screens.
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient as SvgLinear, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { love } from './theme';

let gid = 0;
const useId = (p) => React.useMemo(() => `${p}${++gid}`, [p]);

/** Soft radial glow (absolute-position it behind things). */
export function Glow({ size = 240, color = love.rose, opacity = 0.45, style }) {
  const id = useId('glow');
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="0.55" stopColor={color} stopOpacity={opacity * 0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A faint scatter of tiny dots — the "grain" on hero surfaces. Deterministic, cheap (one Svg). */
export function Grain({ width = 360, height = 200, color = '#FFFFFF', opacity = 0.06, count = 70 }) {
  const dots = React.useMemo(() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    return Array.from({ length: count }, () => [rnd() * width, rnd() * height, 0.5 + rnd() * 1.1]);
  }, [width, height, count]);
  return (
    <Svg pointerEvents="none" width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
      {dots.map(([x, y, r], i) => <Circle key={i} cx={x} cy={y} r={r} fill={color} opacity={opacity * (i % 3 ? 1 : 1.8)} />)}
    </Svg>
  );
}

/** Gold filigree divider: hairlines that curl into a small heart. */
export function Filigree({ width = 180, color = love.gold, style }) {
  const h = 18; const c = width / 2;
  return (
    <View style={[{ alignItems: 'center' }, style]} pointerEvents="none">
      <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
        <Path d={`M4 9 H${c - 26}`} stroke={color} strokeWidth={1} strokeLinecap="round" opacity={0.7} />
        <Path d={`M${c + 26} 9 H${width - 4}`} stroke={color} strokeWidth={1} strokeLinecap="round" opacity={0.7} />
        <Path d={`M${c - 26} 9 c4 0 6 -5 10 -5 c3 0 4 3 2 4.5`} stroke={color} strokeWidth={1.1} fill="none" strokeLinecap="round" />
        <Path d={`M${c + 26} 9 c-4 0 -6 -5 -10 -5 c-3 0 -4 3 -2 4.5`} stroke={color} strokeWidth={1.1} fill="none" strokeLinecap="round" />
        <Path d={`M${c} 14.5 c-3.8 -2.4 -6 -4.4 -6 -6.8 a3 3 0 0 1 6 -0.9 a3 3 0 0 1 6 0.9 c0 2.4 -2.2 4.4 -6 6.8z`} fill={color} />
        <Circle cx={c - 14} cy={9} r={1.2} fill={color} />
        <Circle cx={c + 14} cy={9} r={1.2} fill={color} />
      </Svg>
    </View>
  );
}

// scalloped rosette path, computed once per size
function rosette(r, bumps = 12, depth = 0.11) {
  const pts = [];
  for (let i = 0; i <= bumps * 2; i++) {
    const a = (i / (bumps * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * (1 - depth) : r;
    pts.push([r + Math.cos(a) * rr, r + Math.sin(a) * rr]);
  }
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i += 2) {
    const [cx, cy] = pts[i]; const [x, y] = pts[i + 1] || pts[0];
    d += ` Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}
const ROSETTES = {};

/** The verified seal: a blue rosette with a white check (the "blue tick"). */
export function VerifiedSeal({ size = 18, color = '#3B7BC4', ring = '#FFFFFF' }) {
  const r = size / 2;
  const d = ROSETTES[size] || (ROSETTES[size] = rosette(r));
  return (
    <View accessible accessibilityLabel="Verified" style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Path d={d} fill={color} stroke={ring} strokeWidth={size > 20 ? 1.4 : 1} />
        <Path d={`M${size * 0.3} ${size * 0.52} L${size * 0.44} ${size * 0.65} L${size * 0.71} ${size * 0.37}`} stroke="#FFFFFF" strokeWidth={size * 0.11} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

export function Crown({ size = 18, color = love.goldBright }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3.5 8.2l4.4 3.6L12 5l4.1 6.8 4.4-3.6-1.7 9.3H5.2L3.5 8.2z" fill={color} />
      <Rect x={5.2} y={18.6} width={13.6} height={2} rx={1} fill={color} />
      <Circle cx={12} cy={4.2} r={1.4} fill={color} />
      <Circle cx={3.4} cy={7.6} r={1.2} fill={color} />
      <Circle cx={20.6} cy={7.6} r={1.2} fill={color} />
    </Svg>
  );
}

/** A filled heart (used for gradient hearts, particles and glows). */
export function HeartShape({ size = 24, color = love.rose, stroke, strokeWidth = 1.6, opacity = 1 }) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 20.4s-8-4.8-8-10.9A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8 2.8c0 6.1-8 10.9-8 10.9z" fill={stroke ? 'none' : color} stroke={stroke || 'none'} strokeWidth={strokeWidth} strokeLinejoin="round" opacity={opacity} />
      </Svg>
    </View>
  );
}

export function Sparkle({ size = 14, color = love.goldBright }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 2c.6 4.6 2.4 7.4 10 10-7.6 2.6-9.4 5.4-10 10-.6-4.6-2.4-7.4-10-10 7.6-2.6 9.4-5.4 10-10z" fill={color} />
    </Svg>
  );
}

const ART = {
  // stacked card outlines with a glowing heart: "you're all caught up"
  stack: (id) => (
    <>
      <Defs>
        <RadialGradient id={`${id}g`} cx="50%" cy="52%" r="50%">
          <Stop offset="0" stopColor={love.roseSoft} stopOpacity={0.55} />
          <Stop offset="1" stopColor={love.roseSoft} stopOpacity={0} />
        </RadialGradient>
        <SvgLinear id={`${id}h`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#D35C75" />
          <Stop offset="1" stopColor="#9C2C48" />
        </SvgLinear>
      </Defs>
      <Circle cx={80} cy={78} r={74} fill={`url(#${id}g)`} />
      <G transform="rotate(-10 80 80)"><Rect x={42} y={26} width={76} height={100} rx={14} fill="#FFFFFF" stroke={love.blushLine} strokeWidth={1.5} /></G>
      <G transform="rotate(7 80 80)"><Rect x={42} y={26} width={76} height={100} rx={14} fill="#FFFFFF" stroke={love.blushLine} strokeWidth={1.5} /></G>
      <Rect x={42} y={24} width={76} height={100} rx={14} fill={love.blush} stroke={love.roseSoft} strokeWidth={1.5} />
      <Path d="M80 98s-19-11.4-19-25.8A10.9 10.9 0 0 1 80 65.6a10.9 10.9 0 0 1 19 6.6C99 86.6 80 98 80 98z" fill="none" stroke={`url(#${id}h)`} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M112 30l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill={love.goldBright} />
      <Path d="M40 118l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1z" fill={love.goldBright} />
    </>
  ),
  // two hearts waiting: "no likes yet"
  hearts: (id) => (
    <>
      <Defs>
        <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={love.goldPale} stopOpacity={0.9} />
          <Stop offset="1" stopColor={love.goldPale} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={80} cy={78} r={72} fill={`url(#${id}g)`} />
      <Path d="M64 108s-24-14.4-24-32.6A13.8 13.8 0 0 1 64 67a13.8 13.8 0 0 1 24 8.4" fill="none" stroke={love.roseSoft} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M96 116s-22-13.2-22-29.9A12.6 12.6 0 0 1 96 78.4a12.6 12.6 0 0 1 22 7.7C118 102.8 96 116 96 116z" fill={love.rose} opacity={0.9} />
      <Path d="M58 40l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill={love.goldBright} />
      <Path d="M118 52l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1z" fill={love.goldBright} />
    </>
  ),
  // two speech bubbles with a small heart: "no matches yet"
  chat: (id) => (
    <>
      <Defs>
        <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={love.roseSoft} stopOpacity={0.45} />
          <Stop offset="1" stopColor={love.roseSoft} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={80} cy={78} r={72} fill={`url(#${id}g)`} />
      <Path d="M30 52a14 14 0 0 1 14-14h46a14 14 0 0 1 14 14v22a14 14 0 0 1-14 14H56l-14 12v-12h0a14 14 0 0 1-12-14z" fill="#FFFFFF" stroke={love.blushLine} strokeWidth={1.5} />
      <Path d="M130 82a12 12 0 0 0-12-12H80a12 12 0 0 0-12 12v18a12 12 0 0 0 12 12h30l12 10v-10a12 12 0 0 0 8-12z" fill={love.wine} />
      <Path d="M99 101s-8-4.8-8-10.9a4.6 4.6 0 0 1 8-2.8 4.6 4.6 0 0 1 8 2.8C107 96.2 99 101 99 101z" fill={love.goldBright} />
      <Path d="M48 60h36M48 68h24" stroke={love.blushLine} strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  // a dove-grey heart with a gentle break line: "didn't load"
  error: (id) => (
    <>
      <Defs>
        <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={love.blushDeep} stopOpacity={0.9} />
          <Stop offset="1" stopColor={love.blushDeep} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={80} cy={78} r={72} fill={`url(#${id}g)`} />
      <Path d="M80 118s-30-18-30-40.8A17.2 17.2 0 0 1 80 66.6a17.2 17.2 0 0 1 30 10.6C110 100 80 118 80 118z" fill="#FFFFFF" stroke={love.roseSoft} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M80 68l-6 14 9 6-6 13" fill="none" stroke={love.rose} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4" />
      <Path d="M116 44l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill={love.goldBright} />
    </>
  ),
  // a shield with a heart: safety / review
  shield: (id) => (
    <>
      <Defs>
        <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={love.goldPale} stopOpacity={0.9} />
          <Stop offset="1" stopColor={love.goldPale} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={80} cy={78} r={72} fill={`url(#${id}g)`} />
      <Path d="M80 30l36 14v26c0 22-15 40-36 48-21-8-36-26-36-48V44z" fill="#FFFFFF" stroke={love.gold} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M80 92s-14-8.4-14-19a8 8 0 0 1 14-4.9 8 8 0 0 1 14 4.9C94 83.6 80 92 80 92z" fill={love.rose} />
    </>
  ),
};

/** Empty / error / locked art (160 × 150). kind: 'stack' | 'hearts' | 'chat' | 'error' | 'shield' */
export function LoveArt({ kind = 'stack', size = 150 }) {
  const id = useId(`art${kind}`);
  return (
    <Svg width={size * (160 / 150)} height={size} viewBox="0 0 160 150">
      {(ART[kind] || ART.stack)(id)}
    </Svg>
  );
}

/** A circle progress ring (the boost countdown). progress 0…1 */
export function Ring({ size = 120, stroke = 8, progress = 0, color = love.goldBright, track = 'rgba(255,255,255,0.16)', children }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children}
    </View>
  );
}
