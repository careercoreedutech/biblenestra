import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import { Screen, Section, Row, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider } from '../components/ui';
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { CALENDAR, CHANNELS, COMMUNITY_CATEGORIES, PEOPLE, LIVE, CARE_OPTIONS } from '../data/seed';
import { refLabel } from '../data/bible';

// ---------- Discover hub ----------
export default function DiscoverScreen() {
  const nav = useNav();
  const { state } = useStore();
  const unread = state.chats.reduce((n, c) => n + c.unread, 0) + state.requests.length;

  return (
    <Screen
      title="Discover"
      subtitle="Connect · Study · Grow"
      menu={() => nav.push('Profile')}
      right={
        <Pressable onPress={() => nav.push('Search')} hitSlop={12} style={styles.searchIconBtn}>
          <Text style={{ color: colors.fg, fontSize: 15 }}>⌕</Text>
        </Pressable>
      }
    >
      <View style={{ alignItems: 'center', marginTop: 14 }}>
        <Text style={styles.h1}>Explore & Connect</Text>
        <Text style={styles.sub}>Find fellow believers, study scripture, and serve together.</Text>
      </View>

      {/* Group 1: Fellowship & Community */}
      <Section title="Fellowship & Community">
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card
            compact
            title="Communities"
            subtitle="Churches, small groups & study circles"
            color={colors.teal}
            icon="👥"
            onPress={() => nav.push('Communities')}
          />
          <Card
            compact
            title="Chat & Groups"
            subtitle={unread ? `${unread} waiting` : 'Direct & group fellowship'}
            color={colors.lavender}
            icon="💬"
            onPress={() => nav.push('ChatList')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <Card
            compact
            title="People Directory"
            subtitle="Believers open to spiritual conversation"
            color={colors.gold}
            icon="🕊"
            onPress={() => nav.push('People')}
          />
          <Card
            compact
            title="Live Fellowship"
            subtitle={`${LIVE.filter((l) => l.status === 'live').length} active broadcasts`}
            color={colors.accent}
            icon="●"
            onPress={() => nav.push('Live')}
          />
        </View>
        <View style={{ marginTop: 12 }}>
          <Row
            title="Community Feed"
            subtitle="Testimonies, reflections, and announcements from your network"
            right="Browse Feed ›"
            onPress={() => nav.push('Feed')}
          />
        </View>
      </Section>

      {/* Group 2: Growth & Discipleship */}
      <Section title="Growth & Study">
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card
            compact
            title="Learning Hub"
            subtitle="Plans, devotionals, memorization, and courses"
            color={colors.gold}
            icon="📖"
            onPress={() => nav.push('Learn')}
          />
          <Card
            compact
            title="Sermon Studio"
            subtitle="Audio recording, AI transcription & notes"
            color={colors.amber}
            icon="🎙"
            onPress={() => nav.push('SermonStudio')}
          />
        </View>
        <View style={{ marginTop: 12 }}>
          <Row
            title="Christian Calendar"
            subtitle="Church gatherings, global feasts & observance reminders"
            right="View Calendar ›"
            onPress={() => nav.push('Calendar')}
          />
        </View>
      </Section>

      {/* Group 3: Care & Support */}
      <Section title="Spiritual Care & Needs">
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card
            compact
            title="Care Network"
            subtitle="Confidential support from qualified ministers"
            color={colors.teal}
            icon="🤍"
            onPress={() => nav.push('Care')}
          />
          <Card
            compact
            title="Make a Wish"
            subtitle="Share an urgent need or offer assistance"
            color={colors.lavender}
            icon="✨"
            onPress={() => nav.push('Wishes')}
          />
        </View>
      </Section>

      <Button label="＋ Create Post, Group or Stream" onPress={() => nav.push('Create')} style={{ marginTop: 28 }} />
    </Screen>
  );
}

// ---------- Communities ----------
export function CommunitiesScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const list = state.communities.filter((c) => (cat === 'All' || c.category === cat || (cat === 'Regions' && c.region !== 'Global')) && (c.name + c.description + c.region).toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen back title="Explore Communities">
      <Input placeholder="Church name, city, country, Bible topic, or group" value={q} onChangeText={setQ} />
      <Pills small items={COMMUNITY_CATEGORIES} value={cat} onChange={setCat} style={{ marginTop: 10 }} />
      {list.map((c) => (
        <Pressable key={c.id} style={styles.card} onPress={() => nav.push('Group', { id: c.id })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.cardMeta}>{c.region} · {c.language} · {c.members.toLocaleString()} members</Text>
            </View>
            {c.verified ? <Badge label="Verified" /> : null}
          </View>
          <Text style={styles.cardBody}>{c.description}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}><Tag label={c.category} /><Tag label={c.privacy} tint={c.privacy === 'Private' ? colors.amber : undefined} /></View>
            <Button small kind={c.joined === true ? 'ghost' : 'primary'} label={c.joined === true ? 'Joined' : c.joined === 'requested' ? 'Requested' : c.privacy === 'Private' ? 'Request to join' : 'Join'} onPress={() => dispatch({ type: 'join', id: c.id })} />
          </View>
        </Pressable>
      ))}
      {!list.length ? <Empty title="Can't find your church?" body="Search again, add it for verification, invite an administrator, or continue without joining." action="Add church for verification" onAction={() => nav.push('Onboarding', { step: 2 })} /> : null}
      <Divider />
      <Row title="Create a group" subtitle="Public, private, invite-only or hidden" right="›" onPress={() => nav.push('Create', { kind: 'Group' })} />
    </Screen>
  );
}

