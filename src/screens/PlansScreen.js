import { isDarkScheme } from '../design/palette';
// BibleNestra Plus plans, rebuilt in the Figma design (Plans in extendedScreens.tsx): the plus hero, the
// benefit list, the plan options and the Paystack checkout. Prices come from the server (admin-set, Naira).
// Shown once after onboarding as a gate (`gate` prop, with "Continue free"), and any time from
// Profile → Account → Plan (the "Plans" route). Payment: Paystack (card, bank transfer, USSD) via src/billing —
// without Paystack keys, Subscribe explains that subscriptions open soon and nothing is charged.
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale } from '../components/Motion';
import { useStore } from '../store';
import { useToast } from '../components/Toast';
import { usePlus, buy, restore, cancelPlus } from '../billing';
import { paystackMessage, paystackError } from '../billing/paystack';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';
import { useNav } from '../navigation';
import { d, df, k, Grad, Tap, PageHeader } from '../design/sanctuary';

const BENEFITS = [
  { icon: 'quiz', title: 'No ads in your games', body: 'Play every round without video ads between questions.' },
  { icon: 'star', title: 'Supporter badge', body: 'A Plus badge on your profile.' },
  { icon: 'heart', title: 'Keep BibleNestra free', body: 'Scripture, prayer and community stay free for everyone.' },
];

