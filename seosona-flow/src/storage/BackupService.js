// SEOSONA Flow — Backup & Portability Service (Tier 1: chrome.storage.local).
//
// Bản này 100% local, không server → data user chỉ nằm 1 máy. BackupService gom toàn
// bộ chrome.storage.local (trừ secret + state runtime) thành 1 bundle JSON versioned để
// TẢI VỀ, và NẠP LẠI ở máy khác (merge hoặc replace). Classic script, dependency-injected
// (area kiểu chrome.storage) nên unit-test được không cần browser.
//
// KHÔNG bao gồm IndexedDB (ảnh album) ở Tier 1 — sẽ mở rộng ở Tier 2. Thumbnail trong
// af_tasks/af_nodes/... phần lớn là URL Google Flow (nhẹ) nên Tier 1 đủ ~90% nhu cầu.
(function (global) {
  'use strict';

  var SCHEMA = 'seosona.backup.v1';
  var VERSION = 1;
  var LEGACY_SCHEMA = 'seosona.privacy.export.v1'; // DataLifecycleService.exportAll → nhận nạp được

  // Secret — KHÔNG export trừ khi opts.includeSecrets (mặc định tắt).
  var SECRET_KEYS = ['af_auth', 'local_mcp_tokens', 'seosonaLocalMcp'];
  // Runtime/transient — nạp lại là SAI (state thực thi, cờ mode mirror, hàng đợi sync).
  // Luôn loại khỏi export VÀ không đụng tới khi replace.
  var RUNTIME_KEYS = [
    'af_running_workflow', 'af_pending_sync', 'af_stopped_wfids',
    'SEOSONA_LOCAL_MODE', 'af_settings_pending_resync', 'af_settings_touched', 'af_settings_owner'
  ];
  // Mảng-đối-tượng → merge theo id (field id đầu tiên khớp trên item).
  var ID_FIELDS = ['id', 'wf_id', 'node_id', 'edge_id', 'task_id', 'project_id'];
  var UNSAFE = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  function itemId(o) {
    if (!o || typeof o !== 'object') return undefined;
    for (var i = 0; i < ID_FIELDS.length; i++) {
      var f = ID_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(o, f) && o[f] != null) return String(o[f]);
    }
    return undefined;
  }

  // Merge 2 mảng theo id: item incoming trùng id → ghi đè; id mới → thêm; item không id → thêm.
  function mergeArrays(existing, incoming) {
    existing = Array.isArray(existing) ? existing.slice() : [];
    incoming = Array.isArray(incoming) ? incoming : [];
    var index = {}, out = [];
    existing.forEach(function (it) { var id = itemId(it); if (id !== undefined) index[id] = out.length; out.push(it); });
    incoming.forEach(function (it) {
      var id = itemId(it);
      if (id !== undefined && index[id] !== undefined) out[index[id]] = it;
      else { if (id !== undefined) index[id] = out.length; out.push(it); }
    });
    return out;
  }

  function create(cfg) {
    cfg = cfg || {};
    var area = cfg.area;
    if (!area || typeof area.get !== 'function') throw new Error('BackupService requires a storage area');
    var now = typeof cfg.now === 'function' ? cfg.now : function () { return null; };

    function snapshot() { return Promise.resolve(area.get(null)).then(function (all) { return all || {}; }); }

    function excludedKeys(opts) {
      var ex = {};
      RUNTIME_KEYS.forEach(function (k) { ex[k] = 1; });
      if (!(opts && opts.includeSecrets)) SECRET_KEYS.forEach(function (k) { ex[k] = 1; });
      return ex;
    }

    // Tạo bundle export (Tier 1 = chỉ storage.local).
    function buildExport(opts) {
      opts = opts || {};
      return snapshot().then(function (all) {
        var ex = excludedKeys(opts);
        var storage = {};
        Object.keys(all).forEach(function (k) {
          if (ex[k] || UNSAFE[k]) return;
          storage[k] = all[k];
        });
        return {
          schema: SCHEMA, version: VERSION, app: 'seosona-flow',
          createdAt: now(), keyCount: Object.keys(storage).length, storage: storage
        };
      });
    }

    function extractStorage(bundle) {
      if (!bundle || typeof bundle !== 'object') return null;
      if (bundle.schema === SCHEMA) return bundle.storage || {};
      if (bundle.schema === LEGACY_SCHEMA) return bundle.entries || {};
      return null;
    }

    // Nạp bundle. mode: 'merge' (mặc định — gộp mảng theo id, ghi đè key đơn) | 'replace'
    // (mirror: xóa key user-data hiện có mà backup không có; giữ nguyên secret/runtime).
    function applyImport(bundle, opts) {
      opts = opts || {};
      var mode = opts.mode === 'replace' ? 'replace' : 'merge';
      var incoming = extractStorage(bundle);
      if (!incoming) return Promise.reject(new Error('File sao lưu không hợp lệ (schema không nhận dạng được)'));
      var keys = Object.keys(incoming).filter(function (k) { return !UNSAFE[k]; });
      var ex = excludedKeys({ includeSecrets: !!opts.includeSecrets });
      return snapshot().then(function (current) {
        var patch = {}, removeKeys = [];
        if (mode === 'replace') {
          Object.keys(current).forEach(function (k) {
            if (ex[k] || UNSAFE[k]) return;
            if (!Object.prototype.hasOwnProperty.call(incoming, k)) removeKeys.push(k);
          });
          keys.forEach(function (k) { patch[k] = incoming[k]; });
        } else {
          keys.forEach(function (k) {
            var inc = incoming[k];
            if (Array.isArray(inc)) patch[k] = mergeArrays(current[k], inc);
            else patch[k] = inc;
          });
        }
        var ops = [];
        if (removeKeys.length && typeof area.remove === 'function') ops.push(Promise.resolve(area.remove(removeKeys)));
        if (keys.length) ops.push(Promise.resolve(area.set(patch)));
        return Promise.all(ops).then(function () {
          return { mode: mode, imported: keys.length, removed: removeKeys.length, at: now() };
        });
      });
    }

    return {
      buildExport: buildExport, applyImport: applyImport, snapshot: snapshot,
      SECRET_KEYS: SECRET_KEYS.slice(), RUNTIME_KEYS: RUNTIME_KEYS.slice(),
      _mergeArrays: mergeArrays, _itemId: itemId
    };
  }

  // Adapter: bọc chrome.storage.local (callback) thành area promise-based.
  function browserArea() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
    var L = chrome.storage.local;
    function wrap(fn) {
      return function (arg) {
        return new Promise(function (res, rej) {
          try {
            fn.call(L, arg, function (r) {
              var e = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError);
              if (e) rej(new Error(e.message)); else res(r);
            });
          } catch (err) { rej(err); }
        });
      };
    }
    return {
      get: wrap(L.get), set: wrap(L.set), remove: wrap(L.remove),
      clear: function () {
        return new Promise(function (res, rej) {
          L.clear(function () {
            var e = (chrome.runtime && chrome.runtime.lastError);
            if (e) rej(new Error(e.message)); else res();
          });
        });
      }
    };
  }

  global.SEOSONA_BackupService = {
    SCHEMA: SCHEMA, VERSION: VERSION, create: create,
    _default: null,
    // Instance mặc định gắn chrome.storage.local (dùng trong extension).
    get: function () {
      if (this._default) return this._default;
      var area = browserArea();
      if (!area) return null;
      this._default = create({ area: area, now: function () { return new Date().toISOString(); } });
      return this._default;
    }
  };
})(typeof self !== 'undefined' ? self : this);
