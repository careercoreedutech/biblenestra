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
import { activeProvider, providerByName, TestProvider, hmacSha256Hex, platformFee } from '../lib/payments.js';
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

function donateInfo(c, f) {
  const p = activeProvider(c.env);
  const r = FUNDME.currencies[f.currency];
  return {
    donationsOpen: !!p && f.status === 'live',
    paymentsReady: !!p,
    provider: p ? p.name : null,
    testMode: !!p && p.name === 'test',
    presets: r.presets,
    minMinor: r.min,
    maxMinor: r.max,
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
    owner: f.owner_name ? { displayName: f.owner_name, avatarUrl: f.owner_avatar || null } : undefined,
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
    ...donateInfo(c, f),
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
    `SELECT donor_name, anonymous, amount_minor, currency, message, completed_at FROM donations
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

// ---------- payment results (idempotent on provider_ref; the totals change in ONE statement) ----------
export async function applyPaymentResult(env, providerName, providerRef, status) {
  if (status === 'succeeded') {
    const row = await one(env, `
      WITH d AS (
        UPDATE donations SET status = 'succeeded', completed_at = now()
         WHERE provider = $1 AND provider_ref = $2 AND status = 'pending'
         RETURNING id, fundraiser_id, amount_minor, currency, anonymous, donor_name, message
      ), f AS (
        UPDATE fundraisers fr SET raised_minor = fr.raised_minor + d.amount_minor, donors_count = fr.donors_count + 1, updated_at = now()
          FROM d WHERE fr.id = d.fundraiser_id
         RETURNING fr.id, fr.owner_id, fr.title, fr.slug
      )
      SELECT d.*, f.owner_id, f.title, f.slug FROM d JOIN f ON f.id = d.fundraiser_id`, [providerName, providerRef]);
    if (!row) return { changed: false };
    const who = row.anonymous ? 'An anonymous supporter' : row.donor_name || 'Someone';
    await notify(env, row.owner_id, 'fundme_donation', 'New donation 🎉',
      `${who} gave ${formatMoney(row.amount_minor, row.currency)} to “${row.title}”${row.message ? `: “${String(row.message).slice(0, 80)}”` : ''}`,
      { fundraiserId: row.fundraiser_id, slug: row.slug, donationId: row.id });
    return { changed: true, donationId: row.id };
  }
  if (status === 'failed') {
    const row = await one(env, `UPDATE donations SET status = 'failed', completed_at = now() WHERE provider = $1 AND provider_ref = $2 AND status = 'pending' RETURNING id`, [providerName, providerRef]);
    return { changed: !!row };
  }
  if (status === 'refunded') {
    const row = await one(env, `
      WITH d AS (
        UPDATE donations SET status = 'refunded' WHERE provider = $1 AND provider_ref = $2 AND status = 'succeeded'
        RETURNING fundraiser_id, amount_minor
      )
      UPDATE fundraisers fr SET raised_minor = GREATEST(0, fr.raised_minor - d.amount_minor), donors_count = GREATEST(0, fr.donors_count - 1), updated_at = now()
        FROM d WHERE fr.id = d.fundraiser_id RETURNING fr.id`, [providerName, providerRef]);
    return { changed: !!row };
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
    "font-src https://fonts.gstatic.com", `script-src 'nonce-${nonce}'`, "connect-src 'self'", "form-action 'self'",
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

// Donation status (the app polls this after opening the checkout)
fundmePublic.get('/f/:slug/donations/:donationId', async (c) => {
  const id = c.req.param('donationId');
  if (!isUuid(id)) throw notFound();
  const d = await one(c.env, `SELECT d.id, d.status FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id WHERE d.id = $1 AND f.slug = $2`, [id, c.req.param('slug')]);
  if (!d) throw notFound();
  return c.json({ id: d.id, status: d.status });
});

// POST /f/:slug/donations — JSON (app / page script) or a plain HTML form post (no-JS fallback → 303 to checkout)
fundmePublic.post('/f/:slug/donations', async (c) => {
  const ctype = (c.req.header('Content-Type') || '').toLowerCase();
  const isForm = ctype.startsWith('application/x-www-form-urlencoded') || ctype.startsWith('multipart/form-data');
  let b;
  if (isForm) {
    const fd = await c.req.parseBody();
    const amt = Number(fd.amount_custom) > 0 ? Math.round(Number(fd.amount_custom) * 100) : Number(fd.amount_minor);
    b = { amount_minor: amt, message: fd.message || '', anonymous: fd.anonymous === 'on' || fd.anonymous === 'true', donor_name: fd.donor_name || '' };
  } else b = await body(c);
  const user = await optionalUser(c);
  const f = await one(c.env, `SELECT * FROM fundraisers WHERE slug = $1`, [c.req.param('slug')]);
  if (!f || !(await bySlug(c.env, f.slug))) throw notFound('Fundraiser not found');
  if (f.status !== 'live') throw new ApiError(409, 'NOT_ACCEPTING', 'This fundraiser isn’t accepting donations right now');
  const provider = activeProvider(c.env);
  if (!provider) throw new ApiError(503, 'DONATIONS_NOT_OPEN', 'Donations open soon');

  const rules = FUNDME.currencies[f.currency];
  const amount = int(b.amount_minor ?? b.amountMinor, { min: rules.min, max: rules.max, field: 'Amount' });
  const message = str(b.message, { max: 500, field: 'Message', optional: true });
  const anonymous = b.anonymous === true || b.anonymous === 'true';
  let donorName = str(b.donor_name ?? b.donorName, { max: 80, field: 'Name', optional: true });
  if (!donorName && user) donorName = user.display_name;

  const key = await rateKey(c, user);
  const recent = await one(c.env, `SELECT COUNT(*)::int AS n FROM donations WHERE rl_key = $1 AND created_at > now() - interval '10 minutes'`, [key]);
  if (recent && recent.n >= FUNDME.donationsPer10Min) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts — please wait a few minutes and try again');

  let payout = null;
  if (provider.needsPayoutAccount) {
    const acct = await one(c.env, `SELECT account_id FROM fundme_payout_accounts WHERE user_id = $1 AND provider = $2 AND charges_enabled`, [f.owner_id, provider.name]);
    if (!acct) throw new ApiError(409, 'OWNER_NOT_ONBOARDED', 'This fundraiser can’t accept card payments yet');
    payout = acct.account_id;
  }

  const d = await one(c.env,
    `INSERT INTO donations (fundraiser_id, donor_id, donor_name, amount_minor, fee_minor, currency, message, anonymous, provider, rl_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [f.id, user ? user.id : null, donorName, amount, platformFee(amount), f.currency, message, anonymous, provider.name, key]);
  const base = `${publicBase(c)}/f/${f.slug}`;
  let checkout;
  try {
    checkout = await provider.createCheckout(d, f, c.env, {
      origin: origin(c), payoutAccount: payout, successUrl: `${base}?donation=succeeded`, cancelUrl: `${base}?donation=cancelled`,
    });
  } catch (e) {
    await q(c.env, `UPDATE donations SET status = 'failed', completed_at = now() WHERE id = $1`, [d.id]);
    throw new ApiError(e.code === 'OWNER_NOT_ONBOARDED' ? 409 : 502, e.code || 'PROVIDER_ERROR', e.message || 'Couldn’t start the payment');
  }
  await q(c.env, 'UPDATE donations SET provider_ref = $2 WHERE id = $1', [d.id, checkout.providerRef]);
  if (isForm) return c.redirect(checkout.url, 303);
  return c.json({ donationId: d.id, checkoutUrl: checkout.url, provider: provider.name, status: 'pending' }, 201);
});

