// CHAT LIMITS (client #27, brief 7.5 / 10.3) — app side. The server enforces the rule (lib/chatLimits.js);
// this file only shows it:
//   <ChatSlotsCounter/>   "3 of 5 free chats used" in the new-chat flow (Chats › Find Believers)
//   <ChatLimitHost/>      mounted once in App.js: on 403 CHAT_LIMIT_REACHED (any request) shows the
//                         subscription prompt — plan cards in the Plans style, trial wording placeholder,
//                         "Upgrade" → Plans screen (billing isn't connected yet: nothing is charged here),
//                         "Invite a friend instead" → Invite friends screen.
//                         CHAT WEEK PASS: "Unlock more chats for a week with coins" (POST /chat/pass, idempotent),
//                         balance + ways to earn coins + "Buy coins" (→ Kingdom Wallet; Play Billing is Phase 3).
//   The counter shows "Extra chats until Tue 26 Nov" while a pass is active.
//   useInviteLinks()      biblenestra://invite/<code> (or web ?invite=<code>) → remembered, then redeemed
//                         with POST /me/referral once signed in (permanent "invited by").
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fonts, radius, shadow } from '../theme';
import { NightGlow, alpha } from './ui';
import { Icon } from './Icons';
import { AnimatedModal, FadeInUp, PressScale, Pulse, ScaleIn } from './Motion';
import { useApi } from '../api/auth';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from './Toast';
import { useStore } from '../store';
import { onChatLimit, notifyChatLimit, onChatPassChange, notifyChatPassChange } from '../api/chatLimitEvents';
import { PLANS } from '../billing';
import { AD_RULES } from '../ads/config'; // CHAT WEEK PASS: "ways to earn coins" numbers

// Trial wording placeholder (brief 10.3). Replace the price/date with the store offer once Play Billing is live.
const TRIAL_DAYS = 3;
export function trialCopy(plan) {
  const end = new Date(Date.now() + TRIAL_DAYS * 86400e3);
  const date = end.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return `Start your ${TRIAL_DAYS}-day free trial. Then ${plan.priceText} ${plan.perText}. Cancel anytime before ${date} and you won't be charged.`;
}

const BENEFITS = [
  { icon: 'chat', title: 'Unlimited conversations', body: 'Message any believer on BibleNestra.' },
  { icon: 'quiz', title: 'No ads in your games', body: 'Play every round without video ads.' },
  { icon: 'star', title: 'Supporter badge', body: 'Help keep Scripture and prayer free for all.' },
];

// ---------- allowance (GET /chat/allowance) ----------
export function useChatAllowance() {
  const api = useApi();
  const focused = useIsFocused();
  const [allowance, setAllowance] = useState(null);
  const load = useCallback(async () => {
    if (!api.online) return;
    try { setAllowance(await api.request('GET', '/chat/allowance')); } catch (e) { /* counter is optional */ }
  }, [api]);
  useEffect(() => { if (focused) load(); }, [focused, load]);
  useEffect(() => onChatLimit(() => load()), [load]);
  useEffect(() => onChatPassChange(() => load()), [load]); // CHAT WEEK PASS: bought → refresh the counter
  return { allowance, reload: load };
}

// CHAT WEEK PASS: "Tue 26 Nov"
export function passDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
}
const passGrant = (offer) => (!offer ? '' : offer.unlimited ? `Unlimited new chats for ${offer.days} days` : `+${offer.extraSlots} new chats for ${offer.days} days`);

