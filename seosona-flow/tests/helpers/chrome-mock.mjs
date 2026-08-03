// Deterministic, stateful chrome.* mock for MV3 unit/integration tests (P2.T3).
// Records effects for assertions and supports promise + callback call styles.

function createEvent() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    hasListeners: () => listeners.size > 0,
    _count: () => listeners.size,
    _emit: (...args) => {
      const results = [];
      for (const fn of listeners) results.push(fn(...args));
      return results;
    },
    _clear: () => listeners.clear(),
  };
}

function resolveGet(data, keys) {
  if (keys == null) return { ...data };
  if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {};
  if (Array.isArray(keys)) {
    const out = {};
    for (const k of keys) if (k in data) out[k] = data[k];
    return out;
  }
  // object of defaults
  const out = {};
  for (const [k, def] of Object.entries(keys)) out[k] = k in data ? data[k] : def;
  return out;
}

function settle(cb, value) {
  if (typeof cb === 'function') {
    cb(value);
    return undefined;
  }
  return Promise.resolve(value);
}

function createStorageArea(effects, areaName, globalOnChanged) {
  let data = {};
  const onChanged = createEvent();
  const emitBoth = (changes) => {
    onChanged._emit(changes, areaName);
    if (globalOnChanged) globalOnChanged._emit(changes, areaName);
  };
  return {
    onChanged,
    get(keys, cb) {
      return settle(cb, resolveGet(data, keys));
    },
    set(items, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      effects.push({ type: 'storage.set', area: areaName, keys: Object.keys(items) });
      emitBoth(changes);
      return settle(cb, undefined);
    },
    remove(keys, cb) {
      const arr = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const k of arr) {
        if (k in data) {
          changes[k] = { oldValue: data[k], newValue: undefined };
          delete data[k];
        }
      }
      effects.push({ type: 'storage.remove', area: areaName, keys: arr });
      if (Object.keys(changes).length) emitBoth(changes);
      return settle(cb, undefined);
    },
    clear(cb) {
      data = {};
      effects.push({ type: 'storage.clear', area: areaName });
      return settle(cb, undefined);
    },
    _dump: () => ({ ...data }),
    _reset: () => { data = {}; },
  };
}

export function createChromeMock() {
  const effects = [];
  let idSeq = 0;
  const nextId = () => ++idSeq;

  const runtimeOnMessage = createEvent();
  const runtimeOnMessageExternal = createEvent();

  const chrome = {
    _effects: effects,
    runtime: {
      id: 'seosona-flow-mock',
      lastError: undefined,
      getURL: (p) => `chrome-extension://seosona-flow-mock/${String(p).replace(/^\//, '')}`,
      getManifest: () => ({ version: '0.0.0-test', manifest_version: 3 }),
      onInstalled: createEvent(),
      onStartup: createEvent(),
      onMessage: runtimeOnMessage,
      onMessageExternal: runtimeOnMessageExternal,
      onConnect: createEvent(),
      sendMessage(message, cb) {
        effects.push({ type: 'runtime.sendMessage', message });
        let response;
        let async = false;
        const sendResponse = (r) => { response = r; };
        for (const results of [runtimeOnMessage._emit(message, { id: chrome.runtime.id }, sendResponse)]) {
          if (results.some((r) => r === true)) async = true;
        }
        void async;
        return settle(cb, response);
      },
    },
    storage: (() => {
      const onChanged = createEvent();
      return {
        local: createStorageArea(effects, 'local', onChanged),
        session: createStorageArea(effects, 'session', onChanged),
        sync: createStorageArea(effects, 'sync', onChanged),
        onChanged,
      };
    })(),
    tabs: {
      _tabs: new Map(),
      onCreated: createEvent(),
      onUpdated: createEvent(),
      onActivated: createEvent(),
      onRemoved: createEvent(),
      query(info, cb) {
        const all = [...chrome.tabs._tabs.values()];
        const match = all.filter((t) => (info.url ? matchUrl(info.url, t.url) : true) && (info.active == null || t.active === info.active));
        return settle(cb, match);
      },
      create(props, cb) {
        const tab = { id: nextId(), active: true, status: 'complete', ...props };
        chrome.tabs._tabs.set(tab.id, tab);
        effects.push({ type: 'tabs.create', url: props.url });
        chrome.tabs.onCreated._emit(tab);
        return settle(cb, tab);
      },
      update(tabId, props, cb) {
        const tab = { ...(chrome.tabs._tabs.get(tabId) || { id: tabId }), ...props };
        chrome.tabs._tabs.set(tabId, tab);
        effects.push({ type: 'tabs.update', tabId, props });
        return settle(cb, tab);
      },
      remove(tabId, cb) {
        chrome.tabs._tabs.delete(tabId);
        effects.push({ type: 'tabs.remove', tabId });
        chrome.tabs.onRemoved._emit(tabId, { windowId: 1, isWindowClosing: false });
        return settle(cb, undefined);
      },
      sendMessage(tabId, message, cb) {
        effects.push({ type: 'tabs.sendMessage', tabId, message });
        return settle(cb, undefined);
      },
    },
    downloads: {
      onChanged: createEvent(),
      download(options, cb) {
        const id = nextId();
        effects.push({ type: 'downloads.download', url: options.url, filename: options.filename });
        return settle(cb, id);
      },
    },
    alarms: {
      _alarms: new Map(),
      onAlarm: createEvent(),
      create(name, info) {
        chrome.alarms._alarms.set(name, { name, ...info });
        effects.push({ type: 'alarms.create', name });
      },
      clear(name, cb) {
        const existed = chrome.alarms._alarms.delete(name);
        return settle(cb, existed);
      },
      getAll(cb) {
        return settle(cb, [...chrome.alarms._alarms.values()]);
      },
    },
    scripting: {
      executeScript(injection, cb) {
        effects.push({ type: 'scripting.executeScript', target: injection.target });
        return settle(cb, []);
      },
    },
    windows: {
      onFocusChanged: createEvent(),
      create(props, cb) {
        const win = { id: nextId(), ...props };
        effects.push({ type: 'windows.create' });
        return settle(cb, win);
      },
      update(id, props, cb) { return settle(cb, { id, ...props }); },
    },
    action: {
      onClicked: createEvent(),
      setBadgeText() {},
      setBadgeBackgroundColor() {},
    },
    notifications: {
      onClicked: createEvent(),
      create(id, opts, cb) {
        effects.push({ type: 'notifications.create' });
        return settle(cb, typeof id === 'string' ? id : `notif-${nextId()}`);
      },
    },
    contextMenus: {
      onClicked: createEvent(),
      create() {},
      removeAll(cb) { return settle(cb, undefined); },
    },
    sidePanel: {
      setPanelBehavior() { return Promise.resolve(); },
      open() { return Promise.resolve(); },
    },
  };

  /** Count of live event listeners across the mock — for leak assertions. */
  chrome._listenerCount = () => {
    let n = 0;
    const walk = (obj, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 4) return;
      for (const v of Object.values(obj)) {
        if (v && typeof v._count === 'function') n += v._count();
        else if (v && typeof v === 'object' && v !== obj) walk(v, depth + 1);
      }
    };
    walk(chrome);
    return n;
  };

  return chrome;
}

function matchUrl(pattern, url) {
  if (!url) return false;
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(url);
}
