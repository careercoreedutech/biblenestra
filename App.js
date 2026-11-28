import React, { Component, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Dimensions, Easing, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { StoreProvider, useStore } from './src/store';
import { NavProvider, useNav, FocusCtx, EXIT_MS } from './src/navigation';
import TabBar from './src/components/TabBar';
import { applyDesignFonts } from './src/design/globalFont'; // FIGMA DESIGN: DM Sans for all interface text
applyDesignFonts();
import MiniPlayer from './src/components/MiniPlayer';
import NowPlayingSheet from './src/components/NowPlayingSheet';
import { ToastProvider } from './src/components/Toast';
import { NarrationProvider } from './src/audio/Narration';
import { AdsProvider, useAds } from './src/ads/Ads';
import { useAdBreaks } from './src/ads/breaks'; // INTERSTITIAL BREAKS (dev update v1, item 4)
import { AdsBridge } from './src/ads/AdsBridge'; // ADS: authenticated transport for ad event logging
import { AuthGate } from './src/api/auth';
import { IntroGate } from './src/screens/IntroScreens';
import { ExtraBooksScreen, ExtraBookScreen } from './src/screens/ExtraBooksScreens'; // BEYOND THE 66
import { WebsitesScreen, AddWebsiteScreen, WebsiteViewerScreen } from './src/screens/WebsitesScreens'; // MEMBER WEBSITES
import { WebsiteFeedScreen, WebsiteArticleScreen, WebsiteIntegrationScreen, WebsiteComposerScreen } from './src/screens/WebsiteIntegrationScreens'; // WEBSITE INTEGRATION
import EngagementPopup from './src/components/EngagementPopup';
import { ChatLimitHost, useInviteLinks } from './src/components/ChatLimit'; // CHAT LIMITS: upgrade/invite prompt on CHAT_LIMIT_REACHED + invite deep links
import InviteFriendsScreen from './src/screens/InviteFriendsScreen'; // CHAT LIMITS: Invite friends (invited friends are unlimited)
import { PlansScreen, PlansGate } from './src/screens/PlansScreen';
import { ContestsScreen, ContestScreen, ContestEntryScreen, ContestSubmitScreen, CertificateScreen } from './src/screens/ContestsScreens';
import { ContestOrganizeScreen, ContestEditorScreen, ContestManageScreen, ContestJudgeScreen } from './src/screens/ContestOrganizeScreens';
import { BattleScreen } from './src/screens/BattleScreens';
import { ChatsHomeScreen, NewGroupScreen } from './src/screens/ChatsHome';
import { ChatInfoScreen, JoinGroupScreen } from './src/screens/ChatInfoScreen';
import { SearchGroupsScreen } from './src/screens/SearchGroupsScreen'; // PACKAGE F: Search groups (Chats) // CHAT 7.4: Group Info / contact info, join by invite link
import { SyncProvider } from './src/api/sync';
import { SignInPreviewScreen } from './src/screens/SignInScreen';
import { colors, fonts, FONT_ASSETS, readerThemes } from './src/theme';
import { isDarkScheme } from './src/design/palette'; // APPEARANCE (item 14): status bar follows the chosen theme

import HomeScreen from './src/screens/HomeScreen';
import TodayScreen from './src/screens/TodayScreen';
import DiscoverScreen, { CommunitiesScreen, GroupScreen, ChatListScreen, ChatScreen, CalendarScreen, PeopleScreen, PersonScreen, CareScreen, WishesScreen, LiveScreen, FeedScreen } from './src/screens/DiscoverScreen';
import BibleHomeScreen from './src/screens/BibleHomeScreen'; // FIGMA DESIGN: the Bible tab's home; the reader opens on top
import BibleScreen, { StudyScreen, FactbookScreen, SearchScreen, LibraryScreen } from './src/screens/BibleScreen';
import GodModeScreen, { ReadingScreen, BibleChatScreen, CompanionScreen } from './src/screens/GodModeScreen';
import PrayerScreen, { PrayerDetailScreen, NewPrayerScreen } from './src/screens/PrayerScreen';
import { LearnScreen, PlanScreen, LessonScreen, SermonStudioScreen, TranscriptScreen, CreateScreen, ProfileScreen, OnboardingScreen } from './src/screens/MoreScreens';
import SocialsScreen from './src/screens/SocialsScreen';
import ConcordanceScreen from './src/screens/ConcordanceScreen';
import ScripturePopScreen from './src/screens/ScripturePopScreen';
import { useScripturePop } from './src/notifications/scripturePop';
import JourneyRoot from './src/journey/JourneyRoot'; // MY SCRIPTURE JOURNEY: reminders plan, queue flush, celebrations (mounted once below)
import JourneyHomeScreen, { JourneySetupScreen } from './src/screens/JourneyScreens'; // MY SCRIPTURE JOURNEY
import { JourneyGroupsScreen, JourneyGroupScreen } from './src/screens/JourneyGroupScreens'; // MY SCRIPTURE JOURNEY: community goals
import { useSocialsDark, useSocialsImmersive } from './src/ui/chrome';
import { useBibleImmersive } from './src/ui/chrome'; // BIBLE FULL SCREEN: reader hides the tab bar
import ExegesisScreen from './src/screens/ExegesisScreen'; // EXEGESIS: one-tap structured exegesis
import JobsScreen from './src/screens/JobsScreen';
import { PriestsScreen, PriestProfileScreen, PriestApplyScreen, CareInboxScreen } from './src/screens/CareNetworkScreens'; // CARE NETWORK: Talk to a Priest / Talk to an Apostle
import UserProfileScreen from './src/screens/UserProfileScreen'; // SOCIAL (round 3)
import EditProfileScreen from './src/screens/EditProfileScreen'; // SOCIAL (round 3)
import ActivityScreen from './src/screens/ActivityScreen'; // SOCIAL (round 3)
import { RecordingDetailScreen } from './src/screens/RecordScreens'; // DISCOVER TOOLS (round 3)
import RemindersScreen from './src/screens/RemindersScreen'; // DISCOVER TOOLS (round 3)
import { WatchScreen, YouTubeChannelScreen } from './src/screens/WatchScreens'; // DISCOVER TOOLS (round 3)
import YouTubeWatchScreen from './src/screens/YouTubeWatchScreen'; // YOUTUBE LIVE: big player + Bible Nestra comments
import { DailyVerseScreen, BlessingVideosScreen, ChannelVideosScreen } from './src/screens/DailyScreens'; // TODAY'S JOURNEY: Daily Bread, blessing videos, Watch: From Our Channels
import { LessonPreviewScreen, DevotionalPreviewScreen } from './src/screens/LearnContentScreens'; // LEARN CMS: lesson / devotional preview → blog
import { SplashView } from './src/components/BrandLogo'; // ONBOARDING: logo-only splash while the app really starts
import { EmbedViewerScreen } from './src/components/EmbedViewer'; // YOUTUBE LIVE: full-screen embeds for video links
import { useLivePushOpen } from './src/notifications/livePush'; // YOUTUBE LIVE
import { useBroadcastPushOpen } from './src/notifications/broadcastPush'; // BROADCASTS
import { useReminders } from './src/notifications/reminders'; // DISCOVER TOOLS (round 3)
import { FundMeHomeScreen, FundraiserScreen, FundraiserEditScreen, FundraiserDonationsScreen } from './src/screens/FundMeScreens'; // FUND ME (round 3)
import { FundMeCreditsScreen, FundMeGiftCreditsScreen, FundMeMoneyScreen, FundMePayoutAccountScreen, FundMeMyDonationsScreen, FundMeReceiptScreen, PayoutKycScreen } from './src/screens/FundMeMoneyScreens'; // FUND ME MONEY: credits, gifting credits, payouts, receipts
import { OpportunitiesScreen, OpportunityDetailScreen } from './src/screens/OpportunitiesScreen'; // OPPORTUNITIES (+ PACKAGE E full-screen job detail)
import { MediaLibraryScreen, MediaListScreen, MediaUploadScreen, BookReaderScreen } from './src/screens/MediaLibraryScreens'; // MEDIA LIBRARY: audio + Christian books
import { BooksScreen, BookDetailScreen, BookReadScreen, AudioBookScreen } from './src/screens/BooksScreens'; // PACKAGE G: Books library + audio books
import { AudioPlayerProvider } from './src/audio/Player'; // MEDIA LIBRARY: global audio player (continuous playback)
import { LibraryMiniBar } from './src/components/MiniPlayer'; // MEDIA LIBRARY
import NotificationSettingsScreen from './src/screens/NotificationSettingsScreen'; // NOTIFICATIONS: Settings › Notifications › Daily moments
import { MembershipsScreen, MembershipScreen, MembershipReviewsScreen, MembershipHomeScreen, MyChannelsScreen, MembershipLibraryScreen } from './src/screens/MembershipScreens'; // MEMBERSHIPS & PAID CHANNELS (brief 8)
import { MembershipHubScreen } from './src/screens/MembershipHubScreens'; // MEMBERSHIP HUB (Development Update v1, item 4): full-screen Memberships
import { MembershipMediaScreen, MembershipMembersScreen, MembershipAdminsScreen, MembershipSettingsScreen, MembershipWelcomeGate } from './src/screens/MembershipGroupScreens'; // MEMBERSHIP GROUPS: MASTER CLASS + EXECUTIVE CLASS
import { WalletScreen } from './src/screens/WalletScreen'; // WALLET CORE: separate wallets, Buy sheets, history, Dating Plus / VIP
import { DatingProfileEditScreen, DatingProfileViewScreen, DatingChatScreen, DatingPlansScreen, DatingBoostScreen, DatingSettingsScreen, DatingVerifyScreen, FindLoveHubScreen } from './src/screens/FindLoveScreens'; // FIND LOVE: profile, chat, plans, boost, safety, verification
import { GiftStoreScreen, GiftHistoryScreen, GiftEarningsScreen } from './src/screens/GiftScreens'; // VIRTUAL GIFTS & STARS: store, history, earnings
import { PortfolioHomeScreen, PortfolioApplyScreen } from './src/screens/PortfolioScreens'; // PORTFOLIO & PARTNER MANAGERS: dashboards, Apply
import { UserSearchScreen } from './src/screens/UserSearchScreen'; // USER SEARCH: find members by username
import { useDailyMoments } from './src/notifications/daily'; // NOTIFICATIONS: daily moments (local, user's time zone)
import { useDeepLinks } from './src/notifications/deepLinks'; // NOTIFICATIONS + WIDGETS: biblenestra:// deep links
import { useGroupInviteLinks } from './src/notifications/deepLinks'; // CHAT GAPS: biblenestra://join/<code> → Join with a link
import { PaymentReportScreen, MembershipInviteScreen, useMembershipInviteLinks } from './src/screens/PaymentReportScreens'; // PAYMENT VERIFICATION: Report a payment, membership invitation links
import { useChatPush } from './src/notifications/push'; // CHAT PUSH: tap opens the chat, Reply / Mark as read actions, per-chat tray tidy
import { useApi } from './src/api/auth'; // CHAT PUSH: authed request for notification actions
import { useHomeWidgets } from './src/widgets'; // WIDGETS: Android home-screen widgets (registers the widget task on import; no-op on web/iOS)

class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.safe, styles.errorContainer]}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{this.state.error?.message || String(this.state.error)}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.retryText}>Reload App</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const ROUTES = {
  ExtraBooks: ExtraBooksScreen, ExtraBook: ExtraBookScreen, // BEYOND THE 66: deuterocanonical & extra-biblical books
  Websites: WebsitesScreen, AddWebsite: AddWebsiteScreen, WebsiteViewer: WebsiteViewerScreen, // MEMBER WEBSITES (open inside the app)
  WebsiteFeed: WebsiteFeedScreen, WebsiteArticle: WebsiteArticleScreen, WebsiteIntegration: WebsiteIntegrationScreen, WebsiteComposer: WebsiteComposerScreen, // WEBSITE INTEGRATION
  Bible: BibleScreen, Study: StudyScreen, Factbook: FactbookScreen, Search: SearchScreen, Library: LibraryScreen,
  Reading: ReadingScreen, BibleChat: BibleChatScreen, Companion: CompanionScreen,
  Exegesis: ExegesisScreen, // EXEGESIS
  Prayer: PrayerDetailScreen, NewPrayer: NewPrayerScreen, PrayerTab: PrayerScreen, PrayerWall: PrayerScreen,
  Communities: CommunitiesScreen, Group: GroupScreen, ChatList: ChatsHomeScreen, NewGroup: NewGroupScreen, Chat: ChatScreen, Calendar: CalendarScreen,
  ChatInfo: ChatInfoScreen, JoinGroup: JoinGroupScreen, SearchGroups: SearchGroupsScreen, // CHAT 7.4 · PACKAGE F
  Priests: PriestsScreen, PriestProfile: PriestProfileScreen, PriestApply: PriestApplyScreen, CareInbox: CareInboxScreen, // CARE NETWORK
  People: PeopleScreen, Person: PersonScreen, Care: CareScreen, Wishes: WishesScreen, Live: LiveScreen, Feed: SocialsScreen, // Feed is merged into Socials
  Learn: LearnScreen, Plan: PlanScreen, Lesson: LessonScreen, SermonStudio: SermonStudioScreen, Transcript: TranscriptScreen,
  Create: CreateScreen, Profile: ProfileScreen, Onboarding: OnboardingScreen, Plans: PlansScreen, Contests: ContestsScreen, Contest: ContestScreen, ContestEntry: ContestEntryScreen, ContestSubmit: ContestSubmitScreen, Certificate: CertificateScreen,
  ContestOrganize: ContestOrganizeScreen, ContestEditor: ContestEditorScreen, ContestManage: ContestManageScreen, ContestJudge: ContestJudgeScreen, Battle: BattleScreen,
  Today: TodayScreen, Socials: SocialsScreen, Concordance: ConcordanceScreen, ScripturePop: ScripturePopScreen, Jobs: JobsScreen, Chats: ChatsHomeScreen,
  UserProfile: UserProfileScreen, EditProfile: EditProfileScreen, Activity: ActivityScreen, // SOCIAL (round 3)
  RecordingDetail: RecordingDetailScreen, Reminders: RemindersScreen, Watch: WatchScreen, YouTubeChannel: YouTubeChannelScreen, // DISCOVER TOOLS (round 3)
  FundMe: FundMeHomeScreen, Fundraiser: FundraiserScreen, FundraiserEdit: FundraiserEditScreen, FundraiserDonations: FundraiserDonationsScreen, // FUND ME (round 3)
  Opportunities: OpportunitiesScreen, // OPPORTUNITIES (external listings)
  OpportunityDetail: OpportunityDetailScreen, // PACKAGE E: full-screen job detail (opened from the list after an ad)
  MediaLibrary: MediaLibraryScreen, MediaList: MediaListScreen, MediaUpload: MediaUploadScreen, BookReader: BookReaderScreen, // MEDIA LIBRARY
  Books: BooksScreen, BookDetail: BookDetailScreen, BookRead: BookReadScreen, AudioBook: AudioBookScreen, // PACKAGE G: Books
  YouTubeWatch: YouTubeWatchScreen, EmbedViewer: EmbedViewerScreen, // YOUTUBE LIVE
  DailyVerse: DailyVerseScreen, BlessingVideos: BlessingVideosScreen, ChannelVideos: ChannelVideosScreen, // TODAY'S JOURNEY
  NotificationSettings: NotificationSettingsScreen, // NOTIFICATIONS
  LessonPreview: LessonPreviewScreen, DevotionalPreview: DevotionalPreviewScreen, // LEARN CMS
};
// Dev-only: preview the online sign-in design without a Clerk key (/?route=SignInPreview)
if (__DEV__) ROUTES.SignInPreview = SignInPreviewScreen;
ROUTES.InviteFriends = InviteFriendsScreen; // CHAT LIMITS
Object.assign(ROUTES, { Memberships: MembershipsScreen, Membership: MembershipScreen, MembershipReviews: MembershipReviewsScreen, MembershipHome: MembershipHomeScreen, MyChannels: MyChannelsScreen }); // MEMBERSHIPS & PAID CHANNELS
Object.assign(ROUTES, { MembershipLibrary: MembershipLibraryScreen, MembershipMedia: MembershipMediaScreen, MembershipMembers: MembershipMembersScreen, MembershipAdmins: MembershipAdminsScreen, MembershipSettings: MembershipSettingsScreen }); // MEMBERSHIP GROUPS
ROUTES.Wallet = WalletScreen; // WALLET CORE
Object.assign(ROUTES, { FundMeCredits: FundMeCreditsScreen, FundMeGiftCredits: FundMeGiftCreditsScreen, FundMeMoney: FundMeMoneyScreen, FundMePayoutAccount: FundMePayoutAccountScreen, FundMeMyDonations: FundMeMyDonationsScreen, FundMeReceipt: FundMeReceiptScreen, PayoutKyc: PayoutKycScreen }); // FUND ME MONEY (+ payout KYC)
Object.assign(ROUTES, { GiftStore: GiftStoreScreen, GiftHistory: GiftHistoryScreen, GiftEarnings: GiftEarningsScreen }); // VIRTUAL GIFTS & STARS
Object.assign(ROUTES, { PortfolioHome: PortfolioHomeScreen, PortfolioApply: PortfolioApplyScreen }); // PORTFOLIO & PARTNER MANAGERS
Object.assign(ROUTES, { UserSearch: UserSearchScreen }); // USER SEARCH: Socials header search icon → username search
Object.assign(ROUTES, { DatingProfileEdit: DatingProfileEditScreen, DatingProfileView: DatingProfileViewScreen, DatingChat: DatingChatScreen, DatingPlans: DatingPlansScreen, DatingBoost: DatingBoostScreen, DatingSettings: DatingSettingsScreen, DatingVerify: DatingVerifyScreen }); // FIND LOVE
Object.assign(ROUTES, { PaymentReport: PaymentReportScreen, MembershipInvite: MembershipInviteScreen }); // PAYMENT VERIFICATION
ROUTES.FindLoveHub = FindLoveHubScreen; // FIND LOVE HUB: full-screen Find Love (Discover / Likes / Matches / Profile); pushed, so the tab bar is hidden
ROUTES.MembershipHub = MembershipHubScreen; // MEMBERSHIP HUB: pushed full-screen (Explore / My Memberships / Create / Manage); the tab bar is hidden while it is open
Object.assign(ROUTES, { Journey: JourneyHomeScreen, JourneySetup: JourneySetupScreen, JourneyGroups: JourneyGroupsScreen, JourneyGroup: JourneyGroupScreen }); // MY SCRIPTURE JOURNEY

