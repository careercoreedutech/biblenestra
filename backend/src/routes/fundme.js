// FUND ME (round 3) — fundraising requests, public pages, donations through a payment-provider adapter.
//
// Two Hono apps are exported:
//   fundmePublic  mounted BEFORE requireUser: the public page (/f/:slug), its JSON (/f/:slug.json), public PDFs,
//                 donations (guest or signed in), the test checkout page and the provider webhooks.
//   fundme        mounted AFTER requireUser: owner routes, the in-app list, uploads of PDFs and admin JSON routes.
// See API.md "Fund Me (round 3)" and lib/payments.js for the provider interface.
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { ApiError, bad, body, forbidden, notFound, str, int, isUuid, uuidParam, encodeCursor, decodeCursor } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { FUNDME } from '../lib/rules.js';
import { activeProvider, TestProvider, hmacSha256Hex } from '../lib/payments.js';
// FUND ME MONEY (monetisation stage 2): credits on publish, anti-fraud flags, Paystack donations held by BibleNestra.
import {
  pickProvider, DONATIONS_OFF, paystackCurrencies, testDonationsAllowed, confirmDonation, failDonation, recheckDonation, gatewayInfo,
  assertCanSubmit, requestRiskFlags, publishFundraiser, DONATION_LABEL, refundDonation, markPayoutPaid, failPayout,
  donationQuote, donorCurrencyCodes, donorCurrencyRules, fxRates, fmtMoney, NON_REFUNDABLE, payoutScheduleText,
} from '../lib/fundmeMoney.js';
import { paystackConfigured, paystackTestMode, verifyPaystackSignature, verifyTransaction } from '../lib/paystack.js';
import { settlePayment, refundedByGateway } from '../lib/paystackCheckout.js';
import { getConfig, getBalance, rateLimit } from '../lib/wallet.js';
import { isOn } from '../lib/play.js';
import { formatMoney, percentOf } from '../lib/money.js';
import { renderFundraiserPage, renderTestCheckout, renderMessagePage } from '../lib/fundmePage.js';
import { FUNDME_ADMIN_SCRIPT } from '../lib/fundmeAdmin.js';
import { registerAdminScript } from './admin.js';

// "Fund Me approvals" tab on the /admin dashboard (Discover Tools area's extension point)
registerAdminScript(FUNDME_ADMIN_SCRIPT);

const CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN'];
const MAX_PDF = 10 * 1024 * 1024;
const MAX_IMAGES = 12;
const MAX_DOCS = 6;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;
// Admin routes take a uuid only, so /admin/api/fundme/donations, /payouts … (routes/fundmeMoney.js) don't collide with :id.
const UUID_P = '{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}';

const isAdmin = (u) => !!u && u.role === 'admin';
const origin = (c) => new URL(c.req.url).origin;
const publicBase = (c) => (c.env.PUBLIC_FUNDME_BASE || origin(c)).replace(/\/$/, '');
const mediaBase = (c) => (c.env.PUBLIC_MEDIA_BASE || `${origin(c)}/media`).replace(/\/$/, '');
const imgUrl = (c, key) => (key ? `${mediaBase(c)}/${key}` : null);
const toNum = (v) => (v === null || v === undefined ? 0 : Number(v));
const iso = (d) => (d ? new Date(d).toISOString() : null);
const jsonv = (v, d) => (v === null || v === undefined ? d : typeof v === 'string' ? JSON.parse(v) : v);

// A fundraiser is publicly visible once approved, unless an admin paused it (moderation).
const PUBLIC_COND = `(f.status = 'live' OR (f.status IN ('paused','closed') AND f.approved_at IS NOT NULL AND COALESCE(f.paused_by, 'owner') <> 'admin'))`;

// ---------- validation ----------
const imageKeyRe = (ownerId) => new RegExp(`^img/${ownerId}/[0-9a-f-]{36}\\.(jpg|png|webp|heic|heif)$`);
const docKeyRe = (ownerId) => new RegExp(`^doc/${ownerId}/[0-9a-f-]{36}\\.pdf$`);

function ownImageKey(v, ownerId, field = 'Image') {
  if (typeof v !== 'string' || !imageKeyRe(ownerId).test(v)) throw bad(`${field} must be a photo you uploaded`, 'BAD_MEDIA');
  return v;
}

function parseStory(v, ownerId) {
  if (!Array.isArray(v)) throw bad('story must be a list of blocks');
  if (v.length > 60) throw bad('Your story has too many parts (max 60)');
  let total = 0;
  const out = [];
  for (const b of v) {
    if (!b || typeof b !== 'object') throw bad('Bad story block');
    if (b.type === 'p') {
      const text = str(b.text, { max: 5000, field: 'Paragraph' });
      if (!text) continue;
      total += text.length;
      out.push({ type: 'p', text });
    } else if (b.type === 'img') {
      const key = ownImageKey(b.key, ownerId, 'Story image');
      const caption = str(b.caption, { max: 200, field: 'Caption', optional: true });
      out.push(caption ? { type: 'img', key, caption } : { type: 'img', key });
    } else throw bad('Unknown story block');
  }
  if (total > 20000) throw bad('Your story is too long (max 20,000 characters)');
  return out;
}

function parseMedia(v, ownerId, existing) {
  if (!Array.isArray(v)) throw bad('media must be a list');
  const known = new Map(existing.map((m) => [m.id, m]));
  const out = [];
  let images = 0; let docs = 0;
  v.forEach((m, i) => {
    if (!m || typeof m !== 'object') throw bad('Bad media item');
    const prev = m.id && known.get(m.id);
    const kind = prev ? prev.kind : m.kind;
    if (!['image', 'pdf'].includes(kind)) throw bad('Media kind must be image or pdf');
    let key = prev ? prev.r2_key : m.key;
    if (!prev) {
      if (kind === 'image') key = ownImageKey(key, ownerId);
      else if (typeof key !== 'string' || !docKeyRe(ownerId).test(key)) throw bad('Document must be a PDF you uploaded', 'BAD_MEDIA');
    }
    const visibility = m.visibility === undefined ? (prev ? prev.visibility : kind === 'pdf' ? 'private' : 'public') : m.visibility;
    if (!['public', 'private'].includes(visibility)) throw bad('visibility must be public or private');
    const name = prev ? prev.name : str(m.name, { max: 120, field: 'File name', optional: true });
    out.push({ id: prev ? prev.id : null, kind, key, name: name || null, caption: str(m.caption, { max: 200, field: 'Caption', optional: true }), visibility, position: i });
    if (kind === 'image') images++; else docs++;
  });
  if (images > MAX_IMAGES) throw bad(`Up to ${MAX_IMAGES} supporting photos`);
  if (docs > MAX_DOCS) throw bad(`Up to ${MAX_DOCS} documents`);
  return out;
}

function parseCurrency(v) {
  const cur = String(v || '').toUpperCase();
  if (!CURRENCIES.includes(cur)) throw bad('Currency must be GBP, USD, EUR or NGN', 'BAD_CURRENCY');
  return cur;
}

