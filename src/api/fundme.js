// FUND ME (round 3) — API helpers for fundraisers. Online / dev-online: talks to the Worker
// (backend/src/routes/fundme.js). Local mode: an in-memory demo with a seeded sample fundraiser so the screens
// can be reviewed offline (nothing leaves the device, no money moves).
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { useMemo } from 'react';
import { useApi } from './auth';
import { ApiError } from './client';
import { uploadImage as uploadPhoto } from './media';

const IS_WEB = Platform.OS === 'web';

// ---------- money ----------
export const CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN'];
export const SYMBOL = { GBP: '£', USD: '$', EUR: '€', NGN: '₦', CAD: 'CA$', GHS: 'GH₵', KES: 'KSh ', ZAR: 'R ' };
/** The device's likely currency (donor default) from its locale region, else null. */
export function localeCurrency() {
  let loc = '';
  try { loc = Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch (e) { loc = ''; }
  const region = (loc.split('-').pop() || '').toUpperCase();
  const BY_REGION = { NG: 'NGN', GB: 'GBP', US: 'USD', CA: 'CAD', GH: 'GHS', KE: 'KES', ZA: 'ZAR', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', PT: 'EUR', AT: 'EUR', FI: 'EUR' };
  return BY_REGION[region] || null;
}
export const CURRENCY_NAME = { GBP: 'British pound', USD: 'US dollar', EUR: 'Euro', NGN: 'Nigerian naira' };
export const LIMITS = {
  GBP: { min: 100, max: 1000000, goalMax: 100000000, presets: [1000, 2500, 5000, 10000] },
  USD: { min: 100, max: 1000000, goalMax: 100000000, presets: [1000, 2500, 5000, 10000] },
  EUR: { min: 100, max: 1000000, goalMax: 100000000, presets: [1000, 2500, 5000, 10000] },
  NGN: { min: 50000, max: 500000000, goalMax: 50000000000, presets: [200000, 500000, 1000000, 2500000] },
};

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** 200000,'GBP' → '£2,000'; 1050 → '£10.50' */
export function formatMoney(minor, currency, { cents = false } = {}) {
  const n = Math.round(Number(minor) || 0);
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${n < 0 ? '-' : ''}${SYMBOL[currency] || ''}${group(String(whole))}${frac || cents ? `.${String(frac).padStart(2, '0')}` : ''}`;
}
/** '5,000.5' → 500050 (minor units); NaN when not a number */
export function toMinor(text) {
  const t = String(text || '').replace(/[,\s£$€₦]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
}
export const minorToText = (m) => (m ? String(m % 100 ? (m / 100).toFixed(2) : m / 100) : '');

export const STATUS_LABEL = {
  draft: 'Draft', pending_review: 'In review', live: 'Live', paused: 'Paused', closed: 'Closed', rejected: 'Needs changes',
};

// ---------- change notifications (lists refresh after edits / donations) ----------
const listeners = new Set();
export function onFundMeChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const changed = () => listeners.forEach((cb) => { try { cb(); } catch (e) { /* ignore */ } });

// ---------- PDF picking / upload ----------
/** Pick one PDF → { uri, name, size, mimeType, file? } | null */
export async function pickPdf() {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0];
  if (a.size && a.size > 10 * 1024 * 1024) throw new ApiError('Documents must be under 10 MB', { code: 'TOO_LARGE' });
  return { uri: a.uri, name: a.name || 'document.pdf', size: a.size || 0, mimeType: a.mimeType || 'application/pdf', file: a.file || null };
}

async function uploadPdf(request, doc) {
  // file name goes in the query string (a custom header would need a CORS allow-list entry)
  const headers = { 'Content-Type': 'application/pdf' };
  const path = `/uploads/document?name=${encodeURIComponent(doc.name || 'document.pdf')}`;
  if (IS_WEB) {
    const blob = doc.file || (await (await fetch(doc.uri)).blob());
    return request('POST', path, blob, { headers, timeout: 60000 });
  }
  let res;
  try {
    res = await FileSystem.uploadAsync(`${request.apiUrl}${path}`, doc.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...(await request.authHeaders()), ...headers, Accept: 'application/json' },
    });
  } catch (e) {
    throw new ApiError('Couldn’t upload the document — check your connection', { code: 'NETWORK' });
  }
  let data = null;
  try { data = JSON.parse(res.body); } catch (e) { data = null; }
  if (res.status < 200 || res.status >= 300) throw new ApiError((data && data.error) || `Upload failed (${res.status})`, { code: (data && data.code) || 'UPLOAD_FAILED', status: res.status });
  return data;
}

// ---------- online client ----------
function onlineClient(request) {
  const r = (m, p, b) => request(m, p, b);
  const mut = async (m, p, b) => { const out = await r(m, p, b); changed(); return out; };
  return {
    online: true,
    demo: false,
    discover: (cursor) => r('GET', `/fundraisers?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    mine: () => r('GET', '/me/fundraisers'),
    get: (id) => r('GET', `/fundraisers/${id}`),
    create: (body) => mut('POST', '/fundraisers', body),
    update: (id, body) => mut('PATCH', `/fundraisers/${id}`, body),
    submit: (id) => mut('POST', `/fundraisers/${id}/submit`),
    pause: (id) => mut('POST', `/fundraisers/${id}/pause`),
    resume: (id) => mut('POST', `/fundraisers/${id}/resume`),
    close: (id) => mut('POST', `/fundraisers/${id}/close`),
    donations: (id) => r('GET', `/fundraisers/${id}/donations`),
    donate: (slug, body) => r('POST', `/f/${slug}/donations`, body),
    donationStatus: (slug, donationId) => r('GET', `/f/${slug}/donations/${donationId}`),
    uploadImage: (photo) => uploadPhoto(request, photo),
    uploadPdf: (doc) => uploadPdf(request, doc),
    notifyChanged: changed,
    // FUND ME MONEY (monetisation stage 2): credits, gifting credits, receipts, payouts (backend/src/routes/fundmeMoney.js)
    credits: () => r('GET', '/fundme/credits'),
    creditHistory: (cursor) => r('GET', `/fundme/credits/history?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    members: (q) => r('GET', `/fundme/members?q=${encodeURIComponent(q)}`),
    giftCredits: (body) => r('POST', '/fundme/credits/gift', body),
    rules: () => r('GET', '/fundme/rules'),
    myDonations: () => r('GET', '/fundme/donations/mine'),
    receipt: (donationId) => r('GET', `/fundme/donations/${donationId}/receipt`),
    money: (id) => r('GET', `/fundme/fundraisers/${id}/money`),
    banks: () => r('GET', '/fundme/banks'),
    payoutAccount: () => r('GET', '/fundme/payout-account'),
    resolveAccount: (body) => r('POST', '/fundme/payout-account/resolve', body),
    savePayoutAccount: (body) => mut('PUT', '/fundme/payout-account', body),
    // Client answers: fee / currency quote before checkout, and payout KYC (Fund Me payouts + gift withdrawals)
    quote: (slug, { amountMinor, currency, coverFees }) => r('GET', `/f/${slug}/donation-quote?amountMinor=${amountMinor}&currency=${encodeURIComponent(currency)}&coverFees=${coverFees ? 'true' : 'false'}`),
    kyc: () => r('GET', '/payout-kyc'),
    saveKyc: (body) => r('PUT', '/payout-kyc', body),
  };
}

// FUND ME MONEY: donation statuses (spec §3) in plain words for donors and organisers.
export const DONATION_STATUS = {
  pending: { label: 'Waiting for payment', tint: '#8A8172' },
  processing: { label: 'Received — being checked', tint: '#A87A27' },
  under_review: { label: 'Under review', tint: '#B5523B' },
  verified: { label: 'Verified', tint: '#2E7D5B' },
  approved_for_payout: { label: 'Approved for payout', tint: '#2E7D5B' },
  paid: { label: 'Paid out', tint: '#2E7D5B' },
  failed: { label: 'Failed', tint: '#B5523B' },
  refunded: { label: 'Refunded', tint: '#8A8172' },
};
export const PAYOUT_STATUS = {
  requested: { label: 'Requested', tint: '#8A8172' }, under_review: { label: 'Under review', tint: '#B5523B' },
  approved: { label: 'Approved — being sent', tint: '#A87A27' }, processing: { label: 'Sending', tint: '#A87A27' },
  paid: { label: 'Paid', tint: '#2E7D5B' }, failed: { label: 'Didn’t go through', tint: '#B5523B' }, cancelled: { label: 'Cancelled', tint: '#8A8172' },
};
/** Received by BibleNestra (the gateway confirmed it): anything past "pending". */
export const isReceived = (s) => !!s && (s.status === 'succeeded' || ['processing', 'verified', 'under_review', 'approved_for_payout', 'paid'].includes(s.settlementStatus));
export const HELD_EXPLAINER = 'Donations are paid to BibleNestra through our payment partner, held safely, checked, and then paid out to the organiser’s verified bank account. They never go straight to a personal account.';

// ---------- local demo ----------
const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1000&q=75`;
let seq = 0;
const lid = () => `demo-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const now = () => new Date().toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

function demoSeed() {
  return [
    {
      id: 'demo-hospital', slug: 'help-me-pay-my-hospital-bill-demo', title: 'Help Me Pay My Hospital Bill', ownerIsMe: true,
      currency: 'GBP', goalMinor: 500000, raisedMinor: 200000, donorsCount: 4, status: 'live',
      mainImageUrl: U('1584515933487-779824d29309'),
      story: [
        { type: 'p', text: 'In September my mother, Ruth, was admitted to hospital after a sudden heart complication. The doctors acted quickly and, by God’s grace, she is now recovering at home.' },
        { type: 'p', text: 'The treatment and two weeks of care came to just under £5,000. As a family we have given what we can, but we are still far from covering the bill.' },
        { type: 'img', key: 'demo', url: U('1519494026892-80bbd2d6fd0d'), caption: 'The ward where Mum was cared for' },
        { type: 'p', text: 'Every gift — big or small — brings us closer. Thank you for standing with us in prayer and generosity. “Carry each other’s burdens” (Galatians 6:2).' },
      ],
      media: [
        { id: 'dm1', kind: 'image', url: U('1576091160399-112ba8d25d1d'), caption: 'Recovery day 3', visibility: 'public' },
        { id: 'dm2', kind: 'image', url: U('1532938911079-1b06ac7ceec7'), caption: null, visibility: 'public' },
        { id: 'dm3', kind: 'pdf', url: null, name: 'hospital-invoice.pdf', caption: 'Hospital invoice', visibility: 'public' },
        { id: 'dm4', kind: 'pdf', url: null, name: 'medical-report.pdf', caption: 'Medical report', visibility: 'private' },
      ],
      donations: [
        { name: 'The Okafor family', anonymous: false, amountMinor: 25000, currency: 'GBP', message: null, createdAt: ago(3) },
        { name: 'Carol', anonymous: false, amountMinor: 25000, currency: 'GBP', message: 'Sending love from Grace Chapel ❤️', createdAt: ago(9) },
        { name: 'Anonymous', anonymous: true, amountMinor: 50000, currency: 'GBP', message: 'Psalm 41:3 — The Lord sustains them on their sickbed.', createdAt: ago(20) },
        { name: 'Bob', anonymous: false, amountMinor: 100000, currency: 'GBP', message: 'Praying for Ruth’s full recovery. God is faithful!', createdAt: ago(30) },
      ],
      owner: { displayName: 'You', avatarUrl: null }, createdAt: ago(40),
    },
    {
      id: 'demo-education', slug: 'support-my-education-demo', title: 'Support My Education', ownerIsMe: false,
      currency: 'USD', goalMinor: 1200000, raisedMinor: 45000, donorsCount: 2, status: 'live',
      mainImageUrl: U('1503676260728-1c00da094a0b'),
      story: [{ type: 'p', text: 'I have been accepted to study nursing at a Christian college. I am raising funds for my first year of tuition and books so I can serve my community with compassion.' }],
      media: [{ id: 'de1', kind: 'image', url: U('1524178232363-1fb2b075b655'), caption: 'Orientation week', visibility: 'public' }],
      donations: [
        { name: 'Dave', anonymous: false, amountMinor: 30000, currency: 'USD', message: null, createdAt: ago(5) },
        { name: 'Alice', anonymous: false, amountMinor: 15000, currency: 'USD', message: 'So proud of you!', createdAt: ago(12) },
      ],
      owner: { displayName: 'Daniel A.', avatarUrl: null }, createdAt: ago(60),
    },
    {
      id: 'demo-ministry', slug: 'support-my-ministry-demo', title: 'Support My Ministry', ownerIsMe: false,
      currency: 'NGN', goalMinor: 250000000, raisedMinor: 162500000, donorsCount: 31, status: 'live',
      mainImageUrl: U('1438232992991-995b7058bbb3'),
      story: [{ type: 'p', text: 'We are planting a worship ministry in Enugu and need sound equipment and chairs for our first gathering place.' }],
      media: [], donations: [], owner: { displayName: 'Pastor Emeka', avatarUrl: null }, createdAt: ago(100),
    },
  ];
}
let DEMO = null;
const demoDb = () => { if (!DEMO) DEMO = demoSeed(); return DEMO; };

function demoShape(f) {
  const remaining = Math.max(0, f.goalMinor - f.raisedMinor);
  const r = LIMITS[f.currency];
  const own = f.ownerIsMe;
  return {
    ...f,
    url: `https://biblenestra.app/f/${f.slug}`,
    excerpt: (f.story.find((b) => b.type === 'p') || {}).text || '',
    remainingMinor: remaining,
    percent: f.goalMinor ? Math.floor((f.raisedMinor / f.goalMinor) * 100) : 0,
    donationsOpen: f.status === 'live', paymentsReady: true, provider: 'demo', testMode: true,
    presets: r.presets, minMinor: r.min, maxMinor: r.max,
    isOwner: own || undefined,
    media: own ? f.media : f.media.filter((m) => m.visibility === 'public'),
    donations: f.donations,
  };
}
const listOf = (f) => { const s = demoShape(f); delete s.story; delete s.donations; return s; };
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const notFound = () => new ApiError('Fundraiser not found', { code: 'NOT_FOUND', status: 404 });

const offline = async () => { throw new ApiError('Sign in to the online app to use this', { code: 'OFFLINE' }); };

function demoClient() {
  const find = (id) => { const f = demoDb().find((x) => x.id === id); if (!f) throw notFound(); return f; };
  const toBlocks = (story) => (story || []).map((b) => (b.type === 'img' ? { type: 'img', key: b.key, url: b.url || b.key, caption: b.caption } : { type: 'p', text: b.text }));
  const toMedia = (f, media) => (media || []).map((m) => {
    const prev = m.id && f && f.media.find((x) => x.id === m.id);
    return prev ? { ...prev, caption: m.caption || null, visibility: m.visibility || prev.visibility } : { id: lid(), kind: m.kind, url: m.url || m.key, name: m.name || null, caption: m.caption || null, visibility: m.visibility || (m.kind === 'pdf' ? 'private' : 'public') };
  });
  const apply = (f, b) => {
    if (b.title !== undefined) f.title = b.title.trim();
    if (b.goalMinor !== undefined) f.goalMinor = b.goalMinor;
    if (b.currency !== undefined) f.currency = b.currency;
    if (b.story !== undefined) f.story = toBlocks(b.story);
    if (b.mainImageKey !== undefined) f.mainImageUrl = b.mainImageUrl || b.mainImageKey;
    if (b.media !== undefined) f.media = toMedia(f, b.media);
  };
  const mut = (fn) => async (...a) => { await wait(250); const out = fn(...a); changed(); return out; };
  return {
    online: false,
    demo: true,
    discover: async () => { await wait(150); return { items: demoDb().filter((f) => f.status === 'live').map(listOf), cursor: null, hasMore: false }; },
    mine: async () => { await wait(150); return { items: demoDb().filter((f) => f.ownerIsMe).map(listOf) }; },
    get: async (id) => { await wait(120); return demoShape(find(id)); },
    create: mut((b) => {
      const f = { id: lid(), slug: `demo-${Date.now().toString(36)}`, ownerIsMe: true, currency: 'GBP', goalMinor: 100000, raisedMinor: 0, donorsCount: 0, status: 'draft', mainImageUrl: null, story: [], media: [], donations: [], owner: { displayName: 'You' }, createdAt: now() };
      apply(f, b);
      demoDb().unshift(f);
      return demoShape(f);
    }),
    update: mut((id, b) => { const f = find(id); apply(f, b); return demoShape(f); }),
    // the demo has no review team: submitting goes straight to "In review", and a moment later it's approved
    submit: mut((id) => {
      const f = find(id);
      f.status = 'pending_review';
      setTimeout(() => { if (f.status === 'pending_review') { f.status = 'live'; changed(); } }, 4000);
      return demoShape(f);
    }),
    pause: mut((id) => { const f = find(id); f.status = 'paused'; f.pausedBy = 'owner'; return demoShape(f); }),
    resume: mut((id) => { const f = find(id); f.status = 'live'; f.pausedBy = null; return demoShape(f); }),
    close: mut((id) => { const f = find(id); f.status = 'closed'; return demoShape(f); }),
    donations: async (id) => ({ items: find(id).donations.map((d, i) => ({ id: `${id}-${i}`, ...d, name: d.anonymous ? 'A. Supporter' : d.name, status: 'succeeded', completedAt: d.createdAt })) }),
    // Demo donation: recorded straight away (no checkout, no money)
    donate: async (slug, b) => {
      await wait(500);
      const f = demoDb().find((x) => x.slug === slug);
      if (!f) throw notFound();
      f.raisedMinor += b.amount_minor;
      f.donorsCount += 1;
      f.donations.unshift({ name: b.anonymous ? 'Anonymous' : b.donor_name || 'You', anonymous: !!b.anonymous, amountMinor: b.amount_minor, currency: f.currency, message: b.message || null, createdAt: now() });
      changed();
      return { donationId: lid(), checkoutUrl: null, provider: 'demo', status: 'succeeded' };
    },
    donationStatus: async () => ({ status: 'succeeded' }),
    uploadImage: async (photo) => { await wait(200); return { key: photo.uri, url: photo.uri }; },
    uploadPdf: async (doc) => { await wait(200); return { key: doc.uri, name: doc.name }; },
    notifyChanged: changed,
    // FUND ME MONEY — the demo has no wallet: credits show as free, money features need the online app
    credits: async () => ({ wallet: 'fundme_credits', balance: 0, cost: 0, reserved: 0, available: 0, limits: {}, usage: {}, giftMax: 0, demo: true, explain: 'Demo mode — publishing is free here. Online, publishing a request uses 1 Fund Me credit when it is approved.' }),
    creditHistory: async () => ({ items: [], nextCursor: null }),
    members: async () => ({ items: [] }),
    giftCredits: offline, rules: offline, receipt: offline, money: offline, banks: offline, payoutAccount: offline, resolveAccount: offline, savePayoutAccount: offline,
    quote: offline, kyc: offline, saveKyc: offline,
    myDonations: async () => ({ items: [] }),
  };
}

/** Fund Me client for the current mode (online API or the local demo). */
export function useFundMe() {
  const api = useApi();
  return useMemo(() => (api.online ? onlineClient(api.request) : demoClient()), [api.online, api.request]);
}
