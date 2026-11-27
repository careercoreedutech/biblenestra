// Today — rebuilt in the Figma "Project Document Analysis" design (src/design/sanctuary.js), on real data:
// greeting, verse of the day (Daily Bread), the streak, the four-step daily rhythm, shortcuts, the daily
// sanctuary grid, Be still (blessing videos), the community card, then the existing live sections.
// The previous version is kept in TodayScreenClassic.js.
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AnimatedModal } from '../components/Motion';
import { Icon } from '../components/Icons';
import { useToast } from '../components/Toast';
import VerseImageSheet from '../components/VerseImageSheet';
import CareInvite from '../components/CareInvite';
import SupportAdsCard from '../components/SupportAdsCard';
import ChannelVideosRow from '../components/ChannelVideosRow';
import AnnouncementCards from '../components/AnnouncementCards';
import { useNarration } from '../audio/Narration';
import { useChapter } from '../bible/loader';
import { useStore } from '../store';
import { useNav } from '../navigation';
import { bookName, CHAPTER_TITLES } from '../data/bible';
import { STEPS, dayKey, computeStreak } from '../data/rhythm';
import { useTodayVerse } from './DailyScreens';
import { d, df, k, images, fillImage, gradients, Grad, Tap, Eyebrow, PageHeader, SectionTitle } from '../design/sanctuary';

const STEP_LABEL = { verse: 'Verse', reading: 'Reading', prayer: 'Prayer', reflect: 'Reflect' };

