// FIND LOVE account screens: Dating Plus / VIP · Boost & Spotlight · Safety & settings · Verified badge.
// UI only — every call, cost and rule is the same as before the redesign (re-exported from screens/FindLoveScreens.js).
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Switch, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Input } from '../ui';
import { Icon } from '../Icons';
import { PressScale, FadeInUp, Pulse } from '../Motion';
import { fonts, colors } from '../../theme';
import { useNav } from '../../navigation';
import { useToast } from '../Toast';
import { useApi } from '../../api/auth';
import { pickPhotos } from '../../api/media';
import { WalletBalancePill, BuyCoinsSheet, WalletSheet } from '../wallet';
import { ws } from '../wallet/WalletSheet';
import { useWalletProducts, cancelSubscription, walletChanged, dateLabel } from '../../api/wallet';
import { useDatingHome, useDatingGet, datingChanged, dating, datingError, newIdempotencyKey, BOOST_OPTIONS, countdown, takeLivePhoto } from '../../api/dating';
import { love, grad, type, lshadow, haptic, plural } from './theme';
import { Crown, Glow, Grain, Filigree, Ring, LoveArt, VerifiedSeal, Sparkle } from './illustrations';
import { LoveScreen, LoveButton, CostPill, SectionCard, LoveBanner, LoveState, Skeleton, Choice, st as pst } from './parts';
import { useSpend } from './useSpend';

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Dating Plus / VIP
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const FREE_FEATURES = ['Daily swipes and likes', 'Matches and chat after you both say yes', 'First messages unlocked with a short ad', 'Block, report and hide anytime'];
function featIcon(f) {
  const t = f.toLowerCase();
  if (/who liked|likes you|see who/.test(t)) return 'heart';
  if (/messag|chat/.test(t)) return 'chat';
  if (/undo|rewind/.test(t)) return 'repost';
  if (/filter|denomination|involvement/.test(t)) return 'filter';
  if (/boost|spotlight/.test(t)) return 'flame';
  if (/swipe/.test(t)) return 'compass';
  if (/city|location|near/.test(t)) return 'map-pin';
  if (/badge|vip|priority|super/.test(t)) return 'star';
  if (/ad/.test(t)) return 'play';
  if (/block|report|safe/.test(t)) return 'shield';
  return 'check';
}
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
  const Plan = ({ p, tier, current, index }) => {
    if (!p) return null;
    const isVip = tier === 'vip';
    const fg = isVip ? love.goldBright : '#FFFFFF';
    const sub2 = isVip ? 'rgba(246,228,210,0.78)' : 'rgba(255,255,255,0.85)';
    return (
      <FadeInUp index={index} style={[s.planCard, current ? (isVip ? lshadow.gold : lshadow.glow) : lshadow.md, isVip && { borderColor: 'rgba(244,216,140,0.55)', borderWidth: 1 }, current && { borderColor: love.goldBright, borderWidth: 2 }]}>
        <LinearGradient colors={isVip ? grad.vip : grad.rose} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Grain width={420} height={520} opacity={isVip ? 0.05 : 0.07} />
        <Glow size={260} color={isVip ? love.goldBright : '#FFFFFF'} opacity={isVip ? 0.16 : 0.18} style={{ top: -120, right: -90 }} />
        {current ? <View style={s.ribbon}><Text style={s.ribbonText}>Your plan</Text></View> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[s.planIcon, { borderColor: isVip ? 'rgba(244,216,140,0.6)' : 'rgba(255,255,255,0.45)' }]}>
            {isVip ? <Crown size={22} /> : <Icon name="star" size={18} color="#FFFFFF" fill="#FFFFFF" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.planName, { color: fg }]}>{p.title}</Text>
            <Text style={[s.planTag, { color: sub2 }]}>{isVip ? 'The full covenant experience' : 'More room for love to grow'}</Text>
          </View>
        </View>
        <Text style={[s.planPrice, { color: isVip ? love.onDark : '#FFFFFF' }]}>{p.displayPrice}{/month|\/\s*mo/i.test(String(p.displayPrice || '')) ? null : <Text style={[s.planPer, { color: sub2 }]}> / month</Text>}</Text>
        <View style={[s.planRule, { backgroundColor: isVip ? 'rgba(244,216,140,0.3)' : 'rgba(255,255,255,0.25)' }]} />
        {(p.benefits.features || []).map((f) => (
          <View key={f} style={s.featRow}>
            <View style={[s.featIcon, { backgroundColor: isVip ? 'rgba(244,216,140,0.16)' : 'rgba(255,255,255,0.18)' }]}><Icon name={featIcon(f)} size={13} color={fg} strokeWidth={2.2} /></View>
            <Text style={[s.featText, { color: isVip ? love.onDark : '#FFFFFF' }]}>{f}</Text>
          </View>
        ))}
        {current ? null
          : sub && sub.tier > p.tier ? <Text style={[s.included, { color: sub2 }]}>Included in your plan.</Text>
          : <LoveButton label={`Get ${p.title}`} onPress={() => setBuy(p.id)} kind={isVip ? 'gold' : 'white'} style={{ marginTop: 16 }} />}
      </FadeInUp>
    );
  };
  return (
    <LoveScreen title="Dating Plus & VIP">
      <View style={{ alignItems: 'center', marginTop: 6 }}>
        <Text style={s.heroTitle}>Love, with a little <Text style={{ fontFamily: fonts.serifBoldItalic, color: love.rose }}>more room</Text></Text>
        <Filigree width={170} style={{ marginTop: 8 }} />
      </View>
      {why ? <View style={{ marginTop: 14 }}><LoveBanner icon="sparkles" tone="rose" text={why} /></View> : null}
      {sub ? (
        <SectionCard eyebrow="Your plan" title={`${sub.title}${sub.test ? ' · test' : ''}`}>
          <Text style={pst.hint}>{sub.renewsOn ? `Renews on ${dateLabel(sub.renewsOn)}` : `Ends on ${dateLabel(sub.accessUntil)} — renewal is off`}{sub.displayPrice ? ` · ${sub.displayPrice}` : ''}</Text>
          {sub.status === 'active' ? <LoveButton kind="ghost" small label={busy ? 'Cancelling…' : 'Cancel renewal'} onPress={cancel} style={{ marginTop: 12, alignSelf: 'flex-start' }} /> : null}
          {sub.manageUrl ? <Text style={pst.hint}>Google Play subscriptions are also managed in the Play Store.</Text> : sub.provider === 'paystack' && !sub.autoRenew && sub.status === 'active' ? <Text style={pst.hint}>Paid by bank transfer or USSD, so it doesn’t renew by itself — pay again before it ends to keep your plan.</Text> : null}
        </SectionCard>
      ) : null}
      <FadeInUp style={[s.freeCard, !sub && { borderColor: love.rose, borderWidth: 2 }]}>
        {!sub ? <View style={[s.ribbon, { backgroundColor: love.wine }]}><Text style={[s.ribbonText, { color: '#FFFFFF' }]}>Your plan</Text></View> : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={[s.planName, { color: love.ink }]}>Free</Text>
          <View style={{ flex: 1 }} />
          <Text style={[s.planPrice, { color: love.ink, marginTop: 0, fontSize: 22 }]}>₦0</Text>
        </View>
        {FREE_FEATURES.map((f) => (
          <View key={f} style={s.featRow}>
            <View style={[s.featIcon, { backgroundColor: love.blush }]}><Icon name={featIcon(f)} size={13} color={love.rose} strokeWidth={2.2} /></View>
            <Text style={[s.featText, { color: love.ink }]}>{f}</Text>
          </View>
        ))}
      </FadeInUp>
      <Plan p={plus} tier="plus" index={1} current={sub && sub.tier === 1} />
      <Plan p={vip} tier="vip" index={2} current={sub && sub.tier >= 2} />
      <Text style={s.fine}>Plans renew monthly until you cancel; you keep access until the end of the paid month. Payment is through Paystack: card renews automatically; bank transfer and USSD don’t renew (we remind you). Matches always depend on mutual interest — no plan guarantees a match.</Text>
      {buy ? <BuyCoinsSheet visible plans initialProductId={buy} onClose={() => setBuy(null)} onPurchased={() => { setBuy(null); datingChanged(); }} /> : null}
    </LoveScreen>
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
  if (!d) return <LoveScreen title="Boost"><Skeleton.Block height={260} /><Skeleton.Block height={80} /><Skeleton.Block height={80} /></LoveScreen>;
  const freeBoosts = d.balances.dating_boosts || 0;
  function start(o) {
    const free = o.kind === 'boost_30m' && freeBoosts > 0;
    const key = newIdempotencyKey();
    setSpend({
      amount: free ? 1 : d.prices[o.kind], wallet: free ? 'dating_boosts' : 'dating_coins', title: `Boost · ${o.label}`,
      description: 'More people in your preferences see you near the top of their stack. Matches still depend on mutual interest.',
      confirmLabel: free ? 'Use a free boost' : `Boost for ${d.prices[o.kind]} coins`,
      run: () => dating.boost(api, o.kind, key, true), done: () => { haptic('success'); st.reload(); home.reload(); },
    });
  }
  const live = (b, secs, title) => {
    if (!(b && secs > 0)) return null;
    const total = b.startsAt && b.endsAt ? Math.max(1, (new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 1000) : Math.max(secs, 1);
    const spotlight = title === 'SPOTLIGHT';
    return (
      <FadeInUp style={[s.boostLive, lshadow.glow]}>
        <LinearGradient colors={spotlight ? ['#6F4A12', '#6F4A12'] : ['#8A451F', '#2D1B10']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Grain width={420} height={420} opacity={0.07} />
        <Glow size={320} color={spotlight ? love.goldBright : love.roseBright} opacity={0.45} style={{ top: -60, left: -40 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Ring size={128} stroke={8} progress={secs / total} color={love.goldBright}>
            <Pulse min={0.96} max={1.04} duration={1100}><Icon name={spotlight ? 'sun' : 'flame'} size={20} color={love.goldBright} /></Pulse>
            <Text style={s.clock}>{countdown(secs)}</Text>
            <Text style={s.clockSub}>left</Text>
          </Ring>
          <View style={{ flex: 1 }}>
            <View style={s.liveTag}><View style={s.liveDot} /><Text style={s.liveTagText}>{title}</Text></View>
            <Text style={s.liveTitle}>{spotlight ? 'You’re in the spotlight' : 'You’re glowing'}</Text>
            <Text style={s.liveSub}>Ends automatically at {new Date(b.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</Text>
          </View>
        </View>
        <View style={s.statsRow}>
          {[['eye', 'Views', b.stats.views], ['heart', 'Likes', b.stats.likes], ['sparkles', 'Matches', b.stats.matches]].map(([ic, l, v]) => (
            <View key={l} style={s.statBox} accessibilityLabel={`${v} ${l}`}>
              <Text style={s.statNum}>{v}</Text>
              <Text style={s.statLabel}>{l}</Text>
            </View>
          ))}
        </View>
      </FadeInUp>
    );
  };
  return (
    <LoveScreen title="Boost your profile" right={<WalletBalancePill wallet="dating_coins" />}>
      {live(active, left, 'BOOSTED')}
      {live(spot, spotLeft, 'SPOTLIGHT')}
      {!active && !spot ? (
        <FadeInUp style={[s.boostHero, lshadow.md]}>
          <LinearGradient colors={['#8A451F', '#2D1B10']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Grain width={420} height={300} opacity={0.07} />
          <Glow size={300} color={love.roseBright} opacity={0.5} style={{ top: -110, right: -80 }} />
          <View style={s.flameDisc}><LinearGradient colors={grad.gold} style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} /><View><Icon name="flame" size={26} color={love.plum} /></View></View>
          <Text style={s.heroOnDark}>Let more hearts <Text style={{ fontFamily: fonts.serifBoldItalic, color: love.goldBright }}>find you</Text></Text>
          <Text style={s.heroOnDarkBody}>Be seen by more people who match your preferences for a while. Your profile shows a small “Boosted” label. Blocks and everyone’s preferences still apply.</Text>
        </FadeInUp>
      ) : null}
      {freeBoosts > 0 ? <View style={{ marginTop: 12 }}><LoveBanner icon="sparkles" text={`You have ${plural(freeBoosts, 'free boost')} from Dating VIP (30 minutes each).`} /></View> : null}
      <Text style={[type.eyebrow, { marginTop: 22 }]}>Choose your glow</Text>
      {BOOST_OPTIONS.map((o, i) => {
        const spotlight = o.kind === 'spotlight_24h';
        return (
          <FadeInUp key={o.kind} index={i} distance={8}>
            <PressScale onPress={() => start(o)} style={[s.boostOpt, spotlight && { borderColor: 'rgba(166,109,34,0.45)', backgroundColor: colors.surface }]} scaleTo={0.98} accessibilityRole="button"
              accessibilityLabel={`${o.label}. ${o.note}. ${o.kind === 'boost_30m' && freeBoosts > 0 ? 'Free' : `${d.prices[o.kind]} coins`}`}>
              <View style={s.boostIcon}>
                <LinearGradient colors={spotlight ? grad.gold : grad.heart} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />
                <View><Icon name={spotlight ? 'sun' : 'flame'} size={20} color="#FFFFFF" /></View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.optTitle}>{o.label}</Text>
                <Text style={pst.hint}>{o.note}</Text>
              </View>
              <CostPill amount={d.prices[o.kind]} unit="coins" free={o.kind === 'boost_30m' && freeBoosts > 0} style={{ height: 26, borderRadius: 13 }} />
            </PressScale>
          </FadeInUp>
        );
      })}
      <Text style={s.fine}>A new boost starts when the current one ends. Boosts never show you to people you’ve blocked or who are outside your preferences, and no boost guarantees a match.</Text>
      {spendSheet}
    </LoveScreen>
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
function SettingRow({ icon, title, sub, onPress, right, disabled, danger, last }) {
  const body = (
    <View style={[s.setRow, last && { borderBottomWidth: 0 }]}>
      <View style={[s.setIcon, danger && { backgroundColor: love.dangerSoft }]}><Icon name={icon} size={16} color={danger ? love.danger : love.rose} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.setTitle, danger && { color: love.danger }]}>{title}</Text>
        {sub ? <Text style={pst.hint}>{sub}</Text> : null}
      </View>
      {right !== undefined ? right : onPress ? <Icon name="chevron-right" size={16} color={love.faint} /> : null}
    </View>
  );
  return onPress ? <PressScale onPress={onPress} disabled={disabled} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={title}>{body}</PressScale> : body;
}
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
    <LoveScreen title="Safety & settings">
      <SectionCard eyebrow="Walk wisely" title="Safety tips">
        {SAFETY_TIPS.map(([icon, t, b], i) => <SettingRow key={t} icon={icon} title={t} sub={b} last={i === SAFETY_TIPS.length - 1} />)}
      </SectionCard>
      {p ? (
        <>
          <SectionCard eyebrow="Your profile" title="Settings">
            <SettingRow icon="lock" title="Hide my profile" sub="Nobody new sees you. Matches and chats stay."
              right={<Switch value={p.status === 'paused'} onValueChange={togglePause} disabled={p.status === 'banned'} trackColor={{ true: love.rose, false: love.blushLine }} thumbColor="#FFFFFF" accessibilityLabel="Hide my profile" />} />
            <SettingRow icon="edit" title="Edit profile & preferences" onPress={() => nav.push('DatingProfileEdit')} />
            <SettingRow icon="star" title="Dating Plus & VIP" onPress={() => nav.push('DatingPlans')} />
            <SettingRow icon="coin" title="Dating Coins history" onPress={() => nav.push('Wallet', { focus: 'dating_coins' })} />
            <SettingRow icon="check-circle" title="Verified badge" sub={p.verified ? 'Your profile is verified.' : verifyStatusText(p.verification)} last
              onPress={p.verified ? undefined : () => nav.push('DatingVerify')} disabled={!!p.verified} right={p.verified ? <VerifiedSeal size={22} /> : undefined} />
          </SectionCard>
          <SectionCard>
            <SettingRow icon="trash" title="Delete my dating profile" danger last onPress={() => setConfirmDelete(true)} right={null} />
          </SectionCard>
        </>
      ) : null}
      <WalletSheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your dating profile?" subtitle="Your dating profile, photos, likes and matches are removed and your Find Love chats close. Your BibleNestra account, social profile and Dating Coins stay. This can’t be undone.">
        <PressScale onPress={del} style={[ws.primary, { backgroundColor: love.danger }]} accessibilityRole="button"><Text style={ws.primaryText}>Delete dating profile</Text></PressScale>
        <PressScale onPress={() => setConfirmDelete(false)} style={ws.ghost} accessibilityRole="button"><Text style={ws.ghostText}>Keep it</Text></PressScale>
      </WalletSheet>
    </LoveScreen>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Verified badge: a live selfie with the code + gesture shown here, and a photo of a government ID → our team decides.
// Optional (never needed to message). The two images are private to the member and the team, deleted after the decision.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function verifyStatusText(v) {
  if (!v || v.status === 'expired') return 'Get a blue tick: a quick selfie and a photo of your ID.';
  if (v.status === 'draft') return 'Started — finish your selfie and ID.';
  if (v.status === 'pending') return 'Our team is checking your photos.';
  if (v.status === 'rejected') return `Not approved${v.rejectReason ? `: ${v.rejectReason}` : ''}. You can try again.`;
  return 'Your profile is verified.';
}
const ID_TYPE_LABELS = { nin: 'National ID (NIN)', passport: 'Passport', drivers_licence: 'Driver’s licence', voters_card: 'Voter’s card', other: 'Other ID' };
const STEPS = ['Code', 'Selfie', 'ID', 'Submitted'];
function Stepper({ current }) {
  return (
    <View style={s.stepper} accessibilityLabel={`Step ${Math.min(current + 1, 4)} of 4: ${STEPS[Math.min(current, 3)]}`}>
      {STEPS.map((label, i) => {
        const done = i < current; const on = i === current;
        return (
          <React.Fragment key={label}>
            {i ? <View style={[s.stepLine, (done || on) && { backgroundColor: love.rose }]} /> : null}
            <View style={{ alignItems: 'center', width: 58 }}>
              <View style={[s.stepDot, done && s.stepDone, on && s.stepOn]}>
                {on ? <LinearGradient colors={grad.heart} style={[StyleSheet.absoluteFill, { borderRadius: 16 }]} /> : null}
                {done ? <View><Icon name="check" size={14} color="#FFFFFF" strokeWidth={3} /></View> : <Text style={[s.stepNum, on && { color: '#FFFFFF' }]}>{i + 1}</Text>}
              </View>
              <Text style={[s.stepLabel, (done || on) && { color: love.wine }]} numberOfLines={1}>{label}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}
function StepCard({ n, title, done, children }) {
  return (
    <View style={[pst.section, done && { borderColor: 'rgba(62,123,87,0.35)' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={[s.stepBadge, done && { backgroundColor: love.positive }]}>{done ? <Icon name="check" size={13} color="#FFFFFF" strokeWidth={3} /> : <Text style={s.stepBadgeText}>{n}</Text>}</View>
        <Text style={s.optTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}
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
  const [checkType, setCheckType] = useState('nin'); // optional automatic check (Dojah): BVN or NIN
  const [checkNumber, setCheckNumber] = useState('');
  useEffect(() => { if (p && v === null) setV(p.verification || false); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <LoveScreen title="Get verified"><Skeleton.Block height={90} /><Skeleton.Block height={220} /></LoveScreen>;
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
    const extra = v && v.idCheckAvailable && checkNumber ? { dojahIdType: checkType, dojahIdNumber: checkNumber } : null;
    try { const r = await dating.submitVerification(api, idType, extra); setCheckNumber(''); setV(r.verification); haptic('success'); toast.show('Sent to our team — we’ll let you know', { icon: 'shield', haptic: 'success' }); } catch (e) { toast.show(datingError(e), { tone: 'error' }); } finally { setBusy(null); }
  }
  const privacy = 'Your selfie and ID are seen only by you and the BibleNestra team, and are deleted as soon as we decide. An automatic check compares them with your profile photos to help our team; a person makes the decision. You don’t need to be verified to message anyone.';
  const current = status === 'approved' ? 4 : status === 'pending' ? 3 : status === 'draft' ? (!v.hasSelfie ? 1 : 2) : 0;
  const thumb = (uri, has) => (uri ? <Image source={{ uri }} style={s.thumb} /> : has ? <View style={[s.thumb, s.thumbDone]}><Icon name="check" size={22} color={love.positive} strokeWidth={2.8} /></View> : null);
  return (
    <LoveScreen title="Get verified">
      <Stepper current={current} />
      {status === 'approved' ? (
        <LoveState art="shield" title="You’re verified" body="Your profile is verified. Others see a blue tick next to your name."><View style={{ alignItems: 'center' }}><VerifiedSeal size={40} /></View></LoveState>
      ) : null}
      {status === 'pending' ? <LoveState art="shield" title="Submitted — thank you" body="Thank you! Our team is checking your selfie and ID. You’ll get a notification when it’s done." /> : null}
      {status === 'rejected' ? <View style={{ marginTop: 12 }}><LoveBanner icon="x" tone="danger" text={`Your last request wasn’t approved${v.rejectReason ? `: ${v.rejectReason}` : ''}. You can try again with clear photos.`} /></View> : null}
      {status !== 'approved' && status !== 'pending' && status !== 'draft' ? (
        <>
          <FadeInUp style={[s.verifyHero, lshadow.md]}>
            <LinearGradient colors={grad.plum} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Glow size={260} color={love.roseBright} opacity={0.4} style={{ top: -100, right: -80 }} />
            <VerifiedSeal size={44} ring={love.goldBright} />
            <Text style={s.heroOnDark}>A blue tick for <Text style={{ fontFamily: fonts.serifBoldItalic, color: love.goldBright }}>honest hearts</Text></Text>
            <Text style={s.heroOnDarkBody}>A blue tick shows people you are who your photos say. It takes two photos:</Text>
          </FadeInUp>
          <SectionCard>
            <SettingRow icon="user" title="A live selfie" sub="Holding a code we show you, written on paper, while making a hand gesture." />
            <SettingRow icon="shield" title="A photo of your ID" sub="National ID (NIN), passport, driver’s licence or voter’s card." last />
          </SectionCard>
          <Text style={s.fine}>{privacy}</Text>
          <LoveButton label={busy === 'start' ? 'Starting…' : 'Get my code'} onPress={start} disabled={!!busy} style={{ marginTop: 16 }} />
        </>
      ) : null}
      {status === 'draft' ? (
        <>
          <FadeInUp style={[s.codeCard, lshadow.md]}>
            <LinearGradient colors={grad.wine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Grain width={420} height={260} opacity={0.07} />
            <Text style={s.codeEyebrow}>Step 1 · Write this code on a piece of paper</Text>
            <View style={s.codeRow} accessibilityLabel={`Code ${v.code.split('').join(' ')}`} accessible>
              {v.code.split('').map((ch, i) => <View key={i} style={s.codeCell}><Text style={s.codeChar}>{ch}</Text></View>)}
            </View>
            <View style={s.gesture}><Sparkle size={12} /><Text style={s.gestureText}>Hold it up and make this gesture: <Text style={{ fontWeight: '800', color: love.goldBright }}>{v.gestureLabel}</Text></Text></View>
            {v.expiresAt ? <Text style={s.codeHint}>Use this code by {new Date(v.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</Text> : null}
          </FadeInUp>
          <StepCard n={2} title="Your selfie" done={!!(selfie || v.hasSelfie)}>
            <View style={s.capRow}>
              {thumb(selfie, v.hasSelfie)}
              <LoveButton small kind={v.hasSelfie ? 'ghost' : 'primary'} icon="user" label={busy === 'selfie' ? 'Uploading…' : v.hasSelfie ? 'Retake selfie' : 'Take selfie'} onPress={() => capture('selfie')} disabled={!!busy} style={{ alignSelf: 'center', flex: 1 }} />
            </View>
          </StepCard>
          <StepCard n={3} title="Your ID" done={!!((idPhoto || v.hasId) && idType)}>
            <Choice items={Object.keys(ID_TYPE_LABELS)} labels={ID_TYPE_LABELS} value={idType} onChange={setIdType} />
            <View style={[s.capRow, { flexWrap: 'wrap' }]}>
              {thumb(idPhoto, v.hasId)}
              <View style={{ flex: 1, minWidth: 180, gap: 8 }}>
                <LoveButton small kind={v.hasId ? 'ghost' : 'primary'} icon="image" label={busy === 'id' ? 'Uploading…' : v.hasId ? 'Retake ID photo' : 'Photograph your ID'} onPress={() => capture('id')} disabled={!!busy} />
                <LoveButton small kind="soft" label="Choose from gallery" onPress={() => capture('id', true)} disabled={!!busy} />
              </View>
            </View>
            {v.idCheckAvailable ? (
              <View style={s.fastCheck}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="sparkles" size={14} color={love.gold} /><Text style={s.fastTitle}>Faster check (optional)</Text></View>
                <Text style={pst.hint}>Add your BVN or NIN and our ID partner (Dojah) compares your selfie with the photo on that record. We keep only the last 4 digits and the result.</Text>
                <Choice items={['nin', 'bvn']} labels={{ nin: 'NIN', bvn: 'BVN' }} value={checkType} onChange={setCheckType} />
                <Input value={checkNumber} onChangeText={(t) => setCheckNumber(t.replace(/\D/g, '').slice(0, 11))} placeholder={`Your 11-digit ${checkType.toUpperCase()} (optional)`} keyboardType="number-pad" maxLength={11} style={{ marginTop: 10 }} accessibilityLabel={`${checkType.toUpperCase()}, optional`} />
              </View>
            ) : (
              <View style={[s.fastCheck, { opacity: 0.8 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="sparkles" size={14} color={love.gold} /><Text style={s.fastTitle}>Faster check with BVN or NIN</Text><Text style={s.soon}>COMING SOON</Text></View>
                <Text style={pst.hint}>Soon you'll be able to add your BVN or NIN so your selfie is matched with that record automatically. For now our team reviews your photos by hand.</Text>
              </View>
            )}
          </StepCard>
          <Text style={s.fine}>{privacy}</Text>
          <LoveButton label={busy === 'submit' ? 'Sending…' : 'Send for review'} icon="shield" onPress={submit} disabled={!!busy || !v.hasSelfie || !v.hasId || !idType || (!!checkNumber && checkNumber.length !== 11)} style={{ marginTop: 14 }} />
        </>
      ) : null}
    </LoveScreen>
  );
}

const s = StyleSheet.create({
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 27, color: love.ink, textAlign: 'center', letterSpacing: -0.5 },
  planCard: { marginTop: 16, borderRadius: 28, padding: 20, overflow: 'hidden' },
  freeCard: { marginTop: 16, borderRadius: 28, padding: 20, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine, overflow: 'hidden', ...lshadow.sm },
  ribbon: { position: 'absolute', top: 16, right: 16, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: love.goldBright, zIndex: 2 },
  ribbonText: { fontSize: 11, fontWeight: '900', color: love.plum, letterSpacing: 0.4 },
  planIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  planName: { fontFamily: fonts.serifBold, fontSize: 25, letterSpacing: -0.3 },
  planTag: { fontFamily: fonts.serifItalic, fontSize: 14.5, marginTop: 1 },
  planPrice: { fontFamily: fonts.serifBold, fontSize: 30, marginTop: 14 },
  planPer: { fontFamily: fonts.serif, fontSize: 15 },
  planRule: { height: 1, marginVertical: 12 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 },
  featIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featText: { flex: 1, fontSize: 14, lineHeight: 19 },
  included: { marginTop: 14, fontSize: 13, fontWeight: '700' },
  fine: { fontSize: 12, color: love.muted, lineHeight: 18, marginTop: 16 },
  boostLive: { borderRadius: 28, padding: 20, overflow: 'hidden', marginTop: 8 },
  clock: { fontFamily: fonts.serifBold, fontSize: 22, color: '#FFFFFF', marginTop: 2 },
  clockSub: { fontSize: 11, color: love.onDarkMuted, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: love.goldBright },
  liveTagText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: love.goldBright },
  liveTitle: { fontFamily: fonts.serifBoldItalic, fontSize: 23, color: love.onDark, marginTop: 8 },
  liveSub: { fontSize: 12.5, color: love.onDarkMuted, marginTop: 4, lineHeight: 17 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  statNum: { fontFamily: fonts.serifBold, fontSize: 26, color: '#FFFFFF' },
  statLabel: { fontSize: 11.5, color: love.onDarkMuted, fontWeight: '700' },
  boostHero: { borderRadius: 28, padding: 22, overflow: 'hidden', marginTop: 8, alignItems: 'flex-start' },
  flameDisc: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  heroOnDark: { fontFamily: fonts.serifBold, fontSize: 26, color: love.onDark, marginTop: 14, letterSpacing: -0.4 },
  heroOnDarkBody: { fontSize: 14, lineHeight: 21, color: love.onDarkMuted, marginTop: 8 },
  boostOpt: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, backgroundColor: love.card, borderWidth: 1, borderColor: love.blushLine, marginTop: 10, minHeight: 76, ...lshadow.sm },
  boostIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  optTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: love.ink },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: love.blush, minHeight: 56 },
  setIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: love.blush, alignItems: 'center', justifyContent: 'center' },
  setTitle: { fontSize: 15, fontWeight: '700', color: love.ink },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginTop: 6, marginBottom: 4 },
  stepLine: { flex: 1, height: 2, backgroundColor: love.blushLine, marginTop: 15, marginHorizontal: -14, borderRadius: 1 },
  stepDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: love.blushLine, backgroundColor: love.card, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stepDone: { backgroundColor: love.rose, borderColor: love.rose },
  stepOn: { borderColor: 'transparent', ...lshadow.glow },
  stepNum: { fontSize: 13, fontWeight: '900', color: love.faint },
  stepLabel: { fontSize: 11.5, fontWeight: '700', color: love.faint, marginTop: 5 },
  stepBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: love.wine, alignItems: 'center', justifyContent: 'center' },
  stepBadgeText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12.5 },
  verifyHero: { borderRadius: 28, padding: 22, overflow: 'hidden', marginTop: 14 },
  codeCard: { borderRadius: 28, padding: 20, overflow: 'hidden', marginTop: 14, alignItems: 'center' },
  codeEyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: love.goldBright, textTransform: 'uppercase', textAlign: 'center' },
  codeRow: { flexDirection: 'row', gap: 6, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' },
  codeCell: { minWidth: 40, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(244,216,140,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  codeChar: { fontFamily: fonts.serifBold, fontSize: 30, color: '#FFFFFF' },
  gesture: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  gestureText: { flexShrink: 1, fontSize: 14, color: love.onDark, lineHeight: 19 },
  codeHint: { fontSize: 12, color: love.onDarkMuted, marginTop: 10 },
  capRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 12 },
  thumb: { width: 84, height: 104, borderRadius: 14, backgroundColor: love.blush },
  thumbDone: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(62,123,87,0.35)' },
  fastCheck: { marginTop: 16, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(166,109,34,0.3)' },
  fastTitle: { fontSize: 14, fontWeight: '800', color: love.goldInk },
  soon: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#fff', backgroundColor: love.gold, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', marginLeft: 'auto' },
});
