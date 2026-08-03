// P8.T7 tests — render scheduler (canvas batching).
// positive/negative/boundary/regression across: load, pan, zoom, select,
// connect, status, serialization (dedupe), scale, and memory (cleanup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const RS = loadClassic('src/ui/RenderScheduler.js').SEOSONA_RenderScheduler;

// Manual frame driver: schedule() stores the callback; drive() runs it.
function makeDriver() {
  let queued = null;
  return {
    schedule: (fn) => { queued = fn; return 1; },
    cancel: () => { queued = null; },
    drive: () => { const fn = queued; queued = null; if (fn) fn(); },
    pending: () => queued != null,
  };
}

test('positive: many keys flush once per frame', () => {
  const d = makeDriver();
  const s = RS.create({ schedule: d.schedule, cancel: d.cancel });
  const ran = [];
  s.enqueue('pan', () => ran.push('pan'));
  s.enqueue('zoom', () => ran.push('zoom'));
  assert.equal(s.pendingCount(), 2);
  d.drive();
  assert.deepEqual(ran.sort(), ['pan', 'zoom']);
  assert.equal(s.stats().frames, 1, 'single batched frame');
});

test('dedupe: re-enqueuing a key coalesces to the latest task', () => {
  const d = makeDriver();
  const s = RS.create({ schedule: d.schedule, cancel: d.cancel });
  let value = null;
  s.enqueue('pan', () => { value = 'old'; });
  s.enqueue('pan', () => { value = 'new'; });
  assert.equal(s.pendingCount(), 1, 'coalesced to one');
  d.drive();
  assert.equal(value, 'new');
  assert.equal(s.stats().coalesced, 1);
});

test('negative: cancelKey drops stale work before it flushes', () => {
  const d = makeDriver();
  const s = RS.create({ schedule: d.schedule, cancel: d.cancel });
  let ran = false;
  s.enqueue('status', () => { ran = true; });
  assert.equal(s.cancelKey('status'), true);
  d.drive();
  assert.equal(ran, false);
});

test('boundary: one task throwing does not drop the rest of the batch', () => {
  const d = makeDriver();
  const s = RS.create({ schedule: d.schedule, cancel: d.cancel });
  const ran = [];
  s.enqueue('a', () => { throw new Error('boom'); });
  s.enqueue('b', () => ran.push('b'));
  d.drive();
  assert.deepEqual(ran, ['b']);
});

test('memory: clear() empties pending and cancels the frame', () => {
  const d = makeDriver();
  const s = RS.create({ schedule: d.schedule, cancel: d.cancel });
  s.enqueue('x', () => {});
  s.clear();
  assert.equal(s.pendingCount(), 0);
  assert.equal(d.pending(), false);
});

test('regression: scale — 500 coalescing writes to one key flush once', () => {
  const d = makeDriver();
  const s = RS.create({ schedule: d.schedule, cancel: d.cancel });
  let last = -1;
  for (let i = 0; i < 500; i++) s.enqueue('pan', () => { last = i; });
  assert.equal(s.pendingCount(), 1);
  d.drive();
  assert.equal(last, 499);
  assert.equal(s.stats().flushed, 1);
});
