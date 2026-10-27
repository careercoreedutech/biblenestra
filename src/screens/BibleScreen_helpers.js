import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, Section, Row, Pill, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider } from '../components/ui';
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import {
  BOOKS,
  TRANSLATIONS,
  CHAPTER_TITLES,
  COMMENTARY,
  CROSS_REFS,
  WORD_STUDY,
  getChapter,
  refLabel,
  searchBible,
  bookName,
} from '../data/bible';

// ---------- Study panel: commentary, cross-refs, word study ----------
export function StudyScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState(params.tab || 'Commentary');
  const key = `${params.bookId}:${params.chapter}`;
  const verses = getChapter(state.translation, params.bookId, params.chapter) || [];
  const verse = params.verse ? verses[params.verse - 1] : null;
  const words = verse ? Object.keys(WORD_STUDY).filter((w) => verse.toLowerCase().includes(w)) : Object.keys(WORD_STUDY);

  return (
    <Screen back title="Scripture Study" subtitle={refLabel(params.bookId, params.chapter, params.verse)}>
      {verse ? (
        <View style={styles.verseQuoteBox}>
          <Text style={styles.studyVerse}>"{verse}"</Text>
          <Text style={styles.studyRef}>{refLabel(params.bookId, params.chapter, params.verse)} ({state.translation})</Text>
        </View>
      ) : null}

      <Pills
        items={['Commentary', 'Cross-references', 'Word study', 'Context']}
        value={tab}
        onChange={setTab}
        style={{ marginTop: 12 }}
      />

      {tab === 'Commentary' ? (
        (COMMENTARY[key] || []).length ? (
          (COMMENTARY[key] || []).map((c, i) => (
            <View key={i} style={styles.commCard}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Tag label={c.tradition} tint={colors.gold} />
                <Tag label="Commentary" tint={colors.amber} />
              </View>
              <Text style={styles.commText}>{c.text}</Text>
              <Text style={styles.commSrc}>Source: {c.source}</Text>
              <Button
                small
                kind="ghost"
                label="Save to library"
                style={{ alignSelf: 'flex-start', marginTop: 10 }}
                onPress={() =>
                  dispatch({
                    type: 'saveAnswer',
                    a: {
                      question: 'Commentary on ' + refLabel(params.bookId, params.chapter),
                      blocks: [{ type: 'Commentary', source: c.source, text: c.text }],
                    },
                  })
                }
              />
            </View>
          ))
        ) : (
          <Empty title="No commentary loaded" body="Licensed commentary will appear here when connected." />
        )
      ) : null}

      {tab === 'Cross-references' ? (
        (CROSS_REFS[key] || []).map((x, i) => (
          <Row key={i} title={x.ref} subtitle={x.why} right="›" onPress={() => {}} />
        ))
      ) : null}

      {tab === 'Word study' ? (
        <View>
          <Notice tint={colors.teal} text="Lexicon definitions from original Hebrew, Aramaic, and Greek." />
          {words.map((w) => {
            const d = WORD_STUDY[w];
            return (
              <View key={w} style={styles.commCard}>
                <Text style={styles.wordHead}>
                  {d.original}{' '}
                  <Text style={{ color: colors.gold, fontSize: 13, fontFamily: fonts.sansMedium }}>
                    {d.translit} · {d.lang} · {d.strongs}
                  </Text>
                </Text>
                <Text style={styles.commText}>
                  Lemma: {d.lemma}{'\n'}Definition Range: {d.meaning}{'\n'}Grammar: {d.grammar}
                </Text>
                <Text style={[styles.commText, { color: colors.teal, fontWeight: '700' }]}>
                  In this passage: {d.contextNote}
                </Text>
              </View>
            );
          })}
          {!words.length ? <Empty title="No word study data for this verse" body="Word studies are indexed for key theological terms." /> : null}
        </View>
      ) : null}

      {tab === 'Context' ? (
        <View>
          <Row title="Book introduction" subtitle={`${bookName(params.bookId)} · authorship, date, audience`} right="›" />
          <Row title="Historical background" subtitle="People, places, customs in this era" right="›" />
          <Row title="Factbook" subtitle="Identified people, events, and concepts" right="›" onPress={() => nav.push('Factbook', { bookId: params.bookId, chapter: params.chapter })} />
        </View>
      ) : null}

      <Button label="Ask AI Bible Intelligence" onPress={() => nav.push('BibleChat', { context: params })} style={{ marginTop: 24 }} />
    </Screen>
  );
}

