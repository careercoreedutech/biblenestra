import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { Screen, Section, Row, Pills, Button, Input, Tag, Badge, Notice, Empty, Eyebrow, alpha, NightGlow } from '../components/ui';
import { Toggle } from './PrayerScreen';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useNarration } from '../audio/Narration';
import { PressScale, FadeInUp, ScaleIn, Pop, Burst, Pulse, LiveRing, AnimatedNumber, AnimatedBar, AnimatedModal, EASE_OUT } from '../components/Motion';
import { DEVOTIONALS, MEMORY_DECK, COURSES, CHURCHES } from '../data/seed';
import { TRANSLATIONS, BOOKS, getChapter, refLabel } from '../data/bible';
import { dayKey } from '../data/rhythm';
import { GAME_COUNTS, DAILY_SIZE, GAME_TITLES, dailyQuestions, practiceSession, dateKey as gameDateKey, resetLabel } from '../data/games';
import { useAds } from '../ads/Ads';
import { AD_RULES } from '../ads/config';
import ProfileButton from '../components/ProfileButton';
import { useSync } from '../api/sync';
import { MODE_LABEL } from '../api/config';
import { relTime } from '../components/social/shared';
import { BannerImage, AvatarImage, EditProfileButton, AvatarEditBadge, FollowSummary } from '../components/social/ProfileMedia'; // SOCIAL (round 3)
import { useCloudRecordings, uploadRecording, SERMON_RECORDING, MAX_MINUTES } from '../api/recordings'; // DISCOVER TOOLS (round 3)
import { CloudRecordingList } from './RecordScreens'; // DISCOVER TOOLS (round 3)

// ---------- Local building blocks ----------

// Tinted rounded-square icon holder
function IconBadge({ name, tint = colors.primary, size = 36, iconSize = 17, bg }) {
  return (
    <View style={[styles.iconBadge, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg || alpha(tint, 0.12) }]}>
      {name === 'book' ? <OpenBook size={iconSize} color={tint} /> : <Icon name={name} size={iconSize} color={tint} />}
    </View>
  );
}

// Open-book glyph (reads more clearly than the closed-book icon at small sizes)
function OpenBook({ size = 17, color = colors.primary }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 6.5C10.3 5.2 7.9 4.5 4 4.5v13c3.9 0 6.3.7 8 2 1.7-1.3 4.1-2 8-2v-13c-3.9 0-6.3.7-8 2z" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
      <Path d="M12 6.5v13" stroke={color} strokeWidth={1.9} />
    </Svg>
  );
}

function PlayGlyph({ size = 22, color = colors.night }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill={color} />
    </Svg>
  );
}

function Chevron({ color = colors.faint }) {
  return <Icon name="chevron-right" size={15} color={color} strokeWidth={2.2} />;
}

// Grouped list card (iOS-settings style): one surface, hairline separators between items
function Group({ children, style }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={styles.groupSep} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

// A row inside a Group. `chevron` shows the disclosure arrow (replaces the old "›" text).
function Item({ icon, tint = colors.primary, title, subtitle, right, onPress, chevron, left, titleStyle, serif }) {
  const showChevron = chevron || (onPress && right == null);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.item, pressed && onPress && { backgroundColor: colors.raised }]}
    >
      {left || (icon ? <IconBadge name={icon} tint={tint} size={34} iconSize={16} /> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={serif ? styles.transcriptLine : [styles.itemTitle, titleStyle]} numberOfLines={serif ? undefined : 2}>{title}</Text>
        {subtitle ? <Text style={styles.itemSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right != null ? (
        <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
          {typeof right === 'string' ? <Text style={styles.itemRight} numberOfLines={1}>{right}</Text> : right}
        </View>
      ) : null}
      {showChevron ? <Chevron /> : null}
    </Pressable>
  );
}

// Wrapping selectable chips (single or multi select — same onChange contract as Pills)
function Chips({ items, value, onChange, style }) {
  const multi = Array.isArray(value);
  return (
    <View style={[styles.chips, style]}>
      {items.map((it) => {
        const on = multi ? value.includes(it) : value === it;
        return (
          <PressScale key={it} scaleTo={0.93} onPress={() => onChange(it)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            {on ? <ScaleIn from={0.3}><Icon name="check" size={12} color={colors.primary} strokeWidth={2.6} /></ScaleIn> : null}
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{it}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

// Underlined tab strip for profile/settings tabs
function TabStrip({ items, value, onChange }) {
  const ref = useRef(null);
  const pos = useRef({}); // label → { x, width }
  const lineX = useRef(new Animated.Value(0)).current;
  const lineW = useRef(new Animated.Value(0)).current;
  const [placed, setPlaced] = useState(false);
  const reveal = () => {
    const l = pos.current[value];
    if (l && ref.current) ref.current.scrollTo({ x: Math.max(0, l.x - 60), animated: true });
  };
  // Sliding underline: springs from the old tab to the new one.
  const slide = (animate) => {
    const l = pos.current[value];
    if (!l) return;
    if (!animate) { lineX.setValue(l.x); lineW.setValue(l.width); return; }
    Animated.parallel([
      Animated.spring(lineX, { toValue: l.x, useNativeDriver: false, speed: 20, bounciness: 5 }),
      Animated.spring(lineW, { toValue: l.width, useNativeDriver: false, speed: 20, bounciness: 5 }),
    ]).start();
  };
  useEffect(() => { reveal(); slide(placed); }, [value]);
  return (
    <View style={styles.tabStripWrap}>
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabStrip}>
        {items.map((it) => {
          const on = value === it;
          return (
            <Pressable
              key={it}
              onPress={() => onChange(it)}
              style={styles.tabItem}
              hitSlop={6}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                pos.current[it] = { x, width };
                if (it === value) { reveal(); slide(false); setPlaced(true); }
              }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{it}</Text>
              <View style={styles.tabLine} />
            </Pressable>
          );
        })}
        <Animated.View pointerEvents="none" style={[styles.tabSlider, { left: lineX, width: lineW, opacity: placed ? 1 : 0 }]} />
      </ScrollView>
    </View>
  );
}

// Progress bar that grows to its value (and glides when the value changes).
function Progress({ value, tint = colors.gold, track = colors.raised, height = 6, style, delay }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return (
    <AnimatedBar
      progress={pct}
      delay={delay}
      style={[styles.bar, { backgroundColor: track, height, borderRadius: height / 2 }, style]}
      fillStyle={{ borderRadius: height / 2, backgroundColor: tint }}
    />
  );
}

// ---------- Local motion helpers ----------
const ND = Platform.OS !== 'web';

// Sparkle burst that fires once, shortly after mounting (result cards, success states).
function MountBurst({ delay = 160, ...rest }) {
  const [t, setT] = useState(0);
  useEffect(() => { const id = setTimeout(() => setT(1), delay); return () => clearTimeout(id); }, []);
  return <Burst trigger={t} {...rest} />;
}

// Number that counts up from zero when it first appears, then tweens on every change.
function CountUp({ value, style, format, delay = 120 }) {
  const [v, setV] = useState(0);
  useEffect(() => { const id = setTimeout(() => setV(value || 0), delay); return () => clearTimeout(id); }, [value]);
  return <AnimatedNumber value={v} style={style} format={format} />;
}

// Card-flip reveal: tilts in around the X axis whenever `flipKey` changes (memory-verse reveal modes).
function Flip({ flipKey, children, style }) {
  const a = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: 380, easing: EASE_OUT, useNativeDriver: ND }).start();
  }, [flipKey]);
  return (
    <Animated.View
      style={[style, {
        opacity: a.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
        transform: [{ perspective: 900 }, { rotateX: a.interpolate({ inputRange: [0, 1], outputRange: ['-75deg', '0deg'] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}

// Bounce only when `on` turns true (selection), never on deselect.
function PopOn({ on, children, style, amount = 1.18 }) {
  const s = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!on) return;
    s.setValue(1);
    Animated.sequence([
      Animated.timing(s, { toValue: amount, duration: 110, easing: EASE_OUT, useNativeDriver: ND }),
      Animated.spring(s, { toValue: 1, useNativeDriver: ND, speed: 18, bounciness: 14 }),
    ]).start();
  }, [on]);
  return <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>;
}

// Sparkle burst only when `on` flips to true after mounting (e.g. a verse reaching full confidence).
function BurstWhen({ on, ...rest }) {
  const [n, setN] = useState(0);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } if (on) setN((x) => x + 1); }, [on]);
  return <Burst trigger={n} {...rest} />;
}

// Gentle opacity blink (paused recorder timer).
function Blink({ active, children, style }) {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { a.stopAnimation(); a.setValue(1); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 0.35, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(a, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active]);
  return <Animated.View style={[style, { opacity: a }]}>{children}</Animated.View>;
}

// One live waveform bar: tweens its height (via scaleY) to the latest input level.
const WAVE_MAX = 34;
function WaveBar({ level, live }) {
  const a = useRef(new Animated.Value(4 / WAVE_MAX)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: (4 + Math.round((level || 0) * 30)) / WAVE_MAX, duration: 180, easing: EASE_OUT, useNativeDriver: ND }).start();
  }, [level]);
  return <Animated.View style={[styles.waveBar, { height: WAVE_MAX, opacity: live ? 1 : 0.45, transform: [{ scaleY: a }] }]} />;
}

// Step content that slides in from the side it's coming from (onboarding).
function StepSlide({ dir = 1, children }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 340, easing: EASE_OUT, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={{ opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [28 * dir, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

function FieldLabel({ children, style }) {
  return <Eyebrow tint={colors.muted} style={[{ marginBottom: 8 }, style]}>{children}</Eyebrow>;
}

// Small pill button for dark (night) surfaces
function NightBtn({ label, icon, onPress, kind = 'glass' }) {
  const gold = kind === 'gold';
  return (
    <PressScale scaleTo={0.94} onPress={onPress} disabled={!onPress} style={[styles.nightBtn, gold && styles.nightBtnGold]} accessibilityRole="button">
      {icon === 'play' ? <PlayGlyph size={13} color={gold ? colors.night : colors.nightFg} /> : icon ? <Icon name={icon} size={14} color={gold ? colors.night : colors.nightFg} /> : null}
      <Text style={[styles.nightBtnText, gold && { color: colors.night }]}>{label}</Text>
    </PressScale>
  );
}

function Timestamp({ t }) {
  return (
    <View style={styles.timeChip}>
      <Text style={styles.timeChipText}>{t}</Text>
    </View>
  );
}

function AIDraft({ children }) {
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="sparkles" size={14} color={colors.gold} />
        <Badge label="AI draft · needs your review" tint={colors.amber} />
      </View>
      <Text style={[styles.cardBody, { fontSize: 14.5, lineHeight: 23, marginTop: 12 }]}>{children}</Text>
    </View>
  );
}

// ---------- Shared behaviour helpers ----------

// Small persisted preferences bag (state.prefs) for switches that have no dedicated store field.
function usePrefs() {
  const { state, dispatch } = useStore();
  const prefs = state.prefs || {};
  const setPref = (k, v) => dispatch({ type: 'set', patch: { prefs: { ...(state.prefs || {}), [k]: v } } });
  return [prefs, setPref];
}

// Next value in a list (wraps) — used by tap-to-cycle settings rows.
const cycle = (list, cur) => list[(Math.max(0, list.indexOf(cur)) + 1) % list.length];

// Native share sheet with a graceful fallback (web browsers without navigator.share).
async function shareText(toast, message, opts = {}) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.share) {
    // Desktop browsers rarely support the share sheet: copy to the clipboard instead.
    try {
      await navigator.clipboard.writeText(message);
      toast.show('Copied to clipboard', { icon: 'link' });
      return true;
    } catch (e) {
      toast.show('Sharing isn\u2019t available in this browser', { tone: 'error', icon: 'share' });
      return false;
    }
  }
  try {
    const res = await Share.share(opts.url && Platform.OS === 'ios' ? { message, url: opts.url } : { message });
    if (res && res.action === Share.dismissedAction) return false;
    if (opts.done) toast.show(opts.done, { icon: 'share' });
    return true;
  } catch (e) {
    toast.show('Sharing isn’t available on this device', { tone: 'error', icon: 'share' });
    return false;
  }
}

// Export a JSON summary of the user's data: downloads a file on web, opens the share sheet on native.
async function exportData(state, toast) {
  const summary = {
    exportedAt: new Date().toISOString(),
    user: state.user,
    translation: state.translation,
    coins: state.coins,
    highlights: state.highlights,
    notes: state.notes,
    bookmarks: state.bookmarks,
    plans: (state.plans || []).map((p) => ({ id: p.id, name: p.name, done: p.done, days: p.days })),
    prayers: (state.prayers || []).filter((p) => p.mine),
    wishes: (state.wishes || []).filter((w) => w.mine),
    posts: (state.feed || []).filter((f) => f.mine),
    recordings: (state.recordings || []).map(({ uri, ...r }) => r),
    proposals: state.proposals,
    giftTransactions: state.giftTransactions,
    rhythm: state.rhythm,
  };
  const json = JSON.stringify(summary, null, 2);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'biblenestra-data.json';
      document.body.appendChild(a); a.click(); a.remove();
      toast.show('Exported biblenestra-data.json', { icon: 'share', haptic: 'success' });
      return;
    } catch (e) { /* fall through to share */ }
  }
  await shareText(toast, json, { done: 'Data export ready' });
}

// "John 3", "Psalm 23", "1 Cor 13", "JHN 3" → { bookId, chapter }
function parsePassage(text) {
  const m = String(text || '').trim().match(/^(.+?)\s+(\d+)(?::(\d+))?/);
  if (!m) return null;
  const q = m[1].toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const qs = q.replace(/s$/, '');
  const b = BOOKS.find((x) => x.id.toLowerCase() === q)
    || BOOKS.find((x) => x.name.toLowerCase() === q || x.name.toLowerCase().replace(/s$/, '') === qs)
    || (q.length >= 3 ? BOOKS.find((x) => x.name.toLowerCase().startsWith(q)) : null);
  if (!b) return null;
  const chapter = Math.max(1, Math.min(b.chapters || 1, Number(m[2])));
  return { bookId: b.id, chapter, verse: m[3] ? Number(m[3]) : undefined };
}

// Always-on switch (cannot be turned off) — shows a lock instead of pretending to toggle.
function LockedToggle({ onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.lockedToggle} accessibilityRole="switch" accessibilityState={{ checked: true, disabled: true }}>
      <Icon name="lock" size={11} color={colors.primary} strokeWidth={2.2} />
      <Text style={styles.lockedText}>Always on</Text>
    </Pressable>
  );
}

