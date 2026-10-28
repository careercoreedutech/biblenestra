import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Row, Badge, Tag, Button } from '../components/ui';
import Card from '../components/Card';
import { colors, fonts } from '../theme';
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
  const ch = (getChapter(state.translation, vod.bookId, vod.chapter) || getChapter('KJV', vod.bookId, vod.chapter) || []);
  const vodText = ch[vod.verse - 1] || 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';
  const plan = state.plans?.[0] || { done: 0, days: 1, name: 'Daily Reading', today: { bookId: 'MAT', chapter: 1 }, id: 'p1' };
  const lp = state.lastPosition || { bookId: 'MAT', chapter: 1 };
  const nextEvent = (CALENDAR || []).find((e) => e.date >= '2026-10-25');
  const live = (LIVE || []).filter((l) => l.status === 'live');
  const activePrayers = (state.prayers || []).filter((p) => p.status !== 'answered').slice(0, 2);

  return (
    <Screen
      title="BibleNestra"
      subtitle="Sacred Study & Fellowship"
      menu={() => nav.push('Profile')}
      right={
        <Pressable onPress={() => nav.push('Search')} hitSlop={12} style={styles.searchIconBtn}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Path d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" stroke={colors.fg} strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        </Pressable>
      }
    >
      {/* Editorial Header */}
      <View style={styles.header}>
        <View style={styles.statusChip}>
          <View style={[styles.statusDot, { backgroundColor: sync.status === 'failed' ? colors.negative : colors.positive }]} />
          <Text style={styles.statusText}>
            {sync.status === 'failed' ? 'Tap to retry sync' : sync.status === 'syncing' ? 'Syncing...' : 'All synced'}
          </Text>
        </View>
        <Text style={styles.h1}>{greeting()}, {state.user.displayName}</Text>
        <Text style={styles.sub}>Walk in faith, grace, and understanding today.</Text>
      </View>

      {/* Editorial Masterpiece: Verse of the Day Card */}
      <View style={styles.vodCard}>
        <View style={styles.vodHeadRow}>
          <Text style={styles.vodBadgeLabel}>VERSE OF THE DAY · {state.translation}</Text>
        </View>

        <Text style={styles.vodText}>"{vodText}"</Text>

        <Text style={styles.vodRef}>{refLabel(vod.bookId, vod.chapter, vod.verse)}</Text>

        {vod.reflection ? (
          <Text style={styles.vodReflection}>{vod.reflection}</Text>
        ) : null}

        <View style={styles.vodActions}>
          <Pressable
            style={styles.vodActionBtn}
            onPress={() => nav.push('Bible', { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse })}
          >
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ marginRight: 5 }}>
              <Path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z" stroke={colors.fg} strokeWidth={1.8} />
              <Path d="M6.5 2H20v4H6.5A2.5 2.5 0 0 0 4 8.5" stroke={colors.fg} strokeWidth={1.8} />
            </Svg>
            <Text style={styles.vodActionText}>Read Chapter</Text>
          </Pressable>

          <Pressable
            style={styles.vodActionBtn}
            onPress={() => dispatch({ type: 'bookmark', b: { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse, folder: 'Verse of the Day' } })}
          >
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ marginRight: 5 }}>
              <Path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" stroke={colors.fg} strokeWidth={1.8} />
            </Svg>
            <Text style={styles.vodActionText}>Bookmark</Text>
          </Pressable>

          <Pressable
            style={styles.vodActionBtn}
            onPress={() => nav.push('NewPrayer', { verse: refLabel(vod.bookId, vod.chapter, vod.verse) })}
          >
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ marginRight: 5 }}>
              <Path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke={colors.fg} strokeWidth={1.8} />
            </Svg>
            <Text style={styles.vodActionText}>Intercede</Text>
          </Pressable>
        </View>
      </View>

      {/* Continue Studying Section */}
      <Section title="Continue Studying" action="Library" onAction={() => nav.push('Library')}>
        <View style={styles.grid}>
          <Card
            compact
            color={colors.gold}
            icon="📖"
            question="Recent Reading"
            title={CHAPTER_TITLES[`${lp.bookId}:${lp.chapter}`] || refLabel(lp.bookId, lp.chapter)}
            subtitle={refLabel(lp.bookId, lp.chapter)}
            onPress={() => nav.push('Bible', lp)}
          />
          <Card
            compact
            color={colors.lavender}
            icon="✦"
            question={`Day ${plan.done + 1} of ${plan.days}`}
            title={plan.name}
            subtitle={refLabel(plan.today.bookId, plan.today.chapter)}
            onPress={() => nav.push('Plan', { id: plan.id })}
          />
        </View>
      </Section>

      {/* Live Fellowship if active */}
      {live.length ? (
        <Section title="Live Now" action="All live" onAction={() => nav.push('Live')}>
          {live.map((l) => (
            <Row
              key={l.id}
              title={l.title}
              subtitle={`${l.host} · ${l.language}${l.captions ? ' · Captions' : ''}`}
              left={<Text style={{ color: colors.negative, fontSize: 10 }}>●</Text>}
              right={<Badge label={`${l.viewers} watching`} tint={colors.negative} />}
              onPress={() => nav.push('Live', { id: l.id })}
            />
          ))}
        </Section>
      ) : null}

      {/* Prayer Wall Preview */}
      <Section title="Prayer Wall" action="View all" onAction={() => nav.push('PrayerTab')}>
        {activePrayers.map((p) => (
          <Row
            key={p.id}
            title={p.title}
            subtitle={`${p.author} · ${p.audience}`}
            right={<Text style={{ color: colors.gold, fontFamily: fonts.sans, fontSize: 12 }}>{p.praying} praying</Text>}
            onPress={() => nav.push('Prayer', { id: p.id })}
          />
        ))}
      </Section>

      {/* Communities */}
      <Section title="Your Communities" action="Explore" onAction={() => nav.push('Communities')}>
        {state.communities.filter((c) => c.joined === true).map((c) => (
          <Row
            key={c.id}
            title={c.name}
            subtitle={`${c.members.toLocaleString()} members · ${c.privacy}`}
            right={c.verified ? <Badge label="Verified" tint={colors.gold} /> : null}
            onPress={() => nav.push('Group', { id: c.id })}
          />
        ))}
      </Section>

      {/* Upcoming Events */}
      {nextEvent ? (
        <Section title="Upcoming" action="Calendar" onAction={() => nav.push('Calendar')}>
          <Row
            title={nextEvent.title}
            subtitle={`${nextEvent.date}${nextEvent.time ? ' · ' + nextEvent.time : ''}${nextEvent.where ? ' · ' + nextEvent.where : ''}`}
            right={<Tag label={nextEvent.kind} tint={colors.teal} />}
            onPress={() => nav.push('Calendar')}
          />
        </Section>
      ) : null}

      {/* Primary Action Button */}
      <Button
        label="Create Post or Request"
        onPress={() => nav.push('Create')}
        style={{ marginTop: 24 }}
      />
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
  header: {
    alignItems: 'center',
    marginTop: 12,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.muted,
  },
  h1: {
    fontFamily: fonts.sansMedium,
    fontSize: 21,
    fontWeight: '600',
    color: colors.fg,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  vodCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginTop: 18,
  },
  vodHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  vodBadgeLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.gold,
    letterSpacing: 0.6,
  },
  vodText: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 25,
    color: colors.passage,
    letterSpacing: -0.1,
  },
  vodRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '600',
    color: colors.gold,
    marginTop: 10,
    letterSpacing: 0.1,
  },
  vodReflection: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    paddingLeft: 10,
  },
  vodActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  vodActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vodActionText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.fg,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
});
