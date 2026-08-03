// P10.T6 tests — reliability drills.
// positive/negative/boundary/regression across: worker suspension, offline,
// quota, corruption, provider drift, rate limit, permission, and recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/readiness/run-drills.mjs';

const ROOT = repoRoot();

test('positive: every scenario recovers or fails safe (0 unhandled)', () => {
  const r = build();
  assert.equal(r.unhandled, 0, JSON.stringify(r.results.filter((x) => x.disposition === 'unhandled')));
  assert.equal(r.unmet, 0);
  assert.ok(r.total >= 6);
});

test('boundary: rate-limit is recoverable; provider-drift fails safe', () => {
  const r = build();
  const rate = r.results.find((x) => x.id === 'provider-rate-limit');
  const drift = r.results.find((x) => x.id === 'provider-drift');
  assert.equal(rate.disposition, 'recovered');
  assert.equal(drift.disposition, 'failed-safe');
});

test('regression: drills reconcile with the committed receipt', () => {
  const r = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/readiness/phase-10/drills.json'), 'utf8'));
  assert.equal(r.total, onDisk.total);
  assert.equal(r.unhandled, onDisk.unhandled);
});
