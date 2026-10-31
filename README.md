# BibleNestra (Expo / React Native)

Mobile front-end for the BibleNestra product specification (5-tab bar: Today · Bible · Discover · Socials · Profile).

## Design system — "Sanctuary Paper"

All styling flows from `src/theme.js`:

- **Palette** – warm parchment canvas (`colors.screen`), white cards, deep ink text, royal indigo
  (`colors.primary`) for actions and active states, burnished gold (`colors.gold`) for scripture accents,
  and night indigo (`colors.night`) for immersive heroes and players. Muted supporting hues
  (sage, rose, sky, lavender, teal) and soft `card*` tints for categories.
- **Type** – Newsreader serif (`@expo-google-fonts/newsreader`, loaded in `App.js`) for scripture and headings;
  the platform sans (SF Pro / Roboto) for interface text. Serif weights are separate families
  (`fonts.serif`, `serifItalic`, `serifMedium`, `serifBold`, `serifBoldItalic`) — don't add `fontWeight`
  or `fontStyle` to a serif style.
- **Tokens** – `radius`, `space`, `shadow.sm|md|lg` and the `alpha(hex, a)` helper (in `components/ui.js`).
- **Reader themes** – `readerThemes` (Paper / Sepia / Night) and `lineSpacings`, chosen from the **Aa** reading-settings
  sheet in the Bible tab (stored as `state.readerTheme`, `state.lineSpacing`, `state.fontSize`). The tab bar follows the reader theme.
- **Icons** – `components/Icons.js`: one consistent 24px line set (see `ICON_NAMES`).
- **Motion** – screens slide/fade in (`Transition` in `App.js`), the verse sheet slides up, the tab indicator springs.
- **Shared components** – `Screen`, `Section`, `Row`, `Pill(s)`, `Button`, `Input`, `Tag`, `Badge`, `Notice`,
  `Empty`, `Eyebrow`, `NightGlow` (gradient depth for dark hero cards), `Card`, `AskBar`, `TabBar`.

## Patterns borrowed from leading faith apps

| Pattern | Inspired by | Where |
|---|---|---|
| Daily home with a 4-step rhythm (verse → reading → prayer → reflect) and a calm completion card | YouVersion Daily Refresh, Glorify daily checklist | `TodayScreen` |
| Week strip + streak with current/longest and one grace day a week; streaks can be hidden | YouVersion streaks | `TodayScreen`, `data/rhythm.js` |
| Verse image creator (backgrounds, type, square/story) shared as a PNG | YouVersion Verse Images, Verses app | `components/VerseImageSheet.js` (uses `react-native-view-shot` + `expo-sharing`) |
| "Now playing" audio screen: narrator, speed, sleep timer, background music, Reflect pauses | Dwell | `components/NowPlayingSheet.js` |
| Continue reading + seasonal challenge cards | YouVersion, Hallow | `TodayScreen` |

## Motion

All animation uses React Native's built-in `Animated` API (no extra native dependency):

- `src/components/Motion.js` — `PressScale` (spring press feedback), `FadeInUp` (staggered entrances), `ScaleIn`, `Pop`,
  `Pulse`, `LiveRing`, `Burst` (sparkles), `AnimatedNumber`, `AnimatedBar`, `Shimmer`, and `AnimatedModal`
  (bottom sheets: dim layer fades, sheet springs up and animates out).
- `App.js` `StackLayer` + `src/navigation.js` — screens slide in over a dimmed, parallax-shifted previous screen and slide
  back out on Back; tab screens stay mounted underneath (scroll position kept) and media pauses via `useIsFocused()`.
- Bible reader: swipe left/right to turn chapters with a page-slide; Today: staggered sections, animated progress, sparkle
  completion; Socials: double-tap heart, spinning music disc; plus per-screen motion everywhere else.

## What works on the device (no server needed)

Everything below runs locally and is saved on the device (AsyncStorage):

- **Bible** – full KJV offline, highlights, notes (edit / delete / undo), bookmarks, compare, reading themes,
  share (native share sheet), post a verse to the feed, verse images (PNG via `react-native-view-shot` + `expo-sharing`).
- **Narration** – real text-to-speech (`expo-speech`, `src/audio/Narration.js`): reads chapters verse by verse,
  highlights and scrolls to the verse being read, continues into the next chapter, speed / voice / sleep timer /
  Reflect pauses, global mini player.
- **Today** – daily rotating verse, 4-step rhythm, streaks with grace days.
- **Study** – word study from the bundled lexicon, cross-references for key chapters, concordance.
- **Community** – feed posts, likes, saves, comments, wishes with candles and Amen, prayer wall (pray, updates,
  answered, archive, report), groups, direct chats, calendar RSVP and `.ics` export, live rooms, jobs and proposals.
- **Sermon Studio** – real microphone recording, playback, rename, share, delete (`expo-av`).
- **Feedback** – confirmation toasts and haptics (`src/components/Toast.js`) for every action.

### What still needs a backend
Accounts and sync across devices, other people's live activity (posts, chats and prayers from real users),
licensed translations and commentaries, speech-to-text for sermon transcripts, payments for coins/gifts,
push notifications, and a hosted AI model for Bible Chat (it currently answers from the bundled Scripture and lexicon).

## Run

```bash
npm install            # adds @expo-google-fonts/newsreader, react-native-view-shot, expo-sharing, expo-speech, expo-haptics, expo-av
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
