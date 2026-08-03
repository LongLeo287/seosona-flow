/**
 * WatermarkRemover — xoá watermark logo Gemini (góc dưới-phải) bằng REVERSE ALPHA BLENDING chính xác,
 * 100% client-side Canvas, 100% offline. KHÔNG đụng watermark ẩn (SynthID) — chỉ logo nhìn thấy.
 *
 * Thuật toán + alpha-map hiệu chỉnh: từ GargantuaX/gemini-watermark-remover (MIT — Copyright (c) 2025 Jad;
 * (c) 2024 AllenK). Gemini blend: watermarked = α·logo + (1−α)·original → giải ngược:
 *   original = (watermarked − α·logo) / (1−α)
 * α lấy từ alpha-map nhúng sẵn (watermark-alpha-data.js). Vị trí: catalog Gemini (>1024² → 96px lề 64,
 * else 48px lề 32) + local-anchor refine (snap đúng vị trí). Có fallback inpaint cho watermark khác.
 *
 * API:
 *   await WatermarkRemover.removeFromBlob(blob, opts) -> Blob
 *   opts: { method:'alpha'|'inpaint', corner:'br'|'bl'|'tr'|'tl', logoSize:48|96, alphaGain:number, refine:bool, type }
 *   WatermarkRemover.boxFor(w,h,opts) -> {x,y,width,height}
 */
