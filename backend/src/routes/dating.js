// FIND LOVE routes. Signed in: /dating/* · Admin: /admin/api/dating/* (+ the "Dating" section of Wallets & payments).
// Logic: lib/dating.js · notes: scratch/monetisation/dating.md. Money-moving endpoints are rate limited and take the
// app's idempotencyKey; the app confirms every coin use first (<ConfirmSpend/>).
import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { body, bad, notFound, uuidParam, isUuid, str } from '../lib/http.js';
import { requireAdmin, audit, registerAdminScript } from './admin.js';
import { setConfig, rateLimit, KINDS } from '../lib/wallet.js';
import * as D from '../lib/dating.js';
import { DATING_ADMIN_SCRIPT } from '../lib/datingAdminPage.js';

registerAdminScript(DATING_ADMIN_SCRIPT);

const ctxOf = (c) => ({ env: c.env, origin: new URL(c.req.url).origin });

// ─── app ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const datingApp = new Hono();

datingApp.get('/dating/me', async (c) => c.json(await D.datingHome(c.env, c.get('user'), ctxOf(c))));

datingApp.put('/dating/profile', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `dating_profile:${me.id}`, 30, 3600);
  const r = await D.saveProfile(c.env, me, await body(c));
  return c.json({ ...r, profile: await D.myProfile(c.env, me.id, ctxOf(c)) }, r.created ? 201 : 200);
});
datingApp.post('/dating/profile/photos', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `dating_photo:${me.id}`, 30, 3600);
  const b = await body(c);
  const id = await D.addPhoto(c.env, me, { key: b.key });
  return c.json({ id, profile: await D.myProfile(c.env, me.id, ctxOf(c)) }, 201);
});
datingApp.delete('/dating/profile/photos/:id', async (c) => {
  const me = c.get('user');
  await D.removePhoto(c.env, me, uuidParam(c, 'id'));
  return c.json({ profile: await D.myProfile(c.env, me.id, ctxOf(c)) });
});
datingApp.post('/dating/profile/photos/:id/main', async (c) => {
  const me = c.get('user');
  await D.makeMainPhoto(c.env, me, uuidParam(c, 'id'));
  return c.json({ profile: await D.myProfile(c.env, me.id, ctxOf(c)) });
});
datingApp.post('/dating/profile/pause', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  await D.setPaused(c.env, me, b.paused !== false);
  return c.json({ profile: await D.myProfile(c.env, me.id, ctxOf(c)) });
});
datingApp.delete('/dating/profile', async (c) => c.json(await D.deleteProfile(c.env, c.get('user'))));

datingApp.get('/dating/discover', async (c) => c.json(await D.discover(c.env, c.get('user'), ctxOf(c), { limit: c.req.query('limit') })));
datingApp.get('/dating/profiles/:id', async (c) => c.json(await D.viewProfile(c.env, c.get('user'), uuidParam(c, 'id'), ctxOf(c))));
datingApp.post('/dating/swipe', async (c) => {
  const me = c.get('user');
  await rateLimit(c.env, `dating_swipe:${me.id}`, 120, 60);
  const b = await body(c);
  return c.json(await D.swipe(c, me, { targetId: b.targetId, action: b.action, idempotencyKey: b.idempotencyKey }));
});
datingApp.post('/dating/undo', async (c) => c.json(await D.undoLastSwipe(c.env, c.get('user'), ctxOf(c))));
datingApp.post('/dating/swipes/extra', async (c) => c.json(await D.buyExtraSwipes(c, c.get('user'), (await body(c)).idempotencyKey)));

datingApp.get('/dating/likes', async (c) => c.json(await D.likesReceived(c.env, c.get('user'), ctxOf(c))));
datingApp.post('/dating/likes/unlock', async (c) => c.json(await D.unlockLikes(c, c.get('user'), (await body(c)).idempotencyKey)));

datingApp.get('/dating/matches', async (c) => c.json({ items: await D.listMatches(c.env, c.get('user'), ctxOf(c)) }));
datingApp.post('/dating/matches/:id/unmatch', async (c) => c.json(await D.unmatch(c.env, c.get('user'), uuidParam(c, 'id'))));

