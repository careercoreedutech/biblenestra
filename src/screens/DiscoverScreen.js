import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Image, TextInput, ImageBackground, Share, Platform } from 'react-native';
import { PressScale, FadeInUp, ScaleIn, Pop, Burst, Pulse, LiveRing, AnimatedNumber, AnimatedBar, AnimatedModal } from '../components/Motion';
import AskBar from '../components/AskBar';
import { Icon } from '../components/Icons';
import Svg, { Path, Circle } from 'react-native-svg';
import { Screen, Section, Row, Pills, Button, Tag, Badge, Notice, Empty, alpha, NightGlow } from '../components/ui';
import { colors, fonts, radius, shadow } from '../theme';
import { useStore } from '../store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNav } from '../navigation';
import { CALENDAR, CHANNELS, COMMUNITY_CATEGORIES, PEOPLE, LIVE, CARE_OPTIONS, CHANNELS_DATA } from '../data/seed';
import { refLabel, BOOKS } from '../data/bible';
import { useToast, haptic } from '../components/Toast';
import { useNarration } from '../audio/Narration';
import { BIBLE_GAMES, GAME_TITLES, GAME_COUNTS, dailyQuestions, practiceSession, scrambleAsChoice, dateKey, resetLabel } from '../data/games';
import { useAds } from '../ads/Ads';
import { AD_RULES } from '../ads/config';
import ProfileButton from '../components/ProfileButton';
import { useSync } from '../api/sync';
import { API_CONFIG } from '../api/config'; // DISCOVER TOOLS (round 3)
import { YouTubeSection } from './WatchScreens'; // DISCOVER TOOLS (round 3)
import { PersonSocial } from './UserProfileScreen'; // SOCIAL (round 3)
import { PinnedBar, useMessageActions } from '../components/chat/MessageKit'; // ROUND 4: message actions
import { dmScope, groupScope, scopeConversationId, isServerId as isChatServerId, mapServerMessage } from '../chat/messages';
import { useApi } from '../api/auth'; // CHAT EXTRAS: photos, voice, Meet calls, coin gifts
import { errorMessage } from '../api/client';
import { pickPhotos, pickAudio } from '../api/media';
import { uploadChatImage, uploadChatAudio, sendChatCoins, MAX_CHAT_AUDIO } from '../api/chatMedia';
import { AttachTray, AudioBubble, ChatImage, CoinGiftSheet, GiftCard, ImageViewer, MeetJoin, MeetPrompt, RecorderBar, useVoiceRecorder } from '../chat/ChatExtras';
import { useThreadLoader } from '../chat/useThread';
import { ChatThread } from '../components/chat/ChatThread'; // CHAT GAPS: community #channels use the same virtualised thread as Chats
import { Composer } from '../components/chat/Composer'; // CHAT GAPS: …and the same composer (text only here: no attachments / voice)
import { OpportunitiesEntryCard } from './OpportunitiesScreen'; // OPPORTUNITIES

// ---------- Discover Hub (Sanctuary Paper) ----------
const WISH_CATEGORIES = ['Healing', 'Guidance', 'Family', 'Financial Miracle', 'Salvation', 'Revival'];

