import { isDarkScheme } from '../design/palette';
// LIVE BIBLE BATTLES: 1-on-1, 8 questions, 12 seconds each. The server keeps the clock and the score
// (backend/src/routes/battles.js); this screen polls GET /battles/:id and shows whatever phase it reports.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Empty } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, AnimatedBar } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { d, df, Grad, Tap, SectionTitle } from '../design/sanctuary';
import { DScreen, DInput, DCard } from '../design/profile/parts';

const RESULT = { won: ['Won', d.sageDark], lost: ['Lost', '#B33D3D'], draw: ['Draw', d.muted] };
const BATTLE_GRAD = ['#2D1B10', '#B95019'];

/** Battle primary button (plum pill with arrow / icon), in the design's style. */
function BattleButton({ label, onPress, disabled, icon, style }) {
  return (
    <Tap onPress={disabled ? undefined : onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.cta, disabled && { opacity: 0.55 }, style]}>
      {icon}
      <Text style={styles.ctaText}>{label}</Text>
    </Tap>
  );
}

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
      <Grad colors={BATTLE_GRAD} style={styles.battleCard}>
        <Text style={styles.battleEyebrow}>Live Bible Battle</Text>
        <Text style={styles.battleTitle}>Go head-to-head{'\n'}in real time</Text>
        <Text style={styles.battleSub}>8 questions · 12 seconds each · faster right answers score more. Wins add points to the leaderboard.</Text>
        {data ? <Text style={styles.battleStats}>{data.stats.wins} wins from {data.stats.played} battles</Text> : null}
        <BattleButton label={busy ? 'Finding an opponent…' : 'Quick match'} disabled={busy} icon={<Icon name="flame" size={14} color={d.plumDark} />} onPress={quick} style={{ marginTop: 14, alignSelf: 'flex-start' }} />
      </Grad>

      <SectionTitle eyebrow="Challenge" title="Challenge a believer" />
      <DInput value={q} onChangeText={setQ} placeholder="Search by name or church" accessibilityLabel="Search people to challenge" />
      {people.map((u) => (
        <View key={u.id} style={styles.row}>
          <SocialAvatar name={u.displayName} uri={u.avatarUrl} size={36} />
          <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{u.displayName}</Text>
          <Tap onPress={() => challenge(u)} accessibilityRole="button" accessibilityLabel={`Challenge ${u.displayName}`} style={styles.smallCta}>
            <Text style={styles.smallCtaText}>Challenge</Text>
          </Tap>
        </View>
      ))}

      <SectionTitle eyebrow="History" title="Recent battles" />
      {!data ? <ActivityIndicator color={d.plum} /> : null}
      {data && !data.items.length ? <Text style={styles.muted}>No battles yet. Try a quick match!</Text> : null}
      {data && data.items.length ? (
        <DCard style={styles.listCard}>
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
        </DCard>
      ) : null}
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
    try { const data = await api.request('GET', `/battles/${params.id}`); fetchedAt.current = Date.now(); setB(data); setError(null); }
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

  const shell = (children) => <DScreen title="Bible Battle" back onBack={() => nav.pop()}>{children}</DScreen>;

  if (!b) return shell(error ? <Text style={styles.errorText}>{error}</Text> : <View style={styles.loading}><ActivityIndicator color={d.plum} /></View>);
  const drift = now - fetchedAt.current;
  const header = (
    <Grad colors={BATTLE_GRAD} style={styles.scoreboard}>
      <Player u={b.me} score={b.myScore} />
      <Text style={styles.vs}>VS</Text>
      <Player u={b.opponent} score={b.opponentScore} right />
    </Grad>
  );

  let body = null;
  if (b.status === 'cancelled') body = <Empty title="Battle cancelled" body="Start a new one from Contest Centre › Battles." />;
  else if (b.status === 'waiting') {
    body = b.iAmInvited ? (
      <DCard style={styles.card}>
        <View style={styles.center}>
          <Text style={styles.big}>{b.opponent ? b.opponent.displayName : 'Someone'} challenged you!</Text>
          <BattleButton label="Accept and play" icon={<Icon name="flame" size={14} color={d.plumDark} />} onPress={() => act('accept')} style={{ marginTop: 14, alignSelf: 'stretch' }} />
        </View>
      </DCard>
    ) : (
      <DCard style={styles.card}>
        <View style={styles.center}>
          <ActivityIndicator color={d.plum} size="large" />
          <Text style={styles.big}>{b.invited ? `Waiting for ${b.opponent ? b.opponent.displayName : 'them'} to accept…` : 'Finding an opponent…'}</Text>
          <Text style={styles.muted}>Keep this screen open. We’ll start as soon as they join.</Text>
          <Tap onPress={() => act('cancel')} accessibilityRole="button" accessibilityLabel="Cancel" style={[styles.ghost, { marginTop: 14 }]}>
            <Text style={styles.ghostText}>Cancel</Text>
          </Tap>
        </View>
      </DCard>
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
          <Text style={[styles.lastLine, { color: b.lastResult.myOption === b.lastResult.correctIndex ? d.sageDark : '#B33D3D' }]} numberOfLines={2}>
            {b.lastResult.myOption === b.lastResult.correctIndex ? `✓ +${b.lastResult.myPoints}` : '✗'} Last answer: {b.lastResult.options[b.lastResult.correctIndex]}
          </Text>
        ) : null}
        <View style={styles.qTop}>
          <Text style={styles.eyebrowText}>Question {cur.index + 1} of {b.total}</Text>
          <Text style={[styles.secs, left < 4000 && { color: '#B33D3D' }]}>{Math.ceil(left / 1000)}s</Text>
        </View>
        <AnimatedBar progress={left / total} delay={0} style={styles.bar} fillStyle={styles.barFill} />
        <FadeInUp key={cur.index} distance={8} duration={220}>
          <DCard style={styles.questionCard}>
            <Text style={styles.question}>{cur.question}</Text>
          </DCard>
          <View style={{ gap: 10 }}>
            {cur.options.map((o, i) => {
              const on = mine === i;
              return (
                <PressScale key={`${cur.index}-${i}`} onPress={() => answer(i)} disabled={mine !== undefined && mine !== null} scaleTo={0.98} style={[styles.option, on && styles.optionOn]} accessibilityRole="button" accessibilityLabel={o}>
                  <Text style={[styles.optionText, on && { color: d.plum, fontFamily: df.sansBold }]}>{o}</Text>
                  {on ? <Icon name="lock" size={14} color={d.plum} /> : null}
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
        <ScaleIn from={0.9}>
          <Grad colors={[(isDarkScheme() ? '#241f12' : '#E4D18E'), '#A66D22']} style={styles.final}>
            <Text style={styles.finalTitle}>{label}</Text>
            <Text style={styles.finalScore}>{b.myScore} – {b.opponentScore}</Text>
          </Grad>
        </ScaleIn>
        <BattleButton label="Rematch" icon={<Icon name="repost" size={14} color={d.plumDark} />} onPress={() => act('rematch', 'Rematch sent')} style={{ marginTop: 14, alignSelf: 'stretch' }} />
        {b.review ? (
          <>
            <SectionTitle eyebrow="Review" title="Answers" />
            {b.review.map((r) => (
              <DCard key={r.index} style={styles.review}>
                <Text style={styles.reviewQ}>{r.index + 1}. {r.question}</Text>
                <Text style={[styles.reviewA, { color: d.sageDark }]}>✓ {r.options[r.correctIndex]}</Text>
                {r.myOption !== r.correctIndex ? <Text style={[styles.reviewA, { color: '#B33D3D' }]}>{r.myOption === null ? 'No answer' : `You: ${r.options[r.myOption]}`}</Text> : <Text style={styles.meta}>+{r.myPoints} points</Text>}
                {r.reference ? <Text style={styles.ref}>{r.reference}</Text> : null}
              </DCard>
            ))}
          </>
        ) : null}
      </View>
    );
  } else body = <View style={styles.loading}><ActivityIndicator color={d.plum} /></View>;

  return shell(
    <>
      {header}
      {body}
    </>,
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 24, alignItems: 'center' },
  errorText: { marginTop: 20, fontFamily: df.sansSemi, fontSize: 14, color: '#B33D3D', textAlign: 'center' },
  muted: { marginTop: 6, fontFamily: df.sans, fontSize: 13, lineHeight: 18, color: d.muted, textAlign: 'center' },
  fine: { marginTop: 12, fontFamily: df.sans, fontSize: 12, lineHeight: 17, color: d.muted, textAlign: 'center' },
  eyebrowText: { fontFamily: df.sansBold, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: d.plum },
  battleCard: { padding: 20, borderRadius: 22, marginTop: 4 },
  battleEyebrow: { fontFamily: df.sansBold, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' },
  battleTitle: { marginTop: 6, fontFamily: df.displayBold, fontSize: 24, lineHeight: 29, letterSpacing: -0.4, color: '#FFFFFF' },
  battleSub: { marginTop: 8, fontFamily: df.sans, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.82)' },
  battleStats: { marginTop: 8, fontFamily: df.sansBold, fontSize: 13, color: d.gold },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, paddingHorizontal: 20, borderRadius: 999, backgroundColor: d.gold },
  ctaText: { fontFamily: df.sansBold, fontSize: 13, color: d.plumDark },
  smallCta: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: d.plum },
  smallCtaText: { fontFamily: df.sansBold, fontSize: 11, color: '#FFFFFF' },
  ghost: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: d.line, backgroundColor: d.glass },
  ghostText: { fontFamily: df.sansBold, fontSize: 13, color: d.ink },
  listCard: { marginTop: 4, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: d.line },
  name: { fontFamily: df.sansSemi, fontSize: 14, color: d.ink },
  meta: { marginTop: 1, fontFamily: df.sans, fontSize: 12, color: d.muted },
  result: { fontFamily: df.sansHeavy, fontSize: 13 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: d.plum },
  scoreboard: { marginTop: 4, flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 22 },
  player: { flex: 1, alignItems: 'flex-start', gap: 4 },
  playerName: { fontFamily: df.sansBold, fontSize: 13, color: '#FFFFFF', maxWidth: 130 },
  playerScore: { fontFamily: df.displayBold, fontSize: 26, color: d.gold },
  vs: { fontFamily: df.sansHeavy, fontSize: 13, color: 'rgba(255,255,255,0.72)', marginHorizontal: 8 },
  card: { marginTop: 14, padding: 18 },
  center: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  big: { marginTop: 10, fontFamily: df.displayBold, fontSize: 19, lineHeight: 25, color: d.ink, textAlign: 'center' },
  countdown: { fontFamily: df.displayBold, fontSize: 80, color: d.plum },
  lastLine: { marginTop: 12, fontFamily: df.sansBold, fontSize: 13 },
  qTop: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secs: { fontFamily: df.displayBold, fontSize: 20, color: d.plum },
  bar: { marginTop: 8, height: 6, borderRadius: 3, backgroundColor: d.lavender, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: d.plum },
  questionCard: { marginTop: 16, marginBottom: 14, padding: 18 },
  question: { fontFamily: df.displayBold, fontSize: 20, lineHeight: 27, color: d.ink },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: d.paper, borderWidth: 1.5, borderColor: d.line },
  optionOn: { borderColor: d.plum, backgroundColor: d.lavender },
  optionText: { flex: 1, fontFamily: df.sans, fontSize: 15, lineHeight: 20, color: d.ink },
  final: { marginTop: 14, padding: 20, borderRadius: 22, alignItems: 'center' },
  finalTitle: { fontFamily: df.displayBold, fontSize: 26, color: d.goldDark },
  finalScore: { marginTop: 4, fontFamily: df.sansBold, fontSize: 18, color: d.goldDark },
  review: { marginTop: 8, padding: 14 },
  reviewQ: { fontFamily: df.sansSemi, fontSize: 14, lineHeight: 19, color: d.ink },
  reviewA: { marginTop: 4, fontFamily: df.sans, fontSize: 13 },
  ref: { marginTop: 4, fontFamily: df.sansBold, fontSize: 12, color: d.plum },
});
