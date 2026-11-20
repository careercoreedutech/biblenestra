// CHAT 7.4 — Group Info / contact info (opened from the chat header) and joining a group by invite link.
//   Group: photo, name, description (admins edit), member count, admins & moderators, full member directory with
//   search (role badge, "Added by X" / "New", tap → profile / message / roles / remove / transfer ownership),
//   add members (search or invite link), join requests, shared Photos · Videos · Docs · Audio · Links · Files
//   (each opens a viewer; download where it makes sense), permissions & slow mode, mute, report, leave.
//   Direct chat: the person, online / last seen, shared media, my last-seen privacy, mute, block, report.
// Every rule is enforced by the server (backend/src/routes/chatGroups.js); the UI only hides what you can't do.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen, Button, Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { AnimatedModal, PressScale } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';
import { errorMessage } from '../api/client';
import { pickPhotos, uploadImage } from '../api/media';
import { useChatMediaSource, downloadChatFile } from '../api/chatMedia';
import { ChatMediaViewer, isPdf } from '../chat/ChatExtras';
import { usePresence } from '../chat/live';
import { presenceLabel, relTime, fmtBytes } from '../chat/messages';
import { openLink } from '../components/EmbedViewer';

const TABS = [
  { key: 'photos', label: 'Photos' }, { key: 'videos', label: 'Videos' }, { key: 'docs', label: 'Docs' },
  { key: 'audio', label: 'Audio' }, { key: 'links', label: 'Links' }, { key: 'files', label: 'Files' },
];
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', moderator: 'Moderator' };
const SLOW = [0, 10, 30, 60, 300, 900, 3600];
const slowLabel = (s) => (!s ? 'Off' : s < 60 ? `${s}s` : s < 3600 ? `${s / 60} min` : '1 hour');

function RoleBadge({ role }) {
  if (!ROLE_LABEL[role]) return null;
  const tint = role === 'moderator' ? colors.teal : role === 'owner' ? colors.gold : colors.primary;
  return <View style={[styles.badge, { borderColor: tint }]}><Text style={[styles.badgeText, { color: tint }]}>{ROLE_LABEL[role]}</Text></View>;
}

function Row({ icon, label, sub, onPress, tint = colors.fg, right }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && onPress && { backgroundColor: colors.raised }]} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}>
      {icon ? <View style={styles.rowIcon}><Icon name={icon} size={17} color={tint} /></View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {right !== undefined ? right : onPress ? <Icon name="chevron-right" size={14} color={colors.faint} /> : null}
    </Pressable>
  );
}

function Card({ title, children, right }) {
  return (
    <View style={styles.card}>
      {title ? <View style={styles.cardHead}><Text style={styles.cardTitle}>{title}</Text>{right}</View> : null}
      {children}
    </View>
  );
}

function Thumb({ item, request, onOpen }) {
  const { source } = useChatMediaSource(request, item.mediaKey);
  return (
    <Pressable onPress={onOpen} style={styles.thumb} accessibilityLabel="Open photo">
      {source ? <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <ActivityIndicator color={colors.muted} />}
    </Pressable>
  );
}

