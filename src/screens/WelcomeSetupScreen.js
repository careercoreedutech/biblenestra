// One light personalisation step after the first sign-in (brief §4): your name, your Bible and Scripture
// notifications. Shown only when the account has no name yet (email sign-ups) — Google / Apple accounts bring
// their name along and go straight to Today. "Skip" is always there; everything can be changed later.
// Rebuilt in the Figma design (the "Make it yours" setup in extendedScreens.tsx).
import React, { useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale } from '../components/Motion';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { ensurePermission, supported as popsSupported } from '../notifications/scripturePop';
import { TRANSLATIONS } from '../bible/catalog';
import { d, df, Grad } from '../design/sanctuary';
import { colors } from '../theme'; // APPEARANCE (item 14): palette tokens
import { isDarkScheme } from '../design/palette'; // APPEARANCE (item 14)

// A short list: the main English versions + the first Bible in the core African languages
const LANGS = ['Yorùbá', 'Igbo', 'Hausa', 'Kiswahili', 'Twi', 'Français'];
export const QUICK_TRANSLATIONS = [
  ...['KJV', 'BSB', 'WEB'].map((id) => TRANSLATIONS.find((t) => t.id === id)).filter(Boolean),
  ...LANGS.map((l) => TRANSLATIONS.find((t) => t.lang === l)).filter(Boolean),
];

function Chip({ on, label, onPress }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.95} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </PressScale>
  );
}

// .toggle: the pill switch used on the reminder row
function Toggle({ on, onPress, label }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.95} style={[styles.toggle, on && styles.toggleOn]} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <View style={[styles.toggleKnob, on && styles.toggleKnobOn]} />
    </PressScale>
  );
}

/** onDone({ name }) after saving, or onDone(null) on Skip. `saveName(name)` updates the account (Clerk). */
export function WelcomeSetupView({ initialName = '', onDone, saveName }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [translation, setTranslation] = useState(state.translation || 'KJV');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const n = name.trim();
    try { if (n && saveName) await saveName(n); } catch (e) { /* the name can be set later in the profile */ }
    dispatch({ type: 'set', patch: { translation } });
    if (n) dispatch({ type: 'set', patch: { user: { ...(state.user || {}), displayName: n, name: n } } });
    let enabled = notify;
    if (enabled && popsSupported) {
      const ok = await ensurePermission().catch(() => false);
      if (!ok) { enabled = false; toast.show('Allow notifications for BibleNestra to get Scripture pop-ups', { icon: 'bell', tone: 'error' }); }
    }
    dispatch({ type: 'scripturePop', patch: { enabled } });
    setBusy(false);
    onDone({ name: n });
  };
  const initials = (name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')) || 'BN';
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style={isDarkScheme() ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Text style={styles.kicker}>Welcome setup</Text>
          <PressScale onPress={() => onDone(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip">
            <Text style={styles.skip}>Skip</Text>
          </PressScale>
        </View>

        <FadeInUp distance={10}>
          <Grad colors={['#2F1D12', '#8C421C']} style={styles.intro}>
            <View style={styles.introMark}><Text style={styles.introMarkText}>{initials}</Text></View>
            <View style={styles.introText}>
              <Text style={styles.introKicker}>Welcome to BibleNestra</Text>
              <Text style={styles.introTitle}>Your sanctuary begins with a few simple choices.</Text>
            </View>
          </Grad>
          <Text style={styles.title}>Make it yours</Text>
          <Text style={styles.sub}>Three quick choices. You can change them any time in Settings.</Text>
        </FadeInUp>

        <FadeInUp index={1} distance={8}>
          <Text style={styles.label}>What should we call you?</Text>
          <View style={styles.field}>
            <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={d.muted} style={styles.input} autoComplete="name" textContentType="name" maxLength={60} accessibilityLabel="Your name" />
          </View>
        </FadeInUp>

        <FadeInUp index={2} distance={8}>
          <Text style={styles.label}>Preferred Bible translation</Text>
          <View style={styles.chips}>
            {QUICK_TRANSLATIONS.map((t) => (
              <Chip key={t.id} on={translation === t.id} label={t.lang === 'English' ? t.id : t.lang} onPress={() => setTranslation(t.id)} />
            ))}
          </View>
        </FadeInUp>

        <FadeInUp index={3} distance={8}>
          <View style={styles.option}>
            <View style={styles.optionIcon}><Icon name="bell" size={18} color={d.plum} strokeWidth={1.9} /></View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Daily scripture reminder</Text>
              <Text style={styles.optionBody}>A verse through the day, as Scripture pop-ups.</Text>
            </View>
            <Toggle on={notify} onPress={() => setNotify(!notify)} label="Daily scripture reminder" />
          </View>
        </FadeInUp>

        <View style={{ flex: 1, minHeight: 24 }} />
        <PressScale onPress={save} disabled={busy} scaleTo={0.97} style={[styles.cta, busy && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel="Save and continue">
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.ctaText}>Save and continue</Text>}
          {busy ? null : <Icon name="arrow-right" size={18} color="#FFFFFF" strokeWidth={2.2} />}
        </PressScale>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: d.ivory },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 22, width: '100%', maxWidth: 520, alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, marginBottom: 18 },
  kicker: { color: d.plum, fontFamily: df.sansBold, fontSize: 10, letterSpacing: 1.7, textTransform: 'uppercase' },
  skip: { fontSize: 13, fontFamily: df.sansBold, color: d.plum, paddingVertical: 6 },

  intro: { flexDirection: 'row', alignItems: 'center', gap: 15, padding: 20, borderRadius: 22 },
  introMark: { width: 62, height: 62, borderRadius: 20, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  introMarkText: { color: '#FFFFFF', fontFamily: df.displayBold, fontSize: 18 },
  introText: { flex: 1, minWidth: 0 },
  introKicker: { color: '#F5C19F', fontFamily: df.sansHeavy, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  introTitle: { color: '#FFFFFF', fontFamily: df.display, fontSize: 19, lineHeight: 24, marginTop: 5 },

  title: { marginTop: 22, fontFamily: df.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: d.ink },
  sub: { marginTop: 6, fontFamily: df.sans, fontSize: 14, lineHeight: 21, color: d.muted },
  label: { marginTop: 22, marginBottom: 8, fontSize: 12, fontFamily: df.sansBold, color: (isDarkScheme() ? '#ffffff' : '#333333') },
  field: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, paddingHorizontal: 14, justifyContent: 'center' },
  input: { height: 50, fontFamily: df.sans, fontSize: 14, color: d.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: d.plum, backgroundColor: (isDarkScheme() ? '#2a1a10' : '#ffede3') },
  chipText: { fontSize: 13, fontFamily: df.sansBold, color: d.muted },
  chipTextOn: { color: d.plum },

  option: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 20, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  optionIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, minWidth: 0 },
  optionTitle: { fontSize: 13, fontFamily: df.sansBold, color: d.ink },
  optionBody: { fontSize: 11, fontFamily: df.sans, color: d.muted, marginTop: 2 },
  toggle: { width: 44, height: 26, padding: 3, borderRadius: 13, backgroundColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), justifyContent: 'center' },
  toggleOn: { backgroundColor: d.plum },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surfaceWhite },
  toggleKnobOn: { transform: [{ translateX: 18 }] },

  cta: { height: 56, borderRadius: 18, backgroundColor: d.plum, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 24,
    ...Platform.select({
      web: { boxShadow: '0 14px 30px rgba(255,107,26,0.22)' },
      default: { shadowColor: d.plum, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.22, shadowRadius: 22, elevation: 6 },
    }),
  },
  ctaText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 15 },
});
