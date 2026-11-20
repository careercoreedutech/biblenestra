import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, Image } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Screen, Section, Badge, Tag, Button, Row, Pill, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { colors, fonts, radius, shadow } from '../theme';
import { useNav } from '../navigation';
import { useStore } from '../store';
import { useSync, usePullRefresh } from '../api/sync';
import { errorMessage } from '../api/client';
import { useToast, haptic } from '../components/Toast';
import { AnimatedModal, PressScale, FadeInUp, ScaleIn, Pop, Burst, AnimatedNumber, LiveRing, Pulse } from '../components/Motion';
import ProfileButton from '../components/ProfileButton';
import { useAds } from '../ads/Ads';
import { AD_RULES } from '../ads/config';
import { OpportunitiesEntryCard, CareerPrayerCard } from './OpportunitiesScreen'; // OPPORTUNITIES (+ daily career prayer, brief 12.4)

const hasNumber = (v) => /\d/.test(String(v || ''));
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// Bidding economy: posting is free; placing a bid costs coins, which can also be unlocked by watching rewarded ads.
const BID_COST = AD_RULES.jobBidCost; // 20
const ADS_NEEDED_DEFAULT = AD_RULES.jobAdsForCoins; // 2 — online the server decides (GET /me jobAdsNeeded = jobs.bid_required_ads)
const AD_COINS = AD_RULES.jobAdCoins; // 20
const TOPUP_COINS = 100; // same simulated purchase as the Profile wallet's "+ Add 100 Coins"

function FieldError({ text }) {
  if (!text) return null;
  return (
    <FadeInUp key={text} distance={6} duration={220} style={styles.fieldError}>
      <Icon name="x" size={12} color={colors.negative} strokeWidth={2.6} />
      <Text style={styles.fieldErrorText}>{text}</Text>
    </FadeInUp>
  );
}

const CATEGORIES = [
  'All',
  'Entertainment',
  'Fitness',
  'E-Commerce',
  'AI',
  'Graphic Design & Video Editing',
  'Software & Web Development',
  'Virtual Assistants',
  'Worship Musicians & Producers',
  'Writers, Editors & Translators',
  'Church Administration',
  'Social Media & Digital Marketing',
];

