// P10.T3 tests — health service.
// positive/negative/boundary/regression across: storage, workflows, providers,
// permissions, mode, network, assets, version, degraded, and migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const HS = loadClassic('src/diagnostics/HealthService.js').SEOSONA_HealthService;

const allOk = { storage: true, workflows: true, providers: true, permissions: true, mode: true, network: true, assets: true, version: true, migration: true };

test('positive: all checks ok → overall ok, no actions', () => {
  const h = HS.evaluate(allOk);
  assert.equal(h.overall, 'ok');
  assert.equal(h.actions.length, 0);
  assert.equal(h.okCount, HS.CHECKS.length);
});

test('negative: an error check → overall error + a recovery action', () => {
  const h = HS.evaluate({ ...allOk, providers: 'error' });
  assert.equal(h.overall, 'error');
  assert.ok(h.actions.some((a) => a.id === 'providers' && a.action));
});

test('boundary: a degraded check → overall degraded (not error)', () => {
  const h = HS.evaluate({ ...allOk, network: 'degraded' });
  assert.equal(h.overall, 'degraded');
});

test('boundary: a missing probe defaults to degraded', () => {
  const partial = { ...allOk };
  delete partial.migration;
  const h = HS.evaluate(partial);
  assert.ok(h.checks.find((c) => c.id === 'migration').status !== 'ok');
});

test('regression: every check has a stable code', () => {
  const h = HS.evaluate(allOk);
  for (const c of h.checks) assert.match(c.code, /^H_[A-Z]+$/);
});
