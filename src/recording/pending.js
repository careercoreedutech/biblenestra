// Sermon Studio takes are written to the app's document directory first (the expo-av cache can be purged by the OS),
// and listed in pending.json until they are safely uploaded (cloud) or shown in the local list (device-only).
// Kept free of React and of the API client so the recorder store and the API layer can both use it.
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const IS_WEB = Platform.OS === 'web';
const DIR = !IS_WEB && FileSystem.documentDirectory ? `${FileSystem.documentDirectory}recordings/` : null;
const INDEX = DIR ? `${DIR}pending.json` : null;

async function readIndex() {
  if (!INDEX) return [];
  try {
    const v = JSON.parse(await FileSystem.readAsStringAsync(INDEX));
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

async function writeIndex(list) {
  if (!INDEX) return;
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(list));
  } catch (e) {
    // Storage full or unavailable: the audio file itself is still on disk.
  }
}

/** Move a finished take from the temporary recording location into the documents folder. Falls back to the original URI. */
export async function persistTake(uri) {
  if (!uri || !DIR) return uri;
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    const ext = (/\.([a-z0-9]{2,5})(?:\?|$)/i.exec(uri) || [])[1] || 'm4a';
    const dest = `${DIR}take-${Date.now()}.${ext}`;
    await FileSystem.moveAsync({ from: uri, to: dest });
    return dest;
  } catch (e) {
    return uri;
  }
}

/** Add or replace a pending take. kind: 'cloud' (upload then remove) or 'local' (show in the device list). */
export async function addPending(entry) {
  const list = (await readIndex()).filter((x) => x.uri !== entry.uri);
  list.push({ ...entry, savedAt: entry.savedAt || new Date().toISOString() });
  await writeIndex(list);
  return entry;
}

export const listPending = readIndex;

/** Forget a pending take and delete its file (only files inside the recordings folder are removed). */
export async function removePending(uri) {
  const list = (await readIndex()).filter((x) => x.uri !== uri);
  await writeIndex(list);
  if (DIR && uri && uri.startsWith(DIR)) {
    try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (e) { /* already gone */ }
  }
}

/** Drop a pending entry but keep its file (a device take that now lives in the app's recording list). */
export async function forgetPending(uri) {
  const list = (await readIndex()).filter((x) => x.uri !== uri);
  await writeIndex(list);
}

/** Delete a take's file without touching the pending list (used when the user discards a take). */
export async function deleteTakeFile(uri) {
  if (!uri || !DIR || !uri.startsWith(DIR)) return;
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (e) { /* already gone */ }
}