// ---------- TEST provider (PAYMENTS_MODE=test only) ----------
const testOnly = (c) => String(c.env.PAYMENTS_MODE || '').toLowerCase() === 'test';

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
    ref: d.provider_ref, status: d.status, title: d.title, amount: formatMoney(d.amount_minor, d.currency, { cents: true }),
    mainImageUrl: imgUrl(c, d.main_image_key), returnUrl: `${publicBase(c)}/f/${d.slug}`, anonymous: d.anonymous, donorName: d.donor_name,
  }, { nonce }));
});

fundmePublic.post('/webhooks/fundme/test', async (c) => {
  if (!testOnly(c)) return c.notFound();
  const r = await TestProvider.handleWebhook(c.req.raw, c.env);
  if (r.ignored) throw bad(r.error || 'Bad webhook');
  const res = await applyPaymentResult(c.env, 'test', r.providerRef, r.status);
  return c.json({ ok: true, ...res });
});

// ---------- real providers ----------
fundmePublic.post('/webhooks/fundme/:provider', async (c) => {
  const provider = providerByName(c.req.param('provider'));
  if (!provider || provider.name === 'test') return c.notFound();
  if (provider.name === 'stripe' && !c.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: 'Stripe is not configured', code: 'NOT_CONFIGURED' }, 503);
  const r = await provider.handleWebhook(c.req.raw, c.env);
  if (r.invalid) return c.json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' }, 400);
  if (r.ignored) return c.json({ ok: true, ignored: true });
  const res = await applyPaymentResult(c.env, provider.name, r.providerRef, r.status);
  return c.json({ ok: true, ...res });
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
  await q(c.env, `UPDATE fundraisers SET status = 'pending_review', submitted_at = now(), reject_reason = NULL, updated_at = now() WHERE id = $1`, [f.id]);
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
  const rows = await q(c.env, `${FR_SELECT} WHERE f.status = $1 ORDER BY COALESCE(f.submitted_at, f.created_at) ASC LIMIT 100`, [status]);
  const counts = await q(c.env, `SELECT status, COUNT(*)::int AS n FROM fundraisers GROUP BY status`);
  return c.json({
    items: rows.map((f) => ({ ...listShape(c, f), submittedAt: iso(f.submitted_at), rejectReason: f.reject_reason || null, pausedBy: f.paused_by || null })),
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
  });
});
fundme.get('/admin/api/fundme/pending', async (c) => {
  const rows = await q(c.env, `${FR_SELECT} WHERE f.status = 'pending_review' ORDER BY f.submitted_at ASC LIMIT 100`);
  return c.json({ items: rows.map((f) => ({ ...listShape(c, f), submittedAt: iso(f.submitted_at) })) });
});

