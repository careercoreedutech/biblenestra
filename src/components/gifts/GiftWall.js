// Profile "Gifts received" wall: counts per gift (all contexts) + recent public gifts (profile, live, post).
//   <GiftWall userId name />
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
  const d = data || { total: 0, gifts: [], recent: [] };
  if (!d.total && !empty) return null;
  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Gifts received</Text>
          <Text style={styles.title}>{d.total ? `${d.total.toLocaleString('en-US')} gift${d.total === 1 ? '' : 's'}` : 'No gifts yet'}</Text>
        </View>
      </View>
      {d.total ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
          {d.gifts.map((g) => (
            <View key={g.id} style={styles.tile} accessibilityLabel={`${g.count} ${g.name}`}>
              <GiftArt gift={g} size={48} animate={g.tier === 'premium'} />
              <Text style={styles.count}>×{g.count}</Text>
              <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
            </View>
          ))}
        </ScrollView>
      ) : <Text style={styles.empty}>{`Be the first to bless ${name || 'them'} with a gift.`}</Text>}
      {d.recent.length ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          {d.recent.slice(0, 5).map((r) => (
            <View key={r.id} style={styles.recent}>
              <GiftArt gift={r.gift} size={26} animate={false} />
              <Text style={styles.recentText} numberOfLines={1}><Text style={{ fontWeight: '700' }}>{(r.sender && r.sender.displayName) || 'Someone'}</Text>{` sent ${r.gift.name}`}</Text>
              <Text style={styles.ago}>{ago(r.createdAt)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 16, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold },
  title: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, marginTop: 1 },
  tile: { width: 74, alignItems: 'center', paddingVertical: 8, borderRadius: 14, backgroundColor: '#FFF8EA' },
  count: { fontSize: 13, fontWeight: '800', color: colors.fg, marginTop: 2 },
  name: { fontSize: 10.5, color: colors.muted, maxWidth: 68 },
  empty: { fontSize: 13, color: colors.muted },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recentText: { flex: 1, fontSize: 13, color: colors.fg },
  ago: { fontSize: 11.5, color: colors.faint },
});
