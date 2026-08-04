// SEOSONA Flow — Error Catalog (Phase 4 / P4.T7, AUD-014).
// Classic worker script. Typed error codes + an explicit "owned suppression"
// helper, so silent catches become intentional, documented, and (optionally)
// observable via the redacting logger instead of vanishing.
(function (global) {
  'use strict';

  var CODES = {
    NETWORK: 'E_NETWORK',
    STORAGE: 'E_STORAGE',
    PROVIDER: 'E_PROVIDER',
    WORKFLOW: 'E_WORKFLOW',
    PERMISSION: 'E_PERMISSION',
    VALIDATION: 'E_VALIDATION',
    UNKNOWN: 'E_UNKNOWN',
  };

  function makeError(code, message, cause) {
    var e = new Error(message || code);
    e.code = code;
    if (cause) e.cause = cause;
    return e;
  }

  // Owned suppression: a catch that is silent BY DESIGN. Records the reason so
  // it is auditable; never rethrows. Returns the fallback value.
  var suppressed = [];

  // SF-019 — StructuredLogger đã tồn tại từ Phase 10 nhưng KHÔNG có một call site nào: nó ghi
  // sự kiện có thành phần, mức độ, correlation id và lọc riêng tư, rồi giữ trong vòng đệm hữu
  // hạn. Một hạ tầng đầy đủ nằm không.
  // `swallow` là phễu DUY NHẤT của mọi catch im-lặng-có-chủ-ý trong sản phẩm (hơn một nghìn chỗ
  // gọi), nên cắm ở đây là phủ hết trong một lần sửa, thay vì đi vá từng chỗ.
  // Tạo LƯỜI: nhiều ngữ cảnh không nạp StructuredLogger, và ErrorCatalog phải là file đầu tiên
  // nạp được ở mọi nơi — không được phụ thuộc cứng vào ai.
  var _slog = null;
  function _structured() {
    if (_slog !== null) return _slog;
    try {
      var SL = global.SEOSONA_StructuredLogger;
      // level:'debug' — nuốt lỗi có chủ ý ĐÚNG là mức debug, mà ngưỡng mặc định của logger là
      // 'info' nên để trống thì mọi bản ghi bị lọc sạch và vòng đệm luôn rỗng.
      // bufferSize khớp 500 của mảng phẳng để hai bên cùng cửa sổ thời gian.
      _slog = SL && SL.create ? SL.create({ level: 'debug', bufferSize: 500 }) : false;
    } catch (_) { _slog = false; }
    return _slog;
  }

  function swallow(reason, err, fallback) {
    suppressed.push({ reason: reason, message: err && err.message });
    if (suppressed.length > 500) suppressed.shift();

    // Ghi có cấu trúc: tách 'File#fn' thành thành phần + sự kiện để lọc/đếm được theo module,
    // thay vì một mảng chuỗi phẳng chỉ đọc được bằng mắt.
    var sl = _structured();
    if (sl) {
      try {
        var parts = String(reason || '').split('#');
        sl.debug(parts[0] || 'unknown', 'owned-suppression' + (parts[1] ? ':' + parts[1] : ''),
          { message: err && err.message, code: err && err.code });
      } catch (_) { /* ghi log là best-effort, không bao giờ được ném từ trong catch */ }
    }

    var logger = global.SEOSONA_RedactingLogger;
    if (logger && global.__SEOSONA_DEBUG_ERRORS) {
      try { logger.create(console).debug('[owned-suppression] ' + reason, err && err.message); } catch (_) { /* logging is best-effort */ }
    }
    return fallback;
  }

  function isCode(err, code) { return !!(err && err.code === code); }

  // Lối tắt toàn cục cho các catch "im lặng CÓ CHỦ Ý" rải khắp code sản phẩm.
  // Gọi dạng `globalThis.SEOSONA_swallow?.('File#fn', err)` nên nếu ngữ cảnh nào
  // quên nạp file này thì chỉ là no-op, KHÔNG bao giờ ném thêm lỗi bên trong catch.
  // Xem lại lịch sử: mở DevTools của trang → SEOSONA_ErrorCatalog.suppressions()
  // Bật log realtime:  __SEOSONA_DEBUG_ERRORS = true
  global.SEOSONA_swallow = swallow;

  global.SEOSONA_ErrorCatalog = {
    CODES: CODES,
    makeError: makeError,
    swallow: swallow,
    isCode: isCode,
    suppressions: function () { return suppressed.slice(); },
    // Bản ghi CÓ CẤU TRÚC của cùng những lần nuốt lỗi đó — lọc được theo module.
    // DevTools: SEOSONA_ErrorCatalog.structured(50)
    structured: function (n) { var sl = _structured(); return sl ? sl.recent(n) : []; },
  };
})(typeof self !== 'undefined' ? self : this);
