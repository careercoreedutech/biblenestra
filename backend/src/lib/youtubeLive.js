// YOUTUBE LIVE: detects upcoming / live broadcasts on the admin-approved channels and sends ONE "LIVE NOW"
// notification per broadcast to everyone who hasn't turned live alerts off.
//
// How (cheap on quota):
//   1. each active channel's public RSS feed (free) → its ~15 most recent video ids
//   2. drop ids already known to be ordinary videos (youtube_seen_videos) or finished broadcasts;
//      add ids we are tracking as live / upcoming (to notice when they start or end)
//   3. YouTube Data API v3 videos.list?part=snippet,liveStreamingDetails&id=<≤50 ids> — 1 quota unit per call
//   4. upsert youtube_live; a broadcast that is 'live' and not yet notified is claimed atomically
//      (UPDATE … WHERE notified_at IS NULL) and the notifications go out in one INSERT … SELECT.
// Without the YOUTUBE_API_KEY secret, detection is skipped (the admin tab says how to enable it).
import { one, q } from './db.js';
import { channelVideos, VIDEO_ID_RE } from './youtube.js';

const API = 'https://www.googleapis.com/youtube/v3/videos';
const FIELDS = 'items(id,snippet(title,channelId,channelTitle,liveBroadcastContent,thumbnails/high/url,thumbnails/medium/url),liveStreamingDetails(actualStartTime,actualEndTime,scheduledStartTime))';
const MIN_GAP_MS = 4 * 60 * 1000; // cron runs are skipped if a check ran less than 4 minutes ago
const MAX_CHANNELS = 150;

const fetcher = (env) => (env && env.__fetch) || fetch;
export const hasApiKey = (env) => !!String((env && env.YOUTUBE_API_KEY) || '').trim();

export const LIVE_TITLE = '🔴 LIVE NOW!';
export const liveBody = (channel) => `${channel || 'A channel'} is live on Bible Nestra. Join the service now and participate in the broadcast.`;

const iso = (d) => (d ? new Date(d).toISOString() : null);
export const liveShape = (r) => ({
  videoId: r.video_id,
  channelId: r.channel_id,
  channelTitle: r.channel_title,
  title: r.title,
  thumbnail: r.thumbnail || `https://i.ytimg.com/vi/${r.video_id}/hqdefault.jpg`,
  status: r.status,
  scheduledStart: iso(r.scheduled_start),
  actualStart: iso(r.actual_start),
  actualEnd: iso(r.actual_end),
  detectedAt: iso(r.detected_at),
  updatedAt: iso(r.updated_at),
  notifiedAt: iso(r.notified_at),
  recipients: r.recipients || 0,
  pushSent: r.push_sent || 0,
  watchUrl: `https://www.youtube.com/watch?v=${r.video_id}`,
});

