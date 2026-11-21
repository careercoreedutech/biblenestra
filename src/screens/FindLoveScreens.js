// FIND LOVE (brief §9, client spec §5 / §6 / §7 / §13 / §14) — Christian dating inside Discover › Find Love.
//   FindLoveTab (rendered by DiscoverScreen): intro → profile onboarding, then Discover (card stack) | Likes | Matches.
//   Screens: DatingProfileEdit · DatingProfileView · DatingChat (the app's chat, embedded, + free-message bar / ad unlock)
//            DatingPlans (Dating Plus / VIP) · DatingBoost (boost + Spotlight, countdown, stats) · DatingSettings (safety).
// Every Dating Coin use goes through <ConfirmSpend/> (cost + balance after) and sends an idempotency key. The rewarded ad is
// only ever shown when the member taps "Watch an ad" — never in the middle of a conversation.
// Server: backend/src/routes/dating.js · notes: scratch/monetisation/dating.md.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Screen, Button, Empty, Notice, Input, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, AnimatedModal, Pulse } from '../components/Motion';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { useStore } from '../store';
import { useAds } from '../ads/Ads';
import { pickPhotos, uploadImage } from '../api/media';
import { getScopeMsgs, dmScope } from '../chat/messages';
import { WalletBalancePill, BuyCoinsSheet, ConfirmSpend, WalletSheet } from '../components/wallet';
import { ws } from '../components/wallet/WalletSheet';
import { useWalletProducts, cancelSubscription, walletChanged, dateLabel } from '../api/wallet';
import {
  useDatingHome, useDatingGet, datingChanged, dating, datingError, newIdempotencyKey, INTENTION_LABELS, DENOMINATIONS, INVOLVEMENT, PROMPTS,
  REPORT_REASONS, BOOST_OPTIONS, countdown, takeLivePhoto,
} from '../api/dating';
import { SegmentToggle } from './MembershipScreens';
import { ChatScreen } from './ChatScreen';
// GIFTS (component owned by the Virtual Gifts agent): <GiftButton/> in the dating chat header. Gifts are posted into the
// chat by the gifts route (kind 'gift'), which never uses the free-message allowance (lib/dating.js datingSendGuard).
import { GiftButton } from '../components/gifts';

const ROSE = colors.rose;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
const firstPhoto = (p) => (p && p.photos && p.photos[0] ? p.photos[0].url : null);

function Avatar({ uri, size = 44, style }) {
  return uri ? <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.raised }, style]} />
    : <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' }, style]}><Icon name="heart" size={size * 0.4} color={ROSE} /></View>;
}
function Chip({ icon, label, tint = colors.muted, bg }) {
  return (
    <View style={[s.chip, bg && { backgroundColor: bg, borderColor: 'transparent' }]}>
      {icon ? <Icon name={icon} size={12} color={tint} /> : null}
      <Text style={[s.chipText, { color: tint }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}
function PlanBadge({ plan, onPress }) {
  const label = plan === 'vip' ? 'VIP' : plan === 'plus' ? 'PLUS' : 'Free';
  const tint = plan === 'vip' ? colors.gold : plan === 'plus' ? colors.primary : colors.muted;
  return (
    <PressScale onPress={onPress} scaleTo={0.94} style={[s.planBadge, { borderColor: alpha(tint, 0.4), backgroundColor: alpha(tint, 0.08) }]} accessibilityRole="button" accessibilityLabel={`Plan: ${label}. See Dating Plus and VIP`}>
      <Icon name={plan === 'free' ? 'sparkles' : 'star'} size={12} color={tint} fill={plan !== 'free' ? tint : undefined} />
      <Text style={[s.planBadgeText, { color: tint }]}>{label}</Text>
    </PressScale>
  );
}
/** "Use the coins" helper: one ConfirmSpend at a time. */
function useSpend() {
  const [spendReq, setSpend] = useState(null); // { amount, wallet, title, description, run, done }
  const sheet = spendReq ? (
    <ConfirmSpend visible amount={spendReq.amount} wallet={spendReq.wallet || 'dating_coins'} title={spendReq.title} description={spendReq.description}
      confirmLabel={spendReq.confirmLabel} onConfirm={spendReq.run} onDone={spendReq.done} onClose={() => setSpend(null)} />
  ) : null;
  return [setSpend, sheet];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Discover › Find Love
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function FindLoveTab({ nav }) {
  const api = useApi();
  const home = useDatingHome();
  const [tab, setTab] = useState('discover');
  const [buying, setBuying] = useState(false);
  const d = home.data;
  if (!api.online) {
    return (
      <ScrollView contentContainerStyle={s.tabPad}>
        <LoveIntro onStart={null} note="Find Love needs a BibleNestra account. Sign in to create your dating profile." />
      </ScrollView>
    );
  }
  if (!home.loaded && !d) return <View style={s.center}><ActivityIndicator color={ROSE} /></View>;
  if (home.error && !d) return <ScrollView contentContainerStyle={s.tabPad}><Empty title="Find Love didn’t load" body={datingError(home.error)} action="Try again" onAction={home.reload} /></ScrollView>;
  if (!d.profile) {
    return (
      <ScrollView contentContainerStyle={s.tabPad}>
        <LoveIntro onStart={() => nav.push('DatingProfileEdit', { onboarding: true })} />
      </ScrollView>
    );
  }
  const p = d.profile;
  const plan = d.plan.plan;
  return (
    <View style={{ flex: 1 }}>
      <View style={s.loveBar}>
        <PlanBadge plan={plan} onPress={() => nav.push('DatingPlans')} />
        <WalletBalancePill wallet="dating_coins" onPress={() => setBuying(true)} />
        <View style={{ flex: 1 }} />
        <PressScale onPress={() => nav.push('DatingBoost')} scaleTo={0.9} style={[s.roundBtn, d.boost && d.boost.active && { backgroundColor: ROSE, borderColor: ROSE }]} accessibilityRole="button" accessibilityLabel="Boost your profile">
          <Icon name="flame" size={16} color={d.boost && d.boost.active ? '#FFFFFF' : ROSE} />
        </PressScale>
        <PressScale onPress={() => nav.push('DatingProfileEdit')} scaleTo={0.9} style={s.roundBtn} accessibilityRole="button" accessibilityLabel="Edit my dating profile">
          <Avatar uri={firstPhoto(p)} size={30} />
        </PressScale>
        <PressScale onPress={() => nav.push('DatingSettings')} scaleTo={0.9} style={s.roundBtn} accessibilityRole="button" accessibilityLabel="Safety and settings">
          <Icon name="shield" size={16} color={colors.fg} />
        </PressScale>
      </View>
      {p.status === 'banned' ? <View style={{ paddingHorizontal: 18 }}><Notice tint={colors.negative} text={`Your Find Love profile is suspended${p.banReason ? `: ${p.banReason}` : ''}. Contact support if you think this is a mistake.`} /></View> : null}
      {p.status === 'paused' ? (
        <PressScale onPress={() => dating.pause(api, false)} style={s.pausedBar} accessibilityRole="button"><Icon name="lock" size={14} color={colors.gold} /><Text style={s.pausedText}>Your profile is hidden. Tap to show it again.</Text></PressScale>
      ) : null}
      {p.underReview && p.status === 'active' ? (
        <View style={s.pausedBar}><Icon name="shield" size={14} color={colors.gold} /><Text style={s.pausedText}>Your profile is hidden from Discover while our team reviews some reports. You can still chat with your matches.</Text></View>
      ) : null}
      {p.status === 'active' && !p.visible && !p.underReview ? (
        <PressScale onPress={() => nav.push('DatingProfileEdit')} style={s.pausedBar} accessibilityRole="button"><Icon name="image" size={14} color={colors.gold} /><Text style={s.pausedText}>{p.photos.length ? 'Your photo is being reviewed — others will see you once it’s approved.' : 'Add a photo so others can see you.'}</Text></PressScale>
      ) : null}
      {d.boost && d.boost.active ? <BoostBar boost={d.boost.active} onPress={() => nav.push('DatingBoost')} /> : null}
      <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>
        <SegmentToggle value={tab} onChange={setTab} options={[
          { id: 'discover', label: 'Discover', icon: 'compass' },
          { id: 'likes', label: d.likes && d.likes.count ? `Likes · ${d.likes.count}` : 'Likes', icon: 'heart' },
          { id: 'matches', label: d.counts && (d.counts.matches || d.counts.requests) ? `Matches · ${d.counts.matches + d.counts.requests}` : 'Matches', icon: 'chat' },
        ]} />
      </View>
      {tab === 'discover' ? (p.underReview
        ? <View style={s.tabPad}><Empty title="Discover is paused for you" body="While our team reviews reports about your profile, you won’t see new people and they won’t see you. Your matches and chats stay open." /></View>
        : <DiscoverStack nav={nav} home={d} />) : tab === 'likes' ? <LikesPane nav={nav} home={d} /> : <MatchesPane nav={nav} />}
      {buying ? <BuyCoinsSheet visible wallet="dating_coins" onClose={() => setBuying(false)} onPurchased={() => datingChanged()} /> : null}
    </View>
  );
}

function LoveIntro({ onStart, note }) {
  return (
    <FadeInUp style={s.introCard}>
      <View style={s.introIcon}><Icon name="heart" size={30} color={ROSE} fill={alpha(ROSE, 0.18)} /></View>
      <Text style={s.introEyebrow}>Find Love</Text>
      <Text style={s.introTitle}>Meaningful Christian relationships</Text>
      <Text style={s.introBody}>Meet believers who share your faith and your hopes for marriage and family. Your dating profile is separate from your social profile, and nothing you do here appears in Socials.</Text>
      {[['shield', 'Adults 18+ only · block, report and hide anytime'], ['map-pin', 'City-level location only — never your exact place'], ['chat', 'Chat after you both say yes'], ['cross', 'Faith details front and centre']].map(([icon, t]) => (
        <View key={t} style={s.introRow}><Icon name={icon} size={15} color={ROSE} /><Text style={s.introRowText}>{t}</Text></View>
      ))}
      {note ? <Notice text={note} /> : <Button label="Create my dating profile" onPress={onStart} style={{ marginTop: 16, alignSelf: 'stretch', backgroundColor: ROSE, borderColor: ROSE }} />}
    </FadeInUp>
  );
}

function BoostBar({ boost, onPress }) {
  const [left, setLeft] = useState(boost.secondsLeft);
  useEffect(() => {
    setLeft(boost.secondsLeft);
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [boost.id, boost.secondsLeft]);
  if (left <= 0) return null;
  return (
    <PressScale onPress={onPress} scaleTo={0.98} style={s.boostBar} accessibilityRole="button" accessibilityLabel={`Boosted, ${countdown(left)} left`}>
      <Icon name="flame" size={14} color={ROSE} />
      <Text style={s.boostBarLabel}>BOOSTED</Text>
      <Text style={s.boostBarText}>{countdown(left)} left · {plural(boost.stats.views, 'view')} · {plural(boost.stats.likes, 'like')}</Text>
      <Icon name="chevron-right" size={14} color={colors.muted} />
    </PressScale>
  );
}

// ─── card stack ────────────────────────────────────────────────────────────────────────────────────────────────────
function DiscoverStack({ nav, home }) {
  const api = useApi();
  const toast = useToast();
  const [cards, setCards] = useState(null);
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState(null);
  const [swipes, setSwipes] = useState(home.swipes);
  const [setSpend, spendSheet] = useSpend();
  const plan = home.plan;
  const prices = home.prices;
  const { height: winH } = useWindowDimensions();
  const cardH = { height: Math.max(300, Math.min(520, winH - 450)) }; // the action buttons stay above the tab bar
  const load = useCallback(async () => {
    try { const r = await dating.discover(api); setCards(r.items); } catch (e) { setCards([]); toast.show(datingError(e), { tone: 'error' }); }
  }, [api.online]); // eslint-disable-line react-hooks/exhaustive-deps -- api is a fresh object each render
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSwipes(home.swipes); }, [home.swipes]);
  const top = cards && cards[0];

  const pan = useRef(new Animated.ValueXY()).current;
  const topRef = useRef(null); topRef.current = top;
  const actRef = useRef(null);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onMoveShouldSetPanResponderCapture: (e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: (e, g) => {
      if (g.dx > 110) actRef.current && actRef.current('like');
      else if (g.dx < -110) actRef.current && actRef.current('pass');
      else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6 }).start();
    },
  }), []);

  async function act(action) {
    const card = topRef.current;
    if (!card || busy) return;
    if (action === 'super_like' || action === 'priority_like') {
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      setSpend({
        amount: prices[action], title: action === 'super_like' ? `Super Like ${card.firstName}` : `Priority Like ${card.firstName}`,
        description: action === 'super_like' ? `${card.firstName} sees that you’re especially interested.` : `Your like is shown at the top of ${card.firstName}’s Likes and their stack.`,
        confirmLabel: action === 'super_like' ? `Super Like · ${prices[action]} coins` : `Priority Like · ${prices[action]} coins`,
        run: () => dating.swipe(api, card.userId, action), done: (r) => afterSwipe(card, r),
      });
      return;
    }
    setBusy(true);
    const dir = action === 'like' ? 1 : -1;
    Animated.timing(pan, { toValue: { x: dir * 520, y: 40 }, duration: 220, useNativeDriver: false }).start();
    try {
      const r = await dating.swipe(api, card.userId, action);
      afterSwipe(card, r);
    } catch (e) {
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      if (e && e.code === 'SWIPE_LIMIT_REACHED') offerExtra();
      else toast.show(datingError(e), { tone: 'error' });
    } finally { setBusy(false); }
  }
  actRef.current = act;
  function afterSwipe(card, r) {
    pan.setValue({ x: 0, y: 0 });
    setCards((cs) => (cs || []).filter((c) => c.userId !== card.userId));
    if (r && r.swipes) setSwipes(r.swipes);
    if (r && r.match) { setMatch({ ...r.match, card }); datingChanged(); }
    if (cards && cards.length <= 3) load();
  }
  function offerExtra() {
    setSpend({
      amount: prices.extra_swipes, title: `${home.rules.extraSwipes} more swipes`, description: 'You’ve used today’s free swipes. Add more for today, or come back tomorrow.',
      confirmLabel: `Add ${home.rules.extraSwipes} swipes`, run: () => dating.extraSwipes(api, newIdempotencyKey()), done: (r) => r && r.swipes && setSwipes(r.swipes),
    });
  }
  async function undo() {
    if (!(plan.flags && plan.flags.undoSwipes)) { nav.push('DatingPlans', { reason: 'undo' }); return; }
    try { const r = await dating.undo(api); if (r.card) setCards((cs) => [r.card, ...(cs || [])]); toast.show('Undone', { icon: 'repost' }); } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }

  const rotate = pan.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-12deg', '0deg', '12deg'] });
  const likeOp = pan.x.interpolate({ inputRange: [20, 120], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOp = pan.x.interpolate({ inputRange: [-120, -20], outputRange: [1, 0], extrapolate: 'clamp' });
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 120 }} showsVerticalScrollIndicator={false} scrollEnabled>
      {cards === null ? <View style={[s.card, cardH, s.center]}><ActivityIndicator color={ROSE} /></View>
        : !top ? (
          <View style={[s.card, cardH, s.center, { padding: 26 }]}>
            <Icon name="heart" size={34} color={ROSE} />
            <Text style={s.emptyTitle}>You’re all caught up</Text>
            <Text style={s.emptyBody}>New people join every day. Widen your preferences or boost your profile so more people see you.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Button small kind="ghost" label="Preferences" onPress={() => nav.push('DatingProfileEdit', { section: 'prefs' })} />
              <Button small label="Boost" onPress={() => nav.push('DatingBoost')} style={{ backgroundColor: ROSE, borderColor: ROSE }} />
            </View>
            <Button small kind="ghost" label="Refresh" onPress={load} style={{ marginTop: 8 }} />
          </View>
        ) : (
          <View>
            {cards[1] ? <View style={[s.card, cardH, s.cardBehind]}><CardFace card={cards[1]} /></View> : null}
            <Animated.View {...responder.panHandlers} style={[s.card, cardH, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}>
              <Pressable onPress={() => nav.push('DatingProfileView', { userId: top.userId, card: top })} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`${top.firstName}, ${top.age}. Open profile`}>
                <CardFace card={top} />
              </Pressable>
              <Animated.View pointerEvents="none" style={[s.stamp, s.stampLike, { opacity: likeOp }]}><Text style={[s.stampText, { color: colors.positive }]}>LIKE</Text></Animated.View>
              <Animated.View pointerEvents="none" style={[s.stamp, s.stampPass, { opacity: passOp }]}><Text style={[s.stampText, { color: colors.negative }]}>PASS</Text></Animated.View>
            </Animated.View>
          </View>
        )}
      {top ? (
        <View style={s.actions}>
          <ActionBtn icon="repost" size={44} tint={colors.gold} label={plan.flags && plan.flags.undoSwipes ? 'Undo last swipe' : 'Undo (Dating Plus)'} onPress={undo} lock={!(plan.flags && plan.flags.undoSwipes)} />
          <ActionBtn icon="x" size={58} tint={colors.negative} label="Pass" onPress={() => act('pass')} disabled={busy} />
          <ActionBtn icon="star" size={48} tint={colors.sky} label={`Super Like, ${prices.super_like} coins`} onPress={() => act('super_like')} badge={prices.super_like} />
          <ActionBtn icon="heart" size={58} tint={ROSE} label="Like" onPress={() => act('like')} disabled={busy} filled />
          <ActionBtn icon="sparkles" size={44} tint={colors.lavender} label={`Priority Like, ${prices.priority_like} coins`} onPress={() => act('priority_like')} badge={prices.priority_like} />
        </View>
      ) : null}
      {swipes ? (
        <View style={s.swipeInfo}>
          <Text style={s.swipeInfoText}>{swipes.left > 0 ? `${plural(swipes.left, 'swipe')} left today` : 'No free swipes left today'}</Text>
          {swipes.left <= 5 ? <PressScale onPress={offerExtra} style={s.linkBtn} accessibilityRole="button"><Text style={s.linkText}>{`+${home.rules.extraSwipes} swipes · ${prices.extra_swipes} coins`}</Text></PressScale> : null}
        </View>
      ) : null}
      <Text style={s.hint}>Swipe right to like, left to pass. Tap a card for the full profile.</Text>
      {spendSheet}
      <MatchModal match={match} onClose={() => setMatch(null)} onChat={() => { const m = match; setMatch(null); nav.push('DatingChat', { conversationId: m.conversationId, name: m.card.firstName, photo: firstPhoto(m.card) }); }} me={home.profile} />
    </ScrollView>
  );
}