datingApp.get('/dating/requests', async (c) => c.json({ items: await D.listRequests(c.env, c.get('user'), ctxOf(c)) }));
datingApp.post('/dating/requests', async (c) => {
  const b = await body(c);
  return c.json(await D.sendMessageRequest(c, c.get('user'), { targetId: b.targetId, text: b.text, idempotencyKey: b.idempotencyKey }), 201);
});
datingApp.post('/dating/requests/:id/accept', async (c) => c.json(await D.answerRequest(c, c.get('user'), uuidParam(c, 'id'), true)));
datingApp.post('/dating/requests/:id/decline', async (c) => c.json(await D.answerRequest(c, c.get('user'), uuidParam(c, 'id'), false)));

datingApp.get('/dating/conversations/:id', async (c) => c.json(await D.conversationInfo(c.env, c.get('user'), uuidParam(c, 'id'), ctxOf(c))));
datingApp.post('/dating/conversations/:id/ad/start', async (c) => c.json(await D.startAdUnlock(c.env, c.get('user'), uuidParam(c, 'id'))));
datingApp.post('/dating/ads/claim', async (c) => {
  const b = await body(c);
  return c.json(await D.claimAdUnlock(c.env, c.get('user'), { nonce: b.nonce, token: b.token }));
});
datingApp.post('/dating/conversations/:id/bundle', async (c) => c.json(await D.buyMessageBundle(c, c.get('user'), uuidParam(c, 'id'), (await body(c)).idempotencyKey)));

datingApp.get('/dating/boost', async (c) => c.json(await D.boostStatus(c.env, c.get('user'))));
datingApp.post('/dating/boost', async (c) => {
  const b = await body(c);
  return c.json(await D.startBoost(c, c.get('user'), { kind: b.kind, idempotencyKey: b.idempotencyKey, useFreeBoost: b.useFreeBoost }));
});

datingApp.post('/dating/block', async (c) => c.json(await D.blockMember(c.env, c.get('user'), (await body(c)).userId)));
datingApp.post('/dating/report', async (c) => {
  const b = await body(c);
  return c.json(await D.reportMember(c.env, c.get('user'), { userId: b.userId, reason: b.reason, details: b.details, block: !!b.block }), 201);
});

// ─── admin ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const adminDating = new Hono();
adminDating.use('/admin/api/dating/*', requireAdmin);

// q: a user id, @handle or part of a name → SQL fragment on the given user-id column (params appended to `p`).
function userFilter(qv, col, p) {
  const s = String(qv || '').trim();
  if (!s) return 'TRUE';
  if (isUuid(s)) { p.push(s.toLowerCase()); return `${col} = $${p.length}`; }
  if (s.startsWith('@')) { p.push(s.slice(1).toLowerCase()); return `${col} IN (SELECT id FROM users WHERE lower(handle) = $${p.length})`; }
  p.push(`%${s.toLowerCase()}%`);
  return `${col} IN (SELECT id FROM users WHERE lower(display_name) LIKE $${p.length} UNION SELECT user_id FROM dating_profiles WHERE lower(first_name) LIKE $${p.length})`;
}
function dateFilter(v, col, p, op) {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return 'TRUE';
  p.push(v.slice(0, 10));
  return op === '>=' ? `${col} >= $${p.length}::date` : `${col} < $${p.length}::date + 1`;
}
const userOf = (r, pre = '') => (r[`${pre}uid`] ? { id: r[`${pre}uid`], name: r[`${pre}name`] || null, handle: r[`${pre}handle`] || null } : null);
function asCsv(c, rows, cols, name) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [cols.map((x) => x[0]).join(','), ...rows.map((r) => cols.map((x) => esc(x[1](r))).join(','))].join('\n');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${name}.csv"`);
  return c.body(text);
}

