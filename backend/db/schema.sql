-- BibleNestra — Neon Postgres schema (phase 1: accounts, social feed + videos, prayers, jobs & bids,
-- coins economy, ads rewards, games). Run once:  psql "$DATABASE_URL" -f db/schema.sql
-- Safe to re-run: every statement is IF NOT EXISTS. (gen_random_uuid() is built into Postgres 13+.)


-- ---------- people ----------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id      text UNIQUE NOT NULL,              -- Clerk user id (sub claim)
  display_name  text NOT NULL DEFAULT 'Friend',
  handle        text UNIQUE,                       -- without @
  avatar_url    text,
  headline      text,
  bio           text,
  church        text,
  country       text,
  translation   text NOT NULL DEFAULT 'KJV',
  tz_offset     smallint NOT NULL DEFAULT 0 CHECK (tz_offset BETWEEN -840 AND 840), -- minutes east of UTC (device time zone)
  kind          text NOT NULL DEFAULT 'person' CHECK (kind IN ('person','church','community','channel')),
  verified      boolean NOT NULL DEFAULT false,
  coins         integer NOT NULL DEFAULT 50 CHECK (coins >= 0), -- welcome coins
  job_ad_credits integer NOT NULL DEFAULT 0 CHECK (job_ad_credits >= 0),
  banned        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee_id);

CREATE TABLE IF NOT EXISTS push_tokens (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL,
  platform   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

-- ---------- social: one table for text, photo and video posts ----------
CREATE TABLE IF NOT EXISTS posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'Reflection',   -- Reflection | Announcement | Event | Study | Prayer | Testimony | Verse | Photo | Video …
  body          text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  passage_book  text,                                  -- USFM book id, e.g. JHN
  passage_ch    integer,
  passage_verse integer,
  theme         text,                                  -- quote-card colour id
  category      text,                                  -- video category (Sermons, Worship…)
  -- video (720p MP4 stored in R2; compressed on the phone before upload)
  video_uid     text UNIQUE,                           -- the upload id from POST /uploads/video
  video_status  text CHECK (video_status IN ('uploading','processing','ready','error')),
  video_duration real,
  video_url     text,                                  -- R2 key (vid/…mp4) or an external https URL (demo content)
  video_thumb   text,                                  -- R2 key of the poster image (vid/…jpg)
  likes_count    integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  shares_count   integer NOT NULL DEFAULT 0,
  views_count    integer NOT NULL DEFAULT 0,
  removed       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at DESC, id DESC) WHERE NOT removed;
CREATE INDEX IF NOT EXISTS posts_author ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_video ON posts (created_at DESC) WHERE video_uid IS NOT NULL AND NOT removed;

