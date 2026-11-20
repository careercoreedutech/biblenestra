// BROADCASTS: tapping an official-message push opens the Activity inbox with that message's detail view.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export function useBroadcastPushOpen(nav) {
  useEffect(() => {
    if (Platform.OS === 'web' || !nav) return undefined;
    const handled = new Set();
    const open = (resp) => {
      const n = resp && resp.notification;
      const d = n && n.request && n.request.content && n.request.content.data;
      if (!d || (d.kind !== 'broadcast' && d.type !== 'broadcast') || !d.broadcastId) return;
      const key = `${n.request.identifier}|${n.date}`;
      if (handled.has(key)) return;
      handled.add(key);
      nav.push('Activity', { broadcastId: d.broadcastId });
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => sub.remove();
  }, [!!nav]);
}
