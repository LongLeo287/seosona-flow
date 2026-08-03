/**
 * VeoWatermarkProbe — TỰ DÒ watermark video (Veo) bằng thông tin THỜI GIAN, không chép cứng toạ độ.
 *
 * ══ VÌ SAO CẦN ══
 * Đường video cũ dùng WatermarkRemover.boxFor() — vốn là catalog hình học của watermark ẢNH Gemini
 * (48px lề 32 / 96px lề 64). Áp lên video Veo là sai catalog:
 *   · 3840×2160 (4K) vẫn ra ô 96px  → hụt phần lớn watermark
 *   · 720×1280 (9:16) ra ô 48px lề 32 → allenk/VeoWatermarkRemover ghi rõ bản DỌC mới của Veo đã
 *     "dời viên kim cương vào sâu hơn từ góc"
 * Chép cứng bảng toạ độ Veo cũng không bền: Google đã đổi một lần thì sẽ đổi nữa.
 *
 * ══ Ý TƯỞNG ══
 * Video có thứ ảnh tĩnh không có: THỜI GIAN. Watermark ĐỨNG YÊN trong khi nội dung ĐỘNG.
 * Với watermarked = α·L + (1−α)·original, qua nhiều khung hình:
 *     var(watermarked) = (1−α)² · var(original)
 * ⇒ vùng watermark có phương sai theo thời gian bị NÉN lại so với lân cận. Từ đó suy ra α:
 *
 *   ① từ PHƯƠNG SAI:  α = 1 − √(var_trong / var_thamChiếu)
 *   ② từ TRUNG BÌNH:  α = (mean_trong − mean_thamChiếu) / (L − mean_thamChiếu)
 *
 * Hai ước lượng ĐỘC LẬP nhau. Chỉ tin khi chúng ĐỒNG Ý — đó là hàng rào chống đoán bừa: cảnh tĩnh
 * (var≈0) hay vùng trời trắng đều làm một trong hai lệch, và ta sẽ hạ độ tin cậy thay vì phá ảnh.
 *
 * Ưu điểm: tự hiệu chỉnh theo mọi cỡ/vị trí, sống sót khi Google dời watermark, không cần alpha-map
 * ngoài (bản Veo nằm trong file .exe C++ của allenk, không lấy được cho JS).
 *
 * API (hàm thuần, không đụng DOM — test được):
 *   VeoWatermarkProbe.temporalStats(frames, w, h) -> { mean, variance, n }
 *   VeoWatermarkProbe.findBox(stats, w, h, opts)  -> { box, corner, confidence } | null
 *   VeoWatermarkProbe.estimateAlpha(stats, box, w) -> { alpha:Float32Array, confidence, agree }
 */
