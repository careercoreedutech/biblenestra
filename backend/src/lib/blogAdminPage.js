// Admin dashboard tab "Blog" (BLOG). Registered with registerAdminScript() from routes/blog.js. Runs inside the
// /admin page and only uses window.registerAdminTab and ctx.api / ctx.h / ctx.toast (textContent-based DOM builder,
// so nothing typed by people is parsed as HTML). The only innerHTML is the server's Markdown preview, which is
// rendered with every character escaped (lib/blog.js renderMarkdown).
// NOTE: plain JS in a string — no backticks, no "${", no backslashes inside.
export const BLOG_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;

var css = document.createElement('style');
css.textContent = [
  '.bl-pills{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}',
  '.bl-pills button{border:1px solid var(--border);background:var(--surface);color:var(--fg);padding:7px 14px;border-radius:999px;font-weight:600;cursor:pointer;font:inherit;font-weight:600}',
  '.bl-pills button.on{background:var(--gold);border-color:var(--gold);color:#fff}',
  '.bl-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:900px){.bl-grid{grid-template-columns:1fr}}',
  '.bl-ta{width:100%;box-sizing:border-box;border:1px solid var(--border);background:var(--raised);border-radius:10px;padding:9px 12px;font:inherit;color:var(--fg);resize:vertical}',
  '.bl-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5}',
  '.bl-prev{background:#FFFDF8;border:1px solid var(--border);border-radius:14px;padding:14px 18px;max-height:640px;overflow:auto;font:16px/1.6 Georgia,serif}',
  '.bl-prev h2,.bl-prev h3,.bl-prev h4{font-family:Newsreader,Georgia,serif;margin:18px 0 6px}',
  '.bl-prev blockquote{margin:14px 0;padding:10px 14px;background:#F5EBD7;border-left:4px solid var(--gold);border-radius:4px 12px 12px 4px}',
  '.bl-prev blockquote p{margin:0}.bl-prev cite{display:block;font-style:normal;font-size:13px;color:var(--muted);margin-top:4px}',
  '.bl-topics{display:flex;flex-wrap:wrap;gap:6px 14px}',
  '.bl-topics label{display:flex;gap:6px;align-items:center;font-size:13.5px}',
  '.bl-run{font-size:12.5px;padding:4px 0;border-top:1px dashed var(--border)}',
  '.bl-help{background:#FBF6EC;border:1px solid rgba(168,122,39,.3);border-radius:14px;padding:12px 14px;font-size:13px;color:var(--muted);margin-bottom:12px}',
].join('');
document.head.appendChild(css);

