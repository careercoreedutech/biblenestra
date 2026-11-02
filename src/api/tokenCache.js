// Clerk token cache backed by expo-secure-store (Keychain / Keystore).
// On the web Clerk keeps its session in cookies, so no cache is passed there.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const tokenCache = Platform.OS === 'web'
  ? undefined
  : {
      async getToken(key) {
        try {
          return await SecureStore.getItemAsync(key);
        } catch (e) {
          // A corrupted entry (e.g. after a device restore) — drop it and sign in again.
          try { await SecureStore.deleteItemAsync(key); } catch (err) { /* ignore */ }
          return null;
        }
      },
      async saveToken(key, value) {
        try { await SecureStore.setItemAsync(key, value); } catch (e) { /* ignore */ }
      },
      async clearToken(key) {
        try { await SecureStore.deleteItemAsync(key); } catch (e) { /* ignore */ }
      },
    };
