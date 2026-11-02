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
import communities from './routes/communities.js';
import events from './routes/events.js';
import wishes from './routes/wishes.js';
import study from './routes/study.js';
import gifts from './routes/gifts.js';
import notifications from './routes/notifications.js';
import rhythm from './routes/rhythm.js';

export function createApp() {
  const app = new Hono();

  app.use('*', cors({
    origin: (o, c) => {
      const allowed = (c.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
      return allowed.includes('*') || allowed.includes(o) ? o || '*' : null;
    },
    allowHeaders: ['Authorization', 'Content-Type', 'X-Dev-User', 'X-TZ-Offset', 'X-Conversation-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong on our side', code: 'INTERNAL' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

  // public endpoints
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
  app.route('/', communities);
  app.route('/', events);
  app.route('/', wishes);
  app.route('/', study);
  app.route('/', gifts);
  app.route('/', notifications);
  app.route('/', rhythm);

  return app;
}

export { Hub };

const app = createApp();
export default app;
