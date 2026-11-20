// Admin dashboard tab "Courses & Devotionals" (LEARN CMS). Registered with registerAdminScript() from
// routes/learn.js. Runs inside the /admin page and only uses window.registerAdminTab and ctx.api / ctx.h /
// ctx.toast (textContent-based DOM builder, so nothing typed by people is parsed as HTML).
// NOTE: plain JS in a string — no backticks or "${" inside.
export const LEARN_ADMIN_SCRIPT = `
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
function fmtDay(d){ try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } }
function field(h, label, input, hint){
  return h('div', { class: 'row', style: 'margin-top:10px;align-items:flex-start' }, [
    h('span', { class: 'meta', style: 'width:110px;flex:none;padding-top:8px', text: label }),
    h('div', { class: 'grow' }, [input, hint ? h('div', { class: 'meta', style: 'margin-top:4px', text: hint }) : null]),
  ]);
}
function ta(h, rows, ph, max){ return h('textarea', { rows: String(rows), style: 'width:100%;box-sizing:border-box', placeholder: ph, maxlength: String(max || 4000) }); }
function inp(h, ph, max, type){ return h('input', { type: type || 'text', style: 'width:100%;box-sizing:border-box', placeholder: ph || '', maxlength: max ? String(max) : null }); }
// An image picker: file upload or an https link; returns { el, value() → key|url|null|undefined, set(url) }
function imagePicker(h, label){
  var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  var link = h('input', { placeholder: 'or paste an https image link', style: 'min-width:220px' });
  var prev = h('img', { alt: '', style: 'display:none;width:64px;height:64px;border-radius:12px;object-fit:cover' });
  var clear = h('button', { class: 'btn ghost small', text: 'Remove', style: 'display:none' });
  var state = { cleared: false };
  file.onchange = function(){ var f = file.files[0]; if (!f) return; prev.src = URL.createObjectURL(f); prev.style.display = 'block'; clear.style.display = ''; state.cleared = false; };
  link.oninput = function(){ if (/^https:/.test(link.value.trim())) { prev.src = link.value.trim(); prev.style.display = 'block'; clear.style.display = ''; state.cleared = false; } };
  clear.onclick = function(e){ e.preventDefault(); file.value = ''; link.value = ''; prev.style.display = 'none'; clear.style.display = 'none'; state.cleared = true; };
  return {
    el: h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [prev, file, link, clear]),
    value: async function(){ if (file.files[0]) return await uploadImage(file.files[0]); if (link.value.trim()) return link.value.trim(); if (state.cleared) return null; return undefined; },
    set: function(url){ file.value = ''; link.value = ''; state.cleared = false; if (url) { prev.src = url; prev.style.display = 'block'; clear.style.display = ''; } else { prev.style.display = 'none'; clear.style.display = 'none'; } },
  };
}

window.registerAdminTab('Courses & Devotionals', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var meta = { levels: ['Beginner', 'Intermediate', 'Advanced', 'All levels'], icons: ['book'], formats: { self_study: 'Self-study', live_cohort: 'Live cohort' } };
  box.appendChild(h('h2', { class: 'serif', text: 'Courses & Devotionals' }));
  box.appendChild(h('p', { class: 'sub', text: 'What readers see under Learn › Courses and Learn › Devotionals. Each lesson shows a short excerpt in the app, then a “Continue reading on our blog →” button that opens the full post in the in-app browser. A lesson counts as read when the reader opens the blog post or taps “Mark as complete”. Only published courses appear in the app.' }));

  // ================= courses =================
  box.appendChild(h('h3', { class: 'serif', text: 'Course' }));
  var editing = null; // course being edited
  var cTitle = inp(h, 'Reading the Gospels Well', 120);
  var cProv = inp(h, 'Nairobi Bible Institute', 80);
  var cIcon = h('select');
  var cCover = imagePicker(h);
  var cLevel = h('select');
  var cFormat = h('select', {}, [h('option', { value: 'self_study', text: 'Self-study' }), h('option', { value: 'live_cohort', text: 'Live cohort' })]);
  var cDur = inp(h, '4 weeks', 40);
  var cCert = h('input', { type: 'checkbox' });
  var cSum = ta(h, 2, 'One or two sentences about the course (optional)', 600);
  var cPub = h('input', { type: 'checkbox' });
  var cOrder = inp(h, '0', 6, 'number'); cOrder.style.width = '90px';
  var cSave = h('button', { class: 'btn', text: 'Create course' });
  var cCancel = h('button', { class: 'btn ghost', text: 'New course', style: 'display:none' });
  var cHead = h('div', { class: 'meta', text: 'New course' });
  box.appendChild(h('div', { class: 'card' }, [
    cHead,
    field(h, 'Title', cTitle),
    field(h, 'Provider / author', cProv, 'Shown in grey capitals above the title'),
    field(h, 'Icon', h('div', { class: 'row', style: 'gap:10px' }, [cIcon, h('span', { class: 'meta', text: 'used when there is no cover image' })])),
    field(h, 'Cover / icon image', cCover.el, 'Optional · square works best (shown in the small tile on the card)'),
    field(h, 'Level', cLevel),
    field(h, 'Format', cFormat),
    field(h, 'Duration', cDur, 'e.g. 4 weeks, 6 sessions'),
    field(h, 'Certificate', h('label', { class: 'row meta', style: 'gap:6px' }, [cCert, 'Award a certificate on completion'])),
    field(h, 'Summary', cSum),
    field(h, 'Order', cOrder, 'Lower numbers come first in the app'),
    field(h, 'Published', h('label', { class: 'row meta', style: 'gap:6px' }, [cPub, 'Show in the app (keep off while you add lessons)'])),
    h('div', { class: 'row', style: 'margin-top:14px' }, [cSave, cCancel]),
  ]));
  function resetCourse(){
    editing = null; cHead.textContent = 'New course'; cSave.textContent = 'Create course'; cCancel.style.display = 'none';
    cTitle.value = ''; cProv.value = ''; cIcon.value = 'book'; cCover.set(null); cLevel.value = meta.levels[0]; cFormat.value = 'self_study'; cDur.value = ''; cCert.checked = false; cSum.value = ''; cPub.checked = false; cOrder.value = '0';
  }
  function editCourse(co){
    editing = co; cHead.textContent = 'Editing “' + co.title + '”'; cSave.textContent = 'Save course'; cCancel.style.display = '';
    cTitle.value = co.title; cProv.value = co.provider; cIcon.value = co.icon; cCover.set(co.coverUrl); cLevel.value = co.level; cFormat.value = co.format; cDur.value = co.duration; cCert.checked = co.certificate; cSum.value = co.summary || ''; cPub.checked = co.published; cOrder.value = String(co.sortOrder || 0);
    cTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  cCancel.onclick = resetCourse;
  cSave.onclick = async function(){
    if (!cTitle.value.trim()) { toast('Give the course a title', true); cTitle.focus(); return; }
    cSave.disabled = true;
    try {
      var payload = { title: cTitle.value.trim(), provider: cProv.value.trim(), icon: cIcon.value, level: cLevel.value, format: cFormat.value, duration: cDur.value.trim(), certificate: cCert.checked, summary: cSum.value.trim(), published: cPub.checked, sortOrder: Number(cOrder.value || 0) || 0 };
      var cov = await cCover.value(); if (cov !== undefined) payload.coverKey = cov;
      var r = editing ? await api('PATCH', '/admin/api/learn/courses/' + editing.id, payload) : await api('POST', '/admin/api/learn/courses', payload);
      toast(editing ? 'Course saved' : 'Course created — now add its lessons');
      resetCourse(); await load(); openLessons(r.id);
    } catch (e) { toast(e.message, true); }
    cSave.disabled = false;
  };
  var courseList = h('div');
  box.appendChild(courseList);

  // ----- lessons of one course -----
  var open = {}; // courseId → true (lesson panel open)
  function openLessons(id){ open[id] = true; draw(); var el = document.getElementById('learn-c-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function lessonForm(co, lesson, done){
    var t = inp(h, 'Lesson title', 140); var ex = ta(h, 6, 'Short in-app excerpt — a few paragraphs. Leave a blank line between paragraphs.', 4000);
    var img = imagePicker(h); var url = inp(h, 'https://yourblog.com/lessons/…', 600); var mins = inp(h, 'min', 3, 'number'); mins.style.width = '80px';
    var save = h('button', { class: 'btn small', text: lesson ? 'Save lesson' : 'Add lesson' });
    var cancel = h('button', { class: 'btn ghost small', text: 'Cancel' });
    if (lesson) { t.value = lesson.title; ex.value = lesson.excerpt || ''; img.set(lesson.imageUrl); url.value = lesson.blogUrl || ''; mins.value = lesson.readMinutes ? String(lesson.readMinutes) : ''; }
    save.onclick = async function(){
      if (!t.value.trim()) { toast('Give the lesson a title', true); return; }
      if (!url.value.trim()) { toast('Paste the “Read full lesson” blog link', true); return; }
      save.disabled = true;
      try {
        var p = { title: t.value.trim(), excerpt: ex.value.trim(), blogUrl: url.value.trim(), readMinutes: mins.value ? Number(mins.value) : null };
        var im = await img.value(); if (im !== undefined) p.imageKey = im;
        if (lesson) await api('PATCH', '/admin/api/learn/lessons/' + lesson.id, p); else await api('POST', '/admin/api/learn/courses/' + co.id + '/lessons', p);
        toast(lesson ? 'Lesson saved' : 'Lesson added'); done(true);
      } catch (e) { toast(e.message, true); save.disabled = false; }
    };
    cancel.onclick = function(){ done(false); };
    return h('div', { class: 'card', style: 'background:var(--raised)' }, [
      field(h, 'Title', t), field(h, 'Excerpt', ex, 'Plain text shown in the app (no HTML)'), field(h, 'Image', img.el, 'Optional · shown above the excerpt'),
      field(h, 'Read full lesson', url, 'The full post on your blog — opens in the in-app browser'), field(h, 'Reading time', mins, 'Optional · minutes'),
      h('div', { class: 'row', style: 'margin-top:12px' }, [save, cancel]),
    ]);
  }
  function lessonsPanel(co){
    var wrap = h('div', { style: 'margin-top:12px' });
    var adding = null;
    function render(){
      wrap.innerHTML = '';
      if (!co.lessons.length) wrap.appendChild(h('div', { class: 'meta', style: 'margin-bottom:8px', text: 'No lessons yet.' }));
      co.lessons.forEach(function(l, i){
        var up = h('button', { class: 'btn ghost small', text: '↑', title: 'Move up' }); up.disabled = i === 0;
        var dn = h('button', { class: 'btn ghost small', text: '↓', title: 'Move down' }); dn.disabled = i === co.lessons.length - 1;
        var ed = h('button', { class: 'btn ghost small', text: 'Edit' });
        var del = h('button', { class: 'btn ghost small', text: 'Delete' });
        var move = async function(d){ var ids = co.lessons.map(function(x){ return x.id; }); var j = i + d; var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
          try { var r = await api('PUT', '/admin/api/learn/courses/' + co.id + '/order', { lessonIds: ids }); co.lessons = r.lessons; render(); } catch (e) { toast(e.message, true); } };
        up.onclick = function(){ move(-1); }; dn.onclick = function(){ move(1); };
        del.onclick = async function(){ if (!window.confirm('Delete lesson “' + l.title + '”? Readers lose its progress.')) return; try { await api('DELETE', '/admin/api/learn/lessons/' + l.id); toast('Lesson deleted'); load(); } catch (e) { toast(e.message, true); } };
        var row = h('div', { class: 'row', style: 'padding:8px 0;border-top:1px solid var(--border)' }, [
          h('b', { text: String(l.position) + '.', style: 'width:26px' }),
          l.imageUrl ? h('img', { src: l.imageUrl, alt: '', style: 'width:40px;height:40px;border-radius:8px;object-fit:cover;flex:none' }) : null,
          h('div', { class: 'grow' }, [h('div', { text: l.title, style: 'font-weight:600' }), h('div', { class: 'meta', text: (l.paragraphs.length + ' paragraph(s) · ') }, [h('a', { href: l.blogUrl, target: '_blank', rel: 'noopener', text: l.blogUrl })])]),
          up, dn, ed, del,
        ]);
        ed.onclick = function(){ var f = lessonForm(co, l, function(saved){ if (saved) load(); else render(); }); row.replaceWith(f); };
        wrap.appendChild(row);
      });
      var add = h('button', { class: 'btn small', text: '+ Add lesson', style: 'margin-top:8px' });
      add.onclick = function(){ adding = lessonForm(co, null, function(saved){ adding = null; if (saved) load(); else render(); }); add.replaceWith(adding); };
      wrap.appendChild(add);
    }
    render();
    return wrap;
  }

  // ================= devotionals =================
  box.appendChild(h('h3', { class: 'serif', text: 'Devotional' }));
  var dEditing = null;
  var dTitle = inp(h, 'Peace That Guards', 120); var dAuthor = inp(h, 'Grace Chapel Devotional Team', 80);
  var dCover = imagePicker(h); var dDate = h('input', { type: 'date' });
  var dEx = ta(h, 6, 'Short in-app excerpt — a few paragraphs. Leave a blank line between paragraphs.', 4000);
  var dUrl = inp(h, 'https://yourblog.com/devotionals/…', 600);
  var dPub = h('input', { type: 'checkbox' }); dPub.checked = true;
  var dSave = h('button', { class: 'btn', text: 'Add devotional' });
  var dCancel = h('button', { class: 'btn ghost', text: 'New devotional', style: 'display:none' });
  var dHead = h('div', { class: 'meta', text: 'New devotional' });
  box.appendChild(h('div', { class: 'card' }, [
    dHead, field(h, 'Title', dTitle), field(h, 'Author', dAuthor), field(h, 'Cover', dCover.el, 'Optional · wide images look best'),
    field(h, 'Date', dDate, 'Appears in the app from this date'), field(h, 'Excerpt', dEx, 'Plain text shown in the app (no HTML)'),
    field(h, 'Blog link', dUrl, '“Continue reading on our blog →” opens this in the in-app browser'),
    field(h, 'Published', h('label', { class: 'row meta', style: 'gap:6px' }, [dPub, 'Show in the app'])),
    h('div', { class: 'row', style: 'margin-top:14px' }, [dSave, dCancel]),
  ]));
  var devList = h('div');
  box.appendChild(devList);
  function resetDev(){ dEditing = null; dHead.textContent = 'New devotional'; dSave.textContent = 'Add devotional'; dCancel.style.display = 'none'; dTitle.value = ''; dAuthor.value = ''; dCover.set(null); dEx.value = ''; dUrl.value = ''; dPub.checked = true; }
  function editDev(d){ dEditing = d; dHead.textContent = 'Editing “' + d.title + '”'; dSave.textContent = 'Save devotional'; dCancel.style.display = ''; dTitle.value = d.title; dAuthor.value = d.author; dCover.set(d.coverUrl); dDate.value = d.date; dEx.value = d.excerpt; dUrl.value = d.blogUrl; dPub.checked = d.published; dTitle.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  dCancel.onclick = resetDev;
  dSave.onclick = async function(){
    if (!dTitle.value.trim()) { toast('Give the devotional a title', true); return; }
    if (!dUrl.value.trim()) { toast('Paste the blog link', true); return; }
    dSave.disabled = true;
    try {
      var p = { title: dTitle.value.trim(), author: dAuthor.value.trim(), date: dDate.value || undefined, excerpt: dEx.value.trim(), blogUrl: dUrl.value.trim(), published: dPub.checked };
      var cv = await dCover.value(); if (cv !== undefined) p.coverKey = cv;
      if (dEditing) await api('PATCH', '/admin/api/learn/devotionals/' + dEditing.id, p); else await api('POST', '/admin/api/learn/devotionals', p);
      toast(dEditing ? 'Devotional saved' : 'Devotional added'); resetDev(); load();
    } catch (e) { toast(e.message, true); }
    dSave.disabled = false;
  };

  var data = null;
  function draw(){
    if (!data) return;
    courseList.innerHTML = '';
    if (!data.courses.length) courseList.appendChild(h('div', { class: 'card empty', text: 'No courses yet — create the first one above.' }));
    data.courses.forEach(function(co){
      var ed = h('button', { class: 'btn ghost small', text: 'Edit' }); ed.onclick = function(){ editCourse(co); };
      var pub = h('button', { class: 'btn ghost small', text: co.published ? 'Unpublish' : 'Publish' });
      pub.onclick = async function(){ if (!co.published && !co.lessons.length && !window.confirm('This course has no lessons yet. Publish anyway?')) return; try { await api('PATCH', '/admin/api/learn/courses/' + co.id, { published: !co.published }); toast(co.published ? 'Hidden from the app' : 'Published — it now shows under Learn › Courses'); load(); } catch (e) { toast(e.message, true); } };
      var del = h('button', { class: 'btn ghost small', text: 'Delete' });
      del.onclick = async function(){ if (!window.confirm('Delete “' + co.title + '” and all its lessons? Readers lose their progress.')) return; try { await api('DELETE', '/admin/api/learn/courses/' + co.id); toast('Course deleted'); load(); } catch (e) { toast(e.message, true); } };
      var tog = h('button', { class: 'btn small', text: open[co.id] ? 'Hide lessons' : 'Lessons (' + co.lessons.length + ')' });
      tog.onclick = function(){ open[co.id] = !open[co.id]; draw(); };
      var card = h('div', { class: 'card', id: 'learn-c-' + co.id }, [
        h('div', { class: 'row' }, [
          co.coverUrl ? h('img', { src: co.coverUrl, alt: '', style: 'width:52px;height:52px;border-radius:12px;object-fit:cover;flex:none' }) : h('div', { class: 'avatar', style: 'border-radius:12px;width:52px;height:52px', text: '' }),
          h('div', { class: 'grow' }, [
            h('div', { class: 'meta', style: 'text-transform:uppercase;letter-spacing:.06em', text: co.provider || '—' }),
            h('div', {}, [co.published ? h('span', { class: 'chip', text: 'Published' }) : h('span', { class: 'chip mut', text: 'Draft' }), ' ', co.certificate ? h('span', { class: 'chip gold', text: 'Certificate' }) : null, ' ', h('b', { class: 'serif', text: co.title })]),
            h('div', { class: 'meta', text: [co.level, co.formatLabel, co.duration, co.lessons.length + ' lesson(s)', co.stats.enrolled + ' enrolled', co.stats.finished + ' finished'].filter(Boolean).join(' · ') }),
          ]),
          tog, ed, pub, del,
        ]),
        open[co.id] ? lessonsPanel(co) : null,
      ]);
      courseList.appendChild(card);
    });
    devList.innerHTML = '';
    if (!data.devotionals.length) devList.appendChild(h('div', { class: 'card empty', text: 'No devotionals yet.' }));
    data.devotionals.forEach(function(d){
      var ed = h('button', { class: 'btn ghost small', text: 'Edit' }); ed.onclick = function(){ editDev(d); };
      var del = h('button', { class: 'btn ghost small', text: 'Delete' });
      del.onclick = async function(){ if (!window.confirm('Delete “' + d.title + '”?')) return; try { await api('DELETE', '/admin/api/learn/devotionals/' + d.id); toast('Deleted'); load(); } catch (e) { toast(e.message, true); } };
      var st = !d.published ? h('span', { class: 'chip mut', text: 'Hidden' }) : d.date > data.today ? h('span', { class: 'chip gold', text: 'Scheduled' }) : h('span', { class: 'chip', text: 'Live' });
      devList.appendChild(h('div', { class: 'card row' }, [
        d.coverUrl ? h('img', { src: d.coverUrl, alt: '', style: 'width:72px;height:48px;border-radius:8px;object-fit:cover;flex:none' }) : h('div', { class: 'avatar', style: 'border-radius:8px;width:72px;height:48px' }),
        h('div', { class: 'grow' }, [h('div', {}, [st, ' ', h('b', { text: d.title })]), h('div', { class: 'meta', text: fmtDay(d.date) + (d.author ? ' · ' + d.author : '') + ' · ' + d.reads + ' read(s)' }), h('a', { class: 'meta', href: d.blogUrl, target: '_blank', rel: 'noopener', text: d.blogUrl })]),
        ed, del,
      ]));
    });
  }
  async function load(){
    try { data = await api('GET', '/admin/api/learn'); } catch (e) { courseList.textContent = e.message; return; }
    if (cIcon.options.length !== data.icons.length) { cIcon.innerHTML = ''; data.icons.forEach(function(n){ cIcon.appendChild(h('option', { value: n, text: n })); }); }
    if (cLevel.options.length !== data.levels.length) { cLevel.innerHTML = ''; data.levels.forEach(function(n){ cLevel.appendChild(h('option', { value: n, text: n })); }); }
    meta.levels = data.levels;
    if (!dDate.value) dDate.value = data.today;
    draw();
  }
  load();
});
})();
`;

