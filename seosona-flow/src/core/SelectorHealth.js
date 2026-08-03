/**
 * SelectorHealth — TỰ KIỂM selector TRƯỚC khi chạy, thay vì phát hiện lúc đang chạy dở.
 *
 * Vấn đề: Flow có ~80 selector key. Nếu Google đổi UI, hiện tại chỉ biết khi job đã submit và fail
 * giữa chừng — tốn quota, tốn thời gian, và khó biết hỏng cái gì.
 *
 * Nguyên tắc "gãy 1 chỗ ≠ chết toàn bộ" được mã hoá thành MỨC ĐỘ (severity), không phải bằng code:
 *   blocking — thiếu là KHÔNG gen được   ⇒ chặn chạy, báo rõ.
 *   critical — gen được nhưng KHÔNG lấy được kết quả ⇒ cảnh báo mạnh.
 *   degraded — chỉ mất tiện ích phụ      ⇒ chạy tiếp bình thường, chỉ ghi nhận.
 *
 * Danh sách key lấy từ ĐƯỜNG CHẠY THẬT (các lời gọi _q/_qa trong content.js), không phải phỏng đoán.
 * Chạy trong content script (cần DOM). Kết quả cũng đẩy vào SelectorDoctor để có lịch sử.
 */
(function (root) {
  'use strict';

  // key → { severity, presence }.
  //   presence 'always'      — PHẢI có trên trang ở trạng thái nghỉ ⇒ thiếu = thật sự gãy.
  //   presence 'conditional' — chỉ xuất hiện ở trạng thái nhất định (menu/dialog đang mở, project
  //                            đã có tile, đang có lỗi…) ⇒ KHÔNG kiểm tĩnh, vì kiểm sẽ luôn báo
  //                            thiếu dù không hỏng gì (báo động giả). Loại này để SelectorDoctor
  //                            bắt khi code THẬT SỰ dùng tới mà không tìm thấy — tín hiệu mới đúng.
  var CRITICAL_MAP = {
    // Không có = không thể gen
    slate_editor: { severity: 'blocking', presence: 'always' },
    submit_button: { severity: 'blocking', presence: 'always' },
    // Gen được nhưng không thu được kết quả
    tile_container: { severity: 'critical', presence: 'always' },
    project_link: { severity: 'critical', presence: 'always' },
    tile_video: { severity: 'critical', presence: 'conditional' },   // chỉ có khi project đã có video
    tile_image: { severity: 'critical', presence: 'conditional' },   // chỉ có khi project đã có ảnh
    // Mất tiện ích phụ, vẫn chạy được
    settings_button: { severity: 'degraded', presence: 'always' },
    flow_scroll_container: { severity: 'degraded', presence: 'always' },
    flow_tab_slider_trigger: { severity: 'degraded', presence: 'conditional' },
    grid_size_small_button: { severity: 'degraded', presence: 'conditional' },   // menu cài đặt đang mở
    show_tile_details_setting: { severity: 'degraded', presence: 'conditional' },// menu đang mở
    flow_modal_dialog: { severity: 'degraded', presence: 'conditional' },        // hộp thoại đang mở
    project_error_indicator: { severity: 'degraded', presence: 'conditional' },  // chỉ khi có lỗi
    menu_item: { severity: 'degraded', presence: 'conditional' },                // menu đang mở
    edit_link: { severity: 'degraded', presence: 'conditional' },
  };

  function _entry(v) {
    return (v && typeof v === 'object') ? v : { severity: String(v || 'degraded'), presence: 'always' };
  }

  var ORDER = { blocking: 0, critical: 1, degraded: 2 };

  /**
   * Chạy kiểm tra trên DOM hiện tại.
   * @param {object} opts
   *   opts.resolve  (key) => string|null   — trả chuỗi selector của key (mặc định dùng _selStr toàn cục)
   *   opts.doc      Document               — mặc định `document`
   *   opts.keys     object                 — map key→severity (mặc định CRITICAL_MAP)
   * @returns {{ok:boolean, canRun:boolean, checked:number, missing:Array, present:Array, summary:string}}
   */
  function check(opts) {
    var o = opts || {};
    var map = o.keys || CRITICAL_MAP;
    var doc = o.doc || (typeof document !== 'undefined' ? document : null);
    var resolve = o.resolve || (typeof root._selStr === 'function' ? root._selStr : null);

    var missing = [], present = [];
    if (!doc || !resolve) {
      return { ok: false, canRun: true, checked: 0, missing: [], present: [], summary: 'Không kiểm được (thiếu DOM hoặc bộ tra selector).' };
    }

    var skipped = 0;
    for (var key of Object.keys(map)) {
      var ent = _entry(map[key]);
      var sev = ent.severity;
      // Bỏ qua key chỉ xuất hiện theo trạng thái — kiểm tĩnh sẽ luôn báo thiếu (báo động giả).
      // Dùng opts.includeConditional=true nếu cố ý muốn kiểm hết (vd đang mở sẵn menu).
      if (ent.presence === 'conditional' && !o.includeConditional) { skipped++; continue; }
      var sel = null;
      try { sel = resolve(key); } catch (_) { sel = null; }
      var rec = { key: key, severity: sev, selectors: sel || null };
      if (!sel) {
        rec.reason = 'no_config';
        missing.push(rec);
        _tell(key, 'no_config', null);
        continue;
      }
      var found = false;
      try { found = !!doc.querySelector(sel); } catch (_) { rec.reason = 'bad_selector'; }
      if (found) { present.push(rec); _tell(key, 'ok', sel); }
      else {
        rec.reason = rec.reason || 'not_found';
        // AUTO: tự dò ứng viên thay thế ngay tại đây → người dùng chỉ việc bấm chọn, khỏi Inspect tay.
        try { rec.suggestions = suggest(sel, { doc: doc }); } catch (_) { rec.suggestions = []; }
        missing.push(rec);
        _tell(key, 'not_found', sel);
      }
    }

    missing.sort(function (a, b) { return (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9); });

    var blocking = missing.filter(function (m) { return m.severity === 'blocking'; });
    var critical = missing.filter(function (m) { return m.severity === 'critical'; });

    return {
      ok: missing.length === 0,
      canRun: blocking.length === 0,           // ⭐ chỉ 'blocking' mới chặn — gãy chỗ khác vẫn chạy
      checked: present.length + missing.length,
      skipped: skipped,                          // key theo-trạng-thái, cố ý không kiểm tĩnh
      missing: missing,
      present: present,
      summary: summarize(present.length, blocking, critical, missing),
    };
  }

  function summarize(okCount, blocking, critical, missing) {
    if (!missing.length) return 'Tất cả selector quan trọng đều OK (' + okCount + ').';
    var parts = [];
    if (blocking.length) parts.push('❌ CHẶN CHẠY — thiếu: ' + blocking.map(k).join(', '));
    if (critical.length) parts.push('⚠️ Gen được nhưng có thể không lấy được kết quả — thiếu: ' + critical.map(k).join(', '));
    var deg = missing.filter(function (m) { return m.severity === 'degraded'; });
    if (deg.length) parts.push('ℹ️ Mất tiện ích phụ (vẫn chạy): ' + deg.map(k).join(', '));
    parts.push('→ Sửa các key trên trong ProviderConfigManager (dom_selectors).');
    return parts.join('\n');
    function k(m) { return m.key; }
  }

  // ── TỰ GỢI Ý SELECTOR THAY THẾ ────────────────────────────────────────────
  // Khi 1 selector chết, thay vì bắt người dùng tự Inspect: rút "ý định" từ selector cũ (role,
  // aria-label, tag, data-*) rồi nới lỏng dần để tìm phần tử còn sống trên trang, và sinh ra
  // selector ỔN ĐỊNH cho nó (ưu tiên thuộc tính ngữ nghĩa, tránh class random do build sinh).
  var HINT_RE = {
    role: /\[role\s*=\s*["']([^"']+)["']\]/i,
    aria: /\[aria-label\s*[*^$]?=\s*["']([^"']+)["']/i,
    data: /\[(data-[a-z0-9-]+)\s*[*^$]?=\s*["']([^"']+)["']/i,
    idPart: /\[id\s*[*^$]=\s*["']([^"']+)["']\]/i,
    tag: /(^|[\s,>])([a-z][a-z0-9]*)(?=[\s.[:#,]|$)/i,
  };

  function _hints(selectorStr) {
    var s = String(selectorStr || '');
    var h = {};
    var m;
    if ((m = HINT_RE.role.exec(s))) h.role = m[1];
    if ((m = HINT_RE.aria.exec(s))) h.aria = m[1];
    if ((m = HINT_RE.data.exec(s))) { h.dataAttr = m[1]; h.dataVal = m[2]; }
    if ((m = HINT_RE.idPart.exec(s))) h.idPart = m[1];
    if ((m = HINT_RE.tag.exec(s))) h.tag = m[2];
    return h;
  }

  /** Sinh selector ổn định cho 1 phần tử: ưu tiên thuộc tính ngữ nghĩa hơn class ngẫu nhiên. */
  function describe(el) {
    if (!el || !el.getAttribute) return null;
    var tag = (el.tagName || '').toLowerCase();
    var role = el.getAttribute('role');
    var aria = el.getAttribute('aria-label');
    var id = el.getAttribute('id');
    if (role && aria) return tag + '[role="' + role + '"][aria-label="' + _esc(aria) + '"]';
    if (aria) return tag + '[aria-label="' + _esc(aria) + '"]';
    if (role) return tag + '[role="' + role + '"]';
    // data-* mang ngữ nghĩa (bỏ qua data ngẫu nhiên dạng hash)
    try {
      for (var a of Array.from(el.attributes || [])) {
        if (a.name.indexOf('data-') === 0 && a.value && a.value.length < 40 && !/^[0-9a-f]{8,}$/i.test(a.value)) {
          return tag + '[' + a.name + '="' + _esc(a.value) + '"]';
        }
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('SelectorHealth#describe', _); }
    if (id && !/[0-9]{4,}/.test(id)) return tag + '#' + id;
    return null; // không tìm được neo ổn định → thà không gợi ý còn hơn gợi ý selector dễ vỡ
  }

  function _esc(v) { return String(v).replace(/["\\]/g, '\\$&'); }

  /**
   * Gợi ý selector thay thế cho 1 key đã chết.
   * @returns {Array<{selector:string, matches:number, text:string}>} tối đa 5 ứng viên
   */
  function suggest(oldSelector, opts) {
    var o = opts || {};
    var doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return [];
    var h = _hints(oldSelector);
    var queries = [];
    if (h.role && h.aria) queries.push('[role="' + h.role + '"][aria-label*="' + _esc(h.aria) + '"]');
    if (h.aria) queries.push('[aria-label*="' + _esc(h.aria) + '"]');
    if (h.role) queries.push('[role="' + h.role + '"]');
    if (h.dataAttr) queries.push('[' + h.dataAttr + ']');
    if (h.idPart) queries.push('[id*="' + _esc(h.idPart) + '"]');
    if (h.tag) queries.push(h.tag);

    var seen = Object.create(null), out = [];
    for (var q of queries) {
      var nodes = [];
      try { nodes = Array.from(doc.querySelectorAll(q)).slice(0, 30); } catch (_) { continue; }
      for (var el of nodes) {
        var cand = describe(el);
        if (!cand || seen[cand]) continue;
        var count = 0;
        try { count = doc.querySelectorAll(cand).length; } catch (_) { continue; }
        if (!count || count > 8) continue;          // quá nhiều = không đặc trưng, bỏ
        seen[cand] = 1;
        out.push({ selector: cand, matches: count, text: String((el.textContent || '').trim()).slice(0, 40) });
        if (out.length >= 5) return out;
      }
    }
    return out;
  }

  function _tell(key, outcome, sel) {
    try {
      var SD = root.SelectorDoctor;
      if (SD && SD.record) SD.record('flow', key, outcome, { selectors: sel });
    } catch (_) { globalThis.SEOSONA_swallow?.('SelectorHealth#_tell', _); }
  }

  // Cho sidebar gọi kiểm từ xa: chrome.runtime.sendMessage({action:'selector:healthCheck'})
  function register() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || msg.action !== 'selector:healthCheck') return false;
        try { sendResponse(check(msg.opts)); } catch (e) { sendResponse({ ok: false, canRun: true, error: String((e && e.message) || e) }); }
        return false; // đồng bộ
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('SelectorHealth#register', _); }
  }

  root.SelectorHealth = { check: check, suggest: suggest, describe: describe, CRITICAL_MAP: CRITICAL_MAP, register: register };
  register();
})(typeof self !== 'undefined' ? self : this);