// ---------- Group (channels + chat) ----------
export function GroupScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const g = state.communities.find((c) => c.id === params.id);
  const [channel, setChannel] = useState('General');
  const [tab, setTab] = useState('Chat');
  const msgs = (state.groupMessages[g.id] || {})[channel] || [];
  const pinned = Object.values(state.groupMessages[g.id] || {}).flat().filter((m) => m.pinned);
  const canPost = g.joined === true;
  return (
    <Screen back title={g.name} subtitle={`${g.members.toLocaleString()} members · ${g.privacy}${g.verified ? ' · Verified' : ''}`} scroll={false} padded={false}
      right={<Pressable onPress={() => setTab(tab === 'Chat' ? 'About' : 'Chat')} hitSlop={10}><Text style={{ color: colors.muted, fontSize: 16 }}>ⓘ</Text></Pressable>}>
      {tab === 'About' ? (
        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <Text style={styles.cardBody}>{g.description}</Text>
          <Section title="Rules"><Text style={styles.cardBody}>{g.rules}</Text></Section>
          <Section title="Members & roles">
            <Row title="Pastor Tunde" subtitle="Owner" />
            <Row title="Amaka O." subtitle="Moderator" />
            <Row title={state.user.displayName} subtitle={canPost ? 'Member' : 'Not a member'} />
          </Section>
          <Section title="Group study settings">
            <Row title="Translation" right={state.translation} />
            <Row title="Current plan" right="Matthew · weekly" />
            <Row title="Meeting rhythm" right="Thursdays 19:00" />
            <Row title="Live Bible study mode" subtitle="Synchronized passage, teacher controls" right="›" onPress={() => nav.push('Live')} />
          </Section>
          <Section title="Safety">
            <Row title="Mute group" right="›" /><Row title="Report group" right="›" /><Row title="Leave group" right="›" onPress={() => { dispatch({ type: 'join', id: g.id }); nav.pop(); }} />
          </Section>
          <Button label={canPost ? 'Back to chat' : g.privacy === 'Private' ? 'Request to join' : 'Join group'} onPress={() => (canPost ? setTab('Chat') : dispatch({ type: 'join', id: g.id }))} style={{ marginTop: 20 }} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <Pills items={CHANNELS} value={channel} onChange={setChannel} style={{ paddingHorizontal: 18, flexGrow: 0 }} />
          {pinned.length && channel === 'General' ? <Pressable style={styles.pinned}><Text style={styles.pinnedText}>📌 {pinned[0].text}</Text></Pressable> : null}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, gap: 10 }}>
            {!msgs.length ? <Empty title={`No messages in ${channel} yet`} /> : null}
            {msgs.map((m) => (
              <View key={m.id} style={[styles.msg, m.mine && styles.msgMine]}>
                {!m.mine ? <Text style={styles.msgFrom}>{m.from}</Text> : null}
                <Text style={[styles.msgText, m.mine && { color: '#fff' }]}>{m.text}</Text>
                {m.passage ? <Pressable onPress={() => nav.push('Bible', m.passage)} style={styles.passageChip}><Text style={styles.passageChipText}>📖 {refLabel(m.passage.bookId, m.passage.chapter)} · Open</Text></Pressable> : null}
                {m.prayer ? <Pressable style={styles.passageChip}><Text style={styles.passageChipText}>🙏 I'm praying · {m.praying}</Text></Pressable> : null}
                {m.event ? <Pressable onPress={() => nav.push('Calendar')} style={styles.passageChip}><Text style={styles.passageChipText}>📅 RSVP · Add to calendar</Text></Pressable> : null}
                <Text style={[styles.msgTime, m.mine && { color: '#ffd9c2' }]}>{m.time}{m.mine ? ' · Delivered' : ''}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
              {['📖 Passage', '🙏 Prayer', '📊 Poll', '📎 File', '🎤 Voice', '📅 Event'].map((a) => (
                <Pressable key={a} onPress={() => { if (!canPost) return; if (a.startsWith('📖')) dispatch({ type: 'groupMessage', gid: g.id, channel, m: { text: 'Let\'s read this together.', passage: state.lastPosition } }); if (a.startsWith('🙏')) nav.push('NewPrayer'); }} style={styles.composerChip}><Text style={styles.composerChipText}>{a}</Text></Pressable>
              ))}
            </ScrollView>
            {canPost ? <AskBar placeholder={`Message #${channel}`} onSend={(t) => dispatch({ type: 'groupMessage', gid: g.id, channel, m: { text: t } })} /> : <Notice text={g.joined === 'requested' ? 'Your request is waiting for approval.' : 'Join this group to post.'} />}
          </View>
        </View>
      )}
    </Screen>
  );
}

// ---------- Chat list + conversation ----------
export function ChatListScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState('All');
  const list = state.chats.filter((c) => tab === 'All' || (tab === 'Prayer' && c.type.includes('Prayer')) || (tab === 'Bible study' && c.type === 'Bible study') || (tab === 'Professional' && c.type === 'Professional'));
  return (
    <Screen back title="Chat" right={<Pressable onPress={() => nav.push('People')} hitSlop={10}><Text style={{ color: colors.accent, fontSize: 20 }}>＋</Text></Pressable>}>
      <Pills items={['All', 'Prayer', 'Bible study', 'Professional', 'Groups']} value={tab} onChange={(t) => (t === 'Groups' ? nav.push('Communities') : setTab(t))} />
      <Row title="Bible Chat" subtitle="AI-assisted Scripture study · separate from member messaging" left={<Text>✦</Text>} right="›" tint={colors.teal} onPress={() => nav.push('BibleChat', {})} />
      {state.requests.length ? (
        <Section title="Message requests">
          {state.requests.map((r) => (
            <View key={r.id} style={styles.card}>
              <Text style={styles.cardTitle}>{r.from}</Text>
              <Text style={styles.cardBody}>{r.text}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Button small label="Accept" onPress={() => dispatch({ type: 'request', id: r.id, accept: true, from: r.from, text: r.text })} />
                <Button small kind="ghost" label="Decline" onPress={() => dispatch({ type: 'request', id: r.id })} />
                <Button small kind="ghost" label="Block" onPress={() => dispatch({ type: 'request', id: r.id })} />
              </View>
            </View>
          ))}
        </Section>
      ) : null}
      <Section title="Conversations">
        {list.map((c) => <Row key={c.id} title={c.with} subtitle={`${c.type} · ${c.last}`} left={<Text style={{ color: colors.fg }}>{c.with[0]}</Text>} right={<View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ color: colors.muted, fontSize: 10 }}>{c.time}</Text>{c.unread ? <Badge label={String(c.unread)} tint={colors.accent} /> : null}</View>} onPress={() => nav.push('Chat', { id: c.id })} />)}
      </Section>
    </Screen>
  );
}

