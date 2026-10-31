import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Screen, Section, Row, Pills, Button, Input, Tag, Badge, Notice, Empty, alpha, NightGlow } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { useToast } from '../components/Toast';
import { PressScale, FadeInUp, ScaleIn, Pop, Burst, AnimatedNumber, LiveRing } from '../components/Motion';
import { BOOKS, DAILY_VERSES, getChapter, refLabel, verseOfDay } from '../data/bible';

// Parse "PHP 4:6", "PSA 23", "John 3:16" or "1 John 4:19" into { bookId, chapter, verse }.
function parseRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const m = ref.trim().match(/^(.+?)\s+(\d+)(?::(\d+))?/);
  if (!m) return null;
  const key = m[1].trim().toLowerCase();
  const book = BOOKS.find((b) => b.id.toLowerCase() === key || b.name.toLowerCase() === key);
  if (!book) return null;
  return { bookId: book.id, chapter: Number(m[2]), verse: m[3] ? Number(m[3]) : null };
}

function verseLabel(ref) {
  const r = parseRef(ref);
  return r ? refLabel(r.bookId, r.chapter, r.verse) : ref;
}

function verseText(bookId, chapter, verse) {
  const ch = getChapter('KJV', bookId, chapter);
  return ch && ch[verse - 1] ? ch[verse - 1] : '';
}

// Scripture suggestions for "Send Scripture": today's verse first, then a few encouraging ones.
function scriptureChoices() {
  const today = verseOfDay();
  const picks = [today, ...DAILY_VERSES.filter((v) => !(v.bookId === today.bookId && v.chapter === today.chapter && v.verse === today.verse))]
    .filter((v) => verseText(v.bookId, v.chapter, v.verse))
    .slice(0, 5);
  return picks.map((v, i) => ({
    ...v,
    ref: refLabel(v.bookId, v.chapter, v.verse),
    text: verseText(v.bookId, v.chapter, v.verse),
    today: i === 0,
  }));
}

async function shareText(message, toast) {
  try {
    await Share.share({ message });
  } catch (e) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message);
        toast.show('Copied to clipboard', { icon: 'link' });
        return;
      }
    } catch (err) { /* fall through */ }
    toast.show('Sharing isn’t available here', { tone: 'error' });
  }
}

const STATUS_TINT = {
  active: colors.muted,
  receiving: colors.sky,
  updated: colors.lavender,
  answered: colors.positive,
  archived: colors.faint,
};

const STATUS_LABEL = {
  active: 'Active',
  receiving: 'Receiving prayer',
  updated: 'Updated',
  answered: 'Answered',
  archived: 'Archived',
};

const AVATAR_TINTS = [colors.sage, colors.rose, colors.sky, colors.lavender, colors.teal, colors.terracotta];
function avatarTint(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function Avatar({ name, size = 34 }) {
  const t = avatarTint(name);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(t, 0.14) }]}>
      <Text style={[styles.avatarInitial, { color: t, fontSize: size * 0.4 }]}>{(name || '?')[0]}</Text>
    </View>
  );
}

function PlusIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

function StatusBadge({ status, animate }) {
  const badge = <Badge label={STATUS_LABEL[status] || status} tint={STATUS_TINT[status] || colors.muted} />;
  return animate ? <ScaleIn key={status}>{badge}</ScaleIn> : badge;
}