async function authHeaders(){
  var hd = { 'Accept': 'application/json' };
  var tk = localStorage.getItem('bnAdminToken');
  if (tk) { hd['Authorization'] = 'Bearer ' + tk; return hd; }
  var dev = localStorage.getItem('bnAdminDevUser');
  if (dev && window.__ADMIN__ && window.__ADMIN__.devMode) { hd['X-Dev-User'] = dev; return hd; }
  try { if (window.Clerk && window.Clerk.session) { var t = await window.Clerk.session.getToken(); if (t) hd['Authorization'] = 'Bearer ' + t; } } catch (e) {}
  return hd;
}
async function uploadImage(file){
  var hd = await authHeaders();
  hd['Content-Type'] = file.type || 'image/jpeg';
  var res = await fetch('/uploads/image', { method: 'POST', headers: hd, body: file });
  var d = null; try { d = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((d && d.error) || 'Image upload failed');
  return d.key;
}
function fmtWhen(s){ if (!s) return '—'; try { return new Date(s).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s; } }
function toLocalInput(s){ var d = s ? new Date(s) : new Date(Date.now() + 3600000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function splitList(s){ return String(s || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean); }

window.registerAdminTab('Blog', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var presets = { topics: [], tones: {}, lengths: {}, weekdays: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] };
  var base = location.origin;

  function field(label, input, hint){
    return h('div', { class: 'row', style: 'margin-top:10px;align-items:flex-start' }, [
      h('span', { class: 'meta', style: 'width:120px;flex:none;padding-top:8px', text: label }),
      h('div', { class: 'grow' }, [input, hint ? h('div', { class: 'meta', style: 'margin-top:4px', text: hint }) : null]),
    ]);
  }
  function inp(ph, max, type){ return h('input', { type: type || 'text', style: 'width:100%;box-sizing:border-box', placeholder: ph || '', maxlength: max ? String(max) : null }); }
  function ta(rows, ph, cls){ return h('textarea', { rows: String(rows), class: 'bl-ta' + (cls ? ' ' + cls : ''), placeholder: ph || '' }); }
  function sel(opts, val){ var s = h('select'); opts.forEach(function(o){ s.appendChild(h('option', { value: o[0], text: o[1] })); }); if (val != null) s.value = val; return s; }
  function check(label, on){ var c = h('input', { type: 'checkbox' }); c.checked = !!on; return { box: c, el: h('label', { class: 'row meta', style: 'gap:6px' }, [c, label]) }; }
  function chip(status){
    if (status === 'published') return h('span', { class: 'chip', text: 'Published' });
    if (status === 'scheduled') return h('span', { class: 'chip gold', text: 'Scheduled' });
    if (status === 'running') return h('span', { class: 'chip gold', text: 'Running' });
    if (status === 'success') return h('span', { class: 'chip', text: 'Success' });
    if (status === 'partial') return h('span', { class: 'chip gold', text: 'Partly done' });
    if (status === 'failed') return h('span', { class: 'chip neg', text: 'Failed' });
    return h('span', { class: 'chip mut', text: 'Draft' });
  }
  function imagePicker(){
    var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    var link = h('input', { placeholder: 'or paste an https image link', style: 'min-width:220px' });
    var prev = h('img', { alt: '', style: 'display:none;width:96px;height:54px;border-radius:10px;object-fit:cover' });
    var clear = h('button', { class: 'btn ghost small', text: 'Remove', style: 'display:none' });
    var state = { cleared: false };
    file.onchange = function(){ var f = file.files[0]; if (!f) return; prev.src = URL.createObjectURL(f); prev.style.display = 'block'; clear.style.display = ''; state.cleared = false; };
    link.oninput = function(){ if (link.value.trim().indexOf('https:') === 0) { prev.src = link.value.trim(); prev.style.display = 'block'; clear.style.display = ''; state.cleared = false; } };
    clear.onclick = function(e){ e.preventDefault(); file.value = ''; link.value = ''; prev.style.display = 'none'; clear.style.display = 'none'; state.cleared = true; };
    return {
      el: h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [prev, file, link, clear]),
      value: async function(){ if (file.files[0]) return await uploadImage(file.files[0]); if (link.value.trim()) return link.value.trim(); if (state.cleared) return null; return undefined; },
      set: function(url){ file.value = ''; link.value = ''; state.cleared = false; if (url) { prev.src = url; prev.style.display = 'block'; clear.style.display = ''; } else { prev.style.display = 'none'; clear.style.display = 'none'; } },
    };
  }

  box.appendChild(h('h2', { class: 'serif', text: 'Blog' }));
  box.appendChild(h('p', { class: 'sub', text: 'Your blog lives at /blog on this server. Write posts yourself, let AI draft one for you, or set up auto-posting schedules (topics, posts per day, daily / weekly / monthly). Course lessons and devotionals can link to any post.' }));
  var pills = h('div', { class: 'bl-pills' });
  box.appendChild(pills);
  var views = {};
  var VIEWS = [['posts', 'Posts'], ['write', 'Write / AI'], ['auto', 'Auto-posting'], ['settings', 'Settings']];
  VIEWS.forEach(function(v){ views[v[0]] = h('div', { style: 'display:none' }); box.appendChild(views[v[0]]); });
  var current = 'posts';
  function showView(name){
    current = name;
    pills.innerHTML = '';
    VIEWS.forEach(function(v){ pills.appendChild(h('button', { class: v[0] === name ? 'on' : '', text: v[1], onclick: function(){ showView(v[0]); } })); });
    Object.keys(views).forEach(function(k){ views[k].style.display = k === name ? '' : 'none'; });
    if (name === 'posts') loadPosts();
    if (name === 'auto') loadSchedules();
    if (name === 'settings') loadSettings();
  }

  // ================= posts list =================
  var pv = views.posts;
  var fStatus = sel([['', 'All posts'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['published', 'Published']], '');
  var fSearch = h('input', { placeholder: 'Search title or topic', style: 'min-width:200px' });
  var newBtn = h('button', { class: 'btn', text: '+ New post' });
  var counts = h('span', { class: 'meta' });
  var viewAll = h('a', { href: '/blog', target: '_blank', rel: 'noopener', text: 'Open the blog ↗' });
  pv.appendChild(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:12px' }, [fStatus, fSearch, newBtn, counts, h('span', { class: 'grow' }), viewAll]));
  var postList = h('div');
  pv.appendChild(postList);
  fStatus.onchange = function(){ loadPosts(); };
  var st; fSearch.oninput = function(){ clearTimeout(st); st = setTimeout(loadPosts, 300); };
  newBtn.onclick = function(){ openEditor(null); };

  async function loadPosts(){
    var qs = '?limit=200' + (fStatus.value ? '&status=' + fStatus.value : '') + (fSearch.value.trim() ? '&q=' + encodeURIComponent(fSearch.value.trim()) : '');
    var d; try { d = await api('GET', '/admin/api/blog/posts' + qs); } catch (e) { postList.textContent = e.message; return; }
    presets = d.presets; base = d.base || base; fillTopicLists();
    counts.textContent = d.counts.published + ' published · ' + d.counts.scheduled + ' scheduled · ' + d.counts.draft + ' draft(s)';
    postList.innerHTML = '';
    if (!d.items.length) postList.appendChild(h('div', { class: 'card empty', text: 'No posts here yet. Write one, or let AI draft one under “Write / AI”.' }));
    d.items.forEach(function(p){
      var ed = h('button', { class: 'btn ghost small', text: 'Edit' });
      ed.onclick = async function(){ try { openEditor(await api('GET', '/admin/api/blog/posts/' + p.id)); } catch (e) { toast(e.message, true); } };
      var pub = h('button', { class: 'btn ghost small', text: p.status === 'published' ? 'Unpublish' : 'Publish now' });
      pub.onclick = async function(){
        try { await api('PATCH', '/admin/api/blog/posts/' + p.id, { status: p.status === 'published' ? 'draft' : 'published' }); toast(p.status === 'published' ? 'Moved back to drafts' : 'Published'); loadPosts(); } catch (e) { toast(e.message, true); }
      };
      var del = h('button', { class: 'btn ghost small', text: 'Delete' });
      del.onclick = async function(){ if (!window.confirm('Delete “' + p.title + '”? Links to it will stop working.')) return; try { await api('DELETE', '/admin/api/blog/posts/' + p.id); toast('Deleted'); loadPosts(); } catch (e) { toast(e.message, true); } };
      var copy = h('button', { class: 'btn ghost small', text: 'Copy link' });
      copy.onclick = function(){ try { navigator.clipboard.writeText(p.url); toast('Link copied'); } catch (e) { window.prompt('Link', p.url); } };
      var when = p.status === 'scheduled' ? 'Goes live ' + fmtWhen(p.publishAt) : p.status === 'published' ? 'Published ' + fmtWhen(p.publishedAt) : 'Updated ' + fmtWhen(p.updatedAt);
      postList.appendChild(h('div', { class: 'card row', style: 'align-items:flex-start' }, [
        p.coverUrl ? h('img', { src: p.coverUrl, alt: '', style: 'width:84px;height:56px;border-radius:10px;object-fit:cover;flex:none' }) : h('div', { class: 'avatar', style: 'border-radius:10px;width:84px;height:56px' }),
        h('div', { class: 'grow' }, [
          h('div', {}, [chip(p.status), ' ', p.source === 'ai' ? h('span', { class: 'chip mut', text: 'AI' }) : null, ' ', h('b', { class: 'serif', text: p.title })]),
          h('div', { class: 'meta', text: [p.topic, when, p.readingMinutes + ' min read', p.views + ' view(s)', p.scheduleName ? 'from “' + p.scheduleName + '”' : null].filter(Boolean).join(' · ') }),
          p.reviewNote ? h('div', { class: 'meta', style: 'color:' + (p.reviewNote.indexOf('Held') === 0 ? 'var(--neg)' : 'var(--gold)'), text: p.reviewNote }) : null,
          p.live ? h('a', { class: 'meta', href: p.url, target: '_blank', rel: 'noopener', text: p.url }) : h('span', { class: 'meta', text: '/blog/' + p.slug + ' (not live yet)' }),
        ]),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:300px' }, [ed, pub, copy, del]),
      ]));
    });
  }

  // ================= write / AI =================
  var wv = views.write;
  var topicList = h('datalist', { id: 'bl-topic-list' });
  wv.appendChild(topicList);
  function fillTopicLists(){
    if (topicList.childNodes.length) return;
    (presets.topics || []).forEach(function(t){ topicList.appendChild(h('option', { value: t })); });
    aiTone.innerHTML = ''; Object.keys(presets.tones || {}).forEach(function(k){ aiTone.appendChild(h('option', { value: k, text: presets.tones[k] })); });
    aiLen.innerHTML = ''; Object.keys(presets.lengths || {}).forEach(function(k){ aiLen.appendChild(h('option', { value: k, text: k + ' (~' + presets.lengths[k] + ' words)' })); }); aiLen.value = 'medium';
  }
  var aiTopic = inp('e.g. Prayer, Forgiveness, the book of Ruth', 60); aiTopic.setAttribute('list', 'bl-topic-list');
  var aiPrompt = ta(3, 'Optional · what should the article say? e.g. “How to keep praying when answers are slow — for busy young parents”');
  var aiTone = sel([['warm', 'warm and encouraging']], 'warm');
  var aiLen = sel([['medium', 'medium']], 'medium');
  var aiGo = h('button', { class: 'btn', text: '✨ Write a draft with AI' });
  wv.appendChild(h('div', { class: 'card' }, [
    h('h3', { class: 'serif', style: 'margin:0', text: 'Generate with AI' }),
    h('div', { class: 'meta', text: 'Creates a draft you can edit before publishing. Bible verses are inserted from the KJV by the server — the AI never types verse text.' }),
    field('Topic', aiTopic), field('Prompt', aiPrompt), field('Tone', aiTone), field('Length', aiLen),
    h('div', { class: 'row', style: 'margin-top:12px' }, [aiGo]),
  ]));
  aiGo.onclick = async function(){
    if (!aiTopic.value.trim() && !aiPrompt.value.trim()) { toast('Pick a topic or write a prompt', true); return; }
    aiGo.disabled = true; aiGo.textContent = 'Writing… (up to a minute)';
    try {
      var p = await api('POST', '/admin/api/blog/generate', { topic: aiTopic.value.trim(), prompt: aiPrompt.value.trim(), tone: aiTone.value, length: aiLen.value });
      toast(p.flags && p.flags.length ? 'Draft written — please review: ' + p.flags.join(', ') : 'Draft written — review it below');
      openEditor(p);
    } catch (e) { toast(e.message, true); }
    aiGo.disabled = false; aiGo.textContent = '✨ Write a draft with AI';
  };

  var editing = null;
  var eHead = h('h3', { class: 'serif', style: 'margin:0', text: 'New post' });
  var eTitle = inp('Title', 160);
  var eSlug = inp('auto from the title', 90);
  var eTopic = inp('Topic', 60); eTopic.setAttribute('list', 'bl-topic-list');
  var eTags = inp('comma separated, e.g. prayer, hope', 200);
  var eAuthor = inp('BibleNestra', 80);
  var eExcerpt = ta(2, 'One or two sentences shown in the list and under the title (auto from the article if empty)');
  var eSeo = inp('Search description (auto if empty)', 160);
  var eCover = imagePicker();
  var eBody = ta(22, '## A subheading' + String.fromCharCode(10) + 'Write paragraphs separated by a blank line.', 'bl-mono');
  var ePrev = h('div', { class: 'bl-prev' }, [h('div', { class: 'meta', text: 'Press Preview to see the article.' })]);
  var eNote = h('div', { class: 'meta', style: 'color:var(--neg)' });
  var bPrev = h('button', { class: 'btn ghost small', text: 'Preview' });
  var bDraft = h('button', { class: 'btn ghost', text: 'Save draft' });
  var bPub = h('button', { class: 'btn', text: 'Publish now' });
  var eWhen = h('input', { type: 'datetime-local' });
  var bSched = h('button', { class: 'btn ghost', text: 'Schedule' });
  var bUnpub = h('button', { class: 'btn ghost', text: 'Unpublish', style: 'display:none' });
  var bNew = h('button', { class: 'btn ghost small', text: 'New post' });
  var eLink = h('a', { target: '_blank', rel: 'noopener', style: 'display:none' });
  wv.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'row' }, [eHead, h('span', { class: 'grow' }), eLink, bNew]),
    eNote,
    field('Title', eTitle), field('Link', eSlug, 'The address: /blog/your-link'), field('Topic', eTopic), field('Tags', eTags), field('Author', eAuthor),
    field('Excerpt', eExcerpt), field('SEO description', eSeo), field('Cover image', eCover.el, 'Optional · wide 16:9 images look best'),
    h('div', { class: 'bl-help', style: 'margin-top:12px', text: 'Formatting: ## Subheading · **bold** · *italic* · - list item · [link text](https://…). Bible verses: put a reference alone on its own line like [[JHN 3:16]] or [[PSA 23:1-3]] — the exact KJV text is inserted when you save. References that don’t exist are removed.' }),
    h('div', { class: 'bl-grid' }, [h('div', {}, [eBody, h('div', { class: 'row', style: 'margin-top:6px' }, [bPrev])]), ePrev]),
    h('div', { class: 'row', style: 'margin-top:14px;gap:8px;flex-wrap:wrap' }, [bDraft, bPub, h('span', { class: 'meta', text: 'or go live at' }), eWhen, bSched, bUnpub]),
  ]));

  function openEditor(p){
    editing = p;
    eHead.textContent = p ? 'Editing “' + p.title + '”' : 'New post';
    eTitle.value = p ? p.title : ''; eSlug.value = p ? p.slug : ''; eTopic.value = p ? (p.topic || '') : '';
    eTags.value = p ? (p.tags || []).join(', ') : ''; eAuthor.value = p ? p.author : ''; eExcerpt.value = p ? p.excerpt : ''; eSeo.value = p ? p.seoDescription : '';
    eCover.set(p ? p.coverUrl : null); eBody.value = p ? (p.body || '') : '';
    eWhen.value = toLocalInput(p && p.publishAt);
    eNote.textContent = p && p.reviewNote ? p.reviewNote : '';
    bUnpub.style.display = p && p.status !== 'draft' ? '' : 'none';
    if (p && p.live) { eLink.href = p.url; eLink.textContent = 'View live ↗'; eLink.style.display = ''; } else eLink.style.display = 'none';
    ePrev.innerHTML = ''; ePrev.appendChild(h('div', { class: 'meta', text: 'Press Preview to see the article.' }));
    if (current !== 'write') showView('write');
    if (p) preview();
    eTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  bNew.onclick = function(){ openEditor(null); };
  async function preview(){
    try {
      var r = await api('POST', '/admin/api/blog/preview', { body: eBody.value });
      ePrev.innerHTML = '';
      var head = h('div', {}, [h('h1', { class: 'serif', style: 'font-size:28px;margin:0 0 6px', text: eTitle.value || 'Untitled' }), h('div', { class: 'meta', text: r.readingMinutes + ' min read' + (r.droppedRefs.length ? ' · will remove unknown references: ' + r.droppedRefs.join(', ') : '') + (r.flags.length ? ' · please review: ' + r.flags.join(', ') : '') })]);
      var bodyEl = h('div'); bodyEl.innerHTML = r.html;
      ePrev.appendChild(head); ePrev.appendChild(bodyEl);
    } catch (e) { toast(e.message, true); }
  }
  bPrev.onclick = preview;
  async function save(status){
    if (!eTitle.value.trim()) { toast('Give the post a title', true); eTitle.focus(); return; }
    var p = { title: eTitle.value.trim(), slug: eSlug.value.trim(), topic: eTopic.value.trim(), tags: splitList(eTags.value), author: eAuthor.value.trim(), excerpt: eExcerpt.value.trim(), seoDescription: eSeo.value.trim(), body: eBody.value, status: status };
    if (status === 'scheduled') { if (!eWhen.value) { toast('Choose when it should go live', true); return; } p.publishAt = new Date(eWhen.value).toISOString(); }
    [bDraft, bPub, bSched].forEach(function(b){ b.disabled = true; });
    try {
      var cv = await eCover.value(); if (cv !== undefined) p.coverKey = cv;
      var r = editing ? await api('PATCH', '/admin/api/blog/posts/' + editing.id, p) : await api('POST', '/admin/api/blog/posts', p);
      toast(status === 'published' ? 'Published' : status === 'scheduled' ? 'Scheduled for ' + fmtWhen(r.publishAt) : 'Draft saved');
      if (r.droppedRefs && r.droppedRefs.length) toast('Removed unknown Bible references: ' + r.droppedRefs.join(', '), true);
      openEditor(r);
    } catch (e) { toast(e.message, true); }
    [bDraft, bPub, bSched].forEach(function(b){ b.disabled = false; });
  }
  bDraft.onclick = function(){ save('draft'); };
  bPub.onclick = function(){ save('published'); };
  bSched.onclick = function(){ save('scheduled'); };
  bUnpub.onclick = function(){ save('draft'); };

  // ================= auto-posting =================
  var av = views.auto;
  av.appendChild(h('div', { class: 'bl-help', text: 'Auto-posting writes new articles for you on a timetable. Choose topics (they take turns so consecutive posts differ) and/or describe what to write, how many posts each time, and when. New posts are saved as drafts for your review unless you choose “Publish automatically”. The server checks every 15 minutes and writes up to 2 posts per check, so a run of 5 posts finishes within about 45 minutes.' }));
  var sEditing = null;
  var sHead = h('h3', { class: 'serif', style: 'margin:0', text: 'New schedule' });
  var sName = inp('e.g. Morning devotionals', 80);
  var sTopicsBox = h('div', { class: 'bl-topics' });
  var sCustom = inp('Your own topics, comma separated (e.g. Single parents, Exams)', 400);
  var sPrompt = ta(3, 'Optional · describe what to write, e.g. “Short practical encouragement for young Nigerian professionals”');
  var sTone = sel([['warm', 'warm and encouraging']], 'warm');
  var sLen = sel([['short', 'short'], ['medium', 'medium'], ['long', 'long']], 'medium');
  var sCount = sel([['1', '1 post'], ['2', '2 posts'], ['3', '3 posts'], ['4', '4 posts'], ['5', '5 posts']], '1');
  var sFreq = sel([['daily', 'Every day'], ['weekly', 'Weekly on chosen days'], ['monthly', 'Monthly on a day']], 'daily');
  var sDaysBox = h('div', { class: 'bl-topics' });
  var dayBoxes = [];
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(n, i){ var c = h('input', { type: 'checkbox' }); dayBoxes.push(c); sDaysBox.appendChild(h('label', {}, [c, n])); });
  var sMonthDay = inp('1', 2, 'number'); sMonthDay.style.width = '90px';
  var sTime = h('input', { type: 'time', value: '08:00' });
  var tzList = h('datalist', { id: 'bl-tz-list' });
  ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Kampala', 'Africa/Kigali', 'Europe/London', 'America/New_York', 'America/Chicago', 'Asia/Kolkata'].forEach(function(z){ tzList.appendChild(h('option', { value: z })); });
  av.appendChild(tzList);
  var sTz = inp('Africa/Lagos', 64); sTz.setAttribute('list', 'bl-tz-list'); sTz.style.maxWidth = '260px';
  var sMode = sel([['draft', 'Save as drafts for my review (recommended)'], ['publish', 'Publish automatically']], 'draft');
  var sNotify = check('Send an inbox notification to all members when a post goes live (off by default — avoid spamming)', false);
  var sActive = check('Active', true);
  var sSave = h('button', { class: 'btn', text: 'Create schedule' });
  var sCancel = h('button', { class: 'btn ghost', text: 'New schedule', style: 'display:none' });
  var dayRow = field('Weekdays', sDaysBox);
  var mdRow = field('Day of month', sMonthDay, '29–31 run on the last day in shorter months');
  av.appendChild(h('div', { class: 'card' }, [
    sHead,
    field('Name', sName), field('Topics', sTopicsBox, 'Ticked topics are used in turn'), field('Custom topics', sCustom), field('Prompt', sPrompt),
    field('Tone', sTone), field('Length', sLen), field('Posts per run', sCount), field('How often', sFreq), dayRow, mdRow,
    field('Time of day', h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [sTime, sTz])),
    field('New posts', sMode), field('Notify', sNotify.el), field('Status', sActive.el),
    h('div', { class: 'row', style: 'margin-top:14px' }, [sSave, sCancel]),
  ]));
  function syncFreq(){ dayRow.style.display = sFreq.value === 'weekly' ? '' : 'none'; mdRow.style.display = sFreq.value === 'monthly' ? '' : 'none'; }
  sFreq.onchange = syncFreq;
  var topicBoxes = [];
  function drawTopicBoxes(selected){
    sTopicsBox.innerHTML = ''; topicBoxes = [];
    (presets.topics || []).forEach(function(t){ var c = h('input', { type: 'checkbox' }); c.checked = selected.indexOf(t) !== -1; topicBoxes.push([t, c]); sTopicsBox.appendChild(h('label', {}, [c, t])); });
  }
  function resetSchedule(){
    sEditing = null; sHead.textContent = 'New schedule'; sSave.textContent = 'Create schedule'; sCancel.style.display = 'none';
    sName.value = ''; drawTopicBoxes([]); sCustom.value = ''; sPrompt.value = ''; sTone.value = 'warm'; sLen.value = 'medium'; sCount.value = '1'; sFreq.value = 'daily';
    dayBoxes.forEach(function(c, i){ c.checked = i === 1; }); sMonthDay.value = '1'; sTime.value = '08:00'; sTz.value = 'Africa/Lagos'; sMode.value = 'draft'; sNotify.box.checked = false; sActive.box.checked = true; syncFreq();
  }
  function editSchedule(s){
    sEditing = s; sHead.textContent = 'Editing “' + s.name + '”'; sSave.textContent = 'Save schedule'; sCancel.style.display = '';
    sName.value = s.name; drawTopicBoxes(s.topics);
    sCustom.value = s.topics.filter(function(t){ return (presets.topics || []).indexOf(t) === -1; }).join(', ');
    sPrompt.value = s.prompt; sTone.value = s.tone; sLen.value = s.length; sCount.value = String(s.postsPerRun); sFreq.value = s.frequency;
    dayBoxes.forEach(function(c, i){ c.checked = s.weekdays.indexOf(i) !== -1; }); sMonthDay.value = String(s.monthDay); sTime.value = s.timeOfDay; sTz.value = s.timezone;
    sMode.value = s.publishMode; sNotify.box.checked = s.notify; sActive.box.checked = s.active; syncFreq();
    sName.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  sCancel.onclick = resetSchedule;
  sSave.onclick = async function(){
    var topics = topicBoxes.filter(function(x){ return x[1].checked; }).map(function(x){ return x[0]; }).concat(splitList(sCustom.value));
    var p = { name: sName.value.trim(), topics: topics, prompt: sPrompt.value.trim(), tone: sTone.value, length: sLen.value, postsPerRun: Number(sCount.value), frequency: sFreq.value,
      weekdays: dayBoxes.map(function(c, i){ return c.checked ? i : -1; }).filter(function(i){ return i >= 0; }), monthDay: Number(sMonthDay.value || 1), timeOfDay: sTime.value, timezone: sTz.value.trim() || 'Africa/Lagos',
      publishMode: sMode.value, notify: sNotify.box.checked, active: sActive.box.checked };
    sSave.disabled = true;
    try {
      var r = sEditing ? await api('PATCH', '/admin/api/blog/schedules/' + sEditing.id, p) : await api('POST', '/admin/api/blog/schedules', p);
      toast((sEditing ? 'Schedule saved' : 'Schedule created') + (r.nextRunAt ? ' — next run ' + fmtWhen(r.nextRunAt) : ''));
      resetSchedule(); loadSchedules();
    } catch (e) { toast(e.message, true); }
    sSave.disabled = false;
  };
  var schedList = h('div');
  av.appendChild(h('h3', { class: 'serif', text: 'Schedules' }));
  av.appendChild(schedList);
  var runList = h('div', { class: 'card' });
  av.appendChild(h('h3', { class: 'serif', text: 'Run history' }));
  av.appendChild(runList);

  function runRow(r, withName){
    return h('div', { class: 'bl-run row', style: 'gap:8px;flex-wrap:wrap' }, [
      chip(r.status),
      h('span', { text: fmtWhen(r.startedAt) + (withName && r.scheduleName ? ' · ' + r.scheduleName : '') + ' · ' + (r.trigger === 'manual' ? 'Run now' : 'automatic') + ' · ' + r.made + ' of ' + r.wanted + ' written' + (r.failed ? ' · ' + r.failed + ' failed' : '') }),
      r.error ? h('span', { style: 'color:var(--neg)', text: r.error }) : null,
      (r.notes || []).length ? h('span', { class: 'meta', text: r.notes.join(' · ') }) : null,
    ]);
  }
  async function loadSchedules(){
    var d; try { d = await api('GET', '/admin/api/blog/schedules'); } catch (e) { schedList.textContent = e.message; return; }
    presets.topics = d.presets.topics; presets.tones = d.presets.tones;
    if (sTone.options.length < 2) { sTone.innerHTML = ''; Object.keys(d.presets.tones).forEach(function(k){ sTone.appendChild(h('option', { value: k, text: d.presets.tones[k] })); }); sTone.value = 'warm'; }
    if (!sEditing && !topicBoxes.length) drawTopicBoxes([]);
    schedList.innerHTML = '';
    if (!d.items.length) schedList.appendChild(h('div', { class: 'card empty', text: 'No schedules yet — create one above.' }));
    d.items.forEach(function(s){
      var run = h('button', { class: 'btn small', text: s.pending ? 'Continue run (' + s.pending + ' left)' : 'Run now' });
      run.onclick = async function(){
        run.disabled = true; run.textContent = 'Writing…';
        try {
          var r = await api('POST', '/admin/api/blog/schedules/' + s.id + '/run');
          toast(r.made + ' post(s) written' + (r.failed ? ', ' + r.failed + ' failed' : '') + (r.remaining ? ' — ' + r.remaining + ' more within ~15 min' : '') + (r.quota ? ' (AI daily limit reached)' : ''), !!(r.failed || r.quota) && !r.made);
        } catch (e) { toast(e.message, true); }
        loadSchedules();
      };
      var ed = h('button', { class: 'btn ghost small', text: 'Edit' }); ed.onclick = function(){ editSchedule(s); };
      var tog = h('button', { class: 'btn ghost small', text: s.active ? 'Pause' : 'Resume' });
      tog.onclick = async function(){ try { await api('PATCH', '/admin/api/blog/schedules/' + s.id, { active: !s.active }); toast(s.active ? 'Paused' : 'Resumed'); loadSchedules(); } catch (e) { toast(e.message, true); } };
      var del = h('button', { class: 'btn ghost small', text: 'Delete' });
      del.onclick = async function(){ if (!window.confirm('Delete schedule “' + s.name + '”? Posts it wrote stay.')) return; try { await api('DELETE', '/admin/api/blog/schedules/' + s.id); toast('Deleted'); loadSchedules(); } catch (e) { toast(e.message, true); } };
      schedList.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:wrap' }, [
          h('div', { class: 'grow' }, [
            h('div', {}, [s.active ? h('span', { class: 'chip', text: 'Active' }) : h('span', { class: 'chip mut', text: 'Paused' }), ' ', s.publishMode === 'publish' ? h('span', { class: 'chip gold', text: 'Auto-publish' }) : h('span', { class: 'chip mut', text: 'Drafts' }), ' ', s.notify ? h('span', { class: 'chip gold', text: 'Notifies' }) : null, ' ', h('b', { class: 'serif', text: s.name })]),
            h('div', { class: 'meta', text: s.summary }),
            h('div', { class: 'meta', text: 'Topics: ' + (s.topics.length ? s.topics.join(', ') : '— (prompt only)') + (s.prompt ? ' · Prompt: “' + s.prompt.slice(0, 120) + (s.prompt.length > 120 ? '…' : '') + '”' : '') }),
            h('div', { class: 'meta', text: 'Next run: ' + (s.active && s.nextRunAt ? fmtWhen(s.nextRunAt) : '—') + ' · Last run: ' + fmtWhen(s.lastRunAt) }),
          ]),
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, [run, ed, tog, del]),
        ]),
        s.runs.length ? h('div', { style: 'margin-top:8px' }, s.runs.map(function(r){ return runRow(r, false); })) : null,
      ]));
    });
    try {
      var rr = await api('GET', '/admin/api/blog/runs');
      runList.innerHTML = '';
      if (!rr.items.length) runList.appendChild(h('div', { class: 'meta', text: 'No runs yet.' }));
      rr.items.forEach(function(r){ runList.appendChild(runRow(r, true)); });
    } catch (e) { runList.textContent = e.message; }
  }

  // ================= settings =================
  var sv = views.settings;
  var gDisc = check('Show a short note at the end of AI-written posts', false);
  var gText = ta(2, '');
  var gAuthor = inp('BibleNestra', 80);
  var gSave = h('button', { class: 'btn', text: 'Save settings' });
  sv.appendChild(h('div', { class: 'card' }, [
    h('h3', { class: 'serif', style: 'margin:0', text: 'Blog settings' }),
    field('AI note', gDisc.el), field('Note text', gText), field('Default author', gAuthor, 'Shown as “By …” on new posts (you can change it per post)'),
    h('div', { class: 'row', style: 'margin-top:14px' }, [gSave]),
  ]));
  async function loadSettings(){
    try { var s = await api('GET', '/admin/api/blog/settings'); gDisc.box.checked = s.disclaimer; gText.value = s.disclaimerText; gAuthor.value = s.authorName; } catch (e) { toast(e.message, true); }
  }
  gSave.onclick = async function(){
    try { await api('PUT', '/admin/api/blog/settings', { disclaimer: gDisc.box.checked, disclaimerText: gText.value.trim(), authorName: gAuthor.value.trim() }); toast('Settings saved'); } catch (e) { toast(e.message, true); }
  };

  resetSchedule();
  showView('posts');
  window.__blogOpenEditor = openEditor;
});
})();
`;
