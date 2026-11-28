// POST FROM A LINK (dev update v1): YouTube / Facebook links become video posts that play the provider's own embed.
// Covers the URL allow-list, embed validation, post creation, the feed and Reels payloads, and play counting.
// Nothing is downloaded or re-hosted; the oEmbed lookup is faked so the suite never touches the network. Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';
import { parseEmbedUrl, buildEmbed } from '../src/lib/postEmbeds.js';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true' };
  // oEmbed stand-in: YouTube answers with a title and channel; anything else fails (no network in tests)
  env.__fetch = async (url) => {
    if (String(url).startsWith('https://www.youtube.com/oembed?')) {
      return new Response(JSON.stringify({ title: 'Psalm 23 <sung>', author_name: 'Choir Room' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('network is disabled in tests');
  };
});

async function call(user, method, path, body) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${path}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}

test('parseEmbedUrl accepts every supported YouTube and Facebook video form', () => {
  const yt = 'dQw4w9WgXcQ';
  const cases = [
    [`https://www.youtube.com/watch?v=${yt}`, 'youtube', `https://www.youtube.com/watch?v=${yt}`],
    [`https://youtube.com/watch?v=${yt}&t=42`, 'youtube', `https://www.youtube.com/watch?v=${yt}`],
    [`https://m.youtube.com/watch?v=${yt}`, 'youtube', `https://www.youtube.com/watch?v=${yt}`],
    [`https://youtu.be/${yt}?si=abc`, 'youtube', `https://www.youtube.com/watch?v=${yt}`],
    [`https://www.youtube.com/shorts/${yt}`, 'youtube', `https://www.youtube.com/watch?v=${yt}`],
    ['https://www.facebook.com/SomeChurch/videos/1234567890123/', 'facebook', 'https://www.facebook.com/SomeChurch/videos/1234567890123/'],
    ['https://www.facebook.com/SomeChurch/videos/sermon-title/1234567890123', 'facebook', 'https://www.facebook.com/SomeChurch/videos/sermon-title/1234567890123/'],
    ['https://fb.watch/abcDEF_12/', 'facebook', 'https://fb.watch/abcDEF_12/'],
    ['https://www.facebook.com/watch/?v=9876543210', 'facebook', 'https://www.facebook.com/watch/?v=9876543210'],
    ['https://www.facebook.com/watch?v=9876543210', 'facebook', 'https://www.facebook.com/watch/?v=9876543210'],
    ['https://www.facebook.com/reel/5551234567', 'facebook', 'https://www.facebook.com/reel/5551234567/'],
    ['  https://m.facebook.com/reel/5551234567  ', 'facebook', 'https://www.facebook.com/reel/5551234567/'],
  ];
  for (const [raw, provider, url] of cases) {
    const p = parseEmbedUrl(raw);
    assert.ok(p, `should accept ${raw}`);
    assert.equal(p.provider, provider, raw);
    assert.equal(p.url, url, raw);
  }
});

test('parseEmbedUrl rejects other hosts, other paths, bad ids and script or data URLs', () => {
  const bad = [
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'https://vimeo.com/123456789',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil-youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC1234567890123456789012',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ/../../x',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'https://www.facebook.com/groups/123/permalink/456',
    'https://www.facebook.com/SomeChurch/posts/1234567890123',
    'https://www.facebook.com/watch/?v=abc',
    'https://facebook.com.attacker.example/reel/5551234567',
    'https://fb.watch/',
    'not a url',
    '',
    null,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ <img src=x onerror=alert(1)>',
  ];
  for (const raw of bad) assert.equal(parseEmbedUrl(raw), null, `should reject ${String(raw)}`);
  assert.equal(parseEmbedUrl('x'.repeat(600)), null);
});

test('buildEmbed: YouTube metadata comes from the server, the id from the URL, the thumbnail from a fixed host', async () => {
  const e = await buildEmbed(env, { provider: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'ignored', videoId: 'evil', thumbnailUrl: 'https://evil.example/x.png' });
  assert.deepEqual(Object.keys(e).sort(), ['authorName', 'provider', 'thumbnailUrl', 'title', 'url', 'videoId']);
  assert.equal(e.provider, 'youtube');
  assert.equal(e.videoId, 'dQw4w9WgXcQ');
  assert.equal(e.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(e.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(e.title, 'Psalm 23 <sung>');
  assert.equal(e.authorName, 'Choir Room');
});

test('buildEmbed: a failed YouTube lookup still gives a playable card', async () => {
  const e = await buildEmbed({ __fetch: async () => { throw new Error('down'); } }, { url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.equal(e.title, null);
  assert.equal(e.authorName, null);
  assert.equal(e.videoId, 'abcdefghijk');
});

test('buildEmbed: Facebook keeps the URL and the optional title, no thumbnail', async () => {
  const e = await buildEmbed(env, { provider: 'facebook', url: 'https://fb.watch/abcDEF_12/', title: '  Morning\u0007 teaching  ' });
  assert.deepEqual(e, { provider: 'facebook', url: 'https://fb.watch/abcDEF_12/', videoId: 'abcDEF_12', thumbnailUrl: null, title: 'Morning teaching', authorName: null });
});

test('buildEmbed rejects a provider that does not match the link, and non-allow-listed input', async () => {
  await assert.rejects(buildEmbed(env, { provider: 'facebook', url: 'https://youtu.be/dQw4w9WgXcQ' }), (err) => err.code === 'BAD_EMBED');
  await assert.rejects(buildEmbed(env, { url: 'javascript:alert(1)' }), (err) => err.code === 'BAD_EMBED');
  await assert.rejects(buildEmbed(env, 'https://youtu.be/dQw4w9WgXcQ'), (err) => err.code === 'BAD_EMBED');
});

let postId;
test('POST /posts with an embed creates a video post that plays the provider embed', async () => {
  const r = await call('alice', 'POST', '/posts', { kind: 'Video', text: 'Sunday sermon', embed: { provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
  assert.equal(r.status, 201);
  postId = r.json.id;
  assert.equal(r.json.embed.provider, 'youtube');
  assert.equal(r.json.embed.videoId, 'dQw4w9WgXcQ');
  assert.equal(r.json.embed.title, 'Psalm 23 <sung>');
  assert.equal(r.json.video, null, 'an embed is not an uploaded video');
  assert.equal(r.json.design, null, 'no text card for an embed');
  const got = await call('alice', 'GET', `/posts/${postId}`);
  assert.equal(got.json.embed.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('POST /posts with an embed and no caption is allowed; with a bad or mixed embed it is refused', async () => {
  assert.equal((await call('alice', 'POST', '/posts', { kind: 'Video', embed: { url: 'https://fb.watch/abcDEF_12/' } })).status, 201);
  const js = await call('alice', 'POST', '/posts', { text: 'x', embed: { url: 'javascript:alert(1)' } });
  assert.equal(js.status, 400);
  assert.equal(js.json.code, 'BAD_EMBED');
  const mixed = await call('alice', 'POST', '/posts', { text: 'x', images: [{ key: 'img/alice/a.jpg' }], embed: { url: 'https://fb.watch/abcDEF_12/' } });
  assert.equal(mixed.status, 400);
  assert.equal(mixed.json.code, 'BAD_EMBED');
});

test('the feed payload carries the embed; Reels include it; video plays count through the play counter', async () => {
  const feed = await call('alice', 'GET', '/feed?filter=following&limit=50');
  const mine = feed.json.items.find((p) => p.id === postId);
  assert.ok(mine, 'the embed post is in the feed');
  assert.equal(mine.embed.provider, 'youtube');
  assert.equal(mine.video, null);

  const reels = await call('alice', 'GET', '/videos?order=newest&limit=30');
  assert.ok(reels.json.items.some((p) => p.id === postId), 'the embed post is in the Reels list');
  const plain = await call('alice', 'GET', '/feed?filter=following&limit=50');
  assert.ok(plain.json.items.every((p) => p.embed == null || p.embed.provider), 'every embed has a provider');

  const play = await call('bob', 'POST', `/posts/${postId}/video-view`, { watchedMs: 3000 });
  assert.equal(play.status, 200);
  assert.equal(play.json.counted, true);
  assert.equal(play.json.plays, 1);
});

test('GET /posts/embed-preview validates the link and returns the card; bad links are refused', async () => {
  const ok = await call('bob', 'GET', `/posts/embed-preview?url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.provider, 'youtube');
  assert.equal(ok.json.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  const no = await call('bob', 'GET', `/posts/embed-preview?url=${encodeURIComponent('https://vimeo.com/1')}`);
  assert.equal(no.status, 400);
  assert.equal(no.json.code, 'BAD_EMBED');
});
