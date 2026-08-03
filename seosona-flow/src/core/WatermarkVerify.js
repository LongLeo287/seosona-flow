// SEOSONA Flow — HẬU KIỂM sau khi xoá watermark.
//
// Trước đây ta chỉ có TIỀN kiểm (LOW_CONFIDENCE: không đủ chắc thì không đụng vào ảnh).
// Thiếu vế còn lại: xoá xong rồi thì có sạch không? Không đo thì người dùng nhận về ảnh
// còn nguyên vệt mờ mà tưởng đã xong — tệ hơn là báo thẳng "không xoá được", vì họ sẽ
// đem đi dùng rồi mới phát hiện.
//
// CÁCH ĐO: mô hình của ta là watermarked = α·L + (1−α)·original. Xoá đúng thì phần dư
// trong vùng watermark KHÔNG còn tương quan với hình dạng α nữa. Nên đo tương quan chéo
// chuẩn hoá (NCC) giữa alphaMap và phần dư:
//   · NCC cao  → vệt vẫn còn đúng hình logo → xoá HỎNG
//   · NCC thấp → phần dư chỉ là nội dung/nhiễu → xoá ĐƯỢC
//
// NCC (không phải hiệu tuyệt đối) vì nó miễn nhiễm với độ sáng/tương phản: ảnh nền tối
// hay sáng đều cho cùng một thang điểm, nên một ngưỡng dùng chung được cho mọi ảnh.
//
// Thuần, không canvas/không DOM → test trực tiếp.
(function (root) {
  'use strict';

  // Ngưỡng mặc định. 0.35 chọn theo nguyên tắc: thà báo "còn vệt" oan (người dùng xem lại
  // là biết ngay) còn hơn báo sạch nhầm (họ đem đi dùng rồi mới phát hiện).
  var DEFAULTS = { failAbove: 0.35, warnAbove: 0.20 };

  /**
   * Tương quan chéo chuẩn hoá giữa hai mảng cùng độ dài.
   * @returns {number} −1..1; 0 khi một bên phẳng (không có gì để tương quan).
   */
  function ncc(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return 0;
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0, x, y;
    for (i = 0; i < n; i++) {
      x = a[i] - ma; y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    // Một bên phẳng tuyệt đối thì tương quan không xác định — trả 0, KHÔNG trả 1.
    // Trả 1 ở đây sẽ biến mọi vùng đồng màu thành "còn watermark".
    if (da <= 1e-12 || db <= 1e-12) return 0;
    return num / Math.sqrt(da * db);
  }

  /**
   * Phần dư trong vùng watermark: độ lệch của từng điểm so với TRUNG BÌNH vùng.
   * Trừ trung bình để bỏ ảnh hưởng của nội dung nền phẳng, chỉ giữ cấu trúc.
   */
  function residual(values) {
    var n = (values && values.length) || 0;
    if (!n) return [];
    var m = 0, i;
    for (i = 0; i < n; i++) m += values[i];
    m /= n;
    var out = new Array(n);
    for (i = 0; i < n; i++) out[i] = values[i] - m;
    return out;
  }

  /**
   * Chấm kết quả xoá.
   * @param {ArrayLike<number>} after   độ sáng từng điểm trong vùng watermark, SAU khi xoá
   * @param {ArrayLike<number>} alphaMap hình dạng α của watermark (cùng độ dài)
   * @param {{failAbove?:number, warnAbove?:number}} opts
   * @returns {{ok:boolean, score:number, verdict:'clean'|'faint'|'failed', message:string}}
   */
  function check(after, alphaMap, opts) {
    opts = opts || {};
    var failAbove = opts.failAbove != null ? opts.failAbove : DEFAULTS.failAbove;
    var warnAbove = opts.warnAbove != null ? opts.warnAbove : DEFAULTS.warnAbove;
    if (!after || !alphaMap || after.length !== alphaMap.length || !after.length) {
      return { ok: false, score: 0, verdict: 'failed', message: 'Không đo được: thiếu dữ liệu vùng watermark.' };
    }
    // Dấu không quan trọng: vệt còn lại có thể sáng hơn HOẶC tối hơn nền tuỳ cách xoá hụt.
    var score = Math.abs(ncc(residual(after), alphaMap));
    if (score > failAbove) {
      return { ok: false, score: score, verdict: 'failed',
        message: 'Watermark vẫn còn rõ sau khi xoá — đừng dùng ảnh này, thử lại hoặc chỉnh vùng thủ công.' };
    }
    if (score > warnAbove) {
      return { ok: true, score: score, verdict: 'faint',
        message: 'Còn vệt mờ ở vùng watermark. Xem kỹ trước khi dùng.' };
    }
    return { ok: true, score: score, verdict: 'clean', message: 'Vùng watermark đã sạch.' };
  }

  /**
   * Xoá có ăn thua gì không: so phần dư TRƯỚC và SAU.
   * Dùng để phân biệt "ảnh vốn không có watermark" với "có mà xoá không nổi" — hai ca
   * này nhìn kết quả cuối thì giống nhau nhưng cách xử lý khác hẳn.
   * @returns {{improved:boolean, before:number, after:number, drop:number}}
   */
  function compare(before, after, alphaMap) {
    var b = check(before, alphaMap).score;
    var a = check(after, alphaMap).score;
    return { improved: a < b - 0.02, before: b, after: a, drop: +(b - a).toFixed(4) };
  }

  root.WatermarkVerify = { DEFAULTS: DEFAULTS, ncc: ncc, residual: residual, check: check, compare: compare };
})(typeof window !== 'undefined' ? window : this);
