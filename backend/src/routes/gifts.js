// Gifts route — atomic coin transfer between users
import { Hono } from 'hono';
import { body, str, uuidParam, bad, ApiError, notFound, isUuid } from '../lib/http.js';
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
  let postId = b.postId || null;
  const commentId = b.commentId || null;

  if (!toUserId || toUserId === me.id) throw bad('You cannot send gifts to yourself');
  if (!isUuid(toUserId)) throw notFound('Recipient not found');
  if (postId && !isUuid(postId)) postId = null; // device-only ids (not on the server) carry no context
  if (commentId !== null && !isUuid(commentId)) throw bad('Bad commentId');

  const gift = GIFT_MAP.get(giftId);
  if (!gift) throw bad('Invalid gift type');

  const recipient = await one(c.env, `SELECT * FROM users WHERE id = $1 AND NOT banned`, [toUserId]);
  if (!recipient) throw notFound('Recipient not found');
  // Gifting from a comment: the comment must be the recipient's, on a live post (and on postId if given)
  let comment = null;
  if (commentId) {
    comment = await one(c.env, `SELECT cm.id, cm.post_id, cm.body FROM comments cm JOIN posts p ON p.id = cm.post_id
        WHERE cm.id = $1 AND cm.author_id = $2 AND NOT p.removed`, [commentId, toUserId]);
    if (!comment || (postId && comment.post_id !== postId)) throw bad('That comment is not from this person', 'BAD_COMMENT');
    postId = comment.post_id;
  } else if (postId && !(await one(c.env, 'SELECT 1 FROM posts WHERE id = $1', [postId]))) {
    postId = null;
  }

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
    `INSERT INTO gift_transactions (from_id, to_id, gift_id, coins, creator_coins, post_id, comment_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [me.id, toUserId, giftId, price, creatorShare, postId, commentId]
  );

  // 4. Record ledger entries
  await q(c.env,
    `INSERT INTO coin_ledger (user_id, amount, reason, ref)
     VALUES ($1, $2, 'gift_sent', $3), ($4, $5, 'gift_received', $3)`,
    [me.id, -price, tx.id, toUserId, creatorShare]
  );

  // 5. Notify recipient in real time and via push
  await notifyUser(c.env, toUserId, {
    type: 'gift.received',
    from: { id: me.id, displayName: me.display_name },
    gift,
    coins: creatorShare,
  });

  await sendNotification(c, {
    userId: toUserId,
    kind: 'gift',
    title: '🎁 You Received a Gift!',
    body: comment
      ? `${me.display_name} sent you a ${gift.name} for your comment “${String(comment.body).slice(0, 50)}${String(comment.body).length > 50 ? '…' : ''}” (+${creatorShare} coins).`
      : `${me.display_name} sent you a ${gift.name} (+${creatorShare} coins).`,
    data: { type: 'gift', transactionId: tx.id, giftId, fromId: me.id, fromName: me.display_name, postId, commentId },
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