adminDating.get('/admin/api/dating/overview', async (c) => {
  const { rules } = await D.datingConfig(c.env);
  const r = await one(c.env, `SELECT
      (SELECT count(*)::int FROM dating_profiles) AS total,
      (SELECT count(*)::int FROM dating_profiles WHERE status = 'active') AS active,
      (SELECT count(*)::int FROM dating_profiles WHERE status = 'paused') AS paused,
      (SELECT count(*)::int FROM dating_profiles WHERE status = 'banned') AS banned,
      (SELECT count(*)::int FROM dating_photos WHERE status = 'pending') AS photos_pending,
      (SELECT count(*)::int FROM dating_reports WHERE status = 'open') AS reports_open,
      (SELECT count(*)::int FROM dating_matches WHERE status = 'active') AS matches,
      (SELECT count(*)::int FROM dating_matches WHERE created_at > now() - interval '30 days') AS matches30,
      (SELECT count(*)::int FROM dating_boosts WHERE now() >= starts_at AND now() < ends_at) AS boosts_active,
      (SELECT count(*)::int FROM dating_subscriptions s JOIN wallet_products p ON p.id = s.product_id WHERE s.status IN ('active','cancelled','past_due') AND s.current_period_end > now() AND p.tier = 1) AS plus,
      (SELECT count(*)::int FROM dating_subscriptions s JOIN wallet_products p ON p.id = s.product_id WHERE s.status IN ('active','cancelled','past_due') AND s.current_period_end > now() AND p.tier >= 2) AS vip,
      (SELECT count(*)::int FROM dating_ad_rewards WHERE issued_at > now() - interval '30 days') AS ads_issued,
      (SELECT count(*)::int FROM dating_ad_rewards WHERE issued_at > now() - interval '30 days' AND status = 'claimed') AS ads_claimed,
      (SELECT count(*)::int FROM dating_ad_rewards WHERE issued_at > now() - interval '30 days' AND verified) AS ads_verified,
      (SELECT count(*)::int FROM dating_ad_rewards WHERE issued_at > now() - interval '30 days' AND (status = 'expired' OR (status = 'issued' AND expires_at < now()))) AS ads_expired`);
  const spends = await q(c.env, `SELECT kind, count(*)::int AS count, sum(amount)::int AS coins FROM dating_spends WHERE created_at > now() - interval '30 days' AND wallet = 'dating_coins' GROUP BY kind ORDER BY coins DESC`);
  return c.json({
    profiles: { total: r.total, active: r.active, paused: r.paused, banned: r.banned }, photosPending: r.photos_pending, reportsOpen: r.reports_open,
    matches: r.matches, matches30: r.matches30, boostsActive: r.boosts_active, plus: r.plus, vip: r.vip, photoReview: rules.photoReview, requireSsv: !!rules.requireSsv,
    ads: { issued: r.ads_issued, claimed: r.ads_claimed, verified: r.ads_verified, expired: r.ads_expired },
    spends: spends.map((s) => ({ ...s, label: KINDS[s.kind] || s.kind })),
  });
});

