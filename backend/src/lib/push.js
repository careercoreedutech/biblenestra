// Push notification delivery via Expo Push API + database inbox entry.
// Chunks of <= 100, executed non-blocking via ctx.waitUntil.
import { q, one } from './db.js';
import { isUserOnline } from '../hub.js';

export async function sendNotification(c, {
  userId,
  kind,       // 'message' | 'request' | 'group' | 'prayer' | 'event' | 'gift' | 'job' | 'contest'
  title,
  body,
  data = {},
}) {
  const env = c.env;
  if (!userId) return;

  // 1. Create an entry in the user's notification inbox
  try {
    await q(env,
      `INSERT INTO notifications (user_id, kind, title, body, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, kind, title, body, JSON.stringify(data)]
    );
  } catch (err) {
    console.warn('[push] Failed to write notification inbox row:', err.message);
  }

  // 2. Check user notification settings
  const user = await one(env, 'SELECT notify FROM users WHERE id = $1', [userId]);
  const notifySettings = user?.notify || {};
  if (notifySettings[kind] === false) {
    return; // User has muted this notification category
  }

  // 3. If user is currently online on WebSocket Hub, skip push notification (they receive live socket event)
  const online = await isUserOnline(env, userId);
  if (online) return;

  // 4. Fetch user's registered push tokens
  const rows = await q(env, 'SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
  if (!rows || rows.length === 0) return;

  // CHAT PUSH: chat pushes (data.threadId = "chat:<conversationId>") go to the app's "chat" Android channel and carry
  // the "chat_message" category, whose Reply (text input) / Mark as read actions the app registers
  // (src/notifications/push.js). A device without that channel/category yet falls back to the default ones.
  const isChat = typeof data.threadId === 'string' && data.threadId.startsWith('chat:') && !!data.conversationId;
  const messages = rows.map((r) => ({
    to: r.token,
    sound: 'default',
    title,
    body,
    ...(isChat ? { channelId: 'chat', categoryId: 'chat_message', priority: 'high' } : {}),
    data: { ...data, kind, ...(isChat ? { chatTitle: title } : {}) },
    // NOTIFICATIONS: rich push image (Expo push `richContent.image`). Android shows it out of the box (with
    // expo-notifications 0.29 as the large thumbnail on the right); iOS needs a Notification Service Extension.
    ...(typeof data.image === 'string' && /^https:\/\//.test(data.image) ? { richContent: { image: data.image }, mutableContent: true } : {}),
  }));

  const pushTask = async () => {
    // Expo allows up to 100 messages per chunk
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await ((env && env.__fetch) || fetch)('https://exp.host/--/api/v2/push/send', { // env.__fetch: tests
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
          },
          body: JSON.stringify(chunk),
        });
        const result = await res.json();
        const tickets = result.data || [];
        for (let j = 0; j < tickets.length; j++) {
          const t = tickets[j];
          if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
            const badToken = chunk[j].to;
            await q(env, 'DELETE FROM push_tokens WHERE token = $1', [badToken]);
          }
        }
      } catch (e) {
        console.warn('[push] Failed to deliver push chunk:', e.message);
      }
    }
  };

  if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
    c.executionCtx.waitUntil(pushTask());
  } else {
    pushTask().catch((e) => console.warn('[push] Error in push task:', e));
  }
}
