// VIRTUAL GIFTS & STARS — HTTP API. Library: lib/virtualGifts.js · admin section: lib/giftsAdminPage.js ·
// contract: scratch/monetisation/gifts.md. (The legacy Kingdom Coin gift route POST /gifts lives in routes/gifts.js.)
//
// Signed in:
//   GET  /gifts/catalogue?context=chat|profile|live|post   active gifts with Gifting Coin cost + rules + my balance
//   POST /gifts/send { giftId, context: { type, id }, recipientId?, note?, idempotencyKey }
//        context { type: 'support' } = Support BibleNestra: to the official account, 100% platform revenue (ref support:<id>)
//   GET  /gifts/history?dir=sent|received|all&cursor=       my gifts (both directions) + totals
//   GET  /gifts/wall/:userId                                a profile's gifts wall
//   GET  /gifts/earnings                                    earnings by state, rules, programme, withdrawals
//   POST /gifts/programme { legalName, bankName, accountName, accountNumber, country?, about? }   apply
//   POST /gifts/withdrawals { coins, idempotencyKey }       behind earnings_withdrawals_enabled + approval
//   GET  /live-sessions · POST /live-sessions { title } · POST /live-sessions/:id/end · GET /live-sessions/:id?after=
// Admin (/admin/api/gifts/*): catalogue CRUD + art upload (R2), sends search (+CSV), commission ledger (+reconciliation),
// recipient earnings, creator programme decisions, withdrawal queue. Commission % = core setting gift_commission_bps
// (PUT /admin/api/wallet/config).
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { ApiError, bad, body, isUuid, notFound, forbidden, str, uuidParam } from '../lib/http.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import { getConfig, getBalance, ledgerIntegrity, walletNotify, withdrawalMinimum } from '../lib/wallet.js';
import {
  CONTEXTS, listCatalogue, cleanGiftInput, giftShape, sendGift, giftHistory, giftWall, earningsSummary, applyProgramme,
  requestWithdrawal, decideWithdrawal, programmeShape, withdrawalShape, sendShape, SEND_SELECT, liveShape, LIVE_SELECT, EXPLAIN,
  SEND_CONTEXTS, SUPPORT_LABEL,
} from '../lib/virtualGifts.js';
import { GIFTS_ADMIN_SCRIPT } from '../lib/giftsAdminPage.js';

registerAdminScript(GIFTS_ADMIN_SCRIPT);

export const giftsApp = new Hono();

giftsApp.get('/gifts/catalogue', async (c) => {
  const me = c.get('user');
  const context = c.req.query('context') || null;
  const { cfg, items } = await listCatalogue(c, { context });
  const min = withdrawalMinimum(cfg);
  return c.json({
    items,
    balance: await getBalance(c.env, me.id, 'gift_coins'),
    rules: {
      commissionPct: cfg.gift_commission_bps / 100, holdDays: cfg.earnings_hold_days, withdrawalsEnabled: !!cfg.earnings_withdrawals_enabled, enabled: !!cfg.gifts_enabled,
      minWithdrawal: min.coins, minWithdrawalUsd: min.usd, minWithdrawalLabel: min.label, usdNgnRate: min.usdNgnRate, explain: EXPLAIN(cfg),
    },
    // Support BibleNestra: send any gift with context { type: 'support' }; 100% goes to BibleNestra
    support: { context: { type: 'support' }, label: SUPPORT_LABEL, platformPct: 100 },
    rate: cfg.gift_coin_rate,
  });
});

giftsApp.post('/gifts/send', async (c) => {
  const me = c.get('user');
  const r = await sendGift(c, me, await body(c));
  return c.json(r, r.duplicate ? 200 : 201);
});

giftsApp.get('/gifts/history', async (c) => {
  const me = c.get('user');
  const dir = ['sent', 'received'].includes(c.req.query('dir')) ? c.req.query('dir') : 'all';
  return c.json(await giftHistory(c, me.id, { dir, cursor: c.req.query('cursor'), limit: c.req.query('limit') }));
});

giftsApp.get('/gifts/wall/:userId', async (c) => {
  const id = uuidParam(c, 'userId');
  return c.json(await giftWall(c, id));
});

