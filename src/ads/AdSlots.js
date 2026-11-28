// In-content ad slots (all hidden for BibleNestra Plus members):
//   <BannerSlot />    — a small adaptive banner (end of a Bible chapter)
//   <FeedNativeAd />  — a native "Sponsored" card that sits between feed posts
// In builds without the AdMob native module (web preview, Expo Go) they render a small labelled
// demo placeholder so placement can be checked; in production they render real AdMob ads, and
// collapse to nothing if no ad is available.
// Both respect the admin "Ads" rules (master switch + 'reader' / 'feed' surface switches) and report
// requested / impression / failed / clicked / paid events (impressions only from SDK callbacks:
// banner onAdLoaded — each load/refresh is a served impression — and the native IMPRESSION event).
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import GMA from './gma';
import { AD_UNITS } from './config';
import { useStore } from '../store';
import { isTestUnit, logAdEvent } from './remote';
import { useAdRules } from './AdBreaks';
import { surfaceAllowed } from './rules';
import { HouseCard } from './HouseAd'; // AD NETWORKS: our own house ad fills an empty slot when AdMob has no ad
import { colors, radius } from '../theme';

function usePremium() {
  const { state } = useStore();
  return !!(state && state.premium);
}

function useSurfaceOn(kind) {
  const rules = useAdRules();
  return surfaceAllowed(rules, kind, {});
}

function DemoBox({ label, height = 60, style, meta }) {
  // demo placements log one (test) impression per mount so the dashboard can be checked end to end
  useEffect(() => { if (meta) { logAdEvent('requested', meta); logAdEvent('impression', meta); } }, []);
  return (
    <View style={[styles.demo, { minHeight: height }, style]} accessibilityLabel="Sponsored">
      <Text style={styles.demoTag}>Sponsored</Text>
      <Text style={styles.demoText}>{label}</Text>
    </View>
  );
}

const BANNER_META = { surface: 'reader', placement: 'banner', format: 'banner', test: isTestUnit(AD_UNITS.banner) };
const NATIVE_META = { surface: 'feed', placement: 'inline', format: 'native', test: isTestUnit(AD_UNITS.native) };

export function BannerSlot({ style }) {
  const premium = usePremium();
  const on = useSurfaceOn('reader');
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);
  const native = !!(GMA && GMA.BannerAd);
  useEffect(() => {
    if (!premium && on && native && !requested.current) { requested.current = true; logAdEvent('requested', BANNER_META); }
  }, [premium, on, native]);
  if (premium || !on) return null;
  if (failed) return <HouseCard style={style} />; // AD NETWORKS: our own house ad when AdMob has no ad
  if (!native) return <DemoBox label="Banner ad appears here in the app" style={style} meta={{ ...BANNER_META, test: true }} />;
  const { BannerAd, BannerAdSize } = GMA;
  return (
    <View style={[styles.bannerWrap, style]}>
      <Text style={styles.smallTag}>Sponsored</Text>
      <BannerAd
        unitId={AD_UNITS.banner}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => logAdEvent('impression', BANNER_META)}
        onAdOpened={() => logAdEvent('clicked', BANNER_META)}
        onPaid={(p) => { if (p && Number.isFinite(Number(p.value))) logAdEvent('paid', { ...BANNER_META, value: p.value, currency: p.currency, precision: p.precision }); }}
        onAdFailedToLoad={() => { logAdEvent('failed', BANNER_META); setFailed(true); }}
      />
    </View>
  );
}

