// Reusable "Send Virtual Gift" sheet (Socials reels, comments, person profiles).
// Online: coins only move on the server (POST /gifts via sync.sendGift — with postId / commentId context).
// Local: coins are spent on the device. Not enough coins → a friendly notice with a way to earn coins.
import React, { useEffect, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../Icons';
import { colors, fonts, radius, shadow } from '../../theme';
import { Button, alpha } from '../ui';
import { AnimatedModal, AnimatedNumber, FadeInUp, Pop, PressScale, ScaleIn } from '../Motion';
import { useToast } from '../Toast';
import { useStore } from '../../store';
import { useSync } from '../../api/sync';
import { useNav } from '../../navigation';
import { GIFTS } from '../../data/seed';
import { isServerId } from '../../api/social';

const SCREEN_WIDTH = Dimensions.get('window').width;
export const GIFT_ICONS = {
  g_rose: { name: 'sun', color: colors.rose },
  g_bouquet: { name: 'sparkles', color: colors.primary },
  g_star: { name: 'star', color: colors.gold },
  g_crown: { name: 'cross', color: colors.lavender },
};

function CloseGlyph({ color = colors.muted, size = 12 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * Send a gift. → true when sent. Throws nothing: shows toasts / returns { short } when coins are missing.
 * target = { userId?, name, postId?, commentId?, videoId? }
 */
export function useGiftSender() {
  const { state, dispatch } = useStore();
  const sync = useSync();
  return async (gift, target) => {
    const coins = state.coins || 0;
    if (coins < gift.price) return { ok: false, short: gift.price - coins };
    if (sync.online) {
      if (!target.userId || !isServerId(target.userId)) return { ok: false, error: 'This person can’t receive gifts yet' };
      try {
        await sync.sendGift({
          toUserId: target.userId,
          giftId: gift.id,
          postId: isServerId(target.postId) ? target.postId : undefined,
          commentId: isServerId(target.commentId) ? target.commentId : undefined,
        });
        return { ok: true };
      } catch (e) {
        if (e && e.code === 'INSUFFICIENT_COINS') return { ok: false, short: Math.max(1, gift.price - coins) };
        return { ok: false, error: (e && e.message) || 'Could not send gift' };
      }
    }
    if (target.videoId && !target.commentId) {
      dispatch({ type: 'sendGift', videoId: target.videoId, giftName: gift.name, recipient: target.name, coins: gift.price });
    } else {
      dispatch({
        type: 'set',
        patch: {
          coins: coins - gift.price,
          coinLog: [{ id: 'cl' + Date.now(), amount: -gift.price, reason: `Gift to ${target.name}`, time: new Date().toISOString() }, ...(state.coinLog || [])].slice(0, 60),
          giftTransactions: [{ id: 'gt' + Date.now(), recipient: target.name, giftName: gift.name, coins: gift.price, time: 'Just now', ...(target.commentId ? { forComment: target.commentId } : {}) }, ...(state.giftTransactions || [])],
        },
      });
    }
    return { ok: true };
  };
}

/**
 * <GiftSheet visible target={{ userId, name, postId, commentId, videoId }} onClose onSent />
 */
export default function GiftSheet({ visible, target, onClose, onSent, subtitle }) {
  const { state, dispatch } = useStore();
  const sync = useSync();
  const nav = useNav();
  const toast = useToast();
  const send = useGiftSender();
  const [notice, setNotice] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setNotice(null); }, [visible]);
  const t = target || {};
  const coins = state.coins || 0;

  const pick = async (g) => {
    if (busy) return;
    setBusy(true);
    const r = await send(g, t);
    setBusy(false);
    if (r.ok) {
      toast.show(`Sent ${g.name} to ${t.name}`, { icon: 'gift', haptic: 'success' });
      onSent && onSent(g);
      onClose && onClose();
      return;
    }
    if (r.short) {
      setNotice({ tone: 'error', text: `You need ${r.short} more coin${r.short === 1 ? '' : 's'} for ${g.name}. Play today’s Bible games to earn coins.` });
      return;
    }
    setNotice({ tone: 'error', text: r.error });
  };

  const earn = () => {
    onClose && onClose();
    setTimeout(() => nav.push('Learn', { tab: 'Games' }), 160);
  };

  return (
    <AnimatedModal visible={!!visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.eyebrow} numberOfLines={1}>{t.name ? `For ${t.name}` : 'Gifts'}</Text>
              <Text style={styles.title} numberOfLines={1}>Send Virtual Gift</Text>
              <Text style={styles.sub} numberOfLines={2}>{subtitle || (t.commentId ? 'Thank them for their comment with coins' : 'Bless and support Christian creators')}</Text>
            </View>
            <Pop trigger={coins} amount={1.12}>
              <View style={styles.balance}>
                <Icon name="coin" size={14} color={colors.gold} />
                <AnimatedNumber value={coins} style={styles.balanceText} />
              </View>
            </Pop>
            <PressScale onPress={onClose} hitSlop={12} scaleTo={0.88} style={styles.close} accessibilityLabel="Close">
              <CloseGlyph />
            </PressScale>
          </View>

          <View style={styles.grid}>
            {GIFTS.map((g, gi) => {
              const meta = GIFT_ICONS[g.id] || { name: 'sparkles', color: colors.gold };
              const short = g.price > coins;
              return (
                <FadeInUp key={g.id} index={gi} distance={12} duration={340}>
                  <PressScale onPress={() => pick(g)} disabled={busy} accessibilityLabel={`Send ${g.name}`} scaleTo={0.95} style={[styles.card, short && { opacity: 0.55 }]}>
                    <View style={[styles.iconCircle, { backgroundColor: alpha(meta.color, 0.12) }]}>
                      <Icon name={meta.name} size={22} color={meta.color} />
                    </View>
                    <Text style={styles.name}>{g.name}</Text>
                    <Text style={styles.desc} numberOfLines={2}>{g.desc}</Text>
                    <View style={styles.price}>
                      <Icon name="coin" size={12} color={colors.gold} />
                      <Text style={styles.priceText}>{g.price} coins</Text>
                    </View>
                  </PressScale>
                </FadeInUp>
              );
            })}
          </View>

          {notice ? (
            <ScaleIn key={notice.text} from={0.92} style={[styles.notice, notice.tone === 'error' ? { backgroundColor: colors.negativeFaint } : { backgroundColor: colors.primarySoft }]}>
              <Icon name={notice.tone === 'error' ? 'coin' : 'check'} size={14} color={notice.tone === 'error' ? colors.negative : colors.primary} strokeWidth={2.4} />
              <Text style={[styles.noticeText, notice.tone === 'error' && { color: colors.negative }]}>{notice.text}</Text>
            </ScaleIn>
          ) : null}

          <View style={styles.row}>
            <Button
              small
              kind={notice && notice.tone === 'error' ? 'primary' : 'ghost'}
              label="Earn coins · Bible games"
              icon={<Icon name="star" size={14} color={notice && notice.tone === 'error' ? colors.goldLight : colors.gold} />}
              onPress={earn}
            />
            {!sync.online ? (
              <Button small kind="ghost" label="+250" icon={<Icon name="coin" size={13} color={colors.gold} />} onPress={() => { dispatch({ type: 'buyCoins', amount: 250 }); setNotice({ tone: 'ok', text: '+250 coins added to your balance' }); }} />
            ) : (
              <Button small kind="ghost" label="Close" onPress={onClose} />
            )}
          </View>
        </View>
      </View>
    </AnimatedModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 22, maxHeight: '86%', ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginBottom: 2 },
  title: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: colors.fg },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.cardGold, paddingHorizontal: 11, height: 30, borderRadius: radius.pill },
  balanceText: { fontSize: 13, fontWeight: '700', color: colors.goldMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  card: { width: (Math.min(SCREEN_WIDTH, 520) - 46) / 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', ...shadow.sm },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  name: { fontFamily: fonts.serifBold, fontSize: 16, letterSpacing: -0.2, color: colors.fg },
  desc: { fontSize: 11.5, lineHeight: 15, color: colors.muted, textAlign: 'center', marginTop: 3, minHeight: 30 },
  price: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.cardGold, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 10 },
  priceText: { fontSize: 11.5, color: colors.goldMuted, fontWeight: '700' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  noticeText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.primary, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, gap: 10 },
});
