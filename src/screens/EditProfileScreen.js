// SOCIAL (round 3) — Edit profile: photo (square), banner (3:1), name, handle, headline, bio, church, country
// and the device-only profile details shown on the Profile screen (testimony, skills, experience, portfolio).
//   Online: images → POST /uploads/image, then PUT /me { avatarUrl, bannerUrl (upload keys), … }.
//   Local:  everything is saved in the store (images are copied into app storage).
import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { Screen, Input, Button, NightGlow, alpha } from '../components/ui';
import { FadeInUp, PressScale, ScaleIn } from '../components/Motion';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useSync } from '../api/sync';
import { useApi } from '../api/auth';
import { useNav } from '../navigation';
import { mapMeToUser } from '../api/mappers';
import { SocialAvatar } from '../components/social/FeedCard';
import { pickProfileImage, uploadProfileImage, persistLocalImage } from '../api/social';

const HANDLE_RE = /^[a-z0-9._]{3,30}$/;

function Field({ label, hint, children, index }) {
  return (
    <FadeInUp index={index} distance={8} duration={320} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </FadeInUp>
  );
}

export default function EditProfileScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const sync = useSync();
  const api = useApi();
  const u = state.user || {};
  const [f, setF] = useState(() => ({
    displayName: u.displayName || '',
    username: u.username || '',
    headline: u.headline || '',
    bio: u.bio || '',
    church: (u.church && u.church.name) || '',
    country: u.country || '',
    testimony: u.testimony || '',
    christianSkills: u.christianSkills || '',
    professionalSkills: u.professionalSkills || '',
    experience: u.experience || '',
    portfolio: u.portfolio || '',
  }));
  // { uri, img } = newly picked; null = removed; undefined = unchanged
  const [avatar, setAvatar] = useState(undefined);
  const [banner, setBanner] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const avatarUri = avatar === undefined ? u.avatarUrl : avatar && avatar.uri;
  const bannerUri = banner === undefined ? u.bannerUrl : banner && banner.uri;

  const pick = async (kind) => {
    try {
      const img = await pickProfileImage(kind);
      if (!img) return;
      const v = { uri: img.dataUrl || img.uri, img };
      if (kind === 'banner') setBanner(v); else setAvatar(v);
    } catch (e) {
      toast.show(e.message || 'Couldn’t open your photos', { tone: 'error' });
    }
  };

  const handle = f.username.trim().replace(/^@/, '').toLowerCase();
  const nameOk = f.displayName.trim().length > 0;
  const handleOk = HANDLE_RE.test(handle);
  const changed = avatar !== undefined || banner !== undefined || Object.keys(f).some((k) => {
    const cur = k === 'church' ? (u.church && u.church.name) || '' : u[k] || '';
    return String(f[k]).trim() !== String(cur).trim();
  });

  const save = async () => {
    if (saving) return;
    if (!nameOk) { toast.show('Add your name', { tone: 'error' }); return; }
    if (!handleOk) { toast.show('Handles use 3–30 letters, numbers, dots or underscores', { tone: 'error' }); return; }
    setSaving(true);
    const extras = {
      testimony: f.testimony.trim(), christianSkills: f.christianSkills.trim(), professionalSkills: f.professionalSkills.trim(),
      experience: f.experience.trim(), portfolio: f.portfolio.trim(),
    };
    try {
      if (sync.online) {
        const body = {
          displayName: f.displayName.trim(), handle, headline: f.headline.trim(), bio: f.bio.trim(), church: f.church.trim(), country: f.country.trim(),
        };
        if (avatar === null) body.avatarUrl = null;
        else if (avatar) body.avatarUrl = (await uploadProfileImage(api.request, avatar.img)).key;
        if (banner === null) body.bannerUrl = null;
        else if (banner) body.bannerUrl = (await uploadProfileImage(api.request, banner.img)).key;
        const me = await api.request('PUT', '/me', body);
        const cur = state.user || {};
        const next = { ...mapMeToUser(me, cur), ...extras };
        // A church added here should show on the profile (visibility can be changed under Privacy)
        if (me.church && !(cur.church && cur.church.name)) next.church = { ...next.church, visible: true };
        dispatch({ type: 'serverSync', patch: { user: next }, local: true });
      } else {
        const patch = {
          displayName: f.displayName.trim(), username: handle, headline: f.headline.trim(), bio: f.bio.trim(), country: f.country.trim(),
          church: { ...(u.church || {}), name: f.church.trim(), visible: f.church.trim() ? (u.church ? u.church.visible !== false : true) : false },
          ...extras,
        };
        if (avatar === null) patch.avatarUrl = null;
        else if (avatar) patch.avatarUrl = await persistLocalImage(avatar.img, 'avatar');
        if (banner === null) patch.bannerUrl = null;
        else if (banner) patch.bannerUrl = await persistLocalImage(banner.img, 'banner');
        dispatch({ type: 'user', user: patch });
      }
      toast.show('Profile updated', { icon: 'check', haptic: 'success' });
      nav.pop();
    } catch (e) {
      const msg = e && e.code === 'HANDLE_TAKEN' ? `@${handle} is taken — try another handle` : (e && e.message) || 'Couldn’t save your profile';
      toast.show(msg, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      back
      title="Edit profile"
      subtitle={`@${handle || u.username || ''}`}
      right={(
        <PressScale onPress={save} disabled={saving || !changed} scaleTo={0.92} hitSlop={8} style={[styles.saveBtn, (!changed || saving) && { opacity: 0.45 }]} accessibilityLabel="Save profile">
          {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.saveText}>Save</Text>}
        </PressScale>
      )}
    >
      <FadeInUp distance={10} style={styles.hero}>
        <PressScale onPress={() => pick('banner')} scaleTo={0.99} style={styles.banner} accessibilityLabel="Change profile banner">
          {bannerUri ? <Image source={{ uri: bannerUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <NightGlow />}
          <View style={styles.bannerChip}>
            <Icon name="image" size={13} color={colors.fg} />
            <Text style={styles.bannerChipText}>{bannerUri ? 'Change banner' : 'Add banner'}</Text>
          </View>
        </PressScale>
        <ScaleIn delay={100} from={0.7} style={styles.avatarWrap}>
          <PressScale onPress={() => pick('avatar')} scaleTo={0.94} style={styles.avatarRing} accessibilityLabel="Change profile photo">
            <SocialAvatar name={f.displayName || u.displayName} uri={avatarUri} size={92} />
            <View style={styles.avatarBadge}><Icon name="edit" size={13} color="#FFFFFF" /></View>
          </PressScale>
        </ScaleIn>
        <View style={styles.imgLinks}>
          <PressScale onPress={() => pick('avatar')} scaleTo={0.94} hitSlop={6} accessibilityLabel={avatarUri ? 'Change photo' : 'Add photo'}>
            <Text style={styles.imgLink}>{avatarUri ? 'Change photo' : 'Add photo'}</Text>
          </PressScale>
          {avatarUri ? (
            <PressScale onPress={() => setAvatar(null)} scaleTo={0.94} hitSlop={6} accessibilityLabel="Remove photo">
              <Text style={[styles.imgLink, { color: colors.muted }]}>Remove photo</Text>
            </PressScale>
          ) : null}
          {bannerUri ? (
            <PressScale onPress={() => setBanner(null)} scaleTo={0.94} hitSlop={6} accessibilityLabel="Remove banner">
              <Text style={[styles.imgLink, { color: colors.muted }]}>Remove banner</Text>
            </PressScale>
          ) : null}
        </View>
        <Text style={styles.imgHint}>Photos are cropped square · banners to a wide 3:1</Text>
      </FadeInUp>

      <Text style={styles.group}>Public profile</Text>
      <View style={styles.card}>
        <Field label="Display name" index={1}><Input value={f.displayName} onChangeText={set('displayName')} placeholder="Your name" maxLength={60} accessibilityLabel="Display name" /></Field>
        <Field label="Handle" hint={handle && !handleOk ? '3–30 letters, numbers, dots or underscores' : 'People can find you by your handle'} index={2}>
          <View style={styles.handleRow}>
            <Text style={styles.at}>@</Text>
            <Input value={f.username} onChangeText={(v) => set('username')(v.replace(/^@/, ''))} placeholder="your.handle" autoCapitalize="none" autoCorrect={false} maxLength={30} style={{ flex: 1 }} accessibilityLabel="Handle" />
          </View>
        </Field>
        <Field label="Headline" index={3}><Input value={f.headline} onChangeText={set('headline')} placeholder="e.g. Youth leader · Software engineer" maxLength={120} accessibilityLabel="Headline" /></Field>
        <Field label="Bio" hint={`${f.bio.length}/1000`} index={4}><Input value={f.bio} onChangeText={set('bio')} placeholder="A few words about you and your faith" multiline maxLength={1000} accessibilityLabel="Bio" /></Field>
        <Field label="Church" index={5}><Input value={f.church} onChangeText={set('church')} placeholder="Your church or fellowship" maxLength={120} accessibilityLabel="Church" /></Field>
        <Field label="Country" index={6}><Input value={f.country} onChangeText={set('country')} placeholder="Where you're based" maxLength={60} accessibilityLabel="Country" /></Field>
      </View>

      <Text style={styles.group}>About & professional</Text>
      <View style={styles.card}>
        <Field label="Testimony" index={7}><Input value={f.testimony} onChangeText={set('testimony')} placeholder="Share a short testimony (optional)" multiline accessibilityLabel="Testimony" /></Field>
        <Field label="Christian skills" index={8}><Input value={f.christianSkills} onChangeText={set('christianSkills')} placeholder="Teaching, worship, discipleship" accessibilityLabel="Christian skills" /></Field>
        <Field label="Professional skills" index={9}><Input value={f.professionalSkills} onChangeText={set('professionalSkills')} placeholder="Technology, design, audio" accessibilityLabel="Professional skills" /></Field>
        <Field label="Experience, education, certifications" index={10}><Input value={f.experience} onChangeText={set('experience')} placeholder="Add your background" multiline accessibilityLabel="Experience" /></Field>
        <Field label="Portfolio" index={11}><Input value={f.portfolio} onChangeText={set('portfolio')} placeholder="Link to your work" autoCapitalize="none" accessibilityLabel="Portfolio" /></Field>
      </View>

      <Button label={saving ? 'Saving…' : 'Save changes'} onPress={save} disabled={saving || !changed} style={{ marginTop: 22 }} />
      <Text style={styles.foot}>{sync.online ? 'Your photo, banner, name, handle, headline, bio, church and country are public on your profile.' : 'Saved on this device.'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  saveBtn: { height: 34, minWidth: 64, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  hero: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', paddingBottom: 16, ...shadow.md },
  banner: { height: 124, backgroundColor: colors.night, overflow: 'hidden' },
  bannerChip: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.pill, paddingHorizontal: 11, height: 30, ...shadow.sm },
  bannerChipText: { fontSize: 12, fontWeight: '700', color: colors.fg },
  avatarWrap: { alignSelf: 'center', marginTop: -50 },
  avatarRing: { padding: 4, borderRadius: 54, backgroundColor: colors.surface, ...shadow.sm },
  avatarBadge: { position: 'absolute', right: 2, bottom: 4, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, borderWidth: 2.5, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  imgLinks: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 10, flexWrap: 'wrap' },
  imgLink: { fontSize: 13, fontWeight: '700', color: colors.primary },
  imgHint: { fontSize: 11.5, color: colors.faint, textAlign: 'center', marginTop: 6 },
  group: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.gold, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 14, ...shadow.sm },
  field: {},
  label: { fontSize: 12.5, fontWeight: '700', color: colors.fg, marginBottom: 6 },
  hint: { fontSize: 11.5, color: colors.faint, marginTop: 5 },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  at: { fontSize: 16, fontWeight: '700', color: colors.muted },
  foot: { fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 12, lineHeight: 17 },
});
