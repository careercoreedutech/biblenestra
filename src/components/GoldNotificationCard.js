// NOTIFICATIONS: the black-and-gold notification card ("A moment with God. Every day." mock) used by the
// in-app notification centre (Activity) and the Settings › Notifications preview.
//   dark translucent card · ~18dp corners · thin warm-gold border + glow · app icon + "BibleNestra · 1m ago"
//   gold title with emoji · white body · serif quoted verse · gold reference · grey reflective line ·
//   gold CTA with arrow · a cinematic photo on the right that fades into the card.
import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressScale } from './Motion';
import { fonts } from '../theme';
import { GOLD } from '../notifications/imagery';

const APP_ICON = require('../../assets/icon.png');

/**
 * card: { title, lead?, body?, quote?, reference?, reflection?, cta?, image?, quoteStyle? ('serif' | 'plain') }
 * time: "1m ago" · unread: gold dot · onPress / onCta · children: extra controls (e.g. Follow back)
 */
export default function GoldNotificationCard({ card, time, unread, onPress, onCta, children, sender = 'BibleNestra', compact, accessibilityLabel }) {
  const c = card || {};
  const hasImage = !!c.image;
  const label = accessibilityLabel || [c.title, c.lead, c.body, c.quote, c.reference, c.reflection].filter(Boolean).join('. ');
  return (
    <PressScale onPress={onPress} scaleTo={0.985} style={[styles.card, unread && styles.cardUnread]} accessibilityRole="button" accessibilityLabel={label}>
      {hasImage ? (
        <View style={styles.imageWrap} pointerEvents="none">
          <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
          <LinearGradient
            colors={[GOLD.cardSolid, 'rgba(14,12,11,0.72)', 'rgba(14,12,11,0.18)', 'rgba(14,12,11,0.05)']}
            locations={[0, 0.3, 0.72, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient colors={['rgba(14,12,11,0)', 'rgba(14,12,11,0.55)']} start={{ x: 0.5, y: 0.55 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
      <View style={[styles.content, hasImage && styles.contentWithImage]}>
        <View style={styles.header}>
          <Image source={APP_ICON} style={styles.appIcon} />
          <Text style={styles.headerText} numberOfLines={1}>{sender}{time ? ` · ${time}` : ''}</Text>
          {unread ? <View style={styles.dot} /> : null}
        </View>
        {c.title ? <Text style={styles.title} numberOfLines={2}>{c.title}</Text> : null}
        {c.lead ? <Text style={styles.body} numberOfLines={3}>{c.lead}</Text> : null}
        {c.body ? <Text style={styles.body} numberOfLines={compact ? 2 : 4}>{c.body}</Text> : null}
        {c.quote ? (
          <Text style={c.quoteStyle === 'plain' ? styles.body : styles.quote} numberOfLines={compact ? 3 : 5}>
            {c.quoteStyle === 'plain' ? c.quote : `“${c.quote}”`}
          </Text>
        ) : null}
        {c.reference ? <Text style={styles.reference} numberOfLines={1}>{c.reference}</Text> : null}
        {c.reflection ? <Text style={styles.reflection} numberOfLines={2}>{c.reflection}</Text> : null}
        {children}
        {c.cta ? (
          <PressScale onPress={onCta || onPress} scaleTo={0.94} hitSlop={8} style={styles.ctaBtn} accessibilityRole="button" accessibilityLabel={c.cta}>
            <Text style={styles.cta}>{c.cta} →</Text>
          </PressScale>
        ) : null}
      </View>
    </PressScale>
  );
}

/** A small gold-outlined pill button for inline actions inside a card (e.g. "Follow back"). */
export function GoldPill({ label, onPress, filled }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.94} style={[styles.pill, filled && styles.pillFilled]} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={[styles.pillText, filled && styles.pillTextFilled]}>{label}</Text>
    </PressScale>
  );
}

const glow = Platform.select({
  web: { boxShadow: `0 0 0 1px ${GOLD.goldGlow}, 0 8px 26px rgba(212,168,82,0.16), 0 2px 10px rgba(0,0,0,0.35)` },
  ios: { shadowColor: GOLD.gold, shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  default: { elevation: 6, shadowColor: GOLD.gold },
});

const styles = StyleSheet.create({
  card: { backgroundColor: GOLD.cardSolid, // solid so the photo fade has no seam on the light app background
 borderRadius: 18, borderWidth: 1, borderColor: GOLD.goldLine, marginBottom: 12, overflow: Platform.OS === 'web' ? 'hidden' : 'visible', minHeight: 132, ...glow },
  cardUnread: { borderColor: 'rgba(212,168,82,0.7)' },
  imageWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '46%', borderTopRightRadius: 17, borderBottomRightRadius: 17, overflow: 'hidden' },
  content: { padding: 14, paddingBottom: 12 },
  contentWithImage: { paddingRight: '30%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  appIcon: { width: 18, height: 18, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: GOLD.goldLine },
  headerText: { fontSize: 11.5, color: GOLD.grey, fontWeight: '600', flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GOLD.gold, marginLeft: 2 },
  title: { fontSize: 15, fontWeight: '800', color: GOLD.gold, letterSpacing: 0.1, marginBottom: 4 },
  body: { fontSize: 13.5, lineHeight: 19, color: GOLD.white, marginBottom: 3 },
  quote: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 22, color: GOLD.white, marginBottom: 3 },
  reference: { fontSize: 12.5, fontWeight: '700', color: GOLD.gold, marginTop: 1 },
  reflection: { fontSize: 12, color: GOLD.grey, marginTop: 5, lineHeight: 16 },
  ctaBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 2 },
  cta: { fontSize: 13, fontWeight: '800', color: GOLD.gold, letterSpacing: 0.2 },
  pill: { alignSelf: 'flex-start', marginTop: 8, borderWidth: 1, borderColor: GOLD.gold, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  pillFilled: { backgroundColor: GOLD.gold },
  pillText: { fontSize: 12, fontWeight: '800', color: GOLD.gold },
  pillTextFilled: { color: '#15120E' },
});