// Gentle enter animation: pushed screens slide in from the right, tab switches cross-fade up.
function Transition({ kind, children, skip }) {
  const a = useRef(new Animated.Value(skip ? 1 : 0)).current;
  useEffect(() => {
    if (skip) return;
    Animated.timing(a, { toValue: 1, duration: kind === 'push' ? 280 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  const transform = kind === 'push'
    ? [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }]
    : [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }];
  return <Animated.View style={{ flex: 1, opacity: a, transform }}>{children}</Animated.View>;
}

// A layer in the navigation stack. Pushed screens slide in from the right over the previous one,
// which shifts left and dims (iOS-style parallax); popped screens slide back out before unmounting.
function StackLayer({ entering, leaving, covered, initialCovered, children }) {
  const W = Dimensions.get('window').width;
  const x = useRef(new Animated.Value(entering ? 1 : 0)).current;
  const cover = useRef(new Animated.Value(initialCovered ? 1 : covered ? 1 : 0)).current;
  useEffect(() => {
    if (entering) Animated.timing(x, { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, []);
  useEffect(() => {
    if (leaving) Animated.timing(x, { toValue: 1, duration: EXIT_MS - 20, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [leaving]);
  useEffect(() => {
    Animated.timing(cover, { toValue: covered ? 1 : 0, duration: covered ? 360 : EXIT_MS - 20, easing: covered ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [covered]);
  const translateX = Animated.add(
    x.interpolate({ inputRange: [0, 1], outputRange: [0, W] }),
    cover.interpolate({ inputRange: [0, 1], outputRange: [0, -W * 0.26] }),
  );
  return (
    <Animated.View
      pointerEvents={covered || leaving ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }, (entering || leaving) && styles.layerShadow]}
    >
      <FocusCtx.Provider value={!covered && !leaving}>{children}</FocusCtx.Provider>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: '#15172B', opacity: cover.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }) }]}
      />
    </Animated.View>
  );
}

const TABS = {
  Today: TodayScreen,
  Bible: BibleHomeScreen,
  Discover: DiscoverScreen,
  Socials: SocialsScreen,
};














function Root() {
  const { state, ready, dispatch } = useStore();
  const nav = useNav();
  const socialsDark = useSocialsDark();
  const socialsImmersive = useSocialsImmersive(); // Videos section: hide the tab bar + mini-player
  const bibleImmersive = useBibleImmersive(); // BIBLE FULL SCREEN: tab bar slides away while reading
  const [tab, setTab] = useState('Today');
  // Scripture pop-ups: keep the next couple of days scheduled; open the verse when one is tapped
  useScripturePop(ready ? state.scripturePop : null, nav);
  // INTERSTITIAL BREAKS (dev update v1, item 4): foreground-time break after the admin interval; held back on reading/recording/prayer/checkout screens
  const adTop = nav.stack[nav.stack.length - 1];
  useAdBreaks(adTop ? adTop.name : `tab:${tab}`, useAds().showInterstitial);
  useReminders(nav); // DISCOVER TOOLS (round 3): reminders + daily verse (local notifications)
  useLivePushOpen(nav); // YOUTUBE LIVE: tapping a LIVE NOW push opens the Watch screen
  useBroadcastPushOpen(nav); // BROADCASTS: tapping an official-message push opens it in Activity
  useDailyMoments(nav); // NOTIFICATIONS: schedule the chosen daily moments + open their screen when tapped
  useDeepLinks(nav); // NOTIFICATIONS + WIDGETS: biblenestra://daily, //prayer, //bible … open their screens
  useMembershipInviteLinks(nav); // PAYMENT VERIFICATION: biblenestra://membership-invite?token=… opens the invitation screen
  useGroupInviteLinks(nav); // CHAT GAPS: group invite links (/g/<code> landing page → app) open the join screen prefilled
  useHomeWidgets(state, ready); // WIDGETS: redraw Android widgets when reading progress / the day changes
  useInviteLinks(); // CHAT LIMITS: biblenestra://invite/<code> → POST /me/referral once signed in
  const chatPushApi = useApi(); // CHAT PUSH
  useChatPush(nav, chatPushApi.online ? chatPushApi.request : null); // CHAT PUSH: open chat on tap, Reply / Mark as read from the notification
  // Android hardware back pops the in-app stack before leaving the app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav.stack.length) { nav.pop(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [nav.stack.length]);
  // Keep the tab screen mounted only while a transition is running (so it can be seen sliding),
  // then unmount it under pushed screens so its media/effects stop.
  const sig = nav.rendered.map((e) => e.key + (e.leaving ? '~' : '')).join('|');
  const sigRef = useRef(sig);
  const changedAt = useRef(0);
  if (sigRef.current !== sig) { sigRef.current = sig; changedAt.current = Date.now(); }
  const [, force] = useState(0);
  useEffect(() => { const t = setTimeout(() => force((n) => n + 1), 460); return () => clearTimeout(t); }, [sig]);
  // First-run taps: the Plus offer waits until the next launch for someone who onboarded in this one
  const onboardedAtLaunch = useRef(null);
  if (ready && onboardedAtLaunch.current === null) onboardedAtLaunch.current = !!state.onboarded;
  if (!ready) return <SplashView />; // ONBOARDING: same logo splash while the saved state loads
  if (!state.onboarded) return <OnboardingScreen />;
  // BibleNestra Plus (/week · $35/year): shown once after onboarding, with 'Continue free'
  if (!state.plansSeen && onboardedAtLaunch.current) return <PlansGate onDone={() => dispatch({ type: 'set', patch: { plansSeen: true } })} />;
  const top = nav.stack[nav.stack.length - 1];
  const animating = Date.now() - changedAt.current < 440;
  const Tab = TABS[tab];
  const showBase = true; // tab stays mounted under pushed screens (keeps scroll + state); media pauses via FocusCtx
  const layers = (
    <View style={{ flex: 1 }}>
      {showBase ? (
        <StackLayer key={'tab-' + tab} covered={!!top} initialCovered={!top && nav.rendered.length > 0}>
          <Transition kind="tab" skip={nav.rendered.length > 0}><Tab /></Transition>
        </StackLayer>
      ) : null}
      {nav.rendered.map((e) => {
        const Comp = ROUTES[e.name];
        const liveIdx = nav.stack.indexOf(e);
        const covered = !e.leaving && liveIdx > -1 && liveIdx < nav.stack.length - 1;
        return (
          <StackLayer key={e.key} entering leaving={!!e.leaving} covered={covered}>
            <View style={{ flex: 1, backgroundColor: colors.screen }}>
              {Comp ? <Comp params={e.params} /> : <Tab />}
            </View>
          </StackLayer>
        );
      })}
    </View>
  );
  const socialRoute = top && (top.name === 'Socials' || top.name === 'Feed');
  // Socials: light Facebook-style feed, dark only while the full-screen Videos reels are showing
  const isSocials = ((tab === 'Socials' && !top) || socialRoute) && socialsDark;
  // The Bible tab follows the reader theme (Paper / Sepia / Night) so the chrome matches the page.
  const reader = null; // FIGMA DESIGN: the Bible tab is now the ivory Bible home; reader themes apply inside the pushed reader
  const pageBg = isSocials ? '#000000' : reader ? reader.bg : colors.screen;
  const variant = isSocials ? 'dark' : reader && reader.key !== 'paper' ? reader.key : 'light';
  const lightStatus = isSocials || (reader && reader.dark) || isDarkScheme();
  const immersive = socialsImmersive && tab === 'Socials' && !top;
  // (a pushed Socials/Feed route keeps the dark chrome; the tab bar is hidden under pushed routes anyway)
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: pageBg }]} edges={isSocials && !socialRoute && !immersive ? ['top'] : ['top', 'bottom']}>
      <StatusBar style={lightStatus ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: pageBg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {layers}
        </KeyboardAvoidingView>
        <JourneyRoot />{/* MY SCRIPTURE JOURNEY: reminders plan, queue flush, achievement celebrations (renders nothing until one is due) */}
        {!immersive && !(top && top.name === 'Bible') ? <MiniPlayer bg={top ? colors.screen : pageBg} /> : null}
        {(tab === 'Bible' && !top) || (top && top.name === 'Bible') ? <LibraryMiniBar bg={pageBg} /> : null}{/* MEDIA LIBRARY: library audio keeps its bar in the Bible reader */}
        {!top && !immersive ? <TabBar active={tab} variant={variant} hidden={tab === 'Bible' && bibleImmersive} onCreate={() => nav.push('FindLoveHub')} onChange={(t) => { nav.reset(); setTab(t); }} /> : null}
        <NowPlayingSheet />
        {onboardedAtLaunch.current ? <EngagementPopup /> : null}{/* not on the very first launch: new users reach Today in few taps */}
        <ChatLimitHost />{/* CHAT LIMITS: subscription prompt when a free user hits the 5-chat limit */}
        <MembershipWelcomeGate />{/* MEMBERSHIP GROUPS: a new member's welcome pop-up, once per group */}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  if (!fontsLoaded && !fontError) {
    return <SplashView />; // ONBOARDING: logo-only splash while fonts load (real work, no added delay)
  }
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ErrorBoundary>
        <StoreProvider>
          <NavProvider>
            <NarrationProvider>
              <ToastProvider>
                <AdsProvider>
                  {/* online mode: Clerk sign-in gate + API sync (local mode: pass-through) */}
                  {/* first launch: four intro screens before sign-in */}
                  <IntroGate>
                    <AuthGate>
                      <SyncProvider>
                        <AdsBridge />
                        <AudioPlayerProvider>{/* MEDIA LIBRARY: playback continues across every screen */}
                        <Root />
                        </AudioPlayerProvider>
                      </SyncProvider>
                    </AuthGate>
                  </IntroGate>
                </AdsProvider>
              </ToastProvider>
            </NarrationProvider>
          </NavProvider>
        </StoreProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  layerShadow: Platform.select({
    web: { boxShadow: '-8px 0 24px rgba(21,23,43,0.14)' },
    default: { shadowColor: '#15172B', shadowOffset: { width: -6, height: 0 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 12 },
  }),
  safe: { flex: 1, backgroundColor: colors.screen },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen },
  errorContainer: { padding: 24, justifyContent: 'center', alignItems: 'center' },
  errorTitle: { color: colors.fg, fontFamily: fonts.serifBold, fontSize: 22, marginBottom: 10 },
  errorText: { color: colors.muted, fontSize: 13, marginBottom: 22, textAlign: 'center', lineHeight: 19 },
  retryBtn: { backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 26, borderRadius: 999 },
  retryText: { color: colors.primaryFg, fontWeight: '700', fontSize: 14 },
});