export default function DiscoverScreen() {
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const { state, dispatch } = useStore();
  const featuredJobs = (state.jobs || []).slice(0, 3);
  const wishes = state.wishes || [];
  const joinedChannels = state.joinedChannels || [];
  // Prayer Wall card on Discover: open requests, newest first as stored
  const activePrayers = (state.prayers || []).filter((p) => p.status !== 'answered' && p.status !== 'archived');
  const prayingCount = activePrayers.reduce((n, p) => n + (p.praying || 0), 0);
  const liveCount = (LIVE || []).filter((l) => l.status === 'live').length;

  // Interactive Games State — a fresh, date-seeded set every day (see data/games.js)
  const ads = useAds();
  const [showGameModal, setShowGameModal] = useState(false);
  const [activeGameType, setActiveGameType] = useState('trivia'); // 'trivia' | 'who' | 'scramble' | 'chronology'
  const [gameDate, setGameDate] = useState(null); // YYYY-MM-DD the current round belongs to
  const [gameQuestions, setGameQuestions] = useState([]);
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [gameScore, setGameScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [coinsEarned, setCoinsEarned] = useState(0);
  // Ad break between questions: { next, left, playing } — the round's progress stays in the state above.
  const [adBreak, setAdBreak] = useState(null);
  // Endless practice after the daily set ("Keep playing"): no coins, nothing sent to the server.
  const [practice, setPractice] = useState(false);
  const practiceRef = useRef(null); // { type, session }
  const gameStats = state.gameStats || {};
  const gameDaily = state.gameDaily || {};
  const today = dateKey();

  const gameTypeFor = (id) => (BIBLE_GAMES.find((g) => g.id === id) || {}).gameId || 'trivia';

  const buildQuestions = (type) => {
    if (type === 'scramble') return dailyQuestions('scramble').map((v) => scrambleAsChoice(v));
    return dailyQuestions(type);
  };

  // Next practice question (scramble rounds are shown as "pick the right order" here).
  const nextPracticeQ = () => {
    const p = practiceRef.current;
    const q = p && p.session.next();
    if (!q) return null;
    const saved = state.gamePractice || {};
    dispatch({ type: 'set', patch: { gamePractice: { ...saved, [p.type]: { seed: p.session.seed, pos: p.session.position } } } });
    return p.type === 'scramble' ? scrambleAsChoice(q, q.id.length + p.session.position) : q;
  };

  const startPractice = (type) => {
    const saved = (state.gamePractice || {})[type] || {};
    // remember the finished daily round so its result card comes back when practice ends
    const restore = gameOver && type === activeGameType ? { questions: gameQuestions, correct: correctCount, score: gameScore, coins: coinsEarned } : null;
    practiceRef.current = { type, restore, session: practiceSession(type, { seed: saved.seed, start: saved.pos || 0 }) };
    const first = nextPracticeQ();
    if (!first) return;
    setPractice(true);
    setActiveGameType(type);
    setGameDate(dateKey());
    setGameQuestions([first]);
    setActiveQuestionIdx(0);
    setSelectedOption(null);
    setHasAnswered(false);
    setGameScore(0);
    setCorrectCount(0);
    setStreak(0);
    setGameOver(false);
    setCoinsEarned(0);
    setAdBreak(null);
    setShowGameModal(true);
  };

  const endPractice = () => {
    const answered = activeQuestionIdx + (hasAnswered ? 1 : 0);
    setPractice(false);
    setAdBreak(null);
    setGameOver(true);
    // back to the daily result card: practice never changes coins or today's best
    const r = practiceRef.current && practiceRef.current.restore;
    if (r) { setGameQuestions(r.questions); setCorrectCount(r.correct); setGameScore(r.score); setCoinsEarned(r.coins); setActiveQuestionIdx(Math.max(0, r.questions.length - 1)); }
    else setShowGameModal(false);
    toast.show(`Practice · ${correctCount}/${answered} correct · no coins`, { icon: 'star', haptic: 'success' });
  };

  const startGame = (type, { fresh = false } = {}) => {
    // Re-opening a round that is still in progress today resumes it (nothing is lost).
    if (!fresh && type === activeGameType && gameDate === dateKey() && gameQuestions.length && !gameOver) {
      setShowGameModal(true);
      return;
    }
    // Today's set already played: open on its results (Keep playing / Replay) instead of replaying it.
    const done = gameDaily[type];
    if (!fresh && done && done.date === dateKey()) {
      setPractice(false);
      setActiveGameType(type);
      setGameDate(dateKey());
      setGameQuestions(buildQuestions(type));
      setActiveQuestionIdx(0);
      setSelectedOption(null);
      setHasAnswered(false);
      setGameScore(done.score || 0);
      setCorrectCount(done.correct || 0);
      setStreak(0);
      setGameOver(true);
      setCoinsEarned(0);
      setAdBreak(null);
      setShowGameModal(true);
      return;
    }
    setPractice(false);
    setActiveGameType(type);
    setGameDate(dateKey());
    setGameQuestions(buildQuestions(type));
    setActiveQuestionIdx(0);
    setSelectedOption(null);
    setHasAnswered(false);
    setGameScore(0);
    setCorrectCount(0);
    setStreak(0);
    setGameOver(false);
    setCoinsEarned(0);
    setAdBreak(null);
    setShowGameModal(true);
  };

  const handleSelectOption = (idx) => {
    if (hasAnswered) return;
    const currentQ = gameQuestions[activeQuestionIdx];
    setSelectedOption(idx);
    setHasAnswered(true);
    if (idx === currentQ.correctIndex) {
      // Streak multiplier: each consecutive correct answer adds 25 bonus points (max +100).
      setGameScore((s) => s + 100 + Math.min(streak, 4) * 25);
      setCorrectCount((c) => c + 1);
      setStreak((s) => s + 1);
      haptic('success');
    } else {
      setStreak(0);
      haptic('warning');
    }
  };

  const goToQuestion = (i) => {
    setActiveQuestionIdx(i);
    setSelectedOption(null);
    setHasAnswered(false);
  };

  const finishRound = () => {
    const prev = gameDaily[activeGameType];
    const firstToday = !(prev && prev.date === gameDate);
    // Coin prize: 5 coins per correct answer, once per game per day (replays are practice).
    const prize = firstToday ? correctCount * 5 : 0;
    setCoinsEarned(prize);
    setGameOver(true);
    dispatch({ type: 'gameResult', gameId: activeGameType, date: gameDate, correct: correctCount, total: gameQuestions.length, score: gameScore });
    if (firstToday || gameScore > (prev.score || 0)) {
      dispatch({ type: 'set', patch: { gameDaily: { ...gameDaily, [activeGameType]: { date: gameDate, correct: correctCount, total: gameQuestions.length, score: gameScore } } } });
    }
    if (prize > 0) {
      dispatch({ type: 'earnCoins', amount: prize, reason: `${GAME_TITLES[activeGameType] || 'Bible game'} · ${correctCount}/${gameQuestions.length}` });
      toast.show(`+${prize} coins added to your wallet`, { icon: 'coin', haptic: 'success' });
    } else {
      toast.show(`Score saved · ${correctCount}/${gameQuestions.length} correct`, { icon: 'star', haptic: 'success' });
    }
  };

  const handleNextQuestion = () => {
    const next = activeQuestionIdx + 1;
    if (practice && next >= gameQuestions.length) {
      const q = nextPracticeQ();
      if (!q) { endPractice(); return; }
      setGameQuestions((qs) => [...qs, q]);
    } else if (next >= gameQuestions.length) { finishRound(); return; }
    // After every Nth question (4, 8, …) pause for a short, skippable supported-by-ads break.
    // (BibleNestra Plus members play without ad breaks)
    if (!state.premium && next % AD_RULES.gameInterstitialEvery === 0) {
      setAdBreak({ next, left: 3, playing: false });
      return;
    }
    goToQuestion(next);
  };

  const continueAfterAd = (next, watched) => {
    setAdBreak(null);
    goToQuestion(next);
    if (watched) toast.show('Thank you for supporting BibleNestra 🙏', { icon: 'heart', haptic: 'success' });
  };

  const watchAd = async () => {
    if (!adBreak || adBreak.playing) return;
    const next = adBreak.next;
    setAdBreak({ ...adBreak, playing: true });
    // The ad is a full-screen presentation of its own: lower the game sheet first so it can show on
    // top (iOS can't present over an open modal), then bring the sheet back at the next question.
    setShowGameModal(false);
    await new Promise((r) => setTimeout(r, 260));
    let shown = false;
    try { shown = !!(await ads.showInterstitial()).shown; } catch (e) { shown = false; }
    continueAfterAd(next, shown);
    setShowGameModal(true);
  };

  // Ad-break countdown: plays the ad automatically after ~3s while the game sheet is open.
  useEffect(() => {
    if (!adBreak || adBreak.playing || !showGameModal) return undefined;
    if (adBreak.left <= 0) { watchAd(); return undefined; }
    const id = setTimeout(() => setAdBreak((b) => (b && !b.playing ? { ...b, left: b.left - 1 } : b)), 1000);
    return () => clearTimeout(id);
  }, [adBreak, showGameModal]);

  // Make a Wish — persisted through the store (state.wishes)
  const [showWishModal, setShowWishModal] = useState(false);
  const insets = useSafeAreaInsets();
  const [wishText, setWishText] = useState('');
  const [wishCategory, setWishCategory] = useState('Healing');
  const [wishBurst, setWishBurst] = useState(0);

  const handleAddWish = () => {
    const body = wishText.trim();
    if (!body) {
      toast.show('Write your prayer wish first', { tone: 'error' });
      return;
    }
    const title = body.length > 48 ? body.slice(0, 46).trim() + '…' : body;
    dispatch({ type: 'addWish', w: { title, body, category: wishCategory, visibility: 'Public', responses: ['Prayer'], candles: 1, lit: true } });
    setWishText('');
    setWishBurst((n) => n + 1);
    toast.show('Your candle is lit on the altar', { icon: 'flame', haptic: 'success', action: { label: 'View all', onPress: () => { setShowWishModal(false); nav.push('Wishes'); } } });
  };

  const toggleLightCandle = (w) => {
    dispatch({ type: 'lightCandle', id: w.id });
    toast.show(w.lit ? 'Candle put out' : `Candle lit for ${w.author}`, { icon: 'flame', haptic: w.lit ? 'light' : 'success' });
  };

  const toggleAmen = (w) => {
    dispatch({ type: 'amenWish', id: w.id });
    toast.show(w.amened ? 'Amen removed' : `You prayed Amen with ${w.author}`, { icon: 'prayer', haptic: w.amened ? 'light' : 'success' });
  };


  const toggleChannel = (ch) => {
    const on = joinedChannels.includes(ch.id);
    dispatch({ type: 'joinChannel', id: ch.id });
    toast.show(on ? `Left ${ch.name}` : `Joined ${ch.name}`, { icon: on ? 'x' : 'check', haptic: on ? 'light' : 'success' });
  };
  const [channelPreview, setChannelPreview] = useState(null);
  // Keep the last channel rendered while the sheet animates out.
  const lastChannel = useRef(null);
  if (channelPreview) lastChannel.current = channelPreview;
  const shownChannel = channelPreview || lastChannel.current;

  const dateEyebrow = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const currentQ = gameQuestions[activeQuestionIdx];
  const progressPct = gameQuestions.length ? ((activeQuestionIdx + (hasAnswered ? 1 : 0)) / gameQuestions.length) * 100 : 0;

  return (
    <View style={styles.container}>
      {/* Header: eyebrow date, serif title, coin chip, search */}
      <View style={styles.discoverTopBar}>
        <View style={styles.discoverHeaderRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.discoverEyebrow} numberOfLines={1}>{dateEyebrow}</Text>
            <Text style={styles.discoverTitle}>Discover</Text>
          </View>
          <ScaleIn delay={120}>
            <PressScale
              onPress={() => nav.push('Profile', { tab: 'Wallet & Gifts' })}
              accessibilityRole="button"
              accessibilityLabel={`Wallet: ${state.coins ?? 0} coins`}
              scaleTo={0.93}
              style={styles.coinChip}
            >
              <Pop trigger={state.coins} style={styles.coinChipIcon}>
                <Icon name="coin" size={13} color={colors.gold} strokeWidth={2.2} />
              </Pop>
              <AnimatedNumber value={state.coins ?? 0} style={styles.coinChipText} />
              <Text style={styles.coinChipLabel}>coins</Text>
            </PressScale>
          </ScaleIn>
          <ScaleIn delay={180} style={{ marginBottom: 2 }}>
            <ProfileButton size={36} />
          </ScaleIn>
        </View>

        <PressScale onPress={() => nav.push('Search')} scaleTo={0.985} accessibilityRole="button" accessibilityLabel="Search" style={styles.discoverSearchBox}>
          <Icon name="search" size={16} color={colors.muted} />
          <Text style={styles.discoverSearchPlaceholder} numberOfLines={1}>Search 31,102 verses, devotionals, prayers…</Text>
        </PressScale>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 96 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick access to the app's main spaces */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 0 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 6 }}>
          {[
            { label: 'Prayer', icon: 'prayer', tint: colors.rose, bg: colors.cardRose, go: () => nav.push('PrayerWall') },
            { label: 'Chats', icon: 'chat', tint: colors.primary, bg: colors.cardIndigo, go: () => nav.push('ChatList') },
            { label: 'Record', icon: 'mic', tint: colors.terracotta, bg: colors.cardRose, go: () => nav.push('SermonStudio') },
            { label: 'Audio & Books', icon: 'headphones', tint: colors.primary, bg: colors.cardIndigo, go: () => nav.push('MediaLibrary') }, // MEDIA LIBRARY: audio library + Christian books
            { label: 'Contests', icon: 'star', tint: colors.gold, bg: colors.cardGold, go: () => nav.push('Contests') },
            { label: 'Learn', icon: 'book', tint: colors.sage, bg: colors.cardSage, go: () => nav.push('Learn') },
            { label: 'Ask AI', icon: 'sparkles', tint: colors.gold, bg: colors.cardGold, go: () => nav.push('BibleChat') },
            { label: 'Calendar', icon: 'calendar', tint: colors.sky, bg: colors.cardSky, go: () => nav.push('Calendar') },
            { label: 'Reminder', icon: 'bell', tint: colors.amber, bg: colors.cardGold, go: () => nav.push('Reminders') },
            { label: 'Library', icon: 'bookmark', tint: colors.lavender, bg: colors.cardLavender, go: () => nav.push('Library') },
            { label: 'Jobs', icon: 'briefcase', tint: colors.terracotta, bg: colors.cardRose, go: () => nav.push('Jobs') },
            { label: 'Opportunities', icon: 'globe', tint: colors.sky, bg: colors.cardSky, go: () => nav.push('Opportunities') }, // OPPORTUNITIES
            { label: 'Websites', icon: 'link', tint: colors.teal, bg: colors.cardTeal || colors.cardSky, go: () => nav.push('Websites') }, // MEMBER WEBSITES
            { label: 'Care', icon: 'heart', tint: colors.teal, bg: colors.cardSage, go: () => nav.push('Care') },
            { label: 'Fund Me', icon: 'gift', tint: colors.rose, bg: colors.cardRose, go: () => nav.push('FundMe') },
          ].map((q, i) => (
            <FadeInUp key={q.label} index={i} distance={10} stagger={40}>
              <PressScale onPress={q.go} scaleTo={0.93} accessibilityRole="button" accessibilityLabel={q.label} style={[styles.quickItem, q.label.length > 9 && { width: 84 }]}>
                <View style={[styles.quickIcon, { backgroundColor: q.bg }]}>
                  <Icon name={q.icon} size={22} color={q.tint} />
                </View>
                <Text style={styles.quickLabel} numberOfLines={1}>{q.label}</Text>
              </PressScale>
            </FadeInUp>
          ))}
        </ScrollView>

        {/* 2. Prayer Wall, then Fund Me (Make a Wish lives in Churches & Bible Studies) */}
        <FadeInUp index={2}>
        <SectionHead
          eyebrow="Pray together"
          title="Prayer Wall"
          sub={`${activePrayers.length} prayer requests · ${prayingCount.toLocaleString()} praying`}
          action="See all"
          onAction={() => nav.push('PrayerWall')}
        />
        <PressScale onPress={() => nav.push('PrayerWall')} scaleTo={0.98} accessibilityRole="button" accessibilityLabel="Open the Prayer Wall" style={styles.altarHeroCard}>
          <ImageBackground
            source={{ uri: 'https://images.unsplash.com/photo-1533000759938-aa0ba70beceb?auto=format&fit=crop&w=800&q=80' }}
            style={styles.altarHeroBg}
            imageStyle={{ borderRadius: 18 }}
          >
            <View style={styles.altarHeroScrim} />
            <View style={styles.altarHeroContent}>
              <View style={styles.altarHeroTopPill}>
                <Pulse min={0.75} max={1.25} duration={1100}>
                  <View style={styles.pulseDot} />
                </Pulse>
                <Text style={styles.altarHeroPillText}>Prayer Wall</Text>
              </View>

              <View style={styles.altarHeroBottomRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.altarHeroTitle}>Pray for one another</Text>
                  <Text style={styles.altarHeroSub}>Share a request and stand with others in prayer</Text>
                </View>
                <View style={styles.makeWishActionBtn}>
                  <Text style={styles.makeWishActionText}>Prayer Wall</Text>
                  <Icon name="chevron-right" size={13} color={colors.night} strokeWidth={2.4} />
                </View>
              </View>
            </View>
          </ImageBackground>
        </PressScale>

        <PressScale onPress={() => nav.push('FundMe')} scaleTo={0.98} accessibilityRole="button" accessibilityLabel="Open Fund Me" style={styles.altarHeroCard}>
          <ImageBackground
            source={{ uri: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=800&q=80' }}
            style={styles.altarHeroBg}
            imageStyle={{ borderRadius: 18 }}
          >
            <View style={styles.altarHeroScrim} />
            <View style={styles.altarHeroContent}>
              <View style={styles.altarHeroTopPill}>
                <Icon name="gift" size={12} color={colors.goldLight} />
                <Text style={styles.altarHeroPillText}>Fund Me</Text>
              </View>

              <View style={styles.altarHeroBottomRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.altarHeroTitle}>Raise support for what matters</Text>
                  <Text style={styles.altarHeroSub}>Hospital bills, school fees, ministry needs</Text>
                </View>
                <View style={styles.makeWishActionBtn}>
                  <Text style={styles.makeWishActionText}>Fund Me</Text>
                  <Icon name="chevron-right" size={13} color={colors.night} strokeWidth={2.4} />
                </View>
              </View>
            </View>
          </ImageBackground>
        </PressScale>
        </FadeInUp>

        {activePrayers.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.bleed}
            contentContainerStyle={styles.hScroll}
          >
            {activePrayers.slice(0, 8).map((p, i) => (
              <FadeInUp key={p.id} index={3 + i} distance={10} style={styles.wishStreamCard}>
                <PressScale onPress={() => nav.push('PrayerWall')} scaleTo={0.98}>
                  <View style={styles.wishCardHeader}>
                    <Avatar name={p.author} size={30} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.wishCardUser} numberOfLines={1}>{p.mine ? 'You' : p.author}</Text>
                      <Text style={styles.wishCardTime}>{p.created}</Text>
                    </View>
                    <Badge label={p.audience || 'Public'} tint={colors.rose} />
                  </View>
                  <Text style={styles.wishCardBody} numberOfLines={3}>{p.title || p.body}</Text>
                  <Text style={styles.wishCardTime}>{p.praying || 0} praying</Text>
                </PressScale>
              </FadeInUp>
            ))}
          </ScrollView>
        ) : null}

        {/* 3. Contests (Sacred Audio Devotionals moved to the bottom of Today) */}
        <FadeInUp index={4}>
        <SectionHead
          eyebrow="Compete"
          title="Join Contest and Win"
          sub="Timed Bible quizzes · free to enter · prizes for the top places"
          action="See all"
          onAction={() => nav.push('Contests')}
        />
        <PressScale onPress={() => nav.push('Contests')} scaleTo={0.98} accessibilityRole="button" accessibilityLabel="Join a contest" style={styles.altarHeroCard}>
          <ImageBackground
            source={{ uri: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?auto=format&fit=crop&w=800&q=80' }}
            style={styles.altarHeroBg}
            imageStyle={{ borderRadius: 18 }}
          >
            <View style={styles.altarHeroScrim} />
            <View style={styles.altarHeroContent}>
              <View style={styles.altarHeroTopPill}>
                <Icon name="star" size={12} color={colors.goldLight} />
                <Text style={styles.altarHeroPillText}>Contests</Text>
              </View>
              <View style={styles.altarHeroBottomRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.altarHeroTitle}>Test your Bible knowledge</Text>
                  <Text style={styles.altarHeroSub}>Climb the leaderboard and win coins and prizes</Text>
                </View>
                <View style={styles.makeWishActionBtn}>
                  <Text style={styles.makeWishActionText}>Join now</Text>
                  <Icon name="chevron-right" size={13} color={colors.night} strokeWidth={2.4} />
                </View>
              </View>
            </View>
          </ImageBackground>
        </PressScale>
        </FadeInUp>

        {/* 4. Interactive Bible Games & Quizzes */}
        <SectionHead
          eyebrow="Play & learn"
          title="Bible Games & Quizzes"
          sub="New questions every day · streak multipliers & coin prizes"
          action="Play now"
          onAction={() => startGame('trivia')}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hScroll}>
          {BIBLE_GAMES.map((game) => (
            <PressScale
              key={game.id}
              scaleTo={0.97}
              style={styles.gameCard}
              onPress={() => startGame(gameTypeFor(game.id))}
              accessibilityLabel={`Play ${game.title}`}
            >
              <Image source={{ uri: game.thumbnail }} style={styles.gameCardImg} />
              <View style={styles.gameBadgeBox}>
                <Text style={styles.gameBadgeText}>{game.badge}</Text>
              </View>
              <View style={styles.gameCardContent}>
                <Text style={styles.gameCardTitle} numberOfLines={1}>{game.title}</Text>
                <Text style={styles.gameCardSub} numberOfLines={2}>
                  {gameDaily[game.gameId] && gameDaily[game.gameId].date === today
                    ? `Today ${gameDaily[game.gameId].correct}/${gameDaily[game.gameId].total} · best ${((gameStats[game.gameId] || {}).best || 0).toLocaleString()} pts`
                    : game.subtitle}
                </Text>
                <View style={styles.gameCardMeta}>
                  <View style={styles.inlineMeta}>
                    <Icon name="users" size={12} color={colors.faint} />
                    <Text style={styles.gameCardPlayers}>{game.players}</Text>
                  </View>
                  <View style={styles.gameCardBtn}>
                    <Text style={styles.gameCardBtnText}>Play</Text>
                    <Icon name="arrow-right" size={11} color="#FFFFFF" strokeWidth={2.6} />
                  </View>
                </View>
              </View>
            </PressScale>
          ))}
          {/* the fifth Learn game: memory-verse practice opens Learn → Memorize */}
          <PressScale scaleTo={0.97} style={styles.gameCard} onPress={() => nav.push('Learn', { tab: 'Memorize' })} accessibilityLabel="Play Memory-verse practice">
            <Image source={{ uri: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?auto=format&fit=crop&w=600&q=80' }} style={styles.gameCardImg} />
            <View style={styles.gameBadgeBox}>
              <Text style={styles.gameBadgeText}>Memorize</Text>
            </View>
            <View style={styles.gameCardContent}>
              <Text style={styles.gameCardTitle} numberOfLines={1}>Memory-verse practice</Text>
              <Text style={styles.gameCardSub} numberOfLines={2}>Hide God's Word in your heart · hints, first letters & typing</Text>
              <View style={styles.gameCardMeta}>
                <View style={styles.inlineMeta}>
                  <Icon name="book" size={12} color={colors.faint} />
                  <Text style={styles.gameCardPlayers}>Your deck</Text>
                </View>
                <View style={styles.gameCardBtn}>
                  <Text style={styles.gameCardBtnText}>Play</Text>
                  <Icon name="arrow-right" size={11} color="#FFFFFF" strokeWidth={2.6} />
                </View>
              </View>
            </View>
          </PressScale>
        </ScrollView>

        {/* 5. Kingdom Calling & Christian Careers */}
        <SectionHead
          eyebrow="Kingdom calling"
          title="Christian Careers"
          sub="Churches, ministries & faith-tech startups hiring"
          action="Marketplace"
          onAction={() => nav.push('Jobs')}
        />

        <PressScale onPress={() => nav.push('Jobs')} scaleTo={0.98} accessibilityRole="button" style={styles.jobsHeroTeaser}>
          <ImageBackground
            source={{ uri: 'https://images.unsplash.com/photo-1519791883288-dc8bd696e667?auto=format&fit=crop&w=800&q=80' }}
            style={styles.jobsHeroBg}
            imageStyle={{ borderRadius: 18 }}
          >
            <View style={styles.jobsHeroScrim} />
            <View style={styles.jobsHeroContent}>
              <Text style={styles.jobsHeroEyebrow}>✦  Kingdom opportunity</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobsHeroTitle}>Step into your divine calling</Text>
                  <Text style={styles.jobsHeroSub}>Connect with ministries, worship positions & tech opportunities</Text>
                </View>
                <View style={styles.jobsHeroArrow}>
                  <Icon name="arrow-right" size={16} color={colors.night} strokeWidth={2.4} />
                </View>
              </View>
            </View>
          </ImageBackground>
        </PressScale>

        <View style={[styles.groupCard, { marginTop: 12 }]}>
          {featuredJobs.map((j, i) => (
            <Pressable
              key={j.id}
              style={({ pressed }) => [styles.jobRow, i > 0 && styles.groupDivider, pressed && styles.pressedFill]}
              onPress={() => nav.push('Jobs', { id: j.id })}
              accessibilityLabel={`View ${j.title}`}
            >
              <View style={[styles.iconTile, { backgroundColor: j.kind === 'job' ? colors.primarySoft : colors.cardSage }]}>
                <Icon name="briefcase" size={17} color={j.kind === 'job' ? colors.primary : colors.sage} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.jobItemTitle} numberOfLines={1}>{j.title}</Text>
                <Text style={styles.jobItemMeta} numberOfLines={1}>
                  <Text style={[styles.jobKindText, { color: j.kind === 'job' ? colors.primary : colors.sage }]}>{j.kind.toUpperCase()}</Text>
                  {'  ·  '}{j.client?.name || j.postedBy || 'Church Ministry'} · {j.budget}
                </Text>
              </View>
              {(state.proposals || []).some((pp) => pp.jobId === j.id) ? (
                <View style={[styles.applySmallBtn, { backgroundColor: colors.cardSage }]}>
                  <Text style={[styles.applySmallBtnText, { color: colors.sage }]}>Applied</Text>
                </View>
              ) : (
                <View style={styles.applySmallBtn}>
                  <Text style={styles.applySmallBtnText}>View</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* 5b. Opportunities worldwide (external listings) */}
        <OpportunitiesEntryCard onPress={() => nav.push('Opportunities')} style={{ marginTop: 12 }} />

        {/* 6. Churches & Bible Studies */}
        <SectionHead eyebrow="Fellowship" title="Churches & Bible Studies" />
        <View style={styles.photoGrid}>
          {[
            { key: 'communities', title: 'Communities', sub: 'Churches & study circles', badge: `${(state.communities || []).filter((c) => c.joined === true).length} joined`, tint: colors.primary, img: 'https://images.unsplash.com/photo-1519491050282-cf00c82424b4?auto=format&fit=crop&w=600&q=80', onPress: () => nav.push('Communities') },
            { key: 'wish', title: 'Make a Wish', sub: 'Light candle · Faith desires', badge: 'Prayer wish', tint: colors.gold, img: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=600&q=80', onPress: () => setShowWishModal(true) },
            { key: 'people', title: 'Find Believers', sub: 'Christian networking', badge: 'Verified', tint: colors.lavender, img: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=600&q=80', onPress: () => nav.push('People') },
            { key: 'live', title: 'Live Fellowship', sub: `${liveCount} active fellowship${liveCount === 1 ? '' : 's'}`, badge: 'Live now', tint: colors.rose, live: true, img: 'https://images.unsplash.com/photo-1544531586-fde5298cdd40?auto=format&fit=crop&w=600&q=80', onPress: () => nav.push('Live') },
          ].map((c) => (
            <PressScale key={c.key} scaleTo={0.96} accessibilityRole="button" style={styles.photoCard} onPress={c.onPress}>
              <Image source={{ uri: c.img }} style={styles.photoCardBg} />
              <View style={styles.photoCardScrim} />
              <View style={styles.photoCardContent}>
                <View style={[styles.photoCardBadge, { backgroundColor: alpha(c.tint, 0.92) }]}>
                  {c.live ? <LiveRing color="#FFFFFF" size={6} /> : null}
                  <Text style={styles.photoCardBadgeText}>{c.badge}</Text>
                </View>
                <View>
                  <Text style={styles.photoCardTitle}>{c.title}</Text>
                  <Text style={styles.photoCardSub} numberOfLines={1}>{c.sub}</Text>
                </View>
              </View>
            </PressScale>
          ))}
        </View>

        {/* 7. Interactive Bible Games — quick play list */}
        <SectionHead eyebrow="Quick play" title="Interactive Bible Games" />
        <View style={styles.groupCard}>
          {BIBLE_GAMES.map((game, i) => (
            <Pressable
              key={game.id}
              style={({ pressed }) => [styles.quickGameRow, i > 0 && styles.groupDivider, pressed && styles.pressedFill]}
              onPress={() => startGame(gameTypeFor(game.id))}
            >
              <Image source={{ uri: game.thumbnail }} style={styles.quickGameThumb} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.quickGameBadge} numberOfLines={1}>{game.badge}</Text>
                <Text style={styles.quickGameTitle} numberOfLines={1}>{game.title}</Text>
                <Text style={styles.quickGameMeta} numberOfLines={1}>
                  {gameDaily[game.gameId] && gameDaily[game.gameId].date === today ? `Played today · ${gameDaily[game.gameId].correct}/${gameDaily[game.gameId].total}` : `New set today · resets in ${resetLabel()}`}
                </Text>
              </View>
              <View style={styles.quickGamePlay}>
                <Icon name="play" size={15} color={colors.primary} />
              </View>
            </Pressable>
          ))}
        </View>

        {/* 8. Channels & Broadcasts — online: curated YouTube channels (Watch); local: the demo channels */}
        {API_CONFIG.online ? <YouTubeSection /> : (<>
        <SectionHead eyebrow="Tune in" title="Channels & Broadcasts" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hScroll}>
          {(state.channels || CHANNELS_DATA).map((ch) => {
            const joined = joinedChannels.includes(ch.id);
            return (
              <View key={ch.id} style={styles.channelCard}>
                <Pressable onPress={() => setChannelPreview(ch)} accessibilityLabel={`Preview ${ch.name}`} style={({ pressed }) => [styles.channelPreview, pressed && { opacity: 0.9 }]}>
                  <View style={styles.channelIconRing}>
                    <Icon name="play" size={20} color={colors.goldLight} />
                  </View>
                  <View style={styles.channelFollowersBadge}>
                    <Text style={styles.channelFollowersText}>{ch.followers} followers</Text>
                  </View>
                </Pressable>
                <View style={{ padding: 14 }}>
                  <Text style={styles.channelName} numberOfLines={1}>{ch.name}</Text>
                  <Text style={styles.channelVideoTitle} numberOfLines={1}>{ch.videoTitle || ch.recentVideo?.title || ch.tagline}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <Button small kind="ghost" label="Watch" onPress={() => setChannelPreview(ch)} style={{ flex: 1 }} />
                    <Pop trigger={joined} amount={1.08} style={{ flex: 1 }}>
                      <Button
                        small
                        kind={joined ? 'ghost' : 'primary'}
                        label={joined ? 'Joined' : 'Join'}
                        icon={joined ? <Icon name="check" size={12} color={colors.primary} strokeWidth={2.6} /> : null}
                        onPress={() => toggleChannel(ch)}
                      />
                    </Pop>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
        </>)}

        <View style={styles.createCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.createEyebrow}>Share with the body</Text>
            <Text style={styles.createTitle}>Start something new</Text>
          </View>
        </View>
        <Button
          label="Create Post, Group or Stream"
          icon={<Glyph name="plus" size={15} color="#FFFFFF" />}
          onPress={() => nav.push('Create')}
          style={{ marginTop: 10 }}
        />
      </ScrollView>

      {/* Interactive Bible Game Modal (20+ Questions with 4 Choices) */}
      <AnimatedModal visible={showGameModal} onRequestClose={() => setShowGameModal(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowGameModal(false)} accessibilityLabel="Dismiss" />
          <View style={styles.gameSheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetTopBar}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sheetEyebrow} numberOfLines={1}>
                  {adBreak ? 'Short break' : gameOver ? (GAME_TITLES[activeGameType] || 'Bible game') : practice ? `Practice · no coins · ${currentQ?.categoryLabel || 'Bible trivia'}` : (currentQ?.categoryLabel || 'Bible trivia')}
                </Text>
                <Text style={styles.sheetTitle}>
                  {gameOver ? 'Your results' : practice ? (adBreak ? `${correctCount}/${adBreak.next} correct` : `Question ${activeQuestionIdx + 1} · ${correctCount}/${activeQuestionIdx + (hasAnswered ? 1 : 0)} correct`) : adBreak ? `${adBreak.next} of ${gameQuestions.length} done` : `Question ${activeQuestionIdx + 1} of ${gameQuestions.length}`}
                </Text>
              </View>
              <View style={styles.gameScoreBadges}>
                <Pop trigger={gameScore} amount={1.12} style={styles.scorePill}>
                  <Icon name="star" size={11} color={colors.gold} />
                  <AnimatedNumber value={gameScore} style={styles.scorePillText} format={(n) => `${Math.round(n)} pts`} />
                </Pop>
                {streak > 1 ? (
                  <ScaleIn>
                    <Pop trigger={streak} amount={1.15} style={[styles.scorePill, styles.scorePillStreak]}>
                      <Text style={[styles.scorePillText, { color: colors.goldMuted }]}>{streak}x streak</Text>
                    </Pop>
                  </ScaleIn>
                ) : null}
                <CloseButton onPress={() => setShowGameModal(false)} />
              </View>
            </View>
            <AnimatedBar progress={gameOver ? 1 : practice && practiceRef.current ? (practiceRef.current.session.position % practiceRef.current.session.size) / practiceRef.current.session.size : progressPct / 100} delay={60} style={styles.progressTrack} fillStyle={styles.progressFill} />
            <View style={styles.dailyLine}>
              <Icon name="calendar" size={12} color={colors.faint} />
              <Text style={styles.dailyLineText} numberOfLines={1}>{practice ? `Practice mode · ${GAME_COUNTS[activeGameType] ? GAME_COUNTS[activeGameType].toLocaleString() : 'all'} in the bank, no repeats` : `New questions every day · resets in ${resetLabel()}`}</Text>
              {gameDaily[activeGameType] && gameDaily[activeGameType].date === today ? (
                <Text style={styles.dailyLineScore}>Today {gameDaily[activeGameType].correct}/{gameDaily[activeGameType].total}</Text>
              ) : null}
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
              {adBreak && !gameOver ? (
                <ScaleIn key={`ad-${adBreak.next}`} from={0.92} style={styles.adCard}>
                  <NightGlow />
                  <View style={styles.adCardIcon}>
                    <Pulse min={0.92} max={1.08} active={!adBreak.playing}>
                      <Icon name="heart" size={26} color={colors.night} />
                    </Pulse>
                  </View>
                  <Text style={styles.adCardEyebrow}>Supported by ads</Text>
                  <Text style={styles.adCardTitle}>Watch this ad to support this great platform 🙏</Text>
                  <Text style={styles.adCardSub}>
                    {practice ? `Practice continues — ${adBreak.next} answered, ${correctCount} correct. Question ${adBreak.next + 1} is up next.` : `Your progress is saved — ${adBreak.next} of ${gameQuestions.length} answered, ${correctCount} correct. Question ${adBreak.next + 1} is up next.`}
                  </Text>
                  <Button
                    label={adBreak.playing ? 'Playing ad…' : `Watch ad${adBreak.left > 0 ? ` · ${adBreak.left}s` : ''}`}
                    icon={<Icon name="play" size={14} color="#FFFFFF" />}
                    onPress={watchAd}
                    disabled={adBreak.playing}
                    style={{ alignSelf: 'stretch', marginTop: 18 }}
                  />
                  <Pressable
                    onPress={() => continueAfterAd(adBreak.next, false)}
                    disabled={adBreak.playing}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Skip ad"
                    style={({ pressed }) => [styles.adSkip, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.adSkipText}>Skip</Text>
                  </Pressable>
                </ScaleIn>
              ) : !gameOver ? (
                <View key={`${activeGameType}-${activeQuestionIdx}`}>
                  <FadeInUp distance={12} duration={340} style={styles.gameQuestionBox}>
                    <Text style={styles.gameQuestionEyebrow}>✦  Question</Text>
                    <Text style={styles.gameQuestionText}>{currentQ?.question}</Text>
                  </FadeInUp>

                  <View style={{ gap: 10, marginTop: 14 }}>
                    {currentQ?.options.map((opt, oIdx) => {
                      const isCorrect = oIdx === currentQ.correctIndex;
                      const isChosen = selectedOption === oIdx;

                      let optBg = colors.surface;
                      let optBorder = colors.border;
                      let optTextColor = colors.fg;
                      let letterBg = colors.raised;
                      let letterColor = colors.muted;

                      if (hasAnswered) {
                        if (isCorrect) {
                          optBg = colors.cardSage;
                          optBorder = colors.positive;
                          optTextColor = colors.positive;
                          letterBg = colors.positive;
                          letterColor = '#FFFFFF';
                        } else if (isChosen && !isCorrect) {
                          optBg = colors.cardRose;
                          optBorder = colors.negative;
                          optTextColor = colors.negative;
                          letterBg = colors.negative;
                          letterColor = '#FFFFFF';
                        } else {
                          optTextColor = colors.muted;
                        }
                      }

                      const flagged = hasAnswered && (isCorrect || isChosen);
                      return (
                        <FadeInUp key={oIdx} index={oIdx} delay={90} distance={10} duration={320}>
                          <Pop trigger={flagged} amount={isCorrect ? 1.035 : 0.97}>
                            <PressScale
                              onPress={() => handleSelectOption(oIdx)}
                              disabled={hasAnswered}
                              scaleTo={0.975}
                              style={[styles.gameOptionBtn, { backgroundColor: optBg, borderColor: optBorder }]}
                            >
                              <View style={[styles.gameOptionLetter, { backgroundColor: letterBg }]}>
                                <Text style={[styles.gameOptionLetterText, { color: letterColor }]}>
                                  {['A', 'B', 'C', 'D'][oIdx]}
                                </Text>
                              </View>
                              <Text style={[styles.gameOptionText, { color: optTextColor }]} numberOfLines={activeGameType === 'scramble' ? 4 : 3}>
                                {opt}
                              </Text>
                              {hasAnswered && isCorrect ? <ScaleIn from={0.3}><Icon name="check" size={17} color={colors.positive} strokeWidth={2.6} /></ScaleIn> : null}
                              {hasAnswered && isChosen && !isCorrect ? <ScaleIn from={0.3}><Glyph name="close" size={16} color={colors.negative} /></ScaleIn> : null}
                            </PressScale>
                            <Burst trigger={hasAnswered && isChosen && isCorrect} radius={110} count={14} color={colors.gold} />
                          </Pop>
                        </FadeInUp>
                      );
                    })}
                  </View>

                  {hasAnswered ? (
                    <FadeInUp distance={10} duration={340} delay={120} style={styles.gameExplanationBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Icon name="sparkles" size={14} color={colors.gold} />
                        <Text style={styles.gameCitationBadge}>{currentQ?.reference}</Text>
                      </View>
                      <Text style={styles.gameExplanationText}>{currentQ?.explanation}</Text>

                      <Button
                        label={practice || activeQuestionIdx + 1 < gameQuestions.length ? 'Next question' : 'View final score'}
                        icon={practice || activeQuestionIdx + 1 < gameQuestions.length ? null : <Icon name="star" size={14} color={colors.goldLight} />}
                        onPress={handleNextQuestion}
                        style={{ marginTop: 14 }}
                      />
                      {practice ? <Button kind="ghost" label="End practice" onPress={endPractice} style={{ marginTop: 8 }} /> : null}
                    </FadeInUp>
                  ) : null}
                </View>
              ) : (
                <View style={styles.gameOverContainer}>
                  <View style={styles.gameOverMedalWrap}>
                    <ScaleIn from={0.4}>
                      <View style={styles.gameOverMedal}>
                        <Icon name="star" size={34} color={colors.goldLight} strokeWidth={1.8} />
                      </View>
                    </ScaleIn>
                    <MountBurst radius={80} count={14} size={15} color={colors.gold} />
                  </View>
                  <FadeInUp delay={160} distance={10} style={{ alignItems: 'center' }}>
                    <Text style={styles.gameOverTitle}>Challenge Completed!</Text>
                    <CountUp value={gameScore} style={styles.gameOverScoreText} format={(n) => `${Math.round(n)} total points`} />
                  </FadeInUp>
                  <FadeInUp delay={260} distance={10} style={{ alignItems: 'center', alignSelf: 'stretch' }}>
                    <View style={styles.gameOverStats}>
                      <View style={styles.gameOverStat}>
                        <CountUp value={correctCount} style={styles.gameOverStatValue} format={(n) => `${Math.round(n)}/${gameQuestions.length}`} />
                        <Text style={styles.gameOverStatLabel}>Correct</Text>
                      </View>
                      <View style={styles.gameOverStatDivider} />
                      <View style={styles.gameOverStat}>
                        <CountUp value={coinsEarned} style={[styles.gameOverStatValue, { color: colors.gold }]} format={(n) => `+${Math.round(n)}`} />
                        <Text style={styles.gameOverStatLabel}>Coins</Text>
                      </View>
                    </View>
                    <Text style={styles.gameOverSub}>
                      {coinsEarned ? `+${coinsEarned} coins added to your wallet · balance ${state.coins ?? 0}` : gameDaily[activeGameType] && gameDaily[activeGameType].date === today && correctCount ? 'Coins are awarded on your first round each day — replays are practice.' : 'Answer correctly to earn coins next round.'}
                    </Text>
                    <View style={styles.gameOverDaily}>
                      <View style={styles.gameOverDailyCell}>
                        <Text style={styles.gameOverDailyValue}>{gameDaily[activeGameType] && gameDaily[activeGameType].date === today ? `${gameDaily[activeGameType].correct}/${gameDaily[activeGameType].total}` : `${correctCount}/${gameQuestions.length}`}</Text>
                        <Text style={styles.gameOverDailyLabel}>Today's best</Text>
                      </View>
                      <View style={styles.gameOverDailyCell}>
                        <Text style={styles.gameOverDailyValue}>{Math.max(gameScore, (gameStats[activeGameType] || {}).best || 0).toLocaleString()}</Text>
                        <Text style={styles.gameOverDailyLabel}>All-time best pts</Text>
                      </View>
                      <View style={styles.gameOverDailyCell}>
                        <Text style={styles.gameOverDailyValue}>{resetLabel()}</Text>
                        <Text style={styles.gameOverDailyLabel}>New set in</Text>
                      </View>
                    </View>
                  </FadeInUp>
                  <FadeInUp delay={340} distance={10} style={{ marginTop: 24, alignSelf: 'stretch' }}>
                    <Button
                      label="Keep playing"
                      icon={<Icon name="play" size={14} color="#FFFFFF" />}
                      onPress={() => startPractice(activeGameType)}
                      accessibilityLabel="Keep playing in practice mode, no coins"
                    />
                    <Text style={styles.practiceHint}>Endless practice · new questions from all {GAME_COUNTS[activeGameType] ? GAME_COUNTS[activeGameType].toLocaleString() : ''} in the bank · no coins</Text>
                  </FadeInUp>
                  <FadeInUp delay={380} distance={10} style={{ flexDirection: 'row', gap: 10, marginTop: 12, alignSelf: 'stretch' }}>
                    <Button kind="ghost" label="Replay today's set" onPress={() => startGame(activeGameType, { fresh: true })} style={{ flex: 1 }} />
                    <Button kind="ghost" label="Done" onPress={() => setShowGameModal(false)} style={{ flex: 1 }} />
                  </FadeInUp>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </AnimatedModal>

      {/* Channel preview sheet */}
      <AnimatedModal visible={!!channelPreview} onRequestClose={() => setChannelPreview(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setChannelPreview(null)} accessibilityLabel="Dismiss" />
          {shownChannel ? (() => {
            const ch = shownChannel;
            const joined = joinedChannels.includes(ch.id);
            return (
              <View style={styles.channelSheet}>
                <View style={styles.grabber} />
                <View style={styles.sheetTopBar}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.sheetEyebrow} numberOfLines={1}>{ch.category} · {ch.language}</Text>
                    <Text style={styles.sheetTitle} numberOfLines={2}>{ch.name}</Text>
                  </View>
                  <CloseButton onPress={() => setChannelPreview(null)} />
                </View>
                <View style={styles.channelSheetVideo}>
                  <NightGlow />
                  <ScaleIn delay={180} from={0.6} style={{ marginBottom: 36 }}>
                    <Pulse min={0.96} max={1.06} duration={1200}>
                      <View style={[styles.channelSheetPlay, { marginBottom: 0 }]}>
                        <Icon name="video" size={22} color={colors.goldLight} />
                      </View>
                    </Pulse>
                  </ScaleIn>
                  <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
                    <Text style={styles.channelSheetVideoTitle} numberOfLines={2}>{ch.videoTitle}</Text>
                    <Text style={styles.channelSheetVideoMeta}>Latest message · {ch.videoDuration} · {ch.followers} followers</Text>
                  </View>
                </View>
                <Text style={[styles.cardBody, { marginTop: 14 }]}>{ch.tagline}</Text>
                {ch.recentPost ? (
                  <View style={[styles.quoteBlock, { marginTop: 12 }]}>
                    <Text style={styles.pinnedLabel}>✦  Latest post</Text>
                    <Text style={styles.quoteBlockText}>{ch.recentPost}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
                  <Pop trigger={joined} amount={1.06} style={{ flex: 1 }}>
                    <Button
                      label={joined ? 'Joined' : 'Join channel'}
                      kind={joined ? 'ghost' : 'primary'}
                      icon={joined ? <Icon name="check" size={13} color={colors.primary} strokeWidth={2.6} /> : null}
                      onPress={() => toggleChannel(ch)}
                    />
                  </Pop>
                  <Button
                    kind="ghost"
                    label="Live rooms"
                    icon={<Icon name="live" size={13} color={colors.fg} />}
                    onPress={() => { setChannelPreview(null); nav.push('Live'); }}
                    style={{ flex: 1 }}
                  />
                </View>
                <Pressable
                  onPress={() => shareMessage(toast, `${ch.name} — ${ch.tagline} Watch “${ch.videoTitle}” on BibleNestra.`)}
                  style={({ pressed }) => [styles.sheetLinkRow, pressed && { opacity: 0.6 }]}
                >
                  <Icon name="share" size={14} color={colors.primary} />
                  <Text style={styles.sheetLinkText}>Share this channel</Text>
                </Pressable>
              </View>
            );
          })() : null}
        </View>
      </AnimatedModal>

      {/* Make a Wish & Light a Prayer Candle Modal */}
      {/* full screen: the wish list and composer need the whole height */}
      <AnimatedModal visible={showWishModal} onRequestClose={() => setShowWishModal(false)} full>
        <View style={{ flex: 1 }}>
          <View style={[styles.wishSheet, styles.wishFull, { paddingTop: insets.top + 12, paddingBottom: insets.bottom }]}>
            <View style={styles.sheetTopBar}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sheetEyebrow}>Prayer altar</Text>
                <Text style={styles.sheetTitle}>Make a Wish & Light a Candle</Text>
              </View>
              <CloseButton onPress={() => setShowWishModal(false)} />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.wishHeroCard}>
                <Image
                  source={{ uri: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=600&q=80' }}
                  style={styles.wishHeroImg}
                />
                <View style={styles.wishHeroOverlay} />
                <View style={styles.wishHeroContent}>
                  <Text style={styles.wishHeroEyebrow}>✦  Matthew 7:7</Text>
                  <Text style={styles.wishHeroTitle}>“Ask, and it shall be given you…”</Text>
                  <Text style={styles.wishHeroSub}>Submit your heartfelt prayer desires before God and invite fellow believers to light a candle of intercession with you.</Text>
                </View>
              </View>

              <Text style={styles.inputLabel}>Category</Text>
              <Pills
                small
                items={WISH_CATEGORIES}
                value={wishCategory}
                onChange={setWishCategory}
              />

              <Text style={styles.inputLabel}>Your prayer wish / desire</Text>
              <TextInput
                placeholder="Pour out what you are believing God for..."
                placeholderTextColor={colors.faint}
                value={wishText}
                onChangeText={setWishText}
                multiline
                style={styles.wishInput}
              />

              <View style={{ marginTop: 14 }}>
                <Button
                  label="Light Candle & Send Wish to Altar"
                  icon={<Icon name="sparkles" size={14} color={colors.goldLight} />}
                  onPress={handleAddWish}
                />
                <Burst trigger={wishBurst} radius={90} count={14} size={14} color={colors.gold} />
              </View>

              <View style={{ marginTop: 28 }}>
                <Text style={styles.sheetEyebrow}>On the altar</Text>
                <Text style={styles.wishesSectionTitle}>Believers' prayer candles</Text>
                {wishes.map((w, i) => (
                  <FadeInUp key={w.id} index={i} delay={180} distance={10} style={styles.wishItemCard}>
                    <View style={styles.wishItemHead}>
                      <Avatar name={w.author} size={32} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.wishItemUser} numberOfLines={1}>{w.mine ? `${w.author} (you)` : w.author}</Text>
                        <Text style={styles.wishItemTime}>{w.category} · {w.time}</Text>
                      </View>
                    </View>
                    <Text style={styles.wishItemText}>{w.body || w.title}</Text>
                    <View style={styles.wishItemActions}>
                      <CandleButton w={w} verbose onPress={() => toggleLightCandle(w)} />
                      <AmenButton w={w} onPress={() => toggleAmen(w)} />
                    </View>
                  </FadeInUp>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </AnimatedModal>
    </View>
  );
}

// ---------- Motion helpers ----------
// Sparkle burst that fires once, shortly after it mounts (results screens, success states).
function MountBurst(props) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setT(1), 200);
    return () => clearTimeout(id);
  }, []);
  return <Burst trigger={t} {...props} />;
}

// Number that counts up from 0 on mount (and tweens on later changes).
function CountUp({ value = 0, delay = 220, ...rest }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value]);
  return <AnimatedNumber value={v} {...rest} />;
}

// Candle toggle: springs on press, flame pops, count tweens, sparkles when lit.
function CandleButton({ w, onPress, verbose, offColor = colors.faint }) {
  const [burst, setBurst] = useState(0);
  const press = () => {
    if (!w.lit) setBurst((n) => n + 1);
    onPress();
  };
  return (
    <View>
      <PressScale
        onPress={press}
        scaleTo={0.92}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={w.lit ? `Put out candle for ${w.author}` : `Light candle for ${w.author}`}
        style={[styles.amenBtn, w.lit && styles.amenBtnOn]}
      >
        <Pop trigger={w.lit} amount={1.45}>
          <Icon name="flame" size={12} color={w.lit ? colors.goldMuted : offColor} fill={w.lit ? colors.goldLight : 'none'} />
        </Pop>
        <View style={styles.countRow}>
          {verbose ? <Text style={[styles.amenBtnText, w.lit && styles.amenBtnTextOn]}>{w.lit ? 'Candle lit · ' : 'Light candle · '}</Text> : null}
          <AnimatedNumber value={w.candles || 0} duration={450} style={[styles.amenBtnText, w.lit && styles.amenBtnTextOn]} />
        </View>
      </PressScale>
      <Burst trigger={burst} radius={34} count={9} size={10} />
    </View>
  );
}

function AmenButton({ w, onPress, offColor = colors.faint }) {
  const [burst, setBurst] = useState(0);
  const press = () => {
    if (!w.amened) setBurst((n) => n + 1);
    onPress();
  };
  return (
    <View>
      <PressScale
        onPress={press}
        scaleTo={0.92}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={w.amened ? `Remove Amen for ${w.author}` : `Amen for ${w.author}`}
        style={[styles.amenBtn, w.amened && styles.amenBtnOn]}
      >
        <Pop trigger={w.amened} amount={1.4}>
          <Icon name="prayer" size={12} color={w.amened ? colors.goldMuted : offColor} />
        </Pop>
        <View style={styles.countRow}>
          <Text style={[styles.amenBtnText, w.amened && styles.amenBtnTextOn]}>{w.amened ? 'Amen’d · ' : 'Amen · '}</Text>
          <AnimatedNumber value={w.amen || 0} duration={450} style={[styles.amenBtnText, w.amened && styles.amenBtnTextOn]} />
        </View>
      </PressScale>
      <Burst trigger={burst} radius={34} count={9} size={10} />
    </View>
  );
}

// ---------- Local helpers ----------
const AVATAR_TINTS = [colors.primary, colors.sage, colors.rose, colors.lavender, colors.sky, colors.teal, colors.terracotta];

function initials(name = '') {
  return name.split(' ').filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function Avatar({ name = '', size = 40, ring, style }) {
  const tint = AVATAR_TINTS[((name.charCodeAt(0) || 0) + (name.length || 0)) % AVATAR_TINTS.length];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: alpha(tint, 0.13),
          alignItems: 'center',
          justifyContent: 'center',
        },
        ring && { borderWidth: 2, borderColor: colors.goldLight },
        style,
      ]}
    >
      <Text style={{ fontFamily: fonts.serifBold, fontSize: Math.round(size * 0.38), color: tint }}>{initials(name)}</Text>
    </View>
  );
}

function categoryTint(cat) {
  return (
    {
      Healing: colors.sage,
      Guidance: colors.sky,
      Family: colors.rose,
      Revival: colors.lavender,
      Salvation: colors.primary,
      'Financial Miracle': colors.gold,
    }[cat] || colors.gold
  );
}

function Glyph({ name, size = 16, color = colors.fg }) {
  if (name === 'close') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
    );
  }
  if (name === 'plus') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.3} strokeLinecap="round" />
      </Svg>
    );
  }
  if (name === 'info') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={2} />
        <Path d="M12 11v5" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        <Circle cx="12" cy="7.8" r="1.2" fill={color} />
      </Svg>
    );
  }
  if (name === 'more') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="5" cy="12" r="1.8" fill={color} />
        <Circle cx="12" cy="12" r="1.8" fill={color} />
        <Circle cx="19" cy="12" r="1.8" fill={color} />
      </Svg>
    );
  }
  return null;
}

