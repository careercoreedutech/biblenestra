// MEMBER WEBSITES: helpers for the routes in ../routes/websites.js
//   normalizeWebsiteUrl(input)  → { url, host } or throws a readable error (https only, public hostnames only)
//   fetchSiteMeta(env, url)     → { title, description, image, icon } from the page's <title>/<meta> (best effort)
//   WEBSITES_ADMIN_SCRIPT       → the "Member websites" tab of the admin dashboard
import { bad } from './http.js';

const fetcher = (env) => (env && env.__fetch) || fetch;
export const MAX_SITES_PER_USER = 3;

// Feature flag `website_feed.public_submission` (default OFF): while off, only platform admins add / edit
// websites (they publish straight away) and the app hides every member submission option. Turning it on is a
// config change — set the Worker var WEBSITE_FEED_PUBLIC_SUBMISSION=true — which restores member submission
// with admin approval (status 'pending' → 'approved'), plus the app reads the flag from GET /me.
export function websitePublicSubmission(env) {
  return String((env && env.WEBSITE_FEED_PUBLIC_SUBMISSION) || '').trim().toLowerCase() === 'true';
}
export const WEBSITE_CATEGORIES = ['Ministry', 'Church', 'Blog', 'Business', 'Education', 'Media', 'Charity', 'Other'];

// Hostnames we never accept: local / private addresses, raw IPs, and app-internal hosts.
const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost|.*\.test|.*\.example|.*\.invalid)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Cleans a pasted website address. Adds https:// when missing; refuses http-only, IPs, local names and odd ports. */
export function normalizeWebsiteUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw bad('Enter your website address', 'BAD_URL');
  if (s.length > 500) throw bad('That address is too long', 'BAD_URL');
  if (/^http:\/\//i.test(s)) throw bad('Your website needs a secure address (https://). Most hosts give one for free.', 'NOT_HTTPS');
  if (!/^https:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[a-z0-9.-]+:\d+/i.test(s)) throw bad('Enter a normal website address, like https://example.org', 'BAD_URL');
    s = `https://${s.replace(/^\/+/, '')}`;
  }
  let u;
  try { u = new URL(s); } catch (e) { throw bad('That doesn’t look like a website address', 'BAD_URL'); }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.username || u.password) throw bad('Remove the user name or password from the address', 'BAD_URL');
  if (u.port && u.port !== '443') throw bad('Use the normal website address without a port number', 'BAD_URL');
  if (!host.includes('.') || IPV4.test(host) || host.includes(':') || host.startsWith('[') || BLOCKED_HOST.test(host)) {
    throw bad('Enter a public website address, like https://example.org', 'BAD_URL');
  }
  if (!/^[a-z0-9.-]+$/.test(host) && !/^xn--/.test(host)) throw bad('That address has characters we can’t use', 'BAD_URL');
  u.hash = '';
  return { url: u.toString(), host: host.replace(/^www\./, '') };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z0-9#]+);/gi, (m, n) => (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m))
  .replace(/\s+/g, ' ')
  .trim();

function metaContent(html, names) {
  for (const name of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
    // some sites write it as an attribute of its own: <meta og:image="https://…">
    const re3 = new RegExp(`<meta[^>]*\\s${name}=["']([^"']+)["']`, 'i');
    const m = html.match(re1) || html.match(re2) || html.match(re3);
    if (m && m[1].trim()) return decode(m[1]);
  }
  return null;
}

function absolute(base, href) {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === 'https:' ? u.toString() : null; // the app only loads secure images
  } catch (e) { return null; }
}

