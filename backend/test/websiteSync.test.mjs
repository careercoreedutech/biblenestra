// MEMBER WEBSITE INTEGRATION: feed parsing (RSS 2.0 + Atom), dedupe, HTML → paragraphs, ad placement,
// WordPress REST publish (stubbed fetch), application-password encryption, and the cron entry point's guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeed, filterNewItems, htmlToBody, interleaveAds, bodyParagraphs, basicAuth, wpBase,
  detectWordPress, publishToWordPress, bodyToWordPressHtml, fetchWordPressPosts, verifyWordPressLogin,
} from '../src/lib/websiteSync.js';
import { encryptField, decryptField } from '../src/lib/fundmeMoney.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Example Ministry</title>
  <item>
    <title><![CDATA[Grace &amp; Peace]]></title>
    <link>https://example.org/grace-peace/</link>
    <guid isPermaLink="false">post-101</guid>
    <pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate>
    <description>Short summary of the post.</description>
    <content:encoded><![CDATA[<h2>First heading</h2><p>Paragraph one &amp; more.</p><p>Paragraph two.</p>]]></content:encoded>
    <enclosure url="https://example.org/cover.jpg" type="image/jpeg" length="10" />
  </item>
  <item>
    <title>No link here</title>
    <guid>post-102</guid>
  </item>
  <item>
    <title>Insecure link</title>
    <link>http://example.org/old/</link>
    <guid>post-103</guid>
  </item>
  <item>
    <title>Second post</title>
    <link>https://example.org/second/</link>
    <description>Second summary</description>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom blog</title>
  <entry>
    <id>tag:example.com,2026:entry-7</id>
    <title type="html">Atom &lt;em&gt;entry&lt;/em&gt;</title>
    <link rel="edit" href="https://example.com/edit/7"/>
    <link rel="alternate" href="https://example.com/posts/7"/>
    <published>2026-11-12T09:30:00Z</published>
    <summary>An Atom summary.</summary>
    <content type="html">&lt;p&gt;Atom body text.&lt;/p&gt;</content>
  </entry>
</feed>`;

function stubFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    return handler(String(url), init);
  };
  return { env: { __fetch: fn }, calls };
}
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- feed parsing ----------
test('RSS 2.0: reads guid, link, title, excerpt, content and picture; drops items without a secure link', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2, 'the item without a link and the http-only item are skipped');
  const [first, second] = items;
  assert.equal(first.key, 'post-101');
  assert.equal(first.link, 'https://example.org/grace-peace/');
  assert.equal(first.title, 'Grace & Peace');
  assert.equal(first.image, 'https://example.org/cover.jpg');
  assert.equal(first.publishedAt, '2026-11-10T08:00:00.000Z');
  assert.match(first.html, /Paragraph one/);
  assert.equal(second.key, 'https://example.org/second/', 'without a guid the link is the dedupe key');
  assert.equal(second.excerpt, 'Second summary');
});

test('Atom: uses the alternate link (not the edit link), id as key, decodes escaped HTML titles', () => {
  const [entry] = parseFeed(ATOM);
  assert.equal(entry.link, 'https://example.com/posts/7');
  assert.equal(entry.key, 'tag:example.com,2026:entry-7');
  assert.equal(entry.title, 'Atom entry');
  assert.equal(entry.publishedAt, '2026-11-12T09:30:00.000Z');
  assert.equal(htmlToBody(entry.html), 'Atom body text.');
});

test('a page that is not a feed is rejected with a readable message', () => {
  assert.throws(() => parseFeed('<!doctype html><html><body>Hello</body></html>'), /not an RSS or Atom feed/);
});

// ---------- dedupe ----------
test('dedupe: items already stored are skipped, and a repeat inside one batch is kept once', () => {
  const batch = [
    { key: 'a' }, { key: 'b' }, { key: 'a' }, { key: 'c' }, null, { key: '' },
  ];
  const fresh = filterNewItems(batch, ['b']);
  assert.deepEqual(fresh.map((x) => x.key), ['a', 'c']);
  assert.deepEqual(filterNewItems([{ key: 'x' }], []).map((x) => x.key), ['x']);
  assert.deepEqual(filterNewItems([{ key: 'x' }], undefined).map((x) => x.key), ['x']);
});

// ---------- HTML → paragraphs ----------
test('htmlToBody: paragraphs and headings, lists, entities; scripts and tags removed', () => {
  const body = htmlToBody('<style>p{}</style><h2>Intro</h2><p>Hello&nbsp;<b>there</b> &amp; welcome.</p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul><p>End</p>');
  const paras = bodyParagraphs(body);
  assert.equal(paras[0], '## Intro');
  assert.equal(paras[1], 'Hello there & welcome.');
  assert.ok(!/script|alert|<|>/.test(body), 'no markup survives');
  assert.ok(paras.includes('• One') && paras.includes('• Two'));
  assert.equal(paras[paras.length - 1], 'End');
});

// ---------- ad placement (brief 20) ----------
test('ads: after every N paragraphs, never after a heading, never at the very end, never more than the limit', () => {
  const paras = ['p1', 'p2', 'p3', '## Section', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
  const blocks = interleaveAds(paras, { every: 3, max: 2 });
  const kinds = blocks.map((b) => (b.type === 'ad' ? 'AD' : b.text));
  assert.deepEqual(kinds, ['p1', 'p2', 'p3', 'AD', 'Section', 'p4', 'p5', 'p6', 'AD', 'p7', 'p8', 'p9', 'p10']);
  // The ad never sits between a heading and its first paragraph, and nothing follows the final paragraph.
  assert.equal(blocks[blocks.length - 1].type, 'text');
  const ads = blocks.filter((b) => b.type === 'ad');
  assert.equal(ads.length, 2);
  assert.deepEqual(ads.map((a) => a.slot), [1, 2]);
});

test('ads: zero limit gives no ads; short articles get none at the end', () => {
  assert.equal(interleaveAds(['a', 'b', 'c', 'd', 'e', 'f'], { every: 2, max: 0 }).filter((b) => b.type === 'ad').length, 0);
  const short = interleaveAds(['a', 'b', 'c'], { every: 3, max: 4 });
  assert.equal(short.filter((b) => b.type === 'ad').length, 0, 'an ad after the last paragraph is never shown');
});

test('ads never split a paragraph: every block is a whole paragraph or an ad', () => {
  const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} is one whole block.`);
  for (const b of interleaveAds(paras, { every: 2, max: 5 })) {
    if (b.type !== 'ad') assert.ok(paras.includes(b.text));
  }
});