function CardFace({ card }) {
  const [i, setI] = useState(0);
  const photos = card.photos || [];
  const uri = photos[i] ? photos[i].url : null;
  return (
    <View style={{ flex: 1 }}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.cardRose }]} />}
      {photos.length > 1 ? (
        <View style={s.dots}>{photos.map((p, k) => <Pressable key={p.id} onPress={() => setI(k)} hitSlop={6} style={[s.dot, k === i && s.dotOn]} />)}</View>
      ) : null}
      <View style={s.cardTopRow}>
        {card.boosted ? <Chip icon="flame" label={card.spotlight ? 'SPOTLIGHT' : 'BOOSTED'} tint="#FFFFFF" bg="rgba(176,71,92,0.75)" /> : null}
        {card.superLikedYou ? <Chip icon="star" label="Likes you a lot" tint="#FFFFFF" bg="rgba(53,109,156,0.8)" /> : null}
      </View>
      <View style={s.cardShade} />
      <View style={s.cardInfo}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.cardName} numberOfLines={1}>{card.firstName}, {card.age}</Text>
          {card.verified ? <Icon name="check-circle" size={18} color="#8FC2FF" /> : null}
          {card.vip ? <View style={s.vip}><Text style={s.vipText}>VIP</Text></View> : null}
        </View>
        <View style={s.cardMetaRow}>
          <Icon name="map-pin" size={12} color="rgba(255,255,255,0.85)" />
          <Text style={s.cardMeta} numberOfLines={1}>{[card.city, card.country].filter(Boolean).join(', ') || 'Location hidden'}</Text>
        </View>
        <View style={s.cardChips}>
          {card.denomination ? <Chip icon="cross" label={card.denomination} tint="#FFFFFF" bg="rgba(255,255,255,0.18)" /> : null}
          {card.churchInvolvement ? <Chip icon="church" label={card.churchInvolvement} tint="#FFFFFF" bg="rgba(255,255,255,0.18)" /> : null}
          <Chip icon="heart" label={card.intentionLabel} tint="#FFFFFF" bg="rgba(255,255,255,0.18)" />
        </View>
        {card.bio ? <Text style={s.cardBio} numberOfLines={2}>{card.bio}</Text> : null}
      </View>
    </View>
  );
}

