import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const modulePath = join(root, 'src/core/LocalMcpPairing.js');

function loadPairing() {
  assert.ok(existsSync(modulePath), 'LocalMcpPairing module is missing');
  const sandbox = { window: {} };
  sandbox.self = sandbox.window;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });
  return sandbox.window.SEOSONA_LocalMcpPairing;
}

function memoryStorage() {
  const writes = [];
  return {
    writes,
    async set(value) { writes.push(structuredClone(value)); },
  };
}

test('activating a local MCP token atomically updates the token list and live bridge config', async () => {
  const pairing = loadPairing();
  const storage = memoryStorage();
  const token = 'test-token-at-least-16-characters';
  const list = [{ id: 'local_1', label: 'Content Companion', token }];

  const receipt = await pairing.activate(storage, {
    list,
    token,
    current: { enabled: false, host: '127.0.0.1', port: 8765, token: 'old-token-at-least-16' },
  });

  assert.equal(storage.writes.length, 1);
  assert.deepEqual(storage.writes[0], {
    local_mcp_tokens: list,
    seosonaLocalMcp: { enabled: true, host: '127.0.0.1', port: 8765, token },
  });
  assert.deepEqual(structuredClone(receipt), { enabled: true, host: '127.0.0.1', port: 8765, hasToken: true });
  assert.equal(JSON.stringify(receipt).includes(token), false);
});

test('pairing fails closed for short tokens, non-loopback hosts, and invalid ports', async () => {
  const pairing = loadPairing();
  const valid = 'test-token-at-least-16-characters';

  await assert.rejects(
    pairing.activate(memoryStorage(), { list: [], token: 'too-short', current: {} }),
    /at least 16 characters/i,
  );
  await assert.rejects(
    pairing.activate(memoryStorage(), { list: [], token: valid, current: { host: 'localhost', port: 8765 } }),
    /127\.0\.0\.1/,
  );
  await assert.rejects(
    pairing.activate(memoryStorage(), { list: [], token: valid, current: { host: '127.0.0.1', port: 70000 } }),
    /port/i,
  );
});
