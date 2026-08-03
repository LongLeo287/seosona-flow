// Loads the real background service worker in an isolated vm context (P2.T5).
// chrome.* is a stateful mock wrapped in an auto-stub Proxy so unmodeled APIs
// never throw; timers use a fake clock so nothing runs until ticked.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { createChromeMock } from './chrome-mock.mjs';
import { createFakeClock } from './fake-clock.mjs';
import { createFetchMock } from './test-runtime.mjs';

/** Wrap a real object graph so missing properties resolve to inert stubs. */
function autoStub(real) {
  const cache = new WeakMap();
  // Result of calling a stubbed API: a resolved-promise thenable that also
  // degrades any other property access back to an inert stub, so both
  // `stub().catch(...)` and `stub().whatever` are safe.
  const resolved = Promise.resolve(undefined);
  const stubResult = new Proxy(resolved, {
    get(_t, p) {
      if (p === 'then' || p === 'catch' || p === 'finally') return resolved[p].bind(resolved);
      if (p === Symbol.toPrimitive) return () => '';
      return stubFn;
    },
  });
  const stubFn = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => '' : stubFn),
    apply: () => stubResult,
    construct: () => ({}),
  });
  const wrap = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (cache.has(obj)) return cache.get(obj);
    const proxy = new Proxy(obj, {
      get(t, prop) {
        if (prop in t) {
          const v = t[prop];
          return typeof v === 'object' && v !== null ? wrap(v) : v;
        }
        return stubFn;
      },
      has: () => true,
    });
    cache.set(obj, proxy);
    return proxy;
  };
  return wrap(real);
}

export function loadServiceWorker({ fetch: fetchOpts } = {}) {
  const root = repoRoot();
  const source = readFileSync(join(root, 'seosona-flow/background.js'), 'utf8');
  const chrome = createChromeMock();
  const clock = createFakeClock();
  const fetchMock = createFetchMock(fetchOpts || {});
  const errors = [];
  const logs = [];
  const logger = (level) => (...a) => logs.push({ level, args: a.map(String) });

  const sandbox = {
    chrome: autoStub(chrome),
    fetch: fetchMock,
    console: { log: logger('log'), warn: logger('warn'), error: logger('error'), info: logger('info'), debug: () => {} },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    queueMicrotask,
    structuredClone,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto: globalThis.crypto,
    Blob: globalThis.Blob,
    FormData: globalThis.FormData,
    Headers: globalThis.Headers,
    AbortController,
    performance: { now: () => clock.now() },
  };
  // Real importScripts: load referenced classic scripts into the same context
  // (mimics MV3 worker importScripts) so wired security modules actually run.
  const imported = [];
  sandbox.importScripts = (...paths) => {
    for (const p of paths) {
      const rel = String(p).replace(/^\//, '');
      const abs = join(root, 'seosona-flow', rel);
      try {
        const code = readFileSync(abs, 'utf8');
        new vm.Script(code, { filename: rel }).runInContext(context);
        imported.push(rel);
      } catch (err) {
        errors.push(err);
      }
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext('globalThis.self = globalThis;', context);

  try {
    new vm.Script(source, { filename: 'background.js' }).runInContext(context);
  } catch (err) {
    errors.push(err);
  }

  return {
    chrome,
    clock,
    fetch: fetchMock,
    errors,
    logs,
    context,
    imported,
    /** Fire a lifecycle event, capturing any handler throw. */
    emit(eventPath, ...args) {
      const parts = eventPath.split('.');
      let node = chrome;
      for (const p of parts) node = node?.[p];
      if (!node || typeof node._emit !== 'function') throw new Error(`no such event: ${eventPath}`);
      try {
        return node._emit(...args);
      } catch (err) {
        errors.push(err);
        return undefined;
      }
    },
  };
}
