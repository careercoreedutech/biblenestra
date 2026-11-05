// Reminders (Discover → Reminder): personal reminders at a time of day + Daily Bible Verse notifications.
// Notifications are scheduled on the phone (src/notifications/reminders.js); online mode keeps a server copy.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Screen, Section, Button, Empty, Eyebrow, alpha, NightGlow } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, Pop, AnimatedModal } from '../components/Motion';
import { useToast } from '../components/Toast';
import TimeWheel from '../components/TimeWheel';
import { Toggle } from './PrayerScreen';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { BOOKS, refLabel } from '../data/bible';
import {
  KINDS, TARGETS, DAY_SHORT, DEFAULT_VERSE, fmtTime, repeatLabel, nextFire, whenLabel, dateKey, reminderContent, verseFor, verseContent,
  ensurePermission, sendTestNotification, supported, pushReminder, deleteReminderRemote, pushDailyVerse,
} from '../notifications/reminders';

const uuid = () => {
  try { if (Crypto.randomUUID) return Crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = (Math.random() * 16) | 0; return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
};

// "Romans 8", "1 cor 13", "psalm 23" → { bookId, chapter }
function parseChapter(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^(.*?)[\s.]*(\d{1,3})(?::\d+)?$/.exec(t);
  if (!m || !m[1]) return null;
  const name = m[1].replace(/^(first|i) /, '1 ').replace(/^(second|ii) /, '2 ').replace(/^(third|iii) /, '3 ').replace(/^psalm$/, 'psalms').replace(/^song of songs$/, 'song of solomon');
  const book = BOOKS.find((b) => b.name.toLowerCase() === name) || BOOKS.find((b) => name.length >= 3 && b.name.toLowerCase().startsWith(name));
  const ch = Number(m[2]);
  if (!book || ch < 1 || ch > book.chapters) return null;
  return { bookId: book.id, chapter: ch };
}

const blank = () => ({ id: null, purpose: 'Read the Bible', kind: 'bible', hour: 7, minute: 0, repeat: 'daily', days: [new Date().getDay()], date: dateKey(new Date()), target: 'Bible', passage: null, enabled: true });

export default function RemindersScreen() {
  const nav = useNav();
  const toast = useToast();
  const api = useApi();
  const { state, dispatch, getState } = useStore();
  const reminders = state.reminders || [];
  const dv = { ...DEFAULT_VERSE, ...(state.dailyVerse || {}) };
  const translation = state.translation || 'KJV';
  const [editing, setEditing] = useState(null); // draft reminder
  const [verseTime, setVerseTime] = useState(null); // { hour, minute } while the time sheet is open
  const [preview, setPreview] = useState(null);
  const seen = useRef(new Set(reminders.map((r) => r.id)));

  const sorted = useMemo(() => [...reminders].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute)), [reminders]);
  const upcoming = useMemo(() => reminders.map((r) => ({ r, t: nextFire(r) })).filter((x) => x.t).sort((a, b) => a.t - b.t)[0], [reminders]);
  // The next daily verse: today's if its time hasn't passed yet, otherwise tomorrow's
  const nextVerse = useMemo(() => {
    const d = new Date(); d.setHours(dv.hour, dv.minute, 0, 0);
    const today = d.getTime() > Date.now();
    if (!today) d.setDate(d.getDate() + 1);
    return { ...verseFor(d, translation), when: today ? 'Today' : 'Tomorrow' };
  }, [translation, dv.hour, dv.minute]);

  const setList = (list) => dispatch({ type: 'set', patch: { reminders: list } });
  const showPreview = (c) => setPreview({ ...c, key: Date.now() });

  const askPermission = async () => {
    if (!supported) return true;
    const ok = await ensurePermission();
    if (!ok) toast.show('Allow notifications for BibleNestra in your phone settings', { icon: 'bell', tone: 'error' });
    return ok;
  };

  // Optimistic save → server copy (online). Offline: kept on the phone and synced later; other errors roll back.
  const remoteSave = async (item, prevList) => {
    if (!api.online) return;
    try {
      await pushReminder(api.request, item);
    } catch (e) {
      if (e.code === 'NETWORK') {
        setList((getState().reminders || []).map((x) => (x.id === item.id ? { ...x, dirty: true } : x)));
        toast.show('Saved on this phone · will sync when you’re online', { icon: 'bell' });
      } else {
        setList(prevList);
        toast.show(errorMessage(e, 'Couldn’t save this reminder'), { tone: 'error', icon: 'x' });
      }
    }
  };

  const save = async (draft) => {
    const purpose = draft.purpose.trim();
    if (!purpose) { toast.show('Type what you’d like to be reminded about', { tone: 'error', icon: 'edit' }); return; }
    if (draft.repeat === 'days' && !draft.days.length) { toast.show('Pick at least one day', { tone: 'error', icon: 'calendar' }); return; }
    const item = { ...draft, purpose, id: draft.id || uuid(), updatedAt: new Date().toISOString(), dirty: false };
    if (item.repeat === 'once' && !nextFire({ ...item, enabled: true })) { toast.show('That time has already passed — pick a later time or day', { tone: 'error', icon: 'clock' }); return; }
    if (item.repeat !== 'once') item.date = null;
    if (item.kind !== 'study') item.passage = null;
    const prev = reminders;
    const exists = prev.some((x) => x.id === item.id);
    const next = exists ? prev.map((x) => (x.id === item.id ? item : x)) : [...prev, item];
    if (item.enabled) await askPermission();
    setList(next);
    setEditing(null);
    const t = nextFire(item);
    toast.show(exists ? 'Reminder updated' : `Reminder set${t ? ` · ${whenLabel(t)}` : ''}`, { icon: 'bell', haptic: 'success' });
    if (!supported) showPreview(reminderContent(item));
    remoteSave(item, prev);
  };

  const toggle = async (r, on) => {
    if (on) await askPermission();
    const prev = reminders;
    const item = { ...r, enabled: on, updatedAt: new Date().toISOString() };
    setList(prev.map((x) => (x.id === r.id ? item : x)));
    toast.show(on ? `On · ${whenLabel(nextFire(item))}` : 'Reminder paused', { icon: 'bell', haptic: on ? 'success' : 'light' });
    remoteSave(item, prev);
  };

  const remove = async (r) => {
    const prev = reminders;
    setList(prev.filter((x) => x.id !== r.id));
    setEditing(null);
    toast.show('Reminder deleted', { icon: 'trash' });
    if (!api.online) return;
    try { await deleteReminderRemote(api.request, r.id); } catch (e) {
      if (e.code === 'NETWORK') dispatch({ type: 'set', patch: { reminderTombstones: [...(getState().reminderTombstones || []), r.id] } });
      else if (e.status !== 404) { setList(prev); toast.show(errorMessage(e, 'Couldn’t delete this reminder'), { tone: 'error', icon: 'x' }); }
    }
  };

  const setVerse = async (patch) => {
    const next = { ...dv, ...patch };
    if (next.enabled && !(await askPermission())) return;
    const prev = state.dailyVerse;
    dispatch({ type: 'set', patch: { dailyVerse: { ...next, dirty: api.online } } });
    if (patch.enabled !== undefined) toast.show(next.enabled ? `Daily verse at ${fmtTime(next.hour, next.minute)} ✦` : 'Daily verse paused', { icon: 'bell', haptic: next.enabled ? 'success' : 'light' });
    else toast.show(`Daily verse moved to ${fmtTime(next.hour, next.minute)}`, { icon: 'clock' });
    if (!api.online) return;
    try { await pushDailyVerse(api.request, next); dispatch({ type: 'set', patch: { dailyVerse: { ...next, dirty: false } } }); } catch (e) {
      if (e.code !== 'NETWORK') { dispatch({ type: 'set', patch: { dailyVerse: prev } }); toast.show(errorMessage(e, 'Couldn’t save the daily verse time'), { tone: 'error', icon: 'x' }); }
    }
  };

  const testVerse = async () => {
    const c = verseContent(new Date(), translation);
    showPreview(c);
    if (supported) {
      const ok = await sendTestNotification(c);
      toast.show(ok ? 'A verse will arrive in a few seconds' : 'Notifications are blocked in settings', { icon: 'bell', tone: ok ? undefined : 'error' });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen back title="Reminders" subtitle="Daily rhythms · prayer · Scripture">
        {/* Hero: next reminder */}
        <ScaleIn from={0.95} style={styles.hero}>
          <NightGlow />
          <Eyebrow tint={colors.goldLight}>{upcoming ? 'Next reminder' : 'Reminders'}</Eyebrow>
          <Text style={styles.heroTitle} numberOfLines={2}>{upcoming ? upcoming.r.purpose : 'Build a daily rhythm with God'}</Text>
          <Text style={styles.heroSub}>{upcoming ? whenLabel(upcoming.t) : 'Read, pray, call someone or study a chapter — we’ll nudge you at the time you choose.'}</Text>
          <PressScale scaleTo={0.95} onPress={() => setEditing(blank())} style={styles.heroBtn} accessibilityRole="button" accessibilityLabel="New reminder">
            <Icon name="plus" size={15} color={colors.night} />
            <Text style={styles.heroBtnText}>New reminder</Text>
          </PressScale>
        </ScaleIn>

        <Section title="Your reminders">
          {sorted.length ? sorted.map((r, i) => {
            const Enter = seen.current.has(r.id) ? FadeInUp : ScaleIn;
            const k = KINDS.find((x) => x.kind === r.kind) || KINDS[4];
            const passage = r.passage && r.passage.bookId ? refLabel(r.passage.bookId, r.passage.chapter) : null;
            return (
              <Enter key={r.id} index={i + 1} from={0.92}>
                <PressScale scaleTo={0.985} onPress={() => setEditing({ ...blank(), ...r, days: r.days && r.days.length ? r.days : [new Date().getDay()], date: r.date || dateKey(new Date()) })} style={[styles.card, !r.enabled && { opacity: 0.62 }]} accessibilityRole="button" accessibilityLabel={`Edit ${r.purpose}`}>
                  <View style={styles.row}>
                    <View style={[styles.kindIcon, { backgroundColor: r.enabled ? colors.cardGold : colors.raised }]}><Icon name={k.icon} size={17} color={r.enabled ? colors.amber : colors.faint} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.time}>{fmtTime(r.hour, r.minute)}</Text>
                      <Text style={styles.purpose} numberOfLines={2}>{r.purpose}</Text>
                      <Text style={styles.meta} numberOfLines={1}>{[repeatLabel(r), passage, `opens ${(TARGETS.find((t) => t.id === r.target) || TARGETS[2]).label}`].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Toggle value={!!r.enabled} onChange={(v) => toggle(r, v)} />
                  </View>
                </PressScale>
              </Enter>
            );
          }) : (
            <ScaleIn from={0.94} style={styles.emptyCard}>
              <Empty title="No reminders yet" body="Add one for reading, prayer, a call you mustn’t forget, or a chapter you want to study." action="New reminder" onAction={() => setEditing(blank())} />
            </ScaleIn>
          )}
        </Section>

        {/* Daily Bible verse */}
        <Section title="Daily Bible verse">
          <FadeInUp index={3} style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.kindIcon, { backgroundColor: colors.cardIndigo }]}><Icon name="sun" size={17} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.purpose}>Receive a verse every day</Text>
                <Text style={styles.meta}>{dv.enabled ? `Every day at ${fmtTime(dv.hour, dv.minute)} · ${translation}` : 'Off — turn on to get the verse of the day'}</Text>
              </View>
              <Toggle value={!!dv.enabled} onChange={(v) => setVerse({ enabled: v })} />
            </View>
            <PressScale scaleTo={0.98} onPress={() => setVerseTime({ hour: dv.hour, minute: dv.minute })} style={styles.timeRow} accessibilityRole="button" accessibilityLabel="Change daily verse time">
              <Icon name="clock" size={16} color={colors.primary} />
              <Text style={styles.timeRowLabel}>Preferred time</Text>
              <Pop trigger={`${dv.hour}:${dv.minute}`}><Text style={styles.timeRowValue}>{fmtTime(dv.hour, dv.minute)}</Text></Pop>
              <Icon name="chevron-right" size={15} color={colors.faint} />
            </PressScale>
            <View style={styles.versePreview}>
              <Text style={styles.verseEyebrow}>{nextVerse.when} · {nextVerse.label}</Text>
              <Text style={styles.verseText} numberOfLines={4}>{nextVerse.text || nextVerse.reflection}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Button small kind="ghost" label={supported ? 'Send me one now' : 'Preview notification'} icon={<Icon name="bell" size={12} color={colors.fg} />} onPress={testVerse} />
              <Button small kind="ghost" label="Read today’s verse" icon={<Icon name="book" size={12} color={colors.fg} />} onPress={() => { const v = verseFor(new Date(), translation); nav.push('Bible', { bookId: v.bookId, chapter: v.chapter, verse: v.verse }); }} />
            </View>
          </FadeInUp>
          <FadeInUp index={4}>
            <PressScale scaleTo={0.985} onPress={() => nav.push('ScripturePop')} style={[styles.card, styles.row]} accessibilityRole="button">
              <View style={[styles.kindIcon, { backgroundColor: colors.cardLavender }]}><Icon name="sparkles" size={17} color={colors.lavender} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.purpose}>Scripture pop-ups</Text>
                <Text style={styles.meta}>{state.scripturePop && state.scripturePop.enabled ? 'On · verses & prayers through the day' : 'Verses & prayers at an interval you choose'}</Text>
              </View>
              <Icon name="chevron-right" size={15} color={colors.faint} />
            </PressScale>
          </FadeInUp>
        </Section>

        <Text style={styles.foot}>
          {supported
            ? `Reminders are scheduled on this phone, so they arrive even offline.${api.online ? ' They’re also saved to your account and come back on a new phone.' : ''}`
            : 'Reminders arrive as phone notifications in the mobile app. On the web you’ll see a preview like this one.'}
        </Text>
      </Screen>

      <ReminderSheet draft={editing} onClose={() => setEditing(null)} onSave={save} onDelete={remove} existing={!!(editing && editing.id && reminders.some((x) => x.id === editing.id))} />

      <AnimatedModal visible={!!verseTime} onRequestClose={() => setVerseTime(null)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setVerseTime(null)} accessibilityLabel="Dismiss" />
          {verseTime ? (
            <View style={styles.sheet}>
              <View style={styles.grabber} />
              <Eyebrow>Daily Bible verse</Eyebrow>
              <Text style={styles.sheetTitle}>When should it arrive?</Text>
              <View style={{ marginTop: 16 }}><TimeWheel value={verseTime} onChange={setVerseTime} presets={[{ hour: 6, minute: 0 }, { hour: 7, minute: 30 }, { hour: 12, minute: 0 }, { hour: 20, minute: 0 }, { hour: 21, minute: 0 }]} /></View>
              <Button label={`Save · ${fmtTime(verseTime.hour, verseTime.minute)}`} onPress={() => { const t = verseTime; setVerseTime(null); setVerse({ hour: t.hour, minute: t.minute }); }} style={{ marginTop: 18 }} />
            </View>
          ) : null}
        </View>
      </AnimatedModal>

      {preview ? <PreviewBanner key={preview.key} item={preview} onDone={() => setPreview(null)} /> : null}
    </View>
  );
}

