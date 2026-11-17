// A still frame for a video WITHOUT creating a player (players hold a hardware decoder each on Android —
// mounting one per feed card / reel tile is what starved the player the user actually tapped).
//   poster URL → <Image>;  web without poster → <video preload="metadata"> (first frame, no decoder kept);
//   native without poster → a frame grabbed once with expo-video-thumbnails (cached per URL).
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { IS_WEB } from './videoUtils';

const frames = new Map(); // videoUrl → Promise<uri|null>
function nativeFrame(url) {
  if (!frames.has(url)) {
    frames.set(url, VideoThumbnails.getThumbnailAsync(url, { time: 800, quality: 0.6 }).then((r) => (r && r.uri) || null).catch(() => null));
  }
  return frames.get(url);
}

export default function VideoPoster({ videoUrl, poster, style, fit = 'cover' }) {
  const [frame, setFrame] = useState(null);
  useEffect(() => {
    let alive = true;
    setFrame(null);
    if (!poster && videoUrl && !IS_WEB) nativeFrame(videoUrl).then((u) => { if (alive) setFrame(u); });
    return () => { alive = false; };
  }, [poster, videoUrl]);

  const uri = poster || frame;
  if (uri) return <Image source={{ uri }} style={[StyleSheet.absoluteFill, style]} resizeMode={fit === 'contain' ? 'contain' : 'cover'} />;
  if (IS_WEB && videoUrl) {
    return (
      <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
        {React.createElement('video', {
          src: `${videoUrl}#t=0.5`,
          preload: 'metadata',
          muted: true,
          playsInline: true,
          disablePictureInPicture: true,
          tabIndex: -1,
          style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: fit, display: 'block', pointerEvents: 'none', backgroundColor: 'transparent' },
        })}
      </View>
    );
  }
  return null;
}
