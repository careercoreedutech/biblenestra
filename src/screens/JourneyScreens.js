// MY SCRIPTURE JOURNEY (Daily Scripture Tracker). Screens:
//   JourneyHomeScreen   the dashboard: today's ring, week and month, unique coverage, streak, calendar heatmap,
//                       books and chapters, achievements, notifications, "Continue where you stopped", entry points
//   JourneySetupScreen  goals (presets or any number), books and translation, delivery and times, a physical-Bible entry
// Data: src/api/journey.js (server) and src/journey/* (the reader and the notifications). Look: the Figma kit (sanctuary).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Icon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { useNav, useIsFocused } from '../navigation';
import { useApi } from '../api/auth';
import { alpha } from '../components/ui';
import { d, df, Tap, Grad, Eyebrow, SectionTitle, gradients } from '../design/sanctuary';
import { DScreen, DCard, DInput, DLabel, DToggle } from '../design/profile/parts';
import { BOOKS, refLabel, bookName } from '../data/bible';
import { TRANSLATIONS } from '../bible/catalog';
import { useStore } from '../store';
import { useJourneyStats, useJourneyGoal, useJourneyConfig, saveJourneyGoal, journeyChanged } from '../api/journey';
import { enqueueManual, flushSoon, localTodayVerses } from '../journey/tracker';
import { portionSummary, markPortionRead } from '../journey/schedule';

const PRESETS = [50, 100, 200, 500, 1000];
const TIME_OPTIONS = ['06:00', '07:00', '08:00', '09:00', '10:00', '12:00', '13:00', '15:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
const DELIVERY = [
  { id: 'reading', label: 'In-app reading' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'both', label: 'Both' },
];
const ymd = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const pctOf = (n, t) => (t > 0 ? Math.min(100, Math.round((n * 100) / t)) : 0);

/** A ring with a percentage in the middle (the design's progress ring). */
export function ProgressRing({ pct = 0, size = 150, stroke = 12, color = d.plum, track = d.line, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} />
      </Svg>
      {children}
    </View>
  );
}

function Bar({ pct, color = d.plum }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: d.line, overflow: 'hidden' }}>
      <View style={{ height: 8, width: `${Math.min(100, pct)}%`, backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

function Stat({ label, value, sub, progress }) {
  return (
    <DCard style={{ flex: 1, padding: 14 }}>
      <Text style={{ fontFamily: df.sansMedium, fontSize: 12, color: d.muted }}>{label}</Text>
      <Text style={{ fontFamily: df.displayBold, fontSize: 22, color: d.ink, marginTop: 4 }}>{value}</Text>
      {sub ? <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 2 }}>{sub}</Text> : null}
      {progress !== undefined ? <View style={{ marginTop: 10 }}><Bar pct={progress} /></View> : null}
    </DCard>
  );
}

