// USER SEARCH (Socials header › search icon): find a member by username. Exact username match first, then partial
// suggestions. Tap a row for a profile preview with Open profile and Message. Server: GET /people (lib: conversations.js).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNav } from '../navigation';
import { useApi } from '../api/auth';
import { useToast } from '../components/Toast';
import { errorMessage } from '../api/client';
import { DScreen, DInput, DCard, DButton } from '../design/profile/parts';
import { d, df } from '../design/sanctuary';
import { SocialAvatar } from '../components/social/FeedCard';
import { Empty } from '../components/ui';
import { useOpenProfile } from '../components/social/profileNav';

const cleanTerm = (s) => String(s || '').trim().replace(/^@+/, '').trim();

export function UserSearchScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const openProfile = useOpenProfile();
  const [text, setText] = useState('');
  const [state, setState] = useState({ loading: false, items: [], error: null, term: '' });
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const term = cleanTerm(text);
  useEffect(() => {
    setSelected(null);
    if (!term) { setState({ loading: false, items: [], error: null, term: '' }); return undefined; }
    if (!api.online) { setState({ loading: false, items: [], error: 'Sign in to search members', term }); return undefined; }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, term }));
    const t = setTimeout(() => {
      api.request('GET', `/people?q=${encodeURIComponent(term)}`)
        .then((r) => { if (mine === seq.current) setState({ loading: false, items: (r && r.items) || [], error: null, term }); })
        .catch((e) => { if (mine === seq.current) setState({ loading: false, items: [], error: errorMessage(e, 'Search failed'), term }); });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, api.online]);

  // exact username first (matchRank 0 from the server), then the partial matches in server order
  const exact = state.items.filter((p) => p.matchRank === 0 || (p.handle && p.handle.toLowerCase() === term.toLowerCase()));
  const partial = state.items.filter((p) => !exact.includes(p));

  const message = async (p) => {
    if (!api.online) return;
    setBusy(true);
    try {
      const r = await api.request('POST', '/conversations/dm', { userId: p.id });
      nav.push('Chat', { id: r.id, to: p.displayName, userId: p.id });
    } catch (e) {
      if (e && e.code === 'CHAT_LIMIT_REACHED') return; // the upgrade prompt opens instead of a toast
      toast.show(errorMessage(e, 'Couldn’t open the chat'), { tone: 'error', icon: 'x' });
    } finally { setBusy(false); }
  };

  const row = (p, key) => (
    <Pressable key={key} onPress={() => setSelected(p)} accessibilityRole="button" accessibilityLabel={`${p.displayName}, @${p.handle}`} style={[s.row, selected && selected.id === p.id && s.rowOn]}>
      <SocialAvatar name={p.displayName} uri={p.avatarUrl} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>{p.displayName || 'Believer'}</Text>
        <Text style={s.handle} numberOfLines={1}>{p.handle ? `@${p.handle}` : ' '}</Text>
      </View>
    </Pressable>
  );

  let results;
  if (!term) results = <Empty title="Find a member" body="Type a username, for example @grace. Exact matches show first." />;
  else if (state.loading && !state.items.length) results = <ActivityIndicator style={{ marginTop: 28 }} color={d.plum} />;
  else if (state.error) results = <Empty title="Couldn’t search" body={state.error} />;
  else if (!state.items.length) results = <Empty title="No members found" body={`Nobody matches “${term}” yet. Check the spelling of the username.`} />;
  else results = (
    <>
      {exact.length ? <Text style={s.label}>Exact match</Text> : null}
      {exact.map((p) => row(p, 'e' + p.id))}
      {partial.length ? <Text style={s.label}>{exact.length ? 'Similar members' : 'Suggestions'}</Text> : null}
      {partial.map((p) => row(p, 'p' + p.id))}
    </>
  );

  const preview = selected ? (
    <DCard style={{ marginTop: 14 }}>
      <View style={s.previewHead}>
        <SocialAvatar name={selected.displayName} uri={selected.avatarUrl} size={64} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.previewName} numberOfLines={1}>{selected.displayName || 'Believer'}</Text>
          <Text style={s.handle} numberOfLines={1}>{selected.handle ? `@${selected.handle}` : ''}</Text>
          {selected.church ? <Text style={s.meta} numberOfLines={1}>{selected.church}</Text> : null}
        </View>
      </View>
      {selected.bio || selected.headline ? <Text style={s.bio} numberOfLines={3}>{selected.bio || selected.headline}</Text> : null}
      <View style={s.actions}>
        <DButton small style={{ flex: 1 }} label="Open profile" onPress={() => openProfile({ userId: selected.id, name: selected.displayName, handle: selected.handle })} />
        <DButton small style={{ flex: 1 }} label={busy ? 'Opening…' : 'Message'} disabled={busy || !api.online} onPress={() => message(selected)} />
      </View>
    </DCard>
  ) : null;

  return (
    <DScreen back onBack={() => nav.pop()} title="Find members" subtitle="Search by username">
      <DInput placeholder="@username" autoCapitalize="none" autoCorrect={false} value={text} onChangeText={setText} returnKeyType="search" accessibilityLabel="Username" />
      {preview}
      <View style={{ marginTop: 12 }}>{results}</View>
    </DScreen>
  );
}

const s = StyleSheet.create({
  label: { fontFamily: df.sansSemi, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: d.muted, marginTop: 10, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14 },
  rowOn: { backgroundColor: d.lavender },
  name: { fontFamily: df.sansSemi, fontSize: 15, color: d.ink },
  handle: { fontFamily: df.sans, fontSize: 13, color: d.muted, marginTop: 2 },
  meta: { fontFamily: df.sans, fontSize: 12, color: d.muted, marginTop: 2 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  previewName: { fontFamily: df.display, fontSize: 19, color: d.ink },
  bio: { fontFamily: df.sans, fontSize: 14, color: d.ink, marginTop: 12, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
