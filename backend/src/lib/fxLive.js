// LIVE EXCHANGE RATES for Fund Me donations in other currencies (wallet_config.fundme_fx_ngn_per_unit, NGN per 1 unit).
//
// Source: the free open API of Exchange Rate API, GET https://open.er-api.com/v6/latest/NGN (no key). It answers
// { result: 'success', time_last_update_unix, time_next_update_unix, time_eol_unix, rates: { USD: 0.00066, … } } where
// rates are units of each currency per 1 NGN, so NGN per unit = 1 / rates[X].
// Terms: rates update once a day, caching is allowed, calls are rate-limited (so: at most once every 6 hours here) and
// attribution is required where the rates are used — "Rates by Exchange Rate API" (https://www.exchangerate-api.com)
// on the app's donation currency picker and on the web donate page (FX_ATTRIBUTION, shown while the stored rates came
// from the API). A non-zero time_eol_unix means the endpoint is being retired: logged and shown in the admin.
//
// runFxCron (the 15-minute cron) refreshes only while fundme_fx_auto is on, and only the currencies already in the
// table (the seeded ones plus any the admin added). Guardrails: a fetched rate that moved more than 25% from the stored
// one is NOT applied (the old rate stays and the currency is flagged in Admin › Donations & payouts › Rules); zero, NaN,
// negative or missing values are never written; on any failure the old rates stay. "Refresh now" (refreshFxRates with
// force) skips the 6-hour throttle. A manual edit of the table records source 'manual' (noteManualFx).
import { q, one } from './db.js';
import { getConfig, setConfig } from './wallet.js';
import { FX_SEED } from './fundmeMoney.js';

export const FX_SOURCE = 'exchangerate-api';
export const FX_API_URL = 'https://open.er-api.com/v6/latest/NGN';
export const FX_ATTRIBUTION = { label: 'Rates by Exchange Rate API', url: 'https://www.exchangerate-api.com' };
export const FX_REFRESH_HOURS = 6;
export const FX_MAX_MOVE = 0.25;
const TIMEOUT_MS = 15000;

const iso = (d) => (d ? new Date(d).toISOString() : null);
const jv = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
const unix = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? new Date(Number(n) * 1000) : null);
/** 6 significant digits (1515.15, 11.4943). */
export const roundRate = (x) => Number(Number(x).toPrecision(6));
const goodRate = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e7;

/** The status row as the admin sees it. */
export async function fxStatus(env) {
  const r = await one(env, `SELECT * FROM fx_rate_status WHERE id = 'fundme'`);
  if (!r) return { source: null, ratesUpdatedAt: null, providerUpdatedAt: null, providerNextUpdateAt: null, eolAt: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null, flagged: [] };
  return {
    source: r.source || null, ratesUpdatedAt: iso(r.rates_updated_at), providerUpdatedAt: iso(r.provider_updated_at), providerNextUpdateAt: iso(r.provider_next_update_at),
    eolAt: iso(r.provider_eol_at), lastAttemptAt: iso(r.last_attempt_at), lastSuccessAt: iso(r.last_success_at), lastError: r.last_error || null, flagged: jv(r.flagged, []),
  };
}
/** Attribution for donors, or null when the stored rates didn't come from the API. */
export async function fxAttribution(env) {
  const r = await one(env, `SELECT source, rates_updated_at FROM fx_rate_status WHERE id = 'fundme'`);
  return r && r.source === FX_SOURCE ? { ...FX_ATTRIBUTION, updatedAt: iso(r.rates_updated_at) } : null;
}

/** An admin typed the table by hand. */
export async function noteManualFx(env, now = new Date()) {
  await q(env, `INSERT INTO fx_rate_status (id, source, rates_updated_at, updated_at) VALUES ('fundme', 'manual', $1, $1)
    ON CONFLICT (id) DO UPDATE SET source = 'manual', rates_updated_at = $1, updated_at = $1`, [now]);
}

/** GET the API → { rates, providerUpdatedAt, nextUpdateAt, eolAt }. Throws a short Error on anything unexpected. */
export async function fetchNgnRates() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try { res = await fetch(FX_API_URL, { headers: { Accept: 'application/json' }, signal: ctl.signal }); } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'timeout' : 'network error');
  } finally { clearTimeout(t); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('reply was not JSON'); }
  if (!j || j.result !== 'success') throw new Error(`result ${String((j && (j['error-type'] || j.result)) || 'missing').slice(0, 60)}`);
  if (!j.rates || typeof j.rates !== 'object') throw new Error('no rates in the reply');
  return { rates: j.rates, providerUpdatedAt: unix(j.time_last_update_unix), nextUpdateAt: unix(j.time_next_update_unix), eolAt: unix(j.time_eol_unix) };
}