-- Video uploads handed out by POST /uploads/video (proves who owns an upload)
CREATE TABLE IF NOT EXISTS video_uploads (
  uid        text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'uploading',    -- uploading | ready
  duration   real,
  width      integer,
  height     integer,
  size_bytes bigint,
  video_key  text,                                 -- R2 key once the file is uploaded
  thumb_key  text,                                 -- R2 key of the poster image
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_media (
  post_id   uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position  smallint NOT NULL,
  r2_key    text NOT NULL,          -- object key in the R2 bucket
  width     integer,
  height    integer,
  PRIMARY KEY (post_id, position)
);

CREATE TABLE IF NOT EXISTS reactions (
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   text NOT NULL DEFAULT 'like' CHECK (reaction IN ('like','amen','love','praise','care')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS saves (
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS hidden_posts (
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES comments(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL,       -- post | comment | user | prayer | job
  target_id  uuid NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- prayer wall ----------
CREATE TABLE IF NOT EXISTS prayers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  audience    text NOT NULL DEFAULT 'Public' CHECK (audience IN ('Public','Church','Private')),
  anonymous   boolean NOT NULL DEFAULT false,
  verse       text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','receiving','answered','archived')),
  praying_count integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prayers_created ON prayers (created_at DESC);

CREATE TABLE IF NOT EXISTS prayer_intercessions (
  prayer_id  uuid NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prayer_id, user_id)
);

CREATE TABLE IF NOT EXISTS prayer_updates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prayer_id  uuid NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- jobs marketplace ----------
CREATE TABLE IF NOT EXISTS jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'job' CHECK (kind IN ('job','task','bounty')),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 8000),
  category    text,
  budget      text,
  deadline    text,
  skills      text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','filled')),
  bids_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_open ON jobs (created_at DESC) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS bids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  bidder_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover       text NOT NULL CHECK (char_length(cover) BETWEEN 1 AND 4000),
  amount      text,
  timeline    text,
  fee_coins   integer NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','shortlisted','accepted','declined','withdrawn')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, bidder_id)
);

-- ---------- coins, ads, games ----------
CREATE TABLE IF NOT EXISTS coin_ledger (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     integer NOT NULL,             -- + earned / - spent
  reason     text NOT NULL,                -- welcome | job_bid | job_ads | game | purchase | gift …
  ref        text,                         -- related id (job id, transaction id…)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_ledger_user ON coin_ledger (user_id, created_at DESC);

-- one row per rewarded ad watched (server-verified through AdMob SSV when configured)
CREATE TABLE IF NOT EXISTS ad_rewards (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        text NOT NULL CHECK (purpose IN ('support','job')),
  day            date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  transaction_id text UNIQUE,              -- AdMob transaction id (prevents replays)
  verified       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_rewards_user_day ON ad_rewards (user_id, purpose, day);

CREATE TABLE IF NOT EXISTS game_results (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    text NOT NULL,
  day        date NOT NULL,
  correct    integer NOT NULL CHECK (correct >= 0),
  total      integer NOT NULL CHECK (total > 0 AND correct <= total),
  rounds     integer NOT NULL DEFAULT 1,
  best       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game_id, day)
);

-- upgrades for databases created before these columns existed
ALTER TABLE users ADD COLUMN IF NOT EXISTS tz_offset smallint NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_thumb text;
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS size_bytes bigint;
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS video_key text;
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS thumb_key text;

-- ============================================================================
-- PHASE 2 SCHEMA: DIRECT MESSAGES, COMMUNITIES, CALENDAR/EVENTS,
-- WISHES, BIBLE STUDY SYNC, GIFTS, NOTIFICATIONS & SAFETY
-- ============================================================================

-- ---------- 1. Direct Messages & Chat ----------
CREATE TABLE IF NOT EXISTS conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('dm','group')),
  title           text,
  avatar_key      text,
  pinned_message_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_last_msg ON conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  muted           boolean NOT NULL DEFAULT false,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conv_members_user ON conversation_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','voice','verse','prayer','event')),
  body            text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  media_key       text,
  meta            jsonb,
  reply_to        uuid REFERENCES messages(id) ON DELETE SET NULL,
  client_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted         boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS messages_conv_created ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_conv_client ON messages (conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL;

-- Safety: blocks & message requests
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks (blocked_id);

CREATE TABLE IF NOT EXISTS message_requests (
  from_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','blocked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id),
  CHECK (from_id <> to_id)
);

-- ---------- 2. Communities & Channels ----------
CREATE TABLE IF NOT EXISTS communities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  slug          text UNIQUE NOT NULL CHECK (char_length(slug) BETWEEN 2 AND 100),
  description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  privacy       text NOT NULL DEFAULT 'Public' CHECK (privacy IN ('Public','Private')),
  avatar_key    text,
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  members_count integer NOT NULL DEFAULT 1 CHECK (members_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communities_created ON communities (created_at DESC);

CREATE TABLE IF NOT EXISTS community_members (
  community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  status        text NOT NULL DEFAULT 'member' CHECK (status IN ('member','requested','banned')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS comm_members_user ON community_members (user_id);

CREATE TABLE IF NOT EXISTS community_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  position        smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, name)
);

-- ---------- 3. Calendar & Events ----------
CREATE TABLE IF NOT EXISTS events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  uuid REFERENCES communities(id) ON DELETE CASCADE,
  host_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  location      text,
  online_url    text,
  cover_key     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS events_starts ON events (starts_at ASC);
CREATE INDEX IF NOT EXISTS events_community ON events (community_id);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'going' CHECK (status IN ('going','interested','no')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- ---------- 4. Make a Wish ----------
CREATE TABLE IF NOT EXISTS wishes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  body          text NOT NULL CHECK (char_length(body) <= 2000),
  category      text NOT NULL DEFAULT 'Personal',
  visibility    text NOT NULL DEFAULT 'Public' CHECK (visibility IN ('Public','Private','Community')),
  anonymous     boolean NOT NULL DEFAULT false,
  candles_count integer NOT NULL DEFAULT 0 CHECK (candles_count >= 0),
  amen_count    integer NOT NULL DEFAULT 0 CHECK (amen_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wishes_created ON wishes (created_at DESC);

CREATE TABLE IF NOT EXISTS wish_candles (
  wish_id     uuid NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wish_id, user_id)
);

CREATE TABLE IF NOT EXISTS wish_amens (
  wish_id     uuid NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wish_id, user_id)
);

-- ---------- 5. Bible Study Sync ----------
CREATE TABLE IF NOT EXISTS notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     text NOT NULL,
  chapter     integer NOT NULL CHECK (chapter > 0),
  verse       integer CHECK (verse > 0),
  text        text NOT NULL CHECK (char_length(text) <= 10000),
  scope       text NOT NULL DEFAULT 'Private' CHECK (scope IN ('Private','Shared')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_user_updated ON notes (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS highlights (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     text NOT NULL,
  chapter     integer NOT NULL CHECK (chapter > 0),
  verse       integer NOT NULL CHECK (verse > 0),
  color       text NOT NULL DEFAULT 'yellow',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, chapter, verse)
);
CREATE INDEX IF NOT EXISTS highlights_user_updated ON highlights (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     text NOT NULL,
  chapter     integer NOT NULL CHECK (chapter > 0),
  verse       integer CHECK (verse > 0),
  label       text,
  folder      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookmarks_user_updated ON bookmarks (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS plan_progress (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     text NOT NULL,
  day         integer NOT NULL CHECK (day > 0),
  done_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plan_id, day)
);

-- ---------- 6. Gifts ----------
CREATE TABLE IF NOT EXISTS gift_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_id     text NOT NULL,
  coins       integer NOT NULL CHECK (coins > 0),
  creator_coins integer NOT NULL CHECK (creator_coins >= 0),
  post_id     uuid REFERENCES posts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id)
);
CREATE INDEX IF NOT EXISTS gifts_to_user ON gift_transactions (to_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gifts_from_user ON gift_transactions (from_id, created_at DESC);

-- ---------- 7. Notifications & Settings ----------
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications (user_id, created_at DESC);

-- Column additions
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify jsonb NOT NULL DEFAULT '{"messages":true,"groups":true,"prayer":true,"events":true,"gifts":true,"jobs":true}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS best_streak integer NOT NULL DEFAULT 0;
ALTER TABLE users DROP COLUMN IF EXISTS streak;

-- ---------- 8. Daily Rhythm & Streaks ----------
CREATE TABLE IF NOT EXISTS rhythm_days (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         date NOT NULL,
  steps       text[] NOT NULL DEFAULT '{}' CHECK (steps <@ ARRAY['verse','reading','prayer','reflect']::text[]),
  reflection  text CHECK (reflection IS NULL OR char_length(reflection) <= 2000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS rhythm_days_user_day ON rhythm_days (user_id, day DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rhythm_days_steps_check') THEN
    ALTER TABLE rhythm_days ADD CONSTRAINT rhythm_days_steps_check CHECK (steps <@ ARRAY['verse','reading','prayer','reflect']::text[]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rhythm_days_reflection_check') THEN
    ALTER TABLE rhythm_days ADD CONSTRAINT rhythm_days_reflection_check CHECK (reflection IS NULL OR char_length(reflection) <= 2000);
  END IF;
END $$;




-- ===== SOCIAL (round 3) =====
-- Profile banner, comment likes, gifts sent from a comment
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url text;
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id  uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS comment_likes_user ON comment_likes (user_id);
ALTER TABLE gift_transactions ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES comments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_author_created ON posts (author_id, created_at DESC);

-- ===== DISCOVER TOOLS (round 3) =====
-- Sermon recordings (Record): audio in R2 under rec/<userId>/…, transcribed + summarised by Workers AI in the background.
CREATE TABLE IF NOT EXISTS recordings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Untitled recording' CHECK (char_length(title) BETWEEN 1 AND 200),
  speaker     text CHECK (speaker IS NULL OR char_length(speaker) <= 120),
  passage     text CHECK (passage IS NULL OR char_length(passage) <= 120),
  r2_key      text,
  mime        text,
  size_bytes  integer,
  duration    real,                                  -- seconds (as reported by the phone; capped at 60 min)
  status      text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','transcribing','summarising','ready','error')),
  transcript  text,
  segments    jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{ start, end, text }] (seconds)
  notes       jsonb,                                 -- { title, summary, mainPoints[], scriptures[], quotes[], application[], prayer, label }
  error       text,                                  -- friendly message shown in the app (null when fine)
  work        jsonb NOT NULL DEFAULT '{}'::jsonb,     -- background pipeline state (chunk cursor, partial summaries, attempts)
  lease_until timestamptz,                           -- a worker is processing this row until then
  next_attempt_at timestamptz,                       -- quota back-off: don't auto-resume before this time
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recordings_user_created ON recordings (user_id, created_at DESC);

-- Reminders (scheduled as local notifications on the phone; synced so they come back on a new phone)
CREATE TABLE IF NOT EXISTS reminders (
  id          uuid PRIMARY KEY,                      -- generated by the app (so offline-created reminders keep their id)
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 120),
  kind        text NOT NULL DEFAULT 'other' CHECK (kind IN ('bible','pray','call','study','other')),
  hour        smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  minute      smallint NOT NULL CHECK (minute BETWEEN 0 AND 59),
  repeat      text NOT NULL DEFAULT 'daily' CHECK (repeat IN ('once','daily','weekdays','days')),
  days        smallint[] NOT NULL DEFAULT '{}',      -- 0 = Sunday … 6 = Saturday (repeat = 'days')
  date        date,                                  -- repeat = 'once'
  target      text NOT NULL DEFAULT 'Today' CHECK (target IN ('Bible','PrayerWall','Today')),
  passage     jsonb,                                 -- { bookId, chapter } for "study a chapter"
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_user ON reminders (user_id, hour, minute);
CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_verse jsonb NOT NULL DEFAULT '{"enabled":false,"hour":6,"minute":0}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- YouTube channels curated by admins (videos come from the public RSS feed; no API key)
CREATE TABLE IF NOT EXISTS youtube_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  text NOT NULL UNIQUE CHECK (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  handle      text,
  avatar_url  text,
  category    text NOT NULL DEFAULT 'Sermons',
  featured    boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  added_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS youtube_channels_order ON youtube_channels (featured DESC, sort_order, created_at) WHERE active;

-- Admin role, moderation outcome on reports, and an audit log of admin actions
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin'));
  END IF;
END $$;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS reports_open ON reports (created_at DESC) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS admin_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_created ON admin_actions (created_at DESC);

-- ===== FUND ME (round 3) =====
-- Fundraising requests with a public page (/f/<slug>), supporting images/PDFs and donations through a
-- payment-provider adapter (test provider today; Stripe Connect skeleton). Money is stored in minor units.
CREATE TABLE IF NOT EXISTS fundraisers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  story          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{type:'p',text} | {type:'img',key,caption}]
  main_image_key text,
  currency       text NOT NULL DEFAULT 'GBP' CHECK (currency IN ('GBP','USD','EUR','NGN')),
  goal_minor     bigint NOT NULL CHECK (goal_minor > 0),
  raised_minor   bigint NOT NULL DEFAULT 0 CHECK (raised_minor >= 0),
  donors_count   integer NOT NULL DEFAULT 0 CHECK (donors_count >= 0),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','live','paused','closed','rejected')),
  paused_by      text CHECK (paused_by IS NULL OR paused_by IN ('owner','admin')),
  reject_reason  text,
  submitted_at   timestamptz,
  approved_at    timestamptz,                          -- first approval (the public page exists from then on)
  reviewed_at    timestamptz,
  reviewed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fundraisers_owner ON fundraisers (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fundraisers_live ON fundraisers (created_at DESC, id DESC) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS fundraisers_pending ON fundraisers (submitted_at) WHERE status = 'pending_review';

CREATE TABLE IF NOT EXISTS fundraiser_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundraiser_id  uuid NOT NULL REFERENCES fundraisers(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('image','pdf')),
  r2_key         text NOT NULL,
  name           text,                                 -- original file name (PDFs)
  caption        text CHECK (caption IS NULL OR char_length(caption) <= 200),
  visibility     text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  position       smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fundraiser_media_fr ON fundraiser_media (fundraiser_id, position);

CREATE TABLE IF NOT EXISTS donations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundraiser_id  uuid NOT NULL REFERENCES fundraisers(id) ON DELETE CASCADE,
  donor_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  donor_name     text CHECK (donor_name IS NULL OR char_length(donor_name) <= 80),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor      bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  currency       text NOT NULL CHECK (currency IN ('GBP','USD','EUR','NGN')),
  message        text CHECK (message IS NULL OR char_length(message) <= 500),
  anonymous      boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
  provider       text NOT NULL,
  provider_ref   text UNIQUE,
  rl_key         text,                                 -- rate-limit bucket (user id or hashed IP)
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS donations_fr_status ON donations (fundraiser_id, status, completed_at DESC);
CREATE INDEX IF NOT EXISTS donations_rl ON donations (rl_key, created_at DESC);

-- Payout accounts for real providers (Stripe Connect Express account ids). Unused until payments are enabled.
CREATE TABLE IF NOT EXISTS fundme_payout_accounts (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('stripe','paystack')),
  account_id       text NOT NULL,
  charges_enabled  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- ============================================================
-- ROUND 4 — message actions (DMs and group channels): edit, delete for me / everyone, pin, react, reply
-- ============================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)            -- one reaction per person per message (changing it replaces it)
);

-- "Delete for me": the message stays for everyone else
CREATE TABLE IF NOT EXISTS message_hides (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- Up to 3 pinned messages per conversation (oldest pin drops off when a 4th is pinned)
CREATE TABLE IF NOT EXISTS conversation_pins (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  pinned_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);
CREATE INDEX IF NOT EXISTS conversation_pins_conv ON conversation_pins (conversation_id, pinned_at DESC);

-- ============================================================
-- ROUND 5 — admin dashboard: users, content, communities & events, announcements
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;          -- updated at most every 10 min (active-user stats)
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason text;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;  -- hidden: members only, not listed or joinable
CREATE INDEX IF NOT EXISTS users_last_seen ON users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS users_created ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS messages_created ON messages (created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 1000),
  kind        text NOT NULL DEFAULT 'info' CHECK (kind IN ('info','verse','event','update','urgent')),
  verse_ref   text,                                    -- e.g. "Philippians 4:6-7" (shown under the text)
  link_url    text,                                    -- optional https link ("Learn more")
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_live ON announcements (active, starts_at DESC);

-- CONTESTS: timed Bible quizzes with prizes. Answers live in `questions` and never reach the app before the end.
CREATE TABLE IF NOT EXISTS contests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100),
  description          text NOT NULL DEFAULT '',
  prize_text           text NOT NULL DEFAULT '',          -- anything that isn't coins, e.g. "A study Bible"
  prize_coins          integer[] NOT NULL DEFAULT '{}',   -- coins for 1st, 2nd, 3rd …
  category             text NOT NULL DEFAULT 'mixed',
  question_count       integer NOT NULL CHECK (question_count BETWEEN 5 AND 30),
  seconds_per_question integer NOT NULL CHECK (seconds_per_question BETWEEN 10 AND 60),
  questions            jsonb NOT NULL,                    -- the pool; each person draws question_count from it
  starts_at            timestamptz NOT NULL DEFAULT now(),
  ends_at              timestamptz NOT NULL,
  settled_at           timestamptz,                       -- set once, in the statement that pays the prizes
  cancelled            boolean NOT NULL DEFAULT false,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contests_ends ON contests (ends_at DESC);

CREATE TABLE IF NOT EXISTS contest_entries (
  contest_id   uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_ids text[] NOT NULL,
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  correct      integer NOT NULL DEFAULT 0,
  total        integer NOT NULL,
  duration_ms  integer,
  timed_out    boolean NOT NULL DEFAULT false,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  place        integer,
  prize_coins  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, user_id)
);
CREATE INDEX IF NOT EXISTS contest_entries_rank ON contest_entries (contest_id, correct DESC, duration_ms ASC);

-- WHATSAPP-STYLE CHATS: channels (broadcast: only admins post, anyone can follow), group/channel descriptions
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('dm','group','channel'));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_channels ON conversations (kind, is_public) WHERE kind = 'channel';

-- CONTEST CENTRE: categories, creative entries, community voting, judging, certificates, sponsors,
-- organizers, disputes, reminders and live Bible battles. Paid entry / paid votes are NOT enabled.
CREATE TABLE IF NOT EXISTS contest_categories (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  description text NOT NULL DEFAULT '',
  format      text NOT NULL CHECK (format IN ('quiz','submission')),
  scoring     text NOT NULL CHECK (scoring IN ('skill','judged','popularity')),
  kinds       text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  position    integer NOT NULL DEFAULT 0
);
INSERT INTO contest_categories (id, label, description, format, scoring, kinds, position) VALUES
  ('bible_knowledge', 'Bible Knowledge Challenge', 'Old and New Testament, characters, events, history, teachings and geography.', 'quiz', 'skill', '{}', 1),
  ('scripture_memory', 'Scripture Memory Contest', 'Complete verses, fill missing words and identify references against the clock.', 'quiz', 'skill', '{}', 2),
  ('daily_quiz', 'Daily Bible Quiz', 'Quick daily questions with points and rankings.', 'quiz', 'skill', '{}', 3),
  ('church_vs_church', 'Church vs Church Challenge', 'Churches compete as teams in Bible quizzes.', 'quiz', 'skill', '{}', 4),
  ('verse_design', 'Bible Verse Design Contest', 'Creative images and designs featuring Bible verses.', 'submission', 'popularity', '{image}', 5),
  ('gospel_talent', 'Gospel Talent Contest', 'Gospel singing, music, spoken word and Christian poetry.', 'submission', 'judged', '{video,audio}', 6),
  ('christian_writing', 'Christian Writing Contest', 'Devotionals, articles, testimonies, stories and Bible studies.', 'submission', 'judged', '{text}', 7),
  ('preaching', 'Preaching Challenge', 'Short sermons or teachings as video, audio or text.', 'submission', 'judged', '{video,audio,text}', 8),
  ('photography', 'Christian Photography Contest', 'Photographs on themes like creation, faith, hope and love.', 'submission', 'judged', '{image}', 9),
  ('video', 'Christian Video Challenge', 'Short inspirational videos, teachings and testimonies.', 'submission', 'popularity', '{video}', 10),
  ('interpretation', 'Bible Interpretation Challenge', 'Explain selected scriptures for qualified judges.', 'submission', 'judged', '{text,video,audio}', 11),
  ('testimony', 'Testimony Contest', 'Personal testimonies of faith, encouragement and transformation.', 'submission', 'popularity', '{text,video,audio}', 12)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_organize boolean NOT NULL DEFAULT false;

ALTER TABLE contests ALTER COLUMN questions SET DEFAULT '[]'::jsonb;
ALTER TABLE contests DROP CONSTRAINT IF EXISTS contests_question_count_check;
ALTER TABLE contests ADD CONSTRAINT contests_question_count_check CHECK (question_count BETWEEN 0 AND 30);
ALTER TABLE contests ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'quiz';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS contest_category text NOT NULL DEFAULT 'bible_knowledge';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS scoring text NOT NULL DEFAULT 'skill';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS judge_weight integer NOT NULL DEFAULT 70;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS voting_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS allow_self_vote boolean NOT NULL DEFAULT false;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS banner_url text;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS rules text NOT NULL DEFAULT '';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS eligibility text NOT NULL DEFAULT '';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS submission_requirements text NOT NULL DEFAULT '';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS judging_criteria text NOT NULL DEFAULT '';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS entry_kinds text[] NOT NULL DEFAULT '{}';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS allow_edits boolean NOT NULL DEFAULT true;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_opens_at timestamptz;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_closes_at timestamptz;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS voting_ends_at timestamptz;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS results_at timestamptz;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS results_published_at timestamptz;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS participant_limit integer;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS eligible_countries text[] NOT NULL DEFAULT '{}';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS entry_fee_minor integer NOT NULL DEFAULT 0;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'NGN';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS team_mode text NOT NULL DEFAULT 'solo';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS approval text NOT NULL DEFAULT 'approved';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS certificates_for text NOT NULL DEFAULT 'winners';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS prize_places jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS contest_registrations (
  contest_id   uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
  disqualified boolean NOT NULL DEFAULT false,
  disqualify_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contest_id, user_id)
);
ALTER TABLE contest_entries ADD COLUMN IF NOT EXISTS disqualified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS contest_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id   uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('image','video','audio','text')),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description  text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  media_key    text,
  thumb_key    text,
  votes        integer NOT NULL DEFAULT 0,
  judge_score  real,
  final_score  real,
  place        integer,
  prize_coins  integer NOT NULL DEFAULT 0,
  disqualified boolean NOT NULL DEFAULT false,
  disqualify_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id)
);
CREATE INDEX IF NOT EXISTS contest_submissions_rank ON contest_submissions (contest_id, votes DESC);

CREATE TABLE IF NOT EXISTS contest_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id    uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES contest_submissions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valid         boolean NOT NULL DEFAULT true,
  reversed_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contest_votes_one ON contest_votes (contest_id, user_id) WHERE valid;

CREATE TABLE IF NOT EXISTS contest_judges (
  contest_id uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contest_id, user_id)
);
CREATE TABLE IF NOT EXISTS contest_judging_scores (
  submission_id uuid NOT NULL REFERENCES contest_submissions(id) ON DELETE CASCADE,
  judge_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score         integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  comment       text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, judge_id)
);

