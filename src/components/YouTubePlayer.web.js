// In-app YouTube player (web preview): a plain <iframe> with the official embed.
import React from 'react';
import { StyleSheet, View } from 'react-native';

export default function YouTubePlayer({ embedUrl, style }) {
  const sep = embedUrl.includes('?') ? '&' : '?';
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  const src = `${embedUrl}${sep}playsinline=1&rel=0&modestbranding=1${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`;
  return (
    <View style={[styles.frame, style]}>
      {React.createElement('iframe', {
        src,
        title: 'YouTube video player',
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowFullScreen: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden', position: 'relative' },
});
