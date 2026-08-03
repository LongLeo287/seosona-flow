/**
 * PngText — nhúng/đọc metadata TEXT trong PNG (tEXt chunk). Mượn ý ComfyUI: nhúng spec gen (prompt/
 * model/ratio/node-graph) VÀO ẢNH export → ảnh TỰ MÔ TẢ, tái lập được (kéo lại ảnh là có spec).
 * Pure byte-work, không phụ thuộc canvas → chạy mọi context + test được.
 *
 * API:
 *   PngText.insertText(bytes, keyword, text) -> Uint8Array   (thêm 1 tEXt trước IEND)
 *   PngText.readText(bytes, keyword) -> string | null
 *   PngText.readAll(bytes) -> { keyword: text, ... }
 *   PngText.embedInDataUrl(dataUrl, keyword, text) -> dataUrl (Promise? no — sync, cần atob/btoa)
 *   PngText.SPEC_KEY = 'seosona-flow'   (khoá chuẩn cho spec gen)
 */
(function (root) {
  'use strict';

  var SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  // CRC32 (PNG polynomial) — bảng tính 1 lần.
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u32(n) { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; }
  function isPng(b) { for (var i = 0; i < 8; i++) if (b[i] !== SIG[i]) return false; return true; }

  var IEND_TYPE = [0x49, 0x45, 0x4e, 0x44]; // "IEND"
  var TEXT_TYPE = [0x74, 0x45, 0x58, 0x74]; // "tEXt"

  // Tìm chuỗi byte (scan tiến / lùi) — bền hơn walk-by-length trên PNG thật.
  function findSeq(b, seq, from) {
    outer: for (var i = from || 0; i <= b.length - seq.length; i++) {
      for (var j = 0; j < seq.length; j++) if (b[i + j] !== seq[j]) continue outer;
      return i;
    }
    return -1;
  }
  function findLastSeq(b, seq) {
    for (var i = b.length - seq.length; i >= 0; i--) {
      var ok = true;
      for (var j = 0; j < seq.length; j++) if (b[i + j] !== seq[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  // UTF-8 lossless: dùng escape-trick để mỗi ký tự → 1 byte UTF-8 (giữ dấu tiếng Việt trong spec).
  function utf8Bytes(str) {
    var s; try { s = unescape(encodeURIComponent(String(str))); } catch (_) { s = String(str); }
    var out = []; for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff); return out;
  }
  function utf8Decode(latin1) {
    try { return decodeURIComponent(escape(latin1)); } catch (_) { return latin1; }
  }

  function makeTextChunk(keyword, text) {
    var kw = []; for (var i = 0; i < keyword.length; i++) kw.push(keyword.charCodeAt(i) & 0xff);
    var tx = utf8Bytes(text); // bytes UTF-8 (tEXt gốc là Latin-1 nhưng ta round-trip bằng reader riêng)
    var typeAndData = [0x74, 0x45, 0x58, 0x74].concat(kw, [0], tx); // "tEXt" + keyword + 0 + text
    var crc = crc32(new Uint8Array(typeAndData));
    return u32(tx.length + kw.length + 1).concat(typeAndData, u32(crc));
  }

  function insertText(bytes, keyword, text) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!isPng(b)) return b; // không phải PNG → trả nguyên
    var iendType = findLastSeq(b, IEND_TYPE);
    if (iendType < 4) return b;
    var iendStart = iendType - 4; // lùi qua 4 byte length-prefix của IEND
    var chunk = new Uint8Array(makeTextChunk(keyword, text));
    var out = new Uint8Array(b.length + chunk.length);
    out.set(b.subarray(0, iendStart), 0);
    out.set(chunk, iendStart);
    out.set(b.subarray(iendStart), iendStart + chunk.length);
    return out;
  }

  function readAll(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = {};
    if (!isPng(b)) return out;
    var i = 8;
    while ((i = findSeq(b, TEXT_TYPE, i)) !== -1) {
      var len = (b[i - 4] << 24 | b[i - 3] << 16 | b[i - 2] << 8 | b[i - 1]) >>> 0; // length-prefix ngay trước type
      var ds = i + 4, de = ds + len;
      if (de <= b.length) {
        var sep = -1;
        for (var k = ds; k < de; k++) if (b[k] === 0) { sep = k; break; }
        if (sep >= 0) {
          var kw = ''; for (var a = ds; a < sep; a++) kw += String.fromCharCode(b[a]);
          var tx = ''; for (var t = sep + 1; t < de; t++) tx += String.fromCharCode(b[t]);
          if (out[kw] == null) out[kw] = utf8Decode(tx); // giải UTF-8 → giữ dấu

        }
      }
      i = i + 4;
    }
    return out;
  }

  function readText(bytes, keyword) {
    var all = readAll(bytes);
    return all[keyword] != null ? all[keyword] : null;
  }

  root.PngText = {
    SPEC_KEY: 'seosona-flow',
    insertText: insertText, readText: readText, readAll: readAll,
    crc32: crc32, isPng: isPng,
  };
})(typeof self !== 'undefined' ? self : this);