// ---------- counter ----------
export function ChatSlotsCounter({ style }) {
  const nav = useNav();
  const { allowance } = useChatAllowance();
  if (!allowance || allowance.unlimited || !allowance.limit) return null;
  const { used, limit, pass } = allowance;
  const full = used >= limit;
  const blocked = allowance.remaining !== null && allowance.remaining <= 0; // free slots and any pass extras used up
  const passLine = pass ? `Extra chats until ${passDate(pass.until)} · ${pass.unlimited ? 'unlimited' : `${pass.remaining} of ${pass.extra} left`}` : null;
  const openSheet = () => notifyChatLimit({ used, limit, pass: allowance.pass, passOffer: allowance.passOffer });
  return (
    <View style={[s.counter, full && s.counterFull, style]} accessibilityRole="summary" accessibilityLabel={`${Math.min(used, limit)} of ${limit} free chats used${passLine ? `. ${passLine}` : ''}`}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.counterTitle}>{Math.min(used, limit)} of {limit} free chats used</Text>
        <View style={s.dots}>
          {Array.from({ length: Math.min(limit, 12) }).map((_, i) => <View key={i} style={[s.dot, i < used && (full ? s.dotFull : s.dotOn)]} />)}
        </View>
        {passLine ? (
          <View style={s.passLine}>
            <Icon name="coin" size={12} color={colors.gold} />
            <Text style={s.passLineText} numberOfLines={2}>{passLine}</Text>
          </View>
        ) : null}
        <Text style={s.counterSub}>{full ? 'Replies, groups and invited friends are still free.' : 'Invited friends, replies and groups don’t count.'}</Text>
      </View>
      <PressScale onPress={() => (blocked ? openSheet() : nav.push('InviteFriends'))} scaleTo={0.95} style={[s.counterBtn, blocked && { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={blocked ? 'Unlock more chats' : 'Invite friends'}>
        <Text style={[s.counterBtnText, blocked && { color: '#FFFFFF' }]}>{blocked ? 'Unlock' : 'Invite'}</Text>
      </PressScale>
    </View>
  );
}

/** CHAT WEEK PASS: compact line for the chat list while a pass is active ("Extra chats until Tue 26 Nov · 7 left"). */
export function ChatPassBadge({ style }) {
  const { allowance } = useChatAllowance();
  const pass = allowance && !allowance.unlimited ? allowance.pass : null;
  if (!pass) return null;
  const left = pass.unlimited ? 'unlimited new chats' : `${pass.remaining} new ${pass.remaining === 1 ? 'chat' : 'chats'} left`;
  return (
    <View style={[s.badgeLine, style]} accessibilityRole="text" accessibilityLabel={`Extra chats until ${passDate(pass.until)}, ${left}`}>
      <Icon name="coin" size={12} color={colors.gold} />
      <Text style={s.passLineText} numberOfLines={1}>Extra chats until {passDate(pass.until)} · {left}</Text>
    </View>
  );
}

// ---------- CHAT WEEK PASS card (inside the limit sheet) ----------
// Ways to earn coins that already exist in the app (server-side rewards): daily Bible games, rewarded ads in
// Jobs, contest prizes. Real-money coin packs wait on Google Play Billing (Phase 3) — see
// backend/src/lib/coinPurchases.js creditPurchasedCoins().
const EARN_WAYS = [
  { icon: 'quiz', title: 'Play today’s Bible games', body: '5 coins for every correct answer in your first round', route: 'Learn', params: { tab: 'Games' } },
  { icon: 'play', title: 'Watch short ads in Jobs', body: `${AD_RULES.jobAdsForCoins} short ads unlock ${AD_RULES.jobAdCoins} coins`, route: 'Jobs' },
  { icon: 'star', title: 'Enter contests', body: 'Winners receive coin prizes', route: 'Contests' },
];

function WeekPassCard({ offer, pass, coins, busy, onBuy, onEarn, onBuyCoins }) {
  if (!offer) return null;
  const enough = coins != null && coins >= offer.coins;
  const short = coins == null ? offer.coins : Math.max(0, offer.coins - coins);
  return (
    <View style={s.pass}>
      <View style={s.passHead}>
        <View style={s.passIcon}><Icon name="coin" size={17} color={colors.gold} strokeWidth={2} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.passTitle}>Unlock more chats for a week with coins</Text>
          <Text style={s.passBody}>{passGrant(offer)} · {offer.coins} coins</Text>
        </View>
      </View>
      {pass ? (
        <Text style={s.passActive}>Extra chats until {passDate(pass.until)}{pass.unlimited ? '' : ` · ${pass.remaining} of ${pass.extra} left`}. Buying again adds a week from that date.</Text>
      ) : null}
      <View style={s.balanceRow}>
        <Text style={s.balance}>Your balance: <Text style={{ fontWeight: '700', color: colors.fg }}>{coins == null ? '…' : coins} coins</Text></Text>
        {!enough && coins != null ? <Text style={s.need}>{short} more needed</Text> : null}
      </View>
      {enough ? (
        <PressScale onPress={busy ? undefined : onBuy} scaleTo={0.97} style={[s.passCta, busy && { opacity: 0.6 }]} accessibilityRole="button" accessibilityState={{ busy: !!busy }} accessibilityLabel={`${pass ? 'Add a week' : 'Unlock'} for ${offer.coins} coins`}>
          <Icon name="coin" size={15} color="#FFFFFF" />
          <Text style={s.ctaText} numberOfLines={1}>{busy ? 'Unlocking…' : `${pass ? 'Add a week' : 'Unlock'} for ${offer.coins} coins`}</Text>
        </PressScale>
      ) : coins == null ? null : (
        <View>
          <Text style={s.earnHead}>Ways to earn coins</Text>
          {EARN_WAYS.map((w) => (
            <PressScale key={w.title} onPress={() => onEarn(w)} scaleTo={0.98} style={s.earn} accessibilityRole="button" accessibilityLabel={`${w.title}. ${w.body}`}>
              <Icon name={w.icon} size={15} color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.earnTitle}>{w.title}</Text>
                <Text style={s.earnBody}>{w.body}</Text>
              </View>
              <Icon name="chevron-right" size={14} color={colors.faint} />
            </PressScale>
          ))}
          <PressScale onPress={onBuyCoins} scaleTo={0.97} style={s.buyCoins} accessibilityRole="button" accessibilityLabel="Buy coins. Coin packs are coming soon; opens your Kingdom Wallet">
            <Icon name="coin" size={15} color={colors.goldMuted} />
            <Text style={s.buyCoinsText}>Buy coins</Text>
          </PressScale>
          <Text style={s.fine}>Coin packs with Google Play are coming soon — nothing can be charged yet. Buy coins opens your Kingdom Wallet.</Text>
        </View>
      )}
    </View>
  );
}

