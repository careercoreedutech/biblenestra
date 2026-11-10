// First-run intro: four swipeable screens that show what BibleNestra is for, shown before
// sign-in (online mode) or before the setup steps (local mode). Shown once per install —
// "Skip" or "Get started" stores a flag in AsyncStorage. The setup flow (name, Bible, church,
// connect) still runs afterwards from OnboardingScreen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts, radius, shadow } from '../theme';
import { NightGlow, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale, Pulse, ScaleIn } from '../components/Motion';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { ensurePermission, supported as popsSupported } from '../notifications/scripturePop';

export const INTRO_KEY = 'biblenestra:introSeen:v1';

// ---------- hero illustrations (built from the app's own icons, no image assets) ----------

function Chip({ icon, label, tint = colors.goldLight }) {
  return (
    <View style={styles.chip}>
      <Icon name={icon} size={13} color={tint} strokeWidth={2.2} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function Orb({ icon, size = 76 }) {
  return (
    <View style={[styles.orbWrap, { width: size + 28, height: size + 28 }]}>
      <Pulse min={0.94} max={1.06} duration={2400} style={[styles.orbHalo, { width: size + 28, height: size + 28, borderRadius: (size + 28) / 2 }]} />
      <View style={[styles.orb, { width: size, height: size, borderRadius: size / 2 }]}>
        <Icon name={icon} size={Math.round(size * 0.42)} color={colors.goldLight} strokeWidth={1.7} />
      </View>
    </View>
  );
}

function BibleArt() {
  return (
    <>
      <View style={styles.chipRow}>
        <Chip icon="globe" label="57 translations" />
        <Chip icon="headphones" label="Listen aloud" />
      </View>
      <ScaleIn from={0.7} delay={80}><Orb icon="book" /></ScaleIn>
      <View style={styles.verseCard}>
        <Text style={styles.verseText}>“Thy word is a lamp unto my feet, and a light unto my path.”</Text>
        <Text style={styles.verseRef}>Psalm 119:105 · KJV</Text>
      </View>
    </>
  );
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
function RhythmArt() {
  return (
    <>
      <View style={styles.chipRow}>
        <Chip icon="sun" label="Verse of the day" />
        <Chip icon="flame" label="5-day streak" tint="#F0A35E" />
      </View>
      <View style={styles.week}>
        {WEEK.map((d, i) => (
          <View key={i} style={styles.weekDay}>
            <Text style={styles.weekLabel}>{d}</Text>
            {i < 4 ? (
              <View style={[styles.weekDot, styles.weekDone]}><Icon name="check" size={13} color={colors.night} strokeWidth={3} /></View>
            ) : i === 4 ? (
              <View style={[styles.weekDot, styles.weekToday]}><Text style={styles.weekTodayText}>F</Text></View>
            ) : (
              <View style={[styles.weekDot, styles.weekLater]} />
            )}
          </View>
        ))}
      </View>
      <View style={styles.steps}>
        {['Verse', 'Read', 'Pray', 'Reflect'].map((s, i) => (
          <View key={s} style={styles.stepCol}>
            <View style={[styles.stepBar, i < 2 && styles.stepBarOn]} />
            <Text style={[styles.stepText, i < 2 && { color: colors.nightFg }]}>{s}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function CommunityArt() {
  return (
    <>
      <View style={styles.chipRow}>
        <Chip icon="prayer" label="Prayer wall" />
        <Chip icon="users" label="Communities" />
      </View>
      <View style={styles.prayerCard}>
        <View style={styles.prayerHead}>
          <View style={styles.avatar}><Text style={styles.avatarText}>AO</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.prayerName} numberOfLines={1}>Amaka O.</Text>
            <Text style={styles.prayerMeta} numberOfLines={1}>Church · 2h</Text>
          </View>
        </View>
        <Text style={styles.prayerTitle} numberOfLines={2}>Please pray for my mother's surgery on Monday</Text>
        <View style={styles.prayerFoot}>
          <View style={styles.prayingPill}>
            <Icon name="prayer" size={13} color={colors.primary} strokeWidth={2.2} />
            <Text style={styles.prayingText}>I'm praying</Text>
          </View>
          <Text style={styles.prayerCount}>24 praying</Text>
        </View>
      </View>
    </>
  );
}

const TOOLS = [
  { icon: 'quiz', label: 'Bible games' },
  { icon: 'sparkles', label: 'Ask AI' },
  { icon: 'mic', label: 'Sermon notes' },
  { icon: 'calendar', label: 'Reading plans' },
];
function LearnArt() {
  return (
    <>
      <View style={styles.chipRow}>
        <Chip icon="star" label="New questions daily" />
      </View>
      <View style={styles.toolGrid}>
        {TOOLS.map((t, i) => (
          <ScaleIn key={t.label} from={0.8} delay={60 + i * 70} style={styles.toolCell}>
            <View style={styles.tool}>
              <View style={styles.toolIcon}><Icon name={t.icon} size={18} color={colors.goldLight} strokeWidth={2} /></View>
              <Text style={styles.toolText} numberOfLines={1}>{t.label}</Text>
            </View>
          </ScaleIn>
        ))}
      </View>
    </>
  );
}

function PopArt() {
  return (
    <>
      <View style={styles.chipRow}>
        <Chip icon="bell" label="Scripture pop-ups" />
        <Chip icon="moon" label="Quiet at night" />
      </View>
      <View style={styles.notif}>
        <View style={styles.notifHead}>
          <View style={styles.notifIcon}><Icon name="cross" size={11} color={colors.goldLight} strokeWidth={2.4} /></View>
          <Text style={styles.notifApp}>BibleNestra · now</Text>
        </View>
        <Text style={styles.notifTitle}>✦ Scripture for this moment</Text>
        <Text style={styles.notifBody} numberOfLines={2}>“Trust in the LORD with all thine heart; and lean not unto thine own understanding.” — Proverbs 3:5</Text>
      </View>
    </>
  );
}

const POP_CONTENT = [
  { id: 'both', label: 'Both' },
  { id: 'verses', label: 'Scriptures' },
  { id: 'prayers', label: 'Prayers' },
];
const POP_EVERY = [
  { every: 60, label: 'Every hour' },
  { every: 180, label: 'Every 3 hours' },
  { every: 360, label: 'Every 6 hours' },
  { every: 720, label: 'Twice a day' },
];

function Choice({ on, label, onPress, style }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.96} style={[styles.choice, on && styles.choiceOn, style]} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label}>
      <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{label}</Text>
    </PressScale>
  );
}

// The pop-ups slide's own controls: on/off, what to send, how often.
function PopChoices({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <View style={styles.popBox}>
      <View style={styles.choiceRow}>
        <Choice on={value.enabled} label="Yes, send pop-ups" onPress={() => set({ enabled: true })} style={{ flex: 1 }} />
        <Choice on={!value.enabled} label="Not now" onPress={() => set({ enabled: false })} style={{ flex: 1 }} />
      </View>
      {value.enabled ? (
        <>
          <Text style={styles.popLabel}>What to send</Text>
          <View style={styles.choiceRow}>
            {POP_CONTENT.map((c) => <Choice key={c.id} on={value.content === c.id} label={c.label} onPress={() => set({ content: c.id })} style={{ flex: 1 }} />)}
          </View>
          <Text style={styles.popLabel}>How often</Text>
          <View style={styles.choiceWrap}>
            {POP_EVERY.map((e) => <Choice key={e.every} on={value.every === e.every} label={e.label} onPress={() => set({ every: e.every })} />)}
          </View>
          <Text style={styles.popNote}>Quiet from 10 pm to 7 am. Change any time on Today › Scripture pop-ups.</Text>
        </>
      ) : (
        <Text style={styles.popNote}>You can turn them on later on Today › Scripture pop-ups.</Text>
      )}
    </View>
  );
}

const SLIDES = [
  {
    id: 'bible',
    eyebrow: 'The Word',
    title: 'Read the Bible your way',
    body: 'The full KJV works offline, with 56 more translations in 34 languages when you need them.',
    points: [
      { icon: 'headphones', text: 'Listen verse by verse, with a sleep timer' },
      { icon: 'search', text: "Search every verse, with Strong's concordance" },
      { icon: 'highlight', text: 'Highlights, notes and bookmarks on every device' },
    ],
    Art: BibleArt,
  },
  {
    id: 'rhythm',
    eyebrow: 'Daily rhythm',
    title: 'Make time with God every day',
    body: 'A verse, a reading, a prayer and a moment to reflect. About twelve minutes a day.',
    points: [
      { icon: 'sun', text: 'A new verse of the day every morning' },
      { icon: 'flame', text: 'Streaks with one grace day each week' },
      { icon: 'bell', text: 'Reminders at the time you choose' },
    ],
    Art: RhythmArt,
  },
  {
    id: 'community',
    eyebrow: 'Fellowship',
    title: 'Pray and grow together',
    body: 'Share prayer requests, pray for others and stay close to your church.',
    points: [
      { icon: 'prayer', text: 'Prayer wall, with updates when prayers are answered' },
      { icon: 'chat', text: 'Communities, group chats and direct messages' },
      { icon: 'video', text: 'A feed and videos from believers' },
    ],
    Art: CommunityArt,
  },
  {
    id: 'learn',
    eyebrow: 'Grow',
    title: 'Learn, ask and serve',
    body: 'Reading plans, daily Bible games and answers that point you back to Scripture.',
    points: [
      { icon: 'quiz', text: 'Trivia and verse games, with coins for your first round' },
      { icon: 'sparkles', text: 'Ask AI, with the verses behind every answer' },
      { icon: 'mic', text: 'Record a sermon and get a transcript and notes' },
    ],
    Art: LearnArt,
  },
  {
    id: 'pop',
    eyebrow: 'Scripture pop-ups',
    title: "Let God's Word find you through the day",
    body: 'A short verse or prayer pops up on your phone at the times you choose.',
    choices: true,
    Art: PopArt,
  },
];

// ---------- the intro itself ----------

export function IntroView({ onDone }) {
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef(null);
  const [page, setPage] = useState(0);
  const [pop, setPop] = useState({ enabled: true, content: 'both', every: 180 });
  const last = page === SLIDES.length - 1;
  const contentW = Math.max(260, Math.min(width - 32, 520));
  const compact = height < 720;

  // While a Next/dot tap is animating the pager, ignore the in-between scroll positions —
  // otherwise the page briefly rounds back and a quick second tap is lost.
  const target = useRef(null);
  const targetTimer = useRef(null);
  useEffect(() => () => clearTimeout(targetTimer.current), []);
  const goTo = (i) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, i));
    target.current = next;
    clearTimeout(targetTimer.current);
    targetTimer.current = setTimeout(() => { target.current = null; }, 700);
    if (scrollRef.current) scrollRef.current.scrollTo({ x: next * width, animated: true });
    setPage(next);
  };
  const onScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    if (target.current != null) {
      if (Math.abs(x - target.current * width) < 2) target.current = null;
      return;
    }
    const p = Math.round(x / Math.max(width, 1));
    if (p !== page && p >= 0 && p < SLIDES.length) setPage(p);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={[styles.topBar, { width: contentW }]}>
        <View style={styles.brand}>
          <View style={styles.brandMark}><Icon name="cross" size={14} color={colors.goldLight} strokeWidth={2.4} /></View>
          <Text style={styles.brandText}>BibleNestra</Text>
        </View>
        {last ? <View style={styles.skipSpace} /> : (
          <PressScale onPress={() => onDone('skip')} hitSlop={10} style={styles.skipBtn} accessibilityRole="button" accessibilityLabel="Skip the introduction">
            <Text style={styles.skipText}>Skip</Text>
          </PressScale>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {SLIDES.map((s, i) => {
          const active = i === page;
          const Art = s.Art;
          return (
            <ScrollView
              key={s.id}
              style={{ width }}
              contentContainerStyle={styles.slide}
              showsVerticalScrollIndicator={false}
              accessibilityLabel={`${i + 1} of ${SLIDES.length}: ${s.title}`}
            >
              <View style={{ width: contentW }}>
                <View style={[styles.hero, { minHeight: compact ? 200 : 250 }]}>
                  <NightGlow intensity={1.1} />
                  <View key={active ? 'on' : 'off'} style={styles.heroInner}><Art /></View>
                </View>
                <FadeInUp key={active ? 'on' : 'off'} distance={10} duration={380}>
                  <Text style={styles.eyebrow}>{s.eyebrow}</Text>
                  <Text style={[styles.title, compact && { fontSize: 25, lineHeight: 30 }]}>{s.title}</Text>
                  <Text style={styles.body}>{s.body}</Text>
                </FadeInUp>
                {s.choices ? <PopChoices value={pop} onChange={setPop} /> : (
                <View style={[styles.points, compact && { marginTop: 14 }]}>
                  {s.points.map((p, j) => (
                    <FadeInUp key={`${p.icon}-${active ? 'on' : 'off'}`} index={j} delay={120} distance={8} duration={340}>
                      <View style={styles.point}>
                        <View style={styles.pointIcon}><Icon name={p.icon} size={16} color={colors.primary} strokeWidth={2} /></View>
                        <Text style={styles.pointText}>{p.text}</Text>
                      </View>
                    </FadeInUp>
                  ))}
                </View>
                )}
              </View>
            </ScrollView>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { width: contentW }]}>
        <View style={styles.dots} accessibilityLabel={`Screen ${page + 1} of ${SLIDES.length}`}>
          {SLIDES.map((s, i) => (
            <PressScale key={s.id} onPress={() => goTo(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Go to screen ${i + 1}`}>
              <View style={[styles.dot, i === page && styles.dotOn]} />
            </PressScale>
          ))}
        </View>
        <PressScale
          onPress={() => (last ? onDone('done', pop) : goTo(page + 1))}
          scaleTo={0.97}
          style={[styles.cta, last && styles.ctaLast]}
          accessibilityRole="button"
          accessibilityLabel={last ? 'Get started' : 'Next'}
        >
          <Text style={styles.ctaText}>{last ? 'Get started' : 'Next'}</Text>
          <Icon name="arrow-right" size={16} color="#FFFFFF" strokeWidth={2.2} />
        </PressScale>
      </View>
    </SafeAreaView>
  );
}

// Wraps the app: shows the intro on first launch, then the children from then on.
export function IntroGate({ children }) {
  const { dispatch } = useStore();
  const toast = useToast();
  const [seen, setSeen] = useState(null); // null while reading storage
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => { if (alive) setSeen(v === '1'); })
      .catch(() => { if (alive) setSeen(true); }); // storage unavailable: never block the app
    return () => { alive = false; };
  }, []);
  const finish = useCallback(async (kind, pop) => {
    setSeen(true);
    AsyncStorage.setItem(INTRO_KEY, '1').catch(() => {});
    // Scripture pop-ups chosen on the last intro screen (Skip leaves them as they are)
    if (kind === 'done' && pop) {
      let enabled = !!pop.enabled;
      if (enabled && popsSupported) {
        const ok = await ensurePermission().catch(() => false);
        if (!ok) { enabled = false; toast.show('Allow notifications for BibleNestra to get Scripture pop-ups', { icon: 'bell', tone: 'error' }); }
      }
      dispatch({ type: 'scripturePop', patch: { enabled, content: pop.content, every: pop.every } });
      if (enabled) toast.show('Scripture pop-ups are on ✦', { icon: 'bell', haptic: 'success' });
    }
  }, [dispatch, toast]);
  if (seen === null) return <View style={styles.blank} />;
  if (!seen) return <IntroView onDone={finish} />;
  return children;
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.screen },
  safe: { flex: 1, backgroundColor: colors.screen, alignItems: 'center' },
  pager: { flex: 1, alignSelf: 'stretch' },
  slide: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, letterSpacing: -0.2 },
  skipBtn: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  skipSpace: { height: 36 },

  hero: { borderRadius: 26, overflow: 'hidden', backgroundColor: colors.night, ...shadow.md },
  heroInner: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingHorizontal: 16, paddingVertical: 16 },

  chipRow: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: colors.nightBorder },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.nightFg },

  orbWrap: { alignItems: 'center', justifyContent: 'center' },
  orbHalo: { position: 'absolute', backgroundColor: alpha('#D4A852', 0.14) },
  orb: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1.5, borderColor: alpha('#D4A852', 0.55), alignItems: 'center', justifyContent: 'center' },

  verseCard: { alignSelf: 'stretch', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.nightBorder },
  verseText: { fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 20, color: colors.nightFg },
  verseRef: { marginTop: 4, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: colors.goldLight },

  week: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  weekDay: { alignItems: 'center', gap: 6 },
  weekLabel: { fontSize: 11, fontWeight: '700', color: colors.nightMuted },
  weekDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  weekDone: { backgroundColor: colors.goldLight },
  weekToday: { borderWidth: 2, borderColor: colors.goldLight },
  weekTodayText: { fontSize: 12, fontWeight: '700', color: colors.goldLight },
  weekLater: { backgroundColor: 'rgba(255,255,255,0.07)' },
  steps: { alignSelf: 'stretch', flexDirection: 'row', gap: 8 },
  stepCol: { flex: 1, gap: 6 },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  stepBarOn: { backgroundColor: colors.goldLight },
  stepText: { fontSize: 11, fontWeight: '600', color: colors.nightMuted },

  prayerCard: { alignSelf: 'stretch', borderRadius: radius.md, padding: 12, backgroundColor: colors.surface, ...shadow.sm },
  prayerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.serifBold, fontSize: 12, color: colors.rose },
  prayerName: { fontSize: 13, fontWeight: '700', color: colors.fg },
  prayerMeta: { fontSize: 11, color: colors.faint, marginTop: 1 },
  prayerTitle: { fontFamily: fonts.serifBold, fontSize: 15, lineHeight: 20, color: colors.fg, marginTop: 8 },
  prayerFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  prayingPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  prayingText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  prayerCount: { fontSize: 12, color: colors.muted },

  toolGrid: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  toolCell: { width: '48.5%' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, height: 52, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.nightBorder },
  toolIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: alpha('#D4A852', 0.14), alignItems: 'center', justifyContent: 'center' },
  toolText: { fontSize: 13, fontWeight: '600', color: colors.nightFg, flexShrink: 1 },

  notif: { alignSelf: 'stretch', borderRadius: radius.md, padding: 12, backgroundColor: colors.surface, ...shadow.sm },
  notifHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifIcon: { width: 18, height: 18, borderRadius: 5, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  notifApp: { fontSize: 11, color: colors.faint },
  notifTitle: { marginTop: 6, fontSize: 13.5, fontWeight: '700', color: colors.fg },
  notifBody: { marginTop: 2, fontFamily: fonts.serifItalic, fontSize: 13.5, lineHeight: 19, color: colors.passage },

  popBox: { marginTop: 16 },
  popLabel: { marginTop: 14, marginBottom: 8, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.muted },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 42, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  choiceTextOn: { color: colors.primary },
  popNote: { marginTop: 12, fontSize: 12.5, lineHeight: 17, color: colors.faint },

  eyebrow: { marginTop: 22, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.gold },
  title: { marginTop: 6, fontFamily: fonts.serifBold, fontSize: 29, lineHeight: 35, letterSpacing: -0.5, color: colors.fg },
  body: { marginTop: 8, fontSize: 15, lineHeight: 22, color: colors.muted },

  points: { marginTop: 18, gap: 10 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.fg },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 14 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
  dotOn: { width: 24, backgroundColor: colors.primary },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 50, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.primary, ...shadow.sm },
  ctaLast: { paddingHorizontal: 26 },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
