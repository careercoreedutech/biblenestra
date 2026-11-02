// Cloudflare Durable Object class "Hub" (SQLite-backed, WebSocket Hibernation API)
// Delivers live events to connected clients. One Hub instance per user ("user:<id>").

export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // WebSocket Hibernation API
      this.ctx.acceptWebSocket(server);

      // Broadcast presence on connect
      const count = this.ctx.getWebSockets().length;
      server.send(JSON.stringify({ type: 'presence', status: 'connected', activeSockets: count, time: Date.now() }));

      return new Response(null, { status: 101, webSocket: client });
    }

    // Worker internal notify RPC
    if (request.method === 'POST' && url.pathname === '/notify') {
      let event;
      try { event = await request.json(); } catch (e) { event = {}; }
      const sockets = this.ctx.getWebSockets();
      const payload = JSON.stringify(event);
      let sent = 0;
      for (const ws of sockets) {
        try {
          ws.send(payload);
          sent++;
        } catch (e) {
          try { ws.close(1011, 'Send failed'); } catch (_) {}
        }
      }
      return new Response(JSON.stringify({ ok: true, sent, activeSockets: sockets.length }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Presence check: is this user online right now?
    if (request.method === 'GET' && url.pathname === '/presence') {
      const sockets = this.ctx.getWebSockets();
      return new Response(JSON.stringify({ online: sockets.length > 0, count: sockets.length }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws, message) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : {};
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
        return;
      }
    } catch (e) {
      // Ignore unparseable messages
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch (_) {}
  }

  async webSocketError(ws, error) {
    try { ws.close(1011, 'Unexpected error'); } catch (_) {}
  }
}

/**
 * Dispatch an event to a user's Hub instance if Durable Objects are configured.
 * Safely no-ops in environments without Durable Objects (Node.js test harness / dev server).
 */
export async function notifyUser(env, userId, event) {
  if (!env?.HUB || !userId) return false;
  try {
    const id = env.HUB.idFromName(`user:${userId}`);
    const stub = env.HUB.get(id);
    const res = await stub.fetch('http://hub/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return res.ok;
  } catch (e) {
    console.warn(`[hub] notifyUser failed for ${userId}:`, e.message);
    return false;
  }
}

/**
 * Check if a user is currently connected to their Hub
 */
export async function isUserOnline(env, userId) {
  if (!env?.HUB || !userId) return false;
  try {
    const id = env.HUB.idFromName(`user:${userId}`);
    const stub = env.HUB.get(id);
    const res = await stub.fetch('http://hub/presence');
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.online;
  } catch (e) {
    return false;
  }
}