// ---------- Factbook ----------
export function FactbookScreen({ params }) {
  const entries = {
    'MAT:1': [
      { type: 'Person', name: 'Abraham', text: 'Patriarch to whom the promise of blessing for all nations was made (Genesis 12, 22).' },
      { type: 'Person', name: 'Tamar', text: 'Daughter-in-law of Judah; mother of Perez (Genesis 38).' },
      { type: 'Person', name: 'Rahab', text: 'Woman of Jericho who hid the Israelite spies (Joshua 2).' },
      { type: 'Event', name: 'Babylonian exile', text: 'Deportation of Judah to Babylon, 597–586 BC.' },
      { type: 'Concept', name: 'Emmanuel', text: '"God with us", from Isaiah 7:14.' },
    ],
    'JHN:3': [
      { type: 'Person', name: 'Nicodemus', text: 'Pharisee and member of the Sanhedrin; later helps bury Jesus (John 19).' },
      { type: 'Event', name: 'Bronze serpent', text: 'Numbers 21: Moses lifts up a serpent so the people may live.' },
    ],
    'PSA:23': [
      { type: 'Person', name: 'David', text: 'Shepherd, king of Israel, psalmist.' },
      { type: 'Concept', name: 'Shepherd', text: 'Common ancient Near Eastern image for a caring protector and ruler.' },
    ],
  };
  const list = entries[`${params.bookId}:${params.chapter}`] || [];
  return (
    <Screen back title="Factbook" subtitle={refLabel(params.bookId, params.chapter)}>
      <Notice tint={colors.teal} text="Distinguishes biblical facts, historical archeology, and licensed theological notes." />
      {list.map((e) => (
        <Row
          key={e.name}
          title={e.name}
          subtitle={e.text}
          left={<Text style={{ fontSize: 9.5, color: colors.gold, fontFamily: fonts.sansMedium }}>{e.type.slice(0, 3).toUpperCase()}</Text>}
          right="›"
        />
      ))}
      {!list.length ? <Empty title="No Factbook pages for this chapter yet" /> : null}
    </Screen>
  );
}

// ---------- Search / concordance ----------
export function SearchScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('ALL');
  const [kind, setKind] = useState('Bible');
  const results = useMemo(() => (kind === 'Bible' ? searchBible(q, state.translation, scope) : []), [q, scope, kind, state.translation]);

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

  return (
    <Screen back title="Search & Concordance">
      <Input
        placeholder="Search words, verses, or references (e.g. John 3:16)..."
        value={q}
        onChangeText={setQ}
        autoFocus
        returnKeyType="search"
        onSubmitEditing={() => q && dispatch({ type: 'saveSearch', q })}
      />
      <Pills items={['Bible', 'People', 'Communities', 'Posts']} value={kind} onChange={setKind} style={{ marginTop: 12 }} />
      {kind === 'Bible' ? <Pills small items={['ALL', 'OT', 'NT']} value={scope} onChange={setScope} /> : null}

      {parsed ? (
        <Row
          title={`Open ${refLabel(parsed.bookId, parsed.chapter, parsed.verse)}`}
          subtitle="Direct Scripture reference detected"
          tint={colors.gold}
          right="›"
          onPress={() => nav.push('Bible', parsed)}
        />
      ) : null}

      {!q ? (
        <Section title="Recent Searches">
          {state.savedSearches.map((s) => (
            <Row key={s} title={s} right="›" onPress={() => setQ(s)} />
          ))}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 14, fontFamily: fonts.sans }}>
            Suggested: faith, grace, hope, forgiveness, peace, righteousness
          </Text>
        </Section>
      ) : kind === 'Bible' ? (
        <Section title={`${results.length} result${results.length === 1 ? '' : 's'} in ${state.translation}`}>
          {results.map((r, i) => (
            <Row
              key={i}
              title={refLabel(r.bookId, r.chapter, r.verse)}
              subtitle={r.text}
              right={<Tag label={r.exact ? 'Exact' : 'Related'} tint={r.exact ? colors.gold : undefined} />}
              onPress={() => nav.push('Bible', { bookId: r.bookId, chapter: r.chapter, verse: r.verse })}
            />
          ))}
          {!results.length ? (
            <Empty
              title="No matches found in offline library"
              body="Search is currently querying all offline chapters."
            />
          ) : null}
        </Section>
      ) : (
        <Section title={`${other.length} result${other.length === 1 ? '' : 's'}`}>
          {other.map((o, i) => (
            <Row key={i} title={o.title} subtitle={o.sub} right="›" onPress={o.go} />
          ))}
          {!other.length ? <Empty title="Nothing found" body="Try a different keyword." /> : null}
        </Section>
      )}
    </Screen>
  );
}

