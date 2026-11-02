// Auth gate + API context.
//
//   <AuthGate>{app}</AuthGate>
//     local       → renders the app as before (no API)
//     dev-online  → renders the app; requests carry `X-Dev-User: <id>` (Worker with AUTH_DEV_MODE=true)
//     online      → ClerkProvider (SecureStore token cache): signed out → <SignInScreen/>, signed in → the app
//
//   const api = useApi();  // { mode, online, request(method, path, body), email, signOut }
//   request() throws ApiError (with `.code`) on `{ error, code }` responses — see ./client.js
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { API_CONFIG } from './config';
import { createRequest } from './client';
import { colors } from '../theme';

const ApiCtx = createContext(null);

const LOCAL_API = {
  mode: 'local',
  online: false,
  request: async () => {
    throw new Error('The app is running in local mode (no API configured)');
  },
  email: null,
  signOut: async () => {},
};

export function useApi() {
  return useContext(ApiCtx) || LOCAL_API;
}

function DevApiProvider({ children }) {
  const value = useMemo(() => ({
    mode: 'dev-online',
    online: true,
    request: createRequest({ apiUrl: API_CONFIG.apiUrl, devUser: API_CONFIG.devUser }),
    email: `${API_CONFIG.devUser} (dev user)`,
    devUser: API_CONFIG.devUser,
    signOut: async () => {},
  }), []);
  return <ApiCtx.Provider value={value}>{children}</ApiCtx.Provider>;
}

function Spinner() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

// Clerk is only loaded in online mode, so local builds never evaluate it.
/* eslint-disable global-require */
const Clerk = API_CONFIG.mode === 'online' ? require('@clerk/clerk-expo') : null;
const clerkTokenCache = API_CONFIG.mode === 'online' ? require('./tokenCache').tokenCache : undefined;
/* eslint-enable global-require */

// Signed-in bridge: exposes an authed request() built on Clerk's getToken()
function ClerkBridge({ children }) {
  const { getToken, signOut } = Clerk.useAuth();
  const { user } = Clerk.useUser();
  const request = useMemo(() => createRequest({ apiUrl: API_CONFIG.apiUrl, getToken: () => getToken() }), [getToken]);
  const doSignOut = useCallback(() => signOut(), [signOut]);
  const email = user && user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : null;
  const clerkName = user ? user.fullName || user.firstName || user.username || null : null;
  const value = useMemo(
    () => ({ mode: 'online', online: true, request, email, clerkName, clerkUserId: user ? user.id : null, signOut: doSignOut }),
    [request, email, clerkName, user && user.id, doSignOut],
  );
  return <ApiCtx.Provider value={value}>{children}</ApiCtx.Provider>;
}

function ClerkGate({ children }) {
  // eslint-disable-next-line global-require
  const SignInScreen = require('../screens/SignInScreen').default;
  const { ClerkProvider, ClerkLoaded, ClerkLoading, SignedIn, SignedOut } = Clerk;
  return (
    <ClerkProvider publishableKey={API_CONFIG.clerkKey} tokenCache={clerkTokenCache}>
      <ClerkLoading><Spinner /></ClerkLoading>
      <ClerkLoaded>
        <SignedIn><ClerkBridge>{children}</ClerkBridge></SignedIn>
        <SignedOut><SignInScreen /></SignedOut>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

export function AuthGate({ children }) {
  if (API_CONFIG.mode === 'online') return <ClerkGate>{children}</ClerkGate>;
  if (API_CONFIG.mode === 'dev-online') return <DevApiProvider>{children}</DevApiProvider>;
  return children;
}
