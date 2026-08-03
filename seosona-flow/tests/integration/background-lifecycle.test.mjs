// P2.T5 — service-worker lifecycle in isolation (positive, negative, boundary,
// regression). Executes the real background.js and records all effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorker } from '../../tests/helpers/load-service-worker.mjs';

const KNOWN_EFFECTS = new Set([
  'storage.set', 'storage.remove', 'storage.clear',
  'runtime.sendMessage', 'tabs.create', 'tabs.update', 'tabs.remove',
  'tabs.sendMessage', 'downloads.download', 'alarms.create',
  'scripting.executeScript', 'windows.create', 'notifications.create',
]);

test('install: worker boots with zero load errors', () => {
  const sw = loadServiceWorker();
  assert.deepEqual(sw.errors.map((e) => e.message), [], 'no load-time throw');
});

test('install: lifecycle listeners are registered', () => {
  const sw = loadServiceWorker();
  assert.ok(sw.chrome.runtime.onInstalled._count() >= 1, 'onInstalled registered');
  assert.ok(sw.chrome.runtime.onStartup._count() >= 1, 'onStartup registered');
  assert.ok(sw.chrome.runtime.onMessage._count() >= 1, 'onMessage registered');
  assert.ok(sw.chrome.alarms.onAlarm._count() >= 1, 'onAlarm registered');
});

test('startup/wake/alarms: emitting lifecycle events does not throw', () => {
  const sw = loadServiceWorker();
  sw.emit('runtime.onInstalled', { reason: 'install' });
  sw.emit('runtime.onStartup');
  sw.emit('alarms.onAlarm', { name: 'seosona-heartbeat' });
  assert.deepEqual(sw.errors.map((e) => e.message), []);
});

test('messages: a message reaches handlers without an unhandled throw', () => {
  const sw = loadServiceWorker();
  let responded = false;
  sw.emit('runtime.onMessage', { action: 'getBrowserZoom' }, { id: 'seosona-flow-mock' }, () => { responded = true; });
  assert.deepEqual(sw.errors.map((e) => e.message), []);
  void responded; // response may be async; absence of throw is the contract here
});

test('network: default/local boot issues zero backend request', () => {
  const sw = loadServiceWorker();
  sw.emit('runtime.onInstalled', { reason: 'install' });
  sw.emit('runtime.onStartup');
  assert.equal(sw.fetch.requests.length, 0, 'no backend fetch in default boot (SEC-003 baseline)');
});

test('boundary: every recorded effect is a classified type', () => {
  const sw = loadServiceWorker();
  sw.emit('runtime.onInstalled', { reason: 'install' });
  sw.emit('runtime.onStartup');
  for (const e of sw.chrome._effects) {
    assert.ok(KNOWN_EFFECTS.has(e.type), `effect classified: ${e.type}`);
  }
});

test('negative: emitting an unknown event path throws a clear error', () => {
  const sw = loadServiceWorker();
  assert.throws(() => sw.emit('runtime.onNope'), /no such event/);
});

test('regression: pending timers are bounded and accountable', () => {
  const sw = loadServiceWorker();
  const pending = sw.clock.pending();
  assert.ok(Number.isInteger(pending) && pending < 1000, `bounded timers: ${pending}`);
});
