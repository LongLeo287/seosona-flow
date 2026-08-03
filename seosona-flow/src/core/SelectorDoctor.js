/**
 * SelectorDoctor — ghi nhận selector nào GÃY khi web đổi giao diện, để sửa 1 dòng config thay vì mò.
 *
 * Vấn đề nó giải: tri thức DOM của SEOSONA đã là DATA (ProviderConfigManager._LOCAL_DOM_SELECTORS,
 * có config_version). Nhưng khi Google/ChatGPT/Grok đổi UI, `querySelector` chỉ trả null — KHÔNG ai
 * ghi lại là key nào hỏng. Hệ quả: mỗi lần upstream đổi là một buổi dò tay.
 *
 * Cách dùng: gọi record() ở các choke point tra selector (content.js _q/_qa, _getSelectorsForKey…).
 * Rồi `SelectorDoctor.reportText()` in ra đúng danh sách key cần sửa + selector đang dùng.
 *
 * Phân loại kết quả:
 *   ok         — tìm thấy phần tử.
 *   not_found  — CÓ selector trong config nhưng KHÔNG khớp phần tử nào  ⇒ **upstream đã đổi UI**.
 *   no_config  — không có selector nào trong config cho key này          ⇒ thiếu cấu hình.
 *
 * Thuần quan sát: không đổi hành vi, không throw, không log dữ liệu người dùng (chỉ key + selector).
 */
(function (root) {
  'use strict';

  var STORE_KEY = 'af_selector_health';
  var MAX_ENTRIES = 200;

  // id -> { provider, key, ok, notFound, noConfig, selectors, version, lastAt }
  var stats = Object.create(null);
  var _saveTimer = null;

  function _id(provider, key) { return String(provider || '?') + '::' + String(key || '?'); }

  function _now() { try { return Date.now(); } catch (_) { return 0; } }

  /**
   * @param {string} provider  'flow' | 'chatgpt' | 'grok' | …
   * @param {string} key       khoá selector trong config
   * @param {'ok'|'not_found'|'no_config'} outcome
   * @param {{selectors?:string[]|string, version?:number|string}} [meta]
   */
  function record(provider, key, outcome, meta) {
    try {
      var id = _id(provider, key);
      var e = stats[id];
      if (!e) {
        if (Object.keys(stats).length >= MAX_ENTRIES) return; // chặn phình vô hạn
        e = stats[id] = { provider: String(provider || '?'), key: String(key || '?'), ok: 0, notFound: 0, noConfig: 0, selectors: null, version: null, lastAt: 0 };
      }
      if (outcome === 'ok') e.ok++;
      else if (outcome === 'not_found') e.notFound++;
      else if (outcome === 'no_config') e.noConfig++;
      else return;

      if (meta) {
        if (meta.selectors != null) {
          e.selectors = Array.isArray(meta.selectors) ? meta.selectors.slice(0, 8) : String(meta.selectors).split(',').map(function (s) { return s.trim(); }).slice(0, 8);
        }
        if (meta.version != null) e.version = meta.version;
      }
      e.lastAt = _now();
      _scheduleSave();
    } catch (_) { /* chẩn đoán không bao giờ được làm hỏng luồng chính */ }
  }

  /**
   * Báo cáo: key nào đang gãy.
   * broken   = từng not_found và CHƯA từng ok  ⇒ nghi upstream đổi UI (ưu tiên sửa).
   * flaky    = có cả ok lẫn not_found          ⇒ có thể do timing, không hẳn đổi UI.
   * noConfig = thiếu cấu hình.
   */
  function report() {
    var broken = [], flaky = [], noConfig = [], okCount = 0;
    for (var id of Object.keys(stats)) {
      var e = stats[id];
      okCount += e.ok;
      if (e.noConfig > 0 && e.ok === 0) noConfig.push(e);
      else if (e.notFound > 0 && e.ok === 0) broken.push(e);
      else if (e.notFound > 0) flaky.push(e);
    }
    var by = function (a, b) { return b.notFound + b.noConfig - (a.notFound + a.noConfig); };
    return { broken: broken.sort(by), flaky: flaky.sort(by), noConfig: noConfig.sort(by), okCount: okCount, tracked: Object.keys(stats).length };
  }

  /** Bản người đọc — dán thẳng vào issue hoặc dùng để sửa config. */
  function reportText() {
    var r = report();
    if (!r.broken.length && !r.noConfig.length && !r.flaky.length) {
      return 'Selector OK — ' + r.okCount + ' lần khớp, ' + r.tracked + ' key theo dõi.';
    }
    var out = [];
    var fmt = function (e) {
      var sels = e.selectors && e.selectors.length ? e.selectors.join(' , ') : '(không có selector)';
      return '  · [' + e.provider + '] ' + e.key
        + (e.version != null ? ' (config_version ' + e.version + ')' : '')
        + ' — hỏng ' + (e.notFound + e.noConfig) + ' lần'
        + (e.ok ? ', từng OK ' + e.ok + ' lần' : '')
        + '\n      đang dùng: ' + sels;
    };
    if (r.broken.length) out.push('GÃY (nghi upstream đổi UI) — sửa các key này trong ProviderConfigManager:', r.broken.map(fmt).join('\n'));
    if (r.noConfig.length) out.push('THIẾU CẤU HÌNH:', r.noConfig.map(fmt).join('\n'));
    if (r.flaky.length) out.push('CHẬP CHỜN (có thể do timing, xem sau):', r.flaky.map(fmt).join('\n'));
    return out.join('\n');
  }

  function reset() { stats = Object.create(null); _persist(); }

  function _scheduleSave() {
    if (_saveTimer) return;
    try {
      _saveTimer = setTimeout(function () { _saveTimer = null; _persist(); }, 3000);
    } catch (_) { _saveTimer = null; }
  }

  function _persist() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      var payload = {}; payload[STORE_KEY] = { at: _now(), stats: stats };
      chrome.storage.local.set(payload);
    } catch (_) { globalThis.SEOSONA_swallow?.('SelectorDoctor#_persist', _); }
  }

  function load() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(null);
        chrome.storage.local.get([STORE_KEY], function (st) {
          var saved = st && st[STORE_KEY];
          if (saved && saved.stats) for (var id of Object.keys(saved.stats)) if (!stats[id]) stats[id] = saved.stats[id];
          resolve(saved || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  root.SelectorDoctor = {
    record: record, report: report, reportText: reportText, reset: reset, load: load,
    _stats: function () { return stats; },
  };
})(typeof self !== 'undefined' ? self : this);
