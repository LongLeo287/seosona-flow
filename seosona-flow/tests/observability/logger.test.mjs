// P10.T1 tests — structured logger.
// positive/negative/boundary/regression across: component, severity, event,
// correlation, sensitivity, level, circular data, disable, and bounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const ctx = loadClassic(['src/core/PrivacyFilter.js', 'src/core/StructuredLogger.js']);
const SL = ctx.SEOSONA_StructuredLogger;
const PF = ctx.SEOSONA_PrivacyFilter;

test('positive: emits a structured record with component/severity/event/correlation', () => {
  const log = SL.create({ privacyFilter: PF });
  const rec = log.info('provider', 'submit', { model: 'x' }, 'corr-1', 42);
  assert.equal(rec.component, 'provider');
  assert.equal(rec.severity, 'info');
  assert.equal(rec.event, 'submit');
  assert.equal(rec.correlationId, 'corr-1');
  assert.equal(rec.ts, 42);
});

test('sensitivity: content is filtered out by default', () => {
  const log = SL.create({ privacyFilter: PF });
  const rec = log.info('c', 'e', { prompt: 'a private prompt', token: 'eyJhbGciOiJIUzI1NiJ9.p.s' });
  assert.equal(rec.data.prompt.kind, 'text', 'prompt reduced to shape');
  assert.ok(!JSON.stringify(rec.data).includes('eyJhbGciOiJIUzI1NiJ9'), 'token redacted');
});

test('level: below-threshold events are dropped', () => {
  const log = SL.create({ privacyFilter: PF, level: 'warn' });
  assert.equal(log.debug('c', 'e'), null);
  assert.equal(log.info('c', 'e'), null);
  assert.ok(log.error('c', 'e'));
});

test('boundary: circular data does not throw', () => {
  const log = SL.create({ privacyFilter: PF });
  const a = { name: 'x' }; a.self = a;
  assert.doesNotThrow(() => log.info('c', 'circular', a));
});

test('bounds: the ring buffer is capped', () => {
  const log = SL.create({ privacyFilter: PF, bufferSize: 10 });
  for (let i = 0; i < 50; i++) log.info('c', 'e' + i);
  assert.equal(log.size(), 10);
  assert.equal(log.recent(1)[0].event, 'e49');
});

test('regression: enabling content keeps raw payload (explicit local choice)', () => {
  const log = SL.create({ privacyFilter: PF, contentEnabled: true });
  const rec = log.info('c', 'e', { prompt: 'keep me' });
  assert.equal(rec.data.prompt, 'keep me');
});
