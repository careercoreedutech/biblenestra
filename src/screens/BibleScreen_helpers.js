import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useToast } from '../components/Toast';
import { PressScale, FadeInUp, ScaleIn } from '../components/Motion';
import { Icon } from '../components/Icons';
import { Screen, Section, Row, Pill, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider, NightGlow } from '../components/ui';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import * as BibleData from '../data/bible';
import {
  BOOKS,
  TRANSLATIONS,
  CHAPTER_TITLES,
  getChapter,
  refLabel,
  searchBible,
  bookName,
} from '../data/bible';

// These datasets aren't exported by data/bible.js yet — fall back to empty so the screen still renders.
const COMMENTARY = BibleData.COMMENTARY || {};
const CROSS_REFS = BibleData.CROSS_REFS || {};
const { CONCORDANCE = [], WORD_KEYS = {}, parseRef } = BibleData;

// Words in a verse that have a lexicon entry (Hebrew for OT, Greek for NT)
function wordStudyFor(verseText, testament) {
  const words = (verseText || '').toLowerCase().match(/[a-z]+/g) || [];
  return CONCORDANCE.filter((c) => {
    if (testament === 'OT' ? c.lang !== 'Hebrew' : c.lang !== 'Greek') return false;
    const keys = WORD_KEYS[c.translit] || [];
    return keys.some((k) => words.includes(k));
  });
}

