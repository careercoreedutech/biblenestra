// MY SCRIPTURE JOURNEY routes (signed in). Logic: lib/journey.js.
//   GET  /journey/config                    presets, notification cap (public to the signed-in app)
//   GET  /journey/goal                      the user's goal, targets, books, translation, zone, delivery
//   PUT  /journey/goal                      save any of those fields
//   POST /journey/events/sync               batch of reading events (idempotent by clientId) → accepted / duplicates / awarded
//   GET  /journey/stats?tz=&tzOffset=       dashboard: day / week / month, unique progress, streak, calendar, books
//   GET  /journey/achievements              all awards, newest first
//   POST /journey/achievements/seen         { ids } → mark celebrations as shown
//   GET  /journey/groups                    community goals the user is in
//   POST /journey/groups                    create a community goal (creator is the owner)
//   POST /journey/groups/join               { code } → join by invite code
//   GET  /journey/groups/:id                combined progress and leaderboard
//   POST /journey/groups/:id/leave          leave (the owner cannot)
//   PUT  /journey/groups/:id/privacy        { hideNumbers } → hide your personal numbers from the others
import { Hono } from 'hono';
import { body, uuidParam } from '../lib/http.js';
import {
  journeySettings, getGoal, goalView, saveGoal, syncEvents, statsFor, listAchievements, markSeen,
  createGroup, listGroups, joinGroup, leaveGroup, setGroupPrivacy, groupProgress, zoneOf, localDay,
} from '../lib/journey.js';

export const journey = new Hono();

// The user's local day for "today": explicit tz, else the goal's zone, else the offset the app sends.
async function viewerDay(c, me) {
  const tz = c.req.query('tz');
  const off = Number(c.req.query('tzOffset') ?? c.req.header('X-TZ-Offset'));
  const goal = goalView(await getGoal(c.env, me.id));
  const zone = zoneOf(tz) ? tz : (zoneOf(goal.timezone) ? goal.timezone : null);
  const offset = Number.isInteger(off) ? off : (Number.isInteger(me.tz_offset) ? me.tz_offset : undefined);
  return { tz: zone, tzOffset: offset, today: localDay(Date.now(), zone, offset) };
}

journey.get('/journey/config', async (c) => {
  const s = await journeySettings(c.env);
  return c.json({ presets: s.presets, maxPushPerDay: s.maxPushPerDay, streakMilestones: s.streakMilestones, verseMilestones: s.verseMilestones });
});

journey.get('/journey/goal', async (c) => {
  return c.json({ goal: goalView(await getGoal(c.env, c.get('user').id)) });
});

journey.put('/journey/goal', async (c) => {
  const b = await body(c);
  return c.json({ goal: await saveGoal(c.env, c.get('user').id, b) });
});

journey.post('/journey/events/sync', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const off = Number(b.tzOffset);
  const out = await syncEvents(c.env, me.id, {
    tz: typeof b.tz === 'string' ? b.tz : undefined,
    tzOffset: Number.isInteger(off) ? off : undefined,
    events: b.events,
  });
  return c.json(out);
});

journey.get('/journey/stats', async (c) => {
  const me = c.get('user');
  const v = await viewerDay(c, me);
  return c.json(await statsFor(c.env, me.id, { tz: v.tz, tzOffset: v.tzOffset }));
});

journey.get('/journey/achievements', async (c) => {
  const items = await listAchievements(c.env, c.get('user').id);
  return c.json({ items, unseen: items.filter((a) => !a.seen).length });
});

journey.post('/journey/achievements/seen', async (c) => {
  const b = await body(c);
  return c.json({ marked: await markSeen(c.env, c.get('user').id, b.ids) });
});

journey.get('/journey/groups', async (c) => {
  const me = c.get('user');
  const v = await viewerDay(c, me);
  return c.json({ items: await listGroups(c.env, me.id, v.today) });
});

journey.post('/journey/groups', async (c) => {
  const me = c.get('user');
  const g = await createGroup(c.env, me.id, await body(c));
  return c.json(g, 201);
});

journey.post('/journey/groups/join', async (c) => {
  const b = await body(c);
  return c.json(await joinGroup(c.env, c.get('user').id, b.code));
});

journey.get('/journey/groups/:id', async (c) => {
  const id = uuidParam(c, 'id');
  return c.json(await groupProgress(c.env, c.get('user').id, id));
});

journey.post('/journey/groups/:id/leave', async (c) => {
  const id = uuidParam(c, 'id');
  await leaveGroup(c.env, c.get('user').id, id);
  return c.json({ left: true });
});

journey.put('/journey/groups/:id/privacy', async (c) => {
  const id = uuidParam(c, 'id');
  const b = await body(c);
  return c.json({ hideNumbers: await setGroupPrivacy(c.env, c.get('user').id, id, b.hideNumbers) });
});
