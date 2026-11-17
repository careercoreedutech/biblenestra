// Image-style text posts: designed backgrounds (colours, gradients, patterns, scripture frames), the
// auto-fitting card used in the feed + composer preview, palette swatches, and a share-as-image sheet.
//
// A design is stored on the post as `bg` (local mode) / `theme` (API) — "<key>.<font>.<align>",
// e.g. "dawn.italic.center". Older posts carry a plain "#RRGGBB" colour, which still renders.
// Keep DESIGNS / FONTS / ALIGNS keys in sync with backend/src/lib/postDesign.js (server allow-list).
import React, { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radius, shadow } from '../../theme';
import { Icon } from '../Icons';
import { AnimatedModal } from '../Motion';

let captureRef = null;
let Sharing = null;
try { captureRef = require('react-native-view-shot').captureRef; } catch (e) { captureRef = null; }
try { Sharing = require('expo-sharing'); } catch (e) { Sharing = null; }

export const CARD_MAX_CHARS = 280; // longer text is posted as a normal text post
const MAX_CARD_W = 560; // cards never grow past this (desktop feed is full width)

// ─── Designs ──────────────────────────────────────────────────────
// fg = text colour, accent = quote mark / reference / frame, shade = extra dark veil for contrast.
export const DESIGNS = [
  // Solid colours
  { key: 'midnight', label: 'Midnight', group: 'Colours', color: '#15172B', fg: '#F4EFE6', accent: '#D4A852' },
  { key: 'royal', label: 'Royal', group: 'Colours', color: '#232C6B', fg: '#FFFFFF', accent: '#E9D9A6' },
  { key: 'teal', label: 'Teal', group: 'Colours', color: '#2C7672', fg: '#FFFFFF', accent: '#F3DFA2' },
  { key: 'lavender', label: 'Lavender', group: 'Colours', color: '#6B52A3', fg: '#FFFFFF', accent: '#F1E3B8' },
  { key: 'charcoal', label: 'Charcoal', group: 'Colours', color: '#2B2B2E', fg: '#F5F2EC', accent: '#D4A852' },
  { key: 'wine', label: 'Wine', group: 'Colours', color: '#6E1E35', fg: '#FFF4EE', accent: '#F2C9A0' },
  // Gradients
  { key: 'dawn', label: 'Dawn', group: 'Gradients', colors: ['#F2B88E', '#D9796B', '#6E4384'], fg: '#FFFFFF', accent: '#FFF1D6', shade: 0.14 },
  { key: 'sea', label: 'Sea', group: 'Gradients', colors: ['#5F95BC', '#2F6593', '#1B3654'], fg: '#FFFFFF', accent: '#CFE5F5', shade: 0.08 },
  { key: 'olive', label: 'Olive', group: 'Gradients', colors: ['#7E9A73', '#4E6B52', '#2E4436'], fg: '#F5F1E6', accent: '#E9D9A6', shade: 0.06 },
  { key: 'rose', label: 'Rose', group: 'Gradients', colors: ['#DFA3A0', '#B5677A', '#6E3550'], fg: '#FFFFFF', accent: '#FCE7DF', shade: 0.14 },
  { key: 'sunset', label: 'Sunset', group: 'Gradients', colors: ['#EFA45A', '#DE6E4F', '#8E2A55'], fg: '#FFFFFF', accent: '#FFF0D9', shade: 0.18 },
  { key: 'glory', label: 'Glory', group: 'Gradients', colors: ['#2B1D06', '#6B4A12', '#A87A2C'], fg: '#FFF7E6', accent: '#F3D58C' },
  { key: 'meadow', label: 'Meadow', group: 'Gradients', colors: ['#93B573', '#567F52', '#2C4D30'], fg: '#FFFFFF', accent: '#F4EDC9', shade: 0.14 },
  { key: 'dusk', label: 'Dusk', group: 'Gradients', colors: ['#2F2660', '#6E4685', '#C97C73'], fg: '#FFFFFF', accent: '#FFE4C7', shade: 0.1 },
  // Designed backgrounds (patterns + scripture frames)
  { key: 'starlight', label: 'Starlight', group: 'Designs', colors: ['#1E2354', '#11132E', '#090A1A'], fg: '#F4EFE6', accent: '#E3BE6B', pattern: 'stars' },
  { key: 'parchment', label: 'Parchment', group: 'Designs', colors: ['#FCF8F0', '#F3EBDA', '#E9DCC1'], fg: '#2A251E', accent: '#9C6F22', frame: 'scripture', light: true },
  { key: 'scroll', label: 'Scroll', group: 'Designs', colors: ['#F3E4C4', '#E6CF9F', '#D7B97E'], fg: '#3B2A14', accent: '#7E5219', frame: 'double', pattern: 'grain', light: true },
  { key: 'linen', label: 'Linen', group: 'Designs', colors: ['#F8F5EE', '#EEE8DA'], fg: '#1F2B4A', accent: '#2E3A87', pattern: 'grid', light: true },
  { key: 'rays', label: 'Glory rays', group: 'Designs', colors: ['#E39A39', '#BD5E2B', '#6A2619'], fg: '#FFFFFF', accent: '#FFE7B8', pattern: 'rays', shade: 0.2 },
  { key: 'waves', label: 'Living water', group: 'Designs', colors: ['#2A67A8', '#1A3E72', '#0E2244'], fg: '#FFFFFF', accent: '#BFE3FF', pattern: 'waves' },
  { key: 'cross', label: 'The Cross', group: 'Designs', colors: ['#2E1D45', '#1A1029', '#0D0815'], fg: '#F4EFE6', accent: '#D4A852', pattern: 'cross' },
  { key: 'psalm', label: 'Psalm', group: 'Designs', colors: ['#EEF4EF', '#D5E5DA'], fg: '#1E3A2B', accent: '#4A7659', frame: 'arch', light: true },
];
const BY_KEY = Object.fromEntries(DESIGNS.map((d) => [d.key, d]));
export const DESIGN_GROUPS = ['Colours', 'Gradients', 'Designs'];