export default function TodayScreen() {
  const { state, dispatch } = useStore();
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const today = new Date();
  const key = dayKey(today);
  const doneToday = (state.rhythm && state.rhythm[key]) || [];
  const isDone = (s) => doneToday.includes(s);
  const { streak, graceUsedThisWeek } = useMemo(() => computeStreak(state.rhythm || {}, today), [state.rhythm]);
  const best = Math.max(state.bestStreak || 0, streak);
  const [streakOpen, setStreakOpen] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflection, setReflection] = useState('');
  const [imageOpen, setImageOpen] = useState(false);

  // Verse of the day: the same verse as Daily Bread, text from the Bible data
  const { v } = useTodayVerse();
  const tr = state.translation || 'KJV';
  const { verses } = useChapter(tr, v.bookId, v.chapter);
  const text = useMemo(() => {
    if (!verses) return '';
    const end = v.verseEnd && v.verseEnd > v.verse ? v.verseEnd : v.verse;
    return verses.slice(v.verse - 1, end).filter(Boolean).join(' ');
  }, [verses, v.bookId, v.chapter, v.verse, v.verseEnd]);
  const saved = (state.bookmarks || []).some((b) => b.bookId === v.bookId && b.chapter === v.chapter && (b.verse || null) === v.verse);

  const markDone = (step, reflectionText) => {
    if (isDone(step) && !reflectionText) return;
    const nextSteps = isDone(step) ? doneToday : [...doneToday, step];
    const next = { ...(state.rhythm || {}), [key]: nextSteps };
    const s = computeStreak(next, today).streak;
    const patch = { rhythm: next, bestStreak: Math.max(state.bestStreak || 0, s) };
    if (reflectionText) patch.reflection = { day: key, text: reflectionText };
    dispatch({ type: 'set', patch });
    if (!isDone(step)) {
      const left = STEPS.filter((x) => x !== step && !doneToday.includes(x)).length;
      toast.show(left ? `${STEP_LABEL[step]} done · ${left} to go` : 'Today’s rhythm complete ✦', { icon: left ? 'check' : 'star', haptic: left ? 'light' : 'success' });
    }
  };

  const plan = (state.plans || []).find((p) => !p.startsOn && p.done < p.days) || null;
  const last = state.lastPosition || { bookId: 'MAT', chapter: 1 };
  const reading = plan ? plan.today : last;
  const activePrayers = (state.prayers || []).filter((p) => p.status !== 'answered' && !p.mine);

  const openStep = (s) => {
    if (s === 'verse') { markDone('verse'); nav.push('DailyVerse'); }
    else if (s === 'reading') { markDone('reading'); nav.push('Bible', { bookId: reading.bookId, chapter: reading.chapter }); }
    else if (s === 'prayer') { markDone('prayer'); nav.push('PrayerWall'); }
    else setReflectOpen(true);
  };

  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (() => {
    const parts = String((state.user && state.user.displayName) || '').trim().split(/\s+/).filter(Boolean);
    const first = parts.find((w) => !/^(rev|pastor|ps|dr|mr|mrs|ms|miss|fr|sr|bro|sis|bishop|elder|deacon|apostle|prophet|evangelist)\.?$/i.test(w));
    return first || parts[0] || 'friend';
  })();
  const rhythmTitle = streak >= 14 ? `${Math.floor(streak / 7)} weeks of showing up` : streak >= 7 ? 'A full week of showing up' : streak > 1 ? `${streak} days of showing up` : streak === 1 ? 'You showed up today' : 'Begin your rhythm today';

  return (
    <View style={k.screen}>
      <ScrollView contentContainerStyle={[k.scroll, { paddingBottom: 24 }]} showsVerticalScrollIndicator={false}>
        <PageHeader title={`${greeting}, ${name}`} subtitle={today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} />

        <AnnouncementCards style={{ marginBottom: 12 }} />

        {/* .verse-hero */}
        <Grad colors={gradients.hero} locations={[0, 0.72, 1]} style={s.hero}>
          <View style={s.heroRing} />
          <View style={s.heroTop}>
            <View style={s.heroLabel}><Icon name="sun" size={14} color="#FFD8BD" /><Text style={s.heroLabelText}>Verse of the day</Text></View>
            <Tap style={s.heroSave} onPress={() => { dispatch({ type: 'bookmark', b: { bookId: v.bookId, chapter: v.chapter, verse: v.verse } }); toast.show(saved ? 'Removed from saved' : 'Saved', { icon: 'bookmark' }); }} accessibilityLabel={saved ? 'Remove from saved' : 'Save verse'}>
              <Icon name={saved ? 'check' : 'bookmark'} size={18} color="#fff" />
            </Tap>
          </View>
          <Tap onPress={() => openStep('verse')} style={s.verseCopy}>
            <Text style={s.verseText} numberOfLines={7}>“{text || '…'}”</Text>
            <Text style={s.verseRef}>{v.label} · {tr}</Text>
          </Tap>
          <View style={s.heroActions}>
            <Tap style={s.heroBtn} onPress={() => openStep('verse')}><Icon name="book" size={17} color="#fff" /><Text style={s.heroBtnText}>Reflect</Text></Tap>
            <Tap style={s.heroBtn} onPress={() => nar.playVerse(v.bookId, v.chapter, v.verse, { translation: tr })}><Icon name="headphones" size={17} color="#fff" /><Text style={s.heroBtnText}>Listen</Text></Tap>
            <Tap style={[s.heroBtn, s.heroShare]} onPress={() => setImageOpen(true)} accessibilityLabel="Share verse"><Icon name="share" size={17} color="#fff" /></Tap>
          </View>
        </Grad>

        {/* .rhythm-card */}
        {state.streaksEnabled !== false ? (
          <Tap style={s.rhythm} onPress={() => setStreakOpen(true)} accessibilityLabel={`${streak} day streak`}>
            <View style={s.ring}><Text style={s.ringNum}>{streak}</Text><Text style={s.ringSmall}>{streak === 1 ? 'day' : 'days'}</Text></View>
            <View style={{ flex: 1, paddingRight: 24 }}>
              <Eyebrow>Your sacred rhythm</Eyebrow>
              <Text style={s.rhythmTitle}>{rhythmTitle}</Text>
              <Text style={s.rhythmSub}>Grace meets consistency. Keep going gently.</Text>
            </View>
            <View style={s.flame}><Icon name="flame" size={23} color="#D98D4A" /></View>
          </Tap>
        ) : null}

        {/* .daily-steps */}
        <View style={s.steps}>
          <View style={s.stepsLine} />
          {STEPS.map((st, i) => {
            const done = isDone(st);
            return (
              <Tap key={st} style={s.step} onPress={() => openStep(st)} accessibilityLabel={`${STEP_LABEL[st]}${done ? ', done' : ''}`}>
                {done ? (
                  <Grad colors={gradients.step} style={s.stepBadge}><Icon name="check" size={13} color="#fff" strokeWidth={3} /></Grad>
                ) : (
                  <View style={[s.stepBadge, { backgroundColor: '#EEE5DB' }]}><Text style={s.stepNum}>{i + 1}</Text></View>
                )}
                <Text style={[s.stepLabel, done && { color: d.plum }]}>{STEP_LABEL[st]}</Text>
              </Tap>
            );
          })}
        </View>

        {/* .today-shortcuts */}
        <View style={{ gap: 7, marginTop: 9 }}>
          {[
            { label: 'Ask Scripture', sub: 'Explore any passage', icon: 'sparkles', g: gradients.orange, to: 'BibleChat' },
            { label: 'Companion', sub: 'Wisdom for today', icon: 'prayer', g: gradients.gold, to: 'Companion' },
            { label: 'Library', sub: 'Everything you saved', icon: 'bookmark', g: gradients.ink, to: 'Library' },
          ].map((x) => (
            <Tap key={x.label} style={s.shortcut} onPress={() => nav.push(x.to)}>
              <View>
                <Grad colors={x.g} style={s.shortcutIcon}><Icon name={x.icon} size={18} color="#fff" /></Grad>
                <View style={s.shortcutDot} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.shortcutTitle}>{x.label}</Text>
                <Text style={s.shortcutSub}>{x.sub}</Text>
              </View>
              <Icon name="arrow-right" size={15} color={d.muted} />
            </Tap>
          ))}
        </View>

        {/* .quick-grid */}
        <SectionTitle eyebrow="For this moment" title="Your daily sanctuary" />
        <View style={s.grid}>
          <QuickCard bg={d.lavender} icon="book" small="Continue reading" title={`${bookName(last.bookId)} ${last.chapter}`} sub={CHAPTER_TITLES[`${last.bookId}:${last.chapter}`] || 'Pick up where you left off'} onPress={() => nav.push('Bible', last)} />
          <QuickCard bg={d.sage} icon="prayer" small="Prayer" title="Prayer wall" sub={`${activePrayers.length} ${activePrayers.length === 1 ? 'request' : 'requests'} today`} onPress={() => nav.push('PrayerWall')} />
          <QuickCard bg={d.gold} icon="mic" small="Sermon studio" title="Start recording" sub="Capture every word" onPress={() => nav.push('SermonStudio')} />
          <QuickCard ink icon="quiz" small="Daily challenge" title="Bible games" sub="A fresh set today" onPress={() => nav.push('Learn', { tab: 'Games' })} />
        </View>

        {/* .still-card */}
        <SectionTitle eyebrow="One quiet minute" title="Be still" link="Begin" onLink={() => nav.push('BlessingVideos')} />
        <Tap style={s.still} onPress={() => nav.push('BlessingVideos')}>
          <Grad colors={['#F2D2B5', '#F5E8D5']} style={s.stillArt}>
            <View style={s.stillRing3} /><View style={s.stillRing2} /><View style={s.stillRing1} />
            <Icon name="volume" size={30} color={d.plum} />
          </Grad>
          <View style={s.stillCopy}>
            <Text style={s.stillKicker}>Blessing videos</Text>
            <Text style={s.stillTitle}>Rest in His presence</Text>
            <Text style={s.stillSub}>Let the noise soften. Return to what is eternal.</Text>
            <View style={s.playBtn}><Icon name="play" size={13} color="#fff" fill="solid" /><Text style={s.playText}>Watch</Text></View>
          </View>
        </Tap>

        {/* .community-preview */}
        <SectionTitle title="In your community" link="See all" onLink={() => nav.push('PrayerWall')} />
        <Tap style={s.community} onPress={() => nav.push('PrayerWall')}>
          <Image source={images.fellowship} style={fillImage} resizeMode="cover" />
          <Grad colors={['rgba(16,15,27,0)', 'rgba(16,15,27,0.82)']} locations={[0.22, 1]} style={StyleSheet.absoluteFill} />
          <View style={s.communityCopy}>
            <Text style={s.communityKicker}>LIVE FELLOWSHIP</Text>
            <Text style={s.communityTitle}>Praying together</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="users" size={14} color="rgba(255,255,255,0.8)" />
              <Text style={s.communitySub}>{activePrayers.length} prayer {activePrayers.length === 1 ? 'request' : 'requests'} open now</Text>
            </View>
          </View>
        </Tap>

        {/* Existing live sections */}
        <View style={{ marginTop: 22 }}><CareInvite /></View>
        <View style={{ marginHorizontal: -18 }}><SupportAdsCard /></View>
        <Tap style={[s.shortcut, { marginTop: 14 }]} onPress={() => nav.push('ScripturePop')}>
          <Grad colors={gradients.orange} style={s.shortcutIcon}><Icon name="bell" size={18} color="#fff" /></Grad>
          <View style={{ flex: 1 }}>
            <Text style={s.shortcutTitle}>Scripture pop-ups</Text>
            <Text style={s.shortcutSub}>{state.scripturePop?.enabled ? 'On · verses & prayers through your day' : 'A verse or prayer on your screen through the day'}</Text>
          </View>
          <Text style={{ fontFamily: df.sansBold, fontSize: 11, color: state.scripturePop?.enabled ? d.plum : d.muted }}>{state.scripturePop?.enabled ? 'On' : 'Set up'}</Text>
        </Tap>
        <ChannelVideosRow style={{ marginTop: 18, marginHorizontal: -18 }} />
      </ScrollView>

      <VerseImageSheet visible={imageOpen} onClose={() => setImageOpen(false)} text={text} reference={v.label} translation={tr} />

      {/* Reflect */}
      <AnimatedModal visible={reflectOpen} onRequestClose={() => setReflectOpen(false)}>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setReflectOpen(false)} />
          <View style={s.sheet}>
            <View style={s.grabber} />
            <Eyebrow>Reflect · {v.label}</Eyebrow>
            <Text style={s.sheetTitle}>What is God saying to you?</Text>
            {v.reflection ? <Text style={s.sheetBody}>{v.reflection}</Text> : null}
            <TextInput value={reflection} onChangeText={setReflection} placeholder="Write a sentence or two…" placeholderTextColor={d.muted} multiline style={s.input} />
            <Tap
              style={s.primary}
              onPress={() => {
                const t = reflection.trim();
                if (t) { dispatch({ type: 'note', n: { bookId: v.bookId, chapter: v.chapter, verse: v.verse, text: t, label: 'Reflection' } }); markDone('reflect', t); } else markDone('reflect');
                setReflection(''); setReflectOpen(false);
              }}
            >
              <Text style={s.primaryText}>{reflection.trim() ? 'Save reflection' : 'I’ve reflected'}</Text>
            </Tap>
          </View>
        </View>
      </AnimatedModal>

      {/* Streak */}
      <AnimatedModal visible={streakOpen} onRequestClose={() => setStreakOpen(false)}>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setStreakOpen(false)} />
          <View style={[s.sheet, { alignItems: 'center' }]}>
            <View style={s.grabber} />
            <Icon name="flame" size={44} color={d.plum} fill="solid" />
            <Text style={s.streakBig}>{streak}</Text>
            <Text style={s.sheetBody}>day rhythm</Text>
            <View style={s.stats}>
              {[[streak, 'Current'], [best, 'Longest'], [graceUsedThisWeek ? 0 : 1, 'Grace day left']].map(([n, l]) => (
                <View key={l} style={{ flex: 1, alignItems: 'center' }}><Text style={s.statNum}>{n}</Text><Text style={s.statLabel}>{l}</Text></View>
              ))}
            </View>
            <Text style={[s.sheetBody, { textAlign: 'center' }]}>Your rhythm grows each day you complete at least one step. Miss a day? One grace day each week keeps it going — this is about returning, not perfection.</Text>
            <Tap style={[s.primary, { alignSelf: 'stretch' }]} onPress={() => setStreakOpen(false)}><Text style={s.primaryText}>Keep going</Text></Tap>
            <Pressable onPress={() => { dispatch({ type: 'set', patch: { streaksEnabled: false } }); setStreakOpen(false); }} style={{ paddingVertical: 12 }}>
              <Text style={[s.sheetBody, { fontSize: 11 }]}>Hide streaks · turn them back on in plan settings</Text>
            </Pressable>
          </View>
        </View>
      </AnimatedModal>
    </View>
  );
}

