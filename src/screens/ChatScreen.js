// CHAT 7.3 — one conversation (direct chat, group or channel). Opens instantly from the on-device cache, then merges
// the server page. Virtualised thread (components/chat/ChatThread), optimistic sends with automatic retry and
// "tap to retry", ticks, typing, online / last seen, swipe-to-reply, reactions, forward, copy, edit, pin, delete,
// in-chat search, photos / videos / documents / voice notes with upload progress, @mentions in groups.
// Tap the header → contact or Group Info (screens/ChatInfoScreen.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Button, Empty, Notice, Badge } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, ScaleIn } from '../components/Motion';
import { SocialAvatar } from '../components/social/FeedCard';
import AskBar from '../components/AskBar';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav, useIsFocused } from '../navigation';
import { useToast } from '../components/Toast';
import { useSync } from '../api/sync';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { pickPhotos, pickAudio } from '../api/media';
import { uploadChatImage, uploadChatAudio, uploadChatFile, pickChatFile, sendChatCoins, downloadChatFile, MAX_CHAT_AUDIO } from '../api/chatMedia';
import { PinnedBar, useMessageActions } from '../components/chat/MessageKit';
import { ChatThread } from '../components/chat/ChatThread';
import { Composer } from '../components/chat/Composer';
import {
  AttachTray, AudioBubble, ChatImage, CoinGiftSheet, GiftCard, MeetJoin, MeetPrompt, RecorderBar, useVoiceRecorder,
  FileBubble, VideoBubble, UploadBubble, ChatMediaViewer, ForwardSheet, isPdf,
} from '../chat/ChatExtras';
import { useThreadLoader } from '../chat/useThread';
import { useTypingNames, useReceipts, usePresence, usePerms } from '../chat/live';
import { dmScope, isServerId, mapServerMessage, fmtClock, presenceLabel, typingLabel } from '../chat/messages';
import { PEOPLE } from '../data/seed';

