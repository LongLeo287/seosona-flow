// P10.T7 tests — release-candidate final verification.
// positive/negative/boundary/regression across: scope, tests, security, privacy,
// accessibility, performance, SBOM, package, and probes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/readiness/final-verification.mjs';

const ROOT = repoRoot();

test('positive: verdict is ACCEPTED with all evidence present', () => {
  const r = build();
  assert.equal(r.verdict, 'ACCEPTED');
  assert.deepEqual([...r.missing], []);
});

test('boundary: every evidence dimension is present', () => {
  const r = build();
  for (const d of r.dimensions) assert.equal(d.present, true, `${d.dimension} missing`);
  assert.ok(r.dimensions.length >= 8);
});

test('boundary: facts capture reproHash, sbom, drills', () => {
  const r = build();
  assert.match(r.facts.reproHash, /^[0-9a-f]{64}$/);
  assert.ok(r.facts.sbomComponents >= 1);
  assert.equal(r.facts.drills.unhandled, 0);
});

test('regression: final verification reconciles with the committed artifact', () => {
  const r = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/readiness/phase-10/final-verification.json'), 'utf8'));
  assert.equal(r.verdict, onDisk.verdict);
  assert.equal(r.gateCount, onDisk.gateCount);
});
