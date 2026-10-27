import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen, Section, Row, Pills, Button, Input, Tag, Badge, Notice, Empty } from '../components/ui';
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';

const STATUS_TINT = {
  active: colors.muted,
  receiving: colors.teal,
  updated: colors.yellow,
  answered: colors.gold,
  archived: colors.subtle,
};

export default function PrayerScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState('All');

  const filtered = state.prayers.filter((p) => {
    if (tab === 'Mine') return p.mine;
    if (tab === 'Answered') return p.status === 'answered';
    if (tab === 'Church') return p.audience === 'Church';
    if (tab === 'Public') return p.audience === 'Public';
    return p.status !== 'archived';
  });

  return (
    <Screen
      title="Prayer Wall"
      subtitle="Intercede & share with the body of Christ"
      menu={() => nav.push('Profile')}
      right={
        <Pressable onPress={() => nav.push('NewPrayer')} hitSlop={12} style={styles.addPrayerBtn}>
          <Text style={{ color: colors.gold, fontSize: 18, fontWeight: '700' }}>＋</Text>
        </Pressable>
      }
    >
      <Pills
        items={['All', 'Mine', 'Church', 'Public', 'Answered']}
        value={tab}
        onChange={setTab}
        style={{ marginTop: 8 }}
      />

      {filtered.map((p) => (
        <Pressable key={p.id} style={styles.card} onPress={() => nav.push('Prayer', { id: p.id })}>
          <LinearGradient
            colors={['#241d19', '#171311']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.cardShimmer} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{p.author[0]}</Text>
              </View>
              <Text style={styles.author}>{p.author} · {p.audience}</Text>
            </View>
            <Badge label={p.status.toUpperCase()} tint={STATUS_TINT[p.status]} />
          </View>

          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.body} numberOfLines={2}>{p.body}</Text>

          {p.verse ? <Text style={styles.verse}>✦ {p.verse}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              onPress={() => dispatch({ type: 'pray', id: p.id })}
              style={[styles.pray, p.prayed && styles.prayOn]}
            >
              <Text style={[styles.prayText, p.prayed && { color: '#0e0c0b', fontWeight: '700' }]}>
                🙏 {p.prayed ? "You're praying" : "I'm praying"} · {p.praying}
              </Text>
            </Pressable>
            <Text style={styles.meta}>
              {p.created}{p.updates.length ? ` · ${p.updates.length} update${p.updates.length > 1 ? 's' : ''}` : ''}
            </Text>
          </View>
        </Pressable>
      ))}

      {!filtered.length ? (
        <Empty title="No prayer requests in this view" action="Submit a prayer" onAction={() => nav.push('NewPrayer')} />
      ) : null}

      <Notice text="Prayer requests are holy and private. Sensitive requests stay secure and are never shared for advertising." />
    </Screen>
  );
}

