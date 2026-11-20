// CHAT LIMITS (client #27): Invite friends — your personal invite link/code, who joined through you, and
// "Have an invite code?" for people who installed before opening the link. Invited friends (both ways) can
// always chat with you, even on the free plan. Server: backend/src/routes/referrals.js (GET /me/invite).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen, Empty, Notice, NightGlow, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useApi } from '../api/auth';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { errorMessage } from '../api/client';
import { ChatSlotsCounter } from '../components/ChatLimit';

export default function InviteFriendsScreen() {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api.online) return;
    try { setData(await api.request('GET', '/me/invite')); setError(null); } catch (e) { setError(errorMessage(e, 'Couldn’t load your invite link')); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const message = data ? `Join me on BibleNestra — read the Bible, pray together and chat. Use my invite code ${data.code}: ${data.link}` : '';
  const share = async () => {
    try { await Share.share({ message, url: data.link, title: 'Join me on BibleNestra' }); } catch (e) { /* cancelled */ }
  };
  const copy = async () => {
    try { await Clipboard.setStringAsync(data.link); toast.show('Invite link copied', { icon: 'check' }); } catch (e) { toast.show('Couldn’t copy', { tone: 'error' }); }
  };
  const redeem = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.request('POST', '/me/referral', { code: code.trim() });
      toast.show(`You joined with ${r.inviterName || 'a friend'}’s invite`, { icon: 'users', haptic: 'success' });
      setCode('');
      load();
    } catch (e) { toast.show(errorMessage(e, 'That code didn’t work'), { tone: 'error', icon: 'x' }); }
    setBusy(false);
  };

  if (!api.online) {
    return <Screen back title="Invite friends"><Empty title="Sign in first" body="Invite links connect your BibleNestra account with your friends’." /></Screen>;
  }
  return (
    <Screen back title="Invite friends" subtitle="Invited friends can always chat with you">
      <FadeInUp distance={10}>
        <View style={styles.hero}>
          <NightGlow intensity={1} />
          <View style={styles.heroInner}>
            <View style={styles.orb}><Icon name="users" size={26} color={colors.goldLight} strokeWidth={1.8} /></View>
            <Text style={styles.heroTitle}>Bring your friends to BibleNestra</Text>
            <Text style={styles.heroSub}>Friends who join with your link are unlimited — they never use one of your free chats, and you never use theirs.</Text>
            {data ? (
              <View style={styles.codeBox} accessibilityLabel={`Your invite code ${data.code.split('').join(' ')}`}>
                <Text style={styles.codeLabel}>Your invite code</Text>
                <Text style={styles.code} selectable>{data.code}</Text>
              </View>
            ) : error ? null : <ActivityIndicator color={colors.goldLight} style={{ marginTop: 16 }} />}
          </View>
        </View>
      </FadeInUp>
      {error ? <Notice tint={colors.negative} text={error} /> : null}

      {data ? (
        <View style={styles.actions}>
          <PressScale onPress={share} scaleTo={0.97} style={styles.cta} accessibilityRole="button" accessibilityLabel="Share invite link">
            <Icon name="share" size={17} color="#FFFFFF" />
            <Text style={styles.ctaText}>Share invite link</Text>
          </PressScale>
          <PressScale onPress={copy} scaleTo={0.97} style={styles.ghost} accessibilityRole="button" accessibilityLabel="Copy link">
            <Icon name="link" size={16} color={colors.primary} />
            <Text style={styles.ghostText} numberOfLines={1}>Copy link</Text>
          </PressScale>
          <Text style={styles.link} numberOfLines={1} selectable>{data.link}</Text>
        </View>
      ) : null}

      <ChatSlotsCounter />

      {data ? (
        <View>
          {data.invitedBy ? (
            <>
              <Text style={styles.section}>Invited you</Text>
              <PersonRow p={data.invitedBy} onPress={() => nav.push('UserProfile', { id: data.invitedBy.id, name: data.invitedBy.displayName })} />
            </>
          ) : null}
          <Text style={styles.section}>Joined with your invite{data.joined.length ? ` · ${data.joined.length}` : ''}</Text>
          {data.joined.length ? data.joined.map((p, i) => (
            <FadeInUp key={p.id} index={i} distance={8} duration={260}>
              <PersonRow p={p} sub={p.joinedAt ? `Joined ${new Date(p.joinedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : null} onPress={() => nav.push('UserProfile', { id: p.id, name: p.displayName })} />
            </FadeInUp>
          )) : <Text style={styles.hint}>No one yet. Share your link — when a friend signs up with it, they’ll show up here.</Text>}

          {data.canRedeem ? (
            <View style={styles.redeem}>
              <Text style={styles.redeemTitle}>Have an invite code?</Text>
              <Text style={styles.hint}>Enter it within {data.claimDays} days of signing up to connect with the friend who invited you.</Text>
              <View style={styles.redeemRow}>
                <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={16} placeholder="e.g. K7Q2M9XD" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="Invite code" />
                <PressScale onPress={redeem} disabled={busy || !code.trim()} scaleTo={0.95} style={[styles.redeemBtn, (busy || !code.trim()) && { opacity: 0.55 }]} accessibilityRole="button" accessibilityLabel="Use code">
                  <Text style={styles.redeemBtnText}>{busy ? '…' : 'Use code'}</Text>
                </PressScale>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function PersonRow({ p, sub, onPress }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.985} style={styles.row} accessibilityRole="button" accessibilityLabel={p.displayName}>
      <SocialAvatar name={p.displayName} uri={p.avatarUrl} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName} numberOfLines={1}>{p.displayName}{p.verified ? ' ✓' : ''}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{sub || (p.handle ? `@${p.handle}` : p.church || 'BibleNestra member')}</Text>
      </View>
      <View style={styles.free}><Text style={styles.freeText}>Unlimited</Text></View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 12, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.night, ...shadow.md },
  heroInner: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 20 },
  orb: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1.5, borderColor: alpha('#D4A852', 0.55), alignItems: 'center', justifyContent: 'center' },
  heroTitle: { marginTop: 12, fontFamily: fonts.serifBold, fontSize: 23, lineHeight: 28, color: colors.nightFg, textAlign: 'center' },
  heroSub: { marginTop: 6, fontSize: 13.5, lineHeight: 19, color: colors.nightMuted, textAlign: 'center', maxWidth: 380 },
  codeBox: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: alpha('#D4A852', 0.7), alignItems: 'center' },
  codeLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.nightMuted },
  code: { marginTop: 2, fontSize: 24, fontWeight: '800', letterSpacing: 4, color: colors.goldLight },
  actions: { marginTop: 14 },
  cta: { height: 50, borderRadius: radius.pill, backgroundColor: colors.primary, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  ctaText: { fontSize: 15.5, fontWeight: '700', color: '#FFFFFF' },
  ghost: { marginTop: 8, height: 46, borderRadius: radius.pill, backgroundColor: colors.primarySoft, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  link: { marginTop: 8, fontSize: 12, color: colors.faint, textAlign: 'center' },
  section: { marginTop: 20, marginBottom: 4, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowName: { fontSize: 15, fontWeight: '700', color: colors.fg },
  rowSub: { marginTop: 2, fontSize: 13, color: colors.muted },
  free: { paddingHorizontal: 8, height: 22, borderRadius: radius.pill, backgroundColor: colors.cardGold, justifyContent: 'center' },
  freeText: { fontSize: 11, fontWeight: '700', color: colors.goldMuted },
  hint: { marginTop: 8, fontSize: 12.5, lineHeight: 18, color: colors.faint },
  redeem: { marginTop: 22, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  redeemTitle: { fontSize: 15, fontWeight: '700', color: colors.fg },
  redeemRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  input: { flex: 1, height: 44, borderRadius: radius.md, backgroundColor: colors.raised, paddingHorizontal: 12, fontSize: 16, letterSpacing: 2, color: colors.fg },
  redeemBtn: { paddingHorizontal: 16, height: 44, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  redeemBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
