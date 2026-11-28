import { isDarkScheme } from '../design/palette';
// FUND ME (round 3) — fundraising requests: home (start / mine / discover), detail (progress, story, donors,
// donate, share), create/edit wizard (heading, goal, main photo, story with images, supporting photos & PDFs,
// preview, submit for review) and the organiser's donations list.
// Online: data from the Worker via ../api/fundme. Local mode: an on-device demo with sample fundraisers.
// Look: the Figma design's Fund Me screens (FundMeHub, FundMeCreate, FundMeDetail) on the sanctuary kit.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '../components/Icons';
import { AnimatedModal, AnimatedBar, AnimatedNumber, Burst, FadeInUp, Shimmer } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useStore } from '../store';
import { errorMessage } from '../api/client';
import { pickPhotos } from '../api/media';
import GiftSheet from '../components/social/GiftSheet';
import {
  useFundMe, onFundMeChange, pickPdf, formatMoney, toMinor, minorToText, CURRENCIES, SYMBOL, CURRENCY_NAME, LIMITS, STATUS_LABEL,
  isReceived, DONATION_STATUS, HELD_EXPLAINER, localeCurrency,
} from '../api/fundme';
// FUND ME MONEY (monetisation stage 2): credits before publishing, donations held by BibleNestra, payouts, receipts
import { FundMeCreditsCard } from './FundMeMoneyScreens';
import { FundGiftStar, FundGiftSheet, FundGiftsReceived } from '../components/fundme/FundGifts'; // FUND ME GIFTS
import { BuyCoinsSheet } from '../components/wallet';
import { useApi } from '../api/auth';
import { alpha } from '../components/ui';
import { d, df, k, Tap, Grad, Eyebrow, IconButton, PageHeader, SectionTitle, fillImage } from '../design/sanctuary';
import { DScreen, DCard, DInput, DLabel, DToggle } from '../design/profile/parts';
import { FBtn, FNotice, FEmpty, FBadge, FKpi, FPdfTile } from '../design/fundme/parts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUS_TINT = {
  draft: colors.muted, pending_review: colors.gold, live: colors.positive, paused: colors.slate, closed: colors.slate, rejected: colors.negative,
};
const HERO = [(isDarkScheme() ? '#241f12' : '#F0D292'), (isDarkScheme() ? '#241f12' : '#fbf3dc')]; // the design's fund-hero gold
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Reload when the screen comes back into view and whenever Fund Me data changes elsewhere.
function useReload(load) {
  const focused = useIsFocused();
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => { if (focused) ref.current(); }, [focused]);
  useEffect(() => onFundMeChange(() => ref.current({ quiet: true })), []);
}

function StatusBadge({ status }) {
  return <FBadge label={STATUS_LABEL[status] || status} tint={STATUS_TINT[status] || colors.muted} />;
}

function Progress({ f, big }) {
  const pct = Math.min(1, f.goalMinor ? f.raisedMinor / f.goalMinor : 0);
  return (
    <View>
      {big ? (
        <>
          <AnimatedNumber value={f.raisedMinor} style={s.raisedBig} format={(n) => formatMoney(Math.round(n), f.currency)} />
          <Text style={s.ofGoal}>raised of {formatMoney(f.goalMinor, f.currency)} goal</Text>
        </>
      ) : null}
      <AnimatedBar progress={pct} style={[s.bar, big && s.barBig]} fillStyle={s.barFill} />
      {big ? (
        <View style={s.statsRow}>
          <Text style={s.stat}><Text style={s.statStrong}>{f.percent}%</Text> funded</Text>
          <Text style={s.stat}><Text style={s.statStrong}>{f.donorsCount}</Text> {f.donorsCount === 1 ? 'donor' : 'donors'}</Text>
          <Text style={s.stat}><Text style={s.statStrong}>{formatMoney(f.remainingMinor, f.currency)}</Text> to go</Text>
        </View>
      ) : (
        <View style={s.cardMoneyRow}>
          <Text style={s.cardRaised}>{formatMoney(f.raisedMinor, f.currency)} <Text style={s.cardOf}>of {formatMoney(f.goalMinor, f.currency)}</Text></Text>
          <Text style={s.cardPct}>{f.percent}%</Text>
        </View>
      )}
    </View>
  );
}

function Thumb({ uri, style }) {
  return uri ? <Image source={{ uri }} style={[s.thumbBase, style]} /> : (
    <View style={[s.thumbBase, s.thumbEmpty, style]}><Icon name="image" size={22} color={d.muted} /></View>
  );
}

// Big campaign card (.campaign-card) for the first live fundraiser
function CampaignCard({ f, onPress, index, onGift }) {
  return (
    <FadeInUp index={index}>
      <Tap onPress={onPress} style={s.bigCard} accessibilityLabel={f.title}>
        <Thumb uri={f.mainImageUrl} style={s.bigImg} />
        {onGift ? <FundGiftStar onPress={onGift} size={40} style={s.giftOnImage} /> : null}
        <View style={s.bigBody}>
          <Text style={s.kicker}>Reviewed</Text>
          <Text style={s.bigTitle} numberOfLines={2}>{f.title}</Text>
          {f.owner ? <Text style={s.owner} numberOfLines={1}>by {f.owner.displayName}</Text> : null}
          {f.excerpt ? <Text style={s.excerpt} numberOfLines={2}>{f.excerpt}</Text> : null}
          <View style={{ marginTop: 10 }}><Progress f={f} /></View>
          <View style={s.footRow}>
            <Text style={s.footL}>{f.percent}% funded</Text>
            <Text style={s.footR}>{f.donorsCount} {f.donorsCount === 1 ? 'donor' : 'donors'}</Text>
          </View>
        </View>
      </Tap>
    </FadeInUp>
  );
}

// Small campaign tile (.mini-campaigns) for the rest of the live list
function MiniCard({ f, onPress, index, onGift }) {
  return (
    <FadeInUp index={index} style={s.miniWrap}>
      <Tap onPress={onPress} style={s.mini} accessibilityLabel={f.title}>
        <Thumb uri={f.mainImageUrl} style={s.miniImg} />
        {onGift ? <FundGiftStar onPress={onGift} size={30} style={s.giftOnImage} /> : null}
        <View style={s.miniBody}>
          <Text style={s.miniKicker}>Live</Text>
          <Text style={s.miniTitle} numberOfLines={2}>{f.title}</Text>
          <Progress f={f} />
        </View>
      </Tap>
    </FadeInUp>
  );
}

function MineRow({ f, onPress, index }) {
  return (
    <FadeInUp index={index}>
      <Tap onPress={onPress} style={s.mineRow} accessibilityLabel={f.title}>
        <Thumb uri={f.mainImageUrl} style={s.mineThumb} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text style={s.mineTitle} numberOfLines={1}>{f.title}</Text>
          <View style={{ flexDirection: 'row' }}><StatusBadge status={f.status} /></View>
          <Progress f={f} />
        </View>
      </Tap>
    </FadeInUp>
  );
}

// =============================================================================================
// Home
// =============================================================================================
export function FundMeHomeScreen() {
  const nav = useNav();
  const fm = useFundMe();
  const toast = useToast();
  const [mine, setMine] = useState(null);
  const [live, setLive] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [credits, setCredits] = useState(null);
  const [giftFor, setGiftFor] = useState(null); // FUND ME GIFTS: the request whose gift sheet is open
  const [giftOpen, setGiftOpen] = useState(false);
  // gifts need a real creator to send to (not demo data, not a request without an owner id)
  const giftable = (f) => !fm.demo && !!(f && f.owner && f.owner.id);
  const openGift = (f) => { setGiftFor(f); setGiftOpen(true); };

  const load = useCallback(async () => {
    try {
      const [m, dis] = await Promise.all([fm.mine(), fm.discover()]);
      setMine(m.items); setLive(dis.items); setCursor(dis.cursor); setMore(!!dis.hasMore); setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load fundraisers')); }
    if (!fm.demo) fm.credits().then((c) => setCredits(c.demo ? null : (c.available != null ? c.available : c.balance))).catch(() => setCredits(null));
  }, [fm]);
  useReload(load);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try { const dis = await fm.discover(cursor); setLive((l) => [...l, ...dis.items]); setCursor(dis.cursor); setMore(!!dis.hasMore); } catch (e) { toast.show(errorMessage(e), { tone: 'error' }); }
    setLoadingMore(false);
  };

  const [firstLive, ...restLive] = live || [];

  return (
    <DScreen
      title="Fund Me"
      subtitle="Verified generosity"
      back
      onBack={() => nav.pop()}
      action={<IconButton icon="plus" label="Start a fundraiser" onPress={() => nav.push('FundraiserEdit', {})} />}
    >
      <FadeInUp>
        <Grad colors={HERO} style={s.hero}>
          <View style={s.heroIcon}><Icon name="heart" size={20} color={d.goldDark} /></View>
          <Text style={s.heroEyebrow}>Fund Me</Text>
          <Text style={s.heroTitle}>Raise support for what matters</Text>
          <Text style={s.heroBody}>Hospital bills, school fees, ministry needs — share your story and receive gifts from people who care.</Text>
          <Tap onPress={() => nav.push('FundraiserEdit', {})} style={s.heroBtn} accessibilityLabel="Start a fundraiser">
            <Icon name="plus" size={16} color="#FFFFFF" />
            <Text style={s.heroBtnText}>Start a fundraiser</Text>
          </Tap>
          <View style={s.heroSteps}>
            {['Tell your story', 'We review it', 'Share your link'].map((t, i) => (
              <View key={t} style={s.heroStep}>
                <Text style={s.heroStepNum}>{i + 1}</Text>
                <Text style={s.heroStepText}>{t}</Text>
              </View>
            ))}
          </View>
        </Grad>
      </FadeInUp>

      {fm.demo ? <View style={{ marginTop: 14 }}><FNotice text="Demo mode — sample fundraisers on this device. Sign in online to raise real support." /></View> : null}

      {!fm.demo ? (
        <FadeInUp index={1}>
          <View style={s.stats}>
            <View style={s.stat2}>
              <Text style={s.stat2Num}>{credits === null ? '–' : credits}</Text>
              <Text style={s.stat2Label}>Credits available</Text>
            </View>
            <View style={s.stat2}>
              <Text style={s.stat2Num}>{mine === null ? '–' : mine.length}</Text>
              <Text style={s.stat2Label}>My fundraisers</Text>
            </View>
          </View>
          <View style={s.quickRow}>
            {[['heart', 'Credits', 'FundMeCredits'], ['gift', 'Send credits', 'FundMeGiftCredits'], ['check', 'My donations', 'FundMeMyDonations']].map(([icon, label, route]) => (
              <Tap key={route} onPress={() => nav.push(route)} style={s.quick} accessibilityLabel={label}>
                <View style={s.quickIcon}><Icon name={icon} size={15} color={d.plum} /></View>
                <Text style={s.quickText}>{label}</Text>
              </Tap>
            ))}
          </View>
          <Text style={s.note}>{HELD_EXPLAINER}</Text>
        </FadeInUp>
      ) : null}
      {error ? <View style={{ marginTop: 14 }}><FNotice text={error} tone="danger" /></View> : null}

      <SectionTitle title="My fundraisers" />
      {mine === null ? <Skeleton rows={1} /> : mine.length ? (
        <View style={{ gap: 10 }}>
          {mine.map((f, i) => <MineRow key={f.id} f={f} index={i} onPress={() => nav.push('Fundraiser', { id: f.id })} />)}
        </View>
      ) : (
        <FEmpty title="You haven’t started a fundraiser yet." />
      )}

      <SectionTitle eyebrow="Urgent needs" title="Discover fundraisers" />
      {live === null ? <Skeleton rows={2} big /> : live.length ? (
        <View style={{ gap: 14 }}>
          {firstLive ? <CampaignCard f={firstLive} index={0} onPress={() => nav.push('Fundraiser', { id: firstLive.id })} onGift={giftable(firstLive) ? () => openGift(firstLive) : null} /> : null}
          {restLive.length ? (
            <View style={s.minis}>
              {restLive.map((f, i) => <MiniCard key={f.id} f={f} index={i + 1} onPress={() => nav.push('Fundraiser', { id: f.id })} onGift={giftable(f) ? () => openGift(f) : null} />)}
            </View>
          ) : null}
          {more ? <FBtn kind="ghost" label={loadingMore ? 'Loading…' : 'Show more'} onPress={loadMore} disabled={loadingMore} /> : null}
        </View>
      ) : <FEmpty title="No live fundraisers yet" body="When fundraisers are approved they appear here." />}
      <FundGiftSheet fundraiser={giftFor} visible={giftOpen} onClose={() => setGiftOpen(false)} onSent={() => setGiftOpen(false)} />
    </DScreen>
  );
}

