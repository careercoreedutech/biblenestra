// MEMBERSHIP GROUPS — MASTER CLASS + EXECUTIVE CLASS: the welcome pop-up and the group's own screens.
//   WelcomeModal / MembershipWelcomeGate  once per member per group (seen is stored on the server, so once across devices)
//   MembershipMediaScreen                 Videos · Images · Audio · Documents · Files from both sections
//   MembershipMembersScreen               members (search), join requests, banned; mute / remove / ban / make admin
//   MembershipAdminsScreen                the owner's admins and their permissions (one set, both sections)
//   MembershipSettingsScreen              my notifications, invite link, group profile, joining and chat rules, welcome text
// Server: backend/src/routes/membershipGroups.js (every rule is enforced there too).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen, Button, Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { AnimatedModal, FadeInUp, PressScale, ScaleIn } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { pickPhotos, uploadImage } from '../api/media';
import { ChatImage, ChatMediaViewer, FileBubble, AudioBubble, isPdf } from '../chat/ChatExtras';
import { downloadChatFile } from '../api/chatMedia';
import {
  MASTER, EXECUTIVE, MUTE_CHOICES, addGroupAdmin, decideJoinRequest, friendly, getGroup, getGroupAdmins, getGroupInvite, getGroupMembers,
  getJoinRequests, getPendingWelcome, markWelcomeSeen, memberAction, membershipsChanged, mutedLabel, removeGroupAdmin, setAdminPermissions,
  setGroupNotifications, updateGroup,
} from '../api/memberships';

// ---------------------------------------------------------------------------------------------------------------
// Welcome pop-up
// ---------------------------------------------------------------------------------------------------------------
export function WelcomeModal({ visible, title, text, onMaster, onExecutive, onClose }) {
  return (
    <AnimatedModal visible={!!visible} onRequestClose={onClose}>
      <View style={s.welcomeWrap}>
        <ScaleIn style={s.welcomeCard}>
          <View style={s.welcomeIcon}><Text style={{ fontSize: 30 }}>🎉</Text></View>
          <Text style={s.welcomeEyebrow}>Welcome to the group</Text>
          <Text style={s.welcomeTitle} numberOfLines={2}>{title}</Text>
          <ScrollView style={{ maxHeight: 300, alignSelf: 'stretch' }} contentContainerStyle={{ paddingVertical: 4 }}>
            <Text style={s.welcomeText}>{text}</Text>
          </ScrollView>
          <PressScale onPress={onMaster} scaleTo={0.98} style={s.welcomeBtn} accessibilityRole="button" accessibilityLabel={`Open ${MASTER}`}>
            <Icon name="volume" size={16} color="#FFFFFF" />
            <Text style={s.welcomeBtnText}>Open {MASTER}</Text>
          </PressScale>
          <PressScale onPress={onExecutive} scaleTo={0.98} style={[s.welcomeBtn, s.welcomeBtnGhost]} accessibilityRole="button" accessibilityLabel={`Join the ${EXECUTIVE}`}>
            <Icon name="chat" size={16} color={colors.primary} />
            <Text style={[s.welcomeBtnText, { color: colors.primary }]}>Join the {EXECUTIVE}</Text>
          </PressScale>
          <Pressable onPress={onClose} hitSlop={10} style={{ marginTop: 10 }} accessibilityRole="button"><Text style={s.link}>Maybe later</Text></Pressable>
        </ScaleIn>
      </View>
    </AnimatedModal>
  );
}

