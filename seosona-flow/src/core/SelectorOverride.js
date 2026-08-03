/**
 * SelectorOverride — vá selector NÓNG, không cần sửa code, không cần reload extension.
 *
 * Vòng khép kín khi upstream đổi UI:
 *   1. SelectorHealth/SelectorDoctor báo: key nào gãy + selector đang dùng.
 *   2. Bạn tìm selector mới trên trang (Inspect).
 *   3. SelectorOverride.set('flow','submit_button',['button.new']) → CÓ HIỆU LỰC NGAY.
 *   4. Rảnh thì chép vào ProviderConfigManager cho gọn (override vẫn thắng tới khi xoá).
 *
 * Vì sao có hiệu lực ngay: ghi vào chrome.storage.local rồi chrome.storage.onChanged bắn về MỌI
 * ngữ cảnh (content script, sidebar) → cache trong bộ nhớ cập nhật → lần tra selector kế tiếp
 * dùng giá trị mới. Không reload, không rebuild.
 *
 * Ưu tiên: OVERRIDE > config gốc. Xoá override là quay lại config gốc.
 */
(function (root) {
  'use strict';

  var STORE_KEY = 'af_selector_overrides';
  var cache = Object.create(null);   // { provider: { key: [selectors] } }
  var loaded = false;

  function _norm(sel) {
    if (sel == null) return null;
    var arr = Array.isArray(sel) ? sel : String(sel).split(',');
    arr = arr.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return arr.length ? arr : null;
  }

  /** Tra override — ĐỒNG BỘ, dùng được trong hot path tra selector. */
  function get(provider, key) {
    try {
      var p = cache[provider];
      var v = p && p[key];
      return v && v.length ? v : null;
    } catch (_) { return null; }
  }

  /** Shape giống config gốc ({selectors:[...]}) để cắm thẳng vào chỗ đang dùng. */
  function getConfig(provider, key) {
    var s = get(provider, key);
    return s ? { selectors: s, _override: true } : null;
  }

  function list() {
    var out = [];
    for (var p of Object.keys(cache)) for (var k of Object.keys(cache[p] || {})) out.push({ provider: p, key: k, selectors: cache[p][k] });
    return out;
  }

  function set(provider, key, selectors) {
    var arr = _norm(selectors);
    if (!provider || !key) return Promise.resolve(false);
    if (!cache[provider]) cache[provider] = Object.create(null);
    if (arr) cache[provider][key] = arr; else delete cache[provider][key];
    return _persist().then(function () { return true; });
  }

  function remove(provider, key) { return set(provider, key, null); }

  function clear() {
    cache = Object.create(null);
    return _persist();
  }

  function _persist() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(false);
        var payload = {}; payload[STORE_KEY] = cache;
        chrome.storage.local.set(payload, function () { resolve(true); });
      } catch (_) { resolve(false); }
    });
  }

  function load() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { loaded = true; return resolve(cache); }
        chrome.storage.local.get([STORE_KEY], function (st) {
          var v = st && st[STORE_KEY];
          // KHÔNG ghi đè nếu onChanged đã kịp đẩy giá trị mới hơn vào cache trong lúc đang đọc.
          if (v && typeof v === 'object' && !Object.keys(cache).length) cache = v;
          loaded = true;
          resolve(cache);
        });
      } catch (_) { loaded = true; resolve(cache); }
    });
  }

  /** Nghe storage → mọi ngữ cảnh cập nhật NGAY, không cần reload. */
  function watch() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes || !changes[STORE_KEY]) return;
        var nv = changes[STORE_KEY].newValue;
        cache = (nv && typeof nv === 'object') ? nv : Object.create(null);
        try { root.eventBus && root.eventBus.emit && root.eventBus.emit('selector:overrides_changed', list()); } catch (_) { globalThis.SEOSONA_swallow?.('SelectorOverride#watch', _); }
        console.log('[SelectorOverride] cập nhật nóng —', list().length, 'override đang áp dụng');
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('SelectorOverride#watch', _); }
  }

  /** Gợi ý lệnh vá, in kèm báo cáo hỏng cho tiện copy. */
  function hint(provider, key) {
    return "SelectorOverride.set('" + (provider || 'flow') + "', '" + (key || 'KEY') + "', ['CSS_SELECTOR_MỚI'])";
  }

  root.SelectorOverride = {
    get: get, getConfig: getConfig, set: set, remove: remove, clear: clear,
    list: list, load: load, watch: watch, hint: hint,
    _cache: function () { return cache; }, _loaded: function () { return loaded; },
  };

  // Đăng ký watch TRƯỚC rồi mới load: nếu load trước, có khe thời gian giữa lúc đọc xong và lúc
  // gắn listener → thay đổi rơi vào khe đó sẽ bị bỏ lỡ (phải reload mới thấy). Đảo thứ tự là hết.
  watch();
  load();
})(typeof self !== 'undefined' ? self : this);
