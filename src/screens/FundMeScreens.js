// FUND ME (round 3) — fundraising requests: home (start / mine / discover), detail (progress, story, donors,
// donate, share), create/edit wizard (heading, goal, main photo, story with images, supporting photos & PDFs,
// preview, submit for review) and the organiser's donations list.
// Online: data from the Worker via ../api/fundme. Local mode: an on-device demo with sample fundraisers.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { Screen, Section, Button, Input, Badge, Notice, Empty, Eyebrow, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { AnimatedModal, AnimatedBar, AnimatedNumber, Burst, FadeInUp, PressScale, ScaleIn, Shimmer } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useStore } from '../store';
import { errorMessage } from '../api/client';
import { pickPhotos } from '../api/media';
import {
  useFundMe, onFundMeChange, pickPdf, formatMoney, toMinor, minorToText, CURRENCIES, SYMBOL, CURRENCY_NAME, LIMITS, STATUS_LABEL,
} from '../api/fundme';

const STATUS_TINT = {
  draft: colors.muted, pending_review: colors.gold, live: colors.positive, paused: colors.slate, closed: colors.slate, rejected: colors.negative,
};
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
  return <Badge label={STATUS_LABEL[status] || status} tint={STATUS_TINT[status] || colors.muted} />;
}

function Progress({ f, big }) {
  const pct = Math.min(1, f.goalMinor ? f.raisedMinor / f.goalMinor : 0);
  return (
    <View>
      {big ? (
        <>
          <AnimatedNumber value={f.raisedMinor} style={styles.raisedBig} format={(n) => formatMoney(Math.round(n), f.currency)} />
          <Text style={styles.ofGoal}>raised of {formatMoney(f.goalMinor, f.currency)} goal</Text>
        </>
      ) : null}
      <AnimatedBar progress={pct} style={[styles.bar, big && styles.barBig]} fillStyle={styles.barFill} />
      {big ? (
        <View style={styles.statsRow}>
          <Text style={styles.stat}><Text style={styles.statStrong}>{f.percent}%</Text> funded</Text>
          <Text style={styles.stat}><Text style={styles.statStrong}>{f.donorsCount}</Text> {f.donorsCount === 1 ? 'donor' : 'donors'}</Text>
          <Text style={styles.stat}><Text style={styles.statStrong}>{formatMoney(f.remainingMinor, f.currency)}</Text> to go</Text>
        </View>
      ) : (
        <View style={styles.cardMoneyRow}>
          <Text style={styles.cardRaised}>{formatMoney(f.raisedMinor, f.currency)} <Text style={styles.cardOf}>of {formatMoney(f.goalMinor, f.currency)}</Text></Text>
          <Text style={styles.cardPct}>{f.percent}%</Text>
        </View>
      )}
    </View>
  );
}

function Thumb({ uri, style }) {
  return uri ? <Image source={{ uri }} style={[styles.thumbBase, style]} /> : (
    <View style={[styles.thumbBase, styles.thumbEmpty, style]}><Icon name="image" size={22} color={colors.faint} /></View>
  );
}