// ---------- subscription prompt ----------
function MiniPlan({ plan, selected, onPress }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.98} style={[s.plan, selected && s.planOn]} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${plan.label}, ${plan.priceText} ${plan.perText}`}>
      <View style={[s.radio, selected && s.radioOn]}>{selected ? <Icon name="check" size={11} color="#FFFFFF" strokeWidth={3} /> : null}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.planTop}>
          <Text style={s.planLabel}>{plan.label}</Text>
          {plan.badge ? <View style={s.badge}><Text style={s.badgeText}>{plan.id === 'yearly' ? 'Best value' : plan.badge}</Text></View> : null}
        </View>
        <Text style={s.planNote}>{plan.note}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.planPrice}>{plan.priceText}</Text>
        <Text style={s.planPer}>{plan.perText}</Text>
      </View>
    </PressScale>
  );
}

export function ChatLimitPrompt({ visible, used = 5, limit = 5, onClose, onUpgrade, onInvite, pass, passOffer, coins, buying, onBuyPass, onEarn, onBuyCoins }) {
  const [choice, setChoice] = useState('yearly');
  const plan = PLANS.find((p) => p.id === choice) || PLANS[0];
  const { height } = useWindowDimensions();
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <View style={[s.sheet, { maxHeight: Math.round(height * 0.94) }]}>
          <View style={s.hero}>
            <NightGlow intensity={1.1} />
            <View style={s.heroInner}>
              <ScaleIn from={0.7} delay={60}>
                <View style={s.orbWrap}>
                  <Pulse min={0.94} max={1.06} duration={2400} style={s.orbHalo} />
                  <View style={s.orb}><Icon name="chat" size={26} color={colors.goldLight} strokeWidth={1.8} /></View>
                </View>
              </ScaleIn>
              <Text style={s.eyebrow}>BibleNestra Plus</Text>
              <Text style={s.title}>You've connected with {limit} believers</Text>
              <Text style={s.sub}>{passOffer ? 'Unlock more chats for a week with coins, or upgrade for unlimited conversations.' : 'Upgrade for unlimited conversations.'}</Text>
            </View>
            <PressScale onPress={onClose} style={s.close} accessibilityRole="button" accessibilityLabel="Close"><Icon name="x" size={16} color={colors.nightFg} /></PressScale>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
            <WeekPassCard offer={passOffer} pass={pass} coins={coins} busy={buying} onBuy={onBuyPass} onEarn={onEarn} onBuyCoins={onBuyCoins} />
            {passOffer ? <Text style={s.orHead}>Or go unlimited with BibleNestra Plus</Text> : null}
            {BENEFITS.map((b, i) => (
              <FadeInUp key={b.title} index={i} delay={80} distance={6} duration={300}>
                <View style={s.benefit}>
                  <View style={s.benefitIcon}><Icon name={b.icon} size={15} color={colors.primary} strokeWidth={2} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.benefitTitle}>{b.title}</Text>
                    <Text style={s.benefitBody}>{b.body}</Text>
                  </View>
                </View>
              </FadeInUp>
            ))}

            <View style={s.plans} accessibilityRole="radiogroup">
              {PLANS.map((p) => <MiniPlan key={p.id} plan={p} selected={p.id === choice} onPress={() => setChoice(p.id)} />)}
            </View>
            <Text style={s.trial}>{trialCopy(plan)}</Text>

            <PressScale onPress={() => onUpgrade && onUpgrade(plan)} scaleTo={0.97} style={s.cta} accessibilityRole="button" accessibilityLabel="Upgrade for unlimited chats">
              <Text style={s.ctaText} numberOfLines={1}>Upgrade for unlimited chats</Text>
            </PressScale>
            <PressScale onPress={onInvite} scaleTo={0.97} style={s.invite} accessibilityRole="button" accessibilityLabel="Invite a friend instead. Invited friends are unlimited">
              <Icon name="users" size={16} color={colors.primary} />
              <View style={{ flexShrink: 1 }}>
                <Text style={s.inviteText}>Invite a friend instead</Text>
                <Text style={s.inviteSub}>Invited friends are unlimited</Text>
              </View>
            </PressScale>
            <Text style={s.fine}>{used} of {limit} free chats used · replies and groups stay free. Billed through Google Play when subscriptions open — nothing is charged today.</Text>
          </ScrollView>
        </View>
      </View>
    </AnimatedModal>
  );
}

const newPassKey = () => `pass_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

