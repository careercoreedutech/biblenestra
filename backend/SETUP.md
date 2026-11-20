# BibleNestra backend — setup guide

No server to buy. The backend runs on services that all have free tiers:

| Piece | Service | What it does |
|---|---|---|
| API | **Cloudflare Workers** | The app talks only to this. Code: `backend/src` (Hono). |
| Database | **Neon** (Postgres) | Users, posts, prayers, jobs, bids, coins, ad rewards, games. Schema: `db/schema.sql`. |
| Login | **Clerk** | Google, Apple and email-code sign-in. The Worker verifies Clerk session tokens. |
| Photos & videos | **Cloudflare R2** | Photos (≈1600 px JPEG) and videos (720p MP4, compressed on the phone) are uploaded through the Worker and served from `/media/…` or your own domain. Live services use YouTube Live. |
| Ads | **AdMob SSV** | Google calls the Worker after each rewarded ad, so coins can't be faked. |

```
 App (Expo) ──Clerk token──▶ Cloudflare Worker ──▶ Neon Postgres
                                │  └─▶ R2 (photos + 720p videos)
 Google AdMob ──signed reward callback──▶ Worker
```

## 0. Try it locally first (no accounts needed)

```bash
cd backend
npm install
npm test                 # 12 end-to-end tests against an in-process Postgres
npm run dev -- --seed    # API on http://localhost:8787 with demo content; auth with header  X-Dev-User: alice
```
In the app's web preview open `http://localhost:8081/?api=http://localhost:8787&devUser=alice` to use it.

## 1. Neon (database)
1. Create a project at neon.tech (pick the region closest to most users, e.g. AWS Europe/Frankfurt for Nigeria).
2. Copy the **pooled** connection string (`postgresql://…-pooler…/neondb?sslmode=require`).
3. Create the tables — either paste `db/schema.sql` into Neon's SQL Editor and run it, or:
   `psql "<connection string>" -f db/schema.sql`
4. (Optional, staging only) `db/seed-demo.sql` loads fictional demo posts. Don't load it into production.

## 2. Clerk (login)
1. Create an application at clerk.com; enable **Email (code)**, **Google** and **Apple**.
   Apple requires "Sign in with Apple" on iOS whenever Google sign-in is offered.
