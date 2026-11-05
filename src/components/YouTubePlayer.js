// In-app YouTube player (native): a WebView hosting the official embed via the IFrame API.
// The page is given an https baseUrl so YouTube sees a proper origin/referrer (embeds refuse to play without one).
// If the video can't be embedded (owner disabled it, nothing live, error) we show "Watch on YouTube".
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Icon } from './Icons';
import { colors, fonts } from '../theme';

const ORIGIN = 'https://biblenestra.app';

function html(embedUrl) {
  const sep = embedUrl.includes('?') ? '&' : '?';
  const src = `${embedUrl}${sep}enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(ORIGIN)}`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head>
<body><iframe id="yt" src="${src.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} }
window.onYouTubeIframeAPIReady = function(){ try { new YT.Player('yt', { events: { onReady: function(){ post({ type: 'ready' }); }, onError: function(e){ post({ type: 'error', code: e.data }); } } }); } catch(e){} };
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}

export default function YouTubePlayer({ embedUrl, watchUrl, style, live }) {
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => ({ html: html(embedUrl), baseUrl: ORIGIN }), [embedUrl]);
  const open = () => Linking.openURL(watchUrl).catch(() => {});
  return (
    <View style={[styles.frame, style]}>
      {failed ? (
        <View style={styles.fallback}>
          <Icon name="video" size={26} color={colors.goldLight} />
          <Text style={styles.fallbackTitle}>{live ? 'Not live right now' : 'This video can’t play here'}</Text>
          <Pressable onPress={open} style={styles.fallbackBtn} accessibilityRole="link"><Text style={styles.fallbackBtnText}>Watch on YouTube</Text></Pressable>
        </View>
      ) : (
        <WebView
          key={embedUrl}
          source={source}
          style={{ flex: 1, backgroundColor: '#000' }}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          originWhitelist={['*']}
          onMessage={(e) => { try { const m = JSON.parse(e.nativeEvent.data); if (m.type === 'error') setFailed(true); } catch (err) { /* ignore */ } }}
          onError={() => setFailed(true)}
          onShouldStartLoadWithRequest={(req) => {
            // keep the embed inside; links to youtube.com (title, logo) open the YouTube app/browser
            if (/^https:\/\/(www\.)?youtube\.com\/(watch|channel|@|shorts)/.test(req.url) && req.isTopFrame !== false && req.navigationType === 'click') { Linking.openURL(req.url).catch(() => {}); return false; }
            return true;
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.night, padding: 16 },
  fallbackTitle: { fontFamily: fonts.serifBold, fontSize: 17, color: colors.nightFg },
  fallbackBtn: { marginTop: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.goldLight },
  fallbackBtnText: { fontSize: 13.5, fontWeight: '700', color: colors.night },
});
