// SEOSONA Flow — workflow results store.
// Stores run output rows as reviewable datasets with typed columns and export.
(function (global) {
  'use strict';

  var API = {};
  var DB_NAME = 'seosonaflow_workflow_results';
  var DB_VERSION = 1;
  var STORE_NAME = 'runs';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeId(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return prefix + '_' + global.crypto.randomUUID();
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function createMemoryStore() {
    var runs = new Map();
    return {
      async put(run) {
        runs.set(run.id, clone(run));
      },
      async get(id) {
        return runs.has(id) ? clone(runs.get(id)) : null;
      },
      async list() {
        return Array.from(runs.values()).map(clone);
      },
      async delete(id) {
        return runs.delete(id);
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
            store.createIndex('workflowId', 'workflowId', { unique: false });
            store.createIndex('createdAt', 'createdAt', { unique: false });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
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
      put: function (run) { return tx('readwrite', function (store) { return store.put(run); }); },
      get: function (id) { return tx('readonly', function (store) { return store.get(id); }); },
      list: function () { return tx('readonly', function (store) { return store.getAll(); }).then(function (x) { return x || []; }); },
      delete: function (id) { return tx('readwrite', function (store) { return store.delete(id); }); },
    };
  }

  function inferType(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return 'number';
    if (typeof value === 'boolean') return 'boolean';
    var s = String(value == null ? '' : value);
    if (/^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(s)) return 'image';
    if (/^https?:\/\//i.test(s)) return 'url';
    return 'text';
  }

  function mergeColumns(existing, rows) {
    var columns = existing ? clone(existing) : [];
    var byField = {};
    for (var i = 0; i < columns.length; i++) byField[columns[i].field] = columns[i];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || {};
      var fields = Object.keys(row);
      for (var f = 0; f < fields.length; f++) {
        var field = fields[f];
        if (byField[field]) continue;
        var col = { field: field, label: field, type: inferType(row[field]) };
        byField[field] = col;
        columns.push(col);
      }
    }
    return columns;
  }

  async function createRun(meta, opts) {
    opts = opts || {};
    meta = meta || {};
    var store = opts.store || createIndexedDbStore();
    var now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    var run = {
      id: opts.id || makeId('run'),
      workflowId: meta.workflowId || null,
      workflowName: meta.workflowName || '',
      status: meta.status || 'running',
      createdAt: now,
      updatedAt: now,
      columns: [],
      rows: [],
      assets: [],
    };
    await store.put(run);
    return { ok: true, run: clone(run) };
  }

  async function appendRows(runId, rows, opts) {
    opts = opts || {};
    var store = opts.store || createIndexedDbStore();
    var run = await store.get(runId);
    if (!run) return { ok: false, error: 'RUN_NOT_FOUND' };
    var list = Array.isArray(rows) ? rows.map(function (row) { return Object.assign({}, row); }) : [];
    run.columns = mergeColumns(run.columns, list);
    for (var i = 0; i < list.length; i++) run.rows.push(list[i]);
    run.updatedAt = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    await store.put(run);
    return { ok: true, run: clone(run) };
  }

  // Cập nhật trạng thái run khi workflow kết thúc (createRun chỉ set lúc bắt đầu = 'running').
  // Additive: không đổi hành vi các API sẵn có.
  async function setStatus(runId, status, opts) {
    opts = opts || {};
    var store = opts.store || createIndexedDbStore();
    var run = await store.get(runId);
    if (!run) return { ok: false, error: 'RUN_NOT_FOUND' };
    run.status = String(status || 'unknown');
    run.updatedAt = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    await store.put(run);
    return { ok: true, run: clone(run) };
  }

  // Liệt kê run gần nhất (chỉ metadata + số dòng — KHÔNG kéo toàn bộ rows cho nhẹ).
  async function listRuns(opts) {
    opts = opts || {};
    var store = opts.store || createIndexedDbStore();
    var all = await store.list();
    var limit = Number(opts.limit) > 0 ? Number(opts.limit) : 50;
    var runs = (all || [])
      .map(function (r) {
        return {
          id: r.id, workflowId: r.workflowId, workflowName: r.workflowName,
          status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
          rowCount: (r.rows || []).length,
        };
      })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })
      .slice(0, limit);
    return { ok: true, runs: runs };
  }

  async function getRun(runId, opts) {
    opts = opts || {};
    var store = opts.store || createIndexedDbStore();
    var run = await store.get(runId);
    return run ? { ok: true, run: run } : { ok: false, error: 'RUN_NOT_FOUND' };
  }

  function csvCell(value) {
    var s = String(value == null ? '' : value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  async function exportCsv(runId, opts) {
    var loaded = await getRun(runId, opts);
    if (!loaded.ok) return loaded;
    var run = loaded.run;
    var fields = run.columns.map(function (c) { return c.field; });
    var lines = [fields.map(csvCell).join(',')];
    for (var i = 0; i < run.rows.length; i++) {
      var row = run.rows[i];
      lines.push(fields.map(function (field) { return csvCell(row[field]); }).join(','));
    }
    return { ok: true, csv: lines.join('\n'), rowCount: run.rows.length, columns: run.columns };
  }

  async function handleMessage(message, opts) {
    opts = opts || {};
    if (opts.trusted === false) return { ok: false, error: 'UNTRUSTED_SENDER' };
    var store = opts.store || createIndexedDbStore();
    if (message.action === 'workflowResults:createRun') {
      return createRun(message.meta || message, { store: store, id: message.runId, now: message.now });
    }
    if (message.action === 'workflowResults:appendRows') {
      return appendRows(message.runId, message.rows || [], { store: store, now: message.now });
    }
    if (message.action === 'workflowResults:setStatus') {
      return setStatus(message.runId, message.status, { store: store, now: message.now });
    }
    if (message.action === 'workflowResults:listRuns') {
      return listRuns({ store: store, limit: message.limit });
    }
    if (message.action === 'workflowResults:getRun') {
      return getRun(message.runId, { store: store });
    }
    if (message.action === 'workflowResults:exportCsv') {
      return exportCsv(message.runId, { store: store });
    }
    return { ok: false, error: 'UNKNOWN_ACTION' };
  }

  API.createMemoryStore = createMemoryStore;
  API.createIndexedDbStore = createIndexedDbStore;
  API.createRun = createRun;
  API.appendRows = appendRows;
  API.setStatus = setStatus;
  API.listRuns = listRuns;
  API.getRun = getRun;
  API.exportCsv = exportCsv;
  API.handleMessage = handleMessage;
  API.inferType = inferType;

  Object.defineProperty(global, 'SEOSONA_WorkflowResultsStore', {
    value: API,
    configurable: true,
    writable: true,
  });
})(typeof self !== 'undefined' ? self : this);