function PlanCard({ plan, selected, onPress, flex }) {
  return (
    <PressScale
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.plan, selected && styles.planOn, { flex }]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${plan.label}, ${plan.priceText} ${plan.perText}${plan.badge ? `, ${plan.badge}` : ''}`}
    >
      {plan.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{plan.badge}</Text></View> : null}
      <Text style={styles.planLabel}>{plan.label}</Text>
      <Text style={styles.planPrice}>{plan.priceText}</Text>
      <Text style={styles.planPer}>{plan.perText}</Text>
      {plan.note ? <Text style={styles.planNote}>{plan.note}</Text> : null}
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
        <PlusHero label="BibleNestra Plus" title="Thank you for supporting BibleNestra" body="Your games are ad-free and your profile shows a Plus badge.">
          {sub && sub.hasAccess ? <Text style={styles.heroSub}>{sub.renewsOn ? `Renews on ${dateText(sub.renewsOn)} by card.` : `Plus runs until ${dateText(sub.accessUntil)}. Renew from here before then.`}</Text> : null}
        </PlusHero>
        {sub && sub.renewsOn ? (
          <PressScale onPress={onCancel} style={styles.outlineBtn} accessibilityRole="button" accessibilityLabel="Cancel renewal">
            <Text style={styles.outlineText}>Cancel renewal</Text>
          </PressScale>
        ) : null}
        {gate ? <PrimaryCta label="Continue" onPress={() => onDone && onDone('premium')} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <FadeInUp distance={10}>
        <PlusHero label="Plus supporter" title="Go ad-free and support the ministry" body="Everything you've seen stays free. Plus removes the ads and helps keep it that way." />
      </FadeInUp>

      <View style={styles.benefits}>
        {BENEFITS.map((b, i) => (
          <FadeInUp key={b.title} index={i} delay={120} distance={8} duration={340}>
            <View style={styles.benefit}>
              <View style={styles.benefitIcon}><Icon name={b.icon} size={18} color={d.plum} strokeWidth={2} /></View>
              <View style={styles.benefitText}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitBody}>{b.body}</Text>
              </View>
              <Icon name="check" size={16} color={d.sageDark} strokeWidth={2.4} />
            </View>
          </FadeInUp>
        ))}
      </View>

      <View style={styles.plans} accessibilityRole="radiogroup">
        {PLANS.map((p, i) => (
          <PlanCard
            key={p.id}
            plan={p}
            selected={p.id === choice}
            flex={PLANS.length === 2 ? (i === 0 ? 1.2 : 1) : 1}
            onPress={() => { setChoice(p.id); setNotice(null); }}
          />
        ))}
      </View>

      {notice ? (
        <FadeInUp distance={6} duration={260}>
          <View style={styles.notice}>
            <Icon name="clock" size={16} color={d.goldDark} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        </FadeInUp>
      ) : null}

      {needEmail ? (
        <View style={styles.emailWrap}>
          <Text style={styles.emailLabel}>Receipt email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email"
            placeholderTextColor={d.muted} accessibilityLabel="Email for your receipt" style={styles.emailInput} />
        </View>
      ) : null}
      <PrimaryCta label={`Continue with ${plan.label} · ${plan.priceText} ${plan.perText}`} onPress={subscribe} busy={busy} />

      <Text style={styles.fine}>
        {tester && !paystack ? 'Test purchase (admins and testers only) — no money moves. ' : ''}Secure checkout powered by Paystack: card, bank transfer or USSD. Paid by card, Plus renews automatically until you cancel here; bank transfer and USSD don’t renew — we remind you before it ends.
      </Text>
      <View style={styles.footRow}>
        <PressScale onPress={onRestore} style={styles.outlineBtn} accessibilityRole="button" accessibilityLabel="Restore purchases">
          <Text style={styles.outlineText}>Restore purchases</Text>
        </PressScale>
      </View>
    </View>
  );
}

// .plus-hero: the dark brown card with the star mark and the serif title
function PlusHero({ label, title, body, children }) {
  return (
    <Grad colors={['#25160D', '#5B2B13']} style={styles.hero}>
      <View style={styles.heroStar}><Icon name="star" size={64} color="#F2C979" strokeWidth={1.6} /></View>
      <Text style={styles.heroKicker}>{label}</Text>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroSub}>{body}</Text>
      {children}
    </Grad>
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
  const nav = useNav();
  return (
    <View style={k.screen}>
      <View style={styles.headerWrap}>
        <PageHeader title="BibleNestra Plus" subtitle="Go deeper" back onBack={() => nav.pop()} action={null} />
      </View>
      <ScrollView contentContainerStyle={[k.scroll, styles.routeScroll]} showsVerticalScrollIndicator={false}>
        <PlansContent />
      </ScrollView>
    </View>
  );
}

// First-run gate after onboarding: shown once, with "Continue free" in the header.
export function PlansGate({ onDone }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.headerWrap}>
        <PageHeader
          title="BibleNestra Plus"
          subtitle="Go deeper"
          action={(
            <Tap onPress={() => onDone && onDone('free')} accessibilityLabel="Continue free" hitSlop={8} style={styles.headerFree}>
              <Text style={styles.headerFreeText}>Continue free</Text>
            </Tap>
          )}
        />
      </View>
      <ScrollView contentContainerStyle={[k.scroll, styles.gateScroll]} showsVerticalScrollIndicator={false}>
        <PlansContent gate onDone={onDone} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: d.ivory },
  headerWrap: { paddingHorizontal: 18 },
  routeScroll: { paddingTop: 4 },
  gateScroll: { paddingTop: 4 },
  wrap: { width: '100%', maxWidth: 520, alignSelf: 'center' },

  // Hero
  hero: { borderRadius: 28, padding: 24, minHeight: 240, justifyContent: 'flex-end', overflow: 'hidden' },
  heroStar: { position: 'absolute', right: 20, top: 20, opacity: 0.6 },
  heroKicker: { color: '#F6C29E', fontFamily: df.sansHeavy, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  heroTitle: { color: '#FFFFFF', fontFamily: df.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, marginTop: 8, marginBottom: 6, maxWidth: 300 },
  heroSub: { color: '#D8C3B4', fontFamily: df.sans, fontSize: 13, lineHeight: 20, marginTop: 4 },

  // Benefits
  benefits: { marginTop: 18 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, borderBottomWidth: 1, borderBottomColor: d.line },
  benefitIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center' },
  benefitText: { flex: 1, minWidth: 0 },
  benefitTitle: { color: d.ink, fontFamily: df.displayBold, fontSize: 15 },
  benefitBody: { color: d.muted, fontFamily: df.sans, fontSize: 12, lineHeight: 17, marginTop: 2 },

  // Plan options
  plans: { flexDirection: 'row', gap: 9, marginTop: 18 },
  plan: { minHeight: 112, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, justifyContent: 'flex-end' },
  planOn: { borderWidth: 2, borderColor: d.plum, backgroundColor: (isDarkScheme() ? '#2a1a10' : '#ffede3') },
  badge: { position: 'absolute', top: 10, left: 10, backgroundColor: d.plum, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { color: '#FFFFFF', fontFamily: df.sansHeavy, fontSize: 9, letterSpacing: 0.6 },
  planLabel: { color: d.muted, fontFamily: df.sansBold, fontSize: 11, marginBottom: 2 },
  planPrice: { color: d.ink, fontFamily: df.displayBold, fontSize: 21, lineHeight: 26 },
  planPer: { color: d.muted, fontFamily: df.sans, fontSize: 11, marginTop: 1 },
  planNote: { color: d.muted, fontFamily: df.sans, fontSize: 11, marginTop: 2 },

  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: d.lavender },
  noticeText: { flex: 1, color: d.roseDark, fontFamily: df.sans, fontSize: 13, lineHeight: 18 },
  emailWrap: { marginTop: 14 },
  emailLabel: { color: (isDarkScheme() ? '#ffffff' : '#333333'), fontFamily: df.sansBold, fontSize: 12, marginBottom: 8 },
  emailInput: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.ivory, paddingHorizontal: 15, fontFamily: df.sans, fontSize: 14, color: d.ink },

  // CTA + footer
  cta: { marginTop: 18, height: 56, borderRadius: 18, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
    ...Platform.select({
      web: { boxShadow: '0 14px 30px rgba(255,107,26,0.22)' },
      default: { shadowColor: d.plum, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.22, shadowRadius: 22, elevation: 6 },
    }),
  },
  ctaText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 15 },
  fine: { marginTop: 14, color: d.muted, fontFamily: df.sans, fontSize: 11, lineHeight: 17, textAlign: 'center', paddingHorizontal: 10 },
  footRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  outlineBtn: { height: 42, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: (isDarkScheme() ? 'rgba(17,17,17,0.78)' : 'rgba(255,255,255,0.78)'), alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 10, alignSelf: 'center' },
  outlineText: { color: d.ink, fontFamily: df.sansBold, fontSize: 12 },

  headerFree: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: d.line, backgroundColor: (isDarkScheme() ? 'rgba(17,17,17,0.78)' : 'rgba(255,255,255,0.78)'), alignItems: 'center', justifyContent: 'center' },
  headerFreeText: { color: d.plum, fontFamily: df.sansBold, fontSize: 12 },
});
