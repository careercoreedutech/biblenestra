// BLOG — public HTML pages (/blog list, /blog/<slug> article). Server-rendered, no JavaScript, mobile first,
// in the app's warm brand (cream / gold, serif headings). Every value is escaped; article bodies go through
// lib/blog.js renderMarkdown (which escapes all text too).
import { esc, renderMarkdown } from './blog.js';

const PACKAGE = 'com.biblenestra.app';
export const playUrl = (env) => (env && env.PLAY_STORE_URL) || `https://play.google.com/store/apps/details?id=${PACKAGE}`;

const CSS = `
:root{--bg:#F6F2EA;--card:#fff;--raised:#F0EBE1;--border:#E7DFD1;--fg:#1C1915;--muted:#6B6255;--faint:#8F8578;--gold:#A87A27;--goldSoft:#F5EBD7;--primary:#2E3A87;--night:#15172B;--nightFg:#F4EFE6}
@media (prefers-color-scheme:dark){:root{--bg:#14131A;--card:#1D1C24;--raised:#26252E;--border:#34323C;--fg:#F1ECE2;--muted:#B5AC9E;--faint:#8F877B;--gold:#E2BC6A;--goldSoft:#3A3122;--primary:#9DA8F0;--night:#0E0F1A;--nightFg:#F4EFE6}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--primary)}
.serif,h1,h2,h3,h4{font-family:Newsreader,"Iowan Old Style",Georgia,"Times New Roman",serif;font-weight:600;letter-spacing:-.3px;line-height:1.2}
.top{background:var(--night);color:var(--nightFg)}
.top .in{max-width:760px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;gap:12px}
.brand{color:var(--nightFg);text-decoration:none;font-family:Newsreader,Georgia,serif;font-size:21px;font-weight:600}
.brand b{color:#D4A852;font-weight:600}
.top .open{margin-left:auto;background:#D4A852;color:#15172B;text-decoration:none;font-weight:700;font-size:13.5px;padding:8px 14px;border-radius:999px;white-space:nowrap}
main{max-width:760px;margin:0 auto;padding:20px 16px 40px}
.eyebrow{font-size:11.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--gold)}
.hero h1{font-size:32px;margin:4px 0 6px}.hero p{color:var(--muted);margin:0 0 16px}
.chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin:0 0 18px;scrollbar-width:none}
.chip{flex:none;display:inline-block;padding:7px 14px;border-radius:999px;background:var(--card);border:1px solid var(--border);color:var(--fg);text-decoration:none;font-size:14px;font-weight:600}
.chip.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.card{display:block;background:var(--card);border:1px solid var(--border);border-radius:20px;overflow:hidden;text-decoration:none;color:inherit;margin-bottom:16px;box-shadow:0 1px 2px rgba(59,47,30,.06)}
.card img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--raised)}
.card .b{padding:14px 16px 16px}.card h2{font-size:22px;margin:6px 0}.card p{color:var(--muted);margin:0 0 10px;font-size:15.5px}
.meta{color:var(--faint);font-size:13.5px}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:8px}
.btn{display:inline-block;padding:11px 18px;border-radius:999px;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;font-size:15px}
.btn.ghost{background:transparent;color:var(--primary);border:1.5px solid var(--primary)}
.empty{text-align:center;color:var(--muted);padding:50px 10px}
article h1{font-size:34px;margin:6px 0 10px}
article .lead{font-size:19px;color:var(--muted);margin:0 0 14px}
article .cover{width:100%;border-radius:20px;margin:6px 0 18px;aspect-ratio:16/9;object-fit:cover;background:var(--raised)}
.body h2{font-size:25px;margin:28px 0 8px}.body h3{font-size:21px;margin:24px 0 6px}.body h4{font-size:18px;margin:20px 0 6px}
.body p{margin:0 0 16px}.body ul,.body ol{padding-left:22px;margin:0 0 16px}.body li{margin:4px 0}
.body blockquote{margin:20px 0;padding:14px 18px;background:var(--goldSoft);border-left:4px solid var(--gold);border-radius:4px 16px 16px 4px;font-family:Newsreader,Georgia,serif;font-size:19px}
.body blockquote p{margin:0}.body blockquote cite{display:block;margin-top:6px;font-style:normal;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;color:var(--muted)}
.body hr{border:0;border-top:1px solid var(--border);margin:26px 0}
.note{font-size:13.5px;color:var(--muted);border-top:1px solid var(--border);margin-top:26px;padding-top:12px;font-style:italic}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0 0}.tags span{font-size:12.5px;background:var(--raised);color:var(--muted);padding:4px 10px;border-radius:999px}
.cta{background:var(--night);color:var(--nightFg);border-radius:22px;padding:20px;margin:30px 0 10px;text-align:center}
.cta h3{margin:0 0 6px;font-size:22px}.cta p{margin:0 0 14px;color:rgba(244,239,230,.75);font-size:15px}
.cta .btn{background:#D4A852;color:#15172B;margin:4px}
.cta .btn.ghost{background:transparent;color:var(--nightFg);border-color:rgba(244,239,230,.4)}
.more h3{font-size:20px;margin:28px 0 12px}
.mini{display:flex;gap:12px;align-items:center;text-decoration:none;color:inherit;padding:10px 0;border-top:1px solid var(--border)}
.mini img{width:72px;height:54px;border-radius:10px;object-fit:cover;flex:none;background:var(--raised)}.mini b{font-family:Newsreader,Georgia,serif;font-size:17px;font-weight:600}
footer{max-width:760px;margin:0 auto;padding:10px 16px 40px;color:var(--faint);font-size:13px;text-align:center}
@media (min-width:700px){.hero h1{font-size:40px}article h1{font-size:42px}}
`;

const fmtDate = (d) => {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return ''; }
};

