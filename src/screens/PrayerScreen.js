import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen, Section, Row, Pills, Button, Input, Tag, Badge, Notice, Empty } from '../components/ui';
import { colors } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';

const STATUS_TINT = { active: colors.muted, receiving: colors.teal, updated: colors.yellow, answered: colors.amber, archived: colors.line };

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
    <Screen title="Prayer" subtitle="Prayer Wall" menu={() => nav.push('Profile')} right={<Pressable onPress={() => nav.push('NewPrayer')} hitSlop={10}><Text style={{ color: colors.accent, fontSize: 20 }}>＋</Text></Pressable>}>
      <Pills items={['All', 'Mine', 'Church', 'Public', 'Answered']} value={tab} onChange={setTab} style={{ marginTop: 6 }} />
      {filtered.map((p) => (
        <Pressable key={p.id} style={styles.card} onPress={() => nav.push('Prayer', { id: p.id })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.author}>{p.author} · {p.audience}</Text>
            <Badge label={p.status} tint={STATUS_TINT[p.status]} />
          </View>
          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.body} numberOfLines={2}>{p.body}</Text>
          {p.verse ? <Text style={styles.verse}>✦ {p.verse}</Text> : null}
          <View style={styles.actions}>
            <Pressable onPress={() => dispatch({ type: 'pray', id: p.id })} style={[styles.pray, p.prayed && styles.prayOn]}><Text style={[styles.prayText, p.prayed && { color: '#fff' }]}>🙏 {p.prayed ? "You're praying" : "I'm praying"} · {p.praying}</Text></Pressable>
            <Text style={styles.meta}>{p.created}{p.updates.length ? ` · ${p.updates.length} update${p.updates.length > 1 ? 's' : ''}` : ''}</Text>
          </View>
        </Pressable>
      ))}
      {!filtered.length ? <Empty title="Nothing here yet" action="Add a prayer" onAction={() => nav.push('NewPrayer')} /> : null}
      <Notice text="Prayer requests are separate from fundraising. Sensitive requests stay private by default and are never used for advertising." />
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
    <Screen back title="Prayer request" subtitle={`${p.audience} · ${p.status}`}>
      <Text style={styles.detailTitle}>{p.title}</Text>
      <Text style={styles.detailAuthor}>{p.author} · {p.created}</Text>
      <Text style={styles.detailBody}>{p.body}</Text>
      {p.verse ? <Row title={p.verse} subtitle="Linked passage" right="›" onPress={() => nav.push('Search')} /> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Button small label={`🙏 ${p.prayed ? "Praying" : "I'm praying"} · ${p.praying}`} kind={p.prayed ? 'primary' : 'ghost'} onPress={() => dispatch({ type: 'pray', id: p.id })} />
        <Button small kind="ghost" label="Encourage" onPress={() => nav.push('Chat', { to: p.author })} />
        <Button small kind="ghost" label="Send Scripture" onPress={() => nav.push('Search')} />
        <Button small kind="ghost" label="Voice note" />
        <Button small kind="ghost" label="Set reminder" />
      </View>
      {p.updates.length ? (
        <Section title="Updates">
          {p.updates.map((u, i) => <Row key={i} title={u.text} right={u.when} />)}
        </Section>
      ) : null}
      {p.mine ? (
        <Section title="Manage your prayer">
          <Input multiline placeholder="Post an update or testimony" value={update} onChangeText={setUpdate} style={{ minHeight: 70 }} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button small label="Post update" disabled={!update.trim()} onPress={() => { dispatch({ type: 'prayerStatus', id: p.id, status: 'updated', update: update.trim() }); setUpdate(''); }} />
            <Button small kind="ghost" label="Mark answered" onPress={() => { dispatch({ type: 'prayerStatus', id: p.id, status: 'answered', update: update.trim() || 'Answered. Thank you for praying.' }); setUpdate(''); }} />
            <Button small kind="ghost" label="Archive" onPress={() => { dispatch({ type: 'prayerStatus', id: p.id, status: 'archived' }); nav.pop(); }} />
          </View>
          <Text style={styles.meta}>People who prayed will be notified when you mark this answered (you can turn that off).</Text>
        </Section>
      ) : (
        <Section title="Safety">
          <Row title="Report this request" right="›" />
          <Row title="Mute author" right="›" />
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
    <Screen back title="New prayer request">
      <Input placeholder="Title" value={title} onChangeText={setTitle} />
      <Input multiline placeholder="What would you like prayer for?" value={body} onChangeText={setBody} style={{ marginTop: 10 }} />
      {params.verse ? <Row title={`✦ ${params.verse}`} subtitle="Created from this passage" /> : null}
      <Section title="Who can see this">
        <Pills items={['Private', 'Selected people', 'Church', 'Community', 'Connections', 'Public']} value={audience} onChange={setAudience} />
      </Section>
      <Section title="Options">
        <Row title="Post anonymously" subtitle="Hide your name and details" right={<Toggle value={anonymous} onChange={setAnonymous} />} />
        <Row title="Expires" subtitle="Archived automatically, history kept" right={<Text style={{ color: colors.accent, fontSize: 11 }} onPress={() => setExpires(expires === '30 days' ? 'Never' : expires === 'Never' ? '7 days' : '30 days')}>{expires}</Text>} />
        <Row title="Notify those who prayed when answered" right={<Toggle value={notify} onChange={setNotify} />} />
        <Row title="Reminder" subtitle="Remind me to pray for this" right="Off" />
      </Section>
      <Notice text="Prayer requests cannot include fundraising links. Verified fundraising is a separate feature." />
      <Button label="Share prayer request" disabled={!title.trim()} style={{ marginTop: 20 }} onPress={() => { dispatch({ type: 'addPrayer', p: { title: title.trim(), body: body.trim(), audience, anonymous, verse: params.verse || null } }); nav.pop(); }} />
    </Screen>
  );
}

export function Toggle({ value, onChange }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.toggle, value && { backgroundColor: colors.accent }]}>
      <View style={[styles.knob, value && { alignSelf: 'flex-end' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.cardBottom, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, marginTop: 12 },
  author: { fontSize: 10.5, color: colors.muted },
  title: { fontSize: 14, fontWeight: '600', color: colors.fg, marginTop: 8 },
  body: { fontSize: 12, color: colors.passage, lineHeight: 17, marginTop: 4 },
  verse: { fontSize: 10.5, color: colors.teal, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  pray: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  prayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  prayText: { fontSize: 11, color: colors.fg },
  meta: { fontSize: 10, color: colors.muted, marginTop: 8 },
  detailTitle: { fontSize: 20, fontWeight: '600', color: colors.fg, marginTop: 10 },
  detailAuthor: { fontSize: 11, color: colors.muted, marginTop: 4 },
  detailBody: { fontSize: 14, lineHeight: 21, color: colors.passage, marginTop: 14 },
  toggle: { width: 40, height: 22, borderRadius: 11, backgroundColor: colors.line, padding: 2 },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
});
