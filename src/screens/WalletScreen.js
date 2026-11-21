// WALLET (monetisation stage 1, client spec §15) — every balance in one place, each clearly separate:
// Fund Me credits, Dating Coins (+ free boosts), Gifting Coins and gift earnings (pending / available / withdrawn),
// with plain-words "can buy / spend / send / withdraw", Buy (BuyCoinsSheet), per-wallet history and Dating Plus / VIP.
// The old Kingdom Coins (free reward coins for chat passes, job bids, games) stay in Profile › Wallet & Gifts and are
// linked from here. Route: nav.push('Wallet', { focus?: 'dating_coins' }).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Screen, Empty, Notice, alpha, NightGlow } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp } from '../components/Motion';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { useToast } from '../components/Toast';
import { useWallet, getHistory, cancelSubscription, walletChanged, walletError, WALLET_META, fmtUnits, dateLabel, timeLabel } from '../api/wallet';
import { BuyCoinsSheet, WalletSheet } from '../components/wallet';
import { ws } from '../components/wallet/WalletSheet';
import { GiftSheet } from '../components/gifts';
import { SupportCard } from './GiftScreens';
import { SUPPORT_CONTEXT, SUPPORT_RECIPIENT } from '../api/gifts';

const GROUPS = [
  { key: 'fundme_credits', title: 'Fund Me request credits', icon: 'heart', tint: '#B5523B' },
  { key: 'dating_coins', title: 'Dating Coins', icon: 'heart', tint: '#C2417A' },
  { key: 'gift_coins', title: 'Gifting Coins', icon: 'gift', tint: '#A87A27' },
  { key: 'gift_earnings', title: 'Gift earnings', icon: 'sparkles', tint: '#2E7D5B' },
];

