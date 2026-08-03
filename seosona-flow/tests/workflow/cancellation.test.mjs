// P5.T5 tests — bounded cancellation & cleanup (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const C = loadClassic('src/workflow/ExecutionCancellation.js').SEOSONA_ExecutionCancellation;

test('positive: cancel aborts the signal and runs cleanup', async () => {
  const c = C.create();
  let cleaned = 0;
  c.onCleanup(() => { cleaned++; });
  assert.equal(c.signal.aborted, false);
  await c.cancel('user');
  assert.equal(c.signal.aborted, true);
  assert.equal(c.isCancelled(), true);
  assert.equal(c.reason(), 'user');
  assert.equal(cleaned, 1);
});

test('boundary: cleanup is idempotent across repeated cancels', async () => {
  const c = C.create();
  let cleaned = 0;
  c.onCleanup(() => { cleaned++; });
  await c.cancel('a');
  await c.cancel('b'); // second cancel is a no-op
  await c.runCleanup(); // explicit re-run is a no-op
  assert.equal(cleaned, 1, 'cleanup ran exactly once');
  assert.equal(c.reason(), 'a', 'first reason wins');
});

test('boundary: one throwing cleanup does not block the others', async () => {
  const c = C.create();
  const ran = [];
  c.onCleanup(() => { ran.push(1); throw new Error('boom'); });
  c.onCleanup(() => { ran.push(2); });
  await c.cancel();
  assert.deepEqual([...ran], [1, 2]);
});

test('positive: deadline auto-cancels', async () => {
  const c = C.create({ timeoutMs: 5 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.isCancelled(), true);
  assert.equal(c.reason(), 'DEADLINE');
});

test('negative: throwIfCancelled throws only after cancel', async () => {
  const c = C.create();
  assert.doesNotThrow(() => c.throwIfCancelled());
  await c.cancel();
  assert.throws(() => c.throwIfCancelled(), (e) => e.cancelled === true);
});

test('regression: onCleanup off() unregisters before cancel', async () => {
  const c = C.create();
  let cleaned = 0;
  const off = c.onCleanup(() => { cleaned++; });
  off();
  await c.cancel();
  assert.equal(cleaned, 0);
});
