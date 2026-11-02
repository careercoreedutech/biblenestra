// Translation picker sheet: search, region filter, offline downloads, and the "licence needed" shelf.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, radius } from '../theme';
import { Icon } from './Icons';
import { FadeInUp, PressScale } from './Motion';
import { useToast } from './Toast';
import { useStore } from '../store';
import { TRANSLATIONS, LICENSE_REQUIRED, TRANSLATION_REGIONS, LANGUAGE_COUNT } from '../bible/catalog';
import { canDownload, downloadTranslation, isDownloaded, removeDownload } from '../bible/loader';

export default function TranslationPicker({ mode = 'read', active, compareWith = [], onPick, onToggleCompare, onClose }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('All');
  const [progress, setProgress] = useState({}); // id -> 0..1
  const [offline, setOffline] = useState({}); // id -> true

  useEffect(() => {
    let alive = true;
    if (!canDownload) return undefined;
    Promise.all(TRANSLATIONS.map(async (t) => [t.id, await isDownloaded(t.id)])).then((pairs) => {
      if (alive) setOffline(Object.fromEntries(pairs.filter((p) => p[1])));
    });
    return () => { alive = false; };
  }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return TRANSLATIONS.filter((t) => (region === 'All' || t.region === region)
      && (!s || `${t.id} ${t.name} ${t.lang} ${t.region}`.toLowerCase().includes(s)));
  }, [q, region]);

  const pending = LICENSE_REQUIRED.filter((t) => !t.licensed && (!q.trim() || `${t.id} ${t.name}`.toLowerCase().includes(q.trim().toLowerCase())));

  const download = async (t) => {
    if (progress[t.id] !== undefined) return;
    if (offline[t.id]) {
      await removeDownload(t.id);
      setOffline((o) => { const n = { ...o }; delete n[t.id]; return n; });
      toast.show(`${t.id} removed from this device`, { icon: 'trash' });
      return;
    }
    setProgress((p) => ({ ...p, [t.id]: 0.02 }));
    try {
      await downloadTranslation(t.id, (x) => setProgress((p) => ({ ...p, [t.id]: x })));
      setOffline((o) => ({ ...o, [t.id]: true }));
      dispatch({ type: 'downloadedTranslation', code: t.id });
      toast.show(`${t.id} is ready offline`, { icon: 'check-circle', haptic: 'success' });
    } catch (e) {
      toast.show('Download failed — check your connection', { tone: 'error' });
    } finally {
      setProgress((p) => { const n = { ...p }; delete n[t.id]; return n; });
    }
  };

  const notify = (t) => {
    toast.show(`We'll let you know when ${t.id} is licensed`, { icon: 'bell', haptic: 'light' });
  };

  let lastRegion = null;
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <Icon name="search" size={16} color={colors.faint} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search translations or languages"
          placeholderTextColor={colors.faint}
          style={styles.search}
          autoCorrect={false}
        />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={10}><Icon name="x" size={15} color={colors.muted} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={styles.regions}>
        {['All', ...TRANSLATION_REGIONS].map((r) => (
          <PressScale key={r} onPress={() => setRegion(r)} style={[styles.regionPill, region === r && styles.regionPillOn]}>
            <Text style={[styles.regionText, region === r && styles.regionTextOn]}>{r}</Text>
          </PressScale>
        ))}
      </ScrollView>
      <Text style={styles.count}>{TRANSLATIONS.length} translations · {LANGUAGE_COUNT} languages · free to read</Text>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {list.map((t, i) => {
          const header = t.region !== lastRegion ? t.region : null;
          lastRegion = t.region;
          const isActive = mode === 'read' ? t.id === active : compareWith.includes(t.id);
          const pr = progress[t.id];
          return (
            <View key={t.id}>
              {header ? <Text style={styles.regionHead}>{header}</Text> : null}
              <FadeInUp index={Math.min(i, 8)} distance={8} duration={300}>
                <PressScale
                  onPress={() => (mode === 'read' ? onPick(t.id) : onToggleCompare(t.id))}
                  scaleTo={0.985}
                  style={[styles.row, isActive && styles.rowActive]}
                >
                  <View style={[styles.code, isActive && styles.codeActive]}>
                    <Text style={[styles.codeText, isActive && { color: '#FFFFFF' }]} numberOfLines={1} adjustsFontSizeToFit>{t.id}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {t.lang}{t.year ? ` · ${t.year}` : ''} · {t.licence}{t.badge ? ` · ${t.badge}` : ''}
                    </Text>
                    {pr !== undefined ? (
                      <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(pr * 100)}%` }]} /></View>
                    ) : null}
                  </View>
                  {mode === 'compare' ? (
                    <View style={[styles.check, isActive && styles.checkOn]}>{isActive ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={2.6} /> : null}</View>
                  ) : isActive ? (
                    <Text style={styles.activeLabel}>Reading</Text>
                  ) : null}
                  {t.bundled ? (
                    <View style={styles.dlBtn}><Icon name="check-circle" size={18} color={colors.positive || colors.primary} /></View>
                  ) : canDownload ? (
                    <Pressable onPress={() => download(t)} hitSlop={8} style={styles.dlBtn} accessibilityLabel={offline[t.id] ? `Remove ${t.id} download` : `Download ${t.id} for offline`}>
                      {pr !== undefined ? <ActivityIndicator size="small" color={colors.primary} />
                        : <Icon name={offline[t.id] ? 'check-circle' : 'download'} size={18} color={offline[t.id] ? colors.primary : colors.muted} />}
                    </Pressable>
                  ) : null}
                </PressScale>
              </FadeInUp>
            </View>
          );
        })}
        {!list.length ? <Text style={styles.empty}>No translation matches “{q}”.</Text> : null}

        {mode === 'read' && pending.length && (region === 'All' || region === 'English') ? (
          <View style={styles.pendingCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="lock" size={15} color={colors.gold} />
              <Text style={styles.pendingTitle}>Coming with a publisher licence</Text>
            </View>
            <Text style={styles.pendingBody}>
              These popular versions are copyrighted. We’re requesting licences from their publishers — they’ll appear here as soon as they’re approved.
            </Text>
            {pending.map((t) => (
              <Pressable key={t.id} onPress={() => notify(t)} style={({ pressed }) => [styles.pendingRow, pressed && { opacity: 0.6 }]}>
                <Text style={styles.pendingCode}>{t.id}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pendingName} numberOfLines={1}>{t.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{t.publisher}</Text>
                </View>
                <Icon name="bell" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {!canDownload ? <Text style={styles.footNote}>In the mobile app, chapters you open are saved for offline reading and whole translations can be downloaded.</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, paddingHorizontal: 14, height: 44, borderRadius: 14, backgroundColor: colors.raised },
  search: { flex: 1, fontSize: 15, color: colors.fg, paddingVertical: 0, outlineStyle: 'none' },
  regions: { gap: 8, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  regionPill: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  regionPillOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  regionText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  regionTextOn: { color: '#FFFFFF' },
  count: { fontSize: 11.5, color: colors.faint, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 2 },
  regionHead: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, marginBottom: 4 },
  rowActive: { backgroundColor: colors.primarySoft },
  code: { width: 48, height: 36, borderRadius: 10, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  codeActive: { backgroundColor: colors.primary },
  codeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: colors.primary },
  name: { fontFamily: fonts.serifMedium, fontSize: 16, color: colors.fg },
  meta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  activeLabel: { fontSize: 11, fontWeight: '700', color: colors.primary },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dlBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 3, borderRadius: 2, backgroundColor: colors.border, marginTop: 6, overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: colors.primary },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 30 },
  pendingCard: { marginTop: 22, padding: 16, borderRadius: radius.lg || 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pendingTitle: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg },
  pendingBody: { fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 6, marginBottom: 6 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pendingCode: { width: 48, fontSize: 12, fontWeight: '800', color: colors.faint },
  pendingName: { fontSize: 14, color: colors.fg },
  footNote: { fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 20, lineHeight: 17 },
});
