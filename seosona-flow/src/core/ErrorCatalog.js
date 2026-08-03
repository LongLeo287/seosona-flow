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
  function swallow(reason, err, fallback) {
    suppressed.push({ reason: reason, message: err && err.message });
    if (suppressed.length > 500) suppressed.shift();
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
  };
})(typeof self !== 'undefined' ? self : this);