/** App-wide: the first time someone opens the app after joining a group, its welcome pop-up shows once. */
export function MembershipWelcomeGate() {
  const api = useApi();
  const nav = useNav();
  const [w, setW] = useState(null);
  useEffect(() => {
    if (!api.online) return undefined;
    let alive = true;
    const t = setTimeout(() => getPendingWelcome(api).then((r) => { if (alive && r && r.pending) setW(r.pending); }).catch(() => {}), 2500);
    return () => { alive = false; clearTimeout(t); };
  }, [api.online]);
  // the group's own home shows it instead when it is the screen on top
  const top = nav.stack[nav.stack.length - 1];
  const inGroup = !!(w && top && top.name === 'MembershipHome' && top.params && top.params.id === w.membershipId);
  const done = (tab) => {
    const cur = w;
    setW(null);
    if (!cur) return;
    markWelcomeSeen(api, cur.membershipId).catch(() => {});
    if (tab) nav.push('MembershipHome', { id: cur.membershipId, title: cur.title, tab, welcomeShown: true }); // the group home must not show it a second time
  };
  return <WelcomeModal visible={!!w && !inGroup} title={w && w.title} text={w && w.text} onMaster={() => done('master')} onExecutive={() => done('executive')} onClose={() => done(null)} />;
}

// ---------------------------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------------------------
function useGroup(id) {
  const api = useApi();
  const [g, setG] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => getGroup(api, id).then((d) => { setG(d); setErr(null); return d; }).catch((e) => { setErr(e); }), [id]);
  useEffect(() => { load(); }, [load]);
  return { g, err, load, setG, api };
}