function Chip({ label, on, onPress, icon }) {
  return (
    <PressScale scaleTo={0.93} onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      {icon ? <Icon name={icon} size={13} color={on ? '#FFFFFF' : colors.muted} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </PressScale>
  );
}

function ReminderSheet({ draft, onClose, onSave, onDelete, existing }) {
  const [d, setD] = useState(draft);
  const [chapterText, setChapterText] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    if (draft) {
      setD(draft);
      setChapterText(draft.passage && draft.passage.bookId ? refLabel(draft.passage.bookId, draft.passage.chapter) : '');
      setConfirmDel(false);
    }
  }, [draft]);
  const shown = draft ? d || draft : d;
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const pick = (k) => {
    const isLabel = !shown.purpose || KINDS.some((x) => x.label === shown.purpose) || shown.purpose.startsWith('Study ');
    set({ kind: k.kind, target: k.target, purpose: k.kind === 'other' ? (isLabel ? '' : shown.purpose) : isLabel ? (k.kind === 'study' && shown.passage ? `Study ${refLabel(shown.passage.bookId, shown.passage.chapter)}` : k.label) : shown.purpose });
    if (k.kind === 'other' && inputRef.current) setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
  };
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const x = new Date(); x.setDate(x.getDate() + i); return x; }), [draft]);
  const parsed = shown && shown.kind === 'study' ? parseChapter(chapterText) : null;
  const onChapter = (t) => {
    setChapterText(t);
    const p = parseChapter(t);
    setD((x) => ({ ...x, passage: p, purpose: !x.purpose || x.purpose === 'Study a Bible chapter' || x.purpose.startsWith('Study ') ? (p ? `Study ${refLabel(p.bookId, p.chapter)}` : 'Study a Bible chapter') : x.purpose }));
  };
  return (
    <AnimatedModal visible={!!draft} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ height: 40 }} onPress={onClose} accessibilityLabel="Dismiss" />
        {shown ? (
          <View style={[styles.sheet, { flex: 1 }]}>
            <View style={styles.grabber} />
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Eyebrow>{existing ? 'Edit reminder' : 'New reminder'}</Eyebrow>
                <Text style={styles.sheetTitle}>Remind me to…</Text>
              </View>
              <PressScale scaleTo={0.9} onPress={onClose} style={styles.close} accessibilityLabel="Close"><Icon name="x" size={16} color={colors.fg} /></PressScale>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput
                ref={inputRef}
                value={shown.purpose}
                onChangeText={(t) => set({ purpose: t.slice(0, 120) })}
                placeholder="Type your own purpose — e.g. Pray for my family"
                placeholderTextColor={colors.faint}
                style={styles.purposeInput}
                accessibilityLabel="Reminder purpose"
              />
              <View style={styles.chips}>
                {KINDS.map((k) => <Chip key={k.kind} label={k.label} icon={k.icon} on={shown.kind === k.kind} onPress={() => pick(k)} />)}
              </View>
              {shown.kind === 'study' ? (
                <FadeInUp distance={6} duration={260}>
                  <Text style={styles.label}>Which chapter?</Text>
                  <TextInput value={chapterText} onChangeText={onChapter} placeholder="e.g. Romans 8 or Psalm 23" placeholderTextColor={colors.faint} style={styles.field} accessibilityLabel="Bible chapter" />
                  <Text style={[styles.meta, { color: parsed ? colors.sage : colors.faint }]}>{parsed ? `Opens ${refLabel(parsed.bookId, parsed.chapter)} when you tap the reminder` : chapterText ? 'Type a book and chapter, like “John 3”' : 'Optional — the reminder will open this chapter'}</Text>
                </FadeInUp>
              ) : null}

              <Text style={styles.label}>Time</Text>
              <TimeWheel value={{ hour: shown.hour, minute: shown.minute }} onChange={(v) => set(v)} />

              <Text style={styles.label}>Repeat</Text>
              <View style={styles.segment}>
                {[['once', 'Once'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['days', 'Choose days']].map(([k, l]) => (
                  <PressScale key={k} scaleTo={0.96} onPress={() => set({ repeat: k })} style={[styles.segBtn, shown.repeat === k && styles.segOn]} accessibilityRole="button" accessibilityState={{ selected: shown.repeat === k }}>
                    <Text style={[styles.segText, shown.repeat === k && styles.segTextOn]} numberOfLines={1}>{l}</Text>
                  </PressScale>
                ))}
              </View>
              {shown.repeat === 'days' ? (
                <View style={styles.daysRow}>
                  {DAY_SHORT.map((l, i) => {
                    const on = shown.days.includes(i);
                    return (
                      <PressScale key={l} scaleTo={0.9} onPress={() => set({ days: on ? shown.days.filter((x) => x !== i) : [...shown.days, i].sort() })} style={[styles.day, on && styles.dayOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={l}>
                        <Text style={[styles.dayText, on && { color: '#FFFFFF' }]}>{l.slice(0, 1)}</Text>
                      </PressScale>
                    );
                  })}
                </View>
              ) : null}
              {shown.repeat === 'once' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10, marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
                  {days.map((x, i) => {
                    const k = dateKey(x);
                    const on = shown.date === k;
                    return (
                      <PressScale key={k} scaleTo={0.93} onPress={() => set({ date: k })} style={[styles.dateChip, on && styles.dateChipOn]} accessibilityRole="button">
                        <Text style={[styles.dateDow, on && { color: alpha('#FFFFFF', 0.8) }]}>{i === 0 ? 'Today' : i === 1 ? 'Tmrw' : DAY_SHORT[x.getDay()]}</Text>
                        <Text style={[styles.dateNum, on && { color: '#FFFFFF' }]}>{x.getDate()}</Text>
                      </PressScale>
                    );
                  })}
                </ScrollView>
              ) : null}

              <Text style={styles.label}>When I tap it, open</Text>
              <View style={styles.chips}>
                {TARGETS.map((t) => <Chip key={t.id} label={t.label} icon={t.id === 'Bible' ? 'book' : t.id === 'PrayerWall' ? 'prayer' : 'sun'} on={shown.target === t.id} onPress={() => set({ target: t.id })} />)}
              </View>

              {existing ? (
                confirmDel ? (
                  <View style={styles.confirm}>
                    <Text style={[styles.purpose, { color: colors.negative }]}>Delete this reminder?</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                      <Button small label="Delete" onPress={() => onDelete(shown)} style={{ backgroundColor: colors.negative }} />
                      <Button small kind="ghost" label="Keep it" onPress={() => setConfirmDel(false)} />
                    </View>
                  </View>
                ) : <Pressable onPress={() => setConfirmDel(true)} style={styles.deleteLink} accessibilityRole="button"><Icon name="trash" size={14} color={colors.negative} /><Text style={styles.deleteText}>Delete reminder</Text></Pressable>
              ) : null}
            </ScrollView>
            <Button label={`${existing ? 'Save' : 'Set reminder'} · ${fmtTime(shown.hour, shown.minute)}`} icon={<Icon name="bell" size={14} color="#FFFFFF" />} onPress={() => onSave(shown)} disabled={!shown.purpose.trim()} />
          </View>
        ) : null}
      </View>
    </AnimatedModal>
  );
}

