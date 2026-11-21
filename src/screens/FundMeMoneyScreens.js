// FUND ME MONEY (monetisation stage 2 — client spec §1 credits, §2 gifting credits, §3 donations and payouts).
//   FundMeCredits         balance, what a credit does, buy (BuyCoinsSheet), send to a friend, history
//   FundMeGiftCredits     pick a member → amount → ConfirmSpend → atomic transfer (credits only, never cash)
//   FundMeMoney           organiser: totals, donations with status, payouts with timelines, bank account
//   FundMePayoutAccount   organiser: bank + account number (+ name check with Paystack), masked, reviewed by staff
//   FundMeMyDonations     my donations; FundMeReceipt  one receipt with its fee breakdown and status history
//   PayoutKyc             identity check before any payout (Fund Me) or gift-earnings withdrawal: ID + legal name + bank
//   <FundMeCreditsCard/>  "Publishing uses 1 credit · you have N" + Buy, used by the create / edit wizard
// Server: backend/src/routes/fundmeMoney.js · docs: scratch/monetisation/fundme.md
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, Section, Button, Input, Badge, Notice, Empty, Eyebrow, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale, Shimmer } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { errorMessage } from '../api/client';
import { BuyCoinsSheet, ConfirmSpend } from '../components/wallet';
import { walletChanged, newIdempotencyKey, walletError, dateLabel, timeLabel } from '../api/wallet';
import { useFundMe, onFundMeChange, formatMoney, DONATION_STATUS, PAYOUT_STATUS, HELD_EXPLAINER, SYMBOL } from '../api/fundme';

const KYC_TINT = { approved: colors.positive, rejected: colors.negative, pending_review: colors.gold, none: colors.muted };
const moneyAny = (m, c) => (SYMBOL[c] != null ? formatMoney(m, c) : `${c} ${formatMoney(m, c)}`);

const KIND_LABEL = {
  purchase: 'Bought credits', test_purchase: 'Test purchase', fundme_publish: 'Published a request', fundme_credit_gift_sent: 'Sent to a friend',
  fundme_credit_gift_received: 'Received from a friend', admin_adjust: 'Adjusted by BibleNestra', purchase_reversal: 'Purchase refunded',
};

function useLoad(load) {
  const focused = useIsFocused();
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => { if (focused) ref.current(); }, [focused]);
  useEffect(() => onFundMeChange(() => ref.current()), []);
}

function StatusPill({ map, status, label }) {
  const s = map[status] || { label: label || status, tint: colors.muted };
  return <Badge label={label || s.label} tint={s.tint} />;
}

function Card({ children, style }) { return <View style={[st.card, style]}>{children}</View>; }

