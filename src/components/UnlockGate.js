// UnlockGate: a reusable card that unlocks a timed feature with Kingdom Coins or with rewarded ads.
// Server rules live in backend/src/lib/featureUnlocks.js (catalogue: registerConfig 'feature_unlocks'). The gate never
// grants access itself: the server returns the unlock and the gate reports it.
//
// Use it inside a sheet or a card on the screen that owns the feature:
//
//   <UnlockGate
//     feature="scripture_pop"                 // key in the server catalogue
//     title="Unlock Scripture Pop-up"         // heading (optional, defaults to the catalogue title)
//     body="Scripture, prayer and encouragement pop-ups for 24 hours."
//     onUnlocked={({ until, remainingSec }) => { /* continue, e.g. start the schedule */ }}
//   />
//
// Props: feature (required), title, body, onUnlocked(unlock) — called once after a successful unlock, compact (bool,
// a single-row variant for lists), style. While unlocked the card shows the status and the time left (updates every
// 30 s). Ads are watched with ads.showRewarded({ purpose: 'unlock:<feature>' }); each ad credits the coins the server
// lists for it (catalogue adRewards). Offline, the card says so and does nothing.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useApi } from '../api/auth';
import { creditUnlockAd, unlockError, unlockFeature, useUnlocks } from '../api/unlocks';
import { useAds } from '../ads/Ads';
import { Grad, Tap, d, df, gradients } from '../design/sanctuary';

/** "23 h 5 min", "42 min", "under a minute". */
export function formatRemaining(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 60) return 'under a minute';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