giftsApp.get('/gifts/earnings', async (c) => c.json(await earningsSummary(c, c.get('user').id)));

giftsApp.post('/gifts/programme', async (c) => {
  const me = c.get('user');
  const programme = await applyProgramme(c.env, me.id, await body(c));
  return c.json({ programme }, 201);
});

giftsApp.post('/gifts/withdrawals', async (c) => {
  const me = c.get('user');
  const r = await requestWithdrawal(c, me, await body(c));
  return c.json(r, r.duplicate ? 200 : 201);
});

// ---------- live sessions (host + live flag, for live gifting) ----------
giftsApp.get('/live-sessions', async (c) => {
  const rows = await q(c.env, `${LIVE_SELECT} WHERE l.status = 'live' AND NOT u.banned ORDER BY l.started_at DESC LIMIT 50`);
  return c.json({ items: rows.map(liveShape) });
});
giftsApp.post('/live-sessions', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, { min: 1, max: 120, field: 'title' });
  const cur = await one(c.env, `SELECT id FROM live_sessions WHERE host_id = $1 AND status = 'live'`, [me.id]);
  if (cur) return c.json(liveShape(await one(c.env, `${LIVE_SELECT} WHERE l.id = $1`, [cur.id])));
  const row = await one(c.env, `INSERT INTO live_sessions (host_id, title) VALUES ($1, $2)
    ON CONFLICT (host_id) WHERE status = 'live' DO NOTHING RETURNING id`, [me.id, title]);
  const id = row ? row.id : (await one(c.env, `SELECT id FROM live_sessions WHERE host_id = $1 AND status = 'live'`, [me.id])).id;
  return c.json(liveShape(await one(c.env, `${LIVE_SELECT} WHERE l.id = $1`, [id])), 201);
});
giftsApp.post('/live-sessions/:id/end', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const s = await one(c.env, 'SELECT * FROM live_sessions WHERE id = $1', [id]);
  if (!s) throw notFound('Live session not found');
  if (s.host_id !== me.id && me.role !== 'admin') throw forbidden('Only the host can end this live session');
  await q(c.env, `UPDATE live_sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'live'`, [id]);
  return c.json(liveShape(await one(c.env, `${LIVE_SELECT} WHERE l.id = $1`, [id])));
});
// the session + gifts sent in it (after = ISO time, for the on-stream animation overlay polling)
giftsApp.get('/live-sessions/:id', async (c) => {
  const id = uuidParam(c);
  const s = await one(c.env, `${LIVE_SELECT} WHERE l.id = $1`, [id]);
  if (!s) throw notFound('Live session not found');
  const after = c.req.query('after');
  const t = after && !Number.isNaN(Date.parse(after)) ? new Date(after).toISOString() : null;
  const rows = await q(c.env, `${SEND_SELECT} WHERE s.context_type = 'live' AND s.context_id = $1 AND ($2::timestamptz IS NULL OR s.created_at > $2::timestamptz)
    ORDER BY s.created_at DESC LIMIT 20`, [id, t]);
  const cfg = await getConfig(c.env);
  return c.json({ session: liveShape(s), gifts: rows.map((r) => { const x = sendShape(c, r, cfg.gift_coin_rate); return { id: x.id, gift: x.gift, sender: x.sender, createdAt: x.createdAt }; }) });
});

// ---------------------------------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------------------------------
export const adminGifts = new Hono();
adminGifts.use('/admin/api/gifts/*', requireAdmin);