// `surface` picks the admin switch and the reporting surface ('feed' between posts, 'reader' inside website articles).
// `variant="article"` gives the card the reader look (ivory paper, serif headline) and collapses to nothing when no
// native ad can load, so an article never shows a placeholder.
export function FeedNativeAd({ style, surface = 'feed', variant }) {
  const premium = usePremium();
  const on = useSurfaceOn(surface);
  const meta = surface === 'feed' ? NATIVE_META : { ...NATIVE_META, surface };
  const article = variant === 'article';
  const cardStyle = article ? styles.articleCard : styles.feedCard;
  const [ad, setAd] = useState(null);
  const [failed, setFailed] = useState(false);
  const native = !!(GMA && GMA.NativeAd && GMA.NativeAdView);

  useEffect(() => {
    if (premium || !native || !on) return undefined;
    let alive = true;
    let loaded = null;
    const subs = [];
    logAdEvent('requested', meta);
    GMA.NativeAd.createForAdRequest(AD_UNITS.native, { requestNonPersonalizedAdsOnly: true })
      .then((a) => {
        loaded = a;
        if (!alive) { a.destroy(); return; }
        try {
          if (GMA.NativeAdEventType) {
            subs.push(a.addAdEventListener(GMA.NativeAdEventType.IMPRESSION, () => logAdEvent('impression', meta)));
            subs.push(a.addAdEventListener(GMA.NativeAdEventType.CLICKED, () => logAdEvent('clicked', meta)));
          }
        } catch (e) { /* older SDK: no events */ }
        setAd(a);
      })
      .catch(() => { logAdEvent('failed', meta); if (alive) setFailed(true); });
    return () => { alive = false; subs.forEach((u) => { try { if (u && u.remove) u.remove(); else if (typeof u === 'function') u(); } catch (e) { /* ignore */ } }); if (loaded) loaded.destroy(); };
  }, [premium, native, on]);

  if (premium || !on) return null;
  if (failed) return <HouseCard style={style} variant={article ? 'article' : undefined} />; // AD NETWORKS: house ad fallback
  if (!native) {
    if (article) return null; // no ad can load in this build: the article shows nothing in the slot
    return <DemoBox label="A native ad card appears here between posts" height={120} style={[styles.feedCard, style]} meta={{ ...NATIVE_META, test: true }} />;
  }
  if (!ad) return null;
  const { NativeAdView, NativeAsset, NativeAssetType, NativeMediaView } = GMA;
  return (
    <NativeAdView nativeAd={ad} style={[cardStyle, style]}>
      <View style={styles.nativeHead}>
        {ad.icon ? (
          <NativeAsset assetType={NativeAssetType.ICON}>
            <Image source={{ uri: ad.icon.url }} style={styles.nativeIcon} />
          </NativeAsset>
        ) : null}
        <View style={{ flex: 1 }}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={article ? styles.articleHeadline : styles.nativeHeadline} numberOfLines={article ? 2 : 1}>{ad.headline}</Text>
          </NativeAsset>
          <Text style={styles.smallTagInline}>Sponsored{ad.advertiser ? ` · ${ad.advertiser}` : ''}</Text>
        </View>
      </View>
      {ad.body ? (
        <NativeAsset assetType={NativeAssetType.BODY}>
          <Text style={styles.nativeBody} numberOfLines={3}>{ad.body}</Text>
        </NativeAsset>
      ) : null}
      <NativeMediaView style={styles.nativeMedia} resizeMode="cover" />
      {ad.callToAction ? (
        <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
          <Text style={article ? styles.articleCta : styles.nativeCta}>{ad.callToAction}</Text>
        </NativeAsset>
      ) : null}
    </NativeAdView>
  );
}

const styles = StyleSheet.create({
  demo: { borderRadius: radius.md || 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong || '#D8D0C2', backgroundColor: colors.raised || '#F0EBE1', alignItems: 'center', justifyContent: 'center', padding: 10, marginVertical: 12 },
  demoTag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.faint, textTransform: 'uppercase' },
  demoText: { fontSize: 12, color: colors.muted, marginTop: 4, textAlign: 'center' },
  bannerWrap: { alignItems: 'center', marginVertical: 14 },
  smallTag: { fontSize: 10, fontWeight: '700', color: colors.faint, marginBottom: 4, letterSpacing: 0.6 },
  smallTagInline: { fontSize: 11, color: colors.faint, marginTop: 2 },
  feedCard: { backgroundColor: colors.surface, marginVertical: 6, padding: 12, borderRadius: 0 },
  // reader look (website articles): ivory paper card with a gold rule, Playfair headline, DM Sans text
  articleCard: { backgroundColor: colors.surface, marginVertical: 18, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, borderTopWidth: 3, borderTopColor: '#F4D88C' },
  articleHeadline: { fontFamily: 'Playfair-SemiBold', fontSize: 17, color: colors.fg },
  articleCta: { marginTop: 12, alignSelf: 'flex-start', overflow: 'hidden', backgroundColor: '#FF6B1A', color: '#FFFFFF', fontFamily: 'DMSans-Bold', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  nativeHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  nativeIcon: { width: 36, height: 36, borderRadius: 8 },
  nativeHeadline: { fontSize: 15, fontWeight: '700', color: colors.fg },
  nativeBody: { fontSize: 14, color: colors.fg, marginBottom: 8 },
  nativeMedia: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden' },
  nativeCta: { marginTop: 10, alignSelf: 'flex-start', overflow: 'hidden', backgroundColor: colors.primary, color: '#FFFFFF', fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
});