function Heatmap({ calendar, today }) {
  // the last 13 weeks, Monday first, one column per week
  const byDay = new Map((calendar || []).map((c) => [c.day, c.verses]));
  const end = new Date(`${today}T00:00:00`);
  const weeks = 13;
  const start = new Date(end);
  start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cols = [];
  for (let w = 0; w < weeks; w += 1) {
    const col = [];
    for (let i = 0; i < 7; i += 1) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + w * 7 + i);
      const key = ymd(dt);
      const future = key > today;
      col.push({ key, v: future ? -1 : (byDay.get(key) || 0) });
    }
    cols.push(col);
  }
  const shade = (v) => {
    if (v < 0) return 'transparent';
    if (v === 0) return d.line;
    if (v < 50) return alpha(d.plum, 0.25);
    if (v < 200) return alpha(d.plum, 0.5);
    if (v < 500) return alpha(d.plum, 0.75);
    return d.plum;
  };
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {cols.map((col, ci) => (
        <View key={`c${ci}`} style={{ gap: 4 }}>
          {col.map((cell) => (
            <View key={cell.key} accessibilityLabel={`${cell.key}: ${cell.v < 0 ? 'not yet' : `${cell.v} verses`}`}
              style={{ width: 13, height: 13, borderRadius: 3, backgroundColor: shade(cell.v) }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function JourneyHomeScreen() {
  const nav = useNav();
  const api = useApi();
  const focused = useIsFocused();
  const toast = useToast();
  const stats = useJourneyStats();
  const goal = useJourneyGoal();
  const { state } = useStore();
  const [local, setLocal] = useState(0);
  const [portions, setPortions] = useState(null);
  const s = stats.data;

  useEffect(() => { if (focused) { stats.reload(); goal.reload(); portionSummary().then(setPortions); localTodayVerses().then(setLocal); } }, [focused]);

  const dayTarget = s ? s.day.target : 0;
  const dayPct = s ? s.day.pct : 0;
  const share = async () => {
    if (!s) return;
    const text = `My Scripture journey: ${fmt(s.day.verses)} verses today, a ${s.streak.current}-day reading streak on BibleNestra.`;
    try { await Share.share({ message: `${text} https://biblenestra.com` }); } catch (e) { /* cancelled */ }
  };

  if (!s && stats.loaded === false) {
    return <DScreen title="My Scripture Journey" subtitle="Daily Scripture tracker" back onBack={() => nav.pop()}><ActivityIndicator color={d.plum} style={{ marginTop: 40 }} /></DScreen>;
  }

  return (
    <DScreen title="My Scripture Journey" subtitle="Daily Scripture tracker" back onBack={() => nav.pop()}
      action={<Pressable onPress={share} accessibilityLabel="Share your progress" hitSlop={8} style={{ padding: 6 }}><Icon name="share" size={20} color={d.ink} /></Pressable>}>
      {!api.online ? (
        <DCard style={{ marginBottom: 12 }}><Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>Offline. Readings are saved on this phone and sent when you are back online. Today so far: {fmt(local)} verses.</Text></DCard>
      ) : null}

      {/* today: ring against the daily target */}
      <DCard style={{ alignItems: 'center', paddingVertical: 22 }}>
        <Eyebrow>Today</Eyebrow>
        <View style={{ marginTop: 14 }}>
          <ProgressRing pct={dayTarget ? dayPct : 0} size={164} stroke={14}>
            <Text style={{ fontFamily: df.displayBold, fontSize: 30, color: d.ink }}>{dayTarget ? `${dayPct}%` : fmt(s ? s.day.verses : local)}</Text>
            <Text style={{ fontFamily: df.sans, fontSize: 12, color: d.muted }}>{dayTarget ? `${fmt(s.day.verses)} of ${fmt(dayTarget)} verses` : 'verses read today'}</Text>
          </ProgressRing>
        </View>
        {!dayTarget ? (
          <Tap onPress={() => nav.push('JourneySetup')} style={{ marginTop: 14 }}><Text style={{ fontFamily: df.sansSemi, color: d.plum }}>Set a daily goal</Text></Tap>
        ) : s.day.met ? (
          <Text style={{ fontFamily: df.sansSemi, color: d.sageDark, marginTop: 12 }}>Goal met today</Text>
        ) : null}
      </DCard>

      {/* week and month */}
      {s ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Stat label="This week" value={fmt(s.week.verses)} sub={s.week.target ? `goal ${fmt(s.week.target)}` : 'no weekly goal'} progress={s.week.target ? s.week.pct : undefined} />
          <Stat label="This month" value={fmt(s.month.verses)} sub={s.month.target ? `goal ${fmt(s.month.target)}` : 'no monthly goal'} progress={s.month.target ? s.month.pct : undefined} />
        </View>
      ) : null}
      {s ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <Stat label="Unique verses" value={fmt(s.totals.uniqueVerses)} sub={`${fmt(s.day.unique)} new today`} />
          <Stat label="Current streak" value={`${s.streak.current} d`} sub={`longest ${s.streak.longest} days`} />
        </View>
      ) : null}

      {/* continue where you stopped */}
      {s && s.continueFrom ? (
        <Tap onPress={() => nav.push('Bible', { bookId: s.continueFrom.bookId, chapter: s.continueFrom.chapter, verse: s.continueFrom.verseStart })} style={{ marginTop: 12 }}>
          <DCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Grad colors={gradients.orange} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="arrow-right" size={18} color="#fff" />
            </Grad>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: df.sansSemi, color: d.ink, fontSize: 15 }}>Continue where you stopped</Text>
              <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13, marginTop: 2 }}>{refLabel(s.continueFrom.bookId, s.continueFrom.chapter, s.continueFrom.verseStart)}{s.continueFrom.verseEnd > s.continueFrom.verseStart ? `–${s.continueFrom.verseEnd}` : ''}</Text>
            </View>
          </DCard>
        </Tap>
      ) : null}

      {/* calendar heatmap */}
      {s ? (
        <>
          <SectionTitle eyebrow="Reading history" title="Last 13 weeks" />
          <DCard><Heatmap calendar={s.calendar} today={s.today} /></DCard>
        </>
      ) : null}

      {/* books and chapters */}
      {s ? (
        <>
          <SectionTitle eyebrow="Coverage" title={`${s.coverage.booksCompleted} books completed`} />
          <DCard style={{ gap: 14 }}>
            <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>
              {fmt(s.coverage.chaptersCompleted)} of {fmt(s.coverage.chaptersTotal)} chapters · {fmt(s.totals.uniqueVerses)} of {fmt(s.coverage.versesTotal)} verses
            </Text>
            {s.scope.books ? <Text style={{ fontFamily: df.sansMedium, color: d.ink, fontSize: 13 }}>Your study scope: {s.scope.pct}% ({fmt(s.scope.versesUnique)} of {fmt(s.scope.versesTotal)})</Text> : null}
            {s.books.length === 0 ? <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>Start reading and your books appear here.</Text> : null}
            {s.books.slice(0, 12).map((b) => (
              <View key={b.bookId} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: df.sansMedium, color: d.ink, fontSize: 13 }}>{bookName(b.bookId)}{b.completed ? '  ✓' : ''}</Text>
                  <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 12 }}>{b.chaptersCompleted} ch · {pctOf(b.versesUnique, b.versesTotal)}%</Text>
                </View>
                <Bar pct={pctOf(b.versesUnique, b.versesTotal)} color={b.completed ? d.sageDark : d.plum} />
              </View>
            ))}
          </DCard>
        </>
      ) : null}

      {/* achievements */}
      <SectionTitle eyebrow="Achievements" title="Milestones and goals" />
      <AchievementsList />

      {/* notifications and portions */}
      {portions ? (
        <>
          <SectionTitle eyebrow="Scripture reminders" title="Your reading portions" />
          <DCard style={{ gap: 10 }}>
            <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>Delivered {portions.delivered} · Read {portions.read} · Coming up {portions.scheduled}</Text>
            {portions.upcoming.slice(0, 3).map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="clock" size={14} color={d.muted} />
                <Text style={{ flex: 1, fontFamily: df.sans, color: d.ink, fontSize: 13 }}>{refLabel(p.bookId, p.chapter, p.verse)}{p.verseEnd > p.verse ? `–${p.verseEnd}` : ''} · {new Date(p.at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            ))}
            {portions.recent.filter((p) => p.status === 'delivered').slice(0, 3).map((p) => (
              <Tap key={p.id} onPress={async () => { await markPortionRead(p.id); setPortions(await portionSummary()); toast.show('Marked as read', { icon: 'check', haptic: 'light' }); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ flex: 1, fontFamily: df.sans, color: d.ink, fontSize: 13 }}>{refLabel(p.bookId, p.chapter, p.verse)}</Text>
                <Text style={{ fontFamily: df.sansSemi, color: d.plum, fontSize: 13 }}>Mark read</Text>
              </Tap>
            ))}
          </DCard>
        </>
      ) : null}

      {/* entry points */}
      <View style={{ gap: 10, marginTop: 16 }}>
        <Tap onPress={() => nav.push('JourneySetup')} accessibilityLabel="Goals and reminders">
          <DCard style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="bell" size={18} color={d.plum} />
            <View style={{ flex: 1 }}><Text style={{ fontFamily: df.sansSemi, color: d.ink }}>Goals, books and reminders</Text><Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 12 }}>Presets, any number, your times</Text></View>
            <Icon name="chevron-right" size={16} color={d.muted} />
          </DCard>
        </Tap>
        <Tap onPress={() => nav.push('JourneyGroups')} accessibilityLabel="Community goals">
          <DCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="users" size={18} color={d.plum} />
            <View style={{ flex: 1 }}><Text style={{ fontFamily: df.sansSemi, color: d.ink }}>Community goals</Text><Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 12 }}>Family, friends, study groups and churches</Text></View>
            <Icon name="chevron-right" size={16} color={d.muted} />
          </DCard>
        </Tap>
      </View>
      <View style={{ height: 8 }} />
    </DScreen>
  );
}