function csv(rows, cols) {
  const cell = (v) => {
    if (v == null) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((x) => x[0]).join(','), ...rows.map((r) => cols.map((x) => cell(x[1](r))).join(','))].join('\r\n');
}
function sendCsv(c, name, text) {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${name}"`);
  return c.body(text);
}
const dateQ = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// ----- catalogue -----
adminGifts.get('/admin/api/gifts/catalogue', async (c) => {
  const { cfg, items } = await listCatalogue(c, { all: true });
  const counts = await q(c.env, 'SELECT gift_id, COUNT(*)::int AS n, COALESCE(SUM(coins),0)::bigint AS coins FROM gift_sends GROUP BY gift_id');
  const by = Object.fromEntries(counts.map((r) => [r.gift_id, { sent: r.n, coins: Number(r.coins) }]));
  return c.json({ items: items.map((g) => ({ ...g, stats: by[g.id] || { sent: 0, coins: 0 } })), rate: cfg.gift_coin_rate, commissionBps: cfg.gift_commission_bps, contexts: CONTEXTS });
});
adminGifts.post('/admin/api/gifts/catalogue', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const id = String(b.id || '');
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(id)) throw bad('id must be lower-case letters, digits and _ (2-41 chars)', 'BAD_ID');
  const o = cleanGiftInput(b);
  if (await one(c.env, 'SELECT 1 FROM gift_catalogue WHERE id = $1', [id])) throw new ApiError(409, 'GIFT_EXISTS', 'A gift with that id already exists');
  const cols = ['id', ...Object.keys(o)];
  const vals = [id, ...Object.values(o)];
  await q(c.env, `INSERT INTO gift_catalogue (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
  await audit(c.env, me, 'gift_catalogue_create', 'gift', id, o);
  const cfg = await getConfig(c.env);
  return c.json(giftShape(c, await one(c.env, 'SELECT * FROM gift_catalogue WHERE id = $1', [id]), cfg.gift_coin_rate, { admin: true }), 201);
});
adminGifts.patch('/admin/api/gifts/catalogue/:id', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  const cur = await one(c.env, 'SELECT * FROM gift_catalogue WHERE id = $1', [id]);
  if (!cur) throw notFound('Gift not found');
  const o = cleanGiftInput(await body(c), { partial: true });
  const keys = Object.keys(o);
  if (keys.length) {
    await q(c.env, `UPDATE gift_catalogue SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => o[k])]);
    await audit(c.env, me, 'gift_catalogue_update', 'gift', id, { before: Object.fromEntries(keys.map((k) => [k, cur[k]])), after: o });
  }
  const cfg = await getConfig(c.env);
  return c.json(giftShape(c, await one(c.env, 'SELECT * FROM gift_catalogue WHERE id = $1', [id]), cfg.gift_coin_rate, { admin: true }));
});
// Upload replacement art: raw body (image/png | image/webp | image/gif | image/jpeg, ≤ 5 MB) → R2 img/gifts/<id>/…
const ART_TYPES = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/jpeg': 'jpg' };
adminGifts.post('/admin/api/gifts/catalogue/:id/art', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  const slot = c.req.query('slot') === 'animation' ? 'animation_key' : 'image_key';
  if (!(await one(c.env, 'SELECT 1 FROM gift_catalogue WHERE id = $1', [id]))) throw notFound('Gift not found');
  if (!c.env.MEDIA) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED', 'Media storage (R2 bucket binding MEDIA) is not configured');
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = ART_TYPES[type];
  if (!ext) throw bad('Upload a PNG, WebP, GIF or JPEG image (animated GIF / WebP for animations)', 'BAD_IMAGE_TYPE');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw bad('Empty upload');
  if (buf.byteLength > 5 * 1024 * 1024) throw new ApiError(413, 'TOO_LARGE', 'Gift art must be under 5 MB');
  const key = `img/gifts/${id}/${crypto.randomUUID()}.${ext}`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  await q(c.env, `UPDATE gift_catalogue SET ${slot} = $2, updated_at = now() WHERE id = $1`, [id, key]);
  await audit(c.env, me, 'gift_catalogue_art', 'gift', id, { slot, key });
  const cfg = await getConfig(c.env);
  return c.json(giftShape(c, await one(c.env, 'SELECT * FROM gift_catalogue WHERE id = $1', [id]), cfg.gift_coin_rate, { admin: true }), 201);
});
adminGifts.delete('/admin/api/gifts/catalogue/:id/art', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  const slot = c.req.query('slot') === 'animation' ? 'animation_key' : 'image_key';
  await q(c.env, `UPDATE gift_catalogue SET ${slot} = NULL, updated_at = now() WHERE id = $1`, [id]);
  await audit(c.env, me, 'gift_catalogue_art_remove', 'gift', id, { slot });
  return c.json({ ok: true });
});

