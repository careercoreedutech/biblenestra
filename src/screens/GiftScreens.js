// VIRTUAL GIFTS & STARS — screens (routes in App.js):
//   GiftStore     all gifts with their art / animation and Gifting Coin cost, balance, Buy Gifting Coins, how gifts work
//   GiftHistory   gifts I sent and received
//   GiftEarnings  gift earnings by state (pending → available → withdrawing → withdrawn), plain-language rules,
//                 creator payout programme (apply / status) and withdrawal requests (only when open + approved)
// Styled in the Figma "Gifts" design (src/design/sanctuary.js + src/design/profile/parts.js).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, Empty, Input, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp } from '../components/Motion';
import { useToast } from '../components/Toast';
import { colors, fonts, radius } from '../theme';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { WalletBalancePill, BuyCoinsSheet } from '../components/wallet';
import { getHistory, newIdempotencyKey, walletError, timeLabel } from '../api/wallet';
import { useGiftCatalogue, useGiftEarnings, getGiftHistory, applyCreatorProgramme, requestWithdrawal, fmt, naira, CONTEXT_LABEL, SUPPORT_CONTEXT, SUPPORT_RECIPIENT, SUPPORT_LABEL, earningsRulesLine } from '../api/gifts';
import { GiftArt, GiftGrid, GiftPlayer, GiftSheet } from '../components/gifts';
import { d, df, Grad, Tap, SectionTitle } from '../design/sanctuary';
import { DScreen, DTabs, DButton } from '../design/profile/parts';

function Offline({ title }) {
  const nav = useNav();
  return <DScreen back onBack={() => nav.pop()} title={title}><Empty title="Sign in to use gifts" body="Virtual gifts, Gifting Coins and gift earnings are kept safely on the server, so they need an online account." /></DScreen>;
}

// Small outlined pill used in the design's hero cards
function GhostPill({ label, onPress }) {
  return (
    <Tap onPress={onPress} style={styles.ghostPill} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.ghostPillText}>{label}</Text>
    </Tap>
  );
}

// ---------- Gift store ----------
export function GiftStoreScreen({ params = {} }) {
  const nav = useNav();
  const cat = useGiftCatalogue();
  const [buy, setBuy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sendTo, setSendTo] = useState(false);
  const [support, setSupport] = useState(!!params.support);
  const recipient = params.recipientId ? { id: params.recipientId, name: params.name } : null;
  if (cat.loaded && !cat.online) return <Offline title="Gift store" />;
  const pct = cat.rules.commissionPct != null ? cat.rules.commissionPct : 20;
  return (
    <DScreen back onBack={() => nav.pop()} title="Virtual gifts" subtitle="Celebrate with generosity" action={<WalletBalancePill wallet="gift_coins" onPress={() => setBuy(true)} />}>
      <FadeInUp>
        {/* .gift-balance */}
        <Grad colors={['#2E1C11', '#6D3518']} style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>Gifting Coins</Text>
            <Text style={styles.heroTitle}>Bless someone with a gift</Text>
            <Text style={styles.heroSub}>{`Send gifts in chats, groups, on profiles, posts and in live sessions. BibleNestra keeps ${pct}%; the person you bless receives ${100 - pct}% as gift earnings.`}</Text>
            <View style={styles.heroButtons}>
              <DButton small label="Buy Gifting Coins" icon={<Icon name="coin" size={13} color="#FFFFFF" />} onPress={() => setBuy(true)} />
              <GhostPill label="History" onPress={() => nav.push('GiftHistory')} />
              <GhostPill label="My earnings" onPress={() => nav.push('GiftEarnings')} />
            </View>
          </View>
          <GiftArt art="premium" gift={{ art: 'premium', tier: 'premium' }} size={84} />
        </Grad>
      </FadeInUp>
      <SupportCard onPress={() => setSupport(true)} />
      <SectionTitle eyebrow="Gift catalogue" title="Choose a blessing" />
      {!cat.loaded ? <ActivityIndicator color={d.plum} style={{ marginVertical: 30 }} /> : null}
      {cat.error ? <Notice tint={colors.rose} text={walletError(cat.error, 'Couldn’t load gifts')} /> : null}
      <GiftGrid items={cat.items} balance={cat.balance} columns={2} onPick={(g) => setPreview(g)} />
      <Text style={styles.hint}>{recipient ? `Tap a gift to preview it, then send it to ${recipient.name}.` : 'Tap a gift to see its animation. To send one, open a chat, a profile, a post or a live session and tap the gift button.'}</Text>
      {/* .gift-info */}
      <View style={styles.info}>
        <Icon name="shield" size={17} color={d.sageDark} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rulesLine}>{earningsRulesLine(cat.rules)}</Text>
          {(cat.rules.explain || []).map((t) => (
            <View key={t} style={styles.bullet}><Icon name="check" size={13} color={d.sageDark} /><Text style={styles.infoText}>{t}</Text></View>
          ))}
          <View style={styles.bullet}><Icon name="check" size={13} color={d.sageDark} /><Text style={styles.infoText}>Gifting Coins are separate from Kingdom Coins (free reward coins), Dating Coins and Fund Me credits.</Text></View>
        </View>
      </View>
      <BuyCoinsSheet visible={buy} wallet="gift_coins" onClose={() => setBuy(false)} />
      <GiftPlayer play={preview ? { gift: preview, key: preview.id + Date.now() } : null} onDone={() => { const g = preview; setPreview(null); if (g && recipient) setSendTo(true); }} />
      {recipient ? <GiftSheet visible={sendTo} onClose={() => setSendTo(false)} recipient={recipient} context={params.context || { type: 'profile', id: recipient.id }} /> : null}
      <GiftSheet visible={support} onClose={() => setSupport(false)} recipient={SUPPORT_RECIPIENT} context={SUPPORT_CONTEXT} />
    </DScreen>
  );
}