(function (root) {
  'use strict';

  var LOGO_VALUE = 255;          // watermark Veo/Gemini là lớp phủ trắng
  var MIN_REF_VAR = 12;          // phương sai tham chiếu quá thấp = cảnh tĩnh → không kết luận được
  // Ngưỡng nén. Lưu ý: sup ≈ α, nên 0.25 tương đương "chỉ nhận watermark có α ≥ ~0.25".
  // Không hạ thấp hơn: phương sai mẫu với ~12 khung rất nhiễu (chi-square ~11 bậc tự do), ngưỡng
  // thấp làm ~25% pixel SẠCH lọt vào và thổi phồng hộp (đo được: lệch 34px).
  var SUPPRESS_MIN = 0.25;
  var AGREE_TOL = 0.22;          // hai ước lượng α lệch quá mức này ⇒ không tin

  /** Độ sáng cảm nhận. Dùng luma thay vì trung bình RGB để watermark trắng nổi đúng. */
  function _luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  /**
   * Trung bình + phương sai THEO THỜI GIAN cho từng pixel.
   * @param {Array<Uint8ClampedArray>} frames  mỗi phần tử là RGBA của 1 khung (cùng kích thước)
   */
  function temporalStats(frames, w, h) {
    var n = frames.length;
    if (!n || !w || !h) return null;
    var px = w * h;
    var mean = new Float32Array(px), m2 = new Float32Array(px);
    for (var f = 0; f < n; f++) {
      var d = frames[f];
      for (var i = 0; i < px; i++) {
        var v = _luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        // Welford: ổn định số học hơn cộng dồn bình phương (video dài, giá trị lớn).
        var delta = v - mean[i];
        mean[i] += delta / (f + 1);
        m2[i] += delta * (v - mean[i]);
      }
    }
    var variance = new Float32Array(px);
    var denom = n > 1 ? (n - 1) : 1;
    for (var j = 0; j < px; j++) variance[j] = m2[j] / denom;
    return { mean: mean, variance: variance, n: n, width: w, height: h };
  }

  /**
   * Làm mượt phương sai theo KHÔNG GIAN (hộp 3×3) trước khi so sánh.
   * Phương sai mẫu từ ~12 khung rất nhiễu; trung bình 9 pixel lân cận cắt nhiễu đi ~3 lần mà
   * watermark thì vốn là mảng liền nên gần như không bị mờ đi. Đây là thứ tách được "vùng bị nén
   * thật" khỏi "pixel tình cờ ít biến thiên".
   */
  function _smoothVar(variance, w, h) {
    var out = new Float32Array(variance.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = 0, c = 0;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= w) continue;
            s += variance[yy * w + xx]; c++;
          }
        }
        out[y * w + x] = s / c;
      }
    }
    return out;
  }

  /** Phương sai trung vị của một dải — làm mốc "nội dung động bình thường". */
  function _medianVar(variance, w, x0, y0, x1, y1) {
    var vals = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) vals.push(variance[y * w + x]);
    if (!vals.length) return 0;
    vals.sort(function (a, b) { return a - b; });
    return vals[vals.length >> 1];
  }

  /**
   * Dò hộp watermark ở 4 góc. Trả null khi không đủ bằng chứng — KHÔNG đoán bừa,
   * vì vá nhầm vùng còn tệ hơn để nguyên watermark.
   */
  function findBox(stats, w, h, opts) {
    if (!stats) return null;
    var o = opts || {};
    var band = Math.round(Math.min(w, h) * (o.bandRatio || 0.34));   // dải tìm ở mỗi góc
    band = Math.max(64, Math.min(band, Math.min(w, h)));
    // Dùng bản ĐÃ LÀM MƯỢT cho việc dò vị trí (chống nhiễu); ước lượng α vẫn dùng bản gốc.
    var variance = _smoothVar(stats.variance, w, h), mean = stats.mean;

    var corners = [
      { id: 'br', x0: w - band, y0: h - band },
      { id: 'bl', x0: 0, y0: h - band },
      { id: 'tr', x0: w - band, y0: 0 },
      { id: 'tl', x0: 0, y0: 0 },
    ];

    var best = null;
    for (var c = 0; c < corners.length; c++) {
      var cx0 = Math.max(0, corners[c].x0), cy0 = Math.max(0, corners[c].y0);
      var cx1 = Math.min(w, cx0 + band), cy1 = Math.min(h, cy0 + band);

      // Mốc tham chiếu lấy ở TRUNG TÂM khung — nơi chắc chắn không có watermark.
      var refVar = _medianVar(variance, w, Math.round(w * 0.3), Math.round(h * 0.3),
                                          Math.round(w * 0.7), Math.round(h * 0.7));
      if (refVar < MIN_REF_VAR) return null;    // cảnh gần như tĩnh → không suy ra được gì

      // Đếm ứng viên theo TỪNG CỘT/HÀNG thay vì chỉ ghi cực trị.
      // Lý do: nội dung ngẫu nhiên luôn có vài pixel tình cờ ít biến thiên; nếu lấy min/max thô thì
      // MỘT pixel lạc ở xa cũng thổi phồng hộp (đo được: lệch 34px trên video tổng hợp).
      var colHits = new Int32Array(cx1 - cx0), rowHits = new Int32Array(cy1 - cy0);
      var hits = 0, sumSup = 0;
      for (var y = cy0; y < cy1; y++) {
        for (var x = cx0; x < cx1; x++) {
          var i = y * w + x;
          var sup = 1 - Math.sqrt(Math.max(0, variance[i]) / refVar);   // mức bị nén
          // Watermark vừa BỊ NÉN phương sai, vừa SÁNG hơn — hai điều kiện cùng lúc mới tính.
          if (sup > SUPPRESS_MIN && mean[i] > 40) {
            hits++; sumSup += sup;
            colHits[x - cx0]++; rowHits[y - cy0]++;
          }
        }
      }
      if (hits < 32) continue;                       // quá ít pixel → nhiễu

      // Giữ cột/hàng có mật độ ≥ 35% mức đỉnh — watermark là khối ĐẶC, nhiễu thì thưa.
      var _bounds = function (arr, off) {
        var peak = 0, k;
        for (k = 0; k < arr.length; k++) if (arr[k] > peak) peak = arr[k];
        var cut = Math.max(2, peak * 0.35), lo = -1, hi = -1;
        for (k = 0; k < arr.length; k++) if (arr[k] >= cut) { if (lo < 0) lo = k; hi = k; }
        return lo < 0 ? null : { lo: lo + off, hi: hi + off };
      };
      var bx = _bounds(colHits, cx0), by = _bounds(rowHits, cy0);
      if (!bx || !by) continue;
      var minX = bx.lo, maxX = bx.hi, minY = by.lo, maxY = by.hi;
      var bw = maxX - minX + 1, bh = maxY - minY + 1;
      var fill = hits / (bw * bh);                   // hộp phải ĐẶC, không phải đốm rải rác
      if (fill < 0.18) continue;
      var conf = Math.min(1, (sumSup / hits) * fill * 2.4);
      if (!best || conf > best.confidence) {
        best = {
          box: { x: minX, y: minY, width: bw, height: bh },
          corner: corners[c].id, confidence: conf, pixels: hits, refVar: refVar,
        };
      }
    }
    return best;
  }

  /**
   * Ước lượng α cho từng pixel trong hộp, bằng HAI cách độc lập rồi đối chiếu.
   * Không đồng ý ⇒ confidence thấp ⇒ caller nên quay về inpaint thay vì trừ bừa.
   */
  function estimateAlpha(stats, box, w, opts) {
    if (!stats || !box) return null;
    var o = opts || {};
    var variance = stats.variance, mean = stats.mean;

    // Vành đai quanh hộp làm tham chiếu — cùng vùng ảnh nên thống kê nội dung tương đương.
    var pad = Math.max(6, Math.round(Math.max(box.width, box.height) * 0.5));
    var rx0 = Math.max(0, box.x - pad), ry0 = Math.max(0, box.y - pad);
    var rx1 = Math.min(stats.width, box.x + box.width + pad), ry1 = Math.min(stats.height, box.y + box.height + pad);
    var refVals = [], refMeans = [];
    for (var y = ry0; y < ry1; y++) {
      for (var x = rx0; x < rx1; x++) {
        if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) continue;
        refVals.push(variance[y * w + x]); refMeans.push(mean[y * w + x]);
      }
    }
    if (refVals.length < 40) return null;
    refVals.sort(function (a, b) { return a - b; });
    refMeans.sort(function (a, b) { return a - b; });
    var refVar = refVals[refVals.length >> 1], refMean = refMeans[refMeans.length >> 1];
    if (refVar < MIN_REF_VAR) return null;
    if (refMean > LOGO_VALUE - 25) return null;      // nền đã gần trắng → mẫu số ~0, không chia được

    var alpha = new Float32Array(box.width * box.height);
    var sumA1 = 0, sumA2 = 0, cnt = 0;
    for (var yy = 0; yy < box.height; yy++) {
      for (var xx = 0; xx < box.width; xx++) {
        var i = (box.y + yy) * w + (box.x + xx);
        var a1 = 1 - Math.sqrt(Math.max(0, variance[i]) / refVar);            // ① từ phương sai
        var a2 = (mean[i] - refMean) / (LOGO_VALUE - refMean);                // ② từ trung bình
        a1 = Math.max(0, Math.min(0.99, a1));
        a2 = Math.max(0, Math.min(0.99, a2));
        alpha[yy * box.width + xx] = a1;
        sumA1 += a1; sumA2 += a2; cnt++;
      }
    }
    var mA1 = sumA1 / cnt, mA2 = sumA2 / cnt;
    var diff = Math.abs(mA1 - mA2);
    var agree = diff <= AGREE_TOL;
    // Đồng ý càng sát ⇒ càng tin. Không đồng ý ⇒ về 0 để caller tự chuyển sang inpaint.
    var confidence = agree ? Math.max(0, 1 - diff / AGREE_TOL) * Math.min(1, mA1 / 0.25) : 0;

    return { alpha: alpha, box: box, confidence: confidence, agree: agree,
             alphaFromVariance: mA1, alphaFromMean: mA2, refMean: refMean, refVar: refVar };
  }

  root.VeoWatermarkProbe = {
    temporalStats: temporalStats, findBox: findBox, estimateAlpha: estimateAlpha,
    _consts: { LOGO_VALUE: LOGO_VALUE, MIN_REF_VAR: MIN_REF_VAR, SUPPRESS_MIN: SUPPRESS_MIN, AGREE_TOL: AGREE_TOL },
  };
})(typeof self !== 'undefined' ? self : this);
