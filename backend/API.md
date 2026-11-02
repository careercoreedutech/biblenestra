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
  theme: string | null,
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
| POST `/posts` | `{ kind, text, passage?, theme?, images?: [{ key, width, height }], videoUid?, category? }` | `Post` |
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
- `PUT /me/rhythm/:day`: `{ steps: ('verse'|'reading'|'prayer'|'reflect')[], reflection? }`. Day must be within ±1 day of the user's local date (`tz_offset`). Merges steps without deleting existing completed steps for that day. Optional reflection is strictly private (≤2000 chars). Returns `{ ok, day, steps, reflection, streak, bestStreak, graceUsedThisWeek }`.
- `GET /me/rhythm?since=YYYY-MM-DD`: Returns rhythm history for up to the last 120 days along with `{ streak, bestStreak, graceUsedThisWeek }`.
- `GET /me`: Returns computed `streak`, stored `bestStreak` (updated when current streak sets a new record), and `graceUsedThisWeek`.


