// PERSONALISATION: interests at sign-up and in Profile, used by the For you feed.
// Server: backend/src/routes/personalisation.js (GET/PUT /me/interests) and backend/src/lib/feedRanking.js (TOPICS).
// The topic list is mirrored here so the sign-up step renders at once; the server rejects unknown ids.
export const TOPIC_OPTIONS = [
  { id: 'prayer', label: 'Prayer' },
  { id: 'worship', label: 'Worship' },
  { id: 'bible-study', label: 'Bible study' },
  { id: 'youth', label: 'Youth' },
  { id: 'marriage-family', label: 'Marriage & family' },
  { id: 'healing', label: 'Healing' },
  { id: 'missions', label: 'Missions' },
  { id: 'prophecy', label: 'Prophecy' },
  { id: 'christian-living', label: 'Christian living' },
  { id: 'business-faith', label: 'Business & faith' },
  { id: 'music', label: 'Music' },
  { id: 'sermons', label: 'Sermons' },
  { id: 'testimonies', label: 'Testimonies' },
  { id: 'devotionals', label: 'Devotionals' },
];

export const topicLabel = (id) => (TOPIC_OPTIONS.find((t) => t.id === id) || { label: id }).label;
export const topicIdFor = (label) => (TOPIC_OPTIONS.find((t) => t.label === label) || {}).id;

/** GET /me/interests → { interests, country, city, church, denomination } */
export function loadInterests(api) {
  return api.request('GET', '/me/interests');
}

/** PUT /me/interests — every field optional. Returns the saved profile fields. */
export function saveInterests(api, patch) {
  return api.request('PUT', '/me/interests', patch);
}
