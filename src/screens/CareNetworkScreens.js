// CHRISTIAN CARE NETWORK (brief 6.7): Talk to a Priest (verified directory → profile → private chat, apply to be listed)
// and Talk to an Apostle (opens the Apostle's inbox directly). Server: backend/src/routes/care.js.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, Button, Input, Badge, Tag, Notice, Empty, Pills } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, ScaleIn, Pulse } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';
import { errorMessage } from '../api/client';

const AVAIL = {
  available: { label: 'Available', tint: colors.positive || colors.sage },
  busy: { label: 'Busy — replies later', tint: colors.gold },
  away: { label: 'Away', tint: colors.faint },
};
const OFFLINE = 'Connect to the internet to use the Care network.';

/** GET /care — apostle availability, my priest application, my care inbox counts. */
export function useCareSummary() {
  const api = useApi();
  const focused = useIsFocused();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    if (!api.online) { setData({ offline: true, apostle: { available: false }, inbox: {} }); return; }
    try { setData(await api.request('GET', '/care')); setError(null); }
    catch (e) { setError(errorMessage(e, 'Couldn’t load the Care network')); }
  }, [api.online, api.request]);
  useEffect(() => { if (focused !== false) refresh(); }, [refresh, focused]);
  return { data, error, refresh };
}

// Open the chat a /care endpoint returned ({ id, with }) the same way useOpenDm does.
function useOpenCareChat() {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const sync = useSync();
  return useCallback(async (path, fallback) => {
    if (!api.online) { toast.show(OFFLINE, { icon: 'x' }); return null; }
    try {
      const r = await api.request('POST', path);
      nav.push('Chat', { id: r.id, to: (r.with && r.with.displayName) || fallback, userId: r.with && r.with.id });
      if (sync.refresh) sync.refresh({ quiet: true });
      return r;
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t open the chat'), { tone: 'error', icon: 'x' });
      return null;
    }
  }, [api, nav, toast, sync]);
}

// ---------- Entry cards inside the Care screen ----------
export function CareNetworkOptions({ summary }) {
  const nav = useNav();
  const openChat = useOpenCareChat();
  const [busy, setBusy] = useState(false);
  const d = summary || {};
  const apostle = d.apostle || { available: false };
  const talkToApostle = async () => {
    if (!apostle.available || busy) return;
    setBusy(true);
    await openChat('/care/apostle/chat', apostle.name || 'The Apostle');
    setBusy(false);
  };
  return (
    <View style={{ marginTop: 14, gap: 10 }}>
      <FadeInUp index={1} distance={10}>
        <PressScale onPress={() => nav.push('Priests')} scaleTo={0.985} style={[styles.option, { backgroundColor: '#EEF0F8' }]} accessibilityRole="button" accessibilityLabel="Talk to a Priest">
          <View style={[styles.optionIcon, { backgroundColor: colors.primary }]}><Icon name="church" size={20} color="#FFFFFF" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.optionTitle}>Talk to a Priest</Text>
            <Text style={styles.optionSub}>Verified Catholic priests · private conversation</Text>
          </View>
          <Icon name="chevron-right" size={15} color={colors.faint} />
        </PressScale>
      </FadeInUp>
      <FadeInUp index={2} distance={10}>
        <PressScale onPress={talkToApostle} disabled={!apostle.available} scaleTo={0.985} style={[styles.option, { backgroundColor: colors.cardGold }]} accessibilityRole="button" accessibilityLabel="Talk to an Apostle">
          <Pulse min={0.95} max={1.05} duration={2000} active={!!apostle.available}>
            {apostle.available && apostle.avatarUrl ? <SocialAvatar name={apostle.displayName} uri={apostle.avatarUrl} size={44} ring /> : (
              <View style={[styles.optionIcon, { backgroundColor: colors.gold }]}><Icon name="sparkles" size={20} color="#FFFFFF" /></View>
            )}
          </Pulse>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.optionTitle}>Talk to an Apostle</Text>
            <Text style={styles.optionSub} numberOfLines={2}>
              {apostle.available ? `Message ${apostle.name || 'the Apostle'} directly — personal and private` : d.offline ? OFFLINE : 'Coming soon'}
            </Text>
          </View>
          {busy ? <ActivityIndicator color={colors.gold} /> : apostle.available ? <Icon name="chat" size={16} color={colors.goldMuted} /> : <Tag label="Soon" />}
        </PressScale>
      </FadeInUp>
      {d.isApostle ? (
        <FadeInUp index={3} distance={10}>
          <Button kind="ghost" label={`Apostle inbox${d.inbox && d.inbox.apostle ? ` (${d.inbox.apostle})` : ''}`} icon={<Icon name="chat" size={14} color={colors.fg} />} onPress={() => nav.push('CareInbox', { kind: 'apostle' })} />
        </FadeInUp>
      ) : null}
      {d.priest && d.priest.status === 'approved' ? (
        <FadeInUp index={3} distance={10}>
          <Button kind="ghost" label={`My “Talk to a Priest” chats${d.inbox && d.inbox.priest ? ` (${d.inbox.priest})` : ''}`} icon={<Icon name="chat" size={14} color={colors.fg} />} onPress={() => nav.push('CareInbox', { kind: 'priest' })} />
        </FadeInUp>
      ) : null}
    </View>
  );
}

