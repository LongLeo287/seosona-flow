// P5.T3 tests — execution state machine (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const SM = loadClassic('src/workflow/ExecutionStateMachine.js').SEOSONA_ExecutionStateMachine;

test('positive: happy path idle -> running -> completed', () => {
  const m = SM.create();
  assert.equal(m.dispatch('START').status, 'running');
  assert.equal(m.dispatch('COMPLETE').status, 'completed');
  assert.equal(m.isTerminal(), true);
});

test('positive: pause/resume and cancel paths', () => {
  const m = SM.create();
  m.dispatch('START');
  assert.equal(m.dispatch('PAUSE').status, 'paused');
  assert.equal(m.dispatch('RESUME').status, 'running');
  assert.equal(m.dispatch('CANCEL').status, 'cancelled');
});

test('positive: failed is retryable back to running', () => {
  const m = SM.create();
  m.dispatch('START');
  assert.equal(m.dispatch('FAIL').status, 'failed');
  const r = m.dispatch('RETRY');
  assert.equal(r.applied, true);
  assert.equal(r.status, 'running');
});

test('negative: illegal transition is rejected without mutation', () => {
  const m = SM.create();
  const r = m.dispatch('COMPLETE'); // cannot complete from idle
  assert.equal(r.applied, false);
  assert.equal(r.reason, 'ILLEGAL_TRANSITION');
  assert.equal(m.status(), 'idle');
});

test('boundary: hard-terminal states never regress', () => {
  for (const term of ['COMPLETE', 'CANCEL', 'SKIP']) {
    const m = SM.create();
    if (term !== 'SKIP') m.dispatch('START');
    m.dispatch(term === 'COMPLETE' ? 'COMPLETE' : term);
    const before = m.status();
    for (const ev of ['START', 'RESUME', 'RETRY', 'COMPLETE']) {
      const r = m.dispatch(ev);
      assert.equal(r.applied, false, `${before} must not accept ${ev}`);
      assert.equal(m.status(), before);
    }
  }
});

test('regression: history is append-only and records rejected events', () => {
  const m = SM.create();
  m.dispatch('COMPLETE'); // rejected
  m.dispatch('START');    // applied
  const h = m.history();
  assert.equal(h.length, 2);
  assert.equal(h[0].applied, false);
  assert.equal(h[1].applied, true);
  assert.equal(h[0].seq, 1);
  assert.equal(h[1].seq, 2);
});

test('regression: reduce is pure (no shared state)', () => {
  const a = SM.reduce('running', 'COMPLETE');
  assert.equal(a.status, 'completed');
  assert.equal(a.changed, true);
  assert.equal(a.reason, null);
  const b = SM.reduce('completed', 'START');
  assert.equal(b.status, 'completed');
  assert.equal(b.changed, false);
  assert.equal(b.reason, 'TERMINAL');
});
