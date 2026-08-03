// P5.T6 tests — retry & idempotency (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const R = loadClassic('src/workflow/RetryPolicy.js').SEOSONA_RetryPolicy;

test('positive: pure nodes retry freely up to the cap', () => {
  assert.equal(R.shouldRetry('prompt', 1).retry, true);
  assert.equal(R.shouldRetry('prompt', 2).retry, true);
  assert.equal(R.shouldRetry('prompt', 3).retry, false);
  assert.equal(R.shouldRetry('prompt', 3).reason, 'MAX_ATTEMPTS');
});

test('negative: non-repeatable nodes need confirmation before replay', () => {
  const gen = R.shouldRetry('generate', 1);
  assert.equal(gen.retry, false);
  assert.equal(gen.reason, 'NEEDS_CONFIRMATION');
  assert.equal(R.requiresConfirmation('image'), true);
  assert.equal(R.requiresConfirmation('chatgpt'), true);
});

test('boundary: confirmed non-repeatable node may retry', () => {
  const r = R.shouldRetry('generate', 1, { userConfirmed: true });
  assert.equal(r.retry, true);
});

test('boundary: unknown node type is treated as non-repeatable (conservative)', () => {
  assert.equal(R.effectClass('mystery'), 'non-repeatable');
  assert.equal(R.shouldRetry('mystery', 1).reason, 'NEEDS_CONFIRMATION');
});

test('positive: backoff is bounded and monotonic', () => {
  const d1 = R.backoff(1);
  const d2 = R.backoff(2);
  const d3 = R.backoff(3);
  assert.ok(d1 < d2 && d2 < d3);
  assert.ok(R.backoff(50) <= R.DEFAULTS.maxMs, 'capped at maxMs');
});

test('regression: idempotency key is stable for identical input, distinct otherwise', () => {
  const node = { id: 'n1', data: { prompt: 'a' } };
  assert.equal(R.idempotencyKey(node), R.idempotencyKey(node));
  assert.notEqual(R.idempotencyKey(node, { prompt: 'a' }), R.idempotencyKey(node, { prompt: 'b' }));
  assert.notEqual(R.idempotencyKey({ id: 'n1' }, { x: 1 }), R.idempotencyKey({ id: 'n2' }, { x: 1 }));
});

test('regression: deterministic seeded jitter still respects the cap', () => {
  const a = R.backoff(3, { seed: 7 });
  const b = R.backoff(3, { seed: 7 });
  assert.equal(a, b, 'seeded backoff is deterministic');
  assert.ok(a <= R.DEFAULTS.maxMs);
});
