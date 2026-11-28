// "Beyond the 66": deuterocanonical and extra-biblical books (public-domain translations, from the
// Scrollmapper project). Library → book → chapter reader. The reader follows the Bible reader's
// settings (theme, font, text size, line spacing) and remembers where you stopped in each book.
// The library is laid out like the Bible home (src/screens/BibleHomeScreen.js): search, "Continue reading"
// card, collection sections with book rows. The reader keeps its own reader themes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, radius, readerThemes, lineSpacings, readerFontFamily } from '../theme';
import { isDarkScheme } from '../design/palette';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { EXTRA_BOOKS, EXTRA_COLLECTIONS, extraBook } from '../data/extraBooks';
import { useExtraBook, chapterLabel } from '../bible/extraLoader';
import { d, df, gradients, Grad, Tap, Eyebrow, SectionTitle } from '../design/sanctuary';
import { DScreen } from '../design/profile/parts';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Library ----------
export function ExtraBooksScreen() {
  const nav = useNav();
  const { state } = useStore();
  const [q, setQ] = useState('');
  const recent = state.extraLast || {}; // { bookId: chapterNumber }
  const term = q.trim().toLowerCase();
  const matches = (b) => !term || b.name.toLowerCase().includes(term) || b.note.toLowerCase().includes(term);
  const continueBooks = EXTRA_BOOKS.filter((b) => recent[b.id] != null).slice(0, 3);
  const [first, ...others] = continueBooks;
  const progress = (b, n) => Math.max(1, Math.round(((b.chapters.indexOf(n) + 1) / b.chapters.length) * 100));

  return (
    <DScreen back onBack={() => nav.pop()} title="Beyond the 66" subtitle={`${EXTRA_BOOKS.length} ancient books`}>
      <FadeInUp>
        <Eyebrow>Apocrypha · deuterocanon · early writings</Eyebrow>
        <Text style={styles.heroTitle}>Books beyond the Protestant canon</Text>
        <Text style={styles.heroBody}>
          Tobit, Maccabees, Enoch, Jubilees, Jasher, the Shepherd of Hermas and more — read for centuries by Jews and
          Christians. They help us understand the world of the Bible.
        </Text>
      </FadeInUp>

      <Notice text="These books are not part of the 66-book Bible most Protestant churches use. Some are Scripture in Catholic, Orthodox or Ethiopian churches; others are historical writings. Read them alongside the Bible, testing everything by God’s Word." />

      {/* .search box */}
      <View style={styles.searchBox}>
        <Icon name="search" size={16} color={d.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Find a book (Enoch, Tobit, Maccabees…)"
          placeholderTextColor="#AA9A8C"
          style={styles.searchInput}
          accessibilityLabel="Find a book"
        />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear"><Icon name="x" size={14} color={d.muted} /></Pressable> : null}
      </View>

      {!term && first ? (
        <View>
          {/* .continue-card */}
          <Grad colors={gradients.ink} style={styles.continueCard}>
            <View style={styles.continueText}>
              <Eyebrow light>Continue reading</Eyebrow>
              <Text style={styles.continueTitle}>{first.name}</Text>
              <Text style={styles.continueMeta}>{`Chapter ${chapterLabel(recent[first.id])} of ${first.chapters.length} · ${progress(first, recent[first.id])}% complete`}</Text>
              <Tap onPress={() => nav.push('ExtraBook', { id: first.id, chapter: recent[first.id] })} style={styles.continueLink} accessibilityLabel={`Continue ${first.name}`}>
                <Text style={styles.continueLinkText}>Continue</Text>
                <Icon name="arrow-right" size={16} color="#FFCDA9" />
              </Tap>
            </View>
            {/* .book-art */}
            <View style={styles.bookArt}>
              <Text style={styles.bookArtNumber}>{chapterLabel(recent[first.id])}</Text>
              <Text style={styles.bookArtName} numberOfLines={1}>{first.name.toUpperCase()}</Text>
            </View>
          </Grad>
          {others.length ? (
            <View style={{ marginTop: 6 }}>
              <SectionTitle eyebrow="In progress" title="Also reading" />
              {others.map((b) => (
                <BookRow key={b.id} book={b} sub={`Chapter ${chapterLabel(recent[b.id])}`} onPress={() => nav.push('ExtraBook', { id: b.id, chapter: recent[b.id] })} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {EXTRA_COLLECTIONS.map((col) => {
        const books = EXTRA_BOOKS.filter((b) => b.collection === col.id && matches(b));
        if (!books.length) return null;
        return (
          <View key={col.id}>
            <SectionTitle eyebrow={plural(books.length, 'book', 'books')} title={col.name} />
            <Text style={styles.sectionNote}>{col.note}</Text>
            <View style={styles.bookList}>
              {books.map((b) => (
                <BookRow key={b.id} book={b} sub={b.note} onPress={() => nav.push('ExtraBook', { id: b.id, chapter: recent[b.id] })} />
              ))}
            </View>
          </View>
        );
      })}
      {term && !EXTRA_BOOKS.some(matches) ? <Empty title="No book found" body={`Nothing matches “${q.trim()}”.`} /> : null}

      <Text style={styles.footer}>
        Texts: public-domain translations (King James Apocrypha 1611, R. H. Charles, Ante-Nicene Fathers and others), prepared by
        the open-source Scrollmapper project. Modern copyrighted translations are not included.
      </Text>
    </DScreen>
  );
}

function BookRow({ book, sub, onPress }) {
  return (
    <Tap onPress={onPress} style={styles.bookRow} accessibilityRole="button" accessibilityLabel={`Open ${book.name}`}>
      <Text style={styles.bookCode}>{book.id.slice(0, 3)}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{book.name}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text>
        <Text style={styles.rowMeta}>{plural(book.chapters.length, 'chapter', 'chapters')} · {book.translation}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={d.muted} />
    </Tap>
  );
}

// ---------- Reader ----------
export function ExtraBookScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { state, dispatch } = useStore();
  const meta = extraBook(params.id);
  const { book, loading, error, retry } = useExtraBook(params.id);
  const savedReaderKey = state.readerTheme || 'paper'; // dark app → Night reader unless the user picked Sepia/Night
  const t = readerThemes[isDarkScheme() && savedReaderKey === 'paper' ? 'night' : savedReaderKey] || readerThemes.paper;
  const fs = Math.round((state.fontSize || 16) * 1.12);
  const spacing = lineSpacings[state.lineSpacing] || lineSpacings.Comfortable;
  const fontFamily = readerFontFamily(state.readerFont || 'Newsreader');
  const chapters = meta ? meta.chapters : [];
  const startN = chapters.includes(params.chapter) ? params.chapter : chapters[0];
  const [chN, setChN] = useState(startN);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState(null);
  const scroll = useRef(null);

  const idx = Math.max(0, chapters.indexOf(chN));
  const chapter = useMemo(() => (book ? book.chapters.find((c) => c.n === chN) || book.chapters[0] : null), [book, chN]);

  // remember the last chapter read in each book
  useEffect(() => {
    if (!meta || chN == null) return;
    const last = state.extraLast || {};
    if (last[meta.id] !== chN) dispatch({ type: 'set', patch: { extraLast: { ...last, [meta.id]: chN } } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta && meta.id, chN]);

  const go = (i) => {
    if (i < 0 || i >= chapters.length) return;
    setChN(chapters[i]);
    setSelected(null);
    setPicker(false);
    requestAnimationFrame(() => { try { scroll.current && scroll.current.scrollTo({ y: 0, animated: false }); } catch (e) { /* ignore */ } });
  };

  const ref = (vn) => `${meta.name} ${chN === 0 ? 'Preface' : chN}${vn ? `:${vn}` : ''}`;
  const shareVerse = async ([vn, text]) => {
    try {
      await Share.share({ message: `“${text}”\n— ${ref(vn)} (${meta.translation})\n\nRead in BibleNestra` });
    } catch (e) { toast.show('Couldn’t open sharing', { tone: 'error' }); }
  };

  if (!meta) {
    return <DScreen back onBack={() => nav.pop()} title="Book"><Empty title="Book not found" action="All books" onAction={() => nav.replace ? nav.replace('ExtraBooks') : nav.pop()} /></DScreen>;
  }

  return (
    <View style={[styles.readerWrap, { backgroundColor: t.bg }]}>
      <View style={[styles.readerTop, { borderBottomColor: t.border }]}>
        <Pressable onPress={() => nav.pop()} hitSlop={10} style={[styles.iconBtn, { backgroundColor: t.chip, borderColor: t.border }]} accessibilityLabel="Back">
          <Icon name="chevron-left" size={18} color={t.fg} />
        </Pressable>
        <Pressable onPress={() => setPicker((v) => !v)} style={{ flex: 1, minWidth: 0, paddingHorizontal: 10 }} accessibilityRole="button" accessibilityLabel="Choose chapter">
          <Text style={[styles.readerEyebrow, { color: t.gold }]} numberOfLines={1}>BEYOND THE 66</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.readerTitle, { color: t.fg }]} numberOfLines={1}>{meta.name} {chN === 0 ? '· Preface' : chN}</Text>
            <Icon name={picker ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
          </View>
        </Pressable>
        <Pressable onPress={() => nav.push('ExtraBooks')} hitSlop={10} style={[styles.iconBtn, { backgroundColor: t.chip, borderColor: t.border }]} accessibilityLabel="All books">
          <Icon name="book" size={16} color={t.fg} />
        </Pressable>
      </View>

      {picker ? (
        <View style={[styles.chapterGrid, { borderBottomColor: t.border, backgroundColor: t.surface }]}>
          <ScrollView contentContainerStyle={styles.chapterGridInner} style={{ maxHeight: 220 }}>
            {chapters.map((n, i) => (
              <Pressable
                key={`${n}-${i}`}
                onPress={() => go(i)}
                style={[styles.chapterCell, { borderColor: t.border, backgroundColor: n === chN ? t.accent : t.chip }]}
                accessibilityLabel={`Chapter ${chapterLabel(n)}`}
              >
                <Text style={{ color: n === chN ? (t.dark ? t.bg : '#FFFFFF') : t.fg, fontWeight: '600', fontSize: n === 0 ? 11 : 14 }}>{chapterLabel(n)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: insets.bottom + 40 }}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /><Text style={[styles.loadingText, { color: t.muted }]}>Opening {meta.name}…</Text></View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.errorTitle, { color: t.fg }]}>Couldn’t open this book</Text>
            <Text style={[styles.errorBody, { color: t.muted }]}>{error}</Text>
            <Pressable onPress={retry} style={[styles.retryBtn, { backgroundColor: t.accent }]} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        ) : chapter ? (
          <>
            <Text style={[styles.chapterHead, { color: t.muted }]}>{meta.name.toUpperCase()}</Text>
            <Text style={[styles.chapterNum, { color: t.accent }]}>{chN === 0 ? 'Preface' : chN}</Text>
            <Text style={[styles.translation, { color: t.muted }]}>{meta.translation}</Text>
            {chapter.verses.map((v, i) => {
              const [vn, text] = v;
              const on = selected === i;
              return (
                <Pressable
                  key={`${vn}-${i}`}
                  onPress={() => setSelected(on ? null : i)}
                  onLongPress={() => shareVerse(v)}
                  style={[styles.verseRow, on && { backgroundColor: t.sel }]}
                  accessibilityHint="Tap to select, long-press to share"
                >
                  <Text style={[styles.verseText, { color: t.passage, fontSize: fs, lineHeight: Math.round(fs * spacing), fontFamily }]}>
                    {vn > 0 ? <Text style={[styles.vnum, { color: on ? t.accent : t.gold }]}>{vn}{' '} </Text> : null}
                    {text}
                  </Text>
                  {on ? (
                    <View style={styles.verseActions}>
                      <Pressable onPress={() => shareVerse(v)} style={[styles.verseAction, { borderColor: t.border, backgroundColor: t.chip }]} accessibilityRole="button">
                        <Icon name="share" size={13} color={t.fg} />
                        <Text style={[styles.verseActionText, { color: t.fg }]}>Share {vn > 0 ? `${chN}:${vn}` : ''}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}

            <View style={styles.pager}>
              <Pressable disabled={idx === 0} onPress={() => go(idx - 1)} style={[styles.pagerBtn, { borderColor: t.border, backgroundColor: t.chip }, idx === 0 && { opacity: 0.4 }]} accessibilityRole="button">
                <Text style={[styles.pagerText, { color: t.fg }]}>Previous</Text>
              </Pressable>
              <Pressable
                disabled={idx >= chapters.length - 1}
                onPress={() => go(idx + 1)}
                style={[styles.pagerBtn, { backgroundColor: t.accent, borderColor: t.accent }, idx >= chapters.length - 1 && { opacity: 0.4 }]}
                accessibilityRole="button"
              >
                <Text style={[styles.pagerText, { color: t.dark ? t.bg : '#FFFFFF' }]}>{idx >= chapters.length - 1 ? 'End of book' : 'Next chapter'}</Text>
              </Pressable>
            </View>
            <Text style={[styles.credit, { color: t.faint }]}>
              {meta.name} · {meta.translation} · public domain · via the Scrollmapper project. Not part of the 66-book Protestant canon.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heroTitle: { fontFamily: df.displayBold, fontSize: 26, lineHeight: 30, color: d.ink, marginTop: 8 },
  heroBody: { fontFamily: df.sans, fontSize: 11, lineHeight: 17, color: d.muted, marginTop: 8, marginBottom: 14 },
  searchBox: { height: 48, borderRadius: 15, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginTop: 4 },
  searchInput: { flex: 1, fontFamily: df.sans, fontSize: 13, color: d.ink, paddingVertical: 0 },
  continueCard: { marginTop: 14, minHeight: 200, borderRadius: 25, padding: 22, overflow: 'hidden', flexDirection: 'row', justifyContent: 'space-between' },
  continueText: { flex: 1, paddingRight: 118 },
  continueTitle: { fontFamily: df.displayBold, fontSize: 25, lineHeight: 28, color: '#FFFFFF', marginTop: 12, marginBottom: 10 },
  continueMeta: { fontFamily: df.sans, fontSize: 11, color: '#B6A092' },
  continueLink: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  continueLinkText: { fontFamily: df.sansBold, fontSize: 12, color: '#FFCDA9' },
  bookArt: { position: 'absolute', right: 20, top: 22, bottom: 22, width: 92, borderRadius: 8, backgroundColor: '#E87525', borderTopRightRadius: 18, borderBottomRightRadius: 18, alignItems: 'center', justifyContent: 'center', shadowColor: '#3C2416', shadowOffset: { width: -8, height: 0 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  bookArtNumber: { fontFamily: df.display, fontSize: 36, color: '#FFFFFF' },
  bookArtName: { fontFamily: df.sansBold, fontSize: 9, letterSpacing: 1.2, color: '#F5CFB1', marginTop: 2, maxWidth: 80 },
  sectionNote: { fontFamily: df.sans, fontSize: 10, lineHeight: 15, color: d.muted, marginBottom: 6 },
  bookList: { marginTop: 4 },
  bookRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: d.line },
  bookCode: { width: 34, fontFamily: df.sansHeavy, fontSize: 10, color: d.plum },
  rowTitle: { fontFamily: df.displayBold, fontSize: 15, color: d.ink },
  rowSub: { fontFamily: df.sans, fontSize: 10, lineHeight: 15, color: d.muted, marginTop: 2 },
  rowMeta: { fontFamily: df.sans, fontSize: 9, color: d.muted, marginTop: 3 },
  footer: { fontFamily: df.sans, fontSize: 10, lineHeight: 15, color: d.muted, marginTop: 26 },

  readerWrap: { flex: 1 },
  readerTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  readerEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  readerTitle: { fontFamily: fonts.display, fontSize: 19, marginRight: 4, flexShrink: 1 },
  chapterGrid: { borderBottomWidth: StyleSheet.hairlineWidth },
  chapterGridInner: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14 },
  chapterCell: { minWidth: 44, height: 40, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  loadingText: { marginTop: 12, fontSize: 14 },
  errorTitle: { fontSize: 17, fontWeight: '700' },
  errorBody: { fontSize: 14, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  chapterHead: { textAlign: 'center', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  chapterNum: { textAlign: 'center', fontFamily: fonts.display, fontSize: 44, marginTop: 2 },
  translation: { textAlign: 'center', fontSize: 12.5, fontStyle: 'italic', marginBottom: 16 },
  verseRow: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, marginHorizontal: -6 },
  verseText: { fontFamily: fonts.serif },
  vnum: { fontSize: 12, fontWeight: '700' },
  verseActions: { flexDirection: 'row', marginTop: 6, marginBottom: 2 },
  verseAction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill || 999, borderWidth: 1 },
  verseActionText: { fontSize: 12.5, fontWeight: '600' },
  pager: { flexDirection: 'row', gap: 10, marginTop: 26 },
  pagerBtn: { flex: 1, height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pagerText: { fontSize: 15, fontWeight: '700' },
  credit: { fontSize: 11.5, lineHeight: 16, marginTop: 18, textAlign: 'center' },
});
