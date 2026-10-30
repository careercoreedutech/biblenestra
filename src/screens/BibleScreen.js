import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Row, Pill, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider } from '../components/ui';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import { Icon } from '../components/Icons';
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
    const curBook = BOOKS.find((b) => b.id === pos.bookId);
    if (!curBook) return;
    const nextChapter = pos.chapter + delta;
    if (nextChapter >= 1 && nextChapter <= curBook.chapters) {
      setPos({ bookId: pos.bookId, chapter: nextChapter });
      setSelected(null);
    } else if (nextChapter < 1) {
      const bookIdx = BOOKS.findIndex((b) => b.id === pos.bookId);
      if (bookIdx > 0) {
        const prevBook = BOOKS[bookIdx - 1];
        setPos({ bookId: prevBook.id, chapter: prevBook.chapters });
        setSelected(null);
      }
    } else if (nextChapter > curBook.chapters) {
      const bookIdx = BOOKS.findIndex((b) => b.id === pos.bookId);
      if (bookIdx < BOOKS.length - 1) {
        const nextBook = BOOKS[bookIdx + 1];
        setPos({ bookId: nextBook.id, chapter: 1 });
        setSelected(null);
      }
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
      title={`${bookName(pos.bookId)} ${pos.chapter} ▾`}
      subtitle={`${tr} · ${title || 'Scripture'}`}
      menu={() => setPicker('book')}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setAudio(!audio)} hitSlop={10} style={[styles.trBadge, audio && styles.trBadgeActive]}>
            <Icon name="volume" size={14} color={audio ? '#FFFFFF' : colors.forest} />
            <Text style={[styles.trBadgeText, audio && { color: '#FFFFFF' }]}>{audio ? 'Pause' : 'Audio'}</Text>
          </Pressable>
          <Pressable onPress={() => setPicker('translation')} hitSlop={12} style={styles.trBadge}>
            <Text style={styles.trBadgeText}>{tr}</Text>
          </Pressable>
        </View>
      }
    >
      {/* Reader Quick-Toolbar with Vector Icons */}
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          <Pressable onPress={() => setPicker('book')} style={styles.toolBtn}>
            <Icon name="book" size={13} color={colors.forest} />
            <Text style={[styles.toolText, { color: colors.forest }]}>Books</Text>
          </Pressable>
          <Pressable onPress={() => nav.push('Search')} style={styles.toolBtn}>
            <Icon name="search" size={13} color={colors.indigo} />
            <Text style={styles.toolText}>Search</Text>
          </Pressable>
          <Pressable onPress={() => nav.push('Concordance')} style={[styles.toolBtn, { borderColor: colors.goldLight + '60' }]}>
            <Icon name="sparkles" size={13} color={colors.gold} />
            <Text style={[styles.toolText, { color: colors.gold }]}>Lexicon</Text>
          </Pressable>
          <Pressable onPress={() => setCompare(!compare)} style={[styles.toolBtn, compare && styles.toolBtnActive]}>
            <Icon name="bible" size={13} color={compare ? '#FFFFFF' : colors.teal} />
            <Text style={[styles.toolText, compare && { color: '#FFFFFF' }]}>Compare</Text>
          </Pressable>
          <Pressable
            onPress={() => dispatch({ type: 'bookmark', b: { bookId: pos.bookId, chapter: pos.chapter } })}
            style={[styles.toolBtn, bookmarked && { borderColor: colors.rose + '60', backgroundColor: colors.roseFaint }]}
          >
            <Icon name="bookmark" size={13} color={bookmarked ? colors.rose : colors.muted} />
            <Text style={[styles.toolText, bookmarked && { color: colors.rose }]}>
              {bookmarked ? 'Saved' : 'Save'}
            </Text>
          </Pressable>
          <Pressable onPress={() => nav.push('Library')} style={styles.toolBtn}>
            <Icon name="briefcase" size={13} color={colors.lavender} />
            <Text style={styles.toolText}>Library</Text>
          </Pressable>
        </ScrollView>
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

        {/* Chapter Header (Vibrant Modern Editorial) */}
        <View style={styles.chapterHead}>
          <View style={styles.eyebrowPill}>
            <Text style={styles.eyebrowText}>{bookName(pos.bookId).toUpperCase()}</Text>
          </View>
          <Text style={styles.chapterLargeNumber}>Chapter {pos.chapter}</Text>
          {title ? <Text style={styles.chTitle}>{title}</Text> : null}
          <View style={styles.accentRule} />
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
                  h && { backgroundColor: h.color + '22' },
                ]}
              >
                <Text style={[styles.verseText, { fontSize: state.fontSize, lineHeight: state.fontSize * 1.68 }]}>
                  <Text style={[styles.vnum, n === 1 ? styles.vnumOne : null, isSel && { color: colors.gold }]}>{n}  </Text>
                  <Text style={h ? { color: colors.fg, borderBottomWidth: 1, borderBottomColor: h.color } : null}>
                    {v}
                  </Text>
                  {notes.length ? <Text style={{ color: colors.amber }}> •</Text> : null}
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
              {/* Current Book Chapters Fast Picker */}
              {book ? (
                <View style={{ marginBottom: 16 }}>
                  <Text style={styles.modalSub}>{`${book.name.toUpperCase()} CHAPTERS (${book.chapters})`}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
                    {Array.from({ length: book.chapters }, (_, i) => i + 1).map((ch) => {
                      const isSel = ch === pos.chapter;
                      return (
                        <Pressable
                          key={ch}
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: isSel ? colors.forest : colors.cardSage,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: isSel ? 0 : 1,
                            borderColor: 'rgba(30, 81, 40, 0.15)',
                          }}
                          onPress={() => {
                            setPos({ bookId: pos.bookId, chapter: ch });
                            setSelected(null);
                            setPicker(null);
                          }}
                        >
                          <Text style={{ color: isSel ? '#FFF' : colors.forest, fontWeight: '700', fontSize: 14 }}>{ch}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              <Text style={styles.modalSub}>ALL 66 BOOKS OF SCRIPTURE</Text>
              {['OT', 'NT'].map((t) => (
                <View key={t} style={{ marginTop: 14 }}>
                  <Text style={styles.testamentLabel}>{t === 'OT' ? 'Old Testament (39 Books)' : 'New Testament (27 Books)'}</Text>
                  <View style={styles.bookGrid}>
                    {BOOKS.filter((b) => b.testament === t).map((b) => {
                      const isSel = b.id === pos.bookId;
                      return (
                        <Pressable
                          key={b.id}
                          style={[styles.bookGridItem, isSel && styles.bookGridItemActive]}
                          onPress={() => {
                            setPos({ bookId: b.id, chapter: 1 });
                            setSelected(null);
                            setPicker(null);
                          }}
                        >
                          <Text style={[styles.bookGridName, isSel && styles.bookGridNameActive]}>{b.name}</Text>
                          <Text style={[styles.bookGridChCount, isSel && { color: '#D1FAE5' }]}>{b.chapters} ch</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}

              <Text style={[styles.modalSub, { marginTop: 24 }]}>FEATURED SCRIPTURE PASSAGES</Text>
              <View style={{ gap: 10, marginTop: 8 }}>
                {availableChapters().map((c) => {
                  const chTitle = CHAPTER_TITLES[`${c.bookId}:${c.chapter}`] || `${bookName(c.bookId)} Chapter ${c.chapter}`;
                  const isCurrent = c.bookId === pos.bookId && c.chapter === pos.chapter;
                  return (
                    <Pressable
                      key={c.bookId + c.chapter}
                      style={[styles.availChapterCard, isCurrent && styles.availChapterActive]}
                      onPress={() => {
                        setPos({ bookId: c.bookId, chapter: c.chapter });
                        setSelected(null);
                        setPicker(null);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={[styles.availChapterIcon, { backgroundColor: isCurrent ? colors.forest : colors.cardSage }]}>
                            <Icon name="book" size={14} color={colors.forest} />
                          </View>
                          <Text style={[styles.availChapterRef, isCurrent && { color: colors.forest, fontWeight: '700' }]}>
                            {refLabel(c.bookId, c.chapter)}
                          </Text>
                        </View>
                        {isCurrent ? <Badge label="Reading" tint={colors.forest} /> : null}
                      </View>
                      <Text style={styles.availChapterTitle} numberOfLines={1}>{chTitle}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  trBadgeActive: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  trBadgeText: {
    fontFamily: fonts.sansMedium,
    color: colors.forest,
    fontSize: 11,
    fontWeight: '700',
  },
  toolbar: {
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.screen,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolBtnActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  toolText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.fg,
    fontWeight: '600',
  },
  chapterHead: {
    alignItems: 'center',
    marginBottom: 22,
    marginTop: 6,
  },
  eyebrowPill: {
    backgroundColor: colors.cardGold,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.gold + '40',
    marginBottom: 6,
  },
  eyebrowText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    letterSpacing: 1.5,
    color: colors.gold,
    fontWeight: '700',
  },
  chapterLargeNumber: {
    fontFamily: fonts.serifBold,
    fontSize: 30,
    color: colors.fg,
    marginTop: 2,
  },
  chTitle: {
    fontFamily: fonts.serif,
    fontSize: 15,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
  },
  accentRule: {
    width: 48,
    height: 3,
    backgroundColor: colors.forest,
    marginTop: 14,
    borderRadius: 1.5,
  },
  vnumOne: {
    color: colors.forest,
    fontWeight: '700',
    fontSize: 15,
  },
  verseRow: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginVertical: 1,
  },
  verseSel: {
    backgroundColor: colors.cardGold,
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
    color: colors.gold,
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
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  pagerBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.fg,
    fontWeight: '600',
  },
  copyright: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 24,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetVerseBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.cardGold,
    borderWidth: 1,
    borderColor: colors.gold,
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
    fontSize: 14.5,
    color: colors.fg,
  },
  sheetCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.raised,
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
    borderColor: colors.forest,
    transform: [{ scale: 1.15 }],
  },
  vDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.fg,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 25, 23, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '85%',
  },
  modalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 16.5,
    color: colors.fg,
  },
  modalClose: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.raised,
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
    fontSize: 13.5,
    color: colors.fg,
    marginBottom: 8,
  },
  bookGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  availChapterCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  availChapterActive: {
    borderColor: colors.forest,
    backgroundColor: colors.cardSage,
  },
  availChapterIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  availChapterRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '700',
    color: colors.fg,
  },
  availChapterTitle: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
    marginLeft: 34,
  },
  bookGridItem: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    minWidth: 70,
  },
  bookGridItemActive: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  bookGridName: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.fg,
    fontWeight: '600',
  },
  bookGridNameActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  bookGridChCount: {
    fontFamily: fonts.sans,
    fontSize: 9.5,
    color: colors.muted,
    marginTop: 1,
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
    borderBottomColor: colors.rule,
  },
  compareTr: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    color: colors.forest,
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
