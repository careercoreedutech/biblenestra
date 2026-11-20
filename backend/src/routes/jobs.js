import { Hono } from 'hono';
import { one, q } from '../lib/db.js';
import { ApiError, bad, body, decodeCursor, encodeCursor, forbidden, notFound, str, uuidParam } from '../lib/http.js';
import { userJson } from '../lib/shape.js';
import { RULES } from '../lib/rules.js';
import { jobAdsNeeded } from '../lib/rules.js';

const r = new Hono();

const SELECT = `SELECT j.*, ${userJson('u')} AS client,
    (SELECT json_build_object('id', b.id, 'status', b.status, 'feeCoins', b.fee_coins, 'createdAt', b.created_at)
       FROM bids b WHERE b.job_id = j.id AND b.bidder_id = $1) AS my_bid
  FROM jobs j JOIN users u ON u.id = j.client_id`;

const shape = (x, me) => ({
  id: x.id, client: x.client, kind: x.kind, title: x.title, description: x.description, category: x.category, budget: x.budget,
  deadline: x.deadline, skills: x.skills || [], status: x.status, bids: x.bids_count, createdAt: new Date(x.created_at).toISOString(),
  mine: x.client_id === me.id, myBid: x.my_bid || null,
});
const bidShape = (b) => ({ id: b.id, jobId: b.job_id, jobTitle: b.job_title, cover: b.cover, amount: b.amount, timeline: b.timeline,
  feeCoins: b.fee_coins, status: b.status, createdAt: new Date(b.created_at).toISOString(), bidder: b.bidder || undefined });

r.get('/jobs', async (c) => {
  const me = c.get('user');
  const cur = decodeCursor(c.req.query('cursor'));
  const kind = c.req.query('kind');
  const args = [me.id];
  let w = `j.status = 'open' AND NOT u.banned`;
  if (kind) { if (!['job', 'task', 'bounty'].includes(kind)) throw bad('Unknown kind'); args.push(kind); w += ` AND j.kind = $${args.length}`; }
  if (cur) { args.push(cur.ts, cur.id); w += ` AND (j.created_at, j.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`; }
  const rows = await q(c.env, `${SELECT} WHERE ${w} ORDER BY j.created_at DESC, j.id DESC LIMIT 31`, args);
  const items = rows.slice(0, 30);
  return c.json({ items: items.map((x) => shape(x, me)), nextCursor: rows.length > 30 ? encodeCursor(items[items.length - 1]) : null });
});

r.get('/jobs/:id', async (c) => {
  const me = c.get('user');
  const row = await one(c.env, `${SELECT} WHERE j.id = $2`, [me.id, uuidParam(c)]);
  if (!row) throw notFound('Job not found');
  return c.json(shape(row, me));
});

