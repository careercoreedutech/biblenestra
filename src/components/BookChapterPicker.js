// Books & chapters bottom sheet for the Bible reader.
//
// Layout notes (client bug, round 3: "the list stops scrolling at the Nehemiah / Esther / Job row and
// that row is half covered"):
//  * The sheet used only `maxHeight: '88%'` with an auto-height ScrollView inside. On Android/iOS Yoga
//    sizes such a ScrollView to its full content height, the sheet clips it at 88 %, and the ScrollView
//    then has nothing left to scroll — the list "stops" wherever the clip lands (≈ the 6th row of the
//    Old Testament) and the system navigation bar covers the last visible row.
//  * Fix: the sheet gets a definite height computed from the window and safe-area insets, the ScrollView
//    is `flex: 1` inside it, and the content gets bottom padding for the home indicator / nav bar.
//  * Grid cells are sized in pixels from the measured content width (percent widths + `gap` overflowed
//    on narrow phones and wrapped to fewer columns).
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icons';
import { Badge } from './ui';
import { colors, fonts, radius } from '../theme';
import { BOOKS, CHAPTER_TITLES, availableChapters, bookName, refLabel } from '../data/bible';

const PAD = 18;
const GAP = 8;

export default function BookChapterPicker({ pos, onSelect, onClose }) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const sectionY = useRef({});
  const [innerW, setInnerW] = useState(Math.max(240, Math.min(win.width, 760) - PAD * 2));
  const book = BOOKS.find((b) => b.id === pos.bookId);

  // A definite height: 90 % of the window, but never under the status bar / notch.
  const sheetH = Math.round(Math.min(win.height * 0.9, win.height - Math.max(insets.top, 20) - 12));
  const chCols = innerW >= 420 ? 10 : innerW >= 300 ? 7 : 6;
  const chSize = Math.floor((innerW - GAP * (chCols - 1)) / chCols);
  const bookCols = innerW >= 520 ? 4 : innerW >= 250 ? 3 : 2;
  const bookW = Math.floor((innerW - GAP * (bookCols - 1)) / bookCols);

  const chapters = useMemo(() => Array.from({ length: book ? book.chapters : 0 }, (_, i) => i + 1), [book]);
  const featured = useMemo(() => availableChapters(), []);
  const jump = (k) => {
    const y = sectionY.current[k];
    if (y != null && scrollRef.current) scrollRef.current.scrollTo({ y: Math.max(0, y - 6), animated: true });
  };

  return (
    <View style={[styles.sheet, { height: sheetH }]}>
      <View style={styles.grabber} />
      <View style={styles.head}>
        <Text style={styles.title}>Books & chapters</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close books and chapters">
          <Text style={styles.closeText}>Done</Text>
        </Pressable>
      </View>
      <View style={styles.jumpRow}>
        {[['OT', 'Old Testament'], ['NT', 'New Testament'], ['featured', 'Featured']].map(([k, label]) => (
          <Pressable key={k} onPress={() => jump(k)} style={({ pressed }) => [styles.jumpChip, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Jump to ${label}`}>
            <Text style={styles.jumpText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: 6, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); if (w > 0 && Math.abs(w - innerW) > 1) setInnerW(w); }}>
          {book ? (
            <View style={{ marginBottom: 20 }}>
              <Text style={styles.sub}>{`${book.name} · ${book.chapters} chapter${book.chapters === 1 ? '' : 's'}`}</Text>
              <View style={styles.grid}>
                {chapters.map((ch) => {
                  const isSel = ch === pos.chapter;
                  return (
                    <Pressable
                      key={ch}
                      accessibilityRole="button"
                      accessibilityLabel={`${book.name} chapter ${ch}`}
                      style={({ pressed }) => [styles.chapterCell, { width: chSize, height: chSize }, isSel && styles.cellActive, pressed && { opacity: 0.7 }]}
                      onPress={() => onSelect({ bookId: pos.bookId, chapter: ch })}
                    >
                      <Text style={[styles.chapterText, isSel && { color: colors.primaryFg }]}>{ch}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {['OT', 'NT'].map((t) => {
            const list = BOOKS.filter((b) => b.testament === t);
            return (
              <View key={t} style={{ marginTop: 10 }} onLayout={(e) => { sectionY.current[t] = e.nativeEvent.layout.y; }}>
                <Text style={styles.testament}>{t === 'OT' ? 'Old Testament' : 'New Testament'}</Text>
                <Text style={styles.testamentCount}>{`${list.length} books`}</Text>
                <View style={styles.grid}>
                  {list.map((b) => {
                    const isSel = b.id === pos.bookId;
                    return (
                      <Pressable
                        key={b.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${b.name}, ${b.chapters} chapter${b.chapters === 1 ? '' : 's'}`}
                        style={({ pressed }) => [styles.bookItem, { width: bookW }, isSel && styles.cellActive, pressed && { opacity: 0.7 }]}
                        onPress={() => onSelect({ bookId: b.id, chapter: 1 })}
                      >
                        <Text style={[styles.bookName, isSel && styles.bookNameActive]} numberOfLines={1}>{b.name}</Text>
                        <Text style={[styles.bookCount, isSel && { color: 'rgba(255,255,255,0.7)' }]}>{b.chapters} ch</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          <View onLayout={(e) => { sectionY.current.featured = e.nativeEvent.layout.y; }}>
            <Text style={[styles.testament, { marginTop: 26 }]}>Featured passages</Text>
            <View style={{ gap: 8, marginTop: 10 }}>
              {featured.map((c) => {
                const chTitle = CHAPTER_TITLES[`${c.bookId}:${c.chapter}`] || `${bookName(c.bookId)} Chapter ${c.chapter}`;
                const isCurrent = c.bookId === pos.bookId && c.chapter === pos.chapter;
                return (
                  <Pressable
                    key={c.bookId + c.chapter}
                    style={({ pressed }) => [styles.featCard, isCurrent && styles.featActive, pressed && { opacity: 0.8 }]}
                    onPress={() => onSelect({ bookId: c.bookId, chapter: c.chapter })}
                  >
                    <View style={[styles.featIcon, isCurrent && { backgroundColor: colors.primary }]}>
                      <Icon name="book" size={15} color={isCurrent ? colors.primaryFg : colors.primary} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.featRef}>{refLabel(c.bookId, c.chapter)}</Text>
                      <Text style={styles.featTitle} numberOfLines={1}>{chTitle}</Text>
                    </View>
                    {isCurrent ? <Badge label="Reading" tint={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  scroll: { flex: 1, minHeight: 0 },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: PAD, paddingBottom: 10 },
  title: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, letterSpacing: -0.3 },
  close: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.fg },
  closeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  jumpRow: { flexDirection: 'row', gap: 8, paddingHorizontal: PAD, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  jumpChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.raised },
  jumpText: { fontSize: 12, fontWeight: '600', color: colors.fg },
  sub: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginTop: 8, marginBottom: 10 },
  testament: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  testamentCount: { fontSize: 12, color: colors.muted, marginTop: 1, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  chapterCell: {
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chapterText: { fontSize: 14, fontWeight: '700', color: colors.fg },
  bookItem: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bookName: { fontSize: 13, color: colors.fg, fontWeight: '600' },
  bookNameActive: { color: '#FFFFFF', fontWeight: '700' },
  bookCount: { fontSize: 11, color: colors.faint, marginTop: 2 },
  featCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
  },
  featActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  featIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  featRef: { fontSize: 14, fontWeight: '700', color: colors.fg },
  featTitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
});
