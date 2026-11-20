// Today — the daily home (patterns from YouVersion's Daily Refresh, Glorify's daily checklist
// and Hallow's seasonal challenges): greeting, week strip, a gentle streak, and a four-step rhythm.
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AnimatedModal } from '../components/Motion';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from '../components/Icons';
import { NightGlow, alpha } from '../components/ui';
import ProfileButton from '../components/ProfileButton';
import SupportAdsCard from '../components/SupportAdsCard';
import TodaysJourney from '../components/TodaysJourney'; // TODAY'S JOURNEY: Daily Bread · Videos · Prayer Wall
import ChannelVideosRow from '../components/ChannelVideosRow'; // WATCH ON TODAY: latest videos of the connected YouTube channels
import CareInvite from '../components/CareInvite';
import AnnouncementCards from '../components/AnnouncementCards'; // ROUND 5: admin announcements
import { FadeInUp, ScaleIn, Pop, Pulse, Burst, AnimatedBar, AnimatedNumber, PressScale } from '../components/Motion';
import { useToast } from '../components/Toast';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { verseOfDay, CHAPTER_TITLES, refLabel, bookName } from '../data/bible';
import { STEPS, dayKey, computeStreak, weekDays, addDays } from '../data/rhythm';

const STEP_META = {
  verse: { label: 'Verse of the day', icon: 'sun', mins: 1 },
  reading: { label: "Today's reading", icon: 'book', mins: 6 },
  prayer: { label: 'Pray with others', icon: 'prayer', mins: 3 },
  reflect: { label: 'Reflect', icon: 'highlight', mins: 2 },
};

