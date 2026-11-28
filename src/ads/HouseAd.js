// House ad creatives: the full-screen body (interstitial / rewarded fallback) and the inline card (banner / native fallback).
// Both carry the "Sponsored" label. Tapping opens the admin's link and counts a click (src/ads/house.js).
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';
import { pickHouseAd, trackHouse, openHouseAd } from './house';

export function HouseCreative({ ad, large = false }) {
  const tracked = useRef(null);
  useEffect(() => {
    // counted once per shown ad: an impression is the creative being on screen
    if (ad && tracked.current !== ad.id) { tracked.current = ad.id; trackHouse(ad, 'impression'); }
  }, [ad && ad.id]);
  if (!ad) return null;
  return (
    <View style={[styles.creative, large && styles.creativeLarge]}>
      <Text style={styles.sponsored}>Sponsored</Text>
      {ad.imageUrl ? <Image source={{ uri: ad.imageUrl }} style={[styles.image, large && styles.imageLarge]} resizeMode="cover" accessibilityLabel={ad.title} /> : null}
      <Text style={[styles.title, large && styles.titleLarge]} numberOfLines={2}>{ad.title}</Text>
      {ad.body ? <Text style={styles.body} numberOfLines={3}>{ad.body}</Text> : null}
      <Pressable onPress={() => openHouseAd(ad)} style={styles.cta} accessibilityRole="link" accessibilityLabel={ad.cta || 'Learn more'}>
        <Text style={styles.ctaText}>{ad.cta || 'Learn more'}</Text>
      </Pressable>
    </View>
  );
}

// Inline card: fills an empty banner or feed slot when both networks have no ad. Collapses to nothing when no house ad exists.
export function HouseCard({ style, variant }) {
  const [ad, setAd] = useState(null);
  useEffect(() => {
    let alive = true;
    pickHouseAd({ preferImage: variant !== 'article' }).then((a) => { if (alive && a) setAd(a); });
    return () => { alive = false; };
  }, [variant]);
  if (!ad) return null;
  return (
    <View style={[styles.card, variant === 'article' && styles.cardArticle, style]}>
      <HouseCreative ad={ad} />
    </View>
  );
}

const styles = StyleSheet.create({
  creative: { borderRadius: radius.md || 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  creativeLarge: { padding: 20, borderRadius: 20, backgroundColor: colors.surface },
  sponsored: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.faint, textTransform: 'uppercase' },
  image: { width: '100%', height: 150, borderRadius: 10, backgroundColor: colors.raised },
  imageLarge: { height: 240, borderRadius: 14 },
  title: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg, marginTop: 4 },
  titleLarge: { fontSize: 24, lineHeight: 30 },
  body: { fontSize: 13, lineHeight: 18, color: colors.muted },
  cta: { marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.primary },
  ctaText: { color: colors.primaryFg, fontWeight: '700', fontSize: 13 },
  card: { marginVertical: 12 },
  cardArticle: { marginVertical: 18 },
});