// ---------- shared media ----------
function SharedMedia({ convId }) {
  const api = useApi();
  const nav = useNav();
  const [tab, setTab] = useState('photos');
  const [counts, setCounts] = useState(null);
  const [items, setItems] = useState(null);
  const [viewer, setViewer] = useState(null);
  useEffect(() => { api.request('GET', `/conversations/${convId}/media/counts`).then(setCounts).catch(() => {}); }, [convId]);
  useEffect(() => {
    setItems(null);
    api.request('GET', `/conversations/${convId}/media?type=${tab}`).then((r) => setItems(r.items || [])).catch(() => setItems([]));
  }, [convId, tab]);
  const open = (x) => {
    const name = (x.meta && x.meta.name) || '';
    if (tab === 'photos') setViewer({ kind: 'image', key: x.mediaKey, name: 'Photo' });
    else if (tab === 'videos') setViewer({ kind: 'video', key: x.mediaKey, name: name || 'Video' });
    else if (tab === 'audio') setViewer({ kind: 'audio', key: x.mediaKey, name: name || 'Voice note', isFile: !!(x.meta && x.meta.file), durationMs: x.meta && x.meta.durationMs });
    else setViewer({ kind: isPdf({ name, mime: x.meta && x.meta.mime }) ? 'pdf' : 'file', key: x.mediaKey, name: name || 'File' });
  };
  return (
    <Card title="Media, links and docs">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}{counts && counts[t.key] ? ` ${counts[t.key]}` : ''}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {!items ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 18 }} /> : null}
      {items && !items.length ? <Text style={styles.empty}>Nothing shared here yet.</Text> : null}
      {items && tab === 'photos' ? (
        <View style={styles.grid}>{items.map((x) => <Thumb key={x.messageId} item={x} request={api.request} onOpen={() => open(x)} />)}</View>
      ) : null}
      {items && tab === 'links' ? items.map((x, i) => (
        <Row key={`${x.messageId}_${i}`} icon="link" label={x.host || x.url} sub={`${x.url}\n${x.senderName} · ${relTime(Date.parse(x.createdAt))}`} onPress={() => openLink(x.url, nav)} />
      )) : null}
      {items && !['photos', 'links'].includes(tab) ? items.map((x) => {
        const name = (x.meta && x.meta.name) || (tab === 'audio' ? (x.meta && x.meta.file ? 'Audio' : 'Voice note') : tab === 'videos' ? 'Video' : 'File');
        const canDl = tab !== 'audio';
        return (
          <Row
            key={x.messageId}
            icon={tab === 'videos' ? 'video' : tab === 'audio' ? (x.meta && x.meta.file ? 'music' : 'mic') : 'book'}
            label={name}
            sub={[x.senderName, relTime(Date.parse(x.createdAt)), fmtBytes(x.meta && x.meta.size)].filter(Boolean).join(' · ')}
            onPress={() => open(x)}
            right={canDl ? (
              <Pressable onPress={() => downloadChatFile(api.request, x.mediaKey, name).catch(() => {})} hitSlop={8} style={styles.dl} accessibilityLabel={`Download ${name}`}>
                <Icon name="download" size={15} color={colors.primary} />
              </Pressable>
            ) : undefined}
          />
        );
      }) : null}
      <ChatMediaViewer item={viewer} request={api.request} onClose={() => setViewer(null)} />
    </Card>
  );
}

