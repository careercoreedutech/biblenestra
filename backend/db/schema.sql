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
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text','image','voice','verse','prayer','event','video','file','system','gift')); -- VIRTUAL GIFTS: 'gift' here too, so re-running this file on a database that already has gift messages never fails at this line
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
-- COMPANION MEANING SEARCH: one Workers AI embedding per pooled verse (companionPool.js), built once by the
-- admin endpoint / cron and loaded into isolate memory at request time. vec = base64 of the unit vector
-- quantised to int8 (dims bytes); doc_hash = hash of the embedded document text (label + themes + WEB + KJV).
CREATE TABLE IF NOT EXISTS companion_verse_vectors (
  ref         text NOT NULL,                         -- "PSA 34:18"
  model       text NOT NULL,                         -- "@cf/baai/bge-base-en-v1.5"
  dims        integer NOT NULL,
  doc_hash    text NOT NULL,
  vec         text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ref, model)
);

-- ---------- COMMENTARIES: server cache of public-domain commentary chapters (Free Use Bible API) ----------
CREATE TABLE IF NOT EXISTS commentary_cache (
  cache_key   text PRIMARY KEY,                      -- "<commentaryId>/<BOOK>/<chapter>"
  entries     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ verse: number|null, text }]
  hits        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- CHAT GAPS: link preview cards, timed mute, group bans (routes/chatGaps.js, lib/linkPreviews.js) ----------
-- Link previews: one cached card per https URL (title / description / image / site), refreshed after a TTL.
CREATE TABLE IF NOT EXISTS link_previews (
  url          text PRIMARY KEY,                       -- normalised https URL (lib/websites.js normalizeWebsiteUrl)
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed')),
  title        text,
  description  text,
  image        text,                                   -- https only
  site_name    text,                                   -- host without www.
  final_url    text,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_url text;          -- first https URL in the text (preview key)
-- Timed mute: muted = true with muted_until NULL means "always"; a past muted_until means not muted any more.
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS muted_until timestamptz;
-- Bans: removed-and-banned people can't come back through the invite link or a join request.
CREATE TABLE IF NOT EXISTS conversation_bans (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ---------- CHAT WEEK PASS (client: "when chat reach limits, people can purchase coins to unlock weekly chats") ----------
-- lib/chatLimits.js buyWeekPass(): coins → 7 days of extra NEW chats (CHAT_WEEK_PASS_COINS / CHAT_WEEK_PASS_EXTRA_SLOTS).
-- Chats started through a pass are tagged via_pass so the free count never exceeds chat.free_platform_slots.
ALTER TABLE chat_slots ADD COLUMN IF NOT EXISTS via_pass boolean NOT NULL DEFAULT false;
-- current pass chain (extends from the current expiry while active; a purchase after expiry starts a new chain)
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_pass_started_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_pass_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_pass_extra integer NOT NULL DEFAULT 0; -- extra new chats in the chain, -1 = unlimited
-- append-only purchase log (admin "Chat passes" tab); UNIQUE key = no double charge on retries
CREATE TABLE IF NOT EXISTS chat_passes (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),
  coins           integer NOT NULL CHECK (coins > 0),
  extra_slots     integer NOT NULL,              -- -1 = unlimited
  expires_at      timestamptz NOT NULL,          -- the chain's expiry after this purchase
  extended        boolean NOT NULL DEFAULT false, -- bought while a pass was still active
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS chat_passes_created ON chat_passes (created_at DESC);
-- PLAY BILLING HOOK (Phase 3, lib/coinPurchases.js creditPurchasedCoins): one credit per Play purchase token
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_purchase_ref ON coin_ledger (ref) WHERE reason = 'purchase';

-- ---------- BLOG: our own blog at /blog (routes/blog.js, lib/blog.js) + AI auto-posting schedules ----------
CREATE TABLE IF NOT EXISTS blog_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  topics         jsonb NOT NULL DEFAULT '[]'::jsonb,      -- ["Prayer", "Faith", "my custom topic"] (rotated in order)
  prompt         text NOT NULL DEFAULT '',                -- free guidance for the writer
  tone           text NOT NULL DEFAULT 'warm',
  length         text NOT NULL DEFAULT 'medium' CHECK (length IN ('short','medium','long')),
  posts_per_run  integer NOT NULL DEFAULT 1 CHECK (posts_per_run BETWEEN 1 AND 5),
  frequency      text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly','monthly')),
  weekdays       jsonb NOT NULL DEFAULT '[1]'::jsonb,     -- weekly: 0 = Sunday … 6 = Saturday
  month_day      integer NOT NULL DEFAULT 1 CHECK (month_day BETWEEN 1 AND 31), -- monthly (31 → last day of short months)
  time_of_day    text NOT NULL DEFAULT '08:00',           -- local HH:MM in timezone
  timezone       text NOT NULL DEFAULT 'Africa/Lagos',
  publish_mode   text NOT NULL DEFAULT 'draft' CHECK (publish_mode IN ('draft','publish')),
  notify         boolean NOT NULL DEFAULT false,          -- queue an inbox broadcast when its post is published
  active         boolean NOT NULL DEFAULT true,
  base_url       text,                                    -- public origin captured from the admin (for notification links)
  next_run_at    timestamptz,
  last_run_at    timestamptz,
  pending        integer NOT NULL DEFAULT 0,              -- posts still to write for the current run
  pending_run_id uuid,
  topic_cursor   integer NOT NULL DEFAULT 0,              -- rotation position in topics
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_schedules_due ON blog_schedules (next_run_at) WHERE active;
CREATE TABLE IF NOT EXISTS blog_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  excerpt         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',               -- simple Markdown (rendered + escaped server-side)
  cover_key       text,                                   -- R2 key from /uploads/image or an https URL
  topic           text,
  tags            jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published')),
  publish_at      timestamptz,                            -- scheduled: goes live at this time
  published_at    timestamptz,
  author          text NOT NULL DEFAULT 'BibleNestra',
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  schedule_id     uuid REFERENCES blog_schedules(id) ON DELETE SET NULL,
  run_id          uuid,
  seo_description text NOT NULL DEFAULT '',
  reading_minutes integer NOT NULL DEFAULT 1,
  views           integer NOT NULL DEFAULT 0,
  review_note     text,                                   -- e.g. "Held for review: politics"
  notified_at     timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_posts_live ON blog_posts (published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS blog_posts_due ON blog_posts (publish_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS blog_posts_recent ON blog_posts (created_at DESC);
CREATE TABLE IF NOT EXISTS blog_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  uuid REFERENCES blog_schedules(id) ON DELETE CASCADE,
  trigger      text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron','manual')),
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed')),
  wanted       integer NOT NULL DEFAULT 1,
  made         integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  post_ids     jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS blog_runs_recent ON blog_runs (started_at DESC);
CREATE TABLE IF NOT EXISTS blog_settings (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  disclaimer      boolean NOT NULL DEFAULT false,         -- show a line under AI-written posts
  disclaimer_text text,
  author_name     text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- LEGAL: account deletion log (routes/legal.js, lib/accountDeletion.js) ----------
-- One row per deleted account. Holds NO personal data (no user id, name, email or handle): only when, how and
-- what was removed, so a deletion can be shown as done. pending_login_id is the Clerk id ONLY while the Clerk login
-- still needs deleting (admin "Retry"); it is cleared as soon as that succeeds.
CREATE TABLE IF NOT EXISTS account_deletions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text NOT NULL CHECK (source IN ('app','admin')),
  status           text NOT NULL CHECK (status IN ('done','partial')),
  files_deleted    integer NOT NULL DEFAULT 0,
  files_failed     integer NOT NULL DEFAULT 0,
  login_deleted    boolean NOT NULL DEFAULT false,
  pending_login_id text,
  note             text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS account_deletions_requested ON account_deletions (requested_at DESC);

-- ---------- JOBS FEEDS (round 2): who can apply, permission-gated sources, the Job & Academic Directory ----------
-- open_to: 'nigeria' | 'africa' | 'worldwide' | NULL (unknown) — set by the importer where the source data says so
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS open_to text;
CREATE INDEX IF NOT EXISTS opportunities_open_to ON opportunities (open_to) WHERE open_to IS NOT NULL;
-- admin_on: set when an admin switches a source on; sources whose terms need permission run only when true
ALTER TABLE opportunity_sources ADD COLUMN IF NOT EXISTS admin_on boolean NOT NULL DEFAULT false;
-- Admin edits to the directory (defaults live in src/lib/jobsDirectory.js; a row here overrides the default with the
-- same slug, or adds a new entry)
CREATE TABLE IF NOT EXISTS opportunity_directory (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  category    text NOT NULL,
  name        text NOT NULL,
  url         text NOT NULL,
  description text NOT NULL DEFAULT '',
  hidden      boolean NOT NULL DEFAULT false,
  sort        integer,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- MEMBERSHIPS & PAID CHANNELS (brief section 8: one unified system, three entry points) ----------
-- A membership = catalogue listing + plans + a Broadcast Channel and a Community group (rows in conversations with
-- membership_id set) + an ordered content library. Access = an active subscription row (checked by the API on every
-- library / channel / community request). Creation is admin-only unless MEMBERSHIPS_PUBLIC_CREATION=true.
CREATE TABLE IF NOT EXISTS memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  category        text NOT NULL DEFAULT 'Bible Study',
  cover_key       text,                                  -- uploaded img/... key or an https image URL
  intro_video_url text,
  headline        text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  benefits        jsonb NOT NULL DEFAULT '[]'::jsonb,    -- ["Weekly live Bible class", ...]
  owner_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  creator_name    text,                                  -- optional override of the owner display name
  creator_bio     text,                                  -- optional override of the owner bio
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  member_count    integer NOT NULL DEFAULT 0,
  rating_avg      numeric(3,2) NOT NULL DEFAULT 0,
  rating_count    integer NOT NULL DEFAULT 0,
  faqs            jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ q, a }]
  questions       jsonb NOT NULL DEFAULT '[]'::jsonb,    -- custom checkout questions [{ label, required }]
  sort_order      integer NOT NULL DEFAULT 0,            -- admin "featured" boost for Trending
  trending_score  numeric NOT NULL DEFAULT 0,
  channel_id      uuid REFERENCES conversations(id) ON DELETE SET NULL,
  community_id    uuid REFERENCES conversations(id) ON DELETE SET NULL,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memberships_status ON memberships (status, trending_score DESC);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_membership ON conversations (membership_id) WHERE membership_id IS NOT NULL;

-- interval: 'one_time' (interval_days = days of access, NULL = lifetime) | 'month' | 'year' | 'days' (custom renewal)
CREATE TABLE IF NOT EXISTS membership_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id    uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT 'Membership',
  price_minor      bigint NOT NULL CHECK (price_minor >= 0),          -- kobo for NGN
  currency         text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  interval         text NOT NULL DEFAULT 'month' CHECK (interval IN ('one_time','month','year','days')),
  interval_days    integer CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),
  active           boolean NOT NULL DEFAULT true,
  store_product_id text,                                               -- Google Play / App Store product id (Phase 3)
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_plans_m ON membership_plans (membership_id, sort_order);

-- One row per (membership, user); renewals update it. Access = status IN (active, trialing, cancelled) and not past expires_at.
CREATE TABLE IF NOT EXISTS membership_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id        uuid REFERENCES membership_plans(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','trialing','expired','cancelled','refunded')),
  source         text NOT NULL CHECK (source IN ('play','admin_grant','test')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,                                          -- NULL = no end date
  answers        jsonb NOT NULL DEFAULT '[]'::jsonb,                   -- answers to the custom checkout questions
  contact        jsonb NOT NULL DEFAULT '{}'::jsonb,                   -- { email, phone, name, country } typed at checkout
  promo_code     text,
  amount_minor   bigint,
  currency       text,
  purchase_token text,                                                 -- verified Google Play purchase token
  checkout_key   text,                                                 -- idempotency key of the last checkout
  granted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  note           text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, user_id)
);
CREATE INDEX IF NOT EXISTS membership_subs_user ON membership_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS membership_subs_expiry ON membership_subscriptions (expires_at) WHERE status IN ('active','trialing','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS membership_subs_token ON membership_subscriptions (purchase_token) WHERE purchase_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS membership_promos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  code          text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,30}$'),
  kind          text NOT NULL CHECK (kind IN ('percent','amount')),
  value         bigint NOT NULL CHECK (value > 0),                    -- percent (1-100) or minor units
  max_uses      integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses          integer NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, code)
);

CREATE TABLE IF NOT EXISTS membership_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  hidden        boolean NOT NULL DEFAULT false,                        -- hidden by an admin (moderation)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, user_id)
);
CREATE INDEX IF NOT EXISTS membership_reviews_m ON membership_reviews (membership_id, created_at DESC);

