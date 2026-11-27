// CHAT LIMITS (client #27): Invite friends — your personal invite link/code, who joined through you, and
// "Have an invite code?" for people who installed before opening the link. Invited friends (both ways) can
// always chat with you, even on the free plan. Server: backend/src/routes/referrals.js (GET /me/invite).
// Styled in the Figma "Invites" design (src/design/sanctuary.js + src/design/profile/parts.js).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { useApi } from '../api/auth';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { errorMessage } from '../api/client';
import { ChatSlotsCounter } from '../components/ChatLimit';
import { d, df, Grad, Tap, SectionTitle } from '../design/sanctuary';
import { DScreen, DInput, DButton } from '../design/profile/parts';

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
    return <DScreen back onBack={() => nav.pop()} title="Invite friends" subtitle="Grow the circle"><Empty title="Sign in first" body="Invite links connect your BibleNestra account with your friends’." /></DScreen>;
  }
  return (
    <DScreen back onBack={() => nav.pop()} title="Invite friends" subtitle="Grow the circle">
      <FadeInUp distance={10}>
        {/* .invite-hero */}
        <Grad colors={['#F2D18E', '#F8EBD0']} style={s.hero}>
          <Icon name="users" size={32} color={d.goldDark} strokeWidth={1.8} />
          <Text style={s.heroEyebrow}>Your invite code</Text>
          {data ? (
            <Text style={s.code} selectable accessibilityLabel={`Your invite code ${data.code.split('').join(' ')}`}>{data.code}</Text>
          ) : error ? null : <ActivityIndicator color={d.goldDark} style={{ marginTop: 16 }} />}
          <Text style={s.heroBody}>Friends who join with your link are unlimited — they never use one of your free chats, and you never use theirs.</Text>
          {data ? (
            <View style={s.heroButtons}>
              <Tap onPress={share} style={[s.heroBtn, { backgroundColor: d.ink }]} accessibilityRole="button" accessibilityLabel="Share invite link">
                <Icon name="share" size={13} color="#FFFFFF" />
                <Text style={[s.heroBtnText, { color: '#FFFFFF' }]}>Share invite</Text>
              </Tap>
              <Tap onPress={copy} style={[s.heroBtn, { backgroundColor: 'rgba(255,255,255,0.55)' }]} accessibilityRole="button" accessibilityLabel="Copy link">
                <Icon name="link" size={13} color={d.goldDark} />
                <Text style={[s.heroBtnText, { color: d.goldDark }]}>Copy link</Text>
              </Tap>
            </View>
          ) : null}
          {data ? <Text style={s.link} numberOfLines={1} selectable>{data.link}</Text> : null}
        </Grad>
      </FadeInUp>
      {error ? <Notice tint={d.roseDark} text={error} /> : null}

      <ChatSlotsCounter />

      {data ? (
        <View>
          {/* .invite-stats */}
          <View style={s.stats}>
            <View style={s.stat}>
              <Text style={s.statNum}>{data.joined.length}</Text>
              <Text style={s.statLabel}>Friends joined</Text>
            </View>
          </View>

          {data.invitedBy ? (
            <>
              <SectionTitle eyebrow="Your circle" title="Invited you" />
              <PersonRow p={data.invitedBy} onPress={() => nav.push('UserProfile', { id: data.invitedBy.id, name: data.invitedBy.displayName })} />
            </>
          ) : null}

          <SectionTitle eyebrow="Your circle" title={`Your invited friends${data.joined.length ? ` · ${data.joined.length}` : ''}`} />
          {data.joined.length ? (
            <View style={s.list}>
              {data.joined.map((p, i) => (
                <FadeInUp key={p.id} index={i} distance={8} duration={260}>
                  <PersonRow p={p} sub={p.joinedAt ? `Joined ${new Date(p.joinedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : null} onPress={() => nav.push('UserProfile', { id: p.id, name: p.displayName })} />
                </FadeInUp>
              ))}
            </View>
          ) : <Text style={s.hint}>No one yet. Share your link — when a friend signs up with it, they’ll show up here.</Text>}

          {data.canRedeem ? (
            /* .late-code: "Have an invite code?" */
            <View style={s.redeem}>
              <Text style={s.redeemTitle}>Have an invite code?</Text>
              <Text style={s.hint}>Enter it within {data.claimDays} days of signing up to connect with the friend who invited you.</Text>
              <View style={s.redeemRow}>
                <DInput
                  value={code}
                  onChangeText={(t) => setCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={16}
                  placeholder="e.g. K7Q2M9XD"
                  accessibilityLabel="Invite code"
                  style={s.input}
                />
                <DButton small label={busy ? '…' : 'Use code'} disabled={busy || !code.trim()} onPress={redeem} style={{ alignSelf: 'stretch' }} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </DScreen>
  );
}

function PersonRow({ p, sub, onPress }) {
  return (
    <Tap onPress={onPress} style={s.row} accessibilityRole="button" accessibilityLabel={p.displayName}>
      <SocialAvatar name={p.displayName} uri={p.avatarUrl} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowName} numberOfLines={1}>{p.displayName}{p.verified ? ' ✓' : ''}</Text>
        <Text style={s.rowSub} numberOfLines={1}>{sub || (p.handle ? `@${p.handle}` : p.church || 'BibleNestra member')}</Text>
      </View>
      <View style={s.free}><Text style={s.freeText}>Unlimited</Text></View>
    </Tap>
  );
}

const s = StyleSheet.create({
  hero: { marginTop: 8, borderRadius: 26, paddingVertical: 25, paddingHorizontal: 22, alignItems: 'center' },
  heroEyebrow: { marginTop: 14, fontFamily: df.sansHeavy, fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: d.goldDark },
  code: { marginTop: 4, fontFamily: df.displayBold, fontSize: 35, letterSpacing: 2, color: d.goldDark },
  heroBody: { marginTop: 6, maxWidth: 290, fontFamily: df.sans, fontSize: 11, lineHeight: 16, color: d.goldDark, textAlign: 'center' },
  heroButtons: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 18 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11 },
  heroBtnText: { fontFamily: df.sansBold, fontSize: 11 },
  link: { marginTop: 12, fontFamily: df.sans, fontSize: 10, color: d.goldDark, opacity: 0.8 },
  stats: { flexDirection: 'row', marginTop: 12 },
  stat: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  statNum: { fontFamily: df.displayBold, fontSize: 17, color: d.ink },
  statLabel: { marginTop: 2, fontFamily: df.sans, fontSize: 9, color: d.muted },
  list: { gap: 9 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 17, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper, marginBottom: 9 },
  rowName: { fontFamily: df.display, fontSize: 13, color: d.ink },
  rowSub: { fontFamily: df.sans, fontSize: 9, color: d.muted, marginTop: 3 },
  free: { paddingHorizontal: 9, height: 22, borderRadius: 11, backgroundColor: d.sage, justifyContent: 'center' },
  freeText: { fontFamily: df.sansBold, fontSize: 9, color: d.sageDark },
  hint: { marginTop: 8, fontFamily: df.sans, fontSize: 10, lineHeight: 15, color: d.muted },
  redeem: { marginTop: 18, padding: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBB9A8', backgroundColor: d.paper },
  redeemTitle: { fontFamily: df.display, fontSize: 14, color: d.ink },
  redeemRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  input: { flex: 1, height: 48, letterSpacing: 2, fontFamily: df.sansBold, fontSize: 14 },
});