// ---------- Talk to a Priest: directory ----------
function PriestCard({ p, onPress, index }) {
  const av = AVAIL[p.availability] || AVAIL.available;
  return (
    <FadeInUp index={index} distance={10} duration={300}>
      <PressScale onPress={onPress} scaleTo={0.985} style={styles.card} accessibilityRole="button" accessibilityLabel={`${p.displayName}, ${p.parish || p.diocese}, ${p.country}`}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View>
            <SocialAvatar name={p.name} uri={p.photoUrl} size={56} ring />
            <View style={[styles.availDot, { backgroundColor: av.tint }]} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={styles.name} numberOfLines={1}>{p.displayName}</Text>
              {p.verified ? <VerifiedBadge /> : null}
            </View>
            <Text style={styles.meta} numberOfLines={1}>{[p.parish, p.diocese].filter(Boolean).join(' · ')}</Text>
            <Text style={styles.meta} numberOfLines={1}>{p.country} · {p.languages.join(', ')}</Text>
          </View>
        </View>
        {p.bio ? <Text style={styles.bio} numberOfLines={2}>{p.bio}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <Badge label={av.label} tint={av.tint} />
          <Text style={styles.link}>View profile</Text>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

function VerifiedBadge() {
  return (
    <View style={styles.verified}>
      <Icon name="check" size={10} color="#FFFFFF" strokeWidth={3} />
      <Text style={styles.verifiedText}>Verified</Text>
    </View>
  );
}

export function PriestsScreen() {
  const api = useApi();
  const nav = useNav();
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('All countries');
  const [language, setLanguage] = useState('All languages');
  const [data, setData] = useState(null);
  const [facets, setFacets] = useState({ countries: [], languages: [] });
  const [error, setError] = useState(null);
  const { data: summary } = useCareSummary();
  useEffect(() => {
    if (!api.online) { setData([]); return undefined; }
    const t = setTimeout(async () => {
      const qs = [q.trim() && `q=${encodeURIComponent(q.trim())}`, country !== 'All countries' && `country=${encodeURIComponent(country)}`, language !== 'All languages' && `language=${encodeURIComponent(language)}`].filter(Boolean).join('&');
      try {
        const r = await api.request('GET', `/care/priests${qs ? `?${qs}` : ''}`);
        setData(r.items || []);
        if (!qs) setFacets({ countries: r.countries || [], languages: r.languages || [] });
        else setFacets((f) => ({ countries: f.countries.length ? f.countries : r.countries || [], languages: f.languages.length ? f.languages : r.languages || [] }));
        setError(null);
      } catch (e) { setError(errorMessage(e, 'Couldn’t load priests')); setData((x) => x || []); }
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, country, language, api.online]);
  const mine = summary && summary.priest;
  return (
    <Screen back title="Talk to a Priest" subtitle="Verified Catholic priests">
      <FadeInUp style={styles.hero}>
        <Text style={styles.heroEyebrow}>✦  Christian Care Network</Text>
        <Text style={styles.heroTitle}>A priest who will listen</Text>
        <Text style={styles.heroSub}>Every priest here was verified by the Bible Nestra team. Conversations are private between you and the priest.</Text>
      </FadeInUp>
      {!api.online ? <Notice text={OFFLINE} /> : null}
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search by name, parish or diocese" placeholderTextColor={colors.faint} style={styles.searchInput} autoCorrect={false} />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={10}><Icon name="x" size={14} color={colors.muted} /></Pressable> : null}
      </View>
      {facets.countries.length > 1 ? <Pills small items={['All countries', ...facets.countries]} value={country} onChange={setCountry} style={{ marginTop: 10 }} /> : null}
      {facets.languages.length > 1 ? <Pills small items={['All languages', ...facets.languages]} value={language} onChange={setLanguage} style={{ marginTop: 8 }} /> : null}
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {data === null ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : null}
      {data && data.map((p, i) => <PriestCard key={p.id} p={p} index={i} onPress={() => nav.push('PriestProfile', { id: p.id, priest: p })} />)}
      {data && !data.length && api.online && !error ? (
        <ScaleIn from={0.92} style={{ marginTop: 10 }}>
          <Empty
            title={q || country !== 'All countries' || language !== 'All languages' ? 'No priests match' : 'Priests are joining soon'}
            body={q || country !== 'All countries' || language !== 'All languages' ? 'Try another search, country or language.' : 'We verify every priest before they are listed. Please check back soon.'}
          />
        </ScaleIn>
      ) : null}
      <FadeInUp index={2} style={{ marginTop: 18 }}>
        <PressScale onPress={() => nav.push('PriestApply')} scaleTo={0.985} style={styles.applyRow} accessibilityRole="button">
          <Icon name="church" size={17} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.applyTitle}>{mine ? 'My priest profile' : 'Are you a Catholic priest?'}</Text>
            <Text style={styles.meta}>{mine ? STATUS_TEXT[mine.status] || mine.status : 'Apply to be listed — we verify every profile'}</Text>
          </View>
          <Icon name="chevron-right" size={15} color={colors.faint} />
        </PressScale>
      </FadeInUp>
    </Screen>
  );
}

const STATUS_TEXT = {
  pending: 'Under review — we will notify you',
  approved: 'Verified and listed',
  rejected: 'Not approved — you can update and apply again',
  hidden: 'Hidden by the Bible Nestra team',
  suspended: 'Paused by the Bible Nestra team',
};

// ---------- Priest profile ----------
export function PriestProfileScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const openChat = useOpenCareChat();
  const [p, setP] = useState(params.priest || null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!api.online || !params.id) return;
    api.request('GET', `/care/priests/${params.id}`).then((r) => { setP(r); setError(null); }).catch((e) => setError(errorMessage(e, 'This priest is not listed')));
  }, [params.id, api.online]);
  if (!p) {
    return (
      <Screen back title="Priest">
        {error ? <Empty title="Not available" body={error} action="Back to the directory" onAction={() => nav.pop()} /> : <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}
      </Screen>
    );
  }
  const av = AVAIL[p.availability] || AVAIL.available;
  const message = async () => { setBusy(true); await openChat(`/care/priests/${p.id}/message`, p.displayName); setBusy(false); };
  return (
    <Screen back title={p.displayName} subtitle="Talk to a Priest">
      <FadeInUp style={styles.profile}>
        <ScaleIn from={0.7} delay={80}>
          <SocialAvatar name={p.name} uri={p.photoUrl} size={92} ring />
        </ScaleIn>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <Text style={styles.profileName}>{p.displayName}</Text>
          {p.verified ? <VerifiedBadge /> : null}
        </View>
        <Text style={styles.profileMeta}>{[p.parish, p.diocese].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.profileMeta}>{p.country} · {p.languages.join(', ')}</Text>
        <View style={{ marginTop: 10 }}><Badge label={av.label} tint={av.tint} /></View>
        {p.bio ? <Text style={styles.profileBio}>“{p.bio}”</Text> : null}
        {error ? <Notice tint={colors.negative} text={error} /> : null}
        {p.status && p.status !== 'approved' ? (
          <Notice text={STATUS_TEXT[p.status] || p.status} />
        ) : (
          <Button label={busy ? 'Opening…' : 'Message'} disabled={busy || !!error} icon={<Icon name="chat" size={15} color="#FFFFFF" />} onPress={message} style={{ marginTop: 18, alignSelf: 'stretch' }} />
        )}
      </FadeInUp>
      <Notice text="Your conversation is private between you and the priest. For confession and the sacraments, please visit your parish. In an emergency, contact local emergency services." />
    </Screen>
  );
}

// ---------- Apply to be listed (and manage my profile) ----------
export function PriestApplyScreen() {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const [mine, setMine] = useState(undefined);
  const [f, setF] = useState({ title: 'Rev. Fr.', name: '', parish: '', diocese: '', country: '', languages: '', bio: '', photoUrl: '', availability: 'available', referenceNote: '' });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!api.online) { setMine(null); return; }
    api.request('GET', '/care/priests/mine').then((r) => {
      setMine(r.priest);
      if (r.priest) {
        const p = r.priest;
        setF({ title: p.title, name: p.name, parish: p.parish, diocese: p.diocese, country: p.country, languages: p.languages.join(', '), bio: p.bio, photoUrl: p.photoUrl && /^https:/.test(p.photoUrl) ? p.photoUrl : '', availability: p.availability, referenceNote: p.referenceNote || '' });
      }
    }).catch(() => setMine(null));
  }, [api.online]);
  const approved = mine && mine.status === 'approved';
  const paused = mine && ['hidden', 'suspended'].includes(mine.status);
  const submit = async () => {
    if (!api.online) { toast.show(OFFLINE, { icon: 'x' }); return; }
    setBusy(true);
    try {
      const langs = f.languages.split(',').map((s) => s.trim()).filter(Boolean);
      const r = approved
        ? await api.request('PATCH', '/care/priests/mine', { availability: f.availability, bio: f.bio, languages: langs, photoUrl: f.photoUrl.trim() || null })
        : await api.request('POST', '/care/priests/apply', { ...f, photoUrl: f.photoUrl.trim() || null, languages: langs, confirm });
      setMine(r);
      toast.show(approved ? 'Profile updated' : 'Application sent — we will notify you', { icon: 'check', haptic: 'success' });
      if (!approved) nav.pop();
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t send your application'), { tone: 'error', icon: 'x' }); }
    setBusy(false);
  };
  if (mine === undefined) return <Screen back title="Priest profile"><ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /></Screen>;
  return (
    <Screen back title={approved ? 'My priest profile' : 'Apply as a priest'} subtitle="Talk to a Priest">
      {mine ? <Notice tint={mine.status === 'approved' ? colors.primary : mine.status === 'pending' ? colors.gold : colors.negative} text={`${STATUS_TEXT[mine.status] || mine.status}${mine.rejectReason ? ` — ${mine.rejectReason}` : ''}`} /> : (
        <Notice text="Only ordained Catholic priests can be listed. The Bible Nestra team checks every application (for example with your parish or diocese) before your profile appears." />
      )}
      {paused ? null : (
        <View>
          {!approved ? (
            <>
              <Field label="Title"><Pills small items={['Rev. Fr.', 'Fr.', 'Msgr.', 'Rev. Dr.']} value={f.title} onChange={set('title')} /></Field>
              <Field label="Full name"><Input value={f.name} onChangeText={set('name')} placeholder="e.g. John Okafor" /></Field>
              <Field label="Parish"><Input value={f.parish} onChangeText={set('parish')} placeholder="e.g. St. Mary’s Parish" /></Field>
              <Field label="Diocese"><Input value={f.diocese} onChangeText={set('diocese')} placeholder="e.g. Archdiocese of Lagos" /></Field>
              <Field label="Country"><Input value={f.country} onChangeText={set('country')} placeholder="e.g. Nigeria" /></Field>
            </>
          ) : null}
          <Field label="Languages (comma separated)"><Input value={f.languages} onChangeText={set('languages')} placeholder="e.g. English, French, Igbo" /></Field>
          <Field label="Short bio"><Input multiline value={f.bio} onChangeText={set('bio')} placeholder="A few words about your ministry" maxLength={1200} /></Field>
          <Field label="Photo link (optional, https://)"><Input value={f.photoUrl} onChangeText={set('photoUrl')} placeholder="Leave empty to use your profile photo" autoCapitalize="none" /></Field>
          <Field label="Availability">
            <Pills small items={['Available', 'Busy', 'Away']} value={(AVAIL[f.availability] ? f.availability.charAt(0).toUpperCase() + f.availability.slice(1) : 'Available')} onChange={(v) => set('availability')(v.toLowerCase())} />
          </Field>
          {!approved ? (
            <>
              <Field label="Reference or documents (seen only by the Bible Nestra team)">
                <Input multiline value={f.referenceNote} onChangeText={set('referenceNote')} placeholder="Year of ordination, your bishop or chancery contact, a link to your parish page or celebret…" maxLength={2000} />
              </Field>
              <Pressable onPress={() => setConfirm((x) => !x)} style={styles.confirm} accessibilityRole="checkbox" accessibilityState={{ checked: confirm }}>
                <View style={[styles.check, confirm && { backgroundColor: colors.primary, borderColor: colors.primary }]}>{confirm ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}</View>
                <Text style={styles.confirmText}>I am an ordained Catholic priest and these details are true.</Text>
              </Pressable>
            </>
          ) : null}
          <Button label={busy ? 'Sending…' : approved ? 'Save changes' : mine ? 'Apply again' : 'Send application'} disabled={busy || (!approved && !confirm)} onPress={submit} style={{ marginTop: 18 }} />
        </View>
      )}
    </Screen>
  );
}

