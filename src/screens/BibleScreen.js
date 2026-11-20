import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, PanResponder, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { AnimatedModal, Pop, ScaleIn, PressScale, Pulse } from '../components/Motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Row, Pill, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider, alpha, NightGlow } from '../components/ui';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import VerseImageSheet from '../components/VerseImageSheet';
import { useToast } from '../components/Toast';
import ProfileButton from '../components/ProfileButton';
import TranslationPicker from '../components/TranslationPicker';
import { BannerSlot } from '../ads/AdSlots';
import BookChapterPicker from '../components/BookChapterPicker';
import { useChapter, useChapters, prefetchChapter } from '../bible/loader';
import { translationInfo, resolveTranslationId } from '../bible/catalog';
import { useNarration } from '../audio/Narration';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow, readerThemes, lineSpacings, READER_FONTS, readerFontFamily } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import * as Clipboard from 'expo-clipboard';
import { setBibleImmersive, useBibleImmersive } from '../ui/chrome';
import { CopyGlyph } from './ExegesisScreen';
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

const HIGHLIGHT_COLORS = ['#E2B547', '#7FB59A', '#8FA7DA', '#C79BD8', '#E79A9A'];

export default function BibleScreen({ params: routeParams }) {
  const params = routeParams || {};
  const isRoute = routeParams !== undefined;
  const { state, dispatch } = useStore();
  const nav = useNav();
  const [pos, setPos] = useState({
    bookId: params.bookId || state.lastPosition.bookId,
    chapter: params.chapter || state.lastPosition.chapter,
  });
  // Selected verses (sorted). `selected` = the first one, `selEnd` = the last one.
  const [sel, setSel] = useState(params.verse ? [params.verse] : []);
  const selected = sel.length ? sel[0] : null;
  const selEnd = sel.length ? sel[sel.length - 1] : null;
  const setSelected = (v) => setSel(v ? [v] : []);
  const toggleVerse = (n) => setSel((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b)));
  const [picker, setPicker] = useState(null); // 'book' | 'translation' | 'compare' | 'settings' | 'tools' | null
  const [panel, setPanel] = useState(null); // 'note' | null
  const [studyOpen, setStudyOpen] = useState(false); // verse toolbar: study tools expanded
  const insets = useSafeAreaInsets();
  // Android Back closes the verse sheet (it's drawn over the page, not a Modal) instead of leaving the app
  useEffect(() => {
    if (!selected) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSel([]); return true; });
    return () => sub.remove();
  }, [selected]);
  useEffect(() => { if (!sel.length) { setStudyOpen(false); setPanel(null); } }, [sel.length]);

  // ---- Full-screen reading (Bible tab only): the tab bar slides away; a small arrow handle brings it back,
  // and it hides again after a few seconds or as soon as the text scrolls.
  const navHidden = useBibleImmersive();
  const hideTimer = useRef(null);
  useEffect(() => {
    if (isRoute) return undefined;
    setBibleImmersive(true);
    return () => { clearTimeout(hideTimer.current); setBibleImmersive(false); };
  }, [isRoute]);
  const hideNav = () => { clearTimeout(hideTimer.current); if (!isRoute) setBibleImmersive(true); };
  const showNav = () => {
    clearTimeout(hideTimer.current);
    setBibleImmersive(false);
    hideTimer.current = setTimeout(() => setBibleImmersive(true), 4500);
  };
  useEffect(() => { if (sel.length) hideNav(); }, [sel.length]);
  const handleA = useRef(new Animated.Value(1)).current;
  const showHandle = !isRoute && navHidden && !sel.length;
  useEffect(() => {
    Animated.timing(handleA, { toValue: showHandle ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [showHandle]);

  // ---- Top bar hides while scrolling down the text and comes back when scrolling up (or near the top).
  const [headH, setHeadH] = useState(64);
  const headA = useRef(new Animated.Value(1)).current;
  const headShown = useRef(true);
  const lastY = useRef(0);
  const setHead = (show) => {
    if (headShown.current === show) return;
    headShown.current = show;
    Animated.timing(headA, { toValue: show ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  };
  const onReaderScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    if (y < 40) setHead(true);
    else if (dy > 6) setHead(false);
    else if (dy < -12) setHead(true);
    if (!navHidden && Math.abs(dy) > 2) hideNav();
  };
  const [noteText, setNoteText] = useState('');
  const [compare, setCompare] = useState(!!params.compare);
  const nar = useNarration();
  const toast = useToast();
  const scrollRef = useRef(null);
  const verseY = useRef({});
  const narHere = nar.active && nar.bookId === pos.bookId && nar.chapter === pos.chapter;
  const audio = narHere && nar.playing;
  const toggleNarration = () => {
    if (narHere) nar.toggle();
    else nar.playChapter(pos.bookId, pos.chapter, { translation: tr });
  };
  const [imageOpen, setImageOpen] = useState(false);
  const tr = resolveTranslationId(state.translation);
  const t = readerThemes[state.readerTheme] || readerThemes.paper;
  const spacing = lineSpacings[state.lineSpacing] || lineSpacings.Comfortable;
  const readerFont = state.readerFont || 'Newsreader';
  const verseFont = { fontFamily: readerFontFamily(readerFont) };
  const key = `${pos.bookId}:${pos.chapter}`;
  const chapterData = useChapter(tr, pos.bookId, pos.chapter);
  // While a translation streams in (or if we're offline) the reader keeps showing KJV.
  const verses = chapterData.verses || chapterData.fallback;
  const showingFallback = !chapterData.verses && !!chapterData.fallback;
  useEffect(() => {
    // Warm the next chapter so swiping forward is instant.
    const b = BOOKS.find((x) => x.id === pos.bookId);
    if (chapterData.verses && b && pos.chapter < b.chapters) prefetchChapter(tr, pos.bookId, pos.chapter + 1);
  }, [chapterData.verses, tr, pos.bookId, pos.chapter]);
  const title = CHAPTER_TITLES[key];
  const book = BOOKS.find((b) => b.id === pos.bookId);

  useEffect(() => {
    dispatch({ type: 'position', pos });
  }, [pos.bookId, pos.chapter]);

  const lastNar = useRef(null);
  useEffect(() => {
    // When narration moves on to the next chapter, follow it if we were reading along.
    const prev = lastNar.current;
    if (nar.active && nar.mode === 'chapter' && prev && prev.bookId === pos.bookId && prev.chapter === pos.chapter && (prev.bookId !== nar.bookId || prev.chapter !== nar.chapter)) {
      setPos({ bookId: nar.bookId, chapter: nar.chapter });
      setSelected(null);
      verseY.current = {};
    }
    lastNar.current = nar.active ? { bookId: nar.bookId, chapter: nar.chapter } : null;
  }, [nar.active, nar.bookId, nar.chapter]);

  useEffect(() => {
    if (!narHere || selected) return;
    const y = verseY.current[nar.verse];
    if (typeof y === 'number' && scrollRef.current) scrollRef.current.scrollTo({ y: Math.max(0, y - 160), animated: true });
  }, [narHere, nar.verse]);

  const hl = (v) =>
    state.highlights.find((h) => h.bookId === pos.bookId && h.chapter === pos.chapter && h.verse === v);
  const noteFor = (v) =>
    state.notes.filter((n) => n.bookId === pos.bookId && n.chapter === pos.chapter && n.verse === v);
  const verseSaved = !!selected && state.bookmarks.some((b) => b.bookId === pos.bookId && b.chapter === pos.chapter && b.verse === selected);
  const bookmarked = state.bookmarks.some((b) => b.bookId === pos.bookId && b.chapter === pos.chapter && !b.verse);

  // Page-turn animation: content slides in from the side you swiped/tapped toward.
  const dirRef = useRef(0);
  const enter = useRef(new Animated.Value(1)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const ND = Platform.OS !== 'web';
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
    if (scrollRef.current) scrollRef.current.scrollTo({ y: 0, animated: false });
  }, [pos.bookId, pos.chapter]);
  const goRef = useRef(null);
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 22 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,
    onPanResponderMove: (e, g) => drag.setValue(g.dx * 0.4),
    onPanResponderRelease: (e, g) => {
      if (g.dx < -80 || g.vx < -0.6) goRef.current && goRef.current(1);
      else if (g.dx > 80 || g.vx > 0.6) goRef.current && goRef.current(-1);
      Animated.spring(drag, { toValue: 0, useNativeDriver: ND, speed: 18, bounciness: 4 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: ND }).start(),
  })).current;

  const go = (delta) => {
    dirRef.current = delta;
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
    dispatch({ type: 'set', patch: { translation: id } });
    setPicker(null);
    if (id !== tr) toast.show(`Reading in ${translationInfo(id).name}`, { icon: 'bible', haptic: 'select' });
  };

  // "Romans 8:28", "Romans 8:28-30" or "Romans 8:3, 7"
  const selLabel = () => {
    if (!sel.length) return '';
    const contiguous = sel.every((n, i) => i === 0 || n === sel[i - 1] + 1);
    if (sel.length === 1) return refLabel(pos.bookId, pos.chapter, selected);
    return contiguous ? `${refLabel(pos.bookId, pos.chapter, selected)}-${selEnd}` : `${refLabel(pos.bookId, pos.chapter, selected)}, ${sel.slice(1).join(', ')}`;
  };
  const selText = () => (sel.length === 1 ? verses[selected - 1] : sel.map((n) => `${n} ${verses[n - 1]}`).join(' '));
  const selMessage = () => `“${selText()}” — ${selLabel()} (${showingFallback ? 'KJV' : tr})`;

  const share = async () => {
    if (!selected) return;
    try { await Share.share({ message: selMessage() }); } catch (e) { toast.show('Sharing isn’t available here', { tone: 'error' }); }
  };
  const copy = async () => {
    if (!selected) return;
    try { await Clipboard.setStringAsync(selMessage()); toast.show(`Copied ${selLabel()}`, { icon: 'check', haptic: 'select' }); } catch (e) { toast.show('Couldn’t copy', { tone: 'error' }); }
  };

  const postToFeed = () => {
    if (!selected) return;
    dispatch({
      type: 'post',
      post: {
        kind: 'Verse',
        text: selMessage(),
        passage: { bookId: pos.bookId, chapter: pos.chapter },
      },
    });
    toast.show('Posted to your feed', { icon: 'share', action: { label: 'View', onPress: () => nav.push('Feed') } });
  };

  goRef.current = go;
  const trInfo = translationInfo(tr);
  const rtl = !!trInfo.rtl && !showingFallback;
  // Reader tools menu (the ⋯ tools icon in the top bar). Books lives on the "John 3 ▾" title.
  const runTool = (fn) => () => { setPicker(null); fn(); };
  const tools = [
    { key: 'compare', label: compare ? 'Single view' : 'Compare', icon: 'bible', onPress: runTool(() => setCompare(!compare)), active: compare },
    { key: 'listen', label: audio ? 'Pause' : 'Listen', icon: 'headphones', onPress: runTool(toggleNarration), active: audio },
    { key: 'settings', label: 'Text & theme', icon: 'type', onPress: () => setPicker('settings') },
    { key: 'commentary', label: 'Commentary', icon: 'book', onPress: runTool(() => nav.push('Study', { ...pos, verse: selected || undefined, tab: 'Commentary' })) },
    { key: 'xref', label: 'Cross refs', icon: 'link', onPress: runTool(() => nav.push('Study', { ...pos, verse: selected || undefined, tab: 'Cross-references' })) },
    { key: 'lexicon', label: 'Word study', icon: 'sparkles', onPress: runTool(() => nav.push('Concordance', selected ? { bookId: pos.bookId, chapter: pos.chapter, verse: selected } : {})) },
    { key: 'beyond', label: 'Beyond the 66', icon: 'book', onPress: runTool(() => nav.push('ExtraBooks')) }, // Apocrypha, Enoch, Jubilees…
    {
      key: 'save',
      label: bookmarked ? 'Saved' : 'Save chapter',
      icon: 'bookmark',
      onPress: runTool(() => {
        dispatch({ type: 'bookmark', b: { bookId: pos.bookId, chapter: pos.chapter } });
        toast.show(bookmarked ? 'Bookmark removed' : `${bookName(pos.bookId)} ${pos.chapter} saved to your library`, { icon: 'bookmark' });
      }),
      active: bookmarked,
    },
    { key: 'library', label: 'My library', icon: 'highlight', onPress: runTool(() => nav.push('Library')) },
    { key: 'plans', label: 'Reading plans', icon: 'calendar', onPress: runTool(() => nav.push('Learn', { tab: 'Plans' })) },
  ];

  // Verse toolbar → study tools, in this exact order: Commentary, Exegesis, Cross Reference, Word Study, then the rest.
  const verseCtx = () => ({ ...pos, verse: selected });
  const studyTools = !selected ? [] : [
    { k: 'commentary', label: 'Commentary', icon: 'book', onPress: () => nav.push('Study', { ...verseCtx(), tab: 'Commentary' }) },
    { k: 'exegesis', label: 'Exegesis', icon: 'sparkles', onPress: () => nav.push('Exegesis', { bookId: pos.bookId, chapter: pos.chapter, verseStart: selected, verseEnd: selEnd, translation: showingFallback ? 'KJV' : tr }) },
    { k: 'xref', label: 'Cross Reference', icon: 'link', onPress: () => nav.push('Study', { ...verseCtx(), tab: 'Cross-references' }) },
    { k: 'word', label: 'Word Study', icon: 'search', onPress: () => nav.push('Study', { ...verseCtx(), tab: 'Word study' }) },
    { k: 'compare', label: 'Compare', icon: 'bible', onPress: () => { setCompare(true); setSel([]); } },
    { k: 'listen', label: 'Listen', icon: 'headphones', onPress: () => { nar.playChapter(pos.bookId, pos.chapter, { translation: tr, fromVerse: selected }); setSel([]); } },
    { k: 'image', label: 'Share image', icon: 'image', onPress: () => setImageOpen(true) },
    { k: 'lexicon', label: 'Word by word', icon: 'type', onPress: () => nav.push('Concordance', verseCtx()) },
    { k: 'ask', label: 'Ask AI', icon: 'chat', onPress: () => nav.push('BibleChat', { context: verseCtx() }) },
    { k: 'post', label: 'Post', icon: 'repost', onPress: postToFeed },
    { k: 'pray', label: 'Intercede', icon: 'prayer', onPress: () => nav.push('NewPrayer', { verse: selLabel() }) },
    { k: 'memorize', label: 'Memorize', icon: 'star', onPress: () => nav.push('Learn', { tab: 'Memorize' }) },
  ];
  const highlightSelection = (c) => {
    const all = sel.every((n) => hl(n)?.color === c);
    sel.forEach((n) => {
      if (all || hl(n)?.color !== c) dispatch({ type: 'highlight', h: { bookId: pos.bookId, chapter: pos.chapter, verse: n, color: c, label: 'Highlight' } });
    });
    toast.show(all ? 'Highlight removed' : `Highlighted ${selLabel()}`, { icon: 'highlight', haptic: 'select' });
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      {/* Header — minimal (book/chapter, translation, search, tools); slides away while scrolling down */}
      <Animated.View
        onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h && h !== headH) setHeadH(h); }}
        pointerEvents="box-none"
        style={[styles.headWrap, { backgroundColor: t.bg, borderBottomColor: t.border, opacity: headA, transform: [{ translateY: headA.interpolate({ inputRange: [0, 1], outputRange: [-headH, 0] }) }] }]}
      >
      <View style={[styles.topBar, { backgroundColor: t.bg }]}>
        {isRoute ? (
          <Pressable onPress={() => nav.pop()} hitSlop={10} accessibilityLabel="Back" style={({ pressed }) => [styles.iconBtn, { backgroundColor: t.chip, borderColor: t.border, marginRight: 10 }, pressed && { opacity: 0.7 }]}>
            <Icon name="chevron-left" size={19} color={t.fg} strokeWidth={2.2} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => setPicker('book')} style={({ pressed }) => [styles.bookBtn, pressed && { opacity: 0.7 }]} hitSlop={8}>
          <Text style={[styles.bookBtnEyebrow, { color: t.gold }]}>{book && book.testament === 'NT' ? 'New Testament' : 'Old Testament'}</Text>
          <View style={styles.bookBtnRow}>
            <Text style={[styles.bookBtnText, { color: t.fg }]} numberOfLines={1}>{bookName(pos.bookId)} {pos.chapter}</Text>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path d="M6 9l6 6 6-6" stroke={t.muted} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
        </Pressable>

        <View style={styles.rightActions}>
          <Pressable onPress={() => setPicker('translation')} accessibilityLabel={`Translation ${tr}`} style={({ pressed }) => [styles.trBadge, { backgroundColor: t.chip, borderColor: t.border }, pressed && { opacity: 0.7 }]}>
            <Text style={[styles.trBadgeText, { color: t.accent }]}>{tr}</Text>
          </Pressable>
          <Pressable onPress={() => nav.push('Search')} hitSlop={8} accessibilityLabel="Search the Bible" style={({ pressed }) => [styles.iconBtn, { backgroundColor: t.chip, borderColor: t.border }, pressed && { opacity: 0.7 }]}>
            <Icon name="search" size={18} color={t.fg} />
          </Pressable>
          <Pressable onPress={() => setPicker('tools')} hitSlop={8} accessibilityLabel="Bible tools" style={({ pressed }) => [styles.iconBtn, { backgroundColor: t.chip, borderColor: t.border }, (audio || compare) && { backgroundColor: t.accentSoft, borderColor: t.accentSoft }, pressed && { opacity: 0.7 }]}>
            <Pop trigger={audio}><Icon name="more-horizontal" size={18} color={audio || compare ? t.accent : t.fg} /></Pop>
          </Pressable>
        </View>
      </View>
      </Animated.View>

      {/* Reader */}
      <ScrollView
        ref={scrollRef}
        {...pan.panHandlers}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: headH + 4, paddingBottom: selected ? (studyOpen ? 330 : 220) : 72 }}
        showsVerticalScrollIndicator={false}
        onScroll={onReaderScroll}
        onScrollBeginDrag={hideNav}
        scrollEventThrottle={32}
      >
        <Animated.View
          style={{
            opacity: enter,
            transform: [
              { translateX: Animated.add(drag, enter.interpolate({ inputRange: [0, 1], outputRange: [dirRef.current * 46, 0] })) },
            ],
          }}
        >
        {audio ? (
          <View style={[styles.audioNotice, { backgroundColor: t.accentSoft }]}>
            <Icon name="headphones" size={15} color={t.accent} />
            <Text style={[styles.audioNoticeText, { color: t.fg }]}>Reading aloud · verse {nar.verse} of {nar.total}</Text>
          </View>
        ) : null}

        <View style={styles.chapterHead}>
          <Text style={[styles.chapterEyebrow, { color: t.muted }]}>{bookName(pos.bookId)}</Text>
          <ScaleIn key={pos.bookId + pos.chapter} from={0.7}>
            <Text style={[styles.chapterNumber, { color: t.accent }]}>{pos.chapter}</Text>
          </ScaleIn>
          {title && (showingFallback || trInfo.lang === 'English') && title.length <= 80 && !/\.\.\.$|…$/.test(title) ? <Text style={[styles.chapterTitle, { color: t.muted }]}>{title}</Text> : null}
          <View style={styles.ornament}>
            <View style={[styles.ornamentLine, { backgroundColor: t.borderStrong }]} />
            <Text style={[styles.ornamentStar, { color: t.gold }]}>✦</Text>
            <View style={[styles.ornamentLine, { backgroundColor: t.borderStrong }]} />
          </View>
        </View>

        {showingFallback && !compare ? (
          <View style={[styles.loadNotice, { backgroundColor: t.chip, borderColor: t.border }]}>
            {chapterData.loading ? <Pulse><Icon name="download" size={15} color={t.accent} /></Pulse> : <Icon name="globe" size={15} color={t.gold} />}
            <Text style={[styles.loadNoticeText, { color: t.fg }]} numberOfLines={2}>
              {chapterData.loading ? `Loading ${trInfo.name}… showing KJV meanwhile` : `${tr} isn't saved on this device yet — connect to the internet to load it. Showing KJV.`}
            </Text>
          </View>
        ) : null}
        {!verses ? (
          <Empty
            title="Chapter unavailable"
            body={`${refLabel(pos.bookId, pos.chapter)} couldn't be loaded in ${tr}.`}
            action="Choose another translation"
            onAction={() => setPicker('translation')}
          />
        ) : compare ? (
          <CompareView pos={pos} base={tr} others={state.compareWith} onPick={() => setPicker('compare')} />
        ) : (
          verses.map((v, i) => {
            const n = i + 1;
            const h = hl(n);
            const notes = noteFor(n);
            const isSel = sel.includes(n);
            const isSpoken = narHere && nar.verse === n;
            const fs = Math.round(state.fontSize * 1.12);

            return (
              <Pressable
                key={n}
                onLayout={(e) => { verseY.current[n] = e.nativeEvent.layout.y; }}
                accessibilityState={{ selected: isSel }}
                onPress={() => {
                  toggleVerse(n);
                  setPanel(null);
                }}
                style={[styles.verseRow, h && { backgroundColor: alpha(h.color, t.dark ? 0.24 : 0.18) }, isSpoken && { backgroundColor: t.accentSoft, borderLeftWidth: 3, borderLeftColor: t.accent }, isSel && { backgroundColor: t.sel }]}
              >
                <Text style={[styles.verseText, verseFont, { color: t.passage, fontSize: fs, lineHeight: Math.round(fs * spacing) }, rtl && { writingDirection: 'rtl', textAlign: 'right' }]}>
                  {n === 1 && !rtl && v ? (
                    <Text style={[styles.dropCapLetter, { color: t.accent, fontSize: fs * 2, lineHeight: Math.round(fs * spacing) }]}>{v.charAt(0)}</Text>
                  ) : (
                    <Text style={[styles.vnum, { color: isSel ? t.accent : t.gold }]}>{n}{'\u2009'} </Text>
                  )}
                  <Text>{n === 1 && !rtl && v ? v.slice(1) : v}</Text>
                  {notes.length ? <Text style={{ color: t.gold, fontSize: fs * 0.8 }}>  ✎</Text> : null}
                </Text>
              </Pressable>
            );
          })
        )}

        {/* one small banner at the end of the chapter, never between verses */}
        {verses && !compare ? <BannerSlot /> : null}

        {/* Narration bar */}
        <Pressable onPress={() => { if (!narHere) nar.playChapter(pos.bookId, pos.chapter, { translation: tr }); nar.openPlayer(); }} accessibilityLabel="Open player" style={[styles.audioBar, t.dark && { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }]}><NightGlow />
          <Pressable onPress={toggleNarration} style={styles.audioPlayBtn} accessibilityLabel={audio ? 'Pause narration' : 'Play narration'}>
            {audio ? (
              <Svg width={14} height={14} viewBox="0 0 24 24"><Path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill={colors.night} /></Svg>
            ) : (
              <Svg width={14} height={14} viewBox="0 0 24 24"><Path d="M8 5.5v13l10.5-6.5L8 5.5z" fill={colors.night} /></Svg>
            )}
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 12 }}>
            <Text style={styles.audioTitleText} numberOfLines={1}>{bookName(pos.bookId)} {pos.chapter} · Narration</Text>
            <View style={styles.audioTrack}><View style={[styles.audioTrackFill, { width: narHere && nar.total ? `${(nar.verse / nar.total) * 100}%` : '0%' }]} /></View>
            <Text style={styles.audioSubText}>{nar.narrator.name} · {narHere ? `Verse ${nar.verse} of ${nar.total}` : `${verses ? verses.length : 0} verses`} · {tr}</Text>
          </View>
          <View style={styles.audioSpeedBadge}>
            <Text style={styles.audioSpeedText}>{nar.rate}×</Text>
          </View>
        </Pressable>

        {/* Pager */}
        <View style={styles.pager}>
          <Pressable onPress={() => go(-1)} style={({ pressed }) => [styles.pagerBtn, { backgroundColor: t.chip, borderColor: t.border }, pressed && { opacity: 0.75 }]}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke={t.fg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
            <Text style={[styles.pagerBtnText, { color: t.fg }]}>Previous</Text>
          </Pressable>
          <Pressable onPress={() => go(1)} style={({ pressed }) => [styles.pagerBtn, { backgroundColor: t.accent, borderColor: t.accent }, pressed && { opacity: 0.85 }]}>
            <Text style={[styles.pagerBtnText, { color: t.dark ? t.bg : '#FFFFFF' }]}>Next chapter</Text>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"><Path d="M9 6l6 6-6 6" stroke={t.dark ? t.bg : '#FFFFFF'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
          </Pressable>
        </View>

        <Text style={[styles.copyright, { color: t.faint }]}>
          {showingFallback ? 'King James Version · Public domain' : (trInfo.attribution || `${trInfo.name} · ${trInfo.licence}`)}
        </Text>
        <Text style={[styles.copyright, { color: t.faint, marginTop: 6 }]}>Swipe left or right to turn the page</Text>
        </Animated.View>
      </ScrollView>

      {/* Full-screen reading: small arrow handle at the bottom-left brings the tab bar back */}
      {!isRoute ? (
        <Animated.View pointerEvents={showHandle ? 'box-none' : 'none'} style={[styles.handleWrap, { opacity: handleA, transform: [{ translateX: handleA.interpolate({ inputRange: [0, 1], outputRange: [-36, 0] }) }] }]}>
          <Pressable onPress={showNav} hitSlop={10} accessibilityRole="button" accessibilityLabel="Show navigation" style={({ pressed }) => [styles.handle, { backgroundColor: t.dark ? 'rgba(255,255,255,0.16)' : 'rgba(21,23,43,0.28)' }, pressed && { opacity: 0.7 }]}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"><Path d="M9 6l6 6-6 6" stroke="#FFFFFF" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Verse toolbar: highlight colours, Copy, Share, Bookmark, Note + an arrow that opens the study tools */}
      {selected && verses ? (
        <SlideUp style={[styles.sheet, { backgroundColor: t.surface }, t.dark && { borderTopWidth: 1, borderColor: t.border }]}>
          <View style={[styles.grabber, { backgroundColor: t.borderStrong }]} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.sheetEyebrow, { color: t.gold }]}>{sel.length > 1 ? `${sel.length} verses` : `Verse ${selected}`}</Text>
              <Text style={[styles.sheetRef, { color: t.fg }]} numberOfLines={1}>{selLabel()}</Text>
            </View>
            <View style={styles.hlRow}>
              {HIGHLIGHT_COLORS.map((c) => {
                const on = sel.every((n) => hl(n)?.color === c);
                return (
                  <Pressable key={c} accessibilityLabel="Highlight" accessibilityState={{ selected: on }} onPress={() => highlightSelection(c)} hitSlop={3} style={[styles.hlRing, on && { borderColor: c }]}>
                    <View style={[styles.hlDot, { backgroundColor: c }]} />
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => setSel([])} hitSlop={12} style={[styles.sheetCloseBtn, { backgroundColor: t.raised }]} accessibilityLabel="Close">
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none"><Path d="M6 6l12 12M18 6L6 18" stroke={t.muted} strokeWidth={2.6} strokeLinecap="round" /></Svg>
            </Pressable>
          </View>

          <View style={styles.vbar}>
            <View style={styles.vbarActions}>
              {[
                { k: 'copy', label: 'Copy', glyph: (col) => <CopyGlyph color={col} />, onPress: copy },
                { k: 'share', label: 'Share', icon: 'share', onPress: share },
                { k: 'save', label: verseSaved ? 'Saved' : 'Bookmark', icon: 'bookmark', active: verseSaved, onPress: () => { dispatch({ type: 'bookmark', b: { bookId: pos.bookId, chapter: pos.chapter, verse: selected } }); toast.show(verseSaved ? 'Removed from library' : `${refLabel(pos.bookId, pos.chapter, selected)} saved`, { icon: 'bookmark' }); } },
                { k: 'note', label: 'Note', icon: 'edit', onPress: () => setPanel(panel === 'note' ? null : 'note'), active: panel === 'note' },
              ].map((a) => {
                const col = a.active ? t.accent : t.fg;
                return (
                  <Pressable key={a.k} onPress={a.onPress} accessibilityRole="button" accessibilityLabel={a.label} style={({ pressed }) => [styles.vbarAction, pressed && { opacity: 0.6 }]}>
                    {a.glyph ? a.glyph(col) : <Icon name={a.icon} size={19} color={col} fill={a.active ? 'solid' : 'none'} />}
                    <Text style={[styles.vbarLabel, { color: col }]} numberOfLines={1}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setStudyOpen(!studyOpen)}
              accessibilityRole="button"
              accessibilityLabel={studyOpen ? 'Hide study tools' : 'More study tools'}
              accessibilityState={{ expanded: studyOpen }}
              style={({ pressed }) => [styles.moreArrow, { backgroundColor: studyOpen ? t.accent : t.accentSoft }, pressed && { opacity: 0.75 }]}
            >
              <RotateArrow open={studyOpen} color={studyOpen ? (t.dark ? t.bg : '#FFFFFF') : t.accent} />
            </Pressable>
          </View>

          <Expand open={studyOpen}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.studyRow}>
              {studyTools.map((s, i) => (
                <Pressable key={s.k} onPress={s.onPress} accessibilityRole="button" accessibilityLabel={s.label} style={({ pressed }) => [styles.studyTool, pressed && { opacity: 0.6 }]}>
                  <View style={[styles.studyIcon, { backgroundColor: i < 4 ? t.accentSoft : t.raised }]}>
                    <Icon name={s.icon} size={20} color={i < 4 ? t.accent : t.fg} />
                  </View>
                  <Text style={[styles.studyLabel, { color: t.fg }]} numberOfLines={2}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Expand>

          {panel === 'note' ? (
            <View style={{ marginTop: 12, gap: 10 }}>
              <Input
                placeholder={`A private note on ${selLabel()}…`}
                value={noteText}
                onChangeText={setNoteText}
                multiline
                style={{ minHeight: 72 }}
              />
              <Button
                small
                label="Save note"
                onPress={() => {
                  if (noteText.trim()) {
                    dispatch({
                      type: 'note',
                      n: { bookId: pos.bookId, chapter: pos.chapter, verse: selected, text: sel.length > 1 ? `${selLabel()} — ${noteText.trim()}` : noteText.trim() },
                    });
                    setNoteText('');
                    setPanel(null);
                    toast.show('Note saved', { icon: 'highlight', action: { label: 'Library', onPress: () => nav.push('Library') } });
                  }
                }}
              />
            </View>
          ) : null}
        </SlideUp>
      ) : null}

      <VerseImageSheet
        visible={imageOpen}
        onClose={() => setImageOpen(false)}
        text={selected && verses ? selText() : ''}
        reference={selected ? selLabel() : ''}
        translation={tr}
      />

      {/* Tools menu (top bar ⋯) */}
      <AnimatedModal visible={picker === 'tools'} onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPicker(null)} />
          <View style={[styles.modalSheet, { backgroundColor: t.bg, paddingBottom: 26 + insets.bottom }]}>
            <View style={[styles.grabber, { backgroundColor: t.borderStrong }]} />
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: t.fg }]}>Bible tools</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={12} style={[styles.modalClose, { backgroundColor: t.fg }]}>
                <Text style={[styles.modalCloseText, { color: t.bg }]}>Done</Text>
              </Pressable>
            </View>
            <View style={styles.toolsGrid}>
              {tools.map((tool) => (
                <Pressable key={tool.key} onPress={tool.onPress} accessibilityRole="button" accessibilityLabel={tool.label} style={({ pressed }) => [styles.toolsCell, pressed && { opacity: 0.6 }]}>
                  <View style={[styles.studyIcon, { backgroundColor: tool.active ? t.accent : t.chip, borderWidth: 1, borderColor: tool.active ? t.accent : t.border }]}>
                    <Icon name={tool.icon} size={20} color={tool.active ? (t.dark ? t.bg : '#FFFFFF') : t.fg} />
                  </View>
                  <Text style={[styles.studyLabel, { color: t.fg }]} numberOfLines={2}>{tool.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </AnimatedModal>

      {/* Reading settings */}
      <AnimatedModal visible={picker === 'settings'} onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPicker(null)} />
          <View style={[styles.modalSheet, { backgroundColor: t.bg }]}>
            <View style={[styles.grabber, { backgroundColor: t.borderStrong }]} />
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: t.fg }]}>Reading settings</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={12} style={[styles.modalClose, { backgroundColor: t.fg }]}>
                <Text style={[styles.modalCloseText, { color: t.bg }]}>Done</Text>
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: 18, paddingBottom: 34 }}>
              <View style={[styles.previewCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                <Text style={[styles.verseText, verseFont, { color: t.passage, fontSize: Math.round(state.fontSize * 1.12), lineHeight: Math.round(state.fontSize * 1.12 * spacing) }]}>
                  <Text style={[styles.vnum, { color: t.gold }]}>16{' '} </Text>
                  For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish.
                </Text>
              </View>

              <Text style={[styles.settingLabel, { color: t.gold }]}>Theme</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {Object.values(readerThemes).map((rt) => {
                  const on = rt.key === t.key;
                  return (
                    <Pressable
                      key={rt.key}
                      onPress={() => dispatch({ type: 'set', patch: { readerTheme: rt.key } })}
                      style={[styles.themeSwatch, { backgroundColor: rt.bg, borderColor: on ? t.accent : rt.border }, on && { borderWidth: 2 }]}
                    >
                      <Text style={[styles.themeSwatchAa, { color: rt.fg }]}>Aa</Text>
                      <Text style={[styles.themeSwatchLabel, { color: rt.muted }]}>{rt.label}</Text>
                      {on ? (
                        <View style={[styles.themeCheck, { backgroundColor: t.accent }]}>
                          <Icon name="check" size={11} color={t.dark ? t.bg : '#FFFFFF'} strokeWidth={3} />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.settingLabel, { color: t.gold }]}>Font</Text>
              <View style={styles.fontGrid}>
                {READER_FONTS.map((f) => {
                  const on = readerFont === f.key;
                  return (
                    <Pressable
                      key={f.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={'Font ' + f.label}
                      onPress={() => dispatch({ type: 'set', patch: { readerFont: f.key } })}
                      style={[styles.fontChip, { backgroundColor: t.surface, borderColor: on ? t.accent : t.border }, on && { borderWidth: 2 }]}
                    >
                      <Text style={[styles.fontChipName, { color: t.fg, fontFamily: f.family }]} numberOfLines={1}>{f.label}</Text>
                      <Text style={[styles.fontChipNote, { color: t.muted }]} numberOfLines={1}>{f.note}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.settingLabel, { color: t.gold }]}>Text size</Text>
              <View style={[styles.stepper, { backgroundColor: t.surface, borderColor: t.border }]}>
                <Pressable
                  onPress={() => dispatch({ type: 'set', patch: { fontSize: Math.max(13, state.fontSize - 1) } })}
                  style={styles.stepBtn}
                  accessibilityLabel="Smaller text"
                >
                  <Text style={[styles.stepSmallA, { color: t.fg }]}>A</Text>
                </Pressable>
                <View style={styles.stepTrack}>
                  {Array.from({ length: 10 }, (_, i) => 13 + i).map((sz) => (
                    <Pressable
                      key={sz}
                      hitSlop={6}
                      onPress={() => dispatch({ type: 'set', patch: { fontSize: sz } })}
                      style={[styles.stepDot, { backgroundColor: sz <= state.fontSize ? t.accent : t.borderStrong }, sz === state.fontSize && styles.stepDotOn]}
                    />
                  ))}
                </View>
                <Pressable
                  onPress={() => dispatch({ type: 'set', patch: { fontSize: Math.min(22, state.fontSize + 1) } })}
                  style={styles.stepBtn}
                  accessibilityLabel="Larger text"
                >
                  <Text style={[styles.stepBigA, { color: t.fg }]}>A</Text>
                </Pressable>
              </View>

              <Text style={[styles.settingLabel, { color: t.gold }]}>Line spacing</Text>
              <View style={[styles.segment, { backgroundColor: t.raised }]}>
                {Object.keys(lineSpacings).map((k) => {
                  const on = (state.lineSpacing || 'Comfortable') === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => dispatch({ type: 'set', patch: { lineSpacing: k } })}
                      style={[styles.segmentBtn, on && { backgroundColor: t.surface }, on && shadow.sm]}
                    >
                      <Text style={[styles.segmentText, { color: on ? t.fg : t.muted }, on && { fontWeight: '700' }]}>{k}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </View>
      </AnimatedModal>

      {/* Book / chapter picker */}

      <AnimatedModal visible={picker === 'book'} onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPicker(null)} />
          <BookChapterPicker
            pos={pos}
            onClose={() => setPicker(null)}
            onSelect={(p) => {
              setPos(p);
              setSelected(null);
              setPicker(null);
            }}
          />
        </View>
      </AnimatedModal>

      {/* Translation picker */}
      {/* full screen: the list needs the whole height on phones */}
      <AnimatedModal visible={picker === 'translation' || picker === 'compare'} onRequestClose={() => setPicker(null)} full>
        <View style={[styles.fullPicker, { paddingTop: insets.top + 12, paddingBottom: insets.bottom }]}>
          <View style={{ flex: 1 }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{picker === 'compare' ? 'Compare (up to 3)' : 'Translations'}</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={12} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>Done</Text>
              </Pressable>
            </View>
            <TranslationPicker
              mode={picker === 'compare' ? 'compare' : 'read'}
              active={tr}
              compareWith={state.compareWith}
              onPick={setTranslation}
              onToggleCompare={(id) => dispatch({
                type: 'set',
                patch: { compareWith: state.compareWith.includes(id) ? state.compareWith.filter((x) => x !== id) : [...state.compareWith, id].slice(-3) },
              })}
              onClose={() => setPicker(null)}
            />
          </View>
        </View>
      </AnimatedModal>
    </View>
  );
}

function SlideUp({ children, style }) {
  const y = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(y, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, 280] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Right-pointing arrow that turns to point down when the study tools are open.
function RotateArrow({ open, color }) {
  const a = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: open ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [open]);
  return (
    <Animated.View style={{ transform: [{ rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }}>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"><Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /></Svg>
    </Animated.View>
  );
}

// Smooth height + fade expand for the study tools row.
function Expand({ open, children }) {
  const a = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [h, setH] = useState(0);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(a, { toValue: open ? 1 : 0, duration: open ? 300 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: false })
      .start(({ finished }) => { if (finished && !open) setMounted(false); });
  }, [open]);
  if (!mounted) return null;
  return (
    <Animated.View style={{ overflow: 'hidden', height: h ? a.interpolate({ inputRange: [0, 1], outputRange: [0, h] }) : undefined, opacity: a }}>
      <Animated.View
        onLayout={(e) => { const hh = Math.round(e.nativeEvent.layout.height); if (hh && hh !== h) setH(hh); }}
        style={{ transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

function CompareView({ pos, base, others, onPick }) {
  const cols = [base, ...others.filter((o) => o !== base)];
  const texts = useChapters(cols, pos.bookId, pos.chapter);
  const max = Math.max(1, ...texts.map((t) => (t.verses ? t.verses.length : 0)));
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={styles.compareHead}>{cols.join('  ·  ')}</Text>
        <Pressable onPress={onPick} style={styles.colPickerBtn}>
          <Text style={{ color: colors.primary, fontFamily: fonts.sansMedium, fontSize: 12, fontWeight: '600' }}>Edit columns</Text>
        </Pressable>
      </View>
      {Array.from({ length: max }, (_, i) => (
        <View key={i} style={styles.compareRow}>
          <Text style={styles.vnum}>{i + 1}</Text>
          {texts.map((t) => (
            <View key={t.id} style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.compareTr}>{t.id}</Text>
              <Text style={[styles.compareText, translationInfo(t.id).rtl && { writingDirection: 'rtl', textAlign: 'right' }]}>{t.verses ? (t.verses[i] || '—') : '…'}</Text>
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
  container: { flex: 1, backgroundColor: colors.screen },

  // Header (absolute, slides away on scroll)
  headWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, borderBottomWidth: StyleSheet.hairlineWidth },
  // Full-screen handle (bottom-left, ~28dp)
  handleWrap: { position: 'absolute', left: 0, bottom: 18, zIndex: 6 },
  handle: { width: 30, height: 34, borderTopRightRadius: 17, borderBottomRightRadius: 17, alignItems: 'center', justifyContent: 'center', paddingRight: 2 },
  // Verse toolbar
  vbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vbarScroll: { alignItems: 'center', gap: 4, paddingRight: 4 },
  vbarDivider: { width: 1, height: 30, marginHorizontal: 6 },
  vbarActions: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  vbarAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4 },
  hlRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  hlRing: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  hlDot: { width: 19, height: 19, borderRadius: 10 },
  vbarLabel: { fontSize: 10.5, fontWeight: '600' },
  moreArrow: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  studyRow: { paddingTop: 14, paddingBottom: 2, gap: 4 },
  studyTool: { width: 74, alignItems: 'center', gap: 6 },
  studyIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  studyLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 14 },
  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, rowGap: 16 },
  toolsCell: { width: '20%', alignItems: 'center', gap: 6 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: colors.screen,
  },
  bookBtn: { flexShrink: 1, flexGrow: 1, paddingVertical: 2 },
  bookBtnEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold },
  bookBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  bookBtnText: { fontFamily: fonts.serifBold, fontSize: 25, color: colors.fg, letterSpacing: -0.5 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trBadge: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  trBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: colors.primary },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  iconBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },

  // Tools
  toolBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.screen,
  },
  toolScroll: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12, gap: 8 },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  toolChipText: { fontSize: 12.5, fontWeight: '600', color: colors.fg },
  toolChipTextActive: { color: colors.primary },

  // Chapter heading
  chapterHead: { alignItems: 'center', paddingTop: 22, paddingBottom: 6, marginBottom: 14 },
  chapterEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2.4, textTransform: 'uppercase', color: colors.muted },
  chapterNumber: { fontFamily: fonts.display, fontSize: 64, lineHeight: 72, color: colors.primary, letterSpacing: -1.5, marginTop: 2 },
  chapterTitle: {
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    lineHeight: 23,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 2,
    paddingHorizontal: 12,
  },
  ornament: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  ornamentLine: { width: 44, height: 1, backgroundColor: colors.borderStrong },
  ornamentStar: { fontSize: 11, color: colors.gold },

  // Verses
  verseRow: { paddingVertical: 5, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 10, marginVertical: 1 },
  verseSel: { backgroundColor: colors.cardGold },
  verseText: { fontFamily: fonts.serif, color: colors.passage },
  fontGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fontChip: { width: '31%', flexGrow: 1, minWidth: 96, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  fontChipName: { fontSize: 14 },
  fontChipNote: { fontSize: 10, marginTop: 2 },
  dropCapLetter: { fontFamily: fonts.display, color: colors.primary },
  vnum: { fontFamily: fonts.sans, fontSize: 11, color: colors.gold, fontWeight: '700' },

  // Narration bar
  audioBar: { overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.night,
    borderRadius: radius.lg,
    padding: 12,
    marginTop: 30,
    ...shadow.lg,
  },
  audioPlayBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  audioTitleText: { fontSize: 13, fontWeight: '700', color: colors.nightFg },
  audioTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 7, overflow: 'hidden' },
  audioTrackFill: { height: 3, backgroundColor: colors.goldLight },
  audioSubText: { fontSize: 11, color: colors.nightMuted, marginTop: 5 },
  audioSpeedBadge: { backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9 },
  audioSpeedText: { fontSize: 11, fontWeight: '800', color: colors.nightFg },

  // Pager
  pager: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 16 },
  pagerBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  pagerBtnText: { fontSize: 13.5, color: colors.fg, fontWeight: '600' },
  copyright: { fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 22 },

  // Verse sheet
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 20,
    ...shadow.lg,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  sheetEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold },
  sheetRef: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg, letterSpacing: -0.3, marginTop: 1 },
  sheetCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  colorPalette: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  colorDotRing: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 24, height: 24, borderRadius: 12 },
  sheetActions: { flexDirection: 'row', gap: 8 },
  sheetAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  sheetActionActive: { backgroundColor: colors.primarySoft },
  sheetActionText: { fontSize: 11.5, fontWeight: '600', color: colors.fg },

  audioNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, marginTop: 10, alignSelf: 'center' },
  audioNoticeText: { fontSize: 12.5, fontWeight: '600' },
  studyChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
  studyChipText: { fontSize: 12, fontWeight: '600' },
  previewCard: { borderRadius: radius.lg, borderWidth: 1, padding: 16, marginBottom: 4 },
  settingLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 },
  themeSwatch: { flex: 1, height: 86, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  themeSwatchAa: { fontFamily: fonts.serifBold, fontSize: 24 },
  themeSwatchLabel: { fontSize: 12, fontWeight: '600' },
  themeCheck: { position: 'absolute', top: 7, right: 7, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6, height: 52 },
  stepBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  stepSmallA: { fontFamily: fonts.serifBold, fontSize: 14 },
  stepBigA: { fontFamily: fonts.serifBold, fontSize: 23 },
  stepTrack: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  stepDot: { width: 7, height: 7, borderRadius: 4 },
  stepDotOn: { width: 14, height: 14, borderRadius: 7 },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 4 },
  segmentBtn: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '500' },

  // Modals
  modalBackdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  fullPicker: { flex: 1, backgroundColor: colors.screen },
  modalSheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    maxHeight: '88%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 12 },
  modalTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, letterSpacing: -0.3 },
  modalClose: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.fg },
  modalCloseText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  modalSub: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginBottom: 10 },
  testamentLabel: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  testamentCount: { fontSize: 12, color: colors.muted, marginTop: 1, marginBottom: 10 },
  chapterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chapterCell: {
    width: '12.3%',
    aspectRatio: 1,
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterCellActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chapterCellText: { fontSize: 14, fontWeight: '700', color: colors.fg },
  bookGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bookGridItem: {
    width: '31.6%',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bookGridItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  bookGridName: { fontSize: 13, color: colors.fg, fontWeight: '600' },
  bookGridNameActive: { color: '#FFFFFF', fontWeight: '700' },
  bookGridChCount: { fontSize: 11, color: colors.faint, marginTop: 2 },
  availChapterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
  },
  availChapterActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  availChapterIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  availChapterRef: { fontSize: 14, fontWeight: '700', color: colors.fg },
  availChapterTitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },

  // Compare
  loadNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  loadNoticeText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  compareHead: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: colors.muted },
  colPickerBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.primarySoft },
  compareRow: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  compareTr: { fontSize: 10, color: colors.primary, fontWeight: '800', letterSpacing: 0.6, marginBottom: 4 },
  compareText: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 22, color: colors.passage },
});