export function ChatScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  let chat = state.chats.find((c) => c.id === params.id) || state.chats.find((c) => c.with === params.to);
  const [kindMenu, setKindMenu] = useState(false);
  if (!chat && params.to) {
    return (
      <Screen back title={params.to} subtitle="New conversation" scroll={false}>
        <Notice tint={colors.teal} text="Before your first conversation: a badge does not make someone a pastor, counselor, therapist, or emergency service. You can block or report at any time." />
        <View style={{ flex: 1 }} />
        <AskBar placeholder="Say hello..." onSend={(t) => { dispatch({ type: 'newChat', name: params.to, kind: params.kind, text: t }); nav.replace('Chat', { to: params.to }); }} />
      </Screen>
    );
  }
  if (!chat) return <Screen back title="Chat"><Empty title="Conversation not found" /></Screen>;
  return (
    <Screen back title={chat.with} subtitle={chat.type} scroll={false} padded={false} right={<Pressable onPress={() => setKindMenu(!kindMenu)} hitSlop={10}><Text style={{ color: colors.muted, fontSize: 18 }}>⋯</Text></Pressable>}>
      {kindMenu ? (
        <View style={styles.menu}>
          {['Convert to Bible study', 'Convert to prayer conversation', 'Convert to mentor conversation', 'Schedule a call', 'Mute', 'Block', 'Report'].map((o) => <Pressable key={o} onPress={() => setKindMenu(false)}><Text style={styles.menuItem}>{o}</Text></Pressable>)}
          <Text style={[styles.menuItem, { color: colors.muted, fontSize: 10 }]}>Conversions need both people's consent.</Text>
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, gap: 10 }}>
        <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>Private conversation · end-to-end private by default</Text>
        {chat.messages.map((m) => (
          <View key={m.id} style={[styles.msg, m.mine && styles.msgMine]}>
            <Text style={[styles.msgText, m.mine && { color: '#fff' }]}>{m.text}</Text>
            <Text style={[styles.msgTime, m.mine && { color: '#ffd9c2' }]}>{m.time}{m.mine ? ' · Read' : ''}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
        <AskBar placeholder="Message..." onSend={(t) => dispatch({ type: 'dm', cid: chat.id, text: t })} />
      </View>
    </Screen>
  );
}

// ---------- Calendar ----------
export function CalendarScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState('All');
  const list = CALENDAR.filter((e) => filter === 'All' || (filter === 'Observances' && (e.kind === 'Observance' || e.kind === 'Season')) || (filter === 'Church' && e.kind === 'Church event') || (filter === 'Community' && e.kind === 'Community') || (filter === 'Mine' && state.rsvps.includes(e.id)));
  const months = {};
  list.forEach((e) => { const m = e.date.slice(0, 7); (months[m] = months[m] || []).push(e); });
  const label = (m) => new Date(m + '-02').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <Screen back title="Calendar" subtitle="Personal · church · community · Christian observances" right={<Pressable onPress={() => nav.push('Create', { kind: 'Event' })} hitSlop={10}><Text style={{ color: colors.accent, fontSize: 20 }}>＋</Text></Pressable>}>
      <Pills items={['All', 'Mine', 'Church', 'Community', 'Observances']} value={filter} onChange={setFilter} />
      {Object.keys(months).sort().map((m) => (
        <Section key={m} title={label(m)}>
          {months[m].map((e) => (
            <View key={e.id} style={styles.event}>
              <View style={styles.dateBox}><Text style={styles.dateDay}>{e.date.slice(8)}</Text><Text style={styles.dateMon}>{new Date(e.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle}>{e.title}</Text>
                <Text style={styles.cardMeta}>{[e.time, e.where, e.tradition].filter(Boolean).join(' · ')}</Text>
                {e.scripture ? <Pressable onPress={() => nav.push('Search')}><Text style={{ color: colors.teal, fontSize: 11, marginTop: 4 }}>✦ {e.scripture}</Text></Pressable> : null}
                {e.source ? <Text style={{ color: colors.muted, fontSize: 9.5, marginTop: 4 }}>Source: {e.source} · Verified</Text> : null}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                  <Tag label={e.kind} />
                  {e.kind === 'Church event' || e.kind === 'Community' ? <Pressable onPress={() => dispatch({ type: 'rsvp', id: e.id })}><Tag label={state.rsvps.includes(e.id) ? '✓ Going' : 'RSVP'} tint={state.rsvps.includes(e.id) ? colors.teal : colors.accent} /></Pressable> : <Pressable onPress={() => dispatch({ type: 'post', post: { kind: 'Celebration', text: `${e.title} · ${e.scripture}. Blessings from ${state.user.displayName}.` } })}><Tag label="Share greeting" tint={colors.accent} /></Pressable>}
                  <Tag label="Add to calendar" />
                </View>
              </View>
            </View>
          ))}
        </Section>
      ))}
      <Notice text="Western Easter and Orthodox Pascha may differ. Observance dates come from a maintained, source-attributed database; AI never decides which date a church observes." />
    </Screen>
  );
}

// ---------- People ----------
export function PeopleScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [f, setF] = useState('All');
  const list = PEOPLE.filter((p) => !state.blocked.includes(p.id)).filter((p) => f === 'All' || p.accepts.some((a) => a.toLowerCase().includes(f.toLowerCase())) || (f === 'Available now' && p.availability === 'Available now'));
  return (
    <Screen back title="People" subtitle="Christians who chose to be discoverable">
      <Pills small items={['All', 'Available now', 'Prayer', 'Bible study', 'Mentoring', 'Professional', 'Care']} value={f} onChange={setF} />
      {list.map((p) => (
        <Pressable key={p.id} style={styles.card} onPress={() => nav.push('Person', { id: p.id })}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={styles.avatar}><Text style={{ color: colors.fg, fontWeight: '600' }}>{p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>{p.name}</Text>
              <Text style={styles.cardMeta}>{p.headline} · {p.country}</Text>
              <Text style={[styles.cardMeta, { color: p.availability === 'Available now' ? colors.teal : p.availability === 'Not accepting' ? colors.muted : colors.yellow }]}>● {p.availability}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {p.accepts.map((a) => <Tag key={a} label={a} tint={colors.teal} />)}
            {p.verified.map((v) => <Badge key={v} label={v} tint={colors.lavender} />)}
          </View>
          {p.mutual ? <Text style={[styles.cardMeta, { marginTop: 6 }]}>{p.mutual} mutual group{p.mutual > 1 ? 's' : ''}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button small label={p.availability === 'Message requests' ? 'Request to chat' : 'Chat'} disabled={p.availability === 'Not accepting'} onPress={() => nav.push('Chat', { to: p.name, kind: p.accepts[0] })} />
            <Button small kind="ghost" label={state.follows.includes(p.id) ? 'Following' : 'Follow'} onPress={() => dispatch({ type: 'follow', id: p.id })} />
          </View>
        </Pressable>
      ))}
      <Notice text="Profile badges show specific verifications only. They do not make someone a pastor, counselor, therapist, or emergency service." />
    </Screen>
  );
}

export function PersonScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const p = PEOPLE.find((x) => x.id === params.id);
  return (
    <Screen back title={p.name} subtitle={p.headline}>
      <View style={{ alignItems: 'center', marginTop: 14 }}>
        <View style={[styles.avatar, { width: 64, height: 64, borderRadius: 32 }]}><Text style={{ color: colors.fg, fontWeight: '600', fontSize: 20 }}>{p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</Text></View>
        <Text style={[styles.cardTitle, { fontSize: 18, marginTop: 10 }]}>{p.name}</Text>
        <Text style={styles.cardMeta}>{p.headline} · {p.country} · {p.languages.join(', ')}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>{p.verified.map((v) => <Badge key={v} label={v} tint={colors.lavender} />)}</View>
      </View>
      <Text style={[styles.cardBody, { marginTop: 16, textAlign: 'center' }]}>{p.intro}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, justifyContent: 'center' }}>
        <Button small label="Chat" disabled={p.availability === 'Not accepting'} onPress={() => nav.push('Chat', { to: p.name, kind: p.accepts[0] })} />
        <Button small kind="ghost" label={state.follows.includes(p.id) ? 'Following' : 'Follow'} onPress={() => dispatch({ type: 'follow', id: p.id })} />
        <Button small kind="ghost" label="Block" onPress={() => { dispatch({ type: 'block', id: p.id }); nav.pop(); }} />
      </View>
      <Section title="Accepts">{p.accepts.map((a) => <Row key={a} title={a} />)}</Section>
      <Section title="Interests"><View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{p.interests.map((i) => <Tag key={i} label={i} />)}</View></Section>
      <Section title="Professional profile">
        <Row title="Experience & ministry" right="›" /><Row title="Portfolio" subtitle="Sermons, studies, published work" right="›" /><Row title="Recommendations" right="›" />
      </Section>
      <Notice text="What each badge means: Identity = government ID checked. Professional license = licence number verified. Ministry role = confirmed by the organization. None implies endorsement beyond that." />
    </Screen>
  );
}

