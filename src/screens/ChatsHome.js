// WhatsApp-style messaging home: Chats · Groups · Channels · Find Believers.
// Anyone can message anyone (no request to accept). Groups: everyone talks. Channels: only admins post,
// anyone can follow. Server: backend/src/routes/conversations.js.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, Button, Empty, Notice, Pills, Badge } from '../components/ui';
import { Icon } from '../components/Icons';
import { PressScale, FadeInUp, Pulse } from '../components/Motion';
import { d, k, PageHeader, IconButton, SectionTitle, Tap } from '../design/sanctuary';
import { SocialAvatar } from '../components/social/FeedCard';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useApi } from '../api/auth';
import { useSync } from '../api/sync';
import { errorMessage } from '../api/client';
import { PEOPLE } from '../data/seed';
import { ChatListRow, CHAT_ROW_HEIGHT } from '../components/chat/ChatListRow'; // CHAT 7.3
import { ChatActionsSheet } from '../components/chat/ChatActionsSheet'; // PACKAGE F: long-press menu
import { deleteConfirmText } from '../chat/chatActions'; // PACKAGE F
import { pinChat, hideChat, deleteGroup } from '../api/groupDiscovery'; // PACKAGE F
import { relTime } from '../chat/messages';
import { ChatSlotsCounter, ChatPassBadge } from '../components/ChatLimit'; // CHAT LIMITS: "3 of 5 free chats used" (prompt itself is global, App.js)

const TABS = ['Chats', 'Groups', 'Communities', 'Channels', 'Find Believers'];

const lastText = (c) => (c.lastMessage ? (c.lastMessage.deleted ? 'Message deleted' : c.lastMessage.text || 'Attachment') : c.last || '');
const lastTime = (c) => (c.lastMessage ? c.lastMessage.time : c.time) || '';
const unreadOf = (c) => c.unreadCount || c.unread || 0;

function ConversationRow({ c, icon, subtitle, onPress, index }) {
  const unread = unreadOf(c);
  return (
    <FadeInUp index={index} distance={8} duration={260}>
      <PressScale onPress={onPress} scaleTo={0.985} style={styles.row} accessibilityRole="button" accessibilityLabel={`${c.with}. ${lastText(c)}`}>
        {icon ? (
          <View style={[styles.groupIcon, c.kind === 'channel' && { backgroundColor: colors.cardGold }]}>
            <Icon name={icon} size={20} color={c.kind === 'channel' ? colors.gold : colors.primary} />
          </View>
        ) : (
          <SocialAvatar name={c.with} uri={c.otherUser && c.otherUser.avatarUrl} size={48} />
        )}
        <View style={styles.rowMid}>
          <View style={styles.rowTop}>
            <Text style={styles.rowName} numberOfLines={1}>{c.with}</Text>
            <Text style={[styles.rowTime, unread ? { color: colors.positive, fontWeight: '700' } : null]}>{lastTime(c)}</Text>
          </View>
          <View style={styles.rowTop}>
            <Text style={styles.rowLast} numberOfLines={1}>{subtitle || lastText(c) || 'No messages yet'}</Text>
            {unread ? <View style={styles.unread}><Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text></View> : null}
          </View>
        </View>
      </PressScale>
    </FadeInUp>
  );
}

function CreateRow({ icon, title, sub, onPress }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.985} style={styles.createRow} accessibilityRole="button" accessibilityLabel={title}>
      <View style={styles.createIcon}><Icon name={icon} size={20} color="#FFFFFF" strokeWidth={2.2} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName}>{title}</Text>
        <Text style={styles.rowLast}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={15} color={colors.faint} />
    </PressScale>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <View style={styles.search}>
      <Icon name="search" size={16} color={colors.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.faint} style={styles.searchInput} autoCorrect={false} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={10}><Icon name="x" size={14} color={colors.muted} /></Pressable> : null}
    </View>
  );
}

