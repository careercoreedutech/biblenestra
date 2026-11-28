// APPEARANCE (dev update v1, item 14): read/save the Light / Dark / System preference and apply it.
// The palette itself is chosen at boot (src/boot/Boot.js) because StyleSheets are built when modules load.
import { Appearance, DevSettings, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APPEARANCE_KEY, APPEARANCE_OPTIONS, APPEARANCE_DEFAULT } from './palette';

export async function readAppearancePref() {
  try {
    const v = await AsyncStorage.getItem(APPEARANCE_KEY);
    return APPEARANCE_OPTIONS.includes(v) ? v : APPEARANCE_DEFAULT;
  } catch (e) {
    return APPEARANCE_DEFAULT;
  }
}

/** 'light' | 'dark' for a stored preference; 'system' follows the phone. */
export function schemeFor(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  let os = null;
  try { os = Appearance.getColorScheme(); } catch (e) { os = null; }
  return os === 'dark' ? 'dark' : 'light';
}

export async function saveAppearancePref(pref) {
  await AsyncStorage.setItem(APPEARANCE_KEY, pref);
}

/**
 * Reload so every StyleSheet picks up the new palette.
 * Returns 'reloaded' (web, or a dev build) or 'restart' (a production native build cannot reload itself;
 * expo-updates is not installed, so the caller should tell the user "Restart the app to apply").
 */
export function reloadToApply() {
  if (Platform.OS === 'web') {
    try { window.location.reload(); } catch (e) { return 'restart'; }
    return 'reloaded';
  }
  if (__DEV__ && DevSettings && typeof DevSettings.reload === 'function') {
    DevSettings.reload();
    return 'reloaded';
  }
  return 'restart';
}

/** Store the choice, then reload. Resolves to 'reloaded' or 'restart'. */
export async function setAppearance(pref) {
  if (!APPEARANCE_OPTIONS.includes(pref)) return 'restart';
  await saveAppearancePref(pref);
  return reloadToApply();
}

