import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { d, df, k, Tap, PageHeader, IconButton } from '../design/sanctuary';
import Svg, { Path } from 'react-native-svg';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import { Screen, Section, Row, Pills, Pill, Button, Tag, Badge, Notice, Input, Empty, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { answerBibleChat, companionResults } from '../data/assistant';
import { getChapter, refLabel, CHAPTER_TITLES } from '../data/bible';
import { COMPANION_CATEGORIES } from '../data/seed';
import { useToast } from '../components/Toast';
import { useNarration } from '../audio/Narration';
import { PressScale, FadeInUp, ScaleIn, Pop, Pulse } from '../components/Motion';

const ND = Platform.OS !== 'web';
const EASE_OUT = Easing.out(Easing.cubic);

// Entrance that glides in from the right (the user's own chat bubbles).
function SlideInRight({ children, style, distance = 28, duration = 320 }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration, easing: EASE_OUT, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Three gold dots that bounce in sequence while the assistant is "thinking".
function TypingDots() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(d, { toValue: 1, duration: 260, easing: EASE_OUT, useNativeDriver: ND }),
          Animated.timing(d, { toValue: 0, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: ND }),
          Animated.delay((2 - i) * 140 + 160),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={styles.typingDots}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[styles.typingDot, {
            opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
            transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
          }]}
        />
      ))}
    </View>
  );
}

// Dropdown that fades + scales in from its corner and fades out before unmounting.
function Dropdown({ visible, style, children }) {
  const [mounted, setMounted] = useState(visible);
  const a = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(a, { toValue: 1, duration: 200, easing: EASE_OUT, useNativeDriver: ND }).start();
    } else {
      Animated.timing(a, { toValue: 0, duration: 140, easing: Easing.in(Easing.cubic), useNativeDriver: ND }).start(({ finished }) => finished && setMounted(false));
    }
  }, [visible]);
  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[style, {
        opacity: a,
        transform: [
          { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
          { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
        ],
      }]}
    >
      {children}
    </Animated.View>
  );
}

// Share via the native sheet; on web without navigator.share fall back to the clipboard.
async function shareText(message, toast) {
  try {
    await Share.share({ message });
  } catch (e) {
    if (await copyText(message)) toast.show('Copied to clipboard', { icon: 'link' });
    else toast.show('Sharing isn’t available here', { tone: 'error' });
  }
}

async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* clipboard blocked */ }
  return false;
}

// Plain-text rendering of an answer for sharing / copying.
function answerText(m) {
  const body = (m.blocks || [])
    .map((b) => (b.ref ? `“${b.text}” — ${b.ref} (${b.translation})` : `${b.type}: ${b.text}`))
    .join('\n\n');
  return `Q: ${m.question}\n\n${body}\n\n— BibleNestra Bible Intelligence`;
}

// The passage an answer is about: its first quoted Scripture, else the conversation context.
function answerPassage(m, context) {
  const s = (m.blocks || []).find((b) => b.ref && b.bookId);
  if (s) return { bookId: s.bookId, chapter: s.chapter, verse: s.verse || null };
  if (context) return { bookId: context.bookId, chapter: context.chapter, verse: context.verse || null };
  return null;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
}

// Answer-block section tints (muted, on-brand)
const BLOCK_TINT = {
  Scripture: colors.gold,
  Explanation: colors.primary,
  Commentary: colors.sage,
  Interpretations: colors.lavender,
  'Further study': colors.sky,
};
const BLOCK_ICON = {
  Scripture: 'bible',
  Explanation: 'sparkles',
  Commentary: 'book',
  Interpretations: 'users',
  'Further study': 'search',
};

// Small night-coloured avatar used for assistant messages
function AssistantAvatar({ size = 28 }) {
  return (
    <View style={[styles.aiAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: colors.goldLight, fontSize: size * 0.42, lineHeight: size * 0.6 }}>✦</Text>
    </View>
  );
}

function ActionChip({ label, icon, onPress, active }) {
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      scaleTo={0.93}
      style={[styles.actionChip, active && styles.actionChipActive]}
    >
      {icon ? (
        <Pop trigger={!!active}>
          <Icon name={active ? 'check' : icon} size={13} color={active ? colors.primary : colors.muted} />
        </Pop>
      ) : null}
      <Text style={[styles.actionChipText, active && { color: colors.primary }]}>{label}</Text>
    </PressScale>
  );
}

