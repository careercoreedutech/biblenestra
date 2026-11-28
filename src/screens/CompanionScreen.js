import { isDarkScheme } from '../design/palette';
// ---------- Scripture Companion (client #6, brief 6.5) ----------
// The user describes their situation; the reply always has ≥7 relevant scriptures (exact text from the app's Bible
// data in the reader's translation), how each one speaks to the situation, words of encouragement and a personalised
// prayer. Crisis signals put helplines for the user's country at the top. Rendered progressively (src/api/companion.js).
// Restyled in the Figma design (Companion page) with the tokens in src/design/sanctuary.js; all flow and data is unchanged.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icons';
import { colors, radius } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useNarration } from '../audio/Narration';
import { PressScale, FadeInUp, ScaleIn, Pop, Shimmer } from '../components/Motion';
import { useCompanion, companionText } from '../api/companion';
import { d, df, k, gradients, Grad, Tap, Eyebrow, PageHeader, SectionTitle } from '../design/sanctuary';

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

// .ai-bubble > span: the plum sparkle square
function AssistantAvatar({ size = 30 }) {
  return (
    <View style={[styles.aiAvatar, { width: size, height: size, borderRadius: 10 }]}>
      <Icon name="sparkles" size={14} color="#FFFFFF" />
    </View>
  );
}

