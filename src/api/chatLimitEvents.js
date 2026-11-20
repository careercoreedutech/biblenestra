// CHAT LIMITS (client #27): a tiny event bus between the API client and the subscription prompt.
// Any request that the server refuses with 403 CHAT_LIMIT_REACHED (open a new chat, first message, coin gift)
// calls notifyChatLimit({ used, limit }) from src/api/client.js; <ChatLimitHost/> (App.js) listens and shows
// the upgrade / invite prompt. Kept free of React imports so client.js can import it without cycles.
const listeners = new Set();
let lastAt = 0;

export function onChatLimit(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyChatLimit(data) {
  const now = Date.now();
  if (now - lastAt < 800) return; // the dm + message calls of one tap → one prompt
  lastAt = now;
  const info = {
    used: Number(data && data.used) || 0,
    limit: Number(data && data.limit) || 5,
    pass: (data && data.pass) || null, // CHAT WEEK PASS: active pass (its extra chats are used up) or null
    passOffer: (data && data.passOffer) || null, // CHAT WEEK PASS: { coins, extraSlots, unlimited, days }
  };
  listeners.forEach((fn) => { try { fn(info); } catch (e) { /* ignore */ } });
}

export const isChatLimitError = (e) => !!e && e.code === 'CHAT_LIMIT_REACHED';

// CHAT WEEK PASS: after a pass is bought, counters (useChatAllowance) reload.
const passListeners = new Set();
export function onChatPassChange(fn) { passListeners.add(fn); return () => passListeners.delete(fn); }
export function notifyChatPassChange(data) { passListeners.forEach((fn) => { try { fn(data); } catch (e) { /* ignore */ } }); }
