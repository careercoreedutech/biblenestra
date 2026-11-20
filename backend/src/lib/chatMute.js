// CHAT GAPS — timed mute (8 hours / 1 week / always), stored per member in conversation_members:
//   muted = true + muted_until NULL  → muted until unmuted ("always")
//   muted = true + muted_until future → muted until then; once it passes the chat is simply not muted
// Every push decision and every "muted" flag the app sees goes through mutedSql(), so expiry needs no cron.
export const MUTE_DURATIONS = { '8h': 8 * 3600e3, '1w': 7 * 864e5, always: null };

/** SQL boolean: is this member row muted right now? `a` is the conversation_members alias. */
export const mutedSql = (a = 'm') => `(${a}.muted AND (${a}.muted_until IS NULL OR ${a}.muted_until > now()))`;

/** { muted, mutedUntil } for the app from a row that selected `muted` (already effective) and `muted_until`. */
export function muteShape(muted, mutedUntil) {
  const on = !!muted;
  return { muted: on, mutedUntil: on && mutedUntil ? new Date(mutedUntil).toISOString() : null };
}
