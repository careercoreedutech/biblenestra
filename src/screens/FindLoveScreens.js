// FIND LOVE (brief §9, client spec §5 / §6 / §7 / §13 / §14) — Christian dating inside Discover › Find Love.
//   FindLoveTab (rendered by DiscoverScreen): intro → profile onboarding, then Discover (card stack) | Likes | Matches.
//   Screens: DatingProfileEdit · DatingProfileView · DatingChat (the app's chat, embedded, + free-message meter / ad unlock)
//            DatingPlans · DatingBoost · DatingSettings · DatingVerify (components/findlove/AccountScreens.js, re-exported here).
// Every Dating Coin use goes through <ConfirmSpend/> (cost + balance after) and sends an idempotency key. The rewarded ad is
// only ever shown when the member taps "Watch an ad" — never in the middle of a conversation.
// Look & feel: the "Covenant" sub-brand in components/findlove/ (wine / blush / gold over parchment, Newsreader serif).
// Server: backend/src/routes/dating.js · notes: scratch/monetisation/dating.md.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Input } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp } from '../components/Motion';
import { fonts } from '../theme';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { useStore } from '../store';
import { useAds } from '../ads/Ads';
import { pickPhotos, uploadImage } from '../api/media';
import { getScopeMsgs, dmScope } from '../chat/messages';
import { WalletBalancePill, BuyCoinsSheet, WalletSheet } from '../components/wallet';
import { ws } from '../components/wallet/WalletSheet';
import {
  useDatingHome, useDatingGet, datingChanged, dating, datingError, newIdempotencyKey, INTENTION_LABELS, DENOMINATIONS, INVOLVEMENT, PROMPTS,
  REPORT_REASONS, countdown,
} from '../api/dating';
import { ChatScreen } from './ChatScreen';
import { BubbleTheme } from '../components/chat/MessageKit';
// GIFTS (component owned by the Virtual Gifts agent): <GiftButton/> in the dating chat header. Gifts are posted into the
// chat by the gifts route (kind 'gift'), which never uses the free-message allowance (lib/dating.js datingSendGuard).
import { GiftButton } from '../components/gifts';
import { love, grad, type, lshadow, haptic, plural, firstPhoto, ND } from '../components/findlove/theme';
import { Glow, Grain, Filigree, VerifiedSeal, Crown, HeartShape, LoveArt, Sparkle } from '../components/findlove/illustrations';
import {
  LoveButton, CostPill, LoveChip, Avatar, RingAvatar, PlanBadge, RoundBtn, LoveTabs, LoveScreen, SectionCard, LoveBanner, LoveState, Skeleton, Choice, st as pst,
} from '../components/findlove/parts';
import { CardFace, Stamp } from '../components/findlove/SwipeCard';
import { ActionBtn, ActionBar } from '../components/findlove/ActionBar';
import { MatchCelebration } from '../components/findlove/MatchCelebration';
import { useSpend } from '../components/findlove/useSpend';
import { FiltersSheet, activeFilterCount, INTEREST_OPTIONS } from '../components/findlove/FiltersSheet'; // FIND LOVE HUB: saved discovery filters
import { ExampleStrip } from '../components/findlove/examples'; // FIND LOVE HUB: example profiles (presentation only)

export { DatingPlansScreen, DatingBoostScreen, DatingSettingsScreen, DatingVerifyScreen } from '../components/findlove/AccountScreens';
import { colors } from '../theme'; // APPEARANCE (item 14): palette tokens
import { isDarkScheme } from '../design/palette';

const DATING_BUBBLES = { mine: grad.wine, theirs: colors.surface, theirsBorder: love.blushLine };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Discover › Find Love
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function FindLoveTab({ nav, fullscreen = false, initialTab = 'discover' }) {
  const api = useApi();
  const home = useDatingHome();
  const [tab, setTab] = useState(initialTab);
  const [buying, setBuying] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stackKey, setStackKey] = useState(0); // bumping it reloads the card stack after the filters change
  const d = home.data;
  if (!api.online) {
    return (
      <ScrollView contentContainerStyle={s.tabPad}>
        <LoveIntro onStart={null} note="Find Love needs a BibleNestra account. Sign in to create your dating profile." />
      </ScrollView>
    );
  }
  if (!home.loaded && !d) {
    return (
      <View style={[s.tabPad, { paddingTop: 12 }]}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>{[70, 90].map((w) => <View key={w} style={{ width: w, height: 34, borderRadius: 17, backgroundColor: love.blush }} />)}</View>
        <Skeleton.Card height={440} />
      </View>
    );
  }
  if (home.error && !d) {
    return (
      <ScrollView contentContainerStyle={s.tabPad}>
        <LoveState art="error" title="Find Love didn’t load" body={datingError(home.error)}>
          <LoveButton label="Try again" icon="repost" onPress={home.reload} />
        </LoveState>
      </ScrollView>
    );
  }
  if (!d.profile) {
    return (
      <ScrollView contentContainerStyle={s.tabPad}>
        <LoveIntro onStart={() => nav.push('DatingProfileEdit', { onboarding: true })} />
      </ScrollView>
    );
  }
  const p = d.profile;
  const plan = d.plan.plan;
  const boosting = !!(d.boost && d.boost.active);
  const matchCount = d.counts && (d.counts.matches || d.counts.requests) ? d.counts.matches + d.counts.requests : 0;
  return (
    <View style={{ flex: 1 }}>
      <View style={s.loveBar}>
        <PlanBadge plan={plan} onPress={() => nav.push('DatingPlans')} />
        <WalletBalancePill wallet="dating_coins" onPress={() => setBuying(true)} />
        <View style={{ flex: 1 }} />
        <RoundBtn icon="flame" label={boosting ? 'Boosted. See your boost' : 'Boost your profile'} active={boosting} onPress={() => nav.push('DatingBoost')} />
        <PressScale onPress={() => nav.push('DatingProfileEdit')} scaleTo={0.9} accessibilityRole="button" accessibilityLabel="Edit my dating profile" hitSlop={4}>
          <RingAvatar uri={firstPhoto(p)} size={36} ring={2} gap={1.5} />
        </PressScale>
        <RoundBtn icon="shield" label="Safety and settings" onPress={() => nav.push('DatingSettings')} />
      </View>
      <View style={{ paddingHorizontal: 18, gap: 8 }}>
        {p.status === 'banned' ? <View style={{ marginTop: 10 }}><LoveBanner tone="danger" icon="lock" text={`Your Find Love profile is suspended${p.banReason ? `: ${p.banReason}` : ''}. Contact support if you think this is a mistake.`} /></View> : null}
        {p.status === 'paused' ? <View style={{ marginTop: 10 }}><LoveBanner icon="lock" text="Your profile is hidden. Tap to show it again." onPress={() => dating.pause(api, false)} /></View> : null}
        {p.underReview && p.status === 'active' ? <View style={{ marginTop: 10 }}><LoveBanner icon="shield" text="Your profile is hidden from Discover while our team reviews some reports. You can still chat with your matches." /></View> : null}
        {p.status === 'active' && !p.visible && !p.underReview ? (
          <View style={{ marginTop: 10 }}><LoveBanner icon="image" text={p.photos.length ? 'Your photo is being reviewed — others will see you once it’s approved.' : 'Add a photo so others can see you.'} onPress={() => nav.push('DatingProfileEdit')} /></View>
        ) : null}
        {boosting ? <BoostBar boost={d.boost.active} onPress={() => nav.push('DatingBoost')} /> : null}
      </View>
      <View style={{ paddingHorizontal: 18, paddingTop: 12 }}>
        <LoveTabs value={tab} onChange={setTab} options={[
          { id: 'discover', label: 'Discover' },
          { id: 'likes', label: 'Likes', count: d.likes && d.likes.count ? d.likes.count : 0 },
          { id: 'matches', label: 'Matches', count: matchCount },
          ...(fullscreen ? [{ id: 'profile', label: 'Profile' }] : []),
        ]} />
      </View>
      {tab === 'discover' ? (p.underReview
        ? <ScrollView contentContainerStyle={s.tabPad}><LoveState art="shield" title="Discover is paused for you" body="While our team reviews reports about your profile, you won’t see new people and they won’t see you. Your matches and chats stay open." /></ScrollView>
        : <DiscoverStack key={stackKey} nav={nav} home={d} onFilters={() => setFiltersOpen(true)} filterCount={activeFilterCount(p.prefs)} />)
        : tab === 'likes' ? <LikesPane nav={nav} home={d} /> : tab === 'profile' ? <ProfilePane nav={nav} home={d} onFilters={() => setFiltersOpen(true)} /> : <MatchesPane nav={nav} />}
      {buying ? <BuyCoinsSheet visible wallet="dating_coins" onClose={() => setBuying(false)} onPurchased={() => datingChanged()} /> : null}
      <FiltersSheet visible={filtersOpen} home={d} onClose={() => setFiltersOpen(false)} onSaved={() => setStackKey((k) => k + 1)} />
    </View>
  );
}

