// CoverMaker — reusable cover / thumbnail builder (audio, PDF books, and any other upload).
//
//   import CoverMaker, { CoverField } from '../components/media/CoverMaker';
//
//   <CoverField value={cover} onChange={setCover} title={title} subtitle={artist} />
//     → a square preview + "Add cover" button that opens the maker. `value` is { uri } | null.
//
//   <CoverMaker visible onClose={…} onDone={({ uri }) => …} title="…" subtitle="…" shape="square" />
//     Two ways to make a cover:
//       1. "My image"  — pick a picture (cropped square on phones)
//       2. "Templates" — pick one of 10 designs, add your own picture, title and subtitle, adjust the colour
//     The design is rendered to a 1080×1080 JPEG with react-native-view-shot (html2canvas on web).
//   The caller uploads the returned uri, e.g. useLibraryApi().uploadCover(uri) → R2 image key.
import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { colors, fonts, radius, shadow } from '../../theme';
import { Icon } from '../Icons';
import { AnimatedModal, PressScale } from '../Motion';

let captureRef = null;
try { captureRef = require('react-native-view-shot').captureRef; } catch (e) { captureRef = null; } // eslint-disable-line global-require

export const COVER_COLORS = ['#2E3A87', '#15172B', '#A87A27', '#B0475C', '#4E7A5C', '#2C7672', '#6B52A3', '#B45D3A', '#356D9C', '#1C1915'];

