import React, { useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Badge, Tag, Button } from '../components/ui';
import { colors, fonts } from '../theme';
import { useNav } from '../navigation';
import { useStore } from '../store';
import { CONCORDANCE, searchConcordance, getStrongExternalUrl } from '../data/bible';

export default function ConcordanceScreen({ params = {} }) {
  const nav = useNav();
  const { state } = useStore();
  const [query, setQuery] = useState(params.query || '');
  const [selectedWord, setSelectedWord] = useState(CONCORDANCE[0]);

  const results = searchConcordance(query);

  return (
    <Screen back title="Bible Concordance & Lexicon" subtitle="Strong's Greek & Hebrew Word Study" scroll={false}>
      {/* Search Input */}
      <View style={styles.searchBar}>
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" style={{ marginRight: 8 }}>
          <Path d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" stroke={colors.muted} strokeWidth={1.8} />
        </Svg>
        <TextInput
          placeholder="Search by English word, lemma, or Strong's # (e.g. G2424, love, shalom)..."
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Left Side: Word Index List */}
        <View style={styles.leftCol}>
          <Text style={styles.colHeader}>WORDS ({results.length})</Text>
          <FlatList
            data={results}
            keyExtractor={(item) => item.strong}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const active = selectedWord?.strong === item.strong;
              return (
                <Pressable
                  onPress={() => setSelectedWord(item)}
                  style={[styles.wordItem, active && styles.wordItemActive]}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.wordTranslit, active && { color: colors.gold }]}>
                      {item.translit}
                    </Text>
                    <Text style={styles.strongNumberBadge}>{item.strong}</Text>
                  </View>
                  <Text style={styles.lemmaText}>{item.lemma} · {item.lang}</Text>
                  <Text style={styles.countText}>{item.count} occurrences</Text>
                </Pressable>
              );
            }}
          />
        </View>

        {/* Right Side: Lexicon Definition & Occurrences Details */}
        <View style={styles.rightCol}>
          {selectedWord ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {/* Word Header Card */}
              <View style={styles.detailCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View>
                    <Text style={styles.detailTranslit}>{selectedWord.translit}</Text>
                    <Text style={styles.detailLemma}>{selectedWord.lemma} ({selectedWord.lang})</Text>
                  </View>
                  <View style={styles.strongTag}>
                    <Text style={styles.strongTagText}>{selectedWord.strong}</Text>
                  </View>
                </View>

                <View style={styles.phoneticRow}>
                  <Text style={styles.phoneticText}>Pronunciation: <Text style={{ color: colors.fg }}>{selectedWord.pronun}</Text></Text>
                  <Text style={styles.partOfSpeech}>{selectedWord.part}</Text>
                </View>

                <View style={styles.divider} />

                <Text style={styles.sectionLabel}>DEFINITION & THEOLOGICAL MEANING</Text>
                <Text style={styles.defText}>{selectedWord.definition}</Text>
                <Text style={styles.meaningText}>"{selectedWord.meaning}"</Text>

                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>ORIGIN & ROOT</Text>
                <Text style={styles.originText}>{selectedWord.origin}</Text>

                {/* External Strong's Lexicon Lookups (from mielke.cc) */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                  <Pressable
                    onPress={() => {
                      const url = getStrongExternalUrl(selectedWord.lang, selectedWord.strong, 'biblehub');
                      if (url) Linking.openURL(url);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: colors.cardSage,
                      paddingVertical: 8,
                      borderRadius: 8,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: 'rgba(30, 81, 40, 0.15)',
                    }}
                  >
                    <Text style={{ color: colors.forest, fontWeight: '700', fontSize: 11 }}>Bible Hub Lexicon ↗</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const url = getStrongExternalUrl(selectedWord.lang, selectedWord.strong, 'studybible');
                      if (url) Linking.openURL(url);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: colors.cardSage,
                      paddingVertical: 8,
                      borderRadius: 8,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: 'rgba(30, 81, 40, 0.15)',
                    }}
                  >
                    <Text style={{ color: colors.forest, fontWeight: '700', fontSize: 11 }}>Study Bible Strong's ↗</Text>
                  </Pressable>
                </View>
              </View>

              {/* Verses & Tap-To-Study */}
              <View style={styles.versesSection}>
                <Text style={styles.sectionLabel}>
                  KEY PASSAGES IN {state.translation} ({selectedWord.verses.length})
                </Text>

                {selectedWord.verses.map((v, i) => (
                  <View key={i} style={styles.verseCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.verseRefText}>{v.ref}</Text>
                      <Pressable
                        onPress={() => nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verse })}
                        style={styles.tapToStudyBtn}
                      >
                        <Text style={styles.tapToStudyText}>Tap-to-Study ›</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.verseBodyText}>"{v.text}"</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.emptyState}>
              <Text style={{ color: colors.muted }}>Select a word from the lexicon index.</Text>
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.fg,
  },
  leftCol: {
    width: 140,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  rightCol: {
    flex: 1,
    backgroundColor: colors.screen,
    padding: 14,
  },
  colHeader: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
  },
  wordItem: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  wordItemActive: {
    backgroundColor: colors.raised,
    borderLeftWidth: 2.5,
    borderLeftColor: colors.gold,
  },
  wordTranslit: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.fg,
  },
  strongNumberBadge: {
    fontFamily: fonts.sans,
    fontSize: 9.5,
    color: colors.faint,
  },
  lemmaText: {
    fontFamily: fonts.serif,
    fontSize: 11,
    color: colors.sage,
    marginTop: 2,
  },
  countText: {
    fontFamily: fonts.sans,
    fontSize: 9.5,
    color: colors.faint,
    marginTop: 2,
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
  },
  detailTranslit: {
    fontFamily: fonts.sansMedium,
    fontSize: 18,
    fontWeight: '700',
    color: colors.fg,
  },
  detailLemma: {
    fontFamily: fonts.serif,
    fontSize: 13,
    color: colors.gold,
    marginTop: 2,
  },
  strongTag: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  strongTagText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.gold,
    fontWeight: '700',
  },
  phoneticRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  phoneticText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
  },
  partOfSpeech: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.sage,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: colors.rule,
    marginVertical: 10,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
    marginBottom: 4,
  },
  defText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.passage,
  },
  meaningText: {
    fontFamily: fonts.serif,
    fontSize: 12.5,
    color: colors.gold,
    fontStyle: 'italic',
    marginTop: 4,
  },
  originText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  versesSection: {
    marginTop: 14,
  },
  verseCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  verseRefText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '700',
    color: colors.gold,
  },
  tapToStudyBtn: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tapToStudyText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.fg,
  },
  verseBodyText: {
    fontFamily: fonts.serif,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.passage,
    marginTop: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
