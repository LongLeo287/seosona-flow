/**
 * media-inject — overlay nút hành động ngay trên ẢNH và VIDEO AI (Flow, Gemini, ChatGPT, Grok…).
 * Rê chuột lên media lớn (nội dung do BẠN tạo) → hiện nút:
 *   ẢNH:   ⬇ Tải full size   — nâng URL lên gốc CDN (=s0 …) rồi tải.
 *          ✦ Xoá WM + tải     — xoá watermark ảnh → tải bản sạch (nơi có engine).
 *   VIDEO: ✦ Xoá WM video     — TRỪ NGƯỢC alpha chính xác (alpha-map Veo đo thật) per-frame
 *                              → re-encode WebM. Vá lân cận chỉ là đường lùi cuối.
 * 100% offline. CHỈ dùng cho nội dung của bạn — không nhắm tới watermark kho bản quyền.
 */
(function () {
  'use strict';
  if (window.__seosonaWmInject) return;
  window.__seosonaWmInject = true;

  var MIN = 180;          // media phải hiển thị tối thiểu 180px
  var MIN_NATURAL = 256;  // ảnh: độ phân giải gốc ≥ 256 → loại icon/avatar
  var target = null, busy = false, curIsVideo = false;
  // Bấm-lại-để-cưỡng-bức khi engine nhận diện yếu (tự hết hiệu lực sau 12s).
  var forceNext = false;

  function isVid(el) { return !!el && el.tagName === 'VIDEO'; }
  function qualifies(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < MIN || r.height < MIN) return false;
    if (isVid(el)) return !!(el.currentSrc || el.src);
    if (el.tagName !== 'IMG' || !el.src) return false;
    return (el.naturalWidth || 0) >= MIN_NATURAL;
  }

  // Nâng URL ảnh lên KÍCH THƯỚC GỐC theo CDN (giống _fullSizeUrl trong content.js).
  function fullSizeUrl(url) {
    if (!url || /^blob:|^data:/.test(url)) return url;
    try {
      if (url.indexOf('googleusercontent.com') >= 0 || url.indexOf('lh3.') >= 0 ||
          url.indexOf('ggpht.com') >= 0 || url.indexOf('storage.googleapis.com') >= 0) {
        var clean = url.replace(/=w\d+(-h\d+)?/g, '').replace(/=s\d+/g, '').replace(/=h\d+/g, '').replace(/=+$/, '');
        return clean + (clean.indexOf('=') >= 0 ? '-' : '=') + 's0';
      }
      var u = new URL(url);
      if (/twimg\.com/i.test(u.hostname)) { u.searchParams.set('name', 'orig'); return u.toString(); }
      ['w', 'h', 'width', 'height', 'resize', 'fit', 'sz', 'size'].forEach(function (p) { u.searchParams.delete(p); });
      return u.toString();
    } catch (_) { return url; }
  }

  // ── Overlay: container 2 nút ────────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.style.cssText = ['position:fixed', 'z-index:2147483600', 'display:none', 'gap:6px', 'flex-direction:row', 'align-items:center'].join(';');
  function mkBtn(label, bg, fg) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.style.cssText = [
      'display:flex', 'align-items:center', 'gap:5px', 'padding:6px 10px', 'border-radius:9px',
      'border:1px solid rgba(0,0,0,0.15)', 'background:' + bg, 'color:' + fg,
      'font:600 12px/1 system-ui,sans-serif', 'cursor:pointer', 'box-shadow:0 3px 10px rgba(0,0,0,0.35)', 'white-space:nowrap',
    ].join(';');
    return b;
  }
  var btnFull = mkBtn('⬇ Tải full size', '#ffffff', '#161616');
  var btnWm = mkBtn('✦ Xoá WM + tải', '#3d6ff5', '#ffffff');
  btnWm.setAttribute('aria-label', 'Xoá watermark rồi tải bản sạch');
  wrap.appendChild(btnFull);
  wrap.appendChild(btnWm);

  function attach() { if (document.body && !wrap.isConnected) document.body.appendChild(wrap); }
  attach();

  var hasEngine = !!window.WatermarkRemover;
  function place(el) {
    var r = el.getBoundingClientRect();
    hasEngine = !!window.WatermarkRemover;
    curIsVideo = isVid(el);
    // Video: chỉ nút xoá WM (download full-size video đi qua menu ⋮ của Flow, không phải URL-upsize).
    // Ảnh: cả 2 nút; nút WM chỉ hiện khi có engine.
    btnFull.style.display = curIsVideo ? 'none' : 'flex';
    btnWm.style.display = hasEngine ? 'flex' : 'none';
    btnWm.textContent = curIsVideo ? '✦ Xoá WM video' : '✦ Xoá WM + tải';
    if (!hasEngine && curIsVideo) { wrap.style.display = 'none'; return; } // video cần engine
    wrap.style.display = 'flex';
    wrap.style.top = Math.max(6, r.top + 8) + 'px';
    var w = curIsVideo ? 150 : (hasEngine ? 250 : 130);
    wrap.style.left = Math.max(6, Math.min(r.right - w - 8, window.innerWidth - w - 12)) + 'px';
  }
  function hideBtn() { wrap.style.display = 'none'; target = null; }

  document.addEventListener('mouseover', function (e) {
    if (busy) return;
    if (qualifies(e.target)) { target = e.target; attach(); place(target); }
  }, true);
  document.addEventListener('mouseout', function (e) {
    if (e.relatedTarget === wrap || (e.relatedTarget && wrap.contains(e.relatedTarget)) || busy) return;
    setTimeout(function () { if (!wrap.matches(':hover') && target && !target.matches(':hover')) hideBtn(); }, 120);
  }, true);
  window.addEventListener('scroll', function () { if (target && wrap.style.display !== 'none') place(target); }, true);

  // Lấy Blob: blob:/data: fetch tại chỗ; http(s) thử trực tiếp, fallback qua background (host_permissions).
  async function toBlob(src) {
    if (/^blob:|^data:/.test(src)) { var r0 = await fetch(src); return await r0.blob(); }
    try { var r = await fetch(src, { mode: 'cors' }); if (r.ok) return await r.blob(); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-inject#toBlob', _); }
    var resp = await new Promise(function (res) {
      try { chrome.runtime.sendMessage({ action: 'wm:fetchImage', url: src }, function (x) { res(chrome.runtime.lastError ? null : x); }); }
      catch (_) { res(null); }
    });
    if (resp && resp.ok && resp.base64) {
      var bin = atob(resp.base64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: resp.type || 'application/octet-stream' });
    }
    throw new Error('FETCH_FAILED');
  }
  async function fetchFullBlob(src) {
    var full = fullSizeUrl(src);
    if (full !== src) { try { return await toBlob(full); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-inject#fetchFullBlob', _); } }
    return await toBlob(src);
  }

  function extFromBlob(b) {
    var t = (b && b.type) || 'image/png';
    if (t.indexOf('jpeg') >= 0 || t.indexOf('jpg') >= 0) return 'jpg';
    if (t.indexOf('webp') >= 0) return 'webp';
    return 'png';
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 8000);
  }
  function toast(msg, ok) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;z-index:2147483601;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:10px;background:' + (ok ? '#1e2a12' : '#2a1616') + ';color:' + (ok ? '#19d07b' : '#ff9a9a') + ';font:13px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }


  // ── Lấy mẫu khung hình để VeoWatermarkProbe dò vị trí watermark ────────────────
  // Lấy từ 20%→80% thời lượng, KHÔNG lấy đầu video: allenk/VeoWatermarkRemover ghi nhận watermark
  // có thể mờ dần khi vào (fade-in), lấy khung đầu sẽ đo hụt hoặc trượt.
  async function probeVideoBox(v, cw, ch) {
    if (!window.VeoWatermarkProbe) return null;
    var dur = v.duration;
    if (!isFinite(dur) || dur <= 0) return null;

    // Dò trên bản THU NHỎ (cạnh dài ≤320px): nhanh hơn nhiều mà vị trí tương đối không đổi.
    var scale = Math.min(1, 320 / Math.max(cw, ch));
    var pw = Math.max(32, Math.round(cw * scale)), ph = Math.max(32, Math.round(ch * scale));
    var pc = document.createElement('canvas'); pc.width = pw; pc.height = ph;
    var pctx = pc.getContext('2d', { willReadFrequently: true });

    var N = 12, frames = [];
    for (var k = 0; k < N; k++) {
      var t = dur * (0.2 + 0.6 * (k / (N - 1)));
      var ok = await new Promise(function (res) {
        var done = false;
        var fin = function () { if (!done) { done = true; res(true); } };
        v.addEventListener('seeked', fin, { once: true });
        try { v.currentTime = t; } catch (_) { res(false); return; }
        setTimeout(function () { if (!done) { done = true; res(false); } }, 1200);
      });
      if (!ok) continue;
      try { pctx.drawImage(v, 0, 0, pw, ph); frames.push(pctx.getImageData(0, 0, pw, ph).data); }
      catch (_) { return null; }   // canvas bị taint → không đọc được pixel
    }
    if (frames.length < 5) return null;

    var st = window.VeoWatermarkProbe.temporalStats(frames, pw, ph);
    var hit = window.VeoWatermarkProbe.findBox(st, pw, ph);
    if (!hit) return null;
    try { v.currentTime = 0; } catch (_) { globalThis.SEOSONA_swallow?.('watermark-inject#setTimeout', _); }

    // Quy đổi ngược về kích thước thật.
    var inv = 1 / scale;
    return {
      corner: hit.corner, confidence: hit.confidence,
      box: {
        x: Math.round(hit.box.x * inv), y: Math.round(hit.box.y * inv),
        width: Math.round(hit.box.width * inv), height: Math.round(hit.box.height * inv),
      },
    };
  }

  // ── Video: inpaint góc Veo per-frame → re-encode WebM (giữ audio gốc) ─────────
  // srcBlob = video đã fetch về (blob same-origin → canvas KHÔNG bị taint). Chạy realtime 1× (play + record).
  async function removeVideoWatermark(srcBlob, opts) {
    opts = opts || {};
    if (!window.WatermarkRemover || typeof window.WatermarkRemover.inpaintContext !== 'function') throw new Error('ENGINE_MISSING');
    if (!(window.MediaRecorder)) throw new Error('MEDIARECORDER_UNSUPPORTED');
    var url = URL.createObjectURL(srcBlob);
    try {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.src = url;
      await new Promise(function (res, rej) { v.onloadedmetadata = res; v.onerror = function () { rej(new Error('VIDEO_LOAD_FAILED')); }; });
      var cw = v.videoWidth, ch = v.videoHeight;
      if (!cw || !ch) throw new Error('NO_DIMENSIONS');
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      var ctx = cv.getContext('2d');
      // Vị trí watermark: TỰ DÒ trước, bảng toạ độ chỉ là lưới an toàn.
      //
      // Vì sao không tin bảng toạ độ: boxFor() vốn là catalog watermark ẢNH Gemini (48px lề 32 /
      // 96px lề 64). Áp lên video Veo thì 4K vẫn ra ô 96px (hụt phần lớn), còn bản DỌC 9:16 thì
      // allenk/VeoWatermarkRemover ghi rõ Veo đã "dời viên kim cương vào sâu hơn từ góc".
      // VeoWatermarkProbe dò bằng phương sai THEO THỜI GIAN (watermark đứng yên, nội dung động)
      // nên tự đúng với mọi cỡ/vị trí, kể cả khi Google dời tiếp.
      var box = null, probed = null, unblend = null;
      try { probed = await probeVideoBox(v, cw, ch); } catch (_) { probed = null; }
      if (probed && probed.confidence >= 0.3) {
        // Nới 3px mỗi phía: rìa watermark mờ dần nên hộp dò được thường hụt vài pixel biên.
        var pad = 3;
        box = {
          x: Math.max(0, probed.box.x - pad), y: Math.max(0, probed.box.y - pad),
          width: Math.min(cw, probed.box.width + pad * 2), height: Math.min(ch, probed.box.height + pad * 2),
        };
        console.debug('[WM video] tự dò được:', probed.corner, JSON.stringify(box), 'tin cậy', probed.confidence.toFixed(2));
        // Dò ra được TÂM ⇒ đặt alpha-map hiệu chỉnh đúng chỗ và TRỪ NGƯỢC chính xác.
        if (window.VeoWatermarkProfile) {
          var P = window.VeoWatermarkProfile;
          unblend = {
            cx: probed.box.x + probed.box.width / 2, cy: probed.box.y + probed.box.height / 2,
            // Tỉ lệ suy từ kích thước sao dò được so với map đã hiệu chỉnh.
            scale: Math.max(0.25, Math.min(4, probed.box.width / P.MAP_W)),
          };
        }
      } else {
        // Không dò được (cảnh gần như tĩnh) → dùng hình học ĐO ĐƯỢC của Veo, vẫn trừ ngược chính xác.
        if (window.VeoWatermarkProfile) {
          var g = window.VeoWatermarkProfile.geometryFor(cw, ch);
          unblend = { cx: g.cx, cy: g.cy, scale: g.scale };
          box = g.box;
          console.debug('[WM video] không dò được → dùng hình học Veo đã hiệu chỉnh', JSON.stringify(box));
        } else {
          box = window.WatermarkRemover.boxFor(cw, ch, { corner: opts.corner || 'br', logoSize: opts.logoSize });
          console.debug('[WM video] không dò được và thiếu profile → bảng toạ độ cũ', JSON.stringify(box));
        }
      }
      var stream = cv.captureStream(30);
      try { var vs = v.captureStream ? v.captureStream() : (v.mozCaptureStream && v.mozCaptureStream()); if (vs) vs.getAudioTracks().forEach(function (tk) { stream.addTrack(tk); }); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-inject#onerror', _); }
      // MP4 trước, WebM là đường lùi — TikTok không nhận WebM (xem pickRecorderMime).
      var fmt = window.WatermarkRemover.pickRecorderMime(opts.format || 'mp4');
      var mime = fmt.mime;
      var flowMark;                 // undefined = chưa dò; null = không có dấu nào
      var flowPlace = null;         // vị trí + tỉ lệ mà bộ dò tìm ra, dùng lại cho mọi khung
      var flowTries = 0;
      var chunks = [];
      var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(16000000, Math.max(2500000, Math.round(cw * ch * 30 * 0.15))) });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var stopped = new Promise(function (res) { rec.onstop = res; });
      var drawing = true;
      function frame() {
        if (!drawing) return;
        try {
        ctx.drawImage(v, 0, 0, cw, ch);
        // Hồ sơ ĐO TỪ VIDEO THẬT đi TRƯỚC: nó biết chính xác dấu nào ở đâu, alpha bao nhiêu.
        // Dò một lần ở khung đầu rồi dùng lại — dấu không đổi giữa các khung, dò lại mỗi khung
        // vừa phí vừa có nguy cơ nhảy hồ sơ giữa chừng làm video giật.
        var ok = false;
        if (window.WatermarkRemover.detectFlowMark) {
          // Watermark có thể HIỆN DẦN ở đầu clip → dò trượt khung đầu là bỏ sót cả video.
          // Thử lại tới 48 khung (~2 giây) rồi mới kết luận là không có dấu.
          if (flowMark === undefined && flowTries < 48) {
            flowTries++;
            var hit = window.WatermarkRemover.detectFlowMark(ctx, cw, ch);
            if (hit) { flowMark = hit.id; flowPlace = hit.place; }
            else if (flowTries >= 48) flowMark = null;
            if (flowMark) console.debug('[WM video] nhận ra dấu', flowMark, 'khớp', hit.score.toFixed(2),
              'cỡ x' + hit.place.k.toFixed(2), 'tại', hit.place.bx + ',' + hit.place.by);
          }
          if (flowMark) ok = window.WatermarkRemover.removeFlowMark(ctx, cw, ch, flowMark, flowPlace);
        }
        if (unblend && window.VeoWatermarkProfile) {
          try {
            // Ưu tiên bản CÓ HIỆU CHỈNH THEO KHUNG — bản gain cố định làm mảng watermark nhấp
            // nháy giữa các khung (đo được: giật 1.741 so với 1.605 của chính video gốc).
            var r = window.VeoWatermarkProfile.unblendAdaptive(ctx, cw, ch, unblend);
            ok = !!(r && r.ok);
            if (!ok) ok = window.VeoWatermarkProfile.unblendContext(ctx, cw, ch, unblend);
          } catch (_) { ok = false; }
        }
        if (!ok) window.WatermarkRemover.inpaintContext(ctx, cw, ch, { box: box });
      } catch (_) { drawing = false; }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame); else requestAnimationFrame(frame);
      }
      rec.start();
      v.onended = function () { drawing = false; setTimeout(function () { try { rec.stop(); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-inject#onended', _); } }, 120); };
      // Backstop: video quá dài / onended miss → dừng theo duration + 2s
      var maxMs = Math.min(600000, (isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : 60000) + 2000);
      setTimeout(function () { if (drawing) { drawing = false; try { rec.stop(); } catch (_) { globalThis.SEOSONA_swallow?.('watermark-inject#setTimeout', _); } } }, maxMs);
      await v.play();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame); else frame();
      await stopped;
      // Canvas taint → toBlob/record fails sớm; nếu chunks rỗng coi như thất bại.
      if (!chunks.length) throw new Error('EMPTY_OUTPUT');
      var out = new Blob(chunks, { type: fmt.mime || 'video/webm' });
      out.seosonaExt = fmt.ext;      // đuôi file phải khớp thứ vừa ghi, không đoán
      out.seosonaFellBack = fmt.fellBack;
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  // Phơi ra cho content.js dùng lại ở đường TỰ ĐỘNG (chặn download → xoá watermark → tải).
  // Cùng world ISOLATED, cùng trang → dùng chung `window`. Không nhân bản pipeline: một chỗ
  // sửa là cả nút bấm tay lẫn đường tự động cùng được sửa.
  window.SEOSONA_removeVideoWatermark = removeVideoWatermark;

  // ⬇ Tải full size (ẢNH, mọi web) — KHÔNG đụng watermark.
  btnFull.addEventListener('click', async function (e) {
    e.preventDefault(); e.stopPropagation();
    if (busy || !target || curIsVideo) return;
    busy = true; var old = btnFull.textContent; btnFull.textContent = 'Đang tải…';
    try {
      var blob = await fetchFullBlob(target.currentSrc || target.src);
      saveBlob(blob, 'fullsize_' + Date.now() + '.' + extFromBlob(blob));
      toast('Đã tải full size (' + Math.round(blob.size / 1024) + ' KB)', true);
    } catch (err) { toast('Lỗi tải: ' + ((err && err.message) || err), false); }
    finally { busy = false; btnFull.textContent = old; hideBtn(); }
  });

  // ✦ Xoá watermark → tải bản sạch (ẢNH: PNG · VIDEO: WebM).
  btnWm.addEventListener('click', async function (e) {
    e.preventDefault(); e.stopPropagation();
    if (busy || !target) return;
    if (!window.WatermarkRemover) { toast('Engine chưa sẵn sàng trên web này', false); return; }
    var isV = isVid(target), src = target.currentSrc || target.src;
    busy = true; var old = btnWm.textContent; btnWm.textContent = isV ? 'Đang xử lý video…' : 'Đang xoá…';
    try {
      if (isV) {
        var vblob;
        try { vblob = await toBlob(src); }
        catch (_) { throw new Error('Không lấy được video (luồng stream) — hãy bấm ⋮ → Download → Original Size để tải file trước, rồi dùng tool watermark.'); }
        var cleaned = await removeVideoWatermark(vblob, { corner: 'br' });
        saveBlob(cleaned, 'nowatermark_' + Date.now() + '.' + (cleaned.seosonaExt || 'webm'));
        if (cleaned.seosonaFellBack) toast('Trình duyệt này chưa ghi được MP4 → đã xuất WebM.', true);
        toast('Đã xoá watermark video → tải WebM (' + Math.round(cleaned.size / 1024) + ' KB)', true);
      } else {
        var blob = await fetchFullBlob(src);
        var cleanedImg;
        try {
          cleanedImg = await window.WatermarkRemover.removeFromBlob(blob, { force: forceNext });
        } catch (e1) {
          // Engine nhận diện YẾU ⇒ nhiều khả năng ảnh này KHÔNG có watermark Gemini.
          // Đo được: 12/33 ảnh thường bị engine sửa oan nếu không chặn. Nên hỏi user thay vì
          // âm thầm sửa — bấm lần nữa là xoá cưỡng bức.
          if (e1 && e1.code === 'LOW_CONFIDENCE') {
            forceNext = true;
            setTimeout(function () { forceNext = false; }, 12000);
            toast('Không chắc ảnh này có watermark Gemini — bấm lại lần nữa để xoá cưỡng bức', false);
            return;
          }
          throw e1;
        }
        forceNext = false;
        saveBlob(cleanedImg, 'nowatermark_' + Date.now() + '.png');
        toast('Đã xoá watermark → tải PNG sạch', true);
      }
    } catch (err) { toast('Lỗi: ' + ((err && err.message) || err), false); }
    finally { busy = false; btnWm.textContent = old; hideBtn(); }
  });

  console.log('[SEOSONA Flow] Media overlay sẵn sàng (rê chuột lên ảnh/video → tải full size / xoá watermark).');
})();