// ---------- Library ----------
export function LibraryScreen() {
  const nav = useNav();
  const { state, dispatch, sync } = useStore();
  const [tab, setTab] = useState('Continue');

  return (
    <Screen back title="Study Library" subtitle={sync.status === 'saved' ? 'Synced with cloud' : sync.status}>
      <Pills
        items={['Continue', 'Notes', 'Highlights', 'Bookmarks', 'Saved answers', 'Recordings']}
        value={tab}
        onChange={setTab}
      />
      {tab === 'Continue' ? (
        <View style={{ marginTop: 8 }}>
          {state.recent.map((r) => (
            <Row
              key={r.bookId + r.chapter}
              title={CHAPTER_TITLES[`${r.bookId}:${r.chapter}`] || refLabel(r.bookId, r.chapter)}
              subtitle={refLabel(r.bookId, r.chapter)}
              right="›"
              onPress={() => nav.push('Bible', r)}
            />
          ))}
          {state.plans.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              subtitle={`Day ${p.done} of ${p.days}`}
              right="›"
              onPress={() => nav.push('Plan', { id: p.id })}
            />
          ))}
        </View>
      ) : null}

      {tab === 'Notes' ? (
        state.notes.length ? (
          state.notes.map((n) => (
            <Row
              key={n.id}
              title={refLabel(n.bookId, n.chapter, n.verse)}
              subtitle={n.text}
              right={
                <Pressable onPress={() => dispatch({ type: 'deleteNote', id: n.id })}>
                  <Text style={{ color: '#e85d5d', fontFamily: fonts.sansMedium, fontSize: 11.5 }}>Delete</Text>
                </Pressable>
              }
              onPress={() => nav.push('Bible', n)}
            />
          ))
        ) : (
          <Empty title="No notes recorded yet" body="Tap any verse in the Bible reader and choose Note." />
        )
      ) : null}

      {tab === 'Highlights' ? (
        state.highlights.map((h) => (
          <Row
            key={h.id}
            title={refLabel(h.bookId, h.chapter, h.verse)}
            subtitle={`${h.label} · ${h.when}`}
            left={<View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: h.color }} />}
            right="›"
            onPress={() => nav.push('Bible', h)}
          />
        ))
      ) : null}

      {tab === 'Bookmarks' ? (
        state.bookmarks.map((b) => (
          <Row
            key={b.id}
            title={refLabel(b.bookId, b.chapter, b.verse)}
            subtitle={`${b.folder} · ${b.when}`}
            right="›"
            onPress={() => nav.push('Bible', b)}
          />
        ))
      ) : null}

      {tab === 'Saved answers' ? (
        state.savedAnswers.length ? (
          state.savedAnswers.map((a) => (
            <Row
              key={a.id}
              title={a.question}
              subtitle={a.blocks.map((b) => b.text || b.ref).join(' ').slice(0, 120)}
            />
          ))
        ) : (
          <Empty title="No saved answers" body="Save insights directly from Bible Chat or Scripture Companion." />
        )
      ) : null}

      {tab === 'Recordings' ? (
        state.recordings.map((r) => (
          <Row
            key={r.id}
            title={r.title}
            subtitle={`${r.duration} · ${r.status} · ${r.privacy}`}
            right="›"
            onPress={() => nav.push('SermonStudio')}
          />
        ))
      ) : null}

      <Divider />
      <Row title="Export Study Archives" subtitle="Notes, highlights, and bookmarks (JSON)" right="›" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  verseQuoteBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    paddingLeft: 12,
    paddingVertical: 8,
    marginVertical: 10,
  },
  studyVerse: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.fg,
  },
  studyRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.gold,
    marginTop: 4,
  },
  commCard: {
    backgroundColor: '#1b1613',
    borderWidth: 1,
    borderColor: colors.lineLight,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  commText: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.passage,
    marginTop: 8,
  },
  commSrc: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 8,
  },
  wordHead: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    color: colors.fg,
  },
});
