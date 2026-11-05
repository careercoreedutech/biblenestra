# BibleNestra (Expo / React Native)

Mobile front-end for the BibleNestra product specification (5-tab bar: Today · Bible · Discover · Socials · Profile).

## Backend (v7) — Cloudflare Workers + Neon + Clerk + R2

The app now has a real backend in `backend/` — no server to buy. **Full setup guide: `backend/SETUP.md`**, API contract: `backend/API.md`.

| Mode | When | Behaviour |
|---|---|---|
| Local | no `EXPO_PUBLIC_API_URL` | Exactly as before — everything stored on the phone |
| Online | `EXPO_PUBLIC_API_URL` + `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `.env` | Sign in (Google, Apple on iOS, email code); posts, photos, videos, likes/reactions, comments, follows, prayers, jobs & bids, coins, ad rewards and game rewards live in Neon and sync across devices |
| Dev-online | API URL + dev user (development builds only) | Test without Clerk: `?api=http://localhost:8787&devUser=alice` in the web preview |

- On the server, coins can only change through the server: bid fees (20, charged atomically), 5 rewarded ads → 20 coins,
  4 support flames a day, game coins once per game per day. Rewarded ads are verified with AdMob server-side verification.
- Photos are resized on the phone (≈1600 px JPEG); videos are compressed on the phone to **720p H.264 MP4** (~15 MB/min,
  `react-native-compressor`, poster frame via `expo-video-thumbnails`). Both are stored in Cloudflare R2 (no bandwidth fees).
  Video compression needs a development/EAS build — in Expo Go the original file is uploaded.
- Local try-out: `cd backend && npm install && npm test && npm run dev -- --seed`.
- Phase 2 backend (Cloudflare Durable Objects Hub + Neon):
  - Direct messages, group chats, communities & channels, message requests, user blocking.
  - Live real-time events via Cloudflare Durable Object `Hub` (WebSocket Hibernation API) + polling fallback.
  - Calendar events & RSVPs, Make a Wish candles & amens.
  - Bible study synchronization (notes, highlights, bookmarks, reading plans progress).
  - Virtual gifts moving coins between users with creator revenue share (70%).
  - Notifications inbox and Expo push notification delivery.
  - Safe on-device fallback: when `EXPO_PUBLIC_API_URL` is empty, everything continues to operate locally.

## New in v8.2 — admin dashboard