// Start (or reopen) a direct chat with someone and open it — no request needed.
export function useOpenDm() {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const sync = useSync();
  return useCallback(async (person) => {
    if (!api.online) { nav.push('Chat', { to: person.name || person.displayName }); return; }
    try {
      const r = await api.request('POST', '/conversations/dm', { userId: person.id });
      nav.push('Chat', { id: r.id, to: person.displayName, userId: person.id });
      if (sync.refresh) sync.refresh({ quiet: true });
    } catch (e) {
      if (e && e.code === 'CHAT_LIMIT_REACHED') return; // CHAT LIMITS: the upgrade / invite prompt opens instead of a toast
      toast.show(errorMessage(e, 'Couldn’t open the chat'), { tone: 'error', icon: 'x' });
    }
  }, [api, nav, toast, sync]);
}

function FindBelievers() {
  const api = useApi();
  const nav = useNav();
  const openDm = useOpenDm();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!api.online) return undefined;
    const t = setTimeout(async () => {
      try { setPeople((await api.request('GET', `/people?q=${encodeURIComponent(q.trim())}`)).items || []); setError(null); }
      catch (e) { setError(errorMessage(e, 'Couldn’t search right now')); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, api]);

  if (!api.online) {
    const list = PEOPLE.filter((p) => (p.name + p.church).toLowerCase().includes(q.toLowerCase()));
    return (
      <View>
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or church" />
        {list.map((p, i) => <ConversationRow key={p.id} index={i} c={{ with: p.name }} subtitle={p.church || p.headline} onPress={() => nav.push('Person', { id: p.id })} />)}
      </View>
    );
  }
  return (
    <View>
      <ChatSlotsCounter />{/* CHAT LIMITS: free-chat counter in the new-chat flow */}
      <SearchBox value={q} onChange={setQ} placeholder="Search by name, @handle or church" />
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {!people && !error ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
      {people && !people.length ? <Empty title="No one found" body="Try another name or church." /> : null}
      {(people || []).map((p, i) => (
        <FadeInUp key={p.id} index={i} distance={8} duration={260}>
          <View style={styles.row}>
            <Pressable onPress={() => nav.push('UserProfile', { id: p.id, name: p.displayName })} style={styles.personTap} accessibilityLabel={`Open ${p.displayName}’s profile`}>
              <SocialAvatar name={p.displayName} uri={p.avatarUrl} size={48} />
              <View style={styles.rowMid}>
                <Text style={styles.rowName} numberOfLines={1}>{p.displayName}{p.verified ? ' ✓' : ''}</Text>
                <Text style={styles.rowLast} numberOfLines={1}>{[p.handle ? `@${p.handle}` : null, p.church].filter(Boolean).join(' · ') || 'BibleNestra member'}</Text>
                {p.bio ? <Text style={styles.rowLast} numberOfLines={1}>{p.bio}</Text> : null}{/* PACKAGE F: bio line in the preview */}
              </View>
            </Pressable>
            <Button small label="Message" icon={<Icon name="chat" size={13} color="#FFFFFF" />} onPress={() => openDm(p)} />
          </View>
        </FadeInUp>
      ))}
    </View>
  );
}

function ChannelDirectory({ onFollowed }) {
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const load = useCallback(async () => {
    try { setItems((await api.request('GET', `/channels?q=${encodeURIComponent(q.trim())}`)).items || []); } catch (e) { setItems([]); }
  }, [api, q]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  const follow = async (ch) => {
    try {
      await api.request('POST', `/channels/${ch.id}/follow`);
      toast.show(`Following ${ch.title}`, { icon: 'check', haptic: 'success' });
      onFollowed();
      nav.push('Chat', { id: ch.id, to: ch.title });
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t follow'), { tone: 'error', icon: 'x' }); }
  };
  const others = (items || []).filter((x) => !x.following);
  return (
    <View>
      <Text style={styles.sectionLabel}>Find channels</Text>
      <SearchBox value={q} onChange={setQ} placeholder="Search channels" />
      {!items ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
      {items && !others.length ? <Text style={styles.hint}>{q ? 'No channels match.' : 'No other channels yet. Create the first one!'}</Text> : null}
      {others.map((ch, i) => (
        <FadeInUp key={ch.id} index={i} distance={8} duration={260}>
          <View style={styles.row}>
            <View style={[styles.groupIcon, { backgroundColor: colors.cardGold }]}><Icon name="volume" size={20} color={colors.gold} /></View>
            <View style={styles.rowMid}>
              <Text style={styles.rowName} numberOfLines={1}>{ch.title}</Text>
              <Text style={styles.rowLast} numberOfLines={1}>{ch.followers} {ch.followers === 1 ? 'follower' : 'followers'}{ch.description ? ` · ${ch.description}` : ''}</Text>
            </View>
            <Button small kind="ghost" label="Follow" onPress={() => follow(ch)} />
          </View>
        </FadeInUp>
      ))}
    </View>
  );
}

export function ChatsHomeScreen({ params = {} }) {
  const nav = useNav();
  const { state } = useStore();
  const api = useApi();
  const sync = useSync();
  const toast = useToast();
  const [tab, setTab] = useState(TABS.includes(params.tab) ? params.tab : 'Chats');
  const [pulling, setPulling] = useState(false);
  const [dirKey, setDirKey] = useState(0);
  const focused = useIsFocused();
  const first = useRef(true);
  useEffect(() => {
    // fresh list each time you come back (new groups, channels, messages)
    if (focused && !first.current && sync.refresh) sync.refresh({ quiet: true });
    first.current = false;
  }, [focused]);
  const refresh = async () => { setPulling(true); try { if (sync.refresh) await sync.refresh({ quiet: true }); } catch (e) { /* shown by sync */ } setDirKey((k) => k + 1); setPulling(false); };

  const chats = state.chats || [];
  const direct = chats.filter((c) => !c.kind || c.kind === 'dm');
  const groups = chats.filter((c) => c.kind === 'group');
  const myGroups = groups.filter((c) => !c.communityName);
  const communityChats = groups.filter((c) => c.communityName);
  const channels = chats.filter((c) => c.kind === 'channel');
  const joinedCommunities = (state.communities || []).filter((co) => co.joined === true);
  const open = (c) => nav.push('Chat', { id: c.id, to: c.with });

  const plus = () => {
    if (tab === 'Groups') nav.push('NewGroup', { kind: 'group' });
    else if (tab === 'Communities') nav.push('Communities');
    else if (tab === 'Channels') nav.push('NewGroup', { kind: 'channel' });
    else setTab('Find Believers');
  };

  // CHAT 7.3: clean Messages list — "Search Messages", virtualised memo rows, floating "+"
  const listTab = tab === 'Chats' || tab === 'Groups';
  const listData = tab === 'Groups' ? myGroups : direct;
  const myId = (sync.me && sync.me.id) || null;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);
  const term = query.trim().toLowerCase();
  const shown = useMemo(() => (term ? listData.filter((c) => (c.with || '').toLowerCase().includes(term)) : listData), [listData, term]);
  useEffect(() => {
    setHits(null);
    if (!api.online || term.length < 2) return undefined;
    const t = setTimeout(() => api.request('GET', `/chats/search?q=${encodeURIComponent(term)}`).then((r) => setHits(r.items || [])).catch(() => setHits([])), 300);
    return () => clearTimeout(t);
  }, [term, api.online]);
  const openRow = useCallback((c) => nav.push('Chat', { id: c.id, to: c.with }), [nav]);
  const rowPress = useRef(new Map());
  const pressFor = (c) => {
    // stable onPress per chat so memoised rows don't re-render
    let fn = rowPress.current.get(c.id);
    if (!fn) { fn = () => openRow(c); rowPress.current.set(c.id, fn); }
    return fn;
  };
  useEffect(() => { rowPress.current.clear(); }, [state.chats]);

  // PACKAGE F: long-press a chat → menu. Stable handler per chat, like pressFor.
  const [actionsFor, setActionsFor] = useState(null);
  const longPressMap = useRef(new Map());
  const longPressFor = (c) => {
    let fn = longPressMap.current.get(c.id);
    if (!fn) { fn = () => setActionsFor(c); longPressMap.current.set(c.id, fn); }
    return fn;
  };
  const runChatAction = async (key, c) => {
    if (!c) return;
    if (key === 'manage') { nav.push('ChatInfo', { id: c.id }); return; }
    if (key === 'delete') {
      const t = deleteConfirmText(c);
      Alert.alert(t.title, t.body, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete for everyone', style: 'destructive', onPress: async () => {
          try { await deleteGroup(api, c.id); toast.show('Group deleted'); sync.refresh(); } catch (e) { toast.show(errorMessage(e, 'Couldn’t delete the group'), { tone: 'error' }); }
        } },
      ]);
      return;
    }
    try {
      if (key === 'pin') await pinChat(api, c.id, !c.pinned);
      else if (key === 'unmute') await api.request('PUT', `/conversations/${c.id}/mute`, { muted: false });
      else if (key.startsWith('mute_')) await api.request('PUT', `/conversations/${c.id}/mute`, { muted: true, duration: key.slice('mute_'.length) }); // 8h | 1w | always
      else if (key === 'hide') await hideChat(api, c.id);
      else if (key === 'leave') await api.request('POST', `/conversations/${c.id}/leave`, {});
      sync.refresh();
    } catch (e) { toast.show(errorMessage(e, 'Something went wrong'), { tone: 'error' }); }
  };

  const listHeader = (
    <View>
      <View style={styles.searchDesign}>
        <Icon name="search" size={16} color={colors.faint} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search Messages" placeholderTextColor={colors.faint} style={styles.searchInput} autoCorrect={false} accessibilityLabel="Search Messages" />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search"><Icon name="x" size={14} color={colors.muted} /></Pressable> : null}
      </View>
      {/* Prayer circles: the real group chats as horizontal cards (design .message-circles) */}
      {!term && tab === 'Chats' && myGroups.length ? (
        <>
          <SectionTitle eyebrow="Prayer circles" title="Your groups" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circleRow}>
            {myGroups.map((c) => {
              const n = unreadOf(c);
              return (
                <Tap key={c.id} onPress={pressFor(c)} style={styles.circleCard} accessibilityRole="button" accessibilityLabel={`${c.with}${n ? `, ${n} unread` : ''}`}>
                  <View style={styles.circleIcon}><Icon name="users" size={19} color={d.plum} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.circleName} numberOfLines={1}>{c.with}</Text>
                    <Text style={styles.circleMeta} numberOfLines={1}>{lastText(c) || 'No messages yet'}</Text>
                  </View>
                  {n ? <View style={styles.circleBadge}><Text style={styles.circleBadgeText}>{n > 99 ? '99+' : n}</Text></View> : null}
                </Tap>
              );
            })}
          </ScrollView>
        </>
      ) : null}
      {!term && tab === 'Chats' ? (
        <>
          <PressScale onPress={() => nav.push('BibleChat', {})} scaleTo={0.985} style={styles.listRow} accessibilityRole="button" accessibilityLabel="Bible Exegesis Chat">
            <View style={[styles.groupIcon, { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.night }]}>
              <Pulse min={0.9} max={1.1} duration={1400}><Icon name="sparkles" size={18} color={colors.goldLight} /></Pulse>
            </View>
            <View style={styles.rowMid}>
              <Text style={styles.listName}>Bible Exegesis Chat</Text>
              <Text style={styles.rowLast} numberOfLines={1}>Ask the AI Scripture companion</Text>
            </View>
          </PressScale>
          {api.online ? <View style={{ paddingHorizontal: 16 }}><CreateRow icon="users" title="Invite friends" sub="Friends who join with your link chat with you free, always" onPress={() => nav.push('InviteFriends')} /></View> : null}{/* CHAT LIMITS */}
          {direct.length ? <SectionTitle title="Recent conversations" /> : null}
        </>
      ) : null}
      {!term && tab === 'Groups' ? (
        <View style={{ paddingHorizontal: 16 }}>
          <CreateRow icon="search" title="Search groups" sub="Church groups, Bible study, prayer and fellowship by place or church" onPress={() => nav.push('SearchGroups')} />
          <CreateRow icon="users" title="New group" sub="Chat together with friends, church or a study group" onPress={() => nav.push('NewGroup', { kind: 'group' })} />
          {api.online ? <CreateRow icon="link" title="Join with a link" sub="Paste an invite link someone shared" onPress={() => nav.push('JoinGroup')} /> : null}
        </View>
      ) : null}
      {term && shown.length ? <Text style={[styles.sectionLabel, { paddingHorizontal: 16 }]}>Chats</Text> : null}
    </View>
  );
  const listFooter = term ? (
    <View style={{ paddingHorizontal: 16, paddingBottom: 90 }}>
      {term.length >= 2 ? <Text style={styles.sectionLabel}>Messages</Text> : null}
      {term.length >= 2 && !hits && api.online ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} /> : null}
      {hits && !hits.length ? <Text style={styles.hint}>No messages match “{query.trim()}”.</Text> : null}
      {(hits || []).map((h) => (
        <Pressable key={h.id} onPress={() => nav.push('Chat', { id: h.conversationId, to: h.chatTitle })} style={({ pressed }) => [styles.hitRow, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button">
          <View style={styles.rowTop}>
            <Text style={styles.listName} numberOfLines={1}>{h.chatTitle}</Text>
            <Text style={styles.rowTime}>{relTime(Date.parse(h.createdAt))}</Text>
          </View>
          <Text style={styles.rowLast} numberOfLines={2}>{h.isMe ? 'You' : h.senderName}: {h.text}</Text>
        </Pressable>
      ))}
    </View>
  ) : <View style={{ height: 90 }} />;

  return (
    <View style={k.screen}>
      {/* Design "Messages" header: back · subtitle over the Playfair title · join-by-link action */}
      <View style={{ paddingHorizontal: 18 }}>
        <PageHeader back onBack={() => nav.pop()} title="Messages" subtitle="Conversations that matter" action={<IconButton icon="link" label="Join a group with a link" onPress={() => nav.push('JoinGroup')} />} />
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <Pills items={TABS} value={tab} onChange={(t) => { setTab(t); setQuery(''); }} style={{ marginTop: 10, marginBottom: 6 }} />
        {listTab ? <ChatPassBadge /> : null}{/* CHAT WEEK PASS: "Extra chats until Tue 26 Nov" (only while a pass is active) */}
      </View>

      <ChatActionsSheet chat={actionsFor} onClose={() => setActionsFor(null)} onPick={(key, c) => runChatAction(key, c)} />
      {listTab ? (
        <FlatList
          style={styles.list}
          data={shown}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <ChatListRow c={item} myId={myId} onPress={pressFor(item)} onLongPress={longPressFor(item)} />}
          getItemLayout={(_, index) => ({ length: CHAT_ROW_HEIGHT, offset: CHAT_ROW_HEIGHT * index, index })}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          ListEmptyComponent={term ? null : tab === 'Groups'
            ? <Text style={[styles.hint, { paddingHorizontal: 16 }]}>Groups you create or are added to show up here.</Text>
            : <Empty title="No chats yet" body="Find a believer and say hello — no request needed." action="Find Believers" onAction={() => setTab('Find Believers')} />}
          initialNumToRender={14}
          maxToRenderPerBatch={12}
          windowSize={9}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={colors.primary} />}
        />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={colors.primary} />}>
          {tab === 'Communities' ? (
            <View>
              <CreateRow icon="church" title="Explore communities" sub="Join churches and study circles near you" onPress={() => nav.push('Communities')} />
              {joinedCommunities.length ? <Text style={styles.sectionLabel}>Your communities</Text> : null}
              {joinedCommunities.map((co, i) => (
                <ConversationRow
                  key={co.id}
                  index={i}
                  c={{ with: co.name, kind: 'group' }}
                  icon="church"
                  subtitle={`${(co.members || 0).toLocaleString()} members${co.region ? ` · ${co.region}` : ''}`}
                  onPress={() => nav.push('Group', { id: co.id })}
                />
              ))}
              {communityChats.length ? <Text style={styles.sectionLabel}>Community chats</Text> : null}
              {communityChats.map((c, i) => <ConversationRow key={c.id} index={i} c={c} icon="users" subtitle={`${c.communityName} · ${lastText(c) || 'No messages yet'}`} onPress={() => open(c)} />)}
              <CreateRow icon="plus" title="Create a community" sub="For your church, ministry or study group" onPress={() => nav.push('Create', { kind: 'Group' })} />
              {!joinedCommunities.length ? <Text style={styles.hint}>Communities you join show up here, each with its own channels.</Text> : null}
            </View>
          ) : null}

          {tab === 'Channels' ? (
            <View>
              <CreateRow icon="volume" title="New channel" sub="Share updates with followers — only admins post" onPress={() => nav.push('NewGroup', { kind: 'channel' })} />
              {channels.length ? <Text style={styles.sectionLabel}>Your channels</Text> : null}
              {channels.map((c, i) => <ConversationRow key={c.id} index={i} c={c} icon="volume" subtitle={`${['owner', 'admin'].includes(c.role) ? 'Admin · ' : ''}${lastText(c) || 'No posts yet'}`} onPress={() => open(c)} />)}
              {api.online ? <ChannelDirectory key={dirKey} onFollowed={() => sync.refresh && sync.refresh({ quiet: true })} /> : <Notice text="Sign in to create and follow channels." />}
            </View>
          ) : null}

          {tab === 'Find Believers' ? <FindBelievers /> : null}
        </ScrollView>
      )}

      {listTab ? (
        <Tap onPress={plus} style={styles.newMessage} accessibilityRole="button" accessibilityLabel={tab === 'Groups' ? 'New group' : 'Start a conversation'}>
          <Icon name="chat" size={17} color="#FFFFFF" strokeWidth={2.2} />
          <Text style={styles.newMessageText}>{tab === 'Groups' ? 'New group' : 'Start a conversation'}</Text>
        </Tap>
      ) : null}
    </View>
  );
}

