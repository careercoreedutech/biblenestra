import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import { Screen, Section, Row, Pills, Button, Tag, Badge, Notice, Input, Empty } from '../components/ui';
import { colors } from '../theme';
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
    <Screen title="God Mode" menu={() => nav.push('Profile')} scroll={false}>
      <View style={styles.greet}>
        <Text style={styles.h1}>{greeting()}, {state.user.displayName}!</Text>
        <Text style={styles.sub}>What are we exploring today?</Text>
      </View>
      <View style={styles.grid}>
        <View style={styles.row}>
          <Card title={'Emotional\nTriage'} subtitle="I'm feeling anxious, angry, or lost." color={colors.teal} onPress={() => nav.push('Companion')} />
          <Card title={'Topic\nExplorer'} subtitle="What does the Bible say about..?" color={colors.lavender} onPress={() => nav.push('BibleChat', { seed: 'Which passages discuss ' })} />
        </View>
        <View style={styles.row}>
          <Card title={'1:1\nGuided Study'} subtitle="Walk me through a chapter deeply." color={colors.teal} onPress={() => nav.push('Reading', lp)} />
          <Card title={'The Hard\nQuestions'} subtitle="Doubts, contradictions, and friction." color={colors.lavender} onPress={() => nav.push('BibleChat', { seed: 'Why ' })} />
        </View>
      </View>
      <View style={{ flex: 1 }} />
      {state.chatHistory.length ? (
        <Pressable onPress={() => nav.push('BibleChat', {})} style={{ alignSelf: 'center', marginBottom: 10 }}>
          <Text style={{ color: colors.muted, fontSize: 10.5 }}>Continue last conversation ›</Text>
        </Pressable>
      ) : null}
      <Text style={styles.or}>Or start a chat below...</Text>
      <View style={{ paddingBottom: 10 }}>
        <AskBar placeholder="Ask anything..." onSend={(t) => nav.push('BibleChat', { seed: t, send: true })} />
      </View>
    </Screen>
  );
}