// Design button: plum filled, or the paper ghost style.
function Action({ label, onPress, ghost, icon, disabled, style, accessibilityLabel }) {
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={[styles.action, ghost ? styles.actionGhost : styles.actionPrimary, disabled && { opacity: 0.45 }, style]}
    >
      {icon ? icon : null}
      <Text style={[styles.actionText, ghost && { color: d.ink }]} numberOfLines={1}>{label}</Text>
    </Tap>
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
        <Icon name="heart" size={16} color={d.roseDark} />
        <Text style={styles.crisisTitle}>{crisis.title}</Text>
      </View>
      <Text style={styles.crisisText}>{crisis.body}</Text>
      <Tap onPress={() => (/^\d+$/.test(String(crisis.emergency).split(' ')[0]) ? call(String(crisis.emergency).split(' ')[0]) : null)} style={styles.emergencyRow}>
        <Icon name="shield" size={14} color={d.roseDark} />
        <Text style={styles.emergencyText}>Emergency{crisis.country ? ` (${crisis.country})` : ''}: {crisis.emergency}</Text>
      </Tap>
      {(crisis.lines || []).map((l) => (
        <Tap key={l.name + l.phone} onPress={() => call(l.phone, l.sms)} style={styles.lineRow} accessibilityLabel={`Call ${l.name}`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{l.name}</Text>
            <Text style={styles.linePhone}>{l.phone}</Text>
          </View>
          <Icon name={l.sms ? 'message' : 'arrow-up-right'} size={15} color={d.ink} />
        </Tap>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <Action small label="Talk to a qualified person" onPress={() => nav.push('Care', { preselect: 'I need someone to talk to' })} />
        {crisis.directory ? (
          <Action
            ghost
            label={crisis.lines && crisis.lines.length ? 'Other countries' : 'Find a crisis line'}
            icon={<Icon name="globe" size={13} color={d.ink} />}
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
    <View style={k.screen}>
      <ScrollView contentContainerStyle={[k.scroll, { paddingBottom: 48 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <PageHeader back onBack={() => nav.pop()} title="Scripture Companion" subtitle="Wisdom for this moment" action={null} />

        {c.phase === 'idle' ? (
          <View key="compose">
            {/* .companion-hero */}
            <Grad colors={['#3A2416', '#B3541D']} style={styles.hero}>
              <ScaleIn from={0.6}>
                <Icon name="sparkles" size={26} color={d.gold} />
              </ScaleIn>
              <Text style={styles.heroKicker}>You can speak freely here</Text>
              <FadeInUp delay={80}>
                <Text style={styles.heroTitle}>What are you carrying today?</Text>
                <Text style={styles.heroSub}>
                  Tell me what you are going through, in your own words. I will find Scripture for your situation, explain how each one speaks to you, and pray with you.
                </Text>
              </FadeInUp>
            </Grad>

            {/* .prompt-chips: the real situations */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {SITUATIONS.map((s) => (
                <Tap key={s} onPress={() => setCat(cat === s ? null : s)} style={[styles.chip, cat === s && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: cat === s }}>
                  <Text style={[styles.chipText, cat === s && styles.chipTextOn]}>{s}</Text>
                </Tap>
              ))}
            </ScrollView>

            {/* .companion-input */}
            <FadeInUp index={2} delay={60} style={styles.inputCard}>
              <TextInput
                multiline
                placeholder="e.g. I lost my job last month, rent is due and I feel God has forgotten me…"
                placeholderTextColor={d.muted}
                value={text}
                onChangeText={setText}
                style={styles.input}
                accessibilityLabel="Describe what you are going through"
              />
              <View style={styles.inputFoot}>
                <View style={styles.privateTag}>
                  <Icon name="shield" size={13} color={d.muted} />
                  <Text style={styles.privateText}>Private conversation</Text>
                </View>
                <Tap onPress={submit} disabled={!text.trim() && !cat} style={[styles.sendBtn, !text.trim() && !cat && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel="Seek Scripture">
                  <Icon name="arrow-right" size={16} color="#FFFFFF" />
                </Tap>
              </View>
            </FadeInUp>

            <Text style={styles.privacyText}>Only you can see what you share here. It is never posted anywhere.</Text>

            {/* .crisis-note */}
            <View style={styles.crisisNote}>
              <Icon name="heart" size={18} color={isDarkScheme() ? '#a3a3a3' : '#6b6b6b'} />
              <Text style={styles.crisisNoteText}>If you may be in immediate danger, BibleNestra will show local crisis support before anything else.</Text>
            </View>

            {state.companionHistory.length ? (
              <View>
                <SectionTitle eyebrow="Recent companions" title="Continue a conversation" />
                <View style={styles.list}>
                  {state.companionHistory.map((h, i) => (
                    <FadeInUp key={i} index={4 + i} delay={60} distance={10}>
                      <Tap onPress={() => reopen(h)} style={styles.listRow}>
                        <View style={styles.listIcon}><Icon name="bookmark" size={17} color={d.plum} /></View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.listTitle} numberOfLines={2}>{h.text}</Text>
                          <Text style={styles.listSub} numberOfLines={1}>{[(h.refs || []).join(' · '), h.when].filter(Boolean).join(' · ')}</Text>
                        </View>
                        <Icon name="chevron-right" size={14} color={d.muted} />
                      </Tap>
                    </FadeInUp>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View key="result" style={{ gap: 16 }}>
            {shared ? (
              <SlideInRight style={styles.userRow}>
                <View style={styles.userBubble}><Text style={styles.userText}>{shared}</Text></View>
              </SlideInRight>
            ) : null}

            {c.crisis ? <CrisisCard crisis={c.crisis} nav={nav} toast={toast} /> : null}

            {/* .ai-bubble */}
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

            {c.medicalNote ? (
              <View style={styles.crisisNote}>
                <Icon name="shield" size={16} color={isDarkScheme() ? '#a3a3a3' : '#6b6b6b'} />
                <Text style={styles.crisisNoteText}>{c.medicalNote}</Text>
              </View>
            ) : null}

            {c.phase === 'error' ? (
              <FadeInUp style={styles.card}>
                <Text style={styles.errTitle}>{c.error && c.error.code === 'NOT_CONFIGURED' ? 'Scripture Companion needs the online app' : 'Scripture couldn’t be found just now'}</Text>
                <Text style={styles.body}>{c.error && c.error.message}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Action small label="Try again" onPress={c.retry} />
                  <Action small ghost label="Start over" onPress={startOver} />
                </View>
              </FadeInUp>
            ) : null}

            {c.phase === 'loading' ? [0, 1, 2].map((i) => <Shimmer key={i} style={{ height: 150, borderRadius: 22 }} />) : null}

            {verses.map((v, i) => {
              const why = c.explanations && c.explanations[v.ref];
              const writing = !why && !(c.errors && c.errors[i < 4 ? 'x1' : 'x2']);
              return (
                <FadeInUp key={v.ref} index={2 + i} delay={80} stagger={90} distance={16} style={styles.card}>
                  <View style={styles.blockHeadRow}>
                    <View style={styles.blockHead}>
                      <Text style={styles.blockNum}>{i + 1}</Text>
                      <Icon name="bible" size={11} color={d.plum} strokeWidth={2.2} />
                      <Text style={styles.blockType}>{v.label}</Text>
                    </View>
                    <Text style={styles.blockSource} numberOfLines={1}>{v.translation}</Text>
                    <PressScale onPress={() => listen(v)} accessibilityLabel={`Listen to ${v.label}`} hitSlop={6} scaleTo={0.88} style={styles.iconBtn}>
                      <Icon name="headphones" size={15} color={d.ink} />
                    </PressScale>
                    <PressScale onPress={() => shareText(`“${v.text}” — ${v.label} (${v.translation})`, toast)} accessibilityLabel={`Share ${v.label}`} hitSlop={6} scaleTo={0.88} style={styles.iconBtn}>
                      <Icon name="share" size={15} color={d.ink} />
                    </PressScale>
                  </View>
                  <Text style={styles.scripture}>“{v.text}”</Text>
                  <View style={styles.whyBox}>
                    <Text style={styles.whyLabel}>How this speaks to you</Text>
                    {why ? <Text style={styles.body}>{why}</Text> : writing ? (
                      <View style={{ gap: 6, marginTop: 2 }}><Shimmer style={{ height: 11, borderRadius: 6 }} /><Shimmer style={{ height: 11, width: '70%', borderRadius: 6 }} /></View>
                    ) : <Text style={styles.body}>Couldn’t write this explanation just now.</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                    <Action ghost label="Read in context" style={{ flex: 1 }} icon={<Icon name="book" size={13} color={d.ink} />} onPress={() => nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verseStart })} />
                    <Pop trigger={isSaved(v)} amount={1.06} style={{ flex: 1 }}>
                      <Action
                        ghost={!isSaved(v)}
                        label={isSaved(v) ? 'Saved' : 'Save'}
                        style={{ flex: 1 }}
                        icon={<Icon name={isSaved(v) ? 'check' : 'bookmark'} size={13} color={isSaved(v) ? '#FFFFFF' : d.ink} />}
                        onPress={() => toggleSave(v)}
                      />
                    </Pop>
                  </View>
                </FadeInUp>
              );
            })}

            {explanationError ? (
              <Action small ghost label="Retry explanations" onPress={c.retry} style={{ alignSelf: 'flex-start' }} />
            ) : null}

            {verses.length ? (
              <FadeInUp index={3 + verses.length} delay={80} stagger={90}>
                <SectionTitle eyebrow="Words of encouragement" title="Encouragement" />
                <View style={styles.card}>
                  {c.encouragement ? <Text style={styles.encourage}>{c.encouragement}</Text> : prayerError ? (
                    <Text style={styles.body}>{prayerError.message}</Text>
                  ) : <View style={{ gap: 8 }}><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, width: '60%', borderRadius: 6 }} /></View>}
                </View>

                <SectionTitle eyebrow="A prayer for you" title="Prayer" />
                <View style={[styles.card, styles.prayerCard]}>
                  <Icon name="prayer" size={18} color={d.goldDark} />
                  {c.prayer ? <Text style={styles.prayer}>{c.prayer}</Text> : prayerError ? (
                    <Action small label="Try again" onPress={c.retry} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
                  ) : <View style={{ gap: 8, marginTop: 8 }}><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, borderRadius: 6 }} /><Shimmer style={{ height: 12, width: '50%', borderRadius: 6 }} /></View>}
                </View>

                {complete ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <Action ghost label="Share all" style={{ flex: 1 }} icon={<Icon name="share" size={13} color={d.ink} />} onPress={() => shareText(companionText(c), toast)} />
                    <Action ghost label="Ask others to pray" style={{ flex: 1 }} icon={<Icon name="prayer" size={13} color={d.ink} />} onPress={() => nav.push('NewPrayer', verses[0] ? { verse: verses[0].label } : {})} />
                  </View>
                ) : null}
                <Text style={styles.aiNote}>Explanations, encouragement and prayer are written by BibleNestra’s assistant; Scripture text is from your Bible ({state.translation}).</Text>
              </FadeInUp>
            ) : null}

            {verses.length ? (
              <FadeInUp index={4 + verses.length} delay={80} stagger={90}>
                <SectionTitle eyebrow="Personal reflection" title="Sit with it" />
                <View style={styles.card}>
                  {['Which of these verses feels closest to where you are today?', 'What is one step you can take this week, trusting God with the rest?'].map((r, i) => (
                    <View key={r} style={styles.reflectRow}><Text style={styles.reflectNum}>{i + 1}</Text><Text style={styles.reflect}>{r}</Text></View>
                  ))}
                  <TextInput
                    multiline
                    placeholder="Write a private note to God..."
                    placeholderTextColor={d.muted}
                    value={reflection}
                    onChangeText={setReflection}
                    style={styles.reflectInput}
                    accessibilityLabel="Private note to God"
                  />
                  {reflection.trim() ? (
                    <ScaleIn style={{ alignSelf: 'flex-start' }} from={0.9}>
                      <Action small label="Save reflection" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => {
                        const first = verses[0];
                        dispatch({ type: 'note', n: first ? { bookId: first.bookId, chapter: first.chapter, verse: first.verseStart, text: reflection.trim() } : { bookId: 'PSA', chapter: 23, verse: 1, text: reflection.trim() } });
                        setReflection('');
                        toast.show('Reflection saved privately', { icon: 'highlight', haptic: 'success', action: { label: 'Library', onPress: () => nav.push('Library') } });
                      }} />
                    </ScaleIn>
                  ) : null}
                </View>

                <SectionTitle eyebrow="Next steps" title="Continue" />
                <View style={styles.list}>
                  <Tap onPress={() => nav.push('BibleChat', verses[0] ? { context: { bookId: verses[0].bookId, chapter: verses[0].chapter }, seed: 'How do I apply this to my life today?', send: true } : {})} style={styles.listRow}>
                    <View style={styles.listIcon}><Icon name="sparkles" size={17} color={d.plum} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listTitle}>Continue in Bible Chat</Text>
                      <Text style={styles.listSub}>Ask follow-up questions about these passages</Text>
                    </View>
                    <Icon name="chevron-right" size={14} color={d.muted} />
                  </Tap>
                  <Tap onPress={() => nav.push('Care', { preselect: 'I need someone to talk to' })} style={styles.listRow}>
                    <View style={styles.listIcon}><Icon name="users" size={17} color={d.plum} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listTitle}>Talk to a trusted person</Text>
                      <Text style={styles.listSub}>Pastors, priests, mentors and counselors</Text>
                    </View>
                    <Icon name="chevron-right" size={14} color={d.muted} />
                  </Tap>
                </View>
              </FadeInUp>
            ) : null}

            <Action ghost label="Start over" onPress={startOver} style={{ marginTop: 6 }} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const THEME_LABELS = {
  sickness: 'Sickness and healing', finances: 'Financial difficulty', depression: 'Discouragement', grief: 'Grief and loss', fear: 'Fear',
  anxiety: 'Anxiety', loneliness: 'Loneliness', marriage: 'Marriage and relationships', children: 'Waiting for children', job: 'Work and job search',
  exams: 'Exams and studies', guilt: 'Guilt and forgiveness', temptation: 'Temptation', betrayal: 'Betrayal', gratitude: 'Gratitude',
  newBeginnings: 'New beginnings', dryness: 'Spiritual dryness', safety: 'Refuge and safety', despair: 'Hope in despair', hope: 'Hope and strength',
};

const styles = StyleSheet.create({
  // hero (.companion-hero)
  hero: { padding: 22, borderRadius: 24, marginTop: 4 },
  heroKicker: { fontFamily: df.sansHeavy, fontSize: 9.5, letterSpacing: 1.3, color: '#FFC59E', marginTop: 22, textTransform: 'uppercase' },
  heroTitle: { fontFamily: df.display, fontSize: 27, lineHeight: 32, color: '#FFFFFF', marginTop: 6 },
  heroSub: { fontFamily: df.sans, fontSize: 13, lineHeight: 20, color: '#E5D1C2', marginTop: 6 },

  // chips (.prompt-chips)
  chips: { flexDirection: 'row', gap: 7, paddingVertical: 13 },
  chip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  chipOn: { backgroundColor: d.plum, borderColor: d.plum },
  chipText: { fontFamily: df.sans, fontSize: 12, color: d.muted },
  chipTextOn: { color: '#FFFFFF' },

  // input (.companion-input)
  inputCard: { padding: 14, borderRadius: 20, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  input: { minHeight: 105, fontFamily: df.sans, fontSize: 14, lineHeight: 20, color: d.ink, textAlignVertical: 'top' },
  inputFoot: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: d.line, paddingTop: 10, marginTop: 8 },
  privateTag: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  privateText: { fontFamily: df.sans, fontSize: 11, color: d.muted },
  sendBtn: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: d.plum },
  privacyText: { fontFamily: df.sans, fontSize: 11, color: d.muted, textAlign: 'center', marginTop: 12 },

  // crisis note (.crisis-note)
  crisisNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, marginTop: 10, borderRadius: 14, backgroundColor: (isDarkScheme() ? '#1a1a1a' : '#fbf3dc') },
  crisisNoteText: { flex: 1, fontFamily: df.sans, fontSize: 12, lineHeight: 17, color: (isDarkScheme() ? '#a3a3a3' : '#6b6b6b') },
  crisis: { backgroundColor: d.rose, borderWidth: 1, borderColor: d.roseDark, borderRadius: 20, padding: 16 },
  crisisTitle: { color: d.roseDark, fontFamily: df.sansBold, fontSize: 14.5, flexShrink: 1 },
  crisisText: { color: d.ink, fontFamily: df.sans, fontSize: 13, lineHeight: 19, marginTop: 6 },
  emergencyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  emergencyText: { color: d.roseDark, fontFamily: df.sansBold, fontSize: 13.5 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  lineName: { color: d.ink, fontSize: 13, fontFamily: df.sansBold },
  linePhone: { color: d.muted, fontSize: 13, marginTop: 1, fontFamily: df.sans },

  // simple-list (.simple-list)
  list: { marginTop: 2 },
  listRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: d.line, paddingVertical: 10 },
  listIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontFamily: df.display, fontSize: 14, color: d.ink },
  listSub: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 3 },

  // user + assistant bubbles (.user-bubble, .ai-bubble)
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  userBubble: { backgroundColor: d.ink, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 11, maxWidth: '82%' },
  userText: { color: '#FFFFFF', fontFamily: df.sans, fontSize: 13.5, lineHeight: 19 },
  aiWrap: { alignSelf: 'stretch' },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  aiAvatar: { backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  aiName: { fontFamily: df.sansBold, fontSize: 12.5, color: d.ink },
  ackBubble: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 16, borderTopLeftRadius: 4, padding: 15 },
  ackText: { fontFamily: df.display, fontSize: 15, lineHeight: 23, color: d.ink },
  themesLine: { fontFamily: df.sansHeavy, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: d.plum, marginTop: 10 },

  // cards (.passage / .reflect)
  card: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20, padding: 16 },
  body: { fontFamily: df.sans, fontSize: 13, lineHeight: 19, color: d.muted },
  errTitle: { fontFamily: df.displayBold, fontSize: 17, color: d.ink, marginBottom: 6 },
  blockHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: d.lavender },
  blockNum: { fontFamily: df.sansHeavy, fontSize: 10, color: d.plumDark },
  blockType: { fontFamily: df.sansBold, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: d.plumDark },
  blockSource: { flex: 1, fontFamily: df.sans, fontSize: 11, color: d.muted },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  scripture: { fontFamily: df.displayItalic, fontSize: 16, lineHeight: 26, color: d.ink, marginTop: 12 },
  whyBox: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: d.ivory },
  whyLabel: { fontFamily: df.sansHeavy, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: d.muted, marginBottom: 4 },
  encourage: { fontFamily: df.sans, fontSize: 14.5, lineHeight: 23, color: d.ink },
  prayerCard: { backgroundColor: d.lavender, borderColor: d.line, marginTop: 0 },
  prayer: { fontFamily: df.displayItalic, fontSize: 15.5, lineHeight: 25, color: d.ink, marginTop: 8 },
  aiNote: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 12, lineHeight: 16 },
  reflectRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  reflectNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: d.plum, color: '#FFFFFF', fontSize: 11, fontFamily: df.sansBold, textAlign: 'center', lineHeight: 22, overflow: 'hidden' },
  reflect: { flex: 1, fontFamily: df.displayItalic, fontSize: 14.5, color: d.ink, lineHeight: 21 },
  reflectInput: { marginTop: 6, minHeight: 84, padding: 12, borderRadius: 14, backgroundColor: d.ivory, fontFamily: df.sans, fontSize: 14, color: d.ink, textAlignVertical: 'top' },

  // buttons
  action: { height: 38, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionPrimary: { backgroundColor: d.plum },
  actionGhost: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  actionText: { fontFamily: df.sansBold, fontSize: 12, color: '#FFFFFF' },
});

export default CompanionScreen;
