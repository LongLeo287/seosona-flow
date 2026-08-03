// SEOSONA Flow — source import staging.
// Classic script. Stores transient web-captured assets behind SEOSONA-owned
// staging refs so workflow/template inputs do not depend on live page state.
(function (global) {
  'use strict';

  var API = {};
  var PREFIX = 'seosona-staging://';
  var DEFAULT_TTL_MS = 60 * 60 * 1000;
  var DEFAULT_INLINE_LIMIT_CHARS = 6 * 1000 * 1000;
  var DB_NAME = 'seosonaflow_source_imports';
  var DB_VERSION = 1;
  var STORE_NAME = 'source_imports';

  function cleanBase64(value) {
    var s = String(value || '').trim();
    var comma = s.indexOf(',');
    if (/^data:/i.test(s) && comma !== -1) return s.slice(comma + 1);
    return s;
  }

  function bytesFromBase64(base64, limit) {
    var raw = cleanBase64(base64);
    var bin = global.atob(raw);
    var n = Math.min(bin.length, limit || bin.length);
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function normalizeMime(mime) {
    return String(mime || '').split(';')[0].trim().toLowerCase();
  }

  function sniffImageMime(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 6 &&
      bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
      return 'image/gif';
    }
    if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp';
    }
    return null;
  }

  function validateImageInput(input) {
    if (!input || typeof input !== 'object') return { ok: false, error: 'NOT_AN_OBJECT' };
    var base64 = cleanBase64(input.base64);
    if (!base64) return { ok: false, error: 'NO_IMAGE_BASE64' };
    var mimeType = normalizeMime(input.mimeType || input.type);
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(mimeType)) return { ok: false, error: 'UNSUPPORTED_IMAGE_TYPE' };
    var signature = null;
    try { signature = sniffImageMime(bytesFromBase64(base64, 16)); }
    catch (_) { return { ok: false, error: 'INVALID_IMAGE_BASE64' }; }
    if (!signature) return { ok: false, error: 'INVALID_IMAGE_SIGNATURE' };
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
    if (signature !== mimeType) return { ok: false, error: 'IMAGE_TYPE_MISMATCH', signature: signature, mimeType: mimeType };
    return { ok: true, base64: base64, mimeType: mimeType };
  }

  function makeImportId(opts) {
    if (opts && opts.id) return String(opts.id);
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'import_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function makeStagingRef(id) {
    return PREFIX + encodeURIComponent(String(id));
  }

  function parseStagingRef(ref) {
    var s = String(ref || '');
    if (s.indexOf(PREFIX) !== 0) return { ok: false, error: 'INVALID_STAGING_REF' };
    var id = decodeURIComponent(s.slice(PREFIX.length));
    if (!id) return { ok: false, error: 'INVALID_STAGING_REF' };
    return { ok: true, id: id };
  }

  function createMemoryStore() {
    var map = new Map();
    return {
      async put(record) {
        map.set(record.id, Object.assign({}, record));
      },
      async get(id) {
        return map.has(id) ? Object.assign({}, map.get(id)) : null;
      },
      async delete(id) {
        return map.delete(id);
      },
      async list() {
        return Array.from(map.values()).map(function (x) { return Object.assign({}, x); });
      },
    };
  }

  function createIndexedDbStore() {
    var dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        var req = global.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (event) {
          var db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            var store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('createdAt', 'createdAt', { unique: false });
            store.createIndex('expiresAt', 'expiresAt', { unique: false });
          }
        };
        req.onsuccess = function (event) { resolve(event.target.result); };
        req.onerror = function () { reject(req.error); };
      });
      return dbPromise;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE_NAME, mode);
          var store = t.objectStore(STORE_NAME);
          var value;
          try { value = fn(store); } catch (err) { reject(err); return; }
          t.oncomplete = function () { resolve(value && value._result); };
          t.onerror = function () { reject(t.error); };
          if (value instanceof IDBRequest) {
            value.onsuccess = function () { value._result = value.result; };
            value.onerror = function () { reject(value.error); };
          }
        });
      });
    }
    return {
      put: function (record) {
        return tx('readwrite', function (store) { return store.put(record); });
      },
      get: function (id) {
        return tx('readonly', function (store) { return store.get(id); });
      },
      delete: function (id) {
        return tx('readwrite', function (store) { return store.delete(id); });
      },
      list: function () {
        return tx('readonly', function (store) { return store.getAll(); }).then(function (items) { return items || []; });
      },
    };
  }

  async function createImagePackage(input, opts) {
    opts = opts || {};
    var valid = validateImageInput(input);
    if (!valid.ok) return valid;
    var now = Number(opts.now);
    if (!Number.isFinite(now)) now = Date.now();
    var ttlMs = Number(opts.ttlMs);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) ttlMs = DEFAULT_TTL_MS;
    var inlineLimitChars = Number(opts.inlineLimitChars);
    if (!Number.isFinite(inlineLimitChars) || inlineLimitChars < 0) inlineLimitChars = DEFAULT_INLINE_LIMIT_CHARS;
    var id = makeImportId(opts);
    var name = String(input.name || 'source-image').slice(0, 240);
    var createdAt = now;
    var expiresAt = now + ttlMs;
    var basePackage = {
      importId: id,
      sourceType: 'image',
      name: name,
      mimeType: valid.mimeType,
      sourceUrl: input.sourceUrl || null,
      pageUrl: input.pageUrl || null,
      tabId: input.tabId == null ? null : input.tabId,
      windowId: input.windowId == null ? null : input.windowId,
      createdAt: createdAt,
      expiresAt: expiresAt,
      embeddedImage: null,
      stagingRef: null,
    };
    if (valid.base64.length <= inlineLimitChars) {
      basePackage.embeddedImage = { base64: valid.base64, mimeType: valid.mimeType, name: name };
      return { ok: true, package: basePackage };
    }
    var store = opts.store || createIndexedDbStore();
    await store.put({
      id: id,
      sourceType: 'image',
      base64: valid.base64,
      mimeType: valid.mimeType,
      name: name,
      sourceUrl: basePackage.sourceUrl,
      pageUrl: basePackage.pageUrl,
      tabId: basePackage.tabId,
      windowId: basePackage.windowId,
      createdAt: createdAt,
      expiresAt: expiresAt,
    });
    basePackage.stagingRef = makeStagingRef(id);
    return { ok: true, package: basePackage };
  }

  async function cleanupExpired(store, now) {
    now = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    var records = await store.list();
    var removed = 0;
    for (var i = 0; i < records.length; i++) {
      if (Number(records[i].expiresAt) <= now) {
        await store.delete(records[i].id);
        removed++;
      }
    }
    return removed;
  }

  async function handleMessage(message, opts) {
    opts = opts || {};
    if (opts.trusted === false) return { ok: false, error: 'UNTRUSTED_SENDER' };
    var action = message && message.action;
    var store = opts.store || createIndexedDbStore();
    if (action === 'sourceImport:createImage') {
      var img = message.image || message;
      var result = await createImagePackage({
        base64: img.base64,
        mimeType: img.mimeType || img.type,
        name: img.name,
        sourceUrl: img.sourceUrl || message.sourceUrl,
        pageUrl: img.pageUrl || message.pageUrl,
        tabId: img.tabId == null ? message.tabId : img.tabId,
        windowId: img.windowId == null ? message.windowId : img.windowId,
      }, {
        id: opts.id || message.importId,
        now: opts.now,
        ttlMs: opts.ttlMs || message.ttlMs,
        inlineLimitChars: opts.inlineLimitChars || message.inlineLimitChars,
        store: store,
      });
      return result;
    }
    if (action === 'sourceImport:get') {
      var parsed = parseStagingRef(message.stagingRef || message.ref);
      if (!parsed.ok) return parsed;
      var record = await store.get(parsed.id);
      return record ? { ok: true, record: record } : { ok: false, error: 'NOT_FOUND' };
    }
    if (action === 'sourceImport:cleanupExpired') {
      var removed = await cleanupExpired(store, opts.now || message.now);
      return { ok: true, removed: removed };
    }
    return { ok: false, error: 'UNKNOWN_ACTION' };
  }

  API.PREFIX = PREFIX;
  API.DEFAULT_TTL_MS = DEFAULT_TTL_MS;
  API.DEFAULT_INLINE_LIMIT_CHARS = DEFAULT_INLINE_LIMIT_CHARS;
  API.createImagePackage = createImagePackage;
  API.createMemoryStore = createMemoryStore;
  API.createIndexedDbStore = createIndexedDbStore;
  API.cleanupExpired = cleanupExpired;
  API.handleMessage = handleMessage;
  API.makeStagingRef = makeStagingRef;
  API.parseStagingRef = parseStagingRef;
  API.validateImageInput = validateImageInput;
  API.sniffImageMime = sniffImageMime;

  Object.defineProperty(global, 'SEOSONA_SourceImportStaging', {
    value: API,
    configurable: true,
    writable: true,
  });
})(typeof self !== 'undefined' ? self : this);
