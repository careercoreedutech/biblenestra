// Pick a virtual gift and send it (spec §12). Reusable anywhere: chats (incl. dating chats), groups, profiles, live, posts.
//   <GiftSheet visible onClose recipient={{ id, name }} recipients={[{ id, name }]}? context={{ type, id }} onSent? allowNote? />
//   - context.type: 'chat' (conversation id) | 'profile' (user id) | 'live' (live session id) | 'post' (post id)
//                   | 'support' (no id: Support BibleNestra, 100% to BibleNestra — see SUPPORT_CONTEXT in api/gifts.js)
//   - recipients: groups — the sender picks who receives it
// Flow: choose → ConfirmSpend (cost + balance after; Buy Gifting Coins when short) → POST /gifts/send with ONE idempotency
// key per confirmation (kept while retrying) → full-screen animation → onSent(result) (result.message = the chat bubble).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PressScale } from '../Motion';
import { Icon } from '../Icons';
import { alpha } from '../ui';
import { colors, fonts } from '../../theme';
import { useApi } from '../../api/auth';
import { newIdempotencyKey, walletError } from '../../api/wallet';
import { useGiftCatalogue, sendGift, fmt } from '../../api/gifts';
import { WalletSheet, ws } from '../wallet/WalletSheet';
import { WalletBalancePill } from '../wallet/WalletBalancePill';
import { ConfirmSpend } from '../wallet/ConfirmSpend';
import { BuyCoinsSheet } from '../wallet/BuyCoinsSheet';
import { useNav } from '../../navigation';
import { GiftArt } from './GiftArt';
import { GiftPlayer } from './GiftPlayer';