function parseGoal(v, cur) {
  const rules = FUNDME.currencies[cur];
  return int(v, { min: Math.max(100, rules.min), max: rules.goalMax, field: 'Goal' });
}

function slugify(title) {
  const base = String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 6);
  return `${base || 'fundraiser'}-${rnd}`;
}

// ---------- signed URLs for private documents (owner + admins; opened in a browser without headers) ----------
const signSecret = (env) => env.FUNDME_SIGNING_SECRET || env.REALTIME_SECRET || 'biblenestra-fundme-fallback-secret';
async function signedDocUrl(c, mediaId, ttl = 900) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = await hmacSha256Hex(signSecret(c.env), `doc:${mediaId}:${exp}`);
  return `${origin(c)}/fundme/docs/${mediaId}?exp=${exp}&sig=${sig}`;
}

// ---------- shapes ----------
function excerptOf(story, n = 180) {
  const text = jsonv(story, []).filter((b) => b.type === 'p').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
}

function moneyShape(f) {
  const goal = toNum(f.goal_minor); const raised = toNum(f.raised_minor);
  return {
    currency: f.currency,
    goalMinor: goal,
    raisedMinor: raised,
    remainingMinor: Math.max(0, goal - raised),
    percent: percentOf(raised, goal),
    donorsCount: toNum(f.donors_count),
  };
}

// Donations in any currency (client W5): the donor picks a currency (rates: Admin › Rules › fundme_fx_ngn_per_unit).
// It is charged in that currency when PAYSTACK_CURRENCIES lists it, otherwise converted to NGN and charged in NGN.
async function donateInfo(c, f) {
  const p = activeProvider(c.env);
  const r = FUNDME.currencies[f.currency];
  const user = c.get('user');
  const cfg = await getConfig(c.env);
  const rates = fxRates(cfg);
  const charge = paystackCurrencies(c.env);
  const currencies = donorCurrencyCodes(cfg).map((code) => ({
    code, ngnPerUnit: rates[code], chargedIn: code === 'NGN' || charge.includes(code) ? code : 'NGN', ...donorCurrencyRules(cfg, code, FUNDME.currencies),
  }));
  return {
    donationsOpen: !!p && f.status === 'live',
    paymentsReady: !!p,
    provider: p ? p.name : null,
    testMode: !!p && p.name === 'test',
    needsEmail: !!p && !!p.needsEmail,
    canTestDonate: !!user && testDonationsAllowed(c.env, user) && f.status === 'live',
    closedMessage: p ? null : DONATIONS_OFF,
    heldByBibleNestra: 'Donations are paid to BibleNestra, held safely and paid out to the organiser after verification.',
    refundPolicy: NON_REFUNDABLE,
    presets: r.presets,
    minMinor: r.min,
    maxMinor: r.max,
    donorCurrencies: currencies,
    defaultDonorCurrency: f.currency,
    coverFeesDefault: true,
    fees: {
      platformBps: cfg.fundme_fee_bps, processingBps: cfg.fundme_paystack_fee_bps, processingFlatMinor: cfg.fundme_paystack_fee_flat_minor,
      processingFlatFromMinor: cfg.fundme_paystack_fee_flat_from_minor, processingCapMinor: cfg.fundme_paystack_fee_cap_minor, vatBps: cfg.fundme_vat_bps,
      explain: `BibleNestra fee ${cfg.fundme_fee_bps / 100}%, payment processing (Paystack, about ${cfg.fundme_paystack_fee_bps / 100}% + ₦${cfg.fundme_paystack_fee_flat_minor / 100} from ₦${(cfg.fundme_paystack_fee_flat_from_minor / 100).toLocaleString('en-US')}, at most ₦${(cfg.fundme_paystack_fee_cap_minor / 100).toLocaleString('en-US')}) and ${cfg.fundme_vat_bps / 100}% VAT on the fees.`,
    },
    settlementNote: 'Donations are held and paid out in Naira (NGN). Rates are set by BibleNestra and may differ slightly from your bank’s.',
    payoutSchedule: payoutScheduleText(cfg),
  };
}

function listShape(c, f) {
  return {
    id: f.id,
    slug: f.slug,
    url: `${publicBase(c)}/f/${f.slug}`,
    title: f.title,
    excerpt: excerptOf(f.story),
    mainImageUrl: imgUrl(c, f.main_image_key),
    status: f.status,
    ...moneyShape(f),
    owner: f.owner_name ? { id: f.owner_id, displayName: f.owner_name, avatarUrl: f.owner_avatar || null } : undefined,
    createdAt: iso(f.created_at),
  };
}

async function fullShape(c, f, { privileged }) {
  const media = await q(c.env, 'SELECT * FROM fundraiser_media WHERE fundraiser_id = $1 ORDER BY position, created_at', [f.id]);
  const items = [];
  for (const m of media) {
    if (!privileged && m.visibility !== 'public') continue;
    let url;
    if (m.kind === 'image') url = imgUrl(c, m.r2_key);
    else url = privileged ? await signedDocUrl(c, m.id) : `${publicBase(c)}/f/${f.slug}/docs/${m.id}`;
    const it = { id: m.id, kind: m.kind, url, caption: m.caption || null, name: m.name || null };
    if (privileged) { it.visibility = m.visibility; it.key = m.r2_key; }
    items.push(it);
  }
  const story = jsonv(f.story, []).map((b) => (b.type === 'img' ? { ...b, url: imgUrl(c, b.key), ...(privileged ? {} : { key: undefined }) } : b));
  const out = {
    id: f.id,
    slug: f.slug,
    url: `${publicBase(c)}/f/${f.slug}`,
    title: f.title,
    story,
    excerpt: excerptOf(f.story),
    mainImageUrl: imgUrl(c, f.main_image_key),
    status: f.status,
    pausedBy: f.paused_by || null,
    ...moneyShape(f),
    ...(await donateInfo(c, f)),
    owner: { displayName: f.owner_name || 'Friend', avatarUrl: f.owner_avatar || null },
    media: items,
    createdAt: iso(f.created_at),
    updatedAt: iso(f.updated_at),
  };
  if (privileged) {
    out.mainImageKey = f.main_image_key || null;
    out.rejectReason = f.reject_reason || null;
    out.submittedAt = iso(f.submitted_at);
    out.approvedAt = iso(f.approved_at);
    out.isOwner = c.get('user') ? c.get('user').id === f.owner_id : false;
  }
  return out;
}

async function publicDonations(env, fundraiserId, limit = 50) {
  const rows = await q(env,
    `SELECT donor_name, anonymous, COALESCE(original_amount_minor, amount_minor) AS amount_minor, COALESCE(original_currency, currency) AS currency, message, completed_at FROM donations
      WHERE fundraiser_id = $1 AND status = 'succeeded' ORDER BY completed_at DESC, id DESC LIMIT $2`, [fundraiserId, limit]);
  // never expose donor ids; anonymous donors are "Anonymous" (their amount still counts)
  return rows.map((d) => ({
    name: d.anonymous ? 'Anonymous' : d.donor_name || 'A friend',
    anonymous: !!d.anonymous,
    amountMinor: toNum(d.amount_minor),
    currency: d.currency,
    message: d.message || null,
    createdAt: iso(d.completed_at),
  }));
}

