// CREATOR DASHBOARD (Development Update v1, item 4.3): the numbers a membership creator sees. Chart-free: totals,
// lists and an earnings ledger. Payouts are manual for now (the ledger shows what members paid; BibleNestra pays the
// creator outside the app), so there is no payout button here.
import { q } from './db.js';
import { hasAccess } from './memberships.js';

const DAY = 86400e3;
const ms = (d) => (d ? new Date(d).getTime() : null);
const name = (r) => r.name || 'Member';

/**
 * Pure: subscriptions + successful payments → dashboard numbers.
 *   subs:     { user_id, name, handle, status, started_at, expires_at, source }
 *   payments: { reference, user_id, name, handle, purpose ('purchase'|'renewal'), status, amount_minor, currency,
 *               channel, paid_at, created_at }
 */
export function summarizeCreatorStats({ subs = [], payments = [] }, now = new Date()) {
  const t = now.getTime();
  const since = t - 7 * DAY;
  const counted = subs.filter((s) => s.status !== 'refunded');
  const active = counted.filter((s) => hasAccess(s, t));
  const expired = counted.filter((s) => !hasAccess(s, t));
  const paidAt = (p) => ms(p.paid_at || p.created_at);
  const won = payments.filter((p) => p.status === 'success');
  const weekly = won.filter((p) => paidAt(p) >= since);
  const currency = (won[0] && won[0].currency) || 'NGN';
  const sum = (rows) => rows.reduce((n, p) => n + Number(p.amount_minor || 0), 0);
  const renewals = won.filter((p) => p.purpose === 'renewal' && paidAt(p) >= since);
  const subscriberRow = (s) => ({
    userId: s.user_id, name: name(s), handle: s.handle || null,
    startedAt: s.started_at ? new Date(s.started_at).toISOString() : null,
    expiresAt: s.expires_at ? new Date(s.expires_at).toISOString() : null,
    source: s.source || null,
  });
  return {
    currency,
    totals: {
      members: counted.length,
      activeSubscribers: active.length,
      expired: expired.length,
      newSubscriptions7d: counted.filter((s) => ms(s.started_at) >= since).length,
      renewals7d: renewals.length,
    },
    earnings: {
      weeklyMinor: sum(weekly),
      totalMinor: sum(won),
      weeklyPayments: weekly.length,
    },
    activeSubscribers: active.map(subscriberRow).sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt))).slice(0, 500),
    expiredSubscribers: expired.map(subscriberRow).sort((a, b) => String(b.expiresAt).localeCompare(String(a.expiresAt))).slice(0, 500),
    renewals: renewals.slice(0, 50).map((p) => ({ reference: p.reference, name: name(p), amountMinor: Number(p.amount_minor), currency: p.currency, paidAt: new Date(paidAt(p)).toISOString() })),
    ledger: payments.slice(0, 100).map((p) => ({
      reference: p.reference, name: name(p), purpose: p.purpose, status: p.status, amountMinor: Number(p.amount_minor), currency: p.currency,
      channel: p.channel || null, paidAt: p.paid_at ? new Date(p.paid_at).toISOString() : null,
    })),
    payouts: { mode: 'manual', note: 'Payouts are made by BibleNestra outside the app. This ledger shows what members paid.' },
  };
}

/** Loads a membership's subscriptions and paid Paystack payments, then summarises them. Test-mode payments are left out. */
export async function creatorStats(env, membershipId, now = new Date()) {
  const subs = await q(env, `SELECT s.user_id, s.status, s.started_at, s.expires_at, s.source, u.display_name AS name, u.handle
      FROM membership_subscriptions s JOIN users u ON u.id = s.user_id WHERE s.membership_id = $1`, [membershipId]);
  const payments = await q(env, `SELECT p.reference, p.user_id, p.purpose, p.status, p.amount_minor, p.currency, p.channel, p.paid_at, p.created_at,
      u.display_name AS name, u.handle
      FROM paystack_payments p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.kind = 'membership' AND p.target_id = $1 AND p.status = 'success' AND NOT p.test
      ORDER BY p.created_at DESC LIMIT 2000`, [String(membershipId)]);
  return summarizeCreatorStats({ subs, payments }, now);
}
