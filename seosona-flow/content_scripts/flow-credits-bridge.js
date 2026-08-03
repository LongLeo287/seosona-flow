/**
 * flow-credits-bridge — nghe số dư tín dụng Flow mà KHÔNG bấm, KHÔNG gọi thêm request nào.
 *
 * ══ VÌ SAO CÁCH NÀY ══
 * Kiểm trên trang thật (2026-07-27): chính Flow tự gọi
 *     GET https://aisandbox-pa.googleapis.com/v1/credits?key=…
 *     → { credits: 21926, userPaygateTier: "PAYGATE_TIER_TWO", sku: "G1_TIER2",
 *         serviceTier: "SERVICE_TIER_ADVANCED", subscriptionCredits: 21926 }
 * và nó gọi NGAY KHI TẢI TRANG — trình đơn tài khoản vẫn đóng. Nên ta chỉ cần đọc ké câu trả
 * lời đang bay qua.
 *
 * ══ VÌ SAO KHÔNG TỰ GỌI ENDPOINT ĐÓ ══
 * Gọi thẳng sẽ cần: đọc access_token của user từ /fx/api/auth/session, kèm API key hardcode, và
 * xin thêm host permission. Đọc ké thì KHÔNG cần thứ nào trong ba thứ đó — không đụng vào token,
 * không thêm quyền, và vẫn đúng số kể cả khi Google đổi API key.
 *
 * ══ VÌ SAO PHẢI Ở MAIN WORLD + document_start ══
 * Content script thường chạy ở world tách biệt, vá `fetch` ở đó KHÔNG ảnh hưởng fetch của trang.
 * Phải vá trong MAIN world. Và request credits bắn rất sớm ⇒ phải vá TRƯỚC khi trang chạy, tức
 * document_start; vào chậm một nhịp là lỡ mất.
 *
 * Kết quả gửi ra content script qua postMessage (cùng window, có type riêng để không lẫn).
 */
(function () {
  'use strict';
  if (window.__afCreditsBridge) return;      // trang điều hướng nội bộ → đừng vá chồng
  window.__afCreditsBridge = true;

  var TYPE = 'AF_FLOW_CREDITS';
  var RE = /\/v1\/credits(\?|$)/;

  function publish(text) {
    var data;
    try { data = JSON.parse(text); } catch (_) { return; }
    if (!data || typeof data.credits !== 'number') return;
    try {
      window.postMessage({
        type: TYPE,
        credits: data.credits,
        subscriptionCredits: typeof data.subscriptionCredits === 'number' ? data.subscriptionCredits : null,
        // Giữ NGUYÊN VĂN mã gói — không tự diễn giải thành tên gói, vì chưa đối chiếu đủ tài khoản
        // để biết chắc sku nào ứng với gói nào. Bịa tên gói còn tệ hơn hiện mã thô.
        sku: data.sku || null,
        paygateTier: data.userPaygateTier || null,
        serviceTier: data.serviceTier || null,
      }, '*');
    } catch (_) { globalThis.SEOSONA_swallow?.('flow-credits-bridge#publish', _); }
  }

  // ── fetch ──
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) { globalThis.SEOSONA_swallow?.('flow-credits-bridge#fetch', _); }
      var p = origFetch.apply(this, arguments);
      if (RE.test(String(url))) {
        p.then(function (res) {
          // clone() để KHÔNG nuốt mất body của trang — đọc bản sao, trang vẫn dùng bản gốc.
          try { res.clone().text().then(publish, function () {}); } catch (_) { globalThis.SEOSONA_swallow?.('flow-credits-bridge#fetch', _); }
          return res;
        }, function () {});
      }
      return p;
    };
  }

  // ── XMLHttpRequest (phòng khi Flow đổi sang XHR) ──
  var XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XP && XP.open && XP.send) {
    var origOpen = XP.open, origSend = XP.send;
    XP.open = function (method, url) { try { this.__afUrl = url; } catch (_) { globalThis.SEOSONA_swallow?.('flow-credits-bridge#open', _); } return origOpen.apply(this, arguments); };
    XP.send = function () {
      var self = this;
      try {
        if (RE.test(String(self.__afUrl || ''))) {
          self.addEventListener('load', function () {
            try { publish(self.responseText || ''); } catch (_) { globalThis.SEOSONA_swallow?.('flow-credits-bridge#send', _); }
          });
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('flow-credits-bridge#send', _); }
      return origSend.apply(this, arguments);
    };
  }
})();
