// ---------- Scripture Companion (client #6, brief 6.5) ----------
// The user describes their situation; the reply always has ≥7 relevant scriptures (exact text from the app's Bible
// data in the reader's translation), how each one speaks to the situation, words of encouragement and a personalised
// prayer. Crisis signals put helplines for the user's country at the top. Rendered progressively (src/api/companion.js).
// Same visual language as the previous Companion screen (GodModeScreen.js styles are mirrored below).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Screen, Section, Row, Pill, Button, Input, Notice, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useNarration } from '../audio/Narration';
import { PressScale, FadeInUp, ScaleIn, Pop, Shimmer } from '../components/Motion';
import { useCompanion, companionText } from '../api/companion';

const ND = Platform.OS !== 'web';

// Quick starting points (each maps onto a theme in the server's curated verse index).
const SITUATIONS = [
  'Sickness', 'Money worries', 'Depression', 'Grief', 'Fear', 'Anxiety', 'Loneliness', 'Marriage',
  'Waiting for a child', 'Job search', 'Exams', 'Guilt', 'Temptation', 'Betrayal', 'Thankful', 'New beginning', 'Feeling far from God',
];

function SlideInRight({ children, style, distance = 28, duration = 320 }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(a, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start(); }, []);
  return <Animated.View style={[style, { opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>{children}</Animated.View>;
}

function AssistantAvatar({ size = 28 }) {
  return (
    <View style={[styles.aiAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: colors.goldLight, fontSize: size * 0.42, lineHeight: size * 0.6 }}>✦</Text>
    </View>
  );
}

const shareText = async (text, toast) => {
  try {
    const { Share } = require('react-native');
    await Share.share({ message: text });
  } catch (e) { toast.show('Couldn’t open sharing', { tone: 'error' }); }
};

function CrisisCard({ crisis, nav, toast }) {
  const call = (phone, sms) => Linking.openURL(`${sms ? 'sms' : 'tel'}:${String(phone).replace(/[^\d+]/g, '')}`).catch(() => toast.show(`Call ${phone}`, { icon: 'bell' }));
  return (
    <FadeInUp delay={60} style={styles.crisis}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="heart" size={16} color={colors.negative} />
        <Text style={styles.crisisTitle}>{crisis.title}</Text>
      </View>
      <Text style={styles.crisisText}>{crisis.body}</Text>
      <PressScale onPress={() => (/^\d+$/.test(String(crisis.emergency).split(' ')[0]) ? call(String(crisis.emergency).split(' ')[0]) : null)} style={styles.emergencyRow}>
        <Icon name="shield" size={14} color={colors.negative} />
        <Text style={styles.emergencyText}>Emergency{crisis.country ? ` (${crisis.country})` : ''}: {crisis.emergency}</Text>
      </PressScale>
      {(crisis.lines || []).map((l) => (
        <PressScale key={l.name + l.phone} onPress={() => call(l.phone, l.sms)} style={styles.lineRow} accessibilityLabel={`Call ${l.name}`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{l.name}</Text>
            <Text style={styles.linePhone}>{l.phone}</Text>
          </View>
          <Icon name={l.sms ? 'message' : 'arrow-up-right'} size={15} color={colors.fg} />
        </PressScale>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <Button small label="Talk to a qualified person" onPress={() => nav.push('Care', { preselect: 'I need someone to talk to' })} />
        {crisis.directory ? (
          <Button
            small
            kind="ghost"
            label={crisis.lines && crisis.lines.length ? 'Other countries' : 'Find a crisis line'}
            icon={<Icon name="globe" size={13} color={colors.fg} />}
            onPress={() => Linking.openURL(crisis.directory.url).catch(() => toast.show('Couldn’t open the helpline directory', { tone: 'error' }))}
          />
        ) : null}
      </View>
    </FadeInUp>
  );
}

export function CompanionScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const toast = useToast();
  const nar = useNarration();
  const [text, setText] = useState('');
  const [cat, setCat] = useState(null);
  const [reflection, setReflection] = useState('');
  const c = useCompanion({ translation: state.translation, country: (state.user && state.user.country) || '' });
  const savedFor = useRef(null);

  const submit = () => {
    const msg = (text.trim() || cat || '').trim();
    if (!msg) return;
    savedFor.current = null;
    c.ask(cat && text.trim() ? `${cat}. ${text.trim()}` : msg);
  };

  // Once the whole reply is written, keep it in this phone's private history (re-opens without the network).
  const complete = c.phase === 'ready' && c.done && c.done.x1 && c.done.x2 && c.done.p;
  useEffect(() => {
    if (!complete || c.restored || savedFor.current === c.requestId) return;
    savedFor.current = c.requestId;
    dispatch({ type: 'companion', entry: {
      when: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      text: c.message, cat: cat || null, refs: (c.verses || []).map((v) => v.label),
      reply: { message: c.message, verses: c.verses, themes: c.themes, summary: c.summary, crisis: c.crisis, medicalNote: c.medicalNote, explanations: c.explanations, encouragement: c.encouragement, prayer: c.prayer },
    } });
  }, [complete]);

  const reopen = (h) => {
    setText(h.text);
    setCat(h.cat || null);
    if (h.reply) c.restore(h.reply);
    else c.ask(h.text);
  };

  const isSaved = (v) => state.bookmarks.some((b) => b.bookId === v.bookId && b.chapter === v.chapter && (b.verse || null) === (v.verseStart || null));
  const toggleSave = (v) => {
    const saved = isSaved(v);
    dispatch({ type: 'bookmark', b: { bookId: v.bookId, chapter: v.chapter, verse: v.verseStart, folder: 'Scripture Companion' } });
    toast.show(saved ? `${v.label} removed from bookmarks` : `${v.label} saved to bookmarks`, {
      icon: 'bookmark', haptic: saved ? 'select' : 'success', action: saved ? undefined : { label: 'Library', onPress: () => nav.push('Library') },
    });
  };
  const listen = (v) => {
    if (v.verseEnd > v.verseStart) nar.playChapter(v.bookId, v.chapter, { translation: state.translation, fromVerse: v.verseStart });
    else nar.playVerse(v.bookId, v.chapter, v.verseStart, { translation: state.translation });
    toast.show(`Listening to ${v.label}`, { icon: 'headphones', action: { label: 'Player', onPress: () => nar.openPlayer() } });
  };
  const startOver = () => { c.reset(); setText(''); setCat(null); setReflection(''); };

  const shared = c.message || (text.trim() || cat || '').trim();
  const verses = c.verses || [];
  const explanationError = c.errors && (c.errors.x1 || c.errors.x2);
  const prayerError = c.errors && c.errors.p;
  const ack = (c.safety && c.safety.acknowledgement) || 'Thank you for sharing this with me. I’m gathering Scripture for you…';
  const themeLabels = (c.themes || []).map((t) => THEME_LABELS[t.theme] || t.theme);

  return (
    <Screen back title="Scripture Companion" subtitle="Private · confidential · comforting">
      {c.phase === 'idle' ? (
        <View key="compose">
          <View style={styles.companionHero}>
            <ScaleIn from={0.6} style={styles.companionIcon}>
              <Icon name="prayer" size={22} color={colors.goldLight} />
            </ScaleIn>
            <FadeInUp delay={80} style={{ alignItems: 'center' }}>
              <Text style={styles.companionTitle}>What is on your heart?</Text>
              <Text style={styles.companionSub}>
                Tell me what you are going through, in your own words. I will find Scripture for your situation, explain how each one speaks to you, and pray with you.
              </Text>
            </FadeInUp>
          </View>

          <FadeInUp index={2} delay={60} style={styles.composeCard}>
            <Input
              multiline
              placeholder="e.g. I lost my job last month, rent is due and I feel God has forgotten me…"
              value={text}
              onChangeText={setText}
              style={styles.composeInput}
            />
            <View style={styles.composeRule} />
            <Text style={[styles.eyebrow, { color: colors.muted, marginBottom: 10 }]}>Or start from a situation</Text>
            <View style={styles.themeWrap}>
              {SITUATIONS.map((s) => <Pill key={s} small label={s} active={cat === s} onPress={() => setCat(cat === s ? null : s)} />)}
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
              <Text style={styles.privacyText}>Only you can see what you share here. It is never posted anywhere.</Text>
            </View>
          </FadeInUp>

          {state.companionHistory.length ? (
            <Section title="Your private reflections">
              {state.companionHistory.map((h, i) => (
                <FadeInUp key={i} index={4 + i} delay={60} distance={10}>
                  <Row title={h.text} subtitle={(h.refs || []).join(' · ')} right={h.when} left={<Icon name="bookmark" size={16} color={colors.gold} />} onPress={() => reopen(h)} />
                </FadeInUp>
              ))}
            </Section>
          ) : null}
        </View>
      ) : (
        <View key="result" style={{ gap: 16 }}>
          {shared ? (
            <SlideInRight style={[styles.userRow, { marginTop: 6 }]}>
              <View style={styles.userBubble}><Text style={styles.userText}>{shared}</Text></View>
            </SlideInRight>
          ) : null}

          {c.crisis ? <CrisisCard crisis={c.crisis} nav={nav} toast={toast} /> : null}

          <FadeInUp index={1} delay={120} style={styles.aiWrap}>
            <View style={styles.aiHeader}>
              <AssistantAvatar />
              <Text style={styles.aiName}>Scripture Companion</Text>
            </View>
            <View style={styles.ackBubble}>
              <Text style={styles.ackText}>{c.summary ? `${c.summary} ` : ''}{c.summary ? 'Here is what God’s Word says to you.' : ack}</Text>
              {themeLabels.length ? <Text style={styles.themesLine}>{themeLabels.join(' · ')}</Text> : null}
            </View>
          </FadeInUp>

          {c.medicalNote ? <Notice tint={colors.teal} text={c.medicalNote} /> : null}

          {c.phase === 'error' ? (
            <FadeInUp style={styles.passageCard}>
              <Text style={styles.errTitle}>{c.error && c.error.code === 'NOT_CONFIGURED' ? 'Scripture Companion needs the online app' : 'Scripture couldn’t be found just now'}</Text>
              <Text style={styles.passageWhy}>{c.error && c.error.message}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button small label="Try again" onPress={c.retry} />
                <Button small kind="ghost" label="Start over" onPress={startOver} />
              </View>
            </FadeInUp>
          ) : null}

          {c.phase === 'loading' ? [0, 1, 2].map((i) => <Shimmer key={i} style={{ height: 150, borderRadius: radius.lg }} />) : null}

          {verses.map((v, i) => {
            const why = c.explanations && c.explanations[v.ref];
            const writing = !why && !(c.errors && c.errors[i < 4 ? 'x1' : 'x2']);
            return (
              <FadeInUp key={v.ref} index={2 + i} delay={80} stagger={90} distance={16} style={styles.passageCard}>
                <View style={styles.blockHeadRow}>
                  <View style={[styles.blockHead, { backgroundColor: alpha(colors.gold, 0.12) }]}>
                    <Text style={[styles.blockNum, { color: colors.gold }]}>{i + 1}</Text>
                    <Icon name="bible" size={11} color={colors.gold} strokeWidth={2.2} />
                    <Text style={[styles.blockType, { color: colors.gold }]}>{v.label}</Text>
                  </View>
                  <Text style={styles.blockSource}>{v.translation}</Text>
                  <PressScale onPress={() => listen(v)} accessibilityLabel={`Listen to ${v.label}`} hitSlop={6} scaleTo={0.88} style={styles.iconBtn}>
                    <Icon name="headphones" size={15} color={colors.fg} />
                  </PressScale>
                  <PressScale onPress={() => shareText(`“${v.text}” — ${v.label} (${v.translation})`, toast)} accessibilityLabel={`Share ${v.label}`} hitSlop={6} scaleTo={0.88} style={styles.iconBtn}>
                    <Icon name="share" size={15} color={colors.fg} />
                  </PressScale>
                </View>
                <Text style={styles.passageScripture}>“{v.text}”</Text>
                <View style={styles.whyBox}>
                  <Text style={styles.whyLabel}>How this speaks to you</Text>
                  {why ? <Text style={styles.passageWhy}>{why}</Text> : writing ? (
                    <View style={{ gap: 6, marginTop: 2 }}><Shimmer style={{ height: 11, borderRadius: 6 }} /><Shimmer style={{ height: 11, width: '70%', borderRadius: 6 }} /></View>
                  ) : <Text style={styles.passageWhy}>Couldn’t write this explanation just now.</Text>}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                  <Button small kind="ghost" label="Read in context" style={{ flex: 1 }} icon={<Icon name="book" size={13} color={colors.fg} />} onPress={() => nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verseStart })} />
                  <Pop trigger={isSaved(v)} amount={1.06} style={{ flex: 1 }}>
                    <Button small kind={isSaved(v) ? 'primary' : 'ghost'} label={isSaved(v) ? 'Saved' : 'Save'} icon={<Icon name={isSaved(v) ? 'check' : 'bookmark'} size={13} color={isSaved(v) ? colors.primaryFg : colors.fg} />} onPress={() => toggleSave(v)} />
                  </Pop>
                </View>
              </FadeInUp>
            );
          })}

          {explanationError ? (
            <Button small kind="ghost" label="Retry explanations" onPress={c.retry} style={{ alignSelf: 'flex-start' }} />
          ) : null}

          {verses.length ? (
            <FadeInUp index={3 + verses.length} delay={80} stagger={90}>
              <Section title="Words of encouragement" style={{ marginTop: 4 }}>
                <View style={styles.reflectCard}>
                  {c.encouragement ? <Text style={styles.encourage}>{c.encouragement}</Text> : prayerError ? (
                    <Text style={styles.passageWhy}>{prayerError.message}</Text>
                  ) : <View style={{ gap: 8 }}><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, width: '60%', borderRadius: 6 }} /></View>}
                </View>
              </Section>
              <Section title="A prayer for you" style={{ marginTop: 6 }}>
                <View style={[styles.reflectCard, styles.prayerCard]}>
                  <Icon name="prayer" size={18} color={colors.gold} />
                  {c.prayer ? <Text style={styles.prayer}>{c.prayer}</Text> : prayerError ? (
                    <Button small label="Try again" onPress={c.retry} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
                  ) : <View style={{ gap: 8, marginTop: 8 }}><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, width: '50%', borderRadius: 6 }} /></View>}
                </View>
              </Section>
              {complete ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Button small kind="ghost" label="Share all" style={{ flex: 1 }} icon={<Icon name="share" size={13} color={colors.fg} />} onPress={() => shareText(companionText(c), toast)} />
                  <Button small kind="ghost" label="Ask others to pray" style={{ flex: 1 }} icon={<Icon name="prayer" size={13} color={colors.fg} />} onPress={() => nav.push('NewPrayer', verses[0] ? { verse: verses[0].label } : {})} />
                </View>
              ) : null}
              <Text style={styles.aiNote}>Explanations, encouragement and prayer are written by BibleNestra’s assistant; Scripture text is from your Bible ({state.translation}).</Text>
            </FadeInUp>
          ) : null}

          {verses.length ? (
            <FadeInUp index={4 + verses.length} delay={80} stagger={90}>
              <Section title="Personal reflection" style={{ marginTop: 6 }}>
                <View style={styles.reflectCard}>
                  {['Which of these verses feels closest to where you are today?', 'What is one step you can take this week, trusting God with the rest?'].map((r, i) => (
                    <View key={r} style={styles.reflectRow}><Text style={styles.reflectNum}>{i + 1}</Text><Text style={styles.reflect}>{r}</Text></View>
                  ))}
                  <Input multiline placeholder="Write a private note to God..." value={reflection} onChangeText={setReflection} style={styles.reflectInput} />
                  {reflection.trim() ? (
                    <ScaleIn style={{ alignSelf: 'flex-start' }} from={0.9}>
                      <Button small label="Save reflection" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => {
                        const first = verses[0];
                        dispatch({ type: 'note', n: first ? { bookId: first.bookId, chapter: first.chapter, verse: first.verseStart, text: reflection.trim() } : { bookId: 'PSA', chapter: 23, verse: 1, text: reflection.trim() } });
                        setReflection('');
                        toast.show('Reflection saved privately', { icon: 'highlight', haptic: 'success', action: { label: 'Library', onPress: () => nav.push('Library') } });
                      }} />
                    </ScaleIn>
                  ) : null}
                </View>
              </Section>
              <Section title="Next steps" style={{ marginTop: 6 }}>
                <Row title="Continue in Bible Chat" subtitle="Ask follow-up questions about these passages" left={<Icon name="sparkles" size={17} color={colors.primary} />} right={<Icon name="chevron-right" size={14} color={colors.faint} />}
                  onPress={() => nav.push('BibleChat', verses[0] ? { context: { bookId: verses[0].bookId, chapter: verses[0].chapter }, seed: 'How do I apply this to my life today?', send: true } : {})} />
                <Row title="Talk to a trusted person" subtitle="Pastors, priests, mentors and counselors" left={<Icon name="users" size={17} color={colors.sage} />} right={<Icon name="chevron-right" size={14} color={colors.faint} />}
                  onPress={() => nav.push('Care', { preselect: 'I need someone to talk to' })} />
              </Section>
            </FadeInUp>
          ) : null}

          <Button kind="ghost" label="Start over" onPress={startOver} style={{ marginTop: 6 }} />
        </View>
      )}
    </Screen>
  );
}