export default function UnlockGate({ feature, title, body, onUnlocked, compact = false, style }) {
  const api = useApi();
  const ads = useAds();
  const { data, error, loaded, reload, online } = useUnlocks();
  const [busy, setBusy] = useState(null); // 'unlock' | 'ad' | null
  const [msg, setMsg] = useState(null);
  const [, setTick] = useState(0); // re-render every 30 s while unlocked so "time left" stays current

  const f = data && data.catalogue ? data.catalogue[feature] : null;
  const coins = data ? data.coins : 0;
  const unlocked = !!(f && f.unlocked);
  // time left from the server's expiry, recomputed on each tick (the server answer is only as new as the last reload)
  const remaining = f && f.until ? Math.max(0, (new Date(f.until).getTime() - Date.now()) / 1000) : 0;

  // refresh the "time left" text while unlocked
  useEffect(() => {
    if (!unlocked) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [unlocked]);

  // buying again while unlocked adds time (the server extends `until`)
  const unlock = async () => {
    if (busy || !f) return;
    setBusy('unlock');
    setMsg(null);
    try {
      const out = await unlockFeature(api, feature);
      setMsg(null);
      if (onUnlocked) onUnlocked(out.unlock);
    } catch (e) {
      setMsg(unlockError(e, 'Could not unlock. Please try again.'));
    } finally {
      setBusy(null);
      reload();
    }
  };

  const watchAd = async () => {
    if (busy || !f || unlocked) return;
    setBusy('ad');
    setMsg(null);
    try {
      const r = await ads.showRewarded({ purpose: `unlock:${feature}`, loadTimeoutMs: 30000 });
      if (!r || !r.rewarded) {
        setMsg(r && r.error ? 'No ad is available right now. Try again in a moment.' : 'The ad closed early. Watch it to the end to earn the coins.');
        return;
      }
      const out = await creditUnlockAd(api, feature);
      setMsg(out.credited ? null : 'That ad did not count this time. Try the next one.');
    } catch (e) {
      setMsg(unlockError(e, 'Could not record that ad. Please try again.'));
    } finally {
      setBusy(null);
      reload();
    }
  };

  const heading = title || (f ? f.title : 'Unlock');
  const cost = f ? f.coins : null;
  const need = f ? f.adsNeeded : 0;
  const watched = f ? f.adsWatched : 0;
  const canBuy = !!(f && coins >= f.coins);
  const canWatch = !!(f && need > 0 && watched < need);
  const pct = need > 0 ? Math.min(1, watched / need) : 0;

  if (!online) {
    return (
      <View style={[styles.card, style]}>
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.body}>Unlocking needs a connection to BibleNestra.</Text>
      </View>
    );
  }

  if (!loaded && !data) {
    return (
      <View style={[styles.card, styles.center, style]}>
        <ActivityIndicator color={d.plum} />
      </View>
    );
  }

  if (!f) {
    return (
      <View style={[styles.card, style]}>
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.body}>{error ? 'We could not load this right now. Pull to try again.' : 'This feature is not available yet.'}</Text>
      </View>
    );
  }

  if (unlocked) {
    return (
      <View style={[styles.card, styles.unlockedCard, style]} accessibilityLabel={`${heading} unlocked`}>
        <Text style={styles.eyebrow}>UNLOCKED</Text>
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.body}>{`Access ends in ${formatRemaining(remaining)}. After that you can unlock it again.`}</Text>
        {!compact && f.until ? <Text style={styles.meta}>{`Until ${new Date(f.until).toLocaleString()}`}</Text> : null}
        {busy === null && !compact && canBuy ? (
          <Tap onPress={unlock} style={styles.secondary} accessibilityRole="button" accessibilityLabel="Add more time">
            <Text style={styles.secondaryText}>{`Add ${f.hours >= 24 ? `${Math.round(f.hours / 24)} day${Math.round(f.hours / 24) === 1 ? '' : 's'}` : `${f.hours} hour${f.hours === 1 ? '' : 's'}`} · ${cost} coins`}</Text>
          </Tap>
        ) : null}
        {msg ? <Text style={styles.error}>{msg}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.card, style]}>
      <Text style={styles.eyebrow}>{`${f.hours >= 1 ? `${f.hours} hour${f.hours === 1 ? '' : 's'}` : 'Limited time'} access`}</Text>
      <Text style={styles.title}>{heading}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Cost</Text>
          <Text style={styles.statValue}>{`${cost} coins`}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Your balance</Text>
          <Text style={[styles.statValue, !canBuy && styles.short]}>{`${coins} coins`}</Text>
        </View>
      </View>

      {need > 0 ? (
        <View style={styles.adBox}>
          <Text style={styles.adText}>
            {canBuy
              ? `Or watch ${need} ad${need === 1 ? '' : 's'} to earn the coins.`
              : `Watch ${need} ad${need === 1 ? '' : 's'} to earn the ${cost} coins.`}
          </Text>
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: need, now: watched }}>
            <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
          </View>
          <Text style={styles.meta}>{`${watched} of ${need} watched`}</Text>
        </View>
      ) : null}

      <Tap
        onPress={unlock}
        disabled={!canBuy || !!busy}
        style={[styles.primaryWrap, (!canBuy || busy) && styles.dim]}
        accessibilityRole="button"
        accessibilityLabel={`Unlock for ${cost} coins`}
      >
        <Grad colors={gradients.orange} style={styles.primary}>
          {busy === 'unlock' ? <ActivityIndicator color={d.paper} /> : <Text style={styles.primaryText}>{canBuy ? `Unlock · ${cost} coins` : `Need ${cost - coins} more coins`}</Text>}
        </Grad>
      </Tap>

      {canWatch ? (
        <Tap onPress={watchAd} disabled={!!busy} style={[styles.secondary, busy && styles.dim]} accessibilityRole="button" accessibilityLabel="Watch an ad to earn coins">
          {busy === 'ad' ? <ActivityIndicator color={d.plumDark} /> : <Text style={styles.secondaryText}>{`Watch ad · ${watched + 1} of ${need}`}</Text>}
        </Tap>
      ) : null}

      {msg ? <Text style={styles.error}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: d.paper, borderRadius: 22, borderWidth: 1, borderColor: d.line, padding: 20, gap: 10 },
  unlockedCard: { borderColor: d.sageDark, backgroundColor: d.sage },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  eyebrow: { fontFamily: df.sansHeavy, fontSize: 11, letterSpacing: 1.2, color: d.plum, textTransform: 'uppercase' },
  title: { fontFamily: df.display, fontSize: 22, color: d.ink, lineHeight: 28 },
  body: { fontFamily: df.sans, fontSize: 14, lineHeight: 20, color: d.muted },
  meta: { fontFamily: df.sans, fontSize: 12, color: d.muted },
  row: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, backgroundColor: d.ivory, borderRadius: 14, padding: 12 },
  statLabel: { fontFamily: df.sans, fontSize: 12, color: d.muted },
  statValue: { fontFamily: df.sansBold, fontSize: 17, color: d.ink, marginTop: 2 },
  short: { color: d.roseDark },
  adBox: { backgroundColor: d.lavender, borderRadius: 14, padding: 14, gap: 8 },
  adText: { fontFamily: df.sansMedium, fontSize: 14, color: d.ink },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(40,26,17,0.12)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: d.plum },
  primaryWrap: { borderRadius: 999, overflow: 'hidden' },
  primary: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  primaryText: { fontFamily: df.sansBold, fontSize: 16, color: d.paper },
  secondary: { height: 48, borderRadius: 999, borderWidth: 1, borderColor: d.line, alignItems: 'center', justifyContent: 'center', backgroundColor: d.paper },
  secondaryText: { fontFamily: df.sansSemi, fontSize: 15, color: d.plumDark },
  dim: { opacity: 0.5 },
  error: { fontFamily: df.sansMedium, fontSize: 13, color: d.roseDark },
});
