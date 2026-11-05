// Search & Concordance screen — searches the WHOLE Bible with no result cap.
//
// • Every matching verse is listed (grouped by book) in a virtualised FlatList that renders 50 rows
//   at a time and loads the next page as you scroll.
// • Total verses + occurrences are shown; OT / NT and per-book filters apply instantly to the result.
// • Searches the reader's translation when its full text is on the device, otherwise the bundled KJV
//   (and says so). The search runs in slices so typing stays smooth on a phone.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { FadeInUp, ScaleIn } from '../components/Motion';
import { Screen, Section, Row, Pill, Pills, Input, Empty } from '../components/ui';
import { BookFilterChips, BookHeaderRow, PagedList, ProgressLine, VerseResultRow, resultStyles, usePaged } from '../components/VerseResults';
import { colors, fonts, radius } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { BOOKS, refLabel } from '../data/bible';
import { translationInfo } from '../bible/catalog';
import { canDownload } from '../bible/loader';
import { useBibleSearch, groupRows } from '../bible/search';

const SCOPES = [['ALL', 'Whole Bible'], ['OT', 'Old Testament'], ['NT', 'New Testament']];

export default function BibleSearchScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [q, setQ] = useState(params.query || '');
  const [scope, setScope] = useState(params.scope || 'ALL');
  const [bookId, setBookId] = useState(null);
  const [kind, setKind] = useState('Bible');
  const [wholeWord, setWholeWord] = useState(false);
  const [phraseOnly, setPhraseOnly] = useState(false);
  const multiWord = q.trim().split(/\s+/).filter(Boolean).length > 1;

  const search = useBibleSearch(kind === 'Bible' ? q : '', { translation: state.translation, wholeWord, phraseOnly: phraseOnly && multiWord });
  const { result, index, source } = search;
  const grouped = useMemo(() => groupRows(index, result, { testament: scope, bookId }), [index, result, scope, bookId]);
  const terms = result ? Array.from(new Set([result.query, ...result.query.split(' ')])).filter((t) => t.length >= 2) : [];
  const paged = usePaged(grouped.rows, `${result ? result.query : ''}|${scope}|${bookId}|${wholeWord}|${phraseOnly}|${source ? source.id : ''}`);

  const parsed = useMemo(() => {
    const m = q.match(/^([1-3]?\s?[a-z]+)\s+(\d+)(?::(\d+))?$/i);
    if (!m) return null;
    const b = BOOKS.find((x) => x.name.toLowerCase().startsWith(m[1].toLowerCase().trim()));
    return b ? { bookId: b.id, chapter: Number(m[2]), verse: m[3] ? Number(m[3]) : null } : null;
  }, [q]);

  const other = useMemo(() => {
    const t = q.toLowerCase();
    if (!t || kind === 'Bible') return [];
    const pool =
      kind === 'People'
        ? require('../data/seed').PEOPLE.map((p) => ({ title: p.name, sub: p.headline, go: () => nav.push('Person', { id: p.id }) }))
        : kind === 'Communities'
        ? state.communities.map((c) => ({ title: c.name, sub: c.description, go: () => nav.push('Group', { id: c.id }) }))
        : state.feed.map((f) => ({ title: f.author + ' · ' + f.kind, sub: f.text, go: () => nav.push('Feed') }));
    return pool.filter((p) => (p.title + ' ' + p.sub).toLowerCase().includes(t));
  }, [q, kind]);

  const openVerse = (r) => nav.push('Bible', { bookId: r.bookId, chapter: r.chapter, verse: r.verse });
  const searching = kind === 'Bible' && search.status === 'searching';
  const trLabel = source ? source.id : state.translation;
  const scopeCount = result ? grouped.count : 0;

  const summary = result ? (
    <View style={styles.summary}>
      <Text style={styles.summaryBig}>
        {`${scopeCount.toLocaleString()} verse${scopeCount === 1 ? '' : 's'}`}
        {scope === 'ALL' && !bookId && result.occurrences ? <Text style={styles.summarySmall}>{`  ·  ${result.occurrences.toLocaleString()} occurrence${result.occurrences === 1 ? '' : 's'} of “${result.query}”`}</Text> : null}
      </Text>
      <Text style={styles.summaryNote}>
        {source && source.fallback
          ? `Searching the King James Version — ${source.requested} isn't stored on this device.${canDownload ? ` Download ${source.requested} for offline (Translations) to search it.` : ''}`
          : `Searching the ${translationInfo(source ? source.id : 'KJV').name || trLabel} (${trLabel}) · every verse, no limit`}
      </Text>
    </View>
  ) : null;

  const header = (
    <View>
      <Input
        placeholder="Search words, verses, or references (e.g. John 3:16)..."
        value={q}
        onChangeText={(v) => { setQ(v); setBookId(null); }}
        autoFocus
        returnKeyType="search"
        onSubmitEditing={() => q && dispatch({ type: 'saveSearch', q })}
      />
      <Pills items={['Bible', 'People', 'Communities', 'Posts']} value={kind} onChange={setKind} style={{ marginTop: 12 }} />
      {kind === 'Bible' ? (
        <View style={styles.filterRow}>
          {SCOPES.map(([k, label]) => (
            <Pill key={k} small label={label} active={scope === k} onPress={() => { setScope(k); setBookId(null); }} />
          ))}
        </View>
      ) : null}
      {kind === 'Bible' && q.trim().length >= 2 ? (
        <View style={styles.filterRow}>
          <Toggle label="Whole words" on={wholeWord} onPress={() => setWholeWord((v) => !v)} />
          {multiWord ? <Toggle label="Exact phrase" on={phraseOnly} onPress={() => setPhraseOnly((v) => !v)} /> : null}
        </View>
      ) : null}

      {parsed ? (
        <ScaleIn from={0.94}>
          <Row
            title={`Open ${refLabel(parsed.bookId, parsed.chapter, parsed.verse)}`}
            subtitle="Direct Scripture reference detected"
            tint={colors.gold}
            right="›"
            onPress={() => nav.push('Bible', parsed)}
            style={{ marginTop: 10 }}
          />
        </ScaleIn>
      ) : null}

      {!q ? (
        <FadeInUp key="recent" distance={8} duration={300}>
          <Section title="Recent Searches">
            {state.savedSearches.map((s, i) => (
              <FadeInUp key={s} index={i} distance={8}>
                <Row title={s} right="›" onPress={() => setQ(s)} />
              </FadeInUp>
            ))}
            <Text style={styles.suggestLabel}>Suggested</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {['faith', 'grace', 'hope', 'forgiveness', 'peace', 'righteousness'].map((w) => (
                <Pill key={w} small label={w} onPress={() => setQ(w)} />
              ))}
            </View>
          </Section>
        </FadeInUp>
      ) : kind === 'Bible' ? (
        <View style={{ marginTop: 12 }}>
          {searching ? (
            <View style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={colors.gold} />
                <Text style={styles.summaryNote}>{result ? 'Updating results…' : `Searching all 31,102 verses…`}</Text>
              </View>
              <ProgressLine progress={search.progress} />
            </View>
          ) : null}
          {summary}
          {result && !searching ? <BookFilterChips index={index} perBook={result.perBook} testament={scope} value={bookId} onChange={setBookId} /> : null}
          {search.status === 'error' ? <Empty title="Search isn't available right now" body={search.error} /> : null}
          {result && !searching && !grouped.count ? (
            <Empty title="No matches found" body={scope !== 'ALL' || bookId ? 'Try the whole Bible, or another word.' : wholeWord ? 'Try turning off “Whole words”.' : 'Try a different word or spelling (KJV wording, e.g. “charity”).'} />
          ) : null}
        </View>
      ) : (
        <Section title={`${other.length} result${other.length === 1 ? '' : 's'}`}>
          {other.map((o, i) => (
            <FadeInUp key={i} index={i} distance={10} duration={340}>
              <Row title={o.title} subtitle={o.sub} right="›" onPress={o.go} />
            </FadeInUp>
          ))}
          {!other.length ? <Empty title="Nothing found" body="Try a different keyword." /> : null}
        </Section>
      )}
    </View>
  );

  const data = kind === 'Bible' && q ? paged.visible : [];
  return (
    <Screen back title="Search & Concordance" scroll={false} padded={false}>
      <PagedList
        data={data}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => (item.type === 'book' ? <BookHeaderRow row={item} /> : <VerseResultRow row={item} terms={terms} onPress={openVerse} showTag={terms.length > 1} />)}
        header={header}
        footer={data.length ? (
          <View style={resultStyles.footer}>
            {paged.hasMore ? <ActivityIndicator size="small" color={colors.muted} /> : null}
            <Text style={resultStyles.footerText}>
              {paged.hasMore ? `Showing ${grouped.rows.slice(0, paged.shown).filter((r) => r.type === 'verse').length.toLocaleString()} of ${grouped.count.toLocaleString()} verses` : `End of results · all ${grouped.count.toLocaleString()} verses shown`}
            </Text>
          </View>
        ) : null}
        paged={paged}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 48 }}
      />
    </Screen>
  );
}

function Toggle({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.toggle, on && styles.toggleOn, pressed && { opacity: 0.75 }]} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <View style={[styles.toggleBox, on && styles.toggleBoxOn]}>{on ? <Text style={styles.toggleTick}>✓</Text> : null}</View>
      <Text style={[styles.toggleText, on && { color: colors.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  suggestLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginTop: 18, marginBottom: 10 },
  summary: { marginBottom: 8 },
  summaryBig: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg },
  summarySmall: { fontFamily: fonts.serif, fontSize: 14, color: colors.muted },
  summaryNote: { fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  toggleOn: { borderColor: colors.gold, backgroundColor: colors.goldFaint },
  toggleBox: { width: 16, height: 16, borderRadius: 5, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  toggleBoxOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  toggleTick: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  toggleText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
});