/** Mounted once (App.js, inside the navigator): shows the prompt whenever the server says CHAT_LIMIT_REACHED. */
export function ChatLimitHost() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [info, setInfo] = useState(null);
  const [coins, setCoins] = useState(null);
  const [buying, setBuying] = useState(false);
  // CHAT WEEK PASS: one idempotency key per purchase attempt. A retry after a dropped connection reuses it, so the
  // server never charges twice; a new key is made after a success or when the sheet opens again.
  const passKey = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => onChatLimit((i) => {
    const st = stateRef.current;
    if (st.premium) return; // stale: the server will agree on the next sync
    setInfo(i);
    setCoins(typeof st.coins === 'number' ? st.coins : null);
    passKey.current = newPassKey();
    if (!api.online) return;
    // frequency guard bookkeeping (server-tracked last shown); the chat-limit prompt answers a tap, so it's always shown
    api.request('POST', '/paywall/impression', { placement: 'chat_limit' }).catch(() => {});
    // fresh balance + offer + pass for the sheet
    api.request('GET', '/chat/allowance').then((a) => {
      if (a.unlimited) { setInfo(null); return; } // admin / subscriber: nothing to show
      setCoins(a.coins);
      setInfo((cur) => (cur ? { ...cur, pass: a.pass, passOffer: a.passOffer || cur.passOffer } : cur));
    }).catch(() => {});
  }), [api]);
  const close = () => setInfo(null);
  const buyPass = async () => {
    if (!api.online || buying) return;
    setBuying(true);
    try {
      const r = await api.request('POST', '/chat/pass', { idempotencyKey: passKey.current });
      passKey.current = newPassKey();
      setCoins(r.coins);
      const st = stateRef.current;
      dispatch({ type: 'serverSync', patch: {
        coins: r.coins,
        coinLog: r.replay ? st.coinLog : [{ id: 'cl' + Date.now(), amount: -r.purchase.coins, reason: 'Chat week pass (extra new chats)', time: new Date().toISOString() }, ...(st.coinLog || [])].slice(0, 60),
      } });
      notifyChatPassChange(r);
      close();
      toast.show(`Extra chats until ${passDate(r.pass ? r.pass.until : r.purchase.expiresAt)}. Go ahead and say hello`, { icon: 'chat', haptic: 'success', duration: 3600 });
    } catch (e) {
      if (e && e.code === 'INSUFFICIENT_COINS') {
        const bal = e.data && typeof e.data.balance === 'number' ? e.data.balance : null;
        if (bal != null) { setCoins(bal); dispatch({ type: 'serverSync', patch: { coins: bal } }); }
        toast.show(e.message || 'Not enough coins yet', { icon: 'coin' });
      } else if (e && e.code === 'PASS_NOT_NEEDED') {
        close();
        toast.show(e.message, { icon: 'chat' });
      } else {
        toast.show((e && e.message) || 'Couldn’t unlock chats. Please try again', { icon: 'x' });
      }
    } finally { setBuying(false); }
  };
  return (
    <ChatLimitPrompt
      visible={!!info}
      used={info ? info.used : 0}
      limit={info ? info.limit : 5}
      pass={info ? info.pass : null}
      passOffer={info && api.online ? info.passOffer : null}
      coins={coins}
      buying={buying}
      onBuyPass={buyPass}
      onEarn={(w) => { close(); nav.push(w.route, w.params); }}
      onBuyCoins={() => {
        close();
        nav.push('Profile', { tab: 'Wallet & Gifts' });
        toast.show('Coin packs are coming soon with Google Play. Earn coins from games, ads and contests meanwhile', { icon: 'coin', duration: 4200 });
      }}
      onClose={close}
      onUpgrade={() => { close(); nav.push('Plans'); }}
      onInvite={() => { close(); nav.push('InviteFriends'); }}
    />
  );
}

