// MEMBER WEBSITES: a member's website running inside Bible Nestra (react-native-webview).
// The site works as it does in a browser: links, forms, embedded videos (inline + full screen), cookies and
// its own ads. Links that open "a new window" load in the same view; mailto:/tel:/WhatsApp/app links go to
// the phone's apps; Google sign-in (blocked by Google inside app WebViews) and file downloads open in the browser.
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';

// Google refuses OAuth sign-in inside embedded WebViews ("disallowed_useragent") — hand those to the browser.
const BROWSER_ONLY = /^https:\/\/(accounts\.google\.com|accounts\.youtube\.com)\//i;
const DOWNLOAD = /\.(pdf|zip|apk|exe|dmg|docx?|xlsx?|pptx?|mp3|m4a|wav)(\?|#|$)/i;

const WebsiteFrame = forwardRef(function WebsiteFrame({ url, onNav, onProgress, onFail, onLoaded }, ref) {
  const web = useRef(null);
  useImperativeHandle(ref, () => ({
    goBack: () => web.current && web.current.goBack(),
    goForward: () => web.current && web.current.goForward(),
    reload: () => web.current && web.current.reload(),
  }));

  const onShouldStart = (req) => {
    const u = String(req.url || '');
    if (/^(about:|data:|blob:)/i.test(u)) return true;
    if (!/^https?:\/\//i.test(u)) {
      // mailto:, tel:, sms:, whatsapp:, intent:, market: … → the phone's own apps
      Linking.openURL(u.replace(/^intent:\/\//i, 'https://')).catch(() => {});
      return false;
    }
    if (BROWSER_ONLY.test(u) || (req.isTopFrame !== false && DOWNLOAD.test(u))) {
      WebBrowser.openBrowserAsync(u).catch(() => Linking.openURL(u).catch(() => {}));
      return false;
    }
    return true;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <WebView
        ref={web}
        source={{ uri: url }}
        style={{ flex: 1 }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically
        originWhitelist={['http://*', 'https://*', 'about:*', 'data:*', 'blob:*', 'mailto:*', 'tel:*', 'sms:*', 'whatsapp:*', 'intent:*']}
        onShouldStartLoadWithRequest={onShouldStart}
        onNavigationStateChange={(s) => onNav && onNav({ url: s.url, title: s.title, canGoBack: s.canGoBack, canGoForward: s.canGoForward, loading: s.loading })}
        onLoadProgress={(e) => onProgress && onProgress(e.nativeEvent.progress)}
        onLoadEnd={() => onLoaded && onLoaded()}
        onError={(e) => onFail && onFail((e.nativeEvent && e.nativeEvent.description) || 'This website couldn’t be opened')}
        onHttpError={(e) => { if (e.nativeEvent && e.nativeEvent.statusCode >= 500 && onFail) onFail(`The website answered with an error (${e.nativeEvent.statusCode})`); }}
        onFileDownload={(e) => { const u = e.nativeEvent && e.nativeEvent.downloadUrl; if (u) WebBrowser.openBrowserAsync(u).catch(() => {}); }}
        onRenderProcessGone={() => web.current && web.current.reload()}
        onContentProcessDidTerminate={() => web.current && web.current.reload()}
      />
    </View>
  );
});

export default WebsiteFrame;