function LoveIntro({ onStart, note }) {
  return (
    <FadeInUp style={[s.intro, lshadow.md]}>
      <LinearGradient colors={['#422819', '#2D1B10', '#291B12']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Grain width={460} height={900} opacity={0.06} count={140} />
      <Glow size={380} color={love.roseBright} opacity={0.45} style={{ top: -150, left: -60 }} />
      <Glow size={260} color={love.goldBright} opacity={0.18} style={{ bottom: -80, right: -90 }} />
      <View style={s.introMedal}>
        <LinearGradient colors={grad.gold} style={[StyleSheet.absoluteFill, { borderRadius: 38 }]} />
        <View style={s.introMedalInner}><LinearGradient colors={grad.heart} style={[StyleSheet.absoluteFill, { borderRadius: 33 }]} /><HeartShape size={32} color="#FFFFFF" /></View>
      </View>
      <Text style={s.introEyebrow}>Find Love</Text>
      <Text style={s.introTitle}>Meaningful Christian relationships</Text>
      <Text style={s.introAccent}>built on faith, hope and love</Text>
      <Filigree width={190} color={love.goldBright} style={{ marginTop: 12 }} />
      <Text style={s.introBody}>Meet believers who share your faith and your hopes for marriage and family. Your dating profile is separate from your social profile, and nothing you do here appears in Socials.</Text>
      <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
        {[['shield', 'Adults 18+ only · block, report and hide anytime'], ['map-pin', 'City-level location only — never your exact place'], ['chat', 'Chat after you both say yes'], ['cross', 'Faith details front and centre']].map(([icon, t], i) => (
          <FadeInUp key={t} index={i + 2} distance={8} style={s.introRow}>
            <View style={s.introRowIcon}><Icon name={icon} size={15} color={love.goldBright} /></View>
            <Text style={s.introRowText}>{t}</Text>
          </FadeInUp>
        ))}
      </View>
      <Text style={s.introVerse}>“Love is patient, love is kind.”</Text>
      <Text style={s.introRef}>1 Corinthians 13:4</Text>
      {note ? (
        <View style={s.introNote}><Icon name="lock" size={14} color={love.goldBright} /><Text style={s.introNoteText}>{note}</Text></View>
      ) : <LoveButton label="Create my dating profile" icon="heart" kind="gold" onPress={onStart} style={{ marginTop: 18 }} />}
      <View style={{ alignSelf: 'stretch', marginHorizontal: -20 }}><ExampleStrip /></View>
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
    <PressScale onPress={onPress} scaleTo={0.98} style={[s.boostBar, lshadow.sm]} accessibilityRole="button" accessibilityLabel={`Boosted, ${countdown(left)} left`}>
      <LinearGradient colors={grad.wine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <Icon name="flame" size={15} color={love.goldBright} />
      <Text style={s.boostBarLabel}>BOOSTED</Text>
      <Text style={s.boostBarText} numberOfLines={1}>{countdown(left)} left · {plural(boost.stats.views, 'view')} · {plural(boost.stats.likes, 'like')}</Text>
      <Icon name="chevron-right" size={14} color={love.onDarkMuted} />
    </PressScale>
  );
}

// ─── card stack ────────────────────────────────────────────────────────────────────────────────────────────────────
function DiscoverStack({ nav, home, onFilters, filterCount = 0 }) {
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
  const cardHeight = Math.max(340, Math.min(540, winH - 475)); // the action buttons stay above the tab bar
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
      haptic('select');
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      setSpend({
        amount: prices[action], title: action === 'super_like' ? `Super Like ${card.firstName}` : `Priority Like ${card.firstName}`,
        description: action === 'super_like' ? `${card.firstName} sees that you’re especially interested.` : `Your like is shown at the top of ${card.firstName}’s Likes and their stack.`,
        confirmLabel: action === 'super_like' ? `Super Like · ${prices[action]} coins` : `Priority Like · ${prices[action]} coins`,
        run: () => dating.swipe(api, card.userId, action), done: (r) => { haptic('success'); afterSwipe(card, r); },
      });
      return;
    }
    setBusy(true);
    const dir = action === 'like' ? 1 : -1;
    haptic(action === 'like' ? 'medium' : 'light');
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
    try { const r = await dating.undo(api); if (r.card) setCards((cs) => [r.card, ...(cs || [])]); haptic('light'); toast.show('Undone', { icon: 'repost' }); } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }

  const rotate = pan.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-12deg', '0deg', '12deg'] });
  const likeOp = pan.x.interpolate({ inputRange: [20, 120], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOp = pan.x.interpolate({ inputRange: [-120, -20], outputRange: [1, 0], extrapolate: 'clamp' });
  const nextScale = pan.x.interpolate({ inputRange: [-160, 0, 160], outputRange: [1, 0.94, 1], extrapolate: 'clamp' });
  const nextLift = pan.x.interpolate({ inputRange: [-160, 0, 160], outputRange: [0, 16, 0], extrapolate: 'clamp' });
  const openProfile = () => top && nav.push('DatingProfileView', { userId: top.userId, card: top });
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 120 }} showsVerticalScrollIndicator={false} scrollEnabled>
      {onFilters ? (
        <View style={hs.filterRow}>
          <PressScale onPress={onFilters} scaleTo={0.96} accessibilityRole="button" accessibilityLabel={filterCount ? `Discovery filters, ${filterCount} active` : 'Discovery filters'} style={hs.filterBtn}>
            <Icon name="filter" size={14} color={love.wine} />
            <Text style={hs.filterText}>{filterCount ? `Filters · ${filterCount}` : 'Filters'}</Text>
          </PressScale>
        </View>
      ) : null}
      {cards === null ? <Skeleton.Card height={cardHeight} />
        : !top ? (
          <View style={[s.emptyCard, { minHeight: cardHeight }]}>
            <Glow size={340} color={love.roseSoft} opacity={0.35} style={{ top: -60, alignSelf: 'center' }} />
            <LoveState art="stack" title="You’re all caught up" body="New people join every day. Widen your preferences or boost your profile so more people see you.">
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <LoveButton small kind="ghost" icon="filter" label="Preferences" onPress={() => nav.push('DatingProfileEdit', { section: 'prefs' })} style={{ flex: 1 }} />
                <LoveButton small icon="flame" label="Boost" onPress={() => nav.push('DatingBoost')} style={{ flex: 1 }} />
              </View>
              <LoveButton small kind="soft" icon="repost" label="Refresh" onPress={load} />
            </LoveState>
          </View>
        ) : (
          <View style={{ height: cardHeight + 14 }}>
            {cards[2] ? (
              <View pointerEvents="none" style={[s.card, s.deck2, { height: cardHeight }]}><CardFace card={cards[2]} interactive={false} /></View>
            ) : null}
            {cards[1] ? (
              <Animated.View pointerEvents="none" style={[s.card, { height: cardHeight, position: 'absolute', left: 0, right: 0, top: 0, transform: [{ translateY: nextLift }, { scale: nextScale }] }]}>
                <CardFace key={cards[1].userId} card={cards[1]} interactive={false} />
              </Animated.View>
            ) : null}
            <Animated.View key={top.userId} {...responder.panHandlers} style={[s.card, lshadow.md, { height: cardHeight, transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}>
              <CardFace card={top} onOpen={openProfile} />
              <Stamp kind="like" opacity={likeOp} />
              <Stamp kind="pass" opacity={passOp} />
            </Animated.View>
          </View>
        )}
      {top ? (
        <ActionBar>
          <ActionBtn kind="undo" size={46} label={plan.flags && plan.flags.undoSwipes ? 'Undo last swipe' : 'Undo (Dating Plus)'} onPress={undo} lock={!(plan.flags && plan.flags.undoSwipes)} />
          <ActionBtn kind="pass" size={62} label="Pass" onPress={() => act('pass')} disabled={busy} />
          <ActionBtn kind="super" size={52} label={`Super Like, ${prices.super_like} coins`} onPress={() => act('super_like')} cost={prices.super_like} />
          <ActionBtn kind="like" size={70} label="Like" onPress={() => act('like')} disabled={busy} />
          <ActionBtn kind="priority" size={46} label={`Priority Like, ${prices.priority_like} coins`} onPress={() => act('priority_like')} cost={prices.priority_like} />
        </ActionBar>
      ) : null}
      {cards !== null && !top ? <ExampleStrip title="Meanwhile, see who you could meet" note="Example profiles for illustration. They are not members and cannot be liked, messaged or matched." style={{ marginHorizontal: -18, marginTop: 22 }} /> : null}
      {swipes ? (
        <View style={s.swipeInfo}>
          <View style={s.swipePill}>
            <Icon name="compass" size={13} color={love.rose} />
            <Text style={s.swipeInfoText}>{swipes.left > 0 ? `${plural(swipes.left, 'swipe')} left today` : 'No free swipes left today'}</Text>
          </View>
          {swipes.left <= 5 ? (
            <PressScale onPress={offerExtra} style={s.extraBtn} accessibilityRole="button" accessibilityLabel={`Add ${home.rules.extraSwipes} swipes for ${prices.extra_swipes} coins`}>
              <Text style={s.linkText}>{`+${home.rules.extraSwipes} swipes`}</Text><CostPill amount={prices.extra_swipes} />
            </PressScale>
          ) : null}
        </View>
      ) : null}
      <Text style={s.hint}>Swipe right to like, left to pass. Tap the photo to see more, or the name for the full profile.</Text>
      {spendSheet}
      <MatchCelebration match={match} me={home.profile} onClose={() => setMatch(null)}
        onChat={() => { const m = match; setMatch(null); nav.push('DatingChat', { conversationId: m.conversationId, name: m.card.firstName, photo: firstPhoto(m.card) }); }} />
    </ScrollView>
  );
}

// ─── FIND LOVE HUB: full-screen Find Love (route 'FindLoveHub'). Discover / Likes / Matches / Profile, back to Discover. ───
export function FindLoveHubScreen({ params = {} }) {
  const nav = useNav();
  return (
    <LoveScreen title="Find Love" eyebrow="Meet believers" scroll={false} onBack={() => nav.pop()}>
      <FindLoveTab nav={nav} fullscreen initialTab={params.tab || 'discover'} />
    </LoveScreen>
  );
}

// Profile tab (full-screen hub only): your photo, the filters, plans, boost, safety and verification.
function ProfilePane({ nav, home, onFilters }) {
  const p = home.profile;
  const plan = home.plan.plan;
  const rows = [
    ['filter', 'Discovery filters', 'Age, intention, denomination, location and interests', onFilters],
    ['flame', 'Boost your profile', 'Be seen by more people this week', () => nav.push('DatingBoost')],
    ['sparkles', 'Plans', 'Dating Plus and VIP features', () => nav.push('DatingPlans')],
    ['shield', 'Verification', 'Show the verified badge on your profile', () => nav.push('DatingVerify')],
    ['settings', 'Safety and settings', 'Pause, block, report and account options', () => nav.push('DatingSettings')],
  ];
  return (
    <ScrollView contentContainerStyle={s.tabPad} showsVerticalScrollIndicator={false}>
      <View style={hs.profileCard}>
        <RingAvatar uri={firstPhoto(p)} size={76} ring={3} gap={2} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={hs.profileName} numberOfLines={1}>{`${p.firstName}, ${p.age}`}</Text>
          <Text style={hs.profileSub} numberOfLines={1}>{[p.city, p.country].filter(Boolean).join(', ') || 'Add your city'}</Text>
          <PlanBadge plan={plan} onPress={() => nav.push('DatingPlans')} />
        </View>
      </View>
      <LoveButton label="Edit my dating profile" icon="edit" kind="soft" onPress={() => nav.push('DatingProfileEdit')} style={{ marginTop: 14 }} />
      <View style={hs.rows}>
        {rows.map(([icon, title, sub, go], i) => (
          <Pressable key={title} onPress={go} accessibilityRole="button" accessibilityLabel={title}
            style={[hs.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
            <View style={hs.rowIcon}><Icon name={icon} size={16} color={love.rose} /></View>
            <View style={{ flex: 1 }}><Text style={hs.rowTitle}>{title}</Text><Text style={hs.rowSub}>{sub}</Text></View>
            <Icon name="chevron-right" size={16} color={love.faint} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
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
      haptic('medium');
      const r = await dating.swipe(api, card.userId, 'like');
      if (r.match) { haptic('success'); datingChanged(); nav.push('DatingChat', { conversationId: r.match.conversationId, name: card.firstName, photo: firstPhoto(card) }); }
      likes.reload();
    } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }
  if (!d) return <View style={s.tabPad}>{likes.error ? <LoveState art="error" title="Likes didn’t load" body={datingError(likes.error)}><LoveButton label="Try again" onPress={likes.reload} /></LoveState> : <Skeleton.Grid />}</View>;
  return (
    <ScrollView contentContainerStyle={s.tabPad}>
      {!d.unlocked ? (
        d.count ? (
          <FadeInUp style={[s.lockHero, lshadow.md]}>
            <LinearGradient colors={['#422819', '#2D1B10']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Grain width={460} height={700} opacity={0.06} count={110} />
            <Glow size={320} color={love.roseBright} opacity={0.4} style={{ top: -120, right: -100 }} />
            <View style={s.lockGrid}>
              {Array.from({ length: Math.min(4, Math.max(2, d.count)) }).map((_, k) => <LockedTile key={k} k={k} />)}
            </View>
            <Text style={s.lockTitle}>{`${plural(d.count, 'person likes', 'people like')} you`}</Text>
            <Text style={s.lockBody}>See who they are and like them back to match.</Text>
            <LoveButton kind="gold" icon="heart" label={`See who liked you · ${d.offer.hours} h`} right={<CostPill amount={d.offer.coins} dark />}
              accessibilityLabel={`See who liked you, ${d.offer.coins} coins for ${d.offer.hours} hours`}
              onPress={() => setSpend({
                amount: d.offer.coins, title: 'See who liked you', description: `Unlocks your Likes list for ${d.offer.hours} hours. Free with Dating Plus and VIP.`,
                run: () => dating.unlockLikes(api, newIdempotencyKey()), done: () => { haptic('success'); likes.reload(); },
              })} style={{ marginTop: 18 }} />
            <LoveButton kind="glass" icon="star" label="Get Dating Plus" onPress={() => nav.push('DatingPlans', { reason: 'likes' })} style={{ marginTop: 10 }} />
          </FadeInUp>
        ) : <LoveState art="hearts" title="No new likes yet" body="When someone likes you, they’ll appear here. Keep your profile warm and true — the right person is worth the wait." />
      ) : (
        <>
          <View style={s.paneNote}>
            <Icon name={d.viaPlan ? 'star' : 'clock'} size={13} color={love.gold} fill={d.viaPlan ? love.gold : undefined} />
            <Text style={s.paneNoteText}>{d.viaPlan ? 'Included in your plan.' : `Unlocked until ${new Date(d.unlockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`} Like them back to match.</Text>
          </View>
          {!d.items.length ? <LoveState art="hearts" title="No new likes" body="When someone likes you, they’ll appear here." /> : null}
          <View style={s.grid}>
            {d.items.map((c, i) => (
              <FadeInUp key={c.userId} index={i} distance={10} style={s.gridCell}>
                <PressScale onPress={() => nav.push('DatingProfileView', { userId: c.userId, card: c })} style={[s.gridTile, lshadow.sm]} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={`${c.firstName}, ${c.age}. Open profile`}>
                  {firstPhoto(c) ? <Image source={{ uri: firstPhoto(c) }} style={StyleSheet.absoluteFill} /> : <LinearGradient colors={grad.blush} style={StyleSheet.absoluteFill} />}
                  <LinearGradient colors={grad.scrim} locations={[0, 0.45, 1]} style={s.gridScrim} />
                  {c.kind !== 'like' ? (
                    <View style={s.gridTag}><Icon name={c.kind === 'priority_like' ? 'sparkles' : 'star'} size={11} color={love.plum} fill={love.plum} /><Text style={s.gridTagText}>{c.kind === 'priority_like' ? 'Priority' : 'Super Like'}</Text></View>
                  ) : null}
                  <View style={s.gridFoot}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Text style={s.gridName} numberOfLines={1}>{c.firstName}<Text style={s.gridAge}>{`  ${c.age}`}</Text></Text>
                        {c.verified ? <VerifiedSeal size={15} /> : null}
                      </View>
                      {c.city ? <Text style={s.gridCity} numberOfLines={1}>{c.city}</Text> : null}
                    </View>
                    <PressScale onPress={() => likeBack(c)} style={[s.gridLike, lshadow.glow]} scaleTo={0.85} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Like ${c.firstName} back`}>
                      <LinearGradient colors={grad.heart} style={[StyleSheet.absoluteFill, { borderRadius: 22 }]} />
                      <HeartShape size={20} color="#FFFFFF" />
                    </PressScale>
                  </View>
                </PressScale>
              </FadeInUp>
            ))}
          </View>
        </>
      )}
      {spendSheet}
    </ScrollView>
  );
}

function LockedTile({ k }) {
  const tints = isDarkScheme()
    ? [['#5A2E18', '#ED5C12'], ['#241F12', '#A66D22'], ['#1A1A1A', '#111111'], ['#24171A', '#8A451F']]
    : [['#F7B98A', '#ED5C12'], ['#FBF3DC', '#A66D22'], ['#FF8B3D', '#3C2518'], ['#FBEDEA', '#8A451F']];
  return (
    <View style={s.lockTile} accessibilityLabel="Hidden like" accessible>
      <LinearGradient colors={tints[k % 4]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* a soft "someone" silhouette */}
      <View style={s.silHead} /><View style={s.silBody} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(40,26,17,0.45)' }]} />
      <View style={s.lockBadge}><Icon name="lock" size={14} color={love.goldBright} strokeWidth={2.2} /></View>
    </View>
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
      if (accept && res.match) { haptic('success'); nav.push('DatingChat', { conversationId: r.conversationId, name: r.profile.firstName, photo: firstPhoto(r.profile) }); }
      requests.reload(); matches.reload();
    } catch (e) { toast.show(datingError(e), { tone: 'error' }); }
  }
  if (!matches.loaded) return <View style={s.tabPad}><Skeleton.List /></View>;
  const fresh = items.filter((m) => !m.lastMessage);
  const talking = items.filter((m) => m.lastMessage);
  const openChat = (m) => nav.push('DatingChat', { conversationId: m.conversationId, name: m.profile.firstName, photo: firstPhoto(m.profile) });
  return (
    <ScrollView contentContainerStyle={s.tabPad}>
      {matches.error && !items.length ? <LoveState art="error" title="Matches didn’t load" body={datingError(matches.error)}><LoveButton label="Try again" onPress={matches.reload} /></LoveState> : null}
      {reqs.length ? <Text style={s.sectionLabel}>Message requests</Text> : null}
      {reqs.map((r) => (
        <FadeInUp key={r.conversationId} style={s.reqCard}>
          <RingAvatar uri={firstPhoto(r.profile)} size={50} colors={grad.gold} ring={2} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.rowName}>{r.profile.firstName}<Text style={s.rowAge}>{`, ${r.profile.age}`}</Text></Text>
            <Text style={[s.rowSub, r.incoming && s.reqQuote]} numberOfLines={3}>{r.incoming ? `“${r.message}”` : 'Waiting for a reply to your request'}</Text>
            {r.incoming ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <LoveButton small label="Accept" icon="heart" onPress={() => answer(r, true)} style={{ flex: 1 }} />
                <LoveButton small kind="ghost" label="Decline" onPress={() => answer(r, false)} style={{ flex: 1 }} />
              </View>
            ) : null}
          </View>
        </FadeInUp>
      ))}
      {!items.length && !reqs.length && !matches.error ? <LoveState art="chat" title="No matches yet" body="When you and someone both like each other, you’ll find them here — and can start a conversation." /> : null}
      {fresh.length ? (
        <>
          <Text style={s.sectionLabel}>New matches</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 8, paddingBottom: 4 }} style={{ marginHorizontal: -2 }}>
            {fresh.map((m, i) => (
              <FadeInUp key={m.matchId} index={i} distance={8}>
                <PressScale onPress={() => openChat(m)} scaleTo={0.94} style={{ alignItems: 'center', width: 78 }} accessibilityRole="button" accessibilityLabel={`New match: ${m.profile.firstName}. Say hello`}>
                  <RingAvatar uri={firstPhoto(m.profile)} size={64} />
                  {m.profile.vip ? <View style={s.newVip}><Crown size={11} /></View> : null}
                  <Text style={s.newName} numberOfLines={1}>{m.profile.firstName}</Text>
                </PressScale>
              </FadeInUp>
            ))}
          </ScrollView>
        </>
      ) : null}
      {talking.length ? <Text style={[s.sectionLabel, { marginTop: 18 }]}>Conversations</Text> : null}
      {talking.length ? (
        <View style={s.convCard}>
          {talking.map((m, i) => (
            <FadeInUp key={m.matchId} index={i} distance={8}>
              <PressScale onPress={() => openChat(m)} style={[s.matchRow, i === talking.length - 1 && { borderBottomWidth: 0 }]} scaleTo={0.98} accessibilityRole="button"
                accessibilityLabel={`${m.profile.firstName}${m.unread ? `, ${m.unread} unread` : ''}. ${m.lastMessage.text}`}>
                <Avatar uri={firstPhoto(m.profile)} size={54} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.rowName} numberOfLines={1}>{m.profile.firstName}<Text style={s.rowAge}>{`, ${m.profile.age}`}</Text></Text>
                    {m.profile.verified ? <VerifiedSeal size={15} /> : null}
                    {m.profile.vip ? <View style={s.vip}><Crown size={10} /><Text style={s.vipText}>VIP</Text></View> : null}
                  </View>
                  <Text style={[s.rowSub, m.unread && { color: love.ink, fontWeight: '700' }]} numberOfLines={1}>{`${m.lastMessage.mine ? 'You: ' : ''}${m.lastMessage.text}`}</Text>
                </View>
                {m.unread ? <View style={s.unread}><Text style={s.unreadText}>{m.unread}</Text></View> : <Icon name="chevron-right" size={16} color={love.faint} />}
              </PressScale>
            </FadeInUp>
          ))}
        </View>
      ) : fresh.length ? <Text style={[s.hint, { marginTop: 14 }]}>Tap a new match to say hello 👋</Text> : null}
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Profile editor (onboarding + edit)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function Field({ label, hint, children, locked, onLocked }) {
  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={s.fieldLabel}>{label}</Text>
        {locked ? (
          <PressScale onPress={onLocked} style={s.lockPill} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${label} needs ${locked}. See plans`}>
            {locked === 'VIP' ? <Crown size={11} color={love.gold} /> : <Icon name="lock" size={10} color={love.gold} />}
            <Text style={s.lockPillText}>{locked}</Text>
          </PressScale>
        ) : null}
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
      interests: p ? p.interests || [] : [], intention: p ? p.intention : 'marriage', bio: p ? p.bio : '', prompts: p ? p.prompts : [], confirmAdult: !!p,
      prefs: p ? { ageMin: 18, ageMax: 60, intentions: [], denominations: [], involvement: [], ...p.prefs } : { ageMin: 21, ageMax: 40, country: 'Nigeria', intentions: [], denominations: [], involvement: [] },
    });
  }, [home.loaded, p]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setPref = (k, v) => setF((x) => ({ ...x, prefs: { ...x.prefs, [k]: v } }));
  if (!f) return <LoveScreen title="Dating profile"><Skeleton.Block height={240} /><Skeleton.Block height={180} /></LoveScreen>;

  async function save() {
    if (saving) return;
    const birthDate = `${String(f.y).padStart(4, '0')}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;
    if (!f.firstName.trim() || !f.gender || !f.interestedIn || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) { setErr('Please fill in your first name, date of birth, and who you are and are looking for.'); return; }
    if (!f.confirmAdult) { setErr('Please confirm you are 18 or older.'); return; }
    setSaving(true); setErr(null);
    try {
      await dating.saveProfile(api, {
        firstName: f.firstName, birthDate, confirmAdult: f.confirmAdult, gender: f.gender, interestedIn: f.interestedIn, city: f.city, country: f.country,
        denomination: f.denomination, churchInvolvement: f.churchInvolvement, intention: f.intention, bio: f.bio, interests: f.interests || [],
        prompts: (f.prompts || []).filter((x) => x.q && x.a), prefs: { ...f.prefs, ageMin: Number(f.prefs.ageMin) || 18, ageMax: Number(f.prefs.ageMax) || 60 },
      });
      haptic('success');
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
  const maxPhotos = (home.data && home.data.rules.maxPhotos) || 6;
  return (
    <LoveScreen title={p ? 'Your dating profile' : 'Create your profile'}>
      {!p ? <LoveBanner tone="rose" icon="shield" text="Your dating profile is separate from your social profile. Only your first name, age, city and what you add here are shown." /> : null}
      {p ? (
        <SectionCard eyebrow="First impressions" title="Photos" hint={home.data.rules.photoReview === 'ai' ? 'Clear, modest photos of you with your face showing. Each photo gets a quick automatic check and goes live straight away unless it needs a look from our team.' : 'Clear, modest photos of you. New photos are checked by our team before others see them.'}>
          <View style={s.photoGrid}>
            {Array.from({ length: maxPhotos }).map((_, i) => {
              const ph = p.photos[i];
              if (ph) {
                const tone = ph.status === 'approved' ? love.positive : ph.status === 'rejected' ? love.danger : love.gold;
                return (
                  <View key={ph.id} style={[s.photoCell, i === 0 && s.photoMain]}>
                    <Image source={{ uri: ph.url }} style={StyleSheet.absoluteFill} />
                    <LinearGradient colors={['rgba(40,26,17,0)', 'rgba(40,26,17,0.55)']} style={s.photoScrim} />
                    <View style={[s.photoState, { backgroundColor: tone }]}>
                      <Text style={s.photoStateText}>{ph.status === 'approved' ? (i === 0 ? 'Main' : 'Live') : ph.status === 'rejected' ? 'Rejected' : 'In review'}</Text>
                    </View>
                    <View style={s.photoTools}>
                      {i > 0 ? <PressScale onPress={() => dating.mainPhoto(api, ph.id)} style={s.photoTool} hitSlop={6} accessibilityRole="button" accessibilityLabel="Make main photo"><Icon name="star" size={13} color={love.gold} /></PressScale> : null}
                      <PressScale onPress={() => dating.removePhoto(api, ph.id)} style={s.photoTool} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove photo"><Icon name="trash" size={13} color={love.danger} /></PressScale>
                    </View>
                  </View>
                );
              }
              const isAdd = i === p.photos.length;
              return (
                <PressScale key={`slot${i}`} onPress={addPhoto} style={[s.photoCell, s.photoAdd, !isAdd && s.photoSlot]} accessibilityRole="button" accessibilityLabel="Add a photo">
                  {isAdd && uploading ? <ActivityIndicator color={love.rose} /> : (
                    <>
                      <View style={[s.addDisc, !isAdd && { backgroundColor: 'transparent', borderWidth: 1, borderColor: love.blushLine }]}>
                        {isAdd ? <LinearGradient colors={grad.heart} style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} /> : null}
                        <View><Icon name="plus" size={18} color={isAdd ? '#FFFFFF' : love.roseSoft} strokeWidth={2.4} /></View>
                      </View>
                      {isAdd ? <Text style={s.photoAddText}>Add photo</Text> : null}
                    </>
                  )}
                </PressScale>
              );
            })}
          </View>
        </SectionCard>
      ) : null}

      <SectionCard eyebrow="About you" title="The basics">
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
      </SectionCard>

      <SectionCard eyebrow="Front and centre" title="Your faith">
        <Field label="Denomination"><Choice items={DENOMINATIONS} value={f.denomination} onChange={(v) => set('denomination', v)} /></Field>
        <Field label="Church involvement"><Choice items={INVOLVEMENT} value={f.churchInvolvement} onChange={(v) => set('churchInvolvement', v)} /></Field>
        <Field label="Relationship intentions"><Choice items={Object.keys(INTENTION_LABELS)} labels={INTENTION_LABELS} value={f.intention} onChange={(v) => set('intention', v)} /></Field>
      </SectionCard>

      <SectionCard eyebrow="In your words" title="Your story">
        <Field label="Interests" hint="Pick what you enjoy. Shared interests help people find you."><Choice multi items={INTEREST_OPTIONS} value={f.interests || []} onChange={(v) => set('interests', v)} /></Field>
        <Field label="About you"><Input value={f.bio} onChangeText={(v) => set('bio', v)} placeholder="Your faith, what you love, what you’re hoping for…" multiline maxLength={500} /></Field>
        <Field label="Prompts" hint="Answer up to three.">
          {promptSlots.map((k) => {
            const cur = f.prompts[k] || { q: '', a: '' };
            const upd = (patch) => { const next = [...f.prompts]; next[k] = { ...cur, ...patch }; set('prompts', next); };
            return (
              <View key={k} style={s.promptBox}>
                <Text style={s.promptNum}>{`Prompt ${k + 1}`}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                  {PROMPTS.map((q) => (
                    <PressScale key={q} onPress={() => upd({ q })} style={[s.promptChip, cur.q === q && s.promptChipOn]} accessibilityRole="radio" accessibilityState={{ checked: cur.q === q }}>
                      <Text style={[s.promptChipText, cur.q === q && { color: '#FFFFFF' }]}>{q}</Text>
                    </PressScale>
                  ))}
                </ScrollView>
                {cur.q ? <Input value={cur.a} onChangeText={(v) => upd({ a: v })} placeholder="Your answer" maxLength={200} style={{ marginTop: 8 }} /> : null}
              </View>
            );
          })}
        </Field>
      </SectionCard>

      <SectionCard eyebrow="Preferences" title="Who you’d like to meet">
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
          <View style={s.switchRow}><Text style={s.rowSub}>Match both ways</Text><Switch value={!!f.prefs.compatibleOnly} onValueChange={(v) => setPref('compatibleOnly', v)} trackColor={{ true: love.rose, false: love.blushLine }} thumbColor="#FFFFFF" accessibilityLabel="Match both ways" /></View>
        </Field>
      </SectionCard>

      {!p ? (
        <PressScale onPress={() => set('confirmAdult', !f.confirmAdult)} style={s.confirmRow} accessibilityRole="checkbox" accessibilityState={{ checked: f.confirmAdult }}>
          <View style={[s.checkbox, f.confirmAdult && { backgroundColor: love.rose, borderColor: love.rose }]}>{f.confirmAdult ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={3} /> : null}</View>
          <Text style={s.confirmText}>I confirm I am 18 or older and will treat others with respect, honesty and purity.</Text>
        </PressScale>
      ) : null}
      {err ? <View style={{ marginTop: 14 }}><LoveBanner tone="danger" icon="x" text={err} /></View> : null}
      <LoveButton label={saving ? 'Saving…' : p ? 'Save' : 'Create my profile'} icon={p ? 'check' : 'heart'} onPress={save} disabled={saving} style={{ marginTop: 20 }} />
      {!p ? <Text style={[s.fieldHint, { textAlign: 'center', marginTop: 8 }]}>After you create your profile, add photos so others can see you.</Text> : null}
    </LoveScreen>
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
  const [w, setW] = useState(0);
  const [idx, setIdx] = useState(0);
  const keyRef = useRef(null);
  const { height: winH } = useWindowDimensions();
  useEffect(() => { dating.profile(api, params.userId).then(setCard).catch((e) => { if (!card) toast.show(datingError(e), { tone: 'error' }); }); }, [params.userId]);
  if (!card) return <LoveScreen title="Profile"><Skeleton.Block height={420} /><Skeleton.Block height={120} /></LoveScreen>;
  const prices = (home.data && home.data.prices) || {};
  async function like(action) {
    const go = () => dating.swipe(api, card.userId, action);
    const done = (r) => {
      datingChanged();
      haptic(r && r.match ? 'success' : 'medium');
      if (r && r.match) nav.replace ? nav.replace('DatingChat', { conversationId: r.match.conversationId, name: card.firstName, photo: firstPhoto(card) }) : nav.push('DatingChat', { conversationId: r.match.conversationId, name: card.firstName, photo: firstPhoto(card) });
      else { toast.show(action === 'like' ? `You liked ${card.firstName}` : 'Sent 💫', { icon: 'heart' }); nav.pop(); }
    };
    if (action === 'like') { try { done(await go()); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } return; }
    setSpend({ amount: prices[action], title: action === 'super_like' ? `Super Like ${card.firstName}` : `Priority Like ${card.firstName}`, run: go, done });
  }
  const photos = card.photos.length ? card.photos : [{ id: 'none', url: null }];
  const heroH = Math.max(380, Math.min(600, winH * 0.62));
  const where = [card.city, card.country].filter(Boolean).join(', ') || 'Location hidden';
  const faith = [['cross', 'Denomination', card.denomination], ['church', 'Church life', card.churchInvolvement], ['heart', 'Hoping for', card.intentionLabel]].filter((x) => x[2]);
  return (
    <View style={pst.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={{ height: heroH }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={32}
              onScroll={(e) => { const i = Math.round(e.nativeEvent.contentOffset.x / w); if (i !== idx) setIdx(i); }}>
              {photos.map((ph) => (
                <View key={ph.id} style={{ width: w, height: heroH, backgroundColor: love.blush }}>
                  {ph.url ? <Image source={{ uri: ph.url }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`Photo of ${card.firstName}`} /> : <LinearGradient colors={grad.blush} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><HeartShape size={90} stroke={love.roseSoft} strokeWidth={1} /></LinearGradient>}
                </View>
              ))}
            </ScrollView>
          ) : null}
          <LinearGradient colors={grad.scrimTop} style={s.heroTop} pointerEvents="none" />
          <LinearGradient colors={['rgba(246,242,234,0)', 'rgba(40,26,17,0.25)', 'rgba(40,26,17,0.85)']} locations={[0, 0.4, 1]} style={s.heroScrim} pointerEvents="none" />
          {photos.length > 1 ? <View style={s.heroBars} pointerEvents="none">{photos.map((ph, k) => <View key={ph.id} style={[s.heroBar, k === idx && { backgroundColor: colors.surfaceWhite }]} />)}</View> : null}
          <View style={s.heroInfo} pointerEvents="none">
            {card.superLikedYou ? <View style={[s.likesYou, { marginBottom: 8 }]}><Icon name="star" size={12} color={love.plum} fill={love.plum} /><Text style={s.likesYouText}>Likes you a lot</Text></View> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{card.firstName}<Text style={s.heroAge}>{`  ${card.age}`}</Text></Text>
              {card.verified ? <VerifiedSeal size={26} /> : null}
              {card.vip ? <View style={s.vip}><Crown size={11} /><Text style={s.vipText}>VIP</Text></View> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <Icon name="map-pin" size={13} color={love.goldBright} /><Text style={s.heroMeta}>{where}</Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 18 }}>
          <View style={s.viewChips}>
            {card.denomination ? <LoveChip icon="cross" label={card.denomination} tone="rose" /> : null}
            {card.churchInvolvement ? <LoveChip icon="church" label={card.churchInvolvement} tone="rose" /> : null}
            {card.intentionLabel ? <LoveChip icon="heart" label={card.intentionLabel} tone="gold" /> : null}
          </View>
          {card.bio ? (
            <SectionCard eyebrow={`About ${card.firstName}`}>
              <Text style={s.viewBio}>{card.bio}</Text>
            </SectionCard>
          ) : null}
          {(card.prompts || []).map((pr, i) => (
            <FadeInUp key={pr.q} index={i} distance={10} style={s.quoteCard}>
              <Text style={s.quoteMark}>“</Text>
              <Text style={s.promptQ}>{pr.q}</Text>
              <Text style={s.promptA}>{pr.a}</Text>
            </FadeInUp>
          ))}
          {card.interests && card.interests.length ? (
            <SectionCard eyebrow="Interests" title={`What ${card.firstName} enjoys`}>
              <View style={hs.interestWrap}>{card.interests.map((t) => <LoveChip key={t} label={t} tone="rose" />)}</View>
            </SectionCard>
          ) : null}
          {faith.length ? (
            <SectionCard eyebrow="Faith" title="Walking with God">
              {faith.map(([ic, l, v], i) => (
                <View key={l} style={[s.faithRow, i === faith.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={s.faithIcon}><Icon name={ic} size={15} color={love.rose} /></View>
                  <Text style={s.faithLabel}>{l}</Text>
                  <Text style={s.faithValue} numberOfLines={2}>{v}</Text>
                </View>
              ))}
            </SectionCard>
          ) : null}
          <Filigree width={180} style={{ marginTop: 22 }} />
          <PressScale onPress={() => { keyRef.current = newIdempotencyKey(); setRequesting(true); }} style={s.reqBtn} scaleTo={0.98} accessibilityRole="button"
            accessibilityLabel={`Send a message request, ${prices.message_request || 25} coins`}>
            <View style={s.reqIcon}><Icon name="chat" size={17} color={love.wine} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.reqTitle}>Send a message request</Text>
              <Text style={s.fieldHint}>A message request lets you write before you match. {card.firstName} can accept or decline.</Text>
            </View>
            <CostPill amount={prices.message_request || 25} />
          </PressScale>
        </View>
      </ScrollView>
      <View style={s.heroNav} pointerEvents="box-none">
        <RoundBtn icon="chevron-left" label="Back" onPress={() => nav.pop()} dark />
        <View style={{ flex: 1 }} pointerEvents="none" />
        <RoundBtn icon="more" label="More" onPress={() => setMenu(true)} dark />
      </View>
      <View style={s.viewFooter} pointerEvents="box-none">
        <LinearGradient colors={['rgba(246,242,234,0)', 'rgba(246,242,234,0.96)', love.paper]} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <LoveButton kind="gold" icon="star" label="Super Like" right={<CostPill amount={prices.super_like || 10} dark />} onPress={() => like('super_like')} style={{ flex: 1.35 }}
          accessibilityLabel={`Super Like, ${prices.super_like || 10} coins`} />
        <LoveButton icon="heart" label="Like" onPress={() => like('like')} style={{ flex: 1 }} />
      </View>
      {spendSheet}
      <WalletSheet visible={requesting} onClose={() => setRequesting(false)} title={`Message ${card.firstName}`} subtitle="Write a kind first message. If they accept, you’ll match and can keep chatting.">
        <TextInput value={text} onChangeText={setText} placeholder="Hello! I noticed…" placeholderTextColor={love.faint} multiline maxLength={500} style={s.reqInput} accessibilityLabel="Your first message" />
        <PressScale onPress={() => { if (!text.trim()) return; setRequesting(false); setSpend({ amount: prices.message_request || 25, title: 'Send message request', description: `“${text.trim().slice(0, 80)}”`, run: () => dating.sendRequest(api, card.userId, text.trim(), keyRef.current), done: () => { toast.show('Request sent 💌', { icon: 'chat' }); nav.pop(); } }); }}
          style={[ws.primary, { backgroundColor: love.wine }, !text.trim() && ws.disabled]} accessibilityRole="button">
          <Text style={ws.primaryText}>Continue</Text>
        </PressScale>
      </WalletSheet>
      <SafetyMenu visible={menu} name={card.firstName} onClose={() => setMenu(false)} onReport={() => { setMenu(false); setReporting(true); }} onBlock={async () => { setMenu(false); try { await dating.block(api, card.userId); toast.show(`${card.firstName} is blocked`, { icon: 'shield' }); nav.pop(); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } }} />
      <ReportSheet visible={reporting} userId={card.userId} name={card.firstName} onClose={() => setReporting(false)} onDone={() => nav.pop()} />
    </View>
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
      <PressScale onPress={onClose} style={ws.ghost} accessibilityRole="button"><Text style={ws.ghostText}>Cancel</Text></PressScale>
    </WalletSheet>
  );
}
function MenuRow({ icon, label, onPress, danger }) {
  return (
    <PressScale onPress={onPress} style={s.menuRow} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.menuIcon, danger && { backgroundColor: love.dangerSoft }]}><Icon name={icon} size={16} color={danger ? love.danger : love.wine} /></View>
      <Text style={[s.menuText, danger && { color: love.danger }]}>{label}</Text>
      <Icon name="chevron-right" size={15} color={love.faint} />
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
      <Choice items={REPORT_REASONS.map(([k]) => k)} labels={Object.fromEntries(REPORT_REASONS)} value={reason} onChange={setReason} />
      <TextInput value={details} onChangeText={setDetails} placeholder="What happened? (optional)" placeholderTextColor={love.faint} multiline maxLength={1000} style={[s.reqInput, { minHeight: 70 }]} accessibilityLabel="What happened, optional" />
      <View style={s.switchRow}><Text style={s.rowSub}>Also block {name}</Text><Switch value={block} onValueChange={setBlock} trackColor={{ true: love.rose, false: love.blushLine }} thumbColor="#FFFFFF" accessibilityLabel={`Also block ${name}`} /></View>
      <PressScale onPress={send} style={[ws.primary, { backgroundColor: love.danger }, (!reason || busy) && ws.disabled]} accessibilityRole="button"><Text style={ws.primaryText}>{busy ? 'Sending…' : 'Send report'}</Text></PressScale>
    </WalletSheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Dating chat: the app's chat (embedded, wine / parchment bubbles) + Find Love header + free-message meter / unlock panel
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
  const meter = a && !a.unrestricted && a.allowed > 0 ? Math.max(0, Math.min(1, (a.left || 0) / a.allowed)) : 0;

  return (
    <View style={s.chatScreen}>
      <View style={s.chatTop}>
        <RoundBtn icon="chevron-left" label="Back" onPress={() => nav.pop()} size={42} />
        <Pressable onPress={() => d && d.otherUserId && nav.push('DatingProfileView', { userId: d.otherUserId, card: d.profile })} style={s.chatWho} accessibilityRole="button" accessibilityLabel={`${name}. View profile`}>
          <RingAvatar uri={photo} size={38} ring={2} gap={1.5} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={s.chatName} numberOfLines={1}>{name}</Text>
              {d && d.profile && d.profile.verified ? <VerifiedSeal size={16} /> : null}
            </View>
            <Text style={s.chatSub} numberOfLines={1}>Find Love · {d && d.status === 'request' ? 'message request' : 'match'}</Text>
          </View>
        </Pressable>
        {d && d.status === 'match' ? <GiftButton recipientId={d.otherUserId} name={name} context={{ type: 'chat', id: convId }} label="Gift" /> : null}
        <RoundBtn icon="more" label="Chat options" onPress={() => setMenu(true)} size={42} />
      </View>
      {social ? (
        <PressScale onPress={() => nav.push('UserProfile', { id: social.userId, name: social.displayName })} style={s.socialBar} accessibilityRole="button" accessibilityLabel={`Open ${social.displayName}’s profile in Socials`}>
          <Avatar uri={social.avatarUrl} size={24} />
          <Text style={s.socialText} numberOfLines={1}><Text style={{ fontWeight: '700' }}>{social.displayName}</Text>{social.handle ? ` · @${social.handle}` : ''}</Text>
          <VerifiedSeal size={14} />
          <Text style={s.linkText}>Socials</Text>
          <Icon name="chevron-right" size={14} color={love.faint} />
        </PressScale>
      ) : null}
      {d && d.status === 'match' && a ? (
        a.unrestricted ? (
          <View style={s.meterWrap}>
            <View style={[s.meterPill, { backgroundColor: love.goldPale, borderColor: 'rgba(166,109,34,0.35)' }]}>
              {d.plan === 'vip' ? <Crown size={13} color={love.gold} /> : <Icon name="sparkles" size={13} color={love.gold} />}
              <Text style={[s.meterText, { color: love.goldInk }]}>{`Unlimited messaging · Dating ${d.plan === 'vip' ? 'VIP' : 'Plus'}`}</Text>
            </View>
          </View>
        ) : (
          <View style={s.meterWrap}>
            <View style={s.meterPill} accessibilityLabel={a.left > 0 ? `${plural(a.left, 'free message')} left` : 'Unlock messages to keep chatting'}>
              <HeartShape size={13} color={love.rose} />
              <Text style={s.meterText}>{a.left > 0 ? `${plural(a.left, 'free message')} left` : 'Unlock messages to keep chatting'}</Text>
              <View style={s.meterTrack}><LinearGradient colors={grad.heart} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.meterFill, { width: `${Math.round(meter * 100)}%` }]} /></View>
            </View>
            <PressScale onPress={() => nav.push('DatingPlans', { reason: 'messages' })} style={s.meterLink} hitSlop={8} accessibilityRole="button"><Text style={s.linkText}>Unlimited with Plus</Text></PressScale>
          </View>
        )
      ) : null}
      {d && d.incomingRequest ? (
        <View style={s.reqBanner}>
          <Text style={s.reqBannerText}><Text style={{ fontFamily: fonts.serifBold, fontSize: 15 }}>{name}</Text> sent you a message request. Accept to match and reply.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <LoveButton small icon="heart" label="Accept" onPress={() => answer(true)} style={{ flex: 1 }} />
            <LoveButton small kind="ghost" label="Decline" onPress={() => answer(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {convId ? <BubbleTheme.Provider value={DATING_BUBBLES}><ChatScreen params={{ id: convId, to: name, embedded: true }} /></BubbleTheme.Provider> : null}
        {d && (d.status === 'request' && !d.incomingRequest) ? (
          <View style={s.lockPanel}><LoveArt kind="chat" size={70} /><Text style={s.lockPanelTitle}>Request sent</Text><Text style={s.lockPanelBody}>You can keep chatting once {name} accepts.</Text></View>
        ) : null}
        {d && (d.status === 'closed' || d.status === 'declined') ? (
          <View style={s.lockPanel}><Text style={s.lockPanelTitle}>This conversation has ended</Text></View>
        ) : null}
        {a && a.needsUnlock && d.status === 'match' ? (
          <View style={s.lockPanel}>
            <Glow size={260} color={love.roseSoft} opacity={0.4} style={{ top: -120, alignSelf: 'center' }} />
            <View style={s.lockHeart}><LinearGradient colors={grad.heart} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} /><HeartShape size={22} color="#FFFFFF" /></View>
            <Text style={s.lockPanelTitle}>{a.allowed ? `Keep talking with ${name}` : `Start your conversation with ${name}`}</Text>
            <Text style={s.lockPanelBody}>{a.adUnlocksLeft > 0 ? `Watch a short ad to unlock ${a.messagesPerAd} free messages (${a.adUnlocksLeft} of 2 left for this chat).` : `Unlock ${a.bundleSize} more messages with Dating Coins, or get unlimited messaging with Dating Plus.`}</Text>
            {a.adUnlocksLeft > 0 ? (
              <LoveButton onPress={watchAd} disabled={adBusy} icon={adBusy ? <ActivityIndicator color="#FFFFFF" /> : 'play'}
                label={adBusy ? 'Loading the ad…' : adFailed ? 'Try the ad again' : `Watch an ad · ${a.messagesPerAd} free messages`} style={{ marginTop: 14 }} />
            ) : null}
            <LoveButton kind="ghost" icon="heart" label={`${a.bundleSize} messages`} right={<CostPill amount={a.bundleCost} unit="Dating Coins" />} onPress={buyBundle} style={{ marginTop: 10 }}
              accessibilityLabel={`${a.bundleSize} messages for ${a.bundleCost} Dating Coins`} />
            <PressScale onPress={() => nav.push('DatingPlans', { reason: 'messages' })} style={s.linkBtn} hitSlop={8} accessibilityRole="button">
              <Text style={s.linkText}>Unlimited messaging with Dating Plus</Text>
            </PressScale>
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

// ─── styles ────────────────────────────────────────────────────────────────────────────────────────────────────────
const hs = StyleSheet.create({
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine },
  profileName: { fontFamily: fonts.display, fontSize: 24, color: love.ink },
  profileSub: { fontSize: 13, color: love.faint },
  rows: { marginTop: 14, borderRadius: 22, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: love.blushLine },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: love.blush, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: love.ink },
  rowSub: { fontSize: 12, color: love.faint, marginTop: 1 },
  filterRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine },
  filterText: { fontSize: 13, fontWeight: '700', color: love.wine },
  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

const s = StyleSheet.create({
  tabPad: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 110 },
  loveBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 12 },
  // intro
  intro: { borderRadius: 30, padding: 24, alignItems: 'center', overflow: 'hidden' },
  introMedal: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 4 },
  introMedalInner: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  introEyebrow: { marginTop: 14, fontSize: 11, fontWeight: '800', letterSpacing: 2.2, color: love.goldBright, textTransform: 'uppercase' },
  introTitle: { fontFamily: fonts.serifBold, fontSize: 30, lineHeight: 35, color: love.onDark, textAlign: 'center', marginTop: 6, letterSpacing: -0.6 },
  introAccent: { fontFamily: fonts.serifItalic, fontSize: 19, color: love.roseSoft, textAlign: 'center', marginTop: 2 },
  introBody: { fontSize: 14.5, lineHeight: 22, color: love.onDarkMuted, textAlign: 'center', marginTop: 12 },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  introRowIcon: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(244,216,140,0.45)', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  introRowText: { flex: 1, fontSize: 14, color: love.onDark, lineHeight: 19 },
  introVerse: { fontFamily: fonts.serifItalic, fontSize: 18, color: love.onDark, marginTop: 20, textAlign: 'center' },
  introRef: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6, color: love.goldBright, textTransform: 'uppercase', marginTop: 4 },
  introNote: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch', marginTop: 18, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)' },
  introNoteText: { flex: 1, color: love.onDark, fontSize: 13.5, lineHeight: 19 },
  // boost bar
  boostBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 14, minHeight: 40, borderRadius: 20, overflow: 'hidden' },
  boostBarLabel: { fontSize: 11, fontWeight: '900', color: love.goldBright, letterSpacing: 1.2 },
  boostBarText: { flex: 1, fontSize: 12.5, color: love.onDark },
  // deck
  card: { borderRadius: 28, overflow: 'hidden', backgroundColor: love.blush },
  deck2: { position: 'absolute', left: 14, right: 14, top: 26, opacity: 0.55, transform: [{ scale: 0.9 }] },
  emptyCard: { borderRadius: 28, borderWidth: 1, borderColor: love.blushLine, backgroundColor: love.card, overflow: 'hidden', justifyContent: 'center', padding: 16, ...lshadow.sm },
  swipeInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 22, flexWrap: 'wrap' },
  swipePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine },
  swipeInfoText: { fontSize: 12.5, color: love.wine, fontWeight: '700' },
  extraBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 4 },
  linkBtn: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 13, fontWeight: '800', color: love.rose },
  hint: { fontSize: 12, color: love.faint, textAlign: 'center', marginTop: 6, lineHeight: 17 },
  likesYou: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: love.goldBright },
  likesYouText: { fontSize: 12, fontWeight: '800', color: love.plum },
  // likes
  lockHero: { borderRadius: 30, padding: 22, overflow: 'hidden', alignItems: 'center' },
  lockGrid: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  lockTile: { width: 68, height: 92, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(244,216,140,0.35)' },
  silHead: { position: 'absolute', top: 22, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.5)' },
  silBody: { position: 'absolute', bottom: -14, width: 54, height: 46, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.45)' },
  lockBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(40,26,17,0.75)', borderWidth: 1, borderColor: 'rgba(244,216,140,0.6)', alignItems: 'center', justifyContent: 'center' },
  lockTitle: { fontFamily: fonts.serifBold, fontSize: 27, color: love.onDark, marginTop: 18, textAlign: 'center', letterSpacing: -0.4 },
  lockBody: { fontSize: 14, color: love.onDarkMuted, marginTop: 4, textAlign: 'center' },
  paneNote: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: love.goldPale, marginBottom: 12 },
  paneNoteText: { fontSize: 12.5, color: love.goldInk, fontWeight: '600', flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  gridCell: { width: '48.3%' },
  gridTile: { height: 236, borderRadius: 22, overflow: 'hidden', backgroundColor: love.blush },
  gridScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  gridTag: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: love.goldBright, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  gridTagText: { fontSize: 10.5, fontWeight: '900', color: love.plum },
  gridFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 6 },
  gridName: { fontFamily: fonts.serifBold, color: '#FFFFFF', fontSize: 19, flexShrink: 1 },
  gridAge: { fontFamily: fonts.serif, fontSize: 16, color: 'rgba(255,255,255,0.9)' },
  gridCity: { fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  gridLike: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // matches
  sectionLabel: { ...type.eyebrow, marginBottom: 10, marginTop: 6 },
  reqCard: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 22, backgroundColor: love.blush, borderWidth: 1, borderColor: love.blushLine, marginBottom: 10 },
  reqQuote: { fontFamily: fonts.serifItalic, fontSize: 15, color: love.wine, lineHeight: 21 },
  newVip: { position: 'absolute', top: 0, right: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: love.plum, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: love.paper },
  newName: { fontFamily: fonts.serifBold, fontSize: 14.5, color: love.ink, marginTop: 6, textAlign: 'center' },
  convCard: { borderRadius: 24, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine, paddingHorizontal: 14, ...lshadow.sm },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: love.blush, minHeight: 72 },
  rowName: { fontFamily: fonts.serifBold, fontSize: 17, color: love.ink, flexShrink: 1 },
  rowAge: { fontFamily: fonts.serif, color: love.muted },
  rowSub: { fontSize: 13.5, color: love.muted, marginTop: 2, lineHeight: 19 },
  vip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, backgroundColor: '#1A1210', borderWidth: 1, borderColor: 'rgba(244,216,140,0.6)' },
  vipText: { fontSize: 9.5, fontWeight: '900', color: love.goldBright, letterSpacing: 0.6 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: love.rose, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  // editor
  fieldLabel: { fontSize: 13.5, fontWeight: '800', color: love.ink },
  fieldHint: { fontSize: 12.5, color: love.muted, marginTop: 3, marginBottom: 6, lineHeight: 18 },
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: love.goldPale, borderWidth: 1, borderColor: 'rgba(166,109,34,0.35)' },
  lockPillText: { fontSize: 11, fontWeight: '900', color: love.goldInk },
  promptBox: { marginTop: 10, padding: 12, borderRadius: 18, backgroundColor: love.blush },
  promptNum: { fontFamily: fonts.serifItalic, fontSize: 14, color: love.wine, marginBottom: 6 },
  promptChip: { paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine },
  promptChipOn: { backgroundColor: love.wine, borderColor: love.wine },
  promptChipText: { fontSize: 13, color: love.ink, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, minHeight: 44 },
  confirmRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 22, padding: 14, borderRadius: 18, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: love.roseSoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  confirmText: { flex: 1, fontSize: 14, color: love.ink, lineHeight: 20 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 12 },
  photoCell: { width: '31.5%', aspectRatio: 0.78, borderRadius: 16, overflow: 'hidden', backgroundColor: love.blush },
  photoMain: { borderWidth: 2, borderColor: love.goldBright },
  photoScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  photoState: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  photoStateText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
  photoTools: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 5 },
  photoTool: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
  photoAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: love.roseSoft, backgroundColor: love.blush },
  photoSlot: { borderColor: love.blushLine, backgroundColor: colors.surface },
  addDisc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoAddText: { fontSize: 12, fontWeight: '800', color: love.wine, marginTop: 6 },
  // profile view
  heroTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 120 },
  heroScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
  heroBars: { position: 'absolute', top: 10, left: 16, right: 16, flexDirection: 'row', gap: 5 },
  heroBar: { flex: 1, height: 3.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)' },
  heroNav: { position: 'absolute', top: 22, left: 14, right: 14, flexDirection: 'row' },
  heroInfo: { position: 'absolute', left: 20, right: 20, bottom: 22 },
  heroName: { fontFamily: fonts.serifBold, fontSize: 40, color: '#FFFFFF', letterSpacing: -0.8, flexShrink: 1 },
  heroAge: { fontFamily: fonts.serif, fontSize: 32, color: 'rgba(255,255,255,0.9)' },
  heroMeta: { fontSize: 14.5, color: 'rgba(255,255,255,0.92)', fontWeight: '600' },
  viewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 16 },
  viewBio: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 27, color: love.ink, marginTop: 8 },
  quoteCard: { marginTop: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, borderRadius: 24, backgroundColor: love.blush, borderWidth: 1, borderColor: love.blushLine, overflow: 'hidden' },
  quoteMark: { position: 'absolute', right: 14, top: -18, fontFamily: fonts.serifBold, fontSize: 110, color: 'rgba(166,109,34,0.22)' },
  promptQ: { fontSize: 11.5, fontWeight: '800', color: love.rose, letterSpacing: 1.1, textTransform: 'uppercase' },
  promptA: { fontFamily: fonts.serifBoldItalic, fontSize: 23, lineHeight: 30, color: love.wine, marginTop: 8 },
  faithRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: love.blush },
  faithIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: love.blush, alignItems: 'center', justifyContent: 'center' },
  faithLabel: { fontSize: 13, color: love.muted, fontWeight: '600', width: 92 },
  faithValue: { flex: 1, fontFamily: fonts.serifBold, fontSize: 16, color: love.ink, textAlign: 'right' },
  reqBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, padding: 16, borderRadius: 22, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine, ...lshadow.sm },
  reqIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: love.blush, alignItems: 'center', justifyContent: 'center' },
  reqTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: love.ink },
  viewFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 18 },
  reqInput: { marginTop: 12, minHeight: 96, borderRadius: 16, borderWidth: 1, borderColor: love.blushLine, backgroundColor: love.card, padding: 12, fontSize: 15, color: love.ink, textAlignVertical: 'top' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 52, borderBottomWidth: 1, borderBottomColor: love.blush },
  menuIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: love.blush, alignItems: 'center', justifyContent: 'center' },
  menuText: { flex: 1, fontSize: 15, fontWeight: '600', color: love.ink },
  // chat
  chatScreen: { flex: 1, backgroundColor: love.paper },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: love.blushLine, backgroundColor: colors.surface },
  chatWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, minHeight: 44 },
  chatName: { fontFamily: fonts.serifBold, fontSize: 19, color: love.ink, flexShrink: 1 },
  chatSub: { fontSize: 12, color: love.rose, fontWeight: '700' },
  socialBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40, borderBottomWidth: 1, borderBottomColor: love.blushLine, backgroundColor: love.card },
  socialText: { flex: 1, minWidth: 0, fontSize: 12.5, color: love.ink },
  meterWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface },
  meterPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, minHeight: 34, borderRadius: 17, backgroundColor: love.blush, borderWidth: 1, borderColor: love.blushLine },
  meterText: { fontSize: 12.5, color: love.wine, fontWeight: '700', flexShrink: 1 },
  meterTrack: { flex: 1, minWidth: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(237,92,18,0.16)', overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  meterLink: { minHeight: 44, justifyContent: 'center' },
  reqBanner: { padding: 14, backgroundColor: love.goldPale, borderBottomWidth: 1, borderBottomColor: 'rgba(166,109,34,0.3)' },
  reqBannerText: { fontSize: 13.5, color: love.ink, lineHeight: 19 },
  lockPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 24, backgroundColor: love.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: love.blushLine, alignItems: 'center', overflow: 'hidden', ...lshadow.md },
  lockHeart: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 8 },
  lockPanelTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: love.ink, textAlign: 'center', letterSpacing: -0.3 },
  lockPanelBody: { fontSize: 13.5, lineHeight: 19, color: love.muted, textAlign: 'center', marginTop: 5 },
});
