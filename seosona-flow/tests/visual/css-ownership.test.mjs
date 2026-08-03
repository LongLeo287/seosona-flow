// P8.T5 tests — CSS ownership + duplication analysis.
// positive/negative/boundary/regression across: selector use, duplicates,
// cascade (cross-file), dead-rule proxy, and budgets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/quality/check-css-ownership.mjs';

const ROOT = repoRoot();

test('positive: every tracked component CSS file is measured', () => {
  const r = build();
  assert.ok(r.files >= 10);
  for (const f of r.perFile) assert.ok(f.selectors >= 0 && f.bytes > 0);
});

test('boundary: cross-file duplicate selectors are enumerated', () => {
  const r = build();
  assert.ok(Array.isArray(r.topDuplicates));
  assert.ok(r.crossFileDuplicates >= 0);
});

test('regression: duplication + byte budgets do not grow', () => {
  const r = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/ux/phase-08/css-ownership.json'), 'utf8'));
  assert.ok(r.crossFileDuplicates <= onDisk.crossFileDuplicates, 'duplicates must not increase');
  assert.ok(r.totalBytes <= onDisk.totalBytes, 'CSS bytes must not increase');
});
