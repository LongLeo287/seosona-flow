/* Watermark tool — auto xử lý khi upload, so sánh before/after kéo trượt, dùng engine THẬT (GWR bundle).
   CSP-safe (file ngoài). Ảnh: PNG lossless. Video: WebM (encode lại, giữ audio). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = { file: null, isVideo: false, videoEl: null, blob: null, ext: 'png', beforeURL: null, afterURL: null };

  var drop = $('drop'), fileInput = $('file'), ws = $('ws'), stage = $('stage'),
      statusEl = $('status'), statusText = $('statusText'), metaEl = $('meta'), videoMsg = $('videoMsg'),
      dlBtn = $('download'), copyBtn = $('copy'), reBtn = $('reprocess'), resetBtn = $('reset'),
      methodSel = $('method'), gainR = $('gain'), gainVal = $('gainVal'), cornerSel = $('corner'),
      sourceSel = $('source'), srcHint = $('srcHint');

  S.source = 'auto'; S.manualBox = null;

  // Đổ nguồn từ WatermarkRemover.SOURCES (đồng bộ, không hardcode). Chỉ AI-gen; KHÔNG có ảnh kho.
  function populateSources() {
    if (!sourceSel || !window.WatermarkRemover || !window.WatermarkRemover.SOURCES) return;
    var SR = window.WatermarkRemover.SOURCES;
    sourceSel.innerHTML = Object.keys(SR).map(function (id) {
      return '<option value="' + id + '"' + (id === 'auto' ? ' selected' : '') + '>' + SR[id].label + '</option>';
    }).join('');
    onSourceChange();
  }
  function onSourceChange() {
    S.source = sourceSel ? sourceSel.value : 'gemini';
    S.manualBox = null;
    var SR = window.WatermarkRemover && window.WatermarkRemover.SOURCES ? window.WatermarkRemover.SOURCES[S.source] : null;
    if (srcHint) {
      srcHint.textContent = S.source === 'auto'
        ? 'Thử Gemini trước, không ăn thì tự dò vùng watermark ở góc & xoá.'
        : S.source === 'gemini'
          ? 'Tự phát hiện & xoá chính xác (reverse-alpha).'
          : S.source === 'manual'
            ? 'Kéo chuột khoanh vùng watermark trên ảnh, rồi bấm “Xoá vùng đã chọn”.'
            : 'Vá góc (' + (SR && SR.corner || 'br') + '). Watermark lệch preset → chọn “Khác — tự khoanh vùng”.';
    }
    // đồng bộ advanced controls theo preset
    if (SR) { if (methodSel) methodSel.value = SR.method || 'inpaint'; if (cornerSel && SR.corner) cornerSel.value = SR.corner; }
  }

  function setStatus(cls, text) { statusEl.className = 'pill ' + cls; statusText.textContent = text; }
  function opts() {
    var g = parseFloat(gainR.value);
    var base = (window.WatermarkRemover && window.WatermarkRemover.optsForSource)
      ? window.WatermarkRemover.optsForSource(S.source)
      : { method: methodSel.value, corner: cornerSel.value };
    // advanced overrides
    base.method = methodSel.value || base.method;
    base.corner = cornerSel.value || base.corner;
    base.alphaGain = (Math.abs(g - 1) > 0.01 ? g : undefined);
    base.type = 'image/png';
    if (S.source === 'manual' && S.manualBox) { base.method = 'inpaint'; base.box = S.manualBox; }
    return base;
  }
  gainR.addEventListener('input', function () { var g = parseFloat(gainR.value); gainVal.textContent = Math.abs(g - 1) < 0.01 ? 'tự động' : g.toFixed(2); });

  function revoke() { [S.beforeURL, S.afterURL].forEach(function (u) { try { if (u) URL.revokeObjectURL(u); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-tool#revoke', _); } }); }
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function loadImg(url) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = url; }); }
  function toBlob(cv, type, q) { return new Promise(function (r) { cv.toBlob(function (b) { r(b); }, type, q); }); }

  // ── So sánh before/after (clip-path, kéo trượt) ──────────────────────────
  function buildCompare(beforeURL, afterURL) {
    stage.innerHTML = '';
    var cmp = document.createElement('div'); cmp.className = 'cmp';
    var base = new Image(); base.src = beforeURL; base.draggable = false; base.style.cssText = 'display:block;max-width:100%;max-height:64vh;object-fit:contain';
    var ov = document.createElement('div'); ov.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    var ci = new Image(); ci.src = afterURL; ci.draggable = false; ci.style.cssText = 'width:100%;height:100%;object-fit:contain;clip-path:inset(0 50% 0 0)';
    ov.appendChild(ci);
    var handle = document.createElement('div'); handle.className = 'handle'; handle.style.left = '50%'; handle.innerHTML = '<i>⟺</i>';
    var tl = document.createElement('span'); tl.className = 'tag l'; tl.textContent = 'Đã xoá';
    var tr = document.createElement('span'); tr.className = 'tag r'; tr.textContent = 'Gốc';
    cmp.appendChild(base); cmp.appendChild(ov); cmp.appendChild(handle); cmp.appendChild(tl); cmp.appendChild(tr);
    stage.appendChild(cmp);
    function setPct(p) { p = Math.max(0, Math.min(100, p)); ci.style.clipPath = 'inset(0 ' + (100 - p) + '% 0 0)'; handle.style.left = p + '%'; }
    function at(e) { var r = cmp.getBoundingClientRect(); var x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left); setPct(x / r.width * 100); }
    var dragging = false;
    handle.addEventListener('mousedown', function (e) { dragging = true; e.preventDefault(); });
    document.addEventListener('mousemove', function (e) { if (dragging) at(e); });
    document.addEventListener('mouseup', function () { dragging = false; });
    cmp.addEventListener('click', at);
    handle.addEventListener('touchmove', function (e) { at(e); e.preventDefault(); }, { passive: false });
  }

  // ── Phóng đúng ô watermark + ba chỉ số ──────────────────────────────────
  // Đây là thứ ta thiếu suốt: xoá xong mà người dùng không kiểm được. Ba chỉ số dưới đây
  // engine ĐÃ BIẾT sẵn, chỉ là trước giờ ném đi không hiện ra.
  function renderZoom(beforeImg, afterCv) {
    var box = $('zoomBox'); if (!box) return;
    var st = S.stats;
    if (!st || !st.id || !window.FlowWatermarkProfiles) { box.style.display = 'none'; return; }
    var p = window.FlowWatermarkProfiles.PROFILES[st.id];
    var w = afterCv.width, h = afterCv.height;
    var pl = st.place || { k: Math.min(w, h) / p.ref };
    if (!st.place) {
      var k = pl.k, bw = Math.round(p.w * k), bh = Math.round(p.h * k);
      pl = { k: k, bw: bw, bh: bh, bx: w - Math.round(p.right * k) - bw, by: h - Math.round(p.bottom * k) - bh };
    }
    var pad = Math.round(Math.max(6, 10 * pl.k));
    var sx = Math.max(0, pl.bx - pad), sy = Math.max(0, pl.by - pad);
    var sw = Math.min(w - sx, pl.bw + pad * 2), sh = Math.min(h - sy, pl.bh + pad * 2);
    var scale = Math.max(2, Math.min(6, Math.round(300 / Math.max(sw, sh) * 4) / 4 || 3));
    [['zoomA', beforeImg], ['zoomB', afterCv]].forEach(function (pair) {
      var c = $(pair[0]); if (!c) return;
      c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
      var g = c.getContext('2d');
      g.imageSmoothingEnabled = false;   // phải thấy TỪNG PIXEL, làm mượt là che mất phần dư
      g.drawImage(pair[1], sx, sy, sw, sh, 0, 0, c.width, c.height);
    });
    $('zoomCap').textContent = 'góc dưới-phải · phóng ' + Math.round(scale * 100) + '% · ô '
      + pl.bw + '×' + pl.bh + 'px tại (' + pl.bx + ',' + pl.by + ')';
    // Độ sạch: dấu còn "nổi" hơn xung quanh bao nhiêu so với lúc chưa xoá.
    var clean = (st.before && st.before > 1 && st.after != null)
      ? Math.max(0, Math.min(100, Math.round((1 - st.after / st.before) * 100))) : null;
    var cells = [
      [st.ms + '<small>ms</small>', 'Tốc độ', ''],
      [clean == null ? '—' : clean + '<small>%</small>', 'Độ sạch',
        clean == null ? '' : (clean >= 90 ? 'ok' : clean >= 70 ? 'warn' : 'bad')],
      [st.detect == null ? '—' : Math.round(st.detect * 100) + '<small>%</small>', 'Nhận diện',
        st.detect == null ? '' : (st.detect >= 0.7 ? 'ok' : 'warn')],
    ];
    var col = { ok: 'var(--ok,#19d07b)', warn: '#f5c26b', bad: '#ff9a9a', '': 'var(--txt)' };
    $('metrics').innerHTML = cells.map(function (c, i) {
      return '<div style="padding:12px 10px;text-align:center' + (i ? ';border-left:1px solid var(--line)' : '') + '">'
        + '<div style="font-size:20px;font-weight:600;color:' + col[c[2]] + '">' + c[0] + '</div>'
        + '<div style="font-size:11px;color:var(--mut);margin-top:2px">' + c[1] + '</div></div>';
    }).join('');
    box.style.display = 'block';
  }

  // ── Engine trong Web Worker (UI không đơ) + fallback sync ────────────────
  var _worker = null, _workerBad = false, _wid = 0;
  function getWorker() {
    if (_workerBad || _worker) return _worker;
    try { _worker = new Worker('../scripts/watermark-worker.js'); _worker.addEventListener('error', function () { _workerBad = true; }); return _worker; }
    catch (_) { _workerBad = true; return null; }
  }
  function syncEngine(imageData, o) {
    try { var r = window.GWR.removeWatermarkFromImageDataSync(imageData, (o && o.alphaGain) ? { alphaGainCandidates: [o.alphaGain] } : {}); return { imageData: (r && r.imageData) || imageData, meta: (r && r.meta) || {} }; }
    catch (e) { return { imageData: imageData, meta: {} }; }
  }
  function runEngine(imageData, o) {
    return new Promise(function (resolve) {
      var wk = getWorker();
      if (!wk || !window.GWR) { resolve(syncEngine(imageData, o)); return; }
      var id = ++_wid, done = false;
      var to = setTimeout(function () { if (done) return; done = true; try { wk.terminate(); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-tool#runEngine', _); } _worker = null; _workerBad = true; resolve(syncEngine(imageData, o)); }, 90000);
      function onMsg(e) {
        if (!e.data || e.data.id !== id || done) return; done = true; clearTimeout(to); wk.removeEventListener('message', onMsg);
        if (e.data.ok) resolve({ imageData: e.data.imageData, meta: e.data.meta || {} });
        else resolve(syncEngine(imageData, o));
      }
      wk.addEventListener('message', onMsg);
      try { wk.postMessage({ type: 'process', id: id, imageData: imageData, opts: o }); }
      catch (_) { clearTimeout(to); done = true; resolve(syncEngine(imageData, o)); }
    });
  }

  // ── Chọn vùng thủ công (manual): kéo hộp lên ảnh → S.manualBox (toạ độ NATURAL px) ──────
  async function buildSelector(f) {
    S.beforeURL = S.beforeURL || URL.createObjectURL(f);
    var img = await loadImg(S.beforeURL);
    var cw = img.naturalWidth, ch = img.naturalHeight;
    stage.innerHTML = '';
    var wrap = document.createElement('div'); wrap.style.cssText = 'position:relative;display:inline-block;max-width:100%';
    var el = new Image(); el.src = S.beforeURL; el.draggable = false; el.style.cssText = 'display:block;max-width:100%;max-height:56vh;object-fit:contain';
    var sel = document.createElement('div'); sel.style.cssText = 'position:absolute;border:2px dashed #3d6ff5;background:rgba(61, 111, 245,0.12);display:none;pointer-events:none';
    wrap.appendChild(el); wrap.appendChild(sel); stage.appendChild(wrap);
    var goBtn = document.createElement('button'); goBtn.className = 'btn'; goBtn.textContent = 'Xoá vùng đã chọn'; goBtn.disabled = true;
    goBtn.style.cssText = 'margin-top:8px'; stage.appendChild(goBtn);
    setStatus('none', 'Kéo chuột khoanh vùng watermark');

    var start = null;
    function rel(e) { var r = el.getBoundingClientRect(); return { x: (e.touches ? e.touches[0].clientX : e.clientX) - r.left, y: (e.touches ? e.touches[0].clientY : e.clientY) - r.top, r: r }; }
    el.addEventListener('mousedown', function (e) { e.preventDefault(); start = rel(e); sel.style.display = 'block'; });
    document.addEventListener('mousemove', function (e) {
      if (!start) return;
      var p = rel(e);
      var x = Math.min(start.x, p.x), y = Math.min(start.y, p.y), w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      sel.style.left = x + 'px'; sel.style.top = y + 'px'; sel.style.width = w + 'px'; sel.style.height = h + 'px';
      // scale hiển thị → natural px
      var sc = cw / start.r.width;
      S.manualBox = { x: Math.round(x * sc), y: Math.round(y * sc), width: Math.round(w * sc), height: Math.round(h * sc) };
      goBtn.disabled = !(S.manualBox.width > 4 && S.manualBox.height > 4);
    });
    document.addEventListener('mouseup', function () { start = null; });
    goBtn.addEventListener('click', function () { if (S.manualBox) processImage(f); });
  }

  // ── Ảnh: auto xử lý bằng GWR (Web Worker, có meta để hiện status) ─────────
  async function processImage(f) {
    setStatus('busy', 'Đang phát hiện & xoá…'); metaEl.textContent = '';
    S.beforeURL = URL.createObjectURL(f);
    var img = await loadImg(S.beforeURL);
    var cw = img.naturalWidth, ch = img.naturalHeight;
    var cv = makeCanvas(cw, ch), ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    var o = opts(), meta = { applied: true };
    var srcImg = ctx.getImageData(0, 0, cw, ch);
    var WR = window.WatermarkRemover;
    var SRC = WR.SOURCES[S.source];
    S.stats = null;
    // Đo TRƯỚC → xoá → đo SAU. Người dùng không tự đánh giá được bằng mắt: dấu Omni chỉ 72px
    // trong ảnh 1920px, xem vừa khung thì nhỏ hơn đầu kim. Engine phải tự chấm và nói ra.
    var _grade = function (id, place, t0) {
      var after = WR.markContrast(ctx, cw, ch, id, place);
      S.stats = {
        id: id, place: place || null, ms: Math.round(performance.now() - t0),
        detect: null, before: null, after: after,
      };
      return S.stats;
    };
    if (SRC && SRC.method === 'profile') {
      // Hồ sơ ĐO TỪ VIDEO THẬT (Omni/Veo). Ảnh tĩnh cũng dùng được vì watermark giống nhau.
      var t0 = performance.now();
      var before = WR.markContrast(ctx, cw, ch, SRC.profile);
      var okp = WR.removeFlowMark(ctx, cw, ch, SRC.profile);
      meta = okp ? { applied: true, flow: SRC.profile } : { applied: false, skipReason: 'not-detected' };
      if (okp) { _grade(SRC.profile, null, t0).before = before; }
    } else if (S.source === 'auto' && WR.detectFlowMark) {
      // TỰ ĐỘNG thử hồ sơ Flow TRƯỚC — nó biết chính xác dấu nào ở đâu, alpha bao nhiêu,
      // nên chính xác hơn hẳn dò cạnh rồi vá mù.
      var t1 = performance.now();
      var fh = WR.detectFlowMark(ctx, cw, ch);
      if (fh) {
        var b1 = WR.markContrast(ctx, cw, ch, fh.id, fh.place);
        WR.removeFlowMark(ctx, cw, ch, fh.id, fh.place);
        meta = { applied: true, flow: fh.id };
        var st = _grade(fh.id, fh.place, t1);
        st.before = b1; st.detect = fh.score;
      } else { srcImg = ctx.getImageData(0, 0, cw, ch); }
    }
    if (meta.flow || (SRC && SRC.method === 'profile')) { /* xong */ }
    else if (S.source === 'auto') {
      // TỰ ĐỘNG: (1) thử GWR (Gemini, chính xác). (2) không ăn → tự phát hiện vùng góc → inpaint.
      var eng0 = (window.GWR && window.GWR.removeWatermarkFromImageDataSync) ? await runEngine(srcImg, {}) : { meta: { applied: false } };
      var gmOk = eng0.meta && eng0.meta.applied !== false && !eng0.meta.skipReason && eng0.imageData;
      if (gmOk) { ctx.putImageData(eng0.imageData, 0, 0); meta = eng0.meta; }
      else {
        var det = window.WatermarkRemover.detectBox(srcImg);
        if (det) {
          var bb = await window.WatermarkRemover.removeFromBlob(f, { method: 'inpaint', box: det, type: 'image/png' });
          var imd = await loadImg(URL.createObjectURL(bb)); ctx.clearRect(0, 0, cw, ch); ctx.drawImage(imd, 0, 0);
          meta = { applied: true, position: { x: det.x, y: det.y }, config: { logoSize: Math.max(det.width, det.height) } };
        } else { meta = { applied: false, skipReason: 'not-detected' }; }
      }
    } else if (o.method !== 'inpaint' && window.GWR && window.GWR.removeWatermarkFromImageDataSync) {
      var eng = await runEngine(srcImg, o); // chạy trong Web Worker → UI không đơ
      meta = eng.meta || {};
      if (eng.imageData) ctx.putImageData(eng.imageData, 0, 0);
    } else {
      // inpaint (box thủ công hoặc góc preset) — dùng WatermarkRemover
      var b = await window.WatermarkRemover.removeFromBlob(f, o);
      var im2 = await loadImg(URL.createObjectURL(b)); ctx.clearRect(0, 0, cw, ch); ctx.drawImage(im2, 0, 0);
    }
    S.blob = await toBlob(cv, 'image/png'); S.ext = 'png';
    S.afterURL = URL.createObjectURL(S.blob);
    buildCompare(S.beforeURL, S.afterURL);
    renderZoom(img, cv);
    if (meta.applied === false || meta.skipReason) {
      setStatus('none', meta.skipReason === 'not-detected'
        ? 'Không tự phát hiện được — thử chọn nguồn hoặc "Khác — tự khoanh vùng"'
        : 'Không phát hiện watermark — giữ nguyên ảnh');
    } else setStatus('ok', 'Đã xoá watermark');
    if (meta.position) metaEl.textContent = 'vùng ' + meta.position.x + ',' + meta.position.y + (meta.config ? ' · ' + meta.config.logoSize + 'px' : '');
    dlBtn.disabled = false; dlBtn.textContent = 'Tải xuống (PNG)'; copyBtn.disabled = false; reBtn.style.display = '';
  }

  // ── Video: canvas per-frame (GWR) + audio gốc → MediaRecorder (WebM) ─────
  // WebCodecs TRƯỚC: ra MP4 thật, nhanh hơn nhiều, và ÂM THANH ĐƯỢC CHÉP NGUYÊN GÓI thay vì
  // mã hoá lại. MediaRecorder chỉ còn là đường lùi cho máy không hỗ trợ.
  // @returns {boolean} đã xử lý xong bằng đường này chưa
  async function tryWebCodecs(f) {
    var VC = window.VideoTranscodeClient;
    if (!VC || !VC.available()) return false;
    setStatus('busy', 'Đang xử lý video (WebCodecs)…');
    try {
      var r = await VC.process(f, {
        onProgress: function (p) {
          if (p.ratio) setStatus('busy', 'Đang xử lý video ' + Math.round(p.ratio * 100) + '%…');
        },
      });
      if (!r) return false;                       // máy không chạy được → để đường lùi lo
      if (!r.applied) {
        setStatus('none', r.reason === 'not_found'
          ? 'Không tìm thấy watermark Flow trong video này — giữ nguyên file gốc'
          : 'Không xử lý được (' + r.reason + ') — giữ nguyên file gốc');
        S.blob = f; S.ext = (f.name || '').split('.').pop() || 'mp4';
        dlBtn.disabled = false; dlBtn.textContent = 'Tải bản gốc';
        return true;
      }
      S.blob = r.blob; S.ext = 'mp4';
      var st = r.stats || {};
      setStatus('ok', 'Xong — MP4, ' + (st.frames || 0) + ' khung trong ' + Math.round((st.ms || 0) / 1000) + 's');
      if (metaEl) metaEl.textContent = 'dấu ' + (st.mark || '?') + ' · khớp ' + (st.score != null ? Math.round(st.score * 100) + '%' : '?');
      dlBtn.disabled = false; dlBtn.textContent = 'Tải xuống (MP4)';
      return true;
    } catch (e) {
      // Có MÃ lỗi thì nói đúng vấn đề; ca nào cũng để đường lùi thử tiếp, trừ khi vô nghĩa.
      var code = e && e.code;
      if (code === 'TOO_LARGE' || code === 'CANCELLED') {
        setStatus('err', e.message || code);
        return true;
      }
      console.warn('[watermark-tool] WebCodecs hỏng → dùng MediaRecorder:', code, e && e.message);
      return false;
    }
  }

  async function processVideo() {
    if (await tryWebCodecs(S.file)) return;
    var v = S.videoEl, cw = v.videoWidth, ch = v.videoHeight;
    setStatus('busy', 'Đang xử lý video 0%…'); copyBtn.disabled = true; dlBtn.disabled = true;
    var cv = makeCanvas(cw, ch), ctx = cv.getContext('2d', { willReadFrequently: true });
    // Theo nguồn: Gemini = reverse-alpha (GWR); nguồn khác (Veo/Grok/…) = inpaint góc per-frame.
    var WR = window.WatermarkRemover;
    var vsrc = WR && WR.SOURCES ? WR.SOURCES[S.source] : null;
    var vAlpha = !vsrc || vsrc.method === 'alpha' || vsrc.method === 'auto';
    var vBox = (!vAlpha && WR && WR.boxFor) ? WR.boxFor(cw, ch, { corner: (vsrc && vsrc.corner) || 'br', logoSize: vsrc && vsrc.logoSize }) : null;
    var stream = cv.captureStream(30);
    try { var vs = v.captureStream ? v.captureStream() : (v.mozCaptureStream && v.mozCaptureStream()); if (vs) vs.getAudioTracks().forEach(function (t) { stream.addTrack(t); }); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-tool#processVideo', _); }
    // ƯU TIÊN MP4. WebM thì Chrome nào cũng ghi được nhưng TikTok/CapCut/Premiere đều không
    // nhận — người dùng phải tự convert, mà convert lần nữa là mất chất lượng lần nữa.
    // (Bản trước chỉ sửa ở nút nổi trên trang Flow, QUÊN chính công cụ này — mà đây mới là
    // chỗ người dùng kéo file vào.)
    var fmt = window.WatermarkRemover.pickRecorderMime('mp4');
    var mime = fmt.mime;
    var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(16000000, Math.max(2500000, Math.round(cw * ch * 30 * 0.15))) });
    var chunks = []; rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var stopped = new Promise(function (r) { rec.onstop = r; });
    function frame() {
      ctx.drawImage(v, 0, 0, cw, ch);
      if (vAlpha) window.WatermarkRemover.applyToContext(ctx, cw, ch, { method: 'alpha' });
      else window.WatermarkRemover.inpaintContext(ctx, cw, ch, { box: vBox });
      if (v.duration) setStatus('busy', 'Đang xử lý video ' + Math.round(v.currentTime / v.duration * 100) + '%…');
      if (!v.ended && !v.paused) requestAnimationFrame(frame); else { try { rec.stop(); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-tool#frame', _); } }
    }
    try { v.currentTime = 0; v.muted = true; await v.play(); rec.start(); requestAnimationFrame(frame); await stopped; } finally { try { v.pause(); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-tool#frame', _); } }
    S.blob = new Blob(chunks, { type: mime || 'video/webm' }); S.ext = fmt.ext;
    // WebM của MediaRecorder KHÔNG có Duration → trình phát ngoài Chrome hiện 0:00, không
    // tua được, có khi không mở nổi. Vá trước khi giao cho người dùng.
    if (fmt.ext === 'webm' && window.WebmDuration) {
      var _ms = (isFinite(v.duration) && v.duration > 0) ? v.duration * 1000 : 0;
      S.blob = await window.WebmDuration.patchBlob(S.blob, _ms);
    }
    var UP = fmt.ext.toUpperCase();
    setStatus('ok', fmt.fellBack
      ? 'Xong — nhưng trình duyệt này chưa ghi được MP4 nên xuất WebM'
      : 'Xong — video đã xoá watermark (' + UP + ')');
    dlBtn.disabled = false; dlBtn.textContent = 'Tải xuống (' + UP + ')';
  }

  // ── Nạp file ─────────────────────────────────────────────────────────────
  /**
   * Soi metadata của file GỐC và nói thẳng ra. Không sửa gì ở đây: cả hai đường xử lý
   * (ảnh → canvas PNG, video → MediaRecorder WebM) đều encode LẠI, nên file bạn tải về
   * vốn đã không mang theo EXIF/GPS/prompt. Báo cáo này để bạn biết cái gì vừa rụng —
   * và để biết file GỐC còn nằm trên máy thì vẫn còn nguyên những thứ đó.
   */
  function reportMeta(f) {
    var MS = window.MetadataScrubber;
    var el = document.getElementById('metaMsg');
    if (!el || !MS || !f || !/^(image|video)\//.test(f.type || '')) { if (el) el.style.display = 'none'; return; }
    f.arrayBuffer().then(function (ab) {
      var info = MS.inspect(new Uint8Array(ab));
      if (!info.format) { el.style.display = 'none'; return; }
      var cats = Object.keys(info.found || {});
      el.style.display = 'block';
      if (!cats.length) { el.textContent = '🔎 File gốc không mang metadata riêng tư.'; return; }
      var names = cats.map(function (c) { return (MS.CATEGORIES[c] || {}).label || c; });
      el.textContent = '🔎 File GỐC có: ' + names.join(', ')
        + '. Bản tải về đã bỏ hết (do encode lại) — nhưng file gốc trên máy bạn thì vẫn còn.';
    }).catch(function (e) { globalThis.SEOSONA_swallow?.('watermark-tool#reportMeta', e); el.style.display = 'none'; });
  }

  function onFile(f) {
    if (!f) return;
    revoke(); S.file = f; S.blob = null; videoMsg.style.display = 'none'; copyBtn.style.display = '';
    reportMeta(f);
    ws.style.display = 'block';
    if (/^video\//.test(f.type)) {
      S.isVideo = true; copyBtn.style.display = 'none';
      videoMsg.style.display = 'block';
      videoMsg.innerHTML = '🎬 Video được encode lại (MP4 nếu trình duyệt hỗ trợ, không thì WebM) — chất lượng giảm nhẹ, giữ audio. Chạy realtime + full pipeline mỗi frame → hơi chậm với video dài.';
      var v = S.videoEl || document.createElement('video');
      S.videoEl = v; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.controls = true;
      v.className = 'stagevid'; v.style.maxHeight = '64vh'; v.style.maxWidth = '100%';
      v.src = URL.createObjectURL(f);
      v.onloadeddata = function () { stage.innerHTML = ''; stage.appendChild(v); setStatus('busy', 'Đang xử lý video…'); processVideo(); };
      v.onerror = function () { setStatus('err', 'Không đọc được video'); };
      return;
    }
    S.isVideo = false;
    if (!/^image\//.test(f.type)) { setStatus('err', 'Chỉ hỗ trợ ảnh hoặc video'); return; }
    // Manual: khoanh vùng trước, KHÔNG auto-xử lý. Nguồn khác: xử lý ngay theo preset.
    if (S.source === 'manual') { S.manualBox = null; buildSelector(f).catch(function (e) { setStatus('err', 'Lỗi: ' + ((e && e.message) || e)); }); return; }
    processImage(f).catch(function (e) { setStatus('err', 'Lỗi: ' + ((e && e.message) || e)); });
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  dlBtn.addEventListener('click', function () {
    if (!S.blob) return;
    var a = document.createElement('a'); var name = (S.file.name || 'file').replace(/\.[^.]+$/, '');
    a.href = URL.createObjectURL(S.blob); a.download = name + '_nowatermark.' + S.ext;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  });
  copyBtn.addEventListener('click', async function () {
    if (!S.blob || S.isVideo) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': S.blob })]); copyBtn.textContent = 'Đã copy ✓'; setTimeout(function () { copyBtn.textContent = 'Copy ảnh'; }, 1600); }
    catch (_) { copyBtn.textContent = 'Copy lỗi'; setTimeout(function () { copyBtn.textContent = 'Copy ảnh'; }, 1600); }
  });
  reBtn.addEventListener('click', function () { if (S.file && !S.isVideo) processImage(S.file).catch(function (_e) { globalThis.SEOSONA_swallow?.('watermark-tool#onerror', _e); }); });
  resetBtn.addEventListener('click', function () {
    revoke(); try { if (S.videoEl) { S.videoEl.pause(); S.videoEl.removeAttribute('src'); } } catch (_) { globalThis.SEOSONA_swallow?.('watermark-tool#onerror', _); }
    S = { file: null, isVideo: false, videoEl: null, blob: null, ext: 'png', beforeURL: null, afterURL: null };
    S.source = sourceSel ? sourceSel.value : 'gemini'; S.manualBox = null;
    fileInput.value = ''; ws.style.display = 'none'; stage.innerHTML = ''; dlBtn.disabled = true; copyBtn.disabled = true; reBtn.style.display = 'none';
  });

  // ── Nguồn watermark ────────────────────────────────────────────────────────
  if (sourceSel) {
    sourceSel.addEventListener('change', function () {
      onSourceChange();
      // đổi nguồn khi đã có ảnh → xử lý lại theo nguồn mới
      if (S.file && !S.isVideo) {
        if (S.source === 'manual') buildSelector(S.file).catch(function (_e) { globalThis.SEOSONA_swallow?.('watermark-tool#onerror', _e); });
        else processImage(S.file).catch(function (_e) { globalThis.SEOSONA_swallow?.('watermark-tool#onerror', _e); });
      }
    });
  }
  populateSources();

  // ── Drag & drop ──────────────────────────────────────────────────────────
  drop.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () { onFile(fileInput.files && fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
  drop.addEventListener('drop', function (e) { onFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
})();
