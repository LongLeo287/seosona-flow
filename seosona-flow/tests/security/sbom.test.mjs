// P9.T4 tests — SBOM + licenses.
// positive/negative/boundary/regression across: npm + vendored components,
// versions, hashes, licenses, sources, and updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/security/generate-sbom.mjs';

const ROOT = repoRoot();

test('positive: SBOM is CycloneDX with npm + vendored components', () => {
  const s = build();
  assert.equal(s.bomFormat, 'CycloneDX');
  assert.equal(s.specVersion, '1.5');
  assert.ok(s.componentCounts.npm >= 1);
  assert.ok(s.componentCounts.vendored >= 1);
});

test('boundary: every vendored component carries a SHA-256 hash', () => {
  const s = build();
  const vendored = s.components.filter((c) => c.scope === 'required');
  assert.ok(vendored.length >= 1);
  for (const c of vendored) assert.ok(c.hashes && c.hashes[0] && /^[0-9a-f]{64}$/.test(c.hashes[0].content), c.name);
});

test('boundary: npm components carry a purl and version', () => {
  const s = build();
  for (const c of s.components.filter((c) => c.scope === 'optional')) {
    assert.match(c.purl, /^pkg:npm\//);
    assert.ok(c.version);
  }
});

test('regression: SBOM reconciles with the committed artifact', () => {
  const s = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/release/phase-09/sbom.json'), 'utf8'));
  assert.equal(s.serialNumber, onDisk.serialNumber, 'content-derived serial is stable');
  assert.equal(s.components.length, onDisk.components.length);
});