The web dashboard at `https://<your-worker>/admin` (sign in with your Clerk account; `users.role = 'admin'`) now has:
**Dashboard** (users, active today/this week, posts, messages, prayers, communities, coins, 14-day charts, newest members,
"needs attention" for open reports and fundraisers), **Users** (search by name/@handle/church/Clerk id; ban with reason /
unban, verified badge, make/remove admin, adjust coins with a reason, see their posts, reports, communities and coin
history), **Content** (posts & videos, comments, prayer requests — filter reported/removed, remove or restore),
**Communities & events** (verify, hide, change owner, delete with name confirmation; remove events with an in-app notice to
the host and RSVPs), **Announcements** (a card at the top of everyone's Today screen — general / verse / event / update /
urgent, optional verse and link, start/end time, optionally also in everyone's bell). Plus the existing Reports, Fund Me
approvals, YouTube channels and Audit log tabs. Every admin action is written to the audit log.
Also fixed: `GET /communities/:id` always returned "not found"; the Today greeting now uses the first name.
Code: `backend/src/routes/adminPlus.js`, `backend/src/lib/adminPlusPage.js`, `src/components/AnnouncementCards.js`.
Run `schema.sql` again on deploy. Locally: `DEV_ADMINS=admin node dev/server.mjs` makes the dev user `admin` an admin.

## New in v8.1 — message actions (chats and groups)

Press and hold any message in a direct chat or a group channel: react (🙏 ❤️ 🙌 👍 😂 😢 🔥 🕊️), **Reply** (quoted in
the bubble, tap the quote to jump), **Copy**, **Edit** (your own text messages, 24 hours, shows "Edited"), **Pin / Unpin**
(up to 3, pinned bar at the top; in groups only owners/admins can pin) and **Delete** — for me, or for everyone (your own
messages; group admins can also remove anyone's message, shown as "Removed by a group admin"). Group channels now sync
through the server in online mode (before, group messages stayed on the phone). The chat header no longer claims
end-to-end encryption, because messages are stored on the server, not end-to-end encrypted.
Code: `src/components/chat/MessageKit.js`, `src/chat/messages.js`, `backend/src/routes/messages.js`. Run `schema.sql` again on deploy.

## New in this version (v8 — client corrections round 3)

| Request | What was built | Where |
|---|---|---|
| Open a person's profile from the feed | Tap any name/avatar (posts, comments, reels, chats, search, followers) → public profile with posts, followers/following, follow, message, gift | `src/screens/UserProfileScreen.js`, `src/components/social/profileNav.js` |
| Edit profile | Pencil on Profile → avatar, wide banner, name, handle, headline, bio, church, location | `src/screens/EditProfileScreen.js` (`PUT /me` with `avatarUrl`, `bannerUrl`) |
| Bible book picker covered/stuck | Fixed-height sheet, full scroll to the last book, safe-area padding | `src/components/BookChapterPicker.js` |
| Search shows all results | Bible search and lexicon/concordance return every match, with counts per book, OT/NT filters, whole-word option, paged list | `src/bible/searchCore.js`, `src/screens/BibleSearchScreen.js` |
| Unlimited games | "Keep playing" practice mode after the daily set (no coins; an ad every 4th round); each game bank now ~1,500+ questions | `src/games/*` |
| Record on Discover | Discover order: Prayer, Chats, Record, Learn, Ask AI, Calendar, Reminder, Library, Jobs, Care, Fund Me. Sermon Studio records, uploads privately, transcribes (Workers AI Whisper) and writes sermon notes with Scripture references | `src/screens/RecordScreens.js`, `backend/src/routes/recordings.js` |
| Reminders + daily verse | Reminders with a purpose (read, pray, call, study) and time; daily Bible verse at a chosen time — local notifications, no Firebase | `src/screens/RemindersScreen.js`, `src/notifications/reminders.js` |
| Fund Me | Fundraisers with heading, goal, story with images, photos & PDFs, review before going live, public share page `/f/:slug`, donate with message or anonymously, progress bar, organiser management. **Payments are in test mode** until a Stripe/Paystack account is connected | `src/screens/FundMeScreens.js`, `backend/src/routes/fundme.js` |
| Comment likes + gifts | Like a comment → the author sees it in Activity (bell); gift coins from a comment | `src/screens/ActivityScreen.js`, `src/components/social/GiftSheet.js` |
| YouTube channels | Watch section with live/latest videos of channels added in the admin dashboard (`/admin`, users with `role='admin'`) | `src/screens/WatchScreens.js`, `backend/src/routes/youtube.js`, `backend/src/routes/admin.js` |

New packages: `react-native-webview`, `expo-document-picker`, `expo-clipboard` — rebuild the APK (not an OTA update).

Still blocked (need accounts/licences): real Fund Me payouts (Stripe Connect or Paystack account), copyrighted Bible
versions (NIV/ESV/TPT licences), push notifications while the app is closed (Firebase — skipped for now), the client's
list of YouTube channels, iOS build (Apple developer account), real AdMob ad unit ids.

## v6

| Request | What was built | Where |
|---|---|---|
| 20+ Bible translations, more languages | **57 translations in 34 languages**, all legal to show in an app: 16 English (KJV, BSB, WEB, LSV, FBV, T4T, ASV, YLT, BBE, Darby, Geneva…), 11 African (Yorùbá, Igbo, Hausa, Kiswahili, Twi ×2, Éwé, Lingala, Luganda, Chichewa, Shona), European (French, Spanish, Portuguese, German, Italian, Russian, Ukrainian, Polish, Latin) and Asian/Middle-Eastern (Arabic ×2, Hebrew, Persian, Chinese ×2, Korean, Japanese, Hindi, Tamil, Telugu, Bengali, Urdu, Tagalog, Vietnamese, Turkish). Search + region filter, right-to-left text, attribution line under each chapter, narration in the matching language, offline download per translation. | `src/bible/catalog.js`, `src/bible/loader.js`, `src/components/TranslationPicker.js` |
| The Passion Translation, NIV, ESV, NLT… | These are copyrighted. They are listed under **"Coming with a publisher licence"** (TPT, NIV, ESV, NLT, NKJV, AMP, MSG, NASB, CSB, NET, NRSV, RV1960, NVI). Once you hold a licence, add the endpoint to `LICENSED_SOURCES` in `src/bible/config.js` and the version becomes selectable — no other code changes. | `src/bible/config.js` |
| Scripture / prayer pop-ups | Local notifications that pop a verse (KJV, works offline) or a prayer every 30 min – 12 h, with quiet hours and content choice (Scriptures / Prayers / Both). Android uses a high-importance channel so they appear as heads-up pop-ups; tapping opens the verse. "Send me one now" test. | `src/notifications/*`, `ScripturePopScreen`, Today → Scripture pop-ups, Profile |
| Concordance & commentaries inside the app | No more links out. Word-by-word KJV with Strong's numbers for any verse, full Thayer's (Greek) / Brown-Driver-Briggs (Hebrew) entries with tappable cross-links, "Where it appears" from the offline KJV. Seven public-domain commentaries per chapter (Matthew Henry, JFB, Adam Clarke, John Gill, Tyndale notes, Keil & Delitzsch, Calvin), focused on the selected verse. Everything is cached for offline after first open. | `ConcordanceScreen`, `StudyScreen`, `src/bible/study.js` |
| One Socials, Facebook-style (feed + videos) | Socials has **Feed · Videos**. Feed is a light Facebook-style news feed: “What's on your heart?” composer, a Reels strip, chips For You · Following · Communities · Events, text / quote / photo-grid / inline-video posts, Like (long-press for 🙏 ❤️ 🙌 😢 reactions) · Comment · Share · Save, ⋯ menu (hide, delete with undo). Videos keeps the full-screen reels. The old `Feed` route opens Socials. | `SocialsScreen`, `src/components/social/*`, `src/ui/chrome.js` |
| 4 🔥 "support us today" | Today shows four flames — each lights after one rewarded ad. After the fourth: full-screen 🎉🎉🎉🎉 "Your reward shall be great in God's Presence". Resets daily. | `src/components/SupportAdsCard.js` |
| Ads in games | "Watch this ad to support this great platform" card, then a video (interstitial) ad after question 4 and every 4 questions after. | Discover → Games, Learn |
| Game questions ×500, new every day | Trivia 901 · Who said it? 513 · Verse scramble 560 · Timeline 550 questions. A fresh date-based set every day (no repeats until a pool is used up), "resets in Xh" timer, today's and best score, coins only on the first round each day. Built from the bundled KJV and checked by a validator (`scripts/gen_games.py`, `scripts/validate_games.py`). | `src/data/games/*`, `src/data/games.js` |
| Jobs bidding | Bidding costs 20 coins, or watch 5 rewarded ads to unlock 20 coins (progress is kept if you leave). Posting a job stays free. | `JobsScreen` |
| Profile icon top-right | The Profile tab was removed; an avatar sits at the top-right of Today, Bible, Discover, Socials and Jobs. | `src/components/ProfileButton.js` |

### Before publishing — checklist for the backend team
1. **AdMob**: `src/ads/config.js` and `app.json` use Google's *test* ids. Replace them with your AdMob ids. Ads only run in a
   development/production build (`eas build`), not in Expo Go or on the web — there a demo ad with a countdown is shown so the
   flows can be tested. Ad rules (4 support ads, every 4th question, 20 coins / 5 ads) live in `AD_RULES`.
2. **Bible text & study data** come from two free open services: the Free Use Bible API (bible.helloao.org — translations and
   commentaries, each with its licence metadata) and bolls.life (Strong's-tagged KJV and lexicon). For production, mirror
   them on your own server/CDN and change the two URLs in `src/bible/config.js`.
3. **Attribution**: CC BY-SA translations (Biblica® Open, IRV, LSV…) must show their attribution — the reader already prints
   it under every chapter. Keep that line.
4. **Licensed versions** (TPT, NIV…): get written permission from the publisher, serve the text from your backend, add it to
   `LICENSED_SOURCES`.
5. **Notifications**: Scripture pop-ups are local (no push server). Server push (new messages, prayer updates) still needs Expo
   push tokens or FCM/APNs on your backend.
6. Coins are simulated locally (`buyCoins`). Real purchases need in-app purchases (Google Play Billing / StoreKit) verified by
   your backend, and coin balances should move server-side.

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

- **Bible** – full KJV offline, 56 more translations streamed and cached (or downloaded) on demand, highlights, notes (edit / delete / undo), bookmarks, compare, reading themes,
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
licensed (copyrighted) translations, speech-to-text for sermon transcripts, payments for coins/gifts,
server push notifications, and a hosted AI model for Bible Chat (it currently answers from the bundled Scripture and lexicon).

## Run

```bash
npm install
npx expo start         # Expo Go / web preview (ads show as demo ads)
npx expo run:android   # or: eas build --profile development — needed for real AdMob ads
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
| Social feed (§1.11) | `SocialsScreen` (feed + videos merged) |
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
src/data/bible.js           books, bundled KJV, verse of the day, search, cross-refs
src/bible/                  translation catalog, chapter loader + offline cache, commentaries & Strong's lexicon, data URLs
src/ads/                    AdMob wrapper (useAds) with demo fallback, ad unit ids and AD_RULES
src/notifications/          Scripture pop-ups scheduling and content
src/data/seed.js            communities, people, prayers, calendar, plans, courses, live, recordings, feed
src/data/assistant.js       grounded local responders for Bible Chat and Scripture Companion
src/screens/                HomeScreen, BibleScreen, GodModeScreen, PrayerScreen, DiscoverScreen, MoreScreens
```

## Connecting a backend

Replace `src/data/*` with API calls that return the same shapes. `answerBibleChat` and
`companionResults` are the seams for the OpenAI Responses API + retrieval described in §1.7.3 / §1.8.
Chat, live, payments, auth and licensed Bible text need the services listed in §1.22.