// ---------- WordPress REST (stubbed fetch) ----------
test('WordPress publish: Basic auth with the user and application password, posts to /wp-json/wp/v2/posts', async () => {
  const env = {};
  const enc = await encryptField(env, 'abcd efgh ijkl mnop');
  const { env: stub, calls } = stubFetch(async (url) => {
    assert.equal(url, 'https://example.org/wp-json/wp/v2/posts');
    return json(201, { id: 42, link: 'https://example.org/?p=42' });
  });
  const out = await publishToWordPress({ ...stub }, {
    site_url: 'https://example.org/', wp_username: 'editor', wp_password_enc: enc,
  }, { title: 'Hello', body: '## Heading\n\nFirst paragraph & more.', excerpt: 'Short' });
  assert.deepEqual(out, { externalId: '42', externalUrl: 'https://example.org/?p=42' });
  const call = calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.Authorization, basicAuth('editor', 'abcd efgh ijkl mnop'));
  assert.equal(call.headers.Authorization, `Basic ${Buffer.from('editor:abcd efgh ijkl mnop').toString('base64')}`);
  const sent = JSON.parse(call.body);
  assert.equal(sent.title, 'Hello');
  assert.equal(sent.status, 'publish');
  assert.equal(sent.content, '<h2>Heading</h2>\n<p>First paragraph &amp; more.</p>');
  assert.equal(sent.excerpt, 'Short');
});

test('WordPress publish: a rejected application password gives a clear message and never leaks the password', async () => {
  const env = {};
  const enc = await encryptField(env, 'secret-app-pw');
  const { env: stub } = stubFetch(async () => json(401, { code: 'rest_cannot_create', message: 'Sorry, you are not allowed to do that.' }));
  await assert.rejects(
    () => publishToWordPress({ ...stub }, { site_url: 'https://example.org', wp_username: 'editor', wp_password_enc: enc }, { title: 't', body: 'b' }),
    (err) => {
      assert.match(err.message, /rejected the saved application password/);
      assert.ok(!err.message.includes('secret-app-pw'));
      return true;
    },
  );
});

test('WordPress publish needs stored credentials before it contacts the site', async () => {
  const { env: stub, calls } = stubFetch(async () => json(201, {}));
  await assert.rejects(() => publishToWordPress({ ...stub }, { site_url: 'https://example.org' }, { title: 't', body: 'b' }), /application password/);
  assert.equal(calls.length, 0);
});

test('WordPress: REST base, HTML body, detection and post import use the stubbed site', async () => {
  assert.equal(wpBase('https://example.org/blog/'), 'https://example.org/wp-json/wp/v2');
  assert.equal(bodyToWordPressHtml('a <b>'), '<p>a &lt;b&gt;</p>');
  const ok = stubFetch(async () => json(200, [{ id: 7, link: 'https://example.org/seven/', title: { rendered: 'Seven &amp; more' }, content: { rendered: '<p>Body</p>' }, excerpt: { rendered: '<p>Ex</p>' }, date_gmt: '2026-11-01T10:00:00' }]));
  assert.equal(await detectWordPress({ ...ok.env }, 'https://example.org'), true);
  const posts = await fetchWordPressPosts({ ...ok.env }, 'https://example.org');
  assert.equal(posts[0].key, 'wp:7');
  assert.equal(posts[0].title, 'Seven & more');
  assert.equal(posts[0].publishedAt, '2026-11-01T10:00:00.000Z');
  const html = stubFetch(async () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  assert.equal(await detectWordPress({ ...html.env }, 'https://example.org'), false, 'a normal web page is not WordPress');
  const denied = stubFetch(async () => json(401, {}));
  await assert.rejects(() => verifyWordPressLogin({ ...denied.env }, 'https://example.org', 'editor', 'nope'), /did not accept/);
});

// ---------- application-password encryption (Fund Me AES-GCM helper) ----------
test('encryption: round-trips, uses a fresh IV each time, and rejects tampered text', async () => {
  const env = { FUNDME_DATA_KEY: 'test-key-for-websites' };
  const a = await encryptField(env, 'my app password');
  const b = await encryptField(env, 'my app password');
  assert.notEqual(a, b, 'a fresh IV makes each ciphertext different');
  assert.match(a, /^v1:/);
  assert.equal(await decryptField(env, a), 'my app password');
  const [v, iv, ct] = a.split(':');
  const flipped = `${v}:${iv}:${ct.slice(0, -2)}${ct.slice(-2) === 'AA' ? 'BB' : 'AA'}`;
  await assert.rejects(() => decryptField(env, flipped));
  await assert.rejects(() => decryptField(env, 'plain text'), /bad ciphertext/);
});
