/**
 * LayerStack — xếp chồng các lớp RGBA thành một ảnh, và cho phép sửa từng lớp độc lập.
 *
 * Đây là nửa sau của ý tưởng tách lớp. LayerCutout tạo ra lớp; module này giữ chúng tách rời
 * và ghép lại khi cần xuất.
 *
 * Điểm ăn tiền so với mask + inpaint:
 *   · Sửa một lớp KHÔNG đụng lớp khác — đúng theo cấu trúc, không phải nhờ đo đạc rồi hy vọng.
 *   · Di chuyển / đổi kích thước / đổi thứ tự chồng là thao tác trên SỐ, không sinh lại pixel.
 *   · Ghép lại nhiều lần không tích luỹ sai số: mỗi lần đều ghép từ lớp GỐC, không phải từ kết
 *     quả lần trước. Đó là khác biệt lớn nhất với vòng lặp inpaint.
 *
 * Module thuần trên ImageData: không DOM, không mạng.
 */
(function (root) {
  'use strict';

  function _blank(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  /**
   * Lấy mẫu một lớp tại toạ độ đích, có tính scale.
   * Dùng lấy mẫu điểm gần nhất: tất định, không cần thư viện, và đủ cho khâu xem trước.
   * Khi xuất bản cuối thì nơi gọi nên vẽ bằng canvas thật để có nội suy mượt.
   */
  function _sample(img, sx, sy) {
    var x = Math.round(sx), y = Math.round(sy);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
    var o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  }

  /**
   * Ghép danh sách lớp.
   * @param {Array} layers [{image, x, y, scale, opacity, z, visible, id}]
   * @param {object} size {width, height}
   */
  function composite(layers, size) {
    if (!size || !(size.width > 0) || !(size.height > 0)) throw new Error('LayerStack: kích thước không hợp lệ');
    var out = _blank(size.width, size.height);
    var list = (layers || [])
      .filter(function (l) { return l && l.image && l.visible !== false; })
      .slice()
      .sort(function (a, b) { return (a.z || 0) - (b.z || 0); });

    for (var li = 0; li < list.length; li++) {
      var L = list[li];
      var sc = L.scale > 0 ? L.scale : 1;
      var op = L.opacity != null ? Math.max(0, Math.min(1, L.opacity)) : 1;
      if (op === 0) continue;
      var ox = L.x || 0, oy = L.y || 0;
      var dw = Math.round(L.image.width * sc), dh = Math.round(L.image.height * sc);

      for (var dy = 0; dy < dh; dy++) {
        var ty = oy + dy;
        if (ty < 0 || ty >= out.height) continue;
        for (var dx = 0; dx < dw; dx++) {
          var tx = ox + dx;
          if (tx < 0 || tx >= out.width) continue;
          var px = _sample(L.image, dx / sc, dy / sc);
          if (!px) continue;
          var a = (px[3] / 255) * op;
          if (a <= 0) continue;
          var o = (ty * out.width + tx) * 4;
          // Ghép "source-over" chuẩn, có tính alpha nền — thiếu phần này thì chồng ba lớp
          // bán trong suốt sẽ ra màu sai.
          var da = out.data[o + 3] / 255;
          var na = a + da * (1 - a);
          if (na <= 0) continue;
          out.data[o] = (px[0] * a + out.data[o] * da * (1 - a)) / na;
          out.data[o + 1] = (px[1] * a + out.data[o + 1] * da * (1 - a)) / na;
          out.data[o + 2] = (px[2] * a + out.data[o + 2] * da * (1 - a)) / na;
          out.data[o + 3] = Math.round(na * 255);
        }
      }
    }
    return out;
  }

  /**
   * Sửa MỘT lớp, trả về danh sách mới. Không đụng lớp khác, và không sửa tại chỗ.
   *
   * Trả mảng mới thay vì sửa tại chỗ để nơi gọi giữ được lịch sử hoàn tác — với mask+inpaint
   * thì hoàn tác nghĩa là phải lưu cả ảnh, ở đây chỉ là vài con số.
   */
  function update(layers, id, patch) {
    var found = false;
    var next = (layers || []).map(function (l) {
      if (!l || l.id !== id) return l;
      found = true;
      var copy = {};
      for (var k in l) copy[k] = l[k];
      for (var k2 in patch) copy[k2] = patch[k2];
      return copy;
    });
    if (!found) throw new Error('LayerStack: không có lớp id=' + id);
    return next;
  }

  /** Đổi thứ tự chồng — chuẩn hoá z về 0..n-1 để không bị trôi số. */
  function reorder(layers, id, toIndex) {
    var list = (layers || []).slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    var from = list.findIndex(function (l) { return l && l.id === id; });
    if (from < 0) throw new Error('LayerStack: không có lớp id=' + id);
    var t = Math.max(0, Math.min(list.length - 1, toIndex));
    var moved = list.splice(from, 1)[0];
    list.splice(t, 0, moved);
    return list.map(function (l, i) {
      var copy = {}; for (var k in l) copy[k] = l[k];
      copy.z = i; return copy;
    });
  }

  /** Tổng hợp trạng thái để hiện ra giao diện. */
  function describe(layers) {
    return (layers || []).slice()
      .sort(function (a, b) { return (a.z || 0) - (b.z || 0); })
      .map(function (l) {
        return {
          id: l.id,
          z: l.z || 0,
          visible: l.visible !== false,
          size: l.image ? (l.image.width + 'x' + l.image.height) : null,
          at: [l.x || 0, l.y || 0],
          scale: l.scale > 0 ? l.scale : 1,
          opacity: l.opacity != null ? l.opacity : 1,
        };
      });
  }

  root.SEOSONA_LayerStack = {
    composite: composite,
    update: update,
    reorder: reorder,
    describe: describe,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
