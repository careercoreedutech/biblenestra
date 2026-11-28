import { isDarkScheme } from '../design/palette';
// FUND ME MONEY (monetisation stage 2 — client spec §1 credits, §2 gifting credits, §3 donations and payouts).
//   FundMeCredits         balance, what a credit does, buy (BuyCoinsSheet), send to a friend, history
//   FundMeGiftCredits     pick a member → amount → ConfirmSpend → atomic transfer (credits only, never cash)
//   FundMeMoney           organiser: totals, donations with status, payouts with timelines, bank account
//   FundMePayoutAccount   organiser: bank + account number (+ name check with Paystack), masked, reviewed by staff
//   FundMeMyDonations     my donations; FundMeReceipt  one receipt with its fee breakdown and status history
//   PayoutKyc             identity check before any payout (Fund Me) or gift-earnings withdrawal: ID + legal name + bank
//   <FundMeCreditsCard/>  "Publishing uses 1 credit · you have N" + Buy, used by the create / edit wizard
// Server: backend/src/routes/fundmeMoney.js · docs: scratch/monetisation/fundme.md
// Look: the Figma design's language (src/design/sanctuary.js tokens, src/design/profile/parts.js, src/design/fundme/parts.js).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icons';
import { FadeInUp, Shimmer } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { errorMessage } from '../api/client';
import { BuyCoinsSheet, ConfirmSpend } from '../components/wallet';
import { walletChanged, newIdempotencyKey, dateLabel, timeLabel } from '../api/wallet';
import { useFundMe, onFundMeChange, formatMoney, DONATION_STATUS, PAYOUT_STATUS, HELD_EXPLAINER, SYMBOL } from '../api/fundme';
import { alpha } from '../components/ui';
import { d, df, Tap, Grad, Eyebrow, SectionTitle } from '../design/sanctuary';
import { DScreen, DCard, DInput, DLabel, DList, DRow } from '../design/profile/parts';
import { FBtn, FNotice, FEmpty, FBadge, FKpi } from '../design/fundme/parts';

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
  const sd = map[status] || { label: label || status, tint: colors.muted };
  return <FBadge label={label || sd.label} tint={sd.tint} />;
}