function Skeleton({ rows = 1, big }) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => <Shimmer key={i} style={{ height: big ? 230 : 92, borderRadius: 20 }} />)}
    </View>
  );
}

// =============================================================================================
// Shared body (detail screen + wizard preview)
// =============================================================================================
function FundraiserBody({ f, onImage, onDoc, showPrivate }) {
  const images = (f.media || []).filter((m) => m.kind === 'image');
  const docs = (f.media || []).filter((m) => m.kind === 'pdf' && (showPrivate || m.visibility !== 'private'));
  return (
    <View>
      <SectionTitle title="Story" />
      {(f.story || []).length ? f.story.map((b, i) => (b.type === 'p' ? (
        <Text key={i} style={s.storyP}>{b.text}</Text>
      ) : (
        <Pressable key={i} onPress={() => onImage && onImage(b.url)} style={{ marginBottom: 16 }} accessibilityLabel="Open photo">
          <Image source={{ uri: b.url }} style={s.storyImg} />
          {b.caption ? <Text style={s.caption}>{b.caption}</Text> : null}
        </Pressable>
      ))) : <Text style={s.muted}>No story yet.</Text>}

      {images.length ? (
        <>
          <SectionTitle title="Photos" />
          <View style={s.grid}>
            {images.map((m) => (
              <Tap key={m.id || m.url} onPress={() => onImage && onImage(m.url)} style={s.gridItem} accessibilityLabel={m.caption || 'Photo'}>
                <Image source={{ uri: m.url }} style={s.gridImg} />
              </Tap>
            ))}
          </View>
        </>
      ) : null}

      {docs.length ? (
        <>
          <SectionTitle title="Documents" />
          <View style={{ gap: 8 }}>
            {docs.map((m) => (
              <Tap key={m.id || m.key || m.name} onPress={() => onDoc && onDoc(m)} style={s.docRow} accessibilityLabel={m.caption || m.name || 'Document'}>
                <FPdfTile />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.docTitle} numberOfLines={1}>{m.caption || m.name || 'Document'}</Text>
                  <Text style={s.docSub} numberOfLines={1}>{m.name || 'Tap to open'}</Text>
                </View>
                {showPrivate && m.visibility === 'private' ? <FBadge label="Private" tint={colors.slate} /> : <Icon name="arrow-up-right" size={16} color={d.muted} />}
              </Tap>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Donors({ f }) {
  const list = f.donations || [];
  return (
    <View>
      <SectionTitle eyebrow={f.donorsCount ? `${f.donorsCount} ${f.donorsCount === 1 ? 'donor' : 'donors'}` : undefined} title="Words of support" />
      {list.length ? (
        <DCard style={s.donorCard}>
          {list.map((x, i) => (
            <FadeInUp key={`${x.createdAt}-${i}`} index={i} style={[s.donor, i > 0 && s.donorBorder]}>
              <View style={[s.avatar, x.anonymous && { backgroundColor: d.lavender }]}>
                {x.anonymous ? <Icon name="heart" size={14} color={d.plum} /> : <Text style={s.avatarText}>{initials(x.name)}</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.donorName}>{x.name}</Text>
                <Text style={s.donorMeta}>{formatMoney(x.amountMinor, x.currency)} · {timeAgo(x.createdAt)}</Text>
                {x.message ? <Text style={s.donorMsg}>“{x.message}”</Text> : null}
              </View>
            </FadeInUp>
          ))}
        </DCard>
      ) : (
        <DCard style={{ padding: 16 }}><Text style={s.muted}>Be the first to give and leave a word of encouragement.</Text></DCard>
      )}
    </View>
  );
}

function Lightbox({ uri, onClose }) {
  return (
    <AnimatedModal visible={!!uri} onRequestClose={onClose} full dim="rgba(40,26,17,0.94)">
      <Pressable style={s.lightbox} onPress={onClose} accessibilityLabel="Close photo">
        {uri ? <Image source={{ uri }} style={s.lightboxImg} resizeMode="contain" /> : null}
        <View style={s.lightboxClose}><Icon name="x" size={18} color="#FFFFFF" /></View>
      </Pressable>
    </AnimatedModal>
  );
}

const OWNER_BANNER = {
  draft: ['Draft', 'Only you can see this. Finish your story and submit it for review.', colors.muted],
  pending_review: ['Waiting for review', 'Our team reviews every fundraiser before it goes public — usually within a day.', colors.gold],
  live: ['Live', 'Your page is public. Share your link so people can give.', colors.positive],
  paused: ['Paused', 'Donations are paused. Resume whenever you’re ready.', colors.slate],
  closed: ['Closed', 'This fundraiser has ended. The page stays up as a record of everyone who gave.', colors.slate],
  rejected: ['Needs changes', '', colors.negative],
};

// =============================================================================================
// Detail
// =============================================================================================
export function FundraiserScreen({ params = {} }) {
  const nav = useNav();
  const fm = useFundMe();
  const toast = useToast();
  const { state } = useStore();
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [donateOpen, setDonateOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false); // send platform coins as a seed to the organiser
  const [fundGiftOpen, setFundGiftOpen] = useState(false); // FUND ME GIFTS: the star/gift sheet (a gift to the creator)
  const [confirm, setConfirm] = useState(null); // 'close'
  const [busy, setBusy] = useState(null);
  const [celebrate, setCelebrate] = useState(0);
  const [buyCredits, setBuyCredits] = useState(false);
  const [lastDonation, setLastDonation] = useState(null); // donation id → "View receipt"
  const poll = useRef(null);

  const load = useCallback(async () => {
    try { setF(await fm.get(params.id)); setError(null); } catch (e) { setError(errorMessage(e, 'Couldn’t load this fundraiser')); }
  }, [fm, params.id]);
  useReload(load);
  useEffect(() => () => clearInterval(poll.current), []);

  const owner = !!(f && f.isOwner);

  const copyLink = async () => {
    try { await Clipboard.setStringAsync(f.url); toast.show('Link copied — paste it anywhere', { icon: 'link' }); } catch (e) { toast.show('Couldn’t copy the link', { tone: 'error' }); }
  };
  const share = async () => {
    const message = `${f.title}\n${f.url}`;
    try {
      if (Platform.OS === 'web' && !(typeof navigator !== 'undefined' && navigator.share)) return copyLink();
      await Share.share(Platform.OS === 'ios' ? { message: f.title, url: f.url } : { message, title: f.title });
    } catch (e) { copyLink(); }
  };
  const openDoc = async (m) => {
    if (!m.url) { toast.show('Demo document — real PDFs open here when online', { icon: 'book' }); return; }
    try { await WebBrowser.openBrowserAsync(m.url); } catch (e) { toast.show('Couldn’t open the document', { tone: 'error' }); }
  };

  const watchDonation = (slug, donationId) => {
    clearInterval(poll.current);
    let tries = 0;
    const check = async () => {
      tries += 1;
      try {
        const st2 = await fm.donationStatus(slug, donationId);
        if (isReceived(st2)) {
          clearInterval(poll.current);
          await load();
          setCelebrate((n) => n + 1);
          if (!fm.demo) setLastDonation(donationId);
          toast.show('Thank you! Your donation was received — BibleNestra holds it for the organiser', { icon: 'heart', haptic: 'success', duration: 4200 });
          fm.notifyChanged();
        } else if (st2.status === 'failed') {
          clearInterval(poll.current);
          toast.show('The payment didn’t go through — you haven’t been charged', { tone: 'error' });
        }
      } catch (e) { /* keep polling */ }
      if (tries > 72) clearInterval(poll.current);
    };
    poll.current = setInterval(check, 2500);
    return check;
  };

  const donate = async (body) => {
    try {
      const r = await fm.donate(f.slug, body);
      setDonateOpen(false);
      if (!r.checkoutUrl) { // local demo: recorded immediately
        await load();
        setCelebrate((n) => n + 1);
        toast.show('Thank you! (Demo — no money moved)', { icon: 'heart', haptic: 'success' });
        return;
      }
      const check = watchDonation(f.slug, r.donationId);
      await WebBrowser.openBrowserAsync(r.checkoutUrl);
      check(); // native: the browser was closed — check straight away
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t start the donation'), { tone: 'error' });
    }
  };

  const act = async (kind) => {
    setBusy(kind);
    try {
      const next = await fm[kind](f.id);
      setF((cur) => ({ ...cur, ...next, donations: cur.donations }));
      const msg = { submit: 'Submitted for review', pause: 'Donations paused', resume: 'Fundraiser is live again', close: 'Fundraiser closed' }[kind];
      toast.show(msg, { icon: kind === 'submit' ? 'check' : 'shield' });
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'error', duration: 4200 });
      if (e && e.code === 'INSUFFICIENT_BALANCE') setBuyCredits(true);
    }
    setBusy(null); setConfirm(null);
  };

  if (!f) {
    return (
      <DScreen title="Fundraiser" back onBack={() => nav.pop()}>
        {error ? <FEmpty title="Fundraiser unavailable" body={error} action="Try again" onAction={load} /> : (
          <View style={{ gap: 14 }}>
            <Shimmer style={{ height: 220, borderRadius: 24 }} />
            <Shimmer style={{ height: 28, width: '70%' }} />
            <Shimmer style={{ height: 150, borderRadius: 20 }} />
          </View>
        )}
      </DScreen>
    );
  }

  const banner = owner ? OWNER_BANNER[f.status] : null;
  const canDonate = f.status === 'live';
  // Anyone but the organiser can send coins as a seed while the fundraiser is live
  const canGift = canDonate && !owner && !fm.demo && !!(f.owner && f.owner.id);
  // FUND ME GIFTS: the star/gift button (any live request, not your own) opens the gift sheet for the creator
  const canSendFundGift = canDonate && !owner && !fm.demo && !!(f.owner && f.owner.id);
  const soon = canDonate && !f.paymentsReady;
  // the donate bar (Share + Donate) is shown while donations are switched on
  const showBar = canDonate && !soon;
  // the public page exists once approved (admin-paused pages are hidden)
  const isPublic = f.status === 'live' || (['paused', 'closed'].includes(f.status) && f.pausedBy !== 'admin' && (!owner || !!f.approvedAt || fm.demo));

  return (
    <View style={k.screen}>
      <ScrollView
        contentContainerStyle={[k.scroll, { paddingTop: 8, paddingBottom: showBar ? 150 : 48 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          title={owner ? 'Your fundraiser' : 'Campaign'}
          subtitle={STATUS_LABEL[f.status] || 'Fund Me'}
          back
          onBack={() => nav.pop()}
          action={owner && f.status !== 'closed' ? (
            <IconButton icon="edit" label="Edit fundraiser" onPress={() => nav.push('FundraiserEdit', { id: f.id })} />
          ) : canSendFundGift ? (
            <IconButton icon="gift" label="Send a gift to this request" onPress={() => setFundGiftOpen(true)} />
          ) : null}
        />

        {banner ? (
          <FadeInUp>
            <View style={[s.banner, { backgroundColor: alpha(banner[2], 0.1), borderLeftColor: banner[2] }]}>
              <Text style={[s.bannerTitle, { color: banner[2] }]}>{banner[0]}</Text>
              <Text style={s.bannerText}>{f.status === 'rejected' ? `Our team asked for changes: ${f.rejectReason || 'see your notifications'}. Edit and resubmit when ready.` : banner[1]}</Text>
            </View>
          </FadeInUp>
        ) : null}
        {f.testMode && canDonate && !fm.demo ? <View style={{ marginBottom: 12 }}><FNotice tone="plum" text="Test payments — donations use a simulated checkout. No real money moves." /></View> : null}

        <FadeInUp index={1}>
          <Pressable onPress={() => f.mainImageUrl && setLightbox(f.mainImageUrl)} accessibilityLabel="Open main photo">
            <Thumb uri={f.mainImageUrl} style={s.cover} />
          </Pressable>
          {f.status === 'live' ? (
            <View style={s.verified}>
              <Icon name="shield" size={14} color={d.sageDark} />
              <Text style={s.verifiedText}>Reviewed by our team before going live</Text>
            </View>
          ) : null}
          <Text style={s.detailTitle}>{f.title}</Text>
          <View style={s.orgRow}>
            <View style={s.orgAvatar}><Text style={s.orgAvatarText}>{initials(f.owner && f.owner.displayName)}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.orgSmall}>Organised by</Text>
              <Text style={s.orgName} numberOfLines={1}>{owner ? (f.owner && f.owner.displayName && f.owner.displayName !== 'You' ? `${f.owner.displayName} (you)` : 'you') : f.owner && f.owner.displayName}</Text>
            </View>
          </View>
        </FadeInUp>

        <FadeInUp index={2}>
          <DCard style={s.progressCard}>
            <Burst trigger={celebrate} count={14} radius={80} />
            <Progress f={f} big />
            {!showBar && (canDonate || isPublic) ? (
              <View style={s.actions}>
                {canDonate && soon ? (
                  <View style={[s.soon, { flex: 1 }]}><Text style={s.soonText}>{f.closedMessage || 'Donations aren’t switched on yet'}</Text></View>
                ) : null}
                {isPublic ? <FBtn kind="ghost" label="Share" onPress={share} style={{ flex: canDonate ? 0.8 : 1 }} icon={<Icon name="share" size={16} color={d.ink} />} /> : null}
              </View>
            ) : null}
            {canGift ? (
              <FBtn kind="ghost" label="Gift coins" onPress={() => setGiftOpen(true)} style={{ marginTop: 10 }} icon={<Icon name="gift" size={16} color={d.ink} />} />
            ) : null}
            {isPublic ? (
              <Tap onPress={copyLink} style={s.linkRow} accessibilityLabel="Copy link">
                <Icon name="link" size={15} color={d.plum} />
                <Text style={s.linkText} numberOfLines={1}>{f.url.replace(/^https?:\/\//, '')}</Text>
                <Text style={s.linkCopy}>Copy</Text>
              </Tap>
            ) : null}
            {!canDonate && !owner ? <Text style={[s.muted, { marginTop: 10 }]}>{f.status === 'closed' ? 'This fundraiser has ended.' : 'Donations are paused for now.'}</Text> : null}
            {canDonate && !fm.demo ? (
              <View style={s.heldNote}>
                <Icon name="shield" size={14} color={d.sageDark} />
                <Text style={s.heldNoteText}>{f.heldByBibleNestra || HELD_EXPLAINER}</Text>
              </View>
            ) : null}
            {lastDonation ? <FBtn kind="ghost" small label="View your receipt" onPress={() => nav.push('FundMeReceipt', { donationId: lastDonation })} style={{ marginTop: 10 }} icon={<Icon name="check" size={14} color={d.ink} />} /> : null}
          </DCard>
        </FadeInUp>

        {owner ? (
          <FadeInUp index={3}>
            <DCard style={{ padding: 14, marginTop: 14 }}>
              <Text style={s.toolsTitle}>Organiser tools</Text>
              <View style={s.toolsGrid}>
                {f.status !== 'closed' ? <Tool icon="edit" label="Edit" onPress={() => nav.push('FundraiserEdit', { id: f.id })} /> : null}
                <Tool icon="users" label="Donations" onPress={() => nav.push('FundraiserDonations', { id: f.id, title: f.title, currency: f.currency })} />
                {!fm.demo && f.approvedAt ? <Tool icon="coin" label="Payouts" onPress={() => nav.push('FundMeMoney', { id: f.id, title: f.title })} /> : null}
                {['draft', 'rejected'].includes(f.status) ? <Tool icon="check" label={busy === 'submit' ? 'Submitting…' : 'Submit'} onPress={() => act('submit')} /> : null}
                {f.status === 'live' ? <Tool icon="pause" label={busy === 'pause' ? 'Pausing…' : 'Pause'} onPress={() => act('pause')} /> : null}
                {f.status === 'paused' && f.pausedBy !== 'admin' ? <Tool icon="play" label={busy === 'resume' ? 'Resuming…' : 'Resume'} onPress={() => act('resume')} /> : null}
                {f.status !== 'closed' ? <Tool icon="x" label="Close" danger onPress={() => setConfirm('close')} /> : null}
              </View>
            </DCard>
            {['draft', 'rejected', 'pending_review'].includes(f.status) && !fm.demo ? <FundMeCreditsCard style={{ marginTop: 12 }} refreshKey={f.status} /> : null}
          </FadeInUp>
        ) : null}

        <FundraiserBody f={f} onImage={setLightbox} onDoc={openDoc} showPrivate={owner} />
        <Donors f={f} />
        <FundGiftsReceived gifts={f.gifts} isOwner={owner} />
      </ScrollView>

      {showBar ? (
        <View style={s.donateBar}>
          {isPublic ? <FBtn kind="ghost" label="Share" onPress={share} style={{ width: 96 }} icon={<Icon name="share" size={15} color={d.ink} />} /> : null}
          <FBtn label="Donate" onPress={() => setDonateOpen(true)} style={{ flex: 1 }} icon={<Icon name="heart" size={16} color="#FFFFFF" />} />
        </View>
      ) : null}

      <Lightbox uri={lightbox} onClose={() => setLightbox(null)} />
      <FundGiftSheet fundraiser={f} visible={fundGiftOpen} onClose={() => setFundGiftOpen(false)} onSent={() => load()} />
      <GiftSheet
        visible={giftOpen}
        target={{ userId: f.owner && f.owner.id, name: (f.owner && f.owner.displayName) || 'the organiser' }}
        subtitle={`Sow a seed for ${(f.owner && f.owner.displayName) || 'the organiser'} with your coins`}
        onClose={() => setGiftOpen(false)}
      />
      <DonateSheet visible={donateOpen} f={f} demo={fm.demo} defaultName={(state.user && state.user.displayName) || ''} onClose={() => setDonateOpen(false)} onDonate={donate} />
      <BuyCoinsSheet visible={buyCredits} wallet="fundme_credits" onClose={() => setBuyCredits(false)} onPurchased={() => { setBuyCredits(false); fm.notifyChanged(); }} />
      <AnimatedModal visible={confirm === 'close'} onRequestClose={() => setConfirm(null)} dim="rgba(40,26,17,0.5)">
        <Pressable style={{ flex: 1 }} onPress={() => setConfirm(null)} />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>Close this fundraiser?</Text>
          <Text style={[s.muted, { marginTop: 6, marginBottom: 18 }]}>Donations stop for good. The page stays up so supporters can still see what was raised.</Text>
          <FBtn kind="danger" label={busy === 'close' ? 'Closing…' : 'Close fundraiser'} onPress={() => act('close')} disabled={busy === 'close'} />
          <FBtn kind="ghost" label="Keep it open" onPress={() => setConfirm(null)} style={{ marginTop: 8 }} />
        </View>
      </AnimatedModal>
    </View>
  );
}

function Tool({ icon, label, onPress, danger }) {
  return (
    <Tap onPress={onPress} style={s.tool} accessibilityLabel={label}>
      <View style={[s.toolIcon, danger && { backgroundColor: (isDarkScheme() ? '#24171a' : '#fbedea') }]}>
        <Icon name={icon} size={17} color={danger ? (isDarkScheme() ? '#E8A09A' : '#8A2F2F') : d.plum} />
      </View>
      <Text style={[s.toolLabel, danger && { color: (isDarkScheme() ? '#E8A09A' : '#8A2F2F') }]}>{label}</Text>
    </Tap>
  );
}

// ---------- donate sheet ----------
// Client answers (2026-11-21): the donor picks a currency (default: the device's, else the request's), "Cover the fees"
// is ticked by default (BibleNestra fee + Paystack fee + VAT added so the beneficiary gets the full gift), and the
// server quote (/f/:slug/donation-quote) shows the breakdown and, when converted, both amounts. Non-refundable.
function DonateSheet({ visible, f, onClose, onDonate, defaultName, demo }) {
  const api = useApi();
  const fm = useFundMe();
  const options = (f.donorCurrencies && f.donorCurrencies.length ? f.donorCurrencies : [{ code: f.currency, chargedIn: f.currency, ...LIMITS[f.currency], presets: f.presets || LIMITS[f.currency].presets }]);
  const pickDefault = () => {
    const loc = localeCurrency();
    return (loc && options.some((o) => o.code === loc) ? loc : null) || f.defaultDonorCurrency || f.currency;
  };
  const [cur, setCur] = useState(pickDefault);
  const opt = options.find((o) => o.code === cur) || options[0];
  const presets = opt.presets || f.presets || LIMITS[f.currency].presets;
  const [email, setEmail] = useState('');
  const [test, setTest] = useState(false);
  const [preset, setPreset] = useState(presets[1] || presets[0]);
  const [custom, setCustom] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [anon, setAnon] = useState(false);
  const [cover, setCover] = useState(f.coverFeesDefault !== false);
  const [quote, setQuote] = useState(null);
  const [pickCur, setPickCur] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setErr(null); setBusy(false);
    // prefill with the account name (blank → the server uses the signed-in account's name)
    setName((n) => n || (defaultName && defaultName !== 'Friend' ? defaultName : ''));
    setEmail((m) => m || (EMAIL_RE.test(String(api.email || '')) ? api.email : ''));
  }, [visible]);
  useEffect(() => { setPreset(presets[1] || presets[0]); setCustom(''); }, [cur]);
  const needsEmail = !!f.needsEmail && !test;
  const amount = custom ? toMinor(custom) : preset;
  const min = opt.min || f.minMinor || LIMITS[f.currency].min;
  const max = opt.max || f.maxMinor || LIMITS[f.currency].max;
  const sym = SYMBOL[cur] != null ? SYMBOL[cur] : `${cur} `;
  const money = (m, c) => (SYMBOL[c] != null ? formatMoney(m, c) : `${c} ${formatMoney(m, c)}`);
  // live quote (debounced) — fees, conversion and what the beneficiary receives
  useEffect(() => {
    if (!visible || demo || !amount || Number.isNaN(amount) || amount < min || amount > max) { setQuote(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => { fm.quote(f.slug, { amountMinor: amount, currency: cur, coverFees: cover }).then((q) => { if (alive) setQuote(q); }).catch(() => { if (alive) setQuote(null); }); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [visible, amount, cur, cover]);
  const submit = async () => {
    if (!amount || Number.isNaN(amount)) return setErr('Choose or enter an amount');
    if (amount < min) return setErr(`The smallest gift is ${money(min, cur)}`);
    if (amount > max) return setErr(`The largest single gift is ${money(max, cur)}`);
    if (quote && !quote.ok) return setErr('This amount is too small to cover the fees');
    if (needsEmail && !EMAIL_RE.test(email.trim())) return setErr('Add your email — your payment receipt is sent there');
    setErr(null); setBusy(true);
    await onDonate({ amount_minor: amount, currency: cur, coverFees: cover, message: message.trim(), anonymous: anon, donor_name: name.trim(), email: needsEmail ? email.trim() : undefined, provider: test ? 'test' : undefined });
    setBusy(false);
  };
  const payLabel = quote ? (quote.converted ? `${quote.display.charged} (≈ ${quote.display.donorTotal})` : quote.display.charged) : amount && !Number.isNaN(amount) ? money(amount, cur) : '';
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose} dim="rgba(40,26,17,0.5)">
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Eyebrow>Give</Eyebrow>
          <Text style={s.sheetTitle} numberOfLines={2}>{f.title}</Text>
          {options.length > 1 ? (
            <View style={{ marginTop: 12 }}>
              <Tap onPress={() => setPickCur((v) => !v)} style={s.curBtn} accessibilityLabel={`Currency ${cur}. Change`}>
                <Text style={s.curBtnText}>Give in {cur}{CURRENCY_NAME[cur] ? ` · ${CURRENCY_NAME[cur]}` : ''}</Text>
                <Icon name={pickCur ? 'chevron-up' : 'chevron-down'} size={14} color={d.muted} />
              </Tap>
              {pickCur ? (
                <View style={s.curList}>
                  {options.map((o) => (
                    <Tap key={o.code} onPress={() => { setCur(o.code); setPickCur(false); }} style={[s.curChip, o.code === cur && s.on]} accessibilityLabel={o.code}>
                      <Text style={[s.curChipText, o.code === cur && { color: '#FFFFFF' }]}>{o.code}</Text>
                    </Tap>
                  ))}
                </View>
              ) : null}
              {f.fxAttribution ? (
                <Pressable onPress={() => { WebBrowser.openBrowserAsync(f.fxAttribution.url).catch(() => {}); }} accessibilityRole="link" accessibilityLabel={f.fxAttribution.label} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                  <Text style={s.fxAttr}>{f.fxAttribution.label}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={s.presets}>
            {presets.map((p) => {
              const on = !custom && preset === p;
              return (
                <Tap key={p} onPress={() => { setPreset(p); setCustom(''); }} style={[s.preset, on && s.on]} accessibilityLabel={money(p, cur)}>
                  <Text style={[s.presetText, on && { color: '#FFFFFF' }]} numberOfLines={1} adjustsFontSizeToFit>{money(p, cur)}</Text>
                </Tap>
              );
            })}
          </View>
          <View style={s.amountBox}>
            <Text style={s.amountSym}>{sym}</Text>
            <TextInput
              value={custom}
              onChangeText={(t) => setCustom(t.replace(/[^\d.,]/g, ''))}
              placeholder="Other amount"
              placeholderTextColor={d.muted}
              keyboardType="decimal-pad"
              style={s.amountInput}
              accessibilityLabel="Other amount"
            />
          </View>
          {!demo ? (
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleTitle}>Cover the fees</Text>
                <Text style={s.toggleSub}>Adds the BibleNestra fee, the payment processing fee and VAT so the organiser gets your full gift. Untick and the fees come out of your gift.</Text>
              </View>
              <DToggle value={cover} onChange={setCover} accessibilityLabel="Cover the fees" />
            </View>
          ) : null}
          {quote ? (
            <View style={s.quoteBox}>
              {[
                ['Your gift', quote.display.gift],
                ...(quote.currency !== 'NGN' ? [[`In Naira (₦${Number(quote.fxRate).toLocaleString()} per ${quote.currency})`, formatMoney(quote.giftNgnMinor, 'NGN')]] : []),
                ['BibleNestra fee', quote.display.platformFee],
                ['Payment processing (estimate)', quote.display.processingFee],
                ['VAT on fees', quote.display.vat],
                ['You pay', payLabel],
                ['The organiser receives', quote.display.beneficiary],
              ].map(([kk, v], i) => (
                <View key={kk} style={[s.quoteRow, i >= 5 && { marginTop: 4 }]}>
                  <Text style={[s.quoteKey, i >= 5 && { color: d.ink, fontFamily: df.sansBold }]}>{kk}</Text>
                  <Text style={[s.quoteVal, i >= 5 && { fontFamily: df.sansBold }]}>{v}</Text>
                </View>
              ))}
              {quote.converted ? <Text style={s.quoteNote}>Charged in Naira at our rate — your bank shows about {quote.display.donorTotal}. {f.settlementNote || ''}</Text> : null}
            </View>
          ) : null}
          <DLabel>Your name</DLabel>
          <DInput value={name} onChangeText={setName} placeholder="Name shown with your gift" maxLength={80} />
          {needsEmail ? (
            <>
              <DLabel>Email for your receipt</DLabel>
              <DInput value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" maxLength={200} />
            </>
          ) : null}
          <DLabel>Message (optional)</DLabel>
          <DInput value={message} onChangeText={setMessage} placeholder="Words of encouragement…" multiline maxLength={500} />
          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleTitle}>Give anonymously</Text>
              <Text style={s.toggleSub}>Your name is hidden on the public page (the organiser can still see it). Your gift still counts.</Text>
            </View>
            <DToggle value={anon} onChange={setAnon} accessibilityLabel="Give anonymously" />
          </View>
          {f.canTestDonate ? (
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleTitle}>Test donation (testers)</Text>
                <Text style={s.toggleSub}>Uses a simulated checkout. No real money moves.</Text>
              </View>
              <DToggle value={test} onChange={setTest} accessibilityLabel="Test donation" />
            </View>
          ) : null}
          {err ? <Text style={s.err}>{err}</Text> : null}
          <FBtn
            label={busy ? 'Starting checkout…' : payLabel ? `Donate ${payLabel}` : 'Donate'}
            onPress={submit}
            disabled={busy}
            style={{ marginTop: 14 }}
          />
          <Text style={s.sheetNote}>
            {demo ? 'Demo mode — the gift is recorded on this device only. No money moves.'
              : f.testMode || test ? 'Test mode — you’ll see a simulated checkout. No real money moves.' : `You’ll pay on Paystack’s secure checkout. ${HELD_EXPLAINER}`}
            {demo ? '' : ` ${f.refundPolicy || 'Donations are non-refundable.'}`}
          </Text>
        </ScrollView>
      </View>
    </AnimatedModal>
  );
}

// =============================================================================================
// Create / edit wizard
// =============================================================================================
const STEPS = ['Basics', 'Story', 'Files', 'Preview'];
let blockSeq = 0;
const bid = () => `b${Date.now().toString(36)}${(blockSeq++).toString(36)}`;

export function FundraiserEditScreen({ params = {} }) {
  const nav = useNav();
  const fm = useFundMe();
  const toast = useToast();
  const { state } = useStore();
  const [id, setId] = useState(params.id || null);
  const [loaded, setLoaded] = useState(!params.id);
  const [status, setStatus] = useState('draft');
  const [existing, setExisting] = useState(null);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState('NGN'); // FUND ME MONEY: donations go through Paystack in naira
  const [goalText, setGoalText] = useState('');
  const [main, setMain] = useState(null); // { key, url }
  const [blocks, setBlocks] = useState([{ id: bid(), type: 'p', text: '' }]);
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [buyCredits, setBuyCredits] = useState(false);
  const [creditsKey, setCreditsKey] = useState(0);
  const scroll = useRef(null);

  useEffect(() => {
    if (!params.id) return;
    fm.get(params.id).then((f) => {
      setExisting(f); setStatus(f.status); setTitle(f.title); setCurrency(f.currency); setGoalText(minorToText(f.goalMinor));
      setMain(f.mainImageUrl ? { key: f.mainImageKey || f.mainImageUrl, url: f.mainImageUrl } : null);
      setBlocks(f.story.length ? f.story.map((b) => ({ ...b, id: bid() })) : [{ id: bid(), type: 'p', text: '' }]);
      setMedia(f.media.map((m) => ({ ...m })));
      setLoaded(true);
    }).catch((e) => { toast.show(errorMessage(e, 'Couldn’t load the fundraiser'), { tone: 'error' }); nav.pop(); });
  }, [params.id]);

  const moneyLocked = !['draft', 'pending_review', 'rejected'].includes(status);
  const goalMinor = toMinor(goalText);
  const lim = LIMITS[currency];

  const validateBasics = () => {
    const e = {};
    if (title.trim().length < 3) e.title = 'Give your fundraiser a heading (at least 3 characters)';
    if (Number.isNaN(goalMinor) || goalMinor < Math.max(100, lim.min)) e.goal = `Enter a goal of at least ${formatMoney(Math.max(100, lim.min), currency)}`;
    else if (goalMinor > lim.goalMax) e.goal = `The largest goal is ${formatMoney(lim.goalMax, currency)}`;
    setErrors(e);
    return !Object.keys(e).length;
  };
  const storyChars = blocks.filter((b) => b.type === 'p').reduce((n, b) => n + b.text.trim().length, 0);
  const checklist = [
    ['Heading', title.trim().length >= 3],
    ['Goal', !Number.isNaN(goalMinor) && goalMinor >= Math.max(100, lim.min)],
    ['Main photo', !!main],
    ['Story (a few sentences)', storyChars >= 20],
  ];
  const ready = checklist.every((c) => c[1]);

  const payload = () => {
    const b = {
      title: title.trim(),
      story: blocks.filter((x) => (x.type === 'p' ? x.text.trim() : x.key)).map((x) => (x.type === 'p' ? { type: 'p', text: x.text } : { type: 'img', key: x.key, url: x.url, caption: x.caption || undefined })),
      media: media.map((m) => (m.id ? { id: m.id, caption: m.caption || undefined, visibility: m.visibility } : { kind: m.kind, key: m.key, url: m.url, name: m.name, caption: m.caption || undefined, visibility: m.visibility })),
    };
    if (main) { b.mainImageKey = main.key; b.mainImageUrl = main.url; } else if (id) b.mainImageKey = null;
    if (!moneyLocked) { b.currency = currency; b.goalMinor = goalMinor; }
    return b;
  };

  const save = async ({ quiet } = {}) => {
    if (!validateBasics()) { setStep(0); return null; }
    setBusy('save');
    try {
      const out = id ? await fm.update(id, payload()) : await fm.create(payload());
      if (!id) setId(out.id);
      setStatus(out.status);
      // media ids come back from the server (keeps public PDF links stable on later edits)
      setMedia(out.media.map((m) => ({ ...m })));
      if (!quiet) toast.show(id ? 'Changes saved' : 'Draft saved', { icon: 'check' });
      setBusy(null);
      return out;
    } catch (e) {
      setBusy(null);
      toast.show(errorMessage(e, 'Couldn’t save'), { tone: 'error' });
      return null;
    }
  };

  const submit = async () => {
    if (!ready) { toast.show('Finish the checklist before submitting', { tone: 'error' }); return; }
    const saved = await save({ quiet: true });
    if (!saved) return;
    if (['draft', 'rejected'].includes(saved.status)) {
      setBusy('submit');
      try {
        await fm.submit(saved.id);
        toast.show('Submitted for review — we’ll notify you when it’s live', { icon: 'check', duration: 3200 });
        nav.replace('Fundraiser', { id: saved.id });
      } catch (e) {
        toast.show(errorMessage(e, 'Couldn’t submit'), { tone: 'error', duration: 4200 });
        if (e && e.code === 'INSUFFICIENT_BALANCE') { setBuyCredits(true); setCreditsKey((x) => x + 1); }
      }
      setBusy(null);
    } else {
      toast.show('Changes saved', { icon: 'check' });
      nav.pop();
    }
  };

  const go = (n) => {
    if (n > 0 && step === 0 && !validateBasics()) return;
    setStep(n);
    if (scroll.current) scroll.current.scrollTo({ y: 0, animated: false });
  };

  // ----- uploads -----
  const withUpload = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.show(errorMessage(e, 'Upload failed'), { tone: 'error' }); }
    setBusy(null);
  };
  const pickMain = () => withUpload('main', async () => {
    const [p] = await pickPhotos(1);
    if (!p) return;
    const up = await fm.uploadImage(p);
    setMain({ key: up.key, url: up.url || p.uri });
  });
  const addStoryImage = () => withUpload('storyimg', async () => {
    const [p] = await pickPhotos(1);
    if (!p) return;
    const up = await fm.uploadImage(p);
    setBlocks((bs) => [...bs, { id: bid(), type: 'img', key: up.key, url: up.url || p.uri, caption: '' }, { id: bid(), type: 'p', text: '' }]);
  });
  const addPhotos = () => withUpload('photos', async () => {
    const left = 12 - media.filter((m) => m.kind === 'image').length;
    if (left <= 0) { toast.show('Up to 12 photos'); return; }
    const ps = await pickPhotos(Math.min(6, left));
    for (const p of ps) {
      const up = await fm.uploadImage(p);
      setMedia((ms) => [...ms, { kind: 'image', key: up.key, url: up.url || p.uri, caption: '', visibility: 'public' }]);
    }
  });
  const addPdf = () => withUpload('pdf', async () => {
    if (media.filter((m) => m.kind === 'pdf').length >= 6) { toast.show('Up to 6 documents'); return; }
    const dd = await pickPdf();
    if (!dd) return;
    const up = await fm.uploadPdf(dd);
    setMedia((ms) => [...ms, { kind: 'pdf', key: up.key, name: up.name || dd.name, caption: (dd.name || '').replace(/\.pdf$/i, ''), visibility: 'private' }]);
  });

  const updBlock = (bidv, patch) => setBlocks((bs) => bs.map((b) => (b.id === bidv ? { ...b, ...patch } : b)));
  const moveBlock = (i, dir) => setBlocks((bs) => { const a = [...bs]; const j = i + dir; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const removeBlock = (bidv) => setBlocks((bs) => (bs.length > 1 ? bs.filter((b) => b.id !== bidv) : [{ id: bid(), type: 'p', text: '' }]));
  const updMedia = (i, patch) => setMedia((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const removeMedia = (i) => setMedia((ms) => ms.filter((_, j) => j !== i));

  const previewF = useMemo(() => {
    const g = Number.isNaN(goalMinor) ? 0 : goalMinor;
    const raised = existing ? existing.raisedMinor : 0;
    return {
      title: title || 'Your heading', currency, goalMinor: g, raisedMinor: raised, remainingMinor: Math.max(0, g - raised),
      percent: g ? Math.floor((raised / g) * 100) : 0, donorsCount: existing ? existing.donorsCount : 0,
      mainImageUrl: main && main.url,
      story: blocks.filter((b) => (b.type === 'p' ? b.text.trim() : b.url)),
      media, donations: existing ? existing.donations || [] : [],
      owner: { displayName: (state.user && state.user.displayName) || 'You' },
    };
  }, [step, title, currency, goalMinor, main, blocks, media, existing]);

  if (!loaded) {
    return (
      <View style={k.screen}>
        <View style={s.wizHeader}><PageHeader title="Edit fundraiser" back onBack={() => nav.pop()} action={null} /></View>
        <ActivityIndicator color={d.plum} style={{ marginTop: 40 }} />
      </View>
    );
  }

  const isNew = !id;
  const submitLabel = ['draft', 'rejected'].includes(status) ? (busy === 'submit' ? 'Submitting…' : 'Submit for review') : 'Save changes';

  return (
    <View style={k.screen}>
      <View style={s.wizHeader}>
        <PageHeader
          title={isNew ? 'Start a fundraiser' : 'Edit fundraiser'}
          subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
          back
          onBack={() => nav.pop()}
          action={(
            <Tap onPress={() => save()} disabled={!!busy} style={s.saveBtn} accessibilityLabel="Save draft">
              <Text style={s.saveText}>{busy === 'save' ? 'Saving…' : 'Save'}</Text>
            </Tap>
          )}
        />
      </View>
      <View style={s.stepper}>
        <View style={s.stepperRail} />
        {STEPS.map((x, i) => (
          <Pressable key={x} onPress={() => (i <= step || validateBasics()) && go(i)} style={s.stepItem} accessibilityLabel={`Step ${i + 1}: ${x}`}>
            <View style={[s.stepDot, i <= step && s.stepDotOn]}>
              {i < step ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : <Text style={[s.stepNum, i <= step && { color: '#FFFFFF' }]}>{i + 1}</Text>}
            </View>
            <Text style={[s.stepLabel, i === step && { color: d.ink }]}>{x}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 0 ? (
          <FadeInUp key="s0">
            <Text style={s.stepTitle}>What are you raising money for?</Text>
            <Text style={s.stepSub}>A clear heading helps people understand your need at a glance.</Text>
            <DLabel style={{ marginTop: 14 }}>Heading</DLabel>
            <DInput value={title} onChangeText={(t) => { setTitle(t); if (errors.title) setErrors({ ...errors, title: null }); }} placeholder="e.g. Help Me Pay My Hospital Bill" maxLength={120} />
            {errors.title ? <Text style={s.err}>{errors.title}</Text> : null}
            <View style={s.suggestRow}>
              {['Help Me Pay My Hospital Bill', 'Support My Education', 'Support My Ministry'].map((x) => (
                <Tap key={x} onPress={() => setTitle(x)} style={s.suggest}><Text style={s.suggestText}>{x}</Text></Tap>
              ))}
            </View>
            <DLabel style={{ marginTop: 22 }}>Currency</DLabel>
            <View style={s.curRow}>
              {CURRENCIES.map((c) => (
                <Tap key={c} disabled={moneyLocked} onPress={() => setCurrency(c)} style={[s.cur, currency === c && s.on, moneyLocked && currency !== c && { opacity: 0.4 }]} accessibilityLabel={CURRENCY_NAME[c]}>
                  <Text style={[s.curSym, currency === c && { color: '#FFFFFF' }]}>{SYMBOL[c]}</Text>
                  <Text style={[s.curCode, currency === c && { color: 'rgba(255,255,255,0.8)' }]}>{c}</Text>
                </Tap>
              ))}
            </View>
            <DLabel style={{ marginTop: 18 }}>Amount to raise</DLabel>
            <View style={[s.amountBox, moneyLocked && { opacity: 0.55 }]}>
              <Text style={s.amountSym}>{SYMBOL[currency]}</Text>
              <TextInput
                value={goalText}
                editable={!moneyLocked}
                onChangeText={(t) => { setGoalText(t.replace(/[^\d.,]/g, '')); if (errors.goal) setErrors({ ...errors, goal: null }); }}
                placeholder="5,000"
                placeholderTextColor={d.muted}
                keyboardType="decimal-pad"
                style={s.amountInput}
                accessibilityLabel="Amount to raise"
              />
            </View>
            {errors.goal ? <Text style={s.err}>{errors.goal}</Text> : null}
            {moneyLocked ? <Text style={s.hint}>The goal and currency can’t change once a fundraiser is live.</Text> : (
              !Number.isNaN(goalMinor) && goalMinor > 0 ? <Text style={s.hint}>Your goal: {formatMoney(goalMinor, currency)}</Text> : null
            )}
            <FNotice icon="shield" text="Campaigns are reviewed before publishing. Supporting photos and PDFs can be added next." style={{ marginTop: 20 }} />
          </FadeInUp>
        ) : null}

        {step === 1 ? (
          <FadeInUp key="s1">
            <Text style={s.stepTitle}>Tell your story</Text>
            <Text style={s.stepSub}>Add a main photo, then explain what happened, what the money is for and how it will help. You can add photos between paragraphs.</Text>
            <DLabel style={{ marginTop: 14 }}>Main photo</DLabel>
            <Tap onPress={pickMain} style={s.mainPick} accessibilityLabel={main ? 'Change main photo' : 'Add main photo'}>
              {main ? <Image source={{ uri: main.url }} style={s.mainImg} /> : null}
              {busy === 'main' ? <ActivityIndicator color={main ? '#FFFFFF' : d.plum} /> : (
                main ? (
                  <View style={s.mainChange}>
                    <Icon name="image" size={15} color="#FFFFFF" />
                    <Text style={s.mainChangeText}>Change photo</Text>
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <Icon name="image" size={22} color={d.plum} />
                    <Text style={s.pickTitle}>Add a cover photo</Text>
                    <Text style={s.pickSub}>Clear, authentic images build trust.</Text>
                  </View>
                )
              )}
            </Tap>
            <DLabel style={{ marginTop: 22 }}>Story</DLabel>
            {blocks.map((b, i) => (
              <View key={b.id} style={s.block}>
                {b.type === 'p' ? (
                  <DInput
                    value={b.text}
                    onChangeText={(t) => updBlock(b.id, { text: t })}
                    placeholder={i === 0 ? 'Start with who you are and what happened…' : 'Continue your story…'}
                    multiline
                    maxLength={5000}
                    style={{ minHeight: 110 }}
                  />
                ) : (
                  <View style={s.blockImgWrap}>
                    <Image source={{ uri: b.url }} style={s.blockImg} />
                    <TextInput value={b.caption || ''} onChangeText={(t) => updBlock(b.id, { caption: t })} placeholder="Caption (optional)" placeholderTextColor={d.muted} style={s.captionInput} maxLength={200} />
                  </View>
                )}
                <View style={s.blockTools}>
                  <Pressable onPress={() => moveBlock(i, -1)} hitSlop={6} style={s.blockTool} accessibilityLabel="Move up"><Icon name="chevron-up" size={15} color={d.muted} /></Pressable>
                  <Pressable onPress={() => moveBlock(i, 1)} hitSlop={6} style={s.blockTool} accessibilityLabel="Move down"><Icon name="chevron-down" size={15} color={d.muted} /></Pressable>
                  <Pressable onPress={() => removeBlock(b.id)} hitSlop={6} style={s.blockTool} accessibilityLabel="Remove block"><Icon name="trash" size={14} color={d.muted} /></Pressable>
                </View>
              </View>
            ))}
            <View style={s.addRow}>
              <FBtn kind="ghost" small label="Paragraph" icon={<Icon name="type" size={14} color={d.ink} />} onPress={() => setBlocks((bs) => [...bs, { id: bid(), type: 'p', text: '' }])} style={{ flex: 1 }} />
              <FBtn kind="ghost" small label={busy === 'storyimg' ? 'Uploading…' : 'Image'} disabled={busy === 'storyimg'} icon={<Icon name="image" size={14} color={d.ink} />} onPress={addStoryImage} style={{ flex: 1 }} />
            </View>
            <Text style={s.hint}>{storyChars.toLocaleString()} / 20,000 characters</Text>
          </FadeInUp>
        ) : null}

        {step === 2 ? (
          <FadeInUp key="s2">
            <Text style={s.stepTitle}>Supporting photos & documents</Text>
            <Text style={s.stepSub}>Photos and documents (like a hospital report or school letter) help people trust your request.</Text>
            <DLabel style={{ marginTop: 14 }}>Photos</DLabel>
            <View style={s.grid}>
              {media.map((m, i) => (m.kind === 'image' ? (
                <View key={m.id || m.key} style={s.gridItem}>
                  <Image source={{ uri: m.url }} style={s.gridImg} />
                  <Pressable onPress={() => removeMedia(i)} hitSlop={6} style={s.gridRemove} accessibilityLabel="Remove photo"><Icon name="x" size={12} color="#FFFFFF" strokeWidth={2.6} /></Pressable>
                </View>
              ) : null))}
              <Tap onPress={addPhotos} style={[s.gridItem, s.gridAdd]} accessibilityLabel="Add photos">
                {busy === 'photos' ? <ActivityIndicator color={d.plum} /> : <><Icon name="plus" size={20} color={d.plum} /><Text style={s.gridAddText}>Add</Text></>}
              </Tap>
            </View>
            <DLabel style={{ marginTop: 22 }}>Documents (PDF)</DLabel>
            <FNotice tone="plum" text="Private documents are only seen by our review team. Make a document public to show it on your fundraiser page." />
            <View style={{ gap: 10, marginTop: 12 }}>
              {media.map((m, i) => (m.kind === 'pdf' ? (
                <View key={m.id || m.key} style={s.docEdit}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <FPdfTile />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <TextInput value={m.caption || ''} onChangeText={(t) => updMedia(i, { caption: t })} placeholder="Document title" placeholderTextColor={d.muted} style={s.docTitleInput} maxLength={200} />
                      <Text style={s.docSub} numberOfLines={1}>{m.name}</Text>
                    </View>
                    <Pressable onPress={() => removeMedia(i)} hitSlop={8} accessibilityLabel="Remove document"><Icon name="trash" size={16} color={d.muted} /></Pressable>
                  </View>
                  <View style={s.visRow}>
                    <Icon name={m.visibility === 'public' ? 'globe' : 'lock'} size={14} color={m.visibility === 'public' ? d.sageDark : d.muted} />
                    <Text style={s.visText}>{m.visibility === 'public' ? 'Public — shown on your page' : 'Private — review team only'}</Text>
                    <DToggle value={m.visibility === 'public'} onChange={(v) => updMedia(i, { visibility: v ? 'public' : 'private' })} accessibilityLabel="Show document publicly" />
                  </View>
                </View>
              ) : null))}
              <FBtn kind="ghost" label={busy === 'pdf' ? 'Uploading…' : 'Add a PDF document'} disabled={busy === 'pdf'} onPress={addPdf} icon={<Icon name="plus" size={15} color={d.ink} />} />
            </View>
          </FadeInUp>
        ) : null}

        {step === 3 ? (
          <FadeInUp key="s3">
            <Text style={s.stepTitle}>Preview</Text>
            <Text style={s.stepSub}>This is how your public page will look.</Text>
            <View style={s.checklist}>
              {checklist.map(([label, ok]) => (
                <View key={label} style={s.checkItem}>
                  <View style={[s.checkDot, ok && { backgroundColor: d.sageDark, borderColor: d.sageDark }]}>{ok ? <Icon name="check" size={11} color="#FFFAF2" strokeWidth={3} /> : null}</View>
                  <Text style={[s.checkText, !ok && { color: d.muted }]}>{label}</Text>
                </View>
              ))}
            </View>
            <DCard style={s.previewFrame}>
              <Thumb uri={previewF.mainImageUrl} style={s.cover} />
              <Text style={[s.detailTitle, { marginTop: 14 }]}>{previewF.title}</Text>
              <Text style={[s.orgName, { marginBottom: 14, fontFamily: df.sans, color: d.muted }]}>Organised by {previewF.owner.displayName}</Text>
              <DCard style={s.progressCard}><Progress f={previewF} big /></DCard>
              <FundraiserBody f={previewF} showPrivate={false} />
            </DCard>
            {['draft', 'rejected'].includes(status) ? <Text style={[s.hint, { marginTop: 16 }]}>After you submit, our team reviews your fundraiser (usually within a day). We’ll notify you when your public page is live.</Text> : null}
            {['draft', 'rejected'].includes(status) && !fm.demo ? <FundMeCreditsCard style={{ marginTop: 14 }} refreshKey={creditsKey} /> : null}
          </FadeInUp>
        ) : null}
      </ScrollView>
      <View style={s.footer}>
        {step > 0 ? <FBtn kind="ghost" label="Back" onPress={() => go(step - 1)} style={{ flex: 0.6 }} /> : <FBtn kind="ghost" label={busy === 'save' ? 'Saving…' : 'Save draft'} onPress={() => save()} disabled={!!busy} style={{ flex: 0.8 }} />}
        {step < STEPS.length - 1
          ? <FBtn label="Continue" onPress={() => go(step + 1)} style={{ flex: 1 }} icon={<Icon name="arrow-right" size={15} color="#FFFFFF" />} />
          : <FBtn label={submitLabel} onPress={submit} disabled={!!busy || (['draft', 'rejected'].includes(status) && !ready)} style={{ flex: 1 }} />}
      </View>
      <BuyCoinsSheet visible={buyCredits} wallet="fundme_credits" onClose={() => setBuyCredits(false)} onPurchased={() => { setBuyCredits(false); setCreditsKey((x) => x + 1); }} />
    </View>
  );
}

// =============================================================================================
// Donations (organiser)
// =============================================================================================
export function FundraiserDonationsScreen({ params = {} }) {
  const fm = useFundMe();
  const [items, setItems] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      const [dn, fr] = await Promise.all([fm.donations(params.id), fm.get(params.id)]);
      setItems(dn.items); setF(fr); setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load donations')); }
  }, [fm, params.id]);
  useReload(load);
  const cur = (f && f.currency) || params.currency || 'GBP';
  const ok = (items || []).filter((x) => x.status === 'succeeded');
  const nav = useNav();
  const avg = ok.length ? Math.round(ok.reduce((n, x) => n + x.amountMinor, 0) / ok.length) : 0;
  return (
    <DScreen title="Donations" subtitle={params.title} back onBack={() => nav.pop()}>
      {error ? <FNotice text={error} tone="danger" /> : null}
      {f ? (
        <FadeInUp>
          <DCard style={s.progressCard}>
            <Progress f={f} big />
          </DCard>
          <View style={s.kpis}>
            <FKpi label="Donations" value={String(ok.length)} />
            <FKpi label="Average gift" value={formatMoney(avg, cur)} />
            <FKpi label="Remaining" value={formatMoney(f.remainingMinor, cur)} />
          </View>
        </FadeInUp>
      ) : null}
      {!fm.demo ? <FBtn kind="ghost" label="Money & payouts" onPress={() => nav.push('FundMeMoney', { id: params.id, title: params.title })} style={{ marginTop: 14 }} icon={<Icon name="coin" size={15} color={d.ink} />} /> : null}
      <SectionTitle title="All gifts" />
      {items === null ? <Skeleton rows={3} /> : items.length ? (
        <DCard style={s.donorCard}>
          {items.map((x, i) => (
            <FadeInUp key={x.id} index={i} style={[s.donor, i > 0 && s.donorBorder]}>
              <View style={s.avatar}><Text style={s.avatarText}>{initials(x.name)}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={s.donorName}>{x.name}</Text>
                  {x.anonymous ? <FBadge label="Anonymous publicly" tint={colors.slate} /> : null}
                  {x.settlementStatus && DONATION_STATUS[x.settlementStatus] ? <FBadge label={DONATION_STATUS[x.settlementStatus].label} tint={DONATION_STATUS[x.settlementStatus].tint} /> : x.status === 'refunded' ? <FBadge label="Refunded" tint={colors.negative} /> : null}
                </View>
                <Text style={s.donorMeta}>{timeAgo(x.completedAt || x.createdAt)}</Text>
                {x.message ? <Text style={s.donorMsg}>“{x.message}”</Text> : null}
              </View>
              <Text style={s.donAmt}>{formatMoney(x.amountMinor, x.currency)}</Text>
            </FadeInUp>
          ))}
        </DCard>
      ) : <FEmpty title="No donations yet" body="Share your link on WhatsApp, Facebook or Instagram to get your first gift." />}
    </DScreen>
  );
}

// =============================================================================================
const s = {
  // home
  hero: { borderRadius: 26, padding: 24, overflow: 'hidden' },
  heroIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.45)', alignItems: 'center', justifyContent: 'center' },
  heroEyebrow: { marginTop: 14, color: d.goldDark, fontFamily: df.sansBold, fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase' },
  heroTitle: { marginTop: 8, color: d.goldDark, fontFamily: df.displayBold, fontSize: 25, lineHeight: 30, letterSpacing: -0.4 },
  heroBody: { marginTop: 8, color: d.goldDark, fontFamily: df.sans, fontSize: 11.5, lineHeight: 18, opacity: 0.85 },
  heroBtn: { marginTop: 18, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: d.plum, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  heroBtnText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 12 },
  heroSteps: { flexDirection: 'row', gap: 8, marginTop: 18 },
  heroStep: { flex: 1, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 14, padding: 10 },
  heroStepNum: { fontFamily: df.displayBold, color: d.plumDark, fontSize: 16 },
  heroStepText: { fontFamily: df.sans, color: d.goldDark, fontSize: 10, marginTop: 2, lineHeight: 14 },
  stats: { flexDirection: 'row', gap: 9, marginTop: 12 },
  stat2: { flex: 1, padding: 14, borderRadius: 16, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  stat2Num: { fontFamily: df.displayBold, fontSize: 19, color: d.ink },
  stat2Label: { fontFamily: df.sans, fontSize: 10, color: d.muted, marginTop: 2 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  quick: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 12, borderRadius: 16, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  quickIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  quickText: { color: d.ink, fontFamily: df.sansBold, fontSize: 10.5, textAlign: 'center' },
  note: { color: d.muted, fontFamily: df.sans, fontSize: 10.5, lineHeight: 16, marginTop: 10 },
  minis: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  miniWrap: { width: '48.5%' },
  giftOnImage: { position: 'absolute', top: 10, right: 10, zIndex: 2 }, // FUND ME GIFTS: star on a card's photo
  mini: { borderRadius: 18, overflow: 'hidden', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  miniImg: { width: '100%', height: 96 },
  miniBody: { padding: 12 },
  miniKicker: { color: d.plum, fontFamily: df.sansHeavy, fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase' },
  miniTitle: { fontFamily: df.display, fontSize: 12.5, lineHeight: 17, color: d.ink, marginTop: 4, marginBottom: 6 },
  bigCard: { borderRadius: 21, overflow: 'hidden', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  bigImg: { width: '100%', height: 170 },
  bigBody: { padding: 15 },
  kicker: { color: d.plum, fontFamily: df.sansHeavy, fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase' },
  bigTitle: { fontFamily: df.display, fontSize: 17, lineHeight: 22, color: d.ink, marginTop: 5 },
  owner: { fontFamily: df.sans, fontSize: 10.5, color: d.muted, marginTop: 3 },
  excerpt: { fontFamily: df.sans, fontSize: 11, lineHeight: 17, color: d.muted, marginTop: 4 },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  footL: { fontFamily: df.sansBold, fontSize: 10, color: d.ink },
  footR: { fontFamily: df.sans, fontSize: 10, color: d.muted },
  mineRow: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: d.paper, borderRadius: 20, borderWidth: 1, borderColor: d.line, padding: 12 },
  mineThumb: { width: 72, height: 72, borderRadius: 14 },
  mineTitle: { fontFamily: df.display, fontSize: 14, color: d.ink, lineHeight: 18 },
  thumbBase: { backgroundColor: d.lavender },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  saveBtn: { paddingHorizontal: 12, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: d.plum },
  saveText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 11.5 },

  // progress
  bar: { height: 8, borderRadius: 99, backgroundColor: (isDarkScheme() ? '#262626' : '#e8e8e8'), marginTop: 8, overflow: 'hidden' },
  barBig: { height: 10, marginTop: 14, marginBottom: 10 },
  barFill: { backgroundColor: d.plum, borderRadius: 99 },
  raisedBig: { fontFamily: df.displayBold, fontSize: 30, letterSpacing: -0.6, color: d.ink },
  ofGoal: { fontFamily: df.sans, color: d.muted, fontSize: 12, marginTop: 2 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { color: d.muted, fontFamily: df.sans, fontSize: 10 },
  statStrong: { color: d.ink, fontFamily: df.sansBold },
  cardMoneyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 },
  cardRaised: { color: d.ink, fontFamily: df.sansBold, fontSize: 11 },
  cardOf: { color: d.muted, fontFamily: df.sans },
  cardPct: { color: d.plum, fontFamily: df.sansBold, fontSize: 11 },

  // detail
  banner: { borderLeftWidth: 3, borderRadius: 14, padding: 12, marginBottom: 14 },
  bannerTitle: { fontFamily: df.sansBold, fontSize: 12.5 },
  bannerText: { color: d.ink, fontFamily: df.sans, fontSize: 11, lineHeight: 17, marginTop: 2 },
  cover: { width: '100%', aspectRatio: 16 / 10, borderRadius: 24 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  verifiedText: { color: d.sageDark, fontFamily: df.sansBold, fontSize: 10.5 },
  detailTitle: { fontFamily: df.displayBold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: d.ink, marginTop: 8 },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: d.line },
  orgAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: d.gold, alignItems: 'center', justifyContent: 'center' },
  orgAvatarText: { fontFamily: df.sansHeavy, fontSize: 10, color: d.goldDark },
  orgSmall: { color: d.plum, fontFamily: df.sansHeavy, fontSize: 8, letterSpacing: 1, textTransform: 'uppercase' },
  orgName: { fontFamily: df.display, fontSize: 13, color: d.ink, marginTop: 2 },
  progressCard: { padding: 18, marginTop: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  soon: { borderRadius: 999, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center', paddingVertical: 13 },
  soonText: { color: d.muted, fontFamily: df.sansBold, fontSize: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: d.lavender, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  linkText: { flex: 1, color: d.plumDark, fontFamily: df.sans, fontSize: 11 },
  linkCopy: { color: d.plum, fontFamily: df.sansBold, fontSize: 11 },
  heldNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12 },
  heldNoteText: { flex: 1, color: d.muted, fontFamily: df.sans, fontSize: 10.5, lineHeight: 16 },
  toolsTitle: { fontFamily: df.sansHeavy, fontSize: 9, letterSpacing: 1.3, textTransform: 'uppercase', color: d.plum, marginBottom: 10 },
  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tool: { width: '23%', minWidth: 70, flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 8 },
  toolIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontFamily: df.sansBold, fontSize: 10.5, color: d.ink },
  muted: { color: d.muted, fontFamily: df.sans, fontSize: 12, lineHeight: 18 },
  storyP: { fontFamily: df.display, fontSize: 14.5, lineHeight: 25, color: d.ink, marginBottom: 14 },
  storyImg: { width: '100%', aspectRatio: 3 / 2, borderRadius: 18, backgroundColor: d.lavender },
  caption: { color: d.muted, fontFamily: df.sans, fontSize: 10.5, textAlign: 'center', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridItem: { width: '31.6%', aspectRatio: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: d.lavender },
  gridImg: { width: '100%', height: '100%' },
  gridRemove: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(40,26,17,0.6)', alignItems: 'center', justifyContent: 'center' },
  gridAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), backgroundColor: d.paper, gap: 2 },
  gridAddText: { color: d.plum, fontFamily: df.sansBold, fontSize: 10.5 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: d.paper, borderRadius: 16, borderWidth: 1, borderColor: d.line },
  docTitle: { fontFamily: df.display, fontSize: 13, color: d.ink },
  docSub: { fontFamily: df.sans, fontSize: 10, color: d.muted, marginTop: 1 },

  donorCard: { padding: 0, marginTop: 0 },
  donor: { flexDirection: 'row', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  donorBorder: { borderTopWidth: 1, borderTopColor: d.line },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: d.gold, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: df.displayBold, fontSize: 12, color: d.goldDark },
  donorName: { fontFamily: df.sansBold, fontSize: 12, color: d.ink },
  donorMeta: { fontFamily: df.sans, fontSize: 10, color: d.muted, marginTop: 1 },
  donorMsg: { fontFamily: 'Playfair-Italic', fontSize: 13, lineHeight: 20, color: d.ink, marginTop: 6 },
  donAmt: { fontFamily: df.displayBold, fontSize: 15, color: d.ink },

  lightbox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  lightboxImg: { width: '100%', height: '80%' },
  lightboxClose: { position: 'absolute', top: 50, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },

  donateBar: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', gap: 8, padding: 7, borderRadius: 18, backgroundColor: (isDarkScheme() ? 'rgba(17,17,17,0.96)' : 'rgba(255,255,255,0.96)'), borderWidth: 1, borderColor: d.line },

  // sheets
  sheet: { backgroundColor: d.ivory, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, maxHeight: '92%' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), marginBottom: 14 },
  sheetTitle: { fontFamily: df.displayBold, fontSize: 21, letterSpacing: -0.4, color: d.ink, marginTop: 4 },
  sheetNote: { color: d.muted, fontFamily: df.sans, fontSize: 10, textAlign: 'center', marginTop: 10, lineHeight: 16 },
  curBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  curBtnText: { color: d.ink, fontFamily: df.sansBold, fontSize: 11 },
  curList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  fxAttr: { color: d.muted, fontFamily: df.sans, fontSize: 9.5, textDecorationLine: 'underline' }, // LIVE FX: "Rates by Exchange Rate API" (required attribution)
  curChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  curChipText: { color: d.ink, fontFamily: df.sansBold, fontSize: 11 },
  quoteBox: { marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, gap: 4 },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  quoteKey: { color: d.muted, fontFamily: df.sans, fontSize: 11, flex: 1 },
  quoteVal: { color: d.ink, fontFamily: df.sansBold, fontSize: 11 },
  quoteNote: { color: d.muted, fontFamily: df.sans, fontSize: 9.5, marginTop: 6, lineHeight: 15 },
  presets: { flexDirection: 'row', gap: 8, marginTop: 16 },
  preset: { flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: d.plum, borderColor: d.plum },
  presetText: { fontFamily: df.sansHeavy, fontSize: 12, color: d.ink },
  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: d.paper, borderRadius: 14, borderWidth: 1, borderColor: d.line, paddingHorizontal: 14, marginTop: 10, height: 54 },
  amountSym: { fontFamily: df.displayBold, fontSize: 20, color: d.muted, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 16, fontFamily: df.sansBold, color: d.ink, paddingVertical: 0, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, backgroundColor: d.paper, borderRadius: 18, borderWidth: 1, borderColor: d.line, padding: 14 },
  toggleTitle: { fontFamily: df.display, fontSize: 13, color: d.ink },
  toggleSub: { fontFamily: df.sans, color: d.muted, fontSize: 9.5, lineHeight: 15, marginTop: 3 },
  err: { color: (isDarkScheme() ? '#E8A09A' : '#8A2F2F'), fontFamily: df.sans, fontSize: 11, marginTop: 8 },
  hint: { color: d.muted, fontFamily: df.sans, fontSize: 10.5, marginTop: 8, lineHeight: 16 },

  // wizard
  wizHeader: { paddingHorizontal: 18, paddingTop: 8 },
  stepper: { flexDirection: 'row', paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: d.line },
  stepperRail: { position: 'absolute', left: '12.5%', right: '12.5%', top: 18, height: 1.5, backgroundColor: d.line },
  stepItem: { flex: 1, alignItems: 'center', gap: 6 },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), alignItems: 'center', justifyContent: 'center', backgroundColor: d.paper },
  stepDotOn: { backgroundColor: d.plum, borderColor: d.plum },
  stepNum: { fontFamily: df.sansHeavy, fontSize: 11, color: d.muted },
  stepLabel: { fontFamily: df.sansBold, fontSize: 9.5, color: d.muted },
  stepTitle: { fontFamily: df.displayBold, fontSize: 23, letterSpacing: -0.5, color: d.ink, lineHeight: 28 },
  stepSub: { color: d.muted, fontFamily: df.sans, fontSize: 11.5, lineHeight: 18, marginTop: 6 },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  suggest: { backgroundColor: d.lavender, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  suggestText: { color: d.plumDark, fontFamily: df.sansBold, fontSize: 10.5 },
  curRow: { flexDirection: 'row', gap: 8 },
  cur: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  curSym: { fontFamily: df.displayBold, fontSize: 18, color: d.ink },
  curCode: { fontFamily: df.sansBold, fontSize: 9.5, color: d.muted, marginTop: 1 },
  mainPick: { height: 190, borderRadius: 20, overflow: 'hidden', backgroundColor: d.paper, borderWidth: 1.5, borderStyle: 'dashed', borderColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), alignItems: 'center', justifyContent: 'center' },
  mainImg: fillImage,
  mainChange: { flexDirection: 'row', alignItems: 'center', gap: 6, position: 'absolute', bottom: 12, right: 12, backgroundColor: 'rgba(40,26,17,0.6)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  mainChangeText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 11 },
  pickTitle: { fontFamily: df.display, fontSize: 13, color: d.ink, marginTop: 6 },
  pickSub: { fontFamily: df.sans, fontSize: 10, color: d.muted },
  block: { marginBottom: 12 },
  blockImgWrap: { backgroundColor: d.paper, borderRadius: 18, borderWidth: 1, borderColor: d.line, overflow: 'hidden' },
  blockImg: { width: '100%', aspectRatio: 16 / 9, backgroundColor: d.lavender },
  captionInput: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 11.5, fontFamily: df.sans, color: d.ink, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  blockTools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  blockTool: { width: 30, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: d.lavender },
  addRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  docEdit: { backgroundColor: d.paper, borderRadius: 18, borderWidth: 1, borderColor: d.line, padding: 12 },
  docTitleInput: { fontFamily: df.display, fontSize: 13, color: d.ink, paddingVertical: 2, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  visRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: d.line },
  visText: { flex: 1, color: d.muted, fontFamily: df.sans, fontSize: 10.5 },
  checklist: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8, marginBottom: 16 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), alignItems: 'center', justifyContent: 'center' },
  checkText: { fontFamily: df.sansBold, fontSize: 10.5, color: d.ink },
  previewFrame: { padding: 14, borderRadius: 24 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: d.line, backgroundColor: d.ivory },

  // donations
  kpis: { flexDirection: 'row', gap: 8, marginTop: 12 },
};
