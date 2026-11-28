// WATCH & EARN (dev update v1): a full-screen page where people watch rewarded ads to earn Kingdom Coins.
// Opt-in: nothing plays until the person taps "Watch an ad". Rules and numbers come from the server
// (GET /earn/status, registerConfig 'watch_earn'); this screen only shows them. Route name: 'WatchEarn' (App.js).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useApi } from '../api/auth';
import { creditEarnAd, useEarnStatus } from '../api/watchEarn';
import { errorMessage } from '../api/client';
import { useAds } from '../ads/Ads';
import { useNav } from '../navigation';
import { Icon } from '../components/Icons';
import { AnimatedNumber, FadeInUp } from '../components/Motion';
import { Grad, Tap, d, df, gradients } from '../design/sanctuary';
import { isDarkScheme } from '../design/palette';
import { colors } from '../theme';

const DAY_MS = 86400000;
const ON_GRADIENT = colors.primaryFg; // text and icons on the warm hero gradient (white in both modes)
const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A translucent layer of the on-gradient colour, drawn behind content (no new colour value)
function Glass({ opacity = 0.18, style }) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: ON_GRADIENT, opacity }, style]} />;
}
const RING = 92;
const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;

// Coin that floats gently. Transform-only, so the native driver can run it.
function useFloat() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

