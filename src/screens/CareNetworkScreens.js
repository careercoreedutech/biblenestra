import { isDarkScheme } from '../design/palette';
// CHRISTIAN CARE NETWORK (brief 6.7): Talk to a Priest (verified directory → profile → private chat, apply to be listed)
// and Talk to an Apostle (opens the Apostle's inbox directly). Server: backend/src/routes/care.js.
// Styled in the Figma care page: sage feature hero, feature list items and the trust note (src/design/sanctuary.js).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Input, Badge, Tag, Notice, Empty, Pills } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, ScaleIn, Pulse } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';
import { errorMessage } from '../api/client';
import { d, df, Tap } from '../design/sanctuary';
import { DScreen } from '../design/profile/parts';

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
  const sm = summary || {};
  const apostle = sm.apostle || { available: false };
  const talkToApostle = async () => {
    if (!apostle.available || busy) return;
    setBusy(true);
    await openChat('/care/apostle/chat', apostle.name || 'The Apostle');
    setBusy(false);
  };
  return (
    <View style={{ marginTop: 14, gap: 9 }}>
      <FadeInUp index={1} distance={10}>
        <Tap onPress={() => nav.push('Priests')} style={s.item} accessibilityRole="button" accessibilityLabel="Talk to a Priest">
          <View style={s.itemIcon}><Icon name="church" size={17} color={d.plum} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.itemTitle}>Talk to a Priest</Text>
            <Text style={s.itemSub}>Verified Catholic priests · private conversation</Text>
          </View>
          <Icon name="chevron-right" size={15} color="#AAA6AD" />
        </Tap>
      </FadeInUp>
      <FadeInUp index={2} distance={10}>
        <Tap onPress={talkToApostle} disabled={!apostle.available} style={[s.item, !apostle.available && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel="Talk to an Apostle">
          <Pulse min={0.95} max={1.05} duration={2000} active={!!apostle.available}>
            {apostle.available && apostle.avatarUrl ? <SocialAvatar name={apostle.displayName} uri={apostle.avatarUrl} size={44} ring /> : (
              <View style={s.itemIcon}><Icon name="sparkles" size={17} color={d.plum} /></View>
            )}
          </Pulse>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.itemTitle}>Talk to an Apostle</Text>
            <Text style={s.itemSub} numberOfLines={2}>
              {apostle.available ? `Message ${apostle.name || 'the Apostle'} directly — personal and private` : sm.offline ? OFFLINE : 'Coming soon'}
            </Text>
          </View>
          {busy ? <ActivityIndicator color={d.plum} /> : apostle.available ? <Icon name="chat" size={16} color={d.plum} /> : <Tag label="Soon" />}
        </Tap>
      </FadeInUp>
      {sm.isApostle ? (
        <FadeInUp index={3} distance={10}>
          <Button kind="ghost" label={`Apostle inbox${sm.inbox && sm.inbox.apostle ? ` (${sm.inbox.apostle})` : ''}`} icon={<Icon name="chat" size={14} color={colors.fg} />} onPress={() => nav.push('CareInbox', { kind: 'apostle' })} />
        </FadeInUp>
      ) : null}
      {sm.priest && sm.priest.status === 'approved' ? (
        <FadeInUp index={3} distance={10}>
          <Button kind="ghost" label={`My “Talk to a Priest” chats${sm.inbox && sm.inbox.priest ? ` (${sm.inbox.priest})` : ''}`} icon={<Icon name="chat" size={14} color={colors.fg} />} onPress={() => nav.push('CareInbox', { kind: 'priest' })} />
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
      <Tap onPress={onPress} style={styles.card} accessibilityRole="button" accessibilityLabel={`${p.displayName}, ${p.parish || p.diocese}, ${p.country}`}>
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
      </Tap>
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
    <DScreen back onBack={() => nav.pop()} title="Talk to a Priest" subtitle="Verified Catholic priests">
      {/* .feature-hero.sage */}
      <FadeInUp style={styles.hero}>
        <Text style={styles.heroEyebrow}>✦  Christian Care Network</Text>
        <Text style={styles.heroTitle}>A priest who will listen</Text>
        <Text style={styles.heroSub}>Every priest here was verified by the Bible Nestra team. Conversations are private between you and the priest.</Text>
      </FadeInUp>
      {!api.online ? <Notice text={OFFLINE} /> : null}
      <View style={styles.search}>
        <Icon name="search" size={16} color={d.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search by name, parish or diocese" placeholderTextColor={d.muted} style={styles.searchInput} autoCorrect={false} />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={10}><Icon name="x" size={14} color={d.muted} /></Pressable> : null}
      </View>
      {facets.countries.length > 1 ? <Pills small items={['All countries', ...facets.countries]} value={country} onChange={setCountry} style={{ marginTop: 10 }} /> : null}
      {facets.languages.length > 1 ? <Pills small items={['All languages', ...facets.languages]} value={language} onChange={setLanguage} style={{ marginTop: 8 }} /> : null}
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {data === null ? <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /> : null}
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
        <Tap onPress={() => nav.push('PriestApply')} style={styles.applyRow} accessibilityRole="button">
          <View style={styles.itemIcon}><Icon name="church" size={17} color={d.plum} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.applyTitle}>{mine ? 'My priest profile' : 'Are you a Catholic priest?'}</Text>
            <Text style={styles.meta}>{mine ? STATUS_TEXT[mine.status] || mine.status : 'Apply to be listed — we verify every profile'}</Text>
          </View>
          <Icon name="chevron-right" size={15} color="#AAA6AD" />
        </Tap>
      </FadeInUp>
      {/* .trust-note */}
      <View style={styles.trust}>
        <Icon name="shield" size={20} color={d.plum} />
        <Text style={styles.trustText}>
          <Text style={styles.trustStrong}>Trust is sacred here.</Text>
          {'\n'}Every experience includes verification, reporting, and privacy controls.
        </Text>
      </View>
    </DScreen>
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
      <DScreen back onBack={() => nav.pop()} title="Priest">
        {error ? <Empty title="Not available" body={error} action="Back to the directory" onAction={() => nav.pop()} /> : <ActivityIndicator color={d.plum} style={{ marginTop: 40 }} />}
      </DScreen>
    );
  }
  const av = AVAIL[p.availability] || AVAIL.available;
  const message = async () => { setBusy(true); await openChat(`/care/priests/${p.id}/message`, p.displayName); setBusy(false); };
  return (
    <DScreen back onBack={() => nav.pop()} title={p.displayName} subtitle="Talk to a Priest">
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
    </DScreen>
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
  if (mine === undefined) return <DScreen back onBack={() => nav.pop()} title="Priest profile"><ActivityIndicator color={d.plum} style={{ marginTop: 40 }} /></DScreen>;
  return (
    <DScreen back onBack={() => nav.pop()} title={approved ? 'My priest profile' : 'Apply as a priest'} subtitle="Talk to a Priest">
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
                <View style={[styles.check, confirm && { backgroundColor: colors.primary, borderColor: colors.primary }]}>{confirm ? <Icon name="check" size={12} color="#FFFAF2" strokeWidth={3} /> : null}</View>
                <Text style={styles.confirmText}>I am an ordained Catholic priest and these details are true.</Text>
              </Pressable>
            </>
          ) : null}
          <Button label={busy ? 'Sending…' : approved ? 'Save changes' : mine ? 'Apply again' : 'Send application'} disabled={busy || (!approved && !confirm)} onPress={submit} style={{ marginTop: 18 }} />
        </View>
      )}
    </DScreen>
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
    <DScreen back onBack={() => nav.pop()} title={kind === 'apostle' ? 'Apostle inbox' : 'Priest inbox'} subtitle={`Only conversations started from “${label}”`}>
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {!data && !error ? <ActivityIndicator color={d.plum} style={{ marginTop: 30 }} /> : null}
      {data && !data.items.length ? <Empty title="No conversations yet" body={`When someone taps “${label}”, their chat appears here.`} /> : null}
      {data && data.items.map((c, i) => (
        <FadeInUp key={c.conversationId} index={i} distance={8} duration={260}>
          <Tap onPress={() => nav.push('Chat', { id: c.conversationId, to: c.requester.displayName, userId: c.requester.id })} style={styles.inboxRow} accessibilityRole="button">
            <SocialAvatar name={c.requester.displayName} uri={c.requester.avatarUrl} size={46} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.name} numberOfLines={1}>{c.requester.displayName}</Text>
                <Tag label={label} tint={kind === 'apostle' ? colors.goldMuted : colors.primary} />
              </View>
              <Text style={[styles.meta, c.unread ? { color: d.ink, fontFamily: df.sansBold } : null]} numberOfLines={1}>{c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.text || 'Attachment'}` : 'No messages yet'}</Text>
            </View>
            {c.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{c.unread > 99 ? '99+' : c.unread}</Text></View> : null}
          </Tap>
        </FadeInUp>
      ))}
    </DScreen>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 70, padding: 12, borderRadius: 17, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  itemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: d.lavender },
  itemTitle: { fontFamily: df.display, fontSize: 13, color: d.ink },
  itemSub: { fontFamily: df.sans, fontSize: 9, color: d.muted, marginTop: 3 },
});

const styles = StyleSheet.create({
  itemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: d.lavender },
  hero: { backgroundColor: d.sage, borderRadius: 28, padding: 25, marginTop: 8, marginBottom: 12 },
  heroEyebrow: { fontFamily: df.sansHeavy, fontSize: 8, letterSpacing: 1.4, textTransform: 'uppercase', color: d.sageDark },
  heroTitle: { fontFamily: df.display, fontSize: 31, lineHeight: 34, color: d.sageDark, marginTop: 11 },
  heroSub: { fontFamily: df.sans, fontSize: 11, lineHeight: 17, color: d.sageDark, opacity: 0.85, marginTop: 6, maxWidth: 310 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 15, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  searchInput: { flex: 1, fontSize: 12, fontFamily: df.sans, color: d.ink, paddingVertical: 0, outlineStyle: 'none' },
  card: { backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20, padding: 14, marginTop: 12 },
  availDot: { position: 'absolute', right: 1, bottom: 1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: d.paper },
  name: { fontFamily: df.display, fontSize: 15, color: d.ink, flexShrink: 1 },
  meta: { fontFamily: df.sans, fontSize: 10, color: d.muted, marginTop: 2 },
  bio: { fontFamily: df.sans, fontSize: 11, lineHeight: 17, color: d.ink, marginTop: 10 },
  link: { fontFamily: df.sansBold, fontSize: 10, color: d.plum },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: d.plum, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  verifiedText: { fontSize: 10, fontFamily: df.sansBold, color: '#FFFFFF' },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 70, padding: 12, borderRadius: 17, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  applyTitle: { fontFamily: df.display, fontSize: 13, color: d.ink },
  trust: { flexDirection: 'row', gap: 11, marginTop: 20, padding: 15, borderRadius: 16, backgroundColor: (isDarkScheme() ? '#1a1a1a' : '#f4f4f4') },
  trustText: { flex: 1, fontFamily: df.sans, fontSize: 10, lineHeight: 15, color: d.muted },
  trustStrong: { color: d.ink, fontFamily: df.sansBold },
  profile: { alignItems: 'center', backgroundColor: d.paper, borderRadius: 22, borderWidth: 1, borderColor: d.line, padding: 20, marginTop: 8, marginBottom: 12 },
  profileName: { fontFamily: df.displayBold, fontSize: 22, color: d.ink, textAlign: 'center' },
  profileMeta: { fontFamily: df.sans, fontSize: 11, color: d.muted, marginTop: 3, textAlign: 'center' },
  profileBio: { fontFamily: df.displayItalic, fontSize: 15, lineHeight: 22, color: d.ink, marginTop: 14, textAlign: 'center' },
  fieldLabel: { fontFamily: df.sansBold, fontSize: 10, color: (isDarkScheme() ? '#cccccc' : '#333333'), marginBottom: 8 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  confirmText: { flex: 1, fontFamily: df.sans, fontSize: 11, color: d.ink },
  inboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: d.line },
  unread: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontSize: 10, fontFamily: df.sansBold, color: '#FFFFFF' },
});
