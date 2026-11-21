// Shared bottom-sheet frame for the wallet components (same look as the membership checkout sheet).
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedModal } from '../Motion';
import { colors, fonts } from '../../theme';

export function WalletSheet({ visible, onClose, title, subtitle, children }) {
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={ws.sheet}>
          <View style={ws.grabber} />
          {title ? <Text style={ws.title} accessibilityRole="header">{title}</Text> : null}
          {subtitle ? <Text style={ws.sub}>{subtitle}</Text> : null}
          {children}
        </View>
      </View>
    </AnimatedModal>
  );
}

export const ws = StyleSheet.create({
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingBottom: 24, paddingTop: 8, maxHeight: '88%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 12 },
  title: { fontFamily: fonts.serifBold, fontSize: 23, color: colors.fg },
  sub: { fontSize: 13.5, lineHeight: 19, color: colors.muted, marginTop: 4 },
  primary: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  ghost: { marginTop: 8, borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  ghostText: { color: colors.fg, fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.5 },
  note: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 10, textAlign: 'center' },
});