function ProgressRing({ done, total }) {
  const p = total > 0 ? Math.min(1, done / total) : 0;
  const trackOpacity = isDarkScheme() ? 0.22 : 0.32;
  return (
    <View style={styles.ringWrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }} accessibilityLabel={`${done} of ${total} ads watched today`}>
      <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} style={styles.ringSvg}>
        <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={ON_GRADIENT} strokeOpacity={trackOpacity} strokeWidth={9} fill="none" />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={RING_R}
          stroke={ON_GRADIENT}
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${RING_C * p} ${RING_C}`}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringNum}>{`${done}/${total}`}</Text>
        <Text style={styles.ringLabel}>today</Text>
      </View>
    </View>
  );
}

// The streak sentence. daysToBonus counts today's ad when it is not watched yet (see lib/watchEarn.js earnStatus).
function streakCopy({ length, daysToBonus: toGo, watchedToday, bonusCoins: bonus, days }) {
  if (length === 0) return `Watch ${toGo} days in a row to earn a +${bonus} coin streak bonus. The bonus comes every ${days} days.`;
  if (toGo === 1) return `${watchedToday ? 'Watch again tomorrow' : 'Watch today'} to earn the +${bonus} coin streak bonus.`;
  return `${toGo} more days to earn the +${bonus} coin streak bonus.`;
}

function Row({ icon, title, sub, onPress }) {
  return (
    <Tap onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={title}>
      <View style={styles.rowIcon}><Icon name={icon} size={18} color={d.plumDark} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={d.muted} />
    </Tap>
  );
}

export default function WatchEarnScreen() {
  const nav = useNav();
  const api = useApi();
  const ads = useAds();
  const { data: s, error, loaded, reload, online } = useEarnStatus();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone: 'ok' | 'info', text }
  const float = useFloat();

  const coinFloat = { transform: [
    { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
    { scale: float.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) },
  ] };

  const perAd = s ? s.nextReward.coins : 0;
  const adsLeft = s ? s.adsLeftToday : 0;
  const canWatch = !!(s && s.canWatch && adsLeft > 0);

  const watch = async () => {
    if (busy || !canWatch) return;
    setBusy(true);
    setMsg(null);
    // snapshot before the ad: AdMob's callback can credit the ad before the ad closes
    const before = { day: s.day, adsToday: s.adsToday, coinsToday: s.coinsToday };
    try {
      const r = await ads.showRewarded({ purpose: 'earn', loadTimeoutMs: 30000 });
      if (!r || !r.rewarded) {
        // errors: load / timeout / show / busy / no_fill (house ads never reward). Anything else: the person closed early.
        setMsg({ tone: 'info', text: r && r.error ? 'No ad is available right now. Try again in a moment.' : 'The ad closed early. Watch it to the end to earn the coins.' });
        return;
      }
      const out = await creditEarnAd(api, before);
      if (out.credited) {
        const bonus = out.bonus ? ` Streak bonus +${out.bonus.coins}!` : '';
        setMsg({ tone: 'ok', text: `+${out.coinsEarned} Kingdom Coins added.${bonus}` });
      } else if (out.capped) {
        setMsg({ tone: 'info', text: 'You have used today’s ads. Come back tomorrow for more.' });
      } else {
        setMsg({ tone: 'info', text: 'That ad did not count this time. Try the next one.' });
      }
    } catch (e) {
      setMsg({ tone: 'info', text: errorMessage(e, 'Could not record that ad. Please try again.') });
    } finally {
      setBusy(false);
      reload();
    }
  };

  // streak strip: the last seven Lagos days, today last. A run ends today if today is watched, else yesterday.
  const streak = s ? s.streak : { length: 0, watchedToday: false, daysToBonus: 0, bonusCoins: 0, days: 7 };
  const chips = [];
  for (let i = 0; i < 7; i += 1) {
    const daysAgo = 6 - i;
    const filled = streak.watchedToday ? daysAgo < streak.length : daysAgo >= 1 && daysAgo <= streak.length;
    const dow = s ? new Date(Date.parse(`${s.day}T12:00:00Z`) - daysAgo * DAY_MS).getUTCDay() : i;
    chips.push({ key: i, filled, today: daysAgo === 0, letter: daysAgo === 0 ? 'Today' : WEEK[dow] });
  }

  const cta = s ? `Watch an ad · +${perAd} coins` : 'Watch an ad';

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Grad colors={gradients.hero} style={styles.hero}>
          <View style={styles.topRow}>
            <Tap onPress={() => nav.pop()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8}>
              <Glass opacity={0.2} style={{ borderRadius: 20 }} />
              <Icon name="chevron-left" size={20} color={ON_GRADIENT} />
            </Tap>
            <Text style={styles.eyebrow}>REWARDS</Text>
          </View>
          <Text style={styles.heroTitle}>Watch & Earn</Text>
          <Text style={styles.heroSub}>Watch a short ad and earn Kingdom Coins for every one you finish.</Text>

          <View style={styles.heroStats}>
            <View style={styles.coinWrap}>
              <Animated.View style={[styles.coinGlow, coinFloat]}>
                <Glass opacity={0.16} style={{ borderRadius: 48 }} />
                <Grad colors={gradients.gold} style={styles.coin}>
                  <Icon name="coin" size={54} color={ON_GRADIENT} strokeWidth={1.7} />
                </Grad>
              </Animated.View>
            </View>
            <View style={styles.balance}>
              <Text style={styles.balanceLabel}>Your balance</Text>
              <AnimatedNumber value={s ? s.coins : 0} style={styles.balanceNum} />
              <Text style={styles.balanceUnit}>Kingdom Coins</Text>
              {s && s.coinsToday > 0 ? <Text style={styles.balanceToday}>{`+${s.coinsToday} earned today`}</Text> : null}
            </View>
            <ProgressRing done={s ? s.adsToday : 0} total={s ? s.dailyAds : 0} />
          </View>
        </Grad>

        <View style={styles.body}>
          {!online ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Connect to earn</Text>
              <Text style={styles.cardBody}>Watch & Earn needs a connection to BibleNestra.</Text>
            </View>
          ) : !loaded && !s ? (
            <View style={[styles.card, styles.center]}><ActivityIndicator color={d.plum} /></View>
          ) : !s ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>We could not load this right now</Text>
              <Text style={styles.cardBody}>{error ? errorMessage(error, 'Please try again.') : 'Please try again.'}</Text>
              <Tap onPress={reload} style={styles.secondary} accessibilityRole="button" accessibilityLabel="Try again">
                <Text style={styles.secondaryText}>Try again</Text>
              </Tap>
            </View>
          ) : !s.enabled ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Watch & Earn is paused</Text>
              <Text style={styles.cardBody}>There are no ads to earn from right now. Check back soon.</Text>
            </View>
          ) : adsLeft <= 0 ? (
            <FadeInUp>
              <View style={[styles.card, styles.doneCard]} accessibilityLabel="Daily limit reached">
                <Icon name="check-circle" size={34} color={d.sageDark} />
                <Text style={styles.cardTitle}>{'You are done for today'}</Text>
                <Text style={styles.cardBody}>
                  {`You watched ${s.dailyAds} of ${s.dailyAds} today and earned ${s.coinsToday} coins. Come back tomorrow for more. The count resets at midnight, Lagos time.`}
                </Text>
              </View>
            </FadeInUp>
          ) : (
            <FadeInUp>
              <View style={styles.ctaCard}>
                <Tap onPress={watch} disabled={busy} style={[styles.ctaWrap, busy && styles.dim]} accessibilityRole="button" accessibilityLabel={`Watch an ad to earn ${perAd} coins`}>
                  <Grad colors={gradients.orange} style={styles.cta}>
                    {busy ? <ActivityIndicator color={ON_GRADIENT} /> : (
                      <>
                        <Icon name="play" size={22} color={ON_GRADIENT} />
                        <Text style={styles.ctaText}>{cta}</Text>
                      </>
                    )}
                  </Grad>
                </Tap>
                <Text style={styles.ctaMeta}>
                  {`${adsLeft} of ${s.dailyAds} ads left today. Watching is your choice: nothing plays unless you tap.`}
                </Text>
                {msg ? (
                  <Text style={[styles.msg, msg.tone === 'ok' ? styles.msgOk : styles.msgInfo]} accessibilityLiveRegion="polite">{msg.text}</Text>
                ) : null}
              </View>
            </FadeInUp>
          )}

          {s ? (
            <FadeInUp index={1}>
              <View style={styles.card}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionEyebrow}>DAILY STREAK</Text>
                  <Text style={styles.sectionTitle}>
                    {streak.length > 0 ? `${streak.length} day${streak.length === 1 ? '' : 's'} in a row` : 'Start your streak today'}
                  </Text>
                </View>
                <View style={styles.chips}>
                  {chips.map((c) => (
                    <View key={c.key} style={styles.chipCol}>
                      <View style={[styles.chip, c.filled && styles.chipOn, c.today && styles.chipToday]}>
                        {c.filled ? <Icon name="check" size={15} color={ON_GRADIENT} /> : <Text style={styles.chipDot}>{'·'}</Text>}
                      </View>
                      <Text style={[styles.chipLabel, c.today && styles.chipLabelToday]}>{c.letter}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.cardBody}>{streakCopy(streak)}</Text>
              </View>
            </FadeInUp>
          ) : null}

          <FadeInUp index={2}>
            <Text style={styles.groupTitle}>Ways to earn more</Text>
            <View style={styles.list}>
              <Row icon="quiz" title="Bible games" sub="A fresh set of daily questions" onPress={() => nav.push('Learn', { tab: 'Games' })} />
              <Row icon="star" title="Contests" sub="Enter a contest or a Bible battle" onPress={() => nav.push('Contests')} />
              <Row icon="users" title="Invite friends" sub="Bring someone along to BibleNestra" onPress={() => nav.push('InviteFriends')} />
            </View>
          </FadeInUp>

          <FadeInUp index={3}>
            <Text style={styles.groupTitle}>Spend your coins</Text>
            <View style={styles.list}>
              <Row icon="gift" title="Gifts" sub="Send a gift to someone you care about" onPress={() => nav.push('GiftStore')} />
              <Row icon="chat" title="Chat passes" sub="Unlock more chats for a week" onPress={() => nav.push('Chats')} />
              <Row icon="sparkles" title="Unlocks" sub="Scripture pop-ups and other features" onPress={() => nav.push('ScripturePop')} />
            </View>
          </FadeInUp>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: d.ivory },
  scroll: { paddingBottom: 48 },
  hero: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 56, borderBottomLeftRadius: 34, borderBottomRightRadius: 34 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  eyebrow: { color: ON_GRADIENT, opacity: 0.85, fontFamily: df.sansBold, fontSize: 11, letterSpacing: 1.8 },
  heroTitle: { color: ON_GRADIENT, fontFamily: df.displayBold, fontSize: 40, lineHeight: 46 },
  heroSub: { color: ON_GRADIENT, opacity: 0.9, fontFamily: df.sans, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 22 },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinWrap: { width: 96, alignItems: 'center', justifyContent: 'center' },
  coinGlow: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coin: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: ON_GRADIENT },
  balance: { flex: 1, minWidth: 0 },
  balanceLabel: { color: ON_GRADIENT, opacity: 0.85, fontFamily: df.sansMedium, fontSize: 12 },
  balanceNum: { color: ON_GRADIENT, fontFamily: df.displayBold, fontSize: 44, lineHeight: 50 },
  balanceUnit: { color: ON_GRADIENT, fontFamily: df.sansSemi, fontSize: 13 },
  balanceToday: { color: ON_GRADIENT, opacity: 0.9, fontFamily: df.sansMedium, fontSize: 12, marginTop: 4 },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringSvg: { position: 'absolute', top: 0, left: 0 },
  ringCenter: { alignItems: 'center' },
  ringNum: { color: ON_GRADIENT, fontFamily: df.sansHeavy, fontSize: 18 },
  ringLabel: { color: ON_GRADIENT, opacity: 0.85, fontFamily: df.sans, fontSize: 11 },
  body: { marginTop: -30, paddingHorizontal: 18, gap: 14 },
  card: { backgroundColor: d.paper, borderRadius: 22, borderWidth: 1, borderColor: d.line, padding: 18, gap: 8 },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 90 },
  doneCard: { backgroundColor: d.sage, borderColor: d.sageDark, alignItems: 'flex-start' },
  cardTitle: { color: d.ink, fontFamily: df.displayBold, fontSize: 20, lineHeight: 26 },
  cardBody: { color: d.muted, fontFamily: df.sans, fontSize: 14, lineHeight: 20 },
  secondary: { alignSelf: 'flex-start', marginTop: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: d.line },
  secondaryText: { color: d.ink, fontFamily: df.sansSemi, fontSize: 14 },
  ctaCard: { backgroundColor: d.paper, borderRadius: 24, borderWidth: 1, borderColor: d.line, padding: 16, gap: 12 },
  ctaWrap: { borderRadius: 20, overflow: 'hidden' },
  dim: { opacity: 0.6 },
  cta: { height: 72, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  ctaText: { color: ON_GRADIENT, fontFamily: df.sansHeavy, fontSize: 18 },
  ctaMeta: { color: d.muted, fontFamily: df.sans, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  msg: { fontFamily: df.sansSemi, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  msgOk: { color: d.sageDark },
  msgInfo: { color: d.roseDark },
  sectionHead: { gap: 2 },
  sectionEyebrow: { color: d.plum, fontFamily: df.sansBold, fontSize: 10, letterSpacing: 1.6 },
  sectionTitle: { color: d.ink, fontFamily: df.displayBold, fontSize: 18 },
  chips: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 6 },
  chipCol: { alignItems: 'center', gap: 6 },
  chip: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: d.line, backgroundColor: d.ivory, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: d.plum, borderColor: d.plum },
  chipToday: { borderColor: d.plumDark, borderWidth: 2 },
  chipDot: { color: d.muted, fontSize: 16 },
  chipLabel: { color: d.muted, fontFamily: df.sansMedium, fontSize: 11 },
  chipLabelToday: { color: d.ink, fontFamily: df.sansBold },
  groupTitle: { color: d.ink, fontFamily: df.displayBold, fontSize: 20, marginTop: 6, marginBottom: 2 },
  list: { backgroundColor: d.paper, borderRadius: 22, borderWidth: 1, borderColor: d.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: d.line },
  rowIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: d.ink, fontFamily: df.sansSemi, fontSize: 15 },
  rowSub: { color: d.muted, fontFamily: df.sans, fontSize: 12, marginTop: 2 },
});