function HeaderIconBtn({ onPress, label, children, active }) {
  return (
    <PressScale
      onPress={onPress}
      hitSlop={10}
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.headerIconBtn, active && styles.headerIconBtnActive]}
    >
      {children}
    </PressScale>
  );
}

function CloseButton({ onPress }) {
  return (
    <PressScale onPress={onPress} hitSlop={12} scaleTo={0.88} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeBtn}>
      <Glyph name="close" size={15} color={colors.fg} />
    </PressScale>
  );
}

function SectionHead({ eyebrow, title, sub, action, onAction, style }) {
  return (
    <View style={[styles.sectionHead, style]}>
      {eyebrow ? <Text style={styles.sectionEyebrow}>{eyebrow}</Text> : null}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle} numberOfLines={2}>{title}</Text>
        {action ? (
          <Pressable onPress={onAction} hitSlop={10} style={({ pressed }) => [styles.sectionActionBtn, pressed && { opacity: 0.6 }]}>
            <Text style={styles.sectionActionText}>{action}</Text>
            <Icon name="chevron-right" size={12} color={colors.primary} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
      {sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}
    </View>
  );
}

function AvatarRow({ name, title, subtitle, right, onPress }) {
  return (
    <PressScale onPress={onPress} disabled={!onPress} scaleTo={0.98} style={styles.avatarRow}>
      <Avatar name={name} size={42} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.avatarRowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.avatarRowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={{ alignItems: 'flex-end' }}>{right}</View> : onPress ? <Icon name="chevron-right" size={14} color={colors.faint} /> : null}
    </PressScale>
  );
}

