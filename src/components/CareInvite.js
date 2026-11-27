// Today → "You are not alone": a warm invitation into the Christian Care Network.
// Each need is a one-tap shortcut straight to people who can help with it.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { PressScale, Pulse } from './Motion';
import { useNav } from '../navigation';

const NEEDS = [
  { label: 'Someone to talk to', icon: 'chat', choice: 'I need someone to talk to' },
  { label: 'Prayer', icon: 'prayer', choice: 'I need prayer' },
  { label: 'Encouragement', icon: 'heart', choice: 'I need encouragement' },
  { label: 'Pastoral guidance', icon: 'church', choice: 'I need pastoral guidance' },
];

export default function CareInvite({ style }) {
  const nav = useNav();
  return (
    <View style={[styles.card, style]}>
      <View style={styles.glow} />
      <View style={styles.top}>
        <Pulse min={0.92} max={1.08} duration={1800}>
          <View style={styles.heart}><Icon name="heart" size={22} color="#FFFFFF" fill="solid" /></View>
        </Pulse>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>Christian Care Network</Text>
          <Text style={styles.title}>You are not alone</Text>
        </View>
      </View>
      <Text style={styles.body}>
        Whatever you’re carrying today, there are believers ready to listen, pray and walk with you. Private, kind, and never shared.
      </Text>
      <Text style={styles.ask}>What would help you today?</Text>
      <View style={styles.needs}>
        {NEEDS.map((n) => (
          <PressScale key={n.label} onPress={() => nav.push('Care', { preselect: n.choice })} scaleTo={0.96} style={styles.need} accessibilityRole="button" accessibilityLabel={`Care: ${n.label}`}>
            <Icon name={n.icon} size={15} color={'#4B5B35'} />
            <Text style={styles.needText} numberOfLines={1}>{n.label}</Text>
          </PressScale>
        ))}
      </View>
      <PressScale onPress={() => nav.push('Care')} scaleTo={0.98} style={styles.cta} accessibilityRole="button" accessibilityLabel="Find someone who understands">
        <Text style={styles.ctaText}>Find someone who understands</Text>
        <Icon name="arrow-right" size={16} color="#FFFFFF" strokeWidth={2.2} />
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 18, overflow: 'hidden', backgroundColor: '#E7EAD7', borderWidth: 1, borderColor: 'rgba(75,91,53,0.16)', ...shadow.sm },
  glow: { position: 'absolute', right: -60, top: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.35)' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heart: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#4B5B35', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: '#4B5B35' },
  title: { marginTop: 2, fontFamily: fonts.serifBold, fontSize: 21, lineHeight: 26, color: colors.fg, letterSpacing: -0.3 },
  body: { marginTop: 10, fontSize: 13, lineHeight: 20, color: colors.muted },
  ask: { marginTop: 14, marginBottom: 8, fontSize: 12.5, fontWeight: '700', color: colors.muted },
  needs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  need: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(75,91,53,0.18)' },
  needText: { fontSize: 13.5, fontWeight: '600', color: colors.fg },
  cta: { marginTop: 14, height: 52, borderRadius: 18, backgroundColor: '#4B5B35', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
