import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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

const ROUTES = {
  Bible: BibleScreen, Study: StudyScreen, Factbook: FactbookScreen, Search: SearchScreen, Library: LibraryScreen,
  Reading: ReadingScreen, BibleChat: BibleChatScreen, Companion: CompanionScreen,
  Prayer: PrayerDetailScreen, NewPrayer: NewPrayerScreen, PrayerTab: PrayerScreen,
  Communities: CommunitiesScreen, Group: GroupScreen, ChatList: ChatListScreen, Chat: ChatScreen, Calendar: CalendarScreen,
  People: PeopleScreen, Person: PersonScreen, Care: CareScreen, Wishes: WishesScreen, Live: LiveScreen, Feed: FeedScreen,
  Learn: LearnScreen, Plan: PlanScreen, Lesson: LessonScreen, SermonStudio: SermonStudioScreen, Transcript: TranscriptScreen,
  Create: CreateScreen, Profile: ProfileScreen, Onboarding: OnboardingScreen,
};

const TABS = { Home: HomeScreen, Discover: DiscoverScreen, Bible: BibleScreen, 'God Mode': GodModeScreen, Prayer: PrayerScreen };

function Root() {
  const { state, ready } = useStore();
  const nav = useNav();
  const [tab, setTab] = useState('God Mode');
  if (!ready) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (!state.onboarded) return <OnboardingScreen />;
  const top = nav.stack[nav.stack.length - 1];
  const Tab = TABS[tab];
  let screen = <Tab key={tab} />;
  if (top) {
    const Comp = ROUTES[top.name];
    screen = Comp ? <Comp key={top.key} params={top.params} /> : <Tab key={tab} />;
  }
  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{screen}</KeyboardAvoidingView>
      {!top ? <TabBar active={tab} onChange={(t) => { nav.reset(); setTab(t); }} /> : null}
    </View>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <NavProvider>
        <SafeAreaProvider>
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <StatusBar style="light" />
            <Root />
          </SafeAreaView>
        </SafeAreaProvider>
      </NavProvider>
    </StoreProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.screen },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen },
});