// ----- all gifts sent / received (search by user id / @handle, reference, date, gift, context) -----
async function resolveUser(env, qv) {
  if (!qv) return null;
  if (isUuid(qv)) return qv;
  const h = String(qv).replace(/^@/, '').toLowerCase();
  const u = await one(env, 'SELECT id FROM users WHERE lower(handle) = $1 LIMIT 1', [h]);
  return u ? u.id : '00000000-0000-0000-0000-000000000000';
}
adminGifts.get('/admin/api/gifts/sends', async (c) => {
  const qv = (c.req.query('q') || '').trim();
  const userId = await resolveUser(c.env, qv);
  const role = ['sent', 'received'].includes(c.req.query('role')) ? c.req.query('role') : 'any';
  const ref = (c.req.query('ref') || '').trim() || null;
  const giftId = c.req.query('giftId') || null;
  const ctx = SEND_CONTEXTS.includes(c.req.query('context')) ? c.req.query('context') : null;
  const from = dateQ(c.req.query('from')); const to = dateQ(c.req.query('to'));
  const isCsv = c.req.query('format') === 'csv';
  const limit = isCsv ? 5000 : Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  const offset = isCsv ? 0 : Math.max(0, Number(c.req.query('offset')) || 0);
  const userCond = role === 'sent' ? 's.sender_id = $1' : role === 'received' ? 's.recipient_id = $1' : '(s.sender_id = $1 OR s.recipient_id = $1)';
  const rows = await q(c.env, `${SEND_SELECT}
    WHERE ($1::uuid IS NULL OR ${userCond}) AND ($2::text IS NULL OR s.ref LIKE $2 || '%' OR s.id::text = $2)
      AND ($3::text IS NULL OR s.gift_id = $3) AND ($4::text IS NULL OR s.context_type = $4)
      AND ($5::timestamptz IS NULL OR s.created_at >= $5) AND ($6::timestamptz IS NULL OR s.created_at < $6)
    ORDER BY s.created_at DESC, s.id DESC LIMIT $7 OFFSET $8`, [userId, ref, giftId, ctx, from, to, limit, offset]);
  const cfg = await getConfig(c.env);
  const items = rows.map((r) => sendShape(c, r, cfg.gift_coin_rate));
  if (isCsv) {
    return sendCsv(c, 'gifts.csv', csv(items, [
      ['created_at', (x) => x.createdAt], ['ref', (x) => x.ref], ['gift', (x) => x.giftName], ['coins', (x) => x.coins], ['commission', (x) => x.commission],
      ['earnings', (x) => x.earnings], ['commission_pct', (x) => x.commissionPct], ['sender_id', (x) => x.sender && x.sender.id], ['sender', (x) => x.sender && x.sender.displayName],
      ['recipient_id', (x) => x.recipient && x.recipient.id], ['recipient', (x) => x.recipient && x.recipient.displayName], ['context', (x) => x.context.type], ['context_id', (x) => x.context.id],
    ]));
  }
  return c.json({ items, offset, nextOffset: items.length === limit ? offset + limit : null });
});

