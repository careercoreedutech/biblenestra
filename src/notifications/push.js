// Register for Expo Push Notifications and upload token to Worker API.
// CHAT PUSH (chat gaps): chat pushes arrive on the "chat" Android channel with the "chat_message" category
// (the server sets both — backend/src/lib/push.js) and carry data { conversationId, messageId, threadId, chatTitle, kind }.
//   • Reply        — text input right in the notification; sent through POST /conversations/:id/messages
//   • Mark as read — POST /conversations/:id/read
//   • tap          — opens that chat
//   • per-chat grouping: expo-notifications 0.29 has no Android setGroup / MessagingStyle and the Expo push API has no
//     group/tag field, so each message is its own notification and Android bundles the app's notifications together.
//     Whenever the app's JavaScript runs (app opened or resumed, a Reply / Mark as read handled in the background) we
//     tidy the tray per conversation: a chat's notifications are replaced by ONE notification for that chat
//     ("Choir · 3 new messages" with the latest lines), and a chat that was read / replied to / opened is cleared.
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

export const CHAT_CHANNEL = 'chat';
export const CHAT_QUIET_CHANNEL = 'chat_summary'; // the tidied per-chat notification — no second sound/vibration
export const CHAT_CATEGORY = 'chat_message';
const REPLY_ACTION = 'reply';
const READ_ACTION = 'mark_read';

export async function registerForPushNotificationsAsync(request) {
  if (Platform.OS === 'web') return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const tokenObj = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenObj?.data;

    if (token && request) {
      await request('POST', '/me/push-token', {
        token,
        platform: Platform.OS,
      });
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#c9a45c',
      });
    }
    await setupChatNotificationsAsync();

    return token;
  } catch (error) {
    console.warn('[push] Push token registration skipped:', error.message);
    return null;
  }
}

// ---------- CHAT PUSH: channels + Reply / Mark as read category ----------
let chatSetup = null;
export function setupChatNotificationsAsync() {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!chatSetup) {
    chatSetup = (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelGroupAsync('chats', { name: 'Chats' }).catch(() => {});
        await Notifications.setNotificationChannelAsync(CHAT_CHANNEL, {
          name: 'Chat messages',
          description: 'Messages from your chats and groups',
          groupId: 'chats',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 180, 120, 180],
          lightColor: '#c9a45c',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
          showBadge: true,
        });
        await Notifications.setNotificationChannelAsync(CHAT_QUIET_CHANNEL, {
          name: 'Chat summaries',
          description: 'One tidy notification per chat (no sound)',
          groupId: 'chats',
          importance: Notifications.AndroidImportance.DEFAULT,
          sound: null,
          enableVibrate: false,
          vibrationPattern: null,
          showBadge: true,
        });
      }
      await Notifications.setNotificationCategoryAsync(CHAT_CATEGORY, [
        {
          identifier: REPLY_ACTION,
          buttonTitle: 'Reply',
          textInput: { submitButtonTitle: 'Send', placeholder: 'Message' },
          options: { opensAppToForeground: false },
        },
        {
          identifier: READ_ACTION,
          buttonTitle: 'Mark as read',
          options: { opensAppToForeground: false },
        },
      ]);
    })().catch((e) => { chatSetup = null; console.warn('[push] chat notification setup skipped:', e && e.message); });
  }
  return chatSetup;
}

const dataOf = (n) => (n && n.request && n.request.content && n.request.content.data) || {};
const isChatData = (d) => !!(d && d.conversationId && (d.threadId === `chat:${d.conversationId}` || d.kind === 'message' || d.kind === 'group'));
const titleOf = (n, d) => d.chatTitle || (n && n.request && n.request.content && n.request.content.title) || 'Chat';

/** Remove every notification of one chat from the tray (read, replied to, or opened). */
export async function dismissChatNotifications(conversationId) {
  if (Platform.OS === 'web' || !conversationId) return;
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown
      .filter((n) => dataOf(n).conversationId === conversationId)
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})));
  } catch (e) { /* not supported on this device */ }
}