export const FONTS = [
  { key: 'italic', label: 'Italic', family: fonts.serifItalic, w: 0.45 },
  { key: 'classic', label: 'Classic', family: fonts.serif, w: 0.48 },
  { key: 'bold', label: 'Bold', family: fonts.serifBold, w: 0.5 },
  { key: 'garamond', label: 'Garamond', family: 'EBGaramond', w: 0.44 },
  { key: 'modern', label: 'Modern', family: 'Inter', w: 0.53 },
];
const FONT_BY_KEY = Object.fromEntries(FONTS.map((f) => [f.key, f]));
export const ALIGNS = ['center', 'left'];

// Colours offered by older builds → the matching design
const LEGACY = { '#15172b': 'midnight', '#232c6b': 'royal', '#2c7672': 'teal', '#6b52a3': 'lavender', '#20233d': 'midnight' };

export const encodeDesign = ({ key, font = 'italic', align = 'center' }) => `${key}.${font}.${align}`;

/** theme / bg value → { design, font, align } (always renderable) or null for a plain post */
export function resolveDesign(theme) {
  if (!theme) return null;
  if (typeof theme === 'object' && theme.key) theme = encodeDesign(theme);
  const s = String(theme).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) {
    const k = LEGACY[s.toLowerCase()];
    if (k) return { design: BY_KEY[k], font: FONT_BY_KEY.italic, align: 'center' };
    return { design: { key: 'custom', label: 'Colour', color: s, fg: '#FFFFFF', accent: '#F3DFA2', shade: 0.12 }, font: FONT_BY_KEY.italic, align: 'center' };
  }
  const [key, font, align] = s.split('.');
  const design = BY_KEY[key];
  if (!design) return { design: BY_KEY.midnight, font: FONT_BY_KEY.italic, align: 'center' }; // unknown future key
  return { design, font: FONT_BY_KEY[font] || FONT_BY_KEY.italic, align: ALIGNS.includes(align) ? align : 'center' };
}