// shade(hex, amt): amt > 0 lightens, < 0 darkens
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const r = f((n >> 16) & 255); const g = f((n >> 8) & 255); const b = f(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

// Each template: ({ S, color, photo, title, subtitle }) → elements inside an S×S square. k = S / 300 scales sizes.
export const COVER_TEMPLATES = [
  {
    id: 'sanctuary', name: 'Sanctuary', photo: true,
    render: ({ S, color, photo, title, subtitle }) => { const k = S / 300; return (
      <>
        {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <LinearGradient colors={[shade(color, 0.25), shade(color, -0.45)]} style={StyleSheet.absoluteFill} />}
        <LinearGradient colors={['rgba(0,0,0,0)', rgba(shade(color, -0.6), 0.92)]} start={{ x: 0, y: 0.35 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ position: 'absolute', left: 20 * k, right: 20 * k, bottom: 22 * k }}>
          <Text style={{ color: '#fff', fontFamily: fonts.serifBold, fontSize: 30 * k, lineHeight: 34 * k }} numberOfLines={3}>{title}</Text>
          {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 * k, marginTop: 6 * k, fontWeight: '600' }} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </>
    ); },
  },
  {
    id: 'frame', name: 'Gold frame',
    render: ({ S, color, title, subtitle }) => { const k = S / 300; return (
      <>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
        <View style={{ position: 'absolute', left: 14 * k, top: 14 * k, right: 14 * k, bottom: 14 * k, borderWidth: 2 * k, borderColor: '#D4A852', alignItems: 'center', justifyContent: 'center', padding: 22 * k }}>
          <Text style={{ color: '#D4A852', fontSize: 26 * k, marginBottom: 10 * k }}>✝</Text>
          <Text style={{ color: '#F4EFE6', fontFamily: fonts.serifBold, fontSize: 28 * k, lineHeight: 33 * k, textAlign: 'center' }} numberOfLines={4}>{title}</Text>
          <View style={{ width: 40 * k, height: 2 * k, backgroundColor: '#D4A852', marginVertical: 12 * k }} />
          {subtitle ? <Text style={{ color: '#D4A852', fontSize: 12 * k, letterSpacing: 2 * k, fontWeight: '700', textTransform: 'uppercase', textAlign: 'center' }} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      </>
    ); },
  },
  {
    id: 'split', name: 'Split', photo: true,
    render: ({ S, color, photo, title, subtitle }) => { const k = S / 300; return (
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
        <View style={{ flex: 1, backgroundColor: shade(color, -0.3) }}>
          {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={{ color: rgba('#ffffff', 0.25), fontSize: 90 * k, textAlign: 'center', marginTop: 90 * k }}>✦</Text>}
        </View>
        <View style={{ flex: 1, backgroundColor: color, padding: 16 * k, justifyContent: 'flex-end' }}>
          <View style={{ width: 26 * k, height: 4 * k, backgroundColor: '#fff', marginBottom: 12 * k }} />
          <Text style={{ color: '#fff', fontFamily: fonts.serifBold, fontSize: 22 * k, lineHeight: 26 * k }} numberOfLines={5}>{title}</Text>
          {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11.5 * k, marginTop: 8 * k, fontWeight: '600' }} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      </View>
    ); },
  },
  {
    id: 'circle', name: 'Portrait', photo: true,
    render: ({ S, color, photo, title, subtitle }) => { const k = S / 300; return (
      <>
        <LinearGradient colors={[shade(color, 0.15), shade(color, -0.4)]} style={StyleSheet.absoluteFill} />
        <View style={{ alignItems: 'center', paddingTop: 30 * k, paddingHorizontal: 18 * k }}>
          <View style={{ width: 130 * k, height: 130 * k, borderRadius: 65 * k, borderWidth: 4 * k, borderColor: '#fff', overflow: 'hidden', backgroundColor: shade(color, 0.35), alignItems: 'center', justifyContent: 'center' }}>
            {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Text style={{ color: '#fff', fontSize: 48 * k }}>✝</Text>}
          </View>
          <Text style={{ color: '#fff', fontFamily: fonts.serifBold, fontSize: 24 * k, lineHeight: 28 * k, textAlign: 'center', marginTop: 16 * k }} numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 12.5 * k, marginTop: 6 * k, textAlign: 'center', fontWeight: '600' }} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </>
    ); },
  },
  {
    id: 'bold', name: 'Bold type',
    render: ({ S, color, title, subtitle }) => { const k = S / 300; return (
      <>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#F6F2EA' }]} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16 * k, backgroundColor: color }} />
        <View style={{ position: 'absolute', left: 34 * k, right: 20 * k, top: 26 * k, bottom: 24 * k, justifyContent: 'space-between' }}>
          {subtitle ? <Text style={{ color, fontSize: 12 * k, letterSpacing: 2.4 * k, fontWeight: '800', textTransform: 'uppercase' }} numberOfLines={1}>{subtitle}</Text> : <View />}
          <Text style={{ color: '#1C1915', fontSize: 38 * k, lineHeight: 39 * k, fontWeight: '900', textTransform: 'uppercase', letterSpacing: -1 * k }} numberOfLines={5}>{title}</Text>
        </View>
      </>
    ); },
  },
  {
    id: 'sunrise', name: 'Sunrise',
    render: ({ S, color, title, subtitle }) => { const k = S / 300; return (
      <>
        <LinearGradient colors={[shade(color, -0.35), color, shade(color, 0.55)]} style={StyleSheet.absoluteFill} />
        <View style={{ position: 'absolute', alignSelf: 'center', top: 150 * k, width: 190 * k, height: 190 * k, borderRadius: 95 * k, backgroundColor: 'rgba(255,236,190,0.55)' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 215 * k, bottom: 0, backgroundColor: rgba(shade(color, -0.55), 0.55) }} />
        <View style={{ position: 'absolute', left: 22 * k, right: 22 * k, top: 30 * k, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: fonts.serifBold, fontSize: 28 * k, lineHeight: 32 * k, textAlign: 'center' }} numberOfLines={3}>{title}</Text>
          {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 12.5 * k, marginTop: 8 * k, fontWeight: '600', textAlign: 'center' }} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      </>
    ); },
  },
  {
    id: 'minimal', name: 'Minimal',
    render: ({ S, color, title, subtitle }) => { const k = S / 300; return (
      <>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }]} />
        <View style={{ position: 'absolute', left: 28 * k, right: 28 * k, top: 0, bottom: 0, justifyContent: 'center' }}>
          <Text style={{ color, fontSize: 20 * k }}>✦</Text>
          <Text style={{ color: '#1C1915', fontFamily: fonts.serif, fontSize: 30 * k, lineHeight: 36 * k, marginTop: 10 * k }} numberOfLines={4}>{title}</Text>
          <View style={{ width: 60 * k, height: 3 * k, backgroundColor: color, marginVertical: 14 * k }} />
          {subtitle ? <Text style={{ color: '#6B6255', fontSize: 13 * k, fontWeight: '600' }} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      </>
    ); },
  },
  {
    id: 'podcast', name: 'Podcast', photo: true,
    render: ({ S, color, photo, title, subtitle }) => { const k = S / 300; return (
      <>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: shade(color, -0.3) }]} />
        {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: rgba(color, photo ? 0.62 : 0.9) }]} />
        <View style={{ position: 'absolute', left: 20 * k, top: 20 * k, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10 * k, paddingVertical: 4 * k }}>
          <Text style={{ color, fontSize: 10 * k, fontWeight: '900', letterSpacing: 1.6 * k }}>{(subtitle || 'PODCAST').toUpperCase().slice(0, 28)}</Text>
        </View>
        <View style={{ position: 'absolute', left: 20 * k, right: 20 * k, bottom: 20 * k }}>
          <Text style={{ color: '#fff', fontSize: 32 * k, lineHeight: 34 * k, fontWeight: '900' }} numberOfLines={4}>{title}</Text>
        </View>
      </>
    ); },
  },
  {
    id: 'night', name: 'Night sky',
    render: ({ S, color, title, subtitle }) => { const k = S / 300; const stars = [[30, 40, 2], [80, 22, 1.5], [250, 30, 2.5], [210, 70, 1.5], [140, 52, 1], [270, 120, 1.5], [24, 120, 1], [60, 80, 1]]; return (
      <>
        <LinearGradient colors={['#0B0D1E', shade(color, -0.5), shade(color, -0.2)]} style={StyleSheet.absoluteFill} />
        {stars.map(([x, y, r], i) => <View key={i} style={{ position: 'absolute', left: x * k, top: y * k, width: r * 2 * k, height: r * 2 * k, borderRadius: r * k, backgroundColor: '#FFF6DA' }} />)}
        <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, bottom: 30 * k, alignItems: 'center' }}>
          <Text style={{ color: '#D4A852', fontFamily: fonts.serifBold, fontSize: 44 * k, lineHeight: 40 * k }}>“</Text>
          <Text style={{ color: '#F4EFE6', fontFamily: fonts.serif, fontSize: 25 * k, lineHeight: 31 * k, textAlign: 'center' }} numberOfLines={4}>{title}</Text>
          {subtitle ? <Text style={{ color: '#D4A852', fontSize: 12 * k, marginTop: 10 * k, fontWeight: '700', letterSpacing: 1 * k }} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </>
    ); },
  },
  {
    id: 'book', name: 'Book jacket',
    render: ({ S, color, photo, title, subtitle }) => { const k = S / 300; return (
      <>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 22 * k, backgroundColor: shade(color, -0.35) }} />
        <View style={{ position: 'absolute', left: 40 * k, right: 22 * k, top: 26 * k, bottom: 22 * k, justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: '#F4EFE6', fontFamily: fonts.serifBold, fontSize: 28 * k, lineHeight: 32 * k }} numberOfLines={4}>{title}</Text>
            <View style={{ width: 50 * k, height: 2 * k, backgroundColor: '#D4A852', marginTop: 12 * k }} />
          </View>
          {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 90 * k, borderRadius: 4 * k }} resizeMode="cover" /> : null}
          {subtitle ? <Text style={{ color: '#D4A852', fontSize: 13 * k, fontWeight: '700', letterSpacing: 1.2 * k, textTransform: 'uppercase' }} numberOfLines={2}>{subtitle}</Text> : <View />}
        </View>
      </>
    ); },
  },
];