function DiscoverCard({ f, onPress, index }) {
  return (
    <FadeInUp index={index}>
      <PressScale onPress={onPress} scaleTo={0.98} style={styles.dCard} accessibilityLabel={f.title}>
        <Thumb uri={f.mainImageUrl} style={styles.dImage} />
        <View style={{ padding: 14, gap: 6 }}>
          <Text style={styles.dTitle} numberOfLines={2}>{f.title}</Text>
          {f.owner ? <Text style={styles.dOwner} numberOfLines={1}>by {f.owner.displayName}</Text> : null}
          {f.excerpt ? <Text style={styles.dExcerpt} numberOfLines={2}>{f.excerpt}</Text> : null}
          <View style={{ marginTop: 4 }}><Progress f={f} /></View>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

function MineRow({ f, onPress, index }) {
  return (
    <FadeInUp index={index}>
      <PressScale onPress={onPress} scaleTo={0.985} style={styles.mineRow} accessibilityLabel={f.title}>
        <Thumb uri={f.mainImageUrl} style={styles.mineThumb} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.mineTitle} numberOfLines={1}>{f.title}</Text>
          </View>
          <View style={{ flexDirection: 'row' }}><StatusBadge status={f.status} /></View>
          <Progress f={f} />
        </View>
      </PressScale>
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

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([fm.mine(), fm.discover()]);
      setMine(m.items); setLive(d.items); setCursor(d.cursor); setMore(!!d.hasMore); setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load fundraisers')); }
  }, [fm]);
  useReload(load);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try { const d = await fm.discover(cursor); setLive((l) => [...l, ...d.items]); setCursor(d.cursor); setMore(!!d.hasMore); } catch (e) { toast.show(errorMessage(e), { tone: 'error' }); }
    setLoadingMore(false);
  };

  return (
    <Screen title="Fund Me" back>
      <FadeInUp>
        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <Eyebrow tint={colors.goldLight}>Fund Me</Eyebrow>
          <Text style={styles.heroTitle}>Raise support for what matters</Text>
          <Text style={styles.heroBody}>Hospital bills, school fees, ministry needs — share your story and receive gifts from people who care.</Text>
          <PressScale onPress={() => nav.push('FundraiserEdit', {})} scaleTo={0.96} style={styles.heroBtn} accessibilityLabel="Start a fundraiser">
            <Icon name="plus" size={16} color={colors.night} strokeWidth={2.4} />
            <Text style={styles.heroBtnText}>Start a fundraiser</Text>
          </PressScale>
          <View style={styles.heroSteps}>
            {['Tell your story', 'We review it', 'Share your link'].map((t, i) => (
              <View key={t} style={styles.heroStep}>
                <Text style={styles.heroStepNum}>{i + 1}</Text>
                <Text style={styles.heroStepText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      </FadeInUp>
      {fm.demo ? <View style={{ marginTop: 14 }}><Notice text="Demo mode — sample fundraisers on this device. Sign in online to raise real support." /></View> : null}
      {error ? <View style={{ marginTop: 14 }}><Notice text={error} tint={colors.negative} /></View> : null}

      <Section title="My fundraisers" style={{ marginTop: 26 }}>
        {mine === null ? <Skeleton rows={1} /> : mine.length ? (
          <View style={{ gap: 10 }}>
            {mine.map((f, i) => <MineRow key={f.id} f={f} index={i} onPress={() => nav.push('Fundraiser', { id: f.id })} />)}
          </View>
        ) : (
          <View style={styles.emptyMine}>
            <Text style={styles.emptyMineText}>You haven’t started a fundraiser yet.</Text>
          </View>
        )}
      </Section>

      <Section title="Discover fundraisers" style={{ marginTop: 26 }}>
        {live === null ? <Skeleton rows={2} big /> : live.length ? (
          <View style={{ gap: 14 }}>
            {live.map((f, i) => <DiscoverCard key={f.id} f={f} index={i} onPress={() => nav.push('Fundraiser', { id: f.id })} />)}
            {more ? <Button kind="ghost" label={loadingMore ? 'Loading…' : 'Show more'} onPress={loadMore} disabled={loadingMore} /> : null}
          </View>
        ) : <Empty title="No live fundraisers yet" body="When fundraisers are approved they appear here." />}
      </Section>
    </Screen>
  );
}

function Skeleton({ rows = 1, big }) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => <Shimmer key={i} style={{ height: big ? 230 : 92, borderRadius: radius.lg }} />)}
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
      <Text style={styles.h2}>Story</Text>
      {(f.story || []).length ? f.story.map((b, i) => (b.type === 'p' ? (
        <Text key={i} style={styles.storyP}>{b.text}</Text>
      ) : (
        <Pressable key={i} onPress={() => onImage && onImage(b.url)} style={{ marginBottom: 16 }} accessibilityLabel="Open photo">
          <Image source={{ uri: b.url }} style={styles.storyImg} />
          {b.caption ? <Text style={styles.caption}>{b.caption}</Text> : null}
        </Pressable>
      ))) : <Text style={styles.muted}>No story yet.</Text>}

      {images.length ? (
        <>
          <Text style={styles.h2}>Photos</Text>
          <View style={styles.grid}>
            {images.map((m) => (
              <PressScale key={m.id || m.url} onPress={() => onImage && onImage(m.url)} scaleTo={0.95} style={styles.gridItem} accessibilityLabel={m.caption || 'Photo'}>
                <Image source={{ uri: m.url }} style={styles.gridImg} />
              </PressScale>
            ))}
          </View>
        </>
      ) : null}

      {docs.length ? (
        <>
          <Text style={styles.h2}>Documents</Text>
          <View style={{ gap: 8 }}>
            {docs.map((m) => (
              <PressScale key={m.id || m.key || m.name} onPress={() => onDoc && onDoc(m)} scaleTo={0.98} style={styles.docRow} accessibilityLabel={m.caption || m.name || 'Document'}>
                <View style={styles.docIcon}><Text style={styles.docIconText}>PDF</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.docTitle} numberOfLines={1}>{m.caption || m.name || 'Document'}</Text>
                  <Text style={styles.docSub} numberOfLines={1}>{m.name || 'Tap to open'}</Text>
                </View>
                {showPrivate && m.visibility === 'private' ? <Badge label="Private" tint={colors.slate} /> : <Icon name="arrow-up-right" size={16} color={colors.faint} />}
              </PressScale>
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
      <Text style={styles.h2}>Words of support{f.donorsCount ? <Text style={styles.h2Count}>  · {f.donorsCount}</Text> : null}</Text>
      {list.length ? (
        <View style={styles.card}>
          {list.map((d, i) => (
            <FadeInUp key={`${d.createdAt}-${i}`} index={i} style={[styles.donor, i > 0 && styles.donorBorder]}>
              <View style={[styles.avatar, d.anonymous && { backgroundColor: colors.primarySoft }]}>
                {d.anonymous ? <Icon name="heart" size={14} color={colors.primary} /> : <Text style={styles.avatarText}>{initials(d.name)}</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.donorName}>{d.name}</Text>
                <Text style={styles.donorMeta}>{formatMoney(d.amountMinor, d.currency)} · {timeAgo(d.createdAt)}</Text>
                {d.message ? <Text style={styles.donorMsg}>“{d.message}”</Text> : null}
              </View>
            </FadeInUp>
          ))}
        </View>
      ) : (
        <View style={[styles.card, { padding: 16 }]}><Text style={styles.muted}>Be the first to give and leave a word of encouragement.</Text></View>
      )}
    </View>
  );
}

function Lightbox({ uri, onClose }) {
  return (
    <AnimatedModal visible={!!uri} onRequestClose={onClose} full dim="rgba(21,23,43,0.94)">
      <Pressable style={styles.lightbox} onPress={onClose} accessibilityLabel="Close photo">
        {uri ? <Image source={{ uri }} style={styles.lightboxImg} resizeMode="contain" /> : null}
        <View style={styles.lightboxClose}><Icon name="x" size={18} color="#FFFFFF" /></View>
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
  const [confirm, setConfirm] = useState(null); // 'close'
  const [busy, setBusy] = useState(null);
  const [celebrate, setCelebrate] = useState(0);
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
        const s = await fm.donationStatus(slug, donationId);
        if (s.status === 'succeeded') {
          clearInterval(poll.current);
          await load();
          setCelebrate((n) => n + 1);
          toast.show('Thank you! Your donation was received', { icon: 'heart', haptic: 'success', duration: 3600 });
          fm.notifyChanged();
        } else if (s.status === 'failed') {
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
    } catch (e) { toast.show(errorMessage(e), { tone: 'error' }); }
    setBusy(null); setConfirm(null);
  };

  if (!f) {
    return (
      <Screen title="Fundraiser" back>
        {error ? <Empty title="Fundraiser unavailable" body={error} action="Try again" onAction={load} /> : (
          <View style={{ gap: 14 }}>
            <Shimmer style={{ height: 220, borderRadius: radius.lg }} />
            <Shimmer style={{ height: 28, width: '70%' }} />
            <Shimmer style={{ height: 150, borderRadius: radius.lg }} />
          </View>
        )}
      </Screen>
    );
  }

  const banner = owner ? OWNER_BANNER[f.status] : null;
  const canDonate = f.status === 'live';
  const soon = canDonate && !f.paymentsReady;
  // the public page exists once approved (admin-paused pages are hidden)
  const isPublic = f.status === 'live' || (['paused', 'closed'].includes(f.status) && f.pausedBy !== 'admin' && (!owner || !!f.approvedAt || fm.demo));

  return (
    <Screen
      title={owner ? 'Your fundraiser' : 'Fundraiser'}
      back
      right={owner && f.status !== 'closed' ? (
        <Pressable onPress={() => nav.push('FundraiserEdit', { id: f.id })} hitSlop={10} style={styles.headerBtn} accessibilityLabel="Edit fundraiser">
          <Icon name="edit" size={18} color={colors.fg} />
        </Pressable>
      ) : null}
    >
      {banner ? (
        <FadeInUp>
          <View style={[styles.banner, { backgroundColor: alpha(banner[2], 0.1), borderLeftColor: banner[2] }]}>
            <Text style={[styles.bannerTitle, { color: banner[2] }]}>{banner[0]}</Text>
            <Text style={styles.bannerText}>{f.status === 'rejected' ? `Our team asked for changes: ${f.rejectReason || 'see your notifications'}. Edit and resubmit when ready.` : banner[1]}</Text>
          </View>
        </FadeInUp>
      ) : null}
      {f.testMode && canDonate && !fm.demo ? <View style={{ marginBottom: 12 }}><Notice text="Test payments — donations use a simulated checkout. No real money moves." /></View> : null}

      <FadeInUp index={1}>
        <Pressable onPress={() => f.mainImageUrl && setLightbox(f.mainImageUrl)} accessibilityLabel="Open main photo">
          <Thumb uri={f.mainImageUrl} style={styles.hero2} />
        </Pressable>
        <Eyebrow style={{ marginTop: 18 }}>Fundraiser</Eyebrow>
        <Text style={styles.title}>{f.title}</Text>
        <View style={styles.orgRow}>
          <View style={styles.avatarSm}><Text style={styles.avatarSmText}>{initials(f.owner && f.owner.displayName)}</Text></View>
          <Text style={styles.orgText}>Organised by <Text style={{ color: colors.fg, fontWeight: '700' }}>{owner ? (f.owner && f.owner.displayName && f.owner.displayName !== 'You' ? `${f.owner.displayName} (you)` : 'you') : f.owner && f.owner.displayName}</Text></Text>
        </View>
      </FadeInUp>

      <FadeInUp index={2}>
        <View style={[styles.card, styles.progressCard]}>
          <Burst trigger={celebrate} count={14} radius={80} />
          <Progress f={f} big />
          {canDonate || isPublic ? (
          <View style={styles.actions}>
            {canDonate ? (
              soon ? (
                <View style={[styles.soon, { flex: 1 }]}><Text style={styles.soonText}>Donations open soon</Text></View>
              ) : (
                <Button label="Donate" onPress={() => setDonateOpen(true)} style={{ flex: 1 }} icon={<Icon name="heart" size={16} color="#FFFFFF" />} />
              )
            ) : null}
            {isPublic ? <Button kind="ghost" label="Share" onPress={share} style={{ flex: canDonate ? 0.8 : 1 }} icon={<Icon name="share" size={16} color={colors.fg} />} /> : null}
          </View>
          ) : null}
          {isPublic ? (
            <PressScale onPress={copyLink} scaleTo={0.98} style={styles.linkRow} accessibilityLabel="Copy link">
              <Icon name="link" size={15} color={colors.primary} />
              <Text style={styles.linkText} numberOfLines={1}>{f.url.replace(/^https?:\/\//, '')}</Text>
              <Text style={styles.linkCopy}>Copy</Text>
            </PressScale>
          ) : null}
          {!canDonate && !owner ? <Text style={[styles.muted, { marginTop: 10 }]}>{f.status === 'closed' ? 'This fundraiser has ended.' : 'Donations are paused for now.'}</Text> : null}
        </View>
      </FadeInUp>

      {owner ? (
        <FadeInUp index={3}>
          <View style={[styles.card, { padding: 14, marginTop: 14 }]}>
            <Text style={styles.toolsTitle}>Organiser tools</Text>
            <View style={styles.toolsGrid}>
              {f.status !== 'closed' ? <Tool icon="edit" label="Edit" onPress={() => nav.push('FundraiserEdit', { id: f.id })} /> : null}
              <Tool icon="users" label="Donations" onPress={() => nav.push('FundraiserDonations', { id: f.id, title: f.title, currency: f.currency })} />
              {['draft', 'rejected'].includes(f.status) ? <Tool icon="check" label={busy === 'submit' ? 'Submitting…' : 'Submit'} onPress={() => act('submit')} /> : null}
              {f.status === 'live' ? <Tool icon="pause" label={busy === 'pause' ? 'Pausing…' : 'Pause'} onPress={() => act('pause')} /> : null}
              {f.status === 'paused' && f.pausedBy !== 'admin' ? <Tool icon="play" label={busy === 'resume' ? 'Resuming…' : 'Resume'} onPress={() => act('resume')} /> : null}
              {f.status !== 'closed' ? <Tool icon="x" label="Close" danger onPress={() => setConfirm('close')} /> : null}
            </View>
          </View>
        </FadeInUp>
      ) : null}

      <FundraiserBody f={f} onImage={setLightbox} onDoc={openDoc} showPrivate={owner} />
      <Donors f={f} />

      <Lightbox uri={lightbox} onClose={() => setLightbox(null)} />
      <DonateSheet visible={donateOpen} f={f} demo={fm.demo} defaultName={(state.user && state.user.displayName) || ''} onClose={() => setDonateOpen(false)} onDonate={donate} />
      <AnimatedModal visible={confirm === 'close'} onRequestClose={() => setConfirm(null)}>
        <Pressable style={{ flex: 1 }} onPress={() => setConfirm(null)} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Close this fundraiser?</Text>
          <Text style={[styles.muted, { marginTop: 6, marginBottom: 18 }]}>Donations stop for good. The page stays up so supporters can still see what was raised.</Text>
          <Button kind="danger" label={busy === 'close' ? 'Closing…' : 'Close fundraiser'} onPress={() => act('close')} disabled={busy === 'close'} />
          <Button kind="ghost" label="Keep it open" onPress={() => setConfirm(null)} style={{ marginTop: 8 }} />
        </View>
      </AnimatedModal>
    </Screen>
  );
}

function Tool({ icon, label, onPress, danger }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.94} style={styles.tool} accessibilityLabel={label}>
      <View style={[styles.toolIcon, danger && { backgroundColor: colors.negativeFaint }]}>
        <Icon name={icon} size={17} color={danger ? colors.negative : colors.primary} />
      </View>
      <Text style={[styles.toolLabel, danger && { color: colors.negative }]}>{label}</Text>
    </PressScale>
  );
}

// ---------- donate sheet ----------
function DonateSheet({ visible, f, onClose, onDonate, defaultName, demo }) {
  const presets = f.presets || LIMITS[f.currency].presets;
  const [preset, setPreset] = useState(presets[1]);
  const [custom, setCustom] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [anon, setAnon] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setErr(null); setBusy(false);
    // prefill with the account name (blank → the server uses the signed-in account's name)
    setName((n) => n || (defaultName && defaultName !== 'Friend' ? defaultName : ''));
  }, [visible]);
  const amount = custom ? toMinor(custom) : preset;
  const min = f.minMinor || LIMITS[f.currency].min;
  const max = f.maxMinor || LIMITS[f.currency].max;
  const submit = async () => {
    if (!amount || Number.isNaN(amount)) return setErr('Choose or enter an amount');
    if (amount < min) return setErr(`The smallest gift is ${formatMoney(min, f.currency)}`);
    if (amount > max) return setErr(`The largest single gift is ${formatMoney(max, f.currency)}`);
    setErr(null); setBusy(true);
    await onDonate({ amount_minor: amount, message: message.trim(), anonymous: anon, donor_name: name.trim() });
    setBusy(false);
  };
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Eyebrow>Give</Eyebrow>
          <Text style={styles.sheetTitle} numberOfLines={2}>{f.title}</Text>
          <View style={styles.presets}>
            {presets.map((p) => {
              const on = !custom && preset === p;
              return (
                <PressScale key={p} onPress={() => { setPreset(p); setCustom(''); }} scaleTo={0.93} style={[styles.preset, on && styles.presetOn]} accessibilityLabel={formatMoney(p, f.currency)}>
                  <Text style={[styles.presetText, on && { color: '#FFFFFF' }]}>{formatMoney(p, f.currency)}</Text>
                </PressScale>
              );
            })}
          </View>
          <View style={styles.amountBox}>
            <Text style={styles.amountSym}>{SYMBOL[f.currency]}</Text>
            <TextInput
              value={custom}
              onChangeText={(t) => setCustom(t.replace(/[^\d.,]/g, ''))}
              placeholder="Other amount"
              placeholderTextColor={colors.faint}
              keyboardType="decimal-pad"
              style={styles.amountInput}
              accessibilityLabel="Other amount"
            />
          </View>
          <Text style={styles.label}>Your name</Text>
          <Input value={name} onChangeText={setName} placeholder="Name shown with your gift" maxLength={80} />
          <Text style={styles.label}>Message (optional)</Text>
          <Input value={message} onChangeText={setMessage} placeholder="Words of encouragement…" multiline maxLength={500} />
          <View style={styles.anonRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.anonTitle}>Give anonymously</Text>
              <Text style={styles.anonSub}>Your name is hidden on the public page (the organiser can still see it). Your gift still counts.</Text>
            </View>
            <Switch value={anon} onValueChange={setAnon} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor="#FFFFFF" activeThumbColor="#FFFFFF" accessibilityLabel="Give anonymously" />
          </View>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Button
            label={busy ? 'Starting checkout…' : amount && !Number.isNaN(amount) ? `Donate ${formatMoney(amount, f.currency)}` : 'Donate'}
            onPress={submit}
            disabled={busy}
            style={{ marginTop: 14 }}
          />
          <Text style={styles.sheetNote}>
            {demo ? 'Demo mode — the gift is recorded on this device only. No money moves.'
              : f.testMode ? 'Test mode — you’ll see a simulated checkout. No real money moves.' : 'You’ll finish your gift on a secure checkout page.'}
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
  const [currency, setCurrency] = useState('GBP');
  const [goalText, setGoalText] = useState('');
  const [main, setMain] = useState(null); // { key, url }
  const [blocks, setBlocks] = useState([{ id: bid(), type: 'p', text: '' }]);
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
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
      } catch (e) { toast.show(errorMessage(e, 'Couldn’t submit'), { tone: 'error' }); }
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
    const d = await pickPdf();
    if (!d) return;
    const up = await fm.uploadPdf(d);
    setMedia((ms) => [...ms, { kind: 'pdf', key: up.key, name: up.name || d.name, caption: (d.name || '').replace(/\.pdf$/i, ''), visibility: 'private' }]);
  });

  const updBlock = (bidv, patch) => setBlocks((bs) => bs.map((b) => (b.id === bidv ? { ...b, ...patch } : b)));
  const moveBlock = (i, d) => setBlocks((bs) => { const a = [...bs]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
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
    return <Screen title="Edit fundraiser" back><ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /></Screen>;
  }

  const isNew = !id;
  const submitLabel = ['draft', 'rejected'].includes(status) ? (busy === 'submit' ? 'Submitting…' : 'Submit for review') : 'Save changes';

  return (
    <View style={{ flex: 1, backgroundColor: colors.screen }}>
      <Screen
        title={isNew ? 'Start a fundraiser' : 'Edit fundraiser'}
        back
        scroll={false}
        padded={false}
        right={(
          <Pressable onPress={() => save()} hitSlop={10} disabled={!!busy} style={styles.headerBtn} accessibilityLabel="Save draft">
            <Text style={styles.headerSave}>{busy === 'save' ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        )}
      >
        <View style={styles.stepper}>
          {STEPS.map((s, i) => (
            <Pressable key={s} onPress={() => (i <= step || validateBasics()) && go(i)} style={styles.stepItem} accessibilityLabel={`Step ${i + 1}: ${s}`}>
              <View style={[styles.stepDot, i <= step && styles.stepDotOn]}>
                {i < step ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : <Text style={[styles.stepNum, i <= step && { color: '#FFFFFF' }]}>{i + 1}</Text>}
              </View>
              <Text style={[styles.stepLabel, i === step && { color: colors.fg }]}>{s}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {step === 0 ? (
            <FadeInUp key="s0">
              <Text style={styles.stepTitle}>What are you raising money for?</Text>
              <Text style={styles.stepSub}>A clear heading helps people understand your need at a glance.</Text>
              <Text style={styles.label}>Heading</Text>
              <Input value={title} onChangeText={(t) => { setTitle(t); if (errors.title) setErrors({ ...errors, title: null }); }} placeholder="e.g. Help Me Pay My Hospital Bill" maxLength={120} />
              {errors.title ? <Text style={styles.err}>{errors.title}</Text> : null}
              <View style={styles.suggestRow}>
                {['Help Me Pay My Hospital Bill', 'Support My Education', 'Support My Ministry'].map((s) => (
                  <PressScale key={s} onPress={() => setTitle(s)} scaleTo={0.94} style={styles.suggest}><Text style={styles.suggestText}>{s}</Text></PressScale>
                ))}
              </View>
              <Text style={[styles.label, { marginTop: 22 }]}>Currency</Text>
              <View style={styles.curRow}>
                {CURRENCIES.map((c) => (
                  <PressScale key={c} disabled={moneyLocked} onPress={() => setCurrency(c)} scaleTo={0.94} style={[styles.cur, currency === c && styles.curOn, moneyLocked && currency !== c && { opacity: 0.4 }]} accessibilityLabel={CURRENCY_NAME[c]}>
                    <Text style={[styles.curSym, currency === c && { color: '#FFFFFF' }]}>{SYMBOL[c]}</Text>
                    <Text style={[styles.curCode, currency === c && { color: 'rgba(255,255,255,0.75)' }]}>{c}</Text>
                  </PressScale>
                ))}
              </View>
              <Text style={[styles.label, { marginTop: 18 }]}>Amount to raise</Text>
              <View style={[styles.amountBox, moneyLocked && { opacity: 0.55 }]}>
                <Text style={styles.amountSym}>{SYMBOL[currency]}</Text>
                <TextInput
                  value={goalText}
                  editable={!moneyLocked}
                  onChangeText={(t) => { setGoalText(t.replace(/[^\d.,]/g, '')); if (errors.goal) setErrors({ ...errors, goal: null }); }}
                  placeholder="5,000"
                  placeholderTextColor={colors.faint}
                  keyboardType="decimal-pad"
                  style={styles.amountInput}
                  accessibilityLabel="Amount to raise"
                />
              </View>
              {errors.goal ? <Text style={styles.err}>{errors.goal}</Text> : null}
              {moneyLocked ? <Text style={styles.hint}>The goal and currency can’t change once a fundraiser is live.</Text> : (
                !Number.isNaN(goalMinor) && goalMinor > 0 ? <Text style={styles.hint}>Your goal: {formatMoney(goalMinor, currency)}</Text> : null
              )}
            </FadeInUp>
          ) : null}

          {step === 1 ? (
            <FadeInUp key="s1">
              <Text style={styles.stepTitle}>Tell your story</Text>
              <Text style={styles.stepSub}>Add a main photo, then explain what happened, what the money is for and how it will help. You can add photos between paragraphs.</Text>
              <Text style={styles.label}>Main photo</Text>
              <PressScale onPress={pickMain} scaleTo={0.98} style={styles.mainPick} accessibilityLabel={main ? 'Change main photo' : 'Add main photo'}>
                {main ? <Image source={{ uri: main.url }} style={StyleSheet.absoluteFill} /> : null}
                {busy === 'main' ? <ActivityIndicator color={main ? '#FFFFFF' : colors.primary} /> : (
                  <View style={[styles.mainPickInner, main && styles.mainPickChange]}>
                    <Icon name="image" size={main ? 15 : 22} color={main ? '#FFFFFF' : colors.primary} />
                    <Text style={[styles.mainPickText, main && { color: '#FFFFFF' }]}>{main ? 'Change photo' : 'Add a main photo'}</Text>
                  </View>
                )}
              </PressScale>
              <Text style={[styles.label, { marginTop: 22 }]}>Story</Text>
              {blocks.map((b, i) => (
                <View key={b.id} style={styles.block}>
                  {b.type === 'p' ? (
                    <Input
                      value={b.text}
                      onChangeText={(t) => updBlock(b.id, { text: t })}
                      placeholder={i === 0 ? 'Start with who you are and what happened…' : 'Continue your story…'}
                      multiline
                      maxLength={5000}
                      style={{ minHeight: 110 }}
                    />
                  ) : (
                    <View style={styles.blockImgWrap}>
                      <Image source={{ uri: b.url }} style={styles.blockImg} />
                      <TextInput value={b.caption || ''} onChangeText={(t) => updBlock(b.id, { caption: t })} placeholder="Caption (optional)" placeholderTextColor={colors.faint} style={styles.captionInput} maxLength={200} />
                    </View>
                  )}
                  <View style={styles.blockTools}>
                    <Pressable onPress={() => moveBlock(i, -1)} hitSlop={6} style={styles.blockTool} accessibilityLabel="Move up"><Icon name="chevron-up" size={15} color={colors.muted} /></Pressable>
                    <Pressable onPress={() => moveBlock(i, 1)} hitSlop={6} style={styles.blockTool} accessibilityLabel="Move down"><Icon name="chevron-down" size={15} color={colors.muted} /></Pressable>
                    <Pressable onPress={() => removeBlock(b.id)} hitSlop={6} style={styles.blockTool} accessibilityLabel="Remove block"><Icon name="trash" size={14} color={colors.muted} /></Pressable>
                  </View>
                </View>
              ))}
              <View style={styles.addRow}>
                <Button kind="ghost" small label="Paragraph" icon={<Icon name="type" size={14} color={colors.fg} />} onPress={() => setBlocks((bs) => [...bs, { id: bid(), type: 'p', text: '' }])} style={{ flex: 1 }} />
                <Button kind="ghost" small label={busy === 'storyimg' ? 'Uploading…' : 'Image'} disabled={busy === 'storyimg'} icon={<Icon name="image" size={14} color={colors.fg} />} onPress={addStoryImage} style={{ flex: 1 }} />
              </View>
              <Text style={styles.hint}>{storyChars.toLocaleString()} / 20,000 characters</Text>
            </FadeInUp>
          ) : null}

          {step === 2 ? (
            <FadeInUp key="s2">
              <Text style={styles.stepTitle}>Supporting photos & documents</Text>
              <Text style={styles.stepSub}>Photos and documents (like a hospital report or school letter) help people trust your request.</Text>
              <Text style={styles.label}>Photos</Text>
              <View style={styles.grid}>
                {media.map((m, i) => (m.kind === 'image' ? (
                  <View key={m.id || m.key} style={styles.gridItem}>
                    <Image source={{ uri: m.url }} style={styles.gridImg} />
                    <Pressable onPress={() => removeMedia(i)} hitSlop={6} style={styles.gridRemove} accessibilityLabel="Remove photo"><Icon name="x" size={12} color="#FFFFFF" strokeWidth={2.6} /></Pressable>
                  </View>
                ) : null))}
                <PressScale onPress={addPhotos} scaleTo={0.95} style={[styles.gridItem, styles.gridAdd]} accessibilityLabel="Add photos">
                  {busy === 'photos' ? <ActivityIndicator color={colors.primary} /> : <><Icon name="plus" size={20} color={colors.primary} /><Text style={styles.gridAddText}>Add</Text></>}
                </PressScale>
              </View>
              <Text style={[styles.label, { marginTop: 22 }]}>Documents (PDF)</Text>
              <Notice text="Private documents are only seen by our review team. Make a document public to show it on your fundraiser page." tint={colors.primary} />
              <View style={{ gap: 10, marginTop: 12 }}>
                {media.map((m, i) => (m.kind === 'pdf' ? (
                  <View key={m.id || m.key} style={styles.docEdit}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={styles.docIcon}><Text style={styles.docIconText}>PDF</Text></View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <TextInput value={m.caption || ''} onChangeText={(t) => updMedia(i, { caption: t })} placeholder="Document title" placeholderTextColor={colors.faint} style={styles.docTitleInput} maxLength={200} />
                        <Text style={styles.docSub} numberOfLines={1}>{m.name}</Text>
                      </View>
                      <Pressable onPress={() => removeMedia(i)} hitSlop={8} accessibilityLabel="Remove document"><Icon name="trash" size={16} color={colors.muted} /></Pressable>
                    </View>
                    <View style={styles.visRow}>
                      <Icon name={m.visibility === 'public' ? 'globe' : 'lock'} size={14} color={m.visibility === 'public' ? colors.positive : colors.muted} />
                      <Text style={styles.visText}>{m.visibility === 'public' ? 'Public — shown on your page' : 'Private — review team only'}</Text>
                      <Switch value={m.visibility === 'public'} onValueChange={(v) => updMedia(i, { visibility: v ? 'public' : 'private' })} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor="#FFFFFF" activeThumbColor="#FFFFFF" accessibilityLabel="Show document publicly" />
                    </View>
                  </View>
                ) : null))}
                <Button kind="ghost" label={busy === 'pdf' ? 'Uploading…' : 'Add a PDF document'} disabled={busy === 'pdf'} onPress={addPdf} icon={<Icon name="plus" size={15} color={colors.fg} />} />
              </View>
            </FadeInUp>
          ) : null}

          {step === 3 ? (
            <FadeInUp key="s3">
              <Text style={styles.stepTitle}>Preview</Text>
              <Text style={styles.stepSub}>This is how your public page will look.</Text>
              <View style={styles.checklist}>
                {checklist.map(([label, ok]) => (
                  <View key={label} style={styles.checkItem}>
                    <View style={[styles.checkDot, ok && { backgroundColor: colors.positive, borderColor: colors.positive }]}>{ok ? <Icon name="check" size={11} color="#FFFFFF" strokeWidth={3} /> : null}</View>
                    <Text style={[styles.checkText, !ok && { color: colors.muted }]}>{label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.previewFrame}>
                <Thumb uri={previewF.mainImageUrl} style={styles.hero2} />
                <Text style={[styles.title, { marginTop: 14 }]}>{previewF.title}</Text>
                <Text style={[styles.orgText, { marginBottom: 14 }]}>Organised by {previewF.owner.displayName}</Text>
                <View style={[styles.card, styles.progressCard]}><Progress f={previewF} big /></View>
                <FundraiserBody f={previewF} showPrivate={false} />
              </View>
              {['draft', 'rejected'].includes(status) ? <Text style={[styles.hint, { marginTop: 16 }]}>After you submit, our team reviews your fundraiser (usually within a day). We’ll notify you when your public page is live.</Text> : null}
            </FadeInUp>
          ) : null}
        </ScrollView>
      </Screen>
      <View style={styles.footer}>
        {step > 0 ? <Button kind="ghost" label="Back" onPress={() => go(step - 1)} style={{ flex: 0.6 }} /> : <Button kind="ghost" label={busy === 'save' ? 'Saving…' : 'Save draft'} onPress={() => save()} disabled={!!busy} style={{ flex: 0.8 }} />}
        {step < STEPS.length - 1
          ? <Button label="Continue" onPress={() => go(step + 1)} style={{ flex: 1 }} />
          : <Button label={submitLabel} onPress={submit} disabled={!!busy || (['draft', 'rejected'].includes(status) && !ready)} style={{ flex: 1 }} />}
      </View>
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
      const [d, fr] = await Promise.all([fm.donations(params.id), fm.get(params.id)]);
      setItems(d.items); setF(fr); setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load donations')); }
  }, [fm, params.id]);
  useReload(load);
  const cur = (f && f.currency) || params.currency || 'GBP';
  const ok = (items || []).filter((d) => d.status === 'succeeded');
  const avg = ok.length ? Math.round(ok.reduce((n, d) => n + d.amountMinor, 0) / ok.length) : 0;
  return (
    <Screen title="Donations" subtitle={params.title} back>
      {error ? <Notice text={error} tint={colors.negative} /> : null}
      {f ? (
        <FadeInUp>
          <View style={[styles.card, styles.progressCard]}>
            <Progress f={f} big />
          </View>
          <View style={styles.kpis}>
            <Kpi label="Donations" value={String(ok.length)} />
            <Kpi label="Average gift" value={formatMoney(avg, cur)} />
            <Kpi label="Remaining" value={formatMoney(f.remainingMinor, cur)} />
          </View>
        </FadeInUp>
      ) : null}
      <Section title="All gifts" style={{ marginTop: 22 }}>
        {items === null ? <Skeleton rows={3} /> : items.length ? (
          <View style={styles.card}>
            {items.map((d, i) => (
              <FadeInUp key={d.id} index={i} style={[styles.donor, i > 0 && styles.donorBorder]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials(d.name)}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.donorName}>{d.name}</Text>
                    {d.anonymous ? <Badge label="Anonymous publicly" tint={colors.slate} /> : null}
                    {d.status === 'refunded' ? <Badge label="Refunded" tint={colors.negative} /> : null}
                  </View>
                  <Text style={styles.donorMeta}>{timeAgo(d.completedAt || d.createdAt)}</Text>
                  {d.message ? <Text style={styles.donorMsg}>“{d.message}”</Text> : null}
                </View>
                <Text style={styles.donAmt}>{formatMoney(d.amountMinor, d.currency)}</Text>
              </FadeInUp>
            ))}
          </View>
        ) : <Empty title="No donations yet" body="Share your link on WhatsApp, Facebook or Instagram to get your first gift." />}
      </Section>
    </Screen>
  );
}

function Kpi({ label, value }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

// =============================================================================================
const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  headerBtn: { paddingHorizontal: 8, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  headerSave: { color: colors.primary, fontWeight: '700', fontSize: 14.5 },

  // home hero
  hero: { backgroundColor: colors.night, borderRadius: radius.xl, padding: 20, overflow: 'hidden', ...shadow.md },
  heroGlow: { position: 'absolute', right: -60, top: -70, width: 200, height: 200, borderRadius: 100, backgroundColor: alpha(colors.goldLight, 0.09) },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 26, lineHeight: 31, letterSpacing: -0.5, color: colors.nightFg, marginTop: 6 },
  heroBody: { color: colors.nightMuted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  heroBtn: { marginTop: 18, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.goldLight, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.pill },
  heroBtnText: { color: colors.night, fontWeight: '800', fontSize: 14.5 },
  heroSteps: { flexDirection: 'row', gap: 8, marginTop: 18 },
  heroStep: { flex: 1, backgroundColor: colors.nightRaised, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.nightBorder },
  heroStepNum: { fontFamily: fonts.serifBold, color: colors.goldLight, fontSize: 16 },
  heroStepText: { color: colors.nightFg, fontSize: 11.5, marginTop: 2, lineHeight: 15 },
  emptyMine: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: radius.lg, padding: 18, alignItems: 'center' },
  emptyMineText: { color: colors.muted, fontSize: 13.5 },

  // cards
  thumbBase: { backgroundColor: colors.raised },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  dCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.sm },
  dImage: { width: '100%', aspectRatio: 16 / 9 },
  dTitle: { fontFamily: fonts.serifBold, fontSize: 19, letterSpacing: -0.3, color: colors.fg, lineHeight: 24 },
  dOwner: { color: colors.muted, fontSize: 12.5 },
  dExcerpt: { color: colors.muted, fontSize: 13.5, lineHeight: 19 },
  mineRow: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, ...shadow.sm },
  mineThumb: { width: 72, height: 72, borderRadius: 12 },
  mineTitle: { fontFamily: fonts.serifBold, fontSize: 16.5, color: colors.fg, flex: 1, letterSpacing: -0.2 },

  // progress
  bar: { height: 7, borderRadius: 99, backgroundColor: colors.raised, marginTop: 6 },
  barBig: { height: 10, marginTop: 14, marginBottom: 10 },
  barFill: { backgroundColor: colors.primary, borderRadius: 99 },
  raisedBig: { fontFamily: fonts.serifBold, fontSize: 32, letterSpacing: -0.8, color: colors.fg },
  ofGoal: { color: colors.muted, fontSize: 14, marginTop: 2 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { color: colors.muted, fontSize: 13 },
  statStrong: { color: colors.fg, fontWeight: '700' },
  cardMoneyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 },
  cardRaised: { color: colors.fg, fontWeight: '700', fontSize: 13.5 },
  cardOf: { color: colors.muted, fontWeight: '400' },
  cardPct: { color: colors.primary, fontWeight: '700', fontSize: 12.5 },

  // detail
  banner: { borderLeftWidth: 3, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  bannerTitle: { fontWeight: '800', fontSize: 13, letterSpacing: 0.2 },
  bannerText: { color: colors.fg, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  hero2: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.xl },
  title: { fontFamily: fonts.serifBold, fontSize: 28, lineHeight: 33, letterSpacing: -0.6, color: colors.fg, marginTop: 6 },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 16 },
  orgText: { color: colors.muted, fontSize: 13.5 },
  avatarSm: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  avatarSmText: { fontFamily: fonts.serifBold, fontSize: 12, color: colors.goldMuted },
  progressCard: { padding: 18, position: 'relative' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  soon: { borderRadius: radius.pill, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', paddingVertical: 13 },
  soonText: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: colors.primarySoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  linkText: { flex: 1, color: colors.primaryInk, fontSize: 13 },
  linkCopy: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  toolsTitle: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginBottom: 10 },
  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tool: { width: '23%', minWidth: 70, flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 8 },
  toolIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 12, fontWeight: '600', color: colors.fg },

  h2: { fontFamily: fonts.serifBold, fontSize: 21, letterSpacing: -0.3, color: colors.fg, marginTop: 28, marginBottom: 10 },
  h2Count: { fontFamily: fonts.serif, fontSize: 15, color: colors.faint },
  storyP: { fontFamily: fonts.serif, fontSize: 17.5, lineHeight: 28, color: colors.passage, marginBottom: 14 },
  storyImg: { width: '100%', aspectRatio: 3 / 2, borderRadius: radius.md, backgroundColor: colors.raised },
  caption: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridItem: { width: '31.6%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.raised },
  gridImg: { width: '100%', height: '100%' },
  gridRemove: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  gridAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: 2 },
  gridAddText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  docIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.negativeFaint, alignItems: 'center', justifyContent: 'center' },
  docIconText: { color: colors.negative, fontWeight: '800', fontSize: 10 },
  docTitle: { fontWeight: '600', fontSize: 14, color: colors.fg },
  docSub: { fontSize: 12, color: colors.muted, marginTop: 1 },

  donor: { flexDirection: 'row', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  donorBorder: { borderTopWidth: 1, borderTopColor: colors.rule },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.serifBold, fontSize: 13, color: colors.goldMuted },
  donorName: { fontWeight: '700', fontSize: 14, color: colors.fg },
  donorMeta: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  donorMsg: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 22, color: colors.passage, marginTop: 6 },
  donAmt: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg },

  lightbox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  lightboxImg: { width: '100%', height: '80%' },
  lightboxClose: { position: 'absolute', top: 50, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },

  // sheets
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, maxHeight: '92%', ...shadow.lg },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 14 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 22, letterSpacing: -0.4, color: colors.fg, marginTop: 4 },
  sheetNote: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
  presets: { flexDirection: 'row', gap: 8, marginTop: 16 },
  preset: { flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  presetOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  presetText: { fontWeight: '800', fontSize: 15, color: colors.fg },
  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, marginTop: 10, height: 54 },
  amountSym: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.muted, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.fg, paddingVertical: 0, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  label: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 6, letterSpacing: 0.2 },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  anonTitle: { fontWeight: '700', color: colors.fg, fontSize: 14 },
  anonSub: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  err: { color: colors.negative, fontSize: 12.5, marginTop: 8 },
  hint: { color: colors.muted, fontSize: 12.5, marginTop: 8, lineHeight: 17 },

  // wizard
  stepper: { flexDirection: 'row', paddingHorizontal: 18, paddingBottom: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.rule },
  stepItem: { flex: 1, alignItems: 'center', gap: 4 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  stepDotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNum: { fontSize: 11.5, fontWeight: '800', color: colors.muted },
  stepLabel: { fontSize: 11.5, fontWeight: '700', color: colors.faint },
  stepTitle: { fontFamily: fonts.serifBold, fontSize: 24, letterSpacing: -0.5, color: colors.fg, lineHeight: 29 },
  stepSub: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 8 },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  suggest: { backgroundColor: colors.raised, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  suggestText: { color: colors.fg, fontSize: 12.5, fontWeight: '600' },
  curRow: { flexDirection: 'row', gap: 8 },
  cur: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  curOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  curSym: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg },
  curCode: { fontSize: 11, fontWeight: '700', color: colors.muted, marginTop: 1 },
  mainPick: { height: 190, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  mainPickInner: { alignItems: 'center', gap: 6 },
  mainPickChange: { flexDirection: 'row', position: 'absolute', bottom: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  mainPickText: { color: colors.primary, fontWeight: '700', fontSize: 13.5 },
  block: { marginBottom: 12 },
  blockImgWrap: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  blockImg: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.raised },
  captionInput: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: colors.fg, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  blockTools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  blockTool: { width: 30, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  addRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  docEdit: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  docTitleInput: { fontWeight: '600', fontSize: 14, color: colors.fg, paddingVertical: 2, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  visRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.rule },
  visText: { flex: 1, color: colors.muted, fontSize: 12.5 },
  checklist: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8, marginBottom: 16 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkText: { fontSize: 12.5, fontWeight: '600', color: colors.fg },
  previewFrame: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 14, backgroundColor: alpha(colors.surface, 0.5) },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.screen },

  // donations
  kpis: { flexDirection: 'row', gap: 8, marginTop: 12 },
  kpi: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  kpiValue: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  kpiLabel: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
});