CREATE TABLE IF NOT EXISTS contest_certificates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text UNIQUE NOT NULL,
  contest_id uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('winner','finalist','participant')),
  place      integer,
  achievement text NOT NULL,
  revoked    boolean NOT NULL DEFAULT false,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS contest_sponsors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id  uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  link_url    text,
  contribution text NOT NULL DEFAULT '',
  approved    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contest_disputes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id    uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES contest_submissions(id) ON DELETE SET NULL,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  resolution    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE TABLE IF NOT EXISTS contest_reminders (
  contest_id uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contest_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS battles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player1     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player2     uuid REFERENCES users(id) ON DELETE CASCADE,
  invited     boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished','cancelled')),
  questions   jsonb NOT NULL,
  seconds_per_question integer NOT NULL DEFAULT 12,
  starts_at   timestamptz,
  score1      integer NOT NULL DEFAULT 0,
  score2      integer NOT NULL DEFAULT 0,
  winner      uuid REFERENCES users(id) ON DELETE SET NULL,
  rematch_of  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS battles_waiting ON battles (status, created_at) WHERE status = 'waiting';
CREATE TABLE IF NOT EXISTS battle_answers (
  battle_id  uuid NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  q_index    integer NOT NULL,
  option     integer NOT NULL,
  correct    boolean NOT NULL,
  points     integer NOT NULL DEFAULT 0,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (battle_id, user_id, q_index)
);

-- ---------- OPPORTUNITIES: listings imported from outside sources (jobs, scholarships, grants, hackathons…) ----------
-- Filled by the cron importer (src/lib/opportunities.js). Each listing links back to the original site.
CREATE TABLE IF NOT EXISTS opportunities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  source_id   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('job','remote','internship','scholarship','fellowship','grant','hackathon','competition','volunteer','event','other')),
  title       text NOT NULL,
  org         text,
  location    text,
  remote      boolean NOT NULL DEFAULT false,
  url         text NOT NULL,
  excerpt     text,
  tags        text[] NOT NULL DEFAULT '{}',
  deadline    timestamptz,
  posted_at   timestamptz,
  salary      text,
  hidden      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS opportunities_recent ON opportunities (posted_at DESC NULLS LAST, id DESC) WHERE NOT hidden;