function AchievementsList() {
  const api = useApi();
  const [items, setItems] = useState(null);
  const focused = useIsFocused();
  useEffect(() => {
    if (!api.online || !focused) return;
    api.request('GET', '/journey/achievements').then((r) => setItems(r.items || [])).catch(() => setItems([]));
  }, [api.online, focused]);
  if (items === null) return null;
  if (!items.length) return <DCard><Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 13 }}>Your first milestone is one reading away.</Text></DCard>;
  return (
    <DCard style={{ gap: 10 }}>
      {items.slice(0, 8).map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Grad colors={gradients.gold} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="star" size={14} color="#fff" />
          </Grad>
          <Text style={{ flex: 1, fontFamily: df.sans, color: d.ink, fontSize: 13 }}>{a.message}</Text>
        </View>
      ))}
    </DCard>
  );
}

// ───────── setup ─────────
function Chip({ label, on, onPress, a11y }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y || label} accessibilityState={{ selected: !!on }}
      style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? d.plum : d.line, backgroundColor: on ? alpha(d.plum, 0.12) : d.paper }}>
      <Text style={{ fontFamily: df.sansMedium, fontSize: 13, color: on ? d.plumDark : d.ink }}>{label}</Text>
    </Pressable>
  );
}

export function JourneySetupScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const goal = useJourneyGoal();
  const config = useJourneyConfig();
  const { state } = useStore();
  const g = goal.data && goal.data.goal ? goal.data.goal : null;
  const presets = (config.data && config.data.presets) || PRESETS;
  const maxPush = Math.min(6, (config.data && config.data.maxPushPerDay) || 6);
  const quiet = state.scripturePop || {};

  const [daily, setDaily] = useState('');
  const [weekly, setWeekly] = useState('');
  const [monthly, setMonthly] = useState('');
  const [wholeBible, setWholeBible] = useState(true);
  const [books, setBooks] = useState([]);
  const [translation, setTranslation] = useState('KJV');
  const [delivery, setDelivery] = useState('both');
  const [times, setTimes] = useState(['08:00', '13:00', '19:00']);
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState({ bookId: 'JHN', chapter: '3', verseStart: '16', verseEnd: '', date: ymd() });

  useEffect(() => {
    if (!g) return;
    setDaily(g.dailyTarget ? String(g.dailyTarget) : '');
    setWeekly(g.weeklyTarget ? String(g.weeklyTarget) : '');
    setMonthly(g.monthlyTarget ? String(g.monthlyTarget) : '');
    setWholeBible(!g.books || !g.books.length);
    setBooks(g.books || []);
    setTranslation(g.translation || 'KJV');
    setDelivery(g.delivery || 'both');
    setTimes(g.notifyTimes && g.notifyTimes.length ? g.notifyTimes : ['08:00', '13:00', '19:00']);
  }, [g && g.set, g && g.dailyTarget, g && g.translation]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBook = (id) => setBooks((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));
  const toggleTime = (t) => setTimes((cur) => {
    if (cur.includes(t)) return cur.filter((x) => x !== t);
    if (cur.length >= maxPush) { toast.show(`Up to ${maxPush} reminders a day`, { icon: 'bell' }); return cur; }
    return [...cur, t].sort();
  });
  const whole = (v) => { const n = Number(String(v).replace(/[, ]/g, '')); return v === '' ? 0 : (Number.isInteger(n) && n >= 0 ? n : NaN); };

  const save = async () => {
    const d1 = whole(daily); const w1 = whole(weekly); const m1 = whole(monthly);
    if ([d1, w1, m1].some((n) => Number.isNaN(n))) { toast.show('Goals are whole numbers, for example 200', { icon: 'bell' }); return; }
    setSaving(true);
    try {
      await saveJourneyGoal(api, {
        dailyTarget: d1, weeklyTarget: w1, monthlyTarget: m1,
        books: wholeBible ? [] : books, translation, delivery, notifyTimes: times, notifyPerDay: Math.min(maxPush, times.length),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      });
      await goal.reload();
      toast.show('Your journey is saved', { icon: 'check', haptic: 'success' });
    } catch (e) {
      toast.show((e && e.message) || 'Could not save', { icon: 'bell' });
    } finally {
      setSaving(false);
    }
  };

  const addManual = async () => {
    const vs = Number(log.verseStart);
    const ve = log.verseEnd ? Number(log.verseEnd) : vs;
    const ch = Number(log.chapter);
    if (!Number.isInteger(vs) || !Number.isInteger(ve) || !Number.isInteger(ch) || ve < vs) { toast.show('Check the chapter and verses', { icon: 'book' }); return; }
    try {
      await enqueueManual({ translation, bookId: log.bookId, chapter: ch, verseStart: vs, verseEnd: ve, date: log.date });
      flushSoon();
      journeyChanged();
      toast.show(`${refLabel(log.bookId, ch, vs)}${ve > vs ? `–${ve}` : ''} added to your journey`, { icon: 'check', haptic: 'success' });
    } catch (e) {
      toast.show('Could not save this entry', { icon: 'book' });
    }
  };

  const trOptions = useMemo(() => TRANSLATIONS.slice(0, 14), []);
  return (
    <DScreen title="Goals and reminders" subtitle="My Scripture Journey" back onBack={() => nav.pop()}>
      <Eyebrow>Verses a day</Eyebrow>
      <DCard style={{ marginTop: 10, gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {presets.map((p) => <Chip key={p} label={fmt(p)} on={String(daily) === String(p)} onPress={() => setDaily(String(p))} a11y={`${p} verses a day`} />)}
        </View>
        <DLabel>Any number a day</DLabel>
        <DInput value={daily} onChangeText={setDaily} keyboardType="number-pad" placeholder="For example 75" accessibilityLabel="Daily verses" />
        <DLabel>Weekly verses (optional)</DLabel>
        <DInput value={weekly} onChangeText={setWeekly} keyboardType="number-pad" placeholder="For example 1400" accessibilityLabel="Weekly verses" />
        <DLabel>Monthly verses (optional)</DLabel>
        <DInput value={monthly} onChangeText={setMonthly} keyboardType="number-pad" placeholder="For example 6000" accessibilityLabel="Monthly verses" />
      </DCard>

      <SectionTitle eyebrow="Study" title="Books and translation" />
      <DCard style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: df.sansSemi, color: d.ink }}>The whole Bible</Text>
          <DToggle value={wholeBible} onChange={setWholeBible} accessibilityLabel="Whole Bible" />
        </View>
        {!wholeBible ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {BOOKS.map((b) => <Chip key={b.id} label={b.name} on={books.includes(b.id)} onPress={() => toggleBook(b.id)} />)}
          </View>
        ) : null}
        <DLabel>Translation</DLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {trOptions.map((t) => <Chip key={t.id} label={t.id} on={translation === t.id} onPress={() => setTranslation(t.id)} a11y={`Translation ${t.id}`} />)}
        </View>
      </DCard>

      <SectionTitle eyebrow="Reminders" title="How you want to read" />
      <DCard style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DELIVERY.map((x) => <Chip key={x.id} label={x.label} on={delivery === x.id} onPress={() => setDelivery(x.id)} />)}
        </View>
        <DLabel>Times (up to {maxPush} a day)</DLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {TIME_OPTIONS.map((t) => <Chip key={t} label={t} on={times.includes(t)} onPress={() => toggleTime(t)} />)}
        </View>
        <Text style={{ fontFamily: df.sans, color: d.muted, fontSize: 12 }}>
          Reminders skip your quiet hours ({String(quiet.quietFrom ?? 22).padStart(2, '0')}:00 to {String(quiet.quietTo ?? 7).padStart(2, '0')}:00) and never stack on a scripture pop-up.
        </Text>
      </DCard>

      <Tap onPress={save} style={{ marginTop: 16 }} disabled={saving} accessibilityLabel="Save goals">
        <Grad colors={gradients.orange} style={{ borderRadius: 999, paddingVertical: 15, alignItems: 'center' }}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: df.sansSemi, color: '#fff', fontSize: 15 }}>Save my journey</Text>}
        </Grad>
      </Tap>

      <SectionTitle eyebrow="Physical Bible" title="Add a reading you did on paper" />
      <DCard style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {BOOKS.slice(0, 66).map((b) => <Chip key={b.id} label={b.name} on={log.bookId === b.id} onPress={() => setLog({ ...log, bookId: b.id })} />)}
        </View>
        <DLabel>Chapter</DLabel>
        <DInput value={log.chapter} onChangeText={(v) => setLog({ ...log, chapter: v })} keyboardType="number-pad" accessibilityLabel="Chapter" />
        <DLabel>From verse / to verse</DLabel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><DInput value={log.verseStart} onChangeText={(v) => setLog({ ...log, verseStart: v })} keyboardType="number-pad" accessibilityLabel="From verse" /></View>
          <View style={{ flex: 1 }}><DInput value={log.verseEnd} onChangeText={(v) => setLog({ ...log, verseEnd: v })} keyboardType="number-pad" placeholder="same" accessibilityLabel="To verse" /></View>
        </View>
        <DLabel>Date read (YYYY-MM-DD)</DLabel>
        <DInput value={log.date} onChangeText={(v) => setLog({ ...log, date: v })} accessibilityLabel="Date read" />
        <Tap onPress={addManual} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: d.plum }} accessibilityLabel="Add reading">
          <Text style={{ fontFamily: df.sansSemi, color: d.plum }}>Add to my journey</Text>
        </Tap>
      </DCard>
      <View style={{ height: 24 }} />
    </DScreen>
  );
}

