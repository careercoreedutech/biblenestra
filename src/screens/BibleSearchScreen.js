// Search & Concordance screen, rebuilt in the Figma "Bible search" design (src/design/sanctuary.js).
//
// • Every matching verse is listed (grouped by book) in a virtualised FlatList that renders 50 rows
//   at a time and loads the next page as you scroll.
// • Total verses + occurrences are shown; OT / NT and per-book filters apply instantly to the result.
// • Searches the reader's translation when its full text is on the device, otherwise the bundled KJV
//   (and says so). The search runs in slices so typing stays smooth on a phone.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { FadeInUp, ScaleIn } from '../components/Motion';
import { Icon } from '../components/Icons';
import { Empty } from '../components/ui';
import { HighlightedText, PagedList, ProgressLine, usePaged } from '../components/VerseResults';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { BOOKS, refLabel } from '../data/bible';
import { translationInfo } from '../bible/catalog';
import { canDownload } from '../bible/loader';
import { useBibleSearch, groupRows } from '../bible/search';
import { d, df, k, PageHeader, SectionTitle, Tap } from '../design/sanctuary';

const SCOPES = [['ALL', 'Whole Bible'], ['OT', 'Old Testament'], ['NT', 'New Testament']];
const KINDS = ['Bible', 'People', 'Communities', 'Posts'];

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
    <View style={s.summary}>
      <View style={s.summaryTop}>
        <Text style={s.summaryText} numberOfLines={2}>
          {`${scopeCount.toLocaleString()} verse${scopeCount === 1 ? '' : 's'}`}
          {scope === 'ALL' && !bookId && result.occurrences ? `  ·  ${result.occurrences.toLocaleString()} occurrence${result.occurrences === 1 ? '' : 's'} of “${result.query}”` : ''}
        </Text>
        <View style={s.trTag}>
          <Text style={s.trTagText}>{trLabel}</Text>
          <Icon name="chevron-right" size={12} color={d.plum} />
        </View>
      </View>
      <Text style={s.summaryNote}>
        {source && source.fallback
          ? `Searching the King James Version — ${source.requested} isn't stored on this device.${canDownload ? ` Download ${source.requested} for offline (Translations) to search it.` : ''}`
          : `Searching the ${translationInfo(source ? source.id : 'KJV').name || trLabel} (${trLabel}) · every verse, no limit`}
      </Text>
    </View>
  ) : null;

  const bookChips = useMemo(() => {
    if (!index || !result || !result.perBook) return [];
    return index.books.filter((b) => result.perBook[b.id] && (scope === 'ALL' || b.testament === scope));
  }, [index, result, scope]);

  const header = (
    <View>
      <PageHeader title="Search the Bible" subtitle="Words, themes & passages" back onBack={() => nav.pop()} action={null} />

      <View style={s.searchBox}>
        <Icon name="search" size={18} color={d.muted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search words, verses, or references (e.g. John 3:16)..."
          placeholderTextColor="#AA9A8C"
          value={q}
          onChangeText={(v) => { setQ(v); setBookId(null); }}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => q && dispatch({ type: 'saveSearch', q })}
          accessibilityLabel="Search the Bible"
        />
        {q ? (
          <Tap onPress={() => { setQ(''); setBookId(null); }} hitSlop={8} accessibilityLabel="Clear search">
            <Icon name="x" size={15} color={d.muted} />
          </Tap>
        ) : null}
      </View>

      <View style={s.chipRow}>
        {KINDS.map((x) => (
          <Chip key={x} label={x} active={kind === x} onPress={() => setKind(x)} />
        ))}
      </View>

      {kind === 'Bible' ? (
        <View style={s.chipRow}>
          {SCOPES.map(([key, label]) => (
            <Chip key={key} label={label} active={scope === key} onPress={() => { setScope(key); setBookId(null); }} />
          ))}
        </View>
      ) : null}
      {kind === 'Bible' && q.trim().length >= 2 ? (
        <View style={s.chipRow}>
          <Chip label={`${wholeWord ? '✓ ' : ''}Whole words`} active={wholeWord} onPress={() => setWholeWord((v) => !v)} />
          {multiWord ? <Chip label={`${phraseOnly ? '✓ ' : ''}Exact phrase`} active={phraseOnly} onPress={() => setPhraseOnly((v) => !v)} /> : null}
        </View>
      ) : null}

      {parsed ? (
        <ScaleIn from={0.94}>
          <Tap onPress={() => nav.push('Bible', parsed)} style={s.refCard} accessibilityLabel={`Open ${refLabel(parsed.bookId, parsed.chapter, parsed.verse)}`}>
            <View style={{ flex: 1 }}>
              <Text style={s.refTitle}>{`Open ${refLabel(parsed.bookId, parsed.chapter, parsed.verse)}`}</Text>
              <Text style={s.refSub}>Direct Scripture reference detected</Text>
            </View>
            <Icon name="chevron-right" size={16} color={d.plum} />
          </Tap>
        </ScaleIn>
      ) : null}

      {!q ? (
        <FadeInUp key="recent" distance={8} duration={300}>
          {state.savedSearches.length ? <SectionTitle eyebrow="Recent" title="Searches" /> : null}
          {state.savedSearches.map((item, i) => (
            <FadeInUp key={item} index={i} distance={8}>
              <Tap onPress={() => setQ(item)} style={s.recentRow}>
                <Text style={s.recentText}>{item}</Text>
                <Icon name="chevron-right" size={15} color={d.muted} />
              </Tap>
            </FadeInUp>
          ))}
          <Text style={s.suggestLabel}>Suggested</Text>
          <View style={s.chipRow}>
            {['faith', 'grace', 'hope', 'forgiveness', 'peace', 'righteousness'].map((w) => (
              <Chip key={w} label={w} onPress={() => setQ(w)} />
            ))}
          </View>
        </FadeInUp>
      ) : kind === 'Bible' ? (
        <View style={{ marginTop: 12 }}>
          {searching ? (
            <View style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={d.plum} />
                <Text style={s.summaryNote}>{result ? 'Updating results…' : `Searching all 31,102 verses…`}</Text>
              </View>
              <ProgressLine progress={search.progress} />
            </View>
          ) : null}
          {summary}
          {result && !searching && bookChips.length ? (
            <View style={s.chipRow}>
              <Chip label={`All books (${grouped.count})`} active={!bookId} onPress={() => setBookId(null)} />
              {bookChips.map((b) => (
                <Chip key={b.id} label={`${b.name} (${result.perBook[b.id]})`} active={bookId === b.id} onPress={() => setBookId(b.id)} />
              ))}
            </View>
          ) : null}
          {search.status === 'error' ? <Empty title="Search isn't available right now" body={search.error} /> : null}
          {result && !searching && !grouped.count ? (
            <Empty title="No matches found" body={scope !== 'ALL' || bookId ? 'Try the whole Bible, or another word.' : wholeWord ? 'Try turning off “Whole words”.' : 'Try a different word or spelling (KJV wording, e.g. “charity”).'} />
          ) : null}
        </View>
      ) : (
        <View style={{ marginTop: 12 }}>
          <SectionTitle eyebrow="Results" title={`${other.length} result${other.length === 1 ? '' : 's'}`} />
          {other.map((o, i) => (
            <FadeInUp key={i} index={i} distance={10} duration={340}>
              <Tap onPress={o.go} style={s.recentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.otherTitle}>{o.title}</Text>
                  {o.sub ? <Text style={s.otherSub} numberOfLines={2}>{o.sub}</Text> : null}
                </View>
                <Icon name="chevron-right" size={15} color={d.muted} />
              </Tap>
            </FadeInUp>
          ))}
          {!other.length ? <Empty title="Nothing found" body="Try a different keyword." /> : null}
        </View>
      )}
    </View>
  );

  const renderItem = ({ item }) => {
    if (item.type === 'book') {
      return (
        <View style={s.bookHead}>
          <Text style={s.bookHeadName}>{item.name}</Text>
          <Text style={s.bookHeadCount}>{`${item.n} verse${item.n === 1 ? '' : 's'}`}</Text>
        </View>
      );
    }
    return (
      <Tap onPress={() => openVerse(item)} style={s.resultRow} accessibilityLabel={`Open ${refLabel(item.bookId, item.chapter, item.verse)}`}>
        <Text style={s.resultRef}>{refLabel(item.bookId, item.chapter, item.verse)}{item.exact ? '  · Exact' : ''}</Text>
        <HighlightedText text={item.text} terms={terms} style={s.resultText} />
        <View style={s.resultChevron}>
          <Icon name="chevron-right" size={14} color={d.muted} />
        </View>
      </Tap>
    );
  };

  const data = kind === 'Bible' && q ? paged.visible : [];
  return (
    <View style={k.screen}>
      <PagedList
        data={data}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        header={header}
        footer={data.length ? (
          <View style={s.footer}>
            {paged.hasMore ? <ActivityIndicator size="small" color={d.muted} /> : null}
            <Text style={s.footerText}>
              {paged.hasMore ? `Showing ${grouped.rows.slice(0, paged.shown).filter((r) => r.type === 'verse').length.toLocaleString()} of ${grouped.count.toLocaleString()} verses` : `End of results · all ${grouped.count.toLocaleString()} verses shown`}
            </Text>
          </View>
        ) : null}
        paged={paged}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 48 }}
      />
    </View>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <Tap onPress={onPress} style={[s.chip, active && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!active }}>
      <Text style={[s.chipText, active && s.chipTextOn]}>{label}</Text>
    </Tap>
  );
}

