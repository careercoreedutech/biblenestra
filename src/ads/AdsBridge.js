// Gives the ads layer an authenticated request() for POST /ads/events. Rendered inside the API/auth
// providers (App.js → SyncProvider). Renders nothing. In local mode no events are sent.
import { useEffect } from 'react';
import { useApi } from '../api/auth';
import { setAdsTransport } from './remote';

export function AdsBridge() {
  const api = useApi();
  useEffect(() => {
    if (!api || !api.online) { setAdsTransport(null); return undefined; }
    setAdsTransport((method, path, body) => api.request(method, path, body, { timeout: 15000 }));
    return () => setAdsTransport(null);
  }, [api && api.online, api && api.request]);
  return null;
}

export default AdsBridge;
