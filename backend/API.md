# BibleNestra API (Cloudflare Worker) — v1

Base URL: `EXPO_PUBLIC_API_URL` (e.g. `https://biblenestra-api.<you>.workers.dev`). All bodies are JSON unless noted.
Errors: HTTP 4xx/5xx with `{ "error": "message", "code": "SNAKE_CASE" }`.

## Auth
Every route except `GET /health`, `GET /media/*` and `GET /ads/ssv` needs
`Authorization: Bearer <Clerk session token>` (from `useAuth().getToken()` in `@clerk/clerk-expo`).
The first authenticated call creates the user row automatically.
Local development only: when the Worker runs with `AUTH_DEV_MODE=true`, the header `X-Dev-User: <any id>` is accepted instead.
The app also sends `X-TZ-Offset: <minutes east of UTC>` so that "today" (support flames, daily games) follows the phone's date.

## Shapes

```ts
User = { id, displayName, handle, avatarUrl, headline, bio, church, country, translation, kind, verified,
         followers, following, isFollowing?, isMe? }

Me = User & { coins, jobAdCredits, jobAdsNeeded: 5, supportAdsToday: number /*0..4*/, supportAdsDaily: 4,
              bidFee: 20, streak: number, bestStreak: number, graceUsedThisWeek: boolean,
              adsClientClaim: boolean /* true when the server accepts unverified ad claims (dev/demo) */ }

Post = {
  id, author: User, kind, text, createdAt /*ISO*/,
  passage: { bookId, chapter, verse? } | null,
  theme: string | null,                                   // image-style text card: "<design>.<font>.<align>" (legacy: "#RRGGBB")
  design: { key, font, align } | { color } | null,        // parsed `theme` (allow-list in src/lib/postDesign.js)
  images: [{ url, width, height }],                       // photo posts (0..10)
  video: null | { uid, status: 'uploading'|'ready', url /* 720p MP4 in R2 */, hls /* same as url, kept for older builds */, thumbnail, duration, category },
  likes, comments, shares, views,                         // author also carries isFollowing
  myReaction: null | 'like'|'amen'|'love'|'praise'|'care',
  saved: boolean, mine: boolean
}
Comment = { id, postId, parentId, author: User, text, createdAt, mine }
Prayer  = { id, author: User | null /*null when anonymous*/, title, body, audience, anonymous, verse, status,
            praying, prayed: boolean, mine, createdAt, updates: [{ id, text, createdAt }] }
Job     = { id, client: User, kind, title, description, category, budget, deadline, skills: string[], status,
            bids: number, createdAt, mine, myBid: null | { id, status, feeCoins, createdAt } }
Bid     = { id, jobId, jobTitle, cover, amount, timeline, feeCoins, status, createdAt, bidder?: User }
Page<T> = { items: T[], nextCursor: string | null }
```

## Routes

