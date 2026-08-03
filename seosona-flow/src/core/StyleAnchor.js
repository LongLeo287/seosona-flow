/**
 * StyleAnchor — quản lý & TÁI DÙNG "khối phong cách / nhân vật" verbatim để giữ NHẤT QUÁN khi gen loạt
 * (offline, chrome.storage). Giải pain-point lặp lại ở agnes/arcads/vox: định nghĩa style/character MỘT LẦN
 * (block chữ), rồi CHÈN NGUYÊN VĂN vào mọi prompt → không "trôi" diện mạo giữa các cảnh.
 *
 * API (inject/check/extract THUẦN, testable):
 *   StyleAnchor.inject(prompt, block, {label='STYLE', position='prepend'}) -> string
 *   StyleAnchor.check(prompt, block) -> { present, coverage }        // prompt có chứa nguyên khối?
 *   StyleAnchor.extract(text, label) -> string|null                 // rút khối ra khỏi text có [label]...[/label]
 *   await StyleAnchor.create(name, block, {kind}) / get(name) / list() / remove(name)   // storage
 * kind: 'style' | 'character' | 'brand'
 */
(function (root) {
  'use strict';

  var KEY = 'af_style_anchors';

  function _norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  // Chèn khối anchor NGUYÊN VĂN vào prompt (mặc định đặt trước).
  function inject(prompt, block, opts) {
    opts = opts || {};
    var label = opts.label || 'STYLE';
    var b = String(block == null ? '' : block).trim();
    if (!b) return String(prompt == null ? '' : prompt);
    var wrapped = '[' + label + ']\n' + b + '\n[/' + label + ']';
    var p = String(prompt == null ? '' : prompt);
    return opts.position === 'append' ? (p + '\n\n' + wrapped) : (wrapped + '\n\n' + p);
  }

  // Kiểm prompt có chứa ĐỦ khối anchor không (theo từng dòng non-empty). coverage = tỉ lệ dòng có mặt.
  function check(prompt, block) {
    var lines = String(block == null ? '' : block).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return { present: true, coverage: 1 };
    var np = _norm(prompt);
    var hit = 0;
    lines.forEach(function (l) { if (np.indexOf(_norm(l)) >= 0) hit++; });
    return { present: hit === lines.length, coverage: Math.round(hit / lines.length * 1000) / 1000 };
  }

  // Gỡ khối [label]...[/label] KHỎI prompt (nghịch của inject) — dùng khi sửa lại style. Trả prompt sạch.
  function strip(prompt, label) {
    label = label || 'STYLE';
    try {
      var re = new RegExp('\\[' + label + '\\][\\s\\S]*?\\[\\/' + label + '\\]\\s*', 'gi');
      return String(prompt == null ? '' : prompt).replace(re, '').trim();
    } catch (e) { return String(prompt == null ? '' : prompt).trim(); }
  }

  // Rút khối [label]...[/label] ra khỏi text (case-insensitive). null nếu không có.
  function extract(text, label) {
    label = label || 'STYLE';
    try {
      var re = new RegExp('\\[' + label + '\\]([\\s\\S]*?)\\[\\/' + label + '\\]', 'i');
      var m = String(text == null ? '' : text).match(re);
      return m ? m[1].trim() : null;
    } catch (e) { return null; }
  }

  // Chèn 1 khối anchor vào NHIỀU prompt (batch) — giữ nhất quán khi gen loạt scene/variant.
  function applyToMany(prompts, block, opts) {
    if (!Array.isArray(prompts)) return [];
    return prompts.map(function (p) { return inject(p, block, opts); });
  }

  // ---- Storage ----
  function _get() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { resolve({}); return; }
        chrome.storage.local.get([KEY], function (r) { resolve((r && r[KEY]) || {}); });
      } catch (e) { resolve({}); }
    });
  }
  function _set(obj) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { resolve(false); return; }
        var o = {}; o[KEY] = obj; chrome.storage.local.set(o, function () { resolve(true); });
      } catch (e) { resolve(false); }
    });
  }
  function _now() { try { return Date.now(); } catch (e) { return 0; } }

  async function create(name, block, opts) {
    opts = opts || {};
    if (!name) return false;
    var all = await _get();
    all[String(name)] = { block: String(block == null ? '' : block).trim(), kind: opts.kind || 'style', ts: _now() };
    return _set(all);
  }
  async function get(name) { var all = await _get(); return all[String(name)] || null; }
  async function list() { var all = await _get(); return Object.keys(all).map(function (k) { return Object.assign({ name: k }, all[k]); }); }
  async function remove(name) { var all = await _get(); delete all[String(name)]; return _set(all); }

  root.StyleAnchor = {
    inject: inject, check: check, extract: extract, strip: strip, applyToMany: applyToMany,
    create: create, get: get, list: list, remove: remove,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
