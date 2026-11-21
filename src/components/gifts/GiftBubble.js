// Chat gift bubble (messages.kind 'gift', meta.vgift) — drawn inside MessageKit's <ChatMessage>. Tap to replay the
// full-screen animation. useIncomingGiftPlayer(messages) plays a gift that just arrived in the open chat.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GiftArt } from './GiftArt';
import { GiftPlayer } from './GiftPlayer';
import { colors } from '../../theme';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function GiftBubble({ vgift, mine, from, isGroup }) {
  const [play, setPlay] = useState(null);
  const g = { art: vgift.art, tier: vgift.tier, name: vgift.name };
  const title = mine
    ? `You sent ${vgift.name}${isGroup && vgift.toName ? ` to ${vgift.toName}` : ''}`
    : isGroup && vgift.toName ? `${from || 'Someone'} sent ${vgift.toName} ${vgift.name}` : `${from || 'They'} sent you ${vgift.name}`;
  return (
    <>
      <Pressable onPress={() => setPlay({ gift: g, from: mine ? null : from, to: mine ? vgift.toName : null, note: vgift.note, key: Date.now() })}
        style={styles.row} accessibilityRole="button" accessibilityLabel={`${title}. Tap to play the animation`}>
        <View style={[styles.art, mine && styles.artMine]}><GiftArt gift={g} size={58} /></View>
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text style={[styles.title, mine && { color: '#FFFFFF' }]} numberOfLines={2}>{title}</Text>
          {vgift.note ? <Text style={[styles.note, mine && { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={3}>“{vgift.note}”</Text> : null}
          <Text style={[styles.meta, mine && { color: 'rgba(255,255,255,0.7)' }]}>{`${fmt(vgift.coins)} coins · tap to replay`}</Text>
        </View>
      </Pressable>
      <GiftPlayer play={play} onDone={() => setPlay(null)} />
    </>
  );
}

/** Plays the newest gift someone else sent while this chat is open (once per message). Render the returned element. */
export function useIncomingGiftPlayer(messages) {
  const [play, setPlay] = useState(null);
  const seen = useRef(new Set());
  const first = useRef(true);
  const last = messages && messages.length ? messages[messages.length - 1] : null;
  useEffect(() => {
    if (!last) return;
    if (first.current) { first.current = false; seen.current.add(last.id); return; } // don't replay history on open
    if (!last.vgift || last.mine || seen.current.has(last.id)) return;
    seen.current.add(last.id);
    if (last.createdAt && Date.now() - last.createdAt > 60e3) return;
    setPlay({ gift: { art: last.vgift.art, tier: last.vgift.tier, name: last.vgift.name }, from: last.from, note: last.vgift.note, key: last.id });
  }, [last && last.id]);
  return <GiftPlayer play={play} onDone={() => setPlay(null)} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, paddingVertical: 2 },
  art: { width: 64, height: 64, borderRadius: 18, backgroundColor: '#FFF6E2', alignItems: 'center', justifyContent: 'center' },
  artMine: { backgroundColor: 'rgba(255,255,255,0.14)' },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.fg },
  note: { fontSize: 13, fontStyle: 'italic', color: colors.muted, marginTop: 2 },
  meta: { fontSize: 11.5, color: colors.faint, marginTop: 3 },
});