function Kpi({ label, value, tint }) {
  return (
    <View style={st.kpi}>
      <Text style={[st.kpiValue, tint && { color: tint }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={st.kpiLabel}>{label}</Text>
    </View>
  );
}

function Timeline({ items }) {
  if (!items || !items.length) return null;
  return (
    <View style={{ marginTop: 10 }}>
      {items.map((e, i) => (
        <View key={`${e.at}-${i}`} style={st.tlRow}>
          <View style={st.tlRail}>
            <View style={[st.tlDot, i === items.length - 1 && { backgroundColor: colors.primary, borderColor: colors.primary }]} />
            {i < items.length - 1 ? <View style={st.tlLine} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: 10 }}>
            <Text style={st.tlTitle}>{e.label}</Text>
            <Text style={st.tlMeta}>{timeLabel(e.at)}{e.reason ? ` · ${e.reason}` : ''}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function HeldExplainer({ compact }) {
  return (
    <View style={st.held}>
      <Icon name="shield" size={16} color={colors.positive} />
      <Text style={st.heldText}>{compact ? 'Paid to BibleNestra, held safely, paid out after checks.' : HELD_EXPLAINER}</Text>
    </View>
  );
}

// =============================================================================================
// Credits card for the create / edit wizard and the organiser view
// =============================================================================================
export function FundMeCreditsCard({ refreshKey, style }) {
  const fm = useFundMe();
  const nav = useNav();
  const [c, setC] = useState(null);
  const [buy, setBuy] = useState(false);
  const load = useCallback(async () => { try { setC(await fm.credits()); } catch (e) { setC(null); } }, [fm]);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!c) return null;
  if (c.demo || !c.cost) return <View style={style}><Notice text={c.explain} /></View>;
  const enough = c.available >= c.cost;
  return (
    <View style={[st.creditCard, style, !enough && { borderColor: alpha(colors.negative, 0.4) }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={st.creditIcon}><Icon name="heart" size={18} color="#B5523B" /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.creditTitle}>Publishing uses {c.cost} Fund Me credit{c.cost === 1 ? '' : 's'}</Text>
          <Text style={st.creditSub}>
            You have <Text style={{ fontWeight: '800', color: colors.fg }}>{c.balance}</Text>{c.reserved ? ` · ${c.reserved} set aside for requests in review` : ''}
          </Text>
        </View>
      </View>
      <Text style={st.creditNote}>The credit is only used when our team approves your request and it goes live. If it isn’t approved, nothing is used.</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Button small label={enough ? 'Buy more' : 'Buy credits'} onPress={() => setBuy(true)} style={{ flex: 1 }} kind={enough ? 'ghost' : 'primary'} />
        <Button small kind="ghost" label="Credits & history" onPress={() => nav.push('FundMeCredits')} style={{ flex: 1 }} />
      </View>
      {!enough ? <Text style={st.short}>You need {c.cost - Math.max(0, c.available)} more credit{c.cost - c.available === 1 ? '' : 's'} to submit — or ask a friend to send you one.</Text> : null}
      <BuyCoinsSheet visible={buy} wallet="fundme_credits" onClose={() => setBuy(false)} onPurchased={() => { setBuy(false); walletChanged(); load(); }} />
    </View>
  );
}

// =============================================================================================
// Credits
// =============================================================================================
export function FundMeCreditsScreen() {
  const fm = useFundMe();
  const nav = useNav();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [hist, setHist] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [buy, setBuy] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      const [cr, h] = await Promise.all([fm.credits(), fm.creditHistory()]);
      setC(cr); setHist(h.items); setCursor(h.nextCursor); setError(null);
    } catch (e) { setError(errorMessage(e, 'Couldn’t load your credits')); }
  }, [fm]);
  useLoad(load);
  const more = async () => {
    try { const h = await fm.creditHistory(cursor); setHist((x) => [...x, ...h.items]); setCursor(h.nextCursor); } catch (e) { toast.show(errorMessage(e), { tone: 'error' }); }
  };
  return (
    <Screen title="Fund Me credits" back>
      {error ? <Notice text={error} tint={colors.negative} /> : null}
      {!c ? <Shimmer style={{ height: 180, borderRadius: radius.lg }} /> : (
        <FadeInUp>
          <View style={st.hero}>
            <Eyebrow tint={colors.goldLight}>Your balance</Eyebrow>
            <Text style={st.heroNum}>{c.balance}</Text>
            <Text style={st.heroSub}>Fund Me request credit{c.balance === 1 ? '' : 's'}{c.reserved ? ` · ${c.reserved} set aside for requests in review` : ''}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <PressScale onPress={() => setBuy(true)} scaleTo={0.96} style={st.heroBtn} accessibilityLabel="Buy credits">
                <Icon name="plus" size={15} color={colors.night} strokeWidth={2.4} /><Text style={st.heroBtnText}>Buy credits</Text>
              </PressScale>
              <PressScale onPress={() => nav.push('FundMeGiftCredits')} scaleTo={0.96} style={[st.heroBtn, st.heroBtnGhost]} accessibilityLabel="Send credits to a friend">
                <Icon name="gift" size={15} color="#FFFFFF" /><Text style={[st.heroBtnText, { color: '#FFFFFF' }]}>Send to a friend</Text>
              </PressScale>
            </View>
          </View>
        </FadeInUp>
      )}
      {c && !c.demo ? (
        <Card style={{ marginTop: 14 }}>
          <Text style={st.h3}>How credits work</Text>
          <Text style={st.body}>{c.explain}</Text>
          <Text style={st.body}>Credits are not money. You can send them to another member, but they can’t be withdrawn as cash or resold.</Text>
          {c.limits ? (
            <View style={st.kpis}>
              <Kpi label="Today" value={`${c.usage.today || 0}${c.limits.perDay ? ` / ${c.limits.perDay}` : ''}`} />
              <Kpi label="Last 30 days" value={`${c.usage.month || 0}${c.limits.perMonth ? ` / ${c.limits.perMonth}` : ''}`} />
              <Kpi label="Active" value={`${c.usage.active || 0}${c.limits.maxActive ? ` / ${c.limits.maxActive}` : ''}`} />
            </View>
          ) : null}
        </Card>
      ) : null}
      <Section title="History" style={{ marginTop: 22 }}>
        {hist === null ? <Shimmer style={{ height: 120, borderRadius: radius.lg }} /> : hist.length ? (
          <Card style={{ paddingVertical: 4 }}>
            {hist.map((e, i) => (
              <View key={e.id} style={[st.row, i > 0 && st.rowBorder]}>
                <View style={[st.rowIcon, { backgroundColor: alpha(e.amount > 0 ? colors.positive : colors.gold, 0.12) }]}>
                  <Icon name={e.kind.includes('gift') ? 'gift' : e.kind === 'fundme_publish' ? 'check' : 'coin'} size={15} color={e.amount > 0 ? colors.positive : colors.gold} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{KIND_LABEL[e.kind] || e.label}{e.counterparty ? ` · ${e.counterparty.name || 'member'}` : ''}</Text>
                  <Text style={st.rowMeta}>{timeLabel(e.createdAt)}{e.meta && e.meta.title ? ` · ${e.meta.title}` : ''}</Text>
                </View>
                <Text style={[st.rowAmt, { color: e.amount > 0 ? colors.positive : colors.fg }]}>{e.amount > 0 ? '+' : ''}{e.amount}</Text>
              </View>
            ))}
            {cursor ? <Button kind="ghost" small label="Show more" onPress={more} style={{ margin: 10 }} /> : null}
          </Card>
        ) : <Empty title="No credit activity yet" body="Buy credits to publish a Fund Me request, or receive some from a friend." />}
      </Section>
      <BuyCoinsSheet visible={buy} wallet="fundme_credits" onClose={() => setBuy(false)} onPurchased={() => { setBuy(false); walletChanged(); load(); }} />
    </Screen>
  );
}

// =============================================================================================
// Gift credits
// =============================================================================================
export function FundMeGiftCreditsScreen() {
  const fm = useFundMe();
  const nav = useNav();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [to, setTo] = useState(null);
  const [n, setN] = useState(1);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const key = useRef(newIdempotencyKey());
  useEffect(() => { fm.credits().then(setC).catch(() => {}); }, [fm]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try { const r = await fm.members(q.trim()); if (live) setFound(r.items); } catch (e) { if (live) setFound([]); }
      if (live) setSearching(false);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, fm]);
  const max = c ? Math.max(1, Math.min(c.giftMax || 100, c.balance || 1)) : 1;
  const pick = (u) => { setTo(u); key.current = newIdempotencyKey(); };
  return (
    <Screen title="Send Fund Me credits" back>
      <Notice text="Credits only — this sends Fund Me request credits, not money. The person can use them to publish their own request. Credits can’t be withdrawn or resold." />
      <Text style={st.label}>Who are you sending to?</Text>
      {to ? (
        <View style={[st.card, st.pickRow]}>
          <View style={st.avatar}><Text style={st.avatarText}>{(to.displayName || '?').slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Text style={st.rowTitle}>{to.displayName}</Text>{to.handle ? <Text style={st.rowMeta}>@{to.handle}</Text> : null}</View>
          <Pressable onPress={() => setTo(null)} hitSlop={10} accessibilityLabel="Choose someone else"><Text style={st.link}>Change</Text></Pressable>
        </View>
      ) : (
        <>
          <View style={st.search}>
            <Icon name="search" size={16} color={colors.faint} />
            <TextInput value={q} onChangeText={setQ} placeholder="Name or @handle" placeholderTextColor={colors.faint} style={st.searchInput} autoCapitalize="none" accessibilityLabel="Search members" />
            {searching ? <ActivityIndicator size="small" color={colors.muted} /> : null}
          </View>
          {found.map((u) => (
            <PressScale key={u.id} onPress={() => pick(u)} scaleTo={0.98} style={[st.card, st.pickRow, { marginTop: 8 }]} accessibilityLabel={`Send to ${u.displayName}`}>
              <View style={st.avatar}><Text style={st.avatarText}>{(u.displayName || '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={st.rowTitle}>{u.displayName}</Text>{u.handle ? <Text style={st.rowMeta}>@{u.handle}</Text> : null}</View>
              <Icon name="plus" size={16} color={colors.primary} />
            </PressScale>
          ))}
          {q.trim().length >= 2 && !searching && !found.length ? <Text style={[st.rowMeta, { marginTop: 8 }]}>No members found.</Text> : null}
        </>
      )}
      <Text style={st.label}>How many credits?</Text>
      <View style={st.stepper}>
        <PressScale onPress={() => setN((x) => Math.max(1, x - 1))} scaleTo={0.9} style={st.stepBtn} accessibilityLabel="Fewer"><Text style={st.stepBtnText}>−</Text></PressScale>
        <Text style={st.stepNum}>{n}</Text>
        <PressScale onPress={() => setN((x) => Math.min(max, x + 1))} scaleTo={0.9} style={st.stepBtn} accessibilityLabel="More"><Text style={st.stepBtnText}>+</Text></PressScale>
        <Text style={[st.rowMeta, { marginLeft: 8, flex: 1 }]}>You have {c ? c.balance : '…'}</Text>
      </View>
      <Text style={st.label}>Note (optional)</Text>
      <Input value={note} onChangeText={setNote} placeholder="A word of encouragement" maxLength={140} />
      <Button label={to ? `Send ${n} credit${n === 1 ? '' : 's'} to ${to.displayName}` : 'Choose someone first'} disabled={!to} onPress={() => setConfirm(true)} style={{ marginTop: 18 }} icon={<Icon name="gift" size={16} color="#FFFFFF" />} />
      <ConfirmSpend
        visible={confirm}
        amount={n}
        wallet="fundme_credits"
        title={to ? `Send ${n} credit${n === 1 ? '' : 's'} to ${to.displayName}?` : 'Send credits'}
        description="They arrive straight away. Credits only — not cash, can’t be withdrawn or resold."
        confirmLabel="Send credits"
        onConfirm={() => fm.giftCredits({ recipientId: to.id, amount: n, idempotencyKey: key.current, note: note.trim() || undefined })}
        onClose={() => setConfirm(false)}
        onDone={() => { toast.show(`Sent ${n} credit${n === 1 ? '' : 's'} to ${to.displayName}`, { icon: 'gift', haptic: 'success' }); key.current = newIdempotencyKey(); nav.pop(); }}
      />
    </Screen>
  );
}

// =============================================================================================
// Organiser: money & payouts
// =============================================================================================
export function FundMeMoneyScreen({ params = {} }) {
  const fm = useFundMe();
  const nav = useNav();
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    try { setM(await fm.money(params.id || params.fundraiserId)); setError(null); } catch (e) { setError(errorMessage(e, 'Couldn’t load donations and payouts')); }
  }, [fm, params.id, params.fundraiserId]);
  useLoad(load);
  if (!m) {
    return (
      <Screen title="Money & payouts" subtitle={params.title} back>
        {error ? <Empty title="Not available" body={error} action="Try again" onAction={load} /> : <Shimmer style={{ height: 240, borderRadius: radius.lg }} />}
      </Screen>
    );
  }
  const cur = m.currency; const t = m.totals; const fmt = (x) => formatMoney(x, cur);
  const bank = m.bankAccount;
  return (
    <Screen title="Money & payouts" subtitle={params.title} back>
      <FadeInUp><HeldExplainer /></FadeInUp>
      <FadeInUp index={1}>
        <View style={st.kpis}>
          <Kpi label="Received" value={fmt(t.receivedMinor)} />
          <Kpi label="Being checked" value={fmt(t.checkingMinor + t.verifiedMinor)} tint={colors.gold} />
          <Kpi label="Paid to you" value={fmt(t.paidMinor)} tint={colors.positive} />
        </View>
        <View style={st.kpis}>
          <Kpi label="Ready to pay" value={fmt(t.approvedMinor)} />
          <Kpi label="Fees" value={fmt(t.feesMinor)} />
          <Kpi label="Refunded" value={fmt(t.refundedMinor)} />
        </View>
        <Text style={st.rowMeta}>{m.rules.scheduleText || `Payouts are made after a ${m.rules.holdDays}-day hold and our checks.`}{m.rules.nextPayoutRun ? ` Next payout run: ${dateLabel(m.rules.nextPayoutRun)}.` : ''} Minimum payout {fmt(m.rules.minPayoutMinor)}. All amounts are in Naira.{m.rules.feeBps || m.rules.feeFixedMinor ? ` BibleNestra fee: ${m.rules.feeBps / 100}%${m.rules.feeFixedMinor ? ` + ${fmt(m.rules.feeFixedMinor)}` : ''} per donation, plus payment processing and VAT unless the donor covers them.` : ' No BibleNestra fee.'}</Text>
      </FadeInUp>

      <Section title="Your bank account" style={{ marginTop: 22 }}>
        <PressScale onPress={() => nav.push('FundMePayoutAccount')} scaleTo={0.98} style={[st.card, st.pickRow]} accessibilityLabel="Bank account for payouts">
          <View style={[st.rowIcon, { backgroundColor: alpha(colors.primary, 0.1) }]}><Icon name="lock" size={15} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            {bank ? (
              <>
                <Text style={st.rowTitle}>{bank.bankName} {bank.accountNumberMasked}</Text>
                <Text style={st.rowMeta}>{bank.accountName} · {bank.status === 'verified' ? 'Verified' : bank.status === 'rejected' ? `Needs changes${bank.reviewNote ? `: ${bank.reviewNote}` : ''}` : 'Being checked by our team'}</Text>
              </>
            ) : (
              <>
                <Text style={st.rowTitle}>Add your bank account</Text>
                <Text style={st.rowMeta}>Needed before we can pay out your donations</Text>
              </>
            )}
          </View>
          <Icon name="edit" size={15} color={colors.muted} />
        </PressScale>
      </Section>

      <Section title="Identity check (KYC)" style={{ marginTop: 22 }}>
        <PressScale onPress={() => nav.push('PayoutKyc')} scaleTo={0.98} style={[st.card, st.pickRow]} accessibilityLabel="Identity check for payouts">
          <View style={[st.rowIcon, { backgroundColor: alpha(colors.primary, 0.1) }]}><Icon name="shield" size={15} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.rowTitle}>{m.kyc && m.kyc.status !== 'none' ? m.kyc.statusLabel : 'Verify your identity'}</Text>
            <Text style={st.rowMeta}>{m.kyc && m.kyc.approved ? `${m.kyc.idTypeLabel} ${m.kyc.idNumberMasked} · ${m.kyc.legalName}` : 'Needed before any payout: your BVN, NIN or national ID and a bank account in your name'}</Text>
          </View>
          <Icon name="chevron-right" size={15} color={colors.muted} />
        </PressScale>
      </Section>

      <Section title="Payouts" style={{ marginTop: 22 }}>
        {m.payouts.length ? m.payouts.map((p) => (
          <Card key={p.id} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[st.rowAmt, { flex: 1, textAlign: 'left' }]}>{formatMoney(p.amountMinor, p.currency)}</Text>
              <StatusPill map={PAYOUT_STATUS} status={p.status} />
            </View>
            <Text style={st.rowMeta}>{p.donations} donation{p.donations === 1 ? '' : 's'}{p.bank ? ` · to ${p.bank.bankName} •••• ${p.bank.last4}` : ''}{p.reference ? ` · ref ${p.reference}` : ''}</Text>
            {p.status === 'failed' && p.failureReason ? <Text style={st.short}>{p.failureReason}</Text> : null}
            <Timeline items={p.timeline} />
          </Card>
        )) : <Empty title="No payouts yet" body="When donations are verified and the hold period has passed, our team approves a payout to your bank account. You’ll be notified when it’s paid." />}
      </Section>

      <Section title="Donations" style={{ marginTop: 22 }}>
        {m.donations.length ? (
          <Card style={{ paddingVertical: 4 }}>
            {m.donations.map((d, i) => (
              <Pressable key={d.id} onPress={() => setOpen(open === d.id ? null : d.id)} style={[st.row, i > 0 && st.rowBorder, { flexWrap: 'wrap' }]} accessibilityLabel={`Donation from ${d.name}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{d.name}{d.anonymous ? ' (anonymous publicly)' : ''}{d.test ? ' · test' : ''}</Text>
                  <Text style={st.rowMeta}>{timeLabel(d.receivedAt || d.createdAt)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={st.rowAmt}>{formatMoney(d.amountMinor, d.currency)}</Text>
                  <StatusPill map={DONATION_STATUS} status={d.status} />
                </View>
                {open === d.id ? (
                  <View style={{ width: '100%', marginTop: 8 }}>
                    {d.message ? <Text style={st.body}>“{d.message}”</Text> : null}
                    <Text style={st.rowMeta}>
                      {d.original && d.original.currency !== d.currency ? `Gave ${moneyAny(d.original.amountMinor, d.original.currency)} · ` : ''}
                      Fees {formatMoney(d.fees ? d.fees.totalMinor : d.feeMinor, d.currency)}{d.coverFees ? ' (covered by the donor)' : ''} · for you {formatMoney(d.netMinor, d.currency)}
                      {d.payoutRun ? ` · payout run ${dateLabel(d.payoutRun)}` : ''}{d.receiptNo ? ` · receipt ${d.receiptNo}` : ''}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </Card>
        ) : <Empty title="No donations yet" body="Share your link — every donation shows here with its status." />}
      </Section>
    </Screen>
  );
}

// =============================================================================================
// Organiser: bank account for payouts
// =============================================================================================
export function FundMePayoutAccountScreen() {
  const fm = useFundMe();
  const nav = useNav();
  const toast = useToast();
  const [cur, setCur] = useState(undefined);
  const [canResolve, setCanResolve] = useState(false);
  const [banks, setBanks] = useState([]);
  const [bankQ, setBankQ] = useState('');
  const [bank, setBank] = useState(null);
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [resolved, setResolved] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([fm.payoutAccount(), fm.banks()]).then(([a, b]) => {
      setCur(a.account); setCanResolve(!!a.canResolve); setBanks(b.banks || []);
      if (a.account) setBank({ code: a.account.bankCode, name: a.account.bankName });
    }).catch((e) => { setErr(errorMessage(e, 'Couldn’t load your bank details')); setCur(null); });
  }, [fm]);
  const shown = bankQ.trim() ? banks.filter((b) => b.name.toLowerCase().includes(bankQ.trim().toLowerCase())) : banks;
  const check = async () => {
    setErr(null); setBusy('check');
    try {
      const r = await fm.resolveAccount({ bankCode: bank.code, accountNumber: num });
      if (r.resolved) { setResolved(r.accountName); setName(r.accountName); } else toast.show(r.message, { icon: 'shield', duration: 4200 });
    } catch (e) { setErr(errorMessage(e, 'Couldn’t check that account')); setResolved(null); }
    setBusy(null);
  };
  const save = async () => {
    setErr(null);
    if (!bank) return setErr('Choose your bank');
    if (!/^\d{10}$/.test(num)) return setErr('Enter your 10-digit account number');
    if (!resolved && name.trim().length < 2) return setErr('Enter the account name exactly as your bank shows it');
    setBusy('save');
    try {
      const r = await fm.savePayoutAccount({ bankCode: bank.code, accountNumber: num, accountName: name.trim() });
      setCur(r.account); setNum(''); setResolved(null);
      toast.show('Saved — our team will check it before any payout', { icon: 'shield', duration: 3600 });
      nav.pop();
    } catch (e) { setErr(errorMessage(e, 'Couldn’t save')); }
    setBusy(null);
  };
  if (cur === undefined) return <Screen title="Bank account" back><Shimmer style={{ height: 200, borderRadius: radius.lg }} /></Screen>;
  return (
    <Screen title="Bank account for payouts" back>
      <Notice text="We only pay out to an account in your name. Your account number is stored encrypted and shown only as its last 4 digits. Every new or changed account is checked by our team, and payouts wait until then." />
      <PressScale onPress={() => nav.push('PayoutKyc')} scaleTo={0.98} style={[st.card, st.pickRow, { marginTop: 12 }]} accessibilityLabel="Identity check (KYC)">
        <View style={[st.rowIcon, { backgroundColor: alpha(colors.primary, 0.1) }]}><Icon name="shield" size={15} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.rowTitle}>Identity check (KYC)</Text>
          <Text style={st.rowMeta}>Required before any payout. Submitting it also sets this bank account.</Text>
        </View>
        <Icon name="chevron-right" size={15} color={colors.muted} />
      </PressScale>
      {cur ? (
        <Card style={{ marginTop: 14 }}>
          <Eyebrow>Current account</Eyebrow>
          <Text style={st.rowTitle}>{cur.bankName} {cur.accountNumberMasked}</Text>
          <Text style={st.rowMeta}>{cur.accountName}{cur.nameResolved ? ' · name confirmed by the bank' : ''}</Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Badge label={cur.status === 'verified' ? 'Verified' : cur.status === 'rejected' ? 'Needs changes' : 'Being checked'} tint={cur.status === 'verified' ? colors.positive : cur.status === 'rejected' ? colors.negative : colors.gold} />
          </View>
          {cur.reviewNote ? <Text style={st.short}>{cur.reviewNote}</Text> : null}
        </Card>
      ) : null}
      <Text style={st.label}>{cur ? 'Change to a different account' : 'Bank'}</Text>
      {bank ? (
        <View style={[st.card, st.pickRow]}>
          <Text style={[st.rowTitle, { flex: 1 }]}>{bank.name}</Text>
          <Pressable onPress={() => { setBank(null); setResolved(null); }} hitSlop={10}><Text style={st.link}>Change</Text></Pressable>
        </View>
      ) : (
        <>
          <View style={st.search}>
            <Icon name="search" size={16} color={colors.faint} />
            <TextInput value={bankQ} onChangeText={setBankQ} placeholder="Search your bank" placeholderTextColor={colors.faint} style={st.searchInput} accessibilityLabel="Search banks" />
          </View>
          <View style={[st.card, { paddingVertical: 2, marginTop: 8, maxHeight: 240 }]}>
            {shown.slice(0, 40).map((b, i) => (
              <Pressable key={b.code} onPress={() => { setBank(b); setResolved(null); }} style={[st.row, i > 0 && st.rowBorder]} accessibilityLabel={b.name}>
                <Text style={st.rowTitle}>{b.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <Text style={st.label}>Account number (NUBAN)</Text>
      <Input value={num} onChangeText={(t) => { setNum(t.replace(/\D/g, '').slice(0, 10)); setResolved(null); }} placeholder="10 digits" keyboardType="number-pad" maxLength={10} />
      {canResolve ? <Button kind="ghost" small label={busy === 'check' ? 'Checking…' : 'Check account name'} disabled={!bank || num.length !== 10 || !!busy} onPress={check} style={{ marginTop: 8 }} /> : null}
      <Text style={st.label}>Account name</Text>
      {resolved ? (
        <View style={[st.card, st.pickRow]}><Icon name="check" size={16} color={colors.positive} /><Text style={[st.rowTitle, { flex: 1 }]}>{resolved}</Text><Text style={st.rowMeta}>from your bank</Text></View>
      ) : <Input value={name} onChangeText={setName} placeholder="Exactly as your bank shows it" maxLength={120} />}
      {err ? <Text style={st.short}>{err}</Text> : null}
      <Button label={busy === 'save' ? 'Saving…' : 'Save bank account'} disabled={!!busy} onPress={save} style={{ marginTop: 18 }} icon={<Icon name="lock" size={15} color="#FFFFFF" />} />
    </Screen>
  );
}

// =============================================================================================
// Payout KYC — Fund Me payouts and gift-earnings withdrawals (backend/src/lib/kyc.js)
// =============================================================================================
export function PayoutKycScreen() {
  const fm = useFundMe();
  const nav = useNav();
  const toast = useToast();
  const [k, setK] = useState(undefined);
  const [info, setInfo] = useState(null);
  const [banks, setBanks] = useState([]);
  const [idType, setIdType] = useState('nin');
  const [idNumber, setIdNumber] = useState('');
  const [legal, setLegal] = useState('');
  const [bankQ, setBankQ] = useState('');
  const [bank, setBank] = useState(null);
  const [num, setNum] = useState('');
  const [accName, setAccName] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([fm.kyc(), fm.banks()]).then(([a, b]) => {
      setInfo(a); setK(a.kyc); setBanks(b.banks || []);
      if (a.kyc && a.kyc.status !== 'none') { setIdType(a.kyc.idType); setLegal(a.kyc.legalName); setBank({ code: a.kyc.bankCode, name: a.kyc.bankName }); }
      setEditing(!a.kyc || a.kyc.status === 'none' || a.kyc.status === 'rejected');
    }).catch((e) => { setErr(errorMessage(e, 'Couldn’t load your identity check')); setK(null); });
  }, [fm]);
  const shown = bankQ.trim() ? banks.filter((b) => b.name.toLowerCase().includes(bankQ.trim().toLowerCase())) : banks;
  const submit = async () => {
    setErr(null);
    if (idType !== 'national_id' && !/^\d{11}$/.test(idNumber)) return setErr(`Your ${idType === 'bvn' ? 'BVN' : 'NIN'} is 11 digits`);
    if (idType === 'national_id' && idNumber.trim().length < 4) return setErr('Enter your ID number');
    if (legal.trim().split(/\s+/).length < 2) return setErr('Enter your full legal name (first name and surname)');
    if (!bank) return setErr('Choose your bank');
    if (!/^\d{10}$/.test(num)) return setErr('Enter your 10-digit account number');
    if (!(info && info.canResolve) && accName.trim().length < 2) return setErr('Enter the account name exactly as your bank shows it');
    setBusy(true);
    try {
      const r = await fm.saveKyc({ idType, idNumber: idNumber.trim(), legalName: legal.trim(), bankCode: bank.code, accountNumber: num, accountName: accName.trim() || legal.trim() });
      setK(r.kyc); setEditing(false); setIdNumber(''); setNum('');
      toast.show('Submitted — our team will check it', { icon: 'shield', duration: 3600 });
    } catch (e) { setErr(errorMessage(e, 'Couldn’t submit')); }
    setBusy(false);
  };
  if (k === undefined) return <Screen title="Identity check" back><Shimmer style={{ height: 220, borderRadius: radius.lg }} /></Screen>;
  const status = (k && k.status) || 'none';
  return (
    <Screen title="Identity check (KYC)" back>
      <Notice text={(info && info.explain) || 'Before BibleNestra pays out Fund Me donations or gift earnings, we check who you are.'} />
      {status !== 'none' ? (
        <Card style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[st.rowTitle, { flex: 1 }]}>{k.legalName}</Text>
            <Badge label={k.statusLabel} tint={KYC_TINT[status]} />
          </View>
          <Text style={st.rowMeta}>{k.idTypeLabel} {k.idNumberMasked}</Text>
          <Text style={st.rowMeta}>{k.bankName} {k.accountNumberMasked} · {k.accountName}{k.nameResolved ? ' (from your bank)' : ''}</Text>
          {k.reviewNote ? <Text style={st.short}>{k.reviewNote}</Text> : null}
          {!editing ? <Button kind="ghost" small label="Update my details" onPress={() => setEditing(true)} style={{ marginTop: 10 }} /> : null}
        </Card>
      ) : null}
      {editing ? (
        <>
          <Text style={st.label}>ID type</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {((info && info.idTypes) || [{ value: 'bvn', label: 'BVN' }, { value: 'nin', label: 'NIN' }, { value: 'national_id', label: 'Other national ID' }]).map((t) => (
              <PressScale key={t.value} onPress={() => setIdType(t.value)} scaleTo={0.95} style={[st.card, { paddingVertical: 8, paddingHorizontal: 12 }, idType === t.value && { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.08) }]} accessibilityLabel={t.label}>
                <Text style={[st.rowTitle, { fontSize: 13 }]}>{t.value === 'national_id' ? 'Other national ID' : t.value.toUpperCase()}</Text>
              </PressScale>
            ))}
          </View>
          <Text style={st.label}>{idType === 'bvn' ? 'BVN' : idType === 'nin' ? 'NIN' : 'ID number'}</Text>
          <Input value={idNumber} onChangeText={(t) => setIdNumber(idType === 'national_id' ? t.replace(/[^A-Za-z0-9]/g, '').slice(0, 30) : t.replace(/\D/g, '').slice(0, 11))} placeholder={idType === 'national_id' ? 'As printed on your ID' : '11 digits'} keyboardType={idType === 'national_id' ? 'default' : 'number-pad'} autoCapitalize="characters" />
          <Text style={st.label}>Legal name</Text>
          <Input value={legal} onChangeText={setLegal} placeholder="As on your ID — first name and surname" maxLength={120} />
          <Text style={st.label}>Bank</Text>
          {bank ? (
            <View style={[st.card, st.pickRow]}>
              <Text style={[st.rowTitle, { flex: 1 }]}>{bank.name}</Text>
              <Pressable onPress={() => setBank(null)} hitSlop={10}><Text style={st.link}>Change</Text></Pressable>
            </View>
          ) : (
            <>
              <View style={st.search}>
                <Icon name="search" size={16} color={colors.faint} />
                <TextInput value={bankQ} onChangeText={setBankQ} placeholder="Search your bank" placeholderTextColor={colors.faint} style={st.searchInput} accessibilityLabel="Search banks" />
              </View>
              <View style={[st.card, { paddingVertical: 2, marginTop: 8, maxHeight: 220 }]}>
                {shown.slice(0, 40).map((b, i) => (
                  <Pressable key={b.code} onPress={() => setBank(b)} style={[st.row, i > 0 && st.rowBorder]} accessibilityLabel={b.name}>
                    <Text style={st.rowTitle}>{b.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <Text style={st.label}>Account number (NUBAN)</Text>
          <Input value={num} onChangeText={(t) => setNum(t.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits — an account in your own name" keyboardType="number-pad" maxLength={10} />
          {!(info && info.canResolve) ? (
            <>
              <Text style={st.label}>Account name</Text>
              <Input value={accName} onChangeText={setAccName} placeholder="Exactly as your bank shows it" maxLength={120} />
            </>
          ) : <Text style={st.rowMeta}>We check the account name with your bank. It must match your legal name (any order; middle names don’t matter).</Text>}
          {err ? <Text style={st.short}>{err}</Text> : null}
          <Button label={busy ? 'Submitting…' : 'Submit for review'} disabled={busy} onPress={submit} style={{ marginTop: 18 }} icon={<Icon name="shield" size={15} color="#FFFFFF" />} />
          <Text style={[st.rowMeta, { marginTop: 10 }]}>Your ID and account numbers are stored encrypted and shown only as their last digits.</Text>
        </>
      ) : null}
      {status === 'approved' ? <Button kind="ghost" label="Done" onPress={() => nav.pop()} style={{ marginTop: 16 }} /> : null}
    </Screen>
  );
}

// =============================================================================================
// Donor: my donations + receipt
// =============================================================================================
export function FundMeMyDonationsScreen() {
  const fm = useFundMe();
  const nav = useNav();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setItems((await fm.myDonations()).items); setError(null); } catch (e) { setError(errorMessage(e, 'Couldn’t load your donations')); }
  }, [fm]);
  useLoad(load);
  return (
    <Screen title="My donations" back>
      <HeldExplainer compact />
      {error ? <Notice text={error} tint={colors.negative} /> : null}
      <View style={{ marginTop: 14 }}>
        {items === null ? <Shimmer style={{ height: 160, borderRadius: radius.lg }} /> : items.length ? (
          <Card style={{ paddingVertical: 4 }}>
            {items.map((d, i) => (
              <PressScale key={d.id} onPress={() => (d.receiptNo ? nav.push('FundMeReceipt', { donationId: d.id }) : null)} scaleTo={0.99} style={[st.row, i > 0 && st.rowBorder]} accessibilityLabel={`Donation to ${d.fundraiserTitle}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{d.fundraiserTitle}</Text>
                  <Text style={st.rowMeta}>{dateLabel(d.receivedAt || d.createdAt)}{d.receiptNo ? ' · tap for receipt' : ''}{d.test ? ' · test' : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={st.rowAmt}>{d.original ? moneyAny(d.original.amountMinor, d.original.currency) : formatMoney(d.amountMinor, d.currency)}</Text>
                  <StatusPill map={DONATION_STATUS} status={d.status} />
                </View>
              </PressScale>
            ))}
          </Card>
        ) : <Empty title="No donations yet" body="When you give to a Fund Me request, your receipts appear here." action="Discover fundraisers" onAction={() => nav.push('FundMe')} />}
      </View>
    </Screen>
  );
}

export function FundMeReceiptScreen({ params = {} }) {
  const fm = useFundMe();
  const nav = useNav();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setR(await fm.receipt(params.donationId)); setError(null); } catch (e) { setError(errorMessage(e, 'Couldn’t load the receipt')); }
  }, [fm, params.donationId]);
  useLoad(load);
  if (!r) return <Screen title="Receipt" back>{error ? <Empty title="Receipt not available" body={error} action="Try again" onAction={load} /> : <Shimmer style={{ height: 300, borderRadius: radius.lg }} />}</Screen>;
  const line = (k, v, strong, oneLine) => (
    <View style={st.rLine}><Text style={st.rKey}>{k}</Text><Text style={[st.rVal, strong && { fontWeight: '800', fontSize: 16 }]} numberOfLines={oneLine ? 1 : undefined} ellipsizeMode="middle" selectable>{v}</Text></View>
  );
  return (
    <Screen title="Donation receipt" back>
      <FadeInUp>
        <View style={st.receipt}>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={st.receiptIcon}><Icon name="heart" size={22} color="#FFFFFF" /></View>
            <Text style={st.receiptTitle}>Thank you for your gift</Text>
            <Text style={st.rowMeta}>{r.test ? 'TEST — no money moved · ' : ''}Receipt {r.receiptNo}</Text>
          </View>
          {r.breakdown ? r.breakdown.filter((b) => b.value).map((b, i) => <React.Fragment key={b.label}>{line(b.label, b.value, i === 0)}</React.Fragment>) : (
            <>
              {line('Amount', formatMoney(r.amountMinor, r.currency), true)}
              {r.feeMinor ? line('BibleNestra fee', formatMoney(r.feeMinor, r.currency)) : null}
              {line('For the organiser', formatMoney(r.netMinor, r.currency))}
            </>
          )}
          {r.breakdown ? line('Fees', r.coverFees ? 'Covered by you' : 'Taken from the gift') : null}
          {line('Request', r.request.title)}
          {r.beneficiary ? line('Organiser', r.beneficiary) : null}
          {line('Date', timeLabel(r.date))}
          {line('Paid to', r.paidTo)}
          {line('Method', r.method)}
          {line('Reference', r.reference, false, true)}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <Text style={st.rKey}>Status</Text><StatusPill map={DONATION_STATUS} status={r.status} />
          </View>
        </View>
      </FadeInUp>
      <Text style={[st.body, { marginTop: 14 }]}>{r.note}</Text>
      {r.refundPolicy ? <Text style={[st.rowMeta, { marginTop: 8 }]}>{r.refundPolicy}</Text> : null}
      <Section title="What happened" style={{ marginTop: 18 }}><Card><Timeline items={r.timeline} /></Card></Section>
      <Button kind="ghost" label="Open the request" onPress={() => nav.push('Fundraiser', { id: r.request.id })} style={{ marginTop: 16 }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow.sm },
  hero: { backgroundColor: colors.night || '#15172B', borderRadius: radius.xl, padding: 20, overflow: 'hidden' },
  heroNum: { fontFamily: fonts.display, fontSize: 52, color: '#FFFFFF', marginTop: 4 },
  heroSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13.5 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.goldLight || '#E8C77E', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill },
  heroBtnGhost: { backgroundColor: 'rgba(255,255,255,0.12)' },
  heroBtnText: { fontWeight: '800', color: colors.night || '#15172B', fontSize: 13.5 },
  h3: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, marginBottom: 6 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  label: { color: colors.muted, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 18, marginBottom: 8 },
  link: { color: colors.primary, fontWeight: '800' },
  kpis: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 6 },
  kpi: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  kpiValue: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg },
  kpiLabel: { color: colors.muted, fontSize: 11.5, marginTop: 2, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.fg, fontWeight: '700', fontSize: 14.5 },
  rowMeta: { color: colors.muted, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  rowAmt: { color: colors.fg, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: alpha(colors.primary, 0.12), alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, height: 44 },
  searchInput: { flex: 1, color: colors.fg, fontSize: 15, outlineStyle: 'none' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  stepBtnText: { fontSize: 22, color: colors.fg, fontWeight: '700' },
  stepNum: { fontFamily: fonts.display, fontSize: 30, color: colors.fg, minWidth: 40, textAlign: 'center' },
  creditCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow.sm },
  creditIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: alpha('#B5523B', 0.12), alignItems: 'center', justifyContent: 'center' },
  creditTitle: { color: colors.fg, fontWeight: '800', fontSize: 14.5 },
  creditSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  creditNote: { color: colors.muted, fontSize: 12.5, lineHeight: 17, marginTop: 10 },
  short: { color: colors.negative, fontSize: 13, marginTop: 8, lineHeight: 18 },
  held: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: alpha(colors.positive, 0.08), borderRadius: radius.md, padding: 12, borderLeftWidth: 3, borderLeftColor: colors.positive },
  heldText: { flex: 1, color: colors.fg, fontSize: 13.5, lineHeight: 19 },
  tlRow: { flexDirection: 'row', gap: 10 },
  tlRail: { width: 14, alignItems: 'center' },
  tlDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginTop: 4 },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  tlTitle: { color: colors.fg, fontWeight: '700', fontSize: 13.5 },
  tlMeta: { color: colors.muted, fontSize: 12, marginTop: 1 },
  receipt: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 18, ...shadow.md },
  receiptIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.positive, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  receiptTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg },
  rLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border },
  rKey: { color: colors.muted, fontSize: 13, flexShrink: 0 },
  rVal: { color: colors.fg, fontSize: 13.5, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
