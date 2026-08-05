/**
 * CanvasReframe — đưa ảnh về khung dọc theo quy tắc bố cục, và nói rõ chỗ nào phải mở rộng.
 *
 * Quy tắc lấy từ §11 của đặc tả (bản cầu lông dọc 9:16):
 *   · tâm thị giác của thân nằm ở 44–48% chiều ngang
 *   · chừa đầu (headroom) 18–22% chiều cao
 *   · chừa sàn (floor margin) 10–14% chiều cao
 *
 * Module này KHÔNG cắt ảnh. Nó TÍNH ra hình chữ nhật cần lấy và các dải phải mở rộng, rồi trả
 * về con số. Tách vậy vì hai lý do:
 *   · tính toán bố cục kiểm được bằng test thuần, không cần canvas thật;
 *   · phần vẽ (cắt/giãn) là vài dòng canvas ở nơi gọi, còn phần DỄ SAI là hình học ở đây.
 *
 * Điểm cốt lõi: khi khung đích rộng hơn ảnh gốc, phần thiếu KHÔNG được bịa ra ở đây. Nó được
 * trả về dưới dạng `border` — đúng thứ mà §11 cho phép outpaint, và cũng là thứ duy nhất
 * compare_diff được phép bỏ qua khi đo trôi.
 *
 * Module thuần: không DOM, không mạng.
 */
(function (root) {
  'use strict';

  function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function _parseAspect(a) {
    var m = String(a || '9:16').split(':');
    var w = parseFloat(m[0]), h = parseFloat(m[1]);
    if (!(w > 0) || !(h > 0)) throw new Error('CanvasReframe: tỉ lệ không hợp lệ: ' + a);
    return w / h;
  }

  function _mid(range, fallback) {
    if (!Array.isArray(range) || range.length !== 2) return fallback;
    return (range[0] + range[1]) / 2;
  }

  /**
   * @param {object} src     {width, height}
   * @param {object} subject {x, y, width, height} — hộp bao chủ thể trong toạ độ ảnh gốc
   * @param {object} comp    {aspect, bodyCenterX, headroom, floorMargin} — từ SportPreset
   * @returns {object} kế hoạch reframe
   */
  function plan(src, subject, comp) {
    if (!src || !(src.width > 0) || !(src.height > 0)) throw new Error('CanvasReframe: ảnh không hợp lệ');
    if (!subject || !(subject.height > 0)) throw new Error('CanvasReframe: hộp chủ thể không hợp lệ');
    comp = comp || {};

    var ratio = _parseAspect(comp.aspect || '9:16');
    var headroom = _mid(comp.headroom, 0.20);
    var floor = _mid(comp.floorMargin, 0.12);
    var centerX = _mid(comp.bodyCenterX, 0.46);

    // Chủ thể chiếm phần giữa: 1 - chừa đầu - chừa sàn.
    var bodyBand = 1 - headroom - floor;
    if (bodyBand <= 0.05) throw new Error('CanvasReframe: chừa đầu + chừa sàn ăn hết khung');

    // Chiều cao khung đích suy từ chiều cao chủ thể và dải cho phép.
    var outH = subject.height / bodyBand;
    var outW = outH * ratio;

    // Đặt khung sao cho đỉnh chủ thể nằm đúng dưới phần chừa đầu, và tâm ngang đúng vị trí.
    var subjCx = subject.x + subject.width / 2;
    var left = subjCx - outW * centerX;
    var top = subject.y - outH * headroom;

    // Dải phải mở rộng (âm = thiếu ảnh ở phía đó).
    var need = {
      left: Math.max(0, Math.round(-left)),
      top: Math.max(0, Math.round(-top)),
      right: Math.max(0, Math.round(left + outW - src.width)),
      bottom: Math.max(0, Math.round(top + outH - src.height)),
    };
    var needsOutpaint = need.left > 0 || need.top > 0 || need.right > 0 || need.bottom > 0;

    // Hình chữ nhật LẤY ĐƯỢC từ ảnh gốc (đã cắt về trong biên).
    var cropX = _clamp(Math.round(left), 0, src.width);
    var cropY = _clamp(Math.round(top), 0, src.height);
    var cropW = _clamp(Math.round(outW) - need.left - need.right, 0, src.width - cropX);
    var cropH = _clamp(Math.round(outH) - need.top - need.bottom, 0, src.height - cropY);

    return {
      schema: 'seosona.sports.reframe.v1',
      aspect: comp.aspect || '9:16',
      output: { width: Math.round(outW), height: Math.round(outH) },
      // Vùng đọc từ ảnh gốc.
      crop: { x: cropX, y: cropY, width: cropW, height: cropH },
      // Vị trí dán vùng đó vào khung đích — lệch đúng bằng phần phải mở rộng.
      paste: { x: need.left, y: need.top },
      needsOutpaint: needsOutpaint,
      border: need,
      applied: {
        headroom: headroom, floorMargin: floor, bodyCenterX: centerX,
      },
    };
  }

  /**
   * Mask viền: 1 ở phần phải mở rộng, 0 ở phần lấy từ ảnh gốc.
   *
   * Đây là `mask.border` mà §11 nói tới — vùng DUY NHẤT được phép outpaint, và cũng là vùng
   * duy nhất compare_diff được loại trừ khi đo trôi. Thiếu nó thì mọi ảnh mở rộng khung đều
   * bị chấm là "trôi quá ngưỡng" dù không có gì sai.
   */
  function borderMask(planRec) {
    if (!planRec || !planRec.output) throw new Error('CanvasReframe: kế hoạch không hợp lệ');
    var W = planRec.output.width, H = planRec.output.height;
    var m = new Uint8Array(W * H);
    var px = planRec.paste.x, py = planRec.paste.y;
    var cw = planRec.crop.width, ch = planRec.crop.height;
    for (var y = 0; y < H; y++) {
      var insideY = y >= py && y < py + ch;
      for (var x = 0; x < W; x++) {
        var insideX = x >= px && x < px + cw;
        m[y * W + x] = (insideX && insideY) ? 0 : 255;
      }
    }
    return { width: W, height: H, data: m };
  }

  /** Bố cục thực tế có nằm trong dải cho phép không — dùng cho validator. */
  function check(planRec, subject, comp) {
    comp = comp || {};
    var H = planRec.output.height;
    var topGap = subject.y - (planRec.crop.y - planRec.paste.y);
    var headroom = topGap / H;
    var bottomGap = H - (topGap + subject.height);
    var floor = bottomGap / H;
    var inRange = function (v, r) {
      return Array.isArray(r) ? (v >= r[0] - 0.005 && v <= r[1] + 0.005) : true;
    };
    return {
      headroom: headroom,
      floorMargin: floor,
      headroomOk: inRange(headroom, comp.headroom),
      floorOk: inRange(floor, comp.floorMargin),
    };
  }

  root.SEOSONA_CanvasReframe = {
    plan: plan,
    borderMask: borderMask,
    check: check,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
