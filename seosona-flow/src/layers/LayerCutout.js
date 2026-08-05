/**
 * LayerCutout — biến một ảnh phẳng thành LỚP RGBA bằng cách tách nền.
 *
 * Bối cảnh: Google Flow, ChatGPT, Grok đều chỉ trả ảnh RGB phẳng — không có mô hình nào trong
 * số đó xuất lớp trong suốt. Nhưng ta vẫn lấy được lớp: bảo mô hình vẽ ĐÚNG MỘT vật trên nền
 * phẳng đã hẹn trước, rồi cắt nền đó ra ở máy.
 *
 * Đây là toàn bộ ý tưởng "tách lớp" làm được NGAY, không cài gì. Chất lượng biên cắt kém hơn
 * mô hình xuất RGBA thật, nhưng nó cho đúng cái quan trọng nhất: các vật TÁCH RỜI VẬT LÝ, nên
 * sửa một vật không đụng vật khác — không cần mask, không cần inpaint, không tích luỹ sai số.
 *
 * Ba việc phải làm đúng, nếu không biên cắt sẽ xấu tới mức ý tưởng vô dụng:
 *   1. ĐO nền thật thay vì tin màu đã hẹn — mô hình không bao giờ cho đúng #00FF00.
 *   2. Khử VIỀN MÀU (spill): pixel sát mép hút màu nền, cắt xong còn quầng xanh/tím.
 *   3. Làm mềm biên theo khoảng cách màu, không cắt nhị phân — cắt cứng ra răng cưa.
 *
 * Module thuần trên ImageData: không DOM, không mạng.
 */