function Choice({ options, value, onChange, disabled }) {
  return (
    <View style={s.choice} accessibilityRole="radiogroup">
      {options.map(([id, label]) => {
        const on = value === id;
        return (
          <Pressable key={id} disabled={disabled} onPress={() => !on && onChange(id)} style={[s.choiceBtn, on && s.choiceOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[s.choiceText, on && s.choiceTextOn]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Card({ title, sub, children }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {sub ? <Text style={s.cardSub}>{sub}</Text> : null}
      {children}
    </View>
  );
}

function SettingRow({ label, hint, children }) {
  return (
    <View style={s.settingRow}>
      <Text style={s.settingLabel}>{label}</Text>
      {hint ? <Text style={s.settingHint}>{hint}</Text> : null}
      <View style={{ marginTop: 8 }}>{children}</View>
    </View>
  );
}

const roleTint = { owner: colors.gold, admin: colors.primary, member: colors.muted, banned: colors.negative };
function RoleTag({ role }) {
  if (!role || role === 'member') return null;
  return <View style={[s.roleTag, { backgroundColor: role === 'owner' ? colors.cardGold : role === 'banned' ? colors.negativeFaint : colors.primarySoft }]}><Text style={[s.roleText, { color: roleTint[role] }]}>{role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Banned'}</Text></View>;
}

function PersonRow({ u, sub, right, onPress }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.person, pressed && { backgroundColor: colors.raised }]} accessibilityRole={onPress ? 'button' : undefined}>
      <SocialAvatar name={u.displayName || 'Member'} uri={u.avatarUrl} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.personName} numberOfLines={1}>{u.displayName || 'Member'}</Text>
          <RoleTag role={u.role} />
        </View>
        {sub ? <Text style={s.personSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

function ActionSheet({ visible, title, items, onClose }) {
  return (
    <AnimatedModal visible={!!visible} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={s.sheet}>
          <View style={s.grabber} />
          {title ? <Text style={s.sheetTitle} numberOfLines={1}>{title}</Text> : null}
          {(items || []).map((it) => (
            <Pressable key={it.label} onPress={() => { onClose(); it.onPress(); }} style={({ pressed }) => [s.sheetRow, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button">
              <Icon name={it.icon || 'chevron-right'} size={17} color={it.danger ? colors.negative : colors.fg} />
              <Text style={[s.sheetRowText, it.danger && { color: colors.negative }]}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </AnimatedModal>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Media: one screen for both sections
// ---------------------------------------------------------------------------------------------------------------
const MEDIA_TABS = [['videos', 'Videos'], ['photos', 'Images'], ['audio', 'Audio'], ['docs', 'Documents'], ['files', 'Files']];

export function MembershipMediaScreen({ params = {} }) {
  const api = useApi();
  const [tab, setTab] = useState(params.tab || 'videos');
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [viewer, setViewer] = useState(null);
  const convs = useMemo(() => [[params.masterId, MASTER], [params.executiveId, EXECUTIVE]].filter(([id]) => !!id), [params.masterId, params.executiveId]);
  useEffect(() => {
    let alive = true;
    setItems(null); setErr(null);
    Promise.all(convs.map(([id, section]) => api.request('GET', `/conversations/${id}/media?type=${tab}`).then((r) => (r.items || []).map((x) => ({ ...x, section })))))
      .then((lists) => { if (alive) setItems(lists.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))); })
      .catch((e) => { if (alive) setErr(e); });
    return () => { alive = false; };
  }, [tab, convs]);
  const empty = { videos: 'No videos yet', photos: 'No images yet', audio: 'No audio yet', docs: 'No documents yet', files: 'No files yet' }[tab];
  return (
    <Screen back title="Media" subtitle={params.title} scroll={false} padded={false}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {MEDIA_TABS.map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id)} style={[s.chip, tab === id && s.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
              <Text style={[s.chipText, tab === id && s.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 40 }}>
        {err ? <Empty title="Couldn’t load media" body={friendly(err)} /> : null}
        {!items && !err ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : null}
        {items && !items.length ? <Empty title={empty} body={`Photos, videos, audio and files shared in ${MASTER} and ${EXECUTIVE} appear here.`} /> : null}
        {items && tab === 'photos' ? (
          <View style={s.grid}>
            {items.map((x) => (
              <View key={x.messageId} style={s.gridCell}>
                <ChatImage image={{ key: x.mediaKey, width: 1, height: 1 }} request={api.request} onOpen={() => setViewer({ kind: 'image', key: x.mediaKey, name: 'Photo' })} />
              </View>
            ))}
          </View>
        ) : null}
        {items && tab !== 'photos' ? items.map((x, i) => (
          <FadeInUp key={x.messageId} index={i} distance={6} stagger={25}>
            <View style={s.mediaRow}>
              {tab === 'audio' ? (
                <AudioBubble voice={{ key: x.mediaKey, durationMs: (x.meta && x.meta.durationMs) || 0, name: (x.meta && x.meta.name) || null, isFile: !!(x.meta && x.meta.file), waveform: x.meta && Array.isArray(x.meta.waveform) ? x.meta.waveform : null }} request={api.request} />
              ) : (
                <FileBubble
                  file={{ key: x.mediaKey, name: (x.meta && x.meta.name) || (tab === 'videos' ? 'Video' : 'File'), mime: (x.meta && x.meta.mime) || '', size: (x.meta && x.meta.size) || 0 }}
                  onOpen={() => setViewer({ kind: tab === 'videos' ? 'video' : isPdf({ name: (x.meta && x.meta.name) || '', mime: (x.meta && x.meta.mime) || '' }) ? 'pdf' : 'file', key: x.mediaKey, name: (x.meta && x.meta.name) || 'File', mime: x.meta && x.meta.mime })}
                  onDownload={tab === 'videos' ? undefined : () => downloadChatFile(api.request, x.mediaKey, (x.meta && x.meta.name) || 'file').catch(() => {})}
                />
              )}
              <Text style={s.mediaMeta}>{x.section} · {x.senderName} · {new Date(x.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
            </View>
          </FadeInUp>
        )) : null}
      </ScrollView>
      <ChatMediaViewer item={viewer} request={api.request} onClose={() => setViewer(null)} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Members, join requests, banned
// ---------------------------------------------------------------------------------------------------------------
export function MembershipMembersScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { g, api, load: loadGroup } = useGroup(params.id);
  const [tab, setTab] = useState(params.tab || 'members');
  const [term, setTerm] = useState('');
  const [list, setList] = useState(null);
  const [sheet, setSheet] = useState(null);
  const manage = !!(g && g.me.permissions.manageMembers);
  const isOwner = !!(g && g.me.role === 'owner');
  const load = useCallback(() => {
    setList(null);
    const p = tab === 'requests' ? getJoinRequests(api, params.id) : getGroupMembers(api, params.id, { q: term.trim(), filter: tab === 'banned' ? 'banned' : 'all' });
    return p.then((r) => setList(r.items || [])).catch((e) => { setList([]); toast.show(friendly(e), { tone: 'error' }); });
  }, [tab, term, params.id]);
  useEffect(() => { const t = setTimeout(load, term ? 300 : 0); return () => clearTimeout(t); }, [load]);

  const act = async (u, action, extra, done) => {
    try {
      await memberAction(api, params.id, u.id, action, extra);
      toast.show(done, { icon: 'check' });
      load(); loadGroup();
    } catch (e) { toast.show(friendly(e), { tone: 'error' }); }
  };
  const menuFor = (u) => {
    if (!manage || u.role === 'owner' || u.isMe) return [];
    const items = [];
    if (u.role !== 'admin' && isOwner) items.push({ label: 'Make admin', icon: 'shield', onPress: async () => { try { await addGroupAdmin(api, params.id, u.id); toast.show(`${u.displayName} is now an admin`, { icon: 'shield' }); load(); } catch (e) { toast.show(friendly(e), { tone: 'error' }); } } });
    if (u.role === 'admin' && !isOwner) return [];
    if (u.mutedUntil) items.push({ label: `Unmute in ${EXECUTIVE}`, icon: 'volume', onPress: () => act(u, 'unmute', {}, `${u.displayName} can send messages again`) });
    else MUTE_CHOICES.forEach((c) => items.push({ label: `Mute in ${EXECUTIVE} for ${c.label}`, icon: 'clock', onPress: () => act(u, 'mute', { minutes: c.minutes }, `${u.displayName} muted for ${c.label}`) }));
    items.push({ label: 'Remove from group', icon: 'x', danger: true, onPress: () => act(u, 'remove', {}, `${u.displayName} was removed`) });
    items.push({ label: 'Ban from group', icon: 'shield', danger: true, onPress: () => act(u, 'ban', {}, `${u.displayName} was banned`) });
    return items;
  };
  const tabs = [['members', `Members${g ? ` · ${g.counts.members}` : ''}`], ...(manage ? [['requests', `Requests${g && g.counts.pendingRequests ? ` · ${g.counts.pendingRequests}` : ''}`], ['banned', 'Banned']] : [])];
  return (
    <Screen back title="Members" subtitle={params.title} scroll={false} padded={false}
      right={isOwner ? <Pressable onPress={() => nav.push('MembershipAdmins', { id: params.id, title: params.title })} hitSlop={10} accessibilityLabel="Admins and permissions"><Icon name="shield" size={19} color={colors.fg} /></Pressable> : null}>
      <View style={{ paddingHorizontal: 14, paddingTop: 10, gap: 10 }}>
        {tabs.length > 1 ? <Choice options={tabs} value={tab} onChange={(t) => { setTab(t); setTerm(''); }} /> : null}
        {tab !== 'requests' ? (
          <View style={s.search}>
            <Icon name="search" size={15} color={colors.muted} />
            <TextInput value={term} onChangeText={setTerm} placeholder="Search by name or @handle" placeholderTextColor={colors.faint} style={s.searchInput} accessibilityLabel="Search members" />
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {!list ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : null}
        {list && !list.length ? <Empty title={tab === 'requests' ? 'No requests' : tab === 'banned' ? 'Nobody is banned' : 'No one found'} body={tab === 'requests' ? 'When the group needs approval, people who ask to join show up here.' : null} /> : null}
        <View style={s.listCard}>
          {(list || []).map((u) => (tab === 'requests' ? (
            <PersonRow key={u.id} u={u} sub={`Asked ${new Date(u.requestedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
              right={(
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Button small kind="ghost" label="Decline" onPress={async () => { try { await decideJoinRequest(api, params.id, u.id, false); load(); loadGroup(); } catch (e) { toast.show(friendly(e), { tone: 'error' }); } }} />
                  <Button small label="Approve" onPress={async () => { try { const r = await decideJoinRequest(api, params.id, u.id, true); toast.show(r.joined ? `${u.displayName} joined` : `${u.displayName} can now complete their membership`, { icon: 'check' }); load(); loadGroup(); } catch (e) { toast.show(friendly(e), { tone: 'error' }); } }} />
                </View>
              )} />
          ) : tab === 'banned' ? (
            <PersonRow key={u.id} u={u} sub="Can’t rejoin until unbanned" right={<Button small kind="ghost" label="Unban" onPress={() => act(u, 'unban', {}, `${u.displayName} was unbanned`)} />} />
          ) : (
            <PersonRow key={u.id} u={u}
              sub={[u.handle ? `@${u.handle}` : null, u.mutedUntil ? mutedLabel(u.mutedUntil) : null].filter(Boolean).join(' · ') || null}
              onPress={menuFor(u).length ? () => setSheet(u) : undefined}
              right={menuFor(u).length ? <Icon name="more" size={18} color={colors.muted} /> : null} />
          )))}
        </View>
      </ScrollView>
      <ActionSheet visible={!!sheet} title={sheet && sheet.displayName} items={sheet ? menuFor(sheet) : []} onClose={() => setSheet(null)} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Admins & permissions (owner)
// ---------------------------------------------------------------------------------------------------------------
export function MembershipAdminsScreen({ params = {} }) {
  const toast = useToast();
  const api = useApi();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState([]);
  const load = useCallback(() => getGroupAdmins(api, params.id).then(setData).catch((e) => toast.show(friendly(e), { tone: 'error' })), [params.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!adding || term.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => api.request('GET', `/people?q=${encodeURIComponent(term.trim())}`).then((r) => setFound((r.items || []).slice(0, 8))).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [term, adding]);
  const toggle = async (a, perm, v) => {
    const next = { ...a.permissions, [perm]: v };
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === a.id ? { ...x, permissions: next } : x)) }));
    try { await setAdminPermissions(api, params.id, a.id, { [perm]: v }); } catch (e) { toast.show(friendly(e), { tone: 'error' }); load(); }
  };
  return (
    <Screen back title="Admins" subtitle={params.title}>
      <Text style={s.lead}>Admins help you run both {MASTER} and {EXECUTIVE}. Choose what each one can do. Only you can add or remove admins, and nobody can remove you.</Text>
      {!data ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : (
        <>
          {data.owner ? <View style={s.listCard}><PersonRow u={data.owner} sub="Full control" /></View> : null}
          {data.items.map((a) => (
            <View key={a.id} style={s.card}>
              <PersonRow u={a} right={<Pressable onPress={async () => { try { await removeGroupAdmin(api, params.id, a.id); toast.show(`${a.displayName} is no longer an admin`, { icon: 'check' }); load(); } catch (e) { toast.show(friendly(e), { tone: 'error' }); } }} hitSlop={8} accessibilityRole="button"><Text style={[s.link, { color: colors.negative }]}>Remove</Text></Pressable>} />
              {data.permissions.map((p) => (
                <View key={p.id} style={s.permRow}>
                  <Text style={s.permLabel}>{p.label}</Text>
                  <Switch value={!!a.permissions[p.id]} onValueChange={(v) => toggle(a, p.id, v)} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor="#FFFFFF" accessibilityLabel={`${a.displayName}: ${p.label}`} />
                </View>
              ))}
            </View>
          ))}
          {!data.items.length ? <Notice text="No admins yet. Add someone you trust to help post lessons and look after the discussion." /> : null}
          {adding ? (
            <Card title="Add an admin" sub="Search by name or @handle. They join both sections as an admin.">
              <View style={[s.search, { marginTop: 10 }]}>
                <Icon name="search" size={15} color={colors.muted} />
                <TextInput autoFocus value={term} onChangeText={setTerm} placeholder="Search people" placeholderTextColor={colors.faint} style={s.searchInput} accessibilityLabel="Search people to add as admin" />
              </View>
              {found.map((u) => (
                <PersonRow key={u.id} u={u} sub={u.handle ? `@${u.handle}` : u.church || null}
                  right={<Button small label="Add" onPress={async () => { try { await addGroupAdmin(api, params.id, u.id); toast.show(`${u.displayName} is now an admin`, { icon: 'shield' }); setAdding(false); setTerm(''); load(); } catch (e) { toast.show(friendly(e), { tone: 'error' }); } }} />} />
              ))}
            </Card>
          ) : <Button label="Add an admin" icon={<Icon name="plus" size={15} color="#FFFFFF" />} onPress={() => setAdding(true)} style={{ marginTop: 12 }} />}
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Settings (everyone sees their own notifications; owner / admins with the permission see the rest)
// ---------------------------------------------------------------------------------------------------------------
export function MembershipSettingsScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { g, err, setG, api } = useGroup(params.id);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [welcome, setWelcome] = useState('');
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!g) return;
    setName(g.title); setDesc(g.description || '');
    if (g.defaultWelcome) setWelcome(g.welcomeMessage || g.defaultWelcome);
  }, [g && g.id]);
  if (err) return <Screen back title="Settings"><Empty title="Couldn’t open settings" body={friendly(err)} /></Screen>;
  if (!g) return <Screen back title="Settings"><ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /></Screen>;
  const p = g.me.permissions;
  const canSettings = !!p.manageSettings;
  const save = async (body, msg) => {
    setBusy(true);
    try { const next = await updateGroup(api, params.id, body); setG(next); membershipsChanged(); if (msg) toast.show(msg, { icon: 'check' }); } catch (e) { toast.show(friendly(e), { tone: 'error' }); }
    setBusy(false);
  };
  const setNotif = async (body) => {
    const next = { ...g.me.notifications, ...body };
    setG({ ...g, me: { ...g.me, notifications: next } });
    try { await setGroupNotifications(api, params.id, next); } catch (e) { toast.show(friendly(e), { tone: 'error' }); }
  };
  const setting = (k, v) => save({ settings: { [k]: v } });
  const loadInvite = async (reset) => {
    try { setInvite(await getGroupInvite(api, params.id, reset)); if (reset) toast.show('New invite link made · the old one stops working', { icon: 'link' }); } catch (e) { toast.show(friendly(e), { tone: 'error' }); }
  };
  const changePhoto = async () => {
    try {
      const [photo] = await pickPhotos(1);
      if (!photo) return;
      const up = await uploadImage(api.request, photo);
      await save({ avatarKey: up.key }, 'Group photo updated');
    } catch (e) { toast.show(friendly(e, 'Couldn’t change the photo'), { tone: 'error' }); }
  };
  return (
    <Screen back title={canSettings ? 'Group settings' : 'Notifications'} subtitle={g.title}>
      <Card title="My notifications" sub="Only for you, on all your devices.">
        <View style={s.permRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.permLabel}>New {MASTER} posts</Text>
            <Text style={s.settingHint}>Lessons, videos and materials from the teacher</Text>
          </View>
          <Switch value={!!g.me.notifications.master} onValueChange={(v) => setNotif({ master: v })} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor="#FFFFFF" accessibilityLabel={`Notify me about new ${MASTER} posts`} />
        </View>
        <SettingRow label={`${EXECUTIVE} messages`}>
          <Choice options={[['all', 'All'], ['mentions', 'Mentions only'], ['off', 'Off']]} value={g.me.notifications.executive} onChange={(v) => setNotif({ executive: v })} />
        </SettingRow>
      </Card>

      {p.inviteMembers ? (
        <Card title="Invite people" sub={g.free ? 'Anyone with the link can join this free group.' : 'The link opens the membership page, where people choose a plan to join.'}>
          {invite ? (
            <>
              <Text style={s.inviteUrl} selectable>{invite.url}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button small label="Copy link" onPress={async () => { try { await Clipboard.setStringAsync(invite.url); toast.show('Link copied', { icon: 'check' }); } catch (e) { /* ignore */ } }} />
                <Button small kind="ghost" label="Share" onPress={() => Share.share({ message: `Join ${g.title} on BibleNestra: ${invite.url}` }).catch(() => {})} />
                {g.me.role !== 'member' ? <Button small kind="ghost" label="Reset link" onPress={() => loadInvite(true)} /> : null}
              </View>
            </>
          ) : <Button small label="Get invite link" icon={<Icon name="link" size={14} color="#FFFFFF" />} onPress={() => loadInvite(false)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
        </Card>
      ) : null}

      {canSettings ? (
        <>
          <Card title="Group profile">
            <Pressable onPress={changePhoto} style={s.photoRow} accessibilityRole="button" accessibilityLabel="Change group photo">
              <SocialAvatar name={g.title} uri={g.avatarUrl} size={56} />
              <Text style={s.link}>Change group photo</Text>
            </Pressable>
            <Text style={s.fieldLabel}>Name</Text>
            <TextInput value={name} onChangeText={setName} maxLength={120} style={s.input} accessibilityLabel="Group name" />
            <Text style={s.fieldLabel}>Description</Text>
            <TextInput value={desc} onChangeText={setDesc} multiline maxLength={6000} style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} accessibilityLabel="Group description" />
            <Button label="Save profile" disabled={busy || !name.trim()} onPress={() => save({ title: name.trim(), description: desc }, 'Saved')} style={{ marginTop: 12 }} />
          </Card>

          <Card title="Who can join and talk">
            <SettingRow label="Group visibility" hint="Private groups don’t show in Discover. People join with the invite link.">
              <Choice options={[['public', 'Public'], ['private', 'Private']]} value={g.settings.visibility} onChange={(v) => setting('visibility', v)} disabled={busy} />
            </SettingRow>
            <SettingRow label="Joining" hint={g.free ? 'With approval, an admin lets each new member in.' : 'With approval, an admin approves people before they can pay and join.'}>
              <Choice options={[['open', 'Open'], ['approval', 'Needs approval']]} value={g.settings.joinMode} onChange={(v) => setting('joinMode', v)} disabled={busy} />
            </SettingRow>
            <SettingRow label={`Who can send messages in ${EXECUTIVE}`}>
              <Choice options={[['all', 'All members'], ['admins', 'Admins only']]} value={g.settings.memberMessaging} onChange={(v) => setting('memberMessaging', v)} disabled={busy} />
            </SettingRow>
            <SettingRow label={`Who can share photos, videos and files in ${EXECUTIVE}`}>
              <Choice options={[['all', 'All members'], ['admins', 'Admins only']]} value={g.settings.mediaUploads} onChange={(v) => setting('mediaUploads', v)} disabled={busy} />
            </SettingRow>
            <SettingRow label="Who can invite people">
              <Choice options={[['admins', 'Admins'], ['all', 'All members']]} value={g.settings.memberInvites} onChange={(v) => setting('memberInvites', v)} disabled={busy} />
            </SettingRow>
            <SettingRow label="Message history for new members">
              <Choice options={[['all', 'See everything'], ['since_join', 'From when they join']]} value={g.settings.history} onChange={(v) => setting('history', v)} disabled={busy} />
            </SettingRow>
            <Text style={[s.settingHint, { marginTop: 10 }]}>Only the owner and admins who can publish post in {MASTER}. Members always comment in {EXECUTIVE}.</Text>
          </Card>

          <Card title="Welcome message" sub={'Shown once to each new member. {group} becomes the group name.'}>
            <TextInput value={welcome} onChangeText={setWelcome} multiline maxLength={2000} style={[s.input, { minHeight: 160, textAlignVertical: 'top', marginTop: 10 }]} accessibilityLabel="Welcome message" />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Button small label="Save message" disabled={busy || !welcome.trim()} onPress={() => save({ welcomeMessage: welcome }, 'Welcome message saved')} />
              <Button small kind="ghost" label="Use default" onPress={() => { setWelcome(g.defaultWelcome); save({ welcomeMessage: '' }, 'Back to the default message'); }} />
            </View>
          </Card>
        </>
      ) : null}

      {g.me.role !== 'member' ? (
        <Card>
          <Pressable onPress={() => nav.push('MembershipMembers', { id: params.id, title: g.title })} style={s.linkRow} accessibilityRole="button">
            <Icon name="users" size={17} color={colors.primary} /><Text style={s.linkRowText}>Members{g.counts.pendingRequests ? ` · ${g.counts.pendingRequests} waiting` : ''}</Text><Icon name="chevron-right" size={16} color={colors.faint} />
          </Pressable>
          {g.me.role === 'owner' ? (
            <Pressable onPress={() => nav.push('MembershipAdmins', { id: params.id, title: g.title })} style={s.linkRow} accessibilityRole="button">
              <Icon name="shield" size={17} color={colors.primary} /><Text style={s.linkRowText}>Admins and permissions · {g.counts.admins}</Text><Icon name="chevron-right" size={16} color={colors.faint} />
            </Pressable>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '700', fontSize: 13.5 },
  lead: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 12 },
  welcomeWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  welcomeCard: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.xl, padding: 22, alignItems: 'center', ...shadow.lg },
  welcomeIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  welcomeEyebrow: { marginTop: 12, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.gold },
  welcomeTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.fg, textAlign: 'center', marginTop: 4, marginBottom: 8 },
  welcomeText: { fontSize: 14.5, lineHeight: 21, color: colors.fg },
  welcomeBtn: { alignSelf: 'stretch', height: 48, borderRadius: radius.pill, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  welcomeBtnGhost: { backgroundColor: colors.primarySoft, marginTop: 8 },
  welcomeBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14.5 },
  choice: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: radius.pill, padding: 3, borderWidth: 1, borderColor: colors.border },
  choiceBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: 'center' },
  choiceOn: { backgroundColor: colors.surface, ...shadow.sm },
  choiceText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  choiceTextOn: { color: colors.primary, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg },
  cardSub: { fontSize: 12.5, color: colors.faint, marginTop: 2 },
  settingRow: { marginTop: 14 },
  settingLabel: { fontSize: 13.5, fontWeight: '700', color: colors.fg },
  settingHint: { fontSize: 12, color: colors.faint, marginTop: 2, lineHeight: 17 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4 },
  permLabel: { flex: 1, fontSize: 14, color: colors.fg },
  roleTag: { borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  roleText: { fontSize: 10.5, fontWeight: '800' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 6, borderRadius: radius.md },
  personName: { fontSize: 14.5, fontWeight: '700', color: colors.fg, flexShrink: 1 },
  personSub: { fontSize: 12, color: colors.faint, marginTop: 1 },
  listCard: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, height: 42 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.fg, outlineStyle: 'none' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 14, paddingBottom: 26, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.fg, marginHorizontal: 8, marginBottom: 6 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderRadius: radius.md },
  sheetRowText: { fontSize: 15, fontWeight: '600', color: colors.fg },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  chipTextOn: { color: '#FFFFFF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gridCell: { width: '31.8%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.raised },
  mediaRow: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 8, gap: 6 },
  mediaMeta: { fontSize: 11.5, color: colors.faint },
  inviteUrl: { marginTop: 10, fontSize: 13.5, color: colors.primary, backgroundColor: colors.raised, borderRadius: radius.sm, padding: 10 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.fg, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.screen, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, color: colors.fg },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  linkRowText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.fg },
});
