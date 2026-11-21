// Admin dashboard tab "Memberships" (MEMBERSHIPS & PAID CHANNELS, brief section 8). Registered with registerAdminScript()
// from routes/memberships.js. Uses the /memberships/manage/* API (admins; owners too when public creation is on).
// textContent-based DOM builder only (nothing typed by people is parsed as HTML).
// NOTE: plain JS in a string — no backticks or "${" inside.
export const MEMBERSHIPS_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;

async function authHeaders(){
  var h = { 'Accept': 'application/json' };
  var tk = localStorage.getItem('bnAdminToken');
  if (tk) { h['Authorization'] = 'Bearer ' + tk; return h; }
  var dev = localStorage.getItem('bnAdminDevUser');
  if (dev && window.__ADMIN__ && window.__ADMIN__.devMode) { h['X-Dev-User'] = dev; return h; }
  try { if (window.Clerk && window.Clerk.session) { var t = await window.Clerk.session.getToken(); if (t) h['Authorization'] = 'Bearer ' + t; } } catch (e) {}
  return h;
}
async function uploadImage(file){
  var h = await authHeaders();
  h['Content-Type'] = file.type || 'image/jpeg';
  var res = await fetch('/uploads/image', { method: 'POST', headers: h, body: file });
  var d = null; try { d = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((d && d.error) || 'Image upload failed');
  return d.key;
}
function field(h, label, input, hint){
  return h('div', { class: 'row', style: 'margin-top:10px;align-items:flex-start' }, [
    h('span', { class: 'meta', style: 'width:130px;flex:none;padding-top:8px', text: label }),
    h('div', { class: 'grow' }, [input, hint ? h('div', { class: 'meta', style: 'margin-top:4px', text: hint }) : null]),
  ]);
}
function ta(h, rows, ph, max){ return h('textarea', { rows: String(rows), style: 'width:100%;box-sizing:border-box', placeholder: ph || '', maxlength: String(max || 6000) }); }
function inp(h, ph, max, type){ return h('input', { type: type || 'text', style: 'width:100%;box-sizing:border-box', placeholder: ph || '', maxlength: max ? String(max) : null }); }
function sel(h, opts){ return h('select', {}, opts.map(function(o){ return h('option', { value: o[0], text: o[1] }); })); }
function imagePicker(h){
  var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  var link = h('input', { placeholder: 'or paste an https image link', style: 'min-width:240px' });
  var prev = h('img', { alt: '', style: 'display:none;width:128px;height:72px;border-radius:10px;object-fit:cover' });
  var state = { cleared: false };
  file.onchange = function(){ var f = file.files[0]; if (!f) return; prev.src = URL.createObjectURL(f); prev.style.display = 'block'; state.cleared = false; };
  link.oninput = function(){ if (/^https:/.test(link.value.trim())) { prev.src = link.value.trim(); prev.style.display = 'block'; } };
  return {
    el: h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [prev, file, link]),
    value: async function(){ if (file.files[0]) return await uploadImage(file.files[0]); if (link.value.trim()) return link.value.trim(); return undefined; },
    set: function(url){ file.value = ''; link.value = ''; if (url) { prev.src = url; prev.style.display = 'block'; } else { prev.style.display = 'none'; } },
  };
}
function fmtDate(s){ if (!s) return 'no end date'; try { return new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return s; } }
function chip(h, text, kind){ return h('span', { class: 'chip' + (kind ? ' ' + kind : ''), text: text }); }
function stars(n){ var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '\\u2605' : '\\u2606'; return s; }
// FAQs: one per line "Question :: Answer" · questions: one per line, "*" first = required
function faqText(list){ return (list || []).map(function(f){ return f.q + ' :: ' + f.a; }).join('\\n'); }
function parseFaqs(t){ return t.split('\\n').map(function(l){ var i = l.indexOf('::'); return i < 0 ? { q: l.trim(), a: '' } : { q: l.slice(0, i).trim(), a: l.slice(i + 2).trim() }; }).filter(function(f){ return f.q; }); }
function qText(list){ return (list || []).map(function(x){ return (x.required ? '* ' : '') + x.label; }).join('\\n'); }
function parseQs(t){ return t.split('\\n').map(function(l){ l = l.trim(); var req = l.charAt(0) === '*'; return { label: req ? l.slice(1).trim() : l, required: req }; }).filter(function(x){ return x.label; }); }
function lines(t){ return t.split('\\n').map(function(l){ return l.trim(); }).filter(Boolean); }

