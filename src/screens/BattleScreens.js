// LIVE BIBLE BATTLES: 1-on-1, 8 questions, 12 seconds each. The server keeps the clock and the score
// (backend/src/routes/battles.js); this screen polls GET /battles/:id and shows whatever phase it reports.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, Section, Button, Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, AnimatedBar } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';

const RESULT = { won: ['Won', colors.positive], lost: ['Lost', colors.negative], draw: ['Draw', colors.muted] };

/** Tab inside Contest Centre: quick match, challenge a believer, history. */
export function BattlesPanel() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const focused = useIsFocused();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);

  const load = useCallback(async () => {
    try { setData(await api.request('GET', '/battles')); } catch (e) { setData({ items: [], stats: { played: 0, wins: 0 } }); }
  }, [api]);
  useEffect(() => { if (focused) load(); }, [load, focused]);
  useEffect(() => {
    if (q.trim().length < 2) { setPeople([]); return undefined; }
    const t = setTimeout(async () => {
      try { setPeople(((await api.request('GET', `/people?q=${encodeURIComponent(q.trim())}`)).items || []).slice(0, 6)); } catch (e) { setPeople([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, api]);

  const quick = async () => {
    setBusy(true);
    try { const b = await api.request('POST', '/battles/queue'); nav.push('Battle', { id: b.id }); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t find a match'), { tone: 'error', icon: 'x' }); }
    setBusy(false);
  };
  const challenge = async (u) => {
    try { const b = await api.request('POST', '/battles/challenge', { userId: u.id }); setQ(''); nav.push('Battle', { id: b.id }); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t send the challenge'), { tone: 'error', icon: 'x' }); }
  };

  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>Live Bible Battle</Text>
        <Text style={styles.heroTitle}>Go head-to-head in real time</Text>
        <Text style={styles.heroSub}>8 questions · 12 seconds each · faster right answers score more. Wins add points to the leaderboard.</Text>
        {data ? <Text style={styles.heroStats}>{data.stats.wins} wins from {data.stats.played} battles</Text> : null}
        <Button label={busy ? 'Finding an opponent…' : 'Quick match'} disabled={busy} icon={<Icon name="flame" size={14} color="#FFFFFF" />} onPress={quick} style={{ marginTop: 12 }} />
      </View>
      <Section title="Challenge a believer">
        <TextInput value={q} onChangeText={setQ} placeholder="Search by name or church" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="Search people to challenge" />
        {people.map((u) => (
          <View key={u.id} style={styles.row}>
            <SocialAvatar name={u.displayName} uri={u.avatarUrl} size={36} />
            <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{u.displayName}</Text>
            <Button small label="Challenge" onPress={() => challenge(u)} />
          </View>
        ))}
      </Section>
      <Section title="Recent battles">
        {!data ? <ActivityIndicator color={colors.primary} /> : null}
        {data && !data.items.length ? <Text style={styles.muted}>No battles yet. Try a quick match!</Text> : null}
        {(data ? data.items : []).map((b, i) => {
          const r = b.result ? RESULT[b.result] : null;
          return (
            <FadeInUp key={b.id} index={i} distance={6}>
              <PressScale onPress={() => nav.push('Battle', { id: b.id })} scaleTo={0.98} style={styles.row} accessibilityRole="button" accessibilityLabel={`Battle with ${b.opponent ? b.opponent.displayName : 'waiting for an opponent'}`}>
                <SocialAvatar name={b.opponent ? b.opponent.displayName : '?'} uri={b.opponent && b.opponent.avatarUrl} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{b.opponent ? `vs ${b.opponent.displayName}` : 'Waiting for an opponent'}</Text>
                  <Text style={styles.meta}>{b.iAmInvited ? 'Challenged you — tap to accept' : b.status === 'finished' ? `${b.myScore} – ${b.opponentScore}` : b.status === 'active' ? 'In progress' : 'Waiting'}</Text>
                </View>
                {r ? <Text style={[styles.result, { color: r[1] }]}>{r[0]}</Text> : b.iAmInvited ? <View style={styles.dot} /> : null}
              </PressScale>
            </FadeInUp>
          );
        })}
      </Section>
    </View>
  );
}

function Player({ u, score, right }) {
  return (
    <View style={[styles.player, right && { alignItems: 'flex-end' }]}>
      <SocialAvatar name={u ? u.displayName : '?'} uri={u && u.avatarUrl} size={44} />
      <Text style={styles.playerName} numberOfLines={1}>{u ? u.displayName : 'Waiting…'}</Text>
      <Text style={styles.playerScore}>{score || 0}</Text>
    </View>
  );
}

export function BattleScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const [b, setB] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState({});
  const [now, setNow] = useState(Date.now());
  const fetchedAt = useRef(Date.now());
  const alive = useRef(true);

  const load = useCallback(async () => {
    try { const d = await api.request('GET', `/battles/${params.id}`); fetchedAt.current = Date.now(); setB(d); setError(null); }
    catch (e) { setError(errorMessage(e, 'Couldn’t load the battle')); }
  }, [api, params.id]);
  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(() => { if (alive.current) load(); }, 900);
    const tick = setInterval(() => setNow(Date.now()), 200);
    return () => { alive.current = false; clearInterval(t); clearInterval(tick); };
  }, [load]);
  // stop polling once it's over
  useEffect(() => { if (b && (b.phase === 'finished' || b.status === 'cancelled')) alive.current = false; }, [b]);

  const answer = async (option) => {
    const cur = b.current;
    if (!cur || cur.answered || picked[cur.index] !== undefined) return;
    setPicked((p) => ({ ...p, [cur.index]: option }));
    try { await api.request('POST', `/battles/${b.id}/answer`, { index: cur.index, option }); load(); }
    catch (e) { toast.show(errorMessage(e, 'Too late'), { tone: 'error', icon: 'clock' }); }
  };
  const act = async (path, msg) => {
    try { const r = await api.request('POST', `/battles/${b.id}/${path}`); if (path === 'rematch') nav.replace('Battle', { id: r.id }); else { alive.current = true; setB(r); } if (msg) toast.show(msg, { icon: 'check' }); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t do that'), { tone: 'error', icon: 'x' }); }
  };

  if (!b) return <Screen back title="Bible Battle">{error ? <Notice tint={colors.negative} text={error} /> : <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>}</Screen>;
  const drift = now - fetchedAt.current;
  const header = (
    <View style={styles.scoreboard}>
      <Player u={b.me} score={b.myScore} />
      <Text style={styles.vs}>VS</Text>
      <Player u={b.opponent} score={b.opponentScore} right />
    </View>
  );

  let body = null;
  if (b.status === 'cancelled') body = <Empty title="Battle cancelled" body="Start a new one from Contest Centre › Battles." />;
  else if (b.status === 'waiting') {
    body = b.iAmInvited ? (
      <View style={styles.center}>
        <Text style={styles.big}>{b.opponent ? b.opponent.displayName : 'Someone'} challenged you!</Text>
        <Button label="Accept and play" icon={<Icon name="flame" size={14} color="#FFFFFF" />} onPress={() => act('accept')} style={{ marginTop: 14, alignSelf: 'stretch' }} />
      </View>
    ) : (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.big}>{b.invited ? `Waiting for ${b.opponent ? b.opponent.displayName : 'them'} to accept…` : 'Finding an opponent…'}</Text>
        <Text style={styles.muted}>Keep this screen open. We’ll start as soon as they join.</Text>
        <Button kind="ghost" label="Cancel" onPress={() => act('cancel')} style={{ marginTop: 14 }} />
      </View>
    );
  } else if (b.phase === 'countdown') {
    const s = Math.max(1, Math.ceil((b.msUntilStart - drift) / 1000));
    body = <View style={styles.center}><Text style={styles.muted}>Get ready…</Text><ScaleIn key={s} from={0.6}><Text style={styles.countdown}>{s}</Text></ScaleIn></View>;
  } else if (b.phase === 'question' && b.current) {
    const cur = b.current;
    const total = b.secondsPerQuestion * 1000;
    const left = Math.max(0, cur.msLeft - drift);
    const mine = cur.answered ? cur.myOption : picked[cur.index];
    body = (
      <View>
        {b.lastResult ? (
          <Text style={[styles.lastLine, { color: b.lastResult.myOption === b.lastResult.correctIndex ? colors.positive : colors.negative }]} numberOfLines={2}>
            {b.lastResult.myOption === b.lastResult.correctIndex ? `✓ +${b.lastResult.myPoints}` : '✗'} Last answer: {b.lastResult.options[b.lastResult.correctIndex]}
          </Text>
        ) : null}
        <View style={styles.qTop}>
          <Text style={styles.muted}>Question {cur.index + 1} of {b.total}</Text>
          <Text style={[styles.secs, left < 4000 && { color: colors.negative }]}>{Math.ceil(left / 1000)}s</Text>
        </View>
        <AnimatedBar progress={left / total} delay={0} style={styles.bar} fillStyle={styles.barFill} />
        <FadeInUp key={cur.index} distance={8} duration={220}>
          <Text style={styles.question}>{cur.question}</Text>
          <View style={{ gap: 10 }}>
            {cur.options.map((o, i) => {
              const on = mine === i;
              return (
                <PressScale key={`${cur.index}-${i}`} onPress={() => answer(i)} disabled={mine !== undefined && mine !== null} scaleTo={0.98} style={[styles.option, on && styles.optionOn]} accessibilityRole="button" accessibilityLabel={o}>
                  <Text style={[styles.optionText, on && { color: colors.primary, fontWeight: '700' }]}>{o}</Text>
                  {on ? <Icon name="lock" size={14} color={colors.primary} /> : null}
                </PressScale>
              );
            })}
          </View>
        </FadeInUp>
        <Text style={styles.fine}>{mine !== undefined && mine !== null ? 'Answer locked in. ' : ''}{cur.opponentAnswered ? `${b.opponent ? b.opponent.displayName : 'Your opponent'} has answered.` : ''}</Text>
      </View>
    );
  } else if (b.phase === 'finished' || b.status === 'finished') {
    const label = b.winner === 'me' ? 'You won!' : b.winner === 'opponent' ? `${b.opponent ? b.opponent.displayName : 'They'} won` : 'It’s a draw';
    body = (
      <View>
        <ScaleIn from={0.9}><View style={styles.final}><Text style={styles.finalTitle}>{label}</Text><Text style={styles.finalScore}>{b.myScore} – {b.opponentScore}</Text></View></ScaleIn>
        <Button label="Rematch" icon={<Icon name="repost" size={14} color="#FFFFFF" />} onPress={() => act('rematch', 'Rematch sent')} style={{ marginTop: 14 }} />
        {b.review ? <Section title="Answers">
          {b.review.map((r) => (
            <View key={r.index} style={styles.review}>
              <Text style={styles.reviewQ}>{r.index + 1}. {r.question}</Text>
              <Text style={[styles.reviewA, { color: colors.positive }]}>✓ {r.options[r.correctIndex]}</Text>
              {r.myOption !== r.correctIndex ? <Text style={[styles.reviewA, { color: colors.negative }]}>{r.myOption === null ? 'No answer' : `You: ${r.options[r.myOption]}`}</Text> : <Text style={styles.meta}>+{r.myPoints} points</Text>}
              {r.reference ? <Text style={styles.ref}>{r.reference}</Text> : null}
            </View>
          ))}
        </Section> : null}
      </View>
    );
  } else body = <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <Screen back title="Bible Battle">
      {header}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 24, alignItems: 'center' },
  muted: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center' },
  fine: { marginTop: 10, fontSize: 12, lineHeight: 17, color: colors.faint, textAlign: 'center' },
  hero: { marginTop: 12, padding: 18, borderRadius: 22, backgroundColor: colors.night, ...shadow.md },
  heroEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight },
  heroTitle: { marginTop: 6, fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 27, color: colors.nightFg },
  heroSub: { marginTop: 6, fontSize: 13.5, lineHeight: 19, color: colors.nightMuted },
  heroStats: { marginTop: 8, fontSize: 13, fontWeight: '700', color: colors.goldLight },
  input: { marginTop: 4, borderRadius: radius.md, backgroundColor: colors.raised, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.fg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { fontSize: 14, fontWeight: '600', color: colors.fg },
  meta: { marginTop: 1, fontSize: 12, color: colors.muted },
  result: { fontSize: 13, fontWeight: '800' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  scoreboard: { marginTop: 12, flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.lg, backgroundColor: colors.night, ...shadow.md },
  player: { flex: 1, alignItems: 'flex-start', gap: 4 },
  playerName: { fontSize: 13, fontWeight: '700', color: colors.nightFg, maxWidth: 130 },
  playerScore: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.goldLight },
  vs: { fontSize: 13, fontWeight: '800', color: colors.nightMuted, marginHorizontal: 8 },
  center: { alignItems: 'center', paddingVertical: 30, gap: 6 },
  big: { marginTop: 10, fontFamily: fonts.serifBold, fontSize: 19, lineHeight: 25, color: colors.fg, textAlign: 'center' },
  countdown: { fontFamily: fonts.serifBold, fontSize: 80, color: colors.primary },
  lastLine: { marginTop: 12, fontSize: 13, fontWeight: '700' },
  qTop: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secs: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.primary },
  bar: { marginTop: 8, height: 6, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  question: { marginTop: 16, marginBottom: 14, fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 27, color: colors.fg },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.fg },
  final: { marginTop: 16, padding: 20, borderRadius: radius.lg, alignItems: 'center', backgroundColor: colors.cardGold },
  finalTitle: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.fg },
  finalScore: { marginTop: 4, fontSize: 18, fontWeight: '700', color: colors.goldMuted },
  review: { marginTop: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  reviewQ: { fontSize: 14, lineHeight: 19, fontWeight: '600', color: colors.fg },
  reviewA: { marginTop: 4, fontSize: 13 },
  ref: { marginTop: 4, fontSize: 12, fontWeight: '700', color: colors.gold },
});
