// PDF reader (phones): the Worker's pdf.js page (/library/viewer) inside a WebView. Android's WebView can't
// show PDFs by itself, so pdf.js renders the pages; it loads the book with HTTP Range requests (only the pages
// being read are downloaded) and reports the current page back for "continue where you left off".
//   <PdfReader url={viewerUrl} onPage={(page, pages) => …} onReady={(page, pages) => …} onError={(msg) => …} />
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../../theme';

export function handleViewerMessage(raw, { onPage, onReady, onError }) {
  let d = raw;
  try { if (typeof raw === 'string') d = JSON.parse(raw); } catch (e) { return; }
  if (!d || d.source !== 'bn-pdf') return;
  if (d.type === 'page' && onPage) onPage(d.page, d.pages);
  if (d.type === 'ready' && onReady) onReady(d.page, d.pages);
  if (d.type === 'error' && onError) onError(d.message);
}

export default function PdfReader({ url, onPage, onReady, onError, style }) {
  const origin = (String(url).match(/^https?:\/\/[^/]+/) || [''])[0];
  return (
    <View style={[styles.wrap, style]}>
      <WebView
        source={{ uri: url }}
        originWhitelist={[origin, 'https://cdnjs.cloudflare.com']}
        onMessage={(e) => handleViewerMessage(e.nativeEvent.data, { onPage, onReady, onError })}
        startInLoadingState
        renderLoading={() => <View style={styles.loading}><ActivityIndicator color={colors.goldLight} /></View>}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures={false}
        onShouldStartLoadWithRequest={(req) => req.url.startsWith(origin) || req.url === 'about:blank'}
        style={{ backgroundColor: '#2B2A33' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#2B2A33' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B2A33' },
});