window.registerAdminTab('Memberships', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var meta = { categories: [], flags: {} };
  box.appendChild(h('h2', { class: 'serif', text: 'Memberships & Paid Channels' }));
  box.appendChild(h('p', { class: 'sub', text: 'One membership shows in Discover \\u203A Memberships, in Paid Channels and (for members) in My Channels. Each one gets a Broadcast Channel (only you and admins post) and a Community group (every member chats) the first time you publish it. Access is checked by the server on every channel, community and library request; when a membership lapses the person is removed within 15 minutes and renewing brings them back.' }));
  var flagsLine = h('div', { class: 'card', style: 'background:var(--raised)' });
  box.appendChild(flagsLine);

  // ================= create / edit =================
  var editing = null;
  var fTitle = inp(h, 'School of Prayer', 120);
  var fSlug = inp(h, 'auto from the title', 80);
  var fCat = h('select');
  var fCover = imagePicker(h);
  var fVideo = inp(h, 'https://www.youtube.com/watch?v=… (optional intro video)', 600);
  var fHead = inp(h, 'Learn to pray with power and consistency', 200);
  var fDesc = ta(h, 4, 'Who it is for and what happens inside (plain text)', 6000);
  var fBen = ta(h, 4, 'One per line, e.g. Weekly live prayer class', 4000);
  var fFaq = ta(h, 4, 'One per line:  Question :: Answer', 12000);
  var fQs = ta(h, 3, 'One per line. Start with * to make it required, e.g. * Which church do you attend?', 3000);
  var fCName = inp(h, 'optional — defaults to the owner name', 80);
  var fCBio = ta(h, 3, 'optional — defaults to the owner profile bio', 1000);
  var fOwner = inp(h, '@handle of the owner (optional — defaults to you)', 60);
  var fSort = inp(h, '0', 4, 'number'); fSort.style.width = '90px';
  var fSave = h('button', { class: 'btn', text: 'Create membership' });
  var fCancel = h('button', { class: 'btn ghost', text: 'New membership', style: 'display:none' });
  var fHeadLine = h('div', { class: 'meta', text: 'New membership (saved as a draft)' });
  box.appendChild(h('div', { class: 'card' }, [
    fHeadLine,
    field(h, 'Title', fTitle),
    field(h, 'Link name', fSlug, 'Used in the share link'),
    field(h, 'Category', fCat),
    field(h, 'Cover image', fCover.el, '16:9 works best (shown on the catalogue card and at the top of the page)'),
    field(h, 'Intro video', fVideo, 'Optional · shows a Preview badge on the card'),
    field(h, 'Headline', fHead, 'The big line on the product page and the line under the title on cards'),
    field(h, 'Description', fDesc),
    field(h, 'What you get', fBen),
    field(h, 'FAQs', fFaq),
    field(h, 'Checkout questions', fQs, 'Asked at checkout; answers show in Members'),
    field(h, 'Creator name', fCName),
    field(h, 'Creator bio', fCBio),
    field(h, 'Owner', fOwner),
    field(h, 'Featured boost', fSort, 'Higher numbers rank higher in Trending (-100 … 100)'),
    h('div', { class: 'row', style: 'margin-top:14px' }, [fSave, fCancel]),
  ]));
  function reset(){
    editing = null; fHeadLine.textContent = 'New membership (saved as a draft)'; fSave.textContent = 'Create membership'; fCancel.style.display = 'none';
    [fTitle, fSlug, fVideo, fHead, fDesc, fBen, fFaq, fQs, fCName, fCBio, fOwner].forEach(function(x){ x.value = ''; });
    fCover.set(null); fSort.value = '0'; if (meta.categories.length) fCat.value = meta.categories[0];
  }
  function edit(m){
    editing = m; fHeadLine.textContent = 'Editing \\u201C' + m.title + '\\u201D'; fSave.textContent = 'Save membership'; fCancel.style.display = '';
    fTitle.value = m.title; fSlug.value = m.slug; fCat.value = m.category; fCover.set(m.coverUrl); fVideo.value = m.introVideoUrl || '';
    fHead.value = m.headline || ''; fDesc.value = m.description || ''; fBen.value = (m.benefits || []).join('\\n'); fFaq.value = faqText(m.faqs); fQs.value = qText(m.questions);
    fCName.value = m.creatorName || ''; fCBio.value = m.creatorBio || ''; fOwner.value = m.owner && m.owner.handle ? '@' + m.owner.handle : ''; fSort.value = String(m.sortOrder || 0);
    fTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  fCancel.onclick = reset;
  fSave.onclick = async function(){
    if (!fTitle.value.trim()) { toast('Give the membership a title', true); fTitle.focus(); return; }
    fSave.disabled = true;
    try {
      var p = { title: fTitle.value.trim(), category: fCat.value, introVideoUrl: fVideo.value.trim() || null, headline: fHead.value.trim(), description: fDesc.value.trim(),
        benefits: lines(fBen.value), faqs: parseFaqs(fFaq.value), questions: parseQs(fQs.value), creatorName: fCName.value.trim(), creatorBio: fCBio.value.trim(), sortOrder: Number(fSort.value || 0) || 0 };
      if (fSlug.value.trim()) p.slug = fSlug.value.trim();
      if (fOwner.value.trim()) p.ownerHandle = fOwner.value.trim();
      var cov = await fCover.value(); if (cov !== undefined) p.coverKey = cov;
      var r = editing ? await api('PATCH', '/memberships/manage/' + editing.id, p) : await api('POST', '/memberships/manage', p);
      toast(editing ? 'Saved' : 'Created as a draft \\u2014 add a plan, then publish');
      open[r.id] = 'plans'; reset(); await load();
    } catch (e) { toast(e.message, true); }
    fSave.disabled = false;
  };

  var list = h('div');
  box.appendChild(list);
  var items = [];
  var open = {}; // id -> panel name

  async function load(){
    var d = await api('GET', '/memberships/manage');
    items = d.items; meta.categories = d.categories; meta.flags = d.flags;
    if (!fCat.options.length) { meta.categories.forEach(function(cn){ fCat.appendChild(h('option', { value: cn, text: cn })); }); }
    flagsLine.innerHTML = '';
    flagsLine.appendChild(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
      h('b', { text: 'Status' }),
      chip(h, meta.flags.publicCreation ? 'Creators can create (public creation ON)' : 'Admins only create (public creation OFF)', meta.flags.publicCreation ? 'gold' : 'mut'),
      chip(h, meta.flags.playConfigured ? 'Google Play Billing configured' : 'Google Play Billing not set up \\u2014 members join by Grant access', meta.flags.playConfigured ? '' : 'neg'),
      chip(h, meta.flags.testCheckout ? 'Test checkout ON for you' : 'Test checkout off', meta.flags.testCheckout ? 'gold' : 'mut'),
    ]));
    draw();
  }

  function draw(){
    list.innerHTML = '';
    list.appendChild(h('h3', { class: 'serif', text: items.length + ' membership' + (items.length === 1 ? '' : 's') }));
    if (!items.length) list.appendChild(h('div', { class: 'card meta', text: 'No memberships yet \\u2014 create the first one above.' }));
    items.forEach(function(m){
      var card = h('div', { class: 'card', id: 'mem-' + m.id });
      var statusKind = m.status === 'published' ? '' : m.status === 'archived' ? 'neg' : 'mut';
      var actions = [];
      if (m.status !== 'published') actions.push(h('button', { class: 'btn small', text: 'Publish', onclick: function(){ act(m, 'publish'); } }));
      if (m.status === 'published') actions.push(h('button', { class: 'btn ghost small', text: 'Unpublish (draft)', onclick: function(){ act(m, 'draft'); } }));
      if (m.status !== 'archived') actions.push(h('button', { class: 'btn ghost small', text: 'Archive', onclick: function(){ if (confirm('Archive \\u201C' + m.title + '\\u201D? It leaves the catalogue; current members keep access until their end date.')) act(m, 'archive'); } }));
      actions.push(h('button', { class: 'btn ghost small', text: 'Edit', onclick: function(){ edit(m); } }));
      ['plans', 'lessons', 'members', 'reviews'].forEach(function(p){
        var label = { plans: 'Plans & promo codes', lessons: 'Library (' + m.lessons.length + ')', members: 'Members (' + m.subscribers.active + ')', reviews: 'Reviews (' + m.rating.count + ')' }[p];
        actions.push(h('button', { class: 'btn small ' + (open[m.id] === p ? '' : 'ghost'), text: label, onclick: function(){ open[m.id] = open[m.id] === p ? null : p; draw(); } }));
      });
      card.appendChild(h('div', { class: 'row', style: 'gap:14px;align-items:flex-start' }, [
        m.coverUrl ? h('img', { src: m.coverUrl, alt: '', style: 'width:150px;height:84px;border-radius:12px;object-fit:cover;flex:none' }) : h('div', { style: 'width:150px;height:84px;border-radius:12px;background:var(--raised);flex:none' }),
        h('div', { class: 'grow' }, [
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [h('b', { text: m.title }), chip(h, m.status, statusKind), chip(h, m.category, 'mut'), m.hasPreview ? chip(h, 'Intro video', 'gold') : null]),
          h('div', { class: 'meta', style: 'margin-top:4px', text: (m.priceLabel || 'No active plan') + ' \\u00B7 ' + m.memberCount + ' members \\u00B7 \\u2605 ' + m.rating.avg.toFixed(2) + ' (' + m.rating.count + ') \\u00B7 owner ' + (m.owner ? m.owner.name : '\\u2014') }),
          h('div', { style: 'margin-top:4px', text: m.headline || '' }),
          m.channelId ? h('div', { class: 'meta', style: 'margin-top:4px', text: 'Channel and Community created \\u2014 post in the Channel from the app (Chats) as the owner or an admin.' }) : h('div', { class: 'meta', style: 'margin-top:4px', text: 'Channel and Community are created when you publish.' }),
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:10px' }, actions),
        ]),
      ]));
      var panel = open[m.id];
      if (panel === 'plans') card.appendChild(plansPanel(m));
      if (panel === 'lessons') card.appendChild(lessonsPanel(m));
      if (panel === 'members') card.appendChild(membersPanel(m));
      if (panel === 'reviews') card.appendChild(reviewsPanel(m));
      list.appendChild(card);
    });
  }

  async function act(m, action){
    try { await api('POST', '/memberships/manage/' + m.id + '/' + action, {}); toast({ publish: 'Published \\u2014 it is now in the app', draft: 'Moved back to draft', archive: 'Archived' }[action]); await load(); }
    catch (e) { toast(e.message, true); }
  }

  // ----- plans + promo codes -----
  function plansPanel(m){
    var wrap = h('div', { style: 'margin-top:14px;border-top:1px solid var(--border);padding-top:12px' });
    wrap.appendChild(h('b', { text: 'Plans' }));
    wrap.appendChild(h('div', { class: 'meta', text: 'Type prices in the plan currency (e.g. 25000 for ₦25,000); they are saved in the smallest unit (kobo). The Store product id is the Google Play / App Store product this plan maps to once in-app billing is set up.' }));
    m.plans.forEach(function(p){
      var name = inp(h, 'Name', 60); name.value = p.name; name.style.width = '160px';
      var price = inp(h, 'Price', 14, 'number'); price.value = String(p.priceMinor / 100); price.style.width = '120px';
      var cur = inp(h, 'NGN', 3); cur.value = p.currency; cur.style.width = '70px';
      var iv = sel(h, [['month', 'Monthly'], ['year', 'Yearly'], ['days', 'Every N days'], ['one_time', 'One-time']]); iv.value = p.interval;
      var days = inp(h, 'days', 4, 'number'); days.value = p.intervalDays ? String(p.intervalDays) : ''; days.style.width = '80px';
      var sku = inp(h, 'store product id', 100); sku.value = p.storeProductId || ''; sku.style.width = '170px';
      var act2 = h('input', { type: 'checkbox' }); act2.checked = p.active;
      var save = h('button', { class: 'btn small', text: 'Save' });
      save.onclick = async function(){
        try { await api('PATCH', '/memberships/manage/plans/' + p.id, { name: name.value.trim(), priceMinor: Math.round(Number(price.value || 0) * 100), currency: cur.value.trim().toUpperCase(), interval: iv.value, intervalDays: days.value ? Number(days.value) : null, storeProductId: sku.value.trim(), active: act2.checked }); toast('Plan saved'); await load(); }
        catch (e) { toast(e.message, true); }
      };
      wrap.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:8px' }, [name, price, cur, iv, days, sku, h('label', { class: 'row meta', style: 'gap:4px' }, [act2, 'active']), save, h('span', { class: 'meta', text: p.displayPrice })]));
    });
    var nName = inp(h, 'Plan name (e.g. Monthly)', 60); nName.style.width = '160px';
    var nPrice = inp(h, 'Price e.g. 25000', 14, 'number'); nPrice.style.width = '120px';
    var nCur = inp(h, 'NGN', 3); nCur.value = 'NGN'; nCur.style.width = '70px';
    var nIv = sel(h, [['month', 'Monthly'], ['year', 'Yearly'], ['days', 'Every N days'], ['one_time', 'One-time']]);
    var nDays = inp(h, 'days', 4, 'number'); nDays.style.width = '80px';
    var nSku = inp(h, 'store product id (later)', 100); nSku.style.width = '170px';
    var add = h('button', { class: 'btn small', text: 'Add plan' });
    add.onclick = async function(){
      if (nPrice.value === '') { toast('Enter a price', true); return; }
      try { await api('POST', '/memberships/manage/' + m.id + '/plans', { name: nName.value.trim() || 'Membership', priceMinor: Math.round(Number(nPrice.value) * 100), currency: nCur.value.trim().toUpperCase() || 'NGN', interval: nIv.value, intervalDays: nDays.value ? Number(nDays.value) : null, storeProductId: nSku.value.trim() }); toast('Plan added'); await load(); }
      catch (e) { toast(e.message, true); }
    };
    wrap.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px dashed var(--border)' }, [nName, nPrice, nCur, nIv, nDays, nSku, add]));

    wrap.appendChild(h('b', { style: 'display:block;margin-top:16px', text: 'Promo codes' }));
    m.promos.forEach(function(p){
      var tog = h('button', { class: 'btn ghost small', text: p.active ? 'Turn off' : 'Turn on' });
      tog.onclick = async function(){ try { await api('PATCH', '/memberships/manage/promos/' + p.id, { active: !p.active }); await load(); } catch (e) { toast(e.message, true); } };
      wrap.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:6px' }, [h('code', { text: p.code }), h('span', { text: p.kind === 'percent' ? p.value + '% off' : 'minus ' + (p.value / 100) + ' (major units)' }), h('span', { class: 'meta', text: p.uses + (p.maxUses ? ' / ' + p.maxUses : '') + ' used' + (p.expiresAt ? ' \\u00B7 until ' + fmtDate(p.expiresAt) : '') }), p.active ? chip(h, 'active') : chip(h, 'off', 'mut'), tog]));
    });
    var pc = inp(h, 'CODE', 30); pc.style.width = '120px';
    var pk = sel(h, [['percent', '% off'], ['amount', 'amount off']]);
    var pv = inp(h, 'value', 10, 'number'); pv.style.width = '90px';
    var pm = inp(h, 'max uses', 7, 'number'); pm.style.width = '90px';
    var pe = h('input', { type: 'date' });
    var padd = h('button', { class: 'btn small', text: 'Add code' });
    padd.onclick = async function(){
      try { await api('POST', '/memberships/manage/' + m.id + '/promos', { code: pc.value.trim().toUpperCase(), kind: pk.value, value: pk.value === 'amount' ? Math.round(Number(pv.value) * 100) : Number(pv.value), maxUses: pm.value ? Number(pm.value) : null, expiresAt: pe.value ? pe.value + 'T23:59:59Z' : null }); toast('Code added'); await load(); }
      catch (e) { toast(e.message, true); }
    };
    wrap.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:8px' }, [pc, pk, pv, pm, pe, padd]));
    return wrap;
  }

  // ----- library -----
  function lessonsPanel(m){
    var wrap = h('div', { style: 'margin-top:14px;border-top:1px solid var(--border);padding-top:12px' });
    wrap.appendChild(h('b', { text: 'Library lessons (in order)' }));
    m.lessons.forEach(function(l, i){
      var up = h('button', { class: 'btn ghost small', text: '\\u2191', disabled: i === 0 });
      var dn = h('button', { class: 'btn ghost small', text: '\\u2193', disabled: i === m.lessons.length - 1 });
      var del = h('button', { class: 'btn ghost small', text: 'Delete' });
      up.onclick = async function(){ await api('POST', '/memberships/manage/lessons/' + l.id + '/move', { dir: 'up' }); await load(); };
      dn.onclick = async function(){ await api('POST', '/memberships/manage/lessons/' + l.id + '/move', { dir: 'down' }); await load(); };
      del.onclick = async function(){ if (!confirm('Delete \\u201C' + l.title + '\\u201D?')) return; await api('DELETE', '/memberships/manage/lessons/' + l.id); await load(); };
      wrap.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:6px' }, [h('span', { class: 'meta', text: String(l.position) + '.' }), h('span', { class: 'grow', text: l.title }), chip(h, l.kind, 'mut'), l.sample ? chip(h, 'sample', 'gold') : null, l.minutes ? h('span', { class: 'meta', text: l.minutes + ' min' }) : null, up, dn, del]));
    });
    var t = inp(h, 'Lesson title', 160);
    var k = sel(h, [['text', 'Text'], ['video', 'Video link'], ['file', 'File link']]);
    var u = inp(h, 'https://… (video or file link)', 600);
    var mins = inp(h, 'min', 4, 'number'); mins.style.width = '80px';
    var b = ta(h, 3, 'Lesson notes / text (plain text)', 20000);
    var smp = h('input', { type: 'checkbox' });
    var add = h('button', { class: 'btn small', text: 'Add lesson' });
    add.onclick = async function(){
      if (!t.value.trim()) { toast('Give the lesson a title', true); return; }
      try { await api('POST', '/memberships/manage/' + m.id + '/lessons', { title: t.value.trim(), kind: k.value, mediaUrl: u.value.trim() || null, minutes: mins.value ? Number(mins.value) : null, body: b.value.trim(), sample: smp.checked }); toast('Lesson added'); await load(); }
      catch (e) { toast(e.message, true); }
    };
    wrap.appendChild(h('div', { class: 'card', style: 'background:var(--raised);margin-top:10px' }, [
      field(h, 'Title', t), field(h, 'Type', k), field(h, 'Link', u), field(h, 'Length', mins), field(h, 'Text', b),
      field(h, 'Sample', h('label', { class: 'row meta', style: 'gap:6px' }, [smp, 'Show the title on the product page as a sample lesson'])),
      h('div', { class: 'row', style: 'margin-top:10px' }, [add]),
    ]));
    return wrap;
  }

  // ----- members: grant / revoke -----
  function membersPanel(m){
    var wrap = h('div', { style: 'margin-top:14px;border-top:1px solid var(--border);padding-top:12px' });
    var who = inp(h, '@handle or name', 60); who.style.width = '200px';
    var until = h('input', { type: 'date' });
    var note = inp(h, 'note (optional)', 300); note.style.width = '220px';
    var grant = h('button', { class: 'btn small', text: 'Grant access' });
    grant.onclick = async function(){
      if (!who.value.trim()) { toast('Who should get access?', true); return; }
      try { var r = await api('POST', '/memberships/manage/' + m.id + '/grant', { handle: who.value.trim(), until: until.value || null, note: note.value.trim() || null }); toast(r.user.name + ' now has access' + (r.expiresAt ? ' until ' + fmtDate(r.expiresAt) : '')); who.value = ''; note.value = ''; await load(); open[m.id] = 'members'; draw(); }
      catch (e) { toast(e.message, true); }
    };
    wrap.appendChild(h('b', { text: 'Grant access by hand' }));
    wrap.appendChild(h('div', { class: 'meta', text: 'Adds the person to the Channel and Community right away (source: admin grant). Leave the date empty for no end date.' }));
    wrap.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:8px' }, [who, h('span', { class: 'meta', text: 'until' }), until, note, grant]));
    var table = h('div', { style: 'margin-top:12px' }, [h('div', { class: 'meta', text: 'Loading members\\u2026' })]);
    wrap.appendChild(table);
    api('GET', '/memberships/manage/' + m.id + '/subscribers').then(function(d){
      table.innerHTML = '';
      if (!d.items.length) { table.appendChild(h('div', { class: 'meta', text: 'No members yet.' })); return; }
      d.items.forEach(function(s){
        var rev = h('button', { class: 'btn ghost small', text: 'Revoke' });
        rev.onclick = async function(){ if (!confirm('Remove ' + s.user.name + '\\u2019s access now? They leave the Channel and Community.')) return; try { await api('POST', '/memberships/manage/' + m.id + '/revoke', { userId: s.user.id }); toast('Access removed'); await load(); open[m.id] = 'members'; draw(); } catch (e) { toast(e.message, true); } };
        table.appendChild(h('div', { style: 'border-top:1px solid var(--border);padding:8px 0' }, [
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [h('b', { text: s.user.name }), s.user.handle ? h('span', { class: 'meta', text: '@' + s.user.handle }) : null,
            chip(h, s.active ? s.rawStatus : s.status, s.active ? '' : 'neg'), chip(h, s.source.replace('_', ' '), 'mut'),
            h('span', { class: 'meta', text: (s.plan ? s.plan.name + ' \\u00B7 ' + s.plan.displayPrice + ' \\u00B7 ' : '') + (s.active ? 'until ' + fmtDate(s.expiresAt) : 'ended ' + fmtDate(s.expiresAt)) + (s.amount ? ' \\u00B7 paid ' + s.amount : '') + (s.promoCode ? ' \\u00B7 code ' + s.promoCode : '') }),
            s.active ? rev : null]),
          (s.answers || []).filter(Boolean).length ? h('div', { class: 'quote', text: (m.questions || []).map(function(qq, i){ return qq.label + ' \\u2014 ' + (s.answers[i] || '\\u2014'); }).join('\\n') }) : null,
          s.note ? h('div', { class: 'meta', text: 'Note: ' + s.note }) : null,
        ]));
      });
    }).catch(function(e){ table.innerHTML = ''; table.appendChild(h('div', { class: 'meta', text: e.message })); });
    return wrap;
  }

  // ----- reviews moderation -----
  function reviewsPanel(m){
    var wrap = h('div', { style: 'margin-top:14px;border-top:1px solid var(--border);padding-top:12px' }, [h('div', { class: 'meta', text: 'Loading reviews\\u2026' })]);
    api('GET', '/memberships/manage/' + m.id + '/reviews').then(function(d){
      wrap.innerHTML = '';
      wrap.appendChild(h('b', { text: 'Reviews (only current or past members can write one; hidden reviews don\\u2019t count in the rating)' }));
      if (!d.items.length) wrap.appendChild(h('div', { class: 'meta', style: 'margin-top:6px', text: 'No reviews yet.' }));
      d.items.forEach(function(r){
        var b = h('button', { class: 'btn ghost small', text: r.hidden ? 'Show' : 'Hide' });
        b.onclick = async function(){ try { await api('POST', '/memberships/manage/reviews/' + r.id + '/hide', { hidden: !r.hidden }); toast(r.hidden ? 'Review shown' : 'Review hidden'); await load(); open[m.id] = 'reviews'; draw(); } catch (e) { toast(e.message, true); } };
        wrap.appendChild(h('div', { style: 'border-top:1px solid var(--border);padding:8px 0' + (r.hidden ? ';opacity:.55' : '') }, [
          h('div', { class: 'row', style: 'gap:8px' }, [h('b', { text: r.user.name }), h('span', { style: 'color:var(--gold)', text: stars(r.rating) }), h('span', { class: 'meta', text: fmtDate(r.createdAt) }), r.hidden ? chip(h, 'hidden', 'neg') : null, b]),
          r.body ? h('div', { style: 'margin-top:4px', text: r.body }) : null,
        ]));
      });
    }).catch(function(e){ wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'meta', text: e.message })); });
    return wrap;
  }

  load().catch(function(e){ toast(e.message, true); });
});
})();
`;