// Card footer for the wall: "I'm praying" pops + sparkles when you join in; the count tweens.
function PrayAction({ p, onToggle }) {
  const [burst, setBurst] = useState(0);
  const press = () => {
    if (!p.prayed) setBurst((b) => b + 1);
    onToggle(p);
  };
  return (
    <View style={styles.actions}>
      <View style={{ position: 'relative' }}>
        <PressScale
          onPress={press}
          accessibilityLabel={p.prayed ? 'Stop praying' : "I'm praying"}
          hitSlop={6}
          scaleTo={0.93}
          style={[styles.pray, p.prayed && styles.prayOn]}
        >
          <Pop trigger={p.prayed}>
            <Icon name={p.prayed ? 'check' : 'prayer'} size={14} color={p.prayed ? colors.primaryFg : colors.primary} strokeWidth={2.2} />
          </Pop>
          <Text style={[styles.prayText, p.prayed && { color: colors.primaryFg }]}>
            {p.prayed ? 'Praying' : "I'm praying"}
          </Text>
        </PressScale>
        <Burst trigger={burst} count={8} radius={38} size={10} />
      </View>
      <View style={styles.metaWrap}>
        <Icon name="users" size={13} color={colors.faint} />
        <Pop trigger={p.praying} amount={1.18}>
          <AnimatedNumber value={p.praying} style={[styles.meta, styles.metaNum]} />
        </Pop>
        <Text style={styles.meta}>
          praying{p.updates.length ? ` · ${p.updates.length} update${p.updates.length > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
    </View>
  );
}

export default function PrayerScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState(params.filter || 'All');

  const prayerPlayer = useVideoPlayer('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', (player) => {
    player.loop = true;
    player.play();
    player.muted = true;
  });

  const hidden = state.hiddenPrayers || [];
  const visible = (state.prayers || []).filter((p) => !hidden.includes(p.id));
  const filtered = visible.filter((p) => {
    if (tab === 'Archived') return p.mine && p.status === 'archived';
    if (p.status === 'archived') return false;
    if (tab === 'Mine') return p.mine;
    if (tab === 'Answered') return p.status === 'answered';
    if (tab === 'Church') return p.audience === 'Church';
    if (tab === 'Community') return p.audience === 'Community';
    if (tab === 'Public') return p.audience === 'Public';
    return true;
  });
  const live = visible.filter((p) => p.status !== 'archived');
  const prayingNow = live.reduce((n, p) => n + (p.praying || 0), 0);
  const answeredCount = live.filter((p) => p.status === 'answered').length;
  const hasArchived = visible.some((p) => p.mine && p.status === 'archived');
  const tabs = ['All', 'Mine', 'Church', 'Community', 'Public', 'Answered', ...(hasArchived || tab === 'Archived' ? ['Archived'] : [])];

  const togglePray = (p) => {
    dispatch({ type: 'pray', id: p.id });
    if (p.prayed) toast.show('Removed from your prayer list', { icon: 'prayer', haptic: 'select' });
    else toast.show(`Praying for “${p.title}”`, { icon: 'prayer', haptic: 'success' });
  };

  return (
    <Screen
      back={nav.stack.length > 0}
      title="Prayer Wall"
      subtitle="Intercede & share with the body of Christ"
      menu={() => nav.push('Profile')}
      right={
        <PressScale
          onPress={() => nav.push('NewPrayer')}
          hitSlop={12}
          scaleTo={0.9}
          accessibilityLabel="New prayer request"
          style={styles.addPrayerBtn}
        >
          <PlusIcon size={17} color={colors.primaryFg} />
        </PressScale>
      }
    >
      {/* Atmospheric Video Animation Header */}
      <View style={styles.videoHeroContainer}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={prayerPlayer}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          nativeControls={false}
          contentFit="cover"
        />
        <View style={styles.videoHeroOverlay} />
        <View style={styles.videoHeroContent}>
          <View style={styles.videoLiveBadge}>
            <LiveRing color={colors.goldLight} size={7} />
            <Text style={styles.videoLiveBadgeText}>Live intercession</Text>
          </View>
          <FadeInUp delay={80} distance={10}>
            <Text style={styles.videoHeroTitle}>United in fervent prayer</Text>
            <Text style={styles.videoHeroQuote}>
              “The effectual fervent prayer of a righteous man availeth much.” — James 5:16
            </Text>
          </FadeInUp>
          <View style={styles.videoStatsRow}>
            <View style={styles.videoStatItem}>
              <Pop trigger={prayingNow} amount={1.12}>
                <AnimatedNumber value={prayingNow} style={styles.videoStatNum} format={(n) => Math.round(n).toLocaleString()} />
              </Pop>
              <Text style={styles.videoStatLabel}>Praying</Text>
            </View>
            <View style={styles.videoStatDivider} />
            <View style={styles.videoStatItem}>
              <AnimatedNumber value={answeredCount} style={styles.videoStatNum} />
              <Text style={styles.videoStatLabel}>Answered</Text>
            </View>
            <PressScale style={styles.videoActionBtn} scaleTo={0.94} onPress={() => nav.push('NewPrayer')}>
              <PlusIcon size={13} color={colors.night} />
              <Text style={styles.videoActionBtnText}>Add prayer</Text>
            </PressScale>
          </View>
        </View>
      </View>

      <Pills
        items={tabs}
        value={tab}
        onChange={setTab}
        style={{ marginTop: 18, marginBottom: 4 }}
      />

      {/* Keyed on the filter so switching views cross-fades the list in. */}
      <View key={tab}>
        {filtered.map((p, i) => (
          <FadeInUp key={p.id} index={i} distance={12} duration={380}>
            <PressScale
              scaleTo={0.985}
              style={styles.card}
              onPress={() => nav.push('Prayer', { id: p.id })}
            >
              <View style={styles.cardHead}>
                <Avatar name={p.author} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.author} numberOfLines={1}>{p.author}</Text>
                  <Text style={styles.authorMeta} numberOfLines={1}>{p.audience} · {p.created}</Text>
                </View>
                <StatusBadge status={p.status} animate />
              </View>

              <Text style={styles.title}>{p.title}</Text>
              {p.body ? <Text style={styles.body} numberOfLines={2}>{p.body}</Text> : null}

              {p.verse ? (
                <View style={styles.verseChip}>
                  <Icon name="bible" size={12} color={colors.gold} />
                  <Text style={styles.verse}>{verseLabel(p.verse)}</Text>
                </View>
              ) : null}

              <PrayAction p={p} onToggle={togglePray} />
            </PressScale>
          </FadeInUp>
        ))}

        {!filtered.length ? (
          <ScaleIn style={{ marginTop: 6 }}>
            <Empty
              title={tab === 'Archived' ? 'No archived requests' : 'No prayer requests in this view'}
              body={tab === 'All' ? undefined : 'Try another filter, or share what is on your heart.'}
              action="Submit a prayer"
              onAction={() => nav.push('NewPrayer')}
            />
          </ScaleIn>
        ) : null}
      </View>

      <View style={{ marginTop: 10 }}>
        <Notice text="Prayer requests are holy and private. Sensitive requests stay secure and are never shared for advertising." />
      </View>
    </Screen>
  );
}

export function PrayerDetailScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const toast = useToast();
  const p = (state.prayers || []).find((x) => x.id === params.id);
  const [update, setUpdate] = useState('');
  const [sheet, setSheet] = useState(null); // 'encourage' | 'scripture' | 'report' | null
  const [encourage, setEncourage] = useState('');
  const [prayBurst, setPrayBurst] = useState(0);
  const [answerBurst, setAnswerBurst] = useState(0);
  const [freshBurst, setFreshBurst] = useState(0);
  useEffect(() => {
    if (!params.fresh) return undefined;
    const t = setTimeout(() => setFreshBurst(1), 260);
    return () => clearTimeout(t);
  }, []);

  if (!p) {
    return (
      <Screen back title="Prayer">
        <Empty title="This prayer was removed" body="It may have been archived or deleted by its author." action="Back to Prayer Wall" onAction={() => nav.replace('PrayerWall')} />
      </Screen>
    );
  }

  const verseRef = parseRef(p.verse);
  const muted = (state.mutedPrayers || []).includes(p.id);
  const canDm = !p.mine && !p.anonymous && p.author !== 'Anonymous';
  const choices = sheet === 'scripture' ? scriptureChoices() : [];

  const togglePray = () => {
    if (!p.prayed) setPrayBurst((b) => b + 1);
    dispatch({ type: 'pray', id: p.id });
    if (p.prayed) toast.show('Removed from your prayer list', { icon: 'prayer', haptic: 'select' });
    else toast.show(`You’re praying for ${p.mine ? 'this request' : p.author}`, { icon: 'prayer', haptic: 'success' });
  };

  const sendEncouragement = () => {
    const text = encourage.trim();
    if (!text) return;
    if (canDm) {
      const chat = state.chats.find((c) => c.with === p.author);
      if (chat) dispatch({ type: 'dm', cid: chat.id, text });
      else dispatch({ type: 'newChat', name: p.author, kind: 'Prayer', text });
      toast.show(`Encouragement sent to ${p.author}`, { icon: 'chat', haptic: 'success', action: { label: 'Open chat', onPress: () => nav.push('Chat', { to: p.author }) } });
    } else {
      dispatch({ type: 'prayerStatus', id: p.id, status: p.status, update: `${state.user.displayName}: ${text}` });
      toast.show('Encouragement posted to this prayer', { icon: 'chat', haptic: 'success' });
    }
    setEncourage('');
    setSheet(null);
  };

  const sendScripture = (v) => {
    dispatch({ type: 'prayerStatus', id: p.id, status: p.status, update: `${v.ref} — “${v.text}”${p.mine ? '' : `  · from ${state.user.displayName}`}` });
    setSheet(null);
    toast.show(`${v.ref} added to this prayer`, { icon: 'bible', haptic: 'success' });
  };

  const postUpdate = () => {
    if (!update.trim()) return;
    dispatch({ type: 'prayerStatus', id: p.id, status: p.status === 'answered' ? 'answered' : 'updated', update: update.trim() });
    setUpdate('');
    toast.show('Update posted', { icon: 'check', haptic: 'success' });
  };

  const markAnswered = () => {
    dispatch({ type: 'prayerStatus', id: p.id, status: 'answered', update: update.trim() || 'Answered. God is faithful!' });
    setUpdate('');
    setAnswerBurst((b) => b + 1);
    toast.show('Marked as answered — praise God!', { icon: 'sparkles', haptic: 'success' });
  };

  const archive = () => {
    const prev = p.status;
    dispatch({ type: 'prayerStatus', id: p.id, status: 'archived' });
    toast.show('Prayer request archived', {
      icon: 'check',
      action: { label: 'Undo', onPress: () => dispatch({ type: 'prayerStatus', id: p.id, status: prev }) },
    });
    nav.pop();
  };

  const restore = () => {
    dispatch({ type: 'prayerStatus', id: p.id, status: p.updates.length ? 'updated' : 'active' });
    toast.show('Restored to the Prayer Wall', { icon: 'check' });
  };

  const report = (reason) => {
    const hidden = state.hiddenPrayers || [];
    dispatch({ type: 'set', patch: { hiddenPrayers: [...hidden.filter((x) => x !== p.id), p.id], prayerReports: [...(state.prayerReports || []), { id: p.id, reason, when: new Date().toISOString() }] } });
    setSheet(null);
    toast.show('Thanks — reported and hidden from your wall', {
      icon: 'shield',
      action: { label: 'Undo', onPress: () => dispatch({ type: 'set', patch: { hiddenPrayers: hidden.filter((x) => x !== p.id) } }) },
    });
    nav.pop();
  };

  const toggleMute = () => {
    const list = state.mutedPrayers || [];
    dispatch({ type: 'set', patch: { mutedPrayers: muted ? list.filter((x) => x !== p.id) : [...list, p.id] } });
    toast.show(muted ? 'Notifications on for this prayer' : 'Notifications muted for this prayer', { icon: 'bell', haptic: 'select' });
  };

  const share = () => shareText(`Please pray: ${p.title}\n\n${p.body}${p.verse ? `\n\n${p.verse}` : ''}\n\n— shared from the BibleNestra Prayer Wall`, toast);

  return (
    <Screen back title="Prayer Request" subtitle={`${p.audience} · ${STATUS_LABEL[p.status] || p.status}`}>
      {params.fresh && p.mine ? (
        <ScaleIn style={styles.freshCard}>
          <View style={styles.freshIcon}>
            <Icon name="check" size={18} color={colors.night} strokeWidth={2.6} />
            <Burst trigger={freshBurst} count={10} radius={40} size={11} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.freshTitle}>{p.audience === 'Private' ? 'Saved between you and God' : 'Your request is on the wall'}</Text>
            <Text style={styles.freshSub}>{AUDIENCE_HINT[p.audience] || 'We’ll let you know when others pray.'}</Text>
          </View>
        </ScaleIn>
      ) : null}
      <FadeInUp style={styles.detailCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={p.status} animate />
          <Tag label={p.audience} />
        </View>
        <Text style={styles.detailTitle}>{p.title}</Text>
        <View style={styles.detailAuthorRow}>
          <Avatar name={p.author} size={28} />
          <Text style={styles.detailAuthor}>Shared by <Text style={{ color: colors.fg, fontWeight: '600' }}>{p.mine ? 'you' : p.author}</Text> · {p.created}</Text>
        </View>
        {p.body ? <Text style={styles.detailBody}>{p.body}</Text> : null}

        {p.verse ? (
          <PressScale
            onPress={() => (verseRef ? nav.push('Bible', verseRef) : nav.push('Search'))}
            scaleTo={0.98}
            style={styles.detailVerse}
          >
            <View style={styles.detailVerseIcon}>
              <Icon name="bible" size={15} color={colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailVerseRef}>{verseRef ? refLabel(verseRef.bookId, verseRef.chapter, verseRef.verse) : p.verse}</Text>
              <Text style={styles.detailVerseSub}>Open the linked Scripture passage</Text>
            </View>
            <Icon name="chevron-right" size={14} color={colors.faint} />
          </PressScale>
        ) : null}

        <View style={styles.prayingCount}>
          <Icon name="users" size={14} color={colors.muted} />
          <Pop trigger={p.praying} amount={1.2}>
            <AnimatedNumber value={p.praying} style={[styles.prayingCountText, { color: colors.fg, fontWeight: '700' }]} />
          </Pop>
          <Text style={styles.prayingCountText}>{p.praying === 1 ? 'person is' : 'people are'} praying</Text>
        </View>
      </FadeInUp>

      {p.status !== 'archived' ? (
        <FadeInUp index={1} style={{ marginTop: 16, position: 'relative' }}>
          <Pop trigger={p.prayed} amount={1.035}>
            <Button
              label={`${p.prayed ? 'Praying' : "I'm praying"} (${p.praying})`}
              kind={p.prayed ? 'ghost' : 'primary'}
              icon={<Icon name={p.prayed ? 'check' : 'prayer'} size={16} color={p.prayed ? colors.primary : colors.primaryFg} strokeWidth={2.2} />}
              onPress={togglePray}
            />
          </Pop>
          <Burst trigger={prayBurst} count={12} radius={64} size={12} />
        </FadeInUp>
      ) : (
        <Button label="Restore to Prayer Wall" style={{ marginTop: 16 }} onPress={restore} icon={<Icon name="repost" size={15} color={colors.primaryFg} />} />
      )}
      <FadeInUp index={2} style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {!p.mine ? (
          <Button
            small
            kind={sheet === 'encourage' ? 'primary' : 'ghost'}
            label="Encourage"
            style={{ flex: 1 }}
            icon={<Icon name="chat" size={14} color={sheet === 'encourage' ? colors.primaryFg : colors.fg} />}
            onPress={() => setSheet(sheet === 'encourage' ? null : 'encourage')}
          />
        ) : null}
        <Button
          small
          kind={sheet === 'scripture' ? 'primary' : 'ghost'}
          label={p.mine ? 'Add Scripture' : 'Send Scripture'}
          style={{ flex: 1 }}
          icon={<Icon name="bible" size={14} color={sheet === 'scripture' ? colors.primaryFg : colors.fg} />}
          onPress={() => setSheet(sheet === 'scripture' ? null : 'scripture')}
        />
        <PressScale onPress={share} accessibilityLabel="Share prayer request" hitSlop={6} scaleTo={0.9} style={styles.shareBtn}>
          <Icon name="share" size={16} color={colors.fg} />
        </PressScale>
      </FadeInUp>

      {sheet === 'encourage' ? (
        <FadeInUp key="encourage" distance={10} duration={300} style={styles.inlineSheet}>
          <Text style={styles.inlineSheetTitle}>{canDm ? `Message ${p.author}` : 'Leave an encouragement'}</Text>
          <Text style={styles.inlineSheetSub}>
            {canDm ? 'Sent privately as a direct message.' : 'This request is anonymous, so your note is added to its updates.'}
          </Text>
          <View style={styles.quickRow}>
            {['Praying for you today 🙏', 'You are not alone in this.', 'Standing with you in faith.'].map((q) => (
              <PressScale key={q} onPress={() => setEncourage(q)} scaleTo={0.93} style={[styles.quickChip, encourage === q && styles.quickChipOn]}>
                <Text style={[styles.quickChipText, encourage === q && { color: colors.primaryFg }]}>{q}</Text>
              </PressScale>
            ))}
          </View>
          <Input multiline placeholder="Write a few words of encouragement..." value={encourage} onChangeText={setEncourage} style={styles.manageInput} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button small kind="ghost" label="Cancel" style={{ flex: 1 }} onPress={() => { setSheet(null); setEncourage(''); }} />
            <Button small label={canDm ? 'Send message' : 'Post'} style={{ flex: 1 }} disabled={!encourage.trim()} onPress={sendEncouragement} />
          </View>
        </FadeInUp>
      ) : null}

      {sheet === 'scripture' ? (
        <FadeInUp key="scripture" distance={10} duration={300} style={styles.inlineSheet}>
          <Text style={styles.inlineSheetTitle}>Choose a verse</Text>
          <Text style={styles.inlineSheetSub}>{p.mine ? 'It will be added to this prayer’s updates.' : `It will be added to this prayer’s updates for ${p.author.replace(/\.$/, '')}.`}</Text>
          {choices.map((v, i) => (
            <FadeInUp key={v.ref} index={i} delay={80} distance={8}>
            <Pressable onPress={() => sendScripture(v)} style={({ pressed }) => [styles.verseOption, pressed && { backgroundColor: colors.raised }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.verseOptionRef}>{v.ref}</Text>
                {v.today ? <Badge label="Verse of the day" tint={colors.gold} /> : <Text style={styles.verseOptionTheme}>{v.theme}</Text>}
              </View>
              <Text style={styles.verseOptionText} numberOfLines={2}>{v.text}</Text>
            </Pressable>
            </FadeInUp>
          ))}
        </FadeInUp>
      ) : null}

      {p.updates.length ? (
        <Section title="Praise & updates">
          <View style={styles.timeline}>
            {p.updates.map((u, i) => (
              // Updates are prepended, so key from the bottom: a new update mounts (and animates) at the top.
              <FadeInUp key={p.updates.length - i} index={i} distance={10} style={styles.timelineItem}>
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, i === 0 && { backgroundColor: colors.gold }]} />
                  {i < p.updates.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>
                <View style={styles.timelineCard}>
                  <Text style={styles.timelineText}>{u.text}</Text>
                  <Text style={styles.timelineWhen}>{u.when}</Text>
                </View>
              </FadeInUp>
            ))}
          </View>
        </Section>
      ) : null}

      {p.mine ? (
        p.status !== 'archived' ? (
          <Section title="Manage request">
            <View style={[styles.manageCard, { position: 'relative' }]}>
              <Burst trigger={answerBurst} count={12} radius={80} size={13} />
              <Input
                multiline
                placeholder="Post an update, testimony, or praise report..."
                value={update}
                onChangeText={setUpdate}
                style={styles.manageInput}
              />
              <Button small label="Post update" style={{ marginTop: 12 }} disabled={!update.trim()} onPress={postUpdate} />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {p.status !== 'answered' ? (
                  <Button
                    small
                    kind="ghost"
                    label="Mark answered"
                    style={{ flex: 1 }}
                    icon={<Icon name="check" size={13} color={colors.positive} strokeWidth={2.4} />}
                    onPress={markAnswered}
                  />
                ) : null}
                <Button small kind="ghost" label="Archive" style={{ flex: 1 }} onPress={archive} />
              </View>
            </View>
          </Section>
        ) : null
      ) : (
        <Section title="Options">
          {sheet === 'report' ? (
            <FadeInUp key="report" distance={10} duration={300} style={[styles.inlineSheet, { marginTop: 0, marginBottom: 8 }]}>
              <Text style={styles.inlineSheetTitle}>Why are you reporting this?</Text>
              <Text style={styles.inlineSheetSub}>It will be hidden from your wall and sent to moderators.</Text>
              {['Spam or advertising', 'Inappropriate content', 'Shares someone’s private information', 'Something else'].map((r) => (
                <Row key={r} title={r} onPress={() => report(r)} right={<Icon name="chevron-right" size={14} color={colors.faint} />} />
              ))}
              <Button small kind="ghost" label="Cancel" style={{ marginTop: 8 }} onPress={() => setSheet(null)} />
            </FadeInUp>
          ) : (
            <Row
              title="Report prayer request"
              left={<Icon name="shield" size={17} color={colors.muted} />}
              right={<Icon name="chevron-right" size={14} color={colors.faint} />}
              onPress={() => setSheet('report')}
            />
          )}
          <Row
            title="Update notifications"
            subtitle={muted ? 'Muted — you won’t hear about updates' : 'You’ll be notified when there are updates'}
            left={<Icon name="bell" size={17} color={colors.muted} />}
            right={<Toggle value={!muted} onChange={toggleMute} />}
            onPress={toggleMute}
          />
        </Section>
      )}
    </Screen>
  );
}

const AUDIENCE_HINT = {
  Private: 'Only you and God will see this request.',
  Church: 'Shared with members of your church.',
  Community: 'Shared with your groups and communities.',
  Public: 'Visible to everyone on the Prayer Wall.',
};

export function NewPrayerScreen({ params = {} }) {
  const nav = useNav();
  const { dispatch } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState(params.audience || 'Private');
  const [anonymous, setAnonymous] = useState(false);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState(null);
  const [verse, setVerse] = useState(params.verse || null);

  const submit = () => {
    const t = title.trim();
    if (!t) {
      setError('Please give your request a short title.');
      return;
    }
    if (t.length < 3) {
      setError('Title is a little short — add a few more words.');
      return;
    }
    const id = 'pr' + Date.now();
    dispatch({
      type: 'addPrayer',
      p: { id, title: t, body: body.trim(), audience, anonymous, notify, verse: verse || null },
    });
    toast.show(audience === 'Private' ? 'Prayer saved privately' : `Prayer shared with ${audience === 'Public' ? 'everyone' : `your ${audience.toLowerCase()}`}`, {
      icon: 'prayer',
      haptic: 'success',
      action: { label: 'Wall', onPress: () => nav.push('PrayerWall', { filter: 'Mine' }) },
    });
    nav.replace('Prayer', { id, fresh: true });
  };

  return (
    <Screen back title="New Prayer Request">
      <FadeInUp style={styles.newIntro}><NightGlow />
        <ScaleIn delay={120} style={styles.newIntroIcon}>
          <Icon name="prayer" size={20} color={colors.goldLight} />
        </ScaleIn>
        <View style={{ flex: 1 }}>
          <Text style={styles.newIntroTitle}>Share what’s on your heart</Text>
          <Text style={styles.newIntroSub}>“Cast all your anxiety on him because he cares for you.” — 1 Peter 5:7</Text>
        </View>
      </FadeInUp>

      <FadeInUp index={1}>
      <Text style={styles.fieldLabel}>Request</Text>
      <Input
        placeholder="Prayer title (e.g. Health & healing for family)..."
        value={title}
        onChangeText={(v) => { setTitle(v); if (error) setError(null); }}
        style={error ? { borderColor: colors.negative } : null}
        accessibilityLabel="Prayer title"
      />
      {error ? (
        <FadeInUp key={error} distance={6} duration={220} style={styles.fieldError}>
          <Icon name="x" size={12} color={colors.negative} strokeWidth={2.6} />
          <Text style={styles.fieldErrorText}>{error}</Text>
        </FadeInUp>
      ) : null}
      <Input
        multiline
        placeholder="Describe what you would like prayer for..."
        value={body}
        onChangeText={setBody}
        style={{ marginTop: 10, minHeight: 120 }}
      />
      {verse ? (
        <ScaleIn key="verse" from={0.94}>
          <Row
            title={verse}
            subtitle="Linked Scripture passage · tap to remove"
            left={<Icon name="bible" size={16} color={colors.gold} />}
            right={<Icon name="x" size={14} color={colors.faint} />}
            onPress={() => setVerse(null)}
            style={{ marginTop: 10 }}
          />
        </ScaleIn>
      ) : (
        <PressScale onPress={() => { const v = verseOfDay(); setVerse(refLabel(v.bookId, v.chapter, v.verse)); }} scaleTo={0.94} style={styles.linkVerse}>
          <Icon name="bible" size={14} color={colors.primary} />
          <Text style={styles.linkVerseText}>Link today’s verse</Text>
        </PressScale>
      )}
      </FadeInUp>

      <FadeInUp index={2}>
      <Section title="Privacy & audience">
        <Pills
          items={['Private', 'Church', 'Community', 'Public']}
          value={audience}
          onChange={setAudience}
        />
        <FadeInUp key={audience} distance={4} duration={240} style={styles.audienceHint}>
          <Icon name={audience === 'Private' ? 'shield' : 'users'} size={14} color={colors.primary} />
          <Text style={styles.audienceHintText}>{AUDIENCE_HINT[audience]}</Text>
        </FadeInUp>
      </Section>
      </FadeInUp>

      <FadeInUp index={3}>
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
        style={{ marginTop: 24 }}
        icon={<Icon name="prayer" size={16} color={colors.primaryFg} />}
        onPress={submit}
      />
      </FadeInUp>
    </Screen>
  );
}

// Switch with a springy knob and a cross-faded track colour.
export function Toggle({ value, onChange }) {
  const a = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: value ? 1 : 0, useNativeDriver: false, speed: 22, bounciness: 7 }).start();
  }, [value]);
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value }}
      style={styles.toggle}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 13, backgroundColor: colors.primary, opacity: a }]} />
      <Animated.View style={[styles.knob, { transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }] }]} />
    </Pressable>
  );
}

const EYEBROW = { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' };

const styles = StyleSheet.create({
  addPrayerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },

  // ---- Wall cards
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginTop: 12,
    ...shadow.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontWeight: '700' },
  author: { fontSize: 13.5, fontWeight: '600', color: colors.fg },
  authorMeta: { fontSize: 11.5, color: colors.faint, marginTop: 1 },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 19,
    lineHeight: 24,
    color: colors.fg,
    marginTop: 12,
    letterSpacing: -0.3,
  },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 4 },
  verseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.cardGold,
  },
  verse: { fontSize: 12, fontWeight: '700', color: colors.goldMuted, letterSpacing: 0.2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  pray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    height: 34,
    backgroundColor: colors.primarySoft,
  },
  prayOn: { backgroundColor: colors.primary },
  prayText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  metaWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontSize: 12, color: colors.muted },
  metaNum: { color: colors.fg, fontWeight: '700', minWidth: 8, textAlign: 'right' },

  // ---- Detail
  detailCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    marginTop: 4,
    ...shadow.sm,
  },
  detailTitle: { fontFamily: fonts.serifBold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: colors.fg, marginTop: 14 },
  detailAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  detailAuthor: { fontSize: 13, color: colors.muted },
  detailBody: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, color: colors.passage, marginTop: 16 },
  detailVerse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.screen,
  },
  detailVerseIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  detailVerseRef: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg },
  detailVerseSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  prayingCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  prayingCountText: { fontSize: 13, color: colors.muted },
  timeline: { paddingLeft: 2 },
  timelineItem: { flexDirection: 'row', gap: 12 },
  timelineRail: { width: 12, alignItems: 'center', paddingTop: 16 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.borderStrong },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 4 },
  timelineCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 13,
    marginBottom: 10,
    ...shadow.sm,
  },
  timelineText: { fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 22, color: colors.passage },
  timelineWhen: { fontSize: 11.5, color: colors.faint, marginTop: 6 },
  manageCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.sm,
  },
  manageInput: { minHeight: 84, backgroundColor: colors.screen },

  // ---- New prayer
  newIntro: { overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.night,
    marginTop: 4,
    ...shadow.md,
  },
  newIntroIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(212,168,82,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newIntroTitle: { fontFamily: fonts.serifBold, fontSize: 19, color: colors.nightFg, letterSpacing: -0.3 },
  newIntroSub: { fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 18, color: colors.nightMuted, marginTop: 3 },
  fieldLabel: { ...EYEBROW, color: colors.muted, marginTop: 24, marginBottom: 10 },
  fieldError: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7, marginLeft: 4 },
  fieldErrorText: { fontSize: 12.5, color: colors.negative, fontWeight: '600' },
  shareBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'center' },
  linkVerse: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  linkVerseText: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  inlineSheet: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.sm,
  },
  inlineSheetTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg, letterSpacing: -0.2 },
  inlineSheetSub: { fontSize: 12.5, color: colors.muted, marginTop: 2, marginBottom: 10, lineHeight: 17 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  quickChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  quickChipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  quickChipOn: { backgroundColor: colors.primary },
  freshCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    marginTop: 4,
    marginBottom: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.night,
    ...shadow.md,
  },
  freshIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  freshTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.nightFg, letterSpacing: -0.2 },
  freshSub: { fontSize: 12.5, color: colors.nightMuted, marginTop: 2, lineHeight: 17 },
  verseOption: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: radius.md, marginHorizontal: -4 },
  verseOptionRef: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.fg },
  verseOptionTheme: { fontSize: 11.5, color: colors.faint },
  verseOptionText: { fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 20, color: colors.passage, marginTop: 3 },
  audienceHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  audienceHintText: { flex: 1, fontSize: 12.5, color: colors.primaryInk, lineHeight: 17 },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.borderStrong,
    padding: 3,
    justifyContent: 'center',
  },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    ...shadow.sm,
  },

  // ---- Video hero (night surface)
  videoHeroContainer: {
    height: 212,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 4,
    backgroundColor: colors.night,
    ...shadow.md,
  },
  videoHeroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(21,23,43,0.66)',
  },
  videoHeroContent: {
    flex: 1,
    padding: 18,
    justifyContent: 'space-between',
  },
  videoLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  videoPulseDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.goldLight },
  videoLiveBadgeText: { ...EYEBROW, fontSize: 9.5, color: colors.nightFg },
  videoHeroTitle: {
    color: colors.nightFg,
    fontFamily: fonts.serifBold,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.4,
  },
  videoHeroQuote: {
    color: colors.nightMuted,
    fontFamily: fonts.serifItalic,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 4,
  },
  videoStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.nightBorder,
    paddingTop: 12,
  },
  videoStatItem: {},
  videoStatNum: { color: colors.goldLight, fontFamily: fonts.serifBold, fontSize: 18, lineHeight: 21 },
  videoStatLabel: { color: colors.nightMuted, fontSize: 10.5, marginTop: 1 },
  videoStatDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(255,255,255,0.22)' },
  videoActionBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.goldLight,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radius.pill,
  },
  videoActionBtnText: { color: colors.night, fontSize: 12.5, fontWeight: '700' },
});
