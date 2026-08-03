// SEOSONA Flow — Data Lifecycle Service (Phase 7 / P7.T5, AUD-022).
// Classic script, headless, dependency-injected. Gives the user real control
// over locally stored data: a VERSIONED export, targeted + full deletion with
// RECEIPTS, and a round-trippable import. Runs over an injected chrome.storage-
// like area so it is unit-testable without a browser. All deletes are idempotent
// (restart-safe): re-running never throws and never double-counts.
(function (global) {
  'use strict';

  var EXPORT_SCHEMA = 'seosona.privacy.export.v1';
  var EXPORT_VERSION = 1;

  function create(cfg) {
    cfg = cfg || {};
    var area = cfg.area;
    if (!area || typeof area.get !== 'function') throw new Error('DataLifecycleService requires a storage area');
    var now = typeof cfg.now === 'function' ? cfg.now : function () { return null; };

    function snapshot() { return Promise.resolve(area.get(null)).then(function (all) { return all || {}; }); }

    // Versioned export. If opts.exportPolicy + classify given, secrets are stripped.
    function exportAll(opts) {
      opts = opts || {};
      return snapshot().then(function (all) {
        var entries = all;
        var removed = [];
        if (opts.exportPolicy && opts.classify) {
          var res = opts.exportPolicy.sanitizeExport(all, opts.classify);
          entries = res.bundle; removed = res.removed;
        }
        return { schema: EXPORT_SCHEMA, version: EXPORT_VERSION, exportedAt: now(), keyCount: Object.keys(entries).length, removed: removed, entries: entries };
      });
    }

    function importBundle(bundle) {
      if (!bundle || bundle.schema !== EXPORT_SCHEMA) return Promise.reject(new Error('unrecognized export bundle'));
      var entries = bundle.entries || {};
      var keys = Object.keys(entries).filter(function (k) { return k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; });
      if (keys.length === 0) return Promise.resolve({ imported: 0 });
      var patch = {};
      keys.forEach(function (k) { patch[k] = entries[k]; });
      return Promise.resolve(area.set(patch)).then(function () { return { imported: keys.length }; });
    }

    // Targeted deletion with a receipt distinguishing deleted vs already-absent.
    function deleteKeys(keys) {
      var req = [].concat(keys || []);
      return snapshot().then(function (all) {
        var present = req.filter(function (k) { return Object.prototype.hasOwnProperty.call(all, k); });
        var missing = req.filter(function (k) { return !Object.prototype.hasOwnProperty.call(all, k); });
        var op = present.length ? Promise.resolve(area.remove(present)) : Promise.resolve();
        return op.then(function () { return { requested: req.length, deleted: present, missing: missing, at: now() }; });
      });
    }

    // Full wipe with a count receipt. Idempotent.
    function deleteAll() {
      return snapshot().then(function (all) {
        var keys = Object.keys(all);
        var op = typeof area.clear === 'function' ? Promise.resolve(area.clear()) : Promise.resolve(area.remove(keys));
        return op.then(function () { return { deleted: keys.length, keys: keys, at: now() }; });
      });
    }

    return { exportAll: exportAll, importBundle: importBundle, deleteKeys: deleteKeys, deleteAll: deleteAll, snapshot: snapshot };
  }

  global.SEOSONA_DataLifecycleService = { EXPORT_SCHEMA: EXPORT_SCHEMA, EXPORT_VERSION: EXPORT_VERSION, create: create };
})(typeof self !== 'undefined' ? self : this);
