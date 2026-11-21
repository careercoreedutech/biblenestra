// <GiftButton recipientId name context={{ type, id }} label? small? kind? onSent? /> — a button that opens <GiftSheet>.
// For other features (e.g. Find Love dating chats: context={{ type: 'chat', id: conversationId }}).
import React, { useState } from 'react';
import { Button } from '../ui';
import { Icon } from '../Icons';
import { colors } from '../../theme';
import { GiftSheet } from './GiftSheet';

export function GiftButton({ recipientId, name, context, label = 'Send a gift', small = true, kind = 'ghost', onSent, style, disabled }) {
  const [open, setOpen] = useState(false);
  const ctx = context || { type: 'profile', id: recipientId };
  return (
    <>
      <Button small={small} kind={kind} style={style} disabled={disabled} label={label}
        icon={<Icon name="gift" size={13} color={kind === 'primary' ? '#FFFFFF' : colors.rose} />} onPress={() => setOpen(true)} />
      <GiftSheet visible={open} onClose={() => setOpen(false)} recipient={recipientId ? { id: recipientId, name } : null} context={ctx} onSent={onSent} />
    </>
  );
}
