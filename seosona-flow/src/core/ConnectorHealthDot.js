/**
 * ConnectorHealthDot — chấm trạng thái kết nối Flow ở header sidebar.
 *
 * Vì sao cần: lỗi hay gặp nhất không phải lỗi logic mà là "quên mở tab Flow", "chưa đăng
 * nhập", hoặc "vừa tải lại tiện ích nên tab cũ mất kết nối". Trước đây người dùng chỉ biết
 * SAU KHI bấm chạy và thấy hỏng. FlowDoctor đã tính được đủ 4 mục kiểm tra nhưng nằm trong
 * một tab phải tự mở — tức là chỉ ai đã nghi ngờ mới thấy.
 *
 * Chấm này đưa cùng dữ liệu đó ra chỗ LUÔN nhìn thấy, và bấm vào thì mở thẳng Bác sĩ.
 *
 * Nguyên tắc: KHÔNG tự dò liên tục. Dò khi mở sidebar, khi cửa sổ được focus lại, và khi
 * có sự kiện đáng nghi (lỗi Flow được phân loại). Poll mỗi vài giây chỉ tốn pin và tạo
 * request thừa — mà request thừa tới Flow đúng là thứ ta đang tránh.
 */
(function (root) {
  'use strict';

  var STATES = {
    ready: { cls: 'chd-ready', label: 'Sẵn sàng — Flow đang kết nối' },
    warn: { cls: 'chd-warn', label: 'Có vấn đề — bấm để xem cách xử lý' },
    off: { cls: 'chd-off', label: 'Chưa kết nối Flow — bấm để xem cách xử lý' },
    checking: { cls: 'chd-checking', label: 'Đang kiểm tra…' },
  };

  var el = null;
  var busy = false;
  var lastAt = 0;
  var MIN_GAP_MS = 5000; // chống dò dồn dập khi nhiều sự kiện bắn cùng lúc

  function _ask(action) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ action: action }, function (r) {
          void chrome.runtime.lastError;  // phải đọc, không thì Chrome log "Unchecked runtime.lastError"
          resolve(r || null);
        });
      } catch (_e) { resolve(null); }
    });
  }

  /** Dùng CHUNG bộ dò với tab Bác sĩ — hai nơi lệch nhau thì người dùng mất tin cả hai. */
  function probes() {
    return {
      flowTab: function () {
        return _ask('checkFlowTabOpen').then(function (r) {
          return { ok: !!(r && (r.isOpen || r.open || r.tabId)), detail: r ? null : 'không hỏi được background' };
        });
      },
      loggedIn: function () {
        return _ask('checkFlowTabOpen').then(function (r) {
          if (!r) return { ok: false, detail: 'chưa xác định được' };
          return { ok: r.loggedIn !== false, detail: r.loggedIn === false ? 'chưa đăng nhập' : null };
        });
      },
      contentScript: function () {
        return _ask('checkFlowTabOpen').then(function (r) {
          return { ok: !!(r && r.contentScriptAlive !== false && (r.isOpen || r.open || r.tabId)) };
        });
      },
      credits: function () {
        return _ask('flowCreditsScan').then(function (r) {
          var n = r && (r.credits != null ? r.credits : r.remaining);
          // Chưa đọc được số dư thì KHÔNG coi là hỏng: nhiều lúc chỉ là chưa quét lần nào.
          if (n == null) return { ok: true, detail: 'chưa đọc được số dư' };
          return { ok: Number(n) > 0, detail: 'còn ' + n };
        });
      },
    };
  }

  function _paint(state, detail) {
    if (!el) return;
    var s = STATES[state] || STATES.off;
    Object.keys(STATES).forEach(function (k) { el.classList.remove(STATES[k].cls); });
    el.classList.add(s.cls);
    el.setAttribute('data-tooltip', detail ? (s.label + ' — ' + detail) : s.label);
    el.setAttribute('aria-label', s.label);
  }

  async function check(force) {
    if (!el || busy) return null;
    var now = Date.now();
    if (!force && now - lastAt < MIN_GAP_MS) return null;
    busy = true; lastAt = now;
    _paint('checking');
    try {
      var FD = root.FlowDoctor;
      if (!FD || !FD.selfCheck) { _paint('off', 'thiếu FlowDoctor'); return null; }
      var res = await FD.selfCheck(probes());
      if (res.ok) { _paint('ready'); return res; }
      // Không có tab Flow là "chưa kết nối"; có tab mà thiếu thứ khác là "có vấn đề".
      var noTab = res.checks.some(function (c) { return c.id === 'flowTab' && !c.ok; });
      var bad = res.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label; });
      _paint(noTab ? 'off' : 'warn', bad.join('; '));
      return res;
    } finally { busy = false; }
  }

  function mount(host) {
    if (!host || el) return el;
    el = document.createElement('button');
    el.id = 'connectorHealthDot';
    el.className = 'seosonaflow-header-btn chd';
    el.type = 'button';
    el.setAttribute('data-tooltip-pos', 'bottom');
    el.innerHTML = '<span class="chd-dot"></span>';
    _paint('checking');
    // Bấm vào → mở tab Bác sĩ. Chấm chỉ BÁO, không tự sửa; nơi hướng dẫn sửa là Bác sĩ.
    el.addEventListener('click', function () {
      try {
        var btn = document.querySelector('.seosonaflow-logs-subtab[data-subtab="logs-doctor"]');
        var logsTab = document.querySelector('[data-tab="logs"], .seosonaflow-tab[data-tab="logs"]');
        if (logsTab) logsTab.click();
        if (btn) btn.click();
      } catch (_e) { globalThis.SEOSONA_swallow?.('ConnectorHealthDot#click', _e); }
      check(true);
    });
    host.insertBefore(el, host.firstChild);

    // Dò lại khi có tín hiệu, KHÔNG poll định kỳ (tốn pin + tạo request thừa tới Flow).
    root.addEventListener?.('focus', function () { check(false); });
    root.eventBus?.on?.('flow:error_classified', function () { check(true); });
    root.eventBus?.on?.('queue:halted', function () { check(true); });
    check(true);
    return el;
  }

  root.ConnectorHealthDot = { STATES: STATES, mount: mount, check: check, probes: probes };
})(typeof window !== 'undefined' ? window : this);
