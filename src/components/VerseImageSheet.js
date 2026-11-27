// Verse image creator — typeset a verse on a background and share it as an image
// (pattern from YouVersion Verse Images and the Verses app's share cards).
import React, { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { AnimatedModal, Pop, ScaleIn } from './Motion';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';

let captureRef = null;
let Sharing = null;
try { captureRef = require('react-native-view-shot').captureRef; } catch (e) { captureRef = null; }
try { Sharing = require('expo-sharing'); } catch (e) { Sharing = null; }

export const BACKGROUNDS = [
  { key: 'night', label: 'Night', colors: ['#2A2F6B', '#2A1B12', '#0E0C1E'], fg: '#F4EFE6', accent: '#D4A852' },
  { key: 'dawn', label: 'Dawn', colors: ['#F6C9A0', '#E7957B', '#7C4F8E'], fg: '#FFFFFF', accent: '#FFF1D6' },
  { key: 'paper', label: 'Paper', colors: ['#FBF7EF', '#F1E8D6', '#E7DBC2'], fg: '#2A251E', accent: '#A87A27' },
  { key: 'olive', label: 'Olive', colors: ['#7E9A73', '#4E6B52', '#2E4436'], fg: '#F5F1E6', accent: '#E9D9A6' },
  { key: 'sea', label: 'Sea', colors: ['#6FA3C7', '#356D9C', '#1E3B5A'], fg: '#FFFFFF', accent: '#CFE5F5' },
  { key: 'rose', label: 'Rose', colors: ['#E9B9B5', '#C27A84', '#7A3E58'], fg: '#FFFFFF', accent: '#FCE7DF' },
];

const TYPES = [
  { key: 'serif', label: 'Classic', family: fonts.serif },
  { key: 'italic', label: 'Italic', family: fonts.serifItalic },
  { key: 'bold', label: 'Bold', family: fonts.serifBold },
];

export default function VerseImageSheet({ visible, onClose, text, reference, translation }) {
  const [bg, setBg] = useState(BACKGROUNDS[0]);
  const [type, setType] = useState(TYPES[1]);
  const [shape, setShape] = useState('square');
  const [status, setStatus] = useState(null);
  const cardRef = useRef(null);

  const share = async () => {
    setStatus(null);
    const fallback = () => Share.share({ message: `“${text}” — ${reference}${translation ? ` (${translation})` : ''}` });
    try {
      if (Platform.OS !== 'web' && captureRef && Sharing && (await Sharing.isAvailableAsync())) {
        const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: reference });
        return;
      }
      await fallback();
    } catch (e) {
      try { await fallback(); } catch (err) { setStatus('Sharing isn’t available on this device.'); }
    }
  };

  const len = (text || '').length;
  const fontSize = shape === 'story' ? (len > 180 ? 21 : len > 110 ? 24 : 28) : len > 180 ? 17 : len > 110 ? 20 : 24;

  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View>
              <Text style={styles.eyebrow}>Verse image</Text>
              <Text style={styles.title}>Create & share</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityLabel="Close">
              <Icon name="x" size={16} color={colors.muted} strokeWidth={2.4} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            <View style={{ alignItems: 'center' }}>
              <ScaleIn key={bg.key + shape + type.key} from={0.94}>
              <View ref={cardRef} collapsable={false} style={[styles.card, shape === 'story' ? styles.cardStory : styles.cardSquare]}>
                <LinearGradient colors={bg.colors} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
                <Text style={[styles.quote, { color: bg.accent }]}>“</Text>
                <Text style={[styles.verse, { color: bg.fg, fontFamily: type.family, fontSize, lineHeight: Math.round(fontSize * 1.38) }]}>
                  {text}
                </Text>
                <View style={[styles.rule, { backgroundColor: bg.accent }]} />
                <Text style={[styles.ref, { color: bg.accent }]}>{reference}{translation ? ` · ${translation}` : ''}</Text>
                <Text style={[styles.brand, { color: bg.fg }]}>BibleNestra</Text>
              </View>
              </ScaleIn>
            </View>

            <Text style={styles.label}>Background</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {BACKGROUNDS.map((b) => (
                <Pressable key={b.key} onPress={() => setBg(b)} style={[styles.swatchRing, bg.key === b.key && { borderColor: colors.primary }]} accessibilityLabel={b.label}>
                  <LinearGradient colors={b.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swatch} />
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.label}>Type</Text>
            <View style={styles.segment}>
              {TYPES.map((t) => (
                <Pressable key={t.key} onPress={() => setType(t)} style={[styles.segBtn, type.key === t.key && styles.segOn]}>
                  <Text style={[styles.segText, { fontFamily: t.family }, type.key === t.key && { color: colors.fg }]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Format</Text>
            <View style={styles.segment}>
              {[['square', 'Square · post'], ['story', 'Story · 9:16']].map(([k, l]) => (
                <Pressable key={k} onPress={() => setShape(k)} style={[styles.segBtn, shape === k && styles.segOn]}>
                  <Text style={[styles.segSans, shape === k && { color: colors.fg, fontWeight: '700' }]}>{l}</Text>
                </Pressable>
              ))}
            </View>

            {status ? <Text style={styles.status}>{status}</Text> : null}

            <Pressable onPress={share} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.88 }]}>
              <Icon name="share" size={18} color="#FFFFFF" />
              <Text style={styles.ctaText}>Share image</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, maxHeight: '94%' },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 14 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold },
  title: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 1 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  card: { overflow: 'hidden', borderRadius: radius.lg, paddingHorizontal: 26, justifyContent: 'center', ...shadow.md },
  cardSquare: { width: 300, height: 300 },
  cardStory: { width: 230, height: 409 },
  quote: { fontFamily: fonts.display, fontSize: 54, lineHeight: 54, marginBottom: -14 },
  verse: {},
  rule: { width: 28, height: 2, borderRadius: 1, marginTop: 16, opacity: 0.9 },
  ref: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 10 },
  brand: { position: 'absolute', bottom: 14, right: 18, fontFamily: fonts.serifBold, fontSize: 11, opacity: 0.55 },
  label: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginTop: 20, marginBottom: 10 },
  swatchRing: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20 },
  segment: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface, ...shadow.sm },
  segText: { fontSize: 15, color: colors.muted },
  segSans: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  status: { fontSize: 12.5, color: colors.negative, marginTop: 14, textAlign: 'center' },
  cta: { marginTop: 22, height: 52, borderRadius: 26, backgroundColor: colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