// ---------- add people ----------
function AddMembersSheet({ visible, convId, existing, onClose, onAdded, invite }) {
  const api = useApi();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setPicked([]); setQ(''); } }, [visible]);
  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => api.request('GET', `/people?q=${encodeURIComponent(q.trim())}`).then((r) => setPeople((r.items || []).filter((p) => !existing.has(p.id)))).catch(() => setPeople([])), 250);
    return () => clearTimeout(t);
  }, [q, visible]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const add = async () => {
    setBusy(true);
    try {
      const r = await api.request('POST', `/conversations/${convId}/members`, { userIds: picked });
      toast.show(r.added ? `Added ${r.added}` : 'No one new to add', { icon: 'check', haptic: 'success' });
      onAdded(); onClose();
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t add people'), { tone: 'error' }); }
    setBusy(false);
  };
  return (
    <AnimatedModal visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={[styles.sheet, { maxHeight: '82%' }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Add members</Text>
          {invite ? <Row icon="link" label="Invite with a link" sub="Anyone with the link can join" onPress={() => { onClose(); invite(); }} /> : null}
          <View style={styles.search}><Icon name="search" size={15} color={colors.muted} /><TextInput value={q} onChangeText={setQ} placeholder="Search by name, @handle or church" placeholderTextColor={colors.faint} style={styles.searchInput} /></View>
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
            {people.map((p) => {
              const on = picked.includes(p.id);
              return (
                <Pressable key={p.id} onPress={() => toggle(p.id)} style={styles.member} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={p.displayName}>
                  <SocialAvatar name={p.displayName} uri={p.avatarUrl} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.memberName} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={styles.memberSub} numberOfLines={1}>{p.church || (p.handle ? `@${p.handle}` : 'BibleNestra member')}</Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}</View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Button label={busy ? 'Adding…' : picked.length ? `Add ${picked.length}` : 'Choose people'} disabled={!picked.length || busy} onPress={add} />
        </View>
      </View>
    </AnimatedModal>
  );
}

// ---------- one member's actions ----------
function MemberSheet({ member, me, convId, onClose, onChanged }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const sync = useSync();
  if (!member) return null;
  const myRank = { owner: 3, admin: 2, moderator: 1, member: 0 }[me.role] ?? 0;
  const theirRank = { owner: 3, admin: 2, moderator: 1, member: 0 }[member.role] ?? 0;
  const canManage = me.permissions && me.permissions.canPromote && myRank > theirRank && !member.isMe;
  const run = async (fn, ok) => {
    onClose();
    try { await fn(); toast.show(ok, { icon: 'check' }); onChanged(); if (sync.refresh) sync.refresh({ quiet: true }); } catch (e) { toast.show(errorMessage(e, 'Couldn’t do that'), { tone: 'error' }); }
  };
  const setRole = (role, ok) => run(() => api.request('POST', `/conversations/${convId}/members/${member.id}/role`, { role }), ok);
  const message = async () => {
    onClose();
    try { const r = await api.request('POST', '/conversations/dm', { userId: member.id }); nav.push('Chat', { id: r.id, to: member.displayName, userId: member.id }); } catch (e) { if (!(e && e.code === 'CHAT_LIMIT_REACHED')) toast.show(errorMessage(e, 'Couldn’t open the chat'), { tone: 'error' }); }
  };
  return (
    <AnimatedModal visible={!!member} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <SocialAvatar name={member.displayName} uri={member.avatarUrl} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{member.displayName}</Text>
              <Text style={styles.memberSub}>{[ROLE_LABEL[member.role], member.addedBy ? `Added by ${member.addedBy.displayName}` : null].filter(Boolean).join(' · ') || 'Member'}</Text>
            </View>
          </View>
          <Row icon="user" label="View profile" onPress={() => { onClose(); nav.push('UserProfile', { id: member.id, name: member.displayName }); }} />
          {!member.isMe ? <Row icon="chat" label={`Message ${member.displayName}`} onPress={message} /> : null}
          {canManage && member.role !== 'admin' && myRank >= 2 ? <Row icon="shield" label="Make group admin" onPress={() => setRole('admin', `${member.displayName} is now an admin`)} /> : null}
          {canManage && member.role !== 'moderator' ? <Row icon="star" label="Make moderator" sub="Can pin, delete messages and approve join requests" onPress={() => setRole('moderator', `${member.displayName} is now a moderator`)} /> : null}
          {canManage && member.role !== 'member' ? <Row icon="x" label={`Dismiss as ${ROLE_LABEL[member.role].toLowerCase()}`} onPress={() => setRole('member', 'Role removed')} /> : null}
          {me.role === 'owner' && !member.isMe ? <Row icon="church" label="Transfer ownership" sub="They become the owner; you stay an admin" onPress={() => run(() => api.request('POST', `/conversations/${convId}/transfer`, { userId: member.id }), `${member.displayName} now owns the group`)} /> : null}
          {canManage && me.permissions.canRemoveMembers ? <Row icon="trash" tint={colors.negative || colors.rose} label={`Remove ${member.displayName}`} onPress={() => run(() => api.request('DELETE', `/conversations/${convId}/members/${member.id}`), 'Removed from the group')} /> : null}
        </View>
      </View>
    </AnimatedModal>
  );
}

function ChoiceRow({ label, sub, value, options, onChange, disabled }) {
  return (
    <View style={styles.choice}>
      <Text style={styles.rowLabel}>{label}</Text>
      {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      <View style={styles.choiceOpts}>
        {options.map((o) => (
          <Pressable key={String(o.value)} disabled={disabled} onPress={() => onChange(o.value)} style={[styles.opt, value === o.value && styles.optOn, disabled && { opacity: 0.5 }]} accessibilityRole="radio" accessibilityState={{ selected: value === o.value }}>
            <Text style={[styles.optText, value === o.value && styles.optTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------- the screen ----------
export function ChatInfoScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const sync = useSync();
  const { state, dispatch } = useStore();
  const convId = params.id;
  const [info, setInfo] = useState(null);
  const [members, setMembers] = useState(null);
  const [requests, setRequests] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState(null);
  const [privacy, setPrivacy] = useState(null);
  const presence = usePresence(convId);

  const load = useCallback(async () => {
    try {
      const i = await api.request('GET', `/conversations/${convId}/info`);
      setInfo(i); setTitle(i.title); setDesc(i.description || ''); setError(null);
      if (i.kind !== 'dm') {
        const m = await api.request('GET', `/conversations/${convId}/members`);
        setMembers(m.items || []);
        if (i.permissions && i.permissions.canApproveJoins) setRequests((await api.request('GET', `/conversations/${convId}/requests`)).items || []);
      } else {
        setPrivacy((await api.request('GET', '/me/chat-privacy')).lastSeen);
      }
    } catch (e) { setError(errorMessage(e, 'Couldn’t load this chat')); }
  }, [convId]);
  useEffect(() => { if (api.online && convId) load(); }, [convId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (members || []).filter((m) => !t || (m.displayName || '').toLowerCase().includes(t) || (m.handle || '').toLowerCase().includes(t));
  }, [members, q]);

  if (!api.online) return <Screen back title="Info"><Empty title="Sign in first" body="Group info lives on the server." /></Screen>;
  if (error) return <Screen back title={params.to || 'Info'}><Notice tint={colors.negative} text={error} /><Button label="Try again" onPress={load} /></Screen>;
  if (!info) return <Screen back title={params.to || 'Info'}><ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /></Screen>;

  const p = info.permissions || {};
  const isDm = info.kind === 'dm';
  const isGroup = info.kind === 'group';
  const refreshAll = () => { load(); if (sync.refresh) sync.refresh({ quiet: true }); };
  const patch = async (body, ok) => {
    try { const i = await api.request('PATCH', `/conversations/${convId}`, body); setInfo(i); toast.show(ok, { icon: 'check' }); if (sync.refresh) sync.refresh({ quiet: true }); return true; } catch (e) { toast.show(errorMessage(e, 'Couldn’t save'), { tone: 'error' }); return false; }
  };
  const setSetting = async (body) => {
    const prev = info.settings;
    setInfo({ ...info, settings: { ...info.settings, ...body } });
    try { const r = await api.request('PATCH', `/conversations/${convId}/settings`, body); setInfo((x) => ({ ...x, settings: r.settings })); } catch (e) { setInfo((x) => ({ ...x, settings: prev })); toast.show(errorMessage(e, 'Couldn’t change the setting'), { tone: 'error' }); }
  };
  const changePhoto = async () => {
    try {
      const [photo] = await pickPhotos(1);
      if (!photo) return;
      toast.show('Uploading photo…', { icon: 'image' });
      const up = await uploadImage(api.request, photo);
      await patch({ avatarKey: up.key }, 'Group photo updated');
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t change the photo'), { tone: 'error' }); }
  };
  const shareInvite = async (reset) => {
    try {
      const r = await api.request('POST', `/conversations/${convId}/invite`, reset ? { reset: true } : {});
      setInfo((x) => ({ ...x, inviteCode: r.code }));
      if (reset) { toast.show('Old link reset — it no longer works', { icon: 'check' }); return; }
      const text = `Join “${info.title}” on BibleNestra: ${r.url}\nInvite code: ${r.code}`;
      try { await Share.share({ message: text }); } catch (e) { await Clipboard.setStringAsync(text); toast.show('Invite link copied', { icon: 'check' }); }
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t get the invite link'), { tone: 'error' }); }
  };
  const copyInvite = async () => {
    const r = await api.request('POST', `/conversations/${convId}/invite`, {});
    await Clipboard.setStringAsync(r.url);
    setInfo((x) => ({ ...x, inviteCode: r.code }));
    toast.show('Invite link copied', { icon: 'check' });
  };
  const toggleMute = async () => {
    try {
      const r = await api.request('PUT', `/conversations/${convId}/mute`, { muted: !info.muted });
      setInfo({ ...info, muted: r.muted });
      dispatch({ type: 'set', patch: { chats: (state.chats || []).map((c) => (c.id === convId ? { ...c, muted: r.muted } : c)) }, local: true });
      toast.show(r.muted ? 'Muted · @mentions still notify you' : 'Notifications on', { icon: r.muted ? 'volume' : 'bell' });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t change notifications'), { tone: 'error' }); }
  };
  const leave = async () => {
    try {
      await api.request('POST', `/conversations/${convId}/leave`);
      dispatch({ type: 'set', patch: { chats: (state.chats || []).filter((c) => c.id !== convId) }, local: true });
      toast.show(`You left ${info.title}`, { icon: 'x' });
      nav.pop(); nav.pop(); // back past the chat to the list
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t leave'), { tone: 'error' }); }
  };
  const report = async () => { try { await api.request('POST', `/conversations/${convId}/report`, { reason: 'Reported from info page' }); toast.show('Report sent · our safety team will review it', { icon: 'shield' }); } catch (e) { toast.show(errorMessage(e, 'Couldn’t report'), { tone: 'error' }); } };
  const decide = async (u, approve) => {
    try { await api.request('POST', `/conversations/${convId}/requests/${u.id}`, { approve }); setRequests((r) => r.filter((x) => x.id !== u.id)); if (approve) refreshAll(); } catch (e) { toast.show(errorMessage(e, 'Couldn’t update the request'), { tone: 'error' }); }
  };
  const setLastSeen = async (v) => {
    setPrivacy(v);
    try { await api.request('PUT', '/me/chat-privacy', { lastSeen: v }); } catch (e) { toast.show(errorMessage(e, 'Couldn’t save'), { tone: 'error' }); }
  };
  const me = { role: info.myRole, permissions: p };
  const ou = info.otherUser;

  return (
    <Screen back title={isDm ? 'Contact info' : info.kind === 'channel' ? 'Channel info' : 'Group info'}>
      <View style={styles.hero}>
        <Pressable onPress={p.canEditInfo && !isDm ? changePhoto : undefined} accessibilityLabel={p.canEditInfo ? 'Change group photo' : undefined}>
          {isDm ? <SocialAvatar name={info.title} uri={ou && ou.avatarUrl} size={88} />
            : info.avatarUrl ? <SocialAvatar name={info.title} uri={info.avatarUrl} size={88} />
              : <View style={styles.heroIcon}><Icon name={info.kind === 'channel' ? 'volume' : 'users'} size={36} color={colors.primary} /></View>}
          {p.canEditInfo && !isDm ? <View style={styles.camera}><Icon name="image" size={13} color="#FFFFFF" /></View> : null}
        </Pressable>
        {editing ? (
          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            <TextInput value={title} onChangeText={setTitle} maxLength={80} style={styles.input} placeholder="Group name" placeholderTextColor={colors.faint} />
            <TextInput value={desc} onChangeText={setDesc} maxLength={500} multiline style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} placeholder="Description" placeholderTextColor={colors.faint} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button small kind="ghost" label="Cancel" onPress={() => { setEditing(false); setTitle(info.title); setDesc(info.description); }} />
              <Button small label="Save" onPress={async () => { if (await patch({ title, description: desc }, 'Group info saved')) setEditing(false); }} />
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.heroTitle}>{info.title}</Text>
            <Text style={styles.heroSub}>
              {isDm ? (presenceLabel(presence || (ou && ou.presence)) || (ou && ou.handle ? `@${ou.handle}` : 'BibleNestra member'))
                : `${info.kind === 'channel' ? 'Channel' : 'Group'} · ${info.membersCount} ${info.kind === 'channel' ? 'followers' : 'members'}`}
            </Text>
            {info.description ? <Text style={styles.heroDesc}>{info.description}</Text> : null}
            {p.canEditInfo && !isDm ? <Pressable onPress={() => setEditing(true)} hitSlop={8}><Text style={styles.link}>Edit name & description</Text></Pressable> : null}
          </>
        )}
        <View style={styles.quick}>
          {isDm && ou ? <PressScale onPress={() => nav.push('UserProfile', { id: ou.id, name: ou.displayName })} style={styles.quickBtn}><Icon name="user" size={18} color={colors.primary} /><Text style={styles.quickText}>Profile</Text></PressScale> : null}
          <PressScale onPress={toggleMute} style={styles.quickBtn}><Icon name={info.muted ? 'bell' : 'volume'} size={18} color={colors.primary} /><Text style={styles.quickText}>{info.muted ? 'Unmute' : 'Mute'}</Text></PressScale>
          {p.canAddMembers ? <PressScale onPress={() => setAdding(true)} style={styles.quickBtn}><Icon name="plus" size={18} color={colors.primary} /><Text style={styles.quickText}>Add</Text></PressScale> : null}
          {p.canInvite ? <PressScale onPress={() => shareInvite(false)} style={styles.quickBtn}><Icon name="link" size={18} color={colors.primary} /><Text style={styles.quickText}>Invite</Text></PressScale> : null}
        </View>
      </View>

      {requests.length ? (
        <Card title={`Join requests · ${requests.length}`}>
          {requests.map((u) => (
            <View key={u.id} style={styles.member}>
              <SocialAvatar name={u.displayName} uri={u.avatarUrl} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.memberName} numberOfLines={1}>{u.displayName}</Text><Text style={styles.memberSub}>Asked {relTime(Date.parse(u.requestedAt))}</Text></View>
              <Button small kind="ghost" label="Decline" onPress={() => decide(u, false)} />
              <Button small label="Approve" onPress={() => decide(u, true)} />
            </View>
          ))}
        </Card>
      ) : null}

      <SharedMedia convId={convId} />

      {!isDm && members ? (
        <Card title={`${info.membersCount} ${info.kind === 'channel' ? 'followers' : 'members'}`}>
          {info.admins && info.admins.length ? (
            <Text style={styles.adminsLine} numberOfLines={2}>
              {info.admins.map((a) => `${a.displayName} (${ROLE_LABEL[a.role]})`).join(' · ')}
            </Text>
          ) : null}
          {p.canAddMembers ? <Row icon="plus" tint={colors.primary} label="Add members" onPress={() => setAdding(true)} /> : null}
          {p.canInvite ? <Row icon="link" tint={colors.primary} label="Invite via link" sub={info.inviteCode ? 'Tap to share · long-press options below' : 'Create a link anyone can join with'} onPress={() => shareInvite(false)} /> : null}
          {members.length > 6 ? (
            <View style={styles.search}><Icon name="search" size={15} color={colors.muted} /><TextInput value={q} onChangeText={setQ} placeholder="Search members" placeholderTextColor={colors.faint} style={styles.searchInput} accessibilityLabel="Search members" /></View>
          ) : null}
          <FlatList
            data={filtered}
            scrollEnabled={false}
            keyExtractor={(m) => m.id}
            initialNumToRender={30}
            renderItem={({ item: m }) => (
              <Pressable onPress={() => setSel(m)} style={({ pressed }) => [styles.member, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button" accessibilityLabel={`${m.displayName}${ROLE_LABEL[m.role] ? `, ${ROLE_LABEL[m.role]}` : ''}`}>
                <View>
                  <SocialAvatar name={m.displayName} uri={m.avatarUrl} size={42} />
                  {m.presence && m.presence.online ? <View style={styles.onlineDot} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.memberName} numberOfLines={1}>{m.isMe ? 'You' : m.displayName}</Text>
                  <Text style={styles.memberSub} numberOfLines={1}>
                    {m.isNew && m.role === 'member' ? 'New · ' : ''}{m.addedBy ? `Added by ${m.addedBy.displayName}` : m.role === 'owner' ? 'Created the group' : (m.handle ? `@${m.handle}` : m.church || 'Member')}
                  </Text>
                </View>
                <RoleBadge role={m.role} />
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No one matches “{q}”.</Text>}
          />
        </Card>
      ) : null}

      {isGroup && p.canChangeSettings ? (
        <Card title="Group settings">
          <ChoiceRow label="Send messages" value={info.settings.sendMessages} onChange={(v) => setSetting({ sendMessages: v })} options={[{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }]} />
          <ChoiceRow label="Add members" value={info.settings.addMembers} onChange={(v) => setSetting({ addMembers: v })} options={[{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }]} />
          <ChoiceRow label="Edit group info" value={info.settings.editInfo} onChange={(v) => setSetting({ editInfo: v })} options={[{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }]} />
          <View style={[styles.row, { paddingHorizontal: 0 }]}>
            <View style={{ flex: 1 }}><Text style={styles.rowLabel}>Approve new members</Text><Text style={styles.rowSub}>People who use the invite link wait for an admin or moderator</Text></View>
            <Switch value={!!info.settings.approveJoins} onValueChange={(v) => setSetting({ approveJoins: v })} trackColor={{ true: colors.primary }} />
          </View>
          <ChoiceRow label="Slow mode" sub="Members wait between messages (admins and moderators don’t)" value={info.settings.slowModeSec} onChange={(v) => setSetting({ slowModeSec: v })} options={SLOW.map((s) => ({ value: s, label: slowLabel(s) }))} />
          {p.canInvite && info.inviteCode ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Button small kind="ghost" label="Copy invite link" onPress={copyInvite} />
              <Button small kind="ghost" label="Reset link" onPress={() => shareInvite(true)} />
            </View>
          ) : null}
        </Card>
      ) : isGroup ? (
        <Card title="Group settings">
          <Text style={styles.rowSub}>
            {info.settings.sendMessages === 'admins' ? 'Only admins can send messages. ' : ''}
            {info.settings.addMembers === 'admins' ? 'Only admins add members. ' : 'Everyone can add members. '}
            {info.settings.slowModeSec ? `Slow mode: ${slowLabel(info.settings.slowModeSec)}. ` : ''}
            {info.settings.approveJoins ? 'New members need approval.' : ''}
          </Text>
        </Card>
      ) : null}

      {isDm ? (
        <Card title="Privacy">
          <ChoiceRow label="Who can see my last seen & online" sub="If you hide yours, you can’t see other people’s either" value={privacy} onChange={setLastSeen} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'nobody', label: 'Nobody' }]} />
        </Card>
      ) : null}

      <Card>
        <Row icon={info.muted ? 'bell' : 'volume'} label={info.muted ? 'Unmute notifications' : 'Mute notifications'} sub={info.muted ? 'You only hear about @mentions' : null} onPress={toggleMute} />
        <Row icon="shield" tint={colors.negative || colors.rose} label={isDm ? `Report ${info.title}` : 'Report group'} onPress={report} />
        {isDm && ou ? <Row icon="x" tint={colors.negative || colors.rose} label={`Block ${info.title}`} onPress={async () => { try { await api.request('POST', `/users/${ou.id}/block`); toast.show(`${info.title} is blocked`, { icon: 'shield' }); nav.pop(); } catch (e) { toast.show(errorMessage(e, 'Couldn’t block'), { tone: 'error' }); } }} /> : null}
        {!isDm ? <Row icon="x" tint={colors.negative || colors.rose} label={info.kind === 'channel' ? 'Unfollow channel' : 'Leave group'} onPress={leave} /> : null}
      </Card>

      {!isDm ? <AddMembersSheet visible={adding} convId={convId} existing={new Set((members || []).map((m) => m.id))} onClose={() => setAdding(false)} onAdded={refreshAll} invite={p.canInvite ? () => shareInvite(false) : null} /> : null}
      <MemberSheet member={sel} me={me} convId={convId} onClose={() => setSel(null)} onChanged={refreshAll} />
    </Screen>
  );
}

// ---------- join by invite link / code ----------
export const inviteCodeFrom = (text) => {
  const m = String(text || '').trim().match(/(?:join\/)?([A-Za-z0-9]{8,32})\s*$/);
  return m ? m[1] : null;
};

export function JoinGroupScreen({ params = {} }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const sync = useSync();
  const [text, setText] = useState(params.code || '');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const code = inviteCodeFrom(text);
  useEffect(() => {
    setPreview(null); setError(null);
    if (!code || !api.online) return undefined;
    const t = setTimeout(() => api.request('GET', `/invites/${code}`).then(setPreview).catch((e) => setError(errorMessage(e, 'That link doesn’t work'))), 250);
    return () => clearTimeout(t);
  }, [code]);
  const join = async () => {
    setBusy(true);
    try {
      const r = await api.request('POST', `/invites/${code}/join`);
      if (sync.refresh) await sync.refresh({ quiet: true });
      if (r.status === 'requested') { toast.show('Request sent · an admin will let you in', { icon: 'check' }); setPreview((x) => ({ ...x, requestStatus: 'pending' })); }
      else nav.replace('Chat', { id: r.conversationId, to: preview && preview.title, kind: 'group' });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t join'), { tone: 'error' }); }
    setBusy(false);
  };
  return (
    <Screen back title="Join a group">
      <Text style={styles.rowSub}>Paste an invite link or code someone shared with you.</Text>
      <View style={styles.search}><Icon name="link" size={15} color={colors.muted} /><TextInput value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} placeholder="https://…/join/AbC123… or the code" placeholderTextColor={colors.faint} style={styles.searchInput} accessibilityLabel="Invite link or code" /></View>
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {preview ? (
        <View style={[styles.card, { alignItems: 'center', gap: 8 }]}>
          {preview.avatarUrl ? <SocialAvatar name={preview.title} uri={preview.avatarUrl} size={72} /> : <View style={styles.heroIcon}><Icon name="users" size={30} color={colors.primary} /></View>}
          <Text style={styles.heroTitle}>{preview.title}</Text>
          <Text style={styles.heroSub}>Group · {preview.membersCount} members{preview.approveJoins ? ' · admin approval' : ''}</Text>
          {preview.description ? <Text style={styles.heroDesc}>{preview.description}</Text> : null}
          {preview.isMember ? <Button label="Open chat" onPress={() => nav.replace('Chat', { id: preview.conversationId, to: preview.title, kind: 'group' })} />
            : preview.requestStatus === 'pending' ? <Notice text="Your request is waiting for an admin." />
              : <Button label={busy ? 'Joining…' : preview.approveJoins ? 'Ask to join' : 'Join group'} disabled={busy} onPress={join} />}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6, paddingTop: 14, paddingBottom: 6 },
  heroIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  camera: { position: 'absolute', right: 0, bottom: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.screen },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, textAlign: 'center', marginTop: 6 },
  heroSub: { fontSize: 13, color: colors.muted },
  heroDesc: { fontSize: 14, lineHeight: 20, color: colors.fg, textAlign: 'center', paddingHorizontal: 12 },
  link: { fontSize: 13, fontWeight: '600', color: colors.primary, marginTop: 2 },
  quick: { flexDirection: 'row', gap: 10, marginTop: 10 },
  quickBtn: { width: 74, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 4 },
  quickText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  card: { marginTop: 14, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.md },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14.5, fontWeight: '600', color: colors.fg },
  rowSub: { fontSize: 12.5, lineHeight: 17, color: colors.muted, marginTop: 1 },
  tab: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, backgroundColor: colors.raised, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  tabTextOn: { color: '#FFFFFF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  thumb: { width: '32.5%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 13, color: colors.faint, textAlign: 'center', paddingVertical: 14 },
  dl: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  adminsLine: { fontSize: 12.5, color: colors.muted, marginBottom: 6 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8, paddingHorizontal: 12, height: 40, borderRadius: radius.pill, backgroundColor: colors.raised },
  searchInput: { flex: 1, fontSize: 14, color: colors.fg, paddingVertical: 0, outlineStyle: 'none' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 2, borderRadius: radius.md },
  memberName: { fontSize: 15, fontWeight: '600', color: colors.fg },
  memberSub: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  onlineDot: { position: 'absolute', right: 0, bottom: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.positive || '#2FA36B', borderWidth: 2, borderColor: colors.surface },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10.5, fontWeight: '700' },
  choice: { paddingVertical: 8 },
  choiceOpts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  opt: { paddingHorizontal: 12, height: 30, borderRadius: radius.pill, backgroundColor: colors.raised, justifyContent: 'center' },
  optOn: { backgroundColor: colors.primary },
  optText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  optTextOn: { color: '#FFFFFF' },
  input: { borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.fg },
  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 26, gap: 6, ...shadow.lg },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 8 },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