// Inline destructive confirmation (replaces Alert.alert).
function InlineConfirm({ title, body, confirmLabel = 'Confirm', onConfirm, onCancel, danger = true }) {
  return (
    <FadeInUp distance={8} duration={300} style={[styles.confirmBox, !danger && { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.cardTitle, { fontSize: 15.5 }]}>{title}</Text>
      {body ? <Text style={[styles.cardMeta, { marginTop: 4 }]}>{body}</Text> : null}
      <View style={[styles.btnRow, { marginTop: 12 }]}>
        <Button small kind={danger ? 'danger' : 'primary'} label={confirmLabel} onPress={onConfirm} />
        <Button small kind="ghost" label="Cancel" onPress={onCancel} />
      </View>
    </FadeInUp>
  );
}

// Tap to edit a single profile field inline; saves through the store.
function EditableItem({ icon, tint, title, value, placeholder, onSave, multiline }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  if (!editing) {
    return <Item icon={icon} tint={tint} title={title} subtitle={value || placeholder} onPress={() => { setDraft(value || ''); setEditing(true); }} />;
  }
  return (
    <FadeInUp distance={6} duration={260} style={{ padding: 14 }}>
      <FieldLabel>{title}</FieldLabel>
      <Input value={draft} onChangeText={setDraft} placeholder={placeholder} multiline={multiline} autoFocus />
      <View style={[styles.btnRow, { marginTop: 10 }]}>
        <Button small label="Save" disabled={draft.trim() === (value || '').trim()} onPress={() => { onSave(draft.trim()); setEditing(false); }} />
        <Button small kind="ghost" label="Cancel" onPress={() => setEditing(false)} />
      </View>
    </FadeInUp>
  );
}

// ---------- Learn ----------
const PUBLIC_PLANS = [
  { key: 'pp1', name: 'Sermon on the Mount · 7 Days', days: 7, today: { bookId: 'MAT', chapter: 5 }, topic: 'Gospels' },
  { key: 'pp2', name: 'Proverbs for Work · 31 Days', days: 31, today: { bookId: 'PRO', chapter: 1 }, topic: 'Wisdom' },
  { key: 'pp3', name: 'Romans in a Month', days: 16, today: { bookId: 'ROM', chapter: 1 }, topic: 'Doctrine' },
  { key: 'pp4', name: 'Psalms of Praise · 10 Days', days: 10, today: { bookId: 'PSA', chapter: 100 }, topic: 'Worship' },
];
const newPlan = (p) => ({ id: 'pl' + Date.now(), name: p.name, days: p.days, done: 0, today: p.today, shared: false, participants: [], streak: 0, reminder: null });

const normWords = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
function matchScore(typed, target) {
  const a = normWords(typed);
  const b = normWords(target);
  if (!b.length) return 0;
  let hit = 0;
  b.forEach((w, i) => { if (a[i] === w) hit += 1; });
  return hit / b.length;
}

const GAMES = [
  { id: 'trivia', title: 'Bible trivia', icon: 'quiz', tint: colors.primary, unit: 'questions' },
  { id: 'who', title: 'Who said it?', icon: 'chat', tint: colors.gold, unit: 'quotes' },
  { id: 'scramble', title: 'Verse scramble', icon: 'sparkles', tint: colors.sage, unit: 'verses' },
  { id: 'chronology', title: 'Bible timeline', icon: 'calendar', tint: colors.sky, unit: 'challenges' },
  { id: 'memory', title: 'Memory-verse practice', sub: 'Your memory deck', icon: 'book', tint: colors.lavender },
];

// "New questions every day · resets in 7h" — shown at the top of every game card.
function DailyLine({ gameId }) {
  const { state } = useStore();
  const d = (state.gameDaily || {})[gameId];
  const played = d && d.date === gameDateKey();
  return (
    <View style={styles.dailyLine}>
      <Icon name="calendar" size={12} color={colors.faint} />
      <Text style={styles.dailyLineText} numberOfLines={1}>New questions every day · resets in {resetLabel()}</Text>
      {played ? <Text style={styles.dailyLineScore}>Today {d.correct}/{d.total}</Text> : null}
    </View>
  );
}

// Supported-by-ads break shown after every AD_RULES.gameInterstitialEvery questions. The round's
// progress lives in the parent game, so skipping or watching never loses anything.
function AdBreak({ done, total, correct, onContinue }) {
  const { state } = useStore();
  // BibleNestra Plus members skip ad breaks entirely
  useEffect(() => { if (state.premium) onContinue(); }, []);
  const ads = useAds();
  const toast = useToast();
  const [left, setLeft] = useState(3);
  const [playing, setPlaying] = useState(false);
  const watch = async () => {
    if (playing) return;
    setPlaying(true);
    let shown = false;
    try { shown = !!(await ads.showInterstitial()).shown; } catch (e) { shown = false; }
    if (shown) toast.show('Thank you for supporting BibleNestra 🙏', { icon: 'heart', haptic: 'success' });
    onContinue();
  };
  // Plays the ad automatically after ~3s unless the player skips.
  useEffect(() => {
    if (playing) return undefined;
    if (left <= 0) { watch(); return undefined; }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left, playing]);
  return (
    <ScaleIn from={0.92} style={styles.adCard}>
      <NightGlow />
      <View style={styles.adCardIcon}>
        <Pulse min={0.92} max={1.08} active={!playing}><Icon name="heart" size={24} color={colors.night} /></Pulse>
      </View>
      <Eyebrow tint={colors.goldLight} style={{ marginTop: 14 }}>Supported by ads</Eyebrow>
      <Text style={styles.adCardTitle}>Watch this ad to support this great platform 🙏</Text>
      <Text style={styles.adCardSub}>{total == null ? `Practice continues — ${done} answered, ${correct} correct.` : `Your progress is saved — ${done} of ${total} done, ${correct} correct.`}</Text>
      <Button
        label={playing ? 'Playing ad…' : `Watch ad${left > 0 ? ` · ${left}s` : ''}`}
        icon={<Icon name="play" size={13} color="#FFFFFF" />}
        disabled={playing}
        onPress={watch}
        style={{ alignSelf: 'stretch', marginTop: 16 }}
      />
      <Pressable onPress={onContinue} disabled={playing} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip ad" style={({ pressed }) => [styles.adSkip, pressed && { opacity: 0.6 }]}>
        <Text style={styles.adSkipText}>Skip</Text>
      </Pressable>
    </ScaleIn>
  );
}

// Results card shared by the games
function RoundResult({ icon, correct, total, unit, gameId, onReplay, onExit, onKeepPlaying }) {
  const { state } = useStore();
  const best = ((state.gameStats || {})[gameId] || {}).best || 0;
  return (
    <ScaleIn style={styles.card}>
      <View style={styles.resultHead}>
        <View style={styles.resultMedal}>
          <Icon name={icon} size={22} color={colors.goldLight} />
          <MountBurst radius={40} />
        </View>
        <View style={{ flex: 1 }}>
          <Eyebrow>Round complete</Eyebrow>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
            <CountUp value={correct} style={styles.resultScore} delay={200} />
            <Text style={styles.resultOf}> of {total} {unit}</Text>
          </View>
        </View>
      </View>
      <Progress value={total ? correct / total : 0} delay={260} style={{ marginTop: 14 }} />
      <Text style={styles.cardMeta}>Best {best.toLocaleString()} pts · a new set arrives in {resetLabel()}</Text>
      {onKeepPlaying ? (
        <View style={{ marginTop: 14 }}>
          <Button label="Keep playing" icon={<Icon name="play" size={13} color="#FFFFFF" />} onPress={onKeepPlaying} />
          <Text style={[styles.cardMeta, { textAlign: 'center' }]}>Endless practice · {(GAME_COUNTS[gameId] || 0).toLocaleString()} in the bank, no repeats · no coins</Text>
        </View>
      ) : null}
      <View style={styles.btnRow}>
        <Button small kind={onKeepPlaying ? 'ghost' : 'primary'} label="Replay today's set" onPress={onReplay} />
        <Button small kind="ghost" label="All games" onPress={onExit} />
      </View>
    </ScaleIn>
  );
}

// Endless practice after the daily set ("Keep playing"): questions from the whole bank, no repeats
// until it's exhausted, position saved per game so the next session continues. No coins, no server call.
function usePractice(kind) {
  const { state, dispatch } = useStore();
  const ref = useRef(null);
  const start = () => {
    const saved = (state.gamePractice || {})[kind] || {};
    ref.current = practiceSession(kind, { seed: saved.seed, start: saved.pos || 0 });
  };
  const next = () => {
    const s = ref.current;
    const item = s && s.next();
    if (item) dispatch({ type: 'set', patch: { gamePractice: { ...(state.gamePractice || {}), [kind]: { seed: s.seed, pos: s.position } } } });
    return item;
  };
  return { start, next };
}

function PracticeBar({ answered, correct, onEnd }) {
  return (
    <View style={styles.practiceBar}>
      <View style={styles.practiceTag}><Text style={styles.practiceTagText}>Practice · no coins</Text></View>
      <Text style={styles.practiceScore}>{correct}/{answered} correct</Text>
      <Pressable onPress={onEnd} hitSlop={8} accessibilityRole="button"><Text style={styles.practiceEnd}>End</Text></Pressable>
    </View>
  );
}

// Multiple-choice round (trivia / who-said-it / timeline) — today's questions, with references.
function QuizGame({ kind, onExit, onFinish, todayResult }) {
  const toast = useToast();
  const [qs, setQs] = useState(() => dailyQuestions(kind));
  // Today's set already played: open on its result card (Keep playing / Replay) instead of replaying.
  const [i, setI] = useState(() => (todayResult ? qs.length : 0));
  const [pick, setPick] = useState(null);
  const [score, setScore] = useState(() => (todayResult ? todayResult.correct : 0));
  const [adAt, setAdAt] = useState(null); // index of the next question while an ad break is showing
  const [daily, setDaily] = useState(null); // finished daily round { qs, score } while practising
  const prac = usePractice(kind);
  const q = qs[i];
  const done = i >= qs.length;
  const keepPlaying = () => {
    prac.start();
    const first = prac.next();
    if (!first) return;
    setDaily({ qs, score });
    setQs([first]); setI(0); setPick(null); setScore(0); setAdAt(null);
  };
  const endPractice = () => {
    const answered = i + (pick != null ? 1 : 0);
    toast.show(`Practice · ${score}/${answered} correct · no coins`, { icon: 'star', haptic: 'success' });
    setQs(daily.qs); setScore(daily.score); setI(daily.qs.length); setPick(null); setAdAt(null); setDaily(null);
  };
  if (done && !daily) {
    return (
      <RoundResult icon="star" correct={score} total={qs.length} unit="correct" gameId={kind} onKeepPlaying={keepPlaying}
        onReplay={() => { setQs(dailyQuestions(kind)); setI(0); setPick(null); setScore(0); }} onExit={onExit} />
    );
  }
  const answer = (k) => {
    if (pick != null) return;
    setPick(k);
    if (k === q.correctIndex) setScore((s) => s + 1);
  };
  const next = () => {
    const n = i + 1;
    if (daily && n >= qs.length) {
      const nq = prac.next();
      if (!nq) { endPractice(); return; }
      setQs((list) => [...list, nq]);
    } else if (n >= qs.length) { onFinish(score, qs.length); setI(n); setPick(null); return; }
    if (n % AD_RULES.gameInterstitialEvery === 0) { setAdAt(n); return; }
    setI(n); setPick(null);
  };
  if (adAt != null) {
    return <AdBreak done={adAt} total={daily ? null : qs.length} correct={score} onContinue={() => { setI(adAt); setPick(null); setAdAt(null); }} />;
  }
  const isWho = kind === 'who';
  return (
    <View style={styles.card}>
      {daily ? <PracticeBar answered={i + (pick != null ? 1 : 0)} correct={score} onEnd={endPractice} /> : null}
      <View style={styles.cardHead}>
        <Eyebrow tint={colors.muted} style={{ flex: 1 }}>{isWho ? 'Who said it?' : (q.categoryLabel || 'Bible trivia')} · {daily ? `practice ${i + 1}` : `${i + 1}/${qs.length}`}</Eyebrow>
        <View style={styles.scoreChip}>
          <Pop trigger={score} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="star" size={11} color={colors.gold} />
            <Text style={styles.scoreChipText}>{score}</Text>
          </Pop>
          <Burst trigger={score} radius={30} size={10} color={colors.gold} />
        </View>
      </View>
      {daily ? null : <Progress value={(i + (pick != null ? 1 : 0)) / qs.length} height={3} tint={colors.primary} delay={0} style={{ marginTop: 10 }} />}
      {daily ? null : <DailyLine gameId={kind} />}
      <FadeInUp key={i} distance={10} duration={320}>
        <Text style={[isWho ? styles.reflectText : styles.cardTitle, { marginTop: 14 }]}>{isWho ? q.quote : q.question}</Text>
        <View style={{ gap: 8, marginTop: 14 }}>
          {q.options.map((o, k) => {
            const right = pick != null && k === q.correctIndex;
            const wrong = pick === k && k !== q.correctIndex;
            return (
              <FadeInUp key={o} index={k} delay={80} distance={8}>
                <PopOn on={right && pick === k} amount={1.04}>
                  <PressScale scaleTo={0.97} disabled={pick != null} onPress={() => answer(k)} style={[styles.optRow, right && styles.optRight, wrong && styles.optWrong, pick != null && !right && !wrong && { opacity: 0.6 }]}>
                    <Text style={[styles.itemTitle, { flex: 1 }, right && { color: colors.positive }, wrong && { color: colors.negative }]}>{o}</Text>
                    {right ? <ScaleIn from={0.2}><Icon name="check" size={15} color={colors.positive} strokeWidth={2.6} /></ScaleIn> : wrong ? <ScaleIn from={0.2}><Icon name="x" size={15} color={colors.negative} strokeWidth={2.6} /></ScaleIn> : null}
                  </PressScale>
                </PopOn>
              </FadeInUp>
            );
          })}
        </View>
      </FadeInUp>
      {pick != null ? (
        <FadeInUp distance={8} duration={320} style={styles.reflectBox}>
          <Text style={[styles.itemTitle, { color: pick === q.correctIndex ? colors.positive : colors.gold }]}>{pick === q.correctIndex ? 'Correct · ' : ''}{q.reference}</Text>
          <Text style={[styles.cardBody, { marginTop: 4 }]}>{q.explanation}</Text>
        </FadeInUp>
      ) : null}
      <View style={styles.btnRow}>
        {pick != null ? <Button small label={!daily && i + 1 >= qs.length ? 'See score' : 'Next question'} onPress={next} /> : null}
        {daily ? <Button small kind="ghost" label="End practice" onPress={endPractice} /> : <Button small kind="ghost" label="Quit" onPress={onExit} />}
      </View>
    </View>
  );
}

function ScrambleGame({ onExit, onFinish, todayResult }) {
  const toast = useToast();
  const [set, setSet] = useState(() => dailyQuestions('scramble'));
  const [i, setI] = useState(() => (todayResult ? set.length : 0));
  const [picked, setPicked] = useState([]);
  const [solved, setSolved] = useState(() => (todayResult ? todayResult.correct : 0));
  const [adAt, setAdAt] = useState(null);
  const [daily, setDaily] = useState(null); // finished daily round { set, solved } while practising
  const prac = usePractice('scramble');
  const v = set[i];
  const keepPlaying = () => {
    prac.start();
    const first = prac.next();
    if (!first) return;
    setDaily({ set, solved });
    setSet([first]); setI(0); setPicked([]); setSolved(0); setAdAt(null);
  };
  const endPractice = () => {
    toast.show(`Practice · ${solved}/${i} verses solved · no coins`, { icon: 'star', haptic: 'success' });
    setSet(daily.set); setSolved(daily.solved); setI(daily.set.length); setPicked([]); setAdAt(null); setDaily(null);
  };
  if (!v && !daily) {
    return (
      <RoundResult icon="sparkles" correct={solved} total={set.length} unit="verses solved" gameId="scramble" onKeepPlaying={keepPlaying}
        onReplay={() => { setSet(dailyQuestions('scramble')); setI(0); setPicked([]); setSolved(0); }} onExit={onExit} />
    );
  }
  if (adAt != null) {
    return <AdBreak done={adAt} total={daily ? null : set.length} correct={solved} onContinue={() => { setI(adAt); setPicked([]); setAdAt(null); }} />;
  }
  if (!v) return null;
  const complete = picked.length === v.correctOrder.length;
  const correct = complete && picked.every((k, n) => v.scrambledWords[k] === v.correctOrder[n]);
  const next = (gotIt) => {
    const s2 = solved + (gotIt ? 1 : 0);
    const n = i + 1;
    setSolved(s2);
    if (daily && n >= set.length) {
      const nv = prac.next();
      if (!nv) { endPractice(); return; }
      setSet((list) => [...list, nv]);
    } else if (n >= set.length) { onFinish(s2, set.length); setI(n); setPicked([]); return; }
    if (n % AD_RULES.gameInterstitialEvery === 0) { setAdAt(n); return; }
    setI(n); setPicked([]);
  };
  return (
    <View style={styles.card}>
      {daily ? <PracticeBar answered={i + (complete ? 1 : 0)} correct={solved + (complete && correct ? 1 : 0)} onEnd={endPractice} /> : null}
      <View style={styles.cardHead}>
        <Eyebrow tint={colors.muted} style={{ flex: 1 }}>Verse scramble · {daily ? `practice ${i + 1}` : `${i + 1}/${set.length}`}</Eyebrow>
        <Text style={styles.confLabel}>{v.reference}</Text>
      </View>
      {daily ? null : <Progress value={(i + (complete ? 1 : 0)) / set.length} height={3} tint={colors.primary} delay={0} style={{ marginTop: 10 }} />}
      {daily ? null : <DailyLine gameId="scramble" />}
      <View style={[styles.verseBox, { minHeight: 64 }, complete && correct && { borderColor: alpha(colors.positive, 0.45) }]}>
        {picked.length ? (
          <View style={styles.pickedWrap}>
            {picked.map((k) => (
              <ScaleIn key={k} from={0.6}><Text style={styles.verseText}>{v.scrambledWords[k]}</Text></ScaleIn>
            ))}
          </View>
        ) : <Text style={[styles.verseText, { color: colors.faint }]}>Tap the words below in order…</Text>}
        {complete && correct ? <MountBurst delay={60} radius={56} color={colors.gold} /> : null}
      </View>
      <FadeInUp key={i} distance={8} duration={320} style={[styles.chips, { marginTop: 12 }]}>
        {v.scrambledWords.map((w, k) => {
          const used = picked.includes(k);
          return (
            <PressScale key={k} scaleTo={0.9} disabled={used || complete} onPress={() => setPicked([...picked, k])} style={[styles.chip, used && { opacity: 0.3 }]}>
              <Text style={styles.chipText}>{w}</Text>
            </PressScale>
          );
        })}
      </FadeInUp>
      {complete ? (
        <ScaleIn from={0.92} style={styles.reflectBox}>
          <Text style={[styles.itemTitle, { color: correct ? colors.positive : colors.negative }]}>{correct ? 'Correct!' : 'Not quite'} · {v.reference}</Text>
          <Text style={[styles.cardBody, { marginTop: 4 }]}>{v.verseText}</Text>
        </ScaleIn>
      ) : null}
      <View style={styles.btnRow}>
        {complete ? <Button small label={!daily && i + 1 >= set.length ? 'See score' : 'Next verse'} onPress={() => next(correct)} /> : null}
        {picked.length && !complete ? <Button small kind="ghost" label="Undo" onPress={() => setPicked(picked.slice(0, -1))} /> : null}
        {picked.length ? <Button small kind="ghost" label="Clear" onPress={() => setPicked([])} /> : null}
        {daily ? <Button small kind="ghost" label="End practice" onPress={endPractice} /> : <Button small kind="ghost" label="Quit" onPress={onExit} />}
      </View>
    </View>
  );
}

export function LearnScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const { state, dispatch } = useStore();
  const [prefs, setPref] = usePrefs();
  const [tab, setTab] = useState(params.tab || 'Plans');
  const [mode, setMode] = useState({}); // memorize view per verse: hint | full | letters | type
  const [typed, setTyped] = useState({});
  const [browse, setBrowse] = useState(false);
  const [game, setGame] = useState(null);
  const memory = state.memory || {};
  const courseDone = state.courseProgress || {};
  const conf = (m) => (memory[m.id] && memory[m.id].confidence != null ? memory[m.id].confidence : m.confidence);
  const due = (m) => (memory[m.id] && memory[m.id].due) || m.due;
  const setConf = (m, c, msg) => {
    const v = Math.max(0, Math.min(5, c));
    dispatch({ type: 'set', patch: { memory: { ...memory, [m.id]: { confidence: v, due: v >= 5 ? 'In 7 days' : v >= 3 ? 'In 2 days' : 'Tomorrow', practiced: dayKey() } } } });
    toast.show(msg || `${m.ref} · confidence ${v}/5`, { icon: 'star', haptic: 'select' });
  };
  const startPublic = (pp) => {
    const existing = state.plans.find((p) => p.name === pp.name);
    if (existing) { nav.push('Plan', { id: existing.id }); return; }
    const plan = newPlan(pp);
    dispatch({ type: 'set', patch: { plans: [...state.plans, plan] } });
    toast.show(`Started “${pp.name}”`, { icon: 'book', haptic: 'success', action: { label: 'Open', onPress: () => nav.push('Plan', { id: plan.id }) } });
  };
  // Record a finished round: stats (dispatch gameResult), today's best, and coins once per game per day.
  const finishGame = (id, correct, total) => {
    const date = gameDateKey();
    const points = correct * 100;
    const daily = state.gameDaily || {};
    const prev = daily[id];
    const firstToday = !(prev && prev.date === date);
    const prevBest = ((state.gameStats || {})[id] || {}).best || 0;
    dispatch({ type: 'gameResult', gameId: id, date, correct, total, score: points });
    if (firstToday || points > (prev.score || 0)) {
      dispatch({ type: 'set', patch: { gameDaily: { ...daily, [id]: { date, correct, total, score: points } } } });
    }
    const prize = firstToday ? correct * 5 : 0;
    if (prize > 0) dispatch({ type: 'earnCoins', amount: prize, reason: `${GAME_TITLES[id] || 'Bible game'} · ${correct}/${total}` });
    toast.show(prize > 0 ? `${correct}/${total} correct · +${prize} coins` : points > prevBest ? `New best: ${correct}/${total}` : `Score saved · ${correct}/${total}`, { icon: prize > 0 ? 'coin' : 'star', haptic: 'success' });
  };
  const memorized = MEMORY_DECK.filter((m) => conf(m) >= 5).length;
  const gospel = state.plans.find((p) => p.id === 'pl1');
  const todayGame = (id) => { const d = (state.gameDaily || {})[id]; return d && d.date === gameDateKey() ? d : null; };
  return (
    <Screen back title="Learn" subtitle="Plans · devotionals · memory · courses" right={<ProfileButton size={34} />}>
      <Pills items={['Plans', 'Devotionals', 'Memorize', 'Courses', 'Games', 'Badges']} value={tab} onChange={(t) => { setTab(t); setGame(null); }} />
      {tab === 'Plans' ? (
        <View style={{ marginTop: 6 }}>
          {state.plans.map((p, idx) => {
            const pct = p.days ? p.done / p.days : 0;
            return (
              <FadeInUp key={p.id} index={idx}>
              <PressScale scaleTo={0.98} style={styles.card} onPress={() => nav.push('Plan', { id: p.id })}>
                <View style={styles.cardHead}>
                  <IconBadge name={p.startsOn ? 'calendar' : 'book'} tint={p.shared ? colors.sage : p.startsOn ? colors.lavender : colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Eyebrow tint={p.startsOn ? colors.lavender : colors.gold}>{p.startsOn ? 'Upcoming' : p.done >= p.days ? 'Completed' : `${Math.round(pct * 100)}% complete`}</Eyebrow>
                    <Text style={styles.cardTitle}>{p.name}</Text>
                  </View>
                  {p.shared ? <Badge label={`Shared · ${p.participants.length + 1}`} tint={colors.sage} /> : <Chevron />}
                </View>
                <Progress value={pct} delay={200 + idx * 70} style={{ marginTop: 14 }} />
                <Text style={styles.cardMeta}>{p.startsOn ? `Starts ${p.startsOn}` : `Day ${p.done} of ${p.days}`}{state.streaksEnabled && p.streak ? ` · ${p.streak}-day streak` : ''}{p.reminder ? ` · Reminder ${p.reminder}` : ''}</Text>
              </PressScale>
              </FadeInUp>
            );
          })}
          {!state.plans.length ? (
            <FadeInUp style={[styles.emptyCard, { marginTop: 12 }]}>
              <Empty title="No plans yet" body="Start a ready-made plan below or build your own study." />
            </FadeInUp>
          ) : null}
          <FadeInUp index={state.plans.length} style={{ marginTop: 22 }}>
          <Group>
            <Item icon="compass" tint={colors.sky} title="Browse public plans" subtitle="Start a ready-made plan in one tap" right={<Icon name={browse ? 'chevron-down' : 'chevron-right'} size={15} color={colors.faint} strokeWidth={2.2} />} onPress={() => setBrowse(!browse)} />
            {browse ? PUBLIC_PLANS.map((pp, k) => {
              const started = state.plans.some((p) => p.name === pp.name);
              return <FadeInUp key={pp.key} index={k} distance={6} duration={300}><Item left={<View style={{ width: 34 }} />} title={pp.name} subtitle={`${pp.topic} · ${pp.days} days · starts with ${refLabel(pp.today.bookId, pp.today.chapter)}`} right={<Button small kind={started ? 'ghost' : 'primary'} label={started ? 'Open' : 'Start'} onPress={() => startPublic(pp)} />} /></FadeInUp>;
            }) : null}
            <Item icon="sparkles" tint={colors.gold} title="Create a custom plan" onPress={() => nav.push('Create', { kind: 'Study' })} />
          </Group>
          </FadeInUp>
        </View>
      ) : null}
      {tab === 'Devotionals' ? DEVOTIONALS.map((d, idx) => {
        const playing = nar.active && nar.playing && nar.bookId === d.passage.bookId && nar.chapter === d.passage.chapter;
        return (
          <FadeInUp key={d.id} index={idx} style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Eyebrow style={{ flex: 1 }}>{d.tradition} · {refLabel(d.passage.bookId, d.passage.chapter)}</Eyebrow>
              {playing ? <View style={styles.nowPlaying}><LiveRing color={colors.gold} size={6} /><Text style={styles.nowPlayingText}>Listening</Text></View> : null}
            </View>
            <Text style={[styles.cardTitleLg, { marginTop: 6 }]}>{d.title}</Text>
            <Text style={styles.cardMeta}>By {d.author}</Text>
            <Text style={[styles.cardBody, { marginTop: 12 }]}>{d.body}</Text>
            <View style={styles.reflectBox}>
              <Text style={styles.reflectText}>{d.question}</Text>
            </View>
            <View style={styles.btnRow}>
              <Button small label="Read passage" onPress={() => nav.push('Bible', d.passage)} icon={<OpenBook size={14} color="#FFFFFF" />} />
              <Button small kind="ghost" label={playing ? 'Pause' : 'Listen'} icon={<Icon name={playing ? 'pause' : 'headphones'} size={13} color={colors.fg} />} onPress={() => (playing ? nar.toggle() : nar.playChapter(d.passage.bookId, d.passage.chapter, { translation: state.translation }))} />
              <Button small kind="ghost" label="Discuss" onPress={() => nav.push('Group', { id: 'g2' })} />
            </View>
          </FadeInUp>
        );
      }) : null}
      {tab === 'Memorize' ? (
        <FadeInUp distance={8}>
          <Notice tint={colors.teal} text="Practise, then rate yourself. Missing a day just moves the card; nothing is lost." />
          {MEMORY_DECK.map((m, idx) => {
            const text = ((getChapter('KJV', m.bookId, m.chapter) || [])[m.verse - 1] || '').trim();
            const md = mode[m.id] || 'hint';
            const shown = md === 'full' ? text
              : md === 'letters' ? text.split(' ').map((w) => w.replace(/^([^A-Za-z]*[A-Za-z])[A-Za-z']*/, '$1')).join(' ')
                : md === 'type' ? '…'
                  : text.split(' ').map((w, i) => (i % 3 === 0 ? w : w[0] + '_'.repeat(Math.max(1, w.length - 1)))).join(' ');
            const c = conf(m);
            const check = () => {
              const sc = matchScore(typed[m.id], text);
              if (sc >= 0.9) { setConf(m, c + 1, `Word-perfect! ${m.ref} confidence ${Math.min(5, c + 1)}/5`); setMode({ ...mode, [m.id]: 'full' }); setTyped({ ...typed, [m.id]: '' }); }
              else toast.show(`${Math.round(sc * 100)}% match — keep going`, { icon: 'book', tone: sc < 0.5 ? 'error' : undefined });
            };
            return (
              <FadeInUp key={m.id} index={idx + 1} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={[styles.cardTitleLg, { flex: 1 }]}>{m.ref}</Text>
                  <Badge label={`Due ${due(m)}`} tint={due(m) === 'Today' ? colors.primary : colors.muted} />
                  <PressScale scaleTo={0.88} hitSlop={6} onPress={() => nar.playVerse(m.bookId, m.chapter, m.verse, { translation: 'KJV' })} style={styles.audioRound} accessibilityLabel={`Listen to ${m.ref}`}>
                    <Icon name="headphones" size={15} color={colors.primary} />
                  </PressScale>
                </View>
                {md === 'type' ? (
                  <FadeInUp distance={8} duration={300} style={{ marginTop: 12 }}>
                    <Input multiline placeholder={`Type ${m.ref} from memory`} value={typed[m.id] || ''} onChangeText={(t) => setTyped({ ...typed, [m.id]: t })} />
                    <View style={[styles.btnRow, { marginTop: 10 }]}>
                      <Button small label="Check" disabled={!(typed[m.id] || '').trim()} onPress={check} />
                      <Button small kind="ghost" label="Show verse" onPress={() => setMode({ ...mode, [m.id]: 'full' })} />
                    </View>
                  </FadeInUp>
                ) : (
                  <Flip flipKey={md} style={[styles.verseBox, md === 'full' && styles.verseBoxOn]}>
                    <Text style={styles.verseText}>{shown}</Text>
                  </Flip>
                )}
                <View style={[styles.btnRow, { gap: 6 }]}>
                  <Button small kind={md === 'full' ? 'primary' : 'ghost'} label={md === 'full' ? 'Hide words' : 'Reveal'} onPress={() => setMode({ ...mode, [m.id]: md === 'full' ? 'hint' : 'full' })} style={styles.btnTight} />
                  <Button small kind={md === 'letters' ? 'primary' : 'ghost'} label="First letters" style={styles.btnTight} onPress={() => setMode({ ...mode, [m.id]: md === 'letters' ? 'hint' : 'letters' })} />
                  <Button small kind={md === 'type' ? 'primary' : 'ghost'} label="Type it" style={styles.btnTight} onPress={() => setMode({ ...mode, [m.id]: md === 'type' ? 'hint' : 'type' })} />
                </View>
                <View style={styles.confRow}>
                  <Text style={styles.confLabel}>Confidence · tap to rate</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <Pressable key={i} hitSlop={4} onPress={() => setConf(m, i + 1 === c ? i : i + 1)} accessibilityLabel={`${m.ref} confidence ${i + 1}`} style={{ padding: 3 }}>
                        <PopOn on={i < c} amount={1.6}><View style={[styles.confDot, i < c && styles.confDotOn]} /></PopOn>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View pointerEvents="none" style={styles.memBurst}><BurstWhen on={c >= 5} radius={34} size={10} color={colors.gold} /></View>
              </FadeInUp>
            );
          })}
          <Group style={{ marginTop: 16 }}>
            <Item icon="users" tint={colors.sage} title="Practise with your group" subtitle="Gospel of John · 21 Days community" onPress={() => nav.push('Group', { id: 'g2' })} />
          </Group>
        </FadeInUp>
      ) : null}
      {tab === 'Courses' ? COURSES.map((c, idx) => {
        const done = courseDone[c.id] != null ? courseDone[c.id] : c.done;
        const enrolled = done > 0 || (state.enrolled || []).includes(c.id);
        const complete = done >= c.lessons;
        return (
          <FadeInUp key={c.id} index={idx} style={styles.card}>
            <View style={styles.cardHead}>
              <IconBadge name={complete ? 'star' : 'book'} tint={complete ? colors.gold : colors.primary} />
              <View style={{ flex: 1 }}>
                <Eyebrow tint={colors.muted}>{c.provider}</Eyebrow>
                <Text style={styles.cardTitle}>{c.title}</Text>
              </View>
              {c.certificate || complete ? <Badge label="Certificate" tint={colors.gold} /> : null}
            </View>
            <View style={styles.metaChips}>
              {[c.level, c.mode, c.duration].map((x) => <Tag key={x} label={x} />)}
            </View>
            <Progress value={c.lessons ? done / c.lessons : 0} tint={complete ? colors.positive : colors.gold} delay={200 + idx * 70} style={{ marginTop: 14 }} />
            <View style={[styles.cardHead, { marginTop: 10 }]}>
              <Text style={[styles.cardMeta, { flex: 1, marginTop: 0 }]}>{done} of {c.lessons} lessons{complete ? ' · Completed' : ''}</Text>
              <Button
                small
                kind={!enrolled ? 'primary' : 'ghost'}
                label={!enrolled ? 'Enroll' : complete ? 'Review course' : 'Continue lesson ' + (done + 1)}
                onPress={() => {
                  if (!enrolled) {
                    dispatch({ type: 'set', patch: { enrolled: [...(state.enrolled || []), c.id] } });
                    toast.show(`Enrolled in ${c.title}`, { icon: 'book', haptic: 'success' });
                  }
                  nav.push('Lesson', { id: c.id });
                }}
              />
            </View>
          </FadeInUp>
        );
      }) : null}
      {tab === 'Games' ? (
        <View>
          {game === 'trivia' || game === 'who' || game === 'chronology' ? <FadeInUp key={game} distance={10}><QuizGame kind={game} todayResult={todayGame(game)} onExit={() => setGame(null)} onFinish={(c, t) => finishGame(game, c, t)} /></FadeInUp> : null}
          {game === 'scramble' ? <FadeInUp key="scramble" distance={10}><ScrambleGame todayResult={todayGame('scramble')} onExit={() => setGame(null)} onFinish={(c, t) => finishGame('scramble', c, t)} /></FadeInUp> : null}
          {!game ? (
            <View style={styles.grid}>
              {GAMES.map((g, idx) => {
                const daily = (state.gameDaily || {})[g.id];
                const today = daily && daily.date === gameDateKey() ? daily : null;
                const best = today ? today.correct : null;
                return (
                  <FadeInUp key={g.id} index={idx} style={styles.gameCell}>
                    <PressScale scaleTo={0.96} onPress={() => (g.id === 'memory' ? setTab('Memorize') : setGame(g.id))} style={styles.gameTile}>
                      <IconBadge name={g.icon} tint={g.tint} />
                      <Text style={styles.gameTitle} numberOfLines={2}>{g.title}</Text>
                      <Text style={styles.gameSub}>{g.id === 'memory' ? `${memorized} of ${MEMORY_DECK.length} memorized` : today ? `Today ${today.correct}/${today.total} · keep playing in practice` : `${DAILY_SIZE[g.id]} new today · ${(GAME_COUNTS[g.id] || 0).toLocaleString()} ${g.unit}`}</Text>
                      {best != null && g.id !== 'memory' ? <View style={styles.bestDot}><Icon name="star" size={10} color={colors.gold} /></View> : null}
                    </PressScale>
                  </FadeInUp>
                );
              })}
            </View>
          ) : null}
          <Notice text={`Fresh questions every day (resets in ${resetLabel()}) — coins for your first round of each game. Then keep playing in endless practice (no coins). Every question carries a KJV reference.`} />
          <Group style={{ marginTop: 14 }}>
            <Item icon="shield" tint={colors.teal} title="Child & family mode" subtitle="Child profiles, guardian controls, no open messaging" onPress={() => nav.push('Profile', { tab: 'Family' })} />
          </Group>
        </View>
      ) : null}
      {tab === 'Badges' ? (
        <FadeInUp distance={8} style={{ marginTop: 12 }}>
          <Group>
            {[
              { icon: 'book', tint: colors.primary, title: 'Gospel reader', sub: `Finish a Gospel reading plan · ${gospel ? gospel.done : 0} of ${gospel ? gospel.days : 21} days`, earned: gospel && gospel.done >= gospel.days },
              { icon: 'star', tint: colors.gold, title: 'Small group leader', sub: 'Complete Leading a Small Group', earned: (courseDone.co3 != null ? courseDone.co3 : 5) >= 5 },
              { icon: 'sparkles', tint: colors.lavender, title: `Memory ${MEMORY_DECK.length}`, sub: `Memorize every verse in your deck · ${memorized} of ${MEMORY_DECK.length}`, earned: memorized >= MEMORY_DECK.length },
            ].map((b) => <Item key={b.title} icon={b.icon} tint={b.tint} title={b.title} subtitle={b.sub} right={b.earned ? <ScaleIn delay={250}><Badge label="Earned" tint={colors.gold} /></ScaleIn> : <Tag label="In progress" />} />)}
          </Group>
          <Group style={{ marginTop: 14 }}>
            <Item title="Hide badges from profile" right={<Toggle value={!!prefs.hideBadges} onChange={(v) => { setPref('hideBadges', v); toast.show(v ? 'Badges hidden from your profile' : 'Badges visible on your profile', { icon: 'shield' }); }} />} />
          </Group>
          <Notice text="Badges are never proof of spiritual maturity, authority, or biblical correctness." />
        </FadeInUp>
      ) : null}
    </Screen>
  );
}

const PLAN_REMINDERS = ['Off', '06:30', '12:00', '20:00'];
const PLAN_CATCHUP = ['Skip missed', 'Catch up', 'Restart'];
const PLAN_REST = ['None', 'Sundays', 'Weekends'];

export function PlanScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const p = state.plans.find((x) => x.id === params.id);
  if (!p) {
    return (
      <Screen back title="Reading plan">
        <View style={[styles.emptyCard, { marginTop: 12 }]}>
          <Empty title="Plan not found" body="This plan may have been removed. Browse plans in Learn to start a new one." action="Open Learn" onAction={() => nav.replace('Learn')} />
        </View>
      </Screen>
    );
  }
  const pct = p.days ? p.done / p.days : 0;
  const finished = p.done >= p.days;
  const today = dayKey();
  const doneToday = (state.planDoneDay || {})[p.id] === today;
  const update = (patch, msg) => {
    dispatch({ type: 'set', patch: { plans: state.plans.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) } });
    if (msg) toast.show(msg, { icon: 'check', haptic: 'select' });
  };
  return (
    <Screen back title={p.name} subtitle={finished ? 'Completed' : `Day ${Math.min(p.done + 1, p.days)} of ${p.days}`}>
      <FadeInUp style={styles.nightCard}><NightGlow />
        <Eyebrow tint={colors.goldLight}>{finished ? 'Plan complete' : 'Reading plan'}</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
          <View>
            <Pop trigger={p.done} amount={1.08} style={{ alignSelf: 'flex-start' }}>
              <CountUp value={Math.round(pct * 100)} format={(n) => `${Math.round(n)}%`} style={styles.nightBig} />
            </Pop>
            <Text style={styles.nightMeta}>{p.done} of {p.days} days complete</Text>
          </View>
          {state.streaksEnabled && p.streak ? (
            <View style={styles.streakChip}>
              <Pulse min={0.9} max={1.12} duration={1100}><Icon name="sun" size={13} color={colors.goldLight} /></Pulse>
              <Pop trigger={p.streak} amount={1.12}><Text style={styles.streakText}>{p.streak}-day streak</Text></Pop>
            </View>
          ) : null}
        </View>
        <Progress value={pct} tint={colors.goldLight} track={colors.nightRaised} delay={220} style={{ marginTop: 16 }} />
      </FadeInUp>
      <FadeInUp index={1}>
      <Section title="Today's reading">
        <PressScale scaleTo={0.98} style={styles.todayCard} onPress={() => nav.push('Bible', p.today)}>
          <IconBadge name="book" tint={colors.primary} size={46} iconSize={21} />
          <View style={{ flex: 1 }}>
            <Eyebrow>Day {Math.min(p.done + 1, p.days)}</Eyebrow>
            <Text style={styles.todayRef}>{refLabel(p.today.bookId, p.today.chapter)}</Text>
            <Text style={styles.cardMeta}>Tap to read</Text>
          </View>
          <View style={styles.roundArrow}><Icon name="arrow-right" size={16} color={colors.primary} /></View>
        </PressScale>
        {p.startsOn ? (
          <Button label="Start this plan today" onPress={() => update({ startsOn: null }, `${p.name} started`)} style={{ marginTop: 12 }} icon={<Icon name="calendar" size={15} color="#FFFFFF" />} />
        ) : (
          <View style={{ position: 'relative', marginTop: 12 }}>
          <Pop trigger={p.done} amount={1.04}>
          <Button
            label={finished ? 'Plan complete' : doneToday ? 'Done for today · mark next day' : 'Mark today complete'}
            onPress={() => {
              dispatch({ type: 'planDone', id: p.id });
              const r = state.rhythm || {};
              const steps = r[today] || [];
              dispatch({ type: 'set', patch: {
                rhythm: { ...r, [today]: steps.includes('reading') ? steps : [...steps, 'reading'] },
                planDoneDay: { ...(state.planDoneDay || {}), [p.id]: today },
              } });
              const nextDone = Math.min(p.days, p.done + 1);
              toast.show(nextDone >= p.days ? `Plan complete — well done!` : `Day ${nextDone} complete · Today's reading ticked`, { icon: 'check', haptic: 'success' });
            }}
            kind={doneToday ? 'ghost' : 'primary'}
            disabled={finished}
            icon={<Icon name="check" size={15} color={doneToday ? colors.fg : '#FFFFFF'} strokeWidth={2.4} />}
          />
          </Pop>
          <Burst trigger={p.done} radius={70} count={12} color={colors.gold} />
          </View>
        )}
      </Section>
      </FadeInUp>
      <FadeInUp index={2}>
      {p.shared ? (
        <Section title="Reading with">
          <Group>
            {p.participants.map((n) => <Item key={n} left={<Avatar name={n} />} title={n} subtitle="Shares progress with you" />)}
            <Item icon="chat" tint={colors.sage} title="Day discussion" subtitle="Private space for this plan" onPress={() => nav.push('Group', { id: 'g2' })} />
            <Item icon="users" tint={colors.primary} title="Invite friends" onPress={() => shareText(toast, `Read “${p.name}” with me on BibleNestra — today: ${refLabel(p.today.bookId, p.today.chapter)}.`, { done: 'Invite shared' })} />
          </Group>
        </Section>
      ) : (
        <Section title="Share">
          <Group>
            <Item icon="users" tint={colors.primary} title="Invite friends to read with you" subtitle="Send an invite link to this plan" onPress={() => shareText(toast, `Read “${p.name}” with me on BibleNestra — ${p.days} days, starting with ${refLabel(p.today.bookId, p.today.chapter)}.`, { done: 'Invite shared' })} />
          </Group>
        </Section>
      )}
      </FadeInUp>
      <FadeInUp index={3}>
      <Section title="Settings">
        <Group>
          <Item title="Reminder" subtitle="Tap to change" right={p.reminder || 'Off'} onPress={() => { const v = cycle(PLAN_REMINDERS, p.reminder || 'Off'); update({ reminder: v === 'Off' ? null : v }, v === 'Off' ? 'Reminder off' : `Reminder set for ${v}`); }} />
          <Item title="Catch-up behaviour" subtitle="Tap to change" right={p.catchUp || 'Skip missed'} onPress={() => { const v = cycle(PLAN_CATCHUP, p.catchUp || 'Skip missed'); update({ catchUp: v }, `Catch-up: ${v}`); }} />
          <Item title="Rest days" subtitle="Tap to change" right={p.rest || 'Sundays'} onPress={() => { const v = cycle(PLAN_REST, p.rest || 'Sundays'); update({ rest: v }, `Rest days: ${v}`); }} />
          <Item title="Streaks" right={<Toggle value={state.streaksEnabled} onChange={(v) => { dispatch({ type: 'set', patch: { streaksEnabled: v } }); toast.show(v ? 'Streaks on' : 'Streaks hidden', { icon: 'sun' }); }} />} />
          <Item title="Leave plan" subtitle={p.shared ? 'Others keep reading' : 'Removes it from your plans'} titleStyle={{ color: colors.negative }} onPress={() => setConfirmLeave(true)} />
        </Group>
        {confirmLeave ? (
          <InlineConfirm
            title={`Leave “${p.name}”?`}
            body="Your progress on this plan will be removed from this device."
            confirmLabel="Leave plan"
            onCancel={() => setConfirmLeave(false)}
            onConfirm={() => { nav.pop(); dispatch({ type: 'set', patch: { plans: state.plans.filter((x) => x.id !== p.id) } }); toast.show(`Left ${p.name}`, { icon: 'book' }); }}
          />
        ) : null}
      </Section>
      </FadeInUp>
    </Screen>
  );
}

function Avatar({ name, size = 34 }) {
  const initials = String(name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[styles.miniAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.miniAvatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

const LESSON_CONTENT = {
  co1: {
    passage: { bookId: 'MAT', chapter: 1 },
    transcript: [['00:00', 'Welcome back. Today we read Matthew 1 and ask why Matthew begins with a genealogy.'], ['02:14', 'Notice the three sets of fourteen. Fourteen is the numeric value of David\'s name in Hebrew.'], ['05:40', 'Four women appear: Tamar, Rahab, Ruth and the wife of Uriah.']],
    prompt: 'Why include the four women?',
    assignment: 'Write 200 words on Matthew 1:21 in your reflection below',
  },
  co2: {
    passage: { bookId: 'JHN', chapter: 1 },
    transcript: [['00:00', 'Welcome to Koine Greek. We begin with John 1:1 — Ἐν ἀρχῇ ἦν ὁ λόγος.'], ['03:05', 'Ἐν ἀρχῇ, “in the beginning”, echoes the opening words of Genesis in the Septuagint.'], ['07:20', 'ὁ λόγος, “the Word”. Notice where the article appears — and where it doesn’t.']],
    prompt: 'Why does John echo Genesis 1?',
    assignment: 'Copy John 1:1 and gloss each Greek word in your reflection below',
  },
  co3: {
    passage: { bookId: 'ACT', chapter: 2 },
    transcript: [['00:00', 'The first small groups in Acts 2 met in homes, ate together and prayed.'], ['02:40', 'Acts 2:42 names four practices: teaching, fellowship, breaking bread and prayer.'], ['06:10', 'A leader’s job is to make room for everyone to take part.']],
    prompt: 'Which of the four practices does your group need most?',
    assignment: 'Plan a 45-minute meeting around Acts 2:42 in your reflection below',
  },
};
const SPEED_CHIPS = ['0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×'];

export function LessonScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const { state, dispatch } = useStore();
  const c = COURSES.find((x) => x.id === params.id);
  const notes = state.lessonNotes || {};
  const [reflection, setReflection] = useState((c && notes[c.id]) || '');
  if (!c) {
    return (
      <Screen back title="Lesson">
        <View style={[styles.emptyCard, { marginTop: 12 }]}>
          <Empty title="Lesson not found" body="This course isn't available on this device." action="Browse courses" onAction={() => nav.replace('Learn', { tab: 'Courses' })} />
        </View>
      </Screen>
    );
  }
  const done = (state.courseProgress || {})[c.id] != null ? state.courseProgress[c.id] : c.done;
  const complete = done >= c.lessons;
  const lesson = Math.min(done + 1, c.lessons);
  const content = LESSON_CONTENT[c.id] || LESSON_CONTENT.co1;
  const passage = content.passage;
  const mine = nar.active && nar.bookId === passage.bookId && nar.chapter === passage.chapter;
  const playing = mine && nar.playing;
  const progress = mine && nar.total ? nar.verse / nar.total : 0;
  const speed = SPEED_CHIPS.find((s) => parseFloat(s) === nar.rate) || '1×';
  const play = () => {
    if (mine) nar.toggle();
    else {
      nar.playChapter(passage.bookId, passage.chapter, { translation: state.translation });
      toast.show(`Reading ${refLabel(passage.bookId, passage.chapter)} aloud`, { icon: 'headphones' });
    }
  };
  return (
    <Screen back title={c.title} subtitle={`Lesson ${lesson} · ${c.provider}`}>
      <FadeInUp>
      <PressScale scaleTo={0.985} onPress={play} style={styles.player} accessibilityLabel={playing ? 'Pause lesson audio' : 'Play lesson audio'}><NightGlow />
        <View style={styles.playBtnWrap}>
          {playing ? <View style={styles.playHalo}><Pulse min={0.9} max={1.25} duration={1000}><View style={styles.playHaloRing} /></Pulse></View> : null}
          <Pulse active={playing} min={0.97} max={1.05} duration={800}>
            <View style={styles.playBtn}>{playing ? <Icon name="pause" size={24} color={colors.night} /> : <PlayGlyph size={24} />}</View>
          </Pulse>
        </View>
        <Text style={styles.playerTitle}>Lesson {lesson} · {refLabel(passage.bookId, passage.chapter)}</Text>
        <Text style={styles.playerMeta}>{mine ? `${playing ? 'Reading' : 'Paused at'} verse ${nar.verse} of ${nar.total}` : 'Tap to hear the lesson passage read aloud'}</Text>
        <AnimatedBar progress={progress} delay={0} style={styles.playerTrack} fillStyle={styles.playerTrackFill} />
      </PressScale>
      </FadeInUp>
      <FadeInUp index={1}>
      <FieldLabel style={{ marginTop: 18 }}>Playback speed</FieldLabel>
      <Pills small items={SPEED_CHIPS} value={speed} onChange={(s) => { nar.setRate(parseFloat(s)); toast.show(`Playback speed ${s}`, { icon: 'headphones', haptic: 'select' }); }} />
      </FadeInUp>
      <FadeInUp index={2}>
      <Section title="Transcript">
        <Group>
          {content.transcript.map(([t, s]) => (
            <Item key={t} left={<Timestamp t={t} />} title={s} serif />
          ))}
        </Group>
      </Section>
      <Section title="Teacher notes">
        <Group>
          <Item icon="book" tint={colors.primary} title={`Open ${refLabel(passage.bookId, passage.chapter)}`} onPress={() => nav.push('Bible', passage)} />
          <Item icon="chat" tint={colors.sage} title="Discussion prompt" subtitle={`${content.prompt} · Discuss in your group`} onPress={() => nav.push('Group', { id: 'g2' })} />
          <Item icon="highlight" tint={colors.gold} title="Assignment" subtitle={content.assignment} />
        </Group>
      </Section>
      </FadeInUp>
      <FadeInUp index={3}>
      <Section title="Your reflection">
        <Input multiline placeholder="Private reflection (saved to this lesson)" value={reflection} onChangeText={setReflection} />
        <Button small kind="ghost" label={notes[c.id] && notes[c.id] === reflection.trim() ? 'Saved' : 'Save reflection'} disabled={!reflection.trim() || notes[c.id] === reflection.trim()} style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => { dispatch({ type: 'set', patch: { lessonNotes: { ...notes, [c.id]: reflection.trim() } } }); toast.show('Reflection saved', { icon: 'edit' }); }} />
      </Section>
      </FadeInUp>
      <Button
        label={complete ? 'Course complete' : `Mark lesson ${lesson} complete`}
        style={{ marginTop: 18 }}
        disabled={complete}
        onPress={() => {
          const next = Math.min(c.lessons, done + 1);
          dispatch({ type: 'set', patch: { courseProgress: { ...(state.courseProgress || {}), [c.id]: next }, ...(reflection.trim() && notes[c.id] !== reflection.trim() ? { lessonNotes: { ...notes, [c.id]: reflection.trim() } } : {}) } });
          toast.show(next >= c.lessons ? `${c.title} complete!` : `Lesson ${lesson} complete`, { icon: 'check', haptic: 'success' });
          nav.pop();
        }}
        icon={<Icon name="check" size={15} color="#FFFFFF" strokeWidth={2.4} />}
      />
    </Screen>
  );
}

// ---------- Sermon Studio ----------
const fmtMs = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const WAVE_BARS = 28;
const TRANSCRIBE_UNAVAILABLE = 'Sign in to get transcripts & notes. Your audio is safe and was not changed.';

export function SermonStudioScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [prefs, setPref] = usePrefs();
  // Online: recordings upload to the API for a transcript + AI sermon notes (src/api/recordings.js, RecordScreens.js)
  const cloud = useCloudRecordings();
  const online = cloud.online;
  const cloudSeen = useRef(null);
  if (cloudSeen.current == null && cloud.items) cloudSeen.current = new Set(cloud.items.map((x) => x.id));
  const [rec, setRec] = useState('idle'); // idle | starting | recording | paused | saving
  const [ms, setMs] = useState(0);
  const [levels, setLevels] = useState(() => Array(WAVE_BARS).fill(0));
  const [title, setTitle] = useState('');
  const [passage, setPassage] = useState('');
  const [privacy, setPrivacy] = useState('Private');
  const [micError, setMicError] = useState(null);
  const [player, setPlayer] = useState(null); // { id, playing, pos, dur }
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [confirmDel, setConfirmDel] = useState(null);
  const recRef = useRef(null);
  const soundRef = useRef(null);
  const timers = useRef([]);
  const live = useRef({});
  live.current = { title, passage, privacy, ms, user: state.user.displayName, online, request: cloud.request };
  const consent = !!prefs.micConsent;
  const recordings = state.recordings || [];
  // Recordings present when the screen opened fade in; ones saved during this visit spring in.
  const seenIds = useRef(null);
  if (seenIds.current == null) seenIds.current = new Set(recordings.map((r) => r.id));

  const unloadSound = async () => {
    const s = soundRef.current;
    soundRef.current = null;
    setPlayer(null);
    if (s) { try { await s.unloadAsync(); } catch (e) { /* already unloaded */ } }
  };

  // Clean up the recorder and player when leaving the screen; an in-progress take is saved as a draft.
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
    const r = recRef.current;
    recRef.current = null;
    if (r) {
      r.stopAndUnloadAsync().then(() => {
        const uri = r.getURI();
        const L = live.current;
        if (uri && L.ms > 0 && L.online) {
          // Online: a take left running uploads in the background (it is never lost)
          uploadRecording(L.request, { uri, durationMs: L.ms, title: L.title, passage: L.passage.trim(), speaker: L.user }).catch(() => {});
        } else if (uri && L.ms > 0) {
          dispatch({ type: 'recording', r: { title: L.title.trim() || 'Untitled recording', speaker: L.user, passage: L.passage.trim() || '—', duration: fmtMs(L.ms), durationMs: L.ms, privacy: L.privacy, uri } });
        }
      }).catch(() => {});
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
  }, []);

  const onRecStatus = (st) => {
    if (!st) return;
    if (st.durationMillis != null) setMs(st.durationMillis);
    if (st.isRecording) {
      // Live input level when the platform reports metering; otherwise a gentle activity pulse.
      const lvl = typeof st.metering === 'number'
        ? Math.max(0, Math.min(1, (st.metering + 60) / 60))
        : 0.25 + 0.2 * Math.abs(Math.sin((st.durationMillis || 0) / 260));
      setLevels((prev) => [...prev.slice(1), lvl]);
    }
  };

  const askPermission = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm || !perm.granted) {
        setMicError('denied');
        toast.show('Microphone access was denied', { tone: 'error', icon: 'mic' });
        return false;
      }
      setMicError(null);
      return true;
    } catch (e) {
      setMicError('unavailable');
      toast.show('No microphone available on this device', { tone: 'error', icon: 'mic' });
      return false;
    }
  };

  const allow = async () => {
    setPref('micConsent', true);
    const ok = await askPermission();
    if (ok) toast.show('Microphone ready', { icon: 'mic', haptic: 'success' });
  };

  const start = async () => {
    if (rec !== 'idle') return;
    setRec('starting');
    await unloadSound();
    const ok = await askPermission();
    if (!ok) { setRec('idle'); return; }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(online ? SERMON_RECORDING : Audio.RecordingOptionsPresets.HIGH_QUALITY, onRecStatus, 200);
      recRef.current = recording;
      setMs(0); setLevels(Array(WAVE_BARS).fill(0));
      setRec('recording');
      toast.show('Recording started', { icon: 'mic', haptic: 'medium' });
    } catch (e) {
      recRef.current = null;
      setRec('idle');
      setMicError('unavailable');
      toast.show('Couldn’t start the microphone', { tone: 'error', icon: 'mic' });
    }
  };

  // Online uploads are capped at 60 minutes: stop and save automatically when the limit is reached.
  useEffect(() => {
    if (online && rec === 'recording' && ms >= MAX_MINUTES * 60 * 1000) {
      toast.show('60-minute limit reached · saving', { icon: 'mic' });
      finish(true);
    }
  }, [ms >= MAX_MINUTES * 60 * 1000]);

  const pause = async () => {
    try { await recRef.current.pauseAsync(); setRec('paused'); toast.show('Recording paused', { icon: 'pause' }); }
    catch (e) { toast.show('Couldn’t pause this recording', { tone: 'error' }); }
  };
  const resume = async () => {
    try { await recRef.current.startAsync(); setRec('recording'); toast.show('Recording resumed', { icon: 'mic' }); }
    catch (e) { toast.show('Couldn’t resume this recording', { tone: 'error' }); }
  };

  const finish = async (keep) => {
    const r = recRef.current;
    if (!r) return;
    setRec('saving');
    let uri = null;
    let dur = ms;
    try {
      const st = await r.getStatusAsync().catch(() => null);
      if (st && st.durationMillis) dur = st.durationMillis;
      await r.stopAndUnloadAsync();
      uri = r.getURI();
    } catch (e) {
      uri = null;
    }
    recRef.current = null;
    Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => {});
    if (keep) {
      if (uri && online) {
        // Upload privately → the server transcribes it and writes sermon notes in the background
        cloud.upload({ uri, durationMs: dur, title, passage: passage.trim(), speaker: state.user.displayName })
          .then(() => toast.show('Uploaded · transcribing now', { icon: 'check', haptic: 'success' }))
          .catch((e) => toast.show(e && e.message ? e.message : 'Upload failed — your take is kept, try again', { tone: 'error', icon: 'mic' }));
        toast.show('Saved · uploading privately', { icon: 'check', haptic: 'success' });
        setTitle(''); setPassage('');
      } else if (uri) {
        dispatch({ type: 'recording', r: { title: title.trim() || 'Untitled recording', speaker: state.user.displayName, passage: passage.trim() || '—', duration: fmtMs(dur), durationMs: dur, privacy, uri } });
        toast.show('Saved as a private draft', { icon: 'check', haptic: 'success' });
        setTitle(''); setPassage('');
      } else {
        toast.show('The recording couldn’t be saved', { tone: 'error', icon: 'mic' });
      }
    } else {
      toast.show('Recording discarded', { icon: 'trash' });
    }
    setRec('idle'); setMs(0); setLevels(Array(WAVE_BARS).fill(0));
  };

  const togglePlay = async (r) => {
    if (rec !== 'idle') { toast.show('Stop recording before playing back', { tone: 'error', icon: 'mic' }); return; }
    if (!r.uri) { toast.show('No audio file is stored for this recording', { tone: 'error', icon: 'headphones' }); return; }
    try {
      if (soundRef.current && player && player.id === r.id) {
        if (player.playing) await soundRef.current.pauseAsync();
        else await soundRef.current.playAsync();
        return;
      }
      await unloadSound();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => {});
      const { sound } = await Audio.Sound.createAsync({ uri: r.uri }, { shouldPlay: true }, (st) => {
        if (!st.isLoaded) {
          if (st.error) { setPlayer(null); toast.show('Playback failed', { tone: 'error', icon: 'headphones' }); }
          return;
        }
        if (st.didJustFinish) {
          setPlayer({ id: r.id, playing: false, pos: 0, dur: st.durationMillis || r.durationMs || 0 });
          sound.setPositionAsync(0).catch(() => {});
          sound.pauseAsync().catch(() => {});
          return;
        }
        setPlayer({ id: r.id, playing: st.isPlaying, pos: st.positionMillis || 0, dur: st.durationMillis || r.durationMs || 0 });
      });
      soundRef.current = sound;
      setPlayer({ id: r.id, playing: true, pos: 0, dur: r.durationMs || 0 });
    } catch (e) {
      await unloadSound();
      toast.show('This audio file isn’t available on this device anymore', { tone: 'error', icon: 'headphones' });
    }
  };

  const transcribe = (r) => {
    dispatch({ type: 'recordingStatus', id: r.id, status: 'transcribing', patch: { error: null } });
    // There is no speech-to-text service connected: report that honestly instead of inventing a transcript.
    timers.current.push(setTimeout(() => {
      dispatch({ type: 'recordingStatus', id: r.id, status: 'failed', patch: { error: TRANSCRIBE_UNAVAILABLE } });
      toast.show('Transcription isn’t available offline', { tone: 'error', icon: 'mic' });
    }, 1200));
  };

  const share = async (r) => {
    const msg = `${r.title} — ${r.speaker}${r.passage && r.passage !== '—' ? ` · ${r.passage}` : ''} (${r.duration})`;
    if (Platform.OS !== 'web' && r.uri) await shareText(toast, msg, { url: r.uri, done: 'Recording shared' });
    else await shareText(toast, msg, { done: 'Recording details shared' });
  };

  const statusTint = { transcribed: colors.teal, draft: colors.warning, failed: colors.negative, transcribing: colors.lavender };
  const statusLabel = { transcribed: 'Transcribed', draft: 'Draft', failed: 'Not transcribed', transcribing: 'Transcribing…' };
  const busy = rec === 'starting' || rec === 'saving';
  return (
    <Screen back title="Sermon Studio" subtitle={online ? 'Record · transcribe · sermon notes' : 'Record · play back · share safely'}>
      {!consent ? (
        <FadeInUp style={styles.card}>
          <ScaleIn delay={120} style={{ alignSelf: 'flex-start' }}><IconBadge name="mic" tint={colors.primary} size={46} iconSize={21} /></ScaleIn>
          <Text style={[styles.cardTitleLg, { marginTop: 14 }]}>Before you record</Text>
          <Text style={styles.cardBody}>{online ? 'Recording other people may require their permission under local law. Recordings upload privately to your account so you get a transcript and sermon notes — only you can listen to them. The app never publishes automatically.' : 'Recording other people may require their permission under local law. Recordings stay private drafts on this device until you choose what to do with them. The app never publishes automatically.'}</Text>
          <Button small label="I understand · allow microphone" style={{ alignSelf: 'flex-start', marginTop: 16 }} onPress={allow} icon={<Icon name="mic" size={13} color="#FFFFFF" />} />
        </FadeInUp>
      ) : (
        <View>
          <ScaleIn from={0.94} style={styles.nightCard}><NightGlow />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              {rec === 'recording' ? <LiveRing color={colors.rose} size={8} />
                : rec === 'starting' || rec === 'saving' ? <Pulse min={0.6} max={1.1} duration={500}><View style={[styles.recDot, { backgroundColor: colors.goldLight }]} /></Pulse>
                  : <View style={[styles.recDot, rec === 'paused' && { backgroundColor: colors.goldLight }]} />}
              <Eyebrow tint={rec === 'recording' ? colors.nightFg : colors.nightMuted}>{rec === 'recording' ? 'Recording' : rec === 'paused' ? 'Paused' : rec === 'starting' ? 'Starting microphone…' : rec === 'saving' ? 'Saving…' : 'Ready to record'}</Eyebrow>
            </View>
            <Blink active={rec === 'paused'}><Text style={styles.recTime}>{fmtMs(ms)}</Text></Blink>
            <View style={styles.wave}>{levels.map((l, i) => <WaveBar key={i} level={l} live={rec === 'recording'} />)}</View>
            <Text style={styles.recMeta}>{micError === 'denied' ? 'Microphone permission denied · enable it in Settings' : micError === 'unavailable' ? 'Microphone unavailable on this device' : `Mic: ${rec === 'recording' ? 'live' : 'ready'} · ${online ? 'Uploads privately for a transcript & notes · up to 60 min' : 'Saved privately on this device'}`}</Text>
            <View style={styles.recBtns}>
              {rec === 'idle' || rec === 'starting' ? <NightBtn kind="gold" icon="mic" label={rec === 'starting' ? 'Starting…' : 'Record'} onPress={busy ? undefined : start} /> : null}
              {rec === 'recording' ? <NightBtn icon="pause" label="Pause" onPress={pause} /> : null}
              {rec === 'paused' ? <NightBtn kind="gold" icon="play" label="Resume" onPress={resume} /> : null}
              {rec === 'recording' || rec === 'paused' ? <NightBtn icon="check" label={online ? 'Stop & get notes' : 'Stop & save draft'} onPress={() => finish(true)} /> : null}
              {rec === 'recording' || rec === 'paused' ? <NightBtn icon="trash" label="Discard" onPress={() => finish(false)} /> : null}
            </View>
          </ScaleIn>
          {micError ? (
            <FadeInUp distance={8} style={[styles.confirmBox, { marginTop: 12 }]}>
              <Text style={[styles.itemTitle, { color: colors.negative }]}>{micError === 'denied' ? 'Microphone access is off' : 'No microphone found'}</Text>
              <Text style={[styles.cardMeta, { marginTop: 4 }]}>{micError === 'denied' ? 'Allow microphone access for BibleNestra in your device settings, then try again.' : 'This device or browser didn’t provide a microphone. Try again on your phone.'}</Text>
              <Button small kind="ghost" label="Try again" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={start} />
            </FadeInUp>
          ) : null}
          <FadeInUp index={1} style={styles.card}>
            <FieldLabel>Details</FieldLabel>
            <Input placeholder="Title" value={title} onChangeText={setTitle} />
            <Input placeholder="Bible passage (e.g. Matthew 1)" value={passage} onChangeText={setPassage} style={{ marginTop: 10 }} />
            {online ? <Text style={[styles.cardMeta, { marginTop: 12 }]}>Private to you · only you can play it, read the transcript and the notes.</Text> : (<>
            <FieldLabel style={{ marginTop: 16 }}>Who can access</FieldLabel>
            <Chips items={['Private', 'Selected people', 'Church', 'Public']} value={privacy} onChange={setPrivacy} />
            </>)}
          </FadeInUp>
          {!online ? <Notice text="Sign in to get transcripts & notes — recordings stay on this device in local mode." /> : null}
        </View>
      )}
      {online ? <CloudRecordingList cloud={cloud} seen={cloudSeen.current} /> : (
      <Section title="Your recordings">
        {recordings.length ? recordings.map((r, idx) => {
          const mine = player && player.id === r.id;
          const Enter = seenIds.current.has(r.id) ? FadeInUp : ScaleIn;
          const playing = mine && player.playing;
          const pos = mine ? player.pos : 0;
          const dur = (mine && player.dur) || r.durationMs || 0;
          return (
            <Enter key={r.id} index={idx + 2} from={0.9} style={[styles.card, mine && styles.cardActive]}>
              <View style={styles.cardHead}>
                <Pulse active={!!playing} min={0.96} max={1.06} duration={700}>
                  <PressScale scaleTo={0.88} onPress={() => togglePlay(r)} accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${r.title}`} style={[styles.recPlay, playing && { backgroundColor: colors.primary }]}>
                    {playing ? <Icon name="pause" size={16} color="#FFFFFF" /> : <PlayGlyph size={16} color={colors.primary} />}
                  </PressScale>
                </Pulse>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{r.title}</Text>
                  <Text style={[styles.cardMeta, { marginTop: 2 }]}>{[r.speaker, r.passage !== '—' ? r.passage : null, r.duration, r.privacy].filter(Boolean).join(' · ')}</Text>
                </View>
                <Pop trigger={r.status}><Badge label={statusLabel[r.status] || r.status} tint={statusTint[r.status] || colors.muted} /></Pop>
              </View>
              {mine ? (
                <FadeInUp distance={6} duration={260} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <Text style={styles.timeChipText}>{fmtMs(pos)}</Text>
                  <Progress value={dur ? pos / dur : 0} tint={colors.primary} height={4} delay={0} style={{ flex: 1 }} />
                  <Text style={styles.timeChipText}>{fmtMs(dur)}</Text>
                </FadeInUp>
              ) : null}
              {(r.refs || []).length ? <Text style={[styles.cardMeta, { color: colors.sage, marginTop: 10 }]}>Detected references (confirm before verified): {r.refs.join(', ')}</Text> : null}
              {renaming && renaming.id === r.id ? (
                <FadeInUp distance={6} duration={260} style={{ marginTop: 12 }}>
                  <Input value={renaming.value} onChangeText={(v) => setRenaming({ ...renaming, value: v })} placeholder="Recording title" autoFocus />
                  <View style={[styles.btnRow, { marginTop: 10 }]}>
                    <Button small label="Save name" disabled={!renaming.value.trim() || renaming.value.trim() === r.title} onPress={() => { dispatch({ type: 'renameRecording', id: r.id, title: renaming.value.trim() }); setRenaming(null); toast.show('Recording renamed', { icon: 'edit' }); }} />
                    <Button small kind="ghost" label="Cancel" onPress={() => setRenaming(null)} />
                  </View>
                </FadeInUp>
              ) : confirmDel === r.id ? (
                <InlineConfirm
                  title="Delete this recording?"
                  body="The audio and its details will be removed from this device. This can't be undone."
                  confirmLabel="Delete"
                  onCancel={() => setConfirmDel(null)}
                  onConfirm={async () => { if (mine) await unloadSound(); dispatch({ type: 'deleteRecording', id: r.id }); setConfirmDel(null); toast.show('Recording deleted', { icon: 'trash' }); }}
                />
              ) : (
                <View style={styles.btnRow}>
                  {r.status === 'draft' ? <Button small kind="ghost" label="Transcribe" onPress={() => transcribe(r)} /> : null}
                  {r.status === 'failed' ? <Button small label="Retry transcription" onPress={() => transcribe(r)} /> : null}
                  {r.status === 'transcribed' ? <Button small kind="ghost" label="Transcript" onPress={() => nav.push('Transcript', { id: r.id })} /> : null}
                  <Button small kind="ghost" label="Rename" onPress={() => { setConfirmDel(null); setRenaming({ id: r.id, value: r.title }); }} />
                  <Button small kind="ghost" label="Share" icon={<Icon name="share" size={12} color={colors.fg} />} onPress={() => share(r)} />
                  <Button small kind="ghost" label="Delete" onPress={() => { setRenaming(null); setConfirmDel(r.id); }} />
                </View>
              )}
              {r.status === 'transcribing' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <Pulse min={0.6} max={1.1} duration={500}><View style={[styles.recDot, { backgroundColor: colors.lavender }]} /></Pulse>
                  <Text style={[styles.cardMeta, { color: colors.lavender, marginTop: 0 }]}>Checking for a transcription service…</Text>
                </View>
              ) : null}
              {r.status === 'failed' ? <FadeInUp distance={6} duration={260}><Text style={[styles.cardMeta, { color: colors.negative, marginTop: 10 }]}>{r.error || 'Transcription failed. Your audio is safe and was not deleted.'}</Text></FadeInUp> : null}
            </Enter>
          );
        }) : (
          <ScaleIn from={0.94} style={styles.emptyCard}>
            <Empty title="No recordings yet" body="Sermons you record appear here as private drafts you can play back, rename, share or delete." />
          </ScaleIn>
        )}
      </Section>
      )}
    </Screen>
  );
}

export function TranscriptScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const r = (state.recordings || []).find((x) => x.id === params.id);
  const [tab, setTab] = useState('Transcript');
  const [editing, setEditing] = useState(null);
  if (!r) {
    return (
      <Screen back title="Transcript">
        <View style={[styles.emptyCard, { marginTop: 12 }]}>
          <Empty title="Recording not found" body="This recording may have been removed or hasn't synced to this device yet." action="Open Sermon Studio" onAction={() => nav.replace('SermonStudio')} />
        </View>
      </Screen>
    );
  }
  // transcript may be a string or [[time, text], …]
  const lines = Array.isArray(r.transcript) ? r.transcript : typeof r.transcript === 'string' && r.transcript.trim() ? r.transcript.split(/\n+/).filter(Boolean).map((t) => [null, t]) : [];
  const plain = lines.map(([t, s]) => (t ? `[${t}] ${s}` : s)).join('\n');
  if (!lines.length) {
    return (
      <Screen back title={r.title} subtitle="Transcript">
        <View style={[styles.emptyCard, { marginTop: 12 }]}>
          <Empty
            title={r.status === 'transcribing' ? 'Transcription in progress' : 'No transcript yet'}
            body={r.status === 'failed' ? (r.error || 'Transcription failed. Your audio is safe.') : 'This recording hasn’t been transcribed. Transcription needs a server connection, which isn’t set up in this build yet.'}
            action="Back to Sermon Studio"
            onAction={() => { const prev = nav.stack[nav.stack.length - 2]; if (prev && prev.name === 'SermonStudio') nav.pop(); else nav.replace('SermonStudio'); }}
          />
        </View>
      </Screen>
    );
  }
  const extras = [['Summary', r.summary], ['Outline', r.outline], ['Questions', r.questions]].filter(([, v]) => v);
  const confirmed = r.confirmedRefs || [];
  return (
    <Screen back title={r.title} subtitle="Transcript · edits never destroy the original">
      {extras.length ? <Pills items={['Transcript', ...extras.map(([k]) => k)]} value={tab} onChange={setTab} /> : null}
      {tab === 'Transcript' ? (
        editing != null ? (
          <View style={{ marginTop: 12 }}>
            <Input multiline value={editing} onChangeText={setEditing} style={{ minHeight: 220 }} />
            <View style={[styles.btnRow, { marginTop: 10 }]}>
              <Button small label="Save transcript" onPress={() => {
                const next = editing.split(/\n+/).filter(Boolean).map((l) => { const m = l.match(/^\[([^\]]+)\]\s*(.*)$/); return m ? [m[1], m[2]] : [null, l]; });
                dispatch({ type: 'recordingStatus', id: r.id, status: r.status, patch: { transcript: next, originalTranscript: r.originalTranscript || r.transcript } });
                setEditing(null); toast.show('Transcript saved · original kept', { icon: 'edit' });
              }} />
              <Button small kind="ghost" label="Cancel" onPress={() => setEditing(null)} />
            </View>
          </View>
        ) : (
          <FadeInUp distance={8} style={{ marginTop: 12 }}>
            <Group>
              {lines.map(([t, s], i) => <Item key={i} left={t ? <Timestamp t={t} /> : null} title={s} serif />)}
            </Group>
          </FadeInUp>
        )
      ) : null}
      {extras.map(([k, v]) => (tab === k ? <FadeInUp key={k} distance={8}><AIDraft>{v}</AIDraft></FadeInUp> : null))}
      {(r.refs || []).length ? (
        <Section title="Detected references">
          <Group>
            {r.refs.map((x) => {
              const ok = confirmed.includes(x);
              return <Item key={x} icon="book" tint={colors.gold} title={x} subtitle={ok ? 'Confirmed' : 'Suggestion · confirm to verify'} right={ok ? <ScaleIn from={0.5}><Badge label="Verified" tint={colors.teal} /></ScaleIn> : <Button small kind="ghost" label="Confirm" onPress={() => { dispatch({ type: 'recordingStatus', id: r.id, status: r.status, patch: { confirmedRefs: [...confirmed, x] } }); toast.show(`${x} confirmed`, { icon: 'check' }); }} />} />;
            })}
          </Group>
        </Section>
      ) : null}
      <View style={[styles.btnRow, { marginTop: 18 }]}>
        <Button small kind="ghost" label="Edit transcript" onPress={() => { setTab('Transcript'); setEditing(plain); }} />
        <Button small label="Share…" onPress={() => shareText(toast, `${r.title} — ${r.speaker}\n\n${plain}`, { done: 'Transcript shared' })} icon={<Icon name="share" size={13} color="#FFFFFF" />} />
      </View>
      <Notice text="Publishing requires confirming you hold the rights. Private recordings are never publicly searchable." />
    </Screen>
  );
}

// ---------- Create ----------
const KIND_META = {
  Post: { icon: 'chat', tint: colors.primary },
  'Prayer request': { icon: 'prayer', tint: colors.rose },
  Wish: { icon: 'star', tint: colors.gold },
  Study: { icon: 'book', tint: colors.sage },
  Event: { icon: 'calendar', tint: colors.sky },
  'Sermon recording': { icon: 'mic', tint: colors.lavender },
  Resource: { icon: 'bookmark', tint: colors.teal },
  Group: { icon: 'users', tint: colors.terracotta },
  'Live stream': { icon: 'live', tint: colors.rose },
};
const POST_KINDS = ['Reflection', 'Verse', 'Testimony', 'Question', 'Announcement'];
const STUDY_BLOCKS = ['Bible passage', 'Explanation', 'Question', 'Prayer prompt', 'Assignment', 'Poll', 'Video', 'Image', 'Audio'];

export function CreateScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const kinds = ['Post', 'Prayer request', 'Wish', 'Study', 'Event', 'Sermon recording', 'Resource', 'Group', 'Live stream'];
  const [kind, setKind] = useState(KIND_META[params.kind] ? params.kind : 'Post');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [postKind, setPostKind] = useState('Reflection');
  const [passage, setPassage] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [registration, setRegistration] = useState('Open');
  const [recurrence, setRecurrence] = useState('None');
  const [recConsent, setRecConsent] = useState(true);
  const [source, setSource] = useState('');
  const [rights, setRights] = useState(false);
  const [approval, setApproval] = useState(true);
  const [comments, setComments] = useState(true);
  const [blocks, setBlocks] = useState(['Bible passage', 'Question']);
  const [days, setDays] = useState('7');
  const [audience, setAudience] = useState('Connections');
  const [groupVis, setGroupVis] = useState('Public');
  const [cat, setCat] = useState('Prayer & spiritual growth');
  const [responses, setResponses] = useState(['Prayer', 'Encouragement']);
  const ref = parsePassage(passage);
  const studyDays = Math.max(1, Math.min(365, parseInt(days, 10) || 0));

  const valid = {
    Post: !!text.trim(),
    Wish: !!title.trim(),
    Study: !!title.trim() && !!ref && !!(parseInt(days, 10) > 0),
    Event: !!title.trim() && !!when.trim(),
    Resource: !!title.trim() && !!source.trim() && rights,
    Group: !!title.trim(),
    'Live stream': !!title.trim(),
  }[kind];
  const hint = {
    Post: 'Write something to publish',
    Wish: 'Add what you hope for',
    Study: !title.trim() ? 'Add a study title' : !ref ? 'Add a starting passage, e.g. John 3' : 'Set the number of days',
    Event: !title.trim() ? 'Add an event title' : 'Add a date & time',
    Resource: !title.trim() ? 'Add a resource title' : !source.trim() ? 'Add the source / licence' : 'Confirm you hold the rights',
    Group: 'Name your group',
    'Live stream': 'Add a stream title',
  }[kind];

  const submit = () => {
    if (!valid) return;
    if (kind === 'Post') {
      dispatch({ type: 'post', post: { kind: postKind, text: text.trim(), audience, commentsOff: !comments } });
      toast.show('Posted to your feed', { icon: 'chat', haptic: 'success' });
      nav.replace('Feed');
    } else if (kind === 'Wish') {
      dispatch({ type: 'addWish', w: { title: title.trim(), body: text.trim(), category: cat, visibility: audience, responses } });
      toast.show('Wish shared', { icon: 'star', haptic: 'success' });
      nav.replace('Wishes');
    } else if (kind === 'Study') {
      const plan = { ...newPlan({ name: title.trim(), days: studyDays, today: { bookId: ref.bookId, chapter: ref.chapter } }), blocks, custom: true };
      dispatch({ type: 'set', patch: { plans: [...state.plans, plan] } });
      toast.show(`Study created · ${studyDays} days`, { icon: 'book', haptic: 'success' });
      nav.replace('Plan', { id: plan.id });
    } else if (kind === 'Event') {
      const details = [when.trim(), where.trim(), recurrence !== 'None' ? `Repeats ${recurrence.toLowerCase()}` : null, `Registration: ${registration.toLowerCase()}`].filter(Boolean).join(' · ');
      dispatch({ type: 'post', post: { kind: 'Announcement', text: `📅 ${title.trim()}\n${details}${text.trim() ? '\n\n' + text.trim() : ''}${recConsent ? '\nThis event may be recorded.' : ''}` } });
      toast.show('Event announced in your feed', { icon: 'calendar', haptic: 'success', action: { label: 'View', onPress: () => nav.replace('Feed') } });
      nav.replace('Feed');
    } else if (kind === 'Resource') {
      dispatch({ type: 'post', post: { kind: 'Resource', text: `${title.trim()}${text.trim() ? '\n' + text.trim() : ''}\nSource: ${source.trim()}` } });
      toast.show('Resource shared to your feed', { icon: 'bookmark', haptic: 'success' });
      nav.replace('Feed');
    } else if (kind === 'Group') {
      const id = 'g' + Date.now();
      const g = { id, name: title.trim(), category: 'Community', region: state.user.country || 'Global', language: (state.user.languages || ['English']).join(' · '), members: 1, verified: false, privacy: groupVis === 'Public' ? 'Public' : 'Private', visibility: groupVis, description: text.trim() || 'A new community on BibleNestra.', joined: true, owner: true, approval, rules: 'Be kind. Keep it on topic.' };
      dispatch({ type: 'set', patch: { communities: [g, ...state.communities] } });
      toast.show(`${g.name} created`, { icon: 'users', haptic: 'success' });
      nav.replace('Group', { id });
    } else if (kind === 'Live stream') {
      dispatch({ type: 'post', post: { kind: 'Announcement', text: `🔴 Going live: ${title.trim()}${when.trim() ? ` · ${when.trim()}` : ''}${ref ? ` · ${refLabel(ref.bookId, ref.chapter)}` : ''}`, passage: ref ? { bookId: ref.bookId, chapter: ref.chapter } : undefined } });
      toast.show('Live stream announced', { icon: 'live', haptic: 'success' });
      nav.replace('Live');
    }
  };
  const toggleIn = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Screen back title="Create" subtitle="Share something with your community">
      <Eyebrow tint={colors.muted} style={{ marginBottom: 10 }}>What would you like to create?</Eyebrow>
      <View style={styles.kindGrid}>
        {kinds.map((k, idx) => {
          const on = kind === k;
          const m = KIND_META[k];
          return (
            <FadeInUp key={k} index={idx} stagger={35} distance={10} style={styles.kindCell}>
              <PressScale scaleTo={0.94} onPress={() => setKind(k)} style={[styles.kindTile, on && styles.kindTileOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <PopOn on={on} amount={1.22}>
                  <IconBadge name={m.icon} tint={on ? '#FFFFFF' : m.tint} bg={on ? colors.primary : alpha(m.tint, 0.12)} size={34} iconSize={16} />
                </PopOn>
                <Text style={[styles.kindText, on && { color: colors.primary }]} numberOfLines={2}>{k}</Text>
              </PressScale>
            </FadeInUp>
          );
        })}
      </View>
      <FadeInUp key={kind} distance={10} duration={320}>
      {kind === 'Prayer request' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitleLg}>Ask for prayer</Text>
          <Text style={styles.cardBody}>Prayer requests have their own composer with audience, anonymity and update controls.</Text>
          <Button label="Open prayer composer" onPress={() => nav.replace('NewPrayer')} style={{ marginTop: 16 }} />
        </View>
      ) : null}
      {kind === 'Sermon recording' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitleLg}>Record a sermon</Text>
          <Text style={styles.cardBody}>Record and play back in Sermon Studio. Everything starts as a private draft on this device.</Text>
          <Button label="Open Sermon Studio" onPress={() => nav.replace('SermonStudio')} style={{ marginTop: 16 }} />
        </View>
      ) : null}
      {kind === 'Post' ? (
        <View style={{ marginTop: 18 }}>
          <FieldLabel>Type</FieldLabel>
          <Chips items={POST_KINDS} value={postKind} onChange={setPostKind} />
          <Input multiline placeholder="Verse, reflection, testimony, question, or announcement" value={text} onChangeText={setText} style={{ marginTop: 14, minHeight: 140 }} />
        </View>
      ) : null}
      {kind === 'Wish' ? (
        <View style={{ gap: 10, marginTop: 18 }}>
          <Input placeholder="What do you hope for?" value={title} onChangeText={setTitle} />
          <Input multiline placeholder="Tell people a little more" value={text} onChangeText={setText} />
          <FieldLabel style={{ marginTop: 10 }}>Category</FieldLabel>
          <Chips items={['Prayer & spiritual growth', 'Encouragement', 'Education', 'Family & relationships', 'Employment & career', 'Ministry / community project', 'Mentor / collaborator', 'Practical assistance']} value={cat} onChange={setCat} />
          <FieldLabel style={{ marginTop: 10 }}>How people can respond</FieldLabel>
          <Chips items={['Prayer', 'Encouragement', 'Advice', 'Resources', 'Mentor connection', 'Group invitation', 'Private message']} value={responses} onChange={(r) => toggleIn(responses, setResponses, r)} />
        </View>
      ) : null}
      {kind === 'Study' ? (
        <View style={{ gap: 10, marginTop: 18 }}>
          <Input placeholder="Study title" value={title} onChangeText={setTitle} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Input placeholder="Start passage (e.g. John 3)" value={passage} onChangeText={setPassage} style={{ flex: 1 }} />
            <Input placeholder="Days" value={days} onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={{ width: 84 }} />
          </View>
          {passage.trim() ? <Text style={[styles.cardMeta, { marginTop: 0, color: ref ? colors.sage : colors.negative }]}>{ref ? `Starts with ${refLabel(ref.bookId, ref.chapter)}` : 'Couldn’t find that passage — try “John 3” or “Psalm 23”.'}</Text> : null}
          <FieldLabel style={{ marginTop: 10 }}>Blocks · tap to add or remove</FieldLabel>
          <Group>
            {STUDY_BLOCKS.map((b) => {
              const on = blocks.includes(b);
              return (
                <Item key={b} title={b} subtitle={on ? `Block ${blocks.indexOf(b) + 1}` : null} onPress={() => toggleIn(blocks, setBlocks, b)}
                  right={<PopOn on={on}><View style={[styles.plusBtn, on && { backgroundColor: colors.primary }]}>{on ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={2.6} /> : <Icon name="plus" size={14} color={colors.primary} strokeWidth={2.4} />}</View></PopOn>} />
              );
            })}
          </Group>
          <Notice text="Your study becomes a reading plan in Learn that you can share with friends." />
        </View>
      ) : null}
      {kind === 'Event' || kind === 'Live stream' ? (
        <View style={{ gap: 10, marginTop: 18 }}>
          <Input placeholder={kind + ' title'} value={title} onChangeText={setTitle} />
          <Input placeholder={`Date & time${kind === 'Live stream' ? ' (optional)' : ''} · e.g. Sun 9 Nov, 10:00`} value={when} onChangeText={setWhen} />
          {kind === 'Event' ? <Input placeholder="Venue or online link" value={where} onChangeText={setWhere} /> : <Input placeholder="Related Bible passage (optional)" value={passage} onChangeText={setPassage} />}
          {kind === 'Event' ? <Input multiline placeholder="Details (optional)" value={text} onChangeText={setText} /> : null}
          {kind === 'Event' ? (
            <View>
              <FieldLabel style={{ marginTop: 6 }}>Registration</FieldLabel>
              <Chips items={['Open', 'Approval', 'Invite-only']} value={registration} onChange={setRegistration} />
              <FieldLabel style={{ marginTop: 14 }}>Recurrence</FieldLabel>
              <Chips items={['None', 'Weekly', 'Monthly']} value={recurrence} onChange={setRecurrence} />
            </View>
          ) : null}
          <Group style={{ marginTop: 6 }}>
            <Item title="Recording consent notice" subtitle="Tell attendees this may be recorded" right={<Toggle value={recConsent} onChange={setRecConsent} />} />
          </Group>
          <Text style={[styles.cardMeta, { marginTop: 0 }]}>{kind === 'Event' ? 'Publishing posts an announcement to your feed.' : 'Publishing announces your stream in the feed and opens Live.'}</Text>
        </View>
      ) : null}
      {kind === 'Resource' ? (
        <View style={{ marginTop: 18, gap: 10 }}>
          <Input placeholder="Resource title" value={title} onChangeText={setTitle} />
          <Input multiline placeholder="What is it and who is it for? (optional)" value={text} onChangeText={setText} />
          <Input placeholder="Source, author, rights holder & licence" value={source} onChangeText={setSource} />
          <Group>
            <Item icon="shield" tint={colors.teal} title="I confirm I hold the rights to share this" onPress={() => setRights(!rights)} right={<Toggle value={rights} onChange={setRights} />} />
          </Group>
        </View>
      ) : null}
      {kind === 'Group' ? (
        <View style={{ marginTop: 18, gap: 10 }}>
          <Input placeholder="Group name" value={title} onChangeText={setTitle} />
          <Input multiline placeholder="Description" value={text} onChangeText={setText} />
          <FieldLabel style={{ marginTop: 10 }}>Visibility</FieldLabel>
          <Chips items={['Public', 'Discoverable private', 'Invite-only', 'Hidden']} value={groupVis} onChange={setGroupVis} />
          <Group style={{ marginTop: 6 }}>
            <Item title="Join approval" subtitle={approval ? 'You approve new members' : 'Anyone can join'} right={<Toggle value={approval} onChange={setApproval} />} />
            <Item title="Channels" right="General, Prayer, Bible Study" />
          </Group>
        </View>
      ) : null}
      {kind === 'Post' || kind === 'Wish' ? (
        <Section title="Audience">
          <Chips items={['Private', 'Selected people', 'Selected community', 'Connections', 'Public']} value={audience} onChange={setAudience} />
          {kind === 'Post' ? (
            <Group style={{ marginTop: 12 }}>
              <Item title="Allow comments" right={<Toggle value={comments} onChange={setComments} />} />
            </Group>
          ) : null}
        </Section>
      ) : null}
      {kind !== 'Prayer request' && kind !== 'Sermon recording' ? (
        <View style={{ marginTop: 24 }}>
          <Button label={kind === 'Post' ? 'Publish' : kind === 'Wish' ? 'Share wish' : kind === 'Live stream' ? 'Announce stream' : 'Create ' + kind.toLowerCase()} onPress={submit} disabled={!valid} />
          {!valid && hint ? <Text style={[styles.cardMeta, { textAlign: 'center' }]}>{hint}</Text> : null}
        </View>
      ) : null}
      </FadeInUp>
    </Screen>
  );
}

// ---------- Profile & settings ----------
const PROFILE_TABS = ['Profile', 'Wallet & Gifts', 'Creator', 'Jobs', 'Study', 'Notifications', 'Privacy', 'Account'];
const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '');
const AVAILABILITY = { now: 'Available now', times: 'Selected times', requests: 'Message requests', none: 'Not accepting' };
const AVAIL_KEY = { 'Available now': 'now', 'Selected times': 'times', 'Message requests': 'requests', 'Not accepting': 'none' };
// Older profiles stored free text (e.g. "Available for ministry projects") — map it onto the four options.
const availKey = (v) => (AVAILABILITY[v] ? v : AVAIL_KEY[v] ? AVAIL_KEY[v] : /not|unavail|busy|closed/i.test(String(v || '')) ? 'none' : 'now');
const withExtras = (options, chosen) => [...options, ...(chosen || []).filter((x) => !options.includes(x))];
const QUIET_HOURS = ['Off', '22:00–07:00', '23:00–06:00', '21:00–08:00'];
const DIGESTS = ['Daily', 'Weekly', 'Off'];
const SCREEN_TIME = ['Off', '30 min', '1 hour', '2 hours'];
const LANG_DEPTH = ['Basic', 'Intermediate', 'Advanced'];
const COMMENTARY = ['All', 'Protestant', 'Catholic', 'Orthodox', 'Off'];
const READ_SPEEDS = [0.75, 1, 1.25, 1.5];

// Profile → Settings: which mode the app runs in, who's signed in, last sync, "Sync now" and "Sign out".
function AccountSync() {
  const sync = useSync();
  const toast = useToast();
  const nav = useNav();
  const [confirmOut, setConfirmOut] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []); // keep "x min ago" fresh
  if (!sync.online) {
    return (
      <Group>
        <Item icon="lock" tint={colors.sage} title="Local mode" subtitle="Everything is stored on this device — no account needed" right={<Badge label="Local" tint={colors.sage} />} />
      </Group>
    );
  }
  const last = sync.lastSyncedAt ? Date.parse(sync.lastSyncedAt) : 0;
  const syncing = sync.status === 'syncing';
  const statusLine = syncing ? 'Syncing…' : sync.status === 'error' ? `Last sync failed · ${sync.error || 'try again'}` : last ? `Last synced ${relTime(last) === 'Just now' ? 'just now' : `${relTime(last)} ago`}` : 'Not synced yet';
  const syncNow = async () => {
    await sync.refresh();
    toast.show('Synced with BibleNestra', { icon: 'check', haptic: 'success' });
  };
  const signOut = async () => {
    setConfirmOut(false);
    nav.reset();
    await sync.signOut();
  };
  return (
    <Group>
      <Item
        icon="globe"
        tint={colors.primary}
        title={sync.email || 'Signed in'}
        subtitle={sync.mode === 'dev-online' ? 'Development user · X-Dev-User header' : 'Signed in · your posts, prayers and coins sync to every device'}
        right={<Badge label={MODE_LABEL[sync.mode] || 'Online'} tint={colors.primary} />}
      />
      <Item
        icon="clock"
        tint={sync.status === 'error' ? colors.negative : colors.teal}
        title="Sync"
        subtitle={statusLine}
        right={<Button small kind="ghost" label={syncing ? 'Syncing…' : 'Sync now'} disabled={syncing} onPress={syncNow} />}
      />
      {sync.mode === 'online' ? (
        confirmOut ? (
          <View style={styles.signOutConfirm}>
            <Text style={styles.itemSub}>Sign out of BibleNestra on this device? Your Bible notes and highlights stay here.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Button small kind="ghost" label="Cancel" onPress={() => setConfirmOut(false)} />
              <Button small kind="danger" label="Sign out" onPress={signOut} />
            </View>
          </View>
        ) : (
          <Item icon="arrow-right" tint={colors.negative} title="Sign out" titleStyle={{ color: colors.negative }} onPress={() => setConfirmOut(true)} />
        )
      ) : null}
    </Group>
  );
}

export function ProfileScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const { state, dispatch, sync } = useStore();
  const [prefs, setPref] = usePrefs();
  const u = state.user;
  const [tab, setTab] = useState(params.tab || 'Profile');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(null); // 'chat' | 'companion'
  const [childName, setChildName] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [coinSheet, setCoinSheet] = useState(false);
  const pop = state.scripturePop || {};
  const popEvery = pop.every >= 60 ? `${Math.round((pop.every / 60) * 10) / 10}h` : `${pop.every || 0} min`;
  const popSub = pop.enabled ? `On · a verse every ${popEvery}` : 'Off · gentle verses through your day';
  const coinLog = state.coinLog || [];
  const set = (patch, msg, icon = 'check') => { dispatch({ type: 'user', user: patch }); if (msg) toast.show(msg, { icon, haptic: 'select' }); };
  const setPrefT = (k, v, msg, icon = 'check') => { setPref(k, v); if (msg) toast.show(msg, { icon, haptic: 'select' }); };
  const setNotif = (k, v, label) => {
    dispatch({ type: 'set', patch: { notifications: { ...state.notifications, [k]: v } } });
    if (label) toast.show(`${label} ${v === true ? 'on' : v === false ? 'off' : v}`, { icon: 'bell', haptic: 'select' });
  };
  const myProposals = state.proposals || [];
  const handle = '@' + u.username;
  const myVideos = (state.videos || []).filter((v) => v.mine || (v.creator && (v.creator.handle === handle || v.creator.username === u.username || v.creator.name === u.displayName)));
  const tabs = PROFILE_TABS.includes(tab) ? PROFILE_TABS : [...PROFILE_TABS, tab];
  const initial = (u.displayName || '?')[0];
  const children = state.children || [];
  const acceptsChat = u.acceptsChat || [];
  const interests = u.interests || [];
  const doReset = () => {
    dispatch({ type: 'reset' });
    setConfirmReset(false);
    nav.reset();
    toast.show('All local data was erased', { icon: 'trash', haptic: 'warning' });
  };

  return (
    <Screen back={nav.stack.length > 0} title="Profile" subtitle={`@${u.username}`}>
      {tab === 'Profile' ? (
        <FadeInUp distance={10} style={styles.heroCard}>
          <View style={[styles.cover, u.bannerUrl && { height: 124 }]}>{u.bannerUrl ? <BannerImage uri={u.bannerUrl} /> : <><NightGlow />
            <Text style={styles.coverMark}>✦</Text></>}
            <EditProfileButton onPress={() => nav.push('EditProfile')} />
          </View>
          <ScaleIn delay={140} from={0.6} style={styles.avatarRing}>
            <PressScale onPress={() => nav.push('EditProfile')} scaleTo={0.94} accessibilityLabel="Change profile photo">
              {u.avatarUrl ? <AvatarImage uri={u.avatarUrl} size={84} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>}
              <AvatarEditBadge />
            </PressScale>
          </ScaleIn>
          <FadeInUp delay={220} distance={8} style={styles.heroBody}>
            <Text style={styles.heroName}>{u.displayName}</Text>
            <Text style={styles.heroHandle}>@{u.username}</Text>
            {u.headline ? <Text style={styles.heroMeta}>{u.headline}</Text> : null}
            {u.bio ? <Text style={[styles.heroMetaFaint, { color: colors.muted, textAlign: 'center', marginTop: 6 }]}>{u.bio}</Text> : null}
            <FollowSummary />
            <Text style={styles.heroMetaFaint}>{[u.country, (u.languages || []).join(', ')].filter(Boolean).join('  ·  ')}</Text>
            <View style={styles.heroChips}>
              {u.church?.visible ? (
                <View style={styles.churchChip}>
                  <Icon name="church" size={14} color={colors.primary} />
                  <Text style={styles.churchChipText} numberOfLines={1}>{u.church?.name}</Text>
                </View>
              ) : null}
              <Pressable onPress={() => setTab('Privacy')} style={({ pressed }) => [styles.visChip, pressed && { opacity: 0.7 }]}>
                <Icon name="shield" size={12} color={colors.muted} />
                <Text style={styles.visChipText}>{cap(u.profileVisibility)}</Text>
              </Pressable>
              {state.premium ? (
                <View style={[styles.visChip, { backgroundColor: colors.cardGold }]}>
                  <Icon name="star" size={12} color={colors.goldMuted} />
                  <Text style={[styles.visChipText, { color: colors.goldMuted }]}>Plus supporter</Text>
                </View>
              ) : null}
              {u.openToOpportunities ? (
                <View style={[styles.visChip, { backgroundColor: colors.cardSage }]}>
                  <Icon name="briefcase" size={12} color={colors.sage} />
                  <Text style={[styles.visChipText, { color: colors.sage }]}>Open to opportunities</Text>
                </View>
              ) : null}
            </View>
          </FadeInUp>
        </FadeInUp>
      ) : (
        <View style={styles.compactId}>
          {u.avatarUrl ? <AvatarImage uri={u.avatarUrl} size={46} /> : <View style={[styles.avatar, styles.avatarSm]}><Text style={[styles.avatarText, { fontSize: 19 }]}>{initial}</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={styles.compactName}>{u.displayName}</Text>
            <Text style={styles.cardMeta}>@{u.username} · {cap(u.profileVisibility)}</Text>
          </View>
          <PressScale scaleTo={0.92} onPress={() => setTab('Wallet & Gifts')} style={styles.coinPill} accessibilityLabel={`${state.coins || 0} coins · open wallet`}>
            <Pop trigger={state.coins}><Icon name="coin" size={14} color={colors.gold} /></Pop>
            <AnimatedNumber value={state.coins || 0} style={styles.coinPillText} />
          </PressScale>
        </View>
      )}

      <TabStrip items={tabs} value={tab} onChange={setTab} />

      <FadeInUp key={tab} distance={10} duration={320}>
      {tab === 'Profile' ? (
        <View>
          <View style={styles.statRow}>
            {[
              { icon: 'coin', tint: colors.gold, value: state.coins || 0, label: 'Kingdom Coins', go: () => setTab('Wallet & Gifts') },
              { icon: 'bookmark', tint: colors.primary, value: state.bookmarks?.length || 0, label: 'Bookmarks', go: () => nav.push('Library') },
              { icon: 'highlight', tint: colors.sage, value: state.highlights?.length || 0, label: 'Highlights', go: () => nav.push('Library') },
            ].map((s, idx) => (
              <FadeInUp key={s.label} index={idx} delay={120} style={{ flex: 1 }}>
                <PressScale scaleTo={0.95} onPress={s.go} style={styles.statTile} accessibilityLabel={`${s.value} ${s.label}`}>
                  <IconBadge name={s.icon} tint={s.tint} size={30} iconSize={15} />
                  <CountUp value={s.value} delay={260 + idx * 80} style={styles.statValue} />
                  <Text style={styles.statLabel}>{s.label}</Text>
                </PressScale>
              </FadeInUp>
            ))}
          </View>

          <FadeInUp index={1} delay={80}>
          <Section title="Kingdom Wallet & Support">
            <PressScale scaleTo={0.98} onPress={() => setTab('Wallet & Gifts')} style={styles.walletCard} accessibilityLabel="Open Kingdom Wallet"><NightGlow />
              <View style={{ flex: 1 }}>
                <Eyebrow tint={colors.goldLight}>Virtual coin balance</Eyebrow>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
                  <CountUp value={state.coins || 0} delay={320} style={styles.walletAmount} />
                  <Text style={styles.walletUnit}>coins</Text>
                </View>
                <Text style={styles.walletSub}>Use coins to send virtual gifts & support Christian creators</Text>
              </View>
              <View style={{ alignItems: 'center', gap: 12 }}>
                <View style={styles.walletCoin}><Icon name="coin" size={26} color={colors.goldLight} /></View>
                <View style={styles.walletOpen}>
                  <Text style={styles.walletOpenText}>Open</Text>
                  <Icon name="chevron-right" size={12} color={colors.nightFg} strokeWidth={2.4} />
                </View>
              </View>
            </PressScale>
          </Section>
          </FadeInUp>

          <FadeInUp index={2} delay={80}>
          <Section title="Settings">
            <Group>
              <Item icon="bell" tint={colors.lavender} title="Scripture pop-ups" subtitle={popSub} chevron onPress={() => nav.push('ScripturePop')} />
              <Item
                icon="coin"
                tint={colors.gold}
                title="Coins & rewards"
                subtitle={coinLog.length ? `Last: ${coinLog[0].amount > 0 ? '+' : ''}${coinLog[0].amount} · ${coinLog[0].reason}` : 'Earn coins from daily games'}
                right={(
                  <View style={styles.coinRowRight}>
                    <Icon name="coin" size={13} color={colors.gold} />
                    <AnimatedNumber value={state.coins || 0} style={styles.coinRowText} />
                    <Chevron />
                  </View>
                )}
                onPress={() => setCoinSheet(true)}
              />
            </Group>
          </Section>
          </FadeInUp>

          <FadeInUp index={2} delay={100}>
          <Section title="Account & sync">
            <AccountSync />
          </Section>
          </FadeInUp>

          <FadeInUp index={2} delay={80}>
          <Section title="Availability for chat">
            <View style={styles.card}>
              <FieldLabel>Status</FieldLabel>
              <Chips items={Object.values(AVAILABILITY)} value={AVAILABILITY[availKey(u.availability)]} onChange={(v) => set({ availability: AVAIL_KEY[v] }, `Status: ${v}`, 'chat')} />
              <View style={styles.cardRule} />
              <FieldLabel>I accept</FieldLabel>
              <Chips items={withExtras(['General chat', 'Bible study', 'Prayer', 'Professional', 'Mentoring', 'Care / support'], acceptsChat)} value={acceptsChat} onChange={(v) => { const on = !acceptsChat.includes(v); set({ acceptsChat: on ? [...acceptsChat, v] : acceptsChat.filter((x) => x !== v) }, `${v} ${on ? 'accepted' : 'removed'}`, 'chat'); }} />
            </View>
          </Section>
          </FadeInUp>

          <FadeInUp index={3} delay={80}>
          <Section title="About you">
            <Group>
              <EditableItem icon="user" tint={colors.primary} title="Display name" value={u.displayName} placeholder="Your name" onSave={(v) => set({ displayName: v || u.displayName }, 'Name updated', 'user')} />
              <EditableItem icon="sparkles" tint={colors.gold} title="Headline" value={u.headline} placeholder="e.g. Youth leader · Software engineer" onSave={(v) => set({ headline: v }, 'Headline saved', 'user')} />
              <EditableItem icon="cross" tint={colors.rose} title="Testimony" value={u.testimony} placeholder="Share a short testimony (optional)" multiline onSave={(v) => set({ testimony: v }, 'Testimony saved', 'user')} />
              <EditableItem icon="compass" tint={colors.sky} title="Country" value={u.country} placeholder="Where you're based" onSave={(v) => set({ country: v }, 'Country saved', 'user')} />
            </Group>
          </Section>
          </FadeInUp>

          <FadeInUp index={4} delay={80}>
          <Section title="Professional profile">
            <Group>
              <EditableItem icon="cross" tint={colors.gold} title="Christian skills" value={u.christianSkills} placeholder="Teaching, worship, discipleship" onSave={(v) => set({ christianSkills: v }, 'Christian skills saved', 'user')} />
              <EditableItem icon="briefcase" tint={colors.sky} title="Professional skills" value={u.professionalSkills} placeholder="Technology, design, audio" onSave={(v) => set({ professionalSkills: v }, 'Professional skills saved', 'user')} />
              <EditableItem icon="book" tint={colors.lavender} title="Experience, education, certifications" value={u.experience} placeholder="Add your background" multiline onSave={(v) => set({ experience: v }, 'Experience saved', 'user')} />
              <EditableItem icon="star" tint={colors.terracotta} title="Portfolio" value={u.portfolio} placeholder="Link to your work" onSave={(v) => set({ portfolio: v }, 'Portfolio saved', 'user')} />
              <Item icon="signal" tint={colors.sage} title="Open to opportunities" subtitle="Shows a badge on your profile and in Jobs" right={<Toggle value={!!u.openToOpportunities} onChange={(v) => set({ openToOpportunities: v }, v ? 'Marked open to opportunities' : 'No longer open to opportunities', 'briefcase')} />} />
            </Group>
          </Section>
          </FadeInUp>

          <FadeInUp index={5} delay={80}>
          <Section title="Memberships">
            {state.communities.filter((c) => c.joined === true).length ? (
              <Group>
                {state.communities.filter((c) => c.joined === true).map((c) => <Item key={c.id} icon="users" tint={colors.sage} title={c.name} onPress={() => nav.push('Group', { id: c.id })} />)}
              </Group>
            ) : <Text style={styles.mutedNote}>You haven't joined any communities yet.</Text>}
          </Section>
          </FadeInUp>
        </View>
      ) : null}

      {tab === 'Wallet & Gifts' ? (
        <View>
          <View style={[styles.nightCard, { alignItems: 'center', paddingVertical: 26 }]}><NightGlow />
            <ScaleIn delay={80} from={0.5}>
              <Pop trigger={state.coins} amount={1.18}>
                <View style={styles.bigCoin}><Icon name="coin" size={34} color={colors.goldLight} /></View>
              </Pop>
              <Burst trigger={state.coins} radius={54} count={12} />
            </ScaleIn>
            <Eyebrow tint={colors.nightMuted} style={{ marginTop: 14 }}>Kingdom Virtual Currency Balance</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <AnimatedNumber value={state.coins || 0} style={styles.bigBalance} />
              <Text style={styles.walletUnit}>Coins</Text>
            </View>
            <Text style={[styles.walletSub, { textAlign: 'center', maxWidth: 270 }]}>
              Gift Christian evangelists, ministries, worship artists, and teachers on Socials.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <NightBtn kind="gold" label="+ Add 100 Coins" onPress={() => { dispatch({ type: 'buyCoins', amount: 100 }); toast.show(`Added 100 coins · balance ${(state.coins || 0) + 100}`, { icon: 'coin', haptic: 'success' }); }} />
              <NightBtn label="+ Add 500 Coins" onPress={() => { dispatch({ type: 'buyCoins', amount: 500 }); toast.show(`Added 500 coins · balance ${(state.coins || 0) + 500}`, { icon: 'coin', haptic: 'success' }); }} />
            </View>
          </View>

          <Section title="Gifts sent">
            {state.giftTransactions && state.giftTransactions.length ? (
              <Group>
                {state.giftTransactions.map((tx, idx) => {
                  const cost = tx.cost != null ? tx.cost : tx.coins;
                  const when = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : tx.time;
                  return (
                    <FadeInUp key={tx.id} index={idx} delay={140} distance={8}><Item
                      icon="gift"
                      tint={colors.rose}
                      title={`${tx.giftName} sent`}
                      subtitle={[tx.recipient ? `To ${tx.recipient}` : null, when].filter(Boolean).join(' · ')}
                      right={
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={styles.txAmount}>−{cost}</Text>
                          <Icon name="coin" size={13} color={colors.gold} />
                        </View>
                      }
                    /></FadeInUp>
                  );
                })}
              </Group>
            ) : (
              <Notice text="You haven't sent any gifts yet. Watch short videos on Socials and bless your favorite creators!" />
            )}
          </Section>
        </View>
      ) : null}

      {tab === 'Creator' ? (
        <View>
          <View style={styles.tabHead}>
            <View style={{ flex: 1 }}>
              <Eyebrow>Creator studio</Eyebrow>
              <Text style={styles.tabHeadTitle}>My Ministry Videos</Text>
            </View>
            <Button small label="Upload Short" onPress={() => nav.push('Socials')} icon={<Icon name="video" size={13} color="#FFFFFF" />} />
          </View>
          {myVideos.length ? (
            <Group>
              {myVideos.map((v, idx) => (
                <FadeInUp key={v.id} index={idx} distance={8}><Item
                  icon="play"
                  tint={colors.primary}
                  title={v.caption}
                  subtitle={`${v.views} views · ${v.likes} likes · ${v.gifts || 0} gifts`}
                  onPress={() => nav.push('Socials', { initialVideoId: v.id })}
                /></FadeInUp>
              ))}
            </Group>
          ) : (
            <View style={styles.emptyCard}>
              <Empty title="No videos yet" body="Videos and faith posts you publish on Socials appear here with their views, likes and gifts." action="Open Socials" onAction={() => nav.push('Socials')} />
            </View>
          )}
        </View>
      ) : null}

      {tab === 'Jobs' ? (
        <View>
          <View style={styles.tabHead}>
            <View style={{ flex: 1 }}>
              <Eyebrow>Marketplace</Eyebrow>
              <Text style={styles.tabHeadTitle}>My Marketplace Activity</Text>
            </View>
            <Button small label="Post Work" onPress={() => nav.push('Jobs')} icon={<Icon name="briefcase" size={13} color="#FFFFFF" />} />
          </View>
          <Section title="Submitted proposals" style={{ marginTop: 18 }}>
            {myProposals.length ? (
              <Group>
                {myProposals.map((pr, idx) => (
                  <FadeInUp key={pr.id} index={idx} distance={8}><Item
                    icon="briefcase"
                    tint={colors.sky}
                    title={`Applied for ${pr.jobTitle || 'Gig'}`}
                    subtitle={[pr.bidRate ? `Rate: ${pr.bidRate}` : null, pr.deliveryTime || pr.deliveryDays ? `Delivery: ${pr.deliveryTime || pr.deliveryDays + ' days'}` : null, pr.time].filter(Boolean).join(' · ')}
                    right={<Badge label={pr.status || 'Pending'} tint={colors.gold} />}
                    onPress={() => nav.push('Jobs')}
                  /></FadeInUp>
                ))}
              </Group>
            ) : (
              <View style={styles.emptyCard}>
                <Empty title="No proposals yet" body="Proposals you send from the marketplace appear here with their status." action="Browse jobs" onAction={() => nav.push('Jobs')} />
              </View>
            )}
          </Section>
        </View>
      ) : null}

      {tab === 'Study' ? (
        <View>
          <Section title="Translation" style={{ marginTop: 18 }}>
            <Chips items={TRANSLATIONS.filter((t) => t.available).map((t) => t.id)} value={state.translation} onChange={(t) => { dispatch({ type: 'set', patch: { translation: t } }); toast.show(`Reading in ${t}`, { icon: 'book', haptic: 'select' }); }} />
          </Section>
          <Section title="Study presets">
            {(u.presets || []).length ? (
              <Group>
                {u.presets.map((p) => <Item key={p.name} icon="sparkles" tint={u.preset === p.name ? colors.primary : colors.muted} title={p.name} subtitle={`${p.translation} · ${p.layout}${p.audio ? ' · Audio' : ''}${p.reminder ? ' · ' + p.reminder : ''}`} right={u.preset === p.name ? <Badge label="Active" tint={colors.primary} /> : null} onPress={() => { set({ preset: p.name }, `${p.name} preset active`, 'sparkles'); dispatch({ type: 'set', patch: { translation: p.translation } }); }} />)}
              </Group>
            ) : <Text style={styles.mutedNote}>No study presets saved yet.</Text>}
          </Section>
          <Section title="Reading">
            <Group>
              <Item
                title="Font size"
                right={
                  <View style={styles.stepper}>
                    <Pressable style={styles.stepBtn} hitSlop={6} onPress={() => dispatch({ type: 'set', patch: { fontSize: Math.max(12, state.fontSize - 1) } })}><Text style={[styles.stepText, { fontSize: 12 }]}>A−</Text></Pressable>
                    <Pop trigger={state.fontSize}><Text style={styles.stepValue}>{state.fontSize}</Text></Pop>
                    <Pressable style={styles.stepBtn} hitSlop={6} onPress={() => dispatch({ type: 'set', patch: { fontSize: Math.min(24, state.fontSize + 1) } })}><Text style={[styles.stepText, { fontSize: 15 }]}>A+</Text></Pressable>
                  </View>
                }
              />
              <Item title="Original-language depth" subtitle="Tap to change" right={prefs.langDepth || 'Basic'} onPress={() => { const v = cycle(LANG_DEPTH, prefs.langDepth || 'Basic'); setPrefT('langDepth', v, `Original-language depth: ${v}`, 'book'); }} />
              <Item title="Commentary traditions" subtitle="Tap to change" right={prefs.commentary || 'All'} onPress={() => { const v = cycle(COMMENTARY, prefs.commentary || 'All'); setPrefT('commentary', v, `Commentary: ${v}`, 'book'); }} />
              <Item title="Audio playback speed" subtitle="Narration speed · tap to change" right={`${nar.rate || 1}×`} onPress={() => { const v = cycle(READ_SPEEDS, nar.rate || 1); nar.setRate(v); toast.show(`Narration speed ${v}×`, { icon: 'headphones', haptic: 'select' }); }} />
              <Item title="Offline Bible" subtitle="KJV text is stored on this device" right={<Badge label="Available" tint={colors.teal} />} />
              <Item title="Data-saving mode" subtitle="Don't autoplay videos on mobile data" right={<Toggle value={!!prefs.dataSaver} onChange={(v) => setPrefT('dataSaver', v, v ? 'Data saving on' : 'Data saving off', 'signal')} />} />
            </Group>
          </Section>
          <Section title="Interests">
            <Chips items={withExtras(['Gospels', 'Leadership', 'Prayer', 'Youth', 'Marriage', 'Missions', 'Career', 'Doctrine', 'New believer'], interests)} value={interests} onChange={(i) => set({ interests: interests.includes(i) ? interests.filter((x) => x !== i) : [...interests, i] })} />
          </Section>
        </View>
      ) : null}

      {tab === 'Privacy' ? (
        <View>
          <Section title="Profile visibility" style={{ marginTop: 18 }}>
            <Chips items={['public', 'limited', 'community-only', 'connections-only', 'private']} value={u.profileVisibility} onChange={(v) => set({ profileVisibility: v }, `Profile visibility: ${v}`, 'shield')} />
          </Section>
          <Section title="Discoverable by">
            <Group>
              {Object.keys(u.discoverable || {}).map((k) => <Item key={k} title={cap(k)} right={<Toggle value={u.discoverable[k]} onChange={(v) => set({ discoverable: { ...u.discoverable, [k]: v } }, `${cap(k)} ${v ? 'can' : 'can’t'} find you`, 'shield')} />} />)}
              <Item title="Show church affiliation on profile" right={<Toggle value={!!u.church?.visible} onChange={(v) => set({ church: { ...u.church, visible: v } }, v ? 'Church shown on profile' : 'Church hidden from profile', 'church')} />} />
              <Item title="Online / last seen" right={<Toggle value={!!prefs.showOnline} onChange={(v) => setPrefT('showOnline', v, v ? 'Others can see when you’re online' : 'Online status hidden', 'shield')} />} />
            </Group>
          </Section>
          <Section title="Bible Chat & Scripture Companion">
            <Group>
              <Item title="Remember my study topics" right={<Toggle value={prefs.rememberTopics !== false} onChange={(v) => setPrefT('rememberTopics', v, v ? 'Study topics will be remembered' : 'Study topics won’t be remembered', 'sparkles')} />} />
              <Item title="Use my messages for personalization" subtitle="Off by default. Never used for ads." right={<Toggle value={!!prefs.personalize} onChange={(v) => setPrefT('personalize', v, v ? 'Personalization on' : 'Personalization off', 'sparkles')} />} />
              <Item title="Delete chat history" subtitle={`${(state.chatHistory || []).length} messages`} titleStyle={{ color: colors.negative }} onPress={(state.chatHistory || []).length ? () => setConfirmClear('chat') : undefined} />
              <Item title="Delete Companion history" subtitle={`${(state.companionHistory || []).length} entries`} titleStyle={{ color: colors.negative }} onPress={(state.companionHistory || []).length ? () => setConfirmClear('companion') : undefined} />
            </Group>
            {confirmClear ? (
              <InlineConfirm
                title={confirmClear === 'chat' ? 'Delete Bible Chat history?' : 'Delete Companion history?'}
                body="This removes it from this device. It can't be undone."
                confirmLabel="Delete"
                onCancel={() => setConfirmClear(null)}
                onConfirm={() => {
                  if (confirmClear === 'chat') dispatch({ type: 'chat', history: [] });
                  else dispatch({ type: 'set', patch: { companionHistory: [] } });
                  toast.show(confirmClear === 'chat' ? 'Chat history deleted' : 'Companion history deleted', { icon: 'trash' });
                  setConfirmClear(null);
                }}
              />
            ) : null}
          </Section>
          <Section title="Data">
            <Group>
              <Item icon="share" tint={colors.primary} title="Export my data" subtitle="A JSON copy of your notes, highlights, plans and more" onPress={() => exportData(state, toast)} />
              <Item icon="shield" tint={colors.rose} title="Blocked accounts" right={String(state.blocked.length)} />
              <Item icon="sparkles" tint={colors.gold} title="Consent & AI use" subtitle="How AI, memory and human review work" right={<Icon name={showConsent ? 'chevron-down' : 'chevron-right'} size={15} color={colors.faint} strokeWidth={2.2} />} onPress={() => setShowConsent(!showConsent)} />
            </Group>
            {showConsent ? <FadeInUp distance={6} duration={280}><Notice text="AI answers are drafts with Scripture references — never authority. Your chats stay on this device unless you turn on personalization. No human reviews your messages, and nothing is used for ads." /></FadeInUp> : null}
          </Section>
        </View>
      ) : null}

      {tab === 'Notifications' ? (
        <View style={{ marginTop: 18 }}>
          <Group style={{ marginBottom: 14 }}>
            <Item icon="bell" tint={colors.lavender} title="Scripture pop-ups" subtitle={popSub} chevron onPress={() => nav.push('ScripturePop')} />
          </Group>
          <Group>
            {[['push', 'Push'], ['email', 'Email'], ['bible', 'Bible reminders & plan progress'], ['groups', 'Group messages, mentions, replies'], ['prayer', 'Prayer responses'], ['events', 'Events, livestreams, celebrations'], ['gifts', 'Gifts & creator support'], ['jobs', 'Jobs & proposals']].map(([k, l]) => <Item key={k} title={l} right={<Toggle value={!!state.notifications[k]} onChange={(v) => setNotif(k, v, l)} />} />)}
            <Item title="Live services on Bible Nestra" subtitle="“LIVE NOW” when a channel starts streaming" right={<Toggle value={state.notifications.live !== false} onChange={(v) => setNotif('live', v, 'Live alerts')} />} />{/* YOUTUBE LIVE */}
            <Item title="Safety & security" subtitle="Login alerts and safety notices can't be turned off" right={<LockedToggle onPress={() => toast.show('Safety alerts are always on', { icon: 'lock' })} />} />
          </Group>
          <Group style={{ marginTop: 14 }}>
            <Item title="Quiet hours" subtitle="Tap to change" right={state.notifications.quietHours || 'Off'} onPress={() => setNotif('quietHours', cycle(QUIET_HOURS, state.notifications.quietHours || 'Off'), 'Quiet hours')} />
            <Item title="Digest frequency" subtitle="Tap to change" right={state.notifications.digest || 'Daily'} onPress={() => setNotif('digest', cycle(DIGESTS, state.notifications.digest || 'Daily'), 'Digest')} />
            <Item title="Preview privacy" subtitle="Hide message text on lock screen" right={<Toggle value={state.notifications.previewPrivacy !== false} onChange={(v) => setNotif('previewPrivacy', v, 'Preview privacy')} />} />
          </Group>
        </View>
      ) : null}

      {tab === 'Family' ? (
        <View style={{ marginTop: 6 }}>
          <Notice tint={colors.teal} text="Child profiles have age bands, guardian controls, safe downloads, no open direct messaging, and no public discovery." />
          <Group style={{ marginTop: 14 }}>
            {children.map((c) => (
              <Item key={c.id} icon="user" tint={colors.teal} title={c.name} subtitle="Child profile · guardian controls on" right={<Button small kind="ghost" label="Remove" onPress={() => { dispatch({ type: 'set', patch: { children: children.filter((x) => x.id !== c.id) } }); toast.show(`${c.name}'s profile removed`, { icon: 'trash' }); }} />} />
            ))}
            {addingChild ? (
              <FadeInUp distance={6} duration={260} style={{ padding: 14 }}>
                <FieldLabel>Child's first name</FieldLabel>
                <Input value={childName} onChangeText={setChildName} placeholder="First name only" autoFocus />
                <View style={[styles.btnRow, { marginTop: 10 }]}>
                  <Button small label="Add profile" disabled={!childName.trim()} onPress={() => { dispatch({ type: 'set', patch: { children: [...children, { id: 'ch' + Date.now(), name: childName.trim() }] } }); toast.show(`${childName.trim()}'s profile added`, { icon: 'user', haptic: 'success' }); setChildName(''); setAddingChild(false); }} />
                  <Button small kind="ghost" label="Cancel" onPress={() => { setAddingChild(false); setChildName(''); }} />
                </View>
              </FadeInUp>
            ) : <Item icon="user" tint={colors.teal} title="Add a child profile" onPress={() => setAddingChild(true)} />}
            <Item icon="sun" tint={colors.gold} title="Screen-time reminders" subtitle="Tap to change" right={prefs.screenTime || 'Off'} onPress={() => { const v = cycle(SCREEN_TIME, prefs.screenTime || 'Off'); setPrefT('screenTime', v, v === 'Off' ? 'Screen-time reminders off' : `Reminder after ${v}`, 'sun'); }} />
            <Item icon="shield" tint={colors.primary} title="Guardian can see progress" subtitle="Reading, games and badges" right={<Toggle value={prefs.guardianProgress !== false} onChange={(v) => setPrefT('guardianProgress', v, v ? 'Progress visible to guardians' : 'Progress hidden from guardians', 'shield')} />} />
            <Item icon="sparkles" tint={colors.rose} title="Bible stories, trivia, memory-match" subtitle="Age-appropriate activities" onPress={() => nav.push('Learn', { tab: 'Games' })} />
          </Group>
        </View>
      ) : null}

      {tab === 'Account' ? (
        <View style={{ marginTop: 18 }}>
          <Group>
            <Item icon="check" tint={sync.status === 'failed' ? colors.negative : colors.teal} title="Sync status" subtitle={sync.at ? 'Last saved ' + sync.at.toLocaleTimeString() : 'Saved locally on this device'} right={sync.status === 'failed' && sync.retry ? <Button small kind="ghost" label="Retry" onPress={sync.retry} /> : <Badge label={sync.status} tint={sync.status === 'failed' ? colors.negative : colors.teal} />} />
            <Item icon="share" tint={colors.primary} title="Back up my data" subtitle="Export a JSON copy you can keep" onPress={() => exportData(state, toast)} />
          </Group>
          <Group style={{ marginTop: 14 }}>
            <Item title="This device" subtitle={`${Platform.OS === 'web' ? 'Web browser' : Platform.OS === 'ios' ? 'iPhone' : 'Android'} · signed in locally`} right={<Badge label="Active" tint={colors.teal} />} />
            <Item icon="star" tint={colors.gold} title={state.premium ? 'BibleNestra Plus' : 'Plan · Free'} subtitle={state.premium ? 'Ad-free games · supporter badge · manage in Google Play' : 'Go ad-free with Plus · $4 a week or $35 a year'} onPress={() => nav.push('Plans')} />
            <Item title="Redo onboarding" subtitle="Walk through setup again" onPress={() => nav.push('Onboarding', { step: 0 })} />
          </Group>
          <Group style={{ marginTop: 14 }}>
            <Item title="Delete account & local data" subtitle="Erase everything stored on this device" titleStyle={{ color: colors.negative }} onPress={() => setConfirmReset(true)} />
          </Group>
          {confirmReset ? (
            <InlineConfirm
              title="Erase all data on this device?"
              body="Notes, highlights, plans, recordings, posts and settings will be reset. Export first if you want a copy."
              confirmLabel="Erase everything"
              onCancel={() => setConfirmReset(false)}
              onConfirm={doReset}
            />
          ) : (
            <Button kind="danger" label="Reset local data" style={{ marginTop: 22 }} onPress={() => setConfirmReset(true)} />
          )}
        </View>
      ) : null}
      </FadeInUp>

      {/* Coins & rewards: balance + recent coin activity (state.coinLog) */}
      <AnimatedModal visible={coinSheet} onRequestClose={() => setCoinSheet(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setCoinSheet(false)} accessibilityLabel="Close" />
          <View style={styles.coinSheet}>
            <View style={styles.sheetGrabber} />
            <View style={styles.cardHead}>
              <IconBadge name="coin" tint={colors.gold} />
              <View style={{ flex: 1 }}>
                <Eyebrow>Coins & rewards</Eyebrow>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                  <AnimatedNumber value={state.coins || 0} style={styles.coinSheetBalance} />
                  <Text style={styles.cardMeta}>coins</Text>
                </View>
              </View>
              <Button small kind="ghost" label="Wallet" onPress={() => { setCoinSheet(false); setTab('Wallet & Gifts'); }} />
            </View>
            <Text style={[styles.cardBody, { marginTop: 12 }]}>Earn 5 coins for every correct answer in your first round of each daily game. Spend coins on gifts and job bids.</Text>
            <ScrollView style={{ marginTop: 12, maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {coinLog.length ? (
                <Group>
                  {coinLog.slice(0, 30).map((c, idx) => (
                    <FadeInUp key={c.id || idx} index={idx} distance={6}>
                      <Item
                        icon={c.amount > 0 ? 'star' : 'gift'}
                        tint={c.amount > 0 ? colors.gold : colors.rose}
                        title={c.reason || (c.amount > 0 ? 'Reward' : 'Spent')}
                        subtitle={c.time ? new Date(c.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null}
                        right={<Text style={[styles.txAmount, c.amount > 0 && { color: colors.positive }]}>{c.amount > 0 ? '+' : '−'}{Math.abs(c.amount)}</Text>}
                      />
                    </FadeInUp>
                  ))}
                </Group>
              ) : (
                <Empty title="No coin activity yet" body="Play today's Bible games to earn your first coins." />
              )}
            </ScrollView>
            <View style={[styles.btnRow, { marginBottom: 6 }]}>
              <Button small label="Play today's games" onPress={() => { setCoinSheet(false); nav.push('Learn', { tab: 'Games' }); }} />
              <Button small kind="ghost" label="Close" onPress={() => setCoinSheet(false)} />
            </View>
          </View>
        </View>
      </AnimatedModal>
    </Screen>
  );
}

// ---------- Onboarding ----------
const WELCOME_POINTS = [
  { icon: 'book', tint: colors.primary, title: 'Read & study', body: 'Scripture, plans and tools in one place' },
  { icon: 'prayer', tint: colors.rose, title: 'Pray together', body: 'Share requests with the people you choose' },
  { icon: 'users', tint: colors.sage, title: 'Community & care', body: 'Churches, groups, mentors and support' },
];

export function OnboardingScreen({ params }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const asRoute = params != null; // pushed from Profile → Account, rather than shown as the first-run gate
  const [step, setStep] = useState(() => Math.max(0, Math.min(4, Number((params && params.step) || 0) || 0)));
  const [devotional, setDevotional] = useState(state.notifications ? state.notifications.bible !== false : true);
  const [autoAudio, setAutoAudio] = useState(!!(state.prefs && state.prefs.autoNarration));
  const [reminder, setReminder] = useState('06:30');
  const [name, setName] = useState(state.user.displayName);
  const [translation, setTranslation] = useState('KJV');
  const [interests, setInterests] = useState(['Gospels', 'Prayer']);
  const [churchQ, setChurchQ] = useState('');
  const [church, setChurch] = useState(null);
  const [disc, setDisc] = useState({ people: true, professionals: false, communities: true, churches: true });
  const [offer, setOffer] = useState(['Prayer']);
  const prevStep = useRef(step);
  const dir = step >= prevStep.current ? 1 : -1;
  useEffect(() => { prevStep.current = step; }, [step]);
  const matches = churchQ.length > 1 ? CHURCHES.filter((c) => (c.name + c.location).toLowerCase().includes(churchQ.toLowerCase())) : [];
  const steps = ['Welcome', 'Bible', 'Church', 'Connect', 'Done'];
  const finish = (skipped) => {
    dispatch({ type: 'onboard', user: { displayName: name.trim() || state.user.displayName || 'Friend', translation, interests, church: church ? { name: church.name, visible: true } : state.user.church, discoverable: disc, acceptsChat: offer } });
    if (!skipped) {
      dispatch({ type: 'set', patch: {
        notifications: { ...state.notifications, bible: devotional, readingReminder: reminder },
        prefs: { ...(state.prefs || {}), autoNarration: autoAudio },
      } });
    }
    toast.show(skipped ? 'Setup skipped · change anything later in Profile' : `Welcome, ${name.trim() || 'friend'}!`, { icon: skipped ? 'check' : 'sparkles', haptic: 'success' });
    if (asRoute) nav.pop();
  };
  return (
    <Screen
      title="BibleNestra"
      subtitle={`Step ${step + 1} of ${steps.length} · skippable`}
      back={asRoute}
      right={<Pressable onPress={() => finish(true)} hitSlop={10} style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.6 }]}><Text style={styles.skipText}>Skip</Text></Pressable>}
    >
      <View style={styles.stepper5} accessibilityLabel={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((s, i) => <AnimatedBar key={s} progress={i <= step ? 1 : 0} delay={i === step ? 60 : 0} style={styles.stepSeg} fillStyle={styles.stepSegOn} />)}
      </View>

      <StepSlide key={step} dir={dir}>
      {step === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 26 }}>
          <ScaleIn from={0.6} delay={60}>
            <View style={styles.welcomeOrb}>
              <Pulse min={0.96} max={1.04} duration={2200} style={styles.welcomeHalo} />
              <View style={styles.welcomeOrbInner}><OpenBook size={38} color={colors.goldLight} /></View>
            </View>
          </ScaleIn>
          <FadeInUp delay={180} distance={8} style={{ alignItems: 'center' }}>
            <View style={styles.ornament}><View style={styles.ornamentLine} /><Text style={styles.ornamentStar}>✦</Text><View style={styles.ornamentLine} /></View>
            <Eyebrow style={{ marginTop: 12 }}>A home for Scripture & fellowship</Eyebrow>
            <Text style={[styles.h1, { textAlign: 'center', marginTop: 8 }]}>Welcome</Text>
            <Text style={[styles.sub, { textAlign: 'center', maxWidth: 310 }]}>One connected place for Bible study, prayer, community and care. You control what you reveal.</Text>
          </FadeInUp>
          <Group style={{ alignSelf: 'stretch', marginTop: 24 }}>
            {WELCOME_POINTS.map((w, i) => <FadeInUp key={w.title} index={i} delay={280} distance={8}><Item icon={w.icon} tint={w.tint} title={w.title} subtitle={w.body} /></FadeInUp>)}
          </Group>
          <View style={{ alignSelf: 'stretch', marginTop: 24 }}>
            <FieldLabel>What should we call you?</FieldLabel>
            <Input placeholder="What should we call you?" value={name} onChangeText={setName} />
          </View>
        </View>
      ) : null}
      {step === 1 ? (
        <View>
          <Eyebrow style={{ marginTop: 22 }}>Step 2 · Bible</Eyebrow>
          <Text style={styles.h1}>Your Bible</Text>
          <Text style={styles.sub}>Pick a default translation. You can switch any time without losing your place.</Text>
          <Section title="Translation">
            <Chips items={TRANSLATIONS.filter((t) => t.lang === 'English').map((t) => t.id)} value={translation} onChange={(t) => TRANSLATIONS.find((x) => x.id === t).available && setTranslation(t)} />
            <Text style={[styles.cardMeta, { marginTop: 10 }]}>MSG, NIV, NLT, GNB, AMP and AMP Classic appear once licensed for your region.</Text>
          </Section>
          <Section title="Study interests">
            <Chips items={['Gospels', 'Psalms', 'Doctrine', 'Prayer', 'Worship', 'Leadership', 'Marriage', 'Parenting', 'Youth', 'Missions', 'Evangelism', 'Career', 'New believer']} value={interests} onChange={(i) => setInterests(interests.includes(i) ? interests.filter((x) => x !== i) : [...interests, i])} />
          </Section>
          <Section title="Reminders">
            <Group>
              <Item icon="sun" tint={colors.gold} title="Daily devotional" right={<Toggle value={devotional} onChange={setDevotional} />} />
              <Item icon="calendar" tint={colors.primary} title="Reading reminder" subtitle="Tap to change" right={reminder} onPress={() => setReminder(cycle(['06:30', '07:00', '12:00', '20:00', 'Off'], reminder))} />
              <Item icon="audio" tint={colors.lavender} title="Audio narration" subtitle="Offer to read chapters aloud" right={<Toggle value={autoAudio} onChange={setAutoAudio} />} />
            </Group>
          </Section>
        </View>
      ) : null}
      {step === 2 ? (
        <View>
          <Eyebrow style={{ marginTop: 22 }}>Step 3 · Church</Eyebrow>
          <Text style={styles.h1}>What is the name of your church?</Text>
          <Text style={styles.sub}>Optional. We will never attach you to a church just because the names are similar.</Text>
          <View style={styles.searchWrap}>
            <View style={styles.searchIcon}><Icon name="search" size={16} color={colors.faint} /></View>
            <Input placeholder="Start typing a church or ministry name" value={churchQ} onChangeText={(t) => { setChurchQ(t); setChurch(null); }} style={{ paddingLeft: 40 }} />
          </View>
          {matches.length ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              {matches.map((c) => {
                const on = church && church.id === c.id;
                return (
                  <PressScale key={c.id} scaleTo={0.98} onPress={() => { setChurch(c); setChurchQ(c.name); }} style={[styles.churchRow, on && styles.churchRowOn]}>
                    <IconBadge name="church" tint={on ? colors.primary : colors.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemTitle, on && { color: colors.primary }]}>{c.name}</Text>
                      <Text style={styles.itemSub}>{`${c.location} · ${c.tradition} · ${c.members} members · ${c.join === 'auto' ? 'Joins automatically' : c.join === 'approval' ? 'Requires approval' : 'Invite only'}`}</Text>
                    </View>
                    {on ? <ScaleIn from={0.3}><View style={styles.checkCircle}><Icon name="check" size={13} color="#FFFFFF" strokeWidth={2.8} /></View></ScaleIn> : c.verified ? <Badge label="Verified" tint={colors.teal} /> : <Tag label="Unverified" />}
                  </PressScale>
                );
              })}
            </View>
          ) : null}
          {churchQ.length > 1 && !matches.length ? (
            <FadeInUp distance={8} style={styles.card}>
              <Text style={styles.cardTitleLg}>Can't find your church?</Text>
              <View style={{ gap: 8, marginTop: 12 }}>
                <Button small kind="ghost" label="Add it for verification (no public listing yet)" onPress={() => setChurch({ id: 'manual', name: churchQ })} />
                <Button small kind="ghost" label="Invite a church administrator" onPress={() => shareText(toast, `Hi! Our church "${churchQ}" isn't on BibleNestra yet. Could you set it up so members can join? It's free for churches.`, { done: 'Invite shared' })} />
                <Button small kind="ghost" label="Continue without joining" onPress={() => setStep(3)} />
              </View>
            </FadeInUp>
          ) : null}
          {church ? <FadeInUp key={church.id} distance={6} duration={280}><Notice tint={colors.teal} text={church.join === 'auto' ? `You'll join ${church.name} automatically.` : church.join === 'approval' ? `A membership request will be sent to ${church.name}.` : church.id === 'manual' ? `${church.name} will be reviewed before any public listing is created.` : `${church.name} is invite-only. Ask an administrator for a code.`} /></FadeInUp> : null}
          {!churchQ ? (
            <View style={styles.hintCard}>
              <Icon name="church" size={18} color={colors.gold} />
              <Text style={styles.hintText}>Try "Grace", "Anglican" or a city like "Lagos".</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {step === 3 ? (
        <View>
          <Eyebrow style={{ marginTop: 22 }}>Step 4 · Connect</Eyebrow>
          <Text style={styles.h1}>Connect on your terms</Text>
          <Text style={styles.sub}>Choose who can find you and what you're open to. Nothing is shared without your say.</Text>
          <Section title="Who can discover you">
            <Group>
              {Object.keys(disc).map((k) => <Item key={k} icon={{ people: 'user', professionals: 'briefcase', communities: 'users', churches: 'church' }[k] || 'user'} tint={colors.primary} title={k[0].toUpperCase() + k.slice(1)} right={<Toggle value={disc[k]} onChange={(v) => setDisc({ ...disc, [k]: v })} />} />)}
            </Group>
          </Section>
          <Section title="I'd like to offer or receive">
            <Chips items={['Prayer', 'Mentoring', 'Encouragement', 'Bible study', 'Pastoral care', 'Counseling', 'Professional collaboration']} value={offer} onChange={(o) => setOffer(offer.includes(o) ? offer.filter((x) => x !== o) : [...offer, o])} />
          </Section>
          <Notice text="Sensitive answers are optional. You can change all of this later in Profile → Privacy." />
        </View>
      ) : null}
      {step === 4 ? (
        <View style={{ alignItems: 'center', marginTop: 34 }}>
          <View>
            <ScaleIn from={0.4} delay={80}>
              <View style={styles.doneOrb}><Icon name="check" size={38} color="#FFFFFF" strokeWidth={2.6} /></View>
            </ScaleIn>
            <MountBurst delay={260} radius={72} count={14} size={14} color={colors.gold} />
          </View>
          <FadeInUp delay={260} distance={8} style={{ alignItems: 'center' }}>
            <View style={styles.ornament}><View style={styles.ornamentLine} /><Text style={styles.ornamentStar}>✦</Text><View style={styles.ornamentLine} /></View>
            <Text style={[styles.h1, { textAlign: 'center', marginTop: 14 }]}>You're set, {name || 'friend'}.</Text>
            <Text style={[styles.sub, { textAlign: 'center' }]}>Reading in {translation}{church ? ` · ${church.name}` : ''}. Everything here can be changed later.</Text>
          </FadeInUp>
          <FadeInUp delay={380} distance={10} style={{ alignSelf: 'stretch', marginTop: 24 }}>
            <Group>
              <Item icon="book" tint={colors.primary} title="Translation" right={translation} />
              <Item icon="sparkles" tint={colors.gold} title="Interests" right={interests.length ? interests.slice(0, 2).join(', ') + (interests.length > 2 ? ` +${interests.length - 2}` : '') : 'None'} />
              <Item icon="church" tint={colors.sage} title="Church" right={church ? church.name : 'Not set'} />
            </Group>
          </FadeInUp>
        </View>
      ) : null}
      </StepSlide>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 30 }}>
        {step > 0 ? <Button kind="ghost" label="Back" onPress={() => setStep(step - 1)} /> : null}
        <Button label={step === steps.length - 1 ? 'Start' : 'Continue'} style={{ flex: 1 }} onPress={() => (step === steps.length - 1 ? finish(false) : setStep(step + 1))} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOutConfirm: { paddingHorizontal: 16, paddingVertical: 14 },
  // Cards
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 16, marginTop: 12, ...shadow.sm },
  cardPressed: { backgroundColor: colors.raised },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 17, lineHeight: 22, color: colors.fg, letterSpacing: -0.2, marginTop: 1 },
  cardTitleLg: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: colors.fg, letterSpacing: -0.3 },
  cardMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 16 },
  cardBody: { fontFamily: fonts.sans, fontSize: 14, color: colors.passage, lineHeight: 21, marginTop: 8 },
  cardRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 14 },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, ...shadow.sm },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  btnTight: { paddingHorizontal: 11 },
  audioRound: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  metaChips: { flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  mutedNote: { fontFamily: fonts.sans, fontSize: 13, color: colors.faint },
  bar: { overflow: 'hidden' },
  iconBadge: { alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12, rowGap: 10 },

  // Group / Item
  group: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', ...shadow.sm },
  groupSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 52 },
  itemTitle: { fontFamily: fonts.sansMedium, fontSize: 14, fontWeight: '600', color: colors.fg, letterSpacing: -0.1 },
  itemSub: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted, marginTop: 2, lineHeight: 17 },
  itemRight: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted },
  transcriptLine: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 22, color: colors.passage, letterSpacing: 0 },
  timeChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.xs, backgroundColor: colors.raised, alignSelf: 'flex-start', marginTop: 2 },
  timeChipText: { fontSize: 10.5, fontWeight: '700', color: colors.muted, fontVariant: ['tabular-nums'], letterSpacing: 0.3 },

  // Chips
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: alpha(colors.primary, 0.35) },
  chipText: { fontSize: 12.5, fontWeight: '500', color: colors.muted },
  chipTextOn: { color: colors.primary, fontWeight: '600' },

  // Tab strip
  tabStripWrap: { marginTop: 18, marginHorizontal: -18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  tabStrip: { paddingHorizontal: 18, gap: 20 },
  tabItem: { paddingTop: 6, alignItems: 'center' },
  tabText: { fontSize: 13.5, fontWeight: '600', color: colors.faint, paddingBottom: 10 },
  tabTextOn: { color: colors.fg },
  tabLine: { height: 2.5, alignSelf: 'stretch' },
  tabSlider: { position: 'absolute', bottom: 0, height: 2.5, borderRadius: 2, backgroundColor: colors.primary },

  // Profile hero
  heroCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.md },
  cover: { height: 92, backgroundColor: colors.night, overflow: 'hidden' },
  coverOrb: { position: 'absolute', backgroundColor: alpha(colors.indigo, 0.38) },
  coverMark: { position: 'absolute', top: 14, left: 16, color: colors.goldLight, fontSize: 13, opacity: 0.8 },
  avatarRing: { alignSelf: 'center', marginTop: -46, padding: 4, borderRadius: 50, backgroundColor: colors.surface, ...shadow.sm },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.cardGold, borderWidth: 1.5, borderColor: alpha(colors.gold, 0.45), alignItems: 'center', justifyContent: 'center' },
  avatarSm: { width: 46, height: 46, borderRadius: 23 },
  avatarText: { fontFamily: fonts.serifBold, fontSize: 36, color: colors.gold, marginTop: -2 },
  heroBody: { alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 20 },
  heroName: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.fg, letterSpacing: -0.6 },
  heroHandle: { fontSize: 13, color: colors.faint, marginTop: 1, fontWeight: '500' },
  heroMeta: { fontSize: 14, color: colors.fg, marginTop: 10, textAlign: 'center' },
  heroMetaFaint: { fontSize: 12.5, color: colors.muted, marginTop: 3, textAlign: 'center' },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  churchChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.primarySoft, maxWidth: 230 },
  churchChipText: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  visChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.raised },
  visChipText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  compactId: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, ...shadow.sm },
  compactName: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, letterSpacing: -0.3 },
  coinPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.cardGold },
  coinPillText: { fontSize: 13, fontWeight: '700', color: colors.goldMuted },

  // Stats
  statRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  statTile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 12, ...shadow.sm },
  statValue: { fontFamily: fonts.serifBold, fontSize: 26, lineHeight: 30, color: colors.fg, letterSpacing: -0.5, marginTop: 10 },
  statLabel: { fontSize: 11.5, color: colors.muted, marginTop: 1, fontWeight: '500' },

  // Wallet (night)
  walletCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.night, borderRadius: radius.lg, padding: 18, overflow: 'hidden', ...shadow.md },
  walletAmount: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.nightFg, letterSpacing: -0.8 },
  walletUnit: { fontFamily: fonts.serifItalic, fontSize: 17, color: colors.goldLight },
  walletSub: { fontSize: 12.5, lineHeight: 18, color: colors.nightMuted, marginTop: 6 },
  walletCoin: { width: 50, height: 50, borderRadius: 25, backgroundColor: alpha(colors.goldLight, 0.14), borderWidth: 1, borderColor: alpha(colors.goldLight, 0.3), alignItems: 'center', justifyContent: 'center' },
  walletOpen: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.nightRaised, borderWidth: 1, borderColor: colors.nightBorder },
  walletOpenText: { fontSize: 11.5, fontWeight: '700', color: colors.nightFg },
  bigCoin: { width: 72, height: 72, borderRadius: 36, backgroundColor: alpha(colors.goldLight, 0.14), borderWidth: 1, borderColor: alpha(colors.goldLight, 0.35), alignItems: 'center', justifyContent: 'center' },
  bigBalance: { fontFamily: fonts.display, fontSize: 48, lineHeight: 56, color: colors.nightFg, letterSpacing: -1 },
  txAmount: { fontSize: 13.5, fontWeight: '700', color: colors.goldMuted, fontVariant: ['tabular-nums'] },
  tabHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, marginBottom: 14 },
  tabHeadTitle: { fontFamily: fonts.serifBold, fontSize: 21, color: colors.fg, letterSpacing: -0.3, marginTop: 4 },

  // Stepper (font size)
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.raised, borderRadius: radius.pill, padding: 3 },
  stepBtn: { width: 32, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  stepText: { color: colors.primary, fontWeight: '700' },
  stepValue: { minWidth: 22, textAlign: 'center', fontSize: 13.5, fontWeight: '700', color: colors.fg, fontVariant: ['tabular-nums'] },

  // Night surfaces (plan hero, recorder, wallet)
  nightCard: { backgroundColor: colors.night, borderRadius: radius.lg, padding: 18, marginTop: 12, overflow: 'hidden', ...shadow.md },
  nightGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -120, right: -70, backgroundColor: alpha(colors.indigo, 0.32) },
  nightBig: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50, color: colors.nightFg, letterSpacing: -1 },
  nightMeta: { fontSize: 13, color: colors.nightMuted, marginTop: 2 },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.nightRaised, borderWidth: 1, borderColor: colors.nightBorder },
  streakText: { fontSize: 12, fontWeight: '700', color: colors.goldLight },
  nightBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, height: 36, borderRadius: radius.pill, backgroundColor: colors.nightRaised, borderWidth: 1, borderColor: colors.nightBorder },
  nightBtnGold: { backgroundColor: colors.goldLight, borderColor: colors.goldLight },
  nightBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.nightFg },

  // Plan
  todayCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow.sm },
  todayRef: { fontFamily: fonts.serifBold, fontSize: 23, lineHeight: 28, color: colors.fg, letterSpacing: -0.4, marginTop: 3 },
  roundArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  miniAvatar: { backgroundColor: colors.cardSage, alignItems: 'center', justifyContent: 'center' },
  miniAvatarText: { fontWeight: '700', color: colors.sage },

  // Devotional / memorize
  reflectBox: { marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderLeftWidth: 3, borderLeftColor: colors.gold, backgroundColor: colors.cardGold, borderRadius: radius.sm },
  reflectText: { fontFamily: fonts.serifItalic, fontSize: 15.5, lineHeight: 22, color: colors.passage },
  verseBox: { marginTop: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.screen, borderWidth: 1, borderColor: colors.rule },
  verseText: { fontFamily: fonts.serif, fontSize: 16.5, lineHeight: 26, color: colors.passage },
  verseBoxOn: { backgroundColor: colors.cardGold, borderColor: alpha(colors.gold, 0.3) },
  confRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  confLabel: { fontSize: 12, color: colors.muted, fontWeight: '500' },
  confDot: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5, borderColor: colors.borderStrong },
  confDotOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optRight: { borderColor: alpha(colors.positive, 0.5), backgroundColor: colors.positiveFaint },
  optWrong: { borderColor: alpha(colors.negative, 0.45), backgroundColor: colors.negativeFaint },

  coinRowRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  coinRowText: { fontSize: 14, fontWeight: '700', color: colors.fg },
  coinSheet: { backgroundColor: colors.screen, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26, ...shadow.lg },
  sheetGrabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 14 },
  coinSheetBalance: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.fg, letterSpacing: -0.4 },
  // Games
  dailyLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dailyLineText: { flex: 1, fontSize: 11.5, color: colors.faint },
  dailyLineScore: { fontSize: 11.5, fontWeight: '700', color: colors.goldMuted },
  practiceBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  practiceTag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.goldFaint },
  practiceTagText: { fontSize: 11, fontWeight: '700', color: colors.goldMuted, letterSpacing: 0.3 },
  practiceScore: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.fg },
  practiceEnd: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  adCard: { backgroundColor: colors.night, borderRadius: radius.lg, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10, marginTop: 12, alignItems: 'center', overflow: 'hidden', ...shadow.md },
  adCardIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  adCardTitle: { fontFamily: fonts.serifBold, fontSize: 21, lineHeight: 27, color: colors.nightFg, textAlign: 'center', marginTop: 6, letterSpacing: -0.3 },
  adCardSub: { fontSize: 13, lineHeight: 18, color: colors.nightMuted, textAlign: 'center', marginTop: 8 },
  adSkip: { paddingVertical: 10, paddingHorizontal: 18, marginTop: 4 },
  adSkipText: { fontSize: 13, fontWeight: '600', color: colors.nightMuted, textDecorationLine: 'underline' },
  gameCell: { width: '48.5%' },
  gameTile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, minHeight: 128, ...shadow.sm },
  gameTitle: { fontFamily: fonts.serifBold, fontSize: 16, lineHeight: 20, color: colors.fg, marginTop: 12, letterSpacing: -0.2 },
  gameSub: { fontSize: 11, color: colors.faint, marginTop: 4 },
  bestDot: { position: 'absolute', top: 12, right: 12, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  resultMedal: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  resultScore: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.fg, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  resultOf: { fontSize: 13.5, color: colors.muted, fontWeight: '500' },
  scoreChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.cardGold },
  scoreChipText: { fontSize: 12, fontWeight: '700', color: colors.goldMuted, fontVariant: ['tabular-nums'] },
  pickedWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 5 },
  nowPlaying: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.cardGold },
  nowPlayingText: { fontSize: 10.5, fontWeight: '700', color: colors.goldMuted, letterSpacing: 0.3 },
  memBurst: { position: 'absolute', right: 40, bottom: 18, width: 10, height: 10 },

  // Lesson player
  player: { height: 200, backgroundColor: colors.night, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 24, ...shadow.md },
  playBtnWrap: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  playHalo: { position: 'absolute', top: -8, left: -8, right: -8, bottom: -8 },
  playHaloRing: { width: 74, height: 74, borderRadius: 37, borderWidth: 1.5, borderColor: alpha(colors.goldLight, 0.45) },
  playBtn: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  playerTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.nightFg, marginTop: 12 },
  playerMeta: { fontSize: 11.5, color: colors.nightMuted, marginTop: 3, textAlign: 'center' },
  playerTrack: { position: 'absolute', left: 18, right: 18, bottom: 16, height: 3, borderRadius: 2, backgroundColor: colors.nightRaised },
  playerTrackFill: { borderRadius: 2, backgroundColor: colors.goldLight },

  // Recorder
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.nightMuted },
  recTime: { fontFamily: fonts.display, fontSize: 56, lineHeight: 64, color: colors.nightFg, textAlign: 'center', letterSpacing: -1, marginTop: 8, fontVariant: ['tabular-nums'] },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, height: 36, marginTop: 6 },
  waveBar: { width: 3, borderRadius: 1.5, backgroundColor: colors.goldLight },
  recMeta: { fontSize: 12, color: colors.nightMuted, textAlign: 'center', marginTop: 10 },
  cardActive: { borderColor: alpha(colors.primary, 0.35) },
  recPlay: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  recBtns: { flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },

  // Create
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  kindCell: { width: '32%' },
  kindTile: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 6, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  kindTileOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft, borderWidth: 1.5 },
  kindText: { fontSize: 12, fontWeight: '600', color: colors.fg, textAlign: 'center' },
  plusBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  plusText: { fontSize: 17, lineHeight: 19, fontWeight: '600', color: colors.primary },

  // Behaviour helpers
  lockedToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  lockedText: { fontSize: 11.5, fontWeight: '700', color: colors.primary },
  confirmBox: { marginTop: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: alpha(colors.negative, 0.3), backgroundColor: alpha(colors.negative, 0.06) },

  // Onboarding
  skipBtn: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  skipText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  stepper5: { flexDirection: 'row', gap: 6 },
  stepSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceRaised },
  stepSegOn: { borderRadius: 2, backgroundColor: colors.primary },
  welcomeOrb: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  welcomeHalo: { position: 'absolute', width: 112, height: 112, borderRadius: 56, backgroundColor: alpha(colors.gold, 0.12) },
  welcomeOrbInner: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', ...shadow.md },
  doneOrb: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 8, borderColor: colors.primarySoft },
  ornament: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  ornamentLine: { width: 40, height: 1, backgroundColor: colors.borderStrong },
  ornamentStar: { fontSize: 11, color: colors.gold },
  h1: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.fg, letterSpacing: -0.6, marginTop: 6 },
  sub: { fontFamily: fonts.sans, fontSize: 14, color: colors.muted, marginTop: 8, lineHeight: 20 },
  searchWrap: { marginTop: 20, justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: 14, zIndex: 1 },
  churchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  churchRowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  checkCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  hintCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 14, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
  hintText: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
});
