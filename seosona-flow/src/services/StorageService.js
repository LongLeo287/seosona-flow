// SEOSONA Flow — Storage Service (Phase 4 / P4.T5, AUD-012).
// Headless, dependency-injected storage facade. Takes a chrome.storage-like
// area and exposes a clean async API with NO DOM dependency, so core logic is
// unit-testable without a browser. Existing DOM callers can migrate onto it.
(function (global) {
  'use strict';

  function create(area) {
    if (!area || typeof area.get !== 'function') throw new Error('StorageService requires a storage area');

    function get(key, fallback) {
      return Promise.resolve(area.get(key)).then(function (res) {
        var v = res ? res[key] : undefined;
        return v === undefined ? fallback : v;
      });
    }
    function set(key, value) {
      var patch = {};
      patch[key] = value;
      return Promise.resolve(area.set(patch)).then(function () { return value; });
    }
    function remove(key) { return Promise.resolve(area.remove(key)); }
    function getMany(keys) { return Promise.resolve(area.get(keys)); }
    function update(key, fn, fallback) {
      return get(key, fallback).then(function (cur) { return set(key, fn(cur)); });
    }

    return { get: get, set: set, remove: remove, getMany: getMany, update: update };
  }

  global.SEOSONA_StorageService = { create: create };
})(typeof self !== 'undefined' ? self : this);
