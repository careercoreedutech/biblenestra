// PDF reader page served at GET /library/viewer (MEDIA LIBRARY). The app opens it in a WebView (Android/iOS)
// or an iframe (web): /library/viewer?file=/library/file/<key>?exp…&page=12&title=…
// Uses pdf.js 3.11.174 from cdnjs (pinned) with HTTP Range loading, so big books open fast and only the
// pages being read are downloaded. It reports the current page to the app:
//   native: window.ReactNativeWebView.postMessage(JSON) · web: parent.postMessage(JSON, '*')
//   → { source: 'bn-pdf', type: 'ready' | 'page' | 'error', page, pages, message }
// and accepts { source: 'bn-app', type: 'goto', page } back.
// Only same-origin /library/file/ links are opened, so this is not a general-purpose PDF proxy.
// NOTE: plain HTML/JS in a string — no backticks or "${" inside.
export const LIBRARY_VIEWER_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Reader</title>
<style>
html,body{margin:0;height:100%;background:#2B2A33;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#F4EFE6;-webkit-text-size-adjust:100%}
#scroller{position:absolute;inset:0;overflow:auto;-webkit-overflow-scrolling:touch}
#pages{padding:12px 0 80px}
.pg{position:relative;margin:0 auto 12px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.pg canvas{display:block;width:100%;height:100%}
.pg .n{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#999;font-size:13px}
#bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;background:rgba(21,23,43,.92);border-radius:999px;padding:4px 6px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
#bar button{background:none;border:0;color:#F4EFE6;font-size:18px;width:38px;height:34px;border-radius:999px;cursor:pointer}
#bar button:active{background:rgba(255,255,255,.12)}
#pn{font-size:13px;font-weight:700;min-width:84px;text-align:center;font-variant-numeric:tabular-nums}
#msg{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-size:15px;line-height:1.5}
</style>
</head><body>
<div id="scroller"><div id="pages"></div></div>
<div id="bar" style="display:none"><button id="zo" aria-label="Zoom out">&minus;</button><button id="prev" aria-label="Previous page">&lsaquo;</button><span id="pn"></span><button id="next" aria-label="Next page">&rsaquo;</button><button id="zi" aria-label="Zoom in">+</button></div>
<div id="msg">Opening book…</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>
(function(){
  var qs = new URLSearchParams(location.search);
  var file = qs.get('file') || '';
  var startPage = Math.max(1, parseInt(qs.get('page') || '1', 10) || 1);
  var msg = document.getElementById('msg'), pagesEl = document.getElementById('pages'), scroller = document.getElementById('scroller');
  var bar = document.getElementById('bar'), pn = document.getElementById('pn');
  function post(o){
    o.source = 'bn-pdf';
    var s = JSON.stringify(o);
    try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s); else if (window.parent && window.parent !== window) window.parent.postMessage(s, '*'); } catch (e) {}
  }
  function fail(t){ msg.style.display = 'flex'; msg.textContent = t; post({ type: 'error', message: t }); }
  if (!/^\\/library\\/file\\/lib\\/pdf\\/[\\w\\-\\/.]+(\\?[\\w=&%\\-.]*)?$/.test(file)) { fail('This book link is not valid.'); return; }
  if (!window.pdfjsLib) { fail('The reader could not load. Check your connection and try again.'); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var doc = null, zoom = 1, baseW = 612, baseH = 792, current = 0, rendered = {}, slots = [], dpr = Math.min(window.devicePixelRatio || 1, 2);
  function width(){ return Math.min(scroller.clientWidth - 16, 1000) * zoom; }
  function layout(){
    var w = width();
    slots.forEach(function(s){ s.el.style.width = w + 'px'; s.el.style.height = Math.round(w * (s.h / s.w)) + 'px'; });
  }
  function render(i){
    var s = slots[i];
    if (!s || rendered[i] === zoom) return;
    rendered[i] = zoom;
    doc.getPage(i + 1).then(function(page){
      var vp1 = page.getViewport({ scale: 1 });
      s.w = vp1.width; s.h = vp1.height;
      var w = width(); s.el.style.height = Math.round(w * (s.h / s.w)) + 'px';
      var vp = page.getViewport({ scale: (w / vp1.width) * dpr });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function(){
        if (rendered[i] !== zoom) return;
        s.el.innerHTML = ''; s.el.appendChild(canvas);
      });
    }).catch(function(){ rendered[i] = 0; });
  }
  function unrender(i){ var s = slots[i]; if (s && rendered[i]) { rendered[i] = 0; s.el.innerHTML = '<div class="n">' + (i + 1) + '</div>'; } }
  function visiblePage(){
    var mid = scroller.scrollTop + scroller.clientHeight / 3, best = 0;
    for (var i = 0; i < slots.length; i++) { if (slots[i].el.offsetTop <= mid) best = i; else break; }
    return best;
  }
  var ticking = false;
  function onScroll(){
    if (ticking) return; ticking = true;
    setTimeout(function(){ // (not requestAnimationFrame: it never fires in hidden/background WebViews)
      ticking = false;
      var p = visiblePage();
      for (var i = 0; i < slots.length; i++) { if (Math.abs(i - p) <= 2) render(i); else if (Math.abs(i - p) > 6) unrender(i); }
      if (p !== current) { current = p; pn.textContent = (p + 1) + ' / ' + slots.length; post({ type: 'page', page: p + 1, pages: slots.length }); }
    }, 16);
  }
  function goto(n){ n = Math.max(1, Math.min(slots.length, n)); var s = slots[n - 1]; if (s) scroller.scrollTop = s.el.offsetTop - 8; onScroll(); }
  function setZoom(z){ var p = visiblePage() + 1; zoom = Math.max(0.6, Math.min(3, z)); layout(); goto(p); }
  document.getElementById('prev').onclick = function(){ goto(visiblePage()); };
  document.getElementById('next').onclick = function(){ goto(visiblePage() + 2); };
  document.getElementById('zi').onclick = function(){ setZoom(zoom * 1.25); };
  document.getElementById('zo').onclick = function(){ setZoom(zoom / 1.25); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function(){ var p = visiblePage() + 1; rendered = {}; slots.forEach(function(s, i){ unrender(i); }); layout(); goto(p); });
  function onMsg(e){ try { var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (d && d.source === 'bn-app' && d.type === 'goto') goto(Number(d.page) || 1); } catch (x) {} }
  window.addEventListener('message', onMsg); document.addEventListener('message', onMsg);

  pdfjsLib.getDocument({ url: file, rangeChunkSize: 262144, disableAutoFetch: true, disableStream: false }).promise.then(function(d){
    doc = d;
    return d.getPage(1).then(function(p1){
      var vp = p1.getViewport({ scale: 1 }); baseW = vp.width; baseH = vp.height;
      for (var i = 0; i < d.numPages; i++) {
        var el = document.createElement('div'); el.className = 'pg'; el.innerHTML = '<div class="n">' + (i + 1) + '</div>';
        pagesEl.appendChild(el); slots.push({ el: el, w: baseW, h: baseH });
      }
      layout(); msg.style.display = 'none'; bar.style.display = 'flex';
      var start = Math.min(startPage, d.numPages);
      current = -1; goto(start);
      post({ type: 'ready', page: start, pages: d.numPages });
    });
  }).catch(function(e){ fail(e && e.name === 'PasswordException' ? 'This PDF is password protected.' : 'This book could not be opened.'); });
})();
</script>
</body></html>`;