export function GiftGrid({ items, selected, onPick, balance, animate = true, columns = 3 }) {
  return (
    <View style={styles.grid}>
      {items.map((g) => {
        const on = selected === g.id;
        const short = balance != null && g.coins > balance;
        return (
          <PressScale key={g.id} onPress={() => onPick(g)} scaleTo={0.95} style={[styles.cell, { width: `${100 / columns - 2}%` }, on && styles.cellOn]}
            accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${g.name}, ${fmt(g.coins)} Gifting Coins${short ? ', more than your balance' : ''}`}>
            {g.tier === 'premium' ? <View style={styles.premium}><Text style={styles.premiumText}>PREMIUM</Text></View> : null}
            <GiftArt gift={g} size={58} animate={animate && (on || g.tier === 'premium')} />
            <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
            <View style={styles.price}>
              <Icon name="coin" size={11} color={colors.gold} />
              <Text style={[styles.priceText, short && { color: colors.faint }]}>{fmt(g.coins)}</Text>
            </View>
          </PressScale>
        );
      })}
    </View>
  );
}

export function GiftSheet({ visible, onClose, recipient, recipients, context, onSent, allowNote, title }) {
  const api = useApi();
  const nav = useNav();
  const cat = useGiftCatalogue(context && context.type);
  const [pick, setPick] = useState(null);
  const [to, setTo] = useState(recipient || null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(null); // { gift, key }
  const lastConfirm = useRef(null); // keeps the confirm sheet's text while it animates out
  if (confirm) lastConfirm.current = confirm;
  const cs = confirm || lastConfirm.current;
  const [buying, setBuying] = useState(false);
  const [play, setPlay] = useState(null);
  useEffect(() => { if (visible) { setPick(null); setNote(''); setTo(recipient || (recipients && recipients.length === 1 ? recipients[0] : null)); } }, [visible]);
  const gift = useMemo(() => cat.items.find((g) => g.id === pick) || null, [cat.items, pick]);
  const pct = cat.rules.commissionPct != null ? cat.rules.commissionPct : 20;
  const noteOk = allowNote != null ? allowNote : !!(context && context.type === 'chat');
  const needPick = !!(recipients && recipients.length > 1 && !to);
  const support = !!(context && context.type === 'support'); // Support BibleNestra: 100% to BibleNestra, no gift earnings
  const subtitle = support
    ? 'Your gift supports BibleNestra. All of it goes to keeping the app running; nobody earns from it.'
    : `Gifts are bought with Gifting Coins. BibleNestra keeps ${pct}%; ${to && to.name ? to.name : 'they'} receive${to && to.name ? 's' : ''} ${100 - pct}% as gift earnings.`;

  const doSend = async () => {
    const r = await sendGift(api, { giftId: confirm.gift.id, context, recipientId: to && to.id, note: note.trim() || undefined, idempotencyKey: confirm.key });
    return r;
  };
  const done = (r) => {
    const g = confirm.gift;
    setConfirm(null);
    onClose && onClose();
    setPlay({ gift: { ...g }, to: (to && to.name) || (r && r.send && r.send.recipient && r.send.recipient.displayName), note: note.trim() || null, key: Date.now() });
    onSent && onSent(r);
  };

  return (
    <>
      <WalletSheet visible={!!visible && !confirm && !buying} onClose={onClose} title={title || (support ? 'Support BibleNestra' : to && to.name ? `Send ${to.name} a gift` : 'Send a gift')}
        subtitle={subtitle}>
        <View style={styles.bar}>
          <WalletBalancePill wallet="gift_coins" onPress={() => setBuying(true)} />
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => { onClose && onClose(); setTimeout(() => nav.push('GiftStore'), 150); }} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Store & history</Text>
          </Pressable>
        </View>
        {recipients && recipients.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
            {recipients.map((p) => (
              <PressScale key={p.id} onPress={() => setTo(p)} scaleTo={0.95} style={[styles.chip, to && to.id === p.id && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!(to && to.id === p.id) }}>
                <Text style={[styles.chipText, to && to.id === p.id && { color: '#FFFFFF' }]} numberOfLines={1}>{p.name}</Text>
              </PressScale>
            ))}
          </ScrollView>
        ) : null}
        <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ paddingVertical: 6 }}>
          {!cat.loaded ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} /> : null}
          {cat.loaded && !cat.online ? <Text style={ws.note}>Sign in online to send gifts.</Text> : null}
          {cat.error ? <Text style={[ws.note, { color: '#B3261E' }]}>{walletError(cat.error, 'Couldn’t load gifts')}</Text> : null}
          <GiftGrid items={cat.items} selected={pick} onPick={(g) => setPick(g.id)} balance={cat.balance} />
        </ScrollView>
        {noteOk && gift ? (
          <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 140))} placeholder="Add a short note (optional)" placeholderTextColor={colors.faint} style={styles.note} accessibilityLabel="Note with the gift" />
        ) : null}
        <PressScale onPress={() => gift && !needPick && setConfirm({ gift, key: newIdempotencyKey() })} scaleTo={0.98} style={[ws.primary, (!gift || needPick) && ws.disabled]}
          accessibilityRole="button" accessibilityState={{ disabled: !gift || needPick }}>
          <Text style={ws.primaryText}>{needPick ? 'Choose who receives it' : gift ? `Send ${gift.name} · ${fmt(gift.coins)} coins` : 'Choose a gift'}</Text>
        </PressScale>
      </WalletSheet>
      <ConfirmSpend
        visible={!!confirm}
        amount={cs ? cs.gift.coins : 0}
        wallet="gift_coins"
        title={cs ? (support ? `Support BibleNestra with ${cs.gift.name}` : `Send ${cs.gift.name}`) : 'Send gift'}
        description={cs ? (support
          ? `All ${fmt(cs.gift.coins)} coins go to BibleNestra to keep the app running. Thank you!`
          : `To ${(to && to.name) || 'them'}. They receive ${fmt(cs.gift.coins - Math.floor((cs.gift.coins * pct) / 100))} coins as gift earnings; BibleNestra keeps ${pct}%.`) : ''}
        confirmLabel={cs ? `Send for ${fmt(cs.gift.coins)} coins` : 'Send'}
        onConfirm={doSend}
        onDone={done}
        onClose={() => setConfirm(null)}
      />
      <BuyCoinsSheet visible={buying} wallet="gift_coins" onClose={() => setBuying(false)} />
      <GiftPlayer play={play} onDone={() => setPlay(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  cell: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  cellOn: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.06) },
  premium: { position: 'absolute', top: 5, right: 5, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 6, backgroundColor: alpha('#9C4FD6', 0.12) },
  premiumText: { fontSize: 7.5, fontWeight: '800', letterSpacing: 0.6, color: '#7B3BB3' },
  name: { fontSize: 12.5, fontWeight: '700', color: colors.fg, marginTop: 4, maxWidth: '100%' },
  price: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  priceText: { fontSize: 11.5, fontWeight: '700', color: colors.gold },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.raised, maxWidth: 160 },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.fg },
  note: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.fg, fontFamily: fonts.sans, outlineStyle: 'none' },
});
