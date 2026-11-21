// VIRTUAL GIFTS & STARS — reusable pieces (contract: scratch/monetisation/gifts.md).
//   <GiftButton recipientId name context={{ type, id }} />      opens <GiftSheet> (dating chats: type 'chat', id = conversation id)
//   <GiftSheet visible onClose recipient context recipients? onSent? />
//   <GiftArt gift size animate /> · <GiftPlayer play onDone /> · <GiftOverlay … /> (in-box) · <GiftBubble vgift mine from />
//   <GiftWall userId name /> · useIncomingGiftPlayer(messages) · useLiveRooms · <LiveGiftLayer room /> · <GoLiveRow />
export { GiftArt, GiftDrawing, GIFT_TINT } from './GiftArt';
export { GiftPlayer, GiftOverlay } from './GiftPlayer';
export { GiftSheet, GiftGrid } from './GiftSheet';
export { GiftButton } from './GiftButton';
export { GiftBubble, useIncomingGiftPlayer } from './GiftBubble';
export { GiftWall } from './GiftWall';
export { useLiveRooms, LiveGiftLayer, GoLiveRow } from './LiveGifts';
