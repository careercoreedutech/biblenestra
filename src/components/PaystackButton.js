// <PaystackButton method={row} label="Pay ₦700" start={(email) => api call} onSuccess={(r) => …} />
// One button for every Paystack checkout in the app (wallet packs, Dating Plus / VIP, Memberships, BibleNestra Plus).
// Handles: the receipt email (asked only when the server needs it), opening Paystack's page, waiting for the result,
// "I've paid, check again" for slow bank transfers, and plain-language errors. `method` is the server's Paystack row
// ({ available, label, note, test }); when it is unavailable the button shows why ("Coming soon", "Paused").
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { PressScale } from './Motion';
import { colors } from '../theme';
import { useApi } from '../api/auth';
import { payWithPaystack, checkPayment, paystackMessage, paystackError } from '../billing/paystack';

export function PaystackButton({ method, label = 'Pay with Paystack', start, onSuccess, style, textStyle, ghost = false, disabled = false }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [needEmail, setNeedEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [pendingRef, setPendingRef] = useState(null);
  const available = !!(method && method.available);
  const off = disabled || busy || !available;

  function finish(r) {
    setPendingRef(null);
    if (r.status === 'success') { setMsg(null); if (onSuccess) onSuccess(r); return; }
    if (r.status === 'pending' || r.status === 'abandoned') setPendingRef(r.reference || null);
    setMsg(paystackMessage(r.status));
  }

  async function pay() {
    if (off) return;
    if (needEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) { setMsg('Enter a valid email for your receipt.'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await payWithPaystack(api, start, { email: needEmail ? email.trim() : null });
      finish(r);
    } catch (e) {
      if (e && (e.code === 'EMAIL_REQUIRED' || e.code === 'BAD_EMAIL')) { setNeedEmail(true); setMsg('Paystack sends your receipt by email. Enter it once below.'); }
      else setMsg(paystackError(e));
    } finally { setBusy(false); }
  }

  async function recheck() {
    if (!pendingRef || busy) return;
    setBusy(true);
    try {
      const p = await checkPayment(api, pendingRef);
      finish({ status: p.status, payment: p, reference: pendingRef });
      if (p.status === 'pending') setPendingRef(pendingRef);
    } catch (e) { setMsg(paystackError(e)); } finally { setBusy(false); }
  }

  const text = available ? label : `${(method && method.label) || 'Paystack'} — ${(method && method.note) || 'Coming soon'}`;
  return (
    <View>
      {needEmail ? (
        <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email"
          style={s.input} placeholderTextColor={colors.muted} accessibilityLabel="Email for your receipt" />
      ) : null}
      <PressScale onPress={pay} scaleTo={0.98} style={[ghost ? s.ghost : s.primary, style, off && s.disabled]} accessibilityRole="button" accessibilityState={{ disabled: off }} accessibilityLabel={text}>
        {busy ? <ActivityIndicator color={ghost ? colors.primary : '#FFFFFF'} /> : <Text style={[ghost ? s.ghostText : s.primaryText, textStyle]}>{text}</Text>}
      </PressScale>
      {available ? <Text style={s.secure}>{`🔒 Secured by Paystack · Card, bank transfer or USSD${method.test ? ' · TEST MODE' : ''}`}</Text> : null}
      {msg ? <Text style={s.msg}>{msg}</Text> : null}
      {pendingRef ? (
        <PressScale onPress={recheck} scaleTo={0.98} style={s.ghost} accessibilityRole="button" accessibilityLabel="I've paid, check again">
          <Text style={s.ghostText}>I’ve paid, check again</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  primary: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  ghost: { marginTop: 8, borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  ghostText: { color: colors.fg, fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.5 },
  secure: { fontSize: 11.5, color: colors.muted, marginTop: 8, textAlign: 'center' },
  msg: { fontSize: 12.5, lineHeight: 18, color: colors.fg, marginTop: 8, textAlign: 'center' },
  input: { marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.fg, backgroundColor: colors.surface },
});
