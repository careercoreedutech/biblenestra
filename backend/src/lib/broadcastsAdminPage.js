// The "Broadcasts" tab of the /admin dashboard (BROADCASTS, brief 11.1 + 7.6). Registered with registerAdminScript()
// (see routes/admin.js). Two separate actions — Broadcast to All Users (inbox + push) | Broadcast to Socials — with a
// composer (text, images, video, links), a phone-style preview, Send now / Schedule (time zone, repeat daily),
// history with status, delivery and read stats.
// NOTE: plain JS in a string — no backticks or "${" inside, and backslashes are doubled.
export const BROADCASTS_ADMIN_SCRIPT = `
(function(){
if (!window.registerAdminTab) return;

var css = document.createElement('style');
css.textContent = [
  '.bc-modes{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:6px 0 16px}',
  '.bc-mode{text-align:left;border:2px solid var(--border);background:var(--surface);border-radius:16px;padding:14px 16px;cursor:pointer;font:inherit;color:var(--fg)}',
  '.bc-mode b{display:block;font-size:15.5px;margin-bottom:3px}.bc-mode span{color:var(--muted);font-size:12.5px}',
  '.bc-mode.on{border-color:var(--primary);background:var(--primarySoft)}',
  '.bc-grid{display:grid;grid-template-columns:minmax(0,1.25fr) 330px;gap:18px;align-items:start}@media(max-width:900px){.bc-grid{grid-template-columns:1fr}.bc-modes{grid-template-columns:1fr}}',
  '.bc-f{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:12px 0 4px}',
  '.bc-in{width:100%;box-sizing:border-box;border:1px solid var(--border);background:var(--raised);border-radius:10px;padding:9px 12px;font:inherit;color:var(--fg)}',
  'textarea.bc-in{min-height:120px;resize:vertical;line-height:1.45}',
  '.bc-att{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}',
  '.bc-thumb{position:relative;width:78px;height:78px;border-radius:10px;overflow:hidden;background:var(--raised);border:1px solid var(--border);font-size:11px;color:var(--muted);display:flex;align-items:center;justify-content:center;text-align:center}',
  '.bc-thumb img,.bc-thumb video{width:100%;height:100%;object-fit:cover}',
  '.bc-thumb button{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:10px;border:0;background:rgba(21,23,43,.75);color:#fff;cursor:pointer;font-size:12px;line-height:20px;padding:0}',
  '.bc-link{display:grid;grid-template-columns:1fr 150px auto;gap:8px;margin-top:8px}',
  '.bc-phone{position:sticky;top:12px;width:310px;margin:0 auto;border-radius:38px;background:#15172B;padding:12px;box-shadow:0 12px 30px rgba(21,23,43,.25)}',
  '.bc-screen{background:#F6F2EA;border-radius:28px;height:600px;overflow:auto;padding:14px 12px;box-sizing:border-box}',
  '.bc-notch{width:90px;height:20px;border-radius:12px;background:#15172B;margin:-6px auto 10px}',
  '.bc-lbl{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#A1978A;margin:12px 2px 6px}',
  '.bc-push{background:rgba(255,255,255,.92);border-radius:16px;padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-size:12.5px}',
  '.bc-card{background:#fff;border:1px solid #E7DFD1;border-radius:16px;padding:12px;font-size:13px;color:#1C1915}',
  '.bc-who{display:flex;align-items:center;gap:8px}.bc-who img{width:34px;height:34px;border-radius:17px;flex:none}',
  '.bc-name{font-weight:800;font-size:13px;display:flex;align-items:center;gap:4px}',
  '.bc-tick{display:inline-flex;width:14px;height:14px;border-radius:7px;background:#D4A852;color:#15172B;font-size:9px;font-weight:900;align-items:center;justify-content:center}',
  '.bc-txt{white-space:pre-wrap;word-break:break-word;line-height:1.45;margin-top:8px}.bc-txt a{color:#2E3A87;font-weight:600}',
  '.bc-imgs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;border-radius:12px;overflow:hidden}.bc-imgs img{width:100%;height:110px;object-fit:cover;display:block}.bc-imgs img:only-child{grid-column:span 2;height:170px}',
  '.bc-vid{position:relative;margin-top:8px;border-radius:12px;overflow:hidden;background:#15172B;height:170px}.bc-vid video,.bc-vid img{width:100%;height:100%;object-fit:cover}',
  '.bc-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:30px;text-shadow:0 2px 8px rgba(0,0,0,.5)}',
  '.bc-lc{display:block;margin-top:8px;border:1px solid #E7DFD1;border-radius:12px;overflow:hidden;text-decoration:none;color:#1C1915;background:#F0EBE1}',
  '.bc-lc img{width:100%;height:110px;object-fit:cover;display:block}.bc-lc div{padding:8px 10px}.bc-lc small{color:#6B6255;display:block}',
  '.bc-btn{display:block;text-align:center;margin-top:8px;background:#2E3A87;color:#fff;border-radius:999px;padding:8px;font-weight:700;font-size:12.5px;text-decoration:none}',
  '.bc-stats{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}.bc-stat b{display:block;font-size:17px}.bc-stat span{font-size:11.5px;color:var(--faint)}',
  '.bc-pills{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0 12px}',
  '.bc-pill{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:6px 12px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;color:var(--fg)}.bc-pill.on{background:var(--primary);border-color:var(--primary);color:#fff}',
].join('');
document.head.appendChild(css);

// the official mark used when BROADCAST_SENDER_LOGO_URL isn't set (the app uses its bundled icon)
var LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#2E3A87"/><path d="M14 22c6-2 12-1 17 3v22c-5-4-11-5-17-3z" fill="#F4EFE6"/><path d="M50 22c-6-2-12-1-17 3v22c5-4 11-5 17-3z" fill="#F4EFE6"/><rect x="30.5" y="10" width="3" height="14" rx="1.2" fill="#D4A852"/><rect x="26" y="14" width="12" height="3" rx="1.2" fill="#D4A852"/></svg>');

function uuid(){ try { return crypto.randomUUID(); } catch (e) { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); } }
function when(s){ if (!s) return '—'; return new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function pct(a, b){ return b ? Math.round(a * 100 / b) + '%' : '—'; }

async function authHeaders(){
  var h = { 'Accept': 'application/json' };
  var tk = localStorage.getItem('bnAdminToken');
  if (tk) { h['Authorization'] = 'Bearer ' + tk; return h; }
  var dev = localStorage.getItem('bnAdminDevUser');
  if (dev && window.__ADMIN__ && window.__ADMIN__.devMode) { h['X-Dev-User'] = dev; return h; }
  try { if (window.Clerk && window.Clerk.session) { var t = await window.Clerk.session.getToken(); if (t) h['Authorization'] = 'Bearer ' + t; } } catch (e) {}
  return h;
}
function send(method, path, data, type, onProgress){
  return new Promise(async function(resolve, reject){
    var xhr = new XMLHttpRequest();
    xhr.open(method, path);
    var h = await authHeaders();
    Object.keys(h).forEach(function(k){ xhr.setRequestHeader(k, h[k]); });
    if (type) xhr.setRequestHeader('Content-Type', type);
    if (xhr.upload) xhr.upload.onprogress = function(e){ if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = function(){ var d = null; try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(d); else reject(new Error((d && d.error) || ('Upload failed (' + xhr.status + ')'))); };
    xhr.onerror = function(){ reject(new Error('Upload failed — check the connection')); };
    xhr.send(data);
  });
}
function readVideo(file){
  // duration, size and a poster frame (the element is muted and never played)
  return new Promise(function(resolve){
    var v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.playsInline = true;
    var url = URL.createObjectURL(file); var done = false;
    function finish(blob){ if (done) return; done = true; resolve({ duration: v.duration || 0, width: v.videoWidth || null, height: v.videoHeight || null, poster: blob || null, url: url }); }
    v.onloadedmetadata = function(){ try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { finish(null); } };
    v.onseeked = function(){
      try { var c = document.createElement('canvas'); c.width = Math.min(720, v.videoWidth || 720); c.height = Math.round(c.width * ((v.videoHeight || 405) / (v.videoWidth || 720)));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob(function(b){ finish(b); }, 'image/jpeg', 0.82); } catch (e) { finish(null); }
    };
    v.onerror = function(){ finish(null); };
    setTimeout(function(){ finish(null); }, 8000);
    v.src = url;
  });
}

window.registerAdminTab('Broadcasts', function(box, ctx){
  var h = ctx.h, api = ctx.api, toast = ctx.toast;
  var info = { sender: { name: 'BibleNestra', logoUrl: null }, audience: { users: 0, devices: 0 }, duplicateWindowMinutes: 10 };
  var st = null; // composer state
  function freshState(target){ return { target: target || 'inbox', key: uuid(), title: '', text: '', media: [], links: [], pin: false, scheduled: false, date: '', time: '', tz: '', repeat: false, busy: false }; }
  st = freshState('inbox');

  box.appendChild(h('h2', { class: 'serif', text: 'Broadcasts' }));
  box.appendChild(h('p', { class: 'sub', text: 'Send an official message to every user’s inbox (with a push notification), or publish a post to the Socials feed as the official verified account. Send now or schedule it; every send happens once — double clicks and retries are ignored.' }));
  var senderLine = h('div', { class: 'card row' });
  box.appendChild(senderLine);

  var modeInbox = h('button', { class: 'bc-mode' }, [h('b', { text: '📥 Broadcast to All Users' }), h('span', { text: 'A message in every user’s inbox + a push notification' })]);
  var modeSocial = h('button', { class: 'bc-mode' }, [h('b', { text: '📣 Broadcast to Socials' }), h('span', { text: 'A post on the Socials feed from the official account, optionally pinned' })]);
  box.appendChild(h('div', { class: 'bc-modes' }, [modeInbox, modeSocial]));
  modeInbox.onclick = function(){ if (st.busy) return; st.target = 'inbox'; st.pin = false; drawComposer(); };
  modeSocial.onclick = function(){ if (st.busy) return; st.target = 'socials'; drawComposer(); };

  var composer = h('div', { class: 'card' });
  var phone = h('div');
  box.appendChild(h('div', { class: 'bc-grid' }, [composer, phone]));

  box.appendChild(h('h3', { class: 'serif', style: 'margin-top:22px', text: 'History' }));
  var filter = 'all';
  var pills = h('div', { class: 'bc-pills' });
  var list = h('div');
  box.appendChild(pills); box.appendChild(list);

  function senderInfo(){
    senderLine.innerHTML = '';
    senderLine.appendChild(h('img', { src: info.sender.logoUrl || LOGO, alt: '', style: 'width:38px;height:38px;border-radius:19px' }));
    senderLine.appendChild(h('div', { class: 'grow' }, [
      h('div', { class: 'bc-name' }, ['Sent as ' + info.sender.name + ' ', h('span', { class: 'bc-tick', text: '✓' })]),
      h('div', { class: 'meta', text: 'Sender name comes from the BROADCAST_SENDER_NAME setting (default “BibleNestra”). Audience now: ' + info.audience.users + ' user(s) · ' + info.audience.devices + ' phone(s) with push on. Banned users are skipped.' }),
    ]));
  }

  // ---------------- composer ----------------
  function field(label, el){ return h('div', {}, [h('label', { class: 'bc-f', text: label }), el]); }
  function drawComposer(){
    modeInbox.className = 'bc-mode' + (st.target === 'inbox' ? ' on' : '');
    modeSocial.className = 'bc-mode' + (st.target === 'socials' ? ' on' : '');
    composer.innerHTML = '';
    var inbox = st.target === 'inbox';
    composer.appendChild(h('h3', { class: 'serif', style: 'margin:0 0 4px', text: inbox ? 'Message to all users' : 'Post to Socials' }));
    composer.appendChild(h('div', { class: 'meta', text: inbox ? 'Arrives in every user’s inbox (Activity) and as a push notification on their phone (unless they turned official messages off).' : 'Appears in everyone’s Socials feed from the official verified account.' }));

    var title = h('input', { class: 'bc-in', maxlength: '120', placeholder: inbox ? 'e.g. Good morning!' : 'Optional headline (first line of the post)', value: st.title });
    title.oninput = function(){ st.title = title.value; drawPhone(); };
    composer.appendChild(field(inbox ? 'Title (bold, also the push title) — optional' : 'Headline — optional', title));

    var text = h('textarea', { class: 'bc-in', maxlength: '5000', placeholder: 'May God’s grace and favour accompany you today. Links like https://… become clickable.' });
    text.value = st.text;
    var count = h('div', { class: 'meta', style: 'text-align:right', text: st.text.length + ' / 5000' });
    text.oninput = function(){ st.text = text.value; count.textContent = st.text.length + ' / 5000'; drawPhone(); };
    composer.appendChild(field('Message', text)); composer.appendChild(count);

    // attachments
    var att = h('div', { class: 'bc-att' });
    var imgIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, style: 'display:none' });
    var vidIn = h('input', { type: 'file', accept: 'video/mp4,video/quicktime', style: 'display:none' });
    var addImg = h('button', { class: 'btn ghost small', text: '＋ Images' });
    var addVid = h('button', { class: 'btn ghost small', text: '＋ Video' });
    addImg.onclick = function(){ imgIn.click(); };
    addVid.onclick = function(){ vidIn.click(); };
    imgIn.onchange = function(){ Array.prototype.forEach.call(imgIn.files, uploadImage); imgIn.value = ''; };
    vidIn.onchange = function(){ if (vidIn.files[0]) uploadVideo(vidIn.files[0]); vidIn.value = ''; };
    composer.appendChild(h('label', { class: 'bc-f', text: 'Images and video' }));
    composer.appendChild(h('div', { class: 'row' }, [addImg, addVid, imgIn, vidIn, h('span', { class: 'meta', text: inbox ? 'Up to 4 images and 1 video.' : 'Up to 10 images, or 1 video.' })]));
    st.media.forEach(function(m, i){
      var rm = h('button', { text: '×', title: 'Remove' });
      rm.onclick = function(){ st.media.splice(i, 1); drawComposer(); };
      var inner = m.status !== 'ready' ? h('span', { text: m.status === 'error' ? 'Failed' : (m.progress || 'Uploading…') })
        : m.type === 'image' ? h('img', { src: m.preview || m.url, alt: '' })
        : (m.poster ? h('img', { src: m.poster, alt: '' }) : h('span', { text: '🎬 Video' }));
      att.appendChild(h('div', { class: 'bc-thumb' }, [inner, rm]));
    });
    composer.appendChild(att);

    // links
    composer.appendChild(h('label', { class: 'bc-f', text: 'Links (up to 3) — shown as tappable cards with a preview' }));
    st.links.forEach(function(l, i){
      var u = h('input', { class: 'bc-in', placeholder: 'https://…', value: l.url });
      var lab = h('input', { class: 'bc-in', maxlength: '40', placeholder: 'Button text (optional)', value: l.label || '' });
      var rm = h('button', { class: 'btn ghost small', text: 'Remove' });
      u.oninput = function(){ l.url = u.value.trim(); l.preview = null; drawPhone(); };
      u.onchange = function(){ fetchPreview(l); };
      lab.oninput = function(){ l.label = lab.value; drawPhone(); };
      rm.onclick = function(){ st.links.splice(i, 1); drawComposer(); };
      composer.appendChild(h('div', { class: 'bc-link' }, [u, lab, rm]));
    });
    if (st.links.length < 3) {
      var addL = h('button', { class: 'btn ghost small', style: 'margin-top:8px', text: '＋ Add link' });
      addL.onclick = function(){ st.links.push({ url: '', label: '' }); drawComposer(); };
      composer.appendChild(addL);
    }

    if (!inbox) {
      var pin = h('input', { type: 'checkbox' }); pin.checked = st.pin;
      pin.onchange = function(){ st.pin = pin.checked; drawPhone(); };
      composer.appendChild(h('label', { class: 'row', style: 'margin-top:14px;gap:8px;font-weight:600' }, [pin, h('span', { text: '📌 Pin to the top of the Socials feed' })]));
    }

    // when
    composer.appendChild(h('label', { class: 'bc-f', text: 'When' }));
    var now = h('input', { type: 'radio', name: 'bc-when' }); now.checked = !st.scheduled;
    var later = h('input', { type: 'radio', name: 'bc-when' }); later.checked = st.scheduled;
    now.onchange = function(){ st.scheduled = false; drawComposer(); };
    later.onchange = function(){ st.scheduled = true; drawComposer(); };
    composer.appendChild(h('div', { class: 'row' }, [h('label', { class: 'row', style: 'gap:6px' }, [now, 'Send now']), h('label', { class: 'row', style: 'gap:6px' }, [later, 'Schedule'])]));
    if (st.scheduled) {
      if (!st.date) { var d = new Date(Date.now() + 3600e3); st.date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); st.time = String(d.getHours()).padStart(2, '0') + ':00'; }
      if (!st.tz) { try { st.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { st.tz = 'UTC'; } }
      var date = h('input', { type: 'date', class: 'bc-in', value: st.date, style: 'width:auto' });
      var time = h('input', { type: 'time', class: 'bc-in', value: st.time, style: 'width:auto' });
      var zones = []; try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) {}
      if (!zones.length) zones = ['UTC', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Manila', 'Australia/Sydney'];
      if (zones.indexOf('UTC') === -1) zones.unshift('UTC');
      if (zones.indexOf(st.tz) === -1) zones.unshift(st.tz);
      var tz = h('select', { class: 'bc-in', style: 'width:auto;max-width:220px' }, zones.map(function(z){ return h('option', { value: z, text: z }); }));
      tz.value = st.tz;
      date.onchange = function(){ st.date = date.value; drawSendLabel(); };
      time.onchange = function(){ st.time = time.value; drawSendLabel(); };
      tz.onchange = function(){ st.tz = tz.value; drawSendLabel(); };
      var rep = h('input', { type: 'checkbox' }); rep.checked = st.repeat;
      rep.onchange = function(){ st.repeat = rep.checked; drawSendLabel(); };
      composer.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, [date, time, tz]));
      composer.appendChild(h('label', { class: 'row', style: 'margin-top:8px;gap:8px' }, [rep, h('span', { text: 'Repeat every day at this time' })]));
      composer.appendChild(h('div', { class: 'meta', style: 'margin-top:4px', text: 'Scheduled broadcasts go out within 15 minutes of the chosen time (the server checks every 15 minutes).' }));
    }

    sendBtn = h('button', { class: 'btn', style: 'margin-top:16px' });
    sendStatus = h('span', { class: 'meta' });
    sendBtn.onclick = submit;
    var clear = h('button', { class: 'btn ghost', style: 'margin-top:16px', text: 'Clear' });
    clear.onclick = function(){ if (st.busy) return; st = freshState(st.target); drawComposer(); };
    composer.appendChild(h('div', { class: 'row' }, [sendBtn, clear, sendStatus]));
    drawSendLabel();
    drawPhone();
  }
  var sendBtn, sendStatus;
  function drawSendLabel(){
    if (!sendBtn) return;
    var inbox = st.target === 'inbox';
    sendBtn.textContent = st.busy ? 'Sending…' : st.scheduled ? (st.repeat ? 'Schedule daily' : 'Schedule') : (inbox ? 'Send to all users now' : 'Publish to Socials now');
    sendBtn.disabled = st.busy || st.media.some(function(m){ return m.status !== 'ready'; });
  }

  async function fetchPreview(l){
    if (!l.url || l.url.indexOf('http') !== 0) return;
    try { l.preview = await api('POST', '/admin/api/broadcasts/link-preview', { url: l.url }); drawPhone(); } catch (e) { /* preview optional */ }
  }

  async function uploadImage(file){
    var m = { type: 'image', status: 'uploading', preview: URL.createObjectURL(file) };
    st.media.push(m); drawComposer();
    try {
      var r = await send('POST', '/uploads/image', file, file.type || 'image/jpeg', function(p){ m.progress = Math.round(p * 100) + '%'; });
      m.key = r.key; m.url = r.url; m.status = 'ready';
      try { var im = new Image(); im.onload = function(){ m.width = im.naturalWidth; m.height = im.naturalHeight; }; im.src = m.preview; } catch (e) {}
    } catch (e) { m.status = 'error'; toast(e.message, true); }
    drawComposer();
  }

  async function uploadVideo(file){
    if (st.media.some(function(x){ return x.type === 'video'; })) { toast('Attach one video at a time — remove the current one first', true); return; }
    var m = { type: 'video', status: 'uploading', progress: 'Reading…' };
    st.media.push(m); drawComposer();
    try {
      var meta = await readVideo(file);
      m.poster = meta.poster ? URL.createObjectURL(meta.poster) : null; m.src = meta.url;
      var up = await api('POST', '/uploads/video', { durationSeconds: Math.round(meta.duration || 0), sizeBytes: file.size, width: meta.width, height: meta.height });
      var prog = function(p){ m.progress = Math.round(p * 100) + '%'; drawSendLabel(); var el = composer.querySelector('.bc-thumb span'); if (el && m.status === 'uploading') el.textContent = m.progress; };
      if (file.size <= up.singlePutMaxBytes) {
        await send('PUT', up.uploadURL, file, file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4', prog);
      } else {
        var mp = await api('POST', up.multipartURL, {});
        var parts = []; var n = Math.ceil(file.size / mp.partSize);
        for (var i = 0; i < n; i++) {
          var blob = file.slice(i * mp.partSize, Math.min(file.size, (i + 1) * mp.partSize));
          var pr = await send('PUT', up.multipartURL + '/' + encodeURIComponent(mp.uploadId) + '/parts/' + (i + 1), blob, 'application/octet-stream');
          parts.push({ partNumber: pr.partNumber, etag: pr.etag }); prog((i + 1) / n);
        }
        await api('POST', up.multipartURL + '/' + encodeURIComponent(mp.uploadId) + '/complete', { parts: parts });
      }
      if (meta.poster) { try { await send('PUT', up.thumbnailURL, meta.poster, 'image/jpeg'); } catch (e) { /* poster optional */ } }
      m.uid = up.uid; m.status = 'ready';
    } catch (e) { m.status = 'error'; toast(e.message, true); }
    drawComposer();
  }

  function payload(){
    var p = {
      idempotencyKey: st.key, target: st.target, title: st.title.trim(), text: st.text.trim(), pin: st.target === 'socials' && st.pin,
      media: st.media.filter(function(m){ return m.status === 'ready'; }).map(function(m){ return m.type === 'image' ? { type: 'image', key: m.key, width: m.width, height: m.height } : { type: 'video', uid: m.uid }; }),
      links: st.links.filter(function(l){ return l.url; }).map(function(l){ return { url: l.url, label: (l.label || '').trim() || undefined }; }),
    };
    if (st.scheduled) p.schedule = { date: st.date, time: st.time, timezone: st.tz, repeatDaily: st.repeat };
    return p;
  }

  async function submit(){
    if (st.busy) return; // a second click while the first is in flight does nothing
    if (!st.text.trim() && !st.title.trim() && !st.media.length) { toast('Write a message or attach a photo or video', true); return; }
    var inbox = st.target === 'inbox';
    var q = st.scheduled ? 'Schedule this ' + (inbox ? 'message to all users' : 'Socials post') + ' for ' + st.date + ' ' + st.time + ' (' + st.tz + ')' + (st.repeat ? ', repeating every day' : '') + '?'
      : inbox ? 'Send this message to all ' + info.audience.users + ' users now? It can’t be unsent.' : 'Publish this post to the Socials feed now' + (st.pin ? ' and pin it to the top' : '') + '?';
    if (!window.confirm(q)) return;
    st.busy = true; drawSendLabel(); sendStatus.textContent = 'Sending…';
    try {
      var r = await api('POST', '/admin/api/broadcasts', payload());
      var msg = r.duplicate ? 'Already sent — this was a repeat of the same send, nothing new went out.'
        : r.status === 'scheduled' ? 'Scheduled for ' + when(r.scheduledAt) + (r.repeatDaily ? ' (repeats daily)' : '')
        : r.target === 'socials' ? 'Published to Socials' + (r.pinned ? ' and pinned' : '')
        : 'Sent to ' + r.stats.recipients + ' inbox(es) · ' + r.stats.pushSent + ' push' + (r.status === 'sending' ? ' — still sending to the rest in the background' : '');
      toast(r.duplicate ? 'Already sent' : 'Done');
      st = freshState(st.target); drawComposer(); sendStatus.textContent = msg;
      load();
    } catch (e) {
      st.busy = false; drawSendLabel(); sendStatus.textContent = '';
      toast(e.message, true);
      // a network failure keeps the same idempotency key, so pressing Send again can never send twice
    }
  }

  // ---------------- phone preview ----------------
  function linkify(text, onLink){
    var out = h('div', { class: 'bc-txt' });
    var re = /(https?:\\/\\/[^\\s]+)/g; var last = 0; var m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.appendChild(document.createTextNode(text.slice(last, m.index)));
      out.appendChild(h('a', { href: m[1], target: '_blank', rel: 'noopener', text: m[1] }));
      last = m.index + m[1].length;
    }
    if (last < text.length) out.appendChild(document.createTextNode(text.slice(last)));
    return out;
  }
  function who(sub){
    return h('div', { class: 'bc-who' }, [h('img', { src: info.sender.logoUrl || LOGO, alt: '' }), h('div', {}, [
      h('div', { class: 'bc-name' }, [info.sender.name, h('span', { class: 'bc-tick', text: '✓' })]),
      h('div', { style: 'font-size:11px;color:#A1978A', text: sub }),
    ])]);
  }
  function mediaBlock(){
    var kids = [];
    var imgs = st.media.filter(function(m){ return m.type === 'image' && m.status !== 'error'; });
    var vid = st.media.filter(function(m){ return m.type === 'video' && m.status !== 'error'; })[0];
    if (imgs.length) kids.push(h('div', { class: 'bc-imgs' }, imgs.slice(0, 4).map(function(m){ return h('img', { src: m.preview || m.url, alt: '' }); })));
    if (vid) {
      var v = vid.poster ? h('img', { src: vid.poster, alt: '' }) : h('div');
      kids.push(h('div', { class: 'bc-vid' }, [v, h('div', { class: 'bc-play', text: '▶' })]));
    }
    return kids;
  }
  function linkCards(){
    return st.links.filter(function(l){ return l.url; }).map(function(l){
      var p = l.preview || {};
      if (l.label) return h('a', { class: 'bc-btn', href: l.url, target: '_blank', rel: 'noopener', text: l.label });
      return h('a', { class: 'bc-lc', href: l.url, target: '_blank', rel: 'noopener' }, [p.image ? h('img', { src: p.image, alt: '' }) : null,
        h('div', {}, [h('b', { text: p.title || l.url }), h('small', { text: p.host || (l.url.split('/')[2] || '') })])]);
    });
  }
  function drawPhone(){
    phone.innerHTML = '';
    var scr = h('div', { class: 'bc-screen' });
    phone.appendChild(h('div', { class: 'bc-phone' }, [h('div', { class: 'bc-notch' }), scr]));
    var text = st.text.trim(); var title = st.title.trim();
    var empty = !text && !title && !st.media.length;
    if (st.target === 'inbox') {
      scr.appendChild(h('div', { class: 'bc-lbl', text: 'Push notification' }));
      var body = text || (st.media.some(function(m){ return m.type === 'video'; }) ? 'Shared a video with you' : st.media.length ? 'Shared a photo with you' : 'Your message…');
      scr.appendChild(h('div', { class: 'bc-push' }, [h('div', { class: 'row', style: 'gap:6px' }, [h('img', { src: info.sender.logoUrl || LOGO, alt: '', style: 'width:18px;height:18px;border-radius:5px' }), h('b', { text: 'BibleNestra' }), h('span', { class: 'meta', style: 'margin-left:auto', text: 'now' })]),
        h('div', { style: 'font-weight:700;margin-top:4px', text: title ? info.sender.name + ': ' + title : info.sender.name }), h('div', { text: body.length > 110 ? body.slice(0, 108) + '…' : body })]));
      scr.appendChild(h('div', { class: 'bc-lbl', text: 'Inbox (Activity)' }));
      scr.appendChild(h('div', { class: 'bc-card' }, [who('Official message · now'), title ? h('div', { style: 'font-weight:800;margin-top:8px', text: title }) : null,
        h('div', { style: 'margin-top:4px;color:#6B6255;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden', text: body })]));
      scr.appendChild(h('div', { class: 'bc-lbl', text: 'Opened' }));
      var kids = [who('Official message · now')];
      if (title) kids.push(h('div', { style: 'font-weight:800;font-size:15px;margin-top:10px', text: title }));
      if (text) kids.push(linkify(text)); else if (empty) kids.push(h('div', { class: 'bc-txt', style: 'color:#A1978A', text: 'Your message…' }));
      scr.appendChild(h('div', { class: 'bc-card' }, kids.concat(mediaBlock(), linkCards())));
    } else {
      scr.appendChild(h('div', { class: 'bc-lbl', text: 'Socials feed' + (st.pin ? ' · pinned on top' : '') }));
      var k2 = [h('div', { class: 'row', style: 'gap:6px' }, [who('Official account · now'), st.pin ? h('span', { class: 'chip gold', style: 'margin-left:auto', text: '📌 Pinned' }) : null])];
      var txt = (title ? title + (text ? String.fromCharCode(10, 10) : '') : '') + text;
      if (txt) k2.push(linkify(txt)); else k2.push(h('div', { class: 'bc-txt', style: 'color:#A1978A', text: 'Your post…' }));
      k2 = k2.concat(mediaBlock(), linkCards());
      k2.push(h('div', { class: 'row', style: 'margin-top:10px;color:#6B6255;font-size:12px;gap:16px', text: '♡ Like    💬 Comment    ↗ Share' }));
      scr.appendChild(h('div', { class: 'bc-card' }, k2));
      scr.appendChild(h('div', { class: 'bc-card', style: 'margin-top:10px;opacity:.45' }, [h('div', { text: 'Other posts…' })]));
    }
  }

  // ---------------- history ----------------
  function drawPills(){
    pills.innerHTML = '';
    [['all', 'All'], ['inbox', 'All users (inbox)'], ['socials', 'Socials'], ['scheduled', 'Scheduled']].forEach(function(p){
      var b = h('button', { class: 'bc-pill' + (filter === p[0] ? ' on' : ''), text: p[1] });
      b.onclick = function(){ filter = p[0]; drawPills(); load(); };
      pills.appendChild(b);
    });
    var refresh = h('button', { class: 'btn ghost small', style: 'margin-left:auto', text: 'Refresh' });
    refresh.onclick = load;
    var run = h('button', { class: 'btn ghost small', text: 'Run scheduler now' });
    run.onclick = async function(){ run.disabled = true; try { var r = await api('POST', '/admin/api/broadcasts/run', {}); toast('Scheduler ran: ' + r.started + ' started, ' + r.repeated + ' daily, ' + r.continued + ' processed'); load(); } catch (e) { toast(e.message, true); } run.disabled = false; };
    pills.appendChild(refresh); pills.appendChild(run);
  }
  function statusChip(b){
    var map = { scheduled: ['Scheduled', 'gold'], sending: ['Sending…', ''], sent: [b.target === 'socials' ? 'Published' : 'Sent', ''], failed: ['Failed', 'neg'], cancelled: ['Cancelled', 'mut'] };
    var m = map[b.status] || [b.status, 'mut'];
    if (b.repeatDaily && b.status === 'scheduled') m = ['Repeats daily', 'gold'];
    return h('span', { class: 'chip ' + m[1], text: m[0] });
  }
  function stat(n, label){ return h('div', { class: 'bc-stat' }, [h('b', { text: String(n) }), h('span', { text: label })]); }
  var timer = null;
  async function load(){
    var d;
    try { d = await api('GET', '/admin/api/broadcasts' + (filter === 'all' ? '' : '?target=' + filter)); } catch (e) { list.innerHTML = ''; list.appendChild(h('div', { class: 'card', text: e.message })); return; }
    info = d; senderInfo(); drawPhone(); drawSendLabel();
    list.innerHTML = '';
    if (!d.items.length) list.appendChild(h('div', { class: 'card empty', text: 'No broadcasts yet.' }));
    d.items.forEach(function(b){
      var s = b.stats; var inbox = b.target === 'inbox';
      var head = h('div', { class: 'row' }, [statusChip(b), h('span', { class: 'chip mut', text: inbox ? 'All users' : 'Socials' }), b.pin ? h('span', { class: 'chip gold', text: b.pinned ? '📌 Pinned' : 'Was pinned' }) : null,
        b.parentId ? h('span', { class: 'chip mut', text: 'Daily copy' }) : null,
        h('b', { class: 'grow', text: b.title || (b.text || '').slice(0, 80) || (b.media.length ? '(' + b.media.length + ' attachment' + (b.media.length > 1 ? 's' : '') + ')' : '') })]);
      var times = b.status === 'scheduled' ? 'Goes out ' + when(b.scheduledAt) + (b.timezone ? ' · ' + b.localTime + ' ' + b.timezone : '') + (b.repeatDaily ? ' · every day · sent ' + b.occurrences + ' time(s) so far' : '')
        : (b.sentAt ? (inbox ? 'Sent ' : 'Published ') + when(b.sentAt) : 'Started ' + when(b.startedAt || b.createdAt)) + (b.scheduledAt ? ' · scheduled for ' + when(b.scheduledAt) : '');
      var kids = [head, h('div', { class: 'meta', style: 'margin-top:4px', text: times + (b.createdBy ? ' · by ' + b.createdBy : '') })];
      if (b.text && b.title) kids.push(h('div', { class: 'quote', text: b.text.length > 300 ? b.text.slice(0, 300) + '…' : b.text }));
      else if (b.text && b.text.length > 80) kids.push(h('div', { class: 'quote', text: b.text.length > 300 ? b.text.slice(0, 300) + '…' : b.text }));
      if (b.media.length || b.links.length) kids.push(h('div', { class: 'meta', text: [b.media.filter(function(m){ return m.type === 'image'; }).length ? b.media.filter(function(m){ return m.type === 'image'; }).length + ' image(s)' : '', b.media.some(function(m){ return m.type === 'video'; }) ? '1 video' : '', b.links.length ? b.links.length + ' link(s): ' + b.links.map(function(l){ return l.host; }).join(', ') : ''].filter(Boolean).join(' · ') }));
      if (inbox && b.status !== 'scheduled' && b.status !== 'cancelled') {
        kids.push(h('div', { class: 'bc-stats' }, [stat(s.recipients, 'inbox entries'), stat(s.pushSent, 'pushes sent'), stat(s.pushFailed, 'push failed'), stat(s.opened + ' (' + pct(s.opened, s.recipients) + ')', 'opened'), stat(s.linkClicks, 'link clicks'), stat(s.clickers, 'people clicked')]));
      }
      if (!inbox && b.postId) kids.push(h('div', { class: 'bc-stats' }, [stat(s.postViews, 'views'), stat(s.postLikes, 'reactions'), stat(s.postComments, 'comments')].concat(b.postRemoved ? [h('span', { class: 'chip neg', text: 'Post removed' })] : [])));
      if (b.error) kids.push(h('div', { class: 'meta', style: 'color:var(--neg)', text: 'Problem: ' + b.error + (b.status === 'sending' ? ' — will retry' : '') }));
      var actions = h('div', { class: 'row', style: 'margin-top:8px' });
      if (b.status === 'scheduled') {
        var cancel = h('button', { class: 'btn ghost small', text: b.repeatDaily ? 'Stop repeating' : 'Cancel' });
        cancel.onclick = async function(){ if (!window.confirm('Cancel this scheduled broadcast?')) return; cancel.disabled = true; try { await api('POST', '/admin/api/broadcasts/' + b.id + '/cancel', {}); toast('Cancelled'); load(); } catch (e) { toast(e.message, true); cancel.disabled = false; } };
        actions.appendChild(cancel);
      }
      if (!inbox && b.postId && !b.postRemoved) {
        var pinB = h('button', { class: 'btn ghost small', text: b.pinned ? 'Unpin from feed' : 'Pin to top of feed' });
        pinB.onclick = async function(){ pinB.disabled = true; try { await api('PATCH', '/admin/api/broadcasts/' + b.id, { pinned: !b.pinned }); toast(b.pinned ? 'Unpinned' : 'Pinned'); load(); } catch (e) { toast(e.message, true); pinB.disabled = false; } };
        actions.appendChild(pinB);
      }
      if (actions.childNodes.length) kids.push(actions);
      list.appendChild(h('div', { class: 'card' }, kids));
    });
    clearTimeout(timer);
    if (d.items.some(function(b){ return b.status === 'sending'; })) timer = setTimeout(function(){ if (box.isConnected) load(); }, 4000);
  }

  drawPills();
  drawComposer();
  senderInfo();
  load();
});
})();
`;
