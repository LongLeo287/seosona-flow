// P6.T3 tests — selector resolver.
// positive / negative / boundary / regression across: primary, fallback,
// ambiguous, hidden, stale, absent, polling, and config versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { createFakeClock } from '../../tests/helpers/fake-clock.mjs';

const SR = loadClassic('src/providers/SelectorResolver.js').SEOSONA_SelectorResolver;
const R = SR.REASONS;

// A fake DOM: map of css string -> array of element-like objects.
const el = (over = {}) => Object.assign({ visible: true, connected: true, disabled: false }, over);
const mkQuery = (dom) => (css) => dom[css] || [];

const pack = {
  version: 3,
  selectors: { composer: ['#primary', '.fallback'], submit: ['#send'] },
};

test('positive: primary selector resolves and is labelled primary', () => {
  const r = SR.create(pack).resolve('composer', { query: mkQuery({ '#primary': [el()] }) });
  assert.equal(r.ok, true);
  assert.equal(r.matched, 'primary');
  assert.equal(r.selector, '#primary');
  assert.equal(r.configVersion, 3);
});

test('positive: falls back to the second selector when primary is absent', () => {
  const r = SR.create(pack).resolve('composer', { query: mkQuery({ '.fallback': [el()] }) });
  assert.equal(r.ok, true);
  assert.equal(r.matched, 'fallback');
  assert.equal(r.selector, '.fallback');
});

test('negative: absent everywhere → ABSENT', () => {
  const r = SR.create(pack).resolve('composer', { query: mkQuery({}) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, R.ABSENT);
});

test('negative: unknown key → NO_CONFIG', () => {
  const r = SR.create(pack).resolve('nope', { query: mkQuery({}) });
  assert.equal(r.reason, R.NO_CONFIG);
});

test('boundary: only-hidden match → HIDDEN (not absent)', () => {
  const r = SR.create(pack).resolve('composer', { query: mkQuery({ '#primary': [el({ visible: false })] }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, R.HIDDEN);
});

test('boundary: only-detached match → STALE', () => {
  const r = SR.create(pack).resolve('composer', { query: mkQuery({ '#primary': [el({ connected: false })] }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, R.STALE);
});

test('boundary: two usable matches with expect=one → AMBIGUOUS', () => {
  const r = SR.create(pack).resolve('composer', { query: mkQuery({ '#primary': [el(), el()] }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, R.AMBIGUOUS);
  assert.equal(r.count, 2);
});

test('boundary: expect=first returns the first of many; expect=many returns all', () => {
  const q = mkQuery({ '#primary': [el(), el(), el()] });
  assert.equal(SR.create(pack).resolve('composer', { query: q, expect: 'first' }).ok, true);
  const many = SR.create(pack).resolve('composer', { query: q, expect: 'many' });
  assert.equal(many.ok, true);
  assert.equal(many.elements.length, 3);
});

test('boundary: mustBeEnabled reports a disabled match diagnostically', () => {
  const r = SR.create(pack).resolve('submit', { query: mkQuery({ '#send': [el({ disabled: true })] }), mustBeEnabled: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, R.DISABLED);
});

test('config versions: minVersion above the pack → CONFIG_STALE', () => {
  const r = SR.create(pack).resolve('composer', { query: mkQuery({ '#primary': [el()] }), minVersion: 5 });
  assert.equal(r.reason, R.CONFIG_STALE);
  assert.equal(r.needVersion, 5);
});

test('polling: element that appears only after a delay is resolved', async () => {
  const clock = createFakeClock(0);
  // #primary "materializes" once the (fake) clock passes 250ms — independent of
  // how many querySelector calls each poll makes.
  const query = (css) => (css === '#primary' && clock.now() >= 250 ? [el()] : []);
  const p = SR.create(pack).resolvePolling('composer', {
    query,
    clock: { now: clock.now, setTimeout: clock.setTimeout },
    intervalMs: 100, timeoutMs: 1000,
  });
  clock.tick(1000);
  const r = await p;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.attempts >= 2, `attempts=${r.attempts}`);
});

test('polling: never-appears → POLL_TIMEOUT with lastReason', async () => {
  const clock = createFakeClock(0);
  const resolver = SR.create(pack);
  const p = resolver.resolvePolling('composer', {
    query: () => [],
    clock: { now: clock.now, setTimeout: clock.setTimeout },
    intervalMs: 100, timeoutMs: 500,
  });
  clock.tick(1000);
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.reason, R.POLL_TIMEOUT);
  assert.equal(r.lastReason, R.ABSENT);
});

test('polling: NO_CONFIG fails fast without waiting', async () => {
  const clock = createFakeClock(0);
  const p = SR.create(pack).resolvePolling('missingKey', {
    query: () => [],
    clock: { now: clock.now, setTimeout: clock.setTimeout },
    intervalMs: 100, timeoutMs: 1000,
  });
  clock.tick(0);
  const r = await p;
  assert.equal(r.reason, R.NO_CONFIG);
  assert.equal(r.attempts, 1);
});

test('regression: resolve is deterministic for a fixed DOM', () => {
  const q = mkQuery({ '#primary': [el()] });
  const a = SR.create(pack).resolve('composer', { query: q });
  const b = SR.create(pack).resolve('composer', { query: q });
  assert.equal(a.selector, b.selector);
  assert.equal(a.matched, b.matched);
});