function PassageChip({ icon, label, onPress, mine, active, pop }) {
  const light = mine || active;
  return (
    <Pop trigger={pop} amount={1.1} style={{ alignSelf: 'flex-start' }}>
      <PressScale onPress={onPress} scaleTo={0.94} accessibilityRole="button" style={[styles.passageChip, mine && styles.passageChipMine, active && !mine && styles.passageChipActive]}>
        <Icon name={icon} size={13} color={light ? colors.goldLight : colors.primary} />
        <Text style={[styles.passageChipText, light && { color: '#FFFFFF' }]} numberOfLines={1}>{label}</Text>
      </PressScale>
    </Pop>
  );
}

// Chat bubble: every bubble fades/slides in once when it mounts — so the thread eases in on open
// and each newly sent message glides up from its own side.
function Bubble({ mine, style, children }) {
  return (
    <FadeInUp distance={mine ? 14 : 10} duration={320} style={[styles.msg, mine && styles.msgMine, style]}>
      {children}
    </FadeInUp>
  );
}

// Keeps a chat ScrollView pinned to the newest message.
function useStickToBottom() {
  const ref = useRef(null);
  const onContentSizeChange = () => ref.current && ref.current.scrollToEnd({ animated: true });
  return { ref, onContentSizeChange };
}

// ---------- Communities ----------
export function CommunitiesScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const list = state.communities.filter((c) => (cat === 'All' || c.category === cat || (cat === 'Regions' && c.region !== 'Global')) && (c.name + c.description + c.region).toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen back title="Explore Communities">
      <View style={styles.searchField}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          placeholder="Church name, city, country, Bible topic, or group"
          placeholderTextColor={colors.faint}
          value={q}
          onChangeText={setQ}
          style={styles.searchFieldInput}
        />
      </View>
      <Pills small items={COMMUNITY_CATEGORIES} value={cat} onChange={setCat} style={{ marginTop: 12, marginBottom: 4 }} />
      {list.map((c, i) => (
        <FadeInUp key={c.id} index={i}>
        <PressScale scaleTo={0.98} style={styles.card} onPress={() => nav.push('Group', { id: c.id })}>
          <View style={styles.cardHeadRow}>
            <View style={[styles.communityTile, { backgroundColor: alpha(AVATAR_TINTS[c.name.length % AVATAR_TINTS.length], 0.12) }]}>
              <Icon name={c.category === 'Churches' ? 'church' : c.category === 'Prayer' ? 'prayer' : c.category === 'Bible books' ? 'book' : 'community'} size={19} color={AVATAR_TINTS[c.name.length % AVATAR_TINTS.length]} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.cardMeta} numberOfLines={1}>{c.region} · {c.language} · {c.members.toLocaleString()} members</Text>
            </View>
            {c.verified ? <Badge label="Verified" tint={colors.gold} /> : null}
          </View>
          <Text style={styles.cardBody}>{c.description}</Text>
          <View style={styles.cardFootRow}>
            <View style={{ flexDirection: 'row', gap: 6, flexShrink: 1 }}>
              <Tag label={c.category} />
              <Tag label={c.privacy} tint={c.privacy === 'Private' ? colors.amber : undefined} />
            </View>
            <Pop trigger={c.joined} amount={1.08}>
              <Button
                small
                kind={c.joined === true ? 'ghost' : 'primary'}
                label={c.joined === true ? 'Joined' : c.joined === 'requested' ? 'Requested' : c.privacy === 'Private' ? 'Request to join' : 'Join'}
                icon={c.joined === true ? <Icon name="check" size={12} color={colors.primary} strokeWidth={2.6} /> : null}
                onPress={() => {
                  dispatch({ type: 'join', id: c.id });
                  if (c.joined === true) toast.show(`You left ${c.name}`, { icon: 'x' });
                  else if (c.joined === 'requested') toast.show('Join request withdrawn', { icon: 'x' });
                  else if (c.privacy === 'Private') toast.show('Request sent to the group admins', { haptic: 'success' });
                  else toast.show(`Joined ${c.name}`, { icon: 'users', haptic: 'success', action: { label: 'Open', onPress: () => nav.push('Group', { id: c.id }) } });
                }}
              />
            </Pop>
          </View>
        </PressScale>
        </FadeInUp>
      ))}
      {!list.length ? <ScaleIn from={0.92}><Empty title="Can't find your church?" body="Search again, add it for verification, invite an administrator, or continue without joining." action="Add church for verification" onAction={() => nav.push('Onboarding', { step: 2 })} /></ScaleIn> : null}
      <View style={{ height: 18 }} />
      <Row
        title="Create a group"
        subtitle="Public, private, invite-only or hidden"
        left={<Glyph name="plus" size={17} color={colors.primary} />}
        onPress={() => nav.push('Create', { kind: 'Group' })}
      />
    </Screen>
  );
}

// ---------- Group (channels + chat) ----------
export function GroupScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const g = (state.communities || []).find((c) => c.id === params.id);
  const [channel, setChannel] = useState('General');
  const [tab, setTab] = useState('Chat');
  const sync = useSync();
  const threadRef = useRef(null); // CHAT GAPS: ChatThread (inverted list) → jump to a message / back to the newest
  const contentRef = useRef(null);
  const latestPray = useRef(null); // chips inside memoised rows always pray with the newest channel state
  const renderContent = useCallback((m) => (contentRef.current ? contentRef.current(m) : null), []);
  // ROUND 4: group channels are server conversations online; message actions work the same as in direct chats
  const gScope = groupScope(g ? g.id : 'none', channel);
  const gConvId = scopeConversationId(state, gScope);
  const { myRole: convRole } = useThreadLoader(gScope, gConvId);
  const isGroupAdmin = !!g && (['owner', 'admin'].includes(g.myRole) || ['owner', 'admin'].includes(convRole));
  const gActions = useMessageActions({
    scope: gScope,
    isGroup: true,
    canPin: !sync.online || isGroupAdmin,
    canModerate: isGroupAdmin,
    onSend: (t, reply) => {
      dispatch({ type: 'groupMessage', gid: g.id, channel, localId: 'm' + Date.now(), m: { text: t, reply } });
      if (threadRef.current) threadRef.current.scrollToBottom();
    },
    scrollToId: (id) => !!threadRef.current && threadRef.current.scrollToMessage(id),
  });
  if (!g) {
    return (
      <Screen back title="Group">
        <Empty title="This group isn't available" body="It may have been removed, made hidden, or the link is out of date." action="Explore communities" onAction={() => nav.replace('Communities')} />
      </Screen>
    );
  }
  const groupMsgs = state.groupMessages[g.id] || {};
  const msgs = groupMsgs[channel] || [];
  const canPost = g.joined === true;
  const muted = (state.mutedGroups || []).includes(g.id);

  const joinOrLeave = () => {
    dispatch({ type: 'join', id: g.id });
    if (g.joined === true) toast.show(`You left ${g.name}`, { icon: 'x' });
    else if (g.joined === 'requested') toast.show('Join request withdrawn', { icon: 'x' });
    else if (g.privacy === 'Private') toast.show('Request sent to the group admins', { icon: 'check', haptic: 'success' });
    else toast.show(`Welcome to ${g.name}`, { icon: 'users', haptic: 'success' });
  };
  const toggleMute = () => {
    const list = state.mutedGroups || [];
    dispatch({ type: 'set', patch: { mutedGroups: muted ? list.filter((x) => x !== g.id) : [...list, g.id] } });
    toast.show(muted ? 'Notifications on for this group' : 'Group muted · no notifications', { icon: muted ? 'bell' : 'volume' });
  };
  const prayAlong = (m) => {
    const next = (groupMsgs[channel] || []).map((x) => (x.id === m.id ? { ...x, praying: (x.praying || 0) + (x.prayedByMe ? -1 : 1), prayedByMe: !x.prayedByMe } : x));
    dispatch({ type: 'set', patch: { groupMessages: { ...state.groupMessages, [g.id]: { ...groupMsgs, [channel]: next } } } });
    toast.show(m.prayedByMe ? 'Removed from your prayers' : `You're praying with ${m.from}`, { icon: 'prayer', haptic: m.prayedByMe ? 'light' : 'success' });
  };
  latestPray.current = prayAlong;
  contentRef.current = (m) => (m.passage || m.prayer || m.event ? (
    <>
      {m.passage ? <PassageChip mine={m.mine} icon="book" label={`${refLabel(m.passage.bookId, m.passage.chapter)} · Open`} onPress={() => nav.push('Bible', m.passage)} /> : null}
      {m.prayer ? <PassageChip mine={m.mine} active={!!m.prayedByMe} pop={!!m.prayedByMe} icon="prayer" label={`${m.prayedByMe ? 'Praying' : 'I\'m praying'} · ${m.praying || 0}`} onPress={() => latestPray.current(m)} /> : null}
      {m.event ? <PassageChip mine={m.mine} icon="calendar" label="RSVP in calendar" onPress={() => nav.push('Calendar')} /> : null}
    </>
  ) : null);
  const composerAction = (a) => {
    if (!canPost) { toast.show('Join this group to share here', { tone: 'error' }); return; }
    if (a === 'Passage') {
      const pos = state.lastPosition || { bookId: 'MAT', chapter: 1 };
      dispatch({ type: 'groupMessage', gid: g.id, channel, localId: 'm' + Date.now(), m: { text: `Let's read ${refLabel(pos.bookId, pos.chapter)} together.`, passage: pos } });
      toast.show(`Shared ${refLabel(pos.bookId, pos.chapter)} in #${channel}`, { icon: 'book' });
    }
    if (a === 'Prayer') nav.push('NewPrayer');
    if (a === 'Event') nav.push('Create', { kind: 'Event' });
  };
  return (
    <Screen back title={g.name} subtitle={`${g.members.toLocaleString()} members · ${g.privacy}${g.verified ? ' · Verified' : ''}`} scroll={false} padded={false}
      right={<HeaderIconBtn label="Group info" active={tab === 'About'} onPress={() => setTab(tab === 'Chat' ? 'About' : 'Chat')}><Glyph name="info" size={17} color={tab === 'About' ? '#FFFFFF' : colors.fg} /></HeaderIconBtn>}>
      {tab === 'About' ? (
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          <FadeInUp style={styles.aboutHero}>
            <ScaleIn delay={120} from={0.7}>
              <Avatar name={g.name} size={56} ring />
            </ScaleIn>
            <Text style={styles.aboutTitle}>{g.name}</Text>
            <Text style={styles.cardMeta}>{g.category} · {g.region} · {g.language}</Text>
            <Text style={[styles.cardBody, { textAlign: 'center' }]}>{g.description}</Text>
          </FadeInUp>
          <FadeInUp index={1}>
          <Section title="Rules">
            <View style={styles.quoteBlock}><Text style={styles.quoteBlockText}>{g.rules}</Text></View>
          </Section>
          </FadeInUp>
          <FadeInUp index={2}>
          <Section title="Members & roles">
            <AvatarRow name="Pastor Tunde" title="Pastor Tunde" subtitle="Owner" />
            <AvatarRow name="Amaka O." title="Amaka O." subtitle="Moderator" />
            <AvatarRow name={state.user.displayName} title={state.user.displayName} subtitle={canPost ? 'Member' : g.joined === 'requested' ? 'Request pending' : 'Not a member'} />
          </Section>
          </FadeInUp>
          <FadeInUp index={3}>
          <Section title="Group study settings">
            <Row title="Translation" right={state.translation} />
            <Row title="Current plan" right="Matthew · weekly" />
            <Row title="Meeting rhythm" right="Thursdays 19:00" />
            <Row title="Live Bible study mode" subtitle="Synchronized passage, teacher controls" left={<Icon name="live" size={18} color={colors.primary} />} onPress={() => nav.push('Live')} />
          </Section>
          </FadeInUp>
          <FadeInUp index={4}>
          <Section title="Safety">
            <Row title={muted ? 'Unmute group' : 'Mute group'} subtitle={muted ? 'You won\'t get notifications' : null} left={<Icon name={muted ? 'bell' : 'volume'} size={17} color={colors.muted} />} onPress={toggleMute} />
            <Row title="Report group" left={<Icon name="shield" size={17} color={colors.muted} />} onPress={() => toast.show('Report sent · moderators will review within 24h', { icon: 'shield' })} />
            {g.joined === true ? (
              <Row title="Leave group" tint={colors.negative} left={<Icon name="x" size={17} color={colors.negative} />} onPress={() => { joinOrLeave(); nav.pop(); }} />
            ) : null}
          </Section>
          </FadeInUp>
          <Button label={canPost ? 'Back to chat' : g.joined === 'requested' ? 'Withdraw request' : g.privacy === 'Private' ? 'Request to join' : 'Join group'} kind={g.joined === 'requested' ? 'ghost' : 'primary'} onPress={() => (canPost ? setTab('Chat') : joinOrLeave())} style={{ marginTop: 22 }} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.channelBar}>
            <Pills small items={CHANNELS} value={channel} onChange={setChannel} style={{ paddingHorizontal: 18, flexGrow: 0 }} />
          </View>
          <PinnedBar pins={gActions.pins} onOpen={(p) => gActions.jumpTo(p.id)} />
          {/* CHAT GAPS: the shared ChatThread (virtualised, day separators, grouped bubbles, swipe to reply, link cards);
              passage / prayer / event chips stay as each bubble's content, so channel semantics are unchanged */}
          <ChatThread
            key={channel}
            ref={threadRef}
            messages={msgs}
            isGroup
            online={sync.online}
            highlight={gActions.highlight}
            header={(
              <View style={{ paddingVertical: 10, gap: 8 }}>
                {!msgs.length ? <ScaleIn key={channel} from={0.92}><Empty title={`No messages in #${channel} yet`} body={canPost ? 'Start the conversation below.' : null} /></ScaleIn> : null}
                {msgs.length && canPost && gActions.tipVisible ? <Text style={styles.chatTip}>Tip: swipe right on a message to reply · press and hold to react, copy, edit, pin or delete.</Text> : null}
              </View>
            )}
            onLongPress={canPost ? gActions.open : undefined}
            onReact={canPost ? gActions.react : undefined}
            onOpenReply={gActions.jumpTo}
            onSwipeReply={canPost ? gActions.reply : undefined}
            renderContent={renderContent}
          />
          <View style={styles.composerWrap}>
            {canPost ? (
              <View style={{ flexDirection: 'row', gap: 6, paddingBottom: 8 }}>
                {['Passage', 'Prayer', 'Event'].map((a) => (
                  <PressScale
                    key={a}
                    onPress={() => composerAction(a)}
                    scaleTo={0.93}
                    accessibilityLabel={a === 'Passage' ? 'Share passage' : a === 'Prayer' ? 'New prayer request' : 'New event'}
                    style={styles.composerChip}
                  >
                    <Icon name={{ Passage: 'book', Prayer: 'prayer', Event: 'calendar' }[a]} size={12} color={colors.muted} />
                    <Text style={styles.composerChipText}>{a}</Text>
                  </PressScale>
                ))}
              </View>
            ) : null}
            {canPost ? gActions.banner : null}
            {canPost ? (
              <Composer placeholder={gActions.editing ? 'Edit your message' : `Message #${channel}`} {...gActions.composer} />
            ) : (
              <View style={{ gap: 10 }}>
                <Notice text={g.joined === 'requested' ? 'Your request is waiting for approval.' : 'Join this group to post.'} />
                <Button label={g.joined === 'requested' ? 'Withdraw request' : g.privacy === 'Private' ? 'Request to join' : 'Join group'} kind={g.joined === 'requested' ? 'ghost' : 'primary'} onPress={joinOrLeave} />
              </View>
            )}
          </View>
          {gActions.sheet}
        </View>
      )}
    </Screen>
  );
}