async function pickPicture(square) {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('Allow photo library access in Settings to choose a picture');
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: square && Platform.OS !== 'web', aspect: [1, 1], quality: 0.9 });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  return res.assets[0].uri;
}

export function CoverPreview({ template, size, color, photo, title, subtitle, innerRef }) {
  const tpl = COVER_TEMPLATES.find((t) => t.id === template) || COVER_TEMPLATES[0];
  return (
    <View ref={innerRef} collapsable={false} style={{ width: size, height: size, overflow: 'hidden', backgroundColor: color }}>
      {tpl.render({ S: size, color, photo, title: title || 'Your title', subtitle })}
    </View>
  );
}

export default function CoverMaker({ visible, onClose, onDone, title: initialTitle = '', subtitle: initialSub = '', defaultTemplate = 'sanctuary' }) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 340);
  const [mode, setMode] = useState('templates');
  const [template, setTemplate] = useState(defaultTemplate);
  const [color, setColor] = useState(COVER_COLORS[0]);
  const [photo, setPhoto] = useState(null);
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSub);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const shot = useRef(null);

  useEffect(() => { if (visible) { setTitle(initialTitle); setSubtitle(initialSub); setErr(null); } }, [visible]);

  const choosePhoto = async () => {
    try { setErr(null); const u = await pickPicture(false); if (u) setPhoto(u); } catch (e) { setErr(e.message); }
  };
  const useOwnImage = async () => {
    try { setErr(null); const u = await pickPicture(true); if (u) { onDone({ uri: u, source: 'upload' }); onClose(); } } catch (e) { setErr(e.message); }
  };
  const render = async () => {
    if (!captureRef) { setErr('Cover rendering is not available on this device — upload an image instead'); return; }
    setBusy(true); setErr(null);
    try {
      const web = Platform.OS === 'web';
      const uri = await captureRef(shot.current, { format: 'jpg', quality: 0.9, width: 1080, height: 1080, result: web ? 'data-uri' : 'tmpfile' });
      onDone({ uri, source: 'template', template, color });
      onClose();
    } catch (e) {
      setErr('Couldn’t create the cover — try another picture or design');
    }
    setBusy(false);
  };

  return (
    <AnimatedModal visible={visible} onRequestClose={onClose} full>
      <View style={styles.wrap}>
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Icon name="x" size={20} color={colors.fg} /></Pressable>
          <Text style={styles.headTitle}>Cover</Text>
          <View style={{ width: 20 }} />
        </View>
        <View style={styles.tabs}>
          {[['templates', 'Templates'], ['upload', 'My image']].map(([k, l]) => (
            <Pressable key={k} onPress={() => setMode(k)} style={[styles.tab, mode === k && styles.tabOn]}><Text style={[styles.tabText, mode === k && styles.tabTextOn]}>{l}</Text></Pressable>
          ))}
        </View>
        {mode === 'upload' ? (
          <View style={styles.uploadBox}>
            <Icon name="image" size={40} color={colors.primary} />
            <Text style={styles.uploadTitle}>Use your own cover</Text>
            <Text style={styles.uploadSub}>A square picture works best (at least 600 × 600).</Text>
            <PressScale onPress={useOwnImage} style={styles.primaryBtn}><Text style={styles.primaryText}>Choose picture</Text></PressScale>
            {err ? <Text style={styles.err}>{err}</Text> : null}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 8, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={[styles.previewBox, { width: size, height: size }]}>
              <CoverPreview innerRef={shot} template={template} size={size} color={color} photo={photo} title={title} subtitle={subtitle} />
            </View>
            <Text style={styles.label}>Design</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
              {COVER_TEMPLATES.map((t) => (
                <Pressable key={t.id} onPress={() => setTemplate(t.id)} accessibilityLabel={`Template ${t.name}`} style={[styles.thumb, template === t.id && styles.thumbOn]}>
                  <View pointerEvents="none"><CoverPreview template={t.id} size={72} color={color} photo={photo} title={title || t.name} subtitle={subtitle} /></View>
                  <Text style={styles.thumbName} numberOfLines={1}>{t.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.label}>Colour</Text>
            <View style={styles.swatches}>
              {COVER_COLORS.map((c) => (
                <Pressable key={c} onPress={() => setColor(c)} accessibilityLabel={`Colour ${c}`} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} />
              ))}
            </View>
            <Text style={styles.label}>Picture</Text>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Pressable onPress={choosePhoto} style={styles.ghostBtn}><Icon name="image" size={15} color={colors.primary} /><Text style={styles.ghostText}>{photo ? 'Change picture' : 'Add your picture'}</Text></Pressable>
              {photo ? <Pressable onPress={() => setPhoto(null)} style={styles.ghostBtn}><Text style={styles.ghostText}>Remove</Text></Pressable> : null}
            </View>
            <Text style={styles.label}>Title</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Title on the cover" placeholderTextColor={colors.faint} style={styles.input} maxLength={80} />
            <Text style={styles.label}>Subtitle</Text>
            <TextInput value={subtitle} onChangeText={setSubtitle} placeholder="Speaker, author or series" placeholderTextColor={colors.faint} style={styles.input} maxLength={60} />
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <PressScale onPress={busy ? undefined : render} style={[styles.primaryBtn, { marginTop: 20 }, busy && { opacity: 0.6 }]}>
              <Text style={styles.primaryText}>{busy ? 'Creating…' : 'Use this cover'}</Text>
            </PressScale>
          </ScrollView>
        )}
      </View>
    </AnimatedModal>
  );
}

/** Square cover preview + button that opens CoverMaker. value: { uri } | null */
export function CoverField({ value, onChange, title, subtitle, size = 120, label = 'Cover' }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <Pressable onPress={() => setOpen(true)} style={[styles.field, { width: size, height: size }]} accessibilityLabel={`${label}: ${value ? 'change' : 'add'}`}>
        {value && value.uri ? <Image source={{ uri: value.uri }} style={{ width: size, height: size }} /> : <Icon name="image" size={28} color={colors.faint} />}
      </Pressable>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldSub}>Upload your own picture or design one from a template.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setOpen(true)} style={styles.ghostBtn}><Text style={styles.ghostText}>{value ? 'Change' : 'Add cover'}</Text></Pressable>
          {value ? <Pressable onPress={() => onChange(null)} style={styles.ghostBtn}><Text style={styles.ghostText}>Remove</Text></Pressable> : null}
        </View>
      </View>
      <CoverMaker visible={open} onClose={() => setOpen(false)} onDone={onChange} title={title} subtitle={subtitle} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.screen, paddingTop: Platform.OS === 'web' ? 12 : 44 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  headTitle: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg },
  tabs: { flexDirection: 'row', marginHorizontal: 24, backgroundColor: colors.raised, borderRadius: radius.pill, padding: 3, marginBottom: 8 },
  tab: { flex: 1, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.surface, ...shadow.sm },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  tabTextOn: { color: colors.fg },
  previewBox: { alignSelf: 'center', borderRadius: radius.lg, overflow: 'hidden', ...shadow.md },
  label: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  thumb: { alignItems: 'center', gap: 4, padding: 3, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: colors.primary },
  thumbName: { fontSize: 10.5, color: colors.muted, fontWeight: '600', width: 72, textAlign: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.fg, transform: [{ scale: 1.12 }] },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, height: 44, color: colors.fg, fontSize: 15 },
  primaryBtn: { backgroundColor: colors.primary, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, alignSelf: 'stretch' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  ghostBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 14, height: 36 },
  ghostText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  err: { color: colors.rose, marginTop: 12, fontSize: 13 },
  uploadBox: { alignItems: 'center', padding: 32, gap: 10 },
  uploadTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg },
  uploadSub: { color: colors.muted, fontSize: 13.5, textAlign: 'center', marginBottom: 10 },
  field: { borderRadius: radius.md, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 14, fontWeight: '800', color: colors.fg },
  fieldSub: { fontSize: 12.5, color: colors.muted, lineHeight: 17 },
});