// ----- commission ledger (spec §15 F) -----
adminGifts.get('/admin/api/gifts/commission', async (c) => {
  const group = c.req.query('group') === 'month' ? 'month' : 'day';
  const from = dateQ(c.req.query('from')); const to = dateQ(c.req.query('to'));
  const periods = await q(c.env, `SELECT date_trunc('${group}', created_at) AS period, COUNT(*)::int AS gifts, SUM(coins)::bigint AS coins,
      SUM(commission)::bigint AS commission, SUM(earnings)::bigint AS earnings
    FROM gift_sends WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2)
    GROUP BY 1 ORDER BY 1 DESC LIMIT 400`, [from, to]);
  const perGift = await q(c.env, `SELECT s.gift_id, MAX(s.gift_name) AS name, COUNT(*)::int AS gifts, SUM(s.coins)::bigint AS coins, SUM(s.commission)::bigint AS commission, SUM(s.earnings)::bigint AS earnings
    FROM gift_sends s WHERE ($1::timestamptz IS NULL OR s.created_at >= $1) AND ($2::timestamptz IS NULL OR s.created_at < $2)
    GROUP BY s.gift_id ORDER BY SUM(s.commission) DESC`, [from, to]);
  // reconciliation: business rows vs the ledger (all time)
  // Support BibleNestra gifts (ref 'support:<id>', kinds support_sent / support_received) are included: 100% commission
  const rows = await one(c.env, `SELECT COUNT(*)::int AS n, COALESCE(SUM(coins),0)::bigint AS coins, COALESCE(SUM(commission),0)::bigint AS commission, COALESCE(SUM(earnings),0)::bigint AS earnings,
      COUNT(*) FILTER (WHERE ref LIKE 'support:%')::int AS support_n, COALESCE(SUM(coins) FILTER (WHERE ref LIKE 'support:%'), 0)::bigint AS support_coins FROM gift_sends`);
  const led = await one(c.env, `SELECT
      COALESCE(-SUM(amount) FILTER (WHERE kind IN ('gift_sent','support_sent') AND wallet = 'gift_coins'), 0)::bigint AS sent,
      COALESCE(SUM(amount) FILTER (WHERE kind IN ('gift_commission','support_received') AND wallet = 'commission_gift_coins'), 0)::bigint AS commission,
      COALESCE(SUM(amount) FILTER (WHERE kind = 'gift_received' AND wallet = 'gift_earnings'), 0)::bigint AS earnings,
      COUNT(DISTINCT ref)::int AS ops
    FROM wallet_entries WHERE ref LIKE 'gift:%' OR ref LIKE 'support:%'`);
  const bal = await one(c.env, `SELECT COALESCE(balance, 0)::bigint AS b FROM wallet_balances WHERE account = 'platform' AND wallet = 'commission_gift_coins'`);
  const integrity = await ledgerIntegrity(c.env);
  const n = (v) => Number(v || 0);
  const recon = {
    giftRows: rows.n, ledgerOps: led.ops,
    coins: { rows: n(rows.coins), ledger: n(led.sent) }, commission: { rows: n(rows.commission), ledger: n(led.commission), platformBalance: n(bal && bal.b) },
    earnings: { rows: n(rows.earnings), ledger: n(led.earnings) },
    support: { gifts: rows.support_n, coins: n(rows.support_coins) },
  };
  recon.ok = recon.giftRows === recon.ledgerOps && recon.coins.rows === recon.coins.ledger && recon.commission.rows === recon.commission.ledger
    && recon.commission.ledger === recon.commission.platformBalance && recon.earnings.rows === recon.earnings.ledger
    && recon.coins.rows === recon.commission.rows + recon.earnings.rows;
  const cfg = await getConfig(c.env);
  const conv = (rows2) => rows2.map((r) => ({ ...r, coins: n(r.coins), commission: n(r.commission), earnings: n(r.earnings) }));
  const data = { group, periods: conv(periods).map((p) => ({ ...p, period: new Date(p.period).toISOString() })), perGift: conv(perGift), reconciliation: recon, integrity, commissionBps: cfg.gift_commission_bps, rate: cfg.gift_coin_rate };
  if (c.req.query('format') === 'csv') {
    return sendCsv(c, `gift-commission-by-${group}.csv`, csv(data.periods, [['period', (x) => x.period.slice(0, group === 'month' ? 7 : 10)], ['gifts', (x) => x.gifts], ['coins', (x) => x.coins], ['commission', (x) => x.commission], ['earnings', (x) => x.earnings]]));
  }
  return c.json(data);
});

// ----- recipient earnings -----
adminGifts.get('/admin/api/gifts/earnings', async (c) => {
  const qv = (c.req.query('q') || '').trim();
  const userId = await resolveUser(c.env, qv);
  const rows = await q(c.env, `SELECT u.id, u.display_name, u.handle, COUNT(s.id)::int AS gifts, COALESCE(SUM(s.earnings),0)::bigint AS earnings, COALESCE(SUM(s.coins),0)::bigint AS value,
      (SELECT COALESCE(json_object_agg(b.wallet, b.balance), '{}'::json) FROM wallet_balances b WHERE b.account = u.id::text AND b.wallet LIKE 'gift_earnings%') AS balances,
      p.status AS programme
    FROM gift_sends s JOIN users u ON u.id = s.recipient_id LEFT JOIN gift_creator_programme p ON p.user_id = u.id
    WHERE ($1::uuid IS NULL OR u.id = $1)
    GROUP BY u.id, p.status ORDER BY SUM(s.earnings) DESC LIMIT 100`, [userId]);
  return c.json({ items: rows.map((r) => {
    const b = typeof r.balances === 'string' ? JSON.parse(r.balances) : (r.balances || {});
    return { user: { id: r.id, displayName: r.display_name, handle: r.handle }, gifts: r.gifts, earnings: Number(r.earnings), value: Number(r.value), programme: r.programme || 'none',
      balances: { pending: Number(b.gift_earnings || 0), available: Number(b.gift_earnings_available || 0), withdrawing: Number(b.gift_earnings_withdrawing || 0), withdrawn: Number(b.gift_earnings_withdrawn || 0) } };
  }) });
});

