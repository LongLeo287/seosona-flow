/**
 * PhotoFinish — grade ảnh KHÔNG-SINH-ẢNH (non-generative).
 *
 * Chương 9 của đặc tả xếp `photo_finish` cạnh những node cần engine, nhưng nó KHÔNG cần: đây
 * thuần là phép toán trên pixel — cân sáng, tương phản, độ bão hoà, nét. Không có mô hình nào
 * tham gia, nên không có gì để "vẽ đè".
 *
 * Đó cũng chính là giá trị của nó trong luồng khoá-nguồn: sau khi mô hình đã sửa xong phần
 * trong mask, bước finish làm ảnh đẹp lên mà KHÔNG rủi ro thêm — kết quả tất định, chạy lại
 * ra đúng thế, và kiểm được bằng test snapshot.
 *
 * Module thuần trên ImageData: không DOM, không mạng.
 */
(function (root) {
  'use strict';

  function _clamp(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  function _copy(img) {
    var d = new Uint8ClampedArray(img.data.length);
    d.set(img.data);
    return { width: img.width, height: img.height, data: d };
  }

  var PRESETS = {
    none: { exposure: 0, contrast: 0, saturation: 0, sharpen: 0 },
    // Ảnh thể thao trong nhà thường bệt và ám vàng vì đèn nhà thi đấu.
    indoor_sport: { exposure: 0.04, contrast: 0.12, saturation: 0.08, sharpen: 0.25 },
    // Ngoài trời thường thừa tương phản sẵn — chỉ cần nhấn nét và màu.
    outdoor_sport: { exposure: 0, contrast: 0.05, saturation: 0.10, sharpen: 0.20 },
    editorial: { exposure: 0.02, contrast: 0.18, saturation: -0.05, sharpen: 0.15 },
  };

  function listPresets() { return Object.keys(PRESETS); }

  /**
   * Áp grade. Trả về ImageData MỚI — không bao giờ sửa tại chỗ, vì ảnh đầu vào có thể đang bị
   * SourceLock canh giữ và sửa tại chỗ sẽ làm băm của bản gốc sai lệch một cách âm thầm.
   *
   * @param {ImageData} img
   * @param {object|string} opts preset name hoặc {exposure, contrast, saturation, sharpen}
   */
  function apply(img, opts) {
    if (!img || !img.data) throw new Error('PhotoFinish: ảnh không hợp lệ');
    var p = typeof opts === 'string' ? PRESETS[opts] : opts;
    if (!p) p = PRESETS.none;
    var ex = p.exposure || 0, ct = p.contrast || 0, sa = p.saturation || 0, sh = p.sharpen || 0;

    var out = _copy(img);
    var d = out.data;
    var n = img.width * img.height;
    var i, o;

    // ── phơi sáng + tương phản + bão hoà: mỗi pixel độc lập ──
    if (ex || ct || sa) {
      var gain = 1 + ex;
      for (i = 0; i < n; i++) {
        o = i * 4;
        var r = d[o] * gain, g = d[o + 1] * gain, b = d[o + 2] * gain;
        if (ct) {
          // xoay quanh mức xám giữa để không làm trôi tông tổng thể
          r = 128 + (r - 128) * (1 + ct);
          g = 128 + (g - 128) * (1 + ct);
          b = 128 + (b - 128) * (1 + ct);
        }
        if (sa) {
          var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r = lum + (r - lum) * (1 + sa);
          g = lum + (g - lum) * (1 + sa);
          b = lum + (b - lum) * (1 + sa);
        }
        d[o] = _clamp(r); d[o + 1] = _clamp(g); d[o + 2] = _clamp(b);
      }
    }

    // ── làm nét: unsharp 3x3, đọc từ BẢN ĐÃ CHỈNH nhưng ghi sang đệm riêng ──
    // Đọc và ghi cùng một mảng sẽ làm pixel đã xử lý ảnh hưởng pixel kế tiếp → vệt loang.
    if (sh > 0) {
      var src = new Uint8ClampedArray(d);
      var w = img.width, h = img.height;
      var k = sh;
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          o = (y * w + x) * 4;
          for (var c = 0; c < 3; c++) {
            var cen = src[o + c];
            var around = (
              src[o - 4 + c] + src[o + 4 + c] +
              src[o - w * 4 + c] + src[o + w * 4 + c]
            ) / 4;
            d[o + c] = _clamp(cen + (cen - around) * k);
          }
        }
      }
    }
    return out;
  }

  root.SEOSONA_PhotoFinish = {
    PRESETS: PRESETS,
    listPresets: listPresets,
    apply: apply,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
