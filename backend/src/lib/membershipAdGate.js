// MEMBERSHIP AD GATE (client request, 2026-11-27): a membership's MASTER CLASS and EXECUTIVE CLASS can be locked behind
// rewarded ads. Settings live on the membership row (ad_gate_enabled, ad_gate_ads, ad_gate_frequency). Each rewarded ad
// (purpose 'membership_gate:<membershipId>', verified by AdMob SSV in routes/rewards.js or the dev claim route) adds one
// to the member's count for the current period. When the count reaches the number of ads, a PASS is issued:
//
//   daily        valid until the end of the day in Africa/Lagos (UTC+1, no daylight saving). The count resets each day.
//   weekly       valid until the end of the ISO week: Monday 00:00 Africa/Lagos. The count resets each week.
//   every_entry  a 15 minute pass. The count restarts at each entry; a half-finished count older than 30 minutes is dropped.
//
// Who is exempt (never sees the gate): platform admins, the membership owner, group admins (actorIn().staff), and
// BibleNestra Plus subscribers (users.premium, not expired), because the app never shows ads to Plus. The gate sits on
// top of the paid subscription; it never grants access by itself.
// Enforcement: membershipChatGuard (routes/memberships.js) throws 403 AD_GATE_REQUIRED for conversations of the membership.
// Catalogue default for NEW memberships: registerConfig 'membership_ad_gate_default' (admins can change it in the wallet
// settings JSON). Each membership can then be changed in the Memberships admin tab or by its owner.
import { one, q } from './db.js';
import { ApiError, bad } from './http.js';
import { registerConfig, getConfig } from './wallet.js';
import { isPlatformAdmin } from './play.js';
import { actorIn } from './membershipGroups.js';

export const AD_GATE_FREQUENCIES = ['daily', 'weekly', 'every_entry'];
export const AD_GATE_MIN_ADS = 1;
export const AD_GATE_MAX_ADS = 10;
export const AD_GATE_PURPOSE = 'membership_gate:';
export const AD_GATE_ENTRY_MINUTES = 15;
const ENTRY_STALE_MS = 30 * 60e3;
const LAGOS_OFFSET_MS = 3600e3; // Africa/Lagos is UTC+1 all year

export const DEFAULT_AD_GATE = { enabled: false, ads: 1, frequency: 'daily' };

/** Validates one gate setting block. Used by registerConfig, so a bad default is refused by setConfig. */
export function checkAdGateSettings(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && typeof v.enabled === 'boolean'
    && Number.isInteger(v.ads) && v.ads >= AD_GATE_MIN_ADS && v.ads <= AD_GATE_MAX_ADS
    && AD_GATE_FREQUENCIES.includes(v.frequency);
}
registerConfig('membership_ad_gate_default', DEFAULT_AD_GATE, checkAdGateSettings);

/** Settings as the server uses them, from a membership row. */
export function settingsOfRow(m = {}) {
  return {
    enabled: !!m.ad_gate_enabled,
    ads: Number(m.ad_gate_ads) || AD_GATE_MIN_ADS,
    frequency: AD_GATE_FREQUENCIES.includes(m.ad_gate_frequency) ? m.ad_gate_frequency : 'daily',
  };
}

/** Merges a request body into the current settings. Throws 400 BAD_AD_GATE on a bad value. Pure. */
export function cleanAdGate(input = {}, current = DEFAULT_AD_GATE) {
  const enabled = input.enabled === undefined ? current.enabled : input.enabled;
  if (typeof enabled !== 'boolean') throw bad('enabled must be true or false', 'BAD_AD_GATE');
  const adsRaw = input.ads === undefined || input.ads === null || input.ads === '' ? current.ads : Number(input.ads);
  if (!Number.isInteger(adsRaw) || adsRaw < AD_GATE_MIN_ADS || adsRaw > AD_GATE_MAX_ADS) {
    throw bad(`Ads must be a whole number from ${AD_GATE_MIN_ADS} to ${AD_GATE_MAX_ADS}`, 'BAD_AD_GATE');
  }
  const frequency = input.frequency === undefined ? current.frequency : input.frequency;
  if (!AD_GATE_FREQUENCIES.includes(frequency)) throw bad('frequency must be daily, weekly or every_entry', 'BAD_AD_GATE');
  return { enabled, ads: adsRaw, frequency };
}