// ---------- Chat List + Conversation (WhatsApp-Style) ----------
export function ChatListScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState('All');
  const list = state.chats.filter((c) => tab === 'All' || (tab === 'Prayer' && c.type.includes('Prayer')) || (tab === 'Bible study' && c.type === 'Bible study') || (tab === 'Professional' && c.type === 'Professional'));
  return (
    <Screen
      title="Chats"
      subtitle="Direct, ministry & fellowship messaging"
      right={
        <HeaderIconBtn onPress={() => nav.push('People')} label="New chat">
          <Glyph name="plus" size={17} color={colors.fg} />
        </HeaderIconBtn>
      }
    >
      <Pills items={['All', 'Prayer', 'Bible study', 'Professional', 'Groups']} value={tab} onChange={(t) => (t === 'Groups' ? nav.push('Communities') : setTab(t))} />
      <FadeInUp>
        <PressScale onPress={() => nav.push('BibleChat', {})} scaleTo={0.98} accessibilityRole="button" style={styles.exegesisCard}>
          <View style={styles.exegesisIcon}>
            <Pulse min={0.9} max={1.1} duration={1400}>
              <Icon name="sparkles" size={18} color={colors.goldLight} />
            </Pulse>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.exegesisTitle}>Bible Exegesis Chat</Text>
            <Text style={styles.exegesisSub} numberOfLines={2}>AI Scripture companion · separate from member messaging</Text>
          </View>
          <Icon name="chevron-right" size={15} color={colors.nightMuted} />
        </PressScale>
      </FadeInUp>
      {state.requests.length ? (
        <Section title="Message requests">
          {state.requests.map((r, i) => (
            <FadeInUp key={r.id} index={1 + i} style={[styles.card, { marginTop: 0, marginBottom: 10 }]}>
              <View style={styles.cardHeadRow}>
                <Avatar name={r.from} size={36} />
                <Text style={[styles.cardTitle, { flex: 1 }]}>{r.from}</Text>
              </View>
              <Text style={styles.cardBody}>{r.text}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button small label="Accept" onPress={() => { dispatch({ type: 'request', id: r.id, accept: true, from: r.from, text: r.text }); toast.show(`You can now chat with ${r.from}`, { icon: 'chat', haptic: 'success' }); }} />
                <Button small kind="ghost" label="Decline" onPress={() => { dispatch({ type: 'request', id: r.id }); toast.show('Request declined', { icon: 'x' }); }} />
                <Button
                  small
                  kind="ghost"
                  label="Block"
                  onPress={() => {
                    dispatch({ type: 'request', id: r.id });
                    const person = PEOPLE.find((p) => p.name === r.from);
                    if (person) dispatch({ type: 'block', id: person.id });
                    toast.show(`${r.from} is blocked`, { icon: 'shield' });
                  }}
                />
              </View>
            </FadeInUp>
          ))}
        </Section>
      ) : null}
      <Section title="Conversations">
        {list.map((c, i) => (
          <FadeInUp key={c.id} index={2 + i} distance={10}>
            <AvatarRow
              name={c.with}
              title={c.with}
              subtitle={`${c.type} · ${c.last}`}
              right={
                <View style={{ alignItems: 'flex-end', gap: 5 }}>
                  <Text style={[styles.chatTime, c.unread && { color: colors.primary, fontWeight: '600' }]}>{c.time}</Text>
                  {c.unread ? (
                    <ScaleIn delay={300 + i * 55} from={0.4}>
                      <View style={styles.unreadDot}><Text style={styles.unreadDotText}>{c.unread}</Text></View>
                    </ScaleIn>
                  ) : null}
                </View>
              }
              onPress={() => nav.push('Chat', { id: c.id })}
            />
          </FadeInUp>
        ))}
        {!list.length ? <ScaleIn key={tab} from={0.92}><Empty title="No conversations here yet" body="Find believers open to prayer, study or mentoring and say hello." action="Find believers" onAction={() => nav.push('People')} /></ScaleIn> : null}
      </Section>
    </Screen>
  );
}

// CHAT 7.3: the conversation screen moved to ./ChatScreen.js (virtualised thread, ticks, typing, files, search …)
export { ChatScreen } from './ChatScreen';

// ---------- Calendar ----------
const KIND_TINT = { Observance: colors.gold, Season: colors.lavender, 'Church event': colors.primary, Community: colors.sage };

// "Romans 1:17" -> { bookId: 'ROM', chapter: 1, verse: 17 }
function refFromText(text = '') {
  const m = String(text).trim().match(/^(.+?)\s+(\d+)(?::(\d+))?/);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/^psalm$/, 'psalms');
  const book = (BOOKS || []).find((b) => b.name.toLowerCase() === name);
  return book ? { bookId: book.id, chapter: Number(m[2]), verse: m[3] ? Number(m[3]) : undefined } : null;
}

function icsFor(e) {
  const day = e.date.replace(/-/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  let when;
  if (e.time) {
    const [h, mi] = e.time.split(':').map(Number);
    const endH = pad((h + 2) % 24);
    when = `DTSTART:${day}T${pad(h)}${pad(mi)}00\nDTEND:${day}T${endH}${pad(mi)}00`;
  } else {
    const d = new Date(e.date + 'T12:00'); d.setDate(d.getDate() + 1);
    const next = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    when = `DTSTART;VALUE=DATE:${day}\nDTEND;VALUE=DATE:${next}`;
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BibleNestra//EN', 'BEGIN:VEVENT', `UID:${e.id}@biblenestra`, when, `SUMMARY:${e.title}`, e.where ? `LOCATION:${e.where}` : null, e.scripture ? `DESCRIPTION:${e.scripture}` : null, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\n');
}

export function CalendarScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState('All');
  const list = CALENDAR.filter((e) => filter === 'All' || (filter === 'Observances' && (e.kind === 'Observance' || e.kind === 'Season')) || (filter === 'Church' && e.kind === 'Church event') || (filter === 'Community' && e.kind === 'Community') || (filter === 'Mine' && state.rsvps.includes(e.id)));
  const months = {};
  list.forEach((e) => { const m = e.date.slice(0, 7); (months[m] = months[m] || []).push(e); });
  const label = (m) => new Date(m + '-02').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const greeted = (id) => (state.feed || []).some((f) => f.greetingFor === id);

  const rsvp = (e, going) => {
    dispatch({ type: 'rsvp', id: e.id });
    toast.show(going ? `RSVP removed · ${e.title}` : `You're going to ${e.title}`, { icon: going ? 'x' : 'calendar', haptic: going ? 'light' : 'success' });
  };
  const shareGreeting = (e) => {
    if (greeted(e.id)) { nav.push('Feed'); return; }
    dispatch({ type: 'post', post: { kind: 'Celebration', greetingFor: e.id, text: `${e.title} · ${e.scripture}. Blessings from ${state.user.displayName}.`, passage: refFromText(e.scripture) || undefined } });
    toast.show(`${e.title} greeting posted`, { icon: 'sparkles', haptic: 'success', action: { label: 'View', onPress: () => nav.push('Feed') } });
  };
  const addToCalendar = async (e) => {
    const ics = icsFor(e);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      try {
        const blob = new Blob([ics.replace(/\n/g, '\r\n')], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${e.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast.show('Calendar file downloaded · open it to add', { icon: 'calendar' });
      } catch (err) { toast.show('Could not create the calendar file', { tone: 'error' }); }
      return;
    }
    try {
      await Share.share({ title: e.title, message: `${e.title}\n${new Date(e.date + 'T12:00').toDateString()}${e.time ? ' · ' + e.time : ''}${e.where ? '\n' + e.where : ''}` });
    } catch (err) { toast.show('Could not open the share sheet', { tone: 'error' }); }
  };

  return (
    <Screen back title="Calendar" subtitle="Personal · church · community · Christian observances"
      right={<HeaderIconBtn label="New event" onPress={() => nav.push('Create', { kind: 'Event' })}><Glyph name="plus" size={17} color={colors.fg} /></HeaderIconBtn>}>
      <Pills items={['All', 'Mine', 'Church', 'Community', 'Observances']} value={filter} onChange={setFilter} />
      {!Object.keys(months).length ? <ScaleIn key={filter} from={0.92}><Empty title="Nothing here yet" body="RSVP to church or community events and they will appear here." action="Show all events" onAction={() => setFilter('All')} /></ScaleIn> : null}
      {Object.keys(months).sort().map((m) => (
        <Section key={m} title={label(m)}>
          {months[m].map((e, i) => {
            const tint = KIND_TINT[e.kind] || colors.primary;
            const going = state.rsvps.includes(e.id);
            const ref = refFromText(e.scripture);
            const shared = greeted(e.id);
            return (
              <FadeInUp key={e.id} index={i} distance={10} style={styles.event}>
                <View style={[styles.dateBox, { backgroundColor: alpha(tint, 0.1) }]}>
                  <Text style={[styles.dateMon, { color: tint }]}>{new Date(e.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                  <Text style={[styles.dateDay, { color: tint }]}>{e.date.slice(8)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.eventKind, { color: tint }]}>{e.kind}</Text>
                  <Text style={styles.cardTitle}>{e.title}</Text>
                  <Text style={styles.cardMeta}>{[e.time, e.where, e.tradition].filter(Boolean).join(' · ')}</Text>
                  {e.scripture ? (
                    <Pressable onPress={() => (ref ? nav.push('Bible', ref) : nav.push('Search'))} style={styles.eventScripture}>
                      <Text style={styles.eventScriptureText}>✦  {e.scripture}</Text>
                    </Pressable>
                  ) : null}
                  {e.source ? <Text style={styles.eventSource}>Source: {e.source} · Verified</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {e.kind === 'Church event' || e.kind === 'Community' ? (
                      <Pop trigger={going} amount={1.12}>
                        <PressScale onPress={() => rsvp(e, going)} scaleTo={0.92} accessibilityRole="button" style={[styles.eventAction, going && styles.eventActionOn]}>
                          {going ? <ScaleIn from={0.3}><Icon name="check" size={11} color="#FFFFFF" strokeWidth={2.8} /></ScaleIn> : null}
                          <Text style={[styles.eventActionText, going && { color: '#FFFFFF' }]}>{going ? 'Going' : 'RSVP'}</Text>
                        </PressScale>
                      </Pop>
                    ) : (
                      <Pop trigger={shared} amount={1.1}>
                        <PressScale onPress={() => shareGreeting(e)} scaleTo={0.93} accessibilityRole="button" style={[styles.eventAction, shared && styles.eventActionOn]}>
                          {shared ? <ScaleIn from={0.3}><Icon name="check" size={11} color="#FFFFFF" strokeWidth={2.8} /></ScaleIn> : null}
                          <Text style={[styles.eventActionText, shared && { color: '#FFFFFF' }]}>{shared ? 'Greeting shared' : 'Share greeting'}</Text>
                        </PressScale>
                      </Pop>
                    )}
                    <PressScale onPress={() => addToCalendar(e)} scaleTo={0.93} accessibilityRole="button" style={[styles.eventAction, styles.eventActionQuiet]}>
                      <Icon name="calendar" size={11} color={colors.muted} />
                      <Text style={[styles.eventActionText, { color: colors.muted }]}>Add to calendar</Text>
                    </PressScale>
                  </View>
                </View>
              </FadeInUp>
            );
          })}
        </Section>
      ))}
    </Screen>
  );
}

// ---------- People (2-Column Visual Card Directory per PDF Spec) ----------
export function PeopleScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [f, setF] = useState('All');
  const list = PEOPLE.filter((p) => !state.blocked.includes(p.id)).filter((p) => f === 'All' || p.accepts.some((a) => a.toLowerCase().includes(f.toLowerCase())) || (f === 'Available now' && p.availability === 'Available now'));
  const follow = (p, following) => {
    dispatch({ type: 'follow', id: p.id });
    toast.show(following ? `Unfollowed ${p.name}` : `Following ${p.name}`, { icon: following ? 'x' : 'check', haptic: following ? 'light' : 'success' });
  };

  return (
    <Screen back title="Find Believers" subtitle="Christians open to fellowship and collaboration">
      <Pills small items={['All', 'Available now', 'Prayer', 'Bible study', 'Mentoring', 'Professional', 'Care']} value={f} onChange={setF} />

      {!list.length ? <ScaleIn key={f} from={0.92}><Empty title="No one matches this filter" body="Try another filter to see more believers." action="Show everyone" onAction={() => setF('All')} /></ScaleIn> : null}
      <View style={styles.peopleGrid}>
        {list.map((p, i) => {
          const following = state.follows.includes(p.id);
          return (
            <FadeInUp key={p.id} index={i} style={styles.personCell}>
            <PressScale scaleTo={0.97} style={styles.personCard} onPress={() => nav.push('Person', { id: p.id })}>
              <View style={styles.personAvatarWrapper}>
                <Avatar name={p.name} size={58} />
                {p.availability === 'Available now' ? <View style={styles.personOnlineDot} /> : null}
              </View>

              <Text style={styles.personCardName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.personCardHeadline} numberOfLines={2}>{p.headline}</Text>
              <Text style={styles.personCardCountry} numberOfLines={1}>{p.country}</Text>

              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8, minHeight: 22 }}>
                {p.verified.slice(0, 1).map((v) => (
                  <Badge key={v} label={v} tint={colors.primary} />
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, width: '100%' }}>
                <PressScale
                  onPress={() => nav.push('Chat', { to: p.name, kind: p.accepts[0] })}
                  accessibilityLabel={`Chat with ${p.name}`}
                  scaleTo={0.94}
                  style={styles.personChatBtn}
                >
                  <Icon name="chat" size={12} color="#FFFFFF" />
                  <Text style={styles.personChatBtnText}>Chat</Text>
                </PressScale>
                <Pop trigger={following} amount={1.22}>
                  <PressScale
                    onPress={() => follow(p, following)}
                    scaleTo={0.88}
                    style={[styles.personFollowBtn, following && styles.personFollowBtnActive]}
                    accessibilityLabel={following ? `Unfollow ${p.name}` : `Follow ${p.name}`}
                  >
                    {following ? <ScaleIn from={0.3}><Icon name="check" size={14} color={colors.primary} strokeWidth={2.6} /></ScaleIn> : <Glyph name="plus" size={14} color={colors.fg} />}
                  </PressScale>
                </Pop>
              </View>
            </PressScale>
            </FadeInUp>
          );
        })}
      </View>
      <View style={{ height: 16 }} />
      <Notice text="Profile badges indicate verified membership or ministry identity. They do not replace local pastoral authority." />
    </Screen>
  );
}

export function PersonScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const p = PEOPLE.find((x) => x.id === params.id);
  if (!p) return <Screen back title="Profile"><Empty title="User not found" body="This profile may be private or no longer available." action="Find believers" onAction={() => nav.replace('People')} /></Screen>;
  const following = state.follows.includes(p.id);
  const blocked = state.blocked.includes(p.id);
  const existing = state.chats.find((c) => c.with === p.name);
  return (
    <Screen back title={p.name} subtitle={p.headline}>
      <FadeInUp style={styles.profileCard}>
        <ScaleIn delay={100} from={0.7} style={styles.personAvatarWrapper}>
          <Avatar name={p.name} size={84} ring />
          {p.availability === 'Available now' ? <View style={[styles.personOnlineDot, { width: 16, height: 16, borderRadius: 8, bottom: 3, right: 3 }]} /> : null}
        </ScaleIn>
        <Text style={styles.profileName}>{p.name}</Text>
        <Text style={styles.profileHeadline}>{p.headline}</Text>
        <Text style={styles.profileMeta}>{p.country} · {p.languages.join(', ')}</Text>
        {p.verified.length ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            {p.verified.map((v) => <Badge key={v} label={v} tint={colors.primary} />)}
          </View>
        ) : null}
        <View style={styles.profileRule} />
        <Text style={styles.profileIntro}>“{p.intro}”</Text>
        {blocked ? (
          <Notice tint={colors.negative} text="You blocked this person. They can't message you or see your activity." />
        ) : confirmBlock ? (
          <FadeInUp distance={8} duration={260} style={styles.confirmBox}>
            <Text style={styles.confirmText}>Block {p.name}? They won't be able to message you, and they'll disappear from your directory.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button small kind="danger" label="Block" onPress={() => { dispatch({ type: 'block', id: p.id }); toast.show(`${p.name} is blocked`, { icon: 'shield' }); nav.pop(); }} style={{ flex: 1 }} />
              <Button small kind="ghost" label="Cancel" onPress={() => setConfirmBlock(false)} style={{ flex: 1 }} />
            </View>
          </FadeInUp>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button small label={existing ? 'Open chat' : 'Send Message'} icon={<Icon name="chat" size={13} color="#FFFFFF" />} disabled={p.availability === 'Not accepting'} onPress={() => (existing ? nav.push('Chat', { id: existing.id }) : nav.push('Chat', { to: p.name, kind: p.accepts[0] }))} />
            <Pop trigger={following} amount={1.1}>
              <Button
                small
                kind="ghost"
                label={following ? 'Following' : 'Follow'}
                icon={following ? <Icon name="check" size={12} color={colors.primary} strokeWidth={2.6} /> : null}
                onPress={() => { dispatch({ type: 'follow', id: p.id }); toast.show(following ? `Unfollowed ${p.name}` : `Following ${p.name}`, { icon: following ? 'x' : 'check', haptic: following ? 'light' : 'success' }); }}
              />
            </Pop>
            <Button small kind="ghost" label="Block" onPress={() => setConfirmBlock(true)} />
          </View>
        )}
      </FadeInUp>
      {!blocked ? <PersonSocial person={p} /> /* SOCIAL (round 3): gift + their posts & videos */ : null}
      <FadeInUp index={1}>
        <Section title="Accepts"><View style={styles.tagWrap}>{p.accepts.map((a) => <Badge key={a} label={a} tint={colors.teal} />)}</View></Section>
      </FadeInUp>
      <FadeInUp index={2}>
        <Section title="Interests"><View style={styles.tagWrap}>{p.interests.map((i) => <Tag key={i} label={i} />)}</View></Section>
      </FadeInUp>
      <FadeInUp index={3}>
      <Section title="Professional Profile">
        <Row title="Church" subtitle={p.church} left={<Icon name="church" size={17} color={colors.primary} />} />
        <Row title="Experience & Ministry" subtitle={(p.skills || []).join(' · ')} left={<Icon name="briefcase" size={17} color={colors.primary} />} />
        <Row title="Availability" subtitle={p.availability} left={<Icon name="clock" size={17} color={colors.gold} />} />
        {p.mutual ? <Row title={`${p.mutual} mutual connection${p.mutual === 1 ? '' : 's'}`} left={<Icon name="users" size={17} color={colors.sage} />} /> : null}
      </Section>
      </FadeInUp>
    </Screen>
  );
}

