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

  // ---- Website integration (brief 19.1 / 20): settings, alerts, connections, import and publish queues ----
  box.appendChild(h('h2', { class: 'serif', style: 'margin-top:28px', text: 'Website integration' }));
  box.appendChild(h('p', { class: 'sub', text: 'Member sites connected by RSS or WordPress. Imported and written articles wait in these queues until an administrator approves them.' }));
  var integ = h('div');
  box.appendChild(integ);
  var INT_STATUS = { connected: ['Connected', ''], error: ['Sync failed', 'neg'], paused: ['Paused', ''] };
  function intWhen(s){ return s ? when(s) : 'never'; }
  function intSettings(s){
    var access = h('select', {}, [['admins', 'Administrators only'], ['verified', 'Verified members'], ['members', 'All members']].map(function(o){ return h('option', { value: o[0], text: o[1] }); }));
    access.value = s.integrationAccess;
    var approval = h('input', { type: 'checkbox' }); approval.checked = !!s.publishRequiresApproval;
    var ownerOk = h('input', { type: 'checkbox' }); ownerOk.checked = !!s.ownerCanApprove;
    var mins = h('input', { type: 'number', min: '5', max: '1440', style: 'width:110px' }); mins.value = String(s.syncMinutes);
    var save = h('button', { class: 'btn small', text: 'Save settings', onclick: async function(){
      try {
        await api('PUT', '/admin/api/website-integrations/settings', { integrationAccess: access.value, publishRequiresApproval: approval.checked, ownerCanApprove: ownerOk.checked, syncMinutes: Number(mins.value) });
        toast('Saved'); integrationLoad();
      } catch (e) { toast(e.message, true); }
    } });
    return h('div', { class: 'card' }, [
      h('b', { text: 'Who may connect websites' }),
      h('div', { class: 'meta', style: 'margin-top:4px', text: 'Administrators only, verified members (accounts marked verified) or all members. Changes apply straight away.' }),
      h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap;gap:12px;align-items:center' }, [
        h('label', {}, ['Who may connect: ', access]),
        h('label', {}, [approval, ' Publishing needs approval']),
        h('label', {}, [ownerOk, ' Owners can approve their own articles']),
        h('label', {}, ['Sync every ', mins, ' minutes']),
        save,
      ]),
    ]);
  }
  function intQueue(title, direction, statuses, hint){
    var list = h('div');
    var card = h('div', { class: 'card', style: 'margin-top:14px' }, [h('b', { text: title }), h('div', { class: 'meta', style: 'margin:4px 0 8px', text: hint }), list]);
    async function reload(){
      list.innerHTML = '';
      var r;
      try { r = await api('GET', '/admin/api/website-articles?direction=' + direction + '&status=' + statuses); }
      catch (e) { list.appendChild(h('div', { class: 'meta', text: e.message })); return; }
      if (!r.items.length) { list.appendChild(h('div', { class: 'meta', text: 'Nothing waiting.' })); return; }
      r.items.forEach(function(a){
        var btns = [];
        function act(label, cls, action){
          var x = h('button', { class: 'btn small ' + cls, text: label });
          x.onclick = async function(){
            x.disabled = true;
            try {
              var out = await api('POST', '/admin/api/website-articles/' + a.id + '/' + action);
              if (out && out.status === 'failed') toast('Publishing failed: ' + (out.error || 'try again'), true); else toast('Done');
            } catch (e) { toast(e.message, true); }
            reload();
          };
          btns.push(x);
        }
        if (a.status === 'pending') act('Approve', '', 'approve');
        if (direction === 'publish' && (a.status === 'approved' || a.status === 'failed')) act(a.status === 'failed' ? 'Retry' : 'Publish', '', 'publish');
        if (a.status !== 'publishing' && a.status !== 'hidden') act('Hide', 'danger', 'hide');
        list.appendChild(h('div', { class: 'row', style: 'margin-top:8px;padding-top:8px;border-top:1px solid #EADFCE;flex-wrap:wrap;gap:8px;align-items:flex-start' }, [
          h('div', { class: 'grow' }, [
            h('b', { text: a.title }),
            h('div', { class: 'meta', text: a.host + ' · by ' + (a.owner || 'member') + ' · ' + a.statusLabel + (a.attempts ? ' · attempts ' + a.attempts : '') + ' · ' + when(a.createdAt) }),
            a.error ? h('div', { class: 'meta neg', text: 'Reason: ' + a.error }) : null,
            a.sourceUrl ? h('a', { href: a.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Original article' }) : null,
          ]),
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, btns),
        ]));
      });
    }
    reload();
    return card;
  }
  async function integrationLoad(){
    integ.innerHTML = '';
    var d;
    try { d = await api('GET', '/admin/api/website-integrations'); }
    catch (e) { integ.appendChild(h('div', { class: 'card empty', text: e.message })); return; }
    integ.appendChild(intSettings(d.settings));
    if (d.alerts.length) {
      integ.appendChild(h('div', { class: 'card', style: 'margin-top:14px' }, [h('b', { text: 'Failed-sync alerts (' + d.alerts.length + ')' })].concat(d.alerts.map(function(x){
        return h('div', { class: 'meta neg', style: 'margin-top:6px', text: x.host + ' (' + (x.owner || 'member') + '): ' + x.message + ' · last attempt ' + intWhen(x.at) });
      }))));
    }
    var conns = h('div', { class: 'card', style: 'margin-top:14px' }, [h('b', { text: 'Connections (' + d.items.length + ')' })]);
    if (!d.items.length) conns.appendChild(h('div', { class: 'meta', style: 'margin-top:6px', text: 'No websites are connected yet.' }));
    d.items.forEach(function(c){
      var st = INT_STATUS[c.status] || [c.status, ''];
      var sync = h('button', { class: 'btn small ghost', text: 'Sync now', onclick: async function(){
        try { var r = await api('POST', '/admin/api/website-integrations/' + c.id + '/sync'); toast('Synced: ' + r.added + ' new'); }
        catch (e) { toast(e.message, true); }
        integrationLoad();
      } });
      conns.appendChild(h('div', { class: 'row', style: 'margin-top:8px;padding-top:8px;border-top:1px solid #EADFCE;flex-wrap:wrap;gap:8px;align-items:center' }, [
        h('div', { class: 'grow' }, [
          h('b', { text: c.host }),
          h('div', { class: 'meta', text: (c.kind === 'wordpress' ? 'WordPress' : 'RSS / Atom') + ' · ' + (c.owner ? c.owner.displayName : 'member') + ' · last sync ' + intWhen(c.lastSyncedAt) + (c.autoImport ? ' · auto-import' : '') + (c.autoPost ? ' · auto-post' : '') + ' · ' + c.pendingImports + ' import(s) waiting, ' + c.openPublishes + ' open publication(s)' }),
          c.lastError ? h('div', { class: 'meta neg', text: 'Last error: ' + c.lastError }) : null,
        ]),
        h('span', { class: 'chip ' + st[1], text: st[0] }),
        sync,
      ]));
    });
    integ.appendChild(conns);
    integ.appendChild(intQueue('Import approval queue', 'import', 'pending', 'Articles imported from member sites. Approve to show them in the Website feed, or hide them.'));
    integ.appendChild(intQueue('Publish queue', 'publish', 'pending,approved,publishing,failed', 'Articles written in the app for a WordPress site. Approve, publish, or retry. A failed publication shows its reason.'));
  }
  integrationLoad();
});
})();
`;
