// Live sessions + live gifting for the Live Fellowship screen (DiscoverScreen LiveScreen).
//   useLiveRooms(seed)        member live rooms from GET /live-sessions first, then the seed rooms
//   <LiveGiftLayer room />    inside the stream box: "Send a gift" button + on-stream animation of every gift sent in
//                             this session (polls GET /live-sessions/:id every 5 s while open)
//   <GoLiveRow />             start / end my own live room (so members can gift me while I'm live)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from '../Motion';
import { Icon } from '../Icons';
import { Button, Input } from '../ui';
import { colors, radius } from '../../theme';
import { useApi } from '../../api/auth';
import { useStore } from '../../store';
import { listLive, startLive, endLive, liveGifts } from '../../api/gifts';
import { GiftSheet } from './GiftSheet';
import { GiftOverlay } from './GiftPlayer';

const toRoom = (s) => ({
  id: s.id, serverId: true, hostId: s.hostId, title: s.title, host: (s.host && s.host.displayName) || 'Member', status: 'live', viewers: 0,
  language: 'English', captions: false, audience: 'Members', startedAt: s.startedAt,
});

export function useLiveRooms(seed = []) {
  const api = useApi();
  const [rooms, setRooms] = useState([]);
  const reload = useCallback(async () => {
    if (!api.online) return;
    try { const r = await listLive(api); setRooms((r.items || []).map(toRoom)); } catch (e) { /* keep the last list */ }
  }, [api.online]);
  useEffect(() => { reload(); }, [reload]);
  return { rooms: [...rooms, ...seed], reload };
}

export function LiveGiftLayer({ room }) {
  const api = useApi();
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState([]);
  const since = useRef(new Date().toISOString());
  const shown = useRef(new Set());
  const meId = state.user && state.user.id;
  const giftable = !!(room && room.serverId && room.hostId && api.online);
  useEffect(() => {
    if (!giftable) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const r = await liveGifts(api, room.id, since.current);
        const fresh = (r.gifts || []).filter((g) => !shown.current.has(g.id)).reverse();
        if (fresh.length) {
          fresh.forEach((g) => shown.current.add(g.id));
          since.current = fresh[fresh.length - 1].createdAt;
          if (alive) setQueue((q) => [...q, ...fresh.map((g) => ({ gift: g.gift, from: g.sender && g.sender.displayName, key: g.id }))].slice(-6));
        }
      } catch (e) { /* next tick */ }
    };
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [giftable, room && room.id]);
  const isHost = room && meId && room.hostId === meId;
  return (
    <>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <GiftOverlay play={queue[0] || null} onDone={() => setQueue((q) => q.slice(1))} />
        {!isHost ? (
          <PressScale onPress={() => (giftable ? setOpen(true) : null)} scaleTo={0.92} style={[styles.btn, !giftable && { opacity: 0.55 }]}
            accessibilityRole="button" accessibilityLabel={giftable ? `Send ${room.host} a gift` : 'Gifts are available in member live rooms'}>
            <Icon name="gift" size={15} color="#FFFFFF" />
            <Text style={styles.btnText}>{giftable ? 'Gift' : 'Gifts in member rooms'}</Text>
          </PressScale>
        ) : null}
      </View>
      {giftable ? (
        <GiftSheet visible={open} onClose={() => setOpen(false)} recipient={{ id: room.hostId, name: room.host }} context={{ type: 'live', id: room.id }}
          onSent={(r) => { if (r && r.send) { shown.current.add(r.send.id); } }} />
      ) : null}
    </>
  );
}

export function GoLiveRow({ onChange }) {
  const api = useApi();
  const { state } = useStore();
  const [mine, setMine] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const meId = state.user && state.user.id;
  useEffect(() => {
    if (!api.online) return;
    listLive(api).then((r) => setMine((r.items || []).find((s) => s.hostId === meId) || null)).catch(() => {});
  }, [api.online, meId]);
  if (!api.online) return null;
  const go = async () => {
    setBusy(true);
    try { if (mine) { await endLive(api, mine.id); setMine(null); } else { setMine(await startLive(api, title.trim() || 'Live fellowship')); setTitle(''); } onChange && onChange(); } catch (e) { /* toast-less: retry */ }
    setBusy(false);
  };
  return (
    <View style={styles.go}>
      <Text style={styles.goTitle}>{mine ? `You’re live: ${mine.title}` : 'Host a live room'}</Text>
      <Text style={styles.goSub}>{mine ? 'Members can join and send you gifts while you’re live.' : 'Start a member live room. Viewers can send you virtual gifts (you receive 80% as gift earnings).'}</Text>
      {!mine ? <Input placeholder="Room title" value={title} onChangeText={setTitle} style={{ marginTop: 8 }} /> : null}
      <Button small kind={mine ? 'ghost' : 'primary'} label={busy ? '…' : mine ? 'End my live room' : 'Go live'} disabled={busy} onPress={go} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { position: 'absolute', right: 14, top: 58, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(214,31,77,0.92)' },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  go: { marginTop: 18, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  goTitle: { fontSize: 15, fontWeight: '700', color: colors.fg },
  goSub: { fontSize: 12.5, color: colors.muted, marginTop: 3, lineHeight: 17 },
});
