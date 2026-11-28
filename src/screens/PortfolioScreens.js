// PORTFOLIO & PARTNER MANAGERS (Development Update v1, document A). API: src/api/portfolio.js.
//   PortfolioHomeScreen   Portfolio Manager dashboard, Partner Manager dashboard, or "Become a partner" when not a member
//   PortfolioApplyScreen  the Apply screen for an invitation code (a deep link or typed code)
//   PortfolioProfileRows  the Profile › Everything in one place rows (shown to managers; "Become a partner" otherwise)
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Text, View } from 'react-native';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { rememberPartnerInvite, usePartnerInviteOpened } from '../portfolio/inviteMemory';
import { useToast } from '../components/Toast';
import { DScreen, DTabs, DCard, DList, DRow, DButton, DInput, DLabel } from '../design/profile/parts';
import { d, df } from '../design/sanctuary';
import { Notice, Empty } from '../components/ui';
import {
  usePortfolioMe, usePortfolioDashboard, usePartnerDashboard, portfolioInvite, applyToPortfolio, createPartnerInvite, revokePartnerInvite,
  decideApplication, requestPortfolioWithdrawal, getPortfolioStatement, portfolioError, naira, ngnBalance,
} from '../api/portfolio';

const CHANNELS = [['link', 'Link'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['social', 'Social']];
const roleWord = (kind) => (kind === 'portfolio_manager' ? 'Portfolio Manager' : 'Partner Manager');

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

function ShareButtons({ share, text }) {
  return (
    <View style={s.shareRow}>
      <DButton small label="WhatsApp" onPress={() => share && Linking.openURL(share.whatsapp)} />
      <DButton small label="Email" onPress={() => share && Linking.openURL(share.email)} />
      <DButton small label="Share" onPress={() => share && Share.share({ message: text || share.link })} />
    </View>
  );
}

// ---------- Portfolio Manager ----------
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

  return (
    <>
      <DTabs items={['Overview', 'Partners', 'Invite', 'Applications', 'Withdrawals', 'Statement']} value={tab} onChange={setTab} />
      {tab === 'Overview' ? (
        <>
          <Earnings earnings={d0.earnings} />
          <View style={s.statRow}>
            <Stat label="Partner Managers" value={String(d0.partners.length)} sub={`${d0.limits.partnerSlotsUsed} of ${d0.limits.partnerLimit} places`} />
            <Stat label="Referred users" value={String(d0.referredUsers)} />
          </View>
          <DCard style={{ marginTop: 14 }}>
            <Text style={s.cardTitle}>Your commission</Text>
            <Text style={s.muted}>You earn {d0.commission.pmPercent}% of the commissions your Partner Managers earn. Commissions are held for {d0.commission.holdDays} days.</Text>
          </DCard>
          <WithdrawBox earnings={d0.earnings} minMinor={d0.minWithdrawalMinor} nav={nav} onDone={dash.reload} />
        </>
      ) : null}
      {tab === 'Partners' ? (
        d0.partners.length ? (
          <DList>
            {d0.partners.map((p) => (
              <DRow key={p.userId} icon="users" title={p.displayName || 'Partner Manager'} subtitle={`${p.status} · ${p.referredUsers} referred · ${p.payments} payments · ${naira(p.commissionMinor)}`} />
            ))}
          </DList>
        ) : <Empty title="No Partner Managers yet" body="Invite people from the Invite tab." />
      ) : null}
      {tab === 'Invite' ? (
        <DCard>
          <Text style={s.cardTitle}>Invite a Partner Manager</Text>
          <Text style={s.muted}>Each invitation has its own unique code and link. Share it on WhatsApp, by email, on social media, or copy the link.</Text>
          <View style={s.shareRow}>
            {CHANNELS.map(([k, l]) => <DButton key={k} small label={l} onPress={() => setChannel(k)} style={channel === k ? null : s.ghost} />)}
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
              <ShareButtons share={made.share} text={`Join BibleNestra as a Partner Manager: ${made.link}`} />
            </View>
          ) : null}
          <Text style={[s.cardTitle, { marginTop: 18 }]}>Your invitations</Text>
          {(d0.invites || []).map((i) => (
            <DRow key={i.id} icon="link" title={`${i.code}${i.label ? ' · ' + i.label : ''}`} subtitle={`${i.revoked ? 'Revoked' : 'Open'} · used ${i.uses}`}
              right={!i.revoked ? <DButton small label="Revoke" onPress={() => act(() => revokePartnerInvite(api, i.id), 'Invitation revoked')} /> : null} />
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
function PartnerManagerHome({ nav }) {
  const dash = usePartnerDashboard();
  const api = useApi();
  const [tab, setTab] = useState('Overview');
  const d0 = dash.data;
  if (!d0) return dash.error ? <Empty title="Couldn’t load your dashboard" body={portfolioError(dash.error)} /> : <ActivityIndicator style={{ marginTop: 40 }} color={d.plum} />;
  const text = `Read the Bible, pray and chat with believers on BibleNestra. Join me: ${d0.landingUrl}`;
  return (
    <>
      <DTabs items={['Overview', 'Share', 'Commissions', 'Withdrawals', 'Statement']} value={tab} onChange={setTab} />
      {tab === 'Overview' ? (
        <>
          <Earnings earnings={d0.earnings} />
          <View style={s.statRow}>
            <Stat label="Referred users" value={String(d0.referredUsers)} />
            <Stat label="Eligible payments" value={String(d0.eligiblePayments)} />
          </View>
          <DCard style={{ marginTop: 14 }}>
            <Text style={s.cardTitle}>Your commission</Text>
            <Text style={s.muted}>You earn {d0.commission.partnerPercent}% of the eligible payments your referred users make (coins, Plus, Find Love, memberships and Fund Me fees). Donations are not included. Commissions are held for {d0.commission.holdDays} days.</Text>
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
          <ShareButtons share={d0.share} text={text} />
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
  return (
    <DCard>
      <Text style={s.cardTitle}>Statement for {st.month}</Text>
      {lines.length ? lines.map((l, i) => (
        <Text key={i} style={s.body}>{l.role === 'partner' ? 'Partner commission' : 'Portfolio commission'} · {l.status} · {l.count} · {naira(l.amountMinor)}</Text>
      )) : <Text style={s.muted}>No commissions this month.</Text>}
      {(st.withdrawals || []).map((w, i) => (
        <Text key={'w' + i} style={s.body}>Withdrawals {w.status} · {w.count} · {naira(w.amountMinor)}</Text>
      ))}
      <Text style={[s.muted, { marginTop: 10 }]}>Generated {new Date(st.generatedAt).toLocaleString()}</Text>
    </DCard>
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
  return (
    <DScreen back onBack={() => nav.pop()} title="Portfolio & Partners" subtitle={m && m.member ? `${m.member.roleLabel}` : 'Recruit, invite, earn'}>
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
        {lookupErr ? <Text style={[s.muted, { color: '#B33D3D', marginTop: 6 }]}>{portfolioError(lookupErr, 'That code was not found')}</Text> : null}
        {info && !info.open ? <Notice text="This invitation is closed. Ask the person who invited you for a new one." /> : null}
        {info && info.open ? (
          <>
            <Text style={[s.muted, { marginTop: 8 }]}>{info.inviterName ? `Invited by ${info.inviterName}. ` : ''}You earn {info.commission.partnerPercent ?? info.commission.pmPercent}% commission{info.kind === 'portfolio_manager' ? '' : ''}, held for {info.commission.holdDays} days.</Text>
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
});
