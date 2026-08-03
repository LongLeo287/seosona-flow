// P3.T5 tests — secure API origin pinning (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const pol = loadClassic('src/core/ApiOriginPolicy.js').SEOSONA_ApiOriginPolicy;

test('positive: approved HTTPS origin is allowed and secret-safe', () => {
  const d = pol.validate('https://api.seosona.vn/v1/config');
  assert.equal(d.allowed, true);
  assert.equal(d.secretSafe, true);
});

test('positive: dev localhost is allowed in dev', () => {
  assert.equal(pol.validate('http://localhost:8080/api/v1').allowed, true);
  assert.equal(pol.canCarrySecret('http://127.0.0.1:8080/x'), true);
});

test('negative: cleartext remote is rejected and never secret-safe', () => {
  const d = pol.validate('http://api.seosona.vn/v1/config');
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'CLEARTEXT_REMOTE');
  assert.equal(pol.canCarrySecret('http://api.seosona.vn/v1/config'), false);
});

test('negative: unapproved origin is rejected even over HTTPS', () => {
  const d = pol.validate('https://evil.example.com/collect');
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'UNAPPROVED_ORIGIN');
  assert.equal(pol.canCarrySecret('https://evil.example.com/collect'), false);
});

test('boundary: dev localhost can be disabled for production builds', () => {
  const d = pol.validate('http://localhost:8080/api', { allowDevLocalhost: false });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'DEV_LOCALHOST_DISABLED');
});

test('boundary: secureHeaders adds a strict marker', () => {
  const h = pol.secureHeaders({ Authorization: 'Bearer x' });
  assert.equal(h['X-Requested-With'], 'SEOSONA-Flow');
  assert.equal(h.Authorization, 'Bearer x');
});

test('regression: lookalike host is not approved', () => {
  assert.equal(pol.isApprovedHost('seosona.vn.evil.com'), false);
  assert.equal(pol.isApprovedHost('api.seosona.vn'), true);
});