adminDating.get('/admin/api/dating/profiles', async (c) => {
  const p = [];
  const where = [userFilter(c.req.query('q'), 'dp.user_id', p)];
  const st = c.req.query('status');
  if (['active', 'paused', 'banned'].includes(st)) { p.push(st); where.push(`dp.status = $${p.length}`); }
  if (c.req.query('reported') === '1') where.push('EXISTS (SELECT 1 FROM dating_reports r WHERE r.target_id = dp.user_id)');
  const rows = await q(c.env, `SELECT dp.*, EXTRACT(YEAR FROM age(current_date, dp.birth_date))::int AS age, u.display_name AS uname, u.handle AS uhandle,
      (SELECT count(*)::int FROM dating_reports r WHERE r.target_id = dp.user_id) AS reports,
      (SELECT count(*)::int FROM dating_matches m WHERE (m.user_a = dp.user_id OR m.user_b = dp.user_id)) AS matches,
      (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'url', ph.url, 'status', ph.status) ORDER BY ph.position), '[]'::json) FROM dating_photos ph WHERE ph.user_id = dp.user_id) AS photos
    FROM dating_profiles dp JOIN users u ON u.id = dp.user_id WHERE ${where.join(' AND ')} ORDER BY dp.created_at DESC LIMIT 100`, p);
  const ctx = ctxOf(c);
  const abs = (url) => (/^https?:\/\//.test(url) ? url : `${(c.env.PUBLIC_MEDIA_BASE || `${ctx.origin}/media`).replace(/\/$/, '')}/${url}`);
  return c.json({ items: rows.map((r) => ({
    userId: r.user_id, firstName: r.first_name, age: r.age, gender: r.gender, interestedIn: r.interested_in, city: r.city, country: r.country,
    denomination: r.denomination, intention: r.intention, bio: r.bio, status: r.status, banReason: r.ban_reason, verified: !!r.verified,
    reports: r.reports, matches: r.matches, createdAt: r.created_at, user: { id: r.user_id, name: r.uname, handle: r.uhandle },
    photos: (typeof r.photos === 'string' ? JSON.parse(r.photos) : r.photos || []).map((x) => ({ ...x, url: abs(x.url) })),
  })) });
});
adminDating.post('/admin/api/dating/profiles/:id/:action', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const action = c.req.param('action');
  const b = await body(c).catch(() => ({}));
  const prof = await D.getProfileRow(c.env, id);
  if (!prof) throw notFound('Profile not found');
  if (action === 'ban') {
    const reason = str(b.reason, { min: 3, max: 300, field: 'reason' });
    await q(c.env, `UPDATE dating_profiles SET status = 'banned', ban_reason = $2, updated_at = now() WHERE user_id = $1`, [id, reason]);
    const convs = await q(c.env, `UPDATE dating_conversations SET status = 'closed', updated_at = now() WHERE (user_a = $1 OR user_b = $1) AND status IN ('request','match') RETURNING conversation_id`, [id]);
    for (const x of convs) await q(c.env, 'DELETE FROM conversation_members WHERE conversation_id = $1', [x.conversation_id]);
    await q(c.env, `UPDATE dating_matches SET status = 'unmatched', unmatched_by = $2, unmatched_at = now() WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, [id, me.id]);
  } else if (action === 'unban') {
    await q(c.env, `UPDATE dating_profiles SET status = 'active', ban_reason = NULL, updated_at = now() WHERE user_id = $1 AND status = 'banned'`, [id]);
  } else if (action === 'verify') {
    await q(c.env, `UPDATE dating_profiles SET verified = $2, updated_at = now() WHERE user_id = $1`, [id, !!b.verified]);
  } else throw notFound();
  await audit(c.env, me, `dating.profile.${action}`, 'dating_profile', id, { reason: b.reason || null, verified: b.verified });
  return c.json({ ok: true });
});

adminDating.get('/admin/api/dating/photos', async (c) => {
  const p = [];
  const st = ['pending', 'approved', 'rejected'].includes(c.req.query('status')) ? c.req.query('status') : 'pending';
  p.push(st);
  const where = [`ph.status = $1`, userFilter(c.req.query('q'), 'ph.user_id', p)];
  const rows = await q(c.env, `SELECT ph.*, dp.first_name FROM dating_photos ph LEFT JOIN dating_profiles dp ON dp.user_id = ph.user_id
    WHERE ${where.join(' AND ')} ORDER BY ph.created_at ${st === 'pending' ? 'ASC' : 'DESC'} LIMIT 120`, p);
  const origin = new URL(c.req.url).origin;
  const abs = (url) => (/^https?:\/\//.test(url) ? url : `${(c.env.PUBLIC_MEDIA_BASE || `${origin}/media`).replace(/\/$/, '')}/${url}`);
  return c.json({ items: rows.map((r) => ({ id: r.id, userId: r.user_id, firstName: r.first_name || '', url: abs(r.url), status: r.status, rejectReason: r.reject_reason, createdAt: r.created_at })) });
});
adminDating.post('/admin/api/dating/photos/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const b = await body(c);
  if (!['approved', 'rejected'].includes(b.status)) throw bad('status must be approved or rejected');
  const r = await one(c.env, `UPDATE dating_photos SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING user_id`,
    [id, b.status, b.status === 'rejected' ? String(b.reason || '').slice(0, 300) : null, me.id]);
  if (!r) throw notFound('Photo not found');
  await audit(c.env, me, `dating.photo.${b.status}`, 'dating_photo', id, { userId: r.user_id, reason: b.reason || null });
  return c.json({ ok: true });
});

adminDating.get('/admin/api/dating/reports', async (c) => {
  const p = [];
  const where = [userFilter(c.req.query('q'), 'r.target_id', p)];
  const st = c.req.query('status') ?? 'open';
  if (['open', 'actioned', 'dismissed'].includes(st)) { p.push(st); where.push(`r.status = $${p.length}`); }
  const rows = await q(c.env, `SELECT r.*, t.id AS t_uid, COALESCE(tp.first_name, t.display_name) AS t_name, t.handle AS t_handle,
      f.id AS f_uid, f.display_name AS f_name, f.handle AS f_handle
    FROM dating_reports r JOIN users t ON t.id = r.target_id JOIN users f ON f.id = r.reporter_id LEFT JOIN dating_profiles tp ON tp.user_id = r.target_id
    WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 200`, p);
  return c.json({ items: rows.map((r) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, action: r.action, createdAt: r.created_at, target: userOf(r, 't_'), reporter: userOf(r, 'f_') })) });
});
adminDating.post('/admin/api/dating/reports/:id', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c, 'id');
  const b = await body(c);
  const r = await one(c.env, 'SELECT * FROM dating_reports WHERE id = $1', [id]);
  if (!r) throw notFound('Report not found');
  if (b.action === 'ban') {
    await q(c.env, `UPDATE dating_profiles SET status = 'banned', ban_reason = $2, updated_at = now() WHERE user_id = $1`, [r.target_id, `Suspended after a report (${r.reason})`]);
    const convs = await q(c.env, `UPDATE dating_conversations SET status = 'closed', updated_at = now() WHERE (user_a = $1 OR user_b = $1) AND status IN ('request','match') RETURNING conversation_id`, [r.target_id]);
    for (const x of convs) await q(c.env, 'DELETE FROM conversation_members WHERE conversation_id = $1', [x.conversation_id]);
    await q(c.env, `UPDATE dating_reports SET status = 'actioned', action = 'ban', handled_by = $2, handled_at = now() WHERE target_id = $1 AND status = 'open'`, [r.target_id, me.id]);
  } else if (b.action === 'dismiss') {
    await q(c.env, `UPDATE dating_reports SET status = 'dismissed', action = 'dismiss', handled_by = $2, handled_at = now() WHERE id = $1`, [id, me.id]);
  } else throw bad('action must be ban or dismiss');
  await audit(c.env, me, `dating.report.${b.action}`, 'dating_report', id, { targetId: r.target_id, reason: r.reason });
  return c.json({ ok: true });
});

const USER_JOIN = (col) => `LEFT JOIN users u ON u.id = ${col}`;
adminDating.get('/admin/api/dating/spends', async (c) => {
  const p = [];
  const where = [userFilter(c.req.query('q'), 's.user_id', p), dateFilter(c.req.query('from'), 's.created_at', p, '>='), dateFilter(c.req.query('to'), 's.created_at', p, '<')];
  const kind = c.req.query('kind') || c.req.query('type');
  if (kind && D.COIN_KINDS[kind]) { p.push(kind); where.push(`s.kind = $${p.length}`); }
  const ref = c.req.query('ref');
  if (ref) { p.push(String(ref).slice(0, 200)); where.push(`left(s.ref, length($${p.length})) = $${p.length}`); } // prefix match, no LIKE wildcards
  const rows = await q(c.env, `SELECT s.*, u.id AS uid, u.display_name AS name, u.handle FROM dating_spends s ${USER_JOIN('s.user_id')}
    WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 500`, p);
  const items = rows.map((r) => ({ ref: r.ref, kind: r.kind, label: D.COIN_KINDS[r.kind] || r.kind, wallet: r.wallet, amount: r.amount, units: r.units, targetId: r.target_id, conversationId: r.conversation_id, createdAt: r.created_at, user: userOf(r) }));
  if (c.req.query('format') === 'csv') return asCsv(c, items, [['created_at', (r) => new Date(r.createdAt).toISOString()], ['user_id', (r) => r.user && r.user.id], ['handle', (r) => r.user && r.user.handle], ['kind', (r) => r.kind], ['wallet', (r) => r.wallet], ['amount', (r) => r.amount], ['units', (r) => r.units], ['target_id', (r) => r.targetId], ['conversation_id', (r) => r.conversationId], ['ref', (r) => r.ref]], 'dating-coin-usage');
  return c.json({ items });
});

adminDating.get('/admin/api/dating/message-unlocks', async (c) => {
  const p = [];
  const qv = c.req.query('q');
  const wa = [userFilter(qv, 'a.user_id', p), `a.status = 'claimed'`, dateFilter(c.req.query('from'), 'a.claimed_at', p, '>='), dateFilter(c.req.query('to'), 'a.claimed_at', p, '<')];
  const wb = [userFilter(qv, 's.user_id', p), `s.kind = 'message_bundle'`, dateFilter(c.req.query('from'), 's.created_at', p, '>='), dateFilter(c.req.query('to'), 's.created_at', p, '<')];
  const type = c.req.query('type');
  const rows = await q(c.env, `SELECT * FROM (
      SELECT 'ad' AS type, a.nonce AS ref, a.user_id, a.conversation_id, a.units, 0 AS amount, a.verified, a.claimed_at AS at FROM dating_ad_rewards a WHERE ${wa.join(' AND ')} ${type === 'bundle' ? 'AND FALSE' : ''}
      UNION ALL
      SELECT 'bundle', s.ref, s.user_id, s.conversation_id, s.units, s.amount, false, s.created_at FROM dating_spends s WHERE ${wb.join(' AND ')} ${type === 'ad' ? 'AND FALSE' : ''}
    ) x LEFT JOIN (SELECT id AS uid, display_name AS name, handle FROM users) u ON u.uid = x.user_id ORDER BY x.at DESC LIMIT 500`, p);
  const items = rows.map((r) => ({ type: r.type, ref: r.ref, conversationId: r.conversation_id, units: r.units, amount: r.amount, verified: !!r.verified, at: r.at, user: userOf(r) }));
  if (c.req.query('format') === 'csv') return asCsv(c, items, [['at', (r) => new Date(r.at).toISOString()], ['user_id', (r) => r.user && r.user.id], ['type', (r) => r.type], ['messages', (r) => r.units], ['coins', (r) => r.amount], ['ssv_verified', (r) => r.verified], ['conversation_id', (r) => r.conversationId], ['ref', (r) => r.ref]], 'dating-message-unlocks');
  return c.json({ items });
});

adminDating.get('/admin/api/dating/ad-rewards', async (c) => {
  const p = [];
  const where = [userFilter(c.req.query('q'), 'a.user_id', p), dateFilter(c.req.query('from'), 'a.issued_at', p, '>='), dateFilter(c.req.query('to'), 'a.issued_at', p, '<')];
  const st = c.req.query('status');
  if (['issued', 'claimed', 'expired', 'rejected'].includes(st)) { p.push(st); where.push(`a.status = $${p.length}`); }
  const rows = await q(c.env, `SELECT a.*, u.id AS uid, u.display_name AS name, u.handle FROM dating_ad_rewards a ${USER_JOIN('a.user_id')}
    WHERE ${where.join(' AND ')} ORDER BY a.issued_at DESC LIMIT 500`, p);
  const items = rows.map((r) => ({ nonce: r.nonce, status: r.status, claimedVia: r.claimed_via, verified: !!r.verified, transactionId: r.transaction_id, units: r.units, conversationId: r.conversation_id, issuedAt: r.issued_at, claimedAt: r.claimed_at, user: userOf(r) }));
  if (c.req.query('format') === 'csv') return asCsv(c, items, [['issued_at', (r) => new Date(r.issuedAt).toISOString()], ['claimed_at', (r) => r.claimedAt && new Date(r.claimedAt).toISOString()], ['user_id', (r) => r.user && r.user.id], ['status', (r) => r.status], ['claimed_via', (r) => r.claimedVia], ['ssv_verified', (r) => r.verified], ['transaction_id', (r) => r.transactionId], ['messages', (r) => r.units], ['nonce', (r) => r.nonce]], 'dating-rewarded-ads');
  return c.json({ items });
});

adminDating.get('/admin/api/dating/boosts', async (c) => {
  const p = [];
  const where = [userFilter(c.req.query('q'), 'b.user_id', p), dateFilter(c.req.query('from'), 'b.created_at', p, '>='), dateFilter(c.req.query('to'), 'b.created_at', p, '<')];
  const kind = c.req.query('kind') || c.req.query('type');
  if (kind && D.BOOSTS[kind]) { p.push(kind); where.push(`b.kind = $${p.length}`); }
  if (c.req.query('active') === '1') where.push('now() >= b.starts_at AND now() < b.ends_at');
  const rows = await q(c.env, `SELECT b.*, u.id AS uid, u.display_name AS name, u.handle,
      (SELECT count(*)::int FROM dating_views v WHERE v.target_id = b.user_id AND v.last_seen_at >= b.starts_at AND v.last_seen_at < LEAST(b.ends_at, now())) AS views,
      (SELECT count(*)::int FROM dating_swipes s WHERE s.target_id = b.user_id AND s.action <> 'pass' AND s.created_at >= b.starts_at AND s.created_at < LEAST(b.ends_at, now())) AS likes,
      (SELECT count(*)::int FROM dating_matches m WHERE (m.user_a = b.user_id OR m.user_b = b.user_id) AND m.created_at >= b.starts_at AND m.created_at < LEAST(b.ends_at, now())) AS matches
    FROM dating_boosts b ${USER_JOIN('b.user_id')} WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC LIMIT 500`, p);
  const items = rows.map((r) => ({ ref: r.ref, kind: r.kind, label: D.COIN_KINDS[r.kind], paidWith: r.paid_with, amount: r.amount, startsAt: r.starts_at, endsAt: r.ends_at, createdAt: r.created_at, views: r.views, likes: r.likes, matches: r.matches, user: userOf(r) }));
  if (c.req.query('format') === 'csv') return asCsv(c, items, [['created_at', (r) => new Date(r.createdAt).toISOString()], ['user_id', (r) => r.user && r.user.id], ['kind', (r) => r.kind], ['paid_with', (r) => r.paidWith], ['amount', (r) => r.amount], ['starts_at', (r) => new Date(r.startsAt).toISOString()], ['ends_at', (r) => new Date(r.endsAt).toISOString()], ['views', (r) => r.views], ['likes', (r) => r.likes], ['matches', (r) => r.matches], ['ref', (r) => r.ref]], 'dating-boosts');
  return c.json({ items });
});

adminDating.get('/admin/api/dating/subscriptions', async (c) => {
  const p = [];
  const where = [userFilter(c.req.query('q'), 's.user_id', p)];
  const st = c.req.query('status');
  if (!st) where.push(`s.status IN ('active','cancelled','past_due')`);
  else if (['active', 'cancelled', 'past_due', 'expired', 'refunded'].includes(st)) { p.push(st); where.push(`s.status = $${p.length}`); }
  const rows = await q(c.env, `SELECT s.*, pr.title, u.id AS uid, u.display_name AS name, u.handle,
      (SELECT count(*)::int FROM dating_subscription_periods x WHERE x.subscription_id = s.id) AS cycles
    FROM dating_subscriptions s JOIN wallet_products pr ON pr.id = s.product_id ${USER_JOIN('s.user_id')}
    WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 300`, p);
  return c.json({ items: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, provider: r.provider, test: !!r.test, currentPeriodStart: r.current_period_start, currentPeriodEnd: r.current_period_end, cycles: r.cycles, user: userOf(r) })) });
});

adminDating.get('/admin/api/dating/config', async (c) => c.json(await D.datingConfig(c.env)));
adminDating.put('/admin/api/dating/config', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (!['dating_prices', 'dating_rules'].includes(b.key)) throw bad('key must be dating_prices or dating_rules', 'BAD_CONFIG');
  const base = b.key === 'dating_prices' ? D.DEFAULT_PRICES : D.DEFAULT_RULES;
  const value = b.value && typeof b.value === 'object' ? Object.fromEntries(Object.entries(b.value).filter(([k]) => k in base)) : null;
  await setConfig(c.env, b.key, value, me.id);
  await audit(c.env, me, 'dating.config', 'wallet_config', b.key, { value });
  return c.json(await D.datingConfig(c.env));
});