// BLOG link-up (appended): adds "Pick a blog post…" and "✨ Write it with AI" under every lesson / devotional
// "blog link" field of the Courses & Devotionals tab. It finds those fields by their placeholder, so the tab above is
// unchanged. Picking fills in <this server>/blog/<slug>; "Write it with AI" drafts a post from the title + excerpt
// (POST /admin/api/blog/generate), offers to publish it, then fills in its link. Registered from routes/blog.js.
// NOTE: plain JS in a string — no backticks, no "${", no backslashes inside.
export const LEARN_BLOG_LINK_SCRIPT = `
(function(){
var posts = null, loading = null;
function api(m, p, b){ return window.adminApi(m, p, b); }
function toast(m, e){ if (window.adminToast) window.adminToast(m, e); }
function loadPosts(force){
  if (posts && !force) return Promise.resolve(posts);
  if (loading && !force) return loading;
  loading = api('GET', '/admin/api/blog/posts?limit=300').then(function(d){ posts = d.items.filter(function(p){ return p.status !== 'draft'; }); return posts; }).catch(function(){ posts = []; return posts; });
  return loading;
}
function enhance(input){
  if (input.getAttribute('data-blog-pick') || !window.adminH || !window.adminApi) return;
  input.setAttribute('data-blog-pick', '1');
  var h = window.adminH;
  var isDev = input.getAttribute('placeholder').indexOf('devotional') !== -1;
  var pick = h('select', { style: 'max-width:340px' }, [h('option', { value: '', text: 'Pick a blog post…' })]);
  var ai = h('button', { class: 'btn ghost small', text: '✨ Write it with AI' });
  var row = h('div', { class: 'row', style: 'gap:8px;margin-top:6px;flex-wrap:wrap' }, [pick, ai, h('span', { class: 'meta', text: 'or paste any link' })]);
  input.parentNode.insertBefore(row, input.nextSibling);
  var filled = false;
  function fill(force){
    if (filled && !force) return;
    filled = true;
    loadPosts(force).then(function(list){
      while (pick.options.length > 1) pick.remove(1);
      if (!list.length) pick.appendChild(h('option', { value: '', text: '(no published posts yet — see the Blog tab)', disabled: true }));
      list.forEach(function(p){ pick.appendChild(h('option', { value: p.id, text: p.title + (p.status === 'scheduled' ? ' (scheduled)' : '') })); });
    });
  }
  pick.onfocus = function(){ fill(false); };
  pick.onmousedown = function(){ fill(false); };
  pick.onchange = function(){
    var p = (posts || []).find(function(x){ return x.id === pick.value; });
    if (!p) return;
    input.value = p.url; input.dispatchEvent(new Event('input'));
    toast('Linked to “' + p.title + '”');
  };
  ai.onclick = async function(e){
    e.preventDefault();
    var card = input.closest('.card');
    var title = null;
    if (card) card.querySelectorAll('input').forEach(function(x){ if (!title && (!x.type || x.type === 'text') && x !== input && x.value.trim() && x.getAttribute('placeholder') !== 'or paste an https image link') title = x; });
    var ex = card ? card.querySelector('textarea') : null;
    if (!title) { toast('Type the title first', true); return; }
    ai.disabled = true; ai.textContent = 'Writing… (up to a minute)';
    try {
      var p = await api('POST', '/admin/api/blog/generate', { title: title.value.trim(), excerpt: ex ? ex.value.trim() : '', topic: isDev ? 'Devotional' : 'Courses' });
      if (window.confirm('Draft “' + p.title + '” is written. Publish it now so readers can open it? (Cancel keeps it as a draft in the Blog tab.)')) {
        p = await api('PATCH', '/admin/api/blog/posts/' + p.id, { status: 'published' });
        toast('Published and linked');
      } else toast('Saved as a draft — publish it in the Blog tab before readers open the link');
      input.value = p.url; input.dispatchEvent(new Event('input'));
      fill(true);
    } catch (err) { toast(err.message, true); }
    ai.disabled = false; ai.textContent = '✨ Write it with AI';
  };
}
function scan(){ document.querySelectorAll('input[placeholder^="https://yourblog.com/"]').forEach(enhance); }
function start(){ scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); }
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
`;
