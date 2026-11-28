// PORTFOLIO & PARTNER MANAGERS (Development Update v1, document A; round 3 dashboards). API: src/api/portfolio.js.
//   PortfolioHomeScreen      Portfolio Manager dashboard (invite card first), Partner Manager dashboard, or "Become a partner"
//   PortfolioToolsScreen     Partner tools: landing link, share buttons, templates, banner, tracked invitations
//   PortfolioSettingsScreen  Partner settings: landing profile, invite message, commission structure, report, withdrawals, support
//   PortfolioApplyScreen     the Apply screen for an invitation code (a deep link or typed code)
//   PortfolioProfileRows     the Profile rows (shown to managers; "Become a partner" otherwise)
//   PortfolioEntryCard       the Today entry for managers (Invite Partner Managers, or the partner page and tools)
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { rememberPartnerInvite, usePartnerInviteOpened } from '../portfolio/inviteMemory';
import { useToast } from '../components/Toast';
import { DScreen, DTabs, DCard, DList, DRow, DButton, DInput, DLabel } from '../design/profile/parts';
import { d, df } from '../design/sanctuary';
import { Notice, Empty } from '../components/ui';
import {
  usePortfolioMe, usePortfolioDashboard, usePartnerDashboard, usePartnerTools, usePartnerProfile, usePartnerInvitations, usePartnerReport,
  portfolioInvite, applyToPortfolio, createPartnerInvite, revokePartnerInvite, decideApplication, requestPortfolioWithdrawal,
  getPortfolioStatement, savePartnerProfile, recordPartnerInvitation, portfolioError, naira, ngnBalance,
} from '../api/portfolio';

// The support address for partners (set EXPO_PUBLIC_SUPPORT_EMAIL in the app build). Empty = the screen says so.
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || '';
const INVITE_STATUS = { open: 'Open', used_up: 'Used up', expired: 'Expired', revoked: 'Revoked' };
const CHANNEL_PILLS = [['whatsapp', 'WhatsApp'], ['email', 'Email'], ['telegram', 'Telegram'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['link', 'Other']];

// ---------- shared bits ----------
function Stat({ label, value, sub }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  );
}

function Earnings({ earnings }) {
  return (
    <DCard style={s.hero}>
      <Text style={s.eyebrow}>Available to withdraw</Text>
      <Text style={s.heroValue}>{naira(ngnBalance(earnings, 'withdrawableMinor'))}</Text>
      <View style={s.statRow}>
        <Stat label="Held" value={naira(ngnBalance(earnings, 'heldMinor'))} sub="waiting for the hold period" />
        <Stat label="Paid out" value={naira(ngnBalance(earnings, 'paidMinor'))} />
      </View>
    </DCard>
  );
}

function WithdrawBox({ earnings, minMinor, nav, onDone }) {
  const api = useApi();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [kyc, setKyc] = useState(false);
  const available = ngnBalance(earnings, 'withdrawableMinor');
  const minNaira = Number(minMinor || 0) / 100;
  const value = Math.round(parseFloat(amount || '0') * 100);
  const submit = async () => {
    setBusy(true);
    try {
      await requestPortfolioWithdrawal(api, value);
      toast.show('Withdrawal requested', { icon: 'check', haptic: 'success' });
      setAmount(''); setKyc(false);
      onDone && onDone();
    } catch (e) {
      if (e.code === 'KYC_REQUIRED') setKyc(true);
      toast.show(portfolioError(e, 'Could not request the withdrawal'), { icon: 'x' });
    } finally { setBusy(false); }
  };
  return (
    <DCard style={{ marginTop: 14 }}>
      <Text style={s.cardTitle}>Withdraw</Text>
      <Text style={s.muted}>Minimum {naira(minMinor)}. Withdrawals are paid by BibleNestra after review. Your identity check (KYC) must be approved first.</Text>
      {kyc ? <Notice text="Verify your identity and bank account before you withdraw." /> : null}
      <DLabel>Amount in naira</DLabel>
      <DInput placeholder={`${minNaira.toLocaleString('en-NG')} or more`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <View style={{ height: 10 }} />
      <DButton label={busy ? 'Requesting…' : 'Request withdrawal'} disabled={busy || value < minMinor || value > available} onPress={submit} />
      {kyc ? <View style={{ marginTop: 8 }}><DButton label="Verify identity" onPress={() => nav.push('PayoutKyc')} /></View> : null}
    </DCard>
  );
}

function WithdrawalList({ items }) {
  if (!items || !items.length) return <Text style={s.muted}>No withdrawals yet.</Text>;
  return (
    <DList>
      {items.map((w) => (
        <DRow key={w.id} icon="coin" title={naira(w.amountMinor)} subtitle={`${w.status}${w.reference ? ' · ' + w.reference : ''}`} />
      ))}
    </DList>
  );
}

async function copyText(text, toast) {
  try {
    await Clipboard.setStringAsync(String(text || ''));
    toast.show('Copied', { icon: 'check', haptic: 'success' });
  } catch (e) { toast.show('Couldn’t copy', { icon: 'x' }); }
}

/** Share buttons: WhatsApp, Facebook, Telegram and email open their apps; Instagram and "Other" use the native share sheet. */
function ShareBar({ shares, text }) {
  const toast = useToast();
  const open = (url) => { if (url) Linking.openURL(url).catch(() => toast.show('Could not open that app', { icon: 'x' })); };
  const sh = shares || {};
  return (
    <View style={s.shareRow}>
      {sh.whatsapp ? <DButton small label="WhatsApp" onPress={() => open(sh.whatsapp)} /> : null}
      {sh.facebook ? <DButton small label="Facebook" onPress={() => open(sh.facebook)} /> : null}
      {sh.telegram ? <DButton small label="Telegram" onPress={() => open(sh.telegram)} /> : null}
      <DButton small label="Instagram" onPress={() => Share.share({ message: text || sh.link || '' })} />
      {sh.email ? <DButton small label="Email" onPress={() => open(sh.email)} /> : null}
      <DButton small label="Copy link" onPress={() => copyText(sh.link, toast)} />
    </View>
  );
}

/** Simple bars by month (no chart library). `field` is a number on each month. */
function MonthlyBars({ months, field, title, note }) {
  const list = months || [];
  const max = Math.max(1, ...list.map((m) => Number(m[field] || 0)));
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.cardTitle}>{title}</Text>
      <View style={s.barsRow}>
        {list.map((m) => {
          const v = Number(m[field] || 0);
          const h = Math.max(3, Math.round((v / max) * 96));
          return (
            <View key={m.month} style={s.barCol} accessibilityLabel={`${m.month}: ${v}`}>
              <Text style={s.barValue}>{v ? String(v) : ''}</Text>
              <View style={[s.bar, { height: h }]} />
              <Text style={s.barLabel}>{m.month.slice(5)}</Text>
            </View>
          );
        })}
      </View>
      {note ? <Text style={s.muted}>{note}</Text> : null}
    </View>
  );
}

