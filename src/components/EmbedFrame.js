// Native frame for EmbedViewer: a WebView hosting the provider's official embed in an iframe
// (an https baseUrl gives the embed a proper origin/referrer). Fills its parent.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

const ORIGIN = 'https://biblenestra.app';
const page = (src, vertical) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center}
iframe{border:0;width:100%;height:100%}${vertical ? 'iframe{max-width:56.25vh}' : ''}</style></head>
<body><iframe src="${src.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;

export default function EmbedFrame({ embedUrl, vertical, onFail }) {
  const source = useMemo(() => ({ html: page(embedUrl, vertical), baseUrl: ORIGIN }), [embedUrl, vertical]);
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <WebView
        source={source}
        style={{ flex: 1, backgroundColor: '#000' }}
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        originWhitelist={['*']}
        onError={() => onFail && onFail()}
      />
    </View>
  );
}