const newLocalId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function TopBar({ title, subtitle, subtitleTint, avatar, onBack, onTitle, right }) {
  return (
    <View style={styles.top}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.topBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke={colors.fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </Pressable>
      <Pressable onPress={onTitle} style={styles.topMid} accessibilityRole="button" accessibilityLabel={`${title}. Open info`}>
        {avatar}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[styles.topSub, subtitleTint && { color: subtitleTint }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </Pressable>
      <View style={styles.topRight}>{right}</View>
    </View>
  );
}

function IconBtn({ name, label, onPress, active }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[styles.topBtn, active && { backgroundColor: colors.primarySoft }]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={name} size={18} color={active ? colors.primary : colors.fg} />
    </Pressable>
  );
}

export function ChatScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const sync = useSync();
  const api = useApi();
  const focused = useIsFocused();
  let chat = (state.chats || []).find((c) => c.id === params.id) || (!params.id ? (state.chats || []).find((c) => c.with === params.to) : null);
  if (!chat && params.id && isServerId(params.id)) {
    chat = { id: params.id, with: params.to || 'Direct message', type: 'Direct message', kind: params.kind === 'group' ? 'group' : undefined, messages: [] };
  }
  const convId = chat && isServerId(chat.id) ? chat.id : null;
  const scope = dmScope(chat ? chat.id : 'none');
  const { myRole: loadedRole, cursor, setCursor } = useThreadLoader(scope, convId);
  const receipts = useReceipts(convId);
  const typingNames = useTypingNames(convId);
  const presence = usePresence(convId);
  const perms = usePerms(convId);
  const role = (perms && perms.myRole) || loadedRole || (chat && chat.role) || 'member';
  const isChannel = !!chat && chat.kind === 'channel';
  const isGroup = !!chat && (chat.kind === 'group' || isChannel);
  const permissions = perms && perms.permissions;
  const canMessage = permissions ? permissions.canSend : !chat || chat.canMessage !== false;
  const isMod = permissions ? permissions.isModerator : ['owner', 'admin', 'moderator'].includes(role);
  const online = !!sync.online && !!convId;
  const mediaOk = !!api.online && !!convId && canMessage;

  const threadRef = useRef(null);
  const [forwarding, setForwarding] = useState(null);
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState('');
  const [hit, setHit] = useState(0);
  const [tray, setTray] = useState(false);
  const [meetOpen, setMeetOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [members, setMembers] = useState(null);
  const recorder = useVoiceRecorder({ onError: (msg) => toast.show(msg, { tone: 'error' }) });

  // ---------- sending ----------
  const upsert = useCallback((message, localId) => dispatch({ type: 'msgUpsert', scope, message, localId, local: true }), [scope]);
  const onSend = useCallback((text, reply, extra = {}) => {
    if (!chat) return;
    if (online && sync.retrySend) {
      const id = newLocalId();
      const now = Date.now();
      upsert({ id, from: (state.user && state.user.displayName) || 'You', mine: true, createdAt: now, time: fmtClock(now), text, reply: reply || null, mentions: extra.mentions && extra.mentions.length ? extra.mentions : undefined, status: 'sending', kind: 'text' });
      sync.retrySend(scope, id); // optimistic: the bubble shows now, the server copy replaces it
      if (threadRef.current) threadRef.current.scrollToBottom();
      return;
    }
    dispatch({ type: 'dm', cid: chat.id, with: chat.with || params.to, text, reply, localId: newLocalId() });
  }, [chat && chat.id, online, scope, state.user && state.user.displayName]);

  const actions = useMessageActions({
    scope,
    isGroup,
    canPin: !isGroup || isMod || !sync.online,
    canModerate: isMod,
    onSend,
    scrollToId: (id) => !!threadRef.current && threadRef.current.scrollToMessage(id),
    onForward: online ? (m) => (isServerId(m.id) ? setForwarding(m) : toast.show('Wait until it’s sent', { icon: 'clock' })) : undefined,
  });

  // optimistic media: a bubble with upload progress first, then the real message replaces it
  const sendMedia = async ({ label, upload, body, preview }) => {
    const id = newLocalId();
    const now = Date.now();
    const base = { id, from: 'You', mine: true, createdAt: now, time: fmtClock(now), text: '', status: 'sending', uploading: { label, progress: 0 }, ...(preview || {}) };
    upsert(base);
    if (threadRef.current) threadRef.current.scrollToBottom();
    try {
      const up = await upload((p) => upsert({ ...base, uploading: { label, progress: p } }, id));
      const res = await api.request('POST', `/conversations/${convId}/messages`, { ...body(up), clientId: id });
      upsert(mapServerMessage(res), id);
    } catch (e) {
      upsert({ ...base, status: 'failed', uploading: { label, progress: 0, failed: true } }, id);
      if (!(e && e.code === 'CHAT_LIMIT_REACHED')) toast.show(errorMessage(e, 'Couldn’t send that'), { tone: 'error' });
    }
  };
  const needOnline = () => toast.show(canMessage ? 'Photos, files, voice notes and gifts need you to be signed in online' : 'You can’t send messages here', { icon: 'lock' });
  const sendPhotos = async () => {
    if (!mediaOk) return needOnline();
    let photos;
    try { photos = await pickPhotos(4); } catch (e) { toast.show(errorMessage(e, 'Couldn’t open your photos'), { tone: 'error' }); return; }
    for (const p of photos || []) {
      // eslint-disable-next-line no-await-in-loop
      await sendMedia({ label: 'Photo', upload: async (prog) => { prog(0.3); const up = await uploadChatImage(api.request, convId, p); prog(1); return up; }, body: (up) => ({ kind: 'image', mediaKey: up.key, meta: { width: up.width || 0, height: up.height || 0 } }) });
    }
  };
  const sendFile = async (video) => {
    if (!mediaOk) return needOnline();
    let f;
    try { f = await pickChatFile({ video }); } catch (e) { toast.show(errorMessage(e, 'Couldn’t open your files'), { tone: 'error' }); return; }
    if (!f) return;
    const isVid = /^video\//.test(f.mimeType || '');
    await sendMedia({
      label: f.name,
      upload: (prog) => uploadChatFile(api.request, convId, f, prog),
      body: (up) => ({ kind: up.kind === 'video' ? 'video' : 'file', mediaKey: up.key, meta: { name: up.name || f.name, mime: up.mime || f.mimeType, size: up.size || f.size } }),
      preview: isVid ? {} : {},
    });
  };
  const sendAudioFile = async () => {
    if (!mediaOk) return needOnline();
    let a;
    try { a = await pickAudio(); } catch (e) { toast.show(errorMessage(e, 'Couldn’t open your files'), { tone: 'error' }); return; }
    if (!a) return;
    if (a.size && a.size > MAX_CHAT_AUDIO) { toast.show('Audio files can be up to 20 MB', { tone: 'error' }); return; }
    await sendMedia({ label: a.name || 'Audio', upload: async (prog) => { prog(0.3); const up = await uploadChatAudio(api.request, convId, { ...a, isFile: true }); prog(1); return up; }, body: (up) => ({ kind: 'voice', mediaKey: up.key, meta: { file: true, name: String(a.name || 'Audio').slice(0, 120) } }) });
  };
  const startVoice = async () => { if (!mediaOk) return needOnline(); await recorder.start(); };
  const finishVoice = async () => {
    const clip = await recorder.stop(true);
    if (!clip) return;
    await sendMedia({ label: 'Voice note', upload: async (prog) => { prog(0.3); const up = await uploadChatAudio(api.request, convId, clip); prog(1); return up; }, body: (up) => ({ kind: 'voice', mediaKey: up.key, meta: { durationMs: Math.round(clip.durationMs) } }) });
  };
  const sendCoins = async (coins, note) => {
    try {
      const res = await sendChatCoins(api.request, chat.id, { coins, note });
      dispatch({ type: 'serverSync', patch: { coins: res.coinsRemaining }, local: true });
      if (res.message) upsert(mapServerMessage(res.message));
      toast.show(`🎁 Sent ${coins} coin${coins === 1 ? '' : 's'} to ${chat.with}`, { icon: 'gift', haptic: 'success' });
      return true;
    } catch (e) { toast.show(errorMessage(e, 'Couldn’t send coins'), { tone: 'error' }); return false; }
  };
  const shareMeet = (link) => onSend(`📹 Join my video call: ${link}`, null, {});

  // ---------- reading, typing, members ----------
  const msgs = (chat && chat.messages) || [];
  const lastId = msgs.length ? msgs[msgs.length - 1].id : null;
  useEffect(() => {
    if (!focused || !convId || !lastId || !sync.markChatRead) return undefined;
    const t = setTimeout(() => sync.markChatRead(convId), 600); // new messages while the chat is open are read
    if (chat && (chat.unread || chat.unreadCount)) dispatch({ type: 'set', patch: { chats: (state.chats || []).map((c) => (c.id === chat.id ? { ...c, unread: 0, unreadCount: 0 } : c)) }, local: true });
    return () => clearTimeout(t);
  }, [focused, convId, lastId]);
  const onTyping = useCallback((on) => { if (convId && sync.sendTyping) sync.sendTyping(convId, on); }, [convId]);
  useEffect(() => {
    if (!online || !isGroup || isChannel) return;
    api.request('GET', `/conversations/${convId}/members`).then((r) => setMembers((r.items || []).filter((m) => !m.isMe))).catch(() => {});
  }, [online, convId, isGroup]);

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder || !sync.loadOlder) return;
    setLoadingOlder(true);
    try { const r = await sync.loadOlder(scope, convId, cursor); setCursor(r.cursor); } catch (e) { /* try again on the next scroll */ }
    setLoadingOlder(false);
  }, [cursor, loadingOlder, scope, convId]);

  // ---------- in-chat search ----------
  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!searching || t.length < 2) return [];
    return msgs.filter((m) => !m.deleted && !m.system && ((m.text || '').toLowerCase().includes(t) || (m.file && m.file.name.toLowerCase().includes(t)))).map((m) => m.id).reverse();
  }, [searching, term, msgs]);
  useEffect(() => { setHit(0); }, [term]);
  useEffect(() => { if (matches.length) actions.jumpTo(matches[Math.min(hit, matches.length - 1)]); }, [matches.length, hit]);

  // ---------- message content (memoised so rows don't re-render) ----------
  const request = api.request;
  const renderContent = useCallback((m) => {
    if (m.uploading) return <UploadBubble upload={m.uploading} mine={m.mine} />;
    return (
      <>
        {m.image ? <ChatImage image={m.image} request={request} onOpen={() => setViewer({ kind: 'image', key: m.image.key, name: 'Photo' })} /> : null}
        {m.video ? <VideoBubble video={m.video} onOpen={() => setViewer({ kind: 'video', key: m.video.key, name: m.video.name })} /> : null}
        {m.file ? (
          <FileBubble
            file={m.file}
            mine={m.mine}
            onOpen={() => setViewer({ kind: isPdf(m.file) ? 'pdf' : 'file', key: m.file.key, name: m.file.name, mime: m.file.mime })}
            onDownload={() => downloadChatFile(request, m.file.key, m.file.name).catch(() => {})}
          />
        ) : null}
        {m.voice ? <AudioBubble voice={m.voice} request={request} mine={m.mine} /> : null}
        {m.gift ? <GiftCard gift={m.gift} mine={m.mine} from={m.from} /> : null}
        {m.text && !m.gift ? <MeetJoin text={m.text} mine={m.mine} /> : null}
      </>
    );
  }, [request]);
  const retry = useCallback((m) => {
    if (m.uploading) { toast.show('Pick the file again to resend it', { icon: 'clock' }); return; }
    if (sync.retrySend) sync.retrySend(scope, m.id);
  }, [scope]);

  // ---------- new conversation (offline / not yet created) ----------
  if (!chat && params.to) {
    return (
      <Screen back title={params.to} subtitle="New conversation" scroll={false}>
        <View style={styles.newHero}>
          <ScaleIn from={0.6}><SocialAvatar name={params.to} size={64} ring /></ScaleIn>
          <FadeInUp delay={120} distance={8} style={{ alignItems: 'center', gap: 8 }}>
            <Text style={styles.newTitle}>{params.to}</Text>
            {params.kind ? <Badge label={params.kind} tint={colors.primary} /> : null}
          </FadeInUp>
        </View>
        <Notice tint={colors.teal} text="Direct messaging is private and respectful. You can block or report at any time." />
        <View style={{ flex: 1 }} />
        <View style={{ paddingBottom: 10 }}>
          <AskBar placeholder="Say hello..." onSend={(t) => { dispatch({ type: 'newChat', name: params.to, kind: params.kind, text: t, id: params.id, cid: params.id, userId: params.userId }); toast.show(`Message sent to ${params.to}`, { icon: 'chat' }); nav.replace('Chat', { id: params.id, to: params.to, userId: params.userId }); }} />
        </View>
      </Screen>
    );
  }
  if (!chat) return <Screen back title="Chat"><Empty title="Conversation not found" body="It may have been deleted or the link is out of date." action="All chats" onAction={() => nav.replace('ChatList')} /></Screen>;

  // ---------- header ----------
  const muted = online ? !!chat.muted : (state.mutedChats || []).includes(chat.id);
  const typingText = typingLabel(typingNames, isGroup);
  const subtitle = typingText
    || (isGroup ? `${chat.membersCount ? `${chat.membersCount} ${isChannel ? 'followers' : 'members'}` : isChannel ? 'Channel' : 'Group'}${muted ? ' · Muted' : ''}` : (presenceLabel(presence) || (muted ? 'Muted' : 'Tap for contact info')));
  const openInfo = () => (convId ? nav.push('ChatInfo', { id: convId, to: chat.with }) : toast.show('Sign in to see chat info', { icon: 'lock' }));
  const toggleMute = async () => {
    setMenu(false);
    if (online) {
      try {
        await api.request('PUT', `/conversations/${convId}/mute`, { muted: !muted });
        dispatch({ type: 'set', patch: { chats: (state.chats || []).map((c) => (c.id === chat.id ? { ...c, muted: !muted } : c)) }, local: true });
      } catch (e) { toast.show(errorMessage(e, 'Couldn’t change notifications'), { tone: 'error' }); return; }
    } else {
      const list = state.mutedChats || [];
      dispatch({ type: 'set', patch: { mutedChats: muted ? list.filter((x) => x !== chat.id) : [...list, chat.id] } });
    }
    toast.show(muted ? 'Notifications on' : `${chat.with} muted · @mentions still notify you`, { icon: muted ? 'bell' : 'volume' });
  };
  const person = PEOPLE.find((p) => p.name === chat.with);
  const menuItems = [
    { label: isGroup ? (isChannel ? 'Channel info' : 'Group info') : 'Contact info', onPress: () => { setMenu(false); openInfo(); } },
    { label: 'Search in chat', onPress: () => { setMenu(false); setSearching(true); } },
    { label: muted ? 'Unmute notifications' : 'Mute notifications', onPress: toggleMute },
    { label: 'Start a video call', onPress: () => { setMenu(false); setMeetOpen(true); } },
    ...(!isGroup ? [{
      label: 'Block', danger: true,
      onPress: async () => {
        setMenu(false);
        const uid = chat.otherUser && chat.otherUser.id;
        if (online && uid) { try { await api.request('POST', `/users/${uid}/block`); } catch (e) { toast.show(errorMessage(e, 'Couldn’t block'), { tone: 'error' }); return; } }
        if (person) dispatch({ type: 'block', id: person.id });
        toast.show(`${chat.with} is blocked`, { icon: 'shield' });
        nav.pop();
      },
    }] : []),
    { label: isGroup ? 'Report group' : 'Report', danger: true, onPress: async () => { setMenu(false); if (online) await api.request('POST', `/conversations/${convId}/report`, { reason: 'Reported from chat' }).catch(() => {}); toast.show('Report sent · our safety team will review it', { icon: 'shield' }); } },
  ];

  const avatar = isGroup
    ? (chat.avatarUrl ? <SocialAvatar name={chat.with} uri={chat.avatarUrl} size={36} /> : <View style={[styles.groupAv, isChannel && { backgroundColor: colors.cardGold }]}><Icon name={isChannel ? 'volume' : 'users'} size={17} color={isChannel ? colors.gold : colors.primary} /></View>)
    : (
      <View>
        <SocialAvatar name={chat.with} uri={chat.otherUser && chat.otherUser.avatarUrl} size={36} />
        {presence && presence.online ? <View style={styles.onlineDot} /> : null}
      </View>
    );

  return (
    <View style={styles.screen}>
      <TopBar
        title={chat.with}
        subtitle={subtitle}
        subtitleTint={typingText || (presence && presence.online && !isGroup) ? colors.positive || colors.primary : null}
        avatar={avatar}
        onBack={() => nav.pop()}
        onTitle={openInfo}
        right={(
          <>
            <IconBtn name="search" label="Search in chat" active={searching} onPress={() => { setSearching(!searching); setTerm(''); }} />
            <IconBtn name="more" label="Chat options" active={menu} onPress={() => setMenu(!menu)} />
          </>
        )}
      />
      {searching ? (
        <View style={styles.searchBar}>
          <Icon name="search" size={15} color={colors.muted} />
          <TextInput autoFocus value={term} onChangeText={setTerm} placeholder="Search this chat" placeholderTextColor={colors.faint} style={styles.searchInput} accessibilityLabel="Search this chat" />
          <Text style={styles.searchCount}>{term.trim().length >= 2 ? (matches.length ? `${Math.min(hit, matches.length - 1) + 1}/${matches.length}` : '0') : ''}</Text>
          <Pressable onPress={() => setHit((h) => Math.min(h + 1, Math.max(0, matches.length - 1)))} disabled={!matches.length} hitSlop={6} accessibilityLabel="Older match"><Icon name="chevron-up" size={18} color={matches.length ? colors.fg : colors.faint} /></Pressable>
          <Pressable onPress={() => setHit((h) => Math.max(0, h - 1))} disabled={!matches.length} hitSlop={6} accessibilityLabel="Newer match"><Icon name="chevron-down" size={18} color={matches.length ? colors.fg : colors.faint} /></Pressable>
          <Pressable onPress={() => { setSearching(false); setTerm(''); }} hitSlop={6} accessibilityLabel="Close search"><Icon name="x" size={16} color={colors.muted} /></Pressable>
        </View>
      ) : null}
      {menu ? (
        <FadeInUp distance={-8} duration={200} style={styles.menu}>
          {menuItems.map((o) => (
            <Pressable key={o.label} onPress={o.onPress} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.raised }]} accessibilityRole="button">
              <Text style={[styles.menuText, o.danger && { color: colors.negative || colors.rose }]}>{o.label}</Text>
            </Pressable>
          ))}
        </FadeInUp>
      ) : null}
      <PinnedBar pins={actions.pins} onOpen={(p) => actions.jumpTo(p.id)} />
      <ChatThread
        ref={threadRef}
        messages={msgs}
        isGroup={isGroup}
        online={online}
        receipts={receipts}
        typingNames={typingNames}
        highlight={actions.highlight}
        loadingOlder={loadingOlder}
        onLoadOlder={cursor ? loadOlder : undefined}
        header={(
          <View style={{ alignItems: 'center', paddingVertical: 10, gap: 8 }}>
            <View style={styles.encrypt}>
              <Icon name="lock" size={11} color={colors.muted} />
              <Text style={styles.encryptText}>{isChannel ? 'Channel · only admins post' : isGroup ? 'Group chat · visible to its members' : 'Private chat · only the two of you see it'}</Text>
            </View>
            {!msgs.length ? <Empty title="No messages yet" body={canMessage ? `Say hello to ${chat.with}.` : null} /> : null}
            {msgs.length && actions.tipVisible ? <Text style={styles.tip}>Tip: swipe right on a message to reply · press and hold to react, forward, copy, edit, pin or delete.</Text> : null}
          </View>
        )}
        onLongPress={actions.open}
        onReact={actions.react}
        onOpenReply={actions.jumpTo}
        onSwipeReply={canMessage ? actions.reply : undefined}
        onRetry={retry}
        renderContent={renderContent}
      />
      {canMessage ? (
        <View style={styles.composerWrap}>
          {actions.banner}
          {recorder.recording ? (
            <RecorderBar ms={recorder.ms} onCancel={() => recorder.stop(false)} onSend={finishVoice} />
          ) : (
            <Composer
              placeholder={actions.editing ? 'Edit your message' : 'Message'}
              onSend={actions.composer.onSend}
              prefill={actions.composer.prefill}
              prefillKey={actions.composer.prefillKey}
              focusKey={actions.composer.focusKey}
              sendLabel={actions.composer.sendLabel}
              onAttach={actions.editing ? undefined : () => setTray(true)}
              onMic={actions.editing ? undefined : startVoice}
              micEnabled={mediaOk}
              onTyping={onTyping}
              members={members}
            />
          )}
        </View>
      ) : (
        <View style={styles.locked}>
          <Icon name={isChannel ? 'volume' : 'lock'} size={18} color={colors.primary} />
          <Text style={styles.lockedText}>{isChannel ? 'Only admins can post in this channel. You’ll see every new post here.' : 'Only admins can send messages in this group.'}</Text>
        </View>
      )}
      {actions.sheet}
      <AttachTray
        visible={tray}
        onClose={() => setTray(false)}
        items={[
          { label: 'Photo', icon: 'image', tint: colors.sky, disabled: !mediaOk, onPress: sendPhotos },
          { label: 'Video', icon: 'video', tint: colors.terracotta, disabled: !mediaOk, onPress: () => sendFile(true) },
          { label: 'Document', icon: 'book', tint: colors.primary, disabled: !mediaOk, onPress: () => sendFile(false) },
          { label: 'Voice message', icon: 'mic', tint: colors.rose, disabled: !mediaOk, onPress: startVoice },
          { label: 'Audio file', icon: 'music', tint: colors.lavender, disabled: !mediaOk, onPress: sendAudioFile },
          { label: 'Video call', icon: 'live', tint: colors.teal, onPress: () => setMeetOpen(true) },
          ...(!isGroup ? [{ label: 'Gift coins', icon: 'gift', tint: colors.gold, disabled: !mediaOk, onPress: () => (mediaOk ? setGiftOpen(true) : needOnline()) }] : []),
        ]}
      />
      <MeetPrompt visible={meetOpen} onClose={() => setMeetOpen(false)} onShare={shareMeet} />
      <CoinGiftSheet visible={giftOpen} name={chat.with} balance={state.coins || 0} onClose={() => setGiftOpen(false)} onSend={sendCoins} onEarn={() => nav.push('Learn', { tab: 'Games' })} />
      <ChatMediaViewer item={viewer} request={api.request} onClose={() => setViewer(null)} />
      <ForwardSheet
        message={forwarding}
        chats={state.chats}
        request={api.request}
        onClose={() => setForwarding(null)}
        onDone={(results, e) => {
          if (!results) { toast.show(errorMessage(e, 'Couldn’t forward'), { tone: 'error' }); return; }
          const ok = results.filter((r) => r.ok);
          ok.forEach((r) => dispatch({ type: 'msgUpsert', scope: dmScope(r.conversationId), message: mapServerMessage(r.message), local: true }));
          toast.show(ok.length === results.length ? `Forwarded to ${ok.length} chat${ok.length === 1 ? '' : 's'}` : `Forwarded to ${ok.length} of ${results.length}`, { icon: 'check' });
        }}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screen },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 60, paddingHorizontal: 8, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  topBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  topMid: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  topRight: { flexDirection: 'row', alignItems: 'center' },
  topTitle: { fontSize: 16, fontWeight: '600', color: colors.fg },
  topSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  groupAv: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  onlineDot: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.positive || '#2FA36B', borderWidth: 2, borderColor: colors.surface },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.fg, paddingVertical: 4, outlineStyle: 'none' },
  searchCount: { fontSize: 12, color: colors.muted, minWidth: 30, textAlign: 'right' },
  menu: { position: 'absolute', top: 58, right: 10, zIndex: 20, minWidth: 220, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 6, ...shadow.lg },
  menuRow: { paddingVertical: 11, paddingHorizontal: 16 },
  menuText: { fontSize: 14.5, color: colors.fg },
  encrypt: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.raised },
  encryptText: { fontSize: 11.5, color: colors.muted },
  tip: { fontSize: 12, color: colors.faint, textAlign: 'center', paddingHorizontal: 20 },
  composerWrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 6, backgroundColor: colors.screen },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  lockedText: { flex: 1, fontSize: 13.5, color: colors.muted },
  newHero: { alignItems: 'center', gap: 12, paddingVertical: 28 },
  newTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg },
});
