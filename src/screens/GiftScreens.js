// VIRTUAL GIFTS & STARS — screens (routes in App.js):
//   GiftStore     all gifts with their art / animation and Gifting Coin cost, balance, Buy Gifting Coins, how gifts work
//   GiftHistory   gifts I sent and received
//   GiftEarnings  gift earnings by state (pending → available → withdrawing → withdrawn), plain-language rules,
//                 creator payout programme (apply / status) and withdrawal requests (only when open + approved)
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Screen, Button, Empty, Input, Notice, Pills, Section } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, radius } from '../theme';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { WalletBalancePill, BuyCoinsSheet } from '../components/wallet';
import { getHistory, newIdempotencyKey, walletError, timeLabel } from '../api/wallet';
import { useGiftCatalogue, useGiftEarnings, getGiftHistory, applyCreatorProgramme, requestWithdrawal, fmt, naira, CONTEXT_LABEL } from '../api/gifts';
import { GiftArt, GiftGrid, GiftPlayer, GiftSheet } from '../components/gifts';

function Offline({ title }) {
  return <Screen title={title} back><Empty title="Sign in to use gifts" body="Virtual gifts, Gifting Coins and gift earnings are kept safely on the server, so they need an online account." /></Screen>;
}

// ---------- Gift store ----------
export function GiftStoreScreen({ params = {} }) {
  const nav = useNav();
  const cat = useGiftCatalogue();
  const [buy, setBuy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sendTo, setSendTo] = useState(false);
  const recipient = params.recipientId ? { id: params.recipientId, name: params.name } : null;
  if (cat.loaded && !cat.online) return <Offline title="Gift store" />;
  const pct = cat.rules.commissionPct != null ? cat.rules.commissionPct : 20;
  return (
    <Screen title="Gift store" subtitle="Virtual gifts & stars" back right={<WalletBalancePill wallet="gift_coins" onPress={() => setBuy(true)} />}>
      <FadeInUp>
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>Gifting Coins</Text>
            <Text style={styles.heroTitle}>Bless someone with a gift</Text>
            <Text style={styles.heroSub}>{`Send gifts in chats, groups, on profiles, posts and in live sessions. BibleNestra keeps ${pct}%; the person you bless receives ${100 - pct}% as gift earnings.`}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Button small label="Buy Gifting Coins" icon={<Icon name="coin" size={13} color="#FFFFFF" />} onPress={() => setBuy(true)} />
              <Button small kind="ghost" label="History" onPress={() => nav.push('GiftHistory')} />
              <Button small kind="ghost" label="My earnings" onPress={() => nav.push('GiftEarnings')} />
            </View>
          </View>
          <GiftArt art="premium" gift={{ art: 'premium', tier: 'premium' }} size={84} />
        </View>
      </FadeInUp>
      <Section title="All gifts">
        {!cat.loaded ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} /> : null}
        {cat.error ? <Notice tint={colors.rose} text={walletError(cat.error, 'Couldn’t load gifts')} /> : null}
        <GiftGrid items={cat.items} balance={cat.balance} onPick={(g) => setPreview(g)} />
        <Text style={styles.hint}>{recipient ? `Tap a gift to preview it, then send it to ${recipient.name}.` : 'Tap a gift to see its animation. To send one, open a chat, a profile, a post or a live session and tap the gift button.'}</Text>
      </Section>
      <Section title="How it works">
        {(cat.rules.explain || []).map((t) => (
          <View key={t} style={styles.bullet}><Icon name="check" size={14} color={colors.primary} /><Text style={styles.bulletText}>{t}</Text></View>
        ))}
        <View style={styles.bullet}><Icon name="check" size={14} color={colors.primary} /><Text style={styles.bulletText}>Gifting Coins are separate from Kingdom Coins (free reward coins), Dating Coins and Fund Me credits.</Text></View>
      </Section>
      <BuyCoinsSheet visible={buy} wallet="gift_coins" onClose={() => setBuy(false)} />
      <GiftPlayer play={preview ? { gift: preview, key: preview.id + Date.now() } : null} onDone={() => { const g = preview; setPreview(null); if (g && recipient) setSendTo(true); }} />
      {recipient ? <GiftSheet visible={sendTo} onClose={() => setSendTo(false)} recipient={recipient} context={params.context || { type: 'profile', id: recipient.id }} /> : null}
    </Screen>
  );
}

