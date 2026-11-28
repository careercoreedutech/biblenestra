// MEMBER WEBSITES (web version of the app): the website in an <iframe>. Many sites refuse to be shown inside
// another page (X-Frame-Options / CSP), and the browser gives no reliable signal, so the viewer always offers
// "Open in a new tab" on the web.
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { colors } from '../theme'; // APPEARANCE (item 14): palette tokens

const WebsiteFrame = forwardRef(function WebsiteFrame({ url, onLoaded }, ref) {
  const frame = useRef(null);
  useImperativeHandle(ref, () => ({
    goBack: () => {},
    goForward: () => {},
    reload: () => { try { if (frame.current) frame.current.src = url; } catch (e) { /* ignore */ } },
  }));
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceWhite }}>
      {React.createElement('iframe', {
        ref: frame,
        src: url,
        title: 'Website',
        onLoad: () => onLoaded && onLoaded(),
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write',
        allowFullScreen: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        style: { border: 0, width: '100%', height: '100%', background: '#FFFFFF' },
      })}
    </View>
  );
});

export default WebsiteFrame;