function MenuItem({ label, icon, onPress, last }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, !last && styles.menuItemRule, pressed && { backgroundColor: colors.raised }]}
    >
      <Icon name={icon} size={15} color={colors.muted} />
      <Text style={styles.menuItemText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// ---------- God Mode home (the reference UI) ----------
export default function GodModeScreen() {
  const { state } = useStore();
  const nav = useNav();
  const lp = state.lastPosition;

  return (
    <Screen title="Scripture Intelligence" menu={() => nav.push('Profile')} scroll={true}>
      {/* Editorial Header */}
      <View style={styles.greet}>
        <Text style={styles.eyebrow}>{greeting()}</Text>
        <Text style={styles.homeTitle}>{state.user.displayName}, what are you seeking today?</Text>
        <Text style={styles.homeSub}>Seek wisdom, examine context, and deepen your understanding of Scripture.</Text>
      </View>

      {/* Pathways Grid */}
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <Card
            title={'Pastoral\nGuidance'}
            subtitle="Comfort, anxiety, and prayerful direction."
            color={colors.gold}
            icon="prayer"
            onPress={() => nav.push('Companion')}
          />
          <Card
            title={'Theological\nInquiry'}
            subtitle="What does Scripture teach about..."
            color={colors.lavender}
            icon="sparkles"
            onPress={() => nav.push('BibleChat', { seed: 'Which passages discuss ' })}
          />
        </View>
        <View style={styles.gridRow}>
          <Card
            title={'Guided\nExegesis'}
            subtitle="Chapter study with contextual AI."
            color={colors.teal}
            icon="book"
            onPress={() => nav.push('Reading', lp)}
          />
          <Card
            title={'Difficult\nPassages'}
            subtitle="Tensions, history, and apologetics."
            color={colors.terracotta}
            icon="quiz"
            onPress={() => nav.push('BibleChat', { seed: 'Why ' })}
          />
        </View>
      </View>

      {/* Quick suggestions */}
      <View style={styles.suggestionsContainer}>
        <Text style={[styles.eyebrow, { color: colors.muted, marginBottom: 10 }]}>Exploration topics</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {['Peace in anxiety', 'Forgiving when hurt', 'Who is the Holy Spirit?', 'Romans 8 walk-through'].map((item) => (
            <Pressable
              key={item}
              style={({ pressed }) => [styles.suggestionChip, pressed && { backgroundColor: colors.raised }]}
              onPress={() => nav.push('BibleChat', { seed: item, send: true })}
            >
              <Text style={styles.suggestionChipText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {state.chatHistory.length ? (
        <Pressable onPress={() => nav.push('BibleChat', {})} style={styles.resumeChat}>
          <Icon name="chat" size={15} color={colors.primary} />
          <Text style={styles.resumeChatText}>Continue previous conversation</Text>
          <Icon name="chevron-right" size={14} color={colors.primary} />
        </Pressable>
      ) : null}

      {/* Interactive Ask Bar */}
      <View style={styles.askSection}>
        <AskBar placeholder="Ask anything about Scripture..." onSend={(t) => nav.push('BibleChat', { seed: t, send: true })} />
      </View>
    </Screen>
  );
}

// ---------- Reading screen (Screen 2) ----------
export function ReadingScreen({ params = {} }) {
  const nav = useNav();
  const { state } = useStore();
  const nar = useNarration();
  const toast = useToast();
  const bookId = params.bookId || state.lastPosition?.bookId || 'MAT';
  const chapter = Number(params.chapter || state.lastPosition?.chapter || 1);
  const verses = getChapter(state.translation, bookId, chapter) || getChapter('KJV', bookId, chapter) || [];
  const narHere = nar.active && nar.bookId === bookId && nar.chapter === chapter;
  const listen = () => {
    if (!verses.length) return;
    if (narHere) nar.toggle();
    else {
      nar.playChapter(bookId, chapter, { translation: state.translation });
      toast.show(`Playing ${refLabel(bookId, chapter)}`, { icon: 'headphones', action: { label: 'Player', onPress: () => nar.openPlayer() } });
    }
  };
  const title = CHAPTER_TITLES[`${bookId}:${chapter}`] || refLabel(bookId, chapter);
  const ctx = { bookId, chapter };
  const ask = (q) => nav.push('BibleChat', { context: ctx, seed: q, send: true });

  const tiles = [
    { label: 'Summarize', sub: 'Key points', icon: 'sparkles', tint: colors.primary, bg: colors.cardIndigo, q: 'Summarize this chapter simply and clearly' },
    { label: 'Plain words', sub: 'Modern', icon: 'chat', tint: colors.gold, bg: colors.cardGold, q: "Explain this passage in today's plain language" },
    { label: 'Meaning', sub: 'Context', icon: 'book', tint: colors.sage, bg: colors.cardSage, q: 'What is the deeper theological meaning here?' },
    { label: 'Apply', sub: 'Daily life', icon: 'heart', tint: colors.rose, bg: colors.cardRose, q: 'How do I apply this to my life today?' },
  ];

  return (
    <Screen
      back
      title={refLabel(bookId, chapter)}
      subtitle={title}
      scroll={false}
      padded={false}
      right={
        verses.length ? (
          <PressScale
            onPress={listen}
            hitSlop={10}
            scaleTo={0.88}
            accessibilityLabel={narHere && nar.playing ? 'Pause narration' : 'Listen to chapter'}
            style={[styles.menuIconCircle, narHere && { backgroundColor: colors.night, borderColor: colors.night }]}
          >
            <Pulse active={!!(narHere && nar.playing)} min={0.9} max={1.1}>
              <Icon name={narHere && nar.playing ? 'pause' : 'headphones'} size={16} color={narHere ? colors.goldLight : colors.fg} />
            </Pulse>
          </PressScale>
        ) : null
      }
    >
      {/* Scripture Text View */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 22, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        <FadeInUp style={styles.readingHeader}>
          <Text style={styles.readingEyebrow}>Holy Scripture · {state.translation}</Text>
          <Text style={styles.readingTitle}>{title}</Text>
          <ScaleIn delay={220} from={0.6} style={styles.ornament}>
            <View style={styles.ornamentLine} />
            <Text style={styles.ornamentStar}>✦</Text>
            <View style={styles.ornamentLine} />
          </ScaleIn>
        </FadeInUp>

        {verses.length ? (
          verses.map((v, i) => (
            // Only the first screenful staggers (FadeInUp caps the delay); later verses arrive with the last of them.
            <FadeInUp key={i} index={i} delay={120} distance={8} duration={360} stagger={40}>
              <Text style={[styles.passageParagraph, narHere && nar.verse === i + 1 && styles.passageActive]}>
                <Text style={styles.verseNumber}>{i + 1}  </Text>
                {v}
              </Text>
            </FadeInUp>
          ))
        ) : (
          <Empty title="Chapter not available" body={`${refLabel(bookId, chapter)} isn’t in your library yet.`} action="Open the Bible" onAction={() => nav.push('Bible', {})} />
        )}
      </ScrollView>

      {/* Study sheet */}
      <FadeInUp delay={180} distance={36} duration={460} style={styles.studySheet}>
        <View style={styles.sheetHandle} />

        <View style={styles.sheetTopRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.sheetStatus}>Study with AI</Text>
            <Text style={styles.sheetHeading} numberOfLines={1}>{refLabel(bookId, chapter)}: {title}</Text>
          </View>
          <PressScale onPress={() => nav.push('Bible', ctx)} scaleTo={0.93} style={styles.openBibleBtn}>
            <Icon name="bible" size={13} color={colors.primary} />
            <Text style={styles.openBibleText}>Full Bible</Text>
          </PressScale>
        </View>

        <View style={styles.sheetTiles}>
          {tiles.map((t, i) => (
            <FadeInUp key={t.label} index={i} delay={320} distance={10} style={{ flex: 1 }}>
              <PressScale
                scaleTo={0.94}
                style={styles.sheetTile}
                onPress={() => ask(t.q)}
                accessibilityLabel={`${t.label}: ${t.sub}`}
              >
                <View style={[styles.tileIconBox, { backgroundColor: t.bg }]}>
                  <Icon name={t.icon} size={16} color={t.tint} />
                </View>
                <Text style={styles.tileTitle} numberOfLines={1}>{t.label}</Text>
                <Text style={styles.tileSub} numberOfLines={1}>{t.sub}</Text>
              </PressScale>
            </FadeInUp>
          ))}
        </View>

        <AskBar placeholder={`Ask about ${refLabel(bookId, chapter)}...`} onSend={ask} />
      </FadeInUp>
    </Screen>
  );
}

// ---------- Bible Chat ----------
// Ask Scripture (the design's AskScripture page). Same conversation logic as before; restyled with src/design/sanctuary.js.
export function BibleChatScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const toast = useToast();
  const nar = useNarration();
  const fresh = Boolean(params.context || params.seed);
  const [context, setContext] = useState(params.context || null);
  const [history, setHistory] = useState(fresh ? [] : state.chatHistory || []);
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState(params.send ? '' : params.seed || ''); // seed text waits in the box until sent
  const scroll = useRef(null);
  const sentSeed = useRef(false);
  const historyRef = useRef(history);
  const threads = state.chatThreads || [];

  // Keep the history in a ref so the async responder never needs a state updater with side effects.
  const commit = (next, persist) => {
    historyRef.current = next;
    setHistory(next);
    if (persist) dispatch({ type: 'chat', history: next });
  };

  // Starting a fresh, seeded conversation keeps the previous one under "Recent conversations".
  useEffect(() => {
    if (fresh && (state.chatHistory || []).length) {
      dispatch({ type: 'set', patch: { chatThreads: [{ id: 't' + Date.now(), history: state.chatHistory }, ...threads].slice(0, 5) } });
    }
  }, []);

  const send = (text) => {
    if (!text.trim()) return;
    commit([...historyRef.current, { id: 'u' + Date.now(), role: 'user', text }], false);
    setTyping(true);
    setTimeout(() => {
      const blocks = answerBibleChat(text, context, state.translation);
      commit([...historyRef.current, { id: 'a' + Date.now(), role: 'assistant', blocks, question: text }], true);
      setTyping(false);
    }, 500);
  };

  const submitDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    send(t);
  };

  const archiveCurrent = () => (historyRef.current.length ? [{ id: 't' + Date.now(), history: historyRef.current }, ...threads].slice(0, 5) : threads);

  const newConversation = () => {
    setMenu(false);
    if (!historyRef.current.length) return toast.show('You’re already in a new conversation', { icon: 'chat' });
    dispatch({ type: 'set', patch: { chatThreads: archiveCurrent() } });
    commit([], true);
    toast.show('Started a new conversation', { icon: 'chat' });
  };

  const deleteConversation = () => {
    setMenu(false);
    const prev = historyRef.current;
    if (!prev.length) return toast.show('Nothing to delete yet', { icon: 'chat' });
    commit([], true);
    toast.show('Conversation deleted', { icon: 'trash', action: { label: 'Undo', onPress: () => commit(prev, true) } });
  };

  const resumeThread = (t) => {
    setMenu(false);
    const rest = threads.filter((x) => x.id !== t.id);
    const cur = historyRef.current.length ? [{ id: 't' + Date.now(), history: historyRef.current }] : [];
    dispatch({ type: 'set', patch: { chatThreads: [...cur, ...rest].slice(0, 5) } });
    commit(t.history || [], true);
    toast.show('Conversation restored', { icon: 'chat' });
  };

  const isSaved = (m) => (state.savedAnswers || []).some((a) => a.msgId === m.id);
  const saveAnswer = (m) => {
    if (isSaved(m)) return toast.show('Already in your library', { icon: 'bookmark', action: { label: 'Library', onPress: () => nav.push('Library') } });
    dispatch({ type: 'saveAnswer', a: { msgId: m.id, question: m.question, blocks: m.blocks, context } });
    toast.show('Answer saved to your library', { icon: 'bookmark', haptic: 'success', action: { label: 'Library', onPress: () => nav.push('Library') } });
  };

  const listen = (m) => {
    const p = answerPassage(m, context);
    if (!p) return toast.show('No passage to read aloud in this answer', { tone: 'error' });
    if (p.verse) nar.playVerse(p.bookId, p.chapter, p.verse, { translation: state.translation });
    else nar.playChapter(p.bookId, p.chapter, { translation: state.translation });
    toast.show(`Listening to ${refLabel(p.bookId, p.chapter, p.verse)}`, { icon: 'headphones', action: { label: 'Player', onPress: () => nar.openPlayer() } });
  };

  const copy = async (m) => {
    if (await copyText(answerText(m))) toast.show('Answer copied', { icon: 'link' });
    else shareText(answerText(m), toast);
  };

  const postToFeed = (m) => {
    const p = answerPassage(m, context);
    dispatch({ type: 'post', post: { kind: 'Study', text: m.blocks.find((b) => b.type === 'Explanation')?.text || m.question, passage: p ? refLabel(p.bookId, p.chapter, p.verse) : undefined } });
    toast.show('Shared to your feed', { icon: 'socials', action: { label: 'View', onPress: () => nav.push('Feed') } });
  };

  useEffect(() => {
    if (params.send && params.seed && !sentSeed.current) {
      sentSeed.current = true;
      send(params.seed);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => scroll.current && scroll.current.scrollToEnd({ animated: true }), 80);
  }, [history.length, typing]);

  const suggested = context
    ? ['Summarize this chapter', "Explain verse 1 in today's language", 'What is the deeper meaning here?', 'What does this word mean in Greek?']
    : ['Which passages discuss peace?', 'What does love mean in original Greek?', 'Why did Jesus say you must be born again?', 'How do translations differ in Psalm 23?'];

  const tint = (t) => BLOCK_TINT[t] || colors.primary;

  return (
    <View style={k.screen}>
      <PageHeader
        back
        onBack={() => nav.pop()}
        title="Ask Scripture"
        subtitle={context ? `Context: ${refLabel(context.bookId, context.chapter, context.verse)}` : 'Bible AI chat'}
        action={(
          <View style={ask.headerActions}>
            <IconButton icon="plus" label="New conversation" onPress={newConversation} />
            <IconButton icon="more-horizontal" label="Conversation options" onPress={() => setMenu(!menu)} />
          </View>
        )}
      />

      {context ? (
        <View style={ask.contextPill}>
          <Icon name="book" size={20} color={d.plumDark} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={ask.contextSmall}>PASSAGE CONTEXT</Text>
            <Text style={ask.contextStrong} numberOfLines={1}>{refLabel(context.bookId, context.chapter, context.verse)} · {state.translation || 'KJV'}</Text>
          </View>
          <Tap onPress={() => { setContext(null); toast.show('Now asking across the whole Bible', { icon: 'book' }); }} accessibilityLabel="Clear passage context" hitSlop={8}>
            <Icon name="x" size={15} color={d.plumDark} />
          </Tap>
        </View>
      ) : null}

      {menu ? <Pressable style={styles.menuBackdrop} onPress={() => setMenu(false)} accessibilityLabel="Close menu" /> : null}
      <Dropdown visible={menu} style={styles.dropdownMenu}>
          <MenuItem icon="plus" label="New conversation" onPress={newConversation} />
          {history.length ? <MenuItem icon="share" label="Share conversation" onPress={() => { setMenu(false); shareText(history.filter((m) => m.role === 'assistant').map(answerText).join('\n\n———\n\n'), toast); }} /> : null}
          {history.length ? <MenuItem icon="trash" label="Delete conversation" onPress={deleteConversation} /> : null}
          {context ? (
            <MenuItem
              icon="book"
              label="Clear passage context"
              onPress={() => { setContext(null); setMenu(false); toast.show('Now asking across the whole Bible', { icon: 'book' }); }}
            />
          ) : null}
          {threads.length ? <Text style={styles.menuSection}>Recent conversations</Text> : null}
          {threads.slice(0, 3).map((t) => (
            <MenuItem
              key={t.id}
              icon="clock"
              label={(t.history.find((m) => m.role === 'user') || {}).text || 'Conversation'}
              onPress={() => resumeThread(t)}
            />
          ))}
          <MenuItem
            icon="shield"
            label="Memory & privacy"
            last
            onPress={() => { nav.push('Profile', { tab: 'Privacy' }); setMenu(false); }}
          />
      </Dropdown>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!history.length ? (
          <View style={ask.empty}>
            <ScaleIn style={ask.sparkBadge} from={0.6}>
              <Pulse min={0.92} max={1.06} duration={1400}>
                <Icon name="sparkles" size={24} color="#FFFFFF" />
              </Pulse>
            </ScaleIn>
            <FadeInUp delay={80} style={{ alignItems: 'center' }}>
              <Text style={ask.emptyTitle}>Ask about Scripture</Text>
              <Text style={ask.emptySub}>
                Answers are cross-referenced with your licensed library, verifying citations before display.
              </Text>
            </FadeInUp>
            <Text style={ask.eyebrow}>Try asking</Text>
            <View style={{ gap: 8, alignSelf: 'stretch' }}>
              {suggested.map((s, i) => (
                <FadeInUp key={s} index={i} delay={180} distance={10}>
                  <Tap onPress={() => send(s)} style={ask.suggest} accessibilityRole="button">
                    <View style={ask.suggestIcon}>
                      <Icon name="sparkles" size={14} color={d.plum} />
                    </View>
                    <Text style={ask.suggestText}>{s}</Text>
                    <Icon name="arrow-right" size={14} color={d.muted} />
                  </Tap>
                </FadeInUp>
              ))}
            </View>
          </View>
        ) : null}

        {history.map((m) =>
          m.role === 'user' ? (
            <SlideInRight key={m.id} style={ask.userRow}>
              <View style={ask.userBubble}>
                <Text style={ask.userText}>{m.text}</Text>
              </View>
            </SlideInRight>
          ) : (
            <View key={m.id} style={{ alignSelf: 'stretch' }}>
              <FadeInUp distance={6} duration={300} style={ask.aiHeader}>
                <View style={ask.aiAvatar}><Icon name="sparkles" size={14} color="#FFFFFF" /></View>
                <Text style={ask.aiName}>Scripture Intelligence</Text>
                <View style={ask.verifiedPill}>
                  <Icon name="check" size={10} color={colors.positive} strokeWidth={2.6} />
                  <Text style={ask.verifiedText}>Citations verified</Text>
                </View>
              </FadeInUp>

              <FadeInUp delay={60} distance={10} duration={340} style={ask.aiCard}>
                {m.blocks.map((b, i) => {
                  const t = tint(b.type);
                  return (
                    // Each answer section settles in after the last, like it is being written.
                    <FadeInUp key={i} index={i} delay={80} stagger={70} distance={8} duration={320} style={[ask.block, i > 0 && ask.blockRule]}>
                      <View style={ask.blockHeadRow}>
                        <View style={[ask.blockHead, { backgroundColor: alpha(t, 0.1) }]}>
                          <Icon name={BLOCK_ICON[b.type] || 'sparkles'} size={11} color={t} strokeWidth={2.2} />
                          <Text style={[ask.blockType, { color: t }]}>{b.type}</Text>
                        </View>
                        {b.source ? <Text style={ask.blockSource} numberOfLines={1}>{b.source}</Text> : null}
                      </View>
                      {b.ref ? (
                        <Tap onPress={() => nav.push('Bible', { bookId: b.bookId, chapter: b.chapter, verse: b.verse })} style={ask.quote}>
                          <Text style={ask.quoteText}>“{b.text}”</Text>
                          <View style={ask.quoteFoot}>
                            <Text style={ask.quoteRef}>{b.ref} · {b.translation}</Text>
                            <View style={ask.quoteLink}>
                              <Text style={ask.quoteLinkText}>Read passage</Text>
                              <Icon name="chevron-right" size={12} color={d.plum} strokeWidth={2.4} />
                            </View>
                          </View>
                        </Tap>
                      ) : (
                        <Text style={ask.blockBody}>{b.text}</Text>
                      )}
                    </FadeInUp>
                  );
                })}
              </FadeInUp>

              <FadeInUp delay={140 + Math.min(m.blocks.length, 10) * 70} distance={6} duration={300}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 8, paddingTop: 10, paddingHorizontal: 18 }}>
                {(() => {
                  const p = answerPassage(m, context);
                  const saved = isSaved(m);
                  return (
                    <>
                      {p ? <AChip icon="book" label="Open passage" onPress={() => nav.push('Bible', p)} /> : null}
                      {p ? <AChip icon="headphones" label="Listen" onPress={() => listen(m)} /> : null}
                      <AChip icon="bookmark" label={saved ? 'Saved' : 'Save answer'} active={saved} onPress={() => saveAnswer(m)} />
                      {p ? <AChip icon="bible" label="Compare translations" onPress={() => nav.push('Bible', { ...p, compare: true })} /> : null}
                      <AChip icon="share" label="Share" onPress={() => shareText(answerText(m), toast)} />
                      <AChip icon="link" label="Copy" onPress={() => copy(m)} />
                      <AChip icon="socials" label="Post to feed" onPress={() => postToFeed(m)} />
                    </>
                  );
                })()}
              </ScrollView>
              </FadeInUp>
            </View>
          )
        )}

        {typing ? (
          <FadeInUp distance={8} duration={260} style={ask.typingRow}>
            <View style={ask.aiAvatar}><Icon name="sparkles" size={14} color="#FFFFFF" /></View>
            <View style={ask.typingCard}>
              <TypingDots />
              <Text style={ask.typingText}>Verifying Scripture references…</Text>
            </View>
          </FadeInUp>
        ) : null}
      </ScrollView>

      {/* .chat-compose */}
      <View style={ask.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitDraft}
          placeholder={context ? 'Ask about this passage...' : 'Ask about Scripture...'}
          placeholderTextColor={d.muted}
          returnKeyType="send"
          style={ask.composerInput}
          accessibilityLabel="Ask Scripture"
        />
        <Tap onPress={submitDraft} disabled={!draft.trim()} style={[ask.sendBtn, !draft.trim() && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel="Send">
          <Icon name="arrow-right" size={16} color="#FFFFFF" />
        </Tap>
      </View>
      <Text style={ask.note}>Answers cite Scripture from your library. Always read in context.</Text>
    </View>
  );
}

// Design chip (action row under each answer)
function AChip({ label, icon, onPress, active }) {
  return (
    <Tap onPress={onPress} accessibilityRole="button" style={[ask.actionChip, active && ask.actionChipOn]}>
      {icon ? <Icon name={active ? 'check' : icon} size={13} color={active ? d.plum : d.muted} /> : null}
      <Text style={[ask.actionChipText, active && { color: d.plum }]}>{label}</Text>
    </Tap>
  );
}

const ask = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8 },
  contextPill: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, padding: 12, borderRadius: 15, backgroundColor: d.lavender },
  contextSmall: { fontFamily: df.sansHeavy, fontSize: 9, letterSpacing: 1, color: d.plumDark },
  contextStrong: { fontFamily: df.sansBold, fontSize: 12, color: d.plumDark, marginTop: 2 },

  empty: { alignItems: 'stretch', paddingTop: 10 },
  sparkBadge: { alignSelf: 'center', width: 56, height: 56, borderRadius: 18, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontFamily: df.displayBold, fontSize: 24, color: d.ink, textAlign: 'center' },
  emptySub: { fontFamily: df.sans, fontSize: 13, lineHeight: 19, color: d.muted, textAlign: 'center', marginTop: 6, paddingHorizontal: 12 },
  eyebrow: { fontFamily: df.sansHeavy, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: d.muted, marginTop: 26, marginBottom: 10 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  suggestIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  suggestText: { flex: 1, fontFamily: df.display, fontSize: 14, lineHeight: 20, color: d.ink },

  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: { maxWidth: '78%', padding: 13, borderRadius: 16, borderBottomRightRadius: 4, backgroundColor: d.ink },
  userText: { fontFamily: df.sans, fontSize: 13.5, lineHeight: 19, color: '#FFFFFF' },

  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  aiAvatar: { width: 30, height: 30, borderRadius: 10, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  aiName: { flex: 1, fontFamily: df.sansBold, fontSize: 12.5, color: d.ink },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: d.sage },
  verifiedText: { fontFamily: df.sansBold, fontSize: 10, color: d.sageDark },
  aiCard: { padding: 16, borderRadius: 18, borderTopLeftRadius: 4, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  block: { paddingVertical: 10 },
  blockRule: { borderTopWidth: 1, borderTopColor: d.line },
  blockHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  blockType: { fontFamily: df.sansHeavy, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase' },
  blockSource: { flex: 1, fontFamily: df.sans, fontSize: 11, color: d.muted },
  blockBody: { fontFamily: df.display, fontSize: 14, lineHeight: 22, color: d.ink, marginTop: 8 },
  quote: { marginTop: 10, padding: 13, borderRadius: 14, backgroundColor: d.ivory, borderWidth: 1, borderColor: d.line },
  quoteText: { fontFamily: df.displayItalic, fontSize: 15, lineHeight: 23, color: d.ink },
  quoteFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  quoteRef: { fontFamily: df.sansBold, fontSize: 11, color: d.muted, flexShrink: 1 },
  quoteLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  quoteLinkText: { fontFamily: df.sansBold, fontSize: 11, color: d.plum },

  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  actionChipOn: { borderColor: d.plum, backgroundColor: colors.primarySoft },
  actionChipText: { fontFamily: df.sansBold, fontSize: 11.5, color: d.muted },

  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  typingCard: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  typingText: { fontFamily: df.sans, fontSize: 12, color: d.muted },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 6, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, borderRadius: 19, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, shadowColor: '#321E12', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  composerInput: { flex: 1, fontFamily: df.sans, fontSize: 14, color: d.ink, paddingVertical: 8 },
  sendBtn: { width: 36, height: 36, borderRadius: 11, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: df.sans, fontSize: 10.5, color: d.muted, textAlign: 'center', marginTop: 8, marginBottom: 12, paddingHorizontal: 18 },
});


// ---------- Scripture Companion ----------
// SCRIPTURE COMPANION (client #6): the live screen is ./CompanionScreen.js (server pipeline, ≥7 validated verses,
// explanations, encouragement, prayer, crisis helplines). App.js still imports CompanionScreen from here.
export { CompanionScreen } from './CompanionScreen';
// Previous local-only version, kept for reference (not routed).
function LegacyCompanionScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const toast = useToast();
  const nar = useNarration();
  const [text, setText] = useState('');
  const [cat, setCat] = useState(null);
  const [result, setResult] = useState(null);
  const [reflection, setReflection] = useState('');

  const run = (msg, category, record = true) => {
    const r = companionResults(category ? `${category}. ${msg}` : msg, state.translation);
    setResult(r);
    if (record) dispatch({ type: 'companion', entry: { when: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), text: msg, cat: category || null, refs: r.passages.map((p) => p.ref) } });
  };

  const submit = () => {
    const msg = (text.trim() || cat || '').trim();
    if (!msg) return;
    run(msg, cat);
  };

  const reopen = (h) => {
    setText(h.text);
    setCat(h.cat || null);
    run(h.text, h.cat || null, false);
  };

  const isSaved = (p) => state.bookmarks.some((b) => b.bookId === p.bookId && b.chapter === p.chapter && (b.verse || null) === (p.verses[0] || null));
  const toggleSave = (p) => {
    const saved = isSaved(p);
    dispatch({ type: 'bookmark', b: { bookId: p.bookId, chapter: p.chapter, verse: p.verses[0], folder: 'Scripture Companion' } });
    toast.show(saved ? `${p.ref} removed from bookmarks` : `${p.ref} saved to bookmarks`, {
      icon: 'bookmark',
      haptic: saved ? 'select' : 'success',
      action: saved ? undefined : { label: 'Library', onPress: () => nav.push('Library') },
    });
  };

  const listen = (p) => {
    if (p.verses.length > 1) nar.playChapter(p.bookId, p.chapter, { translation: state.translation, fromVerse: p.verses[0] });
    else nar.playVerse(p.bookId, p.chapter, p.verses[0], { translation: state.translation });
    toast.show(`Listening to ${p.ref}`, { icon: 'headphones', action: { label: 'Player', onPress: () => nar.openPlayer() } });
  };

  // What the person shared (shown back as their message in the conversation)
  const shared = (text.trim() || cat || '').trim();

  return (
    <Screen back title="Scripture Companion" subtitle="Private · confidential · comforting">
      {!result ? (
        <View key="compose">
          <View style={styles.companionHero}>
            <ScaleIn from={0.6} style={styles.companionIcon}>
              <Icon name="prayer" size={22} color={colors.goldLight} />
            </ScaleIn>
            <FadeInUp delay={80} style={{ alignItems: 'center' }}>
              <Text style={styles.companionTitle}>What is on your heart?</Text>
              <Text style={styles.companionSub}>
                Express your feelings honestly. We will find comforting, truth-filled Scripture tailored for you.
              </Text>
            </FadeInUp>
          </View>

          <FadeInUp index={2} delay={60} style={styles.composeCard}>
            <Input
              multiline
              placeholder="I have been feeling anxious about..."
              value={text}
              onChangeText={setText}
              style={styles.composeInput}
            />
            <View style={styles.composeRule} />
            <Text style={[styles.eyebrow, { color: colors.muted, marginBottom: 10 }]}>Or choose a theme</Text>
            <View style={styles.themeWrap}>
              {COMPANION_CATEGORIES.map((c) => (
                <Pill key={c} small label={c} active={cat === c} onPress={() => setCat(cat === c ? null : c)} />
              ))}
            </View>
          </FadeInUp>

          <FadeInUp index={3} delay={60}>
            <Button
              label="Seek Scripture"
              onPress={submit}
              style={{ marginTop: 16 }}
              disabled={!text.trim() && !cat}
              icon={<Icon name="sparkles" size={15} color={colors.primaryFg} />}
            />

            <View style={styles.privacyLine}>
              <Icon name="shield" size={13} color={colors.faint} />
              <Text style={styles.privacyText}>Only you can see what you share here.</Text>
            </View>
          </FadeInUp>

          {state.companionHistory.length ? (
            <Section title="Your private reflections">
              {state.companionHistory.map((h, i) => (
                <FadeInUp key={i} index={4 + i} delay={60} distance={10}>
                  <Row
                    title={h.text}
                    subtitle={(h.refs || []).join(' · ')}
                    right={h.when}
                    left={<Icon name="bookmark" size={16} color={colors.gold} />}
                    onPress={() => reopen(h)}
                  />
                </FadeInUp>
              ))}
            </Section>
          ) : null}
        </View>
      ) : (
        <View key="result" style={{ gap: 16 }}>
          {shared ? (
            <SlideInRight style={[styles.userRow, { marginTop: 6 }]}>
              <View style={styles.userBubble}>
                <Text style={styles.userText}>{shared}{cat && text.trim() ? `  ·  ${cat}` : ''}</Text>
              </View>
            </SlideInRight>
          ) : null}

          {result.crisis ? (
            <FadeInUp delay={120} style={styles.crisis}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="heart" size={16} color={colors.negative} />
                <Text style={styles.crisisTitle}>You matter deeply. Please reach out.</Text>
              </View>
              <Text style={styles.crisisText}>
                If you are in immediate danger, call your local emergency number now. You can also reach a free, confidential crisis line (988 in the US). This app does not replace professional care.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <Button small label="Talk to a qualified person" onPress={() => nav.push('Care', { preselect: 'I need someone to talk to' })} />
                <Button
                  small
                  kind="ghost"
                  label="Find a crisis line"
                  icon={<Icon name="globe" size={13} color={colors.fg} />}
                  onPress={() => Linking.openURL('https://findahelpline.com').catch(() => toast.show('Couldn’t open the helpline directory', { tone: 'error' }))}
                />
              </View>
            </FadeInUp>
          ) : null}

          <FadeInUp index={1} delay={160} style={styles.aiWrap}>
            <View style={styles.aiHeader}>
              <AssistantAvatar />
              <Text style={styles.aiName}>Scripture Companion</Text>
            </View>
            <View style={styles.ackBubble}>
              <Text style={styles.ackText}>{result.acknowledgment}</Text>
            </View>
          </FadeInUp>

          {result.passages.map((p, pi) => (
            <FadeInUp key={p.ref} index={2 + pi} delay={160} stagger={120} distance={16} style={styles.passageCard}>
              <View style={styles.blockHeadRow}>
                <View style={[styles.blockHead, { backgroundColor: alpha(colors.gold, 0.12) }]}>
                  <Icon name="bible" size={11} color={colors.gold} strokeWidth={2.2} />
                  <Text style={[styles.blockType, { color: colors.gold }]}>{p.ref}</Text>
                </View>
                <Text style={styles.blockSource}>{p.translation}</Text>
                <PressScale onPress={() => listen(p)} accessibilityLabel={`Listen to ${p.ref}`} hitSlop={6} scaleTo={0.88} style={styles.iconBtn}>
                  <Icon name="headphones" size={15} color={colors.fg} />
                </PressScale>
                <PressScale
                  onPress={() => shareText(`“${p.text}” — ${p.ref} (${p.translation})`, toast)}
                  accessibilityLabel={`Share ${p.ref}`}
                  hitSlop={6}
                  scaleTo={0.88}
                  style={styles.iconBtn}
                >
                  <Icon name="share" size={15} color={colors.fg} />
                </PressScale>
              </View>
              <Text style={styles.passageScripture}>“{p.text}”</Text>
              <View style={styles.whyBox}>
                <Text style={styles.whyLabel}>Why this passage</Text>
                <Text style={styles.passageWhy}>{p.why}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <Button
                  small
                  kind="ghost"
                  label="Read in context"
                  style={{ flex: 1 }}
                  icon={<Icon name="book" size={13} color={colors.fg} />}
                  onPress={() => nav.push('Bible', { bookId: p.bookId, chapter: p.chapter, verse: p.verses[0] })}
                />
                <Pop trigger={isSaved(p)} amount={1.06} style={{ flex: 1 }}>
                  <Button
                    small
                    kind={isSaved(p) ? 'primary' : 'ghost'}
                    label={isSaved(p) ? 'Saved' : 'Save'}
                    icon={<Icon name={isSaved(p) ? 'check' : 'bookmark'} size={13} color={isSaved(p) ? colors.primaryFg : colors.fg} />}
                    onPress={() => toggleSave(p)}
                  />
                </Pop>
              </View>
            </FadeInUp>
          ))}

          <FadeInUp index={2 + result.passages.length} delay={160} stagger={120}>
          <Section title="Personal reflection" style={{ marginTop: 10 }}>
            <View style={styles.reflectCard}>
              {result.reflections.map((r, i) => (
                <View key={r} style={styles.reflectRow}>
                  <Text style={styles.reflectNum}>{i + 1}</Text>
                  <Text style={styles.reflect}>{r}</Text>
                </View>
              ))}
              <Input
                multiline
                placeholder="Write a private note to God..."
                value={reflection}
                onChangeText={setReflection}
                style={styles.reflectInput}
              />
              {reflection.trim() ? (
                <ScaleIn style={{ alignSelf: 'flex-start' }} from={0.9}>
                <Button
                  small
                  label="Save reflection"
                  style={{ alignSelf: 'flex-start', marginTop: 10 }}
                  onPress={() => {
                    const first = result.passages[0];
                    dispatch({
                      type: 'note',
                      n: first
                        ? { bookId: first.bookId, chapter: first.chapter, verse: first.verses[0], text: reflection.trim() }
                        : { bookId: 'PSA', chapter: 23, verse: 1, text: reflection.trim() },
                    });
                    setReflection('');
                    toast.show('Reflection saved privately', { icon: 'highlight', haptic: 'success', action: { label: 'Library', onPress: () => nav.push('Library') } });
                  }}
                />
                </ScaleIn>
              ) : null}
            </View>
          </Section>
          </FadeInUp>

          <FadeInUp index={3 + result.passages.length} delay={160} stagger={120}>
          <Section title="Next steps" style={{ marginTop: 6 }}>
            <Row
              title="Continue in Bible Chat"
              subtitle="Ask follow-up questions about these passages"
              left={<Icon name="sparkles" size={17} color={colors.primary} />}
              right={<Icon name="chevron-right" size={14} color={colors.faint} />}
              onPress={() => nav.push('BibleChat', result.passages[0] ? { context: { bookId: result.passages[0].bookId, chapter: result.passages[0].chapter }, seed: 'How do I apply this to my life today?', send: true } : {})}
            />
            <Row
              title="Ask others to pray"
              subtitle="Share a request on the Prayer Wall"
              left={<Icon name="prayer" size={17} color={colors.gold} />}
              right={<Icon name="chevron-right" size={14} color={colors.faint} />}
              onPress={() => nav.push('NewPrayer', result.passages[0] ? { verse: result.passages[0].ref } : {})}
            />
            <Row
              title="Talk to a trusted person"
              subtitle="Pastors, mentors and counselors"
              left={<Icon name="users" size={17} color={colors.sage} />}
              right={<Icon name="chevron-right" size={14} color={colors.faint} />}
              onPress={() => nav.push('Care', { preselect: 'I need someone to talk to' })}
            />
          </Section>
          </FadeInUp>

          <Button kind="ghost" label="Start over" onPress={() => { setResult(null); setText(''); setCat(null); setReflection(''); }} style={{ marginTop: 6 }} />
        </View>
      )}
    </Screen>
  );
}