/** videos.list for up to 50 ids → items[] (throws on HTTP errors with a readable message) */
async function videosList(env, ids) {
  const url = `${API}?part=snippet,liveStreamingDetails&maxResults=50&id=${ids.map(encodeURIComponent).join(',')}&fields=${encodeURIComponent(FIELDS)}&key=${encodeURIComponent(String(env.YOUTUBE_API_KEY).trim())}`;
  const res = await fetcher(env)(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let msg = `YouTube Data API answered ${res.status}`;
    try { const j = await res.json(); if (j && j.error && j.error.message) msg += ` — ${String(j.error.message).slice(0, 200)}`; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return Array.isArray(j.items) ? j.items : [];
}

/** snippet + liveStreamingDetails → 'live' | 'upcoming' | 'ended' | null (ordinary video) */
export function broadcastStatus(item) {
  const lbc = item && item.snippet && item.snippet.liveBroadcastContent;
  const d = item && item.liveStreamingDetails;
  if (lbc === 'live') return 'live';
  if (lbc === 'upcoming') return 'upcoming';
  if (d && (d.actualStartTime || d.actualEndTime || d.scheduledStartTime)) return 'ended';
  return null;
}

/** Send the one-and-only LIVE notification for a video. Returns { recipients } or null if it was already sent. */
export async function notifyLive(env, videoId) {
  const row = await one(env, 'SELECT * FROM youtube_live WHERE video_id = $1', [videoId]);
  if (!row || row.status !== 'live' || row.notified_at) return null;
  const channel = row.channel_title || 'A Bible Nestra channel';
  const data = {
    type: 'live', from: 'Bible Nestra', videoId, channelId: row.channel_id, channelTitle: channel,
    videoTitle: row.title, thumbnail: row.thumbnail, action: 'Join live service', route: 'YouTubeWatch',
  };
  const res = await one(env, `WITH claim AS (
      UPDATE youtube_live SET notified_at = now() WHERE video_id = $1 AND notified_at IS NULL AND status = 'live' RETURNING video_id
    ), ins AS (
      INSERT INTO notifications (user_id, kind, title, body, data)
      SELECT u.id, 'live', $2, $3, $4::jsonb FROM users u CROSS JOIN claim
      WHERE NOT u.banned AND COALESCE(u.notify->>'live', 'true') <> 'false'
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM ins)::int AS recipients`,
  [videoId, LIVE_TITLE, liveBody(channel), JSON.stringify(data)]);
  if (!res || !res.claimed) return null;
  await q(env, 'UPDATE youtube_live SET recipients = $2 WHERE video_id = $1', [videoId, res.recipients]);
  const pushed = await pushLive(env, { title: LIVE_TITLE, body: liveBody(channel), data: { ...data, kind: 'live' } });
  if (pushed) await q(env, 'UPDATE youtube_live SET push_sent = $2 WHERE video_id = $1', [videoId, pushed]);
  return { recipients: res.recipients, pushed };
}

/** Push to every device whose owner allows live alerts (Expo push service). Never throws; 0 when nothing to send. */
async function pushLive(env, { title, body, data }) {
  if (String(env.PUSH_DISABLED || '') === 'true') return 0;
  let sent = 0;
  try {
    const rows = await q(env, `SELECT pt.token FROM push_tokens pt JOIN users u ON u.id = pt.user_id
      WHERE NOT u.banned AND COALESCE(u.notify->>'live', 'true') <> 'false' LIMIT 20000`);
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map((r) => ({ to: r.token, sound: 'default', title, body, data, channelId: 'default' }));
      try {
        const res = await fetcher(env)('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(chunk),
        });
        const j = await res.json().catch(() => ({}));
        const tickets = Array.isArray(j.data) ? j.data : [];
        for (let k = 0; k < tickets.length; k++) {
          if (tickets[k] && tickets[k].status === 'ok') sent++;
          else if (tickets[k] && tickets[k].details && tickets[k].details.error === 'DeviceNotRegistered') {
            await q(env, 'DELETE FROM push_tokens WHERE token = $1', [chunk[k].to]).catch(() => {});
          }
        }
      } catch (e) { console.warn('[youtube live] push chunk failed', e && e.message); }
    }
  } catch (e) { console.warn('[youtube live] push failed', e && e.message); }
  return sent;
}

/**
 * One live check. trigger: 'cron' | 'admin'. force skips the 4-minute throttle.
 * Returns { skipped?, channels, checked, apiCalls, live, notified, errors[] }.
 */
