// PACKAGE F — "Search groups" listing for group admins (Group Info → Group settings). Sets whether the group shows in
// Search groups, whether it is public or private, and its category, country, city and church name.
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '../ui';
import { colors } from '../../theme';
import { d, df } from '../../design/sanctuary';
import { useApi } from '../../api/auth';
import { useToast } from '../Toast';
import { errorMessage } from '../../api/client';
import { GROUP_CATEGORIES, updateListing } from '../../api/groupDiscovery';

export function GroupListingEditor({ convId, listing, onSaved }) {
  const api = useApi();
  const toast = useToast();
  const start = listing || {};
  const [listed, setListed] = useState(!!start.listed);
  const [visibility, setVisibility] = useState(start.visibility || 'private');
  const [category, setCategory] = useState(start.category || '');
  const [country, setCountry] = useState(start.country || '');
  const [city, setCity] = useState(start.city || '');
  const [churchName, setChurchName] = useState(start.churchName || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await updateListing(api, convId, { listed, visibility, category, country, city, churchName });
      onSaved && onSaved(r.listing);
      toast.show('Search listing saved');
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t save the listing'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Show in Search groups</Text>
          <Text style={styles.sub}>People can find this group by name, category, country, city or church</Text>
        </View>
        <Switch value={listed} onValueChange={setListed} trackColor={{ true: colors.primary }} />
      </View>
      <Text style={styles.label}>Who can join</Text>
      <View style={styles.pills}>
        {[['public', 'Public: join straight away'], ['private', 'Private: people request to join']].map(([v, t]) => (
          <Pressable key={v} onPress={() => setVisibility(v)} style={[styles.pill, visibility === v && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: visibility === v }}>
            <Text style={[styles.pillText, visibility === v && styles.pillTextOn]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {GROUP_CATEGORIES.map((c) => (
          <Pressable key={c} onPress={() => setCategory(category === c ? '' : c)} style={[styles.pill, category === c && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: category === c }}>
            <Text style={[styles.pillText, category === c && styles.pillTextOn]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="Country" />
      <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="City" />
      <TextInput value={churchName} onChangeText={setChurchName} placeholder="Church name (optional)" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="Church name" />
      <View style={{ marginTop: 10 }}>
        <Button small label={busy ? 'Saving…' : 'Save listing'} disabled={busy} onPress={save} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 14, fontFamily: df.sansBold, color: d.ink },
  sub: { marginTop: 2, fontSize: 12.5, fontFamily: df.sans, color: d.muted },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: d.line, backgroundColor: colors.surface },
  pillOn: { backgroundColor: d.plum, borderColor: d.plum },
  pillText: { fontSize: 12.5, fontFamily: df.sans, color: d.ink },
  pillTextOn: { color: '#FFFFFF' },
  input: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: d.line, backgroundColor: colors.surface, paddingHorizontal: 12, fontSize: 15, fontFamily: df.sans, color: d.ink },
});
