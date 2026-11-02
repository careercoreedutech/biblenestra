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

