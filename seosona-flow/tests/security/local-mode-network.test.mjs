// P3.T4 tests — local-mode network gate (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { loadServiceWorker } from '../../tests/helpers/load-service-worker.mjs';

const gate = loadClassic('src/core/RuntimeNetworkGate.js').SEOSONA_RuntimeNetworkGate;

test('positive: provider traffic is allowed even in local mode', () => {
  for (const u of ['https://labs.google/fx/', 'https://chatgpt.com/backend-api', 'https://gemini.google.com/app', 'https://claude.ai/']) {
    assert.equal(gate.classifyTraffic(u), 'provider', u);
    assert.equal(gate.guard(u, { localMode: true, userInitiated: false }).allowed, true);
  }
});

test('negative: backend traffic is blocked in local mode', () => {
  for (const u of ['http://localhost:8080/api/v1/config', 'https://api.seosona.vn/enroll', 'https://x.seosona.vn/.well-known/mercure']) {
    assert.equal(gate.classifyTraffic(u), 'backend', u);
    const d = gate.guard(u, { localMode: true, userInitiated: false });
    assert.equal(d.allowed, false, `${u} blocked in local mode`);
    assert.equal(d.reason, 'LOCAL_MODE_BACKEND_BLOCKED');
  }
});

test('boundary: user-initiated backend call is allowed (opt-in)', () => {
  const d = gate.guard('http://localhost:8080/api/v1/login', { localMode: true, userInitiated: true });
  assert.equal(d.allowed, true);
});

test('boundary: online mode allows backend', () => {
  const d = gate.guard('https://api.seosona.vn/config', { localMode: false });
  assert.equal(d.allowed, true);
});

test('regression: default boot in local mode issues zero backend request (behavior)', () => {
  // Complements the gate: the real worker already boots without backend network.
  const sw = loadServiceWorker();
  sw.emit('runtime.onInstalled', { reason: 'install' });
  sw.emit('runtime.onStartup');
  assert.equal(sw.fetch.requests.length, 0);
  assert.ok(sw.imported.includes('src/core/RuntimeNetworkGate.js'), 'gate imported into worker');
});