/** Reads the website's name, description, picture and icon. Never throws; missing parts are null. */
export async function fetchSiteMeta(env, url) {
  const out = { title: null, description: null, image: null, icon: null, finalUrl: url };
  try {
    const res = await Promise.race([
      fetcher(env)(url, { headers: { 'User-Agent': 'BibleNestraBot/1.0 (+website preview)', Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' }),
      new Promise((resolve) => { setTimeout(() => resolve(null), 6000); }),
    ]);
    if (!res || !res.ok) return out;
    if (res.url && /^https:\/\//i.test(res.url)) out.finalUrl = res.url;
    const type = String(res.headers.get('content-type') || '');
    if (type && !/html/i.test(type)) return out;
    const html = (await res.text()).slice(0, 400000);
    const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : 200000);
    const t = metaContent(head, ['og:title', 'twitter:title']) || decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    out.title = t ? t.slice(0, 120) : null;
    const d = metaContent(head, ['og:description', 'description', 'twitter:description']);
    out.description = d ? d.slice(0, 500) : null;
    out.image = absolute(out.finalUrl, metaContent(head, ['og:image', 'og:image:url', 'twitter:image']));
    const iconTag = head.match(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*>/i);
    const iconHref = iconTag ? (iconTag[0].match(/href=["']([^"']+)["']/i) || [])[1] : null;
    out.icon = absolute(out.finalUrl, iconHref || '/favicon.ico');
  } catch (e) { /* best effort */ }
  return out;
}

// ---------- admin page tab (appended to /admin via registerAdminScript; no backticks or "${" inside) ----------
export const WEBSITES_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;
function when(s){ if (!s) return '—'; var d = new Date(s); return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
window.registerAdminTab('Member websites', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'Member websites' }));
  box.appendChild(h('p', { class: 'sub', text: 'Only administrators add websites for now. Websites you add are published straight away: they show in the Socials feed and the Websites directory, and open inside Bible Nestra. (Member submissions with approval come back when website_feed.public_submission is turned on.)' }));
  // ---- Add website (published immediately) ----
  var fUrl = h('input', { type: 'url', placeholder: 'https://example.org', style: 'flex:2;min-width:200px' });
  var fName = h('input', { type: 'text', placeholder: 'Name (optional, read from the site)', maxlength: '120', style: 'flex:2;min-width:180px' });
  var fCat = h('select', { style: 'flex:1;min-width:120px' });
  fCat.appendChild(h('option', { value: '', text: 'Category' }));
  ['Ministry', 'Church', 'Blog', 'Business', 'Education', 'Media', 'Charity', 'Other'].forEach(function(cName){ fCat.appendChild(h('option', { value: cName, text: cName })); });
  var fDesc = h('textarea', { placeholder: 'Description (optional, read from the site)', maxlength: '500', rows: '2', style: 'width:100%;margin-top:8px' });
  var fBtn = h('button', { class: 'btn', text: 'Add website' });
  fBtn.onclick = async function(){
    if (!fUrl.value.trim()) { toast('Enter the website address', true); return; }
    fBtn.disabled = true;
    try {
      await api('POST', '/admin/api/websites', { url: fUrl.value.trim(), title: fName.value.trim() || undefined, description: fDesc.value.trim() || undefined, category: fCat.value || undefined });
      toast('Website published'); fUrl.value = ''; fName.value = ''; fDesc.value = ''; fCat.value = '';
      current = 'approved'; Array.prototype.forEach.call(tabs.children, function(x){ x.className = 'btn small' + (x.textContent === 'Approved' ? '' : ' ghost'); }); load();
    } catch (e) { toast(e.message, true); }
    fBtn.disabled = false;
  };
  box.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' }, [
    h('b', { text: 'Add website' }),
    h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap;gap:8px' }, [fUrl, fName, fCat]),
    fDesc,
    h('div', { class: 'row', style: 'margin-top:8px' }, [fBtn]),
  ]));
  var tabs = h('div', { class: 'row', style: 'margin-bottom:12px' });
  var list = h('div');
  box.appendChild(tabs); box.appendChild(list);
  var current = 'pending';
  ['pending', 'approved', 'rejected', 'hidden'].forEach(function(s){
    var b = h('button', { class: 'btn small' + (s === current ? '' : ' ghost'), text: s.charAt(0).toUpperCase() + s.slice(1) });
    b.onclick = function(){ current = s; Array.prototype.forEach.call(tabs.children, function(x){ x.className = 'btn small ghost'; }); b.className = 'btn small'; load(); };
    tabs.appendChild(b);
  });
  async function act(id, action, payload){
    try { await api('POST', '/admin/api/websites/' + id + '/' + action, payload || {}); toast('Done'); load(); }
    catch (e) { toast(e.message, true); }
  }
  async function load(){
    list.innerHTML = '';
    var d; try { d = await api('GET', '/admin/api/websites?status=' + current); } catch (e) { list.appendChild(h('div', { class: 'card empty', text: e.message })); return; }
    if (!d.items.length) { list.appendChild(h('div', { class: 'card empty', text: 'Nothing here.' })); return; }
    d.items.forEach(function(w){
      var btns = [];
      if (w.status !== 'approved') { var ok = h('button', { class: 'btn small', text: 'Approve' }); ok.onclick = function(){ act(w.id, 'approve'); }; btns.push(ok); }
      if (w.status === 'pending') {
        var no = h('button', { class: 'btn small ghost', text: 'Reject' });
        no.onclick = function(){ var r = window.prompt('Reason for the member (optional):', ''); if (r === null) return; act(w.id, 'reject', { reason: r }); };
        btns.push(no);
      }
      if (w.status === 'approved') { var hide = h('button', { class: 'btn small danger', text: 'Hide' }); hide.onclick = function(){ if (window.confirm('Hide ' + w.title + ' from the app?')) act(w.id, 'hide'); }; btns.push(hide); }
      list.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [
          w.icon ? h('img', { class: 'avatar', src: w.icon, alt: '' }) : h('div', { class: 'avatar' }),
          h('div', { class: 'grow' }, [h('b', { text: w.title }), h('div', { class: 'meta', text: w.host + (w.category ? ' · ' + w.category : '') })]),
          h('a', { href: w.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open website' }),
        ]),
        w.description ? h('p', { style: 'margin:10px 0 0', text: w.description }) : null,
        h('div', { class: 'meta', style: 'margin-top:8px', text: 'By ' + (w.owner ? w.owner.displayName : 'a member') + ' · added ' + when(w.createdAt) + (w.reviewedAt ? ' · reviewed ' + when(w.reviewedAt) : '') + ' · opened ' + w.opens + ' time(s)' + (w.rejectReason ? ' · reason: ' + w.rejectReason : '') }),
        h('div', { class: 'row', style: 'margin-top:10px' }, btns),
      ]));
    });
  }
  load();
});
})();
`;