// ---------- Care Network ----------
import { CareNetworkOptions, useCareSummary } from './CareNetworkScreens'; // CARE NETWORK: Talk to a Priest + Talk to an Apostle
const CARE_ICONS = [
  ['chat', colors.primary], ['prayer', colors.gold], ['sparkles', colors.gold], ['book', colors.primary], ['church', colors.lavender],
  ['shield', colors.teal], ['briefcase', colors.sky], ['heart', colors.rose], ['users', colors.sage],
];
export function CareScreen({ params = {} }) {
  const nav = useNav();
  const { state } = useStore();
  const [choice, setChoice] = useState(params.preselect || null);
  const { data: careSummary } = useCareSummary(); // CARE NETWORK: apostle availability, my priest profile, care inboxes
  const match = {
    'I need someone to talk to': ['p1', 'p5', 'p4'], 'I need prayer': ['p1', 'p6'], 'I need encouragement': ['p5', 'p1'], 'I want to study the Bible with someone': ['p4'],
    'I need pastoral guidance': ['p1'], 'I want a qualified counselor': ['p3'], 'I need a career or ministry mentor': ['p2', 'p5'], 'I want to encourage others': [], 'I want to join a support group': [],
  };
  // Each need also gets a concrete next step inside the app.
  const nextStep = {
    'I need prayer': { label: 'Post a prayer request', icon: 'prayer', go: () => nav.push('NewPrayer') },
    'I need encouragement': { label: 'Visit the prayer wall', icon: 'flame', go: () => nav.push('Wishes') },
    'I want to study the Bible with someone': { label: 'Browse Bible study groups', icon: 'book', go: () => nav.push('Communities') },
    'I want to encourage others': { label: 'Pray for requests on the wall', icon: 'prayer', go: () => nav.push('PrayerWall') },
    'I want to join a support group': { label: 'Find a support community', icon: 'users', go: () => nav.push('Communities') },
    'I need a career or ministry mentor': { label: 'Explore Kingdom careers', icon: 'briefcase', go: () => nav.push('Jobs') },
  };
  const people = choice ? PEOPLE.filter((p) => (match[choice] || []).includes(p.id) && !state.blocked.includes(p.id)) : [];
  const step = choice ? nextStep[choice] : null;
  const kindFor = (c) => (c === 'I need prayer' ? 'Prayer' : c === 'I want to study the Bible with someone' ? 'Bible study' : c.includes('mentor') ? 'Mentoring' : 'Care / support');
  return (
    <Screen back title="Christian Care Network" subtitle="Find Someone Who Understands">
      <FadeInUp style={styles.careHero}>
        <Text style={styles.careEyebrow}>✦  You are not alone</Text>
        <Text style={styles.careTitle}>{choice ? 'People who can walk with you' : 'How can we help today?'}</Text>
        <Text style={styles.careSub}>Sensitive conversations are private by default and never shared or monetized.</Text>
      </FadeInUp>
      {!choice ? <CareNetworkOptions summary={careSummary} /> : null}
      {!choice ? <Text style={[styles.careSub, { marginTop: 18, marginBottom: 2, fontWeight: '700' }]}>Or tell us what you need</Text> : null}
      {!choice ? CARE_OPTIONS.map((o, i) => {
        const [ic, tint] = CARE_ICONS[i % CARE_ICONS.length];
        return (
          <FadeInUp key={o} index={1 + i} distance={10}>
            <Row title={o} left={<Icon name={ic} size={17} color={tint} />} onPress={() => setChoice(o)} />
          </FadeInUp>
        );
      }) : (
        <View key={choice}>
          <FadeInUp distance={8} duration={300}>
          <Row
            title={choice}
            tint={colors.primary}
            left={<Icon name="check" size={16} color={colors.primary} strokeWidth={2.6} />}
            right={<PressScale onPress={() => setChoice(null)} scaleTo={0.92} accessibilityRole="button" style={styles.changeBtn}><Text style={styles.changeBtnText}>Change</Text></PressScale>}
          />
          </FadeInUp>
          {choice === 'I want a qualified counselor' ? <FadeInUp index={1}><Notice text="Only people with a verified professional license appear here. If you are in immediate danger, contact your local emergency services." /></FadeInUp> : null}
          {people.length ? (
            <Section title="Recommended ministers and listeners">
              {people.map((p, i) => (
                <FadeInUp key={p.id} index={1 + i} distance={10}>
                  <AvatarRow
                    name={p.name}
                    title={p.name}
                    subtitle={`${p.headline} · ${p.availability}`}
                    right={
                      <PressScale onPress={() => nav.push('Chat', { to: p.name, kind: kindFor(choice) })} accessibilityLabel={`Message ${p.name}`} hitSlop={6} scaleTo={0.93} style={styles.careMsgBtn}>
                        <Icon name="chat" size={12} color="#FFFFFF" />
                        <Text style={styles.personChatBtnText}>Message</Text>
                      </PressScale>
                    }
                    onPress={() => nav.push('Person', { id: p.id })}
                  />
                </FadeInUp>
              ))}
            </Section>
          ) : !step ? (
            <ScaleIn from={0.92}><Empty title="No matches yet" body="We are growing this part of the network. Try another option or check back soon." action="Choose another option" onAction={() => setChoice(null)} /></ScaleIn>
          ) : null}
          {step ? (
            <FadeInUp index={1 + people.length} distance={10}>
              <Button label={step.label} kind={people.length ? 'ghost' : 'primary'} icon={<Icon name={step.icon} size={14} color={people.length ? colors.fg : '#FFFFFF'} />} onPress={step.go} style={{ marginTop: 20 }} />
            </FadeInUp>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

// ---------- Make a Wish ----------
export function WishesScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const wishes = state.wishes || [];
  const [confirmId, setConfirmId] = useState(null);
  const candle = (w) => { dispatch({ type: 'lightCandle', id: w.id }); toast.show(w.lit ? 'Candle put out' : `Candle lit for ${w.author}`, { icon: 'flame', haptic: w.lit ? 'light' : 'success' }); };
  const amen = (w) => { dispatch({ type: 'amenWish', id: w.id }); toast.show(w.amened ? 'Amen removed' : `You prayed Amen with ${w.author}`, { icon: 'prayer', haptic: w.amened ? 'light' : 'success' }); };
  const remove = (w) => {
    const idx = wishes.findIndex((x) => x.id === w.id);
    dispatch({ type: 'set', patch: { wishes: wishes.filter((x) => x.id !== w.id) } });
    setConfirmId(null);
    toast.show('Wish removed', { icon: 'trash', action: { label: 'Undo', onPress: () => dispatch({ type: 'set', patch: { wishes: [...wishes.slice(0, idx), w, ...wishes.slice(idx)].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i) } }) } });
  };
  const respond = (w, r) => {
    if (r === 'Prayer') { if (!w.amened) amen(w); else toast.show(`You're already praying with ${w.author}`, { icon: 'prayer' }); return; }
    nav.push('Chat', { to: w.author, kind: r === 'Mentoring' ? 'Mentoring' : 'General chat' });
  };
  return (
    <Screen back title="Make a Wish" subtitle="A prayer request, ministry goal, or need"
      right={<HeaderIconBtn label="New wish" onPress={() => nav.push('Create', { kind: 'Wish' })}><Glyph name="plus" size={17} color={colors.fg} /></HeaderIconBtn>}>
      {!wishes.length ? <ScaleIn from={0.92}><Empty title="No wishes yet" body="Share a prayer request, ministry goal or need with your community." action="Make a wish" onAction={() => nav.push('Create', { kind: 'Wish' })} /></ScaleIn> : null}
      {wishes.map((w, i) => (
        <FadeInUp key={w.id} index={i} style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Avatar name={w.author} size={34} />
            <Text style={[styles.cardMeta, { flex: 1, marginTop: 0 }]} numberOfLines={1}>{w.mine ? 'You' : w.author} · {w.visibility} · {w.time}</Text>
            <Badge label={w.category} tint={categoryTint(w.category)} />
          </View>
          <Text style={[styles.cardTitle, { marginTop: 12, fontSize: 17 }]}>{w.title}</Text>
          {w.body && w.body !== w.title ? <Text style={styles.cardBody}>{w.body}</Text> : null}
          <View style={styles.wishItemActions}>
            <CandleButton w={w} verbose onPress={() => candle(w)} />
            <AmenButton w={w} onPress={() => amen(w)} />
          </View>
          {(w.responses || []).filter((r) => r !== 'Prayer').length || w.mine ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {!w.mine ? (w.responses || []).filter((r) => r !== 'Prayer').map((r) => <Button key={r} small kind="ghost" label={r === 'Volunteer' ? 'Offer to help' : r === 'Mentoring' ? 'Offer mentoring' : r} onPress={() => respond(w, r)} />) : null}
              {w.mine ? (
                confirmId === w.id ? (
                  <FadeInUp distance={6} duration={240} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <Text style={[styles.cardMeta, { marginTop: 0 }]}>Remove this wish?</Text>
                    <Button small kind="danger" label="Remove" onPress={() => remove(w)} />
                    <Button small kind="ghost" label="Keep" onPress={() => setConfirmId(null)} />
                  </FadeInUp>
                ) : (
                  <Button small kind="ghost" label="Remove" icon={<Icon name="trash" size={12} color={colors.fg} />} onPress={() => setConfirmId(w.id)} />
                )
              ) : null}
            </View>
          ) : null}
        </FadeInUp>
      ))}
    </Screen>
  );
}

// ---------- Live ----------
const LIVE_PASSAGE = { l1: { bookId: 'MAT', chapter: 1 }, l2: { bookId: 'PSA', chapter: 121 } };

export function LiveScreen({ params = {} }) {
  const nav = useNav();
  const toast = useToast();
  const nar = useNarration();
  const [joined, setJoined] = useState(params.id || null);
  const [handRaised, setHandRaised] = useState(false);
  const [askMode, setAskMode] = useState(false);
  const [chat, setChat] = useState([]);
  const l = LIVE.find((x) => x.id === joined);
  const join = (x) => {
    setJoined(x.id);
    setHandRaised(false);
    setAskMode(false);
    setChat([]);
    toast.show(x.status === 'live' ? `Joined · ${x.viewers + 1} watching` : `Opened ${x.title}`, { icon: 'live' });
  };
  if (joined && !l) {
    return (
      <Screen back title="Live Fellowship">
        <Empty title="This stream has ended" body="It may have finished or been made private." action="See live rooms" onAction={() => setJoined(null)} />
      </Screen>
    );
  }
  if (l) {
    const passage = LIVE_PASSAGE[l.id] || { bookId: 'MAT', chapter: 1 };
    const send = (t) => {
      if (askMode) {
        setChat((c) => [...c, { id: 'q' + Date.now(), text: t, question: true }]);
        setAskMode(false);
        toast.show('Question sent to the moderators', { icon: 'message', haptic: 'success' });
      } else {
        setChat((c) => [...c, { id: 'c' + Date.now(), text: t }]);
      }
    };
    return (
      <Screen back title={l.title} subtitle={`${l.host} · ${l.status}`} scroll={false} padded={false}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <FadeInUp style={styles.video}>
            <NightGlow />
            <View style={styles.videoTop}>
              <View style={[styles.liveStatusPill, l.status !== 'live' && { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
                {l.status === 'live' ? <LiveRing color="#FFFFFF" size={6} /> : null}
                <Text style={styles.liveStatusText}>{l.status === 'live' ? 'LIVE · ' + (l.viewers + 1) + ' watching' : l.status === 'replay' ? 'Replay' : 'Starts ' + l.when}</Text>
              </View>
              {handRaised ? (
                <ScaleIn from={0.6}>
                  <View style={[styles.liveStatusPill, { backgroundColor: alpha(colors.goldLight, 0.22) }]}>
                    <Text style={styles.liveStatusText}>✋ Hand raised</Text>
                  </View>
                </ScaleIn>
              ) : null}
            </View>
            <ScaleIn delay={160} from={0.6} style={{ alignSelf: 'center' }}>
              <PressScale
                onPress={() => { nar.playChapter(passage.bookId, passage.chapter, { translation: 'KJV' }); toast.show(`Listening along · ${refLabel(passage.bookId, passage.chapter)}`, { icon: 'audio' }); }}
                accessibilityLabel="Listen along"
                scaleTo={0.9}
                style={styles.videoPlay}
              >
                <Icon name="play" size={26} color={colors.goldLight} />
              </PressScale>
            </ScaleIn>
            <View>
              <Text style={styles.videoTitle} numberOfLines={2}>{l.title}</Text>
              <Text style={styles.videoNote}>Tap play to listen along to {refLabel(passage.bookId, passage.chapter)} in audio-only mode</Text>
            </View>
          </FadeInUp>
          <FadeInUp index={1} style={[styles.tagWrap, { marginTop: 14 }]}>
            <Tag label={l.language} /><Tag label={l.audience} />{l.captions ? <Tag label="Captions" /> : null}<Tag label="Moderated" tint={colors.teal} />
          </FadeInUp>
          <FadeInUp index={2}>
          <Section title="Live Bible study">
            <Row title={`Synchronized passage: ${refLabel(passage.bookId, passage.chapter)}`} subtitle="Follow the teacher's highlights" left={<Icon name="book" size={17} color={colors.primary} />} onPress={() => nav.push('Bible', passage)} />
          </Section>
          </FadeInUp>
          <FadeInUp index={3}>
          <Section title="Participate">
            <Row
              title={handRaised ? 'Lower hand' : 'Raise hand'}
              subtitle={handRaised ? 'The host can see you want to speak' : null}
              tint={handRaised ? colors.primary : undefined}
              left={<Icon name={handRaised ? 'check' : 'user'} size={17} color={handRaised ? colors.primary : colors.muted} />}
              onPress={() => { setHandRaised(!handRaised); toast.show(handRaised ? 'Hand lowered' : 'Hand raised · the host will call on you', { icon: 'user', haptic: handRaised ? 'light' : 'success' }); }}
            />
            <Row title="Send a prayer request" left={<Icon name="prayer" size={17} color={colors.gold} />} onPress={() => nav.push('NewPrayer')} />
            <Row
              title={askMode ? 'Type your question below' : 'Ask a moderated question'}
              subtitle={askMode ? 'Tap again to cancel' : null}
              tint={askMode ? colors.primary : undefined}
              left={<Icon name="message" size={17} color={askMode ? colors.primary : colors.muted} />}
              onPress={() => setAskMode(!askMode)}
            />
          </Section>
          </FadeInUp>
          {chat.length ? (
            <Section title="Fellowship chat">
              <View style={{ gap: 8 }}>
                {chat.map((m) => (
                  <Bubble key={m.id} mine>
                    {m.question ? <Text style={[styles.pinnedLabel, { color: colors.goldLight }]}>Question · awaiting moderator</Text> : null}
                    <Text style={[styles.msgText, { color: '#FFFFFF' }]}>{m.text}</Text>
                  </Bubble>
                ))}
              </View>
            </Section>
          ) : null}
        </ScrollView>
        <View style={styles.composerWrap}><AskBar key={askMode ? 'ask' : 'chat'} placeholder={askMode ? 'Ask the host a question…' : 'Say something in live fellowship chat...'} onSend={send} /></View>
      </Screen>
    );
  }
  return (
    <Screen back title="Live Fellowship"
      right={<HeaderIconBtn label="Start a stream" onPress={() => nav.push('Create', { kind: 'Live stream' })}><Glyph name="plus" size={17} color={colors.fg} /></HeaderIconBtn>}>
      {(() => {
        const f = LIVE.find((x) => x.status === 'live');
        if (!f) return null;
        return (
          <FadeInUp>
            <PressScale onPress={() => join(f)} scaleTo={0.98} accessibilityRole="button" style={styles.liveFeature}>
              <NightGlow />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={styles.liveStatusPill}>
                  <LiveRing color="#FFFFFF" size={6} />
                  <Text style={styles.liveStatusText}>LIVE · {f.viewers} watching</Text>
                </View>
                <Text style={styles.liveFeatureMeta}>{f.language}{f.captions ? ' · CC' : ''}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 34 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.liveFeatureEyebrow}>Happening now</Text>
                  <Text style={styles.liveFeatureTitle} numberOfLines={2}>{f.title}</Text>
                  <Text style={styles.liveFeatureHost} numberOfLines={1}>{f.host} · {f.audience}</Text>
                </View>
                <Pulse min={0.96} max={1.06} duration={1100}>
                  <View style={styles.liveFeaturePlay}>
                    <Icon name="play" size={20} color={colors.night} fill="solid" />
                  </View>
                </Pulse>
              </View>
            </PressScale>
          </FadeInUp>
        );
      })()}
      {['live', 'scheduled', 'replay'].map((st, si) => {
        const items = LIVE.filter((x) => x.status === st);
        if (!items.length) return null;
        return (
          <Section key={st} title={st === 'live' ? 'Live now' : st === 'scheduled' ? 'Scheduled' : 'Replays'} style={st === 'live' ? { marginTop: 24 } : null}>
            {items.map((x, i) => (
              <FadeInUp key={x.id} index={1 + si * 2 + i} distance={10}>
                <Row
                  title={x.title}
                  subtitle={`${x.host} · ${x.language} · ${x.audience}${x.captions ? ' · Captions' : ''}`}
                  left={<Icon name={st === 'live' ? 'live' : st === 'scheduled' ? 'calendar' : 'play'} size={18} color={st === 'live' ? colors.negative : st === 'scheduled' ? colors.primary : colors.muted} />}
                  right={st === 'live' ? (
                    <View style={styles.liveCountPill}>
                      <LiveRing size={6} />
                      <Text style={styles.liveCountText}>{x.viewers}</Text>
                    </View>
                  ) : st === 'scheduled' ? x.when : 'Replay'}
                  onPress={() => join(x)}
                />
              </FadeInUp>
            ))}
          </Section>
        );
      })}
    </Screen>
  );
}

// ---------- Feed ----------
// Share sheet, falling back to the clipboard on browsers without navigator.share.
async function shareMessage(toast, message) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.share) {
      if (navigator.clipboard) { await navigator.clipboard.writeText(message); toast.show('Copied to clipboard', { icon: 'link' }); return; }
    }
    await Share.share({ message });
  } catch (e) {
    toast.show('Sharing isn’t available on this device', { tone: 'error', icon: 'share' });
  }
}

const FEED_TABS = ['For You', 'Following', 'Communities', 'Events'];

export function FeedScreen() {
  const nav = useNav();
  const toast = useToast();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState('For You');
  const [openComments, setOpenComments] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const feed = state.feed || [];
  const communityNames = (state.communities || []).map((c) => c.name);
  const joinedCommunities = (state.communities || []).filter((c) => c.joined === true).map((c) => c.name);
  const followedPeople = PEOPLE.filter((p) => state.follows.includes(p.id)).map((p) => p.name);
  const joinedChannelNames = (state.channels || CHANNELS_DATA).filter((c) => (state.joinedChannels || []).includes(c.id) || state.follows.includes(c.id)).map((c) => c.name);
  const list = feed.filter((f) => {
    if (tab === 'Following') return f.mine || followedPeople.includes(f.author) || joinedCommunities.includes(f.author) || joinedChannelNames.includes(f.author);
    if (tab === 'Communities') return communityNames.includes(f.author);
    if (tab === 'Events') return f.kind === 'Announcement' || f.kind === 'Celebration';
    return true;
  });
  const emptyCopy = {
    'For You': ['Your feed is quiet', 'Posts, announcements and celebrations from your communities will appear here.', 'Create a post', () => nav.push('Create', { kind: 'Post' })],
    Following: ['Nothing from people you follow yet', 'Follow believers or join communities to see their posts here.', 'Find believers', () => nav.push('People')],
    Communities: ['No community posts yet', 'Join a church or study group to see its posts here.', 'Explore communities', () => nav.push('Communities')],
    Events: ['No announcements or celebrations', 'Church announcements and celebrations will appear here.', 'Open calendar', () => nav.push('Calendar')],
  }[tab];

  const save = (f) => {
    dispatch({ type: 'savePost', id: f.id });
    toast.show(f.saved ? 'Removed from saved' : 'Post saved', { icon: 'bookmark', haptic: f.saved ? 'light' : 'success' });
  };
  const share = (f) => shareMessage(toast, `${f.author}: ${f.text}${f.passage ? `\n— ${refLabel(f.passage.bookId, f.passage.chapter)}` : ''}\n\nShared from BibleNestra`);
  const addComment = (f) => {
    const text = draft.trim();
    if (!text) return;
    const c = { id: 'pc' + Date.now(), from: state.user.displayName, text, time: 'Just now' };
    dispatch({ type: 'set', patch: { feed: feed.map((x) => (x.id === f.id ? { ...x, comments: (x.comments || 0) + 1, commentList: [...(x.commentList || []), c] } : x)) } });
    setDraft('');
    toast.show('Comment posted', { icon: 'chat' });
  };
  const remove = (f) => {
    const idx = feed.findIndex((x) => x.id === f.id);
    dispatch({ type: 'deletePost', id: f.id });
    setConfirmDelete(null);
    toast.show('Post deleted', { icon: 'trash', action: { label: 'Undo', onPress: () => dispatch({ type: 'set', patch: { feed: [...feed.slice(0, idx), f, ...feed.slice(idx)].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i) } }) } });
  };

  return (
    <Screen back title="Feed"
      right={<HeaderIconBtn label="New post" onPress={() => nav.push('Create', { kind: 'Post' })}><Glyph name="plus" size={17} color={colors.fg} /></HeaderIconBtn>}>
      <Pills items={FEED_TABS} value={tab} onChange={setTab} />
      {!list.length ? <ScaleIn key={tab} from={0.92}><Empty title={emptyCopy[0]} body={emptyCopy[1]} action={emptyCopy[2]} onAction={emptyCopy[3]} /></ScaleIn> : null}
      {list.map((f, i) => {
        const showComments = openComments === f.id;
        const myComments = f.commentList || [];
        const earlier = Math.max(0, (f.comments || 0) - myComments.length);
        return (
          <FadeInUp key={f.id} index={i} style={styles.post}>
            <View style={styles.cardHeadRow}>
              <Avatar name={f.author} size={38} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.postAuthor} numberOfLines={1}>{f.mine ? `${f.author} (you)` : f.author}</Text>
                <Text style={styles.postTime}>{f.time}</Text>
              </View>
              <Badge label={f.kind} tint={f.kind === 'Celebration' ? colors.gold : f.kind === 'Announcement' ? colors.primary : colors.sage} />
              {f.mine ? (
                <Pressable onPress={() => setConfirmDelete(confirmDelete === f.id ? null : f.id)} hitSlop={8} accessibilityLabel="Delete post" style={({ pressed }) => [styles.postIconBtn, pressed && styles.pressedFill]}>
                  <Icon name="trash" size={15} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.postBody}>{f.text}</Text>
            {f.passage ? (
              <PassageChip icon="book" label={`${refLabel(f.passage.bookId, f.passage.chapter)} · Open`} onPress={() => nav.push('Bible', f.passage)} />
            ) : null}
            {confirmDelete === f.id ? (
              <FadeInUp distance={8} duration={260} style={[styles.confirmBox, { marginTop: 12 }]}>
                <Text style={styles.confirmText}>Delete this post? It will be removed from everyone's feed.</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Button small kind="danger" label="Delete" onPress={() => remove(f)} style={{ flex: 1 }} />
                  <Button small kind="ghost" label="Cancel" onPress={() => setConfirmDelete(null)} style={{ flex: 1 }} />
                </View>
              </FadeInUp>
            ) : null}
            <View style={styles.postActions}>
              <PressScale onPress={() => dispatch({ type: 'like', id: f.id })} scaleTo={0.9} style={styles.postAction} hitSlop={6} accessibilityLabel={f.liked ? 'Unlike' : 'Like'}>
                <Pop trigger={!!f.liked} amount={1.4}>
                  <Icon name="heart" size={15} color={f.liked ? colors.rose : colors.muted} fill={f.liked ? colors.rose : 'none'} />
                </Pop>
                <AnimatedNumber value={f.likes || 0} duration={400} style={[styles.postActionText, f.liked && { color: colors.rose }]} />
              </PressScale>
              <PressScale onPress={() => { setOpenComments(showComments ? null : f.id); setDraft(''); }} scaleTo={0.9} style={styles.postAction} hitSlop={6} accessibilityLabel="Comments">
                <Icon name="chat" size={15} color={showComments ? colors.primary : colors.muted} />
                <AnimatedNumber value={f.comments || 0} duration={400} style={[styles.postActionText, showComments && { color: colors.primary }]} />
              </PressScale>
              <PressScale onPress={() => share(f)} scaleTo={0.9} style={styles.postAction} hitSlop={6} accessibilityLabel="Share post">
                <Icon name="share" size={15} color={colors.muted} />
                <Text style={styles.postActionText}>Share</Text>
              </PressScale>
              <PressScale onPress={() => save(f)} scaleTo={0.9} style={[styles.postAction, { marginLeft: 'auto' }]} hitSlop={6} accessibilityLabel={f.saved ? 'Unsave post' : 'Save post'}>
                <Pop trigger={!!f.saved} amount={1.35}>
                  <Icon name="bookmark" size={15} color={f.saved ? colors.primary : colors.muted} fill={f.saved ? colors.primary : 'none'} />
                </Pop>
                <Text style={[styles.postActionText, f.saved && { color: colors.primary }]}>{f.saved ? 'Saved' : 'Save'}</Text>
              </PressScale>
            </View>
            {showComments ? (
              <FadeInUp distance={8} duration={280} style={styles.commentsBox}>
                {earlier ? <Text style={styles.commentsNote}>{earlier} earlier {earlier === 1 ? "reply" : "replies"} in this thread</Text> : null}
                {myComments.map((c) => (
                  <FadeInUp key={c.id} distance={8} duration={300} style={styles.commentRow}>
                    <Avatar name={c.from} size={26} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.commentFrom}>{c.from} <Text style={styles.commentTime}>· {c.time}</Text></Text>
                      <Text style={styles.commentText}>{c.text}</Text>
                    </View>
                  </FadeInUp>
                ))}
                <View style={styles.commentInputRow}>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={() => addComment(f)}
                    placeholder="Add a kind comment…"
                    placeholderTextColor={colors.faint}
                    style={styles.commentInput}
                    returnKeyType="send"
                  />
                  <PressScale onPress={() => addComment(f)} disabled={!draft.trim()} scaleTo={0.88} accessibilityLabel="Post comment" style={[styles.commentSend, !draft.trim() && { opacity: 0.4 }]}>
                    <Icon name="arrow-up-right" size={14} color="#FFFFFF" />
                  </PressScale>
                </View>
              </FadeInUp>
            ) : null}
          </FadeInUp>
        );
      })}
    </Screen>
  );
}

