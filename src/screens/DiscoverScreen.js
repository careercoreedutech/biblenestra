import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Image } from 'react-native';
import Card from '../components/Card';
import AskBar from '../components/AskBar';
import { Screen, Section, Row, Pills, Button, Input, Tag, Badge, Notice, Empty, Divider } from '../components/ui';
import { colors, fonts } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { CALENDAR, CHANNELS, COMMUNITY_CATEGORIES, PEOPLE, LIVE, CARE_OPTIONS, CHANNELS_DATA } from '../data/seed';
import { refLabel, VERSE_OF_DAY, getChapter } from '../data/bible';

// ---------- Discover Hub (HelloBible+ & Taste Skill Aesthetic) ----------
export default function DiscoverScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const unread = (state.chats || []).reduce((n, c) => n + (c.unread || 0), 0) + ((state.requests || []).length);
  const recentPrayers = (state.prayers || []).slice(0, 3);
  const featuredVideos = (state.videos || []).slice(0, 4);
  const featuredJobs = (state.jobs || []).slice(0, 3);

  // Verse of the Day (PDF Page 4)
  const vod = VERSE_OF_DAY || { bookId: 'MAT', chapter: 9, verse: 37 };
  const vodText = 'Then he said to his disciples, "The harvest is plentiful but the workers are few. Ask the Lord of the harvest, therefore, to send out workers into his harvest field."';

  // Activities Checklist state (PDF Page 4)
  const [completedActivities, setCompletedActivities] = useState(['a1', 'a2']);
  const toggleActivity = (id) => {
    setCompletedActivities((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <Screen
      title="BibleNestra"
      subtitle="Understand God's Word · Fellowship · Grow"
      menu={() => nav.push('Profile')}
      right={
        <Pressable onPress={() => nav.push('Search')} hitSlop={12} style={styles.searchIconBtn}>
          <Text style={{ color: colors.forest, fontSize: 16, fontWeight: '700' }}>⌕</Text>
        </Pressable>
      }
    >
      {/* 1. The Epic Story Banner / Daily Refresh Header (PDF Page 1 & 4) */}
      <View style={styles.heroBanner}>
        <View style={styles.heroBannerContent}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>DAILY REFRESH</Text>
          </View>
          <Text style={styles.heroTitle}>The Epic Story of the Bible</Text>
          <Text style={styles.heroSub}>Understand Scripture, reflect with believers, and walk in grace.</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Pressable
              style={styles.heroPrimaryBtn}
              onPress={() => nav.push('Bible', { bookId: vod.bookId, chapter: vod.chapter, verse: vod.verse })}
            >
              <Text style={styles.heroPrimaryBtnText}>Read Now →</Text>
            </Pressable>
            <Pressable
              style={styles.heroSecondaryBtn}
              onPress={() => nav.push('Learn')}
            >
              <Text style={styles.heroSecondaryBtnText}>Study Plans</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* 2. Verse of the Day Card (PDF Page 4) */}
      <View style={styles.vodCard}>
        <View style={styles.vodTopRow}>
          <Text style={styles.vodLabel}>VERSE OF THE DAY</Text>
          <Text style={styles.vodRefText}>Matthew 9:37-38 · {state.translation}</Text>
        </View>

        <Text style={styles.vodQuote}>"{vodText}"</Text>

        <View style={styles.vodInteractionsRow}>
          <Pressable style={styles.vodMetricBtn} onPress={() => dispatch({ type: 'like', id: 'vod' })}>
            <Text style={styles.vodMetricText}>♡ 208.4k</Text>
          </Pressable>
          <Pressable style={styles.vodMetricBtn} onPress={() => nav.push('Feed')}>
            <Text style={styles.vodMetricText}>💬 169</Text>
          </Pressable>
          <Pressable style={styles.vodMetricBtn}>
            <Text style={styles.vodMetricText}>↗ 56,271</Text>
          </Pressable>
          <Pressable
            style={[styles.vodMetricBtn, { marginLeft: 'auto' }]}
            onPress={() => nav.push('Bible', { bookId: 'MAT', chapter: 9, verse: 37 })}
          >
            <Text style={[styles.vodMetricText, { color: colors.forest, fontWeight: '700' }]}>Expand ›</Text>
          </Pressable>
        </View>
      </View>

      {/* 3. "Be Inspired" Horizontal Pastel Cards (PDF Page 1) */}
      <Section title="Be Inspired">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
          <Pressable
            style={[styles.beInspiredCard, { backgroundColor: colors.cardGold, borderColor: colors.gold + '40' }]}
            onPress={() => nav.push('Bible', { bookId: vod.bookId, chapter: vod.chapter })}
          >
            <Text style={styles.beInspiredEmoji}>✨</Text>
            <Text style={styles.beInspiredTitle}>Verse of the Day</Text>
            <Text style={styles.beInspiredSub}>Boost your day</Text>
            <View style={styles.beInspiredArrowBox}>
              <Text style={[styles.beInspiredArrow, { color: colors.gold }]}>→</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.beInspiredCard, { backgroundColor: colors.cardSage, borderColor: colors.sage + '40' }]}
            onPress={() => nav.push('Learn', { tab: 'Devotionals' })}
          >
            <Text style={styles.beInspiredEmoji}>🌱</Text>
            <Text style={styles.beInspiredTitle}>The Bible Told</Text>
            <Text style={styles.beInspiredSub}>Like an adventure</Text>
            <View style={styles.beInspiredArrowBox}>
              <Text style={[styles.beInspiredArrow, { color: colors.sage }]}>→</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.beInspiredCard, { backgroundColor: colors.cardRose, borderColor: colors.rose + '40' }]}
            onPress={() => nav.push('NewPrayer')}
          >
            <Text style={styles.beInspiredEmoji}>🕊</Text>
            <Text style={styles.beInspiredTitle}>Guided Prayer</Text>
            <Text style={styles.beInspiredSub}>Conversation with God</Text>
            <View style={styles.beInspiredArrowBox}>
              <Text style={[styles.beInspiredArrow, { color: colors.rose }]}>→</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.beInspiredCard, { backgroundColor: colors.cardLavender, borderColor: colors.lavender + '40' }]}
            onPress={() => nav.push('SermonStudio')}
          >
            <Text style={styles.beInspiredEmoji}>🎙</Text>
            <Text style={styles.beInspiredTitle}>Sermon Studio</Text>
            <Text style={styles.beInspiredSub}>Notes & Reflections</Text>
            <View style={styles.beInspiredArrowBox}>
              <Text style={[styles.beInspiredArrow, { color: colors.lavender }]}>→</Text>
            </View>
          </Pressable>
        </ScrollView>
      </Section>

      {/* 4. "Today's Activities" Spiritual Progress Checklist (PDF Page 4) */}
      <Section
        title="Today's Activities"
        right={<Text style={{ color: colors.muted, fontSize: 11 }}>Day 1 of your plan</Text>}
      >
        <View style={styles.activitiesCard}>
          {[
            { id: 'a1', title: 'Path to Freedom', subtitle: 'Daily Guided Prayer · 3 min', icon: '🙏' },
            { id: 'a2', title: "Today's Scripture and Word", subtitle: 'Discover wisdom in Matthew 9 · 4 min', icon: '📖' },
            { id: 'a3', title: 'Scripture Quiz', subtitle: 'Sharpen your Bible knowledge', icon: '✦' },
            { id: 'a4', title: 'One-Time Action', subtitle: 'Encourage someone in faith today', icon: '🤍' },
            { id: 'a5', title: 'Daily Reflection', subtitle: "Reconnect with God's love within", icon: '🕊' },
          ].map((item) => {
            const isDone = completedActivities.includes(item.id);
            return (
              <Pressable
                key={item.id}
                style={styles.activityRow}
                onPress={() => toggleActivity(item.id)}
              >
                <View style={[styles.activityCheckCircle, isDone && styles.activityCheckCircleActive]}>
                  <Text style={[styles.activityCheckMark, isDone && { color: '#FFFFFF' }]}>
                    {isDone ? '✓' : ''}
                  </Text>
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.activityTitle, isDone && styles.activityTitleDone]}>
                    {item.title}
                  </Text>
                  <Text style={styles.activitySub}>{item.subtitle}</Text>
                </View>

                <Text style={styles.activityIcon}>{item.icon}</Text>
              </Pressable>
            );
          })}

          <View style={styles.activityFooterRow}>
            <Text style={styles.countdownTimerText}>⏳ New activities in 06:41:35</Text>
          </View>
        </View>
      </Section>

      {/* 5. "Deepen Your Faith" Guide (PDF Page 1) */}
      <Section title="Deepen Your Faith">
        <Row
          title="What does the Bible say?"
          subtitle="Direct answers from Scripture on peace, purpose & life"
          right="→"
          left={<Text style={{ fontSize: 18 }}>📖</Text>}
          onPress={() => nav.push('Bible', { bookId: 'JHN', chapter: 3 })}
        />
        <Row
          title="What did Jesus say?"
          subtitle="The words, parables, and commands of our Lord"
          right="→"
          left={<Text style={{ fontSize: 18 }}>✝</Text>}
          onPress={() => nav.push('Bible', { bookId: 'MAT', chapter: 5 })}
        />
        <Row
          title="Sancti & Patres"
          subtitle="Wisdom, theology, and reflections from the early church"
          right="→"
          left={<Text style={{ fontSize: 18 }}>📜</Text>}
          onPress={() => nav.push('Learn', { tab: 'Devotionals' })}
        />
        <Row
          title="Biblical Exegesis & Lexicon"
          subtitle="Strong's Greek and Hebrew root word study"
          right="→"
          left={<Text style={{ fontSize: 18, color: colors.gold }}>✦</Text>}
          onPress={() => nav.push('Concordance')}
        />
      </Section>

      {/* 6. Trending Christian Socials (Short Videos Preview) */}
      <Section
        title="Trending on Socials"
        right={
          <Pressable onPress={() => nav.push('Socials')}>
            <Text style={styles.sectionActionText}>Watch All ›</Text>
          </Pressable>
        }
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
          {featuredVideos.map((v) => (
            <Pressable
              key={v.id}
              style={styles.videoCard}
              onPress={() => nav.push('Socials', { initialVideoId: v.id })}
            >
              <View style={[styles.videoThumb, { backgroundColor: '#1E2922' }]}>
                <View style={styles.videoBadge}>
                  <Text style={styles.videoBadgeText}>▶ {v.views}</Text>
                </View>
                <View style={{ position: 'absolute', bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.videoCreatorName} numberOfLines={1}>{v.creator?.name || 'Creator'}</Text>
                  <Text style={styles.videoCaptionPreview} numberOfLines={2}>{v.caption}</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </Section>

      {/* 7. Prayer Wall & Intercession (Page 6 Relocation) */}
      <Section
        title="Prayer Wall & Intercession"
        right={
          <Pressable onPress={() => nav.push('PrayerWall')}>
            <Text style={styles.sectionActionText}>View Wall ›</Text>
          </Pressable>
        }
      >
        <View style={styles.prayerHubCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <View>
              <Text style={styles.prayerHubTitle}>Spiritual Intercession</Text>
              <Text style={styles.prayerHubSub}>Lift your brothers and sisters in prayer right now</Text>
            </View>
            <Pressable
              onPress={() => nav.push('NewPrayer')}
              style={styles.submitPrayerSmallBtn}
            >
              <Text style={styles.submitPrayerSmallBtnText}>＋ Pray Request</Text>
            </Pressable>
          </View>

          {recentPrayers.map((p) => (
            <View key={p.id} style={styles.prayerItemRow}>
              <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                <Text style={styles.prayerItemTitle} numberOfLines={1}>{p.title}</Text>
                <Text style={styles.prayerItemSub} numberOfLines={1}>{p.author} · {p.audience} · {p.praying} praying</Text>
              </View>
              <Pressable
                onPress={() => dispatch({ type: 'pray', id: p.id })}
                style={[styles.quickPrayBtn, p.prayed && styles.quickPrayBtnOn]}
              >
                <Text style={[styles.quickPrayBtnText, p.prayed && { color: '#FFFFFF' }]}>
                  {p.prayed ? 'Praying ✓' : '🙏 Pray'}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      </Section>

      {/* 8. Christian Jobs & Tasks Marketplace */}
      <Section
        title="Christian Jobs & Tasks"
        right={
          <Pressable onPress={() => nav.push('Jobs')}>
            <Text style={styles.sectionActionText}>Marketplace ›</Text>
          </Pressable>
        }
      >
        <View style={styles.jobsCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <View>
              <Text style={styles.jobHeading}>Kingdom Work & Opportunities</Text>
              <Text style={styles.jobSub}>Hire verified believers, find gigs, and serve churches</Text>
            </View>
            <Button small label="Browse Gigs" onPress={() => nav.push('Jobs')} />
          </View>
          {featuredJobs.map((j) => (
            <Pressable key={j.id} style={styles.jobItem} onPress={() => nav.push('Jobs')}>
              <View style={{ flex: 1 }}>
                <Text style={styles.jobItemTitle}>{j.title}</Text>
                <Text style={styles.jobItemMeta}>{j.client?.name || j.postedBy || 'Church Ministry'} · {j.category} · {j.budget}</Text>
              </View>
              <Tag label={j.kind} tint={colors.forest} />
            </Pressable>
          ))}
        </View>
      </Section>

      {/* 9. Fellowship & Communities */}
      <Section title="Churches & Bible Studies">
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card
            compact
            title="Communities"
            subtitle="Churches & study circles"
            color={colors.forest}
            icon="👥"
            onPress={() => nav.push('Communities')}
          />
          <Card
            compact
            title="Chat & Groups"
            subtitle={unread ? `${unread} messages waiting` : 'Direct & group messaging'}
            color={colors.lavender}
            icon="💬"
            onPress={() => nav.push('ChatList')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <Card
            compact
            title="Find Believers"
            subtitle="Discover Christian professionals"
            color={colors.gold}
            icon="🕊"
            onPress={() => nav.push('People')}
          />
          <Card
            compact
            title="Live Fellowship"
            subtitle={`${(LIVE || []).filter((l) => l.status === 'live').length} active fellowships`}
            color={colors.terracotta}
            icon="●"
            onPress={() => nav.push('Live')}
          />
        </View>
      </Section>

      {/* 10. Channels & Broadcasts */}
      <Section title="Channels & Broadcasts">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
          {CHANNELS_DATA.map((ch) => (
            <View key={ch.id} style={styles.channelCard}>
              <View style={styles.channelPreview}>
                <Text style={styles.channelPreviewIcon}>📡</Text>
                <View style={styles.channelFollowersBadge}>
                  <Text style={styles.channelFollowersText}>{ch.followers} followers</Text>
                </View>
              </View>
              <View style={{ padding: 12 }}>
                <Text style={styles.channelName} numberOfLines={1}>{ch.name}</Text>
                <Text style={styles.channelVideoTitle} numberOfLines={1}>{ch.videoTitle || ch.recentVideo?.title || 'Watch Message'}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
                  <Button small kind="ghost" label="Watch" onPress={() => nav.push('Live')} />
                  <Button small label="Join" onPress={() => {}} />
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      </Section>

      <Button
        label="＋ Create Post, Group or Stream"
        onPress={() => nav.push('Create')}
        style={{ marginTop: 24, marginBottom: 36 }}
      />
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
            {c.verified ? <Badge label="Verified" tint={colors.gold} /> : null}
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
            {!msgs.length ? <Empty title={`No messages in #${channel} yet`} /> : null}
            {msgs.map((m) => (
              <View key={m.id} style={[styles.msg, m.mine && styles.msgMine]}>
                {!m.mine ? <Text style={styles.msgFrom}>{m.from}</Text> : null}
                <Text style={[styles.msgText, m.mine && { color: '#FFFFFF' }]}>{m.text}</Text>
                {m.passage ? <Pressable onPress={() => nav.push('Bible', m.passage)} style={styles.passageChip}><Text style={styles.passageChipText}>📖 {refLabel(m.passage.bookId, m.passage.chapter)} · Open</Text></Pressable> : null}
                {m.prayer ? <Pressable style={styles.passageChip}><Text style={styles.passageChipText}>🙏 I'm praying · {m.praying}</Text></Pressable> : null}
                {m.event ? <Pressable onPress={() => nav.push('Calendar')} style={styles.passageChip}><Text style={styles.passageChipText}>📅 RSVP · Add to calendar</Text></Pressable> : null}
                <Text style={[styles.msgTime, m.mine && { color: '#D4E2D8' }]}>{m.time}{m.mine ? ' · Delivered' : ''}</Text>
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

// ---------- Chat List + Conversation (WhatsApp-Style) ----------
export function ChatListScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState('All');
  const list = state.chats.filter((c) => tab === 'All' || (tab === 'Prayer' && c.type.includes('Prayer')) || (tab === 'Bible study' && c.type === 'Bible study') || (tab === 'Professional' && c.type === 'Professional'));
  return (
    <Screen
      title="Chats"
      subtitle="Direct, ministry & fellowship messaging"
      right={
        <Pressable onPress={() => nav.push('People')} hitSlop={10} style={styles.searchIconBtn}>
          <Text style={{ color: colors.forest, fontSize: 18, fontWeight: '700' }}>＋</Text>
        </Pressable>
      }
    >
      <Pills items={['All', 'Prayer', 'Bible study', 'Professional', 'Groups']} value={tab} onChange={(t) => (t === 'Groups' ? nav.push('Communities') : setTab(t))} />
      <Row title="Bible Exegesis Chat" subtitle="AI Scripture companion · separate from member messaging" left={<Text style={{ color: colors.gold }}>✦</Text>} right="›" tint={colors.teal} onPress={() => nav.push('BibleChat', {})} />
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
        {list.map((c) => (
          <Row
            key={c.id}
            title={c.with}
            subtitle={`${c.type} · ${c.last}`}
            left={
              <View style={[styles.avatar, { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.raised }]}>
                <Text style={{ color: colors.forest, fontWeight: '700', fontSize: 14 }}>{c.with[0]}</Text>
              </View>
            }
            right={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 10.5 }}>{c.time}</Text>
                {c.unread ? <Badge label={String(c.unread)} tint={colors.forest} /> : null}
              </View>
            }
            onPress={() => nav.push('Chat', { id: c.id })}
          />
        ))}
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
        <Notice tint={colors.teal} text="Direct messaging is private and respectful. You can block or report at any time." />
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
        <Text style={{ color: colors.muted, fontSize: 10.5, textAlign: 'center' }}>Private conversation · end-to-end encrypted</Text>
        {chat.messages.map((m) => (
          <View key={m.id} style={[styles.msg, m.mine && styles.msgMine]}>
            <Text style={[styles.msgText, m.mine && { color: '#FFFFFF' }]}>{m.text}</Text>
            <Text style={[styles.msgTime, m.mine && { color: '#D4E2D8' }]}>{m.time}{m.mine ? ' · Read ✓✓' : ''}</Text>
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
    <Screen back title="Calendar" subtitle="Personal · church · community · Christian observances" right={<Pressable onPress={() => nav.push('Create', { kind: 'Event' })} hitSlop={10}><Text style={{ color: colors.forest, fontSize: 20 }}>＋</Text></Pressable>}>
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
                  {e.kind === 'Church event' || e.kind === 'Community' ? <Pressable onPress={() => dispatch({ type: 'rsvp', id: e.id })}><Tag label={state.rsvps.includes(e.id) ? '✓ Going' : 'RSVP'} tint={state.rsvps.includes(e.id) ? colors.teal : colors.forest} /></Pressable> : <Pressable onPress={() => dispatch({ type: 'post', post: { kind: 'Celebration', text: `${e.title} · ${e.scripture}. Blessings from ${state.user.displayName}.` } })}><Tag label="Share greeting" tint={colors.forest} /></Pressable>}
                  <Tag label="Add to calendar" />
                </View>
              </View>
            </View>
          ))}
        </Section>
      ))}
    </Screen>
  );
}

// ---------- People (2-Column Visual Card Directory per PDF Spec) ----------
export function PeopleScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [f, setF] = useState('All');
  const list = PEOPLE.filter((p) => !state.blocked.includes(p.id)).filter((p) => f === 'All' || p.accepts.some((a) => a.toLowerCase().includes(f.toLowerCase())) || (f === 'Available now' && p.availability === 'Available now'));

  return (
    <Screen back title="Find Believers" subtitle="Christians open to fellowship and collaboration">
      <Pills small items={['All', 'Available now', 'Prayer', 'Bible study', 'Mentoring', 'Professional', 'Care']} value={f} onChange={setF} />

      <View style={styles.peopleGrid}>
        {list.map((p) => (
          <Pressable key={p.id} style={styles.personCard} onPress={() => nav.push('Person', { id: p.id })}>
            <View style={styles.personAvatarWrapper}>
              <View style={styles.personAvatar}>
                <Text style={styles.personAvatarText}>{p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</Text>
              </View>
              {p.availability === 'Available now' ? <View style={styles.personOnlineDot} /> : null}
            </View>

            <Text style={styles.personCardName} numberOfLines={1}>{p.name}</Text>
            <Text style={styles.personCardHeadline} numberOfLines={2}>{p.headline}</Text>
            <Text style={styles.personCardCountry} numberOfLines={1}>📍 {p.country}</Text>

            <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'center', marginVertical: 6 }}>
              {p.verified.slice(0, 1).map((v) => (
                <Badge key={v} label={v} tint={colors.forest} />
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, width: '100%' }}>
              <Pressable
                onPress={() => nav.push('Chat', { to: p.name, kind: p.accepts[0] })}
                style={styles.personChatBtn}
              >
                <Text style={styles.personChatBtnText}>Chat</Text>
              </Pressable>
              <Pressable
                onPress={() => dispatch({ type: 'follow', id: p.id })}
                style={[styles.personFollowBtn, state.follows.includes(p.id) && styles.personFollowBtnActive]}
              >
                <Text style={[styles.personFollowBtnText, state.follows.includes(p.id) && { color: colors.forest }]}>
                  {state.follows.includes(p.id) ? '✓' : '＋'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        ))}
      </View>
      <Notice text="Profile badges indicate verified membership or ministry identity. They do not replace local pastoral authority." />
    </Screen>
  );
}

export function PersonScreen({ params }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const p = PEOPLE.find((x) => x.id === params.id);
  if (!p) return <Screen back title="Profile"><Empty title="User not found" /></Screen>;
  return (
    <Screen back title={p.name} subtitle={p.headline}>
      <View style={{ alignItems: 'center', marginTop: 14 }}>
        <View style={[styles.avatar, { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.raised, borderColor: colors.forest }]}>
          <Text style={{ color: colors.forest, fontWeight: '700', fontSize: 24 }}>{p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</Text>
        </View>
        <Text style={[styles.cardTitle, { fontSize: 20, marginTop: 12 }]}>{p.name}</Text>
        <Text style={styles.cardMeta}>{p.headline} · {p.country} · {p.languages.join(', ')}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>{p.verified.map((v) => <Badge key={v} label={v} tint={colors.forest} />)}</View>
      </View>
      <Text style={[styles.cardBody, { marginTop: 16, textAlign: 'center', fontSize: 13.5, lineHeight: 20 }]}>{p.intro}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, justifyContent: 'center' }}>
        <Button small label="Send Message" disabled={p.availability === 'Not accepting'} onPress={() => nav.push('Chat', { to: p.name, kind: p.accepts[0] })} />
        <Button small kind="ghost" label={state.follows.includes(p.id) ? 'Following' : 'Follow'} onPress={() => dispatch({ type: 'follow', id: p.id })} />
        <Button small kind="ghost" label="Block" onPress={() => { dispatch({ type: 'block', id: p.id }); nav.pop(); }} />
      </View>
      <Section title="Accepts"><View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{p.accepts.map((a) => <Tag key={a} label={a} tint={colors.teal} />)}</View></Section>
      <Section title="Interests"><View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{p.interests.map((i) => <Tag key={i} label={i} />)}</View></Section>
      <Section title="Professional Profile">
        <Row title="Experience & Ministry" subtitle="Work history, church service" right="›" />
        <Row title="Christian Portfolio" subtitle="Sermons, studies, published work" right="›" />
      </Section>
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
      <Notice tint={colors.teal} text="Sensitive conversations are private by default and never shared or monetized." />
      {!choice ? CARE_OPTIONS.map((o) => <Row key={o} title={o} right="›" onPress={() => setChoice(o)} />) : (
        <View>
          <Row title={choice} tint={colors.teal} right={<Pressable onPress={() => setChoice(null)}><Text style={{ color: colors.muted }}>Change</Text></Pressable>} />
          {choice === 'I want a qualified counselor' ? <Notice text="Only people with a verified professional license appear here. If you are in immediate danger, contact your local emergency services." /> : null}
          {people.length ? (
            <Section title="Recommended ministers and listeners">
              {people.map((p) => <Row key={p.id} title={p.name} subtitle={`${p.headline} · ${p.availability}`} right={<Badge label={p.verified[0] || 'Member'} tint={colors.forest} />} onPress={() => nav.push('Person', { id: p.id })} />)}
            </Section>
          ) : null}
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
    <Screen back title="Make a Wish" subtitle="A prayer request, ministry goal, or need" right={<Pressable onPress={() => nav.push('Create', { kind: 'Wish' })} hitSlop={10}><Text style={{ color: colors.forest, fontSize: 20 }}>＋</Text></Pressable>}>
      {(state.wishes || []).map((w) => (
        <View key={w.id} style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={styles.cardMeta}>{w.author} · {w.visibility}</Text><Tag label={w.category} /></View>
          <Text style={styles.cardTitle}>{w.title}</Text>
          <Text style={styles.cardBody}>{w.body}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {w.responses.map((r) => <Button key={r} small kind="ghost" label={r} onPress={() => (r === 'Prayer' ? nav.push('NewPrayer') : nav.push('Chat', { to: w.author }))} />)}
          </View>
        </View>
      ))}
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
          <Section title="Participate"><Row title="✋ Raise hand" /><Row title="🙏 Send a prayer request" onPress={() => nav.push('NewPrayer')} /><Row title="❓ Ask a moderated question" /></Section>
        </ScrollView>
        <View style={{ padding: 14 }}><AskBar placeholder="Say something in live fellowship chat..." /></View>
      </Screen>
    );
  }
  return (
    <Screen back title="Live Fellowship" right={<Pressable onPress={() => nav.push('Create', { kind: 'Live stream' })} hitSlop={10}><Text style={{ color: colors.forest, fontSize: 20 }}>＋</Text></Pressable>}>
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
    <Screen back title="Feed" right={<Pressable onPress={() => nav.push('Create', { kind: 'Post' })} hitSlop={10}><Text style={{ color: colors.forest, fontSize: 20 }}>＋</Text></Pressable>}>
      <Pills items={['For You', 'Following', 'Communities', 'Events']} value={tab} onChange={setTab} />
      {(state.feed || []).filter((f) => tab !== 'Events' || f.kind === 'Announcement' || f.kind === 'Celebration').map((f) => (
        <View key={f.id} style={styles.post}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={styles.cardTitle}>{f.author}</Text><Tag label={f.kind} /></View>
          <Text style={styles.cardBody}>{f.text}</Text>
          {f.passage ? <Pressable onPress={() => nav.push('Bible', f.passage)}><Text style={{ color: colors.teal, fontSize: 11, marginTop: 6 }}>📖 {refLabel(f.passage.bookId, f.passage.chapter)} · Open</Text></Pressable> : null}
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
            <Pressable onPress={() => dispatch({ type: 'like', id: f.id })}><Text style={[styles.cardMeta, f.liked && { color: colors.forest }]}>🙌 {f.likes}</Text></Pressable>
            <Text style={styles.cardMeta}>💬 {f.comments}</Text>
            <Text style={styles.cardMeta}>↗ Share</Text>
            <Text style={styles.cardMeta}>☆ Save</Text>
            <Text style={[styles.cardMeta, { marginLeft: 'auto' }]}>{f.time}</Text>
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: { fontFamily: fonts.serifBold, fontSize: 21, color: colors.fg, letterSpacing: -0.3 },
  sub: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted, marginTop: 4, textAlign: 'center', lineHeight: 17 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, marginTop: 12 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.fg },
  cardMeta: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, marginTop: 3 },
  cardBody: { fontFamily: fonts.sans, fontSize: 13, color: colors.passage, lineHeight: 19, marginTop: 8 },

  // Hero Banner (PDF Page 1)
  heroBanner: {
    backgroundColor: colors.cardSage,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.sage + '35',
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 16,
    padding: 18,
  },
  heroBannerContent: {},
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.forest,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  heroBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  heroTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 22,
    color: colors.fg,
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  heroSub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 6,
    lineHeight: 18,
  },
  heroPrimaryBtn: {
    backgroundColor: colors.forest,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPrimaryBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    fontWeight: '600',
  },
  heroSecondaryBtn: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSecondaryBtnText: {
    color: colors.fg,
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    fontWeight: '600',
  },

  // Verse of the Day Card (PDF Page 4)
  vodCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 12,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  vodTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  vodLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 1.2,
  },
  vodRefText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.muted,
  },
  vodQuote: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.fg,
    fontStyle: 'italic',
  },
  vodInteractionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  vodMetricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vodMetricText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },

  // "Be Inspired" Cards (PDF Page 1)
  beInspiredCard: {
    width: 140,
    height: 140,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    justifyContent: 'space-between',
  },
  beInspiredEmoji: {
    fontSize: 22,
  },
  beInspiredTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 14,
    color: colors.fg,
    lineHeight: 18,
  },
  beInspiredSub: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  beInspiredArrowBox: {
    alignSelf: 'flex-start',
  },
  beInspiredArrow: {
    fontSize: 16,
    fontWeight: '700',
  },

  // "Today's Activities" (PDF Page 4)
  activitiesCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  activityCheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  activityCheckCircleActive: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  activityCheckMark: {
    fontSize: 12,
    fontWeight: '700',
    color: 'transparent',
  },
  activityTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.fg,
  },
  activityTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.muted,
  },
  activitySub: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  activityIcon: {
    fontSize: 16,
  },
  activityFooterRow: {
    paddingTop: 10,
    alignItems: 'center',
  },
  countdownTimerText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.muted,
  },

  sectionActionText: {
    color: colors.forest,
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '600',
  },

  // Video Card in Discover
  videoCard: { width: 130, height: 185, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  videoThumb: { flex: 1, padding: 8, justifyContent: 'space-between' },
  videoBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  videoBadgeText: { color: '#fff', fontSize: 10, fontFamily: fonts.sansMedium },
  videoCreatorName: { color: colors.gold, fontSize: 11, fontFamily: fonts.sansMedium, fontWeight: '700' },
  videoCaptionPreview: { color: '#fff', fontSize: 11, fontFamily: fonts.sans, marginTop: 2 },

  // Prayer Hub in Discover
  prayerHubCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 },
  prayerHubTitle: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.fg },
  prayerHubSub: { fontFamily: fonts.sans, fontSize: 11.5, color: colors.muted, marginTop: 2 },
  submitPrayerSmallBtn: { backgroundColor: colors.forest, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  submitPrayerSmallBtnText: { color: '#FFFFFF', fontSize: 11, fontFamily: fonts.sansMedium, fontWeight: '600' },
  prayerItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  prayerItemTitle: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.fg },
  prayerItemSub: { fontFamily: fonts.sans, fontSize: 10.5, color: colors.muted, marginTop: 2 },
  quickPrayBtn: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  quickPrayBtnOn: { backgroundColor: colors.forest, borderColor: colors.forest },
  quickPrayBtnText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.fg, fontWeight: '600' },

  // Jobs Card in Discover
  jobsCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 },
  jobHeading: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.fg },
  jobSub: { fontFamily: fonts.sans, fontSize: 11.5, color: colors.muted, marginTop: 2 },
  jobItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  jobItemTitle: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.fg },
  jobItemMeta: { fontFamily: fonts.sans, fontSize: 10.5, color: colors.muted, marginTop: 2 },

  // Channels
  channelCard: { width: 175, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' },
  channelPreview: { height: 80, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  channelPreviewIcon: { fontSize: 26 },
  channelFollowersBadge: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  channelFollowersText: { color: '#fff', fontSize: 9 },
  channelName: { fontFamily: fonts.serifBold, fontSize: 13.5, color: colors.fg },
  channelVideoTitle: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, marginTop: 2 },

  // 2-Column People Grid
  peopleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  personCard: { width: '48.5%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, alignItems: 'center' },
  personAvatarWrapper: { position: 'relative' },
  personAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.raised, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  personAvatarText: { color: colors.forest, fontFamily: fonts.serifBold, fontSize: 16 },
  personOnlineDot: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.positive, borderWidth: 2, borderColor: colors.surface },
  personCardName: { fontFamily: fonts.sansMedium, fontSize: 13.5, fontWeight: '600', color: colors.fg, marginTop: 8 },
  personCardHeadline: { fontFamily: fonts.sans, fontSize: 10.5, color: colors.muted, textAlign: 'center', marginTop: 2, height: 28 },
  personCardCountry: { fontFamily: fonts.sans, fontSize: 10, color: colors.gold, marginTop: 2 },
  personChatBtn: { flex: 1, backgroundColor: colors.forest, borderRadius: 14, paddingVertical: 6, alignItems: 'center' },
  personChatBtnText: { color: '#FFFFFF', fontFamily: fonts.sansMedium, fontSize: 11, fontWeight: '600' },
  personFollowBtn: { width: 32, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  personFollowBtnActive: { borderColor: colors.forest },
  personFollowBtnText: { color: colors.fg, fontSize: 13, fontWeight: '600' },

  pinned: { marginHorizontal: 18, marginTop: 6, backgroundColor: colors.surface, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: colors.border },
  pinnedText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.fg },
  msg: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, borderBottomLeftRadius: 2, padding: 12, maxWidth: '85%' },
  msgMine: { alignSelf: 'flex-end', backgroundColor: colors.forest, borderWidth: 1, borderColor: colors.forest, borderRadius: 12, borderBottomRightRadius: 2 },
  msgFrom: { fontFamily: fonts.sansMedium, fontSize: 10.5, color: colors.gold, fontWeight: '600', marginBottom: 3 },
  msgText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: colors.fg },
  msgTime: { fontFamily: fonts.sans, fontSize: 9.5, color: colors.muted, marginTop: 4 },
  passageChip: { marginTop: 8, backgroundColor: colors.raised, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.border },
  passageChipText: { fontFamily: fonts.serif, fontSize: 12, color: colors.fg },
  composerChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surface },
  composerChipText: { fontFamily: fonts.sans, fontSize: 11, color: colors.fg },
  menu: { position: 'absolute', right: 14, top: 44, zIndex: 5, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 4 },
  menuItem: { fontFamily: fonts.sans, color: colors.fg, fontSize: 13, paddingVertical: 8, paddingHorizontal: 12 },
  event: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  dateBox: { width: 44, alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  dateDay: { fontFamily: fonts.sansMedium, fontSize: 16, fontWeight: '600', color: colors.fg },
  dateMon: { fontFamily: fonts.sans, fontSize: 9.5, color: colors.forest, letterSpacing: 0.5 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  video: { height: 200, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderRadius: 14, overflow: 'hidden' },
  post: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.rule },
});