export function PrayerDetailScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const p = state.prayers.find((x) => x.id === params.id);
  const [update, setUpdate] = useState('');

  if (!p) return <Screen back title="Prayer"><Empty title="This prayer was removed" /></Screen>;

  return (
    <Screen back title="Prayer Request" subtitle={`${p.audience} · ${p.status.toUpperCase()}`}>
      <Text style={styles.detailTitle}>{p.title}</Text>
      <Text style={styles.detailAuthor}>Shared by {p.author} · {p.created}</Text>
      <Text style={styles.detailBody}>{p.body}</Text>

      {p.verse ? (
        <Row title={p.verse} subtitle="Scripture passage linked to this prayer" right="›" onPress={() => nav.push('Search')} />
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        <Button
          small
          label={`🙏 ${p.prayed ? 'Praying' : "I'm praying"} (${p.praying})`}
          kind={p.prayed ? 'primary' : 'ghost'}
          onPress={() => dispatch({ type: 'pray', id: p.id })}
        />
        <Button small kind="ghost" label="Encourage in Chat" onPress={() => nav.push('Chat', { to: p.author })} />
        <Button small kind="ghost" label="Send Scripture" onPress={() => nav.push('Search')} />
      </View>

      {p.updates.length ? (
        <Section title="Praise & Updates">
          {p.updates.map((u, i) => (
            <Row key={i} title={u.text} right={u.when} />
          ))}
        </Section>
      ) : null}

      {p.mine ? (
        <Section title="Manage Request">
          <Input
            multiline
            placeholder="Post an update, testimony, or praise report..."
            value={update}
            onChangeText={setUpdate}
            style={{ minHeight: 70 }}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button
              small
              label="Post update"
              disabled={!update.trim()}
              onPress={() => {
                dispatch({ type: 'prayerStatus', id: p.id, status: 'updated', update: update.trim() });
                setUpdate('');
              }}
            />
            <Button
              small
              kind="ghost"
              label="Mark Answered ★"
              onPress={() => {
                dispatch({
                  type: 'prayerStatus',
                  id: p.id,
                  status: 'answered',
                  update: update.trim() || 'Answered. God is faithful!',
                });
                setUpdate('');
              }}
            />
            <Button
              small
              kind="ghost"
              label="Archive"
              onPress={() => {
                dispatch({ type: 'prayerStatus', id: p.id, status: 'archived' });
                nav.pop();
              }}
            />
          </View>
        </Section>
      ) : (
        <Section title="Options">
          <Row title="Report prayer request" right="›" />
          <Row title="Mute notifications" right="›" />
        </Section>
      )}
    </Screen>
  );
}

export function NewPrayerScreen({ params = {} }) {
  const nav = useNav();
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('Private');
  const [anonymous, setAnonymous] = useState(false);
  const [expires, setExpires] = useState('30 days');
  const [notify, setNotify] = useState(true);

  return (
    <Screen back title="New Prayer Request">
      <Input placeholder="Prayer title (e.g. Health & healing for family)..." value={title} onChangeText={setTitle} />
      <Input
        multiline
        placeholder="Describe what you would like prayer for..."
        value={body}
        onChangeText={setBody}
        style={{ marginTop: 12 }}
      />
      {params.verse ? <Row title={`✦ ${params.verse}`} subtitle="Linked Scripture passage" /> : null}

      <Section title="Privacy & Audience">
        <Pills
          items={['Private', 'Church', 'Community', 'Public']}
          value={audience}
          onChange={setAudience}
        />
      </Section>

      <Section title="Preferences">
        <Row
          title="Post anonymously"
          subtitle="Hide your name and account details"
          right={<Toggle value={anonymous} onChange={setAnonymous} />}
        />
        <Row
          title="Notify those who prayed when answered"
          subtitle="Share the testimony of answered prayer"
          right={<Toggle value={notify} onChange={setNotify} />}
        />
      </Section>

      <Button
        label="Submit Prayer Request"
        disabled={!title.trim()}
        style={{ marginTop: 24 }}
        onPress={() => {
          dispatch({
            type: 'addPrayer',
            p: {
              title: title.trim(),
              body: body.trim(),
              audience,
              anonymous,
              verse: params.verse || null,
            },
          });
          nav.pop();
        }}
      />
    </Screen>
  );
}

export function Toggle({ value, onChange }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[styles.toggle, value && { backgroundColor: colors.gold }]}
    >
      <View style={[styles.knob, value && { alignSelf: 'flex-end', backgroundColor: '#0e0c0b' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addPrayerBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(229, 184, 105, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.lineLight,
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    overflow: 'hidden',
  },
  cardShimmer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  avatarCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.fg,
  },
  author: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.muted,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 16,
    color: colors.fg,
    marginTop: 10,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.passage,
    lineHeight: 18,
    marginTop: 6,
  },
  verse: {
    fontFamily: fonts.serif,
    fontSize: 12,
    color: colors.gold,
    marginTop: 10,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  pray: {
    borderWidth: 1,
    borderColor: colors.lineLight,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  prayOn: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  prayText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.fg,
  },
  meta: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.muted,
  },
  detailTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 22,
    color: colors.fg,
    marginTop: 12,
  },
  detailAuthor: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  detailBody: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.passage,
    marginTop: 16,
  },
  toggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.lineLight,
    padding: 2,
    justifyContent: 'center',
  },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
});
