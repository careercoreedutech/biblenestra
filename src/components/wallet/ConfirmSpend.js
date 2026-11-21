// <ConfirmSpend visible amount={25} wallet="dating_coins" title="Send a message request" onConfirm={async () => …} onClose />
// Spec §5/§6: every deduction is confirmed first and shows the cost and the balance after. onConfirm does the real
// server call (which spends with an idempotency key); the button stays disabled while it runs. If the balance is too
// low the sheet offers "Buy more" (BuyCoinsSheet) instead of the confirm button. Server errors are shown inline.
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PressScale } from '../Motion';
import { Icon } from '../Icons';
import { alpha } from '../ui';
import { colors, fonts } from '../../theme';
import { useWalletBalance, walletChanged, walletError, WALLET_META, fmtUnits } from '../../api/wallet';
import { WalletSheet, ws } from './WalletSheet';
import { BuyCoinsSheet } from './BuyCoinsSheet';

export function ConfirmSpend({ visible, amount, wallet = 'dating_coins', title = 'Confirm', description, confirmLabel, onConfirm, onClose, onDone }) {
  const { balance, known } = useWalletBalance(wallet);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [buying, setBuying] = useState(false);
  const m = WALLET_META[wallet] || { short: wallet, unit: '', icon: 'coin', tint: colors.gold };
  const n = Number(amount || 0);
  const enough = known && balance >= n;
  const buyable = ['fundme_credits', 'dating_coins', 'gift_coins'].includes(wallet);

  async function go() {
    if (busy || !enough) return;
    setBusy(true); setErr(null);
    try {
      const r = onConfirm ? await onConfirm() : null;
      walletChanged();
      if (onDone) onDone(r);
      onClose && onClose();
    } catch (e) {
      setErr(walletError(e, 'That didn’t go through. Nothing was deducted.'));
      walletChanged();
    } finally { setBusy(false); }
  }

  return (
    <>
      <WalletSheet visible={visible && !buying} onClose={busy ? undefined : onClose} title={title} subtitle={description}>
        <View style={s.box}>
          <View style={[s.icon, { backgroundColor: alpha(m.tint, 0.12) }]}><Icon name={m.icon} size={22} color={m.tint} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.cost}>{`${fmtUnits(n)} ${m.short}`}</Text>
            <Text style={s.bal}>{known ? `Balance ${fmtUnits(balance)} → ${enough ? fmtUnits(balance - n) : 'not enough'}` : 'Checking your balance…'}</Text>
          </View>
        </View>
        {err ? <Text style={[ws.note, { color: '#B3261E' }]}>{err}</Text> : null}
        {known && !enough ? (
          <>
            <Text style={ws.note}>{`You need ${fmtUnits(n - balance)} more ${m.unit}.`}</Text>
            {buyable ? (
              <PressScale onPress={() => setBuying(true)} scaleTo={0.98} style={ws.primary} accessibilityRole="button">
                <Text style={ws.primaryText}>{`Buy ${m.short}`}</Text>
              </PressScale>
            ) : null}
          </>
        ) : (
          <PressScale onPress={go} scaleTo={0.98} style={[ws.primary, (busy || !enough) && ws.disabled]} accessibilityRole="button" accessibilityState={{ disabled: busy || !enough }} accessibilityLabel={`${confirmLabel || 'Confirm'}: uses ${n} ${m.short}`}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={ws.primaryText}>{confirmLabel || `Use ${fmtUnits(n)} ${m.unit}`}</Text>}
          </PressScale>
        )}
        <PressScale onPress={onClose} scaleTo={0.98} style={[ws.ghost, busy && ws.disabled]} accessibilityRole="button">
          <Text style={ws.ghostText}>Cancel</Text>
        </PressScale>
      </WalletSheet>
      {buyable ? <BuyCoinsSheet visible={visible && buying} wallet={wallet} onClose={() => setBuying(false)} /> : null}
    </>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cost: { fontFamily: fonts.display, fontSize: 20, color: colors.fg },
  bal: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