fundme.get('/admin/api/fundme/:id', async (c) => {
  const id = uuidParam(c);
  const f = await one(c.env, `${FR_SELECT} WHERE f.id = $1`, [id]);
  if (!f) throw notFound('Fundraiser not found');
  const out = await fullShape(c, f, { privileged: true });
  out.ownerId = f.owner_id;
  out.donations = await publicDonations(c.env, f.id);
  return c.json(out);
});

fundme.post('/admin/api/fundme/:id/approve', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const f = await one(c.env,
    `UPDATE fundraisers SET status = 'live', approved_at = COALESCE(approved_at, now()), reviewed_at = now(), reviewed_by = $2,
            paused_by = NULL, reject_reason = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('pending_review','paused') RETURNING *`, [id, me.id]);
  if (!f) throw new ApiError(409, 'BAD_STATUS', 'Only fundraisers waiting for review (or paused) can be approved');
  await notify(c.env, f.owner_id, 'fundme_approved', 'Your fundraiser is live ✨', `“${f.title}” was approved — share your link so people can give.`, { fundraiserId: f.id, slug: f.slug });
  await logAdmin(c.env, me.id, 'fundme.approve', f.id, { title: f.title });
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});

fundme.post('/admin/api/fundme/:id/reject', async (c) => {
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

fundme.post('/admin/api/fundme/:id/pause', async (c) => {
  const id = uuidParam(c);
  const me = c.get('user');
  const f = await one(c.env,
    `UPDATE fundraisers SET status = 'paused', paused_by = 'admin', updated_at = now() WHERE id = $1 AND status IN ('live','paused') RETURNING *`, [id]);
  if (!f) throw new ApiError(409, 'BAD_STATUS', 'Only live fundraisers can be paused');
  await notify(c.env, f.owner_id, 'fundme_paused', 'Your fundraiser was paused', `Our review team paused “${f.title}”. Contact support for details.`, { fundraiserId: f.id, slug: f.slug });
  await logAdmin(c.env, me.id, 'fundme.pause', f.id, { title: f.title });
  return c.json(await fullShape(c, await reload(c.env, f.id), { privileged: true }));
});
