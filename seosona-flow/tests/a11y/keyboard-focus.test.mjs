// P8.T3 tests — focus manager (deterministic keyboard focus).
// positive/negative/boundary/regression across: tab order, traps, return,
// Escape, canvas (programmatic-only), hidden elements, and nested dialogs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const FM = loadClassic('src/ui/FocusManager.js').SEOSONA_FocusManager;

const f = (id, over = {}) => Object.assign({ id, visible: true, disabled: false }, over);

test('positive: positive tabindex comes before natural order, stably', () => {
  const seq = FM.order([f('a'), f('b', { tabindex: 2 }), f('c', { tabindex: 1 }), f('d')]);
  assert.deepEqual([...seq.map((x) => x.id)], ['c', 'b', 'a', 'd']);
});

test('negative: hidden/disabled/tabindex=-1 are excluded from tab order', () => {
  const seq = FM.order([f('a'), f('h', { visible: false }), f('d', { disabled: true }), f('canvas', { tabindex: -1 }), f('z')]);
  assert.deepEqual([...seq.map((x) => x.id)], ['a', 'z']);
});

test('boundary: step wraps forward and backward within the trap', () => {
  const items = [f('a'), f('b'), f('c')];
  assert.equal(FM.step(items, 'c', 1).id, 'a', 'wrap to first');
  assert.equal(FM.step(items, 'a', -1).id, 'c', 'wrap to last');
});

test('trap: Tab cycles and Escape returns focus to the opener', () => {
  const trap = FM.createTrap([f('ok'), f('cancel')], { previousFocusId: 'opener' });
  assert.equal(trap.firstFocusId, 'ok');
  assert.equal(trap.onTab(false), 'cancel');
  assert.equal(trap.onTab(false), 'ok', 'wraps inside trap');
  const closed = trap.onEscape();
  assert.equal(closed.restoreFocusId, 'opener');
  assert.equal(trap.isActive(), false);
});

test('regression: nested dialogs restore to their own opener', () => {
  const outer = FM.createTrap([f('o1'), f('o2')], { previousFocusId: 'page' });
  outer.onTab(false);
  const inner = FM.createTrap([f('i1'), f('i2')], { previousFocusId: outer.current() });
  const innerClosed = inner.close();
  assert.equal(innerClosed.restoreFocusId, 'o2', 'inner returns to outer current');
  const outerClosed = outer.close();
  assert.equal(outerClosed.restoreFocusId, 'page');
});

test('boundary: an empty trap has no focus and stays safe', () => {
  const trap = FM.createTrap([]);
  assert.equal(trap.firstFocusId, null);
  assert.equal(trap.onTab(false), null);
});