// ---------- Care Network ----------
export function CareScreen({ params = {} }) {
  const nav = useNav();
  const [choice, setChoice] = useState(params.preselect || null);
  const match = {
    'I need someone to talk to': ['p1', 'p5', 'p4'], 'I need prayer': ['p1', 'p6'], 'I need encouragement': ['p5', 'p1'], 'I want to study the Bible with someone': ['p4'],
    'I need pastoral guidance': ['p1'], 'I want a qualified counselor': ['p3'], 'I need a career or ministry mentor': ['p2', 'p5'], 'I want to encourage others': [], 'I want to join a support group': [],
  };
  const people = choice ? PEOPLE.filter((p) => (match[choice] || []).includes(p.id)) : [];
  return (
    <Screen back title="Christian Care Network" subtitle="Find Someone Who Understands">
      <Notice tint={colors.teal} text="Sensitive conversations are private by default and never become posts." />
      {!choice ? CARE_OPTIONS.map((o) => <Row key={o} title={o} right="›" onPress={() => setChoice(o)} />) : (
        <View>
          <Row title={choice} tint={colors.teal} right={<Pressable onPress={() => setChoice(null)}><Text style={{ color: colors.muted }}>Change</Text></Pressable>} />
          {choice === 'I want a qualified counselor' ? <Notice text="Only people with a verified professional license appear here. If you are in immediate danger, contact your local emergency number." /> : null}
          {choice === 'I want to encourage others' ? <Section title="Ways to serve"><Row title="Become a willing listener" subtitle="Set your availability in Profile" right="›" onPress={() => nav.push('Profile')} /><Row title="Join Night Watch Prayer" right="›" onPress={() => nav.push('Group', { id: 'g3' })} /></Section> : null}
          {choice === 'I want to join a support group' ? <Section title="Support groups"><Row title="Grief & Hope" subtitle="Moderated · Private" right="›" onPress={() => nav.push('Group', { id: 'g8' })} /><Row title="Young Marrieds · Nairobi" right="›" onPress={() => nav.push('Group', { id: 'g5' })} /></Section> : null}
          {people.length ? (
            <Section title="Recommended for you">
              {people.map((p) => <Row key={p.id} title={p.name} subtitle={`${p.headline} · ${p.availability}`} right={<Badge label={p.verified[0] || 'Member'} tint={colors.lavender} />} onPress={() => nav.push('Person', { id: p.id })} />)}
            </Section>
          ) : null}
          <Section title="Before you reach out">
            <Text style={styles.cardBody}>· Message requests mean no one is contacted unexpectedly.{'\n'}· Confidentiality is expected but not guaranteed by the app.{'\n'}· You can block, report, or stop at any time.{'\n'}· Nobody here replaces emergency, medical or mental-health care.</Text>
          </Section>
        </View>
      )}
    </Screen>
  );
}

