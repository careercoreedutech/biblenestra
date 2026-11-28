# BibleNestra: App Documentation

*Version: November 2026 (branch `v8.2`). Prepared for the BibleNestra team.*

BibleNestra is a Christian app for studying the Bible and connecting with other believers. It combines:
- a full Bible study suite;
- an AI Scripture Companion;
- a social network with chats, groups and channels;
- paid membership groups;
- contests;
- fundraising ("Fund Me");
- virtual gifts;
- a faith-based dating area ("Find Love").

It is a mobile app for Android and iOS. A secure server and a web admin dashboard run it.

---

## Contents

1. [At a glance](#1-at-a-glance)
2. [Getting started: sign-in and onboarding](#2-getting-started-sign-in-and-onboarding)
3. [How the app is organised](#3-how-the-app-is-organised)
4. [Features in detail](#4-features-in-detail)
5. [Money: payments, coins, fees and payouts](#5-money-payments-coins-fees-and-payouts)
6. [Safety, moderation and privacy](#6-safety-moderation-and-privacy)
7. [Upcoming features](#7-upcoming-features)
8. [The admin dashboard and staff roles](#8-the-admin-dashboard-and-staff-roles)
9. [Technical overview](#9-technical-overview)
10. [Builds, releases and operations](#10-builds-releases-and-operations)
11. [Open items and known gaps](#11-open-items-and-known-gaps)

---

## 1. At a glance

| | |
|---|---|
| **Platforms** | Android (APK / Play Store), iOS (TestFlight / App Store), and a web build for testing |
| **App technology** | React Native with Expo SDK 52 |
| **Server** | Cloudflare Worker (Hono) at `https://biblenestra-api.lightddarkness.workers.dev` |
| **Database** | Neon Postgres |
| **File storage** | Cloudflare R2 (photos, video, audio, PDFs) |
| **Sign-in** | Clerk (Google, Apple, email code, email and password) |
| **Payments** | Paystack, for every in-app purchase and donation: card, bank transfer, USSD |
| **AI** | Cloudflare Workers AI: scripture companion, exegesis, sermon notes, blog, contest questions, photo checks |
| **Admin** | Web dashboard at `/admin` on the server, with staff roles |
| **Bundle / package ID** | `com.biblenestra.app` |

---

## 2. Getting started: sign-in and onboarding

1. **Intro slides.** Four swipeable slides, shown once per install, with a Skip button:
   - Study the Word
   - Your Scripture Companion
   - Meet fellow believers
   - Daily Bread
2. **Sign in.** Choose one of:
   - Continue with Google;
   - Continue with Apple (iPhone only);
   - email with a 6-digit code;
   - email and password.

   The Terms of Service and Privacy Policy are linked on this screen.
3. **Welcome setup.** Name, preferred Bible translation, and scripture notifications. Shown only when the account has no name yet, and it can be skipped.
4. **Plans screen.** Shown once, offering BibleNestra Plus. "Continue free" skips it.

Every new account gets a small welcome coin bonus.

---

## 3. How the app is organised

The app has **four bottom tabs**:

| Tab | What it holds |
|---|---|
| **Today** | Daily rhythm: verse, reading, prayer, reflection; streaks; Daily Bread; videos |
| **Bible** | The Bible reader and all study tools |
| **Discover** | The hub: Memberships, Find Love, Prayer Wall, Fund Me, Contests, Learn, Jobs, Care, Library and more |
| **Socials** | Feed and Videos (reels), plus Chats, Groups and Channels |

**Profile** opens from the avatar button. It has these sections:
- Profile
- Wallet & Gifts
- Creator
- Jobs
- Study
- Notifications
- Privacy
- Account

**Create** (the + button) lets a member start any of these:
- a post
- a prayer request
- a wish
- a study
- an event
- a sermon recording
- a resource
- a group
- a live stream

**Deep links** (`biblenestra://…`) open Daily Bread, prayer, a Bible passage, the Companion, an invite (`invite/<code>`) or a group invite (`join/<code>`) directly.

---

## 4. Features in detail

### 4.1 Today

- **Greeting, week strip and streak.** One "grace day" per rolling 7 days keeps the streak alive.
- **Four daily steps:** Verse, Reading, Prayer, Reflect.
- **Daily Bread:** the verse of the day. You can listen to it, share it as an image, save it, or open the chapter.
- **Blessing videos** chosen by the team, plus "Watch: From Our Channels".
- **Shortcuts:** Ask Scripture, Companion, Library.
- **Price:** free.

### 4.2 Bible

- **Translations:** about 90, grouped by language.
  - The **KJV is built in and works offline**.
  - Others load online, with the required attribution shown under each chapter.
- **Reader:**
  - Paper, Sepia and Night themes;
  - font, size and line spacing;
  - full-screen reading.
- **Tap a verse to:**
  - read the commentary;
  - get the exegesis (an 11-part deep study, made by AI and cached so it opens instantly the next time);
  - see cross references;
  - do a word study;
  - compare translations;
  - listen;
  - share it as an image;
  - read it word by word;
  - Ask AI;
  - post it to the feed;
  - turn it into a prayer request;
  - memorise it;
  - highlight it or add a note.
- **Search:** the whole Bible, with Old/New Testament and book filters. Results load 50 at a time.
- **Concordance:** Strong's numbers, with Thayer's Greek and BDB Hebrew lexicons.
- **Beyond the 66:** deuterocanonical and other historic books (public domain). The reader remembers your place in each.
- **Price:** free.

### 4.3 Scripture Companion and Ask Scripture (AI)

- **Scripture Companion.** You describe what you're going through. You get back:
  - at least 7 scriptures (taken from the real Bible text), each explained;
  - words of encouragement;
  - a personal prayer.

  If you mention a crisis, the reply shows helplines for your country first.
- **Ask Scripture.** A chat about the Bible, with or without a passage as context. Conversations can be started fresh, shared or deleted.
- **Price:** free.

### 4.4 Prayer

- **Prayer Wall.** You can:
  - post a request, either public or for a chosen audience;
  - post it anonymously;
  - add a Bible reference.
- **Praying for others:** tap "I prayed" on a request. The author sees the count and can post updates or mark the request answered.
- **Prayer candles**, and a live count of active prayers on Discover.

### 4.5 Reminders and notifications

- **Personal reminders** at a time you choose, and a daily Bible verse.
- **Scripture pop-ups:** a verse or prayer at an interval you set. Quiet hours are 22:00 to 07:00 by default.
- **Daily moments:**
  - morning scripture;
  - midday prayer;
  - evening encouragement;
  - devotional;
  - church community;
  - team broadcasts.
- **Push notifications** for messages, gifts, matches, prayers, job alerts and broadcasts.

### 4.6 Learn

- **Sections:**
  - **Plans** and **Devotionals.**
  - **Memorize:** verse practice.
  - **Courses:** written by the team in the admin, with "Mark as complete" and a progress bar.
  - **Games:** Trivia, Who Said It, Scramble, Chronology. There's a new daily set every day.
  - **Badges.**
- **Coins from games:**
  - 5 coins per correct answer in the day's first round;
  - a streak bonus of up to +100;
  - endless practice after the daily set, with no coins.
- **Ads:** one ad after every 4th question. BibleNestra Plus removes game ads.

### 4.7 Discover (the hub)

- **Top toggle:** **Memberships | Find Love.**
- **Quick grid:**
  - Prayer
  - Chats
  - Record
  - Audio & Books
  - Contests
  - Learn
  - Ask AI
  - Calendar
  - Reminder
  - Library
  - Jobs
  - Opportunities
  - Websites
  - Care
  - Fund Me
- **Sections:**
  - Prayer Wall
  - Fund Me
  - Contests
  - Memory verse
  - Live rooms
  - Paid channels
  - Churches & Live Fellowship (Communities, Find Believers, Wishes)
  - Calendar
  - Channels & Broadcasts
  - Opportunities
  - Bible games

### 4.8 Chats, groups and channels

- **Chats:** one-to-one messages. Anyone can message anyone. New conversations from strangers arrive as **message requests**, which you can accept, decline or block.
- **Groups:** everyone can talk.
- **Channels:** only admins post, and anyone can follow.
- **Messages can carry:**
  - text;
  - photos;
  - video (up to 95 MB);
  - documents (up to 50 MB);
  - voice notes (up to 20 MB).
- **Message tools:**
  - replies and forwards;
  - reactions;
  - edits and pins;
  - in-chat search;
  - @mentions;
  - typing indicators, read receipts and online status.
- **Group tools:**
  - admins and roles;
  - member list;
  - join requests;
  - invite links;
  - permissions;
  - slow mode;
  - shared media;
  - mute, report and leave.
- **Free limit:** 5 new chats.
  - Friends you invited don't count against the limit.
  - **Plus** removes the limit.
  - A **Chat Week Pass**, bought with coins, adds extra chats for a week.

### 4.9 Socials

- **Feed and Videos (full-screen reels).**
- **Posts:** you can post:
  - text (reflection, verse, testimony, question or announcement);
  - photos;
  - videos up to 2 hours / 2 GB, compressed on the phone to 720p.
- **Engagement:**
  - likes and long-press reactions;
  - comments, which can be liked;
  - sharing;
  - following;
  - **virtual gifts**.
- **Ads:** a small ad after every 3 posts, and a short ad before every 3rd video.
- **Profiles:** banner (3:1), avatar, name, handle, headline, bio, church, country, followers.
- **Activity inbox:** comment likes, gifts, job notices, broadcasts.

### 4.10 Membership groups: MASTER CLASS and EXECUTIVE CLASS

- **Format:** paid, Telegram-style groups, at two levels, **MASTER CLASS** and **EXECUTIVE CLASS**.
- **Finding a group:** Discover shows a catalogue you can sort by trending, newest or price. Paid channels also show on Discover, and "My Channels" in Socials.
- **Joining:** one of:
  - **free join**;
  - **request to join** (an admin approves);
  - **paid checkout** through Paystack (promo codes supported).
- **Inside a group:** the chat, **Library**, **Media**, **Members** and **Settings**.
  - A welcome message shows once, when a member joins.
  - When a membership lapses, a **Renew** button appears.
- **Admins can:**
  - mute, remove or ban members;
  - make other admins and set their permissions;
  - handle join requests;
  - share an invite link;
  - edit the welcome text and group media;
  - share posts into the group.
- **Prices:** set per group by its creator or the admin.

### 4.11 Contests and Bible battles

- **Contests:** Discover, My Contests, Leaderboards, Hall of Fame.
- **Entry types:**
  - **quiz** contests;
  - **creative** contests: image, video, audio or text.

  Voting is free, one vote per person. Winners get certificates.
- **Points:**
  - 10 per correct quiz answer;
  - 20 per creative entry;
  - +100, +60 and +40 for 1st, 2nd and 3rd;
  - 15 per battle won.
- **Prizes:** coin prizes for the top 3, plus any written prize.
- **Organisers can:**
  - create a contest (AI can draft quiz questions);
  - add judges and sponsors;
  - manage entries.

  Every contest needs admin approval before it goes live.
- **Bible Battles:** live one-on-one quizzes, 8 questions, 12 seconds each. The server keeps the clock and the score, so nobody can cheat.

### 4.12 Fund Me (fundraising)

- **Starting a fundraiser:** title, goal, photo, story, supporting photos and PDFs (under 10 MB each), then preview and submit. **Every fundraiser is reviewed** before it goes public.
- **Credits:** publishing a fundraiser costs **1 Fund Me credit**. Members can buy credits and gift them to others (up to 500 at a time).
- **Donating:**
  - Currencies: NGN, USD, GBP and EUR. Donors see amounts in their own currency, converted at **live exchange rates**.
  - Limits: ₦500 to ₦5,000,000 per donation; 1 to 10,000 in USD, GBP or EUR.
  - **"Cover the fees":** the donor can choose to pay the fees, so the beneficiary gets the full amount.
- **Fees, payouts and identity checks:** see [section 5.3](#53-fund-me-fees-and-payouts).

### 4.13 Wallet and coins

The wallet holds several balances:

| Balance | How you get it | What it's for |
|---|---|---|
| **Fund Me credits** | Buy | Publishing fundraisers, gifting to others |
| **Dating Coins** | Buy (VIP includes a monthly bonus) | Find Love extras (Super Like, boosts…) |
| **Gifting Coins** | Buy | Sending virtual gifts |
| **Kingdom Coins** | Free: games, rewarded ads, contest prizes | Job bids, chat passes, gifts |
| **Gift earnings** | Received gifts (after commission) | Withdraw to a bank (see section 5) |

The wallet shows earnings as pending, available, withdrawing and withdrawn. Every purchase goes through **Paystack**.

### 4.14 Virtual gifts and live

- **What gifts are:** animated gifts priced in Gifting Coins (1 coin = ₦1). The catalogue runs from ₦200 to ₦100,000.
- **Where you can send them:** on posts, profiles, chats and **live streams**.
- **Gifts to BibleNestra:** members can send gifts to the **official BibleNestra account** to support the platform.
- **Live Bible study:** a shared passage that the teacher controls.

### 4.15 Find Love (Christian dating)

Find Love is a separate, carefully designed area for people **18 and over**. Matching is **man and woman only**, and both people must say yes.

- **Flow:**
  1. intro;
  2. profile set-up (up to 6 photos, bio, faith details);
  3. **Discover** (a card stack: swipe or tap);
  4. **Likes**;
  5. **Matches**;
  6. chat.
- **Free tier:**
  - 50 swipes a day;
  - likes;
  - each chat unlocks **5 free messages after a short rewarded ad**, and 5 more after a second ad;
  - block and report at any time.
- **Paid in Dating Coins:**

  | Feature | Coins |
  |---|---|
  | Super Like | 10 |
  | Priority Like | 15 |
  | Message request (before a match) | 25 |
  | See who liked you (24 hours) | 30 |
  | Extra swipes | 30 |
  | Message bundle | 20 |
  | Boost 30 min / 1 h / 3 h | 100 / 180 / 400 |
  | Spotlight (24 h) | 250 |
  | Free boost | one free 30-minute boost included |

- **Subscriptions** (monthly, through Paystack):
  - **Dating Plus**, ₦1,500: 200 swipes a day and more.
  - **Dating VIP**, ₦3,500: includes 300 bonus coins and 2 boosts a month.
- **Verified badge:** the member takes a live selfie and a photo of their ID. An AI pre-check helps, but **a person on the team approves every badge**. The automatic BVN/NIN check is an [upcoming feature](#7-upcoming-features).
- **Privacy:** a dating chat shows the other person's normal social profile only if they are verified.
- **Safety:** see [section 6](#6-safety-moderation-and-privacy).

### 4.16 Jobs and Opportunities

- **Jobs:**
  - browse, post work, send proposals and place bids;
  - a bid costs **20 Kingdom Coins**, which a member can unlock by watching rewarded ads.
- **Opportunities:** a directory imported from outside sources and credited to them. It covers:
  - jobs and remote work;
  - internships;
  - scholarships, fellowships and grants;
  - hackathons;
  - volunteering.

  You can filter, search and save listings. "Apply" opens the original site.

### 4.17 Care network

- **Talk to a Priest:** a verified directory. You can open a profile, start a private chat, or apply to be listed.
- **Talk to an Apostle:** opens the Apostle's inbox when the Apostle is available.

### 4.18 Media, audio and video

- **Audio & Books:**
  - an audio library and Christian books (PDF);
  - search, featured items, categories, Play All;
  - personal and group uploads: audio up to 95 MB, PDF up to 60 MB;
  - the book reader remembers your last page.
- **Record (Sermon Studio):** recordings up to 60 minutes, turned into a searchable transcript and **AI sermon notes**.
- **Watch:**
  - YouTube channels chosen by the team, played inside the app;
  - **YouTube Live**, with a full-screen player and a comment thread the team moderates.
- **Member websites:** a directory with a viewer inside the app.

### 4.19 Community

- **Calendar:** events, with RSVP.
- **Communities:** churches and study circles, sorted by category and region.
- **Find Believers:** people search, with verified badges.
- **Wishes:** prayer wishes.

### 4.20 Invites and referrals

- **Your invite:** a personal invite link and code. You can see who joined through you.
- **Late redemption:** "Have an invite code?" for people who installed the app before opening the link.
- **Bonus:** invited friends can chat with you on the free plan.

### 4.21 BibleNestra Plus (subscription)

- **Price:** **Yearly ₦25,000** or **Weekly ₦1,500**. The admin can change prices.
- **Benefits:**
  - no ads in games;
  - unlimited conversations;
  - a supporter badge.
- **Renewal:**
  - card payments renew automatically until cancelled;
  - bank transfer and USSD payments don't renew, and you get a reminder before the plan ends.
- **Free trial:** none.

### 4.22 Profile and account

- **Profile:**
  - cover and avatar;
  - bio and church;
  - visibility;
  - a "Plus supporter" badge;
  - followers.
- **Account:**
  - your plan;
  - **delete account**, which removes your profile, content, files and login;
  - erase the data stored on the phone.

---

## 5. Money: payments, coins, fees and payouts

### 5.1 Payments

- **Paystack for everything.** Every payment goes through **Paystack**, on Paystack's own secure page, by card, bank transfer or USSD. Google Play billing and Apple in-app purchase are **not** used (the client decided this on 21 Nov 2026).
- **Confirmation:** each payment is confirmed directly with Paystack before anything is given, and **is never granted twice**, even if Paystack retries.
- **Saved cards** are kept as Paystack tokens for monthly renewals. BibleNestra never sees or stores the card number.
- **Pause switch:** the admin can pause all in-app payments instantly (`paystack_in_app`).

### 5.2 Default prices

All prices can be changed in the admin.

| Product | Options |
|---|---|
| **Fund Me credits** | 7 for ₦350 · 15 for ₦700 · 30 for ₦1,300 · 50 for ₦2,000 · 100 for ₦3,500 · 200 for ₦6,000 |
| **Dating Coins** | 100 for ₦350 · 250 for ₦700 · 500 for ₦1,300 · 1,000 for ₦2,500 · 2,500 for ₦5,000 · 5,000 for ₦9,000 · 10,000 for ₦15,000 |
| **Gifting Coins** | 1 coin = ₦1; seven packs, from 500 coins (₦500) to 100,000 coins (₦100,000) |
| **Dating Plus / VIP** | ₦1,500 / ₦3,500 a month |
| **BibleNestra Plus** | ₦25,000 a year · ₦1,500 a week |
| **Membership groups** | set by each group |

### 5.3 Fund Me fees and payouts

| Rule | Setting |
|---|---|
| BibleNestra fee | **2%** of each donation |
| VAT on fees | 7.5% |
| Paystack fee | about 1.5% + ₦100 (the ₦100 applies from ₦2,500), capped at ₦2,000 |
| Who pays fees | The donor if they tick "cover the fees", otherwise deducted from the beneficiary |
| Hold before payout | **7 days** |
| Payout schedule | **Monthly**, on the 1st |
| Smallest payout | ₦1,000 |
| Refunds | None after payout (staff can refund errors or fraud only) |
| Sent to review | Goals of ₦10,000,000 or more; single donations of ₦500,000 or more; accounts under 7 days old |

**Identity check (KYC) before any payout:**
1. The member submits their BVN, NIN or another national ID, their legal name, and a bank account.
2. Paystack looks up the bank account name, and it must match the legal name.
3. **A staff member checks the ID by hand and approves it.**
4. ID and bank numbers are **encrypted**, and staff see only the last digits.

For now, staff send payouts by bank transfer and record the reference in the admin. Automatic Paystack transfers can be switched on later (`FUNDME_AUTO_PAYOUTS`).

### 5.4 Gift earnings

| Rule | Setting |
|---|---|
| Commission | BibleNestra keeps **20%** of every gift; the receiver gets 80% |
| Hold | **14 days** before earnings can be withdrawn |
| Minimum withdrawal | **$10** (about ₦15,000 at ₦1,500/$) |
| Withdrawals | Off until the admin switches them on; KYC needed (as in 5.3) |
| Daily sending cap | 1,000,000 coins per sender |
| Purchased coins | Can never be withdrawn as cash |

### 5.5 Exchange rates

- **Source:** live rates from open.er-api.com, refreshed at most every 6 hours and credited as the licence requires.
- **Safety check:** if a rate moves by more than 25% at once, it is **not** applied and is flagged for the admin.
- **Manual control:** the admin can edit rates by hand or switch automatic updates off.

---

### 5.6 Creator plans and withdrawals

Every membership creator is on one plan. Creating and publishing a membership needs a plan first (Free counts). Prices are in USD; Paystack settles in naira, so a paid plan is charged in NGN at the live USD rate, locked when the payment starts. (If Paystack is set up to accept USD, the plan is charged in USD.)

| Plan | Price | Withdrawal fee (BibleNestra) | Members joining |
|---|---|---|---|
| Free | Free | 0.5% (admin setting) | One ad a day per account, across all Free-plan memberships |
| Standard | $10.24 a month | 0.3% | Ad-free |
| Premium | $43.78 a month | 0.131% | Ad-free |

- **Paid plans** renew monthly by saved card. Bank and USSD payments get a reminder three days before the period ends and must be paid again in the app.
- **Upgrades** are immediate and charged in full for one month (no proration).
- **Downgrades** to Free take effect at once. A downgrade between paid plans starts at the end of the period.
- **Lapsed or failed payments** (three declined renewals, or a paid period that ends unpaid) stop new memberships and new publishing until the creator renews or switches to Free. Existing memberships keep running.
- **Withdrawals** need an approved identity check (KYC). The BibleNestra fee is calculated on the amount requested, using the plan that is active at that moment, and is shown apart from gateway and bank charges. An admin approves the request, pays it outside the app and records the reference and any bank charge.
- **Admin settings** (Memberships tab → Creator plans): plan names, prices, withdrawal fees, ads on joining, whether each plan is offered, the minimum withdrawal, and the join ad switch. The old per-membership creation fee is switched off by default.

## 6. Safety, moderation and privacy

- **Reports:** members can report posts, comments, users, prayers, jobs, groups, library items and dating profiles. Reports go to the admin **Reports** queue, where staff can remove the item, ban the member, or dismiss the report.
- **Find Love safety:**
  - minimum age **18**, with date of birth confirmed;
  - a profile is **hidden automatically after reports from 5 different members**, until staff restore it or ban the member;
  - **AI photo check:** new dating photos go live straight away unless the AI flags them (nudity, minors, violence, no face). If the AI is unsure or down, the photo waits for a person;
  - block and report from any screen;
  - closed dating chats are deleted **2 years** after closing. Reports are kept with the safety log.
- **Crisis care:** the Companion puts local helplines first when someone shows signs of crisis.
- **Account deletion:** deletes the member's data, uploaded files and login. A log without personal details is kept. Accounts with fundraisers that hold real money are blocked from deleting until those are settled.
- **Card and ID data:** card numbers are handled only by Paystack. ID and bank numbers are encrypted.
- **Audit log:** every admin and staff action is recorded, with who did it.

---

## 7. Upcoming features

These are planned or partly built, but **switched off** for members today.

| Feature | Status | What's needed to switch it on |
|---|---|---|
| **Automatic BVN / NIN ID check (Dojah)** | Code ready but **switched off**. The app shows "Coming soon" on the Find Love verification and payout ID screens. Staff check every ID by hand meanwhile. | 1. Dojah business verification (company details and CAC documents, directors' BVN and ID, a live website, the signed MSA). 2. Dojah live keys. 3. Server secrets `DOJAH_APP_ID`, `DOJAH_SECRET_KEY` and `DOJAH_ENABLED=true`. |
| **Automatic payouts (Paystack Transfers)** | Built, off | Paystack enables Transfers; set `FUNDME_AUTO_PAYOUTS` |
| **Gift-earnings withdrawals** | Built, off | Admin switch `earnings_withdrawals_enabled` |
| **Paid contest entry and paid votes** | Shown as "opens soon" | Further build |
| **Talk to an Apostle** | Shows "Coming soon" while no Apostle is available | Admin sets the Apostle account |
| **iPhone push notifications** | Android push works; the iOS push key isn't created yet | Apple push key (needs an Apple sign-in) |
| **iOS ads** | Uses Google test ads | AdMob iOS app ID and ad unit IDs |

**How the Dojah check will work when it's switched on:**
- **For payouts:** Dojah looks up the member's BVN or NIN record. Its name must match both the legal name and the bank account name. Staff still approve each case.
- **For the Find Love badge:** Dojah compares the live selfie with the ID photo, and a match is marked "Dojah matched" for a quick decision. **Nothing is ever approved automatically.**
- **What is stored:** only the ID type, the last 4 digits and the result. Never the ID record or its photo.

---

## 8. The admin dashboard and staff roles

### 8.1 Dashboard

The admin dashboard is at **`https://biblenestra-api.lightddarkness.workers.dev/admin`**. Its tabs:

| Area | What you can do |
|---|---|
| Dashboard | Key statistics |
| Users, Deletions | Find members, ban or unban them, adjust coins or Plus; account-deletion log |
| Content, Communities & events, Reports | Moderate posts, comments, prayers, communities and events; work the report queue |
| Member websites, Priests, Apostle | Approve sites; manage the priest directory and the Apostle setting |
| Announcements, Broadcasts | In-app announcements; messages to every inbox or to Socials |
| Fund Me | Approve fundraisers; KYC reviews; donations, payouts, refunds; fees, holds, exchange rates |
| Wallets & payments | Wallets and ledger; Paystack settings and payments; coin packs and prices; chat passes |
| Gift catalogue | Gifts, prices, commission, hold, withdrawal rules |
| Dating | Verification requests, reports, photo review, prices, rules (swipes, ads, auto-hide, retention) |
| Memberships | Paid groups, plans, subscribers |
| YouTube, Daily Bread & Videos | Channels, live alerts, Today content |
| Blog, Courses & Devotionals, Audio & Books, Opportunities | Content management, including AI blog drafting |
| Contests | Approvals, disputes, judges, sponsors |
| Ads | Ad rules and statistics |
| Audit log | Every admin and staff action |
| Staff | Invite staff and set roles (owner only) |

### 8.2 Staff roles

The owner invites staff by a **one-time link**, and each staff member gets a role:

| Role | Access |
|---|---|
| **Owner** | Everything, including Staff and Settings |
| **Finance** | Fund Me, wallets and gifts (manage); overview |
| **Moderator** | Users, moderation and dating (manage); overview |
| **Content editor** | Blog, library, courses, contests and opportunities (manage); overview |
| **Viewer** | View everything except Staff and Settings; cannot change anything |
| **Custom** | Only the areas ticked, each set to view or manage |

**Security rules for staff accounts:**
- passwords must be at least 10 characters, and are stored hashed;
- 5 wrong passwords lock the account for 15 minutes;
- sessions last 12 hours;
- disabling a staff member or changing their role takes effect immediately;
- every change a staff member makes is written to the audit log.

---

## 9. Technical overview

### 9.1 Architecture

```
 Mobile app (Expo / React Native)
        │  HTTPS + WebSocket (realtime chat, presence)
        ▼
 Cloudflare Worker "biblenestra-api" (Hono)
   ├─ Neon Postgres  ── all data (schema: backend/db/schema.sql)
   ├─ R2 "biblenestra-media" ── photos, video, audio, PDFs, chat files
   ├─ Workers AI ── companion, exegesis, sermon notes, blog, photo checks
   ├─ Durable Object "Hub" ── realtime messaging and presence
   └─ Cron every 15 min ── renewals, payouts, FX, contests, retention, blog
        │
        ├─ Clerk (sign-in) · Paystack (payments) · Expo Push
        ├─ AdMob (rewarded-ad verification) · YouTube
        └─ open.er-api.com (FX) · Dojah (ID check: upcoming)
```

### 9.2 Code layout

| Folder | Contents |
|---|---|
| `App.js`, `src/navigation.js` | App entry and screen routes |
| `src/screens/` | One file per feature area (Bible, Chat, FindLove, FundMe, Membership groups…) |
| `src/components/` | Shared UI (chat kit, Find Love cards, wallet sheets, Paystack button…) |
| `src/api/` | Calls to the server |
| `backend/src/index.js` | Server entry: routes, auth, cron |
| `backend/src/routes/` | API routes per feature |
| `backend/src/lib/` | Business logic and the admin pages |
| `backend/db/schema.sql` | Database schema (append-only, safe to re-run) |
| `backend/test/` | Automated tests (461 passing) |

### 9.3 Sign-in and access

- **Members:** sign in with Clerk. The server checks every request's token.
- **The owner:** signs in to the admin with the admin password.
- **Staff:** sign in with their own staff accounts.

### 9.4 Server settings (secrets and variables)

Secrets are set with `npx wrangler secret put NAME` and are never stored in the code.

| Name | Needed for |
|---|---|
| `DATABASE_URL` | Database (required) |
| `CLERK_SECRET_KEY` (+ optional `CLERK_JWT_KEY`) | Member sign-in (required) |
| `ADMIN_PASSWORD` | Owner sign-in to the admin |
| `REALTIME_SECRET` | Signs chat tickets and admin/staff sessions (set it explicitly) |
| `FUNDME_DATA_KEY` | Encrypts bank and ID numbers. Set it once and never change it |
| `MEDIA_SIGNING_SECRET`, `DATING_AD_SECRET`, `FUNDME_SIGNING_SECRET` | Signed links (recommended) |
| `PAYSTACK_SECRET_KEY` | Payments |
| `YOUTUBE_API_KEY` | YouTube Live status |
| `JOOBLE_API_KEY` | Opportunities import |
| `DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, `DOJAH_ENABLED` | ID check (upcoming) |

Production must keep **`AUTH_DEV_MODE=false`** and **`ADS_CLIENT_CLAIM=false`**.

### 9.5 AI models (Cloudflare Workers AI)

| Use | Model |
|---|---|
| Companion, exegesis, blog | Llama 3.3 70B (with fallbacks) |
| Sermon transcription | Whisper large v3 turbo |
| Sermon notes, contest questions | Llama 3.1 8B |
| Companion meaning search | BGE base embeddings |
| Dating photo checks | Llama 4 Scout (vision), then Llama 3.2 Vision, then LLaVA |

---

## 10. Builds, releases and operations

| Task | Command / place |
|---|---|
| Run the tests | `cd backend` then `npm test` |
| Deploy the server | `cd backend` then `npx wrangler deploy` |
| Database changes | Run the new block of `backend/db/schema.sql` in the Neon SQL editor (production branch) |
| Android APK (testing) | `npx eas-cli build -p android --profile preview` |
| iOS TestFlight | `npx eas-cli build -p ios --profile testflight --auto-submit` |
| Expo / EAS project | account `dental112` |
| App Store Connect | app "BibleNestra", Team INCOMIO LIMITED |
| Source code | https://github.com/careercoreedutech/biblenestra (branches `master` and `v8.2`) |

**Release status (27 Nov 2026):**
- The **latest Android APK** and the **iOS TestFlight build** were made **before** the MASTER/EXECUTIVE CLASS screens and the "Coming soon" ID-check change.
- A new build is needed to include them.

---

## 11. Open items and known gaps

**Needed from the client:**
- Clerk production keys and domain (sign-in still uses Clerk's test environment).
- AdMob iOS app ID and rewarded ad unit IDs.
- Paystack:
  - USD settlement;
  - two-step login;
  - support and dispute email;
  - approval of the donations use case.
- Dojah business verification (see [section 7](#7-upcoming-features)).
- Store listings: screenshots, descriptions, privacy answers.
- TestFlight testers.
- Legal review of the Terms and Privacy Policy.
- Confirmation of three proposed values:
  - the coin value at payout;
  - the gift coin rate;
  - the ₦1,000 minimum Fund Me payout.

**Known gaps in the app (to tidy before public launch):**
- The "God Mode / Scripture Intelligence" home screen exists in the code but has no button that opens it.
- Group study settings show sample data ("Matthew · weekly").
- The Clip Farm guild screen still has placeholder text.
- The streak history is pre-filled with sample days on first launch. Check this for new accounts.
- An older gift route (70% creator share) is still on the server alongside the current one (80/20). Confirm the app uses only the current one, then remove the old route.
- Some setup notes (`SETUP.md`, the secrets comment in `wrangler.toml`) are out of date.