CREATE INDEX IF NOT EXISTS opportunities_kind ON opportunities (kind, posted_at DESC NULLS LAST) WHERE NOT hidden;

CREATE TABLE IF NOT EXISTS opportunity_sources (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_ok_at  timestamptz,
  last_error  text,
  last_count  integer NOT NULL DEFAULT 0
);

-- ---------- YOUTUBE LIVE & COMMENTS: live detection for admin channels, Bible Nestra comments per video ----------
-- Broadcasts (live / upcoming / ended) found by the cron (src/lib/youtubeLive.js). notified_at is set once, atomically,
-- when the one-and-only "LIVE NOW" notification goes out (dedupe by video id).
CREATE TABLE IF NOT EXISTS youtube_live (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        text NOT NULL UNIQUE CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_id      text NOT NULL,
  channel_title   text,
  title           text NOT NULL DEFAULT '',
  thumbnail       text,
  status          text NOT NULL CHECK (status IN ('upcoming','live','ended')),
  scheduled_start timestamptz,
  actual_start    timestamptz,
  actual_end      timestamptz,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz,
  recipients      integer NOT NULL DEFAULT 0,
  push_sent       integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS youtube_live_status ON youtube_live (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS youtube_live_recent ON youtube_live (detected_at DESC);

-- Ordinary (non-broadcast) videos already checked once, so they never cost API quota again
CREATE TABLE IF NOT EXISTS youtube_seen_videos (
  video_id   text PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now()
);

-- One row per live check (cron or "Check now"), for the admin log
CREATE TABLE IF NOT EXISTS youtube_live_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger     text NOT NULL DEFAULT 'cron',
  ran_at      timestamptz NOT NULL DEFAULT now(),
  channels    integer NOT NULL DEFAULT 0,
  checked     integer NOT NULL DEFAULT 0,
  api_calls   integer NOT NULL DEFAULT 0,
  live        integer NOT NULL DEFAULT 0,
  notified    integer NOT NULL DEFAULT 0,
  skipped     text,
  error       text
);
CREATE INDEX IF NOT EXISTS youtube_live_runs_recent ON youtube_live_runs (ran_at DESC);

-- Bible Nestra's own comment thread per YouTube video (independent of YouTube comments). One level of replies.
CREATE TABLE IF NOT EXISTS youtube_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id    text NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES youtube_comments(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  likes_count integer NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS youtube_comments_video ON youtube_comments (video_id, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS youtube_comments_parent ON youtube_comments (parent_id, created_at);
CREATE INDEX IF NOT EXISTS youtube_comments_user ON youtube_comments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS youtube_comment_likes (
  comment_id uuid NOT NULL REFERENCES youtube_comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- ---------- MEDIA LIBRARY: platform Audio Library, Christian Books (PDF), personal & group uploads ----------
-- Files live in R2 under lib/<kind>/<uploaderId>/<uuid>.<ext> and are streamed (HTTP Range) from GET /library/file/<key>.
-- scope: platform = admin-curated library; personal = a user's profile ("My audio"/"My books"); group = inside one community.
-- A group/personal item only appears in the platform library when an admin publishes it (in_library = true).
CREATE TABLE IF NOT EXISTS media_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('audio','pdf')),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  slug        text NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 60),
  icon        text,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, slug)
);
INSERT INTO media_categories (kind, name, slug, icon, sort_order) VALUES
  ('audio', 'Sermons & Preaching', 'sermons', 'mic', 1),
  ('audio', 'Worship & Songs', 'worship', 'music', 2),
  ('audio', 'Audio Bible', 'audio-bible', 'bible', 3),
  ('audio', 'Podcasts & Teaching', 'podcasts', 'headphones', 4),
  ('audio', 'Prayer', 'prayer', 'prayer', 5),
  ('audio', 'Kids', 'kids', 'star', 6),
  ('pdf', 'Classics', 'classics', 'book', 1),
  ('pdf', 'Devotionals', 'devotionals', 'devotional', 2),
  ('pdf', 'Theology & Doctrine', 'theology', 'church', 3),
  ('pdf', 'Biography & History', 'biography', 'user', 4),
  ('pdf', 'Bible Study', 'bible-study', 'bible', 5),
  ('pdf', 'Kids & Family', 'kids', 'star', 6)