(function (root) {
  'use strict';

  // Hằng số reverse-alpha (blendModes.js gốc).
  var ALPHA_NOISE_FLOOR = 3 / 255, ALPHA_THRESHOLD = 0.002, MAX_ALPHA = 0.99, LOGO_VALUE = 255;
  // Ngưỡng cổng an toàn — xem chú thích tại chỗ dùng. Đo trên 33 ảnh thường + 27 ảnh có watermark.
  var GATE_MIN_GRADIENT = 0.30;

  function detectConfig(w, h, sizeOverride) {
    if (sizeOverride === 96) return { logoSize: 96, mr: 64, mb: 64 };
    if (sizeOverride === 48) return { logoSize: 48, mr: 32, mb: 32 };
    if (w > 1024 && h > 1024) return { logoSize: 96, mr: 64, mb: 64 };
    return { logoSize: 48, mr: 32, mb: 32 };
  }
  function positionFor(w, h, cfg, corner) {
    corner = corner || 'br';
    var s = cfg.logoSize;
    var x = /r$/.test(corner) ? (w - cfg.mr - s) : cfg.mr;
    var y = /^b/.test(corner) ? (h - cfg.mb - s) : cfg.mb;
    return { x: Math.max(0, Math.min(x, w - s)), y: Math.max(0, Math.min(y, h - s)), width: s, height: s };
  }
  function boxFor(w, h, opts) {
    opts = opts || {};
    return positionFor(w, h, detectConfig(w, h, opts.logoSize), opts.corner);
  }
  // Alpha-map gốc orient cho góc dưới-phải; lật ngang/dọc cho góc khác.
  function orientAlpha(map, size, corner) {
    var flipH = /l$/.test(corner || 'br'), flipV = /^t/.test(corner || 'br');
    if (!flipH && !flipV) return map;
    var out = new Float32Array(map.length);
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      var sr = flipV ? size - 1 - r : r, sc = flipH ? size - 1 - c : c;
      out[r * size + c] = map[sr * size + sc];
    }
    return out;
  }

  // Reverse alpha blending (blendModes.js gốc, 1:1).
  function reverseAlpha(imageData, alphaMap, pos, options) {
    options = options || {};
    var x = pos.x, y = pos.y, width = pos.width, height = pos.height;
    var gain = (isFinite(options.alphaGain) && options.alphaGain > 0) ? options.alphaGain : 1;
    var data = imageData.data, iw = imageData.width;
    for (var row = 0; row < height; row++) {
      for (var col = 0; col < width; col++) {
        var imgIdx = ((y + row) * iw + (x + col)) * 4;
        var rawAlpha = alphaMap[row * width + col];
        var mag = Math.abs(rawAlpha);
        var logoValue = isFinite(options.logoValue) ? options.logoValue : (rawAlpha < 0 ? 0 : LOGO_VALUE);
        var signal = Math.max(0, mag - ALPHA_NOISE_FLOOR) * gain;
        if (signal < ALPHA_THRESHOLD) continue;
        var alpha = Math.min(mag * gain, MAX_ALPHA);
        var inv = 1.0 - alpha;
        for (var ch = 0; ch < 3; ch++) {
          var wm = data[imgIdx + ch];
          var orig = (wm - alpha * logoValue) / inv;
          data[imgIdx + ch] = Math.max(0, Math.min(255, Math.round(orig)));
        }
      }
    }
  }

  // Điểm khớp = Σ α·(luma − trung bình vùng) / Σα (chuẩn hoá → so sánh được giữa size 48/96).
  // Watermark làm pixel alpha-cao SÁNG HƠN nền → điểm cao nơi/size đúng; nền sáng đều → ~0 (không nhầm).
  function scoreAt(imageData, alphaMap, x, y, w, h) {
    var data = imageData.data, iw = imageData.width, ih = imageData.height;
    if (x < 0 || y < 0 || x + w > iw || y + h > ih) return -Infinity;
    var mean = 0, cnt = 0, r, c, idx, luma;
    for (r = 0; r < h; r += 2) for (c = 0; c < w; c += 2) {
      idx = ((y + r) * iw + (x + c)) * 4;
      mean += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]; cnt++;
    }
    mean /= Math.max(1, cnt);
    var s = 0, sumA = 0, a;
    for (r = 0; r < h; r += 2) for (c = 0; c < w; c += 2) {
      a = Math.abs(alphaMap[r * w + c]); if (a < 0.05) continue;
      idx = ((y + r) * iw + (x + c)) * 4;
      luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      s += a * (luma - mean); sumA += a;
    }
    return sumA > 0 ? s / sumA : -Infinity;
  }
  function refinePosition(imageData, alphaMap, pos, R) {
    R = R || 8;
    var best = { x: pos.x, y: pos.y, width: pos.width, height: pos.height, score: scoreAt(imageData, alphaMap, pos.x, pos.y, pos.width, pos.height) };
    for (var oy = -R; oy <= R; oy++) for (var ox = -R; ox <= R; ox++) {
      var sc = scoreAt(imageData, alphaMap, pos.x + ox, pos.y + oy, pos.width, pos.height);
      if (sc > best.score) best = { x: pos.x + ox, y: pos.y + oy, width: pos.width, height: pos.height, score: sc };
    }
    return best;
  }
  // Chọn size (48/96) + vị trí TỐT NHẤT theo correlation (thay đoán thô >1024²). Trả {cfg, alpha, pos} hoặc null.
  function pickBestConfig(imageData, w, h, opts) {
    opts = opts || {};
    var alphaData = root.WatermarkAlphaData;
    if (!alphaData || typeof alphaData.getEmbeddedAlphaMap !== 'function') return null;
    var cands = opts.logoSize ? [detectConfig(w, h, opts.logoSize)] : [detectConfig(w, h, 96), detectConfig(w, h, 48)];
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var cfg = cands[i], p = positionFor(w, h, cfg, opts.corner);
      if (p.x < 0 || p.y < 0 || p.x + p.width > w || p.y + p.height > h) continue;
      var am = alphaData.getEmbeddedAlphaMap(cfg.logoSize); if (!am) continue;
      am = orientAlpha(am, cfg.logoSize, opts.corner);
      var pos = (opts.refine !== false) ? refinePosition(imageData, am, p, 8)
        : { x: p.x, y: p.y, width: p.width, height: p.height, score: scoreAt(imageData, am, p.x, p.y, p.width, p.height) };
      if (!best || pos.score > best.pos.score) best = { cfg: cfg, alpha: am, pos: pos };
    }
    return best;
  }

  // ── Tự động phát hiện vùng watermark (2026-07-09) ──────────────────────────
  // Heuristic dùng cho watermark góc AI-gen KHÔNG phải Gemini (Gemini đã có GWR detect).
  // Ý tưởng: watermark góc = cụm cạnh (logo/chữ bán trong suốt) bám sát 1 góc. Sobel edge-map →
  // quét 4 góc → cụm cạnh dày & bám góc nhất → bbox thít chặt. Trả {x,y,width,height,corner,score}
  // hoặc null nếu không đủ tin (score thấp) → caller khỏi đụng ảnh sạch.
  function detectBox(imageData) {
    var w = imageData.width, h = imageData.height, d = imageData.data;
    if (w < 40 || h < 40) return null;
    // grayscale
    var g = new Float32Array(w * h);
    for (var i = 0, p = 0; i < d.length; i += 4, p++) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // Sobel magnitude + thu thập thống kê để ngưỡng thích ứng
    var mag = new Float32Array(w * h);
    var sum = 0, cnt = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var o = y * w + x;
        var gx = -g[o - w - 1] - 2 * g[o - 1] - g[o + w - 1] + g[o - w + 1] + 2 * g[o + 1] + g[o + w + 1];
        var gy = -g[o - w - 1] - 2 * g[o - w] - g[o - w + 1] + g[o + w - 1] + 2 * g[o + w] + g[o + w + 1];
        var m = Math.abs(gx) + Math.abs(gy);
        mag[o] = m; sum += m; cnt++;
      }
    }
    var mean = sum / Math.max(1, cnt);
    var thr = mean * 2.2 + 8; // ngưỡng cạnh "mạnh"
    var win = Math.round(0.42 * Math.min(w, h)); // cửa sổ tìm mỗi góc
    var corners = [
      { name: 'br', cx: w - 1, cy: h - 1, x0: w - win, y0: h - win, x1: w, y1: h },
      { name: 'bl', cx: 0, cy: h - 1, x0: 0, y0: h - win, x1: win, y1: h },
      { name: 'tr', cx: w - 1, cy: 0, x0: w - win, y0: 0, x1: w, y1: win },
      { name: 'tl', cx: 0, cy: 0, x0: 0, y0: 0, x1: win, y1: win },
    ];
    var best = null;
    for (var c = 0; c < corners.length; c++) {
      var cn = corners[c];
      var minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, ec = 0, wSum = 0;
      for (var yy = cn.y0; yy < cn.y1; yy++) {
        for (var xx = cn.x0; xx < cn.x1; xx++) {
          if (mag[yy * w + xx] > thr) {
            // trọng số ưu tiên pixel gần góc (watermark bám góc/cạnh)
            var dc = 1 - (Math.abs(xx - cn.cx) + Math.abs(yy - cn.cy)) / (2 * win);
            if (dc < 0) dc = 0;
            ec++; wSum += dc;
            if (xx < minx) minx = xx; if (xx > maxx) maxx = xx;
            if (yy < miny) miny = yy; if (yy > maxy) maxy = yy;
          }
        }
      }
      if (maxx < 0 || ec < 12) continue;
      var bw = maxx - minx + 1, bh = maxy - miny + 1;
      var area = bw * bh;
      var density = ec / area;              // cụm dày = watermark, thưa = chi tiết ảnh
      var cornerBias = wSum / ec;           // bám góc
      var sizePenalty = area > 0.25 * win * win ? 0.5 : 1; // box quá to → chắc là chi tiết ảnh
      var score = density * cornerBias * sizePenalty * Math.min(1, ec / 60);
      if (!best || score > best.score) best = { corner: cn.name, x: minx, y: miny, width: bw, height: bh, score: score, ec: ec, density: density };
    }
    // Ngưỡng tin cậy: score thấp → coi như không có watermark rõ (tránh đụng ảnh sạch).
    if (!best || best.score < 0.12) return null;
    // pad nhẹ + kẹp biên
    var pad = Math.round(Math.min(w, h) * 0.01) + 2;
    best.x = Math.max(0, best.x - pad); best.y = Math.max(0, best.y - pad);
    best.width = Math.min(w - best.x, best.width + pad * 2);
    best.height = Math.min(h - best.y, best.height + pad * 2);
    return best;
  }

  // Fallback inpaint (watermark KHÔNG phải Gemini) — vá bằng dải lân cận.
  function inpaint(ctx, canvas, box, opts) {
    var pad = opts.pad != null ? opts.pad : 6;
    var x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
    var bw = Math.min(canvas.width - x, box.width + pad * 2), bh = Math.min(canvas.height - y, box.height + pad * 2);
    if (bw <= 0 || bh <= 0) return;
    var sx, sy;
    if (x - bw >= 0) { sx = x - bw; sy = y; }
    else if (x + bw * 2 <= canvas.width) { sx = x + bw; sy = y; }
    else if (y - bh >= 0) { sx = x; sy = y - bh; }
    else { sx = Math.max(0, x - bw); sy = y; }
    ctx.drawImage(canvas, sx, sy, bw, bh, x, y, bw, bh);
    try {
      var t = makeCanvas(bw + 6, bh + 6), tc = t.getContext('2d');
      tc.filter = 'blur(2px)'; tc.drawImage(canvas, x - 3, y - 3, bw + 6, bh + 6, 0, 0, bw + 6, bh + 6);
      ctx.drawImage(t, 0, 0, bw + 6, bh + 6, x - 3, y - 3, bw + 6, bh + 6);
    } catch (_) { globalThis.SEOSONA_swallow?.('WatermarkRemover#inpaint', _); }
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function canvasToBlob(canvas, type, q) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: type, quality: q });
    return new Promise(function (r) { canvas.toBlob(function (b) { r(b); }, type, q); });
  }

  async function removeFromBlob(blob, opts) {
    opts = opts || {};
    if (!blob) return blob;
    var bmp; try { bmp = await createImageBitmap(blob); } catch (_) { return blob; }
    var w = bmp.width, h = bmp.height;
    if (!w || !h) return blob;
    var canvas = makeCanvas(w, h), ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    try { bmp.close && bmp.close(); } catch (_) { globalThis.SEOSONA_swallow?.('WatermarkRemover#removeFromBlob', _); }

    var done = false;
    // opts.box (chọn vùng thủ công) → luôn inpaint đúng vùng đó, bỏ qua alpha-pipeline Gemini.
    // Đây là đường trung thực cho MỌI nguồn AI khác Gemini: không giả vờ có alpha-map hiệu chỉnh
    // (chỉ Gemini có), user khoanh chính xác watermark → vá đúng vùng, không đụng phần còn lại.
    var forceInpaint = opts.method === 'inpaint' || !!opts.box;
    // Ưu tiên PIPELINE THẬT (gwr-bundle, MIT) — có detection + decision-gate + alpha calibration đa-pass:
    // KHÔNG đụng ảnh khi không có watermark thật, không over-subtract (fix "hoá đen / xoá nhầm icon thiết kế").
    if (!forceInpaint && root.GWR && typeof root.GWR.removeWatermarkFromImageDataSync === 'function') {
      try {
        var img = ctx.getImageData(0, 0, w, h);
        var gopts = {};
        // alphaGain user (nếu chỉnh khác 1) → ép candidate; else để pipeline tự calibrate (chất lượng tốt nhất).
        if (isFinite(opts.alphaGain) && opts.alphaGain > 0 && Math.abs(opts.alphaGain - 1) > 0.01) gopts.alphaGainCandidates = [opts.alphaGain];
        var res = root.GWR.removeWatermarkFromImageDataSync(img, gopts);

        // ── CỔNG AN TOÀN (2026-07-28) ────────────────────────────────────────
        // Engine tự nhận là "applied" QUÁ DỄ DÃI. Đo trên 33 ảnh thường (không phải Gemini):
        // 12/33 bị nó sửa oan — có ảnh mất tới 2.716 pixel. Với ảnh chụp/thiết kế của user thì
        // đó là hỏng ảnh mà KHÔNG ai biết, tệ hơn nhiều so với việc bỏ sót watermark.
        //
        // originalGradientScore tách hai nhóm rất tốt (ảnh Gemini thật đo được 0.81):
        //   ngưỡng 0.20 → lọt 2 ảnh oan   ·   0.25–0.30 → LỌT 0   ·   0.40 → mất thêm ca thật
        // Chọn 0.30: giữ 21/27 ca thật (78%) mà không để lọt ảnh nào. Có margin trên mức 0.20
        // là chỗ bắt đầu rò.
        //
        // Bỏ sót thì user NHÌN THẤY và bấm lại được (opts.force); sửa oan thì im lặng.
        var meta = res && res.meta, det = (meta && meta.detection) || {};
        var grad = det.originalGradientScore;
        if (res && res.imageData && meta && meta.applied && !opts.force &&
            typeof grad === 'number' && grad < GATE_MIN_GRADIENT) {
          var e = new Error('LOW_CONFIDENCE');
          e.code = 'LOW_CONFIDENCE';
          e.gradient = grad;
          e.spatial = det.originalSpatialScore;
          throw e;   // KHÔNG putImageData → ảnh giữ nguyên
        }

        if (res && res.imageData) { ctx.putImageData(res.imageData, 0, 0); done = true; }
      } catch (err) {
        if (err && err.code === 'LOW_CONFIDENCE') throw err;   // đẩy lên cho UI hỏi user
        /* lỗi khác → rơi xuống fallback */
      }
    }
    // Fallback: method='inpaint'/box (watermark khác Gemini) HOẶC GWR lỗi → vá lân cận.
    // opts.box {x,y,width,height} = vùng thủ công user khoanh; else tính từ corner+size.
    if (!done) {
      var wmBox = (opts.box && opts.box.width > 0 && opts.box.height > 0)
        ? opts.box
        : positionFor(w, h, detectConfig(w, h, opts.logoSize), opts.corner);
      inpaint(ctx, canvas, wmBox, opts);
    }

    // Xuất: PNG lossless mặc định (giữ nguyên chất lượng ngoài vùng logo).
    var type = opts.type || 'image/png';
    if (type === 'image/jpeg' || type === 'image/webp') return canvasToBlob(canvas, type, opts.quality || 0.95);
    return canvasToBlob(canvas, 'image/png');
  }

  async function removeFromUrl(url, opts) {
    var resp = await fetch(url); var blob = await resp.blob(); return removeFromBlob(blob, opts);
  }

  // Áp xoá watermark lên khung hình HIỆN TẠI của canvas (video — gọi mỗi frame). Dùng pipeline THẬT (GWR):
  // detection + decision-gate → frame không có watermark giữ nguyên, không hoá đen. Chậm hơn (full pipeline).
  function applyToContext(ctx, w, h, opts) {
    opts = opts || {};
    if (opts.method === 'inpaint') return false;
    if (!(root.GWR && typeof root.GWR.removeWatermarkFromImageDataSync === 'function')) return false;
    try {
      var img = ctx.getImageData(0, 0, w, h);
      var res = root.GWR.removeWatermarkFromImageDataSync(img, {});
      if (res && res.imageData) { ctx.putImageData(res.imageData, 0, 0); return true; }
    } catch (_) { globalThis.SEOSONA_swallow?.('WatermarkRemover#applyToContext', _); }
    return false;
  }

  // Inpaint watermark GÓC trên MỘT frame đang vẽ (ctx) — dùng cho VIDEO per-frame (Veo/nguồn inpaint).
  // Khác applyToContext (chỉ chạy GWR/Gemini reverse-alpha): hàm này vá góc bằng copy vùng lân cận + blur,
  // đúng cho watermark logo góc (Veo bottom-right). opts.box override vùng; else tính theo corner/logoSize.
  function inpaintContext(ctx, w, h, opts) {
    opts = opts || {};
    try {
      var box = opts.box || boxFor(w, h, opts);
      inpaint(ctx, ctx.canvas, box, opts);
      return true;
    } catch (_) { return false; }
  }

  // Preset nguồn watermark AI-gen (ẢNH DO USER TỰ TẠO). CHỈ Gemini có reverse-alpha chính xác
  // (alpha-map hiệu chỉnh). Các nguồn khác = inpaint góc (vá lân cận) — chất lượng thấp hơn, nên
  // ưu tiên 'manual' (user tự khoanh vùng) khi vị trí/độ mờ khác preset. KHÔNG có preset nào cho
  // watermark kho bản quyền (Shutterstock/Getty/…) — cố ý.
  var SOURCES = {
    auto:     { label: 'Tự động phát hiện', method: 'auto', auto: true },
    gemini:   { label: 'Gemini / Nano Banana', method: 'alpha', corner: 'br', precise: true },
    flow_veo:  { label: 'Google Flow · Veo (đo thật)',   method: 'profile', profile: 'flow_veo' },
    flow_omni: { label: 'Google Flow · Omni (đo thật)',  method: 'profile', profile: 'flow_omni' },
    ideogram: { label: 'Ideogram', method: 'inpaint', corner: 'br' },
    grok:     { label: 'Grok / xAI', method: 'inpaint', corner: 'bl' },
    dalle:    { label: 'DALL·E (5 ô màu)', method: 'inpaint', corner: 'br', logoSize: 48 },
    manual:   { label: 'Khác — tự khoanh vùng', method: 'inpaint', manual: true },
  };
  // Trả opts cơ bản cho 1 nguồn (merge thêm khi gọi removeFromBlob).
  function optsForSource(id) {
    var s = SOURCES[id] || SOURCES.gemini;
    var o = { method: s.method };
    if (s.corner) o.corner = s.corner;
    if (s.logoSize) o.logoSize = s.logoSize;
    return o;
  }

  /**
   * Chọn định dạng ghi cho MediaRecorder — ƯU TIÊN MP4.
   *
   * Xoá watermark video bắt buộc phải encode lại từng khung, nên định dạng ra là do ta chọn,
   * không phải do file gốc. WebM thì Chrome nào cũng ghi được, nhưng TikTok KHÔNG nhận —
   * người dùng phải tự convert, mà convert lần nữa là mất chất lượng lần nữa.
   *
   * Chrome bản mới ghi thẳng được MP4 (H.264+AAC) từ MediaRecorder, nên không cần nhúng
   * thư viện muxer nào. Bản cũ không hỗ trợ thì tự rơi về WebM — dò năng lực chứ không dò
   * số hiệu phiên bản, vì hỗ trợ còn tuỳ codec có sẵn của từng máy.
   *
   * @param {'mp4'|'webm'|'auto'} prefer
   * @returns {{mime:string, ext:string, fellBack:boolean}}
   */
  function pickRecorderMime(prefer) {
    var MR = root.MediaRecorder;
    var supported = function (m) { try { return !!(MR && MR.isTypeSupported && MR.isTypeSupported(m)); } catch (_e) { return false; } };
    var MP4 = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',   // H.264 baseline + AAC — phổ dụng nhất
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];
    var WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    var i;
    if (prefer !== 'webm') {
      for (i = 0; i < MP4.length; i++) if (supported(MP4[i])) return { mime: MP4[i], ext: 'mp4', fellBack: false };
    }
    for (i = 0; i < WEBM.length; i++) {
      if (supported(WEBM[i])) return { mime: WEBM[i], ext: 'webm', fellBack: prefer !== 'webm' };
    }
    return { mime: '', ext: 'webm', fellBack: prefer !== 'webm' };   // để trình duyệt tự quyết
  }

  /**
   * Xoá watermark Google Flow bằng hồ sơ ĐO TỪ VIDEO THẬT (FlowWatermarkProfiles).
   *
   * Hai dấu, hai cách — xem ghi chú trong file hồ sơ:
   *   Omni (sao 4 cánh, alpha ≤0.68) → TRỪ NGƯỢC alpha, khôi phục lại nền gần như nguyên vẹn.
   *   Veo  (chữ nét ~2px, alpha đạt 1) → VÁ từ lân cận; trừ ngược ở đây hỏng vì nén H.264 làm
   *   nhoè quan hệ alpha, và nét đục thì không còn thông tin nền để mà khôi phục.
   *
   * CHỈ đụng vào đúng ô watermark. Phần còn lại của khung hình không bị chạm tới một byte nào —
   * đó là lý do cách này không làm giảm chất lượng, khác hẳn việc lọc/làm mờ cả ảnh.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w,h kích thước khung
   * @param {'flow_omni'|'flow_veo'} id
   * @returns {boolean} đã xử lý hay chưa
   */
  /**
   * Chỗ đặt hộp watermark ứng với một tỉ lệ co giãn.
   *
   * Mẫu đo được đều ở cạnh ngắn 1080 nên KHÔNG biết chắc Flow vẽ dấu cỡ cố định hay co theo
   * khung. Thay vì bắt người dùng tải thử một video 720p rồi báo lại, bộ dò thử CẢ HAI giả
   * thiết (và vài mức giữa) rồi chọn cái khớp nhất — máy tự trả lời được thì đừng hỏi người.
   */
  function _place(p, w, h, k) {
    var bw = Math.max(4, Math.round(p.w * k)), bh = Math.max(4, Math.round(p.h * k));
    var bx = Math.round(w - p.right * k - bw), by = Math.round(h - p.bottom * k - bh);
    return { bx: Math.max(0, Math.min(w - bw, bx)), by: Math.max(0, Math.min(h - bh, by)), bw: bw, bh: bh, k: k };
  }

  function removeFlowMark(ctx, w, h, id, pl) {
    var FP = root.FlowWatermarkProfiles;
    var p = FP && FP.PROFILES[id];
    if (!p || !ctx || !w || !h) return false;
    if (!pl) pl = _place(p, w, h, Math.min(w, h) / p.ref);
    var bw = pl.bw, bh = pl.bh, bx = pl.bx, by = pl.by;
    var img = ctx.getImageData(bx, by, bw, bh), d = img.data;
    // Lấy mẫu hàng xóm gần nhất: hồ sơ và ô đích chỉ lệch nhau khi video không phải 1080.
    var nn = function (buf, stride, x, y, c) {
      var sx = Math.min(p.w - 1, Math.floor(x * p.w / bw)), sy = Math.min(p.h - 1, Math.floor(y * p.h / bh));
      return buf[(sy * p.w + sx) * stride + c];
    };
    var x, y, i, c;
    if (p.method === 'unblend') {
      var A = FP.bytes(p.alpha), C = FP.bytes(p.color);
      for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
        var a = nn(A, 1, x, y, 0) / 255;
        if (a <= 0.02) continue;                       // ngoài hình → không đụng
        if (a > 0.95) a = 0.95;                        // chặn nổ; hồ sơ Omni tối đa 0.68 nên không chạm
        i = (y * bw + x) * 4;
        for (c = 0; c < 3; c++) {
          var v = (d[i + c] - a * nn(C, 3, x, y, c)) / (1 - a);
          d[i + c] = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
      }
      // RÌA thì VÁ chứ không trừ. Trừ ngược làm sạch ruột nhưng để lại ĐƯỜNG VIỀN: alpha ở
      // ranh giới hình bị đo hụt (khớp hồi quy làm mượt qua biên subpixel) nên rìa trừ lệch,
      // và mắt bắt ngay đường mảnh đó — dù sai số TRUNG BÌNH đã đạt sàn nhiễu. Trung bình
      // không đo được "còn cấu trúc hay không".
      // Ruột vẫn trừ ngược nên chi tiết thật nằm dưới hình được giữ lại; chỉ dải biên là dựng
      // lại từ lân cận. Quét thử trên 43 khung: 5.66 (chỉ trừ) → 2.91.
      if (p.band) _diffuse(d, bw, bh, _maskOf(FP.bytes(p.band), p, bw, bh));
    } else {
      // Vá: khuếch tán từ pixel lành vào lỗ. Lỗ chỉ vài trăm px nên hội tụ nhanh và không để vệt.
      var hole = _maskOf(FP.bytes(p.mask), p, bw, bh);
      _diffuse(d, bw, bh, hole);
    }
    ctx.putImageData(img, bx, by);
    return true;
  }

  /** Bung mặt nạ bit của hồ sơ ra đúng cỡ ô đích (ô co giãn theo độ phân giải video). */
  function _maskOf(M, p, bw, bh) {
    var out = new Uint8Array(bw * bh);
    for (var y = 0; y < bh; y++) for (var x = 0; x < bw; x++) {
      var sx = Math.min(p.w - 1, Math.floor(x * p.w / bw)), sy = Math.min(p.h - 1, Math.floor(y * p.h / bh));
      var bit = sy * p.w + sx;
      out[y * bw + x] = (M[bit >> 3] >> (7 - (bit & 7))) & 1;
    }
    return out;
  }

  /** Khuếch tán từ pixel lành vào lỗ; sửa TẠI CHỖ trên mảng RGBA của ô. */
  function _diffuse(d, bw, bh, hole) {
    var i, c, x, y;
    {
      var buf = new Float32Array(bw * bh * 3), nxt = new Float32Array(bw * bh * 3);
      for (i = 0; i < bw * bh; i++) for (c = 0; c < 3; c++) buf[i * 3 + c] = d[i * 4 + c];
      var it, n, sum, cnt, dx, dy, xx, yy;
      for (it = 0; it < 220; it++) {
        nxt.set(buf);
        for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
          n = y * bw + x;
          if (!hole[n]) continue;
          for (c = 0; c < 3; c++) {
            sum = 0; cnt = 0;
            for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              xx = x + dx; yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
              sum += buf[(yy * bw + xx) * 3 + c]; cnt++;
            }
            if (cnt) nxt[n * 3 + c] = sum / cnt;
          }
        }
        buf.set(nxt);
      }
      for (i = 0; i < bw * bh; i++) if (hole[i]) for (c = 0; c < 3; c++) d[i * 4 + c] = buf[i * 3 + c];
    }
  }

  /**
   * Video này mang dấu nào? Áp nhầm hồ sơ là PHÁ vùng vốn không có watermark, nên phải dò
   * chứ không đoán theo tên model.
   *
   * Cách dò: ở nơi hồ sơ nói có dấu, pixel phải SÁNG HƠN vành xung quanh đúng theo mức alpha.
   * So tương quan giữa "độ sáng vượt trội thực tế" và "alpha kỳ vọng" — trùng khớp thì có dấu.
   * @returns {{id:string, score:number}|null}
   */
  function p0ref(FP) { var k = Object.keys(FP.PROFILES)[0]; return FP.PROFILES[k].ref || 1080; }

  function detectFlowMark(ctx, w, h) {
    var FP = root.FlowWatermarkProfiles;
    if (!FP || !ctx || !w || !h) return null;
    var best = null;
    var prop = Math.min(w, h) / p0ref(FP);
    // Hai giả thiết chính: dấu co theo khung (prop) hay cỡ cố định (1). Thêm 2 mức giữa để
    // đỡ trượt nếu Flow làm kiểu khác. Ở 1080 thì prop = 1 nên chỉ còn đúng một ứng viên.
    var SCALES = [prop, 1, (prop + 1) / 2, prop * 1.12, prop * 0.9];
    Object.keys(FP.PROFILES).forEach(function (id) {
      var p = FP.PROFILES[id];
      SCALES.forEach(function (k) {
      var pl = _place(p, w, h, k);
      var bw = pl.bw, bh = pl.bh, bx = pl.bx, by = pl.by;
      if (bx < 2 || by < 2 || bw < 4 || bh < 4) return;
      var pad = Math.max(3, Math.round(6 * k));
      var ox = Math.max(0, bx - pad), oy = Math.max(0, by - pad);
      var ow = Math.min(w - ox, bw + pad * 2), oh = Math.min(h - oy, bh + pad * 2);
      var im = ctx.getImageData(ox, oy, ow, oh), d = im.data;
      // Nền tham chiếu = trung bình vành ngoài (không nằm trong ô dấu).
      var rsum = 0, rn = 0, x, y, i;
      for (y = 0; y < oh; y++) for (x = 0; x < ow; x++) {
        if (x >= bx - ox && x < bx - ox + bw && y >= by - oy && y < by - oy + bh) continue;
        i = (y * ow + x) * 4; rsum += (d[i] + d[i + 1] + d[i + 2]) / 3; rn++;
      }
      if (!rn) return;
      var bg = rsum / rn;
      // Tương quan giữa vượt-sáng thực tế và alpha kỳ vọng.
      var sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, n = 0;
      var wantA = p.method === 'unblend' ? FP.bytes(p.alpha) : null;
      var M = p.method === 'inpaint' ? FP.bytes(p.mask) : null;
      for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
        var sx = Math.min(p.w - 1, Math.floor(x * p.w / bw)), sy = Math.min(p.h - 1, Math.floor(y * p.h / bh));
        var av;
        if (wantA) av = wantA[sy * p.w + sx] / 255;
        else { var bit = sy * p.w + sx; av = (M[bit >> 3] >> (7 - (bit & 7))) & 1; }
        i = ((y + by - oy) * ow + (x + bx - ox)) * 4;
        var ex = (d[i] + d[i + 1] + d[i + 2]) / 3 - bg;
        sa += av; sb += ex; sab += av * ex; saa += av * av; sbb += ex * ex; n++;
      }
      if (n < 16) return;
      var num = sab - sa * sb / n;
      var den = Math.sqrt(Math.max(1e-6, (saa - sa * sa / n) * (sbb - sb * sb / n)));
      var r = num / den;
      if (!best || r > best.score) best = { id: id, score: r, place: pl };
      });
    });
    // 0.35 chọn từ mẫu thật: video CÓ dấu đạt ~0.7-0.9, video sạch dao động quanh 0.
    return best && best.score >= 0.35 ? best : null;
  }

  /**
   * Vùng dấu còn "nổi" hơn xung quanh bao nhiêu? Đo TRƯỚC và SAU để biết xoá có ăn không.
   *
   * Người dùng không thể tự đánh giá bằng mắt: dấu Omni chỉ 72px trong ảnh 1920px, xem vừa
   * khung thì nó nhỏ hơn đầu kim. Nên engine phải tự chấm và nói ra con số.
   *
   * Cách đo: chênh lệch độ sáng trung bình giữa pixel THUỘC hình dấu và vành ngay ngoài nó.
   * Còn dấu → chênh lớn; xoá sạch → chênh về gần 0 như mọi vùng ảnh bình thường.
   * @returns {number|null} độ chênh (mức xám)
   */
  function markContrast(ctx, w, h, id, pl) {
    var FP = root.FlowWatermarkProfiles;
    var p = FP && FP.PROFILES[id];
    if (!p || !ctx) return null;
    if (!pl) pl = _place(p, w, h, Math.min(w, h) / p.ref);
    var pad = Math.max(4, Math.round(8 * pl.k));
    var ox = Math.max(0, pl.bx - pad), oy = Math.max(0, pl.by - pad);
    var ow = Math.min(w - ox, pl.bw + pad * 2), oh = Math.min(h - oy, pl.bh + pad * 2);
    if (ow < 4 || oh < 4) return null;
    var d = ctx.getImageData(ox, oy, ow, oh).data;
    var A = p.method === 'unblend' ? FP.bytes(p.alpha) : null;
    var M = p.method === 'inpaint' ? FP.bytes(p.mask) : null;
    var inSum = 0, inN = 0, outSum = 0, outN = 0, x, y, i;
    for (y = 0; y < oh; y++) for (x = 0; x < ow; x++) {
      i = (y * ow + x) * 4;
      var lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      var bx = x - (pl.bx - ox), by = y - (pl.by - oy);
      var on = false;
      if (bx >= 0 && by >= 0 && bx < pl.bw && by < pl.bh) {
        var sx = Math.min(p.w - 1, Math.floor(bx * p.w / pl.bw)), sy = Math.min(p.h - 1, Math.floor(by * p.h / pl.bh));
        if (A) on = A[sy * p.w + sx] / 255 > 0.12;
        else { var bit = sy * p.w + sx; on = !!((M[bit >> 3] >> (7 - (bit & 7))) & 1); }
      }
      if (on) { inSum += lum; inN++; } else { outSum += lum; outN++; }
    }
    if (!inN || !outN) return null;
    return Math.abs(inSum / inN - outSum / outN);
  }

  root.WatermarkRemover = {
    markContrast: markContrast,
    removeFlowMark: removeFlowMark, detectFlowMark: detectFlowMark,
    pickRecorderMime: pickRecorderMime,
    removeFromBlob: removeFromBlob, removeFromUrl: removeFromUrl, boxFor: boxFor,
    detectConfig: detectConfig, positionFor: positionFor, applyToContext: applyToContext,
    pickBestConfig: pickBestConfig, SOURCES: SOURCES, optsForSource: optsForSource,
    detectBox: detectBox, inpaintContext: inpaintContext,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