/** "#15172B" (old composer presets) or "dawn" → { key, font, align } for the composer's state */
export function designStateFrom(theme) {
  const r = resolveDesign(theme);
  if (!r || r.design.key === 'custom') return null;
  return { key: r.design.key, font: r.font.key, align: r.align };
}

// ─── Text fitting ─────────────────────────────────────────────────
// Greedy word-wrap estimate with average glyph widths — fast, deterministic, no measuring pass.
function linesFor(text, size, widthPx, factor) {
  const charW = size * factor;
  const perLine = Math.max(4, Math.floor(widthPx / charW));
  let lines = 0;
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines += 1; continue; }
    let cur = 0;
    lines += 1;
    for (const w of words) {
      const len = w.length;
      if (cur === 0) cur = len;
      else if (cur + 1 + len <= perLine) cur += 1 + len;
      else { lines += 1; cur = len; }
      while (cur > perLine) { lines += 1; cur -= perLine; } // very long word
    }
  }
  return lines;
}

export function fitFontSize(text, boxW, boxH, font = FONT_BY_KEY.italic) {
  const max = Math.max(16, Math.min(46, Math.round(boxW * 0.11)));
  const min = 12;
  for (let size = max; size >= min; size -= 1) {
    const lh = Math.round(size * 1.32);
    if (linesFor(text, size, boxW, font.w) * lh <= boxH * 0.94) return { size, lh };
  }
  return { size: min, lh: Math.round(min * 1.32) };
}

// ─── Background art ───────────────────────────────────────────────
function seeded(n) {
  let s = n;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function Pattern({ d, w, h }) {
  const fg = d.light ? d.fg : '#FFFFFF';
  const out = [];
  if (d.pattern === 'stars') {
    const r = seeded(7);
    const n = Math.round((w * h) / 2600);
    for (let i = 0; i < n; i++) {
      const big = r() > 0.9;
      out.push(<Circle key={i} cx={r() * w} cy={r() * h} r={big ? 1.6 : 0.6 + r() * 0.7} fill={big ? d.accent : fg} opacity={big ? 0.7 : 0.25 + r() * 0.4} />);
    }
    const sx = w * 0.82; const sy = h * 0.16; const s = Math.max(6, w * 0.022);
    out.push(<Path key="star" d={`M${sx} ${sy - s * 2}L${sx + s * 0.35} ${sy - s * 0.35}L${sx + s * 2} ${sy}L${sx + s * 0.35} ${sy + s * 0.35}L${sx} ${sy + s * 2}L${sx - s * 0.35} ${sy + s * 0.35}L${sx - s * 2} ${sy}L${sx - s * 0.35} ${sy - s * 0.35}Z`} fill={d.accent} opacity={0.8} />);
  } else if (d.pattern === 'grid') {
    const step = Math.max(14, w / 18);
    for (let x = step; x < w; x += step) out.push(<Line key={`x${x}`} x1={x} y1={0} x2={x} y2={h} stroke={d.accent} strokeWidth={0.6} opacity={0.12} />);
    for (let y = step; y < h; y += step) out.push(<Line key={`y${y}`} x1={0} y1={y} x2={w} y2={y} stroke={d.accent} strokeWidth={0.6} opacity={0.12} />);
  } else if (d.pattern === 'grain') {
    const r = seeded(3);
    const n = Math.round((w * h) / 900);
    for (let i = 0; i < n; i++) out.push(<Circle key={i} cx={r() * w} cy={r() * h} r={0.5 + r() * 0.9} fill={d.accent} opacity={0.08 + r() * 0.08} />);
  } else if (d.pattern === 'rays') {
    const cx = w / 2; const cy = h * 1.05; const R = Math.max(w, h) * 1.6; const n = 18;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI + (i / n) * Math.PI; const a1 = a0 + (Math.PI / n) * 0.5;
      out.push(<Path key={i} d={`M${cx} ${cy}L${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)}L${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)}Z`} fill="#FFFFFF" opacity={0.08} />);
    }
    out.push(<Circle key="sun" cx={cx} cy={cy} r={w * 0.28} fill="#FFFFFF" opacity={0.1} />);
  } else if (d.pattern === 'waves') {
    for (let i = 0; i < 6; i++) {
      const y = h * (0.62 + i * 0.075); const amp = h * 0.025; const k = w / 3;
      out.push(<Path key={i} d={`M0 ${y} C ${k * 0.5} ${y - amp}, ${k} ${y + amp}, ${k * 1.5} ${y} S ${k * 2.5} ${y - amp}, ${w} ${y} L ${w} ${h} L 0 ${h} Z`} fill="#FFFFFF" opacity={0.035 + i * 0.008} />);
    }
  } else if (d.pattern === 'cross') {
    const cw = w * 0.07; const cx = w / 2; const top = h * 0.08; const bottom = h * 0.92; const arm = h * 0.3;
    out.push(<Rect key="v" x={cx - cw / 2} y={top} width={cw} height={bottom - top} fill={d.accent} opacity={0.08} />);
    out.push(<Rect key="h" x={w * 0.2} y={arm - cw / 2} width={w * 0.6} height={cw} fill={d.accent} opacity={0.08} />);
    out.push(<Circle key="glow" cx={cx} cy={arm} r={w * 0.35} fill={d.accent} opacity={0.05} />);
  }
  return out;
}

