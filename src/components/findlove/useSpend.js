// "Use the coins" helper: one <ConfirmSpend/> at a time (cost + balance after, before any Dating Coin is spent).
import React, { useState } from 'react';
import { ConfirmSpend } from '../wallet';

export function useSpend() {
  const [spendReq, setSpend] = useState(null); // { amount, wallet, title, description, run, done }
  const sheet = spendReq ? (
    <ConfirmSpend visible amount={spendReq.amount} wallet={spendReq.wallet || 'dating_coins'} title={spendReq.title} description={spendReq.description}
      confirmLabel={spendReq.confirmLabel} onConfirm={spendReq.run} onDone={spendReq.done} onClose={() => setSpend(null)} />
  ) : null;
  return [setSpend, sheet];
}
