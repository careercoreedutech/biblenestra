// One light personalisation step after the first sign-in (brief §4): your name, your Bible and Scripture
// notifications. Shown only when the account has no name yet (email sign-ups) — Google / Apple accounts bring
// their name along and go straight to Today. "Skip" is always there; everything can be changed later.
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale } from '../components/Motion';
import { BrandLogo } from '../components/BrandLogo';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { ensurePermission, supported as popsSupported } from '../notifications/scripturePop';
import { TRANSLATIONS } from '../bible/catalog';

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
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <BrandLogo size={44} />
          <PressScale onPress={() => onDone(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip">
            <Text style={styles.skip}>Skip</Text>
          </PressScale>
        </View>
        <FadeInUp distance={10}>
          <Text style={styles.title}>Make it yours</Text>
          <Text style={styles.sub}>Three quick choices. You can change them any time in Settings.</Text>
        </FadeInUp>

        <FadeInUp index={1} distance={8}>
          <Text style={styles.label}>Your name</Text>
          <View style={styles.field}>
            <Icon name="user" size={18} color={colors.faint} />
            <TextInput value={name} onChangeText={setName} placeholder="What should we call you?" placeholderTextColor={colors.faint} style={styles.input} autoComplete="name" textContentType="name" maxLength={60} accessibilityLabel="Your name" />
          </View>
        </FadeInUp>

        <FadeInUp index={2} distance={8}>
          <Text style={styles.label}>Your Bible</Text>
          <View style={styles.chips}>
            {QUICK_TRANSLATIONS.map((t) => (
              <Chip key={t.id} on={translation === t.id} label={t.lang === 'English' ? t.id : t.lang} onPress={() => setTranslation(t.id)} />
            ))}
          </View>
        </FadeInUp>

        <FadeInUp index={3} distance={8}>
          <Text style={styles.label}>A verse through the day</Text>
          <View style={styles.chips}>
            <Chip on={notify} label="Yes, send Scripture pop-ups" onPress={() => setNotify(true)} />
            <Chip on={!notify} label="Not now" onPress={() => setNotify(false)} />
          </View>
        </FadeInUp>

        <View style={{ flex: 1, minHeight: 24 }} />
        <PressScale onPress={save} disabled={busy} scaleTo={0.97} style={[styles.cta, busy && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel="Continue">
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text style={styles.ctaText}>Continue</Text>
        </PressScale>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 22, width: '100%', maxWidth: 520, alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, marginBottom: 22 },
  skip: { fontSize: 15, fontWeight: '600', color: colors.muted },
  title: { fontFamily: fonts.serifBold, fontSize: 30, letterSpacing: -0.6, color: colors.fg },
  sub: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.muted },
  label: { marginTop: 24, marginBottom: 10, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.muted },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, paddingHorizontal: 14 },
  input: { flex: 1, height: 52, fontSize: 16, color: colors.fg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  chipTextOn: { color: colors.primary },
  cta: { height: 54, borderRadius: radius.pill, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...shadow.sm },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
