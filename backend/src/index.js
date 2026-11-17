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
import communities from './routes/communities.js';
import events from './routes/events.js';
import wishes from './routes/wishes.js';
import study from './routes/study.js';
import gifts from './routes/gifts.js';
import notifications from './routes/notifications.js';
import rhythm from './routes/rhythm.js';
import social from './routes/social.js'; // SOCIAL (round 3)
import { fundme, fundmePublic } from './routes/fundme.js'; // FUND ME (round 3)
import recordings from './routes/recordings.js'; // DISCOVER TOOLS (round 3)
import reminders from './routes/reminders.js'; // DISCOVER TOOLS (round 3)
import youtube from './routes/youtube.js'; // DISCOVER TOOLS (round 3)
import { adminPage, adminApi } from './routes/admin.js'; // DISCOVER TOOLS (round 3)
import { adminPlus, announcementsPublic } from './routes/adminPlus.js'; // ROUND 5: admin dashboard sections
import { contests, adminContests, contestPublic } from './routes/contests.js'; // CONTESTS
import { opportunities, adminOpportunities } from './routes/opportunities.js'; // OPPORTUNITIES (imported listings)
import { extraBooks } from './routes/extraBooks.js'; // BEYOND THE 66: deuterocanonical & extra-biblical texts
import { battles } from './routes/battles.js'; // CONTEST CENTRE: live Bible battles
import { youtubePublic, youtubeComments, adminYouTubeLive } from './routes/youtubeLive.js'; // YOUTUBE LIVE: live alerts + comments per video
import { adsPublic, ads, adminAds } from './routes/ads.js'; // ADS: remote ad rules, ad events, admin Ads tab
import { library, libraryPublic, adminLibrary } from './routes/library.js'; // MEDIA LIBRARY: audio library, Christian books (PDF), personal & group uploads
import { runContestCron } from './lib/contestCron.js';

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
  app.route('/', chatMedia);
  app.route('/', conversations);
  app.route('/', messages); // ROUND 4
  app.route('/', communities);
  app.route('/', events);
  app.route('/', wishes);
  app.route('/', study);
  app.route('/', gifts);
  app.route('/', notifications);
  app.route('/', rhythm);
  app.route('/', social); // SOCIAL (round 3)
  app.route('/', fundme); // FUND ME (round 3)
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
  app.route('/', ads); // ADS: POST /ads/events (batched ad events)
  app.route('/', adminAds); // ADS: /admin/api/ads/* (admin only)
  app.route('/', youtubeComments); // YOUTUBE LIVE: Bible Nestra comments per YouTube video
  app.route('/', adminYouTubeLive); // YOUTUBE LIVE: /admin/api/youtube/live (admin only)
  app.route('/', library); // MEDIA LIBRARY: /library/* (signed in)
  app.route('/', adminLibrary); // MEDIA LIBRARY: /admin/api/library/* (admin only)

  return app;
}

export { Hub };

const app = createApp();
// fetch for HTTP; scheduled for the cron trigger in wrangler.toml (contest payouts and reminders)
export default {
  fetch: (req, env, ctx) => app.fetch(req, env, ctx),
  scheduled: (event, env, ctx) => ctx.waitUntil(runContestCron(env, ctx)),
};