function revenueNgn(stats) {
  const row = ((stats && stats.revenue) || []).find((r) => r.currency === 'NGN');
  return row ? row.amountMinor : 0;
}

// ---------- Portfolio Manager ----------
/** The first thing a Portfolio Manager sees: the invitation to recruit Partner Managers. */
function InviteCard({ invites }) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = (invites || []).find((i) => i.status === 'open') || null;
  const create = async () => {
    setBusy(true);
    try {
      await createPartnerInvite(api, { channel: 'link', label: 'Partner Manager invitation' });
      toast.show('Invitation link ready', { icon: 'check', haptic: 'success' });
    } catch (e) { toast.show(portfolioError(e, 'Could not create the link'), { icon: 'x' }); } finally { setBusy(false); }
  };
  return (
    <DCard style={s.inviteCard}>
      <Text style={s.eyebrow}>Recruit</Text>
      <Text style={s.cardTitle}>Invite Partner Managers</Text>
      <Text style={s.muted}>Send your personal invitation to people who will recruit members for BibleNestra. Each link has its own code. Their applications come to you to approve.</Text>
      {open ? (
        <>
          <Text selectable style={s.link}>{open.link}</Text>
          <Text style={s.muted}>Code {open.code} · used {open.uses}{open.maxUses ? ` of ${open.maxUses}` : ''}</Text>
          <ShareBar shares={open.share} text={`Join BibleNestra as a Partner Manager: ${open.link}`} />
          <View style={{ height: 8 }} />
          <DButton small label={busy ? 'Creating…' : 'Create another link'} disabled={busy} onPress={create} style={s.ghost} />
        </>
      ) : (
        <DButton label={busy ? 'Creating…' : 'Create invitation link'} disabled={busy} onPress={create} />
      )}
    </DCard>
  );
}

function PartnerPerformanceCard({ p }) {
  const pf = p.performance || {};
  return (
    <DCard style={{ marginBottom: 12 }}>
      <Text style={s.cardTitle}>{p.displayName || 'Partner Manager'}{p.handle ? ` · @${p.handle}` : ''}</Text>
      <Text style={s.muted}>{p.status} · joined {p.joinedAt ? new Date(p.joinedAt).toLocaleDateString() : '—'}</Text>
      <View style={s.statRow}>
        <Stat label="Invited" value={String(pf.invited || 0)} sub={`${pf.invitesPending || 0} pending`} />
        <Stat label="Registrations" value={String(pf.registrations || 0)} />
      </View>
      <View style={s.statRow}>
        <Stat label="Creators" value={String(pf.creatorsRecruited || 0)} sub={`${pf.activeCreators || 0} active`} />
        <Stat label="Memberships" value={String(pf.membershipsCreated || 0)} />
      </View>
      <View style={s.statRow}>
        <Stat label="Revenue" value={naira(revenueNgn(pf))} sub="subscriptions and creator plans" />
        <Stat label="Commission" value={naira(p.commissionMinor)} sub={`${naira(p.heldMinor)} pending`} />
      </View>
    </DCard>
  );
}