const THEME_LABELS = {
  sickness: 'Sickness and healing', finances: 'Financial difficulty', depression: 'Discouragement', grief: 'Grief and loss', fear: 'Fear',
  anxiety: 'Anxiety', loneliness: 'Loneliness', marriage: 'Marriage and relationships', children: 'Waiting for children', job: 'Work and job search',
  exams: 'Exams and studies', guilt: 'Guilt and forgiveness', temptation: 'Temptation', betrayal: 'Betrayal', gratitude: 'Gratitude',
  newBeginnings: 'New beginnings', dryness: 'Spiritual dryness', safety: 'Refuge and safety', despair: 'Hope in despair', hope: 'Hope and strength',
};

const EYEBROW = { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' };

const styles = StyleSheet.create({
  eyebrow: { ...EYEBROW, color: colors.gold },
  companionHero: { alignItems: 'center', marginTop: 12 },
  companionIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', ...shadow.md },
  companionTitle: { fontFamily: fonts.serifBold, fontSize: 27, letterSpacing: -0.5, color: colors.fg, marginTop: 14, textAlign: 'center' },
  companionSub: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 320, marginTop: 6 },
  composeCard: { marginTop: 22, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow.sm },
  composeInput: { borderWidth: 0, paddingHorizontal: 4, paddingVertical: 4, minHeight: 104, fontSize: 15, lineHeight: 21, backgroundColor: 'transparent' },
  composeRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: 12 },
  themeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  privacyLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 },
  privacyText: { fontSize: 12, color: colors.faint, flexShrink: 1, textAlign: 'center' },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: { backgroundColor: colors.primary, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 15, paddingVertical: 10, maxWidth: '84%', ...shadow.sm },
  userText: { color: colors.primaryFg, fontSize: 14.5, lineHeight: 20.5 },
  aiWrap: { alignSelf: 'stretch' },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiAvatar: { backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  aiName: { fontSize: 12.5, fontWeight: '700', color: colors.fg },
  crisis: { backgroundColor: colors.cardRose, borderWidth: 1, borderColor: alpha(colors.negative, 0.25), borderRadius: radius.lg, padding: 16 },
  crisisTitle: { color: colors.negative, fontWeight: '700', fontSize: 14.5, flexShrink: 1 },
  crisisText: { color: colors.passage, fontSize: 13, lineHeight: 19, marginTop: 6 },
  emergencyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  emergencyText: { color: colors.negative, fontWeight: '700', fontSize: 13.5 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 10, borderRadius: radius.sm, backgroundColor: alpha(colors.surface, 0.8), borderWidth: 1, borderColor: alpha(colors.negative, 0.15) },
  lineName: { color: colors.fg, fontSize: 13, fontWeight: '600' },
  linePhone: { color: colors.passage, fontSize: 13, marginTop: 1 },
  ackBubble: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, borderTopLeftRadius: 6, padding: 15, ...shadow.sm },
  ackText: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, color: colors.passage },
  themesLine: { ...EYEBROW, fontSize: 9.5, color: colors.gold, marginTop: 10 },
  passageCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, ...shadow.sm },
  blockHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  blockNum: { fontSize: 10, fontWeight: '800' },
  blockType: { fontSize: 10, letterSpacing: 1, fontWeight: '700', textTransform: 'uppercase' },
  blockSource: { flex: 1, fontSize: 11.5, color: colors.faint },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'center' },
  passageScripture: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, color: colors.passage, marginTop: 12 },
  whyBox: { marginTop: 12, padding: 12, borderRadius: radius.sm, backgroundColor: colors.screen },
  whyLabel: { ...EYEBROW, fontSize: 9.5, color: colors.muted, marginBottom: 4 },
  passageWhy: { fontSize: 13.5, color: colors.muted, lineHeight: 19.5 },
  errTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg, marginBottom: 6 },
  reflectCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 16, ...shadow.sm },
  prayerCard: { backgroundColor: colors.cardGold, borderColor: alpha(colors.gold, 0.25) },
  encourage: { fontSize: 15, lineHeight: 23, color: colors.passage },
  prayer: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 25, color: colors.passage, marginTop: 8 },
  aiNote: { fontSize: 11, color: colors.faint, marginTop: 12, lineHeight: 16 },
  reflectRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  reflectNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.cardGold, color: colors.gold, fontSize: 11.5, fontWeight: '700', textAlign: 'center', lineHeight: 22, overflow: 'hidden' },
  reflect: { flex: 1, fontFamily: fonts.serifItalic, fontSize: 15, color: colors.passage, lineHeight: 21 },
  reflectInput: { marginTop: 6, minHeight: 84, backgroundColor: colors.screen },
});

export default CompanionScreen;