// ---------- Support BibleNestra (gift store + Wallet): opens the gift picker for the official account ----------
export function SupportCard({ onPress }) {
  return (
    <Tap onPress={onPress} style={styles.support} accessibilityRole="button" accessibilityLabel="Support BibleNestra with a gift">
      <View style={styles.supportIcon}><Icon name="heart" size={18} color={d.plum} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{SUPPORT_LABEL}</Text>
        <Text style={styles.rowSub}>Send any gift to BibleNestra. All of it goes to keeping the app running.</Text>
      </View>
      <Icon name="gift" size={18} color={d.gold} />
    </Tap>
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
        <Text style={styles.rowTitle} numberOfLines={1}>{s.support ? `${SUPPORT_LABEL} · ${s.giftName}` : sent ? `${s.giftName} to ${(who && who.displayName) || 'a member'}` : `${s.giftName} from ${(who && who.displayName) || 'a member'}`}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{`${s.support ? 'Thank you · 100% to BibleNestra' : CONTEXT_LABEL[s.context.type] || ''} · ${timeLabel(s.createdAt)}`}</Text>
        {s.note ? <Text style={styles.rowNote} numberOfLines={2}>“{s.note}”</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.amount, { color: sent ? d.ink : d.plum }]}>{sent ? `−${fmt(s.coins)}` : `+${fmt(s.earnings)}`}</Text>
        <Text style={styles.rowSub}>{sent ? 'Gifting Coins' : `earnings (${100 - s.commissionPct}%)`}</Text>
      </View>
    </View>
  );
}
export function GiftHistoryScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
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
    <DScreen back onBack={() => nav.pop()} title="Gift history" subtitle="Gifts you sent and received">
      {totals ? (
        /* .invite-stats */
        <View style={styles.stats}>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.receivedCount)}</Text><Text style={styles.statLabel}>received</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.receivedEarnings)}</Text><Text style={styles.statLabel}>coins earned</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.sentCount)}</Text><Text style={styles.statLabel}>sent</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{fmt(totals.sentCoins)}</Text><Text style={styles.statLabel}>coins spent</Text></View>
        </View>
      ) : null}
      <DTabs items={['Received', 'Sent']} value={dir === 'sent' ? 'Sent' : 'Received'} onChange={(k) => { setDir(k === 'Sent' ? 'sent' : 'received'); setItems([]); setCursor(null); }} />
      {err ? <Notice tint={colors.rose} text={walletError(err, 'Couldn’t load your gifts')} /> : null}
      {items.map((s, i) => <FadeInUp key={s.id} index={Math.min(i, 8)} distance={8}><HistoryRow s={s} /></FadeInUp>)}
      {!loading && !items.length && !err ? <Empty title={dir === 'sent' ? 'No gifts sent yet' : 'No gifts received yet'} body={dir === 'sent' ? 'Open a chat, a profile or a live session and tap the gift button.' : 'Gifts people send you appear here.'} /> : null}
      {loading ? <ActivityIndicator color={d.plum} style={{ marginVertical: 20 }} /> : null}
      {cursor && !loading ? <DButton small label="Load more" onPress={() => load(true)} style={{ alignSelf: 'center', marginTop: 8 }} /> : null}
    </DScreen>
  );
}