// ---------- history ----------
function HistoryRow({ s }) {
  const sent = s.direction === 'sent';
  const who = sent ? s.recipient : s.sender;
  return (
    <View style={styles.row}>
      <View style={styles.rowArt}><GiftArt gift={s.gift} size={40} animate={false} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{sent ? `${s.giftName} to ${(who && who.displayName) || 'a member'}` : `${s.giftName} from ${(who && who.displayName) || 'a member'}`}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{`${CONTEXT_LABEL[s.context.type] || ''} · ${timeLabel(s.createdAt)}`}</Text>
        {s.note ? <Text style={styles.rowNote} numberOfLines={2}>“{s.note}”</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.amount, { color: sent ? colors.fg : colors.primary }]}>{sent ? `−${fmt(s.coins)}` : `+${fmt(s.earnings)}`}</Text>
        <Text style={styles.rowSub}>{sent ? 'Gifting Coins' : `earnings (${100 - s.commissionPct}%)`}</Text>
      </View>
    </View>
  );
}
export function GiftHistoryScreen({ params = {} }) {
  const api = useApi();
  const [dir, setDir] = useState(params.dir || 'received');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const load = useCallback(async (more) => {
    setLoading(true); setErr(null);
    try {
      const r = await getGiftHistory(api, dir, more ? cursor : null);
      setItems((x) => (more ? [...x, ...r.items] : r.items)); setCursor(r.nextCursor); setTotals(r.totals);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, [api.online, dir, cursor]);
  useEffect(() => { if (api.online) load(false); }, [dir, api.online]);
  if (!api.online) return <Offline title="Gift history" />;
  return (
    <Screen title="Gift history" back>
      {totals ? (
        <View style={styles.stats}>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.receivedCount)}</Text><Text style={styles.statLabel}>received</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.receivedEarnings)}</Text><Text style={styles.statLabel}>coins earned</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.sentCount)}</Text><Text style={styles.statLabel}>sent</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.sentCoins)}</Text><Text style={styles.statLabel}>coins spent</Text></View>
        </View>
      ) : null}
      <Pills items={['Received', 'Sent']} value={dir === 'sent' ? 'Sent' : 'Received'} onChange={(k) => { setDir(k === 'Sent' ? 'sent' : 'received'); setItems([]); setCursor(null); }} style={{ marginBottom: 12 }} />
      {err ? <Notice tint={colors.rose} text={walletError(err, 'Couldn’t load your gifts')} /> : null}
      {items.map((s, i) => <FadeInUp key={s.id} index={Math.min(i, 8)} distance={8}><HistoryRow s={s} /></FadeInUp>)}
      {!loading && !items.length && !err ? <Empty title={dir === 'sent' ? 'No gifts sent yet' : 'No gifts received yet'} body={dir === 'sent' ? 'Open a chat, a profile or a live session and tap the gift button.' : 'Gifts people send you appear here.'} /> : null}
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} /> : null}
      {cursor && !loading ? <Button kind="ghost" small label="Load more" onPress={() => load(true)} style={{ alignSelf: 'center', marginTop: 8 }} /> : null}
    </Screen>
  );
}

