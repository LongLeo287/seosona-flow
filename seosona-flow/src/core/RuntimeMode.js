/**
 * RuntimeMode — công tắc chế độ chạy của SEOSONA Flow.
 *
 * LOCAL (mặc định): extension chạy HOÀN TOÀN offline, KHÔNG gọi backend.
 *   - Model / provider config / voice / i18n / validation → dùng default cục bộ (bundled).
 *   - SSE/Mercure, ConfigVersionPoller, UsageSync, BackendSync, Announcement → tắt (no-op).
 *   - ExecutionGate / FeatureGate / quota → cho phép tất cả (không giới hạn).
 *   - Lưu trữ workflow/task/prompt/history → thuần local (chrome.storage + IndexedDB), không sync server.
 *
 * BẬT ONLINE sau này (khi đã có backend HTTPS):
 *   1) Đặt  window.SEOSONA_LOCAL_MODE = false  TRƯỚC khi các script src/core/* chạy
 *      (hoặc đổi DEFAULT_LOCAL = false bên dưới).
 *   2) Cấu hình apiBaseUrl = 'https://api-cua-ban.com/api/v1' trong Settings.
 *
 * Ghi chú kỹ thuật: mọi module đọc cờ qua biểu thức  (self.SEOSONA_LOCAL_MODE !== false)
 * nên MẶC ĐỊNH là LOCAL kể cả khi file này chưa kịp load (an toàn thứ tự load).
 */