function PortfolioManagerHome({ nav }) {
  const dash = usePortfolioDashboard();
  const api = useApi();
  const toast = useToast();
  const [tab, setTab] = useState('Overview');
  const [channel, setChannel] = useState('link');
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState({});
  const d0 = dash.data;
  if (!d0) return dash.error ? <Empty title="Couldn’t load your dashboard" body={portfolioError(dash.error)} /> : <ActivityIndicator style={{ marginTop: 40 }} color={d.plum} />;

  const create = async () => {
    setBusy(true);
    try {
      const inv = await createPartnerInvite(api, { channel, label, email: channel === 'email' ? email : null });
      setMade(inv);
      toast.show('Invitation created', { icon: 'check', haptic: 'success' });
    } catch (e) { toast.show(portfolioError(e, 'Could not create the invitation'), { icon: 'x' }); } finally { setBusy(false); }
  };
  const act = async (fn, msg) => {
    try { await fn(); toast.show(msg, { icon: 'check', haptic: 'success' }); } catch (e) { toast.show(portfolioError(e, 'Something went wrong'), { icon: 'x' }); }
  };
  const perf = d0.partners || [];
  const totals = perf.reduce((t, p) => {
    const pf = p.performance || {};
    return { invited: t.invited + (pf.invited || 0), registrations: t.registrations + (pf.registrations || 0), creators: t.creators + (pf.creatorsRecruited || 0), revenue: t.revenue + revenueNgn(pf) };
  }, { invited: 0, registrations: 0, creators: 0, revenue: 0 });

  return (
    <>
      <InviteCard invites={d0.invites} />
      <DTabs items={['Overview', 'Partners', 'Invite', 'Applications', 'Withdrawals', 'Statement']} value={tab} onChange={setTab} />
      {tab === 'Overview' ? (
        <>
          <Earnings earnings={d0.earnings} />
          <View style={s.statRow}>
            <Stat label="Partner Managers" value={String(perf.length)} sub={`${d0.limits.partnerSlotsUsed} of ${d0.limits.partnerLimit} places`} />
            <Stat label="Referred users" value={String(d0.referredUsers)} />
          </View>
          <View style={s.statRow}>
            <Stat label="Invited (network)" value={String(totals.invited)} />
            <Stat label="Creators (network)" value={String(totals.creators)} />
          </View>
          <View style={s.statRow}>
            <Stat label="Registrations" value={String(totals.registrations)} />
            <Stat label="Network revenue" value={naira(totals.revenue)} sub="subscriptions and creator plans" />
          </View>
          <DCard style={{ marginTop: 14 }}>
            <Text style={s.cardTitle}>Your commission</Text>
            <Text style={s.muted}>You earn {d0.commission.pmPercent}% of the commissions your Partner Managers earn. Commissions are held for {d0.commission.holdDays} days.</Text>
          </DCard>
          <WithdrawBox earnings={d0.earnings} minMinor={d0.minWithdrawalMinor} nav={nav} onDone={dash.reload} />
        </>
      ) : null}
      {tab === 'Partners' ? (
        perf.length ? perf.map((p) => <PartnerPerformanceCard key={p.userId} p={p} />) : <Empty title="No Partner Managers yet" body="Share your invitation link above to recruit the first one." />
      ) : null}
      {tab === 'Invite' ? (
        <DCard>
          <Text style={s.cardTitle}>Create an invitation</Text>
          <Text style={s.muted}>Each invitation has its own unique code and link. Share it on WhatsApp, by email, on Telegram or Facebook, or copy the link.</Text>
          <View style={s.shareRow}>
            {[['link', 'Link'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['social', 'Social']].map(([k, l]) => <DButton key={k} small label={l} onPress={() => setChannel(k)} style={channel === k ? null : s.ghost} />)}
          </View>
          <DLabel>Label (for you)</DLabel>
          <DInput placeholder="e.g. Ibadan church network" value={label} onChangeText={setLabel} />
          {channel === 'email' ? (<><DLabel>Their email</DLabel><DInput placeholder="name@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} /></>) : null}
          <View style={{ height: 10 }} />
          <DButton label={busy ? 'Creating…' : 'Create invitation'} disabled={busy} onPress={create} />
          {made ? (
            <View style={{ marginTop: 14 }}>
              <Text style={s.cardTitle}>Code {made.code}</Text>
              <Text selectable style={s.link}>{made.link}</Text>
              <ShareBar shares={made.share} text={`Join BibleNestra as a Partner Manager: ${made.link}`} />
            </View>
          ) : null}
          <Text style={[s.cardTitle, { marginTop: 18 }]}>Your invitations</Text>
          {(d0.invites || []).map((i) => (
            <DRow key={i.id} icon="link" title={`${i.code}${i.label ? ' · ' + i.label : ''}`} subtitle={`${INVITE_STATUS[i.status] || 'Open'} · used ${i.uses}${i.maxUses ? ` of ${i.maxUses}` : ''}`}
              right={i.status === 'open' ? <DButton small label="Revoke" onPress={() => act(() => revokePartnerInvite(api, i.id), 'Invitation revoked')} /> : null} />
          ))}
        </DCard>
      ) : null}
      {tab === 'Applications' ? (
        d0.applications.length ? d0.applications.map((a) => (
          <DCard key={a.id} style={{ marginBottom: 12 }}>
            <Text style={s.cardTitle}>{a.applicant.displayName || 'Applicant'}{a.applicant.handle ? ` · @${a.applicant.handle}` : ''}</Text>
            <Text style={s.muted}>{[a.answers.country, a.answers.city, a.answers.phone].filter(Boolean).join(' · ')}</Text>
            <Text style={s.body}>{a.answers.motivation}</Text>
            <DInput placeholder="Reason (needed to decline)" value={reason[a.id] || ''} onChangeText={(v) => setReason({ ...reason, [a.id]: v })} />
            <View style={s.shareRow}>
              <DButton small label="Approve" onPress={() => act(() => decideApplication(api, a.id, 'approve'), 'Approved')} />
              <DButton small label="Decline" onPress={() => act(() => decideApplication(api, a.id, 'reject', reason[a.id]), 'Declined')} />
            </View>
          </DCard>
        )) : <Empty title="No applications to review" body="Partner Manager applications to you appear here." />
      ) : null}
      {tab === 'Withdrawals' ? (
        <>
          <WithdrawBox earnings={d0.earnings} minMinor={d0.minWithdrawalMinor} nav={nav} onDone={dash.reload} />
          <Text style={[s.cardTitle, { marginTop: 18 }]}>History</Text>
          <WithdrawalList items={d0.withdrawals} />
        </>
      ) : null}
      {tab === 'Statement' ? <StatementView /> : null}
    </>
  );
}

// ---------- Partner Manager ----------
function NetworkStats({ stats }) {
  const c = stats.commissions || {};
  const conv = stats.conversion || {};
  return (
    <>
      <View style={s.statRow}>
        <Stat label="People invited" value={String(stats.invited || 0)} sub={`${stats.invitesPending || 0} pending`} />
        <Stat label="Registrations" value={String(stats.registrations || 0)} sub={`${stats.invitesRegistered || 0} from invitations`} />
      </View>
      <View style={s.statRow}>
        <Stat label="Creators recruited" value={String(stats.creatorsRecruited || 0)} sub={`${stats.activeCreators || 0} with a published membership`} />
        <Stat label="Memberships" value={String(stats.membershipsCreated || 0)} sub="created through your network" />
      </View>
      <View style={s.statRow}>
        <Stat label="Subscription revenue" value={naira(revenueNgn(stats))} sub="memberships and creator plans" />
        <Stat label="Conversion" value={`${conv.visitToRegistration || 0}%`} sub={`visits to sign-ups · ${conv.inviteToRegistration || 0}% of invitations`} />
      </View>
      <DCard style={{ marginTop: 14 }}>
        <Text style={s.cardTitle}>Commissions</Text>
        <View style={s.statRow}>
          <Stat label="Earned" value={naira(c.earnedMinor)} />
          <Stat label="Pending" value={naira(c.pendingMinor)} sub="held" />
        </View>
        <View style={s.statRow}>
          <Stat label="Approved" value={naira(c.approvedMinor)} sub="ready to withdraw" />
          <Stat label="Paid" value={naira(c.paidMinor)} />
        </View>
      </DCard>
    </>
  );
}

function PartnerManagerHome({ nav }) {
  const dash = usePartnerDashboard();
  const api = useApi();
  const [tab, setTab] = useState('Overview');
  const d0 = dash.data;
  if (!d0) return dash.error ? <Empty title="Couldn’t load your dashboard" body={portfolioError(dash.error)} /> : <ActivityIndicator style={{ marginTop: 40 }} color={d.plum} />;
  const stats = d0.stats || {};
  const text = `Read the Bible, pray and chat with believers on BibleNestra. Join me: ${d0.landingUrl}`;
  return (
    <>
      <DTabs items={['Overview', 'Share', 'Commissions', 'Withdrawals', 'Statement']} value={tab} onChange={setTab} />
      {tab === 'Overview' ? (
        <>
          <NetworkStats stats={stats} />
          <DCard style={{ marginTop: 14 }}>
            <Text style={s.cardTitle}>Your commission</Text>
            <Text style={s.muted}>You earn {d0.commission.partnerPercent}% of the eligible payments your referred users make (coins, Plus, Find Love, memberships, creator plans and Fund Me fees). Donations are not included. Commissions are held for {d0.commission.holdDays} days.</Text>
          </DCard>
          <DCard style={{ marginTop: 14 }}>
            <MonthlyBars months={d0.monthly} field="registrations" title="Sign-ups by month" note="The last 12 months." />
            <MonthlyBars months={d0.monthly} field="memberships" title="Memberships created by month" />
          </DCard>
          <WithdrawBox earnings={d0.earnings} minMinor={d0.minWithdrawalMinor} nav={nav} onDone={dash.reload} />
        </>
      ) : null}
      {tab === 'Share' ? (
        <DCard>
          <Text style={s.cardTitle}>Your personal page</Text>
          <Text selectable style={s.link}>{d0.landingUrl}</Text>
          <Text style={s.muted}>Share this page with people you know. When they join with your code, they are linked to you for good.</Text>
          <View style={{ height: 12 }} />
          <ShareBar shares={d0.share} text={text} />
          <Text style={[s.muted, { marginTop: 12 }]}>Your invite code: {d0.code}</Text>
          <DButton small label="Open my page" onPress={() => Linking.openURL(d0.landingUrl)} style={{ marginTop: 10 }} />
        </DCard>
      ) : null}
      {tab === 'Commissions' ? (
        d0.commissions.length ? (
          <DList>
            {d0.commissions.map((c) => (
              <DRow key={c.id} icon="coin" title={naira(c.amountMinor)} subtitle={`${c.status} · ${c.kind}${c.status === 'held' ? ' · available ' + new Date(c.availableAt).toLocaleDateString() : ''}`} />
            ))}
          </DList>
        ) : <Empty title="No commissions yet" body="When someone you referred makes an eligible payment, it appears here." />
      ) : null}
      {tab === 'Withdrawals' ? (
        <>
          <WithdrawBox earnings={d0.earnings} minMinor={d0.minWithdrawalMinor} nav={nav} onDone={dash.reload} />
          <Text style={[s.cardTitle, { marginTop: 18 }]}>History</Text>
          <WithdrawalList items={d0.withdrawals} />
        </>
      ) : null}
      {tab === 'Statement' ? <StatementView /> : null}
      <Text style={[s.muted, { marginTop: 12 }]}>Signed in as a Partner Manager {api.online ? '' : '(offline)'}</Text>
    </>
  );
}

function StatementView() {
  const api = useApi();
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    getPortfolioStatement(api).then((r) => alive && setSt(r)).catch((e) => alive && setErr(e));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (err) return <Empty title="Couldn’t load the statement" body={portfolioError(err)} />;
  if (!st) return <ActivityIndicator style={{ marginTop: 30 }} color={d.plum} />;
  const lines = st.commissions || [];
  const roleLabel = { partner: 'Partner commission', portfolio: 'Portfolio commission', membership: 'Membership commission' };
  return (
    <DCard>
      <Text style={s.cardTitle}>Statement for {st.month}</Text>
      {lines.length ? lines.map((l, i) => (
        <Text key={i} style={s.body}>{roleLabel[l.role] || l.role} · {l.status} · {l.count} · {naira(l.amountMinor)}</Text>
      )) : <Text style={s.muted}>No commissions this month.</Text>}
      {(st.withdrawals || []).map((w, i) => (
        <Text key={'w' + i} style={s.body}>Withdrawals {w.status} · {w.count} · {naira(w.amountMinor)}</Text>
      ))}
      <Text style={[s.muted, { marginTop: 10 }]}>Generated {new Date(st.generatedAt).toLocaleString()}</Text>
    </DCard>
  );
}

// ---------- Partner tools ----------
export function PortfolioToolsScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const tools = usePartnerTools();
  const inv = usePartnerInvitations();
  const [channel, setChannel] = useState('whatsapp');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const t = tools.data;
  const items = (inv.data && inv.data.items) || [];
  const counts = { total: items.length, pending: items.filter((i) => i.status === 'pending').length, registered: items.filter((i) => i.status === 'registered').length };

  const send = async () => {
    setBusy(true);
    try {
      const r = await recordPartnerInvitation(api, { channel, name: name.trim() || null, email: channel === 'email' ? email.trim() : null });
      inv.reload();
      toast.show('Invitation recorded', { icon: 'check', haptic: 'success' });
      const sh = r.share || {};
      const url = { email: sh.email, whatsapp: sh.whatsapp, telegram: sh.telegram, facebook: sh.facebook }[channel];
      if (url) Linking.openURL(url).catch(() => toast.show('Could not open that app', { icon: 'x' }));
      else Share.share({ message: r.message || sh.link || '' });
      setName(''); setEmail('');
    } catch (e) { toast.show(portfolioError(e, 'Could not record the invitation'), { icon: 'x' }); } finally { setBusy(false); }
  };

  return (
    <DScreen back onBack={() => nav.pop()} title="Promotion tools" subtitle="Share, invite and track">
      {!t ? <ActivityIndicator style={{ marginTop: 30 }} color={d.plum} /> : (
        <>
          <DCard>
            <Text style={s.cardTitle}>Your unique link</Text>
            <Text selectable style={s.link}>{t.landingUrl}</Text>
            <Text style={s.muted}>Invite code {t.code}. Everyone who joins through your link is linked to you, for good.</Text>
            <ShareBar shares={t.shares} text={t.templates[0] ? t.templates[0].text : t.landingUrl} />
          </DCard>

          <DCard style={{ marginTop: 14 }}>
            <Text style={s.cardTitle}>Promotion banner</Text>
            <Text style={s.muted}>A square banner in the BibleNestra style with your name and code. Open it, save it, and post it.</Text>
            <DButton small label="Open banner" onPress={() => Linking.openURL(t.banner.url).catch(() => toast.show('Could not open the banner', { icon: 'x' }))} style={{ marginTop: 10 }} />
          </DCard>

          <Text style={[s.cardTitle, { marginTop: 18 }]}>Message templates</Text>
          {t.templates.map((tpl) => (
            <DCard key={tpl.id} style={{ marginBottom: 10 }}>
              <Text style={s.cardTitle}>{tpl.title}</Text>
              <Text style={s.body}>{tpl.text}</Text>
              <View style={s.shareRow}>
                <DButton small label="Copy" onPress={() => copyText(tpl.text, toast)} />
                <DButton small label="Share" onPress={() => Share.share({ message: tpl.text })} />
              </View>
            </DCard>
          ))}

          <DCard style={{ marginTop: 18 }}>
            <Text style={s.cardTitle}>Invite someone</Text>
            <Text style={s.muted}>Pick how you will send it. Email opens a prepared message; the others open the app you choose.</Text>
            <View style={s.shareRow}>
              {CHANNEL_PILLS.map(([k, l]) => <DButton key={k} small label={l} onPress={() => setChannel(k)} style={channel === k ? null : s.ghost} />)}
            </View>
            <DLabel style={{ marginTop: 10 }}>Their name (optional)</DLabel>
            <DInput placeholder="e.g. Grace" value={name} onChangeText={setName} />
            {channel === 'email' ? (<><DLabel style={{ marginTop: 10 }}>Their email</DLabel><DInput placeholder="name@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} /></>) : null}
            <View style={{ height: 10 }} />
            <DButton label={busy ? 'Recording…' : 'Send invitation'} disabled={busy || (channel === 'email' && !email.trim())} onPress={send} />
          </DCard>

          <Text style={[s.cardTitle, { marginTop: 18 }]}>Invitations</Text>
          <View style={s.statRow}>
            <Stat label="Sent" value={String(counts.total)} />
            <Stat label="Pending" value={String(counts.pending)} />
            <Stat label="Registered" value={String(counts.registered)} />
          </View>
          {items.length ? (
            <DList style={{ marginTop: 10 }}>
              {items.slice(0, 50).map((i) => (
                <DRow key={i.id} icon="share" title={i.name || i.email || i.channel} subtitle={`${i.channel} · ${i.status === 'registered' ? 'registered' : 'pending'} · ${new Date(i.createdAt).toLocaleDateString()}`} />
              ))}
            </DList>
          ) : <Text style={[s.muted, { marginTop: 8 }]}>Invitations you send appear here, with their status.</Text>}
        </>
      )}
    </DScreen>
  );
}

// ---------- Partner settings ----------
export function PortfolioSettingsScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const prof = usePartnerProfile();
  const dash = usePartnerDashboard();
  const rep = usePartnerReport();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (prof.data && !f) setF({ displayName: prof.data.displayName || '', intro: prof.data.intro || '', photoUrl: prof.data.photoUrl || '', inviteMessage: prof.data.usingDefaultMessage ? '' : (prof.data.inviteMessage || '') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prof.data]);
  const d0 = dash.data;
  const save = async () => {
    setBusy(true);
    try {
      await savePartnerProfile(api, f);
      toast.show('Saved', { icon: 'check', haptic: 'success' });
      prof.reload();
    } catch (e) { toast.show(portfolioError(e, 'Could not save'), { icon: 'x' }); } finally { setBusy(false); }
  };
  const contact = () => {
    const body = `Partner code: ${prof.data ? prof.data.code : ''}\n\n`;
    if (!SUPPORT_EMAIL) { toast.show('Support email is not set in this build', { icon: 'x' }); return; }
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Partner Manager support')}&body=${encodeURIComponent(body)}`).catch(() => toast.show('Could not open your mail app', { icon: 'x' }));
  };
  const r = rep.data;
  return (
    <DScreen back onBack={() => nav.pop()} title="Partner settings" subtitle="Your page, invite message, earnings">
      {!f ? <ActivityIndicator style={{ marginTop: 30 }} color={d.plum} /> : (
        <DCard>
          <Text style={s.cardTitle}>Landing page</Text>
          <DLabel>Display name</DLabel>
          <DInput placeholder="How people see your name" value={f.displayName} onChangeText={(v) => setF({ ...f, displayName: v })} />
          <DLabel style={{ marginTop: 10 }}>Intro</DLabel>
          <DInput multiline placeholder="A few words about you" value={f.intro} onChangeText={(v) => setF({ ...f, intro: v })} />
          <DLabel style={{ marginTop: 10 }}>Photo (https web address, optional)</DLabel>
          <DInput autoCapitalize="none" placeholder="https://" value={f.photoUrl} onChangeText={(v) => setF({ ...f, photoUrl: v })} />
          <DLabel style={{ marginTop: 10 }}>Invite message</DLabel>
          <DInput multiline placeholder="Leave empty for the standard message. Keep {link} so people get your link." value={f.inviteMessage} onChangeText={(v) => setF({ ...f, inviteMessage: v })} />
          <View style={{ height: 12 }} />
          <DButton label={busy ? 'Saving…' : 'Save'} disabled={busy} onPress={save} />
        </DCard>
      )}

      {d0 ? (
        <DCard style={{ marginTop: 14 }}>
          <Text style={s.cardTitle}>Commission structure</Text>
          <Text style={s.muted}>You earn {d0.commission.partnerPercent}% of eligible payments from your network, held for {d0.commission.holdDays} days. Your Portfolio Manager earns their share of your commission. Membership and creator plan commissions follow the rules set by BibleNestra.</Text>
        </DCard>
      ) : null}

      {d0 ? <WithdrawBox earnings={d0.earnings} minMinor={d0.minWithdrawalMinor} nav={nav} onDone={dash.reload} /> : null}

      <DCard style={{ marginTop: 14 }}>
        <Text style={s.cardTitle}>Performance report</Text>
        {!r ? <ActivityIndicator style={{ marginTop: 6 }} color={d.plum} /> : (
          <>
            <Text style={s.body}>Invited {r.stats.invited} · registrations {r.stats.registrations} · creators {r.stats.creatorsRecruited} · memberships {r.stats.membershipsCreated}</Text>
            <Text style={s.body}>Commissions earned {naira(r.stats.commissions.earnedMinor)} · pending {naira(r.stats.commissions.pendingMinor)} · paid {naira(r.stats.commissions.paidMinor)}</Text>
            <MonthlyBars months={r.monthly} field="commissionMinor" title="Commissions by month" />
          </>
        )}
      </DCard>

      <DCard style={{ marginTop: 14 }}>
        <Text style={s.cardTitle}>Support</Text>
        <Text style={s.muted}>{SUPPORT_EMAIL ? 'Email the BibleNestra team about your account, payments or commissions.' : 'Support email is not set in this build. Use the app’s Help section.'}</Text>
        <DButton small label="Contact support" onPress={contact} style={{ marginTop: 10 }} />
      </DCard>
    </DScreen>
  );
}

// ---------- the screen ----------
export function PortfolioHomeScreen() {
  const nav = useNav();
  const api = useApi();
  const me = usePortfolioMe();
  const m = me.data;
  let body;
  if (!api.online) body = <Empty title="Sign in to use Portfolio & Partners" body="Your dashboard is kept on the server." />;
  else if (!m) body = me.error ? <Empty title="Couldn’t load" body={portfolioError(me.error)} /> : <ActivityIndicator style={{ marginTop: 40 }} color={d.plum} />;
  else if (m.member && m.member.status === 'suspended') body = <Notice text={`Your account is suspended${m.member.suspendReason ? ': ' + m.member.suspendReason : '.'} Contact BibleNestra to find out more.`} />;
  else if (m.pendingApplication || (m.member && m.member.status === 'pending')) body = <Notice text="Your application is waiting for approval. We will let you know as soon as it is decided." />;
  else if (m.isPortfolioManager && m.isActive) body = <PortfolioManagerHome nav={nav} />;
  else if (m.isPartnerManager && m.isActive) body = <PartnerManagerHome nav={nav} />;
  else body = (
    <DCard>
      <Text style={s.cardTitle}>Become a partner</Text>
      <Text style={s.muted}>Portfolio and Partner Managers recruit people to BibleNestra and earn commissions on their eligible payments. You need an invitation code to apply.</Text>
      <View style={{ height: 12 }} />
      <DButton label="I have an invitation code" onPress={() => nav.push('PortfolioApply')} />
    </DCard>
  );
  const member = !!(m && m.member && m.isActive);
  return (
    <DScreen back onBack={() => nav.pop()} title="Portfolio & Partners" subtitle={m && m.member ? `${m.member.roleLabel}` : 'Recruit, invite, earn'}>
      {member && m.isPartnerManager ? (
        <View style={s.navRow}>
          <DButton small label="Promotion tools" onPress={() => nav.push('PortfolioTools')} />
          <DButton small label="Settings" onPress={() => nav.push('PortfolioSettings')} style={s.ghost} />
        </View>
      ) : null}
      {body}
    </DScreen>
  );
}

export function PortfolioApplyScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const me = usePortfolioMe();
  const [code, setCode] = useState(params.code || '');
  const [info, setInfo] = useState(null);
  const [lookupErr, setLookupErr] = useState(null);
  const [f, setF] = useState({ fullName: '', phone: '', country: '', city: '', experience: '', motivation: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!code || code.trim().length < 4) { setInfo(null); setLookupErr(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      portfolioInvite(api, code).then((r) => { if (alive) { setInfo(r); setLookupErr(null); } if (r && r.open) rememberPartnerInvite(code); }).catch((e) => { if (alive) { setInfo(null); setLookupErr(e); } });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const ok = !!info && info.open && f.fullName.trim().length >= 3 && f.motivation.trim().length >= 10;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await applyToPortfolio(api, { code: code.trim(), answers: f });
      setDone(r);
      toast.show(r.autoApproved ? 'You are approved' : 'Application sent', { icon: 'check', haptic: 'success' });
      me.reload();
    } catch (e) { toast.show(portfolioError(e, 'Could not send the application'), { icon: 'x' }); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <DScreen back onBack={() => nav.pop()} title="Application" subtitle="Thank you">
        <DCard>
          <Text style={s.cardTitle}>{done.autoApproved ? 'You are in' : 'Application received'}</Text>
          <Text style={s.body}>{done.autoApproved ? 'Your dashboard is ready. Open Portfolio & Partners from your Profile.' : 'Your application is waiting for approval. You will be notified of the decision.'}</Text>
          <View style={{ height: 12 }} />
          <DButton label="Back to Profile" onPress={() => nav.pop()} />
        </DCard>
      </DScreen>
    );
  }
  return (
    <DScreen back onBack={() => nav.pop()} title="Apply" subtitle={info ? `Apply to become a ${info.kindLabel}` : 'Enter your invitation code'}>
      <DCard>
        <DLabel>Invitation code</DLabel>
        <DInput placeholder="e.g. ABC123" autoCapitalize="characters" value={code} onChangeText={setCode} />
        {lookupErr ? <Text style={[s.muted, { color: d.roseDark, marginTop: 6 }]}>{portfolioError(lookupErr, 'That code was not found')}</Text> : null}
        {info && !info.open ? <Notice text="This invitation is closed. Ask the person who invited you for a new one." /> : null}
        {info && info.open ? (
          <>
            <Text style={[s.muted, { marginTop: 8 }]}>{info.inviterName ? `Invited by ${info.inviterName}. ` : ''}You earn {info.commission.partnerPercent ?? info.commission.pmPercent}% commission, held for {info.commission.holdDays} days.</Text>
            <DLabel style={{ marginTop: 14 }}>Full name</DLabel>
            <DInput placeholder="As you want it shown" value={f.fullName} onChangeText={set('fullName')} />
            <DLabel style={{ marginTop: 10 }}>Phone (optional)</DLabel>
            <DInput keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} />
            <DLabel style={{ marginTop: 10 }}>Country and city</DLabel>
            <DInput placeholder="Country" value={f.country} onChangeText={set('country')} />
            <DInput style={{ marginTop: 8 }} placeholder="City" value={f.city} onChangeText={set('city')} />
            <DLabel style={{ marginTop: 10 }}>Your experience (optional)</DLabel>
            <DInput multiline value={f.experience} onChangeText={set('experience')} />
            <DLabel style={{ marginTop: 10 }}>Why do you want to join?</DLabel>
            <DInput multiline placeholder="A few sentences" value={f.motivation} onChangeText={set('motivation')} />
            <View style={{ height: 14 }} />
            <DButton label={busy ? 'Sending…' : 'Send application'} disabled={!ok || busy} onPress={submit} />
          </>
        ) : null}
      </DCard>
      {me.data && me.data.member ? <Text style={[s.muted, { marginTop: 10 }]}>You already have a Portfolio & Partners role, so you cannot apply again.</Text> : null}
    </DScreen>
  );
}

/** Rows for Profile › Everything in one place. Managers see their dashboard; everyone else sees "Become a partner". */
export function PortfolioProfileRows() {
  const nav = useNav();
  const me = usePortfolioMe();
  const invited = usePartnerInviteOpened(); // only people who opened a partner or portfolio invite see "Become a partner"
  const m = me.data;
  if (!m) return null;
  if (m.member) {
    const title = m.isPortfolioManager ? 'Portfolio Manager' : 'Partner Manager';
    return <DRow icon="briefcase" title="Portfolio & Partners" subtitle={`${title} · ${m.member.status === 'active' ? 'dashboard, earnings and withdrawals' : m.member.status}`} onPress={() => nav.push('PortfolioHome')} />;
  }
  if (!invited) return null;
  return <DRow icon="share" title="Become a partner" subtitle="Have an invitation code? Apply to recruit for BibleNestra" onPress={() => nav.push('PortfolioApply')} />;
}

/** Today entry for managers: Portfolio Managers invite Partner Managers here; partners get their page and tools. */
export function PortfolioEntryCard() {
  const nav = useNav();
  const me = usePortfolioMe();
  const m = me.data;
  if (!m || !m.isActive) return null;
  const pm = m.isPortfolioManager;
  return (
    <DCard style={s.entryCard}>
      <Text style={s.eyebrow}>Portfolio & Partners</Text>
      <Text style={s.cardTitle}>{pm ? 'Invite Partner Managers' : 'Share your page and earn'}</Text>
      <Text style={s.muted}>{pm ? 'Send your invitation link and follow the Partner Managers you recruit.' : 'Share your personal BibleNestra page and follow your network.'}</Text>
      <DButton small label={pm ? 'Open my dashboard' : 'Open promotion tools'} onPress={() => nav.push(pm ? 'PortfolioHome' : 'PortfolioTools')} style={{ marginTop: 10 }} />
    </DCard>
  );
}

const s = StyleSheet.create({
  hero: { padding: 18 },
  eyebrow: { fontFamily: df.sansSemi, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: d.muted },
  heroValue: { fontFamily: df.display, fontSize: 30, color: d.ink, marginTop: 4 },
  cardTitle: { fontFamily: df.display, fontSize: 17, color: d.ink, marginBottom: 6 },
  body: { fontFamily: df.sans, fontSize: 14, color: d.ink, marginTop: 4, lineHeight: 20 },
  muted: { fontFamily: df.sans, fontSize: 13, color: d.muted, lineHeight: 19 },
  link: { fontFamily: df.sansMedium, fontSize: 14, color: d.plumDark, marginTop: 6 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stat: { flex: 1, backgroundColor: d.paper, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: d.line, padding: 12 },
  statValue: { fontFamily: df.display, fontSize: 18, color: d.ink },
  statLabel: { fontFamily: df.sansSemi, fontSize: 12, color: d.muted, marginTop: 2 },
  statSub: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 2 },
  shareRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  ghost: { backgroundColor: d.lavender },
  inviteCard: { marginBottom: 14, borderWidth: 1.5, borderColor: d.plum },
  entryCard: { marginBottom: 12 },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 140, marginTop: 8 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '70%', borderRadius: 6, backgroundColor: d.plum },
  barValue: { fontFamily: df.sansSemi, fontSize: 10, color: d.muted, marginBottom: 2 },
  barLabel: { fontFamily: df.sans, fontSize: 10, color: d.muted, marginTop: 4 },
});
