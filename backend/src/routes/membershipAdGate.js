// MEMBERSHIP AD GATE routes (lib/membershipAdGate.js). Signed in:
//   GET  /memberships/:id/ad-gate            → { enabled, required, exempt, exemptReason, adsNeeded, adsWatched, frequency, passUntil }
//   PUT  /memberships/:id/ad-gate            { enabled, ads, frequency } → same shape. Owner or platform admin only.
//   POST /memberships/:id/ad-gate/claim      dev builds only (ADS_CLIENT_CLAIM=true): claims one ad at once. Production credits
//                                            the ad through AdMob SSV (routes/rewards.js, purpose 'membership_gate:<id>').
import { Hono } from 'hono';
import { one } from '../lib/db.js';
import { ApiError, body, forbidden, notFound, uuidParam, bad } from '../lib/http.js';
import { isPlatformAdmin } from '../lib/play.js';
import {
  adGateFor, applyMembershipGateAd, cleanAdGate, setAdGateRow, settingsOfRow,
} from '../lib/membershipAdGate.js';

export const membershipAdGate = new Hono();

/** A membership the caller may see: published, or the owner / a platform admin. */
async function gatedMembership(c) {
  const me = c.get('user');
  const m = await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [uuidParam(c)]);
  if (!m) throw notFound('Membership not found');
  if (m.status === 'published' || isPlatformAdmin(me) || (m.owner_id && m.owner_id === me.id)) return m;
  throw notFound('Membership not found');
}

membershipAdGate.get('/memberships/:id/ad-gate', async (c) => {
  const m = await gatedMembership(c);
  return c.json(await adGateFor(c.env, m, c.get('user')));
});

membershipAdGate.put('/memberships/:id/ad-gate', async (c) => {
  const me = c.get('user');
  const m = await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [uuidParam(c)]);
  if (!m) throw notFound('Membership not found');
  if (!isPlatformAdmin(me) && !(m.owner_id && m.owner_id === me.id)) throw forbidden('Only the owner or an admin can change the ad gate', 'ADMIN_OR_OWNER_ONLY');
  const b = await body(c);
  const next = cleanAdGate(b, settingsOfRow(m));
  await setAdGateRow(c.env, m.id, next);
  const fresh = await one(c.env, 'SELECT * FROM memberships WHERE id = $1', [m.id]);
  return c.json(await adGateFor(c.env, fresh, me));
});

membershipAdGate.post('/memberships/:id/ad-gate/claim', async (c) => {
  if (c.env.ADS_CLIENT_CLAIM !== 'true') throw new ApiError(403, 'SSV_REQUIRED', 'Rewards are verified by the ad network');
  const me = c.get('user');
  const m = await gatedMembership(c);
  if (!settingsOfRow(m).enabled) throw bad('This membership has no ad gate', 'NO_AD_GATE');
  await applyMembershipGateAd(c.env, me.id, m.id, { verified: false });
  return c.json(await adGateFor(c.env, m, me));
});