const FR_SELECT = `SELECT f.*, u.display_name AS owner_name, u.avatar_url AS owner_avatar FROM fundraisers f JOIN users u ON u.id = f.owner_id`;

async function bySlug(env, slug) {
  if (!SLUG_RE.test(slug || '')) return null;
  return one(env, `${FR_SELECT} WHERE f.slug = $1 AND ${PUBLIC_COND}`, [slug]);
}

async function notify(env, userId, kind, title, text, data) {
  try {
    await q(env, 'INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, $2, $3, $4, $5)', [userId, kind, title, text, JSON.stringify(data || {})]);
  } catch (e) { console.warn('[fundme] notification failed', e && e.message); }
}

async function logAdmin(env, adminId, action, id, details) {
  try {
    await q(env, 'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)', [adminId, action, 'fundraiser', id, JSON.stringify(details || {})]);
  } catch (e) { /* audit table is optional */ }
}

// ---------- payment results (idempotent on provider_ref; ledger + status + totals change in ONE transaction) ----------
// status 'succeeded' = the gateway confirmed the payment (test provider, or Paystack AFTER the verify API said success).
export async function applyPaymentResult(c, providerName, providerRef, status, { amountMinor, currency, gateway } = {}) {
  const d = await one(c.env, 'SELECT * FROM donations WHERE provider = $1 AND provider_ref = $2', [providerName, providerRef]);
  if (!d) return { changed: false };
  if (status === 'succeeded') {
    // test provider: "paid" exactly what was asked (charge_* since the client answers; amount/currency for older rows)
    const asked = d.charge_amount_minor != null ? Number(d.charge_amount_minor) : Number(d.amount_minor);
    const r = await confirmDonation(c, d, { amountMinor: amountMinor ?? asked, currency: currency || d.charge_currency || d.currency, actor: providerName === 'paystack' ? 'paystack' : 'test', gateway: gateway || {} });
    return { changed: r.changed, donationId: d.id, status: r.status || undefined };
  }
  if (status === 'failed') return failDonation(c.env, d, { actor: providerName === 'paystack' ? 'paystack' : 'test', reason: 'Payment did not complete' });
  if (status === 'refunded') {
    if (!d.received_at || d.settlement_status === 'refunded') return { changed: false };
    try { return await refundDonation(c.env, d, { actor: providerName === 'paystack' ? 'system' : 'system', reason: 'Refund reported by the payment gateway' }); } catch (e) { return { changed: false, error: e.code }; }
  }
  return { changed: false };
}

// Try to authenticate without requiring it (guests can donate from the public web page).
async function optionalUser(c) {
  const hasAuth = c.req.header('Authorization') || c.req.header('X-Dev-User');
  if (!hasAuth) return null;
  try {
    await requireUser()(c, async () => {});
    return c.get('user') || null;
  } catch (e) { return null; }
}

async function rateKey(c, user) {
  if (user) return `u:${user.id}`;
  const ip = c.req.header('CF-Connecting-IP') || (c.req.header('X-Forwarded-For') || '').split(',')[0].trim() || 'unknown';
  return `ip:${(await hmacSha256Hex(signSecret(c.env), `ip:${ip}`)).slice(0, 32)}`;
}

// =============================================================================================
// PUBLIC
// =============================================================================================
export const fundmePublic = new Hono();

// GET /f/:slug        → HTML landing page (Open Graph tags so shared links preview nicely)
// GET /f/:slug.json   → the same data as JSON
fundmePublic.get('/f/:slug', async (c) => {
  const raw = c.req.param('slug');
  const asJson = raw.endsWith('.json');
  const slug = asJson ? raw.slice(0, -5) : raw;
  const f = await bySlug(c.env, slug);
  if (!f) {
    if (asJson) throw notFound('Fundraiser not found');
    return c.html(renderMessagePage({ title: 'Fundraiser not available', text: 'This fundraiser doesn’t exist or isn’t available right now.' }), 404);
  }
  const data = await fullShape(c, f, { privileged: false });
  data.donations = await publicDonations(c.env, f.id);
  if (asJson) {
    c.header('Cache-Control', 'no-store');
    return c.json(data);
  }
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const result = ['succeeded', 'failed', 'cancelled'].includes(c.req.query('donation')) ? c.req.query('donation') : null;
  c.header('Content-Security-Policy', [
    "default-src 'none'", "img-src 'self' https: data:", "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", `script-src 'nonce-${nonce}'`, "connect-src 'self'", "form-action 'self' https://checkout.paystack.com",
    "frame-ancestors 'none'", "base-uri 'none'",
  ].join('; '));
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Cache-Control', 'no-store');
  return c.html(renderFundraiserPage(data, { nonce, result, pageUrl: data.url }));
});

// Public supporting documents (PDF): only for a publicly visible fundraiser and a doc marked public.
fundmePublic.get('/f/:slug/docs/:mediaId', async (c) => {
  const id = c.req.param('mediaId');
  if (!isUuid(id)) return c.notFound();
  const f = await bySlug(c.env, c.req.param('slug'));
  if (!f) return c.notFound();
  const m = await one(c.env, `SELECT * FROM fundraiser_media WHERE id = $1 AND fundraiser_id = $2 AND kind = 'pdf' AND visibility = 'public'`, [id, f.id]);
  if (!m) return c.notFound();
  return servePdf(c, m, 'public, max-age=300');
});

// Private documents through a short-lived signed URL (issued to the owner and admins only).
fundmePublic.get('/fundme/docs/:mediaId', async (c) => {
  const id = c.req.param('mediaId');
  const exp = Number(c.req.query('exp'));
  const sig = c.req.query('sig') || '';
  if (!isUuid(id) || !Number.isFinite(exp) || exp < Date.now() / 1000) return c.json({ error: 'This link has expired', code: 'LINK_EXPIRED' }, 403);
  const expected = await hmacSha256Hex(signSecret(c.env), `doc:${id}:${exp}`);
  if (sig.length !== expected.length || sig !== expected) return c.json({ error: 'Invalid link', code: 'FORBIDDEN' }, 403);
  const m = await one(c.env, `SELECT * FROM fundraiser_media WHERE id = $1 AND kind = 'pdf'`, [id]);
  if (!m) return c.notFound();
  return servePdf(c, m, 'private, no-store');
});

async function servePdf(c, m, cache) {
  if (!c.env.MEDIA) return c.notFound();
  const obj = await c.env.MEDIA.get(m.r2_key);
  if (!obj) return c.notFound();
  const safeName = String(m.name || 'document.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'document.pdf';
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`}"`,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    },
  });
}

