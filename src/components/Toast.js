// App-wide confirmation toasts + light haptics, so every action gives feedback.
// const toast = useToast(); toast.show('Saved to library', { icon: 'bookmark', action: { label: 'Undo', onPress } })
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow } from '../theme';
import { Icon } from './Icons';
import { useNarration } from '../audio/Narration';

let Haptics = null;
try { Haptics = require('expo-haptics'); } catch (e) { Haptics = null; }

export function haptic(kind = 'light') {
  if (!Haptics || Platform.OS === 'web') return;
  try {
    if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (kind === 'select') Haptics.selectionAsync();
    else Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  } catch (e) { /* haptics unavailable */ }
}

const ToastCtx = createContext({ show: () => {}, hide: () => {} });

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const nar = useNarration();
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    Animated.timing(anim, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback((message, opts = {}) => {
    clearTimeout(timer.current);
    setToast({ message, ...opts, key: Date.now() });
    haptic(opts.haptic || (opts.tone === 'error' ? 'warning' : 'light'));
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 90 }).start();
    timer.current = setTimeout(hide, opts.duration || (opts.action ? 4200 : 2400));
  }, [anim, hide]);

  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            nar.active && { bottom: 170 },
            { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
          ]}
        >
          <View style={[styles.toast, toast.tone === 'error' && { backgroundColor: colors.negative }]}>
            <View style={styles.iconDot}>
              <Icon name={toast.icon || (toast.tone === 'error' ? 'x' : 'check')} size={14} color={colors.night} strokeWidth={2.6} />
            </View>
            <Text style={styles.text} numberOfLines={2}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                hitSlop={8}
                onPress={() => { hide(); toast.action.onPress && toast.action.onPress(); }}
                style={styles.actionBtn}
              >
                <Text style={styles.actionText}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 104, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 440,
    alignSelf: 'stretch',
    backgroundColor: colors.night,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 14,
    ...shadow.lg,
  },
  iconDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, color: colors.nightFg, fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  actionText: { color: colors.goldLight, fontSize: 13, fontWeight: '800' },
});
