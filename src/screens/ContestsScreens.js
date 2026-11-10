// CONTEST CENTRE (Discover → Contests): Discover · My Contests · Leaderboards · Hall of Fame · Battles,
// contest details (quiz or creative entry), entries gallery with free voting, results, certificates.
// The server does every score, vote count and payout (backend/src/routes/contests.js).
// Paid entry / paid votes are not enabled: fees are shown, registration says "opens soon".
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, RefreshControl, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video, ResizeMode, Audio } from 'expo-av';
import { Screen, Section, Button, Empty, Notice, Badge, NightGlow, Pills, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, AnimatedBar, AnimatedModal } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { useSync } from '../api/sync';
import { API_CONFIG } from '../api/config';
import { pickPhotos, uploadImage, pickVideo, uploadVideo, pickAudio, uploadAudio } from '../api/media';
import { BattlesPanel } from './BattleScreens';

export const STATUS = {
  upcoming: { label: 'Upcoming', tint: colors.sky },
  registration_open: { label: 'Registration open', tint: colors.teal },
  live: { label: 'Live now', tint: colors.positive },
  voting_open: { label: 'Voting open', tint: colors.lavender },
  judging: { label: 'Judging', tint: colors.gold },
  completed: { label: 'Completed', tint: colors.muted },
  paused: { label: 'Paused', tint: colors.amber },
  pending_approval: { label: 'Awaiting approval', tint: colors.amber },
  rejected: { label: 'Not approved', tint: colors.negative },
  cancelled: { label: 'Cancelled', tint: colors.negative },
};
const CATEGORY_ART = {
  bible_knowledge: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?auto=format&fit=crop&w=900&q=70',
  scripture_memory: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=900&q=70',
  daily_quiz: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=70',
  church_vs_church: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?auto=format&fit=crop&w=900&q=70',
  verse_design: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=900&q=70',
  gospel_talent: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=70',
  christian_writing: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=900&q=70',
  preaching: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=900&q=70',
  photography: 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=900&q=70',
  video: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=900&q=70',
  interpretation: 'https://images.unsplash.com/photo-1490127252417-7c393f993ee4?auto=format&fit=crop&w=900&q=70',
  testimony: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?auto=format&fit=crop&w=900&q=70',
};
const SYMBOL = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', GHS: 'GH₵', KES: 'KSh' };
export const feeLabel = (c) => (c.entryFeeMinor ? `${SYMBOL[c.currency] || ''}${(c.entryFeeMinor / 100).toLocaleString()} entry` : 'Free entry');
export const artFor = (c) => c.bannerUrl || CATEGORY_ART[c.contestCategory] || CATEGORY_ART.bible_knowledge;
const answersKey = (id) => `biblenestra:contest:${id}`;
const ordinal = (n) => { const t = n % 100; if (t >= 11 && t <= 13) return `${n}th`; return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const seconds = (ms) => `${(Math.round((ms || 0) / 100) / 10).toFixed(1)}s`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
export function timeUntil(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
export function prizeLine(c) {
  const coins = c.prizeCoins && c.prizeCoins[0] ? `Win up to ${c.prizeCoins[0].toLocaleString()} coins` : '';
  const extra = (c.prizePlaces && c.prizePlaces[0] && c.prizePlaces[0].description) || c.prizeText || '';
  return [coins, extra].filter(Boolean).join(' · ');
}
function timing(c) {
  switch (c.status) {
    case 'live': return c.format === 'submission' ? `Entries close in ${timeUntil(c.endsAt)}` : `Ends in ${timeUntil(c.endsAt)}`;
    case 'registration_open': return `Starts in ${timeUntil(c.startsAt)}`;
    case 'upcoming': return `Starts in ${timeUntil(c.startsAt)}`;
    case 'voting_open': return `Voting ends in ${timeUntil(c.votingEndsAt)}`;
    case 'judging': return 'Results coming soon';
    case 'completed': return `Completed ${new Date(c.resultsPublishedAt || c.endsAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
    default: return (STATUS[c.status] || {}).label || '';
  }
}

// ---------- shared bits ----------
export function ContestCard({ c, index = 0, onPress }) {
  const s = STATUS[c.status] || STATUS.completed;
  const mine = c.myEntry || c.mySubmissionId || c.myRegistration;
  return (
    <FadeInUp index={index} distance={10}>
      <PressScale onPress={onPress} scaleTo={0.98} style={styles.card} accessibilityRole="button" accessibilityLabel={`${c.title}. ${s.label}. ${prizeLine(c)}`}>
        <Image source={{ uri: artFor(c) }} style={styles.cardArt} />
        <View style={styles.cardArtScrim} />
        <View style={styles.cardArtTop}>
          <View style={[styles.statusPill, { backgroundColor: alpha(s.tint, 0.92) }]}><Text style={styles.statusPillText}>{s.label}</Text></View>
          <View style={styles.feePill}><Text style={styles.feePillText}>{feeLabel(c)}</Text></View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardCat}>{c.contestCategoryLabel}{c.teamMode === 'church' ? ' · Church teams' : ''}</Text>
          <Text style={styles.cardTitle} numberOfLines={2}>{c.title}</Text>
          {c.description ? <Text style={styles.cardDesc} numberOfLines={2}>{c.description}</Text> : null}
          {prizeLine(c) ? <View style={styles.prizeRow}><Icon name="gift" size={14} color={colors.gold} /><Text style={styles.prizeText} numberOfLines={1}>{prizeLine(c)}</Text></View> : null}
          <View style={styles.cardFoot}>
            <Text style={styles.cardMeta}>{timing(c)} · {c.participants || 0} joined</Text>
            <View style={styles.joinBtn}><Text style={styles.joinBtnText}>{mine ? 'Open' : c.status === 'completed' ? 'Results' : 'Join contest'}</Text></View>
          </View>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

function Leaderboard({ rows, kind }) {
  if (!rows) return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
  if (!rows.length) return <Text style={styles.muted}>No scores yet. Be the first!</Text>;
  return (
    <View style={styles.board}>
      {rows.map((r) => (
        <View key={(r.user && r.user.id) || r.communityId || r.name} style={[styles.boardRow, r.isMe && styles.boardRowMe]}>
          <Text style={[styles.boardPlace, r.place <= 3 && { color: colors.gold }]}>{r.place}</Text>
          {r.user ? <SocialAvatar name={r.user.displayName} uri={r.user.avatarUrl} size={34} /> : <View style={styles.churchDot}><Icon name="church" size={16} color={colors.primary} /></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.boardName} numberOfLines={1}>{r.user ? r.user.displayName : r.name}{r.isMe ? ' (you)' : ''}</Text>
            <Text style={styles.boardMeta} numberOfLines={1}>
              {kind === 'quiz' ? `${r.correct}/${r.total} correct · ${seconds(r.durationMs)}`
                : kind === 'church' ? `${r.points} points · ${r.members} ${r.members === 1 ? 'member' : 'members'}`
                  : kind === 'global' ? `${r.points.toLocaleString()} points${r.country ? ` · ${r.country}` : ''}`
                    : `${r.title}${r.votes !== undefined && r.votes !== null ? ` · ${r.votes} votes` : ''}${r.score !== null && r.score !== undefined ? ` · score ${r.score}` : ''}`}
            </Text>
          </View>
          {r.prizeCoins ? <View style={styles.coin}><Icon name="coin" size={13} color={colors.gold} /><Text style={styles.coinText}>{r.prizeCoins}</Text></View> : null}
        </View>
      ))}
    </View>
  );
}

// ---------- Contest Centre home ----------
const TABS = ['Discover', 'My Contests', 'Leaderboards', 'Hall of Fame', 'Battles'];
const STATUS_FILTERS = [['all', 'All'], ['live', 'Live'], ['registration_open', 'Registration open'], ['voting_open', 'Voting'], ['closing', 'Closing soon'], ['upcoming', 'Upcoming'], ['completed', 'Completed']];

export function ContestsScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const { state } = useStore();
  const [tab, setTab] = useState(TABS.includes(params.tab) ? params.tab : 'Discover');
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('all');
  const [status, setStatus] = useState('all');
  const [items, setItems] = useState(null);
  const [mine, setMine] = useState(null);
  const [certs, setCerts] = useState([]);
  const [board, setBoard] = useState(null);
  const [period, setPeriod] = useState('week');
  const [by, setBy] = useState('people');
  const [myCountry, setMyCountry] = useState(false);
  const [hof, setHof] = useState(null);
  const [roles, setRoles] = useState({ organizer: false, judge: false });
  const [error, setError] = useState(null);
  const [pulling, setPulling] = useState(false);
  const focused = useIsFocused();

  const load = useCallback(async () => {
    if (!api.online) return;
    try {
      if (tab === 'Discover') {
        const [c, l] = await Promise.all([api.request('GET', '/contests/categories'), api.request('GET', `/contests${status === 'closing' ? '?sort=closing' : ''}`)]);
        setCats(c.items || []); setItems(l.items || []);
      } else if (tab === 'My Contests') {
        const [m, cc] = await Promise.all([api.request('GET', '/contests/mine'), api.request('GET', '/me/certificates')]);
        setMine(m.items || []); setCerts(cc.items || []);
      } else if (tab === 'Leaderboards') {
        const country = myCountry && state.user && state.user.country ? `&country=${encodeURIComponent(state.user.country)}` : '';
        setBoard(null);
        setBoard((await api.request('GET', `/leaderboards?period=${period}&by=${by}${country}`)).items || []);
      } else if (tab === 'Hall of Fame') {
        setHof((await api.request('GET', '/contests/hall-of-fame')).items || []);
      }
      setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load contests')); }
  }, [api, tab, status, period, by, myCountry]);
  useEffect(() => { if (focused) load(); }, [load, focused]);
  useEffect(() => {
    if (!api.online) return;
    (async () => {
      const [o, j] = await Promise.all([api.request('GET', '/organizer/contests').catch(() => null), api.request('GET', '/judging').catch(() => ({ items: [] }))]);
      setRoles({ organizer: !!o, judge: !!(j && j.items && j.items.length) });
    })();
  }, [api, focused]);
  const refresh = async () => { setPulling(true); await load(); setPulling(false); };

  if (!api.online) {
    return <Screen back title="Contest Centre"><Empty title="Sign in to join contests" body="Contests are played online so everyone shares the same leaderboard." /></Screen>;
  }
  let list = items || [];
  if (cat !== 'all') list = list.filter((c) => c.contestCategory === cat);
  if (status !== 'all' && status !== 'closing') list = list.filter((c) => c.status === status);
  const order = { live: 0, voting_open: 1, registration_open: 2, upcoming: 3, judging: 4, completed: 5 };
  if (status !== 'closing') list = [...list].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return (
    <Screen back title="Contest Centre" subtitle="Compete, showcase your gifts, win prizes"
      right={roles.organizer ? (
        <PressScale onPress={() => nav.push('ContestOrganize')} scaleTo={0.92} style={styles.headBtn} accessibilityRole="button" accessibilityLabel="Organize contests">
          <Icon name="plus" size={18} color="#FFFFFF" strokeWidth={2.4} />
        </PressScale>
      ) : null}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={colors.primary} />}>
      <Pills items={TABS} value={tab} onChange={setTab} style={{ marginTop: 10 }} />
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {roles.judge ? (
        <PressScale onPress={() => nav.push('ContestJudge')} scaleTo={0.98} style={styles.roleRow} accessibilityRole="button" accessibilityLabel="Judging">
          <Icon name="star" size={16} color={colors.lavender} /><Text style={styles.roleText}>You have entries to judge</Text><Icon name="chevron-right" size={14} color={colors.faint} />
        </PressScale>
      ) : null}

      {tab === 'Discover' ? (
        <View>
          <View style={styles.hero}>
            <NightGlow />
            <Text style={styles.heroEyebrow}>Contest Centre</Text>
            <Text style={styles.heroTitle}>Show your Bible knowledge and your gifts</Text>
            <Text style={styles.heroSub}>Quizzes, memory challenges, gospel talent, writing, photography and more. Fair scoring, real prizes, certificates for winners.</Text>
          </View>
          <Pills small items={[{ id: 'all', label: 'All categories' }, ...cats.map((x) => ({ id: x.id, label: x.label.replace(/ (Contest|Challenge)$/, '') }))].map((x) => x.label)}
            value={(cat === 'all' ? 'All categories' : (cats.find((x) => x.id === cat) || {}).label || '').replace(/ (Contest|Challenge)$/, '')}
            onChange={(label) => { const f = cats.find((x) => x.label.replace(/ (Contest|Challenge)$/, '') === label); setCat(f ? f.id : 'all'); }} style={{ marginTop: 12 }} />
          <Pills small items={STATUS_FILTERS.map((s) => s[1])} value={(STATUS_FILTERS.find((s) => s[0] === status) || STATUS_FILTERS[0])[1]} onChange={(l) => setStatus((STATUS_FILTERS.find((s) => s[1] === l) || STATUS_FILTERS[0])[0])} style={{ marginTop: 8 }} />
          {!items && !error ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
          {items && !list.length ? <Empty title="No contests here yet" body="Try another category or check back soon." /> : null}
          {list.map((c, i) => <ContestCard key={c.id} c={c} index={i} onPress={() => nav.push('Contest', { id: c.id })} />)}
        </View>
      ) : null}

      {tab === 'My Contests' ? (
        <View>
          {!mine ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
          {mine && !mine.length ? <Empty title="You haven’t joined a contest yet" body="Join one from Discover — most are free to enter." action="Discover contests" onAction={() => setTab('Discover')} /> : null}
          {(mine || []).map((c, i) => <ContestCard key={c.id} c={c} index={i} onPress={() => nav.push('Contest', { id: c.id })} />)}
          {certs.length ? <Section title="Your certificates">
            {certs.map((x) => (
              <PressScale key={x.code} onPress={() => nav.push('Certificate', { code: x.code })} scaleTo={0.98} style={styles.certRow} accessibilityRole="button" accessibilityLabel={`Certificate: ${x.achievement}, ${x.contestTitle}`}>
                <View style={styles.certIcon}><Icon name="star" size={18} color={colors.gold} /></View>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.boardName}>{x.achievement}</Text><Text style={styles.boardMeta} numberOfLines={1}>{x.contestTitle}</Text></View>
                <Icon name="chevron-right" size={14} color={colors.faint} />
              </PressScale>
            ))}
          </Section> : null}
        </View>
      ) : null}

      {tab === 'Leaderboards' ? (
        <View>
          <Pills small items={['This week', 'This month', 'All time']} value={{ week: 'This week', month: 'This month', all: 'All time' }[period]} onChange={(l) => setPeriod({ 'This week': 'week', 'This month': 'month', 'All time': 'all' }[l])} style={{ marginTop: 12 }} />
          <Pills small items={['People', 'Churches']} value={by === 'church' ? 'Churches' : 'People'} onChange={(l) => setBy(l === 'Churches' ? 'church' : 'people')} style={{ marginTop: 8 }} />
          {state.user && state.user.country ? (
            <Pressable onPress={() => setMyCountry(!myCountry)} style={styles.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: myCountry }}>
              <View style={[styles.box, myCountry && styles.boxOn]}>{myCountry ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}</View>
              <Text style={styles.toggleText}>Only {state.user.country}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.muted}>Points: 10 per correct quiz answer, 20 for every creative entry, +100 / +60 / +40 for 1st / 2nd / 3rd, 15 per battle won.</Text>
          <Leaderboard rows={board} kind={by === 'church' ? 'church' : 'global'} />
        </View>
      ) : null}

      {tab === 'Hall of Fame' ? (
        <View>
          {!hof ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
          {hof && !hof.length ? <Empty title="No winners yet" body="Winners of finished contests appear here." /> : null}
          {(hof || []).map((h, i) => (
            <FadeInUp key={h.id} index={i} distance={8}>
              <PressScale onPress={() => nav.push('Contest', { id: h.id })} scaleTo={0.98} style={styles.hofCard} accessibilityRole="button" accessibilityLabel={h.title}>
                <Text style={styles.cardCat}>{h.categoryLabel} · {new Date(h.completedAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}</Text>
                <Text style={styles.cardTitle}>{h.title}</Text>
                <View style={styles.podium}>
                  {h.winners.slice(0, 3).map((w) => (
                    <View key={`${w.place}-${w.user.id}`} style={styles.podiumItem}>
                      <Text style={[styles.podiumPlace, w.place === 1 && { color: colors.gold }]}>{['🥇', '🥈', '🥉'][w.place - 1] || w.place}</Text>
                      <SocialAvatar name={w.user.displayName} uri={w.user.avatarUrl} size={40} />
                      <Text style={styles.podiumName} numberOfLines={1}>{w.user.displayName}</Text>
                      {w.title ? <Text style={styles.boardMeta} numberOfLines={1}>{w.title}</Text> : null}
                    </View>
                  ))}
                </View>
              </PressScale>
            </FadeInUp>
          ))}
        </View>
      ) : null}

      {tab === 'Battles' ? <BattlesPanel /> : null}
    </Screen>
  );
}

// ---------- the quiz runner ----------
function Quiz({ contest, session, onFinished }) {
  const api = useApi();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [left, setLeft] = useState(session.remainingSeconds);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const deadline = useRef(Date.now() + session.remainingSeconds * 1000);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const sent = useRef(false);
  const total = session.questions.length;

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    setSending(true); setSendError(null);
    try {
      const r = await api.request('POST', `/contests/${contest.id}/submit`, { answers: answersRef.current });
      AsyncStorage.removeItem(answersKey(contest.id)).catch(() => {});
      onFinished(r);
    } catch (e) { sent.current = false; setSendError(errorMessage(e, 'Couldn’t send your answers')); }
    setSending(false);
  }, [api, contest.id, onFinished]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(answersKey(contest.id)).then((raw) => {
      if (!alive || !raw) return;
      const saved = JSON.parse(raw);
      setAnswers(saved);
      const next = session.questions.findIndex((x) => saved[x.id] === undefined);
      setIndex(next === -1 ? total - 1 : next);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const tick = () => { const s = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)); setLeft(s); if (s <= 0) submit(); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [submit]);

  const q = session.questions[index];
  const choose = (i) => {
    const next = { ...answers, [q.id]: i };
    setAnswers(next);
    AsyncStorage.setItem(answersKey(contest.id), JSON.stringify(next)).catch(() => {});
    if (index < total - 1) setTimeout(() => setIndex((n) => Math.min(n + 1, total - 1)), 180);
  };
  const answered = Object.keys(answers).length;
  const low = left <= 10;
  if (sending || sendError) {
    return (
      <Screen title={contest.title}>
        {sending ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Sending your answers…</Text></View> : null}
        {sendError ? <View><Notice tint={colors.negative} text={sendError} /><Button label="Try again" onPress={submit} style={{ marginTop: 14 }} /></View> : null}
      </Screen>
    );
  }
  return (
    <Screen back title={contest.title} subtitle={`Question ${index + 1} of ${total}`}>
      <View style={styles.quizTop}>
        <View style={[styles.timer, low && styles.timerLow]} accessibilityLabel={`${left} seconds left`}>
          <Icon name="clock" size={15} color={low ? colors.negative : colors.primary} />
          <Text style={[styles.timerText, low && { color: colors.negative }]}>{clock(left)}</Text>
        </View>
        <Text style={styles.muted}>{answered} of {total} answered</Text>
      </View>
      <AnimatedBar progress={answered / total} delay={0} style={styles.bar} fillStyle={styles.barFill} />
      <FadeInUp key={q.id} distance={8} duration={240}>
        <Text style={styles.question}>{q.question}</Text>
        <View style={{ gap: 10 }}>
          {q.options.map((o, i) => {
            const on = answers[q.id] === i;
            return (
              <PressScale key={`${q.id}-${i}`} onPress={() => choose(i)} scaleTo={0.98} style={[styles.option, on && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o}>
                <Text style={[styles.optionText, on && { color: colors.primary, fontWeight: '700' }]}>{o}</Text>
                {on ? <Icon name="check" size={16} color={colors.primary} strokeWidth={2.6} /> : null}
              </PressScale>
            );
          })}
        </View>
      </FadeInUp>
      <View style={styles.quizNav}>
        <Button kind="ghost" label="Back" disabled={index === 0} onPress={() => setIndex(index - 1)} />
        {index < total - 1
          ? <Button kind="ghost" label="Skip" style={{ flex: 1 }} onPress={() => setIndex(index + 1)} />
          : <Button label={answered < total ? `Finish (${total - answered} unanswered)` : 'Finish'} style={{ flex: 1 }} onPress={submit} />}
      </View>
      <Text style={styles.fine}>The clock keeps running if you leave. You can come back to this attempt until time runs out.</Text>
    </Screen>
  );
}

// ---------- entries gallery ----------
function EntryTile({ s, canVote, voted, onVote, onOpen }) {
  return (
    <PressScale onPress={onOpen} scaleTo={0.98} style={styles.entry} accessibilityRole="button" accessibilityLabel={`${s.title} by ${s.user ? s.user.displayName : ''}`}>
      {s.kind === 'image' && s.mediaUrl ? <Image source={{ uri: s.mediaUrl }} style={styles.entryImg} />
        : s.kind === 'video' ? <View style={[styles.entryImg, styles.entryKind]}>{s.thumbnailUrl ? <Image source={{ uri: s.thumbnailUrl }} style={StyleSheet.absoluteFill} /> : null}<Icon name="play" size={26} color="#FFFFFF" /></View>
          : s.kind === 'audio' ? <View style={[styles.entryImg, styles.entryKind]}><Icon name="headphones" size={26} color="#FFFFFF" /></View>
            : <View style={[styles.entryImg, styles.entryText]}><Text style={styles.entryTextBody} numberOfLines={6}>{s.body}</Text></View>}
      <View style={{ padding: 10 }}>
        <Text style={styles.boardName} numberOfLines={1}>{s.place ? `${['🥇', '🥈', '🥉'][s.place - 1] || `#${s.place}`} ` : ''}{s.title}</Text>
        <Text style={styles.boardMeta} numberOfLines={1}>{s.user ? s.user.displayName : ''}{s.votes !== undefined ? ` · ${s.votes} votes` : ''}{s.disqualified ? ' · disqualified' : ''}</Text>
        {canVote ? (
          <PressScale onPress={onVote} scaleTo={0.95} style={[styles.voteBtn, voted && styles.voteBtnOn]} accessibilityRole="button" accessibilityLabel={voted ? 'Your vote' : `Vote for ${s.title}`}>
            <Icon name="heart" size={13} color={voted ? '#FFFFFF' : colors.primary} fill={voted ? 'solid' : 'none'} />
            <Text style={[styles.voteText, voted && { color: '#FFFFFF' }]}>{voted ? 'Your vote' : 'Vote'}</Text>
          </PressScale>
        ) : null}
      </View>
    </PressScale>
  );
}

// ---------- one contest ----------
export function ContestScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const sync = useSync();
  const toast = useToast();
  const { state } = useStore();
  const [c, setC] = useState(null);
  const [board, setBoard] = useState(null);
  const [churchBoard, setChurchBoard] = useState(null);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [pulling, setPulling] = useState(false);
  const [churchPick, setChurchPick] = useState(false);
  const [report, setReport] = useState(false);
  const [reportText, setReportText] = useState('');
  const focused = useIsFocused();

  const load = useCallback(async () => {
    try {
      const detail = await api.request('GET', `/contests/${params.id}`);
      setC(detail);
      const [lb, sub, ch] = await Promise.all([
        api.request('GET', `/contests/${params.id}/leaderboard`),
        detail.format === 'submission' ? api.request('GET', `/contests/${params.id}/submissions`) : Promise.resolve(null),
        detail.teamMode === 'church' ? api.request('GET', `/contests/${params.id}/leaderboard?by=church`) : Promise.resolve(null),
      ]);
      setBoard(lb.items || []); setEntries(sub); setChurchBoard(ch ? ch.items : null);
      setError(null);
      if (((detail.myEntry && detail.myEntry.prizeCoins) || detail.myCertificate) && sync.refresh) sync.refresh({ quiet: true });
    } catch (e) { setError(errorMessage(e, 'Couldn’t load this contest')); }
  }, [api, params.id]);
  useEffect(() => { if (focused) load(); }, [load, focused]);
  const refresh = async () => { setPulling(true); await load(); setPulling(false); };

  const register = async (communityId) => {
    setBusy(true);
    try {
      await api.request('POST', `/contests/${c.id}/register`, communityId ? { communityId } : {});
      toast.show('You’re registered — good luck!', { icon: 'check', haptic: 'success' });
      setChurchPick(false);
      load();
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t register'), { tone: 'error', icon: 'x' }); }
    setBusy(false);
  };
  const start = async () => {
    setBusy(true);
    try { setSession(await api.request('POST', `/contests/${c.id}/start`)); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t start'), { tone: 'error', icon: 'x' }); load(); }
    setBusy(false);
  };
  const onFinished = useCallback((r) => {
    setSession(null);
    toast.show(r.timedOut ? 'Time ran out before your answers arrived' : `You scored ${r.correct}/${r.total}`, { icon: r.timedOut ? 'clock' : 'star', haptic: 'success' });
    load();
  }, [load]);
  const vote = async (s) => {
    try {
      const r = await api.request('POST', `/contests/${c.id}/vote`, { submissionId: s.id });
      toast.show(`Vote counted for “${s.title}”`, { icon: 'heart', haptic: 'success' });
      setC((x) => ({ ...x, myVoteSubmissionId: r.submissionId }));
      load();
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t vote'), { tone: 'error', icon: 'x' }); }
  };
  const sendReport = async () => {
    try {
      await api.request('POST', `/contests/${c.id}/disputes`, { reason: reportText.trim() });
      toast.show('Thanks — the team will review it', { icon: 'check' });
      setReport(false); setReportText('');
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t send'), { tone: 'error', icon: 'x' }); }
  };

  if (session) return <Quiz contest={c} session={session} onFinished={onFinished} />;
  if (!c) return <Screen back title="Contest">{error ? <Notice tint={colors.negative} text={error} /> : <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>}</Screen>;

  const s = STATUS[c.status] || STATUS.completed;
  const mine = c.myEntry;
  const isQuiz = c.format === 'quiz';
  const registered = !!c.myRegistration;
  const paid = c.entryFeeMinor > 0;
  const myChurches = (state.communities || []).filter((x) => x.myStatus === 'member' && /^[0-9a-f-]{36}$/i.test(x.id));
  const quizCanPlay = isQuiz && ((c.status === 'live' && !mine) || (mine && !mine.finished && c.status !== 'completed'));
  const canRegister = !registered && c.registrationOpen && !(isQuiz && mine);
  const canSubmit = !isQuiz && c.status === 'live' && (!c.mySubmissionId || c.allowEdits);
  const myRow = (board || []).find((r) => r.isMe);
  const myPlace = mine && (mine.place || (myRow && myRow.place));
  const timeline = [
    c.registrationOpensAt ? ['Registration opens', c.registrationOpensAt] : null,
    c.registrationClosesAt ? ['Registration closes', c.registrationClosesAt] : null,
    ['Starts', c.startsAt],
    [isQuiz ? 'Ends' : 'Entries close', c.endsAt],
    c.votingEnabled && c.votingEndsAt ? ['Voting closes', c.votingEndsAt] : null,
    c.resultsAt ? ['Winners announced', c.resultsAt] : null,
  ].filter(Boolean);
  const scoringText = isQuiz ? 'Skill contest: most correct answers wins; ties go to the fastest. Votes play no part.'
    : c.scoring === 'judged' ? `Judged: ${c.judgeWeight}% from the judges${c.votingEnabled ? `, ${100 - c.judgeWeight}% from community votes` : ''}. Every vote is free (one per person).`
      : 'Popularity: the entries with the most community votes win. Every vote is free, one per person.';

  return (
    <Screen back title={c.title} subtitle={c.contestCategoryLabel} refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={colors.primary} />}>
      <View style={styles.detailHero}>
        <Image source={{ uri: artFor(c) }} style={StyleSheet.absoluteFill} />
        <View style={styles.detailScrim} />
        <View style={[styles.statusPill, { backgroundColor: alpha(s.tint, 0.92), alignSelf: 'flex-start' }]}><Text style={styles.statusPillText}>{s.label}</Text></View>
        <Text style={styles.detailTitle}>{c.title}</Text>
        <Text style={styles.detailTiming}>{timing(c)} · {c.participants || 0} joined · {feeLabel(c)}</Text>
      </View>
      {c.description ? <Text style={styles.body}>{c.description}</Text> : null}
      {c.status === 'pending_approval' ? <Notice tint={colors.amber} text="Waiting for an admin to approve this contest. Players can’t see it yet." /> : null}
      {c.status === 'rejected' ? <Notice tint={colors.negative} text={`Not approved: ${c.rejectReason || ''}`} /> : null}

      {/* actions */}
      <View style={styles.actions}>
        {paid && !registered ? <Notice text={`${feeLabel(c)}. Paid entry opens soon — you can’t register for this one yet.`} /> : null}
        {canRegister && !paid && (!isQuiz || c.teamMode === 'church') ? (
          c.teamMode === 'church'
            ? <Button label="Register with my church" disabled={busy} icon={<Icon name="church" size={14} color="#FFFFFF" />} onPress={() => setChurchPick(true)} />
            : <Button label={busy ? 'Registering…' : 'Join contest'} disabled={busy} icon={<Icon name="check" size={14} color="#FFFFFF" />} onPress={() => register()} />
        ) : null}
        {registered && !isQuiz && c.status !== 'completed' ? <Text style={styles.okLine}>✓ You’re registered{c.myRegistration.disqualified ? ' (disqualified)' : ''}</Text> : null}
        {quizCanPlay && !paid ? (
          <View style={styles.startBox}>
            <Text style={styles.startLine}>{c.questionCount} questions · {clock(c.limitSeconds)} on the clock · one attempt</Text>
            <Button label={busy ? 'Starting…' : mine ? `Continue · ${clock(mine.remainingSeconds)} left` : 'Start quiz'} disabled={busy || (c.teamMode === 'church' && !registered)} icon={<Icon name="play" size={14} color="#FFFFFF" />} onPress={start} style={{ marginTop: 10 }} />
            {c.teamMode === 'church' && !registered ? <Text style={styles.fine}>Register with your church first.</Text> : null}
          </View>
        ) : null}
        {canSubmit ? <Button label={c.mySubmissionId ? 'Edit my entry' : 'Submit my entry'} icon={<Icon name="plus" size={14} color="#FFFFFF" />} onPress={() => nav.push('ContestSubmit', { id: c.id })} /> : null}
        {c.mySubmissionId ? <Button kind="ghost" label="View my entry" onPress={() => nav.push('ContestEntry', { id: c.mySubmissionId })} /> : null}
        {c.isJudge ? <Button kind="ghost" label="Judge the entries" icon={<Icon name="star" size={14} color={colors.primary} />} onPress={() => nav.push('ContestJudge', { id: c.id })} /> : null}
        {c.canManage ? <Button kind="ghost" label="Manage contest" icon={<Icon name="settings" size={14} color={colors.primary} />} onPress={() => nav.push('ContestManage', { id: c.id })} /> : null}
        {c.myCertificate ? <Button kind="ghost" label="My certificate" icon={<Icon name="star" size={14} color={colors.gold} />} onPress={() => nav.push('Certificate', { code: c.myCertificate })} /> : null}
      </View>

      {mine && mine.finished ? (
        <ScaleIn from={0.94}>
          <View style={styles.score}>
            <Text style={styles.scoreBig}>{mine.correct}/{mine.total}</Text>
            <Text style={styles.scoreSub}>{mine.timedOut ? 'Time ran out before your answers arrived.' : myPlace ? `${ordinal(myPlace)} place · ${seconds(mine.durationMs)}` : `Finished in ${seconds(mine.durationMs)}`}</Text>
            {mine.prizeCoins ? <Text style={styles.scoreWin}>You won {mine.prizeCoins.toLocaleString()} coins!</Text> : null}
            {c.status !== 'completed' ? <Text style={styles.scoreSub}>Places can change until the contest closes.</Text> : null}
          </View>
        </ScaleIn>
      ) : null}

      {/* prizes */}
      {(c.prizeCoins && c.prizeCoins.length) || c.prizeText || (c.prizePlaces && c.prizePlaces.length) ? (
        <Section title="Prizes">
          <View style={styles.panel}>
            {Array.from({ length: Math.max((c.prizeCoins || []).length, (c.prizePlaces || []).length) }).map((_, i) => (
              <View key={i} style={styles.prizeLine}>
                <Text style={styles.prizePlace}>{ordinal(i + 1)} place</Text>
                <Text style={styles.prizeValue}>{[c.prizeCoins[i] ? `${c.prizeCoins[i].toLocaleString()} coins` : null, (c.prizePlaces[i] || {}).description].filter(Boolean).join(' + ')}</Text>
              </View>
            ))}
            {c.prizeText ? <Text style={styles.body}>{c.prizeText}</Text> : null}
            <Text style={styles.fine}>Winners get a certificate{c.certificatesFor === 'all' ? '; every participant gets one too' : ''}.</Text>
          </View>
        </Section>
      ) : null}

      {c.sponsors && c.sponsors.filter((x) => x.approved).length ? (
        <Section title="Sponsored by">
          {c.sponsors.filter((x) => x.approved).map((sp) => (
            <Pressable key={sp.id} onPress={() => sp.linkUrl && Linking.openURL(sp.linkUrl)} style={styles.sponsor} accessibilityRole={sp.linkUrl ? 'link' : undefined}>
              <Icon name="heart" size={15} color={colors.rose} />
              <Text style={styles.boardName}>{sp.name}</Text>
              {sp.contribution ? <Text style={styles.boardMeta} numberOfLines={1}> · {sp.contribution}</Text> : null}
            </Pressable>
          ))}
          <Text style={styles.fine}>Sponsors support this contest. They don’t affect judging or results.</Text>
        </Section>
      ) : null}

      {/* entries */}
      {!isQuiz && entries ? (
        <Section title={c.status === 'voting_open' ? 'Vote for your favourite' : 'Entries'}>
          {c.status === 'voting_open' ? <Text style={styles.muted}>{c.myVoteSubmissionId ? 'Thanks for voting! You have one free vote per contest.' : 'You have one free vote in this contest.'}</Text> : null}
          {!entries.galleryOpen ? <Text style={styles.muted}>{c.submissions || 0} entries so far. Everyone’s entries appear when submissions close.</Text> : null}
          <View style={styles.entryGrid}>
            {entries.items.map((x) => (
              <EntryTile key={x.id} s={x} canVote={c.status === 'voting_open' && !x.mine && !c.myVoteSubmissionId} voted={c.myVoteSubmissionId === x.id}
                onVote={() => vote(x)} onOpen={() => nav.push('ContestEntry', { id: x.id })} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Leaderboard">
        <Leaderboard rows={board} kind={isQuiz ? 'quiz' : 'entries'} />
      </Section>
      {churchBoard ? <Section title="Church standings"><Leaderboard rows={churchBoard} kind="church" /></Section> : null}

      {c.status === 'completed' && isQuiz && mine && mine.finished ? (
        review ? (
          <Section title="Your answers">
            {review.map((r) => (
              <View key={r.id} style={styles.reviewCard}>
                <Text style={styles.reviewQ}>{r.question}</Text>
                <Text style={[styles.reviewA, { color: colors.positive }]}>✓ {r.options[r.correctIndex]}</Text>
                {r.myAnswer !== r.correctIndex ? <Text style={[styles.reviewA, { color: colors.negative }]}>{r.myAnswer === null ? 'Not answered' : `Your answer: ${r.options[r.myAnswer]}`}</Text> : null}
                {r.reference ? <Text style={styles.reviewRef}>{r.reference}</Text> : null}
              </View>
            ))}
          </Section>
        ) : <Button kind="ghost" label="See the right answers" onPress={async () => { try { setReview((await api.request('GET', `/contests/${c.id}/review`)).items); } catch (e) { toast.show(errorMessage(e, 'Couldn’t load'), { tone: 'error' }); } }} style={{ marginTop: 16 }} />
      ) : null}

      <Section title="Dates">
        <View style={styles.panel}>{timeline.map(([k, v]) => <View key={k} style={styles.prizeLine}><Text style={styles.muted}>{k}</Text><Text style={styles.boardName}>{day(v)}</Text></View>)}</View>
      </Section>
      <Section title="How it’s scored"><Text style={styles.body}>{scoringText}</Text></Section>
      {c.judgingCriteria ? <Section title="Judging criteria"><Text style={styles.body}>{c.judgingCriteria}</Text></Section> : null}
      {c.submissionRequirements || (!isQuiz && c.entryKinds.length) ? <Section title="What to submit"><Text style={styles.body}>{c.submissionRequirements || ''}{c.submissionRequirements ? '\n' : ''}Accepted: {c.entryKinds.join(', ')}{c.allowEdits ? ' · you can edit until the deadline' : ''}.</Text></Section> : null}
      {c.eligibility || c.eligibleCountries.length || c.participantLimit ? (
        <Section title="Eligibility"><Text style={styles.body}>{[c.eligibility, c.eligibleCountries.length ? `Open in: ${c.eligibleCountries.join(', ')}.` : '', c.participantLimit ? `Limited to ${c.participantLimit} participants.` : ''].filter(Boolean).join('\n')}</Text></Section>
      ) : null}
      <Section title="Rules">
        <Text style={styles.rules}>
          {c.rules ? `${c.rules}\n\n` : ''}{paid ? 'Paid entry is not yet available.' : 'Free to enter, no purchase necessary.'} Votes are free (one per person) and can’t be bought. One entry or attempt per person. Accounts that cheat can be disqualified, and you can report a problem below. Coin prizes go to your wallet when results are published. This contest is run by {c.organizer ? c.organizer.displayName : 'BibleNestra'}. Google and Apple are not sponsors and are not involved.
        </Text>
      </Section>
      <Pressable onPress={() => setReport(true)} style={styles.reportLink} accessibilityRole="button"><Text style={styles.reportText}>Report a problem with this contest</Text></Pressable>

      <AnimatedModal visible={churchPick} onRequestClose={() => setChurchPick(false)}>
        <View style={styles.modalBack}>
          <Pressable style={{ flex: 1 }} onPress={() => setChurchPick(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Which church are you competing for?</Text>
            {myChurches.length ? myChurches.map((ch) => (
              <PressScale key={ch.id} onPress={() => register(ch.id)} scaleTo={0.98} style={styles.certRow} accessibilityRole="button" accessibilityLabel={ch.name}>
                <View style={styles.churchDot}><Icon name="church" size={16} color={colors.primary} /></View>
                <Text style={[styles.boardName, { flex: 1 }]}>{ch.name}</Text>
              </PressScale>
            )) : <Text style={styles.muted}>Join your church’s community first (Chats › Communities), then come back.</Text>}
            <Button kind="ghost" label="Find my church" onPress={() => { setChurchPick(false); nav.push('Communities'); }} style={{ marginTop: 12 }} />
          </View>
        </View>
      </AnimatedModal>
      <AnimatedModal visible={report} onRequestClose={() => setReport(false)}>
        <View style={styles.modalBack}>
          <Pressable style={{ flex: 1 }} onPress={() => setReport(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Report a problem</Text>
            <Text style={styles.muted}>Tell the team what’s wrong (unfair entry, scoring issue, appeal a decision).</Text>
            <TextInput value={reportText} onChangeText={setReportText} multiline maxLength={1000} placeholder="What happened?" placeholderTextColor={colors.faint} style={styles.input} />
            <Button label="Send report" disabled={reportText.trim().length < 5} onPress={sendReport} style={{ marginTop: 10 }} />
          </View>
        </View>
      </AnimatedModal>
    </Screen>
  );
}

// ---------- one entry (contestant profile) ----------
function AudioPlayer({ uri }) {
  const [sound, setSound] = useState(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => { if (sound) sound.unloadAsync().catch(() => {}); }, [sound]);
  const toggle = async () => {
    try {
      if (!sound) {
        const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        s.setOnPlaybackStatusUpdate((st) => { if (st.didJustFinish) setPlaying(false); });
        setSound(s); setPlaying(true); return;
      }
      if (playing) { await sound.pauseAsync(); setPlaying(false); } else { await sound.playAsync(); setPlaying(true); }
    } catch (e) { /* ignore */ }
  };
  return (
    <PressScale onPress={toggle} scaleTo={0.96} style={styles.audioBtn} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
      <Icon name={playing ? 'pause' : 'play'} size={22} color="#FFFFFF" />
      <Text style={styles.audioText}>{playing ? 'Playing…' : 'Play entry'}</Text>
    </PressScale>
  );
}

export function ContestEntryScreen({ params = {} }) {
  const api = useApi();
  const toast = useToast();
  const nav = useNav();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setS(await api.request('GET', `/submissions/${params.id}`)); } catch (e) { setError(errorMessage(e, 'Couldn’t load this entry')); }
  }, [api, params.id]);
  useEffect(() => { load(); }, [load]);
  if (!s) return <Screen back title="Entry">{error ? <Notice tint={colors.negative} text={error} /> : <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>}</Screen>;
  const canVote = s.contest.status === 'voting_open' && !s.contest.myVoteSubmissionId && (!s.mine || s.contest.allowSelfVote);
  const vote = async () => {
    try { await api.request('POST', `/contests/${s.contest.id}/vote`, { submissionId: s.id }); toast.show('Vote counted', { icon: 'heart', haptic: 'success' }); load(); }
    catch (e) { toast.show(errorMessage(e, 'Couldn’t vote'), { tone: 'error', icon: 'x' }); }
  };
  const share = () => Share.share({ message: `Vote for “${s.title}” by ${s.user ? s.user.displayName : 'a believer'} in ${s.contest.title} on BibleNestra!` }).catch(() => {});
  return (
    <Screen back title={s.title} subtitle={s.contest.title}>
      <Pressable onPress={() => s.user && nav.push('UserProfile', { id: s.user.id, name: s.user.displayName })} style={styles.entryHead} accessibilityRole="button">
        <SocialAvatar name={s.user ? s.user.displayName : '?'} uri={s.user && s.user.avatarUrl} size={46} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.boardName}>{s.user ? s.user.displayName : ''}</Text>
          <Text style={styles.boardMeta}>{[s.country, s.place ? `${ordinal(s.place)} place` : s.rank ? `Currently #${s.rank}` : null, s.votes !== undefined ? `${s.votes} votes` : null].filter(Boolean).join(' · ')}</Text>
        </View>
      </Pressable>
      {s.kind === 'image' && s.mediaUrl ? <Image source={{ uri: s.mediaUrl }} style={styles.entryFull} resizeMode="contain" /> : null}
      {s.kind === 'video' && s.mediaUrl ? <Video source={{ uri: s.mediaUrl }} style={styles.entryFull} useNativeControls resizeMode={ResizeMode.CONTAIN} posterSource={s.thumbnailUrl ? { uri: s.thumbnailUrl } : undefined} /> : null}
      {s.kind === 'audio' && s.mediaUrl ? <AudioPlayer uri={s.mediaUrl} /> : null}
      {s.kind === 'text' ? <View style={styles.panel}><Text style={styles.textEntry}>{s.body}</Text></View> : null}
      {s.description ? <Text style={styles.body}>{s.description}</Text> : null}
      {s.disqualified ? <Notice tint={colors.negative} text="This entry was disqualified." /> : null}
      <View style={styles.actions}>
        {canVote ? <Button label="Vote for this entry" icon={<Icon name="heart" size={14} color="#FFFFFF" />} onPress={vote} /> : null}
        {s.contest.myVoteSubmissionId === s.id ? <Text style={styles.okLine}>✓ You voted for this entry</Text> : null}
        <Button kind="ghost" label="Share" icon={<Icon name="share" size={14} color={colors.primary} />} onPress={share} />
        {s.mine && s.contest.status === 'live' ? <Button kind="ghost" label="Edit my entry" onPress={() => nav.push('ContestSubmit', { id: s.contest.id })} /> : null}
      </View>
    </Screen>
  );
}

// ---------- submit / edit an entry ----------
const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Audio', text: 'Written' };
export function ContestSubmitScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [kind, setKind] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null); // { kind, preview, mediaKey?, videoUid? , name }
  const [progress, setProgress] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.request('GET', `/contests/${params.id}`);
        setC(d); setKind(d.entryKinds[0]);
        if (d.mySubmissionId) {
          const s = await api.request('GET', `/submissions/${d.mySubmissionId}`);
          setKind(s.kind); setTitle(s.title); setDescription(s.description || ''); setText(s.body || '');
        }
      } catch (e) { toast.show(errorMessage(e, 'Couldn’t load'), { tone: 'error' }); }
    })();
  }, [api, params.id]);

  const pick = async () => {
    try {
      if (kind === 'image') {
        const [photo] = await pickPhotos(1); if (!photo) return;
        setProgress(0.3); const r = await uploadImage(api.request, photo); setFile({ kind, preview: photo.uri, mediaKey: r.key, name: 'Photo' });
      } else if (kind === 'video') {
        const v = await pickVideo(); if (!v) return;
        setProgress(0.01); const r = await uploadVideo(api.request, v, (p) => setProgress(p)); setFile({ kind, videoUid: r.uid, name: v.name || 'Video' });
      } else if (kind === 'audio') {
        const a = await pickAudio(); if (!a) return;
        if (a.size && a.size > 25 * 1024 * 1024) { toast.show('Audio must be under 25 MB', { tone: 'error' }); return; }
        setProgress(0.3); const r = await uploadAudio(api.request, a); setFile({ kind, mediaKey: r.key, name: a.name });
      }
    } catch (e) { toast.show(errorMessage(e, 'Upload failed'), { tone: 'error', icon: 'x' }); }
    setProgress(null);
  };
  const save = async () => {
    setSaving(true);
    try {
      const payload = { kind, title: title.trim(), description, body: kind === 'text' ? text : '' };
      if (file && file.kind === kind) { if (file.mediaKey) payload.mediaKey = file.mediaKey; if (file.videoUid) payload.videoUid = file.videoUid; }
      const s = await api.request('PUT', `/contests/${params.id}/submission`, payload);
      toast.show('Entry saved — good luck!', { icon: 'check', haptic: 'success' });
      nav.replace('ContestEntry', { id: s.id });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t save your entry'), { tone: 'error', icon: 'x' }); }
    setSaving(false);
  };
  if (!c) return <Screen back title="Your entry"><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></Screen>;
  const ready = title.trim() && (kind === 'text' ? text.trim().length >= 20 : (file && file.kind === kind) || c.mySubmissionId);
  return (
    <Screen back title={c.mySubmissionId ? 'Edit your entry' : 'Submit your entry'} subtitle={c.title}>
      {c.submissionRequirements ? <Notice text={c.submissionRequirements} /> : null}
      {c.entryKinds.length > 1 ? <Pills items={c.entryKinds.map((k) => KIND_LABEL[k])} value={KIND_LABEL[kind]} onChange={(l) => setKind(Object.keys(KIND_LABEL).find((k) => KIND_LABEL[k] === l))} style={{ marginTop: 12 }} /> : null}
      <View style={styles.panel}>
        <Text style={styles.label}>Title</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="Give your entry a title" placeholderTextColor={colors.faint} style={styles.input} />
        <Text style={styles.label}>Description (optional)</Text>
        <TextInput value={description} onChangeText={setDescription} maxLength={2000} multiline placeholder="Tell people about it" placeholderTextColor={colors.faint} style={[styles.input, { minHeight: 70 }]} />
        {kind === 'text' ? (
          <View>
            <Text style={styles.label}>Your writing</Text>
            <TextInput value={text} onChangeText={setText} maxLength={20000} multiline placeholder="Write here…" placeholderTextColor={colors.faint} style={[styles.input, { minHeight: 200, textAlignVertical: 'top' }]} />
            <Text style={styles.fine}>{text.trim().split(/\s+/).filter(Boolean).length} words</Text>
          </View>
        ) : (
          <View>
            <Button kind="ghost" label={file && file.kind === kind ? `Change ${KIND_LABEL[kind].toLowerCase()}` : `Choose ${KIND_LABEL[kind].toLowerCase()}`} icon={<Icon name={kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'headphones'} size={14} color={colors.primary} />} onPress={pick} disabled={progress !== null} style={{ marginTop: 10 }} />
            {progress !== null ? <View style={{ marginTop: 10 }}><AnimatedBar progress={progress} delay={0} style={styles.bar} fillStyle={styles.barFill} /><Text style={styles.fine}>Uploading…</Text></View> : null}
            {file && file.kind === kind ? (file.preview ? <Image source={{ uri: file.preview }} style={styles.preview} /> : <Text style={styles.okLine}>✓ {file.name} uploaded</Text>) : null}
            {!file && c.mySubmissionId ? <Text style={styles.fine}>Your current file stays unless you choose a new one.</Text> : null}
          </View>
        )}
      </View>
      <Button label={saving ? 'Saving…' : c.mySubmissionId ? 'Save changes' : 'Submit entry'} disabled={!ready || saving || progress !== null} onPress={save} style={{ marginTop: 16 }} />
      <Text style={styles.fine}>Only submit your own work. {c.allowEdits ? 'You can edit until the deadline.' : 'You can’t change it after submitting.'}</Text>
    </Screen>
  );
}