ON CONFLICT (kind, slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS media_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('audio','pdf')),
  scope           text NOT NULL CHECK (scope IN ('platform','personal','group')),
  owner_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id    uuid REFERENCES communities(id) ON DELETE CASCADE,
  category_id     uuid REFERENCES media_categories(id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  artist          text CHECK (char_length(artist) <= 120),          -- speaker / artist / author
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  cover_key       text,
  file_key        text NOT NULL UNIQUE,
  mime            text NOT NULL,
  size_bytes      bigint,
  duration_sec    integer,
  pages           integer,
  visibility      text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  in_library      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  featured        boolean NOT NULL DEFAULT false,
  rights_attested boolean NOT NULL DEFAULT false,
  rights_note     text,
  plays           integer NOT NULL DEFAULT 0,
  published_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (scope <> 'group' OR community_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS media_items_library ON media_items (kind, created_at DESC, id DESC) WHERE in_library AND status = 'published';
CREATE INDEX IF NOT EXISTS media_items_owner ON media_items (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_items_group ON media_items (community_id, created_at DESC) WHERE community_id IS NOT NULL;

-- resume position: seconds for audio, page number for PDFs
CREATE TABLE IF NOT EXISTS media_progress (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  position    real NOT NULL DEFAULT 0,
  completed   boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS media_progress_recent ON media_progress (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS media_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution  text,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (item_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS media_reports_open ON media_reports (created_at DESC) WHERE resolved_at IS NULL;

-- ---------- ADS: remote ad rules + daily ad event aggregates (src/lib/ads.js, routes/ads.js) ----------
-- Every save from the admin "Ads" tab inserts a new version; the newest row is what the apps use.
CREATE TABLE IF NOT EXISTS ad_config (
  version     serial PRIMARY KEY,
  config      jsonb NOT NULL,
  note        text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Ad events are folded into daily counts (never stored one by one). test = Google test ads / demo ads.
CREATE TABLE IF NOT EXISTS ad_daily (
  day         date NOT NULL,
  surface     text NOT NULL,
  placement   text NOT NULL,
  format      text NOT NULL,
  test        boolean NOT NULL DEFAULT false,
  requested   integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  completed   integer NOT NULL DEFAULT 0,
  failed      integer NOT NULL DEFAULT 0,
  clicks      integer NOT NULL DEFAULT 0,
  paid        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, surface, placement, format, test)
);
-- Estimated revenue from AdMob impression-level "paid" events, in micros of each currency.
CREATE TABLE IF NOT EXISTS ad_revenue_daily (
  day         date NOT NULL,
  surface     text NOT NULL,
  currency    text NOT NULL,
  test        boolean NOT NULL DEFAULT false,
  micros      bigint NOT NULL DEFAULT 0,
  events      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, surface, currency, test)
);
-- Per-user daily counters for the abuse limits on POST /ads/events (pruned after 14 days).
CREATE TABLE IF NOT EXISTS ad_user_daily (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         date NOT NULL,
  events      integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  paid        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ---------- MEMBER WEBSITES: members add their own website; admins approve; it opens inside the app ----------
-- Approved sites show in the Socials feed strip and the Websites directory and open in the in-app WebView viewer.
CREATE TABLE IF NOT EXISTS member_websites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url          text NOT NULL CHECK (url ~ '^https://'),
  host         text NOT NULL,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description  text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  image_url    text,
  icon_url     text,
  category     text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','hidden')),
  reject_reason text,
  reviewed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  opens        integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, host)
);
CREATE INDEX IF NOT EXISTS member_websites_approved ON member_websites (created_at DESC, id DESC) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS member_websites_pending ON member_websites (created_at) WHERE status = 'pending';

-- ---------- PRAYER WALL CANDLES + CHRISTIAN CARE NETWORK (Talk to a Priest, Talk to an Apostle) ----------
-- "Light a Candle" on a prayer: one candle per user per prayer (toggle). "I am praying" stays in prayer_intercessions.
CREATE TABLE IF NOT EXISTS prayer_candles (
  prayer_id  uuid NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prayer_id, user_id)
);
ALTER TABLE prayers ADD COLUMN IF NOT EXISTS candle_count integer NOT NULL DEFAULT 0;
-- Grouped "N people lit a candle / are praying" notices to the poster: one inbox row per prayer+action,
-- updated in place while it is recent (no new push), a fresh push only after the quiet window.
CREATE TABLE IF NOT EXISTS prayer_support_notices (
  prayer_id       uuid NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('pray','candle')),
  notification_id uuid,
  last_count      integer NOT NULL DEFAULT 0,
  last_push_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prayer_id, action)
);
-- Talk to a Priest: verified Catholic priests. Only status = 'approved' (and a non-banned account) is listed.
CREATE TABLE IF NOT EXISTS care_priests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  title          text NOT NULL DEFAULT 'Rev. Fr.' CHECK (char_length(title) BETWEEN 1 AND 40),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  photo_url      text CHECK (photo_url IS NULL OR photo_url ~ '^https://'),
  parish         text NOT NULL DEFAULT '' CHECK (char_length(parish) <= 160),
  diocese        text NOT NULL DEFAULT '' CHECK (char_length(diocese) <= 160),
  country        text NOT NULL CHECK (char_length(country) BETWEEN 2 AND 80),
  languages      text[] NOT NULL DEFAULT '{}',
  bio            text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 1200),
  availability   text NOT NULL DEFAULT 'available' CHECK (availability IN ('available','busy','away')),
  reference_note text NOT NULL DEFAULT '' CHECK (char_length(reference_note) <= 2000), -- admins only
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','hidden','suspended')),
  reject_reason  text,
  reviewed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_priests_status ON care_priests (status, created_at);
