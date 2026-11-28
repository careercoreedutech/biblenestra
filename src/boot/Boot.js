// APPEARANCE (dev update v1, item 14): the real app entry. It reads the saved Light / Dark / System choice and
// sets the palette BEFORE App (and so every screen and StyleSheet) is required. Only imports the leaf modules.
import React, { useEffect, useState } from 'react';
import { Alert, Appearance, Platform, View } from 'react-native';
import { readAppearancePref, schemeFor, reloadToApply } from '../design/appearance';
import { setResolvedScheme, isDarkScheme } from '../design/palette';

export default function Boot() {
  const [boot, setBoot] = useState(null); // { App, pref, scheme }

  useEffect(() => {
    let alive = true;
    (async () => {
      const pref = await readAppearancePref();
      const scheme = schemeFor(pref);
      setResolvedScheme(scheme);
      // Required lazily so the palette above is in place before any screen module creates its styles.
      const App = require('../../App').default;
      if (alive) setBoot({ App, pref, scheme });
    })();
    return () => { alive = false; };
  }, []);

  // 'System default': when the phone switches light/dark, offer to apply it (never reload without asking).
  useEffect(() => {
    if (!boot || boot.pref !== 'system') return undefined;
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      const next = colorScheme === 'dark' ? 'dark' : 'light';
      if (next === boot.scheme) return;
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.confirm && window.confirm('The phone switched theme. Apply it to BibleNestra now?')) reloadToApply();
        return;
      }
      Alert.alert('Theme changed', 'Apply the phone\u2019s theme to BibleNestra?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Apply', onPress: () => { if (reloadToApply() === 'restart') Alert.alert('Restart the app to apply', 'Close BibleNestra and open it again.'); } },
      ]);
    });
    return () => { if (sub && typeof sub.remove === 'function') sub.remove(); };
  }, [boot]);

  if (!boot) {
    // Same page colour as the chosen palette, so there is no flash before the app appears.
    return <View style={{ flex: 1, backgroundColor: isDarkScheme() ? '#14100D' : '#F8F1E7' }} />;
  }
  const App = boot.App;
  return <App />;
}