r.post('/jobs', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const kind = b.kind || 'job';
  if (!['job', 'task', 'bounty'].includes(kind)) throw bad('kind must be job, task or bounty');
  const skills = Array.isArray(b.skills) ? b.skills.slice(0, 15).map((s) => str(s, { max: 40, field: 'skill' })).filter(Boolean) : [];
  const row = await one(c.env, `INSERT INTO jobs (client_id, kind, title, description, category, budget, deadline, skills)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [me.id, kind, str(b.title, { min: 3, max: 200, field: 'Title' }),
    str(b.description, { max: 8000, field: 'Description' }), str(b.category, { max: 80, optional: true }),
    str(b.budget, { max: 80, optional: true }), str(b.deadline, { max: 80, optional: true }), skills]);
  const full = await one(c.env, `${SELECT} WHERE j.id = $2`, [me.id, row.id]);
  return c.json(shape(full, me), 201);
});

// Place a bid: charges the bid fee in the same SQL statement that records the bid, so coins can never
// be taken without a bid (or a bid created without paying), even with concurrent requests.
r.post('/jobs/:id/bids', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const b = await body(c);
  const cover = str(b.cover, { min: 1, max: 4000, field: 'Proposal' });
  const fee = RULES.bidFee;
  let row;
  try {
    row = await one(c.env, `WITH j AS (SELECT id, title FROM jobs WHERE id = $2 AND status = 'open' AND client_id <> $1),
      pay AS (UPDATE users SET coins = coins - $6 WHERE id = $1 AND coins >= $6 AND EXISTS (SELECT 1 FROM j)
                AND NOT EXISTS (SELECT 1 FROM bids WHERE job_id = $2 AND bidder_id = $1) RETURNING coins),
      ins AS (INSERT INTO bids (job_id, bidder_id, cover, amount, timeline, fee_coins)
                SELECT $2, $1, $3, $4, $5, $6 FROM pay RETURNING *),
      led AS (INSERT INTO coin_ledger (user_id, amount, reason, ref) SELECT $1, -$6, 'job_bid', $2::text FROM ins),
      cnt AS (UPDATE jobs SET bids_count = bids_count + 1 WHERE id IN (SELECT job_id FROM ins))
      SELECT ins.*, (SELECT title FROM j) AS job_title, (SELECT coins FROM pay) AS coins_left FROM ins`,
    [me.id, id, cover, str(b.amount, { max: 80, optional: true }), str(b.timeline, { max: 80, optional: true }), fee]);
  } catch (e) {
    if (/unique|duplicate/i.test(e.message)) throw new ApiError(409, 'ALREADY_BID', 'You have already bid on this job');
    throw e;
  }
  if (!row) {
    const job = await one(c.env, 'SELECT client_id, status FROM jobs WHERE id = $1', [id]);
    if (!job) throw notFound('Job not found');
    if (job.client_id === me.id) throw bad("You can't bid on your own job", 'OWN_JOB');
    if (job.status !== 'open') throw new ApiError(409, 'JOB_CLOSED', 'This job is no longer open');
    const dup = await one(c.env, 'SELECT 1 FROM bids WHERE job_id = $1 AND bidder_id = $2', [id, me.id]);
    if (dup) throw new ApiError(409, 'ALREADY_BID', 'You have already bid on this job');
    const u = await one(c.env, 'SELECT coins FROM users WHERE id = $1', [me.id]);
    throw new ApiError(402, 'INSUFFICIENT_COINS', `Bidding costs ${fee} coins — you have ${u.coins}. Watch ${jobAdsNeeded(c.env)} ads to unlock ${RULES.jobAdCoins} coins.`);
  }
  return c.json({ bid: bidShape(row), coins: row.coins_left }, 201);
});

r.get('/jobs/:id/bids', async (c) => {
  const me = c.get('user');
  const id = uuidParam(c);
  const job = await one(c.env, 'SELECT client_id FROM jobs WHERE id = $1', [id]);
  if (!job) throw notFound('Job not found');
  if (job.client_id !== me.id) throw forbidden('Only the job owner can see bids');
  const rows = await q(c.env, `SELECT b.*, j.title AS job_title, ${userJson('u')} AS bidder FROM bids b JOIN jobs j ON j.id = b.job_id
      JOIN users u ON u.id = b.bidder_id WHERE b.job_id = $1 ORDER BY b.created_at`, [id]);
  return c.json({ items: rows.map(bidShape) });
});

// Withdraw your bid. The bid fee is not refunded (it keeps proposals serious), and the bid row stays
// with status 'withdrawn', so the same job can't be bid on again.
r.post('/bids/:id/withdraw', async (c) => {
  const row = await one(c.env, `WITH up AS (UPDATE bids SET status = 'withdrawn' WHERE id = $1 AND bidder_id = $2 AND status IN ('pending','shortlisted') RETURNING *)
      SELECT up.*, j.title AS job_title FROM up JOIN jobs j ON j.id = up.job_id`, [uuidParam(c), c.get('user').id]);
  if (!row) throw notFound('Bid not found or already decided');
  return c.json({ bid: bidShape(row) });
});

// Job owner: close the listing, or mark a bid accepted (which fills the job) / declined
r.post('/jobs/:id/close', async (c) => {
  const row = await one(c.env, `UPDATE jobs SET status = 'closed' WHERE id = $1 AND client_id = $2 RETURNING id`, [uuidParam(c), c.get('user').id]);
  if (!row) throw forbidden('Only the job owner can close it');
  return c.json({ ok: true, status: 'closed' });
});

r.post('/bids/:id/decide', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  if (!['accepted', 'declined', 'shortlisted'].includes(b.status)) throw bad('status must be accepted, declined or shortlisted');
  const row = await one(c.env, `WITH up AS (UPDATE bids SET status = $3 WHERE id = $1 AND status <> 'withdrawn'
        AND job_id IN (SELECT id FROM jobs WHERE client_id = $2) RETURNING *),
      fill AS (UPDATE jobs SET status = 'filled' WHERE $3 = 'accepted' AND id IN (SELECT job_id FROM up))
      SELECT up.*, j.title AS job_title FROM up JOIN jobs j ON j.id = up.job_id`, [uuidParam(c), me.id, b.status]);
  if (!row) throw notFound('Bid not found');
  return c.json({ bid: bidShape(row) });
});

r.get('/me/bids', async (c) => {
  const rows = await q(c.env, `SELECT b.*, j.title AS job_title FROM bids b JOIN jobs j ON j.id = b.job_id
      WHERE b.bidder_id = $1 ORDER BY b.created_at DESC LIMIT 200`, [c.get('user').id]);
  return c.json({ items: rows.map(bidShape) });
});

export default r;