// ---------- earnings ----------
const STATES = [
  ['pending', 'Pending', 'clock', 'On hold after each gift'],
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
      <Text style={styles.hint}>{n ? `≈ ${naira(n * rate.minorPerCoin)} to ${data.programme.bankName} ${data.programme.accountNumber}. BibleNestra reviews and pays withdrawals by bank transfer.` : `The minimum withdrawal is ${data.rules.minWithdrawalLabel || `${fmt(data.rules.minWithdrawal)} coins`} (${fmt(data.rules.minWithdrawal)} coins). Only available gift earnings can be withdrawn. Gifting Coins you bought never can.`}</Text>
      {n && n < data.rules.minWithdrawal ? <Text style={[styles.hint, { color: colors.rose }]}>{`Below the minimum of ${fmt(data.rules.minWithdrawal)} coins.`}</Text> : null}
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
  if (!data) return <DScreen back onBack={() => nav.pop()} title="Gift earnings">{error ? <Notice tint={colors.rose} text={walletError(error, 'Couldn’t load earnings')} /> : <ActivityIndicator color={d.plum} style={{ marginTop: 40 }} />}</DScreen>;
  const p = data.programme || { status: 'none' };
  const PSTATUS = { none: 'Not applied', pending: 'Application under review', approved: 'Approved', rejected: 'Not approved', suspended: 'Suspended' };
  return (
    <DScreen back onBack={() => nav.pop()} title="Gift earnings" subtitle="Your BibleNestra gifts" action={
      <Tap onPress={() => nav.push('GiftHistory', { dir: 'received' })} hitSlop={8} accessibilityRole="link"><Text style={styles.link}>Gifts</Text></Tap>
    }>
      <FadeInUp>
        {/* .gift-balance: total earnings */}
        <Grad colors={['#2E1C11', '#6D3518']} style={styles.hero}>
          <Text style={styles.heroEyebrow}>Your gift earnings</Text>
          <Text style={styles.earnTotal}>{fmt(data.balances.pending + data.balances.available + data.balances.withdrawing)}<Text style={styles.earnUnit}> coins</Text></Text>
          <Text style={styles.heroSub}>{`From ${fmt(data.totals.gifts)} gift${data.totals.gifts === 1 ? '' : 's'} · ${fmt(data.balances.withdrawn)} withdrawn so far`}</Text>
        </Grad>
      </FadeInUp>
      <View style={styles.states}>
        {STATES.map(([key, label, icon, sub], i) => (
          <FadeInUp key={key} index={i + 1} style={styles.stateCard}>
            <View style={styles.stateHead}><Icon name={icon} size={14} color={key === 'available' ? d.plum : d.muted} /><Text style={styles.stateLabel}>{label}</Text></View>
            <Text style={styles.stateValue}>{fmt(data.balances[key])}</Text>
            <Text style={styles.stateSub}>{key === 'pending' ? `On hold for ${data.rules.holdDays} days after each gift` : sub}</Text>
          </FadeInUp>
        ))}
      </View>
      <SectionTitle eyebrow="Rules" title="How gift earnings work" />
      <View style={styles.info}>
        <Icon name="shield" size={17} color={d.sageDark} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rulesLine}>{earningsRulesLine(data.rules)}</Text>
          {data.rules.explain.map((t) => (<View key={t} style={styles.bullet}><Icon name="check" size={13} color={d.sageDark} /><Text style={styles.infoText}>{t}</Text></View>))}
        </View>
      </View>
      <SectionTitle eyebrow="Creator programme" title="Payout programme" />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{PSTATUS[p.status] || p.status}</Text>
        {p.status === 'approved' || p.status === 'pending' ? <Text style={styles.rowSub}>{`${p.bankName} · ${p.accountName} · ${p.accountNumber}`}</Text> : null}
        {p.adminNote && p.status !== 'approved' ? <Text style={styles.rowNote}>{p.adminNote}</Text> : null}
        {(p.status === 'none' || p.status === 'rejected') && !applying ? <DButton small label={p.status === 'rejected' ? 'Apply again' : 'Apply to the programme'} onPress={() => setApplying(true)} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
        {applying ? <View style={{ marginTop: 10 }}><ProgrammeForm onDone={() => { setApplying(false); reload(); }} /></View> : null}
      </View>
      <SectionTitle eyebrow="Payouts" title="Withdraw" />
      <View style={styles.card}>
        {data.canWithdraw ? <WithdrawForm data={data} onDone={reload} /> : <Text style={styles.bulletText}>{(data.withdrawBlocked && data.withdrawBlocked.text) || 'Withdrawals aren’t available.'}</Text>}
        {/* PAYOUT KYC (Fund Me agent): a withdrawal is approved only after the identity check */}
        <GhostPill label="Identity check (KYC) for payouts" onPress={() => nav.push('PayoutKyc')} />
      </View>
      {data.withdrawals.map((w) => (
        <View key={w.id} style={styles.row}>
          <Icon name={w.status === 'paid' ? 'check' : w.status === 'rejected' ? 'x' : 'clock'} size={16} color={w.status === 'paid' ? d.plum : d.muted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{`${fmt(w.coins)} coins · ${naira(w.payoutMinor)}`}</Text>
            <Text style={styles.rowSub}>{`${w.status[0].toUpperCase()}${w.status.slice(1)} · ${timeLabel(w.createdAt)}${w.reference ? ` · ref ${w.reference}` : ''}`}</Text>
            {w.adminNote && w.status === 'rejected' ? <Text style={styles.rowNote}>{w.adminNote}</Text> : null}
          </View>
        </View>
      ))}
      <SectionTitle eyebrow="Activity" title="Earnings history" />
      {hist === null ? <ActivityIndicator color={d.plum} /> : null}
      {hist && !hist.length ? <Text style={styles.hint}>No earnings yet.</Text> : null}
      {(hist || []).map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>{e.label}{e.counterparty && e.counterparty.name ? ` · ${e.counterparty.name}` : ''}</Text>
            <Text style={styles.rowSub}>{`${({ gift_earnings: 'pending', gift_earnings_available: 'available', gift_earnings_withdrawing: 'withdrawing', gift_earnings_withdrawn: 'withdrawn' })[e.wallet] || ''} · ${timeLabel(e.createdAt)}`}</Text>
          </View>
          <Text style={[styles.amount, { color: e.amount > 0 ? d.plum : d.ink }]}>{`${e.amount > 0 ? '+' : '−'}${fmt(Math.abs(e.amount))}`}</Text>
        </View>
      ))}
    </DScreen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderRadius: 22, marginBottom: 6 },
  heroEyebrow: { fontFamily: df.sansHeavy, fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase', color: '#E8B891' },
  heroTitle: { fontFamily: df.displayBold, fontSize: 23, lineHeight: 26, color: '#FFFFFF', marginTop: 4 },
  heroSub: { fontFamily: df.sans, fontSize: 10, lineHeight: 15, color: '#C9B6A8', marginTop: 6 },
  heroButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  ghostPill: { paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  ghostPillText: { fontFamily: df.sansBold, fontSize: 10, color: '#FFF2E5' },
  hint: { marginTop: 10, fontFamily: df.sans, fontSize: 10, lineHeight: 15, color: d.muted },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 7 },
  bulletText: { flex: 1, fontFamily: df.sans, fontSize: 11, lineHeight: 17, color: d.ink },
  infoText: { flex: 1, fontFamily: df.sans, fontSize: 9, lineHeight: 14, color: d.sageDark },
  info: { flexDirection: 'row', gap: 9, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: d.sage },
  support: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 14, borderRadius: 17, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  supportIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: d.lavender },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 9, borderRadius: 17, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  rowArt: { width: 46, height: 46, borderRadius: 13, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: df.display, fontSize: 13, color: d.ink },
  rowSub: { fontFamily: df.sans, fontSize: 9, color: d.muted, marginTop: 3 },
  rowNote: { fontFamily: df.displayItalic, fontSize: 11, color: d.muted, marginTop: 3 },
  amount: { fontFamily: df.sansHeavy, fontSize: 13 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12, marginBottom: 6 },
  stat: { flexGrow: 1, flexBasis: '45%', paddingVertical: 12, alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  statValue: { fontFamily: df.displayBold, fontSize: 17, color: d.ink },
  statLabel: { marginTop: 2, fontFamily: df.sans, fontSize: 9, color: d.muted },
  earnTotal: { fontFamily: df.displayBold, fontSize: 30, color: '#FFFFFF', marginTop: 4 },
  earnUnit: { fontFamily: df.sans, fontSize: 14, color: 'rgba(244,239,230,0.7)' },
  states: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 10 },
  stateCard: { width: '48.5%', padding: 12, borderRadius: 16, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  stateHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stateLabel: { fontSize: 10, fontFamily: df.sansBold, color: d.muted },
  stateValue: { fontFamily: df.displayBold, fontSize: 20, color: d.ink, marginTop: 4 },
  stateSub: { fontSize: 9, fontFamily: df.sans, color: d.muted, marginTop: 2 },
  card: { padding: 14, borderRadius: 17, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, marginBottom: 9 },
  cardTitle: { fontFamily: df.display, fontSize: 14, color: d.ink },
  link: { color: d.plum, fontFamily: df.sansBold, fontSize: 12, paddingHorizontal: 6 },
  rulesLine: { fontFamily: df.sansBold, fontSize: 11, lineHeight: 17, color: d.sageDark, marginBottom: 8 },
  rowIconText: { fontSize: 10, color: d.plum },
});
