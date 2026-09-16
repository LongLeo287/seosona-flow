import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(join(root, 'scripts/local-mcp-bridge.js'), 'utf8');

function createHarness() {
  let storageValue = {
    enabled: true,
    host: '127.0.0.1',
    port: 8765,
    token: 'old-token-at-least-16-characters',
  };
  let storageListener = null;
  const sockets = [];
  const timers = new Map();
  let timerId = 0;

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.closeCalls = [];
      sockets.push(this);
    }
    close(code, reason) {
      this.closeCalls.push({ code, reason });
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
    send() {}
  }

  const window = {
    RuntimeMode: { isLocal: () => true },
    eventBus: { on() {}, emit() {} },
  };
  const sandbox = {
    window,
    self: window,
    document: { readyState: 'loading', addEventListener() {} },
    chrome: {
      storage: {
        local: {
          get(_keys, callback) { callback({ seosonaLocalMcp: structuredClone(storageValue) }); },
        },
        onChanged: { addListener(listener) { storageListener = listener; } },
      },
    },
    WebSocket: FakeWebSocket,
    crypto: globalThis.crypto,
    TextEncoder,
    performance: { now: () => 1 },
    console: { log() {}, warn() {} },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'local-mcp-bridge.js' });

  return {
    bridge: window.LocalMcpBridge,
    sockets,
    timers,
    setStorage(value) { storageValue = structuredClone(value); },
    emitStorage(changes, area = 'local') {
      assert.equal(typeof storageListener, 'function', 'bridge must subscribe to chrome.storage.onChanged');
      return storageListener(changes, area);
    },
  };
}

test('token rotation invalidates trust and reconnects the bridge exactly once', async () => {
  const h = createHarness();
  await h.bridge.init();
  assert.equal(h.sockets.length, 1);
  h.bridge._serverTrusted = true;

  const next = {
    enabled: true,
    host: '127.0.0.1',
    port: 8765,
    token: 'new-token-at-least-16-characters',
  };
  h.setStorage(next);
  await h.emitStorage({ seosonaLocalMcp: { oldValue: {}, newValue: next } });

  assert.equal(h.sockets[0].closeCalls.length, 1);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.bridge._cfg.token, next.token);
  assert.equal(h.bridge._serverTrusted, false);
  assert.equal(h.timers.size, 0, 'controlled restart must not leave a duplicate reconnect timer');
});

test('unrelated storage changes do not reconnect the bridge', async () => {
  const h = createHarness();
  await h.bridge.init();

  await h.emitStorage({ unrelated: { oldValue: 1, newValue: 2 } });

  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0].closeCalls.length, 0);
});
