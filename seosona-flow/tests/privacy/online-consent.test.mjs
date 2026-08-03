// P7.T3 tests — online mode consent.
// positive/negative/boundary/regression across: activation, decline, repeat,
// policy change, fallback, transmitted data, and revoke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const C = loadClassic('src/ui/OnlineModeConsent.js').SEOSONA_OnlineModeConsent;

test('positive: fresh grant at current policy enables online mode', () => {
  const consent = C.grant(C.POLICY_VERSION, 1000);
  assert.equal(C.canGoOnline(consent), true);
  assert.equal(C.evaluate(consent).reason, C.REASONS.OK);
});

test('negative: no consent → offline by default (local-first)', () => {
  assert.equal(C.canGoOnline(undefined), false);
  assert.equal(C.evaluate(null).reason, C.REASONS.NO_CONSENT);
});

test('negative: revoked consent disables immediately', () => {
  const consent = C.revoke(C.grant(C.POLICY_VERSION, 1000));
  assert.equal(C.canGoOnline(consent), false);
  assert.equal(C.evaluate(consent).reason, C.REASONS.REVOKED);
});

test('policy change: consent for an old policy version is stale', () => {
  const consent = C.grant(C.POLICY_VERSION, 1000);
  assert.equal(C.canGoOnline(consent, C.POLICY_VERSION + 1), false);
  assert.equal(C.evaluate(consent, C.POLICY_VERSION + 1).reason, C.REASONS.STALE_CONSENT);
  assert.equal(C.needsReconsent(consent, C.POLICY_VERSION + 1), true);
});

test('boundary: transmitted-data summary is explicit and non-empty (informed consent)', () => {
  const summary = C.transmittedSummary();
  assert.ok(summary.length >= 1);
  for (const row of summary) {
    assert.ok(row.field && row.purpose && row.direction);
  }
});

test('regression: repeat grant is idempotent for the same policy', () => {
  const a = C.grant(C.POLICY_VERSION, 1);
  const b = C.grant(C.POLICY_VERSION, 2);
  assert.equal(C.canGoOnline(a), C.canGoOnline(b));
  assert.equal(a.version, b.version);
});