2. Under **Native applications**, add the app's bundle id / package name and allow the redirect URL the app uses
   (see the app's README for the scheme).
3. Copy the **Publishable key** (for the app: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`) and the **Secret key** (for the Worker).
4. Optional but faster: copy the **JWT public key** (API keys → Show JWT public key → PEM) for `CLERK_JWT_KEY`.

## 3. Cloudflare (Worker + R2)
```bash
cd backend
npx wrangler login
npx wrangler r2 bucket create biblenestra-media
npx wrangler secret put DATABASE_URL          # Neon pooled connection string
npx wrangler secret put CLERK_SECRET_KEY      # sk_live_…
npx wrangler secret put CLERK_JWT_KEY         # optional (PEM)
npm run deploy                                # → https://biblenestra-api.<you>.workers.dev
```
**Recommended:** in the R2 dashboard connect a custom domain to the bucket (e.g. `media.biblenestra.com`) and set
`PUBLIC_MEDIA_BASE = "https://media.biblenestra.com"` in `wrangler.toml`, then deploy again. Photos and videos are then
served and cached by Cloudflare's CDN directly (with byte-range support for video) instead of through the Worker.

Check: `curl https://biblenestra-api.<you>.workers.dev/health` → `{"ok":true,"db":true}`.

## 4. AdMob (rewarded ads that can't be faked)
1. Create your AdMob app and two ad units (Rewarded, Interstitial); put the ids in the app (`src/ads/config.js`, `app.json`).
2. On the **rewarded** ad unit: Advanced settings → **Server-side verification** → callback URL
   `https://biblenestra-api.<you>.workers.dev/ads/ssv` → Verify.
3. Keep `ADS_CLIENT_CLAIM = "false"` in production. (`"true"` only for demo/dev builds without real ads.)

## 5. The app
Create `.env` in the app root (see `.env.example`):
```
EXPO_PUBLIC_API_URL=https://biblenestra-api.<you>.workers.dev
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…
```
Then build with EAS (`eas build`). Without these two values the app runs in **local mode** (everything stored on the phone).

## Round 3 (v8) — what to do when deploying this version
1. **Database first.** In Neon create a backup branch (Branches → Create branch from `main`), then open the SQL Editor on
   `main` and run the whole `schema.sql`. It is idempotent (safe to run again) and adds: `comment_likes`,
   `users.banner_url`, `users.role`, `recordings`, `reminders`, `reminder_settings`, `youtube_channels`,
   `admin_actions`, `fundraisers`, `fundraiser_media`, `donations`, `fundme_payout_accounts`, and (v8.1 message actions)
   `message_reactions`, `message_hides`, `conversation_pins`, `messages.deleted_by`, and (v8.2 admin dashboard)
   `announcements`, `users.last_seen_at`, `users.banned_reason`, `communities.verified`, `communities.hidden`.
2. **Workers AI** (sermon transcription + notes): `wrangler.toml` already has `[ai] binding = "AI"`. Nothing else to buy —
   Workers AI has a daily free allowance; after that it's billed per use. `NOTES_MODEL` picks the notes model.
3. **Deploy:** `cd backend && npx wrangler deploy`. Check `/health`.
4. **Make yourself admin** (for `/admin` — dashboard, users, content, communities & events, announcements, reports, Fund Me review, YouTube channels). After that you can make other admins from the Users tab:
   `UPDATE users SET role = 'admin' WHERE clerk_id = 'user_…';` (your Clerk user id, from the Clerk dashboard).
   Optionally set `CLERK_PUBLISHABLE_KEY` in `wrangler.toml` so the admin page can sign you in.
5. **Payments:** leave `PAYMENTS_MODE` **unset** in production. `PAYMENTS_MODE=test` is only for local testing (fake
   checkout). Until a Stripe Connect or Paystack account is connected, fundraisers can be created, reviewed and shared,
   but Donate replies "Donations open soon".
6. Rebuild the app: `eas build --profile preview --platform android` (new native packages: webview, document picker, clipboard).

## Chat week pass (coins) — price and size
Free users who reach the new-chat limit (`CHAT_FREE_PLATFORM_SLOTS`, default 5) can spend coins on a **7-day chat
pass**. Admins (`users.role = 'admin'`) and subscribers never hit the limit and never see the sheet. Change the offer
with Worker vars (in `wrangler.toml` `[vars]`, or Cloudflare dashboard → Worker → Settings → Variables), then deploy.
No app release is needed: the app reads the offer from `GET /chat/allowance`.

| Var | Default | Meaning |
| --- | --- | --- |
| `CHAT_WEEK_PASS_COINS` | `100` | Price of one pass in coins (1 to 100000) |
| `CHAT_WEEK_PASS_EXTRA_SLOTS` | `10` | Extra **new** chats per pass (1 to 1000), or `unlimited` = no new-chat limit while the pass runs |

Buying again while a pass is active adds 7 days from the current expiry and adds the extra chats. When it expires,
chats already started stay open; only new chats are limited again. Purchases are listed in `/admin` → **Chat passes**
and in each user's coin history (reason `chat_week_pass`). Run `schema.sql` first (adds `chat_passes`,
`chat_slots.via_pass`, `users.chat_pass_*`).

**Buying coins with real money is not live.** It needs Google Play Billing (Phase 3). The one place that will credit
purchased coins is `creditPurchasedCoins()` in `src/lib/coinPurchases.js` (idempotent per Play purchase token). Until
then "Buy coins" opens the Kingdom Wallet with a "coming soon" note.

## Production checklist
- `PAYMENTS_MODE` not set (never `test`) in production.
- `AUTH_DEV_MODE="false"` and `ADS_CLIENT_CLAIM="false"` in `wrangler.toml` (they are by default).
- Add Cloudflare **rate limiting** rules for `/posts`, `/uploads/*`, `/ads/*` (Security → WAF → Rate limiting).
- Neon: enable **point-in-time restore** / branch backups.
- Set `CORS_ORIGINS` to your website's domain if you add a web app.
- Moderation: reports land in the `reports` table; set `users.banned = true` or `posts.removed = true` to act on them.

## Costs at launch (all have free tiers)
Workers free: 100k requests/day (paid plan $5/month when you outgrow it) · Neon free tier · Clerk free up to 50k monthly
retained users · R2: 10 GB free, then $0.015 per GB-month, and **no charge for bandwidth** — 10,000 one-minute 720p
videos (~150 GB) cost about $2/month to store, however often they're watched. Check current pricing before launch.
Note: uploads go through the Worker, and Cloudflare accepts request bodies up to 100 MB, so videos are capped at
3 minutes / 95 MB (a 3-minute 720p video is about 45 MB).

## What's in the database today (phase 1)
Accounts & follows, the social feed (text, photo, video posts, reactions, comments, saves, hides, shares, reports),
prayer wall (anonymous, audiences, praying, updates), jobs & bids (20-coin fee, charged atomically), coin ledger,
rewarded ads (support flames 4/day, 5 job ads → 20 coins), daily game rewards.
**Still on the device (next phase):** chats & groups, communities, calendar/events, gifts, notes/highlights sync,
reading plans, push notifications (the `push_tokens` table is ready).

---

## Phase 2 Setup & Real-time Durable Objects

### 1. Real-time WebSockets Secret
Generate a random secret (32+ characters) for WebSocket tickets:
```bash
cd backend
# generate or pick a 32+ character string
npx wrangler secret put REALTIME_SECRET
```
And locally in `backend/.dev.vars`:
```
REALTIME_SECRET=biblenestra-dev-realtime-secret-32-chars
```

### 2. Durable Objects Deployment
Phase 2 uses a Cloudflare Durable Object class `Hub` (SQLite-backed, WebSocket Hibernation API).
The configuration is already defined in `wrangler.toml`:
```toml
[[durable_objects.bindings]]
name = "HUB"
class_name = "Hub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Hub"]
```
When running `npm run deploy`, Cloudflare will apply the migration and register the `Hub` Durable Object on the free tier.

### 3. Push Notifications Setup (Expo Push Service)
1. **EAS Project ID**:
   - Ensure your Expo project has an `extra.eas.projectId` configured in `app.json`.
2. **Android (FCM V1 Credentials)**:
   - Go to Google Firebase Console → Project settings → Service accounts.
   - Generate a new private key (JSON).
   - In your terminal run `eas credentials` (or in expo.dev dashboard) → Android → Push Notifications → Upload Google Services JSON (FCM V1).
3. **iOS (Apple Push Notification service)**:
   - In Apple Developer Account → Keys → Create APNs Key (.p8).
   - Upload via `eas credentials` → iOS → Push Notifications.

