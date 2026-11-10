// Scheduled job (Cloudflare cron, every 15 minutes): pays out finished quizzes and sends contest
// reminders. Each reminder goes to each person at most once per contest (contest_reminders).
import { q } from './db.js';
import { settleDue } from '../routes/contests.js';

const REMINDERS = [
  {
    kind: 'starting',
    title: "'Starting soon: ' || c.title",
    body: "'Your contest starts within the hour. Good luck!'",
    due: "c.starts_at BETWEEN now() AND now() + interval '1 hour'",
    who: 'SELECT r.contest_id, r.user_id FROM contest_registrations r WHERE NOT r.disqualified',
  },
  {
    kind: 'submission_deadline',
    title: "'Deadline tomorrow: ' || c.title",
    body: "'Submit your entry before the deadline.'",
    due: "c.format = 'submission' AND c.ends_at BETWEEN now() AND now() + interval '24 hours' AND c.starts_at < now()",
    who: `SELECT r.contest_id, r.user_id FROM contest_registrations r WHERE NOT r.disqualified
          AND NOT EXISTS (SELECT 1 FROM contest_submissions s WHERE s.contest_id = r.contest_id AND s.user_id = r.user_id)`,
  },
  {
    kind: 'voting_open',
    title: "'Voting is open: ' || c.title",
    body: "'Look at the entries and cast your vote.'",
    due: "c.format = 'submission' AND c.voting_enabled AND c.ends_at < now() AND c.voting_ends_at > now()",
    who: 'SELECT r.contest_id, r.user_id FROM contest_registrations r WHERE NOT r.disqualified',
  },
  {
    kind: 'voting_closing',
    title: "'Voting closes soon: ' || c.title",
    body: "'Voting ends within a day.'",
    due: "c.format = 'submission' AND c.voting_enabled AND c.voting_ends_at BETWEEN now() AND now() + interval '24 hours'",
    who: `SELECT r.contest_id, r.user_id FROM contest_registrations r WHERE NOT r.disqualified
          AND NOT EXISTS (SELECT 1 FROM contest_votes v WHERE v.contest_id = r.contest_id AND v.user_id = r.user_id AND v.valid)`,
  },
];

export async function sendContestReminders(env) {
  let sent = 0;
  for (const r of REMINDERS) {
    const rows = await q(env, `WITH due AS (
        SELECT c.id, c.title FROM contests c WHERE NOT c.cancelled AND NOT c.paused AND c.approval = 'approved' AND c.results_published_at IS NULL AND ${r.due}
      ), people AS (${r.who}), fresh AS (
        INSERT INTO contest_reminders (contest_id, user_id, kind)
        SELECT p.contest_id, p.user_id, '${r.kind}' FROM people p JOIN due d ON d.id = p.contest_id
        ON CONFLICT DO NOTHING RETURNING contest_id, user_id
      )
      INSERT INTO notifications (user_id, kind, title, body, data)
      SELECT f.user_id, 'contest', ${r.title}, ${r.body}, json_build_object('contestId', f.contest_id, 'type', '${r.kind}')::jsonb
      FROM fresh f JOIN contests c ON c.id = f.contest_id RETURNING id`);
    sent += rows.length;
  }
  return sent;
}

export async function runContestCron(env, executionCtx) {
  const ctx = { env, executionCtx };
  try { await settleDue(ctx); } catch (e) { console.error('[contest cron] settle failed', e && e.message); }
  try { const n = await sendContestReminders(env); if (n) console.log('[contest cron] reminders sent', n); } catch (e) { console.error('[contest cron] reminders failed', e && e.message); }
}