export async function runYouTubeLiveCheck(env, { trigger = 'cron', force = false } = {}) {
  const out = { trigger, channels: 0, checked: 0, apiCalls: 0, live: 0, notified: 0, errors: [] };
  const log = async (extra = {}) => {
    try {
      await q(env, `INSERT INTO youtube_live_runs (trigger, channels, checked, api_calls, live, notified, skipped, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [trigger, out.channels, out.checked, out.apiCalls, out.live, out.notified, extra.skipped || null, out.errors.length ? out.errors.join(' · ').slice(0, 1000) : null]);
      await q(env, `DELETE FROM youtube_live_runs WHERE ran_at < now() - interval '14 days'`);
    } catch (e) { /* the log is best effort */ }
  };
  if (!hasApiKey(env)) { out.skipped = 'NO_API_KEY'; return out; } // nothing logged: the admin tab shows the key status
  if (!force) {
    const last = await one(env, `SELECT ran_at FROM youtube_live_runs WHERE skipped IS NULL ORDER BY ran_at DESC LIMIT 1`);
    if (last && Date.now() - new Date(last.ran_at).getTime() < MIN_GAP_MS) { out.skipped = 'TOO_SOON'; return out; }
  }

  const channels = await q(env, `SELECT channel_id, title FROM youtube_channels WHERE active ORDER BY featured DESC, sort_order, created_at LIMIT ${MAX_CHANNELS}`);
  out.channels = channels.length;
  const titles = new Map(channels.map((ch) => [ch.channel_id, ch.title]));
  const fromFeed = new Map(); // videoId → channelId
  for (const ch of channels) {
    try {
      const feed = await channelVideos(env, ch.channel_id, { cache: false });
      for (const v of feed.videos) if (VIDEO_ID_RE.test(v.videoId)) fromFeed.set(v.videoId, ch.channel_id);
    } catch (e) { out.errors.push(`RSS ${ch.title}: ${e && e.message}`); }
  }
  const tracked = await q(env, `SELECT video_id FROM youtube_live WHERE status IN ('live','upcoming')`);
  let ids = [...fromFeed.keys()];
  if (ids.length) {
    const known = await q(env, `SELECT video_id FROM youtube_seen_videos WHERE video_id = ANY($1::text[])
      UNION SELECT video_id FROM youtube_live WHERE video_id = ANY($1::text[]) AND status = 'ended'`, [ids]);
    const skip = new Set(known.map((r) => r.video_id));
    ids = ids.filter((id) => !skip.has(id));
  }
  for (const t of tracked) if (!ids.includes(t.video_id)) ids.push(t.video_id);
  out.checked = ids.length;

  const returned = new Set();
  const goneLive = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    let items;
    try { items = await videosList(env, batch); out.apiCalls++; } catch (e) { out.errors.push(e.message); out.apiCalls++; continue; }
    for (const it of items) {
      if (!it || !VIDEO_ID_RE.test(it.id || '')) continue;
      returned.add(it.id);
      const status = broadcastStatus(it);
      if (!status) { await q(env, 'INSERT INTO youtube_seen_videos (video_id) VALUES ($1) ON CONFLICT DO NOTHING', [it.id]); continue; }
      const sn = it.snippet || {};
      const d = it.liveStreamingDetails || {};
      const channelId = sn.channelId || fromFeed.get(it.id) || '';
      const thumb = (sn.thumbnails && ((sn.thumbnails.high && sn.thumbnails.high.url) || (sn.thumbnails.medium && sn.thumbnails.medium.url))) || null;
      await q(env, `INSERT INTO youtube_live (video_id, channel_id, channel_title, title, thumbnail, status, scheduled_start, actual_start, actual_end)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (video_id) DO UPDATE SET channel_title = EXCLUDED.channel_title, title = EXCLUDED.title, thumbnail = COALESCE(EXCLUDED.thumbnail, youtube_live.thumbnail),
          status = EXCLUDED.status, scheduled_start = EXCLUDED.scheduled_start, actual_start = EXCLUDED.actual_start, actual_end = EXCLUDED.actual_end, updated_at = now()`,
      [it.id, channelId, titles.get(channelId) || sn.channelTitle || null, String(sn.title || '').slice(0, 300), thumb, status,
        d.scheduledStartTime || null, d.actualStartTime || null, d.actualEndTime || null]);
      if (status === 'live') { out.live++; goneLive.push(it.id); }
    }
  }
  // tracked broadcasts YouTube no longer returns (deleted / made private) are over
  const missing = tracked.map((t) => t.video_id).filter((id) => !returned.has(id));
  if (missing.length && out.apiCalls && !out.errors.some((e) => /Data API/.test(e))) {
    await q(env, `UPDATE youtube_live SET status = 'ended', updated_at = now() WHERE video_id = ANY($1::text[]) AND status IN ('live','upcoming')`, [missing]);
  }
  for (const id of goneLive) {
    try { const r = await notifyLive(env, id); if (r) out.notified++; } catch (e) { out.errors.push(`notify ${id}: ${e && e.message}`); }
  }
  try { await q(env, `DELETE FROM youtube_seen_videos WHERE checked_at < now() - interval '120 days'`); } catch (e) { /* ignore */ }
  await log();
  return out;
}

// ---------- admin page tab (appended to /admin via registerAdminScript; no backticks or "${" inside) ----------
export const YOUTUBE_LIVE_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
function when(s){ if (!s) return '—'; var d = new Date(s); return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function chip(h, status){
  var map = { live: ['LIVE', 'background:#B83A3A;color:#fff'], upcoming: ['Upcoming', 'background:#F3E6C8;color:#6B4E12'], ended: ['Ended', ''] };
  var m = map[status] || ['Offline', ''];
  return h('span', { class: 'chip' + (m[1] ? '' : ' mut'), style: m[1], text: m[0] });
}
window.registerAdminTab('YouTube live', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'YouTube live alerts' }));
  box.appendChild(h('p', { class: 'sub', text: 'Every 15 minutes the server looks for upcoming and live broadcasts on the active channels (from the YouTube channels tab). When a broadcast goes live for the first time, everyone with live alerts on gets one “LIVE NOW” notification that opens the in-app Watch screen.' }));
  var keyBox = h('div', { class: 'card' });
  var btn = h('button', { class: 'btn', text: 'Check now' });
  var status = h('span', { class: 'meta' });
  box.appendChild(keyBox);
  box.appendChild(h('div', { class: 'row', style: 'margin:12px 0' }, [btn, status]));
  var chans = h('div'); var dets = h('div'); var runs = h('div');
  box.appendChild(h('h3', { class: 'serif', text: 'Channels' })); box.appendChild(chans);
  box.appendChild(h('h3', { class: 'serif', text: 'Detected broadcasts & notifications' })); box.appendChild(dets);
  box.appendChild(h('h3', { class: 'serif', text: 'Recent checks' })); box.appendChild(runs);
  btn.onclick = async function(){
    btn.disabled = true; status.textContent = 'Checking…';
    try {
      var r = await api('POST', '/admin/api/youtube/live/check', {});
      if (r.skipped === 'NO_API_KEY') { status.textContent = 'Add a YouTube API key to enable live alerts.'; }
      else { status.textContent = 'Checked ' + r.checked + ' video(s) on ' + r.channels + ' channel(s) · ' + r.apiCalls + ' API call(s) · live now: ' + r.live + ' · notified: ' + r.notified + (r.errors && r.errors.length ? ' · problems: ' + r.errors.join('; ') : ''); toast('Check finished'); }
      load();
    } catch (e) { status.textContent = ''; toast(e.message, true); }
    btn.disabled = false;
  };
  async function load(){
    var d; try { d = await api('GET', '/admin/api/youtube/live'); } catch (e) { keyBox.textContent = e.message; return; }
    keyBox.innerHTML = '';
    if (d.apiKey) keyBox.appendChild(h('div', {}, [h('span', { class: 'chip gold', text: 'API key set' }), ' Live detection is on. Quota: about ' + d.quota.perRun + ' unit(s) per check, ~' + d.quota.perDay + ' a day of the 10,000 free daily units.']));
    else keyBox.appendChild(h('div', {}, [h('b', { text: 'Add a YouTube API key to enable live alerts. ' }), 'Create a key for “YouTube Data API v3” in Google Cloud Console, then run ', h('code', { text: 'npx wrangler secret put YOUTUBE_API_KEY' }), ' in the backend folder. Until then, channels still show in the app but nobody is alerted.']));
    chans.innerHTML = '';
    if (!d.channels.length) chans.appendChild(h('div', { class: 'card empty', text: 'No active channels — add them in the YouTube channels tab.' }));
    d.channels.forEach(function(ch){
      chans.appendChild(h('div', { class: 'card row' }, [
        ch.avatarUrl ? h('img', { class: 'avatar', src: ch.avatarUrl, alt: '' }) : h('div', { class: 'avatar' }),
        h('div', { class: 'grow' }, [h('b', { text: ch.title }), h('div', { class: 'meta', text: ch.live ? (ch.live.title || '') + ' · since ' + when(ch.live.actualStart || ch.live.scheduledStart) : 'Last broadcast: ' + (ch.lastBroadcastAt ? when(ch.lastBroadcastAt) : 'none seen yet') })]),
        chip(h, ch.live ? ch.live.status : null),
      ]));
    });
    dets.innerHTML = '';
    if (!d.detections.length) dets.appendChild(h('div', { class: 'card empty', text: 'No broadcasts detected yet.' }));
    d.detections.forEach(function(x){
      dets.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [chip(h, x.status), h('b', { class: 'grow', text: x.title || x.videoId }), h('a', { href: x.watchUrl, target: '_blank', rel: 'noopener', text: 'Open on YouTube' })]),
        h('div', { class: 'meta', style: 'margin-top:6px', text: (x.channelTitle || x.channelId) + ' · detected ' + when(x.detectedAt) + (x.scheduledStart ? ' · scheduled ' + when(x.scheduledStart) : '') + (x.actualStart ? ' · started ' + when(x.actualStart) : '') + (x.actualEnd ? ' · ended ' + when(x.actualEnd) : '') }),
        h('div', { class: 'meta', text: x.notifiedAt ? 'Notified ' + when(x.notifiedAt) + ' · ' + x.recipients + ' recipient(s)' + (x.pushSent ? ' · ' + x.pushSent + ' push' : '') : 'Not notified' + (x.status === 'upcoming' ? ' yet (goes out when it starts)' : '') }),
      ]));
    });
    runs.innerHTML = '';
    if (!d.runs.length) runs.appendChild(h('div', { class: 'meta', text: 'No checks yet.' }));
    d.runs.forEach(function(r){
      runs.appendChild(h('div', { class: 'meta', style: 'padding:4px 0;border-top:1px solid var(--border)', text: when(r.ranAt) + ' · ' + r.trigger + ' · ' + r.channels + ' channel(s), ' + r.checked + ' video(s), ' + r.apiCalls + ' API call(s), ' + r.live + ' live, ' + r.notified + ' notified' + (r.error ? ' · ' + r.error : '') }));
    });
  }
  load();
});
})();
`;
