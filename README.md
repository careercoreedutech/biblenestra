# BibleNestra (Expo / React Native)

Mobile front-end for the BibleNestra product specification, built in the God Mode UI language
(dark warm theme, two-tone cards, orange accent, 5-tab bar: Home · Discover · Bible · God Mode · Prayer).

## Run

```bash
npm install
npx expo start        # scan QR with Expo Go, or press i / a / w
```

## What's implemented (all on local data, persisted with AsyncStorage)

| Area (spec §) | Screen(s) |
|---|---|
| Onboarding, church discovery (§1.4) | `OnboardingScreen` – name, translation, interests, "What is the name of your church?" with directory search, "Can't find your church?", discoverability, offer/receive |
| Bible Reader & Study Engine (§1.5) | `BibleScreen` – book/chapter picker, translation catalog (KJV/WEB offline; MSG/NIV/NLT/GNB/AMP/AMPC/ESV/… listed as unavailable until licensed), verse select → highlight colours, private notes, bookmarks, share, side-by-side Compare, audio toggle, copyright line |
| Concordance / search (§1.5.3, §1.17) | `SearchScreen` – word search with exact/related, OT/NT scope, reference parsing ("John 3:16"), saved searches, people/communities/posts tabs |
| Commentary, cross-refs, word study, Factbook (§1.5.6–7, §1.26.3–4) | `StudyScreen`, `FactbookScreen` |
| Personal library & sync status (§1.5.8, §1.6.4) | `LibraryScreen` – Continue studying, notes, highlights, bookmarks, saved answers, recordings; store shows saved/syncing/failed |
| Reading plans, devotionals, memorization, courses, games, badges (§1.6, §1.26) | `LearnScreen`, `PlanScreen` (shared plans, atomic day completion), `LessonScreen` (transcript player) |
| Bible Chat (§1.7) | `BibleChatScreen` – passage context, labelled blocks (Scripture / Explanation / Commentary / Interpretations / Further study), verified reference links, save answer, create note, new/delete conversation |
| Scripture Companion (§1.8) | `CompanionScreen` – "What's on your heart today?", optional categories, grounded passages with "why relevant", reflection, next steps, crisis guidance |
| Sermon Studio (§1.9) | `SermonStudioScreen`, `TranscriptScreen` – consent notice, record/pause/stop, drafts, transcribe/retry, detected references needing confirmation, AI drafts labelled |
| Communities & group chat (§1.10) | `CommunitiesScreen` (filters, join/request), `GroupScreen` (General/Prayer/Bible Study/Announcements/Events channels, pinned, passage/prayer/event cards, composer) |
| People & direct chat (§1.10.5) | `PeopleScreen`, `PersonScreen`, `ChatListScreen` (message requests), `ChatScreen` (consent-based conversions) |
| Live streams & rooms (§1.10.6) | `LiveScreen` |
| Social feed (§1.11) | `FeedScreen`, Home "For you" |
| Make a Wish (§1.12) | `WishesScreen` + Create |
| Professional profile & verification badges (§1.13) | `ProfileScreen`, `PersonScreen` |
| Care Network (§1.14) | `CareScreen` – "Find Someone Who Understands" |
| Christian Calendar (§1.15–16) | `CalendarScreen` – church/community events with RSVP, observances with tradition, Scripture and source attribution |
| Create (§1.3 item 7) | `CreateScreen` – post, prayer, wish, study builder, event, sermon, resource, group, live stream |
| Prayer Wall & lifecycle (§1.26.1) | `PrayerScreen`, `PrayerDetailScreen`, `NewPrayerScreen` – I'm praying, updates, answered, archive, audience, anonymous |
| Privacy, notifications, family mode, account (§1.18, §1.20, §1.26.8) | `ProfileScreen` tabs |

## Structure

```
App.js                      providers, route table, tab bar
src/navigation.js           tiny stack navigator (push/pop/replace/reset)
src/store/index.js          reducer + AsyncStorage persistence + sync status
src/theme.js                colours
src/components/             Card, AskBar, TabBar, ui (Screen, Row, Pills, Button, …)
src/data/bible.js           translation catalog, sample chapters (KJV/WEB), concordance search, lexicon, commentary, cross-refs
src/data/seed.js            communities, people, prayers, calendar, plans, courses, live, recordings, feed
src/data/assistant.js       grounded local responders for Bible Chat and Scripture Companion
src/screens/                HomeScreen, BibleScreen, GodModeScreen, PrayerScreen, DiscoverScreen, MoreScreens
```

## Connecting a backend

Replace `src/data/*` with API calls that return the same shapes. `answerBibleChat` and
`companionResults` are the seams for the OpenAI Responses API + retrieval described in §1.7.3 / §1.8.
Chat, live, payments, auth and licensed Bible text need the services listed in §1.22.