export default function TodayScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const today = new Date();
  const key = dayKey(today);
  const doneToday = (state.rhythm && state.rhythm[key]) || [];
  const isDone = (s) => doneToday.includes(s);
  const { streak, graceUsedThisWeek } = useMemo(() => computeStreak(state.rhythm || {}, today), [state.rhythm]);
  const best = Math.max(state.bestStreak || 0, streak);
  const showStreak = state.streaksEnabled !== false;

  const toast = useToast();
  const [streakOpen, setStreakOpen] = useState(false);
  const [reflection, setReflection] = useState('');

  const markDone = (step, reflectionText) => {
    if (isDone(step) && !reflectionText) return;
    const nextSteps = isDone(step) ? doneToday : [...doneToday, step];
    const next = { ...(state.rhythm || {}), [key]: nextSteps };
    const s = computeStreak(next, today).streak;
    const patch = { rhythm: next, bestStreak: Math.max(state.bestStreak || 0, s) };
    if (reflectionText) {
      patch.reflection = { day: key, text: reflectionText };
    }
    dispatch({ type: 'set', patch });
    if (!isDone(step)) {
      const left = STEPS.filter((x) => x !== step && !doneToday.includes(x)).length;
      toast.show(left ? `${STEP_META[step].label} done · ${left} to go` : 'Today’s rhythm complete ✦', { icon: left ? 'check' : 'star', haptic: left ? 'light' : 'success' });
    }
  };

  // Verse of the day (the Daily Bread card opens it; Reflect below uses it)
  const v = verseOfDay(today);
  const vRef = refLabel(v.bookId, v.chapter, v.verse);

  // Reading plan
  const plan = (state.plans || []).find((p) => !p.startsOn && p.done < p.days) || (state.plans || [])[0];
  const season = (state.plans || []).find((p) => p.startsOn);
  const seasonDays = season ? Math.max(0, Math.ceil((new Date(season.startsOn) - today) / 86400000)) : null;

  // Prayer
  const activePrayers = (state.prayers || []).filter((p) => p.status !== 'answered' && !p.mine);

  // Continue reading
  const last = state.lastPosition || { bookId: 'MAT', chapter: 1 };

  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  // First name only so the greeting fits ("Rev. Esther Mwangi" → "Esther")
  const name = (() => {
    const parts = String((state.user && state.user.displayName) || '').trim().split(/\s+/).filter(Boolean);
    const first = parts.find((w) => !/^(rev|pastor|ps|dr|mr|mrs|ms|miss|fr|sr|bro|sis|bishop|elder|deacon|apostle|prophet|evangelist)\.?$/i.test(w));
    return first || parts[0] || 'friend';
  })();
  const doneCount = STEPS.filter(isDone).length;
  const minsLeft = STEPS.filter((s) => !isDone(s)).reduce((n, s) => n + STEP_META[s].mins, 0);
  const allDone = doneCount === STEPS.length;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeInUp index={0} style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
            <Text style={[styles.greeting, (greeting + name).length > 14 && { fontSize: (greeting + name).length > 19 ? 22 : 25, lineHeight: (greeting + name).length > 19 ? 27 : 30 }]} numberOfLines={2}>{greeting}, {name}</Text>
          </View>
          {showStreak ? (
            <Pressable onPress={() => setStreakOpen(true)} style={({ pressed }) => [styles.streakChip, pressed && { opacity: 0.8 }]} accessibilityLabel={`${streak} day streak`}>
              <Pulse min={0.92} max={1.1} duration={1100} active={streak > 0}>
                <Icon name="flame" size={17} color={colors.terracotta} fill={streak > 0 ? 'solid' : 'none'} />
              </Pulse>
              <Pop trigger={streak}><AnimatedNumber value={streak} style={styles.streakChipText} /></Pop>
            </Pressable>
          ) : null}
          <ProfileButton />
        </FadeInUp>

        <AnnouncementCards style={{ marginHorizontal: 18, marginTop: 16 }} />

        {/* Week strip */}
        <FadeInUp index={1} style={styles.weekCard}>
          {weekDays(today).map((d, wi) => {
            const k = dayKey(d);
            const did = ((state.rhythm || {})[k] || []).length > 0;
            const isToday = k === key;
            const future = d > today && !isToday;
            return (
              <View key={k} style={styles.weekDay}>
                <Text style={[styles.weekLetter, isToday && { color: colors.primary }]}>
                  {d.toLocaleDateString(undefined, { weekday: 'narrow' })}
                </Text>
                {did ? (
                  <ScaleIn key={k + '-done'} delay={180 + wi * 60} style={[styles.weekDot, styles.weekDotDone]}>
                    <Icon name="check" size={13} color="#FFFFFF" strokeWidth={3} />
                  </ScaleIn>
                ) : (
                  <View style={[styles.weekDot, isToday && styles.weekDotToday, future && { opacity: 0.45 }]}>
                    <Text style={[styles.weekNum, isToday && { color: colors.primary }]}>{d.getDate()}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </FadeInUp>

        {/* Rhythm header */}
        <FadeInUp index={2} style={styles.rhythmHead}>
          <View>
            <Text style={styles.sectionEyebrow}>Daily rhythm</Text>
            <Text style={styles.sectionTitle}>{allDone ? 'All done for today' : 'Your time with God'}</Text>
          </View>
          <Text style={styles.rhythmMeta}>{allDone ? `${doneCount} of 4` : `${doneCount} of 4 · ~${minsLeft} min`}</Text>
        </FadeInUp>
        <FadeInUp index={2} style={styles.progressRow}>
          {STEPS.map((s, si) => (
            <AnimatedBar key={s} progress={isDone(s) ? 1 : 0} delay={200 + si * 90} style={styles.progressSeg} fillStyle={{ backgroundColor: colors.gold, borderRadius: 2 }} />
          ))}
        </FadeInUp>

        {/* Today's journey: Daily Bread · Videos · Prayer Wall (replaces the Verse of the Day card) */}
        <FadeInUp index={3} style={styles.journey}>
          <TodaysJourney
            verse={{ label: vRef, reflection: v.reflection }}
            prayersCount={activePrayers.length}
            done={{ bread: isDone('verse'), prayer: isDone('prayer') }}
            onBread={() => { markDone('verse'); nav.push('DailyVerse'); }}
            onVideos={() => nav.push('BlessingVideos')}
            onPrayer={() => { markDone('prayer'); nav.push('PrayerWall'); }}
          />
        </FadeInUp>

        {/* Steps */}
        <View style={styles.steps}>
          {/* 2. Today's reading */}
          {plan ? (
            <FadeInUp index={4}>
            <Step n={1} done={isDone('reading')}>
              <Pressable
                onPress={() => { markDone('reading'); nav.push('Bible', { bookId: plan.today.bookId, chapter: plan.today.chapter }); }}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.cardRow}>
                  <View style={[styles.iconTile, { backgroundColor: colors.cardSage }]}>
                    <Icon name="book" size={22} color={colors.sage} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.cardEyebrow} numberOfLines={1}>Day {plan.done + 1} of {plan.days}</Text>
                    <Text style={styles.cardTitle}>{bookName(plan.today.bookId)} {plan.today.chapter}</Text>
                    <Text style={styles.cardSub} numberOfLines={1}>{CHAPTER_TITLES[`${plan.today.bookId}:${plan.today.chapter}`] || 'Continue your plan'}</Text>
                  </View>
                  <StepCta done={isDone('reading')} label="Read" />
                </View>
                <AnimatedBar progress={(plan.done + (isDone('reading') ? 1 : 0)) / plan.days} delay={500} style={styles.planBar} fillStyle={styles.planBarFill} />
              </Pressable>
            </Step>
          </FadeInUp>
          ) : null}

          {/* 3. Pray */}
          <FadeInUp index={5}>
          <Step n={plan ? 2 : 1} done={isDone('prayer')}>
            <Pressable onPress={() => { markDone('prayer'); nav.push('PrayerWall'); }} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
              <View style={styles.cardRow}>
                <View style={[styles.iconTile, { backgroundColor: colors.cardRose }]}>
                  <Icon name="prayer" size={22} color={colors.rose} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardEyebrow} numberOfLines={1}>{activePrayers.length} {activePrayers.length === 1 ? 'request' : 'requests'} today</Text>
                  <Text style={styles.cardTitle} numberOfLines={1}>Pray for others</Text>
                  <View style={styles.faces}>
                    {activePrayers.slice(0, 4).map((p, i) => (
                      <View key={p.id} style={[styles.face, { marginLeft: i ? -8 : 0, backgroundColor: [colors.cardRose, colors.cardSky, colors.cardGold, colors.cardSage][i % 4] }]}>
                        <Text style={styles.faceText}>{(p.author || '?').charAt(0)}</Text>
                      </View>
                    ))}
                    <Text style={styles.cardSub} numberOfLines={1}>  {activePrayers[0] ? activePrayers[0].title : 'Lift someone up today'}</Text>
                  </View>
                </View>
                <StepCta done={isDone('prayer')} label="Pray" />
              </View>
            </Pressable>
          </Step>
          </FadeInUp>

          {/* 4. Reflect */}
          <FadeInUp index={6}>
          <Step n={plan ? 3 : 2} done={isDone('reflect')} last>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <View style={[styles.iconTile, { backgroundColor: colors.cardLavender }]}>
                  <Icon name="highlight" size={21} color={colors.lavender} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardEyebrow} numberOfLines={1}>Reflect · {vRef}</Text>
                  <Text style={styles.cardTitle}>What is God saying to you?</Text>
                </View>
              </View>
              <Text style={styles.prompt}>{v.reflection}</Text>
              {isDone('reflect') ? (
                <View style={styles.savedRow}>
                  <Icon name="check-circle" size={18} color={colors.sage} />
                  <Text style={styles.savedText}>Saved to your notes on {vRef}</Text>
                </View>
              ) : (
                <>
                  <TextInput
                    value={reflection}
                    onChangeText={setReflection}
                    placeholder="Write a sentence or two…"
                    placeholderTextColor={colors.faint}
                    multiline
                    style={styles.journal}
                  />
                  <Pressable
                    onPress={() => {
                      const text = reflection.trim();
                      if (text) {
                        dispatch({ type: 'note', n: { bookId: v.bookId, chapter: v.chapter, verse: v.verse, text, label: 'Reflection' } });
                        markDone('reflect', text);
                      } else {
                        markDone('reflect');
                      }
                      setReflection('');
                    }}
                    style={({ pressed }) => [styles.reflectBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.reflectBtnText}>{reflection.trim() ? 'Save reflection' : 'I’ve reflected'}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </Step>
          </FadeInUp>
        </View>

        {/* Completion */}
        {allDone ? (
          <ScaleIn style={[styles.doneCard]}>
            <NightGlow />
            <Burst trigger={allDone} count={14} radius={110} size={14} />
            <Pulse min={0.9} max={1.15}><Text style={styles.doneStar}>✦</Text></Pulse>
            <Text style={styles.doneTitle}>Today’s rhythm is complete</Text>
            <Text style={styles.doneBody}>
              {showStreak && streak > 1 ? `${streak} days in the Word. ` : ''}Rest well — tomorrow continues with {plan ? `${bookName(plan.today.bookId)} ${plan.today.chapter + 1}` : 'a fresh verse'}.
            </Text>
          </ScaleIn>
        ) : null}

        {/* Care: a warm invitation, high on Today so no one misses it */}
        <FadeInUp index={6} style={styles.block}>
          <CareInvite />
        </FadeInUp>

        {/* Support us — four 🔥 rewarded ads a day */}
        <FadeInUp index={6}>
          <SupportAdsCard />
        </FadeInUp>

        {/* Scripture pop-ups entry */}
        <FadeInUp index={6} style={[styles.block, { marginTop: 14 }]}>
          <PressScale onPress={() => nav.push('ScripturePop')} scaleTo={0.98} style={styles.popRow}>
            <View style={styles.popIcon}><Icon name="bell" size={18} color={colors.primary} fill={state.scripturePop?.enabled ? 'solid' : 'none'} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>Scripture pop-ups</Text>
              <Text style={styles.cardSub} numberOfLines={1}>{state.scripturePop?.enabled ? 'On · verses & prayers through your day' : 'Get a verse or prayer on your screen through the day'}</Text>
            </View>
            <Text style={[styles.popState, state.scripturePop?.enabled && { color: colors.primary }]}>{state.scripturePop?.enabled ? 'On' : 'Set up'}</Text>
          </PressScale>
        </FadeInUp>

        {/* Continue reading */}
        <FadeInUp index={7} style={styles.block}>
          <Text style={styles.sectionEyebrow}>Pick up where you left off</Text>
          <Pressable onPress={() => nav.push('Bible', last)} style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}>
            <View style={styles.continueSpine}>
              <Text style={styles.continueSpineText}>{bookName(last.bookId).slice(0, 3).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>{bookName(last.bookId)} {last.chapter}</Text>
              <Text style={styles.cardSub} numberOfLines={1}>{CHAPTER_TITLES[`${last.bookId}:${last.chapter}`] || 'Continue reading'}</Text>
            </View>
            <View style={styles.continueBtn}>
              <Icon name="arrow-right" size={17} color={colors.primary} strokeWidth={2.2} />
            </View>
          </Pressable>
        </FadeInUp>

        {/* Season challenge */}
        {season ? (
          <FadeInUp index={8} style={styles.block}>
            <Text style={styles.sectionEyebrow}>Coming up</Text>
            <Pressable onPress={() => nav.push('Plan', { id: season.id })} style={({ pressed }) => [styles.seasonCard, pressed && { opacity: 0.92 }]}>
              <View style={styles.seasonArt}>
                <Text style={styles.seasonArtStar}>✦</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.seasonEyebrow}>{seasonDays > 0 ? `Starts in ${seasonDays} days` : 'Starts today'} · {season.days} days</Text>
                <Text style={styles.seasonTitle}>{season.name}</Text>
                <Text style={styles.seasonSub}>Journey to Christmas with a chapter and a prayer each day.</Text>
              </View>
            </Pressable>
          </FadeInUp>
        ) : null}

        {/* Quick links */}
        <View style={[styles.block, { flexDirection: 'row', gap: 10 }]}>
          <QuickTile icon="sparkles" label="Ask Scripture" tint={colors.gold} bg={colors.cardGold} onPress={() => nav.push('BibleChat')} />
          <QuickTile icon="heart" label="Companion" tint={colors.rose} bg={colors.cardRose} onPress={() => nav.push('Companion')} />
          <QuickTile icon="bookmark" label="Library" tint={colors.lavender} bg={colors.cardLavender} onPress={() => nav.push('Library')} />
        </View>

        {/* Watch: From Our Channels (replaces Sacred Audio Devotionals) */}
        <ChannelVideosRow style={styles.block} />
      </ScrollView>

      {/* Streak sheet */}
      <AnimatedModal visible={streakOpen} onRequestClose={() => setStreakOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setStreakOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.flameWrap}>
              <Icon name="flame" size={44} color={colors.terracotta} fill="solid" />
            </View>
            <Text style={styles.streakBig}>{streak}</Text>
            <Text style={styles.streakLabel}>day streak</Text>
            <View style={styles.statsRow}>
              <View style={styles.stat}><Text style={styles.statNum}>{streak}</Text><Text style={styles.statLabel}>Current</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.stat}><Text style={styles.statNum}>{best}</Text><Text style={styles.statLabel}>Longest</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.stat}><Text style={styles.statNum}>{graceUsedThisWeek ? 0 : 1}</Text><Text style={styles.statLabel}>Grace day left</Text></View>
            </View>
            <Text style={styles.streakExplain}>
              Your streak grows each day you complete at least one step of your rhythm. Miss a day? One grace day each week keeps it going — this is about returning, not perfection.
            </Text>
            <Pressable onPress={() => setStreakOpen(false)} style={({ pressed }) => [styles.sheetBtn, pressed && { opacity: 0.88 }]}>
              <Text style={styles.sheetBtnText}>Keep going</Text>
            </Pressable>
            <Pressable
              onPress={() => { dispatch({ type: 'set', patch: { streaksEnabled: false } }); setStreakOpen(false); }}
              style={{ alignSelf: 'center', paddingVertical: 12 }}
            >
              <Text style={styles.hideStreak}>Hide streaks · you can turn them back on in plan settings</Text>
            </Pressable>
          </View>
        </View>
      </AnimatedModal>
    </View>
  );
}