// ---------- Study panel: commentary, cross-refs, word study ----------
export function StudyScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState(params.tab || 'Commentary');
  const key = `${params.bookId}:${params.chapter}`;
  const verses = getChapter(state.translation, params.bookId, params.chapter) || [];
  const verse = params.verse ? verses[params.verse - 1] : null;
  const book = BOOKS.find((b) => b.id === params.bookId);
  const studyText = verse || verses.join(' ');
  const lexicon = wordStudyFor(studyText, book ? book.testament : 'NT');
  const toast = useToast();
  const [showIntro, setShowIntro] = useState(false);

  return (
    <Screen back title="Scripture Study" subtitle={refLabel(params.bookId, params.chapter, params.verse)}>
      {verse ? (
        <FadeInUp style={styles.verseQuoteBox}><NightGlow />
          <Text style={styles.quoteMark}>“</Text>
          <Text style={styles.studyVerse}>{verse}</Text>
          <Text style={styles.studyRef}>{refLabel(params.bookId, params.chapter, params.verse)} · {state.translation}</Text>
        </FadeInUp>
      ) : null}

      <Pills
        items={['Commentary', 'Cross-references', 'Word study', 'Context']}
        value={tab}
        onChange={setTab}
        style={{ marginTop: 12 }}
      />

      {/* Keyed on the tab so switching tabs cross-fades the panel in. */}
      <FadeInUp key={tab} distance={8} duration={300}>
      {tab === 'Commentary' ? (
        (COMMENTARY[key] || []).length ? (
          (COMMENTARY[key] || []).map((c, i) => (
            <FadeInUp key={i} index={i} distance={8} style={styles.commCard}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Badge label={c.tradition} tint={colors.gold} />
                <Badge label="Commentary" tint={colors.primary} />
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
                  }) || toast.show('Saved to your library', { icon: 'bookmark' })
                }
              />
            </FadeInUp>
          ))
        ) : (
          <Empty title="Commentary isn’t connected yet" body="Licensed commentaries appear here once a publisher is connected. Meanwhile, ask Bible Intelligence about this passage." action="Ask about this passage" onAction={() => nav.push('BibleChat', { context: params })} />
        )
      ) : null}

      {tab === 'Cross-references' ? (
        (CROSS_REFS[key] || []).length ? (
          (CROSS_REFS[key] || []).map((x, i) => (
            <Row
              key={i}
              title={(() => { const r = parseRef(x.ref); return r ? refLabel(r.bookId, r.chapter, r.verse) : x.ref; })()}
              subtitle={x.why}
              right="›"
              onPress={() => { const r = parseRef(x.ref); if (r) nav.push('Bible', r); }}
            />
          ))
        ) : (
          <Empty title="No cross-references yet" body="Linked passages will appear here when the study data is connected." />
        )
      ) : null}

      {tab === 'Word study' ? (
        <View>
          <Notice tint={colors.teal} text={`Original-language words found in ${verse ? 'this verse' : 'this chapter'} (${book && book.testament === 'OT' ? 'Hebrew' : 'Greek'}).`} />
          {lexicon.map((d, i) => (
            <FadeInUp key={d.strong} index={i} distance={8}>
            <PressScale onPress={() => nav.push('Concordance', { query: d.translit })} scaleTo={0.985} style={styles.commCard}>
              <Text style={styles.wordHead}>{d.lemma}</Text>
              <Text style={styles.wordMeta}>{d.translit} · {d.lang} · {d.strong} · {d.part}</Text>
              <View style={styles.wordGrid}>
                <Text style={styles.wordLabel}>Definition</Text><Text style={styles.wordValue}>{d.definition}</Text>
                <Text style={styles.wordLabel}>Meaning</Text><Text style={styles.wordValue}>{d.meaning}</Text>
                <Text style={styles.wordLabel}>Occurrences</Text><Text style={styles.wordValue}>{d.count} times in Scripture</Text>
              </View>
              <View style={styles.contextBox}>
                <Text style={styles.contextText}>Open in the concordance ›</Text>
              </View>
            </PressScale>
            </FadeInUp>
          ))}
          {!lexicon.length ? <Empty title="No lexicon entries for this verse" body="Word studies cover key terms like love, faith, grace, spirit, peace and mercy." /> : null}
        </View>
      ) : null}

      {tab === 'Context' ? (
        <View>
          <Row title="Book introduction" subtitle={book ? `${book.longTitle || book.name}` : bookName(params.bookId)} right={showIntro ? '' : '›'} onPress={() => setShowIntro(!showIntro)} />
          {showIntro && book ? (
            <FadeInUp distance={8} duration={280} style={[styles.commCard, { marginTop: 0, marginBottom: 8 }]}>
              <Text style={styles.wordMeta}>{book.testament === 'OT' ? 'Old Testament' : 'New Testament'} · {book.chapters} chapters</Text>
              <Text style={styles.commText}>{book.longTitle || book.name}. You are reading chapter {params.chapter} of {book.chapters}.</Text>
              <Button small kind="ghost" label={`Read ${book.name} 1`} style={{ alignSelf: 'flex-start', marginTop: 12 }} onPress={() => nav.push('Bible', { bookId: book.id, chapter: 1 })} />
            </FadeInUp>
          ) : null}
          <Row title="Historical background" subtitle="Ask about people, places and customs in this passage" right="›" onPress={() => nav.push('BibleChat', { context: params })} />
          <Row title="Factbook" subtitle="Identified people, events, and concepts" right="›" onPress={() => nav.push('Factbook', { bookId: params.bookId, chapter: params.chapter })} />
        </View>
      ) : null}
      </FadeInUp>

      <Button label="Ask AI Bible Intelligence" onPress={() => nav.push('BibleChat', { context: params })} style={{ marginTop: 24 }} />
    </Screen>
  );
}