function ActionBtn({ icon, size, tint, label, onPress, disabled, filled, badge, lock }) {
  return (
    <PressScale onPress={onPress} disabled={disabled} scaleTo={0.88} style={[s.actBtn, { width: size, height: size, borderRadius: size / 2 }, filled && { backgroundColor: tint, borderColor: tint }]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={size * 0.42} color={filled ? '#FFFFFF' : tint} fill={filled ? '#FFFFFF' : undefined} strokeWidth={2.3} />
      {badge ? <View style={[s.actBadge, { backgroundColor: tint }]}><Text style={s.actBadgeText}>{badge}</Text></View> : null}
      {lock ? <View style={[s.actBadge, { backgroundColor: colors.muted }]}><Icon name="lock" size={8} color="#FFFFFF" /></View> : null}
    </PressScale>
  );
}

function MatchModal({ match, onClose, onChat, me }) {
  return (
    <AnimatedModal visible={!!match} onRequestClose={onClose} dim="rgba(21,23,43,0.82)">
      <View style={s.matchWrap}>
        {match ? (
          <ScaleIn style={{ alignItems: 'center' }}>
            <Text style={s.matchEyebrow}>It’s a match</Text>
            <Text style={s.matchTitle}>You and {match.card.firstName} like each other</Text>
            <View style={s.matchPhotos}>
              <Avatar uri={firstPhoto(me)} size={104} style={s.matchPhotoL} />
              <Avatar uri={firstPhoto(match.card)} size={104} style={s.matchPhotoR} />
              <Pulse style={s.matchHeart}><Icon name="heart" size={22} color="#FFFFFF" fill="#FFFFFF" /></Pulse>
            </View>
            <Text style={s.matchBody}>Take it slow, pray, and keep your first conversations on BibleNestra. Never send money to someone you haven’t met.</Text>
            <Button label={`Say hello to ${match.card.firstName}`} onPress={onChat} style={{ marginTop: 18, alignSelf: 'stretch', backgroundColor: ROSE, borderColor: ROSE }} />
            <Button label="Keep browsing" kind="ghost" onPress={onClose} style={{ marginTop: 8, alignSelf: 'stretch' }} />
          </ScaleIn>
        ) : null}
      </View>
    </AnimatedModal>
  );
}

// ─── likes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function LikesPane({ nav, home }) {
  const api = useApi();
  const toast = useToast();
  const likes = useDatingGet('/dating/likes');
  const [setSpend, spendSheet] = useSpend();
  const d = likes.data;
  async function likeBack(card) {
    try {
      const r = await dating.swipe(api, card.userId, 'like');
      if (r.match) { datingChanged(); nav.push('DatingChat', { conversationId: r.match.conversationId, name: card.firstName, photo: firstPhoto(card) }); }
      likes.reload();
    } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }
  if (!d) return <View style={s.center}><ActivityIndicator color={ROSE} /></View>;
  return (
    <ScrollView contentContainerStyle={s.tabPad}>
      {!d.unlocked ? (
        <View style={s.lockCard}>
          <View style={s.blurRow}>{Array.from({ length: Math.min(3, Math.max(1, d.count)) }).map((_, k) => <View key={k} style={s.blurTile}><Icon name="heart" size={22} color={alpha(ROSE, 0.5)} /></View>)}</View>
          <Text style={s.lockTitle}>{d.count ? `${plural(d.count, 'person likes', 'people like')} you` : 'No new likes yet'}</Text>
          <Text style={s.lockBody}>{d.count ? 'See who they are and like them back to match.' : 'When someone likes you, they’ll appear here.'}</Text>
          {d.count ? (
            <>
              <Button label={`See who liked you · ${d.offer.coins} coins for ${d.offer.hours} h`} onPress={() => setSpend({
                amount: d.offer.coins, title: 'See who liked you', description: `Unlocks your Likes list for ${d.offer.hours} hours. Free with Dating Plus and VIP.`,
                run: () => dating.unlockLikes(api, newIdempotencyKey()), done: () => likes.reload(),
              })} style={{ marginTop: 14, alignSelf: 'stretch', backgroundColor: ROSE, borderColor: ROSE }} />
              <Button kind="ghost" label="Get Dating Plus" onPress={() => nav.push('DatingPlans', { reason: 'likes' })} style={{ marginTop: 8, alignSelf: 'stretch' }} />
            </>
          ) : null}
        </View>
      ) : (
        <>
          <Text style={s.paneNote}>{d.viaPlan ? 'Included in your plan.' : `Unlocked until ${new Date(d.unlockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`} Like them back to match.</Text>
          {!d.items.length ? <Empty title="No new likes" body="When someone likes you, they’ll appear here." /> : null}
          <View style={s.grid}>
            {d.items.map((c) => (
              <PressScale key={c.userId} onPress={() => nav.push('DatingProfileView', { userId: c.userId, card: c })} style={s.gridTile} scaleTo={0.97}>
                <Image source={{ uri: firstPhoto(c) }} style={s.gridImg} />
                {c.kind !== 'like' ? <View style={s.gridTag}><Icon name="star" size={10} color="#FFFFFF" /><Text style={s.gridTagText}>{c.kind === 'priority_like' ? 'Priority' : 'Super Like'}</Text></View> : null}
                <View style={s.gridFoot}>
                  <Text style={s.gridName} numberOfLines={1}>{c.firstName}, {c.age}</Text>
                  <PressScale onPress={() => likeBack(c)} style={s.gridLike} scaleTo={0.85} accessibilityRole="button" accessibilityLabel={`Like ${c.firstName} back`}><Icon name="heart" size={14} color="#FFFFFF" fill="#FFFFFF" /></PressScale>
                </View>
              </PressScale>
            ))}
          </View>
        </>
      )}
      {spendSheet}
    </ScrollView>
  );
}

// ─── matches + requests ────────────────────────────────────────────────────────────────────────────────────────────
function MatchesPane({ nav }) {
  const api = useApi();
  const toast = useToast();
  const matches = useDatingGet('/dating/matches');
  const requests = useDatingGet('/dating/requests');
  const items = (matches.data && matches.data.items) || [];
  const reqs = ((requests.data && requests.data.items) || []);
  async function answer(r, accept) {
    try {
      const res = await dating.answerRequest(api, r.conversationId, accept);
      if (accept && res.match) nav.push('DatingChat', { conversationId: r.conversationId, name: r.profile.firstName, photo: firstPhoto(r.profile) });
      requests.reload(); matches.reload();
    } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }
  if (!matches.loaded) return <View style={s.center}><ActivityIndicator color={ROSE} /></View>;
  return (
    <ScrollView contentContainerStyle={s.tabPad}>
      {reqs.length ? <Text style={s.sectionLabel}>Message requests</Text> : null}
      {reqs.map((r) => (
        <View key={r.conversationId} style={s.reqCard}>
          <Avatar uri={firstPhoto(r.profile)} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.rowName}>{r.profile.firstName}, {r.profile.age}</Text>
            <Text style={s.rowSub} numberOfLines={2}>{r.incoming ? `“${r.message}”` : 'Waiting for a reply to your request'}</Text>
            {r.incoming ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Button small label="Accept" onPress={() => answer(r, true)} style={{ backgroundColor: ROSE, borderColor: ROSE }} />
                <Button small kind="ghost" label="Decline" onPress={() => answer(r, false)} />
              </View>
            ) : null}
          </View>
        </View>
      ))}
      {items.length ? <Text style={s.sectionLabel}>Matches</Text> : null}
      {!items.length && !reqs.length ? <Empty title="No matches yet" body="When you and someone both like each other, you’ll find them here — and can start a conversation." /> : null}
      {items.map((m, i) => (
        <FadeInUp key={m.matchId} index={i} distance={8}>
          <PressScale onPress={() => nav.push('DatingChat', { conversationId: m.conversationId, name: m.profile.firstName, photo: firstPhoto(m.profile) })} style={s.matchRow} scaleTo={0.98}>
            <Avatar uri={firstPhoto(m.profile)} size={52} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.rowName} numberOfLines={1}>{m.profile.firstName}, {m.profile.age}</Text>
                {m.profile.vip ? <View style={s.vip}><Text style={s.vipText}>VIP</Text></View> : null}
              </View>
              <Text style={[s.rowSub, m.unread && { color: colors.fg, fontWeight: '700' }]} numberOfLines={1}>{m.lastMessage ? `${m.lastMessage.mine ? 'You: ' : ''}${m.lastMessage.text}` : 'New match — say hello 👋'}</Text>
            </View>
            {m.unread ? <View style={s.unread}><Text style={s.unreadText}>{m.unread}</Text></View> : <Icon name="chevron-right" size={16} color={colors.faint} />}
          </PressScale>
        </FadeInUp>
      ))}
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Profile editor (onboarding + edit)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function Choice({ items, value, onChange, multi, labels }) {
  const on = (k) => (multi ? (value || []).includes(k) : value === k);
  return (
    <View style={s.choiceWrap}>
      {items.map((k) => (
        <PressScale key={k} onPress={() => onChange(multi ? (on(k) ? value.filter((x) => x !== k) : [...(value || []), k]) : k)} scaleTo={0.94} style={[s.choice, on(k) && s.choiceOn]} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on(k) }}>
          <Text style={[s.choiceText, on(k) && s.choiceTextOn]}>{labels ? labels[k] : k}</Text>
        </PressScale>
      ))}
    </View>
  );
}
function Field({ label, hint, children, locked, onLocked }) {
  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={s.fieldLabel}>{label}</Text>
        {locked ? <PressScale onPress={onLocked} style={s.lockPill}><Icon name="lock" size={10} color={colors.gold} /><Text style={s.lockPillText}>{locked}</Text></PressScale> : null}
      </View>
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
      <View style={locked ? { opacity: 0.45 } : null} pointerEvents={locked ? 'none' : 'auto'}>{children}</View>
    </View>
  );
}