function Field({ label, children }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ---------- Filtered inbox: chats started from "Talk to an Apostle" / "Talk to a Priest" ----------
export function CareInboxScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const focused = useIsFocused();
  const kind = params.kind === 'priest' ? 'priest' : 'apostle';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!api.online) { setData({ items: [] }); return; }
    if (focused === false) return;
    api.request('GET', `/care/inbox?kind=${kind}`).then((r) => { setData(r); setError(null); }).catch((e) => setError(errorMessage(e, 'Couldn’t load your inbox')));
  }, [api.online, kind, focused]);
  const label = kind === 'apostle' ? 'Talk to an Apostle' : 'Talk to a Priest';
  return (
    <Screen back title={kind === 'apostle' ? 'Apostle inbox' : 'Priest inbox'} subtitle={`Only conversations started from “${label}”`}>
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {!data && !error ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : null}
      {data && !data.items.length ? <Empty title="No conversations yet" body={`When someone taps “${label}”, their chat appears here.`} /> : null}
      {data && data.items.map((c, i) => (
        <FadeInUp key={c.conversationId} index={i} distance={8} duration={260}>
          <PressScale onPress={() => nav.push('Chat', { id: c.conversationId, to: c.requester.displayName, userId: c.requester.id })} scaleTo={0.985} style={styles.inboxRow} accessibilityRole="button">
            <SocialAvatar name={c.requester.displayName} uri={c.requester.avatarUrl} size={46} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.name} numberOfLines={1}>{c.requester.displayName}</Text>
                <Tag label={label} tint={kind === 'apostle' ? colors.goldMuted : colors.primary} />
              </View>
              <Text style={[styles.meta, c.unread ? { color: colors.fg, fontWeight: '600' } : null]} numberOfLines={1}>{c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.text || 'Attachment'}` : 'No messages yet'}</Text>
            </View>
            {c.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{c.unread > 99 ? '99+' : c.unread}</Text></View> : null}
          </PressScale>
        </FadeInUp>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  optionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg },
  optionSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  hero: { backgroundColor: '#EEF0F8', borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  heroEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.primary },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 4, letterSpacing: -0.4 },
  heroSub: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.fg, paddingVertical: 0, outlineStyle: 'none' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, marginTop: 12, ...shadow.sm },
  availDot: { position: 'absolute', right: 1, bottom: 1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.surface },
  name: { fontSize: 15.5, fontWeight: '700', color: colors.fg, flexShrink: 1 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  bio: { fontSize: 13.5, lineHeight: 19, color: colors.passage || colors.fg, marginTop: 10 },
  link: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  verifiedText: { fontSize: 10.5, fontWeight: '700', color: '#FFFFFF' },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  applyTitle: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  profile: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 12, ...shadow.sm },
  profileName: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, textAlign: 'center' },
  profileMeta: { fontSize: 13, color: colors.muted, marginTop: 3, textAlign: 'center' },
  profileBio: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 22, color: colors.fg, marginTop: 14, textAlign: 'center' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.muted, marginBottom: 6, letterSpacing: 0.2 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  confirmText: { flex: 1, fontSize: 13.5, color: colors.fg },
  inboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  unread: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.positive || colors.primary, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
});
