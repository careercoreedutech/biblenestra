// ADS: remote ad rules and ad event logging.
//   GET  /ads/config                     public — { version, updatedAt, config } (cached ~1 min)
//   POST /ads/events {events:[…]}        signed in — batched ad events → daily aggregates
//   GET  /admin/api/ads/config           admin — current rules, defaults, last saves
//   PUT  /admin/api/ads/config {config, note?}  admin — validate + save a new version (audited)
//   GET  /admin/api/ads/stats?days=30&test=1    admin — impressions, completion, fill rate, revenue
// The dashboard tab lives in lib/adsAdminPage.js.
import { Hono } from 'hono';
import { bad, body } from '../lib/http.js';
import { audit, requireAdmin, registerAdminScript } from './admin.js';
import {
  DEFAULT_AD_CONFIG, EVENT_LIMITS, getAdConfig, saveAdConfig, adConfigHistory, recordAdEvents, adStats, getBreakRules,
} from '../lib/ads.js';
import { ADS_ADMIN_SCRIPT } from '../lib/adsAdminPage.js';
import { getAdExtras, getAdNetworks } from '../lib/adExtras.js'; // AD NETWORKS: plans-at-launch, Beyond-the-66 rules, backup network ids
import {
  listHouseAds, listActiveHouseAds, createHouseAd, updateHouseAd, deleteHouseAd, recordHouseEvent,
} from '../lib/houseAds.js'; // HOUSE ADS: our own sponsored ads (fill of last resort)

registerAdminScript(ADS_ADMIN_SCRIPT);

// ---------- public ----------
export const adsPublic = new Hono();
// `breaks` = the interstitial rules (registerConfig 'ad_breaks': after how many active minutes, gaps and caps)
// `extras` = plans-at-launch + Beyond-the-66 rules (registerConfig 'ad_extras'); `networks` = backup network ids ('ad_networks')
adsPublic.get('/ads/config', async (c) => {
  const cfg = await getAdConfig(c.env);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({
    ...cfg,
    breaks: await getBreakRules(c.env),
    extras: await getAdExtras(c.env),
    networks: await getAdNetworks(c.env),
  });
});

// HOUSE ADS (public): the active list, and counting. Counting is by id only; unknown or inactive ids count nothing.
adsPublic.get('/ads/house', async (c) => {
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({ ads: await listActiveHouseAds(c.env) });
});
adsPublic.post('/ads/house/:id/impression', async (c) => c.json(await recordHouseEvent(c.env, c.req.param('id'), 'impression')));
adsPublic.post('/ads/house/:id/click', async (c) => c.json(await recordHouseEvent(c.env, c.req.param('id'), 'click')));

// ---------- signed in ----------
export const ads = new Hono();
ads.post('/ads/events', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (!Array.isArray(b.events)) throw bad('events must be a list', 'BAD_EVENTS');
  if (b.events.length > EVENT_LIMITS.batch * 4) throw bad(`Send at most ${EVENT_LIMITS.batch} events at a time`, 'TOO_MANY_EVENTS');
  const r = await recordAdEvents(c.env, me.id, b.events);
  return c.json({ ok: true, ...r });
});

// ---------- admin ----------
export const adminAds = new Hono();
adminAds.use('/admin/api/ads/*', requireAdmin);

adminAds.get('/admin/api/ads/config', async (c) => {
  const cur = await getAdConfig(c.env, { fresh: true });
  return c.json({ ...cur, defaults: DEFAULT_AD_CONFIG, history: await adConfigHistory(c.env), limits: EVENT_LIMITS });
});

adminAds.put('/admin/api/ads/config', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) : '';
  const saved = await saveAdConfig(c.env, me, b.config, note);
  await audit(c.env, me, 'ads.config.update', 'ad_config', saved.version, { title: `Ad rules v${saved.version}`, note, config: saved.config });
  return c.json({ ...saved, history: await adConfigHistory(c.env) });
});

adminAds.get('/admin/api/ads/stats', async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 365);
  const includeTest = ['1', 'true', 'yes'].includes(String(c.req.query('test') || '').toLowerCase());
  return c.json(await adStats(c.env, { days, includeTest }));
});

// HOUSE ADS (admin): list with counts, create, edit, delete. Images are uploaded with POST /uploads/image first.
adminAds.get('/admin/api/ads/house', async (c) => c.json({ ads: await listHouseAds(c.env) }));
adminAds.post('/admin/api/ads/house', async (c) => {
  const me = c.get('user');
  const ad = await createHouseAd(c.env, me, await body(c));
  await audit(c.env, me, 'ads.house.create', 'house_ads', ad.id, { title: `House ad: ${ad.title}` });
  return c.json(ad, 201);
});
adminAds.put('/admin/api/ads/house/:id', async (c) => {
  const me = c.get('user');
  const ad = await updateHouseAd(c.env, c.req.param('id'), await body(c));
  await audit(c.env, me, 'ads.house.update', 'house_ads', ad.id, { title: `House ad: ${ad.title}` });
  return c.json(ad);
});
adminAds.delete('/admin/api/ads/house/:id', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  const out = await deleteHouseAd(c.env, id);
  await audit(c.env, me, 'ads.house.delete', 'house_ads', id, { title: 'House ad deleted' });
  return c.json(out);
});