// ---------- certificate ----------
export function CertificateScreen({ params = {} }) {
  const api = useApi();
  const [cert, setCert] = useState(null);
  const [error, setError] = useState(null);
  const shot = useRef(null);
  const url = `${API_CONFIG.apiUrl || ''}/certificates/${params.code}`;
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${url}.json`);
        const d = await res.json();
        if (!res.ok) throw new Error('Certificate not found');
        setCert(d);
      } catch (e) { setError('Couldn’t load this certificate'); }
    })();
  }, [url]);
  const share = async () => {
    try {
      if (Platform.OS !== 'web') {
        // eslint-disable-next-line global-require
        const { captureRef } = require('react-native-view-shot');
        // eslint-disable-next-line global-require
        const Sharing = require('expo-sharing');
        const uri = await captureRef(shot, { format: 'png', quality: 1 });
        if (await Sharing.isAvailableAsync()) { await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your certificate' }); return; }
      }
      await Share.share({ message: `My BibleNestra certificate: ${cert.achievement}, ${cert.contest}. Verify it: ${url}` });
    } catch (e) { /* cancelled */ }
  };
  if (!cert) return <Screen back title="Certificate">{error ? <Notice tint={colors.negative} text={error} /> : <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>}</Screen>;
  return (
    <Screen back title="Certificate" subtitle={cert.contest}>
      <View ref={shot} collapsable={false} style={styles.cert}>
        <View style={styles.certInner}>
          <Text style={styles.certBrand}>✦ BIBLE NESTRA ✦</Text>
          <Text style={styles.certHeading}>Certificate of {cert.kind === 'participant' ? 'Participation' : 'Achievement'}</Text>
          <Text style={styles.certSmall}>This is presented to</Text>
          <Text style={styles.certName}>{cert.name}</Text>
          <Text style={styles.certSmall}>for</Text>
          <Text style={styles.certAch}>{cert.achievement}</Text>
          <Text style={styles.certContest}>{cert.contest}</Text>
          <View style={styles.certFoot}>
            <View><Text style={styles.certLabel}>Awarded</Text><Text style={styles.certVal}>{new Date(cert.issuedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</Text></View>
            <View style={{ alignItems: 'flex-end' }}><Text style={styles.certLabel}>Organizer</Text><Text style={styles.certVal}>{cert.organizer}</Text></View>
          </View>
          <Text style={styles.certCode}>Verification ID: {cert.code}</Text>
        </View>
      </View>
      {!cert.valid ? <Notice tint={colors.negative} text="This certificate has been revoked." /> : null}
      <Button label="Share certificate" icon={<Icon name="share" size={14} color="#FFFFFF" />} onPress={share} style={{ marginTop: 16 }} />
      <Button kind="ghost" label="Open verification page" onPress={() => Linking.openURL(url)} style={{ marginTop: 8 }} />
      <Text style={styles.fine}>Anyone can check this certificate at {url}</Text>
    </Screen>
  );
}

export const styles = StyleSheet.create({
  loading: { paddingVertical: 24, alignItems: 'center', gap: 8 },
  muted: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.muted },
  fine: { marginTop: 8, fontSize: 12, lineHeight: 17, color: colors.faint },
  body: { marginTop: 8, fontSize: 14.5, lineHeight: 21, color: colors.passage },
  rules: { fontSize: 13, lineHeight: 19, color: colors.muted },
  okLine: { marginTop: 6, fontSize: 14, fontWeight: '700', color: colors.positive },
  headBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.cardLavender },
  roleText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.fg },
  hero: { marginTop: 12, padding: 18, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.night, ...shadow.md },
  heroEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight },
  heroTitle: { marginTop: 6, fontFamily: fonts.serifBold, fontSize: 23, lineHeight: 28, color: colors.nightFg },
  heroSub: { marginTop: 6, fontSize: 13.5, lineHeight: 19, color: colors.nightMuted },
  card: { marginTop: 12, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  cardArt: { width: '100%', height: 120, backgroundColor: colors.raised },
  cardArtScrim: { position: 'absolute', left: 0, right: 0, top: 0, height: 120, backgroundColor: 'rgba(21,23,43,0.25)' },
  cardArtTop: { position: 'absolute', left: 10, right: 10, top: 10, flexDirection: 'row', justifyContent: 'space-between' },
  statusPill: { paddingHorizontal: 9, height: 24, borderRadius: radius.pill, justifyContent: 'center' },
  statusPillText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  feePill: { paddingHorizontal: 9, height: 24, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.92)' },
  feePillText: { fontSize: 11, fontWeight: '700', color: colors.fg },
  cardBody: { padding: 14 },
  cardCat: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.gold },
  cardTitle: { marginTop: 4, fontFamily: fonts.serifBold, fontSize: 19, lineHeight: 24, color: colors.fg },
  cardDesc: { marginTop: 4, fontSize: 13.5, lineHeight: 19, color: colors.muted },
  prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  prizeText: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: colors.goldMuted },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  cardMeta: { flexShrink: 1, fontSize: 12.5, color: colors.muted },
  joinBtn: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.primary, justifyContent: 'center' },
  joinBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  certIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { fontSize: 14, color: colors.fg },
  board: { marginTop: 10, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  boardRowMe: { backgroundColor: alpha(colors.primary, 0.07) },
  boardPlace: { width: 24, textAlign: 'center', fontFamily: fonts.serifBold, fontSize: 16, color: colors.muted },
  boardName: { fontSize: 14, fontWeight: '600', color: colors.fg },
  boardMeta: { marginTop: 1, fontSize: 12, color: colors.muted },
  churchDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  coin: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coinText: { fontSize: 13, fontWeight: '700', color: colors.goldMuted },
  hofCard: { marginTop: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  podium: { flexDirection: 'row', gap: 8, marginTop: 12 },
  podiumItem: { flex: 1, alignItems: 'center', gap: 4 },
  podiumPlace: { fontSize: 20 },
  podiumName: { fontSize: 12.5, fontWeight: '700', color: colors.fg, textAlign: 'center' },
  detailHero: { marginTop: 12, height: 190, borderRadius: 22, overflow: 'hidden', padding: 16, justifyContent: 'flex-end', backgroundColor: colors.night, ...shadow.md },
  detailScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,23,43,0.55)' },
  detailTitle: { marginTop: 10, fontFamily: fonts.serifBold, fontSize: 24, lineHeight: 29, color: '#FFFFFF' },
  detailTiming: { marginTop: 4, fontSize: 13, fontWeight: '700', color: colors.goldLight },
  actions: { marginTop: 14, gap: 8 },
  startBox: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  startLine: { fontSize: 14, fontWeight: '600', color: colors.primaryInk, textAlign: 'center' },
  panel: { padding: 14, gap: 8, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 6 },
  prizeLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  prizePlace: { fontSize: 14.5, fontWeight: '600', color: colors.fg },
  prizeValue: { flexShrink: 1, textAlign: 'right', fontSize: 13.5, fontWeight: '700', color: colors.goldMuted },
  sponsor: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  score: { marginTop: 14, padding: 18, borderRadius: radius.lg, alignItems: 'center', backgroundColor: colors.cardGold },
  scoreBig: { fontFamily: fonts.serifBold, fontSize: 40, lineHeight: 46, color: colors.fg },
  scoreSub: { marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center' },
  scoreWin: { marginTop: 6, fontSize: 15, fontWeight: '700', color: colors.goldMuted },
  entryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, marginTop: 10 },
  entry: { width: '48.5%', borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  entryImg: { width: '100%', aspectRatio: 1, backgroundColor: colors.raised },
  entryKind: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.night },
  entryText: { padding: 10, backgroundColor: colors.cardGold },
  entryTextBody: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 18, color: colors.passage },
  voteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, height: 32, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary },
  voteBtnOn: { backgroundColor: colors.primary },
  voteText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  entryFull: { width: '100%', height: 320, marginTop: 12, borderRadius: radius.lg, backgroundColor: '#000' },
  audioBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 64, marginTop: 14, borderRadius: radius.lg, backgroundColor: colors.night },
  audioText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  textEntry: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 25, color: colors.passage },
  label: { marginTop: 6, fontSize: 12.5, fontWeight: '700', color: colors.muted },
  input: { marginTop: 6, borderRadius: radius.md, backgroundColor: colors.raised, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.fg },
  preview: { width: '100%', height: 220, marginTop: 10, borderRadius: radius.md, backgroundColor: colors.raised },
  quizTop: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  timerLow: { backgroundColor: colors.negativeFaint },
  timerText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  bar: { marginTop: 12, height: 5, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3, backgroundColor: colors.primary },
  question: { marginTop: 18, marginBottom: 16, fontFamily: fonts.serifBold, fontSize: 21, lineHeight: 28, color: colors.fg },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.fg },
  quizNav: { flexDirection: 'row', gap: 10, marginTop: 20 },
  reviewCard: { marginTop: 8, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  reviewQ: { fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: colors.fg },
  reviewA: { marginTop: 5, fontSize: 13.5, lineHeight: 18 },
  reviewRef: { marginTop: 5, fontSize: 12, fontWeight: '700', color: colors.gold },
  reportLink: { alignSelf: 'center', marginTop: 14, padding: 10 },
  reportText: { fontSize: 13, fontWeight: '600', color: colors.muted, textDecorationLine: 'underline' },
  modalBack: { flex: 1, justifyContent: 'flex-end' },
  sheet: { padding: 18, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.screen, ...shadow.lg },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg, marginBottom: 8 },
  cert: { marginTop: 14, padding: 10, borderRadius: 18, backgroundColor: '#F8F1DF', borderWidth: 2, borderColor: colors.goldLight },
  certInner: { padding: 20, borderRadius: 12, borderWidth: 1, borderColor: alpha(colors.gold, 0.5), alignItems: 'center', backgroundColor: '#FFFDF7' },
  certBrand: { fontSize: 11, fontWeight: '700', letterSpacing: 2.5, color: colors.gold },
  certHeading: { marginTop: 10, fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, textAlign: 'center' },
  certSmall: { marginTop: 10, fontSize: 12, color: colors.muted },
  certName: { marginTop: 4, fontFamily: fonts.serifBoldItalic, fontSize: 28, color: colors.primaryInk, textAlign: 'center' },
  certAch: { marginTop: 4, fontFamily: fonts.serifBold, fontSize: 19, color: colors.goldMuted },
  certContest: { marginTop: 2, fontSize: 14, color: colors.fg, textAlign: 'center' },
  certFoot: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  certLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.faint },
  certVal: { fontSize: 13, color: colors.fg, marginTop: 2 },
  certCode: { marginTop: 14, fontSize: 11, color: colors.muted, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
});