export function DatingProfileEditScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const home = useDatingHome();
  const p = home.data && home.data.profile;
  const flags = (home.data && home.data.plan && home.data.plan.flags) || {};
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (f || !home.loaded) return;
    const b = p ? p.birthDate.split('-') : ['', '', ''];
    setF({
      firstName: p ? p.firstName : '', y: b[0], m: b[1], d: b[2], gender: p ? p.gender : null, interestedIn: p ? p.interestedIn : null,
      city: p ? p.city : '', country: p ? p.country : 'Nigeria', denomination: p ? p.denomination : '', churchInvolvement: p ? p.churchInvolvement : '',
      intention: p ? p.intention : 'marriage', bio: p ? p.bio : '', prompts: p ? p.prompts : [], confirmAdult: !!p,
      prefs: p ? { ageMin: 18, ageMax: 60, intentions: [], denominations: [], involvement: [], ...p.prefs } : { ageMin: 21, ageMax: 40, country: 'Nigeria', intentions: [], denominations: [], involvement: [] },
    });
  }, [home.loaded, p]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setPref = (k, v) => setF((x) => ({ ...x, prefs: { ...x.prefs, [k]: v } }));
  if (!f) return <Screen back title="Dating profile"><ActivityIndicator color={ROSE} style={{ marginTop: 40 }} /></Screen>;

  async function save() {
    if (saving) return;
    const birthDate = `${String(f.y).padStart(4, '0')}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;
    if (!f.firstName.trim() || !f.gender || !f.interestedIn || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) { setErr('Please fill in your first name, date of birth, and who you are and are looking for.'); return; }
    if (!f.confirmAdult) { setErr('Please confirm you are 18 or older.'); return; }
    setSaving(true); setErr(null);
    try {
      await dating.saveProfile(api, {
        firstName: f.firstName, birthDate, confirmAdult: f.confirmAdult, gender: f.gender, interestedIn: f.interestedIn, city: f.city, country: f.country,
        denomination: f.denomination, churchInvolvement: f.churchInvolvement, intention: f.intention, bio: f.bio,
        prompts: (f.prompts || []).filter((x) => x.q && x.a), prefs: { ...f.prefs, ageMin: Number(f.prefs.ageMin) || 18, ageMax: Number(f.prefs.ageMax) || 60 },
      });
      toast.show(p ? 'Profile saved' : 'Welcome to Find Love 💛', { icon: 'heart', haptic: 'success' });
      if (!p) home.reload(); else nav.pop();
    } catch (e) { setErr(datingError(e, 'Couldn’t save your profile')); } finally { setSaving(false); }
  }
  async function addPhoto() {
    if (uploading) return;
    try {
      const picked = await pickPhotos(1);
      if (!picked.length) return;
      setUploading(true);
      const up = await uploadImage(api.request, picked[0]);
      const r = await dating.addPhoto(api, up.key);
      toast.show(r && r.review === 'live' ? 'Photo added — it’s live on your profile' : r && r.review === 'flagged'
        ? 'This photo needs a check by our team before others can see it' : 'Photo added — it appears once a moderator approves it', { icon: 'image', tone: r && r.review === 'flagged' ? 'error' : undefined });
    } catch (e) { toast.show(datingError(e, 'Couldn’t add that photo'), { tone: 'error' }); } finally { setUploading(false); }
  }
  const promptSlots = [0, 1, 2];
  return (
    <Screen back title={p ? 'Your dating profile' : 'Create your profile'} subtitle="Find Love">
      {!p ? <Notice tint={ROSE} text="Your dating profile is separate from your social profile. Only your first name, age, city and what you add here are shown." /> : null}
      {p ? (
        <View style={{ marginTop: 4 }}>
          <Text style={s.fieldLabel}>Photos</Text>
          <Text style={s.fieldHint}>{home.data.rules.photoReview === 'ai' ? 'Clear, modest photos of you with your face showing. Each photo gets a quick automatic check and goes live straight away unless it needs a look from our team.' : 'Clear, modest photos of you. New photos are checked by our team before others see them.'}</Text>
          <View style={s.photoGrid}>
            {p.photos.map((ph, i) => (
              <View key={ph.id} style={s.photoCell}>
                <Image source={{ uri: ph.url }} style={s.photoImg} />
                <View style={[s.photoState, { backgroundColor: ph.status === 'approved' ? alpha(colors.positive, 0.9) : ph.status === 'rejected' ? alpha(colors.negative, 0.9) : alpha(colors.gold, 0.9) }]}>
                  <Text style={s.photoStateText}>{ph.status === 'approved' ? (i === 0 ? 'Main' : 'Live') : ph.status === 'rejected' ? 'Rejected' : 'In review'}</Text>
                </View>
                <View style={s.photoTools}>
                  {i > 0 ? <PressScale onPress={() => dating.mainPhoto(api, ph.id)} style={s.photoTool} accessibilityLabel="Make main photo"><Icon name="star" size={12} color={colors.fg} /></PressScale> : null}
                  <PressScale onPress={() => dating.removePhoto(api, ph.id)} style={s.photoTool} accessibilityLabel="Remove photo"><Icon name="trash" size={12} color={colors.negative} /></PressScale>
                </View>
              </View>
            ))}
            {p.photos.length < (home.data.rules.maxPhotos || 6) ? (
              <PressScale onPress={addPhoto} style={[s.photoCell, s.photoAdd]} accessibilityRole="button" accessibilityLabel="Add a photo">
                {uploading ? <ActivityIndicator color={ROSE} /> : <><Icon name="plus" size={22} color={ROSE} /><Text style={s.photoAddText}>Add photo</Text></>}
              </PressScale>
            ) : null}
          </View>
        </View>
      ) : null}

      <Field label="First name"><Input value={f.firstName} onChangeText={(v) => set('firstName', v)} placeholder="e.g. Grace" maxLength={40} /></Field>
      <Field label="Date of birth" hint="Only your age is shown. Find Love is for adults 18 and over.">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input value={f.d} onChangeText={(v) => set('d', v.replace(/\D/g, '').slice(0, 2))} placeholder="DD" keyboardType="number-pad" style={{ flex: 1, minWidth: 0 }} accessibilityLabel="Day" />
          <Input value={f.m} onChangeText={(v) => set('m', v.replace(/\D/g, '').slice(0, 2))} placeholder="MM" keyboardType="number-pad" style={{ flex: 1, minWidth: 0 }} accessibilityLabel="Month" />
          <Input value={f.y} onChangeText={(v) => set('y', v.replace(/\D/g, '').slice(0, 4))} placeholder="YYYY" keyboardType="number-pad" style={{ flex: 1.4, minWidth: 0 }} accessibilityLabel="Year" />
        </View>
      </Field>
      <Field label="I am a"><Choice items={['man', 'woman']} labels={{ man: 'Man', woman: 'Woman' }} value={f.gender} onChange={(v) => set('gender', v)} /></Field>
      <Field label="Interested in"><Choice items={['men', 'women']} labels={{ men: 'Men', women: 'Women' }} value={f.interestedIn} onChange={(v) => set('interestedIn', v)} /></Field>
      <Field label="Where you live" hint="City and country only — never your exact location.">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input value={f.city} onChangeText={(v) => set('city', v)} placeholder="City" style={{ flex: 1, minWidth: 0 }} maxLength={60} />
          <Input value={f.country} onChangeText={(v) => set('country', v)} placeholder="Country" style={{ flex: 1, minWidth: 0 }} maxLength={60} />
        </View>
      </Field>
      <Field label="Denomination"><Choice items={DENOMINATIONS} value={f.denomination} onChange={(v) => set('denomination', v)} /></Field>
      <Field label="Church involvement"><Choice items={INVOLVEMENT} value={f.churchInvolvement} onChange={(v) => set('churchInvolvement', v)} /></Field>
      <Field label="Relationship intentions"><Choice items={Object.keys(INTENTION_LABELS)} labels={INTENTION_LABELS} value={f.intention} onChange={(v) => set('intention', v)} /></Field>
      <Field label="About you"><Input value={f.bio} onChangeText={(v) => set('bio', v)} placeholder="Your faith, what you love, what you’re hoping for…" multiline maxLength={500} /></Field>
      <Field label="Prompts" hint="Answer up to three.">
        {promptSlots.map((k) => {
          const cur = f.prompts[k] || { q: '', a: '' };
          const upd = (patch) => { const next = [...f.prompts]; next[k] = { ...cur, ...patch }; set('prompts', next); };
          return (
            <View key={k} style={s.promptBox}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {PROMPTS.map((q) => <PressScale key={q} onPress={() => upd({ q })} style={[s.choice, cur.q === q && s.choiceOn]}><Text style={[s.choiceText, cur.q === q && s.choiceTextOn]}>{q}</Text></PressScale>)}
              </ScrollView>
              {cur.q ? <Input value={cur.a} onChangeText={(v) => upd({ a: v })} placeholder="Your answer" maxLength={200} style={{ marginTop: 8 }} /> : null}
            </View>
          );
        })}
      </Field>

      <Text style={[s.sectionLabel, { marginTop: 26 }]}>Who you’d like to meet</Text>
      <Field label="Age range">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Input value={String(f.prefs.ageMin ?? '')} onChangeText={(v) => setPref('ageMin', v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" style={{ flex: 1, minWidth: 0 }} accessibilityLabel="Minimum age" />
          <Text style={s.fieldHint}>to</Text>
          <Input value={String(f.prefs.ageMax ?? '')} onChangeText={(v) => setPref('ageMax', v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" style={{ flex: 1, minWidth: 0 }} accessibilityLabel="Maximum age" />
        </View>
      </Field>
      <Field label="Country" hint="Leave empty to meet believers anywhere."><Input value={f.prefs.country || ''} onChangeText={(v) => setPref('country', v)} placeholder="Any country" /></Field>
      <Field label="Their intentions"><Choice multi items={Object.keys(INTENTION_LABELS)} labels={INTENTION_LABELS} value={f.prefs.intentions || []} onChange={(v) => setPref('intentions', v)} /></Field>
      <Field label="Denominations" locked={flags.advancedFilters ? null : 'Dating Plus'} onLocked={() => nav.push('DatingPlans', { reason: 'filters' })}>
        <Choice multi items={DENOMINATIONS} value={f.prefs.denominations || []} onChange={(v) => setPref('denominations', v)} />
      </Field>
      <Field label="Church involvement" locked={flags.advancedFilters ? null : 'Dating Plus'} onLocked={() => nav.push('DatingPlans', { reason: 'filters' })}>
        <Choice multi items={INVOLVEMENT} value={f.prefs.involvement || []} onChange={(v) => setPref('involvement', v)} />
      </Field>
      <Field label="Same city only" locked={flags.advancedLocationFilters ? null : 'VIP'} onLocked={() => nav.push('DatingPlans', { reason: 'location' })}>
        <Input value={f.prefs.city || ''} onChangeText={(v) => setPref('city', v)} placeholder="City (e.g. Lagos)" />
      </Field>
      <Field label="Compatible only" hint="Only people whose own preferences include you." locked={flags.advancedLocationFilters ? null : 'VIP'} onLocked={() => nav.push('DatingPlans', { reason: 'compat' })}>
        <View style={s.switchRow}><Text style={s.rowSub}>Match both ways</Text><Switch value={!!f.prefs.compatibleOnly} onValueChange={(v) => setPref('compatibleOnly', v)} /></View>
      </Field>

      {!p ? (
        <PressScale onPress={() => set('confirmAdult', !f.confirmAdult)} style={s.confirmRow} accessibilityRole="checkbox" accessibilityState={{ checked: f.confirmAdult }}>
          <View style={[s.checkbox, f.confirmAdult && { backgroundColor: ROSE, borderColor: ROSE }]}>{f.confirmAdult ? <Icon name="check" size={13} color="#FFFFFF" strokeWidth={3} /> : null}</View>
          <Text style={s.confirmText}>I confirm I am 18 or older and will treat others with respect, honesty and purity.</Text>
        </PressScale>
      ) : null}
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Button label={saving ? 'Saving…' : p ? 'Save' : 'Create my profile'} onPress={save} disabled={saving} style={{ marginTop: 18, backgroundColor: ROSE, borderColor: ROSE }} />
      {!p ? <Text style={s.fieldHint}>After you create your profile, add photos so others can see you.</Text> : null}
    </Screen>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Someone's profile
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function DatingProfileViewScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const home = useDatingHome();
  const [card, setCard] = useState(params.card || null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [text, setText] = useState('');
  const [setSpend, spendSheet] = useSpend();
  const keyRef = useRef(null);
  useEffect(() => { dating.profile(api, params.userId).then(setCard).catch((e) => { if (!card) toast.show(datingError(e), { tone: 'error' }); }); }, [params.userId]);
  if (!card) return <Screen back title="Profile"><ActivityIndicator color={ROSE} style={{ marginTop: 40 }} /></Screen>;
  const prices = (home.data && home.data.prices) || {};
  async function like(action) {
    const go = () => dating.swipe(api, card.userId, action);
    const done = (r) => {
      datingChanged();
      if (r && r.match) nav.replace ? nav.replace('DatingChat', { conversationId: r.match.conversationId, name: card.firstName, photo: firstPhoto(card) }) : nav.push('DatingChat', { conversationId: r.match.conversationId, name: card.firstName, photo: firstPhoto(card) });
      else { toast.show(action === 'like' ? `You liked ${card.firstName}` : 'Sent 💫', { icon: 'heart' }); nav.pop(); }
    };
    if (action === 'like') { try { done(await go()); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } return; }
    setSpend({ amount: prices[action], title: action === 'super_like' ? `Super Like ${card.firstName}` : `Priority Like ${card.firstName}`, run: go, done });
  }
  return (
    <Screen back title={card.firstName} subtitle="Find Love" right={<PressScale onPress={() => setMenu(true)} style={s.roundBtn} accessibilityLabel="More"><Icon name="more" size={16} color={colors.fg} /></PressScale>}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.gallery}>
        {(card.photos.length ? card.photos : [{ id: 'none', url: null }]).map((ph) => (
          <View key={ph.id} style={s.galleryItem}>{ph.url ? <Image source={{ uri: ph.url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}</View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <Text style={s.viewName}>{card.firstName}, {card.age}</Text>
        {card.verified ? <Icon name="check-circle" size={18} color={colors.sky} /> : null}
        {card.vip ? <View style={s.vip}><Text style={s.vipText}>VIP</Text></View> : null}
      </View>
      <View style={s.viewChips}>
        <Chip icon="map-pin" label={[card.city, card.country].filter(Boolean).join(', ') || 'Location hidden'} />
        {card.denomination ? <Chip icon="cross" label={card.denomination} /> : null}
        {card.churchInvolvement ? <Chip icon="church" label={card.churchInvolvement} /> : null}
        <Chip icon="heart" label={card.intentionLabel} tint={ROSE} />
      </View>
      {card.bio ? <Text style={s.viewBio}>{card.bio}</Text> : null}
      {(card.prompts || []).map((pr) => (
        <View key={pr.q} style={s.promptCard}><Text style={s.promptQ}>{pr.q}</Text><Text style={s.promptA}>{pr.a}</Text></View>
      ))}
      <View style={s.viewActions}>
        <Button label="Like" onPress={() => like('like')} icon={<Icon name="heart" size={15} color="#FFFFFF" fill="#FFFFFF" />} style={{ flex: 1, backgroundColor: ROSE, borderColor: ROSE }} />
        <Button kind="ghost" label={`Super Like · ${prices.super_like || 10}`} onPress={() => like('super_like')} icon={<Icon name="star" size={15} color={colors.sky} />} style={{ flex: 1 }} />
      </View>
      <Button kind="ghost" label={`Send a message request · ${prices.message_request || 25} coins`} onPress={() => { keyRef.current = newIdempotencyKey(); setRequesting(true); }} icon={<Icon name="chat" size={15} color={colors.fg} />} style={{ marginTop: 8 }} />
      <Text style={s.fieldHint}>A message request lets you write before you match. {card.firstName} can accept or decline.</Text>
      {spendSheet}
      <WalletSheet visible={requesting} onClose={() => setRequesting(false)} title={`Message ${card.firstName}`} subtitle="Write a kind first message. If they accept, you’ll match and can keep chatting.">
        <TextInput value={text} onChangeText={setText} placeholder="Hello! I noticed…" placeholderTextColor={colors.faint} multiline maxLength={500} style={s.reqInput} />
        <PressScale onPress={() => { if (!text.trim()) return; setRequesting(false); setSpend({ amount: prices.message_request || 25, title: 'Send message request', description: `“${text.trim().slice(0, 80)}”`, run: () => dating.sendRequest(api, card.userId, text.trim(), keyRef.current), done: () => { toast.show('Request sent 💌', { icon: 'chat' }); nav.pop(); } }); }} style={[ws.primary, !text.trim() && ws.disabled]}>
          <Text style={ws.primaryText}>Continue</Text>
        </PressScale>
      </WalletSheet>
      <SafetyMenu visible={menu} name={card.firstName} onClose={() => setMenu(false)} onReport={() => { setMenu(false); setReporting(true); }} onBlock={async () => { setMenu(false); try { await dating.block(api, card.userId); toast.show(`${card.firstName} is blocked`, { icon: 'shield' }); nav.pop(); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } }} />
      <ReportSheet visible={reporting} userId={card.userId} name={card.firstName} onClose={() => setReporting(false)} onDone={() => nav.pop()} />
    </Screen>
  );
}

function SafetyMenu({ visible, name, onClose, onReport, onBlock, onUnmatch, onProfile, onTips }) {
  return (
    <WalletSheet visible={visible} onClose={onClose} title={name}>
      {onProfile ? <MenuRow icon="user" label="View profile" onPress={onProfile} /> : null}
      {onTips ? <MenuRow icon="shield" label="Safety tips" onPress={onTips} /> : null}
      {onUnmatch ? <MenuRow icon="x" label="Unmatch" onPress={onUnmatch} /> : null}
      <MenuRow icon="quote" label="Report" onPress={onReport} danger />
      <MenuRow icon="lock" label={`Block ${name}`} onPress={onBlock} danger />
      <PressScale onPress={onClose} style={ws.ghost}><Text style={ws.ghostText}>Cancel</Text></PressScale>
    </WalletSheet>
  );
}
function MenuRow({ icon, label, onPress, danger }) {
  return (
    <PressScale onPress={onPress} style={s.menuRow} scaleTo={0.98} accessibilityRole="button">
      <Icon name={icon} size={17} color={danger ? colors.negative : colors.fg} />
      <Text style={[s.menuText, danger && { color: colors.negative }]}>{label}</Text>
    </PressScale>
  );
}
function ReportSheet({ visible, userId, name, onClose, onDone }) {
  const api = useApi();
  const toast = useToast();
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!reason || busy) return;
    setBusy(true);
    try { await dating.report(api, userId, reason, details, block); toast.show('Thank you — our team will review this', { icon: 'shield' }); onClose(); onDone && onDone(); }
    catch (e) { toast.show(datingError(e), { tone: 'error' }); } finally { setBusy(false); }
  }
  return (
    <WalletSheet visible={visible} onClose={onClose} title={`Report ${name}`} subtitle="Reports are private. If you feel unsafe, block and talk to someone you trust.">
      <View style={s.choiceWrap}>{REPORT_REASONS.map(([k, l]) => <PressScale key={k} onPress={() => setReason(k)} style={[s.choice, reason === k && s.choiceOn]}><Text style={[s.choiceText, reason === k && s.choiceTextOn]}>{l}</Text></PressScale>)}</View>
      <TextInput value={details} onChangeText={setDetails} placeholder="What happened? (optional)" placeholderTextColor={colors.faint} multiline maxLength={1000} style={[s.reqInput, { minHeight: 70 }]} />
      <View style={s.switchRow}><Text style={s.rowSub}>Also block {name}</Text><Switch value={block} onValueChange={setBlock} /></View>
      <PressScale onPress={send} style={[ws.primary, { backgroundColor: colors.negative }, (!reason || busy) && ws.disabled]}><Text style={ws.primaryText}>{busy ? 'Sending…' : 'Send report'}</Text></PressScale>
    </WalletSheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Dating chat: the app's chat (embedded) + Find Love header + free-message bar / unlock panel
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function DatingChatScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const ads = useAds();
  const { state } = useStore();
  const convId = params.conversationId;
  const info = useDatingGet(convId ? `/dating/conversations/${convId}` : null);
  const d = info.data;
  const a = d && d.allowance;
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [adBusy, setAdBusy] = useState(false);
  const [adFailed, setAdFailed] = useState(false);
  const [setSpend, spendSheet] = useSpend();
  // refresh the counter whenever one of my messages lands (sent / failed)
  const mine = getScopeMsgs(state, dmScope(convId)).filter((m) => m.mine).map((m) => `${m.id}:${m.status || ''}`).join('|');
  useEffect(() => { if (d && d.status === 'match' && a && !a.unrestricted) info.reload(); }, [mine]);
  useEffect(() => { ads.preloadRewarded && a && a.needsUnlock && a.adUnlocksLeft > 0 && ads.preloadRewarded(); }, [a && a.needsUnlock]);
  const name = (d && d.profile && d.profile.firstName) || params.name || 'Match';
  const photo = (d && d.profile && firstPhoto(d.profile)) || params.photo;
  // Verified people only (admin setting): their social profile — handle, avatar and a link to it in Socials.
  const social = d && d.social;

  async function watchAd() {
    if (adBusy) return;
    setAdBusy(true); setAdFailed(false);
    try {
      const st = await dating.startAd(api, convId);
      const r = await ads.showRewarded({ purpose: st.purpose });
      if (!r || !r.rewarded) { setAdFailed(true); toast.show(r && r.error ? 'No ad is available right now' : 'Watch the whole ad to unlock messages', { tone: 'error' }); return; }
      let res = null;
      for (let i = 0; i < 6; i++) { // with AdMob SSV the reward may arrive a moment after the ad closes
        try { res = await dating.claimAd(api, st.nonce, st.token); break; } catch (e) {
          if (e && e.code === 'AD_PENDING_VERIFICATION') { await new Promise((ok) => setTimeout(ok, 2000)); continue; }
          throw e;
        }
      }
      if (!res) { toast.show('Still confirming your reward — try again in a moment', { tone: 'error' }); return; }
      toast.show(`Unlocked ${st.messagesPerAd} free messages`, { icon: 'chat', haptic: 'success' });
      info.reload();
    } catch (e) { setAdFailed(true); toast.show(datingError(e), { tone: 'error' }); } finally { setAdBusy(false); }
  }
  function buyBundle() {
    setSpend({ amount: a.bundleCost, title: `Unlock ${a.bundleSize} messages`, description: `${a.bundleSize} more messages with ${name}.`, confirmLabel: `Unlock for ${a.bundleCost} coins`,
      run: () => dating.bundle(api, convId, newIdempotencyKey()), done: () => info.reload() });
  }
  async function unmatch() {
    setMenu(false);
    try { await dating.unmatch(api, d.matchId); toast.show(`You unmatched ${name}`, { icon: 'x' }); datingChanged(); nav.pop(); } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }
  async function block() {
    setMenu(false);
    try { await dating.block(api, d.otherUserId); toast.show(`${name} is blocked`, { icon: 'shield' }); nav.pop(); } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }
  async function answer(accept) {
    try { await dating.answerRequest(api, convId, accept); info.reload(); if (!accept) nav.pop(); } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }

  return (
    <View style={s.chatScreen}>
      <View style={s.chatTop}>
        <Pressable onPress={() => nav.pop()} hitSlop={12} style={s.roundBtn} accessibilityRole="button" accessibilityLabel="Back"><Icon name="chevron-left" size={18} color={colors.fg} /></Pressable>
        <Pressable onPress={() => d && d.otherUserId && nav.push('DatingProfileView', { userId: d.otherUserId, card: d.profile })} style={s.chatWho} accessibilityRole="button" accessibilityLabel={`${name}. View profile`}>
          <Avatar uri={photo} size={36} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.chatName} numberOfLines={1}>{name}</Text>
            <Text style={s.chatSub} numberOfLines={1}>Find Love · {d && d.status === 'request' ? 'message request' : 'match'}</Text>
          </View>
        </Pressable>
        {d && d.status === 'match' ? <GiftButton recipientId={d.otherUserId} name={name} context={{ type: 'chat', id: convId }} label="Gift" /> : null}
        <Pressable onPress={() => setMenu(true)} hitSlop={8} style={s.roundBtn} accessibilityRole="button" accessibilityLabel="Chat options"><Icon name="more" size={16} color={colors.fg} /></Pressable>
      </View>
      {social ? (
        <PressScale onPress={() => nav.push('UserProfile', { id: social.userId, name: social.displayName })} style={s.socialBar} accessibilityRole="button" accessibilityLabel={`Open ${social.displayName}’s profile in Socials`}>
          <Avatar uri={social.avatarUrl} size={24} />
          <Text style={s.socialText} numberOfLines={1}><Text style={{ fontWeight: '700' }}>{social.displayName}</Text>{social.handle ? ` · @${social.handle}` : ''}</Text>
          <Icon name="check-circle" size={13} color={colors.sky} />
          <Text style={s.linkText}>Socials</Text>
          <Icon name="chevron-right" size={14} color={colors.faint} />
        </PressScale>
      ) : null}
      {d && d.status === 'match' && a ? (
        <View style={s.freeBar}>
          <Icon name={a.unrestricted ? 'sparkles' : 'chat'} size={13} color={a.unrestricted ? colors.gold : ROSE} />
          <Text style={s.freeBarText}>{a.unrestricted ? `Unlimited messaging · Dating ${d.plan === 'vip' ? 'VIP' : 'Plus'}` : a.left > 0 ? `${plural(a.left, 'free message')} left` : 'Unlock messages to keep chatting'}</Text>
          {!a.unrestricted ? <PressScale onPress={() => nav.push('DatingPlans', { reason: 'messages' })} style={s.linkBtn}><Text style={s.linkText}>Unlimited with Plus</Text></PressScale> : null}
        </View>
      ) : null}
      {d && d.incomingRequest ? (
        <View style={s.reqBanner}>
          <Text style={s.reqBannerText}>{name} sent you a message request. Accept to match and reply.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Button small label="Accept" onPress={() => answer(true)} style={{ backgroundColor: ROSE, borderColor: ROSE }} />
            <Button small kind="ghost" label="Decline" onPress={() => answer(false)} />
          </View>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {convId ? <ChatScreen params={{ id: convId, to: name, embedded: true }} /> : null}
        {d && (d.status === 'request' && !d.incomingRequest) ? (
          <View style={s.lockPanel}><Text style={s.lockPanelTitle}>Request sent</Text><Text style={s.lockPanelBody}>You can keep chatting once {name} accepts.</Text></View>
        ) : null}
        {d && (d.status === 'closed' || d.status === 'declined') ? (
          <View style={s.lockPanel}><Text style={s.lockPanelTitle}>This conversation has ended</Text></View>
        ) : null}
        {a && a.needsUnlock && d.status === 'match' ? (
          <View style={s.lockPanel}>
            <Text style={s.lockPanelTitle}>{a.allowed ? `Keep talking with ${name}` : `Start your conversation with ${name}`}</Text>
            <Text style={s.lockPanelBody}>{a.adUnlocksLeft > 0 ? `Watch a short ad to unlock ${a.messagesPerAd} free messages (${a.adUnlocksLeft} of 2 left for this chat).` : `Unlock ${a.bundleSize} more messages with Dating Coins, or get unlimited messaging with Dating Plus.`}</Text>
            {a.adUnlocksLeft > 0 ? (
              <PressScale onPress={watchAd} disabled={adBusy} style={[s.unlockBtn, adBusy && ws.disabled]} accessibilityRole="button">
                {adBusy ? <ActivityIndicator color="#FFFFFF" /> : <><Icon name="play" size={14} color="#FFFFFF" fill="#FFFFFF" /><Text style={s.unlockBtnText}>{adFailed ? 'Try the ad again' : `Watch an ad · ${a.messagesPerAd} free messages`}</Text></>}
              </PressScale>
            ) : null}
            <PressScale onPress={buyBundle} style={[s.unlockGhost]} accessibilityRole="button">
              <Icon name="heart" size={14} color={ROSE} /><Text style={s.unlockGhostText}>{`${a.bundleSize} messages · ${a.bundleCost} Dating Coins`}</Text>
            </PressScale>
            <PressScale onPress={() => nav.push('DatingPlans', { reason: 'messages' })} style={s.linkBtn}><Text style={s.linkText}>Unlimited messaging with Dating Plus</Text></PressScale>
          </View>
        ) : null}
      </View>
      {spendSheet}
      <SafetyMenu visible={menu} name={name} onClose={() => setMenu(false)}
        onProfile={d && d.otherUserId ? () => { setMenu(false); nav.push('DatingProfileView', { userId: d.otherUserId, card: d.profile }); } : null}
        onTips={() => { setMenu(false); nav.push('DatingSettings', { section: 'safety' }); }}
        onUnmatch={d && d.matchId ? unmatch : null} onReport={() => { setMenu(false); setReporting(true); }} onBlock={block} />
      {d ? <ReportSheet visible={reporting} userId={d.otherUserId} name={name} onClose={() => setReporting(false)} onDone={() => nav.pop()} /> : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Dating Plus / VIP
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const FREE_FEATURES = [`Daily swipes and likes`, 'Matches and chat after you both say yes', 'First messages unlocked with a short ad', 'Block, report and hide anytime'];
export function DatingPlansScreen({ params = {} }) {
  const api = useApi();
  const toast = useToast();
  const home = useDatingHome();
  const { products } = useWalletProducts({ plans: true });
  const [buy, setBuy] = useState(null);
  const [busy, setBusy] = useState(false);
  const ent = home.data && home.data.plan;
  const sub = ent && ent.subscription && ent.subscription.hasAccess ? ent.subscription : null;
  const plus = products.find((p) => p.tier === 1);
  const vip = products.find((p) => p.tier >= 2);
  const why = { likes: 'See everyone who liked you', messages: 'Message your matches without ads or limits', undo: 'Undo a swipe you didn’t mean', filters: 'Filter by denomination and church involvement', location: 'Meet people in your own city', compat: 'Only see people who’d choose you too' }[params.reason];
  async function cancel() {
    if (!sub || busy) return;
    setBusy(true);
    try { await cancelSubscription(api, sub.id); walletChanged(); datingChanged(); toast.show(`Cancelled — you keep ${sub.title} until ${dateLabel(sub.currentPeriodEnd)}`, { icon: 'check' }); }
    catch (e) { toast.show(datingError(e), { tone: 'error' }); } finally { setBusy(false); }
  }
  const Plan = ({ p, tint, current }) => p ? (
    <View style={[s.planCard, { borderColor: alpha(tint, current ? 0.9 : 0.3) }, current && { borderWidth: 2 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="star" size={16} color={tint} fill={tint} />
        <Text style={[s.planName, { color: tint }]}>{p.title}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.planPrice}>{p.displayPrice}</Text>
      </View>
      {(p.benefits.features || []).map((f) => <View key={f} style={s.featRow}><Icon name="check" size={13} color={tint} strokeWidth={2.6} /><Text style={s.featText}>{f}</Text></View>)}
      {current ? <View style={[s.currentTag, { backgroundColor: alpha(tint, 0.12) }]}><Text style={[s.currentTagText, { color: tint }]}>Your plan</Text></View>
        : sub && sub.tier > p.tier ? <Text style={s.fieldHint}>Included in your plan.</Text>
        : <Button label={`Get ${p.title}`} onPress={() => setBuy(p.id)} style={{ marginTop: 12, backgroundColor: tint, borderColor: tint }} />}
    </View>
  ) : null;
  return (
    <Screen back title="Dating Plus & VIP" subtitle="Find Love">
      {why ? <Notice tint={ROSE} text={why} /> : null}
      {sub ? (
        <View style={s.statusCard}>
          <Text style={s.fieldLabel}>Your plan</Text>
          <Text style={s.statusTitle}>{sub.title}{sub.test ? ' · test' : ''}</Text>
          <Text style={s.rowSub}>{sub.renewsOn ? `Renews on ${dateLabel(sub.renewsOn)}` : `Ends on ${dateLabel(sub.accessUntil)} — renewal is off`}{sub.displayPrice ? ` · ${sub.displayPrice}` : ''}</Text>
          {sub.status === 'active' ? <Button kind="ghost" small label={busy ? 'Cancelling…' : 'Cancel renewal'} onPress={cancel} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
          {sub.manageUrl ? <Text style={s.fieldHint}>Google Play subscriptions are also managed in the Play Store.</Text> : sub.provider === 'paystack' && !sub.autoRenew && sub.status === 'active' ? <Text style={s.fieldHint}>Paid by bank transfer or USSD, so it doesn’t renew by itself — pay again before it ends to keep your plan.</Text> : null}
        </View>
      ) : null}
      <View style={[s.planCard, { borderColor: colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={[s.planName, { color: colors.fg }]}>Free</Text><View style={{ flex: 1 }} /><Text style={s.planPrice}>₦0</Text></View>
        {FREE_FEATURES.map((f) => <View key={f} style={s.featRow}><Icon name="check" size={13} color={colors.muted} /><Text style={s.featText}>{f}</Text></View>)}
        {!sub ? <View style={[s.currentTag, { backgroundColor: colors.raised }]}><Text style={s.currentTagText}>Your plan</Text></View> : null}
      </View>
      <Plan p={plus} tint={colors.primary} current={sub && sub.tier === 1} />
      <Plan p={vip} tint={colors.gold} current={sub && sub.tier >= 2} />
      <Text style={s.fieldHint}>Plans renew monthly until you cancel; you keep access until the end of the paid month. Payment is through Paystack: card renews automatically; bank transfer and USSD don’t renew (we remind you). Matches always depend on mutual interest — no plan guarantees a match.</Text>
      {buy ? <BuyCoinsSheet visible plans initialProductId={buy} onClose={() => setBuy(null)} onPurchased={() => { setBuy(null); datingChanged(); }} /> : null}
    </Screen>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Boost & Spotlight
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function DatingBoostScreen() {
  const api = useApi();
  const home = useDatingHome();
  const st = useDatingGet('/dating/boost');
  const [setSpend, spendSheet] = useSpend();
  const [left, setLeft] = useState(0);
  const [spotLeft, setSpotLeft] = useState(0);
  const active = st.data && st.data.active;
  const spot = st.data && st.data.spotlight;
  useEffect(() => {
    setLeft(active ? active.secondsLeft : 0); setSpotLeft(spot ? spot.secondsLeft : 0);
    const t = setInterval(() => { setLeft((x) => { if (x === 1) st.reload(); return Math.max(0, x - 1); }); setSpotLeft((x) => Math.max(0, x - 1)); }, 1000);
    const poll = setInterval(() => st.reload(), 30000); // live stats
    return () => { clearInterval(t); clearInterval(poll); };
  }, [active && active.id, active && active.secondsLeft, spot && spot.id]);
  const d = home.data;
  if (!d) return <Screen back title="Boost"><ActivityIndicator color={ROSE} style={{ marginTop: 40 }} /></Screen>;
  const freeBoosts = d.balances.dating_boosts || 0;
  function start(o) {
    const free = o.kind === 'boost_30m' && freeBoosts > 0;
    const key = newIdempotencyKey();
    setSpend({
      amount: free ? 1 : d.prices[o.kind], wallet: free ? 'dating_boosts' : 'dating_coins', title: `Boost · ${o.label}`,
      description: 'More people in your preferences see you near the top of their stack. Matches still depend on mutual interest.',
      confirmLabel: free ? 'Use a free boost' : `Boost for ${d.prices[o.kind]} coins`,
      run: () => dating.boost(api, o.kind, key, true), done: () => { st.reload(); home.reload(); },
    });
  }
  const live = (b, secs, title) => (b && secs > 0 ? (
    <View style={s.boostLive}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pulse><Icon name="flame" size={18} color={ROSE} /></Pulse>
        <Text style={s.boostLiveTitle}>{title}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.boostClock}>{countdown(secs)}</Text>
      </View>
      <Text style={s.rowSub}>Ends automatically at {new Date(b.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</Text>
      <View style={s.statsRow}>
        {[['Views', b.stats.views], ['Likes', b.stats.likes], ['Matches', b.stats.matches]].map(([l, v]) => (
          <View key={l} style={s.statBox}><Text style={s.statNum}>{v}</Text><Text style={s.statLabel}>{l}</Text></View>
        ))}
      </View>
    </View>
  ) : null);
  return (
    <Screen back title="Boost your profile" subtitle="Find Love" right={<WalletBalancePill wallet="dating_coins" />}>
      {live(active, left, 'BOOSTED')}
      {live(spot, spotLeft, 'SPOTLIGHT')}
      {!active && !spot ? <Text style={s.viewBio}>Be seen by more people who match your preferences for a while. Your profile shows a small “Boosted” label. Blocks and everyone’s preferences still apply.</Text> : null}
      {freeBoosts > 0 ? <Notice tint={colors.gold} text={`You have ${plural(freeBoosts, 'free boost')} from Dating VIP (30 minutes each).`} /> : null}
      {BOOST_OPTIONS.map((o) => (
        <PressScale key={o.kind} onPress={() => start(o)} style={s.boostOpt} scaleTo={0.98} accessibilityRole="button">
          <View style={[s.boostIcon, o.kind === 'spotlight_24h' && { backgroundColor: colors.cardGold }]}><Icon name={o.kind === 'spotlight_24h' ? 'sun' : 'flame'} size={18} color={o.kind === 'spotlight_24h' ? colors.gold : ROSE} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowName}>{o.label}</Text>
            <Text style={s.rowSub}>{o.note}</Text>
          </View>
          <Text style={s.boostPrice}>{o.kind === 'boost_30m' && freeBoosts > 0 ? 'Free' : `${d.prices[o.kind]} coins`}</Text>
        </PressScale>
      ))}
      <Text style={s.fieldHint}>A new boost starts when the current one ends. Boosts never show you to people you’ve blocked or who are outside your preferences, and no boost guarantees a match.</Text>
      {spendSheet}
    </Screen>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Safety & settings
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const SAFETY_TIPS = [
  ['shield', 'Keep chats on BibleNestra', 'Take your time before sharing your phone number, social accounts or address.'],
  ['coin', 'Never send money', 'Anyone who asks for money, gift cards or crypto — however good the story — should be reported.'],
  ['users', 'Meet in public, tell a friend', 'For a first meeting choose a busy public place (church events are great) and tell someone where you’ll be.'],
  ['heart', 'Go at your own pace', 'You never owe anyone a reply, a photo or a meeting. Unmatch or block whenever you want.'],
  ['quote', 'Report what feels wrong', 'Fake profiles, pressure, inappropriate photos or anyone who may be under 18 — report it and our team will review it.'],
  ['cross', 'Pray and seek counsel', 'Invite trusted friends, family or your pastor into what God is doing in your relationship.'],
];
export function DatingSettingsScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const home = useDatingHome();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = home.data && home.data.profile;
  async function togglePause(v) { try { await dating.pause(api, v); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } }
  async function del() {
    try { await dating.deleteProfile(api); setConfirmDelete(false); toast.show('Your dating profile was deleted', { icon: 'trash' }); nav.pop(); } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }
  return (
    <Screen back title="Safety & settings" subtitle="Find Love">
      <Text style={s.sectionLabel}>Safety tips</Text>
      {SAFETY_TIPS.map(([icon, t, b]) => (
        <View key={t} style={s.tipRow}><View style={s.tipIcon}><Icon name={icon} size={16} color={ROSE} /></View><View style={{ flex: 1 }}><Text style={s.rowName}>{t}</Text><Text style={s.rowSub}>{b}</Text></View></View>
      ))}
      {p ? (
        <>
          <Text style={[s.sectionLabel, { marginTop: 22 }]}>Your profile</Text>
          <View style={s.settingRow}><View style={{ flex: 1 }}><Text style={s.rowName}>Hide my profile</Text><Text style={s.rowSub}>Nobody new sees you. Matches and chats stay.</Text></View><Switch value={p.status === 'paused'} onValueChange={togglePause} disabled={p.status === 'banned'} /></View>
          <PressScale onPress={() => nav.push('DatingProfileEdit')} style={s.settingRow}><View style={{ flex: 1 }}><Text style={s.rowName}>Edit profile & preferences</Text></View><Icon name="chevron-right" size={16} color={colors.faint} /></PressScale>
          <PressScale onPress={() => nav.push('DatingPlans')} style={s.settingRow}><View style={{ flex: 1 }}><Text style={s.rowName}>Dating Plus & VIP</Text></View><Icon name="chevron-right" size={16} color={colors.faint} /></PressScale>
          <PressScale onPress={() => nav.push('Wallet', { focus: 'dating_coins' })} style={s.settingRow}><View style={{ flex: 1 }}><Text style={s.rowName}>Dating Coins history</Text></View><Icon name="chevron-right" size={16} color={colors.faint} /></PressScale>
          <PressScale onPress={p.verified ? undefined : () => nav.push('DatingVerify')} disabled={!!p.verified} style={s.settingRow} accessibilityRole="button">
            <View style={{ flex: 1 }}><Text style={s.rowName}>Verified badge</Text><Text style={s.rowSub}>{p.verified ? 'Your profile is verified.' : verifyStatusText(p.verification)}</Text></View>
            {p.verified ? <Icon name="check-circle" size={18} color={colors.sky} /> : <Icon name="chevron-right" size={16} color={colors.faint} />}
          </PressScale>
          <PressScale onPress={() => setConfirmDelete(true)} style={[s.settingRow, { borderBottomWidth: 0 }]}><Text style={[s.rowName, { color: colors.negative }]}>Delete my dating profile</Text></PressScale>
        </>
      ) : null}
      <WalletSheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your dating profile?" subtitle="Your dating profile, photos, likes and matches are removed and your Find Love chats close. Your BibleNestra account, social profile and Dating Coins stay. This can’t be undone.">
        <PressScale onPress={del} style={[ws.primary, { backgroundColor: colors.negative }]}><Text style={ws.primaryText}>Delete dating profile</Text></PressScale>
        <PressScale onPress={() => setConfirmDelete(false)} style={ws.ghost}><Text style={ws.ghostText}>Keep it</Text></PressScale>
      </WalletSheet>
    </Screen>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Verified badge: a live selfie with the code + gesture shown here, and a photo of a government ID → our team decides.
// Optional (never needed to message). The two images are private to the member and the team, deleted after the decision.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function verifyStatusText(v) {
  if (!v || v.status === 'expired') return 'Get a blue tick: a quick selfie and a photo of your ID.';
  if (v.status === 'draft') return 'Started — finish your selfie and ID.';
  if (v.status === 'pending') return 'Our team is checking your photos.';
  if (v.status === 'rejected') return `Not approved${v.rejectReason ? `: ${v.rejectReason}` : ''}. You can try again.`;
  return 'Your profile is verified.';
}
const ID_TYPE_LABELS = { nin: 'National ID (NIN)', passport: 'Passport', drivers_licence: 'Driver’s licence', voters_card: 'Voter’s card', other: 'Other ID' };
export function DatingVerifyScreen() {
  const api = useApi();
  const toast = useToast();
  const home = useDatingHome();
  const p = home.data && home.data.profile;
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [idPhoto, setIdPhoto] = useState(null);
  const [idType, setIdType] = useState(null);
  useEffect(() => { if (p && v === null) setV(p.verification || false); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <Screen back title="Get verified"><ActivityIndicator color={ROSE} style={{ marginTop: 40 }} /></Screen>;
  const status = p.verified ? 'approved' : v ? v.status : null;
  async function start() {
    setBusy('start');
    try { const r = await dating.startVerification(api); setV(r.verification); setSelfie(null); setIdPhoto(null); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } finally { setBusy(null); }
  }
  async function capture(kind, fromGallery) {
    if (busy) return;
    try {
      const photo = fromGallery ? (await pickPhotos(1))[0] : await takeLivePhoto({ front: kind === 'selfie' });
      if (!photo) return;
      setBusy(kind);
      const r = await dating.uploadVerification(api, kind, photo);
      setV(r.verification);
      if (kind === 'selfie') setSelfie(photo.uri); else setIdPhoto(photo.uri);
    } catch (e) { toast.show(datingError(e, 'Couldn’t upload that photo'), { tone: 'error' }); } finally { setBusy(null); }
  }
  async function submit() {
    setBusy('submit');
    try { const r = await dating.submitVerification(api, idType); setV(r.verification); toast.show('Sent to our team — we’ll let you know', { icon: 'shield', haptic: 'success' }); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } finally { setBusy(null); }
  }
  const privacy = 'Your selfie and ID are seen only by you and the BibleNestra team, and are deleted as soon as we decide. An automatic check compares them with your profile photos to help our team; a person makes the decision. You don’t need to be verified to message anyone.';
  return (
    <Screen back title="Get verified" subtitle="Find Love">
      {status === 'approved' ? <Notice tint={colors.sky} text="Your profile is verified. Others see a blue tick next to your name." /> : null}
      {status === 'pending' ? <Notice text="Thank you! Our team is checking your selfie and ID. You’ll get a notification when it’s done." /> : null}
      {status === 'rejected' ? <Notice tint={colors.negative} text={`Your last request wasn’t approved${v.rejectReason ? `: ${v.rejectReason}` : ''}. You can try again with clear photos.`} /> : null}
      {status !== 'approved' && status !== 'pending' && status !== 'draft' ? (
        <>
          <Text style={s.rowSub}>A blue tick shows people you are who your photos say. It takes two photos:</Text>
          <View style={s.tipRow}><View style={s.tipIcon}><Icon name="user" size={16} color={ROSE} /></View><View style={{ flex: 1 }}><Text style={s.rowName}>A live selfie</Text><Text style={s.rowSub}>Holding a code we show you, written on paper, while making a hand gesture.</Text></View></View>
          <View style={s.tipRow}><View style={s.tipIcon}><Icon name="shield" size={16} color={ROSE} /></View><View style={{ flex: 1 }}><Text style={s.rowName}>A photo of your ID</Text><Text style={s.rowSub}>National ID (NIN), passport, driver’s licence or voter’s card.</Text></View></View>
          <Text style={[s.fieldHint, { marginTop: 10 }]}>{privacy}</Text>
          <Button label={busy === 'start' ? 'Starting…' : 'Get my code'} onPress={start} disabled={!!busy} style={{ marginTop: 16, backgroundColor: ROSE, borderColor: ROSE }} />
        </>
      ) : null}
      {status === 'draft' ? (
        <>
          <View style={s.verifyBox}>
            <Text style={[s.rowSub, { textAlign: 'center' }]}>Write this code on a piece of paper</Text>
            <Text style={s.verifyCode} accessibilityLabel={`Code ${v.code.split('').join(' ')}`}>{v.code}</Text>
            <Text style={[s.rowName, { textAlign: 'center' }]}>Hold it up and make this gesture: {v.gestureLabel}</Text>
            <Text style={[s.fieldHint, { textAlign: 'center' }]}>{v.expiresAt ? `Use this code by ${new Date(v.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}</Text>
          </View>
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>1 · Your selfie</Text>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 8 }}>
            {selfie || v.hasSelfie ? (selfie ? <Image source={{ uri: selfie }} style={s.verifyThumb} /> : <View style={[s.verifyThumb, s.center, { minHeight: 0 }]}><Icon name="check" size={22} color={colors.positive} /></View>) : null}
            <Button small label={busy === 'selfie' ? 'Uploading…' : v.hasSelfie ? 'Retake selfie' : 'Take selfie'} onPress={() => capture('selfie')} disabled={!!busy} />
          </View>
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>2 · Your ID</Text>
          <Choice items={Object.keys(ID_TYPE_LABELS)} labels={ID_TYPE_LABELS} value={idType} onChange={setIdType} />
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {idPhoto || v.hasId ? (idPhoto ? <Image source={{ uri: idPhoto }} style={s.verifyThumb} /> : <View style={[s.verifyThumb, s.center, { minHeight: 0 }]}><Icon name="check" size={22} color={colors.positive} /></View>) : null}
            <Button small label={busy === 'id' ? 'Uploading…' : v.hasId ? 'Retake ID photo' : 'Photograph your ID'} onPress={() => capture('id')} disabled={!!busy} />
            <Button small kind="ghost" label="Choose from gallery" onPress={() => capture('id', true)} disabled={!!busy} />
          </View>
          <Text style={[s.fieldHint, { marginTop: 14 }]}>{privacy}</Text>
          <Button label={busy === 'submit' ? 'Sending…' : 'Send for review'} onPress={submit} disabled={!!busy || !v.hasSelfie || !v.hasId || !idType} style={{ marginTop: 14, backgroundColor: ROSE, borderColor: ROSE }} />
        </>
      ) : null}
    </Screen>
  );
}