function Frame({ d, w, h }) {
  const a = d.accent;
  if (d.frame === 'scripture' || d.frame === 'double') {
    const i1 = Math.round(w * 0.04); const i2 = i1 + Math.max(4, Math.round(w * 0.014)); const c = Math.max(6, w * 0.024);
    const corners = [[i2, i2], [w - i2, i2], [i2, h - i2], [w - i2, h - i2]];
    return [
      <Rect key="o" x={i1} y={i1} width={w - i1 * 2} height={h - i1 * 2} stroke={a} strokeWidth={d.frame === 'double' ? 1.6 : 1.2} fill="none" opacity={0.7} />,
      <Rect key="i" x={i2} y={i2} width={w - i2 * 2} height={h - i2 * 2} stroke={a} strokeWidth={0.7} fill="none" opacity={0.55} />,
      ...corners.map(([x, y], k) => <Path key={`c${k}`} d={`M${x} ${y - c}L${x + c} ${y}L${x} ${y + c}L${x - c} ${y}Z`} fill={a} opacity={0.85} />),
    ];
  }
  if (d.frame === 'arch') {
    const m = w * 0.08; const top = h * 0.07; const r = (w - m * 2) / 2;
    const p = `M${m} ${h - m} L${m} ${top + r} A ${r} ${r} 0 0 1 ${w - m} ${top + r} L ${w - m} ${h - m} Z`;
    const m2 = m + w * 0.02; const r2 = (w - m2 * 2) / 2; const top2 = top + w * 0.02;
    const p2 = `M${m2} ${h - m2} L${m2} ${top2 + r2} A ${r2} ${r2} 0 0 1 ${w - m2} ${top2 + r2} L ${w - m2} ${h - m2} Z`;
    return [
      <Path key="a" d={p} stroke={a} strokeWidth={1.4} fill="#FFFFFF" fillOpacity={0.35} opacity={0.8} />,
      <Path key="b" d={p2} stroke={a} strokeWidth={0.7} fill="none" opacity={0.5} />,
    ];
  }
  return null;
}

