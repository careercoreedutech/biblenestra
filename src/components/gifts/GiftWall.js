// Profile "Gifts received" wall: counts per gift (all contexts) + recent public gifts (profile, live, post).
//   <GiftWall userId name />
// Styled as the design's profile cards (paper card, Playfair heading, plum eyebrow).
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GiftArt } from './GiftArt';
import { useGiftWall } from '../../api/gifts';
import { colors, fonts, radius } from '../../theme';

const ago = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

export function GiftWall({ userId, name, empty = true }) {
  const { data, loaded, online } = useGiftWall(userId);
  if (!online || !loaded) return null;
  const wall = data || { total: 0, gifts: [], recent: [] };
  if (!wall.total && !empty) return null;
  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Gifts received</Text>
          <Text style={styles.title}>{wall.total ? `${wall.total.toLocaleString('en-US')} gift${wall.total === 1 ? '' : 's'}` : 'No gifts yet'}</Text>
        </View>
      </View>
      {wall.total ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
          {wall.gifts.map((g) => (
            <View key={g.id} style={styles.tile} accessibilityLabel={`${g.count} ${g.name}`}>
              <GiftArt gift={g} size={48} animate={g.tier === 'premium'} />
              <Text style={styles.count}>×{g.count}</Text>
              <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
            </View>
          ))}
        </ScrollView>
      ) : <Text style={styles.empty}>{`Be the first to bless ${name || 'them'} with a gift.`}</Text>}
      {wall.recent.length ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          {wall.recent.slice(0, 5).map((r) => (
            <View key={r.id} style={styles.recent}>
              <GiftArt gift={r.gift} size={26} animate={false} />
              <Text style={styles.recentText} numberOfLines={1}><Text style={styles.recentStrong}>{(r.sender && r.sender.displayName) || 'Someone'}</Text>{` sent ${r.gift.name}`}</Text>
              <Text style={styles.ago}>{ago(r.createdAt)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 16, padding: 16, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  eyebrow: { fontSize: 9, fontFamily: 'DMSans-ExtraBold', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.primary },
  title: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, marginTop: 2 },
  tile: { width: 74, alignItems: 'center', paddingVertical: 8, borderRadius: 14, backgroundColor: colors.primarySoft || '#FFF8EA' },
  count: { fontSize: 12, fontFamily: 'DMSans-Bold', color: colors.fg, marginTop: 2 },
  name: { fontSize: 9.5, fontFamily: fonts.sans, color: colors.muted, maxWidth: 68 },
  empty: { fontSize: 12, fontFamily: fonts.sans, color: colors.muted },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recentText: { flex: 1, fontSize: 12, fontFamily: fonts.sans, color: colors.fg },
  recentStrong: { fontFamily: 'DMSans-Bold' },
  ago: { fontSize: 10, fontFamily: fonts.sans, color: colors.faint },
});
