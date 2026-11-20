// Loads a server conversation into its store scope when a chat opens (ROUND 4). In local mode it does nothing.
// The cached copy (persisted store) shows at once; the server page merges in when it arrives.
// Polls every 5 s only while the realtime socket isn't connected (CHAT 7.3: the poll also refreshes ticks,
// "Typing…" and presence, which ride along with the first page).
import { useEffect, useState } from 'react';
import { useSync } from '../api/sync';

export function useThreadLoader(scope, conversationId) {
  const sync = useSync();
  const [myRole, setMyRole] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(null); // older history (scroll up)
  useEffect(() => {
    if (!sync.online || !conversationId || !sync.loadThread) return undefined;
    let alive = true;
    let first = true;
    const load = () => sync.loadThread(scope, conversationId)
      .then((r) => {
        if (!alive || !r) return;
        setMyRole(r.myRole);
        setLoaded(true);
        if (first) { setCursor(r.hasMore ? r.cursor : null); first = false; }
      })
      .catch(() => { if (alive) setLoaded(true); });
    load();
    if (sync.markChatRead) sync.markChatRead(conversationId);
    const poll = sync.realtimeStatus !== 'connected' ? setInterval(load, 5000) : null;
    return () => { alive = false; if (poll) clearInterval(poll); };
  }, [scope, conversationId, sync.online, sync.realtimeStatus]);
  return { myRole, loaded, cursor, setCursor };
}