// ---------- invite deep links ----------
const PENDING_KEY = 'bn.pendingInviteCode';
export const parseInviteCode = (url) => {
  if (!url) return null;
  const m = String(url).match(/(?:invite\/|\/i\/|[?&]invite=)([A-Za-z0-9]{4,16})/);
  return m ? m[1].toUpperCase() : null;
};
export async function rememberInviteCode(code) {
  try { if (code) await AsyncStorage.setItem(PENDING_KEY, code); } catch (e) { /* ignore */ }
}

/** Root-level hook: capture invite links and redeem the remembered code once signed in. */
export function useInviteLinks() {
  const api = useApi();
  const toast = useToast();
  const redeem = useCallback(async () => {
    if (!api.online) return;
    let code = null;
    try { code = await AsyncStorage.getItem(PENDING_KEY); } catch (e) { return; }
    if (!code) return;
    try {
      const r = await api.request('POST', '/me/referral', { code });
      if (!r.already) toast.show(`You joined with ${r.inviterName || 'a friend'}’s invite — you can always chat with each other`, { icon: 'users', haptic: 'success' });
    } catch (e) {
      if (e && e.code === 'NETWORK') return; // try again next launch
    }
    try { await AsyncStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
  }, [api, toast]);
  useEffect(() => {
    let alive = true;
    const take = async (url) => { const c = parseInviteCode(url); if (c) { await rememberInviteCode(c); if (alive) redeem(); } };
    Linking.getInitialURL().then(take).catch(() => {});
    if (Platform.OS === 'web' && typeof window !== 'undefined') take(window.location && window.location.href);
    const sub = Linking.addEventListener('url', (e) => take(e && e.url));
    redeem();
    return () => { alive = false; if (sub && sub.remove) sub.remove(); };
  }, [redeem]);
}

const s = StyleSheet.create({
  counter: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  counterFull: { backgroundColor: colors.cardGold, borderColor: alpha('#D4A852', 0.4) },
  counterTitle: { fontSize: 14, fontWeight: '700', color: colors.fg },
  counterSub: { marginTop: 4, fontSize: 12, color: colors.muted },
  dots: { flexDirection: 'row', gap: 5, marginTop: 6 },
  dot: { width: 18, height: 6, borderRadius: 3, backgroundColor: colors.raised },
  dotOn: { backgroundColor: colors.positive },
  dotFull: { backgroundColor: colors.gold },
  counterBtn: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  passLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.cardGold },
  passLineText: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: colors.goldMuted },

  // CHAT WEEK PASS card
  pass: { padding: 12, borderRadius: radius.lg, backgroundColor: colors.cardGold, borderWidth: 1, borderColor: alpha('#D4A852', 0.4), marginBottom: 12 },
  passHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  passIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: alpha('#D4A852', 0.18), alignItems: 'center', justifyContent: 'center' },
  passTitle: { fontFamily: fonts.serifBold, fontSize: 16, lineHeight: 20, color: colors.fg },
  passBody: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  passActive: { marginTop: 8, fontSize: 12.5, lineHeight: 17, fontWeight: '600', color: colors.goldMuted },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  balance: { fontSize: 13, color: colors.muted },
  need: { fontSize: 12, fontWeight: '700', color: colors.goldMuted },
  passCta: { marginTop: 10, height: 46, borderRadius: radius.pill, backgroundColor: colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  earnHead: { marginTop: 10, marginBottom: 4, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  earn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.surface, marginTop: 6 },
  earnTitle: { fontSize: 13.5, fontWeight: '700', color: colors.fg },
  earnBody: { fontSize: 12, color: colors.muted },
  buyCoins: { marginTop: 10, height: 44, borderRadius: radius.pill, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: alpha('#D4A852', 0.6), backgroundColor: colors.surface },
  buyCoinsText: { fontSize: 14, fontWeight: '700', color: colors.goldMuted },
  orHead: { marginBottom: 8, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.muted, textAlign: 'center' },

  sheetWrap: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 520, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', backgroundColor: colors.screen, ...shadow.md },
  hero: { backgroundColor: colors.night, overflow: 'hidden' },
  heroInner: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 18 },
  close: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  orbWrap: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center' },
  orbHalo: { position: 'absolute', width: 78, height: 78, borderRadius: 39, backgroundColor: alpha('#D4A852', 0.14) },
  orb: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1.5, borderColor: alpha('#D4A852', 0.55), alignItems: 'center', justifyContent: 'center' },
  eyebrow: { marginTop: 10, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.goldLight },
  title: { marginTop: 6, fontFamily: fonts.serifBold, fontSize: 23, lineHeight: 28, letterSpacing: -0.3, color: colors.nightFg, textAlign: 'center' },
  sub: { marginTop: 6, fontSize: 14, lineHeight: 20, color: colors.nightMuted, textAlign: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  benefitIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  benefitTitle: { fontSize: 14, fontWeight: '700', color: colors.fg },
  benefitBody: { fontSize: 12.5, color: colors.muted },
  plans: { marginTop: 6, gap: 8 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  planOn: { borderColor: colors.primary, backgroundColor: '#FBFBFE' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  planLabel: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg },
  badge: { paddingHorizontal: 8, height: 20, borderRadius: radius.pill, backgroundColor: colors.cardGold, justifyContent: 'center' },
  badgeText: { fontSize: 10.5, fontWeight: '700', color: colors.goldMuted },
  planNote: { fontSize: 12, color: colors.muted, marginTop: 1 },
  planPrice: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg },
  planPer: { fontSize: 11.5, color: colors.muted },
  trial: { marginTop: 10, fontSize: 12.5, lineHeight: 18, color: colors.fg, textAlign: 'center' },
  cta: { marginTop: 12, height: 50, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, ...shadow.sm },
  ctaText: { fontSize: 15.5, fontWeight: '700', color: '#FFFFFF' },
  invite: { marginTop: 10, minHeight: 50, borderRadius: radius.pill, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, paddingHorizontal: 18, paddingVertical: 6 },
  inviteText: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  inviteSub: { fontSize: 11.5, color: colors.muted },
  fine: { marginTop: 12, fontSize: 11, lineHeight: 15, color: colors.faint, textAlign: 'center' },
});
