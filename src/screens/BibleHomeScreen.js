// The Bible tab's home, rebuilt in the Figma "Bible" design (src/design/sanctuary.js), on real data:
// search entry, "Continue reading" (state.lastPosition), translation chips + Compare, the 66 books with
// Old / New Testament tabs (real book metadata), Beyond the 66, and the study tools.
// Tapping a book or Continue opens the reader (BibleScreen) pushed on top of this screen.
import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { BOOKS } from '../data/bible';
import { resolveTranslationId, translationInfo } from '../bible/catalog';
import { showBookListAd } from '../ads/breaks'; // 66 BOOKS AD: one interstitial the first time, then subject to the caps
import { d, df, k, gradients, Grad, Tap, Eyebrow, PageHeader, IconButton, SectionTitle } from '../design/sanctuary';
import { colors } from '../theme';

// Common translations offered next to the reader's own (all present in src/bible/catalog.js)
const COMMON_TRANSLATIONS = ['KJV', 'BSB', 'WEB', 'ASV'];
const TESTAMENTS = [
  ['OT', 'Old Testament'],
  ['NT', 'New Testament'],
];

export default function BibleHomeScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const toast = useToast();
  const [testament, setTestament] = useState('OT');
  const scrollRef = useRef(null);
  const browseY = useRef(0);

  const current = resolveTranslationId(state.translation);
  const translations = [current, ...COMMON_TRANSLATIONS.filter((id) => id !== current)];

  const lp = state.lastPosition || { bookId: BOOKS[0].id, chapter: 1 };
  const lastBook = BOOKS.find((b) => b.id === lp.bookId) || BOOKS[0];
  const percent = lastBook.chapters ? Math.min(100, Math.round((lp.chapter / lastBook.chapters) * 100)) : 0;

  // Same as BibleScreen's translation picker: store the choice, say so when it changes
  const setTranslation = (id) => {
    dispatch({ type: 'set', patch: { translation: id } });
    if (id !== current) toast.show(`Reading in ${translationInfo(id).name}`, { icon: 'bible', haptic: 'select' });
  };

  const openReader = (bookId, chapter) => nav.push('Bible', { bookId, chapter });
  const books = BOOKS.filter((b) => b.testament === testament);

  // 66 Books: the first time (and on later visits, subject to the caps) one interstitial plays before the list opens.
  // Never during reading. showBookListAd resolves quickly when no ad is ready, so the list always opens.
  const open66Books = async () => {
    try { await showBookListAd(); } catch (e) { /* the list still opens */ }
    if (scrollRef.current) scrollRef.current.scrollTo({ y: Math.max(0, browseY.current - 8), animated: true });
  };

  // Visible feature navigation (always shown, directly below the top section). Each tile opens a real screen.
  const features = [
    { key: 'compare', label: 'Compare Translations', icon: 'bible', onPress: () => nav.push('Bible', { bookId: lp.bookId, chapter: lp.chapter, compare: true }) },
    { key: 'books', label: '66 Books', icon: 'book', onPress: open66Books },
    { key: 'commentary', label: 'Commentary', icon: 'book', onPress: () => nav.push('Study', { bookId: lp.bookId, chapter: lp.chapter, tab: 'Commentary' }) },
    { key: 'concordance', label: 'Concordance', icon: 'search', onPress: () => nav.push('Concordance', {}) },
    { key: 'dictionary', label: 'Bible Dictionary', icon: 'bookmark', onPress: () => nav.push('Factbook', {}) },
    { key: 'hebrew', label: 'Hebrew & Greek', icon: 'sparkles', onPress: () => nav.push('Study', { bookId: lp.bookId, chapter: lp.chapter, tab: 'Word study' }) },
    { key: 'references', label: 'Scripture References', icon: 'link', onPress: () => nav.push('Study', { bookId: lp.bookId, chapter: lp.chapter, tab: 'Cross-references' }) },
    { key: 'exegesis', label: 'Exegesis', icon: 'sparkles', onPress: () => nav.push('Exegesis', { bookId: lp.bookId, chapter: lp.chapter }) },
    { key: 'search', label: 'Search', icon: 'search', onPress: () => nav.push('Search', {}) },
    { key: 'beyond', label: 'Beyond the 66', icon: 'book', onPress: () => nav.push('ExtraBooks') },
    { key: 'saved', label: 'Saved & Library', icon: 'bookmark', onPress: () => nav.push('Library', {}) },
    { key: 'audio', label: 'Audio', icon: 'headphones', onPress: () => nav.push('MediaLibrary', {}) },
    { key: 'journey', label: 'Scripture Journey', icon: 'compass', onPress: () => nav.push('Journey') },
  ];

  return (
    <View style={k.screen}>
      <ScrollView ref={scrollRef} contentContainerStyle={[k.scroll, { paddingBottom: 24 }]} showsVerticalScrollIndicator={false}>
        <PageHeader
          title="The Bible"
          subtitle="Sacred scripture"
          action={<IconButton icon="search" label="Search scripture" onPress={() => nav.push('Search', {})} />}
        />

        <Tap onPress={() => nav.push('Search', {})} style={s.searchBox} accessibilityLabel="Search scripture, topics, or words">
          <Icon name="search" size={18} color={d.muted} />
          <Text style={s.searchPlaceholder} numberOfLines={1}>Search scripture, topics, or words</Text>
        </Tap>

        {/* .continue-card */}
        <Grad colors={gradients.ink} style={s.continueCard}>
          <View style={s.continueText}>
            <Eyebrow light>Continue reading</Eyebrow>
            <Text style={s.continueTitle}>{lastBook.name}</Text>
            <Text style={s.continueMeta}>{`Chapter ${lp.chapter} of ${lastBook.chapters} · ${percent}% complete`}</Text>
            <Tap onPress={() => openReader(lp.bookId, lp.chapter)} style={s.continueLink} accessibilityLabel={`Continue ${lastBook.name} chapter ${lp.chapter}`}>
              <Text style={s.continueLinkText}>Continue</Text>
              <Icon name="arrow-right" size={16} color="#FFCDA9" />
            </Tap>
          </View>
          {/* .book-art */}
          <View style={s.bookArt}>
            <Text style={s.bookArtNumber}>{lp.chapter}</Text>
            <Text style={s.bookArtName} numberOfLines={1}>{lastBook.name.toUpperCase()}</Text>
          </View>
        </Grad>

        {/* .translation-row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          {translations.map((id) => {
            const active = id === current;
            return (
              <Tap key={id} onPress={() => setTranslation(id)} style={[s.chip, active && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`Read in ${translationInfo(id).name}`}>
                <Text style={[s.chipText, active && s.chipTextOn]}>{id}</Text>
              </Tap>
            );
          })}
          <Tap onPress={() => nav.push('Bible', { bookId: lp.bookId, chapter: lp.chapter, compare: true })} style={s.chip} accessibilityLabel="Compare translations">
            <Icon name="plus" size={14} color={d.muted} />
            <Text style={s.chipText}>Compare</Text>
          </Tap>
        </ScrollView>

        {/* Feature navigation: always visible, never hidden */}
        <View style={s.featureGrid} accessibilityLabel="Bible study features">
          {features.map((f) => (
            <Tap key={f.key} onPress={f.onPress} style={s.feature} accessibilityRole="button" accessibilityLabel={f.label} testID={`bible-feature-${f.key}`}>
              <View style={s.featureIcon}><Icon name={f.icon} size={18} color={d.plum} /></View>
              <Text style={s.featureLabel} numberOfLines={2}>{f.label}</Text>
            </Tap>
          ))}
        </View>

        <View onLayout={(e) => { browseY.current = e.nativeEvent.layout.y; }}>
          <SectionTitle eyebrow={`${BOOKS.length} books`} title="Browse scripture" />
        </View>

        {/* .testament-tabs */}
        <View style={s.segment}>
          {TESTAMENTS.map(([key, label]) => {
            const active = testament === key;
            return (
              <Tap key={key} onPress={() => setTestament(key)} style={[s.segBtn, active && s.segBtnOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[s.segText, active && s.segTextOn]}>{label}</Text>
              </Tap>
            );
          })}
          <Tap onPress={() => nav.push('ExtraBooks')} style={s.segBtn} accessibilityLabel="Beyond the 66">
            <Text style={s.segText}>Beyond the 66</Text>
          </Tap>
        </View>

        {/* .book-list: real book metadata, chapter counts from books_meta.json */}
        <View style={s.bookList}>
          {books.map((b) => (
            <Tap key={b.id} onPress={() => openReader(b.id, 1)} style={s.bookRow} accessibilityLabel={`${b.name}, ${b.chapters} chapters`}>
              <Text style={s.bookNum}>{String(BOOKS.indexOf(b) + 1).padStart(2, '0')}</Text>
              <Text style={s.bookName} numberOfLines={1}>{b.name}</Text>
              <Text style={s.bookChapters}>{`${b.chapters} ch.`}</Text>
              <Icon name="chevron-right" size={17} color={d.muted} />
            </Tap>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  searchBox: { height: 48, borderRadius: 15, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginTop: 4 },
  searchPlaceholder: { flex: 1, fontFamily: df.sans, fontSize: 13, color: colors.faint },
  continueCard: { marginTop: 14, minHeight: 220, borderRadius: 25, padding: 22, overflow: 'hidden', flexDirection: 'row', justifyContent: 'space-between' },
  continueText: { flex: 1, paddingRight: 118 },
  continueTitle: { fontFamily: df.displayBold, fontSize: 27, lineHeight: 30, color: '#FFFFFF', marginTop: 12, marginBottom: 10 },
  continueMeta: { fontFamily: df.sans, fontSize: 11, color: '#B6A092' },
  continueLink: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  continueLinkText: { fontFamily: df.sansBold, fontSize: 12, color: '#FFCDA9' },
  bookArt: { position: 'absolute', right: 20, top: 22, bottom: 22, width: 92, borderRadius: 8, backgroundColor: '#E87525', borderTopRightRadius: 18, borderBottomRightRadius: 18, alignItems: 'center', justifyContent: 'center', shadowColor: '#3C2416', shadowOffset: { width: -8, height: 0 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  bookArtNumber: { fontFamily: df.display, fontSize: 40, color: '#FFFFFF' },
  bookArtName: { fontFamily: df.sansBold, fontSize: 9, letterSpacing: 1.6, color: '#F5CFB1', marginTop: 2, maxWidth: 80 },
  chipRow: { flexDirection: 'row', gap: 7, paddingTop: 14, paddingBottom: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  chipOn: { backgroundColor: d.plum, borderColor: d.plum },
  chipText: { fontFamily: df.sansBold, fontSize: 11, color: d.muted },
  chipTextOn: { color: '#FFFFFF' },
  segment: { flexDirection: 'row', backgroundColor: colors.raised, padding: 4, borderRadius: 13 },
  segBtn: { flex: 1, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center' },
  segBtnOn: { backgroundColor: d.paper, shadowColor: '#141219', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  segText: { fontFamily: df.sansBold, fontSize: 10, color: colors.muted },
  segTextOn: { color: d.ink },
  bookList: { marginTop: 8 },
  bookRow: { height: 60, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: d.line },
  bookNum: { width: 20, fontFamily: df.sansHeavy, fontSize: 10, color: d.plum },
  bookName: { flex: 1, fontFamily: df.displayBold, fontSize: 15, color: d.ink },
  bookChapters: { fontFamily: df.sans, fontSize: 10, color: d.muted },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  feature: { width: '31.5%', flexGrow: 1, minHeight: 92, borderRadius: 16, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, padding: 10, justifyContent: 'space-between' },
  featureIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  featureLabel: { fontFamily: df.sansBold, fontSize: 11, lineHeight: 14, color: d.ink, marginTop: 8 },
});
