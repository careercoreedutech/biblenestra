// Gifts route — atomic coin transfer between users
import { Hono } from 'hono';
import { body, str, uuidParam, bad, ApiError, notFound } from '../lib/http.js';
import { q, one } from '../lib/db.js';
import { RULES, GIFT_MAP } from '../lib/rules.js';
import { notifyUser } from '../hub.js';
import { sendNotification } from '../lib/push.js';

const gifts = new Hono();

// POST /gifts — send virtual gift to a user
gifts.post('/gifts', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const toUserId = b.toUserId;
  const giftId = str(b.giftId, { field: 'giftId' });
  const postId = b.postId || null;

  if (!toUserId || toUserId === me.id) throw bad('You cannot send gifts to yourself');

  const gift = GIFT_MAP.get(giftId);
  if (!gift) throw bad('Invalid gift type');

  const recipient = await one(c.env, `SELECT * FROM users WHERE id = $1`, [toUserId]);
  if (!recipient) throw notFound('Recipient not found');

  const price = gift.price;
  const creatorShare = Math.round(price * (RULES.creatorGiftShare || 0.70));

  // 1. Atomically deduct coins from sender (ensures coins >= price without race conditions)
  const deducted = await one(c.env,
    `UPDATE users SET coins = coins - $1 WHERE id = $2 AND coins >= $1 RETURNING coins`,
    [price, me.id]
  );
  if (!deducted) {
    throw new ApiError(402, 'INSUFFICIENT_COINS', 'You do not have enough coins for this gift');
  }

  // 2. Credit creator / recipient
  await q(c.env, `UPDATE users SET coins = coins + $1 WHERE id = $2`, [creatorShare, toUserId]);

  // 3. Record transaction
  const tx = await one(c.env,
    `INSERT INTO gift_transactions (from_id, to_id, gift_id, coins, creator_coins, post_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [me.id, toUserId, giftId, price, creatorShare, postId]
  );

  // 4. Record ledger entries
  await q(c.env,
    `INSERT INTO coin_ledger (user_id, amount, reason, ref)
     VALUES ($1, $2, 'gift_sent', $3), ($4, $5, 'gift_received', $3)`,
    [me.id, -price, tx.id, toUserId, creatorShare]
  );

  // 5. Notify recipient in real time and via push
  notifyUser(c.env, toUserId, {
    type: 'gift.received',
    from: { id: me.id, displayName: me.display_name },
    gift,
    coins: creatorShare,
  });

  sendNotification(c, {
    userId: toUserId,
    kind: 'gift',
    title: '🎁 You Received a Gift!',
    body: `${me.display_name} sent you a ${gift.name} (+${creatorShare} coins).`,
    data: { transactionId: tx.id, giftId, fromId: me.id },
  });

  return c.json({
    ok: true,
    coinsRemaining: deducted.coins,
    coinsGiven: creatorShare,
    gift,
    transactionId: tx.id,
  }, 201);
});

export default gifts;
