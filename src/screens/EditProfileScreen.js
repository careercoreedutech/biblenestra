// SOCIAL (round 3) — Edit profile: photo (square), banner (3:1), name, handle, headline, bio, church, country
// and the device-only profile details shown on the Profile screen (testimony, skills, experience, portfolio).
//   Online: images → POST /uploads/image, then PUT /me { avatarUrl, bannerUrl (upload keys), … }.
//   Local:  everything is saved in the store (images are copied into app storage).
// Presentation: the Figma design's page header, paper cards, field inputs and plum primary button (src/design).
import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useSync } from '../api/sync';
import { useApi } from '../api/auth';
import { useNav } from '../navigation';
import { mapMeToUser } from '../api/mappers';
import { SocialAvatar } from '../components/social/FeedCard';
import { pickProfileImage, uploadProfileImage, persistLocalImage } from '../api/social';
import { DScreen, DInput, DLabel, DCard, DButton } from '../design/profile/parts';
import { Grad, Tap, gradients, d as D, df as DF, SectionTitle as DSection } from '../design/sanctuary';

const HANDLE_RE = /^[a-z0-9._]{3,30}$/;

function Field({ label, hint, children }) {
  return (
    <View>
      <DLabel>{label}</DLabel>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
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
    <DScreen
      title="Edit profile"
      subtitle={`@${handle || u.username || ''}`}
      back
      onBack={() => nav.pop()}
      action={(
        <Tap onPress={save} disabled={saving || !changed} accessibilityLabel="Save profile" style={[styles.saveBtn, (!changed || saving) && { opacity: 0.45 }]}>
          {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.saveText}>Save</Text>}
        </Tap>
      )}
    >
      {/* Photo and banner card */}
      <View style={styles.hero}>
        <Tap onPress={() => pick('banner')} style={styles.banner} accessibilityLabel="Change profile banner">
          {bannerUri ? <Image source={{ uri: bannerUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Grad colors={gradients.profile} style={StyleSheet.absoluteFill} />}
          <View style={styles.bannerChip}>
            <Icon name="image" size={13} color={D.ink} />
            <Text style={styles.bannerChipText}>{bannerUri ? 'Change banner' : 'Add banner'}</Text>
          </View>
        </Tap>
        <View style={styles.avatarWrap}>
          <Tap onPress={() => pick('avatar')} style={styles.avatarRing} accessibilityLabel="Change profile photo">
            <SocialAvatar name={f.displayName || u.displayName} uri={avatarUri} size={92} />
            <View style={styles.avatarBadge}><Icon name="edit" size={13} color="#FFFFFF" /></View>
          </Tap>
        </View>
        <View style={styles.imgLinks}>
          <Tap onPress={() => pick('avatar')} hitSlop={6} accessibilityLabel={avatarUri ? 'Change photo' : 'Add photo'}>
            <Text style={styles.imgLink}>{avatarUri ? 'Change photo' : 'Add photo'}</Text>
          </Tap>
          {avatarUri ? (
            <Tap onPress={() => setAvatar(null)} hitSlop={6} accessibilityLabel="Remove photo">
              <Text style={[styles.imgLink, { color: D.muted }]}>Remove photo</Text>
            </Tap>
          ) : null}
          {bannerUri ? (
            <Tap onPress={() => setBanner(null)} hitSlop={6} accessibilityLabel="Remove banner">
              <Text style={[styles.imgLink, { color: D.muted }]}>Remove banner</Text>
            </Tap>
          ) : null}
        </View>
        <Text style={styles.imgHint}>Photos are cropped square · banners to a wide 3:1</Text>
      </View>

      <DSection eyebrow="Public profile" title="How you appear" />
      <DCard>
        <Field label="Display name"><DInput value={f.displayName} onChangeText={set('displayName')} placeholder="Your name" maxLength={60} accessibilityLabel="Display name" /></Field>
        <Field label="Handle" hint={handle && !handleOk ? '3–30 letters, numbers, dots or underscores' : 'People can find you by your handle'}>
          <View style={styles.handleRow}>
            <Text style={styles.at}>@</Text>
            <DInput value={f.username} onChangeText={(v) => set('username')(v.replace(/^@/, ''))} placeholder="your.handle" autoCapitalize="none" autoCorrect={false} maxLength={30} style={{ flex: 1 }} accessibilityLabel="Handle" />
          </View>
        </Field>
        <Field label="Headline"><DInput value={f.headline} onChangeText={set('headline')} placeholder="e.g. Youth leader · Software engineer" maxLength={120} accessibilityLabel="Headline" /></Field>
        <Field label="Bio" hint={`${f.bio.length}/1000`}><DInput value={f.bio} onChangeText={set('bio')} placeholder="A few words about you and your faith" multiline maxLength={1000} accessibilityLabel="Bio" /></Field>
        <Field label="Church"><DInput value={f.church} onChangeText={set('church')} placeholder="Your church or fellowship" maxLength={120} accessibilityLabel="Church" /></Field>
        <Field label="Country"><DInput value={f.country} onChangeText={set('country')} placeholder="Where you're based" maxLength={60} accessibilityLabel="Country" /></Field>
      </DCard>

      <DSection eyebrow="About" title="Testimony & professional" />
      <DCard>
        <Field label="Testimony"><DInput value={f.testimony} onChangeText={set('testimony')} placeholder="Share a short testimony (optional)" multiline accessibilityLabel="Testimony" /></Field>
        <Field label="Christian skills"><DInput value={f.christianSkills} onChangeText={set('christianSkills')} placeholder="Teaching, worship, discipleship" accessibilityLabel="Christian skills" /></Field>
        <Field label="Professional skills"><DInput value={f.professionalSkills} onChangeText={set('professionalSkills')} placeholder="Technology, design, audio" accessibilityLabel="Professional skills" /></Field>
        <Field label="Experience, education, certifications"><DInput value={f.experience} onChangeText={set('experience')} placeholder="Add your background" multiline accessibilityLabel="Experience" /></Field>
        <Field label="Portfolio"><DInput value={f.portfolio} onChangeText={set('portfolio')} placeholder="Link to your work" autoCapitalize="none" accessibilityLabel="Portfolio" /></Field>
      </DCard>

      <DButton label={saving ? 'Saving…' : 'Save changes'} onPress={save} disabled={saving || !changed} style={{ marginTop: 22 }} />
      <Text style={styles.foot}>{sync.online ? 'Your photo, banner, name, handle, headline, bio, church and country are public on your profile.' : 'Saved on this device.'}</Text>
    </DScreen>
  );
}

const styles = StyleSheet.create({
  saveBtn: { height: 36, minWidth: 64, paddingHorizontal: 14, borderRadius: 12, backgroundColor: D.plum, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 12, fontFamily: DF.sansBold },
  hero: { backgroundColor: D.paper, borderRadius: 26, borderWidth: 1, borderColor: D.line, overflow: 'hidden', paddingBottom: 16 },
  banner: { height: 124, backgroundColor: '#3B2417', overflow: 'hidden' },
  bannerChip: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,250,242,0.94)', borderRadius: 999, paddingHorizontal: 11, height: 30 },
  bannerChipText: { fontSize: 11, fontFamily: DF.sansBold, color: D.ink },
  avatarWrap: { alignSelf: 'center', marginTop: -50 },
  avatarRing: { padding: 4, borderRadius: 54, backgroundColor: D.paper },
  avatarBadge: { position: 'absolute', right: 2, bottom: 4, width: 30, height: 30, borderRadius: 15, backgroundColor: D.plum, borderWidth: 2.5, borderColor: D.paper, alignItems: 'center', justifyContent: 'center' },
  imgLinks: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 10, flexWrap: 'wrap' },
  imgLink: { fontSize: 12, fontFamily: DF.sansBold, color: D.plum },
  imgHint: { fontSize: 10, fontFamily: DF.sans, color: D.muted, textAlign: 'center', marginTop: 6 },
  hint: { fontSize: 10, fontFamily: DF.sans, color: D.muted, marginTop: 6 },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  at: { fontSize: 16, fontFamily: DF.sansBold, color: D.muted },
  foot: { fontSize: 11, lineHeight: 16, fontFamily: DF.sans, color: D.muted, textAlign: 'center', marginTop: 12 },
});