function Step({ n, done, last, children }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepRail}>
        <Pop trigger={done} amount={1.35}>
          <View style={[styles.stepDot, done && styles.stepDotDone]}>
            {done ? <Icon name="check" size={13} color="#FFFFFF" strokeWidth={3} /> : <Text style={styles.stepNum}>{n}</Text>}
            <Burst trigger={done} radius={26} count={8} size={9} />
          </View>
        </Pop>
        {!last ? <View style={[styles.stepLine, done && { backgroundColor: alpha(colors.gold, 0.5) }]} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 14 }}>{children}</View>
    </View>
  );
}

function StepCta({ done, label }) {
  return done ? (
    <View style={[styles.cta, styles.ctaDone]}>
      <Icon name="check" size={14} color={colors.sage} strokeWidth={2.8} />
    </View>
  ) : (
    <View style={styles.cta}>
      <Text style={styles.ctaText}>{label}</Text>
    </View>
  );
}

function QuickTile({ icon, label, tint, bg, onPress }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.94} style={styles.quickTile}>
      <View style={[styles.quickIcon, { backgroundColor: bg }]}><Icon name={icon} size={19} color={tint} /></View>
      <Text style={styles.quickLabel} numberOfLines={1}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screen },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12 },
  eyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.gold },
  greeting: { fontFamily: fonts.display, fontSize: 29, lineHeight: 35, letterSpacing: -0.6, color: colors.fg, marginTop: 2 },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  streakChipText: { fontSize: 16, fontWeight: '800', color: colors.fg },

  weekCard: { flexDirection: 'row', marginHorizontal: 18, marginTop: 16, paddingVertical: 12, paddingHorizontal: 6, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  weekDay: { flex: 1, alignItems: 'center', gap: 7 },
  weekLetter: { fontSize: 11, fontWeight: '700', color: colors.faint },
  weekDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  weekDotDone: { backgroundColor: colors.gold },
  weekDotToday: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  weekNum: { fontSize: 12.5, fontWeight: '700', color: colors.muted },

  popRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 4 },
  popIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  popState: { fontSize: 13, fontWeight: '700', color: colors.muted },
  rhythmHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 18, marginTop: 26 },
  sectionEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.gold, marginBottom: 2 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 22, letterSpacing: -0.3, color: colors.fg },
  rhythmMeta: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 4 },
  progressRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 18, marginTop: 10 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },

  journey: { paddingHorizontal: 18, marginTop: 16 },
  steps: { paddingHorizontal: 18, marginTop: 18 },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepRail: { width: 26, alignItems: 'center' },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.screen, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  stepDotDone: { backgroundColor: colors.gold, borderColor: colors.gold },
  stepNum: { fontSize: 12, fontWeight: '800', color: colors.muted },
  stepLine: { flex: 1, width: 2, borderRadius: 1, backgroundColor: colors.border, marginTop: 4 },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow.sm },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconTile: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cardEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', color: colors.muted },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, marginTop: 2, letterSpacing: -0.2 },
  cardSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  cta: { height: 34, minWidth: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  ctaDone: { backgroundColor: colors.cardSage, paddingHorizontal: 0 },
  planBar: { height: 4, borderRadius: 2, backgroundColor: colors.raised, marginTop: 14, overflow: 'hidden' },
  planBarFill: { height: 4, borderRadius: 2, backgroundColor: colors.sage },
  faces: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  face: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.surface },
  faceText: { fontSize: 10, fontWeight: '800', color: colors.fg },
  prompt: { fontFamily: fonts.serifItalic, fontSize: 15.5, lineHeight: 22, color: colors.passage, marginTop: 12 },
  journal: { marginTop: 12, minHeight: 74, borderRadius: radius.md, backgroundColor: colors.raised, padding: 12, fontSize: 14, color: colors.fg, textAlignVertical: 'top' },
  reflectBtn: { marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: colors.fg, alignItems: 'center', justifyContent: 'center' },
  reflectBtnText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  savedText: { fontSize: 12.5, fontWeight: '600', color: colors.sage },

  doneCard: { marginHorizontal: 18, marginTop: 18, borderRadius: radius.xl, padding: 22, overflow: 'hidden', alignItems: 'center', ...shadow.md },
  doneStar: { fontSize: 20, color: colors.goldLight },
  doneTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.nightFg, marginTop: 6, textAlign: 'center' },
  doneBody: { fontSize: 13.5, lineHeight: 19, color: colors.nightMuted, marginTop: 6, textAlign: 'center' },

  block: { paddingHorizontal: 18, marginTop: 26 },
  continueCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, ...shadow.sm },
  continueSpine: { width: 46, height: 60, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  continueSpineText: { fontFamily: fonts.serifBold, fontSize: 13, color: colors.goldLight, letterSpacing: 1 },
  continueBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },

  seasonCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, borderRadius: radius.lg, padding: 14, backgroundColor: colors.cardLavender, borderWidth: 1, borderColor: alpha(colors.lavender, 0.18) },
  seasonArt: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  seasonArtStar: { fontSize: 26, color: '#F4E3B5' },
  seasonEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', color: colors.lavender },
  seasonTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg, marginTop: 2 },
  seasonSub: { fontSize: 12.5, color: colors.muted, marginTop: 2, lineHeight: 17 },

  quickTile: { flex: 1, alignItems: 'center', paddingVertical: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  quickIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 12, fontWeight: '600', color: colors.fg, marginTop: 8 },

  backdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.screen, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 22, alignItems: 'stretch' },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 18 },
  flameWrap: { alignSelf: 'center', width: 84, height: 84, borderRadius: 42, backgroundColor: colors.terracottaFaint, alignItems: 'center', justifyContent: 'center' },
  streakBig: { fontFamily: fonts.display, fontSize: 56, lineHeight: 62, color: colors.fg, textAlign: 'center', marginTop: 8 },
  streakLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.terracotta, textAlign: 'center' },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: 14 },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg },
  statLabel: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: colors.border },
  streakExplain: { fontSize: 13.5, lineHeight: 20, color: colors.muted, marginTop: 16, textAlign: 'center' },
  sheetBtn: { marginTop: 20, height: 50, borderRadius: 25, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sheetBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  hideStreak: { fontSize: 12.5, fontWeight: '600', color: colors.muted, textAlign: 'center' },
});
