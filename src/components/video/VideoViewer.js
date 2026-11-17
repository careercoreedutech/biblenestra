// Full-screen video viewer (TikTok-style): edge to edge, black, status bar hidden, the tapped video plays
// at once; swipe up / down for next / previous, tap to pause, double-tap to like, Android back / Escape /
// the close button closes it. On wide (desktop) screens portrait clips sit in a centred 9:16 column and
// landscape videos use the full width (see VideoPager).
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../Icons';
import VideoPager from './VideoPager';

export default function VideoViewer({ visible, items, index = 0, onIndexChange, onClose, paused, renderOverlay, onDoubleTap, testID = 'video-viewer' }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [chrome, setChrome] = useState(true);
  useEffect(() => { if (visible) setChrome(true); }, [visible]);
  if (!visible) return null;
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden barStyle="light-content" backgroundColor="#000" animated />
      <View style={styles.root} testID={testID}>
        <VideoPager
          items={items}
          index={index}
          onIndexChange={onIndexChange}
          width={width}
          height={height}
          active
          paused={paused}
          renderOverlay={renderOverlay}
          onDoubleTap={onDoubleTap}
          onChromeChange={setChrome}
          onClose={onClose}
          topInset={Math.max(insets.top, 8) + 48}
          bottomInset={Math.max(insets.bottom, 6)}
          keyboard
        />
        <View style={[styles.top, { top: Math.max(insets.top, 8) + 4, opacity: chrome ? 1 : 0.55 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close video" testID="video-close">
            <Icon name="chevron-left" size={22} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', zIndex: 50 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' },
});