function QuickCard({ bg, ink, icon, small, title, sub, onPress }) {
  const fg = ink ? '#fff' : d.ink;
  return (
    <Tap style={[s.quick, { backgroundColor: ink ? d.ink : bg }]} onPress={onPress}>
      <View style={[s.quickIcon, ink && { backgroundColor: 'rgba(255,255,255,0.12)' }]}><Icon name={icon} size={19} color={fg} /></View>
      <Text style={[s.quickSmall, { color: fg }]} numberOfLines={1}>{small}</Text>
      <Text style={[s.quickTitle, { color: fg }]} numberOfLines={1}>{title}</Text>
      <Text style={[s.quickSub, { color: fg }]} numberOfLines={1}>{sub}</Text>
    </Tap>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: 28, padding: 20, overflow: 'hidden', shadowColor: '#372B7D', shadowOpacity: 0.25, shadowRadius: 22, shadowOffset: { width: 0, height: 22 }, elevation: 8 },
  heroRing: { position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 30, borderColor: 'rgba(255,255,255,0.06)', right: -70, top: -75 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroLabelText: { fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', fontFamily: df.sansBold, color: '#FFD8BD' },
  heroSave: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  verseCopy: { paddingTop: 33, paddingBottom: 30 },
  verseText: { fontFamily: df.display, fontSize: 27, lineHeight: 34, color: '#fff', maxWidth: 320 },
  verseRef: { color: '#F7C9A8', fontSize: 11, marginTop: 15, fontFamily: df.sans },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroBtn: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 13, borderRadius: 12 },
  heroBtnText: { color: '#fff', fontSize: 11, fontFamily: df.sansBold },
  heroShare: { marginLeft: 'auto', paddingHorizontal: 0, width: 38, justifyContent: 'center' },
  rhythm: { marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 20 },
  ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 5, borderColor: '#F3D8C0', borderTopColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  ringNum: { fontFamily: df.sansHeavy, fontSize: 18, lineHeight: 20, color: d.ink },
  ringSmall: { fontSize: 8, color: d.muted, textTransform: 'uppercase', fontFamily: df.sans },
  rhythmTitle: { fontSize: 13, marginTop: 4, marginBottom: 2, color: d.ink, fontFamily: df.sansMedium },
  rhythmSub: { color: d.muted, fontSize: 10, fontFamily: df.sans },
  flame: { position: 'absolute', right: 15 },
  steps: { flexDirection: 'row', gap: 6, marginTop: 11 },
  stepsLine: { position: 'absolute', height: 2, left: '12%', right: '12%', top: 22, backgroundColor: '#E3D7CA' },
  step: { flex: 1, height: 73, borderRadius: 17, backgroundColor: 'rgba(255,250,242,0.94)', borderWidth: 1, borderColor: d.line, alignItems: 'center', justifyContent: 'center', gap: 6 },
  stepBadge: { width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: d.ivory },
  stepNum: { fontSize: 9, fontFamily: df.sansHeavy, color: d.muted },
  stepLabel: { fontSize: 8, fontFamily: df.sansHeavy, color: d.muted },
  shortcut: { minHeight: 62, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: d.paper, borderWidth: 1, borderColor: d.line },
  shortcutIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  shortcutDot: { position: 'absolute', width: 11, height: 11, borderRadius: 6, right: -2, top: -2, backgroundColor: '#FFF2E7', borderWidth: 2, borderColor: d.paper },
  shortcutTitle: { fontFamily: df.display, fontSize: 13, color: d.ink },
  shortcutSub: { fontSize: 9, color: d.muted, marginTop: 2, fontFamily: df.sans },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quick: { width: '48.4%', flexGrow: 1, flexBasis: '45%', minHeight: 154, padding: 15, borderRadius: 20 },
  quickIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 12, marginBottom: 'auto' },
  quickSmall: { fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.65, fontFamily: df.sansBold, marginTop: 30 },
  quickTitle: { marginTop: 4, fontFamily: df.displayBold, fontSize: 16 },
  quickSub: { fontSize: 10, opacity: 0.65, marginTop: 3, fontFamily: df.sans },
  still: { minHeight: 170, flexDirection: 'row', backgroundColor: d.paper, borderWidth: 1, borderColor: d.line, borderRadius: 22, overflow: 'hidden' },
  stillArt: { width: '42%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stillRing1: { position: 'absolute', width: 74, height: 74, borderRadius: 37, borderWidth: 1, borderColor: 'rgba(255,107,26,0.23)' },
  stillRing2: { position: 'absolute', width: 114, height: 114, borderRadius: 57, backgroundColor: 'rgba(255,255,255,0.2)' },
  stillRing3: { position: 'absolute', width: 154, height: 154, borderRadius: 77, backgroundColor: 'rgba(255,255,255,0.15)' },
  stillCopy: { flex: 1, paddingVertical: 18, paddingHorizontal: 15 },
  stillKicker: { fontSize: 8, color: d.plum, fontFamily: df.sansHeavy, textTransform: 'uppercase', letterSpacing: 1 },
  stillTitle: { fontFamily: df.displayBold, fontSize: 17, marginVertical: 5, color: d.ink },
  stillSub: { color: d.muted, fontSize: 10, lineHeight: 14.5, fontFamily: df.sans },
  playBtn: { marginTop: 12, alignSelf: 'flex-start', flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: d.ink, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  playText: { color: '#fff', fontSize: 10, fontFamily: df.sansBold },
  community: { height: 205, borderRadius: 24, overflow: 'hidden' },
  communityCopy: { position: 'absolute', left: 18, right: 18, bottom: 16 },
  communityKicker: { fontSize: 8, letterSpacing: 1.3, color: '#F6C8A6', fontFamily: df.sansHeavy },
  communityTitle: { fontFamily: df.display, fontSize: 20, color: '#fff', marginTop: 3, marginBottom: 7 },
  communitySub: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontFamily: df.sans },
  backdrop: { flex: 1, backgroundColor: 'rgba(40,26,17,0.45)' },
  sheet: { backgroundColor: d.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 34 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: d.line, marginBottom: 16 },
  sheetTitle: { fontFamily: df.displayBold, fontSize: 22, color: d.ink, marginTop: 8 },
  sheetBody: { fontFamily: df.sans, fontSize: 13, lineHeight: 20, color: d.muted, marginTop: 8 },
  input: { minHeight: 96, marginTop: 14, padding: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.ivory, borderRadius: 14, fontSize: 14, fontFamily: df.sans, color: d.ink, textAlignVertical: 'top' },
  primary: { marginTop: 16, minHeight: 56, borderRadius: 18, backgroundColor: d.plum, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontFamily: df.sansBold, fontSize: 15 },
  streakBig: { fontFamily: df.displayBold, fontSize: 48, color: d.ink, marginTop: 6 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginVertical: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: d.ivory },
  statNum: { fontFamily: df.displayBold, fontSize: 20, color: d.ink },
  statLabel: { fontFamily: df.sans, fontSize: 10, color: d.muted },
});