export function DesignBackground({ design: d, width: w, height: h }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {d.colors ? (
        <LinearGradient colors={d.colors} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: d.color }]} />
      )}
      {d.shade ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${d.shade})` }]} /> : null}
      {w > 0 && h > 0 && (d.pattern || d.frame) ? (
        <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
          <G>{Pattern({ d, w, h })}</G>
          <G>{Frame({ d, w, h })}</G>
        </Svg>
      ) : null}
    </View>
  );
}

// ─── The card ─────────────────────────────────────────────────────
/**
 * Image-style text card. `theme` is the stored design ("dawn.italic.center" or a legacy colour).
 * Width comes from the parent (fills it); height follows the aspect: square for short text, 4:5 for longer
 * (square on wide screens so desktop cards stay compact). Pass `width` to render at a fixed size (share sheet).
 */
export function TextPostCard({ theme, text, passage, onPassage, width: fixedW, branded, author, style, cardRef, rounded = true }) {
  const win = useWindowDimensions();
  const [w, setW] = useState(fixedW || Math.min(win.width - 24, MAX_CARD_W));
  const r = resolveDesign(theme) || resolveDesign('midnight');
  const { design: d, font, align } = r;
  const body = String(text || '').trim();
  const wide = win.width >= 720;
  const aspect = fixedW ? (branded && body.length > 140 ? 0.8 : 1) : wide || body.length <= 140 ? 1 : 0.8;
  const cw = fixedW || Math.min(w, MAX_CARD_W); // wide containers (desktop) get a centred card
  const inset = !fixedW && w > MAX_CARD_W;
  const h = Math.round(cw / aspect);
  const framed = !!d.frame;
  const padX = Math.round(cw * (framed ? 0.15 : 0.11));
  const padY = Math.round(cw * (framed ? 0.14 : 0.1));
  const markH = font.key === 'modern' ? 0 : Math.round(cw * 0.12);
  const refH = passage ? Math.round(cw * 0.1) : 0;
  const brandH = branded ? Math.round(cw * 0.07) : 0;
  const fit = fitFontSize(body, cw - padX * 2, h - padY * 2 - markH - refH - brandH, font);
  const textAlign = align === 'left' ? 'left' : 'center';
  const items = align === 'left' ? 'flex-start' : 'center';
  const shadowStyle = d.light ? null : styles.textShadow;

  return (
    <View
      onLayout={fixedW ? undefined : (e) => { const lw = Math.round(e.nativeEvent.layout.width); if (lw && Math.abs(lw - w) > 1) setW(lw); }}
      style={[styles.outer, inset && styles.outerInset, style]}
    >
    <View
      ref={cardRef}
      collapsable={false}
      style={[styles.card, (rounded || inset) && styles.cardRounded, { width: cw, height: h, paddingHorizontal: padX, paddingVertical: padY, alignItems: items }]}
      accessibilityRole="text"
      accessibilityLabel={`${body}${passage ? `. ${passage}` : ''}`}
    >
      <DesignBackground design={d} width={cw} height={h} />
      {markH ? (
        <Text style={[styles.mark, { color: d.accent, fontSize: Math.round(markH * 1.25), lineHeight: markH + 4, height: markH, textAlign }]} accessibilityElementsHidden importantForAccessibility="no">“</Text>
      ) : null}
      <Text style={[{ color: d.fg, fontFamily: font.family, fontSize: fit.size, lineHeight: fit.lh, textAlign, alignSelf: 'stretch' }, font.key === 'modern' && { letterSpacing: -0.2 }, shadowStyle]}>
        {body}
      </Text>
      {passage ? (
        <Pressable onPress={onPassage} disabled={!onPassage} hitSlop={8} style={{ alignItems: items, marginTop: Math.round(cw * 0.04) }} accessibilityRole={onPassage ? 'link' : undefined} accessibilityLabel={onPassage ? `Open ${passage}` : undefined}>
          <View style={[styles.rule, { backgroundColor: d.accent }]} />
          <Text style={[styles.ref, { color: d.accent, fontSize: Math.max(10, Math.round(cw * 0.032)) }]} numberOfLines={1}>{passage}</Text>
        </Pressable>
      ) : null}
      {branded ? (
        <View style={[styles.brandRow, { left: padX, right: padX, bottom: Math.round(padY * 0.5) }]}>
          <Text style={[styles.brandText, { color: d.fg }]} numberOfLines={1}>{author ? `@ ${author}` : ''}</Text>
          <Text style={[styles.brandName, { color: d.fg }]}>BibleNestra</Text>
        </View>
      ) : null}
    </View>
    </View>
  );
}

// Palette tile for the composer
export function DesignSwatch({ design: d, selected, onPress, size = 58 }) {
  const h = Math.round(size * 1.18);
  return (
    <Pressable onPress={onPress} style={[styles.swatchRing, selected && { borderColor: colors.gold }]} accessibilityRole="button" accessibilityLabel={`${d.label} background`} accessibilityState={{ selected: !!selected }}>
      <View style={[styles.swatch, { width: size, height: h }]}>
        <DesignBackground design={d} width={size} height={h} />
        <Text style={[styles.swatchAa, { color: d.fg }]}>Aa</Text>
      </View>
      <Text style={[styles.swatchLabel, selected && { color: colors.fg, fontWeight: '700' }]} numberOfLines={1}>{d.label}</Text>
    </Pressable>
  );
}

// ─── Share as image ───────────────────────────────────────────────
export const canShareImage = Platform.OS !== 'web' && !!captureRef && !!Sharing;

/**
 * Bottom sheet that shows the designed card and shares it as a PNG (native) or as text.
 * onShareText() should share the text/link version and resolve true when shared; onShared() is called
 * after an image share so the parent can bump the share count.
 */
export function TextPostShareSheet({ visible, post, onClose, onShareText, onShared }) {
  const win = useWindowDimensions();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  if (!post) return null;
  const cardW = Math.min(win.width - 48, 340);

  const shareImage = async () => {
    setStatus(null);
    setBusy(true);
    try {
      if (!canShareImage || !(await Sharing.isAvailableAsync())) throw new Error('unavailable');
      const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share post' });
      onShared && onShared();
      onClose && onClose();
    } catch (e) {
      setStatus('Couldn’t create the image — try sharing as text.');
    } finally {
      setBusy(false);
    }
  };

  const shareText = async () => {
    const ok = onShareText ? await onShareText() : false;
    if (ok) onClose && onClose();
  };

  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>Share post</Text>
              <Text style={styles.title}>Share as an image</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityLabel="Close">
              <Icon name="x" size={16} color={colors.muted} strokeWidth={2.4} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 26, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
            <View style={styles.previewShadow}>
              <TextPostCard cardRef={ref} theme={post.theme} text={post.text} passage={post.passage} width={cardW} branded author={post.author} />
            </View>
            {status ? <Text style={styles.status}>{status}</Text> : null}
            {canShareImage ? (
              <Pressable onPress={shareImage} disabled={busy} style={({ pressed }) => [styles.cta, (pressed || busy) && { opacity: 0.85 }]} accessibilityRole="button">
                <Icon name="image" size={18} color="#FFFFFF" />
                <Text style={styles.ctaText}>{busy ? 'Preparing image…' : 'Share as image'}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={shareText} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Icon name="share" size={16} color={colors.primary} />
              <Text style={styles.ghostText}>Share as text</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  outer: { alignSelf: 'stretch', alignItems: 'center' },
  outerInset: { paddingVertical: 6 },
  card: { overflow: 'hidden', justifyContent: 'center' },
  cardRounded: { borderRadius: radius.md },
  mark: { fontFamily: fonts.display, includeFontPadding: false, alignSelf: 'stretch' },
  textShadow: { textShadowColor: 'rgba(0,0,0,0.28)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  rule: { width: 26, height: 2, borderRadius: 1, marginBottom: 8, opacity: 0.9 },
  ref: { fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  brandRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandText: { fontSize: 10.5, fontWeight: '600', opacity: 0.6, flexShrink: 1 },
  brandName: { fontFamily: fonts.serifBold, fontSize: 11.5, opacity: 0.65, marginLeft: 8 },

  swatchRing: { alignItems: 'center', padding: 3, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  swatch: { borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' },
  swatchAa: { fontFamily: fonts.serifBold, fontSize: 17 },
  swatchLabel: { fontSize: 10.5, color: colors.muted, marginTop: 4, maxWidth: 66 },

  backdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, maxHeight: '94%', width: '100%', maxWidth: 560, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 14 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold },
  title: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 1 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  previewShadow: { borderRadius: radius.md, ...shadow.md },
  status: { fontSize: 12.5, color: colors.negative, marginTop: 14, textAlign: 'center' },
  cta: { marginTop: 22, height: 52, alignSelf: 'stretch', borderRadius: 26, backgroundColor: colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  ghost: { marginTop: 10, height: 48, alignSelf: 'stretch', borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.primary, fontSize: 14.5, fontWeight: '700' },
});
