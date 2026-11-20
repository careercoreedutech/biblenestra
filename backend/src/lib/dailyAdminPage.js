// Admin dashboard tabs "Daily Bread & Videos" and "Watch on Today" (TODAY'S JOURNEY). Registered with
// registerAdminScript() from routes/daily.js. Runs inside the /admin page and only uses window.registerAdminTab,
// ctx.api / ctx.h / ctx.toast (textContent-based DOM builder, so nothing typed by people is parsed as HTML).
// NOTE: plain JS in a string — no backticks or "${" inside.
export const DAILY_ADMIN_SCRIPT = `
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
// Raw upload (POST / PUT) with progress → parsed JSON
function send(method, path, data, type, onProgress){
  return new Promise(async function(resolve, reject){
    var xhr = new XMLHttpRequest();
    xhr.open(method, path);
    var h = await authHeaders();
    Object.keys(h).forEach(function(k){ xhr.setRequestHeader(k, h[k]); });
    if (type) xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = function(e){ if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    xhr.onload = function(){ var d = null; try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(d); else reject(new Error((d && d.error) || ('Upload failed (' + xhr.status + ')'))); };
    xhr.onerror = function(){ reject(new Error('Upload failed — check the connection')); };
    xhr.send(data);
  });
}
function imgType(f){ return f.type || ({ png: 'image/png', webp: 'image/webp', heic: 'image/heic' })[(f.name.split('.').pop() || '').toLowerCase()] || 'image/jpeg'; }
async function uploadImage(file){ return send('POST', '/uploads/image', file, imgType(file)); }
function videoMeta(file){
  return new Promise(function(resolve){
    try {
      var v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      var url = URL.createObjectURL(file); var done = false;
      var finish = function(r){ if (done) return; done = true; try { URL.revokeObjectURL(url); } catch (e) {} resolve(r); };
      v.onloadedmetadata = function(){
        var meta = { duration: isFinite(v.duration) ? v.duration : 0, width: v.videoWidth || 0, height: v.videoHeight || 0, poster: null };
        v.currentTime = Math.min(1, (meta.duration || 2) / 2);
        v.onseeked = function(){
          try { var cv = document.createElement('canvas'); var s = Math.min(1, 720 / Math.max(meta.width, meta.height, 1));
            cv.width = Math.round(meta.width * s); cv.height = Math.round(meta.height * s);
            cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
            cv.toBlob(function(b){ meta.poster = b; finish(meta); }, 'image/jpeg', 0.82);
          } catch (e) { finish(meta); }
        };
        setTimeout(function(){ finish(meta); }, 6000);
      };
      v.onerror = function(){ finish({ duration: 0, width: 0, height: 0, poster: null }); };
      v.src = url;
    } catch (e) { resolve({ duration: 0, width: 0, height: 0, poster: null }); }
  });
}
// Same path the app uses: reserve → one PUT (small) or R2 multipart (big) → ready
async function uploadVideo(api, file, meta, progress){
  var r = await api('POST', '/uploads/video', { durationSeconds: Math.round(meta.duration || 0) || undefined, width: meta.width || undefined, height: meta.height || undefined, sizeBytes: file.size });
  var type = file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  if (file.size <= r.singlePutMaxBytes) {
    await send('PUT', r.uploadURL, file, type, function(l, t){ progress(l / t); });
    return r.uid;
  }
  var mp = await api('POST', '/uploads/video/' + r.uid + '/multipart', {});
  var size = mp.partSize, parts = [], n = Math.ceil(file.size / size);
  for (var i = 0; i < n; i++) {
    var part = await send('PUT', '/uploads/video/' + r.uid + '/multipart/' + encodeURIComponent(mp.uploadId) + '/parts/' + (i + 1), file.slice(i * size, Math.min(file.size, (i + 1) * size)), 'application/octet-stream',
      function(l){ progress((i * size + l) / file.size); });
    parts.push({ partNumber: part.partNumber, etag: part.etag });
  }
  await api('POST', '/uploads/video/' + r.uid + '/multipart/' + encodeURIComponent(mp.uploadId) + '/complete', { parts: parts });
  return r.uid;
}
function fmtDay(d){ try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } }
function addDays(d, n){ var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function fmtDur(s){ if (!s) return ''; var m = Math.floor(s / 60), x = s % 60; return m + ':' + String(x).padStart(2, '0'); }

window.registerAdminTab('Daily Bread & Videos', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'Daily Bread & Videos' }));
  box.appendChild(h('p', { class: 'sub', text: 'The three cards at the top of Today. Daily Bread shows the verse you schedule for each day with its image (the verse text comes from the Bible in the reader’s translation — you only choose the reference). Days without an entry use the app’s built-in verse of the day. Videos are short blessing videos that play full screen; they appear from their publish date.' }));

  // ----- flag -----
  var hl = h('input', { type: 'checkbox' });
  box.appendChild(h('div', { class: 'card' }, [h('label', { class: 'row' }, [hl, h('span', { class: 'grow' }, [h('b', { text: 'Gently highlight one card every 3 seconds ' }), h('span', { class: 'meta', text: '(daily_journey.auto_highlight · off by default · a soft glow only, it never opens anything)' })])])]));
  hl.onchange = async function(){ try { await api('PUT', '/admin/api/daily/settings', { autoHighlight: hl.checked }); toast(hl.checked ? 'Auto-highlight on' : 'Auto-highlight off'); } catch (e) { toast(e.message, true); hl.checked = !hl.checked; } };

  // ----- Daily Bread form -----
  box.appendChild(h('h3', { class: 'serif', text: 'Schedule Daily Bread' }));
  var dateIn = h('input', { type: 'date' });
  var refIn = h('input', { class: 'grow', placeholder: 'Verse reference — e.g. Psalm 23:1 or John 3:16-18' });
  var refOk = h('span', { class: 'meta' });
  var imgIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  var imgPrev = h('img', { style: 'display:none;max-width:160px;max-height:160px;border-radius:12px;margin-top:8px;object-fit:cover' });
  var clearImg = h('label', { class: 'meta row', style: 'gap:6px;display:none' }, [h('input', { type: 'checkbox' }), 'Remove the current image']);
  var reflIn = h('textarea', { rows: '3', style: 'width:100%;box-sizing:border-box', placeholder: 'Reflection (optional) — a few sentences shown under the verse' });
  var saveBtn = h('button', { class: 'btn', text: 'Save Daily Bread' });
  var saveStatus = h('span', { class: 'meta' });
  box.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'row' }, [h('span', { class: 'meta', style: 'width:80px', text: 'Date' }), dateIn]),
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:80px', text: 'Verse' }), refIn, refOk]),
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:80px', text: 'Image' }), imgIn, clearImg]),
    imgPrev,
    h('div', { style: 'margin-top:10px' }, [reflIn]),
    h('div', { class: 'row', style: 'margin-top:12px' }, [saveBtn, saveStatus]),
  ]));
  var refT;
  refIn.oninput = function(){ clearTimeout(refT); refT = setTimeout(async function(){
    var v = refIn.value.trim(); if (!v) { refOk.textContent = ''; return; }
    try { var r = await api('GET', '/admin/api/daily/verse-check?ref=' + encodeURIComponent(v)); refOk.textContent = r.ok ? '✓ ' + r.verse.label : 'Not a verse reference yet'; refOk.style.color = r.ok ? 'var(--sage, #4E6B52)' : 'var(--neg)'; } catch (e) {}
  }, 300); };
  imgIn.onchange = function(){ var f = imgIn.files[0]; if (!f) return; imgPrev.src = URL.createObjectURL(f); imgPrev.style.display = 'block'; };
  saveBtn.onclick = async function(){
    if (!dateIn.value) { toast('Pick a date', true); return; }
    if (!refIn.value.trim()) { toast('Write the verse reference', true); refIn.focus(); return; }
    saveBtn.disabled = true; saveStatus.textContent = 'Saving…';
    try {
      var payload = { ref: refIn.value.trim(), reflection: reflIn.value.trim() };
      if (imgIn.files[0]) { saveStatus.textContent = 'Uploading image…'; payload.imageKey = (await uploadImage(imgIn.files[0])).key; }
      else if (clearImg.querySelector('input').checked) payload.imageKey = null;
      var r = await api('PUT', '/admin/api/daily/bread/' + dateIn.value, payload);
      toast('Saved · ' + r.label + ' on ' + fmtDay(r.date));
      saveStatus.textContent = '';
      dateIn.value = addDays(dateIn.value, 1); refIn.value = ''; reflIn.value = ''; imgIn.value = ''; imgPrev.style.display = 'none'; refOk.textContent = ''; clearImg.style.display = 'none';
      load();
    } catch (e) { saveStatus.textContent = ''; toast(e.message, true); }
    saveBtn.disabled = false;
  };
  var breadList = h('div');
  box.appendChild(breadList);

  // ----- videos -----
  box.appendChild(h('h3', { class: 'serif', text: 'Blessing videos' }));
  var vTitle = h('input', { class: 'grow', placeholder: 'Title — e.g. A blessing for your morning', maxlength: '120' });
  var vDesc = h('input', { class: 'grow', placeholder: 'Short description (optional)', maxlength: '600' });
  var vDate = h('input', { type: 'date' });
  var vFile = h('input', { type: 'file', accept: 'video/mp4,video/quicktime' });
  var vThumb = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  var vBtn = h('button', { class: 'btn', text: 'Upload video' });
  var vStatus = h('span', { class: 'meta' });
  box.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'row' }, [h('span', { class: 'meta', style: 'width:80px', text: 'Title' }), vTitle]),
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:80px', text: 'About' }), vDesc]),
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:80px', text: 'Publish on' }), vDate]),
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:80px', text: 'Video' }), vFile, h('span', { class: 'meta', text: 'MP4, vertical (9:16) looks best · up to 2 GB' })]),
    h('div', { class: 'row', style: 'margin-top:10px' }, [h('span', { class: 'meta', style: 'width:80px', text: 'Thumbnail' }), vThumb, h('span', { class: 'meta', text: 'optional — a frame of the video is used otherwise' })]),
    h('div', { class: 'row', style: 'margin-top:12px' }, [vBtn, vStatus]),
  ]));
  vBtn.onclick = async function(){
    var f = vFile.files[0];
    if (!vTitle.value.trim()) { toast('Give the video a title', true); vTitle.focus(); return; }
    if (!f) { toast('Choose the video file', true); return; }
    vBtn.disabled = true;
    try {
      vStatus.textContent = 'Reading the video…';
      var meta = await videoMeta(f);
      var uid = await uploadVideo(api, f, meta, function(p){ vStatus.textContent = 'Uploading… ' + Math.round(p * 100) + '%'; });
      var thumbKey;
      if (vThumb.files[0]) thumbKey = (await uploadImage(vThumb.files[0])).key;
      else if (meta.poster) { try { thumbKey = (await send('POST', '/uploads/image', meta.poster, 'image/jpeg')).key; } catch (e) {} }
      await api('POST', '/admin/api/daily/videos', { videoUid: uid, title: vTitle.value.trim(), description: vDesc.value.trim(), publishOn: vDate.value || undefined, thumbKey: thumbKey, durationSec: Math.round(meta.duration || 0) || undefined });
      toast('Video added');
      vStatus.textContent = ''; vTitle.value = ''; vDesc.value = ''; vFile.value = ''; vThumb.value = '';
      load();
    } catch (e) { vStatus.textContent = ''; toast(e.message, true); }
    vBtn.disabled = false;
  };
  var videoList = h('div');
  box.appendChild(videoList);

  function editBread(b){
    dateIn.value = b.date; refIn.value = b.label; reflIn.value = b.reflection || ''; imgIn.value = '';
    if (b.imageUrl) { imgPrev.src = b.imageUrl; imgPrev.style.display = 'block'; clearImg.style.display = 'flex'; clearImg.querySelector('input').checked = false; } else { imgPrev.style.display = 'none'; clearImg.style.display = 'none'; }
    refIn.oninput(); dateIn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function load(){
    var d; try { d = await api('GET', '/admin/api/daily'); } catch (e) { breadList.textContent = e.message; return; }
    hl.checked = !!d.settings.autoHighlight;
    if (!dateIn.value) { var last = d.bread.length ? d.bread[d.bread.length - 1].date : null; dateIn.value = last && last >= d.today ? addDays(last, 1) : d.today; }
    if (!vDate.value) vDate.value = d.today;
    breadList.innerHTML = '';
    var upcoming = d.bread.filter(function(b){ return b.date >= d.today; });
    var past = d.bread.filter(function(b){ return b.date < d.today; }).reverse().slice(0, 10);
    if (!upcoming.length) breadList.appendChild(h('div', { class: 'card empty', text: 'Nothing scheduled from today on — the app shows its built-in verse of the day.' }));
    upcoming.concat(past).forEach(function(b){
      var edit = h('button', { class: 'btn ghost small', text: 'Edit' }); edit.onclick = function(){ editBread(b); };
      var del = h('button', { class: 'btn ghost small', text: 'Delete' });
      del.onclick = async function(){ if (!window.confirm('Delete Daily Bread for ' + fmtDay(b.date) + '?')) return; try { await api('DELETE', '/admin/api/daily/bread/' + b.date); toast('Deleted'); load(); } catch (e) { toast(e.message, true); } };
      breadList.appendChild(h('div', { class: 'card row', style: b.date < d.today ? 'opacity:.6' : '' }, [
        b.imageUrl ? h('img', { src: b.imageUrl, alt: '', style: 'width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none' }) : h('div', { class: 'avatar', style: 'border-radius:10px;width:56px;height:56px' }),
        h('div', { class: 'grow' }, [
          h('div', {}, [b.date === d.today ? h('span', { class: 'chip gold', text: 'Today' }) : null, ' ', h('b', { text: fmtDay(b.date) + ' · ' + b.label })]),
          h('div', { class: 'meta', text: (b.reflection ? b.reflection.slice(0, 140) : 'No reflection') + (b.imageUrl ? '' : ' · no image (the app draws one)') }),
        ]),
        edit, del,
      ]));
    });
    videoList.innerHTML = '';
    if (!d.videos.length) videoList.appendChild(h('div', { class: 'card empty', text: 'No blessing videos yet.' }));
    d.videos.forEach(function(v){
      var dIn = h('input', { type: 'date', value: v.publishOn });
      dIn.onchange = async function(){ try { await api('PATCH', '/admin/api/daily/videos/' + v.id, { publishOn: dIn.value }); toast('Publish date changed'); load(); } catch (e) { toast(e.message, true); } };
      var hide = h('button', { class: 'btn ghost small', text: v.hidden ? 'Show' : 'Hide' });
      hide.onclick = async function(){ try { await api('PATCH', '/admin/api/daily/videos/' + v.id, { hidden: !v.hidden }); toast(v.hidden ? 'Shown in the app' : 'Hidden from the app'); load(); } catch (e) { toast(e.message, true); } };
      var del = h('button', { class: 'btn ghost small', text: 'Delete' });
      del.onclick = async function(){ if (!window.confirm('Delete “' + v.title + '”? The file is removed too.')) return; try { await api('DELETE', '/admin/api/daily/videos/' + v.id); toast('Deleted'); load(); } catch (e) { toast(e.message, true); } };
      var state = v.hidden ? h('span', { class: 'chip mut', text: 'Hidden' }) : v.publishOn > d.today ? h('span', { class: 'chip gold', text: 'Scheduled' }) : h('span', { class: 'chip', text: 'Live' });
      videoList.appendChild(h('div', { class: 'card row' }, [
        v.poster ? h('img', { src: v.poster, alt: '', style: 'width:48px;height:72px;border-radius:8px;object-fit:cover;flex:none;background:#000' }) : h('div', { class: 'avatar', style: 'border-radius:8px;width:48px;height:72px' }),
        h('div', { class: 'grow' }, [h('div', {}, [state, ' ', h('b', { text: v.title })]), h('div', { class: 'meta', text: [v.description, fmtDur(v.durationSec)].filter(Boolean).join(' · ') }), v.videoUrl ? h('a', { href: v.videoUrl, target: '_blank', rel: 'noopener', class: 'meta', text: 'Open file' }) : null]),
        dIn, hide, del,
      ]));
    });
  }
  load();
});

window.registerAdminTab('Watch on Today', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  box.appendChild(h('h2', { class: 'serif', text: 'Watch on Today' }));
  box.appendChild(h('p', { class: 'sub', text: 'The “Watch: From Our Channels” row on Today shows the latest videos of the channels added in the YouTube channels tab (read from YouTube’s public feeds, refreshed about every 30 minutes). Choose per channel whether to show its uploads or one playlist, leave out Shorts, or hide single videos. Videos play with YouTube’s official player.' }));
  var refresh = h('button', { class: 'btn', text: 'Refresh now' });
  var status = h('span', { class: 'meta' });
  box.appendChild(h('div', { class: 'row', style: 'margin-bottom:12px' }, [refresh, status]));
  var chans = h('div'); var hideBox = h('div'); var latest = h('div');
  box.appendChild(h('h3', { class: 'serif', text: 'Channels' })); box.appendChild(chans);
  box.appendChild(h('h3', { class: 'serif', text: 'Hidden videos' }));
  var hideIn = h('input', { class: 'grow', placeholder: 'YouTube link or video id to hide from Today' });
  var hideBtn = h('button', { class: 'btn ghost', text: 'Hide' });
  box.appendChild(h('div', { class: 'card row' }, [hideIn, hideBtn]));
  box.appendChild(hideBox);
  box.appendChild(h('h3', { class: 'serif', text: 'Showing on Today now' })); box.appendChild(latest);
  async function hideVideo(id, title){ try { await api('POST', '/admin/api/youtube/today/hidden', { video: id, title: title }); toast('Hidden from Today'); load(); } catch (e) { toast(e.message, true); } }
  hideBtn.onclick = function(){ if (!hideIn.value.trim()) return; hideVideo(hideIn.value.trim()); hideIn.value = ''; };
  refresh.onclick = async function(){ refresh.disabled = true; status.textContent = 'Reading the channel feeds…'; try { var r = await api('POST', '/admin/api/youtube/today/refresh', {}); status.textContent = r.items.length + ' video(s) from ' + r.groups.length + ' channel(s)'; load(); } catch (e) { status.textContent = ''; toast(e.message, true); } refresh.disabled = false; };
  async function load(){
    var d; try { d = await api('GET', '/admin/api/youtube/today'); } catch (e) { chans.textContent = e.message; return; }
    chans.innerHTML = '';
    if (!d.channels.length) chans.appendChild(h('div', { class: 'card empty', text: 'No channels yet — add them in the YouTube channels tab.' }));
    d.channels.forEach(function(ch){
      var show = h('input', { type: 'checkbox' }); show.checked = ch.showOnToday;
      var src = h('select', {}, [h('option', { value: 'uploads', text: 'Latest uploads' }), h('option', { value: 'playlist', text: 'One playlist' })]); src.value = ch.source;
      var pl = h('input', { placeholder: 'Playlist link or id (PL…)', style: 'min-width:240px', value: ch.playlistId || '' });
      var shorts = h('input', { type: 'checkbox' }); shorts.checked = ch.shorts;
      var save = h('button', { class: 'btn small', text: 'Save' });
      pl.style.display = ch.source === 'playlist' ? '' : 'none';
      src.onchange = function(){ pl.style.display = src.value === 'playlist' ? '' : 'none'; };
      save.onclick = async function(){ save.disabled = true; try { await api('PATCH', '/admin/api/youtube/today/channels/' + ch.id, { showOnToday: show.checked, source: src.value, playlistId: pl.value.trim(), shorts: shorts.checked }); toast('Saved — Today updates on the next refresh'); load(); } catch (e) { toast(e.message, true); } save.disabled = false; };
      chans.appendChild(h('div', { class: 'card row', style: ch.active ? '' : 'opacity:.55' }, [
        ch.avatarUrl ? h('img', { class: 'avatar', src: ch.avatarUrl, alt: '' }) : h('div', { class: 'avatar' }),
        h('div', { class: 'grow' }, [h('b', { text: ch.title }), h('div', { class: 'meta', text: ch.active ? (ch.handle ? '@' + ch.handle : ch.channelId) : 'Inactive in the YouTube channels tab' })]),
        h('label', { class: 'row meta', style: 'gap:6px' }, [show, 'On Today']), src, pl,
        h('label', { class: 'row meta', style: 'gap:6px' }, [shorts, 'Include Shorts']), save,
      ]));
    });
    hideBox.innerHTML = '';
    if (!d.hidden.length) hideBox.appendChild(h('div', { class: 'meta', style: 'margin-bottom:10px', text: 'No hidden videos.' }));
    d.hidden.forEach(function(x){
      var un = h('button', { class: 'btn ghost small', text: 'Unhide' });
      un.onclick = async function(){ try { await api('DELETE', '/admin/api/youtube/today/hidden/' + encodeURIComponent(x.videoId)); toast('Back on Today'); load(); } catch (e) { toast(e.message, true); } };
      hideBox.appendChild(h('div', { class: 'card row' }, [h('div', { class: 'grow' }, [h('b', { text: x.title || x.videoId }), h('div', { class: 'meta', text: x.videoId })]), un]));
    });
    latest.innerHTML = '';
    var items = (d.latest && d.latest.items) || [];
    if (d.latest && d.latest.fetchedAt) status.textContent = status.textContent || ('Last read ' + new Date(d.latest.fetchedAt).toLocaleString());
    if (!items.length) latest.appendChild(h('div', { class: 'card empty', text: 'Nothing to show yet.' }));
    items.forEach(function(v){
      var hb = h('button', { class: 'btn ghost small', text: 'Hide' }); hb.onclick = function(){ hideVideo(v.videoId, v.title); };
      latest.appendChild(h('div', { class: 'card row' }, [
        h('img', { src: v.thumbnail, alt: '', style: 'width:112px;height:63px;border-radius:8px;object-fit:cover;flex:none' }),
        h('div', { class: 'grow' }, [h('b', { text: v.title }), h('div', { class: 'meta', text: v.channel.title + (v.published ? ' · ' + new Date(v.published).toLocaleDateString() : '') + (v.isShort ? ' · Short' : '') })]),
        h('a', { href: v.url, target: '_blank', rel: 'noopener', class: 'meta', text: 'YouTube' }), hb,
      ]));
    });
  }
  load();
});
})();
`;
