import React, { Component, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StoreProvider, useStore } from './src/store';
import { NavProvider, useNav } from './src/navigation';
import TabBar from './src/components/TabBar';
import { colors } from './src/theme';

import HomeScreen from './src/screens/HomeScreen';
import DiscoverScreen, { CommunitiesScreen, GroupScreen, ChatListScreen, ChatScreen, CalendarScreen, PeopleScreen, PersonScreen, CareScreen, WishesScreen, LiveScreen, FeedScreen } from './src/screens/DiscoverScreen';
import BibleScreen, { StudyScreen, FactbookScreen, SearchScreen, LibraryScreen } from './src/screens/BibleScreen';
import GodModeScreen, { ReadingScreen, BibleChatScreen, CompanionScreen } from './src/screens/GodModeScreen';
import PrayerScreen, { PrayerDetailScreen, NewPrayerScreen } from './src/screens/PrayerScreen';
import { LearnScreen, PlanScreen, LessonScreen, SermonStudioScreen, TranscriptScreen, CreateScreen, ProfileScreen, OnboardingScreen } from './src/screens/MoreScreens';
import SocialsScreen from './src/screens/SocialsScreen';
import ConcordanceScreen from './src/screens/ConcordanceScreen';
import JobsScreen from './src/screens/JobsScreen';

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
  People: PeopleScreen, Person: PersonScreen, Care: CareScreen, Wishes: WishesScreen, Live: LiveScreen, Feed: FeedScreen,
  Learn: LearnScreen, Plan: PlanScreen, Lesson: LessonScreen, SermonStudio: SermonStudioScreen, Transcript: TranscriptScreen,
  Create: CreateScreen, Profile: ProfileScreen, Onboarding: OnboardingScreen,
  Socials: SocialsScreen, Concordance: ConcordanceScreen, Jobs: JobsScreen, Chats: ChatListScreen,
};

const TABS = {
  Bible: BibleScreen,
  Discover: DiscoverScreen,
  Socials: SocialsScreen,
  Profile: ProfileScreen,
};

function Root() {
  const { state, ready } = useStore();
  const nav = useNav();
  const [tab, setTab] = useState('Bible');
  if (!ready) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (!state.onboarded) return <OnboardingScreen />;
  const top = nav.stack[nav.stack.length - 1];
  const Tab = TABS[tab];
  let screen = <Tab key={tab} />;
  if (top) {
    const Comp = ROUTES[top.name];
    screen = Comp ? <Comp key={top.key} params={top.params} /> : <Tab key={tab} />;
  }
  const isSocials = tab === 'Socials' && !top;
  return (
    <SafeAreaView style={[styles.safe, isSocials && { backgroundColor: '#000000' }]} edges={isSocials ? ['top'] : ['top', 'bottom']}>
      <StatusBar style={isSocials ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: isSocials ? '#000000' : colors.screen }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{screen}</KeyboardAvoidingView>
        {!top ? <TabBar active={tab} onChange={(t) => { nav.reset(); setTab(t); }} /> : null}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ErrorBoundary>
        <StoreProvider>
          <NavProvider>
            <Root />
          </NavProvider>
        </StoreProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.screen },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen },
  errorContainer: { padding: 24, justifyContent: 'center', alignItems: 'center' },
  errorTitle: { color: colors.gold, fontSize: 20, fontWeight: '700', marginBottom: 12 },
  errorText: { color: colors.muted, fontSize: 13, marginBottom: 20, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.gold, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 10 },
  retryText: { color: '#0e0c0b', fontWeight: '700', fontSize: 14 },
});