const EYEBROW = { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' };

const styles = StyleSheet.create({
  eyebrow: { ...EYEBROW, color: colors.gold },

  // ---- God Mode home
  greet: { marginTop: 10, marginBottom: 4 },
  homeTitle: { fontFamily: fonts.serifBold, fontSize: 27, lineHeight: 33, color: colors.fg, letterSpacing: -0.5, marginTop: 6 },
  homeSub: { fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 8 },
  grid: { marginTop: 22, gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
  suggestionsContainer: { marginTop: 26 },
  suggestionChip: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionChipText: { fontSize: 13, fontWeight: '500', color: colors.fg },
  resumeChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  resumeChatText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  askSection: { marginTop: 18, paddingBottom: 10 },

  // ---- Reading
  readingHeader: { alignItems: 'center', marginBottom: 22 },
  readingEyebrow: { ...EYEBROW, letterSpacing: 2, color: colors.gold },
  readingTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.4,
    color: colors.fg,
    marginTop: 8,
    textAlign: 'center',
  },
  ornament: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  ornamentLine: { width: 40, height: 1, backgroundColor: colors.borderStrong },
  ornamentStar: { fontSize: 10, color: colors.gold },
  passageParagraph: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 28, color: colors.passage, marginBottom: 12 },
  passageActive: { backgroundColor: alpha(colors.gold, 0.14), borderRadius: 6 },
  verseNumber: { fontSize: 10.5, color: colors.gold, fontWeight: '700' },
  studySheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    ...shadow.lg,
  },
  sheetHandle: { width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: 12 },
  sheetTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  sheetStatus: { ...EYEBROW, color: colors.gold },
  sheetHeading: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg, marginTop: 2, letterSpacing: -0.2 },
  openBibleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
  },
  openBibleText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  sheetTiles: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  sheetTile: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 11,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  tileIconBox: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  tileTitle: { fontSize: 12, fontWeight: '700', color: colors.fg, textAlign: 'center' },
  tileSub: { fontSize: 10, color: colors.faint, textAlign: 'center', marginTop: 2 },

  // ---- Chat chrome
  menuIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  menuDots: { color: colors.fg, fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  dropdownMenu: {
    position: 'absolute',
    right: 14,
    top: 6,
    zIndex: 10,
    width: 228,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 4,
    ...shadow.md,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
  menuItemRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  menuItemText: { flex: 1, color: colors.fg, fontSize: 14, fontWeight: '500' },

  // ---- Chat empty state
  chatEmpty: { alignItems: 'center', marginTop: 18 },
  chatSparkBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  chatEmptyTitle: { fontFamily: fonts.serifBold, fontSize: 25, letterSpacing: -0.4, color: colors.fg, marginTop: 14 },
  chatEmptySub: { fontSize: 13.5, color: colors.muted, textAlign: 'center', lineHeight: 19.5, maxWidth: 300, marginTop: 6 },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  contextChipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  suggestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    ...shadow.sm,
  },
  suggestIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  suggestText: { flex: 1, color: colors.fg, fontSize: 14, fontWeight: '500', lineHeight: 19 },

  // ---- Messages
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    paddingHorizontal: 15,
    paddingVertical: 10,
    maxWidth: '84%',
    ...shadow.sm,
  },
  userText: { color: colors.primaryFg, fontSize: 14.5, lineHeight: 20.5 },
  aiWrap: { alignSelf: 'stretch' },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiAvatar: { backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  aiName: { fontSize: 12.5, fontWeight: '700', color: colors.fg },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.positiveFaint,
  },
  verifiedText: { fontSize: 10.5, fontWeight: '600', color: colors.positive },
  aiCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderTopLeftRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 4,
    ...shadow.sm,
  },
  blockContainer: { paddingVertical: 14, gap: 9 },
  blockRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  blockHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  blockType: { fontSize: 10, letterSpacing: 1, fontWeight: '700', textTransform: 'uppercase' },
  blockSource: { flex: 1, fontSize: 11.5, color: colors.faint },
  blockBodyText: { color: colors.passage, fontSize: 14.5, lineHeight: 21.5 },
  quoteBox: {
    backgroundColor: colors.screen,
    borderLeftWidth: 3,
    borderLeftColor: colors.goldLight,
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  quoteText: { fontFamily: fonts.serifItalic, color: colors.passage, fontSize: 15.5, lineHeight: 23 },
  quoteFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 },
  quoteRef: { flexShrink: 1, color: colors.gold, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.2 },
  quoteLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  quoteLinkText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionChipText: { fontSize: 12, fontWeight: '600', color: colors.fg },
  actionChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  menuBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 9 },
  menuSection: { ...EYEBROW, fontSize: 9.5, color: colors.faint, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typingDots: { flexDirection: 'row', gap: 4 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold },
  typingText: { color: colors.muted, fontSize: 12.5 },
  composer: {
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 8,
    backgroundColor: colors.screen,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composerNote: { fontSize: 10.5, color: colors.faint, textAlign: 'center', marginTop: -2 },

  // ---- Companion
  companionHero: { alignItems: 'center', marginTop: 12 },
  companionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  companionTitle: { fontFamily: fonts.serifBold, fontSize: 27, letterSpacing: -0.5, color: colors.fg, marginTop: 14, textAlign: 'center' },
  companionSub: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 310, marginTop: 6 },
  composeCard: {
    marginTop: 22,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    ...shadow.sm,
  },
  composeInput: {
    borderWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: 4,
    minHeight: 104,
    fontSize: 15,
    lineHeight: 21,
    backgroundColor: 'transparent',
  },
  composeRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: 12 },
  themeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  privacyLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 },
  privacyText: { fontSize: 12, color: colors.faint },
  crisis: {
    backgroundColor: colors.cardRose,
    borderWidth: 1,
    borderColor: alpha(colors.negative, 0.25),
    borderRadius: radius.lg,
    padding: 16,
  },
  crisisTitle: { color: colors.negative, fontWeight: '700', fontSize: 14.5 },
  crisisText: { color: colors.passage, fontSize: 13, lineHeight: 19, marginTop: 6 },
  ackBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderTopLeftRadius: 6,
    padding: 15,
    ...shadow.sm,
  },
  ackText: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, color: colors.passage },
  passageCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    ...shadow.sm,
  },
  passageScripture: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, color: colors.passage, marginTop: 12 },
  whyBox: { marginTop: 12, padding: 12, borderRadius: radius.sm, backgroundColor: colors.screen },
  whyLabel: { ...EYEBROW, fontSize: 9.5, color: colors.muted, marginBottom: 4 },
  passageWhy: { fontSize: 13, color: colors.muted, lineHeight: 18.5 },
  reflectCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    ...shadow.sm,
  },
  reflectRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  reflectNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.cardGold,
    color: colors.gold,
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 22,
    overflow: 'hidden',
  },
  reflect: { flex: 1, fontFamily: fonts.serifItalic, fontSize: 15, color: colors.passage, lineHeight: 21 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
  },
  reflectInput: { marginTop: 6, minHeight: 84, backgroundColor: colors.screen },
});
