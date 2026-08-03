/**
 * TextOverlay — render CHỮ VECTOR sắc nét lên ảnh AI (100% client-side Canvas, offline).
 *
 * Vì sao: image model hay "rớt chữ / rớt dòng / sai dấu" vì nó sinh nội dung rồi KHÔNG tự soi lại
 * bố cục render (xem blog voquoccuong "rớt chữ rớt dòng"). Nguyên tắc SEOSONA: **AI quyết nội dung /
 * code deterministic dựng pixel** — để model chừa VÙNG TRỐNG (prompt img_text_reserve), rồi module này
 * overlay chữ thật bằng font (Be Vietnam Pro có sẵn) → chính tả/dấu/kerning/ngắt-dòng LUÔN đúng, đổi copy
 * chỉ re-render overlay (không sinh lại ảnh).
 *
 * Quy tắc layout port thẳng từ bài typography:
 *   - đo theo 45–75 ký tự/dòng (maxWidth), KHÔNG justify (justify tạo "sông trắng").
 *   - heading: cân dòng (balance) cho các dòng đều nhau.
 *   - body: tránh dòng cuối 1 chữ (pretty / chống "runt").
 *   - buộc cặp số+đơn vị bằng non-breaking space (nbsp) để không tách "50 triệu".
 *
 * API:
 *   TextOverlay.wrapLines(text, maxWidth, measure, {pretty}) -> string[]     // thuần, testable
 *   TextOverlay.balanceLines(text, maxWidth, measure) -> string[]            // thuần, cho heading
 *   TextOverlay.bindPairs(text, pairs) -> string                            // "50 triệu" -> "50 triệu"
 *   await TextOverlay.render(baseImage, items, opts) -> dataURL              // browser Canvas
 *     item: { text, zone:{x,y,w,h}, font, weight, color, align:'left|center|right',
 *             valign:'top|middle|bottom', mode:'body|heading', maxCharsPerLine, lineHeight, pairs:[[a,b]] }
 */
