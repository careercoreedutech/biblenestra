// Daily engagement pop-ups: an occasional card when the app opens.
//   • a time-of-day greeting
//   • "N people currently need support" → Fund Me
//   • "Some members are requesting prayers" → Prayer Wall
// Shown at most once every POP_GAP_MS, rotating through the kinds that have something to say.
// Users can switch them off from the card ("Don't show these").
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedModal } from './Motion';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { colors, fonts } from '../theme';

const POP_GAP_MS = 6 * 3600e3; // at most one pop-up every 6 hours
const FIRST_DELAY_MS = 2500;   // let the app settle first
const WEEK_MS = 7 * 24 * 3600e3;

// Greeting by the phone's local time (wording from the client). The emoji is shown large above the title.
export function greetingFor(hour) {
  if (hour >= 5 && hour < 12) {
    return { emoji: '☀️', title: 'Good morning!', body: 'Welcome back to Bible Nestra. Begin your day with God’s Word and let His wisdom guide your steps. God bless you.' };
  }
  if (hour >= 12 && hour < 17) {
    return { emoji: '🌤️', title: 'Good afternoon!', body: 'Take a moment to pause, reflect and reconnect with God’s Word. Let His truth refresh your heart. God bless you.' };
  }
  if (hour >= 17 && hour < 22) {
    return { emoji: '🌙', title: 'Good evening!', body: 'As the day winds down, find rest in God’s presence. Spend a quiet moment with Scripture. God bless you.' };
  }
  // late night (10 pm – 5 am)
  return { emoji: '✝️', title: 'Welcome to Bible Nestra', body: 'Jesus Christ loves you and will meet you as you study His word in fellowship. God bless you.' };
}

// Pure: picks which pop-up to show (exported for tests).
export function pickPopup({ now = Date.now(), lastAt = 0, idx = 0, off = false, counts = {} }) {
  if (off || now - (lastAt || 0) < POP_GAP_MS) return null;
  const hour = new Date(now).getHours();
  const kinds = [];
  kinds.push({ kind: 'greeting', ...greetingFor(hour), cta: 'Amen', route: null });
  if (counts.fundraisers > 0) {
    const n = counts.fundraisers;
    kinds.push({
      kind: 'support',
      title: `${n}${counts.fundraisersMore ? '+' : ''} ${n === 1 ? 'person currently needs' : 'people currently need'} support`,
      body: 'Would you be willing to help? Even a small gift can lift someone today.',
      cta: 'See who needs help',
      route: 'FundMe',
    });
  }
  if (counts.prayers > 0) {
    kinds.push({
      kind: 'prayer',
      title: 'Some members are requesting prayers',
      body: `${counts.prayers} prayer ${counts.prayers === 1 ? 'request' : 'requests'} this week. Would you like to pray for someone?`,
      cta: 'Pray for someone',
      route: 'PrayerWall',
    });
  }
  return kinds[idx % kinds.length];
}

async function loadCounts(api) {
  if (!api.online) return {};
  const counts = {};
  try {
    const fr = await api.request('GET', '/fundraisers?limit=50');
    counts.fundraisers = (fr.items || []).length;
    counts.fundraisersMore = !!fr.hasMore;
  } catch (e) { /* ignore — the pop-up just skips this kind */ }
  try {
    const pr = await api.request('GET', '/prayers');
    const since = Date.now() - WEEK_MS;
    counts.prayers = (pr.items || []).filter((p) => {
      const t = Date.parse(p.createdAt || p.created_at || '');
      return !Number.isFinite(t) || t >= since;
    }).length;
  } catch (e) { /* ignore */ }
  return counts;
}

export default function EngagementPopup() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const api = useApi();
  const [pop, setPop] = useState(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (state.engagePopOff) return;
      if (Date.now() - (state.engagePopAt || 0) < POP_GAP_MS) return;
      const counts = await loadCounts(api);
      if (!alive) return;
      const p = pickPopup({ lastAt: state.engagePopAt, idx: state.engagePopIdx || 0, off: state.engagePopOff, counts });
      if (!p) return;
      dispatch({ type: 'set', patch: { engagePopAt: Date.now(), engagePopIdx: (state.engagePopIdx || 0) + 1 } });
      setPop(p);
    }, FIRST_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
    // run once per app open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => setPop(null);
  const go = () => {
    const route = pop && pop.route;
    close();
    if (route) nav.push(route);
  };

  return (
    <AnimatedModal visible={!!pop} onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        {pop ? (
          <View style={styles.card} accessibilityRole="alert">
            <Text style={styles.emoji}>{pop.kind === 'support' ? '🤝' : pop.kind === 'prayer' ? '🙏' : pop.emoji || '☀️'}</Text>
            <Text style={styles.title}>{pop.title}</Text>
            <Text style={styles.body}>{pop.body}</Text>
            <Pressable onPress={go} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Text style={styles.ctaText}>{pop.cta}</Text>
            </Pressable>
            {pop.route ? (
              <Pressable onPress={close} hitSlop={8} style={styles.later} accessibilityRole="button">
                <Text style={styles.laterText}>Maybe later</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => { dispatch({ type: 'set', patch: { engagePopOff: true } }); close(); }}
              hitSlop={8}
              style={styles.off}
              accessibilityRole="button"
            >
              <Text style={styles.offText}>Don’t show these</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: 24, paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center' },
  emoji: { fontSize: 40, marginBottom: 10 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.fg, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: 'center', marginTop: 8 },
  cta: { marginTop: 20, alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  later: { marginTop: 12, paddingVertical: 4 },
  laterText: { color: colors.fg, fontSize: 14, fontWeight: '600' },
  off: { marginTop: 10, paddingVertical: 4 },
  offText: { color: colors.faint || colors.muted, fontSize: 12 },
});