// In-app banner that slides down like a notification (web preview; same look as Scripture pop-ups)
function PreviewBanner({ item, onDone }) {
  const y = useRef(new Animated.Value(-160)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(y, { toValue: 0, friction: 7, tension: 60, useNativeDriver: Platform.OS !== 'web' }),
      Animated.delay(3600),
      Animated.timing(y, { toValue: -170, duration: 320, easing: Easing.in(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
    ]).start(onDone);
  }, []);
  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: y }] }]}>
      <View style={styles.bannerIcon}><Icon name="bell" size={14} color="#FFFFFF" /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.bannerApp}>BIBLENESTRA · now</Text>
        <Text style={styles.bannerTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.bannerBody} numberOfLines={3}>{item.body}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.night, borderRadius: 22, padding: 18, overflow: 'hidden', marginTop: 4, ...shadow.md },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 24, lineHeight: 30, color: colors.nightFg, letterSpacing: -0.4, marginTop: 6 },
  heroSub: { fontSize: 13, lineHeight: 19, color: colors.nightMuted, marginTop: 6 },
  heroBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingHorizontal: 16, height: 40, borderRadius: 20, backgroundColor: colors.goldLight },
  heroBtnText: { fontSize: 14, fontWeight: '700', color: colors.night },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, marginTop: 10, ...shadow.sm },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, ...shadow.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  time: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 26, color: colors.fg, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  purpose: { fontSize: 14.5, fontWeight: '600', color: colors.fg, marginTop: 1 },
  meta: { fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 16 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.raised },
  timeRowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.fg },
  timeRowValue: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.primary, fontVariant: ['tabular-nums'] },
  versePreview: { marginTop: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.cardGold, borderLeftWidth: 3, borderLeftColor: colors.goldLight },
  verseEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gold },
  verseText: { fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 23, color: colors.passage, marginTop: 6 },
  foot: { fontSize: 12, lineHeight: 18, color: colors.faint, textAlign: 'center', marginTop: 20 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.fg, letterSpacing: -0.4, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  purposeInput: { marginTop: 14, minHeight: 52, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, fontFamily: fonts.serif, fontSize: 18, color: colors.fg, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) },
  field: { height: 46, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, fontSize: 15, color: colors.fg, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) },
  label: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginTop: 20, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.fg },
  chipTextOn: { color: '#FFFFFF' },
  segment: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { backgroundColor: colors.surface, ...shadow.sm },
  segText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  segTextOn: { color: colors.fg, fontWeight: '700' },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { fontSize: 14, fontWeight: '700', color: colors.fg },
  dateChip: { width: 56, paddingVertical: 8, borderRadius: 14, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dateChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateDow: { fontSize: 10.5, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  dateNum: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, marginTop: 2 },
  confirm: { marginTop: 22, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: alpha(colors.negative, 0.3), backgroundColor: alpha(colors.negative, 0.06) },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 24, padding: 8 },
  deleteText: { fontSize: 14, fontWeight: '600', color: colors.negative },
  banner: { position: 'absolute', top: 8, left: 12, right: 12, zIndex: 50, flexDirection: 'row', gap: 10, padding: 12, borderRadius: 20, backgroundColor: 'rgba(250,247,240,0.98)', borderWidth: 1, borderColor: colors.border, ...shadow.md },
  bannerIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  bannerApp: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.faint },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: colors.fg, marginTop: 1 },
  bannerBody: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 19, color: colors.passage, marginTop: 2 },
});