(function (root) {
  'use strict';

  var NBSP = ' ';

  // Tách text thành "từ" theo khoảng trắng THƯỜNG; giữ nguyên nbsp bên trong 1 từ (không tách ở đó).
  // LƯU Ý: JS \s KHỚP CẢ   → phải dùng [^\S ] (mọi whitespace TRỪ nbsp) để nbsp không bị gộp.
  function words(text) {
    return String(text == null ? '' : text).replace(/[^\S ]+/g, ' ').replace(/^ | $/g, '').split(' ').filter(Boolean);
  }

  // Buộc cặp (số+đơn vị, tên riêng...) bằng nbsp để không bị tách xuống dòng.
  function bindPairs(text, pairs) {
    var out = String(text == null ? '' : text);
    (pairs || []).forEach(function (p) {
      if (!Array.isArray(p) || p.length < 2) return;
      var a = String(p[0]), b = String(p[1]);
      // thay "a b" (space thường) -> "a b"
      out = out.split(a + ' ' + b).join(a + NBSP + b);
    });
    return out;
  }

  // Greedy wrap theo maxWidth, đo bằng measure(str)->number. measure mặc định = số ký tự.
  function _greedy(ws, maxWidth, measure) {
    var lines = [], cur = '';
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      var test = cur ? (cur + ' ' + w) : w;
      if (cur && measure(test) > maxWidth) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  // Wrap + (tuỳ chọn) "pretty": tránh dòng CUỐI chỉ có 1 từ (runt) — kéo 1 từ từ dòng trước xuống.
  function wrapLines(text, maxWidth, measure, opts) {
    opts = opts || {};
    measure = measure || function (s) { return s.length; };
    var ws = words(text);
    if (!ws.length) return [''];
    var lines = _greedy(ws, maxWidth, measure);
    if (opts.pretty !== false && lines.length >= 2) {
      var last = lines[lines.length - 1].split(' ');
      var prev = lines[lines.length - 2].split(' ');
      if (last.length === 1 && prev.length >= 2) {
        var moved = prev.pop();
        lines[lines.length - 2] = prev.join(' ');
        lines[lines.length - 1] = moved + ' ' + last.join(' ');
      }
    }
    return lines;
  }

  // Cân dòng cho HEADING: tìm width nhỏ nhất vẫn giữ NGUYÊN số dòng → các dòng đều hơn (balance).
  function balanceLines(text, maxWidth, measure) {
    measure = measure || function (s) { return s.length; };
    var ws = words(text);
    if (ws.length <= 1) return [ws.join(' ')];
    var base = _greedy(ws, maxWidth, measure);
    var target = base.length;
    if (target <= 1) return base;
    // width tối thiểu = từ dài nhất; binary search width nhỏ nhất giữ nguyên target dòng.
    var lo = 0;
    for (var i = 0; i < ws.length; i++) lo = Math.max(lo, measure(ws[i]));
    var hi = maxWidth, best = maxWidth;
    for (var it = 0; it < 24 && lo <= hi; it++) {
      var mid = (lo + hi) / 2;
      if (_greedy(ws, mid, measure).length <= target) { best = mid; hi = mid - 0.5; }
      else lo = mid + 0.5;
    }
    return _greedy(ws, best, measure);
  }

  // Tính zone (band chữ) từ preset vị trí + kích thước ảnh. Dùng chung tool + node text_overlay (DRY).
  function zoneFor(pos, w, h, opts) {
    opts = opts || {};
    var pad = (opts.padRatio != null ? opts.padRatio : 0.08) * w;
    if (pos === 'top') return { x: pad, y: h * 0.05, w: w - pad * 2, h: h * 0.25 };
    if (pos === 'bottom') return { x: pad, y: h * 0.70, w: w - pad * 2, h: h * 0.25 };
    return { x: pad, y: h * 0.35, w: w - pad * 2, h: h * 0.30 }; // center (mặc định)
  }

  // ---- Canvas render (browser-only) ----
  function _loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (typeof Image === 'undefined') { reject(new Error('no-Image')); return; }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('img-load-failed')); };
      if (src && src.width && src.getContext) { resolve(src); return; } // đã là canvas/img
      img.src = src;
    });
  }

  // Đo bằng ctx thật, tính maxWidth theo maxCharsPerLine (nếu có) hoặc theo bề rộng zone.
  function _renderItem(ctx, item) {
    var z = item.zone || { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height };
    var pad = item.padding != null ? item.padding : Math.round(Math.min(z.w, z.h) * 0.06);
    var avail = Math.max(1, z.w - pad * 2);
    var size = item.size || Math.round(z.h * 0.16);
    var weight = item.weight || (item.mode === 'heading' ? 700 : 500);
    var family = item.font || 'Be Vietnam Pro, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = item.color || '#111111';
    var measure = function (s) { ctx.font = weight + ' ' + size + 'px ' + family; return ctx.measureText(s).width; };
    // maxWidth: min(zone-avail, giới hạn 45-75 ký tự nếu đặt maxCharsPerLine)
    var maxWidth = avail;
    if (item.maxCharsPerLine) maxWidth = Math.min(avail, measure('M'.repeat(item.maxCharsPerLine)));
    var text = item.pairs ? bindPairs(item.text, item.pairs) : item.text;
    var lines = item.mode === 'heading'
      ? balanceLines(text, maxWidth, measure)
      : wrapLines(text, maxWidth, measure, { pretty: true });
    var lh = (item.lineHeight || 1.25) * size;
    var blockH = lines.length * lh;
    // valign
    var y0;
    if (item.valign === 'top') y0 = z.y + pad + size;
    else if (item.valign === 'bottom') y0 = z.y + z.h - pad - blockH + size;
    else y0 = z.y + (z.h - blockH) / 2 + size;
    ctx.font = weight + ' ' + size + 'px ' + family;
    var align = item.align || 'center';
    ctx.textAlign = align;
    var ax = align === 'left' ? (z.x + pad) : align === 'right' ? (z.x + z.w - pad) : (z.x + z.w / 2);
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], ax, y0 + i * lh);
    return lines;
  }

  async function render(baseImage, items, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') throw new Error('TextOverlay.render cần môi trường browser (Canvas).');
    var img = await _loadImage(baseImage);
    var w = img.width || opts.width, h = img.height || opts.height;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (img.getContext) ctx.drawImage(img, 0, 0);
    else ctx.drawImage(img, 0, 0, w, h);
    (items || []).forEach(function (it) { try { _renderItem(ctx, it); } catch (e) { /* skip 1 item lỗi */ } });
    return canvas.toDataURL(opts.type || 'image/png');
  }

  root.TextOverlay = {
    wrapLines: wrapLines,
    balanceLines: balanceLines,
    bindPairs: bindPairs,
    words: words,
    zoneFor: zoneFor,
    render: render,
    NBSP: NBSP,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
