import { Hono } from 'hono';
import { q, one } from '../lib/db.js';
import { body, bad, today } from '../lib/http.js';
import { ALLOWED_STEPS, parseDateUtc, formatUtc, addDaysUtc, getUserStreak } from '../lib/rhythm.js';

const rhythm = new Hono();

// PUT /me/rhythm/:day - update daily rhythm steps & optional private reflection
rhythm.put('/me/rhythm/:day', async (c) => {
  const user = c.get('user');
  const day = c.req.param('day');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw bad('Invalid date format (YYYY-MM-DD)', 'BAD_DATE');
  }

  const userToday = today(user.tz_offset);
  const dayMs = Date.parse(day + 'T00:00:00Z');
  const todayMs = Date.parse(userToday + 'T00:00:00Z');
  if (Number.isNaN(dayMs)) {
    throw bad('Invalid date', 'BAD_DATE');
  }

  const diffDays = Math.round((dayMs - todayMs) / 86400000);
  if (diffDays < -7 || diffDays > 1) {
    throw bad('Day must be between 7 days ago and tomorrow of your local date', 'DATE_OUT_OF_RANGE');
  }

  const b = await body(c);

  let steps = [];
  if (b.steps !== undefined) {
    if (!Array.isArray(b.steps)) {
      throw bad('steps must be an array', 'INVALID_STEPS');
    }
    for (const s of b.steps) {
      if (!ALLOWED_STEPS.includes(s)) {
        throw bad(`Invalid step: ${s}. Allowed steps are: ${ALLOWED_STEPS.join(', ')}`, 'INVALID_STEP');
      }
    }
    steps = Array.from(new Set(b.steps));
  }

  let reflection = undefined;
  if (b.reflection !== undefined) {
    if (b.reflection === null) {
      reflection = null;
    } else {
      if (typeof b.reflection !== 'string') {
        throw bad('reflection must be a string', 'INVALID_REFLECTION');
      }
      if (b.reflection.length > 2000) {
        throw bad('Reflection must be 2000 characters or less', 'REFLECTION_TOO_LONG');
      }
      reflection = b.reflection;
    }
  }

  // Insert or merge steps without deleting existing ones
  const rows = await q(c.env, `
    INSERT INTO rhythm_days (user_id, day, steps, reflection, updated_at)
    VALUES ($1, $2::date, $3, $4, now())
    ON CONFLICT (user_id, day) DO UPDATE
    SET steps = ARRAY(SELECT DISTINCT u FROM unnest(rhythm_days.steps || EXCLUDED.steps) AS u),
        reflection = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE rhythm_days.reflection END,
        updated_at = now()
    RETURNING to_char(day, 'YYYY-MM-DD') AS day, steps, reflection, updated_at
  `, [user.id, day, steps, reflection]);

  const row = rows[0];
  const streakInfo = await getUserStreak(c.env, user.id, user.tz_offset, user.best_streak);

  return c.json({
    ok: true,
    day: row.day,
    steps: row.steps || [],
    reflection: row.reflection || null,
    updatedAt: new Date(row.updated_at).toISOString(),
    streak: streakInfo.streak,
    bestStreak: streakInfo.bestStreak,
    graceUsedThisWeek: streakInfo.graceUsedThisWeek,
  });
});

// GET /me/rhythm?since=YYYY-MM-DD - get rhythm days (up to last 120 days)
rhythm.get('/me/rhythm', async (c) => {
  const user = c.get('user');
  const userToday = today(user.tz_offset);
  const minSince = formatUtc(addDaysUtc(parseDateUtc(userToday), -120));

  let since = c.req.query('since');
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since) || since < minSince) {
    since = minSince;
  }

  const rows = await q(c.env, `
    SELECT to_char(day, 'YYYY-MM-DD') AS day, steps, reflection, updated_at
    FROM rhythm_days
    WHERE user_id = $1 AND day >= $2::date
    ORDER BY day ASC
  `, [user.id, since]);

  const streakInfo = await getUserStreak(c.env, user.id, user.tz_offset, user.best_streak);

  return c.json({
    days: rows.map((r) => ({
      day: r.day,
      steps: r.steps || [],
      reflection: r.reflection || null,
      updatedAt: new Date(r.updated_at).toISOString(),
    })),
    streak: streakInfo.streak,
    bestStreak: streakInfo.bestStreak,
    graceUsedThisWeek: streakInfo.graceUsedThisWeek,
  });
});

export default rhythm;