-- Care settings (admin-editable), e.g. key 'apostle' → { userId, greeting }
CREATE TABLE IF NOT EXISTS care_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Labels on chats started from the Care network, so the Apostle / a priest can filter their inbox.
CREATE TABLE IF NOT EXISTS care_conversations (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('apostle','priest')),
  requester_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, kind)
);
CREATE INDEX IF NOT EXISTS care_conversations_target ON care_conversations (target_id, kind, created_at DESC);

-- ---------- TODAY'S JOURNEY: Daily Bread (scheduled verse + image) and blessing videos (admin uploads) ----------
-- The verse TEXT is never stored: the app reads it from its Bible data (any translation) using book/chapter/verse.
CREATE TABLE IF NOT EXISTS daily_bread (
  day          date PRIMARY KEY,
  book_id      text NOT NULL CHECK (book_id ~ '^[1-3]?[A-Z]{2,3}$'),
  chapter      integer NOT NULL CHECK (chapter BETWEEN 1 AND 150),
  verse        integer NOT NULL CHECK (verse BETWEEN 1 AND 176),
  verse_end    integer CHECK (verse_end IS NULL OR verse_end BETWEEN 1 AND 176),
  label        text NOT NULL,
  image_key    text,
  reflection   text NOT NULL DEFAULT '' CHECK (char_length(reflection) <= 1500),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS blessing_videos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description  text NOT NULL DEFAULT '' CHECK (char_length(description) <= 600),
  video_uid    text,
  video_key    text NOT NULL,
  thumb_key    text,
  duration_sec integer,
  width        integer,
  height       integer,
  publish_on   date NOT NULL DEFAULT CURRENT_DATE,
  hidden       boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blessing_videos_published ON blessing_videos (publish_on DESC, created_at DESC) WHERE NOT hidden;
-- Small key/value settings for Today (e.g. 'daily_journey.auto_highlight' → false)
CREATE TABLE IF NOT EXISTS daily_settings (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- WATCH ON TODAY: per-channel feed options, hidden videos, and the cached "latest videos" list (refreshed ~30 min)
ALTER TABLE youtube_channels ADD COLUMN IF NOT EXISTS today_source text NOT NULL DEFAULT 'uploads';
ALTER TABLE youtube_channels ADD COLUMN IF NOT EXISTS today_playlist_id text;
ALTER TABLE youtube_channels ADD COLUMN IF NOT EXISTS today_shorts boolean NOT NULL DEFAULT true;
ALTER TABLE youtube_channels ADD COLUMN IF NOT EXISTS show_on_today boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS youtube_hidden_videos (
  video_id     text PRIMARY KEY CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title        text,
  hidden_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS youtube_latest_cache (
  id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data         jsonb NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- EXEGESIS: one-tap AI exegesis, cached per verse range + translation ----------
-- sections = { a: {historical, cultural, literary, originalLanguage}, b: {keyTerms, interpretation, theology, authorIntent},
--              c: {crossReferences, application} } — parts are merged in as they are generated.
CREATE TABLE IF NOT EXISTS exegesis_cache (
  cache_key    text PRIMARY KEY,
  book_id      text NOT NULL,
  chapter      integer NOT NULL,
  verse_start  integer NOT NULL,
  verse_end    integer NOT NULL,
  translation  text NOT NULL,
  passage_text text NOT NULL DEFAULT '',
  sections     jsonb NOT NULL DEFAULT '{}'::jsonb,
  model        text,
  hits         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- One row per freshly generated part (daily per-user limit on uncached generations).
CREATE TABLE IF NOT EXISTS exegesis_generations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_key   text NOT NULL,
  part        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exegesis_generations_user ON exegesis_generations (user_id, created_at DESC);

-- ---------- BROADCASTS: admin broadcasts to every user's inbox, or to Socials as the official account (src/lib/broadcasts.js) ----------
-- One row per send. Inbox fan-out goes through broadcast_deliveries (PK broadcast+user → nobody gets two copies) in
-- batches; a daily-repeating broadcast is a template (repeat_daily) whose daily copies have parent_id set.
CREATE TABLE IF NOT EXISTS broadcasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target        text NOT NULL CHECK (target IN ('inbox','socials')),
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sending','sent','failed','cancelled')),
  title         text NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  body          text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  media         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ type: image|video, key, url, thumbUrl, … }]
  links         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ url, label, host, title, description, image }]
  pin           boolean NOT NULL DEFAULT false,       -- socials: pin the post to the top of the feed
  post_id       uuid REFERENCES posts(id) ON DELETE SET NULL,
  sender_name   text NOT NULL DEFAULT 'BibleNestra',
  sender_logo   text,
  idem_key      text UNIQUE,
  content_hash  text NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  parent_id     uuid REFERENCES broadcasts(id) ON DELETE SET NULL,
  scheduled_at  timestamptz,
  timezone      text,
  local_time    text,
  repeat_daily  boolean NOT NULL DEFAULT false,
  occurrences   integer NOT NULL DEFAULT 0,
  fanout_cursor uuid,
  lease_until   timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  recipients    integer NOT NULL DEFAULT 0,
  push_sent     integer NOT NULL DEFAULT 0,
  push_failed   integer NOT NULL DEFAULT 0,
  opened        integer NOT NULL DEFAULT 0,
  link_clicks   integer NOT NULL DEFAULT 0,
  clickers      integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  sent_at       timestamptz
);
CREATE INDEX IF NOT EXISTS broadcasts_recent ON broadcasts (created_at DESC);
CREATE INDEX IF NOT EXISTS broadcasts_due ON broadcasts (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS broadcasts_sending ON broadcasts (started_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS broadcasts_hash ON broadcasts (content_hash, created_at DESC);
CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  pushed_at    timestamptz,
  opened_at    timestamptz,
  clicked_at   timestamptz,
  clicks       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (broadcast_id, user_id)
);
-- Socials: admin-pinned posts sit on top of the "For you" feed
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
CREATE INDEX IF NOT EXISTS posts_pinned ON posts (pinned_at DESC) WHERE pinned_at IS NOT NULL AND NOT removed;

-- ---------- CHAT LIMITS + REFERRALS + PAYWALL GUARD (client #27, section 7.5 / 10.3) ----------
-- Subscriber flag (no billing yet: set by an admin or, later, by server-side Play receipt verification).
-- premium_until NULL = no end date; a trial is premium with premium_until = trial end.
ALTER TABLE users ADD COLUMN IF NOT EXISTS premium boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until timestamptz;
-- Personal invite code (created on first GET /me/invite) and the permanent "who invited me" link.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_at timestamptz;
CREATE INDEX IF NOT EXISTS users_referred_by ON users (referred_by) WHERE referred_by IS NOT NULL;
-- One row per platform user a FREE user started a 1:1 chat with (one slot each; idempotent per counterparty).
CREATE TABLE IF NOT EXISTS chat_slots (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, counterparty_id),
  CHECK (user_id <> counterparty_id)
);
-- Subscription prompt impressions (frequency cap paywall.max_impressions_per_day, per local day)
ALTER TABLE users ADD COLUMN IF NOT EXISTS paywall_last_shown_at timestamptz;
CREATE TABLE IF NOT EXISTS paywall_impressions (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        date NOT NULL,
  placement  text NOT NULL CHECK (char_length(placement) BETWEEN 1 AND 40),
  shown_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paywall_impressions_day ON paywall_impressions (user_id, day);

-- ---------- FEED VIDEO RELIABILITY (client #18 / #19 / #29, section 7.1) ----------
-- Upload probe (codec + whether the MP4 index "moov" sits before the media data = can start playing early)
-- and the sweep that marks uploads which never finished (app closed / network lost mid-upload).
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS multipart_id text;      -- R2 multipart uploadId (abort on sweep)
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS codec text;             -- 'h264' | 'hevc' | 'av1' | 'vp9' | 'other'
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS faststart boolean;      -- moov before mdat
ALTER TABLE video_uploads ADD COLUMN IF NOT EXISTS abandoned_at timestamptz;
CREATE INDEX IF NOT EXISTS video_uploads_stale ON video_uploads (created_at) WHERE status = 'uploading';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_codec text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_faststart boolean;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_width integer;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_height integer;

-- ---------- CHAT 7.3 / 7.4: group roles & permissions, invite links, join requests, system messages, files,
-- delivery receipts, typing and presence (routes/conversations.js, routes/chatGroups.js, lib/chatGroups.js) ----------
ALTER TABLE conversation_members DROP CONSTRAINT IF EXISTS conversation_members_role_check;
ALTER TABLE conversation_members ADD CONSTRAINT conversation_members_role_check CHECK (role IN ('owner','admin','moderator','member'));
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;   -- delivery ticks
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS typing_at timestamptz;           -- "Typing…" (polling fallback for the socket event)
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;        -- slow mode
-- { sendMessages: 'all'|'admins', addMembers: 'admins'|'all', editInfo: 'admins'|'all', approveJoins: bool, slowModeSec: int }
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text','image','voice','verse','prayer','event','video','file','system'));
CREATE INDEX IF NOT EXISTS messages_conv_kind ON messages (conversation_id, kind, created_at DESC);
ALTER TABLE users ADD COLUMN IF NOT EXISTS presence_at timestamptz;                         -- "online" = seen in the last ~70 s
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_visibility text NOT NULL DEFAULT 'everyone';
CREATE TABLE IF NOT EXISTS conversation_invites (
  code            text PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  uses            integer NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_invites_conv ON conversation_invites (conversation_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS conversation_join_requests (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  decided_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS conversation_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason          text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- LEARN CMS: courses (ordered lessons: in-app excerpt + blog link), devotionals, and per-user progress
CREATE TABLE IF NOT EXISTS learn_courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  provider     text NOT NULL DEFAULT '' CHECK (char_length(provider) <= 80),
  icon         text NOT NULL DEFAULT 'book',
  cover_key    text,
  level        text NOT NULL DEFAULT 'Beginner',
  format       text NOT NULL DEFAULT 'self_study' CHECK (format IN ('self_study', 'live_cohort')),
  duration     text NOT NULL DEFAULT '' CHECK (char_length(duration) <= 40),
  certificate  boolean NOT NULL DEFAULT false,
  summary      text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 600),
  published    boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS learn_lessons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES learn_courses(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 1,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  excerpt      text NOT NULL DEFAULT '' CHECK (char_length(excerpt) <= 4000),
  image_key    text,
  blog_url     text NOT NULL,
  read_minutes integer CHECK (read_minutes IS NULL OR read_minutes BETWEEN 1 AND 240),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learn_lessons_course ON learn_lessons (course_id, position);
CREATE TABLE IF NOT EXISTS learn_enrollments (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES learn_courses(id) ON DELETE CASCADE,
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS learn_lesson_progress (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES learn_lessons(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES learn_courses(id) ON DELETE CASCADE,
  via          text NOT NULL DEFAULT 'button' CHECK (via IN ('blog', 'button')),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS learn_lesson_progress_course ON learn_lesson_progress (user_id, course_id);
CREATE TABLE IF NOT EXISTS learn_devotionals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  author       text NOT NULL DEFAULT '' CHECK (char_length(author) <= 80),
  cover_key    text,
  publish_on   date NOT NULL DEFAULT CURRENT_DATE,
  excerpt      text NOT NULL DEFAULT '' CHECK (char_length(excerpt) <= 4000),
  blog_url     text NOT NULL,
  published    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learn_devotionals_live ON learn_devotionals (publish_on DESC, created_at DESC) WHERE published;
CREATE TABLE IF NOT EXISTS learn_devotional_reads (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  devotional_id uuid NOT NULL REFERENCES learn_devotionals(id) ON DELETE CASCADE,
  via           text NOT NULL DEFAULT 'button' CHECK (via IN ('blog', 'button')),
  read_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, devotional_id)
);

-- ---------- SCRIPTURE COMPANION: situation → ≥7 validated scriptures + explanations, encouragement, prayer ----------
-- One row per request. The person's message itself is NOT stored (the app re-sends it for the compose step);
-- only the chosen verses, the extracted themes and the compose output, so a retry or re-open is cheap.
CREATE TABLE IF NOT EXISTS companion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  translation  text NOT NULL DEFAULT 'KJV',
  analysis     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { themes, specifics, summary, crisis, model }
  verses       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ ref, label, bookId, chapter, verseStart, verseEnd, translation, text, themes }]
  composed     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { x1: {explanations}, x2: {explanations}, p: {encouragement, prayer} }
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companion_requests_user ON companion_requests (user_id, created_at DESC);
-- The verses each user was given recently (one row per verse), so new replies avoid repeating them (last ~50 kept).
CREATE TABLE IF NOT EXISTS companion_delivered (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verse_key   text NOT NULL,                         -- "PSA 34:18"
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companion_delivered_user ON companion_delivered (user_id, id DESC);

-- ---------- COMMENTARIES: server cache of public-domain commentary chapters (Free Use Bible API) ----------
CREATE TABLE IF NOT EXISTS commentary_cache (
  cache_key   text PRIMARY KEY,                      -- "<commentaryId>/<BOOK>/<chapter>"
  entries     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ verse: number|null, text }]
  hits        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
