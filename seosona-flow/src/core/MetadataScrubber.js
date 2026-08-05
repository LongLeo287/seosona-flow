// SEOSONA Flow — dọn metadata RIÊNG TƯ khỏi ảnh trước khi tải về / đăng.
//
// PHẠM VI — đọc trước khi sửa file này:
// Engine này dọn thứ LỘ VỀ BẠN: toạ độ GPS, số sê-ri máy, tên chủ sở hữu, đường dẫn máy,
// và PROMPT bị nhúng kèm ảnh. Nó KHÔNG nhằm gỡ dấu hiệu "nội dung do AI tạo" để nền tảng
// thôi gắn nhãn — đó là chuyện khác hẳn, và cũng bất khả thi với ảnh từ Flow: Google nhúng
// SynthID vào PIXEL, không phải metadata, nên xoá metadata không đụng được tới nó.
//
// CƠ CHẾ: cắt segment ở tầng CONTAINER, KHÔNG giải mã lại ảnh.
// Đi qua canvas là nén lại → ảnh xuống chất lượng, mà mục đích ở đây chỉ là bỏ vài khối
// byte mô tả. Pixel phải giữ NGUYÊN từng byte.
//   · JPEG: duyệt marker FFxx, bỏ APPn/COM chứa metadata, DỪNG ở SOS (FFDA) rồi chép
//     nguyên phần còn lại — dữ liệu quét không có cấu trúc marker để duyệt tiếp.
//   · PNG : duyệt chunk, bỏ tEXt/zTXt/iTXt/eXIf; giữ IHDR/PLTE/IDAT/IEND và chunk màu.
//   · WebP: duyệt chunk RIFF, bỏ EXIF/XMP.
//
// Thuần: nhận Uint8Array, trả Uint8Array + báo cáo. Không DOM, không mạng → test trực tiếp.
(function (root) {
  'use strict';

  // Nhóm dữ liệu và VÌ SAO nó riêng tư. Người dùng phải đọc được lý do để tự quyết,
  // không phải tick một danh sách mã kỹ thuật.
  var CATEGORIES = {
    gps: { label: 'Vị trí GPS', why: 'Toạ độ nơi chụp — lộ nhà, chỗ làm, lịch trình.' },
    device: { label: 'Thiết bị', why: 'Số sê-ri máy/ống kính — định danh được đúng cái máy của bạn.' },
    identity: { label: 'Danh tính', why: 'Tên tác giả, tên chủ sở hữu nhúng trong file.' },
    paths: { label: 'Đường dẫn máy', why: 'Tên máy và đường dẫn file gốc — lộ cấu trúc thư mục của bạn.' },
    prompt: { label: 'Prompt', why: 'Nhiều công cụ AI nhét NGUYÊN prompt vào file. Đăng ảnh là đưa luôn công thức cho người khác.' },
  };

  var DEFAULT_REMOVE = ['gps', 'device', 'identity', 'paths', 'prompt'];

  function _ascii(b, from, len) {
    var s = '';
    for (var i = from; i < from + len && i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  function _u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }

  function detectFormat(b) {
    if (!b || b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpeg';
    if (b[0] === 0x89 && _ascii(b, 1, 3) === 'PNG') return 'png';
    if (_ascii(b, 0, 4) === 'RIFF' && _ascii(b, 8, 4) === 'WEBP') return 'webp';
    // MP4/MOV/M4V: box đầu tiên là `ftyp`. Nhận theo NỘI DUNG chứ không theo đuôi file —
    // đuôi thì đổi được, mà sửa nhầm container là hỏng video.
    if (_ascii(b, 4, 4) === 'ftyp') return 'mp4';
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'webm';  // EBML (WebM/MKV)
    return null;
  }

  // ── JPEG ────────────────────────────────────────────────────────────────────
  function _jpegSegments(b) {
    var out = [];
    var i = 2;                       // bỏ SOI
    while (i + 3 < b.length) {
      if (b[i] !== 0xFF) break;      // lệch khung → dừng, phần còn lại chép nguyên
      var marker = b[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (marker === 0xDA) break;    // SOS: từ đây là dữ liệu quét, không duyệt marker nữa
      var len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      var start = i, end = i + 2 + len;
      var payload = _ascii(b, i + 4, 32);
      var kind = null, cats = [];
      if (marker === 0xE1 && payload.indexOf('Exif') === 0) { kind = 'EXIF'; cats = ['gps', 'device', 'identity', 'paths']; }
      else if (marker === 0xE1 && payload.indexOf('http://ns.adobe.com/xap/') === 0) { kind = 'XMP'; cats = ['identity', 'paths', 'prompt']; }
      else if (marker === 0xED) { kind = 'IPTC'; cats = ['identity']; }
      else if (marker === 0xFE) { kind = 'COMMENT'; cats = ['prompt', 'paths']; }
      else if (marker === 0xE0) kind = 'JFIF';       // giữ: mô tả mật độ điểm ảnh
      else if (marker === 0xE2) kind = 'APP2';       // ICC / provenance — GIỮ, xem ghi chú dưới
      out.push({ kind: kind || ('APP' + (marker - 0xE0)), marker: marker, start: start, end: end, size: end - start, cats: cats });
      i = end;
    }
    return { segs: out, tailFrom: i };
  }

  // ── PNG ─────────────────────────────────────────────────────────────────────
  function _pngChunks(b) {
    var out = [], i = 8;
    while (i + 8 <= b.length) {
      var len = _u32(b, i);
      var type = _ascii(b, i + 4, 4);
      var end = i + 12 + len;                 // len + type(4) + data + crc(4)
      if (end > b.length || len > b.length) break;
      var cats = [];
      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') cats = ['prompt', 'identity', 'paths'];
      else if (type === 'eXIf') cats = ['gps', 'device', 'identity', 'paths'];
      out.push({ kind: type, start: i, end: end, size: end - i, cats: cats });
      i = end;
      if (type === 'IEND') break;
    }
    return { segs: out, tailFrom: i };
  }

  // ── WebP ────────────────────────────────────────────────────────────────────
  function _webpChunks(b) {
    var out = [], i = 12;                     // RIFF(4) + size(4) + WEBP(4)
    while (i + 8 <= b.length) {
      var type = _ascii(b, i, 4);
      var len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
      var pad = len % 2;                      // chunk RIFF luôn căn chẵn
      var end = i + 8 + len + pad;
      if (len < 0 || end > b.length) break;
      var cats = [];
      if (type === 'EXIF') cats = ['gps', 'device', 'identity', 'paths'];
      else if (type === 'XMP ') cats = ['identity', 'paths', 'prompt'];
      out.push({ kind: type.trim(), start: i, end: end, size: end - i, cats: cats });
      i = end;
    }
    return { segs: out, tailFrom: i };
  }

  // ── Video: vì sao GHI ĐÈ TẠI CHỖ chứ không cắt ────────────────────────────
  // Ảnh thì cắt khối thừa rồi nối lại là xong. Video thì KHÔNG: trong MP4, bảng `stco`
  // giữ vị trí TUYỆT ĐỐI của từng chunk trong file; trong WebM, `Cues` giữ vị trí cluster.
  // Cắt bớt một khối phía trước là mọi con số đó lệch → video không tua được, có khi
  // không mở nổi. Sửa lại toàn bộ bảng offset thì làm được nhưng dễ sai âm thầm.
  //
  // Nên: giữ NGUYÊN độ dài file, chỉ ghi đè khối metadata thành khối rác hợp lệ mà mọi
  // trình phát đều bỏ qua — MP4 dùng box `free`, WebM dùng element `Void`. Không offset
  // nào dịch, không bảng nào phải sửa. Đổi lại file không nhỏ đi, nhưng mục đích ở đây là
  // bỏ dữ liệu riêng tư chứ không phải tiết kiệm dung lượng.

  var _MP4_CONTAINERS = { moov: 1, trak: 1, mdia: 1, minf: 1, edts: 1 };
  var _MP4_KILL = {
    udta: ['gps', 'device', 'identity', 'paths'],   // ©xyz = toạ độ GPS, ©mak/©mod = máy quay
    meta: ['gps', 'device', 'identity', 'paths'],   // khối kiểu iTunes
    uuid: ['identity', 'paths', 'prompt'],          // XMP của Adobe, telemetry của GoPro/Insta360
  };

  /** Duyệt box ISO-BMFF (MP4/MOV/M4V). Đệ quy vào container, đánh dấu box cần xoá. */
  function _mp4Boxes(b) {
    var out = [];
    function walk(from, to, depth) {
      var i = from;
      while (i + 8 <= to) {
        var size = _u32(b, i), type = _ascii(b, i + 4, 4), hdr = 8;
        if (size === 1) {                       // size 64-bit nằm ngay sau type
          if (i + 16 > to) break;
          var hi = _u32(b, i + 8), lo = _u32(b, i + 12);
          size = hi * 4294967296 + lo; hdr = 16;
        } else if (size === 0) {
          size = to - i;                        // 0 = kéo tới hết file
        }
        if (size < hdr || i + size > to) break;
        if (_MP4_KILL[type]) {
          out.push({ kind: type, start: i, end: i + size, size: size, hdr: hdr, cats: _MP4_KILL[type], kill: 'mp4' });
        } else if (_MP4_CONTAINERS[type] && depth < 4) {
          out.push({ kind: type, start: i, end: i + size, size: size, cats: [] });
          walk(i + hdr, i + size, depth + 1);
        } else {
          out.push({ kind: type, start: i, end: i + size, size: size, cats: [] });
        }
        i += size;
      }
    }
    walk(0, b.length, 0);
    return { segs: out, tailFrom: b.length, inPlace: true };
  }

  /** Biến một box thành `free` và xoá ruột. Giữ nguyên header nên độ dài file không đổi. */
  function _mp4Void(b, seg) {
    b[seg.start + 4] = 0x66; b[seg.start + 5] = 0x72; b[seg.start + 6] = 0x65; b[seg.start + 7] = 0x65; // 'free'
    b.fill(0, seg.start + (seg.hdr || 8), seg.end);
  }

  /** Đọc vint của EBML. `keepMarker` = true cho ID (ID giữ cả bit đánh dấu). */
  function _vint(b, i, keepMarker) {
    if (i >= b.length) return null;
    var first = b[i], len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { mask >>= 1; len++; }
    if (len > 8 || i + len > b.length) return null;
    var v = keepMarker ? first : (first & (mask - 1));
    var allOnes = (first & (mask - 1)) === (mask - 1);
    for (var k = 1; k < len; k++) { v = v * 256 + b[i + k]; allOnes = allOnes && b[i + k] === 0xFF; }
    return { value: v, length: len, unknown: !keepMarker && allOnes };
  }

  var _EBML_SEGMENT = 0x18538067, _EBML_INFO = 0x1549A966, _EBML_CLUSTER = 0x1F43B675;
  var _EBML_KILL = {
    0x1254C367: { name: 'Tags', cats: ['identity', 'prompt', 'paths'] },
    0x1941A469: { name: 'Attachments', cats: ['identity', 'paths'] },
    0x4461: { name: 'DateUTC', cats: ['device'] },
    0x7BA9: { name: 'Title', cats: ['identity', 'prompt'] },
    0x4D80: { name: 'MuxingApp', cats: ['device', 'identity'] },
    0x5741: { name: 'WritingApp', cats: ['device', 'identity'] },
  };

  function _webmElements(b) {
    var out = [];
    function walk(from, to, depth) {
      var i = from;
      while (i < to) {
        var id = _vint(b, i, true); if (!id) break;
        var sz = _vint(b, i + id.length, false); if (!sz) break;
        var dataAt = i + id.length + sz.length;
        var end = sz.unknown ? to : dataAt + sz.value;
        if (end > to || end <= i) { end = to; }
        var kill = _EBML_KILL[id.value];
        if (kill) {
          out.push({ kind: kill.name, start: i, end: end, size: end - i, dataAt: dataAt,
            cats: kill.cats, kill: id.value === 0x4D80 || id.value === 0x5741 ? 'blank' : 'ebml' });
        } else if ((id.value === _EBML_SEGMENT || id.value === _EBML_INFO) && depth < 3) {
          out.push({ kind: id.value === _EBML_SEGMENT ? 'Segment' : 'Info', start: i, end: end, size: end - i, cats: [] });
          walk(dataAt, end, depth + 1);
        } else {
          out.push({ kind: id.value === _EBML_CLUSTER ? 'Cluster' : ('0x' + id.value.toString(16)),
            start: i, end: end, size: end - i, cats: [] });
        }
        if (sz.unknown && id.value !== _EBML_SEGMENT) break;
        i = end;
      }
    }
    walk(0, b.length, 0);
    return { segs: out, tailFrom: b.length, inPlace: true };
  }

  /**
   * Biến một element thành `Void` (ID 0xEC) đúng BẰNG độ dài cũ.
   * Void chỉ cần 1 byte ID, nên phần size phải co giãn để tổng khớp tuyệt đối.
   * MuxingApp/WritingApp là element BẮT BUỘC theo chuẩn — không void được, ghi đè
   * bằng dấu cách để file vẫn hợp lệ mà tên phần mềm thì mất.
   */
  function _webmVoid(b, seg) {
    if (seg.kill === 'blank') { b.fill(0x20, seg.dataAt, seg.end); return; }
    var total = seg.size;
    if (total < 2) return;
    var payload = total - 2;
    if (payload <= 126) {                       // size 1 byte
      b[seg.start] = 0xEC; b[seg.start + 1] = 0x80 | payload;
      b.fill(0, seg.start + 2, seg.end);
      return;
    }
    if (total < 9) return;                      // không đủ chỗ cho size 8 byte → thà bỏ qua
    payload = total - 9;
    b[seg.start] = 0xEC; b[seg.start + 1] = 0x01;   // size 8 byte
    for (var k = 7; k >= 1; k--) { b[seg.start + 1 + k] = payload % 256; payload = Math.floor(payload / 256); }
    b.fill(0, seg.start + 9, seg.end);
  }

  function segments(bytes) {
    var f = detectFormat(bytes);
    if (f === 'jpeg') return Object.assign({ format: f }, _jpegSegments(bytes));
    if (f === 'png') return Object.assign({ format: f }, _pngChunks(bytes));
    if (f === 'webp') return Object.assign({ format: f }, _webpChunks(bytes));
    if (f === 'mp4') return Object.assign({ format: f }, _mp4Boxes(bytes));
    if (f === 'webm') return Object.assign({ format: f }, _webmElements(bytes));
    return { format: null, segs: [], tailFrom: 0 };
  }

  /**
   * Dọn.
   * @param {Uint8Array} bytes
   * @param {{remove?:string[]}} opts nhóm cần bỏ; mặc định = toàn bộ nhóm riêng tư
   * @returns {{ok:boolean, bytes:Uint8Array, report:object}}
   */
  function scrub(bytes, opts) {
    opts = opts || {};
    var want = opts.remove || DEFAULT_REMOVE;
    var info = segments(bytes);
    if (!info.format) {
      // Không nhận dạng được thì TRẢ NGUYÊN, không đoán. Sửa mù một container lạ là hỏng file.
      return { ok: false, bytes: bytes, report: { format: null, removed: [], kept: [], unknown: true,
        note: 'Không nhận dạng được định dạng — giữ nguyên file, không sửa mù.' } };
    }
    var removed = [], kept = [];

    // Video: ghi đè tại chỗ, độ dài file KHÔNG đổi (xem ghi chú ở _mp4Boxes).
    if (info.inPlace) {
      var vb = new Uint8Array(bytes);           // bản sao — không đụng vào mảng của người gọi
      for (var v = 0; v < info.segs.length; v++) {
        var vs = info.segs[v];
        var vhit = vs.cats.filter(function (c) { return want.indexOf(c) !== -1; });
        if (!vhit.length || !vs.kill) { if (vs.cats.length) kept.push({ kind: vs.kind, size: vs.size }); continue; }
        if (vs.kill === 'mp4') _mp4Void(vb, vs); else _webmVoid(vb, vs);
        removed.push({ kind: vs.kind, size: vs.size, cats: vhit, voided: true });
      }
      return {
        ok: true, bytes: vb,
        report: {
          format: info.format, removed: removed, kept: kept,
          bytesBefore: bytes.length, bytesAfter: vb.length, saved: 0,
          note: removed.length
            ? 'Video: ghi đè bằng khối rác hợp lệ, giữ nguyên độ dài file để không lệch bảng offset.'
            : null,
          cannotRemove: [
            'Watermark nhúng trong PIXEL (vd SynthID của Google) — không nằm ở metadata.',
            'Dữ liệu nằm TRONG luồng hình/tiếng đã nén — muốn bỏ phải encode lại, sẽ giảm chất lượng.',
          ],
        },
      };
    }

    var keepRanges = [];
    var prev = info.format === 'jpeg' ? 2 : (info.format === 'png' ? 8 : 12);
    keepRanges.push([0, prev]);   // phần header luôn giữ

    for (var i = 0; i < info.segs.length; i++) {
      var s = info.segs[i];
      var hit = s.cats.filter(function (c) { return want.indexOf(c) !== -1; });
      if (hit.length) {
        removed.push({ kind: s.kind, size: s.size, cats: hit });
      } else {
        kept.push({ kind: s.kind, size: s.size });
        keepRanges.push([s.start, s.end]);
      }
    }
    if (info.tailFrom < bytes.length) keepRanges.push([info.tailFrom, bytes.length]);

    var total = 0, j;
    for (j = 0; j < keepRanges.length; j++) total += keepRanges[j][1] - keepRanges[j][0];
    var out = new Uint8Array(total);
    var at = 0;
    for (j = 0; j < keepRanges.length; j++) {
      out.set(bytes.subarray(keepRanges[j][0], keepRanges[j][1]), at);
      at += keepRanges[j][1] - keepRanges[j][0];
    }

    // WebP: kích thước RIFF nằm ở header, cắt chunk mà quên sửa là file hỏng.
    if (info.format === 'webp' && out.length >= 8) {
      var riff = out.length - 8;
      out[4] = riff & 0xFF; out[5] = (riff >> 8) & 0xFF; out[6] = (riff >> 16) & 0xFF; out[7] = (riff >> 24) & 0xFF;
    }

    return {
      ok: true,
      bytes: out,
      report: {
        format: info.format,
        removed: removed,
        kept: kept,
        bytesBefore: bytes.length,
        bytesAfter: out.length,
        saved: bytes.length - out.length,
        // Nói thẳng giới hạn thay vì để người dùng tự suy ra sai.
        cannotRemove: ['Watermark nhúng trong PIXEL (vd SynthID của Google) — không nằm ở metadata.'],
      },
    };
  }

  /** Xem có gì trong file mà KHÔNG sửa — để hiện báo cáo trước/sau. */
  function inspect(bytes) {
    var info = segments(bytes);
    var found = {};
    (info.segs || []).forEach(function (s) {
      s.cats.forEach(function (c) { (found[c] = found[c] || []).push(s.kind); });
    });
    return { format: info.format, segments: info.segs, found: found };
  }

  /**
   * Dọn một URL ảnh → trả blob URL MỚI đã sạch. Dùng ở đường tải về.
   *
   * Nguyên tắc AN TOÀN NHẤT: hỏng ở bất kỳ khâu nào thì trả lại URL GỐC. Người dùng bấm
   * tải là muốn có FILE — thà nhận file còn metadata còn hơn không nhận gì. Mọi ca bỏ qua
   * đều báo lý do trong `report` để không im lặng.
   *
   * Video ĐƯỢC xử lý (mp4/mov/webm) bằng cách ghi đè tại chỗ — xem ghi chú ở _mp4Boxes.
   * @returns {Promise<{url:string, changed:boolean, report:object}>}
   */
  var MAX_BYTES = 256 * 1024 * 1024;   // đọc cả file vào RAM; quá cỡ thì bỏ qua chứ không làm treo tab

  /**
   * Đang chạy trong content script trên trang của nhà cung cấp?
   * Content script KHÔNG có host permission — nó chỉ mang quyền của TRANG. URL media của Flow là
   * cross-origin và có chữ ký, nên fetch thẳng từ đây gần như luôn hỏng. Quyền đó nằm ở service
   * worker. Đây chính là lý do người dùng thấy 'TẢI_KHÔNG_ĐƯỢC' mỗi lần tải: dọn metadata KHÔNG
   * chạy được ở đường tải chính, và im lặng trả về URL gốc.
   */
  function _inContentScript() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage
      && typeof window !== 'undefined' && typeof document !== 'undefined'
      && !(location && location.protocol === 'chrome-extension:');
  }

  /** Nhờ service worker tải hộ — nó có host_permissions cho các CDN của nhà cung cấp. */
  function _fetchViaWorker(url) {
    return new Promise(function (res) {
      var done = false;
      var finish = function (v) { if (!done) { done = true; res(v); } };
      // Service worker MV3 hay ngủ. Không chờ mãi — quá hạn thì trả null để rơi về fetch thẳng.
      var timer = setTimeout(function () { finish(null); }, 20000);
      try {
        chrome.runtime.sendMessage({ action: 'fetchBlob', url: url }, function (r) {
          clearTimeout(timer);
          // PHẢI đọc lastError, nếu không Chrome ném 'Unchecked runtime.lastError: No SW'.
          if (chrome.runtime.lastError) { finish(null); return; }
          if (!r || !r.success || !r.base64) { finish(null); return; }
          try {
            var bin = atob(r.base64);
            var n = bin.length;
            var bytes = new Uint8Array(n);
            for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
            finish({ bytes: bytes, type: r.contentType || '' });
          } catch (_e) { finish(null); }
        });
      } catch (_e) { clearTimeout(timer); finish(null); }
    });
  }

  async function scrubUrl(url, opts) {
    var fallback = function (why) { return { url: url, changed: false, report: { skipped: why } }; };
    if (typeof fetch !== 'function' || typeof URL === 'undefined' || !url) return fallback('MÔI_TRƯỜNG_THIẾU');
    try {
      var buf = null, type = '';

      // Ưu tiên nhờ service worker khi ở content script — nó mới có quyền tới CDN nhà cung cấp.
      if (_inContentScript() && /^https?:/i.test(url)) {
        var viaSW = await _fetchViaWorker(url);
        if (viaSW) {
          if (viaSW.bytes.byteLength > MAX_BYTES) return fallback('QUÁ_LỚN');
          buf = viaSW.bytes; type = viaSW.type;
        }
      }

      if (!buf) {
        var resp = await fetch(url);
        if (!resp || !resp.ok) return fallback('TẢI_KHÔNG_ĐƯỢC');
        var declared = Number(resp.headers && resp.headers.get && resp.headers.get('content-length'));
        if (declared > MAX_BYTES) return fallback('QUÁ_LỚN');
        var ab = await resp.arrayBuffer();
        if (ab.byteLength > MAX_BYTES) return fallback('QUÁ_LỚN');
        buf = new Uint8Array(ab);
        type = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
      }
      var r = scrub(buf, opts);
      if (!r.ok) return fallback('ĐỊNH_DẠNG_LẠ');
      if (!r.report.removed.length) return fallback('KHÔNG_CÓ_GÌ_ĐỂ_DỌN');
      var blob = new Blob([r.bytes], { type: type || 'application/octet-stream' });
      return { url: URL.createObjectURL(blob), changed: true, report: r.report };
    } catch (e) {
      return fallback('LỖI: ' + (e && e.message));
    }
  }

  /** Một dòng tóm tắt để ghi log — dài dòng thì người dùng không đọc. */
  function summarize(report) {
    if (!report || report.skipped) return null;
    var cats = {};
    (report.removed || []).forEach(function (r) { (r.cats || []).forEach(function (c) { cats[c] = 1; }); });
    var names = Object.keys(cats).map(function (c) { return (CATEGORIES[c] || {}).label || c; });
    if (!names.length) return null;
    // Video giữ nguyên độ dài (ghi đè tại chỗ) nên "−0 byte" sẽ gây hiểu nhầm là không làm gì.
    var how = (report.removed || []).some(function (r) { return r.voided; })
      ? ' (ghi đè tại chỗ, độ dài file không đổi)'
      : ' (−' + Math.max(0, report.saved || 0) + ' byte)';
    return 'Đã dọn metadata: ' + names.join(', ') + how + '.';
  }

  // ── Cổng DUY NHẤT cho đường tải về ────────────────────────────────────────
  // Có 15 chỗ trong repo gửi `chromeDownload`. Nếu mỗi chỗ tự viết logic dọn thì chắc chắn
  // sẽ có chỗ quên, và chỗ quên đó im lặng. Nên chỉ có MỘT hàm, ai tải cũng gọi nó:
  //
  //     const dlUrl = await (window.scrubbedDownloadUrl?.(url) ?? url);
  //
  // Thiếu module → `?.()` cho undefined → `?? url` trả URL gốc. Không bao giờ ném.
  var _off = null;   // null = chưa đọc settings

  /** Đọc công tắc MỘT lần. Thiếu key nghĩa là BẬT (`=== false` chứ không `!== true`). */
  function _readSetting() {
    return new Promise(function (res) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return res(false);
        chrome.storage.local.get(['af_settings'], function (d) {
          void (chrome.runtime && chrome.runtime.lastError);
          res(!!(d && d.af_settings && d.af_settings.scrubMetadata === false));
        });
      } catch (_e) { res(false); }
    });
  }

  // ── Hỏng thì phải NÓI RA ──────────────────────────────────────────────────
  // Bản đầu nuốt mọi ca hỏng: người dùng vẫn nhận file nhưng metadata còn nguyên mà không
  // hay biết. Một lớp bảo vệ im lặng khi thất bại thì tệ hơn không có — nó tạo cảm giác
  // an toàn sai. Nhưng chạy loạt 50 ảnh mà báo 50 lần thì người ta tắt luôn, nên: mỗi LÝ DO
  // chỉ kêu MỘT lần mỗi phiên, kèm số lần lặp lại ở lần kêu đó.
  var _stats = { scrubbed: 0, skipped: {} };
  var _warned = {};

  // Chỉ những ca này mới đáng làm phiền. "Không có gì để dọn" là kết quả TỐT, không phải lỗi.
  var WHY = {
    'TẢI_KHÔNG_ĐƯỢC': 'Không tải được file để dọn metadata — file tải về vẫn còn thông tin gốc.',
    'ĐỊNH_DẠNG_LẠ': 'Định dạng file không nhận dạng được — không dọn mù, metadata còn nguyên.',
    'QUÁ_LỚN': 'File quá lớn để dọn metadata (>256 MB) — tải về nguyên trạng.',
    'MÔI_TRƯỜNG_THIẾU': 'Không dọn được metadata ở ngữ cảnh này — file tải về còn thông tin gốc.',
  };

  function _report(why) {
    _stats.skipped[why] = (_stats.skipped[why] || 0) + 1;
    var text = WHY[why] || (why.indexOf('LỖI:') === 0 ? 'Dọn metadata thất bại (' + why.slice(5).trim() + ') — file còn thông tin gốc.' : null);
    if (!text) return;                                  // ca lành, không làm phiền
    try {
      // Kênh dev: MỖI LÝ DO MỘT LẦN mỗi phiên, không phải mỗi lượt tải.
      // Bản trước ghi vô điều kiện, nên tải 20 ảnh là 20 dòng đỏ y hệt nhau trong bảng lỗi —
      // ngập tới mức che mất lỗi thật. Số lần vẫn đếm đủ trong stats().
      if (!_warned[why] && typeof console !== 'undefined') console.warn('[MetadataScrubber]', why);
      root.dispatchEvent?.(new CustomEvent('seosona:metadata-scrub', { detail: { why: why, text: text, stats: stats() } }));
      if (_warned[why]) return;                         // kênh người dùng: mỗi lý do 1 lần/phiên
      _warned[why] = true;
      if (typeof root.showToast === 'function') root.showToast(text, 'warning');
      else if (typeof root.showNotification === 'function') root.showNotification(text, 'warning');
    } catch (_e) { globalThis.SEOSONA_swallow?.('MetadataScrubber#_report', _e); }
  }

  function stats() { return { scrubbed: _stats.scrubbed, skipped: Object.assign({}, _stats.skipped) }; }

  async function scrubbedDownloadUrl(url, log) {
    try {
      if (_off === null) _off = await _readSetting();
      if (_off) return url;
      var r = await scrubUrl(url);
      if (!r.changed) { _report((r.report && r.report.skipped) || 'KHÔNG_CÓ_GÌ_ĐỂ_DỌN'); return url; }
      _stats.scrubbed++;
      var msg = summarize(r.report);
      if (msg) {
        if (typeof console !== 'undefined') console.info('[MetadataScrubber]', msg);
        if (log) { try { log(msg); } catch (_e) { globalThis.SEOSONA_swallow?.('MetadataScrubber#scrubbedDownloadUrl', _e); } }
      }
      // Blob mới do ta tạo — thu hồi sau khi trình duyệt kịp ghi xong xuống đĩa.
      setTimeout(function () { try { URL.revokeObjectURL(r.url); } catch (_e) { /* đã thu hồi */ } }, 60000);
      return r.url;
    } catch (_e) {
      globalThis.SEOSONA_swallow?.('MetadataScrubber#scrubbedDownloadUrl', _e);
      _report('LỖI: ' + (_e && _e.message));
      return url;
    }
  }
  root.scrubbedDownloadUrl = scrubbedDownloadUrl;

  root.MetadataScrubber = {
    scrubbedDownloadUrl: scrubbedDownloadUrl, stats: stats, WHY: WHY,
    _resetSettingCache: function () { _off = null; _warned = {}; _stats = { scrubbed: 0, skipped: {} }; },
    CATEGORIES: CATEGORIES, DEFAULT_REMOVE: DEFAULT_REMOVE,
    detectFormat: detectFormat, segments: segments, inspect: inspect, scrub: scrub,
    scrubUrl: scrubUrl, summarize: summarize,
  };
})(typeof window !== 'undefined' ? window : this);