// ─── styles ────────────────────────────────────────────────────────────────────────────────────────────────────────
const CARD_H = 470;
const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 200 },
  tabPad: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 110 },
  loveBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 12 },
  roundBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  planBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  planBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  pausedBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: colors.cardGold },
  pausedText: { flex: 1, fontSize: 12.5, color: colors.goldMuted, fontWeight: '600' },
  boostBar: { flexDirection: 'row', alignItems: 'center', gap: 7, marginHorizontal: 18, marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.cardRose },
  boostBarLabel: { fontSize: 11, fontWeight: '900', color: ROSE, letterSpacing: 0.8 },
  boostBarText: { flex: 1, fontSize: 12, color: colors.muted },
  introCard: { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 22, alignItems: 'center', ...shadow.sm },
  introIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' },
  introEyebrow: { marginTop: 12, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: ROSE, textTransform: 'uppercase' },
  introTitle: { fontFamily: fonts.serifBold, fontSize: 25, color: colors.fg, textAlign: 'center', marginTop: 4 },
  introBody: { fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center', marginTop: 8 },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', marginTop: 10 },
  introRowText: { flex: 1, fontSize: 13.5, color: colors.fg },
  card: { height: CARD_H, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.raised, ...shadow.md },
  cardBehind: { position: 'absolute', left: 8, right: 8, top: 10, transform: [{ scale: 0.97 }], opacity: 0.6 },
  cardShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 230, backgroundColor: 'rgba(21,23,43,0.0)', ...Platform.select({ web: { backgroundImage: 'linear-gradient(180deg, rgba(21,23,43,0) 0%, rgba(21,23,43,0.78) 72%)' }, default: { backgroundColor: 'rgba(21,23,43,0.45)', height: 190 } }) },
  cardTopRow: { position: 'absolute', top: 22, left: 12, right: 12, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  cardInfo: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  cardName: { fontFamily: fonts.serifBold, fontSize: 28, color: '#FFFFFF' },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cardMeta: { fontSize: 13.5, color: 'rgba(255,255,255,0.9)' },
  cardChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  cardBio: { fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.92)', marginTop: 8 },
  dots: { position: 'absolute', top: 8, left: 10, right: 10, flexDirection: 'row', gap: 4 },
  dot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#FFFFFF' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: '100%' },
  chipText: { fontSize: 11.5, fontWeight: '700' },
  vip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.gold },
  vipText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.6 },
  stamp: { position: 'absolute', top: 40, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 3, backgroundColor: 'rgba(255,255,255,0.85)' },
  stampLike: { left: 20, borderColor: colors.positive, transform: [{ rotate: '-14deg' }] },
  stampPass: { right: 20, borderColor: colors.negative, transform: [{ rotate: '14deg' }] },
  stampText: { fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', marginTop: 12 },
  actBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  actBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  actBadgeText: { fontSize: 9.5, fontWeight: '900', color: '#FFFFFF' },
  swipeInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  swipeInfoText: { fontSize: 12.5, color: colors.muted },
  linkBtn: { paddingVertical: 4 },
  linkText: { fontSize: 12.5, fontWeight: '700', color: ROSE },
  hint: { fontSize: 11.5, color: colors.faint, textAlign: 'center', marginTop: 6 },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 10, textAlign: 'center' },
  emptyBody: { fontSize: 13.5, lineHeight: 19, color: colors.muted, textAlign: 'center', marginTop: 6 },
  matchWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26, backgroundColor: 'rgba(21,23,43,0.9)' },
  matchEyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.6, color: colors.goldLight, textTransform: 'uppercase' },
  matchTitle: { fontFamily: fonts.serifBold, fontSize: 28, color: colors.nightFg, textAlign: 'center', marginTop: 6 },
  matchPhotos: { flexDirection: 'row', marginTop: 22, alignItems: 'center', justifyContent: 'center' },
  matchPhotoL: { borderWidth: 3, borderColor: colors.nightFg, transform: [{ rotate: '-6deg' }] },
  matchPhotoR: { borderWidth: 3, borderColor: colors.nightFg, marginLeft: -16, transform: [{ rotate: '6deg' }] },
  matchHeart: { position: 'absolute', bottom: -10, alignSelf: 'center', width: 40, height: 40, borderRadius: 20, backgroundColor: ROSE, alignItems: 'center', justifyContent: 'center' },
  matchBody: { fontSize: 13.5, lineHeight: 19, color: colors.nightMuted, textAlign: 'center', marginTop: 22 },
  lockCard: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20, alignItems: 'center' },
  blurRow: { flexDirection: 'row', gap: 8 },
  blurTile: { width: 74, height: 96, borderRadius: 14, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' },
  lockTitle: { fontFamily: fonts.serifBold, fontSize: 21, color: colors.fg, marginTop: 14, textAlign: 'center' },
  lockBody: { fontSize: 13.5, color: colors.muted, marginTop: 4, textAlign: 'center' },
  paneNote: { fontSize: 12.5, color: colors.muted, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridTile: { width: '48%', height: 210, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.raised },
  gridImg: { ...StyleSheet.absoluteFillObject },
  gridTag: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(53,109,156,0.85)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  gridTagText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  gridFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: 'rgba(21,23,43,0.45)' },
  gridName: { flex: 1, color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  gridLike: { width: 30, height: 30, borderRadius: 15, backgroundColor: ROSE, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1, color: colors.faint, textTransform: 'uppercase', marginBottom: 8, marginTop: 6 },
  reqCard: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.cardRose, marginBottom: 10 },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.rule },
  rowName: { fontSize: 15, fontWeight: '700', color: colors.fg },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
  unread: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: ROSE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: colors.fg },
  fieldHint: { fontSize: 12, color: colors.muted, marginTop: 3, marginBottom: 6, lineHeight: 17 },
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.cardGold },
  lockPillText: { fontSize: 10.5, fontWeight: '800', color: colors.goldMuted },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 },
  choice: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceOn: { backgroundColor: ROSE, borderColor: ROSE },
  choiceText: { fontSize: 13, color: colors.fg, fontWeight: '600' },
  choiceTextOn: { color: '#FFFFFF' },
  promptBox: { marginTop: 8, padding: 10, borderRadius: 14, backgroundColor: colors.raised },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  confirmRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 22 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  confirmText: { flex: 1, fontSize: 13.5, color: colors.fg, lineHeight: 19 },
  err: { color: colors.negative, fontSize: 13, marginTop: 12 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  photoCell: { width: '31%', aspectRatio: 0.78, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.raised },
  photoImg: { ...StyleSheet.absoluteFillObject },
  photoState: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  photoStateText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  photoTools: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4 },
  photoTool: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  photoAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: alpha(ROSE, 0.5), backgroundColor: colors.cardRose },
  photoAddText: { fontSize: 11.5, fontWeight: '700', color: ROSE, marginTop: 4 },
  gallery: { height: 420, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.raised },
  galleryItem: { width: 339, height: 420, backgroundColor: colors.raised },
  viewName: { fontFamily: fonts.serifBold, fontSize: 28, color: colors.fg },
  viewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  viewBio: { fontSize: 15, lineHeight: 22, color: colors.fg, marginTop: 14 },
  promptCard: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  promptQ: { fontSize: 12.5, fontWeight: '700', color: colors.muted },
  promptA: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, marginTop: 4 },
  viewActions: { flexDirection: 'row', gap: 8, marginTop: 20 },
  reqInput: { marginTop: 12, minHeight: 96, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 12, fontSize: 15, color: colors.fg, textAlignVertical: 'top' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.rule },
  menuText: { fontSize: 15, fontWeight: '600', color: colors.fg },
  chatScreen: { flex: 1, backgroundColor: colors.screen },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.rule, backgroundColor: colors.screen },
  chatWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  chatName: { fontSize: 16, fontWeight: '800', color: colors.fg },
  chatSub: { fontSize: 12, color: ROSE, fontWeight: '600' },
  freeBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.cardRose },
  freeBarText: { flex: 1, fontSize: 12.5, color: colors.fg, fontWeight: '600' },
  socialBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.rule, backgroundColor: colors.surface },
  socialText: { flex: 1, minWidth: 0, fontSize: 12.5, color: colors.fg },
  verifyCode: { fontSize: 40, fontWeight: '800', letterSpacing: 8, color: ROSE, textAlign: 'center', marginVertical: 6, fontFamily: fonts.mono || undefined },
  verifyBox: { padding: 16, borderRadius: radius.lg || 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: 12 },
  verifyThumb: { width: 96, height: 120, borderRadius: 10, backgroundColor: colors.cardRose },
  reqBanner: { padding: 12, backgroundColor: colors.cardGold },
  reqBannerText: { fontSize: 13, color: colors.fg },
  lockPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 22, backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: colors.border, alignItems: 'center', ...shadow.lg },
  lockPanelTitle: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, textAlign: 'center' },
  lockPanelBody: { fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center', marginTop: 4 },
  unlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', marginTop: 12, paddingVertical: 13, borderRadius: 14, backgroundColor: ROSE },
  unlockBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14.5 },
  unlockGhost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', marginTop: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: alpha(ROSE, 0.4), backgroundColor: colors.surface },
  unlockGhostText: { color: ROSE, fontWeight: '700', fontSize: 14 },
  statusCard: { padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  statusTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 2 },
  planCard: { padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, marginBottom: 12 },
  planName: { fontFamily: fonts.serifBold, fontSize: 21 },
  planPrice: { fontSize: 15, fontWeight: '800', color: colors.fg },
  featRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 7 },
  featText: { flex: 1, fontSize: 13.5, color: colors.fg, lineHeight: 18 },
  currentTag: { alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  currentTagText: { fontSize: 12, fontWeight: '800', color: colors.muted },
  boostLive: { padding: 16, borderRadius: 18, backgroundColor: colors.cardRose, marginBottom: 12 },
  boostLiveTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 1, color: ROSE },
  boostClock: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.fg },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surface },
  statNum: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg },
  statLabel: { fontSize: 11.5, color: colors.muted },
  boostOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 10 },
  boostIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' },
  boostPrice: { fontSize: 14, fontWeight: '800', color: ROSE },
  tipRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.rule },
  tipIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.rule },
});