// ---------- Reading screen (the reference UI, screen 2) ----------
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
    <Screen back title="" scroll={false} padded={false}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 20 }}>
        <Text style={styles.eyebrow}>READING NOW</Text>
        <Text style={styles.passageTitle}>{title}</Text>
        {verses.map((v, i) => <Text key={i} style={styles.p}><Text style={styles.vnum}>{i + 1} </Text>{v}</Text>)}
      </ScrollView>
      <View style={styles.sheet}>
        <Pressable onPress={() => nav.push('Bible', ctx)}><Text style={styles.book}>▭</Text></Pressable>
        <Text style={styles.now}>You're Currently Reading</Text>
        <Text style={styles.h2}>{title}</Text>
        <Text style={styles.q}>What would you like to know?</Text>
        <View style={{ gap: 10 }}>
          <View style={styles.row}>
            <Card compact question="Too Long?" title="Summarize" color={colors.teal} onPress={() => ask('Summarize this chapter')} />
            <Card compact question="Confused?" title="Today's Language" color={colors.yellow} onPress={() => ask("Explain this in today's language")} />
          </View>
          <View style={styles.row}>
            <Card compact question="Feeling Lost?" title="Hidden Meaning" color={colors.amber} onPress={() => ask('What is the deeper meaning here?')} />
            <Card compact question="Now What?" title="Apply to Life" color={colors.teal} onPress={() => ask('How do I apply this to my life?')} />
          </View>
        </View>
        <View style={{ marginTop: 12 }}>
          <AskBar placeholder="Ask about this chapter..." onSend={ask} />
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
    if (params.send && params.seed && !sentSeed.current) { sentSeed.current = true; send(params.seed); }
  }, []);

  useEffect(() => { setTimeout(() => scroll.current && scroll.current.scrollToEnd({ animated: true }), 80); }, [history.length, typing]);

  const suggested = context
    ? ['Summarize this chapter', "Explain verse 1 in today's language", 'What is the deeper meaning here?', 'What does this word mean in Greek?']
    : ['Which passages discuss peace?', 'What does love mean in the original Greek?', 'Why did Jesus say you must be born again?', 'How do translations differ in Psalm 23?'];

  const tint = (t) => ({ Scripture: colors.teal, Explanation: colors.fg, Commentary: colors.amber, Interpretations: colors.lavender, 'Further study': colors.yellow }[t] || colors.fg);

  return (
    <Screen back title="Bible Chat" subtitle={context ? `Context: ${refLabel(context.bookId, context.chapter, context.verse)}` : 'No passage context'} scroll={false} padded={false}
      right={<Pressable onPress={() => setMenu(!menu)} hitSlop={10}><Text style={{ color: colors.muted, fontSize: 18 }}>⋯</Text></Pressable>}>
      {menu ? (
        <View style={styles.menu}>
          <Pressable onPress={() => { setHistory([]); dispatch({ type: 'chat', history: [] }); setMenu(false); }}><Text style={styles.menuItem}>New conversation</Text></Pressable>
          <Pressable onPress={() => { setHistory([]); dispatch({ type: 'chat', history: [] }); setMenu(false); }}><Text style={styles.menuItem}>Delete conversation</Text></Pressable>
          <Pressable onPress={() => { setContext(null); setMenu(false); }}><Text style={styles.menuItem}>Clear passage context</Text></Pressable>
          <Pressable onPress={() => { nav.push('Profile', { tab: 'Privacy' }); setMenu(false); }}><Text style={styles.menuItem}>Memory & privacy</Text></Pressable>
        </View>
      ) : null}
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 18, gap: 12 }} keyboardShouldPersistTaps="handled">
        {!history.length ? (
          <View style={{ alignItems: 'center', marginTop: 20 }}>
            <Text style={styles.spark}>✦·</Text>
            <Text style={[styles.h1, { fontSize: 18, marginTop: 8 }]}>Ask about Scripture</Text>
            <Text style={[styles.sub, { maxWidth: 280 }]}>Answers are built only from passages and licensed commentary in your library, and every reference is verified before it is shown.</Text>
            <View style={{ marginTop: 18, gap: 8, alignSelf: 'stretch' }}>
              {suggested.map((s) => <Pressable key={s} onPress={() => send(s)} style={styles.suggest}><Text style={styles.suggestText}>{s}</Text></Pressable>)}
            </View>
          </View>
        ) : null}
        {history.map((m) => m.role === 'user' ? (
          <View key={m.id} style={styles.userBubble}><Text style={styles.userText}>{m.text}</Text></View>
        ) : (
          <View key={m.id} style={styles.aiBubble}>
            {m.blocks.map((b, i) => (
              <View key={i} style={styles.block}>
                <Text style={[styles.blockType, { color: tint(b.type) }]}>{b.type.toUpperCase()}{b.source ? ' · ' + b.source : ''}</Text>
                {b.ref ? (
                  <Pressable onPress={() => nav.push('Bible', { bookId: b.bookId, chapter: b.chapter, verse: b.verse })}>
                    <Text style={styles.blockText}>"{b.text}"</Text>
                    <Text style={styles.blockRef}>{b.ref} · {b.translation} · Open ›</Text>
                  </Pressable>
                ) : <Text style={styles.blockText}>{b.text}</Text>}
              </View>
            ))}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8 }}>
              {context ? <Pill label="Open passage" onPress={() => nav.push('Bible', context)} /> : null}
              <Pill label="Save answer" onPress={() => dispatch({ type: 'saveAnswer', a: { question: m.question, blocks: m.blocks } })} />
              <Pill label="Create note" onPress={() => { if (context) { dispatch({ type: 'note', n: { bookId: context.bookId, chapter: context.chapter, verse: context.verse || 1, text: m.blocks.map((b) => b.text).filter(Boolean).join(' ').slice(0, 200) } }); nav.push('Library'); } }} />
              <Pill label="Compare translations" onPress={() => nav.push('Bible', { ...(context || { bookId: 'JHN', chapter: 3 }) })} />
              <Pill label="Share excerpt" onPress={() => dispatch({ type: 'post', post: { kind: 'Study', text: m.blocks.find((b) => b.type === 'Explanation')?.text || m.question } })} />
            </ScrollView>
          </View>
        ))}
        {typing ? <View style={styles.aiBubble}><Text style={{ color: colors.muted, fontSize: 12 }}>Checking references…</Text></View> : null}
      </ScrollView>
      <View style={{ padding: 14, paddingTop: 6 }}>
        <AskBar placeholder={context ? 'Ask about this passage...' : 'Ask anything...'} onSend={send} initial={params.send ? '' : params.seed} />
      </View>
    </Screen>
  );
}

