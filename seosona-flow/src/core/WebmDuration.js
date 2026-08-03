// SEOSONA Flow — vá thời lượng vào file WebM do MediaRecorder ghi ra.
//
// VÌ SAO CẦN: MediaRecorder ghi theo kiểu LUỒNG TRỰC TIẾP — lúc bắt đầu nó không biết video
// sẽ dài bao nhiêu, nên file xuất ra KHÔNG có phần tử `Duration` trong khối `Info`, và
// `Segment` khai kích thước "không xác định".
//
// Chrome vẫn phát được vì nó đọc hết file rồi tự suy ra. Nhưng Windows Media Player, CapCut,
// Premiere và phần lớn trình phát khác thì hiện 0:00, KHÔNG TUA ĐƯỢC, hoặc từ chối mở hẳn.
// Người dùng nhận file "xoá watermark xong" mà không xem được — đúng triệu chứng đã gặp.
//
// CÁCH VÁ: chèn (hoặc ghi đè) `Duration` vào khối `Info`, rồi sửa lại kích thước của `Info`.
// An toàn với file MediaRecorder vì output của nó KHÔNG có bảng `Cues` — không có con số
// vị trí nào để mà lệch khi ta chèn thêm byte. File nào CÓ Cues thì ta trả nguyên, không
// đụng: dịch byte mà không sửa Cues là làm hỏng khả năng tua, tệ hơn lúc đầu.
(function (root) {
  'use strict';

  var ID_SEGMENT = 0x18538067, ID_INFO = 0x1549A966, ID_DURATION = 0x4489;
  var ID_TIMECODE_SCALE = 0x2AD7B1, ID_CUES = 0x1C53BB6B;

  /** Đọc vint. `keepMarker` = true cho ID (ID giữ cả bit đánh dấu). */
  function vint(b, i, keepMarker) {
    if (i >= b.length) return null;
    var first = b[i], len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { mask >>= 1; len++; }
    if (len > 8 || i + len > b.length) return null;
    var v = keepMarker ? first : (first & (mask - 1));
    var allOnes = (first & (mask - 1)) === (mask - 1);
    for (var k = 1; k < len; k++) { v = v * 256 + b[i + k]; allOnes = allOnes && b[i + k] === 0xFF; }
    return { value: v, length: len, unknown: !keepMarker && allOnes };
  }

  /** Mã hoá độ dài thành vint ngắn nhất chứa được. */
  function encodeSize(n) {
    for (var len = 1; len <= 8; len++) {
      var max = Math.pow(2, 7 * len) - 2;          // trừ 1 vì all-ones = "không xác định"
      if (n <= max) {
        var out = new Uint8Array(len), rest = n;
        for (var k = len - 1; k >= 1; k--) { out[k] = rest % 256; rest = Math.floor(rest / 256); }
        out[0] = (0x80 >> (len - 1)) | rest;
        return out;
      }
    }
    return null;
  }

  /** Duyệt các phần tử con trực tiếp trong [from, to). */
  function children(b, from, to) {
    var out = [], i = from;
    while (i < to) {
      var id = vint(b, i, true); if (!id) break;
      var sz = vint(b, i + id.length, false); if (!sz) break;
      var dataAt = i + id.length + sz.length;
      var end = sz.unknown ? to : dataAt + sz.value;
      if (end > to || end <= i) end = to;
      out.push({ id: id.value, start: i, dataAt: dataAt, end: end, unknown: sz.unknown, hdr: id.length + sz.length });
      if (sz.unknown) break;
      i = end;
    }
    return out;
  }

  function f64(value) {
    var buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, false);   // big-endian, chuẩn EBML
    return new Uint8Array(buf);
  }

  /**
   * @param {Uint8Array} bytes file WebM
   * @param {number} durationMs thời lượng THẬT (mili giây)
   * @returns {{bytes:Uint8Array, patched:boolean, why:string|null}}
   */
  function patch(bytes, durationMs) {
    var no = function (why) { return { bytes: bytes, patched: false, why: why }; };
    if (!bytes || bytes.length < 64) return no('FILE_QUÁ_NGẮN');
    if (!(bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3)) return no('KHÔNG_PHẢI_WEBM');
    if (!(durationMs > 0) || !isFinite(durationMs)) return no('THỜI_LƯỢNG_KHÔNG_HỢP_LỆ');

    var top = children(bytes, 0, bytes.length);
    var seg = null, t;
    for (t = 0; t < top.length; t++) if (top[t].id === ID_SEGMENT) seg = top[t];
    if (!seg) return no('KHÔNG_THẤY_SEGMENT');

    var kids = children(bytes, seg.dataAt, seg.end);
    var info = null, k;
    for (k = 0; k < kids.length; k++) {
      if (kids[k].id === ID_INFO) info = kids[k];
      // Có Cues nghĩa là file đã có bảng vị trí TUYỆT ĐỐI. Chèn byte sẽ làm lệch hết.
      if (kids[k].id === ID_CUES) return no('CÓ_CUES_KHÔNG_DÁM_DỊCH');
    }
    if (!info) return no('KHÔNG_THẤY_INFO');

    // TimecodeScale (ns/tick, mặc định 1e6 = 1ms). Duration tính theo tick, không phải ms.
    var scale = 1000000, infoKids = children(bytes, info.dataAt, info.end), dur = null;
    for (k = 0; k < infoKids.length; k++) {
      var c = infoKids[k];
      if (c.id === ID_TIMECODE_SCALE) {
        var v = 0;
        for (var q = c.dataAt; q < c.end; q++) v = v * 256 + bytes[q];
        if (v > 0) scale = v;
      } else if (c.id === ID_DURATION) dur = c;
    }
    var ticks = durationMs * 1000000 / scale;

    if (dur && dur.end - dur.dataAt === 8) {
      // Đã có Duration 8 byte → ghi đè tại chỗ, độ dài file không đổi. Đường an toàn nhất.
      var out0 = new Uint8Array(bytes);
      out0.set(f64(ticks), dur.dataAt);
      return { bytes: out0, patched: true, why: null };
    }
    if (dur) return no('DURATION_LẠ_KHÔNG_ĐỘNG');   // 4 byte float: sửa sẽ đổi cỡ, bỏ qua

    // Chưa có → chèn mới: [ID 2 byte][size 0x88][8 byte float]
    var el = new Uint8Array(11);
    el[0] = 0x44; el[1] = 0x89; el[2] = 0x88;
    el.set(f64(ticks), 3);

    // Info dài thêm 11 byte → phải viết lại vint kích thước của Info.
    var oldSizeLen = info.hdr - 4;                  // ID của Info dài 4 byte
    var newSize = (info.end - info.dataAt) + el.length;
    var enc = encodeSize(newSize);
    if (!enc) return no('KÍCH_THƯỚC_QUÁ_LỚN');

    var out = new Uint8Array(bytes.length + el.length + (enc.length - oldSizeLen));
    var at = 0;
    out.set(bytes.subarray(0, info.start + 4), at); at += info.start + 4;   // tới hết ID Info
    out.set(enc, at); at += enc.length;                                     // size mới
    out.set(el, at); at += el.length;                                       // Duration lên đầu Info
    out.set(bytes.subarray(info.dataAt, bytes.length), at);
    return { bytes: out, patched: true, why: null };
  }

  /** Tiện dụng: nhận Blob, trả Blob đã vá (hỏng thì trả Blob gốc, không bao giờ ném). */
  async function patchBlob(blob, durationMs) {
    try {
      if (!blob || typeof blob.arrayBuffer !== 'function') return blob;
      if (!/webm|matroska/i.test(blob.type || '')) return blob;
      var r = patch(new Uint8Array(await blob.arrayBuffer()), durationMs);
      if (!r.patched) {
        if (typeof console !== 'undefined') console.warn('[WebmDuration] không vá được:', r.why);
        return blob;
      }
      return new Blob([r.bytes], { type: blob.type });
    } catch (e) {
      globalThis.SEOSONA_swallow?.('WebmDuration#patchBlob', e);
      return blob;
    }
  }

  root.WebmDuration = { patch: patch, patchBlob: patchBlob, _encodeSize: encodeSize };
})(typeof self !== 'undefined' ? self : this);