/**
 * Pure: apply fetched rates (units per 1 NGN) to the stored table (NGN per unit).
 * → { table, applied: { USD: 1515.15 }, flagged: [{ currency, stored, fetched, changePct, reason }] }
 */
export function applyRates(stored, rates) {
  const table = { ...stored };
  const applied = {}; const flagged = [];
  for (const [cur, old] of Object.entries(stored)) {
    const r = rates[cur];
    if (!goodRate(r)) { flagged.push({ currency: cur, stored: old, fetched: null, changePct: null, reason: 'missing' }); continue; }
    const fresh = roundRate(1 / r);
    if (!goodRate(fresh)) { flagged.push({ currency: cur, stored: old, fetched: null, changePct: null, reason: 'invalid' }); continue; }
    if (goodRate(old)) {
      const move = (fresh - old) / old;
      if (Math.abs(move) > FX_MAX_MOVE) { flagged.push({ currency: cur, stored: old, fetched: fresh, changePct: Math.round(move * 1000) / 10, reason: 'moved_over_25pct' }); continue; }
    }
    table[cur] = fresh;
    if (fresh !== old) applied[cur] = fresh;
  }
  return { table, applied, flagged };
}

/**
 * One refresh. Claims the attempt atomically (at most one per FX_REFRESH_HOURS unless force), so overlapping cron runs
 * can't both call the API. → { ok, skipped?, applied, flagged, error? }
 */
export async function refreshFxRates(env, { force = false, now = new Date() } = {}) {
  const claim = await one(env, `INSERT INTO fx_rate_status (id, last_attempt_at, updated_at) VALUES ('fundme', $1, $1)
      ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, updated_at = EXCLUDED.updated_at
      WHERE $2::boolean OR fx_rate_status.last_attempt_at IS NULL OR fx_rate_status.last_attempt_at <= $1::timestamptz - make_interval(hours => $3::int)
      RETURNING id`, [now, !!force, FX_REFRESH_HOURS]);
  if (!claim) return { ok: true, skipped: 'throttled', applied: {}, flagged: [] };
  let got;
  try { got = await fetchNgnRates(); } catch (e) {
    const msg = `Fetch failed: ${String((e && e.message) || e).slice(0, 200)}. The old rates are kept.`;
    console.warn('fx refresh failed', msg);
    await q(env, `UPDATE fx_rate_status SET last_error = $2, updated_at = $1 WHERE id = 'fundme'`, [now, msg]);
    return { ok: false, error: msg, applied: {}, flagged: [] };
  }
  if (got.eolAt) console.warn(`open.er-api.com says this endpoint reaches end of life on ${got.eolAt.toISOString()} — move to another rate source`);
  const cfg = await getConfig(env);
  const stored = cfg.fundme_fx_ngn_per_unit && typeof cfg.fundme_fx_ngn_per_unit === 'object' ? cfg.fundme_fx_ngn_per_unit : FX_SEED;
  const { table, applied, flagged } = applyRates(stored, got.rates);
  const changed = Object.keys(applied).length > 0;
  if (changed) {
    try { await setConfig(env, 'fundme_fx_ngn_per_unit', table, null); } catch (e) {
      const msg = `Could not save the new rates (${String((e && e.message) || e).slice(0, 160)}). The old rates are kept.`;
      await q(env, `UPDATE fx_rate_status SET last_error = $2, updated_at = $1 WHERE id = 'fundme'`, [now, msg]);
      return { ok: false, error: msg, applied: {}, flagged };
    }
  }
  const tookAny = changed || Object.keys(stored).some((k) => !flagged.some((f) => f.currency === k)); // rates confirmed (even unchanged)
  await q(env, `UPDATE fx_rate_status SET source = CASE WHEN $2::boolean THEN $3::text ELSE source END, rates_updated_at = CASE WHEN $2::boolean THEN $1::timestamptz ELSE rates_updated_at END,
      provider_updated_at = $4, provider_next_update_at = $5, provider_eol_at = $6, last_success_at = $1, last_error = NULL, flagged = $7::jsonb, updated_at = $1
    WHERE id = 'fundme'`, [now, tookAny, FX_SOURCE, got.providerUpdatedAt, got.nextUpdateAt, got.eolAt, JSON.stringify(flagged)]);
  if (flagged.length) console.warn('fx refresh: not applied', flagged.map((f) => `${f.currency} (${f.reason})`).join(', '));
  return { ok: true, applied, flagged, providerUpdatedAt: iso(got.providerUpdatedAt), eolAt: iso(got.eolAt) };
}

/** 15-minute cron: refresh while fundme_fx_auto is on (the 6-hour throttle is inside refreshFxRates). */
export async function runFxCron(env, { now = new Date() } = {}) {
  const cfg = await getConfig(env);
  if (cfg.fundme_fx_auto !== true) return { ok: true, skipped: 'auto_off', applied: {}, flagged: [] };
  return refreshFxRates(env, { now });
}