const eyebrowBase = { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' };

const styles = StyleSheet.create({
  liveFeature: { borderRadius: radius.xl, padding: 18, overflow: 'hidden', marginTop: 4, marginBottom: 4, ...shadow.lg },
  liveFeatureMeta: { fontSize: 11.5, fontWeight: '600', color: colors.nightMuted },
  liveFeatureEyebrow: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.goldLight },
  liveFeatureTitle: { fontFamily: fonts.serifBold, fontSize: 23, lineHeight: 28, color: colors.nightFg, marginTop: 4, letterSpacing: -0.3 },
  liveFeatureHost: { fontSize: 12.5, color: colors.nightMuted, marginTop: 6 },
  liveFeaturePlay: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  quickItem: { width: 68, alignItems: 'center' },
  quickIcon: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(59,47,30,0.06)' },
  quickLabel: { fontSize: 11.5, fontWeight: '600', color: colors.fg, marginTop: 7 },
  container: { flex: 1, backgroundColor: colors.screen },
  pressedFill: { backgroundColor: colors.raised },
  inlineMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bleed: { marginHorizontal: -18 },
  hScroll: { gap: 12, paddingHorizontal: 18, paddingTop: 2, paddingBottom: 8 },

  // ---- Discover header
  discoverTopBar: {
    backgroundColor: colors.screen,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
  },
  discoverHeaderRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12, gap: 12 },
  discoverEyebrow: { ...eyebrowBase, color: colors.gold, marginBottom: 2 },
  discoverTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.fg, letterSpacing: -0.6 },
  coinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 5,
    paddingRight: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginBottom: 4,
    ...shadow.sm,
  },
  coinChipIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  coinChipText: { fontSize: 13.5, fontWeight: '700', color: colors.fg, letterSpacing: -0.1 },
  coinChipLabel: { fontSize: 12, color: colors.muted },
  discoverSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    height: 44,
    ...shadow.sm,
  },
  discoverSearchPlaceholder: { flex: 1, fontSize: 14, color: colors.faint },

  // ---- Section heading
  sectionHead: { marginTop: 30, marginBottom: 14 },
  sectionEyebrow: { ...eyebrowBase, color: colors.gold, marginBottom: 3 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { flex: 1, fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 27, color: colors.fg, letterSpacing: -0.4 },
  sectionSub: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 3 },
  sectionActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  sectionActionText: { fontSize: 13, fontWeight: '600', color: colors.primary },

  // ---- Altar
  altarHeroCard: { borderRadius: 18, overflow: 'hidden', marginBottom: 14, ...shadow.md },
  altarHeroBg: { width: '100%', height: 176 },
  altarHeroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: alpha(colors.night, 0.62), borderRadius: 18 },
  altarHeroContent: { flex: 1, padding: 16, justifyContent: 'space-between' },
  altarHeroTopPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.goldLight },
  altarHeroPillText: { ...eyebrowBase, fontSize: 9.5, color: colors.nightFg },
  altarHeroBottomRow: { flexDirection: 'row', alignItems: 'flex-end' },
  altarHeroTitle: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: '#FFFFFF', letterSpacing: -0.3 },
  altarHeroSub: { fontSize: 12.5, lineHeight: 17, color: colors.nightMuted, marginTop: 4 },
  makeWishActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFFFF',
    paddingLeft: 14,
    paddingRight: 10,
    height: 36,
    borderRadius: radius.pill,
  },
  makeWishActionText: { fontSize: 13, fontWeight: '700', color: colors.night },

  wishStreamCard: {
    width: 264,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    justifyContent: 'space-between',
    ...shadow.sm,
  },
  wishCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  wishCardUser: { fontSize: 13.5, fontWeight: '600', color: colors.fg },
  wishCardTime: { fontSize: 11, color: colors.faint, marginTop: 1 },
  wishCardBody: { fontFamily: fonts.serifItalic, fontSize: 15, lineHeight: 21, color: colors.passage, marginTop: 10, minHeight: 63 },
  wishCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  amenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.raised,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  amenBtnOn: { backgroundColor: colors.cardGold },
  amenBtnText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  amenBtnTextOn: { color: colors.goldMuted, fontWeight: '700' },
  countRow: { flexDirection: 'row', alignItems: 'center' },

  // ---- Devotionals
  devCard: {
    width: 212,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.sm,
  },
  devThumb: { width: '100%', height: 124, backgroundColor: colors.raised },
  devTimeBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: alpha(colors.night, 0.72),
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  devTimeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.nightFg },
  devPlayBubble: {
    position: 'absolute',
    right: 12,
    bottom: -18,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devInfo: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, paddingRight: 56 },
  devTitle: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg, letterSpacing: -0.2 },
  devSub: { fontSize: 12, color: colors.muted, marginTop: 2 },

  // ---- Game cards
  gameCard: {
    width: 244,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  gameCardImg: { width: '100%', height: 116, backgroundColor: colors.raised },
  gameBadgeBox: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: alpha(colors.night, 0.75),
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  gameBadgeText: { ...eyebrowBase, fontSize: 9.5, color: colors.goldLight },
  gameCardContent: { padding: 14 },
  gameCardTitle: { fontFamily: fonts.serifBold, fontSize: 16.5, color: colors.fg, letterSpacing: -0.2 },
  gameCardSub: { fontSize: 12, lineHeight: 16, color: colors.muted, marginTop: 3, minHeight: 32 },
  gameCardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  gameCardPlayers: { fontSize: 11.5, color: colors.faint },
  gameCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 13,
    height: 30,
    borderRadius: radius.pill,
  },
  gameCardBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  // ---- Jobs
  jobsHeroTeaser: { borderRadius: 18, overflow: 'hidden', ...shadow.md },
  jobsHeroBg: { width: '100%', height: 158 },
  jobsHeroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: alpha(colors.night, 0.66), borderRadius: 18 },
  jobsHeroContent: { flex: 1, padding: 16, justifyContent: 'space-between' },
  jobsHeroEyebrow: { ...eyebrowBase, color: colors.goldLight },
  jobsHeroTitle: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 25, color: '#FFFFFF', letterSpacing: -0.3 },
  jobsHeroSub: { fontSize: 12.5, lineHeight: 17, color: colors.nightMuted, marginTop: 4 },
  jobsHeroArrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.sm,
  },
  groupDivider: { borderTopWidth: 1, borderTopColor: colors.rule },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  iconTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  jobItemTitle: { fontSize: 14, fontWeight: '600', color: colors.fg, letterSpacing: -0.1 },
  jobItemMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  jobKindText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  applySmallBtn: { backgroundColor: colors.primarySoft, paddingHorizontal: 14, height: 32, borderRadius: radius.pill, justifyContent: 'center' },
  applySmallBtnText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },

  // ---- Photo tiles
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  photoCard: { width: '48.4%', height: 150, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.night, ...shadow.sm },
  photoCardBg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  photoCardScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: alpha(colors.night, 0.48) },
  photoCardContent: { flex: 1, padding: 12, justifyContent: 'space-between' },
  photoCardBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3.5, borderRadius: radius.pill },
  photoCardBadgeText: { ...eyebrowBase, fontSize: 9, letterSpacing: 0.9, color: '#FFFFFF' },
  photoCardTitle: { color: '#FFFFFF', fontFamily: fonts.serifBold, fontSize: 17, letterSpacing: -0.2 },
  photoCardSub: { color: 'rgba(255,255,255,0.82)', fontSize: 11.5, marginTop: 1 },

  // ---- Quick play rows
  quickGameRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  quickGameThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.raised },
  quickGameBadge: { ...eyebrowBase, fontSize: 9.5, color: colors.gold },
  quickGameTitle: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg, marginTop: 1, letterSpacing: -0.2 },
  quickGameMeta: { fontSize: 11.5, color: colors.faint, marginTop: 1 },
  quickGamePlay: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },

  // ---- Channels
  channelSheet: { backgroundColor: colors.screen, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 30, ...shadow.lg },
  channelSheetVideo: { height: 180, borderRadius: 18, backgroundColor: colors.night, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  channelSheetPlay: { width: 54, height: 54, borderRadius: 27, backgroundColor: alpha(colors.goldLight, 0.14), borderWidth: 1, borderColor: alpha(colors.goldLight, 0.35), alignItems: 'center', justifyContent: 'center', marginBottom: 36 },
  channelSheetVideoTitle: { fontFamily: fonts.serifBold, fontSize: 17, lineHeight: 22, color: colors.nightFg },
  channelSheetVideoMeta: { fontSize: 12, color: colors.nightMuted, marginTop: 3 },
  sheetLinkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 16, paddingVertical: 6 },
  sheetLinkText: { fontSize: 13.5, fontWeight: '600', color: colors.primary },
  channelCard: {
    width: 228,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.sm,
  },
  channelPreview: { height: 92, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  channelIconRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: alpha(colors.goldLight, 0.12),
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelFollowersBadge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: radius.pill },
  channelFollowersText: { color: colors.nightFg, fontSize: 10, fontWeight: '600' },
  channelName: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg, letterSpacing: -0.2 },
  channelVideoTitle: { fontSize: 12, color: colors.muted, marginTop: 2 },

  createCard: { marginTop: 32, alignItems: 'center' },
  createEyebrow: { ...eyebrowBase, color: colors.gold, textAlign: 'center' },
  createTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg, textAlign: 'center', marginTop: 2, letterSpacing: -0.3 },

  // ---- Sheets / modals
  modalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  gameSheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '92%',
    minHeight: 520,
    ...shadow.lg,
  },
  wishFull: { flex: 1, maxHeight: undefined, minHeight: undefined, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  wishSheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '92%',
    minHeight: 560,
    ...shadow.lg,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  sheetTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingBottom: 12 },
  sheetEyebrow: { ...eyebrowBase, color: colors.gold },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 21, color: colors.fg, marginTop: 2, letterSpacing: -0.3 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  gameScoreBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radius.pill,
  },
  scorePillStreak: { backgroundColor: colors.cardGold, borderColor: alpha(colors.gold, 0.3) },
  scorePillText: { fontSize: 12, fontWeight: '700', color: colors.fg },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.raised, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  dailyLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dailyLineText: { flex: 1, fontSize: 11.5, color: colors.faint },
  dailyLineScore: { fontSize: 11.5, fontWeight: '700', color: colors.goldMuted },
  adCard: {
    backgroundColor: colors.night,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 14,
    marginTop: 16,
    alignItems: 'center',
    overflow: 'hidden',
    ...shadow.md,
  },
  adCardIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  adCardEyebrow: { ...eyebrowBase, color: colors.goldLight, marginTop: 16 },
  adCardTitle: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 29, color: colors.nightFg, textAlign: 'center', marginTop: 6, letterSpacing: -0.3 },
  adCardSub: { fontSize: 13.5, lineHeight: 19, color: colors.nightMuted, textAlign: 'center', marginTop: 8 },
  adSkip: { paddingVertical: 10, paddingHorizontal: 18, marginTop: 6 },
  adSkipText: { fontSize: 13, fontWeight: '600', color: colors.nightMuted, textDecorationLine: 'underline' },
  gameOverDaily: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 16, gap: 8 },
  gameOverDailyCell: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.raised },
  gameOverDailyValue: { fontSize: 15, fontWeight: '700', color: colors.fg },
  gameOverDailyLabel: { fontSize: 10.5, color: colors.muted, marginTop: 2 },

  gameQuestionBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    marginTop: 14,
    ...shadow.sm,
  },
  gameQuestionEyebrow: { ...eyebrowBase, color: colors.gold, marginBottom: 8 },
  gameQuestionText: { fontFamily: fonts.serifMedium, fontSize: 19, lineHeight: 27, color: colors.fg, letterSpacing: -0.2 },
  gameOptionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, gap: 12 },
  gameOptionLetter: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  gameOptionLetterText: { fontSize: 12.5, fontWeight: '700' },
  gameOptionText: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 19 },
  gameExplanationBox: {
    backgroundColor: colors.cardGold,
    borderRadius: radius.lg,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: alpha(colors.gold, 0.2),
  },
  gameCitationBadge: { fontFamily: fonts.serifBold, fontSize: 14, color: colors.goldMuted },
  gameExplanationText: { fontSize: 13.5, lineHeight: 20, color: colors.passage, marginTop: 6 },
  gameOverContainer: { paddingTop: 22, paddingBottom: 10, alignItems: 'center' },
  gameOverMedal: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.night,
    borderWidth: 3,
    borderColor: alpha(colors.goldLight, 0.5),
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  gameOverMedalWrap: { width: 160, height: 100, alignItems: 'center', justifyContent: 'center' },
  gameOverStats: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 14,
    marginTop: 18,
    ...shadow.sm,
  },
  gameOverStat: { flex: 1, alignItems: 'center' },
  gameOverStatValue: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.fg, letterSpacing: -0.4 },
  gameOverStatLabel: { ...eyebrowBase, fontSize: 9.5, color: colors.muted, marginTop: 2 },
  gameOverStatDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.rule },
  gameOverTitle: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.fg, marginTop: 18, letterSpacing: -0.5 },
  gameOverScoreText: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.gold, marginTop: 4 },
  gameOverSub: { fontSize: 13.5, lineHeight: 19, color: colors.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  practiceHint: { fontSize: 11.5, color: colors.faint, textAlign: 'center', marginTop: 6 },

  wishHeroCard: { height: 150, borderRadius: radius.lg, overflow: 'hidden', marginTop: 4, marginBottom: 6, backgroundColor: colors.night },
  wishHeroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  wishHeroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: alpha(colors.night, 0.66) },
  wishHeroContent: { flex: 1, padding: 16, justifyContent: 'flex-end' },
  wishHeroEyebrow: { ...eyebrowBase, color: colors.goldLight, marginBottom: 4 },
  wishHeroTitle: { fontFamily: fonts.serifItalic, fontSize: 19, color: colors.nightFg },
  wishHeroSub: { fontSize: 12, color: colors.nightMuted, marginTop: 5, lineHeight: 17 },
  inputLabel: { ...eyebrowBase, color: colors.muted, marginTop: 18, marginBottom: 6 },
  wishInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    minHeight: 110,
    fontSize: 15,
    lineHeight: 21,
    color: colors.fg,
    textAlignVertical: 'top',
  },
  wishesSectionTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.fg, marginTop: 2, marginBottom: 12, letterSpacing: -0.3 },
  wishItemCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    ...shadow.sm,
  },
  wishItemHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wishItemUser: { fontSize: 13.5, fontWeight: '600', color: colors.fg },
  wishItemTime: { fontSize: 11.5, color: colors.faint, marginTop: 1 },
  wishItemText: { fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 22, color: colors.passage, marginTop: 10 },
  wishItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },

  // ---- Shared sub-screen pieces
  headerIconBtn: {
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
  headerIconBtnActive: { backgroundColor: colors.fg, borderColor: colors.fg },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    height: 46,
    ...shadow.sm,
  },
  searchFieldInput: { flex: 1, fontSize: 14, color: colors.fg, height: '100%' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginTop: 12,
    ...shadow.sm,
  },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardFootRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 8 },
  communityTile: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.fg, letterSpacing: -0.2 },
  cardMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  cardBody: { fontSize: 13.5, color: colors.passage, lineHeight: 20, marginTop: 10 },
  tagWrap: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },

  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    ...shadow.sm,
  },
  avatarRowTitle: { fontSize: 14.5, fontWeight: '600', color: colors.fg, letterSpacing: -0.1 },
  avatarRowSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },

  // Group
  aboutHero: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 20,
    ...shadow.sm,
  },
  aboutTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 12, textAlign: 'center', letterSpacing: -0.4 },
  quoteBlock: { backgroundColor: colors.cardGold, borderWidth: 1, borderColor: alpha(colors.gold, 0.25), borderRadius: radius.md, padding: 14 },
  quoteBlockText: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 22, color: colors.passage },
  channelBar: { paddingTop: 10, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pinned: {
    marginHorizontal: 18,
    marginTop: 12,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: alpha(colors.gold, 0.28),
    backgroundColor: colors.cardGold,
  },
  pinnedLabel: { ...eyebrowBase, fontSize: 9.5, color: colors.gold, marginBottom: 3 },
  pinnedText: { fontSize: 13, lineHeight: 18, color: colors.fg },
  msg: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    maxWidth: '84%',
    ...shadow.sm,
  },
  msgMine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderColor: colors.primary, borderBottomLeftRadius: 18, borderBottomRightRadius: 6 },
  msgFrom: { fontSize: 11.5, color: colors.gold, fontWeight: '700', marginBottom: 3 },
  msgText: { fontSize: 14.5, lineHeight: 20, color: colors.fg },
  msgTime: { fontSize: 10.5, color: colors.faint, marginTop: 5 },
  msgTimeMine: { color: 'rgba(255,255,255,0.66)', textAlign: 'right' },
  passageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  passageChipMine: { backgroundColor: 'rgba(255,255,255,0.14)' },
  passageChipActive: { backgroundColor: colors.primary },
  passageChipText: { fontFamily: fonts.serifBold, fontSize: 13.5, color: colors.primary },
  chatComposerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatBusy: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 },
  composerWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.screen,
  },
  followLockedCard: {
    margin: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    ...shadow.sm,
  },
  followLockedIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: alpha(colors.primary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  followLockedTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 15,
    color: colors.fg,
    letterSpacing: -0.2,
  },
  followLockedSub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  followWaitingPill: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: alpha(colors.primary, 0.08),
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  followWaitingText: {
    fontSize: 11.5,
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  composerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  composerChipText: { fontSize: 12, fontWeight: '500', color: colors.fg },

  // Chats
  exegesisCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.night,
    borderRadius: radius.lg,
    padding: 14,
    marginTop: 14,
    ...shadow.md,
  },
  exegesisIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: alpha(colors.goldLight, 0.14),
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  exegesisTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.nightFg, letterSpacing: -0.2 },
  exegesisSub: { fontSize: 12, color: colors.nightMuted, marginTop: 2, lineHeight: 16 },
  chatTime: { fontSize: 11, color: colors.faint },
  unreadDot: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  unreadDotText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  newChatHero: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  menu: {
    position: 'absolute',
    right: 14,
    top: 6,
    zIndex: 5,
    width: 250,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 6,
    ...shadow.lg,
  },
  menuRow: { paddingVertical: 10, paddingHorizontal: 14 },
  menuRowDivider: { borderTopWidth: 1, borderTopColor: colors.rule, marginTop: 4, paddingTop: 12 },
  menuItem: { color: colors.fg, fontSize: 14 },
  menuFoot: { fontSize: 11, color: colors.faint, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6, borderTopWidth: 1, borderTopColor: colors.rule, marginTop: 4 },
  encryptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    backgroundColor: colors.raised,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginBottom: 6,
  },
  encryptText: { fontSize: 11, color: colors.muted },
  chatTip: { alignSelf: 'center', textAlign: 'center', fontSize: 11.5, color: colors.faint, marginTop: -4, marginBottom: 2, paddingHorizontal: 18 },

  // Calendar
  event: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    ...shadow.sm,
  },
  dateBox: { width: 50, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  dateDay: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 25 },
  dateMon: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  eventKind: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2 },
  eventScripture: { marginTop: 6, alignSelf: 'flex-start' },
  eventScriptureText: { fontFamily: fonts.serifItalic, color: colors.gold, fontSize: 13.5 },
  eventSource: { color: colors.faint, fontSize: 11, marginTop: 4 },
  eventAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: alpha(colors.primary, 0.3),
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    height: 28,
  },
  eventActionOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  eventActionQuiet: { borderColor: colors.border, backgroundColor: colors.raised },
  eventActionText: { fontSize: 11, fontWeight: '600', color: colors.primary },

  // People
  peopleGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, marginTop: 14 },
  personCell: { width: '48.4%' },
  personCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    ...shadow.sm,
  },
  personAvatarWrapper: { position: 'relative' },
  personOnlineDot: { position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: 7, backgroundColor: colors.positive, borderWidth: 2.5, borderColor: colors.surface },
  personCardName: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.fg, marginTop: 10, letterSpacing: -0.2 },
  personCardHeadline: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 3, lineHeight: 15, height: 30 },
  personCardCountry: { ...eyebrowBase, fontSize: 9.5, color: colors.gold, marginTop: 6 },
  personChatBtn: { flex: 1, flexDirection: 'row', gap: 5, backgroundColor: colors.primary, borderRadius: radius.pill, height: 34, alignItems: 'center', justifyContent: 'center' },
  personChatBtnText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '600' },
  personFollowBtn: { width: 34, height: 34, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  personFollowBtnActive: { borderColor: colors.primarySoft, backgroundColor: colors.primarySoft },

  // Person
  profileCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingVertical: 24,
    paddingHorizontal: 18,
    marginTop: 4,
    ...shadow.sm,
  },
  profileName: { fontFamily: fonts.display, fontSize: 26, color: colors.fg, marginTop: 14, letterSpacing: -0.5, textAlign: 'center' },
  profileHeadline: { fontSize: 13.5, color: colors.fg, marginTop: 3, textAlign: 'center' },
  profileMeta: { fontSize: 12, color: colors.muted, marginTop: 3, textAlign: 'center' },
  profileRule: { width: 36, height: 1, backgroundColor: colors.goldLight, marginTop: 16 },
  profileIntro: { fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 23, color: colors.passage, textAlign: 'center', marginTop: 14, paddingHorizontal: 6 },

  // Care
  careHero: {
    backgroundColor: colors.cardSage,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: alpha(colors.sage, 0.18),
  },
  careEyebrow: { ...eyebrowBase, color: colors.sage },
  careTitle: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.fg, marginTop: 4, letterSpacing: -0.4 },
  careSub: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 4 },
  changeBtn: { backgroundColor: colors.raised, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  changeBtnText: { fontSize: 12, fontWeight: '600', color: colors.fg },

  // Live
  video: {
    height: 220,
    backgroundColor: colors.night,
    borderRadius: radius.lg,
    overflow: 'hidden',
    padding: 16,
    justifyContent: 'space-between',
    ...shadow.lg,
  },
  videoTop: { flexDirection: 'row' },
  liveStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.negative, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  liveCountPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: alpha(colors.negative, 0.1), paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  liveCountText: { fontSize: 12, fontWeight: '700', color: colors.negative },
  liveStatusText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 },
  videoPlay: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: alpha(colors.goldLight, 0.14),
    borderWidth: 1,
    borderColor: alpha(colors.goldLight, 0.35),
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.nightFg, letterSpacing: -0.2 },
  videoNote: { fontSize: 11, color: colors.nightMuted, marginTop: 3 },

  // Feed
  post: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginTop: 12,
    ...shadow.sm,
  },
  postAuthor: { fontSize: 14.5, fontWeight: '600', color: colors.fg },
  postTime: { fontSize: 11.5, color: colors.faint, marginTop: 1 },
  postBody: { fontSize: 14.5, lineHeight: 21, color: colors.passage, marginTop: 12 },
  postIconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  confirmBox: { backgroundColor: colors.cardRose, borderWidth: 1, borderColor: alpha(colors.negative, 0.22), borderRadius: radius.md, padding: 14, marginTop: 16, alignSelf: 'stretch' },
  confirmText: { fontSize: 13.5, lineHeight: 19, color: colors.fg },
  careMsgBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  commentsBox: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 10 },
  commentsNote: { fontSize: 12, color: colors.faint },
  commentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  commentFrom: { fontSize: 12.5, fontWeight: '700', color: colors.fg },
  commentTime: { fontSize: 12, fontWeight: '400', color: colors.faint },
  commentText: { fontSize: 13.5, lineHeight: 19, color: colors.fg, marginTop: 1 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.raised, borderRadius: radius.pill, paddingLeft: 14, paddingRight: 5, height: 40 },
  commentInput: { flex: 1, fontSize: 13.5, color: colors.fg, paddingVertical: 0 },
  commentSend: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  postAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  postActionText: { fontSize: 12.5, color: colors.muted, fontWeight: '500' },
});