function Timeline({ items }) {
  if (!items || !items.length) return null;
  return (
    <View style={{ marginTop: 10 }}>
      {items.map((e, i) => (
        <View key={`${e.at}-${i}`} style={s.tlRow}>
          <View style={s.tlRail}>
            <View style={[s.tlDot, i === items.length - 1 && { backgroundColor: d.plum, borderColor: d.plum }]} />
            {i < items.length - 1 ? <View style={s.tlLine} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: 10 }}>
            <Text style={s.tlTitle}>{e.label}</Text>
            <Text style={s.tlMeta}>{timeLabel(e.at)}{e.reason ? ` · ${e.reason}` : ''}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function HeldExplainer({ compact }) {
  return <FNotice icon="shield" text={compact ? 'Paid to BibleNestra, held safely, paid out after checks.' : HELD_EXPLAINER} />;
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
  if (c.demo || !c.cost) return <View style={style}><FNotice tone="plum" text={c.explain} /></View>;
  const enough = c.available >= c.cost;
  return (
    <DCard style={[s.creditCard, style, !enough && { borderColor: alpha(colors.negative, 0.4) }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={s.creditIcon}><Icon name="heart" size={18} color="#B5523B" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.creditTitle}>Publishing uses {c.cost} Fund Me credit{c.cost === 1 ? '' : 's'}</Text>
          <Text style={s.creditSub}>
            You have <Text style={s.creditStrong}>{c.balance}</Text>{c.reserved ? ` · ${c.reserved} set aside for requests in review` : ''}
          </Text>
        </View>
      </View>
      <Text style={s.creditNote}>The credit is only used when our team approves your request and it goes live. If it isn’t approved, nothing is used.</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <FBtn small kind={enough ? 'ghost' : 'primary'} label={enough ? 'Buy more' : 'Buy credits'} onPress={() => setBuy(true)} style={{ flex: 1 }} />
        <FBtn small kind="ghost" label="Credits & history" onPress={() => nav.push('FundMeCredits')} style={{ flex: 1 }} />
      </View>
      {!enough ? <Text style={s.short}>You need {c.cost - Math.max(0, c.available)} more credit{c.cost - c.available === 1 ? '' : 's'} to submit — or ask a friend to send you one.</Text> : null}
      <BuyCoinsSheet visible={buy} wallet="fundme_credits" onClose={() => setBuy(false)} onPurchased={() => { setBuy(false); walletChanged(); load(); }} />
    </DCard>
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
    <DScreen title="Fund Me credits" back onBack={() => nav.pop()}>
      {error ? <FNotice text={error} tone="danger" /> : null}
      {!c ? <Shimmer style={{ height: 180, borderRadius: 24 }} /> : (
        <FadeInUp>
          <Grad colors={['#3C2518', '#8A4B25']} style={s.hero}>
            <Eyebrow light>Your balance</Eyebrow>
            <Text style={s.heroNum}>{c.balance}</Text>
            <Text style={s.heroSub}>Fund Me request credit{c.balance === 1 ? '' : 's'}{c.reserved ? ` · ${c.reserved} set aside for requests in review` : ''}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Tap onPress={() => setBuy(true)} style={s.heroBtn} accessibilityLabel="Buy credits">
                <Icon name="plus" size={15} color="#FFFFFF" strokeWidth={2.4} /><Text style={s.heroBtnText}>Buy credits</Text>
              </Tap>
              <Tap onPress={() => nav.push('FundMeGiftCredits')} style={[s.heroBtn, s.heroBtnGhost]} accessibilityLabel="Send credits to a friend">
                <Icon name="gift" size={15} color="#FFFFFF" /><Text style={s.heroBtnText}>Send to a friend</Text>
              </Tap>
            </View>
          </Grad>
        </FadeInUp>
      )}
      {c && !c.demo ? (
        <DCard style={{ marginTop: 14 }}>
          <Text style={s.h3}>How credits work</Text>
          <Text style={s.body}>{c.explain}</Text>
          <Text style={s.body}>Credits are not money. You can send them to another member, but they can’t be withdrawn as cash or resold.</Text>
          {c.limits ? (
            <View style={s.kpis}>
              <FKpi label="Today" value={`${c.usage.today || 0}${c.limits.perDay ? ` / ${c.limits.perDay}` : ''}`} />
              <FKpi label="Last 30 days" value={`${c.usage.month || 0}${c.limits.perMonth ? ` / ${c.limits.perMonth}` : ''}`} />
              <FKpi label="Active" value={`${c.usage.active || 0}${c.limits.maxActive ? ` / ${c.limits.maxActive}` : ''}`} />
            </View>
          ) : null}
        </DCard>
      ) : null}
      <SectionTitle title="History" />
      {hist === null ? <Shimmer style={{ height: 120, borderRadius: 20 }} /> : hist.length ? (
        <DCard style={{ padding: 0 }}>
          {hist.map((e, i) => (
            <View key={e.id} style={[s.row, i > 0 && s.rowBorder]}>
              <View style={[s.rowIconSm, { backgroundColor: alpha(e.amount > 0 ? colors.positive : colors.gold, 0.14) }]}>
                <Icon name={e.kind.includes('gift') ? 'gift' : e.kind === 'fundme_publish' ? 'check' : 'coin'} size={15} color={e.amount > 0 ? colors.positive : colors.gold} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle} numberOfLines={1}>{KIND_LABEL[e.kind] || e.label}{e.counterparty ? ` · ${e.counterparty.name || 'member'}` : ''}</Text>
                <Text style={s.rowMeta}>{timeLabel(e.createdAt)}{e.meta && e.meta.title ? ` · ${e.meta.title}` : ''}</Text>
              </View>
              <Text style={[s.rowAmt, { color: e.amount > 0 ? colors.positive : d.ink }]}>{e.amount > 0 ? '+' : ''}{e.amount}</Text>
            </View>
          ))}
          {cursor ? <FBtn kind="ghost" small label="Show more" onPress={more} style={{ margin: 12 }} /> : null}
        </DCard>
      ) : <FEmpty title="No credit activity yet" body="Buy credits to publish a Fund Me request, or receive some from a friend." />}
      <BuyCoinsSheet visible={buy} wallet="fundme_credits" onClose={() => setBuy(false)} onPurchased={() => { setBuy(false); walletChanged(); load(); }} />
    </DScreen>
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
    <DScreen title="Send Fund Me credits" back onBack={() => nav.pop()}>
      <FNotice tone="plum" text="Credits only — this sends Fund Me request credits, not money. The person can use them to publish their own request. Credits can’t be withdrawn or resold." />
      <DLabel>Who are you sending to?</DLabel>
      {to ? (
        <DCard style={s.pickRow}>
          <View style={s.avatar}><Text style={s.avatarText}>{(to.displayName || '?').slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Text style={s.rowTitle}>{to.displayName}</Text>{to.handle ? <Text style={s.rowMeta}>@{to.handle}</Text> : null}</View>
          <Pressable onPress={() => setTo(null)} hitSlop={10} accessibilityLabel="Choose someone else"><Text style={s.link}>Change</Text></Pressable>
        </DCard>
      ) : (
        <>
          <View style={s.search}>
            <Icon name="search" size={16} color={d.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Name or @handle" placeholderTextColor={d.muted} style={s.searchInput} autoCapitalize="none" accessibilityLabel="Search members" />
            {searching ? <ActivityIndicator size="small" color={d.muted} /> : null}
          </View>
          {found.map((u) => (
            <Tap key={u.id} onPress={() => pick(u)} style={[s.pickRow, s.pickCard, { marginTop: 8 }]} accessibilityLabel={`Send to ${u.displayName}`}>
              <View style={s.avatar}><Text style={s.avatarText}>{(u.displayName || '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={s.rowTitle}>{u.displayName}</Text>{u.handle ? <Text style={s.rowMeta}>@{u.handle}</Text> : null}</View>
              <Icon name="plus" size={16} color={d.plum} />
            </Tap>
          ))}
          {q.trim().length >= 2 && !searching && !found.length ? <Text style={[s.rowMeta, { marginTop: 8 }]}>No members found.</Text> : null}
        </>
      )}
      <DLabel>How many credits?</DLabel>
      <View style={s.stepper}>
        <Tap onPress={() => setN((x) => Math.max(1, x - 1))} style={s.stepBtn} accessibilityLabel="Fewer"><Text style={s.stepBtnText}>−</Text></Tap>
        <Text style={s.stepNum}>{n}</Text>
        <Tap onPress={() => setN((x) => Math.min(max, x + 1))} style={s.stepBtn} accessibilityLabel="More"><Text style={s.stepBtnText}>+</Text></Tap>
        <Text style={[s.rowMeta, { marginLeft: 8, flex: 1 }]}>You have {c ? c.balance : '…'}</Text>
      </View>
      <DLabel>Note (optional)</DLabel>
      <DInput value={note} onChangeText={setNote} placeholder="A word of encouragement" maxLength={140} />
      <FBtn label={to ? `Send ${n} credit${n === 1 ? '' : 's'} to ${to.displayName}` : 'Choose someone first'} disabled={!to} onPress={() => setConfirm(true)} style={{ marginTop: 18 }} icon={<Icon name="gift" size={16} color="#FFFFFF" />} />
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
    </DScreen>
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
      <DScreen title="Money & payouts" subtitle={params.title} back onBack={() => nav.pop()}>
        {error ? <FEmpty title="Not available" body={error} action="Try again" onAction={load} /> : <Shimmer style={{ height: 240, borderRadius: 20 }} />}
      </DScreen>
    );
  }
  const cur = m.currency; const t = m.totals; const fmt = (x) => formatMoney(x, cur);
  const bank = m.bankAccount;
  return (
    <DScreen title="Money & payouts" subtitle={params.title} back onBack={() => nav.pop()}>
      <FadeInUp><HeldExplainer /></FadeInUp>
      <FadeInUp index={1}>
        <View style={s.kpis}>
          <FKpi label="Received" value={fmt(t.receivedMinor)} />
          <FKpi label="Being checked" value={fmt(t.checkingMinor + t.verifiedMinor)} tint={colors.gold} />
          <FKpi label="Paid to you" value={fmt(t.paidMinor)} tint={colors.positive} />
        </View>
        <View style={s.kpis}>
          <FKpi label="Ready to pay" value={fmt(t.approvedMinor)} />
          <FKpi label="Fees" value={fmt(t.feesMinor)} />
          <FKpi label="Refunded" value={fmt(t.refundedMinor)} />
        </View>
        <Text style={s.rowMeta}>{m.rules.scheduleText || `Payouts are made after a ${m.rules.holdDays}-day hold and our checks.`}{m.rules.nextPayoutRun ? ` Next payout run: ${dateLabel(m.rules.nextPayoutRun)}.` : ''} Minimum payout {fmt(m.rules.minPayoutMinor)}. All amounts are in Naira.{m.rules.feeBps || m.rules.feeFixedMinor ? ` BibleNestra fee: ${m.rules.feeBps / 100}%${m.rules.feeFixedMinor ? ` + ${fmt(m.rules.feeFixedMinor)}` : ''} per donation, plus payment processing and VAT unless the donor covers them.` : ' No BibleNestra fee.'}</Text>
      </FadeInUp>

      <SectionTitle title="Your bank account" />
      <DList>
        <DRow
          icon="lock"
          title={bank ? `${bank.bankName} ${bank.accountNumberMasked}` : 'Add your bank account'}
          subtitle={bank ? `${bank.accountName} · ${bank.status === 'verified' ? 'Verified' : bank.status === 'rejected' ? `Needs changes${bank.reviewNote ? `: ${bank.reviewNote}` : ''}` : 'Being checked by our team'}` : 'Needed before we can pay out your donations'}
          onPress={() => nav.push('FundMePayoutAccount')}
          accessibilityLabel="Bank account for payouts"
        />
      </DList>

      <SectionTitle title="Identity check (KYC)" />
      <DList>
        <DRow
          icon="shield"
          title={m.kyc && m.kyc.status !== 'none' ? m.kyc.statusLabel : 'Verify your identity'}
          subtitle={m.kyc && m.kyc.approved ? `${m.kyc.idTypeLabel} ${m.kyc.idNumberMasked} · ${m.kyc.legalName}` : 'Needed before any payout: your BVN, NIN or national ID and a bank account in your name'}
          onPress={() => nav.push('PayoutKyc')}
          accessibilityLabel="Identity check for payouts"
        />
      </DList>

      <SectionTitle title="Payouts" />
      {m.payouts.length ? m.payouts.map((p) => (
        <DCard key={p.id} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.rowAmt, { flex: 1, textAlign: 'left' }]}>{formatMoney(p.amountMinor, p.currency)}</Text>
            <StatusPill map={PAYOUT_STATUS} status={p.status} />
          </View>
          <Text style={s.rowMeta}>{p.donations} donation{p.donations === 1 ? '' : 's'}{p.bank ? ` · to ${p.bank.bankName} •••• ${p.bank.last4}` : ''}{p.reference ? ` · ref ${p.reference}` : ''}</Text>
          {p.status === 'failed' && p.failureReason ? <Text style={s.short}>{p.failureReason}</Text> : null}
          <Timeline items={p.timeline} />
        </DCard>
      )) : <FEmpty title="No payouts yet" body="When donations are verified and the hold period has passed, our team approves a payout to your bank account. You’ll be notified when it’s paid." />}

      <SectionTitle title="Donations" />
      {m.donations.length ? (
        <DCard style={{ padding: 0 }}>
          {m.donations.map((x, i) => (
            <Pressable key={x.id} onPress={() => setOpen(open === x.id ? null : x.id)} style={[s.row, i > 0 && s.rowBorder, { flexWrap: 'wrap' }]} accessibilityLabel={`Donation from ${x.name}`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle} numberOfLines={1}>{x.name}{x.anonymous ? ' (anonymous publicly)' : ''}{x.test ? ' · test' : ''}</Text>
                <Text style={s.rowMeta}>{timeLabel(x.receivedAt || x.createdAt)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={s.rowAmt}>{formatMoney(x.amountMinor, x.currency)}</Text>
                <StatusPill map={DONATION_STATUS} status={x.status} />
              </View>
              {open === x.id ? (
                <View style={{ width: '100%', marginTop: 8 }}>
                  {x.message ? <Text style={s.body}>“{x.message}”</Text> : null}
                  <Text style={s.rowMeta}>
                    {x.original && x.original.currency !== x.currency ? `Gave ${moneyAny(x.original.amountMinor, x.original.currency)} · ` : ''}
                    Fees {formatMoney(x.fees ? x.fees.totalMinor : x.feeMinor, x.currency)}{x.coverFees ? ' (covered by the donor)' : ''} · for you {formatMoney(x.netMinor, x.currency)}
                    {x.payoutRun ? ` · payout run ${dateLabel(x.payoutRun)}` : ''}{x.receiptNo ? ` · receipt ${x.receiptNo}` : ''}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </DCard>
      ) : <FEmpty title="No donations yet" body="Share your link — every donation shows here with its status." />}
    </DScreen>
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
  if (cur === undefined) return <DScreen title="Bank account" back onBack={() => nav.pop()}><Shimmer style={{ height: 200, borderRadius: 20 }} /></DScreen>;
  return (
    <DScreen title="Bank account for payouts" back onBack={() => nav.pop()}>
      <FNotice text="We only pay out to an account in your name. Your account number is stored encrypted and shown only as its last 4 digits. Every new or changed account is checked by our team, and payouts wait until then." />
      <DList style={{ marginTop: 12 }}>
        <DRow
          icon="shield"
          title="Identity check (KYC)"
          subtitle="Required before any payout. Submitting it also sets this bank account."
          onPress={() => nav.push('PayoutKyc')}
          accessibilityLabel="Identity check (KYC)"
        />
      </DList>
      {cur ? (
        <DCard style={{ marginTop: 14 }}>
          <Eyebrow>Current account</Eyebrow>
          <Text style={s.rowTitle}>{cur.bankName} {cur.accountNumberMasked}</Text>
          <Text style={s.rowMeta}>{cur.accountName}{cur.nameResolved ? ' · name confirmed by the bank' : ''}</Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <FBadge label={cur.status === 'verified' ? 'Verified' : cur.status === 'rejected' ? 'Needs changes' : 'Being checked'} tint={cur.status === 'verified' ? colors.positive : cur.status === 'rejected' ? colors.negative : colors.gold} />
          </View>
          {cur.reviewNote ? <Text style={s.short}>{cur.reviewNote}</Text> : null}
        </DCard>
      ) : null}
      <DLabel>{cur ? 'Change to a different account' : 'Bank'}</DLabel>
      {bank ? (
        <DCard style={s.pickRow}>
          <Text style={[s.rowTitle, { flex: 1 }]}>{bank.name}</Text>
          <Pressable onPress={() => { setBank(null); setResolved(null); }} hitSlop={10}><Text style={s.link}>Change</Text></Pressable>
        </DCard>
      ) : (
        <>
          <View style={s.search}>
            <Icon name="search" size={16} color={d.muted} />
            <TextInput value={bankQ} onChangeText={setBankQ} placeholder="Search your bank" placeholderTextColor={d.muted} style={s.searchInput} accessibilityLabel="Search banks" />
          </View>
          <DCard style={{ padding: 0, marginTop: 8, maxHeight: 240 }}>
            {shown.slice(0, 40).map((b, i) => (
              <Pressable key={b.code} onPress={() => { setBank(b); setResolved(null); }} style={[s.row, i > 0 && s.rowBorder]} accessibilityLabel={b.name}>
                <Text style={s.rowTitle}>{b.name}</Text>
              </Pressable>
            ))}
          </DCard>
        </>
      )}
      <DLabel>Account number (NUBAN)</DLabel>
      <DInput value={num} onChangeText={(t) => { setNum(t.replace(/\D/g, '').slice(0, 10)); setResolved(null); }} placeholder="10 digits" keyboardType="number-pad" maxLength={10} />
      {canResolve ? <FBtn kind="ghost" small label={busy === 'check' ? 'Checking…' : 'Check account name'} disabled={!bank || num.length !== 10 || !!busy} onPress={check} style={{ marginTop: 8 }} /> : null}
      <DLabel>Account name</DLabel>
      {resolved ? (
        <DCard style={s.pickRow}><Icon name="check" size={16} color={d.sageDark} /><Text style={[s.rowTitle, { flex: 1 }]}>{resolved}</Text><Text style={s.rowMeta}>from your bank</Text></DCard>
      ) : <DInput value={name} onChangeText={setName} placeholder="Exactly as your bank shows it" maxLength={120} />}
      {err ? <Text style={s.short}>{err}</Text> : null}
      <FBtn label={busy === 'save' ? 'Saving…' : 'Save bank account'} disabled={!!busy} onPress={save} style={{ marginTop: 18 }} icon={<Icon name="lock" size={15} color="#FFFFFF" />} />
    </DScreen>
  );
}

// =============================================================================================
// Payout KYC — Fund Me payouts and gift-earnings withdrawals (backend/src/lib/kyc.js)
// =============================================================================================
export function PayoutKycScreen() {
  const fm = useFundMe();
  const nav = useNav();
  const toast = useToast();
  const [kyc, setKyc] = useState(undefined);
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
      setInfo(a); setKyc(a.kyc); setBanks(b.banks || []);
      if (a.kyc && a.kyc.status !== 'none') { setIdType(a.kyc.idType); setLegal(a.kyc.legalName); setBank({ code: a.kyc.bankCode, name: a.kyc.bankName }); }
      setEditing(!a.kyc || a.kyc.status === 'none' || a.kyc.status === 'rejected');
    }).catch((e) => { setErr(errorMessage(e, 'Couldn’t load your identity check')); setKyc(null); });
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
      setKyc(r.kyc); setEditing(false); setIdNumber(''); setNum('');
      toast.show('Submitted — our team will check it', { icon: 'shield', duration: 3600 });
    } catch (e) { setErr(errorMessage(e, 'Couldn’t submit')); }
    setBusy(false);
  };
  if (kyc === undefined) return <DScreen title="Identity check" back onBack={() => nav.pop()}><Shimmer style={{ height: 220, borderRadius: 20 }} /></DScreen>;
  const status = (kyc && kyc.status) || 'none';
  return (
    <DScreen title="Identity check (KYC)" back onBack={() => nav.pop()}>
      <FNotice text={(info && info.explain) || 'Before BibleNestra pays out Fund Me donations or gift earnings, we check who you are.'} />
      {status !== 'none' ? (
        <DCard style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.rowTitle, { flex: 1 }]}>{kyc.legalName}</Text>
            <FBadge label={kyc.statusLabel} tint={KYC_TINT[status]} />
          </View>
          <Text style={s.rowMeta}>{kyc.idTypeLabel} {kyc.idNumberMasked}</Text>
          <Text style={s.rowMeta}>{kyc.bankName} {kyc.accountNumberMasked} · {kyc.accountName}{kyc.nameResolved ? ' (from your bank)' : ''}</Text>
          {kyc.reviewNote ? <Text style={s.short}>{kyc.reviewNote}</Text> : null}
          {!editing ? <FBtn kind="ghost" small label="Update my details" onPress={() => setEditing(true)} style={{ marginTop: 10 }} /> : null}
        </DCard>
      ) : null}
      {editing ? (
        <>
          <DLabel>ID type</DLabel>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {((info && info.idTypes) || [{ value: 'bvn', label: 'BVN' }, { value: 'nin', label: 'NIN' }, { value: 'national_id', label: 'Other national ID' }]).map((t) => (
              <Tap key={t.value} onPress={() => setIdType(t.value)} style={[s.typeChip, idType === t.value && s.typeChipOn]} accessibilityLabel={t.label}>
                <Text style={[s.typeChipText, idType === t.value && { color: d.plumDark }]}>{t.value === 'national_id' ? 'Other national ID' : t.value.toUpperCase()}</Text>
              </Tap>
            ))}
          </View>
          <DLabel>{idType === 'bvn' ? 'BVN' : idType === 'nin' ? 'NIN' : 'ID number'}</DLabel>
          <DInput value={idNumber} onChangeText={(t) => setIdNumber(idType === 'national_id' ? t.replace(/[^A-Za-z0-9]/g, '').slice(0, 30) : t.replace(/\D/g, '').slice(0, 11))} placeholder={idType === 'national_id' ? 'As printed on your ID' : '11 digits'} keyboardType={idType === 'national_id' ? 'default' : 'number-pad'} autoCapitalize="characters" />
          <FNotice tone="plum" icon="clock" text="Instant BVN / NIN check is coming soon. For now our team checks your ID by hand before your first payout." style={{ marginTop: 10 }} />
          <DLabel>Legal name</DLabel>
          <DInput value={legal} onChangeText={setLegal} placeholder="As on your ID — first name and surname" maxLength={120} />
          <DLabel>Bank</DLabel>
          {bank ? (
            <DCard style={s.pickRow}>
              <Text style={[s.rowTitle, { flex: 1 }]}>{bank.name}</Text>
              <Pressable onPress={() => setBank(null)} hitSlop={10}><Text style={s.link}>Change</Text></Pressable>
            </DCard>
          ) : (
            <>
              <View style={s.search}>
                <Icon name="search" size={16} color={d.muted} />
                <TextInput value={bankQ} onChangeText={setBankQ} placeholder="Search your bank" placeholderTextColor={d.muted} style={s.searchInput} accessibilityLabel="Search banks" />
              </View>
              <DCard style={{ padding: 0, marginTop: 8, maxHeight: 220 }}>
                {shown.slice(0, 40).map((b, i) => (
                  <Pressable key={b.code} onPress={() => setBank(b)} style={[s.row, i > 0 && s.rowBorder]} accessibilityLabel={b.name}>
                    <Text style={s.rowTitle}>{b.name}</Text>
                  </Pressable>
                ))}
              </DCard>
            </>
          )}
          <DLabel>Account number (NUBAN)</DLabel>
          <DInput value={num} onChangeText={(t) => setNum(t.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits — an account in your own name" keyboardType="number-pad" maxLength={10} />
          {!(info && info.canResolve) ? (
            <>
              <DLabel>Account name</DLabel>
              <DInput value={accName} onChangeText={setAccName} placeholder="Exactly as your bank shows it" maxLength={120} />
            </>
          ) : <Text style={[s.rowMeta, { marginTop: 10 }]}>We check the account name with your bank. It must match your legal name (any order; middle names don’t matter).</Text>}
          {err ? <Text style={s.short}>{err}</Text> : null}
          <FBtn label={busy ? 'Submitting…' : 'Submit for review'} disabled={busy} onPress={submit} style={{ marginTop: 18 }} icon={<Icon name="shield" size={15} color="#FFFFFF" />} />
          <Text style={[s.rowMeta, { marginTop: 10 }]}>Your ID and account numbers are stored encrypted and shown only as their last digits.</Text>
        </>
      ) : null}
      {status === 'approved' ? <FBtn kind="ghost" label="Done" onPress={() => nav.pop()} style={{ marginTop: 16 }} /> : null}
    </DScreen>
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
    <DScreen title="My donations" back onBack={() => nav.pop()}>
      <HeldExplainer compact />
      {error ? <FNotice text={error} tone="danger" style={{ marginTop: 12 }} /> : null}
      <View style={{ marginTop: 14 }}>
        {items === null ? <Shimmer style={{ height: 160, borderRadius: 20 }} /> : items.length ? (
          <DCard style={{ padding: 0 }}>
            {items.map((x, i) => (
              <Tap key={x.id} onPress={() => (x.receiptNo ? nav.push('FundMeReceipt', { donationId: x.id }) : null)} style={[s.row, i > 0 && s.rowBorder]} accessibilityLabel={`Donation to ${x.fundraiserTitle}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>{x.fundraiserTitle}</Text>
                  <Text style={s.rowMeta}>{dateLabel(x.receivedAt || x.createdAt)}{x.receiptNo ? ' · tap for receipt' : ''}{x.test ? ' · test' : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={s.rowAmt}>{x.original ? moneyAny(x.original.amountMinor, x.original.currency) : formatMoney(x.amountMinor, x.currency)}</Text>
                  <StatusPill map={DONATION_STATUS} status={x.status} />
                </View>
              </Tap>
            ))}
          </DCard>
        ) : <FEmpty title="No donations yet" body="When you give to a Fund Me request, your receipts appear here." action="Discover fundraisers" onAction={() => nav.push('FundMe')} />}
      </View>
    </DScreen>
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
  if (!r) {
    return (
      <DScreen title="Receipt" back onBack={() => nav.pop()}>
        {error ? <FEmpty title="Receipt not available" body={error} action="Try again" onAction={load} /> : <Shimmer style={{ height: 300, borderRadius: 24 }} />}
      </DScreen>
    );
  }
  const line = (key, v, strong, oneLine) => (
    <View style={s.rLine}><Text style={s.rKey}>{key}</Text><Text style={[s.rVal, strong && { fontFamily: df.displayBold, fontSize: 16 }]} numberOfLines={oneLine ? 1 : undefined} ellipsizeMode="middle" selectable>{v}</Text></View>
  );
  return (
    <DScreen title="Donation receipt" back onBack={() => nav.pop()}>
      <FadeInUp>
        <DCard style={s.receipt}>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={s.receiptIcon}><Icon name="heart" size={22} color="#FFFFFF" /></View>
            <Text style={s.receiptTitle}>Thank you for your gift</Text>
            <Text style={s.rowMeta}>{r.test ? 'TEST — no money moved · ' : ''}Receipt {r.receiptNo}</Text>
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
            <Text style={s.rKey}>Status</Text><StatusPill map={DONATION_STATUS} status={r.status} />
          </View>
        </DCard>
      </FadeInUp>
      <Text style={[s.body, { marginTop: 14 }]}>{r.note}</Text>
      {r.refundPolicy ? <Text style={[s.rowMeta, { marginTop: 8 }]}>{r.refundPolicy}</Text> : null}
      <SectionTitle title="What happened" />
      <DCard><Timeline items={r.timeline} /></DCard>
      <FBtn kind="ghost" label="Open the request" onPress={() => nav.push('Fundraiser', { id: r.request.id })} style={{ marginTop: 16 }} />
    </DScreen>
  );
}

const s = {
  // credits
  creditCard: { padding: 16, borderRadius: 22 },
  creditIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: alpha('#B5523B', 0.14), alignItems: 'center', justifyContent: 'center' },
  creditTitle: { fontFamily: df.display, fontSize: 14, color: d.ink },
  creditSub: { fontFamily: df.sans, color: d.muted, fontSize: 11, marginTop: 2 },
  creditStrong: { color: d.ink, fontFamily: df.sansBold },
  creditNote: { color: d.muted, fontFamily: df.sans, fontSize: 10.5, lineHeight: 16, marginTop: 10 },
  hero: { borderRadius: 26, padding: 22, overflow: 'hidden' },
  heroNum: { fontFamily: df.displayBold, fontSize: 46, color: '#FFFFFF', marginTop: 4 },
  heroSub: { color: 'rgba(255,255,255,0.78)', fontFamily: df.sans, fontSize: 11.5 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: d.plum, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  heroBtnGhost: { backgroundColor: 'rgba(255,255,255,0.14)' },
  heroBtnText: { fontFamily: df.sansBold, color: '#FFFFFF', fontSize: 11.5 },
  h3: { fontFamily: df.displayBold, fontSize: 17, color: d.ink, marginBottom: 6 },
  body: { color: d.muted, fontFamily: df.sans, fontSize: 12, lineHeight: 18, marginTop: 4 },
  kpis: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 6 },
  link: { color: d.plum, fontFamily: df.sansBold, fontSize: 12 },
  short: { color: (isDarkScheme() ? '#E8A09A' : '#8A2F2F'), fontFamily: df.sans, fontSize: 11, marginTop: 8, lineHeight: 17 },
  rowMeta: { color: d.muted, fontFamily: df.sans, fontSize: 10.5, marginTop: 2, lineHeight: 16 },
  rowTitle: { color: d.ink, fontFamily: df.display, fontSize: 13 },
  rowAmt: { color: d.ink, fontFamily: df.sansBold, fontSize: 13, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16 },
  rowBorder: { borderTopWidth: 1, borderTopColor: d.line },
  rowIconSm: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 20, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  pickCard: { paddingVertical: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: d.plumDark, fontFamily: df.sansHeavy, fontSize: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 999, paddingHorizontal: 14, height: 46 },
  searchInput: { flex: 1, color: d.ink, fontFamily: df.sans, fontSize: 12, outlineStyle: 'none' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), alignItems: 'center', justifyContent: 'center', backgroundColor: d.paper },
  stepBtnText: { fontSize: 20, color: d.ink, fontFamily: df.sansBold },
  stepNum: { fontFamily: df.displayBold, fontSize: 28, color: d.ink, minWidth: 40, textAlign: 'center' },

  // payouts / timeline
  tlRow: { flexDirection: 'row', gap: 10 },
  tlRail: { width: 14, alignItems: 'center' },
  tlDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: (isDarkScheme() ? '#333333' : '#d6d6d6'), backgroundColor: d.paper, marginTop: 4 },
  tlLine: { flex: 1, width: 2, backgroundColor: d.line, marginTop: 2 },
  tlTitle: { color: d.ink, fontFamily: df.sansBold, fontSize: 11.5 },
  tlMeta: { color: d.muted, fontFamily: df.sans, fontSize: 10, marginTop: 1 },

  // receipt
  receipt: { padding: 18, borderRadius: 24 },
  receiptIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: d.sageDark, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  receiptTitle: { fontFamily: df.displayBold, fontSize: 20, color: d.ink },
  rLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: d.line },
  rKey: { color: d.muted, fontFamily: df.sans, fontSize: 11, flexShrink: 0 },
  rVal: { color: d.ink, fontFamily: df.sansBold, fontSize: 11, flexShrink: 1, textAlign: 'right' },
};
