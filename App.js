import React, { Component, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Dimensions, Easing, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { StoreProvider, useStore } from './src/store';
import { NavProvider, useNav, FocusCtx, EXIT_MS } from './src/navigation';
import TabBar from './src/components/TabBar';
import MiniPlayer from './src/components/MiniPlayer';
import NowPlayingSheet from './src/components/NowPlayingSheet';
import { ToastProvider } from './src/components/Toast';
import { NarrationProvider } from './src/audio/Narration';
import { AdsProvider } from './src/ads/Ads';
import { AuthGate } from './src/api/auth';
import { SyncProvider } from './src/api/sync';
import { SignInPreviewScreen } from './src/screens/SignInScreen';
import { colors, fonts, FONT_ASSETS, readerThemes } from './src/theme';

import HomeScreen from './src/screens/HomeScreen';
import TodayScreen from './src/screens/TodayScreen';
import DiscoverScreen, { CommunitiesScreen, GroupScreen, ChatListScreen, ChatScreen, CalendarScreen, PeopleScreen, PersonScreen, CareScreen, WishesScreen, LiveScreen, FeedScreen } from './src/screens/DiscoverScreen';
import BibleScreen, { StudyScreen, FactbookScreen, SearchScreen, LibraryScreen } from './src/screens/BibleScreen';
import GodModeScreen, { ReadingScreen, BibleChatScreen, CompanionScreen } from './src/screens/GodModeScreen';
import PrayerScreen, { PrayerDetailScreen, NewPrayerScreen } from './src/screens/PrayerScreen';
import { LearnScreen, PlanScreen, LessonScreen, SermonStudioScreen, TranscriptScreen, CreateScreen, ProfileScreen, OnboardingScreen } from './src/screens/MoreScreens';
import SocialsScreen from './src/screens/SocialsScreen';
import ConcordanceScreen from './src/screens/ConcordanceScreen';
import ScripturePopScreen from './src/screens/ScripturePopScreen';
import { useScripturePop } from './src/notifications/scripturePop';
import { useSocialsDark } from './src/ui/chrome';
import JobsScreen from './src/screens/JobsScreen';
import UserProfileScreen from './src/screens/UserProfileScreen'; // SOCIAL (round 3)
import EditProfileScreen from './src/screens/EditProfileScreen'; // SOCIAL (round 3)
import ActivityScreen from './src/screens/ActivityScreen'; // SOCIAL (round 3)
import { RecordingDetailScreen } from './src/screens/RecordScreens'; // DISCOVER TOOLS (round 3)
import RemindersScreen from './src/screens/RemindersScreen'; // DISCOVER TOOLS (round 3)
import { WatchScreen, YouTubeChannelScreen } from './src/screens/WatchScreens'; // DISCOVER TOOLS (round 3)
import { useReminders } from './src/notifications/reminders'; // DISCOVER TOOLS (round 3)
import { FundMeHomeScreen, FundraiserScreen, FundraiserEditScreen, FundraiserDonationsScreen } from './src/screens/FundMeScreens'; // FUND ME (round 3)

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
  Bible: BibleScreen, Study: StudyScreen, Factbook: FactbookScreen, Search: SearchScreen, Library: LibraryScreen,
  Reading: ReadingScreen, BibleChat: BibleChatScreen, Companion: CompanionScreen,
  Prayer: PrayerDetailScreen, NewPrayer: NewPrayerScreen, PrayerTab: PrayerScreen, PrayerWall: PrayerScreen,
  Communities: CommunitiesScreen, Group: GroupScreen, ChatList: ChatListScreen, Chat: ChatScreen, Calendar: CalendarScreen,
  People: PeopleScreen, Person: PersonScreen, Care: CareScreen, Wishes: WishesScreen, Live: LiveScreen, Feed: SocialsScreen, // Feed is merged into Socials
  Learn: LearnScreen, Plan: PlanScreen, Lesson: LessonScreen, SermonStudio: SermonStudioScreen, Transcript: TranscriptScreen,
  Create: CreateScreen, Profile: ProfileScreen, Onboarding: OnboardingScreen,
  Today: TodayScreen, Socials: SocialsScreen, Concordance: ConcordanceScreen, ScripturePop: ScripturePopScreen, Jobs: JobsScreen, Chats: ChatListScreen,
  UserProfile: UserProfileScreen, EditProfile: EditProfileScreen, Activity: ActivityScreen, // SOCIAL (round 3)
  RecordingDetail: RecordingDetailScreen, Reminders: RemindersScreen, Watch: WatchScreen, YouTubeChannel: YouTubeChannelScreen, // DISCOVER TOOLS (round 3)
  FundMe: FundMeHomeScreen, Fundraiser: FundraiserScreen, FundraiserEdit: FundraiserEditScreen, FundraiserDonations: FundraiserDonationsScreen, // FUND ME (round 3)
};
// Dev-only: preview the online sign-in design without a Clerk key (/?route=SignInPreview)
if (__DEV__) ROUTES.SignInPreview = SignInPreviewScreen;

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
  Bible: BibleScreen,
  Discover: DiscoverScreen,
  Socials: SocialsScreen,
};














function Root() {
  const { state, ready } = useStore();
  const nav = useNav();
  const socialsDark = useSocialsDark();
  const [tab, setTab] = useState('Today');
  // Scripture pop-ups: keep the next couple of days scheduled; open the verse when one is tapped
  useScripturePop(ready ? state.scripturePop : null, nav);
  useReminders(nav); // DISCOVER TOOLS (round 3): reminders + daily verse (local notifications)
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
  if (!ready) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!state.onboarded) return <OnboardingScreen />;
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
  const reader = tab === 'Bible' && !top ? readerThemes[state.readerTheme] : null;
  const pageBg = isSocials ? '#000000' : reader ? reader.bg : colors.screen;
  const variant = isSocials ? 'dark' : reader && reader.key !== 'paper' ? reader.key : 'light';
  const lightStatus = isSocials || (reader && reader.dark);
  // (a pushed Socials/Feed route keeps the dark chrome; the tab bar is hidden under pushed routes anyway)
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: pageBg }]} edges={isSocials && !socialRoute ? ['top'] : ['top', 'bottom']}>
      <StatusBar style={lightStatus ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: pageBg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {layers}
        </KeyboardAvoidingView>
        {!(tab === 'Bible' && !top) && !(top && top.name === 'Bible') ? <MiniPlayer bg={top ? colors.screen : pageBg} /> : null}
        {!top ? <TabBar active={tab} variant={variant} onChange={(t) => { nav.reset(); setTab(t); }} /> : null}
        <NowPlayingSheet />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  if (!fontsLoaded && !fontError) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
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
                  <AuthGate>
                    <SyncProvider>
                      <Root />
                    </SyncProvider>
                  </AuthGate>
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