// ---------- Make a Wish ----------
export function WishesScreen() {
  const nav = useNav();
  const { state } = useStore();
  return (
    <Screen back title="Make a Wish" subtitle="A hope, prayer request, goal, or need" right={<Pressable onPress={() => nav.push('Create', { kind: 'Wish' })} hitSlop={10}><Text style={{ color: colors.accent, fontSize: 20 }}>＋</Text></Pressable>}>
      {state.wishes.map((w) => (
        <View key={w.id} style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={styles.cardMeta}>{w.author} · {w.visibility}</Text><Tag label={w.category} /></View>
          <Text style={styles.cardTitle}>{w.title}</Text>
          <Text style={styles.cardBody}>{w.body}</Text>
          <Text style={[styles.cardMeta, { marginTop: 8 }]}>Responding with: {w.responses.join(', ')} · {w.replies} replies</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {w.responses.map((r) => <Button key={r} small kind="ghost" label={r} onPress={() => (r === 'Prayer' ? nav.push('NewPrayer', { verse: null }) : r === 'Private message' || r === 'Mentor connection' ? nav.push('Chat', { to: w.author }) : null)} />)}
          </View>
        </View>
      ))}
      <Notice text="Financial help is a separate, verified feature with identity checks and fees shown up front. A wish is never treated as a trusted fundraising request." />
    </Screen>
  );
}

