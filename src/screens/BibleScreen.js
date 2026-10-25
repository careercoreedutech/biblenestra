import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, Section, Row, Pill, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider } from '../components/ui';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import { colors } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { BOOKS, TRANSLATIONS, CHAPTER_TITLES, COMMENTARY, CROSS_REFS, WORD_STUDY, getChapter, refLabel, searchBible, availableChapters, bookName } from '../data/bible';

const HIGHLIGHT_COLORS = [colors.teal, colors.yellow, colors.amber, colors.lavender, '#e88fb3'];

export default function BibleScreen({ params = {} }) {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const [pos, setPos] = useState({ bookId: params.bookId || state.lastPosition.bookId, chapter: params.chapter || state.lastPosition.chapter });
  const [selected, setSelected] = useState(params.verse || null);
  const [picker, setPicker] = useState(null); // 'book' | 'translation' | null
  const [panel, setPanel] = useState(null); // 'study' | 'note' | null
  const [noteText, setNoteText] = useState('');
  const [compare, setCompare] = useState(false);
  const [audio, setAudio] = useState(false);
  const tr = state.translation;
  const key = `${pos.bookId}:${pos.chapter}`;
  const verses = getChapter(tr, pos.bookId, pos.chapter);
  const title = CHAPTER_TITLES[key];
  const book = BOOKS.find((b) => b.id === pos.bookId);

  useEffect(() => { dispatch({ type: 'position', pos }); }, [pos.bookId, pos.chapter]);

  const hl = (v) => state.highlights.find((h) => h.bookId === pos.bookId && h.chapter === pos.chapter && h.verse === v);
  const noteFor = (v) => state.notes.filter((n) => n.bookId === pos.bookId && n.chapter === pos.chapter && n.verse === v);
  const bookmarked = state.bookmarks.some((b) => b.bookId === pos.bookId && b.chapter === pos.chapter && !b.verse);

  const go = (delta) => {
    const chs = availableChapters();
    const idx = chs.findIndex((c) => c.bookId === pos.bookId && c.chapter === pos.chapter);
    const next = chs[idx + delta];
    if (next) { setPos({ bookId: next.bookId, chapter: next.chapter }); setSelected(null); }
  };

  const setTranslation = (id) => {
    const t = TRANSLATIONS.find((x) => x.id === id);
    if (!t.available) return;
    dispatch({ type: 'set', patch: { translation: id } });
    setPicker(null);
  };

  const share = () => {
    if (!selected) return;
    const t = TRANSLATIONS.find((x) => x.id === tr);
    dispatch({ type: 'post', post: { kind: 'Verse', text: `"${verses[selected - 1]}" — ${refLabel(pos.bookId, pos.chapter, selected)} (${tr}, ${t.publisher})` } });
    nav.push('Feed');
  };

  return (
    <Screen
      scroll={false}
      padded={false}
      title={`${bookName(pos.bookId)} ${pos.chapter}`}
      subtitle={`${tr}${state.user.preset ? ' · ' + state.user.preset : ''}`}
      menu={() => setPicker('book')}
      right={<Pressable onPress={() => setPicker('translation')} hitSlop={10}><Text style={styles.trBtn}>{tr}</Text></Pressable>}
    >
      <View style={styles.toolbar}>
        <Pressable onPress={() => nav.push('Search')}><Text style={styles.tool}>⌕ Search</Text></Pressable>
        <Pressable onPress={() => setCompare(!compare)}><Text style={[styles.tool, compare && { color: colors.accent }]}>⫼ Compare</Text></Pressable>
        <Pressable onPress={() => setAudio(!audio)}><Text style={[styles.tool, audio && { color: colors.accent }]}>{audio ? '❚❚ Audio' : '▷ Audio'}</Text></Pressable>
        <Pressable onPress={() => dispatch({ type: 'bookmark', b: { bookId: pos.bookId, chapter: pos.chapter } })}><Text style={[styles.tool, bookmarked && { color: colors.accent }]}>{bookmarked ? '★' : '☆'} Save</Text></Pressable>
        <Pressable onPress={() => nav.push('Library')}><Text style={styles.tool}>▤ Library</Text></Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 140 }}>
        {audio ? <Notice tint={colors.teal} text={`Playing ${refLabel(pos.bookId, pos.chapter)} · ${tr} · 1.0× · Narration will stream from the licensed audio catalog.`} /> : null}
        <Text style={styles.eyebrow}>READING NOW</Text>
        {title ? <Text style={styles.chTitle}>{title}</Text> : null}
        {!verses ? (
          <Empty title="Not downloaded yet" body={`${refLabel(pos.bookId, pos.chapter)} in ${tr} is not available offline. Connect to download it, or open a chapter from the list.`} action="Browse available chapters" onAction={() => setPicker('book')} />
        ) : compare ? (
          <CompareView pos={pos} base={tr} others={state.compareWith} onPick={() => setPicker('compare')} />
        ) : (
          verses.map((v, i) => {
            const n = i + 1;
            const h = hl(n);
            const notes = noteFor(n);
            const isSel = selected === n;
            return (
              <Pressable key={n} onPress={() => { setSelected(isSel ? null : n); setPanel(null); }} style={[styles.verse, isSel && styles.verseSel]}>
                <Text style={[styles.verseText, { fontSize: state.fontSize, lineHeight: state.fontSize * 1.55 }]}>
                  <Text style={styles.vnum}>{n}  </Text>
                  <Text style={h ? { backgroundColor: h.color + '33', color: colors.fg } : null}>{v}</Text>
                  {notes.length ? <Text style={{ color: colors.amber }}>  ✎</Text> : null}
                </Text>
              </Pressable>
            );
          })
        )}
        <View style={styles.pager}>
          <Button small kind="ghost" label="‹ Previous" onPress={() => go(-1)} />
          <Button small kind="ghost" label="Next ›" onPress={() => go(1)} />
        </View>
        <Text style={styles.copyright}>{TRANSLATIONS.find((t) => t.id === tr).name} · {TRANSLATIONS.find((t) => t.id === tr).publisher}</Text>
      </ScrollView>

      {/* Verse action sheet */}
      {selected && verses ? (
        <View style={styles.sheet}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.sheetRef}>{refLabel(pos.bookId, pos.chapter, selected)}</Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={10}><Text style={{ color: colors.muted }}>✕</Text></Pressable>
          </View>
          <View style={styles.colors}>
            {HIGHLIGHT_COLORS.map((c) => (
              <Pressable key={c} onPress={() => dispatch({ type: 'highlight', h: { bookId: pos.bookId, chapter: pos.chapter, verse: selected, color: c, label: 'Highlight' } })} style={[styles.swatch, { backgroundColor: c }, hl(selected)?.color === c && styles.swatchOn]} />
            ))}
            <Pressable onPress={() => setPanel(panel === 'note' ? null : 'note')}><Text style={styles.sheetAct}>✎ Note</Text></Pressable>
            <Pressable onPress={() => dispatch({ type: 'bookmark', b: { bookId: pos.bookId, chapter: pos.chapter, verse: selected } })}><Text style={styles.sheetAct}>☆ Bookmark</Text></Pressable>
            <Pressable onPress={share}><Text style={styles.sheetAct}>↗ Share</Text></Pressable>
          </View>
          {panel === 'note' ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Input placeholder="Private note (only you can see this)" value={noteText} onChangeText={setNoteText} multiline style={{ minHeight: 60 }} />
              <Button small label="Save note" onPress={() => { if (noteText.trim()) { dispatch({ type: 'note', n: { bookId: pos.bookId, chapter: pos.chapter, verse: selected, text: noteText.trim() } }); setNoteText(''); setPanel(null); } }} />
            </View>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
            <Pill small label="Bible Chat" onPress={() => nav.push('BibleChat', { context: { ...pos, verse: selected } })} />
            <Pill small label="Commentary" onPress={() => nav.push('Study', { ...pos, verse: selected, tab: 'Commentary' })} />
            <Pill small label="Cross-refs" onPress={() => nav.push('Study', { ...pos, verse: selected, tab: 'Cross-references' })} />
            <Pill small label="Word study" onPress={() => nav.push('Study', { ...pos, verse: selected, tab: 'Word study' })} />
            <Pill small label="Compare" onPress={() => setCompare(true)} />
            <Pill small label="Memorize" onPress={() => nav.push('Learn', { tab: 'Memorize' })} />
            <Pill small label="Pray this" onPress={() => nav.push('NewPrayer', { verse: refLabel(pos.bookId, pos.chapter, selected) })} />
            <Pill small label="Add to plan" onPress={() => nav.push('Learn', { tab: 'Plans' })} />
          </ScrollView>
        </View>
      ) : null}

      {/* Book / chapter picker */}
      <Modal visible={picker === 'book'} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        <View style={styles.modal}>
          <View style={styles.modalHead}><Text style={styles.modalTitle}>Books</Text><Pressable onPress={() => setPicker(null)}><Text style={{ color: colors.muted }}>Done</Text></Pressable></View>
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
            <Text style={styles.modalSub}>Available offline in {tr}</Text>
            {availableChapters().map((c) => (
              <Row key={c.bookId + c.chapter} title={c.title} subtitle={refLabel(c.bookId, c.chapter)} onPress={() => { setPos({ bookId: c.bookId, chapter: c.chapter }); setSelected(null); setPicker(null); }} />
            ))}
            <Text style={[styles.modalSub, { marginTop: 20 }]}>All books</Text>
            {['OT', 'NT'].map((t) => (
              <View key={t}>
                <Text style={styles.testament}>{t === 'OT' ? 'Old Testament' : 'New Testament'}</Text>
                <View style={styles.bookGrid}>
                  {BOOKS.filter((b) => b.testament === t).map((b) => (
                    <Pill key={b.id} small label={b.name} active={b.id === pos.bookId} onPress={() => { setPos({ bookId: b.id, chapter: 1 }); setSelected(null); setPicker(null); }} />
                  ))}
                </View>
              </View>
            ))}
            {book ? (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.testament}>{book.name} · chapters</Text>
                <View style={styles.bookGrid}>
                  {Array.from({ length: Math.min(book.chapters, 60) }, (_, i) => i + 1).map((n) => (
                    <Pill key={n} small label={String(n)} active={n === pos.chapter} tint={getChapter(tr, book.id, n) ? undefined : colors.line} onPress={() => { setPos({ bookId: book.id, chapter: n }); setSelected(null); setPicker(null); }} />
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      {/* Translation picker */}
      <Modal visible={picker === 'translation' || picker === 'compare'} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        <View style={styles.modal}>
          <View style={styles.modalHead}><Text style={styles.modalTitle}>{picker === 'compare' ? 'Compare with' : 'Translations'}</Text><Pressable onPress={() => setPicker(null)}><Text style={{ color: colors.muted }}>Done</Text></Pressable></View>
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
            {['English', 'French', 'Spanish', 'Yoruba', 'Swahili'].map((lang) => (
              <View key={lang}>
                <Text style={styles.testament}>{lang}</Text>
                {TRANSLATIONS.filter((t) => t.lang === lang).map((t) => {
                  const inCompare = state.compareWith.includes(t.id);
                  return (
                    <Row
                      key={t.id}
                      title={`${t.id} · ${t.name}`}
                      subtitle={t.available ? `${t.publisher}${t.offline ? ' · Offline' : ''}` : `Not yet licensed for your region · ${t.publisher}`}
                      tint={t.available ? undefined : colors.muted}
                      right={picker === 'compare' ? (t.available ? <Badge label={inCompare ? 'Added' : 'Add'} tint={inCompare ? colors.teal : colors.muted} /> : <Tag label="Unavailable" />) : t.id === tr ? <Badge label="Current" /> : t.available ? null : <Tag label="Unavailable" />}
                      onPress={() => {
                        if (!t.available) return;
                        if (picker === 'compare') dispatch({ type: 'set', patch: { compareWith: inCompare ? state.compareWith.filter((x) => x !== t.id) : [...state.compareWith, t.id] } });
                        else setTranslation(t.id);
                      }}
                    />
                  );
                })}
              </View>
            ))}
            <Notice text="Unavailable translations are shown so you know what exists. We never substitute a different edition without telling you." />
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

function CompareView({ pos, base, others, onPick }) {
  const cols = [base, ...others.filter((o) => o !== base)];
  const texts = cols.map((c) => ({ id: c, verses: getChapter(c, pos.bookId, pos.chapter) }));
  const max = Math.max(...texts.map((t) => (t.verses ? t.verses.length : 0)));
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={styles.compareHead}>{cols.join('  ·  ')}</Text>
        <Pressable onPress={onPick}><Text style={{ color: colors.accent, fontSize: 11 }}>Columns</Text></Pressable>
      </View>
      {Array.from({ length: max }, (_, i) => (
        <View key={i} style={styles.compareRow}>
          <Text style={styles.vnum}>{i + 1}</Text>
          {texts.map((t) => (
            <View key={t.id} style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.compareTr}>{t.id}</Text>
              <Text style={styles.compareText}>{t.verses && t.verses[i] ? t.verses[i] : '—'}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

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
    <Screen back title="Study" subtitle={refLabel(params.bookId, params.chapter, params.verse)}>
      {verse ? <Text style={styles.studyVerse}>{verse}</Text> : null}
      <Pills items={['Commentary', 'Cross-references', 'Word study', 'Context']} value={tab} onChange={setTab} style={{ marginTop: 12 }} />
      {tab === 'Commentary' ? (
        (COMMENTARY[key] || []).length ? (COMMENTARY[key] || []).map((c, i) => (
          <View key={i} style={styles.comm}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><Tag label={c.tradition} /><Tag label="Commentary, not Scripture" tint={colors.amber} /></View>
            <Text style={styles.commText}>{c.text}</Text>
            <Text style={styles.commSrc}>{c.source}</Text>
            <Button small kind="ghost" label="Save to library" style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => dispatch({ type: 'saveAnswer', a: { question: 'Commentary on ' + refLabel(params.bookId, params.chapter), blocks: [{ type: 'Commentary', source: c.source, text: c.text }] } })} />
          </View>
        )) : <Empty title="No commentary loaded" body="Licensed commentary for this chapter will appear here once connected." />
      ) : null}
      {tab === 'Cross-references' ? (
        (CROSS_REFS[key] || []).map((x, i) => <Row key={i} title={x.ref} subtitle={x.why} right="›" onPress={() => {}} />)
      ) : null}
      {tab === 'Word study' ? (
        <View>
          <Notice tint={colors.teal} text="Dictionary meanings are listed as a range. The contextual note says which sense this passage supports. Not every meaning applies to every occurrence." />
          {words.map((w) => { const d = WORD_STUDY[w]; return (
            <View key={w} style={styles.comm}>
              <Text style={styles.wordHead}>{d.original}  <Text style={{ color: colors.muted, fontSize: 12 }}>{d.translit} · {d.lang} · {d.strongs}</Text></Text>
              <Text style={styles.commText}>Lemma: {d.lemma}{'\n'}Range: {d.meaning}{'\n'}Grammar: {d.grammar}</Text>
              <Text style={[styles.commText, { color: colors.teal }]}>In this context: {d.contextNote}</Text>
            </View>
          ); })}
          {!words.length ? <Empty title="No word data for this verse" body="Lexicon entries exist for a sample of words in this edition." /> : null}
          <Row title="Latin (Vulgate) study" subtitle="Separate from Hebrew, Aramaic and Greek original-language study." right="Unlicensed" />
        </View>
      ) : null}
      {tab === 'Context' ? (
        <View>
          <Row title="Book introduction" subtitle={`${bookName(params.bookId)} · authorship, date, audience, outline`} right="›" />
          <Row title="Historical background" subtitle="People, places, customs behind this chapter" right="›" />
          <Row title="Factbook" subtitle="Typed pages for people, places and concepts in this chapter" right="›" onPress={() => nav.push('Factbook', { bookId: params.bookId, chapter: params.chapter })} />
          <Row title="Maps and timelines" subtitle="Where licensed" right="›" />
        </View>
      ) : null}
      <Button label="Ask Bible Chat about this" onPress={() => nav.push('BibleChat', { context: params })} style={{ marginTop: 20 }} />
    </Screen>
  );
}

// ---------- Factbook ----------
export function FactbookScreen({ params }) {
  const entries = {
    'MAT:1': [{ type: 'Person', name: 'Abraham', text: 'Patriarch to whom the promise of blessing for all nations was made (Genesis 12, 22).' }, { type: 'Person', name: 'Tamar', text: 'Daughter-in-law of Judah; mother of Perez (Genesis 38).' }, { type: 'Person', name: 'Rahab', text: 'Woman of Jericho who hid the Israelite spies (Joshua 2).' }, { type: 'Event', name: 'Babylonian exile', text: 'Deportation of Judah to Babylon, 597–586 BC.' }, { type: 'Concept', name: 'Emmanuel', text: '"God with us", from Isaiah 7:14.' }],
    'JHN:3': [{ type: 'Person', name: 'Nicodemus', text: 'Pharisee and member of the Sanhedrin; later helps bury Jesus (John 19).' }, { type: 'Event', name: 'Bronze serpent', text: 'Numbers 21: Moses lifts up a serpent so the people may live.' }],
    'PSA:23': [{ type: 'Person', name: 'David', text: 'Shepherd, king of Israel, psalmist.' }, { type: 'Concept', name: 'Shepherd', text: 'Common ancient Near Eastern image for a king.' }],
  };
  const list = entries[`${params.bookId}:${params.chapter}`] || [];
  return (
    <Screen back title="Factbook" subtitle={refLabel(params.bookId, params.chapter)}>
      <Notice tint={colors.teal} text="Each page separates biblical text, historical evidence, commentary and interpretation." />
      {list.map((e) => <Row key={e.name} title={e.name} subtitle={e.text} left={<Text style={{ fontSize: 9, color: colors.muted }}>{e.type.slice(0, 3).toUpperCase()}</Text>} right="›" />)}
      {!list.length ? <Empty title="No Factbook pages yet" /> : null}
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
    const pool = kind === 'People' ? require('../data/seed').PEOPLE.map((p) => ({ title: p.name, sub: p.headline, go: () => nav.push('Person', { id: p.id }) }))
      : kind === 'Communities' ? state.communities.map((c) => ({ title: c.name, sub: c.description, go: () => nav.push('Group', { id: c.id }) }))
      : state.feed.map((f) => ({ title: f.author + ' · ' + f.kind, sub: f.text, go: () => nav.push('Feed') }));
    return pool.filter((p) => (p.title + ' ' + p.sub).toLowerCase().includes(t));
  }, [q, kind]);

  return (
    <Screen back title="Search">
      <Input placeholder="Word, phrase, or reference (e.g. John 3:16)" value={q} onChangeText={setQ} autoFocus returnKeyType="search" onSubmitEditing={() => q && dispatch({ type: 'saveSearch', q })} />
      <Pills items={['Bible', 'People', 'Communities', 'Posts']} value={kind} onChange={setKind} style={{ marginTop: 10 }} />
      {kind === 'Bible' ? <Pills small items={['ALL', 'OT', 'NT']} value={scope} onChange={setScope} /> : null}
      {parsed ? <Row title={`Open ${refLabel(parsed.bookId, parsed.chapter, parsed.verse)}`} subtitle="Reference detected" tint={colors.teal} right="›" onPress={() => nav.push('Bible', parsed)} /> : null}
      {!q ? (
        <Section title="Saved searches">
          {state.savedSearches.map((s) => <Row key={s} title={s} right="›" onPress={() => setQ(s)} />)}
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 12 }}>Try: faith, grace, love, wisdom, forgiveness, peace</Text>
        </Section>
      ) : kind === 'Bible' ? (
        <Section title={`${results.length} result${results.length === 1 ? '' : 's'} · ${state.translation}`}>
          {results.map((r, i) => (
            <Row key={i} title={refLabel(r.bookId, r.chapter, r.verse)} subtitle={r.text} right={<Tag label={r.exact ? 'Exact' : 'Related'} tint={r.exact ? colors.teal : undefined} />} onPress={() => nav.push('Bible', { bookId: r.bookId, chapter: r.chapter, verse: r.verse })} />
          ))}
          {!results.length ? <Empty title="No matches in downloaded chapters" body="Only offline chapters are searched right now. Connect to search the full translation." action="Retry" onAction={() => setQ(q + '')} /> : null}
          {WORD_STUDY[q.toLowerCase()] ? <Row title={`Word study: ${q}`} subtitle={`${WORD_STUDY[q.toLowerCase()].original} · ${WORD_STUDY[q.toLowerCase()].translit}`} tint={colors.lavender} right="›" onPress={() => nav.push('Study', { bookId: 'JHN', chapter: 3, tab: 'Word study' })} /> : null}
        </Section>
      ) : (
        <Section title={`${other.length} result${other.length === 1 ? '' : 's'}`}>
          {other.map((o, i) => <Row key={i} title={o.title} subtitle={o.sub} right="›" onPress={o.go} />)}
          {!other.length ? <Empty title="Nothing found" body="Private items never appear in search." /> : null}
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
    <Screen back title="Library" subtitle={sync.status === 'saved' ? 'Saved' + (sync.at ? ' · ' + sync.at.toLocaleTimeString() : '') : sync.status}>
      <Pills items={['Continue', 'Notes', 'Highlights', 'Bookmarks', 'Saved answers', 'Recordings']} value={tab} onChange={setTab} />
      {tab === 'Continue' ? (
        <View>
          {state.recent.map((r) => <Row key={r.bookId + r.chapter} title={CHAPTER_TITLES[`${r.bookId}:${r.chapter}`] || refLabel(r.bookId, r.chapter)} subtitle={refLabel(r.bookId, r.chapter)} right="›" onPress={() => nav.push('Bible', r)} />)}
          {state.plans.map((p) => <Row key={p.id} title={p.name} subtitle={`Day ${p.done} of ${p.days}`} right="›" onPress={() => nav.push('Plan', { id: p.id })} />)}
        </View>
      ) : null}
      {tab === 'Notes' ? (state.notes.length ? state.notes.map((n) => <Row key={n.id} title={refLabel(n.bookId, n.chapter, n.verse)} subtitle={n.text} right={<Pressable onPress={() => dispatch({ type: 'deleteNote', id: n.id })}><Text style={{ color: colors.muted }}>Delete</Text></Pressable>} onPress={() => nav.push('Bible', n)} />) : <Empty title="No notes yet" body="Tap a verse in the reader and choose Note." />) : null}
      {tab === 'Highlights' ? state.highlights.map((h) => <Row key={h.id} title={refLabel(h.bookId, h.chapter, h.verse)} subtitle={`${h.label} · ${h.when}`} left={<View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: h.color }} />} right="›" onPress={() => nav.push('Bible', h)} />) : null}
      {tab === 'Bookmarks' ? state.bookmarks.map((b) => <Row key={b.id} title={refLabel(b.bookId, b.chapter, b.verse)} subtitle={`${b.folder} · ${b.when}`} right="›" onPress={() => nav.push('Bible', b)} />) : null}
      {tab === 'Saved answers' ? (state.savedAnswers.length ? state.savedAnswers.map((a) => <Row key={a.id} title={a.question} subtitle={a.blocks.map((b) => b.text || b.ref).join(' ').slice(0, 120)} />) : <Empty title="No saved answers" body="Save an answer from Bible Chat or Scripture Companion." />) : null}
      {tab === 'Recordings' ? state.recordings.map((r) => <Row key={r.id} title={r.title} subtitle={`${r.duration} · ${r.status} · ${r.privacy}`} right="›" onPress={() => nav.push('SermonStudio')} />) : null}
      <Divider />
      <Row title="Export my data" subtitle="Notes, highlights, bookmarks, plans (JSON)" right="›" />
      <Row title="Recently deleted" subtitle="Recover items for 30 days" right="›" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  trBtn: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.tabLine },
  tool: { fontSize: 10.5, color: colors.muted },
  eyebrow: { fontSize: 8.5, letterSpacing: 2, color: colors.muted, textAlign: 'center', marginTop: 18, marginBottom: 8 },
  chTitle: { fontSize: 16, fontWeight: '600', color: colors.fg, textAlign: 'center', marginBottom: 14 },
  verse: { paddingVertical: 4, borderRadius: 8, marginHorizontal: -6, paddingHorizontal: 6 },
  verseSel: { backgroundColor: colors.cardTop },
  verseText: { color: colors.passage },
  vnum: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  pager: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  copyright: { fontSize: 9.5, color: colors.muted, textAlign: 'center', marginTop: 16 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.sheet, borderTopWidth: 1, borderColor: colors.line, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 14 },
  sheetRef: { fontSize: 13, fontWeight: '600', color: colors.fg },
  colors: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  swatch: { width: 22, height: 22, borderRadius: 11 },
  swatchOn: { borderWidth: 2, borderColor: '#fff' },
  sheetAct: { fontSize: 11.5, color: colors.fg },
  modal: { flex: 1, backgroundColor: colors.screen, marginTop: 60, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: colors.line },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', padding: 18, paddingBottom: 6 },
  modalTitle: { fontSize: 15, fontWeight: '600', color: colors.fg },
  modalSub: { fontSize: 10, letterSpacing: 1.5, color: colors.muted, marginBottom: 6 },
  testament: { fontSize: 11, color: colors.muted, marginTop: 14, marginBottom: 8 },
  bookGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compareHead: { fontSize: 11, color: colors.muted },
  compareRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.tabLine },
  compareTr: { fontSize: 9, color: colors.teal, fontWeight: '600', marginBottom: 3 },
  compareText: { fontSize: 12.5, lineHeight: 18, color: colors.passage },
  studyVerse: { fontSize: 14, lineHeight: 21, color: colors.fg, marginTop: 8 },
  comm: { backgroundColor: colors.cardBottom, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginTop: 12 },
  commText: { fontSize: 12.5, lineHeight: 18, color: colors.passage, marginTop: 8 },
  commSrc: { fontSize: 10, color: colors.muted, marginTop: 8 },
  wordHead: { fontSize: 18, color: colors.fg },
});
