// FUND ME GIFTS: the star/gift button on every fundraiser card and page, the sheet that sends a gift to the request's
// creator (context { type: 'fundme', id }, the same catalogue and GiftSheet as everywhere else), and the summary of gifts
// received on the request (total, top gifts, recent givers). Backend: lib/virtualGifts.js (fundraiserGiftSummary).
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icons';
import { GiftSheet } from '../gifts/GiftSheet';
import { GiftArt } from '../gifts/GiftArt';
import { d, df } from '../../design/sanctuary';

/** Round star/gift button. Stops the tap from also opening the card behind it. */
export function FundGiftStar({ onPress, size = 34, style }) {
  return (
    <Pressable onPress={(e) => { e && e.stopPropagation && e.stopPropagation(); onPress && onPress(); }} hitSlop={6}
      accessibilityRole="button" accessibilityLabel="Send a gift to this request"
      style={[styles.star, { width: size, height: size, borderRadius: size / 2 }, style]}>
      <Icon name="star" size={Math.round(size * 0.5)} color={d.plum} />
    </Pressable>
  );
}

/** The send-gift sheet for one fundraiser. Gifts go to its creator; the server applies the usual 20% / earnings hold. */
export function FundGiftSheet({ fundraiser, visible, onClose, onSent }) {
  const owner = fundraiser && fundraiser.owner;
  if (!fundraiser || !owner || !owner.id) return null;
  return (
    <GiftSheet
      visible={!!visible}
      onClose={onClose}
      recipient={{ id: owner.id, name: owner.displayName || 'the organiser' }}
      context={{ type: 'fundme', id: fundraiser.id }}
      title={`Send ${owner.displayName || 'the organiser'} a gift`}
      onSent={onSent}
    />
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Gifts received on this request. gifts = { total, topGifts, recentGivers } from the fundraiser payload. */
export function FundGiftsReceived({ gifts, isOwner }) {
  const total = gifts ? gifts.total || 0 : 0;
  const top = (gifts && gifts.topGifts) || [];
  const givers = (gifts && gifts.recentGivers) || [];
  if (!total && !isOwner) return null;
  return (
    <View style={styles.wrap} accessibilityLabel={`${total} ${total === 1 ? 'gift' : 'gifts'} received`}>
      <Text style={styles.title}>Gifts received</Text>
      {total ? (
        <>
          <Text style={styles.count}>{total.toLocaleString('en-US')} {total === 1 ? 'gift' : 'gifts'} so far</Text>
          <View style={styles.topRow}>
            {top.map((g) => (
              <View key={g.id} style={styles.topItem}>
                {g.imageUrl ? <Image source={{ uri: g.imageUrl }} style={styles.topImg} /> : <GiftArt gift={{ id: g.id, art: g.art, tier: 'standard' }} size={40} animate={false} />}
                <Text style={styles.topName} numberOfLines={1}>{g.name}</Text>
                <Text style={styles.topCount}>×{g.count}</Text>
              </View>
            ))}
          </View>
          {givers.length ? (
            <View style={styles.givers}>
              <Text style={styles.sub}>Recent givers</Text>
              {givers.map((x, i) => (
                <View key={`${x.createdAt}-${i}`} style={[styles.giver, i > 0 && styles.giverBorder]}>
                  <View style={styles.avatar}>
                    {x.avatarUrl ? <Image source={{ uri: x.avatarUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initials(x.displayName)}</Text>}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.giverName} numberOfLines={1}>{x.displayName}</Text>
                    <Text style={styles.giverMeta} numberOfLines={1}>sent {x.gift && x.gift.name} · {timeAgo(x.createdAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.muted}>No gifts yet. A gift is a warm way to say you care.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  star: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: d.line },
  wrap: { marginTop: 22 },
  title: { fontFamily: df.displayBold, fontSize: 18, color: d.ink },
  count: { fontFamily: df.sansSemi, fontSize: 13, color: d.plum, marginTop: 4 },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  topItem: { width: 84, alignItems: 'center', padding: 8, borderRadius: 16, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  topImg: { width: 40, height: 40, borderRadius: 10 },
  topName: { fontFamily: df.sansSemi, fontSize: 12, color: d.ink, marginTop: 6, maxWidth: '100%' },
  topCount: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 2 },
  givers: { marginTop: 14, borderRadius: 18, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, paddingHorizontal: 14 },
  sub: { fontFamily: df.sansSemi, fontSize: 12, color: d.muted, paddingTop: 12, paddingBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  giver: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  giverBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: d.line },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: d.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 32, height: 32 },
  avatarText: { fontFamily: df.displayBold, fontSize: 12, color: d.ink },
  giverName: { fontFamily: df.sansSemi, fontSize: 13, color: d.ink },
  giverMeta: { fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 1 },
  muted: { fontFamily: df.sans, fontSize: 13, color: d.muted, marginTop: 6 },
});
