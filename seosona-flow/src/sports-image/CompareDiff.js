/**
 * CompareDiff — đo ĐỘ TRÔI kỹ thuật giữa ảnh gốc và ảnh sau khi sửa.
 *
 * Chương 10 của đặc tả tách rõ hai lớp và bảo chúng phải ĐỘC LẬP:
 *   · compare diff  — đo pixel trôi bao nhiêu (lớp này)
 *   · sports validator — phán xét hợp lý về thể thao (module bên cạnh)
 * Lý do tách: một ảnh trôi rất ít vẫn có thể sai hoàn toàn về mặt thể thao (cầm vợt ngược,
 * hai quả cầu), và ngược lại một ảnh trôi nhiều vì mở rộng khung vẫn có thể đúng.
 *
 * Module thuần, làm việc trên ImageData. Không DOM, không mạng.
 */
(function (root) {
  'use strict';

  function _same(a, b) {
    return a && b && a.width === b.width && a.height === b.height;
  }

  /**
   * Tỉ lệ pixel ĐỔI, có ngưỡng nhiễu.
   *
   * Vì sao cần ngưỡng: nén lại một lần là mọi pixel lệch ±1–2 mức. Đếm thô thì ảnh không sửa gì
   * cũng ra "100% đổi". `tolerance` mặc định 6/255 lọc đúng loại nhiễu đó mà vẫn bắt được thay
   * đổi thật.
   *
   * @param {ImageData} a ảnh gốc
   * @param {ImageData} b ảnh sau sửa
   * @param {object} [opt] {tolerance, mask, insideMask}
   *        mask: Uint8Array cùng số pixel (0 = ngoài vùng, >0 = trong vùng)
   *        insideMask: true → chỉ đếm TRONG mask; false → chỉ đếm NGOÀI mask
   */
  function changedRatio(a, b, opt) {
    opt = opt || {};
    if (!_same(a, b)) return { ok: false, reason: 'SIZE_MISMATCH', ratio: null };
    var tol = opt.tolerance != null ? opt.tolerance : 6;
    var mask = opt.mask || null;
    var wantInside = opt.insideMask === true;
    var da = a.data, db = b.data;
    var n = a.width * a.height;
    var counted = 0, changed = 0, sum = 0, peak = 0;
    for (var i = 0; i < n; i++) {
      if (mask) {
        var inMask = mask[i] > 0;
        if (inMask !== wantInside) continue;
      }
      counted++;
      var o = i * 4;
      var d = Math.abs(da[o] - db[o]) + Math.abs(da[o + 1] - db[o + 1]) + Math.abs(da[o + 2] - db[o + 2]);
      d = d / 3;
      sum += d;
      if (d > peak) peak = d;
      if (d > tol) changed++;
    }
    return {
      ok: true,
      reason: null,
      counted: counted,
      changed: changed,
      ratio: counted ? changed / counted : 0,
      meanDelta: counted ? sum / counted : 0,
      peakDelta: peak,
    };
  }

  /**
   * Kiểm TÍNH TOÀN VẸN CỦA MASK: mọi thay đổi phải nằm TRONG vùng mask (đã nới + feather).
   *
   * Đây là phép đo quan trọng nhất của cả chương: nó chứng minh mô hình không lén sửa chỗ khác.
   * Đặc tả đòi "100% changes accounted" — nên hàm trả về đúng số pixel đổi mà nằm NGOÀI mask;
   * khác 0 là hỏng, không phải "gần đúng".
   */
  function maskIntegrity(a, b, mask, opt) {
    opt = opt || {};
    if (!_same(a, b)) return { ok: false, reason: 'SIZE_MISMATCH' };
    if (!mask || mask.length !== a.width * a.height) return { ok: false, reason: 'BAD_MASK' };
    var outside = changedRatio(a, b, { tolerance: opt.tolerance, mask: mask, insideMask: false });
    var inside = changedRatio(a, b, { tolerance: opt.tolerance, mask: mask, insideMask: true });
    return {
      ok: true,
      reason: null,
      leakedPixels: outside.changed,
      accounted: outside.changed === 0,
      outsideRatio: outside.ratio,
      insideRatio: inside.ratio,
      // Sửa mà KHÔNG đổi gì trong mask cũng là bất thường — mô hình đã bỏ qua yêu cầu.
      noOpInsideMask: inside.changed === 0,
    };
  }

  /**
   * Chấm một lượt sửa theo hợp đồng chương 10.
   * Trả về đúng hình dạng để đưa thẳng vào validator, kèm verdict PASS/WARN/FAIL.
   */
  function evaluate(before, after, opt) {
    opt = opt || {};
    var limit = opt.maxOutsideDriftRatio != null ? opt.maxOutsideDriftRatio : 0.015;
    var checks = [];
    var mask = opt.mask || null;

    if (!_same(before, after)) {
      return {
        schema: 'seosona.sports.compareDiff.v1',
        gate: 'FAIL',
        checks: [{ id: 'resolution', status: 'FAIL', detail: 'kích thước hai ảnh khác nhau' }],
      };
    }
    checks.push({ id: 'resolution', status: 'PASS', width: before.width, height: before.height });

    if (mask) {
      var mi = maskIntegrity(before, after, mask, opt);
      checks.push({
        id: 'mask_integrity',
        status: mi.accounted ? 'PASS' : 'FAIL',
        leakedPixels: mi.leakedPixels,
        detail: mi.accounted ? null : 'có thay đổi NGOÀI vùng mask',
      });
      checks.push({
        id: 'edit_applied',
        status: mi.noOpInsideMask ? 'WARN' : 'PASS',
        detail: mi.noOpInsideMask ? 'trong mask không đổi gì — mô hình có thể đã bỏ qua yêu cầu' : null,
      });
      checks.push({
        id: 'outside_mask_drift',
        status: mi.outsideRatio <= limit ? 'PASS' : 'FAIL',
        score: mi.outsideRatio,
        limit: limit,
      });
    } else {
      var all = changedRatio(before, after, opt);
      checks.push({
        id: 'overall_drift',
        status: all.ratio <= limit ? 'PASS' : 'WARN',
        score: all.ratio,
        limit: limit,
      });
    }

    var hasFail = checks.some(function (c) { return c.status === 'FAIL'; });
    var hasWarn = checks.some(function (c) { return c.status === 'WARN'; });
    return {
      schema: 'seosona.sports.compareDiff.v1',
      gate: hasFail ? 'FAIL' : (hasWarn ? 'WARN' : 'PASS'),
      checks: checks,
    };
  }

  root.SEOSONA_CompareDiff = {
    changedRatio: changedRatio,
    maskIntegrity: maskIntegrity,
    evaluate: evaluate,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
