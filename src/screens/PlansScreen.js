// BibleNestra Plus plans (yearly preselected, best value; weekly). Prices come from the server (admin-set, Naira).
// Shown once after onboarding as a gate (`gate` prop, with "Continue free"), and any time from
// Profile → Account → Plan (the "Plans" route). Payment: Paystack (card, bank transfer, USSD) via src/billing —
// without Paystack keys, Subscribe explains that subscriptions open soon and nothing is charged.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, shadow } from '../theme';
import { NightGlow, Screen, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale, Pulse, ScaleIn } from '../components/Motion';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { usePlus, buy, restore, cancelPlus } from '../billing';
import { paystackMessage, paystackError } from '../billing/paystack';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';

const BENEFITS = [
  { icon: 'quiz', title: 'No ads in your games', body: 'Play every round without video ads between questions.' },
  { icon: 'star', title: 'Supporter badge', body: 'A Plus badge on your profile.' },
  { icon: 'heart', title: 'Keep BibleNestra free', body: 'Scripture, prayer and community stay free for everyone.' },
];

function PlanCard({ plan, selected, onPress }) {
  return (
    <PressScale
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.plan, selected && styles.planOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${plan.label}, ${plan.priceText} ${plan.perText}${plan.badge ? `, ${plan.badge}` : ''}`}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.planTop}>
          <Text style={styles.planLabel}>{plan.label}</Text>
          {plan.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{plan.badge}</Text></View> : null}
        </View>
        <Text style={styles.planNote}>{plan.note}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.planPrice}>{plan.priceText}</Text>
        <Text style={styles.planPer}>{plan.perText}</Text>
      </View>
    </PressScale>
  );
}

function PlansContent({ gate, onDone }) {
  const { state } = useStore();
  const toast = useToast();
  const api = useApi();
  const sync = useSync();
  const plus = usePlus(api);
  const PLANS = plus.plans;
  const [choice, setChoice] = useState('yearly');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [needEmail, setNeedEmail] = useState(false);
  const [email, setEmail] = useState('');
  const plan = PLANS.find((p) => p.id === choice) || PLANS[0];
  const methods = (plus.data && plus.data.methods) || [];
  const paystack = methods.find((m) => m.provider === 'paystack' && m.available);
  const tester = methods.find((m) => m.provider === 'test');
  const sub = plus.data && plus.data.subscription;

  const subscribe = async () => {
    const provider = paystack ? 'paystack' : tester ? 'test' : null;
    if (!provider) {
      const row = methods.find((m) => m.provider === 'paystack');
      setNotice(row && /Paused/.test(row.note || '') ? 'Payments are paused for a moment. Please try again later.' : "Subscriptions open soon. You haven't been charged — enjoy BibleNestra free for now.");
      return;
    }
    if (needEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) { setNotice('Enter a valid email for your receipt.'); return; }
    setBusy(true); setNotice(null);
    try {
      const r = await buy(api, plan, { provider, email: needEmail ? email.trim() : null });
      if (r.status !== 'success') { setNotice(paystackMessage(r.status)); return; }
      if (sync.refresh) await sync.refresh().catch(() => {});
      plus.reload();
      toast.show('Welcome to BibleNestra Plus!', { icon: 'sparkles', haptic: 'success' });
      if (onDone) onDone('subscribed');
    } catch (e) {
      if (e && (e.code === 'EMAIL_REQUIRED' || e.code === 'BAD_EMAIL')) { setNeedEmail(true); setNotice('Paystack emails your receipt. Enter your email once below.'); return; }
      setNotice(e && e.code === 'BILLING_NOT_READY' ? e.message : `${paystackError(e, 'The purchase didn’t go through')} You haven't been charged.`);
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    try {
      if (await restore(api)) {
        if (sync.refresh) await sync.refresh().catch(() => {});
        toast.show('Plus restored', { icon: 'check', haptic: 'success' });
      } else setNotice('No active Plus plan found on this account.');
    } catch (e) {
      setNotice(e && e.code === 'BILLING_NOT_READY' ? e.message : 'Couldn’t check right now — try again.');
    }
  };

  const onCancel = async () => {
    try { await cancelPlus(api); plus.reload(); toast.show('Renewal turned off — you keep Plus until the end of this period', { icon: 'check' }); }
    catch (e) { toast.show(paystackError(e, 'Couldn’t cancel'), { tone: 'error' }); }
  };
  const dateText = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };

  if (state.premium) {
    return (
      <View style={styles.wrap}>
        <View style={styles.hero}>
          <NightGlow intensity={1.1} />
          <View style={styles.heroInner}>
            <View style={styles.orb}><Icon name="star" size={30} color={colors.goldLight} strokeWidth={1.8} /></View>
            <Text style={styles.heroEyebrow}>BibleNestra Plus</Text>
            <Text style={styles.heroTitle}>Thank you for supporting BibleNestra</Text>
            <Text style={styles.heroSub}>Your games are ad-free and your profile shows a Plus badge.</Text>
            {sub && sub.hasAccess ? <Text style={styles.heroSub}>{sub.renewsOn ? `Renews on ${dateText(sub.renewsOn)} by card.` : `Plus runs until ${dateText(sub.accessUntil)}. Renew from here before then.`}</Text> : null}
          </View>
        </View>
        {sub && sub.renewsOn ? (
          <PressScale onPress={onCancel} style={styles.restoreBtn} accessibilityRole="button" accessibilityLabel="Cancel renewal">
            <Text style={styles.restoreText}>Cancel renewal</Text>
          </PressScale>
        ) : null}
        {gate ? <PrimaryCta label="Continue" onPress={() => onDone && onDone('premium')} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <FadeInUp distance={10}>
        <View style={styles.hero}>
          <NightGlow intensity={1.1} />
          <View style={styles.heroInner}>
            <ScaleIn from={0.7} delay={80}>
              <View style={styles.orbWrap}>
                <Pulse min={0.94} max={1.06} duration={2400} style={styles.orbHalo} />
                <View style={styles.orb}><Icon name="star" size={30} color={colors.goldLight} strokeWidth={1.8} /></View>
              </View>
            </ScaleIn>
            <Text style={styles.heroEyebrow}>BibleNestra Plus</Text>
            <Text style={styles.heroTitle}>Go ad-free and support the ministry</Text>
            <Text style={styles.heroSub}>Everything you've seen stays free. Plus removes the ads and helps keep it that way.</Text>
          </View>
        </View>
      </FadeInUp>

      <View style={styles.benefits}>
        {BENEFITS.map((b, i) => (
          <FadeInUp key={b.title} index={i} delay={120} distance={8} duration={340}>
            <View style={styles.benefit}>
              <View style={styles.benefitIcon}><Icon name={b.icon} size={17} color={colors.primary} strokeWidth={2} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitBody}>{b.body}</Text>
              </View>
            </View>
          </FadeInUp>
        ))}
      </View>

      <View style={styles.plans} accessibilityRole="radiogroup">
        {PLANS.map((p) => <PlanCard key={p.id} plan={p} selected={p.id === choice} onPress={() => { setChoice(p.id); setNotice(null); }} />)}
      </View>

      {notice ? (
        <FadeInUp distance={6} duration={260}>
          <View style={styles.notice}>
            <Icon name="clock" size={16} color={colors.gold} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        </FadeInUp>
      ) : null}

      {needEmail ? (
        <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email"
          placeholderTextColor={colors.muted} accessibilityLabel="Email for your receipt"
          style={{ marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.fg, backgroundColor: colors.surface }} />
      ) : null}
      <PrimaryCta label={`Continue with ${plan.label} · ${plan.priceText} ${plan.perText}`} onPress={subscribe} busy={busy} />
      {gate ? (
        <PressScale onPress={() => onDone && onDone('free')} style={styles.freeBtn} accessibilityRole="button" accessibilityLabel="Continue free">
          <Text style={styles.freeText}>Continue free</Text>
        </PressScale>
      ) : null}

      <Text style={styles.fine}>
        {tester && !paystack ? 'Test purchase (admins and testers only) — no money moves. ' : ''}Paid securely through Paystack: card, bank transfer or USSD. Paid by card, Plus renews automatically until you cancel here; bank transfer and USSD don’t renew — we remind you before it ends.
      </Text>
      <PressScale onPress={onRestore} style={styles.restoreBtn} accessibilityRole="button" accessibilityLabel="Restore purchases">
        <Text style={styles.restoreText}>Restore purchases</Text>
      </PressScale>
    </View>
  );
}

