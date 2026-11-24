// MEMBERSHIPS & PAID CHANNELS (brief section 8) — one membership system shown in three places:
//   Discover › Memberships (MembershipsCatalog + "My Memberships" row) · Paid Channels (PaidChannelsRail, in place of the
//   Fellowship section) · My Channels (MyChannelsScreen, where Clip Farm used to be in Socials).
// Screens: MembershipsScreen (full catalogue) · MembershipScreen (product page, sticky Join → Choose a plan → Checkout)
//          MembershipReviewsScreen · MembershipHomeScreen (MASTER CLASS | EXECUTIVE CLASS + Library, Media, Members,
//          Settings; locked "Renew" state when lapsed; once-only welcome pop-up) · MyChannelsScreen.
//          Group admin screens (members, admins & permissions, settings, media): screens/MembershipGroupScreens.js.
//          Layout and flow follow the client's reference video; look and feel follow "Sanctuary Paper".
// Payments: Paystack (card, bank transfer, USSD) on Paystack's own page — src/billing/paystack.js; the server verifies
// and grants access once. A test checkout appears for admins / testers. No card numbers are ever typed in the app.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, Button, Empty, Notice, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, AnimatedModal } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';
import { openBlog } from '../api/learn';
import { payWithPaystack, paystackMessage, paystackError } from '../billing/paystack';
import { ChatScreen } from './ChatScreen';
import {
  useMembershipCatalog, useMyMemberships, useMembership, membershipsChanged, getCheckout, quotePromo, submitCheckout, getHome,
  getLibrary, setLessonDone, getReviews, postReview, isMembershipRequired, friendly, ratingLabel, initialsOf, joinedLabel,
  writtenLabel, untilLabel, newKey, joinFreeGroup, askToJoin, markWelcomeSeen, MASTER, EXECUTIVE,
} from '../api/memberships';
import { WelcomeModal } from './MembershipGroupScreens'; // MEMBERSHIP GROUPS: once-only welcome pop-up

const SORTS = [
  { id: 'trending', label: 'Trending' },
  { id: 'newest', label: 'Newest' },
  { id: 'price_low', label: 'Price: low to high' },
  { id: 'price_high', label: 'Price: high to low' },
];

// ---------------------------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------------------------

/** Two-option (or more) segmented toggle in the app's light segment style; the selected option slides. */
export function SegmentToggle({ options, value, onChange, style }) {
  const [w, setW] = useState(0);
  const PAD = 3;
  const tabW = w ? (w - PAD * 2) / options.length : 0;
  const x = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!tabW) return;
    const to = PAD + Math.max(0, options.findIndex((o) => o.id === value)) * tabW;
    if (!placed.current) { placed.current = true; x.setValue(to); return; }
    Animated.spring(x, { toValue: to, useNativeDriver: false, speed: 20, bounciness: 6 }).start();
  }, [value, tabW]);
  return (
    <View style={[styles.segRow, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {tabW ? <Animated.View pointerEvents="none" style={[styles.segPill, { width: tabW, transform: [{ translateX: x }] }]} /> : null}
      {options.map((o) => {
        const on = value === o.id;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} style={styles.segTab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label}>
            {o.icon ? <Icon name={o.icon} size={14} color={on ? colors.primary : colors.muted} strokeWidth={on ? 2.4 : 2} /> : null}
            <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{o.label}</Text>
            {o.badge ? <View style={styles.segBadge}><Text style={styles.segBadgeText}>{o.badge}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontal swipe between the two Discover tabs (horizontal scrollers inside keep their own gestures). */
export function useSwipeTabs(onLeft, onRight) {
  return useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,
    onPanResponderRelease: (_, g) => { if (g.dx < -50) onLeft(); else if (g.dx > 50) onRight(); },
  }), [onLeft, onRight]);
}

function Stars({ value = 0, size = 12, color = colors.gold }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={size} color={color} fill={i <= Math.round(value) ? color : 'none'} strokeWidth={1.6} />)}
    </View>
  );
}

function RatingLine({ rating, style }) {
  return (
    <View style={[styles.ratingLine, style]}>
      <Icon name="star" size={13} color={colors.gold} fill={colors.gold} strokeWidth={1.4} />
      <Text style={styles.ratingNum}>{ratingLabel(rating)}</Text>
      <Text style={styles.ratingCount}>({(rating && rating.count) || 0})</Text>
    </View>
  );
}

function Cover({ uri, style, children }) {
  return (
    <View style={[styles.cover, style]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.night }]}>
          <Icon name="cross" size={32} color={colors.goldLight} />
        </View>
      )}
      {children}
    </View>
  );
}

function PricePill({ label, style }) {
  if (!label) return null;
  return <View style={[styles.pricePill, style]}><Text style={styles.pricePillText} numberOfLines={1}>{label}</Text></View>;
}

/** The big catalogue card (reference: 16:9 cover + price pill, title, ★ rating (count), headline). */
export function MembershipCard({ m, onPress, index = 0 }) {
  return (
    <FadeInUp index={index} distance={12} stagger={50}>
      <PressScale onPress={onPress} scaleTo={0.98} style={styles.card} accessibilityRole="button" accessibilityLabel={`${m.title}, ${m.priceLabel || ''}`}>
        <Cover uri={m.coverUrl} style={styles.cardCover}>
          <PricePill label={m.priceLabel} style={styles.pricePillPos} />
          {m.hasPreview ? (
            <View style={styles.previewBadge}><Icon name="play" size={10} color="#FFFFFF" fill="#FFFFFF" /><Text style={styles.previewText}>Preview</Text></View>
          ) : null}
        </Cover>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{m.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 }}>
            <RatingLine rating={m.rating} />
            <Text style={styles.cardMeta}>·  {m.memberCount.toLocaleString()} member{m.memberCount === 1 ? '' : 's'}</Text>
          </View>
          {m.headline ? <Text style={styles.cardHeadline} numberOfLines={2}>{m.headline}</Text> : null}
        </View>
      </PressScale>
    </FadeInUp>
  );
}

