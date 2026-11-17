// YOUTUBE LIVE: tapping a "🔴 LIVE NOW!" push opens the in-app Watch screen for that broadcast.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export function useLivePushOpen(nav) {
  useEffect(() => {
    if (Platform.OS === 'web' || !nav) return undefined;
    const handled = new Set();
    const open = (resp) => {
      const n = resp && resp.notification;
      const d = n && n.request && n.request.content && n.request.content.data;
      if (!d || (d.type !== 'live' && d.kind !== 'live') || !d.videoId) return;
      const key = `${n.request.identifier}|${n.date}`;
      if (handled.has(key)) return;
      handled.add(key);
      nav.push('YouTubeWatch', { videoId: d.videoId, title: d.videoTitle, channelTitle: d.channelTitle, live: true });
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => sub.remove();
  }, [!!nav]);
}
