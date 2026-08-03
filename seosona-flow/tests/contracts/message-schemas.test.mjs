// P4.T4 tests — message envelope schemas (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const S = loadClassic('src/core/MessageSchemas.js').SEOSONA_MessageSchemas;

test('positive: a well-formed message validates', () => {
  const r = S.validateEnvelope({ action: 'ping', version: 1, payload: { a: 1 } });
  assert.equal(r.valid, true);
  assert.equal(r.action, 'ping');
  assert.equal(r.version, 1);
});

test('negative: missing action is rejected', () => {
  const r = S.validateEnvelope({ payload: {} });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('MISSING_ACTION'));
});

test('negative: prototype-pollution keys are rejected', () => {
  const evil = JSON.parse('{"action":"x","payload":{"__proto__":{"admin":true}}}');
  const r = S.validateEnvelope(evil);
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('DANGEROUS_KEY'));
});

test('boundary: oversized payloads are rejected', () => {
  const r = S.validateEnvelope({ action: 'x', blob: 'y'.repeat(2000) }, { maxBytes: 1000 });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('PAYLOAD_TOO_LARGE'));
});

test('boundary: future versions are flagged', () => {
  const r = S.validateEnvelope({ action: 'x', version: 999 });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('FUTURE_VERSION'));
});

test('legacy: {type} is migrated to {action} with version 0', () => {
  const migrated = S.migrate({ type: 'closeWindow', foo: 1 });
  assert.equal(migrated.action, 'closeWindow');
  assert.equal(migrated.version, 0);
  assert.equal(S.validateEnvelope(migrated).valid, true);
});

test('regression: non-objects and arrays are rejected', () => {
  assert.equal(S.validateEnvelope(null).valid, false);
  assert.equal(S.validateEnvelope('x').valid, false);
  assert.equal(S.validateEnvelope([1, 2]).valid, false);
});
