// Shared pieces for long, grouped verse-result lists (Search screen, Concordance "Where it appears").
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icons';
import { colors, fonts, radius } from '../theme';
import { refLabel } from '../data/bible';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Verse text with every query term in bold.
export function HighlightedText({ text, terms, style, hlStyle }) {
  const parts = useMemo(() => {
    const ts = (terms || []).filter((t) => t && t.length >= 2).sort((a, b) => b.length - a.length);
    if (!ts.length) return [{ t: text, h: false }];
    const re = new RegExp(`(${ts.map(escRe).join('|')})`, 'gi');
    return String(text).split(re).filter(Boolean).map((t) => ({ t, h: ts.some((x) => x.toLowerCase() === t.toLowerCase()) }));
  }, [text, terms]);
  return (
    <Text style={style}>
      {parts.map((p, i) => (p.h ? <Text key={i} style={[styles.hl, hlStyle]}>{p.t}</Text> : p.t))}
    </Text>
  );
}

export function BookHeaderRow({ row }) {
  return (
    <View style={styles.bookHead}>
      <Text style={styles.bookHeadName}>{row.name}</Text>
      <Text style={styles.bookHeadCount}>{`${row.n} verse${row.n === 1 ? '' : 's'}`}</Text>
    </View>
  );
}

export const VerseResultRow = React.memo(function VerseResultRow({ row, terms, onPress, showTag = true }) {
  return (
    <Pressable
      onPress={() => onPress(row)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${refLabel(row.bookId, row.chapter, row.verse)}`}
    >
      <View style={styles.cardTop}>
        <Text style={styles.ref}>{refLabel(row.bookId, row.chapter, row.verse)}</Text>
        {showTag ? (
          <Text style={[styles.tag, row.exact ? { color: colors.gold, backgroundColor: colors.goldFaint } : null]}>{row.exact ? 'Exact' : 'All words'}</Text>
        ) : (
          <View style={styles.open}><Text style={styles.openText}>Open</Text><Icon name="chevron-right" size={12} color={colors.primary} /></View>
        )}
      </View>
      <HighlightedText text={row.text} terms={terms} style={styles.body} />
    </Pressable>
  );
});

// Horizontal filter chips: "All books (n)" + one chip per book that has results.
export function BookFilterChips({ index, perBook, testament = 'ALL', value, onChange }) {
  const books = useMemo(() => {
    if (!index || !perBook) return [];
    return index.books.filter((b) => perBook[b.id] && (testament === 'ALL' || b.testament === testament));
  }, [index, perBook, testament]);
  if (books.length < 2) return null;
  const total = books.reduce((n, b) => n + perBook[b.id], 0);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }} keyboardShouldPersistTaps="handled">
      {[{ id: null, name: 'All books', n: total }, ...books.map((b) => ({ id: b.id, name: b.name, n: perBook[b.id] }))].map((b) => {
        const on = (value || null) === b.id;
        return (
          <Pressable key={b.id || 'all'} onPress={() => onChange(b.id)} style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{b.name}</Text>
            <Text style={[styles.chipCount, on && { color: 'rgba(255,255,255,0.75)' }]}>{b.n}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// Incremental rendering: show `page` rows, add another page when the list nears its end.
export function usePaged(rows, resetKey, page = 50) {
  const [shown, setShown] = useState(page);
  useEffect(() => { setShown(page); }, [resetKey]);
  const visible = useMemo(() => rows.slice(0, shown), [rows, shown]);
  const last = useRef(0);
  const more = useCallback(() => {
    const now = Date.now();
    if (now - last.current < 250) return; // one page per burst of scroll events
    last.current = now;
    setShown((n) => (n < rows.length ? n + page : n));
  }, [rows.length, page]);
  // Scroll / size handlers for lists where onEndReached alone is unreliable (web, big headers):
  // load the next page whenever the viewport is within ~1.5 screens of the end — on scroll and
  // again whenever the content grows while the reader is already near the bottom.
  const m = useRef({ y: 0, h: 0, vh: 0 });
  const check = useCallback(() => {
    const { y, h, vh } = m.current;
    if (vh > 0 && h - vh - y < vh * 1.5) more();
  }, [more]);
  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    m.current = { y: contentOffset.y, h: contentSize.height, vh: layoutMeasurement.height };
    check();
  }, [check]);
  const onContentSizeChange = useCallback((w, h) => { m.current.h = h; setTimeout(check, 260); }, [check]);
  return { visible, more, onScroll, onContentSizeChange, hasMore: shown < rows.length, shown: Math.min(shown, rows.length) };
}

// Long list of rows rendered a page at a time (see usePaged).
// Native: a virtualised FlatList. Web: a plain ScrollView — react-native-web's VirtualizedList only
// grows its render window via InteractionManager, which the app's looping JS animations keep busy,
// so on web it would stall after the first screenful.
export function PagedList({ data, renderItem, keyExtractor, header, footer, paged, contentContainerStyle, listRef }) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView
        ref={listRef}
        onScroll={paged.onScroll}
        onContentSizeChange={paged.onContentSizeChange}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={contentContainerStyle}
      >
        {header}
        {data.map((item, index) => <React.Fragment key={keyExtractor(item)}>{renderItem({ item, index })}</React.Fragment>)}
        {footer}
      </ScrollView>
    );
  }
  return (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      onEndReached={paged.more}
      onEndReachedThreshold={0.6}
      onScroll={paged.onScroll}
      onContentSizeChange={paged.onContentSizeChange}
      scrollEventThrottle={100}
      initialNumToRender={14}
      maxToRenderPerBatch={20}
      windowSize={11}
      removeClippedSubviews={Platform.OS === 'android'}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator
    />
  );
}

export function ProgressLine({ progress }) {
  return (
    <View style={styles.progTrack}>
      <View style={[styles.progFill, { width: `${Math.round(Math.max(0.04, Math.min(1, progress)) * 100)}%` }]} />
    </View>
  );
}

export const resultStyles = StyleSheet.create({
  footer: { paddingVertical: 18, alignItems: 'center' },
  footerText: { fontSize: 12, color: colors.faint },
});

const styles = StyleSheet.create({
  hl: { fontFamily: fonts.serifBold, color: colors.fg, backgroundColor: 'rgba(212,168,82,0.22)' },
  bookHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 8 },
  bookHeadName: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  bookHeadCount: { fontSize: 12, color: colors.muted },
  card: { padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  ref: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: colors.gold },
  tag: { fontSize: 10.5, fontWeight: '700', color: colors.muted, backgroundColor: colors.raised, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  open: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  openText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  body: { fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 23, color: colors.passage, marginTop: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.fg },
  chipCount: { fontSize: 11, fontWeight: '700', color: colors.faint },
  progTrack: { height: 3, borderRadius: 2, backgroundColor: colors.raised, overflow: 'hidden', marginTop: 8 },
  progFill: { height: 3, backgroundColor: colors.gold },
});