function Pill({ label, onPress }) {
  return <Pressable onPress={onPress} style={styles.pill}><Text style={styles.pillText}>{label}</Text></Pressable>;
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
    <Screen back title="Scripture Companion" subtitle="Private · never posted · not visible to admins">
      {!result ? (
        <View>
          <View style={{ alignItems: 'center', marginTop: 18 }}>
            <Text style={styles.spark}>✦·</Text>
            <Text style={[styles.h1, { marginTop: 8 }]}>What's on your heart today?</Text>
            <Text style={[styles.sub, { maxWidth: 280 }]}>Describe it in your own words. You don't have to pick a category.</Text>
          </View>
          <Input multiline placeholder="I've been feeling..." value={text} onChangeText={setText} style={{ marginTop: 18, minHeight: 110 }} />
          <Pills small items={COMPANION_CATEGORIES} value={cat} onChange={(c) => setCat(cat === c ? null : c)} style={{ marginTop: 10 }} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Button kind="ghost" label="🎤 Voice" onPress={() => {}} />
            <Button label="Find Scripture" onPress={submit} style={{ flex: 1 }} disabled={!text.trim() && !cat} />
          </View>
          {state.companionHistory.length ? (
            <Section title="Your private history">
              {state.companionHistory.map((h, i) => <Row key={i} title={h.text} subtitle={h.refs.join(' · ')} right={h.when} />)}
            </Section>
          ) : null}
        </View>
      ) : (
        <View>
          {result.crisis ? (
            <View style={styles.crisis}>
              <Text style={styles.crisisTitle}>You matter. Please reach out now.</Text>
              <Text style={styles.crisisText}>If you are in immediate danger, contact your local emergency number. In Nigeria call 112; in the US call or text 988; in the UK call 116 123 (Samaritans). This app is not a substitute for emergency or mental-health care.</Text>
              <Button small label="Talk to a qualified person" onPress={() => nav.push('Care', { preselect: 'I want a qualified counselor' })} style={{ marginTop: 10 }} />
            </View>
          ) : null}
          <Text style={styles.ack}>{result.acknowledgment}</Text>
          {result.passages.map((p) => (
            <View key={p.ref} style={styles.passageCard}>
              <Text style={styles.passageRef}>{p.ref} · {p.translation}</Text>
              <Text style={styles.passageText}>{p.text}</Text>
              <Text style={styles.why}>Why this may be relevant: {p.why}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button small kind="ghost" label="Read in context" onPress={() => nav.push('Bible', { bookId: p.bookId, chapter: p.chapter, verse: p.verses[0] })} />
                <Button small kind="ghost" label="Save" onPress={() => dispatch({ type: 'bookmark', b: { bookId: p.bookId, chapter: p.chapter, verse: p.verses[0], folder: 'Scripture Companion' } })} />
                <Button small kind="ghost" label="Listen" onPress={() => nav.push('Bible', { bookId: p.bookId, chapter: p.chapter })} />
              </View>
            </View>
          ))}
          <Section title="Reflection">
            {result.reflections.map((r) => <Text key={r} style={styles.reflect}>· {r}</Text>)}
            <Input multiline placeholder="Record a private reflection (optional)" value={reflection} onChangeText={setReflection} style={{ marginTop: 10, minHeight: 70 }} />
            {reflection.trim() ? <Button small label="Save privately" style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => { dispatch({ type: 'note', n: { bookId: result.passages[0].bookId, chapter: result.passages[0].chapter, verse: result.passages[0].verses[0], text: reflection.trim() } }); setReflection(''); }} /> : null}
          </Section>
          <Section title="Next steps">
            <Row title="Continue in Bible Chat" right="›" onPress={() => nav.push('BibleChat', { context: { bookId: result.passages[0].bookId, chapter: result.passages[0].chapter }, seed: text, send: true })} />
            <Row title="Start a reading journey" subtitle="Psalms of Comfort · 14 days" right="›" onPress={() => nav.push('Plan', { id: 'pl2' })} />
            <Row title="Find a community" right="›" onPress={() => nav.push('Communities')} />
            <Row title="Speak with a trusted person or qualified professional" right="›" onPress={() => nav.push('Care')} />
          </Section>
          <Notice text="This companion does not know why something happened, does not diagnose, and does not replace professional care." />
          <Button kind="ghost" label="Start over" onPress={() => { setResult(null); setText(''); setCat(null); }} style={{ marginTop: 16 }} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  greet: { alignItems: 'center', marginTop: 44 },
  h1: { fontSize: 22, fontWeight: '600', color: colors.fg, letterSpacing: -0.2, textAlign: 'center' },
  sub: { fontSize: 11.5, color: colors.muted, marginTop: 6, textAlign: 'center', lineHeight: 16 },
  grid: { marginTop: 28, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  or: { textAlign: 'center', fontSize: 10.5, color: colors.muted, marginBottom: 14 },
  spark: { fontSize: 14, color: colors.muted, letterSpacing: 1 },
  eyebrow: { fontSize: 8.5, letterSpacing: 2, color: colors.muted, textAlign: 'center', marginTop: 10, marginBottom: 10 },
  passageTitle: { color: colors.passage, fontSize: 11.5, marginBottom: 10 },
  p: { color: colors.passage, fontSize: 11.5, lineHeight: 17, marginBottom: 10 },
  vnum: { fontSize: 8.5, color: colors.muted, fontWeight: '600' },
  sheet: { backgroundColor: colors.sheet, borderTopWidth: 1, borderColor: colors.line, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
  book: { textAlign: 'center', fontSize: 14, color: colors.muted },
  now: { textAlign: 'center', fontSize: 9.5, color: colors.muted, marginTop: 6 },
  h2: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.fg, marginTop: 4 },
  q: { textAlign: 'center', fontSize: 10.5, color: colors.muted, marginTop: 6, marginBottom: 12 },
  menu: { position: 'absolute', right: 14, top: 44, zIndex: 5, backgroundColor: colors.cardTop, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 6 },
  menuItem: { color: colors.fg, fontSize: 12.5, paddingVertical: 8, paddingHorizontal: 12 },
  suggest: { backgroundColor: colors.cardBottom, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 },
  suggestText: { color: colors.fg, fontSize: 12.5 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderRadius: 14, borderBottomRightRadius: 4, padding: 12, maxWidth: '85%' },
  userText: { color: '#fff', fontSize: 13, lineHeight: 18 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: colors.cardBottom, borderWidth: 1, borderColor: colors.line, borderRadius: 14, borderBottomLeftRadius: 4, padding: 12, maxWidth: '95%', gap: 8 },
  block: { gap: 4 },
  blockType: { fontSize: 8.5, letterSpacing: 1.5, fontWeight: '600' },
  blockText: { color: colors.passage, fontSize: 13, lineHeight: 19 },
  blockRef: { color: colors.teal, fontSize: 11, fontWeight: '600', marginTop: 4 },
  pill: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { color: colors.fg, fontSize: 10.5 },
  crisis: { backgroundColor: '#3a1f1f', borderWidth: 1, borderColor: '#8a2f2f', borderRadius: 12, padding: 14, marginTop: 12 },
  crisisTitle: { color: '#ffb3b3', fontWeight: '600', fontSize: 14 },
  crisisText: { color: '#f1d6d6', fontSize: 12, lineHeight: 17, marginTop: 6 },
  ack: { color: colors.fg, fontSize: 14, lineHeight: 20, marginTop: 16 },
  passageCard: { backgroundColor: colors.cardBottom, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, marginTop: 12 },
  passageRef: { color: colors.teal, fontSize: 11, fontWeight: '600' },
  passageText: { color: colors.fg, fontSize: 14, lineHeight: 21, marginTop: 8 },
  why: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  reflect: { color: colors.passage, fontSize: 12.5, lineHeight: 18 },
});
