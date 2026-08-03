// SEOSONA Flow — run event center.
// Durable notification/event primitives for workflow completion, failures and
// generated asset readiness.
(function (global) {
  'use strict';

  var API = {};
  var DEFAULT_MAX_EVENTS = 200;
  var DB_NAME = 'seosonaflow_run_events';
  var DB_VERSION = 1;
  var STORE_NAME = 'events';
  var META_ID = '__meta__';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return 'evt_' + global.crypto.randomUUID();
    return 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function createMemoryStore() {
    var state = { events: [], droppedCount: 0 };
    return {
      async load() { return clone(state); },
      async save(next) { state = clone(next); },
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
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
      async load() {
        var meta = await tx('readonly', function (store) { return store.get(META_ID); });
        return meta || { id: META_ID, events: [], droppedCount: 0 };
      },
      async save(next) {
        var record = clone(next);
        record.id = META_ID;
        await tx('readwrite', function (store) { return store.put(record); });
      },
    };
  }

  async function recordEvent(event, opts) {
    opts = opts || {};
    var store = opts.store || createIndexedDbStore();
    var state = await store.load();
    var now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    var maxEvents = Number(opts.maxEvents);
    if (!Number.isFinite(maxEvents) || maxEvents <= 0) maxEvents = DEFAULT_MAX_EVENTS;
    var item = {
      id: opts.id || makeId(),
      type: event.type || 'event',
      title: event.title || '',
      body: event.body || '',
      data: event.data || null,
      read: false,
      createdAt: now,
    };
    state.events.unshift(item);
    if (state.events.length > maxEvents) {
      state.droppedCount = Number(state.droppedCount || 0) + (state.events.length - maxEvents);
      state.events = state.events.slice(0, maxEvents);
    }
    await store.save(state);
    return { ok: true, event: clone(item), unreadCount: unreadCount(state.events) };
  }

  function unreadCount(events) {
    var n = 0;
    for (var i = 0; i < events.length; i++) if (!events[i].read) n++;
    return n;
  }

  async function markRead(id, opts) {
    opts = opts || {};
    var store = opts.store || createIndexedDbStore();
    var state = await store.load();
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === id) state.events[i].read = true;
    }
    await store.save(state);
    return { ok: true, unreadCount: unreadCount(state.events) };
  }

  async function listEvents(opts) {
    opts = opts || {};
    var store = opts.store || createIndexedDbStore();
    var state = await store.load();
    return {
      ok: true,
      events: clone(state.events || []),
      unreadCount: unreadCount(state.events || []),
      droppedCount: Number(state.droppedCount || 0),
    };
  }

  async function handleMessage(message, opts) {
    opts = opts || {};
    if (opts.trusted === false) return { ok: false, error: 'UNTRUSTED_SENDER' };
    var store = opts.store || createIndexedDbStore();
    if (message.action === 'runEvents:record') return recordEvent(message.event || message, { store: store, now: message.now, id: message.eventId });
    if (message.action === 'runEvents:markRead') return markRead(message.eventId, { store: store });
    if (message.action === 'runEvents:list') return listEvents({ store: store });
    return { ok: false, error: 'UNKNOWN_ACTION' };
  }

  API.createMemoryStore = createMemoryStore;
  API.createIndexedDbStore = createIndexedDbStore;
  API.recordEvent = recordEvent;
  API.markRead = markRead;
  API.listEvents = listEvents;
  API.handleMessage = handleMessage;

  Object.defineProperty(global, 'SEOSONA_RunEventCenter', {
    value: API,
    configurable: true,
    writable: true,
  });
})(typeof self !== 'undefined' ? self : this);
