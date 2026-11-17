// The "Audio & Books" tab of the /admin dashboard (MEDIA LIBRARY). Registered with registerAdminScript()
// (see routes/admin.js). Runs inside the dashboard page; uses window.registerAdminTab / ctx.api / ctx.h
// (textContent-based DOM builder, so user content is never parsed as HTML).
// NOTE: plain JS in a string — no backticks or "${" inside.
export const LIBRARY_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;

// Raw file upload with the same credentials the dashboard uses for its JSON calls
async function authHeaders(){
  var h = { 'Accept': 'application/json' };
  var tk = localStorage.getItem('bnAdminToken');
  if (tk) { h['Authorization'] = 'Bearer ' + tk; return h; }
  var dev = localStorage.getItem('bnAdminDevUser');
  if (dev && window.__ADMIN__ && window.__ADMIN__.devMode) { h['X-Dev-User'] = dev; return h; }
  try { if (window.Clerk && window.Clerk.session) { var t = await window.Clerk.session.getToken(); if (t) h['Authorization'] = 'Bearer ' + t; } } catch (e) {}
  return h;
}
function upload(path, file, type, onProgress){
  return new Promise(async function(resolve, reject){
    var xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    var h = await authHeaders();
    Object.keys(h).forEach(function(k){ xhr.setRequestHeader(k, h[k]); });
    xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = function(e){ if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = function(){ var d = null; try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(d); else reject(new Error((d && d.error) || ('Upload failed (' + xhr.status + ')'))); };
    xhr.onerror = function(){ reject(new Error('Upload failed — check the connection')); };
    xhr.send(file);
  });
}
function guessType(file, kind){
  if (file.type) return file.type === 'audio/x-m4a' ? 'audio/mp4' : file.type;
  var ext = (file.name.split('.').pop() || '').toLowerCase();
  if (kind === 'pdf') return 'application/pdf';
  return ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus', webm: 'audio/webm' })[ext] || 'audio/mpeg';
}
function mediaDuration(file){
  return new Promise(function(resolve){
    try { var a = document.createElement('audio'); a.preload = 'metadata'; a.muted = true;
      a.onloadedmetadata = function(){ var d = a.duration; URL.revokeObjectURL(a.src); resolve(isFinite(d) ? Math.round(d) : null); };
      a.onerror = function(){ resolve(null); }; a.src = URL.createObjectURL(file); } catch (e) { resolve(null); }
  });
}
function fmtDur(s){ if (!s) return ''; s = Math.round(s); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
function fmtSize(b){ if (!b) return ''; return b > 1048576 ? (Math.round(b / 104857.6) / 10) + ' MB' : Math.round(b / 1024) + ' KB'; }

window.registerAdminTab('Audio & Books', function(box, ctx){
  var h = ctx.h;
  box.appendChild(h('h2', { class: 'serif', text: 'Audio Library & Christian Books' }));
  box.appendChild(h('p', { class: 'sub', text: 'Upload sermons, worship, audio Bible, podcasts, prayer and kids audio, and PDF books. Published items are available to every user immediately. Group and personal uploads stay private to their group or profile until you publish them here.' }));
  var kind = 'audio';
  var views = ['Library', 'Upload', 'From groups & users', 'Hidden', 'Categories', 'Reports'];
  var kindNav = h('div', { class: 'row', style: 'gap:6px;margin:10px 0 4px' });
  var nav = h('div', { class: 'row', style: 'gap:6px;margin:8px 0 14px;flex-wrap:wrap' });
  var body = h('div');
  box.appendChild(kindNav); box.appendChild(nav); box.appendChild(body);
  var current = 'Library';
  function drawKind(){ kindNav.innerHTML = ''; [['audio', 'Audio'], ['pdf', 'PDF books']].forEach(function(k){ kindNav.appendChild(h('button', { class: 'btn ' + (k[0] === kind ? '' : 'ghost'), text: k[1], onclick: function(){ kind = k[0]; drawKind(); show(current); } })); }); }
  function show(v){ current = v; nav.innerHTML = ''; views.forEach(function(x){ nav.appendChild(h('button', { class: 'btn small ' + (x === v ? '' : 'ghost'), text: x, onclick: function(){ show(x); } })); }); body.innerHTML = '';
    ({ 'Library': function(){ listView('library'); }, 'Upload': uploadView, 'From groups & users': function(){ listView('community'); }, 'Hidden': function(){ listView('hidden'); }, 'Categories': catView, 'Reports': reportView })[v](); }
  async function call(method, path, data, msg){ try { var r = await ctx.api(method, path, data); if (msg) ctx.toast(msg); return r; } catch (e) { ctx.toast(e.message, true); return null; } }
  function field(label, el){ return h('div', { class: 'grow', style: 'min-width:220px' }, [h('label', { class: 'f', text: label }), el]); }
  var catCache = {};
  async function cats(){ if (!catCache[kind]) { var r = await ctx.api('GET', '/admin/api/library/categories?kind=' + kind); catCache[kind] = r.items; } return catCache[kind]; }
  function catSelect(list, value, allowNone){ var s = h('select', {}, (allowNone ? [h('option', { value: '', text: 'No category' })] : []).concat(list.map(function(c){ return h('option', { value: c.id, text: c.name + (c.active ? '' : ' (hidden)') }); }))); if (value) s.value = value; return s; }

  // ---------------- lists ----------------
  async function listView(view){
    var search = h('input', { placeholder: 'Search title or ' + (kind === 'pdf' ? 'author' : 'speaker / artist'), class: 'grow' });
    var list = h('div');
    body.appendChild(h('div', { class: 'row', style: 'margin-bottom:10px' }, [search, h('button', { class: 'btn small ghost', text: 'Search', onclick: load })]));
    body.appendChild(list);
    search.addEventListener('keydown', function(e){ if (e.key === 'Enter') load(); });
    async function load(){
      list.innerHTML = ''; list.appendChild(h('div', { class: 'meta', text: 'Loading…' }));
      var r = await call('GET', '/admin/api/library/items?kind=' + kind + '&view=' + view + '&q=' + encodeURIComponent(search.value.trim()));
      list.innerHTML = '';
      if (!r) return;
      if (!r.items.length) { list.appendChild(h('div', { class: 'empty' }, [h('span', { class: 'serif', text: 'Nothing here yet' }), view === 'library' ? 'Use Upload to add the first item.' : ''])); return; }
      var all = await cats();
      r.items.forEach(function(it){ list.appendChild(card(it, all, load)); });
    }
    load();
  }

  function card(it, allCats, reload){
    var cover = it.coverUrl ? h('img', { src: it.coverUrl, style: 'width:64px;height:64px;border-radius:10px;object-fit:cover;flex:none', alt: '' }) : h('div', { style: 'width:64px;height:64px;border-radius:10px;background:var(--raised);flex:none' });
    var where = it.scope === 'group' ? 'Group: ' + (it.community ? it.community.name : '') : it.scope === 'personal' ? 'Profile of ' + (it.owner ? it.owner.displayName : '') + (it.visibility === 'private' ? ' (private)' : '') : 'Platform';
    var chips = [h('span', { class: 'chip', text: it.category ? it.category.name : 'No category' })];
    if (it.inLibrary) chips.push(h('span', { class: 'chip', text: 'In library' }));
    if (it.featured) chips.push(h('span', { class: 'chip gold', text: 'Featured' }));
    if (it.status === 'hidden') chips.push(h('span', { class: 'chip neg', text: 'Hidden' }));
    if (it.openReports) chips.push(h('span', { class: 'chip neg', text: it.openReports + ' report' + (it.openReports > 1 ? 's' : '') }));
    var detail = h('div');
    var meta = [it.artist, where, it.kind === 'audio' ? fmtDur(it.durationSec) : (it.pages ? it.pages + ' pages' : ''), fmtSize(it.sizeBytes), it.plays + (it.kind === 'audio' ? ' plays' : ' opens')].filter(Boolean).join(' · ');
    var acts = h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap' });
    function btn(label, cls, fn){ acts.appendChild(h('button', { class: 'btn small ' + cls, text: label, onclick: fn })); }
    btn(it.kind === 'audio' ? 'Listen' : 'Open PDF', 'ghost', function(){
      detail.innerHTML = '';
      if (it.kind === 'audio') { var a = h('audio', { controls: true, src: it.fileUrl, style: 'width:100%;margin-top:10px', preload: 'none' }); detail.appendChild(a); }
      else window.open(it.fileUrl, '_blank', 'noopener');
    });
    btn('Edit', 'ghost', function(){ detail.innerHTML = ''; detail.appendChild(editForm(it, allCats, reload)); });
    if (!it.inLibrary && it.scope !== 'platform') btn('Publish to library', '', async function(){
      var rights = it.kind === 'pdf' && !it.rightsAttested ? confirm('Confirm this book is public domain or that BibleNestra has permission to share it.') : false;
      if (it.kind === 'pdf' && !it.rightsAttested && !rights) return;
      if (await call('POST', '/library/items/' + it.id + '/publish', { inLibrary: true, rightsAttested: rights }, 'Published to the library')) reload();
    });
    if (it.inLibrary && it.scope !== 'platform') btn('Remove from library', 'ghost', async function(){ if (await call('POST', '/library/items/' + it.id + '/publish', { inLibrary: false }, 'Back in its group / profile only')) reload(); });
    btn(it.featured ? 'Unfeature' : 'Feature', 'ghost', async function(){ if (await call('PATCH', '/library/items/' + it.id, { featured: !it.featured }, 'Saved')) reload(); });
    btn(it.status === 'hidden' ? 'Unhide' : 'Hide', 'ghost', async function(){ if (await call('PATCH', '/library/items/' + it.id, { status: it.status === 'hidden' ? 'published' : 'hidden' }, 'Saved')) reload(); });
    btn('Delete', 'danger', async function(){ if (confirm('Delete "' + it.title + '" and its file for everyone? This cannot be undone.') && await call('DELETE', '/library/items/' + it.id, undefined, 'Deleted')) reload(); });
    return h('div', { class: 'card' }, [h('div', { class: 'row', style: 'gap:12px;align-items:flex-start' }, [cover, h('div', { class: 'grow' }, [
      h('div', { class: 'serif', style: 'font-size:17px', text: it.title }), h('div', { class: 'meta', text: meta }), h('div', { class: 'row', style: 'gap:6px;margin-top:6px;flex-wrap:wrap' }, chips), acts, detail,
    ])])]);
  }

  function editForm(it, allCats, reload){
    var title = h('input', { value: it.title }); var artist = h('input', { value: it.artist || '' });
    var desc = h('textarea', { rows: 3 }); desc.value = it.description || '';
    var cat = catSelect(allCats, it.category && it.category.id, true);
    var coverIn = h('input', { type: 'file', accept: 'image/*' });
    var save = h('button', { class: 'btn small', text: 'Save' });
    save.onclick = async function(){
      save.disabled = true;
      var patch = { title: title.value, artist: artist.value, description: desc.value, categoryId: cat.value || null };
      try { if (coverIn.files[0]) { var up = await upload('/uploads/image', coverIn.files[0], coverIn.files[0].type || 'image/jpeg'); patch.coverKey = up.key; } }
      catch (e) { ctx.toast(e.message, true); save.disabled = false; return; }
      if (await call('PATCH', '/library/items/' + it.id, patch, 'Saved')) reload(); else save.disabled = false;
    };
    return h('div', { style: 'margin-top:10px' }, [h('div', { class: 'row', style: 'flex-wrap:wrap' }, [field('Title', title), field(it.kind === 'pdf' ? 'Author' : 'Speaker / artist', artist), field('Category', cat), field('New cover (optional)', coverIn)]), field('Description', desc), save]);
  }

  // ---------------- upload ----------------
  async function uploadView(){
    var all = await cats();
    var file = h('input', { type: 'file', accept: kind === 'pdf' ? 'application/pdf,.pdf' : 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac' });
    var title = h('input', { placeholder: kind === 'pdf' ? 'The Pilgrim’s Progress' : 'Sunday sermon: Grace that holds' });
    var artist = h('input', { placeholder: kind === 'pdf' ? 'John Bunyan' : 'Pastor / choir / artist' });
    var desc = h('textarea', { rows: 3, placeholder: 'A short description' });
    var cat = catSelect(all.filter(function(c){ return c.active; }), null, false);
    var cover = h('input', { type: 'file', accept: 'image/*' });
    var feat = h('input', { type: 'checkbox' });
    var rights = h('input', { type: 'checkbox' });
    var rightsNote = h('input', { placeholder: 'e.g. Public domain (published 1678) · or: permission from the author, 2026' });
    var bar = h('div', { class: 'meta', style: 'margin-top:8px' });
    var go = h('button', { class: 'btn', text: 'Upload & publish' });
    file.onchange = function(){ var f = file.files[0]; if (f && !title.value) title.value = f.name.replace(/\\.[^.]+$/, '').replace(/[_-]+/g, ' '); };
    var kids = [h('div', { class: 'row', style: 'flex-wrap:wrap' }, [field(kind === 'pdf' ? 'PDF file (up to 60 MB)' : 'Audio file (up to 95 MB)', file), field('Cover image', cover)]),
      h('div', { class: 'row', style: 'flex-wrap:wrap' }, [field('Title', title), field(kind === 'pdf' ? 'Author' : 'Speaker / artist', artist), field('Category', cat)]),
      field('Description', desc), h('label', { class: 'row', style: 'gap:6px;margin-top:8px' }, [feat, 'Feature at the top of the library'])];
    if (kind === 'pdf') {
      kids.push(h('div', { class: 'quote' }, [h('label', { class: 'row', style: 'gap:8px;align-items:flex-start' }, [rights, h('span', { text: 'I confirm this book is in the public domain, or that BibleNestra has the rights holder’s permission to distribute it for free. Copyrighted books without permission must not be uploaded.' })]), field('Rights note (shown to admins)', rightsNote)]));
    }
    kids.push(h('div', { class: 'row', style: 'margin-top:12px' }, [go])); kids.push(bar);
    body.appendChild(h('div', { class: 'card' }, kids));
    go.onclick = async function(){
      var f = file.files[0];
      if (!f) { ctx.toast('Choose a file first', true); return; }
      if (!title.value.trim()) { ctx.toast('Add a title', true); title.focus(); return; }
      if (kind === 'pdf' && !rights.checked) { ctx.toast('Confirm the book is public domain or permitted', true); return; }
      go.disabled = true;
      try {
        var coverKey = null;
        if (cover.files[0]) { bar.textContent = 'Uploading cover…'; coverKey = (await upload('/uploads/image', cover.files[0], cover.files[0].type || 'image/jpeg')).key; }
        var dur = kind === 'audio' ? await mediaDuration(f) : null;
        var up = await upload('/library/files?kind=' + kind, f, guessType(f, kind), function(p){ bar.textContent = 'Uploading… ' + Math.round(p * 100) + '%'; });
        bar.textContent = 'Publishing…';
        await ctx.api('POST', '/library/items', { kind: kind, scope: 'platform', fileKey: up.key, title: title.value, artist: artist.value, description: desc.value, categoryId: cat.value || null, coverKey: coverKey, durationSec: dur, featured: feat.checked, rightsAttested: rights.checked, rightsNote: rightsNote.value });
        ctx.toast('Published — available to everyone now'); show('Library');
      } catch (e) { ctx.toast(e.message, true); bar.textContent = ''; }
      go.disabled = false;
    };
  }

  // ---------------- categories ----------------
  async function catView(){
    catCache[kind] = null;
    var list = h('div');
    var name = h('input', { placeholder: 'New category name', class: 'grow' });
    var add = h('button', { class: 'btn small', text: 'Add category', onclick: async function(){ if (!name.value.trim()) return; if (await call('POST', '/admin/api/library/categories', { kind: kind, name: name.value.trim() }, 'Category added')) { name.value = ''; catView2(); } } });
    body.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row' }, [name, add])])); body.appendChild(list);
    async function catView2(){
      catCache[kind] = null; var all = await cats(); list.innerHTML = '';
      all.forEach(function(c){
        var nm = h('input', { value: c.name, class: 'grow' }); var ord = h('input', { value: String(c.sortOrder), style: 'width:70px', type: 'number' });
        list.appendChild(h('div', { class: 'card row', style: 'gap:8px' }, [nm, ord, h('span', { class: 'meta', text: (c.count || 0) + ' items' }),
          h('button', { class: 'btn small ghost', text: 'Save', onclick: async function(){ if (await call('PATCH', '/admin/api/library/categories/' + c.id, { name: nm.value, sortOrder: Number(ord.value) || 0 }, 'Saved')) catView2(); } }),
          h('button', { class: 'btn small ghost', text: c.active ? 'Hide' : 'Show', onclick: async function(){ if (await call('PATCH', '/admin/api/library/categories/' + c.id, { active: !c.active }, 'Saved')) catView2(); } }),
          h('button', { class: 'btn small danger', text: 'Delete', onclick: async function(){ if (confirm('Delete "' + c.name + '"? Its items stay, without a category.') && await call('DELETE', '/admin/api/library/categories/' + c.id, undefined, 'Deleted')) catView2(); } })]));
      });
    }
    catView2();
  }

  // ---------------- reports ----------------
  async function reportView(){
    var r = await call('GET', '/admin/api/library/reports');
    if (!r) return;
    if (!r.items.length) { body.appendChild(h('div', { class: 'empty' }, [h('span', { class: 'serif', text: 'No open reports' })])); return; }
    var all = await cats();
    r.items.forEach(function(rep){
      var c = card(rep.item, all, reportView2);
      c.insertBefore(h('div', { class: 'quote', text: 'Reported by ' + rep.reporter + ': ' + (rep.reason || 'no reason given') }), c.firstChild);
      c.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-top:8px' }, [
        h('button', { class: 'btn small danger', text: 'Hide item', onclick: async function(){ if (await call('POST', '/admin/api/library/reports/' + rep.id + '/resolve', { action: 'hide' }, 'Hidden')) reportView2(); } }),
        h('button', { class: 'btn small ghost', text: 'Dismiss', onclick: async function(){ if (await call('POST', '/admin/api/library/reports/' + rep.id + '/resolve', { action: 'dismiss' }, 'Dismissed')) reportView2(); } }),
      ]));
      body.appendChild(c);
    });
  }
  function reportView2(){ show('Reports'); }

  drawKind(); show('Library');
});
})();
`;
