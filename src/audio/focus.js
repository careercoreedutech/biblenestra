// Audio focus: only one source plays at a time (scripture narration vs. the library player).
// A source calls claimAudio('narration' | 'library') right before it starts making sound; every other
// source is told to pause. currentOwner() tells the shared MiniPlayer which one to show.
const listeners = new Set();
let owner = null;

export function claimAudio(who) {
  owner = who;
  listeners.forEach((fn) => { try { fn(who); } catch (e) { /* ignore */ } });
}

export function currentOwner() {
  return owner;
}

/** fn(newOwner) is called on every claim; returns an unsubscribe function. */
export function onAudioClaim(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
