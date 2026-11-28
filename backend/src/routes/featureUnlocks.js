// FEATURE UNLOCKS routes (signed in):
//   GET  /unlocks                 → { coins, catalogue, active }
//   POST /unlocks/:feature        → spend coins, grant until = max(now, until) + hours. Send an Idempotency-Key header
//                                   (or { ref } in the body); a retry with the same key charges nothing.
// Ad rewards come in through /ads/ssv and /ads/claim (routes/rewards.js) with purpose 'unlock:<feature>'.
import { Hono } from 'hono';
import { bad } from '../lib/http.js';
import { unlockStatus, spendUnlock, newRef, validRef } from '../lib/featureUnlocks.js';

export const featureUnlocks = new Hono();

featureUnlocks.get('/unlocks', async (c) => c.json(await unlockStatus(c.env, c.get('user').id)));

featureUnlocks.post('/unlocks/:feature', async (c) => {
  const me = c.get('user');
  const raw = await c.req.text();
  let b = {};
  if (raw) { try { b = JSON.parse(raw) || {}; } catch (e) { throw bad('Body must be JSON'); } }
  const headerKey = c.req.header('Idempotency-Key');
  const key = headerKey || b.ref || newRef();
  if (!validRef(key)) throw bad('Idempotency-Key must be 3 to 120 letters, digits, : _ . or -', 'BAD_KEY');
  const r = await spendUnlock(c.env, me.id, c.req.param('feature'), key);
  const status = await unlockStatus(c.env, me.id);
  return c.json({ duplicate: r.duplicate, coins: r.coins, unlock: r.unlock, catalogue: status.catalogue, active: status.active });
});