// ----- creator payout programme -----
adminGifts.get('/admin/api/gifts/programme', async (c) => {
  const status = ['pending', 'approved', 'rejected', 'suspended'].includes(c.req.query('status')) ? c.req.query('status') : null;
  const rows = await q(c.env, `SELECT p.*, u.display_name, u.handle FROM gift_creator_programme p JOIN users u ON u.id = p.user_id
    WHERE ($1::text IS NULL OR p.status = $1) ORDER BY (p.status = 'pending') DESC, p.applied_at DESC LIMIT 200`, [status]);
  return c.json({ items: rows.map((r) => ({ ...programmeShape(r, { admin: true }), user: { id: r.user_id, displayName: r.display_name, handle: r.handle } })) });
});
adminGifts.post('/admin/api/gifts/programme/:userId', async (c) => {
  const me = c.get('user');
  const userId = uuidParam(c, 'userId');
  const b = await body(c);
  if (!['approved', 'rejected', 'suspended'].includes(b.status)) throw bad('status must be approved, rejected or suspended');
  const note = str(b.note || '', { max: 500, field: 'note' }) || null;
  const r = await one(c.env, `UPDATE gift_creator_programme SET status = $2, admin_note = $3, decided_at = now(), decided_by = $4 WHERE user_id = $1 RETURNING *`, [userId, b.status, note, me.id]);
  if (!r) throw notFound('No application for this member');
  await audit(c.env, me, 'gift_programme_' + b.status, 'user', userId, { note });
  await walletNotify(c, { userId, kind: 'gift', title: b.status === 'approved' ? 'Creator payout programme: approved' : b.status === 'rejected' ? 'Creator payout programme: not approved' : 'Creator payout programme: suspended',
    body: b.status === 'approved' ? 'You can withdraw available gift earnings when withdrawals are open.' : (note || 'Contact support for details.'), data: { wallet: 'gift_earnings', screen: 'GiftEarnings' } });
  return c.json(programmeShape(r, { admin: true }));
});

// ----- withdrawal queue -----
adminGifts.get('/admin/api/gifts/withdrawals', async (c) => {
  const status = ['requested', 'approved', 'paid', 'rejected'].includes(c.req.query('status')) ? c.req.query('status') : null;
  const rows = await q(c.env, `SELECT w.*, CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'displayName', u.display_name, 'handle', u.handle) END AS user
    FROM gift_withdrawals w LEFT JOIN users u ON u.id = w.user_id
    WHERE ($1::text IS NULL OR w.status = $1) ORDER BY (w.status IN ('requested','approved')) DESC, w.created_at DESC LIMIT 200`, [status]);
  const cfg = await getConfig(c.env);
  const min = withdrawalMinimum(cfg);
  return c.json({ items: rows.map((r) => withdrawalShape(r, { admin: true })), withdrawalsEnabled: !!cfg.earnings_withdrawals_enabled, payoutRate: cfg.earnings_payout_rate, minWithdrawal: min.coins, minWithdrawalLabel: min.label });
});
adminGifts.post('/admin/api/gifts/withdrawals/:id/:action', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const action = c.req.param('action');
  const b = await body(c).catch(() => ({}));
  const w = await decideWithdrawal(c, me, id, action, b || {});
  await audit(c.env, me, 'gift_withdrawal_' + action, 'gift_withdrawal', id, { reference: b && b.reference, note: b && b.note });
  return c.json(w);
});
