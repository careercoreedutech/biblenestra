// VIEW COUNTS: the numbers on post cards and reels. Two things live here:
//   1. Post impressions: a post that stays on screen (≥50% visible for ≥1 s) is queued and sent in batches to
//      POST /posts/views. Each post is reported once per app session; the server applies its own rules.
//   2. Live counts: the totals the server returns (post views, video plays) are kept here, so a card or reel shows the
//      new number at once instead of after the next refresh. Counts only ever go up on this device.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '../Icons';
import { compactCount } from '../../utils/compactCount';
import { recordPostViews } from '../../api/views';

const FLUSH_MS = 3000;
const MAX_BATCH = 50;

const live = new Map(); // `${kind}:${id}` → number
const subs = new Map(); // key → Set<fn>

export function setLiveCount(kind, id, n) {
  const v = Number(n);
  if (!id || !Number.isFinite(v)) return;
  const key = `${kind}:${id}`;
  if ((live.get(key) || 0) >= v) return;
  live.set(key, v);
  if (subs.has(key)) subs.get(key).forEach((fn) => fn(v));
}

/** The larger of the count the list data carried and the live count this device has seen. */
export function useLiveCount(kind, id, base = 0) {
  const key = `${kind}:${id}`;
  const [n, setN] = useState(() => live.get(key) || 0);
  useEffect(() => {
    setN(live.get(key) || 0);
    if (!subs.has(key)) subs.set(key, new Set());
    const fn = (v) => setN(v);
    subs.get(key).add(fn);
    return () => { subs.get(key).delete(fn); };
  }, [key]);
  return Math.max(Number(base) || 0, n);
}

// ---------- post impressions ----------
const seen = new Set(); // post ids already queued this session
let pending = [];
let timer = null;
let lastApi = null;

/** Queue post ids that became visible in the feed. Called from the feed's viewability callback. */
export function queuePostImpressions(api, ids) {
  if (!api || !api.online) return; // counting needs a signed-in member
  lastApi = api;
  (ids || []).forEach((id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    pending.push(id);
  });
  if (pending.length >= MAX_BATCH) flushPostImpressions();
  else if (pending.length && !timer) timer = setTimeout(flushPostImpressions, FLUSH_MS);
}

export function flushPostImpressions() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending.length || !lastApi) return;
  const batch = pending.splice(0, MAX_BATCH);
  recordPostViews(lastApi, batch)
    .then((r) => {
      const views = (r && r.views) || {};
      Object.keys(views).forEach((id) => setLiveCount('post', id, views[id]));
    })
    .catch(() => { /* best effort: the server count comes back on the next refresh */ });
  if (pending.length) flushPostImpressions();
}

// ---------- the eye count ----------
/** Eye icon + compact count (1, 1.2K, 10K, 1.2M). Renders nothing for zero. */
export function ViewCount({ count, color = '#FFFFFF', size = 12, style, textStyle }) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return (
    <View style={[styles.row, style]} accessibilityLabel={`${compactCount(n)} views`}>
      <Icon name="eye" size={size} color={color} />
      <Text style={[styles.text, { color }, textStyle]}>{compactCount(n)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { fontSize: 12, fontWeight: '700' },
});