// What a donation would cost: GET /f/:slug/donation-quote?amountMinor=2000&currency=GBP&coverFees=true (no auth).
// → donationQuote(): the gift in NGN, BibleNestra fee, Paystack fee estimate, VAT, what is charged (and in which
// currency) and what the beneficiary receives (NGN).
fundmePublic.get('/f/:slug/donation-quote', async (c) => {
  const f = await bySlug(c.env, c.req.param('slug'));
  if (!f) throw notFound('Fundraiser not found');
  const cfg = await getConfig(c.env);
  const cur = String(c.req.query('currency') || f.currency).toUpperCase();
  if (!donorCurrencyCodes(cfg).includes(cur)) throw new ApiError(400, 'CURRENCY_NOT_SUPPORTED', `Donations in ${cur} aren’t available — choose another currency`);
  const rules = donorCurrencyRules(cfg, cur, FUNDME.currencies);
  const amount = int(c.req.query('amountMinor') ?? c.req.query('amount_minor'), { min: rules.min, max: rules.max, field: 'Amount' });
  const cover = ['true', '1', 'on'].includes(String(c.req.query('coverFees') ?? c.req.query('cover_fees') ?? ''));
  const qt = donationQuote(cfg, { amountMinor: amount, currency: cur, coverFees: cover, chargeCurrencies: paystackCurrencies(c.env), fundraiserCurrency: f.currency });
  c.header('Cache-Control', 'no-store');
  return c.json({ ...qt, ok: qt.netMinor > 0, display: {
    gift: fmtMoney(qt.amountMinor, qt.currency), charged: fmtMoney(qt.chargeAmountMinor, qt.chargeCurrency), donorTotal: fmtMoney(qt.donorTotalMinor, qt.currency),
    beneficiary: fmtMoney(qt.netMinor, 'NGN'), platformFee: fmtMoney(qt.platformFeeMinor, 'NGN'), processingFee: fmtMoney(qt.processingFeeMinor, 'NGN'), vat: fmtMoney(qt.vatMinor, 'NGN'),
  }, refundPolicy: NON_REFUNDABLE });
});

// Donation status (the app polls this after opening the checkout)
fundmePublic.get('/f/:slug/donations/:donationId', async (c) => {
  const id = c.req.param('donationId');
  if (!isUuid(id)) throw notFound();
  let d = await one(c.env, `SELECT d.* FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id WHERE d.id = $1 AND f.slug = $2`, [id, c.req.param('slug')]);
  if (!d) throw notFound();
  // Paystack: while still pending, ask Paystack directly (the webhook may be late). Rate-limited per donation.
  if (d.provider === 'paystack' && d.status === 'pending' && paystackConfigured(c.env) && Date.now() - new Date(d.created_at).getTime() > 3000) {
    try {
      await rateLimit(c.env, `fundme_poll:${d.id}`, 6, 60);
      const r = await recheckDonation(c, d);
      if (r.changed) d = await one(c.env, 'SELECT * FROM donations WHERE id = $1', [d.id]);
    } catch (e) { /* rate limited or Paystack unreachable: report what we know */ }
  }
  return c.json({ id: d.id, status: d.status, settlementStatus: d.settlement_status, statusLabel: DONATION_LABEL[d.settlement_status], receiptNo: d.receipt_no || null });
});

// POST /f/:slug/donations — JSON (app / page script) or a plain HTML form post (no-JS fallback → 303 to checkout)
fundmePublic.post('/f/:slug/donations', async (c) => {
  const ctype = (c.req.header('Content-Type') || '').toLowerCase();
  const isForm = ctype.startsWith('application/x-www-form-urlencoded') || ctype.startsWith('multipart/form-data');
  let b;
  if (isForm) {
    const fd = await c.req.parseBody();
    const amt = Number(fd.amount_custom) > 0 ? Math.round(Number(fd.amount_custom) * 100) : Number(fd.amount_minor);
    b = { amount_minor: amt, message: fd.message || '', anonymous: fd.anonymous === 'on' || fd.anonymous === 'true', donor_name: fd.donor_name || '', cover_fees: fd.cover_fees === 'on' || fd.cover_fees === 'true', currency: fd.currency || undefined };
  } else b = await body(c);
  const user = await optionalUser(c);
  const f = await one(c.env, `SELECT * FROM fundraisers WHERE slug = $1`, [c.req.param('slug')]);
  if (!f || !(await bySlug(c.env, f.slug))) throw notFound('Fundraiser not found');
  if (f.status !== 'live') throw new ApiError(409, 'NOT_ACCEPTING', 'This fundraiser isn’t accepting donations right now');
  // Paid to BibleNestra's gateway account — never to the beneficiary (spec §3). Testers may ask for provider 'test'.
  const provider = pickProvider(c.env, user, b.provider === 'test' ? 'test' : null);
  if (!provider) throw new ApiError(503, 'DONATIONS_NOT_OPEN', DONATIONS_OFF);

  // Donor currency (default: the request's) and "Cover the fees" (the app ticks it by default; absent = not covered).
  const cfg = await getConfig(c.env);
  const cur = String(b.currency || f.currency).toUpperCase();
  if (!donorCurrencyCodes(cfg).includes(cur)) throw new ApiError(400, 'CURRENCY_NOT_SUPPORTED', `Donations in ${cur} aren’t available — choose another currency`);
  const rules = donorCurrencyRules(cfg, cur, FUNDME.currencies);
  const amount = int(b.amount_minor ?? b.amountMinor, { min: rules.min, max: rules.max, field: 'Amount' });
  const coverFees = b.cover_fees === true || b.coverFees === true || b.cover_fees === 'true' || b.coverFees === 'true';
  const message = str(b.message, { max: 500, field: 'Message', optional: true });
  const anonymous = b.anonymous === true || b.anonymous === 'true';
  let donorName = str(b.donor_name ?? b.donorName, { max: 80, field: 'Name', optional: true });
  if (!donorName && user) donorName = user.display_name;
  let email = str(b.email, { max: 200, field: 'Email', optional: true });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw bad('Enter a valid email address for your receipt', 'BAD_EMAIL');
  if (provider.needsEmail && !email) throw bad('Add your email — the payment receipt is sent there', 'EMAIL_REQUIRED');

  const key = await rateKey(c, user);
  const recent = await one(c.env, `SELECT COUNT(*)::int AS n FROM donations WHERE rl_key = $1 AND created_at > now() - interval '10 minutes'`, [key]);
  if (recent && recent.n >= FUNDME.donationsPer10Min) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts — please wait a few minutes and try again');

  const qt = donationQuote(cfg, { amountMinor: amount, currency: cur, coverFees, chargeCurrencies: paystackCurrencies(c.env), fundraiserCurrency: f.currency });
  if (!(qt.netMinor > 0)) throw bad('This amount is too small to cover the fees', 'AMOUNT_TOO_SMALL');
  const fee = qt.platformFeeMinor;
  // Our simulated checkout, or Paystack running on test keys (sk_test_…): never real money
  const isTestDonation = provider.name === 'test' || (provider.name === 'paystack' && paystackTestMode(c.env));
  const d = await one(c.env,
    `INSERT INTO donations (fundraiser_id, donor_id, donor_name, amount_minor, fee_minor, net_minor, currency, message, anonymous, provider, rl_key,
                            beneficiary_id, donor_email, is_test, original_currency, original_amount_minor, fx_rate, charge_currency, charge_amount_minor,
                            charge_fx_rate, cover_fees, gift_ngn_minor, processing_fee_minor, vat_minor, total_ngn_minor, raised_credit_minor)
     VALUES ($1, $2, $3, $4, $5, $6, 'NGN', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) RETURNING *`,
    [f.id, user ? user.id : null, donorName, qt.netMinor + fee, fee, qt.netMinor, message, anonymous, provider.name, key, f.owner_id, email, isTestDonation,
      cur, amount, qt.fxRate, qt.chargeCurrency, qt.chargeAmountMinor, qt.chargeFxRate, coverFees, qt.giftNgnMinor, qt.processingFeeMinor, qt.vatMinor, qt.totalNgnMinor, qt.raisedMinor]);
  await q(c.env, `INSERT INTO fundme_donation_events (donation_id, from_status, to_status, actor, actor_id, reason, meta) VALUES ($1, NULL, 'pending', 'donor', $2, 'Checkout started', $3::jsonb)`,
    [d.id, user ? user.id : null, JSON.stringify({ provider: provider.name, currency: cur, amountMinor: amount, chargeCurrency: qt.chargeCurrency, chargeAmountMinor: qt.chargeAmountMinor, feeMinor: fee, processingFeeMinor: qt.processingFeeMinor, vatMinor: qt.vatMinor, coverFees })]);
  const base = `${publicBase(c)}/f/${f.slug}`;
  let checkout;
  try {
    checkout = await provider.createCheckout(d, f, c.env, {
      origin: origin(c), email, successUrl: `${base}?donation=succeeded`, cancelUrl: `${base}?donation=cancelled`, returnUrl: `${origin(c)}/fundme/paystack/return`,
    });
  } catch (e) {
    await failDonation(c.env, d, { actor: 'system', reason: `Checkout could not start: ${String(e.message || '').slice(0, 200)}` });
    throw new ApiError(502, e.code || 'PROVIDER_ERROR', e.message || 'Couldn’t start the payment');
  }
  await q(c.env, 'UPDATE donations SET provider_ref = $2 WHERE id = $1', [d.id, checkout.providerRef]);
  if (isForm) return c.redirect(checkout.url, 303);
  return c.json({ donationId: d.id, checkoutUrl: checkout.url, provider: provider.name, status: 'pending', settlementStatus: 'pending', feeMinor: fee, netMinor: qt.netMinor, test: isTestDonation, quote: qt, refundPolicy: NON_REFUNDABLE }, 201);
});

