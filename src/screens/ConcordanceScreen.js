// Concordance & Strong's lexicon — fully in-app (no links out to other websites).
// • Search any English word, transliteration or Strong's number (G26, H430).
// • Opened from a verse, it shows that verse word-by-word with each word's Strong's number.
// • Definitions come from Thayer's Greek and Brown-Driver-Briggs Hebrew lexicons (public domain);
//   cross-links inside a definition open the linked entry here, and "Where it appears" searches the
//   bundled KJV offline.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { CONCORDANCE, refLabel, searchBible } from '../data/bible';
import { loadStrong, loadTaggedChapter, parseDefinition, searchLexicon, useAsync } from '../bible/study';
import { PressScale, FadeInUp, ScaleIn, Shimmer } from '../components/Motion';

const POPULAR = CONCORDANCE.map((c) => ({ strong: c.strong, translit: c.translit, lemma: c.lemma, gloss: (c.definition || '').split(/[,.;]/)[0] }));

export default function ConcordanceScreen({ params = {} }) {
  const nav = useNav();
  const { dispatch } = useStore();
  const toast = useToast();
  const [query, setQuery] = useState(params.query || '');
  const [debounced, setDebounced] = useState(params.query || '');
  const [strong, setStrong] = useState(params.strong || null);
  const [word, setWord] = useState(params.word || null); // English word tapped in a verse
  const [history, setHistory] = useState([]);

  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 350); return () => clearTimeout(t); }, [query]);

  // Verse mode: the tapped verse, word by word
  const hasVerse = !!(params.bookId && params.chapter && params.verse);
  const tagged = useAsync(() => (hasVerse ? loadTaggedChapter(params.bookId, params.chapter) : Promise.resolve(null)), [params.bookId, params.chapter]);
  const verseWords = hasVerse && tagged.data ? tagged.data[params.verse - 1] || [] : [];

  const results = useAsync(() => (debounced.length >= 2 ? searchLexicon(debounced) : Promise.resolve(null)), [debounced]);
  const entry = useAsync(() => (strong ? loadStrong(strong) : Promise.resolve(null)), [strong]);

  // Default selection: first search result, else first tagged word of the verse
  useEffect(() => {
    if (!strong && results.data && results.data[0]) setStrong(results.data[0].strong);
  }, [results.data]);
  useEffect(() => {
    if (!strong && verseWords.length) {
      const first = verseWords.find((w) => w.s && !/^(the|and|of|a|to|in|that|for|unto|is|was|he|it)$/i.test(w.w));
      if (first) { setStrong(first.s); setWord(first.w); }
    }
  }, [verseWords.length]);

  const open = (code, w = null) => {
    if (!code) return;
    if (strong && code !== strong) setHistory((h) => [...h, { strong, word }].slice(-10));
    setStrong(code);
    setWord(w);
  };
  const back = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setStrong(prev.strong);
    setWord(prev.word);
  };

  const e = entry.data;
  const blocks = useMemo(() => (e ? parseDefinition(e.html) : []), [e]);
  const findWord = (word || (e && e.gloss) || '').replace(/[^A-Za-z' -]/g, '').trim();
  const occurrences = useMemo(() => (findWord.length >= 3 ? searchBible(findWord, 'KJV', e && e.lang === 'Hebrew' ? 'OT' : e ? 'NT' : 'ALL', 12) : []), [findWord, e]);

  const save = () => {
    if (!e) return;
    dispatch({ type: 'saveAnswer', a: { question: `${e.strong} · ${e.translit}`, blocks: [{ type: 'Lexicon', source: e.lang === 'Greek' ? "Thayer's Greek Lexicon" : 'Brown-Driver-Briggs', text: `${e.lemma} (${e.translit}) — ${e.gloss}` }] } });
    toast.show('Word study saved to your library', { icon: 'bookmark', haptic: 'success', action: { label: 'View', onPress: () => nav.push('Library') } });
  };
  const share = async () => {
    if (!e) return;
    try { await Share.share({ message: `${e.lemma} (${e.translit}, ${e.strong}) — ${e.gloss}. Studied on BibleNestra.` }); } catch (err) { /* cancelled */ }
  };

  const listItems = results.data || (debounced.length >= 2 ? [] : POPULAR);

  return (
    <Screen back title="Concordance & Lexicon" subtitle="Strong's Greek & Hebrew · in-app" scroll={false} padded={false}>
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput
            placeholder="English word, Greek/Hebrew word or G26 / H430"
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={(v) => { setQuery(v); if (v.trim().length >= 2) setStrong(null); }}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {results.loading && debounced.length >= 2 ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          {query ? (
            <ScaleIn>
              <PressScale onPress={() => setQuery('')} hitSlop={10} scaleTo={0.85} style={styles.clearBtn} accessibilityLabel="Clear search">
                <Icon name="x" size={12} color={colors.muted} strokeWidth={2.6} />
              </PressScale>
            </ScaleIn>
          ) : null}
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {hasVerse ? (
          <FadeInUp style={styles.verseBox}>
            <Text style={styles.verseBoxRef}>{refLabel(params.bookId, params.chapter, params.verse)} · KJV with Strong's</Text>
            {tagged.loading ? <Shimmer style={{ height: 54, borderRadius: 12, marginTop: 10 }} /> : null}
            {tagged.error ? <Text style={styles.offline}>Word-by-word view needs a connection the first time. It's saved for offline after that.</Text> : null}
            <View style={styles.wordWrap}>
              {verseWords.map((w, i) => {
                const on = w.s && w.s === strong;
                return w.s ? (
                  <PressScale key={i} onPress={() => open(w.s, w.w)} scaleTo={0.92} style={[styles.wordChip, on && styles.wordChipOn]}>
                    <Text style={[styles.wordChipText, on && { color: '#FFFFFF' }]}>{w.w}</Text>
                    <Text style={[styles.wordChipNum, on && { color: colors.goldLight }]}>{w.s}</Text>
                  </PressScale>
                ) : (
                  <Text key={i} style={styles.plainWord}>{w.w}</Text>
                );
              })}
            </View>
          </FadeInUp>
        ) : null}

        {/* Index / search results */}
        <Text style={styles.colHeader}>
          {debounced.length >= 2 ? (results.loading ? 'Searching the lexicon…' : `${listItems.length} ${listItems.length === 1 ? 'entry' : 'entries'} for “${debounced}”`) : 'Popular word studies'}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 10, paddingBottom: 6 }}>
          {listItems.map((item, index) => {
            const active = strong === item.strong;
            return (
              <FadeInUp key={item.strong + index} index={Math.min(index, 8)} distance={10} duration={320}>
                <PressScale onPress={() => open(item.strong)} scaleTo={0.94} style={[styles.wordItem, active && styles.wordItemActive]} accessibilityLabel={`${item.translit}, ${item.strong}`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.wordTranslit, active && { color: colors.nightFg }]} numberOfLines={1}>{item.translit}</Text>
                    <Text style={[styles.strongNumberBadge, active && { color: colors.goldLight }]}>{item.strong}</Text>
                  </View>
                  <Text style={[styles.lemmaText, active && { color: colors.nightMuted }]} numberOfLines={1}>{item.lemma}</Text>
                  <Text style={[styles.countText, active && { color: colors.nightMuted }]} numberOfLines={1}>{item.gloss}</Text>
                </PressScale>
              </FadeInUp>
            );
          })}
        </ScrollView>
        {results.error ? <Text style={[styles.offline, { marginHorizontal: 18 }]}>You're offline — the lexicon search needs a connection. Words you've already opened still work.</Text> : null}
        {!results.loading && results.data && !results.data.length ? (
          <Text style={[styles.offline, { marginHorizontal: 18 }]}>No entries match “{debounced}”. Try another English word (e.g. grace) or a Strong's number like G5485.</Text>
        ) : null}

        {/* Entry */}
        <View style={{ paddingHorizontal: 18, marginTop: 10 }}>
          {entry.loading && strong ? (
            <View style={styles.detailCard}>
              <Shimmer style={{ height: 34, width: '50%', borderRadius: 8 }} />
              <Shimmer style={{ height: 14, width: '70%', borderRadius: 6, marginTop: 12 }} />
              <Shimmer style={{ height: 90, borderRadius: 10, marginTop: 18 }} />
            </View>
          ) : entry.error ? (
            <View style={styles.detailCard}><Text style={styles.offline}>This entry isn't saved on your device yet. Connect to the internet to open {strong}.</Text></View>
          ) : e ? (
            <FadeInUp key={e.strong} distance={10} duration={320}>
              <View style={styles.detailCard}>
                {history.length ? (
                  <Pressable onPress={back} hitSlop={8} style={styles.backLink}>
                    <Icon name="chevron-left" size={14} color={colors.primary} />
                    <Text style={styles.backLinkText}>Back to {history[history.length - 1].strong}</Text>
                  </Pressable>
                ) : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.detailLemma, e.lang === 'Hebrew' && { writingDirection: 'rtl' }]}>{e.lemma}</Text>
                    <Text style={styles.detailTranslit}>{e.translit}</Text>
                  </View>
                  <View style={styles.strongTag}><Text style={styles.strongTagText}>{e.strong}</Text></View>
                </View>
                <View style={styles.phoneticRow}>
                  <Text style={styles.phoneticText}>/{e.pronun}/ · {e.lang}</Text>
                  {word ? <Text style={styles.partOfSpeech}>KJV: “{word}”</Text> : null}
                </View>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>{e.lang === 'Greek' ? "Thayer's Greek Lexicon" : 'Brown-Driver-Briggs Hebrew Lexicon'}</Text>
                {blocks.map((b, i) => (
                  <Text key={i} style={[styles.defText, b.type === 'li' && { paddingLeft: 12 * Math.max(1, b.depth) }]}>
                    {b.type === 'li' ? <Text style={{ color: colors.gold }}>•  </Text> : null}
                    {b.parts.map((p, j) => (p.link ? (
                      <Text key={j} onPress={() => open(p.link)} style={styles.defLink}>{p.text}</Text>
                    ) : (
                      <Text key={j} style={[p.b && { fontWeight: '700', color: colors.fg }, p.i && { fontStyle: 'italic' }]}>{p.text}</Text>
                    )))}
                  </Text>
                ))}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <PressScale onPress={save} scaleTo={0.95} style={styles.actBtn}><Icon name="bookmark" size={14} color={colors.primary} /><Text style={styles.actBtnText}>Save</Text></PressScale>
                  <PressScale onPress={share} scaleTo={0.95} style={styles.actBtn}><Icon name="share" size={14} color={colors.primary} /><Text style={styles.actBtnText}>Share</Text></PressScale>
                  <PressScale onPress={() => nav.push('BibleChat', { seed: `Explain the ${e.lang} word ${e.translit} (${e.strong}) and how it's used in Scripture.`, send: true })} scaleTo={0.95} style={styles.actBtn}><Icon name="sparkles" size={14} color={colors.primary} /><Text style={styles.actBtnText}>Ask about it</Text></PressScale>
                </View>
              </View>

              {occurrences.length ? (
                <View style={styles.versesSection}>
                  <Text style={styles.versesHead}>Where “{findWord}” appears</Text>
                  <Text style={styles.versesSub}>King James Version · {e.lang === 'Hebrew' ? 'Old' : 'New'} Testament</Text>
                  {occurrences.map((v, i) => (
                    <FadeInUp key={`${v.bookId}${v.chapter}${v.verse}`} index={Math.min(i, 6)} delay={100} distance={8}>
                      <PressScale onPress={() => nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verse })} scaleTo={0.98} style={styles.verseCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.verseRefText}>{refLabel(v.bookId, v.chapter, v.verse)}</Text>
                          <View style={styles.tapToStudyBtn}><Text style={styles.tapToStudyText}>Open</Text><Icon name="chevron-right" size={12} color={colors.primary} /></View>
                        </View>
                        <Text style={styles.verseBodyText}>{v.text}</Text>
                      </PressScale>
                    </FadeInUp>
                  ))}
                  <PressScale onPress={() => nav.push('Search', { query: findWord })} scaleTo={0.97} style={[styles.actBtn, { alignSelf: 'center', marginTop: 6 }]}>
                    <Text style={styles.actBtnText}>See every occurrence</Text>
                  </PressScale>
                </View>
              ) : null}
            </FadeInUp>
          ) : !hasVerse ? (
            <View style={[styles.detailCard, { alignItems: 'center' }]}>
              <Icon name="book" size={26} color={colors.gold} />
              <Text style={[styles.detailTranslit, { textAlign: 'center', marginTop: 8 }]}>Search a word or pick one above to open its full lexicon entry.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 16, height: 46, ...shadow.sm },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.fg, outlineStyle: 'none' },
  clearBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  verseBox: { marginHorizontal: 18, marginTop: 8, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  verseBoxRef: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.gold },
  wordWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' },
  wordChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: colors.raised, alignItems: 'center' },
  wordChipOn: { backgroundColor: colors.night },
  wordChipText: { fontFamily: fonts.serif, fontSize: 16, color: colors.fg },
  wordChipNum: { fontSize: 9.5, fontWeight: '700', color: colors.primary, marginTop: 1 },
  plainWord: { fontFamily: fonts.serif, fontSize: 16, color: colors.faint, paddingHorizontal: 2 },
  colHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: colors.muted, paddingHorizontal: 18, marginTop: 16, marginBottom: 10 },
  wordItem: { width: 168, padding: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  wordItemActive: { backgroundColor: colors.night, borderColor: colors.night },
  wordTranslit: { flex: 1, fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg },
  strongNumberBadge: { fontSize: 11, fontWeight: '800', color: colors.primary },
  lemmaText: { fontSize: 13, color: colors.muted, marginTop: 4 },
  countText: { fontSize: 11.5, color: colors.faint, marginTop: 3 },
  offline: { fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 8 },
  detailCard: { padding: 18, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  backLinkText: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  detailLemma: { fontFamily: fonts.serif, fontSize: 34, color: colors.fg },
  detailTranslit: { fontFamily: fonts.serifItalic, fontSize: 17, color: colors.muted, marginTop: 2 },
  strongTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.primarySoft },
  strongTagText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  phoneticRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10 },
  phoneticText: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  partOfSpeech: { fontSize: 12, fontWeight: '600', color: colors.gold },
  glossBox: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.raised, alignSelf: 'flex-start' },
  glossText: { fontFamily: fonts.serifMedium, fontSize: 15, color: colors.fg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: 16 },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gold, marginBottom: 8 },
  defText: { fontSize: 14.5, lineHeight: 22, color: colors.passage, marginBottom: 6 },
  defLink: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.primarySoft },
  actBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  versesSection: { marginTop: 22 },
  versesHead: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg },
  versesSub: { fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 12 },
  verseCard: { padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  verseRefText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: colors.gold },
  tapToStudyBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tapToStudyText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  verseBodyText: { fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 23, color: colors.passage, marginTop: 6 },
});