function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const cur = SORTS.find((s) => s.id === value) || SORTS[0];
  return (
    <View style={{ zIndex: 5 }}>
      <Pressable onPress={() => setOpen(!open)} style={styles.sortBtn} accessibilityRole="button" accessibilityLabel={`Sort: ${cur.label}`}>
        <Text style={styles.sortText}>{cur.label}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} color={colors.muted} />
      </Pressable>
      {open ? (
        <FadeInUp distance={-6} duration={180} style={styles.sortMenu}>
          {SORTS.map((s) => (
            <Pressable key={s.id} onPress={() => { setOpen(false); onChange(s.id); }} style={({ pressed }) => [styles.sortRow, pressed && { backgroundColor: colors.raised }]}>
              <Text style={[styles.sortRowText, s.id === value && { color: colors.primary, fontWeight: '700' }]}>{s.label}</Text>
              {s.id === value ? <Icon name="check" size={14} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </FadeInUp>
      ) : null}
    </View>
  );
}

function CategoryTabs({ categories, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow} style={styles.catScroll}>
      {categories.map((c) => {
        const on = c.name === value;
        return (
          <Pressable key={c.name} onPress={() => onChange(c.name)} style={[styles.catTab, on && styles.catTabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <Text style={[styles.catText, on && styles.catTextOn]}>{c.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** "My Memberships" row: active first, lapsed ones show a Renew tag. */
export function MyMembershipsRow({ nav, style }) {
  const mine = useMyMemberships();
  if (!mine.items.length) return null;
  return (
    <View style={style}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>My Memberships</Text>
        <Pressable onPress={() => nav.push('MyChannels')} hitSlop={8}><Text style={styles.link}>See all</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 18 }} style={{ marginHorizontal: -18 }}>
        {mine.items.map((m) => (
          <PressScale key={m.id} scaleTo={0.96} onPress={() => nav.push('MembershipHome', { id: m.id, title: m.title })} style={styles.mineCard} accessibilityLabel={`${m.title}${m.access.active ? '' : ', membership ended'}`}>
            <Cover uri={m.coverUrl} style={styles.mineCover}>
              {!m.access.active ? <View style={styles.mineLock}><Icon name="lock" size={14} color="#FFFFFF" /></View> : null}
            </Cover>
            <Text style={styles.mineTitle} numberOfLines={1}>{m.title}</Text>
            <Text style={[styles.mineSub, !m.access.active && { color: colors.terracotta, fontWeight: '700' }]} numberOfLines={1}>
              {m.access.active ? `Until ${untilLabel(m.access.expiresAt)}` : 'Ended · Renew'}
            </Text>
          </PressScale>
        ))}
      </ScrollView>
    </View>
  );
}

/** Discover › Memberships: category tabs, "N total" + sort, the big cards. `limit` shows the first few + "See all". */
export function MembershipsCatalog({ nav, limit }) {
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('trending');
  const cat = useMembershipCatalog({ category, sort });
  const items = limit ? cat.items.slice(0, limit) : cat.items;
  if (!cat.online) {
    return <Notice text="Memberships need a connection to BibleNestra — sign in to browse paid channels." />;
  }
  return (
    <View>
      <CategoryTabs categories={cat.categories} value={category} onChange={setCategory} />
      <View style={styles.totalRow}>
        <Text style={styles.totalText}>{cat.total.toLocaleString()} total</Text>
        <SortMenu value={sort} onChange={setSort} />
      </View>
      {!cat.loaded ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} /> : null}
      {cat.loaded && cat.error && !items.length ? <Empty title="Couldn’t load memberships" body={friendly(cat.error)} action="Try again" onAction={cat.reload} /> : null}
      {cat.loaded && !cat.error && !items.length ? <Empty title="Nothing here yet" body="New paid channels from trusted ministers appear here." /> : null}
      <View style={{ gap: 14 }}>
        {items.map((m, i) => <MembershipCard key={m.id} m={m} index={i} onPress={() => nav.push('Membership', { id: m.id, title: m.title })} />)}
      </View>
      {limit && cat.total > items.length ? (
        <Pressable onPress={() => nav.push('Memberships', { category, sort })} style={styles.seeAllBtn} accessibilityRole="button">
          <Text style={styles.seeAllText}>See all {cat.total} memberships</Text>
          <Icon name="arrow-right" size={14} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 8.2 Paid Channels (in place of the Fellowship section): thumbnail, title, tagline, price, member count, Preview badge. */
export function PaidChannelsRail({ nav }) {
  const cat = useMembershipCatalog({ category: 'All', sort: 'trending' });
  if (!cat.online || (cat.loaded && !cat.items.length)) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>
      {cat.items.slice(0, 10).map((m) => (
        <PressScale key={m.id} scaleTo={0.97} onPress={() => nav.push('Membership', { id: m.id, title: m.title })} style={styles.railCard} accessibilityLabel={`${m.title}, ${m.priceLabel || ''}`}>
          <Cover uri={m.coverUrl} style={styles.railCover}>
            {m.hasPreview ? <View style={[styles.previewBadge, { left: 8, bottom: 8 }]}><Icon name="play" size={9} color="#FFFFFF" fill="#FFFFFF" /><Text style={styles.previewText}>Preview</Text></View> : null}
          </Cover>
          <View style={{ padding: 11, gap: 3 }}>
            <Text style={styles.railTitle} numberOfLines={1}>{m.title}</Text>
            <Text style={styles.railTag} numberOfLines={2}>{m.headline}</Text>
            <View style={styles.railFoot}>
              <Text style={styles.railPrice} numberOfLines={1}>{m.priceLabel}</Text>
              <View style={styles.inline}><Icon name="users" size={11} color={colors.faint} /><Text style={styles.railMembers}>{m.memberCount}</Text></View>
            </View>
          </View>
        </PressScale>
      ))}
    </ScrollView>
  );
}

/** Discover › Find Love — Phase 3. */
export function FindLoveSoon() {
  const toast = useToast();
  return (
    <FadeInUp style={styles.loveCard}>
      <View style={styles.loveIcon}><Icon name="heart" size={30} color={colors.rose} fill={alpha(colors.rose, 0.18)} /></View>
      <Text style={styles.loveEyebrow}>Coming soon</Text>
      <Text style={styles.loveTitle}>Find Love</Text>
      <Text style={styles.loveBody}>Christian friendship and dating, built with care — faith-first profiles, verified members and safety you can trust. We’re preparing it for a later release.</Text>
      {[['shield', 'Verified, respectful community'], ['cross', 'Faith-first matching'], ['heart', 'Prayerful, unhurried conversations']].map(([icon, t]) => (
        <View key={t} style={styles.loveRow}><Icon name={icon} size={15} color={colors.rose} /><Text style={styles.loveRowText}>{t}</Text></View>
      ))}
      <Button label="Notify me when it opens" kind="ghost" onPress={() => toast.show('We’ll let you know when Find Love opens', { icon: 'bell' })} style={{ marginTop: 16, alignSelf: 'stretch' }} />
    </FadeInUp>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Full catalogue screen ("See all")
// ---------------------------------------------------------------------------------------------------------------
export function MembershipsScreen() {
  const nav = useNav();
  return (
    <Screen back title="Memberships" subtitle="Paid channels from trusted ministers">
      <MyMembershipsRow nav={nav} style={{ marginBottom: 14 }} />
      <MembershipsCatalog nav={nav} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------------------------------------------
function TopBar({ title, onBack, right }) {
  return (
    <View style={styles.top}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.topBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Icon name="chevron-left" size={20} color={colors.fg} />
      </Pressable>
      <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.topBtn}>{right || null}</View>
    </View>
  );
}

function Faq({ f, index }) {
  const [open, setOpen] = useState(false);
  return (
    <FadeInUp index={index} distance={8} stagger={40}>
      <Pressable onPress={() => setOpen(!open)} style={styles.faq} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.faqHead}>
          <Text style={styles.faqQ}>{f.q}</Text>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} color={colors.muted} />
        </View>
        {open && f.a ? <Text style={styles.faqA}>{f.a}</Text> : null}
      </Pressable>
    </FadeInUp>
  );
}

export function ReviewRow({ r }) {
  return (
    <View style={styles.review}>
      <View style={styles.reviewHead}>
        <View style={styles.initials}><Text style={styles.initialsText}>{initialsOf(r.user.name)}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={styles.reviewName} numberOfLines={1}>{r.user.name}</Text>
            <Stars value={r.rating} />
          </View>
          <Text style={styles.reviewDate}>{writtenLabel(r.createdAt)}</Text>
        </View>
      </View>
      {r.body ? <Text style={styles.reviewBody}>{r.body}</Text> : null}
    </View>
  );
}

export function MembershipScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const api = useApi();
  const ref = params.id || params.slug;
  const { data: m, error, loaded, reload } = useMembership(ref);
  const [sheet, setSheet] = useState(null); // 'plans' | 'checkout'
  const [planId, setPlanId] = useState(null);
  const [writing, setWriting] = useState(false);
  const autoJoined = useRef(false);

  useEffect(() => {
    if (m && params.join && !autoJoined.current && m.purchasable && !(m.access && m.access.active)) { autoJoined.current = true; setSheet('plans'); }
  }, [m && m.id]);

  if (!m) {
    return (
      <View style={styles.page}>
        <TopBar title={params.title || 'Membership'} onBack={() => nav.pop()} />
        {loaded && error ? <Empty title="Membership not found" body={friendly(error, 'It may have been archived.')} action="Browse memberships" onAction={() => nav.replace('Memberships')} /> : <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />}
      </View>
    );
  }
  const active = m.access && m.access.active;
  const lapsed = m.access && m.access.lapsed;
  const canOpen = active || m.isStaff;
  // MEMBERSHIP GROUPS: approval-based groups ask first (paid ones check out once approved); free groups join in one tap
  const needsApproval = !canOpen && !lapsed && m.joinMode === 'approval' && m.joinRequest !== 'approved';
  const pending = needsApproval && m.joinRequest === 'pending';
  const join = async () => {
    if (canOpen) { nav.push('MembershipHome', { id: m.id, title: m.title }); return; }
    if (!m.purchasable) { toast.show('This membership isn’t taking new members right now', { icon: 'lock' }); return; }
    if (pending) { toast.show('Your request is with the group admins. We’ll let you know.', { icon: 'clock' }); return; }
    if (needsApproval || m.free) {
      try {
        const r = m.free ? await joinFreeGroup(api, m.id) : await askToJoin(api, m.id);
        membershipsChanged(); reload();
        if (r.status === 'member') { nav.push('MembershipHome', { id: m.id, title: m.title }); return; }
        toast.show('Request sent · an admin will approve you soon', { icon: 'check' });
      } catch (e) { toast.show(friendly(e), { tone: 'error' }); }
      return;
    }
    setSheet('plans');
  };
  const joinLabel = canOpen ? 'Open group' : lapsed ? 'Renew' : pending ? 'Request sent · waiting for approval' : needsApproval ? 'Ask to join' : m.free ? 'Join for free' : 'Join';

  return (
    <View style={styles.page}>
      <TopBar title={m.title} onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        <Cover uri={m.coverUrl} style={styles.heroCover}>
          {m.introVideoUrl ? (
            <PressScale onPress={() => nav.push('EmbedViewer', { url: m.introVideoUrl })} scaleTo={0.94} style={styles.heroPlay} accessibilityLabel="Watch the intro video">
              <Icon name="play" size={14} color={colors.night} fill={colors.night} />
              <Text style={styles.heroPlayText}>Watch intro</Text>
            </PressScale>
          ) : null}
          <PricePill label={m.priceLabel} style={styles.pricePillPos} />
        </Cover>
        <View style={styles.pad}>
          <Text style={styles.prodName}>{m.title}</Text>
          {m.headline ? <Text style={styles.prodHeadline}>{m.headline}</Text> : null}
          <View style={styles.prodStats}>
            <RatingLine rating={m.rating} />
            <Text style={styles.cardMeta}>·  {m.memberCount.toLocaleString()} members  ·  {m.category}</Text>
          </View>
          {m.description ? <Text style={styles.prodDesc}>{m.description}</Text> : null}
          {active ? (
            <View style={styles.memberBanner}>
              <Icon name="check-circle" size={16} color={colors.positive} />
              <Text style={styles.memberBannerText}>You’re a member · until {untilLabel(m.access.expiresAt)}</Text>
            </View>
          ) : lapsed ? (
            <View style={[styles.memberBanner, { backgroundColor: colors.terracottaFaint }]}>
              <Icon name="lock" size={15} color={colors.terracotta} />
              <Text style={[styles.memberBannerText, { color: colors.terracotta }]}>Your membership ended {untilLabel(m.access.expiresAt)} · renew to get back in</Text>
            </View>
          ) : null}

          {m.benefits.length ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>What you get</Text>
              {m.benefits.map((b) => (
                <View key={b} style={styles.benefit}><View style={styles.benefitDot}><Icon name="check" size={11} color={colors.primary} strokeWidth={2.8} /></View><Text style={styles.benefitText}>{b}</Text></View>
              ))}
            </View>
          ) : null}

          {m.sampleLessons.length ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Inside the library</Text>
              <Text style={styles.blockSub}>{m.lessonCount} lesson{m.lessonCount === 1 ? '' : 's'} · for members</Text>
              {m.sampleLessons.map((l, i) => (
                <View key={l.id} style={styles.sample}>
                  <Text style={styles.sampleNum}>{i + 1}</Text>
                  <Text style={styles.sampleTitle} numberOfLines={1}>{l.title}</Text>
                  <Icon name={l.kind === 'video' ? 'play' : l.kind === 'file' ? 'download' : 'book'} size={14} color={colors.faint} />
                  {l.minutes ? <Text style={styles.sampleMin}>{l.minutes} min</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Learn about me — the creator */}
          <Text style={styles.sectionCenter}>Learn about me</Text>
          <View style={styles.creator}>
            <SocialAvatar name={m.creator.name} uri={m.creator.avatarUrl} size={72} />
            <Text style={styles.creatorName}>{m.creator.name}</Text>
            <Text style={styles.creatorMeta}>{[m.creator.handle ? `@${m.creator.handle}` : null, joinedLabel(m.creator.joinedAt)].filter(Boolean).join(' • ')}</Text>
            {m.creator.bio ? <Text style={styles.creatorBio}>{m.creator.bio}</Text> : null}
            {m.creator.id ? (
              <Pressable onPress={() => nav.push('UserProfile', { id: m.creator.id, name: m.creator.name })} style={styles.viewProfile} accessibilityRole="button">
                <Text style={styles.viewProfileText}>View Profile</Text>
              </Pressable>
            ) : null}
          </View>

          {m.faqs.length ? (
            <>
              <Text style={styles.sectionCenter}>Frequently asked questions</Text>
              <View style={{ gap: 8 }}>{m.faqs.map((f, i) => <Faq key={f.q} f={f} index={i} />)}</View>
            </>
          ) : null}

          <View style={styles.reviewsHead}>
            <Text style={styles.blockTitle}>Reviews</Text>
            <Pressable onPress={() => nav.push('MembershipReviews', { id: m.id, title: m.title, canReview: m.canReview })} hitSlop={8}><Text style={styles.link}>See all</Text></Pressable>
          </View>
          {m.reviews.length ? <View style={{ gap: 8 }}>{m.reviews.slice(0, 3).map((r) => <ReviewRow key={r.id} r={r} />)}</View> : <Text style={styles.blockSub}>No reviews yet.</Text>}
          {m.canReview ? <Button label="Write a review" kind="ghost" onPress={() => setWriting(true)} style={{ marginTop: 10 }} /> : null}
          {m.myReview ? <Text style={[styles.blockSub, { marginTop: 8 }]}>You rated this {m.myReview.rating}/5 — thank you.</Text> : null}
        </View>
      </ScrollView>

      {/* sticky Join */}
      <View style={styles.sticky}>
        <PressScale onPress={join} scaleTo={0.98} style={[styles.joinBtn, lapsed && !canOpen && { backgroundColor: colors.terracotta }, pending && { backgroundColor: colors.muted }]} accessibilityRole="button" accessibilityLabel={joinLabel}>
          <Text style={styles.joinText}>{joinLabel}</Text>
        </PressScale>
      </View>

      <ChoosePlanSheet visible={sheet === 'plans'} m={m} value={planId} onChange={setPlanId} onClose={() => setSheet(null)} onContinue={(id) => { setPlanId(id); setSheet('checkout'); }} />
      <CheckoutSheet
        visible={sheet === 'checkout'}
        m={m}
        planId={planId}
        onClose={() => setSheet(null)}
        onBack={() => setSheet('plans')}
        onJoined={() => { setSheet(null); membershipsChanged(); reload(); nav.push('MembershipHome', { id: m.id, title: m.title, welcome: true }); }}
      />
      <WriteReviewSheet visible={writing} membershipId={m.id} onClose={() => setWriting(false)} onDone={() => { setWriting(false); membershipsChanged(); reload(); }} />
    </View>
  );
}

function Sheet({ visible, onClose, children, tall }) {
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={[styles.sheet, tall && { maxHeight: '92%' }]}>
          <View style={styles.grabber} />
          {children}
        </View>
      </View>
    </AnimatedModal>
  );
}

function ChoosePlanSheet({ visible, m, value, onChange, onClose, onContinue }) {
  const plans = m.plans || [];
  const sel = value && plans.some((p) => p.id === value) ? value : plans[0] && plans[0].id;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Choose a plan</Text>
      <View style={{ gap: 10, marginTop: 12 }}>
        {plans.map((p) => {
          const on = p.id === sel;
          return (
            <PressScale key={p.id} scaleTo={0.98} onPress={() => onChange(p.id)} style={[styles.plan, on && styles.planOn]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${p.name}, ${p.displayPrice}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planName}>{p.interval === 'one_time' ? p.name : `${p.name} · renews`}</Text>
                <Text style={styles.planPrice}>{p.displayPrice}</Text>
                <Text style={styles.planPer}>{p.perLabel}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
            </PressScale>
          );
        })}
      </View>
      <PressScale onPress={() => sel && onContinue(sel)} scaleTo={0.98} style={[styles.joinBtn, { marginTop: 16 }]} accessibilityRole="button">
        <Text style={styles.joinText}>Continue</Text>
      </PressScale>
    </Sheet>
  );
}

function Check({ on, onPress, label }) {
  return (
    <Pressable onPress={onPress} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[styles.checkBox, on && styles.checkBoxOn]}>{on ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}</View>
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  );
}

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

function CheckoutSheet({ visible, m, planId, onClose, onBack, onJoined }) {
  const api = useApi();
  const sync = useSync();
  const toast = useToast();
  const plan = (m.plans || []).find((p) => p.id === planId) || (m.plans || [])[0];
  const signedEmail = looksLikeEmail(api.email) ? api.email : '';
  const [cfg, setCfg] = useState(null);
  const [cfgErr, setCfgErr] = useState(null);
  const [email, setEmail] = useState(signedEmail);
  const [otherEmail, setOtherEmail] = useState(!signedEmail);
  const [answers, setAnswers] = useState([]);
  const [badQ, setBadQ] = useState(-1);
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('Nigeria');
  const [company, setCompany] = useState(false);
  const [agree, setAgree] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  useEffect(() => {
    if (!visible) return;
    key.current = newKey();
    setQuote(null); setBadQ(-1); setCfgErr(null);
    getCheckout(api, m.id).then((d) => {
      setCfg(d);
      const first = d.methods.find((x) => x.available);
      setMethod(first ? first.id : null);
    }).catch((e) => setCfgErr(friendly(e)));
  }, [visible, m.id]);

  if (!plan) return null;
  const questions = m.questions || [];
  const methods = (cfg && cfg.methods) || [];
  const chosen = methods.find((x) => x.id === method);
  const price = quote ? quote.totalLabel : plan.priceLabel;

  const applyPromo = async () => {
    if (!promo.trim()) return;
    try { setQuote(await quotePromo(api, m.id, plan.id, promo.trim())); toast.show('Promo code applied', { icon: 'check' }); }
    catch (e) { setQuote(null); toast.show(friendly(e, 'That code isn’t valid'), { tone: 'error' }); }
  };
  const pay = async () => {
    const missing = questions.findIndex((q, i) => q.required && !String(answers[i] || '').trim());
    if (missing >= 0) { setBadQ(missing); toast.show('Please answer the required questions', { tone: 'error' }); return; }
    if (!agree) { toast.show('Please agree to the terms and conditions', { tone: 'error' }); return; }
    if (!chosen || !chosen.available) { toast.show((cfg && cfg.message) || 'Payments are coming soon — ask an admin for access.', { icon: 'clock' }); return; }
    if (chosen.provider === 'paystack' && !looksLikeEmail(email.trim())) { toast.show('Enter your email — Paystack sends the receipt there', { tone: 'error' }); return; }
    setBusy(true);
    try {
      const send = (mail) => submitCheckout(api, m.id, {
        planId: plan.id, provider: chosen.provider, answers: questions.map((_, i) => answers[i] || ''), promoCode: quote ? quote.promoCode : null,
        contact: { email: email.trim(), phone: phone.trim(), name: name.trim(), country: country.trim(), company }, agree: true, idempotencyKey: key.current,
        email: mail || email.trim(),
      });
      if (chosen.provider === 'paystack') {
        const r = await payWithPaystack(api, send, { email: email.trim() });
        if (r.status !== 'success') { toast.show(paystackMessage(r.status), { icon: 'clock', duration: 5000 }); setBusy(false); return; }
      } else {
        await send();
      }
      toast.show(`Welcome to ${m.title}!`, { icon: 'check' });
      if (sync.refresh) sync.refresh().catch(() => {});
      onJoined();
    } catch (e) {
      if (e.code === 'ANSWER_REQUIRED' && e.data) setBadQ(e.data.questionIndex);
      toast.show(['PAYMENTS_PAUSED', 'PAYMENTS_NOT_CONFIGURED'].includes(e.code) ? paystackError(e) : friendly(e, 'Couldn’t complete checkout'), { tone: 'error' });
    }
    setBusy(false);
  };

  return (
    <Sheet visible={visible} onClose={onClose} tall>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 18 }}>
        <View style={styles.coHead}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back to plans"><Icon name="chevron-left" size={18} color={colors.muted} /></Pressable>
          <SocialAvatar name={cfg ? cfg.seller : m.creator.name} uri={m.creator.avatarUrl} size={26} />
          <Text style={styles.coSeller} numberOfLines={1}>{cfg ? cfg.seller : m.creator.name}</Text>
          <Pressable onPress={() => setPromoOpen(!promoOpen)} hitSlop={8}><Text style={styles.coPromoLink}>Promo code & details</Text></Pressable>
        </View>
        <View style={styles.coSummary}>
          <Text style={styles.coName}>{m.title}</Text>
          {m.headline ? <Text style={styles.coHeadline} numberOfLines={2}>{m.headline}</Text> : null}
          <Text style={styles.coPrice}>{price}{plan.periodLabel ? <Text style={styles.coPer}> {plan.periodLabel}</Text> : null}</Text>
          {quote && quote.discountLabel ? <Text style={styles.coDiscount}>{plan.priceLabel} − {quote.discountLabel} ({quote.promoCode})</Text> : null}
          <Text style={styles.coAccess}>{plan.accessText}.</Text>
          {promoOpen ? (
            <View style={styles.promoRow}>
              <TextInput value={promo} onChangeText={(t) => setPromo(t.toUpperCase())} placeholder="Promo code" placeholderTextColor={colors.faint} autoCapitalize="characters" style={[styles.input, { flex: 1 }]} accessibilityLabel="Promo code" />
              <Button small label="Apply" onPress={applyPromo} />
            </View>
          ) : null}
        </View>

        <Text style={styles.label}>Email</Text>
        {otherEmail ? (
          <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.faint} keyboardType="email-address" autoCapitalize="none" style={styles.input} accessibilityLabel="Email" />
        ) : (
          <>
            <View style={[styles.input, styles.inputLocked]}><Text style={styles.inputLockedText} numberOfLines={1}>{email}</Text></View>
            <View style={styles.signedRow}>
              <Text style={styles.small}>Signed in</Text>
              <Pressable onPress={() => { setOtherEmail(true); setEmail(''); }} hitSlop={6}><Text style={styles.smallLink}>Use a different email</Text></Pressable>
            </View>
          </>
        )}

        {questions.map((q, i) => (
          <View key={q.label}>
            <Text style={styles.label}>{q.label}{q.required ? <Text style={{ color: colors.negative }}> *</Text> : null}</Text>
            <TextInput
              value={answers[i] || ''}
              onChangeText={(t) => { const next = answers.slice(); next[i] = t; setAnswers(next); if (badQ === i) setBadQ(-1); }}
              placeholder="Answer here"
              placeholderTextColor={colors.faint}
              style={[styles.input, badQ === i && { borderColor: colors.negative }]}
              accessibilityLabel={q.label}
              maxLength={1000}
            />
          </View>
        ))}

        <Text style={styles.label}>Phone number</Text>
        <TextInput value={phone} onChangeText={setPhone} placeholder="+234 800 000 0000" placeholderTextColor={colors.faint} keyboardType="phone-pad" style={styles.input} accessibilityLabel="Phone number" maxLength={40} />

        <Text style={[styles.label, { marginTop: 18 }]}>Payment method</Text>
        {cfgErr ? <Notice text={cfgErr} /> : null}
        {!cfg && !cfgErr ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} /> : null}
        <View style={styles.methods}>
          {methods.map((x, i) => {
            const on = x.id === method;
            return (
              <Pressable key={x.id} disabled={!x.available} onPress={() => setMethod(x.id)} style={[styles.methodRow, i > 0 && styles.methodDivider, !x.available && { opacity: 0.55 }]} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !x.available }} accessibilityLabel={`${x.label}${x.available ? '' : ', coming soon'}`}>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                <View style={styles.methodIcon}><Icon name={x.id === 'test' ? 'sparkles' : x.id === 'paystack' ? 'lock' : x.id === 'google_play' ? 'play' : x.id === 'apple' ? 'lock' : x.id === 'crypto' ? 'coin' : 'briefcase'} size={14} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.methodLabel}>{x.label}</Text>
                  {x.note ? <Text style={styles.methodNote}>{x.note}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {cfg && !cfg.canPay ? <Notice text={cfg.message || 'Payments are coming soon — ask an admin for access.'} /> : null}

        <Text style={[styles.label, { marginTop: 18 }]}>Billing details</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="Full name" maxLength={120} />
        <TextInput value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={colors.faint} style={[styles.input, { marginTop: 8 }]} accessibilityLabel="Country" maxLength={60} />
        <Text style={styles.small}>Card details are never typed here — you pay on Paystack’s secure page (card, bank transfer or USSD).</Text>

        <View style={{ marginTop: 14, gap: 10 }}>
          <Check on={company} onPress={() => setCompany(!company)} label="I’m buying on behalf of a church or ministry" />
          <Check on={agree} onPress={() => setAgree(!agree)} label="I agree to all terms and conditions." />
        </View>

        <PressScale onPress={pay} disabled={busy} scaleTo={0.98} style={[styles.shopBtn, (busy || !(chosen && chosen.available)) && { opacity: 0.55 }]} accessibilityRole="button" accessibilityLabel="Join now">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.shopText}>{chosen && chosen.provider === 'test' ? `Join now · ${price} (test)` : chosen && chosen.available ? `Join now · ${price}` : 'Payments coming soon'}</Text>}
        </PressScale>
        <Text style={styles.legal}>By joining, you agree to {cfg ? cfg.seller : 'the seller'}’s policies and BibleNestra’s Terms of Service. Payments are processed by Paystack. Monthly and yearly plans paid by card renew automatically until you cancel in the membership; bank transfer and USSD plans don’t renew — we remind you before they end.</Text>
      </ScrollView>
    </Sheet>
  );
}

function WriteReviewSheet({ visible, membershipId, existing, onClose, onDone }) {
  const api = useApi();
  const toast = useToast();
  const [rating, setRating] = useState(existing ? existing.rating : 5);
  const [text, setText] = useState(existing ? existing.body : '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await postReview(api, membershipId, rating, text.trim(), !!existing); toast.show('Thank you for your review', { icon: 'star' }); onDone(); }
    catch (e) { toast.show(friendly(e, 'Couldn’t save your review'), { tone: 'error' }); }
    setBusy(false);
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>{existing ? 'Edit your review' : 'Write a review'}</Text>
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', marginVertical: 16 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable key={i} onPress={() => setRating(i)} hitSlop={6} accessibilityLabel={`${i} star${i === 1 ? '' : 's'}`}>
            <Icon name="star" size={32} color={colors.gold} fill={i <= rating ? colors.gold : 'none'} strokeWidth={1.5} />
          </Pressable>
        ))}
      </View>
      <TextInput value={text} onChangeText={setText} placeholder="What has this membership meant to you?" placeholderTextColor={colors.faint} multiline style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} maxLength={2000} accessibilityLabel="Your review" />
      <Button label={busy ? 'Saving…' : 'Post review'} onPress={submit} disabled={busy} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

export function MembershipReviewsScreen({ params = {} }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [writing, setWriting] = useState(false);
  const load = () => getReviews(api, params.id).then(setData).catch(setErr);
  useEffect(() => { load(); }, [params.id]);
  const max = data ? Math.max(1, ...data.breakdown.map((b) => b.count)) : 1;
  return (
    <Screen back title="Reviews" subtitle={params.title}>
      {err ? <Empty title="Couldn’t load reviews" body={friendly(err)} /> : null}
      {!data && !err ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : null}
      {data ? (
        <>
          <View style={styles.summary}>
            <View style={{ alignItems: 'center', width: 96 }}>
              <Text style={styles.summaryNum}>{ratingLabel(data.rating)}</Text>
              <Stars value={data.rating.avg} size={13} />
              <Text style={styles.small}>{data.rating.count} review{data.rating.count === 1 ? '' : 's'}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              {data.breakdown.map((b) => (
                <View key={b.stars} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.small}>{b.stars}</Text>
                  <View style={styles.barTrack}><View style={[styles.barFill, { width: `${(b.count / max) * 100}%` }]} /></View>
                  <Text style={[styles.small, { width: 22, textAlign: 'right' }]}>{b.count}</Text>
                </View>
              ))}
            </View>
          </View>
          {params.canReview ? <Button label="Write a review" kind="ghost" onPress={() => setWriting(true)} style={{ marginBottom: 12 }} /> : null}
          <View style={{ gap: 8 }}>{data.items.map((r) => <ReviewRow key={r.id} r={r} />)}</View>
          {!data.items.length ? <Empty title="No reviews yet" body="Members can share how this membership helped them." /> : null}
        </>
      ) : null}
      <WriteReviewSheet visible={writing} membershipId={params.id} onClose={() => setWriting(false)} onDone={() => { setWriting(false); membershipsChanged(); load(); }} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Membership home: MASTER CLASS | EXECUTIVE CLASS + Library (Telegram-like, brief 8.3)
// ---------------------------------------------------------------------------------------------------------------
function LockedState({ m, lapsed, onRenew, onDetails }) {
  // ignore a tap that lands in the first moment (the tap that opened this screen must not also press Renew)
  const armed = useRef(false);
  useEffect(() => { const t = setTimeout(() => { armed.current = true; }, 450); return () => clearTimeout(t); }, []);
  const renew = () => { if (armed.current) onRenew(); };
  return (
    <View style={{ flex: 1 }}>
      <Cover uri={m && m.coverUrl} style={styles.lockCover}><View style={styles.lockScrim} /></Cover>
      <ScaleIn style={styles.lockCard}>
        <View style={styles.lockIcon}><Icon name="lock" size={24} color={colors.primary} /></View>
        <Text style={styles.lockTitle}>{lapsed ? 'Your membership has ended' : 'Members only'}</Text>
        <Text style={styles.lockBody}>{lapsed ? `Renew to get back into ${MASTER}, ${EXECUTIVE} and the Library. Your progress is saved.` : `Join this membership to open ${MASTER}, ${EXECUTIVE} and the Library.`}</Text>
        <PressScale onPress={renew} scaleTo={0.98} style={[styles.joinBtn, { alignSelf: 'stretch', marginTop: 16 }]} accessibilityRole="button">
          <Text style={styles.joinText}>{lapsed ? 'Renew' : 'Join'}</Text>
        </PressScale>
        <Pressable onPress={onDetails} style={{ marginTop: 12 }} hitSlop={8}><Text style={styles.link}>View membership details</Text></Pressable>
      </ScaleIn>
    </View>
  );
}

export function LibraryView({ api, id }) {
  const toast = useToast();
  const [lib, setLib] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { getLibrary(api, id).then(setLib).catch(setErr); }, [id]);
  if (err) return <Empty title="Couldn’t load the library" body={friendly(err)} />;
  if (!lib) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  const toggle = async (l) => {
    try {
      const progress = await setLessonDone(api, id, l.id, !l.completed);
      setLib({ progress, items: lib.items.map((x) => (x.id === l.id ? { ...x, completed: !l.completed } : x)) });
      if (!l.completed) toast.show('Lesson complete', { icon: 'check' });
    } catch (e) { toast.show(friendly(e), { tone: 'error' }); }
  };
  const pct = lib.progress.total ? Math.round((lib.progress.done / lib.progress.total) * 100) : 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40, gap: 10 }}>
      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>{lib.progress.done} of {lib.progress.total} lessons · {pct}%</Text>
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%`, backgroundColor: colors.primary }]} /></View>
      </View>
      {!lib.items.length ? <Empty title="No lessons yet" body="New lessons from your teacher appear here in order." /> : null}
      {lib.items.map((l, i) => (
        <FadeInUp key={l.id} index={i} distance={8} stagger={35}>
          <View style={styles.lesson}>
            <Pressable onPress={() => setOpen(open === l.id ? null : l.id)} style={styles.lessonHead} accessibilityRole="button" accessibilityState={{ expanded: open === l.id }}>
              <View style={[styles.lessonNum, l.completed && { backgroundColor: colors.positive, borderColor: colors.positive }]}>
                {l.completed ? <Icon name="check" size={13} color="#FFFFFF" strokeWidth={3} /> : <Text style={styles.lessonNumText}>{l.position}</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.lessonTitle} numberOfLines={2}>{l.title}</Text>
                <View style={styles.inline}>
                  <Icon name={l.kind === 'video' ? 'play' : l.kind === 'file' ? 'download' : 'book'} size={11} color={colors.faint} />
                  <Text style={styles.small}>{l.kind === 'video' ? 'Video' : l.kind === 'file' ? 'File' : 'Reading'}{l.minutes ? ` · ${l.minutes} min` : ''}</Text>
                </View>
              </View>
              <Icon name={open === l.id ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
            </Pressable>
            {open === l.id ? (
              <View style={{ paddingTop: 10, gap: 10 }}>
                {l.body ? <Text style={styles.lessonBody}>{l.body}</Text> : null}
                {l.mediaUrl ? <Button small kind="ghost" label={l.kind === 'video' ? 'Watch video' : 'Open file'} icon={<Icon name={l.kind === 'video' ? 'play' : 'download'} size={13} color={colors.primary} />} onPress={() => openBlog(l.mediaUrl)} /> : null}
                <Button small kind={l.completed ? 'ghost' : 'primary'} label={l.completed ? 'Completed ✓ (tap to undo)' : 'Mark as complete'} onPress={() => toggle(l)} />
              </View>
            ) : null}
          </View>
        </FadeInUp>
      ))}
    </ScrollView>
  );
}

// MEMBERSHIP GROUPS: the group home — MASTER CLASS | EXECUTIVE CLASS (Telegram's channel + linked discussion), with
// Library, Media, Members and Settings one tap away, and the once-only welcome pop-up.
export function MembershipHomeScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(['community', 'executive'].includes(params.tab) ? 'executive' : 'master');
  const [welcome, setWelcome] = useState(null);
  const load = () => getHome(api, params.id).then((d) => { setHome(d); setErr(null); if (d.welcome && !params.welcomeShown) setWelcome(d.welcome); }).catch(setErr);
  useEffect(() => { load(); }, [params.id]);
  useEffect(() => { if (params.tab === 'library') nav.push('MembershipLibrary', { id: params.id, title: params.title }); }, []);
  const detail = useMembership(params.id); // cover + title for the locked state too
  const m = (home && home.membership) || detail.data;
  const title = (m && m.title) || params.title || 'Membership';
  const locked = isMembershipRequired(err);
  const closeWelcome = (to) => {
    setWelcome(null);
    markWelcomeSeen(api, params.id).catch(() => {});
    if (to) setTab(to);
  };
  const role = home ? home.role : null;
  const tools = home ? [
    { id: 'library', icon: 'book', label: home.library.total ? `Library ${home.library.done}/${home.library.total}` : 'Library', go: () => nav.push('MembershipLibrary', { id: params.id, title }) },
    { id: 'media', icon: 'image', label: 'Media', go: () => nav.push('MembershipMedia', { id: params.id, title, masterId: home.channelId, executiveId: home.communityId }) },
    { id: 'members', icon: 'users', label: 'Members', go: () => nav.push('MembershipMembers', { id: params.id, title }) },
    { id: 'settings', icon: home.isStaff ? 'settings' : 'bell', label: home.isStaff ? 'Settings' : 'Notifications', go: () => nav.push('MembershipSettings', { id: params.id, title }) },
  ] : [];

  return (
    <View style={styles.page}>
      <View style={styles.homeTop}>
        <Pressable onPress={() => nav.pop()} hitSlop={12} style={styles.topBtn} accessibilityRole="button" accessibilityLabel="Back"><Icon name="chevron-left" size={20} color={colors.fg} /></Pressable>
        <Cover uri={m && m.coverUrl} style={styles.homeThumb} />
        <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => nav.push('Membership', { id: params.id, title })} accessibilityRole="button" accessibilityLabel={`${title}. Membership details`}>
          <Text style={styles.homeTitle} numberOfLines={1}>{title}</Text>
          <Text style={[styles.homeSub, locked && { color: colors.terracotta }]} numberOfLines={1}>
            {locked ? (err.data && err.data.lapsed ? 'Membership ended · Renew' : 'Members only') : home ? (role === 'owner' ? 'You own this group' : home.isStaff ? 'You’re an admin' : `Member · until ${untilLabel(home.access.expiresAt)}`) : 'Loading…'}
          </Text>
        </Pressable>
        <Pressable onPress={() => nav.push('Membership', { id: params.id, title })} hitSlop={10} style={styles.topBtn} accessibilityLabel="Membership details"><Icon name="more" size={18} color={colors.fg} /></Pressable>
      </View>
      {locked ? (
        <LockedState m={m || { coverUrl: null }} lapsed={!!(err.data && err.data.lapsed)} onRenew={() => nav.replace('Membership', { id: params.id, title, join: true })} onDetails={() => nav.replace('Membership', { id: params.id, title })} />
      ) : err ? (
        <Empty title="Couldn’t open this group" body={friendly(err)} action="Try again" onAction={load} />
      ) : !home ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 50 }} />
      ) : (
        <>
          <View style={styles.groupBar}>
            <SegmentToggle
              value={tab}
              onChange={setTab}
              options={[{ id: 'master', label: MASTER, icon: 'volume' }, { id: 'executive', label: EXECUTIVE, icon: 'chat' }]}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRow}>
              {tools.map((t) => (
                <Pressable key={t.id} onPress={t.go} style={({ pressed }) => [styles.tool, pressed && { backgroundColor: colors.surfaceRaised }]} accessibilityRole="button" accessibilityLabel={t.label}>
                  <Icon name={t.icon} size={13} color={colors.primary} />
                  <Text style={styles.toolText}>{t.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View style={{ flex: 1 }}>
            {tab === 'master' && home.channelId ? (
              <ChatScreen key={`ms-${home.channelId}`} params={{ id: home.channelId, to: (home.sections && home.sections.master.title) || `${title} · ${MASTER}`, kind: 'channel', embedded: true, section: 'master', onOpenExecutive: () => setTab('executive') }} />
            ) : null}
            {tab === 'executive' && home.communityId ? (
              <ChatScreen key={`ex-${home.communityId}`} params={{ id: home.communityId, to: (home.sections && home.sections.executive.title) || `${title} · ${EXECUTIVE}`, kind: 'group', embedded: true, section: 'executive', onOpenMaster: () => setTab('master') }} />
            ) : null}
          </View>
        </>
      )}
      <WelcomeModal visible={!!welcome} title={welcome && welcome.title} text={welcome && welcome.text} onMaster={() => closeWelcome('master')} onExecutive={() => closeWelcome('executive')} onClose={() => closeWelcome(null)} />
    </View>
  );
}

/** The group's ordered lessons (opened from the Library chip on the group home). */
export function MembershipLibraryScreen({ params = {} }) {
  const api = useApi();
  return (
    <Screen back title="Library" subtitle={params.title} scroll={false} padded={false}>
      <LibraryView api={api} id={params.id} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// My Channels (brief 8.3: where Clip Farm used to be) — the membership groups I belong to
// ---------------------------------------------------------------------------------------------------------------
export function MyChannelsScreen() {
  const nav = useNav();
  const mine = useMyMemberships();
  return (
    <Screen back title="My Channels" subtitle="Membership groups you belong to">
      {!mine.online ? <Notice text="Sign in to see the membership groups you belong to." /> : null}
      {mine.online && !mine.loaded ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : null}
      {mine.loaded && !mine.items.length ? (
        <Empty title="No membership groups yet" body={`Join a membership to open its ${MASTER} for lessons, its ${EXECUTIVE} to talk with other members, and a Library of lessons.`} action="Browse Paid Channels" onAction={() => nav.push('Memberships')} />
      ) : null}
      <View style={{ gap: 12 }}>
        {mine.items.map((m, i) => (
          <FadeInUp key={m.id} index={i} distance={10}>
            <View style={styles.myRow}>
              <PressScale onPress={() => nav.push('MembershipHome', { id: m.id, title: m.title })} scaleTo={0.98} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Cover uri={m.coverUrl} style={styles.myThumb} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{m.title}</Text>
                  <Text style={[styles.small, !m.access.active && { color: colors.terracotta, fontWeight: '700' }]}>{m.access.active ? `Member · until ${untilLabel(m.access.expiresAt)}` : `Ended ${untilLabel(m.access.expiresAt)}`}</Text>
                </View>
                {!m.access.active ? <View style={styles.renewTag}><Text style={styles.renewText}>Renew</Text></View> : m.welcomePending ? <View style={styles.newDot} accessibilityLabel="New" /> : <Icon name="chevron-right" size={16} color={colors.faint} />}
              </PressScale>
              {m.access.active ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  {[['master', 'volume', MASTER], ['executive', 'chat', EXECUTIVE]].map(([t, icon, label]) => (
                    <Pressable key={t} onPress={() => nav.push('MembershipHome', { id: m.id, title: m.title, tab: t })} style={styles.myBtn} accessibilityRole="button" accessibilityLabel={`${m.title} ${label}`}>
                      <Icon name={icon} size={13} color={colors.primary} /><Text style={styles.myBtnText} numberOfLines={1}>{label}</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => nav.push('MembershipLibrary', { id: m.id, title: m.title })} style={styles.myIconBtn} accessibilityRole="button" accessibilityLabel={`${m.title} Library`}>
                    <Icon name="book" size={15} color={colors.primary} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </FadeInUp>
        ))}
      </View>
      {mine.items.length ? <Button kind="ghost" label="Browse more Paid Channels" onPress={() => nav.push('Memberships')} style={{ marginTop: 16 }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.screen },
  pad: { paddingHorizontal: 18 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13.5 },
  small: { color: colors.faint, fontSize: 12, marginTop: 4 },
  smallLink: { color: colors.muted, fontSize: 12, textDecorationLine: 'underline', marginTop: 4 },

  segRow: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: radius.pill, padding: 3, borderWidth: 1, borderColor: colors.border },
  segPill: { position: 'absolute', top: 3, bottom: 3, left: 0, borderRadius: radius.pill, backgroundColor: colors.surface, ...shadow.sm },
  segTab: { flex: 1, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segText: { fontSize: 13.5, fontWeight: '600', color: colors.muted },
  segTextOn: { color: colors.primary, fontWeight: '800' },
  segBadge: { backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  segBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary },

  catScroll: { marginHorizontal: -18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  catRow: { paddingHorizontal: 12, gap: 2 },
  catTab: { paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  catTabOn: { borderBottomColor: colors.fg },
  catText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  catTextOn: { color: colors.fg, fontWeight: '700' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, zIndex: 5 },
  totalText: { color: colors.faint, fontSize: 13.5 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  sortText: { fontSize: 13, color: colors.fg, fontWeight: '600' },
  sortMenu: { position: 'absolute', right: 0, top: 40, width: 200, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, ...shadow.md, zIndex: 20 },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  sortRowText: { fontSize: 13.5, color: colors.fg },

  cover: { overflow: 'hidden', backgroundColor: colors.night },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  cardCover: { width: '100%', aspectRatio: 16 / 9 },
  cardBody: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14 },
  cardTitle: { fontSize: 15.5, fontWeight: '700', color: colors.fg },
  cardMeta: { fontSize: 12.5, color: colors.faint },
  cardHeadline: { fontSize: 14, color: colors.fg, marginTop: 5, lineHeight: 19 },
  pricePill: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, maxWidth: 220 },
  pricePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  pricePillPos: { position: 'absolute', top: 10, right: 10 },
  previewBadge: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(21,23,43,0.72)', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  previewText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  ratingLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingNum: { fontSize: 13.5, fontWeight: '700', color: colors.gold },
  ratingCount: { fontSize: 13, color: colors.faint },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  seeAllText: { color: colors.primary, fontWeight: '700', fontSize: 14 },

  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  rowTitle: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg },
  mineCard: { width: 150 },
  mineCover: { width: 150, height: 84, borderRadius: radius.md },
  mineLock: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(21,23,43,0.7)', alignItems: 'center', justifyContent: 'center' },
  mineTitle: { fontSize: 13, fontWeight: '700', color: colors.fg, marginTop: 6 },
  mineSub: { fontSize: 11.5, color: colors.faint, marginTop: 1 },

  railCard: { width: 220, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  railCover: { width: 220, height: 124 },
  railTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  railTag: { fontSize: 12.5, color: colors.muted, lineHeight: 17, minHeight: 34 },
  railFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  railPrice: { fontSize: 13, fontWeight: '800', color: colors.primary, flex: 1 },
  railMembers: { fontSize: 12, color: colors.faint },

  loveCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginTop: 8, ...shadow.sm },
  loveIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.cardRose, alignItems: 'center', justifyContent: 'center' },
  loveEyebrow: { marginTop: 14, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.rose },
  loveTitle: { fontFamily: fonts.display, fontSize: 30, color: colors.fg, marginTop: 4 },
  loveBody: { fontSize: 14.5, color: colors.muted, textAlign: 'center', lineHeight: 21, marginTop: 8, marginBottom: 14 },
  loveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  loveRowText: { fontSize: 14, color: colors.fg },

  top: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.screen },
  topBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.fg },
  heroCover: { width: '100%', aspectRatio: 16 / 9 },
  heroPlay: { position: 'absolute', left: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  heroPlayText: { color: colors.night, fontWeight: '800', fontSize: 12.5 },
  prodName: { fontSize: 17, color: colors.muted, textAlign: 'center', marginTop: 20, fontWeight: '600' },
  prodHeadline: { fontFamily: fonts.display, fontSize: 31, lineHeight: 36, color: colors.fg, textAlign: 'center', marginTop: 8, letterSpacing: -0.5 },
  prodStats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  prodDesc: { fontSize: 14.5, lineHeight: 21, color: colors.muted, textAlign: 'center', marginTop: 10 },
  memberBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.positiveFaint, borderRadius: radius.md, padding: 12, marginTop: 16 },
  memberBannerText: { flex: 1, color: colors.positive, fontWeight: '700', fontSize: 13 },
  block: { marginTop: 22, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border },
  blockTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg },
  blockSub: { fontSize: 13, color: colors.faint, marginTop: 2 },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10 },
  benefitDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  benefitText: { flex: 1, fontSize: 14.5, color: colors.fg, lineHeight: 20 },
  sample: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  sampleNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.raised, textAlign: 'center', lineHeight: 22, fontSize: 12, fontWeight: '700', color: colors.muted, overflow: 'hidden' },
  sampleTitle: { flex: 1, fontSize: 14, color: colors.fg },
  sampleMin: { fontSize: 12, color: colors.faint },
  sectionCenter: { fontFamily: fonts.serifBold, fontSize: 23, color: colors.fg, textAlign: 'center', marginTop: 30, marginBottom: 12 },
  creator: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  creatorName: { fontSize: 16, fontWeight: '800', color: colors.fg, marginTop: 10 },
  creatorMeta: { fontSize: 12.5, color: colors.faint, marginTop: 2 },
  creatorBio: { fontSize: 14, color: colors.fg, textAlign: 'center', lineHeight: 20, marginTop: 12 },
  viewProfile: { alignSelf: 'stretch', marginTop: 16, paddingVertical: 11, borderRadius: radius.pill, backgroundColor: colors.raised, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  viewProfileText: { fontWeight: '700', color: colors.fg },
  faq: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: colors.border },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  faqQ: { flex: 1, fontSize: 14, color: colors.fg, fontWeight: '600' },
  faqA: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 8 },
  reviewsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 30, marginBottom: 10 },
  review: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.border },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  initials: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  reviewName: { fontSize: 14.5, fontWeight: '700', color: colors.fg, flexShrink: 1 },
  reviewDate: { fontSize: 12, color: colors.faint, marginTop: 2 },
  reviewBody: { fontSize: 14, color: colors.fg, lineHeight: 20, marginTop: 10 },
  sticky: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: alpha(colors.screen, 0.96), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  joinBtn: { height: 52, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.md },
  joinText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingBottom: 22, paddingTop: 8, maxHeight: '86%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.fg },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1.5, borderColor: colors.border },
  planOn: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.04) },
  planName: { fontSize: 13.5, fontWeight: '700', color: colors.muted },
  planPrice: { fontSize: 23, fontWeight: '800', color: colors.fg, marginTop: 4, letterSpacing: -0.3 },
  planPer: { fontSize: 12.5, color: colors.faint, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },

  coHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coSeller: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.fg },
  coPromoLink: { fontSize: 12.5, color: colors.muted, textDecorationLine: 'underline' },
  coSummary: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  coName: { fontSize: 14.5, color: colors.fg, fontWeight: '600' },
  coHeadline: { fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 2 },
  coPrice: { fontSize: 32, fontWeight: '800', color: colors.fg, marginTop: 10, letterSpacing: -0.6 },
  coPer: { fontSize: 15, fontWeight: '600', color: colors.muted },
  coDiscount: { fontSize: 12.5, color: colors.positive, fontWeight: '700', marginTop: 2 },
  coAccess: { fontSize: 12.5, color: colors.faint, marginTop: 4, textAlign: 'center' },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'stretch' },
  label: { fontSize: 13, fontWeight: '600', color: colors.fg, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14.5, color: colors.fg },
  inputLocked: { backgroundColor: colors.raised },
  inputLockedText: { fontSize: 14.5, color: colors.muted },
  signedRow: { flexDirection: 'row', justifyContent: 'space-between' },
  methods: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  methodDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  methodIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontSize: 14.5, color: colors.fg, fontWeight: '600' },
  methodNote: { fontSize: 12, color: colors.faint, marginTop: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { fontSize: 13.5, color: colors.fg, flex: 1 },
  shopBtn: { height: 52, borderRadius: radius.md, backgroundColor: colors.fg, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  shopText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '800' },
  legal: { fontSize: 11.5, color: colors.faint, textAlign: 'center', marginTop: 10, lineHeight: 16 },

  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 14 },
  summaryNum: { fontSize: 34, fontWeight: '800', color: colors.fg },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.gold },

  homeTop: { height: 60, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.screen },
  homeThumb: { width: 40, height: 40, borderRadius: 12 },
  homeTitle: { fontSize: 15.5, fontWeight: '800', color: colors.fg },
  homeSub: { fontSize: 12, color: colors.faint, marginTop: 1 },
  progressCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 10 },
  progressTitle: { fontSize: 14, fontWeight: '700', color: colors.fg },
  lesson: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.border },
  lessonHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lessonNum: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  lessonNumText: { fontSize: 13, fontWeight: '800', color: colors.muted },
  lessonTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  lessonBody: { fontSize: 14, color: colors.fg, lineHeight: 21 },
  lockCover: { height: 220 },
  lockScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,23,43,0.55)' },
  lockCard: { marginHorizontal: 18, marginTop: -60, backgroundColor: colors.surface, borderRadius: radius.xl, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: colors.border, ...shadow.md },
  lockIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  lockTitle: { fontFamily: fonts.serifBold, fontSize: 23, color: colors.fg, marginTop: 12, textAlign: 'center' },
  lockBody: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, marginTop: 6 },

  myRow: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: colors.border },
  myThumb: { width: 84, height: 48, borderRadius: radius.sm },
  myBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  myBtnText: { fontSize: 11.5, fontWeight: '800', color: colors.primary, letterSpacing: 0.2 },
  myIconBtn: { width: 38, height: 34, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  newDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  groupBar: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 8, backgroundColor: colors.screen, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  toolRow: { gap: 8, paddingRight: 6 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  toolText: { fontSize: 12.5, fontWeight: '700', color: colors.fg },
  renewTag: { backgroundColor: colors.terracottaFaint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  renewText: { color: colors.terracotta, fontWeight: '800', fontSize: 12 },
});
