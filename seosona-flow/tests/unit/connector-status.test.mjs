import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../helpers/load-classic.mjs';

function loadStatus() {
  try {
    return loadClassic('src/core/ConnectorStatus.js').SEOSONA_ConnectorStatus || null;
  } catch (_) {
    return null;
  }
}

test('positive: connector is ready only when enabled, installed, authorized and provider-ready', () => {
  const C = loadStatus();
  assert.ok(C, 'ConnectorStatus module is available');

  const status = C.evaluate({
    enabled: true,
    connectorInstalled: true,
    tokenReady: true,
    providerTabOpen: true,
    providerReady: true,
    permissionGranted: true,
  });

  assert.equal(status.state, 'ready');
  assert.equal(status.reason, 'READY');
  assert.equal(status.canRun, true);
});

test('negative: disabled connector reports off and does not request a fix', () => {
  const C = loadStatus();
  assert.ok(C, 'ConnectorStatus module is available');

  const status = C.evaluate({ enabled: false });

  assert.equal(status.state, 'off');
  assert.equal(status.reason, 'DISABLED');
  assert.equal(status.action, null);
});

test('boundary: missing token and closed provider tab produce distinct warning actions', () => {
  const C = loadStatus();
  assert.ok(C, 'ConnectorStatus module is available');

  assert.equal(C.evaluate({ enabled: true, connectorInstalled: true, tokenReady: false }).action, 'open_auth');
  assert.equal(C.evaluate({
    enabled: true,
    connectorInstalled: true,
    tokenReady: true,
    permissionGranted: true,
    providerTabOpen: false,
  }).action, 'open_provider_tab');
});

test('positive: message handler evaluates status for trusted callers', async () => {
  const C = loadStatus();
  assert.ok(C, 'ConnectorStatus module is available');

  const response = await C.handleMessage({
    action: 'connectorStatus:evaluate',
    input: { enabled: true, connectorInstalled: false },
  }, { trusted: true });

  assert.equal(response.ok, true);
  assert.equal(response.status.state, 'warn');
  assert.equal(response.status.reason, 'CONNECTOR_NOT_INSTALLED');
});
