/**
 * FlowCreditsScanner — đọc số dư tín dụng trên trang Flow mà KHÔNG đụng vào giao diện.
 *
 * ══ VÌ SAO KHÔNG TỰ MỞ TRÌNH ĐƠN (đính chính thiết kế cũ) ══
 * Số dư nằm trong trình đơn tài khoản, mặc định đóng. Bản đầu tôi cho extension tự bấm avatar để
 * mở rồi đóng lại. Kiểm trên DOM Flow THẬT (2026-07-27) cho thấy chỉ nửa đầu chạy được:
 *   · MỞ được  — btn.click() tổng hợp mở panel bình thường
 *   · ĐÓNG thì KHÔNG — đã thử Escape→document, Escape→activeElement, .click() và cả chuỗi
 *     pointerdown/mousedown/pointerup/mouseup/click đầy đủ lên nút "Đóng cửa sổ phụ này" lẫn lên
 *     avatar. Tất cả đều vô tác dụng. Chỉ CLICK CHUỘT THẬT mới đóng được.
 * Content script không tạo được sự kiện trusted ⇒ tự mở = để trình đơn mở toang giữa mặt người
 * dùng sau mỗi lần quét. Tệ hơn là không có tính năng.
 *
 * ══ CÁCH LÀM THAY THẾ ══
 *   1. QUÉT THỤ ĐỘNG — đọc DOM, không bấm gì. Chạy được khi trình đơn đang mở, HOẶC đã từng mở
 *      trong phiên trang này (React giữ panel trong DOM, số vẫn cập nhật).
 *   2. Chưa có → KHÔNG tự mở. Trả NEED_USER_ACTION kèm hướng dẫn một câu.
 *   3. RÌNH — MutationObserver: khoảnh khắc người dùng tự mở trình đơn (việc họ vẫn làm), số dư
 *      được bắt và lưu ngay. Nên user chỉ phải làm ĐÚNG MỘT LẦN, các lần sau tự có.
 *
 * Đổi lại: chậm hơn một nhịp so với tự-mở, nhưng KHÔNG BAO GIỜ để lại giao diện lộn xộn.
 */
(function (root) {
  'use strict';

  var _observer = null;
  var _lastSeen = null;

  /** Quét thụ động — chỉ ĐỌC, không bấm gì. */
  function scanPassive(opts) {
    var o = opts || {};
    var d = o.document || (typeof document !== 'undefined' ? document : null);
    var AP = o.AccountPlan || root.AccountPlan;
    if (!d) return { known: false, reason: 'NO_DOCUMENT' };
    if (!AP || typeof AP.detectFlowCredits !== 'function') return { known: false, reason: 'NO_ACCOUNT_PLAN' };

    var r = AP.detectFlowCredits(d);
    if (r.known) { _lastSeen = r.credits; return r; }

    return {
      known: false,
      reason: 'NEED_USER_ACTION',
      hint: 'Bấm vào ảnh đại diện ở góc phải trên trang Flow — số dư sẽ tự được đọc và ghi nhớ.',
    };
  }

  /**
   * Rình: bắt số dư ngay khi nó xuất hiện (người dùng tự mở trình đơn tài khoản).
   * Gọi lại `onFound(credits, raw)` mỗi lần đọc được một giá trị KHÁC lần trước — tránh spam.
   * @returns {function} hàm dừng rình
   */
  function watch(onFound, opts) {
    var o = opts || {};
    var d = o.document || (typeof document !== 'undefined' ? document : null);
    var AP = o.AccountPlan || root.AccountPlan;
    var MO = o.MutationObserver || root.MutationObserver;
    if (!d || !AP || !MO || !d.body) return function () {};

    stop();
    var pending = null;
    var check = function () {
      pending = null;
      var r = AP.detectFlowCredits(d);
      if (!r.known) return;
      if (r.credits === _lastSeen) return;      // không đổi → im lặng
      _lastSeen = r.credits;
      try { onFound(r.credits, r.raw, r); } catch (_) { globalThis.SEOSONA_swallow?.('FlowCreditsScanner#check', _); }
    };

    _observer = new MO(function () {
      // Gộp nhiều mutation liên tiếp thành 1 lần kiểm — panel render nhiều nhịp.
      if (pending) return;
      pending = setTimeout(check, o.debounce || 250);
    });
    _observer.observe(d.body, { childList: true, subtree: true, characterData: true });

    check();   // kiểm ngay lần đầu, phòng khi trình đơn đang mở sẵn
    return stop;
  }

  function stop() {
    if (_observer) { try { _observer.disconnect(); } catch (_) { globalThis.SEOSONA_swallow?.('FlowCreditsScanner#stop', _); } _observer = null; }
  }

  root.FlowCreditsScanner = {
    scanPassive: scanPassive,
    scan: scanPassive,          // tương thích tên cũ
    watch: watch,
    stop: stop,
    _lastSeen: function () { return _lastSeen; },
    _reset: function () { _lastSeen = null; },
  };
})(typeof self !== 'undefined' ? self : this);