// ---------- Live ----------
export function LiveScreen({ params = {} }) {
  const nav = useNav();
  const [joined, setJoined] = useState(params.id || null);
  const l = LIVE.find((x) => x.id === joined);
  if (l) {
    return (
      <Screen back title={l.title} subtitle={`${l.host} · ${l.status}`} scroll={false} padded={false}>
        <View style={styles.video}><Text style={{ color: colors.muted }}>{l.status === 'live' ? '● LIVE · ' + l.viewers + ' watching' : l.status === 'replay' ? 'Replay' : 'Starts ' + l.when}</Text><Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>Audio-only and reduced-quality modes available</Text></View>
        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><Tag label={l.language} /><Tag label={l.audience} />{l.captions ? <Tag label="Captions" /> : null}<Tag label="Moderated" /></View>
          <Section title="Live Bible study"><Row title="Synchronized passage: Matthew 1" subtitle="Follow the teacher's highlights" right="›" onPress={() => nav.push('Bible', { bookId: 'MAT', chapter: 1 })} /></Section>
          <Section title="Participate"><Row title="✋ Raise hand" /><Row title="🙏 Send a prayer request" onPress={() => nav.push('NewPrayer')} /><Row title="❓ Ask a moderated question" /><Row title="📊 Poll: Which genealogy name surprised you?" /></Section>
          <Section title="Live chat"><Row title="Amaka O." subtitle="So glad this is live. Greetings from Lagos!" /><Row title="Jonas B." subtitle="Watching from Sweden." /></Section>
          <Notice text="Hosts confirmed rights to broadcast this material. Recording consent was shown to participants." />
        </ScrollView>
        <View style={{ padding: 14 }}><AskBar placeholder="Say something in live chat..." /></View>
      </Screen>
    );
  }
  return (
    <Screen back title="Live" right={<Pressable onPress={() => nav.push('Create', { kind: 'Live stream' })} hitSlop={10}><Text style={{ color: colors.accent, fontSize: 20 }}>＋</Text></Pressable>}>
      {['live', 'scheduled', 'replay'].map((s) => (
        <Section key={s} title={s === 'live' ? 'Live now' : s === 'scheduled' ? 'Scheduled' : 'Replays'}>
          {LIVE.filter((x) => x.status === s).map((x) => <Row key={x.id} title={x.title} subtitle={`${x.host} · ${x.language} · ${x.audience}${x.captions ? ' · Captions' : ''}`} right={s === 'live' ? <Badge label={`${x.viewers}`} tint="#e85d5d" /> : s === 'scheduled' ? x.when : 'Replay'} onPress={() => setJoined(x.id)} />)}
        </Section>
      ))}
    </Screen>
  );
}

