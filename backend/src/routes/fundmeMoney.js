// FUND ME MONEY — HTTP API (monetisation stage 2). Library: lib/fundmeMoney.js. Docs: scratch/monetisation/fundme.md.
// Public parts (Paystack webhook + return, donations, the test checkout) live in routes/fundme.js.
//
// Signed in:
//   GET  /fundme/credits                     balance, publish cost, reserved, limits, my usage
//   GET  /fundme/credits/history?cursor=     purchases, publishes and gifts (wallet history of fundme_credits)
//   GET  /fundme/members?q=                  find a member to send credits to
//   POST /fundme/credits/gift { recipientId, amount, idempotencyKey, note? }   credits only — never cash
//   GET  /fundme/rules                       fees, hold period, minimum payout, plain-words explanation
//   GET  /fundme/donations/mine              my donations with receipts
//   GET  /fundme/donations/:id/receipt       donor, organiser or admin
//   GET  /fundme/fundraisers/:id/money       organiser: totals, donations, payouts with status timelines, bank account
//   GET  /fundme/banks · GET|PUT /fundme/payout-account · POST /fundme/payout-account/resolve
// Admin (/admin/api/fundme/*, role admin, every change in admin_actions):
//   donations (filters + CSV) · donation detail + history · donation actions · payout queue · payouts (+ create, paid,
//   fail, transfer, review) · reconciliation · suspicious queue · bank accounts (verify / reject / reveal) · rules
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { ApiError, bad, body, forbidden, isUuid, notFound, str } from '../lib/http.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import { getConfig, setConfig, history, rateLimit, ledgerIntegrity, walletNotify } from '../lib/wallet.js';
import { formatMoney } from '../lib/money.js';
import {
  creditSummary, giftCredits, donationShape, payoutShape, eventShape, receiptShape, DONATION_ACTIONS, DONATION_LABEL, PAYOUT_LABEL,
  canDonationAction, setDonationStatus, refundDonation, recheckDonation, paystackRefund, createPayout, markPayoutPaid, failPayout,
  setPayoutReview, sendPayoutTransfer, reconciliation, reconciliationByRequest, bankList, bankShape, saveBankAccount, decryptField,
  FUNDME_RULES, curVal, payableHeld,
} from '../lib/fundmeMoney.js';
import { paystackConfigured, resolveAccount } from '../lib/paystack.js';
import { isOn } from '../lib/play.js';
import { FUNDME_MONEY_ADMIN_SCRIPT } from '../lib/fundmeMoneyAdmin.js';

registerAdminScript(FUNDME_MONEY_ADMIN_SCRIPT); // "Donations & payouts" section in Admin › Wallets & payments

const isAdmin = (u) => !!u && u.role === 'admin';
const jv = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
const idParam = (c, name = 'id') => { const v = c.req.param(name); if (!isUuid(v)) throw notFound(); return v; };

export const fundmeMoney = new Hono();

// ---------------------------------------------------------------------------------------------------------------
// Credits (spec §1, §2)
// ---------------------------------------------------------------------------------------------------------------
fundmeMoney.get('/fundme/credits', async (c) => c.json(await creditSummary(c.env, c.get('user').id)));

fundmeMoney.get('/fundme/credits/history', async (c) => {
  const me = c.get('user');
  return c.json(await history(c.env, me.id, { wallet: 'fundme_credits', cursor: c.req.query('cursor') || null, limit: Number(c.req.query('limit')) || 30 }));
});