function Flag({ on, label }) {
  return (
    <View style={[s.flag, on ? s.flagOn : s.flagOff]} accessibilityLabel={`${label}: ${on ? 'yes' : 'no'}`}>
      <Icon name={on ? 'check' : 'x'} size={11} color={on ? '#2E7D5B' : colors.faint} strokeWidth={2.6} />
      <Text style={[s.flagText, !on && { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

function History({ wallet }) {
  const api = useApi();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const load = useCallback(async (c) => {
    setLoading(true);
    try {
      const d = await getHistory(api, wallet, c);
      setItems((cur) => (c ? cur.concat(d.items) : d.items)); setCursor(d.nextCursor); setErr(null);
    } catch (e) { setErr(walletError(e, 'Could not load history')); } finally { setLoading(false); }
  }, [api, wallet]);
  useEffect(() => { load(null); }, [load]);
  return (
    <View style={s.hist}>
      {items.map((e) => (
        <View key={e.id} style={s.histRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.histLabel} numberOfLines={1}>{e.label}{e.counterparty && e.counterparty.name && !String(e.kind).startsWith('support_') ? ` · ${e.counterparty.name}` : ''}{e.kind === 'support_sent' && e.meta && e.meta.giftName ? ` · ${e.meta.giftName}` : ''}</Text>
            <Text style={s.histMeta}>{timeLabel(e.createdAt)}{e.meta && e.meta.reason ? ` · ${e.meta.reason}` : ''}{wallet === 'gift_earnings' ? ` · ${(WALLET_META[e.wallet] || {}).short || ''}` : ''}</Text>
          </View>
          <Text style={[s.histAmt, { color: e.amount < 0 ? '#B3261E' : '#2E7D5B' }]}>{`${e.amount > 0 ? '+' : '−'}${fmtUnits(Math.abs(e.amount))}`}</Text>
        </View>
      ))}
      {!loading && !items.length && !err ? <Text style={s.histEmpty}>Nothing here yet.</Text> : null}
      {err ? <Text style={[s.histEmpty, { color: '#B3261E' }]}>{err}</Text> : null}
      {loading ? <ActivityIndicator style={{ marginVertical: 8 }} color={colors.primary} /> : null}
      {cursor && !loading ? (
        <PressScale onPress={() => load(cursor)} scaleTo={0.97} style={s.more} accessibilityRole="button"><Text style={s.moreText}>Load more</Text></PressScale>
      ) : null}
    </View>
  );
}

function WalletCard({ g, cards, onBuy, open, onToggle, rules }) {
  const main = cards.find((c) => c.wallet === g.key) || { balance: 0 };
  const boosts = g.key === 'dating_coins' ? cards.find((c) => c.wallet === 'dating_boosts') : null;
  const earnings = g.key === 'gift_earnings';
  const avail = earnings ? cards.find((c) => c.wallet === 'gift_earnings_available') : null;
  const withdrawn = earnings ? cards.find((c) => c.wallet === 'gift_earnings_withdrawn') : null;
  const withdrawing = earnings ? cards.find((c) => c.wallet === 'gift_earnings_withdrawing') : null;
  const flags = earnings ? { purchasable: false, spendable: false, giftable: false, withdrawable: true } : main;
  const about = earnings
    ? `Gift earnings: ${100 - (rules ? rules.giftCommissionPct : 20)}% to you (BibleNestra keeps ${rules ? rules.giftCommissionPct : 20}%), ${rules ? rules.earningsHoldDays : 14}-day hold, withdraw from ${(rules && rules.minWithdrawalLabel) || '$10 (about ₦15,000)'} once approved for the BibleNestra creator payout programme${rules && !rules.withdrawalsEnabled ? ' (withdrawals not open yet)' : ''}.`
    : main.about;
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={[s.cardIcon, { backgroundColor: alpha(g.tint, 0.12) }]}><Icon name={g.icon} size={20} color={g.tint} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{g.title}</Text>
          <Text style={s.cardBal}>{fmtUnits(earnings ? (avail ? avail.balance : 0) : main.balance)}<Text style={s.cardUnit}>{earnings ? '  available' : `  ${(WALLET_META[g.key] || {}).unit || ''}`}</Text></Text>
        </View>
        {main.purchasable ? (
          <PressScale onPress={() => onBuy(g.key)} scaleTo={0.94} style={s.buy} accessibilityRole="button" accessibilityLabel={`Buy ${g.title}`}>
            <Icon name="plus" size={14} color="#FFFFFF" strokeWidth={2.6} /><Text style={s.buyText}>Buy</Text>
          </PressScale>
        ) : null}
      </View>
      {earnings ? (
        <View style={s.subRows}>
          <Text style={s.subRow}>{`Pending (on hold): ${fmtUnits(main.balance)}`}</Text>
          {withdrawing && withdrawing.balance ? <Text style={s.subRow}>{`Withdrawal in progress: ${fmtUnits(withdrawing.balance)}`}</Text> : null}
          <Text style={s.subRow}>{`Withdrawn so far: ${fmtUnits(withdrawn ? withdrawn.balance : 0)}`}</Text>
        </View>
      ) : null}
      {boosts && boosts.balance ? <Text style={s.subRow}>{`Free profile boosts: ${fmtUnits(boosts.balance)}`}</Text> : null}
      <Text style={s.about}>{about}</Text>
      <View style={s.flags}>
        <Flag on={!!flags.purchasable} label="Buy" />
        <Flag on={!!flags.spendable} label="Spend" />
        <Flag on={!!flags.giftable} label="Send to others" />
        <Flag on={!!flags.withdrawable} label="Withdraw" />
      </View>
      <PressScale onPress={onToggle} scaleTo={0.98} style={s.histToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Icon name="clock" size={14} color={colors.primary} /><Text style={s.histToggleText}>{open ? 'Hide history' : 'History'}</Text>
      </PressScale>
      {open ? <History wallet={g.key} /> : null}
    </View>
  );
}

export function WalletScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const { data, error, loaded, online, reload } = useWallet();
  const [buy, setBuy] = useState(null); // wallet key | 'plans'
  const [open, setOpen] = useState(params.focus || null);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState(false);

  if (!online) {
    return (
      <Screen title="Wallet" back>
        <Empty title="Sign in to use your wallets" body="Fund Me credits, Dating Coins, Gifting Coins and gift earnings are kept safely on the server, so they need an online account." />
      </Screen>
    );
  }
  const cards = (data && data.wallets) || [];
  const sub = data && data.subscription;
  const pay = (data && data.payments) || {};

  async function doCancel() {
    if (!sub || busy) return;
    setBusy(true);
    try {
      const r = await cancelSubscription(api, sub.id);
      walletChanged();
      toast.show(r.note || `Renewal is off. You keep ${sub.title} until ${dateLabel(sub.currentPeriodEnd)}.`, { icon: 'check' });
      setCancelAsk(false);
    } catch (e) { toast.show(walletError(e, 'Could not cancel'), { icon: 'x' }); } finally { setBusy(false); }
  }

  return (
    <Screen title="Wallet" back>
      <FadeInUp>
        <View style={s.hero}>
          <NightGlow />
          <Text style={s.heroEyebrow}>BIBLENESTRA WALLET</Text>
          <Text style={s.heroTitle}>Separate balances, clearly kept</Text>
          <Text style={s.heroSub}>Each wallet has its own balance and history. Coins in one wallet can’t be used in another, and coins you buy are never cash.</Text>
        </View>
      </FadeInUp>

      {!loaded ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} /> : null}
      {error ? <Notice text={walletError(error, 'Could not load your wallet')} /> : null}
      {loaded && !pay.playConfigured && !pay.testPurchases ? <Notice text="Buying through Google Play is coming soon. Nothing can be charged yet." /> : null}
      {pay.testPurchases ? <Notice text="Test purchases are on for your account (admins and testers only). No money moves." tint={colors.primary} /> : null}

      {loaded && cards.length ? GROUPS.map((g) => (
        <WalletCard key={g.key} g={g} cards={cards} rules={data.rules} onBuy={setBuy} open={open === g.key} onToggle={() => setOpen(open === g.key ? null : g.key)} />
      )) : null}

      {loaded && data ? <SupportCard onPress={() => setSupport(true)} /> : null}

      {loaded && data ? (
        <>
          <Text style={s.section}>Find Love subscription</Text>
          <View style={s.card}>
            {sub ? (
              <>
                <View style={s.cardHead}>
                  <View style={[s.cardIcon, { backgroundColor: alpha('#C2417A', 0.12) }]}><Icon name="star" size={20} color="#C2417A" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle}>{sub.title}{sub.test ? ' (test)' : ''}</Text>
                    <Text style={s.subStatus}>{sub.status === 'active' ? `Active · renews ${dateLabel(sub.renewsOn)}` : sub.status === 'cancelled' ? `Renewal off · access until ${dateLabel(sub.accessUntil)}` : sub.status}</Text>
                  </View>
                  <Text style={s.subPrice}>{sub.displayPrice}</Text>
                </View>
                {(sub.benefits.features || []).slice(0, 5).map((f) => <Text key={f} style={s.feat}>{`✓  ${f}`}</Text>)}
                {sub.status === 'active' ? (
                  <PressScale onPress={() => setCancelAsk(true)} scaleTo={0.98} style={s.cancel} accessibilityRole="button"><Text style={s.cancelText}>Cancel renewal</Text></PressScale>
                ) : (
                  <PressScale onPress={() => setBuy('plans')} scaleTo={0.98} style={s.cancel} accessibilityRole="button"><Text style={s.cancelText}>Renew or change plan</Text></PressScale>
                )}
              </>
            ) : (
              <>
                <Text style={s.about}>Dating Plus (₦1,500 / month) and Dating VIP (₦3,500 / month) remove ad unlocks and message limits. VIP adds 300 Dating Coins and 2 profile boosts every month.</Text>
                <PressScale onPress={() => setBuy('plans')} scaleTo={0.98} style={[ws.primary, { marginTop: 12 }]} accessibilityRole="button"><Text style={ws.primaryText}>See plans</Text></PressScale>
              </>
            )}
          </View>

          <Text style={s.section}>Kingdom Coins</Text>
          <PressScale onPress={() => nav.push('Profile', { tab: 'Wallet & Gifts' })} scaleTo={0.98} style={[s.card, s.kingdom]} accessibilityRole="button" accessibilityLabel={`Kingdom Coins ${data.kingdomCoins ? data.kingdomCoins.balance : 0}. Open`}>
            <View style={[s.cardIcon, { backgroundColor: alpha(colors.gold, 0.14) }]}><Icon name="coin" size={20} color={colors.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{`${fmtUnits(data.kingdomCoins ? data.kingdomCoins.balance : 0)} reward coins`}</Text>
              <Text style={s.about}>{data.kingdomCoins ? data.kingdomCoins.explain : ''}</Text>
            </View>
            <Icon name="more" size={16} color={colors.faint} />
          </PressScale>
        </>
      ) : null}

      <BuyCoinsSheet visible={!!buy && buy !== 'plans'} wallet={buy && buy !== 'plans' ? buy : 'gift_coins'} onClose={() => setBuy(null)} onPurchased={() => reload()} />
      <BuyCoinsSheet visible={buy === 'plans'} plans onClose={() => setBuy(null)} onPurchased={() => reload()} />
      <GiftSheet visible={support} onClose={() => setSupport(false)} recipient={SUPPORT_RECIPIENT} context={SUPPORT_CONTEXT} />
      <WalletSheet visible={cancelAsk} onClose={() => !busy && setCancelAsk(false)} title="Cancel renewal?" subtitle={sub ? `You keep ${sub.title} until ${dateLabel(sub.currentPeriodEnd)}. After that it won’t renew and you won’t be charged again.${sub.provider === 'play' ? ' Google Play subscriptions must also be cancelled in Google Play › Subscriptions.' : ''}` : ''}>
        <PressScale onPress={doCancel} scaleTo={0.98} style={[ws.primary, { backgroundColor: '#B3261E' }, busy && ws.disabled]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={ws.primaryText}>Cancel renewal</Text>}
        </PressScale>
        <PressScale onPress={() => setCancelAsk(false)} scaleTo={0.98} style={ws.ghost} accessibilityRole="button"><Text style={ws.ghostText}>Keep my plan</Text></PressScale>
      </WalletSheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.night, borderRadius: radius.lg, padding: 18, overflow: 'hidden', ...shadow.md, marginBottom: 12 },
  heroEyebrow: { fontSize: 11, letterSpacing: 1.4, fontWeight: '700', color: colors.goldLight },
  heroTitle: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.nightFg, marginTop: 6 },
  heroSub: { fontSize: 13, lineHeight: 19, color: colors.nightMuted, marginTop: 6 },
  section: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  cardBal: { fontFamily: fonts.display, fontSize: 26, color: colors.fg, marginTop: 1 },
  cardUnit: { fontFamily: fonts.serifItalic, fontSize: 14, color: colors.muted },
  buy: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  buyText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },
  about: { fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 10 },
  subRows: { marginTop: 8, gap: 2 },
  subRow: { fontSize: 13, color: colors.fg, marginTop: 4 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  flagOn: { backgroundColor: alpha('#2E7D5B', 0.08), borderColor: alpha('#2E7D5B', 0.25) },
  flagOff: { backgroundColor: colors.raised, borderColor: colors.border },
  flagText: { fontSize: 11.5, fontWeight: '600', color: '#2E7D5B' },
  histToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' },
  histToggleText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  hist: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.rule },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.rule },
  histLabel: { fontSize: 13.5, fontWeight: '600', color: colors.fg },
  histMeta: { fontSize: 11.5, color: colors.faint, marginTop: 1 },
  histAmt: { fontSize: 14, fontWeight: '800' },
  histEmpty: { fontSize: 13, color: colors.muted, paddingVertical: 10 },
  more: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  moreText: { fontSize: 12.5, fontWeight: '700', color: colors.fg },
  subStatus: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  subPrice: { fontSize: 13, fontWeight: '700', color: colors.fg },
  feat: { fontSize: 12.5, color: colors.fg, marginTop: 6 },
  cancel: { marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  cancelText: { fontSize: 13, fontWeight: '700', color: colors.fg },
  kingdom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
