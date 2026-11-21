// <WalletBalancePill wallet="dating_coins" onPress? /> — a small balance chip for any wallet (Find Love header, gift
// store, Fund Me publish screen). Reads GET /wallet (shared cache; walletChanged() refreshes every pill).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icons';
import { PressScale } from '../Motion';
import { alpha } from '../ui';
import { colors } from '../../theme';
import { useWalletBalance, WALLET_META, fmtUnits } from '../../api/wallet';

export function WalletBalancePill({ wallet, onPress, style, dark = false }) {
  const { balance, known, online } = useWalletBalance(wallet);
  const m = WALLET_META[wallet] || { short: wallet, unit: '', icon: 'coin', tint: colors.gold };
  const label = online ? (known ? fmtUnits(balance) : '…') : '—';
  const body = (
    <View style={[s.pill, dark && s.dark, { borderColor: alpha(m.tint, 0.35) }, style]}>
      <Icon name={m.icon} size={14} color={m.tint} />
      <Text style={[s.text, dark && { color: colors.nightFg }]} numberOfLines={1}>{label}</Text>
      <Text style={[s.unit, dark && { color: colors.nightMuted }]} numberOfLines={1}>{m.unit}</Text>
    </View>
  );
  if (!onPress) return <View accessibilityLabel={`${m.short}: ${label}`}>{body}</View>;
  return (
    <PressScale scaleTo={0.94} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${m.short}: ${label}. Open wallet`}>
      {body}
    </PressScale>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, backgroundColor: colors.surface, alignSelf: 'flex-start' },
  dark: { backgroundColor: colors.nightRaised },
  text: { fontWeight: '800', fontSize: 13, color: colors.fg },
  unit: { fontSize: 11.5, color: colors.muted },
});
