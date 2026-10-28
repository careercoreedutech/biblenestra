import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import { Screen, Section, Row, Pills, Pill, Button, Tag, Badge, Notice, Input, Empty } from '../components/ui';
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { answerBibleChat, companionResults } from '../data/assistant';
import { getChapter, refLabel, CHAPTER_TITLES } from '../data/bible';
import { COMPANION_CATEGORIES } from '../data/seed';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
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
        <Text style={styles.h1}>{greeting()}, {state.user.displayName}</Text>
        <Text style={styles.sub}>Seek wisdom, examine context, and deepen your understanding of Scripture.</Text>
      </View>

      {/* Pathways Grid */}
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <Card
            title={'Pastoral\nGuidance'}
            subtitle="Comfort, anxiety, and prayerful direction."
            color={colors.gold}
            icon="🕊"
            onPress={() => nav.push('Companion')}
          />
          <Card
            title={'Theological\nInquiry'}
            subtitle="What does Scripture teach about..."
            color={colors.lavender}
            icon="✦"
            onPress={() => nav.push('BibleChat', { seed: 'Which passages discuss ' })}
          />
        </View>
        <View style={styles.gridRow}>
          <Card
            title={'Guided\nExegesis'}
            subtitle="Chapter study with contextual AI."
            color={colors.teal}
            icon="📖"
            onPress={() => nav.push('Reading', lp)}
          />
          <Card
            title={'Difficult\nPassages'}
            subtitle="Tensions, history, and apologetics."
            color={colors.amber}
            icon="⚖"
            onPress={() => nav.push('BibleChat', { seed: 'Why ' })}
          />
        </View>
      </View>

      {/* Quick suggestions */}
      <View style={styles.suggestionsContainer}>
        <Text style={styles.quickPromptTitle}>EXPLORATION TOPICS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
          {['Peace in anxiety', 'Forgiving when hurt', 'Who is the Holy Spirit?', 'Romans 8 walk-through'].map((item) => (
            <Pressable
              key={item}
              style={styles.suggestionChip}
              onPress={() => nav.push('BibleChat', { seed: item, send: true })}
            >
              <Text style={styles.suggestionChipText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {state.chatHistory.length ? (
        <Pressable onPress={() => nav.push('BibleChat', {})} style={styles.resumeChat}>
          <Text style={styles.resumeChatText}>Continue previous conversation ›</Text>
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
export function ReadingScreen({ params }) {
  const nav = useNav();
  const { state } = useStore();
  const bookId = params.bookId || 'MAT';
  const chapter = params.chapter || 1;
  const verses = getChapter(state.translation, bookId, chapter) || getChapter('KJV', bookId, chapter) || [];
  const title = CHAPTER_TITLES[`${bookId}:${chapter}`] || refLabel(bookId, chapter);
  const ctx = { bookId, chapter };
  const ask = (q) => nav.push('BibleChat', { context: ctx, seed: q, send: true });

  return (
    <Screen back title={refLabel(bookId, chapter)} subtitle={title} scroll={false} padded={false}>
      {/* Scripture Text View */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.readingHeader}>
          <Text style={styles.readingEyebrow}>HOLY SCRIPTURE · {state.translation}</Text>
          <Text style={styles.readingTitle}>{title}</Text>
          <View style={styles.readingDivider} />
        </View>

        {verses.map((v, i) => (
          <Text key={i} style={styles.passageParagraph}>
            <Text style={styles.verseNumber}>{i + 1} </Text>
            {v}
          </Text>
        ))}
      </ScrollView>

      {/* Flat Bottom Sheet */}
      <View style={styles.glassSheet}>

        <View style={styles.sheetHandle} />

        <View style={styles.sheetTopRow}>
          <View>
            <Text style={styles.sheetStatus}>CURRENT PASSAGE</Text>
            <Text style={styles.sheetHeading}>{refLabel(bookId, chapter)}: {title}</Text>
          </View>
          <Pressable onPress={() => nav.push('Bible', ctx)} style={styles.openBibleBtn}>
            <Text style={styles.openBibleText}>Full Bible ›</Text>
          </Pressable>
        </View>

        {/* 4 Clean Ergonomic Action Tiles */}
        <View style={styles.sheetTiles}>
          <Pressable style={styles.sheetTile} onPress={() => ask('Summarize this chapter simply and clearly')}>
            <Text style={[styles.tileIcon, { color: colors.teal }]}>✦</Text>
            <Text style={styles.tileTitle}>Summarize</Text>
            <Text style={styles.tileSub}>Key takeaways</Text>
          </Pressable>

          <Pressable style={styles.sheetTile} onPress={() => ask("Explain this passage in today's plain language")}>
            <Text style={[styles.tileIcon, { color: colors.gold }]}>💬</Text>
            <Text style={styles.tileTitle}>Plain Language</Text>
            <Text style={styles.tileSub}>Modern words</Text>
          </Pressable>

          <Pressable style={styles.sheetTile} onPress={() => ask('What is the deeper theological meaning here?')}>
            <Text style={[styles.tileIcon, { color: colors.lavender }]}>⚖</Text>
            <Text style={styles.tileTitle}>Deep Meaning</Text>
            <Text style={styles.tileSub}>Historical context</Text>
          </Pressable>

          <Pressable style={styles.sheetTile} onPress={() => ask('How do I apply this to my life today?')}>
            <Text style={[styles.tileIcon, { color: colors.amber }]}>🌱</Text>
            <Text style={styles.tileTitle}>Apply to Life</Text>
            <Text style={styles.tileSub}>Daily practice</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 12 }}>
          <AskBar placeholder={`Ask about ${refLabel(bookId, chapter)}...`} onSend={ask} />
        </View>
      </View>
    </Screen>
  );
}

// ---------- Bible Chat ----------
export function BibleChatScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [context, setContext] = useState(params.context || null);
  const [history, setHistory] = useState(params.context || params.seed ? [] : state.chatHistory);
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  const scroll = useRef(null);
  const sentSeed = useRef(false);

  const send = (text) => {
    if (!text.trim()) return;
    const userMsg = { id: 'u' + Date.now(), role: 'user', text };
    setHistory((h) => [...h, userMsg]);
    setTyping(true);
    setTimeout(() => {
      const blocks = answerBibleChat(text, context, state.translation);
      setHistory((h) => {
        const next = [...h, { id: 'a' + Date.now(), role: 'assistant', blocks, question: text }];
        dispatch({ type: 'chat', history: next });
        return next;
      });
      setTyping(false);
    }, 500);
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

  const tint = (t) => ({ Scripture: colors.teal, Explanation: colors.fg, Commentary: colors.gold, Interpretations: colors.lavender, 'Further study': colors.yellow }[t] || colors.fg);

  return (
    <Screen
      back
      title="Bible Intelligence"
      subtitle={context ? `Context: ${refLabel(context.bookId, context.chapter, context.verse)}` : 'Full Bible Study'}
      scroll={false}
      padded={false}
      right={
        <Pressable onPress={() => setMenu(!menu)} hitSlop={12} style={styles.menuIconCircle}>
          <Text style={{ color: colors.fg, fontSize: 16 }}>⋯</Text>
        </Pressable>
      }
    >
      {menu ? (
        <View style={styles.dropdownMenu}>
          <Pressable onPress={() => { setHistory([]); dispatch({ type: 'chat', history: [] }); setMenu(false); }}>
            <Text style={styles.dropdownItem}>New conversation</Text>
          </Pressable>
          <Pressable onPress={() => { setContext(null); setMenu(false); }}>
            <Text style={styles.dropdownItem}>Clear passage context</Text>
          </Pressable>
          <Pressable onPress={() => { nav.push('Profile', { tab: 'Privacy' }); setMenu(false); }}>
            <Text style={styles.dropdownItem}>Memory & privacy</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 18, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!history.length ? (
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <View style={styles.chatSparkBadge}>
              <Text style={{ fontSize: 22, color: colors.gold }}>✦</Text>
            </View>
            <Text style={styles.chatEmptyTitle}>Ask About Scripture</Text>
            <Text style={styles.chatEmptySub}>
              Answers are cross-referenced with your licensed library, verifying citations before display.
            </Text>
            <View style={{ marginTop: 20, gap: 8, alignSelf: 'stretch' }}>
              {suggested.map((s) => (
                <Pressable key={s} onPress={() => send(s)} style={styles.suggestCard}>
                  <Text style={styles.suggestText}>✦ {s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {history.map((m) =>
          m.role === 'user' ? (
            <View key={m.id} style={styles.userBubble}>
              <Text style={styles.userText}>{m.text}</Text>
            </View>
          ) : (
            <View key={m.id} style={styles.aiCard}>
              <View style={styles.aiCardHeader}>
                <Text style={styles.aiBadge}>✦ SCRIPTURE EXEGESIS</Text>
              </View>

              {m.blocks.map((b, i) => (
                <View key={i} style={styles.blockContainer}>
                  <Text style={[styles.blockType, { color: tint(b.type) }]}>
                    {b.type.toUpperCase()}{b.source ? ' · ' + b.source : ''}
                  </Text>
                  {b.ref ? (
                    <Pressable
                      onPress={() => nav.push('Bible', { bookId: b.bookId, chapter: b.chapter, verse: b.verse })}
                      style={styles.quoteBox}
                    >
                      <Text style={styles.quoteText}>"{b.text}"</Text>
                      <Text style={styles.quoteRef}>{b.ref} · {b.translation} · Read passage ›</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.blockBodyText}>{b.text}</Text>
                  )}
                </View>
              ))}

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
                {context ? <Pill small label="Open passage" onPress={() => nav.push('Bible', context)} /> : null}
                <Pill small label="Save answer" onPress={() => dispatch({ type: 'saveAnswer', a: { question: m.question, blocks: m.blocks } })} />
                <Pill small label="Compare translations" onPress={() => nav.push('Bible', { ...(context || { bookId: 'JHN', chapter: 3 }) })} />
                <Pill small label="Share excerpt" onPress={() => dispatch({ type: 'post', post: { kind: 'Study', text: m.blocks.find((b) => b.type === 'Explanation')?.text || m.question } })} />
              </ScrollView>
            </View>
          )
        )}

        {typing ? (
          <View style={styles.typingCard}>
            <Text style={{ color: colors.gold, fontFamily: fonts.sansMedium, fontSize: 12 }}>
              ✦ Verifying Scripture references…
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ padding: 14, paddingTop: 4 }}>
        <AskBar
          placeholder={context ? 'Ask about this passage...' : 'Ask about Scripture...'}
          onSend={send}
          initial={params.send ? '' : params.seed}
        />
      </View>
    </Screen>
  );
}

// ---------- Scripture Companion ----------
export function CompanionScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [text, setText] = useState('');
  const [cat, setCat] = useState(null);
  const [result, setResult] = useState(null);
  const [reflection, setReflection] = useState('');

  const submit = () => {
    const msg = (text.trim() || cat || '').trim();
    if (!msg) return;
    const r = companionResults(cat ? `${cat}. ${msg}` : msg, state.translation);
    setResult(r);
    dispatch({ type: 'companion', entry: { when: 'Now', text: msg, refs: r.passages.map((p) => p.ref) } });
  };

  return (
    <Screen back title="Scripture Companion" subtitle="Private · confidential · comforting">
      {!result ? (
        <View>
          <View style={{ alignItems: 'center', marginTop: 14 }}>
            <View style={styles.chatSparkBadge}>
              <Text style={{ fontSize: 20, color: colors.teal }}>🕊</Text>
            </View>
            <Text style={styles.h1}>What is on your heart?</Text>
            <Text style={[styles.sub, { maxWidth: 300 }]}>
              Express your feelings honestly. We will find comforting, truth-filled Scripture tailored for you.
            </Text>
          </View>

          <Input
            multiline
            placeholder="I have been feeling anxious about..."
            value={text}
            onChangeText={setText}
            style={{ marginTop: 18, minHeight: 110 }}
          />

          <Pills
            small
            items={COMPANION_CATEGORIES}
            value={cat}
            onChange={(c) => setCat(cat === c ? null : c)}
            style={{ marginTop: 10 }}
            tint={colors.teal}
          />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Button
              label="Seek Scripture"
              onPress={submit}
              style={{ flex: 1 }}
              disabled={!text.trim() && !cat}
            />
          </View>

          {state.companionHistory.length ? (
            <Section title="Your private reflections">
              {state.companionHistory.map((h, i) => (
                <Row key={i} title={h.text} subtitle={h.refs.join(' · ')} right={h.when} />
              ))}
            </Section>
          ) : null}
        </View>
      ) : (
        <View>
          {result.crisis ? (
            <View style={styles.crisis}>
              <Text style={styles.crisisTitle}>You matter deeply. Please reach out.</Text>
              <Text style={styles.crisisText}>
                If you are in immediate danger or distress, contact your local emergency service or 988. This app does not replace professional care.
              </Text>
              <Button small label="Talk to a qualified person" onPress={() => nav.push('Care')} style={{ marginTop: 10 }} />
            </View>
          ) : null}

          <View style={styles.acknowledgmentCard}>
            <Text style={styles.ackText}>{result.acknowledgment}</Text>
          </View>

          {result.passages.map((p) => (
            <View key={p.ref} style={styles.passageCard}>
              <Text style={styles.passageRef}>✦ {p.ref} ({p.translation})</Text>
              <Text style={styles.passageScripture}>"{p.text}"</Text>
              <Text style={styles.passageWhy}>{p.why}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button small kind="ghost" label="Read in context" onPress={() => nav.push('Bible', { bookId: p.bookId, chapter: p.chapter, verse: p.verses[0] })} />
                <Button small kind="ghost" label="Save bookmark" onPress={() => dispatch({ type: 'bookmark', b: { bookId: p.bookId, chapter: p.chapter, verse: p.verses[0], folder: 'Scripture Companion' } })} />
              </View>
            </View>
          ))}

          <Section title="Personal Reflection">
            {result.reflections.map((r) => (
              <Text key={r} style={styles.reflect}>· {r}</Text>
            ))}
            <Input
              multiline
              placeholder="Write a private note to God..."
              value={reflection}
              onChangeText={setReflection}
              style={{ marginTop: 10, minHeight: 70 }}
            />
            {reflection.trim() ? (
              <Button
                small
                label="Save reflection"
                style={{ alignSelf: 'flex-start', marginTop: 8 }}
                onPress={() => {
                  dispatch({
                    type: 'note',
                    n: {
                      bookId: result.passages[0].bookId,
                      chapter: result.passages[0].chapter,
                      verse: result.passages[0].verses[0],
                      text: reflection.trim(),
                    },
                  });
                  setReflection('');
                }}
              />
            ) : null}
          </Section>

          <Button kind="ghost" label="Start over" onPress={() => { setResult(null); setText(''); setCat(null); }} style={{ marginTop: 20 }} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  greet: {
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 8,
  },
  divinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(229, 184, 105, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.3)',
    marginBottom: 10,
  },
  divineSpark: {
    color: colors.gold,
    fontSize: 10,
  },
  divineText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    color: colors.gold,
    letterSpacing: 1.5,
  },
  h1: {
    fontFamily: fonts.serifBold,
    fontSize: 25,
    color: colors.fg,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 290,
  },
  grid: {
    marginTop: 20,
    gap: 12,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  suggestionsContainer: {
    marginTop: 22,
  },
  quickPromptTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 8,
  },
  suggestionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: colors.lineLight,
  },
  suggestionChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.fg,
  },
  resumeChat: {
    alignSelf: 'center',
    marginTop: 18,
  },
  resumeChatText: {
    fontFamily: fonts.sansMedium,
    color: colors.gold,
    fontSize: 12,
  },
  askSection: {
    marginTop: 20,
    paddingBottom: 10,
  },
  readingHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  readingEyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.gold,
  },
  readingTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 22,
    color: colors.fg,
    marginTop: 6,
    textAlign: 'center',
  },
  readingDivider: {
    width: 40,
    height: 1,
    backgroundColor: colors.lineLight,
    marginTop: 12,
  },
  passageParagraph: {
    fontFamily: fonts.serif,
    fontSize: 16.5,
    lineHeight: 27,
    color: colors.passage,
    marginBottom: 14,
  },
  verseNumber: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    color: colors.gold,
    fontWeight: '700',
  },
  glassSheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  sheetHandle: {
    width: 32,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetStatus: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.gold,
  },
  sheetHeading: {
    fontFamily: fonts.serifBold,
    fontSize: 15,
    color: colors.fg,
    marginTop: 2,
  },
  openBibleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  openBibleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.gold,
  },
  sheetTiles: {
    flexDirection: 'row',
    gap: 8,
  },
  sheetTile: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: colors.lineLight,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tileIcon: {
    fontSize: 14,
    marginBottom: 4,
  },
  tileTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '700',
    color: colors.fg,
    textAlign: 'center',
  },
  tileSub: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 2,
  },
  menuIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownMenu: {
    position: 'absolute',
    right: 16,
    top: 50,
    zIndex: 10,
    backgroundColor: '#201a16',
    borderWidth: 1,
    borderColor: colors.glossBorder,
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  dropdownItem: {
    fontFamily: fonts.sans,
    color: colors.fg,
    fontSize: 13,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chatSparkBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(229, 184, 105, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatEmptyTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    color: colors.fg,
    marginTop: 10,
  },
  chatEmptySub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 290,
    marginTop: 4,
  },
  suggestCard: {
    backgroundColor: '#1e1814',
    borderWidth: 1,
    borderColor: colors.lineLight,
    borderRadius: 14,
    padding: 12,
  },
  suggestText: {
    fontFamily: fonts.sansMedium,
    color: colors.fg,
    fontSize: 13,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    borderBottomRightRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  userText: {
    fontFamily: fonts.sans,
    color: colors.fg,
    fontSize: 14,
    lineHeight: 20,
  },
  aiCard: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    borderBottomLeftRadius: 2,
    padding: 14,
    maxWidth: '96%',
    gap: 10,
  },
  aiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiBadge: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    letterSpacing: 1.5,
    color: colors.gold,
    fontWeight: '700',
  },
  blockContainer: {
    gap: 4,
  },
  blockType: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  blockBodyText: {
    fontFamily: fonts.sans,
    color: colors.passage,
    fontSize: 13.5,
    lineHeight: 20,
  },
  quoteBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderLeftWidth: 3,
    borderLeftColor: colors.teal,
    paddingLeft: 10,
    paddingVertical: 4,
    marginVertical: 4,
  },
  quoteText: {
    fontFamily: fonts.serif,
    color: colors.fg,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  quoteRef: {
    fontFamily: fonts.sansMedium,
    color: colors.teal,
    fontSize: 11,
    marginTop: 4,
  },
  typingCard: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  crisis: {
    backgroundColor: '#351818',
    borderWidth: 1,
    borderColor: '#802e2e',
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  crisisTitle: {
    fontFamily: fonts.sansMedium,
    color: '#ff9999',
    fontWeight: '700',
    fontSize: 14,
  },
  crisisText: {
    fontFamily: fonts.sans,
    color: '#f0d0d0',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  acknowledgmentCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 14,
  },
  ackText: {
    fontFamily: fonts.serif,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.passage,
  },
  passageCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    marginTop: 12,
  },
  passageRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.teal,
    fontWeight: '700',
  },
  passageScripture: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.fg,
    marginTop: 8,
  },
  passageWhy: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 16,
    marginTop: 8,
  },
  reflect: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.passage,
    lineHeight: 19,
    marginVertical: 2,
  },
});