-- Content library: ordered lessons (video link, file link or text) with per-member progress
CREATE TABLE IF NOT EXISTS membership_lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  position      integer NOT NULL DEFAULT 0,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  kind          text NOT NULL DEFAULT 'text' CHECK (kind IN ('video','file','text')),
  body          text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
  media_url     text,
  minutes       integer CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1000),
  is_sample     boolean NOT NULL DEFAULT false,                        -- title shown on the product page as a sample lesson
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_lessons_m ON membership_lessons (membership_id, position);
CREATE TABLE IF NOT EXISTS membership_lesson_progress (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id     uuid NOT NULL REFERENCES membership_lessons(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

-- ============================================================
-- WALLET CORE (monetisation stage 1, client spec §15 + brief 3.4 / 3.5 / 10.4)
-- Separate balances per wallet, one append-only ledger. Library + contract: src/lib/wallet.js and
-- scratch/monetisation/wallet-core.md. The old users.coins / coin_ledger ("Kingdom Coins": earned from games, ads and
-- contests; spent on chat passes, job bids and the legacy /gifts route) is untouched and is NOT one of these wallets.
-- ============================================================
-- One row per money/coin movement ("operation"). ref is the idempotency key: the same ref can only ever apply once.
CREATE TABLE IF NOT EXISTS wallet_ops (
  ref         text PRIMARY KEY CHECK (char_length(ref) BETWEEN 3 AND 200),
  kind        text NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,   -- acting user / admin (null = system)
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Current balance per (account, wallet). account = the user's uuid as text, or 'platform' for BibleNestra's own ledgers.
-- Updated in the SAME SQL statement as the ledger rows; the CHECK makes a negative balance impossible (the whole
-- statement, i.e. every leg of the operation, is rolled back).
CREATE TABLE IF NOT EXISTS wallet_balances (
  account     text NOT NULL,
  wallet      text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  balance     bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account, wallet),
  CONSTRAINT wallet_balances_nonneg CHECK (balance >= 0)
);
CREATE INDEX IF NOT EXISTS wallet_balances_wallet ON wallet_balances (wallet);
-- Append-only ledger: one row per leg. (ref, leg) is unique; amount is signed integer units of the wallet.
CREATE TABLE IF NOT EXISTS wallet_entries (
  id              bigserial PRIMARY KEY,
  ref             text NOT NULL REFERENCES wallet_ops(ref),
  leg             smallint NOT NULL,
  account         text NOT NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  wallet          text NOT NULL,
  amount          bigint NOT NULL CHECK (amount <> 0),
  balance_after   bigint NOT NULL CHECK (balance_after >= 0),
  kind            text NOT NULL,
  counterparty_id uuid,                     -- the other person (gift sender / recipient, transfer partner)
  related_type    text,                     -- 'purchase' | 'subscription' | 'gift' | 'fundraiser' | 'donation' | 'payout' …
  related_id      text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ref, leg)
);
CREATE INDEX IF NOT EXISTS wallet_entries_account ON wallet_entries (account, wallet, id DESC);
CREATE INDEX IF NOT EXISTS wallet_entries_kind ON wallet_entries (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_entries_created ON wallet_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_entries_related ON wallet_entries (related_type, related_id) WHERE related_id IS NOT NULL;
-- Ledger rows are never edited or deleted (brief 10.4). Only user_id may be nulled (account deletion, ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION wallet_entries_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'wallet_entries is append-only'; END IF;
  IF NEW.ref <> OLD.ref OR NEW.leg <> OLD.leg OR NEW.account <> OLD.account OR NEW.wallet <> OLD.wallet
     OR NEW.amount <> OLD.amount OR NEW.balance_after <> OLD.balance_after OR NEW.kind <> OLD.kind
     OR NEW.created_at <> OLD.created_at OR (NEW.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'wallet_entries is append-only';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wallet_entries_append_only ON wallet_entries;
CREATE TRIGGER wallet_entries_append_only BEFORE UPDATE OR DELETE ON wallet_entries
  FOR EACH ROW EXECUTE FUNCTION wallet_entries_immutable();

-- Admin-editable settings (gift commission, gifting-coin conversion rate, earnings hold, …). Defaults live in wallet.js.
CREATE TABLE IF NOT EXISTS wallet_config (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Packages (coin / credit packs) and subscription plans. Prices in minor units (kobo for NGN).
CREATE TABLE IF NOT EXISTS wallet_products (
  id               text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_]{2,60}$'),
  type             text NOT NULL CHECK (type IN ('pack','subscription')),
  area             text NOT NULL CHECK (area IN ('fundme','dating','gifts')),
  wallet           text,                                   -- packs: wallet credited (fundme_credits | dating_coins | gift_coins)
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description      text NOT NULL DEFAULT '' CHECK (char_length(description) <= 600),
  units            bigint NOT NULL DEFAULT 0 CHECK (units >= 0),        -- packs: units credited
  bonus_units      bigint NOT NULL DEFAULT 0 CHECK (bonus_units >= 0),  -- packs: extra units ("bonus tier")
  price_minor      bigint NOT NULL CHECK (price_minor > 0),
  currency         text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  interval         text CHECK (interval IS NULL OR interval IN ('month','year')),
  tier             smallint NOT NULL DEFAULT 0,                         -- subscriptions: 1 = Plus, 2 = VIP (higher = more)
  benefits         jsonb NOT NULL DEFAULT '{}'::jsonb,                  -- subscriptions: { features:[…], flags:{…}, perCycle:[{wallet,amount}], badge }
  play_product_id  text UNIQUE,
  apple_product_id text UNIQUE,
  active           boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'pack' AND wallet IS NOT NULL AND units > 0) OR (type = 'subscription' AND interval IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS wallet_products_list ON wallet_products (area, type, active, sort_order);
-- Client's prices (spec §1, §4, §13, §14). Gifting Coin packs are OUR PROPOSAL at the default conversion rate
-- (wallet_config gift_coin_rate, 1 coin = ₦1) — "proposal, client to confirm" (spec §9: never assume ₦1 = fixed coins).
-- Admins edit every package, price and the conversion rate in Admin › Wallets & payments.
INSERT INTO wallet_products (id, type, area, wallet, title, units, price_minor, play_product_id, sort_order) VALUES
  ('fundme_credits_7',   'pack','fundme','fundme_credits','7 Fund Me credits',     7,    35000, 'bn_fundme_credits_7',   1),
  ('fundme_credits_15',  'pack','fundme','fundme_credits','15 Fund Me credits',   15,    70000, 'bn_fundme_credits_15',  2),
  ('fundme_credits_30',  'pack','fundme','fundme_credits','30 Fund Me credits',   30,   130000, 'bn_fundme_credits_30',  3),
  ('fundme_credits_50',  'pack','fundme','fundme_credits','50 Fund Me credits',   50,   200000, 'bn_fundme_credits_50',  4),
  ('fundme_credits_100', 'pack','fundme','fundme_credits','100 Fund Me credits', 100,   350000, 'bn_fundme_credits_100', 5),
  ('fundme_credits_200', 'pack','fundme','fundme_credits','200 Fund Me credits', 200,   600000, 'bn_fundme_credits_200', 6),
  ('dating_coins_100',   'pack','dating','dating_coins','100 Dating Coins',      100,    35000, 'bn_dating_coins_100',   1),
  ('dating_coins_250',   'pack','dating','dating_coins','250 Dating Coins',      250,    70000, 'bn_dating_coins_250',   2),
  ('dating_coins_500',   'pack','dating','dating_coins','500 Dating Coins',      500,   130000, 'bn_dating_coins_500',   3),
  ('dating_coins_1000',  'pack','dating','dating_coins','1,000 Dating Coins',   1000,   250000, 'bn_dating_coins_1000',  4),
  ('dating_coins_2500',  'pack','dating','dating_coins','2,500 Dating Coins',   2500,   500000, 'bn_dating_coins_2500',  5),
  ('dating_coins_5000',  'pack','dating','dating_coins','5,000 Dating Coins',   5000,   900000, 'bn_dating_coins_5000',  6),
  ('dating_coins_10000', 'pack','dating','dating_coins','10,000 Dating Coins', 10000,  1500000, 'bn_dating_coins_10000', 7),
  ('gift_coins_500',     'pack','gifts','gift_coins','500 Gifting Coins',        500,    50000, 'bn_gift_coins_500',     1),
  ('gift_coins_1000',    'pack','gifts','gift_coins','1,000 Gifting Coins',     1000,   100000, 'bn_gift_coins_1000',    2),
  ('gift_coins_2500',    'pack','gifts','gift_coins','2,500 Gifting Coins',     2500,   250000, 'bn_gift_coins_2500',    3),
  ('gift_coins_5000',    'pack','gifts','gift_coins','5,000 Gifting Coins',     5000,   500000, 'bn_gift_coins_5000',    4),
  ('gift_coins_10000',   'pack','gifts','gift_coins','10,000 Gifting Coins',   10000,  1000000, 'bn_gift_coins_10000',   5),
  ('gift_coins_50000',   'pack','gifts','gift_coins','50,000 Gifting Coins',   50000,  5000000, 'bn_gift_coins_50000',   6),
  ('gift_coins_100000',  'pack','gifts','gift_coins','100,000 Gifting Coins', 100000, 10000000, 'bn_gift_coins_100000',  7)
ON CONFLICT (id) DO NOTHING;
INSERT INTO wallet_products (id, type, area, title, description, price_minor, interval, tier, benefits, play_product_id, sort_order) VALUES
  ('dating_plus_monthly', 'subscription', 'dating', 'Dating Plus', 'Renews monthly unless cancelled.', 150000, 'month', 1,
   '{"badge":"PLUS","features":["See who liked you","Advanced filters","More recommendations","Undo swipes","Ad-free dating","No rewarded-ad requirement","Unrestricted messaging with matches","Better preference control"],"flags":{"seeWhoLiked":true,"advancedFilters":true,"moreRecommendations":true,"undoSwipes":true,"adFree":true,"noRewardedAds":true,"unlimitedMatchMessaging":true},"perCycle":[]}'::jsonb,
   'bn_dating_plus_monthly', 1),
  ('dating_vip_monthly', 'subscription', 'dating', 'Dating VIP', 'Renews monthly unless cancelled.', 350000, 'month', 2,
   '{"badge":"VIP","features":["Everything in Dating Plus","300 bonus Dating Coins every month","2 profile boosts every month","Priority visibility","Advanced location and compatibility filters","VIP badge","Ad-free","No rewarded-ad requirement","Unrestricted messaging"],"flags":{"seeWhoLiked":true,"advancedFilters":true,"moreRecommendations":true,"advancedLocationFilters":true,"undoSwipes":true,"adFree":true,"noRewardedAds":true,"unlimitedMatchMessaging":true,"priorityVisibility":true,"vipBadge":true},"perCycle":[{"wallet":"dating_coins","amount":300},{"wallet":"dating_boosts","amount":2}]}'::jsonb,
   'bn_dating_vip_monthly', 2)
ON CONFLICT (id) DO NOTHING;

-- Every purchase attempt of a digital good (packs, Dating Plus / VIP). Credits happen ONLY in walletStore.js
-- activatePurchase() after verification (ledger ref 'purchase:<id>'), so a redelivered Play token or a retried request
-- never credits twice. Providers: play (Google Play Billing), apple (slot), test (admins / testers, no money). Paystack
-- is NOT allowed here — it is only for Fund Me donations (donations table).
CREATE TABLE IF NOT EXISTS wallet_purchases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  product_id       text NOT NULL REFERENCES wallet_products(id),
  provider         text NOT NULL CHECK (provider IN ('play','apple','test')),
  provider_ref     text,                                   -- Play purchase token / Apple transaction id / 'test:<id>'
  order_id         text,                                   -- store order id once verified
  idempotency_key  text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),
  amount_minor     bigint NOT NULL,
  currency         text NOT NULL,
  units            bigint NOT NULL DEFAULT 0,               -- units credited (packs)
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed','refunded')),
  test             boolean NOT NULL DEFAULT false,
  error_code       text,
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,       -- store verification response
  created_at       timestamptz NOT NULL DEFAULT now(),
  verified_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_purchases_provider_ref ON wallet_purchases (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallet_purchases_status ON wallet_purchases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_purchases_user ON wallet_purchases (user_id, created_at DESC);

-- Dating Plus / VIP. One live subscription per user (active / cancelled-until-period-end / past_due).
CREATE TABLE IF NOT EXISTS dating_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid REFERENCES users(id) ON DELETE CASCADE,
  product_id           text NOT NULL REFERENCES wallet_products(id),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due','expired','refunded')),
  provider             text NOT NULL CHECK (provider IN ('play','apple','test','admin')),
  purchase_token       text,                                -- Play subscription token (renewals arrive for the same token)
  auto_renew           boolean NOT NULL DEFAULT true,
  test                 boolean NOT NULL DEFAULT false,
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancelled_at         timestamptz,
  ended_at             timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dating_subs_live ON dating_subscriptions (user_id) WHERE status IN ('active','cancelled','past_due');
CREATE INDEX IF NOT EXISTS dating_subs_due ON dating_subscriptions (current_period_end) WHERE status IN ('active','cancelled','past_due');
-- A Play subscription token belongs to one subscription (renewal notifications find it by token).
CREATE UNIQUE INDEX IF NOT EXISTS dating_subs_token ON dating_subscriptions (provider, purchase_token) WHERE purchase_token IS NOT NULL;
-- One row per paid billing cycle. The PRIMARY KEY makes the cycle's benefits grant (VIP: 300 coins + 2 boosts) once-only.
CREATE TABLE IF NOT EXISTS dating_subscription_periods (
  subscription_id uuid NOT NULL REFERENCES dating_subscriptions(id) ON DELETE CASCADE,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  purchase_id     uuid REFERENCES wallet_purchases(id) ON DELETE SET NULL,
  grant_ref       text,                                     -- wallet_ops.ref of the benefits grant (null = nothing to grant)
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, period_start)
);

-- Fund Me payouts (ledger E). Schema + ledger helpers only; the Fund Me agent builds verification / approval flows.
-- Donation money is held by BibleNestra (ledger wallet donations_held_<cur> on the beneficiary's account) and moves
-- to donations_paid_<cur> when a payout is marked paid.
CREATE TABLE IF NOT EXISTS fundme_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  fundraiser_id   uuid REFERENCES fundraisers(id) ON DELETE SET NULL,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor       bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  currency        text NOT NULL CHECK (currency IN ('GBP','USD','EUR','NGN')),
  status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','under_review','approved','processing','paid','failed','cancelled')),
  provider        text,                                     -- 'paystack' transfer, 'manual' bank transfer …
  provider_ref    text UNIQUE,
  approved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  paid_at         timestamptz,
  failure_reason  text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fundme_payouts_status ON fundme_payouts (status, created_at DESC);
-- Donation verification states the client asked for (spec §3), next to the provider status in donations.status.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'pending'
  CHECK (settlement_status IN ('pending','processing','verified','approved_for_payout','paid','failed','refunded','under_review'));
ALTER TABLE donations ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES fundme_payouts(id) ON DELETE SET NULL;

-- Simple fixed-window rate limits for wallet write endpoints (key = '<action>:<user id>').
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key          text NOT NULL,
  window_start bigint NOT NULL,
  n            integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- ============================================================
-- FIND LOVE (Christian dating) — brief §9, client spec §5 / §6 / §7 / §13 / §14. Owner: Find Love stage.
-- Library: src/lib/dating.js · routes: src/routes/dating.js · notes: scratch/monetisation/dating.md.
-- Coins are spent through the wallet core (wallet 'dating_coins' / 'dating_boosts', post() only). The rows below are the
-- business records; every paid row is written in the same transaction as its ledger entry (post alsoRun), keyed by the
-- ledger ref, so a retry never doubles anything. Dating activity is never shown in Socials.
-- ============================================================
-- One opt-in dating profile per member, separate from the social profile (users.*). City-level location only.
CREATE TABLE IF NOT EXISTS dating_profiles (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name         text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 40),
  birth_date         date NOT NULL,                              -- 18+ checked on every save; age shown, never the date
  gender             text NOT NULL CHECK (gender IN ('man','woman')),
  interested_in      text NOT NULL CHECK (interested_in IN ('men','women')),
  city               text NOT NULL DEFAULT '' CHECK (char_length(city) <= 60),
  country            text NOT NULL DEFAULT '' CHECK (char_length(country) <= 60),
  denomination       text NOT NULL DEFAULT '' CHECK (char_length(denomination) <= 60),
  church_involvement text NOT NULL DEFAULT '' CHECK (char_length(church_involvement) <= 60),
  intention          text NOT NULL DEFAULT 'marriage' CHECK (intention IN ('marriage','long_term','friendship_first','not_sure')),
  bio                text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
  prompts            jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{ q, a }] max 3
  prefs              jsonb NOT NULL DEFAULT '{}'::jsonb,          -- { ageMin, ageMax, country, city, denominations[], intentions[], involvement[], compatibleOnly }
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','banned')),  -- paused = hidden by the member
  verified           boolean NOT NULL DEFAULT false,              -- HOOK: photo / ID verification ("Verified" badge), not built yet
  adult_confirmed_at timestamptz NOT NULL DEFAULT now(),
  ban_reason         text,
  last_active_at     timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dating_profiles_active ON dating_profiles (status, gender, last_active_at DESC);
-- Photos and their moderation queue (pending → approved / rejected). url = https URL or an R2 key under img/<user>/.
CREATE TABLE IF NOT EXISTS dating_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         text NOT NULL CHECK (char_length(url) <= 600),
  position    smallint NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dating_photos_user ON dating_photos (user_id, position);
CREATE INDEX IF NOT EXISTS dating_photos_queue ON dating_photos (status, created_at);
-- Swipes (one per pair). action: like | pass | super_like | priority_like. day = the swiper's local date (daily allowance).
CREATE TABLE IF NOT EXISTS dating_swipes (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('like','pass','super_like','priority_like')),
  day        date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id),
  CHECK (user_id <> target_id)
);
CREATE INDEX IF NOT EXISTS dating_swipes_target ON dating_swipes (target_id, action);
CREATE INDEX IF NOT EXISTS dating_swipes_day ON dating_swipes (user_id, day);
-- Profiles served in someone's stack (boost stats "views"; last_seen_at moves on every serve).
CREATE TABLE IF NOT EXISTS dating_views (
  viewer_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_id, target_id)
);
CREATE INDEX IF NOT EXISTS dating_views_target ON dating_views (target_id, last_seen_at);
-- Matches (user_a < user_b). conversation_id = the DM labelled 'dating' (dating_conversations).
CREATE TABLE IF NOT EXISTS dating_matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','unmatched')),
  via             text NOT NULL DEFAULT 'like' CHECK (via IN ('like','message_request')),
  unmatched_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  unmatched_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS dating_matches_b ON dating_matches (user_b, status);
-- The label on a DM conversation (same pattern as care_conversations): every chat feature and gift works in it, and
-- the send path asks lib/dating.js datingSendGuard() for the free-user message allowance (one marked hook).
-- status: request (paid message request, not accepted yet) · match · declined · closed (unmatched / blocked / banned).
CREATE TABLE IF NOT EXISTS dating_conversations (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  user_a          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  match_id        uuid REFERENCES dating_matches(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'match' CHECK (status IN ('request','match','declined','closed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);
-- Every Dating Coin use (spec §5 / §16 "coin usage records"). ref = the wallet_ops ref (same transaction).
-- units: swipes / messages / hours granted by this use. Allowances are SUMs over these rows, so they are idempotent.
CREATE TABLE IF NOT EXISTS dating_spends (
  ref             text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL,          -- super_like | priority_like | message_request | see_who_liked | boost_30m | boost_1h | boost_3h | spotlight_24h | extra_swipes | message_bundle
  wallet          text NOT NULL DEFAULT 'dating_coins',
  amount          integer NOT NULL,       -- coins (or boosts) spent
  units           integer NOT NULL DEFAULT 0,
  target_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  day             date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dating_spends_user ON dating_spends (user_id, kind, day);
CREATE INDEX IF NOT EXISTS dating_spends_conv ON dating_spends (conversation_id, user_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dating_spends_created ON dating_spends (created_at DESC);
-- Rewarded-ad completions for Find Love (spec §6). The server issues a nonce first; one reward per nonce
-- (status issued → claimed in one UPDATE), one per AdMob transaction id (UNIQUE). verified = AdMob SSV confirmed it.
CREATE TABLE IF NOT EXISTS dating_ad_rewards (
  nonce           text PRIMARY KEY CHECK (char_length(nonce) BETWEEN 16 AND 64),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  purpose         text NOT NULL DEFAULT 'dating_messages' CHECK (purpose IN ('dating_messages')),
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','claimed','expired','rejected')),
  units           integer NOT NULL DEFAULT 0,            -- free messages granted when claimed
  verified        boolean NOT NULL DEFAULT false,        -- AdMob server-side verification received
  transaction_id  text UNIQUE,                           -- AdMob SSV transaction id
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  claimed_at      timestamptz,
  claimed_via     text CHECK (claimed_via IN ('client','ssv'))   -- who applied the reward first
);
CREATE INDEX IF NOT EXISTS dating_ad_rewards_conv ON dating_ad_rewards (conversation_id, user_id, status);
CREATE INDEX IF NOT EXISTS dating_ad_rewards_user ON dating_ad_rewards (user_id, issued_at DESC);
-- Messages a free member has sent in a dating chat (consumed against SUM(ad units) + SUM(bundle units)).
CREATE TABLE IF NOT EXISTS dating_message_usage (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used            integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
-- Boosts and Spotlight (spec §7). Ranking only: never bypasses filters, preferences or blocks. Auto-stops at ends_at.
CREATE TABLE IF NOT EXISTS dating_boosts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        text UNIQUE NOT NULL,        -- the wallet_ops ref that paid for it
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('boost_30m','boost_1h','boost_3h','spotlight_24h')),
  paid_with  text NOT NULL CHECK (paid_with IN ('dating_coins','dating_boosts')),
  amount     integer NOT NULL,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dating_boosts_live ON dating_boosts (user_id, ends_at DESC);
CREATE INDEX IF NOT EXISTS dating_boosts_ends ON dating_boosts (ends_at);
-- Reports from Find Love (admin moderation queue).
CREATE TABLE IF NOT EXISTS dating_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('fake','inappropriate_photos','harassment','scam','underage','offensive','other')),
  details     text NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  action      text,
  handled_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dating_reports_status ON dating_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS dating_reports_target ON dating_reports (target_id);
-- END FIND LOVE

-- ============================================================
-- FUND ME MONEY (monetisation stage 2, client spec §1 §2 §3 §15E §16 §17). Owner: Fund Me agent.
-- Request credits (publish = 1 fundme_credits spend, at approval), anti-fraud flags, donations held by BibleNestra
-- (Paystack), donation status history, beneficiary bank accounts, payouts. Ledger rows live in the WALLET CORE tables.
-- Docs: scratch/monetisation/fundme.md
-- ============================================================
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb;  -- [{code,label,detail}] set at submission
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS text_hash text;                                 -- normalised title+story hash (duplicate text)
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS image_hashes text[] NOT NULL DEFAULT '{}';       -- R2 etag:size of its photos (duplicate images)
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS first_submitted_at timestamptz;                 -- publishing limits count requests, not resubmissions
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS publish_ref text;                               -- wallet_ops.ref of the credit spent when it was published
CREATE INDEX IF NOT EXISTS fundraisers_text_hash ON fundraisers (text_hash) WHERE text_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS fundraisers_first_submitted ON fundraisers (owner_id, first_submitted_at);

-- Donations: allocated to the beneficiary + request when created; money only counts after gateway verification.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS beneficiary_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_email text CHECK (donor_email IS NULL OR char_length(donor_email) <= 200); -- Paystack receipt
ALTER TABLE donations ADD COLUMN IF NOT EXISTS net_minor bigint CHECK (net_minor IS NULL OR net_minor >= 0);                  -- amount − fee (held for the beneficiary)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS received_at timestamptz;                           -- gateway confirmed (ledger: donation:<id>)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS verified_at timestamptz;                           -- BibleNestra verified
ALTER TABLE donations ADD COLUMN IF NOT EXISTS receipt_no text UNIQUE;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;            -- test provider: no real money
ALTER TABLE donations ADD COLUMN IF NOT EXISTS gateway jsonb NOT NULL DEFAULT '{}'::jsonb;        -- channel, paid_at, gateway fees (never card data)
CREATE INDEX IF NOT EXISTS donations_settlement ON donations (settlement_status, created_at DESC);
CREATE INDEX IF NOT EXISTS donations_beneficiary ON donations (beneficiary_id, created_at DESC);
CREATE INDEX IF NOT EXISTS donations_donor ON donations (donor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS donations_payout ON donations (payout_id) WHERE payout_id IS NOT NULL;

-- Status history (who / when / why) for donations and payouts. Append-only by convention.
CREATE TABLE IF NOT EXISTS fundme_donation_events (
  id           bigserial PRIMARY KEY,
  donation_id  uuid NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  actor        text NOT NULL DEFAULT 'system' CHECK (actor IN ('system','admin','paystack','test','donor')),
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  reason       text CHECK (reason IS NULL OR char_length(reason) <= 500),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fundme_donation_events_d ON fundme_donation_events (donation_id, id);
CREATE TABLE IF NOT EXISTS fundme_payout_events (
  id           bigserial PRIMARY KEY,
  payout_id    uuid NOT NULL REFERENCES fundme_payouts(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  actor        text NOT NULL DEFAULT 'system' CHECK (actor IN ('system','admin','paystack')),
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  reason       text CHECK (reason IS NULL OR char_length(reason) <= 500),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fundme_payout_events_p ON fundme_payout_events (payout_id, id);
CREATE INDEX IF NOT EXISTS fundme_payouts_beneficiary ON fundme_payouts (beneficiary_id, created_at DESC);

-- Beneficiary bank account for payouts. The account number is AES-GCM encrypted (FUNDME_DATA_KEY); apps and admin lists
-- only see the last 4 digits. Any change goes back to pending_review and puts unpaid payouts under review.
CREATE TABLE IF NOT EXISTS fundme_bank_accounts (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bank_code            text NOT NULL CHECK (char_length(bank_code) BETWEEN 2 AND 20),
  bank_name            text NOT NULL CHECK (char_length(bank_name) BETWEEN 2 AND 120),
  account_number_enc   text NOT NULL,
  account_last4        text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  account_name         text NOT NULL CHECK (char_length(account_name) BETWEEN 2 AND 120),
  name_resolved        boolean NOT NULL DEFAULT false,         -- name confirmed by Paystack resolve-account
  status               text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','verified','rejected')),
  review_note          text,
  reviewed_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  recipient_code       text,                                   -- Paystack transfer recipient (auto payouts only)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fundme_bank_accounts_status ON fundme_bank_accounts (status, updated_at);

-- ===== VIRTUAL GIFTS & STARS (monetisation stage: client spec §8–§12, §15 C/D/F, §16 gift items) =====
-- Owner: Virtual Gifts agent. Contract: scratch/monetisation/gifts.md. Money moves ONLY through lib/wallet.js postGift()
-- (sender gift_coins −value · platform commission_gift_coins +commission · recipient gift_earnings +rest, one atomic op).
-- The rows below are business records written in the SAME transaction (post({ alsoRun })).
-- Legacy Kingdom Coin gifts (gift_transactions, POST /gifts, POST /conversations/:id/coins) are untouched and separate.

-- Gift catalogue (spec §9). price_minor = the client's proposed retail price (kobo). coins = admin-set Gifting Coin
-- cost; NULL = derived from wallet_config.gift_coin_rate (never hard-code ₦1 = 1 coin).
CREATE TABLE IF NOT EXISTS gift_catalogue (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description    text CHECK (description IS NULL OR char_length(description) <= 200),
  price_minor    bigint NOT NULL CHECK (price_minor >= 0),
  currency       text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  coins          integer CHECK (coins IS NULL OR coins > 0),
  tier           text NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard','premium')),
  art            text NOT NULL DEFAULT 'star',            -- built-in animated artwork key (src/components/gifts/GiftArt.js)
  image_key      text,                                    -- admin-uploaded replacement image (R2 img/gifts/...)
  animation_key  text,                                    -- admin-uploaded animated GIF / WebP (R2 img/gifts/...)
  contexts       text[] NOT NULL DEFAULT ARRAY['chat','profile','live','post']::text[]
                 CHECK (contexts <@ ARRAY['chat','profile','live','post']::text[]),
  active         boolean NOT NULL DEFAULT true,
  sort           integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gift_catalogue (id, name, description, price_minor, tier, art, sort) VALUES
  ('star',        '1 Star',                 'A bright star of thanks',                    20000,    'standard', 'star',        1),
  ('flowers',     'Flowers',                'A bouquet to brighten their day',            50000,    'standard', 'flowers',     2),
  ('heart',       'Heart',                  'Love and encouragement',                     100000,   'standard', 'heart',       3),
  ('teddy',       'Teddy Bear',             'A warm, cuddly hug',                         150000,   'standard', 'teddy',       4),
  ('love_letter', 'Love Letter',            'Words from the heart',                       250000,   'standard', 'letter',      5),
  ('diamonds',    'Diamonds',               'Precious and rare',                          500000,   'premium',  'diamond',     6),
  ('crown',       'Crown',                  'Honour a faithful servant',                  1000000,  'premium',  'crown',       7),
  ('gold_trophy', 'Gold Trophy',            'For a race well run',                        2000000,  'premium',  'trophy',      8),
  ('celebration', 'Celebration Gift',       'Fireworks and joy',                          4000000,  'premium',  'celebration', 9),
  ('premium',     'Premium Animated Gift',  'Our grandest gift, with a full-screen show', 10000000, 'premium',  'premium',     10)
ON CONFLICT (id) DO NOTHING;

-- Every virtual gift sent (one row per wallet op 'gift:<id>'). commission + earnings = coins, always.
CREATE TABLE IF NOT EXISTS gift_sends (
  id              uuid PRIMARY KEY,                       -- derived from (sender, client idempotency key)
  ref             text NOT NULL UNIQUE,                   -- wallet_ops.ref ('gift:<id>')
  sender_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  gift_id         text NOT NULL REFERENCES gift_catalogue(id),
  gift_name       text NOT NULL,                          -- snapshot at send time
  coins           integer NOT NULL CHECK (coins > 0),
  commission      integer NOT NULL CHECK (commission >= 0),
  earnings        integer NOT NULL CHECK (earnings >= 0),
  commission_bps  integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  context_type    text NOT NULL CHECK (context_type IN ('chat','profile','live','post')),
  context_id      text,
  message_id      uuid,                                   -- the chat 'gift' message (chat context)
  note            text CHECK (note IS NULL OR char_length(note) <= 140),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (commission + earnings = coins),
  CHECK (sender_id IS NULL OR recipient_id IS NULL OR sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS gift_sends_recipient ON gift_sends (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_sends_sender ON gift_sends (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_sends_context ON gift_sends (context_type, context_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_sends_created ON gift_sends (created_at DESC);

-- Creator payout programme (spec §11): only approved members may withdraw gift earnings.
CREATE TABLE IF NOT EXISTS gift_creator_programme (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  legal_name      text NOT NULL CHECK (char_length(legal_name) BETWEEN 2 AND 120),
  country         text NOT NULL DEFAULT 'NG',
  bank_name       text NOT NULL CHECK (char_length(bank_name) BETWEEN 2 AND 80),
  account_name    text NOT NULL CHECK (char_length(account_name) BETWEEN 2 AND 120),
  account_number  text NOT NULL CHECK (account_number ~ '^[0-9]{6,20}$'),
  about           text CHECK (about IS NULL OR char_length(about) <= 600),
  admin_note      text,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  decided_by      uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS gift_creator_programme_status ON gift_creator_programme (status, applied_at);

-- Withdrawal requests (behind wallet_config.earnings_withdrawals_enabled, default off). No automatic cash-out:
-- an admin approves, pays by hand and marks it paid with the payment reference.
CREATE TABLE IF NOT EXISTS gift_withdrawals (
  id              uuid PRIMARY KEY,                       -- derived from (user, client idempotency key)
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  coins           integer NOT NULL CHECK (coins > 0),
  payout_minor    bigint NOT NULL CHECK (payout_minor >= 0),
  currency        text NOT NULL,
  status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','paid','rejected')),
  payout_details  jsonb NOT NULL DEFAULT '{}'::jsonb,     -- snapshot of the programme bank details
  reference       text,                                   -- bank / transfer reference when paid
  admin_note      text,
  decided_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_withdrawals_status ON gift_withdrawals (status, created_at);
CREATE INDEX IF NOT EXISTS gift_withdrawals_user ON gift_withdrawals (user_id, created_at DESC);

-- Live sessions (minimal: the host and whether it is live), so a live gift can be checked server-side.
CREATE TABLE IF NOT EXISTS live_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  status      text NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_one_live ON live_sessions (host_id) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS live_sessions_status ON live_sessions (status, started_at DESC);

-- Chat gift bubbles: messages.kind 'gift'. Keeps EVERY earlier kind (text, image, voice, verse, prayer, event, video,
-- file, system). Another stage adding a kind must DROP/ADD with this full list plus its own.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text','image','voice','verse','prayer','event','video','file','system','gift'));
-- ===== END VIRTUAL GIFTS & STARS =====

-- ===== PAYSTACK FOR EVERY PURCHASE (2026-11-21) =====
-- Coins / credits / gifting packs, Dating Plus / VIP, Memberships and BibleNestra Plus are paid through Paystack's
-- hosted checkout (card, bank transfer, USSD). Google Play stays dormant. lib/paystackCheckout.js is the ONE place a
-- Paystack payment becomes a purchase, a membership or Plus.
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_email text CHECK (billing_email IS NULL OR char_length(billing_email) <= 200);

-- One row per Paystack charge we start (first payment or a card renewal). reference = Paystack reference (unique).
CREATE TABLE IF NOT EXISTS paystack_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       text NOT NULL UNIQUE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('wallet','membership','plus')),
  purpose         text NOT NULL DEFAULT 'purchase' CHECK (purpose IN ('purchase','renewal')),
  target_id       text NOT NULL,                       -- wallet_purchases.id / memberships.id / plus_plans.id
  subscription_id uuid,                                -- renewal: the subscription row being renewed
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        text NOT NULL,
  email           text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','success','failed','abandoned','refunded','review')),
  test            boolean NOT NULL DEFAULT false,      -- Paystack test keys: never real money
  channel         text,                                -- card / bank / ussd / bank_transfer
  gateway         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { gatewayId, paidAt, gatewayFeesMinor }
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- membership checkout answers / contact / promo, plan ids
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paystack_payments_user ON paystack_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS paystack_payments_status ON paystack_payments (status, created_at DESC);

-- Reusable card authorisations Paystack returns after a card payment (a token, never card numbers). Used for renewals.
CREATE TABLE IF NOT EXISTS paystack_authorizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authorization_code text NOT NULL,
  signature          text NOT NULL,
  email              text NOT NULL,
  card_type          text,
  last4              text,
  bank               text,
  exp_month          text,
  exp_year           text,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, signature)
);

ALTER TABLE wallet_purchases DROP CONSTRAINT IF EXISTS wallet_purchases_provider_check;
ALTER TABLE wallet_purchases ADD CONSTRAINT wallet_purchases_provider_check CHECK (provider IN ('play','apple','test','paystack'));
ALTER TABLE dating_subscriptions DROP CONSTRAINT IF EXISTS dating_subscriptions_provider_check;
ALTER TABLE dating_subscriptions ADD CONSTRAINT dating_subscriptions_provider_check CHECK (provider IN ('play','apple','test','admin','paystack'));
ALTER TABLE membership_subscriptions DROP CONSTRAINT IF EXISTS membership_subscriptions_source_check;
ALTER TABLE membership_subscriptions ADD CONSTRAINT membership_subscriptions_source_check CHECK (source IN ('play','admin_grant','test','paystack'));

-- Renewal state (card: auto-renew with the saved authorisation; bank transfer / USSD: a reminder before the end).
ALTER TABLE dating_subscriptions ADD COLUMN IF NOT EXISTS paystack_auth_id uuid REFERENCES paystack_authorizations(id) ON DELETE SET NULL;
ALTER TABLE dating_subscriptions ADD COLUMN IF NOT EXISTS renewal_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE dating_subscriptions ADD COLUMN IF NOT EXISTS last_renewal_at timestamptz;
ALTER TABLE dating_subscriptions ADD COLUMN IF NOT EXISTS reminded_for timestamptz;
ALTER TABLE membership_subscriptions ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false;
ALTER TABLE membership_subscriptions ADD COLUMN IF NOT EXISTS paystack_auth_id uuid REFERENCES paystack_authorizations(id) ON DELETE SET NULL;
ALTER TABLE membership_subscriptions ADD COLUMN IF NOT EXISTS renewal_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE membership_subscriptions ADD COLUMN IF NOT EXISTS last_renewal_at timestamptz;
ALTER TABLE membership_subscriptions ADD COLUMN IF NOT EXISTS reminded_for timestamptz;

-- BibleNestra Plus: admin-editable plans + subscriptions. Live Plus sets users.premium / premium_until.
CREATE TABLE IF NOT EXISTS plus_plans (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,40}$'),
  label       text NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  currency    text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  interval    text NOT NULL CHECK (interval IN ('week','month','year')),
  note        text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- PROPOSED Naira prices (client to confirm; editable in Admin > Wallets & payments > Paystack).
INSERT INTO plus_plans (id, label, price_minor, currency, interval, note, sort_order) VALUES
  ('yearly', 'Yearly', 2500000, 'NGN', 'year', NULL, 0),
  ('weekly', 'Weekly', 150000, 'NGN', 'week', 'Billed every week', 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS plus_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id              text NOT NULL REFERENCES plus_plans(id),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due','expired','refunded')),
  provider             text NOT NULL CHECK (provider IN ('paystack','test','admin')),
  auto_renew           boolean NOT NULL DEFAULT false,
  test                 boolean NOT NULL DEFAULT false,
  paystack_auth_id     uuid REFERENCES paystack_authorizations(id) ON DELETE SET NULL,
  amount_minor         bigint,
  currency             text,
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  renewal_attempts     integer NOT NULL DEFAULT 0,
  last_renewal_at      timestamptz,
  reminded_for         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS plus_subs_live ON plus_subscriptions (user_id) WHERE status IN ('active','cancelled','past_due');
CREATE INDEX IF NOT EXISTS plus_subs_due ON plus_subscriptions (current_period_end) WHERE status IN ('active','cancelled','past_due');
-- ===== END PAYSTACK FOR EVERY PURCHASE =====

-- ---------- PAYSTACK RETRY GUARD ----------
-- Every Paystack reference that has extended a subscription, written in the same statement as the extension. A retried
-- grant (applied, but the payment's "done" mark never landed) sees its reference here and adds nothing.
-- Wallet purchases need nothing extra: each payment has its own wallet_purchases row (status 'verified' = applied).
ALTER TABLE plus_subscriptions ADD COLUMN IF NOT EXISTS applied_payment_refs text[] NOT NULL DEFAULT '{}';
ALTER TABLE membership_subscriptions ADD COLUMN IF NOT EXISTS applied_payment_refs text[] NOT NULL DEFAULT '{}';

-- ---------- FIND LOVE: CLIENT ANSWERS (AI photo check, auto-hide, verification, retention) ----------
-- Client answers Q25, Q26, Q32 (scratch/monetisation/client-answers.md). Logic: src/lib/dating.js, src/lib/datingAi.js.
-- AI photo check (dating_rules.photoReview = 'ai', the default): the Workers AI verdict on each new dating photo.
-- clean → approved at once · flagged → stays pending + ai_flagged (admin queue, with ai_reason) · error → pending (human).
-- An ai_flagged photo is never shown while pending, whatever the review mode.
ALTER TABLE dating_photos ADD COLUMN IF NOT EXISTS ai_verdict text;
ALTER TABLE dating_photos ADD COLUMN IF NOT EXISTS ai_flagged boolean NOT NULL DEFAULT false;
ALTER TABLE dating_photos ADD COLUMN IF NOT EXISTS ai_reason text;
ALTER TABLE dating_photos ADD COLUMN IF NOT EXISTS ai_labels jsonb;
ALTER TABLE dating_photos ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE dating_photos ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz;
ALTER TABLE dating_photos DROP CONSTRAINT IF EXISTS dating_photos_ai_verdict_check;
ALTER TABLE dating_photos ADD CONSTRAINT dating_photos_ai_verdict_check CHECK (ai_verdict IS NULL OR ai_verdict IN ('clean','flagged','error'));
CREATE INDEX IF NOT EXISTS dating_photos_ai_queue ON dating_photos (created_at) WHERE ai_flagged AND status = 'pending';
-- Auto-hide after reports from dating_rules.autoHideReports distinct reporters (default 5). Hidden from discovery and
-- new contact until an admin restores it. Restoring sets reports_cleared_at: older reports no longer count.
ALTER TABLE dating_profiles ADD COLUMN IF NOT EXISTS report_hold_at timestamptz;
ALTER TABLE dating_profiles ADD COLUMN IF NOT EXISTS reports_cleared_at timestamptz;
CREATE INDEX IF NOT EXISTS dating_profiles_report_hold ON dating_profiles (report_hold_at) WHERE report_hold_at IS NOT NULL;
-- Retention: messages of closed / declined dating chats are deleted dating_rules.chatRetentionDays (default 730) after
-- closed_at, by the 15-minute cron in small batches. The dating_conversations row, dating_reports and admin_actions stay.
ALTER TABLE dating_conversations ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE dating_conversations ADD COLUMN IF NOT EXISTS messages_purged_at timestamptz;
UPDATE dating_conversations SET closed_at = updated_at WHERE closed_at IS NULL AND status IN ('closed','declined');
CREATE INDEX IF NOT EXISTS dating_conversations_retention ON dating_conversations (closed_at) WHERE messages_purged_at IS NULL AND status IN ('closed','declined');
-- Verified badge = live selfie (with a code + gesture shown on screen) + a government ID photo, an advisory AI
-- pre-check, then an admin decision. The two images are private R2 objects under kyc/<user>/<verification>/ (never
-- served from /media); only the member and admins can read them, and both are deleted when the admin decides (or when
-- an unfinished draft expires). After the decision only the outcome is kept (ai_details is cleared).
CREATE TABLE IF NOT EXISTS dating_verifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','expired')),
  code             text NOT NULL CHECK (char_length(code) BETWEEN 3 AND 12),
  gesture          text NOT NULL CHECK (char_length(gesture) <= 40),
  selfie_key       text CHECK (char_length(selfie_key) <= 300),
  id_key           text CHECK (char_length(id_key) <= 300),
  id_type          text CHECK (id_type IS NULL OR id_type IN ('nin','passport','drivers_licence','voters_card','other')),
  ai_status        text CHECK (ai_status IS NULL OR ai_status IN ('done','unavailable')),
  ai_confidence    text CHECK (ai_confidence IS NULL OR ai_confidence IN ('high','medium','low','unknown')),
  ai_note          text CHECK (char_length(ai_note) <= 2000),
  ai_details       jsonb,
  expires_at       timestamptz NOT NULL,
  submitted_at     timestamptz,
  decided_at       timestamptz,
  decided_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  reject_reason    text CHECK (char_length(reject_reason) <= 300),
  files_deleted_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dating_verifications_open ON dating_verifications (user_id) WHERE status IN ('draft','pending');
CREATE INDEX IF NOT EXISTS dating_verifications_queue ON dating_verifications (status, submitted_at);
-- ---------- END FIND LOVE: CLIENT ANSWERS ----------

-- ---------- FUND ME: CLIENT ANSWERS (fees, currency, KYC, monthly payouts) ----------
-- Client answers 2026-11-21 (scratch/monetisation/client-answers.md W3, W4, W5, W6). Code: lib/fundmeMoney.js, lib/kyc.js.
-- Donations: the donor gives in any currency; BibleNestra charges Paystack in that currency when it is listed in
-- PAYSTACK_CURRENCIES, otherwise in NGN at the admin rate table. The beneficiary's money (donations.amount_minor /
-- fee_minor / net_minor / currency, and the ledger) is always NGN for these donations.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS original_currency text CHECK (original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'); -- what the donor chose
ALTER TABLE donations ADD COLUMN IF NOT EXISTS original_amount_minor bigint CHECK (original_amount_minor IS NULL OR original_amount_minor > 0);
ALTER TABLE donations ADD COLUMN IF NOT EXISTS fx_rate numeric(18,6) CHECK (fx_rate IS NULL OR fx_rate > 0);              -- NGN per 1 unit of original_currency (1 for NGN)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS charge_currency text CHECK (charge_currency IS NULL OR charge_currency ~ '^[A-Z]{3}$');   -- what Paystack charged
ALTER TABLE donations ADD COLUMN IF NOT EXISTS charge_amount_minor bigint CHECK (charge_amount_minor IS NULL OR charge_amount_minor > 0);
ALTER TABLE donations ADD COLUMN IF NOT EXISTS charge_fx_rate numeric(18,6) CHECK (charge_fx_rate IS NULL OR charge_fx_rate > 0); -- NGN per 1 unit of charge_currency
ALTER TABLE donations ADD COLUMN IF NOT EXISTS cover_fees boolean NOT NULL DEFAULT false;          -- donor ticked "Cover the fees"
ALTER TABLE donations ADD COLUMN IF NOT EXISTS gift_ngn_minor bigint CHECK (gift_ngn_minor IS NULL OR gift_ngn_minor >= 0);     -- the gift, in NGN, before fees
ALTER TABLE donations ADD COLUMN IF NOT EXISTS processing_fee_minor bigint NOT NULL DEFAULT 0 CHECK (processing_fee_minor >= 0); -- Paystack fee estimate (NGN)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS vat_minor bigint NOT NULL DEFAULT 0 CHECK (vat_minor >= 0);                       -- VAT on the fees (NGN)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS total_ngn_minor bigint CHECK (total_ngn_minor IS NULL OR total_ngn_minor > 0);    -- what the donor paid, in NGN
ALTER TABLE donations ADD COLUMN IF NOT EXISTS raised_credit_minor bigint CHECK (raised_credit_minor IS NULL OR raised_credit_minor >= 0); -- added to fundraisers.raised_minor (request currency)

-- Payout KYC (Fund Me beneficiaries AND gift-earnings withdrawals). ID and account numbers are AES-GCM encrypted
-- (FUNDME_DATA_KEY, same key as fundme_bank_accounts). A payout / withdrawal is approved only when status = 'approved'.
CREATE TABLE IF NOT EXISTS payout_kyc (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id_type              text NOT NULL CHECK (id_type IN ('bvn','nin','national_id')),
  id_country           text NOT NULL DEFAULT 'NG' CHECK (id_country ~ '^[A-Z]{2}$'),
  id_number_enc        text NOT NULL,
  id_last4             text NOT NULL CHECK (char_length(id_last4) BETWEEN 1 AND 4),
  legal_name           text NOT NULL CHECK (char_length(legal_name) BETWEEN 3 AND 120),
  bank_code            text NOT NULL CHECK (char_length(bank_code) BETWEEN 2 AND 20),
  bank_name            text NOT NULL CHECK (char_length(bank_name) BETWEEN 2 AND 120),
  account_number_enc   text NOT NULL,
  account_last4        text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  account_name         text NOT NULL CHECK (char_length(account_name) BETWEEN 2 AND 120), -- the bank's name for the account
  name_resolved        boolean NOT NULL DEFAULT false,         -- account_name came from Paystack resolve-account
  name_match           boolean NOT NULL DEFAULT false,         -- legal_name fuzzy-matches account_name
  status               text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected')),
  review_note          text,
  reviewed_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  submitted_at         timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payout_kyc_status ON payout_kyc (status, updated_at);

-- Monthly payout runs (fundme_payout_schedule = 'monthly'). The 15-minute cron claims a run date once, then approves
-- the verified donations whose hold has passed. Staff still pay each beneficiary by hand and enter the reference.
CREATE TABLE IF NOT EXISTS fundme_payout_runs (
  run_date     date PRIMARY KEY,
  approved     integer NOT NULL DEFAULT 0,
  total_minor  bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- STAFF ACCESS (dashboard invites and roles) ----------
-- People the owner invites to the admin dashboard with a role (owner / finance / moderator / content / viewer, or
-- custom ticked permissions per area — see src/lib/staff.js). Passwords: PBKDF2-SHA256 with a per-user salt, never
-- plain text. Invite links are one-time: only the SHA-256 of the token is stored. session_version is in every staff
-- token; bumping it signs the account out everywhere. admin_actions.staff_id says which staff member did what.
CREATE TABLE IF NOT EXISTS staff_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  email_note        text,
  username          text UNIQUE CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  password_hash     text,
  role              text NOT NULL CHECK (role IN ('owner','finance','moderator','content','viewer','custom')),
  permissions       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  session_version   integer NOT NULL DEFAULT 1,
  failed_logins     integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  access_expires_at timestamptz,
  last_login_at     timestamptz,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_invites_staff ON staff_invites (staff_id, created_at DESC);
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES staff_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS admin_actions_staff ON admin_actions (staff_id, created_at DESC) WHERE staff_id IS NOT NULL;

-- ---------- GIFTS: CLIENT ANSWERS ----------
-- Support BibleNestra (client answer C4): a gift to the official BibleNestra account is recorded with context_type
-- 'support' (ledger ref 'support:<id>', 100% platform commission, no earnings). Re-adding the check with every earlier
-- value keeps re-runs of this file safe. The new settings (earnings_hold_days 14, earnings_min_withdrawal_usd 10,
-- usd_ngn_rate 1500, gift_admins_can_receive on) are code defaults in wallet_config, so no rows are written here.
ALTER TABLE gift_sends DROP CONSTRAINT IF EXISTS gift_sends_context_type_check;
ALTER TABLE gift_sends ADD CONSTRAINT gift_sends_context_type_check CHECK (context_type IN ('chat','profile','live','post','support'));

-- ---------- LIVE FX + DOJAH IDENTITY ----------
-- Live exchange rates (lib/fxLive.js): the 15-minute cron refreshes wallet_config.fundme_fx_ngn_per_unit from
-- open.er-api.com at most every 6 hours while fundme_fx_auto is on. One status row: when the table last changed and
-- from where ('exchangerate-api' or 'manual'), the provider's own timestamps, the end-of-life notice (time_eol_unix),
-- the last attempt / error, and the currencies the 25% guard refused (flagged: [{currency, stored, fetched, changePct}]).
CREATE TABLE IF NOT EXISTS fx_rate_status (
  id                      text PRIMARY KEY CHECK (id = 'fundme'),
  source                  text CHECK (source IS NULL OR source IN ('exchangerate-api','manual')),
  rates_updated_at        timestamptz,
  provider_updated_at     timestamptz,
  provider_next_update_at timestamptz,
  provider_eol_at         timestamptz,
  last_attempt_at         timestamptz,
  last_success_at         timestamptz,
  last_error              text CHECK (char_length(last_error) <= 300),
  flagged                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
-- Payout KYC: optional Dojah BVN / NIN lookup (lib/dojah.js). Only the outcome is kept: never the returned photo or
-- record. id_check_status: 'matched' (the ID's name matches the legal name AND the bank account name) or 'not_checked'
-- (Dojah not set up, national_id, or the check failed; staff review by hand). Rows from before this block: not_checked.
ALTER TABLE payout_kyc ADD COLUMN IF NOT EXISTS id_verified       boolean NOT NULL DEFAULT false;
ALTER TABLE payout_kyc ADD COLUMN IF NOT EXISTS id_check_provider text CHECK (id_check_provider IS NULL OR id_check_provider IN ('dojah'));
ALTER TABLE payout_kyc ADD COLUMN IF NOT EXISTS id_check_status   text NOT NULL DEFAULT 'not_checked' CHECK (id_check_status IN ('matched','not_checked'));
ALTER TABLE payout_kyc ADD COLUMN IF NOT EXISTS id_check_note     text CHECK (char_length(id_check_note) <= 300);
ALTER TABLE payout_kyc ADD COLUMN IF NOT EXISTS id_checked_at     timestamptz;
-- Find Love Verified badge: optional BVN / NIN selfie match by Dojah. Only the ID type, the last 4 digits, the
-- confidence and the match are kept (never the number, the returned photo or the record). dojah_quick = Dojah matched
-- and the advisory AI check wasn't negative: shown as "Dojah matched" for a quick admin decision (never auto-approved).
ALTER TABLE dating_verifications ADD COLUMN IF NOT EXISTS dojah_id_type    text CHECK (dojah_id_type IS NULL OR dojah_id_type IN ('bvn','nin'));
ALTER TABLE dating_verifications ADD COLUMN IF NOT EXISTS dojah_id_last4   text CHECK (dojah_id_last4 IS NULL OR dojah_id_last4 ~ '^[0-9]{4}$');
ALTER TABLE dating_verifications ADD COLUMN IF NOT EXISTS dojah_status     text CHECK (dojah_status IS NULL OR dojah_status IN ('matched','no_match','error'));
ALTER TABLE dating_verifications ADD COLUMN IF NOT EXISTS dojah_confidence numeric;
ALTER TABLE dating_verifications ADD COLUMN IF NOT EXISTS dojah_match      boolean;
ALTER TABLE dating_verifications ADD COLUMN IF NOT EXISTS dojah_note       text CHECK (char_length(dojah_note) <= 300);
ALTER TABLE dating_verifications ADD COLUMN IF NOT EXISTS dojah_quick      boolean NOT NULL DEFAULT false;
