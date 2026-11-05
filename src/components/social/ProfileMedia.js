// SOCIAL (round 3) — small pieces the Profile screen uses for the editable header:
// the banner image, the avatar image and the pencil "Edit profile" button.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icons';
import { colors, radius, shadow } from '../../theme';
import { PressScale } from '../Motion';
import { useStore } from '../../store';
import { useSync } from '../../api/sync';
import { useNav } from '../../navigation';
import { PEOPLE } from '../../data/seed';
import PeopleSheet from './PeopleSheet';
import { useOpenProfile } from './profileNav';
import { FollowListSheet } from '../../screens/UserProfileScreen';

export function BannerImage({ uri }) {
  if (!uri) return null;
  return <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Profile banner" />;
}

export function AvatarImage({ uri, size = 84, style }) {
  return <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardGold }, style]} accessibilityLabel="Profile photo" />;
}

/** Pencil button that opens Edit profile (sits on the profile banner). */
export function EditProfileButton({ onPress, style, label = 'Edit' }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.92} hitSlop={8} style={[styles.btn, style]} accessibilityLabel="Edit profile" accessibilityRole="button">
      <Icon name="edit" size={14} color={colors.fg} />
      {label ? <Text style={styles.text}>{label}</Text> : null}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  btn: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.94)', ...shadow.sm },
  text: { fontSize: 12.5, fontWeight: '700', color: colors.fg },
});

export const avatarBadge = StyleSheet.create({
  wrap: { position: 'absolute', right: 0, bottom: 2, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
}).wrap;

export function AvatarEditBadge() {
  return <View pointerEvents="none" style={avatarBadge}><Icon name="edit" size={11} color="#FFFFFF" /></View>;
}

// ─── "N followers · N following" on your own Profile (tap → people list → their profile) ───
export function FollowSummary() {
  const { state } = useStore();
  const sync = useSync();
  const nav = useNav();
  const openProfile = useOpenProfile();
  const [which, setWhich] = React.useState(null);
  const u = state.user || {};
  const online = sync.online && u.id && u.id !== 'me';
  // Local mode: the people and creators you follow on this device
  const localFollows = React.useMemo(() => {
    if (online) return [];
    const out = [];
    (state.follows || []).forEach((k) => {
      const seed = PEOPLE.find((p) => p.id === k || p.username === k);
      if (seed) { out.push({ id: seed.id, name: seed.name, handle: seed.username, headline: seed.headline }); return; }
      const v = (state.videos || []).find((x) => x.creator && x.creator.handle === k);
      if (v) out.push({ id: k, name: v.creator.name, handle: k, headline: v.creator.church || '' });
    });
    return out;
  }, [online, state.follows, state.videos]);
  const following = online ? u.following || 0 : localFollows.length;
  return (
    <View style={fs.row}>
      {online ? (
        <PressScale onPress={() => setWhich('followers')} scaleTo={0.94} hitSlop={6} accessibilityLabel={`${u.followers || 0} followers · see who`}>
          <Text style={fs.text}><Text style={fs.num}>{u.followers || 0}</Text> {(u.followers || 0) === 1 ? 'follower' : 'followers'}</Text>
        </PressScale>
      ) : null}
      {online ? <Text style={fs.dot}>·</Text> : null}
      <PressScale onPress={() => setWhich('following')} scaleTo={0.94} hitSlop={6} accessibilityLabel={`${following} following`}>
        <Text style={fs.text}><Text style={fs.num}>{following}</Text> following</Text>
      </PressScale>
      {online ? <Text style={fs.dot}>·</Text> : null}
      {online ? (
        <PressScale onPress={() => nav.push('UserProfile', { id: u.id, name: u.displayName })} scaleTo={0.94} hitSlop={6} accessibilityLabel="View your public profile">
          <Text style={[fs.text, { color: colors.primary, fontWeight: '700' }]}>Public profile</Text>
        </PressScale>
      ) : null}
      {online ? (
        <FollowListSheet userId={u.id} which={which} name={u.displayName} onClose={() => setWhich(null)} />
      ) : (
        <PeopleSheet
          visible={!!which}
          title="Following"
          eyebrow={u.displayName}
          load={which ? async () => localFollows : null}
          emptyText="You’re not following anyone yet"
          rowIcon="chevron"
          onClose={() => setWhich(null)}
          onOpenPerson={(p) => { setWhich(null); setTimeout(() => openProfile({ name: p.name, handle: p.handle }), 200); }}
        />
      )}
    </View>
  );
}

const fs = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  text: { fontSize: 13, color: colors.muted },
  num: { fontWeight: '800', color: colors.fg },
  dot: { fontSize: 13, color: colors.faint },
});
