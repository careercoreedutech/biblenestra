import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen, Section, Row, Badge, Tag, Button, Spark } from '../components/ui';
import Card from '../components/Card';
import { colors } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { VERSE_OF_DAY, getChapter, refLabel, CHAPTER_TITLES } from '../data/bible';
import { CALENDAR, LIVE } from '../data/seed';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
}

export default function HomeScreen() {
  const { state, dispatch, sync } = useStore();
  const nav = useNav();
  const vod = VERSE_OF_DAY;
  const vodText = (getChapter(state.translation, vod.bookId, vod.chapter) || getChapter('KJV', vod.bookId, vod.chapter))[vod.verse - 1];
  const plan = state.plans[0];
  const lp = state.lastPosition;
  const nextEvent = CALENDAR.find((e) => e.date >= '2026-10-25');
  const live = LIVE.filter((l) => l.status === 'live');
  const activePrayers = state.prayers.filter((p) => p.status !== 'answered').slice(0, 2);

  return (
    <Screen title="Home" menu={() => nav.push('Profile')} right={<Pressable onPress={() => nav.push('Search')} hitSlop={10}><Text style={{ color: colors.muted, fontSize: 16 }}>⌕</Text></Pressable>}>
      <View style={{ alignItems: 'center', marginTop: 16 }}>
        <Text style={styles.h1}>{greeting()}, {state.user.displayName}!</Text>
        <Text style={styles.sub}>{sync.status === 'failed' ? 'Save failed · tap to retry' : sync.status === 'syncing' ? 'Syncing your study data…' : 'All study data saved'}</Text>
      </View>

      <Pressable style={styles.vod} onPress={() => nav.push('Bible', { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse })}>
        <Text style={styles.vodLabel}>VERSE OF THE DAY · {state.translation}</Text>
        <Text style={styles.vodText}>{vodText}</Text>
        <Text style={styles.vodRef}>{refLabel(vod.bookId, vod.chapter, vod.verse)}</Text>
        <Text style={styles.vodQ}>{vod.reflection}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Button small kind="ghost" label="Read in context" onPress={() => nav.push('Bible', { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse })} />
          <Button small kind="ghost" label="Save" onPress={() => dispatch({ type: 'bookmark', b: { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse, folder: 'Verse of the Day' } })} />
          <Button small kind="ghost" label="Pray" onPress={() => nav.push('NewPrayer', { verse: refLabel(vod.bookId, vod.chapter, vod.verse) })} />
        </View>
      </Pressable>

      <Section title="Continue studying" action="Library" onAction={() => nav.push('Library')}>
        <View style={styles.grid}>
          <Card compact color={colors.teal} question="Last read" title={CHAPTER_TITLES[`${lp.bookId}:${lp.chapter}`] || refLabel(lp.bookId, lp.chapter)} subtitle={refLabel(lp.bookId, lp.chapter)} onPress={() => nav.push('Bible', lp)} />
          <Card compact color={colors.lavender} question={`Day ${plan.done + 1} of ${plan.days}`} title={plan.name} subtitle={refLabel(plan.today.bookId, plan.today.chapter)} onPress={() => nav.push('Plan', { id: plan.id })} />
        </View>
      </Section>

      {live.length ? (
        <Section title="Live now" action="All live" onAction={() => nav.push('Live')}>
          {live.map((l) => (
            <Row key={l.id} title={l.title} subtitle={`${l.host} · ${l.language}${l.captions ? ' · Captions' : ''}`} left={<Text style={{ color: '#e85d5d', fontSize: 10 }}>●</Text>} right={<Badge label={`${l.viewers} watching`} tint="#e85d5d" />} onPress={() => nav.push('Live', { id: l.id })} />
          ))}
        </Section>
      ) : null}

      <Section title="Prayer activity" action="Prayer wall" onAction={() => nav.push('PrayerTab')}>
        {activePrayers.map((p) => (
          <Row key={p.id} title={p.title} subtitle={`${p.author} · ${p.audience}`} right={<Text style={{ color: colors.muted, fontSize: 11 }}>🙏 {p.praying}</Text>} onPress={() => nav.push('Prayer', { id: p.id })} />
        ))}
      </Section>

      <Section title="Your communities" action="Explore" onAction={() => nav.push('Communities')}>
        {state.communities.filter((c) => c.joined === true).map((c) => (
          <Row key={c.id} title={c.name} subtitle={`${c.members.toLocaleString()} members · ${c.privacy}`} right={c.verified ? <Badge label="Verified" /> : null} onPress={() => nav.push('Group', { id: c.id })} />
        ))}
      </Section>

      {nextEvent ? (
        <Section title="Upcoming" action="Calendar" onAction={() => nav.push('Calendar')}>
          <Row title={nextEvent.title} subtitle={`${nextEvent.date}${nextEvent.time ? ' · ' + nextEvent.time : ''}${nextEvent.where ? ' · ' + nextEvent.where : ''}`} right={<Tag label={nextEvent.kind} />} onPress={() => nav.push('Calendar')} />
        </Section>
      ) : null}

      <Section title="For you" action="Feed" onAction={() => nav.push('Feed')}>
        {state.feed.slice(0, 3).map((f) => (
          <Pressable key={f.id} style={styles.post} onPress={() => nav.push('Feed')}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.postAuthor}>{f.author}</Text>
              <Tag label={f.kind} />
            </View>
            <Text style={styles.postText}>{f.text}</Text>
            <Text style={styles.postMeta}>{f.time} · {f.likes} amens · {f.comments} comments</Text>
          </Pressable>
        ))}
      </Section>

      <Button label="＋ Create" onPress={() => nav.push('Create')} style={{ marginTop: 24 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '600', color: colors.fg, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: colors.muted, marginTop: 6 },
  vod: { marginTop: 22, backgroundColor: colors.cardBottom, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 16 },
  vodLabel: { fontSize: 9, letterSpacing: 2, color: colors.muted },
  vodText: { fontSize: 15, lineHeight: 22, color: colors.fg, marginTop: 10 },
  vodRef: { fontSize: 11, color: colors.teal, marginTop: 8, fontWeight: '600' },
  vodQ: { fontSize: 11, color: colors.muted, marginTop: 10, fontStyle: 'italic', lineHeight: 15 },
  grid: { flexDirection: 'row', gap: 12 },
  post: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.tabLine },
  postAuthor: { fontSize: 12, fontWeight: '600', color: colors.fg },
  postText: { fontSize: 12.5, color: colors.passage, lineHeight: 18, marginTop: 6 },
  postMeta: { fontSize: 10, color: colors.muted, marginTop: 6 },
});