// ---------- TEST provider (PAYMENTS_MODE=test only) ----------
// The fake checkout works in PAYMENTS_MODE=test (dev) or when tester donations are switched on (WALLET_TEST_PURCHASES,
// same gate as the wallet core's test purchases). Test donations are marked is_test and can only go into test payouts.
const testOnly = (c) => String(c.env.PAYMENTS_MODE || '').toLowerCase() === 'test' || isOn(c.env.WALLET_TEST_PURCHASES);

fundmePublic.get('/pay/test/:ref', async (c) => {
  if (!testOnly(c)) return c.notFound();
  const d = await one(c.env,
    `SELECT d.*, f.title, f.slug, f.main_image_key FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id
      WHERE d.provider = 'test' AND d.provider_ref = $1`, [c.req.param('ref')]);
  if (!d) return c.html(renderMessagePage({ title: 'Checkout not found', text: 'This test checkout link is invalid.' }), 404);
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  c.header('Content-Security-Policy', `default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
  c.header('Cache-Control', 'no-store');
  return c.html(renderTestCheckout({
    ref: d.provider_ref, status: d.status, title: d.title,
    amount: d.charge_currency
      ? formatMoney(d.charge_amount_minor, d.charge_currency, { cents: true }) + (d.original_currency && d.original_currency !== d.charge_currency ? ` (${d.original_currency} ${formatMoney(d.original_amount_minor, d.original_currency, { cents: true })} converted)` : '')
      : formatMoney(d.amount_minor, d.currency, { cents: true }),
    mainImageUrl: imgUrl(c, d.main_image_key), returnUrl: `${publicBase(c)}/f/${d.slug}`, anonymous: d.anonymous, donorName: d.donor_name,
  }, { nonce }));
});

fundmePublic.post('/webhooks/fundme/test', async (c) => {
  if (!testOnly(c)) return c.notFound();
  const r = await TestProvider.handleWebhook(c.req.raw, c.env);
  if (r.ignored) throw bad(r.error || 'Bad webhook');
  const res = await applyPaymentResult(c, 'test', r.providerRef, r.status);
  return c.json({ ok: true, ...res });
});

// ---------- Paystack (FUND ME MONEY) ----------
// Webhook: X-Paystack-Signature = hex(HMAC-SHA512(PAYSTACK_SECRET_KEY, raw body)). A valid charge.success is still
// re-verified through GET /transaction/verify before anything is recorded; amounts come from that answer.
// transfer.* events settle automatic payouts (FUNDME_AUTO_PAYOUTS). Always 200 for well-signed events (Paystack retries).
// PAYSTACK FOR EVERY PURCHASE: the same handler also settles in-app purchases (lib/paystackCheckout.js) and is mounted
// at /webhooks/paystack (the URL to paste in Paystack) as well as the older /webhooks/fundme/paystack.
const paystackWebhook = async (c) => {
  if (!paystackConfigured(c.env)) return c.json({ error: 'Paystack is not configured', code: 'NOT_CONFIGURED' }, 503);
  const raw = await c.req.text();
  const ok = await verifyPaystackSignature(raw, c.req.header('X-Paystack-Signature'), String(c.env.PAYSTACK_SECRET_KEY).trim());
  if (!ok) return c.json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' }, 400);
  let evt;
  try { evt = JSON.parse(raw); } catch (e) { return c.json({ error: 'Bad JSON', code: 'BAD_REQUEST' }, 400); }
  const data = (evt && evt.data) || {};
  const event = String(evt.event || '');
  if (event === 'charge.success') {
    const ref = String(data.reference || '');
    const d = ref ? await one(c.env, `SELECT * FROM donations WHERE provider = 'paystack' AND provider_ref = $1`, [ref]) : null;
    if (!d) {
      const r = ref ? await settlePayment(c.env, ref) : { found: false };
      return c.json(r.found ? { ok: true, purchase: true, status: r.status } : { ok: true, ignored: true });
    }
    const v = await verifyTransaction(c.env, ref);
    if (v.status !== 'success') return c.json({ ok: true, ignored: true, gatewayStatus: v.status });
    const r = await confirmDonation(c, d, { amountMinor: v.amountMinor, currency: v.currency, actor: 'paystack', gateway: gatewayInfo(v.raw) });
    return c.json({ ok: true, changed: r.changed, status: r.status || undefined });
  }
  if (event === 'refund.processed') {
    const ref = String(data.transaction_reference || (data.transaction && data.transaction.reference) || '');
    const purchase = ref ? await one(c.env, 'SELECT id FROM paystack_payments WHERE reference = $1', [ref]) : null;
    if (purchase) return c.json({ ok: true, purchase: true, ...(await refundedByGateway(c.env, ref)) });
    const res = ref ? await applyPaymentResult(c, 'paystack', ref, 'refunded') : { changed: false };
    return c.json({ ok: true, ...res });
  }
  if (event === 'transfer.success' || event === 'transfer.failed' || event === 'transfer.reversed') {
    const ref = String(data.reference || '');
    const p = isUuid(ref) ? await one(c.env, 'SELECT * FROM fundme_payouts WHERE id = $1', [ref]) : null;
    if (!p || !['approved', 'processing'].includes(p.status)) return c.json({ ok: true, ignored: true });
    try {
      if (event === 'transfer.success') await markPayoutPaid(c, p, { reference: String(data.transfer_code || ref), actor: 'paystack', note: 'Paystack transfer succeeded' });
      else await failPayout(c, p, { reason: `Paystack ${event.split('.')[1]}${data.reason ? `: ${String(data.reason).slice(0, 200)}` : ''}`, actor: 'paystack' });
    } catch (e) { if (e.code !== 'STATE_CHANGED') throw e; }
    return c.json({ ok: true });
  }
  return c.json({ ok: true, ignored: true });
};
fundmePublic.post('/webhooks/fundme/paystack', paystackWebhook);
fundmePublic.post('/webhooks/paystack', paystackWebhook);

// Paystack sends the donor back here (callback_url) → verify server-side → back to the public page with the result.
fundmePublic.get('/fundme/paystack/return', async (c) => {
  const ref = String(c.req.query('reference') || c.req.query('trxref') || '');
  const d = ref ? await one(c.env, `SELECT d.*, f.slug FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id WHERE d.provider = 'paystack' AND d.provider_ref = $1`, [ref]) : null;
  if (!d) return c.html(renderMessagePage({ title: 'Donation not found', text: 'We couldn’t find this payment. If you were charged, contact support with your Paystack receipt.' }), 404);
  let result = d.status === 'succeeded' ? 'succeeded' : d.status === 'failed' ? 'failed' : null;
  if (d.status === 'pending' && paystackConfigured(c.env)) {
    try {
      const r = await recheckDonation(c, d);
      const now = await one(c.env, 'SELECT status FROM donations WHERE id = $1', [d.id]);
      result = now.status === 'succeeded' ? 'succeeded' : now.status === 'failed' ? 'failed' : r.gatewayStatus === 'abandoned' ? 'cancelled' : null;
    } catch (e) { /* the webhook will finish it */ }
  }
  return c.redirect(`${publicBase(c)}/f/${d.slug}${result ? `?donation=${result}` : ''}`, 302);
});

// =============================================================================================
// AUTHENTICATED
// =============================================================================================
export const fundme = new Hono();

// PDF upload (application/pdf, ≤ 10 MB, must start with %PDF) → doc/<userId>/<uuid>.pdf (never served by /media)
fundme.post('/uploads/document', async (c) => {
  const me = c.get('user');
  if (!c.env.MEDIA) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED', 'Media storage (R2 bucket binding MEDIA) is not configured');
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/pdf') throw bad('Upload a PDF document', 'BAD_DOCUMENT_TYPE');
  if (Number(c.req.header('Content-Length') || 0) > MAX_PDF) throw new ApiError(413, 'TOO_LARGE', 'Documents must be under 10 MB');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty upload');
  if (buf.byteLength > MAX_PDF) throw new ApiError(413, 'TOO_LARGE', 'Documents must be under 10 MB');
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) throw bad('That file isn’t a valid PDF', 'BAD_DOCUMENT_TYPE');
  let rawName = '';
  try { rawName = c.req.query('name') || (c.req.header('X-File-Name') ? decodeURIComponent(c.req.header('X-File-Name')) : ''); } catch (e) { rawName = ''; }
  const name = rawName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'document.pdf';
  const key = `doc/${me.id}/${crypto.randomUUID()}.pdf`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0' } });
  return c.json({ key, name, size: buf.byteLength }, 201);
});

async function loadOwn(c) {
  const id = uuidParam(c);
  const f = await one(c.env, `${FR_SELECT} WHERE f.id = $1`, [id]);
  if (!f) throw notFound('Fundraiser not found');
  const me = c.get('user');
  if (f.owner_id !== me.id) throw forbidden('Only the organiser can change this fundraiser');
  return f;
}

const reload = (env, id) => one(env, `${FR_SELECT} WHERE f.id = $1`, [id]);

// Create a draft
fundme.post('/fundraisers', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, { min: 3, max: 120, field: 'Heading' });
  const currency = parseCurrency(b.currency || 'GBP');
  const goal = parseGoal(b.goalMinor ?? b.goal_minor, currency);
  const story = b.story === undefined ? [] : parseStory(b.story, me.id);
  const mainKey = b.mainImageKey ? ownImageKey(b.mainImageKey, me.id, 'Main image') : null;
  const drafts = await one(c.env, `SELECT COUNT(*)::int AS n FROM fundraisers WHERE owner_id = $1 AND status IN ('draft','pending_review')`, [me.id]);
  if (drafts.n >= 10) throw bad('You already have 10 fundraisers waiting — finish or close one first', 'TOO_MANY');
  let row = null;
  for (let i = 0; i < 4 && !row; i++) {
    row = await one(c.env,
      `INSERT INTO fundraisers (owner_id, slug, title, story, main_image_key, currency, goal_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [me.id, slugify(title), title, JSON.stringify(story), mainKey, currency, goal]);
  }
  if (!row) throw new ApiError(500, 'SLUG_FAILED', 'Please try again');
  if (b.media !== undefined) await saveMedia(c.env, row.id, parseMedia(b.media, me.id, []));
  return c.json(await fullShape(c, await reload(c.env, row.id), { privileged: true }), 201);
});