export default function JobsScreen({ params = {} }) {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const sync = useSync(); // online: bids, coins and ad credits are settled by the server
  const pullRefresh = usePullRefresh();
  const toast = useToast();
  const [bidBusy, setBidBusy] = useState(false);
  const [filterKind, setFilterKind] = useState('all'); // 'all' | 'job' | 'task' | 'proposals'
  const [selectedCat, setSelectedCat] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);

  const jobsVideoPlayer = useVideoPlayer('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4', (player) => {
    player.loop = true;
    player.play();
    player.muted = true;
  });

  // Proposal Form State
  const [bidRate, setBidRate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [applyErrors, setApplyErrors] = useState({});
  const [postErrors, setPostErrors] = useState({});
  const [confirmWithdraw, setConfirmWithdraw] = useState(null);
  const [justApplied, setJustApplied] = useState(null); // job id whose proposal was just sent (success state in the sheet)
  const [sentBurst, setSentBurst] = useState(0);
  const closeTimer = useRef(null);
  // Bid gate (second step of the apply sheet)
  const ads = useAds();
  const [applyStep, setApplyStep] = useState('form'); // 'form' (proposal) | 'bid' (pay the bid fee)
  const [adBusy, setAdBusy] = useState(false); // a rewarded ad is currently on screen
  const [unlockFx, setUnlockFx] = useState(0); // bumps when 5 ads convert into coins (drives the "+20 coins" celebration)
  const [celebrating, setCelebrating] = useState(false); // keep all 5 dots lit briefly after the unlock
  const celebrateTimer = useRef(null);
  const applyScroll = useRef(null);
  useEffect(() => () => { clearTimeout(closeTimer.current); clearTimeout(celebrateTimer.current); }, []);
  // Bid step open → start loading the rewarded ad now so "Watch ad" opens instantly (the next one loads while it plays)
  useEffect(() => { if (showApplyModal && applyStep === 'bid') ads.preloadRewarded('job'); }, [showApplyModal, applyStep]);

  // Post Job/Task Form State
  const [postTitle, setPostTitle] = useState('');
  const [postKind, setPostKind] = useState('task');
  const [postCategory, setPostCategory] = useState('Graphic Design & Video Editing');
  const [postBudget, setPostBudget] = useState('');
  const [postDeadline, setPostDeadline] = useState('');
  const [postSkills, setPostSkills] = useState('');
  const [postDesc, setPostDesc] = useState('');

  const jobs = state.jobs || [];
  const proposals = state.proposals || [];
  const appliedTo = (id) => proposals.find((pr) => pr.jobId === id);
  const bids = state.bids || {};
  const bidOn = (id) => bids[id] || null; // { coins, time } once the bid fee was paid for this job
  const coins = state.coins || 0;
  const adCredits = state.jobAdCredits || 0;
  const ADS_NEEDED = (sync.me && sync.me.jobAdsNeeded) || ADS_NEEDED_DEFAULT; // rewarded ads per coin unlock (remote config)
  const openCount = jobs.filter((j) => j.status !== 'closed').length;
  const myListings = jobs.filter((j) => j.mine);

  const openApply = (job, presetBid = '') => {
    // Re-opening the same job keeps the unsent draft (and the bid step), so leaving to watch ads never loses work.
    const sameDraft = selectedJob && selectedJob.id === job.id && !appliedTo(job.id);
    setSelectedJob(job);
    if (!sameDraft) {
      setBidRate(presetBid);
      setDeliveryTime('');
      setCoverNote('');
      setApplyStep('form');
    }
    setApplyErrors({});
    setJustApplied(null);
    clearTimeout(closeTimer.current);
    setShowApplyModal(true);
  };
  // Opened from Discover with a specific listing: open its apply sheet once.
  useEffect(() => {
    if (!params.id) return;
    const job = jobs.find((x) => x.id === params.id);
    if (job && !appliedTo(job.id)) openApply(job);
  }, [params.id]);


  const openPost = () => {
    setPostErrors({});
    setShowPostModal(true);
  };

  const withdraw = (prop) => {
    dispatch({
      type: 'set',
      patch: {
        proposals: proposals.filter((x) => x.id !== prop.id),
        jobs: jobs.map((j) => (j.id === prop.jobId ? { ...j, proposalsCount: Math.max(0, (j.proposalsCount || 0) - 1) } : j)),
      },
    });
    setConfirmWithdraw(null);
    // The bid fee stays recorded on the job (state.bids), so re-applying later is free.
    toast.show(bidOn(prop.jobId) ? 'Proposal withdrawn · your bid stays paid if you re-apply' : 'Proposal withdrawn', { icon: 'check' });
  };

  const shareJob = async (job) => {
    const message = `${job.title}\n${job.budget} · ${job.deadline || ''}\n\n${job.description || ''}\n\nFound on BibleNestra Jobs`;
    try {
      await Share.share({ message });
    } catch (e) {
      toast.show('Sharing isn’t available here', { tone: 'error' });
    }
  };

  const closeListing = (job) => {
    dispatch({ type: 'set', patch: { jobs: jobs.map((j) => (j.id === job.id ? { ...j, status: j.status === 'closed' ? 'open' : 'closed' } : j)) } });
    setShowApplyModal(false);
    toast.show(job.status === 'closed' ? 'Listing reopened' : 'Listing closed to new proposals', { icon: 'briefcase' });
  };

  const filteredJobs = jobs.filter((j) => {
    if (filterKind !== 'all' && filterKind !== 'proposals' && j.kind !== filterKind) return false;
    if (selectedCat !== 'All' && j.category !== selectedCat) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return j.title.toLowerCase().includes(q) || j.category.toLowerCase().includes(q) || j.skills.some((s) => s.toLowerCase().includes(q));
    }
    return true;
  });

  // Step 1 of applying: validate the proposal, then move to the bid gate (unless the fee was already paid for this job).
  const handleApply = () => {
    const errs = {};
    if (!bidRate.trim()) errs.bid = 'Enter your rate or price.';
    else if (!hasNumber(bidRate)) errs.bid = 'Include an amount, e.g. $250 or $35/hr.';
    if (!coverNote.trim()) errs.cover = 'Add a short cover note for the client.';
    else if (coverNote.trim().length < 20) errs.cover = 'A little more detail please (at least 20 characters).';
    setApplyErrors(errs);
    if (Object.keys(errs).length) {
      haptic('warning');
      return;
    }
    if (bidOn(selectedJob.id) && sync.online) {
      toast.show('You’ve already placed a bid on this listing', { icon: 'briefcase' });
      return;
    }
    if (bidOn(selectedJob.id)) {
      // Fee already paid earlier (proposal was withdrawn) — resubmitting is free.
      submitProposal(false);
      return;
    }
    haptic('select');
    setApplyStep('bid');
    requestAnimationFrame(() => applyScroll.current?.scrollTo?.({ y: 0, animated: false }));
  };

  // Step 2: record the paid bid (optional) + send the proposal, then celebrate inside the sheet.
  const submitProposal = async (payFee) => {
    const job = selectedJob;
    if (!job) return;
    if (sync.online) {
      // The server charges the bid fee atomically and returns the new balance
      if (bidBusy) return;
      setBidBusy(true);
      try {
        await sync.placeBid(job, { cover: coverNote.trim(), amount: bidRate.trim(), timeline: deliveryTime.trim() || 'Flexible' });
      } catch (e) {
        if (e && e.code === 'INSUFFICIENT_COINS') {
          toast.show(`Not enough coins — a bid costs ${BID_COST}. Watch ${ADS_NEEDED} short ads to unlock ${AD_COINS}.`, { tone: 'error', icon: 'coin', duration: 4200 });
        } else if (e && e.code === 'ALREADY_BID') {
          toast.show('You’ve already placed a bid on this listing', { tone: 'error', icon: 'briefcase' });
        } else {
          toast.show(`Couldn’t place your bid: ${errorMessage(e)}`, { tone: 'error', icon: 'briefcase' });
        }
        return;
      } finally {
        setBidBusy(false);
      }
    } else {
      if (payFee) dispatch({ type: 'placeBid', jobId: job.id, coins: BID_COST });
      dispatch({
        type: 'applyJob',
        jobId: job.id,
        jobTitle: job.title,
        proposal: {
          applicant: state.user.displayName,
          headline: state.user.headline,
          bidRate: bidRate.trim(),
          deliveryTime: deliveryTime.trim() || 'Flexible',
          coverNote: coverNote.trim(),
        },
      });
    }
    // Celebrate inside the sheet (it now shows the "Bid placed" state), then glide it closed.
    setApplyStep('form');
    setJustApplied(job.id);
    setTimeout(() => setSentBurst((b) => b + 1), 120);
    closeTimer.current = setTimeout(() => setShowApplyModal(false), 1700);
    setBidRate('');
    setDeliveryTime('');
    setCoverNote('');
    const who = job.client?.name ? ` to ${job.client.name}` : '';
    toast.show(payFee ? `Bid placed for ${BID_COST} coins · proposal sent${who}` : `Proposal resubmitted${who}`, {
      icon: 'briefcase',
      haptic: 'success',
      action: { label: 'View', onPress: () => { setShowApplyModal(false); setFilterKind('proposals'); } },
    });
  };

  const payAndBid = () => {
    if (bidBusy) return;
    if (coins < BID_COST) {
      toast.show(`You need ${BID_COST - coins} more coins to bid`, { tone: 'error', icon: 'coin' });
      return;
    }
    submitProposal(true);
  };

  // One rewarded ad = one step toward the coin unlock. Progress lives in the store, so it survives leaving midway.
  const watchBidAd = async () => {
    if (adBusy) return;
    const willUnlock = adCredits + 1 >= ADS_NEEDED;
    setAdBusy(true);
    // Full-screen ads can't reliably stack over our own modal sheet (web portals / iOS presentation),
    // so glide the sheet away, play the ad, then bring the sheet back with the draft + bid step intact.
    setShowApplyModal(false);
    await wait(320);
    let r = null;
    try {
      r = await ads.showRewarded({ purpose: 'job' });
    } catch (e) {
      r = null;
    }
    // Online: the server credits the ad (and converts every 5 into coins)
    let credit = null;
    let creditErr = null;
    if (r && r.rewarded && sync.online) {
      try { credit = await sync.creditAd('job'); } catch (e) { creditErr = e; }
    }
    setShowApplyModal(true);
    await wait(380); // let the sheet spring back in so the dot fill / unlock celebration is actually seen
    setAdBusy(false);
    if (!r || !r.rewarded) {
      toast.show('Ad closed before the end — no credit this time', { tone: 'error', icon: 'play' });
      return;
    }
    if (sync.online) {
      if (creditErr || !credit) {
        toast.show((creditErr && creditErr.message) || 'Couldn’t record that ad — please try again', { tone: 'error', icon: 'play' });
        return;
      }
      if (credit.unlocked) {
        setCelebrating(true);
        setUnlockFx((n) => n + 1);
        clearTimeout(celebrateTimer.current);
        celebrateTimer.current = setTimeout(() => setCelebrating(false), 2400);
        toast.show(`+${credit.unlocked} coins unlocked — thank you for supporting BibleNestra`, { icon: 'coin', haptic: 'success' });
      } else {
        toast.show(`Ad ${credit.jobAdCredits} of ${ADS_NEEDED} watched · progress saved`, { icon: 'check', haptic: 'select' });
      }
      return;
    }
    dispatch({ type: 'jobAdCredit', need: ADS_NEEDED, coins: AD_COINS });
    if (willUnlock) {
      setCelebrating(true);
      setUnlockFx((n) => n + 1);
      clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => setCelebrating(false), 2400);
      toast.show(`+${AD_COINS} coins unlocked — thank you for supporting BibleNestra`, { icon: 'coin', haptic: 'success' });
    } else {
      toast.show(`Ad ${adCredits + 1} of ${ADS_NEEDED} watched · progress saved`, { icon: 'check', haptic: 'select' });
    }
  };

  const buyBidCoins = () => {
    if (sync.online) {
      // No purchase API yet — coins are server-side, so a simulated top-up would be overwritten
      toast.show(`Coin purchases are coming soon — watch ${ADS_NEEDED} short ads to unlock ${AD_COINS} coins`, { icon: 'coin', duration: 3600 });
      return;
    }
    dispatch({ type: 'buyCoins', amount: TOPUP_COINS });
    toast.show(`Added ${TOPUP_COINS} coins · balance ${coins + TOPUP_COINS}`, {
      icon: 'coin',
      haptic: 'success',
      action: { label: 'Wallet', onPress: () => { setShowApplyModal(false); nav.push('Profile', { tab: 'Wallet & Gifts' }); } },
    });
  };

  const handlePostJob = () => {
    const errs = {};
    if (!postTitle.trim()) errs.title = 'Give your listing a title.';
    else if (postTitle.trim().length < 6) errs.title = 'Title is too short — describe the work in a few words.';
    if (!postBudget.trim()) errs.budget = 'Enter a budget or pay rate.';
    else if (!hasNumber(postBudget)) errs.budget = 'Include an amount, e.g. $300 Fixed or $25/hr.';
    setPostErrors(errs);
    if (Object.keys(errs).length) return;
    dispatch({
      type: 'postJob',
      job: {
        title: postTitle.trim(),
        kind: postKind,
        category: postCategory,
        budget: postBudget.trim(),
        deadline: postDeadline.trim() || 'Flexible',
        skills: postSkills.split(',').map((s) => s.trim()).filter(Boolean),
        description: postDesc.trim() || 'Detailed scope discussed during consultation.',
        mine: true,
      },
    });
    setShowPostModal(false);
    setPostTitle('');
    setPostBudget('');
    setPostDeadline('');
    setPostSkills('');
    setPostDesc('');
    setSearch('');
    setSelectedCat('All');
    setFilterKind(postKind);
    toast.show('Listing published', { icon: 'briefcase', haptic: 'success' });
  };


  const kindTabs = [
    { id: 'all', label: 'All work' },
    { id: 'job', label: 'Jobs & vacancies' },
    { id: 'task', label: 'Project tasks' },
    { id: 'proposals', label: `My proposals (${proposals.length})` },
  ];

  const bounties = [
    {
      key: 'b875',
      price: '$875.00',
      title: 'Creators Corner',
      rating: '4.96 (24 reviews)',
      tagline: 'Unlock your creative potential',
      desc: 'Produce high-retention sermon reels, gospel shorts & social clips.',
      image: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=600&q=80',
      job: {
        id: 'bounty_875',
        title: 'Creators Corner Sermon & Reels Production',
        budget: '$875.00',
        description: 'Produce high-retention sermon reels, gospel shorts & social clips for a growing creator ministry.',
      },
    },
    {
      key: 'b1297',
      price: '$1,297.00',
      title: 'Kingdom Media Lead',
      rating: '5.0 (38 reviews)',
      tagline: 'Global faith campaign director',
      desc: 'Direct multi-channel evangelism outreach across YouTube, TikTok & Reels.',
      image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80',
      job: {
        id: 'bounty_1297',
        title: 'Kingdom Media Lead Campaign Director',
        budget: '$1,297.00',
        description: 'Direct multi-channel evangelism outreach across YouTube, TikTok & Reels.',
      },
    },
  ];

  return (
    <Screen
      refreshControl={pullRefresh}
      back
      title="Christian Jobs & Tasks"
      subtitle="Faith-Based Work, Freelance & Ministry Gigs"
      right={
        <View style={styles.headerRight}>
          <PressScale
            onPress={openPost}
            accessibilityLabel="Post work"
            scaleTo={0.92}
            style={styles.postNavBtn}
          >
            <PlusIcon size={12} color={colors.primaryFg} />
            <Text style={styles.postNavBtnText}>Post</Text>
          </PressScale>
          {/* Profile avatar is always the right-most header element on main screens */}
          <ProfileButton size={36} />
        </View>
      }
    >
      {/* Opportunities worldwide (external listings) */}
      <FadeInUp distance={10}>
        <OpportunitiesEntryCard onPress={() => nav.push('Opportunities')} style={{ marginTop: 4, marginBottom: 14 }} />
      </FadeInUp>

      {/* Video hero (night surface) */}
      <View style={styles.jobsVideoHero}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={jobsVideoPlayer}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          nativeControls={false}
          contentFit="cover"
        />
        <View style={styles.jobsVideoOverlay} />
        <View style={styles.jobsVideoContent}>
          <View style={styles.jobsVideoTopRow}>
            <View style={styles.jobsTrendingBadge}>
              <LiveRing color={colors.goldLight} size={7} />
              <AnimatedNumber value={openCount} style={styles.jobsTrendingText} />
              <Text style={[styles.jobsTrendingText, { marginLeft: -2 }]}>open {openCount === 1 ? 'listing' : 'listings'}</Text>
            </View>
            <View style={styles.jobsBountyTag}>
              <Text style={styles.jobsBountyTagText}>High bounties</Text>
            </View>
          </View>

          <FadeInUp delay={80} distance={10}>
            <Text style={styles.jobsVideoTitle}>Kingdom creator & tech bounties</Text>
            <Text style={styles.jobsVideoSub}>
              Work with verified global ministries, Christian creators, and gospel enterprises.
            </Text>
          </FadeInUp>

          <View style={styles.jobsVideoStatsRow}>
            <View style={styles.jobsVideoStat}>
              <Icon name="coin" size={13} color={colors.goldLight} />
              <Text style={styles.jobsVideoStatItem}>Escrow payout</Text>
            </View>
            <View style={styles.jobsVideoStat}>
              <Icon name="shield" size={13} color={colors.goldLight} />
              <Text style={styles.jobsVideoStatItem}>Verified believers</Text>
            </View>
            <PressScale onPress={() => setFilterKind('proposals')} style={styles.jobsVideoStat} scaleTo={0.92} hitSlop={6} accessibilityLabel="View my proposals">
              <Icon name="briefcase" size={13} color={colors.goldLight} />
              <Pop trigger={proposals.length} amount={1.3}>
                <AnimatedNumber value={proposals.length} style={[styles.jobsVideoStatItem, { color: colors.goldLight, fontWeight: '700' }]} />
              </Pop>
              <Text style={styles.jobsVideoStatItem}>sent</Text>
            </PressScale>
          </View>
        </View>
      </View>

      {/* Featured Creator Bounties */}
      <View style={styles.sectionHead}>
        <View>
          <Text style={styles.eyebrow}>Featured</Text>
          <Text style={styles.sectionTitle}>Creator bounties</Text>
        </View>
        <Text style={styles.bountySectionSub}>From $875.00</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -18 }}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingBottom: 4 }}
      >
        {bounties.map((b, bi) => {
          const applied = appliedTo(b.job.id);
          const bountyBid = bidOn(b.job.id);
          return (
          <FadeInUp key={b.key} index={bi} delay={120} distance={16}>
          <PressScale onPress={() => openApply(b.job, b.price)} accessibilityLabel={`Bid on ${b.title} bounty`} scaleTo={0.975} style={styles.bountyCard}>
            <Image source={{ uri: b.image }} style={styles.bountyCardBg} />
            <View style={styles.bountyCardScrim} />
            <View style={styles.bountyCardContent}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={styles.bountyPriceBadge}>
                  <Text style={styles.bountyPriceText}>{b.price}</Text>
                </View>
                <View style={styles.bountyRating}>
                  <Icon name="star" size={11} color={colors.goldLight} />
                  <Text style={styles.bountyRatingText}>{b.rating}</Text>
                </View>
              </View>
              <View>
                <Text style={styles.bountyCardTitle}>{b.title}</Text>
                <Text style={styles.bountyCardTagline}>{b.tagline}</Text>
                <Text style={styles.bountyCardDesc} numberOfLines={2}>{b.desc}</Text>
              </View>
              <Pop trigger={!!(applied || bountyBid)} amount={1.06}>
                <View style={[styles.bountyClaimBtn, (applied || bountyBid) && { backgroundColor: colors.goldLight }]}>
                  {bountyBid || applied ? null : <Icon name="coin" size={13} color={colors.gold} />}
                  <Text style={styles.bountyClaimBtnText}>
                    {bountyBid ? `Bid placed · ${bountyBid.coins} coins` : applied ? 'Applied · view status' : `Bid on bounty · ${BID_COST} coins`}
                  </Text>
                  <Icon name={applied || bountyBid ? 'check' : 'arrow-right'} size={13} color={colors.night} strokeWidth={2.4} />
                </View>
              </Pop>
            </View>
          </PressScale>
          </FadeInUp>
          );
        })}
      </ScrollView>

      {/* Marketplace */}
      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Browse opportunities</Text>

      {/* Search Input */}
      <View style={styles.searchBar}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          placeholder="Search jobs, skills (e.g. React, Video, Yoruba)..."
          placeholderTextColor={colors.faint}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
          accessibilityLabel="Search jobs"
          returnKeyType="search"
        />
        {search ? (
          <ScaleIn>
            <PressScale onPress={() => setSearch('')} hitSlop={10} scaleTo={0.85} accessibilityLabel="Clear search" style={styles.clearBtn}>
              <Icon name="x" size={11} color={colors.muted} strokeWidth={2.6} />
            </PressScale>
          </ScaleIn>
        ) : null}
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -18, marginTop: 12 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 18 }}
      >
        {kindTabs.map((t) => (
          <Pill key={t.id} label={t.label} active={filterKind === t.id} onPress={() => setFilterKind(t.id)} />
        ))}
      </ScrollView>

      {/* Categories Horizontal Scroll */}
      {filterKind !== 'proposals' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -18, marginTop: 8 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 18, paddingVertical: 2 }}
        >
          {CATEGORIES.map((cat) => {
            const on = selectedCat === cat;
            return (
              <PressScale
                key={cat}
                onPress={() => setSelectedCat(cat)}
                scaleTo={0.93}
                style={[styles.catPill, on && styles.catPillActive]}
              >
                <Text style={[styles.catPillText, on && styles.catPillTextActive]}>{cat}</Text>
              </PressScale>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Proposals View */}
      {filterKind === 'proposals' ? (
        <View key="proposals" style={{ marginTop: 16 }}>
          {proposals.length ? (
            proposals.map((prop, pi) => (
              <FadeInUp key={prop.id} index={pi} style={styles.jobCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <Text style={[styles.jobTitle, { flex: 1, marginTop: 0 }]}>{prop.jobTitle}</Text>
                  <Badge label={prop.status} tint={colors.primary} />
                </View>
                <View style={styles.propMetaRow}>
                  <View>
                    <Text style={styles.priceLabel}>Your bid</Text>
                    <Text style={styles.priceText}>{prop.bidRate}</Text>
                  </View>
                  <View style={styles.propMetaDivider} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.priceLabel}>Timeline</Text>
                    <Text style={styles.propMetaValue}>{prop.deliveryTime}</Text>
                  </View>
                </View>
                <View style={styles.coverQuote}>
                  <Text style={styles.coverQuoteText} numberOfLines={2}>“{prop.coverNote}”</Text>
                </View>
                {bidOn(prop.jobId) ? (
                  <View style={styles.bidPlacedRow}>
                    <Icon name="coin" size={13} color={colors.gold} />
                    <Text style={styles.bidPlacedRowText}>Bid placed · {bidOn(prop.jobId).coins} coins</Text>
                  </View>
                ) : null}
                <View style={styles.propFooter}>
                  <Text style={[styles.jobTimeText, { marginTop: 0, flex: 1 }]}>Submitted {prop.time}</Text>
                  {confirmWithdraw === prop.id ? (
                    <FadeInUp distance={0} duration={200} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      <Button small kind="ghost" label="Keep" onPress={() => setConfirmWithdraw(null)} />
                      <Button small kind="danger" label="Withdraw" onPress={() => withdraw(prop)} />
                    </FadeInUp>
                  ) : (
                    <PressScale onPress={() => setConfirmWithdraw(prop.id)} hitSlop={8} scaleTo={0.92}>
                      <Text style={styles.withdrawText}>Withdraw</Text>
                    </PressScale>
                  )}
                </View>
              </FadeInUp>
            ))
          ) : (
            <FadeInUp style={styles.emptyCard}>
              <ScaleIn delay={100} style={styles.emptyIcon}>
                <Icon name="briefcase" size={20} color={colors.primary} />
              </ScaleIn>
              <Text style={styles.emptyTitle}>No proposals yet</Text>
              <Text style={styles.emptyBody}>You haven't submitted any proposals yet. Browse opportunities and submit your pitch!</Text>
              <Button small label="Browse opportunities" style={{ marginTop: 14 }} onPress={() => setFilterKind('all')} />
            </FadeInUp>
          )}
        </View>
      ) : (
        /* Jobs List */
        // Keyed on the filters so switching kind/category cross-fades the list in (search typing doesn't re-run it).
        <View key={`${filterKind}|${selectedCat}`} style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
            <AnimatedNumber value={filteredJobs.length} style={[styles.resultsCount, { marginBottom: 0 }]} duration={420} />
            <Text style={[styles.resultsCount, { marginBottom: 0 }]}>{filteredJobs.length === 1 ? 'opportunity' : 'opportunities'}</Text>
          </View>
          {filteredJobs.map((item, idx) => {
            const applied = appliedTo(item.id);
            const bid = bidOn(item.id);
            const closed = item.status === 'closed';
            return (
            <FadeInUp key={item.id} index={idx} distance={12} duration={380}>
            <PressScale
              onPress={() => openApply(item)}
              scaleTo={0.985}
              style={styles.jobCard}
            >
              <View style={styles.jobTopRow}>
                <Badge label={item.kind === 'job' ? 'Job' : 'Task'} tint={item.kind === 'job' ? colors.primary : colors.teal} />
                <Text style={styles.categorySubText} numberOfLines={1}>{item.category}</Text>
                {item.mine ? <Badge label="Your listing" tint={colors.gold} /> : null}
                {closed ? <Badge label="Closed" tint={colors.muted} /> : null}
              </View>

              <Text style={styles.jobTitle}>{item.title}</Text>

              <View style={styles.clientRow}>
                <View style={styles.clientAvatar}>
                  <Text style={styles.clientAvatarText}>{(item.client?.name || '?')[0]}</Text>
                </View>
                <Text style={styles.clientText} numberOfLines={1}>
                  <Text style={styles.clientName}>{item.client.name}</Text>{item.client.church ? ` · ${item.client.church}` : null}
                </Text>
                {item.client?.verified ? <Icon name="check" size={13} color={colors.positive} strokeWidth={2.6} /> : null}
              </View>

              <Text style={styles.jobDesc} numberOfLines={2}>{item.description}</Text>

              {/* Skills Tags */}
              {item.skills?.length ? (
                <View style={styles.skillsRow}>
                  {item.skills.map((s, idx) => (
                    <View key={idx} style={styles.skillChip}>
                      <Text style={styles.skillText}>{s}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Footer: pricing + meta */}
              <View style={styles.jobFooter}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.priceText} numberOfLines={1}>{item.budget}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text style={styles.proposalsCountText} numberOfLines={1}>{item.deadline}{'\u00A0·\u00A0'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <AnimatedNumber value={item.proposalsCount || 0} style={styles.proposalsCountText} />
                      <Text style={styles.proposalsCountText} numberOfLines={1}>{'\u00A0'}{item.proposalsCount === 1 ? 'proposal' : 'proposals'}</Text>
                    </View>
                  </View>
                </View>
                {item.mine ? (
                  <View style={[styles.applyChip, styles.applyChipQuiet]}>
                    <Text style={[styles.applyChipText, { color: colors.primary }]}>Manage</Text>
                  </View>
                ) : bid ? (
                  // Paid bids replace the bid button (even if the proposal was later withdrawn)
                  <ScaleIn key="bid" style={[styles.applyChip, styles.bidPlacedChip]}>
                    <Icon name="check" size={13} color={colors.goldMuted} strokeWidth={2.6} />
                    <Text style={[styles.applyChipText, { color: colors.goldMuted }]}>Bid placed · {bid.coins} coins</Text>
                  </ScaleIn>
                ) : applied ? (
                  <ScaleIn key="applied" style={[styles.applyChip, styles.applyChipQuiet]}>
                    <Icon name="check" size={13} color={colors.primary} strokeWidth={2.6} />
                    <Text style={[styles.applyChipText, { color: colors.primary }]}>Applied</Text>
                  </ScaleIn>
                ) : closed ? (
                  <View style={[styles.applyChip, styles.applyChipQuiet]}>
                    <Text style={[styles.applyChipText, { color: colors.muted }]}>Closed</Text>
                  </View>
                ) : (
                  <View style={styles.applyChip}>
                    <Text style={styles.applyChipText}>Bid</Text>
                    <View style={styles.applyChipCost}>
                      <Icon name="coin" size={11} color={colors.goldLight} />
                      <Text style={styles.applyChipCostText}>{BID_COST}</Text>
                    </View>
                  </View>
                )}
              </View>
            </PressScale>
            </FadeInUp>
            );
          })}
          {!filteredJobs.length ? (
            <ScaleIn style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Icon name="search" size={20} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyBody}>Try another category or search term.</Text>
              <Button
                small
                kind="ghost"
                label="Clear filters"
                style={{ marginTop: 14 }}
                onPress={() => { setSearch(''); setSelectedCat('All'); setFilterKind('all'); }}
              />
            </ScaleIn>
          ) : null}
        </View>
      )}

      {/* Apply / Proposal Submission Modal */}
      <AnimatedModal visible={showApplyModal} onRequestClose={() => setShowApplyModal(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowApplyModal(false)} accessibilityLabel="Dismiss" />
          <View style={styles.applySheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.eyebrow}>
                  {selectedJob?.mine
                    ? 'Manage listing'
                    : selectedJob && appliedTo(selectedJob.id)
                      ? (bidOn(selectedJob.id) ? 'Your bid' : 'Your proposal')
                      : applyStep === 'bid' ? 'Step 2 of 2 · bid fee' : 'Your proposal · step 1 of 2'}
                </Text>
                <Text style={styles.sheetTitle} numberOfLines={2}>{applyStep === 'bid' && selectedJob && !appliedTo(selectedJob.id) ? 'Place your bid' : selectedJob?.title}</Text>
              </View>
              <CloseButton onPress={() => setShowApplyModal(false)} />
            </View>

            <ScrollView ref={applyScroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {applyStep === 'bid' && selectedJob && !selectedJob.mine && !appliedTo(selectedJob.id) ? (
                <BidGate
                  key={`gate-${selectedJob.id}`}
                  job={selectedJob}
                  proposal={{ bidRate: bidRate.trim(), deliveryTime: deliveryTime.trim() || 'Flexible' }}
                  coins={coins}
                  credits={adCredits}
                  adsNeeded={ADS_NEEDED}
                  adBusy={adBusy}
                  celebrating={celebrating}
                  unlockFx={unlockFx}
                  onPay={payAndBid}
                  onWatchAd={watchBidAd}
                  onBuy={buyBidCoins}
                  onEdit={() => { haptic('select'); setApplyStep('form'); }}
                />
              ) : (
              <>
              <View style={styles.clientInfoBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={[styles.clientAvatar, { width: 34, height: 34, borderRadius: 17 }]}>
                    <Icon name={selectedJob?.client ? 'church' : 'star'} size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.clientInfoTitle} numberOfLines={1}>
                      {selectedJob?.client?.name ? `Client: ${selectedJob.client.name}` : 'Featured creator bounty'}
                    </Text>
                    {selectedJob?.category ? <Text style={styles.clientInfoSub} numberOfLines={1}>{selectedJob.category}</Text> : null}
                  </View>
                </View>
                <View style={styles.clientBudgetRow}>
                  <Text style={styles.priceLabel}>Budget</Text>
                  <Text style={styles.priceText}>{selectedJob?.budget}</Text>
                </View>
                {selectedJob?.description ? <Text style={styles.clientInfoDesc}>{selectedJob.description}</Text> : null}
              </View>

              {selectedJob?.mine ? (
                <View style={styles.statusBox}>
                  <Text style={styles.statusBoxTitle}>Your listing</Text>
                  <Text style={styles.statusBoxBody}>
                    {selectedJob.proposalsCount || 0} {selectedJob.proposalsCount === 1 ? 'proposal' : 'proposals'} received · {selectedJob.status === 'closed' ? 'closed to new proposals' : 'open'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                    <Button small kind="ghost" label="Share" style={{ flex: 1 }} icon={<Icon name="share" size={13} color={colors.fg} />} onPress={() => shareJob(selectedJob)} />
                    <Button small kind="ghost" label={selectedJob.status === 'closed' ? 'Reopen listing' : 'Close listing'} style={{ flex: 1 }} onPress={() => closeListing(selectedJob)} />
                  </View>
                </View>
              ) : selectedJob && appliedTo(selectedJob.id) ? (
                <ScaleIn key={justApplied === selectedJob.id ? 'sent' : 'status'} from={justApplied === selectedJob.id ? 0.8 : 0.96} style={styles.statusBox}>
                  {justApplied === selectedJob.id ? (
                    <View style={styles.sentHero}>
                      <View style={styles.sentIcon}>
                        <Icon name="check" size={22} color={colors.night} strokeWidth={2.8} />
                        <Burst trigger={sentBurst} count={12} radius={52} size={12} />
                      </View>
                      <Text style={styles.sentTitle}>{bidOn(selectedJob.id) ? 'Bid placed' : 'Proposal sent'}</Text>
                      <Text style={styles.sentSub}>{selectedJob.client?.name ? `${selectedJob.client.name} will review your pitch.` : 'The creator will review your pitch.'}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Icon name="check" size={15} color={colors.positive} strokeWidth={2.6} />
                    <Text style={styles.statusBoxTitle}>Proposal submitted</Text>
                  </View>
                  <Text style={styles.statusBoxBody}>
                    Your bid of {appliedTo(selectedJob.id).bidRate} is {String(appliedTo(selectedJob.id).status).toLowerCase()}. You’ll be notified when the client responds.
                  </Text>
                  {bidOn(selectedJob.id) ? (
                    <View style={[styles.bidPlacedRow, { alignSelf: 'flex-start' }]}>
                      <Icon name="coin" size={13} color={colors.gold} />
                      <Text style={styles.bidPlacedRowText}>Bid placed · {bidOn(selectedJob.id).coins} coins</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                    <Button small kind="ghost" label="Share" style={{ flex: 1 }} icon={<Icon name="share" size={13} color={colors.fg} />} onPress={() => shareJob(selectedJob)} />
                    <Button small label="My proposals" style={{ flex: 1 }} onPress={() => { setShowApplyModal(false); setFilterKind('proposals'); }} />
                  </View>
                </ScaleIn>
              ) : selectedJob?.status === 'closed' ? (
                <View style={styles.statusBox}>
                  <Text style={styles.statusBoxTitle}>This listing is closed</Text>
                  <Text style={styles.statusBoxBody}>The client is no longer accepting proposals.</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.formLabel}>Your proposed rate / price</Text>
                  <TextInput
                    placeholder="e.g. $250 or $35/hr"
                    placeholderTextColor={colors.faint}
                    value={bidRate}
                    onChangeText={(v) => { setBidRate(v); if (applyErrors.bid) setApplyErrors({ ...applyErrors, bid: null }); }}
                    style={[styles.formInput, applyErrors.bid && styles.formInputError]}
                    accessibilityLabel="Proposed rate"
                  />
                  <FieldError text={applyErrors.bid} />

                  <Text style={styles.formLabel}>Estimated delivery timeline</Text>
                  <TextInput
                    placeholder="e.g. 3 business days"
                    placeholderTextColor={colors.faint}
                    value={deliveryTime}
                    onChangeText={setDeliveryTime}
                    style={styles.formInput}
                    accessibilityLabel="Delivery timeline"
                  />

                  <Text style={styles.formLabel}>Cover letter & ministry portfolio</Text>
                  <TextInput
                    placeholder="Explain why you are well suited for this project..."
                    placeholderTextColor={colors.faint}
                    value={coverNote}
                    onChangeText={(v) => { setCoverNote(v); if (applyErrors.cover) setApplyErrors({ ...applyErrors, cover: null }); }}
                    multiline
                    style={[styles.formInput, styles.formInputMulti, applyErrors.cover && styles.formInputError]}
                    accessibilityLabel="Cover note"
                  />
                  <FieldError text={applyErrors.cover} />

                  {/* What happens next: the bid fee (or "already paid" if they withdrew earlier) */}
                  {bidOn(selectedJob?.id) ? (
                    <View style={styles.bidHint}>
                      <Icon name="check" size={14} color={colors.positive} strokeWidth={2.6} />
                      <Text style={styles.bidHintText}>
                        <Text style={styles.bidHintStrong}>Bid already paid.</Text> Resubmitting this proposal is free.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.bidHint}>
                      <Icon name="coin" size={14} color={colors.gold} />
                      <Text style={styles.bidHintText}>
                        Bidding costs <Text style={styles.bidHintStrong}>{BID_COST} coins</Text> or {ADS_NEEDED} short ads. You have{' '}
                        <Text style={styles.bidHintStrong}>{coins}</Text>.
                      </Text>
                    </View>
                  )}

                  <Button
                    label={bidOn(selectedJob?.id) ? 'Resubmit proposal' : 'Continue to bid'}
                    onPress={handleApply}
                    style={{ marginTop: 14 }}
                    icon={bidOn(selectedJob?.id) ? null : <Icon name="coin" size={15} color={colors.goldLight} />}
                  />
                </>
              )}
              </>
              )}
            </ScrollView>
          </View>
        </View>
      </AnimatedModal>

      {/* Post Job / Task Modal */}
      <AnimatedModal visible={showPostModal} onRequestClose={() => setShowPostModal(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowPostModal(false)} accessibilityLabel="Dismiss" />
          <View style={styles.applySheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.eyebrow}>Hire verified believers</Text>
                <Text style={styles.sheetTitle}>Post a job or task</Text>
              </View>
              <CloseButton onPress={() => setShowPostModal(false)} />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <Text style={[styles.formLabel, { marginTop: 4 }]}>Type of listing</Text>
              <View style={styles.segment}>
                <PressScale
                  onPress={() => setPostKind('task')}
                  scaleTo={0.96}
                  style={[styles.segmentBtn, postKind === 'task' && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentText, postKind === 'task' && styles.segmentTextActive]}>Fixed task / project</Text>
                </PressScale>
                <PressScale
                  onPress={() => setPostKind('job')}
                  scaleTo={0.96}
                  style={[styles.segmentBtn, postKind === 'job' && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentText, postKind === 'job' && styles.segmentTextActive]}>Job vacancy</Text>
                </PressScale>
              </View>

              <Text style={styles.formLabel}>Job / task title</Text>
              <TextInput
                placeholder="e.g. Build a church website or Edit sermon videos"
                placeholderTextColor={colors.faint}
                value={postTitle}
                onChangeText={(v) => { setPostTitle(v); if (postErrors.title) setPostErrors({ ...postErrors, title: null }); }}
                style={[styles.formInput, postErrors.title && styles.formInputError]}
                accessibilityLabel="Listing title"
              />
              <FieldError text={postErrors.title} />

              <Text style={styles.formLabel}>Category</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -18 }}
                contentContainerStyle={{ gap: 6, paddingHorizontal: 18 }}
              >
                {CATEGORIES.slice(1).map((c) => {
                  const on = postCategory === c;
                  return (
                    <PressScale
                      key={c}
                      onPress={() => setPostCategory(c)}
                      scaleTo={0.93}
                      style={[styles.catPill, styles.catPillSheet, on && styles.catPillActive]}
                    >
                      <Text style={[styles.catPillText, on && styles.catPillTextActive]}>{c}</Text>
                    </PressScale>
                  );
                })}
              </ScrollView>

              <Text style={styles.formLabel}>Budget & payment arrangement</Text>
              <TextInput
                placeholder="e.g. $300 Fixed or $25/hr"
                placeholderTextColor={colors.faint}
                value={postBudget}
                onChangeText={(v) => { setPostBudget(v); if (postErrors.budget) setPostErrors({ ...postErrors, budget: null }); }}
                style={[styles.formInput, postErrors.budget && styles.formInputError]}
                accessibilityLabel="Listing budget"
              />
              <FieldError text={postErrors.budget} />

              <Text style={styles.formLabel}>Deadline / timeframe</Text>
              <TextInput
                placeholder="e.g. 7 Days or Full-time"
                placeholderTextColor={colors.faint}
                value={postDeadline}
                onChangeText={setPostDeadline}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Required skills (comma-separated)</Text>
              <TextInput
                placeholder="e.g. React Native, Video Editing, Yoruba"
                placeholderTextColor={colors.faint}
                value={postSkills}
                onChangeText={setPostSkills}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Detailed project scope</Text>
              <TextInput
                placeholder="Describe deliverables, expectations, and church background..."
                placeholderTextColor={colors.faint}
                value={postDesc}
                onChangeText={setPostDesc}
                multiline
                style={[styles.formInput, styles.formInputMulti]}
              />

              {/* Posting is free — the coin fee is paid by bidders */}
              <View style={styles.bidHint}>
                <Icon name="coin" size={14} color={colors.gold} />
                <Text style={styles.bidHintText}>
                  <Text style={styles.bidHintStrong}>Posting is free.</Text> Bidders pay {BID_COST} coins or watch {ADS_NEEDED} ads to bid — this keeps proposals serious.
                </Text>
              </View>

              <Button
                label="Publish Listing"
                onPress={handlePostJob}
                style={{ marginTop: 14 }}
              />
            </ScrollView>
          </View>
        </View>
      </AnimatedModal>
      <CareerPrayerCard />
    </Screen>
  );
}

function PlusIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    </Svg>
  );
}

// "Place your bid" — step 2 of applying. Two ways to cover the fee: pay coins, or watch rewarded ads to unlock coins.
function BidGate({ job, proposal, coins, credits, adsNeeded, adBusy, celebrating, unlockFx, onPay, onWatchAd, onBuy, onEdit }) {
  const ADS_NEEDED = adsNeeded || ADS_NEEDED_DEFAULT;
  const enough = coins >= BID_COST;
  const short = Math.max(0, BID_COST - coins);
  const lit = celebrating ? ADS_NEEDED : credits; // dots shown filled (all 5 during the unlock celebration)
  const adLabel = adBusy ? 'Ad playing…' : `Watch ad ${Math.min(credits + 1, ADS_NEEDED)} of ${ADS_NEEDED}`;

  return (
    <View>
      {/* Proposal summary — the pitch they're about to send */}
      <FadeInUp distance={8} style={styles.gateSummary}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.priceLabel}>Your proposal</Text>
          <Text style={styles.gateSummaryJob} numberOfLines={1}>{job.title}</Text>
          <Text style={styles.gateSummaryMeta} numberOfLines={1}>
            <Text style={{ color: colors.fg, fontWeight: '700' }}>{proposal.bidRate}</Text> · {proposal.deliveryTime}
          </Text>
        </View>
        <PressScale onPress={onEdit} scaleTo={0.92} hitSlop={8} style={styles.gateEditBtn} accessibilityLabel="Edit proposal">
          <Icon name="edit" size={13} color={colors.primary} />
          <Text style={styles.gateEditText}>Edit</Text>
        </PressScale>
      </FadeInUp>

      {/* Path A — pay coins */}
      <FadeInUp index={1} distance={10} style={styles.gateCard}>
        <View style={styles.gateBalanceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.priceLabel}>Your balance</Text>
            <View style={styles.gateCoinsRow}>
              <View style={styles.gateCoinDot}><Icon name="coin" size={15} color={colors.goldMuted} /></View>
              <Pop trigger={coins} amount={1.15}>
                <AnimatedNumber value={coins} style={styles.gateCoinsValue} />
              </Pop>
              <Text style={styles.gateCoinsUnit}>coins</Text>
            </View>
          </View>
          <View style={styles.gateFeeBox}>
            <Text style={styles.priceLabel}>Bid fee</Text>
            <Text style={styles.gateFeeValue}>{BID_COST} coins</Text>
          </View>
        </View>

        {enough ? (
          <Text style={styles.gateNote}>After bidding you’ll have {coins - BID_COST} coins. The fee is charged once per job.</Text>
        ) : (
          <ScaleIn from={0.96} style={styles.gateShort}>
            <Icon name="lock" size={13} color={colors.negative} />
            <Text style={styles.gateShortText}>You need {short} more {short === 1 ? 'coin' : 'coins'} to bid — watch ads below to unlock {AD_COINS} free.</Text>
          </ScaleIn>
        )}

        <Pop trigger={enough} amount={1.04}>
          <Button
            label={enough ? `Pay ${BID_COST} coins & bid` : `Need ${short} more coins`}
            onPress={onPay}
            disabled={!enough}
            style={{ marginTop: 14 }}
            icon={<Icon name={enough ? 'coin' : 'lock'} size={15} color={enough ? colors.goldLight : colors.primaryFg} />}
          />
        </Pop>
      </FadeInUp>

      <View style={styles.gateOr}>
        <View style={styles.gateOrLine} />
        <Text style={styles.gateOrText}>or unlock coins for free</Text>
        <View style={styles.gateOrLine} />
      </View>

      {/* Path B — watch 5 rewarded ads to unlock 20 coins (progress persists in the store) */}
      <FadeInUp index={2} distance={10} style={[styles.gateCard, !enough && styles.gateCardHighlight]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={styles.gateAdIcon}><Icon name="play" size={16} color={colors.goldMuted} fill="solid" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.gateAdTitle}>Watch {ADS_NEEDED} ads to unlock {AD_COINS} coins</Text>
              {!enough ? <Badge label="Recommended" tint={colors.gold} /> : null}
            </View>
            <Text style={styles.gateAdBody}>Short ads keep BibleNestra free for everyone ✨ Your progress is saved — leave and come back anytime.</Text>
          </View>
        </View>

        {/* N-step progress (N = jobs.bid_required_ads, 2 by default) */}
        <View style={styles.dotsRow} accessibilityLabel={`${lit} of ${ADS_NEEDED} ads watched`}>
          {Array.from({ length: ADS_NEEDED }).map((_, i) => {
            const done = i < lit;
            const next = !celebrating && i === credits;
            return (
              <React.Fragment key={i}>
                {i > 0 ? <View style={[styles.dotLine, i < lit && styles.dotLineDone]} /> : null}
                <Pop trigger={done} amount={1.25}>
                  {next ? (
                    <Pulse min={0.94} max={1.06} active={!adBusy}>
                      <View style={[styles.dot, styles.dotNext]}><Text style={[styles.dotNum, { color: colors.primary }]}>{i + 1}</Text></View>
                    </Pulse>
                  ) : (
                    <View style={[styles.dot, done && styles.dotDone]}>
                      {done ? <Icon name="check" size={13} color={colors.night} strokeWidth={2.8} /> : <Text style={styles.dotNum}>{i + 1}</Text>}
                    </View>
                  )}
                </Pop>
              </React.Fragment>
            );
          })}
        </View>

        <View style={{ position: 'relative', alignItems: 'center' }}>
          {/* Burst stays mounted so it fires when unlockFx changes (it ignores its first value) */}
          <Burst trigger={unlockFx} count={14} radius={70} size={13} />
          {celebrating ? (
            <ScaleIn key={`unlock-${unlockFx}`} from={0.6} style={styles.unlockChip}>
              <Icon name="coin" size={15} color={colors.night} />
              <Text style={styles.unlockChipText}>+{AD_COINS} coins unlocked</Text>
            </ScaleIn>
          ) : (
            <Text style={styles.dotsCaption}>
              {credits ? `${credits} of ${ADS_NEEDED} ads watched · ${ADS_NEEDED - credits} to go` : `0 of ${ADS_NEEDED} ads watched`}
            </Text>
          )}
        </View>

        <Button
          label={adLabel}
          onPress={onWatchAd}
          disabled={adBusy}
          kind={enough ? 'ghost' : 'primary'}
          style={{ marginTop: 12 }}
          icon={<Icon name="play" size={13} color={enough ? colors.fg : colors.primaryFg} fill="solid" />}
        />
      </FadeInUp>

      {/* Path C — top up the wallet (same simulated purchase the Profile wallet uses) */}
      <FadeInUp index={3} distance={10} style={styles.gateBuyRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.gateBuyTitle}>Short on time?</Text>
          <Text style={styles.gateBuySub}>Top up your Kingdom Wallet instead.</Text>
        </View>
        <Button small kind="ghost" label={`Buy ${TOPUP_COINS} coins`} onPress={onBuy} icon={<Icon name="coin" size={13} color={colors.gold} />} />
      </FadeInUp>
    </View>
  );
}

function CloseButton({ onPress }) {
  return (
    <PressScale onPress={onPress} hitSlop={12} scaleTo={0.88} accessibilityLabel="Close" style={styles.closeBtn}>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <Path d="M6 6l12 12M18 6L6 18" stroke={colors.fg} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
    </PressScale>
  );
}

const EYEBROW = { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' };

const styles = StyleSheet.create({
  eyebrow: { ...EYEBROW, color: colors.gold },
  postNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    paddingHorizontal: 11,
    height: 34,
    borderRadius: 18,
    ...shadow.sm,
  },
  postNavBtnText: { fontSize: 13, fontWeight: '700', color: colors.primaryFg },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  // ---- Bid fee hints & states
  bidHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 20,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: alpha(colors.gold, 0.08),
    borderWidth: 1,
    borderColor: alpha(colors.gold, 0.18),
  },
  bidHintText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  bidHintStrong: { color: colors.fg, fontWeight: '700' },
  bidPlacedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: colors.cardGold,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  bidPlacedRowText: { fontSize: 12, fontWeight: '700', color: colors.goldMuted },
  bidPlacedChip: { backgroundColor: colors.cardGold, paddingHorizontal: 11, gap: 4 },
  applyChipCost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  applyChipCostText: { color: colors.goldLight, fontSize: 12, fontWeight: '800' },

  // ---- Bid gate
  gateSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.raised,
  },
  gateSummaryJob: { fontFamily: fonts.serifBold, fontSize: 15.5, color: colors.fg, letterSpacing: -0.2 },
  gateSummaryMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  gateEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gateEditText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  gateCard: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    ...shadow.sm,
  },
  gateCardHighlight: { borderColor: colors.goldLight, borderWidth: 1.5, ...shadow.md },
  gateBalanceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  gateCoinsRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  gateCoinDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  gateCoinsValue: { fontFamily: fonts.serifBold, fontSize: 30, color: colors.fg, letterSpacing: -0.6 },
  gateCoinsUnit: { fontSize: 13, color: colors.muted, marginTop: 6 },
  gateFeeBox: { alignItems: 'flex-end', paddingBottom: 4 },
  gateFeeValue: { fontSize: 16, fontWeight: '800', color: colors.goldMuted },
  gateNote: { fontSize: 12.5, color: colors.muted, marginTop: 10, lineHeight: 18 },
  gateShort: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.negativeFaint,
  },
  gateShortText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.negative, fontWeight: '600' },
  gateOr: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 4 },
  gateOrLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  gateOrText: { ...EYEBROW, fontSize: 9.5, color: colors.faint },
  gateAdIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.cardGold, alignItems: 'center', justifyContent: 'center' },
  gateAdTitle: { fontFamily: fonts.serifBold, fontSize: 16.5, lineHeight: 21, color: colors.fg, letterSpacing: -0.2, flexShrink: 1 },
  gateAdBody: { fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 4 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 10, paddingHorizontal: 4 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotNext: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dotDone: { borderColor: colors.goldLight, backgroundColor: colors.goldLight },
  dotNum: { fontSize: 12, fontWeight: '700', color: colors.faint },
  dotLine: { flex: 1, height: 2, marginHorizontal: 4, borderRadius: 1, backgroundColor: colors.border },
  dotLineDone: { backgroundColor: colors.goldLight },
  dotsCaption: { fontSize: 12, fontWeight: '600', color: colors.muted, paddingVertical: 6 },
  unlockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.goldLight,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    ...shadow.md,
  },
  unlockChipText: { fontSize: 13.5, fontWeight: '800', color: colors.night },
  gateBuyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  gateBuyTitle: { fontSize: 13.5, fontWeight: '700', color: colors.fg },
  gateBuySub: { fontSize: 12, color: colors.muted, marginTop: 1 },

  // ---- Hero
  jobsVideoHero: {
    height: 214,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 4,
    backgroundColor: colors.night,
    ...shadow.md,
  },
  jobsVideoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,23,43,0.68)' },
  jobsVideoContent: { flex: 1, padding: 18, justifyContent: 'space-between' },
  jobsVideoTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobsTrendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  jobsLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.goldLight },
  jobsTrendingText: { ...EYEBROW, fontSize: 9.5, color: colors.nightFg },
  jobsBountyTag: {
    backgroundColor: 'rgba(212,168,82,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  jobsBountyTagText: { ...EYEBROW, fontSize: 9.5, color: colors.goldLight },
  jobsVideoTitle: { color: colors.nightFg, fontFamily: fonts.serifBold, fontSize: 24, lineHeight: 29, letterSpacing: -0.4 },
  jobsVideoSub: { color: colors.nightMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  jobsVideoStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.nightBorder,
    paddingTop: 12,
  },
  jobsVideoStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  jobsVideoStatItem: { color: colors.nightFg, fontSize: 11.5, fontWeight: '500' },

  // ---- Section heads
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 28, marginBottom: 12 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 21, letterSpacing: -0.3, color: colors.fg, marginTop: 2 },
  bountySectionSub: { fontSize: 12.5, color: colors.gold, fontWeight: '700', marginBottom: 3 },

  // ---- Bounties
  bountyCard: {
    width: 268,
    height: 206,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.night,
    ...shadow.md,
  },
  bountyCardBg: { ...StyleSheet.absoluteFillObject },
  bountyCardScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.58)' },
  bountyCardContent: { flex: 1, padding: 14, justifyContent: 'space-between' },
  bountyPriceBadge: { backgroundColor: colors.goldLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  bountyPriceText: { color: colors.night, fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  bountyRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bountyRatingText: { color: 'rgba(255,255,255,0.85)', fontSize: 11 },
  bountyCardTitle: { color: '#FFFFFF', fontFamily: fonts.serifBold, fontSize: 20, letterSpacing: -0.3 },
  bountyCardTagline: { ...EYEBROW, fontSize: 9.5, color: colors.goldLight, marginTop: 4 },
  bountyCardDesc: { color: 'rgba(255,255,255,0.78)', fontSize: 12, marginTop: 5, lineHeight: 16 },
  bountyClaimBtn: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#FFFFFF',
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bountyClaimBtnText: { color: colors.night, fontSize: 12.5, fontWeight: '700' },

  // ---- Search & filters
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    height: 46,
    marginTop: 12,
    ...shadow.sm,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.fg, paddingVertical: 0, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  catPill: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  catPillActive: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  catPillSheet: { backgroundColor: colors.surface, borderColor: colors.border },
  clearBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  sentHero: { alignItems: 'center', paddingBottom: 16, marginBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  sentIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center', ...shadow.md },
  sentTitle: { fontFamily: fonts.serifBold, fontSize: 22, letterSpacing: -0.3, color: colors.fg, marginTop: 12 },
  sentSub: { fontSize: 13, color: colors.muted, marginTop: 3, textAlign: 'center' },
  catPillText: { fontSize: 12.5, color: colors.muted, fontWeight: '500' },
  catPillTextActive: { color: colors.primary, fontWeight: '700' },
  resultsCount: { ...EYEBROW, color: colors.muted, marginBottom: 10 },

  // ---- Listing cards
  jobCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...shadow.sm,
  },
  jobTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categorySubText: { flex: 1, fontSize: 11.5, color: colors.faint },
  jobTitle: { fontFamily: fonts.serifBold, fontSize: 18.5, lineHeight: 24, letterSpacing: -0.3, color: colors.fg, marginTop: 10 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  clientAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  clientAvatarText: { fontSize: 10.5, fontWeight: '700', color: colors.primary },
  clientText: { flexShrink: 1, fontSize: 12.5, color: colors.muted },
  clientName: { color: colors.fg, fontWeight: '600' },
  jobDesc: { fontSize: 13.5, color: colors.muted, lineHeight: 19.5, marginTop: 10 },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  skillChip: { backgroundColor: colors.raised, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  skillText: { fontSize: 11.5, color: colors.fg, fontWeight: '500' },
  jobFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  priceLabel: { ...EYEBROW, fontSize: 9.5, color: colors.faint, marginBottom: 2 },
  priceText: { fontSize: 16, fontWeight: '800', color: colors.fg, letterSpacing: -0.2 },
  proposalsCountText: { fontSize: 11.5, color: colors.faint, marginTop: 2 },
  applyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
  },
  applyChipText: { color: colors.primaryFg, fontSize: 13, fontWeight: '700' },

  // ---- Proposals
  propMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.screen,
  },
  propMetaDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  propMetaValue: { fontSize: 13.5, fontWeight: '600', color: colors.fg },
  coverQuote: { marginTop: 12, borderLeftWidth: 2, borderLeftColor: colors.goldLight, paddingLeft: 10 },
  coverQuoteText: { fontFamily: fonts.serifItalic, fontSize: 14.5, lineHeight: 20, color: colors.passage },
  jobTimeText: { fontSize: 11.5, color: colors.faint, marginTop: 10 },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  emptyIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, marginTop: 12 },
  emptyBody: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19, marginTop: 4, maxWidth: 270 },

  // ---- Modal sheets
  modalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  applySheet: {
    backgroundColor: colors.screen,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    height: '86%',
    ...shadow.lg,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 27, letterSpacing: -0.3, color: colors.fg, marginTop: 3 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientInfoBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 6,
    ...shadow.sm,
  },
  clientInfoTitle: { fontSize: 14, fontWeight: '700', color: colors.fg },
  clientInfoSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  clientBudgetRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  clientInfoDesc: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 10 },
  formLabel: { ...EYEBROW, color: colors.muted, marginTop: 18, marginBottom: 8 },
  formInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 14.5,
    color: colors.fg,
  },
  formInputError: { borderColor: colors.negative },
  fieldError: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7, marginLeft: 4 },
  fieldErrorText: { fontSize: 12.5, color: colors.negative, fontWeight: '600', flexShrink: 1 },
  statusBox: {
    marginTop: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    ...shadow.sm,
  },
  statusBoxTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.fg, letterSpacing: -0.2 },
  statusBoxBody: { fontSize: 13.5, color: colors.muted, lineHeight: 19.5, marginTop: 6 },
  applyChipQuiet: { backgroundColor: colors.primarySoft },
  propFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  withdrawText: { fontSize: 12.5, fontWeight: '600', color: colors.negative },
  formInputMulti: { minHeight: 104, textAlignVertical: 'top', lineHeight: 20 },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  segmentBtn: { flex: 1, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  segmentBtnActive: { backgroundColor: colors.surface, ...shadow.sm },
  segmentText: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  segmentTextActive: { color: colors.primary, fontWeight: '700' },
});
