// P4.T2 tests — lifecycle coordinator ordering (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { loadServiceWorker } from '../../tests/helpers/load-service-worker.mjs';

function fresh() {
  const c = loadClassic('src/background/LifecycleCoordinator.js').SEOSONA_LifecycleCoordinator;
  c.reset();
  return c;
}

test('positive: handlers run in ascending order', async () => {
  const c = fresh();
  const seen = [];
  c.on('startup', () => seen.push('b'), 20);
  c.on('startup', () => seen.push('a'), 10);
  c.on('startup', () => seen.push('c'), 30);
  await c.run('startup');
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('positive: async handlers are awaited sequentially', async () => {
  const c = fresh();
  const seen = [];
  c.on('install', async () => { await Promise.resolve(); seen.push('first'); }, 1);
  c.on('install', () => seen.push('second'), 2);
  await c.run('install');
  assert.deepEqual(seen, ['first', 'second']);
});

test('boundary: one failing handler does not abort the phase', async () => {
  const c = fresh();
  const seen = [];
  c.on('wake', () => { throw new Error('boom'); }, 1);
  c.on('wake', () => seen.push('survivor'), 2);
  const result = await c.run('wake');
  assert.deepEqual([...result], ['error', 'ok']); // spread across vm realm boundary

  assert.deepEqual(seen, ['survivor']);
});

test('negative: unknown phase and non-function handler are rejected', () => {
  const c = fresh();
  assert.throws(() => c.on('nope', () => {}), /unknown lifecycle phase/);
  assert.throws(() => c.on('startup', 123), /must be a function/);
});

test('boundary: off() unregisters a handler', async () => {
  const c = fresh();
  const seen = [];
  const off = c.on('focus', () => seen.push('x'));
  off();
  await c.run('focus');
  assert.deepEqual(seen, []);
});

test('regression: worker still boots with the coordinator imported', () => {
  const sw = loadServiceWorker();
  assert.deepEqual(sw.errors.map((e) => e.message), []);
  assert.ok(sw.imported.includes('src/background/LifecycleCoordinator.js'));
  assert.ok(sw.context.SEOSONA_LifecycleCoordinator, 'coordinator attached');
});
