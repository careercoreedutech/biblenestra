// CREATOR PLANS (round 3): the plan picker cards (Free / Standard / Premium), "My creator plan" and the creator
// withdrawal screen. Both screens are standalone full-screen pages (the main tab bar is hidden while they are open) with
// a clear back button to Memberships. Colours come from the design tokens d.* (which follow Light / Dark / System).
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { Icon } from '../components/Icons';
import { Tap, Eyebrow, d, df } from '../design/sanctuary';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { payWithPaystack, paystackMessage, paystackError } from '../billing/paystack';
import {
  useCreatorPlan, changeCreatorPlan, getCreatorWithdrawals, requestCreatorWithdrawal, cancelCreatorWithdrawal, creatorPlanMessage,
} from '../api/creatorPlans';

/** Minor units → "₦15,360" (NGN) or "USD 10.24". */
export function minorLabel(minor, currency = 'NGN') {
  const n = Number(minor || 0) / 100;
  const cur = String(currency || 'NGN').toUpperCase();
  if (cur === 'NGN') return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
  return `${cur} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const PLAN_BLURB = {
  free: 'Create as many memberships as you like, at no cost.',
  standard: 'Lower withdrawal fee. Members joining you see no ads.',
  premium: 'The lowest withdrawal fee. Members joining you see no ads.',
};

/**
 * Plan picker cards. `plans` from GET /creator-plan; `current` is the creator's state; `onChoose(planId)` runs the change.
 * Shows the USD price, the NGN amount that is charged, the withdrawal fee and whether members see ads when they join.
 */
export function PlanPicker({ plans = [], current = {}, busy = false, onChoose }) {
  return (
    <View style={{ gap: 12 }}>
      {plans.map((p) => {
        const isCurrent = current.planId === p.id && current.canCreate;
        const isTarget = current.pendingPlanId === p.id; // a downgrade that starts at the end of the period
        // Current card: "Cancel the change" when one is scheduled. Scheduled target: no button. Others: choose.
        const cta = isCurrent ? (current.pendingPlanId ? 'Cancel the change' : null) : isTarget ? null : p.id === 'free' ? 'Switch to Free' : 'Choose ' + p.name;
        return (
          <View key={p.id} style={[s.planCard, (isCurrent || isTarget) && s.planCardOn]} accessibilityRole="summary">
            <View style={s.planTop}>
              <Text style={s.planName}>{p.name}</Text>
              {isCurrent ? <Text style={s.planBadge}>Your plan</Text> : isTarget ? <Text style={s.planBadge}>From the end of this period</Text> : null}
            </View>
            <Text style={s.planPrice}>{p.priceUsdCents ? `${p.priceUsdText} / month` : 'Free'}</Text>
            {p.charge ? <Text style={s.planSub}>Charged {minorLabel(p.charge.amountMinor, p.charge.currency)} a month at today’s rate</Text> : null}
            <Text style={s.planLine}>Withdrawal fee: {p.withdrawalPercent}% (BibleNestra’s fee, shown separately from bank charges)</Text>
            <Text style={s.planLine}>{p.joinAds ? 'Ads when members join' : 'Ad-free joining'}</Text>
            <Text style={s.planBlurb}>{PLAN_BLURB[p.id] || ''}</Text>
            {cta ? (
              <Tap onPress={() => onChoose && onChoose(isCurrent ? current.planId : p.id)} accessibilityRole="button" disabled={busy}
                style={[s.planCta, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.planCtaText}>{cta}</Text>}
              </Tap>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Pays / switches a plan. → true when the plan changed (or a checkout completed). */
export function useChoosePlan(onDone) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const choose = async (planId, email) => {
    setBusy(true);
    try {
      // One call: payWithPaystack opens the hosted page only when the server answers with a checkout; a free or scheduled change returns at once.
      const paid = await payWithPaystack(api, (mail) => changeCreatorPlan(api, planId, mail), { email: email || null });
      if (paid.status !== 'success') { toast.show(paystackMessage(paid.status), { icon: 'clock', duration: 5000 }); setBusy(false); return false; }
      const kind = paid.result && paid.result.status;
      toast.show(kind === 'scheduled' ? 'Your plan changes at the end of this period' : 'Plan updated', { icon: kind === 'scheduled' ? 'clock' : 'check' });
      if (onDone) onDone();
      setBusy(false);
      return true;
    } catch (e) {
      toast.show(e.code === 'PAYMENTS_PAUSED' || e.code === 'PAYMENTS_NOT_CONFIGURED' ? paystackError(e) : creatorPlanMessage(e, 'Couldn’t change your plan'), { tone: 'error' });
      setBusy(false);
      return false;
    }
  };
  return { busy, choose };
}

function Header({ title, onBack }) {
  return (
    <View style={s.header}>
      <Tap onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Memberships" style={s.back}>
        <Icon name="chevron-left" size={18} color={d.ink} />
        <Text style={s.backText}>Memberships</Text>
      </Tap>
      <Text style={s.headerTitle}>{title}</Text>
      <View style={{ width: 110 }} />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// My creator plan: current plan, renewal, change, payment history, and the way to withdrawals
// ---------------------------------------------------------------------------------------------------------------
export function CreatorPlanScreen() {
  const nav = useNav();
  const { data, error, reload } = useCreatorPlan();
  const { busy, choose } = useChoosePlan(reload);
  const cur = (data && data.current) || {};
  const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
  return (
    <View style={s.page}>
      <Header title="My creator plan" onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Eyebrow>Creators</Eyebrow>
        <Text style={s.h1}>Your plan</Text>
        {error ? <Text style={s.err}>{creatorPlanMessage(error, 'Couldn’t load your plan')}</Text> : null}
        {!data && !error ? <ActivityIndicator color={d.plum} style={{ marginTop: 20 }} /> : null}
        {data ? (
          <>
            <View style={s.statusCard}>
              <Text style={s.statusTitle}>{(data.plans.find((p) => p.id === cur.planId) || { name: cur.planId ? cur.planId : 'No plan yet' }).name}</Text>
              <Text style={s.statusLine}>{cur.canCreate ? 'You can create and publish memberships.' : (cur.message || 'Choose a plan to create memberships.')}</Text>
              {cur.renewsOn ? <Text style={s.statusLine}>Renews on {dateText(cur.renewsOn)}{cur.cardOnFile ? ' by card' : ' (pay again in the app)'}</Text> : null}
              {cur.accessUntil && !cur.renewsOn && cur.planId !== 'free' ? <Text style={s.statusLine}>Access until {dateText(cur.accessUntil)}</Text> : null}
              {cur.pendingPlanId ? <Text style={s.statusLine}>Changing to {data.plans.find((p) => p.id === cur.pendingPlanId)?.name} at the end of this period</Text> : null}
              <Text style={s.statusLine}>Withdrawal fee now: {(data.plans.find((p) => p.id === cur.activePlanId) || { withdrawalPercent: '—' }).withdrawalPercent}%</Text>
            </View>
            <Text style={s.sectionTitle}>Change plan</Text>
            <PlanPicker plans={data.plans} current={cur} busy={busy} onChoose={(id) => choose(id)} />
            <Text style={s.note}>Upgrades start now and are charged in full for one month (no proration). Downgrades between paid plans start at the end of the period. Moving to Free takes effect at once.</Text>
            <Tap onPress={() => nav.push('CreatorWithdraw')} accessibilityRole="button" style={s.secondary}>
              <Text style={s.secondaryText}>Withdraw earnings</Text>
            </Tap>
            <Text style={s.sectionTitle}>Payments</Text>
            {data.payments.length === 0 ? <Text style={s.note}>No plan payments yet.</Text> : null}
            {data.payments.map((p) => (
              <View key={p.reference} style={s.row}>
                <Text style={s.rowMain}>{(data.plans.find((x) => x.id === p.planId) || { name: 'Creator plan' }).name} · {p.purpose === 'renewal' ? 'Renewal' : 'Payment'}</Text>
                <Text style={s.rowSub}>{dateText(p.paidAt || p.createdAt)} · {p.displayAmount} · {p.status}</Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Withdrawals: balance, the fee for the active plan, a request (KYC), and the statement with each line shown
// ---------------------------------------------------------------------------------------------------------------
export function CreatorWithdrawScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => getCreatorWithdrawals(api).then((d) => { setData(d); setError(null); }).catch((e) => setError(e));
  React.useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const request = async () => {
    const minor = Math.round(Number(amount || 0) * 100);
    if (!(minor > 0)) { toast.show('Enter the amount to withdraw', { tone: 'error' }); return; }
    setBusy(true);
    try {
      await requestCreatorWithdrawal(api, minor, 'NGN');
      setAmount('');
      toast.show('Withdrawal requested. We will be in touch once it is approved.', { icon: 'check' });
      load();
    } catch (e) {
      toast.show(creatorPlanMessage(e, 'Couldn’t request that withdrawal'), { tone: 'error' });
    }
    setBusy(false);
  };
  const cancel = async (id) => {
    try { await cancelCreatorWithdrawal(api, id); toast.show('Withdrawal cancelled', { icon: 'check' }); load(); }
    catch (e) { toast.show(creatorPlanMessage(e), { tone: 'error' }); }
  };

  const bal = data ? data.balance : null;
  const fee = data ? data.feePercent : null;
  return (
    <View style={s.page}>
      <Header title="Withdraw earnings" onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Eyebrow>Creators</Eyebrow>
        <Text style={s.h1}>Your earnings</Text>
        {error ? <Text style={s.err}>{creatorPlanMessage(error, 'Couldn’t load your earnings')}</Text> : null}
        {!data && !error ? <ActivityIndicator color={d.plum} style={{ marginTop: 20 }} /> : null}
        {data ? (
          <>
            <View style={s.statusCard}>
              <Text style={s.statusLine}>Available now</Text>
              <Text style={s.statusTitle}>{minorLabel(bal.availableMinor, bal.currency)}</Text>
              <Text style={s.statusLine}>Earned {minorLabel(bal.earnedMinor, bal.currency)} · held {minorLabel(bal.heldMinor, bal.currency)}</Text>
              <Text style={s.statusLine}>BibleNestra’s withdrawal fee on your plan: {fee}%</Text>
              <Text style={s.statusLine}>Smallest withdrawal: {minorLabel(data.minWithdrawalMinor, bal.currency)}</Text>
            </View>
            <Text style={s.sectionTitle}>Request a withdrawal</Text>
            <TextInput style={s.input} value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad"
              placeholder="Amount in naira" placeholderTextColor={d.muted} accessibilityLabel="Amount in naira" />
            <Text style={s.note}>You need an approved identity check (KYC). The fee is calculated on the amount you request. BibleNestra pays approved withdrawals outside the app; gateway or bank charges are shown separately when paid.</Text>
            <Tap onPress={request} accessibilityRole="button" style={[s.primary, busy && { opacity: 0.6 }]} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.primaryText}>Request withdrawal</Text>}
            </Tap>
            <Text style={s.sectionTitle}>Statement</Text>
            {data.items.length === 0 ? <Text style={s.note}>No withdrawals yet.</Text> : null}
            {data.items.map((w) => (
              <View key={w.id} style={s.row}>
                <Text style={s.rowMain}>{w.grossText} requested · {w.status}</Text>
                <Text style={s.rowSub}>BibleNestra fee {w.feeText} ({w.feePercent}%, {w.planId} plan)</Text>
                {w.bankChargeText ? <Text style={s.rowSub}>Gateway / bank charge {w.bankChargeText}</Text> : null}
                {w.netText ? <Text style={s.rowSub}>You receive {w.netText}{w.reference ? ` · ref ${w.reference}` : ''}</Text> : null}
                {w.status === 'requested' ? (
                  <Pressable onPress={() => cancel(w.id)} accessibilityRole="button" style={{ marginTop: 6 }}>
                    <Text style={s.linkText}>Cancel request</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: d.ivory },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 10 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 110 },
  backText: { fontFamily: df.sansMedium, color: d.ink, fontSize: 14 },
  headerTitle: { fontFamily: df.display, color: d.ink, fontSize: 17 },
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },
  h1: { fontFamily: df.display, fontSize: 26, color: d.ink },
  sectionTitle: { fontFamily: df.sansSemi, fontSize: 15, color: d.ink, marginTop: 10 },
  note: { fontFamily: df.sans, fontSize: 13, color: d.muted, lineHeight: 19 },
  err: { fontFamily: df.sans, fontSize: 14, color: d.roseDark },
  planCard: { backgroundColor: d.paper, borderRadius: 18, borderWidth: 1, borderColor: d.line, padding: 16, gap: 4 },
  planCardOn: { borderColor: d.plum, borderWidth: 2 },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { fontFamily: df.display, fontSize: 20, color: d.ink },
  planBadge: { fontFamily: df.sansSemi, fontSize: 12, color: d.plum },
  planPrice: { fontFamily: df.sansBold, fontSize: 16, color: d.ink, marginTop: 2 },
  planSub: { fontFamily: df.sans, fontSize: 12, color: d.muted },
  planLine: { fontFamily: df.sans, fontSize: 13, color: d.ink, marginTop: 4 },
  planBlurb: { fontFamily: df.sans, fontSize: 13, color: d.muted, marginTop: 4 },
  planCta: { marginTop: 10, backgroundColor: d.plum, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  planCtaText: { fontFamily: df.sansBold, color: '#FFFFFF', fontSize: 15 },
  statusCard: { backgroundColor: d.paper, borderRadius: 18, borderWidth: 1, borderColor: d.line, padding: 16, gap: 4 },
  statusTitle: { fontFamily: df.display, fontSize: 24, color: d.ink },
  statusLine: { fontFamily: df.sans, fontSize: 13, color: d.muted, lineHeight: 19 },
  input: { backgroundColor: d.paper, borderRadius: 14, borderWidth: 1, borderColor: d.line, paddingHorizontal: 14, paddingVertical: 12, fontFamily: df.sans, color: d.ink, fontSize: 15 },
  primary: { backgroundColor: d.plum, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontFamily: df.sansBold, color: '#FFFFFF', fontSize: 15 },
  secondary: { borderRadius: 14, borderWidth: 1, borderColor: d.line, paddingVertical: 12, alignItems: 'center', backgroundColor: d.paper },
  secondaryText: { fontFamily: df.sansSemi, color: d.ink, fontSize: 14 },
  row: { backgroundColor: d.paper, borderRadius: 14, borderWidth: 1, borderColor: d.line, padding: 12, gap: 2 },
  rowMain: { fontFamily: df.sansSemi, color: d.ink, fontSize: 14 },
  rowSub: { fontFamily: df.sans, color: d.muted, fontSize: 12 },
  linkText: { fontFamily: df.sansSemi, color: d.plum, fontSize: 13 },
});