| Method & path | Body / query | Returns |
|---|---|---|
| GET `/health` | | `{ ok: true, db: true }` |
| GET `/me` | | `Me` |
| PUT `/me` | `{ displayName?, handle?, avatarUrl?, headline?, bio?, church?, country?, translation? }` | `Me` |
| POST `/me/push-token` | `{ token, platform }` | `{ ok }` |
| GET `/me/rhythm` | `?since=YYYY-MM-DD` | `{ days: [{ day, steps, reflection, updatedAt }], streak, bestStreak, graceUsedThisWeek }` |
| PUT `/me/rhythm/:day` | `{ steps: string[], reflection? }` | `{ ok, day, steps, reflection, streak, bestStreak, graceUsedThisWeek }` |
| GET `/me/following` | | `{ items: User[] }` — everyone you follow |
| GET `/users/:id` | | `User` |
| POST `/users/:id/follow` | | `{ following: boolean }` (toggle) |
| GET `/feed` | `?filter=forYou\|following\|communities\|events&cursor=&limit=20` | `Page<Post>` (newest first, hidden posts excluded) |
| GET `/videos` | `?cursor=&limit=10` | `Page<Post>` (only ready videos) |
| GET `/posts/:id` | | `Post` |
| POST `/posts` | `{ kind, text, passage?, theme? \| design?: { key, font?, align? }, images?: [{ key, width, height }], videoUid?, category? }` | `Post` |
| DELETE `/posts/:id` | | `{ ok }` (author only) |
| POST `/posts/:id/react` | `{ reaction: 'like'\|'amen'\|'love'\|'praise'\|'care'\|null }` | `{ myReaction, likes }` |
| POST `/posts/:id/save` | | `{ saved }` (toggle) |
| POST `/posts/:id/hide` | `{ hidden?: boolean }` (default true) | `{ hidden }` |
| POST `/posts/:id/share` | | `{ shares }` |
| POST `/posts/:id/view` | | `{ views }` |
| GET `/posts/:id/comments` | | `{ items: Comment[] }` (oldest first) |
| POST `/posts/:id/comments` | `{ text, parentId? }` | `Comment` |
| DELETE `/comments/:id` | | `{ ok }` |
| POST `/reports` | `{ targetType, targetId, reason }` | `{ ok }` |
| POST `/uploads/image` | raw image bytes, `Content-Type: image/jpeg\|png\|webp\|heic` (≤ 10 MB) | `{ key, url }` — pass `key` in `POST /posts` `images` |
| POST `/uploads/video` | `{ durationSeconds?, width?, height?, sizeBytes? }` (≤ 180 s, ≤ 95 MB) | `{ uid, method: 'PUT', uploadURL, thumbnailURL, maxBytes }` |
| PUT `/uploads/video/:uid` | the compressed MP4 (`Content-Type: video/mp4`, raw body, authed) | `{ uid, url, status: 'ready' }` |
| PUT `/uploads/video/:uid/thumbnail` | poster JPEG (`image/jpeg`, ≤ 2 MB) | `{ url }` |
| GET `/media/:key` | supports `Range` (206 Partial Content) for video seeking | the image / video (public, cached) |
| GET `/prayers` | `?cursor=` | `Page<Prayer>` (Public + Church + your own Private) |
| POST `/prayers` | `{ title, body, audience, anonymous, verse? }` | `Prayer` |
| POST `/prayers/:id/pray` | | `{ prayed, praying }` (toggle) |
| POST `/prayers/:id/updates` | `{ text?, status? }` (author only) | `Prayer` |
| GET `/jobs` | `?cursor=&kind=` | `Page<Job>` (open) |
| GET `/jobs/:id` | | `Job` |
| POST `/jobs` | `{ kind, title, description, category, budget, deadline, skills }` | `Job` (posting is free) |
| POST `/jobs/:id/bids` | `{ cover, amount?, timeline? }` | `{ bid: Bid, coins }` — charges `bidFee` (20) coins atomically; `402 {code:'INSUFFICIENT_COINS'}` if short; `409 ALREADY_BID` |
| GET `/jobs/:id/bids` | | `{ items: Bid[] }` (job owner only) |
| GET `/me/bids` | | `{ items: Bid[] }` |
| POST `/bids/:id/withdraw` | | `{ bid }` (fee not refunded; can't re-bid the same job) |
| POST `/bids/:id/decide` | `{ status: 'accepted'\|'declined'\|'shortlisted' }` (job owner) | `{ bid }` — accepting marks the job filled |
| POST `/jobs/:id/close` | (job owner) | `{ ok, status: 'closed' }` |
| GET `/coins/ledger` | | `{ items: [{ amount, reason, ref, createdAt }] }` |
| POST `/ads/claim` | `{ purpose: 'support'\|'job' }` | `{ supportAdsToday, jobAdCredits, coins, unlocked?: 20 }` — only when `adsClientClaim` (dev/demo); production uses SSV |
| GET `/ads/ssv` | AdMob server-side verification callback (signed by Google) | `200` — credits the reward for `user_id`, `custom_data` = `support` or `job` |
| POST `/games/results` | `{ gameId: 'trivia'\|'who'\|'scramble'\|'chronology' (or the long ids trivia_master, who_said_it, verse_scramble, timeline_challenge), day: 'YYYY-MM-DD', correct, total ≤ 20 }` | `{ coinsEarned, coins, best }` — 5 coins per correct answer, first round of each game per day only |

### Rewarded ads in production
Set the rewarded ad's server-side verification options in the app:
`serverSideVerificationOptions: { userId: <Me.id>, customData: 'support' | 'job' }`.
Google calls `GET /ads/ssv`, the Worker verifies Google's ECDSA signature, ignores replays, and credits the reward:
`support` → counts toward today's 4 flames; `job` → +1 job ad credit, and every 5 credits become +20 coins.
After the ad closes, the app polls `GET /me` (2–3 times, 1.5 s apart) to show the new state.

### Videos (Cloudflare R2, 720p)
The app compresses every video on the phone to **720p H.264 MP4 (~2 Mbps, about 15 MB per minute)** with
`react-native-compressor` and grabs a poster frame with `expo-video-thumbnails`, then:
1. `POST /uploads/video` → `uploadURL`, `thumbnailURL`
2. `PUT uploadURL` (the MP4) and `PUT thumbnailURL` (the JPEG) — with the same `Authorization` header
3. `POST /posts { kind: 'Video', videoUid }`
Everyone watches the same 720p file; `GET /media/…` (or your R2 custom domain) supports byte ranges so players can seek.

---

## Phase 2 Endpoints & Real-time Contracts

### Real-Time WebSockets (Durable Object `Hub`)
- `POST /realtime/ticket`: Returns `{ ticket, expiresIn: 60 }` (HMAC-SHA256 signed with `REALTIME_SECRET`).
- `GET /realtime?ticket=<token>`: Connects via WebSocket.
- Events emitted:
  - `presence`: `{ type: 'presence', status: 'connected', activeSockets: number, time: number }`
  - `message.new`: `{ type: 'message.new', conversationId, message: MessageObject }`
  - `message.read`: `{ type: 'message.read', conversationId, userId, readAt }`
  - `message.deleted`: `{ type: 'message.deleted', messageId, conversationId }`
  - `gift.received`: `{ type: 'gift.received', from, gift, coins }`
  - `request.new`: `{ type: 'request.new', from, conversationId }`
  - `notification.new`: `{ type: 'notification.new', notification }`

### Direct Messages & Chat
- `GET /conversations`: Lists conversations with last message, unread counts, and other member info.
- `POST /conversations/dm`: `{ userId }` → Starts or gets DM conversation.
- `GET /conversations/:id/messages`: Paginated messages (cursor) or `?after=<iso>` for polling.
- `POST /conversations/:id/messages`: `{ kind: 'text'|'image'|'voice'|'verse'|'prayer'|'event', text, mediaKey, meta, clientId, replyTo }`.
- `POST /conversations/:id/read`: Marks conversation read.
- `POST /conversations/:id/mute`: Toggles mute.
- `POST /messages/:id/delete`: Soft deletes own message.
- `GET /me/requests`: Pending message requests from non-followed users.
- `POST /me/requests/:fromId/accept`: Accepts request.
- `POST /me/requests/:fromId/decline`: Declines request.
- `POST /me/requests/:fromId/block`: Blocks requester.
- `POST /users/:id/block`: Blocks a user.
- `DELETE /users/:id/block`: Unblocks a user.

### Voice & Chat Media
- `POST /uploads/voice`: Upload voice note (`.m4a`, `.aac` ≤ 5 MB).
- `POST /uploads/chat-image`: Upload image scoped to conversation.
- `GET /chat/media/*`: Authenticated route; only conversation members can stream media.

### Communities & Channels
- `GET /communities?q=`: Search and list communities.
- `POST /communities`: Create community with 5 default channels (General, Prayer, Bible Study, Announcements, Events).
- `GET /communities/:id`: Community details, membership status, and channels list.
- `POST /communities/:id/join`: Join public community or request private community.
- `POST /communities/:id/leave`: Leave community.
- `GET /communities/:id/members`: Members list with roles.
- `POST /communities/:id/members/:userId`: Admin actions (`approve`, `decline`, `promote`, `demote`, `remove`).
- `POST /communities/:id/pin`: Pin message in channel.

### Calendar & Events
- `GET /events?communityId=&filter=`: List upcoming events.
- `POST /events`: Create event (`title`, `description`, `startsAt`, `endsAt`, `location`, `onlineUrl`, `coverKey`, `communityId`).
- `POST /events/:id/rsvp`: `{ status: 'going'|'interested'|'no' }`.
- `GET /events/:id/attendees`: List attendees.
- `DELETE /events/:id`: Cancel event.

### Make a Wish
- `GET /wishes?category=&cursor=`: Paginated wishes.
- `POST /wishes`: Create wish (`title`, `body`, `category`, `visibility`, `anonymous`).
- `POST /wishes/:id/candle`: Toggle candle lighting.
- `POST /wishes/:id/amen`: Toggle praying Amen.

### Bible Study Sync
- `GET /me/study?since=<iso>`: Returns notes, highlights, bookmarks, and reading plan progress updated since timestamp.
- `PUT /me/study/notes`: Upsert note (`bookId`, `chapter`, `verse`, `text`, `scope`).
- `DELETE /me/study/notes/:id`: Delete note.
- `PUT /me/study/highlights`: Upsert highlight (`bookId`, `chapter`, `verse`, `color`).
- `DELETE /me/study/highlights/:id`: Delete highlight.
- `PUT /me/study/bookmarks`: Upsert bookmark (`bookId`, `chapter`, `verse`, `label`, `folder`).
- `DELETE /me/study/bookmarks/:id`: Delete bookmark.
- `PUT /me/study/plans`: Mark reading plan day done (`planId`, `day`, `done`).

### Virtual Gifts
- `POST /gifts`: `{ toUserId, giftId, postId? }`. Atomic transfer deducting price from sender and crediting 70% share to creator. Checks sufficient coin balance; rejects self-gifting.

### Notifications Inbox & Settings
- `GET /me/notifications`: Paginated notifications inbox with unread count.
- `POST /me/notifications/read`: Mark one or all notifications read.
- `GET /me/notify-settings`: Fetch user notification toggles.
- `PUT /me/notify-settings`: Update user notification preferences (`messages`, `groups`, `prayer`, `events`, `gifts`, `jobs`).

### Daily Rhythm & Streaks
- `PUT /me/rhythm/:day`: `{ steps: ('verse'|'reading'|'prayer'|'reflect')[], reflection? }`. Day must be between 7 days ago and tomorrow of the user's local date (`tz_offset`). Steps are **add-only (no un-tick)**: once a step is completed on any device, it stays completed; incoming steps are merged via set union (`unnest(rhythm_days.steps || EXCLUDED.steps)`). Optional reflection is strictly private (≤2000 chars). Returns `{ ok, day, steps, reflection, streak, bestStreak, graceUsedThisWeek }`.
- `GET /me/rhythm?since=YYYY-MM-DD`: Returns rhythm history for up to the last 120 days along with `{ streak, bestStreak, graceUsedThisWeek }`.
- `GET /me`: Returns computed `streak`, stored `bestStreak` (updated on the server only when current streak exceeds previous best; client-sent bestStreak values are completely ignored), and `graceUsedThisWeek`.




## Discover tools (round 3)

### Record — sermon recordings, transcripts & AI notes
Audio is stored privately in R2 under `rec/<userId>/<id>.<ext>` (never served by the public `/media/*` route).
Processing runs in the background (`c.executionCtx.waitUntil`) in resumable steps saved to the row (`work`, `lease_until`):
Workers AI `@cf/openai/whisper-large-v3-turbo` (binding `AI`, see `[ai]` in wrangler.toml) transcribes the audio — ADTS `.aac`
(Android) and MP3 are split into ~4 MB frame-aligned pieces with exact time offsets; m4a/webm are sent whole (≤ 25 MB; the app
records 32 kbps mono so 60 min ≈ 15 MB) — then a text model (`NOTES_MODEL`, default `@cf/meta/llama-3.1-8b-instruct-fp8`, falling back to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` if retired; long
transcripts are summarised part by part first) writes the notes. A stalled step is resumed by the next `GET /recordings…`.
- No `AI` binding: with `AUTH_DEV_MODE=true` a deterministic fake transcriber/notes writer is used (local dev, tests);
  otherwise the recording becomes `status: 'error'` with a "not set up" message and `/retry` answers `501 AI_NOT_CONFIGURED`.
- Workers AI limit/quota errors (daily free allocation, 429, capacity): the status stays `transcribing`/`summarising`,
  `error` = "Transcription is busy today — it will finish later", `busy: true`; it resumes automatically after 30 min or on `POST /retry`.

Recording shape: `{ id, title, speaker, passage, duration (s), sizeBytes, status: 'uploading'|'transcribing'|'summarising'|'ready'|'error',
error, busy, progress (0..1), hasAudio, audioPath, summary, notesTitle, createdAt, updatedAt }` + on `GET /recordings/:id`:
`transcript`, `segments: [{ start, end, text }]` (seconds), `notes: { title, summary, mainPoints[], scriptures: [{ ref: 'JHN 3:16', label: 'John 3:16' }],
quotes[], application[], prayer, label: 'AI-generated — check against the recording', generatedAt }`. Scripture references are detected
in the transcript (+ the model's list, validated) and normalised to app book ids (open with `parseRef(ref)`).
- `POST /recordings` `{ title?, speaker?, passage?, durationSeconds? (≤ 3600), sizeBytes? (≤ 50 MB) }` → 201 recording + `{ method: 'PUT', uploadURL, maxBytes }`.
- `PUT /recordings/:id/upload` — raw audio body, `Content-Type: audio/m4a|audio/mp4|audio/aac|audio/webm|audio/mpeg|audio/ogg`, `Content-Length` required (≤ 50 MB). Owner only. Starts processing.
- `GET /recordings` → `{ items, ai: 'real'|'fake'|'off' }` (newest first, light shape).
- `GET /recordings/:id` → full recording. Owner only (others get 404).
- `GET /recordings/:id/audio` — owner-only audio with HTTP Range support (206).
- `POST /recordings/:id/retry` — re-run from where it stopped (transcription or notes).
- `PATCH /recordings/:id` `{ title }` · `DELETE /recordings/:id` (also deletes the R2 object).

### Reminders & daily verse
Scheduled as local notifications on the phone; the server keeps a copy so they come back on a new phone.
Reminder: `{ id (uuid generated by the app), purpose (1-120), kind: 'bible'|'pray'|'call'|'study'|'other', hour 0-23, minute 0-59,
repeat: 'once'|'daily'|'weekdays'|'days', days: 0(Sun)-6 (repeat='days'), date: 'YYYY-MM-DD' (repeat='once'), target: 'Bible'|'PrayerWall'|'Today',
passage?: { bookId, chapter }, enabled }`. Max 50 per user.
- `GET /me/reminders` → `{ items, dailyVerse: { enabled, hour, minute } }`.
- `PUT /me/reminders` `{ items?: Reminder[], dailyVerse?: { enabled, hour, minute } }` — bulk upsert (never deletes).
- `PUT /me/reminders/:id` — upsert one. Ids owned by someone else → 404.
- `DELETE /me/reminders/:id`.

### YouTube channels (Watch) — public, no API key
- `GET /youtube/channels` → `{ items: [{ id, channelId, title, handle, avatarUrl, category, featured, sortOrder, active, url, liveEmbedUrl, createdAt }] }` (active only, featured first).
- `GET /youtube/channels/:id/videos` (`:id` = row uuid or `UC…` id of a curated, active channel) → `{ channel, liveEmbedUrl, videos: [{ videoId, title, published, thumbnail, description, views, isShort, url, embedUrl }] }`.
  Parsed from `https://www.youtube.com/feeds/videos.xml?channel_id=…`, cached 15 minutes. `liveEmbedUrl` = `https://www.youtube.com/embed/live_stream?channel=<id>`.

### Admin dashboard
`GET /admin` serves the dashboard (one HTML page). Sign-in uses Clerk's frontend JS with `CLERK_PUBLISHABLE_KEY`
(wrangler.toml `[vars]`; add the Worker origin to Clerk's allowed origins and to `CLERK_AUTHORIZED_PARTIES` if set);
with `AUTH_DEV_MODE=true` a dev-user box is shown instead. Every `/admin/api/*` route requires `users.role = 'admin'` (403 `NOT_ADMIN`),
and every change is written to `admin_actions`.

**Make someone an admin** (Neon SQL editor or psql):
```sql
UPDATE users SET role='admin' WHERE clerk_id='user_…';   -- the Clerk user id (Clerk dashboard → Users)
```
- `GET /admin/api/me`
- `GET /admin/api/youtube/channels` (incl. hidden) · `POST /admin/api/youtube/channels` `{ input: channel URL | @handle | UC… id, category?, featured?, title?, sortOrder? }`
  (the id is resolved from the channel page's canonical link) · `PATCH /admin/api/youtube/channels/:id` `{ title?, category?, featured?, sortOrder?, active? }` · `DELETE …/:id`.
  Categories: Sermons, Worship, Bible study, Kids, Podcasts, Live services, Testimonies, Other.
- `GET /admin/api/reports?status=open|resolved` → reports with a `target` preview (text, author, banned/removed flags) and `sameTargetOpen`.
- `POST /admin/api/reports/:id/remove` (post → removed, comment → deleted, prayer → archived, job → closed) · `POST …/:id/ban` (bans the author / reported user; admins can't be banned) · `POST …/:id/dismiss`. Remove/ban resolve every open report on the same target.
- `GET /admin/api/actions` — last 100 audit entries.

Extension point for other areas: `import { registerAdminScript, requireAdmin } from './admin.js'` — `registerAdminScript(js)` appends a script
to the page that can call `window.registerAdminTab(name, render)` (`render(container, { api, toast, esc, h })`) and `window.adminApi(method, path, body)`.
The "Fund Me approvals" tab uses this.

## Fund Me (round 3)

Fundraising requests with a public page, supporting photos/PDFs, admin review and donations through a payment-provider
adapter (`src/lib/payments.js`). Money is always an integer in **minor units** (pence/cents/kobo) with a `currency` of
`GBP | USD | EUR | NGN`. Limits/presets/platform fee live in `src/lib/rules.js` → `FUNDME` (fee default 0).

**Payments are not live.** `PAYMENTS_MODE=test` enables the TEST provider (simulated checkout page, no money — never set in
production; the local dev server defaults to it, `PAYMENTS_MODE=off` disables). `PAYMENTS_MODE=stripe` + `STRIPE_SECRET_KEY` +
`STRIPE_WEBHOOK_SECRET` would enable the Stripe Connect skeleton (destination charges to the owner's connected account from
`fundme_payout_accounts`; onboarding UI not built yet). Paystack is a documented TODO in `payments.js`. With no provider, the
page/app show "Donations open soon" and `POST …/donations` returns `503 DONATIONS_NOT_OPEN`.

Statuses: `draft → pending_review → live ⇄ paused → closed`, `pending_review → rejected → (edit) → pending_review`.
The public page exists once approved (`live`, or `paused`/`closed` unless an admin paused it).

Fundraiser shape (owner/admin view adds `mainImageKey, rejectReason, submittedAt, approvedAt, isOwner`, private media and keys):
`{ id, slug, url, title, story: [{type:'p',text} | {type:'img',url,caption}], excerpt, mainImageUrl, status, pausedBy,
currency, goalMinor, raisedMinor, remainingMinor, percent, donorsCount, donationsOpen, paymentsReady, provider, testMode,
presets, minMinor, maxMinor, owner:{displayName,avatarUrl}, media:[{id,kind:'image'|'pdf',url,caption,name,visibility?}],
donations:[{name ('Anonymous' when anonymous), anonymous, amountMinor, currency, message, createdAt}] }` — no donor ids.

Public (no auth):
- `GET /f/:slug` — HTML landing page (Open Graph/Twitter tags, progress, story, photos lightbox, public PDFs, donors, donate form). CSP with a nonce; all user text escaped. `?donation=succeeded|failed|cancelled` shows a banner.
- `GET /f/:slug.json` — the same data as JSON.
- `GET /f/:slug/docs/:mediaId` — a **public** PDF of a publicly visible fundraiser (404 otherwise).
- `GET /fundme/docs/:mediaId?exp&sig` — any PDF through a 15-minute HMAC-signed link (issued only in owner/admin views).
- `POST /f/:slug/donations` `{ amount_minor, message?, anonymous, donor_name? }` (JSON, or an HTML form post → 303 to checkout). Optional auth (signed-in donors are linked; guests allowed). Fundraiser must be `live`; amount within the currency's min/max; 10 attempts / 10 min per user or IP (`429 RATE_LIMITED`). → `201 { donationId, checkoutUrl, provider, status:'pending' }`.
- `GET /f/:slug/donations/:donationId` → `{ id, status }` (the app polls this after opening the checkout).
- `GET /pay/test/:ref` — TEST checkout page ("Simulate successful payment" / "Simulate failure"); test mode only.
- `POST /webhooks/fundme/test` `{ ref, status:'succeeded'|'failed' }` — test mode only.
- `POST /webhooks/fundme/stripe` — Stripe webhook (`Stripe-Signature` verified with `STRIPE_WEBHOOK_SECRET`, 5-min tolerance).
- Payment results are idempotent on `provider_ref`: only `pending → succeeded` adds to `raised_minor`/`donors_count` (one SQL statement) and notifies the owner (`fundme_donation`); `failed` never counts; duplicates/replays are no-ops.

Authenticated:
- `POST /uploads/document` (body = PDF bytes, `Content-Type: application/pdf`, ≤ 10 MB, must start with `%PDF`; optional `?name=file.pdf`) → `{ key, name, size }` stored under `doc/<userId>/…` (never served by `/media`). Images use `POST /uploads/image`.
- `POST /fundraisers` `{ title, goalMinor, currency, story?, mainImageKey?, media? }` → draft. `media: [{ id? , kind, key, name?, caption?, visibility? }]` (images default public, PDFs default **private**; existing items are referenced by `id` so their ids/links stay stable). Keys must be the caller's own uploads.
- `PATCH /fundraisers/:id` (owner) — `title, story, mainImageKey, media` always; `goalMinor, currency` only while draft/pending/rejected (`409 LOCKED_FIELD`). Closed → `409 CLOSED`.
- `POST /fundraisers/:id/submit` (draft|rejected → pending_review; needs a main photo and a story, else `400 INCOMPLETE`), `/pause` (live → paused), `/resume` (owner-paused → live; admin-paused → `403 ADMIN_PAUSED`), `/close`.
- `GET /me/fundraisers`, `GET /fundraisers?cursor&limit` (live, newest first), `GET /fundraisers/:id` (owner/admin full view; others get the public view if visible), `GET /fundraisers/:id/donations` (owner/admin; real names even for anonymous gifts, with `anonymous: true`).

Admin (`users.role = 'admin'`), also shown as the "Fund Me approvals" tab on `/admin`:
- `GET /admin/api/fundme?status=pending_review|live|paused|rejected|closed|draft` → `{ items, counts }`; `GET /admin/api/fundme/pending`.
- `GET /admin/api/fundme/:id` — full view incl. private documents (signed links).
- `POST /admin/api/fundme/:id/approve` (pending_review|paused → live, notifies `fundme_approved`), `/reject { reason }` (notifies `fundme_rejected`), `/pause` (hides the page, notifies `fundme_paused`). All logged to `admin_actions`.

Tables: `fundraisers`, `fundraiser_media`, `donations`, `fundme_payout_accounts` (see schema.sql "FUND ME (round 3)").

## Social (round 3)
Person profiles, profile images, comment likes and gifts from comments. All routes need a signed-in user.

- `GET /users/:id` — now also returns `bio`, `country`, `bannerUrl`, `posts` (count) and `blocked` (I blocked them). 404 when either side has blocked the other.
- `GET /users/:id/posts?limit=18&cursor=&type=all|videos|posts` — that person's posts & videos, newest first, same post shape and paging as `/feed` (`{ items, nextCursor }`). Excludes removed posts, posts I hid, banned authors and not-yet-ready videos (except my own). 404 if blocked either way.
- `GET /users/:id/followers`, `GET /users/:id/following` — `{ items: [user + isFollowing, isMe] }` (max 500, blocked people omitted).
- `PUT /me` — `avatarUrl` and `bannerUrl` accept **only images this user uploaded** with `POST /uploads/image`: the returned `key` (`img/<my id>/<uuid>.<ext>`) or its exact `url`. Anything else (another user's image, external URLs, path tricks, unknown keys) → `400 BAD_IMAGE`. `null`/`""` clears. Sending the current value back is a no-op. `/me` returns `bannerUrl` (column `users.banner_url`).
- `POST /comments/:id/like` — toggle my like → `{ liked, likes }`. Liking someone else's comment writes an in-app notification for its author (`kind: 'comment_like'`, body `Alice liked your comment: “…”`, `data: { type, postId, commentId, fromId, fromName }`) — once per liker per comment; unliking and self-likes never notify.
- `GET /comments/:id/likes` — who liked a comment → `{ items: [user + isMe, likedAt], count }`.
- `GET /posts/:id/comments` — each comment now has `likes` and `likedByMe`.
- `GET /posts/:id/reactions` — who reacted to a post → `{ items: [user + isMe, reaction] }`.
- `POST /gifts` — optional `commentId`: the comment must be written by `toUserId` on a live post (and on `postId` when both are sent) else `400 BAD_COMMENT`; stored in `gift_transactions.comment_id`. `toUserId` must be a uuid (404 otherwise); non-uuid `postId`s (device-only ids) are ignored. The recipient's notification (`kind: 'gift'`) mentions the comment and carries `data: { postId, commentId, fromId, fromName, giftId, transactionId }`. Insufficient coins → `402 INSUFFICIENT_COINS` (nothing moves).

Tables: `comment_likes (comment_id, user_id, created_at, PK both)`; columns `users.banner_url`, `gift_transactions.comment_id`.

## Message actions (round 4) — DMs and group channels

Message objects (from `GET /conversations/:id/messages`, `POST …/messages`, `GET /messages/:id`) now also carry:
`editedAt`, `deleted`, `deletedByModerator`, `pinned`, `reactions: [{ emoji, count, mine }]`,
`reply: { id, senderId, senderName, kind, text, deleted } | null`. Messages you deleted "for me" are left out.
The first page of `GET /conversations/:id/messages` also returns `pins` (newest first, max 3) and `myRole`.
`GET /communities` items now include `channels: [{ id, name, conversationId }]`.

| Method | Path | Body | Who |
|---|---|---|---|
| GET | `/messages/:id` | — | members (404 if deleted for you) |
| PATCH | `/messages/:id` | `{ text }` | sender; text/verse/prayer messages; within 24 h (`EDIT_WINDOW_PASSED`) |
| POST | `/messages/:id/delete` | `{ for: 'everyone' \| 'me' }` (default everyone) | everyone: sender, or group moderator; me: any member |
| POST | `/messages/:id/pin` | `{ pinned: true \| false }` | DMs: either person; groups: owner/admin (`ADMIN_ONLY`); max 3 pins |
| POST | `/messages/:id/react` | `{ emoji }` one of 🙏 ❤️ 🙌 👍 😂 😢 🔥 🕊️; same again or `null` removes | members |
| POST | `/conversations/:id/messages` | `replyTo` must be a message in the same conversation (`BAD_REPLY`) | members |

Group moderators = conversation owner/admin, or owner/admin of the community the channel belongs to.
Deleting for everyone clears the text/media, its reactions and its pin. Realtime: every member gets
`{ type: 'message.changed', conversationId, messageId, change: 'edited'|'deleted'|'pinned'|'unpinned'|'reacted' }`
(`'hidden'` only to your own devices) and re-fetches `GET /messages/:id`.


## Admin dashboard (round 5) — all need `users.role = 'admin'`, all logged to `admin_actions`

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/api/stats` | totals, 14-day `series` (signups/posts/messages per UTC day), `recentSignups` |
| GET | `/admin/api/users?q=&filter=all\|reported\|banned\|admins\|verified&before=` | search name/handle/church/Clerk id; `next` cursor |
| GET | `/admin/api/users/:id` | counts, recent posts, coin ledger, communities, open reports |
| POST | `/admin/api/users/:id/ban` | `{ banned: true\|false, reason? }` — not yourself, not admins |
| POST | `/admin/api/users/:id/role` | `{ role: 'admin'\|'user' }` — not your own; at least one admin remains |
| POST | `/admin/api/users/:id/verify` | `{ verified }` |
| POST | `/admin/api/users/:id/coins` | `{ amount: ±int, reason }` → coin_ledger `admin_adjustment`; never below 0 |
| GET | `/admin/api/content/posts\|comments\|prayers?q=&status=all\|reported\|visible\|removed&kind=&authorId=&before=` | |
| POST | `/admin/api/content/:type/:id/remove` · `/restore` | posts/prayers hidden & restorable; comments deleted; resolves reports |
| GET | `/admin/api/communities?q=&filter=all\|verified\|hidden\|private` · `/admin/api/communities/:id/members` | |
| PATCH | `/admin/api/communities/:id` | `{ verified?, hidden? }` — hidden: not listed/joinable, members keep access |
| POST | `/admin/api/communities/:id/owner` | `{ userId }` (must be a member; old owner → admin, channels too) |
| DELETE | `/admin/api/communities/:id` | `{ confirmName }` must equal the name; deletes channels + messages + events |
| GET | `/admin/api/events?when=upcoming\|past` · DELETE `/admin/api/events/:id` `{ reason? }` | delete notifies host + RSVPs |
| GET/POST | `/admin/api/announcements` | `{ title, body?, kind: info\|verse\|event\|update\|urgent, verseRef?, linkUrl? (https), startsAt?, endsAt?, notifyAll? }` |
| PATCH/DELETE | `/admin/api/announcements/:id` | |
| GET | `/announcements` | any signed-in user: live announcements (max 3, urgent first) |

Community objects now include `verified`. `GET /communities/:id` fixed (it compared the id with the user id).

## Contests

Timed Bible quizzes with a leaderboard. Free to enter, one attempt per person. The server holds the answers, times the attempt and scores it. Most correct wins; ties go to the fastest. Coin prizes are paid automatically, once, the first time anyone loads the contest after it closes and any attempt in progress has run out of time (status `judging` until then).

Contest shape: `{ id, title, description, prizeText, prizeCoins: number[] (1st, 2nd…), category, categoryLabel, questionCount, secondsPerQuestion, limitSeconds, startsAt, endsAt, status: 'upcoming'|'live'|'judging'|'ended'|'cancelled', entries, myEntry: null | { finished, correct, total, durationMs, timedOut, place, prizeCoins, remainingSeconds } }`

| Method | Path | Notes |
|---|---|---|
| GET | `/contests` | newest first, cancelled ones left out |
| GET | `/contests/:id` | |
| GET | `/contests/:id/leaderboard` | `{ items: [{ place, user, correct, total, durationMs, prizeCoins, isMe }] }` — top 50 plus you |
| POST | `/contests/:id/start` | starts or resumes your attempt → `{ remainingSeconds, limitSeconds, questions: [{ id, question, options }] }`. `409 ALREADY_ENTERED`, `409 CONTEST_NOT_LIVE` |
| POST | `/contests/:id/submit` | `{ answers: { [questionId]: optionIndex } }` → `{ correct, total, durationMs, timedOut, place }`. Repeats don't change the score. More than 20 s past the timer scores 0 |
| GET | `/contests/:id/review` | your answers against the right ones, only once `ended` (`409 CONTEST_NOT_ENDED`) |
| GET | `/admin/api/contests` · `/admin/api/contests/categories` · `/admin/api/contests/:id` | the single view includes `questions` with answers and a `leaderboard` |
| POST | `/admin/api/contests` | `{ title, description?, prizeText?, prizeCoins?, category?, questionCount? (5-30), secondsPerQuestion? (10-60), startsAt?, endsAt, notifyAll? }`. Needs a prize |
| PATCH | `/admin/api/contests/:id` | `{ title?, description?, prizeText?, endsAt? }` until paid out |
| POST | `/admin/api/contests/:id/end` · `/cancel` | end now, or cancel (no prizes) |

Questions come from `src/lib/contestBank.js`, generated by `scripts/gen_contest_bank.mjs`. Tables: `contests`, `contest_entries`. Coin ledger reason: `contest_prize`. Notification kind: `contest`.