// ---------- earnings ----------
const STATES = [
  ['pending', 'Pending', 'clock', 'Held for a few days after each gift'],
  ['available', 'Available', 'sparkles', 'Past the hold period'],
  ['withdrawing', 'Withdrawing', 'clock', 'In a withdrawal request'],
  ['withdrawn', 'Withdrawn', 'check', 'Paid out to you'],
];
function ProgrammeForm({ onDone }) {
  const api = useApi();
  const toast = useToast();
  const [f, setF] = useState({ legalName: '', bankName: '', accountName: '', accountNumber: '', about: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const ok = f.legalName.trim().length > 1 && f.bankName.trim().length > 1 && f.accountName.trim().length > 1 && /^\d{6,20}$/.test(f.accountNumber.replace(/\s/g, ''));
  const submit = async () => {
    setBusy(true);
    try { await applyCreatorProgramme(api, f); toast.show('Application sent · we’ll let you know', { icon: 'check', haptic: 'success' }); onDone && onDone(); } catch (e) { toast.show(walletError(e, 'Couldn’t send your application'), { tone: 'error' }); }
    setBusy(false);
  };
  return (
    <View style={{ gap: 8 }}>
      <Input placeholder="Legal name (as on your ID)" value={f.legalName} onChangeText={set('legalName')} />
      <Input placeholder="Bank" value={f.bankName} onChangeText={set('bankName')} />
      <Input placeholder="Account name" value={f.accountName} onChangeText={set('accountName')} />
      <Input placeholder="Account number" keyboardType="number-pad" value={f.accountNumber} onChangeText={set('accountNumber')} />
      <Input placeholder="About your ministry or content (optional)" value={f.about} onChangeText={set('about')} multiline />
      <Text style={styles.hint}>BibleNestra reviews every application and may ask for ID before approving. Approval doesn’t open withdrawals by itself — they open when BibleNestra turns them on.</Text>
      <Button label={busy ? 'Sending…' : 'Apply'} disabled={!ok || busy} onPress={submit} />
    </View>
  );
}
function WithdrawForm({ data, onDone }) {
  const api = useApi();
  const toast = useToast();
  const [coins, setCoins] = useState('');
  const [key] = useState(newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const n = parseInt(coins, 10) || 0;
  const rate = data.rules.payoutRate || { minorPerCoin: 100 };
  const ok = n >= data.rules.minWithdrawal && n <= data.balances.available;
  const submit = async () => {
    setBusy(true);
    try { await requestWithdrawal(api, { coins: n, idempotencyKey: key }); toast.show('Withdrawal requested', { icon: 'check', haptic: 'success' }); onDone && onDone(); } catch (e) { toast.show(walletError(e, 'Couldn’t request a withdrawal'), { tone: 'error' }); }
    setBusy(false);
  };
  return (
    <View style={{ gap: 8 }}>
      <Input placeholder={`Coins (min ${fmt(data.rules.minWithdrawal)}, max ${fmt(data.balances.available)})`} keyboardType="number-pad" value={coins} onChangeText={setCoins} />
      <Text style={styles.hint}>{n ? `≈ ${naira(n * rate.minorPerCoin)} to ${data.programme.bankName} ${data.programme.accountNumber}. BibleNestra reviews and pays withdrawals by bank transfer.` : 'Only available gift earnings can be withdrawn. Gifting Coins you bought never can.'}</Text>
      <Button label={busy ? 'Sending…' : 'Request withdrawal'} disabled={!ok || busy} onPress={submit} />
    </View>
  );
}
export function GiftEarningsScreen() {
  const api = useApi();
  const nav = useNav();
  const { data, loaded, error, reload, online } = useGiftEarnings();
  const [hist, setHist] = useState(null);
  const [applying, setApplying] = useState(false);
  useEffect(() => { if (online) getHistory(api, 'gift_earnings').then((r) => setHist(r.items || [])).catch(() => setHist([])); }, [online, data]);
  if (loaded && !online) return <Offline title="Gift earnings" />;
  if (!data) return <Screen title="Gift earnings" back>{error ? <Notice tint={colors.rose} text={walletError(error, 'Couldn’t load earnings')} /> : <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}</Screen>;
  const p = data.programme || { status: 'none' };
  const PSTATUS = { none: 'Not applied', pending: 'Application under review', approved: 'Approved', rejected: 'Not approved', suspended: 'Suspended' };
  return (
    <Screen title="Gift earnings" back right={<PressScale onPress={() => nav.push('GiftHistory', { dir: 'received' })} hitSlop={8}><Text style={styles.link}>Gifts</Text></PressScale>}>
      <FadeInUp>
        <View style={styles.earnHero}>
          <Text style={styles.heroEyebrow}>Your gift earnings</Text>
          <Text style={styles.earnTotal}>{fmt(data.balances.pending + data.balances.available + data.balances.withdrawing)}<Text style={styles.earnUnit}> coins</Text></Text>
          <Text style={styles.heroSub}>{`From ${fmt(data.totals.gifts)} gift${data.totals.gifts === 1 ? '' : 's'} · ${fmt(data.balances.withdrawn)} withdrawn so far`}</Text>
        </View>
      </FadeInUp>
      <View style={styles.states}>
        {STATES.map(([k, label, icon, sub], i) => (
          <FadeInUp key={k} index={i + 1} style={styles.stateCard}>
            <View style={styles.stateHead}><Icon name={icon} size={14} color={k === 'available' ? colors.primary : colors.muted} /><Text style={styles.stateLabel}>{label}</Text></View>
            <Text style={styles.stateValue}>{fmt(data.balances[k])}</Text>
            <Text style={styles.stateSub}>{sub}</Text>
          </FadeInUp>
        ))}
      </View>
      <Section title="How gift earnings work">
        {data.rules.explain.map((t) => (<View key={t} style={styles.bullet}><Icon name="check" size={14} color={colors.primary} /><Text style={styles.bulletText}>{t}</Text></View>))}
      </Section>
      <Section title="Creator payout programme">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{PSTATUS[p.status] || p.status}</Text>
          {p.status === 'approved' || p.status === 'pending' ? <Text style={styles.rowSub}>{`${p.bankName} · ${p.accountName} · ${p.accountNumber}`}</Text> : null}
          {p.adminNote && p.status !== 'approved' ? <Text style={styles.rowNote}>{p.adminNote}</Text> : null}
          {(p.status === 'none' || p.status === 'rejected') && !applying ? <Button small label={p.status === 'rejected' ? 'Apply again' : 'Apply to the programme'} onPress={() => setApplying(true)} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
          {applying ? <View style={{ marginTop: 10 }}><ProgrammeForm onDone={() => { setApplying(false); reload(); }} /></View> : null}
        </View>
      </Section>
      <Section title="Withdraw">
        <View style={styles.card}>
          {data.canWithdraw ? <WithdrawForm data={data} onDone={reload} /> : <Text style={styles.bulletText}>{(data.withdrawBlocked && data.withdrawBlocked.text) || 'Withdrawals aren’t available.'}</Text>}
        </View>
        {data.withdrawals.map((w) => (
          <View key={w.id} style={styles.row}>
            <Icon name={w.status === 'paid' ? 'check' : w.status === 'rejected' ? 'x' : 'clock'} size={16} color={w.status === 'paid' ? colors.primary : colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{`${fmt(w.coins)} coins · ${naira(w.payoutMinor)}`}</Text>
              <Text style={styles.rowSub}>{`${w.status[0].toUpperCase()}${w.status.slice(1)} · ${timeLabel(w.createdAt)}${w.reference ? ` · ref ${w.reference}` : ''}`}</Text>
              {w.adminNote && w.status === 'rejected' ? <Text style={styles.rowNote}>{w.adminNote}</Text> : null}
            </View>
          </View>
        ))}
      </Section>
      <Section title="Earnings history">
        {hist === null ? <ActivityIndicator color={colors.primary} /> : null}
        {hist && !hist.length ? <Text style={styles.hint}>No earnings yet.</Text> : null}
        {(hist || []).map((e) => (
          <View key={e.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{e.label}{e.counterparty && e.counterparty.name ? ` · ${e.counterparty.name}` : ''}</Text>
              <Text style={styles.rowSub}>{`${({ gift_earnings: 'pending', gift_earnings_available: 'available', gift_earnings_withdrawing: 'withdrawing', gift_earnings_withdrawn: 'withdrawn' })[e.wallet] || ''} · ${timeLabel(e.createdAt)}`}</Text>
            </View>
            <Text style={[styles.amount, { color: e.amount > 0 ? colors.primary : colors.fg }]}>{`${e.amount > 0 ? '+' : '−'}${fmt(Math.abs(e.amount))}`}</Text>
          </View>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: radius.xl, backgroundColor: colors.night, marginBottom: 6 },
  heroEyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 23, color: '#FFFFFF', marginTop: 2 },
  heroSub: { fontSize: 13, lineHeight: 18, color: 'rgba(244,239,230,0.75)', marginTop: 6 },
  hint: { fontSize: 12.5, lineHeight: 17, color: colors.muted, marginTop: 10 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 8 },
  bulletText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.fg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  rowArt: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#FFF8EA', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.fg },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  rowNote: { fontSize: 12.5, fontStyle: 'italic', color: colors.muted, marginTop: 3 },
  amount: { fontSize: 15, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statValue: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  statLabel: { fontSize: 10.5, color: colors.muted, marginTop: 1 },
  earnHero: { padding: 18, borderRadius: radius.xl, backgroundColor: colors.night },
  earnTotal: { fontFamily: fonts.serifBold, fontSize: 34, color: '#FFFFFF', marginTop: 4 },
  earnUnit: { fontSize: 16, color: 'rgba(244,239,230,0.7)' },
  states: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 10 },
  stateCard: { width: '48.5%', padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stateHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stateLabel: { fontSize: 12, fontWeight: '700', color: colors.muted },
  stateValue: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 4 },
  stateSub: { fontSize: 11, color: colors.faint, marginTop: 1 },
  card: { padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.fg },
  link: { color: colors.primary, fontWeight: '700', fontSize: 14, paddingHorizontal: 6 },
});