(function (root) {
  var DEFAULT_LOCAL = true;

  // Noise guard (window pages: sidebar, editor windows): nuốt lỗi Chrome-internal THOÁNG QUA khi user
  // reload extension / service worker ngủ dậy — "No SW", "fetching the script", context invalidated,
  // message port/channel closed… — để không spam trang Lỗi. Cùng bộ pattern với content.js. Lỗi thật
  // (không khớp pattern + context còn sống) VẪN nổi lên bình thường.
  if (typeof window !== 'undefined' && !root.__seosonaNoiseGuard) {
    root.__seosonaNoiseGuard = true;
    var _NRE = /context (was )?invalidated|Extension context|\bNo SW\b|no service worker|fetching the script|message (port|channel) (is )?closed|could not establish connection|receiving end does not exist|back\/forward cache/i;
    var _ctxDead = function () { try { return !(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); } catch (_) { return true; } };
    try {
      window.addEventListener('error', function (e) {
        var m = (e && (e.message || (e.error && e.error.message))) || '';
        if (_NRE.test(String(m)) || _ctxDead()) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); return false; }
      }, true);
      window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason; var m = (r && (r.message || r)) || '';
        if (_NRE.test(String(m)) || _ctxDead()) { e.preventDefault(); }
      });
    } catch (_) { /* ignore */ }

    // ── Chặn TẬN GỐC "Uncaught (in promise) Error: No SW" ────────────────────────────────
    //
    // Hai lưới ở trên chỉ GIẤU lỗi sau khi nó đã nổ. Nguồn thật: chrome.runtime.sendMessage
    // KHÔNG có callback trả về một Promise, và Promise đó TỪ CHỐI khi service worker đang ngủ.
    // Repo có hơn 60 chỗ gọi kiểu đó, phần lớn bọc trong try/catch — mà try/catch KHÔNG bắt
    // được từ chối bất đồng bộ. Nên mỗi lần worker ngủ là một dòng đỏ trong bảng Lỗi.
    //
    // Bọc ở ĐÚNG MỘT chỗ thay vì đi vá 60 chỗ gọi. Dạng có callback giữ nguyên hoàn toàn;
    // chỉ dạng Promise được gắn thêm .catch, và chỉ nuốt đúng nhóm lỗi worker-ngủ — lỗi thật
    // vẫn ném bình thường.
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage
          && !chrome.runtime.sendMessage.__seosonaWrapped) {
        var _origSend = chrome.runtime.sendMessage.bind(chrome.runtime);
        var _wrapped = function () {
          var args = Array.prototype.slice.call(arguments);
          var hasCb = typeof args[args.length - 1] === 'function';
          var out = _origSend.apply(null, args);
          // Dạng callback: Chrome không trả Promise → trả nguyên, caller tự đọc lastError.
          if (hasCb || !out || typeof out.then !== 'function') return out;
          return out.catch(function (err) {
            var m = (err && (err.message || err)) || '';
            if (_NRE.test(String(m)) || _ctxDead()) return undefined;   // worker ngủ — im lặng
            throw err;                                                  // lỗi thật — giữ nguyên
          });
        };
        _wrapped.__seosonaWrapped = true;
        chrome.runtime.sendMessage = _wrapped;
      }
    } catch (_) { /* không bọc được thì thôi, không được phá luồng khởi động */ }

    // Hạ mức console.warn/info BÌNH THƯỜNG (operational/reload-noise) xuống debug → không hiện trang Lỗi.
    // GIỮ console.error + exception thật. Cùng ý tưởng với content.js.
    try {
      // Gộp tất cả args thành 1 chuỗi để test — keyword benign/user thường ở arg thứ 2+ (vd
      // console.warn('[X] msg:', details)) chứ không chỉ arg[0]. Chỉ check arg[0] → lọt lưới.
      var _joinCArgs = function (a) { var s = ''; for (var k = 0; k < a.length && k < 4; k++) { var v = a[k]; try { s += ' ' + String(v && v.message ? v.message : v); } catch (_) { s += ' [obj]'; } } return s; };
      var _BENIGN = /skipping|without tile|no valid tile|cache miss|fallback|Tier3|chưa sẵn sàng|not ready|đang inject lại|coming soon|cold start|no flow tab|không tìm thấy tab|đang thử lại|bỏ qua|context invalidated|Extension context|\bNo SW\b|fetching the script|plans fetch|Untrusted sender|Direct inject failed|Slate bridge inject failed|Giữ edge đã lưu|DEP_SKIP|Card not found for progress update|Bridge return success=false|\bRetryHelper\b|CONFIG_REQUIRED|data_missing|safeGetModelsSync/i;
      ['warn', 'info'].forEach(function (level) {
        var orig = console[level] ? console[level].bind(console) : null;
        if (!orig) return;
        console[level] = function () {
          try {
            if (_BENIGN.test(_joinCArgs(arguments))) { (console.debug || orig).apply(console, arguments); return; }
          } catch (_) { globalThis.SEOSONA_swallow?.('RuntimeMode#_joinCArgs', _); }
          return orig.apply(console, arguments);
        };
      });

      // ── console.error ROUTER (2 kênh) ──────────────────────────────────────
      // Lỗi USER-ACTIONABLE (Flow chưa login, thiếu ảnh input, submit không thấy, timeout,
      // thiếu model, lỗi mạng…) → TOAST thân thiện + hướng dẫn, hạ debug (KHÔNG hiện panel "Lỗi" dev).
      // Bug extension THẬT (không khớp mẫu nào) → GIỮ console.error → hiện panel dev để fix.
      // Dùng chung cơ chế đã chứng minh với warn/info (giữ benign khỏi panel).
      var _USER_ISSUES = [
        { re: /submit button not found|arrow_forward|không thấy nút tạo|nút tạo.*không/i, msg: 'Không thấy nút Tạo trên trang Flow — mở tab Flow & đăng nhập rồi thử lại.' },
        { re: /không có file kết quả|thiếu.*(ảnh|input)|no input file|node nguồn.*chưa|missing.*input/i, msg: 'Node nguồn chưa có ảnh — nạp ảnh vào node input rồi chạy lại.' },
        { re: /\btimeout\b|quá thời gian|disabled after \d+\s*s|hết thời gian/i, msg: 'Thao tác quá thời gian — kiểm tra tab provider & kết nối mạng rồi thử lại.' },
        { re: /(chưa|not).{0,12}(đăng nhập|logged.?in)|logged out|unauthorized|\b401\b|\b403\b|login required/i, msg: 'Chưa đăng nhập — mở tab provider & đăng nhập rồi thử lại.' },
        { re: /config_required|no model|model.{0,12}(missing|not found)|data_missing/i, msg: 'Chưa cấu hình model — vào Settings hoặc chọn model khác cho node.' },
        { re: /failed to fetch|networkerror|net::err|no internet|mất mạng/i, msg: 'Lỗi mạng — kiểm tra kết nối internet rồi thử lại.' },
        { re: /message channel closed|listener indicated an async|receiving end does not exist/i, msg: 'Kết nối với tab Flow bị gián đoạn (tab đóng/đổi trang, hoặc reload extension khi đang chạy) — mở lại tab Flow rồi thử lại.' },
      ];
      var _lastUserToast = {};
      function _routeUserIssue(text) {
        try {
          for (var i = 0; i < _USER_ISSUES.length; i++) {
            if (_USER_ISSUES[i].re.test(text)) {
              var m = _USER_ISSUES[i].msg;
              var now = Date.now();
              if (typeof window !== 'undefined' && typeof window.showNotification === 'function'
                  && (_lastUserToast[m] == null || now - _lastUserToast[m] > 4000)) {
                _lastUserToast[m] = now;
                try { window.showNotification(m, 'warning', 7000); } catch (_) { globalThis.SEOSONA_swallow?.('RuntimeMode#_routeUserIssue', _); }
              }
              return true; // đã xử lý (toast) → route khỏi panel dev
            }
          }
        } catch (_) { globalThis.SEOSONA_swallow?.('RuntimeMode#_routeUserIssue', _); }
        return false;
      }
      var _origErr = console.error ? console.error.bind(console) : null;
      if (_origErr) {
        console.error = function () {
          try {
            var joined = _joinCArgs(arguments);
            if (_BENIGN.test(joined)) { (console.debug || _origErr).apply(console, arguments); return; }
            if (_routeUserIssue(joined)) { (console.debug || _origErr).apply(console, arguments); return; }
          } catch (_) { globalThis.SEOSONA_swallow?.('RuntimeMode#error', _); }
          return _origErr.apply(console, arguments);
        };
      }
    } catch (_) { /* ignore */ }
  }

  if (typeof root.SEOSONA_LOCAL_MODE === 'undefined') {
    root.SEOSONA_LOCAL_MODE = DEFAULT_LOCAL;
  }

  // Ghi cờ vào chrome.storage.local để background service worker (không có window/RuntimeMode)
  // đọc được cùng một giá trị — dùng gate apiRequest proxy.
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ SEOSONA_LOCAL_MODE: root.SEOSONA_LOCAL_MODE });
    }
  } catch (_) { /* ignore */ }

  root.RuntimeMode = {
    /** true nếu đang chạy local/offline (mặc định). */
    isLocal: function () {
      try { return root.SEOSONA_LOCAL_MODE !== false; }
      catch (_) { return DEFAULT_LOCAL; }
    },
    /** true nếu đã bật online (có backend). */
    isOnline: function () { return !this.isLocal(); }
  };

  // SEOSONA local-first: debrand fork KHÔNG có backend → mọi UI login / premium /
  // nâng cấp / paid / quota (lượt chạy) / plan-badge là RÁC gây rối. Ẩn TOÀN BỘ qua
  // 2 class body (rules ở styles/sidebar.css + settings.css). RuntimeMode load đầu
  // tiên trên MỌI page (head) nên phủ hết. Guard document để service worker bỏ qua.
  if (root.RuntimeMode.isLocal() && typeof document !== 'undefined') {
    var _seosonaHideMonetization = function () {
      var b = document.body;
      if (b) b.classList.add('hide-upgrade-ui', 'seosona-hide-monetization');
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _seosonaHideMonetization);
    } else {
      _seosonaHideMonetization();
    }
  }

  // Notify shim: vài module gọi root.SEOSONANotify / root.SeosonaNotify .{success,info,warning,error}(msg)
  // nhưng global này CHƯA TỪNG được định nghĩa → các toast (share workflow bị từ chối/
  // thu hồi, "đã refresh node types", provider không khả dụng, cảnh báo image-picker) im lặng không hiện.
  // Định nghĩa 1 lần tại đây (RuntimeMode load sớm nhất, phủ mọi page): ủy quyền LAZY sang
  // root.showNotification (có ở sidebar) lúc GỌI, fallback console ở page không có toast. Casing kép để
  // khớp cả 2 cách viết đang tồn tại trong code (SEOSONANotify + SeosonaNotify).
  if (typeof root.SEOSONANotify === 'undefined') {
    var _mkNotify = function (type) {
      return function (msg) {
        try {
          if (typeof root.showNotification === 'function') { root.showNotification(msg, type); return; }
        } catch (_) { /* fall through to console */ }
        try { (type === 'error' || type === 'warning' ? console.warn : console.log)('[Notify:' + type + ']', msg); } catch (_) { globalThis.SEOSONA_swallow?.('RuntimeMode#_mkNotify', _); }
      };
    };
    root.SEOSONANotify = {
      success: _mkNotify('success'),
      info: _mkNotify('info'),
      warning: _mkNotify('warning'),
      error: _mkNotify('error'),
    };
    root.SeosonaNotify = root.SEOSONANotify;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