function PrimaryCta({ label, onPress, busy }) {
  return (
    <PressScale onPress={onPress} disabled={busy} scaleTo={0.97} style={[styles.cta, busy && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.ctaText} numberOfLines={1}>{busy ? 'Opening Paystack…' : label}</Text>
    </PressScale>
  );
}

// Route: Profile → Account → Plan
export function PlansScreen() {
  return (
    <Screen back title="BibleNestra Plus" subtitle="Ad-free games · supporter badge">
      <PlansContent />
    </Screen>
  );
}

// First-run gate after onboarding: shown once, with "Continue free".
export function PlansGate({ onDone }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.gateScroll} showsVerticalScrollIndicator={false}>
        <PlansContent gate onDone={onDone} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.screen },
  gateScroll: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  wrap: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingTop: 4 },

  hero: { borderRadius: 26, overflow: 'hidden', backgroundColor: colors.night, ...shadow.md },
  heroInner: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 22 },
  orbWrap: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
  orbHalo: { position: 'absolute', width: 92, height: 92, borderRadius: 46, backgroundColor: alpha('#D4A852', 0.14) },
  orb: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1.5, borderColor: alpha('#D4A852', 0.55), alignItems: 'center', justifyContent: 'center' },
  heroEyebrow: { marginTop: 12, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.goldLight },
  heroTitle: { marginTop: 6, fontFamily: fonts.serifBold, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, color: colors.nightFg, textAlign: 'center' },
  heroSub: { marginTop: 8, fontSize: 14, lineHeight: 20, color: colors.nightMuted, textAlign: 'center', maxWidth: 380 },

  benefits: { marginTop: 18, gap: 12 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  benefitTitle: { fontSize: 15, fontWeight: '700', color: colors.fg },
  benefitBody: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 1 },

  plans: { marginTop: 20, gap: 10 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, ...shadow.sm },
  planOn: { borderColor: colors.primary, backgroundColor: '#FBFBFE' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  planLabel: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  badge: { paddingHorizontal: 8, height: 22, borderRadius: radius.pill, backgroundColor: colors.cardGold, justifyContent: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.goldMuted },
  planNote: { fontSize: 13, color: colors.muted, marginTop: 2 },
  planPrice: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg },
  planPer: { fontSize: 12, color: colors.muted },

  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14, padding: 12, borderRadius: radius.md, backgroundColor: colors.cardGold },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.fg },

  cta: { marginTop: 18, height: 52, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, ...shadow.sm },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  freeBtn: { marginTop: 10, height: 46, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  freeText: { fontSize: 15, fontWeight: '700', color: colors.fg },
  fine: { marginTop: 14, fontSize: 11.5, lineHeight: 16, color: colors.faint, textAlign: 'center' },
  restoreBtn: { alignSelf: 'center', marginTop: 6, paddingVertical: 8, paddingHorizontal: 12 },
  restoreText: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