// ---------- Factbook ----------
export function FactbookScreen({ params }) {
  const nav = useNav();
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
      {list.map((e, i) => (
        <FadeInUp key={e.name} index={i} distance={10}>
        <Row
          title={e.name}
          subtitle={e.text}
          left={<Text style={{ fontSize: 10, color: colors.gold, fontWeight: '800', letterSpacing: 0.8 }}>{e.type.slice(0, 3).toUpperCase()}</Text>}
          right="›"
          onPress={() => nav.push('BibleChat', { context: { bookId: params.bookId, chapter: params.chapter }, seed: `Who or what is ${e.name}?`, send: true })}
        />
        </FadeInUp>
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
        <ScaleIn from={0.94}>
          <Row
            title={`Open ${refLabel(parsed.bookId, parsed.chapter, parsed.verse)}`}
            subtitle="Direct Scripture reference detected"
            tint={colors.gold}
            right="›"
            onPress={() => nav.push('Bible', parsed)}
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
        <Section title={`${results.length} result${results.length === 1 ? '' : 's'} in ${state.translation}`}>
          {/* Keyed by position: results fade up on first appearance, but don't re-run on every keystroke. */}
          {results.map((r, i) => (
            <FadeInUp key={i} index={i} distance={10} duration={340}>
              <Row
                title={refLabel(r.bookId, r.chapter, r.verse)}
                subtitle={r.text}
                right={<Tag label={r.exact ? 'Exact' : 'Related'} tint={r.exact ? colors.gold : undefined} />}
                onPress={() => nav.push('Bible', { bookId: r.bookId, chapter: r.chapter, verse: r.verse })}
              />
            </FadeInUp>
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
            <FadeInUp key={i} index={i} distance={10} duration={340}>
              <Row title={o.title} subtitle={o.sub} right="›" onPress={o.go} />
            </FadeInUp>
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
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [openAnswer, setOpenAnswer] = useState(null);
  const toast = useToast();

  const exportArchive = async () => {
    const lines = [
      'BibleNestra — study archive',
      '',
      'NOTES',
      ...state.notes.map((n) => `• ${refLabel(n.bookId, n.chapter, n.verse)}: ${n.text}`),
      '',
      'HIGHLIGHTS',
      ...state.highlights.map((h) => `• ${refLabel(h.bookId, h.chapter, h.verse)}`),
      '',
      'BOOKMARKS',
      ...state.bookmarks.map((b) => `• ${refLabel(b.bookId, b.chapter, b.verse)} (${b.folder})`),
    ];
    try { await Share.share({ message: lines.join('\n'), title: 'BibleNestra study archive' }); }
    catch (e) { toast.show('Sharing isn’t available here', { tone: 'error' }); }
  };

  return (
    <Screen back title="Study Library" subtitle={sync.status === 'saved' ? 'Saved on this device' : sync.status === 'syncing' ? 'Saving…' : 'Couldn’t save — retrying'}>
      <Pills
        items={['Continue', 'Notes', 'Highlights', 'Bookmarks', 'Saved answers', 'Recordings']}
        value={tab}
        onChange={setTab}
      />
      {/* Keyed on the tab so each shelf cross-fades in. */}
      <FadeInUp key={tab} distance={8} duration={300}>
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
            editing === n.id ? (
              <ScaleIn key={n.id + ':edit'} from={0.96} style={[styles.commCard, { marginTop: 0, marginBottom: 8 }]}>
                <Text style={styles.wordMeta}>{refLabel(n.bookId, n.chapter, n.verse)}</Text>
                <Input value={draft} onChangeText={setDraft} multiline style={{ marginTop: 10, minHeight: 80 }} autoFocus />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Button small label="Save" onPress={() => { if (draft.trim()) { dispatch({ type: 'editNote', id: n.id, text: draft.trim() }); toast.show('Note updated', { icon: 'highlight' }); } setEditing(null); }} />
                  <Button small kind="ghost" label="Cancel" onPress={() => setEditing(null)} />
                </View>
              </ScaleIn>
            ) : (
              <Row
                key={n.id}
                title={refLabel(n.bookId, n.chapter, n.verse)}
                subtitle={n.text}
                right={
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <PressScale hitSlop={8} scaleTo={0.88} onPress={() => { setEditing(n.id); setDraft(n.text); }}>
                      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Edit</Text>
                    </PressScale>
                    <PressScale hitSlop={8} scaleTo={0.88} onPress={() => { dispatch({ type: 'deleteNote', id: n.id }); toast.show('Note deleted', { icon: 'trash', action: { label: 'Undo', onPress: () => dispatch({ type: 'note', n }) } }); }}>
                      <Text style={{ color: colors.negative, fontSize: 12, fontWeight: '700' }}>Delete</Text>
                    </PressScale>
                  </View>
                }
                onPress={() => nav.push('Bible', n)}
              />
            )
          ))
        ) : (
          <Empty title="No notes yet" body="Tap any verse in the Bible reader and choose Note." action="Open the Bible" onAction={() => nav.push('Bible', state.lastPosition)} />
        )
      ) : null}

      {tab === 'Highlights' ? (
        !state.highlights.length ? (
          <Empty title="No highlights yet" body="Tap a verse in the Bible reader and pick a colour to highlight it." action="Open the Bible" onAction={() => nav.push('Bible', state.lastPosition)} />
        ) : state.highlights.map((h) => (
          <Row
            key={h.id}
            title={refLabel(h.bookId, h.chapter, h.verse)}
            subtitle={`${h.label} · ${h.when}`}
            left={<View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: h.color }} />}
            right="›"
            onPress={() => nav.push('Bible', h)}
          />
        ))
      ) : null}

      {tab === 'Bookmarks' ? (
        !state.bookmarks.length ? (
          <Empty title="No bookmarks yet" body="Bookmark verses from the reader or Scripture Companion to find them here." action="Open the Bible" onAction={() => nav.push('Bible', state.lastPosition)} />
        ) : state.bookmarks.map((b) => (
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
            openAnswer === a.id ? (
              <FadeInUp key={a.id + ':open'} distance={6} duration={280}>
              <Pressable onPress={() => setOpenAnswer(null)} style={[styles.commCard, { marginTop: 0, marginBottom: 8 }]}>
                <Text style={styles.wordMeta}>{a.when}</Text>
                <Text style={[styles.wordHead, { fontSize: 19 }]}>{a.question}</Text>
                {a.blocks.map((b, i) => (
                  <View key={i} style={{ marginTop: 10 }}>
                    <Text style={styles.wordLabel}>{b.type}</Text>
                    <Text style={styles.wordValue}>{b.text || b.ref}</Text>
                  </View>
                ))}
              </Pressable>
              </FadeInUp>
            ) : (
              <Row
                key={a.id}
                title={a.question}
                subtitle={a.blocks.map((b) => b.text || b.ref).join(' ').slice(0, 120)}
                right="›"
                onPress={() => setOpenAnswer(a.id)}
              />
            )
          ))
        ) : (
          <Empty title="No saved answers" body="Save insights directly from Bible Chat or Scripture Companion." />
        )
      ) : null}

      {tab === 'Recordings' ? (
        !(state.recordings || []).length ? (
          <Empty title="No recordings yet" body="Record a sermon or teaching in Sermon Studio." action="Open Sermon Studio" onAction={() => nav.push('SermonStudio')} />
        ) : (state.recordings || []).map((r) => (
          <Row
            key={r.id}
            title={r.title}
            subtitle={`${r.duration} · ${r.status} · ${r.privacy}`}
            right="›"
            onPress={() => nav.push('SermonStudio')}
          />
        ))
      ) : null}
      </FadeInUp>

      <Divider />
      <Row title="Export study archive" subtitle="Share your notes, highlights and bookmarks" left={<Icon name="share" size={18} color={colors.primary} />} onPress={exportArchive} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  verseQuoteBox: { overflow: 'hidden',
    backgroundColor: colors.night,
    borderRadius: radius.lg,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    marginTop: 4,
    marginBottom: 6,
    ...shadow.md,
  },
  quoteMark: { fontFamily: fonts.display, fontSize: 44, lineHeight: 44, color: colors.goldLight, marginBottom: -12 },
  studyVerse: { fontFamily: fonts.serifItalic, fontSize: 18, lineHeight: 27, color: colors.nightFg },
  studyRef: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.goldLight, marginTop: 12 },
  commCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginTop: 12,
    ...shadow.sm,
  },
  commText: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, color: colors.passage, marginTop: 10 },
  commSrc: { fontSize: 11.5, color: colors.faint, marginTop: 10 },
  wordHead: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.fg },
  wordMeta: { fontSize: 12, fontWeight: '600', color: colors.gold, marginTop: 2 },
  wordGrid: { marginTop: 12, gap: 2 },
  wordLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.faint, marginTop: 8 },
  wordValue: { fontSize: 14, lineHeight: 20, color: colors.fg },
  contextBox: { marginTop: 14, backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: 12 },
  contextText: { fontSize: 13, lineHeight: 19, color: colors.primaryInk, fontWeight: '600' },
  suggestLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginTop: 18, marginBottom: 10 },
});
