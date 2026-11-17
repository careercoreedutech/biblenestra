// Web frame for EmbedViewer: the provider's official embed in a plain <iframe>, filling its parent.
import React from 'react';
import { View } from 'react-native';

export default function EmbedFrame({ embedUrl, vertical }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      {React.createElement('iframe', {
        src: embedUrl,
        title: 'Embedded video',
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowFullScreen: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        style: { border: 0, width: '100%', height: '100%', maxWidth: vertical ? 'min(100%, 56.25vh)' : undefined, background: '#000' },
      })}
    </View>
  );
}
