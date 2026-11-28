// PAYMENT VERIFICATION (client brief 6.1 / 6.3): "Report a payment" and membership invitation links.
// Backend: backend/src/routes/paymentReports.js. Receipts are uploaded as private images (never public).
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { prepareImage } from './media';
import { ApiError } from './client';

const IS_WEB = Platform.OS === 'web';

/** One receipt screenshot → { key } (a private R2 key; it confirms nothing by itself). */
export async function uploadReceipt(request, photo) {
  const img = await prepareImage(photo);
  if (IS_WEB) {
    const blob = await (await fetch(img.uri)).blob();
    return request('POST', '/payments/report/receipt', blob, { headers: { 'Content-Type': img.mimeType || blob.type || 'image/jpeg' }, timeout: 60000 });
  }
  const headers = { ...(await request.authHeaders()), 'Content-Type': img.mimeType || 'image/jpeg', Accept: 'application/json' };
  let res;
  try {
    res = await FileSystem.uploadAsync(request.apiUrl + '/payments/report/receipt', img.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
    });
  } catch (e) {
    throw new ApiError('Couldn’t upload your receipt — check your connection', { code: 'NETWORK' });
  }
  let data = null;
  try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError((data && data.error) || `Upload failed (${res.status})`, { code: (data && data.code) || `HTTP_${res.status}`, status: res.status });
  }
  return data;
}

export const reportOptions = (api) => api.request('GET', '/payments/report-options');
export const myPaymentReports = (api) => api.request('GET', '/payments/reports');
export const submitPaymentReport = (api, body) => api.request('POST', '/payments/reports', body);
export const invitePreview = (api, token) => api.request('GET', `/membership-invites/${encodeURIComponent(token)}/preview`);
export const acceptInvite = (api, token) => api.request('POST', `/membership-invites/${encodeURIComponent(token)}/accept`);

/** biblenestra://membership-invite?token=… → the token (or null). */
export function parseMembershipInviteLink(url) {
  const m = /^biblenestra:\/\/membership-invite\?token=([A-Za-z0-9_-]{20,80})/.exec(String(url || '').trim());
  return m ? m[1] : null;
}