fundmeMoney.get('/fundme/members', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `fundme_members:${me.id}`, 60, 60);
  const raw = String(c.req.query('q') || '').trim().replace(/^@/, '');
  if (raw.length < 2) return c.json({ items: [] });
  const like = `%${raw.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const rows = await q(c.env, `SELECT id, display_name, handle, avatar_url, verified FROM users
      WHERE id <> $1 AND NOT banned AND kind = 'person' AND (handle ILIKE $2 OR display_name ILIKE $2 OR id::text = $3)
      ORDER BY (lower(handle) = lower($3)) DESC NULLS LAST, display_name LIMIT 20`, [me.id, like, raw]);
  return c.json({ items: rows.map((u) => ({ id: u.id, displayName: u.display_name, handle: u.handle, avatarUrl: u.avatar_url || null, verified: !!u.verified })) });
});

fundmeMoney.post('/fundme/credits/gift', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `fundme_gift:${me.id}`, 10, 60);
  const b = await body(c);
  if (!isUuid(b.recipientId)) throw bad('Choose who to send credits to', 'UNKNOWN_USER');
  const r = await giftCredits(c, me, {
    recipientId: b.recipientId, amount: Number(b.amount), idempotencyKey: b.idempotencyKey, note: str(b.note, { max: 140, field: 'Note', optional: true }),
  });
  return c.json(r, r.applied ? 201 : 200);
});

// ---------------------------------------------------------------------------------------------------------------
// Rules + receipts + organiser money view
// ---------------------------------------------------------------------------------------------------------------
fundmeMoney.get('/fundme/rules', async (c) => {
  const cfg = await getConfig(c.env);
  return c.json({
    feeBps: cfg.fundme_fee_bps, feeFixedMinor: cfg.fundme_fee_fixed_minor, holdDays: cfg.fundme_payout_hold_days, minPayoutMinor: cfg.fundme_min_payout_minor,
    publishCredits: cfg.fundme_publish_credits, paystack: paystackConfigured(c.env), autoPayouts: isOn(c.env.FUNDME_AUTO_PAYOUTS),
    explain: [
      'Every donation is paid to BibleNestra through our payment partner (Paystack) — never straight to the organiser.',
      'BibleNestra holds the money safely and checks each donation.',
      `After a ${cfg.fundme_payout_hold_days}-day hold and our checks, the money is paid out to the organiser’s verified bank account.`,
      'Donors get a receipt in the app. Organisers see every donation and payout with its status.',
    ],
  });
});

fundmeMoney.get('/fundme/donations/mine', async (c) => {
  const me = c.get('user');
  const rows = await q(c.env, `SELECT d.*, f.title AS fundraiser_title, f.slug FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id
      WHERE d.donor_id = $1 AND d.settlement_status <> 'failed' ORDER BY d.created_at DESC LIMIT 100`, [me.id]);
  return c.json({ items: rows.map((d) => donationShape(d, 'donor')) });
});

const DON_SELECT = `SELECT d.*, f.title AS fundraiser_title, f.slug, f.owner_id, b.display_name AS beneficiary_name
  FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id LEFT JOIN users b ON b.id = COALESCE(d.beneficiary_id, f.owner_id)`;

fundmeMoney.get('/fundme/donations/:id/receipt', async (c) => {
  const me = c.get('user');
  const d = await one(c.env, `${DON_SELECT} WHERE d.id = $1`, [idParam(c)]);
  if (!d) throw notFound('Donation not found');
  if (d.donor_id !== me.id && d.owner_id !== me.id && !isAdmin(me)) throw forbidden('Only the donor or the organiser can see this receipt');
  if (!d.received_at) throw new ApiError(409, 'NOT_RECEIVED', 'There is no receipt yet — the payment hasn’t been received');
  const events = await q(c.env, 'SELECT * FROM fundme_donation_events WHERE donation_id = $1 ORDER BY id', [d.id]);
  return c.json({ ...receiptShape(d), timeline: events.filter((e) => e.to_status !== e.from_status).map(eventShape).map((e) => ({ ...e, actorName: null, meta: undefined })) });
});

fundmeMoney.get('/fundme/fundraisers/:id/money', async (c) => {
  const me = c.get('user');
  const f = await one(c.env, 'SELECT * FROM fundraisers WHERE id = $1', [idParam(c)]);
  if (!f) throw notFound('Fundraiser not found');
  if (f.owner_id !== me.id && !isAdmin(me)) throw forbidden('Only the organiser can see this');
  const dons = await q(c.env, `SELECT * FROM donations WHERE fundraiser_id = $1 AND settlement_status <> 'failed' ORDER BY created_at DESC LIMIT 300`, [f.id]);
  const pays = await q(c.env, 'SELECT * FROM fundme_payouts WHERE fundraiser_id = $1 ORDER BY created_at DESC', [f.id]);
  const pev = pays.length ? await q(c.env, 'SELECT * FROM fundme_payout_events WHERE payout_id = ANY($1::uuid[]) ORDER BY id', [pays.map((p) => p.id)]) : [];
  const sum = (pred, field = 'net_minor') => dons.filter(pred).reduce((s, d) => s + Number(d[field] || 0), 0);
  const cfg = await getConfig(c.env);
  const acct = await one(c.env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [f.owner_id]);
  const received = dons.filter((d) => d.received_at);
  return c.json({
    fundraiserId: f.id, currency: f.currency,
    totals: {
      receivedMinor: sum((d) => !!d.received_at, 'amount_minor'),
      feesMinor: sum((d) => !!d.received_at && d.settlement_status !== 'refunded', 'fee_minor'),
      checkingMinor: sum((d) => ['processing', 'under_review'].includes(d.settlement_status)),
      verifiedMinor: sum((d) => d.settlement_status === 'verified'),
      approvedMinor: sum((d) => d.settlement_status === 'approved_for_payout'),
      paidMinor: sum((d) => d.settlement_status === 'paid'),
      refundedMinor: sum((d) => d.settlement_status === 'refunded', 'amount_minor'),
      donations: received.length,
    },
    rules: { holdDays: cfg.fundme_payout_hold_days, minPayoutMinor: curVal(cfg, 'fundme_min_payout_minor', f.currency), feeBps: cfg.fundme_fee_bps, feeFixedMinor: curVal(cfg, 'fundme_fee_fixed_minor', f.currency) },
    donations: dons.map((d) => donationShape(d, 'owner')),
    payouts: pays.map((p) => ({ ...payoutShape(p), timeline: pev.filter((e) => e.payout_id === p.id).map(eventShape).map((e) => ({ ...e, meta: undefined })) })),
    bankAccount: bankShape(acct),
    explain: 'Donations are paid to BibleNestra and held safely. After checks and the hold period they are approved and paid to your verified bank account.',
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Beneficiary bank account
// ---------------------------------------------------------------------------------------------------------------
fundmeMoney.get('/fundme/banks', async (c) => c.json(await bankList(c.env)));

fundmeMoney.get('/fundme/payout-account', async (c) => {
  const me = c.get('user');
  const a = await one(c.env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [me.id]);
  return c.json({ account: bankShape(a), canResolve: paystackConfigured(c.env) });
});

fundmeMoney.post('/fundme/payout-account/resolve', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `fundme_resolve:${me.id}`, 10, 60);
  const b = await body(c);
  const num = String(b.accountNumber || '').replace(/\s+/g, '');
  const code = String(b.bankCode || '').trim();
  if (!/^[0-9]{10}$/.test(num) || !/^[0-9]{2,20}$/.test(code)) throw bad('Choose your bank and enter your 10-digit account number', 'BAD_ACCOUNT_NUMBER');
  if (!paystackConfigured(c.env)) return c.json({ resolved: false, message: 'Name check isn’t switched on yet — type the account name exactly as your bank shows it. Our team checks it.' });
  try {
    const r = await resolveAccount(c.env, { accountNumber: num, bankCode: code });
    return c.json({ resolved: true, accountName: r.accountName });
  } catch (e) {
    throw new ApiError(400, 'ACCOUNT_NOT_FOUND', 'The bank couldn’t find that account number — check it and the bank');
  }
});

fundmeMoney.put('/fundme/payout-account', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `fundme_bank:${me.id}`, 5, 600);
  const b = await body(c);
  const account = await saveBankAccount(c, me, { bankCode: b.bankCode, accountNumber: b.accountNumber, accountName: b.accountName });
  return c.json({ account, note: 'Thanks — our team checks new bank details before any payout. Payouts already approved wait until then.' });
});

// ---------------------------------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------------------------------
fundmeMoney.use('/admin/api/fundme/*', requireAdmin);

function csv(rows, cols) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((x) => x[0]).join(','), ...rows.map((r) => cols.map((x) => cell(x[1](r))).join(','))].join('\n');
}
async function userFilter(env, v) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (isUuid(t)) return t;
  const u = await one(env, 'SELECT id FROM users WHERE lower(handle) = lower($1)', [t.replace(/^@/, '')]);
  return u ? u.id : '00000000-0000-0000-0000-000000000000';
}

fundmeMoney.get('/admin/api/fundme/donations', async (c) => {
  const qq = (k) => c.req.query(k);
  const params = []; const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (qq('status')) {
    if (qq('status') === 'flagged') where.push(`jsonb_array_length(d.risk_flags) > 0`);
    else if (DONATION_LABEL[qq('status')]) add('d.settlement_status = ?', qq('status'));
    else throw bad('Unknown status');
  } else where.push(`d.settlement_status <> 'failed' OR d.received_at IS NOT NULL OR d.created_at > now() - interval '1 day'`);
  if (qq('fundraiserId')) { if (!isUuid(qq('fundraiserId'))) throw bad('fundraiserId must be an id'); add('d.fundraiser_id = ?', qq('fundraiserId')); }
  const ben = await userFilter(c.env, qq('beneficiary')); if (ben) add('COALESCE(d.beneficiary_id, f.owner_id) = ?', ben);
  const donor = await userFilter(c.env, qq('donor')); if (donor) add('d.donor_id = ?', donor);
  if (qq('q')) add(`(d.provider_ref = ? OR d.id::text = $${params.length + 1} OR d.receipt_no = $${params.length + 1} OR d.donor_email ILIKE $${params.length + 1})`, String(qq('q')).trim());
  if (qq('from')) add('d.created_at >= ?::timestamptz', qq('from'));
  if (qq('to')) add(`d.created_at < (?::date + 1)`, qq('to'));
  if (qq('test') === 'true' || qq('test') === 'false') add('d.is_test = ?', qq('test') === 'true');
  if (qq('payoutId') && isUuid(qq('payoutId'))) add('d.payout_id = ?', qq('payoutId'));
  if (qq('cursor') && !Number.isNaN(Date.parse(qq('cursor')))) add('d.created_at < ?::timestamptz', qq('cursor'));
  const isCsv = qq('format') === 'csv';
  const lim = isCsv ? 5000 : 100;
  const wsql = where.length ? `WHERE ${where.map((w) => `(${w})`).join(' AND ')}` : '';
  const rows = await q(c.env, `${DON_SELECT} ${wsql} ORDER BY d.created_at DESC LIMIT ${lim}`, params);
  const items = rows.map((d) => donationShape(d, 'admin'));
  if (isCsv) {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="fundme-donations.csv"');
    return c.body(csv(items, [['created_at', (x) => x.createdAt], ['donation_id', (x) => x.id], ['reference', (x) => x.reference], ['receipt', (x) => x.receiptNo],
      ['status', (x) => x.status], ['amount_minor', (x) => x.amountMinor], ['fee_minor', (x) => x.feeMinor], ['net_minor', (x) => x.netMinor], ['currency', (x) => x.currency],
      ['request', (x) => x.fundraiserTitle], ['request_id', (x) => x.fundraiserId], ['beneficiary_id', (x) => x.beneficiaryId], ['donor_id', (x) => x.donorId],
      ['donor_name', (x) => x.name], ['provider', (x) => x.provider], ['test', (x) => x.test], ['payout_id', (x) => x.payoutId], ['flags', (x) => x.riskFlags.map((f) => f.code).join(' ')]]));
  }
  const counts = await q(c.env, `SELECT settlement_status AS s, COUNT(*)::int AS n FROM donations GROUP BY settlement_status`);
  return c.json({ items, nextCursor: rows.length === lim ? new Date(rows[rows.length - 1].created_at).toISOString() : null, counts: Object.fromEntries(counts.map((r) => [r.s, r.n])), actions: Object.fromEntries(Object.entries(DONATION_ACTIONS).map(([k, v]) => [k, { label: v.label, from: v.from, reason: !!v.reason }])) });
});

fundmeMoney.get('/admin/api/fundme/donations/:id', async (c) => {
  const d = await one(c.env, `${DON_SELECT} WHERE d.id = $1`, [idParam(c)]);
  if (!d) throw notFound('Donation not found');
  const events = await q(c.env, `SELECT e.*, u.display_name AS actor_name FROM fundme_donation_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.donation_id = $1 ORDER BY e.id`, [d.id]);
  const ledger = await q(c.env, `SELECT ref, leg, account, wallet, amount, balance_after, kind, created_at FROM wallet_entries WHERE related_type = 'donation' AND related_id = $1 ORDER BY id`, [d.id]);
  const available = Object.keys(DONATION_ACTIONS).filter((a) => canDonationAction(a, d).ok && (a !== 'recheck' || d.provider === 'paystack'));
  return c.json({ donation: donationShape(d, 'admin'), receipt: d.received_at ? receiptShape(d) : null, history: events.map(eventShape), ledger: ledger.map((e) => ({ ...e, amount: Number(e.amount), balance_after: Number(e.balance_after) })), actions: available });
});

fundmeMoney.post('/admin/api/fundme/donations/:id/:action', async (c) => {
  const me = c.get('user');
  const action = c.req.param('action');
  if (!DONATION_ACTIONS[action]) throw notFound('Unknown action');
  const d = await one(c.env, 'SELECT * FROM donations WHERE id = $1', [idParam(c)]);
  if (!d) throw notFound('Donation not found');
  const b = await body(c).catch(() => ({}));
  const reason = str(b.reason, { max: 500, field: 'Reason', optional: true });
  let res;
  if (action === 'recheck') {
    if (d.provider !== 'paystack') throw new ApiError(409, 'BAD_PROVIDER', 'Only Paystack donations can be re-checked');
    if (!paystackConfigured(c.env)) throw new ApiError(503, 'PAYMENTS_NOT_CONFIGURED', 'Paystack is not set up yet.');
    res = await recheckDonation(c, d);
  } else if (action === 'refund') {
    if (!reason || reason.length < 3) throw bad('Add a short reason', 'REASON_REQUIRED');
    const chk = canDonationAction('refund', d);
    if (!chk.ok) throw new ApiError(409, 'BAD_STATUS', chk.why);
    let gateway = null;
    if (b.viaPaystack === true) gateway = await paystackRefund(c.env, d);
    res = await refundDonation(c.env, d, { actor: 'admin', actorId: me.id, reason });
    res.gateway = gateway;
    if (d.donor_id) {
      await walletNotify(c, { userId: d.donor_id, kind: 'fundme_receipt', title: 'Donation refunded', body: `Your ${formatMoney(d.amount_minor, d.currency)} donation was refunded. It can take a few days to show on your statement.`, data: { screen: 'FundMeReceipt', donationId: d.id } });
    }
  } else {
    res = await setDonationStatus(c.env, d, action, { actor: 'admin', actorId: me.id, reason });
  }
  await audit(c.env, me, `fundme.donation.${action}`, 'donation', d.id, { from: d.settlement_status, reason, reference: d.provider_ref, amountMinor: Number(d.amount_minor), currency: d.currency });
  const now = await one(c.env, `${DON_SELECT} WHERE d.id = $1`, [d.id]);
  return c.json({ ok: true, ...res, donation: donationShape(now, 'admin') });
});

// Bulk: approve every verified donation of a request that is past the hold period.
fundmeMoney.post('/admin/api/fundme/fundraisers/:id/approve-donations', async (c) => {
  const me = c.get('user');
  const fid = idParam(c);
  const cfg = await getConfig(c.env);
  const rows = await q(c.env, `SELECT * FROM donations WHERE fundraiser_id = $1 AND settlement_status = 'verified' AND received_at <= now() - make_interval(days => $2::int)`, [fid, Number(cfg.fundme_payout_hold_days) || 0]);
  let n = 0;
  for (const d of rows) { try { await setDonationStatus(c.env, d, 'approve', { actor: 'admin', actorId: me.id, reason: 'Approved for payout (bulk)' }); n++; } catch (e) { /* changed meanwhile */ } }
  await audit(c.env, me, 'fundme.donation.approve_bulk', 'fundraiser', fid, { approved: n });
  return c.json({ ok: true, approved: n });
});

// Payout queue: per request, what is ready to pay and what is still in the hold / checks.
fundmeMoney.get('/admin/api/fundme/payout-queue', async (c) => {
  const cfg = await getConfig(c.env);
  const rows = await q(c.env, `SELECT f.id, f.title, f.currency, f.owner_id, u.display_name AS owner_name, u.handle AS owner_handle, ba.status AS bank_status, ba.bank_name, ba.account_last4,
      d.is_test,
      COALESCE(SUM(d.net_minor) FILTER (WHERE d.settlement_status = 'approved_for_payout' AND d.payout_id IS NULL), 0)::bigint AS ready,
      COUNT(*) FILTER (WHERE d.settlement_status = 'approved_for_payout' AND d.payout_id IS NULL)::int AS ready_n,
      COALESCE(SUM(d.net_minor) FILTER (WHERE d.settlement_status = 'verified'), 0)::bigint AS verified,
      COUNT(*) FILTER (WHERE d.settlement_status = 'verified' AND d.received_at <= now() - make_interval(days => $1::int))::int AS verified_past_hold,
      COALESCE(SUM(d.net_minor) FILTER (WHERE d.settlement_status IN ('processing','under_review')), 0)::bigint AS checking
    FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id JOIN users u ON u.id = f.owner_id LEFT JOIN fundme_bank_accounts ba ON ba.user_id = f.owner_id
    WHERE d.received_at IS NOT NULL AND d.settlement_status IN ('processing','under_review','verified','approved_for_payout')
    GROUP BY f.id, u.display_name, u.handle, ba.status, ba.bank_name, ba.account_last4, d.is_test ORDER BY ready DESC, verified DESC LIMIT 200`, [Number(cfg.fundme_payout_hold_days) || 0]);
  return c.json({
    holdDays: cfg.fundme_payout_hold_days,
    items: rows.map((r) => ({
      fundraiserId: r.id, title: r.title, currency: r.currency, beneficiaryId: r.owner_id, beneficiaryName: r.owner_name, beneficiaryHandle: r.owner_handle, test: !!r.is_test,
      bank: r.bank_status ? { status: r.bank_status, bankName: r.bank_name, last4: r.account_last4 } : null,
      readyMinor: Number(r.ready), readyCount: r.ready_n, verifiedMinor: Number(r.verified), verifiedPastHold: r.verified_past_hold, checkingMinor: Number(r.checking),
      minPayoutMinor: curVal(cfg, 'fundme_min_payout_minor', r.currency),
    })),
  });
});

const PAY_SELECT = `SELECT p.*, f.title AS fundraiser_title, u.display_name AS beneficiary_name FROM fundme_payouts p
  LEFT JOIN fundraisers f ON f.id = p.fundraiser_id LEFT JOIN users u ON u.id = p.beneficiary_id`;

fundmeMoney.get('/admin/api/fundme/payouts', async (c) => {
  const st = c.req.query('status');
  const params = []; let w = '';
  if (st) { if (!PAYOUT_LABEL[st]) throw bad('Unknown status'); params.push(st); w = 'WHERE p.status = $1'; }
  const ben = await userFilter(c.env, c.req.query('beneficiary'));
  if (ben) { params.push(ben); w += `${w ? ' AND' : 'WHERE'} p.beneficiary_id = $${params.length}`; }
  if (c.req.query('q')) { params.push(String(c.req.query('q')).trim()); w += `${w ? ' AND' : 'WHERE'} (p.provider_ref = $${params.length} OR p.id::text = $${params.length})`; }
  const rows = await q(c.env, `${PAY_SELECT} ${w} ORDER BY p.created_at DESC LIMIT 200`, params);
  const counts = await q(c.env, 'SELECT status, COUNT(*)::int AS n FROM fundme_payouts GROUP BY status');
  return c.json({ items: rows.map(payoutShape), counts: Object.fromEntries(counts.map((r) => [r.status, r.n])), autoPayouts: isOn(c.env.FUNDME_AUTO_PAYOUTS) && paystackConfigured(c.env) });
});

fundmeMoney.get('/admin/api/fundme/payouts/:id', async (c) => {
  const p = await one(c.env, `${PAY_SELECT} WHERE p.id = $1`, [idParam(c)]);
  if (!p) throw notFound('Payout not found');
  const events = await q(c.env, `SELECT e.*, u.display_name AS actor_name FROM fundme_payout_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.payout_id = $1 ORDER BY e.id`, [p.id]);
  const dons = await q(c.env, `${DON_SELECT} WHERE d.payout_id = $1 OR d.id = ANY($2::uuid[]) ORDER BY d.received_at`, [p.id, jv(p.meta, {}).donationIds || []]);
  const acct = await one(c.env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [p.beneficiary_id]);
  return c.json({ payout: payoutShape(p), history: events.map(eventShape), donations: dons.map((d) => donationShape(d, 'admin')), bankAccount: bankShape(acct, { admin: true }), held: await payableHeld(c.env, p.beneficiary_id, p.currency) });
});

fundmeMoney.post('/admin/api/fundme/payouts', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (!isUuid(b.fundraiserId)) throw bad('fundraiserId is required');
  const p = await createPayout(c.env, me, b.fundraiserId, { test: b.test === true });
  await audit(c.env, me, 'fundme.payout.create', 'payout', p.id, { fundraiserId: b.fundraiserId, amountMinor: Number(p.amount_minor), currency: p.currency, test: b.test === true });
  return c.json({ payout: payoutShape(p) }, 201);
});

fundmeMoney.post('/admin/api/fundme/payouts/:id/:action', async (c) => {
  const me = c.get('user');
  const action = c.req.param('action');
  const p = await one(c.env, 'SELECT * FROM fundme_payouts WHERE id = $1', [idParam(c)]);
  if (!p) throw notFound('Payout not found');
  const b = await body(c).catch(() => ({}));
  const reason = str(b.reason, { max: 500, field: 'Reason', optional: true });
  let res;
  if (action === 'paid') res = await markPayoutPaid(c, p, { reference: b.reference, actor: 'admin', actorId: me.id, note: reason });
  else if (action === 'fail') res = await failPayout(c, p, { reason, actor: 'admin', actorId: me.id });
  else if (action === 'transfer') res = await sendPayoutTransfer(c, p, me);
  else if (action === 'review') res = await setPayoutReview(c.env, p, { to: 'under_review', reason, actorId: me.id });
  else if (action === 'clear') res = await setPayoutReview(c.env, p, { to: 'approved', reason, actorId: me.id });
  else throw notFound('Unknown action');
  await audit(c.env, me, `fundme.payout.${action}`, 'payout', p.id, { from: p.status, reason, reference: b.reference || null, amountMinor: Number(p.amount_minor), currency: p.currency });
  const now = await one(c.env, `${PAY_SELECT} WHERE p.id = $1`, [p.id]);
  return c.json({ ok: true, ...res, payout: payoutShape(now) });
});

fundmeMoney.get('/admin/api/fundme/reconciliation', async (c) => {
  const fid = c.req.query('fundraiserId');
  const overall = await reconciliation(c.env, { fundraiserId: fid && isUuid(fid) ? fid : null });
  const perRequest = fid ? [] : await reconciliationByRequest(c.env);
  const integrity = await ledgerIntegrity(c.env);
  const payouts = await q(c.env, `SELECT currency, status, COUNT(*)::int AS n, COALESCE(SUM(amount_minor),0)::bigint AS total FROM fundme_payouts GROUP BY currency, status`);
  if (c.req.query('format') === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="fundme-reconciliation.csv"');
    return c.body(csv(perRequest, [['request_id', (x) => x.fundraiserId], ['title', (x) => x.title], ['beneficiary_id', (x) => x.beneficiaryId], ['currency', (x) => x.currency],
      ['donations', (x) => x.donations], ['received_minor', (x) => x.receivedMinor], ['fees_minor', (x) => x.feesMinor], ['refunded_minor', (x) => x.refundedMinor],
      ['paid_minor', (x) => x.paidMinor], ['held_minor', (x) => x.heldMinor], ['balanced', (x) => x.balanced], ['has_test', (x) => x.hasTest]]));
  }
  return c.json({ ...overall, perRequest, integrity, payouts: payouts.map((r) => ({ currency: r.currency, status: r.status, count: r.n, totalMinor: Number(r.total) })) });
});

fundmeMoney.get('/admin/api/fundme/suspicious', async (c) => {
  const dons = await q(c.env, `${DON_SELECT} WHERE d.settlement_status = 'under_review' OR (jsonb_array_length(d.risk_flags) > 0 AND d.settlement_status NOT IN ('refunded','failed','paid')) ORDER BY d.created_at DESC LIMIT 100`);
  const reqs = await q(c.env, `SELECT f.id, f.title, f.status, f.risk_flags, f.owner_id, u.display_name AS owner_name, f.submitted_at FROM fundraisers f JOIN users u ON u.id = f.owner_id
      WHERE jsonb_array_length(f.risk_flags) > 0 AND f.status IN ('pending_review','live','paused') ORDER BY f.submitted_at DESC NULLS LAST LIMIT 100`);
  const pays = await q(c.env, `${PAY_SELECT} WHERE p.status = 'under_review' ORDER BY p.created_at DESC LIMIT 100`);
  const banks = await q(c.env, `SELECT a.*, u.display_name, u.handle FROM fundme_bank_accounts a JOIN users u ON u.id = a.user_id WHERE a.status = 'pending_review' ORDER BY a.updated_at LIMIT 100`);
  return c.json({
    donations: dons.map((d) => donationShape(d, 'admin')),
    requests: reqs.map((f) => ({ id: f.id, title: f.title, status: f.status, riskFlags: jv(f.risk_flags, []), ownerId: f.owner_id, ownerName: f.owner_name, submittedAt: f.submitted_at })),
    payouts: pays.map(payoutShape),
    bankAccounts: banks.map((a) => ({ ...bankShape(a, { admin: true }), displayName: a.display_name, handle: a.handle })),
  });
});

fundmeMoney.get('/admin/api/fundme/bank-accounts', async (c) => {
  const st = c.req.query('status') || 'pending_review';
  if (!['pending_review', 'verified', 'rejected'].includes(st)) throw bad('Unknown status');
  const rows = await q(c.env, `SELECT a.*, u.display_name, u.handle FROM fundme_bank_accounts a JOIN users u ON u.id = a.user_id WHERE a.status = $1 ORDER BY a.updated_at DESC LIMIT 200`, [st]);
  return c.json({ items: rows.map((a) => ({ ...bankShape(a, { admin: true }), displayName: a.display_name, handle: a.handle })) });
});

fundmeMoney.post('/admin/api/fundme/bank-accounts/:userId/:action', async (c) => {
  const me = c.get('user');
  const uid = idParam(c, 'userId');
  const action = c.req.param('action');
  const a = await one(c.env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [uid]);
  if (!a) throw notFound('No bank account saved');
  const b = await body(c).catch(() => ({}));
  const note = str(b.reason, { max: 500, field: 'Reason', optional: true });
  if (action === 'reveal') {
    // full number for a manual bank transfer — every reveal is logged
    await audit(c.env, me, 'fundme.bank.reveal', 'user', uid, { last4: a.account_last4 });
    return c.json({ accountNumber: await decryptField(c.env, a.account_number_enc), bankName: a.bank_name, bankCode: a.bank_code, accountName: a.account_name });
  }
  if (!['verify', 'reject'].includes(action)) throw notFound('Unknown action');
  if (action === 'reject' && (!note || note.length < 3)) throw bad('Add a short reason', 'REASON_REQUIRED');
  const status = action === 'verify' ? 'verified' : 'rejected';
  const r = await one(c.env, `UPDATE fundme_bank_accounts SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE user_id = $1 AND updated_at = $5 RETURNING *`, [uid, status, note, me.id, a.updated_at]);
  if (!r) throw new ApiError(409, 'STATE_CHANGED', 'The member changed these details meanwhile — reload');
  await audit(c.env, me, `fundme.bank.${action}`, 'user', uid, { last4: a.account_last4, bank: a.bank_name, note });
  await walletNotify(c, { userId: uid, kind: 'fundme_payout', title: action === 'verify' ? 'Bank details confirmed' : 'Please check your bank details', body: action === 'verify' ? `Payouts will go to ${a.bank_name} •••• ${a.account_last4}.` : `We couldn’t confirm your bank details: ${note}`, data: { screen: 'FundMePayoutAccount' } });
  return c.json({ account: bankShape(r, { admin: true }) });
});

fundmeMoney.get('/admin/api/fundme/rules', async (c) => {
  const cfg = await getConfig(c.env);
  return c.json({
    rules: Object.entries(FUNDME_RULES).map(([key, r]) => ({ key, value: cfg[key], default: r.dflt, label: r.label })).concat([{ key: 'fundme_publish_credits', value: cfg.fundme_publish_credits, default: 1, label: 'Credits used to publish one request (wallet core setting)' }]),
    env: { paystack: paystackConfigured(c.env), autoPayouts: isOn(c.env.FUNDME_AUTO_PAYOUTS), testDonations: isOn(c.env.WALLET_TEST_PURCHASES) || String(c.env.PAYMENTS_MODE || '').toLowerCase() === 'test' },
  });
});

fundmeMoney.put('/admin/api/fundme/rules', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (!(b.key in FUNDME_RULES) && b.key !== 'fundme_publish_credits') throw bad('Not a Fund Me rule', 'BAD_CONFIG');
  const before = (await getConfig(c.env))[b.key];
  await setConfig(c.env, b.key, b.value, me.id);
  await audit(c.env, me, 'fundme.rules.set', 'config', b.key, { before, after: b.value });
  return c.json({ ok: true, key: b.key, value: (await getConfig(c.env))[b.key] });
});

