// <BuyCoinsSheet visible wallet="dating_coins" onClose onPurchased /> — package picker + checkout for a purchasable
// wallet (fundme_credits | dating_coins | gift_coins). <BuyCoinsSheet visible plans … /> lists Dating Plus / VIP instead.
//
// Payments: Paystack for every purchase (client decision 2026-11-21) — <PaystackButton> opens Paystack's page (card,
// bank transfer, USSD); the server verifies with Paystack and credits once. Without Paystack keys the button says
// "coming soon". Admins / testers (WALLET_TEST_PURCHASES + WALLET_TESTERS) also get "Test purchase" (no money).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PressScale } from '../Motion';
import { Icon } from '../Icons';
import { alpha } from '../ui';
import { useToast } from '../Toast';
import { colors, fonts } from '../../theme';
import { useApi } from '../../api/auth';
import { useWalletProducts, buyProduct, newIdempotencyKey, walletChanged, walletError, WALLET_META, fmtUnits } from '../../api/wallet';
import { WalletSheet, ws } from './WalletSheet';
import { PaystackButton } from '../PaystackButton';

export function BuyCoinsSheet({ visible, wallet = 'gift_coins', plans = false, onClose, onPurchased, initialProductId = null }) {
  const api = useApi();
  const toast = useToast();
  const { products, methods, loaded, error, online, reload } = useWalletProducts(plans ? { plans: true } : { wallet });
  const [sel, setSel] = useState(initialProductId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const keyRef = useRef(null);
  useEffect(() => { if (visible) { setMsg(null); reload(); } }, [visible]);
  const chosen = useMemo(() => products.find((p) => p.id === sel) || products[0] || null, [products, sel]);
  useEffect(() => { keyRef.current = null; }, [chosen && chosen.id]); // a new package = a new purchase
  const m = WALLET_META[wallet] || {};
  const test = methods.find((x) => x.provider === 'test');
  const paystack = methods.find((x) => x.provider === 'paystack');

  async function buy(provider) {
    if (!chosen || busy) return;
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    setBusy(true); setMsg(null);
    try {
      const r = await buyProduct(api, { productId: chosen.id, provider, idempotencyKey: keyRef.current });
      keyRef.current = null;
      walletChanged();
      toast.show(plans ? `${chosen.title} is active` : `+${fmtUnits(chosen.totalUnits)} ${m.short || 'added'}`, { icon: 'check', haptic: 'success' });
      if (onPurchased) onPurchased(r);
      onClose && onClose();
    } catch (e) {
      setMsg(walletError(e, 'Purchase failed'));
    } finally { setBusy(false); }
  }

  const title = plans ? 'Dating Plus & VIP' : `Buy ${m.short || 'coins'}`;
  const subtitle = plans ? 'Monthly plans. Renews monthly unless you cancel. Cancel any time before the renewal date.'
    : wallet === 'fundme_credits' ? 'One credit publishes one Fund Me request. Credits are not cash.'
      : wallet === 'dating_coins' ? 'For Super Likes, boosts, message bundles and more in Find Love. You always confirm before coins are used.'
        : 'For sending virtual gifts. Bought coins are not cash and cannot be withdrawn.';

  return (
    <WalletSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      {!online ? <Text style={ws.note}>Sign in online to buy.</Text> : null}
      {online && !loaded ? <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} /> : null}
      {error ? <Text style={[ws.note, { color: colors.danger || '#B3261E' }]}>{walletError(error, 'Could not load packages')}</Text> : null}
      <ScrollView style={{ marginTop: 12, maxHeight: 380 }} contentContainerStyle={{ gap: 8 }}>
        {products.map((p) => {
          const on = chosen && chosen.id === p.id;
          return (
            <PressScale key={p.id} scaleTo={0.98} onPress={() => setSel(p.id)} style={[s.row, on && s.rowOn]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${p.title}, ${p.displayPrice}`}>
              {plans ? null : <View style={[s.icon, { backgroundColor: alpha(m.tint || colors.gold, 0.12) }]}><Icon name={m.icon || 'coin'} size={18} color={m.tint || colors.gold} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{plans ? p.title : `${fmtUnits(p.units)} ${m.unit || ''}`}{p.bonusUnits ? <Text style={s.bonus}>{`  +${fmtUnits(p.bonusUnits)} bonus`}</Text> : null}</Text>
                {plans ? <Text style={s.feat} numberOfLines={3}>{(p.benefits.features || []).slice(0, 4).join(' · ')}</Text> : null}
              </View>
              <Text style={s.price}>{p.displayPrice}</Text>
              <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.dot} /> : null}</View>
            </PressScale>
          );
        })}
        {online && loaded && !products.length && !error ? <Text style={ws.note}>No packages available right now.</Text> : null}
      </ScrollView>
      {test ? (
        <PressScale onPress={() => buy('test')} scaleTo={0.98} style={[ws.primary, (busy || !chosen) && ws.disabled]} accessibilityRole="button" accessibilityState={{ disabled: busy || !chosen }} accessibilityLabel="Test purchase, no money moves">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={ws.primaryText}>{`Test purchase${chosen ? ` · ${chosen.displayPrice}` : ''}`}</Text>}
        </PressScale>
      ) : null}
      {paystack ? (
        <PaystackButton
          method={paystack}
          ghost={!!test}
          disabled={!chosen}
          label={chosen ? `Pay ${chosen.displayPrice}` : 'Pay with Paystack'}
          start={(email) => {
            if (!keyRef.current) keyRef.current = newIdempotencyKey();
            return buyProduct(api, { productId: chosen.id, provider: 'paystack', idempotencyKey: keyRef.current, email });
          }}
          onSuccess={(r) => {
            keyRef.current = null;
            walletChanged();
            toast.show(plans ? `${chosen.title} is active` : `+${fmtUnits(chosen.totalUnits)} ${m.short || 'added'}`, { icon: 'check', haptic: 'success' });
            if (onPurchased) onPurchased(r);
            onClose && onClose();
          }}
        />
      ) : null}
      <Text style={ws.note}>{msg || (test ? 'Test purchases are for admins and testers only. No money moves.' : plans ? 'Paid by card: renews monthly until you cancel. Paid by bank transfer or USSD: we remind you before it ends.' : 'Prices in Naira, paid securely through Paystack.')}</Text>
    </WalletSheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  rowOn: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.04) },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15.5, fontWeight: '700', color: colors.fg },
  bonus: { fontSize: 12.5, fontWeight: '700', color: '#2E7D5B' },
  feat: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 3 },
  price: { fontFamily: fonts.display, fontSize: 16, color: colors.fg },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
});