function layout({ title, description, canonical, image, type = 'website', body, deep, env, inApp }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#15172B">
<meta property="og:site_name" content="BibleNestra">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<style>${CSS}</style></head><body>
<header class="top"><div class="in"><a class="brand" href="/blog">Bible<b>Nestra</b> Blog</a>${inApp ? '' : `<a class="open" href="${esc(deep)}">Open in BibleNestra</a>`}</div></header>
<main>${body}</main>
<footer>© ${new Date().getUTCFullYear()} BibleNestra${inApp ? '' : ` · <a href="${esc(playUrl(env))}">Get the app</a>`}</footer>
</body></html>`;
}

function cta(env, deep) {
  return `<div class="cta"><h3>Keep growing with BibleNestra</h3><p>Read the Bible, pray with others and follow courses &amp; devotionals in the app.</p>
<a class="btn" href="${esc(deep)}">Open in BibleNestra</a><a class="btn ghost" href="${esc(playUrl(env))}">Get it on Google Play</a></div>`;
}

/** /blog list page. posts = shaped posts (full: false). */
export function listPage({ env, base, posts, topics, topic, page, hasMore, inApp }) {
  const q = (t, p) => {
    const parts = [];
    if (t) parts.push(`topic=${encodeURIComponent(t)}`);
    if (p > 1) parts.push(`page=${p}`);
    if (inApp) parts.push('app=1');
    return `/blog${parts.length ? `?${parts.join('&')}` : ''}`;
  };
  const chips = topics.length ? `<nav class="chips"><a class="chip${topic ? '' : ' on'}" href="${esc(q(null, 1))}">All</a>${topics.map((t) => `<a class="chip${t === topic ? ' on' : ''}" href="${esc(q(t, 1))}">${esc(t)}</a>`).join('')}</nav>` : '';
  const cards = posts.map((p) => `<a class="card" href="${esc(`/blog/${p.slug}${inApp ? '?app=1' : ''}`)}">${p.coverUrl ? `<img src="${esc(p.coverUrl)}" alt="" loading="lazy">` : ''}<div class="b">
<div class="eyebrow">${esc(p.topic || 'Article')}</div><h2>${esc(p.title)}</h2>${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
<div class="meta">${esc(fmtDate(p.publishedAt))} · ${p.readingMinutes} min read</div></div></a>`).join('\n');
  const pager = page > 1 || hasMore ? `<div class="pager">${page > 1 ? `<a class="btn ghost" href="${esc(q(topic, page - 1))}">← Newer</a>` : '<span></span>'}${hasMore ? `<a class="btn ghost" href="${esc(q(topic, page + 1))}">Older →</a>` : ''}</div>` : '';
  const body = `<section class="hero"><div class="eyebrow">BibleNestra Blog</div><h1>${topic ? esc(topic) : 'Grow in the Word'}</h1>
<p>Bible teaching, devotionals and encouragement for everyday faith.</p></section>${chips}
${cards || `<div class="empty">${topic ? 'No articles on this topic yet.' : 'No articles yet — check back soon.'}</div>`}${pager}`;
  return layout({
    env, inApp, body, deep: 'biblenestra://',
    title: topic ? `${topic} · BibleNestra Blog` : 'BibleNestra Blog — Bible teaching & devotionals',
    description: 'Bible teaching, devotionals and encouragement for everyday faith from BibleNestra.',
    canonical: `${base}${q(topic, page).replace(/[?&]app=1/, '')}`,
  });
}

/** /blog/<slug> article page. */
export function articlePage({ env, base, post, related = [], disclaimer = null, inApp }) {
  const deep = `biblenestra://blog/${post.slug}`;
  const body = `<article>
<div class="eyebrow">${esc(post.topic || 'Article')}</div>
<h1>${esc(post.title)}</h1>
${post.excerpt ? `<p class="lead">${esc(post.excerpt)}</p>` : ''}
<div class="meta">By ${esc(post.author)} · ${esc(fmtDate(post.publishedAt))} · ${post.readingMinutes} min read</div>
${post.coverUrl ? `<img class="cover" src="${esc(post.coverUrl)}" alt="">` : '<div style="height:12px"></div>'}
<div class="body">${renderMarkdown(post.body)}</div>
${disclaimer ? `<p class="note">${esc(disclaimer)}</p>` : ''}
${post.tags.length ? `<div class="tags">${post.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
</article>
${inApp ? '' : cta(env, deep)}
${related.length ? `<section class="more"><h3>Keep reading</h3>${related.map((r) => `<a class="mini" href="${esc(`/blog/${r.slug}${inApp ? '?app=1' : ''}`)}">${r.coverUrl ? `<img src="${esc(r.coverUrl)}" alt="" loading="lazy">` : ''}<div><b>${esc(r.title)}</b><div class="meta">${esc(r.topic || '')}${r.topic ? ' · ' : ''}${r.readingMinutes} min read</div></div></a>`).join('')}</section>` : ''}
<p style="margin-top:24px"><a href="${inApp ? '/blog?app=1' : '/blog'}">← All articles</a></p>`;
  return layout({
    env, inApp, body, deep, type: 'article',
    title: `${post.title} · BibleNestra`,
    description: post.seoDescription || post.excerpt || post.title,
    canonical: `${base}/blog/${post.slug}`,
    image: post.coverUrl,
  });
}

export function notFoundPage({ env, base }) {
  return layout({
    env, deep: 'biblenestra://', title: 'Article not found · BibleNestra', description: 'This article doesn’t exist or isn’t published yet.', canonical: `${base}/blog`,
    body: '<div class="empty"><h1 class="serif">Article not found</h1><p>It may have moved or isn’t published yet.</p><a class="btn" href="/blog">See all articles</a></div>',
  });
}
