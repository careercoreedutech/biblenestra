import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Row, Pill, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider } from '../components/ui';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
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
  availableChapters,
  bookName,
} from '../data/bible';

const HIGHLIGHT_COLORS = [colors.gold, colors.teal, colors.lavender, colors.amber, colors.rose];

export default function BibleScreen({ params = {} }) {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const [pos, setPos] = useState({
    bookId: params.bookId || state.lastPosition.bookId,
    chapter: params.chapter || state.lastPosition.chapter,
  });
  const [selected, setSelected] = useState(params.verse || null);
  const [picker, setPicker] = useState(null); // 'book' | 'translation' | 'compare' | null
  const [panel, setPanel] = useState(null); // 'note' | null
  const [noteText, setNoteText] = useState('');
  const [compare, setCompare] = useState(false);
  const [audio, setAudio] = useState(false);
  const tr = state.translation;
  const key = `${pos.bookId}:${pos.chapter}`;
  const verses = getChapter(tr, pos.bookId, pos.chapter);
  const title = CHAPTER_TITLES[key];
  const book = BOOKS.find((b) => b.id === pos.bookId);

  useEffect(() => {
    dispatch({ type: 'position', pos });
  }, [pos.bookId, pos.chapter]);

  const hl = (v) =>
    state.highlights.find((h) => h.bookId === pos.bookId && h.chapter === pos.chapter && h.verse === v);
  const noteFor = (v) =>
    state.notes.filter((n) => n.bookId === pos.bookId && n.chapter === pos.chapter && n.verse === v);
  const bookmarked = state.bookmarks.some((b) => b.bookId === pos.bookId && b.chapter === pos.chapter && !b.verse);

  const go = (delta) => {
    const chs = availableChapters();
    const idx = chs.findIndex((c) => c.bookId === pos.bookId && c.chapter === pos.chapter);
    const next = chs[idx + delta];
    if (next) {
      setPos({ bookId: next.bookId, chapter: next.chapter });
      setSelected(null);
    }
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
    dispatch({
      type: 'post',
      post: {
        kind: 'Verse',
        text: `"${verses[selected - 1]}" — ${refLabel(pos.bookId, pos.chapter, selected)} (${tr}, ${t.publisher})`,
      },
    });
    nav.push('Feed');
  };

  return (
    <Screen
      scroll={false}
      padded={false}
      title={`${bookName(pos.bookId)} ${pos.chapter}`}
      subtitle={`${tr} · ${title || 'Scripture'}`}
      menu={() => setPicker('book')}
      right={
        <Pressable onPress={() => setPicker('translation')} hitSlop={12} style={styles.trBadge}>
          <Text style={styles.trBadgeText}>{tr}</Text>
        </Pressable>
      }
    >
      {/* Reader Quick-Toolbar */}
      <View style={styles.toolbar}>
        <Pressable onPress={() => setPicker('book')} style={styles.toolBtn}>
          <Text style={styles.toolText}>Books ▾</Text>
        </Pressable>
        <Pressable onPress={() => nav.push('Search')} style={styles.toolBtn}>
          <Text style={styles.toolText}>Search</Text>
        </Pressable>
        <Pressable onPress={() => nav.push('Concordance')} style={styles.toolBtn}>
          <Text style={[styles.toolText, { color: colors.gold }]}>Lexicon ✦</Text>
        </Pressable>
        <Pressable onPress={() => setCompare(!compare)} style={[styles.toolBtn, compare && styles.toolBtnActive]}>
          <Text style={[styles.toolText, compare && { color: colors.gold }]}>Compare</Text>
        </Pressable>
        <Pressable
          onPress={() => dispatch({ type: 'bookmark', b: { bookId: pos.bookId, chapter: pos.chapter } })}
          style={styles.toolBtn}
        >
          <Text style={[styles.toolText, bookmarked && { color: colors.gold }]}>
            {bookmarked ? 'Saved' : 'Save'}
          </Text>
        </Pressable>
        <Pressable onPress={() => nav.push('Library')} style={styles.toolBtn}>
          <Text style={styles.toolText}>Library</Text>
        </Pressable>
      </View>

      {/* Reader ScrollView */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: selected ? 190 : 100 }}
        showsVerticalScrollIndicator={false}
      >
        {audio ? (
          <Notice tint={colors.teal} text={`Streaming audio narration for ${refLabel(pos.bookId, pos.chapter)} (${tr}).`} />
        ) : null}

        {/* Chapter Header */}
        <View style={styles.chapterHead}>
          <Text style={styles.eyebrow}>THE BOOK OF {bookName(pos.bookId).toUpperCase()}</Text>
          <Text style={styles.chapterLargeNumber}>Chapter {pos.chapter}</Text>
          {title ? <Text style={styles.chTitle}>{title}</Text> : null}
          <View style={styles.goldDivider} />
        </View>

        {!verses ? (
          <Empty
            title="Download Chapter"
            body={`${refLabel(pos.bookId, pos.chapter)} is currently not cached offline in ${tr}.`}
            action="Browse Available Offline Chapters"
            onAction={() => setPicker('book')}
          />
        ) : compare ? (
          <CompareView pos={pos} base={tr} others={state.compareWith} onPick={() => setPicker('compare')} />
        ) : (
          verses.map((v, i) => {
            const n = i + 1;
            const h = hl(n);
            const notes = noteFor(n);
            const isSel = selected === n;

            return (
              <Pressable
                key={n}
                onPress={() => {
                  setSelected(isSel ? null : n);
                  setPanel(null);
                }}
                style={[
                  styles.verseRow,
                  isSel && styles.verseSel,
                  h && { backgroundColor: h.color + '18' },
                ]}
              >
                <Text style={[styles.verseText, { fontSize: state.fontSize, lineHeight: state.fontSize * 1.62 }]}>
                  <Text style={[styles.vnum, isSel && { color: colors.gold }]}>{n}  </Text>
                  <Text style={h ? { color: colors.fg, borderBottomWidth: 1, borderBottomColor: h.color } : null}>
                    {v}
                  </Text>
                  {notes.length ? <Text style={{ color: colors.amber }}> ✎</Text> : null}
                </Text>
              </Pressable>
            );
          })
        )}

        {/* Previous / Next Chapter Ergonomic Floating Buttons */}
        <View style={styles.pager}>
          <Pressable onPress={() => go(-1)} style={styles.pagerBtn}>
            <Text style={styles.pagerBtnText}>‹ Previous Chapter</Text>
          </Pressable>
          <Pressable onPress={() => go(1)} style={styles.pagerBtn}>
            <Text style={styles.pagerBtnText}>Next Chapter ›</Text>
          </Pressable>
        </View>

        <Text style={styles.copyright}>
          {TRANSLATIONS.find((t) => t.id === tr)?.name} · {TRANSLATIONS.find((t) => t.id === tr)?.publisher}
        </Text>
      </ScrollView>

      {/* Floating Verse Action Sheet */}
      {selected && verses ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetVerseBadge}>
              <Text style={styles.sheetVerseBadgeText}>VERSE {selected}</Text>
            </View>
            <Text style={styles.sheetRef}>{refLabel(pos.bookId, pos.chapter, selected)}</Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={12} style={styles.sheetCloseBtn}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>✕</Text>
            </Pressable>
          </View>

          {/* Color Highlighting Circles */}
          <View style={styles.colorPalette}>
            {HIGHLIGHT_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() =>
                  dispatch({
                    type: 'highlight',
                    h: { bookId: pos.bookId, chapter: pos.chapter, verse: selected, color: c, label: 'Highlight' },
                  })
                }
                style={[styles.colorDot, { backgroundColor: c }, hl(selected)?.color === c && styles.colorDotActive]}
              />
            ))}
            <View style={styles.vDivider} />
            <Pressable onPress={() => setPanel(panel === 'note' ? null : 'note')} style={styles.actionChip}>
              <Text style={styles.actionChipText}>Note</Text>
            </Pressable>
            <Pressable
              onPress={() => dispatch({ type: 'bookmark', b: { bookId: pos.bookId, chapter: pos.chapter, verse: selected } })}
              style={styles.actionChip}
            >
              <Text style={styles.actionChipText}>Save</Text>
            </Pressable>
            <Pressable onPress={share} style={styles.actionChip}>
              <Text style={styles.actionChipText}>Share</Text>
            </Pressable>
          </View>

          {panel === 'note' ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Input
                placeholder="Write a private reflection or study note..."
                value={noteText}
                onChangeText={setNoteText}
                multiline
                style={{ minHeight: 65 }}
              />
              <Button
                small
                label="Save note"
                onPress={() => {
                  if (noteText.trim()) {
                    dispatch({
                      type: 'note',
                      n: { bookId: pos.bookId, chapter: pos.chapter, verse: selected, text: noteText.trim() },
                    });
                    setNoteText('');
                    setPanel(null);
                  }
                }}
              />
            </View>
          ) : null}

          {/* Contextual Action Pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 12 }}>
            <Pill small label="Concordance" onPress={() => nav.push('Concordance')} />
            <Pill small label="Exegesis" onPress={() => nav.push('BibleChat', { context: { ...pos, verse: selected } })} />
            <Pill small label="Commentary" onPress={() => nav.push('Study', { ...pos, verse: selected, tab: 'Commentary' })} />
            <Pill small label="Cross-refs" onPress={() => nav.push('Study', { ...pos, verse: selected, tab: 'Cross-references' })} />
            <Pill small label="Word study" onPress={() => nav.push('Study', { ...pos, verse: selected, tab: 'Word study' })} />
            <Pill small label="Intercede" onPress={() => nav.push('NewPrayer', { verse: refLabel(pos.bookId, pos.chapter, selected) })} />
            <Pill small label="Memorize" onPress={() => nav.push('Learn', { tab: 'Memorize' })} />
          </ScrollView>
        </View>
      ) : null}

      {/* Book / Chapter Picker Modal */}
      <Modal visible={picker === 'book'} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Choose Book & Chapter</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={12} style={styles.modalClose}>
                <Text style={{ color: colors.fg, fontWeight: '700' }}>Done</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 50 }}>
              <Text style={styles.modalSub}>AVAILABLE IN YOUR TRANSLATION ({tr})</Text>
              {availableChapters().map((c) => (
                <Row
                  key={c.bookId + c.chapter}
                  title={c.title}
                  subtitle={refLabel(c.bookId, c.chapter)}
                  onPress={() => {
                    setPos({ bookId: c.bookId, chapter: c.chapter });
                    setSelected(null);
                    setPicker(null);
                  }}
                />
              ))}

              <Text style={[styles.modalSub, { marginTop: 24 }]}>ALL BIBLICAL CANON</Text>
              {['OT', 'NT'].map((t) => (
                <View key={t} style={{ marginTop: 10 }}>
                  <Text style={styles.testamentLabel}>{t === 'OT' ? 'Old Testament' : 'New Testament'}</Text>
                  <View style={styles.bookGrid}>
                    {BOOKS.filter((b) => b.testament === t).map((b) => (
                      <Pill
                        key={b.id}
                        small
                        label={b.name}
                        active={b.id === pos.bookId}
                        onPress={() => {
                          setPos({ bookId: b.id, chapter: 1 });
                          setSelected(null);
                          setPicker(null);
                        }}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Translation Picker Modal */}
      <Modal visible={picker === 'translation' || picker === 'compare'} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{picker === 'compare' ? 'Compare Translations' : 'Select Translation'}</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={12} style={styles.modalClose}>
                <Text style={{ color: colors.fg, fontWeight: '700' }}>Done</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 50 }}>
              {Array.from(new Set(TRANSLATIONS.map((t) => t.lang))).map((lang) => (
                <View key={lang} style={{ marginTop: 12 }}>
                  <Text style={styles.testamentLabel}>{lang}</Text>
                  {TRANSLATIONS.filter((t) => t.lang === lang).map((t) => {
                    const inCompare = state.compareWith.includes(t.id);
                    return (
                      <Row
                        key={t.id}
                        title={`${t.id} · ${t.name}`}
                        subtitle={t.available ? `${t.publisher}${t.offline ? ' · Offline Available' : ''}` : `Requires license · ${t.publisher}`}
                        tint={t.available ? undefined : colors.muted}
                        right={
                          picker === 'compare' ? (
                            t.available ? (
                              <Badge label={inCompare ? 'Added' : 'Add'} tint={inCompare ? colors.teal : colors.muted} />
                            ) : (
                              <Tag label="Unavailable" />
                            )
                          ) : t.id === tr ? (
                            <Badge label="Active" tint={colors.gold} />
                          ) : t.available ? null : (
                            <Tag label="Unavailable" />
                          )
                        }
                        onPress={() => {
                          if (!t.available) return;
                          if (picker === 'compare') {
                            dispatch({
                              type: 'set',
                              patch: {
                                compareWith: inCompare
                                  ? state.compareWith.filter((x) => x !== t.id)
                                  : [...state.compareWith, t.id],
                              },
                            });
                          } else {
                            setTranslation(t.id);
                          }
                        }}
                      />
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
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
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={styles.compareHead}>{cols.join('  ·  ')}</Text>
        <Pressable onPress={onPick} style={styles.colPickerBtn}>
          <Text style={{ color: colors.gold, fontFamily: fonts.sansMedium, fontSize: 11.5 }}>Configure Columns ›</Text>
        </Pressable>
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

// Keep StudyScreen, FactbookScreen, SearchScreen, LibraryScreen exports compatible
export { StudyScreen, FactbookScreen, SearchScreen, LibraryScreen } from './BibleScreen_helpers';

const styles = StyleSheet.create({
  trBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(229, 184, 105, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.3)',
  },
  trBadgeText: {
    fontFamily: fonts.sansMedium,
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toolBtnActive: {
    backgroundColor: colors.raised,
  },
  toolText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.muted,
  },
  chapterHead: {
    alignItems: 'center',
    marginBottom: 20,
  },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    letterSpacing: 2,
    color: colors.gold,
  },
  chapterLargeNumber: {
    fontFamily: fonts.serifBold,
    fontSize: 26,
    color: colors.fg,
    marginTop: 4,
  },
  chTitle: {
    fontFamily: fonts.serif,
    fontSize: 14,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
  },
  goldDivider: {
    width: 32,
    height: 1.5,
    backgroundColor: 'rgba(229, 184, 105, 0.4)',
    marginTop: 14,
    borderRadius: 1,
  },
  verseRow: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginVertical: 1,
  },
  verseSel: {
    backgroundColor: 'rgba(229, 184, 105, 0.15)',
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
  },
  verseText: {
    fontFamily: fonts.serif,
    color: colors.passage,
  },
  vnum: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.muted,
    fontWeight: '700',
  },
  pager: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 36,
  },
  pagerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  pagerBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.fg,
  },
  copyright: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 20,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetVerseBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(229, 184, 105, 0.15)',
  },
  sheetVerseBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    color: colors.gold,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sheetRef: {
    fontFamily: fonts.serifBold,
    fontSize: 14,
    color: colors.fg,
  },
  sheetCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorPalette: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  colorDotActive: {
    borderWidth: 2,
    borderColor: '#fff',
    transform: [{ scale: 1.15 }],
  },
  vDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.line,
    marginHorizontal: 4,
  },
  actionChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  actionChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.fg,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#161210',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.glossBorderTop,
    maxHeight: '85%',
  },
  modalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  modalTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 16,
    color: colors.fg,
  },
  modalClose: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalSub: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.gold,
    marginBottom: 8,
  },
  testamentLabel: {
    fontFamily: fonts.serifBold,
    fontSize: 13,
    color: colors.fg,
    marginBottom: 8,
  },
  bookGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compareHead: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.muted,
  },
  colPickerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  compareRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  compareTr: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    color: colors.teal,
    fontWeight: '700',
    marginBottom: 3,
  },
  compareText: {
    fontFamily: fonts.serif,
    fontSize: 13,
    lineHeight: 19,
    color: colors.passage,
  },
});