// ---------- Feed ----------
export function FeedScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState('For You');
  return (
    <Screen back title="Feed" right={<Pressable onPress={() => nav.push('Create', { kind: 'Post' })} hitSlop={10}><Text style={{ color: colors.accent, fontSize: 20 }}>＋</Text></Pressable>}>
      <Pills items={['For You', 'Following', 'Communities', 'Events']} value={tab} onChange={setTab} />
      {state.feed.filter((f) => tab !== 'Events' || f.kind === 'Announcement' || f.kind === 'Celebration').map((f) => (
        <View key={f.id} style={styles.post}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={styles.cardTitle}>{f.author}</Text><Tag label={f.kind} /></View>
          <Text style={styles.cardBody}>{f.text}</Text>
          {f.passage ? <Pressable onPress={() => nav.push('Bible', f.passage)}><Text style={{ color: colors.teal, fontSize: 11, marginTop: 6 }}>📖 {refLabel(f.passage.bookId, f.passage.chapter)} · Open</Text></Pressable> : null}
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
            <Pressable onPress={() => dispatch({ type: 'like', id: f.id })}><Text style={[styles.cardMeta, f.liked && { color: colors.accent }]}>🙌 {f.likes}</Text></Pressable>
            <Text style={styles.cardMeta}>💬 {f.comments}</Text>
            <Text style={styles.cardMeta}>↗ Share</Text>
            <Text style={styles.cardMeta}>☆ Save</Text>
            <Text style={[styles.cardMeta, { marginLeft: 'auto' }]}>{f.time}</Text>
          </View>
        </View>
      ))}
      <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 16 }}>Ranked by relevance, your interests, follows and community participation, not engagement alone.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: { fontFamily: fonts.sansMedium, fontSize: 21, fontWeight: '600', color: colors.fg, letterSpacing: -0.3 },
  sub: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted, marginTop: 4, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, marginTop: 12 },
  cardTitle: { fontFamily: fonts.sansMedium, fontSize: 14.5, fontWeight: '600', color: colors.fg },
  cardMeta: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, marginTop: 3 },
  cardBody: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.passage, lineHeight: 18, marginTop: 8 },
  pinned: { marginHorizontal: 18, marginTop: 6, backgroundColor: colors.surface, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: colors.border },
  pinnedText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.fg },
  msg: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, borderBottomLeftRadius: 2, padding: 12, maxWidth: '85%' },
  msgMine: { alignSelf: 'flex-end', backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12, borderBottomRightRadius: 2 },
  msgFrom: { fontFamily: fonts.sansMedium, fontSize: 10.5, color: colors.gold, fontWeight: '600', marginBottom: 3 },
  msgText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: colors.fg },
  msgTime: { fontFamily: fonts.sans, fontSize: 9.5, color: colors.muted, marginTop: 4 },
  passageChip: { marginTop: 8, backgroundColor: colors.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.border },
  passageChipText: { fontFamily: fonts.serif, fontSize: 12, color: colors.fg },
  composerChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surface },
  composerChipText: { fontFamily: fonts.sans, fontSize: 11, color: colors.fg },
  menu: { position: 'absolute', right: 14, top: 44, zIndex: 5, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 4 },
  menuItem: { fontFamily: fonts.sans, color: colors.fg, fontSize: 13, paddingVertical: 8, paddingHorizontal: 12 },
  event: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.rule },
  dateBox: { width: 44, alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  dateDay: { fontFamily: fonts.sansMedium, fontSize: 16, fontWeight: '600', color: colors.fg },
  dateMon: { fontFamily: fonts.sans, fontSize: 9.5, color: colors.gold, letterSpacing: 0.5 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  video: { height: 200, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderRadius: 12, overflow: 'hidden' },
  post: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.rule },
});
