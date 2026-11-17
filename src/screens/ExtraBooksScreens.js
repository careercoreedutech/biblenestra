// "Beyond the 66": deuterocanonical and extra-biblical books (public-domain translations, from the
// Scrollmapper project). Library → book → chapter reader. The reader follows the Bible reader's
// settings (theme, font, text size, line spacing) and remembers where you stopped in each book.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, radius, readerThemes, lineSpacings, readerFontFamily } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { EXTRA_BOOKS, EXTRA_COLLECTIONS, extraBook } from '../data/extraBooks';
import { useExtraBook, chapterLabel } from '../bible/extraLoader';

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

  return (
    <Screen back title="Beyond the 66" subtitle={`${EXTRA_BOOKS.length} ancient books`}>
      <FadeInUp>
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>APOCRYPHA · DEUTEROCANON · EARLY WRITINGS</Text>
          <Text style={styles.heroTitle}>Books beyond the Protestant canon</Text>
          <Text style={styles.heroBody}>
            Tobit, Maccabees, Enoch, Jubilees, Jasher, the Shepherd of Hermas and more — read for centuries by Jews and
            Christians. They help us understand the world of the Bible.
          </Text>
        </View>
      </FadeInUp>

      <Notice text="These books are not part of the 66-book Bible most Protestant churches use. Some are Scripture in Catholic, Orthodox or Ethiopian churches; others are historical writings. Read them alongside the Bible, testing everything by God’s Word." />

      <View style={styles.searchBox}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Find a book (Enoch, Tobit, Maccabees…)"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          accessibilityLabel="Find a book"
        />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear"><Icon name="x" size={14} color={colors.muted} /></Pressable> : null}
      </View>

      {!term && continueBooks.length ? (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionTitle}>Continue reading</Text>
          {continueBooks.map((b) => (
            <BookRow key={b.id} book={b} sub={`Chapter ${chapterLabel(recent[b.id])}`} onPress={() => nav.push('ExtraBook', { id: b.id, chapter: recent[b.id] })} />
          ))}
        </View>
      ) : null}

      {EXTRA_COLLECTIONS.map((col) => {
        const books = EXTRA_BOOKS.filter((b) => b.collection === col.id && matches(b));
        if (!books.length) return null;
        return (
          <View key={col.id} style={{ marginTop: 22 }}>
            <Text style={styles.sectionTitle}>{col.name}</Text>
            <Text style={styles.sectionNote}>{col.note}</Text>
            {books.map((b) => (
              <BookRow key={b.id} book={b} sub={b.note} onPress={() => nav.push('ExtraBook', { id: b.id, chapter: recent[b.id] })} />
            ))}
          </View>
        );
      })}
      {term && !EXTRA_BOOKS.some(matches) ? <Empty title="No book found" body={`Nothing matches “${q.trim()}”.`} /> : null}

      <Text style={styles.footer}>
        Texts: public-domain translations (King James Apocrypha 1611, R. H. Charles, Ante-Nicene Fathers and others), prepared by
        the open-source Scrollmapper project. Modern copyrighted translations are not included.
      </Text>
    </Screen>
  );
}

function BookRow({ book, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Open ${book.name}`}>
      <View style={styles.rowIcon}><Text style={styles.rowIconText}>{book.id.slice(0, 3)}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{book.name}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text>
        <Text style={styles.rowMeta}>{plural(book.chapters.length, 'chapter', 'chapters')} · {book.translation}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors.faint} />
    </Pressable>
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
  const t = readerThemes[state.readerTheme] || readerThemes.paper;
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
    return <Screen back title="Book"><Empty title="Book not found" action="All books" onAction={() => nav.replace ? nav.replace('ExtraBooks') : nav.pop()} /></Screen>;
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
                    {vn > 0 ? <Text style={[styles.vnum, { color: on ? t.accent : t.gold }]}>{vn}{' '} </Text> : null}
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
  hero: { backgroundColor: colors.night || '#15172B', borderRadius: 20, padding: 20, marginBottom: 14 },
  heroEyebrow: { color: colors.goldLight || '#D9B36A', fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  heroTitle: { color: '#FFFFFF', fontFamily: fonts.display, fontSize: 24, marginTop: 8 },
  heroBody: { color: 'rgba(255,255,255,0.78)', fontSize: 14, lineHeight: 20, marginTop: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 14, height: 44, borderRadius: 14, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: 15, color: colors.fg, paddingVertical: 0 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.fg },
  sectionNote: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 8, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, marginTop: 8, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  rowIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft || '#E7E9F5', alignItems: 'center', justifyContent: 'center' },
  rowIconText: { fontSize: 11.5, fontWeight: '800', color: colors.primary },
  rowTitle: { fontSize: 15.5, fontWeight: '700', color: colors.fg },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
  rowMeta: { fontSize: 11.5, color: colors.faint, marginTop: 4 },
  footer: { fontSize: 12, color: colors.faint, lineHeight: 17, marginTop: 26 },

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