const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * The period a count belongs to, and when the pass for it ends. Pure.
 * → { key, start, end } where end is the pass end for daily / weekly, and the entry window end for every_entry.
 */
export function periodFor(frequency, now = new Date()) {
  if (frequency === 'every_entry') {
    return { key: 'entry', start: now, end: new Date(now.getTime() + AD_GATE_ENTRY_MINUTES * 60e3) };
  }
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const day = local.getUTCDate();
  if (frequency === 'weekly') {
    const isoDow = (local.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
    const monday = new Date(Date.UTC(y, mo, day - isoDow));
    const start = new Date(monday.getTime() - LAGOS_OFFSET_MS);
    return { key: `w:${ymd(monday)}`, start, end: new Date(start.getTime() + 7 * 86400e3) };
  }
  const dayStart = new Date(Date.UTC(y, mo, day));
  const start = new Date(dayStart.getTime() - LAGOS_OFFSET_MS);
  return { key: `d:${ymd(dayStart)}`, start, end: new Date(start.getTime() + 86400e3) };
}

/** When a pass issued now runs out. Pure. */
export function passUntilFor(frequency, now = new Date()) {
  return periodFor(frequency, now).end;
}

/**
 * The gate for one member. Pure: everything it needs is passed in.
 * → { enabled, required, exempt, exemptReason, adsNeeded, adsWatched, frequency, passUntil }
 */
export function gateState({ settings, exemptReason = null, pass = null, adsWatched = 0, now = new Date() }) {
  const s = { ...DEFAULT_AD_GATE, ...(settings || {}) };
  const exempt = !!exemptReason;
  const passActive = !!pass && new Date(pass.valid_until || pass.validUntil).getTime() > now.getTime();
  const required = s.enabled && !exempt && !passActive;
  const watched = passActive ? s.ads : Math.min(Math.max(0, Number(adsWatched) || 0), s.ads);
  return {
    enabled: s.enabled,
    required,
    exempt,
    exemptReason: exempt ? exemptReason : null,
    adsNeeded: s.ads,
    adsWatched: watched,
    frequency: s.frequency,
    passUntil: passActive ? new Date(pass.valid_until || pass.validUntil).toISOString() : null,
  };
}

/** The member's count for the current period (every_entry: a count older than 30 minutes is dropped). */
export async function progressFor(env, userId, membershipId, settings, now = new Date()) {
  const { key } = periodFor(settings.frequency, now);
  const row = await one(env, 'SELECT ads, updated_at FROM membership_ad_gate_progress WHERE user_id = $1 AND membership_id = $2 AND period_key = $3',
    [userId, membershipId, key]);
  if (!row) return 0;
  if (settings.frequency === 'every_entry' && now.getTime() - new Date(row.updated_at).getTime() > ENTRY_STALE_MS) return 0;
  return Number(row.ads) || 0;
}

/**
 * Why the member is exempt, or null. Order: platform admin, owner, group admin, BibleNestra Plus (users.premium that has not expired).
 */
export async function exemptionOf(env, m, user, now = new Date()) {
  if (!user) return null;
  if (isPlatformAdmin(user)) return 'admin';
  if (m.owner_id && m.owner_id === user.id) return 'owner';
  const actor = await actorIn(env, m, user);
  if (actor.staff) return 'admin';
  const u = await one(env, 'SELECT premium, premium_until FROM users WHERE id = $1', [user.id]);
  if (u && u.premium && (!u.premium_until || new Date(u.premium_until).getTime() > now.getTime())) return 'plus';
  return null;
}

/** GET /memberships/:id/ad-gate for one user. */
export async function adGateFor(env, m, user, now = new Date()) {
  const settings = settingsOfRow(m);
  if (!settings.enabled || !user) return gateState({ settings, now });
  const exemptReason = await exemptionOf(env, m, user, now);
  if (exemptReason) return gateState({ settings, exemptReason, now });
  const pass = await one(env, 'SELECT valid_until FROM membership_ad_gate_passes WHERE user_id = $1 AND membership_id = $2', [user.id, m.id]);
  const adsWatched = await progressFor(env, user.id, m.id, settings, now);
  return gateState({ settings, pass, adsWatched, now });
}

/** 403 AD_GATE_REQUIRED for the chat guard. */
export function adGateError(m, gate) {
  const e = new ApiError(403, 'AD_GATE_REQUIRED',
    `Watch ${gate.adsNeeded} ad${gate.adsNeeded === 1 ? '' : 's'} to open this membership. You have watched ${gate.adsWatched}.`);
  e.details = { membershipId: m.id, adsNeeded: gate.adsNeeded, adsWatched: gate.adsWatched, frequency: gate.frequency, passUntil: gate.passUntil };
  return e;
}

/** The default for new memberships (registerConfig 'membership_ad_gate_default'). */
export async function getAdGateDefault(env) {
  const cfg = (await getConfig(env)).membership_ad_gate_default;
  return checkAdGateSettings(cfg) ? cfg : DEFAULT_AD_GATE;
}

/** Writes a membership's gate settings. */
export async function setAdGateRow(env, membershipId, settings) {
  await q(env, `UPDATE memberships SET ad_gate_enabled = $2, ad_gate_ads = $3, ad_gate_frequency = $4, updated_at = now() WHERE id = $1`,
    [membershipId, settings.enabled, settings.ads, settings.frequency]);
}

/**
 * One verified rewarded ad for a membership gate. Each transaction id counts once. When the count reaches the number of
 * ads, a pass is issued (or, for every_entry, the count restarts). → { credited, duplicate, ignored, adsWatched, passIssued }
 */
export async function applyMembershipGateAd(env, userId, membershipId, { transactionId = null, verified = false, now = new Date() } = {}) {
  const m = await one(env, 'SELECT id, owner_id, ad_gate_enabled, ad_gate_ads, ad_gate_frequency FROM memberships WHERE id = $1', [membershipId]);
  if (!m) return { ignored: true };
  const settings = settingsOfRow(m);
  if (!settings.enabled) return { ignored: true };
  const period = periodFor(settings.frequency, now);
  const txId = transactionId || `dev-${crypto.randomUUID()}`;

  const ins = await one(env, `INSERT INTO membership_ad_gate_ads (transaction_id, user_id, membership_id, period_key, verified)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (transaction_id) DO NOTHING RETURNING transaction_id`, [txId, userId, membershipId, period.key, !!verified]);
  if (!ins) return { duplicate: true, credited: false };

  if (settings.frequency === 'every_entry') {
    await q(env, `UPDATE membership_ad_gate_progress SET ads = 0, updated_at = now()
      WHERE user_id = $1 AND membership_id = $2 AND period_key = 'entry' AND updated_at < $3`,
    [userId, membershipId, new Date(now.getTime() - ENTRY_STALE_MS).toISOString()]);
  }
  const prog = await one(env, `INSERT INTO membership_ad_gate_progress (user_id, membership_id, period_key, ads, updated_at)
    VALUES ($1, $2, $3, 1, now())
    ON CONFLICT (user_id, membership_id, period_key) DO UPDATE SET ads = LEAST(membership_ad_gate_progress.ads + 1, $4), updated_at = now()
    RETURNING ads`, [userId, membershipId, period.key, settings.ads]);

  let passIssued = false;
  if (prog.ads >= settings.ads) {
    const active = await one(env, 'SELECT valid_until FROM membership_ad_gate_passes WHERE user_id = $1 AND membership_id = $2', [userId, membershipId]);
    if (!active || new Date(active.valid_until).getTime() <= now.getTime()) {
      const until = passUntilFor(settings.frequency, now);
      await q(env, `INSERT INTO membership_ad_gate_passes (user_id, membership_id, frequency, valid_until, issued_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (user_id, membership_id) DO UPDATE SET frequency = EXCLUDED.frequency, valid_until = EXCLUDED.valid_until, issued_at = now()`,
      [userId, membershipId, settings.frequency, until.toISOString()]);
      passIssued = true;
      if (settings.frequency === 'every_entry') {
        await q(env, `UPDATE membership_ad_gate_progress SET ads = 0, updated_at = now() WHERE user_id = $1 AND membership_id = $2 AND period_key = 'entry'`, [userId, membershipId]);
      }
    }
  }
  return { credited: true, duplicate: false, adsWatched: Math.min(prog.ads, settings.ads), passIssued };
}
