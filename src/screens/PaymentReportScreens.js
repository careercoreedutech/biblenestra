// PAYMENT VERIFICATION (client brief 6.1 / 6.3). Route: nav.push('PaymentReport', { reference?, kind?, targetId?, planId?, title?, amountMinor? }).
// "Paid but not admitted?" links come from the Paystack button and the membership page. A screenshot never grants access:
// the report waits for a Paystack check by the team, and the member sees pending / approved / rejected here.
// Invitation links (biblenestra://membership-invite?token=…) open MembershipInviteScreen through useMembershipInviteLinks.
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { useToast } from '../components/Toast';
import { DScreen, DCard, DButton } from '../design/profile/parts';
import { Tap, d as D, df as DF } from '../design/sanctuary';
import { pickPhotos } from '../api/media';
import {
  uploadReceipt, reportOptions, myPaymentReports, submitPaymentReport, invitePreview, acceptInvite, parseMembershipInviteLink,
} from '../api/paymentReports';

const METHODS = [['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['ussd', 'USSD'], ['other', 'Other']];
const STATUS = { pending: ['Waiting for a check', D.gold, D.goldDark], approved: ['Approved', D.sage, D.sageDark], rejected: ['Not approved', D.rose, D.roseDark] };
const money = (minor, cur = 'NGN') => `${cur === 'NGN' ? '₦' : cur + ' '}${(Number(minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export function PaymentReportScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const [options, setOptions] = useState([]);
  const [mine, setMine] = useState([]);
  const [ref, setRef] = useState(params.reference || '');
  const [amount, setAmount] = useState(params.amountMinor ? String(Number(params.amountMinor) / 100) : '');
  const [method, setMethod] = useState(null);
  const [pick, setPick] = useState(params.kind ? { kind: params.kind, targetId: params.targetId, planId: params.planId || null, title: params.title || null } : null);
  const [photo, setPhoto] = useState(null); // { uri, key }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [o, m] = await Promise.all([reportOptions(api), myPaymentReports(api)]);
      setOptions(o.items || []);
      setMine(m.items || []);
    } catch (e) { setError(e.message); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  function choose(o) {
    setRef(o.reference);
    setAmount(String(o.amountMinor / 100));
    setPick({ kind: o.kind, targetId: o.targetId, planId: o.planId, title: o.title });
  }

  async function attach() {
    try {
      const [p] = await pickPhotos(1);
      if (!p) return;
      setBusy(true);
      const r = await uploadReceipt(api.request, p);
      setPhoto({ uri: p.uri, key: r.key });
      setError(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function send() {
    if (!ref.trim()) return setError('Enter the reference from your Paystack receipt');
    if (!amount.trim()) return setError('Enter the amount you paid');
    if (!method) return setError('Choose how you paid');
    if (!pick) return setError('Choose what the payment was for');
    if (!photo) return setError('Add a screenshot of your receipt');
    setBusy(true); setError(null);
    try {
      await submitPaymentReport(api, {
        reference: ref.trim(), amount: amount.trim(), method, kind: pick.kind, targetId: pick.targetId,
        planId: pick.planId || undefined, receiptKey: photo.key, note: note.trim() || undefined,
      });
      toast.show('Sent. We’ll check it with Paystack and confirm your access.');
      setRef(''); setAmount(''); setMethod(null); setPhoto(null); setNote(''); setPick(null);
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <DScreen title="Report a payment" subtitle="Paid but not admitted?" back onBack={() => nav.pop()}>
      <DCard>
        <Text style={s.body}>Send the Paystack reference and a screenshot of your receipt. We check the payment with Paystack before we give access. A screenshot alone never gives access.</Text>
      </DCard>

      {options.length ? (
        <View style={s.block}>
          <Text style={s.label}>Which payment?</Text>
          {options.slice(0, 8).map((o) => (
            <Tap key={o.reference} onPress={() => choose(o)} style={[s.option, pick && pick.targetId === o.targetId && ref === o.reference && s.optionOn]}>
              <Text style={s.optionTitle} numberOfLines={1}>{o.title || o.kind}</Text>
              <Text style={s.meta}>{money(o.amountMinor, o.currency)} · {o.status} · {o.reference}</Text>
            </Tap>
          ))}
        </View>
      ) : null}

      {pick && pick.kind === 'membership' && (params.plans || []).length ? (
        <View style={s.block}>
          <Text style={s.label}>Which plan?</Text>
          <View style={s.chips}>
            {params.plans.map((p) => (
              <Tap key={p.id} onPress={() => setPick({ ...pick, planId: p.id })} style={[s.chip, pick.planId === p.id && s.chipOn]}>
                <Text style={[s.chipText, pick.planId === p.id && s.chipTextOn]}>{p.name || 'Plan'}</Text>
              </Tap>
            ))}
          </View>
        </View>
      ) : null}

      <View style={s.block}>
        <Text style={s.label}>Paystack reference</Text>
        <TextInput value={ref} onChangeText={setRef} placeholder="e.g. bnw-3f2a…" autoCapitalize="none" autoCorrect={false} style={s.input} placeholderTextColor={D.muted} />
        <Text style={s.label}>Amount you paid (₦)</Text>
        <TextInput value={amount} onChangeText={setAmount} placeholder="200" keyboardType="decimal-pad" style={s.input} placeholderTextColor={D.muted} />
        <Text style={s.label}>How you paid</Text>
        <View style={s.chips}>
          {METHODS.map(([k, label]) => (
            <Tap key={k} onPress={() => setMethod(k)} style={[s.chip, method === k && s.chipOn]}>
              <Text style={[s.chipText, method === k && s.chipTextOn]}>{label}</Text>
            </Tap>
          ))}
        </View>
        <Text style={s.label}>Receipt screenshot</Text>
        {photo ? <Image source={{ uri: photo.uri }} style={s.receipt} /> : null}
        <DButton label={photo ? 'Replace screenshot' : 'Add screenshot'} onPress={attach} disabled={busy} small />
        <Text style={s.label}>Note (optional)</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="Anything that helps us find it" style={s.input} placeholderTextColor={D.muted} maxLength={500} />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <DButton label={busy ? 'Sending…' : 'Send for verification'} onPress={send} disabled={busy} />
      </View>

      {mine.length ? (
        <View style={s.block}>
          <Text style={s.label}>Your reports</Text>
          {mine.map((r) => {
            const [text, bg, fg] = STATUS[r.status] || STATUS.pending;
            return (
              <DCard key={r.id} style={s.report}>
                <View style={s.reportTop}>
                  <Text style={s.optionTitle} numberOfLines={1}>{r.title || r.kind}</Text>
                  <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeText, { color: fg }]}>{text}</Text></View>
                </View>
                <Text style={s.meta}>{r.displayAmount} · {r.reference}</Text>
                {r.status === 'rejected' && r.rejectReason ? <Text style={s.meta}>Reason: {r.rejectReason}</Text> : null}
                {r.status === 'approved' && r.accessExpiresAt ? <Text style={s.meta}>Access until {new Date(r.accessExpiresAt).toLocaleDateString('en-GB')}</Text> : null}
              </DCard>
            );
          })}
        </View>
      ) : null}
    </DScreen>
  );
}

export function MembershipInviteScreen({ params = {} }) {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const token = params.token;
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try { const r = await invitePreview(api, token); if (live) setInfo(r); } catch (e) { if (live) setError(e.message); }
    })();
    return () => { live = false; };
  }, [api, token]);

  async function join() {
    setBusy(true); setError(null);
    try {
      const r = await acceptInvite(api, token);
      toast.show('Welcome. You’re in.');
      nav.replace('Membership', { id: r.membershipId, title: info && info.membershipTitle });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const usable = info && info.usable;
  return (
    <DScreen title={info && info.membershipTitle ? info.membershipTitle : 'Membership invitation'} subtitle="Invitation" back onBack={() => nav.pop()}>
      <DCard>
        {!info && !error ? <Text style={s.body}>Checking your invitation…</Text> : null}
        {info && usable ? <Text style={s.body}>You’ve been invited to join {info.membershipTitle}{info.planName ? ` (${info.planName})` : ''}. This link works once.</Text> : null}
        {info && !usable ? <Text style={s.body}>{info.forThisAccount ? (info.status === 'open' ? 'This invitation can’t be used.' : 'This invitation link has expired or was already used. Ask the team for a new one.') : 'This invitation is for another account.'}</Text> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </DCard>
      {usable ? <DButton label={busy ? 'Joining…' : 'Join'} onPress={join} disabled={busy} /> : null}
    </DScreen>
  );
}

/** Opens the invitation screen for biblenestra://membership-invite?token=… (cold start and while the app is open). */
export function useMembershipInviteLinks(nav) {
  useEffect(() => {
    if (!nav) return undefined;
    const open = (url) => { const token = parseMembershipInviteLink(url); if (token) nav.push('MembershipInvite', { token }); };
    Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => open(e && e.url));
    return () => sub.remove();
  }, [!!nav]);
}

const s = StyleSheet.create({
  body: { fontFamily: DF.sans, fontSize: 14, lineHeight: 20, color: D.ink },
  block: { marginTop: 14, paddingHorizontal: 4 },
  label: { fontFamily: DF.sansSemi, fontSize: 13, color: D.muted, marginTop: 12, marginBottom: 6 },
  input: { fontFamily: DF.sans, fontSize: 15, color: D.ink, backgroundColor: D.paper, borderRadius: 12, borderWidth: 1, borderColor: D.line, paddingHorizontal: 12, paddingVertical: 10 },
  option: { backgroundColor: D.paper, borderRadius: 12, borderWidth: 1, borderColor: D.line, padding: 12, marginTop: 8 },
  optionOn: { borderColor: D.plum },
  optionTitle: { fontFamily: DF.sansSemi, fontSize: 15, color: D.ink },
  meta: { fontFamily: DF.sans, fontSize: 12, color: D.muted, marginTop: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: D.line, backgroundColor: D.paper },
  chipOn: { backgroundColor: D.plum, borderColor: D.plum },
  chipText: { fontFamily: DF.sansMedium, fontSize: 13, color: D.ink },
  chipTextOn: { color: '#FFFFFF' },
  receipt: { width: 160, height: 200, borderRadius: 12, marginBottom: 8, backgroundColor: D.lavender },
  error: { fontFamily: DF.sansMedium, fontSize: 13, color: D.roseDark, marginTop: 10 },
  report: { marginTop: 8 },
  reportTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontFamily: DF.sansSemi, fontSize: 11 },
});