(function (root) {
  'use strict';

  // Màu nền đề nghị. Đặt theo độ HIẾM trong ảnh thật, không theo thói quen phim trường.
  var BACKDROPS = {
    magenta: [255, 0, 255],   // gần như không có trong ảnh thể thao/đời thường
    green: [0, 255, 0],       // quen thuộc nhưng đụng cỏ, áo xanh lá
    blue: [0, 0, 255],        // đụng trời, sân xanh
  };

  function _dist(r, g, b, key) {
    var dr = r - key[0], dg = g - key[1], db = b - key[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /**
   * ĐO màu nền thật từ bốn góc, thay vì tin màu đã hẹn.
   *
   * Mô hình sinh ảnh không bao giờ trả đúng #FF00FF — nó cho #F2:0A:E8 hoặc tương tự, còn dính
   * nhiễu nén. Tin màu hẹn trước là cắt hụt cả mảng nền.
   */
  function detectBackdrop(img, opt) {
    opt = opt || {};
    var pad = opt.pad || Math.max(4, Math.round(Math.min(img.width, img.height) * 0.02));
    var pts = [];
    var W = img.width, H = img.height, d = img.data;
    function push(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      var o = (y * W + x) * 4;
      pts.push([d[o], d[o + 1], d[o + 2]]);
    }
    // Lấy nhiều điểm quanh mỗi góc — một điểm lẻ có thể rơi trúng nhiễu.
    for (var i = 0; i < pad; i++) {
      push(i, i); push(W - 1 - i, i); push(i, H - 1 - i); push(W - 1 - i, H - 1 - i);
    }
    if (!pts.length) return null;
    var r = 0, g = 0, b = 0;
    for (var k = 0; k < pts.length; k++) { r += pts[k][0]; g += pts[k][1]; b += pts[k][2]; }
    r /= pts.length; g /= pts.length; b /= pts.length;

    // Bốn góc phải GIỐNG NHAU thì mới là nền phẳng. Lệch nhiều nghĩa là ảnh có bối cảnh thật
    // → cắt nền sẽ ăn vào chủ thể, phải báo chứ không làm liều.
    var spread = 0;
    for (k = 0; k < pts.length; k++) spread = Math.max(spread, _dist(pts[k][0], pts[k][1], pts[k][2], [r, g, b]));

    return {
      key: [Math.round(r), Math.round(g), Math.round(b)],
      spread: spread,
      flat: spread <= (opt.maxSpread != null ? opt.maxSpread : 40),
    };
  }

  /**
   * Cắt nền → trả ImageData có alpha.
   *
   * @param {ImageData} img
   * @param {object} [opt] {key, tolerance, softness, despill}
   *        key       : màu nền; bỏ trống thì tự đo
   *        tolerance : dưới khoảng cách này là nền hẳn (alpha 0)
   *        softness  : dải chuyển tiếp phía trên tolerance (alpha 0→255)
   *        despill   : 0..1, mức khử viền màu
   */
  function cutout(img, opt) {
    if (!img || !img.data) throw new Error('LayerCutout: ảnh không hợp lệ');
    opt = opt || {};
    var det = opt.key ? { key: opt.key, flat: true, spread: 0 } : detectBackdrop(img, opt);
    if (!det) throw new Error('LayerCutout: không đo được nền');
    var key = det.key;
    var tol = opt.tolerance != null ? opt.tolerance : 60;
    var soft = opt.softness != null ? opt.softness : 40;
    var despill = opt.despill != null ? opt.despill : 0.8;

    var W = img.width, H = img.height;
    var out = { width: W, height: H, data: new Uint8ClampedArray(img.data.length) };
    var s = img.data, o = out.data;
    var n = W * H;
    var kept = 0;

    // Kênh trội của nền — dùng để biết khử viền theo hướng nào.
    var kMax = Math.max(key[0], key[1], key[2]);
    var kIdx = key[0] === kMax ? 0 : (key[1] === kMax ? 1 : 2);

    for (var i = 0; i < n; i++) {
      var p = i * 4;
      var r = s[p], g = s[p + 1], b = s[p + 2];
      var dist = _dist(r, g, b, key);

      var alpha;
      if (dist <= tol) alpha = 0;
      else if (dist >= tol + soft) alpha = 255;
      else alpha = Math.round(((dist - tol) / soft) * 255);

      if (alpha > 0) {
        kept++;
        if (despill > 0) {
          // Kéo kênh nền xuống mức trung bình hai kênh còn lại — đúng chỗ quầng màu sinh ra.
          var others = (r + g + b - [r, g, b][kIdx]) / 2;
          var cur = [r, g, b][kIdx];
          if (cur > others) {
            var fixed = cur + (others - cur) * despill;
            if (kIdx === 0) r = fixed; else if (kIdx === 1) g = fixed; else b = fixed;
          }
        }
      }
      o[p] = r; o[p + 1] = g; o[p + 2] = b; o[p + 3] = alpha;
    }

    return {
      image: out,
      key: key,
      backdropFlat: det.flat,
      backdropSpread: det.spread,
      keptRatio: kept / n,
      // Cảnh báo thật, không phải trang trí: hai ca này nghĩa là ảnh KHÔNG hợp để tách lớp.
      warnings: [].concat(
        det.flat ? [] : ['nền không phẳng (lệch ' + Math.round(det.spread) + ') — ảnh có bối cảnh thật, cắt sẽ ăn vào chủ thể'],
        kept / n > 0.97 ? ['gần như không cắt được gì — có thể sai màu nền hoặc mô hình không vẽ trên nền phẳng'] : [],
        kept / n < 0.02 ? ['cắt mất gần hết — nền và chủ thể quá giống màu'] : []
      ),
    };
  }

  /** Hộp bao phần còn lại sau khi cắt — để cắt sát và biết vật nằm đâu. */
  function boundsOf(rgba, minAlpha) {
    var a = minAlpha != null ? minAlpha : 8;
    var W = rgba.width, H = rgba.height, d = rgba.data;
    var x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] >= a) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  root.SEOSONA_LayerCutout = {
    BACKDROPS: BACKDROPS,
    detectBackdrop: detectBackdrop,
    cutout: cutout,
    boundsOf: boundsOf,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