// ---------- create a group or a channel ----------
export function NewGroupScreen({ params = {} }) {
  const isChannel = params.kind === 'channel';
  const api = useApi();
  const nav = useNav();
  const toast = useToast();
  const sync = useSync();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isChannel || !api.online) return undefined;
    const t = setTimeout(async () => {
      try { setPeople((await api.request('GET', `/people?q=${encodeURIComponent(q.trim())}`)).items || []); } catch (e) { setPeople([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, api, isChannel]);

  const toggle = (p) => setPicked((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p]));
  const create = async () => {
    if (!title.trim()) { toast.show(isChannel ? 'Give your channel a name' : 'Give your group a name', { tone: 'error' }); return; }
    setBusy(true);
    try {
      const r = isChannel
        ? await api.request('POST', '/channels', { title: title.trim(), description })
        : await api.request('POST', '/conversations/group', { title: title.trim(), description, memberIds: picked.map((p) => p.id) });
      toast.show(isChannel ? 'Channel created' : 'Group created', { icon: 'check', haptic: 'success' });
      if (sync.refresh) sync.refresh({ quiet: true });
      nav.replace('Chat', { id: r.id, to: r.title });
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t create it'), { tone: 'error', icon: 'x' });
    }
    setBusy(false);
  };

  if (!api.online) {
    return <Screen back title={isChannel ? 'New channel' : 'New group'}><Empty title="Sign in first" body="Groups and channels are shared online with other believers." /></Screen>;
  }
  return (
    <Screen back title={isChannel ? 'New channel' : 'New group'} subtitle={isChannel ? 'Only admins post · anyone can follow' : 'Everyone in the group can chat'}>
      <View style={styles.formCard}>
        <Text style={styles.label}>{isChannel ? 'Channel name' : 'Group name'}</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={80} placeholder={isChannel ? 'e.g. Daily Devotions' : 'e.g. Youth Bible Study'} placeholderTextColor={colors.faint} style={styles.input} />
        <Text style={styles.label}>Description (optional)</Text>
        <TextInput value={description} onChangeText={setDescription} maxLength={500} multiline placeholder={isChannel ? 'What will you share?' : 'What is this group about?'} placeholderTextColor={colors.faint} style={[styles.input, { minHeight: 74, textAlignVertical: 'top' }]} />
      </View>

      {!isChannel ? (
        <View>
          <Text style={styles.sectionLabel}>Add people{picked.length ? ` · ${picked.length} selected` : ''}</Text>
          {picked.length ? (
            <View style={styles.chips}>
              {picked.map((p) => (
                <Pressable key={p.id} onPress={() => toggle(p)} style={styles.chip} accessibilityLabel={`Remove ${p.displayName}`}>
                  <Text style={styles.chipText}>{p.displayName}</Text>
                  <Icon name="x" size={11} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <SearchBox value={q} onChange={setQ} placeholder="Search by name or church" />
          {people.map((p) => {
            const on = picked.some((x) => x.id === p.id);
            return (
              <PressScale key={p.id} onPress={() => toggle(p)} scaleTo={0.985} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={p.displayName}>
                <SocialAvatar name={p.displayName} uri={p.avatarUrl} size={42} />
                <View style={styles.rowMid}>
                  <Text style={styles.rowName} numberOfLines={1}>{p.displayName}</Text>
                  <Text style={styles.rowLast} numberOfLines={1}>{p.church || (p.handle ? `@${p.handle}` : 'BibleNestra member')}</Text>
                </View>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={13} color="#FFFFFF" strokeWidth={3} /> : null}</View>
              </PressScale>
            );
          })}
        </View>
      ) : null}

      <Button label={busy ? 'Creating…' : isChannel ? 'Create channel' : `Create group${picked.length ? ` with ${picked.length}` : ''}`} disabled={busy} onPress={create} style={{ marginTop: 18 }} />
      {!isChannel ? <Text style={styles.hint}>You can add more people later. You’ll be the group’s admin.</Text> : <Text style={styles.hint}>You’ll be the channel’s admin. People find it under Chats › Channels.</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 24, alignItems: 'center' },
  plus: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  // CHAT 7.3: Messages list
  list: { flex: 1, backgroundColor: 'transparent' },
  // Design Messages screen (.search-box, .message-circles, .new-message)
  searchDesign: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, marginTop: 6, marginBottom: 4, paddingHorizontal: 14, height: 48, borderRadius: 15, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  circleRow: { gap: 9, paddingHorizontal: 18, paddingBottom: 4 },
  circleCard: { minWidth: 240, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: d.line, backgroundColor: d.paper },
  circleIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: d.lavender },
  circleName: { fontFamily: 'Playfair-SemiBold', fontSize: 13, color: d.ink },
  circleMeta: { marginTop: 3, fontSize: 11, color: d.muted },
  circleBadge: { minWidth: 19, height: 19, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: d.plum },
  circleBadgeText: { fontSize: 10, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  newMessage: { position: 'absolute', right: 18, bottom: 22, height: 46, paddingHorizontal: 16, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: d.plum, shadowColor: d.plum, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  newMessageText: { fontSize: 13, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 13, height: 72, paddingHorizontal: 16 },
  listName: { flexShrink: 1, fontSize: 15.5, fontWeight: '600', color: colors.fg },
  searchMsgs: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, marginBottom: 6, paddingHorizontal: 14, height: 42, borderRadius: radius.pill, backgroundColor: colors.raised },
  headBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 18, bottom: 22, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.lg },
  hitRow: { paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  personTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  rowMid: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowName: { flexShrink: 1, fontSize: 15.5, fontWeight: '700', color: colors.fg },
  rowTime: { fontSize: 11.5, color: colors.faint },
  rowLast: { flexShrink: 1, marginTop: 2, fontSize: 13.5, color: colors.muted },
  unread: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.positive, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  groupIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  createIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.positive, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { marginTop: 18, marginBottom: 4, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.muted },
  hint: { marginTop: 12, fontSize: 12.5, lineHeight: 18, color: colors.faint },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4, paddingHorizontal: 12, height: 42, borderRadius: radius.pill, backgroundColor: colors.raised },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.fg, paddingVertical: 0 },
  formCard: { marginTop: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { marginTop: 6, marginBottom: 6, fontSize: 12.5, fontWeight: '700', color: colors.muted },
  input: { borderRadius: radius.md, backgroundColor: colors.raised, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.fg, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.positive, borderColor: colors.positive },
});
