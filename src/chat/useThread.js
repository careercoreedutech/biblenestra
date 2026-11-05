// Loads a server conversation into its store scope when a chat opens (ROUND 4). In local mode it does nothing.
// Polls every 5 s only while the realtime socket isn't connected.
import { useEffect, useState } from 'react';
import { useSync } from '../api/sync';

export function useThreadLoader(scope, conversationId) {
  const sync = useSync();
  const [myRole, setMyRole] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!sync.online || !conversationId || !sync.loadThread) return undefined;
    let alive = true;
    const load = () => sync.loadThread(scope, conversationId)
      .then((r) => { if (alive && r) { setMyRole(r.myRole); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    load();
    if (sync.markChatRead) sync.markChatRead(conversationId);
    const poll = sync.realtimeStatus !== 'connected' ? setInterval(load, 5000) : null;
    return () => { alive = false; if (poll) clearInterval(poll); };
  }, [scope, conversationId, sync.online, sync.realtimeStatus]);
  return { myRole, loaded };
}