async function saveMedia(env, id, items) {
  await q(env, `
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, kind text, key text, name text, caption text, visibility text, position int)
    ), del AS (
      DELETE FROM fundraiser_media m WHERE m.fundraiser_id = $1 AND m.id NOT IN (SELECT i.id FROM incoming i WHERE i.id IS NOT NULL)
    ), upd AS (
      UPDATE fundraiser_media m SET caption = i.caption, visibility = i.visibility, position = i.position
        FROM incoming i WHERE m.id = i.id AND m.fundraiser_id = $1
    )
    INSERT INTO fundraiser_media (fundraiser_id, kind, r2_key, name, caption, visibility, position)
    SELECT $1, i.kind, i.key, i.name, i.caption, i.visibility, i.position FROM incoming i WHERE i.id IS NULL`,
  [id, JSON.stringify(items)]);
}

// Edit. Heading, story, images and documents can always be edited; goal/currency only before going live.
fundme.patch('/fundraisers/:id', async (c) => {
  const f = await loadOwn(c);
  const me = c.get('user');
  const b = await body(c);
  if (f.status === 'closed') throw new ApiError(409, 'CLOSED', 'This fundraiser is closed');
  const editableMoney = ['draft', 'pending_review', 'rejected'].includes(f.status);
  const sets = []; const params = [f.id];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (b.title !== undefined) set('title', str(b.title, { min: 3, max: 120, field: 'Heading' }));
  if (b.story !== undefined) set('story', JSON.stringify(parseStory(b.story, me.id)));
  if (b.mainImageKey !== undefined) set('main_image_key', b.mainImageKey === null ? null : ownImageKey(b.mainImageKey, me.id, 'Main image'));
  const curIn = b.currency !== undefined ? parseCurrency(b.currency) : f.currency;
  const goalIn = b.goalMinor ?? b.goal_minor;
  if (!editableMoney && ((b.currency !== undefined && curIn !== f.currency) || (goalIn !== undefined && Number(goalIn) !== toNum(f.goal_minor)))) {
    throw new ApiError(409, 'LOCKED_FIELD', 'The goal and currency can’t change once the fundraiser is live');
  }
  if (editableMoney) {
    if (b.currency !== undefined) set('currency', curIn);
    if (goalIn !== undefined || b.currency !== undefined) set('goal_minor', parseGoal(goalIn !== undefined ? goalIn : f.goal_minor, curIn));
  }
  if (sets.length) await q(c.env, `UPDATE fundraisers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  if (b.media !== undefined) {
    const existing = await q(c.env, 'SELECT * FROM fundraiser_media WHERE fundraiser_id = $1', [f.id]);
    await saveMedia(c.env, f.id, parseMedia(b.media, me.id, existing));
    if (!sets.length) await q(c.env, 'UPDATE fundraisers SET updated_at = now() WHERE id = $1', [f.id]);
  }
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.post('/fundraisers/:id/submit', async (c) => {
  const f = await loadOwn(c);
  if (!['draft', 'rejected'].includes(f.status)) throw new ApiError(409, 'BAD_STATUS', 'Only drafts can be submitted for review');
  const words = jsonv(f.story, []).filter((x) => x.type === 'p').map((x) => x.text).join(' ');
  const missing = [];
  if (!f.main_image_key) missing.push('a main photo');
  if (words.trim().length < 20) missing.push('your story');
  if (missing.length) throw bad(`Add ${missing.join(' and ')} before submitting`, 'INCOMPLETE');
  // FUND ME MONEY: publishing limits + enough credits (spent only when approved and published) + anti-fraud flags
  await assertCanSubmit(c.env, f.owner_id, f.id);
  const risk = await requestRiskFlags(c.env, f);
  await q(c.env, `UPDATE fundraisers SET status = 'pending_review', submitted_at = now(), first_submitted_at = COALESCE(first_submitted_at, now()),
      reject_reason = NULL, risk_flags = $2::jsonb, text_hash = $3, image_hashes = $4::text[], updated_at = now() WHERE id = $1 AND status IN ('draft','rejected')`,
  [f.id, JSON.stringify(risk.flags), risk.textHash, risk.hashes]);
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.post('/fundraisers/:id/pause', async (c) => {
  const f = await loadOwn(c);
  if (f.status !== 'live') throw new ApiError(409, 'BAD_STATUS', 'Only a live fundraiser can be paused');
  await q(c.env, `UPDATE fundraisers SET status = 'paused', paused_by = 'owner', updated_at = now() WHERE id = $1`, [f.id]);
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.post('/fundraisers/:id/resume', async (c) => {
  const f = await loadOwn(c);
  if (f.status !== 'paused') throw new ApiError(409, 'BAD_STATUS', 'This fundraiser isn’t paused');
  if (f.paused_by === 'admin') throw forbidden('Our review team paused this fundraiser — contact support to resume it', 'ADMIN_PAUSED');
  await q(c.env, `UPDATE fundraisers SET status = 'live', paused_by = NULL, updated_at = now() WHERE id = $1`, [f.id]);
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.post('/fundraisers/:id/close', async (c) => {
  const f = await loadOwn(c);
  if (f.status === 'closed') throw new ApiError(409, 'BAD_STATUS', 'Already closed');
  await q(c.env, `UPDATE fundraisers SET status = 'closed', updated_at = now() WHERE id = $1`, [f.id]);
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.get('/me/fundraisers', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `${FR_SELECT} WHERE f.owner_id = $1 ORDER BY f.created_at DESC LIMIT 50`, [me.id]);
  return c.json({ items: rows.map((f) => ({ ...listShape(c, f), rejectReason: f.reject_reason || null, pausedBy: f.paused_by || null })) });
});

// Public list of live fundraisers (newest first, keyset paginated)
fundme.get('/fundraisers', async (c) => {
  const cursor = decodeCursor(c.req.query('cursor'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
  const params = [];
  let where = `f.status = 'live'`;
  if (cursor) { params.push(cursor.ts, cursor.id); where += ` AND (f.created_at, f.id) < ($1, $2)`; }
  params.push(limit + 1);
  const rows = await q(c.env, `${FR_SELECT} WHERE ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT $${params.length}`, params);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return c.json({ items: page.map((f) => listShape(c, f)), cursor: more ? encodeCursor(page[page.length - 1]) : null, hasMore: more });
});

// Owner / admin view (includes private documents through signed links). Others get the public view.
fundme.get('/fundraisers/:id', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const f = await one(c.env, `${FR_SELECT} WHERE f.id = $1`, [id]);
  if (!f) throw notFound('Fundraiser not found');
  const privileged = f.owner_id === me.id || isAdmin(me);
  if (!privileged) {
    const pub = await one(c.env, `SELECT 1 FROM fundraisers f WHERE f.id = $1 AND ${PUBLIC_COND}`, [id]);
    if (!pub) throw notFound('Fundraiser not found');
  }
  const out = await fullShape(c, f, { privileged });
  out.donations = await publicDonations(c.env, f.id);
  return c.json(out);
});

// The owner's donations list (names are shown to the organiser even when hidden publicly)
fundme.get('/fundraisers/:id/donations', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const f = await one(c.env, 'SELECT owner_id FROM fundraisers WHERE id = $1', [id]);
  if (!f) throw notFound('Fundraiser not found');
  if (f.owner_id !== me.id && !isAdmin(me)) throw forbidden('Only the organiser can see donations');
  const status = c.req.query('status');
  const params = [id];
  let where = 'fundraiser_id = $1';
  if (['pending', 'succeeded', 'failed', 'refunded'].includes(status)) { params.push(status); where += ` AND status = $2`; }
  else where += ` AND status IN ('succeeded','refunded')`;
  const rows = await q(c.env, `SELECT * FROM donations WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
  return c.json({
    items: rows.map((d) => ({
      id: d.id,
      name: d.donor_name || (d.anonymous ? 'Anonymous' : 'A friend'),
      anonymous: !!d.anonymous,
      amountMinor: toNum(d.amount_minor),
      feeMinor: toNum(d.fee_minor),
      currency: d.currency,
      message: d.message || null,
      status: d.status,
      settlementStatus: d.settlement_status,
      statusLabel: DONATION_LABEL[d.settlement_status] || d.settlement_status,
      netMinor: d.net_minor != null ? toNum(d.net_minor) : toNum(d.amount_minor) - toNum(d.fee_minor),
      receiptNo: d.receipt_no || null,
      test: !!d.is_test,
      provider: d.provider,
      createdAt: iso(d.created_at),
      completedAt: iso(d.completed_at),
    })),
  });
});

// ---------- admin (users.role = 'admin') ----------
const adminOnly = async (c, next) => {
  if (!isAdmin(c.get('user'))) throw forbidden('Admins only', 'ADMIN_ONLY');
  await next();
};
fundme.use('/admin/api/fundme', adminOnly);
fundme.use('/admin/api/fundme/*', adminOnly);

fundme.get('/admin/api/fundme', async (c) => {
  const status = c.req.query('status') || 'pending_review';
  if (!['draft', 'pending_review', 'live', 'paused', 'closed', 'rejected'].includes(status)) throw bad('Unknown status');
  // flagged requests first (anti-fraud checks), then oldest first; with the organiser's Fund Me credit balance
  const rows = await q(c.env, `SELECT f.*, u.display_name AS owner_name, u.avatar_url AS owner_avatar,
      COALESCE((SELECT balance FROM wallet_balances b WHERE b.account = f.owner_id::text AND b.wallet = 'fundme_credits'), 0)::int AS owner_credits
    FROM fundraisers f JOIN users u ON u.id = f.owner_id WHERE f.status = $1
    ORDER BY (jsonb_array_length(f.risk_flags) > 0) DESC, COALESCE(f.submitted_at, f.created_at) ASC LIMIT 100`, [status]);
  const counts = await q(c.env, `SELECT status, COUNT(*)::int AS n FROM fundraisers GROUP BY status`);
  return c.json({
    items: rows.map((f) => ({ ...listShape(c, f), ownerId: f.owner_id, submittedAt: iso(f.submitted_at), rejectReason: f.reject_reason || null, pausedBy: f.paused_by || null,
      riskFlags: jsonv(f.risk_flags, []), ownerCredits: Number(f.owner_credits || 0), published: !!f.approved_at })),
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
  });
});
fundme.get('/admin/api/fundme/pending', async (c) => {
  const rows = await q(c.env, `${FR_SELECT} WHERE f.status = 'pending_review' ORDER BY f.submitted_at ASC LIMIT 100`);
  return c.json({ items: rows.map((f) => ({ ...listShape(c, f), submittedAt: iso(f.submitted_at) })) });
});

fundme.get(`/admin/api/fundme/:id${UUID_P}`, async (c) => {
  const id = uuidParam(c);
  const f = await one(c.env, `${FR_SELECT} WHERE f.id = $1`, [id]);
  if (!f) throw notFound('Fundraiser not found');
  const out = await fullShape(c, f, { privileged: true });
  out.ownerId = f.owner_id;
  out.donations = await publicDonations(c.env, f.id);
  out.riskFlags = jsonv(f.risk_flags, []);
  out.ownerCredits = await getBalance(c.env, f.owner_id, 'fundme_credits');
  out.published = !!f.approved_at;
  return c.json(out);
});

fundme.post(`/admin/api/fundme/:id${UUID_P}/approve`, async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const cur = await one(c.env, 'SELECT * FROM fundraisers WHERE id = $1', [id]);
  if (!cur || !['pending_review', 'paused'].includes(cur.status)) throw new ApiError(409, 'BAD_STATUS', 'Only fundraisers waiting for review (or paused) can be approved');
  let f; let cost = 0;
  if (cur.status === 'pending_review' && !cur.approved_at) {
    // FIRST publish: spend the publish credit(s) and go live in ONE transaction (spec §1). No credit → nothing published.
    try {
      ({ cost } = await publishFundraiser(c.env, cur, me.id));
    } catch (e) {
      if (e.code === 'INSUFFICIENT_BALANCE') {
        await notify(c.env, cur.owner_id, 'fundme_credits_needed', 'Add a Fund Me credit to publish', `“${cur.title}” is ready to publish, but your account needs a Fund Me credit. Buy one or ask a friend to send you one — it stays in review until then.`, { fundraiserId: cur.id, screen: 'FundMeCredits' });
        throw new ApiError(402, 'INSUFFICIENT_BALANCE', 'The organiser doesn’t have enough Fund Me credits to publish. They were notified; the request stays in review.');
      }
      throw e;
    }
    f = await one(c.env, 'SELECT * FROM fundraisers WHERE id = $1', [id]);
  } else {
    f = await one(c.env,
      `UPDATE fundraisers SET status = 'live', approved_at = COALESCE(approved_at, now()), reviewed_at = now(), reviewed_by = $2,
              paused_by = NULL, reject_reason = NULL, updated_at = now()
        WHERE id = $1 AND status IN ('pending_review','paused') RETURNING *`, [id, me.id]);
    if (!f) throw new ApiError(409, 'BAD_STATUS', 'Only fundraisers waiting for review (or paused) can be approved');
  }
  await notify(c.env, f.owner_id, 'fundme_approved', 'Your fundraiser is live ✨', `“${f.title}” was approved — share your link so people can give.${cost ? ` ${cost} Fund Me credit${cost === 1 ? ' was' : 's were'} used to publish it.` : ''}`, { fundraiserId: f.id, slug: f.slug });
  await logAdmin(c.env, me.id, 'fundme.approve', f.id, { title: f.title, creditsSpent: cost });
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.post(`/admin/api/fundme/:id${UUID_P}/reject`, async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const b = await body(c);
  const reason = str(b.reason, { min: 3, max: 500, field: 'Reason' });
  const f = await one(c.env,
    `UPDATE fundraisers SET status = 'rejected', reject_reason = $2, reviewed_at = now(), reviewed_by = $3, updated_at = now()
      WHERE id = $1 AND status = 'pending_review' RETURNING *`, [id, reason, me.id]);
  if (!f) throw new ApiError(409, 'BAD_STATUS', 'Only fundraisers waiting for review can be rejected');
  await notify(c.env, f.owner_id, 'fundme_rejected', 'Your fundraiser needs changes', `“${f.title}” wasn’t approved: ${reason}`, { fundraiserId: f.id, slug: f.slug });
  await logAdmin(c.env, me.id, 'fundme.reject', f.id, { title: f.title, reason });
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.post(`/admin/api/fundme/:id${UUID_P}/pause`, async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const f = await one(c.env,
    `UPDATE fundraisers SET status = 'paused', paused_by = 'admin', updated_at = now() WHERE id = $1 AND status IN ('live','paused') RETURNING *`, [id]);
  if (!f) throw new ApiError(409, 'BAD_STATUS', 'Only live fundraisers can be paused');
  await notify(c.env, f.owner_id, 'fundme_paused', 'Your fundraiser was paused', `Our review team paused “${f.title}”. Contact support for details.`, { fundraiserId: f.id, slug: f.slug });
  await logAdmin(c.env, me.id, 'fundme.pause', f.id, { title: f.title });
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});