/** One notification per chat: chats with several notifications in the tray are folded into a single quiet one. */
export async function collapseChatNotifications() {
  if (Platform.OS === 'web') return;
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const byChat = new Map();
    for (const n of shown) {
      const d = dataOf(n);
      if (!isChatData(d)) continue;
      if (!byChat.has(d.conversationId)) byChat.set(d.conversationId, []);
      byChat.get(d.conversationId).push(n);
    }
    for (const [convId, list] of byChat) {
      const count = list.reduce((sum, n) => sum + (Number(dataOf(n).count) || 1), 0);
      if (list.length < 2) continue;
      list.sort((a, b) => (a.date || 0) - (b.date || 0));
      const latest = list[list.length - 1];
      const d = dataOf(latest);
      const lines = list.map((n) => (dataOf(n).lines || [n.request.content.body || ''])).flat().filter(Boolean).slice(-5);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(list.map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})));
      // eslint-disable-next-line no-await-in-loop
      await Notifications.scheduleNotificationAsync({
        identifier: `chat:${convId}`, // same identifier → replaces the previous summary for this chat
        content: {
          title: titleOf(latest, d),
          subtitle: `${count} new messages`,
          body: lines.join('\n'),
          data: { ...d, conversationId: convId, threadId: `chat:${convId}`, summary: true, count, lines },
          categoryIdentifier: CHAT_CATEGORY,
          sound: false,
        },
        trigger: Platform.OS === 'android' ? { channelId: CHAT_QUIET_CHANNEL } : null,
      });
    }
  } catch (e) { /* not supported on this device */ }
}

/** Open the chat a notification belongs to. */
export function openChatFromData(nav, d) {
  if (!nav || !d || !d.conversationId) return;
  nav.push('Chat', { id: d.conversationId, to: d.chatTitle || undefined, ...(d.kind === 'group' ? { kind: 'group' } : {}) });
}

/**
 * Mounted once at the app root: taps open the chat, Reply sends the typed text, Mark as read marks the chat read.
 * `request` is the authed API request(method, path, body) (useApi().request). Responses that arrive while the app
 * was closed are delivered when it next starts (expo-notifications keeps them pending until this listener exists).
 */
export function useChatPush(nav, request) {
  const reqRef = useRef(request);
  reqRef.current = request; // the latest authed request (tokens refresh)
  useEffect(() => {
    if (Platform.OS === 'web' || !nav) return undefined;
    setupChatNotificationsAsync();
    const handled = new Set();
    const respond = async (resp) => {
      const n = resp && resp.notification;
      const d = dataOf(n);
      if (!isChatData(d)) return;
      const key = `${n.request.identifier}|${n.date}|${resp.actionIdentifier}`;
      if (handled.has(key)) return;
      handled.add(key);
      const convId = d.conversationId;
      if (resp.actionIdentifier === REPLY_ACTION) {
        const text = String(resp.userText || '').trim();
        const request = reqRef.current;
        if (!text || !request) return;
        try {
          // clientId from the notification: a retried / re-delivered response is de-duplicated by the server
          await request('POST', `/conversations/${convId}/messages`, { kind: 'text', text: text.slice(0, 5000), clientId: `notif-${String(n.request.identifier).slice(-60)}-${n.date || 0}`.slice(0, 100) });
          await request('POST', `/conversations/${convId}/read`).catch(() => {});
          await dismissChatNotifications(convId);
        } catch (e) {
          // keep the notification; tell the person their reply didn't go
          await Notifications.scheduleNotificationAsync({
            content: { title: titleOf(n, d), body: 'Your reply wasn’t sent. Tap to open the chat.', data: { ...d, failedReply: true }, sound: false },
            trigger: Platform.OS === 'android' ? { channelId: CHAT_QUIET_CHANNEL } : null,
          }).catch(() => {});
        }
        return;
      }
      if (resp.actionIdentifier === READ_ACTION) {
        if (reqRef.current) await reqRef.current('POST', `/conversations/${convId}/read`).catch(() => {});
        await dismissChatNotifications(convId);
        return;
      }
      // a plain tap (DEFAULT_ACTION_IDENTIFIER) opens the chat
      openChatFromData(nav, d);
      dismissChatNotifications(convId);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => { respond(r).catch(() => {}); });
    Notifications.getLastNotificationResponseAsync().then((r) => {
      // only a tap opens the chat at cold start; actions were already handled by the listener
      if (r && r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) respond(r).catch(() => {});
    }).catch(() => {});
    // tidy the tray per chat when the app starts and whenever it comes back to the foreground
    collapseChatNotifications();
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') collapseChatNotifications(); });
    return () => { sub.remove(); app.remove(); };
  }, [!!nav]);
}
