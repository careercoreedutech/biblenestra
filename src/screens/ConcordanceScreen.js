import React, { useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Badge, Tag, Button } from '../components/ui';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useStore } from '../store';
import { CONCORDANCE, searchConcordance, getStrongExternalUrl } from '../data/bible';
import { PressScale, FadeInUp, ScaleIn, AnimatedNumber } from '../components/Motion';

export default function ConcordanceScreen({ params = {} }) {
  const nav = useNav();
  const { state } = useStore();
  const [query, setQuery] = useState(params.query || '');
  const [selectedWord, setSelectedWord] = useState(CONCORDANCE[0]);

  const results = searchConcordance(query);

  const LinkBtn = ({ label, server }) => (
    <PressScale
      onPress={() => {
        const url = getStrongExternalUrl(selectedWord.lang, selectedWord.strong, server);
        if (url) Linking.openURL(url);
      }}
      scaleTo={0.95}
      style={styles.linkBtn}
    >
      <Text style={styles.linkBtnText}>{label}</Text>
      <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
        <Path d="M7 17L17 7M9 7h8v8" stroke={colors.primary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </PressScale>
  );

  return (
    <Screen back title="Concordance & Lexicon" subtitle="Strong's Greek & Hebrew word study" scroll={false} padded={false}>
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ marginRight: 10 }}>
            <Path d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" />
          </Svg>
          <TextInput
            placeholder="Word, lemma or Strong's # (G2424, love…)"
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
          />
          {query ? (
            <ScaleIn>
              <PressScale onPress={() => setQuery('')} hitSlop={10} scaleTo={0.85} style={styles.clearBtn} accessibilityLabel="Clear search">
                <Svg width={10} height={10} viewBox="0 0 24 24" fill="none"><Path d="M6 6l12 12M18 6L6 18" stroke={colors.muted} strokeWidth={3} strokeLinecap="round" /></Svg>
              </PressScale>
            </ScaleIn>
          ) : null}
        </View>
      </View>

      <View>
        <View style={styles.colHeaderRow}>
          <AnimatedNumber value={results.length} style={styles.colHeader} duration={400} />
          <Text style={styles.colHeader}>{results.length === 1 ? 'word' : 'words'} in the index</Text>
        </View>
        <FlatList
          horizontal
          data={results}
          keyExtractor={(item) => item.strong}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 18, gap: 10, paddingBottom: 14 }}
          renderItem={({ item, index }) => {
            const active = selectedWord?.strong === item.strong;
            return (
              <FadeInUp index={index} distance={10} duration={340}>
              <PressScale onPress={() => setSelectedWord(item)} scaleTo={0.94} style={[styles.wordItem, active && styles.wordItemActive]} accessibilityLabel={`${item.translit}, ${item.strong}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.wordTranslit, active && { color: colors.nightFg }]} numberOfLines={1}>{item.translit}</Text>
                  <Text style={[styles.strongNumberBadge, active && { color: colors.goldLight }]}>{item.strong}</Text>
                </View>
                <Text style={[styles.lemmaText, active && { color: colors.nightMuted }]} numberOfLines={1}>{item.lemma} · {item.lang}</Text>
                <Text style={[styles.countText, active && { color: colors.nightMuted }]}>{item.count} occurrences</Text>
              </PressScale>
              </FadeInUp>
            );
          }}
        />
        {!results.length ? (
          <FadeInUp distance={6} duration={260} style={styles.noMatch}>
            <Text style={styles.noMatchText}>No words match “{query.trim()}”. Try an English word like love, or a Strong’s number like G26.</Text>
          </FadeInUp>
        ) : null}
      </View>

      <View style={styles.rightCol}>
        {selectedWord ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
            {/* Keyed on the word so switching words cross-fades the whole study in. */}
            <FadeInUp key={selectedWord.strong} distance={10} duration={320}>
            <View style={styles.detailCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLemma}>{selectedWord.lemma}</Text>
                  <Text style={styles.detailTranslit}>{selectedWord.translit}</Text>
                </View>
                <View style={styles.strongTag}>
                  <Text style={styles.strongTagText}>{selectedWord.strong}</Text>
                </View>
              </View>

              <View style={styles.phoneticRow}>
                <Text style={styles.phoneticText}>/{selectedWord.pronun}/ · {selectedWord.lang}</Text>
                <Text style={styles.partOfSpeech}>{selectedWord.part}</Text>
              </View>

              <View style={styles.divider} />

              <Text style={styles.sectionLabel}>Definition</Text>
              <Text style={styles.defText}>{selectedWord.definition}</Text>
              <Text style={styles.meaningText}>“{selectedWord.meaning}”</Text>

              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Origin & root</Text>
              <Text style={styles.originText}>{selectedWord.origin}</Text>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <LinkBtn label="Bible Hub" server="biblehub" />
                <LinkBtn label="Study Bible" server="studybible" />
              </View>
            </View>

            <View style={styles.versesSection}>
              <Text style={styles.versesHead}>Key passages</Text>
              <Text style={styles.versesSub}>{selectedWord.verses.length} in {state.translation}</Text>

              {selectedWord.verses.map((v, i) => (
                <FadeInUp key={i} index={i} delay={140} distance={8}>
                <PressScale
                  onPress={() => nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verse })}
                  scaleTo={0.98}
                  style={styles.verseCard}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.verseRefText}>{v.ref}</Text>
                    <View style={styles.tapToStudyBtn}>
                      <Text style={styles.tapToStudyText}>Open</Text>
                      <Svg width={11} height={11} viewBox="0 0 24 24" fill="none"><Path d="M9 6l6 6-6 6" stroke={colors.primary} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /></Svg>
                    </View>
                  </View>
                  <Text style={styles.verseBodyText}>{v.text}</Text>
                </PressScale>
                </FadeInUp>
              ))}
            </View>
            </FadeInUp>
          </ScrollView>
        ) : (
          <View style={styles.emptyState}>
            <Text style={{ color: colors.muted }}>Select a word from the lexicon index.</Text>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    height: 46,
    ...shadow.sm,
  },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.fg },
  clearBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  rightCol: { flex: 1, backgroundColor: colors.screen },
  colHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
  colHeader: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold },
  wordItem: {
    width: 150,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  wordItemActive: { backgroundColor: colors.night, borderColor: colors.night },
  wordTranslit: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.fg },
  strongNumberBadge: { fontSize: 10.5, fontWeight: '700', color: colors.gold },
  lemmaText: { fontFamily: fonts.serif, fontSize: 14, color: colors.muted, marginTop: 4 },
  countText: { fontSize: 11, color: colors.faint, marginTop: 4 },
  detailCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 18, ...shadow.sm },
  detailLemma: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.fg },
  detailTranslit: { fontSize: 15, fontWeight: '600', color: colors.primary, marginTop: 2 },
  strongTag: { backgroundColor: colors.cardGold, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  strongTagText: { fontSize: 12, color: colors.goldMuted, fontWeight: '800', letterSpacing: 0.4 },
  phoneticRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8 },
  phoneticText: { fontSize: 12.5, color: colors.muted, flexShrink: 1 },
  partOfSpeech: { fontSize: 11.5, fontWeight: '600', color: colors.sage, backgroundColor: colors.cardSage, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: 16 },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginBottom: 6 },
  defText: { fontSize: 14, lineHeight: 21, color: colors.fg },
  meaningText: { fontFamily: fonts.serifItalic, fontSize: 17, lineHeight: 24, color: colors.primaryInk, marginTop: 8 },
  originText: { fontSize: 13.5, lineHeight: 20, color: colors.muted },
  linkBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBtnText: { color: colors.primary, fontWeight: '700', fontSize: 12.5 },
  versesSection: { marginTop: 26 },
  versesHead: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg },
  versesSub: { fontSize: 12, color: colors.muted, marginTop: 1, marginBottom: 6 },
  verseCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginTop: 8 },
  verseRefText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: colors.gold },
  tapToStudyBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tapToStudyText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  verseBodyText: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, color: colors.passage, marginTop: 6 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noMatch: { marginHorizontal: 18, marginBottom: 14, padding: 12, borderRadius: radius.md, backgroundColor: colors.raised },
  noMatchText: { fontSize: 13, lineHeight: 18.5, color: colors.muted },
});
