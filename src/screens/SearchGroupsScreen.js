// PACKAGE F — Search groups (Chats). Public and listed groups by name, description, category (church, Bible study,
// prayer, fellowship…), country, city and church name. Membership sections never appear here (backend rule).
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen, Button, Empty, Notice } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp } from '../components/Motion';
import { colors } from '../theme';
import { d, df } from '../design/sanctuary';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { useApi } from '../api/auth';
import { errorMessage } from '../api/client';
import { GROUP_CATEGORIES, searchGroups, joinGroup } from '../api/groupDiscovery';

function placeOf(g) {
  return [g.city, g.country].filter(Boolean).join(', ') || null;
}

function GroupResult({ g, onJoin, onOpen, busy }) {
  const place = placeOf(g);
  const action = g.joined ? 'Open' : g.requested ? 'Requested' : g.joinPath === 'request' ? 'Request to join' : 'Join';
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.avatar}>
          {g.avatarUrl ? <Image source={{ uri: g.avatarUrl }} style={styles.avatarImg} /> : <Icon name="users" size={22} color={d.plum} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[g.category, `${g.membersCount} ${g.membersCount === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}
          </Text>
          {place || g.churchName ? (
            <Text style={styles.meta} numberOfLines={1}>{[place, g.churchName].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </View>
      </View>
      {g.description ? <Text style={styles.desc} numberOfLines={3}>{g.description}</Text> : null}
      <View style={styles.cardFoot}>
        <Text style={styles.vis}>{g.visibility === 'private' ? 'Private group' : 'Public group'}</Text>
        {g.joined
          ? <Button small kind="ghost" label="Open" onPress={() => onOpen(g)} />
          : <Button small label={busy ? 'Please wait…' : action} disabled={!!busy || g.requested} onPress={() => onJoin(g)} />}
      </View>
    </View>
  );
}

export function SearchGroupsScreen() {
  const nav = useNav();
  const api = useApi();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [church, setChurch] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!api.online) { setItems([]); return undefined; }
    const t = setTimeout(async () => {
      try {
        const r = await searchGroups(api, { q, category, country, city, church });
        setItems(r.items || []);
        setError(null);
      } catch (e) {
        setError(errorMessage(e, 'Couldn’t search groups right now'));
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, category, country, city, church, api, refreshKey]);

  const onJoin = async (g) => {
    setBusyId(g.id);
    try {
      const r = await joinGroup(api, g.id);
      if (r.status === 'member') { toast.show(`Joined ${g.name}`, { tone: 'success' }); nav.push('Chat', { id: g.id, to: g.name }); }
      else { toast.show('Request sent. An admin will let you in.'); setRefreshKey((k) => k + 1); }
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t join this group'), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen back title="Search groups" subtitle="Church, Bible study, prayer and fellowship groups">
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Group name, description or church" placeholderTextColor={colors.faint} style={styles.input} autoCorrect={false} accessibilityLabel="Search groups" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {GROUP_CATEGORIES.map((c) => {
          const on = category === c;
          return (
            <Pressable key={c} onPress={() => setCategory(on ? '' : c)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.row}>
        <TextInput value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={colors.faint} style={[styles.input, styles.half]} accessibilityLabel="Country" />
        <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={colors.faint} style={[styles.input, styles.half]} accessibilityLabel="City" />
      </View>
      <TextInput value={church} onChangeText={setChurch} placeholder="Church name" placeholderTextColor={colors.faint} style={[styles.input, styles.full]} accessibilityLabel="Church name" />

      {!api.online ? <Notice tint={colors.negative} text="Group search needs a connection." /> : null}
      {error ? <Notice tint={colors.negative} text={error} /> : null}
      {items === null && !error ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : null}
      {items && !items.length && !error ? (
        <Empty title="No groups found" body="Try another name, category, city or church. Groups appear here once their admins list them." />
      ) : null}
      {(items || []).map((g, i) => (
        <FadeInUp key={g.id} index={i} distance={8} duration={260}>
          <GroupResult g={g} busy={busyId === g.id} onJoin={onJoin} onOpen={(x) => nav.push('Chat', { id: x.id, to: x.name })} />
        </FadeInUp>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: d.line },
  input: { flex: 1, minHeight: 44, fontSize: 15, fontFamily: df.sans, color: d.ink, paddingHorizontal: 6 },
  row: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 8 },
  half: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: d.line, paddingHorizontal: 12 },
  full: { marginHorizontal: 16, marginTop: 8, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: d.line, paddingHorizontal: 12 },
  chips: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: d.line },
  chipOn: { backgroundColor: d.plum, borderColor: d.plum },
  chipText: { fontSize: 13, fontFamily: df.sans, color: d.ink },
  chipTextOn: { color: '#FFFFFF' },
  card: { marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: d.line, gap: 10 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: d.lavender, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 52, height: 52 },
  name: { fontSize: 16, fontFamily: df.display, color: d.ink },
  meta: { marginTop: 2, fontSize: 12.5, fontFamily: df.sans, color: d.muted },
  desc: { fontSize: 13.5, fontFamily: df.sans, color: d.ink, lineHeight: 19 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vis: { fontSize: 12, fontFamily: df.sans, color: d.muted },
  loading: { padding: 32, alignItems: 'center' },
});