const s = StyleSheet.create({
  searchBox: { height: 48, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginTop: 6 },
  searchInput: { flex: 1, fontFamily: df.sans, fontSize: 13, color: d.ink, paddingVertical: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { paddingVertical: 8, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  chipOn: { backgroundColor: d.ink, borderColor: d.ink },
  chipText: { fontFamily: df.sansBold, fontSize: 11, color: d.muted },
  chipTextOn: { color: '#FFFFFF' },
  refCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  refTitle: { fontFamily: df.displayBold, fontSize: 16, color: d.ink },
  refSub: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 2 },
  suggestLabel: { fontFamily: df.sansHeavy, fontSize: 9, letterSpacing: 1.3, textTransform: 'uppercase', color: d.plum, marginTop: 22, marginBottom: 2 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: d.line },
  recentText: { flex: 1, fontFamily: df.displayBold, fontSize: 15, color: d.ink },
  otherTitle: { fontFamily: df.displayBold, fontSize: 15, color: d.ink },
  otherSub: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 3, lineHeight: 16 },
  summary: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: d.line },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  summaryText: { flexShrink: 1, fontFamily: df.sansBold, fontSize: 12, color: d.muted },
  summaryNote: { fontFamily: df.sans, fontSize: 11, lineHeight: 16, color: d.muted, marginTop: 4 },
  trTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  trTagText: { fontFamily: df.sansHeavy, fontSize: 11, color: d.plum },
  bookHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 18, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: d.line },
  bookHeadName: { fontFamily: df.displayBold, fontSize: 15, color: d.ink },
  bookHeadCount: { fontFamily: df.sans, fontSize: 11, color: d.muted },
  resultRow: { paddingVertical: 16, paddingLeft: 8, paddingRight: 24, borderBottomWidth: 1, borderBottomColor: d.line },
  resultRef: { fontFamily: df.sansHeavy, fontSize: 10, color: d.plum },
  resultText: { fontFamily: df.display, fontSize: 13, lineHeight: 20, color: d.ink, marginTop: 5 },
  resultChevron: { position: 'absolute', right: 2, top: '50%', marginTop: -7 },
  footer: { paddingVertical: 18, alignItems: 'center' },
  footerText: { fontFamily: df.sans, fontSize: 12, color: d.muted },
});
