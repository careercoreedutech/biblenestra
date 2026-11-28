// FIND LOVE swipe card: a full-bleed photo with story-style progress bars (tap the left / right of the photo to change
// it), a wine scrim, the name and age in large serif, faith chips, the verified seal, and the LIKE / PASS stamps.
import React, { memo, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../Icons';
import { fonts } from '../../theme';
import { love, grad } from './theme';
import { VerifiedSeal, Crown, HeartShape } from './illustrations';
import { LoveChip } from './parts';
import { colors } from '../../theme'; // APPEARANCE (item 14): palette tokens

export const CardFace = memo(function CardFace({ card, onOpen, interactive = true }) {
  const [i, setI] = useState(0);
  const photos = card.photos || [];
  const uri = photos[i] ? photos[i].url : null;
  const many = photos.length > 1;
  const where = [card.city, card.country].filter(Boolean).join(', ') || 'Location hidden';
  return (
    <View style={StyleSheet.absoluteFill}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        : (
          <LinearGradient colors={grad.blush} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <HeartShape size={80} stroke={love.roseSoft} strokeWidth={1.2} />
          </LinearGradient>
        )}
      <LinearGradient colors={grad.scrimTop} style={s.topScrim} pointerEvents="none" />
      <LinearGradient colors={grad.scrim} locations={[0, 0.35, 1]} style={s.scrim} pointerEvents="none" />

      {/* photo zones: left / right half of the upper card changes the photo; one photo → opens the profile */}
      {interactive ? (
        <View style={s.zones}>
          <Pressable style={{ flex: 1 }} onPress={many ? () => setI((x) => Math.max(0, x - 1)) : onOpen} accessibilityRole="button"
            accessibilityLabel={many ? `Previous photo of ${card.firstName}` : `${card.firstName}, ${card.age}. Open profile`} />
          <Pressable style={{ flex: 1 }} onPress={many ? () => setI((x) => Math.min(photos.length - 1, x + 1)) : onOpen} accessibilityRole="button"
            accessibilityLabel={many ? `Next photo of ${card.firstName}` : `${card.firstName}, ${card.age}. Open profile`} />
        </View>
      ) : null}

      {many ? (
        <View style={s.bars} pointerEvents="none">
          {photos.map((p, k) => <View key={p.id || k} style={[s.bar, k === i && s.barOn, k < i && s.barSeen]} />)}
        </View>
      ) : null}

      <View style={s.topRow} pointerEvents="none">
        {card.boosted ? <LoveChip icon="flame" label={card.spotlight ? 'Spotlight' : 'Boosted'} tone="wine" /> : null}
        {card.superLikedYou ? (
          <View style={s.likesYou}><Icon name="star" size={12} color={love.plum} fill={love.plum} /><Text style={s.likesYouText}>Likes you a lot</Text></View>
        ) : null}
      </View>

      <Pressable onPress={interactive ? onOpen : undefined} disabled={!interactive} style={s.info} accessibilityRole="button" accessibilityLabel={`${card.firstName}, ${card.age}. Open profile`}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
            {card.firstName}<Text style={s.age}>{`  ${card.age}`}</Text>
          </Text>
          {card.verified ? <VerifiedSeal size={22} /> : null}
          {card.vip ? <View style={s.vip}><Crown size={11} /><Text style={s.vipText}>VIP</Text></View> : null}
          <View style={{ flex: 1 }} />
          {interactive ? <View style={s.openBtn}><Icon name="chevron-up" size={18} color="#FFFFFF" strokeWidth={2.4} /></View> : null}
        </View>
        <View style={s.metaRow}>
          <Icon name="map-pin" size={13} color={love.goldBright} />
          <Text style={s.meta} numberOfLines={1}>{where}</Text>
        </View>
        <View style={s.chips}>
          {card.denomination ? <LoveChip icon="cross" label={card.denomination} tone="glass" /> : null}
          {card.churchInvolvement ? <LoveChip icon="church" label={card.churchInvolvement} tone="glass" /> : null}
          {card.intentionLabel ? <LoveChip icon="heart" label={card.intentionLabel} tone="glass" /> : null}
          {(card.interests || []).slice(0, 2).map((t) => <LoveChip key={t} label={t} tone="glass" />)}
        </View>
        {card.bio ? <Text style={s.bio} numberOfLines={2}>{card.bio}</Text> : null}
      </Pressable>
    </View>
  );
});

/** LIKE / PASS / SUPER stamps; `opacity` is an Animated interpolation of the drag. */
export function Stamp({ kind, opacity }) {
  const like = kind === 'like';
  return (
    <Animated.View pointerEvents="none" style={[s.stamp, like ? s.stampLike : s.stampPass, { opacity, transform: [{ rotate: like ? '-14deg' : '14deg' }, { scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [1.25, 1] }) }] }]}>
      {like ? <HeartShape size={22} color={love.goldBright} /> : <Icon name="x" size={20} color="#FFFFFF" strokeWidth={3} />}
      <Text style={[s.stampText, { color: like ? love.goldBright : '#FFFFFF' }]}>{like ? 'LIKE' : 'PASS'}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  topScrim: { position: 'absolute', left: 0, right: 0, top: 0, height: 110 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  zones: { position: 'absolute', left: 0, right: 0, top: 0, bottom: '42%', flexDirection: 'row' },
  bars: { position: 'absolute', top: 12, left: 14, right: 14, flexDirection: 'row', gap: 5 },
  bar: { flex: 1, height: 3.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  barOn: { backgroundColor: colors.surfaceWhite },
  barSeen: { backgroundColor: 'rgba(255,255,255,0.7)' },
  topRow: { position: 'absolute', top: 26, left: 14, right: 14, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  likesYou: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: love.goldBright },
  likesYouText: { fontSize: 12, fontWeight: '800', color: love.plum },
  info: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingBottom: 20, paddingTop: 30 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.serifBold, fontSize: 36, color: '#FFFFFF', letterSpacing: -0.6, flexShrink: 1 },
  age: { fontFamily: fonts.serif, fontSize: 30, color: 'rgba(255,255,255,0.9)' },
  vip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(15,11,9,0.85)', borderWidth: 1, borderColor: 'rgba(244,216,140,0.7)' },
  vipText: { fontSize: 10, fontWeight: '900', color: love.goldBright, letterSpacing: 0.8 },
  openBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  meta: { fontSize: 14, color: 'rgba(255,255,255,0.92)', fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  bio: { fontFamily: fonts.serifItalic, fontSize: 15.5, lineHeight: 21, color: 'rgba(255,255,255,0.95)', marginTop: 10 },
  stamp: { position: 'absolute', top: 92, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: 3 },
  stampLike: { left: 22, borderColor: love.goldBright, backgroundColor: 'rgba(60,37,24,0.55)' },
  stampPass: { right: 22, borderColor: colors.surfaceWhite, backgroundColor: 'rgba(40,36,33,0.5)' },
  stampText: { fontSize: 28, fontWeight: '900', letterSpacing: 3 },
});
