// BibleNestra API — Cloudflare Worker entry point. See API.md for the contract.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApiError } from './lib/http.js';
import { requireUser } from './lib/auth.js';
import { one } from './lib/db.js';
import { createTicket, verifyTicket } from './lib/ticket.js';
import { Hub } from './hub.js';

// Phase 1 routes
import me from './routes/me.js';
import posts from './routes/posts.js';
import prayers from './routes/prayers.js';
import jobs from './routes/jobs.js';
import { uploads, media, chatMedia } from './routes/media.js';
import { rewards, ssv } from './routes/rewards.js';

// Phase 2 routes
import conversations from './routes/conversations.js';
import messages from './routes/messages.js'; // ROUND 4: message actions
import chatGroups, { chatPublic } from './routes/chatGroups.js'; // CHAT 7.3/7.4: Group Info, roles, invites, media, files, typing, presence, search
import communities from './routes/communities.js';
import events from './routes/events.js';
import wishes from './routes/wishes.js';
import study from './routes/study.js';
import gifts from './routes/gifts.js';
import notifications from './routes/notifications.js';
import rhythm from './routes/rhythm.js';
import social from './routes/social.js'; // SOCIAL (round 3)
import { fundme, fundmePublic } from './routes/fundme.js'; // FUND ME (round 3)
import { fundmeMoney } from './routes/fundmeMoney.js'; // FUND ME MONEY: credits, gifting credits, donations held by BibleNestra, payouts, admin "Donations & payouts"
import recordings from './routes/recordings.js'; // DISCOVER TOOLS (round 3)
import reminders from './routes/reminders.js'; // DISCOVER TOOLS (round 3)
import youtube from './routes/youtube.js'; // DISCOVER TOOLS (round 3)
import { adminPage, adminApi } from './routes/admin.js'; // DISCOVER TOOLS (round 3)
import { adminPlus, announcementsPublic } from './routes/adminPlus.js'; // ROUND 5: admin dashboard sections
import { contests, adminContests, contestPublic } from './routes/contests.js'; // CONTESTS
import { opportunities, adminOpportunities } from './routes/opportunities.js'; // OPPORTUNITIES (imported listings)
import { websites, adminWebsites } from './routes/websites.js'; // MEMBER WEBSITES (open inside the app)
import { extraBooks } from './routes/extraBooks.js'; // BEYOND THE 66: deuterocanonical & extra-biblical texts
import { battles } from './routes/battles.js'; // CONTEST CENTRE: live Bible battles
import { youtubePublic, youtubeComments, adminYouTubeLive } from './routes/youtubeLive.js'; // YOUTUBE LIVE: live alerts + comments per video
import { adsPublic, ads, adminAds } from './routes/ads.js'; // ADS: remote ad rules, ad events, admin Ads tab
import { library, libraryPublic, adminLibrary } from './routes/library.js'; // MEDIA LIBRARY: audio library, Christian books (PDF), personal & group uploads
import { dailyPublic, adminDaily } from './routes/daily.js'; // TODAY'S JOURNEY: Daily Bread, blessing videos, Watch on Today (latest channel videos)
import exegesis from './routes/exegesis.js'; // EXEGESIS: POST /study/exegesis (one-tap AI exegesis, cached)
import { care, adminCare } from './routes/care.js'; // CARE NETWORK: Talk to a Priest (verified directory) + Talk to an Apostle
import { broadcastsApp, adminBroadcasts } from './routes/broadcasts.js'; // BROADCASTS: admin broadcasts to all inboxes / to Socials
import { referrals, referralsPublic, adminReferrals } from './routes/referrals.js'; // CHAT LIMITS: invite links, free-chat counter, paywall frequency guard
import { learnApp, adminLearn } from './routes/learn.js'; // LEARN CMS: courses + devotionals (excerpt in app, full post on the blog)
import companion from './routes/companion.js'; // SCRIPTURE COMPANION: /companion/safety, /companion/verses, /companion/compose (signed in)
import { adminCompanion } from './routes/companion.js'; // COMPANION MEANING SEARCH: /admin/api/companion/vectors (admin only)
import { companionVectorsCron } from './lib/companionSemantic.js'; // COMPANION MEANING SEARCH: cron builds missing verse vectors
import { commentariesPublic } from './routes/commentaries.js'; // COMMENTARIES: GET /study/commentaries, /study/commentary/:id/:book/:chapter (public, cached)
import { chatGaps, chatGapsPublic } from './routes/chatGaps.js'; // CHAT GAPS: /g/:code group-invite landing page, group bans
import { runContestCron } from './lib/contestCron.js';
import { blogPublic, adminBlog } from './routes/blog.js'; // BLOG: public /blog pages + JSON, admin Blog tab with AI auto-posting
import { runBlogCron } from './lib/blog.js'; // BLOG: cron publishes scheduled posts and runs AI schedules
import { legalPublic, accountDeletion, adminAccountDeletions } from './routes/legal.js'; // LEGAL: /terms, /privacy, /delete-account + account deletion
import { membershipsApp, membershipChatGuard, membershipLazyExpiry } from './routes/memberships.js'; // MEMBERSHIPS & PAID CHANNELS (brief 8)
import { runMembershipCron } from './lib/memberships.js'; // MEMBERSHIPS: expiry sweep (lapsed members leave Channel + Community)
import { walletApp, adminWallet } from './routes/wallet.js'; // WALLET CORE: separate wallets, ledger, packages, purchases, Dating Plus / VIP
import { runWalletCron } from './lib/walletStore.js'; // WALLET CORE: expire ended dating subscriptions, prune rate-limit windows
import { datingApp, adminDating } from './routes/dating.js'; // FIND LOVE (Christian dating): profiles, discovery, matches, Dating Coin uses, ad unlocks, boosts, admin "Dating"
import { giftsApp, adminGifts } from './routes/virtualGifts.js'; // VIRTUAL GIFTS & STARS: catalogue, send (20/80 split), histories, earnings, withdrawals, live sessions, admin "Gift catalogue"

