import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Row, Badge, Tag, Button, Eyebrow, alpha } from '../components/ui';
import Card from '../components/Card';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { verseOfDay, getChapter, refLabel, CHAPTER_TITLES } from '../data/bible';
import { useToast } from '../components/Toast';
import { dayKey } from '../data/rhythm';
import { CALENDAR, LIVE } from '../data/seed';
import { PressScale, FadeInUp, Pop, LiveRing } from '../components/Motion';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
}

export default function HomeScreen() {
  const { state, dispatch, sync } = useStore();
  const nav = useNav();
  const toast = useToast();
  const vod = verseOfDay();
  const ch = (getChapter(state.translation, vod.bookId, vod.chapter) || getChapter('KJV', vod.bookId, vod.chapter) || []);
  const vodText = ch[vod.verse - 1] || 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';
  const plan = state.plans?.[0] || null;
  const lp = state.lastPosition || { bookId: 'MAT', chapter: 1 };
  const nextEvent = (CALENDAR || []).find((e) => e.date >= dayKey());
  const live = (LIVE || []).filter((l) => l.status === 'live');
  const activePrayers = (state.prayers || []).filter((p) => p.status !== 'answered').slice(0, 2);
  const vodSaved = (state.bookmarks || []).some((b) => b.bookId === vod.bookId && b.chapter === vod.chapter && b.verse === vod.verse);

  return (
    <Screen
      title="BibleNestra"
      subtitle="Sacred Study & Fellowship"
      menu={() => nav.push('Profile')}
      right={
        <Pressable onPress={() => nav.push('Search')} hitSlop={12} style={styles.searchIconBtn}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Path d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" stroke={colors.fg} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </Pressable>
      }
    >
      {/* Editorial Header */}
      <FadeInUp style={styles.header}>
        <Pressable
          style={styles.statusChip}
          disabled={sync.status !== 'failed'}
          onPress={() => { if (sync.retry) { sync.retry(); toast.show('Retrying sync…', { icon: 'repost' }); } }}
        >
          <View style={[styles.statusDot, { backgroundColor: sync.status === 'failed' ? colors.negative : colors.positive }]} />
          <Text style={styles.statusText}>
            {sync.status === 'failed' ? 'Tap to retry sync' : sync.status === 'syncing' ? 'Saving…' : 'Saved on this device'}
          </Text>
        </Pressable>
        <Text style={styles.h1}>{greeting()}, {state.user.displayName}</Text>
        <Text style={styles.sub}>Walk in faith, grace, and understanding today.</Text>
      </FadeInUp>

      {/* Editorial Masterpiece: Verse of the Day Card */}
      <FadeInUp index={1} style={styles.vodCard}>
        <View style={styles.vodGlow} />
        <View style={styles.vodHeadRow}>
          <Icon name="sun" size={14} color={colors.goldLight} />
          <Eyebrow tint={colors.goldLight}>Verse of the day · {state.translation}</Eyebrow>
        </View>

        <Text style={styles.vodText}>“{vodText}”</Text>

        <Text style={styles.vodRef}>{refLabel(vod.bookId, vod.chapter, vod.verse)}</Text>

        {vod.reflection ? (
          <Text style={styles.vodReflection}>{vod.reflection}</Text>
        ) : null}

        <View style={styles.vodActions}>
          <PressScale
            scaleTo={0.94}
            style={styles.vodActionBtn}
            onPress={() => nav.push('Bible', { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse })}
          >
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ marginRight: 4 }}>
              <Path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z" stroke={colors.nightFg} strokeWidth={1.8} />
              <Path d="M6.5 2H20v4H6.5A2.5 2.5 0 0 0 4 8.5" stroke={colors.nightFg} strokeWidth={1.8} />
            </Svg>
            <Text style={styles.vodActionText}>Read Chapter</Text>
          </PressScale>

          <PressScale
            scaleTo={0.94}
            style={[styles.vodActionBtn, vodSaved && styles.vodActionOn]}
            onPress={() => {
              const saved = (state.bookmarks || []).some((b) => b.bookId === vod.bookId && b.chapter === vod.chapter && b.verse === vod.verse);
              dispatch({ type: 'bookmark', b: { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse, folder: 'Verse of the Day' } });
              toast.show(saved ? 'Bookmark removed' : `${refLabel(vod.bookId, vod.chapter, vod.verse)} bookmarked`, { icon: 'bookmark', action: saved ? undefined : { label: 'View', onPress: () => nav.push('Library') } });
            }}
          >
            <Pop trigger={vodSaved} style={{ marginRight: 4 }}>
              <Svg width={13} height={13} viewBox="0 0 24 24" fill={vodSaved ? colors.goldLight : 'none'}>
                <Path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" stroke={vodSaved ? colors.goldLight : colors.nightFg} strokeWidth={1.8} />
              </Svg>
            </Pop>
            <Text style={styles.vodActionText}>{vodSaved ? 'Saved' : 'Bookmark'}</Text>
          </PressScale>

          <PressScale
            scaleTo={0.94}
            style={styles.vodActionBtn}
            onPress={() => nav.push('NewPrayer', { verse: refLabel(vod.bookId, vod.chapter, vod.verse) })}
          >
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ marginRight: 4 }}>
              <Path d="M12 3v18M7 8h10" stroke={colors.nightFg} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
            <Text style={styles.vodActionText}>Intercede</Text>
          </PressScale>
        </View>
      </FadeInUp>

      {/* Continue Studying Section */}
      <FadeInUp index={2}>
      <Section title="Continue Studying" action="Library" onAction={() => nav.push('Library')}>
        <View style={styles.grid}>
          <Card
            compact
            color={colors.primary}
            icon={
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                <Path d="M12 6.5C10.3 5.2 7.9 4.5 4 4.5v13c3.9 0 6.3.7 8 2 1.7-1.3 4.1-2 8-2v-13c-3.9 0-6.3.7-8 2z" stroke={colors.primary} strokeWidth={1.9} strokeLinejoin="round" />
                <Path d="M12 6.5v13" stroke={colors.primary} strokeWidth={1.9} />
              </Svg>
            }
            question="Recent Reading"
            title={CHAPTER_TITLES[`${lp.bookId}:${lp.chapter}`] || refLabel(lp.bookId, lp.chapter)}
            subtitle={refLabel(lp.bookId, lp.chapter)}
            onPress={() => nav.push('Bible', lp)}
          />
          <Card
            compact
            color={colors.indigo}
            icon="sparkles"
            question={plan ? `Day ${Math.min(plan.done + 1, plan.days)} of ${plan.days}` : 'Reading plans'}
            title={plan ? plan.name : 'Start a plan'}
            subtitle={plan ? refLabel(plan.today.bookId, plan.today.chapter) : 'Browse plans in Learn'}
            onPress={() => (plan ? nav.push('Plan', { id: plan.id }) : nav.push('Learn'))}
          />
        </View>
      </Section>
      </FadeInUp>

      {/* Live Fellowship if active */}
      <FadeInUp index={3}>
      {live.length ? (
        <Section title="Live Now" action="All live" onAction={() => nav.push('Live')}>
          {live.map((l) => (
            <Row
              key={l.id}
              title={l.title}
              subtitle={`${l.host} · ${l.language}${l.captions ? ' · Captions' : ''}`}
              left={<View style={{ width: 18, alignItems: 'center' }}><LiveRing color={colors.rose} size={8} /></View>}
              right={<Badge label={`${l.viewers} watching`} tint={colors.rose} />}
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
            left={<Icon name="prayer" size={18} color={colors.gold} />}
            right={<Text style={styles.prayingText}>{p.praying} praying</Text>}
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
            left={<Icon name="users" size={18} color={colors.sage} />}
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
            left={<Icon name="calendar" size={18} color={colors.primary} />}
            right={<Tag label={nextEvent.kind} tint={colors.teal} />}
            onPress={() => nav.push('Calendar')}
          />
        </Section>
      ) : null}

      </FadeInUp>

      {/* Primary Action Button */}
      <Button
        label="Create Post or Request"
        onPress={() => nav.push('Create')}
        style={{ marginTop: 28 }}
        icon={<Icon name="sparkles" size={15} color="#FFFFFF" />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  header: {
    alignItems: 'center',
    marginTop: 10,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    fontWeight: '500',
    color: colors.muted,
  },
  h1: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 34,
    color: colors.fg,
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.serifItalic,
    fontSize: 15.5,
    color: colors.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  vodCard: {
    backgroundColor: colors.night,
    borderRadius: radius.xl,
    padding: 20,
    marginTop: 22,
    overflow: 'hidden',
    ...shadow.md,
  },
  vodGlow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    top: -130,
    right: -80,
    backgroundColor: alpha(colors.indigo, 0.32),
  },
  vodHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  vodText: {
    fontFamily: fonts.serifItalic,
    fontSize: 20,
    lineHeight: 30,
    color: colors.nightFg,
    letterSpacing: -0.2,
  },
  vodRef: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.goldLight,
    marginTop: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  vodReflection: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.nightMuted,
    lineHeight: 19,
    marginTop: 12,
    borderLeftWidth: 2,
    borderLeftColor: alpha(colors.goldLight, 0.5),
    paddingLeft: 11,
  },
  vodActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.nightBorder,
  },
  vodActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.nightRaised,
    borderWidth: 1,
    borderColor: colors.nightBorder,
  },
  vodActionOn: {
    borderColor: alpha(colors.goldLight, 0.45),
  },
  vodActionText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.nightFg,
    fontWeight: '600',
  },
  prayingText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '600',
    color: colors.goldMuted,
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
});