export function createApp() {
  const app = new Hono();

  app.use('*', cors({
    origin: (o, c) => {
      const allowed = (c.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
      return allowed.includes('*') || allowed.includes(o) ? o || '*' : null;
    },
    allowHeaders: ['Authorization', 'Content-Type', 'X-Dev-User', 'X-TZ-Offset', 'X-Conversation-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }));

  app.onError((err, c) => {
    if (err instanceof ApiError && err.details) return c.json({ error: err.message, code: err.code, ...err.details }, err.status); // CHAT LIMITS: e.g. CHAT_LIMIT_REACHED { used, limit }
    if (err instanceof ApiError) return c.json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong on our side', code: 'INTERNAL' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

  // public endpoints
  app.get('/', (c) => c.redirect('/admin'));
  app.get('/health', async (c) => {
    let db = false;
    try { db = !!(await one(c.env, 'SELECT 1 AS ok')); } catch (e) { db = false; }
    return c.json({ ok: true, db });
  });

  // Public WebSocket entry point (ticket authenticated)
  app.get('/realtime', async (c) => {
    const ticket = c.req.query('ticket');
    const secret = c.env.REALTIME_SECRET || 'biblenestra-realtime-fallback-secret';
    const check = await verifyTicket(secret, ticket);
    if (!check.valid) {
      return c.json({ error: 'Invalid or expired ticket', code: 'UNAUTHORIZED' }, 401);
    }

    if (!c.env.HUB) {
      return c.json({ error: 'Realtime Durable Objects not configured in this environment', code: 'NOT_IMPLEMENTED' }, 501);
    }

    const id = c.env.HUB.idFromName(`user:${check.userId}`);
    const stub = c.env.HUB.get(id);
    return stub.fetch(c.req.raw);
  });

  app.route('/', media);
  app.route('/', ssv);
  app.route('/', fundmePublic); // FUND ME (round 3): public page, donations (guests too), test checkout, webhooks
  app.route('/', youtube); // DISCOVER TOOLS (round 3): public channel list + RSS videos
  app.route('/', youtubePublic); // YOUTUBE LIVE: GET /youtube/live, GET /youtube/videos/:videoId
  app.route('/', adminPage); // DISCOVER TOOLS (round 3): GET /admin dashboard page (its /admin/api/* calls need an admin)
  app.route('/', contestPublic); // CONTEST CENTRE: public certificate verification
  app.route('/', extraBooks); // BEYOND THE 66: public book texts (cached)
  app.route('/', adsPublic); // ADS: GET /ads/config (public, cached)
  app.route('/', libraryPublic); // MEDIA LIBRARY: GET /library/file/* (Range streaming, signed links) + /library/viewer (pdf.js)
  app.route('/', chatPublic); // CHAT 7.4: signed chat-file links (+ pdf.js viewer) for in-app viewing and downloads
  app.route('/', dailyPublic); // TODAY'S JOURNEY: GET /daily/today, /daily/videos, /youtube/latest (public, cached)
  app.route('/', commentariesPublic); // COMMENTARIES: library + cached chapters (public)
  app.route('/', referralsPublic); // CHAT LIMITS: GET /i/:code invite landing page, GET /invite/:code preview
  app.route('/', chatGapsPublic); // CHAT GAPS: GET /g/:code (and /join/:code) group-invite landing page
  app.route('/', blogPublic); // BLOG: GET /blog, /blog/:slug, /blog/api/posts[/:slug] (public, published posts only)
  app.route('/', legalPublic); // LEGAL: GET /terms, /privacy, /delete-account (public HTML)

  // everything below needs a signed-in user
  app.use('*', requireUser());

  // WebSocket Ticket creation
  app.post('/realtime/ticket', async (c) => {
    const user = c.get('user');
    const secret = c.env.REALTIME_SECRET || 'biblenestra-realtime-fallback-secret';
    const ticket = await createTicket(secret, user.id, 60);
    return c.json({ ticket, expiresIn: 60 });
  });

  // Phase 1 routes
  app.route('/', me);
  app.route('/', posts);
  app.route('/', uploads);
  app.route('/', prayers);
  app.route('/', jobs);
  app.route('/', rewards);

  // Phase 2 routes
  // MEMBERSHIPS (brief 8.1 / 8.6): a membership's Channel + Community need an active subscription on EVERY chat request.
  // Registered before the chat routes; conversations without membership_id pass straight through.
  app.use('/conversations', membershipLazyExpiry);
  app.use('/conversations/:id', membershipChatGuard);
  app.use('/conversations/:id/*', membershipChatGuard);
  app.use('/messages/:id', membershipChatGuard);
  app.use('/messages/:id/*', membershipChatGuard);
  app.route('/', chatMedia);
  app.route('/', conversations);
  app.route('/', messages); // ROUND 4
  app.route('/', chatGroups); // CHAT 7.3/7.4
  app.route('/', communities);
  app.route('/', events);
  app.route('/', wishes);
  app.route('/', study);
  app.route('/', gifts);
  app.route('/', notifications);
  app.route('/', rhythm);
  app.route('/', social); // SOCIAL (round 3)
  app.route('/', fundme); // FUND ME (round 3)
  app.route('/', fundmeMoney); // FUND ME MONEY: /fundme/* (credits, gifts, receipts, payout account) + /admin/api/fundme/* donations & payouts
  app.route('/', recordings); // DISCOVER TOOLS (round 3)
  app.route('/', reminders); // DISCOVER TOOLS (round 3)
  app.route('/', adminApi); // DISCOVER TOOLS (round 3): /admin/api/* (role = 'admin' checked inside)
  app.route('/', adminPlus); // ROUND 5: dashboard, users, content, communities & events, announcements (admin only)
  app.route('/', announcementsPublic); // ROUND 5: GET /announcements for the app
  app.route('/', contests); // CONTESTS
  app.route('/', adminContests); // CONTESTS: /admin/api/contests (admin only)
  app.route('/', battles); // CONTEST CENTRE: live Bible battles
  app.route('/', opportunities); // OPPORTUNITIES: jobs, scholarships, grants, hackathons… from outside sources
  app.route('/', adminOpportunities); // OPPORTUNITIES: /admin/api/opportunity-sources (admin only)
  app.route('/', websites); // MEMBER WEBSITES: members add their sites; approved ones open in the in-app viewer
  app.route('/', adminWebsites); // MEMBER WEBSITES: /admin/api/websites approvals (admin only)
  app.route('/', ads); // ADS: POST /ads/events (batched ad events)
  app.route('/', adminAds); // ADS: /admin/api/ads/* (admin only)
  app.route('/', youtubeComments); // YOUTUBE LIVE: Bible Nestra comments per YouTube video
  app.route('/', adminYouTubeLive); // YOUTUBE LIVE: /admin/api/youtube/live (admin only)
  app.route('/', library); // MEDIA LIBRARY: /library/* (signed in)
  app.route('/', adminLibrary); // MEDIA LIBRARY: /admin/api/library/* (admin only)
  app.route('/', broadcastsApp); // BROADCASTS: /broadcasts/:id (+ /open, /click read stats)
  app.route('/', adminBroadcasts); // BROADCASTS: /admin/api/broadcasts (admin only)
  app.route('/', adminDaily); // TODAY'S JOURNEY: /admin/api/daily/*, /admin/api/youtube/today/* (admin only)
  app.route('/', exegesis); // EXEGESIS: POST /study/exegesis (signed in)
  app.route('/', companion); // SCRIPTURE COMPANION: /companion/* (signed in)
  app.route('/', adminCompanion); // COMPANION MEANING SEARCH: /admin/api/companion/vectors[/build] (admin only)

  app.route('/', care); // CARE NETWORK: /care/* (signed in)
  app.route('/', adminCare); // CARE NETWORK: /admin/api/care/* priests verification + apostle settings (admin only)
  app.route('/', learnApp); // LEARN CMS: /learn/* courses, lessons, devotionals + my progress (signed in)
  app.route('/', adminLearn); // LEARN CMS: /admin/api/learn/* (admin only)
  app.route('/', referrals); // CHAT LIMITS: /me/invite, /me/referral, /chat/allowance, /paywall/*
  app.route('/', adminReferrals); // CHAT LIMITS: PUT /admin/api/users/:id/premium (admin only)
  app.route('/', chatGaps); // CHAT GAPS: GET/DELETE /conversations/:id/bans (group admins)
  app.route('/', adminBlog); // BLOG: /admin/api/blog/* posts, AI generation, schedules, runs, settings (admin only)
  app.route('/', accountDeletion); // LEGAL: POST /me/delete-account (signed in)
  app.route('/', adminAccountDeletions); // LEGAL: /admin/api/account-deletions (admin only)
  app.route('/', membershipsApp); // MEMBERSHIPS & PAID CHANNELS: /memberships/* (catalogue, product, checkout, library) + /memberships/manage/*
  app.route('/', walletApp); // WALLET CORE: /wallet, /wallet/:wallet/history, /wallet/products, /wallet/purchase, /wallet/subscriptions
  app.route('/', adminWallet); // WALLET CORE: /admin/api/wallet/* (admin only) — "Wallets & payments" tab
  app.route('/', giftsApp); // VIRTUAL GIFTS & STARS: /gifts/catalogue|send|history|wall|earnings|programme|withdrawals, /live-sessions
  app.route('/', adminGifts); // VIRTUAL GIFTS & STARS: /admin/api/gifts/* (admin only)
  app.route('/', datingApp); // FIND LOVE: /dating/* (profile, discover, swipes, likes, matches, requests, ad unlocks, bundles, boosts, safety)
  app.route('/', adminDating); // FIND LOVE: /admin/api/dating/* (admin only) — "Dating" section of Wallets & payments

  return app;
}

import { sweepAbandonedUploads } from './lib/videoUploads.js';

export { Hub };

const app = createApp();
// fetch for HTTP; scheduled for the cron trigger in wrangler.toml (contest payouts and reminders)
export default {
  fetch: (req, env, ctx) => app.fetch(req, env, ctx),
  scheduled: (event, env, ctx) => ctx.waitUntil(Promise.all([
    runContestCron(env, ctx),
    sweepAbandonedUploads(env).catch((e) => console.error('upload sweep failed', e)),
    companionVectorsCron(env).catch((e) => console.error('companion vectors failed', e)), // COMPANION MEANING SEARCH: embeds ≤15 missing verses per run
    runBlogCron(env).catch((e) => console.error('blog cron failed', e)), // BLOG: publish due posts, run due AI schedules (≤ BLOG_CRON_POSTS posts per tick)
    runMembershipCron(env).catch((e) => console.error('membership expiry failed', e)), // MEMBERSHIPS: expire lapsed subscriptions, remove them from Channel + Community
    runWalletCron(env).catch((e) => console.error('wallet cron failed', e)), // WALLET CORE: expire ended dating subscriptions
  ])),
};
